/**
 * Tool-registration tests for bconnect-groups-mcp — after the TOK-22 collapse.
 *
 * This server used to advertise ONE operation ("list the members of type T held
 * by container C") as 33 tools: a {logical, static, dynamic, universalDynamic,
 * adUser} x {any, android, ios, linux, mac, network, windows, industrial,
 * child-groups} matrix. Measured on the built `createServer`, that surface was
 * 33 tools / 29,764 bytes of tools/list for 3,189 bytes of description text.
 *
 * It is now two enum-parameterised tools. These tests pin three things:
 *
 *   1. the two new names are advertised and every one of the 33 old names is
 *      GONE from the catalogue (this is a breaking change and the assertion has
 *      to say so out loud, not just count to two);
 *   2. no route was lost in the collapse — `routeCount()` is still 33, and
 *      `dispatch.test.ts` proves each one is reachable;
 *   3. the saving is real and measured the same way EVAL-2026-08-02.md measured
 *      it, so it cannot silently regress into a second matrix.
 */

import { describe, it, expect } from 'vitest';
import { PAGE_DESCRIPTION } from '@bconnect/mcp-core';
import { createServer, TOOLS, TOOL_CATALOGUE } from '../index.js';
import {
  GROUP_KINDS,
  MEMBER_TYPES,
  explainRemovedMemberType,
  routeCount,
  supportedMemberTypes,
} from '../utils/group-member-matrix.js';
import { validateToolParameters } from '../utils/mcp-tool-validation-rules.js';

// ── The surface as it is now ───────────────────────────────────────────────

const EXPECTED_TOOLS = ['list_group_members', 'list_ad_user_endpoints'] as const;

/**
 * Every tool name this server advertised before TOK-22. None may come back:
 * a client that still calls one must get MethodNotFound, not a half-migrated
 * surface where some of the matrix survives.
 */
const REMOVED_TOOLS = [
  'list_endpoints_by_logical_group',
  'list_android_endpoints_by_logical_group',
  'list_ios_endpoints_by_logical_group',
  'list_linux_endpoints_by_logical_group',
  'list_mac_endpoints_by_logical_group',
  'list_network_endpoints_by_logical_group',
  'list_windows_endpoints_by_logical_group',
  'list_industrial_endpoints_by_logical_group',
  'list_logical_groups_by_logical_group',
  'list_endpoints_by_static_group',
  'list_android_endpoints_by_static_group',
  'list_ios_endpoints_by_static_group',
  'list_linux_endpoints_by_static_group',
  'list_mac_endpoints_by_static_group',
  'list_network_endpoints_by_static_group',
  'list_windows_endpoints_by_static_group',
  'list_industrial_endpoints_by_static_group',
  'list_endpoints_by_dynamic_group',
  'list_windows_endpoints_by_dynamic_group',
  'list_endpoints_by_universal_dynamic_group',
  'list_android_endpoints_by_universal_dynamic_group',
  'list_ios_endpoints_by_universal_dynamic_group',
  'list_linux_endpoints_by_universal_dynamic_group',
  'list_mac_endpoints_by_universal_dynamic_group',
  'list_network_endpoints_by_universal_dynamic_group',
  'list_windows_endpoints_by_universal_dynamic_group',
  'list_industrial_endpoints_by_universal_dynamic_group',
  'list_endpoints_by_ad_user',
  'list_android_endpoints_by_ad_user',
  'list_ios_endpoints_by_ad_user',
  'list_linux_endpoints_by_ad_user',
  'list_mac_endpoints_by_ad_user',
  'list_windows_endpoints_by_ad_user',
] as const;

/**
 * The pre-collapse catalogue, measured with the method EVAL-2026-08-02.md used:
 * import the built `createServer`, serialise the tools/list result. The eval
 * recorded 29,698 B against a slightly earlier tree; this run measured 29,764 B
 * on the commit this change starts from, and that is the number the saving
 * below is computed against.
 */
const BEFORE_BYTES = 29_764;
const BEFORE_TOOLS = 33;

/**
 * MIGRATED (Decision 1). The three tools in `REMOVED_TOOLS` that named an
 * IndustrialEndpoints route are removed for a SECOND, different reason, and the
 * distinction is the whole point of keeping this list.
 *
 * The other 30 are gone because TOK-22 collapsed them into two enums: the
 * capability survives and `routeCount()` proves it. These three are gone
 * because bConnect 26R1 deleted the IndustrialEndpoints API — the capability
 * does not survive, cannot be reached by any spelling, and `routeCount()` must
 * NOT count them. A test that lumped them together would go green if someone
 * later "restored" an industrial route that 404s.
 */
const REMOVED_BY_26R1 = [
  'list_industrial_endpoints_by_logical_group',
  'list_industrial_endpoints_by_static_group',
  'list_industrial_endpoints_by_universal_dynamic_group',
] as const;

