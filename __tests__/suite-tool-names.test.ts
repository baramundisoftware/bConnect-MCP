/**
 * Suite-wide tool-name assertions — D23.
 *
 * Every other test in this repo checks one server in isolation, which is
 * exactly why D23 survived: `bconnect-endpoints-mcp` and `bconnect-groups-mcp`
 * each expose `list_endpoints_by_logical_group` and
 * `list_windows_endpoints_by_logical_group`, and nothing anywhere compared the
 * two. With both servers enabled a client sees duplicate names and must
 * disambiguate by server.
 *
 * Worse, the copies had drifted apart: the endpoints-mcp copy carried the
 * misspelled `includeSubGroups` parameter (D14a) that the API silently ignores,
 * while the groups-mcp copy had no hierarchy parameter at all — so the same
 * question, asked through two identically-named tools, was answered by two
 * implementations with two different bugs.
 *
 * This file does not merge the servers (that is an upstream decision). It
 * pins the situation so it cannot get worse:
 *
 *   1. The set of colliding names is exactly the two known ones. A new
 *      collision fails here rather than being discovered by a client.
 *   2. Colliding tools must expose the SAME parameter set. This is the D23
 *      drift half, and it is the assertion that would have caught D14a: after
 *      the fix both copies declare `includeSubfolders` and neither declares
 *      `includeSubGroups`.
 */

import { describe, it, expect } from 'vitest';

// Servers that register tools. The gateway re-exports these rather than
// defining its own, so it is deliberately not listed. Imports are written out
// one per server because the bundler cannot resolve a fully dynamic specifier
// — which also means a new server has to be added here deliberately.
const SERVERS: Record<string, () => Promise<{ createServer: () => { server: unknown } }>> = {
  activedirectory: () => import('../bconnect-activedirectory-mcp/src/index.js'),
  assets: () => import('../bconnect-assets-mcp/src/index.js'),
  compliance: () => import('../bconnect-compliance-mcp/src/index.js'),
  defensecontrol: () => import('../bconnect-defensecontrol-mcp/src/index.js'),
  endpoints: () => import('../bconnect-endpoints-mcp/src/index.js'),
  groups: () => import('../bconnect-groups-mcp/src/index.js'),
  jobs: () => import('../bconnect-jobs-mcp/src/index.js'),
  operatingsystems: () => import('../bconnect-operatingsystems-mcp/src/index.js'),
  servermanagement: () => import('../bconnect-servermanagement-mcp/src/index.js'),
  software: () => import('../bconnect-software-mcp/src/index.js'),
  universaldynamicgroups: () => import('../bconnect-universaldynamicgroups-mcp/src/index.js'),
  updatemanagement: () => import('../bconnect-updatemanagement-mcp/src/index.js'),
  variables: () => import('../bconnect-variables-mcp/src/index.js'),
};

/**
 * Known, accepted duplicates as of this commit. This list may only ever
 * shrink. Adding to it means shipping another ambiguous name to clients, and
 * should be a conscious upstream decision, not a test edit.
 */
const KNOWN_COLLISIONS = [] as const;

interface ToolDef { name: string; inputSchema?: { properties?: Record<string, unknown> } }

async function toolsOf(load: () => Promise<{ createServer: () => { server: unknown } }>): Promise<ToolDef[]> {
  const mod = await load();
  const { server } = mod.createServer();
  // Accessing the internal handler for testing, as the per-server suites do.
  const handler = (server as { _requestHandlers: Map<string, (r: unknown) => Promise<{ tools?: ToolDef[] }>> })
    ._requestHandlers.get('tools/list');
  const result = await handler?.({ method: 'tools/list' });
  return result?.tools ?? [];
}

/**
 * Enumerate with EVERY gate open.
 *
 * A colliding name is ambiguous to a client whenever both tools are visible, and
 * which tools are visible is a deployment choice — so checking only the default
 * posture would let a collision ship as long as it needed a gate to be seen. The
 * write gate hides 80 tools and `BCONNECT_ENABLE_V11` hides the v1.1 slice; both
 * are opened here, with stub v1.1 credentials because that gate needs them
 * present as well as enabled.
 */
