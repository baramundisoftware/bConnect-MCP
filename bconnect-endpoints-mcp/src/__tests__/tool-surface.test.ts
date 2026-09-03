/**
 * The 2026-08-02 surface revision — TOK-20, TOK-21, TOK-23, TOK-25, TOK-26 and
 * INT-53, asserted end to end.
 *
 * This is a DELIBERATELY BREAKING change to the MCP tool surface, taken now
 * because the project has no git remote and no published clients. Every
 * assertion here exists so a future edit that quietly reverts one of them
 * fails loudly:
 *
 *   TOK-20  write schemas are advertised only when ALLOW_WRITE_OPERATIONS=true,
 *           and hiding is not disabling — a hidden write called by name still
 *           gets the same refusal
 *   TOK-21  the per-platform list tools default to a ten-field projection;
 *           detail:true returns the raw record unchanged
 *   TOK-23  console links are one template per response, not one URI per row
 *   TOK-25  countOnly answers "how many" without materialising a page
 *   TOK-26  list_group_endpoints is gone and its route has exactly one tool
 *   INT-53  a 404 comes back as a readable isError result, not -32603
 *
 * Requests are served by MSW rather than reaching a bMS: the estate is
 * read-only to this work, and the running MCP servers serve a stale build, so
 * "verify live" is not available. `http://` is deliberate — the client only
 * installs a custom https agent, which MSW cannot see through.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { createServer } from '../index.js';
import { buildConsoleLink } from '../modules/bmc-console-link.js';
import {
  windowsEndpointPage,
  windowsEndpointRow,
  windowsEndpointRowBytes,
} from './fixtures/windows-endpoint-row.js';

const BASE_URL = 'http://bms.test.local/bconnect';
const WINDOWS_ENDPOINTS = `${BASE_URL}/endpoints/v2.0/WindowsEndpoints`;
const ENDPOINTS = `${BASE_URL}/endpoints/v2.0/Endpoints`;

/**
 * What `list_windows_endpoints` became.
 *
 * These assertions used to name a tool per platform. The tool is gone and the
 * platform is an argument, but the ROUTE is unchanged — every call below still
 * lands on the same GET /endpoints/v2.0/WindowsEndpoints handler above, which is
 * the point of the collapse and the reason these tests could be migrated rather
 * than rewritten. That the enum value reaches the right route for all seven
 * platforms is proved separately, in family-collapse.test.ts.
 */
const WINDOWS = { type: 'WindowsEndpoint' } as const;

/** Query parameters of the last request MSW served, for the countOnly probe. */
let lastQuery: URLSearchParams | null = null;

const mockApi = setupServer(
  http.get(WINDOWS_ENDPOINTS, ({ request }) => {
    lastQuery = new URL(request.url).searchParams;
    const page = Number(lastQuery.get('Page') ?? '0');
    // A page past the end returns the envelope with no rows — the behaviour
    // countOnly's probe depends on, reproduced here rather than assumed.
    if (page > 100) {
      return HttpResponse.json({ ...windowsEndpointPage(0), currentPage: page, data: [] });
    }
    return HttpResponse.json(windowsEndpointPage(20));
  }),
  http.get(ENDPOINTS, ({ request }) => {
    lastQuery = new URL(request.url).searchParams;
    return HttpResponse.json(windowsEndpointPage(20));
  }),
  http.get(`${ENDPOINTS}/:id`, () =>
    HttpResponse.json({ title: 'Not Found', status: 404 }, { status: 404 })
  )
);

beforeAll(() => mockApi.listen({ onUnhandledRequest: 'error' }));
afterAll(() => mockApi.close());

const savedWriteGate = process.env.ALLOW_WRITE_OPERATIONS;
afterEach(() => {
  mockApi.resetHandlers();
  lastQuery = null;
  if (savedWriteGate === undefined) {
    delete process.env.ALLOW_WRITE_OPERATIONS;
  } else {
    process.env.ALLOW_WRITE_OPERATIONS = savedWriteGate;
  }
});

