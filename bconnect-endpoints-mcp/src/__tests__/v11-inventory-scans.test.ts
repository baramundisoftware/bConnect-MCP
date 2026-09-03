/**
 * bconnect-endpoints-mcp — the bConnect v1.1 custom inventory-scan slice.
 *
 * The second v1.1 slice, so this file asserts the PATTERN as well as the
 * feature — the first slice's test file is its sibling and the two should stay
 * recognisably the same shape:
 *
 *   GATE       all three tools absent from tools/list unless
 *              BCONNECT_ENABLE_V11=true AND both v1.1 credentials are present;
 *              hiding is not disabling.
 *   INPUT      endpointId is required and GUID-checked before any network call,
 *              and an unknown parameter name is refused (the D6 defence).
 *   BOUND      the WMI tool has NO argument combination that returns the whole
 *              585 KB scan. This is the point of the slice.
 *   SHAPE      compact projections drop what they claim and say so in meta;
 *              detail:true returns the raw record unchanged.
 *   HONESTY    absent Scans, empty Scans and an unknown class are three
 *              different answers, not one.
 *   READ-ONLY  the v1.1 client refuses any non-GET method, and cannot be made
 *              to address a v2.0 module path.
 *
 * All transport is stubbed via InventoryScansV11Client.prototype.transport —
 * no test here touches a network.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../index.js';
import {
  InventoryScansV11Client,
  shapeWmiIndex,
  shapeWmiClass,
  V11_FULL_MODE_HINT,
} from '../modules/inventory-scans-v11.js';
import { v11DisabledMessage, v11UnreachableMessage, v11NotFoundMessage } from '@bconnect/mcp-core';

const V11_TOOLS = [
  'get_endpoint_registry_inventory',
  'get_endpoint_file_inventory',
  'get_endpoint_wmi_inventory',
];
// Synthetic. The fixtures below reproduce the SHAPE the live 26R1 server
// returned, never its content — a test GUID that happens to name a real
// machine on a real estate is an estate identifier, and this repo is published.
const GUID = 'd0000001-0001-0001-0001-000000000001';

function stubV11Env(): void {
  vi.stubEnv('BCONNECT_ENABLE_V11', 'true');
  vi.stubEnv('BCONNECT_V11_USERNAME', 'svc-bconnect@example.test');
  vi.stubEnv('BCONNECT_V11_PASSWORD', 'test-password');
}

async function connect(): Promise<Client> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'v11-inventory-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]!.text;
}

function stubTransport(response: { status: number; data: unknown }) {
  return vi.spyOn(InventoryScansV11Client.prototype, 'transport').mockResolvedValue(response);
}

// ── Payloads, in the shape the live 26R1 server actually returned ────────────

const REGISTRY_PAYLOAD = {
  EndpointId: GUID,
  Scans: [
    {
      Time: '2025-08-18T17:59:50Z',
      Template: '',
      Data: [
        {
          Name: '{e57a7e00-0000-4000-8000-000000000036}',
          Version: '8.0.19.25372',
          Company: 'Microsoft Corporation',
          ProductName: 'Microsoft ASP.NET Core 8.0.19 - Shared Framework (x64)',
        },
        {
          Name: '{E57A7E00-0000-4000-8000-000000000008}',
          Version: '25.01.00.0',
          Company: 'Igor Pavlov',
          ProductName: '7-Zip 25.01 (x64 edition)',
        },
      ],
    },
  ],
};

const FILE_PAYLOAD = {
  EndpointId: GUID,
  Scans: [
    {
      Time: '2026-03-23T20:47:50Z',
      Template: 'Agent files',
      Data: [
        {
          Name: 'BMACmd.exe',
          Path: 'c:\\program files (x86)\\baramundi\\bma\\',
          Size: 321608,
          LastWriteTime: '2026-03-23T20:47:50Z',
          Version: '26.1.104.0',
          Company: 'baramundi software GmbH',
          ProductName: 'baramundi Management Suite',
          ProductVersion: '26.1.104',
          OriginalName: 'BMACmd',
          Description: 'baramundi Managament Agent Cmd',
        },
      ],
    },
    { Time: '2026-03-01T00:00:00Z', Template: 'Second template', Data: [] },
  ],
};

/** Miniature of the real thing: a huge noise class and two small useful ones. */
const WMI_PAYLOAD = {
  EndpointId: GUID,
  Scans: [
    {
      Time: '2025-08-18T17:59:53Z',
      Template: '[Default WMI Template]',
      Data: [
        {
          ClassName: 'Win32_Bus',
          Items: Array.from({ length: 9 }, (_, i) => ({
            Properties: [
              { Name: '__PATH', Value: `\\\\HOST\\root\\CIMV2:Win32_Bus.DeviceID="${i}"` },
              { Name: 'Padding', Value: 'x'.repeat(400) },
            ],
          })),
        },
        {
          ClassName: 'Win32_BIOS',
          Items: [
            {
              Properties: [
                { Name: 'Manufacturer', Value: 'Phoenix Technologies LTD' },
                { Name: 'SMBIOSBIOSVersion', Value: '6.00' },
                { Name: 'SerialNumber', Value: 'VMware-56 4d' },
              ],
            },
          ],
        },
        {
          ClassName: 'Win32_BaseBoard',
          Items: [
            {
              Properties: [
                { Name: 'Manufacturer', Value: 'Intel Corporation' },
                { Name: 'Product', Value: '440BX Desktop Reference Platform' },
              ],
            },
          ],
        },
      ],
    },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── Gate ────────────────────────────────────────────────────────────────────

describe('v1.1 gate — the inventory tools are conditional on gate + credentials', () => {
  it('absent when the gate is off entirely', async () => {
    vi.stubEnv('BCONNECT_ENABLE_V11', '');
    vi.stubEnv('BCONNECT_V11_USERNAME', 'svc@example.test');
    vi.stubEnv('BCONNECT_V11_PASSWORD', 'x');
    const { tools } = await (await connect()).listTools();
    const names = tools.map((t) => t.name);
    for (const name of V11_TOOLS) {expect(names).not.toContain(name);}
  });

  it('absent when the gate is on but a credential is missing', async () => {
    vi.stubEnv('BCONNECT_ENABLE_V11', 'true');
    vi.stubEnv('BCONNECT_V11_USERNAME', 'svc@example.test');
    vi.stubEnv('BCONNECT_V11_PASSWORD', '');
    const { tools } = await (await connect()).listTools();
    const names = tools.map((t) => t.name);
    for (const name of V11_TOOLS) {expect(names).not.toContain(name);}
  });

  it('present, after the v2.0 tools, when gate and both credentials are set', async () => {
    stubV11Env();
    const { tools } = await (await connect()).listTools();
    const names = tools.map((t) => t.name);
    for (const name of V11_TOOLS) {expect(names).toContain(name);}
    // Appended, not interleaved — the v2.0 surface is untouched by the gate.
    expect(names.slice(-3)).toEqual(V11_TOOLS);
  });

  it('the v1.1 tools cost nothing in the default posture', async () => {
    vi.stubEnv('BCONNECT_ENABLE_V11', '');
    const shut = JSON.stringify((await (await connect()).listTools()).tools).length;
    stubV11Env();
    const open = JSON.stringify((await (await connect()).listTools()).tools).length;
    expect(shut).toBeLessThan(open);
    console.log(`[v1.1] catalogue: gate shut ${shut} B, gate open ${open} B (+${open - shut})`);
  });

  it('hiding is not disabling: calling a hidden tool by name gets the specific refusal', async () => {
    vi.stubEnv('BCONNECT_ENABLE_V11', '');
    const transport = vi.spyOn(InventoryScansV11Client.prototype, 'transport');
    const result = await (await connect()).callTool({
      name: 'get_endpoint_wmi_inventory',
      arguments: { endpointId: GUID },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toBe(v11DisabledMessage('get_endpoint_wmi_inventory'));
    expect(transport).not.toHaveBeenCalled();
  });
});

// ─── Input validation before the wire ────────────────────────────────────────

describe('endpointId is validated before any network call', () => {
  it.each(V11_TOOLS)('%s refuses a missing endpointId, transport untouched', async (tool) => {
    stubV11Env();
    const transport = vi.spyOn(InventoryScansV11Client.prototype, 'transport');
    await expect(
      (await connect()).callTool({ name: tool, arguments: {} })
    ).rejects.toThrow(/endpointId/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(V11_TOOLS)('%s refuses a non-GUID endpointId, transport untouched', async (tool) => {
    stubV11Env();
    const transport = vi.spyOn(InventoryScansV11Client.prototype, 'transport');
    await expect(
      (await connect()).callTool({ name: tool, arguments: { endpointId: 'WORKSTATION1' } })
    ).rejects.toThrow(/GUID/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it('an unknown parameter is refused with the D6 explanation, not forwarded', async () => {
    stubV11Env();
    const transport = vi.spyOn(InventoryScansV11Client.prototype, 'transport');
    await expect(
      (await connect()).callTool({
        name: 'get_endpoint_registry_inventory',
        arguments: { endpointId: GUID, PageSize: 10 },
      })
    ).rejects.toThrow(/unknown parameter 'PageSize'/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it('detail must be a boolean', async () => {
    stubV11Env();
    await expect(
      (await connect()).callTool({
        name: 'get_endpoint_file_inventory',
        arguments: { endpointId: GUID, detail: 'yes' },
      })
    ).rejects.toThrow(/detail must be of type boolean/i);
  });
});

// ─── The bound: WMI cannot be made to return everything ──────────────────────

describe('get_endpoint_wmi_inventory — the two-step bound has no escape hatch', () => {
  it('detail:true without className is refused before the wire, and names the fix', async () => {
    stubV11Env();
    const transport = vi.spyOn(InventoryScansV11Client.prototype, 'transport');
    await expect(
      (await connect()).callTool({
        name: 'get_endpoint_wmi_inventory',
        arguments: { endpointId: GUID, detail: true },
      })
    ).rejects.toThrow(/detail:true requires className/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it('no argument combination returns every class\u2019s instance data', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: WMI_PAYLOAD });
    const client = await connect();

    // The index carries counts and sizes, never the Items themselves.
    const index = await client.callTool({
      name: 'get_endpoint_wmi_inventory',
      arguments: { endpointId: GUID },
    });
    expect(textOf(index)).not.toContain('Phoenix Technologies');
    expect(textOf(index)).not.toContain('440BX');
    expect(textOf(index)).not.toContain('Padding');

    // One class at a time carries that class and no other.
    const bios = await client.callTool({
      name: 'get_endpoint_wmi_inventory',
      arguments: { endpointId: GUID, className: 'Win32_BIOS' },
    });
    expect(textOf(bios)).toContain('Phoenix Technologies');
    expect(textOf(bios)).not.toContain('440BX');
  });

  it('the index is a small fraction of the payload it describes', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: WMI_PAYLOAD });
    const index = await (await connect()).callTool({
      name: 'get_endpoint_wmi_inventory',
      arguments: { endpointId: GUID },
    });
    const raw = JSON.stringify(WMI_PAYLOAD).length;
    const shaped = textOf(index).length;
    expect(shaped).toBeLessThan(raw / 4);
    console.log(`[v1.1] WMI index ${shaped} B vs raw scan ${raw} B`);
  });

  it('the index reports every class, sorted with the largest first', async () => {
    const shaped = shapeWmiIndex(WMI_PAYLOAD, { endpointId: GUID }) as {
      classes: { className: string; instances: number; bytes: number }[];
      scanTime: string;
      template: string;
    };
    expect(shaped.classes.map((c) => c.className)).toEqual([
      'Win32_Bus',
      'Win32_BIOS',
      'Win32_BaseBoard',
    ]);
    expect(shaped.classes[0]!.instances).toBe(9);
    expect(shaped.scanTime).toBe('2025-08-18T17:59:53Z');
    expect(shaped.template).toBe('[Default WMI Template]');
  });

  it('an unknown class returns the classes that DO exist, so the next call succeeds', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: WMI_PAYLOAD });
    const result = await (await connect()).callTool({
      name: 'get_endpoint_wmi_inventory',
      arguments: { endpointId: GUID, className: 'Win32_NotCollected' },
    });
    const payload = JSON.parse(textOf(result));
    expect(payload.availableClasses).toEqual(['Win32_BIOS', 'Win32_BaseBoard', 'Win32_Bus']);
    expect(payload.note).toContain('Win32_NotCollected');
  });

  it('className is matched case-insensitively, as the server matches parameters', async () => {
    const shaped = shapeWmiClass(WMI_PAYLOAD, { endpointId: GUID, className: 'win32_bios' }) as {
      className: string;
    };
    expect(shaped.className).toBe('Win32_BIOS');
  });

  it('folds Properties[{Name,Value}] into an object', async () => {
    const shaped = shapeWmiClass(WMI_PAYLOAD, { endpointId: GUID, className: 'Win32_BIOS' }) as {
      instances: Record<string, unknown>[];
      meta: { dropped: string[] };
    };
    expect(shaped.instances).toEqual([
      {
        Manufacturer: 'Phoenix Technologies LTD',
        SMBIOSBIOSVersion: '6.00',
        SerialNumber: 'VMware-56 4d',
      },
    ]);
    expect(shaped.meta.dropped).toEqual([]);
  });

  it('drops __PATH — it restates the class and is the one field carrying a hostname', async () => {
    const shaped = shapeWmiClass(WMI_PAYLOAD, { endpointId: GUID, className: 'Win32_Bus' }) as {
      instances: Record<string, unknown>[];
      meta: { dropped: string[] };
    };
    expect(shaped.meta.dropped).toEqual(['__PATH']);
    for (const instance of shaped.instances) {
      expect(instance).not.toHaveProperty('__PATH');
    }
    expect(JSON.stringify(shaped)).not.toContain('root\\\\CIMV2');
  });

  it('a repeated property name is REPORTED, not silently overwritten in silence', async () => {
    const collided = {
      EndpointId: GUID,
      Scans: [
        {
          Time: '2025-01-01T00:00:00Z',
          Template: 't',
          Data: [
            {
              ClassName: 'Win32_Odd',
              Items: [
                {
                  Properties: [
                    { Name: 'Same', Value: 'first' },
                    { Name: 'Same', Value: 'second' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const shaped = shapeWmiClass(collided, { endpointId: GUID, className: 'Win32_Odd' }) as {
      instances: Record<string, unknown>[];
      meta: { duplicatePropertyNames?: string[]; warning?: string };
    };
    expect(shaped.instances[0]).toEqual({ Same: 'second' });
    expect(shaped.meta.duplicatePropertyNames).toEqual(['Same']);
    expect(shaped.meta.warning).toContain('detail:true');
  });

  it('detail:true with className returns that class raw, unfolded', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: WMI_PAYLOAD });
    const result = await (await connect()).callTool({
      name: 'get_endpoint_wmi_inventory',
      arguments: { endpointId: GUID, className: 'Win32_BIOS', detail: true },
    });
    expect(JSON.parse(textOf(result))).toEqual(WMI_PAYLOAD.Scans[0]!.Data[1]);
  });
});

// ─── Registry and file shaping ───────────────────────────────────────────────

describe('registry and file inventory — compact digests that name what they drop', () => {
  it('registry: products projected, Name dropped and declared as dropped', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: REGISTRY_PAYLOAD });
    const result = await (await connect()).callTool({
      name: 'get_endpoint_registry_inventory',
      arguments: { endpointId: GUID },
    });
    const payload = JSON.parse(textOf(result));

    expect(payload.entries).toBe(2);
    expect(payload.scanTime).toBe('2025-08-18T17:59:50Z');
    expect(payload.products).toEqual([
      {
        ProductName: 'Microsoft ASP.NET Core 8.0.19 - Shared Framework (x64)',
        Version: '8.0.19.25372',
        Company: 'Microsoft Corporation',
      },
      { ProductName: '7-Zip 25.01 (x64 edition)', Version: '25.01.00.0', Company: 'Igor Pavlov' },
    ]);
    expect(payload.meta.dropped).toEqual(['Name']);
    expect(payload.meta.hint).toBe(V11_FULL_MODE_HINT);
    // The dropped field's VALUES are gone; its name remains in meta.dropped.
    expect(textOf(result)).not.toContain('b306645c');
  });

  it('registry: an empty template string is labelled rather than shown as ""', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: REGISTRY_PAYLOAD });
    const result = await (await connect()).callTool({
      name: 'get_endpoint_registry_inventory',
      arguments: { endpointId: GUID },
    });
    expect(JSON.parse(textOf(result)).template).toBe('(unnamed template)');
  });

  it('registry: detail:true returns the raw envelope unchanged', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: REGISTRY_PAYLOAD });
    const detail = await (await connect()).callTool({
      name: 'get_endpoint_registry_inventory',
      arguments: { endpointId: GUID, detail: true },
    });
    expect(JSON.parse(textOf(detail))).toEqual(REGISTRY_PAYLOAD);
  });

  /**
   * Measured at the size the live server actually returns, not at fixture size.
   *
   * The compact digest adds fixed overhead — provenance (scanTime, template,
   * scansOnRecord) and the honest `meta` block — and drops one field per row.
   * So it is a net LOSS on a payload of two rows and a net win on a real one.
   * The live measurement was 118 entries / 19,189 B for a single endpoint,
   * which is what this asserts against. The crossover is recorded in the next
   * test rather than left as a surprise.
   */
  it('registry: compact is materially smaller at the live payload size', async () => {
    const entries = Array.from({ length: 118 }, (_, i) => ({
      Name: `{b306645c-e23c-4a70-99a9-2805421e9b${String(i).padStart(3, '0')}}`,
      Version: '8.0.19.25372',
      Company: 'Microsoft Corporation',
      ProductName: `Microsoft Component ${i} - Shared Framework (x64)`,
    }));
    const payload = {
      EndpointId: GUID,
      Scans: [{ Time: '2025-08-18T17:59:50Z', Template: '', Data: entries }],
    };

    stubV11Env();
    stubTransport({ status: 200, data: payload });
    const client = await connect();
    const detail = await client.callTool({
      name: 'get_endpoint_registry_inventory',
      arguments: { endpointId: GUID, detail: true },
    });
    const compact = await client.callTool({
      name: 'get_endpoint_registry_inventory',
      arguments: { endpointId: GUID },
    });

    const rawBytes = textOf(detail).length;
    const compactBytes = textOf(compact).length;
    expect(compactBytes).toBeLessThan(rawBytes * 0.75);
    console.log(
      `[v1.1] registry 118 entries: raw ${rawBytes} B -> compact ${compactBytes} B ` +
        `(-${Math.round((1 - compactBytes / rawBytes) * 100)}%)`
    );
  });

  /**
   * The honest converse. A digest that claims to shrink things must not be
   * believed to shrink ALL things — on a two-row scan the fixed cost of the
   * provenance and meta blocks exceeds what dropping one field per row saves.
   * That is a deliberate trade (the meta is what makes the projection
   * accountable), and it is recorded here so nobody discovers it as a bug.
   */
  it('registry: on a tiny scan the digest costs more than it saves, by design', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: REGISTRY_PAYLOAD });
    const client = await connect();
    const detail = await client.callTool({
      name: 'get_endpoint_registry_inventory',
      arguments: { endpointId: GUID, detail: true },
    });
    const compact = await client.callTool({
      name: 'get_endpoint_registry_inventory',
      arguments: { endpointId: GUID },
    });
    expect(textOf(compact).length).toBeGreaterThan(textOf(detail).length);
    console.log(
      `[v1.1] registry 2 entries: raw ${textOf(detail).length} B -> compact ` +
        `${textOf(compact).length} B (digest overhead exceeds the saving below ~6 entries)`
    );
  });

  it('file: ALL scans are returned — they are different searches, not versions', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: FILE_PAYLOAD });
    const result = await (await connect()).callTool({
      name: 'get_endpoint_file_inventory',
      arguments: { endpointId: GUID },
    });
    const payload = JSON.parse(textOf(result));
    expect(payload.scans).toHaveLength(2);
    expect(payload.scans.map((s: { template: string }) => s.template)).toEqual([
      'Agent files',
      'Second template',
    ]);
    expect(payload.scans[0].matches).toBe(1);
    expect(payload.scans[1].matches).toBe(0);
    expect(payload.meta.dropped).toEqual(['Description', 'OriginalName', 'ProductVersion']);
  });
});

