/**
 * bconnect-software-mcp — the round-3 surface revision
 *
 * Covers the four changes this server took in one deliberate breaking pass, and
 * pins the properties each one is only worth having if it keeps:
 *
 *   TOK-20  write schemas are not advertised unless ALLOW_WRITE_OPERATIONS=true
 *           — and hiding is NOT disabling: the refusal for a hidden write is
 *           byte-identical to the one the hand-written gate returned.
 *   TOK-24  the installed-software rows lose the caller's own echoed arguments
 *           and the columns that are constant across the page; both are
 *           recorded once in `meta`, and `detail: true` is exact.
 *   TOK-25  countOnly asks past the end of the result set and returns the count
 *           without materialising a row.
 *   INT-53  400/403/404/429 come back as readable isError results; 5xx stays a
 *           protocol error.
 *
 * The bConnect client is replaced wholesale, so nothing here touches a network
 * and the assertions are about THIS server's dispatch, shaping and gating.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { BConnectApiError } from '@bconnect/mcp-core';

// ── The fake client ──────────────────────────────────────────────────────────

/** Every call the server made upstream, in order. */
const calls: { method: string; args: unknown[] }[] = [];
/** What the next call returns, or throws if it is an Error. */
let nextResult: unknown = { data: [] };

function record(method: string) {
  return async (...args: unknown[]): Promise<unknown> => {
    calls.push({ method, args });
    if (nextResult instanceof Error) {
      throw nextResult;
    }
    return nextResult;
  };
}

vi.mock('../bconnect-client.js', () => ({
  BConnectClient: class {
    software = {
      getInstalledWindowsSoftware: record('getInstalledWindowsSoftware'),
      getInstalledSoftwareByEndpoint: record('getInstalledSoftwareByEndpoint'),
      getInstalledSoftwareByLogicalGroup: record('getInstalledSoftwareByLogicalGroup'),
      getInstalledSoftwareByUniversalDynamicGroup: record('getInstalledSoftwareByUniversalDynamicGroup'),
      getSoftwareBundles: record('getSoftwareBundles'),
      getBundleApplications: record('getBundleApplications'),
      getBundleFolders: record('getBundleFolders'),
    };
  },
}));

const { createServer } = await import('../index.js');

// ── The fixture ──────────────────────────────────────────────────────────────
//
// Shaped after the live measurement in EVAL-2026-08-02.md (TOK-24): 130 items
// on WORKSTATION1 over 7 pages, ~430 B/row, application usage tracking off so
// autFirstUse/autLastUse/autLastData are null and autUsage is "AutDeactivated"
// on every row, and endpointId/endpointName echo the caller's own argument.

const ENDPOINT_ID = 'e57a7e00-0000-4000-8000-000000000027';

function softwareRow(index: number): Record<string, unknown> {
  return {
    vendor: ['Mozilla', 'Microsoft Corporation', 'Notepad++ Team', '7-Zip'][index % 4],
    name: `Application ${index} (x64 en-US)`,
    version: `14${index}.0.${index}`,
    category: null,
    source: 'Inventoried',
    installed: null,
    lastFound: '2026-08-01T02:14:11.0000000Z',
    applicationId: null,
    detectionRuleId: `1b7f0${index}c1-4d3a-4b21-9d2f-2f8a5c6e91${String(index).padStart(2, '0')}`,
    autFirstUse: null,
    autLastUse: null,
    autLastData: null,
    autUsage: 'AutDeactivated',
    endpointId: ENDPOINT_ID,
    endpointName: 'WORKSTATION1',
  };
}

function page(rows: number): Record<string, unknown> {
  return {
    currentPage: 0,
    pageSize: 20,
    totalPages: 7,
    totalItems: 130,
    hasPreviousPage: false,
    hasNextPage: true,
    data: Array.from({ length: rows }, (_, i) => softwareRow(i)),
  };
}

// ── Harness ──────────────────────────────────────────────────────────────────

