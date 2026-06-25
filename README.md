# Agent Runtime Services

[简体中文](README.zh-CN.md)

Local-first runtime service plane for domain agents and build agents. The
package exposes a TypeScript library and a localhost JSON-RPC service for
Runtime Core capabilities and Agent Services backed by models, storage, vectors,
resources, and secrets.

Runtime home defaults to `~/.agent-runtime-services`.

## Positioning

`agent-runtime-services` is a project-neutral runtime service plane. Domain
agents and build agents consume it through typed capabilities or local JSON-RPC;
they do not own provider clients, model catalogs, artifact stores, record
stores, memory stores, vector indexes, or generic secret resolution.

Secrets remain operator-configurable per runtime home. Runtime Core covers model
access, capability envelopes, artifact storage, record storage, memory storage,
vector storage, resource discovery, provider config, and secret resolution.
Agent Services are composed, agent-facing services built on Runtime Core.
Domain-agent and build-agent projects can reuse both layers without maintaining
duplicate provider/storage code or accepting hidden decision authority.

## Product Narrative

Agent projects need a runtime plane before they need another domain-specific
agent framework. The repeated work is provider selection, secret lookup,
artifact and record persistence, vector search, resource readiness, and a way to
preserve source-backed memory context. If every consuming agent owns those
pieces directly, projects duplicate provider/storage code and diverge at the
contracts agents need to share.

Runtime Services keeps that runtime surface project-neutral. It exposes two
service layers:

- Runtime Core: reusable runtime foundation for model access, artifacts,
  records, vectors, resources, secrets, provider config, and capability
  envelopes.
- Agent Services: composed services built on Runtime Core for agent-facing
  memory, context, retrieval, or delivery contracts. They do not own domain
  judgment, approval, tool choice, session mutation, or action coordination.

Its public surface has four jobs:

- execute provider-backed model capabilities without leaking provider details;
- persist artifacts, JSON records, memory objects, and vectors under explicit
  caller-owned isolation keys;
- report resource readiness and operator smoke status through standard Runtime
  Services envelopes;
- expose the same capability contracts through the TypeScript library and local
  JSON-RPC.

The memory substrate is the first Agent Service inside that surface, not the
whole product. Its underlying `MemoryStore` belongs to Runtime Core; the public
`memory.*` family gives source-backed context a replayable and auditable shape:

```text
append-only event -> extracted claim -> relationship context -> evidence-backed retrieval bundle
```

This belongs in Runtime Services because it is an agent-facing service contract,
not domain judgment. The service can preserve events, evidence, claims,
relationships, retrieval bundles, and caller-provided policy metadata while
still refusing to decide domain intent, approval, tool choice, session mutation,
or coordinated action. Consuming agents remain responsible for interpretation
and user-facing behavior.

The L1 PRD for this capability is
[`architecture/memory-substrate-prd.md`](architecture/memory-substrate-prd.md).
It describes why the memory substrate belongs in P0, what stays out of P0, and
how the capability contract is proven across L1-L4.

## Domain Structure

- `capabilities/`: CapabilityRegistry, the single source for capability ids,
  request/output schemas, service-layer classification, effects, risk class,
  consumers, and authority.
- `models/`: provider catalog, module selection, provider runtime resolution,
  and provider API clients.
- `resources/`: capability/resource catalog and availability overlays.
- `services/`: Agent Services composition modules built from Runtime Core ports.
- `storage/`: artifact store, JSON record store, memory store, and vector
  indexes.
- `rpc/`: localhost JSON-RPC server/client that mirrors the library
  capability interface.
- `mcp/`: MCP adapter mapping helpers over the same CapabilityRegistry. Full
  remote transport is intentionally not duplicated as a second business layer.
- `config/`: runtime home paths, secret refs, encrypted keystore, and generic
  secret resolver.

## Usage

```bash
pnpm install
pnpm test
pnpm build
agent-runtime-services models install-volcengine-agent-plan
agent-runtime-services secrets set --id ARK_API_KEY
agent-runtime-services serve --host 127.0.0.1 --port 8765
```

The library entrypoint is `createRuntimeServices(config)`. It exposes typed
capabilities across two service layers:

Runtime Core:

- `language.complete`
- `embedding.create`
- `vision.generateImage`
- `artifact.save/get/list/cleanupExpired`
- `record.upsert/get/query/delete`
- `vector.upsert/search`
- `resources.list/doctor/smoke/status`

Agent Services:

- `memory.event.append/get/list`
- `memory.claim.upsert/get/query`
- `memory.relation.upsert/query`
- `memory.context.retrieve`

