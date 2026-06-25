# Storage And Retrieval Design

This document records the P0 storage and retrieval direction for Runtime
Services. It covers Runtime Core storage primitives and the memory-substrate
Agent Service that composes them for agent-facing retrieval. It does not define
domain memory, execution-agent session state, or user approval policy.

## P0 Main Line

Runtime Core provides local-first storage and retrieval primitives with explicit
caller-owned isolation keys:

- artifacts are isolated by `namespace`;
- JSON records are isolated by `namespace` plus `tableName`;
- memory events, claims, and relations are isolated by `namespace`;
- vectors are isolated by `tableName`;
- SQLite is only a local manifest and operational metadata implementation;
- vector storage and retrieval use LanceDB tables, never SQLite;
- memory substrate composes memory metadata, vector recall, embedding, and
  artifact references as an Agent Service;
- audit, authorization, and multi-tenant governance stay above these local P0
  contracts.

## Direction 1: Artifact And Object Storage

Artifact operations cover generated files, downloaded model outputs, rendered
HTML, images, reports, and other durable delivery artifacts.

Public capabilities:

- `artifact.save`
- `artifact.get`
- `artifact.list`
- `artifact.cleanupExpired`

Required isolation:

- every artifact operation requires `namespace`;
- `artifact.get` also requires `id` and returns the manifest plus object bytes
  as `bodyBase64`;
- missing `namespace` returns a failed Runtime Services envelope;
- there is no `default` namespace fallback for user data.

P0 behavior:

- `artifact.save` accepts either explicit bytes/body plus MIME type or a
  caller-provided source URL download;
- optional `expiresAt` and cleanup `now` values must be valid date strings
  before provider ports or local manifests are touched;
- local manifests store normalized expiration metadata, not object bodies.
- local artifact adapters reject non-string `namespace` values before object or
  manifest writes.

Local implementation:

- bytes are written under `artifacts/<namespace>/<artifact-id>.<extension>`;
- SQLite stores the local manifest only;
- the manifest stores metadata such as `id`, `namespace`, path, MIME type,
  byte size, hash, timestamps, source URL presence, and source metadata;
- the manifest must not store artifact body bytes.

Migration direction:

- object bytes can move from local filesystem to S3, OSS, or another object
  store;
- manifest rows can move from local SQLite to RDS or another relational store;
- the public contract should remain `namespace` plus artifact metadata and
  explicit `id` for retrieval;
- future backends should keep object body storage separate from manifest
  metadata.

## Direction 2: Record Metadata Storage And Retrieval

Record operations cover JSON metadata and RDS-style rows that multiple agent
consumers can share without storing object bytes.

Public capabilities:

- `record.upsert`
- `record.get`
- `record.query`
- `record.delete`

Required isolation:

- every record operation requires `namespace` and `tableName`;
- `record.upsert`, `record.get`, and `record.delete` also require `id`;
- `record.upsert` requires `data` as a JSON object;
- there is no default namespace or default table fallback.

P0 behavior:

- `record.upsert` stores or replaces one JSON record by
  `(namespace, tableName, id)`;
- `record.get` and `record.delete` fail when the id is unknown in that
  namespace/table;
- `record.query` returns records only from the requested namespace/table,
  ordered by `createdAt` then `id`;
- `record.query` with `limit: 0` returns an empty `records` array;
- unknown tables return `ok` with an empty `records` array.
- local record adapters reject non-string `namespace`, `tableName`, and `id`
  values before SQLite metadata writes.

Local implementation:

- SQLite stores JSON record metadata in `db/records.sqlite`;
- the physical schema uses one `records` table with `namespace`, `table_name`,
  `id`, `data_json`, `metadata_json`, `created_at`, and `updated_at`;
- dynamic caller `tableName` values are stored as data, not interpolated as SQL
  table names;
- record storage must not store binary object bodies.

Migration direction:

- local SQLite record storage can move to RDS or a remote record service;
- public calls remain `namespace`, `tableName`, `id`, and JSON object payloads;
- SQL query languages, joins, transactions, full-text search, and secondary
  indexes are out of P0.

## Direction 3: Vector Storage And Retrieval

Vector operations cover embedding-backed retrieval for domain-agent and
build-agent support content.

Public capabilities:

- `vector.upsert`
- `vector.search`

Required isolation:

- every vector operation requires `tableName`;
- missing `tableName` returns a failed Runtime Services envelope;
- there is no shared `runtime_service_vectors` fallback table.

Local implementation:

- vector storage and similarity search use LanceDB;
- the caller-provided `tableName` selects the LanceDB table;
- record ids are scoped by table, so the same `id` can exist in different
  tables without collision;
- SQLite is not a vector backend, fallback, cache, or retrieval engine.

