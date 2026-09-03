/**
 * TOK-22 — the collapse removed 31 tool NAMES, not 31 capabilities.
 *
 * The risk of collapsing a 33-tool matrix into two enum-parameterised tools is
 * not that it fails loudly; it is that one cell of the matrix quietly stops
 * being reachable and nobody notices, because there is no longer a tool name
 * whose absence anyone would spot. This file walks every cell and asserts the
 * exact `GroupsModule` method the pre-collapse `case` arm used to call.
 *
 * The module methods are spied at the prototype, so nothing here builds a
 * request or touches the network — the assertion is about routing, and a
 * network stub would only add a second thing that can be wrong.
 *
 * It also covers the two behaviours the collapse introduced:
 *   - `countOnly` (TOK-25) issues the past-the-end probe instead of a page;
 *   - the caller's filters are forwarded, and only the declared ones.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createServer } from '../index.js';
import { GroupsModule } from '../modules/groups.js';
import {
  AD_USER_ENDPOINT_TYPES,
  GROUP_KINDS,
  adUserMethod,
  groupMemberMethod,
  supportedMemberTypes,
} from '../utils/group-member-matrix.js';

const GROUP_ID = '11111111-2222-3333-4444-555555555555';
const AD_USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const ENVELOPE = { data: [], page: 0, pageSize: 20, totalItems: 7, totalPages: 1 };

/** Spy every route method on the prototype and record which one is called. */
function spyOnAllRoutes(): Map<string, ReturnType<typeof vi.fn>> {
  const calls = new Map<string, ReturnType<typeof vi.fn>>();
  const names = Object.getOwnPropertyNames(GroupsModule.prototype).filter(
    (n) => n !== 'constructor'
  );
  for (const name of names) {
    const spy = vi.fn().mockResolvedValue(ENVELOPE);
    vi.spyOn(GroupsModule.prototype, name as keyof GroupsModule).mockImplementation(
      spy as never
    );
    calls.set(name, spy);
  }
  return calls;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  // @ts-expect-error: accessing internal handler for testing, as server.test.ts does
  const handler = server._requestHandlers.get('tools/call');
  return handler?.({ method: 'tools/call', params: { name, arguments: args } });
}

function textOf(result: unknown): string {
  return ((result as { content: { text: string }[] }).content[0].text);
}

let spies: Map<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  spies = spyOnAllRoutes();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('list_group_members routes every (groupKind, memberType) cell', () => {
  for (const kind of GROUP_KINDS) {
    for (const memberType of supportedMemberTypes(kind)) {
      const expected = groupMemberMethod(kind, memberType)!;
      it(`${kind} + ${memberType} -> ${expected}`, async () => {
        await callTool('list_group_members', {
          groupKind: kind,
          memberType,
          groupId: GROUP_ID,
        });

        const called = [...spies.entries()].filter(([, spy]) => spy.mock.calls.length > 0);
        expect(called.map(([name]) => name)).toEqual([expected]);
        expect(spies.get(expected)!).toHaveBeenCalledWith(GROUP_ID, {});
      });
    }
  }

  it('defaults memberType to "endpoints" — the only type every group kind serves', async () => {
    await callTool('list_group_members', { groupKind: 'static', groupId: GROUP_ID });
    expect(spies.get('getEndpointsByStaticGroup')!).toHaveBeenCalledOnce();
  });
});

describe('list_ad_user_endpoints routes every endpointType', () => {
  for (const endpointType of AD_USER_ENDPOINT_TYPES) {
    const expected = adUserMethod(endpointType)!;
    it(`${endpointType} -> ${expected}`, async () => {
      await callTool('list_ad_user_endpoints', { adUserId: AD_USER_ID, endpointType });

      const called = [...spies.entries()].filter(([, spy]) => spy.mock.calls.length > 0);
      expect(called.map(([name]) => name)).toEqual([expected]);
      expect(spies.get(expected)!).toHaveBeenCalledWith(AD_USER_ID, {});
    });
  }

  it('defaults endpointType to "endpoints"', async () => {
    await callTool('list_ad_user_endpoints', { adUserId: AD_USER_ID });
    expect(spies.get('getEndpointsByADUser')!).toHaveBeenCalledOnce();
  });
});

