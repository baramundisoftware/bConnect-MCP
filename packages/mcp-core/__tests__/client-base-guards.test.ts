/**
 * Shared-client behaviour: B1, PER-12, PER-18, SEC-0, SEC-1, SEC-2, INT-43.
 *
 * All thirteen servers extend `BConnectClientBase` unchanged, so testing the
 * base here covers the suite. Requests are served by a stub axios adapter, so
 * nothing in this file touches a network or the live bMS estate.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import {
  BConnectClientBase,
  PathContainmentError,
  SecuritySensitiveRouteError,
  RateLimitError,
} from '@bconnect/mcp-core';

const CREDENTIAL = 'svcacct:SuperSecret123';

function makeClient(overrides: Record<string, unknown> = {}): BConnectClientBase {
  return new BConnectClientBase({
    baseUrl: 'https://bms.example.invalid/bconnect',
    username: 'svcacct',
    password: 'SuperSecret123',
    ...overrides,
  });
}

/** Record every request the client dispatches and answer it with `data`. */
function stubTransport(client: BConnectClientBase, data: unknown = { data: [], totalPages: 1 }) {
  const seen: InternalAxiosRequestConfig[] = [];
  client.getHttpClient().defaults.adapter = async (config) => {
    seen.push(config as InternalAxiosRequestConfig);
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    } as never;
  };
  return seen;
}

/** Fail the request the way a real bMS would, headers and all. */
function failingTransport(client: BConnectClientBase, status: number, body: unknown) {
  client.getHttpClient().defaults.adapter = async (config) => {
    const err = new AxiosError(
      `Request failed with status code ${status}`,
      String(status),
      config as InternalAxiosRequestConfig,
      { _header: `Authorization: Basic ${Buffer.from(CREDENTIAL).toString('base64')}` },
      {
        data: body,
        status,
        statusText: 'Error',
        headers: {},
        config,
      } as never
    );
    throw err;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ALLOW_SECRET_READ;
  delete process.env.BCONNECT_RELEASE;
});

/** Answer the bMS version route with `status`, everything else with 200. */
function versionRouteFailingTransport(client: BConnectClientBase, status: number) {
  const seen: InternalAxiosRequestConfig[] = [];
  client.getHttpClient().defaults.adapter = async (config) => {
    seen.push(config as InternalAxiosRequestConfig);
    if ((config.url ?? '').includes('/ManagementServer')) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        String(status),
        config as InternalAxiosRequestConfig,
        {},
        { data: null, status, statusText: 'Error', headers: {}, config } as never
      );
    }
    return { data: { data: [] }, status: 200, statusText: 'OK', headers: {}, config } as never;
  };
  return seen;
}

describe('startup connectivity probe (B1, PER-18, VER-1)', () => {
  it('probes the ManagementServer version route — one request proves connectivity AND yields the bMS version', async () => {
    const client = makeClient();
    const seen = stubTransport(client, { name: 'bms01', version: '26.1.180.0' });

    await expect(client.testConnection()).resolves.toBe(true);

    // B1 still holds: module-prefixed, never the bare /v2.0 path that 401s.
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/servermanagement/v2.0/ManagementServer');
    expect(client.getConnectionProbe()).toEqual({ outcome: 'version', version: '26.1.180.0' });
  });

  it('falls back to the module health route when the version route is denied, with the paging parameter the API actually reads', async () => {
    const client = makeClient();
    const seen = versionRouteFailingTransport(client, 403);

    await expect(client.testConnection()).resolves.toBe(true);

    // Requirement: a credential scoped away from servermanagement is not
    // bricked — connectivity is verified the pre-gate way instead.
    expect(seen).toHaveLength(2);
    expect(seen[1].url).toBe('/endpoints/v2.0/Endpoints');
    // $top is OData; bConnect v2.0 declares Page/PageSize only, so $top was
    // ignored and the server's default page of 20 fat rows came back instead.
    expect(seen[1].params).toEqual({ PageSize: 1 });
    expect(seen[1].params).not.toHaveProperty('$top');
    expect(client.getConnectionProbe()).toEqual({ outcome: 'denied', status: 403 });
  });

  it('still honours a per-server healthCheckPath override in the fallback', async () => {
    const client = makeClient({ healthCheckPath: '/variables/v2.0/Variables' });
    const seen = versionRouteFailingTransport(client, 404);

    await expect(client.testConnection()).resolves.toBe(true);

    expect(seen[1].url).toBe('/variables/v2.0/Variables');
  });
});

