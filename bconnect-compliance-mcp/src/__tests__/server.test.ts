/**
 * bconnect-compliance-mcp — server isolation test
 *
 * Verifies that:
 * 1. createServer() starts and lists all 8 expected compliance tools
 * 2. No tools from other domains are registered
 * 3. Unknown tool calls return MethodNotFound
 *
 * Note: This is a 26R1-only server. All 8 tools are always registered.
 */

import { describe, it, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const EXPECTED_TOOLS = [
  'list_detected_rule_violations',
  'list_detected_rule_violations_by_endpoint',
  'list_detected_vulnerabilities',
  'list_detected_vulnerabilities_by_endpoint',
  'list_mobile_device_rules',
  'get_mobile_device_rule',
  'list_vulnerabilities',
  'get_vulnerability',
];

async function startServer() {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

describe('bconnect-compliance-mcp', () => {
  it('lists exactly 8 compliance tools + 2 local additions', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    // 8 upstream + get_vulnerability_exposure and get_unpatched_endpoints
    // (LOCAL ADDITIONS, not upstream).
    expect(tools).toHaveLength(10);
  });

  it('registers the local composite tools', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_vulnerability_exposure');
    expect(names).toContain('get_unpatched_endpoints');
  });

  it('registers all expected tool names', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
  });

  it('does not register tools from other domains', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const forbidden = [
      'list_endpoints', 'get_endpoint',
      'list_assets', 'get_asset',
      'list_ad_groups', 'get_ad_group',
      'list_jobs', 'get_job',
    ];
    for (const name of forbidden) {
      expect(names).not.toContain(name);
    }
  });

  it('all tools have descriptions of at least 20 words', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const wordCount = tool.description?.split(/\s+/).length ?? 0;
      expect(wordCount, `${tool.name} description too short (${wordCount} words)`).toBeGreaterThanOrEqual(20);
    }
  });

  it('returns MethodNotFound for unknown tool', async () => {
    const { client } = await startServer();
    await expect(
      client.callTool({ name: 'nonexistent_tool', arguments: {} })
    ).rejects.toThrow();
  });

  // Validator-migration regression tests (centralised validateOrThrow)
  describe('validator rejects bad arguments before reaching bConnect', () => {
    it('list_detected_rule_violations_by_endpoint: missing endpointId', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'list_detected_rule_violations_by_endpoint', arguments: {} })
      ).rejects.toThrow(/endpointId is required/i);
    });

    it('list_detected_vulnerabilities_by_endpoint: endpointId not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'list_detected_vulnerabilities_by_endpoint',
          arguments: { endpointId: 'oops' }
        })
      ).rejects.toThrow(/guid/i);
    });

    // MIGRATED (OPT-31). These two tools took `ruleId` and `vulnerabilityId`.
    // Neither name exists upstream — both routes declare `id`
    // (/v2.0/Rules/{id}, /v2.0/Vulnerabilities/{id}) — and the declaration
    // layer refuses to advertise a parameter the operation does not declare,
    // which is the D6 guard working as intended. The tools now take `id`, like
    // get_job_definition and get_asset. BREAKING for these two schemas.
    it('get_mobile_device_rule: missing id', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_mobile_device_rule', arguments: {} })
      ).rejects.toThrow(/id is required/i);
    });

    it('get_mobile_device_rule: the old ruleId spelling is refused, not ignored', async () => {
      // Without this, dropping the rename would look like a passing suite: the
      // tool would simply receive an argument it does not read and call the
      // route with `undefined` in the path.
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'get_mobile_device_rule',
          arguments: { ruleId: 'd0000001-0001-0001-0001-000000000001' },
        })
      ).rejects.toThrow(/id is required/i);
    });

    it('get_vulnerability: id not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'get_vulnerability',
          arguments: { id: 'not-a-guid' }
        })
      ).rejects.toThrow(/guid/i);
    });
  });

  // Finding A2 — a rejection thrown by createServer()'s own handler (as
  // opposed to validateOrThrow, which is covered by mcp-core's own A2 tests)
  // must not carry a doubled "MCP error <code>: " prefix. Before the fix,
  // `default: throw new McpError(...)` here produced
  // "MCP error -32601: MCP error -32601: Unknown tool: ...".
  it('does not double the "MCP error" prefix on MethodNotFound', async () => {
    // Needs a credentialed client so getBconnect() succeeds and dispatch
    // reaches the `default:` MethodNotFound throw, rather than failing
    // earlier on missing credentials (a different BareMcpError site).
    const { server } = createServer({ apiKey: 'test-key' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
    try {
      await client.callTool({ name: 'nonexistent_tool', arguments: {} });
      throw new Error('expected callTool to reject');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/^MCP error -32601: Unknown tool: nonexistent_tool$/);
      expect(message).not.toMatch(/MCP error -32601: MCP error/);
    }
  });
});
