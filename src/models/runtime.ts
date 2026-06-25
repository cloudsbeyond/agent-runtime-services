import { readFile } from 'node:fs/promises';
import { getSecret } from '../config/keystore';
import type {
  ModelModuleId,
  ModelProvider,
  ModelProviderConfig,
} from './catalog';

export interface ModelRuntimeSecretOptions {
  env?: Record<string, string | undefined>;
  getSecret?: (id: string) => Promise<string | undefined>;
}

export interface ModelModuleRuntime {
  moduleId: ModelModuleId;
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  wireApi?: string;
  imageGenerationUrl?: string;
}

export async function resolveModelModuleRuntime(
  config: ModelProviderConfig,
  moduleId: ModelModuleId,
  options: ModelRuntimeSecretOptions = {},
): Promise<ModelModuleRuntime | undefined> {
  const module = config.modules[moduleId];
  const provider = config.providers[module.providerId];
  if (!provider || !module.selectedModel) return undefined;
  const apiKey = await resolveModelProviderApiKey(provider, options);
  if (!apiKey) {
    throw new Error(`missing API key for provider ${provider.id} module ${moduleId}: ${formatSecretRef(provider)}`);
  }
  return {
    moduleId,
    providerId: provider.id,
    modelId: module.selectedModel,
    baseUrl: module.baseUrl,
    apiKey,
    ...(module.wireApi ? { wireApi: module.wireApi } : {}),
    ...(module.imageGenerationUrl ? { imageGenerationUrl: module.imageGenerationUrl } : {}),
  };
}

function formatSecretRef(provider: ModelProvider): string {
  const ref = provider.apiKeyRef;
  const source = ref.provider ? `${ref.source}:${ref.provider}:${ref.id}` : `${ref.source}:${ref.id}`;
  return `${source} -> env ${provider.envKey}`;
}

export async function resolveModelProviderApiKey(
  provider: ModelProvider,
  options: ModelRuntimeSecretOptions = {},
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  const existing = env[provider.envKey]?.trim();
  if (existing) return existing;

  const ref = provider.apiKeyRef;
  if (ref.source === 'env') return env[ref.id]?.trim() || undefined;
  if (ref.source === 'exec') {
    const value = await (options.getSecret ?? getSecret)(ref.id);
    return value?.trim() || undefined;
  }
  if (ref.source === 'file') {
    const value = (await readFile(ref.id, 'utf8')).trim();
    return value || undefined;
  }
  return undefined;
}
