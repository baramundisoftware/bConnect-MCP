/**
 * A server whose APIs the bMS release lacks says so at startup (REQ-SRV-030, #310).
 *
 * Which servers that is comes from the generated release tables, so this guard
 * reads them on its own: on 25R2 exactly compliance and universaldynamicgroups
 * list no tool, on 26R1 none. Each server hands its table to the startup
 * routine, and the built servers stop on 25R2 with the one line that names the
 * release they need, before any request (connectivity check skipped or not).
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, SERVERS } from './lib/exerciser.js';

const tableOf = async (server: string): Promise<Record<string, string[]>> =>
  (await import(pathToFileURL(join(ROOT, server, 'src', 'tool-releases.ts')).href)).TOOL_RELEASES;

/** The servers that list no tool in `release`, read from their tables. */
async function withoutTools(release: string): Promise<string[]> {
  const out: string[] = [];
  for (const server of SERVERS) {
    if (!Object.values(await tableOf(server)).some((releases) => releases.includes(release))) out.push(server);
  }
  return out;
}

const dir = mkdtempSync(join(tmpdir(), 'needs-release-'));
/** Starts a built server as a real process, stdin closed, nothing reachable on the network. */
function start(server: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [join(ROOT, server, 'build', 'index.js')], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', BCONNECT_BASE_URL: 'http://127.0.0.1:9/bconnect', BCONNECT_API_KEY: 'guard-key', ...env },
    encoding: 'utf8',
    input: '',
    timeout: 30_000,
  });
}
const NEEDS_26R1 = (server: string, uses: string) => `${server}: needs bMS 26R1; this server uses ${uses}. None of its APIs exist in that release.`;

describe('which servers a release leaves without tools (from the generated tables)', () => {
  it('25R2: compliance and universaldynamicgroups', async () => {
    expect(await withoutTools('25R2')).toEqual(['bconnect-compliance-mcp', 'bconnect-universaldynamicgroups-mcp']);
  });

  it('26R1: none', async () => {
    expect(await withoutTools('26R1')).toEqual([]);
  });

  it.each(SERVERS)('%s hands its generated table to the startup routine', (server) => {
    const source = readFileSync(join(ROOT, server, 'src', 'index.ts'), 'utf8');
    expect(source).toContain('import { TOOL_RELEASES } from "./tool-releases.js";');
    const call = source.slice(source.lastIndexOf('runServer({'));
    expect(call.slice(0, call.indexOf('});'))).toContain('releases: TOOL_RELEASES');
  });
});

describe('the built servers on 25R2', () => {
  it.each(['bconnect-compliance-mcp', 'bconnect-universaldynamicgroups-mcp'])('%s exits 1 with one line naming 26R1, connectivity check skipped or not', (server) => {
    for (const skip of ['true', '']) {
      const run = start(server, { BCONNECT_RELEASE: '25R2', BCONNECT_SKIP_CONNECTIVITY_CHECK: skip });
      expect(run.status, run.stderr).toBe(1);
      expect(run.stdout).toBe('');
      const lines = run.stderr.trim().split('\n');
      // Without the skip, detection fails first (nothing listens) and falls back to the setting.
      expect(lines.at(-1)).toBe(NEEDS_26R1(server, '25R2 (from BCONNECT_RELEASE)'));
      expect(run.stderr).not.toMatch(/cannot reach|verifying|connectivity check skipped/);
    }
  });

  it('a server with 25R2 tools starts as before', () => {
    const run = start('bconnect-groups-mcp', { BCONNECT_RELEASE: '25R2', BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' });
    expect(run.stderr).toContain('bconnect-groups-mcp started on stdio');
    expect(run.stderr).not.toContain('needs bMS');
  });

  it('on 26R1 compliance starts as before', () => {
    const run = start('bconnect-compliance-mcp', { BCONNECT_RELEASE: '26R1', BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' });
    expect(run.stderr).toContain('bconnect-compliance-mcp started on stdio');
    expect(run.stderr).not.toContain('needs bMS');
  });
});