The RPC service mirrors those capabilities over localhost JSON-RPC and also
supports `health`, `version`, `capabilities.list`, and
`capabilities.describe`. The descriptor endpoint is intentionally
agent-friendly: it returns intended consumers, machine-readable request shapes,
result shapes, `serviceLayer` classification (`runtime-core` or
`agent-service`), side-effect categories, transport hints, and authority
boundaries rather than human-facing help text.

Provider port assembly is configured separately from the model catalog. The
local model catalog remains `model-providers.json`; runtime provider port
selection lives in `runtime-providers.json` under the runtime home. If
`runtime-providers.json` is absent, `serve` uses local defaults. If present, it
can point model, artifact object, artifact manifest, record, and vector ports at
remote HTTP/JSON adapters without changing any `/rpc` method or request shape.
Memory replacement is available through the typed `MemoryStorePort`; remote
memory provider assembly in `runtime-providers.json` is deferred until a concrete
metadata service is selected.
Use `agent-runtime-services serve --provider-config <path>` to override the
default `<runtime-home>/runtime-providers.json`. The `resources`, `doctor`,
`storage`, and `models smoke` commands accept the same `--runtime-home` and
`--provider-config` options so operator checks inspect the same runtime provider
assembly as the running RPC process. `models smoke` also accepts `--config` to
override the model provider config used for the smoke call. These files are
local operator configuration and must not be committed.

## Remote Provider Config

Use `runtime-providers.json` when the stable `/rpc` surface should route through
remote provider services instead of local defaults. The shape is stable at the
Runtime Services boundary; provider implementations behind the endpoints remain
replaceable:

```json
{
  "model": {
    "kind": "remote-http-json",
    "endpoint": "https://runtime.example/internal",
    "providerId": "remote-model"
  },
  "artifact": {
    "object": {
      "kind": "remote-http-json",
      "endpoint": "https://runtime.example/internal",
      "providerId": "remote-object"
    },
    "manifest": {
      "kind": "remote-http-json",
      "endpoint": "https://runtime.example/internal",
      "providerId": "remote-rds-manifest"
    }
  },
  "record": {
    "kind": "remote-http-json",
    "endpoint": "https://runtime.example/internal",
    "providerId": "remote-record"
  },
  "vector": {
    "kind": "remote-http-json",
    "endpoint": "https://runtime.example/internal",
    "providerId": "remote-vector"
  }
}
```

Each remote adapter is a JSON-over-HTTP POST contract relative to `endpoint`.
The current adapter routes are:

- `/resources/probe`
- `/models/complete`
- `/models/embedding`
- `/models/image`
- `/objects/put`
- `/objects/get`
- `/objects/delete`
- `/artifacts/insert`
- `/artifacts/list`
- `/artifacts/get`
- `/artifacts/delete`
- `/records/upsert`
- `/records/get`
- `/records/query`
- `/records/delete`
- `/vectors/upsert`
- `/vectors/search`

Storage routes carry caller-owned isolation keys:

- `/objects/put`: `{ namespace, key, bodyBase64, mimeType? }`
- `/objects/get`: `{ path }`
- `/objects/delete`: `{ path }`
- `/artifacts/list`: `{ namespace }`
- `/artifacts/get`: `{ namespace, id }`
- `/artifacts/delete`: `{ namespace, id }`
- `/records/upsert`: `{ namespace, tableName, id, data, metadata? }`
- `/records/get`: `{ namespace, tableName, id }`
- `/records/query`: `{ namespace, tableName, limit? }`
- `/records/delete`: `{ namespace, tableName, id }`
- `/vectors/upsert`: `{ tableName, record }`
- `/vectors/search`: `{ tableName, embedding, limit?, filter? }`

`/vectors/search` accepts a minimal structured hybrid retrieval filter:
`{ filter: { metadata: { key: string | number | boolean } } }`. This is not a
caller-provided SQL DSL. The local LanceDB implementation compiles it to a
pre-filtering `where(...)` predicate only when `filter` is present; unfiltered
vector search stays on the plain vector-search path.

Explicit `headers` are supported for trusted local/operator configuration.
`headersSecretId` is reserved and currently rejected so secret indirection does
not silently appear in provider calls before it has a verified contract.

`/rpc` is the local surface for domain-agent and build-agent consumers. `/mcp`
is reserved as the remote MCP Streamable HTTP adapter surface and must map from
CapabilityRegistry with explicit scoped exposure rather than reimplementing the
same capability logic.

Runtime service outputs use a common envelope with `status`, `capabilityId`,
`providerId`, `modelId`, and `evidence`. Model outputs are typed proposals,
embeddings, or artifacts; they are not execution-agent decisions.

