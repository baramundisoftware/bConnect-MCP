/**
 * Argument-validation regression tests (upstream findings SEC-0 / INT-49 /
 * OPT-31 / SEC-11).
 *
 * ── What went wrong ─────────────────────────────────────────────────────────
 * createServer() called a local validateToolArguments() whose body was a
 * switch of ~65 bare fall-through case labels with no statements, under the
 * comment "Validate arguments first — pure, no side effects, fails fast on bad
 * input." It validated nothing, and the fully implemented rule table in
 * utils/mcp-tool-validation-rules.ts was imported by no one.
 *
 * Verified live against the labcorp.local bMS 26R1 estate before the fix:
 *   get_endpoint {id: "../LogicalGroups"}                    → 19 logical groups
 *   get_endpoint {id: "../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints"}
 *                                                            → 23 BitLocker records
 * Both are routes in a different bConnect module than the tool belongs to,
 * reachable because basePath is only a prefix and the id was interpolated into
 * the URL unvalidated and unencoded.
 *
 * ── Why these tests never touch the network ────────────────────────────────
 * Validation runs before the bConnect client is built, so a rejected call
 * makes no HTTP request at all. The credential env vars are cleared so that
 * the one deliberately-valid call fails on "credentials required"
 * (InternalError) rather than reaching a live bMS — which is also what makes
 * it a usable positive control: it proves a well-formed call still gets past
 * validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { connectTestClient } from './lib/connect.js';
import { DECLARED } from '../tool-catalogue.js';

// ── Where the rules moved ──────────────────────────────────────────────────
//
// `src/utils/mcp-tool-validation-rules.ts` is gone. It was a 370-line table
// whose own header admitted the failure mode — "the pre-existing rules had
// drifted away from the schemas" — because it restated by hand what the
// advertised `inputSchema` already said. Rules and schema are now the same
// declaration: `defineTools()` derives both from the 26R1 operation for every
// 1:1 wrapper, and the composites state them side by side in one object.
// `toolsWithValidationRules()` became `DECLARED.rules`.

/** A well-formed GUID that does not identify anything on any estate. */
const VALID_GUID = '00000000-0000-4000-8000-000000000000';

/** Call a tool and return the McpError it rejected with. */
async function callAndCatch(name: string, args: Record<string, unknown>): Promise<McpError> {
  const client = await connectTestClient();
  try {
    await client.callTool({ name, arguments: args });
  } catch (error) {
    return error as McpError;
  }
  throw new Error(`${name} resolved but was expected to reject`);
}

const CREDENTIAL_VARS = [
  'BCONNECT_API_KEY',
  'BCONNECT_USERNAME',
  'BCONNECT_PASSWORD',
] as const;

const savedCredentials: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of CREDENTIAL_VARS) {
    savedCredentials[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of CREDENTIAL_VARS) {
    if (savedCredentials[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedCredentials[key];
    }
  }
});

describe('path traversal in id parameters is rejected', () => {
  // The two payloads that actually worked against the live estate.
  it.each([
    ['../LogicalGroups'],
    ['../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints'],
  ])('get_endpoint rejects id %j with InvalidParams', async (id) => {
    const error = await callAndCatch('get_endpoint', { id });
    expect(error.code).toBe(ErrorCode.InvalidParams);
  });

  it('rejects traversal on the argument that reaches the EntraID path', async () => {
    // get_entra_id_data used to take `endpointId` and issue
    // GET /v2.0/Endpoints/{endpointId}/EntraIdData — a route no bConnect
    // release declares. 26R1 puts the GET on /v2.0/EntraIdData/{deviceId},
    // keyed on the Entra device id, so the argument that reaches the path is
    // `deviceId` and that is what the guard has to cover.
    const error = await callAndCatch('get_entra_id_data', {
      deviceId: '../../../servermanagement/v2.0/ApiKeys',
    });
    expect(error.code).toBe(ErrorCode.InvalidParams);
  });

  it('no longer accepts the endpointId that named a route bConnect never had', async () => {
    const error = await callAndCatch('get_entra_id_data', {
      endpointId: '00000000-0000-4000-8000-000000000000',
    });
    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('deviceId');
  });

  it('rejects percent-encoded traversal', async () => {
    const error = await callAndCatch('get_endpoint', { id: '%2e%2e%2fLogicalGroups' });
    expect(error.code).toBe(ErrorCode.InvalidParams);
  });

  it('rejects a logicalGroupId that is not a single path segment', async () => {
    // TOK-26 — this used to exercise list_group_endpoints, which is gone. The
    // surviving tool on that route interpolates the same argument into the
    // same URL, so the guard is the one being tested either way.
    const error = await callAndCatch('list_endpoints_by_logical_group', {
      logicalGroupId: '../../../jobs/v2.0/JobInstances',
    });
    expect(error.code).toBe(ErrorCode.InvalidParams);
  });

  it('rejects a malformed GUID with a message that says so', async () => {
    const error = await callAndCatch('get_endpoint', { id: 'not-a-guid' });
    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toMatch(/GUID/i);
  });
});

