export interface RuntimeDataEntry {
  path: string;
  purpose: string;
  committable: false;
}

export const RUNTIME_DATA_ENTRIES: RuntimeDataEntry[] = [
  {
    path: '.agent-runtime-services/',
    purpose: 'default local Runtime Services home',
    committable: false,
  },
  {
    path: 'model-providers.json',
    purpose: 'local model provider catalog',
    committable: false,
  },
  {
    path: 'runtime-providers.json',
    purpose: 'local runtime provider port assembly config',
    committable: false,
  },
  {
    path: 'secrets.enc',
    purpose: 'encrypted local secret store',
    committable: false,
  },
  {
    path: '.keystore.salt',
    purpose: 'local keystore salt',
    committable: false,
  },
  {
    path: 'artifacts/',
    purpose: 'generated model and delivery artifacts',
    committable: false,
  },
  {
    path: 'db/',
    purpose: 'sqlite manifests and local operational metadata',
    committable: false,
  },
  {
    path: 'vector/',
    purpose: 'local vector index tables',
    committable: false,
  },
  {
    path: 'logs/',
    purpose: 'local diagnostic logs',
    committable: false,
  },
  {
    path: 'debug-*.md',
    purpose: 'local diagnostic reports',
    committable: false,
  },
];

export function runtimeDataGitIgnorePatterns(): string[] {
  return RUNTIME_DATA_ENTRIES.map((entry) => entry.path);
}

export function validateRuntimeDataGitIgnore(gitignore: string): string[] {
  const patterns = new Set(
    gitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  );
  return runtimeDataGitIgnorePatterns().filter((pattern) => !patterns.has(pattern));
}
