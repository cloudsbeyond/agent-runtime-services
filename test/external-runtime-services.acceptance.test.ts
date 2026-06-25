import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createDefaultModelProviderConfig,
  createRuntimeServices,
  createRuntimeServicesRpcClient,
  startRuntimeServicesRpcServer,
} from '../src/index';

const okJson = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

describe('external Runtime Services acceptance', () => {
  test('agent consumer can use model, artifact, record, memory, vector, and resource capabilities through RPC', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-external-'));
    const services = createRuntimeServices({
      runtimeHome,
      modelConfig: createDefaultModelProviderConfig(),
      runtime: { env: { ARK_API_KEY: 'acceptance-key' } },
      fetch: async (url) => {
        const href = String(url);
        if (href.endsWith('/responses')) return okJson({ output_text: 'external acceptance pong' });
        if (href.endsWith('/embeddings')) return okJson({ data: [{ embedding: [1, 0, 0] }] });
        if (href.endsWith('/images/generations')) {
          return okJson({ data: [{ b64_json: Buffer.from('image-bytes').toString('base64') }] });
        }
        throw new Error(`unexpected provider url: ${href}`);
      },
    });
    const server = await startRuntimeServicesRpcServer({ services, host: '127.0.0.1', port: 0 });
    try {
      const client = createRuntimeServicesRpcClient({ endpoint: `${server.url}/rpc` });

      await expect(client.call('capabilities.describe', {})).resolves.toMatchObject({
        capabilities: expect.arrayContaining([
          expect.objectContaining({ id: 'artifact.save', request: expect.objectContaining({ required: ['namespace'] }) }),
          expect.objectContaining({ id: 'record.upsert', request: expect.objectContaining({ required: ['namespace', 'tableName', 'id', 'data'] }) }),
          expect.objectContaining({ id: 'record.get', request: expect.objectContaining({ required: ['namespace', 'tableName', 'id'] }) }),
          expect.objectContaining({ id: 'record.query', request: expect.objectContaining({ required: ['namespace', 'tableName'] }) }),
          expect.objectContaining({ id: 'record.delete', request: expect.objectContaining({ required: ['namespace', 'tableName', 'id'] }) }),
          expect.objectContaining({ id: 'memory.event.append', request: expect.objectContaining({ required: ['namespace', 'source'] }) }),
          expect.objectContaining({ id: 'memory.claim.upsert', request: expect.objectContaining({ required: ['namespace', 'id', 'kind', 'subject', 'statement', 'evidence', 'confidence'] }) }),
          expect.objectContaining({ id: 'memory.context.retrieve', request: expect.objectContaining({ required: ['namespace', 'tableName'] }) }),
          expect.objectContaining({ id: 'vector.upsert', request: expect.objectContaining({ required: ['tableName', 'id', 'content', 'embedding'] }) }),
        ]),
      });
      await expect(client.call('language.complete', { input: 'reply only: pong' })).resolves.toMatchObject({
        status: 'ok',
        proposal: { kind: 'text', text: 'external acceptance pong' },
      });
      const embedding = await client.call<{ embedding?: number[] }>('embedding.create', {
        input: 'external acceptance vector',
      });
      expect(embedding.embedding).toEqual([1, 0, 0]);

      const artifactBody = 'external artifact body with unique bytes 6a5c2c85';
      const artifact = await client.call<{ artifact?: { id: string; namespace: string } }>('artifact.save', {
        namespace: 'agent-a-artifacts',
        body: artifactBody,
        mimeType: 'text/plain',
      });
      await expect(client.call('capabilities.describe', {})).resolves.toMatchObject({
        capabilities: expect.arrayContaining([
          expect.objectContaining({ id: 'artifact.get', request: expect.objectContaining({ required: ['namespace', 'id'] }) }),
        ]),
      });
      const fetched = await client.call<{
        status: string;
        artifact?: { id: string; namespace: string };
        bodyBase64?: string;
      }>('artifact.get', {
        namespace: 'agent-a-artifacts',
        id: artifact.artifact?.id,
      });
      expect(fetched).toMatchObject({
        status: 'ok',
        artifact: { id: artifact.artifact?.id, namespace: 'agent-a-artifacts' },
        bodyBase64: Buffer.from(artifactBody).toString('base64'),
      });
      expect(Buffer.from(fetched.bodyBase64 ?? '', 'base64').toString('utf8')).toBe(artifactBody);
      await expect(client.call('artifact.list', { namespace: 'agent-a-artifacts' })).resolves.toMatchObject({
        status: 'ok',
        artifacts: [expect.objectContaining({ id: artifact.artifact?.id, namespace: 'agent-a-artifacts' })],
      });
      await expect(client.call('artifact.list', { namespace: 'agent-b-artifacts' })).resolves.toMatchObject({
        status: 'ok',
        artifacts: [],
      });
      await expect(client.call('artifact.get', { id: artifact.artifact?.id })).resolves.toMatchObject({ status: 'failed' });
      await expect(client.call('artifact.get', { namespace: 'agent-a-artifacts' })).resolves.toMatchObject({ status: 'failed' });
      await expect(client.call('artifact.get', {
        namespace: 'agent-b-artifacts',
        id: artifact.artifact?.id,
      })).resolves.toMatchObject({ status: 'failed' });
      const manifestBytes = await readFile(join(runtimeHome, 'db', 'artifacts.sqlite'));
      expect(manifestBytes.toString('utf8')).not.toContain(artifactBody);

      await expect(client.call('record.upsert', {
        namespace: 'agent-a-records',
        tableName: 'orders',
        id: 'order-1',
        data: { status: 'open', amount: 42 },
        metadata: { source: 'external_acceptance' },
      })).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'record.upsert',
        providerId: 'local-sqlite-record',
        record: {
          namespace: 'agent-a-records',
          tableName: 'orders',
          id: 'order-1',
          data: { status: 'open', amount: 42 },
          metadata: { source: 'external_acceptance' },
        },
      });
      await expect(client.call('record.get', {
        namespace: 'agent-a-records',
        tableName: 'orders',
        id: 'order-1',
      })).resolves.toMatchObject({
        status: 'ok',
        record: {
          namespace: 'agent-a-records',
          tableName: 'orders',
          id: 'order-1',
          data: { status: 'open', amount: 42 },
        },
      });
      await expect(client.call('record.query', {
        namespace: 'agent-a-records',
        tableName: 'orders',
        limit: 10,
      })).resolves.toMatchObject({
        status: 'ok',
        records: [expect.objectContaining({ id: 'order-1' })],
      });
      await expect(client.call('record.get', {
        namespace: 'agent-b-records',
        tableName: 'orders',
        id: 'order-1',
      })).resolves.toMatchObject({ status: 'failed' });
      await expect(client.call('record.query', {
        namespace: 'agent-a-records',
        tableName: 'missing_orders',
      })).resolves.toMatchObject({ status: 'ok', records: [] });
      await expect(client.call('record.upsert', {
        tableName: 'orders',
        id: 'missing-namespace',
        data: {},
      })).resolves.toMatchObject({ status: 'failed' });
      await expect(client.call('record.upsert', {
        namespace: 'agent-a-records',
        id: 'missing-table',
        data: {},
      })).resolves.toMatchObject({ status: 'failed' });
      await expect(client.call('record.get', {
        namespace: 'agent-a-records',
        tableName: 'orders',
      })).resolves.toMatchObject({ status: 'failed' });
      await expect(client.call('record.upsert', {
        namespace: 'agent-a-records',
        tableName: 'orders',
        id: 'missing-data',
      })).resolves.toMatchObject({ status: 'failed' });
      await expect(client.call('record.upsert', {
        namespace: 'agent-a-records',
        tableName: 'orders',
        id: 'string-data',
        data: 'not-json-object',
      })).resolves.toMatchObject({ status: 'failed' });
      const recordsDbBytes = await readFile(join(runtimeHome, 'db', 'records.sqlite'));
      expect(recordsDbBytes.toString('utf8')).toContain('external_acceptance');
      expect(recordsDbBytes.toString('utf8')).not.toContain(artifactBody);
      await expect(client.call('record.delete', {
        namespace: 'agent-a-records',
        tableName: 'orders',
        id: 'order-1',
      })).resolves.toMatchObject({
        status: 'ok',
        deleted: expect.objectContaining({ id: 'order-1' }),
      });
      await expect(client.call('record.get', {
        namespace: 'agent-a-records',
        tableName: 'orders',
        id: 'order-1',
      })).resolves.toMatchObject({ status: 'failed' });
      await expect(client.call('record.delete', {
        namespace: 'agent-a-records',
        tableName: 'orders',
        id: 'order-1',
      })).resolves.toMatchObject({ status: 'failed' });

      await expect(client.call('memory.event.append', {
        namespace: 'agent-a-memory',
        id: 'event-1',
        source: { kind: 'acceptance', ref: 'external-runtime-services.acceptance.test.ts' },
        payload: { text: 'memory acceptance event' },
        policy: { raw: 'internal', summary: 'internal', action: 'not_authorized' },
      })).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'memory.event.append',
        providerId: 'local-sqlite-memory',
        event: {
          namespace: 'agent-a-memory',
          id: 'event-1',
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      await expect(client.call('memory.claim.upsert', {
        namespace: 'agent-a-memory',
        id: 'claim-1',
        kind: 'acceptance_claim',
        subject: { kind: 'acceptance', id: 'memory' },
        statement: 'memory acceptance claim',
        evidence: [{ kind: 'event', id: 'event-1' }],
        confidence: 0.8,
      })).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'memory.claim.upsert',
        claim: { id: 'claim-1', confidence: 0.8 },
      });
      await expect(client.call('memory.relation.upsert', {
        namespace: 'agent-a-memory',
        id: 'relation-1',
        type: 'supports',
        from: { kind: 'claim', id: 'claim-1' },
        to: { kind: 'event', id: 'event-1' },
      })).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'memory.relation.upsert',
        relation: { id: 'relation-1', type: 'supports' },
      });
      await expect(client.call('memory.event.append', {
        id: 'missing-namespace',
        source: { kind: 'acceptance' },
      })).resolves.toMatchObject({ status: 'failed' });

      await client.call('vector.upsert', {
        tableName: 'agent_a_vectors',
        id: 'doc-1',
        content: 'external vector content',
        embedding: embedding.embedding,
        metadata: { namespace: 'agent-a-memory', claimId: 'claim-1', eventId: 'event-1' },
      });
      await expect(client.call('vector.search', {
        tableName: 'agent_a_vectors',
        embedding: [1, 0, 0],
        limit: 1,
      })).resolves.toMatchObject({
        status: 'ok',
        results: [expect.objectContaining({ id: 'doc-1', content: 'external vector content' })],
      });
      await expect(client.call('memory.context.retrieve', {
        namespace: 'agent-a-memory',
        tableName: 'agent_a_vectors',
        query: 'memory acceptance',
        limit: 1,
        relationshipLimit: 5,
      })).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'memory.context.retrieve',
        bundle: {
          claims: [expect.objectContaining({ id: 'claim-1' })],
          events: [expect.objectContaining({ id: 'event-1' })],
          relations: [expect.objectContaining({ id: 'relation-1' })],
        },
      });
      await expect(client.call('vector.search', {
        tableName: 'agent_b_vectors',
        embedding: [1, 0, 0],
        limit: 1,
      })).resolves.toMatchObject({ status: 'ok', results: [] });

      await expect(client.call('artifact.list', {})).resolves.toMatchObject({ status: 'failed' });
      await expect(client.call('vector.search', { embedding: [1, 0, 0] })).resolves.toMatchObject({ status: 'failed' });
      await expect(client.call('resources.status', {})).resolves.toMatchObject({
        status: 'ok',
        capabilityId: 'resources.status',
      });
    } finally {
      await server.close();
    }
  }, 20_000);
});
