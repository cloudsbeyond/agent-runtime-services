# Runtime Services Architecture

`agent-runtime-services` is a local-first runtime service plane for domain
agents and build agents. It provides Runtime Core and Agent Services without
becoming a domain agent, build agent, or execution agent.

## P0 Boundary

Domain agents and build agents call Runtime Services for two reusable layers:

- Runtime Core: typed runtime foundation for language completion, embeddings,
  image generation, artifact persistence, JSON record metadata, memory storage,
  vector search, resource status, doctor, smoke checks, provider config, and
  secrets.
- Agent Services: composed, agent-facing services built on Runtime Core for
  reusable memory, context, retrieval, or delivery contracts.

Runtime Services must not decide domain intent, approve risk, choose tools,
change execution sessions, or override downstream agent configuration.

The P0 memory substrate is the first Agent Service. It provides replayable,
auditable context:
append-only events, extracted claims, relationship context, and evidence-backed
retrieval bundles with preserved policy metadata. This extension is needed
because model calls, records, artifacts, and vector search do not by themselves
preserve why a statement should be trusted, which source supports it, or whether
related context has changed. It remains inside the Runtime Services boundary as
an agent-facing service contract; domain agents and build agents still own
interpretation, approval, user-facing summaries, and action coordination.

## Runtime Objects

Runtime objects are the product-level objects that make this service work for
users:

- `RuntimeServices`: typed library facade for Runtime Core and Agent Services.
- `CapabilityRegistry`: public method ids, request/output shape ids, effects,
  service-layer classification, risk class, intended consumers, and authority
  boundaries.
- `ResourceCatalog`: runtime availability requirements and overlays for model
  and storage providers.
- `ModelGateway`: provider-neutral model selection and request execution.
- `ArtifactStore`, `RecordStore`, `MemoryStore`, and `VectorStore`: storage
  ports with explicit caller-owned isolation keys.
- `services/` modules: Agent Services orchestration over Runtime Core ports.
- RPC server/client: localhost JSON-RPC transport over the same library
  contracts.

These objects belong to Product Development. Repository-maintenance material may
index or validate them from a source checkout, but product runtime code must not
import or execute that material.

## Layer Contracts

The product architecture is organized around stable layer contracts:

- public package surface: `src/index.ts`, `package.json`, `README.md`, and
  `examples/`;
- capability declaration layer: `src/capabilities/registry.ts`;
- provider-neutral runtime layer: `src/runtime-services.ts`,
  `src/providers/ports.ts`, and `src/resources/catalog.ts`;
- service composition layer: `src/services/` modules that implement Agent
  Services over Runtime Core ports;
- provider implementation layer: `src/models/`, `src/storage/`,
  `src/providers/`, and `src/config/`;
- local transport layer: `src/rpc/` and CLI commands in `src/cli/`;
- verification layer: contract, acceptance, publication, and smoke tests under
  `test/`.

Each layer can depend inward on product contracts. None of these layers may take
a runtime dependency on repository-maintenance material.

## Boundary Design

Product Development answers how `agent-runtime-services` works for users:
library calls, localhost `/rpc`, local runtime home configuration, model
providers, storage isolation, resource status, package exports, and operator
commands.

Repository maintenance answers how agents safely and repeatedly change the
product: requirements-to-code chain, contract index, drift checks, replay
evidence, SOP, and governance notes. It has one-way observation rights over
Product Development. Product runtime and published package contents do not
depend on it.

## DDD Shape

- `capabilities`: CapabilityRegistry. This is the single source for capability
  ids, request/output schema ids, JSON input schema, service layer, effect class,
  risk class, consumers, and authority boundaries.
- `models`: provider catalog, model module selection, runtime key resolution,
  and provider-specific clients.
- `resources`: capability requirements and available/stubbed overlays.
- `services`: Agent Services composition modules built on Runtime Core ports.
- `storage`: artifact store, JSON record store, memory store, and vector
  indexes.
- `rpc`: local JSON-RPC transport for the same capability contracts exposed by
  the TypeScript library.
- `mcp`: remote MCP adapter mapping from CapabilityRegistry descriptors to
  scoped MCP tools. It must not reimplement model, storage, or resource
  behavior.
- `config`: runtime-home paths, secret refs, keystore, and generic secret
  resolver.

The package boundary contains both Runtime Core and Agent Services. Domain
agents own product runtime, policy, presentation planning, carrier behavior, and
execution-agent orchestration. Build agents own build-time planning, codegen
strategy, validation flow, and release judgment.

## Public Capability Contract

The library entrypoint is `createRuntimeServices(config)`. RPC method names
mirror the library capabilities:

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
- `health`
- `version`
- `capabilities.list`
- `capabilities.describe`

All capability results use the shared envelope:

```text
status: ok | missing_resource | failed
capabilityId: string
providerId: string
modelId: string
evidence: RuntimeServiceEvidence[]
```

