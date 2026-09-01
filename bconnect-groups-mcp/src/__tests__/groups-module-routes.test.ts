/**
 * `GroupsModule` — verb/route assertions for all 30 membership reads.
 *
 * Before this file, `groups.ts` measured **10.51% statements / 6.25%
 * functions** — the lowest module in the repository — and the workspace sat at
 * 50.16% against a 74 floor, a 24-point gap. The shortfall was entirely here:
 * `bconnect-client.ts` was 100%, `group-member-matrix.ts` 100% and
 * `mcp-tool-validation-rules.ts` 99.28%.
 *
 * Fake `AxiosInstance`. No network, no live bMS, no mock server.
 *
 * ── Why the expected routes are written out as LITERALS ─────────────────────
 * This module is a matrix: five parent kinds crossed with up to seven platform
 * segments. The tempting shape is a generated table — parent x platform — but
 * that would build each expectation with the same rule `groups.ts` uses to
 * build the URL, so a wrong rule would produce a matching wrong expectation and
 * the whole file would pass. A test must not share a method with the thing it
 * checks. Every route below is therefore spelled out by hand, transcribed from
 * the module one at a time.
 *
 * ── Two gaps in the matrix, pinned because they look like omissions ─────────
 * The matrix is deliberately incomplete, and both holes read as bugs to anyone
 * filling them in from symmetry:
 *
 *   DynamicGroups  carries ONLY Endpoints and WindowsEndpoints — no Android,
 *                  iOS, Linux, Mac or Network. (Windows dynamic groups are the
 *                  feature being deprecated; nothing else was ever served.)
 *   ADUsers        carries every platform EXCEPT NetworkEndpoints. A network
 *                  endpoint has no AD user, so the route does not exist.
 *
 * The count test at the end fails if a method is added or removed, so filling
 * either hole is a deliberate act rather than a symmetry reflex.
 *
 * Note the base path: this module talks to `/endpoints/v2.0`, NOT a
 * `/groups/...` path. Group membership is served by the endpoints API.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { GroupsModule } from '../modules/groups.js';

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

const BASE = (new GroupsModule(fakeClient().client) as unknown as { basePath: string }).basePath;

/** Every method, the id it is called with, and the route it must build. */
const CASES: ReadonlyArray<readonly [keyof GroupsModule, string, string]> = [
  // ── Logical groups: seven platforms plus nested logical groups ───────────
  ['getEndpointsByLogicalGroup', 'lg-1', '/LogicalGroups/lg-1/Endpoints'],
  ['getAndroidEndpointsByLogicalGroup', 'lg-1', '/LogicalGroups/lg-1/AndroidEndpoints'],
  ['getIosEndpointsByLogicalGroup', 'lg-1', '/LogicalGroups/lg-1/IosEndpoints'],
  ['getLinuxEndpointsByLogicalGroup', 'lg-1', '/LogicalGroups/lg-1/LinuxEndpoints'],
  ['getMacEndpointsByLogicalGroup', 'lg-1', '/LogicalGroups/lg-1/MacEndpoints'],
  ['getNetworkEndpointsByLogicalGroup', 'lg-1', '/LogicalGroups/lg-1/NetworkEndpoints'],
  ['getWindowsEndpointsByLogicalGroup', 'lg-1', '/LogicalGroups/lg-1/WindowsEndpoints'],
  ['getLogicalGroupsByLogicalGroup', 'lg-1', '/LogicalGroups/lg-1/LogicalGroups'],

  // ── Static groups: seven platforms, no nesting ───────────────────────────
  ['getEndpointsByStaticGroup', 'sg-1', '/StaticGroups/sg-1/Endpoints'],
  ['getAndroidEndpointsByStaticGroup', 'sg-1', '/StaticGroups/sg-1/AndroidEndpoints'],
  ['getIosEndpointsByStaticGroup', 'sg-1', '/StaticGroups/sg-1/IosEndpoints'],
  ['getLinuxEndpointsByStaticGroup', 'sg-1', '/StaticGroups/sg-1/LinuxEndpoints'],
  ['getMacEndpointsByStaticGroup', 'sg-1', '/StaticGroups/sg-1/MacEndpoints'],
  ['getNetworkEndpointsByStaticGroup', 'sg-1', '/StaticGroups/sg-1/NetworkEndpoints'],
  ['getWindowsEndpointsByStaticGroup', 'sg-1', '/StaticGroups/sg-1/WindowsEndpoints'],

  // ── Dynamic groups: TWO only. See the header. ────────────────────────────
  ['getEndpointsByDynamicGroup', 'dg-1', '/DynamicGroups/dg-1/Endpoints'],
  ['getWindowsEndpointsByDynamicGroup', 'dg-1', '/DynamicGroups/dg-1/WindowsEndpoints'],

  // ── Universal dynamic groups: seven platforms ────────────────────────────
  ['getEndpointsByUDG', 'udg-1', '/UniversalDynamicGroups/udg-1/Endpoints'],
  ['getAndroidEndpointsByUDG', 'udg-1', '/UniversalDynamicGroups/udg-1/AndroidEndpoints'],
  ['getIosEndpointsByUDG', 'udg-1', '/UniversalDynamicGroups/udg-1/IosEndpoints'],
  ['getLinuxEndpointsByUDG', 'udg-1', '/UniversalDynamicGroups/udg-1/LinuxEndpoints'],
  ['getMacEndpointsByUDG', 'udg-1', '/UniversalDynamicGroups/udg-1/MacEndpoints'],
  ['getNetworkEndpointsByUDG', 'udg-1', '/UniversalDynamicGroups/udg-1/NetworkEndpoints'],
  ['getWindowsEndpointsByUDG', 'udg-1', '/UniversalDynamicGroups/udg-1/WindowsEndpoints'],

  // ── AD users: six platforms, NO network. See the header. ─────────────────
  ['getEndpointsByADUser', 'u-1', '/ADUsers/u-1/Endpoints'],
  ['getAndroidEndpointsByADUser', 'u-1', '/ADUsers/u-1/AndroidEndpoints'],
  ['getIosEndpointsByADUser', 'u-1', '/ADUsers/u-1/IosEndpoints'],
  ['getLinuxEndpointsByADUser', 'u-1', '/ADUsers/u-1/LinuxEndpoints'],
  ['getMacEndpointsByADUser', 'u-1', '/ADUsers/u-1/MacEndpoints'],
  ['getWindowsEndpointsByADUser', 'u-1', '/ADUsers/u-1/WindowsEndpoints'],
];

