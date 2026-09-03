/**
 * `ServerManagementModule` — verb/route assertions for all 30 methods.
 *
 * Before this file, `servermanagement.ts` measured **37.22% statements / 21.87%
 * functions** while the workspace passed its floor of 46 at 55.71%. This is the
 * server that restarts the management server, stops microservices and runs DIP
 * cleanup — the highest-consequence write surface in the suite — and two thirds
 * of it had no assertion about what URL those writes build.
 *
 * Fake `AxiosInstance`. **Nothing here touches a network.** That is what makes
 * it safe to assert the route of `mswCleanup`, which the project's standing
 * constraints forbid ever running: the call is recorded and discarded in
 * process, and asserting a dangerous route is more valuable than skipping it.
 *
 * ── Three PATCHes that were sending a rejected media type ───────────────────
 * `updateSecurityGroup`, `updateSecurityProfile` and `updateObjectPermission`
 * PATCHed with no content type until 2026-08-19. All 25 PATCH operations in the
 * 26R1 specs accept `application/json-patch+json` and nothing else. All three
 * are written `.patch<T>(`, which is why the first repository-wide check —
 * searching for the literal `.patch(` — never saw them.
 *
 * ── The pair that must not be confused ──────────────────────────────────────
 * `/Dips/SimulateMSWCleanup` and `/Dips/MSWCleanup` differ by one word and by
 * everything else. Both are POSTs against the same parent. They are asserted
 * separately, and against each other, because a transposition here is not
 * recoverable.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { ServerManagementModule } from '../modules/servermanagement.js';

interface Call {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  params?: unknown;
  headers?: Record<string, string>;
}

function fakeClient(responseData: unknown = { id: 'stub' }): { client: AxiosInstance; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    get: async (url: string, config?: { params?: unknown }) => {
      calls.push({ method: 'GET', url, params: config?.params });
      return { data: responseData };
    },
    post: async (url: string, body?: unknown) => {
      calls.push({ method: 'POST', url, body });
      return { data: responseData };
    },
    patch: async (url: string, body?: unknown, config?: { headers?: Record<string, string> }) => {
      calls.push({ method: 'PATCH', url, body, headers: config?.headers });
      return { data: responseData };
    },
    delete: async (url: string) => {
      calls.push({ method: 'DELETE', url });
      return { data: responseData };
    },
  } as unknown as AxiosInstance;
  return { client, calls };
}

const BASE = (
  new ServerManagementModule(fakeClient().client) as unknown as { basePath: string }
).basePath;
const PATCH_HEADERS = { 'Content-Type': 'application/json-patch+json' };
const DOC = [{ op: 'replace', path: '/name', value: 'x' }] as never;

/** Reads that take no argument. Method, expected route. */
const PLAIN_READS: ReadonlyArray<readonly [keyof ServerManagementModule, string]> = [
  ['getManagementServer', '/ManagementServer'],
  ['getGateway', '/Gateway'],
  ['getDipStatus', '/Dips'],
  ['getVpnAppliance', '/VpnAppliance'],
  ['getMicroservices', '/Microservices'],
  ['getCloudConnectors', '/CloudConnectors'],
  ['getPxeRelays', '/PxeRelays'],
  ['getSecurityGroups', '/SecurityGroups'],
  ['getSecurityProfiles', '/SecurityProfiles'],
  ['getApiKeys', '/ApiKeys'],
  ['getDownloadJobs', '/DownloadJobs'],
];

/** Reads that take one id. Method, id, expected route. */
const ID_READS: ReadonlyArray<readonly [keyof ServerManagementModule, string, string]> = [
  ['getMicroservice', 'ms-1', '/Microservices/ms-1'],
  ['getSecurityGroup', 'sg-1', '/SecurityGroups/sg-1'],
  ['getSecurityProfile', 'sp-1', '/SecurityProfiles/sp-1'],
  ['getAccessRights', 'obj-1', '/Objects/obj-1/Rights'],
  ['getDownloadJob', 'dj-1', '/DownloadJobs/dj-1'],
];

/** POST actions taking one id. Method, id, expected route. */
const ID_ACTIONS: ReadonlyArray<readonly [keyof ServerManagementModule, string, string]> = [
  ['startMicroservice', 'ms-1', '/Microservices/ms-1/Start'],
  ['stopMicroservice', 'ms-1', '/Microservices/ms-1/Stop'],
  ['restartMicroservice', 'ms-1', '/Microservices/ms-1/Restart'],
];

