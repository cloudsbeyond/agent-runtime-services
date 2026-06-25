import { createHash } from 'node:crypto';

export const RUNTIME_SERVICE_CAPABILITY_SCHEMA_VERSION = 2 as const;

export const RUNTIME_SERVICE_CAPABILITIES = [
  'language.complete',
  'embedding.create',
  'vision.generateImage',
  'artifact.save',
  'artifact.get',
  'artifact.list',
  'artifact.cleanupExpired',
  'record.upsert',
  'record.get',
  'record.query',
  'record.delete',
  'memory.event.append',
  'memory.event.get',
  'memory.event.list',
  'memory.claim.upsert',
  'memory.claim.get',
  'memory.claim.query',
  'memory.relation.upsert',
  'memory.relation.query',
  'memory.context.retrieve',
  'vector.upsert',
  'vector.search',
  'resources.list',
  'resources.doctor',
  'resources.smoke',
  'resources.status',
] as const;

export type RuntimeServiceCapabilityId = typeof RUNTIME_SERVICE_CAPABILITIES[number];
export const RUNTIME_SERVICE_AGENT_SERVICE_CAPABILITIES = [
  'memory.event.append',
  'memory.event.get',
  'memory.event.list',
  'memory.claim.upsert',
  'memory.claim.get',
  'memory.claim.query',
  'memory.relation.upsert',
  'memory.relation.query',
  'memory.context.retrieve',
] as const satisfies readonly RuntimeServiceCapabilityId[];

const AGENT_SERVICE_CAPABILITY_IDS: ReadonlySet<RuntimeServiceRpcMethodId> = new Set(
  RUNTIME_SERVICE_AGENT_SERVICE_CAPABILITIES,
);

export type RuntimeServiceRpcMethodId = RuntimeServiceCapabilityId |
  'health' |
  'version' |
  'capabilities.list' |
  'capabilities.describe';
export type RuntimeServiceConsumer = 'domain-agent' | 'build-agent';
export type RuntimeServiceRiskClass = 'read' | 'write-local' | 'external-provider' | 'admin-secret';
export type RuntimeServiceLayer = 'runtime-core' | 'agent-service';

export interface JsonObjectSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  oneOf?: unknown[];
}

export interface RuntimeServiceCapabilityDescriptor {
  schemaVersion: 2;
  id: RuntimeServiceRpcMethodId;
  transport: 'json-rpc';
  consumers: RuntimeServiceConsumer[];
  http: {
    style: 'streamable-http-lite';
    endpoint: '/rpc';
    post: true;
    getSse: false;
    resumable: false;
  };
  domain: 'rpc' | 'models' | 'storage' | 'memory' | 'resources';
  serviceLayer: RuntimeServiceLayer;
  risk: RuntimeServiceRiskClass;
  request: {
    paramsShape: string;
    required: string[];
    inputSchema: JsonObjectSchema;
  };
  response: {
    resultShape: string;
    envelope: boolean;
  };
  effects: {
    runtimeHome: 'none' | 'read' | 'write';
    network: 'none' | 'provider' | 'input_url';
    modelCall: boolean;
  };
  authority: {
    domainDecision: false;
    approval: false;
    toolChoice: false;
    sessionMutation: false;
  };
}

const INFRASTRUCTURE_ONLY_AUTHORITY = {
  domainDecision: false,
  approval: false,
  toolChoice: false,
  sessionMutation: false,
} as const;

const DEFAULT_CONSUMERS = ['domain-agent', 'build-agent'] as const;
const STREAMABLE_HTTP_LITE = {
  style: 'streamable-http-lite',
  endpoint: '/rpc',
  post: true,
  getSse: false,
  resumable: false,
} as const;

const EMPTY_PARAMS: JsonObjectSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};
const MEMORY_REFERENCE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string' },
    id: { type: 'string' },
  },
  required: ['kind', 'id'],
  additionalProperties: false,
} as const;
const MEMORY_EVIDENCE_REF_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string' },
    id: { type: 'string' },
    range: { type: 'object' },
  },
  required: ['kind', 'id'],
  additionalProperties: false,
} as const;

