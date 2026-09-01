/**
 * Argument-validation regression tests for bconnect-groups-mcp.
 *
 * ── The original guard (OPT-31 / SEC-1 / INT-49) ────────────────────────────
 * src/index.ts once ran a local `validateToolArguments()` whose switch had 33
 * fall-through case labels and no statements, so a caller-supplied group id went
 * straight into a template-literal URL path. `basePath` is only a prefix, so a
 * `../` segment escaped the module: the sibling servers' live evidence is
 * `get_job_definition {id: "../../../servermanagement/v2.0/ApiKeys"}` returning
 * the bMS API-key inventory. The traversal payload must still stop at the MCP
 * boundary with InvalidParams (-32602), before any HTTP client is built — which
 * is why these tests need no credentials and reach no network.
 *
 * ── What TOK-22 added ───────────────────────────────────────────────────────
 * The two collapsed tools advertise a surface WIDER than any single route they
 * dispatch to: two enums whose cross-product is 45 combinations of which 33 are
 * real, and the union of six value filters of which each route declares between
 * zero and four. Per D6 bConnect answers HTTP 200 and silently ignores a
 * parameter it does not declare — so if the extra surface were forwarded
 * unchecked, `{memberType:"android", Domain:"CORP"}` would return every Android
 * device in the group while looking like a filtered answer. That is the failure
 * shape of D14a, which made a 20-endpoint group report zero.
 *
 * The three assertions that keep the token saving honest are therefore:
 * unsupported enum pair, inapplicable filter, unknown parameter.
 */

import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { createServer } from '../index.js';

const TRAVERSAL_ID = '../../../servermanagement/v2.0/ApiKeys';
const GROUP_ID = '11111111-2222-3333-4444-555555555555';
const AD_USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

interface RegisteredTool {
  name: string;
  inputSchema?: { required?: string[] };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { server } = createServer();
  // @ts-expect-error: accessing internal handler for testing, as server.test.ts does
  const handler = server._requestHandlers.get('tools/call');
  return handler?.({ method: 'tools/call', params: { name, arguments: args } });
}

async function listTools(): Promise<RegisteredTool[]> {
  const { server } = createServer();
  // @ts-expect-error: accessing internal handler for testing, as server.test.ts does
  const result = await server._requestHandlers.get('tools/list')?.({ method: 'tools/list' });
  return (result?.tools ?? []) as RegisteredTool[];
}

async function rejection(name: string, args: Record<string, unknown>): Promise<{ code?: number; message?: string }> {
  let thrown: unknown;
  try {
    await callTool(name, args);
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `${name} must reject ${JSON.stringify(args)}`).toBeDefined();
  return thrown as { code?: number; message?: string };
}

async function expectInvalidParams(name: string, args: Record<string, unknown>): Promise<string> {
  const err = await rejection(name, args);
  expect(err.code, `${name} must fail with InvalidParams, got: ${err.message}`).toBe(
    ErrorCode.InvalidParams
  );
  return err.message ?? '';
}

describe('bconnect-groups-mcp — path traversal in id parameters', () => {
  it('rejects a "../" groupId', async () => {
    await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: TRAVERSAL_ID,
    });
  });

  it('rejects a "../" groupId on every group kind', async () => {
    for (const groupKind of ['logical', 'static', 'dynamic', 'universalDynamic']) {
      await expectInvalidParams('list_group_members', { groupKind, groupId: '../LogicalGroups' });
    }
  });

  it('rejects a "../" adUserId', async () => {
    await expectInvalidParams('list_ad_user_endpoints', { adUserId: TRAVERSAL_ID });
  });

  it('rejects the percent-encoded form of the same payload', async () => {
    await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: '%2e%2e%2f%2e%2e%2fservermanagement%2fv2.0%2fApiKeys',
    });
  });
});

describe('bconnect-groups-mcp — ordinary argument validation', () => {
  it('rejects a malformed GUID with InvalidParams rather than passing it to the API', async () => {
    await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: 'not-a-guid',
    });
  });

  it('rejects a missing required id', async () => {
    await expectInvalidParams('list_group_members', { groupKind: 'logical' });
    await expectInvalidParams('list_ad_user_endpoints', {});
  });

  it('rejects a missing groupKind — there is no safe default for it', async () => {
    await expectInvalidParams('list_group_members', { groupId: GROUP_ID });
  });

  it('rejects an out-of-range PageSize', async () => {
    await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      PageSize: 5000,
    });
  });

  it('rejects a non-boolean countOnly', async () => {
    await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      countOnly: 'yes',
    });
  });

  it('has a validation case for every registered tool that declares a required argument', async () => {
    // Drift guard. A tool added to the catalogue but forgotten in
    // validateToolParameters() would silently reinstate the unvalidated path
    // that OPT-31 / SEC-1 describe, and nothing else in the suite would notice.
    const tools = await listTools();
    const withRequired = tools.filter((t) => (t.inputSchema?.required?.length ?? 0) > 0);
    expect(withRequired.length).toBe(2);

    const unvalidated: string[] = [];
    for (const tool of withRequired) {
      let threw = false;
      try {
        await callTool(tool.name, {});
      } catch (error) {
        threw = (error as { code?: number }).code === ErrorCode.InvalidParams;
      }
      if (!threw) {
        unvalidated.push(tool.name);
      }
    }

    expect(unvalidated, 'these tools accept empty arguments — no validation rules wired').toEqual([]);
  });
});

