/**
 * Self-test of the guard the spawned servers run under, and of the rule that a
 * server sends nothing at startup but its startup check. Needs no bMS.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CHILD_GUARD, readGuardLog, startupFailures, startupProblems } from './lib/child.js';

/** axios by file URL: the client script lives in a temp folder without node_modules. */
const AXIOS = pathToFileURL(createRequire(import.meta.url).resolve('axios')).href;
const dir = mkdtempSync(join(tmpdir(), 'child-guard-'));
let server: Server;
let other: Server;
let base = '';
let otherOrigin = '';
const hits: string[] = [];
const otherHits: string[] = [];

beforeAll(async () => {
  // Another origin: a redirect target the spawned process must never reach.
  other = createServer((req, res) => {
    otherHits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('[]');
  });
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
  otherOrigin = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
  server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === '/bconnect/redirect') {
      res.writeHead(302, { Location: '/bconnect/target' });
      res.end();
      return;
    }
    if (req.url === '/bconnect/redirect-elsewhere') {
      res.writeHead(307, { Location: `${otherOrigin}/bconnect/endpoints/v2.0/Endpoints` });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('[]');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/bconnect`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => other.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

/** Run `lines` (after an axios import) under the preload; resolves the guard log. */
async function underGuard(name: string, lines: string[]): Promise<ReturnType<typeof readGuardLog>> {
  const script = join(dir, `${name}.mjs`);
  writeFileSync(script, [`import axios from '${AXIOS}';`, ...lines].join('\n'));
  const log = join(dir, `${name}.log`);
  // Async: the local server answers from this process, so it must not block.
  const child = spawn(process.execPath, ['--import', CHILD_GUARD, script], {
    cwd: process.cwd(), env: { ...process.env, BCONNECT_BASE_URL: base, LIVE_GUARD_LOG: log },
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  expect(code, stderr).toBe(0);
  return readGuardLog(log);
}

const SECRET = '/bconnect/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/00000000-0000-4000-8000-000000000001';

describe('guard in a spawned process', () => {
  beforeEach(() => { hits.length = 0; otherHits.length = 0; });

  it('refuses another origin, a credential route and a redirect, and logs each', async () => {
    const log = await underGuard('refusals', [
      "await axios.get('http://other.selftest.invalid/bconnect/endpoints/v2.0/Endpoints').catch(() => {});",
      `await axios.get('${base.replace('/bconnect', '')}${SECRET}').catch(() => {});`,
      `await axios.get('${base}/redirect').catch(() => {});`,
    ]);
    expect(hits).toEqual(['GET /bconnect/redirect']);
    expect(log).toEqual([
      { method: 'GET', path: '/bconnect/endpoints/v2.0/Endpoints', query: '', refused: 'another origin' },
      { method: 'GET', path: SECRET, query: '', refused: 'credential route' },
      { method: 'GET', path: '/bconnect/redirect', query: '' },
      { method: 'GET', path: '/bconnect/redirect', query: '', refused: 'redirect (302)' },
      { method: 'GET', path: '/bconnect/target', query: '', refused: 'redirect target' },
    ]);
  });

  it('logs a redirect that fetch would follow, and never reaches its target', async () => {
    const log = await underGuard('fetch-redirect', [
      `await fetch('${base}/redirect-elsewhere').catch(() => {});`,
    ]);
    expect(hits).toEqual(['GET /bconnect/redirect-elsewhere']);
    expect(otherHits).toEqual([]);
    expect(log).toContainEqual({ method: 'GET', path: '/bconnect/redirect-elsewhere', query: '', refused: 'redirect (307)' });
  });

  it('refuses and logs a request sent through a named ESM import of node:http', async () => {
    const log = await underGuard('named-import', [
      "import { request } from 'node:http';",
      'await new Promise((resolve) => {',
      `  const req = request('${base}/endpoints/v2.0/Endpoints', { method: 'DELETE' }, (res) => { res.resume(); resolve(); });`,
      "  req.on('error', resolve);",
      '  req.end();',
      '});',
    ]);
    expect(hits).toEqual([]);
    expect(log).toEqual([{ method: 'DELETE', path: '/bconnect/endpoints/v2.0/Endpoints', query: '', refused: 'method DELETE' }]);
  });

  it('passes a GET, refuses a POST, and logs both', async () => {
    const log = await underGuard('get-post', [
      `await axios.get('${base}/endpoints/v2.0/Endpoints', { params: { PageSize: 1 } });`,
      `await axios.post('${base}/endpoints/v2.0/Endpoints', {}).catch(() => {});`,
    ]);
    expect(hits).toEqual(['GET /bconnect/endpoints/v2.0/Endpoints?PageSize=1']);
    expect(log).toEqual([
      { method: 'GET', path: '/bconnect/endpoints/v2.0/Endpoints', query: 'PageSize=1' },
      { method: 'POST', path: '/bconnect/endpoints/v2.0/Endpoints', query: '', refused: 'method POST' },
    ]);
  });
});

describe('a server counts as started only when every startup check passed', () => {
  const probe = { method: 'GET', path: '/bconnect/endpoints/v2.0/Endpoints', query: 'PageSize=1' };
  const clean = { initialized: true, tools: 12, nonJson: 0, requests: [probe] };

  it('passes a clean startup', () => {
    expect(startupFailures(clean, 'endpoints', '/bconnect')).toEqual([]);
  });

  it('fails a startup that answered but sent more than its startup check', () => {
    expect(startupFailures({ ...clean, requests: [probe, probe] }, 'endpoints', '/bconnect')).toEqual(['2 requests at startup, expected 1']);
  });

  it('fails no initialize answer, no tools and non-JSON output', () => {
    expect(startupFailures({ ...clean, initialized: false }, 'endpoints', '/bconnect')).toEqual(['no initialize answer']);
    expect(startupFailures({ ...clean, tools: 0 }, 'endpoints', '/bconnect')).toEqual(['tools/list returned no tools']);
    expect(startupFailures({ ...clean, nonJson: 2 }, 'endpoints', '/bconnect')).toEqual(['2 stdout lines that are not JSON-RPC']);
  });
});

describe('startup sends only the startup check', () => {
  const probe = { method: 'GET', path: '/bconnect/endpoints/v2.0/Endpoints', query: 'PageSize=1' };

  it('accepts one GET list request of the own domain with PageSize=1', () => {
    expect(startupProblems([probe], 'endpoints', '/bconnect')).toEqual([]);
  });

  it('flags no request, a second request, another domain, a refusal and a missing PageSize', () => {
    expect(startupProblems([], 'endpoints', '/bconnect')).toEqual(['no startup check was sent']);
    expect(startupProblems([probe, probe], 'endpoints', '/bconnect')).toEqual(['2 requests at startup, expected 1']);
    expect(startupProblems([{ ...probe, path: '/bconnect/jobs/v2.0/Folders' }], 'endpoints', '/bconnect'))
      .toEqual(['startup check went to /bconnect/jobs/v2.0/Folders, not the endpoints API']);
    expect(startupProblems([{ ...probe, method: 'POST', refused: 'method POST' }], 'endpoints', '/bconnect'))
      .toEqual(['refused at startup: POST /bconnect/endpoints/v2.0/Endpoints (method POST)']);
    expect(startupProblems([{ ...probe, query: '' }], 'endpoints', '/bconnect')).toEqual(['startup check without PageSize=1']);
  });
});
