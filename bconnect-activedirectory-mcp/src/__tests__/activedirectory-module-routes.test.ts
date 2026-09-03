/**
 * `ActiveDirectoryModule` — verb/route assertions for all 16 reads.
 *
 * Before this file, `activedirectory.ts` measured **19.04% statements** and the
 * workspace 37.03% against a 34 floor — three points of margin, and the lowest
 * floor of any server. The shortfall was entirely the module:
 * `bconnect-client.ts` was already 100%.
 *
 * Fake `AxiosInstance`. No network, no live bMS, no mock server.
 *
 * ── The shape, and the one route that breaks it ─────────────────────────────
 * Fifteen of the sixteen routes are a plain noun or noun/{id}/noun pair, where
 * the sub-resource segment is the same word as the thing being fetched:
 * `/ADGroups/{id}/ADUsers` returns AD users, `/OrgUnits/{id}/ADGroups` returns
 * AD groups.
 *
 * `getADObjectMemberships` is the exception. It fetches groups, but the segment
 * is `/ADObjects/{id}/ADGroupMemberships` — not `/ADGroups`, which is what the
 * pattern predicts and what a reader completing it from the other fifteen would
 * write. The method name does not say `ADGroupMemberships` either. It is pinned
 * explicitly below.
 *
 * The other trap is quieter: `/ADGroups/{id}/ADGroups` (nested groups) and
 * `/ADGroups/{id}/ADObjects` (member objects) differ by one segment and return
 * different things, as do the four `/OrgUnits/{id}/…` routes. A transposition
 * between any two of them is silent — both spellings exist and both answer 200.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { ActiveDirectoryModule } from '../modules/activedirectory.js';

interface Call {
  method: 'GET';
  url: string;
  params?: unknown;
}

function fakeClient(responseData: unknown = { data: [], totalItems: 0 }): {
  client: AxiosInstance;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client = {
    get: async (url: string, config?: { params?: unknown }) => {
      calls.push({ method: 'GET', url, params: config?.params });
      return { data: responseData };
    },
  } as unknown as AxiosInstance;
  return { client, calls };
}

const BASE = (
  new ActiveDirectoryModule(fakeClient().client) as unknown as { basePath: string }
).basePath;

/** Method, argument, expected route. Transcribed one at a time, not generated. */
const CASES: ReadonlyArray<readonly [keyof ActiveDirectoryModule, string | null, string]> = [
  // Collections
  ['getADGroups', null, '/ADGroups'],
  ['getADUsers', null, '/ADUsers'],
  ['getADObjects', null, '/ADObjects'],
  ['getOrgUnits', null, '/OrgUnits'],
  // Single objects
  ['getADGroup', 'g-1', '/ADGroups/g-1'],
  ['getADUser', 'u-1', '/ADUsers/u-1'],
  ['getADObject', 'o-1', '/ADObjects/o-1'],
  ['getOrgUnit', 'ou-1', '/OrgUnits/ou-1'],
  // Group-scoped
  ['getADUsersByGroup', 'g-1', '/ADGroups/g-1/ADUsers'],
  ['getADGroupsByAdGroup', 'g-1', '/ADGroups/g-1/ADGroups'],
  ['getADObjectsByAdGroup', 'g-1', '/ADGroups/g-1/ADObjects'],
  // Org-unit-scoped
  ['getADGroupsByOrgUnit', 'ou-1', '/OrgUnits/ou-1/ADGroups'],
  ['getADObjectsByOrgUnit', 'ou-1', '/OrgUnits/ou-1/ADObjects'],
  ['getADUsersByOrgUnit', 'ou-1', '/OrgUnits/ou-1/ADUsers'],
  ['getOrgUnitsByOrgUnit', 'ou-1', '/OrgUnits/ou-1/OrgUnits'],
  // The exception — see the header
  ['getADObjectMemberships', 'o-1', '/ADObjects/o-1/ADGroupMemberships'],
];

type Read = (...args: unknown[]) => Promise<unknown>;

describe('ActiveDirectoryModule — the base path itself', () => {
  it('basePath is the version this module is written against', () => {
    expect(BASE).toBe('/activedirectory/v2.0');
  });
});

describe('ActiveDirectoryModule — every read builds its own route', () => {
  for (const [method, arg, route] of CASES) {
    it(`${String(method)} GETs ${route}`, async () => {
      const { client, calls } = fakeClient();
      const mod = new ActiveDirectoryModule(client);
      const fn = mod[method] as unknown as Read;
      await (arg === null ? fn.call(mod) : fn.call(mod, arg));
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(`${BASE}${route}`);
    });
  }

  it('getADObjectMemberships does NOT use the /ADGroups segment the pattern predicts', async () => {
    // Stated as its own assertion because the route test above would still pass
    // if someone changed both the expectation and the code together; this says
    // which spelling is wrong, and why anyone would reach for it.
    const { client, calls } = fakeClient();
    await new ActiveDirectoryModule(client).getADObjectMemberships('o-1');
    expect(calls[0]?.url).toBe(`${BASE}/ADObjects/o-1/ADGroupMemberships`);
    expect(calls[0]?.url).not.toBe(`${BASE}/ADObjects/o-1/ADGroups`);
  });

  it('forwards query params, and defaults them to {} on the collection reads', async () => {
    const { client, calls } = fakeClient();
    const mod = new ActiveDirectoryModule(client);
    await mod.getADGroups({ PageSize: 50 });
    await mod.getADUsers();
    expect(calls[0]?.params).toEqual({ PageSize: 50 });
    expect(calls[1]?.params).toEqual({});
  });

  it('readSubResource is transparent on the success path', async () => {
    const payload = { data: [{ id: 'u-1' }], totalItems: 1 };
    const mod = new ActiveDirectoryModule(fakeClient(payload).client);
    expect(await mod.getADUsersByGroup('g-1')).toEqual(payload);
    expect(await mod.getADObjectMemberships('o-1')).toEqual(payload);
    expect(await mod.getOrgUnitsByOrgUnit('ou-1')).toEqual(payload);
  });
});

describe('ActiveDirectoryModule — the shape of the route set', () => {
  it('every route is distinct, so no two methods collapse onto one URL', () => {
    const routes = CASES.map(([, , r]) => r);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('covers every async method the module exposes', () => {
    // Derived from the prototype, not from CASES, so a method added without a
    // case fails here instead of silently widening the untested surface.
    const onPrototype = Object.getOwnPropertyNames(ActiveDirectoryModule.prototype).filter(
      (n) => n !== 'constructor'
    );
    const tested = new Set(CASES.map(([m]) => String(m)));
    const untested = onPrototype.filter((n) => !tested.has(n));
    expect(
      untested,
      `${untested.length} method(s) have no route assertion: ${untested.join(', ')}`
    ).toEqual([]);
  });
});
