import { describe, expect, test } from 'vitest';
import {
  createRuntimeServices,
  createRuntimeServicesRpcClient,
  startRuntimeServicesRpcServer,
  type RuntimeProviderConfig,
  type StoredArtifact,
  type VectorSearchResult,
} from '../src/index';

describe('remote provider config acceptance', () => {
  test('RPC artifact and vector capabilities use configured remote providers', async () => {
    const remote = createFakeRemoteRuntime();
    const providerConfig: RuntimeProviderConfig = {
      artifact: {
        object: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-object-from-config',
        },
        manifest: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-rds-from-config',
        },
      },
      vector: {
        kind: 'remote-http-json',
        endpoint: 'https://remote.test/runtime',
        providerId: 'remote-vector-from-config',
      },
      record: {
        kind: 'remote-http-json',
        endpoint: 'https://remote.test/runtime',
        providerId: 'remote-record-from-config',
      },
    };
    const services = createRuntimeServices({
      providerConfig,
      fetch: remote.fetch,
    });
    const server = await startRuntimeServicesRpcServer({ services, host: '127.0.0.1', port: 0 });
    try {
      const client = createRuntimeServicesRpcClient({ endpoint: `${server.url}/rpc` });
      const saved = await client.call<{ status: string; providerId: string; artifact?: StoredArtifact }>(
        'artifact.save',
        {
          namespace: 'tenant-a',
          body: 'configured remote body',
          mimeType: 'text/plain',
        },
      );
      expect(saved).toMatchObject({
        status: 'ok',
        providerId: 'remote-object-from-config+remote-rds-from-config',
        artifact: {
          namespace: 'tenant-a',
          path: expect.stringMatching(/^remote:\/\/tenant-a\//),
        },
      });
      await expect(client.call('artifact.list', { namespace: 'tenant-a' })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-object-from-config+remote-rds-from-config',
        artifacts: [expect.objectContaining({ id: saved.artifact?.id })],
      });
      const fetched = await client.call<{
        status: string;
        providerId: string;
        artifact?: StoredArtifact;
        bodyBase64?: string;
      }>('artifact.get', {
        namespace: 'tenant-a',
        id: saved.artifact?.id,
      });
      expect(fetched).toMatchObject({
        status: 'ok',
        providerId: 'remote-object-from-config+remote-rds-from-config',
        artifact: { id: saved.artifact?.id, namespace: 'tenant-a' },
        bodyBase64: Buffer.from('configured remote body').toString('base64'),
      });
      await expect(client.call('artifact.get', {
        namespace: 'tenant-b',
        id: saved.artifact?.id,
      })).resolves.toMatchObject({
        status: 'failed',
        providerId: 'remote-object-from-config+remote-rds-from-config',
      });
      await expect(client.call('vector.upsert', {
        tableName: 'tenant_vectors',
        id: 'doc-1',
        content: 'configured remote vector',
        embedding: [1, 0],
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-vector-from-config',
      });
      await expect(client.call('vector.search', {
        tableName: 'tenant_vectors',
        embedding: [1, 0],
        limit: 1,
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-vector-from-config',
        results: [expect.objectContaining({ id: 'doc-1' })],
      });
      await expect(client.call('record.upsert', {
        namespace: 'tenant-a',
        tableName: 'orders',
        id: 'order-1',
        data: { status: 'open' },
        metadata: { source: 'remote_acceptance' },
      })).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'record.upsert',
        providerId: 'remote-record-from-config',
        record: {
          namespace: 'tenant-a',
          tableName: 'orders',
          id: 'order-1',
          data: { status: 'open' },
        },
      });
      await expect(client.call('record.get', {
        namespace: 'tenant-a',
        tableName: 'orders',
        id: 'order-1',
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-record-from-config',
        record: { id: 'order-1', namespace: 'tenant-a', tableName: 'orders' },
      });
      await expect(client.call('record.query', {
        namespace: 'tenant-a',
        tableName: 'orders',
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-record-from-config',
        records: [expect.objectContaining({ id: 'order-1' })],
      });
      await expect(client.call('record.get', {
        namespace: 'tenant-b',
        tableName: 'orders',
        id: 'order-1',
      })).resolves.toMatchObject({
        status: 'failed',
        providerId: 'remote-record-from-config',
      });
      await expect(client.call('record.delete', {
        namespace: 'tenant-a',
        tableName: 'orders',
        id: 'order-1',
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-record-from-config',
        deleted: expect.objectContaining({ id: 'order-1' }),
      });
      await expect(client.call('resources.status', {})).resolves.toMatchObject({
        resources: expect.arrayContaining([
          expect.objectContaining({
            id: 'storage.artifact_store',
            provider: 'remote-object-from-config+remote-rds-from-config',
          }),
          expect.objectContaining({
            id: 'storage.vector_index',
            provider: 'remote-vector-from-config',
          }),
          expect.objectContaining({
            id: 'storage.record_store',
            provider: 'remote-record-from-config',
          }),
        ]),
      });
      expect(remote.count('/artifacts/get')).toBe(2);
      expect(remote.count('/objects/get')).toBe(1);
      expect(remote.count('/records/upsert')).toBe(1);
      expect(remote.count('/records/get')).toBe(2);
      expect(remote.count('/records/query')).toBe(1);
      expect(remote.count('/records/delete')).toBe(1);
    } finally {
      await server.close();
    }
  });

  test('RPC model, artifact, and vector capabilities use configured remote providers through one surface', async () => {
    const remote = createFakeRemoteRuntime();
    const providerConfig: RuntimeProviderConfig = {
      model: {
        kind: 'remote-http-json',
        endpoint: 'https://remote.test/runtime',
        providerId: 'remote-model-from-config',
      },
      artifact: {
        object: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-object-from-config',
        },
        manifest: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-rds-from-config',
        },
      },
      vector: {
        kind: 'remote-http-json',
        endpoint: 'https://remote.test/runtime',
        providerId: 'remote-vector-from-config',
      },
    };
    const services = createRuntimeServices({
      providerConfig,
      fetch: remote.fetch,
    });
    const server = await startRuntimeServicesRpcServer({ services, host: '127.0.0.1', port: 0 });
    try {
      const client = createRuntimeServicesRpcClient({ endpoint: `${server.url}/rpc` });
      await expect(client.call('language.complete', { input: 'hello' })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-model-from-config',
        proposal: { text: 'remote text: hello' },
      });
      await expect(client.call('embedding.create', { input: 'hello' })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-model-from-config',
        embedding: [0.1, 0.2],
      });
      await expect(client.call('vision.generateImage', { prompt: 'runtime image' })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-model-from-config',
        artifact: { url: 'https://remote.test/generated/runtime-image.png' },
      });
      const saved = await client.call<{ status: string; providerId: string; artifact?: StoredArtifact }>(
        'artifact.save',
        {
          namespace: 'tenant-a',
          body: 'configured remote body',
          mimeType: 'text/plain',
        },
      );
      expect(saved).toMatchObject({
        status: 'ok',
        providerId: 'remote-object-from-config+remote-rds-from-config',
      });
      await expect(client.call('artifact.list', { namespace: 'tenant-a' })).resolves.toMatchObject({
        status: 'ok',
        artifacts: [expect.objectContaining({ id: saved.artifact?.id })],
      });
      await expect(client.call('vector.upsert', {
        tableName: 'tenant_vectors',
        id: 'doc-1',
        content: 'configured remote vector',
        embedding: [1, 0],
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-vector-from-config',
      });
      await expect(client.call('vector.search', {
        tableName: 'tenant_vectors',
        embedding: [1, 0],
        limit: 1,
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-vector-from-config',
        results: [expect.objectContaining({ id: 'doc-1' })],
      });
      await expect(client.call('resources.status', {})).resolves.toMatchObject({
        resources: expect.arrayContaining([
          expect.objectContaining({
            id: 'model.language_completion',
            status: 'available',
            provider: 'remote-model-from-config',
          }),
          expect.objectContaining({
            id: 'model.embedding',
            status: 'available',
            provider: 'remote-model-from-config',
          }),
          expect.objectContaining({
            id: 'model.image_generation',
            status: 'available',
            provider: 'remote-model-from-config',
          }),
        ]),
      });
      expect(remote.count('/models/complete')).toBe(1);
      expect(remote.count('/models/embedding')).toBe(1);
      expect(remote.count('/models/image')).toBe(1);
    } finally {
      await server.close();
    }
  });

  test('RPC remote model failures return failed envelope without default model fallback', async () => {
    const attemptsByRoute = new Map<string, number>();
    const services = createRuntimeServices({
      providerConfig: {
        model: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-model-down',
          operationPolicy: { retry: { attempts: 2, backoffMs: 0 } },
        },
      } as RuntimeProviderConfig,
      fetch: async (url) => {
        const route = new URL(String(url)).pathname.replace('/runtime', '');
        attemptsByRoute.set(route, (attemptsByRoute.get(route) ?? 0) + 1);
        if (route === '/models/complete') return jsonResponse({
          error: { message: 'remote model unavailable' },
        }, 503);
        if (route === '/resources/probe') return jsonResponse({ status: 'ok' });
        return jsonResponse({ error: { message: `unexpected route: ${route}` } }, 404);
      },
    });
    const server = await startRuntimeServicesRpcServer({ services, host: '127.0.0.1', port: 0 });
    try {
      const client = createRuntimeServicesRpcClient({ endpoint: `${server.url}/rpc` });
      await expect(client.call('language.complete', { input: 'fail remotely' })).resolves.toMatchObject({
        status: 'failed',
        capabilityId: 'language.complete',
        providerId: 'remote-model-down',
        evidence: [expect.objectContaining({
          message: expect.stringMatching(/\/models\/complete.*attempts=2.*remote model unavailable/),
        })],
      });
      expect(attemptsByRoute.get('/models/complete')).toBe(2);
    } finally {
      await server.close();
    }
  });

  test('RPC calls retry configured transient remote failures and return failed envelopes when exhausted', async () => {
    const attemptsByRoute = new Map<string, number>();
    const providerConfig: RuntimeProviderConfig = {
      artifact: {
        object: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-object-policy',
          operationPolicy: { retry: { attempts: 3, backoffMs: 0 } },
        },
        manifest: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-rds-policy',
          operationPolicy: { retry: { attempts: 3, backoffMs: 0 } },
        },
      },
      vector: {
        kind: 'remote-http-json',
        endpoint: 'https://remote.test/runtime',
        providerId: 'remote-vector-policy',
        operationPolicy: { retry: { attempts: 2, backoffMs: 0 } },
      },
    };
    const services = createRuntimeServices({
      providerConfig,
      fetch: async (url, init) => {
        const route = new URL(String(url)).pathname.replace('/runtime', '');
        const count = (attemptsByRoute.get(route) ?? 0) + 1;
        attemptsByRoute.set(route, count);
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        if (route === '/objects/put') {
          if (count < 3) return jsonResponse({ error: { message: 'object temporarily unavailable' } }, 503);
          return jsonResponse({
            path: `remote://${body.namespace}/${body.key}`,
            sizeBytes: Buffer.from(String(body.bodyBase64), 'base64').byteLength,
          });
        }
        if (route === '/artifacts/insert') return jsonResponse({ ok: true });
        if (route === '/vectors/search') return jsonResponse({ error: { message: 'vector still unavailable' } }, 503);
        if (route === '/resources/probe') return jsonResponse({ status: 'ok' });
        return jsonResponse({ error: { message: `unexpected route: ${route}` } }, 404);
      },
    });
    const server = await startRuntimeServicesRpcServer({ services, host: '127.0.0.1', port: 0 });
    try {
      const client = createRuntimeServicesRpcClient({ endpoint: `${server.url}/rpc` });
      await expect(client.call('artifact.save', {
        namespace: 'tenant-a',
        body: 'retry body',
        mimeType: 'text/plain',
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-object-policy+remote-rds-policy',
      });
      expect(attemptsByRoute.get('/objects/put')).toBe(3);

      await expect(client.call('vector.search', {
        tableName: 'tenant_vectors',
        embedding: [1, 0],
        limit: 1,
      })).resolves.toMatchObject({
        status: 'failed',
        capabilityId: 'vector.search',
        providerId: 'remote-vector-policy',
        results: [],
        evidence: [expect.objectContaining({
          message: expect.stringMatching(/\/vectors\/search.*attempts=2.*vector still unavailable/),
        })],
      });
      expect(attemptsByRoute.get('/vectors/search')).toBe(2);
    } finally {
      await server.close();
    }
  });
});

