/**
 * P1-6 — the client-side shaping vocabulary never reaches bConnect.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Nine servers forwarded the caller's whole argument object as the request
 * `params` on the non-count path, so `countOnly`, `detail`, `fields` and
 * `includeSteps` were appended to the bConnect URL. bConnect answers 200 and
 * silently drops a parameter it does not know (finding D6), so nothing visibly
 * broke — which is exactly why it survived: the suite put its own vocabulary on
 * the wire and nothing complained.
 *
 * Precisely scoped, because the register overstated it: `countOnly: true` never
 * leaked — `fetchCount` strips it on the count path. What leaked was an
 * explicit `countOnly: false`, which cannot change an answer. So this is a
 * hygiene fix, not a correctness one, and the honest claim is narrow: "never
 * sent to the API" now holds for every value, not only the meaningful one.
 *
 * ── Why this is guarded and not just fixed ──────────────────────────────────
 * `suite-schema-vs-types.test.ts` exists to catch a tool sending a parameter
 * its operation does not declare — but these four names are structurally
 * excluded from it (`CLIENT_SHAPING_PARAMS`, the admitted blind spot P2-9).
 * The one guard that would have caught this is blind to it by design, so the
 * check has to live here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { apiParams, CLIENT_SIDE_PARAMS } from '@bconnect/mcp-core';

import { createServer as createComplianceServer } from '../bconnect-compliance-mcp/src/index.js';
import { ComplianceModule } from '../bconnect-compliance-mcp/src/modules/compliance.js';
import { createServer as createSmServer } from '../bconnect-servermanagement-mcp/src/index.js';
import { ServerManagementModule } from '../bconnect-servermanagement-mcp/src/modules/servermanagement.js';

afterEach(() => { vi.restoreAllMocks(); });

async function connect(create: typeof createComplianceServer): Promise<Client> {
  const { server } = create({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'p16-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

const EMPTY = { page: 0, pageSize: 20, totalItems: 0, totalPages: 0, data: [] };

describe('apiParams — the helper itself', () => {
  it('removes every client-side flag and nothing else', () => {
    const out = apiParams({
      countOnly: false, detail: false, fields: ['a'], includeSteps: true,
      PageSize: 5, SearchQuery: 'win', OrderBy: 'Name asc',
    });
    expect(out).toEqual({ PageSize: 5, SearchQuery: 'win', OrderBy: 'Name asc' });
  });

  it('keeps Page/PageSize/OrderBy — they are the caller filters, not our vocabulary', () => {
    // The distinction from NON_FILTER_PARAMS, which drops these because the
    // COUNT path replaces them with the probe. On a list they are real.
    const out = apiParams({ Page: 2, PageSize: 50, OrderBy: 'Name desc' });
    expect(out).toEqual({ Page: 2, PageSize: 50, OrderBy: 'Name desc' });
  });

  it('tolerates undefined and does not mutate its input', () => {
    expect(apiParams(undefined)).toEqual({});
    const input = { countOnly: false, PageSize: 1 };
    apiParams(input);
    expect(input).toEqual({ countOnly: false, PageSize: 1 });
  });

  it('covers the whole documented vocabulary', () => {
    // If a flag is added to CLIENT_SIDE_PARAMS this stays true automatically;
    // if one is added to a tool schema and NOT here, that is the leak.
    const all = Object.fromEntries(CLIENT_SIDE_PARAMS.map((k) => [k, 'x']));
    expect(apiParams({ ...all, Keep: 1 })).toEqual({ Keep: 1 });
  });
});

describe('the flags do not reach the module on a real dispatch', () => {
  // Measured while writing these: on both servers the tool schema declares
  // `countOnly` and NOT `detail` / `fields`, and the unknown-parameter
  // validator refuses anything undeclared with -32602 before dispatch ever
  // runs. So on these nine servers `countOnly: false` is the ONLY client-side
  // flag that could reach the wire — the validator already bounds the rest.
  // That is a narrower blast radius than the register recorded, and it is why
  // this is hygiene rather than a correctness bug.

  it('compliance: countOnly:false is stripped (rest-spread shape)', async () => {
    const spy = vi
      .spyOn(ComplianceModule.prototype, 'getDetectedVulnerabilitiesByEndpoint')
      .mockResolvedValue(EMPTY as never);

    const client = await connect(createComplianceServer);
    await client.callTool({
      name: 'list_detected_vulnerabilities_by_endpoint',
      arguments: {
        endpointId: 'd0000001-0001-0001-0001-000000000001',
        PageSize: 5,
        countOnly: false,
      },
    });

    expect(spy).toHaveBeenCalledWith('d0000001-0001-0001-0001-000000000001', { PageSize: 5 });
    const params = spy.mock.calls[0]![1] as Record<string, unknown>;
    for (const flag of CLIENT_SIDE_PARAMS) {
      expect(params, `${flag} reached the module`).not.toHaveProperty(flag);
    }
  });

  it('servermanagement: same, on the whole-args shape', async () => {
    const spy = vi
      .spyOn(ServerManagementModule.prototype, 'getSecurityGroups')
      .mockResolvedValue(EMPTY as never);

    const client = await connect(createSmServer as unknown as typeof createComplianceServer);
    await client.callTool({
      name: 'list_security_groups',
      arguments: { PageSize: 5, countOnly: false },
    });

    const params = spy.mock.calls[0]![0] as Record<string, unknown>;
    expect(params).toEqual({ PageSize: 5 });
    for (const flag of CLIENT_SIDE_PARAMS) {
      expect(params, `${flag} reached the module`).not.toHaveProperty(flag);
    }
  });

  it('an undeclared shaping flag is refused before dispatch, not silently stripped', async () => {
    // The second line of defence, and the reason the leak was bounded. If a
    // future tool starts declaring `detail`, apiParams is what keeps it off
    // the wire; until then the validator refuses it outright.
    const client = await connect(createSmServer as unknown as typeof createComplianceServer);
    await expect(
      client.callTool({
        name: 'list_security_groups',
        arguments: { PageSize: 5, detail: true },
      })
    ).rejects.toThrow(/unknown parameter 'detail'/);
  });

  it('a real filter still gets through — this must not strip the caller\'s query', async () => {
    // The failure mode opposite to the one being fixed: an over-eager strip
    // that quietly drops the filter and answers about the whole estate.
    const spy = vi
      .spyOn(ServerManagementModule.prototype, 'getSecurityGroups')
      .mockResolvedValue(EMPTY as never);

    const client = await connect(createSmServer as unknown as typeof createComplianceServer);
    await client.callTool({
      name: 'list_security_groups',
      arguments: { Name: 'Admins', SearchQuery: 'adm', OrderBy: 'Name asc', countOnly: false },
    });

    expect(spy.mock.calls[0]![0]).toEqual({ Name: 'Admins', SearchQuery: 'adm', OrderBy: 'Name asc' });
  });
});
