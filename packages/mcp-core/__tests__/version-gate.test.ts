/**
 * The 26R1 version gate (VER-1).
 *
 * Four docs (README, docs/DOCKER.md, docs/INSTALLATION.md,
 * docs/MIGRATION-tool-surface.md) promised operators that every server reads
 * the bMS version from GET /v2.0/ManagementServer during the startup
 * connectivity check and refuses to start below 26R1 — and the code did not do
 * it. Several tools call routes added in 26R1; against a 25R2 bMS they started
 * anyway and published missing or wrong data. This file pins the behaviour the
 * docs describe:
 *
 *   - a version that PARSES and is BELOW 26R1 refuses to start, naming the
 *     detected version;
 *   - 26R1 itself, and anything later (26R2, 27R1), proceeds;
 *   - everything undeterminable fails OPEN with a warning naming the exact
 *     evidence — an unparseable string, a 401/403/404 on the version route, a
 *     missing field. A false refusal against a healthy 26R1 bMS is worse than
 *     the inaccuracy the gate prevents;
 *   - BCONNECT_SKIP_CONNECTIVITY_CHECK=true skips the gate with the
 *     connectivity check, as documented.
 *
 * No network: the client-level probes run against a stub axios adapter, and
 * the runServer-level cases inject a fake client, exactly as
 * run-server.test.ts does.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import {
  BConnectClientBase,
  BMS_VERSION_PROBE_PATH,
  runServer,
  parseBmsVersion,
} from '@bconnect/mcp-core';
import type { ConnectionProbe, ProbeableClient, ServerHandle } from '@bconnect/mcp-core';

// ── parseBmsVersion: the two accepted shapes, and nothing else ───────────────

describe('parseBmsVersion accepts the release form and the dotted form', () => {
  it('parses the release form baramundi uses in prose ("26R1")', () => {
    expect(parseBmsVersion('26R1')).toEqual({ major: 26, release: 1 });
    expect(parseBmsVersion('26 r2')).toEqual({ major: 26, release: 2 });
    expect(parseBmsVersion('bMS 26R1')).toEqual({ major: 26, release: 1 });
    expect(parseBmsVersion('25R2')).toEqual({ major: 25, release: 2 });
  });

  it('parses the dotted form the repo itself uses for the same release ("26.1")', () => {
    // The servermanagement server calls itself "26.1.7" and its surface test
    // mocks the ManagementServer version as "26.1" — the numeric spelling.
    expect(parseBmsVersion('26.1')).toEqual({ major: 26, release: 1 });
    expect(parseBmsVersion('26.1.180.0')).toEqual({ major: 26, release: 1 });
    expect(parseBmsVersion('25.2.100.0')).toEqual({ major: 25, release: 2 });
    expect(parseBmsVersion('27.0.4.0')).toEqual({ major: 27, release: 0 });
  });

  it('maps a year-form major to its two-digit form, so "2025 R2" cannot slip past as major 2025', () => {
    expect(parseBmsVersion('2026 R1')).toEqual({ major: 26, release: 1 });
    expect(parseBmsVersion('2025 R2')).toEqual({ major: 25, release: 2 });
    expect(parseBmsVersion('2026.1.55.0')).toEqual({ major: 26, release: 1 });
  });

  it('returns null for anything else, because a false refusal is worse than fail-open', () => {
    for (const raw of ['', 'Zebra', 'R1', '26', 'v-next', 'release candidate']) {
      expect(parseBmsVersion(raw)).toBeNull();
    }
  });
});

// ── Client level: what testConnection() records for the gate ─────────────────

const CLIENT_CONFIG = {
  baseUrl: 'https://bms.example.invalid/bconnect',
  username: 'svcacct',
  password: 'pw',
};

function adapterAnswering(
  client: BConnectClientBase,
  answer: (config: InternalAxiosRequestConfig) => { status: number; data: unknown }
) {
  const seen: InternalAxiosRequestConfig[] = [];
  client.getHttpClient().defaults.adapter = async (config) => {
    seen.push(config as InternalAxiosRequestConfig);
    const { status, data } = answer(config as InternalAxiosRequestConfig);
    if (status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        String(status),
        config as InternalAxiosRequestConfig,
        {},
        { data, status, statusText: 'Error', headers: {}, config } as never
      );
    }
    return { data, status, statusText: 'OK', headers: {}, config } as never;
  };
  return seen;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK;
});

describe('testConnection() doubles as the version probe (no second round-trip)', () => {
  it('records the version from the single ManagementServer request', async () => {
    const client = new BConnectClientBase(CLIENT_CONFIG);
    const seen = adapterAnswering(client, () => ({
      status: 200,
      data: { name: 'bms01', version: '26.1.180.0' },
    }));

    await expect(client.testConnection()).resolves.toBe(true);

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(BMS_VERSION_PROBE_PATH);
    expect(client.getConnectionProbe()).toEqual({ outcome: 'version', version: '26.1.180.0' });
  });

  it.each([401, 403, 404])(
    'records "denied" on HTTP %i and verifies connectivity via the health route instead',
    async (status) => {
      const client = new BConnectClientBase(CLIENT_CONFIG);
      const seen = adapterAnswering(client, (config) =>
        (config.url ?? '').includes('/ManagementServer')
          ? { status, data: null }
          : { status: 200, data: { data: [] } }
      );

      await expect(client.testConnection()).resolves.toBe(true);

      expect(seen.map((c) => c.url)).toEqual([BMS_VERSION_PROBE_PATH, '/endpoints/v2.0/Endpoints']);
      expect(client.getConnectionProbe()).toEqual({ outcome: 'denied', status });
    }
  );

  it('still fails closed when the fallback fails too — a denied version route is not a free pass', async () => {
    const client = new BConnectClientBase(CLIENT_CONFIG);
    adapterAnswering(client, () => ({ status: 401, data: null }));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(client.testConnection()).resolves.toBe(false);

    expect(client.getConnectionProbe()).toEqual({ outcome: 'failed' });
  });

  it('records a 2xx body without a version string as "no-version-field", not a failure', async () => {
    const client = new BConnectClientBase(CLIENT_CONFIG);
    adapterAnswering(client, () => ({ status: 200, data: { name: 'bms01' } }));

    await expect(client.testConnection()).resolves.toBe(true);
    expect(client.getConnectionProbe()).toEqual({ outcome: 'no-version-field' });
  });

  it('records "skipped" and sends nothing under BCONNECT_SKIP_CONNECTIVITY_CHECK=true', async () => {
    process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK = 'true';
    const client = new BConnectClientBase(CLIENT_CONFIG);
    const seen = adapterAnswering(client, () => ({ status: 200, data: {} }));

    await expect(client.testConnection()).resolves.toBe(true);

    expect(seen).toHaveLength(0);
    expect(client.getConnectionProbe()).toEqual({ outcome: 'skipped' });
  });
});

// ── Bootstrap level: runServer enforces the gate for all thirteen servers ────

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit(${code})`);
  }
}

class GateFakeClient implements ProbeableClient {
  constructor(private readonly probe: ConnectionProbe | undefined) {}
  async testConnection(): Promise<boolean> {
    return true;
  }
  getConnectionProbe(): ConnectionProbe | undefined {
    return this.probe;
  }
}

async function boot(
  probe: ConnectionProbe | undefined,
  env: Record<string, string> = {}
): Promise<{ lines: string[]; exits: number[]; outcome: 'started' | 'exited' }> {
  const lines: string[] = [];
  const exits: number[] = [];
  const client = new GateFakeClient(probe);
  const handle: ServerHandle<GateFakeClient> = {
    server: {
      connect: async () => {},
      close: async () => {},
    } as never,
    getClient: () => client,
  };
  let outcome: 'started' | 'exited' = 'started';
  try {
    await runServer<GateFakeClient>({
      name: 'bconnect-test-mcp',
      createServer: () => handle,
      env: {
        BCONNECT_BASE_URL: 'https://bms.internal.test:443/bconnect',
        BCONNECT_API_KEY: 'k',
        ...env,
      } as NodeJS.ProcessEnv,
      log: (line) => lines.push(line),
      exit: ((code: number) => {
        exits.push(code);
        throw new ExitCalled(code);
      }) as (code: number) => never,
      skipDotenv: true,
    });
  } catch (error) {
    if (!(error instanceof ExitCalled)) {
      throw error;
    }
    outcome = 'exited';
  }
  return { lines, exits, outcome };
}

describe('runServer refuses a bMS below 26R1 (fails closed)', () => {
  it.each(['25.2.100.0', '25R2', '2025 R2', '24R1'])(
    'exits 1 against "%s", naming the detected version and the requirement',
    async (version) => {
      const { lines, exits, outcome } = await boot({ outcome: 'version', version });

      expect(outcome).toBe('exited');
      expect(exits).toEqual([1]);
      const stderr = lines.join('\n');
      // The grep the README troubleshooting table promises operators:
      expect(stderr).toContain('requires baramundi Management Suite 26R1');
      expect(stderr).toContain(`"${version}"`);
      expect(stderr).not.toContain('started on stdio');
    }
  );

  it('refuses through the same failure path — after connectivity, before any transport', async () => {
    const { lines } = await boot({ outcome: 'version', version: '25R2' });
    // Connectivity was verified first (same single round-trip), then the gate
    // refused before a transport was connected.
    expect(lines).toContain('bconnect-test-mcp: API connectivity verified.');
    expect(lines.join('\n')).not.toContain('started on stdio');
  });
});

describe('runServer proceeds at and above 26R1', () => {
  it.each(['26R1', '26.1', '26.1.180.0'])('starts against 26R1 as "%s"', async (version) => {
    const { lines, exits, outcome } = await boot({ outcome: 'version', version });

    expect(outcome).toBe('started');
    expect(exits).toEqual([]);
    expect(lines.join('\n')).toContain(`bMS version "${version}" satisfies the 26R1 minimum`);
    expect(lines).toContain('bconnect-test-mcp started on stdio');
  });

  it.each(['26R2', '27R1', '27.0.4.0', '2026 R2'])(
    'starts against the later release "%s"',
    async (version) => {
      const { outcome, lines } = await boot({ outcome: 'version', version });
      expect(outcome).toBe('started');
      expect(lines.join('\n')).toContain('satisfies the 26R1 minimum');
    }
  );
});

describe('undeterminable versions fail open with a warning, never a refusal', () => {
  it('warns with the exact string received when the version does not parse, and proceeds', async () => {
    const { lines, outcome } = await boot({ outcome: 'version', version: 'vNext-quokka' });

    expect(outcome).toBe('started');
    const stderr = lines.join('\n');
    expect(stderr).toContain('warning');
    expect(stderr).toContain('"vNext-quokka"');
    expect(stderr).toContain('26R1');
    expect(lines).toContain('bconnect-test-mcp started on stdio');
  });

  it.each([401, 403, 404])(
    'warns and proceeds when the version probe was denied with HTTP %i',
    async (status) => {
      const { lines, outcome } = await boot({ outcome: 'denied', status });

      expect(outcome).toBe('started');
      const stderr = lines.join('\n');
      expect(stderr).toContain(`HTTP ${status}`);
      expect(stderr).toContain('/servermanagement/v2.0/ManagementServer');
      expect(stderr).toContain('26R1');
      expect(lines).toContain('bconnect-test-mcp started on stdio');
    }
  );

  it('warns and proceeds when the response had no usable version field', async () => {
    const { lines, outcome } = await boot({ outcome: 'no-version-field' });
    expect(outcome).toBe('started');
    expect(lines.join('\n')).toMatch(/warning: .*"version"/);
  });
});

describe('BCONNECT_SKIP_CONNECTIVITY_CHECK skips the gate entirely', () => {
  it('starts without evaluating any version, and says the gate was skipped with the check', async () => {
    const { lines, outcome } = await boot(
      { outcome: 'skipped' },
      { BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' }
    );

    expect(outcome).toBe('started');
    const stderr = lines.join('\n');
    expect(stderr).toContain('version gate is skipped');
    expect(stderr).not.toContain('requires baramundi Management Suite 26R1 or later; the connected bMS');
    expect(lines).toContain('bconnect-test-mcp started on stdio');

    // The skip path makes testConnection() return true WITHOUT any request.
    // "API connectivity verified." on that path is a false claim — chased on
    // the reference deployment, where every server's log carried the
    // contradiction "verified" + "probe skipped" on every startup. The line
    // must say what happened.
    expect(stderr).toContain('connectivity check SKIPPED');
    expect(stderr).toContain('nothing was verified');
    expect(stderr).not.toContain('API connectivity verified');
  });
});

describe('a pre-gate client (no getConnectionProbe) is left alone', () => {
  it('starts without any version-gate output, exactly as before the gate existed', async () => {
    const legacy = {
      testConnection: async () => true,
    };
    const lines: string[] = [];
    await runServer({
      name: 'bconnect-test-mcp',
      createServer: () => ({
        server: { connect: async () => {}, close: async () => {} } as never,
        getClient: () => legacy,
      }),
      env: {
        BCONNECT_BASE_URL: 'https://bms.internal.test:443/bconnect',
        BCONNECT_API_KEY: 'k',
      } as NodeJS.ProcessEnv,
      log: (line) => lines.push(line),
      exit: ((code: number) => {
        throw new ExitCalled(code);
      }) as (code: number) => never,
      skipDotenv: true,
    });
    expect(lines.join('\n')).not.toMatch(/version/);
    expect(lines).toContain('bconnect-test-mcp started on stdio');
  });
});
