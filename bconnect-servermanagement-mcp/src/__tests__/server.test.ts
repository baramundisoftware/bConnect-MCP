/**
 * bconnect-servermanagement-mcp — server isolation test
 *
 * Verifies that:
 * 1. createServer() lists exactly 25 tools in 25R2 mode
 * 2. createServer() lists exactly 30 tools in 26R1 mode
 * 3. All expected tool names are registered
 * 4. 26R1-only tools only appear in 26R1 mode
 * 5. Unknown tool calls return MethodNotFound
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const EXPECTED_25R2_TOOLS = [
  'get_management_server',
  'get_gateway',
  'get_dip_status',
  'get_vpn_appliance',
  'list_microservices',
  'get_microservice',
  'start_microservice',
  'stop_microservice',
  'restart_microservice',
  'list_cloud_connectors',
  'list_pxe_relays',
  'list_security_groups',
  'get_security_group',
  'create_security_group',
  'update_security_group',
  'delete_security_group',
  'list_security_profiles',
  'get_security_profile',
  'create_security_profile',
  'update_security_profile',
  'delete_security_profile',
  'get_access_rights',
  'update_object_permission',
  'restart_management_server',
  'cancel_scheduled_restart',
];

const EXPECTED_26R1_ONLY_TOOLS = [
  'list_api_keys',
  'simulate_msw_cleanup',
  'msw_cleanup',
  'list_download_jobs',
  'get_download_job',
];

async function startServer(): Promise<{ client: InstanceType<typeof Client> }> {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

async function startServerWith26R1(): Promise<{ client: InstanceType<typeof Client> }> {
  process.env.BCONNECT_RELEASE = '26R1';
  const { server } = createServer();
  process.env.BCONNECT_RELEASE = undefined;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// TOK-20: write tools are advertised only when ALLOW_WRITE_OPERATIONS=true. The
// counting and name assertions below are about the FULL declared surface, so
// they open the gate; the gate-shut surface is asserted in surface.test.ts.
function openWriteGate(): void {
  vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
}

describe('bconnect-servermanagement-mcp', () => {
  // MIGRATED (Decision 2). This asserted 25 tools with BCONNECT_RELEASE unset,
  // which was this server's REAL default posture: its flag was
  // `process.env.BCONNECT_RELEASE === '26R1'` with no fallback, unlike the other
  // four servers, so seven 26R1 tools were invisible unless an operator set the
  // variable. They are unconditional now and the count is the same 30 that
  // '26R1 mode' always produced.
  it('lists 30 servermanagement tools with BCONNECT_RELEASE unset', async () => {
    openWriteGate();
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(30);
  });

  it('lists exactly 30 servermanagement tools in 26R1 mode', async () => {
    openWriteGate();
    const { client } = await startServerWith26R1();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(30);
  });

  it('registers every tool name, formerly-conditional ones included', async () => {
    openWriteGate();
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of [...EXPECTED_25R2_TOOLS, ...EXPECTED_26R1_ONLY_TOOLS]) {
      expect(names).toContain(expected);
    }
  });

  it('registers 26R1-only tools in 26R1 mode', async () => {
    openWriteGate();
    const { client } = await startServerWith26R1();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of EXPECTED_26R1_ONLY_TOOLS) {
      expect(names).toContain(expected);
    }
  });

  // MIGRATED (Decision 2), inverted. This asserted the seven 26R1 tools were
  // ABSENT when BCONNECT_RELEASE was unset — which was the defect, not the
  // feature: the documented default posture silently omitted list_api_keys and
  // the download-job tools. The inverse is now the invariant, and it is what
  // fails if a release conditional comes back.
  it('registers the formerly-conditional tools with BCONNECT_RELEASE unset', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const tool of EXPECTED_26R1_ONLY_TOOLS) {
      expect(names).toContain(tool);
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

  it('does not register tools from other domains', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const forbidden = [
      'list_endpoints', 'get_endpoint',
      'list_assets', 'get_asset',
      'list_ad_groups', 'get_ad_group',
      'list_jobs', 'get_job',
      'list_os_folders', 'get_os_folder',
    ];
    for (const name of forbidden) {
      expect(names).not.toContain(name);
    }
  });

  // Validator-migration regression tests (centralised validateOrThrow)
  describe('validator rejects bad arguments before reaching bConnect', () => {
    it('get_microservice: missing id', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_microservice', arguments: {} })
      ).rejects.toThrow(/id is required/i);
    });

    it('start_microservice: id not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'start_microservice', arguments: { id: 'oops' } })
      ).rejects.toThrow(/guid/i);
    });

    it('create_security_group: missing groupData', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'create_security_group', arguments: {} })
      ).rejects.toThrow(/groupData is required/i);
    });

    it('update_security_profile: patchOperations not an array', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'update_security_profile',
          arguments: { id: 'd0000001-0001-0001-0001-000000000001', patchOperations: 'oops' }
        })
      ).rejects.toThrow(/patchOperations/i);
    });

    it('get_access_rights: objectId not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_access_rights', arguments: { objectId: 'oops' } })
      ).rejects.toThrow(/guid/i);
    });
  });
});