async function connect(release = '26R1'): Promise<Client> {
  process.env.BCONNECT_RELEASE = release;
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'surface-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

async function callText(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { text: result.content[0].text, isError: result.isError === true };
}

async function callJson(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<{ text: string; json: Record<string, unknown>; isError: boolean }> {
  const { text, isError } = await callText(client, name, args);
  return { text, json: JSON.parse(text) as Record<string, unknown>, isError };
}

const bytes = (value: string): number => Buffer.byteLength(value, 'utf8');

beforeEach(() => {
  calls.length = 0;
  nextResult = { data: [] };
  delete process.env.ALLOW_WRITE_OPERATIONS;
});
afterEach(() => {
  delete process.env.BCONNECT_RELEASE;
  delete process.env.ALLOW_WRITE_OPERATIONS;
});

// ── TOK-20 ───────────────────────────────────────────────────────────────────

const WRITE_TOOL_NAMES = [
  'create_software_bundle',
  'delete_software_bundle',
  'add_application_to_bundle',
  'delete_bundle_application',
  'replace_application_in_bundle',
  'create_bundle_folder',
  'delete_bundle_folder',
  'update_bundle_folder',
];

describe('TOK-20 — write schemas are advertised only when writes are enabled', () => {
  it('26R1 default posture advertises the 11 read tools and no write tool', async () => {
    const client = await connect('26R1');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toHaveLength(11);
    for (const write of WRITE_TOOL_NAMES) {
      expect(names, `${write} must not be advertised while writes are disabled`).not.toContain(write);
    }
    expect(names).toContain('list_installed_software_by_endpoint');
    expect(names).toContain('list_bundle_folders_by_folder');
  });

  it('ALLOW_WRITE_OPERATIONS=true restores all 19 tools', async () => {
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
    const client = await connect('26R1');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toHaveLength(19);
    for (const write of WRITE_TOOL_NAMES) {
      expect(names).toContain(write);
    }
  });

  it('the gate is read per call, not captured when the server was built', async () => {
    const client = await connect('26R1');
    expect((await client.listTools()).tools).toHaveLength(11);

    process.env.ALLOW_WRITE_OPERATIONS = 'true';
    expect((await client.listTools()).tools).toHaveLength(19);

    delete process.env.ALLOW_WRITE_OPERATIONS;
    expect((await client.listTools()).tools).toHaveLength(11);
  });

  it('hiding is not disabling: a hidden write called by name gets the same refusal', async () => {
    const client = await connect('26R1');
    const { text, isError } = await callText(client, 'delete_software_bundle', {
      bundleId: 'd0000001-0001-0001-0001-000000000001',
    });

    expect(isError).toBe(true);
    expect(text).toBe(
      "Write operation 'delete_software_bundle' is disabled. " +
        'Set ALLOW_WRITE_OPERATIONS=true to enable write operations.'
    );
    expect(calls, 'a refused write must not reach bConnect').toHaveLength(0);
  });

  // MIGRATED (Decision 2). Was '25R2 advertises only the four installed-software
  // tools'. BCONNECT_RELEASE no longer selects a surface, so the four are the
  // FIRST four of the full 19 rather than the whole of it — and the order they
  // are declared in is itself worth pinning, since defineToolCatalogue
  // guarantees declaration order.
  it('BCONNECT_RELEASE=25R2 advertises the full surface, installed-software first', async () => {
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
    const client = await connect('25R2');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.slice(0, 4)).toEqual([
      'list_installed_windows_software',
      'list_installed_software_by_endpoint',
      'list_installed_software_by_logical_group',
      'list_installed_software_by_universal_dynamic_group',
    ]);
    expect(names).toHaveLength(19);
    expect(names).toContain('list_software_bundles');
  });
});

// ── TOK-24 ───────────────────────────────────────────────────────────────────

describe('TOK-24 — the installed-software projection', () => {
  it('drops the echoed endpointId, the constant columns and the null AUT block, losslessly', async () => {
    const client = await connect('26R1');
    nextResult = page(20);
    const { json } = await callJson(client, 'list_installed_software_by_endpoint', {
      endpointId: ENDPOINT_ID,
    });

    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      for (const gone of [
        'endpointId',
        'endpointName',
        'autFirstUse',
        'autLastUse',
        'autLastData',
        'autUsage',
        'category',
      ]) {
        expect(row, `${gone} must not survive on the row`).not.toHaveProperty(gone);
      }
      // What the caller actually asked "what is installed" for.
      expect(row).toHaveProperty('name');
      expect(row).toHaveProperty('vendor');
      expect(row).toHaveProperty('version');
    }

    // Lossless: every dropped value is still in the response, once.
    const meta = json.meta as Record<string, Record<string, unknown>>;
    expect(meta.projection).toBe('compact');
    expect(meta.echoed).toEqual({ endpointId: ENDPOINT_ID });
    expect(meta.constant).toMatchObject({
      endpointName: 'WORKSTATION1',
      autUsage: 'AutDeactivated',
      autFirstUse: null,
      autLastUse: null,
      autLastData: null,
      category: null,
    });

    // The envelope survives — it is how the caller knows to page.
    expect(json.totalItems).toBe(130);
    expect(json.totalPages).toBe(7);
    expect(json.pageSize).toBe(20);
  });

  it('saves more than half the page (measured, not asserted by hand)', async () => {
    const client = await connect('26R1');
    nextResult = page(20);
    const compact = await callJson(client, 'list_installed_software_by_endpoint', {
      endpointId: ENDPOINT_ID,
    });
    const raw = JSON.stringify(page(20));

    const before = bytes(raw);
    const after = bytes(compact.text);
    const rowBefore = bytes(JSON.stringify(softwareRow(0)));

    // Printed so the numbers in the remediation record can be reproduced.
     
    console.log(
      `TOK-24 measured: row ${rowBefore} B raw; 20-row page ${before} B -> ${after} B ` +
        `(-${(((before - after) / before) * 100).toFixed(1)}%)`
    );

    expect(after).toBeLessThan(before * 0.5);
  });

  it('detail:true returns the API record unchanged, byte for byte', async () => {
    const client = await connect('26R1');
    nextResult = page(20);
    const { text, json } = await callJson(client, 'list_installed_software_by_endpoint', {
      endpointId: ENDPOINT_ID,
      detail: true,
    });

    expect(text).toBe(JSON.stringify(page(20)));
    expect(json).not.toHaveProperty('meta');
    expect((json.data as Record<string, unknown>[])[0]).toHaveProperty('endpointId', ENDPOINT_ID);
  });

  it('fields:[...] overrides the projection', async () => {
    const client = await connect('26R1');
    nextResult = page(20);
    const { json } = await callJson(client, 'list_installed_software_by_endpoint', {
      endpointId: ENDPOINT_ID,
      fields: ['name', 'version'],
    });

    const rows = json.data as Record<string, unknown>[];
    expect(Object.keys(rows[0])).toEqual(['name', 'version']);
    expect((json.meta as Record<string, unknown>).projection).toBe('fields');
  });

  it('a one-row page is not eaten by constant-column detection', async () => {
    const client = await connect('26R1');
    nextResult = page(1);
    const { json } = await callJson(client, 'list_installed_windows_software', { PageSize: 1 });

    const row = (json.data as Record<string, unknown>[])[0];
    // Nothing is constant "across the page" when the page is one row: the
    // guard keeps the answer intact.
    expect(row).toHaveProperty('vendor');
    expect(row).toHaveProperty('autUsage', 'AutDeactivated');
    expect(row).toHaveProperty('endpointName', 'WORKSTATION1');
  });

  it('shaping flags are this server’s, and never reach bConnect', async () => {
    const client = await connect('26R1');
    nextResult = page(20);
    await callJson(client, 'list_installed_software_by_endpoint', {
      endpointId: ENDPOINT_ID,
      PageSize: 20,
      fields: ['name'],
      detail: false,
    });

    expect(calls).toHaveLength(1);
    const params = calls[0].args[1] as Record<string, unknown>;
    expect(params).toEqual({ PageSize: 20 });
  });

  it('bundle lists keep their raw passthrough — the projection is per tool', async () => {
    const client = await connect('26R1');
    nextResult = { data: [{ id: 'a', name: 'Office', folderId: null }, { id: 'b', name: 'Chrome', folderId: null }] };
    const { json } = await callJson(client, 'list_software_bundles', {});

    expect(json).not.toHaveProperty('meta');
    expect((json.data as Record<string, unknown>[])[0]).toHaveProperty('folderId', null);
  });
});

