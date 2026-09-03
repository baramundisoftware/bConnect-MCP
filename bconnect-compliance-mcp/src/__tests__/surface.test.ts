/**
 * bconnect-compliance-mcp — the 2026-08-02 round-3 surface revision.
 *
 *   INT-47  the `_for_endpoint` pair is renamed to `_by_endpoint`, matching the
 *           suite convention. The old names are gone from the catalogue AND from
 *           dispatch — a client that still calls one gets MethodNotFound rather
 *           than a silent no-op.
 *   TOK-25  `countOnly` returns the envelope count instead of a page of rows.
 *   INT-53  expected API failures come back as isError tool results.
 *
 * `get_unpatched_endpoints` and `get_vulnerability_exposure` are named in
 * DEMO-RUN-OF-SHOW.md and the patch-queue demo. They are asserted present, by
 * name, so this revision cannot quietly take them away.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BConnectApiError } from '@bconnect/mcp-core';

import { createServer } from '../index.js';
import { ComplianceModule } from '../modules/compliance.js';

const RENAMED = [
  ['list_detected_rule_violations_for_endpoint', 'list_detected_rule_violations_by_endpoint'],
  ['list_detected_vulnerabilities_for_endpoint', 'list_detected_vulnerabilities_by_endpoint'],
] as const;

/** Named in DEMO-RUN-OF-SHOW.md — renaming or removing either breaks the demo. */
const DEMO_PROTECTED = ['get_unpatched_endpoints', 'get_vulnerability_exposure'];

async function connect(): Promise<Client> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'surface-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]!.text;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('INT-47 — _for_endpoint became _by_endpoint', () => {
  it('the catalogue advertises the new names and no longer advertises the old ones', async () => {
    const { tools } = await (await connect()).listTools();
    const names = tools.map((t) => t.name);
    for (const [oldName, newName] of RENAMED) {
      expect(names).toContain(newName);
      expect(names).not.toContain(oldName);
    }
  });

  it('the old names are not dispatchable either', async () => {
    const client = await connect();
    for (const [oldName] of RENAMED) {
      await expect(
        client.callTool({
          name: oldName,
          arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001' },
        })
      ).rejects.toThrow(new RegExp(`Unknown tool: ${oldName}`));
    }
  });

  it('the new name reaches the same route the old one did', async () => {
    const spy = vi
      .spyOn(ComplianceModule.prototype, 'getDetectedVulnerabilitiesByEndpoint')
      .mockResolvedValue({ page: 0, pageSize: 20, totalItems: 0, totalPages: 0, data: [] } as never);

    const client = await connect();
    await client.callTool({
      name: 'list_detected_vulnerabilities_by_endpoint',
      arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001', PageSize: 5 },
    });
    expect(spy).toHaveBeenCalledWith('d0000001-0001-0001-0001-000000000001', { PageSize: 5 });
  });

  it('the demo-protected composite tools are still advertised under their own names', async () => {
    const { tools } = await (await connect()).listTools();
    const names = tools.map((t) => t.name);
    for (const name of DEMO_PROTECTED) {
      expect(names).toContain(name);
    }
  });
});

describe('TOK-25 — countOnly', () => {
  const LIST_TOOLS = [
    'list_detected_rule_violations',
    'list_detected_rule_violations_by_endpoint',
    'list_detected_vulnerabilities',
    'list_detected_vulnerabilities_by_endpoint',
    'list_mobile_device_rules',
    'list_vulnerabilities',
  ];

  it('every list tool advertises countOnly', async () => {
    const { tools } = await (await connect()).listTools();
    for (const name of LIST_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      const properties = (tool.inputSchema as { properties: Record<string, unknown> }).properties;
      expect(properties, `${name} should advertise countOnly`).toHaveProperty('countOnly');
    }
  });

  it('list_vulnerabilities: counts 37,571 CVEs without materialising a row', async () => {
    const spy = vi
      .spyOn(ComplianceModule.prototype, 'getAllVulnerabilities')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 37571, totalPages: 37571, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_vulnerabilities',
      arguments: { countOnly: true, SearchQuery: 'Chrome' },
    });

    expect(spy).toHaveBeenCalledWith({ SearchQuery: 'Chrome', Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({
      totalItems: 37571,
      filters: { SearchQuery: 'Chrome' },
    });
    // `totalPages` from the probe is the item count again at PageSize=1 and is
    // deliberately not forwarded.
    expect(textOf(result)).not.toContain('totalPages');
  });

  it('the endpoint-scoped count keeps the path id out of the query', async () => {
    const spy = vi
      .spyOn(ComplianceModule.prototype, 'getDetectedVulnerabilitiesByEndpoint')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 42, totalPages: 42, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_detected_vulnerabilities_by_endpoint',
      arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001', countOnly: true },
    });

    expect(spy).toHaveBeenCalledWith('d0000001-0001-0001-0001-000000000001', {
      Page: 100000,
      PageSize: 1,
    });
    expect(JSON.parse(textOf(result))).toEqual({ totalItems: 42 });
  });
});

describe('INT-53 — one error channel', () => {
  it('404 comes back as a readable isError result, not a protocol error', async () => {
    vi.spyOn(ComplianceModule.prototype, 'getVulnerability').mockRejectedValue(
      new BConnectApiError(404, 'Resource not found. GET /compliance/v2.0/Vulnerabilities/…', {
        method: 'GET',
        path: '/compliance/v2.0/Vulnerabilities/x',
      })
    );

    const client = await connect();
    const result = await client.callTool({
      name: 'get_vulnerability',
      // MIGRATED (OPT-31): was . The route is
      // /v2.0/Vulnerabilities/{id} and the declaration layer advertises what the
      // operation declares, so the invented name is gone.
      arguments: { id: 'd0000001-0001-0001-0001-000000000001' },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('Resource not found.');
  });

  it('500 stays a protocol InternalError', async () => {
    vi.spyOn(ComplianceModule.prototype, 'getVulnerability').mockRejectedValue(
      new BConnectApiError(500, 'bConnect API returned an internal server error.', {
        method: 'GET',
        path: '/compliance/v2.0/Vulnerabilities/x',
      })
    );

    const client = await connect();
    await expect(
      client.callTool({
        name: 'get_vulnerability',
        // MIGRATED (OPT-31): was . The route is
      // /v2.0/Vulnerabilities/{id} and the declaration layer advertises what the
      // operation declares, so the invented name is gone.
      arguments: { id: 'd0000001-0001-0001-0001-000000000001' },
      })
    ).rejects.toThrow(/Tool execution failed: bConnect API returned an internal server error\./);
  });
});
