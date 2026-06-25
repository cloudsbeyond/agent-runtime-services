import { Buffer } from 'node:buffer';
import { createRuntimeServicePaths, paths as defaultPaths } from './config/paths';
import { getSecret, listSecretIds } from './config/keystore';
import type { RuntimeServiceCapabilityId } from './capabilities/registry';
import {
  MODEL_MODULE_IDS,
  createDefaultModelProviderConfig,
  modelProviderResourceOverrides,
  type ModelModuleId,
  type ModelProviderConfig,
} from './models/catalog';
import {
  type RuntimeModelFetch,
} from './models/client';
import { createModelGateway } from './models/gateway';
import type { ModelRuntimeSecretOptions } from './models/runtime';
import {
  createRuntimeProviderPortsFromConfig,
  type RuntimeProviderConfig,
} from './providers/config';
import type {
  ArtifactStorePort,
  MemoryStorePort,
  ModelGateway,
  ProviderPort,
  RecordStorePort,
  RuntimeProviderPorts,
  VectorStore,
} from './providers/ports';
import {
  createResourceCatalog,
  type ResourceOverride,
  type ResourceRequirement,
  type ResourceStatus,
} from './resources/catalog';
import {
  createMemoryService,
  type MemoryClaimGetResult,
  type MemoryClaimQueryResult,
  type MemoryClaimUpsertResult,
  type MemoryContextRetrieveResult,
  type MemoryEventAppendResult,
  type MemoryEventGetResult,
  type MemoryEventListResult,
  type MemoryRelationQueryResult,
  type MemoryRelationUpsertResult,
  type RuntimeMemoryContextBundle,
  type RuntimeMemoryContextRetrieveInput,
} from './services/memory';
import {
  createArtifactStore,
  createLocalArtifactStore,
  createLocalObjectStore,
  createSqliteArtifactManifestStore,
  localArtifactStoreResourceOverride,
  type ArtifactNamespaceOptions,
  type ArtifactSource,
  type SaveArtifactInput,
  type StoredArtifact,
} from './storage/artifact-store';
import {
  createSqliteRecordStore,
  localRecordStoreResourceOverride,
  type RuntimeRecord,
  type RuntimeRecordDeleteInput,
  type RuntimeRecordGetInput,
  type RuntimeRecordQueryInput,
  type RuntimeRecordUpsertInput,
} from './storage/record-store';
import {
  createSqliteMemoryStore,
  localMemoryStoreResourceOverride,
  type RuntimeMemoryClaimGetInput,
  type RuntimeMemoryClaimQueryInput,
  type RuntimeMemoryClaimUpsertInput,
  type RuntimeMemoryEventAppendInput,
  type RuntimeMemoryEventGetInput,
  type RuntimeMemoryEventListInput,
  type RuntimeMemoryRelationQueryInput,
  type RuntimeMemoryRelationUpsertInput,
} from './storage/memory-store';
import {
  createVectorIndex,
  localVectorIndexResourceOverride,
  normalizeVectorSearchFilter,
  type VectorIndexRecord,
  type VectorSearchOptions,
  type VectorSearchResult,
} from './storage/vector-index';

export type RuntimeServiceStatus = 'ok' | 'missing_resource' | 'failed';

export interface RuntimeServiceEvidence {
  kind: string;
  message?: string;
  data?: unknown;
}

export interface RuntimeServiceEnvelope {
  status: RuntimeServiceStatus;
  capabilityId: string;
  providerId: string;
  modelId: string;
  evidence: RuntimeServiceEvidence[];
}

export interface TypedTextProposal {
  kind: 'text';
  text: string;
  raw: unknown;
}

export interface RuntimeImageArtifact {
  kind: 'image';
  url?: string;
  b64Json?: string;
  raw: unknown;
}

export type LanguageCompleteResult = RuntimeServiceEnvelope & {
  proposal?: TypedTextProposal;
};

export type EmbeddingCreateResult = RuntimeServiceEnvelope & {
  embedding?: number[];
};

export type VisionGenerateImageResult = RuntimeServiceEnvelope & {
  artifact?: RuntimeImageArtifact;
};

export type ArtifactSaveResult = RuntimeServiceEnvelope & {
  artifact?: StoredArtifact;
};

export interface SaveArtifactFromUrlInput {
  namespace: string;
  sourceUrl: string;
  mimeType?: string;
  extension?: string;
  source?: ArtifactSource;
  expiresAt?: string;
}