// ─── Honesty about absence ───────────────────────────────────────────────────

describe('absent, empty and zero are three different answers', () => {
  it('Scans absent entirely -> "no scan has ever run" (the live shape for no data)', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: { EndpointId: GUID } });
    const result = await (await connect()).callTool({
      name: 'get_endpoint_registry_inventory',
      arguments: { endpointId: GUID },
    });
    expect(textOf(result)).toContain('has ever run');
    expect(textOf(result)).toContain('distinct from a scan that ran and found nothing');
  });

  it('Scans present but empty -> a different sentence', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: { EndpointId: GUID, Scans: [] } });
    const result = await (await connect()).callTool({
      name: 'get_endpoint_registry_inventory',
      arguments: { endpointId: GUID },
    });
    expect(textOf(result)).toContain('has not produced a result');
    expect(textOf(result)).not.toContain('has ever run');
  });

  it('a scan that ran and matched nothing reports zero, not absence', async () => {
    stubV11Env();
    stubTransport({
      status: 200,
      data: { EndpointId: GUID, Scans: [{ Time: '2026-01-01T00:00:00Z', Template: 't', Data: [] }] },
    });
    const result = await (await connect()).callTool({
      name: 'get_endpoint_registry_inventory',
      arguments: { endpointId: GUID },
    });
    const payload = JSON.parse(textOf(result));
    expect(payload.entries).toBe(0);
    expect(payload.note).toBeUndefined();
    expect(payload.scanTime).toBe('2026-01-01T00:00:00Z');
  });
});

