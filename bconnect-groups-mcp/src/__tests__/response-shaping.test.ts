/**
 * bconnect-groups-mcp — the compact projection for `list_group_members`.
 *
 * ── Why this tool and not another ───────────────────────────────────────────
 * Measured live against the estate: a 20-row page is **19,864 B**, 994 B per
 * row — the largest single response in the suite. It returns the full 25-column
 * endpoint record. Applying the projection already shipped and reviewed for
 * `list_endpoints` takes it to **9,468 B, saving 10,396 B (-52.3%)**, and adds
 * no new field-selection judgement because it is the same row and the same list.
 *
 * ── The trap this file exists to hold shut ──────────────────────────────────
 * The ranking that produced this work recommended applying
 * `ENDPOINT_COMPACT_FIELDS` "verbatim". Probed live first, and that would have
 * been wrong: `memberType: 'childGroups'` returns LOGICAL GROUP rows —
 * `{id, name, parentId, parent, comment, dip, defaultDomain}` — and `id` is the
 * only field the two shapes share. An endpoint projection reduces every
 * child-group row to `{id}`, discarding the group's own name and parentage.
 * That is the answer being deleted, not compacted.
 *
 * So the projection is gated on member type, and the gate is asserted here for
 * every member type rather than for the one that happened to be measured.
 *
 * ── Falsified ───────────────────────────────────────────────────────────────
 * Remove the `memberType === CHILD_GROUPS_MEMBER_TYPE` early return in
 * src/index.ts and `childGroups rows are returned unprojected` fails, showing
 * the row reduced to `{id}`. Revert the arm to the raw passthrough and the
 * projection and provenance tests fail.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { createServer } from '../index.js';
import { GroupsModule } from '../modules/groups.js';
import { MEMBER_TYPES } from '../utils/group-member-matrix.js';

const GROUP_ID = '11111111-2222-3333-4444-555555555555';

/** A full-fat endpoint row, the shape the live route returns. */
function endpointRow(i: number): Record<string, unknown> {
  return {
    id: `9dd5000${i}-888b-42c4-bd1a-9b8dae0090ba`,
    type: 'WindowsEndpoint',
    displayName: `WIN11CLIENT${i}`,
    hostName: `WIN11CLIENT${i}`,
    primaryMAC: '00:0C:29:62:E8:03',
    macList: '00:0C:29:62:E8:03',
    primaryIP: `172.16.1.${i}`,
    primarySubnetMask: '255.255.255.0',
    comment: null,
    activity: 'Successfully finished.',
    lastSeen: '2026-08-05T02:32:12Z',
    operatingSystem: 'Windows 11',
    osVersionString: '10.0.26200.8875',
    osVersionText: 'Windows 11 Professional Edition (Build 26200) (64 Bit)',
    logicalGroupId: 'e57a7e00-0000-4000-8000-000000000024',
    logicalGroup: 'Win11',
    manufacturer: 'VMware, Inc.',
    modelName: 'VMware20,1',
    clientAgentVersion: '26.1.161.0',
    serialNumber: 'VMware-56 4d e7 42 38 bb 06 3b',
    registeredUser: `WIN11CLIENT${i}\\bAdm`,
    registeredUserId: null,
    timeZone: 'UTC+02:00 Europe/Berlin',
    assignedScannerId: null,
    assignedScannerName: null,
  };
}

/** A logical-group row — what `childGroups` returns. Only `id` overlaps above. */
function childGroupRow(i: number): Record<string, unknown> {
  return {
    id: `000168b${i}-0ea2-4992-91c8-d1c0dd34af91`,
    name: `Win1${i}`,
    parentId: 'e57a7e00-0000-4000-8000-000000000016',
    parent: 'Clients',
    comment: `Automatically created by ADSync on ${i}/1/2024`,
    dip: null,
    defaultDomain: null,
  };
}

const envelope = (rows: Record<string, unknown>[]): Record<string, unknown> => ({
  currentPage: 0,
  pageSize: 20,
  totalPages: 1,
  totalItems: rows.length,
  hasPreviousPage: false,
  hasNextPage: false,
  data: rows,
});

/** Make every route method return `payload`. */
function stubRoutes(payload: unknown): void {
  for (const name of Object.getOwnPropertyNames(GroupsModule.prototype)) {
    if (name === 'constructor') { continue; }
    vi.spyOn(GroupsModule.prototype, name as keyof GroupsModule).mockResolvedValue(
      payload as never
    );
  }
}