export const RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS = [
  descriptor('health', 'rpc', 'read', 'health.params.v1', EMPTY_PARAMS, 'health.result.v1', false, 'none', 'none', false),
  descriptor('version', 'rpc', 'read', 'version.params.v1', EMPTY_PARAMS, 'version.result.v1', false, 'none', 'none', false),
  descriptor('capabilities.list', 'rpc', 'read', 'capabilities.list.params.v1', EMPTY_PARAMS, 'capabilities.list.result.v1', false, 'none', 'none', false),
  descriptor('capabilities.describe', 'rpc', 'read', 'capabilities.describe.params.v1', EMPTY_PARAMS, 'capabilities.describe.result.v1', false, 'none', 'none', false),
  descriptor('language.complete', 'models', 'external-provider', 'language.complete.params.v1', objectSchema({
    input: { type: 'string' },
  }, ['input']), 'language.complete.result.v1', true, 'none', 'provider', true),
  descriptor('embedding.create', 'models', 'external-provider', 'embedding.create.params.v1', objectSchema({
    input: {
      oneOf: [
        { type: 'string' },
        { type: 'array', items: { type: 'string' }, minItems: 1 },
      ],
    },
  }, ['input']), 'embedding.create.result.v1', true, 'none', 'provider', true),
  descriptor('vision.generateImage', 'models', 'external-provider', 'vision.generateImage.params.v1', objectSchema({
    prompt: { type: 'string' },
  }, ['prompt']), 'vision.generateImage.result.v1', true, 'none', 'provider', true),
  descriptor('artifact.save', 'storage', 'write-local', 'artifact.save.params.v1', {
    type: 'object',
    properties: {
      namespace: { type: 'string' },
      body: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'number' } },
        ],
      },
      sourceUrl: { type: 'string' },
      mimeType: { type: 'string' },
      extension: { type: 'string' },
      source: { type: 'object' },
      expiresAt: { type: 'string' },
    },
    required: ['namespace'],
    oneOf: [
      { required: ['body', 'mimeType'] },
      { required: ['sourceUrl'] },
    ],
    additionalProperties: false,
  }, 'artifact.save.result.v1', true, 'write', 'input_url', false),
  descriptor('artifact.get', 'storage', 'read', 'artifact.get.params.v1', objectSchema({
    namespace: { type: 'string' },
    id: { type: 'string' },
  }, ['namespace', 'id']), 'artifact.get.result.v1', true, 'read', 'none', false),
  descriptor('artifact.list', 'storage', 'read', 'artifact.list.params.v1', objectSchema({
    namespace: { type: 'string' },
  }, ['namespace']), 'artifact.list.result.v1', true, 'read', 'none', false),
  descriptor('artifact.cleanupExpired', 'storage', 'write-local', 'artifact.cleanupExpired.params.v1', objectSchema({
    namespace: { type: 'string' },
    now: { type: 'string' },
  }, ['namespace']), 'artifact.cleanupExpired.result.v1', true, 'write', 'none', false),
  descriptor('record.upsert', 'storage', 'write-local', 'record.upsert.params.v1', objectSchema({
    namespace: { type: 'string' },
    tableName: { type: 'string' },
    id: { type: 'string' },
    data: { type: 'object' },
    metadata: { type: 'object' },
  }, ['namespace', 'tableName', 'id', 'data']), 'record.upsert.result.v1', true, 'write', 'none', false),
  descriptor('record.get', 'storage', 'read', 'record.get.params.v1', objectSchema({
    namespace: { type: 'string' },
    tableName: { type: 'string' },
    id: { type: 'string' },
  }, ['namespace', 'tableName', 'id']), 'record.get.result.v1', true, 'read', 'none', false),
  descriptor('record.query', 'storage', 'read', 'record.query.params.v1', objectSchema({
    namespace: { type: 'string' },
    tableName: { type: 'string' },
    limit: { type: 'number' },
  }, ['namespace', 'tableName']), 'record.query.result.v1', true, 'read', 'none', false),
  descriptor('record.delete', 'storage', 'write-local', 'record.delete.params.v1', objectSchema({
    namespace: { type: 'string' },
    tableName: { type: 'string' },
    id: { type: 'string' },
  }, ['namespace', 'tableName', 'id']), 'record.delete.result.v1', true, 'write', 'none', false),
  descriptor('memory.event.append', 'memory', 'write-local', 'memory.event.append.params.v1', objectSchema({
    namespace: { type: 'string' },
    id: { type: 'string' },
    source: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        ref: { type: 'string' },
      },
      required: ['kind', 'ref'],
    },
    actor: { type: 'object' },
    payload: { type: 'object' },
    artifact: MEMORY_REFERENCE_SCHEMA,
    metadata: { type: 'object' },
    policy: { type: 'object' },
    occurredAt: { type: 'string' },
  }, ['namespace', 'source']), 'memory.event.append.result.v1', true, 'write', 'none', false),
  descriptor('memory.event.get', 'memory', 'read', 'memory.event.get.params.v1', objectSchema({
    namespace: { type: 'string' },
    id: { type: 'string' },
  }, ['namespace', 'id']), 'memory.event.get.result.v1', true, 'read', 'none', false),
  descriptor('memory.event.list', 'memory', 'read', 'memory.event.list.params.v1', objectSchema({
    namespace: { type: 'string' },
    limit: { type: 'number' },
  }, ['namespace']), 'memory.event.list.result.v1', true, 'read', 'none', false),
  descriptor('memory.claim.upsert', 'memory', 'write-local', 'memory.claim.upsert.params.v1', objectSchema({
    namespace: { type: 'string' },
    id: { type: 'string' },
    kind: { type: 'string' },
    subject: { type: 'object' },
    statement: { type: 'string' },
    evidence: { type: 'array', items: MEMORY_EVIDENCE_REF_SCHEMA },
    confidence: { type: 'number' },
    status: { enum: ['unverified', 'active', 'superseded', 'rejected', 'stale'] },
    freshness: { type: 'string' },
    owner: { type: 'object' },
    policy: { type: 'object' },
    metadata: { type: 'object' },
    supersedes: { type: 'array', items: { type: 'string' } },
  }, ['namespace', 'id', 'kind', 'subject', 'statement', 'evidence', 'confidence']), 'memory.claim.upsert.result.v1', true, 'write', 'none', false),
  descriptor('memory.claim.get', 'memory', 'read', 'memory.claim.get.params.v1', objectSchema({
    namespace: { type: 'string' },
    id: { type: 'string' },
  }, ['namespace', 'id']), 'memory.claim.get.result.v1', true, 'read', 'none', false),
  descriptor('memory.claim.query', 'memory', 'read', 'memory.claim.query.params.v1', objectSchema({
    namespace: { type: 'string' },
    kind: { type: 'string' },
    status: { enum: ['unverified', 'active', 'superseded', 'rejected', 'stale'] },
    limit: { type: 'number' },
  }, ['namespace']), 'memory.claim.query.result.v1', true, 'read', 'none', false),
  descriptor('memory.relation.upsert', 'memory', 'write-local', 'memory.relation.upsert.params.v1', objectSchema({
    namespace: { type: 'string' },
    id: { type: 'string' },
    type: { type: 'string' },
    from: MEMORY_REFERENCE_SCHEMA,
    to: MEMORY_REFERENCE_SCHEMA,
    evidence: { type: 'array', items: MEMORY_EVIDENCE_REF_SCHEMA },
    metadata: { type: 'object' },
  }, ['namespace', 'id', 'type', 'from', 'to']), 'memory.relation.upsert.result.v1', true, 'write', 'none', false),
  descriptor('memory.relation.query', 'memory', 'read', 'memory.relation.query.params.v1', objectSchema({
    namespace: { type: 'string' },
    from: MEMORY_REFERENCE_SCHEMA,
    to: MEMORY_REFERENCE_SCHEMA,
    type: { type: 'string' },
    limit: { type: 'number' },
  }, ['namespace']), 'memory.relation.query.result.v1', true, 'read', 'none', false),
  descriptor('memory.context.retrieve', 'memory', 'external-provider', 'memory.context.retrieve.params.v1', {
    type: 'object',
    properties: {
      namespace: { type: 'string' },
      tableName: { type: 'string' },
      embedding: { type: 'array', items: { type: 'number' } },
      query: { type: 'string' },
      limit: { type: 'number' },
      relationshipLimit: { type: 'number' },
      filter: {
        type: 'object',
        properties: {
          metadata: {
            type: 'object',
            additionalProperties: {
              oneOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
              ],
            },
          },
        },
        additionalProperties: false,
      },
    },
    required: ['namespace', 'tableName'],
    oneOf: [
      { required: ['embedding'] },
      { required: ['query'] },
    ],
    additionalProperties: false,
  }, 'memory.context.retrieve.result.v1', true, 'read', 'provider', true),
  descriptor('vector.upsert', 'storage', 'write-local', 'vector.upsert.params.v1', objectSchema({
    tableName: { type: 'string' },
    id: { type: 'string' },
    content: { type: 'string' },
    embedding: { type: 'array', items: { type: 'number' } },
    metadata: { type: 'object' },
  }, ['tableName', 'id', 'content', 'embedding']), 'vector.upsert.result.v1', true, 'write', 'none', false),
  descriptor('vector.search', 'storage', 'external-provider', 'vector.search.params.v1', {
    type: 'object',
    properties: {
      tableName: { type: 'string' },
      embedding: { type: 'array', items: { type: 'number' } },
      query: { type: 'string' },
      limit: { type: 'number' },
      filter: {
        type: 'object',
        properties: {
          metadata: {
            type: 'object',
            additionalProperties: {
              oneOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
              ],
            },
          },
        },
        additionalProperties: false,
      },
    },
    required: ['tableName'],
    oneOf: [
      { required: ['embedding'] },
      { required: ['query'] },
    ],
    additionalProperties: false,
  }, 'vector.search.result.v1', true, 'read', 'provider', true),
  descriptor('resources.list', 'resources', 'read', 'resources.list.params.v1', EMPTY_PARAMS, 'resources.list.result.v1', true, 'read', 'none', false),
  descriptor('resources.doctor', 'resources', 'read', 'resources.doctor.params.v1', EMPTY_PARAMS, 'resources.doctor.result.v1', true, 'read', 'none', false),
  descriptor('resources.smoke', 'resources', 'read', 'resources.smoke.params.v1', objectSchema({
    module: { enum: ['language', 'embedding', 'vision', 'all'] },
  }, []), 'resources.smoke.result.v1', true, 'read', 'none', false),
  descriptor('resources.status', 'resources', 'read', 'resources.status.params.v1', EMPTY_PARAMS, 'resources.status.result.v1', true, 'read', 'none', false),
] as const satisfies readonly RuntimeServiceCapabilityDescriptor[];

