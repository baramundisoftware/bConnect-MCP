/**
 * Error-contract guard (REQ-XC-001 AC 1–4, ADR-0008; #158, #195, #166 AC 1).
 *
 * Every tool of every server is called, for both bMS releases, with arguments
 * generated from its input schema, while bConnect answers every request with
 * 404 and a problem body. A tool that sent a request must answer with a tool
 * result (`isError: true`, no JSON-RPC error code) that names the status, the
 * method and path it sent, the 404 meaning the spec documents for that
 * operation, and bConnect's detail. A tool that sent nothing was refused
 * before sending (write gate, secret gate, argument check): gate refusals are
 * results too; only McpErrors (invalid arguments, unknown tool, a tool the
 * release doesn't have) stay protocol errors.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { documentedErrorMeaning } from '../packages/mcp-core/src/tool-errors.js';
import { RELEASES, type Release } from './lib/spec.js';
import { BASE_PATH, ROOT, SERVERS, connect, guardEnv, requiredArguments, type ToolResult } from './lib/exerciser.js';

const DETAIL = 'guard: no such object';
const USERNAME = 'error-guard-user-7f3a';
const PASSWORD = 'error-guard-pass-91c2';

interface Call {
  server: string;
  tool: string;
  requests: Array<{ method: string; path: string }>;
  result: ToolResult;
  /** The text of the tool result's content, or the protocol error's message. */
  text: string;
}

let sent: Array<{ method: string; path: string }> = [];
const msw = setupServer(http.all('*', ({ request }) => {
  sent.push({ method: request.method, path: new URL(request.url).pathname.slice(BASE_PATH.length) });
  return new HttpResponse(JSON.stringify({ title: 'Not Found', status: 404, detail: DETAIL }), {
    status: 404, headers: { 'content-type': 'application/problem+json' },
  });
}));
const savedEnv = { ...process.env };

/** The text of a tool result's content blocks (the exerciser returns them as JSON). */
function contentText(result: ToolResult): string {
  if (result.code !== undefined) {return result.text;}
  try {
    const blocks: unknown = JSON.parse(result.text);
    return Array.isArray(blocks) ? blocks.map((b) => String(Reflect.get(b, 'text') ?? '')).join('\n') : result.text;
  } catch {
    return result.text;
  }
}

async function exerciseAll(release: Release, gates: { writes: boolean; secretRead: boolean }): Promise<Call[]> {
  const calls: Call[] = [];
  for (const server of SERVERS) {
    // Listed with writes on, so every tool is called (tools/list hides write tools while
    // writes are off, REQ-SRV-026); the gates read the settings on each call.
    Object.assign(process.env, guardEnv(release, { ...gates, writes: true }));
    const conn = await connect(server);
    Object.assign(process.env, guardEnv(release, gates), { BCONNECT_USERNAME: USERNAME, BCONNECT_PASSWORD: PASSWORD });
    for (const tool of conn.tools) {
      sent = [];
      const result = await conn.call(tool.name, requiredArguments(tool.inputSchema));
      calls.push({ server, tool: tool.name, requests: sent, result, text: contentText(result) });
    }
    await conn.close();
  }
  return calls;
}

beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
afterAll(() => {
  msw.close();
  process.env = savedEnv;
});

/** Protocol error codes a tool may still answer with: MCP-level faults, never API errors. */
const PROTOCOL_CODES = new Set<number>([ErrorCode.InvalidParams, ErrorCode.MethodNotFound]);

