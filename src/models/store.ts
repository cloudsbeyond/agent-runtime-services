import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from '../config/paths';
import {
  MODEL_MODULE_IDS,
  OBSOLETE_SELECTED_MODEL_IDS,
  cloneModules,
  createDefaultModelProviderConfig,
  createDefaultModelModules,
  mergeModelProviderConfigs,
  type ModelModuleConfig,
  type ModelModuleId,
  type ModelModules,
  type ModelProvider,
  type ModelProviderBaseUrls,
  type ModelProviderConfig,
  type ModelSpec,
  type ModelProviderWireApi,
  VOLCENGINE_AGENT_PLAN_API_KEY_ENV,
  VOLCENGINE_AGENT_PLAN_IMAGE_GENERATION_URL,
  VOLCENGINE_AGENT_PLAN_ANTHROPIC_BASE_URL,
  VOLCENGINE_AGENT_PLAN_PROVIDER_ID,
} from './catalog';

const EMPTY_MODEL_CONFIG: ModelProviderConfig = {
  schemaVersion: 1,
  modules: createDefaultModelModules(),
  providers: {},
};

export async function loadModelProviderConfig(
  path: string = paths.modelProvidersFile,
): Promise<ModelProviderConfig> {
  try {
    const text = await readFile(path, 'utf8');
    return normalizeModelProviderConfig(JSON.parse(text) as unknown);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return cloneConfig(EMPTY_MODEL_CONFIG);
    throw err;
  }
}

