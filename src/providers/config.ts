import { createRuntimeServicePaths, paths as defaultPaths } from '../config/paths';
import {
  createArtifactStore,
  createLocalArtifactStore,
  createLocalObjectStore,
  createSqliteArtifactManifestStore,
} from '../storage/artifact-store';
import { createSqliteRecordStore } from '../storage/record-store';
import { createVectorIndex, localVectorIndexResourceOverride } from '../storage/vector-index';
import {
  type RemoteProviderAdapterOptions,
  createRemoteArtifactManifestStore,
  createRemoteModelGateway,
  createRemoteObjectStore,
  createRemoteRecordStore,
  createRemoteVectorStore,
} from './remote';
import type {
  ArtifactManifestStorePort,
  ModelGateway,
  ObjectStorePort,
  RecordStorePort,
  RuntimeProviderPorts,
  VectorStore,
} from './ports';

export type ObjectProviderConfig =
  | { kind?: 'local-fs'; providerId?: string }
  | RemoteHttpJsonProviderConfig;

export type ArtifactManifestProviderConfig =
  | { kind?: 'local-sqlite-manifest'; providerId?: string }
  | RemoteHttpJsonProviderConfig;

export type VectorProviderConfig =
  | { kind?: 'local-lancedb'; providerId?: string }
  | RemoteHttpJsonProviderConfig;

export type RecordProviderConfig =
  | { kind?: 'local-sqlite-record'; providerId?: string }
  | RemoteHttpJsonProviderConfig;

export type ModelProviderGatewayConfig =
  | RemoteHttpJsonProviderConfig;

export interface RemoteHttpJsonProviderConfig {
  kind: 'remote-http-json';
  endpoint?: string;
  providerId?: string;
  headers?: Record<string, string>;
  headersSecretId?: string;
  operationPolicy?: RemoteProviderOperationPolicy;
}

export interface RuntimeProviderConfig {
  model?: ModelProviderGatewayConfig;
  artifact?: {
    object?: ObjectProviderConfig;
    manifest?: ArtifactManifestProviderConfig;
  };
  record?: RecordProviderConfig;
  vector?: VectorProviderConfig;
}

