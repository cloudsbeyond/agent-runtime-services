# Memory Substrate PRD

This PRD defines the L1 product contract for the P0 memory-substrate Agent
Service in Agent Runtime Services.

## Product Objective

Agent Runtime Services should let domain agents and build agents persist,
retrieve, and replay infrastructure-grade memory inputs through an Agent Service
without turning the runtime service into a domain decision system.

The P0 Agent Service is a typed memory substrate:

```text
append-only event -> extracted claim -> relationship context -> evidence-backed retrieval bundle
```

Runtime Services owns the service contract for this chain. Runtime Core provides
the underlying memory storage, vector retrieval, model embedding, and artifact
reference primitives. Consuming agents own domain interpretation, user-facing
summaries, approvals, tool choices, and coordinated action.

## Why This Exists

Agents already need model calls, artifacts, JSON records, and vector search, but
those primitives do not explain why a fact should be trusted, whether it is
stale, or which source supports it. If every consuming agent builds its own
event log, evidence shape, claim schema, and retrieval expansion, the same
project ends up with incompatible memory stores and duplicated provider code.

The product reason to add memory-substrate capabilities here is to make memory a
shared Agent Service instead of an implicit feature hidden inside one domain
agent. This keeps provider, storage, retrieval, secret, and resource readiness
work in one project-neutral service plane while preserving the existing
authority boundary.

The user consequence is concrete:

- a consuming agent can replay source events when extraction logic changes;
- a claim can carry source evidence and confidence instead of being stored as
  unqualified truth;
- retrieval can bring back related context, not only nearest embedding chunks;
- policy metadata can travel with retrieved objects so governed callers can
  decide what may be used before a summary or action is produced;
- missing storage, model, or retrieval resources still surface through standard
  Runtime Services envelopes.

## Consumers

Primary consumers remain:

- domain agents that need reusable infrastructure for project, customer,
  product, or operations memory;
- build agents that need evidence-backed implementation context, review
  context, and replayable requirement history.

The service does not become an end-user organizational-memory app, task
coordinator, chat assistant, approval engine, or source-system connector.

## P0 Capability Scope

P0 introduces four memory capability groups at the public Agent Service
contract level.

## P0 Requirement Matrix

The original capability gap is implemented only as a reusable agent-facing
service on top of Runtime Core. The matrix below is the P0 contract; anything
that would turn the service into an
organizational-memory product, action router, or approval engine stays outside
P0.

| Requirement | Public capability surface | Why it is P0 | Local proof path |
| --- | --- | --- | --- |
| Replayable event log | `memory.event.append`, `memory.event.get`, `memory.event.list` | Extractors must be able to replay source inputs after prompt or parser changes. | L2 validates namespace, source, timestamp, and shape before `MemoryStore`; L4 stores append-ordered SQLite event metadata. |
| Claim store | `memory.claim.upsert`, `memory.claim.get`, `memory.claim.query` | Extracted statements must remain claims with evidence, confidence, status, and freshness instead of becoming unqualified truth. | L2 validates claim shape before provider ports; L4 stores claim metadata, status, freshness, evidence, and supersession links. |
| Provenance and evidence normalization | event source refs, claim evidence refs, relation evidence refs, content hashes | Consumers need stable source anchors and comparable evidence references across agents. | P0 requires `source.kind`, `source.ref`, evidence `kind/id`, and explicit top-level namespace; reference-level namespaces are rejected. |
| Relationship context graph | `memory.relation.upsert`, `memory.relation.query` | Vector similarity alone cannot express support, supersession, dependency, or source chains. | L2 validates generic typed references; L4 stores typed edges without a domain ontology. |
| Vector plus relationship retrieval | `memory.context.retrieve` plus `vector.search` | Consuming agents need a bundle of candidates, hydrated claims/events, relations, confidence, freshness, and policy metadata. | Retrieval constrains vector recall by namespace, post-filters provider candidates, hydrates memory objects, and returns a bundle rather than a decision. |
| Policy metadata preservation | `policy` fields on events and claims plus bundle policy objects | Local P0 does not authorize, but governed callers need policy metadata carried with retrieved objects. | L2 accepts JSON policy objects; L4 preserves them; retrieval returns policy objects without enforcing permissions. |

Freshness and supersession are P0 metadata because they affect whether a bundle
is safe to interpret. Immutable claim-transition history, status workflow APIs,
and fixed policy schemas are deferred until a later governed surface.

Action routing remains out of P0. Runtime Services can return evidence-backed
context, but it must not decide tasks, approvals, escalations, downstream tools,
or session changes.

### Event Log

Purpose: preserve raw or normalized source events in append order so later
extractors can replay them deterministically.

Contract intent:

- append events with `namespace`, stable event id, source kind, source ref,
  actor metadata, timestamps, payload or artifact reference, and content hash;
- reject malformed caller-provided event timestamps before persistence;
- list or get events by explicit isolation keys;
- never mutate prior event payloads in place.

Why P0: without replay, extractor mistakes become permanent storage mistakes.
Existing `record.upsert` is useful for operational metadata, but it is not an
append-only event contract.

### Claim Store

Purpose: store model- or extractor-produced statements as claims before any
consumer treats them as facts.

