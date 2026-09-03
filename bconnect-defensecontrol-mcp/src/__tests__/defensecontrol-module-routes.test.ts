/**
 * `DefenseControlModule` — verb/route assertions for all 14 methods.
 *
 * Before this file, `defensecontrol.ts` measured **24.34% statements / 25%
 * functions** while the workspace passed its floor of 73 at 79.6% — carried by
 * `security-posture.ts` (95.5%) and `time-budget.ts` (96.9%) either side of it.
 * This is the server holding BitLocker recovery secrets and local administrator
 * credentials, and three quarters of its route surface had no assertion.
 *
 * Fake `AxiosInstance`. No network, no live bMS, no mock server.
 *
 * ── What this module already knew, and forgot next door ─────────────────────
 * `updateBitLockerPin` sets `Content-Type: application/json-patch+json`. It is
 * the method with a documented historical defect, and it was fixed. Ninety
 * lines above it, `patchLocalAdminUserCredentials` did not — until 2026-08-19.
 * One file, two PATCHes, one of them corrected and its neighbour left alone:
 * the instance was fixed and the class never was. Both are pinned below.
 *
 * ── A duplicate that was deleted, recorded so it does not come back ─────────
 * `triggerLocalAdminAccountsUpdate` used to POST the SAME route as
 * `triggerUpdateOnClient`. It was wired to no tool, reachable from no caller in
 * the repository, and — unlike the surviving method — could not forward the
 * `timeout` the route accepts, so calling it by mistake would have silently
 * dropped that parameter. Removed 2026-08-19, after confirming with ripgrep
 * across the whole tree that nothing referenced it.
 *
 * The surviving method is asserted below, including that it forwards the
 * timeout and omits the parameter entirely when none is given. A third test
 * walks the prototype and fails if ANY second method can reach that route
 * again, which is what would catch a re-introduction under a new name.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { DefenseControlModule } from '../modules/defensecontrol.js';

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
    post: async (url: string, body?: unknown, config?: { params?: unknown }) => {
      calls.push({ method: 'POST', url, body, params: config?.params });
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
  new DefenseControlModule(fakeClient().client) as unknown as { basePath: string }
).basePath;
const EMPTY_PAGE = { data: [], totalItems: 0 };
const PATCH_HEADERS = { 'Content-Type': 'application/json-patch+json' };
const DOC = [{ op: 'replace', path: '/pin', value: '0000' }] as never;
const TRIGGER_ROUTE = (id: string): string =>
  `${BASE}/LocalAdministrativeAccounts/WindowsEndpoints/${id}/TriggerUpdateOnClient`;

describe('DefenseControlModule — the base path itself', () => {
  it('basePath is the version this module is written against', () => {
    expect(BASE).toBe('/defensecontrol/v2.0');
  });
});

describe('DefenseControlModule — BitLocker', () => {
  it('getBitLockerWindowsEndpoints GETs /BitLocker/WindowsEndpoints', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new DefenseControlModule(client).getBitLockerWindowsEndpoints();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe(`${BASE}/BitLocker/WindowsEndpoints`);
  });

  it('getBitLockerWindowsEndpoint GETs /BitLocker/WindowsEndpoints/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'ep-1' });
    await new DefenseControlModule(client).getBitLockerWindowsEndpoint('ep-1');
    expect(calls[0]?.url).toBe(`${BASE}/BitLocker/WindowsEndpoints/ep-1`);
  });

  it('getBitLockerSecrets GETs the /Secrets sub-resource, not the endpoint itself', async () => {
    // The recovery keys live one segment further down. Reading the parent
    // returns an endpoint record and no secrets, and both answer 200.
    const { client, calls } = fakeClient({ recoveryKey: 'REDACTED' });
    await new DefenseControlModule(client).getBitLockerSecrets('ep-1');
    expect(calls[0]?.url).toBe(`${BASE}/BitLocker/WindowsEndpoints/ep-1/Secrets`);
    expect(calls[0]?.url).not.toBe(`${BASE}/BitLocker/WindowsEndpoints/ep-1`);
  });

  it('updateBitLockerPin PATCHes /Secrets WITH the json-patch content type', async () => {
    const { client, calls } = fakeClient({ id: 'ep-1' });
    await new DefenseControlModule(client).updateBitLockerPin('ep-1', DOC);
    expect(calls[0]).toEqual({
      method: 'PATCH',
      url: `${BASE}/BitLocker/WindowsEndpoints/ep-1/Secrets`,
      body: DOC,
      headers: PATCH_HEADERS,
    });
  });
});

describe('DefenseControlModule — local administrative accounts', () => {
  it('getLocalAdministrativeAccounts GETs the endpoint-scoped route', async () => {
    const { client, calls } = fakeClient({ accounts: [] });
    await new DefenseControlModule(client).getLocalAdministrativeAccounts('ep-1');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe(`${BASE}/LocalAdministrativeAccounts/WindowsEndpoints/ep-1`);
  });

  it('patchLocalAdminUserCredentials PATCHes WITH the content type — the neighbour that was bare', async () => {
    // This is the regression. `updateBitLockerPin`, in the same file, had set
    // the header for as long as it has existed; this one never did.
    const { client, calls } = fakeClient({ id: 'ep-1' });
    await new DefenseControlModule(client).patchLocalAdminUserCredentials('ep-1', DOC);
    expect(calls[0]).toEqual({
      method: 'PATCH',
      url: `${BASE}/LocalAdministrativeAccounts/WindowsEndpoints/ep-1`,
      body: DOC,
      headers: PATCH_HEADERS,
    });
  });

  it('both PATCHes in this module carry the content type — counted, not listed', async () => {
    const { client, calls } = fakeClient({ id: 'x' });
    const mod = new DefenseControlModule(client);
    await mod.updateBitLockerPin('ep-1', DOC);
    await mod.patchLocalAdminUserCredentials('ep-1', DOC);
    const patches = calls.filter((c) => c.method === 'PATCH');
    const bare = patches.filter(
      (c) => c.headers?.['Content-Type'] !== 'application/json-patch+json'
    );
    expect(bare.map((c) => c.url)).toEqual([]);
    expect(patches).toHaveLength(2);
  });
});

describe('DefenseControlModule — the local-admin update trigger', () => {
  it('triggerUpdateOnClient POSTs the trigger route and forwards a timeout', async () => {
    const { client, calls } = fakeClient(true);
    await new DefenseControlModule(client).triggerUpdateOnClient('ep-1', 5000);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe(TRIGGER_ROUTE('ep-1'));
    expect(calls[0]?.params).toEqual({ timeout: 5000 });
  });

  it('omits the timeout param entirely when none is given', async () => {
    const { client, calls } = fakeClient(true);
    await new DefenseControlModule(client).triggerUpdateOnClient('ep-1');
    expect(calls[0]?.params).toEqual({});
  });

  it('is the ONLY method on this class that can reach the trigger route', async () => {
    // The deleted duplicate posted here too. Walking the prototype rather than
    // naming methods means a re-introduction under any name fails this, which a
    // hand-written list could not do.
    const reachers: string[] = [];
    for (const name of Object.getOwnPropertyNames(DefenseControlModule.prototype)) {
      if (name === 'constructor') { continue; }
      const { client, calls } = fakeClient(true);
      const mod = new DefenseControlModule(client);
      try {
        await (
          mod[name as keyof DefenseControlModule] as unknown as (a: string) => Promise<unknown>
        ).call(mod, 'ep-1');
      } catch {
        continue;
      }
      if (calls.some((c) => c.url === TRIGGER_ROUTE('ep-1'))) { reachers.push(name); }
    }
    expect(
      reachers,
      `${reachers.length} method(s) reach the trigger route; exactly one should: ` +
        `${reachers.join(', ')}`
    ).toEqual(['triggerUpdateOnClient']);
  });
});

describe('DefenseControlModule — Microsoft Defender', () => {
  it('getMicrosoftDefenderThreats GETs /MicrosoftDefender/Threats', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new DefenseControlModule(client).getMicrosoftDefenderThreats();
    expect(calls[0]?.url).toBe(`${BASE}/MicrosoftDefender/Threats`);
  });

  it('getMicrosoftDefenderThreat GETs /MicrosoftDefender/Threats/{id}', async () => {
    const { client, calls } = fakeClient({ id: 't-1' });
    await new DefenseControlModule(client).getMicrosoftDefenderThreat('t-1');
    expect(calls[0]?.url).toBe(`${BASE}/MicrosoftDefender/Threats/t-1`);
  });

  it('getMicrosoftDefenderThreatsByEndpoint scopes under /WindowsEndpoints/{id}/Threats', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new DefenseControlModule(client).getMicrosoftDefenderThreatsByEndpoint('ep-1');
    expect(calls[0]?.url).toBe(`${BASE}/MicrosoftDefender/WindowsEndpoints/ep-1/Threats`);
  });

  it('getMicrosoftDefenderThreatsByLogicalGroup scopes under /LogicalGroups/{id}/Threats', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new DefenseControlModule(client).getMicrosoftDefenderThreatsByLogicalGroup('lg-1');
    expect(calls[0]?.url).toBe(`${BASE}/MicrosoftDefender/LogicalGroups/lg-1/Threats`);
  });

  it('getMicrosoftDefenderWindowsEndpoints GETs the Defender endpoint list', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new DefenseControlModule(client).getMicrosoftDefenderWindowsEndpoints();
    expect(calls[0]?.url).toBe(`${BASE}/MicrosoftDefender/WindowsEndpoints`);
  });

  it('getMicrosoftDefenderWindowsEndpoint GETs one of them', async () => {
    const { client, calls } = fakeClient({ id: 'ep-1' });
    await new DefenseControlModule(client).getMicrosoftDefenderWindowsEndpoint('ep-1');
    expect(calls[0]?.url).toBe(`${BASE}/MicrosoftDefender/WindowsEndpoints/ep-1`);
  });

  it('the Defender endpoint list and the BitLocker one are different routes', async () => {
    // Both are "windows endpoints" and both live under this server. They differ by
    // the product prefix alone.
    const { client, calls } = fakeClient(EMPTY_PAGE);
    const mod = new DefenseControlModule(client);
    await mod.getMicrosoftDefenderWindowsEndpoints();
    await mod.getBitLockerWindowsEndpoints();
    expect(calls[0]?.url).not.toBe(calls[1]?.url);
  });
});

describe('DefenseControlModule — coverage of the surface', () => {
  it('every async method on the prototype has a route assertion', () => {
    const tested = new Set([
      'getBitLockerWindowsEndpoints', 'getBitLockerWindowsEndpoint', 'getBitLockerSecrets',
      'updateBitLockerPin', 'getLocalAdministrativeAccounts', 'patchLocalAdminUserCredentials',
      'triggerUpdateOnClient',
      'getMicrosoftDefenderThreats', 'getMicrosoftDefenderThreat',
      'getMicrosoftDefenderThreatsByEndpoint', 'getMicrosoftDefenderThreatsByLogicalGroup',
      'getMicrosoftDefenderWindowsEndpoints', 'getMicrosoftDefenderWindowsEndpoint',
    ]);
    const onPrototype = Object.getOwnPropertyNames(DefenseControlModule.prototype).filter(
      (n) => n !== 'constructor'
    );
    const untested = onPrototype.filter((n) => !tested.has(n));
    expect(
      untested,
      `${untested.length} method(s) on the server holding BitLocker secrets have no route ` +
        `assertion: ${untested.join(', ')}`
    ).toEqual([]);
  });
});
