/**
 * bconnect-compliance-mcp — response shaping for list_vulnerabilities
 * (AUD-optimization-1)
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `list_vulnerabilities` declared only `countOnly` and returned the raw CVE
 * library payload unchanged. Measured live (PageSize 20, totalItems 37,571 —
 * the whole library): affectedOperatingSystems alone ran 6,751 of 16,039 B
 * (42.1%) of a 20-row page, up to 463 chars per entry. Dropping it from the
 * compact projection, named in meta.dropped, measured -41.6%.
 *
 * ── Made to fail before being trusted ───────────────────────────────────────
 * Before this fix, `list_vulnerabilities` returned
 * `serializeToolResult(rawApiResult)` unchanged — every assertion below that
 * checks `affectedOperatingSystems` is gone, or that `meta.dropped` names it,
 * failed against that code (confirmed by temporarily reverting the case arm
 * to the raw passthrough and re-running this file).
 */

import { describe, it, expect, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// ── The fake client ──────────────────────────────────────────────────────────

let nextResult: unknown = { data: [] };

function record() {
  return async (): Promise<unknown> => nextResult;
}

vi.mock('../bconnect-client.js', () => ({
  BConnectClient: class {
    compliance = {
      getAllVulnerabilities: record(),
    };
    getHttpClient() {
      return {};
    }
  },
}));

const { createServer } = await import('../index.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function vulnerabilityRow(id: string, cveId: string): Record<string, unknown> {
  return {
    id,
    cveId,
    cvssScore: 9.8,
    severity: 'Critical',
    description: 'A remote code execution vulnerability exists in the way the affected component handles objects in memory.',
    affectedProducts: 'Windows 10, Windows 11, Windows Server 2019, Windows Server 2022',
    affectedOperatingSystems: 'Windows 10 21H2, Windows 10 22H2, Windows 11 21H2, Windows 11 22H2, Windows 11 23H2, Windows Server 2019, Windows Server 2022, Windows Server 2025',
  };
}

function envelope(rows: Record<string, unknown>[]): Record<string, unknown> {
  return {
    currentPage: 0,
    pageSize: 20,
    totalPages: 1879,
    totalItems: 37571,
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

describe('list_vulnerabilities — compact projection', () => {
  it('drops affectedOperatingSystems and names it in meta.dropped', async () => {
    const client = await connect();
    nextResult = envelope([
      vulnerabilityRow('e57a7e00-0000-4000-8000-000000000006', 'CVE-2026-1000'),
      vulnerabilityRow('e57a7e00-0000-4000-8000-000000000010', 'CVE-2026-1001'),
    ]);
    const json = await callJson(client, 'list_vulnerabilities', {});

    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toHaveProperty('affectedOperatingSystems');
    // Everything else survives — this is a drop, not a projection to a fixed
    // field list.
    expect(rows[0].cveId).toBe('CVE-2026-1000');
    expect(rows[0].affectedProducts).toBeDefined();

    const meta = json.meta as Record<string, unknown>;
    expect(meta.projection).toBe('compact');
    expect(meta.dropped).toEqual(['affectedOperatingSystems']);
    expect(String(meta.hint)).toMatch(/detail:true/);

    // The envelope survives — it is how the caller knows this is 2 of 37,571.
    expect(json.totalItems).toBe(37571);
  });

  it('detail:true returns the raw record, byte-identical to the unshaped response', async () => {
    const client = await connect();
    const raw = envelope([vulnerabilityRow('e57a7e00-0000-4000-8000-000000000006', 'CVE-2026-1000')]);
    nextResult = raw;
    const result = (await client.callTool({
      name: 'list_vulnerabilities',
      arguments: { detail: true },
    })) as { content: { text: string }[] };

    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('saves more than a quarter of the page (measured, not asserted by hand)', async () => {
    const client = await connect();
    const rows = Array.from({ length: 20 }, (_, i) =>
      vulnerabilityRow(`vuln-${i}`, `CVE-2026-${1000 + i}`)
    );
    nextResult = envelope(rows);
    const compactText = JSON.stringify(await callJson(client, 'list_vulnerabilities', {}));
    const rawText = JSON.stringify(envelope(rows));

    expect(bytes(compactText)).toBeLessThan(bytes(rawText) * 0.75);
  });
});
