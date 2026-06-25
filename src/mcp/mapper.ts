import {
  RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS,
  type JsonObjectSchema,
  type RuntimeServiceCapabilityDescriptor,
  type RuntimeServiceRpcMethodId,
  type RuntimeServiceRiskClass,
} from '../capabilities/registry';

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObjectSchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

export interface ListMcpToolsOptions {
  allowedCapabilityIds?: RuntimeServiceRpcMethodId[];
  descriptors?: readonly RuntimeServiceCapabilityDescriptor[];
}

export function listMcpToolsFromRegistry(options: ListMcpToolsOptions = {}): McpTool[] {
  const allowedCapabilityIds = options.allowedCapabilityIds ?? [];
  if (allowedCapabilityIds.length === 0) return [];

  const descriptorsById = new Map(
    (options.descriptors ?? RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS)
      .map((descriptor) => [descriptor.id, descriptor]),
  );
  return allowedCapabilityIds
    .map((id) => descriptorsById.get(id))
    .filter((descriptor): descriptor is RuntimeServiceCapabilityDescriptor => Boolean(descriptor))
    .filter((descriptor) => descriptor.risk !== 'admin-secret')
    .map(capabilityToMcpTool);
}

export function capabilityToMcpTool(descriptor: RuntimeServiceCapabilityDescriptor): McpTool {
  return {
    name: descriptor.id.replaceAll('.', '_'),
    title: descriptor.id,
    description: [
      `Runtime Services capability ${descriptor.id}.`,
      `Service layer: ${descriptor.serviceLayer}.`,
      `Risk: ${descriptor.risk}.`,
      'Returns the standard runtime service envelope when the underlying capability uses one.',
    ].join(' '),
    inputSchema: descriptor.request.inputSchema,
    annotations: annotationsForRisk(descriptor.risk, descriptor.effects.network !== 'none'),
  };
}

function annotationsForRisk(risk: RuntimeServiceRiskClass, openWorld: boolean): McpTool['annotations'] {
  return {
    readOnlyHint: risk === 'read',
    destructiveHint: risk === 'write-local' || risk === 'admin-secret',
    idempotentHint: risk === 'read',
    openWorldHint: openWorld,
  };
}
