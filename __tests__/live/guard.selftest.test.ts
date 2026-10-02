/**
 * Self-test of the live tier's request guard against a local HTTP server. Needs no bMS.
 * Requests go through axios, as the servers' do (including its redirect handling).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request as namedRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import { createGuard } from './lib/guard.mjs';

const SECRET = '/bconnect/defensecontrol/v2.0/BitLocker/WindowsEndpoints/00000000-0000-4000-8000-000000000001/Secrets';
let server: Server;
let other: Server;
let origin = '';
let otherOrigin = '';
const hits: string[] = [];
const otherHits: string[] = [];

beforeAll(async () => {
  // Another origin on the same host: a redirect target the guard must never reach.
  other = createServer((req, res) => {
    otherHits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"other":true}');
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
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => other.close(() => resolve()));
});

describe('live request guard', () => {
  let guard: ReturnType<typeof createGuard>;
  beforeAll(() => {
    guard = createGuard({ origin });
    guard.start();
  });
  afterAll(() => guard.stop());
  beforeEach(() => {
    guard.refused.length = 0;
    hits.length = 0;
    otherHits.length = 0;
  });

  it('lets a GET to the bMS through', async () => {
    const res = await axios.get(`${origin}/bconnect/endpoints/v2.0/Endpoints`);
    expect(res.status).toBe(200);
    expect(hits).toEqual(['GET /bconnect/endpoints/v2.0/Endpoints']);
    expect(guard.refused).toEqual([]);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s before it leaves the process', async (method) => {
    await expect(axios.request({ method, url: `${origin}/bconnect/endpoints/v2.0/Endpoints`, data: {} })).rejects.toThrow();
    expect(hits).toEqual([]);
    expect(guard.refused).toEqual([{ method, path: '/bconnect/endpoints/v2.0/Endpoints', reason: `method ${method}` }]);
  });

  it('refuses a request sent through a named ESM import of node:http', async () => {
    // A binding imported before the guard started; MSW patches only the CommonJS module.
    const outcome = await new Promise<string>((resolve) => {
      const req = namedRequest(`${origin}/bconnect/endpoints/v2.0/Endpoints`, { method: 'DELETE' }, (res) => {
        res.resume();
        resolve(`answered ${res.statusCode}`);
      });
      req.on('error', () => resolve('refused'));
      req.end();
    });
    expect(outcome).toBe('refused');
    expect(hits).toEqual([]);
    expect(guard.refused).toEqual([{ method: 'DELETE', path: '/bconnect/endpoints/v2.0/Endpoints', reason: 'method DELETE' }]);
  });

  it('refuses another origin', async () => {
    await expect(axios.get('http://other.selftest.invalid/bconnect/endpoints/v2.0/Endpoints')).rejects.toThrow();
    expect(guard.refused).toEqual([{ method: 'GET', path: '/bconnect/endpoints/v2.0/Endpoints', reason: 'another origin' }]);
  });

  it('refuses the bMS host on another port', async () => {
    await expect(axios.get(`${otherOrigin}/bconnect/endpoints/v2.0/Endpoints`)).rejects.toThrow();
    expect(otherHits).toEqual([]);
    expect(guard.refused).toEqual([{ method: 'GET', path: '/bconnect/endpoints/v2.0/Endpoints', reason: 'another origin' }]);
  });

  it('refuses a credential-returning route', async () => {
    await expect(axios.get(`${origin}${SECRET}`)).rejects.toThrow();
    expect(hits).toEqual([]);
    expect(guard.refused).toEqual([{ method: 'GET', path: SECRET, reason: 'credential route' }]);
  });

  it('records a redirect that fetch would follow, and never reaches its target', async () => {
    // fetch defaults to redirect: 'follow', which undici handles underneath the guard.
    await fetch(`${origin}/bconnect/redirect-elsewhere`).catch(() => undefined);
    expect(hits).toEqual(['GET /bconnect/redirect-elsewhere']);
    expect(otherHits).toEqual([]);
    expect(guard.refused.map((r) => r.reason)).toContain('redirect (307)');
  });

  it('records a redirect and refuses to follow it', async () => {
    await expect(axios.get(`${origin}/bconnect/redirect`)).rejects.toThrow();
    expect(hits).toEqual(['GET /bconnect/redirect']);
    expect(guard.refused.map((r) => r.reason)).toEqual(['redirect (302)', 'redirect target']);
  });
});
