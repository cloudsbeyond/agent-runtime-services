import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import pkg from '../../package.json';
import {
  RUNTIME_SERVICE_CAPABILITIES,
  RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS,
  RUNTIME_SERVICE_CAPABILITY_REVISION,
  RUNTIME_SERVICE_CAPABILITY_SCHEMA_VERSION,
} from '../capabilities/registry';
import {
  type RuntimeServices,
} from '../runtime-services';

export interface RuntimeServicesRpcServerOptions {
  services: RuntimeServices;
  host?: string;
  port?: number;
}

export interface RuntimeServicesRpcServer {
  url: string;
  close(): Promise<void>;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export async function startRuntimeServicesRpcServer(
  options: RuntimeServicesRpcServerOptions,
): Promise<RuntimeServicesRpcServer> {
  const host = options.host ?? '127.0.0.1';
  const server = createServer((request, response) => {
    void handleRequest(options.services, request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8765, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port ?? 8765;
  return {
    url: `http://${host}:${port}`,
    close: () => closeServer(server),
  };
}

async function handleRequest(
  services: RuntimeServices,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'GET' && request.url === '/health') {
    writeJson(response, 200, { status: 'ok' });
    return;
  }
  if (request.url !== '/rpc') {
    writeJson(response, 404, { error: 'not_found' });
    return;
  }
  if (request.method !== 'POST') {
    writeJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  const rpc = parseRequest(await readBody(request));
  if (!rpc.method) {
    writeJson(response, 400, rpcError(rpc.id, -32600, 'invalid request'));
    return;
  }
  try {
    writeJson(response, 200, {
      jsonrpc: '2.0',
      id: rpc.id ?? null,
      result: await dispatch(services, rpc.method, paramsRecord(rpc.params)),
    });
  } catch (error) {
    writeJson(response, 200, rpcError(rpc.id, -32601, error instanceof Error ? error.message : String(error)));
  }
}

async function dispatch(
  services: RuntimeServices,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case 'health':
      return { status: 'ok' };
    case 'version':
      return {
        name: pkg.name,
        version: pkg.version,
        capabilitySchemaVersion: RUNTIME_SERVICE_CAPABILITY_SCHEMA_VERSION,
        capabilityRevision: RUNTIME_SERVICE_CAPABILITY_REVISION,
      };
    case 'capabilities.list':
      return {
        schemaVersion: RUNTIME_SERVICE_CAPABILITY_SCHEMA_VERSION,
        packageVersion: pkg.version,
        capabilityRevision: RUNTIME_SERVICE_CAPABILITY_REVISION,
        capabilities: [...RUNTIME_SERVICE_CAPABILITIES],
      };
    case 'capabilities.describe':
      return {
        schemaVersion: RUNTIME_SERVICE_CAPABILITY_SCHEMA_VERSION,
        packageVersion: pkg.version,
        capabilityRevision: RUNTIME_SERVICE_CAPABILITY_REVISION,
        capabilities: [...RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS],
      };
    case 'language.complete':
      return services.language.complete({ input: stringParam(params, 'input') });
    case 'embedding.create':
      return services.embedding.create({ input: params.input as string | unknown[] });
    case 'vision.generateImage':
      return services.vision.generateImage({ prompt: stringParam(params, 'prompt') });
    case 'artifact.save':
      return services.artifact.save(params as unknown as Parameters<RuntimeServices['artifact']['save']>[0]);
    case 'artifact.get':
      return services.artifact.get(params as unknown as Parameters<RuntimeServices['artifact']['get']>[0]);
    case 'artifact.list':
      return services.artifact.list(params as unknown as Parameters<RuntimeServices['artifact']['list']>[0]);
    case 'artifact.cleanupExpired':
      return services.artifact.cleanupExpired(params as unknown as Parameters<RuntimeServices['artifact']['cleanupExpired']>[0]);
    case 'record.upsert':
      return services.record.upsert(params as unknown as Parameters<RuntimeServices['record']['upsert']>[0]);
    case 'record.get':
      return services.record.get(params as unknown as Parameters<RuntimeServices['record']['get']>[0]);
    case 'record.query':
      return services.record.query(params as unknown as Parameters<RuntimeServices['record']['query']>[0]);
    case 'record.delete':
      return services.record.delete(params as unknown as Parameters<RuntimeServices['record']['delete']>[0]);
    case 'memory.event.append':
      return services.memory.event.append(params as unknown as Parameters<RuntimeServices['memory']['event']['append']>[0]);
    case 'memory.event.get':
      return services.memory.event.get(params as unknown as Parameters<RuntimeServices['memory']['event']['get']>[0]);
    case 'memory.event.list':
      return services.memory.event.list(params as unknown as Parameters<RuntimeServices['memory']['event']['list']>[0]);
    case 'memory.claim.upsert':
      return services.memory.claim.upsert(params as unknown as Parameters<RuntimeServices['memory']['claim']['upsert']>[0]);
    case 'memory.claim.get':
      return services.memory.claim.get(params as unknown as Parameters<RuntimeServices['memory']['claim']['get']>[0]);
    case 'memory.claim.query':
      return services.memory.claim.query(params as unknown as Parameters<RuntimeServices['memory']['claim']['query']>[0]);
    case 'memory.relation.upsert':
      return services.memory.relation.upsert(params as unknown as Parameters<RuntimeServices['memory']['relation']['upsert']>[0]);
    case 'memory.relation.query':
      return services.memory.relation.query(params as unknown as Parameters<RuntimeServices['memory']['relation']['query']>[0]);
    case 'memory.context.retrieve':
      return services.memory.context.retrieve(params as unknown as Parameters<RuntimeServices['memory']['context']['retrieve']>[0]);
    case 'vector.upsert':
      return services.vector.upsert(params as unknown as Parameters<RuntimeServices['vector']['upsert']>[0]);
    case 'vector.search':
      return services.vector.search(params as unknown as Parameters<RuntimeServices['vector']['search']>[0]);
    case 'resources.list':
      return services.resources.list();
    case 'resources.status':
      return services.resources.status();
    case 'resources.doctor':
      return services.resources.doctor();
    case 'resources.smoke':
      return services.resources.smoke(params as { module?: 'language' | 'embedding' | 'vision' | 'all' });
    default:
      throw new Error(`unknown method: ${method}`);
  }
}

function parseRequest(body: string): JsonRpcRequest {
  try {
    return JSON.parse(body) as JsonRpcRequest;
  } catch {
    return {};
  }
}

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : {};
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string') throw new Error(`missing string param: ${key}`);
  return value;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string): unknown {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
