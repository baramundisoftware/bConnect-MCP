/**
 * One startup routine and one client per server (REQ-SRV-023, #160, ADR-0010).
 *
 * The core keeps one bConnect client per server process and starts every
 * server the same way. These tests pin the core pieces; the per-server and
 * gateway checks live in shared-client.test.ts and the gateway's app test.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { BConnectClientBase, type BConnectConfig } from '../packages/mcp-core/src/bconnect-client-base.js';
import { ResponseCache } from '../packages/mcp-core/src/response-cache.js';
import { loadEnvOnce, serverClients, startServer, type ClientOptions } from '../packages/mcp-core/src/server-runtime.js';
import { forgetDetectedRelease, selectedRelease } from '../packages/mcp-core/src/release.js';

const BASE_URL = 'http://bms.runtime.test/bconnect';
const ENV = {
  BCONNECT_BASE_URL: BASE_URL,
  BCONNECT_ALLOW_INSECURE_HTTP: 'true',
  BCONNECT_USERNAME: 'runtime-user',
  BCONNECT_PASSWORD: 'runtime-pass',
};

/** A server's client as the servers declare it: the base plus a probe route. */
class TestClient extends BConnectClientBase {
  static built: Array<{ config: Readonly<BConnectConfig>; options?: ClientOptions }> = [];
  protected override readonly probeRoute = '/runtime/v2.0/Things';
  constructor(config: Readonly<BConnectConfig>, options?: ClientOptions) {
    super(config, options);
    TestClient.built.push({ config, options });
  }
  get(path: string) { return this.client.get(path); }
  patch(path: string) { return this.client.patch(path, []); }
}

let requests: string[] = [];
const msw = setupServer(http.all('*', ({ request }) => {
  requests.push(`${request.method} ${new URL(request.url).pathname}`);
  return HttpResponse.json({ at: requests.length });
}));
beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { requests = []; TestClient.built = []; forgetDetectedRelease(); msw.resetHandlers(); });

const DETECT = 'GET /bconnect/servermanagement/v2.0/ManagementServer';
afterAll(() => msw.close());

