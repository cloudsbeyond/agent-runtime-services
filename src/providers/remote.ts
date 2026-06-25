import { Buffer } from 'node:buffer';
import type {
  EmbeddingResult,
  ImageGenerationResult,
  LanguageModelResult,
} from '../models/client';
import type {
  ArtifactManifestStorePort,
  ModelGateway,
  ObjectStorePort,
  ProviderProbeInput,
  ProviderProbeResult,
  RecordStorePort,
  VectorStore,
} from './ports';
import type {
  StoredArtifact,
} from '../storage/artifact-store';
import type {
  RuntimeRecord,
} from '../storage/record-store';
import type {
  VectorSearchResult,
} from '../storage/vector-index';
import {
  normalizeVectorSearchFilter,
} from '../storage/vector-index';

export interface RemoteProviderAdapterOptions {
  endpoint: string;
  providerId?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retry?: RemoteProviderRetryPolicy;
}

export interface RemoteProviderRetryPolicy {
  attempts?: number;
  backoffMs?: number;
}

export function createRemoteObjectStore(options: RemoteProviderAdapterOptions): ObjectStorePort {
  const client = createRemoteJsonClient(options);
  const providerId = options.providerId ?? 'remote-object-store';
  return {
    providerId,
    async probe(input) {
      return client.probe(providerId, input, 'object-store');
    },
    async put(input) {
      const response = await client.post<{
        path?: unknown;
        sizeBytes?: unknown;
      }>('/objects/put', {
        namespace: input.namespace,
        key: input.key,
        bodyBase64: Buffer.from(input.body).toString('base64'),
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      });
      if (typeof response.path !== 'string') throw new Error('remote object store response missing path');
      if (typeof response.sizeBytes !== 'number' || !Number.isFinite(response.sizeBytes)) {
        throw new Error('remote object store response missing sizeBytes');
      }
      return {
        path: response.path,
        sizeBytes: response.sizeBytes,
      };
    },
    async get(input) {
      const response = await client.post<{ bodyBase64?: unknown }>('/objects/get', {
        path: input.path,
      });
      if (typeof response.bodyBase64 !== 'string') throw new Error('remote object store response missing bodyBase64');
      return Buffer.from(response.bodyBase64, 'base64');
    },
    async delete(input) {
      await client.post('/objects/delete', { path: input.path });
    },
  };
}

export function createRemoteArtifactManifestStore(
  options: RemoteProviderAdapterOptions,
): ArtifactManifestStorePort {
  const client = createRemoteJsonClient(options);
  const providerId = options.providerId ?? 'remote-artifact-manifest';
  return {
    providerId,
    async probe(input) {
      return client.probe(providerId, input, 'artifact-manifest-store');
    },
    async insert(artifact) {
      await client.post('/artifacts/insert', { artifact });
    },
    async list(options) {
      const response = await client.post<{ artifacts?: unknown }>('/artifacts/list', {
        namespace: options.namespace,
      });
      if (!Array.isArray(response.artifacts)) throw new Error('remote artifact manifest response missing artifacts');
      return response.artifacts.map(normalizeStoredArtifact);
    },
    async get(input) {
      const response = await client.post<{ artifact?: unknown }>('/artifacts/get', {
        namespace: input.namespace,
        id: input.id,
      });
      return normalizeStoredArtifact(response.artifact);
    },
    async delete(input) {
      await client.post('/artifacts/delete', { namespace: input.namespace, id: input.id });
    },
  };
}

export function createRemoteRecordStore(options: RemoteProviderAdapterOptions): RecordStorePort {
  const client = createRemoteJsonClient(options);
  const providerId = options.providerId ?? 'remote-record-store';
  return {
    providerId,
    async probe(input) {
      return client.probe(providerId, input, 'record-store');
    },
    async upsert(input) {
      const response = await client.post<{ record?: unknown }>('/records/upsert', {
        namespace: input.namespace,
        tableName: input.tableName,
        id: input.id,
        data: input.data,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      });
      return normalizeRuntimeRecord(response.record);
    },
    async get(input) {
      const response = await client.post<{ record?: unknown }>('/records/get', {
        namespace: input.namespace,
        tableName: input.tableName,
        id: input.id,
      });
      return normalizeRuntimeRecord(response.record);
    },
    async query(input) {
      const response = await client.post<{ records?: unknown }>('/records/query', {
        namespace: input.namespace,
        tableName: input.tableName,
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
      });
      if (!Array.isArray(response.records)) throw new Error('remote record store response missing records');
      return response.records.map(normalizeRuntimeRecord);
    },
    async delete(input) {
      const response = await client.post<{ deleted?: unknown }>('/records/delete', {
        namespace: input.namespace,
        tableName: input.tableName,
        id: input.id,
      });
      return normalizeRuntimeRecord(response.deleted);
    },
  };
}

