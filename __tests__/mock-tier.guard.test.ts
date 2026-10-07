/**
 * The mock-integration tier runs in CI (REQ-CI-002, #311).
 *
 * The `mock` job in ci.yml starts one pinned bConnect-Mock image per bMS
 * release, with its rate limit off, and runs scripts/mock-tier.mjs. The runner
 * checks the mock's /health first and fails the job when a server's tests fail
 * or skip because the mock isn't reachable: a skipped tier must never look
 * passed. On 25R2 it leaves out the servers that list no tool there; this
 * guard reads that set from the generated release tables.
 */
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ROOT, SERVERS } from './lib/exerciser.js';
import { checkHealth, serversFor, TEST_ARGS, testCommand, testEnv, verdict } from '../scripts/mock-tier.mjs';

const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

interface Step { run?: string; uses?: string; name?: string }
interface Job {
  name?: string;
  'runs-on'?: string;
  env?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown[]> };
  steps?: Step[];
}
const jobs = (yaml.load(ci) as { jobs: Record<string, Job> }).jobs;
const mock = jobs.mock;
const runs = (mock?.steps ?? []).map((s) => s.run ?? '').join('\n');

const tableOf = async (server: string): Promise<Record<string, string[]>> =>
  (await import(pathToFileURL(join(ROOT, server, 'src', 'tool-releases.ts')).href)).TOOL_RELEASES;

/** The servers that list at least one tool in `release`, read from their tables. */
async function withTools(release: string): Promise<string[]> {
  const out: string[] = [];
  for (const server of SERVERS) {
    if (Object.values(await tableOf(server)).some((releases) => releases.includes(release))) out.push(server);
  }
  return out;
}

describe('ci.yml — the mock job', () => {
  it('exists, on Linux, once per release', () => {
    expect(mock, 'ci.yml has no `mock` job').toBeDefined();
    expect(mock['runs-on']).toBe('ubuntu-latest');
    expect(mock.strategy?.matrix?.release).toEqual(['26r1', '25r2']);
    expect(mock.name).toBe('mock tier (${{ matrix.release }})');
  });

  it('pins the mock image in one place: a version, not a moving tag', () => {
    const image = mock.env?.BCONNECT_MOCK_IMAGE ?? '';
    const [repo, tag = ''] = image.split(':');
    expect(repo).toBe('ghcr.io/baramundisoftware/bconnect-mock');
    const parts = tag.split('.');
    expect(parts.length, `"${tag}" is not a version like 0.8.0`).toBe(3);
    expect(parts.every((p) => p !== '' && [...p].every((c) => c >= '0' && c <= '9'))).toBe(true);
    // Nowhere else in the workflow: raising the version is a one-line change.
    expect(ci.split('bconnect-mock:').length - 1).toBe(1);
  });

  it('starts the mock for the matrix release with its rate limit off, and names the image it ran', () => {
    expect(runs).toContain('RATE_LIMIT_ENABLED=false');
    expect(runs).toContain('BCONNECT_BMS_VERSION=${{ matrix.release }}');
    expect(runs).toContain('"$BCONNECT_MOCK_IMAGE"');
    expect(runs).toContain('RepoDigests');
  });

  it('builds, then runs the tier through the runner for the matrix release', () => {
    expect(runs).toContain('npm ci');
    expect(runs).toContain('npm run build');
    expect(runs).toContain('node scripts/mock-tier.mjs ${{ matrix.release }}');
  });
});

describe('scripts/mock-tier.mjs — which servers run', () => {
  it.each(['26R1', '25R2'])('on %s: exactly the servers that list a tool there', async (release) => {
    expect(serversFor(release.toLowerCase())).toEqual(await withTools(release));
  });

  it('26r1 runs all 13 servers; 25r2 leaves out compliance and universaldynamicgroups', () => {
    expect(serversFor('26r1')).toHaveLength(13);
    expect(SERVERS.filter((s) => !serversFor('25r2').includes(s)))
      .toEqual(['bconnect-compliance-mcp', 'bconnect-universaldynamicgroups-mcp']);
  });

  it('refuses a release it does not know', () => {
    expect(() => serversFor('24r1')).toThrow(/24r1/);
  });
});

describe('scripts/mock-tier.mjs — verdict per server', () => {
  it('passes a clean run', () => {
    expect(verdict(0, ' Test Files  1 passed (1)\n      Tests  8 passed (8)')).toBeUndefined();
  });

  it('fails a run whose tests failed', () => {
    expect(verdict(1, 'Tests  1 failed | 7 passed (8)')).toMatch(/failed/);
  });

  it('fails a run that skipped because the mock was not reachable, although vitest says passed', () => {
    const output = '⚠  bConnectMock not reachable at http://127.0.0.1:13433 — endpoints mock tests skipped\n      Tests  8 passed (8)';
    expect(verdict(0, output)).toMatch(/not reachable/);
  });
});

describe('scripts/mock-tier.mjs — how each server runs', () => {
  it("runs test:mock with vitest's default reporter, which prints the skip warning (an agent shell's reporter hides it)", () => {
    expect(TEST_ARGS).toEqual(['run', '-s', 'test:mock', '--', '--reporter=default']);
  });

  it('starts npm directly on Linux and macOS', () => {
    expect(testCommand('linux')).toEqual({ command: 'npm', args: TEST_ARGS, shell: false });
    expect(testCommand('darwin')).toEqual({ command: 'npm', args: TEST_ARGS, shell: false });
  });

  it('starts npm through the shell on Windows, where npm is npm.cmd (without a shell: spawnSync npm ENOENT)', () => {
    // One command line, no argument list: Node warns when arguments are passed alongside shell: true.
    expect(testCommand('win32')).toEqual({ command: 'npm run -s test:mock -- --reporter=default', args: [], shell: true });
  });

  it('gives the tests the mock URL and never the bConnect URL or credentials the client would prefer', () => {
    const env = testEnv({ PATH: '/bin', BCONNECT_BASE_URL: 'https://bms.example', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p', BCONNECT_API_KEY: 'k' }, 'http://127.0.0.1:13433');
    expect(env).toEqual({ PATH: '/bin', BCONNECT_MOCK_URL: 'http://127.0.0.1:13433' });
  });
});

describe('scripts/mock-tier.mjs — the mock must answer first', () => {
  async function serve(body: string, status = 200): Promise<{ url: string; close: () => Promise<void> }> {
    const server = http.createServer((_req, res) => { res.writeHead(status, { 'content-type': 'application/json' }).end(body); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }

  it('accepts a mock serving the expected release', async () => {
    const mockServer = await serve(JSON.stringify({ status: 'ok', bmsVersion: '25r2' }));
    try {
      await expect(checkHealth(mockServer.url, '25r2', 2000)).resolves.toBeUndefined();
    } finally {
      await mockServer.close();
    }
  });

  it('refuses a mock serving another release', async () => {
    const mockServer = await serve(JSON.stringify({ status: 'ok', bmsVersion: '26r1' }));
    try {
      await expect(checkHealth(mockServer.url, '25r2', 2000)).rejects.toThrow(/26r1/);
    } finally {
      await mockServer.close();
    }
  });

  it('gives up on a mock that does not answer', async () => {
    await expect(checkHealth('http://127.0.0.1:1', '26r1', 300)).rejects.toThrow(/not reachable/);
  });
});
