import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import { setSecret } from '../src/config/keystore';
import { createDefaultModelProviderConfig } from '../src/models/catalog';
import type { RuntimeProviderConfig, StoredArtifact, VectorSearchResult } from '../src/index';

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const childProcesses: Array<ReturnType<typeof import('node:child_process').spawn>> = [];
const httpServers: Server[] = [];

describe('CLI RPC smoke', () => {
  afterEach(async () => {
    await Promise.all(childProcesses.splice(0).map(stopProcess));
    await Promise.all(httpServers.splice(0).map(closeHttpServer));
  });

  test('serve starts a real localhost RPC process with an explicit runtime home', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-cli-smoke-'));
    const config = createDefaultModelProviderConfig();
    config.modules.language.selectedModel = 'copied-language-model';
    await writeFile(join(runtimeHome, 'model-providers.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await setSecret('ARK_API_KEY', 'test-key', {
      secretsFile: join(runtimeHome, 'secrets.enc'),
      keystoreSaltFile: join(runtimeHome, '.keystore.salt'),
    });
    await execFileAsync('pnpm', ['build'], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });

    const server = await startCliServer([
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--runtime-home',
      runtimeHome,
    ]);
    await expect(readFile(join(runtimeHome, 'service.pid'), 'utf8')).resolves.toBe(`${server.pid}\n`);

    const health = await fetch(`${server.url}/health`);
    await expect(health.json()).resolves.toEqual({ status: 'ok' });

    const rpcEndpoint = `${server.url}/rpc`;
    const artifactSave = await rpcCall<{ status: string; artifact?: { path?: string } }>(
      rpcEndpoint,
      'artifact.save',
      {
        namespace: 'cli-smoke',
        body: 'cli smoke',
        mimeType: 'text/plain',
        source: { kind: 'cli_rpc_smoke' },
      },
    );
    expect(artifactSave.status).toBe('ok');
    expect(artifactSave.artifact?.path?.startsWith(join(runtimeHome, 'artifacts'))).toBe(true);

    const status = await rpcCall<{
      status: string;
      capabilityId: string;
      resources: Array<{ id: string; status: string; provider?: string }>;
    }>(rpcEndpoint, 'resources.status', {});
    expect(status).toMatchObject({ status: 'ok', capabilityId: 'resources.status' });
    expect(status.resources).toContainEqual(expect.objectContaining({
      id: 'model.language_completion',
      status: 'available',
      provider: 'volcengine-agent-plan:copied-language-model',
    }));
  }, 20_000);

  test('serve reads runtime-providers.json and routes stable RPC calls to remote providers', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-cli-remote-'));
    const remote = await startFakeRemoteRuntimeServer();
    const providerConfig: RuntimeProviderConfig = {
      model: {
        kind: 'remote-http-json',
        endpoint: `${remote.url}/runtime`,
        providerId: 'cli-remote-model',
      },
      artifact: {
        object: {
          kind: 'remote-http-json',
          endpoint: `${remote.url}/runtime`,
          providerId: 'cli-remote-object',
        },
        manifest: {
          kind: 'remote-http-json',
          endpoint: `${remote.url}/runtime`,
          providerId: 'cli-remote-rds',
        },
      },
      vector: {
        kind: 'remote-http-json',
        endpoint: `${remote.url}/runtime`,
        providerId: 'cli-remote-vector',
      },
      record: {
        kind: 'remote-http-json',
        endpoint: `${remote.url}/runtime`,
        providerId: 'cli-remote-record',
      },
    };
    await writeFile(join(runtimeHome, 'runtime-providers.json'), `${JSON.stringify(providerConfig, null, 2)}\n`, 'utf8');
    await execFileAsync('pnpm', ['build'], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });

    const server = await startCliServer([
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--runtime-home',
      runtimeHome,
    ]);
    const rpcEndpoint = `${server.url}/rpc`;

    await expect(rpcCall(rpcEndpoint, 'language.complete', { input: 'hello' })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-model',
      proposal: { text: 'cli remote text: hello' },
    });
    await expect(rpcCall(rpcEndpoint, 'embedding.create', { input: 'hello' })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-model',
      embedding: [0.1, 0.2],
    });
    await expect(rpcCall(rpcEndpoint, 'vision.generateImage', { prompt: 'runtime image' })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-model',
      artifact: { url: 'https://remote.test/generated/runtime-image.png' },
    });
    const saved = await rpcCall<{ status: string; providerId: string; artifact?: StoredArtifact }>(
      rpcEndpoint,
      'artifact.save',
      {
        namespace: 'tenant-a',
        body: 'configured remote body',
        mimeType: 'text/plain',
        expiresAt: '2026-06-12T00:00:00.000Z',
      },
    );
    expect(saved).toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-object+cli-remote-rds',
      artifact: {
        namespace: 'tenant-a',
        path: expect.stringMatching(/^remote:\/\/tenant-a\//),
      },
    });
    await expect(rpcCall(rpcEndpoint, 'artifact.list', { namespace: 'tenant-a' })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-object+cli-remote-rds',
      artifacts: [expect.objectContaining({ id: saved.artifact?.id })],
    });
    await expect(rpcCall(rpcEndpoint, 'artifact.get', {
      namespace: 'tenant-a',
      id: saved.artifact?.id,
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-object+cli-remote-rds',
      artifact: expect.objectContaining({ id: saved.artifact?.id, namespace: 'tenant-a' }),
      bodyBase64: Buffer.from('configured remote body').toString('base64'),
    });
    await expect(rpcCall(rpcEndpoint, 'artifact.cleanupExpired', {
      namespace: 'tenant-a',
      now: '2026-06-12T00:00:01.000Z',
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-object+cli-remote-rds',
      deleted: [expect.objectContaining({ id: saved.artifact?.id, namespace: 'tenant-a' })],
    });
    await expect(rpcCall(rpcEndpoint, 'vector.upsert', {
      tableName: 'tenant_vectors',
      id: 'doc-1',
      content: 'configured remote vector',
      embedding: [1, 0],
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-vector',
    });
    await expect(rpcCall(rpcEndpoint, 'vector.search', {
      tableName: 'tenant_vectors',
      embedding: [1, 0],
      limit: 1,
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-vector',
      results: [expect.objectContaining({ id: 'doc-1' })],
    });
    await expect(rpcCall(rpcEndpoint, 'record.upsert', {
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
      data: { status: 'open' },
      metadata: { source: 'cli_smoke' },
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-record',
      record: { namespace: 'tenant-a', tableName: 'orders', id: 'order-1' },
    });
    await expect(rpcCall(rpcEndpoint, 'record.get', {
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-record',
      record: { id: 'order-1', data: { status: 'open' } },
    });
    await expect(rpcCall(rpcEndpoint, 'record.query', {
      namespace: 'tenant-a',
      tableName: 'orders',
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-record',
      records: [expect.objectContaining({ id: 'order-1' })],
    });
    await expect(rpcCall(rpcEndpoint, 'record.delete', {
      namespace: 'tenant-a',
      tableName: 'orders',
      id: 'order-1',
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'cli-remote-record',
      deleted: expect.objectContaining({ id: 'order-1' }),
    });
    await expect(rpcCall(rpcEndpoint, 'resources.status', {})).resolves.toMatchObject({
      status: 'ok',
      capabilityId: 'resources.status',
      resources: expect.arrayContaining([
        expect.objectContaining({ id: 'model.language_completion', provider: 'cli-remote-model' }),
        expect.objectContaining({ id: 'storage.artifact_store', provider: 'cli-remote-object+cli-remote-rds' }),
        expect.objectContaining({ id: 'storage.record_store', provider: 'cli-remote-record' }),
        expect.objectContaining({ id: 'storage.vector_index', provider: 'cli-remote-vector' }),
      ]),
    });

    expect(remote.count('/models/complete')).toBe(1);
    expect(remote.count('/models/embedding')).toBe(1);
    expect(remote.count('/models/image')).toBe(1);
    expect(remote.count('/objects/put')).toBe(1);
    expect(remote.count('/objects/get')).toBe(1);
    expect(remote.count('/objects/delete')).toBe(1);
    expect(remote.count('/artifacts/insert')).toBe(1);
    expect(remote.count('/artifacts/list')).toBe(2);
    expect(remote.count('/artifacts/get')).toBe(1);
    expect(remote.count('/artifacts/delete')).toBe(1);
    expect(remote.count('/vectors/upsert')).toBe(1);
    expect(remote.count('/vectors/search')).toBe(1);
    expect(remote.count('/records/upsert')).toBe(1);
    expect(remote.count('/records/get')).toBe(1);
    expect(remote.count('/records/query')).toBe(1);
    expect(remote.count('/records/delete')).toBe(1);
  }, 20_000);

  test('resources and doctor read runtime-providers.json for remote provider status', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-cli-ops-'));
    const remote = await startFakeRemoteRuntimeServer();
    const providerConfig: RuntimeProviderConfig = {
      model: {
        kind: 'remote-http-json',
        endpoint: `${remote.url}/runtime`,
        providerId: 'ops-remote-model',
      },
      artifact: {
        object: {
          kind: 'remote-http-json',
          endpoint: `${remote.url}/runtime`,
          providerId: 'ops-remote-object',
        },
        manifest: {
          kind: 'remote-http-json',
          endpoint: `${remote.url}/runtime`,
          providerId: 'ops-remote-rds',
        },
      },
      vector: {
        kind: 'remote-http-json',
        endpoint: `${remote.url}/runtime`,
        providerId: 'ops-remote-vector',
      },
      record: {
        kind: 'remote-http-json',
        endpoint: `${remote.url}/runtime`,
        providerId: 'ops-remote-record',
      },
    };
    await writeFile(join(runtimeHome, 'runtime-providers.json'), `${JSON.stringify(providerConfig, null, 2)}\n`, 'utf8');
    await execFileAsync('pnpm', ['build'], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });

    const resources = await runCliResult(['resources', '--runtime-home', runtimeHome]);
    const doctor = await runCliResult(['doctor', '--runtime-home', runtimeHome]);

    for (const result of [resources, doctor]) {
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('ops-remote-model');
      expect(result.stdout).toContain('ops-remote-object+ops-remote-rds');
      expect(result.stdout).toContain('ops-remote-vector');
      expect(result.stdout).toContain('ops-remote-record');
    }
    expect(doctor.stdout).toContain(`home: ${runtimeHome}`);
    expect(remote.count('/resources/probe')).toBeGreaterThan(0);
  }, 20_000);

  test('storage status reads explicit runtime home and provider config', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-cli-storage-'));
    const remote = await startFakeRemoteRuntimeServer();
    const providerConfigPath = join(runtimeHome, 'runtime-providers.remote.json');
    const providerConfig: RuntimeProviderConfig = {
      artifact: {
        object: {
          kind: 'remote-http-json',
          endpoint: `${remote.url}/runtime`,
          providerId: 'storage-remote-object',
        },
        manifest: {
          kind: 'remote-http-json',
          endpoint: `${remote.url}/runtime`,
          providerId: 'storage-remote-rds',
        },
      },
      vector: {
        kind: 'remote-http-json',
        endpoint: `${remote.url}/runtime`,
        providerId: 'storage-remote-vector',
      },
      record: {
        kind: 'remote-http-json',
        endpoint: `${remote.url}/runtime`,
        providerId: 'storage-remote-record',
      },
    };
    await writeFile(providerConfigPath, `${JSON.stringify(providerConfig, null, 2)}\n`, 'utf8');
    await execFileAsync('pnpm', ['build'], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });

    const status = await runCliResult([
      'storage',
      'status',
      '--runtime-home',
      runtimeHome,
      '--provider-config',
      providerConfigPath,
    ]);

    expect(status.exitCode).toBe(0);
    expect(status.stderr).toBe('');
    expect(status.stdout).toContain(`home: ${runtimeHome}`);
    expect(status.stdout).toContain('storage.artifact_store: available via storage-remote-object+storage-remote-rds');
    expect(status.stdout).toContain('storage.record_store: available via storage-remote-record');
    expect(status.stdout).toContain('storage.vector_index: available via storage-remote-vector');
    expect(remote.count('/resources/probe')).toBeGreaterThan(0);
  }, 20_000);

  test('operator CLI exits non-zero for missing model resources without false-success output', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-cli-failure-'));
    await execFileAsync('pnpm', ['build'], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });

    const smoke = await runCliFailure([
      'models',
      'smoke',
      '--module',
      'language',
      '--runtime-home',
      runtimeHome,
    ]);

    expect(smoke.exitCode).not.toBe(0);
    expect(smoke.stdout).toContain('Agent runtime services model smoke');
    expect(smoke.stdout).toContain('- language');
    expect(smoke.stdout).toContain('missing_resource');
    expect(smoke.stderr).toContain('Runtime Services model smoke failed');
    expect(smoke.stderr).toContain('missing_resource');

    const vectorSearch = await runCliFailure([
      'storage',
      'vectors',
      'search',
      '--table-name',
      'operator_notes',
      '--runtime-home',
      runtimeHome,
      'find',
      'alpha',
    ]);

    expect(vectorSearch.exitCode).not.toBe(0);
    expect(vectorSearch.stdout).toBe('');
    expect(vectorSearch.stderr).toContain('runtime service model is not configured');
    expect(vectorSearch.stderr).not.toContain('Agent runtime services vector search');
    expect(vectorSearch.stderr).not.toContain('No matching vectors.');
  }, 20_000);

  test('packed package consumer imports RPC client/runtime adapters and drives an external capability flow', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-package-consumer-'));
    const consumerHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-consumer-'));
    const remote = await startFakeRemoteRuntimeServer();
    const providerConfig: RuntimeProviderConfig = {
      model: {
        kind: 'remote-http-json',
        endpoint: `${remote.url}/runtime`,
        providerId: 'package-remote-model',
      },
      artifact: {
        object: {
          kind: 'remote-http-json',
          endpoint: `${remote.url}/runtime`,
          providerId: 'package-remote-object',
        },
        manifest: {
          kind: 'remote-http-json',
          endpoint: `${remote.url}/runtime`,
          providerId: 'package-remote-rds',
        },
      },
      vector: {
        kind: 'remote-http-json',
        endpoint: `${remote.url}/runtime`,
        providerId: 'package-remote-vector',
      },
      record: {
        kind: 'remote-http-json',
        endpoint: `${remote.url}/runtime`,
        providerId: 'package-remote-record',
      },
    };
    await writeFile(join(runtimeHome, 'runtime-providers.json'), `${JSON.stringify(providerConfig, null, 2)}\n`, 'utf8');
    await execFileAsync('pnpm', ['build'], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });

    const server = await startCliServer([
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--runtime-home',
      runtimeHome,
    ]);
    await installPackedRuntimePackage(consumerHome);
    const packedBin = join(consumerHome, 'node_modules', 'agent-runtime-services', 'bin', 'agent-runtime-services.mjs');
    await expect(execFileAsync(process.execPath, [packedBin, '--version'], {
      cwd: consumerHome,
      maxBuffer: 10 * 1024 * 1024,
    })).resolves.toMatchObject({ stdout: '0.1.0\n' });
    await expect(execFileAsync(process.execPath, [packedBin, '--help'], {
      cwd: consumerHome,
      maxBuffer: 10 * 1024 * 1024,
    })).resolves.toMatchObject({
      stdout: expect.stringContaining('Local runtime services for domain agents and build agents'),
    });
    await writeFile(join(consumerHome, 'package.json'), '{"type":"module"}\n', 'utf8');
    await writeFile(join(consumerHome, 'consumer.mjs'), `
	import { createRuntimeServicesRpcClient, createRuntimeServicesRpcRuntime } from 'agent-runtime-services';
	import * as runtimeServicesPackage from 'agent-runtime-services';

for (const forbiddenExport of [
  'createLocalArtifactStore',
  'createSqliteArtifactManifestStore',
  'createSqliteRecordStore',
  'createVectorIndex',
  'createLanceDbVectorIndex',
  'createRemoteObjectStore',
  'createRemoteArtifactManifestStore',
  'createRemoteRecordStore',
  'createRemoteVectorStore',
  'createRemoteModelGateway',
  'createRuntimeProviderPortsFromConfig',
  'setSecret',
  'getSecret',
  'removeSecret',
  'listSecretIds',
  'listMcpToolsFromRegistry',
]) {
  if (forbiddenExport in runtimeServicesPackage) {
    throw new Error(\`forbidden public export: \${forbiddenExport}\`);
  }
}

const client = createRuntimeServicesRpcClient({ endpoint: process.env.RUNTIME_SERVICES_RPC_URL });
const typedRuntime = createRuntimeServicesRpcRuntime({ endpoint: process.env.RUNTIME_SERVICES_RPC_URL });
const describe = await client.call('capabilities.describe', {});
const requiredIds = new Set(describe.capabilities.map((capability) => capability.id));
for (const id of [
  'language.complete',
  'embedding.create',
  'vision.generateImage',
  'artifact.save',
  'artifact.list',
  'artifact.get',
  'record.upsert',
  'record.get',
  'memory.event.append',
  'memory.claim.upsert',
  'memory.relation.upsert',
  'memory.context.retrieve',
  'vector.upsert',
  'vector.search',
  'resources.list',
  'resources.doctor',
  'resources.smoke',
  'resources.status',
]) {
  if (!requiredIds.has(id)) throw new Error(\`missing capability: \${id}\`);
}

const language = await client.call('language.complete', { input: 'hello' });
const typedRuntimeStatus = await typedRuntime.language.complete({ input: 'hello' });
const embedding = await client.call('embedding.create', { input: 'hello' });
const image = await client.call('vision.generateImage', { prompt: 'runtime image' });
const artifact = await client.call('artifact.save', {
  namespace: 'package-consumer-artifacts',
  body: 'package consumer body',
  mimeType: 'text/plain',
});
const artifactList = await client.call('artifact.list', { namespace: 'package-consumer-artifacts' });
const artifactGet = await client.call('artifact.get', {
  namespace: 'package-consumer-artifacts',
  id: artifact.artifact.id,
});
await client.call('record.upsert', {
  namespace: 'package-consumer-records',
  tableName: 'runs',
  id: 'run-1',
  data: { artifactId: artifact.artifact.id, imageUrl: image.artifact.url },
});
const record = await client.call('record.get', {
  namespace: 'package-consumer-records',
  tableName: 'runs',
  id: 'run-1',
});
const memoryEvent = await typedRuntime.memory.event.append({
  namespace: 'package-consumer-memory',
  id: 'event-1',
  source: { kind: 'package_consumer', ref: 'consumer.mjs' },
  payload: { text: 'package consumer memory event' },
});
const memoryClaim = await typedRuntime.memory.claim.upsert({
  namespace: 'package-consumer-memory',
  id: 'claim-1',
  kind: 'package_claim',
  subject: { kind: 'package', id: 'consumer' },
  statement: 'package consumer memory claim',
  evidence: [{ kind: 'event', id: 'event-1' }],
  confidence: 0.7,
});
const memoryRelation = await typedRuntime.memory.relation.upsert({
  namespace: 'package-consumer-memory',
  id: 'relation-1',
  type: 'supports',
  from: { kind: 'claim', id: 'claim-1' },
  to: { kind: 'event', id: 'event-1' },
});
await client.call('vector.upsert', {
  tableName: 'package_consumer_vectors',
  id: 'doc-1',
  content: 'package consumer vector',
  embedding: embedding.embedding,
  metadata: { namespace: 'package-consumer-memory', claimId: 'claim-1', eventId: 'event-1' },
});
const vectors = await client.call('vector.search', {
  tableName: 'package_consumer_vectors',
  embedding: embedding.embedding,
  limit: 1,
});
const memoryContext = await typedRuntime.memory.context.retrieve({
  namespace: 'package-consumer-memory',
  tableName: 'package_consumer_vectors',
  embedding: embedding.embedding,
  limit: 1,
  relationshipLimit: 5,
});
const resourcesList = await typedRuntime.resources.list();
const resourcesDoctor = await typedRuntime.resources.doctor();
const resourcesSmoke = await typedRuntime.resources.smoke({ module: 'all' });
const languageSmoke = await typedRuntime.resources.smoke({ module: 'language' });
const status = await typedRuntime.resources.status();
console.log(JSON.stringify({
  language,
  typedRuntimeStatus,
  embedding,
  image,
  artifactCount: artifactList.artifacts.length,
  artifactBody: artifactGet.bodyBase64,
  record,
  memoryEvent,
  memoryClaim,
  memoryRelation,
  memoryContext,
  vectorCount: vectors.results.length,
  resourcesList,
  resourcesDoctor,
  resourcesSmoke,
  languageSmokeResourceIds: languageSmoke.resources.map((resource) => resource.id),
  status,
}));
`, 'utf8');

    const { stdout } = await execFileAsync(process.execPath, ['consumer.mjs'], {
      cwd: consumerHome,
      env: {
        ...process.env,
        RUNTIME_SERVICES_RPC_URL: `${server.url}/rpc`,
      },
      maxBuffer: 10 * 1024 * 1024,
    });
    const result = JSON.parse(stdout) as {
      language: { status: string; providerId: string; proposal?: { text?: string } };
      embedding: { status: string; providerId: string; embedding?: number[] };
      image: { status: string; providerId: string; artifact?: { url?: string } };
      typedRuntimeStatus: { status: string; providerId: string };
      artifactCount: number;
      artifactBody: string;
      record: { status: string; providerId: string; record?: { id?: string; data?: Record<string, unknown> } };
      memoryEvent: { status: string; providerId: string; event?: { id?: string } };
      memoryClaim: { status: string; providerId: string; claim?: { id?: string } };
      memoryRelation: { status: string; providerId: string; relation?: { id?: string } };
      memoryContext: {
        status: string;
        providerId: string;
        bundle?: {
          claims?: Array<{ id?: string }>;
          events?: Array<{ id?: string }>;
          relations?: Array<{ id?: string }>;
        };
      };
      vectorCount: number;
      resourcesList: { status: string; capabilityId: string; resources: Array<{ id: string; provider?: string }> };
      resourcesDoctor: { status: string; capabilityId: string; resources: Array<{ id: string; provider?: string }> };
      resourcesSmoke: { status: string; capabilityId: string; resources: Array<{ id: string; provider?: string }> };
      languageSmokeResourceIds: string[];
      status: { status: string; resources: Array<{ id: string; provider?: string }> };
    };

    expect(result.language).toMatchObject({
      status: 'ok',
      providerId: 'package-remote-model',
      proposal: { text: 'cli remote text: hello' },
    });
    expect(result.embedding).toMatchObject({
      status: 'ok',
      providerId: 'package-remote-model',
      embedding: [0.1, 0.2],
    });
    expect(result.image).toMatchObject({
      status: 'ok',
      providerId: 'package-remote-model',
      artifact: { url: 'https://remote.test/generated/runtime-image.png' },
    });
    expect(result.typedRuntimeStatus).toMatchObject({
      status: 'ok',
      providerId: 'package-remote-model',
    });
    expect(result.artifactCount).toBe(1);
    expect(result.artifactBody).toBe(Buffer.from('package consumer body').toString('base64'));
    expect(result.record).toMatchObject({
      status: 'ok',
      providerId: 'package-remote-record',
      record: { id: 'run-1' },
    });
    expect(result.memoryEvent).toMatchObject({
      status: 'ok',
      providerId: 'local-sqlite-memory',
      event: { id: 'event-1' },
    });
    expect(result.memoryClaim).toMatchObject({
      status: 'ok',
      providerId: 'local-sqlite-memory',
      claim: { id: 'claim-1' },
    });
    expect(result.memoryRelation).toMatchObject({
      status: 'ok',
      providerId: 'local-sqlite-memory',
      relation: { id: 'relation-1' },
    });
    expect(result.memoryContext).toMatchObject({
      status: 'ok',
      providerId: 'local-sqlite-memory+package-remote-vector',
      bundle: {
        claims: [expect.objectContaining({ id: 'claim-1' })],
        events: [expect.objectContaining({ id: 'event-1' })],
        relations: [expect.objectContaining({ id: 'relation-1' })],
      },
    });
    expect(result.vectorCount).toBe(1);
    expect(result.resourcesList).toMatchObject({
      status: 'ok',
      capabilityId: 'resources.list',
      resources: expect.arrayContaining([
        expect.objectContaining({ id: 'model.language_completion', provider: 'package-remote-model' }),
      ]),
    });
    expect(result.resourcesDoctor).toMatchObject({
      status: 'ok',
      capabilityId: 'resources.doctor',
      resources: expect.arrayContaining([
        expect.objectContaining({ id: 'storage.record_store', provider: 'package-remote-record' }),
      ]),
    });
    expect(result.resourcesSmoke).toMatchObject({
      status: 'ok',
      capabilityId: 'resources.smoke',
      resources: expect.arrayContaining([
        expect.objectContaining({ id: 'storage.vector_index', provider: 'package-remote-vector' }),
      ]),
    });
    expect(result.languageSmokeResourceIds).toEqual(['model.language_completion']);
    expect(result.status).toMatchObject({
      status: 'ok',
      resources: expect.arrayContaining([
        expect.objectContaining({ id: 'model.language_completion', provider: 'package-remote-model' }),
        expect.objectContaining({ id: 'storage.record_store', provider: 'package-remote-record' }),
        expect.objectContaining({ id: 'storage.vector_index', provider: 'package-remote-vector' }),
      ]),
    });
    expect(remote.count('/models/complete')).toBe(2);
    expect(remote.count('/models/embedding')).toBe(1);
    expect(remote.count('/models/image')).toBe(1);
    expect(remote.count('/objects/put')).toBe(1);
    expect(remote.count('/objects/get')).toBe(1);
    expect(remote.count('/artifacts/list')).toBe(1);
    expect(remote.count('/artifacts/get')).toBe(1);
    expect(remote.count('/records/get')).toBe(1);
    expect(remote.count('/vectors/search')).toBe(2);
  }, 25_000);
});