export type RuntimeArtifactSaveInput = SaveArtifactInput | SaveArtifactFromUrlInput;

export type RuntimeArtifactListInput = ArtifactNamespaceOptions;

export type ArtifactListResult = RuntimeServiceEnvelope & {
  artifacts: StoredArtifact[];
};

export type RuntimeArtifactGetInput = ArtifactNamespaceOptions & {
  id: string;
};

export type RuntimeArtifactGetResult = RuntimeServiceEnvelope & {
  artifact?: StoredArtifact;
  bodyBase64?: string;
};

export type RuntimeArtifactCleanupInput = ArtifactNamespaceOptions & {
  now?: string;
};

export type ArtifactCleanupResult = RuntimeServiceEnvelope & {
  deleted: StoredArtifact[];
};

export type RecordUpsertResult = RuntimeServiceEnvelope & {
  record?: RuntimeRecord;
};

export type RecordGetResult = RuntimeServiceEnvelope & {
  record?: RuntimeRecord;
};

export type RecordQueryResult = RuntimeServiceEnvelope & {
  records: RuntimeRecord[];
};

export type RecordDeleteResult = RuntimeServiceEnvelope & {
  deleted?: RuntimeRecord;
};

export type RuntimeVectorUpsertInput = VectorIndexRecord & {
  tableName: string;
};

export type VectorUpsertResult = RuntimeServiceEnvelope & {
  id?: string;
};

export type VectorSearchResultEnvelope = RuntimeServiceEnvelope & {
  results: VectorSearchResult[];
};

export type ResourcesListResult = RuntimeServiceEnvelope & {
  resources: ResourceRequirement[];
};

export interface RuntimeServices {
  language: {
    complete(input: { input: string }): Promise<LanguageCompleteResult>;
  };
  embedding: {
    create(input: { input: string | unknown[] }): Promise<EmbeddingCreateResult>;
  };
  vision: {
    generateImage(input: { prompt: string }): Promise<VisionGenerateImageResult>;
  };
  artifact: {
    save(input: RuntimeArtifactSaveInput): Promise<ArtifactSaveResult>;
    get(input: RuntimeArtifactGetInput): Promise<RuntimeArtifactGetResult>;
    list(input: RuntimeArtifactListInput): Promise<ArtifactListResult>;
    cleanupExpired(input: RuntimeArtifactCleanupInput): Promise<ArtifactCleanupResult>;
  };
  record: {
    upsert(input: RuntimeRecordUpsertInput): Promise<RecordUpsertResult>;
    get(input: RuntimeRecordGetInput): Promise<RecordGetResult>;
    query(input: RuntimeRecordQueryInput): Promise<RecordQueryResult>;
    delete(input: RuntimeRecordDeleteInput): Promise<RecordDeleteResult>;
  };
  memory: {
    event: {
      append(input: RuntimeMemoryEventAppendInput): Promise<MemoryEventAppendResult>;
      get(input: RuntimeMemoryEventGetInput): Promise<MemoryEventGetResult>;
      list(input: RuntimeMemoryEventListInput): Promise<MemoryEventListResult>;
    };
    claim: {
      upsert(input: RuntimeMemoryClaimUpsertInput): Promise<MemoryClaimUpsertResult>;
      get(input: RuntimeMemoryClaimGetInput): Promise<MemoryClaimGetResult>;
      query(input: RuntimeMemoryClaimQueryInput): Promise<MemoryClaimQueryResult>;
    };
    relation: {
      upsert(input: RuntimeMemoryRelationUpsertInput): Promise<MemoryRelationUpsertResult>;
      query(input: RuntimeMemoryRelationQueryInput): Promise<MemoryRelationQueryResult>;
    };
    context: {
      retrieve(input: RuntimeMemoryContextRetrieveInput): Promise<MemoryContextRetrieveResult>;
    };
  };
  vector: {
    upsert(input: RuntimeVectorUpsertInput): Promise<VectorUpsertResult>;
    search(input: ({ embedding: number[] } | { query: string }) & VectorSearchOptions): Promise<VectorSearchResultEnvelope>;
  };
  resources: {
    list(): Promise<ResourcesListResult>;
    doctor(): Promise<ResourcesListResult>;
    smoke(input?: { module?: ModelModuleId | 'all' }): Promise<ResourcesListResult>;
    status(): Promise<ResourcesListResult>;
  };
}