export function createRemoteVectorStore(options: RemoteProviderAdapterOptions): VectorStore {
  const client = createRemoteJsonClient(options);
  const providerId = options.providerId ?? 'remote-vector-store';
  return {
    providerId,
    async probe(input) {
      return client.probe(providerId, input, 'vector-store');
    },
    async upsert(record, options) {
      const tableName = requireStorageName(options.tableName, 'tableName');
      await client.post('/vectors/upsert', {
        tableName,
        record,
      });
    },
    async search(queryEmbedding, options) {
      const tableName = requireStorageName(options.tableName, 'tableName');
      const filter = normalizeVectorSearchFilter(options.filter);
      const response = await client.post<{ results?: unknown }>('/vectors/search', {
        tableName,
        embedding: queryEmbedding,
        ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
        ...(filter ? { filter } : {}),
      });
      if (!Array.isArray(response.results)) throw new Error('remote vector response missing results');
      return response.results.map(normalizeVectorSearchResult);
    },
  };
}

export function createRemoteModelGateway(options: RemoteProviderAdapterOptions): ModelGateway {
  const client = createRemoteJsonClient(options);
  const providerId = options.providerId ?? 'remote-model-gateway';
  return {
    providerId,
    async probe(input) {
      return client.probe(providerId, input, 'model-gateway');
    },
    async complete(input) {
      const response = await client.post('/models/complete', { input: input.input });
      return normalizeLanguageModelResult(response, providerId);
    },
    async createEmbedding(input) {
      const response = await client.post('/models/embedding', { input: input.input });
      return normalizeEmbeddingResult(response, providerId);
    },
    async generateImage(input) {
      const response = await client.post('/models/image', { prompt: input.prompt });
      return normalizeImageGenerationResult(response, providerId);
    },
  };
}

function createRemoteJsonClient(options: RemoteProviderAdapterOptions): {
  post<T = Record<string, unknown>>(route: string, body: unknown): Promise<T>;
  probe(providerId: string, input: ProviderProbeInput | undefined, defaultKind: string): Promise<ProviderProbeResult>;
} {
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_REMOTE_TIMEOUT_MS);
  const retryAttempts = normalizePositiveInteger(options.retry?.attempts, 1);
  const retryBackoffMs = normalizeNonNegativeInteger(options.retry?.backoffMs, 0);
  return {
    async post<T>(route: string, body: unknown) {
      return requestJson<T>({
        endpoint,
        route,
        body,
        headers: options.headers,
        fetchImpl,
        timeoutMs,
        retryAttempts,
        retryBackoffMs,
      });
    },
    async probe(providerId, input, defaultKind) {
      try {
        const payload = await requestJson({
          endpoint,
          route: '/resources/probe',
          headers: options.headers,
          fetchImpl,
          timeoutMs,
          retryAttempts,
          retryBackoffMs,
          body: {
            providerId,
            kind: input?.kind ?? defaultKind,
            ...(input?.resourceId ? { resourceId: input.resourceId } : {}),
          },
        });
        return {
          status: remoteProbeStatus(payload),
          providerId,
          evidence: remoteProbeEvidence(payload),
        };
      } catch (error) {
        return remoteProbeFailure(providerId, error instanceof Error ? error.message : String(error));
      }
    },
  };
}

interface RemoteJsonRequestOptions {
  endpoint: string;
  route: string;
  body: unknown;
  headers?: Record<string, string>;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
}

async function requestJson<T>(options: RemoteJsonRequestOptions): Promise<T> {
  let lastMessage = 'remote provider request failed';
  for (let attempt = 1; attempt <= options.retryAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(options);
      const text = await response.text();
      const payload = parseRemoteJson(text);
      const remoteError = remoteErrorMessage(payload);
      if (response.ok && !remoteError) return payload as T;

      lastMessage = remoteError ?? `remote provider request failed (${response.status})`;
      if (!isRetryableStatus(response.status) || attempt >= options.retryAttempts) {
        throw remoteRequestError(options.route, attempt, lastMessage, isRetryableStatus(response.status));
      }
    } catch (error) {
      if (isRemoteRequestError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= options.retryAttempts) {
        throw remoteRequestError(options.route, attempt, message, attempt > 1);
      }
      lastMessage = message;
    }
    await sleep(options.retryBackoffMs);
  }
  throw remoteRequestError(options.route, options.retryAttempts, lastMessage, options.retryAttempts > 1);
}

async function fetchWithTimeout(options: RemoteJsonRequestOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    return await options.fetchImpl(`${options.endpoint}${options.route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`timeout after ${options.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseRemoteJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('remote provider returned invalid JSON');
  }
}

function remoteErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const error = (payload as { error?: unknown }).error;
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return 'remote provider request failed';
}

function remoteProbeFailure(providerId: string, message: string): ProviderProbeResult {
  return {
    status: 'stubbed',
    providerId,
    evidence: [{ kind: 'provider_probe', message }],
  };
}

function remoteProbeStatus(payload: unknown): ProviderProbeResult['status'] {
  if (payload && typeof payload === 'object' && (payload as { status?: unknown }).status === 'stubbed') return 'stubbed';
  return 'available';
}

