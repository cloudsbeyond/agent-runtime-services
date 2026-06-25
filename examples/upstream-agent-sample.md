# Upstream Agent Runtime Services Sample

Use `agent-runtime-services` for shared Runtime Core and Agent Services:
model calls, embeddings, image generation, artifacts, JSON records, memory
substrate, vectors, resources, and smoke/status.

Do not reimplement provider clients, model catalogs, secret resolution,
artifact storage, record storage, memory stores, or vector indexes in the
upstream agent.

## Consumer Port

Upstream business code should depend only on this port. It should not call
`fetch('/rpc')` or transport-specific code directly.

For the consumer-side capability discovery and readiness judgment flow, read
`examples/consumer-agent-capability-guide.md`. That guide is packaged with this
project and includes an A2A packet for handing capability state to another
agent.

```ts
export interface RuntimeServicesPort {
  describe(): Promise<RuntimeCapabilityIndex>;

  call<TInput, TOutput>(
    capabilityId: string,
    input: TInput,
    options: {
      consumer: 'domain-agent' | 'build-agent';
      purpose?: string;
    },
  ): Promise<RuntimeServiceEnvelope<TOutput>>;
}
```

## Local RPC Adapter

Use local `/rpc` for same-machine domain agents and build agents. Start with
`capabilities.describe`; do not hardcode service layers, side effects, or
authority boundaries.

```ts
export function createRpcRuntimeServices(
  endpoint = 'http://127.0.0.1:8765/rpc',
): RuntimeServicesPort {
  let id = 0;

  return {
    async describe() {
      return rpc(endpoint, 'capabilities.describe', {});
    },

    async call(capabilityId, input, options) {
      assertAllowed({ transport: 'rpc', capabilityId, consumer: options.consumer });
      return rpc(endpoint, capabilityId, input);
    },
  };

  async function rpc(endpoint: string, method: string, params: unknown) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    const payload = await res.json();
    if (payload.error) throw new Error(payload.error.message ?? 'runtime rpc error');
    return payload.result;
  }
}
```

## Future MCP Boundary

This sample intentionally keeps the copyable adapter on local `/rpc`, which is
the current P0 transport for same-machine domain agents and build agents.

Future `/mcp` exposure is a governed transport adapter over the same
CapabilityRegistry, not a second implementation of Runtime Services. Do not
silently fallback from future `/mcp` calls to `/rpc`; that would bypass scoped
remote exposure. Add copyable MCP client code only when the MCP transport and
its allowlist/auth boundary are promoted out of P1/P2.

## Usage

```ts
const runtime = createRpcRuntimeServices();
const index = await runtime.describe();

const result = await runtime.call(
  'language.complete',
  { input: 'Summarize this source-backed evidence.' },
  { consumer: 'domain-agent', purpose: 'draft_summary' },
);

if (result.status === 'missing_resource') {
  // Ask the operator to configure provider/resource. Do not fake success.
}
```

## Rules

- Business code must depend on `RuntimeServicesPort`, not transport-specific
  call sites.
- `/rpc` is the current local P0 transport. Future `/mcp` exposure stays
  default-deny and allowlisted.
- Storage calls must pass caller-owned isolation keys: `namespace` for
  artifacts, `namespace` plus `tableName` for records, `namespace` for memory,
  and `tableName` for vectors.
- Runtime Services returns Runtime Core or Agent Services results and evidence
  only.
- Upstream agents keep ownership of domain decisions, build strategy,
  validation, approvals, and release judgment.
- Update this sample when `RUNTIME_SERVICE_CAPABILITIES` or
  `capabilities.describe` changes.

## Capability Sync

This section intentionally lists the current `RUNTIME_SERVICE_CAPABILITIES` so
test coverage catches sample drift:

- `language.complete`
- `embedding.create`
- `vision.generateImage`
- `artifact.save`
- `artifact.get`
- `artifact.list`
- `artifact.cleanupExpired`
- `record.upsert`
- `record.get`
- `record.query`
- `record.delete`
- `memory.event.append`
- `memory.event.get`
- `memory.event.list`
- `memory.claim.upsert`
- `memory.claim.get`
- `memory.claim.query`
- `memory.relation.upsert`
- `memory.relation.query`
- `memory.context.retrieve`
- `vector.upsert`
- `vector.search`
- `resources.list`
- `resources.doctor`
- `resources.smoke`
- `resources.status`
