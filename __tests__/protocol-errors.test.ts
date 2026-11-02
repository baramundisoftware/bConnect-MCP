/**
 * Protocol errors carry the "MCP error <code>:" prefix once (#326).
 *
 * The SDK's McpError puts the prefix in front of its message, the server sends
 * that message, and the SDK client puts the prefix in front again. The core's
 * protocolError() keeps the message bare, so a client shows the prefix once.
 * Checked over stdio with the SDK client against a built server; bConnect
 * errors stay tool results with `isError` (REQ-XC-001).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { protocolError } from '../packages/mcp-core/src/protocol-errors.js';
import { ROOT } from './lib/exerciser.js';

describe('protocolError', () => {
  it('is an McpError with the code and the bare message', () => {
    const error = protocolError(ErrorCode.InvalidParams, 'id is required');
    expect(error).toBeInstanceOf(McpError);
    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toBe('id is required');
  });
});

const SERVER = 'bconnect-updatemanagement-mcp';
const TOOL = 'list_update_management_endpoints';
const cwd = mkdtempSync(join(tmpdir(), 'protocol-errors-'));
let api: HttpServer;
let client: Client;
let stderr = '';
/** The stand-in's status: 200 with an empty list (the startup check passes) until a test sets 404. */
let status = 200;

beforeAll(async () => {
  api = createServer((_req, res) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(status === 200 ? '[]' : '{}');
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const { port } = api.address() as AddressInfo;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, SERVER, 'build', 'index.js')],
    cwd,
    env: { PATH: process.env.PATH ?? '', BCONNECT_BASE_URL: `http://127.0.0.1:${port}/bconnect`, BCONNECT_API_KEY: 'protocol-errors-key' },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  client = new Client({ name: 'protocol-errors', version: '1' });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close();
  api.closeAllConnections();
  await new Promise<void>((resolve) => api.close(() => resolve()));
  rmSync(cwd, { recursive: true, force: true });
});

/** The McpError the SDK client raises for a call; fails the test if the call succeeds. */
async function refusal(name: string, args: Record<string, unknown>): Promise<McpError> {
  try {
    await client.callTool({ name, arguments: args });
  } catch (error) {
    if (error instanceof McpError) {return error;}
    throw error;
  }
  throw new Error(`${name} was not refused; stderr: ${stderr}`);
}

const prefixes = (message: string): number => message.split('MCP error').length - 1;

describe(`over stdio (${SERVER})`, () => {
  it('an undeclared argument: -32602 with the prefix once', async () => {
    const error = await refusal(TOOL, { notAnArgument: 1 });
    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(prefixes(error.message), error.message).toBe(1);
    expect(error.message).toMatch(/^MCP error -32602: \S/);
    expect(error.message).toContain('notAnArgument');
  });

  it('an unknown tool: -32601 with the prefix once', async () => {
    const error = await refusal('no_such_tool', {});
    expect(error.code).toBe(ErrorCode.MethodNotFound);
    expect(prefixes(error.message), error.message).toBe(1);
    expect(error.message).toBe('MCP error -32601: Unknown tool: no_such_tool');
  });

  it('a bConnect error stays a tool result with isError, without the prefix', async () => {
    status = 404;
    const result = await client.callTool({ name: TOOL, arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>).map((c) => c.text).join('\n');
    expect(text).toContain('404');
    expect(text).not.toContain('MCP error');
  });
});
