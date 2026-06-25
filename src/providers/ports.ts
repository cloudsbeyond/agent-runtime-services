import type {
  EmbeddingResult,
  ImageGenerationResult,
  LanguageModelResult,
} from '../models/client';
import type { ResourceEvidence, ResourceOverride, ResourceStatus } from '../resources/catalog';
import type {
  ArtifactBody,
  ArtifactCleanupOptions,
  ArtifactNamespaceOptions,
  SaveArtifactInput,
  StoredArtifact,
} from '../storage/artifact-store';
import type {
  RuntimeRecord,
  RuntimeRecordDeleteInput,
  RuntimeRecordGetInput,
  RuntimeRecordQueryInput,
  RuntimeRecordUpsertInput,
} from '../storage/record-store';
import type {
  RuntimeMemoryClaim,
  RuntimeMemoryClaimGetInput,
  RuntimeMemoryClaimQueryInput,
  RuntimeMemoryClaimUpsertInput,
  RuntimeMemoryEvent,
  RuntimeMemoryEventAppendInput,
  RuntimeMemoryEventGetInput,
  RuntimeMemoryEventListInput,
  RuntimeMemoryRelation,
  RuntimeMemoryRelationQueryInput,
  RuntimeMemoryRelationUpsertInput,
} from '../storage/memory-store';
import type {
  VectorIndexOperationOptions,
  VectorIndexRecord,
  VectorSearchOptions,
  VectorSearchResult,
} from '../storage/vector-index';

export interface ProviderPort {
  providerId?: string;
  probe?(input?: ProviderProbeInput): Promise<ProviderProbeResult>;
}

export interface ProviderProbeInput {
  resourceId?: string;
  kind?: string;
}

export interface ProviderProbeResult {
  status: ResourceStatus;
  providerId?: string;
  evidence?: ResourceEvidence[];
}

export interface ModelGateway extends ProviderPort {
  complete(input: { input: string }): Promise<LanguageModelResult>;
  createEmbedding(input: { input: string | unknown[] }): Promise<EmbeddingResult>;
  generateImage(input: { prompt: string }): Promise<ImageGenerationResult>;
}

export interface ArtifactStorePort extends ProviderPort {
  save(input: SaveArtifactInput): Promise<StoredArtifact>;
  get(input: ArtifactGetInput): Promise<ArtifactGetResult>;
  list(options: ArtifactNamespaceOptions): Promise<StoredArtifact[]>;
  cleanupExpired(options: ArtifactCleanupOptions): Promise<{ deleted: StoredArtifact[] }>;
}

export interface ArtifactGetInput {
  namespace: string;
  id: string;
}

export interface ArtifactGetResult {
  artifact: StoredArtifact;
  body: Uint8Array;
}

export interface ObjectStorePutInput {
  namespace: string;
  key: string;
  body: ArtifactBody;
  mimeType?: string;
}

export interface ObjectStorePutResult {
  path: string;
  sizeBytes: number;
}

export interface ObjectStoreDeleteInput {
  path: string;
}

export interface ObjectStoreGetInput {
  path: string;
}

export interface ObjectStorePort extends ProviderPort {
  put(input: ObjectStorePutInput): Promise<ObjectStorePutResult>;
  get(input: ObjectStoreGetInput): Promise<Uint8Array>;
  delete(input: ObjectStoreDeleteInput): Promise<void>;
}

export interface ArtifactManifestDeleteInput {
  namespace: string;
  id: string;
}

export interface ArtifactManifestStorePort extends ProviderPort {
  insert(artifact: StoredArtifact): Promise<void>;
  get(input: ArtifactGetInput): Promise<StoredArtifact>;
  list(options: ArtifactNamespaceOptions): Promise<StoredArtifact[]>;
  delete(input: ArtifactManifestDeleteInput): Promise<void>;
}

export interface RecordStorePort extends ProviderPort {
  upsert(input: RuntimeRecordUpsertInput): Promise<RuntimeRecord>;
  get(input: RuntimeRecordGetInput): Promise<RuntimeRecord>;
  query(input: RuntimeRecordQueryInput): Promise<RuntimeRecord[]>;
  delete(input: RuntimeRecordDeleteInput): Promise<RuntimeRecord>;
}

export interface MemoryStorePort extends ProviderPort {
  appendEvent(input: RuntimeMemoryEventAppendInput): Promise<RuntimeMemoryEvent>;
  getEvent(input: RuntimeMemoryEventGetInput): Promise<RuntimeMemoryEvent>;
  listEvents(input: RuntimeMemoryEventListInput): Promise<RuntimeMemoryEvent[]>;
  upsertClaim(input: RuntimeMemoryClaimUpsertInput): Promise<RuntimeMemoryClaim>;
  getClaim(input: RuntimeMemoryClaimGetInput): Promise<RuntimeMemoryClaim>;
  queryClaims(input: RuntimeMemoryClaimQueryInput): Promise<RuntimeMemoryClaim[]>;
  upsertRelation(input: RuntimeMemoryRelationUpsertInput): Promise<RuntimeMemoryRelation>;
  queryRelations(input: RuntimeMemoryRelationQueryInput): Promise<RuntimeMemoryRelation[]>;
}

export interface VectorStore extends ProviderPort {
  upsert(record: VectorIndexRecord, options: VectorIndexOperationOptions): Promise<void>;
  search(queryEmbedding: number[], options: VectorSearchOptions): Promise<VectorSearchResult[]>;
}

export interface RuntimeProviderPorts {
  modelGateway?: ModelGateway;
  objectStore?: ObjectStorePort;
  artifactManifestStore?: ArtifactManifestStorePort;
  artifactStore?: ArtifactStorePort;
  recordStore?: RecordStorePort;
  memoryStore?: MemoryStorePort;
  vectorStore?: VectorStore;
  resourceOverrides?: () => ResourceOverride[] | Promise<ResourceOverride[]>;
}