export async function saveModelProviderConfig(
  config: ModelProviderConfig,
  path: string = paths.modelProvidersFile,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(normalizeModelProviderConfig(config), null, 2)}\n`, 'utf8');
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

export async function installDefaultModelProviderConfig(
  path: string = paths.modelProvidersFile,
): Promise<ModelProviderConfig> {
  const existing = await loadModelProviderConfig(path);
  const merged = mergeModelProviderConfigs(existing, createDefaultModelProviderConfig());
  await saveModelProviderConfig(merged, path);
  return merged;
}

function normalizeModelProviderConfig(raw: unknown): ModelProviderConfig {
  if (!raw || typeof raw !== 'object') return cloneConfig(EMPTY_MODEL_CONFIG);
  const source = raw as Partial<ModelProviderConfig>;
  const providers: ModelProviderConfig['providers'] = {};
  const rawProviders = source.providers && typeof source.providers === 'object'
    ? source.providers
    : {};
  for (const provider of Object.values(rawProviders)) {
    if (!provider || typeof provider !== 'object') continue;
    const candidate = provider as Partial<ModelProvider> & { apiKey?: unknown };
    const apiKeyRef = normalizeApiKeyRef(candidate);
    const wireApi = normalizeWireApi(candidate);
    const baseUrls = normalizeBaseUrls(candidate);
    const imageGenerationUrl = normalizeImageGenerationUrl(candidate);
    const envKey = normalizeEnvKey(candidate, apiKeyRef);
    if (typeof candidate.id !== 'string' || !baseUrls || !wireApi || !apiKeyRef) continue;
    providers[candidate.id] = {
      id: candidate.id,
      baseUrl: baseUrls.openai,
      baseUrls,
      ...(imageGenerationUrl ? { imageGenerationUrl } : {}),
      wireApi,
      envKey,
      apiKeyRef,
      models: normalizeModels(candidate.models),
    };
  }
  return {
    schemaVersion: 1,
    modules: normalizeModules(source),
    providers,
  };
}

function cloneConfig(config: ModelProviderConfig): ModelProviderConfig {
  return normalizeModelProviderConfig(config);
}

function normalizeBaseUrls(
  candidate: Partial<ModelProvider> & { base_urls?: unknown },
): ModelProviderBaseUrls | undefined {
  const raw = isRecord(candidate.baseUrls) ? candidate.baseUrls : isRecord(candidate.base_urls) ? candidate.base_urls : {};
  const openai = stringValue(raw.openai) ?? candidate.baseUrl;
  if (!openai) return undefined;
  const anthropic = stringValue(raw.anthropic) ??
    (candidate.id === VOLCENGINE_AGENT_PLAN_PROVIDER_ID ? VOLCENGINE_AGENT_PLAN_ANTHROPIC_BASE_URL : undefined);
  return anthropic ? { anthropic, openai } : { openai };
}

function normalizeImageGenerationUrl(
  candidate: Partial<ModelProvider> & { image_generation_url?: unknown },
): string | undefined {
  return stringValue(candidate.imageGenerationUrl) ??
    stringValue(candidate.image_generation_url) ??
    (candidate.id === VOLCENGINE_AGENT_PLAN_PROVIDER_ID ? VOLCENGINE_AGENT_PLAN_IMAGE_GENERATION_URL : undefined);
}

function normalizeModules(source: Partial<ModelProviderConfig> & LegacySelectedModelFields): ModelModules {
  const defaults = createDefaultModelModules();
  const modules = cloneModules(defaults);
  const rawModules: Record<string, unknown> = isRecord(source.modules) ? source.modules : {};
  const legacyLanguageModel = normalizeSelectedModel(source);
  const legacyEmbeddingModel = normalizeSelectedEmbeddingModel(source);
  const legacyVisionModel = normalizeSelectedVisionModel(source);

  for (const id of MODEL_MODULE_IDS) {
    modules[id] = normalizeModule(
      id,
      rawModules[id],
      defaults[id],
      legacyModelForModule(id, legacyLanguageModel, legacyEmbeddingModel, legacyVisionModel),
    );
  }
  return modules;
}

function legacyModelForModule(
  id: ModelModuleId,
  legacyLanguageModel: string | undefined,
  legacyEmbeddingModel: string | undefined,
  legacyVisionModel: string | undefined,
): string | undefined {
  if (id === 'language') {
    if (legacyLanguageModel && !isObsoleteSelectedModel(legacyLanguageModel)) return legacyLanguageModel;
    return undefined;
  }
  if (id === 'embedding') {
    return legacyEmbeddingModel ?? (legacyLanguageModel && isObsoleteSelectedModel(legacyLanguageModel) ? legacyLanguageModel : undefined);
  }
  return legacyVisionModel;
}

function normalizeModule(
  id: ModelModuleId,
  raw: unknown,
  fallback: ModelModuleConfig,
  legacySelectedModel: string | undefined,
): ModelModuleConfig {
  const candidate = isRecord(raw) ? raw : {};
  const module: ModelModuleConfig = {
    providerId: stringValue(candidate.providerId) ?? stringValue(candidate.provider_id) ?? fallback.providerId,
    selectedModel: stringValue(candidate.selectedModel) ?? stringValue(candidate.selected_model) ?? legacySelectedModel ?? fallback.selectedModel,
    baseUrl: stringValue(candidate.baseUrl) ?? stringValue(candidate.base_url) ?? fallback.baseUrl,
  };
  const wireApi = normalizeModuleWireApi(candidate) ?? fallback.wireApi;
  const imageGenerationUrl = stringValue(candidate.imageGenerationUrl) ??
    stringValue(candidate.image_generation_url) ??
    (id === 'vision' ? fallback.imageGenerationUrl : undefined);
  const switching = candidate.switching === 'manual' ? 'manual' : fallback.switching;
  if (wireApi) module.wireApi = wireApi;
  if (imageGenerationUrl) module.imageGenerationUrl = imageGenerationUrl;
  if (switching) module.switching = switching;
  return module;
}

function normalizeModuleWireApi(candidate: Record<string, unknown>): ModelProviderWireApi | undefined {
  if (candidate.wireApi === 'responses' || candidate.wire_api === 'responses') return 'responses';
  return undefined;
}

function normalizeSelectedModel(source: Partial<ModelProviderConfig> & { selected_model?: unknown }): string | undefined {
  return stringValue((source as LegacySelectedModelFields).selectedModel) ?? stringValue(source.selected_model);
}

function normalizeSelectedVisionModel(
  source: Partial<ModelProviderConfig> & { selected_vision_model?: unknown },
): string | undefined {
  return stringValue((source as LegacySelectedModelFields).selectedVisionModel) ?? stringValue(source.selected_vision_model);
}

function normalizeSelectedEmbeddingModel(
  source: Partial<ModelProviderConfig> & { selected_embedding_model?: unknown },
): string | undefined {
  return stringValue((source as LegacySelectedModelFields).selectedEmbeddingModel) ?? stringValue(source.selected_embedding_model);
}

function isObsoleteSelectedModel(value: string): boolean {
  return OBSOLETE_SELECTED_MODEL_IDS.includes(value as typeof OBSOLETE_SELECTED_MODEL_IDS[number]);
}

interface LegacySelectedModelFields {
  selectedModel?: unknown;
  selected_model?: unknown;
  selectedEmbeddingModel?: unknown;
  selected_embedding_model?: unknown;
  selectedVisionModel?: unknown;
  selected_vision_model?: unknown;
}

function normalizeApiKeyRef(
  candidate: Partial<ModelProvider> & { apiKey?: unknown; envKey?: unknown; env_key?: unknown },
): ModelProvider['apiKeyRef'] | undefined {
  if (
    (candidate.apiKeyRef?.source === 'env' || candidate.apiKeyRef?.source === 'exec' || candidate.apiKeyRef?.source === 'file') &&
    typeof candidate.apiKeyRef.id === 'string' &&
    candidate.apiKeyRef.id.trim()
  ) {
    return {
      source: candidate.apiKeyRef.source,
      ...(typeof candidate.apiKeyRef.provider === 'string' && candidate.apiKeyRef.provider.trim()
        ? { provider: candidate.apiKeyRef.provider.trim() }
        : {}),
      id: candidate.apiKeyRef.id.trim(),
    };
  }
  if (typeof candidate.apiKey === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(candidate.apiKey)) {
    return { source: 'env', id: candidate.apiKey };
  }
  if (typeof candidate.envKey === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(candidate.envKey)) {
    return { source: 'env', id: candidate.envKey };
  }
  if (typeof candidate.env_key === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(candidate.env_key)) {
    return { source: 'env', id: candidate.env_key };
  }
  return undefined;
}

function normalizeEnvKey(
  candidate: Partial<ModelProvider> & { env_key?: unknown },
  apiKeyRef: ModelProvider['apiKeyRef'] | undefined,
): string {
  const explicit = stringValue(candidate.envKey) ?? stringValue(candidate.env_key);
  if (explicit) return explicit;
  if (candidate.id === VOLCENGINE_AGENT_PLAN_PROVIDER_ID) return VOLCENGINE_AGENT_PLAN_API_KEY_ENV;
  if (apiKeyRef?.source === 'env' && /^[A-Z_][A-Z0-9_]*$/.test(apiKeyRef.id)) return apiKeyRef.id;
  if (apiKeyRef?.id && /^[A-Z_][A-Z0-9_]*$/.test(apiKeyRef.id)) return apiKeyRef.id;
  return 'MODEL_API_KEY';
}

function normalizeWireApi(
  candidate: Partial<ModelProvider> & { api?: unknown; wire_api?: unknown },
): ModelProviderWireApi | undefined {
  if (candidate.wireApi === 'responses' || candidate.wire_api === 'responses') return 'responses';
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeModels(raw: unknown): ModelSpec[] {
  if (!Array.isArray(raw)) return [];
  const models: ModelSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const model = item as Partial<ModelSpec>;
    if (
      typeof model.id !== 'string' ||
      typeof model.name !== 'string' ||
      typeof model.contextWindow !== 'number' ||
      typeof model.maxTokens !== 'number' ||
      !Array.isArray(model.input) ||
      !model.cost
    ) {
      continue;
    }
    models.push({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning === true,
      input: model.input.filter((value): value is 'text' => value === 'text'),
      cost: {
        input: Number(model.cost.input),
        output: Number(model.cost.output),
        cacheRead: Number(model.cost.cacheRead),
        cacheWrite: Number(model.cost.cacheWrite),
      },
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    });
  }
  return models;
}