type Call0 = () => Promise<unknown>;
type Call1 = (a: string) => Promise<unknown>;

describe('ServerManagementModule — the base path itself', () => {
  it('basePath is the version this module is written against', () => {
    expect(BASE).toBe('/servermanagement/v2.0');
  });
});

describe('ServerManagementModule — reads', () => {
  for (const [method, route] of PLAIN_READS) {
    it(`${String(method)} GETs ${route}`, async () => {
      const { client, calls } = fakeClient({ data: [], totalItems: 0 });
      const mod = new ServerManagementModule(client);
      await (mod[method] as unknown as Call0).call(mod);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('GET');
      expect(calls[0]?.url).toBe(`${BASE}${route}`);
    });
  }

  for (const [method, id, route] of ID_READS) {
    it(`${String(method)} GETs ${route}`, async () => {
      const { client, calls } = fakeClient({ id });
      const mod = new ServerManagementModule(client);
      await (mod[method] as unknown as Call1).call(mod, id);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('GET');
      expect(calls[0]?.url).toBe(`${BASE}${route}`);
    });
  }

  it('getDipStatus reads /Dips — the same parent the cleanup routes hang off', async () => {
    const { client, calls } = fakeClient({ data: [] });
    await new ServerManagementModule(client).getDipStatus();
    expect(calls[0]?.url).toBe(`${BASE}/Dips`);
    expect(calls[0]?.method).toBe('GET');
  });
});

describe('ServerManagementModule — microservice lifecycle', () => {
  for (const [method, id, route] of ID_ACTIONS) {
    it(`${String(method)} POSTs ${route}`, async () => {
      const { client, calls } = fakeClient({ ok: true });
      const mod = new ServerManagementModule(client);
      await (mod[method] as unknown as Call1).call(mod, id);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('POST');
      expect(calls[0]?.url).toBe(`${BASE}${route}`);
    });
  }

  it('the three lifecycle verbs land on three distinct routes', async () => {
    // Start/Stop/Restart are one word apart. A copy-paste that left the wrong
    // suffix behind would pass each individual test above if the expectation
    // were edited to match.
    const routes = ID_ACTIONS.map(([, , r]) => r);
    expect(new Set(routes).size).toBe(3);
  });
});

describe('ServerManagementModule — management-server restarts', () => {
  it('restartManagementServer POSTs /Restart', async () => {
    const { client, calls } = fakeClient({ ok: true });
    await new ServerManagementModule(client).restartManagementServer();
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe(`${BASE}/Restart`);
  });

  it('cancelScheduledRestart POSTs /CancelScheduledRestart, not /Restart', async () => {
    const { client, calls } = fakeClient({ ok: true });
    await new ServerManagementModule(client).cancelScheduledRestart();
    expect(calls[0]?.url).toBe(`${BASE}/CancelScheduledRestart`);
    // Cancelling must never reach the route that DOES the thing.
    expect(calls[0]?.url).not.toBe(`${BASE}/Restart`);
  });
});

describe('ServerManagementModule — the two DIP cleanup routes', () => {
  it('simulateMSWCleanup POSTs /Dips/SimulateMSWCleanup', async () => {
    const { client, calls } = fakeClient({ ok: true });
    await new ServerManagementModule(client).simulateMSWCleanup();
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe(`${BASE}/Dips/SimulateMSWCleanup`);
  });

  it('mswCleanup POSTs /Dips/MSWCleanup — asserted against a fake, never a network', async () => {
    // This operation is forbidden against the live estate: it targets the
    // Master DIP. The client here is an object literal; nothing leaves the
    // process. Pinning the route matters MORE for a dangerous operation, not
    // less — a transposition between these two is not recoverable.
    const { client, calls } = fakeClient({ ok: true });
    await new ServerManagementModule(client).mswCleanup();
    expect(calls[0]?.url).toBe(`${BASE}/Dips/MSWCleanup`);
  });

  it('the simulation and the real thing are different URLs', async () => {
    const { client, calls } = fakeClient({ ok: true });
    const mod = new ServerManagementModule(client);
    await mod.simulateMSWCleanup();
    await mod.mswCleanup();
    expect(calls[0]?.url).not.toBe(calls[1]?.url);
    expect(calls[0]?.url).toContain('Simulate');
    expect(calls[1]?.url).not.toContain('Simulate');
  });
});

