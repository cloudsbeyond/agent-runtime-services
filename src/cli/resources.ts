import type { ResourceCatalog, ResourceEvidence, ResourceRequirement } from '../resources/catalog';
import type { RuntimeServices } from '../runtime-services';
import { assertOkRuntimeEnvelope } from './envelope';
import { createRuntimeServicesForCli, type CliRuntimeOptions } from './runtime';

export function formatResources(catalog: ResourceCatalog | ResourceRequirement[]): string {
  const lines = ['Agent runtime services resources'];
  const resources = Array.isArray(catalog) ? catalog : catalog.list();
  for (const resource of resources) {
    const status = resource.status === 'available'
      ? `available via ${resource.provider ?? 'operator'}`
      : 'stubbed';
    lines.push([
      `- ${resource.id} [${resource.kind}] ${status}`,
      `  capability: ${resource.capability}`,
      `  action: ${resource.operatorAction}`,
      ...formatEvidenceLines(resource.evidence),
    ].join('\n'));
  }
  return lines.join('\n');
}

function formatEvidenceLines(evidence: ResourceEvidence[] | undefined): string[] {
  return evidence?.flatMap((item) => item.message ? [`  evidence: ${item.message}`] : []) ?? [];
}

export async function runResourcesCli(options: CliRuntimeOptions = {}): Promise<void> {
  const { services } = await createRuntimeServicesForCli(options);
  console.log(await listResourcesForCli(services));
}

export async function listResourcesForCli(services: RuntimeServices): Promise<string> {
  const status = await services.resources.list();
  assertOkRuntimeEnvelope(status);
  return formatResources(status.resources);
}
