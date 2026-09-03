/**
 * Pagination regression tests for preview_assignment (PER-17 / B4).
 *
 * previewAssignment is this suite's blast-radius safety primitive: a human
 * reads `scope.endpointsInReach` and the REFUSE / CONFIRM FIRST verdict before
 * assigning a job across an estate. It used to fetch
 * `/endpoints/v2.0/LogicalGroups` and `/endpoints/v2.0/Endpoints` with
 * `{ PageSize: 1000 }` and no `Page`, then report the row counts as totals —
 * so above one page it told the reader a destructive job was SAFER than it is,
 * and a target group past page 0 made the whole tool throw "not found".
 *
 * These drive the module with a stubbed AxiosInstance that pages, so they fail
 * against the single-page version and pass against the paginated one. No
 * network, no credentials: the v1.1 safety lookup is disabled by stubbing its
 * two env vars empty, which the module reports through `reason` rather than
 * calling out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosInstance } from 'axios';

import { previewAssignment } from '../modules/preview-assignment.js';

const TARGET_GROUP_ID = 'g-target';
const CHILD_GROUP_ID = 'g-child';
const JOB_ID = '11111111-2222-3333-4444-555555555555';

interface GroupRow { id: string; name: string; parentId: string | null }
interface EndpointRow {
  displayName: string;
  logicalGroupId: string;
  lastSeen: string | null;
  isDeactivated?: boolean;
}

/** `count` filler groups that are in nobody's scope. */
function fillerGroups(prefix: string, count: number): GroupRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `${prefix} ${i}`,
    parentId: null,
  }));
}

/** `count` filler endpoints parked in a group that is not under the target. */
function fillerEndpoints(prefix: string, count: number): EndpointRow[] {
  return Array.from({ length: count }, (_, i) => ({
    displayName: `${prefix}-${i}`,
    logicalGroupId: 'g-elsewhere',
    lastSeen: new Date().toISOString(),
  }));
}

function memberEndpoints(prefix: string, count: number, groupId: string): EndpointRow[] {
  return Array.from({ length: count }, (_, i) => ({
    displayName: `${prefix}-${i}`,
    logicalGroupId: groupId,
    lastSeen: new Date().toISOString(),
  }));
}

interface StubPages {
  groupPages: GroupRow[][];
  endpointPages: EndpointRow[][];
  /** Overrides the reported totalPages, to simulate more pages than are served. */
  groupTotalPages?: number;
  endpointTotalPages?: number;
}

/**
 * An AxiosInstance stub that honours the `Page` query parameter. A request
 * with no `Page` is served page 0 — which is exactly how the unpaginated
 * version behaved, so these tests can tell the two apart by the rows they see.
 */
function stubClient(pages: StubPages): { client: AxiosInstance; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(async (url: string, config?: { params?: Record<string, unknown> }) => {
    const page = Number(config?.params?.Page ?? 0);

    if (url.includes('/JobDefinitions/')) {
      return { data: { name: 'Nightly wipe', folder: 'Ops', type: 'Job' } };
    }
    if (url.includes('/LogicalGroups')) {
      return {
        data: {
          data: pages.groupPages[page] ?? [],
          totalPages: pages.groupTotalPages ?? pages.groupPages.length,
        },
      };
    }
    if (url.includes('/Endpoints')) {
      return {
        data: {
          data: pages.endpointPages[page] ?? [],
          totalPages: pages.endpointTotalPages ?? pages.endpointPages.length,
        },
      };
    }
    throw new Error(`unexpected request: ${url}`);
  });

  return {
    get,
    client: { get, defaults: { baseURL: 'https://bms.example.com:443/bconnect' } } as unknown as AxiosInstance,
  };
}

beforeEach(() => {
  // The v1.1 safety lookup accepts Basic auth only and would reach the network.
  // Empty credentials make the module report the verdict as unavailable, which
  // is the code path these tests want.
  vi.stubEnv('BCONNECT_V11_USERNAME', '');
  vi.stubEnv('BCONNECT_V11_PASSWORD', '');
});

