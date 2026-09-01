/**
 * T3 — subsystem reachability, asserted through the real request path.
 *
 * Upstream findings B5, B7, B8 and B11 all survived because the suite unit-tests
 * its components in isolation and never exercises them through a configured
 * client. Each of these subsystems passed its own unit tests while being either
 * unreachable by any deployment (cache, batch), silently ineffective (rate
 * limiting), or actively harmful (audit logging on stdout).
 *
 * Every test here does the same three things: turn the subsystem on, make a
 * request go through it, and assert something observable — a request that was
 * NOT made, a request that WAS refused, a line that did NOT land on stdout.
 *
 * Auth, caching, rate limiting and audit all live in `BConnectClientBase`
 * (@bconnect/mcp-core), which all 13 servers extend unchanged — so exercising
 * the base here covers the suite, exactly as api-key-auth.test.ts does.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BConnectClientBase, type BConnectConfig, type AuditLogEntry } from '@bconnect/mcp-core';

const BASE_URL = 'https://bms.test.local/bconnect';

/** Counts what actually left the process, which is the only honest cache metric. */
let networkCalls = 0;
/** Bumped per response so a stale body is distinguishable from a fresh one. */
let serial = 0;

class ProbeClient extends BConnectClientBase {
  get(url: string, params?: Record<string, unknown>) {
    return this.client.get(url, { params });
  }
  post(url: string, body: unknown) {
    return this.client.post(url, body);
  }
}

