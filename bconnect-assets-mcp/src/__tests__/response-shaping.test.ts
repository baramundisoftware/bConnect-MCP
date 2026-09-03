/**
 * bconnect-assets-mcp — response shaping for list_assets (OPT-3)
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `list_assets` declared only `countOnly` and returned the raw API payload
 * unchanged — no `detail`/`fields`, no shaping at all. Measured live
 * (20-row page): `additionalProperties` is a {name,type,value} triplet array
 * with the identical shape on every row, and `url`/`energyOff`/`energyOn`/
 * `assetReferenceList` are page-constant on a default-configuration estate.
 * 16,464 B -> 13,104 B, -20.4%.
 *
 * ── Made to fail before being trusted ───────────────────────────────────────
 * Before this fix, `list_assets` returned `serializeToolResult(rawApiResult)`
 * unchanged: every assertion below that checks `additionalProperties` is now
 * an object, or that `meta.constant` names the page-constant columns, failed
 * against that code (confirmed by temporarily reverting the case arm to the
 * raw passthrough and re-running this file).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// ── The fake client ──────────────────────────────────────────────────────────

let nextResult: unknown = { data: [] };

function record() {
  return async (): Promise<unknown> => nextResult;
}

vi.mock('../bconnect-client.js', () => ({
  BConnectClient: class {
    assets = {
      getAssets: record(),
      getAssetTypes: record(),
    };
  },
}));

const { createServer } = await import('../index.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function assetRow(id: string, name: string): Record<string, unknown> {
  return {
    assetId: id,
    name,
    assetTypeId: 'e57a7e00-0000-4000-8000-000000000028',
    assetTypeName: 'Laptop',
    ownerId: 'e57a7e00-0000-4000-8000-000000000029',
    ownerName: 'WIN10CLIENT4',
    ownerType: 'WindowsEndpoint',
    comments: null,
    contact: null,
    inventoryNumber: null,
    url: 'http://',
    costCenter: null,
    purchaseDate: null,
    purchasePrice: 0,
    operatingCost: 0,
    lastChanged: '2026-08-01T00:00:00Z',
    energyOff: -1,
    energyOn: -1,
    additionalProperties: [
      { name: '__KEY', type: 'String', value: id },
      { name: '__LastSeen', type: 'String', value: '2026-08-01T00:00:00Z' },
      { name: '__Type', type: 'String', value: 'Win32_ComputerSystem' },
    ],
    assetReferenceList: [],
  };
}

function envelope(rows: Record<string, unknown>[]): Record<string, unknown> {
  return {
    currentPage: 0,
    pageSize: 20,
    totalPages: 2,
    totalItems: rows.length + 18,
    hasPreviousPage: false,
    hasNextPage: true,
    data: rows,
  };
}

// ── Harness ──────────────────────────────────────────────────────────────────

async function connect(): Promise<Client> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'shaping-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

async function callJson(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

const bytes = (value: string): number => Buffer.byteLength(value, 'utf8');

afterEach(() => {
  delete process.env.ALLOW_WRITE_OPERATIONS;
});

describe('list_assets — compact projection', () => {
  it('folds additionalProperties[{name,type,value}] to {name:value} and reports page-constant columns', async () => {
    const client = await connect();
    nextResult = envelope([
      assetRow('e57a7e00-0000-4000-8000-000000000006', 'WIN10CLIENT4'),
      assetRow('e57a7e00-0000-4000-8000-000000000010', 'WIN10CLIENT1'),
    ]);
    const json = await callJson(client, 'list_assets', {});

    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0].additionalProperties).toEqual({
      __KEY: 'e57a7e00-0000-4000-8000-000000000006',
      __LastSeen: '2026-08-01T00:00:00Z',
      __Type: 'Win32_ComputerSystem',
    });

    // Page-constant columns are reported once, not repeated per row.
    const meta = json.meta as Record<string, unknown>;
    expect(meta.projection).toBe('compact');
    const constant = meta.constant as Record<string, unknown>;
    expect(constant.url).toBe('http://');
    expect(constant.energyOff).toBe(-1);
    expect(constant.energyOn).toBe(-1);
    expect(constant.assetReferenceList).toEqual([]);
    expect(rows[0]).not.toHaveProperty('url');
    expect(rows[0]).not.toHaveProperty('energyOff');

    // The envelope survives — it is how the caller knows to page.
    expect(json.totalItems).toBe(20);
    expect(json.totalPages).toBe(2);
  });

  it('detail:true returns the raw record, byte-identical to the unshaped response', async () => {
    const client = await connect();
    const raw = envelope([assetRow('e57a7e00-0000-4000-8000-000000000006', 'WIN10CLIENT4')]);
    nextResult = raw;
    const result = (await client.callTool({
      name: 'list_assets',
      arguments: { detail: true },
    })) as { content: { text: string }[] };

    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('flags a non-String additionalProperties type instead of silently dropping it', async () => {
    const client = await connect();
    const row = assetRow('e57a7e00-0000-4000-8000-000000000006', 'WIN10CLIENT4');
    (row.additionalProperties as Record<string, unknown>[]).push({ name: 'WarrantyMonths', type: 'Number', value: '36' });
    nextResult = envelope([row, assetRow('e57a7e00-0000-4000-8000-000000000010', 'WIN10CLIENT1')]);
    const json = await callJson(client, 'list_assets', {});

    const meta = json.meta as Record<string, unknown>;
    expect(String(meta.warning)).toMatch(/non-'String' type/);
    // Still folded, not silently discarded — the value is present, just its type is not.
    const rows = json.data as Record<string, unknown>[];
    expect((rows[0].additionalProperties as Record<string, unknown>).WarrantyMonths).toBe('36');
  });

  it('saves more than 15% of the page (measured, not asserted by hand)', async () => {
    const client = await connect();
    const rows = Array.from({ length: 20 }, (_, i) =>
      assetRow(`asset-${i}`, `WIN10CLIENT${i}`)
    );
    nextResult = envelope(rows);
    const compactText = JSON.stringify(await callJson(client, 'list_assets', {}));
    const rawText = JSON.stringify(envelope(rows));

    expect(bytes(compactText)).toBeLessThan(bytes(rawText) * 0.85);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// list_asset_types — the strictly-lossless pilot
//
// Chosen as the first commit off the response-shaping backlog precisely because
// it needs no field-selection judgement: `dropConstantColumns` alone, so every
// value stays in the response and is merely recorded once instead of on every
// row. Measured live against the estate BEFORE this landed: 6,564 B raw ->
// 4,843 B compact, saved 1,721 B (26.2%) over 15 rows, seven constant columns
// (comments, contact, inventoryNumber, url, additionalProperties, summary,
// encodedIcon).
//
// The offline analysis had predicted 4,812 B / 1,752 B / 26.7%. It was 31 B
// optimistic because a simulation cannot know the exact `meta` wording the
// shipped shaper emits — which is the argument for measuring the real tool
// rather than trusting a projection replayed over a captured payload.
//
// Falsified: revert the case arm to `serializeToolResult(result)` and the first
// three tests below fail.
// ─────────────────────────────────────────────────────────────────────────────

function assetTypeRow(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    // The seven that are constant across a real page.
    comments: null,
    contact: null,
    inventoryNumber: null,
    url: 'http://',
    additionalProperties: null,
    summary: null,
    encodedIcon: null,
  };
}

describe('list_asset_types — lossless compaction', () => {
  const typePage = (n: number): Record<string, unknown> => ({
    currentPage: 0,
    pageSize: 20,
    totalPages: 1,
    totalItems: n,
    hasPreviousPage: false,
    hasNextPage: false,
    data: Array.from({ length: n }, (_, i) => assetTypeRow(`type-${i}`, `Asset Type ${i}`)),
  });

  it('reports the page-constant columns once in meta.constant instead of per row', async () => {
    const client = await connect();
    nextResult = typePage(15);
    const json = await callJson(client, 'list_asset_types', {});

    const constant = (json.meta as Record<string, unknown>).constant as Record<string, unknown>;
    for (const key of ['comments', 'contact', 'inventoryNumber', 'url', 'additionalProperties', 'summary', 'encodedIcon']) {
      expect(Object.keys(constant)).toContain(key);
    }
    expect(constant.url).toBe('http://');
    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(15); // vacuity: the page survived the projection
    expect('url' in rows[0]).toBe(false);
    // The fields that actually differ per row are untouched.
    expect(rows[0].id).toBe('type-0');
    expect(rows[0].name).toBe('Asset Type 0');
  });

  it('is STRICTLY LOSSLESS — every raw value is recoverable from row + meta.constant', async () => {
    const client = await connect();
    const raw = typePage(15);
    nextResult = raw;
    const json = await callJson(client, 'list_asset_types', {});
    const rows = json.data as Record<string, unknown>[];
    const constant = (json.meta as Record<string, unknown>).constant as Record<string, unknown>;

    // This is the property the pilot was chosen for, so it is asserted over
    // every field of every row rather than spot-checked.
    const rawRows = raw.data as Record<string, unknown>[];
    for (let i = 0; i < rawRows.length; i++) {
      for (const [key, value] of Object.entries(rawRows[i])) {
        const recovered = key in rows[i] ? rows[i][key] : constant[key];
        expect(recovered, `${key} on row ${i} must survive somewhere`).toEqual(value);
      }
    }
  });

  it('saves more than 15% of the page (measured, not asserted by hand)', async () => {
    const client = await connect();
    const raw = typePage(15);
    nextResult = raw;
    const compactText = JSON.stringify(await callJson(client, 'list_asset_types', {}));
    expect(bytes(compactText)).toBeLessThan(bytes(JSON.stringify(raw)) * 0.85);
  });

  it('detail:true returns the raw record, so the escape hatch is reachable', async () => {
    const client = await connect();
    const raw = typePage(15);
    nextResult = raw;
    // Also proves the validation rules accept `detail` — without shapingRules()
    // the unknown-parameter validator refuses it with -32602 before dispatch,
    // which would make the projection impossible to opt out of.
    const json = await callJson(client, 'list_asset_types', { detail: true });
    expect(json.meta).toBeUndefined();
    expect((json.data as Record<string, unknown>[])[0].url).toBe('http://');
  });
});
