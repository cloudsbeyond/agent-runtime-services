import type { ResourceOverride } from '../resources/catalog';
import type { SecretRef } from '../config/schema';

export type ModelProviderWireApi = 'responses';
export type ModelInputModality = 'text';
export type ModelModuleId = 'language' | 'embedding' | 'vision';

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelSpec {
  id: string;
  name: string;
  reasoning: boolean;
  input: ModelInputModality[];
  cost: ModelCost;
  contextWindow: number;
  maxTokens: number;
}

export interface ModelProviderBaseUrls {
  anthropic?: string;
  openai: string;
}

export interface ModelProvider {
  id: string;
  baseUrl: string;
  baseUrls: ModelProviderBaseUrls;
  imageGenerationUrl?: string;
  wireApi: ModelProviderWireApi;
  envKey: string;
  models: ModelSpec[];
  apiKeyRef: SecretRef;
}

export interface ModelModuleConfig {
  providerId: string;
  selectedModel: string;
  baseUrl: string;
  wireApi?: ModelProviderWireApi;
  imageGenerationUrl?: string;
  switching?: 'manual';
}

export type ModelModules = Record<ModelModuleId, ModelModuleConfig>;

export interface ModelProviderConfig {
  schemaVersion: 1;
  modules: ModelModules;
  providers: Record<string, ModelProvider>;
}

export interface ModelLookupResult {
  providerId: string;
  provider: ModelProvider;
  model: ModelSpec;
}

const AGENT_PLAN_COST: ModelCost = {
  input: 0.0001,
  output: 0.0002,
  cacheRead: 0,
  cacheWrite: 0,
};

const VOLCENGINE_AGENT_PLAN_MODELS: ModelSpec[] = [
  {
    id: 'doubao-seed-2.0-code',
    name: 'Doubao Seed 2.0 Code',
    reasoning: false,
    input: ['text'],
    cost: AGENT_PLAN_COST,
    contextWindow: 256000,
    maxTokens: 4096,
  },
  {
    id: 'doubao-seed-2.0-pro',
    name: 'Doubao Seed 2.0 Pro',
    reasoning: false,
    input: ['text'],
    cost: AGENT_PLAN_COST,
    contextWindow: 256000,
    maxTokens: 4096,
  },
  {
    id: 'doubao-seed-2.0-lite',
    name: 'Doubao Seed 2.0 Lite',
    reasoning: false,
    input: ['text'],
    cost: AGENT_PLAN_COST,
    contextWindow: 256000,
    maxTokens: 4096,
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7',
    reasoning: false,
    input: ['text'],
    cost: AGENT_PLAN_COST,
    contextWindow: 256000,
    maxTokens: 4096,
  },
  {
    id: 'glm-5.1',
    name: 'GLM 5.1',
    reasoning: false,
    input: ['text'],
    cost: AGENT_PLAN_COST,
    contextWindow: 256000,
    maxTokens: 4096,
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    reasoning: false,
    input: ['text'],
    cost: AGENT_PLAN_COST,
    contextWindow: 256000,
    maxTokens: 4096,
  },
  {
    id: 'doubao-seed-2.0-mini',
    name: 'Doubao Seed 2.0 Mini',
    reasoning: false,
    input: ['text'],
    cost: AGENT_PLAN_COST,
    contextWindow: 256000,
    maxTokens: 4096,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    reasoning: false,
    input: ['text'],
    cost: AGENT_PLAN_COST,
    contextWindow: 256000,
    maxTokens: 4096,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    reasoning: false,
    input: ['text'],
    cost: AGENT_PLAN_COST,
    contextWindow: 256000,
    maxTokens: 4096,
  },
];

export const VOLCENGINE_AGENT_PLAN_PROVIDER_ID = 'volcengine-agent-plan';
export const VOLCENGINE_AGENT_PLAN_API_KEY_ENV = 'ARK_API_KEY';
export const VOLCENGINE_AGENT_PLAN_ANTHROPIC_BASE_URL = 'https://ark.cn-beijing.volces.com/api/plan';
export const VOLCENGINE_AGENT_PLAN_OPENAI_BASE_URL = 'https://ark.cn-beijing.volces.com/api/plan/v3';
export const VOLCENGINE_AGENT_PLAN_IMAGE_GENERATION_URL = `${VOLCENGINE_AGENT_PLAN_OPENAI_BASE_URL}/images/generations`;
export const VOLCENGINE_AGENT_PLAN_SELECTED_MODEL = 'deepseek-v4-pro';
export const VOLCENGINE_AGENT_PLAN_SELECTED_EMBEDDING_MODEL = 'doubao-embedding-vision';
export const VOLCENGINE_AGENT_PLAN_SELECTED_VISION_MODEL = 'doubao-seedream-5.0-lite';
export const OBSOLETE_SELECTED_MODEL_IDS = ['doubao-embedding-vision'] as const;
export const OBSOLETE_MODEL_PROVIDER_IDS = ['volcengine-plan'] as const;

