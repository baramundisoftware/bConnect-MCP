/**
 * The startup routine's standalone HTTP mode and the entry point (REQ-SRV-023,
 * #160). server-runtime.test.ts pins the stdio start, the checks before it and
 * two HTTP startup errors; this file pins what HTTP mode then serves, which
 * binds it refuses, and runServer().
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { request as httpRequest, type Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';
import { runServer, serverClients, startServer, type ServerEntry } from '../packages/mcp-core/src/server-runtime.js';
import { createServer as createEndpointsServer } from '../bconnect-endpoints-mcp/src/index.js';

const ENV = {
  BCONNECT_BASE_URL: 'http://bms.runtime-http.test/bconnect',
  BCONNECT_ALLOW_INSECURE_HTTP: 'true',
  BCONNECT_API_KEY: 'k',
  BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true',
  MCP_TRANSPORT: 'http',
};

class TestClient extends BConnectClientBase {}

/** A real MCP server with one tool, as a server's createServer() returns it. */
function mcpServer(): { server: Server } {
  const server = new Server({ name: 'bconnect-runtime-mcp', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'list_things', description: 'Lists things', inputSchema: { type: 'object' as const, properties: {} } }],
  }));
  return { server };
}

/** A request with a chosen Host header (fetch does not let a caller set it). */
function send(port: number, init: { method: string; host?: string; body?: string; headers?: Record<string, string> }) {
  return new Promise<{ status: number; body: string; type: string }>((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port, path: '/mcp', method: init.method,
      headers: { host: init.host ?? `127.0.0.1:${port}`, ...init.headers },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, type: String(res.headers['content-type'] ?? '') }));
    });
    req.on('error', reject);
    req.end(init.body);
  });
}

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const rpc = (method: string, id: number, params: object = {}) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
/** The JSON-RPC message of a response: plain JSON or the first SSE data line. */
const message = (body: string): { result?: Record<string, unknown>; error?: { code: number } } => {
  const data = body.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(data ? data.slice(6) : body);
};

