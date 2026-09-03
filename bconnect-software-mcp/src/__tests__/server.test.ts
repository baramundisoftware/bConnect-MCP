/**
 * bconnect-software-mcp — server isolation test
 *
 * Verifies that:
 * 1. createServer() starts and lists all expected software tools
 * 2. 25R2 mode registers only installed-software tools (4)
 * 3. 26R1 mode registers all tools (4 installed + 15 bundle/folder = 19)
 * 4. No tools from other domains are registered
 * 5. Unknown tool calls return MethodNotFound
 *
 * ROUND 3 (TOK-20): the inventory counts below are the FULL declared surface,
 * which is what tools/list returns when ALLOW_WRITE_OPERATIONS=true. In the
 * default posture the eight write tools are no longer advertised — the write
 * gate that used to only refuse them now also hides their schemas. These tests
 * therefore open the gate before listing, so they stay what QA-61 wanted them
 * to be: an inventory tripwire that fires when a tool is added or removed.
 * The default-posture surface is asserted in tool-surface.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const INSTALLED_SOFTWARE_TOOLS = [
  'list_installed_windows_software',
  'list_installed_software_by_endpoint',
  'list_installed_software_by_logical_group',
  'list_installed_software_by_universal_dynamic_group',
];

const BUNDLE_TOOLS_26R1 = [
  // Bundles
  'list_software_bundles',
  'get_software_bundle',
  'create_software_bundle',
  'delete_software_bundle',
  // Bundle Applications
  'list_bundle_applications',
  'list_bundle_applications_by_bundle',
  'add_application_to_bundle',
  'delete_bundle_application',
  'replace_application_in_bundle',
  // Bundle Folders
  'list_bundle_folders',
  'get_bundle_folder',
  'list_bundle_folders_by_folder',
  'create_bundle_folder',
  'delete_bundle_folder',
  'update_bundle_folder',
];

async function startServer(release: string = '25R2'): Promise<{ client: InstanceType<typeof Client> }> {
  process.env.BCONNECT_RELEASE = release;
  // Inventory assertions are about the DECLARED surface — see the header.
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

// MIGRATED (Decision 2). This block asserted that BCONNECT_RELEASE=25R2 cut
// the surface to the four installed-software tools. 25R2 is no longer
// supported and the switch is gone, so the block now asserts the opposite: the
// variable is inert, and the bundle tools 26R1 introduced are always there.
describe('bconnect-software-mcp (BCONNECT_RELEASE is inert)', () => {
  beforeEach(() => { process.env.BCONNECT_RELEASE = '25R2'; });
  afterEach(() => { delete process.env.BCONNECT_RELEASE; delete process.env.ALLOW_WRITE_OPERATIONS; });

  it('lists the full declared surface even with BCONNECT_RELEASE=25R2', async () => {
    // `startServer` opens the write gate deliberately — see the file header —
    // so 19 is the DECLARED surface, which is the number this block is about.
    // It was 4 before Decision 2.
    const { client } = await startServer('25R2');
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(19);
  });

  it('registers all installed-software tool names whatever the release says', async () => {
    const { client } = await startServer('25R2');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of INSTALLED_SOFTWARE_TOOLS) {
      expect(names).toContain(expected);
    }
  });

  // Inverted, and this is the assertion that fails if a release conditional
  // comes back: the bundle tools used to disappear here.
  it('registers the bundle tools regardless of BCONNECT_RELEASE', async () => {
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
    const { client } = await startServer('25R2');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const bundleTool of BUNDLE_TOOLS_26R1) {
      expect(names).toContain(bundleTool);
    }
  });
});

describe('bconnect-software-mcp (26R1 mode)', () => {
  beforeEach(() => { process.env.BCONNECT_RELEASE = '26R1'; });
  afterEach(() => { delete process.env.BCONNECT_RELEASE; delete process.env.ALLOW_WRITE_OPERATIONS; });

  it('lists exactly 19 tools in 26R1', async () => {
    const { client } = await startServer('26R1');
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(19);
  });

  it('registers all installed-software tools in 26R1', async () => {
    const { client } = await startServer('26R1');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of INSTALLED_SOFTWARE_TOOLS) {
      expect(names).toContain(expected);
    }
  });

  it('registers all 26R1 bundle and folder tools', async () => {
    const { client } = await startServer('26R1');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of BUNDLE_TOOLS_26R1) {
      expect(names).toContain(expected);
    }
  });

  it('does not register tools from other domains', async () => {
    const { client } = await startServer('26R1');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const forbidden = [
      'list_endpoints', 'get_endpoint',
      'list_assets', 'get_asset',
      'list_ad_groups', 'get_ad_group',
      'list_jobs', 'get_job',
      'list_bitlocker_windows_endpoints',
    ];
    for (const name of forbidden) {
      expect(names).not.toContain(name);
    }
  });

  it('all tools have descriptions of at least 20 words', async () => {
    const { client } = await startServer('26R1');
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const wordCount = tool.description?.split(/\s+/).length ?? 0;
      expect(wordCount, `${tool.name} description too short (${wordCount} words)`).toBeGreaterThanOrEqual(20);
    }
  });

  it('returns MethodNotFound for unknown tool', async () => {
    const { client } = await startServer('26R1');
    await expect(
      client.callTool({ name: 'nonexistent_tool', arguments: {} })
    ).rejects.toThrow();
  });

  // Validator-migration regression tests (centralised validateOrThrow)
  describe('validator rejects bad arguments before reaching bConnect', () => {
    it('list_installed_software_by_endpoint: missing endpointId', async () => {
      const { client } = await startServer('26R1');
      await expect(
        client.callTool({ name: 'list_installed_software_by_endpoint', arguments: {} })
      ).rejects.toThrow(/endpointId is required/i);
    });

    it('get_software_bundle: bundleId not a GUID', async () => {
      const { client } = await startServer('26R1');
      await expect(
        client.callTool({ name: 'get_software_bundle', arguments: { bundleId: 'oops' } })
      ).rejects.toThrow(/guid/i);
    });

    it('create_software_bundle: missing name', async () => {
      const { client } = await startServer('26R1');
      await expect(
        client.callTool({ name: 'create_software_bundle', arguments: {} })
      ).rejects.toThrow(/name is required/i);
    });

    it('add_application_to_bundle: missing applicationId', async () => {
      const { client } = await startServer('26R1');
      await expect(
        client.callTool({
          name: 'add_application_to_bundle',
          arguments: { bundleId: 'd0000001-0001-0001-0001-000000000001' }
        })
      ).rejects.toThrow(/applicationId is required/i);
    });

    it('list_bundle_folders_by_folder: includeSubfolders not a boolean', async () => {
      const { client } = await startServer('26R1');
      await expect(
        client.callTool({
          name: 'list_bundle_folders_by_folder',
          arguments: { folderId: 'd0000001-0001-0001-0001-000000000001', includeSubfolders: 'yes' }
        })
      ).rejects.toThrow(/includeSubfolders/i);
    });

    it('update_bundle_folder: patchOperations not an array', async () => {
      const { client } = await startServer('26R1');
      await expect(
        client.callTool({
          name: 'update_bundle_folder',
          arguments: { id: 'd0000001-0001-0001-0001-000000000001', patchOperations: 'oops' }
        })
      ).rejects.toThrow(/patchOperations/i);
    });
  });
});
