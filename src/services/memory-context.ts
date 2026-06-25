import type { MemoryStorePort, ModelGateway, VectorStore } from '../providers/ports';
import type {
  RuntimeMemoryClaim,
  RuntimeMemoryEvent,
  RuntimeMemoryJson,
  RuntimeMemoryReference,
  RuntimeMemoryRelation,
} from '../storage/memory-store';
import {
  normalizeVectorSearchFilter,
  type VectorSearchOptions,
  type VectorSearchResult,
} from '../storage/vector-index';

export interface RuntimeMemoryContextBundle {
  candidates: VectorSearchResult[];
  claims: RuntimeMemoryClaim[];
  events: RuntimeMemoryEvent[];
  relations: RuntimeMemoryRelation[];
  policy: {
    objects: Array<{
      kind: string;
      id: string;
      policy: RuntimeMemoryJson;
    }>;
  };
}

export type RuntimeMemoryContextRetrieveInput = ({
  embedding: number[];
} | {
  query: string;
}) & {
  namespace: string;
  tableName: string;
  limit?: number;
  relationshipLimit?: number;
  filter?: VectorSearchOptions['filter'];
};

export type MemoryContextRetrieveResult = MemoryContextServiceEnvelope & {
  bundle: RuntimeMemoryContextBundle;
};

export interface MemoryContextServiceOptions {
  memoryStore: MemoryStorePort;
  vectorStore: VectorStore;
  modelGateway: Pick<ModelGateway, 'createEmbedding'>;
  contextProviderId: string;
  embeddingFailureProviderId: string;
  embeddingModelId: string;
}

interface MemoryContextServiceEnvelope {
  status: 'ok' | 'missing_resource' | 'failed';
  capabilityId: 'memory.context.retrieve';
  providerId: string;
  modelId: string;
  evidence: Array<{
    kind: string;
    message?: string;
    data?: unknown;
  }>;
}

export function createMemoryContextService(options: MemoryContextServiceOptions): {
  retrieve(input: RuntimeMemoryContextRetrieveInput): Promise<MemoryContextRetrieveResult>;
} {
  return {
    retrieve: async (input) => {
      const emptyBundle = (): RuntimeMemoryContextBundle => ({
        candidates: [],
        claims: [],
        events: [],
        relations: [],
        policy: { objects: [] },
      });
      let filter: VectorSearchOptions['filter'];
      try {
        assertMemoryContextRetrieveInput(input);
        filter = memoryNamespaceVectorFilter(input.namespace, normalizeVectorSearchFilter(input.filter));
      } catch (error) {
        return {
          ...failedEnvelope(options.contextProviderId, 'not-applicable', error),
          bundle: emptyBundle(),
        };
      }
      if (input.limit === 0) {
        return {
          ...okEnvelope(options.contextProviderId, 'not-applicable', [
            { kind: 'memory_context', message: 'candidates=0' },
          ]),
          bundle: emptyBundle(),
        };
      }

      let embedding: number[];
      let modelId = 'not-applicable';
      if ('embedding' in input) {
        embedding = input.embedding;
      } else {
        try {
          const result = await options.modelGateway.createEmbedding({ input: input.query });
          embedding = result.embedding;
          modelId = result.modelId;
        } catch (error) {
          return {
            ...modelFailureEnvelope(options.embeddingFailureProviderId, options.embeddingModelId, error),
            bundle: emptyBundle(),
          };
        }
      }

      try {
        const vectorCandidates = await options.vectorStore.search(embedding, {
          tableName: input.tableName,
          limit: input.limit,
          ...(filter ? { filter } : {}),
        });
        const candidates = memoryNamespaceCandidates(input.namespace, vectorCandidates);
        const bundle = await hydrateMemoryContextBundle(
          options.memoryStore,
          input.namespace,
          candidates,
          input.relationshipLimit,
        );
        return {
          ...okEnvelope(options.contextProviderId, modelId, [
            { kind: 'memory_context', message: `candidates=${candidates.length}` },
          ]),
          bundle,
        };
      } catch (error) {
        return {
          ...failedEnvelope(options.contextProviderId, modelId, error),
          bundle: emptyBundle(),
        };
      }
    },
  };
}

