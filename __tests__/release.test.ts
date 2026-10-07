/**
 * The servers detect the bMS release at startup (REQ-SRV-028, #159, ADR-0014).
 *
 * `detectRelease` reads `version` from GET /servermanagement/v2.0/ManagementServer
 * once per process and maps its first two parts to a release. `selectedRelease`
 * is the one answer every release-dependent decision uses: the detected
 * release, else BCONNECT_RELEASE, else 26R1. Detection never stops a server:
 * anything it can't use falls back with a warning that says why.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { delay, http, HttpResponse } from 'msw';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';
import {
  checkReleaseSetting, detectRelease, forgetDetectedRelease, releaseDescription, releaseFromVersion, releaseRefusal, selectedRelease,
} from '../packages/mcp-core/src/release.js';

const BASE = 'http://bms.release.test/bconnect';
const ROUTE = '/bconnect/servermanagement/v2.0/ManagementServer';

let answer: () => Response | Promise<Response> = () => HttpResponse.json({ name: 'bMS', version: '26.1.161.0' });
let sent: string[] = [];
const msw = setupServer(http.all('*', ({ request }) => { sent.push(`${request.method} ${new URL(request.url).pathname}`); return answer(); }));
beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { sent = []; forgetDetectedRelease(); answer = () => HttpResponse.json({ name: 'bMS', version: '26.1.161.0' }); });
afterAll(() => msw.close());

const client = () => new BConnectClientBase({ baseUrl: BASE, apiKey: 'k', timeout: 200 });
function log() {
  const lines: Array<{ level: 'info' | 'warn'; line: string }> = [];
  return { lines, sink: { info: (line: string) => lines.push({ level: 'info', line }), warn: (line: string) => lines.push({ level: 'warn', line }) } };
}
const versionAnswer = (version: unknown) => () => HttpResponse.json({ name: 'bMS', version });

describe('releaseFromVersion', () => {
  it.each([
    ['26.1.161.0', '26R1'], ['26.1', '26R1'], ['26.1.0.5678', '26R1'],
    ['25.2.0.0', '25R2'], ['25.2', '25R2'],
  ])('%s → %s', (version, release) => {
    expect(releaseFromVersion(version)).toBe(release);
  });

  it.each([['26.2.0.0'], ['27.1.0.0'], ['25.1.3.0'], ['26'], ['26.1garbage'], ['v26.1.161.0'], [' 26.1.161.0'], [''], [261], [null], [undefined], [{ major: 26 }]])(
    '%j → no supported release', (version) => {
      expect(releaseFromVersion(version)).toBeUndefined();
    });
});

describe('selectedRelease without detection: the setting, else 26R1', () => {
  it.each([[undefined, '26R1', '26R1 (default)'], ['26R1', '26R1', '26R1 (from BCONNECT_RELEASE)'], ['25R2', '25R2', '25R2 (from BCONNECT_RELEASE)']])(
    'BCONNECT_RELEASE=%s → %s', (setting, release, description) => {
      const env = { ...(setting && { BCONNECT_RELEASE: setting }) };
      expect(selectedRelease(env)).toBe(release);
      expect(releaseDescription(env)).toBe(description);
    });

  it('reads the setting on every call', () => {
    const env: NodeJS.ProcessEnv = { BCONNECT_RELEASE: '25R2' };
    expect(selectedRelease(env)).toBe('25R2');
    env.BCONNECT_RELEASE = '26R1';
    expect(selectedRelease(env)).toBe('26R1');
  });
});

describe('detectRelease', () => {
  it('reads the version once, selects its release and logs both', async () => {
    const l = log();
    expect(await detectRelease(client(), l.sink, {})).toBe('26R1');
    expect(sent).toEqual([`GET ${ROUTE}`]);
    expect(l.lines).toEqual([{ level: 'info', line: 'bMS 26.1.161.0 → release 26R1' }]);
    expect(selectedRelease({})).toBe('26R1');
    expect(releaseDescription({})).toBe('26R1 (detected: bMS 26.1.161.0)');
  });

  it('selects 25R2 from a 25.2 version, without BCONNECT_RELEASE', async () => {
    answer = versionAnswer('25.2.0.0');
    const l = log();
    expect(await detectRelease(client(), l.sink, {})).toBe('25R2');
    expect(selectedRelease({})).toBe('25R2');
    expect(l.lines).toEqual([{ level: 'info', line: 'bMS 25.2.0.0 → release 25R2' }]);
  });

  it('the detected release wins over a different BCONNECT_RELEASE, with a warning naming both (AC 2)', async () => {
    answer = versionAnswer('25.2.0.0');
    const l = log();
    const env = { BCONNECT_RELEASE: '26R1' };
    expect(await detectRelease(client(), l.sink, env)).toBe('25R2');
    expect(selectedRelease(env)).toBe('25R2');
    expect(l.lines).toEqual([{ level: 'warn', line: 'bMS 25.2.0.0 → release 25R2; BCONNECT_RELEASE=26R1 is ignored' }]);
  });

  it('a matching BCONNECT_RELEASE gives no warning', async () => {
    const l = log();
    await detectRelease(client(), l.sink, { BCONNECT_RELEASE: '26R1' });
    expect(l.lines.map((x) => x.level)).toEqual(['info']);
  });

  describe('falls back to the setting, with a warning that says why (AC 3)', () => {
    it.each([
      ['403', () => HttpResponse.json({ title: 'Forbidden' }, { status: 403 }), /403/],
      ['404', () => HttpResponse.json({ title: 'Not Found' }, { status: 404 }), /404/],
      ['a network error', () => HttpResponse.error(), /could not detect/],
      ['a timeout', async () => { await delay('infinite'); return HttpResponse.json({}); }, /could not detect/],
      ['no version', () => HttpResponse.json({ name: 'bMS' }), /no version/],
      ['an unknown version', versionAnswer('26.2.0.0'), /"26\.2\.0\.0" is not a supported release/],
      ['a version that is not a string', versionAnswer(26), /no version/],
    ])('%s', async (_case, respond, reason) => {
      answer = respond;
      for (const [env, release, source] of [[{ BCONNECT_RELEASE: '25R2' }, '25R2', 'from BCONNECT_RELEASE'], [{}, '26R1', 'default']] as const) {
        forgetDetectedRelease();
        const l = log();
        expect(await detectRelease(client(), l.sink, { ...env })).toBe(release);
        expect(selectedRelease({ ...env })).toBe(release);
        expect(l.lines).toHaveLength(1);
        expect(l.lines[0].level).toBe('warn');
        expect(l.lines[0].line).toMatch(reason);
        expect(l.lines[0].line).toContain(`using ${release} (${source})`);
      }
    });
  });

  it('keeps a hostile version out of the log as one quoted, shortened line', async () => {
    answer = versionAnswer(`27.1\nforged line ${'x'.repeat(200)}`);
    const l = log();
    await detectRelease(client(), l.sink, {});
    expect(l.lines[0].line).not.toContain('\n');
    expect(l.lines[0].line.length).toBeLessThan(200);
  });

  it('sends nothing with BCONNECT_SKIP_CONNECTIVITY_CHECK=true and uses the setting (AC 3)', async () => {
    const l = log();
    const env = { BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '25R2' };
    expect(await detectRelease(client(), l.sink, env)).toBe('25R2');
    expect(sent).toEqual([]);
    expect(l.lines).toEqual([{ level: 'info', line: 'release detection skipped (BCONNECT_SKIP_CONNECTIVITY_CHECK=true); using 25R2 (from BCONNECT_RELEASE)' }]);
  });

  it('after a failed detection, the setting is read on every call again', async () => {
    answer = () => HttpResponse.json({}, { status: 403 });
    const env: NodeJS.ProcessEnv = { BCONNECT_RELEASE: '25R2' };
    await detectRelease(client(), log().sink, env);
    env.BCONNECT_RELEASE = '26R1';
    expect(selectedRelease(env)).toBe('26R1');
  });
});

describe('checkReleaseSetting', () => {
  it('accepts unset, 26R1 and 25R2, and refuses anything else as today', () => {
    expect(() => checkReleaseSetting({})).not.toThrow();
    expect(() => checkReleaseSetting({ BCONNECT_RELEASE: '25R2' })).not.toThrow();
    expect(() => checkReleaseSetting({ BCONNECT_RELEASE: '26r1' })).toThrow(/BCONNECT_RELEASE "26r1" isn't valid/);
  });
});

describe('releaseRefusal', () => {
  it('names the release the tool needs and the one in use, with its source, not "set BCONNECT_RELEASE"', async () => {
    expect(releaseRefusal('list_api_keys', '26R1', { BCONNECT_RELEASE: '25R2' }))
      .toBe('list_api_keys is only available in bMS 26R1; this server uses 25R2 (from BCONNECT_RELEASE).');
    answer = versionAnswer('25.2.0.0');
    await detectRelease(client(), log().sink, {});
    expect(releaseRefusal('list_api_keys', '26R1', {})).toBe('list_api_keys is only available in bMS 26R1; this server uses 25R2 (detected: bMS 25.2.0.0).');
  });
});