function remoteProbeEvidence(payload: unknown): ProviderProbeResult['evidence'] {
  if (!payload || typeof payload !== 'object') return [{ kind: 'provider_probe' }];
  const message = (payload as { message?: unknown }).message;
  return [{
    kind: 'provider_probe',
    ...(typeof message === 'string' ? { message } : {}),
  }];
}

function normalizeStoredArtifact(value: unknown): StoredArtifact {
  if (!value || typeof value !== 'object') throw new Error('remote artifact manifest returned invalid artifact');
  const record = value as Partial<StoredArtifact>;
  return {
    id: stringField(record.id, 'artifact.id'),
    namespace: stringField(record.namespace, 'artifact.namespace'),
    path: stringField(record.path, 'artifact.path'),
    mimeType: stringField(record.mimeType, 'artifact.mimeType'),
    sizeBytes: numberField(record.sizeBytes, 'artifact.sizeBytes'),
    sha256: stringField(record.sha256, 'artifact.sha256'),
    createdAt: stringField(record.createdAt, 'artifact.createdAt'),
    ...(typeof record.expiresAt === 'string' ? { expiresAt: record.expiresAt } : {}),
    ...(typeof record.sourceUrl === 'string' ? { sourceUrl: record.sourceUrl } : {}),
    source: record.source && typeof record.source === 'object' && !Array.isArray(record.source)
      ? record.source
      : {},
  };
}

function normalizeVectorSearchResult(value: unknown): VectorSearchResult {
  if (!value || typeof value !== 'object') throw new Error('remote vector service returned invalid result');
  const record = value as Partial<VectorSearchResult>;
  return {
    id: stringField(record.id, 'vector.id'),
    content: stringField(record.content, 'vector.content'),
    embedding: numberArrayField(record.embedding, 'vector.embedding'),
    metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? record.metadata
      : {},
    score: numberField(record.score, 'vector.score'),
    createdAt: stringField(record.createdAt, 'vector.createdAt'),
    updatedAt: stringField(record.updatedAt, 'vector.updatedAt'),
  };
}

function normalizeRuntimeRecord(value: unknown): RuntimeRecord {
  const record = objectField(value, 'runtime record');
  return {
    namespace: stringField(record.namespace, 'record.namespace'),
    tableName: stringField(record.tableName, 'record.tableName'),
    id: stringField(record.id, 'record.id'),
    data: jsonObjectField(record.data, 'record.data'),
    metadata: record.metadata === undefined ? {} : jsonObjectField(record.metadata, 'record.metadata'),
    createdAt: stringField(record.createdAt, 'record.createdAt'),
    updatedAt: stringField(record.updatedAt, 'record.updatedAt'),
  };
}

function normalizeLanguageModelResult(value: unknown, providerId: string): LanguageModelResult {
  const record = objectField(value, 'model language response');
  return {
    moduleId: 'language',
    providerId: optionalStringField(record.providerId) ?? providerId,
    modelId: stringField(record.modelId, 'model.modelId'),
    text: stringField(record.text, 'model.text'),
    raw: value,
  };
}

function normalizeEmbeddingResult(value: unknown, providerId: string): EmbeddingResult {
  const record = objectField(value, 'model embedding response');
  return {
    moduleId: 'embedding',
    providerId: optionalStringField(record.providerId) ?? providerId,
    modelId: stringField(record.modelId, 'model.modelId'),
    embedding: numberArrayField(record.embedding, 'model.embedding'),
    raw: value,
  };
}

function normalizeImageGenerationResult(value: unknown, providerId: string): ImageGenerationResult {
  const record = objectField(value, 'model image response');
  const url = optionalStringField(record.url);
  const b64Json = optionalStringField(record.b64Json) ?? optionalStringField(record.b64_json);
  if (!url && !b64Json) throw new Error('remote response missing model image url or b64Json');
  return {
    moduleId: 'vision',
    providerId: optionalStringField(record.providerId) ?? providerId,
    modelId: stringField(record.modelId, 'model.modelId'),
    ...(url ? { url } : {}),
    ...(b64Json ? { b64Json } : {}),
    raw: value,
  };
}

function objectField(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`remote response missing ${label}`);
  return value as Record<string, unknown>;
}

function optionalStringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`remote response missing ${label}`);
  return value;
}

function numberField(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`remote response missing ${label}`);
  return value;
}

function numberArrayField(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`remote response missing ${label}`);
  }
  return value;
}

function jsonObjectField(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`remote response missing ${label}`);
  return value as Record<string, unknown>;
}

function requireStorageName(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function remoteRequestError(route: string, attempts: number, message: string, exhausted: boolean): Error {
  const prefix = exhausted ? 'remote provider retry exhausted' : 'remote provider request failed';
  return new Error(`${prefix}: route=${route} attempts=${attempts} ${message}`);
}

function isRemoteRequestError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.startsWith('remote provider request failed:')
    || error.message.startsWith('remote provider retry exhausted:')
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value >= 0 ? Math.floor(value) : fallback;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_REMOTE_TIMEOUT_MS = 30_000;
