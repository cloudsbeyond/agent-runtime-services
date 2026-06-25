import type { MemoryStorePort, ModelGateway, VectorStore } from '../providers/ports';
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
import {
  createMemoryContextService,
  type MemoryContextRetrieveResult,
  type RuntimeMemoryContextBundle,
  type RuntimeMemoryContextRetrieveInput,
} from './memory-context';

export type {
  MemoryContextRetrieveResult,
  RuntimeMemoryContextBundle,
  RuntimeMemoryContextRetrieveInput,
} from './memory-context';

export interface RuntimeMemoryServiceEnvelope {
  status: 'ok' | 'missing_resource' | 'failed';
  capabilityId: string;
  providerId: string;
  modelId: string;
  evidence: Array<{
    kind: string;
    message?: string;
    data?: unknown;
  }>;
}

export type MemoryEventAppendResult = RuntimeMemoryServiceEnvelope & {
  event?: RuntimeMemoryEvent;
};

export type MemoryEventGetResult = RuntimeMemoryServiceEnvelope & {
  event?: RuntimeMemoryEvent;
};

export type MemoryEventListResult = RuntimeMemoryServiceEnvelope & {
  events: RuntimeMemoryEvent[];
};

export type MemoryClaimUpsertResult = RuntimeMemoryServiceEnvelope & {
  claim?: RuntimeMemoryClaim;
};

export type MemoryClaimGetResult = RuntimeMemoryServiceEnvelope & {
  claim?: RuntimeMemoryClaim;
};

export type MemoryClaimQueryResult = RuntimeMemoryServiceEnvelope & {
  claims: RuntimeMemoryClaim[];
};

export type MemoryRelationUpsertResult = RuntimeMemoryServiceEnvelope & {
  relation?: RuntimeMemoryRelation;
};

export type MemoryRelationQueryResult = RuntimeMemoryServiceEnvelope & {
  relations: RuntimeMemoryRelation[];
};

export interface RuntimeMemoryService {
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
}

export interface RuntimeMemoryServiceOptions {
  memoryStore: MemoryStorePort;
  vectorStore: VectorStore;
  modelGateway: Pick<ModelGateway, 'createEmbedding'>;
  memoryProviderId: string;
  vectorProviderId: string;
  embeddingFailureProviderId: string;
  embeddingModelId: string;
}