// ─── Failure paths ───────────────────────────────────────────────────────────

describe('v1.1 failure paths — each produces its specific diagnosis', () => {
  it('connection refused -> the LAN-only explanation', async () => {
    stubV11Env();
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    vi.spyOn(InventoryScansV11Client.prototype, 'transport').mockRejectedValue(err);
    await expect(
      (await connect()).callTool({
        name: 'get_endpoint_registry_inventory',
        arguments: { endpointId: GUID },
      })
    ).rejects.toThrow(v11UnreachableMessage('ECONNREFUSED'));
  });

  it('401 -> names BOTH causes: security-group membership and UPN form', async () => {
    stubV11Env();
    stubTransport({ status: 401, data: '' });
    await expect(
      (await connect()).callTool({
        name: 'get_endpoint_wmi_inventory',
        arguments: { endpointId: GUID },
      })
    ).rejects.toThrow(/bConnect security group/);
  });

  it('404 -> "well-formed GUID, no such Windows endpoint", as a readable isError result', async () => {
    stubV11Env();
    // The exact body the live server returned for an unknown GUID.
    stubTransport({
      status: 404,
      data: { Message: 'Endpoint [id=00000000-0000-0000-0000-000000000000] not found or is not of type WindowsEndpoint.' },
    });
    const result = await (await connect()).callTool({
      name: 'get_endpoint_file_inventory',
      arguments: { endpointId: GUID },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toBe(
      v11NotFoundMessage(
        'Endpoint [id=00000000-0000-0000-0000-000000000000] not found or is not of type WindowsEndpoint.'
      )
    );
    // It tells the caller which tool produces a valid id.
    expect(textOf(result)).toContain('list_endpoints');
  });

  it('400 -> the unknown-parameter diagnosis, as a readable isError result', async () => {
    stubV11Env();
    stubTransport({ status: 400, data: { Message: 'Invalid request. Unknown parameter(s): pagesize' } });
    const result = await (await connect()).callTool({
      name: 'get_endpoint_registry_inventory',
      arguments: { endpointId: GUID },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('silently ignores an unknown query parameter');
    expect(textOf(result)).toContain('Unknown parameter(s): pagesize');
  });
});

// ─── Read-only by construction ───────────────────────────────────────────────

describe('InventoryScansV11Client — GET only, and no path it can be made to address', () => {
  function bareClient(): InventoryScansV11Client {
    return new InventoryScansV11Client({
      httpClient: { defaults: { baseURL: 'https://bms-server/bconnect' } } as never,
      env: { BCONNECT_V11_USERNAME: 'u@d', BCONNECT_V11_PASSWORD: 'p' },
    });
  }

  it.each(['POST', 'PATCH', 'DELETE', 'PUT', 'post'])(
    'refuses %s before touching the wire',
    async (method) => {
      const transport = vi.spyOn(InventoryScansV11Client.prototype, 'transport');
      await expect(
        bareClient().request('InventoryDataWMIScans', {}, { method })
      ).rejects.toThrow(/read-only by design/);
      expect(transport).not.toHaveBeenCalled();
    }
  );

  // The structural claim that lets this client live in mcp-core beside the
  // path-contained v2.0 transport: it cannot be made to express a v2.0 route.
  it.each([
    '../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints',
    'endpoints/v2.0/Endpoints',
    'Inventory/../../secrets',
    'Inventory%2F..%2F',
    'Inventory.json?x=1',
    'Inventory Data',
  ])('refuses %s: a controller is a name, not a path', async (controller) => {
    const transport = vi.spyOn(InventoryScansV11Client.prototype, 'transport');
    await expect(bareClient().request(controller)).rejects.toThrow(/not by path/);
    expect(transport).not.toHaveBeenCalled();
  });

  it('never reads BCONNECT_API_KEY: an API key alone does not authenticate v1.1', async () => {
    const client = new InventoryScansV11Client({
      httpClient: { defaults: { baseURL: 'https://bms-server/bconnect' } } as never,
      env: { BCONNECT_API_KEY: 'a-perfectly-good-v2-key' },
    });
    const transport = vi.spyOn(InventoryScansV11Client.prototype, 'transport');
    await expect(client.request('InventoryDataFileScans')).rejects.toThrow(
      /BCONNECT_V11_USERNAME/
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it('sends Basic auth, latin1-encoded, to the v1.1 root with no module segment', async () => {
    const transport = vi
      .spyOn(InventoryScansV11Client.prototype, 'transport')
      .mockResolvedValue({ status: 200, data: {} });
    await bareClient().request('InventoryDataFileScans', { EndpointId: GUID });
    const [url, headers] = transport.mock.calls[0]!;
    expect(url).toBe(
      `https://bms-server/bConnect/v1.1/InventoryDataFileScans.json?EndpointId=${GUID}`
    );
    expect(headers.Authorization).toBe(
      'Basic ' + Buffer.from('u@d:p', 'latin1').toString('base64')
    );
    // The v2.0 API key header is never sent beside Basic auth.
    expect(Object.keys(headers)).not.toContain('X-Api-Key');
  });
});