describe('standalone HTTP mode', () => {
  let port = 0;
  const lines: string[] = [];
  const listeners: HttpServer[] = [];

  beforeAll(async () => {
    // Port 0: the system picks a free one, so no other test can take it first.
    const env = { ...ENV, MCP_PORT: '0', MCP_ALLOWED_HOSTS: 'mcp.example.test,bad/entry' };
    const entry: ServerEntry<TestClient> = { name: 'bconnect-runtime-mcp', createServer: mcpServer, clients: serverClients(TestClient, env) };
    const exit = vi.fn((code: number) => { throw new Error(`exit ${code}`); }) as unknown as (code: number) => never;
    await startServer(entry, { env, error: (line) => lines.push(line), exit, connectStdio: vi.fn(), listening: (s) => listeners.push(s) });
    port = (listeners[0].address() as { port: number }).port;
  });
  afterAll(async () => {
    for (const s of listeners) {await new Promise<void>((resolve) => s.close(() => resolve()));}
  });

  it('says where it listens and that the check was skipped', () => {
    // MCP_PORT=0: the line names the port the system picked, not 0.
    expect(lines).toContain(`bconnect-runtime-mcp listening on http://127.0.0.1:${port}/mcp`);
    expect(port).toBeGreaterThan(0);
    expect(lines.some((l) => /connectivity check skipped/.test(l))).toBe(true);
  });

  it('names an MCP_ALLOWED_HOSTS entry it ignores', () => {
    expect(lines).toContain('bconnect-runtime-mcp: MCP_ALLOWED_HOSTS entry "bad/entry" ignored: not a host name or address');
  });

  it('answers initialize and tools/list over POST /mcp', async () => {
    const init = await send(port, { method: 'POST', headers: MCP_HEADERS, body: rpc('initialize', 1, {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    }) });
    expect(init.status).toBe(200);
    expect(message(init.body).result?.serverInfo).toMatchObject({ name: 'bconnect-runtime-mcp' });

    const list = await send(port, { method: 'POST', headers: MCP_HEADERS, body: rpc('tools/list', 2) });
    expect(list.status).toBe(200);
    expect(message(list.body).result?.tools).toEqual([expect.objectContaining({ name: 'list_things' })]);
  });

  it('serves a host name listed in MCP_ALLOWED_HOSTS', async () => {
    const res = await send(port, { method: 'POST', host: `mcp.example.test:${port}`, headers: MCP_HEADERS, body: rpc('tools/list', 3) });
    expect(res.status).toBe(200);
  });

  it('refuses a request for another host name, and logs it', async () => {
    const before = lines.length;
    const res = await send(port, { method: 'POST', host: 'attacker.example.test', headers: MCP_HEADERS, body: rpc('tools/list', 4) });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('list_things');
    expect(lines.slice(before)).toEqual([expect.stringMatching(/^bconnect-runtime-mcp: refused a request whose .* isn't an allowed host name \(MCP_ALLOWED_HOSTS\)$/)]);
  });

  it.each(['GET', 'DELETE'])('answers %s /mcp with 405 (stateless mode)', async (method) => {
    const res = await send(port, { method });
    expect(res.status).toBe(405);
    expect(JSON.parse(res.body).error).toMatch(/Method Not Allowed/);
  });

  it('answers a body over the size limit with a JSON-RPC internal error, no stack', async () => {
    const res = await send(port, { method: 'POST', headers: MCP_HEADERS, body: JSON.stringify({ pad: 'x'.repeat(200_000) }) });
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toEqual({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  });
});

describe('HTTP mode bind address', () => {
  it.each(['0.0.0.0', '192.0.2.10'])('refuses to bind %s without MCP_ALLOW_NO_AUTH=true: one line, exit 1, no listener', async (bind) => {
    const env = { ...ENV, MCP_BIND: bind, MCP_PORT: '1' };
    const lines: string[] = [];
    const listening = vi.fn();
    const exit = vi.fn((code: number) => { throw new Error(`exit ${code}`); }) as unknown as (code: number) => never;
    const entry = { name: 'bconnect-runtime-mcp', createServer: mcpServer, clients: serverClients(TestClient, env) };
    await expect(startServer(entry, { env, error: (l) => lines.push(l), exit, connectStdio: vi.fn(), listening })).rejects.toThrow('exit 1');
    // Plain string checks: a pattern built from the address would need full escaping.
    const line = lines.at(-1) ?? '';
    expect(line.startsWith(`bconnect-runtime-mcp: refusing to bind ${bind} — `)).toBe(true);
    expect(line).toContain('MCP_ALLOW_NO_AUTH=true');
    expect(listening).not.toHaveBeenCalled();
  });
});

describe('standalone HTTP mode with a real server: write tools listed only with writes on (REQ-SRV-026)', () => {
  let port = 0;
  const listeners: HttpServer[] = [];
  const names = async (id: number): Promise<string[]> => {
    const res = await send(port, { method: 'POST', headers: MCP_HEADERS, body: rpc('tools/list', id) });
    expect(res.status).toBe(200);
    return (message(res.body).result?.tools as Array<{ name: string }>).map((t) => t.name);
  };

  beforeAll(async () => {
    const env = { ...ENV, MCP_PORT: '0' };
    const entry: ServerEntry<TestClient> = { name: 'bconnect-endpoints-mcp', createServer: createEndpointsServer, clients: serverClients(TestClient, env) };
    const exit = vi.fn((code: number) => { throw new Error(`exit ${code}`); }) as unknown as (code: number) => never;
    await startServer(entry, { env, error: () => undefined, exit, connectStdio: vi.fn(), listening: (s) => listeners.push(s) });
    port = (listeners[0].address() as { port: number }).port;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const s of listeners) {await new Promise<void>((resolve) => s.close(() => resolve()));}
  });

  it('lists the 25 read tools of 26R1 with writes off, and all 61 with writes on, per request', async () => {
    vi.stubEnv('BCONNECT_RELEASE', '26R1');
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const off = await names(1);
    expect(off).toHaveLength(25);
    expect(off).toContain('list_endpoints');
    expect(off).not.toContain('delete_endpoint');
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const on = await names(2);
    expect(on).toHaveLength(61);
    expect(on).toContain('delete_endpoint');
  });
});

describe('runServer', () => {
  const cwd = process.cwd();
  afterEach(() => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('starts nothing when a test imports the server (VITEST set)', () => {
    const get = vi.fn();
    runServer({ name: 'bconnect-runtime-mcp', createServer: mcpServer, clients: { get } });
    expect(get).not.toHaveBeenCalled();
  });

  it('otherwise starts the server and, on a failure, writes one line to stderr and exits 1', async () => {
    // The start loads the working directory's .env: an empty directory, so nothing is loaded.
    const dir = mkdtempSync(join(tmpdir(), 'runtime-run-'));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    process.chdir(dir);
    vi.stubEnv('VITEST', undefined);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const get = vi.fn(() => { throw new Error('BCONNECT_BASE_URL is not set'); });
    runServer({ name: 'bconnect-runtime-mcp', createServer: mcpServer, clients: { get } });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(get).toHaveBeenCalledOnce();
    expect(stderr.mock.calls.map((c) => c[0])).toEqual(['bconnect-runtime-mcp: BCONNECT_BASE_URL is not set']);
  });
});
