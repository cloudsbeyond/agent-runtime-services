import type { RuntimeServices } from '../runtime-services';

export interface RuntimeServicesRpcClientOptions {
  endpoint: string;
  fetch?: typeof fetch;
}

export interface RuntimeServicesRpcClient {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
}

export function createRuntimeServicesRpcClient(options: RuntimeServicesRpcClientOptions): RuntimeServicesRpcClient {
  let id = 0;
  const fetchImpl = options.fetch ?? fetch;
  const endpoint = options.endpoint.replace(/\/+$/, '');
  return {
    async call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++id,
          method,
          params,
        }),
      });
      if (!response.ok) throw new Error(`runtime services rpc failed (${response.status})`);
      const payload = await response.json() as {
        result?: T;
        error?: { message?: string };
      };
      if (payload.error) throw new Error(payload.error.message ?? 'runtime services rpc error');
      return payload.result as T;
    },
  };
}

export function createRuntimeServicesRpcRuntime(options: RuntimeServicesRpcClientOptions): RuntimeServices {
  return runtimeServicesFromRpcClient(createRuntimeServicesRpcClient(options));
}

export function runtimeServicesFromRpcClient(client: RuntimeServicesRpcClient): RuntimeServices {
  return {
    language: {
      complete: (input) => client.call('language.complete', input),
    },
    embedding: {
      create: (input) => client.call('embedding.create', input),
    },
    vision: {
      generateImage: (input) => client.call('vision.generateImage', input),
    },
    artifact: {
      save: (input) => client.call('artifact.save', input),
      get: (input) => client.call('artifact.get', input),
      list: (input) => client.call('artifact.list', input),
      cleanupExpired: (input) => client.call('artifact.cleanupExpired', input),
    },
    record: {
      upsert: (input) => client.call('record.upsert', input),
      get: (input) => client.call('record.get', input),
      query: (input) => client.call('record.query', input),
      delete: (input) => client.call('record.delete', input),
    },
    memory: {
      event: {
        append: (input) => client.call('memory.event.append', input),
        get: (input) => client.call('memory.event.get', input),
        list: (input) => client.call('memory.event.list', input),
      },
      claim: {
        upsert: (input) => client.call('memory.claim.upsert', input),
        get: (input) => client.call('memory.claim.get', input),
        query: (input) => client.call('memory.claim.query', input),
      },
      relation: {
        upsert: (input) => client.call('memory.relation.upsert', input),
        query: (input) => client.call('memory.relation.query', input),
      },
      context: {
        retrieve: (input) => client.call('memory.context.retrieve', input),
      },
    },
    vector: {
      upsert: (input) => client.call('vector.upsert', input),
      search: (input) => client.call('vector.search', input),
    },
    resources: {
      list: () => client.call('resources.list', {}),
      doctor: () => client.call('resources.doctor', {}),
      smoke: (input) => client.call('resources.smoke', input ?? {}),
      status: () => client.call('resources.status', {}),
    },
  };
}
