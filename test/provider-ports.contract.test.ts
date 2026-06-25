import { describe, expect, test } from 'vitest';
import {
  type ArtifactStorePort,
  createRuntimeServices,
  type ArtifactManifestStorePort,
  type MemoryStorePort,
  type ModelGateway,
  type ObjectStorePort,
  type RecordStorePort,
  type StoredArtifact,
  type VectorStore,
} from '../src/index';

describe('runtime provider ports', () => {
  test('artifact cleanup validates optional dates before injected providers', async () => {
    const calls: string[] = [];
    const artifactStore: ArtifactStorePort = {
      providerId: 'artifact-port',
      save: async () => {
        calls.push('artifact.save');
        throw new Error('not used');
      },
      get: async () => {
        calls.push('artifact.get');
        throw new Error('not used');
      },
      list: async () => {
        calls.push('artifact.list');
        return [];
      },
      cleanupExpired: async (input) => {
        calls.push(`artifact.cleanupExpired:${input.namespace}:${String(input.now)}`);
        return { deleted: [] };
      },
    };
    const services = createRuntimeServices({ artifactStore });

    await expect(services.artifact.cleanupExpired({
      namespace: 'tenant-a',
      now: 'not-a-date',
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'artifact.cleanupExpired',
      deleted: [],
      evidence: [expect.objectContaining({ message: expect.stringContaining('now') })],
    });
    expect(calls).toEqual([]);
    await expect(services.artifact.save({
      namespace: 'tenant-a',
      body: 'expires later',
      mimeType: 'text/plain',
      expiresAt: 'not-a-date',
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'artifact.save',
      evidence: [expect.objectContaining({ message: expect.stringContaining('expiresAt') })],
    });
    expect(calls).toEqual([]);
  });

  test('public services run through injected providers without changing capability envelopes', async () => {
    const calls: string[] = [];
    const artifacts: StoredArtifact[] = [];
    const objectBodies = new Map<string, string>();
    const records = new Map<string, {
      namespace: string;
      tableName: string;
      id: string;
      data: Record<string, unknown>;
      metadata: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    }>();
    const memoryEvents = new Map<string, Awaited<ReturnType<MemoryStorePort['appendEvent']>>>();
    const memoryClaims = new Map<string, Awaited<ReturnType<MemoryStorePort['upsertClaim']>>>();
    const memoryRelations = new Map<string, Awaited<ReturnType<MemoryStorePort['upsertRelation']>>>();
    const modelGateway: ModelGateway = {
      providerId: 'memory-model-gateway',
      complete: async (input) => {
        calls.push(`model.complete:${input.input}`);
        return {
          moduleId: 'language',
          providerId: 'memory-model',
          modelId: 'language-test',
          text: 'pong',
          raw: { ok: true },
        };
      },
      createEmbedding: async (input) => {
        calls.push(`model.embedding:${String(input.input)}`);
        return {
          moduleId: 'embedding',
          providerId: 'memory-model',
          modelId: 'embedding-test',
          embedding: [0.25, 0.75],
          raw: { ok: true },
        };
      },
      generateImage: async (input) => {
        calls.push(`model.image:${input.prompt}`);
        return {
          moduleId: 'vision',
          providerId: 'memory-model',
          modelId: 'image-test',
          url: 'https://example.test/generated.png',
          raw: { ok: true },
        };
      },
    };
    const objectStore: ObjectStorePort = {
      providerId: 'memory-object-store',
      put: async (input) => {
        calls.push(`object.put:${input.namespace}:${input.key}`);
        const bodyBytes = Buffer.from(input.body);
        const result = {
          path: `memory://${input.namespace}/${input.key}`,
          sizeBytes: bodyBytes.byteLength,
        };
        objectBodies.set(result.path, bodyBytes.toString('utf8'));
        return result;
      },
      get: async (input) => {
        calls.push(`object.get:${input.path}`);
        const body = objectBodies.get(input.path);
        if (!body) throw new Error('object not found');
        return Buffer.from(body);
      },
      delete: async (input) => {
        calls.push(`object.delete:${input.path}`);
      },
    };
    const artifactManifestStore: ArtifactManifestStorePort = {
      providerId: 'memory-manifest-store',
      insert: async (artifact) => {
        calls.push(`manifest.insert:${artifact.namespace}:${artifact.id}`);
        artifacts.push(artifact);
      },
      list: async (options) => {
        calls.push(`manifest.list:${options.namespace}`);
        return artifacts.filter((artifact) => artifact.namespace === options.namespace);
      },
      get: async (input) => {
        calls.push(`manifest.get:${input.namespace}:${input.id}`);
        const artifact = artifacts.find((item) => item.namespace === input.namespace && item.id === input.id);
        if (!artifact) throw new Error('manifest not found');
        return artifact;
      },
      delete: async (input) => {
        calls.push(`manifest.delete:${input.id}`);
      },
    };
    const vectorStore: VectorStore = {
      providerId: 'memory-vector-store',
      upsert: async (record, options) => {
        calls.push(`vector.upsert:${options.tableName}:${record.id}`);
      },
      search: async (embedding, options) => {
        calls.push(`vector.search:${options.tableName}:${embedding.join(',')}:${JSON.stringify(options.filter ?? {})}`);
        return [{
          id: 'doc-1',
          content: 'matched content',
          embedding,
          metadata: {
            tableName: options.tableName,
            ...(options.filter?.metadata?.namespace ? {
              namespace: options.filter.metadata.namespace,
              claimId: 'claim-1',
              eventId: 'event-1',
            } : {}),
          },
          score: 1,
          createdAt: '2026-06-12T00:00:00.000Z',
          updatedAt: '2026-06-12T00:00:00.000Z',
        }];
      },
    };
    const recordStore: RecordStorePort = {
      providerId: 'memory-record-store',
      upsert: async (input) => {
        calls.push(`record.upsert:${input.namespace}:${input.tableName}:${input.id}`);
        const key = `${input.namespace}:${input.tableName}:${input.id}`;
        const existing = records.get(key);
        const record = {
          namespace: input.namespace,
          tableName: input.tableName,
          id: input.id,
          data: input.data,
          metadata: input.metadata ?? {},
          createdAt: existing?.createdAt ?? '2026-06-12T00:00:00.000Z',
          updatedAt: '2026-06-12T00:00:01.000Z',
        };
        records.set(key, record);
        return record;
      },
      get: async (input) => {
        calls.push(`record.get:${input.namespace}:${input.tableName}:${input.id}`);
        const record = records.get(`${input.namespace}:${input.tableName}:${input.id}`);
        if (!record) throw new Error('record not found');
        return record;
      },
      query: async (input) => {
        calls.push(`record.query:${input.namespace}:${input.tableName}:${input.limit ?? 'none'}`);
        return [...records.values()].filter((record) => record.namespace === input.namespace && record.tableName === input.tableName);
      },
      delete: async (input) => {
        calls.push(`record.delete:${input.namespace}:${input.tableName}:${input.id}`);
        const key = `${input.namespace}:${input.tableName}:${input.id}`;
        const record = records.get(key);
        if (!record) throw new Error('record not found');
        records.delete(key);
        return record;
      },
    };
    const memoryStore: MemoryStorePort = {
      providerId: 'memory-store-port',
      appendEvent: async (input) => {
        calls.push(`memory.event.append:${input.namespace}:${input.id}`);
        const event = {
          namespace: input.namespace,
          id: input.id ?? 'event-generated',
          source: input.source,
          actor: input.actor ?? {},
          payload: input.payload ?? {},
          metadata: input.metadata ?? {},
          policy: input.policy ?? {},
          occurredAt: input.occurredAt ?? '2026-06-12T00:00:00.000Z',
          appendedAt: '2026-06-12T00:00:01.000Z',
          contentHash: 'b'.repeat(64),
        };
        memoryEvents.set(`${event.namespace}:${event.id}`, event);
        return event;
      },
      getEvent: async (input) => {
        calls.push(`memory.event.get:${input.namespace}:${input.id}`);
        const event = memoryEvents.get(`${input.namespace}:${input.id}`);
        if (!event) throw new Error(`memory event not found: ${input.namespace}/${input.id}`);
        return event;
      },
      listEvents: async (input) => {
        calls.push(`memory.event.list:${input.namespace}:${input.limit ?? 'none'}`);
        return [...memoryEvents.values()].filter((event) => event.namespace === input.namespace);
      },
      upsertClaim: async (input) => {
        calls.push(`memory.claim.upsert:${input.namespace}:${input.id}`);
        const existing = memoryClaims.get(`${input.namespace}:${input.id}`);
        const claim = {
          namespace: input.namespace,
          id: input.id,
          kind: input.kind,
          subject: input.subject,
          statement: input.statement,
          evidence: input.evidence,
          confidence: input.confidence,
          status: input.status ?? 'unverified',
          freshness: input.freshness ?? 'active',
          owner: input.owner ?? {},
          policy: input.policy ?? {},
          metadata: input.metadata ?? {},
          supersedes: input.supersedes ?? [],
          createdAt: existing?.createdAt ?? '2026-06-12T00:00:00.000Z',
          updatedAt: '2026-06-12T00:00:01.000Z',
        };
        memoryClaims.set(`${claim.namespace}:${claim.id}`, claim);
        return claim;
      },
      getClaim: async (input) => {
        calls.push(`memory.claim.get:${input.namespace}:${input.id}`);
        const claim = memoryClaims.get(`${input.namespace}:${input.id}`);
        if (!claim) throw new Error(`memory claim not found: ${input.namespace}/${input.id}`);
        return claim;
      },
      queryClaims: async (input) => {
        calls.push(`memory.claim.query:${input.namespace}:${input.limit ?? 'none'}`);
        return [...memoryClaims.values()].filter((claim) => (
          claim.namespace === input.namespace
          && (!input.kind || claim.kind === input.kind)
          && (!input.status || claim.status === input.status)
        ));
      },
      upsertRelation: async (input) => {
        calls.push(`memory.relation.upsert:${input.namespace}:${input.id}`);
        const existing = memoryRelations.get(`${input.namespace}:${input.id}`);
        const relation = {
          namespace: input.namespace,
          id: input.id,
          type: input.type,
          from: input.from,
          to: input.to,
          evidence: input.evidence ?? [],
          metadata: input.metadata ?? {},
          createdAt: existing?.createdAt ?? '2026-06-12T00:00:00.000Z',
          updatedAt: '2026-06-12T00:00:01.000Z',
        };
        memoryRelations.set(`${relation.namespace}:${relation.id}`, relation);
        return relation;
      },
      queryRelations: async (input) => {
        const fromLabel = input.from ? `${input.from.kind}:${input.from.id}` : 'none';
        const toLabel = input.to ? `${input.to.kind}:${input.to.id}` : 'none';
        calls.push(`memory.relation.query:${input.namespace}:from=${fromLabel}:to=${toLabel}:${input.limit ?? 'none'}`);
        return [...memoryRelations.values()].filter((relation) => (
          relation.namespace === input.namespace
          && (!input.type || relation.type === input.type)
          && (!input.from || (relation.from.kind === input.from.kind && relation.from.id === input.from.id))
          && (!input.to || (relation.to.kind === input.to.kind && relation.to.id === input.to.id))
        ));
      },
    };

    const services = createRuntimeServices({
      ports: {
        modelGateway,
        objectStore,
        artifactManifestStore,
        vectorStore,
        recordStore,
        memoryStore,
      },
    });

    await expect(services.language.complete({ input: 'ping' })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'language.complete',
      providerId: 'memory-model',
      modelId: 'language-test',
      proposal: { kind: 'text', text: 'pong' },
    });
    await expect(services.embedding.create({ input: 'index me' })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'embedding.create',
      providerId: 'memory-model',
      modelId: 'embedding-test',
      embedding: [0.25, 0.75],
    });
    await expect(services.vision.generateImage({ prompt: 'blue dot' })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vision.generateImage',
      providerId: 'memory-model',
      modelId: 'image-test',
      artifact: { kind: 'image', url: 'https://example.test/generated.png' },
    });
    const callsAfterValidModels = [...calls];
    await expect(services.language.complete(undefined as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'language.complete',
      evidence: [{ kind: 'error', message: 'input is required' }],
    });
    await expect(services.embedding.create({} as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'embedding.create',
      evidence: [{ kind: 'error', message: 'input is required' }],
    });
    await expect(services.embedding.create({ input: [] })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'embedding.create',
      evidence: [{ kind: 'error', message: 'input must be a string or a non-empty array of strings' }],
    });
    await expect(services.embedding.create({ input: [1] })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'embedding.create',
      evidence: [{ kind: 'error', message: 'input must be a string or a non-empty array of strings' }],
    });
    await expect(services.vision.generateImage({} as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'vision.generateImage',
      evidence: [{ kind: 'error', message: 'prompt is required' }],
    });
    expect(calls).toEqual(callsAfterValidModels);
    await expect(services.artifact.save({
      namespace: 'tenant-a',
      body: 'hello',
      mimeType: 'text/plain',
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'artifact.save',
      providerId: 'memory-object-store+memory-manifest-store',
      artifact: {
        id: expect.stringMatching(/^artifact-\d{14}-[a-f0-9]{12}-[a-f0-9]{8}$/),
        namespace: 'tenant-a',
      },
    });
    await expect(services.artifact.list({ namespace: 'tenant-a' })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'artifact.list',
      providerId: 'memory-object-store+memory-manifest-store',
      artifacts: [{
        id: expect.stringMatching(/^artifact-\d{14}-[a-f0-9]{12}-[a-f0-9]{8}$/),
      }],
    });
    const artifactId = artifacts[0]?.id;
    await expect(services.artifact.get({ namespace: 'tenant-a', id: artifactId ?? '' })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'artifact.get',
      providerId: 'memory-object-store+memory-manifest-store',
      artifact: { id: artifactId, namespace: 'tenant-a' },
      bodyBase64: Buffer.from('hello').toString('base64'),
    });
    await expect(services.vector.upsert({
      tableName: 'semantic_memory',
      id: 'doc-1',
      content: 'matched content',
      embedding: [0.1, 0.9],
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vector.upsert',
      providerId: 'memory-vector-store',
      id: 'doc-1',
    });
    await expect(services.vector.search({
      tableName: 'semantic_memory',
      query: 'needle',
      limit: 1,
      filter: { metadata: { scope: 'project' } },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vector.search',
      providerId: 'memory-vector-store',
      results: [{ id: 'doc-1', metadata: { tableName: 'semantic_memory' } }],
    });
    const callsAfterValidVector = [...calls];
    await expect(services.vector.upsert(undefined as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'vector.upsert',
      evidence: [{ kind: 'error', message: 'tableName is required' }],
    });
    await expect(services.vector.upsert({
      tableName: 'semantic_memory',
      id: '',
      content: 'bad vector',
      embedding: [0.1, 0.9],
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'vector.upsert',
    });
    await expect(services.vector.upsert({
      tableName: 'semantic_memory',
      id: 'doc-bad',
      content: '',
      embedding: [0.1, 0.9],
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'vector.upsert',
    });
    await expect(services.vector.upsert({
      tableName: 'semantic_memory',
      id: 'doc-bad',
      content: 'bad vector',
      embedding: [Number.NaN],
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'vector.upsert',
    });
    await expect(services.vector.search({
      tableName: 'semantic_memory',
      embedding: [],
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'vector.search',
      results: [],
    });
    await expect(services.vector.search({
      tableName: 'semantic_memory',
      query: '',
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'vector.search',
      results: [],
    });
    await expect(services.vector.search({
      tableName: 'semantic_memory',
      embedding: [0.1, 0.9],
      limit: -1,
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'vector.search',
      results: [],
    });
    expect(calls).toEqual(callsAfterValidVector);
    await expect(services.record.upsert({
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
      data: { status: 'open' },
      metadata: { source: 'ports_contract' },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'record.upsert',
      providerId: 'memory-record-store',
      record: {
        namespace: 'tenant-a',
        tableName: 'orders',
        id: 'order-1',
        data: { status: 'open' },
      },
    });
    await expect(services.record.get({
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'record.get',
      providerId: 'memory-record-store',
      record: { id: 'order-1' },
    });
    await expect(services.record.query({
      namespace: 'tenant-a',
      tableName: 'orders',
      limit: 5,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'record.query',
      providerId: 'memory-record-store',
      records: [expect.objectContaining({ id: 'order-1' })],
    });
    const callsAfterValidRecordQuery = [...calls];
    await expect(services.record.query({
      namespace: 'tenant-a',
      tableName: 'orders',
      limit: -1,
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'record.query',
      records: [],
      evidence: [expect.objectContaining({ message: expect.stringContaining('limit') })],
    });
    expect(calls).toEqual(callsAfterValidRecordQuery);
    await expect(services.record.delete({
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'record.delete',
      providerId: 'memory-record-store',
      deleted: expect.objectContaining({ id: 'order-1' }),
    });
    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      id: 'event-1',
      source: { kind: 'ports_contract', ref: 'provider-ports.contract.test.ts' },
      payload: { text: 'memory provider port event' },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.event.append',
      providerId: 'memory-store-port',
      event: { id: 'event-1', namespace: 'tenant-a' },
    });
    await expect(services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'ports_claim',
      subject: { kind: 'tenant', id: 'tenant-a' },
      statement: 'memory provider port claim',
      evidence: [{ kind: 'event', id: 'event-1' }],
      confidence: 0.7,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.claim.upsert',
      providerId: 'memory-store-port',
      claim: { id: 'claim-1', confidence: 0.7 },
    });
    await expect(services.memory.relation.upsert({
      namespace: 'tenant-a',
      id: 'relation-1',
      type: 'supports',
      from: { kind: 'claim', id: 'claim-1' },
      to: { kind: 'event', id: 'event-1' },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.relation.upsert',
      providerId: 'memory-store-port',
      relation: { id: 'relation-1', type: 'supports' },
    });
    await expect(services.memory.context.retrieve({
      namespace: 'tenant-a',
      tableName: 'semantic_memory',
      embedding: [0.25, 0.75],
      limit: 1,
      relationshipLimit: 5,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.context.retrieve',
      providerId: 'memory-store-port+memory-vector-store',
      modelId: 'not-applicable',
      bundle: {
        candidates: [expect.objectContaining({ id: 'doc-1', metadata: expect.objectContaining({ namespace: 'tenant-a' }) })],
        claims: [expect.objectContaining({ id: 'claim-1' })],
        events: [expect.objectContaining({ id: 'event-1' })],
        relations: [expect.objectContaining({ id: 'relation-1' })],
      },
    });
    await expect(services.resources.status()).resolves.toMatchObject({
      status: 'ok',
      resources: expect.arrayContaining([
        expect.objectContaining({
          id: 'model.language_completion',
          status: 'available',
          provider: 'memory-model-gateway',
        }),
        expect.objectContaining({
          id: 'storage.artifact_store',
          status: 'available',
          provider: 'memory-object-store+memory-manifest-store',
        }),
        expect.objectContaining({
          id: 'storage.vector_index',
          status: 'available',
          provider: 'memory-vector-store',
        }),
        expect.objectContaining({
          id: 'storage.record_store',
          status: 'available',
          provider: 'memory-record-store',
        }),
        expect.objectContaining({
          id: 'storage.memory_store',
          status: 'available',
          provider: 'memory-store-port',
        }),
      ]),
    });
    expect(calls).toEqual([
      'model.complete:ping',
      'model.embedding:index me',
      'model.image:blue dot',
      expect.stringMatching(/^object\.put:tenant-a:artifact-\d{14}-[a-f0-9]{12}-[a-f0-9]{8}\.txt$/),
      expect.stringMatching(/^manifest\.insert:tenant-a:artifact-\d{14}-[a-f0-9]{12}-[a-f0-9]{8}$/),
      'manifest.list:tenant-a',
      expect.stringMatching(/^manifest\.get:tenant-a:artifact-\d{14}-[a-f0-9]{12}-[a-f0-9]{8}$/),
      expect.stringMatching(/^object\.get:memory:\/\/tenant-a\/artifact-\d{14}-[a-f0-9]{12}-[a-f0-9]{8}\.txt$/),
      'vector.upsert:semantic_memory:doc-1',
      'model.embedding:needle',
      'vector.search:semantic_memory:0.25,0.75:{"metadata":{"scope":"project"}}',
      'record.upsert:tenant-a:orders:order-1',
      'record.get:tenant-a:orders:order-1',
      'record.query:tenant-a:orders:5',
      'record.delete:tenant-a:orders:order-1',
      'memory.event.append:tenant-a:event-1',
      'memory.claim.upsert:tenant-a:claim-1',
      'memory.relation.upsert:tenant-a:relation-1',
      'vector.search:semantic_memory:0.25,0.75:{"metadata":{"namespace":"tenant-a"}}',
      'memory.claim.get:tenant-a:claim-1',
      'memory.event.get:tenant-a:event-1',
      'memory.relation.query:tenant-a:from=claim:claim-1:to=none:5',
      'memory.relation.query:tenant-a:from=none:to=claim:claim-1:5',
      'memory.relation.query:tenant-a:from=event:event-1:to=none:5',
      'memory.relation.query:tenant-a:from=none:to=event:event-1:5',
    ]);
  });
});
