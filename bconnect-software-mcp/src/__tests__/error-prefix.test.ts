/**
 * bconnect-software-mcp — finding A2 / INT-53 regression: ONE error prefix, not two.
 *
 * Every rejection this server produced used to reach the client as
 *
 *     MCP error -32601: MCP error -32601: Unknown tool: nonexistent_tool
 *
 * because `McpError` bakes "MCP error <code>: " into `.message`, the server
 * copies that message onto the JSON-RPC wire, and the client rebuilds an
 * `McpError` from it — prefixing a second time. The fix is to throw
 * `BareMcpError` (packages/mcp-core/src/protocol-error.ts) out of the request
 * handler instead.
 *
 * These assertions only hold end-to-end, so they go through a real
 * Client <-> Server InMemoryTransport pair: dispatching the handler directly
 * skips the client-side rebuild that produces the second prefix, and would
 * pass even against the defect.
 */

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { createServer } from '../index.js';

/** "MCP error <code>: " exactly once — a second prefix right after it fails. */
function singlePrefix(code: number): RegExp {
  return new RegExp(`^MCP error ${code}: (?!MCP error)`);
}

async function connect(): Promise<Client> {
  // Real credentials are irrelevant — nothing here reaches the network — but a
  // key must be present or the provider's onMissingCredentials fires first and
  // the dispatch path under test is never reached.
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'error-prefix-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

async function callAndCatch(name: string, args: Record<string, unknown>): Promise<{ code?: number; message: string }> {
  const client = await connect();
  try {
    await client.callTool({ name, arguments: args });
  } catch (error) {
    return error as { code?: number; message: string };
  }
  throw new Error(`${name} was expected to reject`);
}

describe('bconnect-software-mcp — error message carries one MCP prefix', () => {
  it('unknown tool: -32601 is prefixed exactly once', async () => {
    const error = await callAndCatch('nonexistent_tool', {});
    expect(error.code).toBe(ErrorCode.MethodNotFound);
    expect(error.message).toMatch(singlePrefix(ErrorCode.MethodNotFound));
    expect(error.message).toContain('Unknown tool: nonexistent_tool');
    expect(error.message.match(/MCP error /g) ?? []).toHaveLength(1);
  });

  it('invalid arguments: -32602 is prefixed exactly once', async () => {
    const error = await callAndCatch('list_installed_software_by_endpoint', {});
    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toMatch(singlePrefix(ErrorCode.InvalidParams));
    expect(error.message.match(/MCP error /g) ?? []).toHaveLength(1);
  });
});
