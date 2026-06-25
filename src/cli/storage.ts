import { createRuntimeServicePaths, paths } from '../config/paths';
import type { ModelProviderConfig } from '../models/catalog';
import { createResourceCatalog, type ResourceCatalog } from '../resources/catalog';
import { createRuntimeServices, type RuntimeServices } from '../runtime-services';
import type { StoredArtifact } from '../storage/artifact-store';
import type { VectorSearchResult } from '../storage/vector-index';
import { assertOkRuntimeEnvelope } from './envelope';
import { createRuntimeServicesForCli, type CliRuntimeOptions } from './runtime';

export interface StorageStatusPaths {
  appDir: string;
  artifactsDir: string;
  artifactManifestDb: string;
  recordStoreDb: string;
  memoryStoreDb: string;
  vectorDir: string;
}

export interface StorageStatusOptions extends StorageStatusPaths {
  resources: ResourceCatalog;
}

export function formatStorageStatus(options: StorageStatusOptions): string {
  const artifactStore = options.resources.require('storage.artifact_store');
  const recordStore = options.resources.require('storage.record_store');
  const memoryStore = options.resources.require('storage.memory_store');
  const vectorIndex = options.resources.require('storage.vector_index');
  return [
    'Agent runtime services storage',
    `home: ${options.appDir}`,
    `artifacts: ${options.artifactsDir}`,
    `artifact manifest: ${options.artifactManifestDb}`,
    `records: ${options.recordStoreDb}`,
    `memory: ${options.memoryStoreDb}`,
    `vectors: ${options.vectorDir}`,
    `storage.artifact_store: ${formatResourceStatus(artifactStore)}`,
    `storage.record_store: ${formatResourceStatus(recordStore)}`,
    `storage.memory_store: ${formatResourceStatus(memoryStore)}`,
    `storage.vector_index: ${formatResourceStatus(vectorIndex)}`,
  ].join('\n');
}

export function formatArtifactList(artifacts: StoredArtifact[], limit = 20): string {
  const selected = [...artifacts]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, Math.max(1, limit));
  const lines = [`Agent runtime services artifacts (${artifacts.length})`];
  if (selected.length === 0) {
    lines.push('No artifacts recorded.');
    return lines.join('\n');
  }
  for (const artifact of selected) {
    lines.push([
      `- ${artifact.id}`,
      `  created: ${artifact.createdAt}`,
      `  namespace: ${artifact.namespace}`,
      `  mime: ${artifact.mimeType}`,
      `  bytes: ${artifact.sizeBytes}`,
      `  path: ${artifact.path}`,
      `  source: ${formatMetadata(artifact.source)}`,
      ...(artifact.sourceUrl ? ['  sourceUrl: present'] : []),
      ...(artifact.expiresAt ? [`  expires: ${artifact.expiresAt}`] : []),
    ].join('\n'));
  }
  return lines.join('\n');
}

export async function cleanupArtifactsForCli(
  services: RuntimeServices,
  input: { namespace: string },
  now: Date = new Date(),
): Promise<string> {
  const result = await services.artifact.cleanupExpired({ namespace: input.namespace, now: now.toISOString() });
  assertOkRuntimeEnvelope(result);
  return [
    'Agent runtime services artifact cleanup',
    `namespace=${input.namespace}`,
    `deleted=${result.deleted.length}`,
    ...result.deleted.map((artifact) => `- ${artifact.id} ${artifact.path}`),
  ].join('\n');
}

export async function listArtifactsForCli(
  services: RuntimeServices,
  input: { namespace: string; limit?: number },
): Promise<string> {
  const result = await services.artifact.list({ namespace: input.namespace });
  assertOkRuntimeEnvelope(result);
  return formatArtifactList(result.artifacts, input.limit);
}

export async function storageStatusForCli(
  services: RuntimeServices,
  runtimeHome: string | undefined = paths.appDir,
): Promise<string> {
  const status = await services.resources.status();
  assertOkRuntimeEnvelope(status);
  return formatStorageStatus({
    ...storageStatusPaths(runtimeHome),
    resources: createResourceCatalog(status.resources.map((resource) => ({
      id: resource.id,
      status: resource.status,
      ...(resource.provider ? { provider: resource.provider } : {}),
    }))),
  });
}

