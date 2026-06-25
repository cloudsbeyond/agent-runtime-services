export interface SecretRef {
  source: 'env' | 'file' | 'exec';
  provider?: string;
  id: string;
}

export type SecretInput = string | SecretRef;

export interface ProviderConfig {
  source: 'env' | 'file' | 'exec';
  allowlist?: string[];
  path?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  passEnv?: string[];
  noOutputTimeoutMs?: number;
  maxOutputBytes?: number;
}

export interface SecretsConfig {
  providers?: Record<string, ProviderConfig>;
  defaults?: { env?: string; file?: string; exec?: string };
}

export function isSecretRef(s: SecretInput): s is SecretRef {
  return typeof s === 'object' && s !== null;
}