// ── TOK-25 ───────────────────────────────────────────────────────────────────

describe('TOK-25 — countOnly', () => {
  it('asks past the end of the set and returns the count without a row', async () => {
    const client = await connect('26R1');
    nextResult = { currentPage: 100000, pageSize: 1, totalPages: 130, totalItems: 130, data: [] };
    const { json, text } = await callJson(client, 'list_installed_software_by_endpoint', {
      endpointId: ENDPOINT_ID,
      countOnly: true,
      Category: 'Browser',
    });

    const params = calls[0].args[1] as Record<string, unknown>;
    expect(params.Page).toBe(100000);
    expect(params.PageSize).toBe(1);
    expect(params.Category, 'the caller’s filters must survive').toBe('Browser');
    expect(params).not.toHaveProperty('countOnly');

    expect(json).toEqual({ totalItems: 130, filters: { Category: 'Browser' } });
    expect(bytes(text)).toBeLessThan(200);
  });

  it('is offered on the bundle lists too', async () => {
    const client = await connect('26R1');
    nextResult = { totalItems: 4, data: [] };
    const { json } = await callJson(client, 'list_bundle_folders', { countOnly: true });
    expect(json).toEqual({ totalItems: 4 });
  });

  it('a route that returns no totalItems says so instead of guessing', async () => {
    const client = await connect('26R1');
    nextResult = { data: [] };
    const { json } = await callJson(client, 'list_installed_windows_software', { countOnly: true });
    expect(json.totalItems).toBeNull();
    expect(json.note).toMatch(/did not return totalItems/i);
  });
});

