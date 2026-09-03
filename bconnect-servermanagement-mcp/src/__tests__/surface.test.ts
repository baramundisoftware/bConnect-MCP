/**
 * bconnect-servermanagement-mcp — the 2026-08-02 round-3 surface revision.
 *
 *   D1      `list_api_keys` returns the bMS API-key inventory
 *           (GET /servermanagement/v2.0/ApiKeys) and was covered by neither the
 *           audit set nor the deny set. It is now behind ALLOW_SECRET_READ, the
 *           same variable and the same isError shape bconnect-defensecontrol-mcp
 *           uses for LAPS passwords and BitLocker keys. The route-table half —
 *           adding /ApiKeys to SECURITY_SENSITIVE_ROUTES and
 *           CREDENTIAL_RETURNING_ROUTES in packages/mcp-core — is handed off to
 *           the mcp-core owner; this layer is the one that lives here.
 *   TOK-20  write tools are advertised only when ALLOW_WRITE_OPERATIONS=true.
 *   TOK-25  `countOnly` returns the envelope count instead of a page of rows.
 *   TOK-10  the shared pagination fragment replaced the copied OpenAPI prose —
 *           including the one verbatim 94-character sentence in this server.
 *   INT-53  expected API failures come back as isError tool results.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BConnectApiError, PAGE_DESCRIPTION, VERBOSE_PAGE_DESCRIPTION } from '@bconnect/mcp-core';

import { createServer } from '../index.js';
import { ServerManagementModule } from '../modules/servermanagement.js';

const WRITE_TOOLS_25R2 = [
  'start_microservice',
  'stop_microservice',
  'restart_microservice',
  'create_security_group',
  'update_security_group',
  'delete_security_group',
  'create_security_profile',
  'update_security_profile',
  'delete_security_profile',
  'update_object_permission',
  'restart_management_server',
  'cancel_scheduled_restart',
];

const GUID = 'd0000001-0001-0001-0001-000000000001';

async function connect(release?: '26R1'): Promise<Client> {
  if (release) {
    vi.stubEnv('BCONNECT_RELEASE', release);
  }
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

describe('D1 — list_api_keys is behind the secret gate', () => {
  it('refuses by default, with the readable isError shape and the variable to set', async () => {
    vi.stubEnv('ALLOW_SECRET_READ', '');
    const client = await connect('26R1');
    const result = await client.callTool({ name: 'list_api_keys', arguments: {} });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('API-key inventory');
    expect(textOf(result)).toContain('ALLOW_SECRET_READ=true');
  });

  it('refuses before the API is ever called', async () => {
    vi.stubEnv('ALLOW_SECRET_READ', '');
    const spy = vi.spyOn(ServerManagementModule.prototype, 'getApiKeys').mockResolvedValue([]);
    const client = await connect('26R1');
    await client.callTool({ name: 'list_api_keys', arguments: {} });
    expect(spy).not.toHaveBeenCalled();
  });

  it('dispatches once ALLOW_SECRET_READ=true — the gate is an opt-in, not a removal', async () => {
    vi.stubEnv('ALLOW_SECRET_READ', 'true');
    const spy = vi
      .spyOn(ServerManagementModule.prototype, 'getApiKeys')
      .mockResolvedValue([{ name: 'demo-key' }]);
    const client = await connect('26R1');
    const result = await client.callTool({ name: 'list_api_keys', arguments: {} });
    expect(spy).toHaveBeenCalled();
    expect(textOf(result)).not.toContain('ALLOW_SECRET_READ');
  });

  it('does not gate the neighbouring read tools', async () => {
    vi.stubEnv('ALLOW_SECRET_READ', '');
    const spy = vi
      .spyOn(ServerManagementModule.prototype, 'getManagementServer')
      .mockResolvedValue({ version: '26.1' } as never);
    const client = await connect('26R1');
    const result = await client.callTool({ name: 'get_management_server', arguments: {} });
    expect(spy).toHaveBeenCalled();
    expect((result as { isError?: boolean }).isError).toBeFalsy();
  });
});

describe('TOK-20 — write tools are conditional on ALLOW_WRITE_OPERATIONS', () => {
  // MIGRATED (Decision 2). Was 'gate shut (25R2): 13 read tools'. With the
  // release conditional gone, BCONNECT_RELEASE unset gives the same 16 reads
  // that '26R1 mode' gave — the three extra reads (list_api_keys,
  // list_download_jobs, get_download_job) are no longer hidden from the
  // documented default posture.
  it('gate shut: 16 read tools, no write tool advertised', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const names = (await (await connect()).listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(16);
    for (const write of [...WRITE_TOOLS_25R2, 'simulate_msw_cleanup', 'msw_cleanup']) {
      expect(names).not.toContain(write);
    }
    expect(names).toContain('list_api_keys');
    expect(names).toContain('list_download_jobs');
    expect(names).toContain('get_download_job');
  });

  it('gate shut (26R1): the two extra writes are hidden, the three extra reads are not', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const names = (await (await connect('26R1')).listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(16);
    expect(names).not.toContain('simulate_msw_cleanup');
    expect(names).not.toContain('msw_cleanup');
    expect(names).toContain('list_api_keys');
    expect(names).toContain('list_download_jobs');
    expect(names).toContain('get_download_job');
  });

  it('gate open (26R1): all 30 declared tools are advertised', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const names = (await (await connect('26R1')).listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(30);
  });

  it('hiding is not disabling: a hidden write called by name still gets the refusal', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const client = await connect();
    const result = await client.callTool({ name: 'restart_management_server', arguments: {} });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toBe(
      "Write operation 'restart_management_server' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations."
    );
  });
});

describe('TOK-10 — shared schema fragments', () => {
  it('list_download_jobs no longer carries the 94-character OpenAPI page sentence', async () => {
    const { tools } = await (await connect('26R1')).listTools();
    const tool = tools.find((t) => t.name === 'list_download_jobs')!;
    const props = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(props.Page!.description).toBe(PAGE_DESCRIPTION);
    expect(props.Page!.description).not.toBe(VERBOSE_PAGE_DESCRIPTION);
    // The D14b filters this tool exists to expose must survive the fragment swap.
    for (const key of ['SearchQuery', 'OrderBy', 'Name', 'StateValue', 'LastExecution']) {
      expect(props, key).toHaveProperty(key);
    }
  });

  it('the security list tools use the canonical Page wording', async () => {
    const { tools } = await (await connect()).listTools();
    for (const name of ['list_security_groups', 'list_security_profiles']) {
      const tool = tools.find((t) => t.name === name)!;
      const props = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties;
      expect(props.Page!.description, name).toBe(PAGE_DESCRIPTION);
    }
  });
});

describe('TOK-25 — countOnly', () => {
  it('the paged list tools advertise countOnly', async () => {
    const { tools } = await (await connect('26R1')).listTools();
    for (const name of ['list_security_groups', 'list_security_profiles', 'list_download_jobs']) {
      const tool = tools.find((t) => t.name === name)!;
      expect((tool.inputSchema as { properties: object }).properties, name).toHaveProperty('countOnly');
    }
  });

  it('asks for a page past the end and returns the count, not the rows', async () => {
    const spy = vi
      .spyOn(ServerManagementModule.prototype, 'getSecurityGroups')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 6, totalPages: 6, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_security_groups',
      arguments: { countOnly: true, Name: 'Admins' },
    });

    expect(spy).toHaveBeenCalledWith({ Name: 'Admins', Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({ totalItems: 6, filters: { Name: 'Admins' } });
  });
});

describe('INT-53 — one error channel', () => {
  it('404 comes back as a readable isError result', async () => {
    vi.spyOn(ServerManagementModule.prototype, 'getSecurityGroup').mockRejectedValue(
      new BConnectApiError(404, 'Resource not found. GET /servermanagement/v2.0/SecurityGroups/…')
    );
    const client = await connect();
    const result = await client.callTool({ name: 'get_security_group', arguments: { id: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('Resource not found.');
  });

  it('500 stays a protocol InternalError', async () => {
    vi.spyOn(ServerManagementModule.prototype, 'getSecurityGroup').mockRejectedValue(
      new BConnectApiError(500, 'bConnect API returned an internal server error.')
    );
    const client = await connect();
    await expect(
      client.callTool({ name: 'get_security_group', arguments: { id: GUID } })
    ).rejects.toThrow(/Tool execution failed: bConnect API returned an internal server error\./);
  });
});
