import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createDefaultModelProviderConfig,
  createRuntimeServices,
  createRuntimeServicesRpcClient,
  startRuntimeServicesRpcServer,
} from '../src/index';

describe('runtime services RPC contract', () => {
  test('health, version, discovery, resources.status, and language.complete mirror lib contracts', async () => {
    const services = createRuntimeServices({
      modelConfig: createDefaultModelProviderConfig(),
      runtime: { env: { ARK_API_KEY: 'test-key' } },
      fetch: async () => new Response(JSON.stringify({ output_text: 'rpc pong' }), { status: 200 }),
    });
    const server = await startRuntimeServicesRpcServer({ services, host: '127.0.0.1', port: 0 });
    try {
      const client = createRuntimeServicesRpcClient({ endpoint: `${server.url}/rpc` });
      await expect(client.call('health', {})).resolves.toMatchObject({ status: 'ok' });
      const version = await client.call<{
        name: string;
        capabilitySchemaVersion: number;
        capabilityRevision: string;
      }>('version', {});
      expect(version).toMatchObject({
        name: 'agent-runtime-services',
        capabilitySchemaVersion: 2,
        capabilityRevision: expect.stringMatching(/^[a-f0-9]{16}$/),
      });
      await expect(client.call('capabilities.list', {})).resolves.toMatchObject({
        schemaVersion: 2,
        capabilityRevision: version.capabilityRevision,
        capabilities: expect.arrayContaining(['language.complete', 'embedding.create', 'vision.generateImage']),
      });
      await expect(client.call('capabilities.describe', {})).resolves.toMatchObject({
        schemaVersion: 2,
        packageVersion: expect.any(String),
        capabilityRevision: version.capabilityRevision,
        capabilities: expect.arrayContaining([
          expect.objectContaining({
            id: 'artifact.save',
            transport: 'json-rpc',
            consumers: ['domain-agent', 'build-agent'],
            http: {
              style: 'streamable-http-lite',
              endpoint: '/rpc',
              post: true,
              getSse: false,
              resumable: false,
            },
            domain: 'storage',
            serviceLayer: 'runtime-core',
            request: expect.objectContaining({
              paramsShape: 'artifact.save.params.v1',
              required: ['namespace'],
              inputSchema: expect.objectContaining({
                required: ['namespace'],
                oneOf: [
                  { required: ['body', 'mimeType'] },
                  { required: ['sourceUrl'] },
                ],
              }),
            }),
            response: expect.objectContaining({ envelope: true }),
            effects: expect.objectContaining({ runtimeHome: 'write' }),
            authority: {
              domainDecision: false,
              approval: false,
              toolChoice: false,
              sessionMutation: false,
            },
          }),
        ]),
      });
      await expect(client.call('resources.status', {})).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'resources.status',
      });
      await expect(client.call('resources.list', {})).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'resources.list',
      });
      await expect(client.call('artifact.cleanupExpired', { namespace: 'rpc-test' })).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'artifact.cleanupExpired',
        deleted: [],
      });
      await expect(client.call('language.complete', { input: 'reply only: pong' })).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'language.complete',
        proposal: { kind: 'text', text: 'rpc pong' },
      });

      const wrongEndpoint = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'health', params: {} }),
      });
      expect(wrongEndpoint.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  test('storage RPC requires explicit namespace and tableName isolation', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-rpc-storage-'));
    const services = createRuntimeServices({ runtimeHome });
    const server = await startRuntimeServicesRpcServer({ services, host: '127.0.0.1', port: 0 });
    try {
      const client = createRuntimeServicesRpcClient({ endpoint: `${server.url}/rpc` });
      await expect(client.call('artifact.list', {})).resolves.toMatchObject({
        status: 'failed',
        artifacts: [],
        evidence: [expect.objectContaining({ message: 'namespace is required' })],
      });
      await expect(client.call('artifact.save', { namespace: 'tenant-a' })).resolves.toMatchObject({
        status: 'failed',
        evidence: [expect.objectContaining({ message: 'artifact.save requires either body with mimeType or sourceUrl' })],
      });
      await expect(client.call('vector.search', { embedding: [1, 0] })).resolves.toMatchObject({
        status: 'failed',
        results: [],
        evidence: [expect.objectContaining({ message: 'tableName is required' })],
      });
      await expect(client.call('record.query', { namespace: 'tenant-a' })).resolves.toMatchObject({
        status: 'failed',
        records: [],
        evidence: [expect.objectContaining({ message: 'tableName is required' })],
      });

      const artifact = await client.call<{ artifact?: { id: string } }>('artifact.save', {
        namespace: 'tenant-a',
        body: 'tenant a artifact',
        mimeType: 'text/plain',
      });
      await expect(client.call('artifact.list', { namespace: 'tenant-a' })).resolves.toMatchObject({
        status: 'ok',
        artifacts: [expect.objectContaining({ id: artifact.artifact?.id, namespace: 'tenant-a' })],
      });

      await expect(client.call('vector.upsert', {
        tableName: 'tenant_a_vectors',
        id: 'doc-1',
        content: 'tenant a vector',
        embedding: [1, 0],
        metadata: { source: 'rpc', tenant: 'a' },
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'local-lancedb',
      });
      await expect(client.call('vector.upsert', {
        tableName: 'tenant_a_vectors',
        id: 'doc-2',
        content: 'tenant b vector',
        embedding: [1, 0],
        metadata: { source: 'rpc', tenant: 'b' },
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'local-lancedb',
      });
      await expect(client.call('vector.search', {
        tableName: 'tenant_a_vectors',
        embedding: [1, 0],
        limit: 10,
        filter: { metadata: { tenant: 'a' } },
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'local-lancedb',
        results: [expect.objectContaining({ id: 'doc-1', content: 'tenant a vector', embedding: [1, 0] })],
      });
      const vectorSearch = await client.call<{ results: Array<{ id: string }> }>('vector.search', {
        tableName: 'tenant_a_vectors',
        embedding: [1, 0],
        limit: 10,
        filter: { metadata: { tenant: 'a' } },
      });
      expect(vectorSearch.results.map((result) => result.id)).toEqual(['doc-1']);
      await expect(client.call('record.upsert', {
        namespace: 'tenant-a',
        tableName: 'orders',
        id: 'order-1',
        data: { status: 'open' },
      })).resolves.toMatchObject({
        status: 'ok',
        providerId: 'local-sqlite-record',
        record: { namespace: 'tenant-a', tableName: 'orders', id: 'order-1' },
      });
      await expect(client.call('record.get', {
        namespace: 'tenant-a',
        tableName: 'orders',
        id: 'order-1',
      })).resolves.toMatchObject({
        status: 'ok',
        record: { id: 'order-1', data: { status: 'open' } },
      });
      await expect(client.call('record.query', {
        namespace: 'tenant-a',
        tableName: 'orders',
      })).resolves.toMatchObject({
        status: 'ok',
        records: [expect.objectContaining({ id: 'order-1' })],
      });
      await expect(client.call('record.delete', {
        namespace: 'tenant-a',
        tableName: 'orders',
        id: 'order-1',
      })).resolves.toMatchObject({
        status: 'ok',
        deleted: expect.objectContaining({ id: 'order-1' }),
      });
    } finally {
      await server.close();
    }
  });
});