async function connect(): Promise<Client> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: BASE_URL });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'tool-surface-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

/** Call a tool and parse the JSON text block it returned. */
async function callJson(
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ payload: Record<string, unknown>; text: string; isError?: boolean }> {
  const client = await connect();
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text: string }>)[0].text;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Not every tool returns JSON; callers that care assert on `text`.
  }
  return { payload, text, isError: result.isError as boolean | undefined };
}

async function toolNames(): Promise<string[]> {
  const client = await connect();
  return (await client.listTools()).tools.map((t) => t.name);
}

// ───────────────────────────────────────────────────────────────────────────
// TOK-20 — the write gate now decides what is advertised, not only what runs
// ───────────────────────────────────────────────────────────────────────────

describe('TOK-20 — write tools are advertised only when the gate is open', () => {
  const WRITE_SAMPLE = [
    'create_windows_endpoint',
    'delete_endpoint',
    'update_logical_group',
    'trigger_intune_installation',
    'link_entra_id_data',
  ];

  it('omits every write tool when ALLOW_WRITE_OPERATIONS is unset', async () => {
    delete process.env.ALLOW_WRITE_OPERATIONS;
    const names = await toolNames();
    for (const name of WRITE_SAMPLE) {
      expect(names, `${name} must not be advertised with the gate shut`).not.toContain(name);
    }
    // The reads are all still there.
    expect(names).toContain('list_endpoints');
    expect(names).toContain('get_fleet_summary');
  });

  it('advertises them again when the gate is open', async () => {
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
    const names = await toolNames();
    for (const name of WRITE_SAMPLE) {
      expect(names).toContain(name);
    }
  });

  it('only "true" opens it — not "1", not "True"', async () => {
    for (const value of ['1', 'True', 'yes', '']) {
      process.env.ALLOW_WRITE_OPERATIONS = value;
      expect(await toolNames(), `"${value}" must not open the gate`).not.toContain(
        'delete_endpoint'
      );
    }
  });

  it('hiding is not disabling: a hidden write called by name still gets the refusal', async () => {
    // The security control has not moved. A client holding a name from an
    // older session must get the same string it always got — not a silent
    // success, and not "unknown tool" either, which would read as a bug.
    delete process.env.ALLOW_WRITE_OPERATIONS;
    const { text, isError } = await callJson('delete_endpoint', {
      id: '00000000-0000-4000-8000-000000000000',
    });
    expect(isError).toBe(true);
    expect(text).toBe(
      "Write operation 'delete_endpoint' is disabled. " +
        'Set ALLOW_WRITE_OPERATIONS=true to enable write operations.'
    );
  });

  it('still validates a hidden write tool\'s arguments against its own schema', async () => {
    // The argument validator reads declared parameters from the full
    // catalogue, not the advertised one. Reading it from the advertised list
    // would make every write tool "unknown" to the validator and skip the
    // path-segment guard on the way to the gate.
    delete process.env.ALLOW_WRITE_OPERATIONS;
    const client = await connect();
    await expect(
      client.callTool({ name: 'delete_endpoint', arguments: { nonsenseKey: 1 } })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });

  it('shrinks the advertised catalogue by more than a third', async () => {
    delete process.env.ALLOW_WRITE_OPERATIONS;
    const closed = await connect().then((c) => c.listTools());
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
    const open = await connect().then((c) => c.listTools());

    const closedBytes = Buffer.byteLength(JSON.stringify(closed.tools), 'utf8');
    const openBytes = Buffer.byteLength(JSON.stringify(open.tools), 'utf8');

    console.info(
      `[TOK-20] catalogue: gate shut ${closed.tools.length} tools / ${closedBytes} B, ` +
        `gate open ${open.tools.length} tools / ${openBytes} B`
    );
    expect(closedBytes).toBeLessThan(openBytes * 0.65);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// TOK-26 — one route, one tool
// ───────────────────────────────────────────────────────────────────────────

describe('TOK-26 — the duplicate group-endpoints tool is gone', () => {
  it('no longer advertises list_group_endpoints, with the gate open or shut', async () => {
    delete process.env.ALLOW_WRITE_OPERATIONS;
    expect(await toolNames()).not.toContain('list_group_endpoints');
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
    expect(await toolNames()).not.toContain('list_group_endpoints');
  });

  it('answers a call to the removed name with MethodNotFound, not a silent success', async () => {
    const client = await connect();
    await expect(
      client.callTool({
        name: 'list_group_endpoints',
        arguments: { logicalGroupId: '00000000-0000-4000-8000-000000000000' },
      })
    ).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
  });

  it('keeps the survivor, and the survivor is the superset', async () => {
    const client = await connect();
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === 'list_endpoints_by_logical_group'
    );
    expect(tool).toBeDefined();
    const params = Object.keys(tool!.inputSchema.properties ?? {});
    // Everything the deleted tool declared …
    for (const p of ['logicalGroupId', 'DisplayName', 'HostName', 'Page', 'PageSize', 'includeSubfolders']) {
      expect(params, `survivor must still accept ${p}`).toContain(p);
    }
    // … plus the two it did not, which is why this is the one that survived.
    expect(params).toContain('SearchQuery');
    expect(params).toContain('OrderBy');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// TOK-21 — the compact default projection
// ───────────────────────────────────────────────────────────────────────────

const COMPACT_FIELDS = [
  'id',
  'displayName',
  'hostName',
  'type',
  'operatingSystem',
  'osVersionString',
  'lastSeen',
  'logicalGroup',
  // The group ID travels with its name: every group-scoped tool in five other
  // servers takes the id, and nothing turns a name back into one.
  'logicalGroupId',
  'clientAgentVersion',
  'activity',
];

describe('TOK-21 — the collapsed list tool returns a compact projection by default', () => {
  it('keeps exactly the eleven declared fields and drops the rest', async () => {
    const { payload } = await callJson('list_endpoints', { ...WINDOWS });
    const rows = payload.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(20);
    expect(Object.keys(rows[0]).sort()).toEqual([...COMPACT_FIELDS].sort());

    // The specific things the evaluation measured as the bulk of a row.
    for (const dropped of ['cpu', 'storageMedia', 'energyScheme', 'bootMode', 'clientAgentLink', 'macList']) {
      expect(rows[0], `${dropped} must not survive the compact projection`).not.toHaveProperty(dropped);
    }
  });

  it('preserves the paging envelope — the caller still knows whether to page', async () => {
    const { payload } = await callJson('list_endpoints', { ...WINDOWS });
    expect(payload.totalItems).toBe(26);
    expect(payload.totalPages).toBe(2);
    expect(payload.hasNextPage).toBe(true);
    expect(payload.currentPage).toBe(0);
  });

  it('says what it did, so a compact row is never mistaken for a thin record', async () => {
    const { payload } = await callJson('list_endpoints', { ...WINDOWS });
    expect(payload.meta).toMatchObject({ projection: 'compact' });
    expect(String((payload.meta as Record<string, unknown>).hint)).toContain('detail:true');
  });

  it('detail:true returns the raw API record, field for field', async () => {
    const { payload } = await callJson('list_endpoints', { ...WINDOWS, detail: true });
    const rows = payload.data as Array<Record<string, unknown>>;
    // Byte-identical to what the API sent, which is the point of the escape
    // hatch: the way out of a projection is the raw thing, not a second one.
    expect(rows[0]).toEqual(windowsEndpointRow(1));
  });

  it('fields:[...] overrides the projection entirely', async () => {
    const { payload } = await callJson('list_endpoints', { ...WINDOWS,
      fields: ['displayName', 'primaryIP'],
    });
    const rows = payload.data as Array<Record<string, unknown>>;
    expect(Object.keys(rows[0])).toEqual(['displayName', 'primaryIP']);
    expect(payload.meta).toMatchObject({ projection: 'fields' });
  });

  it('applies to every per-platform list tool, not just Windows', async () => {
    const { payload } = await callJson('list_endpoints', {});
    const rows = payload.data as Array<Record<string, unknown>>;
    expect(Object.keys(rows[0]).sort()).toEqual([...COMPACT_FIELDS].sort());
  });

  it('cuts a default 20-row page by more than 80%', async () => {
    const full = await callJson('list_endpoints', { ...WINDOWS, detail: true });
    const compact = await callJson('list_endpoints', { ...WINDOWS });

    const fullBytes = Buffer.byteLength(full.text, 'utf8');
    const compactBytes = Buffer.byteLength(compact.text, 'utf8');

    console.info(
      `[TOK-21] list_endpoints(type=WindowsEndpoint) 20 rows: raw row ${windowsEndpointRowBytes()} B, ` +
        `detail:true page ${fullBytes} B -> compact page ${compactBytes} B ` +
        `(-${(100 - (compactBytes / fullBytes) * 100).toFixed(1)}%)`
    );

    expect(compactBytes).toBeLessThan(fullBytes * 0.2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// TOK-23 — one console-link template per response
// ───────────────────────────────────────────────────────────────────────────

describe('TOK-23 — console links are a template, emitted once', () => {
  // The block is opt-in: the bMC:/// scheme has never been round-tripped
  // through the console's own protocol handler, and a bMC:/// URI is inert on a
  // machine without the console installed — which an MCP client frequently is.
  // Every case below therefore opens the gate first; the default-off contract
  // is asserted separately, without it.
  beforeEach(() => {
    process.env.BMC_CONSOLE_LINKS = 'true';
  });
  afterEach(() => {
    delete process.env.BMC_CONSOLE_LINKS;
  });

  it('puts no consoleLink on any row', async () => {
    const { payload } = await callJson('list_endpoints', { ...WINDOWS });
    for (const row of payload.data as Array<Record<string, unknown>>) {
      expect(row).not.toHaveProperty('consoleLink');
      expect(row).not.toHaveProperty('remoteDeskLink');
    }
    expect(payload).not.toHaveProperty('consoleLinksInfo');
  });

  it('emits a template that reproduces the old per-row link exactly', async () => {
    const { payload } = await callJson('list_endpoints', { ...WINDOWS });
    const links = payload.consoleLinks as {
      template: string;
      objectType: Record<string, string>;
      example: string;
    };
    const row = (payload.data as Array<Record<string, unknown>>)[0];

    const expanded = links.template
      .replace('{id}', encodeURIComponent(String(row.id)))
      .replace('{objectType}', links.objectType[String(row.type)]);

    expect(expanded).toBe(buildConsoleLink(windowsEndpointRow(1)));
    expect(links.example).toBe(expanded);
  });

  it('survives detail:true — the raw record never carried a link either', async () => {
    const { payload } = await callJson('list_endpoints', { ...WINDOWS, detail: true });
    expect(payload.consoleLinks).toBeDefined();
    expect((payload.data as Array<Record<string, unknown>>)[0]).not.toHaveProperty('consoleLink');
  });
});

describe('console links are absent unless BMC_CONSOLE_LINKS is set', () => {
  // The three most-called tools in the server. A deep link whose encoding has
  // not been confirmed against a live console must not arrive unasked-for on
  // any of them — a link that opens on nothing reads to an operator as a
  // missing endpoint, which is a worse answer than no link at all.
  beforeEach(() => {
    delete process.env.BMC_CONSOLE_LINKS;
    mockApi.use(
      http.get(`${BASE_URL}/jobs/v2.0/JobInstances`, () =>
        HttpResponse.json({ totalPages: 1, data: [] })
      )
    );
  });

  it.each([
    ['list_endpoints', WINDOWS as Record<string, unknown>],
    ['get_fleet_summary', {}],
    ['get_stale_endpoints', {}],
  ])('%s emits no consoleLinks block', async (tool, args) => {
    const { payload } = await callJson(tool, args);
    expect(payload).not.toHaveProperty('consoleLinks');
    // And nothing anywhere in the serialised result mentions the scheme, so a
    // model cannot relay a bMC:/// URI the operator never opted into.
    expect(JSON.stringify(payload)).not.toContain('bMC:///');
  });

  it('a caller cannot self-grant the block by naming the module option', async () => {
    // The gate is the server's environment, never the tool arguments — a model
    // that guesses the option name gets a rejection, not the links.
    await expect(
      callJson('list_endpoints', { ...WINDOWS, includeConsoleLinks: true })
    ).rejects.toThrow(/unknown parameter 'includeConsoleLinks'/);
    await expect(
      callJson('get_fleet_summary', { includeConsoleLinks: true })
    ).rejects.toThrow(/includeConsoleLinks/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// TOK-23 in the two demo tools — the hard constraint on this change
// ───────────────────────────────────────────────────────────────────────────

describe('TOK-23 — get_fleet_summary and get_stale_endpoints keep working', () => {
  // Both must keep answering with the gate open, and a console link must stay
  // reachable — which after TOK-23 means "expandable from the row plus the
  // response template", plus one already-expanded example for the row a human
  // actually wants to open.
  afterEach(() => {
    delete process.env.BMC_CONSOLE_LINKS;
  });
  beforeEach(() => {
    process.env.BMC_CONSOLE_LINKS = 'true';
    mockApi.use(
      // Both composites walk the generic /Endpoints projection at PageSize 1000.
      http.get(ENDPOINTS, () =>
        HttpResponse.json({
          totalPages: 1,
          currentPage: 0,
          data: [
            {
              id: 'e57a7e00-0000-4000-8000-000000000027',
              type: 'WindowsEndpoint',
              displayName: 'WIN10CLIENT9',
              hostName: 'WIN10CLIENT9',
              lastSeen: '2025-07-12T09:00:00Z',
              clientAgentVersion: '25.1.100.0',
              activity: 'Job could not be executed: agent unreachable',
              logicalGroup: 'Clients',
              operatingSystem: 'Microsoft Windows 10 Enterprise',
            },
            {
              id: 'e57a7e00-0000-4000-8000-000000000034',
              type: 'WindowsEndpoint',
              displayName: 'WORKSTATION1',
              hostName: 'WORKSTATION1',
              lastSeen: new Date().toISOString(),
              clientAgentVersion: '26.1.230.0',
              activity: 'Idle',
              logicalGroup: 'Clients',
              operatingSystem: 'Microsoft Windows 11 Enterprise',
            },
          ],
        })
      ),
      http.get(`${BASE_URL}/jobs/v2.0/JobInstances`, () =>
        HttpResponse.json({
          totalPages: 1,
          data: [
            {
              endpointId: 'e57a7e00-0000-4000-8000-000000000027',
              successfulExecutions: 0,
              erroneousExecutions: 54,
              lastAction: '2026-06-01T00:00:00Z',
            },
          ],
        })
      )
    );
  });

  it('get_fleet_summary still answers, and its link is still reachable', async () => {
    const { payload } = await callJson('get_fleet_summary', {});
    expect((payload.totals as Record<string, number>).endpoints).toBe(2);

    const attention = payload.needsAttention as Array<Record<string, unknown>>;
    expect(attention.length).toBeGreaterThan(0);
    // No expanded URI on the row …
    expect(attention[0]).not.toHaveProperty('consoleLink');
    // … but the two fields that reconstruct it, plus the template.
    expect(attention[0].id).toBe('e57a7e00-0000-4000-8000-000000000027');
    expect(attention[0].type).toBe('WindowsEndpoint');

    const links = payload.consoleLinks as { template: string; objectType: Record<string, string>; example: string };
    const expanded = links.template
      .replace('{id}', encodeURIComponent(String(attention[0].id)))
      .replace('{objectType}', links.objectType[String(attention[0].type)]);
    expect(expanded).toBe(
      buildConsoleLink({ id: String(attention[0].id), type: 'WindowsEndpoint' })
    );
    // The demo's copy-paste beat: already expanded, for the row a human cares about.
    expect(links.example).toBe(expanded);
  });

  it('get_stale_endpoints still finds the never-succeeded ghost, link and all', async () => {
    const { payload } = await callJson('get_stale_endpoints', {});
    const ghosts = payload.ghosts as Array<Record<string, unknown>>;
    expect(ghosts.length).toBeGreaterThan(0);

    const worst = ghosts[0];
    expect(worst.endpoint).toBe('WIN10CLIENT9');
    expect(worst.failedAttempts).toBe(54);
    expect(worst.everSucceededAJob).toBe(false);
    expect(worst).not.toHaveProperty('consoleLink');
    expect(worst.id).toBe('e57a7e00-0000-4000-8000-000000000027');

    const links = payload.consoleLinks as { example: string };
    expect(links.example).toBe(
      buildConsoleLink({ id: String(worst.id), type: 'WindowsEndpoint' })
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// TOK-25 — countOnly
// ───────────────────────────────────────────────────────────────────────────

describe('TOK-25 — countOnly answers "how many" without a page of rows', () => {
  it('returns the count and no rows', async () => {
    const { payload } = await callJson('list_endpoints', { ...WINDOWS, countOnly: true });
    expect(payload.totalItems).toBe(26);
    expect(payload).not.toHaveProperty('data');
  });

  it('requests a page past the end, so the server materialises no row', async () => {
    await callJson('list_endpoints', { ...WINDOWS, countOnly: true });
    expect(lastQuery?.get('PageSize')).toBe('1');
    expect(Number(lastQuery?.get('Page'))).toBeGreaterThan(1000);
  });

  it('preserves the caller\'s filters and echoes what was counted', async () => {
    const { payload } = await callJson('list_endpoints', { ...WINDOWS,
      countOnly: true,
      Domain: 'labcorp.local',
    });
    expect(lastQuery?.get('Domain')).toBe('labcorp.local');
    expect(payload.filters).toMatchObject({ Domain: 'labcorp.local' });
  });

  it('echoes the path scope too, so a group count is not mistaken for an estate count', async () => {
    mockApi.use(
      http.get(`${BASE_URL}/endpoints/v2.0/LogicalGroups/:id/Endpoints`, () =>
        HttpResponse.json({ ...windowsEndpointPage(0), totalItems: 12, data: [] })
      )
    );
    const groupId = 'e57a7e00-0000-4000-8000-000000000013';
    const { payload } = await callJson('list_endpoints_by_logical_group', {
      countOnly: true,
      logicalGroupId: groupId,
    });
    expect(payload.totalItems).toBe(12);
    expect(payload.filters).toMatchObject({ logicalGroupId: groupId });
  });

  it('costs a fraction of the page it replaces', async () => {
    const count = await callJson('list_endpoints', { ...WINDOWS, countOnly: true });
    const page = await callJson('list_endpoints', { ...WINDOWS });

    const countBytes = Buffer.byteLength(count.text, 'utf8');
    const pageBytes = Buffer.byteLength(page.text, 'utf8');

    console.info(`[TOK-25] countOnly ${countBytes} B vs compact page ${pageBytes} B`);
    expect(countBytes).toBeLessThan(pageBytes * 0.05);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// INT-53 — one error channel
// ───────────────────────────────────────────────────────────────────────────

describe('INT-53 — expected API failures come back as readable results', () => {
  it('a 404 is an isError result, not a -32603 protocol error', async () => {
    // Before: every non-McpError became InternalError, so "you passed an id
    // that does not exist" — which the model can fix by itself — arrived on
    // the channel that means "the server is broken".
    const { text, isError } = await callJson('get_endpoint', {
      id: '00000000-0000-4000-8000-000000000000',
    });
    expect(isError).toBe(true);
    expect(text).toMatch(/not found/i);
    expect(text).not.toContain('MCP error');
  });

  it('a validation failure is still a protocol error, unchanged', async () => {
    const client = await connect();
    await expect(
      client.callTool({ name: 'list_endpoints', arguments: { bogusFilter: 1 } })
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });

  it('an unknown tool is still MethodNotFound', async () => {
    const client = await connect();
    await expect(
      client.callTool({ name: 'no_such_tool', arguments: {} })
    ).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
  });
});