describe('TOK-22 — the enum surface is wider than any one route', () => {
  it('rejects an unknown groupKind and names the four that exist', async () => {
    const message = await expectInvalidParams('list_group_members', {
      groupKind: 'smart',
      groupId: GROUP_ID,
    });
    expect(message).toContain('logical');
    expect(message).toContain('universalDynamic');
  });

  it('rejects an unknown memberType', async () => {
    await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      memberType: 'chromeos',
    });
  });

  it.each([
    ['dynamic', 'android'],
    ['dynamic', 'ios'],
    ['dynamic', 'linux'],
    ['dynamic', 'mac'],
    ['dynamic', 'network'],
    // MIGRATED (Decision 1): ['dynamic', 'industrial'] used to sit here as an
    // unsupported PAIR. 26R1 deleted the IndustrialEndpoints API, so 'industrial'
    // is not an unsupported combination any more — it is not a member type at
    // all, and it gets its own removal message. Asserted below.
    ['dynamic', 'childGroups'],
    ['static', 'childGroups'],
    ['universalDynamic', 'childGroups'],
  ])(
    'refuses the unsupported pair (%s, %s) instead of building a URL that does not exist',
    async (groupKind, memberType) => {
      const message = await expectInvalidParams('list_group_members', {
        groupKind,
        groupId: GROUP_ID,
        memberType,
      });
      expect(message).toContain(`memberType '${memberType}' is not available`);
      expect(message, 'the refusal must say what IS available').toContain('supports:');
    }
  );

  // The counterpart — that the pairs which DO exist are not caught by the same
  // check — is asserted in dispatch.test.ts, which walks every cell and watches
  // which module method each one calls.

  it.each(['logical', 'static', 'universalDynamic', 'dynamic'])(
    "answers memberType 'industrial' on a %s group with the removal reason, not a typo hint",
    async (groupKind) => {
      // MIGRATED from the ['dynamic','industrial'] row above (Decision 1/4).
      // Whatever the group kind, the answer must name 26R1 and the API that
      // went away — the failure someone upgrading from v26.1.7 will actually
      // hit, and the one place a few lines of code turn confusion into a fact.
      const message = await expectInvalidParams('list_group_members', {
        groupKind,
        groupId: GROUP_ID,
        memberType: 'industrial',
      });
      expect(message).toContain('bConnect 26R1 removed the');
      expect(message).toContain('IndustrialEndpoints');
      expect(message).toContain('no replacement to call');
      expect(message).not.toContain('is not available for groupKind');
    }
  );
});

describe('TOK-22 / D6 — a filter the chosen route does not declare is refused, not dropped', () => {
  it('refuses Domain on an android route and names the filter that route does declare', async () => {
    const message = await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      memberType: 'android',
      Domain: 'LABCORP',
    });
    expect(message).toContain('Domain');
    expect(message).toContain('DisplayName');
  });

  it('refuses HostName on an ios route', async () => {
    await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      memberType: 'ios',
      HostName: 'ipad-1',
    });
  });

  it('refuses every value filter on a childGroups route except the three it declares', async () => {
    // MIGRATED (Decision 1). This test used to use memberType 'industrial',
    // which was the only route declaring NO filters — 26R1 deleted it, so the
    // "declares no value filters" branch of assertFiltersApply has no member
    // type left to exercise. childGroups is the narrowest remaining route
    // (Name, Dip, Domain only), so it still proves that the advertised union is
    // enforced per route rather than forwarded whole.
    const message = await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      memberType: 'childGroups',
      HostName: 'plc-1',
    });
    expect(message).toContain('HostName');
    expect(message).toContain('That route declares: Name, Dip, Domain.');
  });

  it('refuses Name on an endpoint route — Name belongs to childGroups', async () => {
    await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      memberType: 'windows',
      Name: 'Sales',
    });
  });

  // That the applicable filters ARE accepted and forwarded — Name/Dip on
  // childGroups, Domain/EntraIdDeviceId on windows — is asserted in
  // dispatch.test.ts, where the outgoing request parameters are visible.

  it('refuses includeSubfolders on a group kind that has no hierarchy', async () => {
    for (const groupKind of ['static', 'dynamic', 'universalDynamic']) {
      const message = await expectInvalidParams('list_group_members', {
        groupKind,
        groupId: GROUP_ID,
        includeSubfolders: true,
      });
      expect(message).toContain("includeSubfolders applies to groupKind 'logical' only");
    }
  });

  it('refuses a group-only filter on the AD-user tool', async () => {
    await expectInvalidParams('list_ad_user_endpoints', {
      adUserId: AD_USER_ID,
      endpointType: 'android',
      Domain: 'LABCORP',
    });
  });
});

describe('D6 — an unknown parameter is refused rather than answered with an unfiltered 200', () => {
  it('rejects a misspelt filter and lists what the tool accepts', async () => {
    const message = await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      DispalyName: 'WORKSTATION1',
    });
    expect(message).toContain('Unknown parameter(s)');
    expect(message).toContain('DispalyName');
    expect(message).toContain('DisplayName');
  });

  it('rejects the pre-collapse parameter name a migrating client would send', async () => {
    await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      logicalGroupId: GROUP_ID,
    });
  });

  it('rejects includeSubGroups — the misspelling of D14a', async () => {
    await expectInvalidParams('list_group_members', {
      groupKind: 'logical',
      groupId: GROUP_ID,
      includeSubGroups: true,
    });
  });
});

describe('the 33 collapsed tool names are gone from dispatch, not just from the catalogue', () => {
  it.each([
    'list_endpoints_by_logical_group',
    'list_windows_endpoints_by_logical_group',
    'list_endpoints_by_static_group',
    'list_endpoints_by_dynamic_group',
    'list_endpoints_by_universal_dynamic_group',
    'list_endpoints_by_ad_user',
  ])('%s answers MethodNotFound', async (name) => {
    const err = await rejection(name, { logicalGroupId: GROUP_ID });
    expect(err.code).toBe(ErrorCode.MethodNotFound);
    expect(err.message).toContain(`Unknown tool: ${name}`);
  });
});
