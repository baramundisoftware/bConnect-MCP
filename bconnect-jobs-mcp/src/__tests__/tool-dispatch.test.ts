/**
 * Dispatch tests for the Class C revision (TOK-25, TOK-27, INT-47, INT-53).
 *
 * The surface tests next door prove what the catalogue *advertises*. These
 * prove the handler behind each advertised knob actually does the thing —
 * a declared `countOnly` that no case arm reads would return a full page to a
 * caller who asked for a number, and that failure is invisible to a schema
 * test.
 *
 * The bConnect client is replaced wholesale, so nothing here touches the
 * network or needs credentials. Every assertion is on what the handler asked
 * the client for, and on what it handed back.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BConnectApiError } from '@bconnect/mcp-core';

const GUID = '11111111-2222-3333-4444-555555555555';

const harness = vi.hoisted(() => {
  interface Call {
    method: string;
    id?: string;
    params?: Record<string, unknown>;
  }
  const calls: Call[] = [];
  const state: { error?: unknown; response?: unknown } = {};
  return { calls, state };
});

/** One instance row, cut down to the fields these assertions read. */
function instanceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: GUID,
    jobDefinitionName: 'INSTALL: Example',
    jobDefinitionDisplayName: 'INSTALL: Example',
    endpointId: '00000000-0000-4000-8000-0000000000e1',
    endpointName: 'CLIENT-01',
    endpointType: 'WindowsEndpoint',
    state: 'FinishedSuccessfully',
    stateDescription: 'Successfully finished at 04.02.2026 16:27:40',
    steps: [{ type: 'WindowsApplicationInstallation', state: 'FinishedSuccessfully' }],
    ...overrides,
  };
}

const PAGE = {
  currentPage: 0,
  pageSize: 20,
  totalPages: 12,
  totalItems: 229,
  data: [instanceRow(), instanceRow({ id: 'row-2', endpointName: 'CLIENT-02' })],
};

/** The envelope bConnect returns for a page past the end of the result set. */
const EMPTY_PAGE = { currentPage: 100000, pageSize: 1, totalPages: 229, totalItems: 229, data: [] };

vi.mock('../bconnect-client.js', () => {
  const { calls, state } = harness;

  const record =
    (method: string, hasId: boolean) =>
    async (...args: unknown[]): Promise<unknown> => {
      calls.push(
        hasId
          ? { method, id: args[0] as string, params: args[1] as Record<string, unknown> }
          : { method, params: args[0] as Record<string, unknown> }
      );
      if (state.error !== undefined) {
        const error = state.error;
        state.error = undefined;
        throw error;
      }
      return state.response ?? PAGE;
    };

  class BConnectClient {
    jobs = {
      getJobDefinitions: record('getJobDefinitions', false),
      getJobInstances: record('getJobInstances', false),
      getJobInstance: record('getJobInstance', true),
      getEndpointJobInstances: record('getEndpointJobInstances', true),
      getJobInstancesByJobDefinition: record('getJobInstancesByJobDefinition', true),
      getJobInstancesByLogicalGroup: record('getJobInstancesByLogicalGroup', true),
      getJobInstancesByStaticGroup: record('getJobInstancesByStaticGroup', true),
      getJobInstancesByDynamicGroup: record('getJobInstancesByDynamicGroup', true),
      getJobInstancesByUniversalDynamicGroup: record(
        'getJobInstancesByUniversalDynamicGroup',
        true
      ),
      getJobDefinitionsByFolder: record('getJobDefinitionsByFolder', true),
      getKioskReleases: record('getKioskReleases', false),
      getJobFolders: record('getJobFolders', false),
      getJobSubfolders: record('getJobSubfolders', true),
    };
    getHttpClient(): unknown {
      return {};
    }
  }
  return { BConnectClient };
});

// Imported after the mock is declared; vi.mock is hoisted above both.
const { connectTestClient } = await import('./lib/connect.js');

