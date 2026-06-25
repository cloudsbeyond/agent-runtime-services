# Runtime Capability Selection Guide

This guide is for domain agents, build agents, and review agents that need to
choose Runtime Services capabilities without leaking domain logic into this
package. It complements the public capability contract in
`architecture/README.md` and the storage rules in
`architecture/storage-retrieval-design.md`.

Runtime Services selection is capability-first, not database-first. Choose
Runtime Core for base model/storage/resource calls and Agent Services for
composed agent-facing contracts, then let provider ports and runtime provider
configuration choose the local or remote implementation.

## A2A Read Block

Copy or quote this block in agent-to-agent handoffs when another agent needs to
continue a Runtime Services capability selection decision.

```yaml
schema: agent-runtime-services.capability-selection.v1
source: agent-devops/agent-infra-selection-guide.md
package_boundary: project-neutral runtime service plane
primary_rule: choose a public capability by service layer and resource semantics, not by provider or database name
public_surface:
  local_library: createRuntimeServices(config)
  local_rpc: /rpc over localhost JSON-RPC
  future_remote: /mcp adapter over CapabilityRegistry, default-deny and allowlisted
capability_families:
  runtime_core: base model, storage, vector, resources, config, and secret-backed capabilities
  agent_services: composed agent-facing contracts built on Runtime Core
  language_complete: use for text proposals; not execution decisions
  embedding_create: use to vectorize text or inputs; not retrieval by itself
  vision_generate_image: use for image generation outputs
  artifact: use for durable bytes, files, generated media, reports, and manifests
  record: use for small document-shaped JSON metadata records
  memory: use for replayable events, evidence-backed claims, relations, and retrieval bundles
  vector: use for embedding records and similarity search
  resources: use for availability, doctor, smoke, and status checks
  secrets_config: use runtime config and keystore; never store secrets in record or artifact
required_keys:
  artifact: namespace
  record: namespace, tableName, id for get/upsert/delete; namespace and tableName for query
  memory: namespace
  vector: tableName
upsert_semantics:
  record.upsert: create-or-replace one JSON record by namespace/tableName/id
  vector.upsert: create-or-replace one vector row by tableName/id
non_goals:
  - domain database
  - execution-agent memory
  - user approval or risk policy
  - SQL or document database query engine
  - provider-specific public API
handoff_fields:
  - decision_subject
  - chosen_capability
  - rejected_capabilities
  - caller_owned_keys
  - data_shape
  - expected_lifetime
  - provider_assumption
  - validation_command
```

## Selection Procedure

1. Name the resource, not the implementation.
   State whether the agent needs text generation, embedding, object bytes,
   JSON metadata records, vector retrieval, resource readiness, or secrets.

2. Check whether an existing public capability already matches.
   Prefer `CapabilityRegistry`, `RuntimeServices`, and `/rpc` method ids over a
   new source module, helper, or provider-specific method.

3. Choose the smallest capability that preserves the resource boundary.
   Do not pick a storage primitive only because the local provider happens to
   be SQLite, LanceDB, or filesystem.

4. Require caller-owned isolation keys before writing user data.
   Runtime Services must not infer tenant, namespace, table, or user identity
   from the transport or current process.

5. Keep domain meaning above Runtime Services.
   The caller owns business state, approval, release judgment, session policy,
   validation strategy, and object lifecycle beyond the Runtime Services
   capability.

6. Treat provider selection as a port decision.
   Local providers are defaults. Remote providers must implement the same port
   contract and must not change the public capability shape.

## Capability Selection Matrix

| Agent need | Use | Do not use |
| --- | --- | --- |
| Produce text proposal or analysis | `language.complete` | Do not return execution decisions, approvals, or tool choices. |
| Create embeddings | `embedding.create` | Do not store embeddings here; store/search them through `vector.*`. |
| Generate image output | `vision.generateImage` | Do not treat generated image output as approval or publication. |
| Store bytes, files, generated media, HTML, reports, or downloaded model output | `artifact.save/get/list/cleanupExpired` | Do not put object bodies into `record.*` or SQLite metadata rows. |
| Store small structured runtime metadata, config snapshots, run state, object references, or intermediate summaries | `record.upsert/get/query/delete` | Do not treat it as SQL, DocumentDB, service-layer business storage, or secret storage. |
| Preserve source-backed memory context | `memory.event.*`, `memory.claim.*`, `memory.relation.*`, `memory.context.retrieve` | Do not treat stored claims or retrieved bundles as truth, approval, policy, or action. |
| Store and search embedding-backed content | `vector.upsert/search` | Do not use SQLite, `record.query`, or artifact manifests for vector retrieval. |
| Check whether capabilities can run | `resources.list/doctor/smoke/status` | Do not fake rich availability when providers, config, storage, or secrets are missing. |
| Store API keys or operator secrets | runtime config and encrypted keystore | Do not store secrets in records, artifacts, examples, docs, or provider evidence. |

## Storage Choice Rules

### Artifact

Choose `artifact.*` when the primary value is a durable object body or generated
delivery artifact. Examples include rendered reports, generated images,
downloaded model output, exported HTML, and files that need byte retrieval.

`artifact.save` is intentionally not named `artifact.upsert`. Artifact storage
has object bytes, manifest metadata, MIME type, hashes, timestamps, source
metadata, and optional expiration. Replacing it with a generic upsert would hide
the object/manifest split.