export function createMemoryService(options: RuntimeMemoryServiceOptions): RuntimeMemoryService {
  const contextService = createMemoryContextService({
    memoryStore: options.memoryStore,
    vectorStore: options.vectorStore,
    modelGateway: options.modelGateway,
    contextProviderId: `${options.memoryProviderId}+${options.vectorProviderId}`,
    embeddingFailureProviderId: options.embeddingFailureProviderId,
    embeddingModelId: options.embeddingModelId,
  });

  return {
    event: {
      append: async (input) => {
        try {
          assertMemoryEventAppendInput(input);
          return {
            ...okEnvelope('memory.event.append', options.memoryProviderId, 'not-applicable', [
              { kind: 'memory_event', message: `${input.namespace}/${input.id ?? 'generated'}` },
            ]),
            event: await options.memoryStore.appendEvent(input),
          };
        } catch (error) {
          return failedEnvelope('memory.event.append', options.memoryProviderId, 'not-applicable', error);
        }
      },
      get: async (input) => {
        try {
          assertRequiredStorageName(input?.namespace, 'namespace');
          assertRequiredStorageName(input?.id, 'id');
          return {
            ...okEnvelope('memory.event.get', options.memoryProviderId, 'not-applicable', []),
            event: await options.memoryStore.getEvent(input),
          };
        } catch (error) {
          return failedEnvelope('memory.event.get', options.memoryProviderId, 'not-applicable', error);
        }
      },
      list: async (input) => {
        try {
          assertMemoryEventListInput(input);
          return {
            ...okEnvelope('memory.event.list', options.memoryProviderId, 'not-applicable', []),
            events: await options.memoryStore.listEvents(input),
          };
        } catch (error) {
          return {
            ...failedEnvelope('memory.event.list', options.memoryProviderId, 'not-applicable', error),
            events: [],
          };
        }
      },
    },
    claim: {
      upsert: async (input) => {
        try {
          assertMemoryClaimUpsertInput(input);
          return {
            ...okEnvelope('memory.claim.upsert', options.memoryProviderId, 'not-applicable', [
              { kind: 'memory_claim', message: `${input.namespace}/${input.id}` },
            ]),
            claim: await options.memoryStore.upsertClaim(input),
          };
        } catch (error) {
          return failedEnvelope('memory.claim.upsert', options.memoryProviderId, 'not-applicable', error);
        }
      },
      get: async (input) => {
        try {
          assertRequiredStorageName(input?.namespace, 'namespace');
          assertRequiredStorageName(input?.id, 'id');
          return {
            ...okEnvelope('memory.claim.get', options.memoryProviderId, 'not-applicable', []),
            claim: await options.memoryStore.getClaim(input),
          };
        } catch (error) {
          return failedEnvelope('memory.claim.get', options.memoryProviderId, 'not-applicable', error);
        }
      },
      query: async (input) => {
        try {
          assertMemoryClaimQueryInput(input);
          return {
            ...okEnvelope('memory.claim.query', options.memoryProviderId, 'not-applicable', []),
            claims: await options.memoryStore.queryClaims(input),
          };
        } catch (error) {
          return {
            ...failedEnvelope('memory.claim.query', options.memoryProviderId, 'not-applicable', error),
            claims: [],
          };
        }
      },
    },
    relation: {
      upsert: async (input) => {
        try {
          assertMemoryRelationUpsertInput(input);
          return {
            ...okEnvelope('memory.relation.upsert', options.memoryProviderId, 'not-applicable', [
              { kind: 'memory_relation', message: `${input.namespace}/${input.id}` },
            ]),
            relation: await options.memoryStore.upsertRelation(input),
          };
        } catch (error) {
          return failedEnvelope('memory.relation.upsert', options.memoryProviderId, 'not-applicable', error);
        }
      },
      query: async (input) => {
        try {
          assertMemoryRelationQueryInput(input);
          return {
            ...okEnvelope('memory.relation.query', options.memoryProviderId, 'not-applicable', []),
            relations: await options.memoryStore.queryRelations(input),
          };
        } catch (error) {
          return {
            ...failedEnvelope('memory.relation.query', options.memoryProviderId, 'not-applicable', error),
            relations: [],
          };
        }
      },
    },
    context: {
      retrieve: (input) => contextService.retrieve(input),
    },
  };
}

function okEnvelope(
  capabilityId: string,
  providerId: string,
  modelId: string,
  evidence: RuntimeMemoryServiceEnvelope['evidence'],
): RuntimeMemoryServiceEnvelope {
  return { status: 'ok', capabilityId, providerId, modelId, evidence };
}

function failedEnvelope(
  capabilityId: string,
  providerId: string,
  modelId: string,
  error: unknown,
): RuntimeMemoryServiceEnvelope {
  return {
    status: 'failed',
    capabilityId,
    providerId,
    modelId,
    evidence: [{ kind: 'error', message: error instanceof Error ? error.message : String(error) }],
  };
}

function assertMemoryEventAppendInput(input: RuntimeMemoryEventAppendInput | undefined): void {
  assertRequiredStorageName(input?.namespace, 'namespace');
  if (input?.id !== undefined) assertRequiredStorageName(input.id, 'id');
  assertMemoryEventSource(input?.source);
  assertOptionalJsonObject(input?.actor, 'actor');
  assertOptionalJsonObject(input?.payload, 'payload');
  if (input?.artifact !== undefined) assertMemoryReference(input.artifact, 'artifact');
  assertOptionalJsonObject(input?.metadata, 'metadata');
  assertOptionalJsonObject(input?.policy, 'policy');
  parseOptionalDateString(input?.occurredAt, 'occurredAt');
}

function assertMemoryEventListInput(input: RuntimeMemoryEventListInput | undefined): void {
  assertRequiredStorageName(input?.namespace, 'namespace');
  assertOptionalLimit(input?.limit, 'limit');
}

