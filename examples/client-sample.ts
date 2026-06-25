import { createRuntimeServicesRpcClient } from 'agent-runtime-services';

type CapabilityDescriptor = {
  id: string;
  serviceLayer: 'runtime-core' | 'agent-service';
  consumers: string[];
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
};

type DescribeResult = {
  schemaVersion: 2;
  packageVersion: string;
  capabilityRevision: string;
  capabilities: CapabilityDescriptor[];
};

type StatusResult = {
  status: string;
  capabilityId: string;
  evidence: unknown[];
  resources?: Array<{ id: string; status: string; provider?: string }>;
};

type RuntimeEnvelope = {
  status: 'ok' | 'missing_resource' | 'failed';
  capabilityId: string;
  providerId: string;
  modelId: string;
  evidence: unknown[];
};

type LanguageResult = RuntimeEnvelope & {
  proposal?: { kind: 'text'; text: string };
};

type EmbeddingResult = RuntimeEnvelope & {
  embedding?: number[];
};

type ImageResult = RuntimeEnvelope & {
  artifact?: {
    kind: 'image';
    url?: string;
    b64Json?: string;
    raw: unknown;
  };
};

type ArtifactSaveResult = RuntimeEnvelope & {
  artifact?: { id: string; namespace: string };
};

type ArtifactListResult = RuntimeEnvelope & {
  artifacts: Array<{ id: string; namespace: string }>;
};

type ArtifactGetResult = RuntimeEnvelope & {
  artifact?: { id: string; namespace: string };
  bodyBase64?: string;
};

type RecordGetResult = RuntimeEnvelope & {
  record?: { id: string; namespace: string; tableName: string; data: Record<string, unknown> };
};

type RecordQueryResult = RuntimeEnvelope & {
  records: Array<{ id: string; namespace: string; tableName: string; data: Record<string, unknown> }>;
};

type RecordDeleteResult = RuntimeEnvelope & {
  deleted?: { id: string; namespace: string; tableName: string };
};

type MemoryEventResult = RuntimeEnvelope & {
  event?: { id: string; namespace: string; contentHash: string };
};

type MemoryClaimResult = RuntimeEnvelope & {
  claim?: { id: string; namespace: string; confidence: number; status: string };
};

type MemoryRelationResult = RuntimeEnvelope & {
  relation?: { id: string; namespace: string; type: string };
};

type VectorSearchResult = RuntimeEnvelope & {
  results: Array<{ id: string; content: string; score: number }>;
};

const endpoint = process.env.RUNTIME_SERVICES_RPC_URL ?? 'http://127.0.0.1:8765/rpc';
const client = createRuntimeServicesRpcClient({ endpoint });

const version = await client.call<{
  name: string;
  version: string;
  capabilitySchemaVersion: 2;
  capabilityRevision: string;
}>('version', {});
const describe = await client.call<DescribeResult>('capabilities.describe', {});
const writableCapabilities = describe.capabilities
  .filter((capability) => capability.effects.runtimeHome === 'write')
  .map((capability) => capability.id);

console.log('runtime services schema', describe.schemaVersion, version.capabilityRevision);
console.log('writable capabilities', writableCapabilities.join(', ') || 'none');

const language = await client.call<LanguageResult>('language.complete', {
  input: 'Summarize Runtime Services in one sentence.',
});
console.log(`${language.capabilityId}: ${language.status}`);
if (language.status === 'ok') {
  console.log('proposal', language.proposal?.text);
}

const embedding = await client.call<EmbeddingResult>('embedding.create', {
  input: 'external agent retrieval seed',
});
console.log(`${embedding.capabilityId}: ${embedding.status}`);

const image = await client.call<ImageResult>('vision.generateImage', {
  prompt: 'A simple runtime services topology diagram.',
});
console.log(
  `${image.capabilityId}: ${image.status}`,
  image.artifact?.url ? 'url returned' : image.artifact?.b64Json ? 'base64 returned' : 'no image payload',
);

const artifact = await client.call<ArtifactSaveResult>('artifact.save', {
  namespace: 'sample-agent-artifacts',
  body: 'external sample artifact body',
  mimeType: 'text/plain',
  source: { kind: 'client_sample' },
});
console.log(`${artifact.capabilityId}: ${artifact.status}`);

const artifactList = await client.call<ArtifactListResult>('artifact.list', {
  namespace: 'sample-agent-artifacts',
});
console.log(`${artifactList.capabilityId}: ${artifactList.status}`, `artifacts=${artifactList.artifacts.length}`);