describe('ServerManagementModule — security groups and profiles', () => {
  it('createSecurityGroup POSTs /SecurityGroups and returns the transport payload', async () => {
    const created = { id: 'sg-9' };
    const { client, calls } = fakeClient(created);
    const result = await new ServerManagementModule(client).createSecurityGroup({ name: 'Ops' } as never);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/SecurityGroups` });
    expect(result).toEqual(created);
  });

  it('deleteSecurityGroup DELETEs /SecurityGroups/{id}', async () => {
    const { client, calls } = fakeClient();
    await new ServerManagementModule(client).deleteSecurityGroup('sg-1');
    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/SecurityGroups/sg-1` }]);
  });

  it('createSecurityProfile POSTs /SecurityProfiles', async () => {
    const created = { id: 'sp-9' };
    const { client, calls } = fakeClient(created);
    const result = await new ServerManagementModule(client).createSecurityProfile({ name: 'RO' } as never);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/SecurityProfiles` });
    expect(result).toEqual(created);
  });

  it('deleteSecurityProfile DELETEs /SecurityProfiles/{id}', async () => {
    const { client, calls } = fakeClient();
    await new ServerManagementModule(client).deleteSecurityProfile('sp-1');
    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/SecurityProfiles/sp-1` }]);
  });
});

describe('ServerManagementModule — the three PATCHes', () => {
  it('updateSecurityGroup PATCHes /SecurityGroups/{id} WITH the content type', async () => {
    const { client, calls } = fakeClient({ id: 'sg-1' });
    await new ServerManagementModule(client).updateSecurityGroup('sg-1', DOC);
    expect(calls[0]).toEqual({
      method: 'PATCH', url: `${BASE}/SecurityGroups/sg-1`, body: DOC, headers: PATCH_HEADERS,
    });
  });

  it('updateSecurityProfile PATCHes /SecurityProfiles/{id} WITH the content type', async () => {
    const { client, calls } = fakeClient({ id: 'sp-1' });
    await new ServerManagementModule(client).updateSecurityProfile('sp-1', DOC);
    expect(calls[0]).toEqual({
      method: 'PATCH', url: `${BASE}/SecurityProfiles/sp-1`, body: DOC, headers: PATCH_HEADERS,
    });
  });

  it('updateObjectPermission PATCHes /Objects/{id} — not /Objects/{id}/Rights', async () => {
    // The READ of the same concept is `/Objects/{id}/Rights`. The write is the
    // bare object. Symmetry would be wrong here.
    const { client, calls } = fakeClient({ id: 'obj-1' });
    await new ServerManagementModule(client).updateObjectPermission('obj-1', DOC);
    expect(calls[0]?.url).toBe(`${BASE}/Objects/obj-1`);
    expect(calls[0]?.url).not.toContain('/Rights');
    expect(calls[0]?.headers).toEqual(PATCH_HEADERS);
  });

  it('no PATCH in this module is left bare — counted, not listed', async () => {
    const { client, calls } = fakeClient({ id: 'x' });
    const mod = new ServerManagementModule(client);
    await mod.updateSecurityGroup('sg-1', DOC);
    await mod.updateSecurityProfile('sp-1', DOC);
    await mod.updateObjectPermission('obj-1', DOC);
    const bare = calls
      .filter((c) => c.method === 'PATCH')
      .filter((c) => c.headers?.['Content-Type'] !== 'application/json-patch+json');
    expect(bare.map((c) => c.url)).toEqual([]);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(3);
  });
});

describe('ServerManagementModule — coverage of the surface', () => {
  it('every async method on the prototype has a route assertion', () => {
    const tested = new Set<string>([
      ...PLAIN_READS.map(([m]) => String(m)),
      ...ID_READS.map(([m]) => String(m)),
      ...ID_ACTIONS.map(([m]) => String(m)),
      'restartManagementServer', 'cancelScheduledRestart',
      'simulateMSWCleanup', 'mswCleanup',
      'createSecurityGroup', 'updateSecurityGroup', 'deleteSecurityGroup',
      'createSecurityProfile', 'updateSecurityProfile', 'deleteSecurityProfile',
      'updateObjectPermission',
    ]);
    const onPrototype = Object.getOwnPropertyNames(ServerManagementModule.prototype).filter(
      (n) => n !== 'constructor'
    );
    const untested = onPrototype.filter((n) => !tested.has(n));
    expect(
      untested,
      `${untested.length} method(s) on the highest-consequence write surface in the suite have ` +
        `no route assertion: ${untested.join(', ')}`
    ).toEqual([]);
  });
});