P0 retrieval behavior:

- `vector.upsert` stores `id`, `content`, `embedding`, metadata, and timestamps;
- existing rows with the same `id` in the same table are replaced;
- `vector.search` searches only the requested table;
- `vector.search` with `limit: 0` returns an empty result set without touching
  the vector provider;
- local vector adapters reject non-string `tableName` values before LanceDB
  table access;
- local vector adapters reject non-array or non-finite embeddings before
  LanceDB table writes or searches;
- `vector.search` may combine vector similarity with exact top-level
  `filter.metadata` constraints for string, number, and boolean metadata
  values;
- the local LanceDB implementation compiles structured metadata filters to
  pre-filtering `where(...)` predicates; unfiltered search stays on the plain
  vector-search path;
- unknown tables return an empty result set rather than searching elsewhere.

Deferred retrieval behavior:

- cross-table search;
- raw SQL filter DSLs, nested JSON filtering, null semantics, range predicates,
  and boolean expression DSLs;
- hybrid lexical/vector search;
- reranking;
- table-level authorization;
- table-level read/write audit.

## Direction 4: Memory Substrate Agent Service

Memory substrate operations cover replayable source events, extracted claims,
relationship context, and retrieval bundles. The `memory.*` public family is an
Agent Service built on Runtime Core ports: `MemoryStore`, `VectorStore`,
`ModelGateway` embedding, and optional `ArtifactStore` references. It does not
define domain memory, execution-agent session state, user approval policy, or
coordinated action.

Public capabilities:

- `memory.event.append`
- `memory.event.get`
- `memory.event.list`
- `memory.claim.upsert`
- `memory.claim.get`
- `memory.claim.query`
- `memory.relation.upsert`
- `memory.relation.query`
- `memory.context.retrieve`

Required isolation:

- every memory operation requires `namespace`;
- `memory.context.retrieve` also requires `tableName` for vector recall;
- memory references use the operation's top-level `namespace`; reference-level
  namespaces are rejected in P0;
- missing isolation keys return a failed Runtime Services envelope;
- there is no shared default memory namespace.

P0 behavior:

- events are append-only records with source, payload or artifact reference,
  content hash, timestamps, metadata, and preserved policy metadata;
- event source metadata requires `source.kind` and `source.ref` so replay keeps a
  stable source anchor;
- caller-provided event `occurredAt` values must be valid date strings before
  provider ports or local metadata are touched;
- claims are extractor outputs with evidence, confidence, status, freshness,
  owner metadata, and preserved policy metadata;
- claims preserve current status plus evidence and supersession links; immutable
  status-transition history is deferred;
- relations are typed edges between generic memory references and are used for
  bounded context expansion;
- context retrieval returns candidates, hydrated claims/events, relationships,
  and preserved policy metadata as a namespace-constrained bundle, not a final
  business decision;
- context retrieval with `limit: 0` returns an empty bundle without touching
  vector or memory providers.

Local implementation:

- SQLite stores event, claim, and relation metadata in `db/memory.sqlite`;
- vector recall still uses LanceDB through `vector.*` tables;
- artifact bodies or large source payloads should use `artifact.*` and be
  referenced from memory metadata.
- `memory.*` Agent Service orchestration lives in `src/services/` so the public
  service family is separated from Runtime Core store implementations.

Migration direction:

- event, claim, and relation metadata can move to an RDS-style or graph-capable
  remote provider later;
- the public contract should remain namespace-scoped and evidence-preserving;
- remote authorization, audit, and tenant policy belong above the local storage
  primitive.

## Direction 5: Resource And Capability Discovery

`CapabilityRegistry` remains the source of truth for public capability ids,
schemas, `serviceLayer` classification, effects, risks, consumers, and authority
boundaries.

Discovery requirements:

- all top-level request schemas are closed with `additionalProperties: false`;
- Runtime Core capabilities are classified as `serviceLayer: "runtime-core"`;
- memory-substrate capabilities are classified as
  `serviceLayer: "agent-service"`;
- `artifact.save`, `artifact.get`, `artifact.list`, and
  `artifact.cleanupExpired` schemas mark `namespace` as required;
- `artifact.get` marks `id` as required and returns bytes as `bodyBase64`;
- `record.upsert`, `record.get`, `record.query`, and `record.delete` schemas
  mark `namespace` and `tableName` as required;
- `record.upsert` marks `id` and `data` as required;
- `record.get` and `record.delete` mark `id` as required;
- memory event, claim, relation, and context schemas mark `namespace` as
  required;
- memory reference schemas expose `kind` and `id` only; reference-level
  namespaces and extra reference fields remain outside P0 discovery and runtime
  validation;
- memory names and reference `kind`/`id` values must be strings before provider
  ports or local metadata are touched;
