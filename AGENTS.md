# Agent Operating Contract

```text
mission: project-neutral runtime service plane for domain agents and build agents
core: Runtime Core + Agent Services + capability registry + storage plane + resource catalog + secrets + local RPC
runtime_home: ~/.agent-runtime-services by default
authority_boundary: runtime services provide typed capabilities, never domain-agent or build-agent decisions
```

## Invariants

- This package is an independent runtime service plane, not a submodule of any
  single domain-agent or build-agent project. It contains Runtime Core
  primitives and Agent Services composition, but never downstream agent
  decisions.
- Keep public API and internal names project-neutral. Do not introduce
  `Bridge*`, channel-specific, product-specific, or execution-agent-specific
  names into this repo.
- Domain agents and build agents consume this package through
  `createRuntimeServices(config)` or localhost JSON-RPC. They should not
  duplicate provider clients, model catalogs, artifact stores, memory stores,
  vector indexes, or generic secret resolution.
- Secrets are configurable per runtime home. Never assume a key can be shared
  across projects, users, domain agents, or build agents.
- Runtime Core covers model catalogs, capability envelopes, storage plane
  implementations, resource discovery, provider config, and secrets. Keep
  provider/model/storage implementations here, not in consuming agent repos.
- Agent Services are composed, agent-facing services built on Runtime Core
  ports. Keep reusable service orchestration here when it is project-neutral and
  does not own domain judgment, approvals, tool choices, sessions, or action
  coordination.
- Model calls return typed proposals, embeddings, image artifacts, or evaluation
  results. They must not return or imply execution-agent decisions, approvals,
  tool choices, cwd/session/profile changes, or policy overrides.
- Provider-specific code belongs in `src/models/` provider runtime/client code.
  Runtime service envelopes and RPC contracts should stay provider-neutral.
- Storage state is runtime-service support state. Artifact, record, memory, and
  vector stores are not execution-agent session memory.
- Missing resources must surface as `missing_resource` or stubbed
  `ResourceRequirement` entries. Do not fake rich capabilities when config,
  secrets, storage, or provider access is absent.
- Runtime service outputs must preserve the common envelope:
  `status`, `capabilityId`, `providerId`, `modelId`, and `evidence`.

## Architecture

Read [architecture/README.md](./architecture/README.md) before changing public
API shape, provider config, secret resolution, artifact/record/memory/vector
storage, resource catalog semantics, or JSON-RPC methods.

The main domains are:

- `src/models/`: provider catalog, module selection, runtime key resolution,
  and provider API clients.
- `src/resources/`: capability/resource requirements and availability overlays.
- `src/services/`: Agent Services orchestration over Runtime Core ports.
- `src/storage/`: artifact storage, JSON record storage, memory store, and
  vector indexes.
- `src/rpc/`: localhost JSON-RPC server/client and capability method dispatch.
- `src/config/`: runtime paths, secret refs, encrypted keystore, and generic
  secret resolver.

## Commands

Setup: `pnpm install`
Validate: `pnpm test`, `pnpm typecheck`, `pnpm build`, `npm pack --dry-run`
Run service: `agent-runtime-services serve --host 127.0.0.1 --port 8765`
Install models: `agent-runtime-services models install-volcengine-agent-plan`
Store key: `agent-runtime-services secrets set --id ARK_API_KEY`
Inspect resources: `agent-runtime-services resources`
Smoke models: `agent-runtime-services models smoke --module language|embedding|vision|all`

## Human Handoff

Stop before creating or changing real API keys, publishing to npm, creating a
remote repository, changing repository visibility, exposing the RPC service
beyond localhost, or deleting runtime state outside a requested cleanup command.

## Runtime Data

Never commit runtime state: `~/.agent-runtime-services/`, real
`model-providers.json`, `secrets.enc`, `.keystore.salt`, artifact files,
sqlite manifests, LanceDB tables, vector indexes, or generated media.

Use repo files as shape/reference only. Operator config and credentials belong
to the local runtime home.

## Review Lens

Reject changes that mix domain-agent or build-agent decision logic into Runtime
Services, expose plaintext secrets, share credentials across projects by
default, encode a single consuming project in public names, or bypass typed
capability envelopes.