describe('connectivity failure logging (SEC-2)', () => {
  it('never writes the Basic-auth credential to stderr', async () => {
    const client = makeClient();
    failingTransport(client, 401, { message: 'Unauthorized' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(client.testConnection()).resolves.toBe(false);

    expect(spy).toHaveBeenCalled();
    const emitted = spy.mock.calls.map((args) => args.map((a) => String(a)).join(' ')).join('\n');
    expect(emitted).not.toContain('Basic ');
    expect(emitted).not.toContain('X-Api-Key');
    expect(emitted).not.toContain(Buffer.from(CREDENTIAL).toString('base64'));
    expect(emitted).not.toContain('SuperSecret123');
  });

  it('logs one preformatted string, never an object for util.inspect to walk', async () => {
    // This is the actual regression guard. The old call was
    // `console.error("Connection test failed:", error)` on a raw AxiosError, and
    // util.inspect walks error.config.headers — where setupAuth() put the
    // credential. On a stdio server that stderr is captured verbatim into the
    // MCP host's log files on disk.
    const client = makeClient();
    failingTransport(client, 500, { message: 'boom' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await client.testConnection();

    for (const call of spy.mock.calls) {
      expect(call).toHaveLength(1);
      expect(typeof call[0]).toBe('string');
    }
    expect(String(spy.mock.calls[0][0])).toContain('Connection test failed:');
  });

  it('does the same for an API-key deployment', async () => {
    const client = new BConnectClientBase({
      baseUrl: 'https://bms.example.invalid/bconnect',
      apiKey: 'a-very-secret-api-key',
    });
    failingTransport(client, 401, { message: 'Unauthorized' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await client.testConnection();

    const emitted = spy.mock.calls.map((args) => args.map((a) => String(a)).join(' ')).join('\n');
    expect(emitted).not.toContain('a-very-secret-api-key');
  });
});

describe('path containment at the transport (SEC-0)', () => {
  it('refuses a traversal id even when no server-side validator ran', async () => {
    const client = makeClient();
    const seen = stubTransport(client);

    await expect(
      client
        .getHttpClient()
        .get('/endpoints/v2.0/Endpoints/../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints')
    ).rejects.toBeInstanceOf(PathContainmentError);

    // The point: nothing was dispatched.
    expect(seen).toHaveLength(0);
  });

  it('keeps the precise error instead of flattening it in handleError', async () => {
    const client = makeClient();
    stubTransport(client);

    await expect(
      client.getHttpClient().get('/jobs/v2.0/JobDefinitions/../../../servermanagement/v2.0/ApiKeys')
    ).rejects.toThrow(/escapes its API module/);
  });

  it('does not disturb legitimate cross-module traffic', async () => {
    const client = makeClient();
    const seen = stubTransport(client);

    // stale-endpoints.ts issues exactly this from the endpoints server.
    await client.getHttpClient().get('/jobs/v2.0/JobInstances', { params: { PageSize: 1000 } });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/jobs/v2.0/JobInstances');
  });
});

describe('credential-route deny-list (SEC-1)', () => {
  const SECRETS = '/defensecontrol/v2.0/BitLocker/WindowsEndpoints/abc/Secrets';
  const LAPS = '/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/abc';

  it('refuses BitLocker secrets when ALLOW_SECRET_READ is unset', async () => {
    const client = makeClient();
    const seen = stubTransport(client);

    await expect(client.getHttpClient().get(SECRETS)).rejects.toBeInstanceOf(
      SecuritySensitiveRouteError
    );
    expect(seen).toHaveLength(0);
  });

  it('refuses the LAPS credential patch, which had no secret gate at all', async () => {
    const client = makeClient();
    stubTransport(client);

    await expect(client.getHttpClient().patch(LAPS, [])).rejects.toThrow(/ALLOW_SECRET_READ/);
  });

  it('permits both once the operator opens the gate', async () => {
    process.env.ALLOW_SECRET_READ = 'true';
    const client = makeClient();
    const seen = stubTransport(client);

    await client.getHttpClient().get(SECRETS);
    await client.getHttpClient().get(LAPS);

    expect(seen.map((c) => c.url)).toEqual([SECRETS, LAPS]);
  });

  it('dispatches the LAPS rotation, which returns no credential (A1)', async () => {
    // refresh_local_admin_account_expiry POSTs this. It answers `boolean`, so it belongs
    // to ALLOW_WRITE_OPERATIONS, not ALLOW_SECRET_READ — but the round-2
    // deny-list matched the whole /LocalAdministrativeAccounts/ sub-tree and
    // refused it at the transport, making the tool unreachable in the
    // documented posture. ALLOW_SECRET_READ is deliberately unset here.
    const client = makeClient();
    const seen = stubTransport(client, true);

    await client.getHttpClient().post(`${LAPS}/TriggerUpdateOnClient`);

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`${LAPS}/TriggerUpdateOnClient`);
  });
});

describe('API error detail (INT-43)', () => {
  it('carries the route and the API payload into a 404', async () => {
    const client = makeClient();
    failingTransport(client, 404, { message: 'No endpoint with that id.' });

    await expect(
      client.getHttpClient().get('/endpoints/v2.0/Endpoints/00000000-0000-0000-0000-000000000000')
    ).rejects.toThrow(/Resource not found\./);

    const err = await client
      .getHttpClient()
      .get('/endpoints/v2.0/Endpoints/00000000-0000-0000-0000-000000000000')
      .catch((e: Error) => e) as unknown as Error;

    expect(err.message).toContain('GET /endpoints/v2.0/Endpoints/00000000-0000-0000-0000-000000000000');
    expect(err.message).toContain('No endpoint with that id.');
    // The recovery hint the README's troubleshooting table knows and the runtime
    // error never carried. It used to point at BCONNECT_RELEASE; that setting was
    // removed when the suite became 26R1-only and the version is verified at
    // startup instead, so the hint now names the ambiguity that actually remains —
    // a wrong id versus a route this bMS does not serve. Asserting the old text
    // would pin a message telling operators to check a knob that no longer exists.
    expect(err.message).toContain('does not serve');
    expect(err.message).toContain('26R1');
    expect(err.message).not.toContain('BCONNECT_RELEASE');
  });

  it('surfaces a 400 validation body so a model can correct itself', async () => {
    const client = makeClient();
    failingTransport(client, 400, { errors: { DisplayName: ['must not be empty'] } });

    const err = await client
      .getHttpClient()
      .post('/endpoints/v2.0/WindowsEndpoints', {})
      .catch((e: Error) => e) as unknown as Error;

    expect(err.message).toContain('HTTP 400');
    expect(err.message).toContain('must not be empty');
  });

  it('keeps the original opening sentence of every mapped status', async () => {
    const cases: Array<[number, RegExp]> = [
      [401, /^Authentication failed\./],
      [403, /^Access denied\./],
      [404, /^Resource not found\./],
      [429, /^Rate limit exceeded\./],
      [500, /^bConnect API returned an internal server error\./],
    ];
    for (const [status, opening] of cases) {
      const client = makeClient();
      failingTransport(client, status, null);
      const err = await client.getHttpClient().get('/endpoints/v2.0/Endpoints').catch((e: Error) => e) as unknown as Error;
      expect(err.message).toMatch(opening);
    }
  });

  it('truncates a large error body rather than pasting an estate into the message', async () => {
    const client = makeClient();
    failingTransport(client, 500, { detail: 'x'.repeat(5000) });

    const err = await client.getHttpClient().get('/endpoints/v2.0/Endpoints').catch((e: Error) => e) as unknown as Error;

    expect(err.message.length).toBeLessThan(1000);
    expect(err.message).toContain('...');
  });

  it('never echoes the internal hostname', async () => {
    const client = makeClient();
    failingTransport(client, 404, { message: 'nope' });

    const err = await client.getHttpClient().get('/endpoints/v2.0/Endpoints/x').catch((e: Error) => e) as unknown as Error;

    expect(err.message).not.toContain('bms.example.invalid');
  });
});

describe('client-side rate limiting preserves error identity (F3 residual)', () => {
  it('rethrows the RateLimitError instance itself, not a flattened plain Error', async () => {
    // maxRequests: 1 with burst disabled means the second call in the same
    // instant is rejected by the request interceptor before it ever reaches
    // the transport (stubTransport's adapter is never invoked for it).
    const client = makeClient({
      rateLimit: { enabled: true, maxRequests: 1, windowMs: 60_000 },
    });
    const seen = stubTransport(client);

    await client.getHttpClient().get('/endpoints/v2.0/Endpoints');
    expect(seen).toHaveLength(1);

    const err = await client
      .getHttpClient()
      .get('/endpoints/v2.0/Endpoints')
      .catch((e: unknown) => e);

    // The point of this test: a caller (or a retry wrapper) must be able to
    // do `catch (e) { if (e instanceof RateLimitError) ... }` and read
    // `e.info.remaining`/`e.info.resetInMs` directly. Before the fix,
    // handleError() caught this and threw `new Error(...)` instead, so this
    // instanceof check failed and `.info` did not exist on the thrown value.
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).info.allowed).toBe(false);
    expect((err as RateLimitError).info.remaining).toBe(0);
    expect(typeof (err as RateLimitError).info.resetInMs).toBe('number');
    // Only one request ever reached the transport — the second was stopped
    // by the interceptor, exactly as it was before this fix.
    expect(seen).toHaveLength(1);
  });
});

describe('HTTP keep-alive (PER-12)', () => {
  it('reuses sockets instead of handshaking per request', () => {
    const agent = makeClient().getHttpClient().defaults.httpsAgent as { keepAlive?: boolean };
    // An explicitly constructed https.Agent defaults keepAlive to false; only
    // https.globalAgent has had it on since Node 19.
    expect(agent.keepAlive).toBe(true);
  });

  it('leaves the MSW test path without a custom agent', () => {
    const client = makeClient({ disableHttpsAgent: true });
    expect(client.getHttpClient().defaults.httpsAgent).toBeUndefined();
  });
});
