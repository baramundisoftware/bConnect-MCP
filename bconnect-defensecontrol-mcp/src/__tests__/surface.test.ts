/**
 * bconnect-defensecontrol-mcp — the 2026-08-02 round-3 surface revision.
 *
 *   TOK-20  write tools are advertised only when ALLOW_WRITE_OPERATIONS=true.
 *           This server has two gates; hiding a tool weakens neither. The
 *           SEC-3 ordering (write gate first, then the secret gate) is asserted
 *           here as well as in server.test.ts, because TOK-20 moved the write
 *           gate from a hand-written Set to the shared catalogue.
 *   TOK-25  `countOnly` returns the envelope count instead of a page of rows.
 *   TOK-10  the shared pagination fragment replaced the copied OpenAPI prose.
 *   INT-53  expected API failures come back as isError tool results.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BConnectApiError, PAGE_DESCRIPTION, VERBOSE_PAGE_DESCRIPTION } from '@bconnect/mcp-core';

import { createServer } from '../index.js';
import { DefenseControlModule } from '../modules/defensecontrol.js';

const WRITE_TOOLS = [
  'update_bitlocker_pin',
  'patch_local_admin_user_credentials',
  'refresh_local_admin_account_expiry',
];

const LIST_TOOLS = [
  'list_bitlocker_windows_endpoints',
  'list_defender_threats',
  'list_defender_threats_by_endpoint',
  'list_defender_threats_by_logical_group',
  'list_defender_windows_endpoints',
];

const GUID = 'd0000001-0001-0001-0001-000000000001';

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
  delete process.env.BCONNECT_RELEASE;
});

describe('TOK-20 — write tools are conditional on ALLOW_WRITE_OPERATIONS', () => {
  it('gate shut (26R1): 11 read tools, no write tool advertised', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const names = (await (await connect()).listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(11);
    for (const write of WRITE_TOOLS) {
      expect(names).not.toContain(write);
    }
    // The secret-returning READ is still advertised — it is gated by
    // ALLOW_SECRET_READ, which is a different question from "does it mutate".
    expect(names).toContain('get_bitlocker_secrets');
    expect(names).toContain('get_local_admin_accounts');
  });

  // MIGRATED (Decision 2). Was "gate shut (25R2): the 26R1-only write is not
  // declared". There is no 25R2 any more, so the write gate is the ONLY thing
  // that hides a tool here: update_bitlocker_pin goes (it mutates),
  // get_bitlocker_secrets stays (it reads, and is gated by ALLOW_SECRET_READ
  // instead — a different question).
  it('gate shut with BCONNECT_RELEASE set: the release variable changes nothing', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    process.env.BCONNECT_RELEASE = '25R2';
    const names = (await (await connect()).listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(11);
    expect(names).not.toContain('update_bitlocker_pin');
    expect(names).toContain('get_bitlocker_secrets');
  });

  it('gate open (26R1): all 14 declared tools are advertised', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const names = (await (await connect()).listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(14);
    for (const write of WRITE_TOOLS) {
      expect(names).toContain(write);
    }
  });

  it('hiding is not disabling: a hidden write called by name still gets the refusal', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const client = await connect();
    const result = await client.callTool({
      name: 'refresh_local_admin_account_expiry',
      arguments: { endpointId: GUID },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toBe(
      "Write operation 'refresh_local_admin_account_expiry' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations."
    );
  });

  it('update_bitlocker_pin is refused with the gate shut, whatever BCONNECT_RELEASE says', async () => {
    // MIGRATED (Decision 2). This used to exist because `update_bitlocker_pin`
    // left BOTH the tool list and the write set on 25R2, and the test proved it
    // still could not execute. The conditional is gone, so the tool is always
    // declared and always gated — but the property under test is the same one
    // and is the one that matters: with the gate shut, the module method is not
    // called. The stale BCONNECT_RELEASE is left set on purpose, to prove it is
    // now inert.
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    vi.stubEnv('ALLOW_SECRET_READ', '');
    process.env.BCONNECT_RELEASE = '25R2';
    const spy = vi.spyOn(DefenseControlModule.prototype, 'updateBitLockerPin');
    const client = await connect();
    const result = await client.callTool({
      name: 'update_bitlocker_pin',
      arguments: { endpointId: GUID, patchOperations: [{ op: 'replace', path: '/pin', value: '1' }] },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('SEC-3 ordering survives: write gate answers before the secret gate', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    vi.stubEnv('ALLOW_SECRET_READ', 'true');
    const client = await connect();
    const result = await client.callTool({
      name: 'patch_local_admin_user_credentials',
      arguments: { endpointId: GUID, patchOperations: [{ op: 'replace', path: '/comment', value: 'x' }] },
    });
    expect(textOf(result)).toMatch(/ALLOW_WRITE_OPERATIONS/);
    expect(textOf(result)).not.toMatch(/ALLOW_SECRET_READ/);
  });
});

describe('TOK-10 — shared schema fragments', () => {
  it('every list tool uses the canonical zero-indexed Page wording', async () => {
    const { tools } = await (await connect()).listTools();
    for (const name of LIST_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      const props = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties;
      expect(props.Page!.description, name).toBe(PAGE_DESCRIPTION);
      expect(props.Page!.description, name).not.toBe(VERBOSE_PAGE_DESCRIPTION);
    }
  });
});

describe('TOK-25 — countOnly', () => {
  it('every list tool advertises countOnly', async () => {
    const { tools } = await (await connect()).listTools();
    for (const name of LIST_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      expect((tool.inputSchema as { properties: object }).properties, name).toHaveProperty('countOnly');
    }
  });

  it('asks for a page past the end and returns the count, not the rows', async () => {
    const spy = vi
      .spyOn(DefenseControlModule.prototype, 'getMicrosoftDefenderThreats')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 4, totalPages: 4, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_defender_threats',
      arguments: { countOnly: true, SearchQuery: 'Trojan' },
    });

    expect(spy).toHaveBeenCalledWith({ SearchQuery: 'Trojan', Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({ totalItems: 4, filters: { SearchQuery: 'Trojan' } });
  });

  it('the group-scoped count keeps the path id out of the query', async () => {
    const spy = vi
      .spyOn(DefenseControlModule.prototype, 'getMicrosoftDefenderThreatsByLogicalGroup')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 0, totalPages: 0, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_defender_threats_by_logical_group',
      arguments: { logicalGroupId: GUID, countOnly: true, includeSubfolders: true },
    });

    expect(spy).toHaveBeenCalledWith(GUID, { includeSubfolders: true, Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({
      totalItems: 0,
      filters: { includeSubfolders: true },
    });
  });
});

describe('INT-53 — one error channel', () => {
  it('404 comes back as a readable isError result', async () => {
    vi.spyOn(DefenseControlModule.prototype, 'getMicrosoftDefenderThreat').mockRejectedValue(
      new BConnectApiError(404, 'Resource not found. GET /defensecontrol/v2.0/MicrosoftDefender/Threats/…')
    );
    const client = await connect();
    const result = await client.callTool({ name: 'get_defender_threat', arguments: { threatId: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('Resource not found.');
  });

  it('403 comes back as a readable isError result', async () => {
    vi.spyOn(DefenseControlModule.prototype, 'getMicrosoftDefenderThreat').mockRejectedValue(
      new BConnectApiError(403, 'Access denied. Insufficient permissions for this operation.')
    );
    const client = await connect();
    const result = await client.callTool({ name: 'get_defender_threat', arguments: { threatId: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('Access denied.');
  });

  it('401 stays a protocol InternalError — no argument the model picks fixes bad credentials', async () => {
    vi.spyOn(DefenseControlModule.prototype, 'getMicrosoftDefenderThreat').mockRejectedValue(
      new BConnectApiError(401, 'Authentication failed. Check BCONNECT_USERNAME and BCONNECT_PASSWORD.')
    );
    const client = await connect();
    await expect(
      client.callTool({ name: 'get_defender_threat', arguments: { threatId: GUID } })
    ).rejects.toThrow(/Tool execution failed: Authentication failed\./);
  });
});
