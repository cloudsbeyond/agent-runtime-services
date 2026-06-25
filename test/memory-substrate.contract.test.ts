import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createRuntimeServices,
  createRuntimeServicesRpcClient,
  startRuntimeServicesRpcServer,
  type MemoryStorePort,
  type VectorStore,
} from '../src/index';
import { createSqliteMemoryStore } from '../src/storage/memory-store';

describe('memory substrate contract', () => {
  test('local runtime persists replayable events, claims, relationships, and retrieval bundles', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-memory-'));
    const services = createRuntimeServices({
      runtimeHome,
      modelGateway: {
        providerId: 'memory-contract-model',
        complete: async () => ({
          moduleId: 'language',
          providerId: 'memory-contract-model',
          modelId: 'language-test',
          text: 'not used',
          raw: {},
        }),
        createEmbedding: async () => ({
          moduleId: 'embedding',
          providerId: 'memory-contract-model',
          modelId: 'embedding-test',
          embedding: [1, 0],
          raw: {},
        }),
        generateImage: async () => ({
          moduleId: 'vision',
          providerId: 'memory-contract-model',
          modelId: 'image-test',
          raw: {},
        }),
      },
    });

    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      id: 'event-1',
      source: { kind: 'meeting', ref: 'meeting://alpha/1' },
      actor: { kind: 'person', id: 'owner-a' },
      occurredAt: '2026-06-23T08:00:00.000Z',
      payload: { text: 'Acme can wait if legal signs off.' },
      policy: { raw: 'restricted', summary: 'internal', action: 'requires_approval' },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.event.append',
      providerId: 'local-sqlite-memory',
      event: {
        namespace: 'tenant-a',
        id: 'event-1',
        source: { kind: 'meeting', ref: 'meeting://alpha/1' },
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        policy: { raw: 'restricted', summary: 'internal', action: 'requires_approval' },
      },
    });

    await expect(services.memory.event.list({
      namespace: 'tenant-a',
      limit: 10,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.event.list',
      events: [expect.objectContaining({ id: 'event-1' })],
    });

    await expect(services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'commitment',
      subject: { kind: 'account', id: 'acme' },
      statement: 'Acme can wait if legal signs off.',
      evidence: [{ kind: 'event', id: 'event-1' }],
      confidence: 0.82,
      status: 'unverified',
      freshness: 'active',
      owner: { kind: 'team', id: 'sales' },
      policy: { raw: 'restricted', summary: 'internal', action: 'requires_approval' },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.claim.upsert',
      providerId: 'local-sqlite-memory',
      claim: {
        namespace: 'tenant-a',
        id: 'claim-1',
        status: 'unverified',
        evidence: [{ kind: 'event', id: 'event-1' }],
      },
    });

    await expect(services.memory.relation.upsert({
      namespace: 'tenant-a',
      id: 'relation-1',
      type: 'supports',
      from: { kind: 'claim', id: 'claim-1' },
      to: { kind: 'event', id: 'event-1' },
      evidence: [{ kind: 'event', id: 'event-1' }],
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.relation.upsert',
      providerId: 'local-sqlite-memory',
      relation: {
        namespace: 'tenant-a',
        id: 'relation-1',
        type: 'supports',
      },
    });

    await services.vector.upsert({
      tableName: 'tenant_a_memory',
      id: 'vector-claim-1',
      content: 'Acme can wait if legal signs off.',
      embedding: [1, 0],
      metadata: { namespace: 'tenant-a', claimId: 'claim-1', eventId: 'event-1' },
    });

    await expect(services.memory.context.retrieve({
      namespace: 'tenant-a',
      tableName: 'tenant_a_memory',
      query: 'what should I know about Acme?',
      limit: 1,
      relationshipLimit: 5,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.context.retrieve',
      providerId: 'local-sqlite-memory+local-lancedb',
      modelId: 'embedding-test',
      bundle: {
        candidates: [expect.objectContaining({ id: 'vector-claim-1' })],
        claims: [expect.objectContaining({ id: 'claim-1', confidence: 0.82 })],
        events: [expect.objectContaining({ id: 'event-1' })],
        relations: [expect.objectContaining({ id: 'relation-1' })],
        policy: {
          objects: expect.arrayContaining([
            expect.objectContaining({
              kind: 'claim',
              id: 'claim-1',
              policy: { raw: 'restricted', summary: 'internal', action: 'requires_approval' },
            }),
          ]),
        },
      },
    });
  });

  test('context retrieval constrains vector recall to the requested memory namespace', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-memory-isolation-'));
    const services = createRuntimeServices({
      runtimeHome,
      modelGateway: {
        providerId: 'memory-isolation-model',
        complete: async () => ({
          moduleId: 'language',
          providerId: 'memory-isolation-model',
          modelId: 'language-test',
          text: 'not used',
          raw: {},
        }),
        createEmbedding: async () => ({
          moduleId: 'embedding',
          providerId: 'memory-isolation-model',
          modelId: 'embedding-test',
          embedding: [1, 0],
          raw: {},
        }),
        generateImage: async () => ({
          moduleId: 'vision',
          providerId: 'memory-isolation-model',
          modelId: 'image-test',
          raw: {},
        }),
      },
    });

    await services.memory.event.append({
      namespace: 'tenant-a',
      id: 'event-a',
      source: { kind: 'doc', ref: 'doc://tenant-a' },
      payload: { text: 'tenant a evidence' },
    });
    await services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-a',
      kind: 'note',
      subject: { kind: 'tenant', id: 'a' },
      statement: 'tenant a evidence',
      evidence: [{ kind: 'event', id: 'event-a' }],
      confidence: 0.7,
    });
    await services.vector.upsert({
      tableName: 'shared_memory',
      id: 'tenant-a-vector',
      content: 'tenant a vector',
      embedding: [0, 1],
      metadata: { namespace: 'tenant-a', claimId: 'claim-a', eventId: 'event-a' },
    });
    await services.vector.upsert({
      tableName: 'shared_memory',
      id: 'tenant-b-vector',
      content: 'tenant b vector should not leak',
      embedding: [1, 0],
      metadata: { namespace: 'tenant-b', claimId: 'claim-b', eventId: 'event-b' },
    });

    await expect(services.memory.context.retrieve({
      namespace: 'tenant-a',
      tableName: 'shared_memory',
      query: 'nearest embedding belongs to tenant b',
      limit: 1,
    })).resolves.toMatchObject({
      status: 'ok',
      bundle: {
        candidates: [expect.objectContaining({ id: 'tenant-a-vector' })],
        claims: [expect.objectContaining({ id: 'claim-a' })],
        events: [expect.objectContaining({ id: 'event-a' })],
      },
    });
  });

  test('context retrieval filters provider candidates after vector recall to preserve namespace isolation', async () => {
    const calls: string[] = [];
    const vectorStore: VectorStore = {
      providerId: 'namespace-ignoring-vector',
      upsert: async () => {
        throw new Error('not used');
      },
      search: async (_embedding, options) => {
        calls.push(`vector.search:${JSON.stringify(options.filter ?? {})}`);
        return [
          {
            id: 'tenant-b-vector',
            content: 'tenant b vector should not be returned',
            embedding: [1, 0],
            metadata: { namespace: 'tenant-b', claimId: 'claim-b', eventId: 'event-b' },
            score: 1,
            createdAt: '2026-06-23T00:00:00.000Z',
            updatedAt: '2026-06-23T00:00:00.000Z',
          },
          {
            id: 'tenant-a-vector',
            content: 'tenant a vector',
            embedding: [0, 1],
            metadata: { namespace: 'tenant-a', claimId: 'claim-a', eventId: 'event-a' },
            score: 0.5,
            createdAt: '2026-06-23T00:00:00.000Z',
            updatedAt: '2026-06-23T00:00:00.000Z',
          },
        ];
      },
    };
    const services = createRuntimeServices({
      ports: { vectorStore },
      memoryStore: createSqliteMemoryStore({
        memoryDbPath: join(await mkdtemp(join(tmpdir(), 'agent-runtime-services-memory-post-filter-')), 'db', 'memory.sqlite'),
      }),
    });

    await services.memory.event.append({
      namespace: 'tenant-a',
      id: 'event-a',
      source: { kind: 'doc', ref: 'doc://tenant-a' },
      payload: { text: 'tenant a evidence' },
    });
    await services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-a',
      kind: 'note',
      subject: { kind: 'tenant', id: 'a' },
      statement: 'tenant a evidence',
      evidence: [{ kind: 'event', id: 'event-a' }],
      confidence: 0.7,
    });

    await expect(services.memory.context.retrieve({
      namespace: 'tenant-a',
      tableName: 'shared_memory',
      embedding: [1, 0],
      limit: 2,
    })).resolves.toMatchObject({
      status: 'ok',
      bundle: {
        candidates: [expect.objectContaining({ id: 'tenant-a-vector' })],
        claims: [expect.objectContaining({ id: 'claim-a' })],
        events: [expect.objectContaining({ id: 'event-a' })],
      },
    });
    expect(calls).toEqual([
      'vector.search:{"metadata":{"namespace":"tenant-a"}}',
    ]);
  });

  test('context retrieval surfaces memory store failures during hydration', async () => {
    const services = createRuntimeServices({
      ports: {
        vectorStore: {
          providerId: 'memory-hydration-vector',
          upsert: async () => {
            throw new Error('not used');
          },
          search: async (embedding, options) => [{
            id: 'doc-1',
            content: 'matched content',
            embedding,
            metadata: { namespace: 'tenant-a', claimId: 'claim-1' },
            score: 1,
            createdAt: '2026-06-23T00:00:00.000Z',
            updatedAt: '2026-06-23T00:00:00.000Z',
          }],
        },
        memoryStore: unavailableMemoryStore('memory store unavailable'),
      },
    });

    await expect(services.memory.context.retrieve({
      namespace: 'tenant-a',
      tableName: 'tenant_memory',
      embedding: [1, 0],
      limit: 1,
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.context.retrieve',
      evidence: [expect.objectContaining({ message: 'memory store unavailable' })],
      bundle: {
        candidates: [],
        claims: [],
        events: [],
        relations: [],
      },
    });
  });

  test('local memory event replay follows append order when timestamps tie', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-memory-order-'));
    const services = createRuntimeServices({
      runtimeHome,
      memoryStore: createSqliteMemoryStore({
        memoryDbPath: join(runtimeHome, 'db', 'memory.sqlite'),
        now: () => new Date('2026-06-23T00:00:00.000Z'),
      }),
    });

    await services.memory.event.append({
      namespace: 'tenant-a',
      id: 'event-b',
      source: { kind: 'doc', ref: 'doc://event-b' },
      payload: { text: 'first event' },
    });
    await services.memory.event.append({
      namespace: 'tenant-a',
      id: 'event-a',
      source: { kind: 'doc', ref: 'doc://event-a' },
      payload: { text: 'second event' },
    });

    await expect(services.memory.event.list({
      namespace: 'tenant-a',
      limit: 10,
    })).resolves.toMatchObject({
      status: 'ok',
      events: [
        expect.objectContaining({ id: 'event-b' }),
        expect.objectContaining({ id: 'event-a' }),
      ],
    });
  });

  test('local memory store rejects invalid optional contract values before persistence', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-memory-adapter-validation-'));
    const memoryStore = createSqliteMemoryStore({
      memoryDbPath: join(runtimeHome, 'db', 'memory.sqlite'),
    });

    await expect(memoryStore.upsertClaim({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'note',
      subject: { kind: 'doc', id: 'doc-1' },
      statement: 'hello',
      evidence: [{ kind: 'event', id: 'event-1' }],
      confidence: 0.7,
      status: 'promoted',
    } as never)).rejects.toThrow('status');
    await expect(memoryStore.queryClaims({
      namespace: 'tenant-a',
      status: 'promoted',
    } as never)).rejects.toThrow('status');
    await expect(memoryStore.queryClaims({
      namespace: 'tenant-a',
      kind: '',
    })).rejects.toThrow('kind');
    await expect(memoryStore.queryRelations({
      namespace: 'tenant-a',
      type: '',
    })).rejects.toThrow('type');
    await expect(memoryStore.listEvents({
      namespace: 'tenant-a',
      limit: -1,
    })).rejects.toThrow('limit');
    await expect(memoryStore.appendEvent({
      namespace: 'tenant-a',
      source: { ref: 'doc://1' },
    } as never)).rejects.toThrow('source.kind');
    await expect(memoryStore.appendEvent({
      namespace: 'tenant-a',
      source: { kind: 1, ref: 'doc://1' },
    } as never)).rejects.toThrow('source.kind must be a string');
    await expect(memoryStore.appendEvent({
      namespace: 'tenant-a',
      source: { kind: 'doc' },
    } as never)).rejects.toThrow('source.ref');
    await expect(memoryStore.appendEvent({
      namespace: 'tenant-a',
      source: { kind: 'doc', ref: 'doc://1' },
      occurredAt: 'not-a-date',
    })).rejects.toThrow('occurredAt');
    await expect(memoryStore.appendEvent({
      namespace: 'tenant-a',
      source: { kind: 'doc', ref: 'doc://1' },
      artifact: { kind: 'artifact', id: 'artifact-1', extra: true },
    } as never)).rejects.toThrow('artifact.extra');
    await expect(memoryStore.appendEvent({
      namespace: 'tenant-a',
      source: { kind: 'doc', ref: 'doc://1' },
      artifact: { kind: 'artifact', id: 1 },
    } as never)).rejects.toThrow('artifact.id must be a string');
    await expect(memoryStore.upsertClaim({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'note',
      subject: { kind: 'doc', id: 'doc-1' },
      statement: 'hello',
      evidence: [{ kind: 'event', id: 'event-1', extra: true }],
      confidence: 0.7,
    } as never)).rejects.toThrow('evidence[0].extra');
    await expect(memoryStore.upsertClaim({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'note',
      subject: { kind: 'doc', id: 'doc-1' },
      statement: 'hello',
      evidence: [{ kind: 'event', id: 'event-1' }],
      confidence: 0.7,
      freshness: ['not-string'],
    } as never)).rejects.toThrow('freshness must be a string');
    await expect(memoryStore.upsertRelation({
      namespace: 'tenant-a',
      id: 'relation-1',
      type: 'supports',
      from: { kind: 'claim', id: 'claim-1', extra: true },
      to: { kind: 'event', id: 'event-1' },
    } as never)).rejects.toThrow('from.extra');
  });

  test('context retrieval honors a zero result limit without provider calls', async () => {
    const calls: string[] = [];
    const services = createRuntimeServices({
      ports: {
        vectorStore: {
          providerId: 'zero-limit-vector',
          upsert: async () => {
            calls.push('vector.upsert');
            throw new Error('provider should not be called');
          },
          search: async () => {
            calls.push('vector.search');
            throw new Error('provider should not be called');
          },
        },
        memoryStore: unavailableMemoryStore('memory store should not be called'),
      },
    });

    await expect(services.memory.context.retrieve({
      namespace: 'tenant-a',
      tableName: 'tenant_memory',
      embedding: [1, 0],
      limit: 0,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.context.retrieve',
      providerId: 'unavailable-memory-store+zero-limit-vector',
      bundle: {
        candidates: [],
        claims: [],
        events: [],
        relations: [],
      },
    });
    expect(calls).toEqual([]);
  });

  test('memory provider port injection preserves L2 envelopes and records L3 calls', async () => {
    const calls: string[] = [];
    const services = createRuntimeServices({
      ports: {
        memoryStore: {
          providerId: 'memory-port',
          appendEvent: async (input) => {
            calls.push(`event.append:${input.namespace}:${input.id}`);
            return {
              namespace: input.namespace,
              id: input.id ?? 'event-generated',
              source: input.source,
              actor: input.actor ?? {},
              payload: input.payload ?? {},
              metadata: input.metadata ?? {},
              policy: input.policy ?? {},
              occurredAt: input.occurredAt ?? '2026-06-23T00:00:00.000Z',
              appendedAt: '2026-06-23T00:00:01.000Z',
              contentHash: 'a'.repeat(64),
            };
          },
          getEvent: async (input) => {
            calls.push(`event.get:${input.namespace}:${input.id}`);
            throw new Error('not used');
          },
          listEvents: async (input) => {
            calls.push(`event.list:${input.namespace}:${input.limit ?? 'none'}`);
            return [];
          },
          upsertClaim: async (input) => {
            calls.push(`claim.upsert:${input.namespace}:${input.id}`);
            return {
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
              createdAt: '2026-06-23T00:00:00.000Z',
              updatedAt: '2026-06-23T00:00:01.000Z',
            };
          },
          getClaim: async (input) => {
            calls.push(`claim.get:${input.namespace}:${input.id}`);
            throw new Error('not used');
          },
          queryClaims: async (input) => {
            calls.push(`claim.query:${input.namespace}:${input.limit ?? 'none'}`);
            return [];
          },
          upsertRelation: async (input) => {
            calls.push(`relation.upsert:${input.namespace}:${input.id}`);
            return {
              namespace: input.namespace,
              id: input.id,
              type: input.type,
              from: input.from,
              to: input.to,
              evidence: input.evidence ?? [],
              metadata: input.metadata ?? {},
              createdAt: '2026-06-23T00:00:00.000Z',
              updatedAt: '2026-06-23T00:00:01.000Z',
            };
          },
          queryRelations: async (input) => {
            calls.push(`relation.query:${input.namespace}:${input.limit ?? 'none'}`);
            return [];
          },
        },
      },
    });

    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      id: 'event-1',
      source: { kind: 'doc', ref: 'doc://1' },
      payload: { text: 'hello' },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.event.append',
      providerId: 'memory-port',
      event: { id: 'event-1' },
    });
    await expect(services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'note',
      subject: { kind: 'doc', id: 'doc-1' },
      statement: 'hello',
      evidence: [{ kind: 'event', id: 'event-1' }],
      confidence: 0.7,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.claim.upsert',
      providerId: 'memory-port',
      claim: { id: 'claim-1' },
    });
    await expect(services.memory.relation.upsert({
      namespace: 'tenant-a',
      id: 'relation-1',
      type: 'mentions',
      from: { kind: 'claim', id: 'claim-1' },
      to: { kind: 'event', id: 'event-1' },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'memory.relation.upsert',
      providerId: 'memory-port',
      relation: { id: 'relation-1' },
    });
    expect(calls).toEqual([
      'event.append:tenant-a:event-1',
      'claim.upsert:tenant-a:claim-1',
      'relation.upsert:tenant-a:relation-1',
    ]);
  });

  test('memory L2 validation rejects invalid contract inputs before provider ports', async () => {
    const calls: string[] = [];
    const services = createRuntimeServices({
      ports: {
        memoryStore: {
          providerId: 'memory-port',
          appendEvent: async () => {
            calls.push('event.append');
            throw new Error('provider should not be called');
          },
          getEvent: async () => {
            calls.push('event.get');
            throw new Error('provider should not be called');
          },
          listEvents: async () => {
            calls.push('event.list');
            return [];
          },
          upsertClaim: async () => {
            calls.push('claim.upsert');
            throw new Error('provider should not be called');
          },
          getClaim: async () => {
            calls.push('claim.get');
            throw new Error('provider should not be called');
          },
          queryClaims: async () => {
            calls.push('claim.query');
            return [];
          },
          upsertRelation: async () => {
            calls.push('relation.upsert');
            throw new Error('provider should not be called');
          },
          queryRelations: async () => {
            calls.push('relation.query');
            return [];
          },
        },
      },
      modelGateway: {
        providerId: 'memory-validation-model',
        complete: async () => {
          calls.push('model.complete');
          throw new Error('provider should not be called');
        },
        createEmbedding: async () => {
          calls.push('model.embedding');
          throw new Error('provider should not be called');
        },
        generateImage: async () => {
          calls.push('model.image');
          throw new Error('provider should not be called');
        },
      },
      vectorStore: {
        providerId: 'memory-validation-vector',
        upsert: async () => {
          calls.push('vector.upsert');
          throw new Error('provider should not be called');
        },
        search: async () => {
          calls.push('vector.search');
          throw new Error('provider should not be called');
        },
      },
    });

    await expect(services.memory.event.append({
      namespace: 'tenant-a',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.event.append',
    });
    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      source: { ref: 'doc://1' },
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.event.append',
      evidence: [expect.objectContaining({ message: expect.stringContaining('source.kind') })],
    });
    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      source: { kind: 1, ref: 'doc://1' },
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.event.append',
      evidence: [expect.objectContaining({ message: expect.stringContaining('source.kind must be a string') })],
    });
    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      source: { kind: 'doc' },
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.event.append',
      evidence: [expect.objectContaining({ message: expect.stringContaining('source.ref') })],
    });
    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      id: 'bad id',
      source: { kind: 'doc', ref: 'doc://1' },
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.event.append',
    });
    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      source: { kind: 'doc', ref: 'doc://1' },
      occurredAt: 'not-a-date',
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.event.append',
      evidence: [expect.objectContaining({ message: expect.stringContaining('occurredAt') })],
    });
    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      source: { kind: 'doc', ref: 'doc://1' },
      actor: ['not-object'],
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.event.append',
    });
    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      source: { kind: 'doc', ref: 'doc://1' },
      artifact: { kind: 'artifact', id: 'artifact-1', namespace: 'tenant-b' },
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.event.append',
    });
    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      source: { kind: 'doc', ref: 'doc://1' },
      artifact: { kind: 'artifact', id: 'artifact-1', extra: true },
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.event.append',
      evidence: [expect.objectContaining({ message: expect.stringContaining('artifact.extra') })],
    });
    await expect(services.memory.event.append({
      namespace: 'tenant-a',
      source: { kind: 'doc', ref: 'doc://1' },
      artifact: { kind: 'artifact', id: 1 },
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.event.append',
      evidence: [expect.objectContaining({ message: expect.stringContaining('artifact.id must be a string') })],
    });
    await expect(services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'note',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.claim.upsert',
    });
    await expect(services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'note',
      subject: { kind: 'doc', id: 'doc-1' },
      statement: 'hello',
      evidence: [{ kind: 'event', id: 'event-1' }],
      confidence: 0.7,
      status: 'promoted',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.claim.upsert',
    });
    await expect(services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'note',
      subject: { kind: 'doc', id: 'doc-1' },
      statement: 'hello',
      evidence: [{ kind: 'event', id: 'event-1', extra: true }],
      confidence: 0.7,
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.claim.upsert',
      evidence: [expect.objectContaining({ message: expect.stringContaining('evidence[0].extra') })],
    });
    await expect(services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'note',
      subject: { kind: 'doc', id: 'doc-1' },
      statement: 'hello',
      evidence: [{ kind: 'event', id: 'event-1' }],
      confidence: 0.7,
      supersedes: 'claim-0',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.claim.upsert',
    });
    await expect(services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'note',
      subject: { kind: 'doc', id: 'doc-1' },
      statement: 'hello',
      evidence: [{ kind: 'event', id: 'event-1', range: ['not-object'] }],
      confidence: 0.7,
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.claim.upsert',
    });
    await expect(services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'note',
      subject: { kind: 'doc', id: 'doc-1' },
      statement: 'hello',
      evidence: [{ kind: 'event', id: 'event-1' }],
      confidence: 0.7,
      policy: ['not-object'],
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.claim.upsert',
    });
    await expect(services.memory.claim.upsert({
      namespace: 'tenant-a',
      id: 'claim-1',
      kind: 'note',
      subject: { kind: 'doc', id: 'doc-1' },
      statement: 'hello',
      evidence: [{ kind: 'event', id: 'event-1' }],
      confidence: 0.7,
      freshness: ['not-string'],
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.claim.upsert',
      evidence: [expect.objectContaining({ message: 'freshness must be a string' })],
    });
    await expect(services.memory.claim.query({
      namespace: 'tenant-a',
      status: 'promoted',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.claim.query',
      claims: [],
    });
    await expect(services.memory.relation.upsert({
      namespace: 'tenant-a',
      id: 'relation-1',
      type: 'supports',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.relation.upsert',
    });
    await expect(services.memory.relation.upsert({
      namespace: 'tenant-a',
      id: 'relation-1',
      type: 'supports',
      from: { kind: 'claim', id: 'claim-1' },
      to: { kind: 'event', id: 'event-1' },
      metadata: ['not-object'],
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.relation.upsert',
    });
    await expect(services.memory.relation.upsert({
      namespace: 'tenant-a',
      id: 'relation-1',
      type: 'supports',
      from: { kind: 'claim', id: 'claim-1', extra: true },
      to: { kind: 'event', id: 'event-1' },
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.relation.upsert',
      evidence: [expect.objectContaining({ message: expect.stringContaining('from.extra') })],
    });
    await expect(services.memory.relation.query({
      namespace: 'tenant-a',
      from: { kind: 'claim', id: 'claim-1', namespace: 'tenant-b' },
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.relation.query',
      relations: [],
    });
    await expect(services.memory.event.list({
      namespace: 'tenant-a',
      limit: -1,
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.event.list',
      events: [],
    });
    await expect(services.memory.context.retrieve({
      namespace: 'tenant-a',
      tableName: 'tenant_memory',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.context.retrieve',
      bundle: {
        candidates: [],
        claims: [],
        events: [],
        relations: [],
      },
    });
    await expect(services.memory.context.retrieve({
      namespace: 'tenant-a',
      tableName: 'tenant_memory',
      embedding: [1, 0],
      limit: -1,
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.context.retrieve',
      bundle: {
        candidates: [],
        claims: [],
        events: [],
        relations: [],
      },
    });
    await expect(services.memory.relation.upsert({
      namespace: 'tenant-a',
      id: 'relation-cross-namespace',
      type: 'supports',
      from: { kind: 'claim', id: 'claim-1', namespace: 'tenant-b' },
      to: { kind: 'event', id: 'event-1' },
    } as never)).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'memory.relation.upsert',
    });
    expect(calls).toEqual([]);
  });

  test('RPC exposes memory capability descriptors and dispatches memory calls', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-memory-rpc-'));
    const services = createRuntimeServices({ runtimeHome });
    const server = await startRuntimeServicesRpcServer({ services, host: '127.0.0.1', port: 0 });
    try {
      const client = createRuntimeServicesRpcClient({ endpoint: `${server.url}/rpc` });
      await expect(client.call('capabilities.list', {})).resolves.toMatchObject({
        capabilities: expect.arrayContaining([
          'memory.event.append',
          'memory.claim.upsert',
          'memory.relation.upsert',
          'memory.context.retrieve',
        ]),
      });
      await expect(client.call('capabilities.describe', {})).resolves.toMatchObject({
        capabilities: expect.arrayContaining([
          expect.objectContaining({
            id: 'memory.context.retrieve',
            domain: 'memory',
            serviceLayer: 'agent-service',
            risk: 'external-provider',
            authority: {
              domainDecision: false,
              approval: false,
              toolChoice: false,
              sessionMutation: false,
            },
          }),
        ]),
      });
      await expect(client.call('memory.event.append', {
        namespace: 'tenant-a',
        id: 'event-1',
        source: { kind: 'doc', ref: 'doc://rpc' },
        payload: { text: 'rpc event' },
      })).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'memory.event.append',
        event: { id: 'event-1', namespace: 'tenant-a' },
      });
    } finally {
      await server.close();
    }
  });
});

function unavailableMemoryStore(message: string): MemoryStorePort {
  const fail = async () => {
    throw new Error(message);
  };
  return {
    providerId: 'unavailable-memory-store',
    appendEvent: fail,
    getEvent: fail,
    listEvents: fail,
    upsertClaim: fail,
    getClaim: fail,
    queryClaims: fail,
    upsertRelation: fail,
    queryRelations: fail,
  };
}