async function withEveryGateOpen<T>(fn: () => Promise<T>): Promise<T> {
  const keys = [
    'ALLOW_WRITE_OPERATIONS', 'BCONNECT_ENABLE_V11',
    'BCONNECT_V11_USERNAME', 'BCONNECT_V11_PASSWORD', 'VITEST',
  ] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
  process.env.BCONNECT_ENABLE_V11 = 'true';
  process.env.BCONNECT_V11_USERNAME = 'collision-probe@example.invalid';
  process.env.BCONNECT_V11_PASSWORD = 'collision-probe';
  process.env.VITEST = '1';
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) {delete process.env[k];}
      else {process.env[k] = saved[k] as string;}
    }
  }
}

async function collectAll(): Promise<Map<string, { server: string; tool: ToolDef }[]>> {
  const byName = new Map<string, { server: string; tool: ToolDef }[]>();
  for (const [s, load] of Object.entries(SERVERS)) {
    for (const tool of await toolsOf(load)) {
      const list = byName.get(tool.name) ?? [];
      list.push({ server: s, tool });
      byName.set(tool.name, list);
    }
  }
  return byName;
}

describe('D23 — tool names across the suite', () => {
  it('has no colliding tool name beyond the known, documented pair', async () => {
    const byName = await withEveryGateOpen(collectAll);
    const collisions = [...byName.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([name, owners]) => `${name} (${owners.map((o) => o.server).join(', ')})`);

    const unexpected = collisions.filter(
      (c) => !KNOWN_COLLISIONS.some((k) => c.startsWith(`${k} (`))
    );
    expect(
      unexpected,
      'A tool name is registered by more than one server. With both enabled a ' +
      'client cannot tell them apart. Rename one, or generate both from a ' +
      'single definition — do not extend KNOWN_COLLISIONS.'
    ).toEqual([]);
  });

  it('every known collision is still an actual collision (the list has not gone stale)', async () => {
    const byName = await withEveryGateOpen(collectAll);
    for (const name of KNOWN_COLLISIONS) {
      expect(
        (byName.get(name) ?? []).length,
        `"${name}" is no longer duplicated — remove it from KNOWN_COLLISIONS.`
      ).toBeGreaterThan(1);
    }
  });

  it('colliding tools expose identical parameter sets (D23 drift / D14a)', async () => {
    const byName = await withEveryGateOpen(collectAll);
    for (const name of KNOWN_COLLISIONS) {
      const owners = byName.get(name) ?? [];
      const sets = owners.map((o) => ({
        server: o.server,
        params: Object.keys(o.tool.inputSchema?.properties ?? {}).sort(),
      }));
      const reference = sets[0];
      for (const other of sets.slice(1)) {
        expect(
          other.params,
          `"${name}" declares different parameters in bconnect-${reference.server}-mcp ` +
          `(${reference.params.join(', ')}) and bconnect-${other.server}-mcp ` +
          `(${other.params.join(', ')}). Two tools with one name must not answer ` +
          'the same question differently.'
        ).toEqual(reference.params);
      }
    }
  });

  it('no tool anywhere advertises includeSubGroups — the API declares includeSubfolders (D14a)', async () => {
    const byName = await withEveryGateOpen(collectAll);
    const offenders: string[] = [];
    for (const owners of byName.values()) {
      for (const { server, tool } of owners) {
        if (Object.keys(tool.inputSchema?.properties ?? {}).includes('includeSubGroups')) {
          offenders.push(`bconnect-${server}-mcp/${tool.name}`);
        }
      }
    }
    expect(
      offenders,
      'includeSubGroups is not a parameter this API declares. Per D6 it is ' +
      'silently dropped and the call returns HTTP 200 with the un-traversed ' +
      'result, so the tool reports an empty group as empty when it is not.'
    ).toEqual([]);
  });
});
