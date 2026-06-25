import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Command } from 'commander';
import pkg from '../../package.json';
import { APP_NAME, createRuntimeServicePaths, paths } from '../config/paths';
import { listSecretIds } from '../config/keystore';
import { createDefaultModelProviderConfig } from '../models/catalog';
import {
  installDefaultModelProviderConfig,
  loadModelProviderConfig,
} from '../models/store';
import { startRuntimeServicesRpcServer } from '../rpc/server';
import { runDoctorCli } from './doctor';
import { modelSmokeFailureMessage, parseSmokeModule, smokeModelsForCli } from './model-smoke';
import { runResourcesCli } from './resources';
import {
  createRuntimeServicesForCli,
} from './runtime';
import {
  runSecretsGet,
  runSecretsList,
  runSecretsRemove,
  runSecretsSet,
} from './secrets';
import {
  runStorageArtifactsCleanupCli,
  runStorageArtifactsListCli,
  runStorageStatusCli,
  runStorageVectorsSearchCli,
  runStorageVectorsUpsertCli,
} from './storage';

const program = new Command();

program
  .name(APP_NAME)
  .description('Local runtime services for domain agents and build agents')
  .version(pkg.version, '-v, --version');

program
  .command('serve')
  .description('Start localhost JSON-RPC runtime services')
  .option('--host <host>', 'host to bind', '127.0.0.1')
  .option('--port <port>', 'port to bind', '8765')
  .option('--runtime-home <path>', 'runtime services home directory')
  .option('--provider-config <path>', 'runtime provider port config path')
  .action(async (opts: { host?: string; port?: string; runtimeHome?: string; providerConfig?: string }) => {
    const runtime = await createRuntimeServicesForCli({
      runtimeHome: opts.runtimeHome,
      providerConfig: opts.providerConfig,
    });
    const server = await startRuntimeServicesRpcServer({
      services: runtime.services,
      host: opts.host,
      port: Number.parseInt(opts.port ?? '8765', 10),
    });
    const pidFile = createRuntimeServicePaths(runtime.runtimeHome).servicePidFile;
    await writeServicePidFile(pidFile);
    installServeShutdownHandlers(server, pidFile);
    console.log(`agent-runtime-services listening on ${server.url}`);
  });

program
  .command('resources')
  .description('List model, storage, and compute resources')
  .option('--runtime-home <path>', 'runtime services home directory')
  .option('--provider-config <path>', 'runtime provider port config path')
  .action(async (opts: { runtimeHome?: string; providerConfig?: string }) => {
    await runResourcesCli(opts);
  });

program
  .command('doctor')
  .description('Read-only Runtime Services readiness check')
  .option('--runtime-home <path>', 'runtime services home directory')
  .option('--provider-config <path>', 'runtime provider port config path')
  .action(async (opts: { runtimeHome?: string; providerConfig?: string }) => {
    await runDoctorCli(opts);
  });

const storage = program
  .command('storage')
  .description('Inspect Runtime Services artifact and vector storage');

storage
  .command('status')
  .description('Show local artifact and vector storage status')
  .option('--runtime-home <path>', 'runtime services home directory')
  .option('--provider-config <path>', 'runtime provider port config path')
  .action(async (opts: { runtimeHome?: string; providerConfig?: string }) => {
    await runStorageStatusCli(opts);
  });

const artifacts = storage
  .command('artifacts')
  .description('Inspect stored artifacts');

artifacts
  .command('list')
  .description('List stored artifact metadata')
  .requiredOption('--namespace <namespace>', 'artifact namespace to inspect')
  .option('--limit <n>', 'maximum artifacts to display', '20')
  .option('--runtime-home <path>', 'runtime services home directory')
  .option('--provider-config <path>', 'runtime provider port config path')
  .action(async (opts: { namespace: string; limit?: string; runtimeHome?: string; providerConfig?: string }) => {
    await runStorageArtifactsListCli(opts);
  });

artifacts
  .command('cleanup')
  .description('Delete expired artifacts')
  .requiredOption('--namespace <namespace>', 'artifact namespace to clean')
  .option('--runtime-home <path>', 'runtime services home directory')
  .option('--provider-config <path>', 'runtime provider port config path')
  .action(async (opts: { namespace: string; runtimeHome?: string; providerConfig?: string }) => {
    await runStorageArtifactsCleanupCli(opts);
  });

const vectors = storage
  .command('vectors')
  .description('Inspect and update vector index content');

vectors
  .command('upsert')
  .argument('<id>', 'vector record id')
  .argument('[content...]', 'text content to embed and store')
  .requiredOption('--table-name <tableName>', 'LanceDB table name to write')
  .option('--config <path>', 'model provider config path')
  .option('--runtime-home <path>', 'runtime services home directory')
  .option('--provider-config <path>', 'runtime provider port config path')
  .description('Embed text and upsert it into the vector index')
  .action(async (id: string, content: string[], opts: { config?: string; tableName: string; runtimeHome?: string; providerConfig?: string }) => {
    await runStorageVectorsUpsertCli(id, content, opts);
  });

