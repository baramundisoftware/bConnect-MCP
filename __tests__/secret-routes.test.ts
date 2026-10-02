/**
 * Secret-route gate in the shared client (REQ-SRV-017, ADR-0004), the second lock.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  SECRET_ROUTES, SecretRouteBlockedError, assertSecretRouteAllowed, isSecretRoute,
} from '../packages/mcp-core/src/secret-routes.js';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';
import { RELEASES, secretBearingOperations } from './lib/spec.js';

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

  // The gate must match the path the server will serve, not the raw string.
  const LAPS_REL = `defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`;
  it.each([
    ['dot segments', `/endpoints/v2.0/Endpoints/../../../${LAPS_REL}`],
    ['encoded dots', `/endpoints/v2.0/Endpoints/%2e%2e/%2e%2e/%2e%2e/${LAPS_REL}`],
    ['encoded slashes', `/endpoints/v2.0/Endpoints/../../../${LAPS_REL.replace(/\//g, '%2F')}`],
    ['encoded slashes before the dots', `/endpoints/v2.0/Endpoints/..%2F..%2F..%2F${LAPS_REL}`],
    ['double encoding', `/endpoints/v2.0/Endpoints/..%252F..%252F..%252F${LAPS_REL.replace(/\//g, '%252F')}`],
    ['backslashes', `/endpoints/v2.0/Endpoints/..\\..\\..\\${LAPS_REL.replace(/\//g, '\\')}`],
    ['a detour inside the domain', `/defensecontrol/v2.0/x/../LocalAdministrativeAccounts/WindowsEndpoints/${ID}`],
    ['encoded query marker', `/${LAPS_REL}%3Fx=1`],
    // Fail closed: a part that can't be decoded must not stop the rest from being decoded.
    ['a malformed escape before an encoded letter', `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/${ID}%ZZ/Secret%73`],
    ['a truncated escape before an encoded letter', `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/${ID}%4/Secret%73`],
    // Forms a web server may serve as the same route.
    ['a trailing dot', `${BITLOCKER}.`],
    ['a trailing encoded space', `${BITLOCKER}%20`],
    ['a path parameter', `${BITLOCKER};x=1`],
    ['a path parameter on the ID', `/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/${ID};x`],
    // URL parsers drop tab, LF and CR anywhere in a path; the server then sees the plain route.
    ['a tab inside a segment', BITLOCKER.replace('Secrets', 'Secr\tets')],
    ['a line feed inside a segment', BITLOCKER.replace('BitLocker', 'Bit\nLocker')],
    ['a carriage return inside a segment', LAPS.replace('LocalAdministrativeAccounts', 'Lo\rcalAdministrativeAccounts')],
    ['a dot segment with a trailing space', `${BITLOCKER}/x/.. `],
    ['a dot segment split by a tab', `${BITLOCKER}/x/.\t.`],
    ['an encoded no-break space at the end', `${BITLOCKER}%C2%A0`],
    ['an encoded control character inside a segment', BITLOCKER.replace('Secrets', 'Secr%00ets')],
    // The gate on its own (the path check refuses both before sending anyway).
    ['an escape split by a tab', BITLOCKER.replace('Secrets', 'Secr%\t65ts')],
    ['an invalid UTF-8 escape in front of an encoded traversal', `${BITLOCKER.replace('/Secrets', '')}/x%FF%2F..%2FSecrets`],
  ])('denies a secret route reached through %s', (_how, url) => {
    expect(isSecretRoute('GET', url)).toBe(true);
  });

  it('stays linear on long runs of the characters it strips', () => {
    const started = performance.now();
    for (const run of [' '.repeat(50_000), ';'.repeat(50_000), '. '.repeat(25_000), `${' '.repeat(50_000)}x`]) {
      expect(isSecretRoute('GET', `/endpoints/v2.0/Endpoints/${run}`)).toBe(false);
    }
    expect(performance.now() - started).toBeLessThan(1000);
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

  it('blocks a secret route reached by path traversal from another domain', async () => {
    process.env.ALLOW_SECRET_READ = '';
    await expect(
      client().client.get(`/endpoints/v2.0/Endpoints/../../../defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`),
    ).rejects.toBeInstanceOf(SecretRouteBlockedError);
    expect(sent).toEqual([]);
  });

  it('never blocks an ordinary route', async () => {
    process.env.ALLOW_SECRET_READ = '';
    await client().client.post(TRIGGER);
    expect(sent).toEqual([`POST /bconnect${TRIGGER}`]);
  });
});
