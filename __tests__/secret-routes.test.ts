/**
 * Secret-route gate in the shared client (REQ-SRV-017, ADR-0004), the second lock.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  SECRET_ROUTES, SecretRouteBlockedError, assertSecretRouteAllowed, isSecretRoute,
} from '../packages/mcp-core/src/secret-routes';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base';
import { RELEASES, secretBearingOperations } from './lib/spec-secrets';

const ID = '00000000-0000-4000-8000-000000000001';
const BITLOCKER = `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/${ID}/Secrets`;
const LAPS = `/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`;
const TRIGGER = `${LAPS}/TriggerUpdateOnClient`;

/** Secret-bearing operations deliberately left out of the route gate. */
const NOT_DENIED: Record<string, string> = {
  'POST endpoints /v2.0/AndroidEndpoints/{id}/StartEnrollment': 'deferred: enrollment-token classification pending',
  'POST endpoints /v2.0/IosEndpoints/{id}/StartEnrollment': 'deferred: enrollment-token classification pending',
  'POST endpoints /v2.0/MacEndpoints/{id}/StartEnrollment': 'deferred: enrollment-token classification pending',
};

describe('route classification', () => {
  it.each([
    ['GET', BITLOCKER], ['PATCH', BITLOCKER], ['GET', LAPS], ['PATCH', LAPS],
    ['patch', `${LAPS}/`], ['GET', `${BITLOCKER}?x=1`], ['GET', `https://bms.example/bconnect${BITLOCKER}`],
  ])('denies %s %s', (method, url) => {
    expect(isSecretRoute(method, url)).toBe(true);
  });

  it.each([
    ['POST', TRIGGER],                                                        // returns a boolean
    ['GET', `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/${ID}`],         // status only
    ['GET', '/defensecontrol/v2.0/BitLocker/WindowsEndpoints'],
    ['DELETE', LAPS],                                                         // not a secret-returning method
    ['GET', `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/${ID}/Pin`],     // not an API route
    ['GET', `/endpoints/v2.0/Endpoints/${ID}`],
  ])('allows %s %s', (method, url) => {
    expect(isSecretRoute(method, url)).toBe(false);
  });

  it('refuses unless ALLOW_SECRET_READ=true', () => {
    expect(() => assertSecretRouteAllowed('GET', LAPS, {})).toThrow(SecretRouteBlockedError);
    expect(() => assertSecretRouteAllowed('GET', LAPS, { ALLOW_SECRET_READ: 'false' })).toThrow(/ALLOW_SECRET_READ=true/);
    expect(() => assertSecretRouteAllowed('GET', LAPS, { ALLOW_SECRET_READ: 'true' })).not.toThrow();
    expect(() => assertSecretRouteAllowed('POST', TRIGGER, {})).not.toThrow();
  });

  it('covers exactly the secret-bearing operations the specs declare', () => {
    const derived = new Set<string>();
    for (const release of RELEASES) {
      for (const op of secretBearingOperations(release)) derived.add(`${op.method} ${op.domain} ${op.path}`);
    }
    const expected = [...derived].filter((k) => !NOT_DENIED[k]).sort();
    const actual = SECRET_ROUTES.map((r) => `${r.method} ${r.domain} ${r.path}`).sort();
    expect(actual).toEqual(expected);
    // An exception that no longer matches a derived operation must be removed.
    expect(Object.keys(NOT_DENIED).filter((k) => !derived.has(k))).toEqual([]);
  });
});

describe('shared client refuses before sending', () => {
  const sent: string[] = [];
  const msw = setupServer(http.all('*', ({ request }) => {
    sent.push(`${request.method} ${new URL(request.url).pathname}`);
    return HttpResponse.json({ ok: true });
  }));
  const saved = process.env.ALLOW_SECRET_READ;
  const client = () =>
    new BConnectClientBase({ baseUrl: 'http://bms.routes.test/bconnect', username: 'u', password: 'p' }) as unknown as {
      client: { get: (u: string) => Promise<unknown>; patch: (u: string, d: unknown) => Promise<unknown>; post: (u: string) => Promise<unknown> };
    };

  beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    sent.length = 0;
    if (saved === undefined) delete process.env.ALLOW_SECRET_READ; else process.env.ALLOW_SECRET_READ = saved;
  });
  afterAll(() => msw.close());

  it('blocks a secret route with ALLOW_SECRET_READ unset, and nothing goes out', async () => {
    process.env.ALLOW_SECRET_READ = '';
    await expect(client().client.get(BITLOCKER)).rejects.toThrow(/ALLOW_SECRET_READ=true/);
    await expect(client().client.patch(LAPS, [])).rejects.toBeInstanceOf(SecretRouteBlockedError);
    expect(sent).toEqual([]);
  });

  it('sends it once the operator opens the gate', async () => {
    process.env.ALLOW_SECRET_READ = 'true';
    await client().client.get(BITLOCKER);
    expect(sent).toEqual([`GET /bconnect${BITLOCKER}`]);
  });

  it('never blocks an ordinary route', async () => {
    process.env.ALLOW_SECRET_READ = '';
    await client().client.post(TRIGGER);
    expect(sent).toEqual([`POST /bconnect${TRIGGER}`]);
  });
});