export interface RuntimeServicesConfig {
  runtimeHome?: string;
  modelConfig?: ModelProviderConfig;
  runtime?: ModelRuntimeSecretOptions;
  fetch?: RuntimeModelFetch;
  providerConfig?: RuntimeProviderConfig;
  ports?: RuntimeProviderPorts;
  modelGateway?: ModelGateway;
  artifactStore?: ArtifactStorePort;
  recordStore?: RecordStorePort;
  memoryStore?: MemoryStorePort;
  vectorStore?: VectorStore;
  vectorIndex?: VectorStore;
  env?: Record<string, string | undefined>;
  availableSecretIds?: ReadonlySet<string>;
}

export function createRuntimeServices(config: RuntimeServicesConfig = {}): RuntimeServices {
  const servicePaths = config.runtimeHome ? createRuntimeServicePaths(config.runtimeHome) : defaultPaths;
  const secretPaths = {
    secretsFile: servicePaths.secretsFile,
    keystoreSaltFile: servicePaths.keystoreSaltFile,
  };
  const modelConfig = config.modelConfig ?? createDefaultModelProviderConfig();
  const runtime = {
    ...config.runtime,
    env: config.runtime?.env ?? config.env ?? process.env,
    getSecret: config.runtime?.getSecret ?? ((id: string) => getSecret(id, secretPaths)),
  };
  const configuredPorts = config.providerConfig
    ? createRuntimeProviderPortsFromConfig(config.providerConfig, {
      runtimeHome: config.runtimeHome,
      fetch: config.fetch,
    })
    : undefined;
  const ports = {
    ...(configuredPorts ?? {}),
    ...(config.ports ?? {}),
  };
  const modelGatewayIsInjected = Boolean(ports.modelGateway ?? config.modelGateway);
  const modelGateway = ports.modelGateway ?? config.modelGateway ?? createModelGateway(modelConfig, {
    fetch: config.fetch,
    runtime,
  });
  const objectStore = ports.objectStore ?? createLocalObjectStore({
    artifactsDir: servicePaths.artifactsDir,
  });
  const artifactManifestStore = ports.artifactManifestStore ?? createSqliteArtifactManifestStore({
    manifestDbPath: servicePaths.artifactManifestDb,
  });
  const artifactStoreIsInjected = Boolean(
    ports.artifactStore
    ?? config.artifactStore
    ?? ports.objectStore
    ?? ports.artifactManifestStore,
  );
  const artifactStore: ArtifactStorePort = ports.artifactStore ?? config.artifactStore ?? (
    artifactStoreIsInjected
      ? createArtifactStore({
        objectStore,
        manifestStore: artifactManifestStore,
      })
      : createLocalArtifactStore({
        artifactsDir: servicePaths.artifactsDir,
        manifestDbPath: servicePaths.artifactManifestDb,
      })
  );
  const vectorStoreIsInjected = Boolean(ports.vectorStore ?? config.vectorStore ?? config.vectorIndex);
  const vectorStore: VectorStore = ports.vectorStore ?? config.vectorStore ?? config.vectorIndex ?? createVectorIndex({
    vectorDir: servicePaths.vectorDir,
  });
  const recordStoreIsInjected = Boolean(ports.recordStore ?? config.recordStore);
  const recordStore: RecordStorePort = ports.recordStore ?? config.recordStore ?? createSqliteRecordStore({
    recordDbPath: servicePaths.recordStoreDb,
  });
  const memoryStoreIsInjected = Boolean(ports.memoryStore ?? config.memoryStore);
  const memoryStore: MemoryStorePort = ports.memoryStore ?? config.memoryStore ?? createSqliteMemoryStore({
    memoryDbPath: servicePaths.memoryStoreDb,
  });
  const artifactProviderId = artifactStore.providerId ?? ARTIFACT_PROVIDER;
  const recordProviderId = recordStore.providerId ?? RECORD_PROVIDER;
  const memoryProviderId = memoryStore.providerId ?? MEMORY_PROVIDER;
  const vectorProviderId = vectorStore.providerId ?? VECTOR_PROVIDER;
  const memoryEmbeddingModuleIds = selectedModuleIds(modelConfig, 'embedding');
  const memoryService = createMemoryService({
    memoryStore,
    vectorStore,
    modelGateway,
    memoryProviderId,
    vectorProviderId,
    embeddingFailureProviderId: modelFailureProviderId(
      modelGatewayIsInjected,
      modelGateway,
      memoryEmbeddingModuleIds.providerId,
    ),
    embeddingModelId: memoryEmbeddingModuleIds.modelId,
  });

  const resources = async () => createResourceCatalog(await resourceOverrides(modelConfig, {
    env: runtime.env,
    availableSecretIds: config.availableSecretIds ?? new Set(await listSecretIds(secretPaths).catch(() => [])),
    runtimeHome: config.runtimeHome,
    providerPorts: ports,
    injectedProviders: {
      modelGateway: ports.modelGateway ?? config.modelGateway,
      artifactStore: artifactStoreIsInjected ? artifactStore : undefined,
      recordStore: recordStoreIsInjected ? recordStore : undefined,
      memoryStore: memoryStoreIsInjected ? memoryStore : undefined,
      vectorStore: vectorStoreIsInjected ? vectorStore : undefined,
    },
  }));

  return {
    language: {
      complete: async (input) => {
        const ids = selectedModuleIds(modelConfig, 'language');
        try {
          assertLanguageCompleteInput(input);
          const result = await modelGateway.complete(input);
          return {
            ...okEnvelope('language.complete', result.providerId, result.modelId, [
              { kind: 'model_response', message: `textChars=${result.text.length}` },
            ]),
            proposal: { kind: 'text', text: result.text, raw: result.raw },
          };
        } catch (error) {
          return modelFailureEnvelope('language.complete', modelFailureProviderId(modelGatewayIsInjected, modelGateway, ids.providerId), ids.modelId, error);
        }
      },
    },
    embedding: {
      create: async (input) => {
        const ids = selectedModuleIds(modelConfig, 'embedding');
        try {
          assertEmbeddingCreateInput(input);
          const result = await modelGateway.createEmbedding(input);
          return {
            ...okEnvelope('embedding.create', result.providerId, result.modelId, [
              { kind: 'embedding', message: `dimensions=${result.embedding.length}` },
            ]),
            embedding: result.embedding,
          };
        } catch (error) {
          return modelFailureEnvelope('embedding.create', modelFailureProviderId(modelGatewayIsInjected, modelGateway, ids.providerId), ids.modelId, error);
        }
      },
    },
    vision: {
      generateImage: async (input) => {
        const ids = selectedModuleIds(modelConfig, 'vision');
        try {
          assertVisionGenerateImageInput(input);
          const result = await modelGateway.generateImage(input);
          return {
            ...okEnvelope('vision.generateImage', result.providerId, result.modelId, [
              { kind: 'image_generation', message: result.url ? 'url' : result.b64Json ? 'base64' : 'unknown' },
            ]),
            artifact: {
              kind: 'image',
              ...(result.url ? { url: result.url } : {}),
              ...(result.b64Json ? { b64Json: result.b64Json } : {}),
              raw: result.raw,
            },
          };
        } catch (error) {
          return modelFailureEnvelope('vision.generateImage', modelFailureProviderId(modelGatewayIsInjected, modelGateway, ids.providerId), ids.modelId, error);
        }
      },
    },
    artifact: {
      save: async (input) => {
        try {
          assertRequiredStorageName(input?.namespace, 'namespace');
          const artifactInput = await resolveArtifactSaveInput(input, config.fetch);
          return {
            ...okEnvelope('artifact.save', artifactProviderId, 'not-applicable', [
              { kind: 'artifact_store', message: servicePaths.artifactsDir },
            ]),
            artifact: await artifactStore.save(artifactInput),
          };
        } catch (error) {
          return failedEnvelope('artifact.save', artifactProviderId, 'not-applicable', error);
        }
      },
      list: async (input) => {
        try {
          assertRequiredStorageName(input?.namespace, 'namespace');
          return {
            ...okEnvelope('artifact.list', artifactProviderId, 'not-applicable', []),
            artifacts: await artifactStore.list(input),
          };
        } catch (error) {
          return {
            ...failedEnvelope('artifact.list', artifactProviderId, 'not-applicable', error),
            artifacts: [],
          };
        }
      },
      get: async (input) => {
        try {
          assertRequiredStorageName(input?.namespace, 'namespace');
          assertRequiredStorageName(input?.id, 'id');
          const result = await artifactStore.get({
            namespace: input.namespace,
            id: input.id,
          });
          return {
            ...okEnvelope('artifact.get', artifactProviderId, 'not-applicable', [
              { kind: 'artifact_store', message: result.artifact.id },
            ]),
            artifact: result.artifact,
            bodyBase64: Buffer.from(result.body).toString('base64'),
          };
        } catch (error) {
          return failedEnvelope('artifact.get', artifactProviderId, 'not-applicable', error);
        }
      },
      cleanupExpired: async (input) => {
        try {
          assertRequiredStorageName(input?.namespace, 'namespace');
          const now = parseOptionalDateString(input?.now, 'now');
          const result = await artifactStore.cleanupExpired({
            namespace: input.namespace,
            ...(now ? { now } : {}),
          });
          return {
            ...okEnvelope('artifact.cleanupExpired', artifactProviderId, 'not-applicable', [
              { kind: 'artifact_cleanup', message: `deleted=${result.deleted.length}` },
            ]),
            deleted: result.deleted,
          };
        } catch (error) {
          return {
            ...failedEnvelope('artifact.cleanupExpired', artifactProviderId, 'not-applicable', error),
            deleted: [],
          };
        }
      },
    },
    record: {
      upsert: async (input) => {
        try {
          assertRequiredStorageName(input?.namespace, 'namespace');
          assertRequiredStorageName(input?.tableName, 'tableName');
          assertRequiredStorageName(input?.id, 'id');
          assertJsonObject(input?.data, 'data');
          if (input.metadata !== undefined) assertJsonObject(input.metadata, 'metadata');
          return {
            ...okEnvelope('record.upsert', recordProviderId, 'not-applicable', [
              { kind: 'record_store', message: `${input.namespace}/${input.tableName}/${input.id}` },
            ]),
            record: await recordStore.upsert(input),
          };
        } catch (error) {
          return failedEnvelope('record.upsert', recordProviderId, 'not-applicable', error);
        }
      },
      get: async (input) => {
        try {
          assertRequiredStorageName(input?.namespace, 'namespace');
          assertRequiredStorageName(input?.tableName, 'tableName');
          assertRequiredStorageName(input?.id, 'id');
          return {
            ...okEnvelope('record.get', recordProviderId, 'not-applicable', []),
            record: await recordStore.get(input),
          };
        } catch (error) {
          return failedEnvelope('record.get', recordProviderId, 'not-applicable', error);
        }
      },
      query: async (input) => {
        try {
          assertRequiredStorageName(input?.namespace, 'namespace');
          assertRequiredStorageName(input?.tableName, 'tableName');
          assertOptionalLimit(input?.limit, 'limit');
          return {
            ...okEnvelope('record.query', recordProviderId, 'not-applicable', []),
            records: await recordStore.query(input),
          };
        } catch (error) {
          return {
            ...failedEnvelope('record.query', recordProviderId, 'not-applicable', error),
            records: [],
          };
        }
      },
      delete: async (input) => {
        try {
          assertRequiredStorageName(input?.namespace, 'namespace');
          assertRequiredStorageName(input?.tableName, 'tableName');
          assertRequiredStorageName(input?.id, 'id');
          return {
            ...okEnvelope('record.delete', recordProviderId, 'not-applicable', [
              { kind: 'record_store', message: `${input.namespace}/${input.tableName}/${input.id}` },
            ]),
            deleted: await recordStore.delete(input),
          };
        } catch (error) {
          return failedEnvelope('record.delete', recordProviderId, 'not-applicable', error);
        }
      },
    },
    memory: memoryService,
    vector: {
      upsert: async (input) => {
        try {
          assertVectorUpsertInput(input);
          const { tableName, ...record } = input;
          await vectorStore.upsert(record, { tableName });
          return {
            ...okEnvelope('vector.upsert', vectorProviderId, 'not-applicable', [
              { kind: 'vector_index', message: input.id },
            ]),
            id: input.id,
          };
        } catch (error) {
          return failedEnvelope('vector.upsert', vectorProviderId, 'not-applicable', error);
        }
      },
      search: async (input) => {
        let filter: VectorSearchOptions['filter'];
        try {
          assertVectorSearchInput(input);
          filter = normalizeVectorSearchFilter(input.filter);
        } catch (error) {
          return {
            ...failedEnvelope('vector.search', vectorProviderId, 'not-applicable', error),
            results: [],
          };
        }
        if (input.limit === 0) {
          return {
            ...okEnvelope('vector.search', vectorProviderId, 'not-applicable', []),
            results: [],
          };
        }

        let embedding: number[];
        if ('embedding' in input) {
          embedding = input.embedding;
        } else {
          const ids = selectedModuleIds(modelConfig, 'embedding');
          try {
            embedding = await embeddingFromQuery(input.query);
          } catch (error) {
            return {
              ...modelFailureEnvelope(
                'vector.search',
                modelFailureProviderId(modelGatewayIsInjected, modelGateway, ids.providerId),
                ids.modelId,
                error,
              ),
              results: [],
            };
          }
        }

        try {
          return {
            ...okEnvelope('vector.search', vectorProviderId, 'not-applicable', []),
            results: await vectorStore.search(embedding, {
              limit: input.limit,
              tableName: input.tableName,
              ...(filter ? { filter } : {}),
            }),
          };
        } catch (error) {
          return {
            ...failedEnvelope('vector.search', vectorProviderId, 'not-applicable', error),
            results: [],
          };
        }
      },
    },
    resources: {
      list: async () => resourceStatus('resources.list', (await resources()).list()),
      doctor: async () => resourceStatus('resources.doctor', (await resources()).list()),
      smoke: async (input) => resourceStatus('resources.smoke', smokeResources((await resources()).list(), input?.module)),
      status: async () => resourceStatus('resources.status', (await resources()).list()),
    },
  };

  async function embeddingFromQuery(query: string): Promise<number[]> {
    const result = await modelGateway.createEmbedding({ input: query });
    return result.embedding;
  }
}