function assertMemoryClaimUpsertInput(input: RuntimeMemoryClaimUpsertInput | undefined): void {
  assertRequiredStorageName(input?.namespace, 'namespace');
  assertRequiredStorageName(input?.id, 'id');
  assertRequiredStorageName(input?.kind, 'kind');
  assertJsonObject(input?.subject, 'subject');
  assertRequiredString(input?.statement, 'statement');
  assertMemoryEvidenceRefs(input?.evidence, 'evidence');
  assertMemoryConfidence(input?.confidence);
  assertOptionalMemoryClaimStatus(input?.status, 'status');
  assertOptionalString(input?.freshness, 'freshness');
  assertOptionalJsonObject(input?.owner, 'owner');
  assertOptionalJsonObject(input?.policy, 'policy');
  assertOptionalJsonObject(input?.metadata, 'metadata');
  assertOptionalStringArray(input?.supersedes, 'supersedes');
}

function assertMemoryClaimQueryInput(input: RuntimeMemoryClaimQueryInput | undefined): void {
  assertRequiredStorageName(input?.namespace, 'namespace');
  if (input?.kind !== undefined) assertRequiredStorageName(input.kind, 'kind');
  assertOptionalMemoryClaimStatus(input?.status, 'status');
  assertOptionalLimit(input?.limit, 'limit');
}

function assertMemoryRelationUpsertInput(input: RuntimeMemoryRelationUpsertInput | undefined): void {
  assertRequiredStorageName(input?.namespace, 'namespace');
  assertRequiredStorageName(input?.id, 'id');
  assertRequiredStorageName(input?.type, 'type');
  assertMemoryReference(input?.from, 'from');
  assertMemoryReference(input?.to, 'to');
  if (input?.evidence !== undefined) assertMemoryEvidenceRefs(input.evidence, 'evidence');
  assertOptionalJsonObject(input?.metadata, 'metadata');
}

function assertMemoryRelationQueryInput(input: RuntimeMemoryRelationQueryInput | undefined): void {
  assertRequiredStorageName(input?.namespace, 'namespace');
  if (input?.from !== undefined) assertMemoryReference(input.from, 'from');
  if (input?.to !== undefined) assertMemoryReference(input.to, 'to');
  if (input?.type !== undefined) assertRequiredStorageName(input.type, 'type');
  assertOptionalLimit(input?.limit, 'limit');
}

function assertMemoryEvidenceRefs(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  value.forEach((item, index) => {
    assertMemoryReference(item, `${label}[${index}]`, ['range']);
    assertOptionalJsonObject((item as { range?: unknown }).range, `${label}[${index}].range`);
  });
}

function assertMemoryReference(value: unknown, label: string, allowedExtraFields: string[] = []): void {
  assertJsonObject(value, label);
  const reference = value as { kind?: string; id?: string; namespace?: unknown };
  if (reference.namespace !== undefined) throw new Error(`${label}.namespace is not supported; use the top-level namespace`);
  for (const key of Object.keys(reference)) {
    if (key !== 'kind' && key !== 'id' && !allowedExtraFields.includes(key)) {
      throw new Error(`${label}.${key} is not supported`);
    }
  }
  assertRequiredStorageName(reference.kind, `${label}.kind`);
  assertRequiredStorageName(reference.id, `${label}.id`);
}

function assertMemoryEventSource(value: unknown): void {
  assertJsonObject(value, 'source');
  const source = value as { kind?: string; ref?: string };
  assertRequiredStorageName(source.kind, 'source.kind');
  assertRequiredString(source.ref, 'source.ref');
}

function assertMemoryConfidence(value: number | undefined): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('confidence must be between 0 and 1');
  }
}

function assertOptionalMemoryClaimStatus(value: string | undefined, label: string): void {
  if (
    value === undefined
    || value === 'unverified'
    || value === 'active'
    || value === 'superseded'
    || value === 'rejected'
    || value === 'stale'
  ) return;
  throw new Error(`${label} must be one of unverified, active, superseded, rejected, stale`);
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

function assertOptionalStringArray(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
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