// ── INT-53 ───────────────────────────────────────────────────────────────────

describe('INT-53 — one error channel', () => {
  it('404 comes back as a readable isError result, not a protocol error', async () => {
    const client = await connect('26R1');
    nextResult = new BConnectApiError(404, 'Resource not found. GET /software/v2.0/WindowsEndpoints/...', {
      method: 'GET',
      path: '/software/v2.0/WindowsEndpoints',
    });

    const result = (await client.callTool({
      name: 'list_installed_software_by_endpoint',
      arguments: { endpointId: ENDPOINT_ID },
    })) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Resource not found.');
    expect(result.content[0].text).not.toMatch(/^MCP error/);
  });

  it('403 comes back as an isError result', async () => {
    const client = await connect('26R1');
    nextResult = new BConnectApiError(403, 'Access denied. Insufficient permissions for this operation.');
    const { isError, text } = await callText(client, 'list_installed_windows_software', {});
    expect(isError).toBe(true);
    expect(text).toContain('Access denied.');
  });

  it('500 stays a protocol error — no argument the model picks can fix it', async () => {
    const client = await connect('26R1');
    nextResult = new BConnectApiError(500, 'bConnect API returned an internal server error.');

    await expect(
      client.callTool({ name: 'list_installed_windows_software', arguments: {} })
    ).rejects.toThrow(/Tool execution failed: bConnect API returned an internal server error\./);
  });

  it('401 stays a protocol error', async () => {
    const client = await connect('26R1');
    nextResult = new BConnectApiError(401, 'Authentication failed. Check BCONNECT_USERNAME and BCONNECT_PASSWORD.');

    await expect(
      client.callTool({ name: 'list_installed_windows_software', arguments: {} })
    ).rejects.toThrow(/Authentication failed\./);
  });

  it('the unknown-tool and validation protocol errors are rethrown untouched', async () => {
    const client = await connect('26R1');
    await expect(client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toThrow(
      /Unknown tool: no_such_tool/
    );
    await expect(
      client.callTool({ name: 'list_installed_software_by_endpoint', arguments: { endpointId: 'nope' } })
    ).rejects.toThrow(/guid/i);
  });
});

// ── Validation of the new parameters ─────────────────────────────────────────

describe('the new shaping parameters are validated', () => {
  it('detail must be a boolean', async () => {
    const client = await connect('26R1');
    await expect(
      client.callTool({
        name: 'list_installed_windows_software',
        arguments: { detail: 'true' },
      })
    ).rejects.toThrow(/detail must be of type boolean/i);
  });

  it('countOnly must be a boolean', async () => {
    const client = await connect('26R1');
    await expect(
      client.callTool({ name: 'list_bundle_applications', arguments: { countOnly: 'yes' } })
    ).rejects.toThrow(/countOnly must be of type boolean/i);
  });

  it('fields must be an array', async () => {
    const client = await connect('26R1');
    await expect(
      client.callTool({ name: 'list_installed_windows_software', arguments: { fields: 'name' } })
    ).rejects.toThrow(/fields must be of type array/i);
  });
});