async function resolveArtifactSaveInput(
  input: RuntimeArtifactSaveInput,
  fetchImpl: RuntimeModelFetch | undefined,
): Promise<SaveArtifactInput> {
  const body = (input as { body?: unknown }).body;
  const expiresAt = parseOptionalDateString(input.expiresAt, 'expiresAt');
  if (body !== undefined) {
    assertArtifactBody(body);
    assertRequiredString((input as { mimeType?: string }).mimeType, 'mimeType');
    return {
      ...(input as SaveArtifactInput),
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
    };
  }
  if (!('sourceUrl' in input) || !input.sourceUrl) {
    throw new Error('artifact.save requires either body with mimeType or sourceUrl');
  }
  const response = await (fetchImpl ?? fetch)(input.sourceUrl, { method: 'GET' });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`artifact source download failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return {
    namespace: input.namespace,
    body: new Uint8Array(await response.arrayBuffer()),
    mimeType: input.mimeType ?? response.headers.get('Content-Type') ?? 'application/octet-stream',
    ...(input.extension ? { extension: input.extension } : {}),
    ...(input.source ? { source: input.source } : {}),
    sourceUrl: input.sourceUrl,
    ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
  };
}

async function resourceOverrides(
  modelConfig: ModelProviderConfig,
  options: {
    env: Record<string, string | undefined> | undefined;
    availableSecretIds: ReadonlySet<string> | undefined;
    runtimeHome: string | undefined;
    providerPorts: RuntimeProviderPorts | undefined;
    injectedProviders: {
      modelGateway: ModelGateway | undefined;
      artifactStore: ArtifactStorePort | undefined;
      recordStore: RecordStorePort | undefined;
      memoryStore: MemoryStorePort | undefined;
      vectorStore: VectorStore | undefined;
    };
  },
): Promise<ResourceOverride[]> {
  const overrides: ResourceOverride[] = [
    ...modelProviderResourceOverrides(modelConfig, options.env, options.availableSecretIds ?? new Set()),
  ];
  if (options.injectedProviders.modelGateway) {
    overrides.push(
      await providerProbeResourceOverride(
        'model.language_completion',
        options.injectedProviders.modelGateway,
        'custom-model-gateway',
        'model-gateway',
      ),
      await providerProbeResourceOverride(
        'model.embedding',
        options.injectedProviders.modelGateway,
        'custom-model-gateway',
        'model-gateway',
      ),
      await providerProbeResourceOverride(
        'model.image_generation',
        options.injectedProviders.modelGateway,
        'custom-model-gateway',
        'model-gateway',
      ),
    );
  }
  const servicePaths = options.runtimeHome ? createRuntimeServicePaths(options.runtimeHome) : defaultPaths;
  const artifactOverride = options.injectedProviders.artifactStore
    ? await providerProbeResourceOverride(
      'storage.artifact_store',
      options.injectedProviders.artifactStore,
      'custom-artifact-store',
      'artifact-store',
    )
    : localArtifactStoreResourceOverride({
      artifactsDir: servicePaths.artifactsDir,
      manifestDbPath: servicePaths.artifactManifestDb,
    });
  if (artifactOverride) overrides.push(artifactOverride);
  const recordOverride = options.injectedProviders.recordStore
    ? await providerProbeResourceOverride(
      'storage.record_store',
      options.injectedProviders.recordStore,
      'custom-record-store',
      'record-store',
    )
    : localRecordStoreResourceOverride({
      recordDbPath: servicePaths.recordStoreDb,
    });
  if (recordOverride) overrides.push(recordOverride);
  const memoryOverride = options.injectedProviders.memoryStore
    ? await providerProbeResourceOverride(
      'storage.memory_store',
      options.injectedProviders.memoryStore,
      'custom-memory-store',
      'memory-store',
    )
    : localMemoryStoreResourceOverride({
      memoryDbPath: servicePaths.memoryStoreDb,
    });
  if (memoryOverride) overrides.push(memoryOverride);
  const vectorOverride = options.injectedProviders.vectorStore
    ? await providerProbeResourceOverride(
      'storage.vector_index',
      options.injectedProviders.vectorStore,
      'custom-vector-store',
      'vector-store',
    )
    : localVectorIndexResourceOverride({
      vectorDir: servicePaths.vectorDir,
    });
  if (vectorOverride) overrides.push(vectorOverride);
  overrides.push(...await (options.providerPorts?.resourceOverrides?.() ?? []));
  return overrides;
}

function providerResourceOverride(id: string, providerId: string | undefined, fallbackProviderId: string): ResourceOverride {
  return {
    id,
    status: 'available' satisfies ResourceStatus,
    provider: providerId ?? fallbackProviderId,
  };
}

function modelFailureProviderId(isInjected: boolean, modelGateway: ModelGateway, selectedProviderId: string): string {
  return isInjected ? modelGateway.providerId ?? selectedProviderId : selectedProviderId;
}

async function providerProbeResourceOverride(
  id: string,
  provider: ProviderPort,
  fallbackProviderId: string,
  kind: string,
): Promise<ResourceOverride> {
  if (!provider.probe) return providerResourceOverride(id, provider.providerId, fallbackProviderId);
  try {
    const result = await provider.probe({ resourceId: id, kind });
    return {
      id,
      status: result.status,
      provider: result.providerId ?? provider.providerId ?? fallbackProviderId,
      ...(result.evidence ? { evidence: result.evidence } : {}),
    };
  } catch (error) {
    return {
      id,
      status: 'stubbed',
      provider: provider.providerId ?? fallbackProviderId,
      evidence: [{ kind: 'provider_probe', message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

function selectedModuleIds(config: ModelProviderConfig, moduleId: ModelModuleId): {
  providerId: string;
  modelId: string;
} {
  const module = config.modules[moduleId];
  return {
    providerId: module.providerId,
    modelId: module.selectedModel,
  };
}

function okEnvelope(
  capabilityId: string,
  providerId: string,
  modelId: string,
  evidence: RuntimeServiceEvidence[],
): RuntimeServiceEnvelope {
  return { status: 'ok', capabilityId, providerId, modelId, evidence };
}

function missingEnvelope(
  capabilityId: string,
  providerId: string,
  modelId: string,
  message: string,
): RuntimeServiceEnvelope {
  return {
    status: 'missing_resource',
    capabilityId,
    providerId,
    modelId,
    evidence: [{ kind: 'missing_resource', message }],
  };
}

function failedEnvelope(
  capabilityId: string,
  providerId: string,
  modelId: string,
  error: unknown,
): RuntimeServiceEnvelope {
  return {
    status: 'failed',
    capabilityId,
    providerId,
    modelId,
    evidence: [{ kind: 'error', message: error instanceof Error ? error.message : String(error) }],
  };
}

function modelFailureEnvelope(
  capabilityId: string,
  providerId: string,
  modelId: string,
  error: unknown,
): RuntimeServiceEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('runtime service model is not configured') || message.includes('missing API key')) {
    return missingEnvelope(capabilityId, providerId, modelId, message);
  }
  return failedEnvelope(capabilityId, providerId, modelId, error);
}

function resourceStatus(capabilityId: string, resources: ResourceRequirement[]): ResourcesListResult {
  return {
    ...okEnvelope(capabilityId, 'local-runtime-services', 'not-applicable', [
      { kind: 'resource_count', message: String(resources.length) },
    ]),
    resources,
  };
}

function smokeResources(resources: ResourceRequirement[], module: ModelModuleId | 'all' | undefined): ResourceRequirement[] {
  if (!module || module === 'all') return resources;
  const resourceId = {
    language: 'model.language_completion',
    embedding: 'model.embedding',
    vision: 'model.image_generation',
  } satisfies Record<ModelModuleId, string>;
  return resources.filter((resource) => resource.id === resourceId[module]);
}

const ARTIFACT_PROVIDER = 'local-fs+sqlite';
const RECORD_PROVIDER = 'local-sqlite-record';
const MEMORY_PROVIDER = 'local-sqlite-memory';
const VECTOR_PROVIDER = 'local-lancedb';

function assertRequiredStorageName(value: unknown, label: string): void {
  if (value === undefined || value === null || value === '') throw new Error(`${label} is required`);
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(trimmed)) {
    throw new Error(`${label} must match /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/`);
  }
}

function assertRequiredString(value: unknown, label: string): void {
  if (value === undefined || value === null || value === '') throw new Error(`${label} is required`);
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (!value.trim()) throw new Error(`${label} is required`);
}

function assertOptionalString(value: unknown, label: string): void {
  if (value === undefined) return;
  assertRequiredString(value, label);
}

function assertJsonObject(value: unknown, label: string): void {
  if (value === undefined) throw new Error(`${label} is required`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
}

function assertOptionalJsonObject(value: unknown, label: string): void {
  if (value === undefined) return;
  assertJsonObject(value, label);
}

function assertLanguageCompleteInput(input: { input: string } | undefined): void {
  assertRequiredString(input?.input, 'input');
}

function assertEmbeddingCreateInput(input: { input: string | unknown[] } | undefined): void {
  const value = input?.input;
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((item) => typeof item === 'string' && item.trim())) return;
    throw new Error('input must be a string or a non-empty array of strings');
  }
  assertRequiredString(value, 'input');
}

function assertVisionGenerateImageInput(input: { prompt: string } | undefined): void {
  assertRequiredString(input?.prompt, 'prompt');
}

function assertVectorUpsertInput(input: RuntimeVectorUpsertInput | undefined): void {
  assertRequiredStorageName(input?.tableName, 'tableName');
  assertRequiredStorageName(input?.id, 'id');
  assertRequiredString(input?.content, 'content');
  assertEmbeddingVector(input?.embedding, 'embedding');
  assertOptionalJsonObject(input?.metadata, 'metadata');
}

function assertVectorSearchInput(input: (({ embedding: number[] } | { query: string }) & VectorSearchOptions) | undefined): void {
  assertRequiredStorageName(input?.tableName, 'tableName');
  const hasEmbedding = Boolean(input && 'embedding' in input);
  const hasQuery = Boolean(input && 'query' in input);
  if (hasEmbedding === hasQuery) throw new Error('vector.search requires exactly one of embedding or query');
  if (hasEmbedding) {
    assertEmbeddingVector((input as { embedding?: unknown }).embedding, 'embedding');
  } else {
    assertRequiredString((input as { query?: string }).query, 'query');
  }
  assertOptionalLimit(input?.limit, 'limit');
}

function assertOptionalLimit(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite number greater than or equal to 0`);
  }
}

