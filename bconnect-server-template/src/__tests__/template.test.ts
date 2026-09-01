/**
 * bconnect-server-template — the template still composes, and it teaches the
 * 2026-08-02 round-3 shape.
 *
 * The template had no test at all, which is why the write-gate block inside it
 * could drift from the thirteen servers it is supposed to be the source of. It
 * has no tools by design, so the assertions here are about the SHAPE: it starts,
 * it advertises an empty catalogue on both sides of the write gate, an unknown
 * tool is MethodNotFound with exactly one MCP prefix, and — the part that keeps
 * the template honest — the file still hands new servers the shared primitives
 * rather than a copy of the old hand-written gate and catch-all.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { createServer } from '../index.js';

const INDEX_SOURCE = readFileSync(
  fileURLToPath(new URL('../index.ts', import.meta.url)),
  'utf8'
);

async function connect(): Promise<Client> {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'template-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the template starts and serves an empty catalogue', () => {
  it('advertises no tools with the write gate shut', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const { tools } = await (await connect()).listTools();
    expect(tools).toEqual([]);
  });

  it('advertises no tools with the write gate open either — there are none to hide', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const { tools } = await (await connect()).listTools();
    expect(tools).toEqual([]);
  });

  it('answers an unknown tool with MethodNotFound and exactly one MCP prefix', async () => {
    // `createServer()` in the template takes no credentials argument, so the
    // provider reads the environment. Without a key it raises the
    // missing-credentials InternalError before dispatch is ever reached, and
    // this assertion would be testing the wrong throw site.
    vi.stubEnv('BCONNECT_API_KEY', 'test-key');
    vi.stubEnv('BCONNECT_BASE_URL', 'https://bms-server/bconnect');
    const client = await connect();
    const error = await client
      .callTool({ name: 'nonexistent_tool', arguments: {} })
      .then(() => null, (e: { code?: number; message: string }) => e);
    expect(error!.code).toBe(ErrorCode.MethodNotFound);
    expect(error!.message).toBe('MCP error -32601: Unknown tool: nonexistent_tool');
  });
});

describe('the template teaches the shared composition layer, not a copy of it', () => {
  it('composes its catalogue with defineToolCatalogue', () => {
    expect(INDEX_SOURCE).toContain('defineToolCatalogue(');
    expect(INDEX_SOURCE).toContain('catalogue.listTools()');
  });

  it('gates writes through the catalogue, not a hand-written WRITE_TOOLS Set', () => {
    expect(INDEX_SOURCE).toContain('catalogue.gateWriteTool(name)');
    expect(INDEX_SOURCE).not.toContain('const WRITE_TOOLS = new Set<string>');
    expect(INDEX_SOURCE).not.toContain("process.env.ALLOW_WRITE_OPERATIONS !== \"true\"");
  });

  it('uses the one shared error channel, not a per-server catch-all', () => {
    expect(INDEX_SOURCE).toContain('return handleToolError(error);');
    expect(INDEX_SOURCE).not.toContain('`bConnect API error: ${error instanceof Error');
  });

  it('points the first list tool at the shared pagination and countOnly fragments', () => {
    expect(INDEX_SOURCE).toContain('...pageProperties,');
    expect(INDEX_SOURCE).toContain('...countOnlyProperty,');
    expect(INDEX_SOURCE).toContain('isCountOnlyRequest(args)');
  });
});