export async function upsertRuntimeContentForCli(
  config: ModelProviderConfig,
  input: { id: string; content: string; tableName: string },
  options: { services?: RuntimeServices } = {},
): Promise<string> {
  const services = options.services ?? createRuntimeServices({ modelConfig: config });
  const embedding = await services.embedding.create({ input: input.content });
  if (embedding.status !== 'ok' || !embedding.embedding) {
    throw new Error(embedding.evidence[0]?.message ?? embedding.status);
  }
  const result = await services.vector.upsert({
    tableName: input.tableName,
    id: input.id,
    content: input.content,
    embedding: embedding.embedding,
    metadata: {
      sourceKind: 'operator_storage_cli',
    },
  });
  assertOkRuntimeEnvelope(result);
  return [
    'Agent runtime services vector upsert',
    `tableName=${input.tableName}`,
    `id=${result.id ?? input.id}`,
    `model=${embedding.modelId}`,
    `dims=${embedding.embedding.length}`,
  ].join('\n');
}

export async function searchRuntimeContentForCli(
  config: ModelProviderConfig,
  input: { query: string; tableName: string; limit?: number },
  options: { services?: RuntimeServices } = {},
): Promise<string> {
  const services = options.services ?? createRuntimeServices({ modelConfig: config });
  const result = await services.vector.search({ query: input.query, tableName: input.tableName, limit: input.limit });
  assertOkRuntimeEnvelope(result);
  return formatVectorSearchResults(result.results);
}

export function formatVectorSearchResults(results: VectorSearchResult[]): string {
  const lines = [`Agent runtime services vector search (${results.length})`];
  if (results.length === 0) {
    lines.push('No matching vectors.');
    return lines.join('\n');
  }
  for (const result of results) {
    lines.push([
      `- ${result.id}`,
      `  score: ${result.score.toFixed(4)}`,
      `  content: ${result.content}`,
      `  metadata: ${formatMetadata(result.metadata)}`,
    ].join('\n'));
  }
  return lines.join('\n');
}

export async function runStorageStatusCli(options: CliRuntimeOptions = {}): Promise<void> {
  const { runtimeHome, services } = await createRuntimeServicesForCli(options);
  console.log(await storageStatusForCli(services, runtimeHome));
}

export async function runStorageArtifactsListCli(options: { namespace: string; limit?: string } & CliRuntimeOptions): Promise<void> {
  const { services } = await createRuntimeServicesForCli(options);
  console.log(await listArtifactsForCli(services, {
    namespace: options.namespace,
    limit: parsePositiveInteger(options.limit, 20),
  }));
}

export async function runStorageArtifactsCleanupCli(options: { namespace: string } & CliRuntimeOptions): Promise<void> {
  const { services } = await createRuntimeServicesForCli(options);
  console.log(await cleanupArtifactsForCli(services, { namespace: options.namespace }));
}

export async function runStorageVectorsUpsertCli(
  id: string,
  contentParts: string[],
  options: { config?: string; tableName: string } & CliRuntimeOptions,
): Promise<void> {
  const runtime = await createRuntimeServicesForCli({
    runtimeHome: options.runtimeHome,
    providerConfig: options.providerConfig,
    modelConfig: options.config,
  });
  console.log(await upsertRuntimeContentForCli(runtime.modelConfig, {
    id,
    content: contentParts.join(' '),
    tableName: options.tableName,
  }, { services: runtime.services }));
}

export async function runStorageVectorsSearchCli(
  queryParts: string[],
  options: { config?: string; tableName: string; limit?: string } & CliRuntimeOptions,
): Promise<void> {
  const runtime = await createRuntimeServicesForCli({
    runtimeHome: options.runtimeHome,
    providerConfig: options.providerConfig,
    modelConfig: options.config,
  });
  console.log(await searchRuntimeContentForCli(runtime.modelConfig, {
    query: queryParts.join(' '),
    tableName: options.tableName,
    limit: parsePositiveInteger(options.limit, 10),
  }, { services: runtime.services }));
}

function storageStatusPaths(runtimeHome = paths.appDir): StorageStatusPaths {
  const runtimePaths = createRuntimeServicePaths(runtimeHome);
  return {
    appDir: runtimePaths.appDir,
    artifactsDir: runtimePaths.artifactsDir,
    artifactManifestDb: runtimePaths.artifactManifestDb,
    recordStoreDb: runtimePaths.recordStoreDb,
    memoryStoreDb: runtimePaths.memoryStoreDb,
    vectorDir: runtimePaths.vectorDir,
  };
}

function formatResourceStatus(resource: ReturnType<ResourceCatalog['require']>): string {
  return resource.provider ? `${resource.status} via ${resource.provider}` : resource.status;
}

function formatMetadata(source: Record<string, unknown>): string {
  const kind = typeof source.kind === 'string' ? source.kind : undefined;
  const sourceKind = typeof source.sourceKind === 'string' ? source.sourceKind : undefined;
  const modelId = typeof source.modelId === 'string' ? source.modelId : undefined;
  const moduleId = typeof source.moduleId === 'string' ? source.moduleId : undefined;
  const compact = [kind ?? sourceKind, moduleId, modelId].filter(Boolean).join('/');
  return compact || JSON.stringify(source);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