Operator CLI commands must not format failed Runtime Services envelopes as
successful empty output. `models smoke` prints per-module status and exits
non-zero when any model envelope is `missing_resource` or `failed`; resource and
doctor commands keep resource availability in the report while still surfacing a
non-`ok` Runtime Services envelope as a CLI error.

## Storage Isolation

User data operations must carry explicit isolation keys. Artifact operations
require `namespace`; record operations require `namespace` plus `tableName`;
memory event, claim, relation, and context operations require `namespace`;
vector upsert/search requires `tableName`. Missing keys are returned as failed
Runtime Services envelopes instead of falling back to a shared default bucket.

The local artifact implementation stores bytes under `artifacts/<namespace>/`
and keeps only manifest metadata in SQLite (`id`, `namespace`, path, MIME type,
size, hash, timestamps, and source metadata). SQLite is not used for vector
storage or retrieval; local vectors are stored and searched through LanceDB
tables named by the caller-provided `tableName`.

Artifact retrieval is `artifact.get` by explicit `namespace` plus `id`. It
returns the manifest and object bytes as `bodyBase64`; SQLite remains the
manifest/RDS-style metadata store and does not store artifact bodies.
Optional artifact expiration dates must be valid date strings before they reach
provider ports or local manifests.

Record storage is exposed as `record.upsert/get/query/delete` for JSON metadata
records. Each call uses explicit `namespace`, `tableName`, and record `id`
where applicable; `record.query` only lists records from one namespace/table in
stable createdAt/id order. A `record.query` limit of `0` returns an empty
record set. Binary or large object bodies stay in `artifact.*`.

The memory substrate is exposed as the `memory.*` Agent Service family:
`memory.event.*`, `memory.claim.*`, `memory.relation.*`, and
`memory.context.retrieve`. It keeps source events, extractor claims, generic
relations, and retrieval bundles inside the requested namespace, returning
agent-facing context rather than a business decision, approval, tool choice, or
action. Optional event timestamps must be valid date strings, and a retrieval
`limit` of `0` returns an empty bundle without touching vector or memory
providers. The full memory-substrate rationale and acceptance contract lives in
[`architecture/memory-substrate-prd.md`](architecture/memory-substrate-prd.md).

Vector search can combine similarity with exact top-level metadata prefilters.
Use `filter.metadata` for high-frequency scalar constraints such as source,
project, kind, or tenant labels. Values are limited to strings, finite numbers,
and booleans; nested JSON filters, raw SQL predicates, null semantics, range
queries, and boolean expression DSLs are intentionally outside P0.
A `vector.search` limit of `0` returns an empty result set without touching the
vector provider.

## RPC Client Sample

Start the local service, then run or adapt the TypeScript sample in
`examples/client-sample.ts`:

```bash
agent-runtime-services serve --host 127.0.0.1 --port 8765
```

The sample uses `createRuntimeServicesRpcClient` with
`http://127.0.0.1:8765/rpc`, calls `capabilities.describe` for agent-facing
discovery, then exercises model, artifact, record, memory, vector, and
`resources.list/doctor/smoke/status` flows through the public RPC surface.

Consumers that want the typed `RuntimeServices` shape over RPC can use
`createRuntimeServicesRpcRuntime({ endpoint })`. Lower-level callers can use
`createRuntimeServicesRpcClient({ endpoint })` and call capability ids directly.

For upstream domain-agent and build-agent integration, use the pasteable sample
in `examples/upstream-agent-sample.md`. It shows the shared `RuntimeServicesPort`,
local `/rpc` adapter, and the deferred `/mcp` boundary that keeps future remote
exposure separate while sharing the same internal Runtime Services
capabilities.

Consumer agents that need to discover and judge available capabilities should
read `examples/consumer-agent-capability-guide.md`. It documents the startup
sequence through `health`, `version`, `capabilities.describe`, and
`resources.status`. Consumers can compare `capabilityRevision` from `/rpc`
responses to detect public capability changes online without reading this
repository, then refresh their local capability cache.

## Product Development Boundary

This README is the product-facing entrypoint for Product Development. It
describes what the runtime service does for users and contributors, the main
run path, public capabilities, storage boundaries, package contents, and
operator commands.

Product Development includes `src/`, `bin/`, `README.md`, `architecture/`,
`examples/`, public contracts, tests, harnesses, and package metadata. These
files must stay publishable and must not depend on repository-maintenance
material.

Repository-maintenance material may read and index this product surface from a
source checkout. It is not part of the runtime service or package payload.
Product runtime code must not import from it.