### Record

Choose `record.*` when the primary value is a small JSON metadata record that
other agents may need to read by stable isolation keys. It is useful for
document-shaped runtime records such as:

- non-secret derived config snapshots;
- run metadata;
- intermediate processing state;
- artifact ids and vector table references;
- small structured objects that do not require business queries.

`record` is document-shaped, but it is not a document database. P0 `record.query`
lists records in one `namespace` and `tableName` with a limit. It does not mean
JSON path search, secondary indexes, joins, aggregation, patch updates, schema
migrations, or domain lifecycle rules.

### Memory Agent Service

Choose `memory.*` when the caller needs replayable source events, evidence-backed
claims, generic relations, or a context bundle that combines vector recall with
memory metadata. The memory substrate is an Agent Service over Runtime Core
storage, vector, and model ports; it preserves source-backed context without
deciding truth, approval, policy, tool choice, or action.

Use `memory.context.retrieve` when the caller needs hydrated claims, events,
relations, candidate vectors, and policy metadata in one namespace-scoped
bundle. Do not use it as a replacement for a domain memory product, user-facing
summary, authorization engine, task coordinator, or connector to source systems.

### Vector

Choose `vector.*` when the primary value is an embedding-backed retrieval row.
`vector.upsert` stores content, embedding, metadata, and timestamps under a
caller-provided `tableName`. `vector.search` searches one table and returns
similarity results. Use `filter.metadata` when retrieval needs a high-frequency
scalar prefilter, such as source, project, kind, tenant, or language labels.
The filter is structured data, not a raw provider SQL DSL; P0 supports only
top-level string, number, and boolean equality.

Use `embedding.create` before `vector.upsert` when the caller has text but not
an embedding. Do not route semantic retrieval through `record.query`.

## Provider Selection Rules

Provider choice belongs behind ports:

- `ModelGateway` for language, embedding, and image generation.
- `ObjectStore` and manifest store for artifacts.
- `RecordStore` for JSON metadata records.
- `MemoryStore` for memory event, claim, and relation metadata.
- `VectorStore` for vector rows and similarity search.
- `ResourceProbe` for readiness evidence.

Start with local defaults unless a concrete remote provider is configured:

- filesystem plus SQLite for artifact objects and manifests;
- SQLite for JSON record metadata;
- LanceDB for vector storage and retrieval;
- encrypted local keystore for operator secrets.

Add or change a provider only when all of these are true:

- the public capability id and request/result shape stay stable;
- the provider implements an existing port or justifies a new port;
- missing resources surface as `missing_resource` or `failed` envelopes;
- provider evidence does not leak secrets, headers, object bodies, or private
  request payloads;
- local `/rpc` behavior and external acceptance flows remain green.

Do not add provider-specific public method names such as
`sqlite.record.query`, `lancedb.search`, `s3.put`, or `documentdb.find` to the
Runtime Services capability surface.

## When To Add A New Capability

Add a new public capability only when the need is project-neutral, belongs in
Runtime Core or Agent Services, and cannot be represented by the existing
capability families.

Before adding one, answer:

- What resource family does it represent?
- What caller-owned isolation key is required?
- Which layer owns validation and policy?
- Which provider port will make the implementation replaceable?
- Which consumer type needs it: domain-agent, build-agent, or both?
- Which acceptance flow proves it without relying on implementation modules?
- Why can this not stay in the consuming agent or service layer?

Reject the new capability if it mainly represents domain state, business
workflow, presentation behavior, execution-agent policy, approval, tool choice,
session mutation, or one consuming project's ontology.

## A2A Decision Packet

Use this compact packet when handing a Runtime Services capability decision to
another agent:

```yaml
schema: agent-runtime-services.capability-decision.v1
decision_subject: "<what the agent needs to persist, retrieve, call, or check>"
chosen_capability: "<language.complete|embedding.create|vision.generateImage|artifact.*|record.*|memory.*|vector.*|resources.*|config/secrets>"
rejected_capabilities:
  - capability: "<candidate>"
    reason: "<why it does not match the resource semantics>"
caller_owned_keys:
  namespace: "<required for artifacts and records when applicable>"
  tableName: "<required for records and vectors when applicable>"
  id: "<required for single-record or vector-row writes when applicable>"
data_shape: "<bytes|json-object|memory-context|embedding-row|provider-call|resource-status|secret-ref>"
expected_lifetime: "<ephemeral|runtime-home durable|operator config|external provider state>"
provider_assumption: "<local default|remote-http-json|custom port>"
validation_command: "<pnpm test|specific vitest file|manual rpc call>"
```

The receiving agent should verify the current `CapabilityRegistry` and
architecture docs before changing public names, schemas, provider config,
transport behavior, or storage semantics.

## Review Checklist

Before accepting a Runtime Services capability selection change, verify:

- the chosen capability matches the resource semantics;
- no domain-agent, build-agent, or execution-agent decision logic moved into
  Runtime Services;
- user data writes require explicit isolation keys;
- binary or large object bodies stay in `artifact.*`;
- JSON metadata records stay small and list-only in P0;
- vector storage and retrieval stay behind `vector.*` and do not use SQLite;
- secrets remain in runtime config or keystore;
- provider-specific details remain behind ports and provider config;
- `/rpc` and library behavior stay aligned;
- tests cover contract shape, missing-resource behavior, and external
  acceptance where the public surface changes.
