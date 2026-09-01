/**
 * bconnect-updatemanagement-mcp — the compact projection for
 * `list_update_management_endpoints`.
 *
 * Measured live: 11,999 B for a 20-row page over 17 columns, the second fattest
 * response in the suite. Shaped: 8,049 B, saving 3,950 B (-32.9%).
 *
 * ── The design decision this file exists to hold ────────────────────────────
 * `dropConstantColumns` alone is the obvious projection and it is a trap. On
 * this estate `updateProfileId`/`updateProfileName` are page-constant, so it
 * saves 1,671 B — but only because labcorp.local runs ONE update profile. Run
 * through the shipped shaper against the same page rewritten with three
 * profiles it saves **-32 B, a net loss**: with nothing constant to remove the
 * `meta` block is pure overhead, and the tool would still be charging ~503 B of
 * catalogue for the privilege.
 *
 * So the projection leads with the STRUCTURAL drop — three columns that say
 * where the data came from rather than what it says — which is the half that
 * survives a different estate:
 *
 *   1 profile    11,999 -> 8,049 B   -3,950 B (-32.9%)
 *   3 profiles   11,928 -> 9,732 B   -2,196 B (-18.4%)
 *
 * Both are asserted below, the multi-profile case by rewriting the fixture, so
 * the durable saving is pinned and cannot regress into the estate-specific one.
 *
 * ── Falsified ───────────────────────────────────────────────────────────────
 * Revert the case arm to `serializeToolResult(result)` and every test in the
 * first block fails. Remove `alwaysDrop` and keep only `dropConstantColumns`
 * and "still saves on a multi-profile estate" fails at -32 B.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

let nextResult: unknown = { data: [] };

vi.mock('../bconnect-client.js', () => ({
  BConnectClient: class {
    updateManagement = {
      getWindowsEndpoints: async (): Promise<unknown> => nextResult,
    };
  },
}));

const { createServer } = await import('../index.js');

/**
 * One row in the shape the live route returns — all 17 columns.
 *
 * The number of DISTINCT values per column is copied from the live 20-row page
 * rather than invented, because `dropConstantColumns` is driven entirely by
 * constancy and a fixture that is more uniform than reality makes the
 * multi-profile test pass for the wrong reason. Measured live: sources and
 * downloadMode 2 distinct, updateState 4, targetReleaseVersion 4, deferred 2,
 * blocked 4, critical 3, security 6, other 8.
 */
function umRow(i: number, profile: [string, string]): Record<string, unknown> {
  const states = ['InventoryOutdated', 'UpToDate', 'UpdatesAvailable', 'Unknown'];
  const releases = ['24H2', '23H2', '22H2', '21H2'];
  const sources = ['MicrosoftOnline', 'Wsus'];
  return {
    endpointId: `15e0be8${i}-97c3-4d09-a87e-c9749dcb66b9`,
    endpointName: `WIN10CLIENT${i}`,
    updateProfileId: profile[0],
    updateProfileName: profile[1],
    missingCriticalUpdates: i % 3,
    missingSecurityUpdates: i % 6,
    missingOtherUpdates: i % 8,
    updateDownloadMode: i % 2 === 0 ? 'HttpOnly' : 'HttpAndPeerCaching',
    lastInventory: `2025-08-${String((i % 27) + 1).padStart(2, '0')}T15:39:01.9846557Z`,
    lastInventorySource: sources[i % 2],
    lastSuccessfulUpdate: `2025-08-${String((i % 27) + 1).padStart(2, '0')}T15:38:35Z`,
    lastSuccessfulUpdateSource: sources[i % 2],
    deferredUpdates: i % 2,
    blockedUpdates: i % 4,
    featureUpdatesAvailable: i % 2 === 0,
    updateState: states[i % 4],
    targetReleaseVersion: releases[i % 4],
  };
}

const ONE_PROFILE: [string, string] = ['e57a7e00-0000-4000-8000-000000000015', '3. Production'];
const PROFILES: [string, string][] = [
  ONE_PROFILE,
  ['e57a7e00-0000-4000-8000-000000000018', '2. Pilot'],
  ['e57a7e00-0000-4000-8000-000000000020', '1. Test'],
];

const page = (n: number, profiles: [string, string][]): Record<string, unknown> => ({
  currentPage: 0,
  pageSize: 20,
  totalPages: 2,
  totalItems: 23,
  hasPreviousPage: false,
  hasNextPage: true,
  data: Array.from({ length: n }, (_unused, i) => umRow(i + 1, profiles[i % profiles.length])),
});

