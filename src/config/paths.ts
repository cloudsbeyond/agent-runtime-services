import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const APP_NAME = 'agent-runtime-services';
export const APP_HOME_ENV = 'AGENT_RUNTIME_SERVICES_HOME';

export function resolveAppDirFromEnv(
  env: NodeJS.ProcessEnv,
  home: string,
  _exists: (path: string) => boolean = existsSync,
): string {
  const customHome = env[APP_HOME_ENV]?.trim();
  if (customHome) return customHome;
  return join(home, `.${APP_NAME}`);
}

export function createRuntimeServicePaths(appDir: string) {
  return {
    appDir,
    cacheDir: appDir,
    modelProvidersFile: join(appDir, 'model-providers.json'),
    runtimeProvidersFile: join(appDir, 'runtime-providers.json'),
    servicePidFile: join(appDir, 'service.pid'),
    secretsFile: join(appDir, 'secrets.enc'),
    keystoreSaltFile: join(appDir, '.keystore.salt'),
    artifactsDir: join(appDir, 'artifacts'),
    artifactDbDir: join(appDir, 'db'),
    artifactManifestDb: join(appDir, 'db', 'artifacts.sqlite'),
    recordStoreDb: join(appDir, 'db', 'records.sqlite'),
    memoryStoreDb: join(appDir, 'db', 'memory.sqlite'),
    vectorDir: join(appDir, 'vector'),
  };
}

const appDir = resolveAppDirFromEnv(process.env, homedir(), existsSync);

export const paths = createRuntimeServicePaths(appDir);
