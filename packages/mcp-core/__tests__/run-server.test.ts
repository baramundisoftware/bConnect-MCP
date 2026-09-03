/**
 * The unified server bootstrap (OPT-32).
 *
 * Thirteen hand-written `main()`s, four behaviourally distinct. Every server
 * changes behaviour in at least one respect when it adopts `runServer`, so this
 * is a new file rather than an addition to an existing one — and it exists
 * because **none of the 89 test files in the suite asserted two of the three
 * properties below**:
 *
 *   (a) exit code and stderr on missing credentials       — asserted somewhere
 *   (b) exit code and stderr on missing BCONNECT_BASE_URL — asserted NOWHERE
 *   (c) that the client `testConnection()` probes is the
 *       one the tool dispatch uses                        — asserted NOWHERE
 *
 * (b) is the important one. Twelve of thirteen servers defaulted an unset
 * BCONNECT_BASE_URL to `https://bms.example.com:443/bconnect` and then sent
 * real credentials to it. It normally died in DNS; on an estate whose resolver
 * answers for that name, it did not.
 *
 * Nothing here opens a socket. `runServer` takes its environment, its stderr
 * sink, its exit function and its transports by injection, so the whole
 * bootstrap is exercised in-process.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runServer,
  shouldAutoStart,
  rejectUnauthorizedFromEnv,
  parsePort,
  missingBaseUrlMessage,
  missingCredentialsMessage,
  type ServerHandle,
  type ProbeableClient,
} from '@bconnect/mcp-core';

// ── Harness ──────────────────────────────────────────────────────────────────

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit(${code})`);
  }
}

interface Harness {
  lines: string[];
  exits: number[];
  /** Every client instance the fake `createServer` ever built. */
  built: FakeClient[];
  /** How many times `createServer` was called. */
  creations: number;
  run(env: Record<string, string | undefined>, overrides?: Partial<Options>): Promise<unknown>;
}

interface Options {
  connects: boolean;
  /** Omit `getClient` from the handle, as an unmigrated server would. */
  withoutGetClient: boolean;
  clientFactory?: (config: unknown) => FakeClient;
  http?: { express: unknown };
}

class FakeClient implements ProbeableClient {
  probes = 0;
  constructor(private readonly ok: boolean) {}
  async testConnection(): Promise<boolean> {
    this.probes += 1;
    return this.ok;
  }
}

