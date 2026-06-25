import { describe, expect, test } from 'vitest';
import {
  createRuntimeServices,
  createRuntimeServicesRpcClient,
  startRuntimeServicesRpcServer,
  type StoredArtifact,
  type VectorSearchResult,
} from '../src/index';
import { createArtifactStore } from '../src/storage/artifact-store';
import {
  createRemoteArtifactManifestStore,
  createRemoteObjectStore,
  createRemoteVectorStore,
} from '../src/providers/remote';

describe('remote Runtime Services adapters acceptance', () => {
  test('RPC surface stays stable while artifact and vector providers are remote adapters', async () => {
    const remote = createFakeRemoteRuntime();
    const objectStore = createRemoteObjectStore({
      endpoint: 'https://remote.test/runtime',
      providerId: 'remote-object-service',
      fetch: remote.fetch,
    });
    const artifactManifestStore = createRemoteArtifactManifestStore({
      endpoint: 'https://remote.test/runtime',
      providerId: 'remote-rds-manifest',
      fetch: remote.fetch,
    });
    const vectorStore = createRemoteVectorStore({
      endpoint: 'https://remote.test/runtime',
      providerId: 'remote-vector-service',
      fetch: remote.fetch,
    });
    const services = createRuntimeServices({
      ports: {
        objectStore,
        artifactManifestStore,
        vectorStore,
      },
    });
    const server = await startRuntimeServicesRpcServer({ services, host: '127.0.0.1', port: 0 });
    try {
      const client = createRuntimeServicesRpcClient({ endpoint: `${server.url}/rpc` });
      const artifact = await client.call<{ status: string; providerId: string; artifact?: StoredArtifact }>(
        'artifact.save',
        {
          namespace: 'tenant-a',
          body: 'remote artifact body',
          mimeType: 'text/plain',
          source: { kind: 'remote_acceptance' },
        },
      );
      expect(artifact).toMatchObject({
        status: 'ok',
        providerId: 'remote-object-service+remote-rds-manifest',
        artifact: {
          namespace: 'tenant-a',
          path: expect.stringMatching(/^remote:\/\/tenant-a\//),
        },
      });
      await expect(client.call('artifact.list', { namespace: 'tenant-a' })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-object-service+remote-rds-manifest',
        artifacts: [expect.objectContaining({ id: artifact.artifact?.id, namespace: 'tenant-a' })],
      });
      await expect(client.call('artifact.get', {
        namespace: 'tenant-a',
        id: artifact.artifact?.id,
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-object-service+remote-rds-manifest',
        artifact: expect.objectContaining({ id: artifact.artifact?.id, namespace: 'tenant-a' }),
        bodyBase64: Buffer.from('remote artifact body').toString('base64'),
      });
      await expect(client.call('artifact.list', { namespace: 'tenant-b' })).resolves.toMatchObject({
        status: 'ok',
        artifacts: [],
      });

      await expect(client.call('vector.upsert', {
        tableName: 'tenant_a_vectors',
        id: 'doc-1',
        content: 'remote vector content',
        embedding: [1, 0],
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-vector-service',
      });
      await expect(client.call('vector.search', {
        tableName: 'tenant_a_vectors',
        embedding: [1, 0],
        limit: 1,
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-vector-service',
        results: [expect.objectContaining({ id: 'doc-1', content: 'remote vector content' })],
      });
      await expect(client.call('vector.search', {
        tableName: 'tenant_b_vectors',
        embedding: [1, 0],
        limit: 1,
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'remote-vector-service',
        results: [],
      });
      await expect(client.call('resources.status', {})).resolves.toMatchObject({
        status: 'ok',
        resources: expect.arrayContaining([
          expect.objectContaining({
            id: 'storage.artifact_store',
            status: 'available',
            provider: 'remote-object-service+remote-rds-manifest',
          }),
          expect.objectContaining({
            id: 'storage.vector_index',
            status: 'available',
            provider: 'remote-vector-service',
          }),
        ]),
      });
      expect(remote.requests.map((request) => request.route)).toEqual([
        '/objects/put',
        '/artifacts/insert',
        '/artifacts/list',
        '/artifacts/get',
        '/objects/get',
        '/artifacts/list',
        '/vectors/upsert',
        '/vectors/search',
        '/vectors/search',
        '/resources/probe',
        '/resources/probe',
        '/resources/probe',
      ]);
      expect(remote.requests.filter((request) => request.route === '/resources/probe').map((request) => request.body))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ providerId: 'remote-object-service', resourceId: 'storage.artifact_store' }),
          expect.objectContaining({ providerId: 'remote-rds-manifest', resourceId: 'storage.artifact_store' }),
          expect.objectContaining({ providerId: 'remote-vector-service', resourceId: 'storage.vector_index' }),
        ]));
      const manifestInsert = remote.requests.find((request) => request.route === '/artifacts/insert');
      expect(JSON.stringify(manifestInsert?.body)).not.toContain('remote artifact body');
    } finally {
      await server.close();
    }
  });
});

function createFakeRemoteRuntime(): {
  requests: Array<{ route: string; body: unknown }>;
  fetch: typeof fetch;
} {
  const requests: Array<{ route: string; body: unknown }> = [];
  const artifacts: StoredArtifact[] = [];
  const objectBodies = new Map<string, string>();
  const vectors = new Map<string, VectorSearchResult[]>();
  return {
    requests,
    fetch: async (url, init) => {
      const parsedUrl = new URL(String(url));
      const route = parsedUrl.pathname.replace('/runtime', '');
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      requests.push({ route, body });

      if (route === '/resources/probe') return jsonResponse({ status: 'ok', message: `ready:${body.providerId}` });
      if (route === '/objects/put') {
        const object = {
          path: `remote://${body.namespace}/${body.key}`,
          sizeBytes: Buffer.from(String(body.bodyBase64), 'base64').byteLength,
        };
        objectBodies.set(object.path, String(body.bodyBase64));
        return jsonResponse(object);
      }
      if (route === '/objects/get') {
        const bodyBase64 = objectBodies.get(String(body.path));
        return bodyBase64
          ? jsonResponse({ bodyBase64 })
          : jsonResponse({ error: { message: 'object not found' } }, 404);
      }
      if (route === '/objects/delete') return jsonResponse({ ok: true });
      if (route === '/artifacts/insert') {
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
        return artifact
          ? jsonResponse({ artifact })
          : jsonResponse({ error: { message: 'artifact not found' } }, 404);
      }
      if (route === '/artifacts/delete') {
        const index = artifacts.findIndex((artifact) => artifact.id === body.id);
        if (index >= 0) artifacts.splice(index, 1);
        return jsonResponse({ ok: true });
      }
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
      return jsonResponse({ error: { message: `unexpected route: ${route}` } }, 404);
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