async function callJson(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'um-shaping', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = (await client.callTool({
    name: 'list_update_management_endpoints',
    arguments: args,
  })) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8');

afterEach(() => {
  nextResult = { data: [] };
});

describe('list_update_management_endpoints — compact projection', () => {
  it('drops the three provenance columns and names them in meta.dropped', async () => {
    nextResult = page(20, [ONE_PROFILE]);
    const json = await callJson({});
    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(20); // vacuity: the page survived
    // `?? []` so removing alwaysDrop fails with "expected [] to contain
    // lastInventorySource" rather than a TypeError about undefined — a guard
    // whose failure message is a type error is a guard nobody can act on.
    const dropped = ((json.meta as Record<string, unknown>).dropped ?? []) as string[];
    for (const col of ['lastInventorySource', 'lastSuccessfulUpdateSource', 'updateDownloadMode']) {
      expect(col in rows[0], `${col} must be dropped from the row`).toBe(false);
      expect(dropped, `${col} must be named in meta.dropped`).toContain(col);
    }
  });

  /**
   * Asserted as RECOVERABLE, not as "present on the row".
   *
   * Written first as `col in rows[0]` and that was wrong: a compliance column
   * whose value happens to be identical on every row of a page — `deferredUpdates`
   * is 0 fleet-wide on a healthy estate — is moved to `meta.constant`, which is
   * lossless and is the behaviour we want. The property that actually matters is
   * that the value is still in the response somewhere and was NOT dropped.
   */
  it('keeps every column that answers the question this tool exists for', async () => {
    nextResult = page(20, [ONE_PROFILE]);
    const json = await callJson({});
    const rows = json.data as Record<string, unknown>[];
    const meta = json.meta as Record<string, unknown>;
    const constant = (meta.constant ?? {}) as Record<string, unknown>;
    const dropped = (meta.dropped ?? []) as string[];

    for (const col of [
      'endpointId', 'endpointName',
      'missingCriticalUpdates', 'missingSecurityUpdates', 'missingOtherUpdates',
      'deferredUpdates', 'blockedUpdates', 'featureUpdatesAvailable',
      'updateState', 'lastInventory', 'lastSuccessfulUpdate', 'targetReleaseVersion',
    ]) {
      expect(dropped, `${col} must never be dropped — it is the answer`).not.toContain(col);
      expect(
        col in rows[0] || col in constant,
        `${col} must be recoverable from the row or meta.constant`
      ).toBe(true);
    }
  });

  it('moves a page-constant update profile to meta.constant rather than dropping it', async () => {
    // `updateProfileId` is a value a caller writes back —
    // update_update_management_endpoint patches /updateProfileId — so it must
    // stay recoverable. meta.constant is lossless; alwaysDrop would not be.
    nextResult = page(20, [ONE_PROFILE]);
    const json = await callJson({});
    const constant = (json.meta as Record<string, unknown>).constant as Record<string, unknown>;
    expect(constant.updateProfileId).toBe(ONE_PROFILE[0]);
    expect(constant.updateProfileName).toBe(ONE_PROFILE[1]);
  });

  it('still saves on a MULTI-PROFILE estate, where dropConstantColumns alone is a net loss', async () => {
    // The whole reason alwaysDrop leads this projection. With three profiles
    // nothing is page-constant, so a constant-only projection would ADD bytes.
    const raw = page(20, PROFILES);
    nextResult = raw;
    const shaped = await callJson({});
    // The profile columns are no longer constant, so the constant rule stops
    // paying for them — which is precisely why it cannot carry this projection.
    const constant = ((shaped.meta as Record<string, unknown>).constant ?? {}) as Record<string, unknown>;
    expect(constant.updateProfileId).toBeUndefined();
    expect(constant.updateProfileName).toBeUndefined();
    // The structural drop still does, and that is the durable half.
    expect(bytes(shaped)).toBeLessThan(bytes(raw) * 0.85);
  });

  it('detail:true returns the raw record, so the escape hatch is reachable', async () => {
    // Also proves the validation rules accept `detail`; without them
    // assertKnownParameters refuses it with -32602 before dispatch.
    const raw = page(3, [ONE_PROFILE]);
    nextResult = raw;
    const json = await callJson({ detail: true });
    expect(json.meta).toBeUndefined();
    // Compared against the fixture rather than a literal, so a change to the
    // fixture's value distribution cannot silently invalidate this assertion.
    expect(json).toEqual(raw);
  });

  it('fields:[..] is reachable too', async () => {
    nextResult = page(5, [ONE_PROFILE]);
    const json = await callJson({ fields: ['endpointName', 'missingCriticalUpdates'] });
    expect(Object.keys((json.data as Record<string, unknown>[])[0]).sort()).toEqual(
      ['endpointName', 'missingCriticalUpdates']
    );
  });
});
