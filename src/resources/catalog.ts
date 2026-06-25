export type ResourceKind = 'model' | 'storage' | 'compute';
export type ResourceStatus = 'available' | 'stubbed';

export interface ResourceEvidence {
  kind: string;
  message?: string;
}

export interface ResourceRequirement {
  id: string;
  kind: ResourceKind;
  capability: string;
  purpose: string;
  status: ResourceStatus;
  provider?: string;
  evidence?: ResourceEvidence[];
  operatorAction: string;
}

export interface ResourceOverride {
  id: string;
  status: ResourceStatus;
  provider?: string;
  evidence?: ResourceEvidence[];
}

export interface ResourceCatalog {
  list(): ResourceRequirement[];
  get(id: string): ResourceRequirement | undefined;
  require(id: string): ResourceRequirement;
}

const DEFAULT_REQUIREMENTS: ResourceRequirement[] = [
  {
    id: 'model.language_completion',
    kind: 'model',
    capability: 'generate typed text proposals through an operator-provided endpoint',
    purpose: 'Reusable language-model support for domain-agent and build-agent workflows without granting decision authority.',
    status: 'stubbed',
    operatorAction: 'Provide a configured language model endpoint and keep API keys outside git.',
  },
  {
    id: 'model.image_generation',
    kind: 'model',
    capability: 'generate image artifacts through an operator-provided endpoint',
    purpose: 'Visual artifact support for multimodal presentation workflows without granting execution authority.',
    status: 'stubbed',
    operatorAction: 'Provide a configured image generation model endpoint and keep API keys outside git.',
  },
  {
    id: 'model.embedding',
    kind: 'model',
    capability: 'create vector embeddings through an operator-provided endpoint',
    purpose: 'Vectorization support for retrieval, similarity, and multimodal indexing without becoming an agent endpoint.',
    status: 'stubbed',
    operatorAction: 'Provide a configured embedding model endpoint and keep API keys outside git.',
  },
  {
    id: 'storage.vector_index',
    kind: 'storage',
    capability: 'persist local embedding vectors for retrieval and similarity search',
    purpose: 'Index artifacts and multimodal domain-agent content without becoming execution-agent memory or authority.',
    status: 'stubbed',
    operatorAction: 'Provide a local LanceDB vector directory under the runtime services home; vector storage and retrieval do not use sqlite.',
  },
  {
    id: 'storage.artifact_store',
    kind: 'storage',
    capability: 'persist generated delivery artifacts outside chat messages',
    purpose: 'Share files, rendered HTML, images, and other generated artifacts across agent consumers.',
    status: 'stubbed',
    operatorAction: 'Provide local or remote artifact storage with explicit namespace and retention rules; sqlite is only a local manifest implementation.',
  },
  {
    id: 'storage.record_store',
    kind: 'storage',
    capability: 'persist JSON metadata records by explicit namespace and table name',
    purpose: 'Share RDS-style operational metadata across agent consumers without storing binary object bodies.',
    status: 'stubbed',
    operatorAction: 'Provide local SQLite record metadata storage or a remote record/RDS-style provider; binary objects should use artifact storage.',
  },
  {
    id: 'storage.memory_store',
    kind: 'storage',
    capability: 'persist replayable events, claims, and relationship context by explicit namespace',
    purpose: 'Support evidence-backed memory substrate retrieval without becoming a domain decision or approval system.',
    status: 'stubbed',
    operatorAction: 'Provide local SQLite memory metadata storage under the runtime services home; full authorization and audit governance remain outside local P0.',
  },
];

export function defaultResourceRequirements(): ResourceRequirement[] {
  return DEFAULT_REQUIREMENTS.map(cloneResource);
}

export function createResourceCatalog(overrides: ResourceOverride[] = []): ResourceCatalog {
  const byId = new Map(defaultResourceRequirements().map((resource) => [resource.id, resource]));
  for (const override of overrides) {
    const existing = byId.get(override.id);
    if (!existing) continue;
    byId.set(override.id, {
      ...existing,
      status: override.status,
      provider: override.provider,
      ...(override.evidence ? { evidence: override.evidence.map((item) => ({ ...item })) } : {}),
    });
  }
  return {
    list: () => [...byId.values()].map(cloneResource),
    get: (id) => {
      const resource = byId.get(id);
      return resource ? cloneResource(resource) : undefined;
    },
    require: (id) => {
      const resource = byId.get(id);
      if (!resource) throw new Error(`unknown runtime service resource: ${id}`);
      return cloneResource(resource);
    },
  };
}

export function listMissingResources(catalog: ResourceCatalog): ResourceRequirement[] {
  return catalog.list().filter((resource) => resource.status !== 'available');
}

function cloneResource(resource: ResourceRequirement): ResourceRequirement {
  return {
    ...resource,
    ...(resource.evidence ? { evidence: resource.evidence.map((item) => ({ ...item })) } : {}),
  };
}
