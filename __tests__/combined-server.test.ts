/**
 * One server for the tools of several domains (#131): createCombinedServer and
 * combinedTools in @bconnect/mcp-core.
 *
 * Real domain servers answer through the combined server exactly as through their
 * own endpoint: the same tool list, the same results, the same refusals.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { combinedTools, createCombinedServer, type CombinedPart } from '../packages/mcp-core/src/combined-server.js';

const INFO = { name: 'combined-test', version: '0' };
const DOMAINS = ['compliance', 'groups', 'assets'] as const;
const ID = '99999999-9999-4999-8999-999999999999';

const msw = setupServer(http.get('*/Vulnerabilities/:id', ({ params }) => HttpResponse.json({ id: params.id, name: 'CVE-1' })));

type Factory = () => { server: Server };
const factories: Record<string, Factory> = {};
const saved = { ...process.env };

beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.combined.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1',
    // Off as in the gateway (gates.ts); set, not deleted, so a local .env can't turn them on.
    ALLOW_WRITE_OPERATIONS: 'false', ALLOW_SECRET_READ: 'false',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  for (const domain of DOMAINS) {
    const { createServer } = await import(`../bconnect-${domain}-mcp/src/index.ts`);
    factories[domain] = createServer as Factory;
  }
});
afterAll(() => { msw.close(); process.env = saved; });

const open: Client[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map((c) => c.close())); vi.useRealTimers(); });

async function connect(server: Server): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  open.push(client);
  return client;
}

const parts = (domains: readonly string[] = DOMAINS): CombinedPart[] =>
  domains.map((domain) => ({ domain, server: factories[domain]().server }));
const combined = (domains: readonly string[] = DOMAINS) => connect(createCombinedServer(parts(domains), INFO).server);
const direct = (domain: string) => connect(factories[domain]().server);

async function errorOf(p: Promise<unknown>): Promise<{ code: number; message: string }> {
  try {
    await p;
  } catch (error) {
    if (error instanceof McpError) {
      return { code: error.code, message: error.message };
    }
    throw error;
  }
  throw new Error('expected a protocol error');
}

/** A minimal domain server with the given tools; each call answers with its domain name. */
function fakePart(domain: string, tools: string[], onCall?: () => Promise<void>): CombinedPart {
  const server = new Server({ name: domain, version: '0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((name) => ({ name, inputSchema: { type: 'object' as const } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!tools.includes(request.params.name)) {
      const error = new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      error.message = `Unknown tool: ${request.params.name}`;
      throw error;
    }
    await onCall?.();
    return { content: [{ type: 'text' as const, text: domain }] };
  });
  return { domain, server };
}

describe('createCombinedServer: tools/list', () => {
  it('lists the tools of every domain, in domain order, exactly as each domain lists them', async () => {
    const expected = [];
    for (const domain of DOMAINS) {
      expected.push(...(await (await direct(domain)).listTools()).tools);
    }
    expect((await (await combined()).listTools()).tools).toEqual(expected);
  });

  it('lists only the chosen domains', async () => {
    const own = (await (await direct('groups')).listTools()).tools;
    expect((await (await combined(['groups'])).listTools()).tools).toEqual(own);
  });

  it('keeps the gates: no write tool is listed while writes are off', async () => {
    const names = (await (await combined()).listTools()).tools.map((t) => t.name);
    expect(names).toContain('list_assets');
    expect(names).not.toContain('delete_asset');
  });
});

describe('createCombinedServer: tools/call', () => {
  it('sends a call to the domain that lists the tool and returns its result unchanged', async () => {
    const args = { name: 'get_vulnerability', arguments: { vulnerabilityId: ID } };
    const own = await (await direct('compliance')).callTool(args);
    expect(own.isError).not.toBe(true);
    expect(await (await combined()).callTool(args)).toEqual(own);
  });

  it('a tool hidden by the write gate gets the refusal its own domain gives', async () => {
    const args = { name: 'delete_asset', arguments: { id: ID } };
    const own = await (await direct('assets')).callTool(args);
    expect(JSON.stringify(own)).toContain('disabled');
    expect(await (await combined()).callTool(args)).toEqual(own);
  });

  it('an unknown tool gets the same protocol error as from a domain server', async () => {
    const own = await errorOf((await direct('assets')).callTool({ name: 'no_such_tool', arguments: {} }));
    expect(own).toEqual({ code: ErrorCode.MethodNotFound, message: 'MCP error -32601: Unknown tool: no_such_tool' });
    expect(await errorOf((await combined()).callTool({ name: 'no_such_tool', arguments: {} }))).toEqual(own);
  });

  it('a protocol error from the owning domain arrives with its code and message unchanged', async () => {
    const args = { name: 'get_vulnerability', arguments: { vulnerabilityId: ID, notDeclared: 1 } };
    const own = await errorOf((await direct('compliance')).callTool(args));
    expect(own.code).toBe(ErrorCode.InvalidParams);
    expect(await errorOf((await combined()).callTool(args))).toEqual(own);
  });

  it('a tool of a domain left out is unknown', async () => {
    const error = await errorOf((await combined(['groups'])).callTool({ name: 'get_vulnerability', arguments: { vulnerabilityId: ID } }));
    expect(error).toEqual({ code: ErrorCode.MethodNotFound, message: 'MCP error -32601: Unknown tool: get_vulnerability' });
  });

  it('has no time limit of its own: a call slower than the SDK default of 60 s still answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let finish = (): void => undefined;
    const slow = fakePart('slow', ['slow_tool'], () => new Promise<void>((resolve) => { finish = resolve; }));
    // The test's own client gets no limit either, so only the combined server's could end the call.
    const client = await connect(createCombinedServer([slow], INFO).server);
    const call = client.callTool({ name: 'slow_tool' }, undefined, { timeout: 2_147_483_647 });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    finish();
    expect((await call).content).toEqual([{ type: 'text', text: 'slow' }]);
  });
});

describe('createCombinedServer: closing', () => {
  it('closes the domain servers it connected', async () => {
    const part = fakePart('one', ['tool_one']);
    const closed = vi.fn();
    part.server.onclose = closed;
    const { server } = createCombinedServer([part], INFO);
    const client = await connect(server);
    await client.listTools();
    await server.close();
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
  });
});

describe('combinedTools', () => {
  it('returns the tool names per domain', async () => {
    const tools = await combinedTools(parts(), INFO);
    expect(Object.keys(tools)).toEqual([...DOMAINS]);
    expect(tools.groups).toEqual((await (await direct('groups')).listTools()).tools.map((t) => t.name));
  });

  it('refuses a tool name two domains offer, naming the tool and both domains', async () => {
    await expect(combinedTools([fakePart('a', ['x', 'shared']), fakePart('b', ['shared'])], INFO))
      .rejects.toThrow("tool 'shared' is offered by both 'a' and 'b'");
  });

  it('closes the domain servers it asked', async () => {
    const part = fakePart('one', ['tool_one']);
    const closed = vi.fn();
    part.server.onclose = closed;
    await combinedTools([part], INFO);
    expect(closed).toHaveBeenCalled();
  });
});
