import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { createRuntimeServicePaths } from '../src/config/paths';
import {
  RUNTIME_DATA_ENTRIES,
  runtimeDataGitIgnorePatterns,
  validateRuntimeDataGitIgnore,
} from '../src/runtime-data';

describe('runtime data contract', () => {
  test('lists local Runtime Services files and directories that must stay out of git', () => {
    expect(RUNTIME_DATA_ENTRIES.map((entry) => entry.path)).toEqual([
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
    ]);
    expect(RUNTIME_DATA_ENTRIES.every((entry) => entry.committable === false)).toBe(true);
  });

  test('validates repository gitignore coverage for runtime data entries', () => {
    const gitignore = readFileSync('.gitignore', 'utf8');

    expect(validateRuntimeDataGitIgnore(gitignore)).toEqual([]);
    expect(runtimeDataGitIgnorePatterns()).toContain('model-providers.json');
    expect(runtimeDataGitIgnorePatterns()).toContain('runtime-providers.json');
    expect(runtimeDataGitIgnorePatterns()).toContain('secrets.enc');
  });

  test('runtime service paths include separate model catalog and provider assembly config files', () => {
    const runtimeHome = '/tmp/runtime-services-contract';
    expect(createRuntimeServicePaths(runtimeHome)).toMatchObject({
      modelProvidersFile: `${runtimeHome}/model-providers.json`,
      runtimeProvidersFile: `${runtimeHome}/runtime-providers.json`,
    });
  });
});
