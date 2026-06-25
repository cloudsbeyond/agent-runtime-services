import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { RUNTIME_SERVICE_CAPABILITIES } from '../src/capabilities/registry';

const repoRoot = join(import.meta.dirname, '..');
const sampleDocPath = 'examples/upstream-agent-sample.md';

describe('upstream agent sample documentation', () => {
  test('is packaged, linked, and synced with the capability registry', async () => {
    const [doc, readme, packageJson] = await Promise.all([
      readFile(join(repoRoot, sampleDocPath), 'utf8'),
      readFile(join(repoRoot, 'README.md'), 'utf8'),
      readFile(join(repoRoot, 'package.json'), 'utf8'),
    ]);
    const pkg = JSON.parse(packageJson) as { files?: string[] };

    expect(pkg.files).toContain('examples');
    expect(pkg.files).not.toContain('docs');
    expect(readme).toContain(sampleDocPath);
    expect(readme).toContain('examples/consumer-agent-capability-guide.md');
    expect(readme).toContain('capabilityRevision');
    expect(doc).toContain('examples/consumer-agent-capability-guide.md');
    expect(doc).toContain('RuntimeServicesPort');
    expect(doc).toContain('createRpcRuntimeServices');
    expect(doc).toContain('capabilities.describe');
    expect(doc).toContain('Future MCP Boundary');
    expect(doc).toContain('Do not');
    expect(doc).toContain('fallback from future `/mcp` calls to `/rpc`');
    expect(doc).not.toContain('createMcpRuntimeServices');
    expect(doc).not.toContain('MCP_ALLOWLIST');
    expect(doc).toContain('RUNTIME_SERVICE_CAPABILITIES');

    for (const capabilityId of RUNTIME_SERVICE_CAPABILITIES) {
      expect(doc).toContain(`\`${capabilityId}\``);
    }
  });

  test('published RPC client sample demonstrates one external end-to-end capability flow', async () => {
    const sample = await readFile(join(repoRoot, 'examples', 'client-sample.ts'), 'utf8');

    expect(sample).toContain('capabilities.describe');
    expect(sample).toContain('capabilityRevision');
    expect(sample).toContain('language.complete');
    expect(sample).toContain('embedding.create');
    expect(sample).toContain('vision.generateImage');
    expect(sample).toContain('artifact.save');
    expect(sample).toContain('artifact.list');
    expect(sample).toContain('artifact.get');
    expect(sample).toContain('record.upsert');
    expect(sample).toContain('record.get');
    expect(sample).toContain('record.query');
    expect(sample).toContain('record.delete');
    expect(sample).toContain('memory.event.append');
    expect(sample).toContain('memory.claim.upsert');
    expect(sample).toContain('memory.relation.upsert');
    expect(sample).toContain('vector.upsert');
    expect(sample).toContain('vector.search');
    expect(sample).toContain('missingIsolation');
    expect(sample).toContain("missingIsolation.status !== 'failed'");
    expect(sample).not.toContain("from '../src/");
  });
});
