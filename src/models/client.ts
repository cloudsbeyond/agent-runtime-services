import type { ModelProviderConfig } from './catalog';
import {
  resolveModelModuleRuntime,
  type ModelModuleRuntime,
  type ModelRuntimeSecretOptions,
} from './runtime';

export type RuntimeModelFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface LanguageModelOptions {
  input: string;
  fetch?: RuntimeModelFetch;
  runtime?: ModelRuntimeSecretOptions;
}

export interface EmbeddingOptions {
  input: string | unknown[];
  fetch?: RuntimeModelFetch;
  runtime?: ModelRuntimeSecretOptions;
}

export interface ImageGenerationOptions {
  prompt: string;
  fetch?: RuntimeModelFetch;
  runtime?: ModelRuntimeSecretOptions;
}

export interface LanguageModelResult {
  moduleId: 'language';
  providerId: string;
  modelId: string;
  text: string;
  raw: unknown;
}

export interface EmbeddingResult {
  moduleId: 'embedding';
  providerId: string;
  modelId: string;
  embedding: number[];
  raw: unknown;
}

export interface ImageGenerationResult {
  moduleId: 'vision';
  providerId: string;
  modelId: string;
  url?: string;
  b64Json?: string;
  raw: unknown;
}

export async function callLanguageModel(
  config: ModelProviderConfig,
  options: LanguageModelOptions,
): Promise<LanguageModelResult> {
  const runtime = await requireRuntime(config, 'language', options.runtime);
  const raw = await postProviderJson(
    endpoint(runtime.baseUrl, 'responses'),
    runtime,
    {
      model: runtime.modelId,
      input: options.input,
    },
    options.fetch,
  );
  return {
    moduleId: 'language',
    providerId: runtime.providerId,
    modelId: runtime.modelId,
    text: extractText(raw),
    raw,
  };
}

export async function createEmbedding(
  config: ModelProviderConfig,
  options: EmbeddingOptions,
): Promise<EmbeddingResult> {
  const runtime = await requireRuntime(config, 'embedding', options.runtime);
  const raw = await postProviderJson(
    endpoint(runtime.baseUrl, 'embeddings'),
    runtime,
    {
      model: runtime.modelId,
      input: options.input,
    },
    options.fetch,
  );
  return {
    moduleId: 'embedding',
    providerId: runtime.providerId,
    modelId: runtime.modelId,
    embedding: extractEmbedding(raw),
    raw,
  };
}

export async function generateImage(
  config: ModelProviderConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const runtime = await requireRuntime(config, 'vision', options.runtime);
  const raw = await postProviderJson(
    runtime.imageGenerationUrl ?? endpoint(runtime.baseUrl, 'images/generations'),
    runtime,
    {
      model: runtime.modelId,
      prompt: options.prompt,
    },
    options.fetch,
  );
  const image = extractImage(raw);
  return {
    moduleId: 'vision',
    providerId: runtime.providerId,
    modelId: runtime.modelId,
    ...image,
    raw,
  };
}

async function requireRuntime(
  config: ModelProviderConfig,
  moduleId: 'language' | 'embedding' | 'vision',
  options: ModelRuntimeSecretOptions = {},
): Promise<ModelModuleRuntime> {
  const runtime = await resolveModelModuleRuntime(config, moduleId, options);
  if (!runtime) throw new Error(`runtime service model is not configured for module: ${moduleId}`);
  return runtime;
}

async function postProviderJson(
  url: string,
  runtime: ModelModuleRuntime,
  body: unknown,
  fetchImpl: RuntimeModelFetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtime.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`runtime service model request failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json() as Promise<unknown>;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function extractText(raw: unknown): string {
  const record = asRecord(raw);
  const outputText = stringValue(record.output_text, record.outputText);
  if (outputText) return outputText;
  const choices = arrayValue(record.choices);
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice.message);
  const content = stringValue(message.content, firstChoice.text);
  if (content) return content;
  const output = arrayValue(record.output);
  for (const item of output) {
    const contentItems = arrayValue(asRecord(item).content);
    for (const contentItem of contentItems) {
      const text = stringValue(asRecord(contentItem).text);
      if (text) return text;
    }
  }
  return '';
}

function extractEmbedding(raw: unknown): number[] {
  const data = arrayValue(asRecord(raw).data);
  const embedding = asRecord(data[0]).embedding;
  if (!Array.isArray(embedding)) return [];
  return embedding.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function extractImage(raw: unknown): { url?: string; b64Json?: string } {
  const data = arrayValue(asRecord(raw).data);
  const first = asRecord(data[0]);
  const url = stringValue(first.url);
  const b64Json = stringValue(first.b64_json, first.b64Json);
  return {
    ...(url ? { url } : {}),
    ...(b64Json ? { b64Json } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') return value;
  }
  return undefined;
}
