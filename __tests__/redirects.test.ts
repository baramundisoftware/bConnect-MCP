/**
 * Credentials never follow a redirect (REQ-SRV-021, decision D1 = a).
 *
 * bConnect declares no redirect responses, so the shared client doesn't follow
 * any. A redirect becomes an error that names only the target's origin. Real
 * HTTP servers on ephemeral ports, not MSW, so the redirect actually happens.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';

const API_KEY = 'redirect-test-api-key-1234567890';
const PASSWORD = 'redirect-test-password-0987654321';

type Seen = { host?: string; path?: string; apiKey?: string; auth?: string };
let reached: Seen[] = [];
let originPort = 0;
let targetPort = 0;
let redirectTo: (path: string) => string | undefined = () => undefined;

const target = http.createServer((req, res) => {
  reached.push({ host: req.headers.host, path: req.url, apiKey: req.headers['x-api-key'] as string, auth: req.headers.authorization });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"data":[]}');
});
const origin = http.createServer((req, res) => {
  const location = redirectTo(req.url ?? '');
  if (location === undefined) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"data":[]}');
    return;
  }
  res.writeHead(302, location ? { location } : {});
  res.end();
});

const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));

beforeAll(async () => {
  originPort = await listen(origin);
  targetPort = await listen(target);
});
afterAll(() => { origin.close(); target.close(); });

const client = (auth: 'apikey' | 'basic') => new BConnectClientBase({
  baseUrl: `http://127.0.0.1:${originPort}/bconnect`,
  ...(auth === 'apikey' ? { apiKey: API_KEY } : { username: 'redirect-user', password: PASSWORD }),
  disableHttpsAgent: true,
}) as unknown as { client: { get: (u: string) => Promise<unknown> } };

/** The request's error, or null if it succeeded; never throws, so `reached` is checked first. */
const outcome = (p: Promise<unknown>): Promise<Error | null> => p.then(() => null, (e: Error) => e);

describe.each(['apikey', 'basic'] as const)('redirects with %s credentials', (auth) => {
  it.each([
    ['another hostname', () => `http://localhost:${targetPort}/stolen?x=1`, () => `http://localhost:${targetPort}`],
    ['the same host on another port', () => `http://127.0.0.1:${targetPort}/stolen`, () => `http://127.0.0.1:${targetPort}`],
  ])('to %s are not followed, and the error names only the origin', async (_case, location, expectedOrigin) => {
    reached = [];
    redirectTo = () => location();
    const error = await outcome(client(auth).client.get('/endpoints/v2.0/Endpoints'));
    expect(reached).toEqual([]);
    expect(error?.message).toContain(expectedOrigin());
    expect(error?.message).toMatch(/BCONNECT_BASE_URL/);
    expect(error?.message).not.toContain('/stolen');
    expect(error?.message).not.toContain(API_KEY);
    expect(error?.message).not.toContain(PASSWORD);
  });

  it('reports a redirect without a Location header as going to an unknown address', async () => {
    reached = [];
    redirectTo = () => '';
    const error = await outcome(client(auth).client.get('/endpoints/v2.0/Endpoints'));
    expect(reached).toEqual([]);
    expect(error?.message).toMatch(/unknown address/);
  });

  it('resolves a relative Location against the request', async () => {
    redirectTo = () => '/elsewhere';
    const error = await outcome(client(auth).client.get('/endpoints/v2.0/Endpoints'));
    expect(error?.message).toContain(`http://127.0.0.1:${originPort}`);
    expect(error?.message).not.toContain('/elsewhere');
  });

  it('still answers normally without a redirect', async () => {
    redirectTo = () => undefined;
    await expect(client(auth).client.get('/endpoints/v2.0/Endpoints')).resolves.toBeDefined();
  });
});
