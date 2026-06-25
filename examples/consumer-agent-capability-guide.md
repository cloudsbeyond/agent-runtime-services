# Consumer Agent Capability Guide

This guide is for domain agents and build agents that consume Agent Runtime
Services through the current local `/rpc` surface. The minimum model is:

1. Build full capability knowledge during consumer initialization.
2. Sense capability changes online through lightweight revision checks.
3. Refresh the full capability index only when the revision changes or the
   consumer detects a call-shape mismatch.

Consumer agents do not need to read this repository or GitHub updates at
runtime.

## A2A Read Block

```yaml
schema: agent-runtime-services.consumer-capability.v1
source: examples/consumer-agent-capability-guide.md
transport: local /rpc JSON-RPC over localhost
minimum_model:
  initialization: call capabilities.describe and cache full descriptors
  online_delta_sensing: compare capabilityRevision from version or capabilities.list
  refresh_trigger: capabilityRevision changed, unknown method, required-field failure, or parse mismatch
  readiness_check: call resources.status or resources.smoke
stable_keys:
  - packageVersion
  - capabilitySchemaVersion
  - capabilityRevision
  - descriptors
do_not:
  - read GitHub to discover runtime capability changes
  - infer approval, policy, or domain intent from Runtime Services output
  - guess parameters after a descriptor change
  - expose local /rpc beyond localhost
```

## Initialization: Full Knowledge

At consumer startup, build a full local capability index from `/rpc`.

```ts
const endpoint = 'http://127.0.0.1:8765/rpc';

const health = await rpc(endpoint, 'health', {});
const version = await rpc(endpoint, 'version', {});
const describe = await rpc(endpoint, 'capabilities.describe', {});
const status = await rpc(endpoint, 'resources.status', {});

const capabilityCache = {
  endpoint,
  packageVersion: version.version ?? describe.packageVersion,
  capabilitySchemaVersion: version.capabilitySchemaVersion ?? describe.schemaVersion,
  capabilityRevision: version.capabilityRevision ?? describe.capabilityRevision,
  descriptors: describe.capabilities,
  resources: status.resources,
};
```

`capabilities.describe` is the source for consumer call planning. It tells the
agent:

- method ids;
- intended consumers;
- service layer (`runtime-core` or `agent-service`);
- required request fields;
- request and result shape ids;
- risk and effect classes;
- transport hints;
- authority boundaries.

The consumer should build local planning tables from descriptors instead of
hardcoding current README text or current implementation details.

## Online Delta Sensing

After initialization, do not re-read full descriptors on every call. Use
`capabilityRevision` as the online change signal.

```ts
const current = await rpc(endpoint, 'version', {});

if (current.capabilityRevision !== capabilityCache.capabilityRevision) {
  const next = await rpc(endpoint, 'capabilities.describe', {});
  capabilityCache.capabilityRevision = next.capabilityRevision;
  capabilityCache.capabilitySchemaVersion = next.schemaVersion;
  capabilityCache.packageVersion = next.packageVersion;
  capabilityCache.descriptors = next.capabilities;
}
```

Refresh the full descriptor set when:

- the consumer process starts;
- a new task starts after a long idle period;
- `version.capabilityRevision` differs from the cached value;
- `capabilities.list.capabilityRevision` differs from the cached value;
- a call returns unknown method;
- a call fails because required fields no longer match the cached descriptor;
- the consumer cannot parse a result shape it previously understood.

This is delta sensing, not delta patching. Runtime Services only needs to tell
the consumer that the public capability contract changed; the consumer then
pulls the new full descriptor set and rebuilds its local index.

## Capability Revision Semantics

`capabilityRevision` is a stable digest of the public capability descriptors.
It changes when the capability contract changes, including:

- added or removed method ids;
- request shape changes;
- result shape changes;
- required field changes;
- service layer changes;
- risk or effect class changes;
- intended consumer changes;
- transport hint changes;
- authority boundary changes.

It does not represent runtime readiness. Provider keys, secrets, runtime home,
storage state, and remote adapter availability can change while
`capabilityRevision` stays the same.

Use readiness methods for runtime state:

- `resources.status` for low-cost current status;
- `resources.doctor` for an operator-readable readiness report;
- `resources.smoke` when the consumer needs proof that a provider-backed module
  can produce output.

## Call Planning Rules

Before calling a capability, the consumer should check the cached descriptor:

1. The capability id exists.
2. The agent type is listed in `consumers`.
3. All required request fields can be supplied.
4. The `serviceLayer` fits the caller's planning path: Runtime Core for base
   model/storage/resource calls, Agent Services for composed agent-facing
   contracts.
5. The risk and effect class fit the caller's current authority.
6. The response shape is understood by the caller.
7. Runtime readiness is acceptable for the current task.

Runtime Services reports Runtime Core and Agent Services facts. It does not
approve domain decisions, tool choices, releases, publication, user-facing
actions, or policy overrides.

For vector retrieval, prefer the simplest call that satisfies the task:

- use `vector.search` without `filter` for pure similarity search;
- add `filter.metadata` only when a scalar label is part of the result
  contract, for example `{ metadata: { source: 'docs', project: 'alpha' } }`;
- do not send raw SQL, nested JSON filters, range predicates, or provider
  query DSLs through `/rpc`.

## Result Handling

Capability results use the shared envelope:

```ts
type RuntimeServiceStatus = 'ok' | 'missing_resource' | 'failed';

interface RuntimeServiceEnvelope {
  status: RuntimeServiceStatus;
  capabilityId: string;
  providerId: string;
  modelId: string;
  evidence: Array<{ kind: string; message?: string }>;
}
```

Consumer behavior:

- `ok`: use the typed result and preserve relevant evidence.
- `missing_resource`: ask the operator or caller to configure the missing
  provider, storage, secret, or runtime home; do not fake success.
- `failed`: surface evidence and choose a caller-owned fallback.

## Capability Cache Record

Use this compact record when handing current Runtime Services capability state
to another agent:

```yaml
schema: agent-runtime-services.consumer-capability-cache.v1
transport:
  kind: local-rpc
  endpoint: http://127.0.0.1:8765/rpc
discovery:
  health: "<ok|failed|not_checked>"
  packageVersion: "<package version>"
  capabilitySchemaVersion: "<number>"
  capabilityRevision: "<revision>"
  refreshReason: "<startup|task_start|revision_changed|call_shape_error|unknown_method>"
capabilities:
  count: 0
  ids:
    - "<capability id>"
resources:
  statusChecked: true
  missing:
    - "<resource id and evidence>"
```

The receiving agent should call `version` first. If `capabilityRevision` still
matches, it can reuse the cached descriptors. If not, it must call
`capabilities.describe`.

## Consumer Non-Goals

Consumer agents must not:

- call provider-specific endpoints directly when a Runtime Services capability
  exists;
- duplicate model catalogs, provider clients, artifact stores, record stores,
  vector indexes, or generic secret resolution;
- depend on SQLite, LanceDB, filesystem, or remote provider implementation
  details;
- treat Runtime Services output as approval, policy, or domain intent;
- expose local `/rpc` as a remote service;
- silently fall back from future `/mcp` calls to local `/rpc`;
- store credentials, secret headers, or private provider config in artifacts or
  records.

This packaged consumer guide is self-contained. Repository-maintenance
selection rules live outside the npm payload and are not required by consuming
agents.