describe.each(RELEASES)('error contract, bMS %s', (release) => {
  let calls: Call[];

  beforeAll(async () => {
    calls = await exerciseAll(release, { writes: true, secretRead: true });
  }, 180_000);

  it('a bConnect error is a tool result, never a protocol error', () => {
    const protocol = calls.filter((c) => c.requests.length > 0 && c.result.code !== undefined);
    expect(protocol.map((c) => `${c.server}:${c.tool} → ${c.result.code} ${c.text.slice(0, 80)}`)).toEqual([]);
  });

  it('the result names status, method and path, the documented 404 meaning and bConnect\'s detail', () => {
    const wrong: string[] = [];
    const sentSomething = calls.filter((call) => call.requests.length > 0);
    const results = sentSomething.filter((call) => call.result.code === undefined);
    expect(sentSomething.length).toBeGreaterThan(200);
    expect(results.length).toBe(sentSomething.length); // every one is checked below, none skipped
    for (const c of results) {
      const { method, path } = c.requests[c.requests.length - 1];
      const meaning = documentedErrorMeaning(release, method, path, 404);
      const missing = [
        'HTTP 404',
        `${method} ${path}`,
        ...(meaning ? [meaning] : ['wrong id']),
        DETAIL,
      ].filter((part) => !c.text.includes(part));
      if (missing.length) {wrong.push(`${c.server}:${c.tool} lacks ${missing.join(' | ')}`);}
    }
    expect(wrong).toEqual([]);
  });

  it('no message names the host, the base URL or the credentials', () => {
    const leaks = calls.filter((c) => /bms\.guard\.test|\/bconnect\//.test(c.text) || c.text.includes(USERNAME) || c.text.includes(PASSWORD));
    expect(leaks.map((c) => `${c.server}:${c.tool}: ${c.text.slice(0, 120)}`)).toEqual([]);
  });
});

describe('gate refusals are tool results with their own wording, and send nothing', () => {
  let calls: Call[];

  beforeAll(async () => {
    calls = await exerciseAll('26R1', { writes: false, secretRead: false });
  }, 180_000);

  it('the write gate', () => {
    const refused = calls.filter((c) => /ALLOW_WRITE_OPERATIONS/.test(c.text));
    expect(refused.length).toBeGreaterThan(50);
    for (const c of refused) {
      expect({ tool: `${c.server}:${c.tool}`, sent: c.requests.length, code: c.result.code, isError: c.result.isError })
        .toEqual({ tool: `${c.server}:${c.tool}`, sent: 0, code: undefined, isError: true });
    }
  });

  it('a tool that sent nothing was refused by a gate, or failed for an MCP-level reason', () => {
    const silent = calls.filter((c) => c.requests.length === 0);
    expect(silent.length).toBeGreaterThan(50);
    const odd = silent.filter((c) => c.result.code === undefined
      ? !/ALLOW_WRITE_OPERATIONS|ALLOW_SECRET_READ/.test(c.text)
      : !PROTOCOL_CODES.has(c.result.code));
    expect(odd.map((c) => `${c.server}:${c.tool} → ${c.result.code ?? 'result'} ${c.text.slice(0, 80)}`)).toEqual([]);
  });

  it('the secret gate', () => {
    const refused = calls.filter((c) => /ALLOW_SECRET_READ/.test(c.text));
    expect(refused.length).toBeGreaterThan(0);
    for (const c of refused) {
      expect({ tool: `${c.server}:${c.tool}`, sent: c.requests.length, code: c.result.code, isError: c.result.isError })
        .toEqual({ tool: `${c.server}:${c.tool}`, sent: 0, code: undefined, isError: true });
    }
  });
});

describe('MCP-level faults stay protocol errors', () => {
  it.each(SERVERS)('%s: an unknown tool is MethodNotFound', async (server) => {
    Object.assign(process.env, guardEnv('26R1', { writes: true, secretRead: false }));
    const conn = await connect(server);
    const result = await conn.call('zz_guard_unknown_tool', {});
    await conn.close();
    expect(result.code).toBe(ErrorCode.MethodNotFound);
  });
});

describe('MCP-level faults win over missing credentials', () => {
  const noCredentials = { BCONNECT_USERNAME: '', BCONNECT_PASSWORD: '', BCONNECT_API_KEY: '' };

  it.each(SERVERS)('%s: an unknown tool is MethodNotFound', async (server) => {
    Object.assign(process.env, guardEnv('26R1', { writes: true, secretRead: false }), noCredentials);
    const conn = await connect(server);
    const result = await conn.call('zz_guard_unknown_tool', {});
    await conn.close();
    expect(result.code).toBe(ErrorCode.MethodNotFound);
  });

  it.each(SERVERS)('%s: a 26R1 tool called on 25R2 is a protocol error or a gate refusal, and sends nothing', async (server) => {
    Object.assign(process.env, guardEnv('26R1', { writes: true, secretRead: false }), noCredentials);
    const all = await connect(server);
    const tools26 = all.tools;
    await all.close();
    Object.assign(process.env, guardEnv('25R2', { writes: true, secretRead: false }), noCredentials);
    const conn = await connect(server);
    const names25 = new Set(conn.tools.map((t) => t.name));
    const wrong: string[] = [];
    for (const tool of tools26.filter((t) => !names25.has(t.name))) {
      sent = [];
      const result = await conn.call(tool.name, requiredArguments(tool.inputSchema));
      // A gate that runs earlier (write or secret gate) may refuse first; that sends nothing either.
      const refusedByGate = result.code === undefined && /ALLOW_WRITE_OPERATIONS|ALLOW_SECRET_READ/.test(contentText(result));
      if (sent.length > 0 || !(refusedByGate || (result.code !== undefined && PROTOCOL_CODES.has(result.code)))) {
        wrong.push(`${tool.name} → ${result.code ?? 'result'} ${contentText(result).slice(0, 80)}`);
      }
    }
    await conn.close();
    expect(wrong).toEqual([]);
  });

  it('invalid arguments found in the handler are InvalidParams (endpoints update, jobs folder update)', async () => {
    Object.assign(process.env, guardEnv('26R1', { writes: true, secretRead: false }), noCredentials);
    for (const [server, tool, select] of [['bconnect-endpoints-mcp', 'update_endpoint', { type: 'WindowsEndpoint' }], ['bconnect-jobs-mcp', 'update_job_folder', {}]] as const) {
      const conn = await connect(server);
      const result = await conn.call(tool, { ...select, id: '00000000-0000-4000-8000-000000000001' });
      await conn.close();
      expect({ tool, code: result.code }).toEqual({ tool, code: ErrorCode.InvalidParams });
    }
  });
});

describe('missing credentials are a tool result', () => {
  it.each(SERVERS)('%s', async (server) => {
    Object.assign(process.env, guardEnv('26R1', { writes: true, secretRead: false }), { BCONNECT_USERNAME: '', BCONNECT_PASSWORD: '', BCONNECT_API_KEY: '' });
    const conn = await connect(server);
    const read = conn.tools.find((t) => t.name.startsWith('list_')) ?? conn.tools[0];
    sent = [];
    const result = await conn.call(read.name, requiredArguments(read.inputSchema));
    await conn.close();
    expect(sent).toEqual([]);
    expect(result.code).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(contentText(result)).toMatch(/BCONNECT_API_KEY.*BCONNECT_USERNAME/s);
  });
});

describe('server sources', () => {
  it.each(SERVERS)('%s no longer turns errors into McpError(InternalError)', (server) => {
    const source = readFileSync(join(ROOT, server, 'src', 'index.ts'), 'utf8');
    expect(source).not.toMatch(/new McpError\(\s*ErrorCode\.InternalError/);
    expect(source).toMatch(/toolErrorResult\(/);
  });
});