async function hydrateMemoryContextBundle(
  memoryStore: MemoryStorePort,
  namespace: string,
  candidates: VectorSearchResult[],
  relationshipLimit: number | undefined,
): Promise<RuntimeMemoryContextBundle> {
  const claimIds = new Set<string>();
  const eventIds = new Set<string>();
  for (const candidate of candidates) {
    addMetadataString(candidate.metadata.claimId, claimIds);
    addMetadataString(candidate.metadata.eventId, eventIds);
  }

  const claims = await collectById([...claimIds], (id) => memoryStore.getClaim({ namespace, id }));
  const events = await collectById([...eventIds], (id) => memoryStore.getEvent({ namespace, id }));
  const references: RuntimeMemoryReference[] = [
    ...claims.map((claim) => ({ kind: 'claim', id: claim.id })),
    ...events.map((event) => ({ kind: 'event', id: event.id })),
  ];
  const relationLimit = relationshipLimit ?? 25;
  const relationsById = new Map<string, RuntimeMemoryRelation>();
  for (const reference of references) {
    const [fromRelations, toRelations] = await Promise.all([
      memoryStore.queryRelations({ namespace, from: reference, limit: relationLimit }),
      memoryStore.queryRelations({ namespace, to: reference, limit: relationLimit }),
    ]);
    for (const relation of [...fromRelations, ...toRelations]) {
      if (relationsById.size >= relationLimit && !relationsById.has(relation.id)) continue;
      relationsById.set(relation.id, relation);
      if (relation.to.kind === 'event') addMetadataString(relation.to.id, eventIds);
      if (relation.from.kind === 'event') addMetadataString(relation.from.id, eventIds);
      if (relation.to.kind === 'claim') addMetadataString(relation.to.id, claimIds);
      if (relation.from.kind === 'claim') addMetadataString(relation.from.id, claimIds);
    }
  }

  const expandedClaims = await collectById(
    [...claimIds].filter((id) => !claims.some((claim) => claim.id === id)),
    (id) => memoryStore.getClaim({ namespace, id }),
  );
  const expandedEvents = await collectById(
    [...eventIds].filter((id) => !events.some((event) => event.id === id)),
    (id) => memoryStore.getEvent({ namespace, id }),
  );
  const allClaims = [...claims, ...expandedClaims];
  const allEvents = [...events, ...expandedEvents];
  return {
    candidates,
    claims: allClaims,
    events: allEvents,
    relations: [...relationsById.values()],
    policy: {
      objects: [
        ...allClaims.map((claim) => ({ kind: 'claim', id: claim.id, policy: claim.policy })),
        ...allEvents.map((event) => ({ kind: 'event', id: event.id, policy: event.policy })),
      ],
    },
  };
}

async function collectById<T>(ids: string[], load: (id: string) => Promise<T>): Promise<T[]> {
  const loaded: T[] = [];
  for (const id of ids) {
    try {
      loaded.push(await load(id));
    } catch (error) {
      if (!isMemoryPointerNotFound(error)) throw error;
      // A retrieval bundle should remain usable when a vector metadata pointer is stale.
    }
  }
  return loaded;
}

function assertMemoryContextRetrieveInput(input: RuntimeMemoryContextRetrieveInput | undefined): void {
  assertRequiredStorageName(input?.namespace, 'namespace');
  assertRequiredStorageName(input?.tableName, 'tableName');
  const hasEmbedding = Boolean(input && 'embedding' in input);
  const hasQuery = Boolean(input && 'query' in input);
  if (hasEmbedding === hasQuery) throw new Error('memory.context.retrieve requires exactly one of embedding or query');
  if (hasEmbedding) {
    assertEmbeddingVector((input as { embedding?: unknown }).embedding, 'embedding');
  } else {
    assertRequiredString((input as { query?: string }).query, 'query');
  }
  assertOptionalLimit(input?.limit, 'limit');
  assertOptionalLimit(input?.relationshipLimit, 'relationshipLimit');
}

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

function assertOptionalLimit(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite number greater than or equal to 0`);
  }
}

function assertEmbeddingVector(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !Number.isFinite(item))) {
    throw new Error(`${label} must contain finite numbers`);
  }
}

function memoryNamespaceCandidates(namespace: string, candidates: VectorSearchResult[]): VectorSearchResult[] {
  return candidates.filter((candidate) => candidate.metadata.namespace === namespace);
}

function isMemoryPointerNotFound(error: unknown): boolean {
  return error instanceof Error
    && (
      error.message.startsWith('memory claim not found:')
      || error.message.startsWith('memory event not found:')
    );
}

function addMetadataString(value: unknown, target: Set<string>): void {
  if (typeof value === 'string' && value) target.add(value);
}

function memoryNamespaceVectorFilter(namespace: string, filter: VectorSearchOptions['filter']): VectorSearchOptions['filter'] {
  return {
    metadata: {
      ...(filter?.metadata ?? {}),
      namespace,
    },
  };
}

function okEnvelope(
  providerId: string,
  modelId: string,
  evidence: MemoryContextServiceEnvelope['evidence'],
): MemoryContextServiceEnvelope {
  return {
    status: 'ok',
    capabilityId: 'memory.context.retrieve',
    providerId,
    modelId,
    evidence,
  };
}

function missingEnvelope(providerId: string, modelId: string, message: string): MemoryContextServiceEnvelope {
  return {
    status: 'missing_resource',
    capabilityId: 'memory.context.retrieve',
    providerId,
    modelId,
    evidence: [{ kind: 'missing_resource', message }],
  };
}

function failedEnvelope(providerId: string, modelId: string, error: unknown): MemoryContextServiceEnvelope {
  return {
    status: 'failed',
    capabilityId: 'memory.context.retrieve',
    providerId,
    modelId,
    evidence: [{ kind: 'error', message: error instanceof Error ? error.message : String(error) }],
  };
}

function modelFailureEnvelope(providerId: string, modelId: string, error: unknown): MemoryContextServiceEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('runtime service model is not configured') || message.includes('missing API key')) {
    return missingEnvelope(providerId, modelId, message);
  }
  return failedEnvelope(providerId, modelId, error);
}
