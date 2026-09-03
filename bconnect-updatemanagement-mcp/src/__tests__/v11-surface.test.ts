/**
 * bconnect-updatemanagement-mcp — the bConnect v1.1 Microsoft Update slice.
 *
 * The first v1.1 capability slice, and the pattern the rest of the v1.1 work
 * copies — so this file asserts the pattern, not just the feature:
 *
 *   GATE      both tools absent from tools/list unless BCONNECT_ENABLE_V11=true
 *             AND both v1.1 credentials are present; hiding is not disabling.
 *   INPUT     get_endpoint_microsoft_update_inventory refuses a missing/non-GUID
 *             endpointId before any network call.
 *   SHAPE     compact digest drops what it claims and says so in meta;
 *             detail:true returns the raw endpoint record unchanged.
 *   FAILURE   the three diagnosable failure modes (LAN-only unreachable,
 *             401 security-group/UPN, 400 unknown-parameter) each produce
 *             their specific message, not a generic error.
 *   READ-ONLY the v1.1 client refuses any non-GET method by construction.
 *
 * All transport is stubbed via MicrosoftUpdateV11Client.prototype.transport —
 * no test here touches a network.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../index.js';
import {
  MicrosoftUpdateV11Client,
  v11DisabledMessage,
  v11UnreachableMessage,
  v11BadRequestMessage,
  V11_FULL_MODE_HINT,
} from '../modules/microsoft-update-v11.js';

const V11_TOOLS = ['list_microsoft_update_profiles', 'get_endpoint_microsoft_update_inventory'];
const READ_TOOLS = ['list_update_management_endpoints', 'get_update_management_endpoint'];
const GUID = 'd0000001-0001-0001-0001-000000000001';

function stubV11Env(): void {
  vi.stubEnv('BCONNECT_ENABLE_V11', 'true');
  vi.stubEnv('BCONNECT_V11_USERNAME', 'svc-bconnect@labcorp.local');
  vi.stubEnv('BCONNECT_V11_PASSWORD', 'test-password');
}

async function connect(): Promise<Client> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'v11-surface-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]!.text;
}

/** A plausible one-endpoint MicrosoftUpdateInventories payload, in miniature. */
const RAW_UPDATE_FIELDS = {
  RevisionNumber: 200,
  Type: 'Software',
  SupportURL: 'https://support.microsoft.com/help/5034441',
  Products: ['Windows 11'],
  InstallationDeadline: '2026-08-10T00:00:00Z',
  LastDeploymentChangeTime: '2026-07-20T00:00:00Z',
};
const INVENTORY_PAYLOAD = {
  Endpoints: [
    {
      EndpointID: GUID,
      UpdateInformation: [
        { IsInstalled: true, UpdateId: 'u-1', Title: 'Installed A', Classification: 'Security Updates', MsrcSeverity: 'Critical', ...RAW_UPDATE_FIELDS },
        { IsInstalled: true, UpdateId: 'u-2', Title: 'Installed B', Classification: 'Updates', MsrcSeverity: null, ...RAW_UPDATE_FIELDS },
        { IsInstalled: false, UpdateId: 'u-3', Title: 'Missing critical', Classification: 'Security Updates', MsrcSeverity: 'Critical', ...RAW_UPDATE_FIELDS },
        { IsInstalled: false, UpdateId: 'u-4', Title: 'Missing important', Classification: 'Security Updates', MsrcSeverity: 'Important', ...RAW_UPDATE_FIELDS },
        { IsInstalled: false, UpdateId: 'u-5', Title: 'Missing unrated', Classification: 'Updates', MsrcSeverity: null, ...RAW_UPDATE_FIELDS },
      ],
    },
  ],
};