export const RUNTIME_SERVICE_CAPABILITY_REVISION = createCapabilityRevision(RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS);

export function getRuntimeServiceCapabilityDescriptor(
  id: RuntimeServiceRpcMethodId,
): RuntimeServiceCapabilityDescriptor | undefined {
  return RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS.find((descriptorItem) => descriptorItem.id === id);
}

function descriptor(
  id: RuntimeServiceRpcMethodId,
  domain: RuntimeServiceCapabilityDescriptor['domain'],
  risk: RuntimeServiceRiskClass,
  paramsShape: string,
  inputSchema: JsonObjectSchema,
  resultShape: string,
  envelope: boolean,
  runtimeHome: RuntimeServiceCapabilityDescriptor['effects']['runtimeHome'],
  network: RuntimeServiceCapabilityDescriptor['effects']['network'],
  modelCall: boolean,
): RuntimeServiceCapabilityDescriptor {
  return {
    schemaVersion: RUNTIME_SERVICE_CAPABILITY_SCHEMA_VERSION,
    id,
    transport: 'json-rpc',
    consumers: [...DEFAULT_CONSUMERS],
    http: STREAMABLE_HTTP_LITE,
    domain,
    serviceLayer: serviceLayerForCapability(id),
    risk,
    request: {
      paramsShape,
      required: inputSchema.required ?? [],
      inputSchema,
    },
    response: { resultShape, envelope },
    effects: { runtimeHome, network, modelCall },
    authority: INFRASTRUCTURE_ONLY_AUTHORITY,
  };
}

function serviceLayerForCapability(id: RuntimeServiceRpcMethodId): RuntimeServiceLayer {
  return AGENT_SERVICE_CAPABILITY_IDS.has(id) ? 'agent-service' : 'runtime-core';
}

function objectSchema(properties: Record<string, unknown>, required: string[]): JsonObjectSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function createCapabilityRevision(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 16);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