export function createVolcengineAgentPlanProvider(): ModelProvider {
  return cloneProvider({
    id: VOLCENGINE_AGENT_PLAN_PROVIDER_ID,
    baseUrl: VOLCENGINE_AGENT_PLAN_OPENAI_BASE_URL,
    baseUrls: {
      anthropic: VOLCENGINE_AGENT_PLAN_ANTHROPIC_BASE_URL,
      openai: VOLCENGINE_AGENT_PLAN_OPENAI_BASE_URL,
    },
    imageGenerationUrl: VOLCENGINE_AGENT_PLAN_IMAGE_GENERATION_URL,
    wireApi: 'responses',
    envKey: VOLCENGINE_AGENT_PLAN_API_KEY_ENV,
    models: VOLCENGINE_AGENT_PLAN_MODELS,
    apiKeyRef: { source: 'exec', provider: 'runtime-services', id: VOLCENGINE_AGENT_PLAN_API_KEY_ENV },
  });
}

export function createDefaultModelProviderConfig(): ModelProviderConfig {
  const provider = createVolcengineAgentPlanProvider();
  return {
    schemaVersion: 1,
    modules: createDefaultModelModules(),
    providers: {
      [provider.id]: provider,
    },
  };
}

export function createDefaultModelModules(): ModelModules {
  return {
    language: {
      providerId: VOLCENGINE_AGENT_PLAN_PROVIDER_ID,
      selectedModel: VOLCENGINE_AGENT_PLAN_SELECTED_MODEL,
      baseUrl: VOLCENGINE_AGENT_PLAN_OPENAI_BASE_URL,
      wireApi: 'responses',
    },
    embedding: {
      providerId: VOLCENGINE_AGENT_PLAN_PROVIDER_ID,
      selectedModel: VOLCENGINE_AGENT_PLAN_SELECTED_EMBEDDING_MODEL,
      baseUrl: VOLCENGINE_AGENT_PLAN_OPENAI_BASE_URL,
    },
    vision: {
      providerId: VOLCENGINE_AGENT_PLAN_PROVIDER_ID,
      selectedModel: VOLCENGINE_AGENT_PLAN_SELECTED_VISION_MODEL,
      baseUrl: VOLCENGINE_AGENT_PLAN_OPENAI_BASE_URL,
      imageGenerationUrl: VOLCENGINE_AGENT_PLAN_IMAGE_GENERATION_URL,
      switching: 'manual',
    },
  };
}

export function findModelById(
  config: ModelProviderConfig,
  modelId: string,
): ModelLookupResult | undefined {
  const target = modelId.trim();
  if (!target) return undefined;
  for (const provider of Object.values(config.providers)) {
    const model = provider.models.find((candidate) => candidate.id === target);
    if (model) {
      return {
        providerId: provider.id,
        provider: cloneProvider(provider),
        model: cloneModel(model),
      };
    }
  }
  return undefined;
}

export function modelProviderResourceOverrides(
  config: ModelProviderConfig,
  env: Record<string, string | undefined> = process.env,
  availableSecretIds: ReadonlySet<string> = new Set(),
): ResourceOverride[] {
  const overrides: ResourceOverride[] = [];
  const language = config.modules.language;
  const languageProvider = getProviderForModule(config, 'language');
  if (languageProvider && hasConfiguredKey(languageProvider, env, availableSecretIds) && language.selectedModel) {
    overrides.push({
      id: 'model.language_completion',
      status: 'available',
      provider: `${languageProvider.id}:${language.selectedModel}`,
    });
  }

  const vision = config.modules.vision;
  const visionProvider = getProviderForModule(config, 'vision');
  if (visionProvider && hasConfiguredKey(visionProvider, env, availableSecretIds) && vision.selectedModel && vision.imageGenerationUrl) {
    overrides.push({
      id: 'model.image_generation',
      status: 'available',
      provider: `${visionProvider.id}:${vision.selectedModel}`,
    });
  }

  const embedding = config.modules.embedding;
  const embeddingProvider = getProviderForModule(config, 'embedding');
  if (embeddingProvider && hasConfiguredKey(embeddingProvider, env, availableSecretIds) && embedding.selectedModel) {
    overrides.push({
      id: 'model.embedding',
      status: 'available',
      provider: `${embeddingProvider.id}:${embedding.selectedModel}`,
    });
  }
  return overrides;
}

