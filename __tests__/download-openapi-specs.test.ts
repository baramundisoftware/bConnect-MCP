/**
 * scripts/download-openapi-specs.mjs (#335).
 *
 * The shell script it replaces wrote to the wrong folder, left out compliance
 * and universal dynamic groups, turned certificate checks off, put the
 * password on the command line and didn't fail when a download failed. The
 * downloads here go to a local HTTP server on 127.0.0.1 (http is accepted
 * only for this machine).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './lib/exerciser.js';
import { SPECS, authHeaders, checkBaseUrl, download, specUrl } from '../scripts/download-openapi-specs.mjs';

describe('which specifications', () => {
  it.each(['25R2', '26R1'] as const)('%s: every module, under the file names the repository has', (release) => {
    expect(Object.values(SPECS[release]).sort()).toEqual(readdirSync(join(ROOT, 'openapi-specs', release)).sort());
  });

  it('26R1 adds compliance and universal dynamic groups', () => {
    expect(Object.keys(SPECS['26R1']).filter((m) => !(m in SPECS['25R2']))).toEqual(['compliance', 'universaldynamicgroups']);
  });

  it('builds the URL below the base URL, trailing slashes or not', () => {
    expect(specUrl('https://bms.example/bconnect//', 'jobs', 'bConnect_Jobs.json')).toBe('https://bms.example/bconnect/jobs/openAPI/v2.0/bConnect_Jobs.json');
  });
});

describe('credentials and transport', () => {
  it('sends an API key, or username and password, as a header', () => {
    expect(authHeaders({ BCONNECT_API_KEY: 'k' })).toMatchObject({ 'X-Api-Key': 'k' });
    expect(authHeaders({ BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p' })).toMatchObject({ Authorization: `Basic ${Buffer.from('u:p').toString('base64')}` });
    expect(() => authHeaders({ BCONNECT_USERNAME: 'u' })).toThrow(/BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD/);
  });

  it('accepts https, and http only for this machine', () => {
    expect(checkBaseUrl('https://bms.example/bconnect')).toBe('https://bms.example/bconnect');
    expect(checkBaseUrl('http://127.0.0.1:13433')).toBe('http://127.0.0.1:13433/');
    expect(() => checkBaseUrl('http://bms.example/bconnect')).toThrow(/must start with https:\/\//);
    expect(() => checkBaseUrl(undefined)).toThrow(/must be an https:\/\/ URL/);
  });

  it('keeps certificate checks on and starts no other program', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'download-openapi-specs.mjs'), 'utf8');
    expect(source).not.toMatch(/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|child_process|curl/);
  });
});

describe('downloading', () => {
  let out: string;
  afterEach(() => { rmSync(out, { recursive: true, force: true }); vi.restoreAllMocks(); });

  /** A bMS stand-in: a valid document for each module, except `answers` overrides. */
  async function bms(answers: Record<string, { status: number; body: string }>): Promise<{ url: string; seen: http.IncomingHttpHeaders[]; close: () => Promise<void> }> {
    const seen: http.IncomingHttpHeaders[] = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers);
      const module = (req.url ?? '').split('/')[2];
      const answer = answers[module] ?? { status: 200, body: JSON.stringify({ openapi: '3.0.1', paths: {}, info: { title: module } }) };
      res.writeHead(answer.status, { 'content-type': 'application/json' }).end(answer.body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return { url: `http://127.0.0.1:${port}/bconnect`, seen, close: () => new Promise((resolve) => server.close(() => resolve())) };
  }

  it('writes every module into the folder and sends the credential as a header', async () => {
    out = mkdtempSync(join(tmpdir(), 'specs-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const server = await bms({});
    try {
      expect(await download('26R1', { BCONNECT_BASE_URL: server.url, BCONNECT_API_KEY: 'secret-key' }, out)).toEqual([]);
    } finally {
      await server.close();
    }
    expect(readdirSync(out).sort()).toEqual(Object.values(SPECS['26R1']).sort());
    expect(server.seen.every((h) => h['x-api-key'] === 'secret-key')).toBe(true);
  });

  it('reports each failure, and keeps the old file when a download fails or is no OpenAPI document', async () => {
    out = mkdtempSync(join(tmpdir(), 'specs-'));
    writeFileSync(join(out, 'bConnect_Jobs.json'), 'old jobs');
    writeFileSync(join(out, 'bConnect_Assets.json'), 'old assets');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = await bms({ jobs: { status: 404, body: '{}' }, assets: { status: 200, body: '<html>login</html>' } });
    let failures: string[];
    try {
      failures = await download('25R2', { BCONNECT_BASE_URL: server.url, BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p' }, out);
    } finally {
      await server.close();
    }
    // The JSON parser's wording differs between Node.js versions; the module and the 404 don't.
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/^assets: .*JSON/);
    expect(failures[1]).toBe('jobs: HTTP 404');
    expect(readFileSync(join(out, 'bConnect_Jobs.json'), 'utf8')).toBe('old jobs');
    expect(readFileSync(join(out, 'bConnect_Assets.json'), 'utf8')).toBe('old assets');
    expect(readdirSync(out).filter((f) => f.endsWith('.download'))).toEqual([]);
  });

  it('refuses an unknown release', async () => {
    out = mkdtempSync(join(tmpdir(), 'specs-'));
    await expect(download('26R2', { BCONNECT_BASE_URL: 'https://bms.example', BCONNECT_API_KEY: 'k' }, out)).rejects.toThrow(/unknown release "26R2"/);
  });
});
