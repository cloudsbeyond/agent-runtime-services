import { readFile } from 'node:fs/promises';
import { paths } from '../config/paths';
import type { RuntimeProviderConfig } from './config';

export async function loadRuntimeProviderConfig(
  path = paths.runtimeProvidersFile,
): Promise<RuntimeProviderConfig | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`runtime provider config must be a JSON object: ${path}`);
  }
  if (Object.keys(parsed).length === 0) return undefined;
  return parsed as RuntimeProviderConfig;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
