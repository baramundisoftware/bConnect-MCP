/**
 * Server tool registration tests for bconnect-groups-mcp
 *
 * Asserts that listTools() returns exactly 33 group-scoped endpoint query tools.
 * 27 group-type queries + 6 ADUser queries. All tools are read-only GET operations.
 */

import { describe, it, expect } from 'vitest';
import { createServer } from '../index.js';

// ── Expected tool set ──────────────────────────────────────────────────────

const GROUPS_TOOLS = [
  // Logical Group queries (9)
  'list_endpoints_by_logical_group',
  'list_android_endpoints_by_logical_group',
  'list_ios_endpoints_by_logical_group',
  'list_linux_endpoints_by_logical_group',
  'list_mac_endpoints_by_logical_group',
  'list_network_endpoints_by_logical_group',
  'list_windows_endpoints_by_logical_group',
  'list_industrial_endpoints_by_logical_group',
  'list_logical_groups_by_logical_group',
  // Static Group queries (8)
  'list_endpoints_by_static_group',
  'list_android_endpoints_by_static_group',
  'list_ios_endpoints_by_static_group',
  'list_linux_endpoints_by_static_group',
  'list_mac_endpoints_by_static_group',
  'list_network_endpoints_by_static_group',
  'list_windows_endpoints_by_static_group',
  'list_industrial_endpoints_by_static_group',
  // Dynamic Group queries (2)
  'list_endpoints_by_dynamic_group',
  'list_windows_endpoints_by_dynamic_group',
  // Universal Dynamic Group queries (8)
  'list_endpoints_by_universal_dynamic_group',
  'list_android_endpoints_by_universal_dynamic_group',
  'list_ios_endpoints_by_universal_dynamic_group',
  'list_linux_endpoints_by_universal_dynamic_group',
  'list_mac_endpoints_by_universal_dynamic_group',
  'list_network_endpoints_by_universal_dynamic_group',
  'list_windows_endpoints_by_universal_dynamic_group',
  'list_industrial_endpoints_by_universal_dynamic_group',
  // AD User queries (6) — Phase 25 addition
  'list_endpoints_by_ad_user',
  'list_android_endpoints_by_ad_user',
  'list_ios_endpoints_by_ad_user',
  'list_linux_endpoints_by_ad_user',
  'list_mac_endpoints_by_ad_user',
  'list_windows_endpoints_by_ad_user',
] as const;

// Tools from other servers that must NOT be present
const ENDPOINTS_CRUD_TOOLS = [
  'list_endpoints', 'get_endpoint', 'create_endpoint', 'update_endpoint', 'delete_endpoint',
  'patch_endpoint', 'list_android_endpoints', 'list_ios_endpoints', 'list_linux_endpoints',
];
const JOBS_TOOLS = [
  'list_job_definitions', 'get_job_definition', 'create_job_instance', 'list_job_instances',
];
const ASSETS_TOOLS = [
  'list_assets', 'get_asset', 'create_asset', 'update_asset',
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function getToolNames(): Promise<string[]> {
  const { server } = createServer();
  // @ts-expect-error: accessing internal handler for testing
  const result = await server._requestHandlers.get('tools/list')?.({ method: 'tools/list' });
  return (result?.tools ?? []).map((t: { name: string }) => t.name);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('bconnect-groups-mcp server', () => {
  describe('listTools()', () => {
    it('returns exactly 33 group-scoped tools (27 group-type + 6 ADUser)', async () => {
      const toolNames = await getToolNames();
      expect(toolNames).toHaveLength(33);
    });

    it('contains all expected groups tools', async () => {
      const toolNames = await getToolNames();
      for (const tool of GROUPS_TOOLS) {
        expect(toolNames, `Expected tool "${tool}" to be registered`).toContain(tool);
      }
    });

    it('all tools are read-only (no WARNING in descriptions)', async () => {
      const { server } = createServer();
      // @ts-expect-error: accessing internal handler for testing
      const result = await server._requestHandlers.get('tools/list')?.({ method: 'tools/list' });
      const tools = result?.tools ?? [];
      for (const tool of tools) {
        expect(
          tool.description,
          `Tool "${tool.name}" must not contain WARNING (read-only server)`
        ).not.toMatch(/WARNING/i);
      }
    });

    it('does not contain endpoints CRUD tools', async () => {
      const toolNames = await getToolNames();
      for (const forbidden of ENDPOINTS_CRUD_TOOLS) {
        expect(toolNames, `endpoints CRUD tool "${forbidden}" must NOT be in this server`).not.toContain(forbidden);
      }
    });

    it('does not contain jobs tools', async () => {
      const toolNames = await getToolNames();
      for (const forbidden of JOBS_TOOLS) {
        expect(toolNames, `jobs tool "${forbidden}" must NOT be in this server`).not.toContain(forbidden);
      }
    });

    it('does not contain assets tools', async () => {
      const toolNames = await getToolNames();
      for (const forbidden of ASSETS_TOOLS) {
        expect(toolNames, `assets tool "${forbidden}" must NOT be in this server`).not.toContain(forbidden);
      }
    });

    it('contains no tools outside the groups domain', async () => {
      const toolNames = await getToolNames();
      const unexpected = toolNames.filter(n => !(GROUPS_TOOLS as readonly string[]).includes(n));
      expect(unexpected, `Unexpected tools found: ${unexpected.join(', ')}`).toHaveLength(0);
    });
  });
});
