# Layered Implementation Plan

This plan is the Agent DevOps implementation guide for Agent Runtime Services as
a runtime service plane with Runtime Core and Agent Services for multiple
agents. It supersedes
implementation-driven shape decisions when current code and the target
architecture diverge.

## Target Positioning

Agent Runtime Services provides stable Runtime Core capabilities and Agent
Services for multiple agent consumers:

- model access;
- object storage and retrieval;
- RDS or manifest-style metadata storage and retrieval;
- JSON record metadata storage and retrieval;
- memory substrate Agent Service event, claim, relation, and retrieval context;
- vector storage and retrieval;
- resource discovery and readiness checks.

The current P0 memory substrate is the first Agent Service over those Runtime
Core primitives:

- append-only event capture for replay;
- claim storage that preserves evidence, confidence, status, and freshness;
- relationship context for bounded graph expansion;
- retrieval bundles that combine vectors, claims, relationships, evidence, and
  preserved policy metadata.

The reason to add these at the Runtime Services layer is reuse and boundary
control. Domain agents and build agents already need replayable source context
and evidence-backed retrieval, but duplicating event logs, claim schemas, and
relationship stores in every consuming project would fragment the shared
service contract. Runtime Services should provide the typed substrate while
refusing to make domain decisions, approvals, tool choices, or coordinated
actions.

The external contract should stay stable while internal providers remain
replaceable. A local deployment may use SQLite, LanceDB, and filesystem storage.
A future deployment may use remote model, object, RDS, memory metadata, and
vector services.

The current `/rpc` surface is local and does not implement service governance,
authentication, tenant authorization, or audit enforcement. Future `/mcp`
exposure is the governance boundary.

## Architecture Layers

```text
L1 Public Capability Contract
  Product narrative and L1 PRD
  CapabilityRegistry
  RuntimeServices TypeScript interface
  JSON-RPC method ids and stable request/result shapes

L2 Service Orchestration
  createRuntimeServices
  envelope normalization
  provider/resource selection
  caller-owned isolation key checks

L3 Provider Ports
  ModelGateway
  ObjectStore
  ManifestStore / RdsStore
  RecordStore / RdsStore
  MemoryStore
  VectorStore
  ResourceProbe

L4 Local Provider Adapters
  Volcengine/OpenAI-compatible model adapter
  filesystem object store
  SQLite manifest/RDS and memory metadata adapter
  LanceDB vector adapter

L5 Remote Provider Adapters
  remote model endpoint
  S3/OSS-compatible object store
  RDS-compatible metadata store
  remote record service
  remote vector service

L6 Transports
  local JSON-RPC over localhost
  future MCP adapter over the same L1-L3 core

L7 External Acceptance
  consumer discovers capabilities
  calls model/object/record/memory/vector/resource flows through the public surface
  validates behavior without depending on implementation modules
```

## Layer Rules

### L1 Public Capability Contract

- Product narrative and L1 PRDs explain why a capability belongs in Runtime
  Services before method ids are added.
- `CapabilityRegistry` is the source of truth for capability ids, request
  shapes, result shapes, `serviceLayer`, risk/effect classes, intended
  consumers, and authority.
- Capability ids are stable product contracts.
- `paramsShape` and `resultShape` names are compatibility anchors and should
  change only on a deliberate contract version change.
- Storage calls require caller-owned isolation keys:
  - artifacts use `namespace`;
  - records use `namespace` and `tableName`;
  - vectors use `tableName`.
- Memory-substrate calls must preserve the same boundary:
  - events are replayable source records, not conclusions;
  - claims are extractor outputs with evidence and status, not automatic truth;
  - relationships add context, not domain ontology ownership;
  - retrieval bundles provide evidence and preserved policy metadata, not final decisions.

### L2 Service Orchestration

- `createRuntimeServices` composes provider ports and returns stable envelopes.
- It validates contract-level requirements before touching provider adapters.
- For memory substrate, Agent Service orchestration validates required event,
  claim, relation, and context-retrieval fields before touching `MemoryStore`,
  `ModelGateway`, or `VectorStore`.
- It must not perform authorization, tenant policy, read/write audit, or remote
  governance for the current `/rpc` surface.
- It must not infer a tenant, namespace, or table from local transport state.

### L3 Provider Ports

Provider ports are the replaceability boundary. They should describe what the
service needs, not how a local implementation happens to work.

Required ports:

- `ModelGateway`: language, embedding, and image generation calls.
- `ObjectStore`: read/write object bytes by caller-owned namespace and object
  key.
- `ManifestStore` / `RdsStore`: store and query artifact metadata and future
  operational metadata.
- `RecordStore` / `RdsStore`: store, retrieve, query, and delete JSON records
  by caller-provided namespace and table name.
- `MemoryStore`: append events, upsert/query claims, and upsert/query
  relationships by caller-provided namespace.
- `VectorStore`: upsert and search vectors by caller-provided table name.
- `ResourceProbe`: report adapter availability without implying permissions.

### L4 Local Provider Adapters