function parseOptionalDateString(value: string | undefined, label: string): Date | undefined {
  if (value === undefined) return undefined;
  if (!value.trim()) throw new Error(`${label} must be a valid date string`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date string`);
  return date;
}

function assertEmbeddingVector(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !Number.isFinite(item))) {
    throw new Error(`${label} must contain finite numbers`);
  }
}

function assertArtifactBody(value: unknown): void {
  if (
    typeof value === 'string'
    || value instanceof Uint8Array
    || (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255))
  ) {
    return;
  }
  throw new Error('body must be a string, Uint8Array, or byte array');
}

export { MODEL_MODULE_IDS };
export type { RuntimeServiceCapabilityId };
export type {
  MemoryClaimGetResult,
  MemoryClaimQueryResult,
  MemoryClaimUpsertResult,
  MemoryContextRetrieveResult,
  MemoryEventAppendResult,
  MemoryEventGetResult,
  MemoryEventListResult,
  MemoryRelationQueryResult,
  MemoryRelationUpsertResult,
  RuntimeMemoryContextBundle,
  RuntimeMemoryContextRetrieveInput,
} from './services/memory';
export {
  RUNTIME_SERVICE_AGENT_SERVICE_CAPABILITIES,
  RUNTIME_SERVICE_CAPABILITIES,
  RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS,
  getRuntimeServiceCapabilityDescriptor,
  type RuntimeServiceCapabilityDescriptor,
  type RuntimeServiceConsumer,
  type RuntimeServiceLayer,
  type RuntimeServiceRpcMethodId,
  type RuntimeServiceRiskClass,
} from './capabilities/registry';