const server = setupServer(
  http.get(`${BASE_URL}/items`, () => {
    networkCalls++;
    serial++;
    return HttpResponse.json({ serial, data: [] });
  }),
  http.post(`${BASE_URL}/items`, () => {
    networkCalls++;
    return HttpResponse.json({ created: true });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  networkCalls = 0;
  serial = 0;
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function makeClient(cfg: Partial<BConnectConfig>): ProbeClient {
  // disableHttpsAgent lets MSW intercept the request in Node.
  return new ProbeClient({
    baseUrl: BASE_URL,
    apiKey: 'test-key',
    disableHttpsAgent: true,
    ...cfg,
  });
}

// ── B7 — the response cache ───────────────────────────────────────────────────

describe('B7 — response cache', () => {
  it('serves the second identical GET without making a second request', async () => {
    const client = makeClient({ cache: { enabled: true, ttl: 60000 } });

    const first = await client.get('/items');
    const second = await client.get('/items');

    // The whole point of a cache. Before the fix this was 2: the request went
    // out anyway and its fresh body was then overwritten with the stale one.
    expect(networkCalls).toBe(1);
    expect(first.data).toEqual({ serial: 1, data: [] });
    expect(second.data).toEqual({ serial: 1, data: [] });
  });

  it('reports its state in a header a conventional caller can actually read', async () => {
    const client = makeClient({ cache: { enabled: true, ttl: 60000 } });

    const miss = await client.get('/items');
    const hit = await client.get('/items');

    // Written as the literal 'X-Cache' before the fix, onto an axios headers
    // object that lowercases every real header — so this lookup was undefined.
    expect(miss.headers['x-cache']).toBe('MISS');
    expect(hit.headers['x-cache']).toBe('HIT');
  });

  it('does not serve a cached body once the TTL has passed', async () => {
    const client = makeClient({ cache: { enabled: true, ttl: 1 } });

    const first = await client.get('/items');
    await new Promise((r) => setTimeout(r, 5));
    const second = await client.get('/items');

    expect(networkCalls).toBe(2);
    expect(first.data).toEqual({ serial: 1, data: [] });
    expect(second.data).toEqual({ serial: 2, data: [] });
  });

  it('treats different query parameters as different entries', async () => {
    const client = makeClient({ cache: { enabled: true, ttl: 60000 } });

    await client.get('/items', { PageSize: 1 });
    await client.get('/items', { PageSize: 2 });

    expect(networkCalls).toBe(2);
  });

  it('invalidates the cached listing after a write to the same collection', async () => {
    const client = makeClient({ cache: { enabled: true, ttl: 60000, getOnly: true } });

    await client.get('/items');
    expect(networkCalls).toBe(1);

    await client.post('/items', { name: 'x' });
    const after = await client.get('/items');

    // POST (2) + the re-fetched listing (3): a stale list is not served after
    // the collection has been written to.
    expect(networkCalls).toBe(3);
    expect(after.data).toEqual({ serial: 2, data: [] });
  });

  it('is off unless it is configured on', async () => {
    const client = makeClient({});
    await client.get('/items');
    await client.get('/items');
    expect(networkCalls).toBe(2);
  });
});

// ── B8 — rate limiting ────────────────────────────────────────────────────────

describe('B8 — rate limiting', () => {
  it('refuses the request that exceeds the configured window', async () => {
    const client = makeClient({
      rateLimit: { enabled: true, maxRequests: 2, windowMs: 60000 },
    });

    await client.get('/items');
    await client.get('/items');
    await expect(client.get('/items')).rejects.toThrow(/rate limit/i);

    // Two allowed, the third never left the process.
    expect(networkCalls).toBe(2);
  });

  it('holds the window across calls on one client (R3 is what makes this true)', async () => {
    const client = makeClient({
      rateLimit: { enabled: true, maxRequests: 1, windowMs: 60000 },
    });

    await client.get('/items');
    await expect(client.get('/items')).rejects.toThrow(/rate limit/i);

    // A client rebuilt between calls — the pre-R3 behaviour — would have a
    // fresh window here and both calls would succeed.
    expect(networkCalls).toBe(1);
  });

  it('surfaces the remaining budget in response headers', async () => {
    const client = makeClient({
      rateLimit: { enabled: true, maxRequests: 5, windowMs: 60000 },
    });
    const res = await client.get('/items');
    expect(res.headers['X-RateLimit-Limit']).toBe('5');
    expect(res.headers['X-RateLimit-Remaining']).toBe('4');
  });
});

// ── B11 — batch operations ────────────────────────────────────────────────────

describe('B11 — batch operations', () => {
  it('executes a batch when the subsystem is configured', async () => {
    const client = makeClient({ batch: { concurrency: 2 } });

    const result = await client.executeBatch([
      { id: 'a', input: 1, operation: async (n: number) => n * 2 },
      { id: 'b', input: 2, operation: async (n: number) => n * 2 },
      { id: 'c', input: 3, operation: async () => { throw new Error('boom'); } },
    ]);

    expect(result.summary.total).toBe(3);
    expect(result.summary.succeeded).toBe(2);
    expect(result.summary.failed).toBe(1);
    expect(client.getBatchConfig().concurrency).toBe(2);
  });

  it('is inert — and says so — when it is not configured', async () => {
    const client = makeClient({});
    await expect(
      client.executeBatch([{ id: 'a', input: 1, operation: async (n: number) => n }])
    ).rejects.toThrow(/not enabled/i);
  });
});

// ── B5 — audit logging destination ────────────────────────────────────────────

describe('B5 — audit logging never writes to stdout', () => {
  it('puts audit records on stderr, not on the MCP protocol channel', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const client = makeClient({ auditLog: { level: 'all' } });
    await client.get('/items');

    const stdoutText = stdout.mock.calls.map((c) => String(c[0])).join('');
    const stderrText = stderr.mock.calls.map((c) => String(c[0])).join('');

    // On a stdio server, an [AUDIT] line on stdout is a malformed JSON-RPC
    // frame that only survives because the SDK skips unparseable lines.
    expect(stdoutText).not.toContain('[AUDIT]');
    expect(stderrText).toContain('[AUDIT]');
    expect(stderrText).toContain('GET /items');
  });

  it('writes no audit output at all when the level is none', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const client = makeClient({ auditLog: { level: 'none' } });
    await client.get('/items');
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).not.toContain('[AUDIT]');
  });

  it('persists an audit trail to a file when one is configured', async () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'bconnect-audit-')),
      'audit.jsonl'
    );
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const client = makeClient({ auditLog: { level: 'all', logFile: file } });
    await client.get('/items');

    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    // One line per record, each parseable on its own — greppable, and usable
    // as the audit trail a stdio deployment previously could not have at all.
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const entries: AuditLogEntry[] = lines.map((l) => JSON.parse(l));
    expect(entries.some((e) => e.operation === 'GET /items')).toBe(true);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('still honours a custom logHandler', async () => {
    const entries: AuditLogEntry[] = [];
    const client = makeClient({
      auditLog: { level: 'all', logHandler: (e) => entries.push(e) },
    });
    await client.get('/items');
    expect(entries.some((e) => e.operation === 'GET /items')).toBe(true);
  });
});
