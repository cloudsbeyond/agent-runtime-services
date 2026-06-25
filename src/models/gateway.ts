import type { ModelProviderConfig } from './catalog';
import {
  callLanguageModel,
  createEmbedding,
  generateImage,
  type RuntimeModelFetch,
} from './client';
import type { ModelRuntimeSecretOptions } from './runtime';
import type { ModelGateway } from '../providers/ports';

export interface ModelGatewayOptions {
  fetch?: RuntimeModelFetch;
  runtime?: ModelRuntimeSecretOptions;
}

export function createModelGateway(
  config: ModelProviderConfig,
  options: ModelGatewayOptions = {},
): ModelGateway {
  return {
    providerId: 'configured-model-gateway',
    complete: (input) => callLanguageModel(config, {
      input: input.input,
      fetch: options.fetch,
      runtime: options.runtime,
    }),
    createEmbedding: (input) => createEmbedding(config, {
      input: input.input,
      fetch: options.fetch,
      runtime: options.runtime,
    }),
    generateImage: (input) => generateImage(config, {
      prompt: input.prompt,
      fetch: options.fetch,
      runtime: options.runtime,
    }),
  };
}