/** What the collapse actually still serves: 33 minus the three 26R1 deleted. */
const COLLAPSED_ROUTES = BEFORE_TOOLS - REMOVED_BY_26R1.length;

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

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

async function listTools(): Promise<ToolDef[]> {
  const { server } = createServer();
  // @ts-expect-error: accessing internal handler for testing
  const result = await server._requestHandlers.get('tools/list')?.({ method: 'tools/list' });
  return (result?.tools ?? []) as ToolDef[];
}

async function getToolNames(): Promise<string[]> {
  return (await listTools()).map((t) => t.name);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('bconnect-groups-mcp server', () => {
  describe('listTools() after the TOK-22 collapse', () => {
    it('advertises exactly the two enum-parameterised tools', async () => {
      const toolNames = await getToolNames();
      expect(toolNames).toEqual([...EXPECTED_TOOLS]);
    });

    it('no longer advertises any of the 33 collapsed tool names', async () => {
      const toolNames = await getToolNames();
      const survivors = REMOVED_TOOLS.filter((name) => toolNames.includes(name));
      expect(
        survivors,
        'these pre-collapse names are still advertised — the matrix has partially ' +
          'come back, and a client cannot tell which half is authoritative'
      ).toEqual([]);
    });

    it('covers every collapsed route — the collapse removed names, not capability', () => {
      // MIGRATED: was `toBe(REMOVED_TOOLS.length)` / `toBe(33)`. 26R1 deleted the
      // three IndustrialEndpoints routes, so 30 is the honest count and the
      // arithmetic is spelt out rather than a new magic number.
      expect(routeCount()).toBe(COLLAPSED_ROUTES);
      expect(routeCount()).toBe(REMOVED_TOOLS.length - REMOVED_BY_26R1.length);
      expect(routeCount()).toBe(30);
    });

    it('serves no industrial route at all: 26R1 removed the API', () => {
      // The inverse of the migrated assertion above. Without it, re-adding
      // `industrial:` to the matrix would only move a number, and this file
      // would still pass.
      for (const kind of GROUP_KINDS) {
        expect(
          supportedMemberTypes(kind),
          `groupKind '${kind}' still offers an industrial member type`
        ).not.toContain('industrial');
      }
      expect((MEMBER_TYPES as readonly string[])).not.toContain('industrial');
      expect(explainRemovedMemberType('industrial')).toMatch(/26R1 removed the/);
      expect(explainRemovedMemberType('android')).toBeUndefined();
    });

    it('names the removed member type in the enum nowhere, but explains it on call (Decision 4)', async () => {
      const memberType = (await listTools()).find((t) => t.name === 'list_group_members')
        ?.inputSchema?.properties?.memberType as { enum?: string[] } | undefined;
      expect(memberType?.enum).not.toContain('industrial');

      // A caller written against v26.1.7 must get the reason, not "did you mean".
      let message = '';
      try {
        validateToolParameters('list_group_members', {
          groupKind: 'logical',
          groupId: '11111111-2222-3333-4444-555555555555',
          memberType: 'industrial',
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('bConnect 26R1 removed the');
      expect(message).toContain('IndustrialEndpoints');
      // Not the generic enum complaint, which reads as a spelling mistake.
      expect(message).not.toMatch(/must be one of/i);
    });

    it('all tools are read-only (no WARNING in descriptions)', async () => {
      for (const tool of await listTools()) {
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
      const unexpected = toolNames.filter((n) => !(EXPECTED_TOOLS as readonly string[]).includes(n));
      expect(unexpected, `Unexpected tools found: ${unexpected.join(', ')}`).toHaveLength(0);
    });
  });

  describe('the schemas the two tools advertise', () => {
    it('list_group_members declares both enums, the id, pagination, the filter union, countOnly and the shaping flags', async () => {
      const tool = (await listTools()).find((t) => t.name === 'list_group_members');
      expect(Object.keys(tool?.inputSchema?.properties ?? {}).sort()).toEqual(
        [
          'Dip', 'DisplayName', 'Domain', 'EntraIdDeviceId', 'HostName', 'Name',
          'OrderBy', 'Page', 'PageSize', 'SearchQuery',
          'countOnly', 'groupId', 'groupKind', 'includeSubfolders', 'memberType',
          // Added with the compact projection. They are not optional extras:
          // `assertKnownParameters` refuses any key the schema does not declare,
          // so without these two the projection's own "Pass detail:true for the
          // full API record" hint would be false the first time it was followed.
          'detail', 'fields',
        ].sort()
      );
      expect(tool?.inputSchema?.required).toEqual(['groupKind', 'groupId']);
    });

    it('list_ad_user_endpoints omits the group-only filters and includeSubfolders', async () => {
      const tool = (await listTools()).find((t) => t.name === 'list_ad_user_endpoints');
      const props = Object.keys(tool?.inputSchema?.properties ?? {});
      expect(props).not.toContain('Name');
      expect(props).not.toContain('Dip');
      expect(props).not.toContain('includeSubfolders');
      expect(props).toContain('endpointType');
      expect(props).toContain('countOnly');
      expect(tool?.inputSchema?.required).toEqual(['adUserId']);
    });

    it('the enums carry their allowed values (D6: a bad enum value is a 400, a bad parameter is a silent 200)', async () => {
      const tools = await listTools();
      const groupKind = (tools.find((t) => t.name === 'list_group_members')
        ?.inputSchema?.properties?.groupKind ?? {}) as { enum?: string[] };
      expect(groupKind.enum).toEqual(['logical', 'static', 'dynamic', 'universalDynamic']);

      const endpointType = (tools.find((t) => t.name === 'list_ad_user_endpoints')
        ?.inputSchema?.properties?.endpointType ?? {}) as { enum?: string[] };
      expect(endpointType.enum).toEqual(['endpoints', 'android', 'ios', 'linux', 'mac', 'windows']);
    });

    it('uses the canonical zero-indexed Page wording from mcp-core, not the 94-char OpenAPI sentence', async () => {
      // MIGRATED (finding C). This used to assert the literal
      // 'Zero-indexed page number (default 0).'. mcp-core shortened
      // PAGE_DESCRIPTION to 'Page number, 0-based (default 0).' — 37 B -> 33 B
      // across 62 uses — and the literal made this test fail for a change that
      // was correct. What the test is actually for is that the wording comes
      // from ONE place and still says zero-indexed, so it now asserts the
      // exported constant and the two facts, not the spelling.
      for (const tool of await listTools()) {
        const page = (tool.inputSchema?.properties?.Page ?? {}) as { description?: string };
        expect(page.description).toBe(PAGE_DESCRIPTION);
        expect(page.description).toMatch(/0-based|zero-indexed/i);
        expect(page.description).not.toMatch(/1-based/i);
      }
    });
  });

  describe('TOK-20 — the write gate', () => {
    it('declares no write tools: this server is GET-only', () => {
      expect([...TOOL_CATALOGUE.writeToolNames]).toEqual([]);
      expect(TOOL_CATALOGUE.readToolNames.size).toBe(TOOLS.length);
    });

    it('advertises the same surface whether ALLOW_WRITE_OPERATIONS is set or not', () => {
      const shut = TOOL_CATALOGUE.listTools({} as NodeJS.ProcessEnv);
      const open = TOOL_CATALOGUE.listTools({ ALLOW_WRITE_OPERATIONS: 'true' } as NodeJS.ProcessEnv);
      expect(JSON.stringify(open)).toBe(JSON.stringify(shut));
    });

    it('gates nothing, because there is nothing to gate', () => {
      for (const tool of TOOLS) {
        expect(TOOL_CATALOGUE.gateWriteTool(tool.name, {} as NodeJS.ProcessEnv)).toBeUndefined();
      }
    });
  });

  describe('TOK-22 — the measured saving', () => {
    it('the tools/list payload is at least 80% smaller than the 33-tool matrix', async () => {
      const bytes = Buffer.byteLength(JSON.stringify(await listTools()), 'utf8');
      const saved = BEFORE_BYTES - bytes;
      expect(
        bytes,
        `tools/list is ${bytes} B; the 33-tool matrix was ${BEFORE_BYTES} B`
      ).toBeLessThan(BEFORE_BYTES * 0.2);
      expect(saved).toBeGreaterThan(20_000);
    });

    it('description text is now most of the payload, not a rounding error in it', async () => {
      const tools = await listTools();
      const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
      // Counts PARAMETER descriptions as well as tool descriptions, which is
      // what "description text" in this test's own sentence means. It used to
      // count only the tool-level string, and that made it read the id-producer
      // annotation (INT4-12) — prose added to parameter descriptions — as if it
      // were schema bloat: the denominator grew, the numerator did not, and the
      // ratio fell through the floor while the thing the floor exists to catch
      // had not happened at all.
      const descBytes = tools.reduce((n, t) => {
        const params = Object.values(
          (t.inputSchema as { properties?: Record<string, { description?: string }> })
            ?.properties ?? {}
        );
        return (
          n +
          Buffer.byteLength(t.description ?? '', 'utf8') +
          params.reduce((m, p) => m + Buffer.byteLength(p?.description ?? '', 'utf8'), 0)
        );
      }, 0);
      // Before: 3,189 B of description inside 29,764 B of payload — 10.7%. The
      // other 89% was 33 copies of one schema.
      expect(descBytes / bytes).toBeGreaterThan(0.25);
    });
  });
});
