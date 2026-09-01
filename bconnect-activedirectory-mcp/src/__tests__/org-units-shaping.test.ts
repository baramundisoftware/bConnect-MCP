/**
 * bconnect-activedirectory-mcp — the compact projection for `list_org_units`.
 *
 * Measured live: 6,576 B for a 20-row page -> 3,296 B, saving 3,280 B (-49.9%).
 * Across the whole 133-OU population, 44,490 -> 22,173 B (-50.2%).
 *
 * ── The skew warning, checked before building ───────────────────────────────
 * The review that ranked this tool flagged the captured page as unrepresentative
 * — 13 of 20 rows being CN=…,CN=System containers with the longest comments on
 * the page — which would have made a projection sized on it overstate a typical
 * page. So all seven pages were walked first. `comment`'s share came out at
 * 51.5 / 52.4 / 50.9 / 51.9 / 52.3 / 52.1 / 51.4 % and 52.8% pooled: uniform.
 * The warning was right to raise and wrong on the facts, and the difference was
 * a measurement rather than an argument.
 *
 * ── Why dropping `comment` is not dropping information ──────────────────────
 * 131 of 133 org units carry a comment and EVERY one matches "Automatically
 * created|updated by ADSync from LDAP://… on <date>" — zero are human-written.
 * The directory position it embeds is in `parent`/`parentId`, which the
 * projection keeps, so what is removed is provenance boilerplate, disclosed in
 * `meta.dropped` and recoverable with `detail:true`.
 *
 * ── Falsified ───────────────────────────────────────────────────────────────
 * Revert the case arm to `serializeToolResult(result)` and the first three tests
 * fail. Remove `parent`/`parentId` from the kept set and "the hierarchy survives"
 * fails — that is the assertion standing in for "we did not delete the answer".
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

let nextResult: unknown = { data: [] };

vi.mock('../bconnect-client.js', () => ({
  BConnectClient: class {
    activeDirectory = {
      getOrgUnits: async (): Promise<unknown> => nextResult,
    };
  },
}));

const { createServer } = await import('../index.js');

/** An org-unit row as the live route returns it — five columns, no ldapPath. */
function ouRow(i: number, parent: [string, string]): Record<string, unknown> {
  return {
    id: `00f034c${i}-a8b7-4834-b4a0-23c9f5567196`,
    name: `OrgUnit${i}`,
    comment:
      `Automatically created by ADSync from LDAP://labcorp.local/OU=OrgUnit${i},` +
      `CN=Operations,CN=DomainUpdates,CN=System,DC=labcorp,DC=local on 12/16/2025 5:07 PM`,
    parentId: parent[0],
    parent: parent[1],
  };
}

const PARENTS: [string, string][] = [
  ['e57a7e00-0000-4000-8000-000000000031', 'Operations'],
  ['e57a7e00-0000-4000-8000-000000000037', 'Clients'],
  ['e57a7e00-0000-4000-8000-000000000040', 'Servers'],
];

const page = (n: number, parents: [string, string][]): Record<string, unknown> => ({
  currentPage: 0,
  pageSize: 20,
  totalPages: 7,
  totalItems: 133,
  hasPreviousPage: false,
  hasNextPage: true,
  data: Array.from({ length: n }, (_unused, i) => ouRow(i + 1, parents[i % parents.length])),
});

async function callJson(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'ou-shaping', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = (await client.callTool({
    name: 'list_org_units',
    arguments: args,
  })) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8');

afterEach(() => {
  nextResult = { data: [] };
});

describe('list_org_units — compact projection', () => {
  it('drops comment and names it in meta.dropped', async () => {
    nextResult = page(20, PARENTS);
    const json = await callJson({});
    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(20); // vacuity: the page survived the projection
    expect('comment' in rows[0]).toBe(false);
    const dropped = ((json.meta as Record<string, unknown>).dropped ?? []) as string[];
    expect(dropped).toContain('comment');
  });

  it('keeps the hierarchy, which is what the comment encoded', async () => {
    // The justification for dropping `comment` is that the directory position it
    // embeds is available structurally. If that stopped being true the drop would
    // become information loss, so it is asserted rather than trusted.
    nextResult = page(20, PARENTS);
    const rows = (await callJson({})).data as Record<string, unknown>[];
    for (const col of ['id', 'name', 'parentId', 'parent']) {
      expect(col in rows[0], `${col} must survive — it is the answer`).toBe(true);
    }
    expect(rows[0].parent).toBe('Operations');
  });

  it('saves close to half the page (measured, not asserted by hand)', async () => {
    const raw = page(20, PARENTS);
    nextResult = raw;
    const json = await callJson({});
    expect(bytes(json)).toBeLessThan(bytes(raw) * 0.6);
  });

  it('collapses a single-parent page into meta.constant as well', async () => {
    // dropConstantColumns measured 0 B on all seven pages of the reference
    // estate — no page there shares one parent. It is carried for shallow
    // directories where a page DOES, and this pins that it works when it fires.
    nextResult = page(20, [PARENTS[0]]);
    const json = await callJson({});
    // `?? {}` on the meta too, so reverting the projection fails this with
    // "expected undefined to be a29bdc39-…" rather than a TypeError about
    // reading 'constant' of undefined.
    const constant = (((json.meta ?? {}) as Record<string, unknown>).constant ?? {}) as Record<string, unknown>;
    expect(constant.parentId).toBe(PARENTS[0][0]);
    expect(constant.parent).toBe('Operations');
    // Still lossless: the value is in the response once instead of twenty times.
    expect('parentId' in (json.data as Record<string, unknown>[])[0]).toBe(false);
  });

  it('detail:true returns the raw record, so the escape hatch is reachable', async () => {
    // Also proves the validation rules accept `detail`; without them
    // assertKnownParameters refuses it with -32602 before dispatch.
    const raw = page(3, PARENTS);
    nextResult = raw;
    const json = await callJson({ detail: true });
    expect(json.meta).toBeUndefined();
    expect(json).toEqual(raw);
  });

  it('fields:[..] is reachable too', async () => {
    nextResult = page(5, PARENTS);
    const json = await callJson({ fields: ['id', 'name'] });
    expect(Object.keys((json.data as Record<string, unknown>[])[0]).sort()).toEqual(['id', 'name']);
  });
});