class FakeServer {
  connected: unknown = null;
  closed = false;
  async connect(transport: unknown): Promise<void> {
    this.connected = transport;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

function harness(): Harness {
  const state: Harness = {
    lines: [],
    exits: [],
    built: [],
    creations: 0,
    async run(env, overrides = {}) {
      const options: Options = { connects: true, withoutGetClient: false, ...overrides };

      const createServer = (): ServerHandle<FakeClient> => {
        state.creations += 1;
        // Memoised exactly as `createClientProvider` memoises: one client per
        // createServer() call, built lazily, returned by identity thereafter.
        let client: FakeClient | null = null;
        const getClient = (): FakeClient => {
          if (client === null) {
            client = new FakeClient(options.connects);
            state.built.push(client);
          }
          return client;
        };
        return {
          server: new FakeServer() as unknown as ServerHandle['server'],
          ...(options.withoutGetClient ? {} : { getClient }),
        };
      };

      return runServer<FakeClient>({
        name: 'bconnect-test-mcp',
        createServer,
        ...(options.clientFactory ? { clientFactory: options.clientFactory } : {}),
        ...(options.http ? { http: options.http as never } : {}),
        env: env as NodeJS.ProcessEnv,
        log: (line) => state.lines.push(line),
        exit: ((code: number) => {
          state.exits.push(code);
          throw new ExitCalled(code);
        }) as (code: number) => never,
        skipDotenv: true,
      });
    },
  };
  return state;
}

const GOOD_ENV = {
  BCONNECT_BASE_URL: 'https://bms.internal.test:443/bconnect',
  BCONNECT_API_KEY: 'k',
};

// ─────────────────────────────────────────────────────────────────────────────

describe('(b) BCONNECT_BASE_URL is required — the defect, not a variant', () => {
  it('exits 1 instead of defaulting to a host the vendor does not control', async () => {
    const h = harness();
    await expect(h.run({ BCONNECT_API_KEY: 'k' })).rejects.toThrow(ExitCalled);
    expect(h.exits).toEqual([1]);
    expect(h.lines.join('\n')).toMatch(/BCONNECT_BASE_URL is required and has no default/);
  });

  it('never mentions the example.com placeholder anywhere', async () => {
    // The literal string twelve servers shipped:
    //   process.env.BCONNECT_BASE_URL || "https://bms.example.com:443/bconnect"
    // If it comes back, this fails.
    const h = harness();
    await expect(h.run({ BCONNECT_API_KEY: 'k' })).rejects.toThrow(ExitCalled);
    expect(h.lines.join('\n')).not.toMatch(/bms\.example\.com/);
    expect(missingBaseUrlMessage('x')).not.toMatch(/bms\.example\.com/);
  });

  it('does not build a client, so no credential is sent anywhere', async () => {
    // The whole point: the failure happens before anything is transmitted.
    const h = harness();
    await expect(
      h.run({ BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p' })
    ).rejects.toThrow(ExitCalled);
    expect(h.built).toHaveLength(0);
    expect(h.creations).toBe(0);
  });

  it('starts normally once the variable is set', async () => {
    const h = harness();
    const result = await h.run(GOOD_ENV);
    expect(h.exits).toEqual([]);
    expect(result).toMatchObject({
      transport: 'stdio',
      baseUrl: 'https://bms.internal.test:443/bconnect',
    });
  });
});

describe('(a) missing credentials: exit 1 with one line, not a stack trace', () => {
  it('exits 1 when neither an API key nor a username/password pair is present', async () => {
    const h = harness();
    await expect(h.run({ BCONNECT_BASE_URL: 'https://bms.internal.test/bconnect' })).rejects.toThrow(
      ExitCalled
    );
    expect(h.exits).toEqual([1]);
  });

  it('exits 1 on a half-supplied username/password pair', async () => {
    const h = harness();
    await expect(
      h.run({ BCONNECT_BASE_URL: 'https://bms.internal.test/bconnect', BCONNECT_USERNAME: 'u' })
    ).rejects.toThrow(ExitCalled);
    expect(h.exits).toEqual([1]);
  });

  it('keeps the eleven-server wording verbatim, so runbook greps still match', () => {
    // endpoints and jobs used to `throw` here, printing "Fatal error: Error: ..."
    // and a stack. They now print this. The text itself is unchanged from the
    // eleven that already did, deliberately.
    expect(missingCredentialsMessage('bconnect-jobs-mcp')).toBe(
      'bconnect-jobs-mcp: Either BCONNECT_API_KEY or both BCONNECT_USERNAME and ' +
        'BCONNECT_PASSWORD are required'
    );
  });

  it('accepts a username/password pair as readily as an API key', async () => {
    const h = harness();
    await h.run({
      BCONNECT_BASE_URL: 'https://bms.internal.test/bconnect',
      BCONNECT_USERNAME: 'u',
      BCONNECT_PASSWORD: 'p',
    });
    expect(h.exits).toEqual([]);
  });
});

describe('(c) one client: the probe verifies what the tools will use', () => {
  it('probes the very instance createServer memoises for dispatch', async () => {
    // OPT-33. V1/V2/V4 built a SECOND client just for testConnection() and threw
    // it away, so the check could verify under different TLS, rate-limit and
    // audit settings than every subsequent tool call ran with. groups-mcp had
    // patched that for TLS in one server with a comment saying exactly this.
    // Here it is structural: there is one client and identity proves it.
    const h = harness();
    const result = (await h.run(GOOD_ENV)) as { probedClient: FakeClient; handle: ServerHandle<FakeClient> };

    expect(h.built).toHaveLength(1);
    expect(result.probedClient).toBe(h.built[0]);
    expect(result.probedClient).toBe(result.handle.getClient!());
    expect(result.probedClient.probes).toBe(1);
  });

  it('creates the server exactly once in stdio mode', async () => {
    const h = harness();
    await h.run(GOOD_ENV);
    expect(h.creations).toBe(1);
  });

  it('falls back to clientFactory for a server that has not exposed getClient', async () => {
    const built: FakeClient[] = [];
    const h = harness();
    const result = (await h.run(GOOD_ENV, {
      withoutGetClient: true,
      clientFactory: () => {
        const client = new FakeClient(true);
        built.push(client);
        return client;
      },
    })) as { probedClient: FakeClient };
    expect(result.probedClient).toBe(built[0]);
  });

  it('hands the fallback factory the same resolved config the provider builds', async () => {
    // Even the fallback cannot verify under a different policy: the config comes
    // from resolveClientConfig, which is the tool dispatch's own env→config map.
    const seen: Array<Record<string, unknown>> = [];
    const h = harness();
    await h.run(
      { ...GOOD_ENV, BCONNECT_TIMEOUT_MS: '45000', BCONNECT_RATE_LIMIT_ENABLED: 'true' },
      {
        withoutGetClient: true,
        clientFactory: (config) => {
          seen.push(config as Record<string, unknown>);
          return new FakeClient(true);
        },
      }
    );
    expect(seen[0]).toMatchObject({
      baseUrl: 'https://bms.internal.test:443/bconnect',
      timeout: 45000,
      rejectUnauthorized: true,
    });
    // The eleven throwaway-client servers ignored this entirely.
    expect(seen[0].rateLimit).toMatchObject({ enabled: true });
  });

  it('exits 1 when it has neither getClient nor clientFactory, rather than skipping the check', async () => {
    const h = harness();
    await expect(h.run(GOOD_ENV, { withoutGetClient: true })).rejects.toThrow(ExitCalled);
    expect(h.lines.join('\n')).toMatch(/needs either createServer\(\)\.getClient or clientFactory/);
  });
});

describe('the connectivity check itself (REQ-SRV-013)', () => {
  it('exits 1 and names the URL when bMS is unreachable', async () => {
    const h = harness();
    await expect(h.run(GOOD_ENV, { connects: false })).rejects.toThrow(ExitCalled);
    expect(h.exits).toEqual([1]);
    expect(h.lines.join('\n')).toMatch(
      /cannot reach bConnect API at https:\/\/bms\.internal\.test:443\/bconnect/
    );
  });

  it('announces both the attempt and the success, as all thirteen already did', async () => {
    const h = harness();
    await h.run(GOOD_ENV);
    expect(h.lines).toContain('bconnect-test-mcp: verifying bConnect API connectivity...');
    expect(h.lines).toContain('bconnect-test-mcp: API connectivity verified.');
    expect(h.lines).toContain('bconnect-test-mcp started on stdio');
  });

  it('does not connect a transport when the check fails', async () => {
    const h = harness();
    await expect(h.run(GOOD_ENV, { connects: false })).rejects.toThrow(ExitCalled);
    expect(h.lines.join('\n')).not.toMatch(/started on stdio/);
  });
});

describe('Difference 4: one TLS resolver', () => {
  it('verifies by default — with neither knob set', () => {
    expect(rejectUnauthorizedFromEnv({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('honours the groups-mcp knob', () => {
    expect(
      rejectUnauthorizedFromEnv({ BCONNECT_REJECT_UNAUTHORIZED: 'false' } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it('honours the other twelve servers’ knob', () => {
    expect(
      rejectUnauthorizedFromEnv({ NODE_TLS_REJECT_UNAUTHORIZED: '0' } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it('is not fooled by a near-miss value', () => {
    // "0" and "false" exactly — not "no", not "", not "FALSE". A typo in a knob
    // that disables certificate verification must fail safe.
    for (const env of [
      { BCONNECT_REJECT_UNAUTHORIZED: 'FALSE' },
      { BCONNECT_REJECT_UNAUTHORIZED: 'no' },
      { NODE_TLS_REJECT_UNAUTHORIZED: '' },
      { NODE_TLS_REJECT_UNAUTHORIZED: 'false' },
    ]) {
      expect(rejectUnauthorizedFromEnv(env as NodeJS.ProcessEnv)).toBe(true);
    }
  });

  it('is what runServer passes into the resolved config', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const h = harness();
    await h.run(
      { ...GOOD_ENV, BCONNECT_REJECT_UNAUTHORIZED: 'false' },
      {
        withoutGetClient: true,
        clientFactory: (config) => {
          seen.push(config as Record<string, unknown>);
          return new FakeClient(true);
        },
      }
    );
    expect(seen[0].rejectUnauthorized).toBe(false);
  });
});

describe('Difference 5: the test-mode guard', () => {
  it('does not auto-start under vitest', () => {
    expect(shouldAutoStart({ VITEST: 'true' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('is not defeated by VITEST=0 or VITEST=, which the truthiness form was', () => {
    // Nine servers wrote `if (!process.env.VITEST)`. Under `VITEST=0` that
    // bootstraps a real server — opening a connection to bMS — mid-suite.
    expect(shouldAutoStart({ VITEST: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldAutoStart({ VITEST: '' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('auto-starts when the variable is absent', () => {
    expect(shouldAutoStart({} as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('MCP_PORT is parsed, not coerced', () => {
  it('defaults to 3000', () => {
    expect(parsePort(undefined)).toBe(3000);
    expect(parsePort('')).toBe(3000);
  });

  it('accepts a port in range', () => {
    expect(parsePort('8080')).toBe(8080);
    expect(parsePort('1')).toBe(1);
    expect(parsePort('65535')).toBe(65535);
  });

  it('rejects what parseInt would have silently turned into NaN or nonsense', () => {
    // `parseInt("http", 10)` is NaN and `listen(NaN)` binds an ARBITRARY FREE
    // PORT: the server starts, logs nothing unusual, and is unreachable at the
    // port the operator configured. `parseInt("8080x")` is 8080, which is worse
    // — it silently ignores the typo.
    for (const raw of ['http', 'NaN', '8080x', '-1', '0', '65536', '3.14', ' 80']) {
      expect(parsePort(raw)).toBeNull();
    }
  });

  it('refuses to start rather than bind an arbitrary port', async () => {
    const h = harness();
    await expect(
      h.run({ ...GOOD_ENV, MCP_TRANSPORT: 'http', MCP_PORT: 'not-a-port' }, { http: { express: {} } })
    ).rejects.toThrow(ExitCalled);
    expect(h.lines.join('\n')).toMatch(/is not a valid port/);
  });
});

describe('HTTP mode', () => {
  function fakeExpress() {
    const app = {
      routes: {} as Record<string, unknown>,
      listened: null as { port: number; host: string } | null,
      use: vi.fn(),
      post: vi.fn((path: string, handler: unknown) => {
        app.routes[`POST ${path}`] = handler;
      }),
      get: vi.fn((path: string, handler: unknown) => {
        app.routes[`GET ${path}`] = handler;
      }),
      delete: vi.fn((path: string, handler: unknown) => {
        app.routes[`DELETE ${path}`] = handler;
      }),
      listen: vi.fn((port: number, host: string, cb: () => void) => {
        app.listened = { port, host };
        cb();
      }),
    };
    const express = Object.assign(() => app, { json: () => 'json-mw' });
    return { app, express };
  }

  it('binds loopback by default and wires the three /mcp routes', async () => {
    const { app, express } = fakeExpress();
    const h = harness();
    const result = await h.run({ ...GOOD_ENV, MCP_TRANSPORT: 'http' }, { http: { express } });
    expect(app.listened).toEqual({ port: 3000, host: '127.0.0.1' });
    expect(Object.keys(app.routes).sort()).toEqual(['DELETE /mcp', 'GET /mcp', 'POST /mcp']);
    expect(result).toMatchObject({ transport: 'http', port: 3000, bind: '127.0.0.1' });
  });

  it('refuses a non-loopback bind without an explicit opt-in', async () => {
    // Standalone HTTP mode has no client authentication; binding 0.0.0.0 would
    // publish an unauthenticated bConnect proxy.
    const { app, express } = fakeExpress();
    const h = harness();
    await expect(
      h.run({ ...GOOD_ENV, MCP_TRANSPORT: 'http', MCP_BIND: '0.0.0.0' }, { http: { express } })
    ).rejects.toThrow(ExitCalled);
    expect(app.listened).toBeNull();
    expect(h.lines.join('\n')).toMatch(/refusing to bind 0\.0\.0\.0/);
  });

  it('allows the opt-in', async () => {
    const { app, express } = fakeExpress();
    const h = harness();
    await h.run(
      { ...GOOD_ENV, MCP_TRANSPORT: 'http', MCP_BIND: '0.0.0.0', MCP_ALLOW_NO_AUTH: 'true' },
      { http: { express } }
    );
    expect(app.listened).toEqual({ port: 3000, host: '0.0.0.0' });
  });

  it('still runs the connectivity check before listening', async () => {
    const { app, express } = fakeExpress();
    const h = harness();
    await expect(
      h.run({ ...GOOD_ENV, MCP_TRANSPORT: 'http' }, { http: { express }, connects: false })
    ).rejects.toThrow(ExitCalled);
    expect(app.listened).toBeNull();
  });

  // ── ARCH-4 ─────────────────────────────────────────────────────────────────
  // This transport has no client authentication, so Host and Origin are the
  // only thing between a web page the operator visits and a bConnect proxy on
  // loopback. It used to mount nothing at all.
  it('mounts the Host/Origin guard, and mounts it BEFORE the body parser', async () => {
    const { app, express } = fakeExpress();
    const h = harness();
    await h.run({ ...GOOD_ENV, MCP_TRANSPORT: 'http' }, { http: { express } });

    const mounted = app.use.mock.calls.map(([mw]) => mw);
    expect(mounted).toHaveLength(2);
    expect(typeof mounted[0]).toBe('function'); // the guard
    expect(mounted[1]).toBe('json-mw'); // a forged Host must not buy a 1 MB parse

    // And it is live with no configuration at all.
    const guard = mounted[0] as (req: unknown, res: unknown, next: () => void) => void;
    const refuse = (headers: Record<string, string>) => {
      let status: number | null = null;
      let passed = false;
      guard(
        { headers },
        { writeHead: (code: number) => ((status = code), { end: () => undefined }) },
        () => (passed = true)
      );
      return { status, passed };
    };
    expect(refuse({ host: '127.0.0.1:3000' })).toMatchObject({ passed: true });
    expect(refuse({ host: 'evil.example.com:3000' })).toMatchObject({ passed: false, status: 403 });
    expect(refuse({ host: '127.0.0.1:3000', origin: 'http://evil.example' })).toMatchObject({
      passed: false,
      status: 403,
    });
  });

  it('names the resolved allowlists on stderr', async () => {
    const { express } = fakeExpress();
    const h = harness();
    await h.run({ ...GOOD_ENV, MCP_TRANSPORT: 'http' }, { http: { express } });
    expect(h.lines.join('\n')).toMatch(/Host allowlist \[127\.0\.0\.1, localhost, ::1\]/);
    expect(h.lines.join('\n')).toMatch(/every browser Origin is refused/);
  });

  it('exits rather than crashing when express was not injected', async () => {
    // mcp-core does not depend on express: the thirteen servers pin ^4.21.0
    // while the workspace root hoists 5.x, and a shared package is the wrong
    // place to arbitrate that.
    const h = harness();
    await expect(h.run({ ...GOOD_ENV, MCP_TRANSPORT: 'http' })).rejects.toThrow(ExitCalled);
    expect(h.lines.join('\n')).toMatch(/no express was supplied/);
  });
});

describe('an unknown MCP_TRANSPORT falls back to stdio, as it always did', () => {
  it('treats anything that is not "http" as stdio', async () => {
    const h = harness();
    const result = await h.run({ ...GOOD_ENV, MCP_TRANSPORT: 'sse' });
    expect(result).toMatchObject({ transport: 'stdio' });
  });
});