async function callTool(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  // @ts-expect-error: accessing the internal handler, as the sibling tests do
  const handler = server._requestHandlers.get('tools/call');
  const result = await handler?.({ method: 'tools/call', params: { name: 'list_group_members', arguments: args } });
  const text = (result as { content: { text: string }[] }).content[0].text;
  return JSON.parse(text) as Record<string, unknown>;
}

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('list_group_members — endpoint rows are projected', () => {
  it('keeps the eleven compact fields and names what it removed', async () => {
    stubRoutes(envelope([endpointRow(1), endpointRow(2)]));
    const json = await callTool({ groupKind: 'universalDynamic', groupId: GROUP_ID });

    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2); // vacuity: the page survived the projection
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        'activity', 'clientAgentVersion', 'displayName', 'hostName', 'id', 'lastSeen',
        'logicalGroup', 'logicalGroupId', 'operatingSystem', 'osVersionString', 'type',
      ].sort()
    );
    const meta = json.meta as Record<string, unknown>;
    expect(meta.projection).toBe('compact');
    expect((meta.projectedAway as string[]).length).toBeGreaterThan(0);
    expect(meta.projectedAway).toContain('serialNumber');
  });

  it('keeps every id another tool consumes as a parameter', async () => {
    // The rule attached to ENDPOINT_COMPACT_FIELDS: never project away an *Id
    // that another tool takes. `logicalGroupId` is what the group-scoped tools in
    // five other servers are keyed on, and nothing converts a name back to an id.
    stubRoutes(envelope([endpointRow(1), endpointRow(2)]));
    const json = await callTool({ groupKind: 'universalDynamic', groupId: GROUP_ID });
    const row = (json.data as Record<string, unknown>[])[0];
    expect(row.id).toBeDefined();
    expect(row.logicalGroupId).toBe('e57a7e00-0000-4000-8000-000000000024');
  });

  /**
   * Asserted at the DEFAULT page size, because the saving is row-count
   * dependent and 20 rows is what a caller actually receives.
   *
   * `meta.projectedAway` names 14 columns once per response, so it is a fixed
   * cost spread over the page: at 20 rows it is noise against 10 KB saved, and
   * on a 3-row page it eats the entire saving (measured: 1,696 B shaped against
   * 1,584 B raw — a net LOSS). That is the same effect that puts every tool
   * below ~rank 32 of the shaping backlog out of scope, and it is a property of
   * the projection rather than a defect, so it is pinned here rather than
   * tuned away.
   */
  it('saves more than 40% of a default-size page (measured, not asserted by hand)', async () => {
    const raw = envelope(Array.from({ length: 20 }, (_unused, i) => endpointRow(i + 1)));
    stubRoutes(raw);
    const json = await callTool({ groupKind: 'universalDynamic', groupId: GROUP_ID });
    expect(bytes(json)).toBeLessThan(bytes(raw) * 0.6);
  });

  /**
   * The saving is a RATE, not a constant, and the rate depends on page size.
   *
   * Written first as "a tiny page is a net loss" and that was wrong — measured,
   * a 1-row page still saves 12 B (956 -> 944). The true property is weaker and
   * more useful: `meta.projectedAway` is paid once per response whatever the row
   * count, so it swamps the per-row saving on a short page and vanishes into it
   * on a full one. Pinned because it is the reason a byte ranking taken from
   * one page size cannot be read as a ranking of value.
   */
  it('saves proportionally far less on a short page, because meta is a fixed cost', async () => {
    const oneRow = envelope([endpointRow(1)]);
    stubRoutes(oneRow);
    const shapedOne = bytes(await callTool({ groupKind: 'universalDynamic', groupId: GROUP_ID }));
    const pctOne = 1 - shapedOne / bytes(oneRow);

    vi.restoreAllMocks();
    const fullPage = envelope(Array.from({ length: 20 }, (_unused, i) => endpointRow(i + 1)));
    stubRoutes(fullPage);
    const shapedFull = bytes(await callTool({ groupKind: 'universalDynamic', groupId: GROUP_ID }));
    const pctFull = 1 - shapedFull / bytes(fullPage);

    expect(pctFull).toBeGreaterThan(0.4);
    expect(pctOne).toBeLessThan(0.1);
  });

  it('detail:true returns the raw record, so the escape hatch is reachable', async () => {
    // Also proves the validation rules accept `detail`. Without that,
    // assertKnownParameters refuses it with -32602 before dispatch and the
    // projection's own "Pass detail:true" hint would be false.
    const raw = envelope([endpointRow(1)]);
    stubRoutes(raw);
    const json = await callTool({ groupKind: 'universalDynamic', groupId: GROUP_ID, detail: true });
    expect(json.meta).toBeUndefined();
    expect((json.data as Record<string, unknown>[])[0].serialNumber).toBe('VMware-56 4d e7 42 38 bb 06 3b');
  });

  it('fields:[..] is reachable too', async () => {
    stubRoutes(envelope([endpointRow(1), endpointRow(2)]));
    const json = await callTool({
      groupKind: 'universalDynamic',
      groupId: GROUP_ID,
      fields: ['id', 'displayName'],
    });
    expect(Object.keys((json.data as Record<string, unknown>[])[0]).sort()).toEqual(['displayName', 'id']);
  });
});

describe('list_group_members — childGroups rows are NOT projected', () => {
  it('returns the logical-group row whole, because an endpoint projection would leave only {id}', async () => {
    stubRoutes(envelope([childGroupRow(0), childGroupRow(1)]));
    const json = await callTool({ groupKind: 'logical', groupId: GROUP_ID, memberType: 'childGroups' });

    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    // The whole point: `name` and `parentId` are absent from the endpoint field
    // list, so projecting these rows would discard them.
    expect(rows[0].name).toBe('Win10');
    expect(rows[0].parentId).toBe('e57a7e00-0000-4000-8000-000000000016');
    expect(rows[0].parent).toBe('Clients');
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['comment', 'defaultDomain', 'dip', 'id', 'name', 'parent', 'parentId'].sort()
    );
    // No projection ran at all, so no meta was added.
    expect(json.meta).toBeUndefined();
  });

  it('every OTHER member type is projected — the gate is on childGroups alone', async () => {
    // Asserted across the enum rather than on the one type that was measured, so
    // a member type added later is covered by construction. `logical` serves
    // every memberType, which is why it is the kind used here.
    for (const memberType of MEMBER_TYPES) {
      vi.restoreAllMocks();
      const isChildGroups = memberType === 'childGroups';
      stubRoutes(envelope(isChildGroups ? [childGroupRow(0)] : [endpointRow(1), endpointRow(2)]));
      const json = await callTool({ groupKind: 'logical', groupId: GROUP_ID, memberType });
      if (isChildGroups) {
        expect(json.meta, `${memberType} must NOT be projected`).toBeUndefined();
      } else {
        expect((json.meta as Record<string, unknown>)?.projection, `${memberType} must be projected`).toBe('compact');
      }
    }
  });
});