Local adapters are implementation choices:

- filesystem stores object bytes;
- SQLite stores manifest/RDS-style metadata, JSON record metadata, and memory
  event/claim/relation metadata only;
- LanceDB stores and searches vectors;
- encrypted local keystore stores operator secrets.

SQLite must not store object bodies or vector embeddings.

### L5 Remote Provider Adapters

Remote adapters should implement the same L3 ports:

- object bytes can move to S3/OSS;
- manifests can move to RDS;
- JSON record storage can move to RDS or a remote record service;
- memory event/claim/relation metadata can move to RDS, a graph-capable store,
  or a remote memory metadata service after the local P0 contract is stable;
- vector operations can move to a remote vector database or service;
- model calls can move across compatible provider endpoints.

The public capability contract should not expose whether a provider is local or
remote except through evidence/provider metadata.

### L6 Transports

`/rpc` is a local transport:

- JSON-RPC 2.0 over localhost;
- no service governance or authentication in P0;
- mirrors the library contract;
- returns standard Runtime Services envelopes.

`/mcp` is future governance-capable exposure:

- default deny;
- explicit allowlist from CapabilityRegistry;
- authentication, origin validation, scoped exposure, audit, and tenant policy
  belong here;
- it must adapt the same L1-L3 core rather than reimplement business behavior.

### L7 External Acceptance

Acceptance tests should behave like a consuming agent:

1. Start or connect to the public surface.
2. Discover capabilities.
3. Call model capabilities through the public surface.
4. Save and list artifacts with an explicit `namespace`.
5. Retrieve artifact bytes with explicit `namespace` plus `id`.
6. Upsert, get, query, and delete JSON records with explicit `namespace` plus
   `tableName`.
7. Append memory events, store claims, connect relationships, and retrieve
   context bundles with explicit `namespace`.
8. Upsert and search vectors with an explicit `tableName`.
9. Verify missing isolation keys fail through the public envelope.
10. Verify unrelated namespaces/tables do not leak data, including memory
    context retrieval over shared vector tables.
11. Check resource status without assuming local implementation details.

Module-level tests are useful for diagnosis, but they do not define release
readiness. Release readiness is proven by external capability flows.

## Implementation Sequence

### Phase 1: Freeze The Public Contract

- Keep the L1 memory-substrate PRD, product narrative, and method ids aligned.
- For future capability groups, freeze the L1 narrative before adding method ids
  or implementation code.
- Keep `CapabilityRegistry` as the single contract source.
- Add or update external acceptance tests for the stable public flows.
- Treat breaking changes to capability ids, required params, or envelope shape
  as contract changes.

For the memory-substrate contract, external flows should prove:

- events can be appended and replayed without mutation;
- claims can reference source evidence without being treated as truth;
- relationships can expand context without embedding business-specific
  ontology into public names;
- retrieval bundles return evidence, confidence, freshness, and preserved policy
  metadata without implying approval or action.

### Phase 2: Split Provider Ports From Local Adapters

- Extract explicit provider port interfaces.
- Route `createRuntimeServices` through provider ports instead of direct model,
  artifact, record, memory, and vector implementation calls.
- Keep local filesystem/SQLite and LanceDB adapters as default port
  implementations.
- Keep current behavior green through external acceptance tests.

### Phase 3: Add Remote Adapter Shapes

- Add HTTP/JSON remote adapter shapes for model, object, manifest/RDS-style
  metadata, record metadata, and vector providers.
- Implement remote adapters only behind L3 ports.
- Add provider configuration that can assemble local defaults or remote HTTP/JSON
  model, object, manifest, record, and vector providers without changing `/rpc`
  capability contracts.
- Keep remote memory provider assembly deferred unless a concrete memory
  metadata service is selected; L3 already has the `MemoryStore` replacement
  boundary for that later adapter.
- Make the CLI `serve`, `resources`, `doctor`, `storage`, and `models smoke`
  commands read runtime provider assembly from
  `<runtime-home>/runtime-providers.json`, with `--provider-config` as an
  explicit override, so the real `/rpc` process and operator checks use the same
  local/remote provider selection as the library entrypoint.
- Add provider readiness probes so configured remote providers are not reported
  available until their own `/resources/probe` endpoint succeeds.
- Add a conservative remote operation policy for HTTP/JSON adapters:
  timeouts, retry attempts, and retry backoff for transient transport failures,
  timeouts, `429`, and `5xx` responses only.
- Keep retry evidence in provider errors and resource probe evidence without
  leaking request headers, secrets, or request bodies.
- Keep remote vector operations behind `VectorStore`; do not add SQLite vector
  fallback.
- Keep local adapters as the development/default deployment.
- Defer real cloud model/S3/OSS/RDS/vector-service SDKs and credential
  configuration until a concrete remote provider is selected.

### Phase 4: MCP Governance Layer

- Build MCP as a governed adapter over CapabilityRegistry and provider ports.
- Add authentication, origin validation, allowlists, audit, and tenant policy.
- Do not back-port this governance into local `/rpc`.
