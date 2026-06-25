import { createRuntimeServicePaths, paths } from '../config/paths';
import { createDefaultModelProviderConfig } from '../models/catalog';
import type { ModelProviderConfig } from '../models/catalog';
import { loadModelProviderConfig } from '../models/store';
import { loadRuntimeProviderConfig } from '../providers/store';
import type { RuntimeProviderConfig } from '../providers/config';
import {
  createRuntimeServices,
  type RuntimeServices,
} from '../runtime-services';

export interface CliRuntimeOptions {
  runtimeHome?: string;
  modelConfig?: string;
  providerConfig?: string;
}

export interface CliRuntime {
  runtimeHome: string;
  modelConfig: ModelProviderConfig;
  providerConfig?: RuntimeProviderConfig;
  services: RuntimeServices;
}

export async function createRuntimeServicesForCli(options: CliRuntimeOptions = {}): Promise<CliRuntime> {
  const runtimeHome = options.runtimeHome ?? paths.appDir;
  const modelConfig = await loadModelConfigForRuntimeHome(options.runtimeHome, options.modelConfig);
  const providerConfig = await loadRuntimeProviderConfigForRuntimeHome(options.runtimeHome, options.providerConfig);
  return {
    runtimeHome,
    modelConfig,
    providerConfig,
    services: createRuntimeServices({
      runtimeHome: options.runtimeHome,
      modelConfig,
      providerConfig,
    }),
  };
}

export async function loadModelConfigForRuntimeHome(runtimeHome: string | undefined, modelConfigPath?: string) {
  const modelProvidersFile = modelConfigPath ?? (runtimeHome
    ? createRuntimeServicePaths(runtimeHome).modelProvidersFile
    : paths.modelProvidersFile);
  return loadModelProviderConfig(modelProvidersFile).catch(() => createDefaultModelProviderConfig());
}

export async function loadRuntimeProviderConfigForRuntimeHome(
  runtimeHome: string | undefined,
  providerConfigPath: string | undefined,
) {
  const runtimeProvidersFile = providerConfigPath
    ?? (runtimeHome ? createRuntimeServicePaths(runtimeHome).runtimeProvidersFile : paths.runtimeProvidersFile);
  return loadRuntimeProviderConfig(runtimeProvidersFile);
}