function createFakeRemoteRuntime(): {
  fetch: typeof fetch;
  count(route: string): number;
} {
  const artifacts: StoredArtifact[] = [];
  const objects = new Map<string, string>();
  const vectors = new Map<string, VectorSearchResult[]>();
  const records = new Map<string, {
    namespace: string;
    tableName: string;
    id: string;
    data: Record<string, unknown>;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>();
  const routeCounts = new Map<string, number>();
  return {
    count: (route) => routeCounts.get(route) ?? 0,
    fetch: async (url, init) => {
      const route = new URL(String(url)).pathname.replace('/runtime', '');
      routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (route === '/resources/probe') return jsonResponse({ status: 'ok', message: `ready:${String(body.resourceId)}` });
      if (route === '/models/complete') {
        expect(body).toEqual({ input: 'hello' });
        return jsonResponse({ modelId: 'remote-chat', text: 'remote text: hello' });
      }
      if (route === '/models/embedding') {
        expect(body).toEqual({ input: 'hello' });
        return jsonResponse({ modelId: 'remote-embedding', embedding: [0.1, 0.2] });
      }
      if (route === '/models/image') {
        expect(body).toEqual({ prompt: 'runtime image' });
        return jsonResponse({ modelId: 'remote-image', url: 'https://remote.test/generated/runtime-image.png' });
      }
      if (route === '/objects/put') {
        objects.set(`remote://${body.namespace}/${body.key}`, String(body.bodyBase64));
        return jsonResponse({
          path: `remote://${body.namespace}/${body.key}`,
          sizeBytes: Buffer.from(String(body.bodyBase64), 'base64').byteLength,
        });
      }
      if (route === '/objects/get') {
        const bodyBase64 = objects.get(String(body.path));
        if (!bodyBase64) return jsonResponse({ error: { message: 'remote object not found' } }, 404);
        return jsonResponse({ bodyBase64 });
      }
      if (route === '/objects/delete') return jsonResponse({ ok: true });
      if (route === '/artifacts/insert') {
        expect(JSON.stringify(body)).not.toContain('configured remote body');
        artifacts.push(body.artifact as StoredArtifact);
        return jsonResponse({ ok: true });
      }
      if (route === '/artifacts/list') {
        return jsonResponse({
          artifacts: artifacts.filter((artifact) => artifact.namespace === body.namespace),
        });
      }
      if (route === '/artifacts/get') {
        const artifact = artifacts.find((item) => item.namespace === body.namespace && item.id === body.id);
        if (!artifact) return jsonResponse({ error: { message: 'remote artifact manifest not found' } }, 404);
        return jsonResponse({ artifact });
      }
      if (route === '/artifacts/delete') return jsonResponse({ ok: true });
      if (route === '/vectors/upsert') {
        const tableName = String(body.tableName);
        const record = body.record as {
          id: string;
          content: string;
          embedding: number[];
          metadata?: Record<string, unknown>;
        };
        const rows = vectors.get(tableName) ?? [];
        vectors.set(tableName, [
          ...rows.filter((row) => row.id !== record.id),
          {
            ...record,
            metadata: record.metadata ?? {},
            score: 1,
            createdAt: '2026-06-12T00:00:00.000Z',
            updatedAt: '2026-06-12T00:00:00.000Z',
          },
        ]);
        return jsonResponse({ ok: true });
      }
      if (route === '/vectors/search') {
        return jsonResponse({
          results: vectors.get(String(body.tableName)) ?? [],
        });
      }
      if (route === '/records/upsert') {
        const key = recordKey(body);
        const existing = records.get(key);
        const timestamp = existing?.createdAt ?? '2026-06-12T00:00:00.000Z';
        const record = {
          namespace: String(body.namespace),
          tableName: String(body.tableName),
          id: String(body.id),
          data: body.data as Record<string, unknown>,
          metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : {},
          createdAt: timestamp,
          updatedAt: '2026-06-12T00:00:01.000Z',
        };
        records.set(key, record);
        return jsonResponse({ record });
      }
      if (route === '/records/get') {
        const record = records.get(recordKey(body));
        if (!record) return jsonResponse({ error: { message: 'remote record not found' } }, 404);
        return jsonResponse({ record });
      }
      if (route === '/records/query') {
        const limit = typeof body.limit === 'number' ? body.limit : 100;
        return jsonResponse({
          records: [...records.values()]
            .filter((record) => record.namespace === body.namespace && record.tableName === body.tableName)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
            .slice(0, limit),
        });
      }
      if (route === '/records/delete') {
        const key = recordKey(body);
        const record = records.get(key);
        if (!record) return jsonResponse({ error: { message: 'remote record not found' } }, 404);
        records.delete(key);
        return jsonResponse({ deleted: record });
      }
      return jsonResponse({ error: { message: `unexpected route: ${route}` } }, 404);
    },
  };
}

function recordKey(input: Record<string, unknown>): string {
  return `${String(input.namespace)}\0${String(input.tableName)}\0${String(input.id)}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
