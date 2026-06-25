# Agent DevOps

Agent DevOps is the maintenance system for `agent-runtime-services`. It exists
to help agents change Product Development safely, repeatedly, and with evidence.

Product Development is the publishable product surface: `src/`, `bin/`,
`README.md`, `architecture/`, `examples/`, public contracts, tests, harnesses,
and package metadata. Agent DevOps can read and index Product Development.
Product runtime must not import, execute, or package Agent DevOps.

This directory is not a runtime dependency, not a package export, and not part
of the npm payload by default.

## Requirements-To-Code Chain

Use this requirements-to-code chain when an agent turns a requirement into
tracked product changes:

1. Confirm the Product Development target: public API, runtime object, CLI,
   docs, examples, tests, or package metadata.
2. Identify the contract owner: README, architecture document, CapabilityRegistry,
   RPC method, storage boundary, CLI behavior, or package manifest.
3. Write or update a focused test before changing product behavior.
4. Change the smallest Product Development surface that satisfies the contract.
5. Run the relevant target test, then the wider validation gate before claiming a
   ready state.
6. Record any reusable handoff or review evidence outside runtime state.

The chain preserves this boundary: agents may maintain the product, but Runtime
Services never turns into an agent decision system.

## Contract Index

Use this contract index to locate the authoritative Product Development and
Agent DevOps contracts:

| Contract | Source |
| --- | --- |
| Product entry, run path, capabilities, package boundary | `README.md` |
| Runtime objects, layer contracts, boundary design | `architecture/README.md` |
| Artifact, record, and vector storage isolation | `architecture/storage-retrieval-design.md` |
| Runtime capability selection and A2A decision packets | `agent-devops/agent-infra-selection-guide.md` |
| Layered implementation sequence | `agent-devops/layered-implementation-plan.md` |
| Capability ids, risk/effect classes, shape ids | `src/capabilities/registry.ts` |
| Library facade and capability envelopes | `src/runtime-services.ts` |
| Public package exports | `src/index.ts` |
| Local JSON-RPC transport | `src/rpc/` |
| Operator CLI behavior | `src/cli/` |
| Consumer examples and handoff guidance | `examples/` |
| Publication and contract gates | `test/` and `package.json` |

## Drift Check

Run a drift check whenever an agent changes a public contract, package surface,
runtime object, or architecture boundary:

```bash
git status --short --branch --ignored
rg -n "agent-devops|Agent DevOps" src bin package.json README.md architecture examples test
pnpm exec vitest run test/publication-identity.test.ts test/upstream-agent-sample-doc.test.ts test/cli-helpers.test.ts test/cli-rpc-smoke.test.ts
pnpm typecheck
pnpm build
npm pack --dry-run --ignore-scripts
git diff --check
git diff --cached --check
find . -maxdepth 1 -name 'agent-runtime-services-*.tgz' -print
```

Interpretation:

- Product source may mention `agent-devops/` only as a boundary pointer.
- `src/`, `bin/`, package exports, and runtime code must not import or execute
  Agent DevOps material.
- `package.json.files` should omit `agent-devops` unless a future publishing
  decision explicitly changes that boundary.

## Replay Evidence

Replay evidence is the minimum evidence packet another agent needs to re-enter a
change:

- objective and scope;
- current branch, HEAD, and dirty files;
- contract sources read before editing;
- test-first red result when behavior changed;
- implementation summary;
- verification commands and results;
- package dry-run result when package contents are affected;
- runtime smoke result when localhost service behavior is affected;
- remaining risks or deferred items.

Do not store secrets, raw private transcripts, runtime homes, generated media,
or provider credentials in replay evidence.

## SOP

1. Start from live git state, not memory alone.
2. Read `AGENTS.md` and the relevant Product Development contract documents.
3. Keep agent-maintenance notes in `agent-devops/` or ignored local context; do
   not mix them into runtime code.
4. Use tests as the contract for product behavior changes.
5. Keep docs concise: README for product entry, architecture for product design,
   this directory for agent maintenance.
6. Before completion, prove the current state with fresh command output.

## Governance

Agent DevOps is allowed to observe Product Development through files, tests,
package metadata, and runtime smoke checks. It is not allowed to become a
runtime dependency, a provider adapter, a CLI subcommand, an RPC method, an npm
payload item, or a source of domain-agent/build-agent decisions.

If a future change needs executable maintenance tooling, keep it behind this
directory until the product explicitly promotes it into a Product Development
contract with tests and package-boundary review.
