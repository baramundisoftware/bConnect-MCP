/**
 * bconnect-activedirectory-mcp — response shaping (OPT-4)
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * ADSync writes `comment` as 'Automatically created/updated by ADSync from
 * LDAP://<ldapPath> on <date>' — restating the row's own `ldapPath` field
 * verbatim. Measured live full-estate: 100% of rows on list_ad_objects
 * (60/60), list_ad_groups (52/52) and list_ad_users (8/8) carried the exact
 * match. Stripping the redundant substring (never a fuzzy match) measured
 * -12.7% on a full-estate pull.
 *
 * ── Made to fail before being trusted ───────────────────────────────────────
 * Before this fix, every list_ad_* case arm returned
 * `serializeToolResult(rawApiResult)` unchanged — every assertion below that
 * checks `comment` for the marker, or that `meta.commentLdapPathElided`
 * exists, failed against that code (confirmed by temporarily reverting the
 * shared helper to identity and re-running this file).
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
    activeDirectory = {
      getADGroups: record(),
      getADUsers: record(),
      getADObjects: record(),
      getOrgUnits: record(),
    };
  },
}));

const { createServer } = await import('../index.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function adRow(id: string, name: string, ldapPath: string): Record<string, unknown> {
  return {
    id,
    name,
    orgUnitId: 'e57a7e00-0000-4000-8000-000000000028',
    orgUnit: 'Sales',
    sid: 'S-1-5-21-000000000-000000000-000000000-1001',
    domain: 'labcorp.local',
    type: 'User',
    ldapPath,
    comment: `Automatically created/updated by ADSync from LDAP://${ldapPath} on 2026-08-01`,
    objectGuid: id,
  };
}

function envelope(rows: Record<string, unknown>[]): Record<string, unknown> {
  return {
    currentPage: 0,
    pageSize: 20,
    totalPages: 1,
    totalItems: rows.length,
    hasPreviousPage: false,
    hasNextPage: false,
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

/**
 * These exercise OPT-4's elision through `detail:true`, which is where it is
 * now observable.
 *
 * The elision used to be visible on the default path, and was when these tests
 * were written. Since 2026-08-13 the compact projection (`shapeAdRows`) drops
 * `comment` outright on that path — a strictly larger saving than eliding a
 * substring of it — so the default response has no comment to inspect. The
 * elision still runs, and still governs what `detail:true` returns, which is
 * the contract these tests exist to hold: `detail:true` gives back exactly what
 * these tools returned before the projection existed. Asserting it there is the
 * discriminating check now; asserting it on the default path would only be
 * re-testing that the projection ran.
 */
describe('list_ad_objects — comment/ldapPath dedup (detail path)', () => {
  it('strips an exact LDAP://<ldapPath> match out of comment and discloses it in meta', async () => {
    const client = await connect();
    nextResult = envelope([
      adRow('e57a7e00-0000-4000-8000-000000000006', 'jdoe', 'OU=Sales,DC=labcorp,DC=local/jdoe'),
      adRow('e57a7e00-0000-4000-8000-000000000010', 'asmith', 'OU=Sales,DC=labcorp,DC=local/asmith'),
    ]);
    const json = await callJson(client, 'list_ad_objects', { detail: true });

    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0].comment).toBe('Automatically created/updated by ADSync from {ldapPath} on 2026-08-01');
    // ldapPath itself is untouched — it is the field the comment used to repeat.
    expect(rows[0].ldapPath).toBe('OU=Sales,DC=labcorp,DC=local/jdoe');

    const meta = json.meta as Record<string, unknown>;
    expect(meta.commentLdapPathElided).toBe(2);
    expect(String(meta.hint)).toMatch(/ldapPath already carries the same value/);
  });

  it('leaves a comment alone when it does not exactly match this row\'s own ldapPath', async () => {
    const client = await connect();
    const row = adRow('e57a7e00-0000-4000-8000-000000000006', 'jdoe', 'OU=Sales,DC=labcorp,DC=local/jdoe');
    row.comment = 'Hand-edited: was previously LDAP://OU=OldPath,DC=labcorp,DC=local/jdoe';
    nextResult = envelope([row]);
    const json = await callJson(client, 'list_ad_objects', { detail: true });

    const rows = json.data as Record<string, unknown>[];
    expect(rows[0].comment).toBe(row.comment);
    expect(json.meta).toBeUndefined();
  });

  it('leaves rows without a matching comment/ldapPath pair untouched (no meta added)', async () => {
    const client = await connect();
    nextResult = envelope([{ id: 'x', name: 'no-sync-data' }]);
    const json = await callJson(client, 'list_ad_objects', { detail: true });

    expect(json.data).toEqual([{ id: 'x', name: 'no-sync-data' }]);
    expect(json.meta).toBeUndefined();
  });
});

describe('list_ad_users / list_ad_groups — same dedup (detail path)', () => {
  it('list_ad_users strips the redundant substring', async () => {
    const client = await connect();
    nextResult = envelope([adRow('e57a7e00-0000-4000-8000-000000000006', 'jdoe', 'OU=Sales,DC=labcorp,DC=local/jdoe')]);
    const json = await callJson(client, 'list_ad_users', { detail: true });
    const rows = json.data as Record<string, unknown>[];
    expect(rows[0].comment).toBe('Automatically created/updated by ADSync from {ldapPath} on 2026-08-01');
  });

  it('list_ad_groups strips the redundant substring', async () => {
    const client = await connect();
    nextResult = envelope([adRow('e57a7e00-0000-4000-8000-000000000006', 'Marketing', 'OU=Groups,DC=labcorp,DC=local/Marketing')]);
    const json = await callJson(client, 'list_ad_groups', { detail: true });
    const rows = json.data as Record<string, unknown>[];
    expect(rows[0].comment).toBe('Automatically created/updated by ADSync from {ldapPath} on 2026-08-01');
  });

  it('and the DEFAULT path drops the comment entirely, which is the larger saving', async () => {
    const client = await connect();
    nextResult = envelope([adRow('e57a7e00-0000-4000-8000-000000000006', 'jdoe', 'OU=Sales,DC=labcorp,DC=local/jdoe')]);
    const json = await callJson(client, 'list_ad_users', {});
    const rows = json.data as Record<string, unknown>[];
    expect(rows[0].comment).toBeUndefined();
    expect((json.meta as Record<string, unknown>).dropped).toContain('comment');
  });
});