export function mergeModelProviderConfigs(
  base: ModelProviderConfig,
  incoming: ModelProviderConfig,
): ModelProviderConfig {
  const providers: Record<string, ModelProvider> = {};
  for (const provider of Object.values(base.providers)) {
    if (OBSOLETE_MODEL_PROVIDER_IDS.includes(provider.id as typeof OBSOLETE_MODEL_PROVIDER_IDS[number])) continue;
    providers[provider.id] = cloneProvider(provider);
  }
  for (const provider of Object.values(incoming.providers)) {
    const existing = providers[provider.id];
    providers[provider.id] = {
      ...cloneProvider(provider),
      envKey: existing?.envKey ?? provider.envKey,
      apiKeyRef: mergeApiKeyRef(existing?.apiKeyRef, provider.apiKeyRef),
    };
  }
  return {
    schemaVersion: 1,
    modules: mergeModelModules(base.modules, incoming.modules),
    providers,
  };
}

function mergeApiKeyRef(
  existing: SecretRef | undefined,
  incoming: SecretRef,
): SecretRef {
  if (!existing) return { ...incoming };
  if (
    existing.source === 'env' &&
    existing.id === VOLCENGINE_AGENT_PLAN_API_KEY_ENV &&
    incoming.source === 'exec' &&
    incoming.id === VOLCENGINE_AGENT_PLAN_API_KEY_ENV
  ) {
    return { ...incoming };
  }
  return { ...existing };
}

function mergeModelModules(base: ModelModules, incoming: ModelModules): ModelModules {
  const modules: ModelModules = cloneModules(incoming);
  for (const id of MODEL_MODULE_IDS) {
    const baseModule = base[id];
    if (!baseModule) continue;
    modules[id] = {
      ...cloneModule(baseModule),
      providerId: incoming[id]?.providerId ?? baseModule.providerId,
      baseUrl: incoming[id]?.baseUrl ?? baseModule.baseUrl,
      ...(incoming[id]?.wireApi ? { wireApi: incoming[id].wireApi } : baseModule.wireApi ? { wireApi: baseModule.wireApi } : {}),
      ...(incoming[id]?.imageGenerationUrl
        ? { imageGenerationUrl: incoming[id].imageGenerationUrl }
        : baseModule.imageGenerationUrl
          ? { imageGenerationUrl: baseModule.imageGenerationUrl }
          : {}),
      ...(incoming[id]?.switching ? { switching: incoming[id].switching } : baseModule.switching ? { switching: baseModule.switching } : {}),
      selectedModel: mergeSelectedModuleModel(id, baseModule.selectedModel, incoming[id]?.selectedModel),
    };
  }
  return modules;
}

function mergeSelectedModuleModel(
  id: ModelModuleId,
  baseSelected: string,
  incomingSelected: string | undefined,
): string {
  if (
    id === 'language' &&
    OBSOLETE_SELECTED_MODEL_IDS.includes(baseSelected as typeof OBSOLETE_SELECTED_MODEL_IDS[number])
  ) {
    return incomingSelected ?? VOLCENGINE_AGENT_PLAN_SELECTED_MODEL;
  }
  return baseSelected || incomingSelected || createDefaultModelModules()[id].selectedModel;
}

function cloneProvider(provider: ModelProvider): ModelProvider {
  return {
    ...provider,
    baseUrls: { ...provider.baseUrls },
    apiKeyRef: { ...provider.apiKeyRef },
    models: provider.models.map(cloneModel),
  };
}

function cloneModel(model: ModelSpec): ModelSpec {
  return {
    ...model,
    input: [...model.input],
    cost: { ...model.cost },
  };
}

export const MODEL_MODULE_IDS: ModelModuleId[] = ['language', 'embedding', 'vision'];

export function cloneModules(modules: ModelModules): ModelModules {
  return {
    language: cloneModule(modules.language),
    embedding: cloneModule(modules.embedding),
    vision: cloneModule(modules.vision),
  };
}

function cloneModule(module: ModelModuleConfig): ModelModuleConfig {
  return { ...module };
}

function getProviderForModule(
  config: ModelProviderConfig,
  moduleId: ModelModuleId,
): ModelProvider | undefined {
  const module = config.modules[moduleId];
  return config.providers[module.providerId];
}

function hasConfiguredKey(
  provider: ModelProvider,
  env: Record<string, string | undefined>,
  availableSecretIds: ReadonlySet<string>,
): boolean {
  if (env[provider.envKey]?.trim()) return true;
  if (provider.apiKeyRef.source === 'env') return Boolean(env[provider.apiKeyRef.id]?.trim());
  if (provider.apiKeyRef.source === 'exec') return availableSecretIds.has(provider.apiKeyRef.id);
  return false;
}
