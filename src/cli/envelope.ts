import type { RuntimeServiceEnvelope } from '../runtime-services';

export function assertOkRuntimeEnvelope<T extends RuntimeServiceEnvelope>(
  result: T,
): asserts result is T & { status: 'ok' } {
  if (result.status !== 'ok') throw new Error(runtimeEnvelopeErrorMessage(result));
}

export function runtimeEnvelopeErrorMessage(result: RuntimeServiceEnvelope): string {
  return result.evidence.find((item) => item.message)?.message ?? result.status;
}
