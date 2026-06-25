import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createRuntimeServices,
} from '../src/index';
import {
  createRuntimeProviderPortsFromConfig,
  type ObjectProviderConfig,
  type RuntimeProviderConfig,
} from '../src/providers/config';

describe('runtime provider configuration', () => {
  test('empty config assembles local filesystem/sqlite artifact and LanceDB vector providers', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'agent-runtime-services-provider-config-'));
    const ports = createRuntimeProviderPortsFromConfig({}, { runtimeHome });
    const services = createRuntimeServices({
      runtimeHome,
      ports,
    });

    await expect(services.artifact.save({
      namespace: 'local-artifacts',
      body: 'hello',
      mimeType: 'text/plain',
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'local-fs+sqlite',
    });
    await expect(services.vector.upsert({
      tableName: 'local_vectors',
      id: 'doc-1',
      content: 'hello vector',
      embedding: [1, 0],
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'local-lancedb',
    });
    await expect(services.record.upsert({
      namespace: 'local-records',
      tableName: 'runs',
      id: 'run-1',
      data: { ok: true },
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'local-sqlite-record',
      record: { namespace: 'local-records', tableName: 'runs', id: 'run-1' },
    });
    await expect(services.resources.status()).resolves.toMatchObject({
      status: 'ok',
      resources: expect.arrayContaining([
        expect.objectContaining({
          id: 'storage.artifact_store',
          status: 'available',
          provider: 'local-fs+sqlite',
        }),
        expect.objectContaining({
          id: 'storage.vector_index',
          status: 'available',
          provider: 'local-lancedb',
        }),
        expect.objectContaining({
          id: 'storage.record_store',
          status: 'available',
          provider: 'local-sqlite-record',
        }),
      ]),
    });
  });

  test('remote config assembles remote object, manifest, and vector providers without local fallback', async () => {
    const config: RuntimeProviderConfig = {
      artifact: {
        object: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-object-config',
          headers: { Authorization: 'Bearer test' },
        },
        manifest: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-rds-config',
        },
      },
      vector: {
        kind: 'remote-http-json',
        endpoint: 'https://remote.test/runtime',
        providerId: 'remote-vector-config',
      },
      record: {
        kind: 'remote-http-json',
        endpoint: 'https://remote.test/runtime',
        providerId: 'remote-record-config',
      },
    };
    const ports = createRuntimeProviderPortsFromConfig(config, {
      fetch: async (url, init) => {
        const route = new URL(String(url)).pathname.replace('/runtime', '');
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        if (route === '/resources/probe') return jsonResponse({
          status: 'ok',
          message: `ready:${String(body.kind)}`,
        });
        if (route === '/objects/put') return jsonResponse({
          path: `remote://${body.namespace}/${body.key}`,
          sizeBytes: 5,
        });
        if (route === '/artifacts/insert') return jsonResponse({ ok: true });
        if (route === '/artifacts/list') return jsonResponse({ artifacts: [] });
        if (route === '/vectors/upsert') return jsonResponse({ ok: true });
        if (route === '/vectors/search') return jsonResponse({ results: [] });
        if (route === '/records/upsert') return jsonResponse({
          record: {
            namespace: body.namespace,
            tableName: body.tableName,
            id: body.id,
            data: body.data,
            metadata: body.metadata ?? {},
            createdAt: '2026-06-12T00:00:00.000Z',
            updatedAt: '2026-06-12T00:00:00.000Z',
          },
        });
        return jsonResponse({ error: { message: `unexpected route: ${route}` } }, 404);
      },
    });
    const services = createRuntimeServices({ ports });

    await expect(services.artifact.save({
      namespace: 'remote-artifacts',
      body: 'hello',
      mimeType: 'text/plain',
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'remote-object-config+remote-rds-config',
    });
    await expect(services.vector.upsert({
      tableName: 'remote_vectors',
      id: 'doc-1',
      content: 'hello vector',
      embedding: [1, 0],
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'remote-vector-config',
    });
    await expect(services.record.upsert({
      namespace: 'remote-records',
      tableName: 'runs',
      id: 'run-1',
      data: { ok: true },
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'remote-record-config',
      record: { namespace: 'remote-records', tableName: 'runs', id: 'run-1' },
    });
    await expect(services.resources.status()).resolves.toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({
          id: 'storage.artifact_store',
          provider: 'remote-object-config+remote-rds-config',
        }),
        expect.objectContaining({
          id: 'storage.vector_index',
          provider: 'remote-vector-config',
        }),
        expect.objectContaining({
          id: 'storage.record_store',
          provider: 'remote-record-config',
        }),
      ]),
    });
  });

  test('remote providers require endpoint and vector config rejects sqlite fallback', () => {
    expect(() => createRuntimeProviderPortsFromConfig({
      artifact: {
        object: { kind: 'remote-http-json', providerId: 'broken-object' } as ObjectProviderConfig,
      },
    })).toThrow('artifact.object.endpoint is required');

    expect(() => createRuntimeProviderPortsFromConfig({
      vector: { kind: 'local-sqlite-vector' } as unknown as RuntimeProviderConfig['vector'],
    })).toThrow('unsupported vector provider kind: local-sqlite-vector');

    expect(() => createRuntimeProviderPortsFromConfig({
      record: { kind: 'remote-http-json', providerId: 'broken-record' } as RuntimeProviderConfig['record'],
    })).toThrow('record.endpoint is required');
  });

  test('remote config passes operation policy to adapters', async () => {
    let attempts = 0;
    const ports = createRuntimeProviderPortsFromConfig({
      vector: {
        kind: 'remote-http-json',
        endpoint: 'https://remote.test/runtime',
        providerId: 'remote-vector-policy',
        operationPolicy: {
          retry: { attempts: 3, backoffMs: 0 },
        },
      },
    }, {
      fetch: async (url) => {
        const route = new URL(String(url)).pathname.replace('/runtime', '');
        if (route !== '/vectors/upsert') return jsonResponse({ ok: true });
        attempts += 1;
        if (attempts < 3) return jsonResponse({ error: { message: 'try again later' } }, 503);
        return jsonResponse({ ok: true });
      },
    });
    const services = createRuntimeServices({ ports });

    await expect(services.vector.upsert({
      tableName: 'policy_vectors',
      id: 'doc-1',
      content: 'policy retry',
      embedding: [1, 0],
    })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'remote-vector-policy',
    });
    expect(attempts).toBe(3);
  });

  test('remote model config assembles model gateway and probes model resources', async () => {
    const requests: Array<{ route: string; body: Record<string, unknown> }> = [];
    const services = createRuntimeServices({
      providerConfig: {
        model: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-model-config',
          headers: { Authorization: 'Bearer test' },
          operationPolicy: {
            retry: { attempts: 3, backoffMs: 0 },
          },
        },
      },
      fetch: async (url, init) => {
        const route = new URL(String(url)).pathname.replace('/runtime', '');
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ route, body });
        if (route === '/resources/probe') {
          expect(init?.headers).toMatchObject({ Authorization: 'Bearer test' });
          return jsonResponse({ status: 'ok', message: `ready:${String(body.resourceId)}` });
        }
        if (route === '/models/complete') {
          expect(init?.headers).toMatchObject({ Authorization: 'Bearer test' });
          return jsonResponse({ modelId: 'remote-chat', text: `remote:${String(body.input)}` });
        }
        return jsonResponse({ error: { message: `unexpected route: ${route}` } }, 404);
      },
    });

    await expect(services.language.complete({ input: 'hello' })).resolves.toMatchObject({
      status: 'ok',
      providerId: 'remote-model-config',
      modelId: 'remote-chat',
      proposal: { text: 'remote:hello' },
    });
    await expect(services.resources.status()).resolves.toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({
          id: 'model.language_completion',
          status: 'available',
          provider: 'remote-model-config',
        }),
        expect.objectContaining({
          id: 'model.embedding',
          status: 'available',
          provider: 'remote-model-config',
        }),
        expect.objectContaining({
          id: 'model.image_generation',
          status: 'available',
          provider: 'remote-model-config',
        }),
      ]),
    });
    expect(requests.map((request) => request.route)).toEqual([
      '/models/complete',
      '/resources/probe',
      '/resources/probe',
      '/resources/probe',
    ]);
  });

  test('remote model health failures mark model resources stubbed without default fallback', async () => {
    const services = createRuntimeServices({
      providerConfig: {
        model: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-model-down',
        },
      },
      fetch: async (url) => {
        const route = new URL(String(url)).pathname.replace('/runtime', '');
        if (route === '/resources/probe') return jsonResponse({
          error: { message: 'remote health unavailable' },
        }, 503);
        if (route === '/models/complete') return jsonResponse({
          error: { message: 'remote model unavailable' },
        }, 503);
        return jsonResponse({ error: { message: `unexpected route: ${route}` } }, 404);
      },
    });

    await expect(services.resources.status()).resolves.toMatchObject({
      status: 'ok',
      resources: expect.arrayContaining([
        expect.objectContaining({
          id: 'model.language_completion',
          status: 'stubbed',
          provider: 'remote-model-down',
          evidence: expect.arrayContaining([
            expect.objectContaining({ message: expect.stringContaining('remote health unavailable') }),
          ]),
        }),
        expect.objectContaining({
          id: 'model.embedding',
          status: 'stubbed',
          provider: 'remote-model-down',
          evidence: expect.arrayContaining([
            expect.objectContaining({ message: expect.stringContaining('remote health unavailable') }),
          ]),
        }),
        expect.objectContaining({
          id: 'model.image_generation',
          status: 'stubbed',
          provider: 'remote-model-down',
          evidence: expect.arrayContaining([
            expect.objectContaining({ message: expect.stringContaining('remote health unavailable') }),
          ]),
        }),
      ]),
    });
    await expect(services.language.complete({ input: 'hello' })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'language.complete',
      providerId: 'remote-model-down',
      evidence: [expect.objectContaining({
        message: expect.stringMatching(/\/models\/complete.*attempts=1.*remote model unavailable/),
      })],
    });
  });

  test('remote model config rejects secret-backed headers until supported', () => {
    expect(() => createRuntimeProviderPortsFromConfig({
      model: {
        kind: 'remote-http-json',
        endpoint: 'https://remote.test/runtime',
        headersSecretId: 'REMOTE_MODEL_HEADERS',
      },
    })).toThrow('model.headersSecretId is not supported yet; use explicit headers');
  });

  test('remote health failures mark resources stubbed and calls still fail without local fallback', async () => {
    const config: RuntimeProviderConfig = {
      artifact: {
        object: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-object-down',
        },
        manifest: {
          kind: 'remote-http-json',
          endpoint: 'https://remote.test/runtime',
          providerId: 'remote-rds-down',
        },
      },
      vector: {
        kind: 'remote-http-json',
        endpoint: 'https://remote.test/runtime',
        providerId: 'remote-vector-down',
      },
    };
    const services = createRuntimeServices({
      providerConfig: config,
      fetch: async (url) => {
        const route = new URL(String(url)).pathname.replace('/runtime', '');
        if (route === '/resources/probe') return jsonResponse({
          error: { message: 'remote health unavailable' },
        }, 503);
        if (route === '/objects/put') return jsonResponse({
          error: { message: 'remote object unavailable' },
        }, 503);
        if (route === '/vectors/search') return jsonResponse({
          error: { message: 'remote vector unavailable' },
        }, 503);
        return jsonResponse({ error: { message: `unexpected route: ${route}` } }, 404);
      },
    });

    await expect(services.resources.status()).resolves.toMatchObject({
      status: 'ok',
      resources: expect.arrayContaining([
        expect.objectContaining({
          id: 'storage.artifact_store',
          status: 'stubbed',
          provider: 'remote-object-down+remote-rds-down',
          evidence: expect.arrayContaining([
            expect.objectContaining({ message: expect.stringContaining('remote health unavailable') }),
          ]),
        }),
        expect.objectContaining({
          id: 'storage.vector_index',
          status: 'stubbed',
          provider: 'remote-vector-down',
          evidence: expect.arrayContaining([
            expect.objectContaining({ message: expect.stringContaining('remote health unavailable') }),
          ]),
        }),
      ]),
    });
    await expect(services.artifact.save({
      namespace: 'tenant-a',
      body: 'hello',
      mimeType: 'text/plain',
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'artifact.save',
      providerId: 'remote-object-down+remote-rds-down',
      evidence: [expect.objectContaining({
        message: expect.stringMatching(/\/objects\/put.*attempts=1.*remote object unavailable/),
      })],
    });
    await expect(services.vector.search({
      tableName: 'tenant_vectors',
      embedding: [1, 0],
      limit: 1,
    })).resolves.toMatchObject({
      status: 'failed',
      capabilityId: 'vector.search',
      providerId: 'remote-vector-down',
      results: [],
      evidence: [expect.objectContaining({
        message: expect.stringMatching(/\/vectors\/search.*attempts=1.*remote vector unavailable/),
      })],
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
