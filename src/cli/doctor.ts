import {
  createResourceCatalog,
  type ResourceCatalog,
  type ResourceEvidence,
  type ResourceRequirement,
} from '../resources/catalog';
import type { RuntimeServices } from '../runtime-services';
import { assertOkRuntimeEnvelope } from './envelope';
import { createRuntimeServicesForCli, type CliRuntimeOptions } from './runtime';

export interface RuntimeServicesDoctorReport {
  runtimeHome: string;
  resources: ResourceCatalog;
}

export function formatDoctorReport(report: RuntimeServicesDoctorReport): string {
  const resources = report.resources.list();
  const requiredMissing = resources.filter((resource) => resource.kind !== 'compute' && resource.status !== 'available');
  const futureStubs = resources.filter((resource) => resource.kind === 'compute' && resource.status !== 'available');
  const readiness = requiredMissing.length === 0 ? 'ok' : 'attention';

  const lines = [
    'Agent runtime services doctor',
    `readiness: ${readiness}`,
    `home: ${report.runtimeHome}`,
  ];

  if (requiredMissing.length > 0) {
    lines.push(
      'missing runtime services resources:',
      ...requiredMissing.map((resource) => [
        `- ${resource.id} [${resource.kind}] ${resource.operatorAction}`,
        ...formatEvidenceLines(resource.evidence),
      ].join('\n')),
    );
  } else {
    lines.push('missing runtime services resources: none');
  }

  lines.push(
    'resources:',
    ...resources.map((resource) => `- ${resource.id}: ${resource.status}${resource.provider ? ` via ${resource.provider}` : ''}`),
  );
  lines.push(`future stubs: ${futureStubs.length > 0 ? futureStubs.map((resource) => resource.id).join(', ') : 'none'}`);
  return lines.join('\n');
}

export async function runDoctorCli(options: CliRuntimeOptions = {}): Promise<void> {
  const { runtimeHome, services } = await createRuntimeServicesForCli(options);
  console.log(await doctorForCli(services, runtimeHome));
}

export async function doctorForCli(services: RuntimeServices, runtimeHome: string): Promise<string> {
  const status = await services.resources.doctor();
  assertOkRuntimeEnvelope(status);
  return formatDoctorReport({
    runtimeHome,
    resources: resourceCatalogFromRequirements(status.resources),
  });
}

function resourceCatalogFromRequirements(resources: ResourceRequirement[]): ResourceCatalog {
  return createResourceCatalog(resources.map((resource) => ({
    id: resource.id,
    status: resource.status,
    ...(resource.provider ? { provider: resource.provider } : {}),
    ...(resource.evidence ? { evidence: resource.evidence } : {}),
  })));
}

function formatEvidenceLines(evidence: ResourceEvidence[] | undefined): string[] {
  return evidence?.flatMap((item) => item.message ? [`  evidence: ${item.message}`] : []) ?? [];
}