type MembershipRead = (id: string, params?: unknown) => Promise<unknown>;

describe('GroupsModule — the base path itself', () => {
  it('basePath is the endpoints API, not a groups API', () => {
    // Pinned once. If this fails and the route tests still pass, only the base
    // moved — verify every route exists under the new version before editing.
    expect(BASE).toBe('/endpoints/v2.0');
  });
});

describe('GroupsModule — every membership read builds its own route', () => {
  for (const [method, id, route] of CASES) {
    it(`${String(method)} GETs ${route}`, async () => {
      const { client, calls } = fakeClient();
      const mod = new GroupsModule(client);
      await (mod[method] as unknown as MembershipRead).call(mod, id);
      expect(calls).toEqual([{ method: 'GET', url: `${BASE}${route}`, params: undefined }]);
    });
  }

  it('forwards query params when given', async () => {
    const { client, calls } = fakeClient();
    await new GroupsModule(client).getEndpointsByLogicalGroup('lg-1', { PageSize: 50, SearchQuery: 'srv' });
    expect(calls[0]?.params).toEqual({ PageSize: 50, SearchQuery: 'srv' });
  });

  it('readSubResource is transparent on the success path', async () => {
    // These wrappers exist to translate a 404. On success they must not reshape
    // the envelope — every membership count the tools report comes through one.
    const payload = { data: [{ id: 'ep-1' }], totalItems: 1 };
    const mod = new GroupsModule(fakeClient(payload).client);
    expect(await mod.getEndpointsByLogicalGroup('lg-1')).toEqual(payload);
    expect(await mod.getWindowsEndpointsByUDG('udg-1')).toEqual(payload);
    expect(await mod.getMacEndpointsByADUser('u-1')).toEqual(payload);
  });
});

describe('GroupsModule — the shape of the matrix itself', () => {
  it('every route is distinct, so no two methods collapse onto one URL', () => {
    // A copy-paste that left the wrong platform segment behind would give two
    // methods the same URL, and each of their own tests would still pass.
    const routes = CASES.map(([, , route]) => route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('covers every async method the module exposes — no method goes untested', () => {
    // The count is derived from the prototype, not from CASES, so adding a
    // method without adding a case fails here rather than silently widening
    // the untested surface. This is the guard that makes the two deliberate
    // gaps in the matrix safe to leave.
    const onPrototype = Object.getOwnPropertyNames(GroupsModule.prototype).filter(
      (n) => n !== 'constructor'
    );
    const tested = new Set(CASES.map(([m]) => String(m)));
    const untested = onPrototype.filter((n) => !tested.has(n));
    expect(
      untested,
      `${untested.length} method(s) on GroupsModule have no route assertion: ${untested.join(', ')}`
    ).toEqual([]);
    expect(onPrototype.length).toBe(CASES.length);
  });
});