describe('parameter forwarding (D14b / D6)', () => {
  it('forwards the declared filters, pagination and includeSubfolders', async () => {
    await callTool('list_group_members', {
      groupKind: 'logical',
      memberType: 'windows',
      groupId: GROUP_ID,
      Page: 2,
      PageSize: 50,
      OrderBy: 'DisplayName asc',
      SearchQuery: 'WIN11',
      DisplayName: 'WORKSTATION1',
      HostName: 'WORKSTATION1',
      Domain: 'LABCORP',
      EntraIdDeviceId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      includeSubfolders: true,
    });

    expect(spies.get('getWindowsEndpointsByLogicalGroup')!).toHaveBeenCalledWith(GROUP_ID, {
      SearchQuery: 'WIN11',
      Page: 2,
      PageSize: 50,
      OrderBy: 'DisplayName asc',
      DisplayName: 'WORKSTATION1',
      HostName: 'WORKSTATION1',
      Domain: 'LABCORP',
      EntraIdDeviceId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      includeSubfolders: true,
    });
  });

  it('omits parameters the caller did not supply rather than sending them empty', async () => {
    await callTool('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      DisplayName: 'WORKSTATION1',
    });
    expect(spies.get('getEndpointsByLogicalGroup')!).toHaveBeenCalledWith(GROUP_ID, {
      DisplayName: 'WORKSTATION1',
    });
  });

  it('forwards Name and Dip on childGroups — the filters only that route declares', async () => {
    await callTool('list_group_members', {
      groupKind: 'logical',
      memberType: 'childGroups',
      groupId: GROUP_ID,
      Name: 'Sales',
      Dip: 'HQ',
      Domain: 'LABCORP',
    });
    expect(spies.get('getLogicalGroupsByLogicalGroup')!).toHaveBeenCalledWith(GROUP_ID, {
      Name: 'Sales',
      Dip: 'HQ',
      Domain: 'LABCORP',
    });
  });

  it('forwards DisplayName on an android route, whose only declared filter it is', async () => {
    await callTool('list_group_members', {
      groupKind: 'universalDynamic',
      memberType: 'android',
      groupId: GROUP_ID,
      DisplayName: 'Pixel-7',
    });
    expect(spies.get('getAndroidEndpointsByUDG')!).toHaveBeenCalledWith(GROUP_ID, {
      DisplayName: 'Pixel-7',
    });
  });

  it('never forwards the routing arguments as query parameters', async () => {
    await callTool('list_group_members', {
      groupKind: 'logical',
      memberType: 'mac',
      groupId: GROUP_ID,
    });
    const [, params] = spies.get('getMacEndpointsByLogicalGroup')!.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(Object.keys(params)).toEqual([]);
  });
});

describe('countOnly (TOK-25)', () => {
  it('asks for a page past the end instead of a page of rows', async () => {
    const result = await callTool('list_group_members', {
      groupKind: 'logical',
      memberType: 'windows',
      groupId: GROUP_ID,
      countOnly: true,
    });

    expect(spies.get('getWindowsEndpointsByLogicalGroup')!).toHaveBeenCalledWith(GROUP_ID, {
      Page: 100_000,
      PageSize: 1,
    });
    expect(JSON.parse(textOf(result))).toEqual({ totalItems: 7 });
  });

  it('counts what the caller filtered for, and echoes those filters once', async () => {
    const result = await callTool('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      DisplayName: 'WORKSTATION1',
      includeSubfolders: true,
      PageSize: 20,
      countOnly: true,
    });

    expect(spies.get('getEndpointsByLogicalGroup')!).toHaveBeenCalledWith(GROUP_ID, {
      DisplayName: 'WORKSTATION1',
      includeSubfolders: true,
      Page: 100_000,
      PageSize: 1,
    });
    expect(JSON.parse(textOf(result))).toEqual({
      totalItems: 7,
      filters: { DisplayName: 'WORKSTATION1', includeSubfolders: true },
    });
  });

  it('works on the AD-user tool too', async () => {
    const result = await callTool('list_ad_user_endpoints', {
      adUserId: AD_USER_ID,
      endpointType: 'windows',
      countOnly: true,
    });
    expect(spies.get('getWindowsEndpointsByADUser')!).toHaveBeenCalledWith(AD_USER_ID, {
      Page: 100_000,
      PageSize: 1,
    });
    expect(JSON.parse(textOf(result))).toEqual({ totalItems: 7 });
  });

  it('a countOnly answer is orders of magnitude smaller than the page it replaces', async () => {
    // The envelope the probe returns carries no rows at all; the tool result is
    // the count and nothing else. Measured against the live estate the prior
    // record recorded 122 B for a request whose page would have been 15-18 KB.
    const result = await callTool('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      countOnly: true,
    });
    expect(Buffer.byteLength(textOf(result), 'utf8')).toBeLessThan(200);
  });
});

describe('INT-53 — one error channel', () => {
  it('an expected API failure (404) comes back as a readable isError result, not -32603', async () => {
    const notFound = Object.assign(new Error('Resource not found. Check the id.'), {
      status: 404,
    });
    spies.get('getEndpointsByLogicalGroup')!.mockRejectedValueOnce(notFound);

    const result = (await callTool('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Resource not found. Check the id.');
  });

  it('a fault (500) stays a protocol error with the catch-all wording unchanged', async () => {
    const boom = Object.assign(new Error('bConnect API returned an internal server error.'), {
      status: 500,
    });
    spies.get('getEndpointsByLogicalGroup')!.mockRejectedValueOnce(boom);

    await expect(
      callTool('list_group_members', { groupKind: 'logical', groupId: GROUP_ID })
    ).rejects.toMatchObject({
      code: -32603,
      message: expect.stringContaining('Tool execution failed:'),
    });
  });
});