RuntimeServices validates required capability inputs before calling provider
ports. Provider clients should not receive malformed requests that are already
rejected by the public capability schema.

`embedding.create` accepts either one non-empty string or a non-empty array of
strings. Mixed arrays and empty batches are rejected before provider calls.

Model outputs are typed proposals, embeddings, or artifacts. They are not
execution decisions.

## External Surfaces

```text
internal core:
  RuntimeServices / CapabilityRegistry / ResourceCatalog / Storage / Models

local surface:
  /rpc
  JSON-RPC 2.0, localhost-first
  consumers: domain-agent, build-agent
  trust model: local runtime home + operator machine boundary

remote surface:
  /mcp
  MCP Streamable HTTP adapter
  consumers: external MCP clients / remote agents
  trust model: auth + origin validation + scoped tool exposure
```

Do not build separate business implementations behind `/rpc` and `/mcp`.
`/mcp` is an adapter over the internal core. `CapabilityRegistry` is the common
source for RPC discovery and future MCP tool/resource schemas.

## RPC Protocol Bias

The RPC protocol is optimized for agent consumers, not human presentation or
high-throughput performance. Prefer explicit, stable, machine-readable fields
over terse output.

The local surface keeps JSON-RPC over a single localhost HTTP POST endpoint
(`/rpc`) as the P0 path. Do not add MCP lifecycle, session management, SSE
streaming, resumability, prompts, or resources semantics to `/rpc`.

Agent-facing discovery uses `capabilities.describe`, which returns method
descriptors with intended consumers (`domain-agent`, `build-agent`), request
shape ids, result shape ids, `serviceLayer` (`runtime-core` or `agent-service`),
side-effect categories, transport hints, and authority boundaries. This lets
consuming agents plan calls without guessing whether a method is Runtime Core or
an Agent Service, writes runtime state, calls a provider, or can affect
domain/build/execution decisions. Top-level request schemas are closed so
consumers do not treat undeclared params as supported extension points.

RPC responses should avoid hidden policy meaning. A method can report evidence,
missing resources, failure details, and state effects; it must not imply user
approval, domain intent, downstream tool choice, session mutation, or policy
override.

## MCP Adapter Boundary

The remote surface is reserved for MCP Streamable HTTP at `/mcp`. The adapter
should start with `initialize`, `tools/list`, and `tools/call`; `resources/list`
and `resources/read` are optional. `GET /mcp` may return `405` while SSE is not
provided.

Remote MCP exposure is default deny. A tool appears only through an explicit
allowlist derived from CapabilityRegistry. Admin and secret operations are not
MCP tools. High-risk capabilities must stay classified:

- `read`: `resources.status`, `artifact.list`, `artifact.get`, `record.get`,
  `record.query`, `memory.event.get`, `memory.event.list`,
  `memory.claim.get`, `memory.claim.query`, `memory.relation.query`
- `write-local`: `artifact.save`, `record.upsert`, `record.delete`,
  `memory.event.append`, `memory.claim.upsert`, `memory.relation.upsert`,
  `vector.upsert`
- `external-provider`: `language.complete`, `embedding.create`,
  `vision.generateImage`, `memory.context.retrieve`
- `admin-secret`: reserved; not exposed through MCP by default

Remote MCP transport requires authentication, Origin validation, and scoped tool
exposure before it is considered ready for non-local clients.

## State Classes

- Model provider config: durable runtime-service state.
- Encrypted keystore entries: durable local operator state.
- Provider requests: stateless service calls, with possible external-provider
  state at the provider.
- Artifact store: durable runtime-service support state.
- Record store and memory store: durable runtime-service support state, not
  execution-agent session memory.
- Vector index: durable runtime-service retrieval support state.
- RPC server process: bounded local service state.

State is scoped to the configured runtime home. Secrets are configurable and are
not shared by default across projects.

## Product Architecture Documents

- [Storage And Retrieval Design](./storage-retrieval-design.md): artifact
  namespace isolation, record namespace/table isolation, vector table
  isolation, memory namespace isolation, SQLite manifest/record/memory metadata
  boundary, LanceDB retrieval, and migration direction.
- [Memory Substrate PRD](./memory-substrate-prd.md): L1 product contract
  for append-only events, claims, relationship context, preserved policy
  metadata, and retrieval bundles.

## Change Rules

- Public names must stay project-neutral. Avoid consuming-project terms such as
  Bridge, Feishu, Lark, Codex endpoint, or product-specific ontology objects.
- Add new provider behavior behind `models/` and expose it through existing
  capability envelopes.
- Add new storage behavior behind `storage/` and keep it outside execution-agent
  memory/session semantics.
- Add new RPC methods only when there is a matching library capability or
  lifecycle method.
- Tests must cover missing-resource behavior, secret non-disclosure, and lib/RPC
  contract parity for any new capability.