async function installPackedRuntimePackage(consumerHome: string): Promise<void> {
  const { stdout } = await execFileAsync('npm', ['pack', '--pack-destination', consumerHome], {
    cwd: repoRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
  const tarballName = stdout.trim().split(/\r?\n/).at(-1);
  if (!tarballName) throw new Error(`npm pack did not report a tarball name.\nstdout:\n${stdout}`);
  const packageDir = join(consumerHome, 'node_modules', 'agent-runtime-services');
  await mkdir(packageDir, { recursive: true });
  await execFileAsync('tar', [
    '-xzf',
    join(consumerHome, tarballName),
    '-C',
    packageDir,
    '--strip-components',
    '1',
  ], { maxBuffer: 10 * 1024 * 1024 });

  await linkRuntimeDependency(consumerHome, 'apache-arrow');
  await linkRuntimeDependency(consumerHome, 'commander');
  await mkdir(join(consumerHome, 'node_modules', '@lancedb'), { recursive: true });
  await linkRuntimeDependency(consumerHome, '@lancedb/lancedb');
}

async function linkRuntimeDependency(consumerHome: string, packageName: string): Promise<void> {
  await symlink(join(repoRoot, 'node_modules', packageName), join(consumerHome, 'node_modules', packageName), 'dir');
}

async function runCli(args: string[]): Promise<string> {
  return (await runCliResult(args)).stdout;
}

interface CliProcessResult {
  exitCode: number | string;
  stdout: string;
  stderr: string;
}

async function runCliResult(args: string[]): Promise<CliProcessResult> {
  const { stdout, stderr } = await execFileAsync(process.execPath, ['bin/agent-runtime-services.mjs', ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  return { exitCode: 0, stdout, stderr };
}

async function runCliFailure(args: string[]): Promise<CliProcessResult> {
  try {
    const result = await runCliResult(args);
    throw new Error(`expected CLI failure but exited 0\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    if (failure.stdout === undefined && failure.stderr === undefined) throw error;
    return {
      exitCode: failure.code ?? 1,
      stdout: bufferLikeToString(failure.stdout),
      stderr: bufferLikeToString(failure.stderr),
    };
  }
}

function bufferLikeToString(value: string | Buffer | undefined): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : value.toString('utf8');
}

async function startCliServer(args: string[]): Promise<{ url: string; pid: number }> {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['bin/agent-runtime-services.mjs', ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  childProcesses.push(child);

  let stdout = '';
  let stderr = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`CLI server did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 10_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
      if (match) {
        clearTimeout(timer);
        resolve({ url: match[1]!, pid: child.pid! });
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`CLI server exited before ready with code ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function rpcCall<T>(endpoint: string, method: string, params: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  expect(response.status).toBe(200);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? 'runtime services rpc error');
  return payload.result as T;
}

async function stopProcess(child: ReturnType<typeof import('node:child_process').spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 2_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function startFakeRemoteRuntimeServer(): Promise<{ url: string; count(route: string): number }> {
  const artifacts: StoredArtifact[] = [];
  const objectBodies = new Map<string, string>();
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
  const server = createServer((request, response) => {
    void (async () => {
      const route = new URL(request.url ?? '/', 'http://127.0.0.1').pathname.replace('/runtime', '');
      routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1);
      const body = await readJsonBody(request);
      if (route === '/resources/probe') {
        writeJson(response, { status: 'ok', message: `ready:${String(body.resourceId)}` });
        return;
      }
      if (route === '/models/complete') {
        expect(body).toEqual({ input: 'hello' });
        writeJson(response, { modelId: 'cli-remote-chat', text: 'cli remote text: hello' });
        return;
      }
      if (route === '/models/embedding') {
        expect(body).toEqual({ input: 'hello' });
        writeJson(response, { modelId: 'cli-remote-embedding', embedding: [0.1, 0.2] });
        return;
      }
      if (route === '/models/image') {
        expect(body).toEqual({ prompt: 'runtime image' });
        writeJson(response, { modelId: 'cli-remote-image', url: 'https://remote.test/generated/runtime-image.png' });
        return;
      }
      if (route === '/objects/put') {
        const object = {
          path: `remote://${String(body.namespace)}/${String(body.key)}`,
          sizeBytes: Buffer.from(String(body.bodyBase64), 'base64').byteLength,
        };
        objectBodies.set(object.path, String(body.bodyBase64));
        writeJson(response, object);
        return;
      }
      if (route === '/objects/get') {
        const bodyBase64 = objectBodies.get(String(body.path));
        writeJson(
          response,
          bodyBase64 ? { bodyBase64 } : { error: { message: 'object not found' } },
          bodyBase64 ? 200 : 404,
        );
        return;
      }
      if (route === '/objects/delete') {
        objectBodies.delete(String(body.path));
        writeJson(response, { ok: true });
        return;
      }
      if (route === '/artifacts/insert') {
        artifacts.push(body.artifact as StoredArtifact);
        writeJson(response, { ok: true });
        return;
      }
      if (route === '/artifacts/list') {
        writeJson(response, {
          artifacts: artifacts.filter((artifact) => artifact.namespace === body.namespace),
        });
        return;
      }
      if (route === '/artifacts/get') {
        const artifact = artifacts.find((item) => item.namespace === body.namespace && item.id === body.id);
        writeJson(
          response,
          artifact ? { artifact } : { error: { message: 'artifact not found' } },
          artifact ? 200 : 404,
        );
        return;
      }
      if (route === '/artifacts/delete') {
        const index = artifacts.findIndex((item) => item.namespace === body.namespace && item.id === body.id);
        if (index === -1) {
          writeJson(response, { error: { message: 'artifact not found' } }, 404);
          return;
        }
        artifacts.splice(index, 1);
        writeJson(response, { ok: true });
        return;
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
        writeJson(response, { ok: true });
        return;
      }
      if (route === '/vectors/search') {
        writeJson(response, { results: vectors.get(String(body.tableName)) ?? [] });
        return;
      }
      if (route === '/records/upsert') {
        const key = recordKey(body);
        const existing = records.get(key);
        const record = {
          namespace: String(body.namespace),
          tableName: String(body.tableName),
          id: String(body.id),
          data: body.data as Record<string, unknown>,
          metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : {},
          createdAt: existing?.createdAt ?? '2026-06-12T00:00:00.000Z',
          updatedAt: '2026-06-12T00:00:01.000Z',
        };
        records.set(key, record);
        writeJson(response, { record });
        return;
      }
      if (route === '/records/get') {
        const record = records.get(recordKey(body));
        writeJson(response, record ? { record } : { error: { message: 'record not found' } }, record ? 200 : 404);
        return;
      }
      if (route === '/records/query') {
        writeJson(response, {
          records: [...records.values()]
            .filter((record) => record.namespace === body.namespace && record.tableName === body.tableName)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
        });
        return;
      }
      if (route === '/records/delete') {
        const key = recordKey(body);
        const record = records.get(key);
        if (!record) {
          writeJson(response, { error: { message: 'record not found' } }, 404);
          return;
        }
        records.delete(key);
        writeJson(response, { deleted: record });
        return;
      }
      writeJson(response, { error: { message: `unexpected route: ${route}` } }, 404);
    })().catch((error: unknown) => {
      writeJson(response, { error: { message: error instanceof Error ? error.message : String(error) } }, 500);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  httpServers.push(server);
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('fake remote server did not expose a TCP address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    count: (route) => routeCounts.get(route) ?? 0,
  };
}

function recordKey(input: Record<string, unknown>): string {
  return `${String(input.namespace)}\0${String(input.tableName)}\0${String(input.id)}`;
}

async function readJsonBody(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.trim() ? JSON.parse(text) as Record<string, unknown> : {};
}

function writeJson(response: import('node:http').ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