describe('unknown argument keys are rejected, not silently forwarded', () => {
  // The prior record's D6: bConnect answers HTTP 200 and ignores an
  // unrecognised query key, returning the FULL unfiltered set — so a
  // misspelled filter used to produce a confident wrong answer.
  it('names the offending key and lists what the tool accepts', async () => {
    const error = await callAndCatch('list_endpoints', { DisplyName: 'WORKSTATION1' });
    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain("'DisplyName'");
    expect(error.message).toContain('DisplayName');
  });

  // ── The collapse's own D6 guard ──────────────────────────────────────────
  //
  // `HostName` used to be unreachable on Android because `list_android_endpoints`
  // did not declare it. The collapsed `list_endpoints` advertises the UNION of
  // every platform's filters, so the schema no longer refuses this — the
  // dispatch guard does, from the same operation index the schema was built
  // from. Without it, GET /v2.0/AndroidEndpoints would answer HTTP 200 with the
  // whole unfiltered Android estate, presented as a HostName match.
  it('rejects a filter the chosen type\'s route does not declare', async () => {
    const error = await callAndCatch('list_endpoints', {
      type: 'AndroidEndpoint',
      HostName: 'anything',
    });
    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('HostName');
    // and it says which platforms DO have it, so the model can re-aim
    expect(error.message).toContain('WindowsEndpoint');
  });

  it('accepts the same filter for a type whose route does declare it', async () => {
    const error = await callAndCatch('list_endpoints', {
      type: 'WindowsEndpoint',
      HostName: 'WORKSTATION1',
    });
    expect(error.code).not.toBe(ErrorCode.InvalidParams);
  });

  it('refuses every filter for UnmanagedEndpoint, which declares none', async () => {
    // GET /v2.0/UnmanagedEndpoints takes no query parameters at all in 26R1.
    // The removed list_unmanaged_endpoints advertised four.
    const error = await callAndCatch('list_endpoints', {
      type: 'UnmanagedEndpoint',
      Page: 1,
    });
    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(error.message).toContain('no filters at all');
  });

  it('rejects a type the enum does not carry', async () => {
    const error = await callAndCatch('list_endpoints', { type: 'IndustrialEndpoint' });
    expect(error.code).toBe(ErrorCode.InvalidParams);
  });
});

describe('declared numeric bounds are enforced', () => {
  it('rejects PageSize above the API maximum of 1000', async () => {
    const error = await callAndCatch('list_endpoints', { PageSize: 100000 });
    expect(error.code).toBe(ErrorCode.InvalidParams);
  });

  it('rejects a negative Page', async () => {
    const error = await callAndCatch('list_endpoints', { Page: -1 });
    expect(error.code).toBe(ErrorCode.InvalidParams);
  });

  it('rejects a wrongly-typed PageSize', async () => {
    const error = await callAndCatch('list_endpoints', { PageSize: '20' });
    expect(error.code).toBe(ErrorCode.InvalidParams);
  });
});

describe('valid arguments still pass validation', () => {
  // Positive control. With no credentials configured the call fails when the
  // client is built — which happens strictly after validation — so an error
  // that is NOT InvalidParams proves the arguments were accepted.
  it('a well-formed GUID gets past validation', async () => {
    const error = await callAndCatch('get_endpoint', { id: VALID_GUID });
    expect(error.code).not.toBe(ErrorCode.InvalidParams);
  });

  it('declared list filters get past validation', async () => {
    const error = await callAndCatch('list_endpoints', {
      DisplayName: 'WORKSTATION1',
      PageSize: 20,
      Page: 0,
    });
    expect(error.code).not.toBe(ErrorCode.InvalidParams);
  });

  // Write tools are the sharpest positive control available without touching
  // the estate: with ALLOW_WRITE_OPERATIONS unset the write gate returns an
  // isError RESULT rather than rejecting, and the gate runs after validation.
  // A resolved isError therefore proves the arguments were accepted — and
  // these are exactly the tools whose rules were rewritten, because the
  // pre-existing table demanded `DisplayName` where the tools declare
  // `displayName`, and a `patchDocument` parameter none of them has.
  it.each([
    ['create_logical_group', { name: 'Rollout ring 1' }],
    ['create_windows_endpoint', { displayName: 'NEWBOX', hostName: 'newbox' }],
    ['create_android_endpoint', { displayName: 'Phone', androidEnterpriseProfileType: 'WorkProfile' }],
    ['update_endpoint', { id: VALID_GUID, type: 'WindowsEndpoint', displayName: 'Renamed' }],
    ['update_endpoint', { id: VALID_GUID, type: 'AndroidEndpoint', logicalGroupId: VALID_GUID }],
    // The two blob tools the survey made a precondition of this collapse:
    // update_network_endpoint took `updateData: object`, and now takes fields.
    ['update_endpoint', { id: VALID_GUID, type: 'NetworkEndpoint', hostName: 'sw-01' }],
    ['delete_endpoint', { id: VALID_GUID }],
    ['delete_endpoint', { id: VALID_GUID, type: 'UnmanagedEndpoint' }],
    ['create_maintenance_window_for_endpoint', { id: VALID_GUID, maintenanceWindowDefinitionType: 'Anytime' }],
    // and the field the four enrollment tools should always have sent
    ['start_enrollment', { id: VALID_GUID, type: 'WindowsEndpoint', enrollmentMailAddress: 'ops@example.com' }],
  ])('%s accepts its declared arguments and stops at the write gate', async (name, args) => {
    const client = await connectTestClient();
    const result = await client.callTool({ name, arguments: args as Record<string, unknown> });
    expect(result.isError, `${name} was rejected before reaching the write gate`).toBe(true);
    expect(JSON.stringify(result.content)).toContain('ALLOW_WRITE_OPERATIONS');
  });

  it('rejects a create_logical_group that omits its required name', async () => {
    const error = await callAndCatch('create_logical_group', { comment: 'no name' });
    expect(error.code).toBe(ErrorCode.InvalidParams);
  });
});