Contract intent:

- store claims with `kind`, `subject`, evidence refs, confidence, status,
  freshness, owner metadata, and timestamps;
- preserve the current claim status such as `unverified`, `active`,
  `superseded`, `rejected`, and `stale`;
- preserve evidence and supersession links without requiring an immutable status
  audit log in P0.

Why P0: LLM extraction is probabilistic. Runtime Services should make the safe
path the default: extract claim first, let consumers verify or promote later.

### Relationship Context

Purpose: connect events, claims, artifacts, records, vectors, and external source
refs through a generic relationship layer. Domain objects can be represented by
caller-provided references, but Runtime Services does not own a public domain
ontology.

Contract intent:

- upsert and query typed edges by explicit isolation keys;
- support neighbor expansion for retrieval;
- keep relationship labels generic and project-neutral.

Why P0: embedding similarity can find related text, but it does not naturally
know ownership, supersession, dependency, or source chains. A lightweight
relationship contract lets retrieval return context instead of isolated chunks.

### Context Retrieval Bundle

Purpose: return evidence-backed retrieval bundles that combine vector recall,
claim hydration, relationship expansion, freshness, and preserved policy
metadata.

Contract intent:

- accept a query or embedding plus explicit table and namespace inputs;
- retrieve candidate vectors, hydrate linked claims/events, preserve linked
  artifact refs, and expand bounded relationships;
- return a typed bundle with evidence refs, freshness/status, confidence, and
  caller-provided policy metadata;
- treat a retrieval `limit` of `0` as an empty bundle without provider recall or
  hydration;
- avoid producing final business decisions or user-facing narrative as the
  Runtime Services result.

Why P0: consuming agents need a dependable substrate for briefing and reasoning,
but final interpretation belongs above this service. Returning bundles rather
than decisions preserves the Runtime Services authority boundary.

## Policy Metadata

P0 preserves caller-provided policy metadata on memory objects even before full
remote authorization exists. Runtime Services does not define or enforce a
policy field schema in local P0, but the contract lets governed callers carry
metadata for distinctions such as:

- whether a memory object may be known to exist;
- whether raw source can be used;
- whether a summary can be used;
- whether a dissenting view or speaker identity can be exposed;
- whether the object may participate only in aggregate signals;
- whether it is usable as evidence for a downstream action.

Why P0: if policy metadata is bolted on after memory objects exist, consumers
will either over-share or avoid using the substrate. Runtime Services does not
decide authorization in local P0, but it must preserve the data needed for a
governed caller to decide.

## Non-Goals

P0 does not implement:

- source connectors for vendor-specific chat, wiki, issue tracker, CRM, email,
  calendar, or meeting systems;
- an end-user organizational-memory product UI or chatbot;
- automatic task execution, approvals, escalations, or action routing;
- tenant authorization, remote identity, or full audit enforcement;
- a graph database requirement;
- provider-specific ontology objects in public method names;
- reference-level namespaces; P0 memory references use the operation's top-level
  `namespace`;
- business-specific summaries, roadmap judgments, customer commitments, or
  release decisions.

## Formal Development Contract

The memory substrate follows the repository's layered delivery order:

1. Keep this L1 PRD and product narrative aligned with public method ids.
2. Use architecture and capability descriptors to express the public memory
   contract as `serviceLayer: "agent-service"`.
3. Prove event replay, claim evidence, relationship expansion, and retrieval
   bundle boundaries with external acceptance tests.
4. Keep the Agent Service orchestration responsible for explicit isolation and
   shape checks before touching Runtime Core ports.
5. Keep L3 ports only where the memory contract requires replaceable providers.
6. Keep L4 local adapters conservative: SQLite-style metadata for events,
   claims, and edges; LanceDB for vectors; artifact storage for payload bodies.
7. Defer MCP governance and source connectors until the local public contract is
   stable.

## P0 Acceptance Signals

The P0 memory substrate is accepted when an external consuming agent can:

- append source events and later replay them in append order;
- reject malformed event timestamps before provider or local persistence;
- store extracted claims without promoting them to truth;
- attach evidence refs from claims back to events, artifacts, or source ranges;
- supersede or reject a claim by preserving status, evidence, and supersession
  links without deleting referenced source events;
- connect claims and events through typed relationships;
- request a retrieval bundle that includes vector candidates, related claims,
  source evidence, confidence, freshness, and preserved policy metadata;
- request a zero-limit retrieval and receive an empty bundle without provider
  recall;
- discover all memory capabilities through `capabilities.describe`;
- receive `missing_resource` or `failed` envelopes when required models,
  stores, isolation keys, or provider resources are unavailable;
- verify that Runtime Services did not make a domain decision, approval, tool
  choice, or session mutation.

## Deferred Decisions

- Payload-size thresholds for when event payloads should move from inline JSON to
  artifact refs.
- Whether claim status transitions are separate methods or structured updates
  through one claim operation.
- Whether immutable claim version history and status-transition audit logs should
  become a later capability.
- Initial relationship edge vocabulary and whether it is schema-enforced or
  caller-defined with validation rules.
- Fixed policy metadata field schemas reserved for MCP governance.