if (artifact.artifact?.id) {
  const fetched = await client.call<ArtifactGetResult>('artifact.get', {
    namespace: 'sample-agent-artifacts',
    id: artifact.artifact.id,
  });
  console.log(`${fetched.capabilityId}: ${fetched.status}`, fetched.bodyBase64 ? 'body returned' : 'no body');
}

await client.call('record.upsert', {
  namespace: 'sample-agent-records',
  tableName: 'runs',
  id: 'run-1',
  data: {
    artifactId: artifact.artifact?.id ?? null,
    languageStatus: language.status,
    imageStatus: image.status,
  },
  metadata: { source: 'client_sample' },
});

const record = await client.call<RecordGetResult>('record.get', {
  namespace: 'sample-agent-records',
  tableName: 'runs',
  id: 'run-1',
});
console.log(`${record.capabilityId}: ${record.status}`, record.record?.id ?? 'missing');

const records = await client.call<RecordQueryResult>('record.query', {
  namespace: 'sample-agent-records',
  tableName: 'runs',
  limit: 5,
});
console.log(`${records.capabilityId}: ${records.status}`, `records=${records.records.length}`);

const deleted = await client.call<RecordDeleteResult>('record.delete', {
  namespace: 'sample-agent-records',
  tableName: 'runs',
  id: 'run-1',
});
console.log(`${deleted.capabilityId}: ${deleted.status}`, deleted.deleted?.id ?? 'not deleted');

const memoryEvent = await client.call<MemoryEventResult>('memory.event.append', {
  namespace: 'sample-agent-memory',
  id: 'event-1',
  source: { kind: 'client_sample', ref: 'examples/client-sample.ts' },
  payload: { text: 'Runtime Services keeps memory substrate inputs replayable.' },
  policy: { raw: 'internal', summary: 'internal', action: 'not_authorized' },
});
console.log(`${memoryEvent.capabilityId}: ${memoryEvent.status}`, memoryEvent.event?.contentHash ?? 'no hash');

const memoryClaim = await client.call<MemoryClaimResult>('memory.claim.upsert', {
  namespace: 'sample-agent-memory',
  id: 'claim-1',
  kind: 'sample_claim',
  subject: { kind: 'sample', id: 'runtime-services' },
  statement: 'Runtime Services stores memory claims with evidence before consumers treat them as facts.',
  evidence: [{ kind: 'event', id: 'event-1' }],
  confidence: 0.75,
  status: 'unverified',
  freshness: 'active',
  policy: { raw: 'internal', summary: 'internal', action: 'not_authorized' },
});
console.log(`${memoryClaim.capabilityId}: ${memoryClaim.status}`, memoryClaim.claim?.status ?? 'missing');

const memoryRelation = await client.call<MemoryRelationResult>('memory.relation.upsert', {
  namespace: 'sample-agent-memory',
  id: 'relation-1',
  type: 'supports',
  from: { kind: 'claim', id: 'claim-1' },
  to: { kind: 'event', id: 'event-1' },
});
console.log(`${memoryRelation.capabilityId}: ${memoryRelation.status}`, memoryRelation.relation?.type ?? 'missing');

if (embedding.embedding) {
  await client.call('vector.upsert', {
    tableName: 'sample_agent_vectors',
    id: 'doc-1',
    content: 'external sample vector content',
    embedding: embedding.embedding,
    metadata: { source: 'client_sample' },
  });

  const vectors = await client.call<VectorSearchResult>('vector.search', {
    tableName: 'sample_agent_vectors',
    embedding: embedding.embedding,
    limit: 1,
    filter: { metadata: { source: 'client_sample' } },
  });
  console.log(`${vectors.capabilityId}: ${vectors.status}`, `matches=${vectors.results.length}`);
}

const missingIsolation = await client.call<ArtifactListResult>('artifact.list', {});
if (missingIsolation.status !== 'failed') {
  throw new Error('expected artifact.list without namespace to fail');
}
console.log(`${missingIsolation.capabilityId}: ${missingIsolation.status}`);

const resourcesList = await client.call<StatusResult>('resources.list', {});
const resourcesDoctor = await client.call<StatusResult>('resources.doctor', {});
const resourcesSmoke = await client.call<StatusResult>('resources.smoke', { module: 'all' });
const status = await client.call<StatusResult>('resources.status', {});
for (const resourceResult of [resourcesList, resourcesDoctor, resourcesSmoke, status]) {
  console.log(
    `${resourceResult.capabilityId}: ${resourceResult.status}`,
    `resources=${resourceResult.resources?.length ?? 0}`,
  );
}
