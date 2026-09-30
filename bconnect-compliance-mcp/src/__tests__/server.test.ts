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
  'list_detected_rule_violations_for_endpoint',
  'list_detected_vulnerabilities',
  'list_detected_vulnerabilities_for_endpoint',
  'list_mobile_device_rules',
  'get_mobile_device_rule',
  'list_vulnerabilities',
  'get_vulnerability',
];

async function startServer(): Promise<void> {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

describe('bconnect-compliance-mcp', () => {
  it('lists exactly 8 compliance tools', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(8);
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
    it('list_detected_rule_violations_for_endpoint: missing endpointId', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'list_detected_rule_violations_for_endpoint', arguments: {} })
      ).rejects.toThrow(/endpointId is required/i);
    });

    it('list_detected_vulnerabilities_for_endpoint: endpointId not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'list_detected_vulnerabilities_for_endpoint',
          arguments: { endpointId: 'oops' }
        })
      ).rejects.toThrow(/guid/i);
    });

    it('get_mobile_device_rule: missing ruleId', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_mobile_device_rule', arguments: {} })
      ).rejects.toThrow(/ruleId is required/i);
    });

    it('get_vulnerability: vulnerabilityId not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'get_vulnerability',
          arguments: { vulnerabilityId: 'not-a-guid' }
        })
      ).rejects.toThrow(/guid/i);
    });
  });
});
