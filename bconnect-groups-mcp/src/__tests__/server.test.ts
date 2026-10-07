/**
 * Server tool registration tests for bconnect-groups-mcp
 *
 * Asserts that listTools() returns the two group-scoped tools in both releases:
 * list_group_members (group kind, group id, member type) and
 * list_ad_user_endpoints (AD user, endpoint type). They replace the 33 per-kind,
 * per-type tools (REQ-SRV-029, #174); the industrial-endpoint routes are a
 * member type on 25R2 only (#159). All tools are read-only GET operations.
 */

import { describe, it, expect } from 'vitest';
import { createServer } from '../index.js';

// ── Expected tool set ──────────────────────────────────────────────────────

const GROUPS_TOOLS = ['list_group_members', 'list_ad_user_endpoints'] as const;

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
    it('returns exactly the 2 group-scoped tools on 26R1 and on 25R2', async () => {
      expect([...await getToolNames()].sort()).toEqual([...GROUPS_TOOLS].sort());
      const before = process.env.BCONNECT_RELEASE;
      process.env.BCONNECT_RELEASE = '25R2';
      try {
        expect([...await getToolNames()].sort()).toEqual([...GROUPS_TOOLS].sort());
      } finally {
        if (before === undefined) {delete process.env.BCONNECT_RELEASE;} else {process.env.BCONNECT_RELEASE = before;}
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