describe('preview_assignment — estate reads page through (PER-17 / B4)', () => {
  it('counts endpoints from EVERY page, not just the first 1000', async () => {
    const target: GroupRow = { id: TARGET_GROUP_ID, name: 'Target', parentId: null };
    const child: GroupRow = { id: CHILD_GROUP_ID, name: 'Child', parentId: TARGET_GROUP_ID };

    const { client, get } = stubClient({
      groupPages: [[target, child, ...fillerGroups('gp0', 998)], fillerGroups('gp1', 400)],
      endpointPages: [
        // Page 0 fills the 1000-row page: 3 direct members, 997 unrelated.
        [...memberEndpoints('direct', 3, TARGET_GROUP_ID), ...fillerEndpoints('other0', 997)],
        // Page 1 is the estate the old code never saw.
        [...memberEndpoints('cascaded', 5, CHILD_GROUP_ID), ...fillerEndpoints('other1', 195)],
      ],
    });

    const result = (await previewAssignment(client, {
      jobDefinitionId: JOB_ID,
      logicalGroupId: TARGET_GROUP_ID,
    })) as {
      scope: { directMembers: number; endpointsInReach: number; endpointsOnlineNow: number; descendantGroups: number };
      whatWouldHappen: { instancesExpected: number };
      meta: { estate: { endpoints: { pagesFetched: number; totalPages: number; truncated: boolean } } };
    };

    // 3 direct + 5 in the descendant group, and the 5 are only on page 1.
    expect(result.scope.directMembers).toBe(3);
    expect(result.scope.descendantGroups).toBe(1);
    expect(result.scope.endpointsInReach).toBe(8);
    expect(result.scope.endpointsOnlineNow).toBe(8);
    expect(result.whatWouldHappen.instancesExpected).toBe(8);

    expect(result.meta.estate.endpoints).toMatchObject({
      pagesFetched: 2,
      totalPages: 2,
      truncated: false,
    });

    // Both estate routes were asked for page 1, which the old code never did.
    const endpointPagesRequested = get.mock.calls
      .filter(([url]) => String(url).includes('/Endpoints'))
      .map(([, config]) => (config as { params?: { Page?: number } })?.params?.Page);
    expect(endpointPagesRequested).toEqual([0, 1]);
  });

  it('finds a target group that sits past the first page instead of throwing "not found"', async () => {
    const target: GroupRow = { id: TARGET_GROUP_ID, name: 'Target', parentId: null };

    const { client } = stubClient({
      // The target is on page 1. Unpaginated, the lookup threw.
      groupPages: [fillerGroups('gp0', 1000), [target, ...fillerGroups('gp1', 100)]],
      endpointPages: [memberEndpoints('direct', 4, TARGET_GROUP_ID)],
    });

    const result = (await previewAssignment(client, {
      jobDefinitionId: JOB_ID,
      logicalGroupId: TARGET_GROUP_ID,
    })) as { scope: { group: string; endpointsInReach: number } };

    expect(result.scope.group).toBe('Target');
    expect(result.scope.endpointsInReach).toBe(4);
  });

  it('reports a capped walk as a blocker so the counts are never read as a total', async () => {
    const target: GroupRow = { id: TARGET_GROUP_ID, name: 'Target', parentId: null };

    const { client } = stubClient({
      groupPages: [[target]],
      groupTotalPages: 1,
      endpointPages: Array.from({ length: 40 }, (_, page) =>
        memberEndpoints(`p${page}`, 2, TARGET_GROUP_ID)
      ),
      // 40 pages exist; the module's cap is 20.
      endpointTotalPages: 40,
    });

    const result = (await previewAssignment(client, {
      jobDefinitionId: JOB_ID,
      logicalGroupId: TARGET_GROUP_ID,
    })) as {
      scope: { endpointsInReach: number };
      verdict: string;
      blockers: string[];
      meta: { estate: { truncated: boolean; endpoints: { pagesFetched: number; totalPages: number } }; note: string };
    };

    expect(result.meta.estate.truncated).toBe(true);
    expect(result.meta.estate.endpoints).toMatchObject({ pagesFetched: 20, totalPages: 40 });
    expect(result.scope.endpointsInReach).toBe(40); // 20 pages x 2 rows — a floor, not a total.

    expect(result.blockers.some((b) => b.includes('INCOMPLETE'))).toBe(true);
    expect(result.meta.note).toContain('LOWER BOUNDS');
    // An incomplete scope must never present itself as safe.
    expect(result.verdict).not.toBe('LOW RISK');
  });

  it('still says which failure happened when a truncated walk cannot find the group', async () => {
    const { client } = stubClient({
      groupPages: Array.from({ length: 30 }, (_, page) => fillerGroups(`gp${page}`, 2)),
      groupTotalPages: 30,
      endpointPages: [[]],
    });

    await expect(
      previewAssignment(client, { jobDefinitionId: JOB_ID, logicalGroupId: TARGET_GROUP_ID })
    ).rejects.toThrow(/not found in the first 20 of 30 pages/);
  });
});