function stubTransport(response: { status: number; data: unknown }) {
  return vi
    .spyOn(MicrosoftUpdateV11Client.prototype, 'transport')
    .mockResolvedValue(response);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── Gate ────────────────────────────────────────────────────────────────────

describe('v1.1 gate — tools are conditional on BCONNECT_ENABLE_V11 + credentials', () => {
  it('absent when the gate is off entirely', async () => {
    vi.stubEnv('BCONNECT_ENABLE_V11', '');
    vi.stubEnv('BCONNECT_V11_USERNAME', 'svc-bconnect@labcorp.local');
    vi.stubEnv('BCONNECT_V11_PASSWORD', 'x');
    const { tools } = await (await connect()).listTools();
    const names = tools.map((t) => t.name);
    for (const name of V11_TOOLS) {expect(names).not.toContain(name);}
    expect(names).toEqual(READ_TOOLS); // the pre-existing surface is untouched
  });

  it('absent when the gate is on but a credential is missing', async () => {
    vi.stubEnv('BCONNECT_ENABLE_V11', 'true');
    vi.stubEnv('BCONNECT_V11_USERNAME', 'svc-bconnect@labcorp.local');
    vi.stubEnv('BCONNECT_V11_PASSWORD', '');
    const { tools } = await (await connect()).listTools();
    for (const name of V11_TOOLS) {expect(tools.map((t) => t.name)).not.toContain(name);}
  });

  it('present, after the v2.0 tools, when gate and both credentials are set', async () => {
    stubV11Env();
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual([...READ_TOOLS, ...V11_TOOLS]);
  });

  it('composes with the write gate: full surface is 3 v2.0 + 2 v1.1 tools', async () => {
    stubV11Env();
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual([
      ...READ_TOOLS,
      'update_update_management_endpoint',
      ...V11_TOOLS,
    ]);
  });

  it('hiding is not disabling: calling a hidden v1.1 tool by name gets the specific refusal', async () => {
    vi.stubEnv('BCONNECT_ENABLE_V11', '');
    const transport = vi.spyOn(MicrosoftUpdateV11Client.prototype, 'transport');
    const client = await connect();
    const result = await client.callTool({
      name: 'get_endpoint_microsoft_update_inventory',
      arguments: { endpointId: GUID },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toBe(v11DisabledMessage('get_endpoint_microsoft_update_inventory'));
    expect(transport).not.toHaveBeenCalled();
  });
});

// ─── Input validation before the wire ────────────────────────────────────────

describe('get_endpoint_microsoft_update_inventory — endpointId is validated before any network call', () => {
  it('missing endpointId is refused, transport untouched', async () => {
    stubV11Env();
    const transport = vi.spyOn(MicrosoftUpdateV11Client.prototype, 'transport');
    const client = await connect();
    await expect(
      client.callTool({ name: 'get_endpoint_microsoft_update_inventory', arguments: {} })
    ).rejects.toThrow(/endpointId is required/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it('non-GUID endpointId is refused, transport untouched', async () => {
    stubV11Env();
    const transport = vi.spyOn(MicrosoftUpdateV11Client.prototype, 'transport');
    const client = await connect();
    await expect(
      client.callTool({ name: 'get_endpoint_microsoft_update_inventory', arguments: { endpointId: 'WORKSTATION1' } })
    ).rejects.toThrow(/GUID/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it('detail must be a boolean', async () => {
    stubV11Env();
    const client = await connect();
    await expect(
      client.callTool({
        name: 'get_endpoint_microsoft_update_inventory',
        arguments: { endpointId: GUID, detail: 'yes' },
      })
    ).rejects.toThrow(/detail must be of type boolean/i);
  });
});

// ─── Shaping ─────────────────────────────────────────────────────────────────

describe('get_endpoint_microsoft_update_inventory — compact digest vs detail:true', () => {
  it('compact: counts, missing-critical projection, and meta that names what was dropped', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: INVENTORY_PAYLOAD });
    const client = await connect();
    const result = await client.callTool({
      name: 'get_endpoint_microsoft_update_inventory',
      arguments: { endpointId: GUID },
    });
    const payload = JSON.parse(textOf(result));

    expect(payload.endpointId).toBe(GUID);
    expect(payload.updates).toEqual({ total: 5, installed: 2, missing: 3 });
    expect(payload.missingByClassification).toEqual({ 'Security Updates': 2, Updates: 1 });
    expect(payload.missingBySeverity).toEqual({ Critical: 1, Important: 1, Unspecified: 1 });
    expect(payload.missingCritical).toEqual([
      {
        Title: 'Missing critical',
        UpdateId: 'u-3',
        RevisionNumber: 200,
        Classification: 'Security Updates',
        MsrcSeverity: 'Critical',
        InstallationDeadline: '2026-08-10T00:00:00Z',
      },
    ]);

    // meta follows the mcp-core shape-response conventions.
    expect(payload.meta.projection).toBe('compact');
    expect(payload.meta.hint).toBe(V11_FULL_MODE_HINT);
    expect(payload.meta.hint).toBe('Pass detail:true for the full API record.');
    // What it claims to drop is measured from the payload, and really is gone.
    for (const dropped of ['SupportURL', 'Products', 'LastDeploymentChangeTime', 'Type', 'IsInstalled']) {
      expect(payload.meta.dropped).toContain(dropped);
    }
    // The dropped fields' VALUES are gone (their names remain, in meta.dropped).
    expect(textOf(result)).not.toContain('support.microsoft.com');
    expect(textOf(result)).not.toContain('2026-07-20T00:00:00Z');
    expect(textOf(result)).not.toContain('Windows 11');
  });

  it('detail:true returns the raw endpoint record unchanged, and compact is smaller', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: INVENTORY_PAYLOAD });
    const client = await connect();

    const detail = await client.callTool({
      name: 'get_endpoint_microsoft_update_inventory',
      arguments: { endpointId: GUID, detail: true },
    });
    expect(JSON.parse(textOf(detail))).toEqual(INVENTORY_PAYLOAD.Endpoints[0]);

    const compact = await client.callTool({
      name: 'get_endpoint_microsoft_update_inventory',
      arguments: { endpointId: GUID },
    });
    expect(textOf(compact).length).toBeLessThan(textOf(detail).length);
  });

  it('an empty Endpoints array is answered honestly, not with an empty digest', async () => {
    stubV11Env();
    stubTransport({ status: 200, data: { Endpoints: [] } });
    const client = await connect();
    const result = await client.callTool({
      name: 'get_endpoint_microsoft_update_inventory',
      arguments: { endpointId: GUID },
    });
    expect(textOf(result)).toContain('no Microsoft Update inventory');
  });
});

// ─── The three failure paths ─────────────────────────────────────────────────

describe('v1.1 failure paths — each produces its specific diagnosis', () => {
  it('connection refused -> the LAN-only explanation (fault channel)', async () => {
    stubV11Env();
    const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:443'), { code: 'ECONNREFUSED' });
    vi.spyOn(MicrosoftUpdateV11Client.prototype, 'transport').mockRejectedValue(err);
    const client = await connect();
    await expect(
      client.callTool({ name: 'list_microsoft_update_profiles', arguments: {} })
    ).rejects.toThrow(v11UnreachableMessage('ECONNREFUSED'));
  });

  it('timeout -> the same LAN-only explanation', async () => {
    stubV11Env();
    const err = Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
    vi.spyOn(MicrosoftUpdateV11Client.prototype, 'transport').mockRejectedValue(err);
    const client = await connect();
    await expect(
      client.callTool({ name: 'get_endpoint_microsoft_update_inventory', arguments: { endpointId: GUID } })
    ).rejects.toThrow(/LAN-only/);
  });

  it('401 -> names BOTH causes: security-group membership and UPN form (fault channel)', async () => {
    stubV11Env();
    stubTransport({ status: 401, data: '' });
    const client = await connect();
    const rejection = expect(
      client.callTool({ name: 'list_microsoft_update_profiles', arguments: {} })
    ).rejects;
    await rejection.toThrow(/bConnect security group/);
    stubTransport({ status: 401, data: '' });
    await expect(
      client.callTool({ name: 'list_microsoft_update_profiles', arguments: {} })
    ).rejects.toThrow(/UPN form/);
  });

  it('400 -> the unknown-parameter diagnosis, as a readable isError result', async () => {
    stubV11Env();
    stubTransport({ status: 400, data: 'Unknown parameter: Endpoint' });
    const client = await connect();
    const result = await client.callTool({
      name: 'get_endpoint_microsoft_update_inventory',
      arguments: { endpointId: GUID },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toBe(v11BadRequestMessage('Unknown parameter: Endpoint'));
    expect(textOf(result)).toContain('silently ignores an unknown query parameter');
  });
});

// ─── Read-only by construction ───────────────────────────────────────────────

describe('MicrosoftUpdateV11Client — GET only', () => {
  function bareClient(): MicrosoftUpdateV11Client {
    return new MicrosoftUpdateV11Client({
      httpClient: { defaults: { baseURL: 'https://bms-server/bconnect' } } as never,
      env: { BCONNECT_V11_USERNAME: 'u@d', BCONNECT_V11_PASSWORD: 'p' },
    });
  }

  it.each(['POST', 'PATCH', 'DELETE', 'PUT', 'post'])('refuses %s before touching the wire', async (method) => {
    const client = bareClient();
    const transport = vi.spyOn(MicrosoftUpdateV11Client.prototype, 'transport');
    await expect(client.request('MicrosoftUpdateProfiles', {}, { method })).rejects.toThrow(
      /read-only by design/
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it('refuses non-GET even when no credentials exist (guard runs first)', async () => {
    const client = new MicrosoftUpdateV11Client({
      httpClient: { defaults: {} } as never,
      env: {},
    });
    await expect(client.request('Jobs', {}, { method: 'DELETE' })).rejects.toThrow(
      /read-only by design/
    );
  });

  it('never reads BCONNECT_API_KEY: an API key alone does not authenticate v1.1', async () => {
    const client = new MicrosoftUpdateV11Client({
      httpClient: { defaults: { baseURL: 'https://bms-server/bconnect' } } as never,
      env: { BCONNECT_API_KEY: 'a-perfectly-good-v2-key' },
    });
    const transport = vi.spyOn(MicrosoftUpdateV11Client.prototype, 'transport');
    await expect(client.request('MicrosoftUpdateProfiles')).rejects.toThrow(
      /BCONNECT_V11_USERNAME/
    );
    expect(transport).not.toHaveBeenCalled();
  });
});