describe('rule coverage', () => {
  // TOK-20 — both directions of this check are about the DECLARED catalogue,
  // not the advertised one. A write tool hidden by a shut gate is still
  // reachable by name (and still refused by the gate), so it still needs rules;
  // measuring against the gate-closed list would have declared 39 of them
  // "orphaned" and quietly invited someone to delete their rules.
  const savedWriteGate = process.env.ALLOW_WRITE_OPERATIONS;

  beforeEach(() => {
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
  });

  afterEach(() => {
    if (savedWriteGate === undefined) {
      delete process.env.ALLOW_WRITE_OPERATIONS;
    } else {
      process.env.ALLOW_WRITE_OPERATIONS = savedWriteGate;
    }
  });

  // The old pair of tests here asked "does every registered tool have an entry
  // in the rules table" and "does the rules table carry an entry for a tool
  // that is not registered". Both are now true by construction — `defineTools()`
  // emits the schema and the rules from ONE declaration, keyed on the same
  // name — so asserting them would assert nothing. What is still falsifiable,
  // and is the invariant the old pair was reaching for, is that the rules cover
  // every parameter the schema advertises: a composite hand-authors its rules
  // and can forget one, and an unruled parameter accepts any type at all.
  it('every advertised parameter has a rule', async () => {
    const client = await connectTestClient();
    const { tools } = await client.listTools();

    const gaps: string[] = [];
    for (const tool of tools) {
      const advertised = Object.keys(tool.inputSchema.properties ?? {});
      const ruled = new Set(DECLARED.rulesFor(tool.name).map((rule) => rule.name));
      for (const parameter of advertised) {
        if (!ruled.has(parameter)) {
          gaps.push(`${tool.name}.${parameter}`);
        }
      }
    }
    expect(gaps, `advertised but unvalidated: ${gaps.join(', ')}`).toHaveLength(0);
  });

  it('carries no rule for a parameter no schema advertises', async () => {
    // The mirror image, and the one the deleted rules table failed: it required
    // `DisplayName` where the create tools declare `displayName`, and a
    // `patchDocument` parameter none of them had.
    const client = await connectTestClient();
    const { tools } = await client.listTools();

    const stray: string[] = [];
    for (const tool of tools) {
      const advertised = new Set(Object.keys(tool.inputSchema.properties ?? {}));
      for (const rule of DECLARED.rulesFor(tool.name)) {
        if (!advertised.has(rule.name)) {
          stray.push(`${tool.name}.${rule.name}`);
        }
      }
    }
    expect(stray, `ruled but never advertised: ${stray.join(', ')}`).toHaveLength(0);
  });

  it('the shaping parameters every list tool now advertises are typed', async () => {
    // TOK-21/TOK-25 — the unknown-key check only proves a name is declared.
    // Without a rule, detail:"yes" would be accepted and read as falsy, which
    // is the same silent-wrong-answer shape D6 produces for a misspelled
    // filter: the caller asked for the full record and got the compact one.
    const badDetail = await callAndCatch('list_endpoints', { detail: 'yes' });
    expect(badDetail.code).toBe(ErrorCode.InvalidParams);

    const badCount = await callAndCatch('list_endpoints', { countOnly: 'true' });
    expect(badCount.code).toBe(ErrorCode.InvalidParams);

    const badFields = await callAndCatch('list_endpoints', { fields: 'displayName' });
    expect(badFields.code).toBe(ErrorCode.InvalidParams);
  });
});