export interface RuntimeProviderAssemblyOptions {
  runtimeHome?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface RemoteProviderOperationPolicy {
  timeoutMs?: number;
  retry?: {
    attempts?: number;
    backoffMs?: number;
  };
}

export function createRuntimeProviderPortsFromConfig(
  config: RuntimeProviderConfig = {},
  options: RuntimeProviderAssemblyOptions = {},
): RuntimeProviderPorts {
  const servicePaths = options.runtimeHome ? createRuntimeServicePaths(options.runtimeHome) : defaultPaths;
  const artifactConfig = config.artifact ?? {};
  const hasArtifactConfig = Boolean(artifactConfig.object || artifactConfig.manifest);
  const artifactStore = hasArtifactConfig
    ? createArtifactStore({
      objectStore: createObjectStoreFromConfig(artifactConfig.object, options, servicePaths.artifactsDir),
      manifestStore: createManifestStoreFromConfig(artifactConfig.manifest, options, servicePaths.artifactManifestDb),
    })
    : createLocalArtifactStore({
      artifactsDir: servicePaths.artifactsDir,
      manifestDbPath: servicePaths.artifactManifestDb,
    });

  return {
    ...(config.model ? { modelGateway: createModelGatewayFromConfig(config.model, options) } : {}),
    artifactStore,
    recordStore: createRecordStoreFromConfig(config.record, options, servicePaths.recordStoreDb),
    vectorStore: createVectorStoreFromConfig(config.vector, options, servicePaths.vectorDir),
  };
}

function createModelGatewayFromConfig(
  config: ModelProviderGatewayConfig,
  options: RuntimeProviderAssemblyOptions,
): ModelGateway {
  const kind = config.kind;
  if (kind === 'remote-http-json') {
    return createRemoteModelGateway(remoteOptions('model', config, options));
  }
  throw new Error(`unsupported model provider kind: ${String((config as { kind?: unknown } | undefined)?.kind)}`);
}

function createObjectStoreFromConfig(
  config: ObjectProviderConfig | undefined,
  options: RuntimeProviderAssemblyOptions,
  artifactsDir: string,
): ObjectStorePort {
  const kind = config?.kind ?? 'local-fs';
  if (kind === 'local-fs') {
    const store = createLocalObjectStore({ artifactsDir });
    return config?.providerId
      ? {
        ...store,
        providerId: config.providerId,
        probe: async (input) => {
          const result = await store.probe?.(input);
          return {
            status: result?.status ?? 'available',
            providerId: config.providerId,
            evidence: result?.evidence,
          };
        },
      }
      : store;
  }
  if (kind === 'remote-http-json') {
    return createRemoteObjectStore(remoteOptions('artifact.object', config as RemoteHttpJsonProviderConfig, options));
  }
  throw new Error(`unsupported artifact object provider kind: ${String((config as { kind?: unknown } | undefined)?.kind)}`);
}

function createManifestStoreFromConfig(
  config: ArtifactManifestProviderConfig | undefined,
  options: RuntimeProviderAssemblyOptions,
  manifestDbPath: string,
): ArtifactManifestStorePort {
  const kind = config?.kind ?? 'local-sqlite-manifest';
  if (kind === 'local-sqlite-manifest') {
    const store = createSqliteArtifactManifestStore({ manifestDbPath });
    return config?.providerId
      ? {
        ...store,
        providerId: config.providerId,
        probe: async (input) => {
          const result = await store.probe?.(input);
          return {
            status: result?.status ?? 'available',
            providerId: config.providerId,
            evidence: result?.evidence,
          };
        },
      }
      : store;
  }
  if (kind === 'remote-http-json') {
    return createRemoteArtifactManifestStore(remoteOptions('artifact.manifest', config as RemoteHttpJsonProviderConfig, options));
  }
  throw new Error(`unsupported artifact manifest provider kind: ${String((config as { kind?: unknown } | undefined)?.kind)}`);
}

function createVectorStoreFromConfig(
  config: VectorProviderConfig | undefined,
  options: RuntimeProviderAssemblyOptions,
  vectorDir: string,
): VectorStore {
  const kind = config?.kind ?? 'local-lancedb';
  if (kind === 'local-lancedb') {
    const store = createVectorIndex({ vectorDir });
    return {
      ...store,
      providerId: config?.providerId ?? 'local-lancedb',
      async probe() {
        const providerId = config?.providerId ?? 'local-lancedb';
        const override = localVectorIndexResourceOverride({ vectorDir });
        return {
          status: override?.status ?? 'stubbed',
          providerId,
          evidence: [{
            kind: 'provider_probe',
            message: override
              ? `vectorDir=${vectorDir}`
              : `missing vectorDir=${vectorDir}`,
          }],
        };
      },
    };
  }
  if (kind === 'remote-http-json') {
    return createRemoteVectorStore(remoteOptions('vector', config as RemoteHttpJsonProviderConfig, options));
  }
  throw new Error(`unsupported vector provider kind: ${String((config as { kind?: unknown } | undefined)?.kind)}`);
}

function createRecordStoreFromConfig(
  config: RecordProviderConfig | undefined,
  options: RuntimeProviderAssemblyOptions,
  recordDbPath: string,
): RecordStorePort {
  const kind = config?.kind ?? 'local-sqlite-record';
  if (kind === 'local-sqlite-record') {
    return createSqliteRecordStore({
      recordDbPath,
      ...(config?.providerId ? { providerId: config.providerId } : {}),
    });
  }
  if (kind === 'remote-http-json') {
    return createRemoteRecordStore(remoteOptions('record', config as RemoteHttpJsonProviderConfig, options));
  }
  throw new Error(`unsupported record provider kind: ${String((config as { kind?: unknown } | undefined)?.kind)}`);
}

function remoteOptions(
  label: string,
  config: RemoteHttpJsonProviderConfig,
  options: RuntimeProviderAssemblyOptions,
): RemoteProviderAdapterOptions {
  if (!config.endpoint) throw new Error(`${label}.endpoint is required`);
  if (config.headersSecretId) {
    throw new Error(`${label}.headersSecretId is not supported yet; use explicit headers`);
  }
  return {
    endpoint: config.endpoint,
    ...(config.providerId ? { providerId: config.providerId } : {}),
    ...(config.headers ? { headers: config.headers } : {}),
    ...(config.operationPolicy?.timeoutMs ? { timeoutMs: config.operationPolicy.timeoutMs } : {}),
    ...(config.operationPolicy?.retry ? { retry: config.operationPolicy.retry } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
}