describe('serverClients: one client per server process (D1 = a)', () => {
  it('gives every call the same client while the settings stay the same', () => {
    const clients = serverClients(TestClient, { ...ENV });
    expect(clients.get()).toBe(clients.get());
    expect(TestClient.built).toHaveLength(1);
  });

  it('builds a new client when a client setting changes', () => {
    const env: NodeJS.ProcessEnv = { ...ENV };
    const clients = serverClients(TestClient, env);
    const first = clients.get();
    env.BCONNECT_AUDIT_LEVEL = 'all';
    const second = clients.get();
    expect(second).not.toBe(first);
    expect(second).toBe(clients.get());
    expect(TestClient.built.map((b) => b.config.auditLog?.level)).toEqual(['none', 'all']);
  });

  it('reads the CA file only when it builds a client', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-ca-'));
    const ca = join(dir, 'ca.pem');
    writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nruntime\n-----END CERTIFICATE-----\n');
    const clients = serverClients(TestClient, { ...ENV, BCONNECT_CA_CERT_PATH: ca });
    clients.get();
    writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nchanged\n-----END CERTIFICATE-----\n');
    clients.get();
    expect(TestClient.built).toHaveLength(1);
    expect(TestClient.built[0].config.ca).toContain('runtime');
  });

  it('gives per-request credentials their own client, one per credentials object', () => {
    const clients = serverClients(TestClient, { ...ENV });
    const session = { apiKey: 'session-key' };
    const own = clients.get(session);
    expect(own).toBe(clients.get(session));
    expect(own).not.toBe(clients.get());
    expect(clients.get({ apiKey: 'session-key' })).not.toBe(own);
    expect(own).not.toBe(clients.get({ apiKey: 'other-key' }));
  });

  it('treats credentials with only empty values as none', () => {
    const clients = serverClients(TestClient, { ...ENV });
    expect(clients.get({ apiKey: '', username: '' })).toBe(clients.get());
  });

  it('throws the configuration error, so the tool call can report it', () => {
    const clients = serverClients(TestClient, { BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p' });
    expect(() => clients.get()).toThrow(/BCONNECT_BASE_URL/);
  });

  it('shares one rate limit across all calls and all clients of the server (AC 1)', async () => {
    const env = { ...ENV, BCONNECT_RATE_LIMIT_ENABLED: 'true', BCONNECT_RATE_LIMIT_MAX_REQUESTS: '2', BCONNECT_RATE_LIMIT_WINDOW_MS: '600000' };
    const clients = serverClients(TestClient, env);
    const outcomes: string[] = [];
    for (const client of [clients.get(), clients.get(), clients.get({ apiKey: 'k' }), clients.get(), clients.get(), clients.get()]) {
      outcomes.push(await client.get('/runtime/v2.0/Things').then(() => 'ok', (e: Error) => (/rate limit/i.test(e.message) ? 'refused' : e.message)));
    }
    expect(outcomes).toEqual(['ok', 'ok', 'refused', 'refused', 'refused', 'refused']);
    expect(requests).toHaveLength(2);
  });

  it('keeps separate limits for separate servers', async () => {
    const env = { ...ENV, BCONNECT_RATE_LIMIT_ENABLED: 'true', BCONNECT_RATE_LIMIT_MAX_REQUESTS: '1', BCONNECT_RATE_LIMIT_WINDOW_MS: '600000' };
    const a = serverClients(TestClient, env);
    const b = serverClients(TestClient, env);
    await a.get().get('/runtime/v2.0/Things');
    await expect(b.get().get('/runtime/v2.0/Things')).resolves.toBeDefined();
  });
});

describe('startServer: the one startup routine', () => {
  function io(env: NodeJS.ProcessEnv) {
    const lines: string[] = [];
    const exit = vi.fn((code: number) => { throw new Error(`exit ${code}`); }) as unknown as (code: number) => never;
    const connectStdio = vi.fn(async () => undefined);
    return { lines, exit, connectStdio, options: { env, error: (line: string) => lines.push(line), exit, connectStdio } };
  }
  const entry = (env: NodeJS.ProcessEnv, createServer = () => ({ server: {} as never })) => ({
    name: 'bconnect-runtime-mcp',
    createServer,
    clients: serverClients(TestClient, env),
  });

  it('checks the connection with the shared client and says it verified it', async () => {
    const env = { ...ENV };
    const t = io(env);
    const e = entry(env);
    await startServer(e, t.options);
    expect(requests).toEqual([DETECT, 'GET /bconnect/runtime/v2.0/Things']);
    expect(t.lines.join('\n')).toMatch(/verified/);
    expect(TestClient.built).toHaveLength(1);
    expect(e.clients.get()).toBe(e.clients.get());
    expect(t.connectStdio).toHaveBeenCalledOnce();
  });

  it('says the check was skipped, never verified, with BCONNECT_SKIP_CONNECTIVITY_CHECK=true (AC 3)', async () => {
    const env = { ...ENV, BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' };
    const t = io(env);
    await startServer(entry(env), t.options);
    expect(requests).toEqual([]);
    const log = t.lines.join('\n');
    expect(log).toMatch(/skipped/i);
    expect(log).not.toMatch(/verif/i);
    expect(t.connectStdio).toHaveBeenCalledOnce();
  });

  it('still checks the settings when the connection check is skipped', async () => {
    const env = { BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p', BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' };
    const t = io(env);
    await expect(startServer(entry(env), t.options)).rejects.toThrow('exit 1');
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toMatch(/^bconnect-runtime-mcp: .*BCONNECT_BASE_URL/);
  });

  it('stops with one line when bConnect cannot be reached', async () => {
    msw.use(http.all('*', () => HttpResponse.json({ title: 'Unauthorized' }, { status: 401 })));
    const env = { ...ENV };
    const t = io(env);
    await expect(startServer(entry(env), t.options)).rejects.toThrow('exit 1');
    expect(t.connectStdio).not.toHaveBeenCalled();
    // Detection can't read the version either: it warns and falls back; the connectivity check stops the server.
    const failure = t.lines.filter((l) => !/verifying|could not detect the bMS release/.test(l));
    expect(failure).toHaveLength(1);
    expect(failure[0]).toMatch(/^bconnect-runtime-mcp: /);
    expect(failure[0]).not.toContain('runtime-pass');
  });

  it('reports an unexpected error as one line without a stack trace (AC 2)', async () => {
    const env = { ...ENV, BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' };
    const t = io(env);
    const boom = () => { throw new Error('boom\nsecond line'); };
    await expect(startServer(entry(env, boom), t.options)).rejects.toThrow('exit 1');
    expect(t.lines.at(-1)).toBe('bconnect-runtime-mcp: boom second line');
  });

  it('stays fast on a message with a long run of spaces and no line break', async () => {
    const env = { ...ENV, BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' };
    const t = io(env);
    const boom = () => { throw new Error(`a${' '.repeat(50000)}b`); };
    const started = performance.now();
    await expect(startServer(entry(env, boom), t.options)).rejects.toThrow('exit 1');
    expect(performance.now() - started).toBeLessThan(500);
    expect(t.lines.at(-1)).toMatch(/^bconnect-runtime-mcp: a +b$/);
    expect(t.lines.join('\n')).not.toMatch(/\n\s+at /);
  });
});

describe('startServer: the bMS release is detected first (REQ-SRV-028, #159)', () => {
  function io(env: NodeJS.ProcessEnv) {
    const lines: string[] = [];
    const exit = vi.fn((code: number) => { throw new Error(`exit ${code}`); }) as unknown as (code: number) => never;
    const connectStdio = vi.fn(async () => { order.push('serve'); });
    return { lines, connectStdio, options: { env, error: (line: string) => lines.push(line), exit, connectStdio } };
  }
  let order: string[] = [];
  const entry = (env: NodeJS.ProcessEnv) => ({
    name: 'bconnect-runtime-mcp',
    createServer: () => { order.push(`createServer ${selectedRelease(env)}`); return { server: {} as never }; },
    clients: serverClients(TestClient, env),
  });
  afterEach(() => { order = []; });

  it('reads the version before the connectivity check and before the server is created, and logs the release', async () => {
    msw.use(http.get('*/servermanagement/v2.0/ManagementServer', () => {
      requests.push(DETECT);
      return HttpResponse.json({ name: 'bMS', version: '25.2.0.0' });
    }));
    const env = { ...ENV };
    const t = io(env);
    await startServer(entry(env), t.options);
    expect(requests).toEqual([DETECT, 'GET /bconnect/runtime/v2.0/Things']);
    expect(order).toEqual(['createServer 25R2', 'serve']);
    expect(t.lines).toContain('bconnect-runtime-mcp: bMS 25.2.0.0 → release 25R2');
  });

  it('starts with the setting and a warning when the version can\'t be read (AC 3)', async () => {
    msw.use(http.get('*/servermanagement/v2.0/ManagementServer', () => HttpResponse.json({ title: 'Forbidden' }, { status: 403 })));
    const env = { ...ENV, BCONNECT_RELEASE: '25R2' };
    const t = io(env);
    await startServer(entry(env), t.options);
    expect(order).toEqual(['createServer 25R2', 'serve']);
    expect(t.lines.find((l) => /could not detect the bMS release/.test(l))).toMatch(/^bconnect-runtime-mcp: .*403.*using 25R2 \(from BCONNECT_RELEASE\)/);
  });

  it('sends nothing with BCONNECT_SKIP_CONNECTIVITY_CHECK=true and says which release it uses', async () => {
    const env = { ...ENV, BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' };
    const t = io(env);
    await startServer(entry(env), t.options);
    expect(requests).toEqual([]);
    expect(t.lines).toContain('bconnect-runtime-mcp: release detection skipped (BCONNECT_SKIP_CONNECTIVITY_CHECK=true); using 26R1 (default)');
  });
});

describe('testConnection', () => {
  it('no longer reads the skip flag: the startup routine decides (AC 3)', async () => {
    vi.stubEnv('BCONNECT_SKIP_CONNECTIVITY_CHECK', 'true');
    try {
      const client = serverClients(TestClient, { ...ENV }).get();
      await expect(client.testConnection()).resolves.toBe(true);
      expect(requests).toEqual(['GET /bconnect/runtime/v2.0/Things']);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('loadEnvOnce', () => {
  it('loads the .env file once per process and never overrides a set variable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-env-'));
    const file = join(dir, '.env');
    const env: NodeJS.ProcessEnv = { SET_BEFORE: 'kept' };
    writeFileSync(file, 'FROM_FILE=first\nSET_BEFORE=file\n');
    const writes = vi.spyOn(process.stdout, 'write');
    loadEnvOnce(file, env);
    writeFileSync(file, 'FROM_FILE=second\nLATER=x\n');
    loadEnvOnce(file, env);
    expect(env).toEqual({ SET_BEFORE: 'kept', FROM_FILE: 'first' });
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });
});

describe('response cache, when enabled in the client config (AC 4, D3 = a)', () => {
  const cached = (extra: Partial<BConnectConfig> = {}) =>
    new TestClient({ baseUrl: BASE_URL, apiKey: 'k', cache: { enabled: true, ttl: 60000 }, ...extra });

  it('answers a repeated GET from the cache without sending it', async () => {
    const client = cached();
    const first = await client.get('/runtime/v2.0/Things');
    const second = await client.get('/runtime/v2.0/Things');
    expect(requests).toEqual(['GET /bconnect/runtime/v2.0/Things']);
    expect(second.data).toEqual(first.data);
  });

  it('does not use up a rate-limit token on a cache hit', async () => {
    const client = cached({ rateLimit: { enabled: true, maxRequests: 1, windowMs: 600000 } });
    await client.get('/runtime/v2.0/Things');
    await expect(client.get('/runtime/v2.0/Things')).resolves.toBeDefined();
    await expect(client.get('/runtime/v2.0/Things')).resolves.toBeDefined();
    expect(requests).toHaveLength(1);
  });

  it('forgets the resource and its list after a write to it', async () => {
    const client = cached();
    await client.get('/runtime/v2.0/Things');
    await client.get('/runtime/v2.0/Things/1');
    await client.get('/runtime/v2.0/Others');
    await client.patch('/runtime/v2.0/Things/1');
    requests = [];
    await client.get('/runtime/v2.0/Things');
    await client.get('/runtime/v2.0/Things/1');
    await client.get('/runtime/v2.0/Others');
    expect(requests).toEqual(['GET /bconnect/runtime/v2.0/Things', 'GET /bconnect/runtime/v2.0/Things/1']);
  });

  it('matches invalidation by whole path segments, not as a pattern', () => {
    const cache = new ResponseCache({ enabled: true, ttl: 60000 });
    cache.set('GET', '/d/v2.0/Xa1', 'other');
    cache.set('GET', '/d/v2.0/ThingsX', 'other');
    cache.set('GET', '/d/v2.0/X.1/sub', 'mine');
    cache.invalidatePath('/d/v2.0/X.1');
    cache.invalidatePath('/d/v2.0/Things');
    expect(cache.get('GET', '/d/v2.0/Xa1')).toBe('other');
    expect(cache.get('GET', '/d/v2.0/ThingsX')).toBe('other');
    expect(cache.get('GET', '/d/v2.0/X.1/sub')).toBeNull();
  });

  it('ignores trailing slashes and stays fast on a path made of many slashes', () => {
    const cache = new ResponseCache({ enabled: true, ttl: 60000 });
    cache.set('GET', '/d/v2.0/Things/1', 'mine');
    expect(cache.invalidatePath('/d/v2.0/Things///')).toBe(1);
    const started = performance.now();
    cache.invalidatePath(`${'/'.repeat(50000)}x`);
    cache.invalidatePath('/'.repeat(50000));
    expect(performance.now() - started).toBeLessThan(200);
  });

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY]])('refuses a TTL of %s', (ttl) => {
    expect(() => new ResponseCache({ enabled: true, ttl })).toThrow(RangeError);
  });

  it('is off unless the client config enables it', async () => {
    const client = new TestClient({ baseUrl: BASE_URL, apiKey: 'k' });
    await client.get('/runtime/v2.0/Things');
    await client.get('/runtime/v2.0/Things');
    expect(requests).toHaveLength(2);
  });
});

describe('connection reuse (AC 9, D2 = c)', () => {
  let server: HttpServer;
  let connections = 0;
  let base = '';
  beforeAll(async () => {
    msw.close();
    server = createHttpServer((req, res) => {
      setTimeout(() => res.end('[]'), req.url?.endsWith('/Slow') ? 400 : 0);
    });
    server.on('connection', () => { connections++; });
    server.keepAliveTimeout = 60000;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/bconnect`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    msw.listen({ onUnhandledRequest: 'error' });
  });
  afterEach(() => { connections = 0; });

  const client = (idleSocketMs?: number) => new TestClient({ baseUrl: base, apiKey: 'k' }, { idleSocketMs });

  it('sends consecutive requests over one connection', async () => {
    const c = client();
    await c.get('/runtime/v2.0/Things');
    await c.get('/runtime/v2.0/Things');
    await c.get('/runtime/v2.0/Things');
    expect(connections).toBe(1);
  });

  it('closes an idle connection after the idle time and opens a new one', async () => {
    const c = client(150);
    await c.get('/runtime/v2.0/Things');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await c.get('/runtime/v2.0/Things');
    expect(connections).toBe(2);
  });

  it('does not cut off an answer that takes longer than the idle time', async () => {
    const c = client(150);
    await expect(c.get('/runtime/v2.0/Slow')).resolves.toBeDefined();
  });

  it('closes idle connections after 5 s by default', () => {
    const c = client();
    const agent = (c as unknown as { client: { defaults: { httpAgent: { options: { timeout?: number; keepAlive?: boolean } } } } }).client.defaults.httpAgent;
    expect(agent.options).toMatchObject({ keepAlive: true, timeout: 5000 });
  });
});

describe('review follow-ups (REQ-SRV-023)', () => {
  const freePort = async (): Promise<number> => {
    const probe = createHttpServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return typeof address === 'object' && address ? address.port : 0;
  };
  function io(env: NodeJS.ProcessEnv) {
    const lines: string[] = [];
    const servers: HttpServer[] = [];
    const exit = vi.fn((code: number) => { throw new Error(`exit ${code}`); }) as unknown as (code: number) => never;
    return { lines, servers, options: { env, error: (line: string) => lines.push(line), exit, connectStdio: vi.fn(), listening: (s: HttpServer) => servers.push(s) } };
  }
  const httpEntry = (env: NodeJS.ProcessEnv) => ({ name: 'bconnect-runtime-mcp', createServer: () => ({ server: {} as never }), clients: serverClients(TestClient, env) });

  it('reports a port that is already in use as one line, exit 1', async () => {
    const busy = createHttpServer();
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
    const port = (busy.address() as { port: number }).port;
    const env = { ...ENV, BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', MCP_TRANSPORT: 'http', MCP_PORT: String(port) };
    const t = io(env);
    try {
      await expect(startServer(httpEntry(env), t.options)).rejects.toThrow('exit 1');
      expect(t.lines.at(-1)).toMatch(/^bconnect-runtime-mcp: .*EADDRINUSE/);
    } finally {
      await new Promise<void>((resolve) => busy.close(() => resolve()));
    }
  });

  it('answers malformed JSON in HTTP mode with a JSON-RPC error, no stack or paths', async () => {
    const port = await freePort();
    const env = { ...ENV, BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', MCP_TRANSPORT: 'http', MCP_PORT: String(port) };
    const t = io(env);
    await startServer(httpEntry(env), t.options);
    try {
      msw.close();
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
      const text = await res.text();
      expect(res.status).toBe(400);
      expect(JSON.parse(text)).toMatchObject({ jsonrpc: '2.0', error: { code: -32700 } });
      expect(text).not.toMatch(/\bat |node_modules|\/build\//);
    } finally {
      for (const s of t.servers) {await new Promise<void>((resolve) => s.close(() => resolve()));}
      msw.listen({ onUnhandledRequest: 'error' });
    }
  });

  it('names the network cause of a failed connectivity check, without the host', async () => {
    msw.close();
    try {
      const port = await freePort();
      const client = new TestClient({ baseUrl: `http://127.0.0.1:${port}/bconnect`, apiKey: 'k' });
      const reason = await client.checkConnection();
      expect(reason).toMatch(/ECONNREFUSED/);
      expect(reason).not.toContain('127.0.0.1');
    } finally {
      msw.listen({ onUnhandledRequest: 'error' });
    }
  });

  describe('a kept-alive connection the server dropped', () => {
    let server: HttpServer;
    let base = '';
    let received: string[] = [];
    beforeAll(async () => {
      msw.close();
      const perSocket = new WeakMap<object, number>();
      server = createHttpServer((req, res) => {
        const n = (perSocket.get(req.socket) ?? 0) + 1;
        perSocket.set(req.socket, n);
        received.push(`${req.method} #${n}`);
        // The second request on a reused connection finds it closed, as when bMS or a proxy timed it out.
        if (n === 2) {req.socket.destroy(); return;}
        res.setHeader('content-type', 'application/json');
        res.end('[]');
      });
      server.keepAliveTimeout = 60000;
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}/bconnect`;
    });
    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      msw.listen({ onUnhandledRequest: 'error' });
    });
    afterEach(() => { received = []; });

    it('retries a read once on a new connection, even with retries off', async () => {
      const client = new TestClient({ baseUrl: base, apiKey: 'k' });
      await client.get('/runtime/v2.0/Things');
      await expect(client.get('/runtime/v2.0/Things')).resolves.toBeDefined();
      expect(received).toEqual(['GET #1', 'GET #2', 'GET #1']);
    });

    it('never repeats a write: it is reported as outcome unknown', async () => {
      const client = new TestClient({ baseUrl: base, apiKey: 'k' });
      await client.get('/runtime/v2.0/Things');
      await expect(client.patch('/runtime/v2.0/Things/1')).rejects.toThrow(/may still|outcome/i);
      expect(received).toEqual(['GET #1', 'PATCH #2']);
    });
  });

  it('audits the answer of a cache hit as well as the request', async () => {
    const entries: string[] = [];
    const client = new TestClient({ baseUrl: BASE_URL, apiKey: 'k', cache: { enabled: true, ttl: 60000 },
      auditLog: { level: 'all', logHandler: (entry) => { entries.push(`${entry.method} ${entry.statusCode ?? 'request'}`); } } });
    await client.get('/runtime/v2.0/Things');
    await client.get('/runtime/v2.0/Things');
    expect(entries.filter((e) => e.startsWith('GET 200'))).toHaveLength(2);
  });

});
