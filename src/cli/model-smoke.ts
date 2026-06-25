import { MODEL_MODULE_IDS, type ModelModuleId } from '../models/catalog';
import type { RuntimeServiceStatus, RuntimeServices } from '../runtime-services';
import { runtimeEnvelopeErrorMessage } from './envelope';

export type SmokeModule = ModelModuleId | 'all';

export interface ModelSmokeResult {
  moduleId: ModelModuleId;
  modelId: string;
  status: RuntimeServiceStatus;
  detail?: string;
  line: string;
}

export interface ModelSmokeReport {
  output: string;
  failures: ModelSmokeResult[];
}

export function parseSmokeModule(module: string | undefined): SmokeModule {
  if (!module || module === 'all') return 'all';
  if (MODEL_MODULE_IDS.includes(module as ModelModuleId)) return module as ModelModuleId;
  throw new Error(`unknown Runtime Services model smoke module: ${module}`);
}

export async function smokeModelsForCli(module: SmokeModule, services: RuntimeServices): Promise<ModelSmokeReport> {
  const results: ModelSmokeResult[] = [];
  for (const moduleId of smokeModuleIds(module)) {
    results.push(await smokeModule(moduleId, services));
  }
  return {
    output: ['Agent runtime services model smoke', ...results.map((result) => result.line)].join('\n'),
    failures: results.filter((result) => result.status !== 'ok'),
  };
}

export function modelSmokeFailureMessage(failures: ModelSmokeResult[]): string {
  return [
    'Runtime Services model smoke failed',
    ...failures.map((failure) => `${failure.moduleId}:${failure.status}${failure.detail ? `:${failure.detail}` : ''}`),
  ].join(' ');
}

function smokeModuleIds(module: SmokeModule): ModelModuleId[] {
  return module === 'all' ? [...MODEL_MODULE_IDS] : [module];
}

async function smokeModule(moduleId: ModelModuleId, services: RuntimeServices): Promise<ModelSmokeResult> {
  if (moduleId === 'language') {
    const result = await services.language.complete({ input: 'reply only: pong' });
    const detail = result.proposal
      ? `textChars=${result.proposal.text.length}`
      : runtimeEnvelopeErrorMessage(result);
    return smokeResult(moduleId, result.modelId, result.status, detail);
  }
  if (moduleId === 'embedding') {
    const result = await services.embedding.create({ input: 'runtime services smoke' });
    const detail = result.embedding
      ? `dimensions=${result.embedding.length}`
      : runtimeEnvelopeErrorMessage(result);
    return smokeResult(moduleId, result.modelId, result.status, detail);
  }
  const result = await services.vision.generateImage({
    prompt: 'minimal runtime services smoke image: a single blue dot on a white background',
  });
  const detail = result.artifact
    ? `image=${result.artifact.url ? 'url' : result.artifact.b64Json ? 'base64' : 'unknown'}`
    : runtimeEnvelopeErrorMessage(result);
  return smokeResult(moduleId, result.modelId, result.status, detail);
}

function smokeResult(
  moduleId: ModelModuleId,
  modelId: string,
  status: RuntimeServiceStatus,
  detail: string | undefined,
): ModelSmokeResult {
  return {
    moduleId,
    modelId,
    status,
    ...(detail ? { detail } : {}),
    line: `- ${moduleId} ${modelId}: ${status}${detail ? ` ${detail}` : ''}`,
  };
}
