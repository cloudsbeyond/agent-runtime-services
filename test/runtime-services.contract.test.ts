import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createDefaultModelProviderConfig,
  createRuntimeServices,
} from '../src/index';
import { createVolcengineAgentPlanProvider } from '../src/models/catalog';
import { createLocalArtifactStore } from '../src/storage/artifact-store';
import { createSqliteRecordStore } from '../src/storage/record-store';
import { createVectorIndex } from '../src/storage/vector-index';

const okResponse = (body: unknown): Response => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

describe('runtime services contract', () => {
  test('default provider config does not contain plaintext API keys', () => {
    const provider = createVolcengineAgentPlanProvider();
    const config = createDefaultModelProviderConfig();

    expect(JSON.stringify(provider)).not.toContain('ark-');
    expect(JSON.stringify(config)).not.toContain('"apiKey"');
    expect(provider.apiKeyRef).toEqual({ source: 'exec', provider: 'runtime-services', id: 'ARK_API_KEY' });
  });

  test('missing model resource returns a missing_resource result', async () => {
    const services = createRuntimeServices({
      modelConfig: createDefaultModelProviderConfig(),
      runtime: { env: {}, getSecret: async () => undefined },
    });

    await expect(services.language.complete({ input: 'reply only: pong' })).resolves.toMatchObject({
      status: 'missing_resource',
      capabilityId: 'language.complete',
      providerId: 'volcengine-agent-plan',
      modelId: 'deepseek-v4-pro',
    });
    await expect(services.vision.generateImage({ prompt: 'blue dot' })).resolves.toMatchObject({
      status: 'missing_resource',
      capabilityId: 'vision.generateImage',
      providerId: 'volcengine-agent-plan',
      modelId: 'doubao-seedream-5.0-lite',
      evidence: [
        expect.objectContaining({
          kind: 'missing_resource',
          message: expect.stringContaining('missing API key for provider volcengine-agent-plan module vision'),
        }),
      ],
    });
    await expect(services.vector.search({
      tableName: 'semantic_memory',
      query: 'needle',
      limit: 1,
    })).resolves.toMatchObject({
      status: 'missing_resource',
      capabilityId: 'vector.search',
      providerId: 'volcengine-agent-plan',
      modelId: 'doubao-embedding-vision',
      results: [],
      evidence: [
        expect.objectContaining({
          kind: 'missing_resource',
          message: expect.stringContaining('missing API key for provider volcengine-agent-plan module embedding'),
        }),
      ],
    });
  });

  test('language, embedding, and image calls use mocked fetch with unified envelopes', async () => {
    const fetchCalls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      fetchCalls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/responses')) return okResponse({ output_text: '{"kind":"summary","text":"pong"}' });
      if (url.endsWith('/embeddings')) return okResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
      if (url.endsWith('/images/generations')) return okResponse({ data: [{ b64_json: Buffer.from('png').toString('base64') }] });
      throw new Error(`unexpected url: ${url}`);
    };
    const services = createRuntimeServices({
      modelConfig: createDefaultModelProviderConfig(),
      runtime: { env: { ARK_API_KEY: 'test-key' } },
      fetch: fetchImpl,
    });

    await expect(services.language.complete({ input: 'reply only: pong' })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'language.complete',
      providerId: 'volcengine-agent-plan',
      modelId: 'deepseek-v4-pro',
      proposal: { kind: 'text', text: '{"kind":"summary","text":"pong"}' },
    });
    await expect(services.embedding.create({ input: 'runtime services smoke' })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'embedding.create',
      providerId: 'volcengine-agent-plan',
      modelId: 'doubao-embedding-vision',
      embedding: [0.1, 0.2, 0.3],
    });
    await expect(services.vision.generateImage({ prompt: 'blue dot' })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vision.generateImage',
      providerId: 'volcengine-agent-plan',
      modelId: 'doubao-seedream-5.0-lite',
      artifact: { kind: 'image' },
    });
    expect(fetchCalls).toContain('POST https://ark.cn-beijing.volces.com/api/plan/v3/responses');
  });

  test('artifact and vector storage work under an explicit runtime home', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-'));
    const services = createRuntimeServices({
      runtimeHome,
      fetch: async (url) => {
        if (url === 'https://example.test/image.png?fixture=download') {
          return new Response('image-bytes', {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          });
        }
        return new Response('{}', { status: 404 });
      },
    });

    const artifact = await services.artifact.save({
      namespace: 'contract-test',
      body: 'hello',
      mimeType: 'text/plain',
      source: { kind: 'contract_test' },
    });
    expect(artifact).toMatchObject({
      status: 'ok',
      capabilityId: 'artifact.save',
      providerId: 'local-fs+sqlite',
    });

    const listed = await services.artifact.list({ namespace: 'contract-test' });
    expect(listed.status).toBe('ok');
    expect(listed.artifacts.map((item) => item.id)).toContain(artifact.artifact?.id);
    expect(String(await readFile(join(runtimeHome, 'db', 'artifacts.sqlite')))).not.toContain('hello');

    const downloaded = await services.artifact.save({
      namespace: 'contract-test',
      sourceUrl: 'https://example.test/image.png?fixture=download',
      source: { kind: 'contract_test_url' },
    });
    expect(downloaded).toMatchObject({
      status: 'ok',
      capabilityId: 'artifact.save',
      artifact: {
        mimeType: 'image/png',
        sizeBytes: 11,
        source: { kind: 'contract_test_url' },
      },
    });

    await expect(services.artifact.cleanupExpired({
      namespace: 'contract-test',
      now: '2026-05-28T09:00:00.000Z',
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'artifact.cleanupExpired',
      providerId: 'local-fs+sqlite',
      deleted: [],
    });

    await expect(services.vector.upsert({
      tableName: 'contract_test_vectors',
      id: 'doc-1',
      content: 'hello vector',
      embedding: [0.1, 0.2, 0.3],
      metadata: { kind: 'contract_test' },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vector.upsert',
      providerId: 'local-lancedb',
    });

    await expect(services.vector.search({
      tableName: 'contract_test_vectors',
      embedding: [0.1, 0.2, 0.3],
      limit: 1,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vector.search',
      providerId: 'local-lancedb',
      results: [{ id: 'doc-1' }],
    });

    await expect(services.record.upsert({
      namespace: 'contract-test',
      tableName: 'runs',
      id: 'run-1',
      data: { status: 'ok', artifactId: artifact.artifact?.id },
      metadata: { kind: 'contract_test' },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'record.upsert',
      providerId: 'local-sqlite-record',
      record: {
        namespace: 'contract-test',
        tableName: 'runs',
        id: 'run-1',
        data: { status: 'ok', artifactId: artifact.artifact?.id },
      },
    });
    await expect(services.record.get({
      namespace: 'contract-test',
      tableName: 'runs',
      id: 'run-1',
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'record.get',
      record: { id: 'run-1', metadata: { kind: 'contract_test' } },
    });
    await expect(services.record.query({
      namespace: 'contract-test',
      tableName: 'runs',
      limit: 10,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'record.query',
      records: [expect.objectContaining({ id: 'run-1' })],
    });
    expect(String(await readFile(join(runtimeHome, 'db', 'records.sqlite')))).not.toContain('hello');
  });

  test('storage rejects user data operations without explicit isolation keys', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-required-isolation-'));
    const services = createRuntimeServices({ runtimeHome });

    await expect(services.artifact.save(undefined as never)).resolves.toMatchObject({
      status: 'failed',
      evidence: [expect.objectContaining({ message: 'namespace is required' })],
    });
    await expect(services.artifact.save({
      body: 'missing namespace',
      mimeType: 'text/plain',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      evidence: [expect.objectContaining({ message: 'namespace is required' })],
    });
    await expect(services.artifact.save({
      namespace: 'tenant-a',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      evidence: [expect.objectContaining({ message: 'artifact.save requires either body with mimeType or sourceUrl' })],
    });
    await expect(services.artifact.save({
      namespace: 'tenant-a',
      body: 'missing mime type',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      evidence: [expect.objectContaining({ message: 'mimeType is required' })],
    });
    await expect(services.artifact.list({} as never)).resolves.toMatchObject({
      status: 'failed',
      artifacts: [],
      evidence: [expect.objectContaining({ message: 'namespace is required' })],
    });
    await expect(services.artifact.cleanupExpired({ now: '2026-05-28T09:00:00.000Z' } as never)).resolves.toMatchObject({
      status: 'failed',
      deleted: [],
      evidence: [expect.objectContaining({ message: 'namespace is required' })],
    });
    await expect(services.vector.upsert({
      id: 'doc-1',
      content: 'missing table',
      embedding: [1, 0],
    } as never)).resolves.toMatchObject({
      status: 'failed',
      evidence: [expect.objectContaining({ message: 'tableName is required' })],
    });
    await expect(services.vector.search({
      embedding: [1, 0],
    } as never)).resolves.toMatchObject({
      status: 'failed',
      results: [],
      evidence: [expect.objectContaining({ message: 'tableName is required' })],
    });
    await expect(services.record.upsert({
      tableName: 'records',
      id: 'doc-1',
      data: {},
    } as never)).resolves.toMatchObject({
      status: 'failed',
      evidence: [expect.objectContaining({ message: 'namespace is required' })],
    });
    await expect(services.record.upsert({
      namespace: 'tenant-a',
      id: 'doc-1',
      data: {},
    } as never)).resolves.toMatchObject({
      status: 'failed',
      evidence: [expect.objectContaining({ message: 'tableName is required' })],
    });
    await expect(services.record.get({
      namespace: 'tenant-a',
      tableName: 'records',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      evidence: [expect.objectContaining({ message: 'id is required' })],
    });
    await expect(services.record.upsert({
      namespace: 'tenant-a',
      tableName: 'records',
      id: 'doc-1',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      evidence: [expect.objectContaining({ message: 'data is required' })],
    });
    await expect(services.record.upsert({
      namespace: 'tenant-a',
      tableName: 'records',
      id: 'doc-1',
      data: 'not an object',
    } as never)).resolves.toMatchObject({
      status: 'failed',
      evidence: [expect.objectContaining({ message: 'data must be a JSON object' })],
    });
  });

  test('artifact storage is filtered and cleaned by namespace', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-artifact-namespace-'));
    const services = createRuntimeServices({ runtimeHome });

    const tenantA = await services.artifact.save({
      namespace: 'tenant-a',
      body: 'tenant a artifact',
      mimeType: 'text/plain',
      source: { kind: 'contract_test' },
      expiresAt: '2026-06-08T08:30:00.000Z',
    });
    const tenantB = await services.artifact.save({
      namespace: 'tenant-b',
      body: 'tenant b artifact',
      mimeType: 'text/plain',
      source: { kind: 'contract_test' },
      expiresAt: '2026-06-08T08:30:00.000Z',
    });

    await expect(services.artifact.list({ namespace: 'tenant-a' })).resolves.toMatchObject({
      status: 'ok',
      artifacts: [
        expect.objectContaining({
          id: tenantA.artifact?.id,
          namespace: 'tenant-a',
        }),
      ],
    });
    const tenantBArtifacts = await services.artifact.list({ namespace: 'tenant-b' });
    expect(tenantBArtifacts.artifacts.map((artifact) => artifact.id)).toEqual([tenantB.artifact?.id]);

    await expect(services.artifact.cleanupExpired({
      namespace: 'tenant-a',
      now: '2026-06-08T09:00:00.000Z',
    })).resolves.toMatchObject({
      status: 'ok',
      deleted: [expect.objectContaining({ id: tenantA.artifact?.id, namespace: 'tenant-a' })],
    });
    await expect(services.artifact.list({ namespace: 'tenant-a' })).resolves.toMatchObject({
      status: 'ok',
      artifacts: [],
    });
    await expect(services.artifact.list({ namespace: 'tenant-b' })).resolves.toMatchObject({
      status: 'ok',
      artifacts: [expect.objectContaining({ id: tenantB.artifact?.id })],
    });
  });

  test('local artifact store rejects invalid expiration dates when used directly', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-artifact-direct-date-'));
    const artifactStore = createLocalArtifactStore({
      artifactsDir: join(runtimeHome, 'artifacts'),
      manifestDbPath: join(runtimeHome, 'db', 'artifacts.sqlite'),
    });

    await expect(artifactStore.save({
      namespace: 'tenant-a',
      body: 'invalid expiration',
      mimeType: 'text/plain',
      expiresAt: 'not-a-date',
    })).rejects.toThrow('expiresAt');
  });

  test('local artifact store rejects non-string isolation keys when used directly', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-artifact-direct-shape-'));
    const artifactStore = createLocalArtifactStore({
      artifactsDir: join(runtimeHome, 'artifacts'),
      manifestDbPath: join(runtimeHome, 'db', 'artifacts.sqlite'),
    });

    await expect(artifactStore.save({
      namespace: 1,
      body: 'invalid namespace',
      mimeType: 'text/plain',
    } as never)).rejects.toThrow('namespace must be a string');
  });

  test('record query honors a zero result limit', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-record-limit-'));
    const services = createRuntimeServices({ runtimeHome });

    await services.record.upsert({
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
      data: { status: 'open' },
    });

    await expect(services.record.query({
      namespace: 'tenant-a',
      tableName: 'orders',
      limit: 0,
    })).resolves.toMatchObject({
      status: 'ok',
      records: [],
    });
  });

  test('local record store rejects invalid query limits when used directly', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-record-direct-limit-'));
    const recordStore = createSqliteRecordStore({
      recordDbPath: join(runtimeHome, 'db', 'records.sqlite'),
    });

    await recordStore.upsert({
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
      data: { status: 'open' },
    });

    await expect(recordStore.query({
      namespace: 'tenant-a',
      tableName: 'orders',
      limit: -1,
    })).rejects.toThrow('limit');
  });

  test('local record store rejects non-string isolation keys when used directly', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-record-direct-shape-'));
    const recordStore = createSqliteRecordStore({
      recordDbPath: join(runtimeHome, 'db', 'records.sqlite'),
    });

    await expect(recordStore.upsert({
      namespace: 1,
      tableName: 'orders',
      id: 'order-1',
      data: { status: 'open' },
    } as never)).rejects.toThrow('namespace must be a string');
    await expect(recordStore.upsert({
      namespace: 'tenant-a',
      tableName: 1,
      id: 'order-1',
      data: { status: 'open' },
    } as never)).rejects.toThrow('tableName must be a string');
    await expect(recordStore.upsert({
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 1,
      data: { status: 'open' },
    } as never)).rejects.toThrow('id must be a string');
  });

  test('vector search is isolated by explicit table name', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-vector-table-'));
    const services = createRuntimeServices({ runtimeHome });

    await expect(services.vector.upsert({
      tableName: 'tenant_a_vectors',
      id: 'doc-1',
      content: 'tenant a vector',
      embedding: [1, 0],
      metadata: { kind: 'contract_test' },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vector.upsert',
      providerId: 'local-lancedb',
    });
    await expect(services.vector.upsert({
      tableName: 'tenant_b_vectors',
      id: 'doc-1',
      content: 'tenant b vector',
      embedding: [0, 1],
      metadata: { kind: 'contract_test' },
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vector.upsert',
      providerId: 'local-lancedb',
    });

    await expect(services.vector.search({
      tableName: 'tenant_a_vectors',
      embedding: [1, 0],
      limit: 1,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vector.search',
      providerId: 'local-lancedb',
      results: [expect.objectContaining({ id: 'doc-1', content: 'tenant a vector', embedding: [1, 0] })],
    });
    await expect(services.vector.search({
      tableName: 'tenant_b_vectors',
      embedding: [0, 1],
      limit: 1,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vector.search',
      providerId: 'local-lancedb',
      results: [expect.objectContaining({ id: 'doc-1', content: 'tenant b vector', embedding: [0, 1] })],
    });
  });

  test('vector search filters by exact top-level metadata values', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-vector-filter-'));
    const services = createRuntimeServices({ runtimeHome });

    await services.vector.upsert({
      tableName: 'hybrid_vectors',
      id: 'doc-alpha',
      content: 'alpha architecture note',
      embedding: [1, 0],
      metadata: { project: 'alpha', kind: 'note', pinned: true, rank: 1 },
    });
    await services.vector.upsert({
      tableName: 'hybrid_vectors',
      id: 'doc-beta',
      content: 'beta architecture note',
      embedding: [1, 0],
      metadata: { project: 'beta', kind: 'note', pinned: true, rank: 1 },
    });

    const filtered = await services.vector.search({
      tableName: 'hybrid_vectors',
      embedding: [1, 0],
      limit: 10,
      filter: { metadata: { project: 'alpha', kind: 'note', pinned: true, rank: 1 } },
    });
    expect(filtered).toMatchObject({
      status: 'ok',
      capabilityId: 'vector.search',
      providerId: 'local-lancedb',
    });
    expect(filtered.results.map((result) => result.id)).toEqual(['doc-alpha']);
    expect(filtered.results[0]).toMatchObject({
      content: 'alpha architecture note',
      metadata: expect.objectContaining({ project: 'alpha' }),
    });

    const noMatch = await services.vector.search({
      tableName: 'hybrid_vectors',
      embedding: [1, 0],
      limit: 10,
      filter: { metadata: { project: 'missing' } },
    });
    expect(noMatch).toMatchObject({
      status: 'ok',
      results: [],
    });
  });

  test('vector search honors a zero result limit', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-vector-zero-limit-'));
    const services = createRuntimeServices({ runtimeHome });

    await services.vector.upsert({
      tableName: 'zero_limit_vectors',
      id: 'doc-1',
      content: 'zero limit vector',
      embedding: [1, 0],
    });

    await expect(services.vector.search({
      tableName: 'zero_limit_vectors',
      embedding: [1, 0],
      limit: 0,
    })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vector.search',
      results: [],
    });
  });

  test('local vector index rejects invalid limits when used directly', async () => {
    const vectorDir = await mkdtemp(join(tmpdir(), 'agent-runtime-services-vector-direct-'));
    const vectorIndex = createVectorIndex({ vectorDir });

    await vectorIndex.upsert({
      id: 'doc-1',
      content: 'direct vector',
      embedding: [1, 0],
    }, {
      tableName: 'direct_vectors',
    });

    await expect(vectorIndex.search([1, 0], {
      tableName: 'direct_vectors',
      limit: -1,
    })).rejects.toThrow('limit');
    await expect(vectorIndex.search([1, 0], {
      tableName: 'direct_vectors',
      limit: 0,
    })).resolves.toEqual([]);
  });

  test('local vector index rejects non-string table names when used directly', async () => {
    const vectorDir = await mkdtemp(join(tmpdir(), 'agent-runtime-services-vector-direct-shape-'));
    const vectorIndex = createVectorIndex({ vectorDir });

    await expect(vectorIndex.upsert({
      id: 'doc-1',
      content: 'direct vector',
      embedding: [1, 0],
    }, {
      tableName: 1,
    } as never)).rejects.toThrow('tableName must be a string');
    await expect(vectorIndex.search([1, 0], {
      tableName: 1,
    } as never)).rejects.toThrow('tableName must be a string');
  });

  test('local vector index rejects non-array embeddings when used directly', async () => {
    const vectorDir = await mkdtemp(join(tmpdir(), 'agent-runtime-services-vector-direct-embedding-shape-'));
    const vectorIndex = createVectorIndex({ vectorDir });

    await expect(vectorIndex.upsert({
      id: 'doc-1',
      content: 'direct vector',
      embedding: 'not-array',
    } as never, {
      tableName: 'direct_vectors',
    })).rejects.toThrow('embedding must contain finite numbers');
    await expect(vectorIndex.search('not-array' as never, {
      tableName: 'direct_vectors',
    })).rejects.toThrow('embedding must contain finite numbers');
  });

  test('resource status, doctor, and smoke keep method identity and do not leak secrets', async () => {
    const secret = 'ark-secret-value-that-must-not-print';
    const services = createRuntimeServices({
      modelConfig: createDefaultModelProviderConfig(),
      runtime: { env: { ARK_API_KEY: secret } },
      availableSecretIds: new Set(),
    });

    await expect(services.resources.list()).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'resources.list',
    });
    const doctor = await services.resources.doctor();
    const smoke = await services.resources.smoke();
    const status = await services.resources.status();

    expect(doctor.capabilityId).toBe('resources.doctor');
    expect(smoke.capabilityId).toBe('resources.smoke');
    expect(status.capabilityId).toBe('resources.status');
    expect(JSON.stringify([doctor, smoke, status])).not.toContain(secret);
  });

  test('runtime home scoped keystore secrets make image generation available', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-secret-'));
    const services = createRuntimeServices({
      runtimeHome,
      modelConfig: createDefaultModelProviderConfig(),
      runtime: { env: {} },
      fetch: async (url, init) => {
        expect(String(url)).toBe('https://ark.cn-beijing.volces.com/api/plan/v3/images/generations');
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer runtime-home-secret' });
        return okResponse({ data: [{ url: 'https://example.test/generated.png' }] });
      },
    });
    await import('../src/config/keystore').then(({ setSecret }) => setSecret('ARK_API_KEY', 'runtime-home-secret', {
      secretsFile: join(runtimeHome, 'secrets.enc'),
      keystoreSaltFile: join(runtimeHome, '.keystore.salt'),
    }));

    await expect(services.resources.status()).resolves.toMatchObject({
      status: 'ok',
      resources: expect.arrayContaining([
        expect.objectContaining({
          id: 'model.image_generation',
          status: 'available',
          provider: 'volcengine-agent-plan:doubao-seedream-5.0-lite',
        }),
      ]),
    });
    await expect(services.vision.generateImage({ prompt: 'blue dot' })).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'vision.generateImage',
      artifact: { kind: 'image', url: 'https://example.test/generated.png' },
    });
  });
});