async function call(
  name: string,
  args: Record<string, unknown>
): Promise<{ isError?: boolean; content: { text: string }[] }> {
  const client = await connectTestClient({ baseUrl: 'https://bms.invalid', apiKey: 'test' });
  return (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
}

/** The JSON a tool answered with. */
async function payload(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await call(name, args);
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

beforeEach(() => {
  harness.calls.length = 0;
  harness.state.error = undefined;
  harness.state.response = undefined;
});

describe('TOK-27 — the job-instance list tools shape their response', () => {
  it('omits steps[] on the default call', async () => {
    const body = await payload('list_job_instances', {});

    expect((body.data as Record<string, unknown>[])[0]).not.toHaveProperty('steps');
    expect((body.meta as { dropped?: string[] }).dropped).toContain('steps');
  });

  it('returns the raw API payload for detail: true', async () => {
    const body = await payload('list_job_instances', { detail: true });

    expect(body).toEqual(PAGE);
    expect(body).not.toHaveProperty('meta');
  });

  it('shapes every one of the seven job-instance list tools', async () => {
    const cases: [string, Record<string, unknown>][] = [
      ['list_job_instances', {}],
      ['list_job_instances_by_endpoint', { endpointId: GUID }],
      ['list_job_instances_by_definition', { jobDefinitionId: GUID }],
      ['list_job_instances_by_logical_group', { logicalGroupId: GUID }],
      ['list_job_instances_by_static_group', { staticGroupId: GUID }],
      ['list_job_instances_by_dynamic_group', { dynamicGroupId: GUID }],
      ['list_job_instances_by_universal_dynamic_group', { universalDynamicGroupId: GUID }],
    ];

    for (const [name, args] of cases) {
      const body = await payload(name, args);
      expect((body.data as Record<string, unknown>[])[0], `${name} did not shape`).not.toHaveProperty(
        'steps'
      );
    }
  });

  it('leaves get_job_instance unshaped — it is the escape hatch the hint points at', async () => {
    harness.state.response = instanceRow();

    const body = await payload('get_job_instance', { id: GUID });

    expect(body).toHaveProperty('steps');
    expect(body).not.toHaveProperty('meta');
  });

  it('never puts a shaping flag on the wire (finding D6)', async () => {
    await call('list_job_instances', { detail: false, includeSteps: true, PageSize: 5 });

    expect(harness.calls[0].params).toEqual({ PageSize: 5 });
  });
});

describe('TOK-25 — countOnly asks for a page past the end instead of a page of rows', () => {
  it('requests PageSize=1 on a page beyond the result set and returns just the count', async () => {
    harness.state.response = EMPTY_PAGE;

    const body = await payload('list_job_instances', { countOnly: true, EndpointType: 'WindowsEndpoint' });

    expect(harness.calls[0].params).toMatchObject({ Page: 100000, PageSize: 1 });
    expect(body).toEqual({ totalItems: 229, filters: { EndpointType: 'WindowsEndpoint' } });
  });

  it('keeps the caller\'s filters so the number says what it counted', async () => {
    harness.state.response = EMPTY_PAGE;

    const body = await payload('list_job_instances_by_endpoint', {
      countOnly: true,
      endpointId: GUID,
    });

    expect(body).toEqual({ totalItems: 229, filters: { endpointId: GUID } });
    expect(harness.calls[0].id).toBe(GUID);
  });

  it('drops includeSteps rather than echoing it back as if it were a filter', async () => {
    harness.state.response = EMPTY_PAGE;

    const body = await payload('list_job_instances', { countOnly: true, includeSteps: true });

    expect(harness.calls[0].params).not.toHaveProperty('includeSteps');
    expect(body).toEqual({ totalItems: 229 });
  });

  it('is a real saving: the count is a fraction of the page it replaces', async () => {
    const full = await call('list_job_instances', {});
    harness.state.response = EMPTY_PAGE;
    const counted = await call('list_job_instances', { countOnly: true });

    const fullBytes = Buffer.byteLength(full.content[0].text, 'utf8');
    const countBytes = Buffer.byteLength(counted.content[0].text, 'utf8');
    expect(countBytes).toBeLessThan(fullBytes * 0.2);
  });
});

describe('TOK-27 — the protected composite tools are not weakened by the new default', () => {
  it('explain_job_failure still sees steps[]: it reports the failing step type', async () => {
    // The projection lives in the tool case arms, not in the client, so
    // explainJobFailure — which pages job instances through the same module —
    // keeps receiving whole rows. `failingStepTypes` is reachable only from
    // steps[], so a non-null value here proves the composite path is intact.
    delete process.env.BCONNECT_V11_USERNAME;
    delete process.env.BCONNECT_V11_PASSWORD;
    harness.state.response = {
      currentPage: 0,
      pageSize: 1000,
      totalPages: 1,
      totalItems: 1,
      data: [
        instanceRow({
          state: 'FinishedWithError',
          stateDescription: 'Could not connect to client.',
          steps: [
            {
              type: 'WindowsApplicationInstallation',
              state: 'FinishedWithError',
              stateDescription: 'Could not connect to client.',
            },
          ],
        }),
      ],
    };

    const body = await payload('explain_job_failure', {});
    const clusters = body.clusters as { failingStepTypes: string[] | null }[];

    expect(clusters[0].failingStepTypes).toEqual(['WindowsApplicationInstallation']);
  });
});

describe('INT-47 — the renamed tool reaches the same route', () => {
  it('list_job_instances_by_endpoint calls GET /Endpoints/{id}/JobInstances', async () => {
    await call('list_job_instances_by_endpoint', { endpointId: GUID, PageSize: 5 });

    expect(harness.calls[0]).toMatchObject({
      method: 'getEndpointJobInstances',
      id: GUID,
      params: { endpointId: GUID, PageSize: 5 },
    });
  });
});

describe('INT-53 — one error channel', () => {
  it('answers a 404 with a readable tool result instead of a protocol error', async () => {
    harness.state.error = new BConnectApiError(404, 'Resource not found. GET /jobs/v2.0/JobInstances');

    const result = await call('list_job_instances', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Resource not found. GET /jobs/v2.0/JobInstances');
  });

  it('answers a 403 the same way — the caller can act on it', async () => {
    harness.state.error = new BConnectApiError(403, 'Access denied. Insufficient permissions.');

    const result = await call('list_job_definitions', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Access denied. Insufficient permissions.');
  });

  it('keeps a 500 on the protocol channel with the text this handler always produced', async () => {
    harness.state.error = new BConnectApiError(
      500,
      'bConnect API returned an internal server error.'
    );

    await expect(call('list_job_instances', {})).rejects.toThrow(
      'Tool execution failed: bConnect API returned an internal server error.'
    );
  });

  it('keeps a 401 on the protocol channel — no argument the model picks fixes credentials', async () => {
    harness.state.error = new BConnectApiError(401, 'Authentication failed.');

    await expect(call('list_job_instances', {})).rejects.toThrow(
      'Tool execution failed: Authentication failed.'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// list_job_definitions is WIRED to the duplicate-display-name collapse
//
// job-instance-projection.test.ts proves the rule itself. It does not prove this
// tool calls it — reverting the case arm to a raw passthrough left that whole
// file green, which is a guard that cannot see the defect it exists for. This
// closes it end to end through the real dispatch handler.
//
// Measured live: 7,076 -> 6,353 B on page 1, and 58,836 -> 53,134 B (-9.7%)
// across all nine pages, with displayName omitted on 138 of 170 definitions.
// ─────────────────────────────────────────────────────────────────────────────

describe('list_job_definitions collapses a duplicate displayName', () => {
  const definitionsPage = {
    currentPage: 0,
    pageSize: 20,
    totalPages: 9,
    totalItems: 170,
    data: [
      { id: 'a', name: 'INSTALL: Adobe Reader DC-x64', displayName: 'INSTALL: Adobe Reader DC-x64', type: 'WindowsJobDefinition' },
      { id: 'b', name: 'OS: Windows 11 In-Place Upgrade', displayName: 'Windows 11 In-Place Upgrade', type: 'WindowsJobDefinition' },
    ],
  };

  it('omits it where it equals name and keeps it where it differs', async () => {
    harness.state.response = definitionsPage;
    const json = await payload('list_job_definitions', {});
    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2); // vacuity: the page survived
    expect('displayName' in rows[0]).toBe(false);
    expect(rows[1].displayName).toBe('Windows 11 In-Place Upgrade');
    expect((json.meta as Record<string, unknown>)?.omittedWhenEqual).toEqual({
      displayName: 'name',
    });
  });

  it('keeps `type`, which the review specifically told us not to drop', async () => {
    harness.state.response = definitionsPage;
    const rows = (await payload('list_job_definitions', {})).data as Record<string, unknown>[];
    expect(rows[0].type).toBe('WindowsJobDefinition');
  });

  it('leaves a page with no duplicates completely untouched, meta included', async () => {
    harness.state.response = {
      ...definitionsPage,
      data: [definitionsPage.data[1]],
    };
    const json = await payload('list_job_definitions', {});
    expect((json.data as Record<string, unknown>[])[0].displayName).toBe('Windows 11 In-Place Upgrade');
    // No collapse happened, so the note is not paid for.
    expect(json.meta).toBeUndefined();
  });
});