- `memory.context.retrieve` marks `tableName` as required and returns a bundle
  rather than a decision or approval;
- `memory.context.retrieve` discovery keeps its request schema closed and
  exposes the same scalar `filter.metadata` value contract as `vector.search`;
- `vector.upsert` and `vector.search` schemas mark `tableName` as required;
- `vector.search` schema exposes structured `filter.metadata`, not a
  provider-specific SQL predicate string;
- `resources.status` reports storage availability without implying permission
  or tenancy checks;
- provider ids distinguish local implementation details, for example
  `local-fs+sqlite` for artifact manifest plus filesystem bytes and
  `local-sqlite-record` for JSON record metadata, and
  `local-lancedb` for vector storage.

The resource catalog should describe SQLite as artifact manifest or local
operational metadata only, not as a vector fallback.

## Direction 6: Transport Boundary

The TypeScript library and local `/rpc` surface expose the same storage
contracts.

P0 local behavior:

- `/rpc` is localhost-first and mirrors the library capabilities;
- failed isolation checks are returned in the standard envelope;
- the RPC client must pass caller parameters through rather than substituting
  `{}` or hidden defaults.

Deferred remote behavior:

- `/mcp` is a future adapter over the same internal core;
- MCP exposure is default deny and allowlisted;
- audit, authorization, tenant policy, and remote caller identity belong above
  the storage primitives.

Runtime Services should not infer tenant identity from transport state in P0.
Callers own `namespace` and `tableName`.

## Direction 7: Local Runtime Home Layout

Runtime home remains the local implementation boundary.

Expected local shape:

```text
<runtime-home>/
  artifacts/
    <namespace>/
      <artifact-id>.<extension>
  db/
    artifacts.sqlite
    records.sqlite
    memory.sqlite
  vector/
    <lancedb tables>
  model-providers.json
  secrets.enc
  .keystore.salt
```

The `db/` directory is for manifests and local operational metadata. It is not
for object bodies or vector embeddings.

## Non-Goals

P0 does not implement:

- read/write audit trails;
- tenant authorization;
- MCP remote tool exposure;
- helper-only content indexing APIs outside `vector.*`;
- helper-only model artifact persistence APIs outside `artifact.*`;
- cross-namespace artifact queries;
- SQL query language, joins, transactions, full-text search, or secondary
  indexes for records;
- domain-specific ontology enforcement for memory objects;
- automatic action routing or approval from memory retrieval;
- cross-table vector queries;
- SQLite vector storage;
- default user data buckets or default vector tables.

## Test And Evidence Requirements

Current contract tests should cover:

- artifact save/get/list/cleanup by explicit `namespace`;
- artifact get by explicit `namespace` plus `id`, returning `bodyBase64`;
- failed artifact operations when `namespace` is missing;
- failed artifact operations when optional date fields are malformed before
  provider ports or local manifests are touched;
- artifact manifest does not contain body bytes;
- record upsert/get/query/delete by explicit `namespace` plus `tableName`;
- failed record operations when required isolation keys, `id`, or JSON `data`
  are missing;
- record query unknown table returns an empty result set;
- memory events append/list by explicit `namespace` and replay in append order;
- memory claims preserve evidence and confidence without being promoted to
  truth;
- memory relations support bounded context expansion;
- malformed memory event, claim, relation, and context-retrieval inputs fail at
  L2 before provider ports are called;
- malformed memory event timestamps fail at L2 and in the local memory adapter;
- malformed optional memory claim freshness values fail at L2 and in the local
  memory adapter;
- malformed memory names and reference `kind`/`id` field types fail at L2 and in
  the local memory adapter;
- memory context retrieval constrains vector recall to the requested namespace
  and returns a bundle without implying domain decisions, approvals, tool
  choices, or session mutation;
- memory context retrieval with `limit: 0` returns an empty bundle without
  touching vector or memory providers;
- memory relations reject reference-level namespaces before provider ports are
  called;
- CapabilityRegistry memory reference schemas expose `kind` and `id` without a
  reference-level `namespace` or extra reference fields;
- vector upsert/search by explicit `tableName`;
- failed vector operations when `tableName` is missing;
- malformed vector upsert/search inputs fail at L2 before provider ports are
  called;
- failed direct local vector adapter operations when embeddings are not arrays
  of finite numbers;
- vector search with `limit: 0` returns an empty result set;
- `/rpc` parity for required isolation keys;
- CapabilityRegistry schemas marking isolation keys as required and top-level
  request params as closed;
- absence of SQLite vector fallback identifiers in code and docs.

Publishing checks should continue to verify:

- `pnpm typecheck`;
- `pnpm test`;
- `pnpm build`;
- `npm pack --dry-run` after build completion.
