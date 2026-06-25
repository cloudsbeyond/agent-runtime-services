import { describe, expect, test } from 'vitest';
import { createResourceCatalog, createDefaultModelProviderConfig, type RuntimeServices } from '../src/index';
import { doctorForCli, formatDoctorReport } from '../src/cli/doctor';
import { modelSmokeFailureMessage, smokeModelsForCli } from '../src/cli/model-smoke';
import { formatResources, listResourcesForCli } from '../src/cli/resources';
import {
  cleanupArtifactsForCli,
  formatArtifactList,
  formatStorageStatus,
  formatVectorSearchResults,
  listArtifactsForCli,
  searchRuntimeContentForCli,
  storageStatusForCli,
  upsertRuntimeContentForCli,
} from '../src/cli/storage';

describe('runtime services CLI helpers', () => {
  test('formats model and storage resources with operator actions', () => {
    const output = formatResources(createResourceCatalog([
      { id: 'model.image_generation', status: 'available', provider: 'volcengine-agent-plan:doubao-seedream-5.0-lite' },
    ]));

    expect(output).toContain('Agent runtime services resources');
    expect(output).toContain('model.language_completion [model] stubbed');
    expect(output).toContain('model.image_generation [model] available via volcengine-agent-plan:doubao-seedream-5.0-lite');
    expect(output).toContain('storage.artifact_store [storage] stubbed');
    expect(output).toContain('action: Provide local or remote artifact storage');
    expect(output).not.toContain('compute.remote_agent_sandbox');
    expect(output).not.toContain('model.presentation_transform');
    expect(output).not.toContain('model.stateless_intent_judge');
  });

  test('summarizes service readiness without future compute stubs', () => {
    const output = formatDoctorReport({
      runtimeHome: '/tmp/runtime-services',
      resources: createResourceCatalog([
        { id: 'model.language_completion', status: 'available', provider: 'volcengine-agent-plan:deepseek-v4-pro' },
        { id: 'model.image_generation', status: 'available', provider: 'volcengine-agent-plan:doubao-seedream-5.0-lite' },
        { id: 'model.embedding', status: 'available', provider: 'volcengine-agent-plan:doubao-embedding-vision' },
        { id: 'storage.artifact_store', status: 'available', provider: 'local-fs+sqlite' },
        { id: 'storage.record_store', status: 'available', provider: 'local-sqlite-record' },
        { id: 'storage.memory_store', status: 'available', provider: 'local-sqlite-memory' },
        { id: 'storage.vector_index', status: 'available', provider: 'local-lancedb' },
      ]),
    });

    expect(output).toContain('Agent runtime services doctor');
    expect(output).toContain('readiness: ok');
    expect(output).toContain('future stubs: none');
    expect(output).not.toContain('compute.remote_agent_sandbox');
  });

  test('surfaces failed resource envelopes instead of formatting them as reports', async () => {
    const services = {
      resources: {
        list: async () => ({
          status: 'failed',
          capabilityId: 'resources.list',
          providerId: 'local-runtime-services',
          modelId: 'not-applicable',
          evidence: [{ kind: 'error', message: 'resource list failed' }],
          resources: [],
        }),
        doctor: async () => ({
          status: 'failed',
          capabilityId: 'resources.doctor',
          providerId: 'local-runtime-services',
          modelId: 'not-applicable',
          evidence: [{ kind: 'error', message: 'resource doctor failed' }],
          resources: [],
        }),
        status: async () => ({
          status: 'failed',
          capabilityId: 'resources.status',
          providerId: 'local-runtime-services',
          modelId: 'not-applicable',
          evidence: [{ kind: 'error', message: 'resource status failed' }],
          resources: [],
        }),
      },
    } as unknown as RuntimeServices;

    await expect(listResourcesForCli(services)).rejects.toThrow('resource list failed');
    await expect(doctorForCli(services, '/tmp/runtime-services')).rejects.toThrow('resource doctor failed');
    await expect(storageStatusForCli(services, '/tmp/runtime-services')).rejects.toThrow('resource status failed');
  });

  test('reports model smoke failures so CLI can exit non-zero after printing details', async () => {
    const services = {
      language: {
        complete: async () => ({
          status: 'missing_resource',
          capabilityId: 'language.complete',
          providerId: 'volcengine-agent-plan',
          modelId: 'deepseek-v4-pro',
          evidence: [{ kind: 'missing_resource', message: 'missing API key' }],
        }),
      },
    } as unknown as RuntimeServices;

    const report = await smokeModelsForCli('language', services);

    expect(report.output).toContain('Agent runtime services model smoke');
    expect(report.output).toContain('- language deepseek-v4-pro: missing_resource missing API key');
    expect(report.failures).toHaveLength(1);
    expect(modelSmokeFailureMessage(report.failures)).toContain('language:missing_resource:missing API key');
  });

  test('formats storage status and artifact metadata without printing artifact bytes or signed URLs', () => {
    const status = formatStorageStatus({
      appDir: '/tmp/runtime-services',
      artifactsDir: '/tmp/runtime-services/artifacts',
      artifactManifestDb: '/tmp/runtime-services/db/artifacts.sqlite',
      recordStoreDb: '/tmp/runtime-services/db/records.sqlite',
      memoryStoreDb: '/tmp/runtime-services/db/memory.sqlite',
      vectorDir: '/tmp/runtime-services/vector',
      resources: createResourceCatalog([
        { id: 'storage.artifact_store', status: 'available', provider: 'local-fs+sqlite' },
        { id: 'storage.record_store', status: 'available', provider: 'local-sqlite-record' },
        { id: 'storage.memory_store', status: 'available', provider: 'local-sqlite-memory' },
        { id: 'storage.vector_index', status: 'available', provider: 'local-lancedb' },
      ]),
    });
    const artifacts = formatArtifactList([{
      id: 'artifact-1',
      namespace: 'contract-test',
      path: '/tmp/runtime-services/artifacts/artifact-1.txt',
      mimeType: 'text/plain',
      sizeBytes: 20,
      sha256: 'hash',
      createdAt: '2026-06-08T08:00:00.000Z',
      source: { kind: 'contract_test', modelId: 'deepseek-v4-pro' },
      sourceUrl: 'https://example.test/signed-url?signature=dummy-fixture',
    }]);

    expect(status).toContain('Agent runtime services storage');
    expect(status).toContain('storage.artifact_store: available via local-fs+sqlite');
    expect(status).toContain('storage.record_store: available via local-sqlite-record');
    expect(status).toContain('memory: /tmp/runtime-services/db/memory.sqlite');
    expect(status).toContain('storage.memory_store: available via local-sqlite-memory');
    expect(artifacts).toContain('Agent runtime services artifacts');
    expect(artifacts).toContain('sourceUrl: present');
    expect(artifacts).not.toContain('secret artifact body');
    expect(artifacts).not.toContain('dummy-fixture');
  });

  test('upserts, searches, formats, and cleans Runtime Services storage through helpers', async () => {
    const services = {
      embedding: {
        create: async () => ({
          status: 'ok',
          capabilityId: 'embedding.create',
          providerId: 'volcengine-agent-plan',
          modelId: 'doubao-embedding-vision',
          evidence: [],
          embedding: [1, 0],
        }),
      },
      vector: {
        upsert: async () => ({
          status: 'ok',
          capabilityId: 'vector.upsert',
          providerId: 'local-lancedb',
          modelId: 'not-applicable',
          evidence: [],
          id: 'note-alpha',
        }),
        search: async () => ({
          status: 'ok',
          capabilityId: 'vector.search',
          providerId: 'local-lancedb',
          modelId: 'not-applicable',
          evidence: [],
          results: [{
            id: 'note-alpha',
            content: 'alpha runtime note',
            embedding: [1, 0],
            score: 0.99,
            createdAt: '2026-06-08T08:00:00.000Z',
            updatedAt: '2026-06-08T08:00:00.000Z',
            metadata: { sourceKind: 'operator_storage_cli' },
          }],
        }),
      },
      artifact: {
        list: async () => ({
          status: 'ok',
          capabilityId: 'artifact.list',
          providerId: 'local-fs+sqlite',
          modelId: 'not-applicable',
          evidence: [],
          artifacts: [{
            id: 'artifact-alpha',
            namespace: 'contract-test',
            path: '/tmp/runtime-services/artifacts/artifact-alpha.txt',
            mimeType: 'text/plain',
            sizeBytes: 12,
            sha256: 'hash-alpha',
            createdAt: '2026-06-08T08:00:00.000Z',
            source: { kind: 'contract_test' },
          }],
        }),
        cleanupExpired: async () => ({
          status: 'ok',
          capabilityId: 'artifact.cleanupExpired',
          providerId: 'local-fs+sqlite',
          modelId: 'not-applicable',
          evidence: [],
          deleted: [{
            id: 'artifact-expired',
            namespace: 'contract-test',
            path: '/tmp/runtime-services/artifacts/artifact-expired.txt',
            mimeType: 'text/plain',
            sizeBytes: 7,
            sha256: 'hash',
            createdAt: '2026-06-08T08:00:00.000Z',
            expiresAt: '2026-06-08T08:30:00.000Z',
            source: {},
          }],
        }),
      },
    } as unknown as RuntimeServices;

    const upsert = await upsertRuntimeContentForCli(
      createDefaultModelProviderConfig(),
      { id: 'note-alpha', content: 'alpha runtime note', tableName: 'operator_notes' },
      { services },
    );
    const search = await searchRuntimeContentForCli(
      createDefaultModelProviderConfig(),
      { query: 'find alpha', tableName: 'operator_notes', limit: 1 },
      { services },
    );
    const artifacts = await listArtifactsForCli(
      services,
      { namespace: 'contract-test', limit: 20 },
    );
    const cleanup = await cleanupArtifactsForCli(
      services,
      { namespace: 'contract-test' },
      new Date('2026-06-08T09:00:00.000Z'),
    );

    expect(upsert).toContain('Agent runtime services vector upsert');
    expect(upsert).toContain('dims=2');
    expect(search).toContain('Agent runtime services vector search');
    expect(search).toContain('note-alpha');
    expect(formatVectorSearchResults([])).toContain('No matching vectors.');
    expect(artifacts).toContain('Agent runtime services artifacts');
    expect(artifacts).toContain('artifact-alpha');
    expect(cleanup).toContain('deleted=1');
    expect(cleanup).not.toContain('secret-value');
  });

  test('surfaces vector search failures instead of formatting them as empty results', async () => {
    const services = {
      vector: {
        search: async () => ({
          status: 'failed',
          capabilityId: 'vector.search',
          providerId: 'local-lancedb',
          modelId: 'not-applicable',
          evidence: [{ kind: 'error', message: 'missing embedding provider' }],
          results: [],
        }),
      },
    } as unknown as RuntimeServices;

    await expect(searchRuntimeContentForCli(
      createDefaultModelProviderConfig(),
      { query: 'find alpha', tableName: 'operator_notes', limit: 1 },
      { services },
    )).rejects.toThrow('missing embedding provider');
  });

  test('surfaces artifact list failures instead of formatting them as empty results', async () => {
    const services = {
      artifact: {
        list: async () => ({
          status: 'failed',
          capabilityId: 'artifact.list',
          providerId: 'local-fs+sqlite',
          modelId: 'not-applicable',
          evidence: [{ kind: 'error', message: 'artifact manifest unavailable' }],
          artifacts: [],
        }),
      },
    } as unknown as RuntimeServices;

    await expect(listArtifactsForCli(
      services,
      { namespace: 'contract-test', limit: 20 },
    )).rejects.toThrow('artifact manifest unavailable');
  });

  test('surfaces artifact cleanup failures instead of formatting them as deleted zero', async () => {
    const services = {
      artifact: {
        cleanupExpired: async () => ({
          status: 'failed',
          capabilityId: 'artifact.cleanupExpired',
          providerId: 'local-fs+sqlite',
          modelId: 'not-applicable',
          evidence: [{ kind: 'error', message: 'artifact cleanup failed' }],
          deleted: [],
        }),
      },
    } as unknown as RuntimeServices;

    await expect(cleanupArtifactsForCli(
      services,
      { namespace: 'contract-test' },
      new Date('2026-06-08T09:00:00.000Z'),
    )).rejects.toThrow('artifact cleanup failed');
  });
});
