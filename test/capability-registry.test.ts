import { describe, expect, test } from 'vitest';
import {
  RUNTIME_SERVICE_AGENT_SERVICE_CAPABILITIES,
  RUNTIME_SERVICE_CAPABILITIES,
  RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS,
  RUNTIME_SERVICE_CAPABILITY_REVISION,
  RUNTIME_SERVICE_CAPABILITY_SCHEMA_VERSION,
} from '../src/capabilities/registry';
import { listMcpToolsFromRegistry } from '../src/mcp/mapper';

describe('capability registry', () => {
  test('is the single source for RPC capability descriptors', () => {
    expect(RUNTIME_SERVICE_CAPABILITIES).toEqual([
      'language.complete',
      'embedding.create',
      'vision.generateImage',
      'artifact.save',
      'artifact.get',
      'artifact.list',
      'artifact.cleanupExpired',
      'record.upsert',
      'record.get',
      'record.query',
      'record.delete',
      'memory.event.append',
      'memory.event.get',
      'memory.event.list',
      'memory.claim.upsert',
      'memory.claim.get',
      'memory.claim.query',
      'memory.relation.upsert',
      'memory.relation.query',
      'memory.context.retrieve',
      'vector.upsert',
      'vector.search',
      'resources.list',
      'resources.doctor',
      'resources.smoke',
      'resources.status',
    ]);

    expect(RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'language.complete',
        domain: 'models',
        serviceLayer: 'runtime-core',
        risk: 'external-provider',
        request: expect.objectContaining({
          required: ['input'],
          inputSchema: expect.objectContaining({
            type: 'object',
            required: ['input'],
          }),
        }),
        authority: {
          domainDecision: false,
          approval: false,
          toolChoice: false,
          sessionMutation: false,
        },
      }),
      expect.objectContaining({
        id: 'embedding.create',
        domain: 'models',
        risk: 'external-provider',
        request: expect.objectContaining({
          required: ['input'],
          inputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              input: expect.objectContaining({
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' }, minItems: 1 },
                ],
              }),
            }),
          }),
        }),
      }),
      expect.objectContaining({
        id: 'artifact.save',
        domain: 'storage',
        risk: 'write-local',
        request: expect.objectContaining({
          required: ['namespace'],
          inputSchema: expect.objectContaining({
            required: ['namespace'],
            oneOf: [
              { required: ['body', 'mimeType'] },
              { required: ['sourceUrl'] },
            ],
          }),
        }),
        effects: expect.objectContaining({ runtimeHome: 'write' }),
      }),
      expect.objectContaining({
        id: 'artifact.get',
        domain: 'storage',
        risk: 'read',
        request: expect.objectContaining({
          required: ['namespace', 'id'],
        }),
        effects: expect.objectContaining({ runtimeHome: 'read' }),
      }),
      expect.objectContaining({
        id: 'record.upsert',
        domain: 'storage',
        risk: 'write-local',
        request: expect.objectContaining({
          required: ['namespace', 'tableName', 'id', 'data'],
        }),
        effects: expect.objectContaining({ runtimeHome: 'write' }),
      }),
      expect.objectContaining({
        id: 'record.get',
        domain: 'storage',
        risk: 'read',
        request: expect.objectContaining({
          required: ['namespace', 'tableName', 'id'],
        }),
        effects: expect.objectContaining({ runtimeHome: 'read' }),
      }),
      expect.objectContaining({
        id: 'record.query',
        domain: 'storage',
        risk: 'read',
        request: expect.objectContaining({
          required: ['namespace', 'tableName'],
        }),
        effects: expect.objectContaining({ runtimeHome: 'read' }),
      }),
      expect.objectContaining({
        id: 'record.delete',
        domain: 'storage',
        risk: 'write-local',
        request: expect.objectContaining({
          required: ['namespace', 'tableName', 'id'],
        }),
        effects: expect.objectContaining({ runtimeHome: 'write' }),
      }),
      expect.objectContaining({
        id: 'memory.event.append',
        domain: 'memory',
        risk: 'write-local',
        request: expect.objectContaining({
          required: ['namespace', 'source'],
          inputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              source: expect.objectContaining({
                required: ['kind', 'ref'],
              }),
              artifact: expect.objectContaining({
                required: ['kind', 'id'],
                additionalProperties: false,
              }),
            }),
          }),
        }),
        effects: expect.objectContaining({ runtimeHome: 'write' }),
      }),
      expect.objectContaining({
        id: 'memory.claim.upsert',
        domain: 'memory',
        risk: 'write-local',
        request: expect.objectContaining({
          required: ['namespace', 'id', 'kind', 'subject', 'statement', 'evidence', 'confidence'],
          inputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              evidence: expect.objectContaining({
                items: expect.objectContaining({
                  required: ['kind', 'id'],
                  additionalProperties: false,
                  properties: expect.objectContaining({
                    range: expect.objectContaining({ type: 'object' }),
                  }),
                }),
              }),
            }),
          }),
        }),
        effects: expect.objectContaining({ runtimeHome: 'write' }),
      }),
      expect.objectContaining({
        id: 'memory.relation.upsert',
        domain: 'memory',
        risk: 'write-local',
        request: expect.objectContaining({
          required: ['namespace', 'id', 'type', 'from', 'to'],
          inputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              from: expect.objectContaining({
                required: ['kind', 'id'],
                additionalProperties: false,
              }),
              to: expect.objectContaining({
                required: ['kind', 'id'],
                additionalProperties: false,
              }),
              evidence: expect.objectContaining({
                items: expect.objectContaining({
                  required: ['kind', 'id'],
                  additionalProperties: false,
                }),
              }),
            }),
          }),
        }),
      }),
      expect.objectContaining({
        id: 'memory.relation.query',
        domain: 'memory',
        risk: 'read',
        request: expect.objectContaining({
          required: ['namespace'],
          inputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              from: expect.objectContaining({
                required: ['kind', 'id'],
                additionalProperties: false,
              }),
              to: expect.objectContaining({
                required: ['kind', 'id'],
                additionalProperties: false,
              }),
            }),
          }),
        }),
      }),
      expect.objectContaining({
        id: 'memory.context.retrieve',
        domain: 'memory',
        serviceLayer: 'agent-service',
        risk: 'external-provider',
        request: expect.objectContaining({
          required: ['namespace', 'tableName'],
          inputSchema: expect.objectContaining({
            additionalProperties: false,
            properties: expect.objectContaining({
              filter: expect.objectContaining({
                additionalProperties: false,
                properties: expect.objectContaining({
                  metadata: expect.objectContaining({
                    type: 'object',
                    additionalProperties: {
                      oneOf: [
                        { type: 'string' },
                        { type: 'number' },
                        { type: 'boolean' },
                      ],
                    },
                  }),
                }),
              }),
            }),
          }),
        }),
        effects: expect.objectContaining({ runtimeHome: 'read', network: 'provider', modelCall: true }),
        authority: {
          domainDecision: false,
          approval: false,
          toolChoice: false,
          sessionMutation: false,
        },
      }),
      expect.objectContaining({
        id: 'vector.upsert',
        domain: 'storage',
        serviceLayer: 'runtime-core',
        risk: 'write-local',
        request: expect.objectContaining({
          required: ['tableName', 'id', 'content', 'embedding'],
        }),
      }),
      expect.objectContaining({
        id: 'vector.search',
        domain: 'storage',
        risk: 'external-provider',
        request: expect.objectContaining({
          required: ['tableName'],
          inputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              filter: expect.objectContaining({
                properties: expect.objectContaining({
                  metadata: expect.objectContaining({
                    type: 'object',
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
      expect.objectContaining({
        id: 'resources.status',
        domain: 'resources',
        risk: 'read',
        effects: expect.objectContaining({ runtimeHome: 'read' }),
      }),
    ]));

    expect(RUNTIME_SERVICE_CAPABILITY_SCHEMA_VERSION).toBe(2);
    expect(RUNTIME_SERVICE_CAPABILITY_REVISION).toMatch(/^[a-f0-9]{16}$/);
  });

  test('classifies public capabilities into Runtime Core and Agent Services', () => {
    const layerById = new Map(RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS.map((descriptor) => [
      descriptor.id,
      descriptor.serviceLayer,
    ]));
    const agentServiceIds = new Set<string>(RUNTIME_SERVICE_AGENT_SERVICE_CAPABILITIES);

    expect(RUNTIME_SERVICE_AGENT_SERVICE_CAPABILITIES).toEqual([
      'memory.event.append',
      'memory.event.get',
      'memory.event.list',
      'memory.claim.upsert',
      'memory.claim.get',
      'memory.claim.query',
      'memory.relation.upsert',
      'memory.relation.query',
      'memory.context.retrieve',
    ]);
    for (const id of RUNTIME_SERVICE_CAPABILITIES) {
      expect(layerById.get(id), id).toBe(agentServiceIds.has(id) ? 'agent-service' : 'runtime-core');
    }
    expect(layerById.get('health')).toBe('runtime-core');
    expect(layerById.get('capabilities.describe')).toBe('runtime-core');
    expect(RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS
      .filter((descriptor) => descriptor.serviceLayer === 'agent-service')
      .map((descriptor) => descriptor.id)).toEqual([...RUNTIME_SERVICE_AGENT_SERVICE_CAPABILITIES]);
  });

  test('keeps every top-level request schema closed for agent planning', () => {
    for (const descriptor of RUNTIME_SERVICE_CAPABILITY_DESCRIPTORS) {
      expect(descriptor.request.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
    }
  });

  test('maps registry capabilities to MCP tools only through an explicit allowlist', () => {
    expect(listMcpToolsFromRegistry()).toEqual([]);

    const readTools = listMcpToolsFromRegistry({
      allowedCapabilityIds: ['resources.status', 'artifact.list'],
    });
    expect(readTools).toEqual([
      expect.objectContaining({
        name: 'resources_status',
        title: 'resources.status',
        description: expect.stringContaining('Service layer: runtime-core.'),
        inputSchema: expect.objectContaining({ type: 'object' }),
        annotations: expect.objectContaining({ readOnlyHint: true }),
      }),
      expect.objectContaining({
        name: 'artifact_list',
        title: 'artifact.list',
        annotations: expect.objectContaining({ readOnlyHint: true }),
      }),
    ]);
    expect(readTools.map((tool) => tool.name)).not.toContain('vision_generateImage');

    const memoryTools = listMcpToolsFromRegistry({
      allowedCapabilityIds: ['memory.context.retrieve'],
    });
    expect(memoryTools).toEqual([
      expect.objectContaining({
        name: 'memory_context_retrieve',
        title: 'memory.context.retrieve',
        description: expect.stringContaining('Service layer: agent-service.'),
      }),
    ]);

    const providerTools = listMcpToolsFromRegistry({
      allowedCapabilityIds: ['vision.generateImage'],
    });
    expect(providerTools).toEqual([
      expect.objectContaining({
        name: 'vision_generateImage',
        title: 'vision.generateImage',
        inputSchema: expect.objectContaining({
          required: ['prompt'],
        }),
        annotations: expect.objectContaining({
          readOnlyHint: false,
          openWorldHint: true,
        }),
      }),
    ]);
  });
});
