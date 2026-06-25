import { Buffer } from 'node:buffer';
import { describe, expect, test } from 'vitest';
import {
  createRemoteArtifactManifestStore,
  createRemoteModelGateway,
  createRemoteObjectStore,
  createRemoteRecordStore,
  createRemoteVectorStore,
} from '../src/providers/remote';
import type { StoredArtifact } from '../src/storage/artifact-store';

describe('remote provider adapters', () => {
  test('object store sends namespace/key/body requests and surfaces remote errors', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const objectStore = createRemoteObjectStore({
      endpoint: 'https://remote.test/runtime',
      providerId: 'remote-object-test',
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url: String(url), body });
        if (String(url).endsWith('/objects/put')) {
          expect(body).toMatchObject({
            namespace: 'tenant-a',
            key: 'artifact.txt',
            bodyBase64: Buffer.from('hello').toString('base64'),
            mimeType: 'text/plain',
          });
          return jsonResponse({ path: 'remote://tenant-a/artifact.txt', sizeBytes: 5 });
        }
        if (String(url).endsWith('/objects/delete')) {
          expect(body).toEqual({ path: 'remote://tenant-a/artifact.txt' });
          return jsonResponse({ ok: true });
        }
        if (String(url).endsWith('/objects/get')) {
          expect(body).toEqual({ path: 'remote://tenant-a/artifact.txt' });
          return jsonResponse({ bodyBase64: Buffer.from('hello').toString('base64') });
        }
        return jsonResponse({ error: { message: 'unexpected remote route' } }, 404);
      },
    });

    await expect(objectStore.put({
      namespace: 'tenant-a',
      key: 'artifact.txt',
      body: 'hello',
      mimeType: 'text/plain',
    })).resolves.toEqual({
      path: 'remote://tenant-a/artifact.txt',
      sizeBytes: 5,
    });
    await expect(objectStore.get({ path: 'remote://tenant-a/artifact.txt' })).resolves.toEqual(Buffer.from('hello'));
    await expect(objectStore.delete({ path: 'remote://tenant-a/artifact.txt' })).resolves.toBeUndefined();
    expect(requests.map((request) => request.url)).toEqual([
      'https://remote.test/runtime/objects/put',
      'https://remote.test/runtime/objects/get',
      'https://remote.test/runtime/objects/delete',
    ]);

    const failingStore = createRemoteObjectStore({
      endpoint: 'https://remote.test/runtime',
      fetch: async () => jsonResponse({ error: { message: 'remote object denied' } }, 403),
    });
    await expect(failingStore.put({
      namespace: 'tenant-a',
      key: 'artifact.txt',
      body: 'hello',
    })).rejects.toThrow('remote object denied');
  });

  test('manifest store sends metadata only and filters by namespace', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const artifact = storedArtifact({
      namespace: 'tenant-a',
      path: 'remote://tenant-a/artifact.txt',
    });
    const manifestStore = createRemoteArtifactManifestStore({
      endpoint: 'https://remote.test/runtime',
      providerId: 'remote-manifest-test',
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url: String(url), body });
        if (String(url).endsWith('/artifacts/insert')) {
          expect(body).toEqual({ artifact });
          expect(JSON.stringify(body)).not.toContain('artifact body');
          return jsonResponse({ ok: true });
        }
        if (String(url).endsWith('/artifacts/list')) {
          expect(body).toEqual({ namespace: 'tenant-a' });
          return jsonResponse({ artifacts: [artifact] });
        }
        if (String(url).endsWith('/artifacts/get')) {
          expect(body).toEqual({ namespace: 'tenant-a', id: artifact.id });
          return jsonResponse({ artifact });
        }
        if (String(url).endsWith('/artifacts/delete')) {
          expect(body).toEqual({ namespace: 'tenant-a', id: artifact.id });
          return jsonResponse({ ok: true });
        }
        return jsonResponse({ error: { message: 'unexpected remote route' } }, 404);
      },
    });

    await expect(manifestStore.insert(artifact)).resolves.toBeUndefined();
    await expect(manifestStore.list({ namespace: 'tenant-a' })).resolves.toEqual([artifact]);
    await expect(manifestStore.get({ namespace: 'tenant-a', id: artifact.id })).resolves.toEqual(artifact);
    const deleteInput = { namespace: 'tenant-a', id: artifact.id };
    await expect(manifestStore.delete(deleteInput)).resolves.toBeUndefined();
    expect(requests.map((request) => request.url)).toEqual([
      'https://remote.test/runtime/artifacts/insert',
      'https://remote.test/runtime/artifacts/list',
      'https://remote.test/runtime/artifacts/get',
      'https://remote.test/runtime/artifacts/delete',
    ]);
  });

  test('record store sends JSON metadata records by namespace and tableName', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const remoteRecord = {
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
      data: { status: 'open' },
      metadata: { source: 'adapter_contract' },
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:01.000Z',
    };
    const recordStore = createRemoteRecordStore({
      endpoint: 'https://remote.test/runtime',
      providerId: 'remote-record-test',
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url: String(url), body });
        if (String(url).endsWith('/records/upsert')) {
          expect(body).toEqual({
            namespace: 'tenant-a',
            tableName: 'orders',
            id: 'order-1',
            data: { status: 'open' },
            metadata: { source: 'adapter_contract' },
          });
          expect(JSON.stringify(body)).not.toContain('bodyBase64');
          return jsonResponse({ record: remoteRecord });
        }
        if (String(url).endsWith('/records/get')) {
          expect(body).toEqual({ namespace: 'tenant-a', tableName: 'orders', id: 'order-1' });
          return jsonResponse({ record: remoteRecord });
        }
        if (String(url).endsWith('/records/query')) {
          expect(body).toEqual({ namespace: 'tenant-a', tableName: 'orders', limit: 5 });
          return jsonResponse({ records: [remoteRecord] });
        }
        if (String(url).endsWith('/records/delete')) {
          expect(body).toEqual({ namespace: 'tenant-a', tableName: 'orders', id: 'order-1' });
          return jsonResponse({ deleted: remoteRecord });
        }
        return jsonResponse({ error: { message: 'unexpected remote route' } }, 404);
      },
    });

    await expect(recordStore.upsert({
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
      data: { status: 'open' },
      metadata: { source: 'adapter_contract' },
    })).resolves.toEqual(remoteRecord);
    await expect(recordStore.get({
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
    })).resolves.toEqual(remoteRecord);
    await expect(recordStore.query({
      namespace: 'tenant-a',
      tableName: 'orders',
      limit: 5,
    })).resolves.toEqual([remoteRecord]);
    await expect(recordStore.delete({
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
    })).resolves.toEqual(remoteRecord);
    expect(requests.map((request) => request.url)).toEqual([
      'https://remote.test/runtime/records/upsert',
      'https://remote.test/runtime/records/get',
      'https://remote.test/runtime/records/query',
      'https://remote.test/runtime/records/delete',
    ]);
  });

  test('vector store requires tableName and sends upsert/search requests to remote vector service', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const vectorStore = createRemoteVectorStore({
      endpoint: 'https://remote.test/runtime',
      providerId: 'remote-vector-test',
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url: String(url), body });
        if (String(url).endsWith('/vectors/upsert')) {
          expect(body).toEqual({
            tableName: 'tenant_vectors',
            record: {
              id: 'doc-1',
              content: 'hello vector',
              embedding: [1, 0],
              metadata: { source: 'contract' },
            },
          });
          return jsonResponse({ ok: true });
        }
        if (String(url).endsWith('/vectors/search')) {
          expect(body).toEqual({
            tableName: 'tenant_vectors',
            embedding: [1, 0],
            limit: 1,
            filter: { metadata: { source: 'contract' } },
          });
          return jsonResponse({
            results: [{
              id: 'doc-1',
              content: 'hello vector',
              embedding: [1, 0],
              metadata: { source: 'contract' },
              score: 1,
              createdAt: '2026-06-12T00:00:00.000Z',
              updatedAt: '2026-06-12T00:00:00.000Z',
            }],
          });
        }
        return jsonResponse({ error: { message: 'unexpected remote route' } }, 404);
      },
    });

    await expect(vectorStore.upsert({
      id: 'doc-1',
      content: 'hello vector',
      embedding: [1, 0],
      metadata: { source: 'contract' },
    }, { tableName: 'tenant_vectors' })).resolves.toBeUndefined();
    await expect(vectorStore.search([1, 0], {
      tableName: 'tenant_vectors',
      limit: 1,
      filter: { metadata: { source: 'contract' } },
    } as never)).resolves.toEqual([
      expect.objectContaining({ id: 'doc-1', score: 1 }),
    ]);
    await expect(vectorStore.search([1, 0], { tableName: '', limit: 1 })).rejects.toThrow('tableName is required');
    expect(requests.map((request) => request.url)).toEqual([
      'https://remote.test/runtime/vectors/upsert',
      'https://remote.test/runtime/vectors/search',
    ]);
  });

  test('operation policy times out remote requests with route and attempt context', async () => {
    const objectStore = createRemoteObjectStore({
      endpoint: 'https://remote.test/runtime',
      timeoutMs: 5,
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(new Error('aborted by test signal'));
        signal?.addEventListener('abort', () => reject(new Error('aborted by test signal')), { once: true });
      }),
    });

    await expect(objectStore.put({
      namespace: 'tenant-a',
      key: 'artifact.txt',
      body: 'hello',
    })).rejects.toThrow(/\/objects\/put.*attempts=1.*timeout/i);
  });

  test('operation policy retries 5xx and 429 but not 4xx or remote semantic errors', async () => {
    let retryableAttempts = 0;
    const vectorStore = createRemoteVectorStore({
      endpoint: 'https://remote.test/runtime',
      retry: { attempts: 3, backoffMs: 0 },
      fetch: async () => {
        retryableAttempts += 1;
        if (retryableAttempts < 3) return jsonResponse({ error: { message: 'temporary overload' } }, retryableAttempts === 1 ? 503 : 429);
        return jsonResponse({ ok: true });
      },
    });
    await expect(vectorStore.upsert({
      id: 'doc-1',
      content: 'retry vector',
      embedding: [1, 0],
    }, { tableName: 'tenant_vectors' })).resolves.toBeUndefined();
    expect(retryableAttempts).toBe(3);

    let clientErrorAttempts = 0;
    const clientErrorStore = createRemoteObjectStore({
      endpoint: 'https://remote.test/runtime',
      retry: { attempts: 3, backoffMs: 0 },
      fetch: async () => {
        clientErrorAttempts += 1;
        return jsonResponse({ error: { message: 'bad namespace' } }, 400);
      },
    });
    await expect(clientErrorStore.put({
      namespace: 'tenant-a',
      key: 'artifact.txt',
      body: 'hello',
    })).rejects.toThrow('bad namespace');
    expect(clientErrorAttempts).toBe(1);

    let semanticAttempts = 0;
    const semanticErrorStore = createRemoteObjectStore({
      endpoint: 'https://remote.test/runtime',
      retry: { attempts: 3, backoffMs: 0 },
      fetch: async () => {
        semanticAttempts += 1;
        return jsonResponse({ error: { message: 'semantic denial' } }, 200);
      },
    });
    await expect(semanticErrorStore.put({
      namespace: 'tenant-a',
      key: 'artifact.txt',
      body: 'hello',
    })).rejects.toThrow('semantic denial');
    expect(semanticAttempts).toBe(1);
  });

  test('model gateway normalizes language, embedding, and image responses', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const modelGateway = createRemoteModelGateway({
      endpoint: 'https://remote.test/runtime',
      providerId: 'remote-model-test',
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url: String(url), body });
        if (String(url).endsWith('/models/complete')) {
          expect(body).toEqual({ input: 'hello' });
          return jsonResponse({ modelId: 'remote-chat', text: 'remote hello' });
        }
        if (String(url).endsWith('/models/embedding')) {
          expect(body).toEqual({ input: ['hello'] });
          return jsonResponse({ modelId: 'remote-embedding', embedding: [0.1, 0.2] });
        }
        if (String(url).endsWith('/models/image')) {
          expect(body).toEqual({ prompt: 'paint runtime services' });
          return jsonResponse({ modelId: 'remote-image', url: 'https://remote.test/image.png' });
        }
        return jsonResponse({ error: { message: 'unexpected remote route' } }, 404);
      },
    });

    await expect(modelGateway.complete({ input: 'hello' })).resolves.toMatchObject({
      moduleId: 'language',
      providerId: 'remote-model-test',
      modelId: 'remote-chat',
      text: 'remote hello',
    });
    await expect(modelGateway.createEmbedding({ input: ['hello'] })).resolves.toMatchObject({
      moduleId: 'embedding',
      providerId: 'remote-model-test',
      modelId: 'remote-embedding',
      embedding: [0.1, 0.2],
    });
    await expect(modelGateway.generateImage({ prompt: 'paint runtime services' })).resolves.toMatchObject({
      moduleId: 'vision',
      providerId: 'remote-model-test',
      modelId: 'remote-image',
      url: 'https://remote.test/image.png',
    });
    expect(requests.map((request) => request.url)).toEqual([
      'https://remote.test/runtime/models/complete',
      'https://remote.test/runtime/models/embedding',
      'https://remote.test/runtime/models/image',
    ]);
  });

  test('model gateway retry policy matches other remote provider operations', async () => {
    let retryableAttempts = 0;
    const retryingGateway = createRemoteModelGateway({
      endpoint: 'https://remote.test/runtime',
      providerId: 'remote-model-retry',
      retry: { attempts: 3, backoffMs: 0 },
      fetch: async () => {
        retryableAttempts += 1;
        if (retryableAttempts < 3) return jsonResponse({ error: { message: 'model temporarily unavailable' } }, retryableAttempts === 1 ? 503 : 429);
        return jsonResponse({ modelId: 'remote-chat', text: 'ok after retry' });
      },
    });
    await expect(retryingGateway.complete({ input: 'retry me' })).resolves.toMatchObject({
      text: 'ok after retry',
    });
    expect(retryableAttempts).toBe(3);

    let semanticAttempts = 0;
    const semanticGateway = createRemoteModelGateway({
      endpoint: 'https://remote.test/runtime',
      providerId: 'remote-model-semantic',
      retry: { attempts: 3, backoffMs: 0 },
      fetch: async () => {
        semanticAttempts += 1;
        return jsonResponse({ error: { message: 'model semantic denial' } }, 200);
      },
    });
    await expect(semanticGateway.complete({ input: 'deny me' })).rejects.toThrow(/\/models\/complete.*attempts=1.*model semantic denial/);
    expect(semanticAttempts).toBe(1);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function storedArtifact(overrides: Partial<StoredArtifact> = {}): StoredArtifact {
  return {
    id: 'artifact-20260612000000-abcdef123456-12345678',
    namespace: 'tenant-a',
    path: 'remote://tenant-a/artifact.txt',
    mimeType: 'text/plain',
    sizeBytes: 5,
    sha256: 'hash',
    createdAt: '2026-06-12T00:00:00.000Z',
    source: { kind: 'remote_contract' },
    ...overrides,
  };
}