vectors
  .command('search')
  .argument('[query...]', 'query text to embed and search')
  .requiredOption('--table-name <tableName>', 'LanceDB table name to search')
  .option('--limit <n>', 'maximum results to display', '10')
  .option('--config <path>', 'model provider config path')
  .option('--runtime-home <path>', 'runtime services home directory')
  .option('--provider-config <path>', 'runtime provider port config path')
  .description('Embed query text and search the vector index')
  .action(async (query: string[], opts: { config?: string; tableName: string; limit?: string; runtimeHome?: string; providerConfig?: string }) => {
    await runStorageVectorsSearchCli(query, opts);
  });

const secrets = program
  .command('secrets')
  .description(`Manage Runtime Services encrypted secrets (${paths.secretsFile})`);

secrets
  .command('get')
  .description('Exec-provider protocol: read JSON request from stdin, write JSON response to stdout.')
  .action(async () => {
    await runSecretsGet();
  });

secrets
  .command('set')
  .description('Encrypt and store a Runtime Services secret. Prompts without echoing.')
  .requiredOption('--id <id>', 'secret id')
  .action(async (opts: { id?: string }) => {
    await runSecretsSet(opts);
  });

secrets
  .command('list')
  .description('List Runtime Services secret IDs without showing values')
  .action(async () => {
    await runSecretsList();
  });

secrets
  .command('remove')
  .description('Delete a Runtime Services secret')
  .requiredOption('--id <id>', 'secret id')
  .action(async (opts: { id?: string }) => {
    await runSecretsRemove(opts);
  });

const models = program
  .command('models')
  .description(`Manage model provider config (${paths.modelProvidersFile})`);

models
  .command('install-volcengine-agent-plan')
  .description('Install the Volcengine Agent Plan model provider config')
  .option('-o, --output <path>', 'write model provider config to this file')
  .action(async (opts: { output?: string }) => {
    const config = await installDefaultModelProviderConfig(opts.output ?? paths.modelProvidersFile);
    console.log(`Installed model provider config: ${opts.output ?? paths.modelProvidersFile}`);
    console.log(`language: ${config.modules.language.selectedModel}`);
    console.log(`embedding: ${config.modules.embedding.selectedModel}`);
    console.log(`vision: ${config.modules.vision.selectedModel}`);
  });

models
  .command('list')
  .description('List configured model providers without showing secret values')
  .action(async () => {
    const config = await loadModelProviderConfig().catch(() => createDefaultModelProviderConfig());
    console.log([
      'Agent runtime services model providers',
      `language: ${config.modules.language.selectedModel}`,
      `embedding: ${config.modules.embedding.selectedModel}`,
      `vision: ${config.modules.vision.selectedModel}`,
      ...Object.values(config.providers).map((provider) => `- ${provider.id}: ${provider.baseUrl}`),
    ].join('\n'));
  });

models
  .command('smoke')
  .description('Smoke test configured model modules without printing secret values')
  .option('--module <module>', 'language, embedding, vision, or all', 'all')
  .option('--runtime-home <path>', 'runtime services home directory')
  .option('--config <path>', 'model provider config path')
  .option('--provider-config <path>', 'runtime provider port config path')
  .action(async (opts: { module?: string; runtimeHome?: string; config?: string; providerConfig?: string }) => {
    const module = parseSmokeModule(opts.module);
    const runtime = await createRuntimeServicesForCli({
      runtimeHome: opts.runtimeHome,
      modelConfig: opts.config,
      providerConfig: opts.providerConfig,
    });
    const report = await smokeModelsForCli(module, runtime.services);
    console.log(report.output);
    if (report.failures.length > 0) throw new Error(modelSmokeFailureMessage(report.failures));
  });

await program.parseAsync(process.argv);

async function writeServicePidFile(pidFile: string): Promise<void> {
  await mkdir(dirname(pidFile), { recursive: true });
  const tmp = `${pidFile}.tmp-${process.pid}`;
  await writeFile(tmp, `${process.pid}\n`, { encoding: 'utf8', mode: 0o644 });
  await rename(tmp, pidFile);
}

function installServeShutdownHandlers(server: { close(): Promise<void> }, pidFile: string): void {
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
      await removeServicePidFileIfOwned(pidFile);
      process.exit(0);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}

async function removeServicePidFileIfOwned(pidFile: string): Promise<void> {
  const current = await readFile(pidFile, 'utf8').catch(() => undefined);
  if (current?.trim() !== String(process.pid)) return;
  await rm(pidFile, { force: true });
}
