import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');

function gitFiles(args: string[]): string[] {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
}

describe('publication identity', () => {
  test('package identity is Agent Runtime Services while retaining upstream attribution', async () => {
    const license = await readFile(join(repoRoot, 'LICENSE'), 'utf8');
    const notice = await readFile(join(repoRoot, 'NOTICE'), 'utf8');
    const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
      bugs?: { url?: string };
      name?: string;
      description?: string;
      files?: string[];
      homepage?: string;
      keywords?: string[];
      repository?: { type?: string; url?: string };
    };

    expect(pkg.name).toBe('agent-runtime-services');
    expect(pkg.description).toContain('runtime service plane');
    expect(pkg.description).toContain('build agents');
    expect(pkg.description).toContain('memory substrate');
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/cloudsbeyond/agent-runtime-services.git',
    });
    expect(pkg.bugs?.url).toBe('https://github.com/cloudsbeyond/agent-runtime-services/issues');
    expect(pkg.homepage).toBe('https://github.com/cloudsbeyond/agent-runtime-services#readme');
    expect(pkg.keywords).toEqual(expect.arrayContaining([
      'agent-runtime',
      'local-first',
      'json-rpc',
      'typescript',
      'artifact-store',
      'memory-substrate',
      'vector-search',
    ]));
    expect(license).toContain('Agent Runtime Services contributors');
    expect(license).toContain('Agent-Interaction-Bridge contributors');
    expect(license).toContain('Lark Channel Bridge contributors');
    expect(notice.split(/\r?\n/, 1)[0]).toBe('Agent Runtime Services');
    expect(notice).toContain('Agent-Interaction-Bridge');
    expect(notice).toContain('Lark Channel Bridge');
    expect(pkg.files).toContain('examples');
    expect(pkg.files).toContain('README.zh-CN.md');
    expect(pkg.files ?? []).not.toContain('AGENTS.md');
  });

  test('CLI source help presents both intended agent consumers', async () => {
    const cli = await readFile(join(repoRoot, 'src', 'cli', 'index.ts'), 'utf8');

    expect(cli).toContain('domain agents and build agents');
  });

  test('published package includes an agent-facing RPC client sample', async () => {
    const [sample, readme, guide] = await Promise.all([
      readFile(join(repoRoot, 'examples', 'client-sample.ts'), 'utf8'),
      readFile(join(repoRoot, 'README.md'), 'utf8'),
      readFile(join(repoRoot, 'examples', 'consumer-agent-capability-guide.md'), 'utf8'),
    ]);

    expect(sample).toContain('createRuntimeServicesRpcClient');
    expect(sample).toContain('capabilities.describe');
    expect(sample).toContain('resources.list');
    expect(sample).toContain('resources.doctor');
    expect(sample).toContain('resources.smoke');
    expect(sample).toContain('resources.status');
    expect(sample).toContain('http://127.0.0.1:8765/rpc');
    expect(readme).toContain('createRuntimeServicesRpcClient');
    expect(readme).toContain('createRuntimeServicesRpcRuntime');
    expect(readme).toContain('resources.list/doctor/smoke/status');
    expect(readme).toContain('examples/consumer-agent-capability-guide.md');
    expect(guide).toContain('schema: agent-runtime-services.consumer-capability.v1');
    expect(guide).toContain('capabilities.describe');
    expect(guide).toContain('resources.status');
    expect(guide).toContain('missing_resource');
    expect(guide).toContain('Initialization: Full Knowledge');
    expect(guide).toContain('Online Delta Sensing');
    expect(guide).toContain('capabilityRevision');
    expect(guide).toContain('This is delta sensing, not delta patching');
    expect(guide).toContain('schema: agent-runtime-services.consumer-capability-cache.v1');
    expect(guide).not.toContain('consumer-capability-judgment.v1');
    expect(guide).not.toContain('Oncall Agent Use');
    expect(guide).not.toContain('Pre-Sales Agent Use');
    expect(guide).not.toContain('agent-devops/');
  });

  test('public narrative separates Runtime Core from Agent Services', async () => {
    const [pkgRaw, readme, architecture, plan] = await Promise.all([
      readFile(join(repoRoot, 'package.json'), 'utf8'),
      readFile(join(repoRoot, 'README.md'), 'utf8'),
      readFile(join(repoRoot, 'architecture', 'README.md'), 'utf8'),
      readFile(join(repoRoot, 'agent-devops', 'layered-implementation-plan.md'), 'utf8'),
    ]);
    const pkg = JSON.parse(pkgRaw) as { description?: string; keywords?: string[] };

    expect(pkg.description).toContain('memory substrate');
    expect(pkg.description).toContain('Runtime Core');
    expect(pkg.description).toContain('Agent Services');
    expect(pkg.keywords).toEqual(expect.arrayContaining(['memory-substrate']));
    expect(readme).toContain('Runtime Core');
    expect(readme).toContain('Agent Services');
    expect(readme).toContain('The memory substrate is the first Agent Service');
    expect(readme).toContain('Its underlying `MemoryStore` belongs to Runtime Core');
    expect(readme).toContain('serviceLayer');
    expect(readme).toContain('append-only event -> extracted claim -> relationship context -> evidence-backed retrieval bundle');
    expect(architecture).toContain('Runtime Core');
    expect(architecture).toContain('Agent Services');
    expect(architecture).toContain('service composition layer');
    expect(architecture).toContain('`services/` modules: Agent Services orchestration over Runtime Core ports.');
    expect(plan).toContain('memory substrate Agent Service event, claim, relation, and retrieval context');
  });

  test('memory Agent Service orchestration lives outside the runtime facade', async () => {
    const [runtimeServicesSource, memoryServiceSource, storageDesign] = await Promise.all([
      readFile(join(repoRoot, 'src', 'runtime-services.ts'), 'utf8'),
      readFile(join(repoRoot, 'src', 'services', 'memory.ts'), 'utf8'),
      readFile(join(repoRoot, 'architecture', 'storage-retrieval-design.md'), 'utf8'),
    ]);

    expect(runtimeServicesSource).toContain('createMemoryService');
    expect(runtimeServicesSource).toContain('memory: memoryService');
    expect(runtimeServicesSource).not.toContain('assertMemoryClaimUpsertInput');
    expect(memoryServiceSource).toContain('createMemoryContextService');
    expect(memoryServiceSource).toContain('memory.event.append');
    expect(memoryServiceSource).toContain('memory.claim.upsert');
    expect(memoryServiceSource).toContain('memory.relation.upsert');
    expect(storageDesign).toContain('`memory.*` Agent Service orchestration lives in `src/services/`');
  });

  test('published Chinese README mirrors the public product narrative', async () => {
    const [pkgRaw, readme, chineseReadme] = await Promise.all([
      readFile(join(repoRoot, 'package.json'), 'utf8'),
      readFile(join(repoRoot, 'README.md'), 'utf8'),
      readFile(join(repoRoot, 'README.zh-CN.md'), 'utf8'),
    ]);
    const pkg = JSON.parse(pkgRaw) as { files?: string[] };

    expect(pkg.files).toContain('README.zh-CN.md');
    expect(readme).toContain('[简体中文](README.zh-CN.md)');
    expect(chineseReadme).toContain('[English](README.md)');
    expect(chineseReadme).toContain('项目中立的运行时服务平面');
    expect(chineseReadme).toContain('Runtime Core');
    expect(chineseReadme).toContain('Agent Services');
    expect(chineseReadme).toContain('记忆基底是这层表面里的第一个 Agent Service');
    expect(chineseReadme).toContain('`MemoryStore` 属于 Runtime Core');
    expect(chineseReadme).toContain('append-only event -> extracted claim -> relationship context -> evidence-backed retrieval bundle');
    expect(chineseReadme).toContain('examples/consumer-agent-capability-guide.md');
    expect(chineseReadme).toContain('runtime-providers.json');
    expect(chineseReadme).not.toContain('agent-devops/');
    expect(chineseReadme).not.toContain('Agent DevOps');
  });

  test('memory substrate PRD captures the ranked P0 gaps without adding action routing', async () => {
    const prd = await readFile(join(repoRoot, 'architecture', 'memory-substrate-prd.md'), 'utf8');

    expect(prd).toContain('## P0 Requirement Matrix');
    for (const requirement of [
      'Replayable event log',
      'Claim store',
      'Provenance and evidence normalization',
      'Relationship context graph',
      'Vector plus relationship retrieval',
      'Policy metadata preservation',
    ]) {
      expect(prd).toContain(requirement);
    }
    expect(prd).toContain('Action routing remains out of P0');
    expect(prd).not.toContain('Action router is P0');
  });

  test('repo separates product development from agent devops maintenance docs', async () => {
    const [pkgRaw, readme, architecture, agentDevops] = await Promise.all([
      readFile(join(repoRoot, 'package.json'), 'utf8'),
      readFile(join(repoRoot, 'README.md'), 'utf8'),
      readFile(join(repoRoot, 'architecture', 'README.md'), 'utf8'),
      readFile(join(repoRoot, 'agent-devops', 'README.md'), 'utf8'),
    ]);
    const pkg = JSON.parse(pkgRaw) as { files?: string[] };

    expect(readme).toContain('## Product Development Boundary');
    expect(readme).toContain('product-facing entrypoint');
    expect(readme).toContain('repository-maintenance');
    expect(readme).toContain('not part of the runtime service or package payload');
    expect(readme).not.toContain('agent-devops/');
    expect(readme).not.toContain('Agent DevOps');
    expect(architecture).toContain('## Runtime Objects');
    expect(architecture).toContain('## Layer Contracts');
    expect(architecture).toContain('## Boundary Design');
    expect(architecture).toContain('repository-maintenance');
    expect(architecture).not.toContain('agent-devops/');
    expect(architecture).not.toContain('Agent DevOps');
    expect(agentDevops).toContain('# Agent DevOps');
    expect(agentDevops).toContain('requirements-to-code chain');
    expect(agentDevops).toContain('contract index');
    expect(agentDevops).toContain('drift check');
    expect(agentDevops).toContain('replay evidence');
    expect(agentDevops).toContain('Agent DevOps can read and index Product Development');
    expect(agentDevops).toContain('Product runtime must not import, execute, or package Agent DevOps');
    expect(agentDevops).toContain('agent-devops/agent-infra-selection-guide.md');
    expect(agentDevops).toContain('agent-devops/layered-implementation-plan.md');
    expect(pkg.files ?? []).not.toContain('agent-devops');
    await expect(access(join(repoRoot, 'architecture', 'agent-infra-selection-guide.md'))).rejects.toThrow();
    await expect(access(join(repoRoot, 'architecture', 'layered-implementation-plan.md'))).rejects.toThrow();
  });

  test('root operating contract separates Runtime Core from Agent Services', async () => {
    const agents = await readFile(join(repoRoot, 'AGENTS.md'), 'utf8');

    expect(agents).toContain('Runtime Core + Agent Services + capability registry + storage plane + resource catalog + secrets + local RPC');
    expect(agents).toContain('Runtime Core covers model catalogs, capability envelopes, storage plane');
    expect(agents).toContain('Agent Services are composed, agent-facing services built on Runtime Core');
    expect(agents).toContain('src/services/`: Agent Services orchestration over Runtime Core ports');
    expect(agents).toMatch(/src\/storage\/`: artifact storage, JSON record storage, memory store, and\s+vector indexes/);
    expect(agents).toMatch(/Artifact, record, memory, and\s+vector stores are not execution-agent session memory/);
    expect(agents).toContain('not execution-agent session memory');
  });

  test('acceptance script runs external consumer gates', async () => {
    const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const acceptance = pkg.scripts?.['test:acceptance'] ?? '';

    expect(acceptance).toContain('test/external-runtime-services.acceptance.test.ts');
    expect(acceptance).toContain('test/remote-provider-config.acceptance.test.ts');
    expect(acceptance).toContain('test/remote-runtime-services.acceptance.test.ts');
    expect(acceptance).toContain('test/cli-rpc-smoke.test.ts');
  });

  test('public test scripts discover only tracked product tests', async () => {
    const localContextDir = '.alpha' + 'X';
    const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    const publicTest = scripts.test ?? '';

    expect(publicTest).toMatch(/^vitest run --dir test(?:\s|$)/);
    expect(publicTest).not.toBe('vitest run');
    for (const [name, script] of Object.entries(scripts)) {
      expect(script, name).not.toContain(localContextDir);
    }
  });

  test('README publishes operator CLI failure and runtime config contracts', async () => {
    const readme = await readFile(join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('Operator CLI commands must not format failed Runtime Services envelopes as');
    expect(readme).toContain('successful empty output');
    expect(readme).toContain('`models smoke` prints per-module status and exits');
    expect(readme).toContain('non-zero when any model envelope is `missing_resource` or `failed`');
    expect(readme).toContain('`resources`, `doctor`,');
    expect(readme).toContain('`storage`, and `models smoke` commands accept the same `--runtime-home` and');
    expect(readme).toContain('`--provider-config` options');
    expect(readme).toContain('`models smoke` also accepts `--config`');
  });

  test('publish gate runs external acceptance and package dry-run checks', async () => {
    const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const prepublish = pkg.scripts?.prepublishOnly ?? '';

    expect(prepublish).toContain('pnpm test:acceptance');
    expect(prepublish).toContain('pnpm test');
    expect(prepublish).toContain('pnpm typecheck');
    expect(prepublish).toContain('pnpm build');
    expect(prepublish).toContain('npm pack --dry-run');
  });

  test('github source boundary excludes local-only and private publication hazards', async () => {
    const localContextDir = '.alpha' + 'X';
    const tracked = gitFiles(['ls-files', '-z']);
    const untracked = gitFiles(['ls-files', '--others', '--exclude-standard', '-z']);
    const sourceFiles = [...new Set([...tracked, ...untracked])]
      .filter((file) => existsSync(join(repoRoot, file)) && lstatSync(join(repoRoot, file)).isFile())
      .filter((file) => !file.startsWith('dist/') && !file.startsWith('node_modules/'))
      .sort();
    const textByFile = await Promise.all(sourceFiles.map(async (file) => [file, await readFile(join(repoRoot, file), 'utf8')] as const));
    const secretTokenQuery = 'token=' + 'secret';
    const localMachinePattern = new RegExp(
      [
        '/' + 'Users' + '/',
        'lizhao' + 'hua',
        'code' + '\\.' + 'byted',
        'byte' + 'dance',
        'byte' + 'intl',
      ].join('|'),
      'i',
    );

    expect(tracked.filter((file) => file.startsWith(`${localContextDir}/`))).toEqual([]);

    const gitignore = await readFile(join(repoRoot, '.gitignore'), 'utf8');
    for (const ignored of [
      '.agent-runtime-services/',
      'model-providers.json',
      'runtime-providers.json',
      'secrets.enc',
      '.keystore.salt',
      'artifacts/',
      'db/',
      'vector/',
      'logs/',
      'debug-*.md',
    ]) {
      expect(gitignore).toContain(ignored);
    }
    expect(gitignore).not.toContain(localContextDir);

    for (const [file, text] of textByFile) {
      expect(text, file).not.toMatch(localMachinePattern);
      expect(text, file).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
      expect(text, file).not.toContain(secretTokenQuery);
      expect(text, file).not.toContain(localContextDir);
    }

    const privateHelperPatterns = [
      /helpers\/e2e/,
      new RegExp('content-' + 'index-helper'),
      new RegExp('model-' + 'artifact-helper'),
    ];
    const privateHelperRefs = textByFile
      .filter(([, text]) => privateHelperPatterns.some((pattern) => pattern.test(text)))
      .map(([file]) => file);
    expect(privateHelperRefs).toEqual([]);

    const productRuntimeRefs = textByFile
      .filter(([file]) => file.startsWith('src/') || file.startsWith('bin/') || file === 'package.json')
      .filter(([, text]) => text.includes('agent-devops') || text.includes('Agent DevOps'))
      .map(([file]) => file);
    expect(productRuntimeRefs).toEqual([]);
  });

  test('README publishes the remote provider config and adapter route contract', async () => {
    const readme = await readFile(join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('## Remote Provider Config');
    expect(readme).toContain('runtime-providers.json');
    expect(readme).toContain('"kind": "remote-http-json"');
    expect(readme).toContain('"artifact"');
    expect(readme).toContain('"object"');
    expect(readme).toContain('"manifest"');
    expect(readme).toContain('"record"');
    expect(readme).toContain('"vector"');
    for (const route of [
      '/resources/probe',
      '/models/complete',
      '/models/embedding',
      '/models/image',
      '/objects/put',
      '/objects/get',
      '/artifacts/insert',
      '/artifacts/get',
      '/records/upsert',
      '/records/query',
      '/vectors/upsert',
      '/vectors/search',
    ]) {
      expect(readme).toContain(route);
    }
    expect(readme).toContain('`/artifacts/delete`: `{ namespace, id }`');
    expect(readme).toContain('`/records/delete`: `{ namespace, tableName, id }`');
    expect(readme).toContain('`/vectors/search`: `{ tableName, embedding, limit?, filter? }`');
    expect(readme).toContain('This is not a');
    expect(readme).toContain('caller-provided SQL DSL');
  });

  test('root public API does not expose replaceable provider implementations', async () => {
    const indexSource = await readFile(join(repoRoot, 'src', 'index.ts'), 'utf8');

    expect(indexSource).not.toContain("export * from './storage/");
    expect(indexSource).not.toContain("export * from './providers/remote'");
    expect(indexSource).not.toContain("export * from './providers/store'");
    expect(indexSource).not.toContain("export * from './config/keystore'");
    expect(indexSource).not.toContain("export * from './mcp/");
    expect(indexSource).not.toMatch(/create(?:Local|Sqlite|Remote|LanceDb|VectorIndex|ArtifactStore|RuntimeProviderPortsFromConfig)/);
  });

  test('architecture documents one internal core with separate local RPC and remote MCP surfaces', async () => {
    const architecture = await readFile(join(repoRoot, 'architecture', 'README.md'), 'utf8');

    expect(architecture).toContain('CapabilityRegistry');
    expect(architecture).toContain('local surface');
    expect(architecture).toContain('/rpc');
    expect(architecture).toContain('remote surface');
    expect(architecture).toContain('/mcp');
    expect(architecture).toContain('MCP adapter');
    expect(architecture).toContain('Product Architecture Documents');
    expect(architecture).toContain('storage-retrieval-design.md');
    expect(architecture).not.toContain('../agent-devops/layered-implementation-plan.md');
    expect(architecture).not.toContain('../agent-devops/agent-infra-selection-guide.md');
    expect(architecture).not.toContain('./layered-implementation-plan.md');
    expect(architecture).not.toContain('./agent-infra-selection-guide.md');
  });

  test('layered implementation plan stays focused on declarations and planning', async () => {
    const plan = await readFile(join(repoRoot, 'agent-devops', 'layered-implementation-plan.md'), 'utf8');

    expect(plan).toMatch(/Agent Runtime Services provides stable Runtime Core capabilities and\s+Agent\s+Services/);
    expect(plan).toContain('Target Positioning');
    expect(plan).toContain('Architecture Layers');
    expect(plan).toContain('Layer Rules');
    expect(plan).toContain('L3 Provider Ports');
    expect(plan).toContain('L4 Local Provider Adapters');
    expect(plan).toContain('L5 Remote Provider Adapters');
    expect(plan).toContain('L7 External Acceptance');
    expect(plan).toContain('Implementation Sequence');
    expect(plan).toContain('Phase 4: MCP Governance Layer');
    expect(plan).not.toContain('Current P0 Gaps');
    expect(plan).not.toContain('Acceptance Checklist');
    expect(plan).not.toContain('stable architecture gate');
  });

  test('runtime capability selection guide lives under agent devops', async () => {
    const guide = await readFile(join(repoRoot, 'agent-devops', 'agent-infra-selection-guide.md'), 'utf8');

    expect(guide).toContain('Runtime Capability Selection Guide');
    expect(guide).toContain('source: agent-devops/agent-infra-selection-guide.md');
    expect(guide).toContain('architecture/README.md');
    expect(guide).toContain('architecture/storage-retrieval-design.md');
    expect(guide).toContain('Review Checklist');
  });

  test('storage and retrieval design documents explicit isolation and backend boundaries', async () => {
    const [readme, agents, architecture, design] = await Promise.all([
      readFile(join(repoRoot, 'README.md'), 'utf8'),
      readFile(join(repoRoot, 'AGENTS.md'), 'utf8'),
      readFile(join(repoRoot, 'architecture', 'README.md'), 'utf8'),
      readFile(join(repoRoot, 'architecture', 'storage-retrieval-design.md'), 'utf8'),
    ]);

    expect(design).toContain('artifacts are isolated by `namespace`');
    expect(design).toContain('vectors are isolated by `tableName`');
    expect(design).toContain('SQLite is only a local manifest');
    expect(design).toContain('vector storage and retrieval use LanceDB');
    expect(design).toContain('audit, authorization, and multi-tenant governance stay above these local P0');
    expect(design).toContain('helper-only content indexing APIs outside `vector.*`');
    expect(design).toContain('helper-only model artifact persistence APIs outside `artifact.*`');
    for (const source of [readme, agents, architecture, design]) {
      expect(source).not.toContain('content-index');
      expect(source).not.toContain('model-artifacts');
      expect(source).not.toContain('generated model artifact persistence');
      expect(source).not.toContain('content index,');
    }
  });
});
