/**
 * One "MCP error <code>: " prefix, not two (A2 / INT-53).
 *
 * The defect an LLM read on every rejection this suite produced:
 *
 *   get_endpoint { id: "../../../servermanagement/v2.0/ApiKeys" }
 *     -> "MCP error -32602: MCP error -32602: Invalid parameters: id must be …"
 *
 * The doubling is produced by the SDK, not by this repo's formatting: the
 * server copies `McpError.message` (already prefixed) onto the wire, and the
 * client prefixes it again when it rebuilds the error. So the assertion that
 * matters is made through a real Client<->Server transport pair, exactly as the
 * thirteen servers are driven — not against a locally constructed error.
 *
 * Imported from the built package, because that is what the servers resolve
 * `@bconnect/mcp-core` to.
 */

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import {
  BareMcpError,
  stripMcpErrorPrefix,
  assertSafePathSegment,
  validateOrThrow,
  assertSecurityRouteAllowed,
  CommonRules,
} from '@bconnect/mcp-core';

/**
 * Stand up a one-tool server whose handler throws `thrown`, call the tool, and
 * return the error the client saw. This is the whole mechanism: server
 * serialises `.message`, client re-wraps it.
 */
async function messageSeenByClient(thrown: unknown): Promise<{ code: number; message: string }> {
  const server = new Server(
    { name: 'a2-probe', version: '0.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(CallToolRequestSchema, async () => {
    throw thrown;
  });

  const client = new Client({ name: 'a2-probe-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const err = await client
      .callTool({ name: 'probe', arguments: {} })
      .then(() => null)
      .catch((e: unknown) => e as { code: number; message: string });
    expect(err).not.toBeNull();
    return err as { code: number; message: string };
  } finally {
    await client.close();
    await server.close();
  }
}

/** How many times the SDK prefix appears at the head of `message`. */
function prefixCount(message: string): number {
  let count = 0;
  let rest = message;
  while (/^MCP error -?\d+: /.test(rest)) {
    count++;
    rest = rest.replace(/^MCP error -?\d+: /, '');
  }
  return count;
}

describe('BareMcpError', () => {
  it('carries the bare message, unlike the stock McpError', () => {
    const plain = new McpError(ErrorCode.InvalidParams, 'id must be a valid GUID');
    const bare = new BareMcpError(ErrorCode.InvalidParams, 'id must be a valid GUID');

    expect(plain.message).toBe('MCP error -32602: id must be a valid GUID');
    expect(bare.message).toBe('id must be a valid GUID');
  });

  it('is still an McpError, so `instanceof` branches and .code keep working', () => {
    const bare = new BareMcpError(ErrorCode.InvalidRequest, 'nope', { hint: 'x' });

    // Every server catch-all opens with `if (error instanceof McpError) throw error;`.
    expect(bare).toBeInstanceOf(McpError);
    expect(bare.code).toBe(ErrorCode.InvalidRequest);
    expect(bare.data).toEqual({ hint: 'x' });
  });

  it('reaches a client with exactly one prefix, where a stock McpError arrives with two', async () => {
    const doubled = await messageSeenByClient(
      new McpError(ErrorCode.InvalidParams, 'id must be a valid GUID')
    );
    const single = await messageSeenByClient(
      new BareMcpError(ErrorCode.InvalidParams, 'id must be a valid GUID')
    );

    // The regression, stated exactly.
    expect(prefixCount(doubled.message)).toBe(2);
    expect(prefixCount(single.message)).toBe(1);

    expect(single.message).toBe('MCP error -32602: id must be a valid GUID');
    expect(single.code).toBe(ErrorCode.InvalidParams);
  });
});

describe('the core error paths every server inherits', () => {
  it('validateOrThrow reaches the client with one prefix', async () => {
    const err = await messageSeenByClient(
      (() => {
        try {
          validateOrThrow({ id: 'not-a-guid' }, [CommonRules.guid('id')]);
          return new Error('validateOrThrow did not throw');
        } catch (e) {
          return e;
        }
      })()
    );

    expect(prefixCount(err.message)).toBe(1);
    expect(err.code).toBe(ErrorCode.InvalidParams);
    expect(err.message).toContain('Invalid parameters: id');
  });

  it('a path-traversal refusal reaches the client with one prefix', async () => {
    const err = await messageSeenByClient(
      (() => {
        try {
          assertSafePathSegment('../../../servermanagement/v2.0/ApiKeys', 'id');
          return new Error('assertSafePathSegment did not throw');
        } catch (e) {
          return e;
        }
      })()
    );

    expect(prefixCount(err.message)).toBe(1);
    expect(err.code).toBe(ErrorCode.InvalidParams);
    expect(err.message).toContain('single path segment');
  });

  it('a credential-route refusal reaches the client with one prefix', async () => {
    const err = await messageSeenByClient(
      (() => {
        try {
          assertSecurityRouteAllowed('get', '/defensecontrol/v2.0/BitLocker/WindowsEndpoints/x/Secrets', {});
          return new Error('assertSecurityRouteAllowed did not throw');
        } catch (e) {
          return e;
        }
      })()
    );

    expect(prefixCount(err.message)).toBe(1);
    expect(err.code).toBe(ErrorCode.InvalidRequest);
    expect(err.message).toContain('ALLOW_SECRET_READ');
  });
});

describe('stripMcpErrorPrefix', () => {
  it('removes however many prefixes have accumulated', () => {
    expect(stripMcpErrorPrefix('MCP error -32602: MCP error -32602: boom')).toBe('boom');
    expect(stripMcpErrorPrefix('MCP error -32603: boom')).toBe('boom');
    expect(stripMcpErrorPrefix('boom')).toBe('boom');
  });

  it('leaves a message that merely mentions the phrase alone', () => {
    expect(stripMcpErrorPrefix('the MCP error -32602: was logged')).toBe(
      'the MCP error -32602: was logged'
    );
  });
});
