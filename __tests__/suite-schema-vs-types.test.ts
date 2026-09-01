/**
 * T2 — assert every tool's schema agrees with the generated OpenAPI types.
 * This is the test that closes root cause R1.
 *
 * R1: tool metadata is hand-maintained beside `src/generated/`, and nothing
 * asserts the two agree. That single gap produced B3 and B6 (three `create_*`
 * tools that can never succeed), D12 (five tools sending an undescribed
 * payload), D14a (27 tools unable to request hierarchy, one of them sending a
 * misspelled flag that made a 20-endpoint group report zero), D14b (81 tools
 * omitting filters the API already implements) and D23 (two tools sharing a
 * name whose parameter sets had drifted apart). Each was found by hand, one at
 * a time. This file is the assertion that stops the class recurring.
 *
 * ── What it checks, and why in this order ────────────────────────────────
 *
 *  1. The tool does not SEND anything the operation does not declare. This is
 *     the correctness half. Per D6 the API answers HTTP 200 and quietly drops
 *     the parameter, so the caller gets a complete-looking, wrong answer —
 *     `includeSubGroups` vs `includeSubfolders` returned 0 endpoints where
 *     there were 20.
 *  2. Enum-typed parameters carry their allowed values. D6 has an exception
 *     that inverts the usual advice: an unknown *parameter* is ignored with a
 *     200, but a bad value on an *enum* parameter returns HTTP 400. So typing
 *     an enum filter as a bare string is worse than omitting it — the model
 *     guesses, and the call fails. The spec hides these behind `allOf`/`$ref`,
 *     which is exactly why a careful reader still types them as strings; the
 *     generated types render them as a plain union, which is the other reason
 *     this file reads `src/generated/` rather than `openapi-specs/`.
 *  3. Request bodies: every field the schema requires is exposed AND required
 *     by the tool (B3/B6), and no tool forwards an undescribed wrapper (D12).
 *  4. The route and verb the module builds exist in the types at all.
 *  5. Declared filters the tool omits (D14b). Not a bug on its own, but drift
 *     worth surfacing — exposing one filter was worth −82.8% payload on
 *     `list_installed_windows_software`. Pinned as a set so it can shrink but
 *     never grow.
 *
 * Sibling: `suite-tool-names.test.ts` asserts that two tools sharing a name
 * expose the same parameters (D23). That is the same drift measured between
 * two servers; this file measures it between a server and its own types. Both
 * run from `__tests__/`, which `scripts/ci-local.sh` executes as one step,
 * because a per-server suite structurally cannot catch "12 of 13 were fixed".
 *
 * ── On the allowlists ────────────────────────────────────────────────────
 *
 * Nothing here is skipped. Every exception is named, with the reason it is
 * there, and a companion test asserts each one still reproduces — so a list
 * cannot quietly go stale and start hiding a regression. Two kinds:
 *
 *   ACCEPTED_*    genuinely fine; the check is wrong about this row.
 *   OPEN_*        real drift, deliberately NOT fixed by the stream that wrote
 *                 this test (it does not own those files). Each carries the
 *                 finding it belongs to. These lists exist to be emptied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, join } from 'node:path';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDriftReport, keysOf, explain, type DriftReport, type ServerLoader, type ToolDef } from './lib/schema-drift.js';
import { loadShippedSpec } from './lib/generated-openapi.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

// Written out one per server for the same reason as suite-tool-names.test.ts:
// the bundler cannot resolve a fully dynamic specifier, so a new server has to
// be added here deliberately rather than being silently unchecked.
const SERVERS: Record<string, ServerLoader> = {
  'bconnect-activedirectory-mcp': () => import('../bconnect-activedirectory-mcp/src/index.js'),
  'bconnect-assets-mcp': () => import('../bconnect-assets-mcp/src/index.js'),
  'bconnect-compliance-mcp': () => import('../bconnect-compliance-mcp/src/index.js'),
  'bconnect-defensecontrol-mcp': () => import('../bconnect-defensecontrol-mcp/src/index.js'),
  'bconnect-endpoints-mcp': () => import('../bconnect-endpoints-mcp/src/index.js'),
  'bconnect-groups-mcp': () => import('../bconnect-groups-mcp/src/index.js'),
  'bconnect-insights-mcp': () => import('../bconnect-insights-mcp/src/index.js'),
  'bconnect-jobs-mcp': () => import('../bconnect-jobs-mcp/src/index.js'),
  'bconnect-operatingsystems-mcp': () => import('../bconnect-operatingsystems-mcp/src/index.js'),
  'bconnect-servermanagement-mcp': () => import('../bconnect-servermanagement-mcp/src/index.js'),
  'bconnect-software-mcp': () => import('../bconnect-software-mcp/src/index.js'),
  'bconnect-universaldynamicgroups-mcp': () => import('../bconnect-universaldynamicgroups-mcp/src/index.js'),
  'bconnect-updatemanagement-mcp': () => import('../bconnect-updatemanagement-mcp/src/index.js'),
  'bconnect-variables-mcp': () => import('../bconnect-variables-mcp/src/index.js'),
};

// ───────────────────────────────────────────────────────────────────────────
// Composite tools added by this evaluation. Each answers a question by
// joining several operations, so there is no single operation to check a
// schema against — `get_vulnerability_exposure` alone replaces a 41-request,
// 31 MB join. Listed rather than pattern-matched so a new one is a conscious
// addition and an API-backed tool cannot hide among them.
// ───────────────────────────────────────────────────────────────────────────
const COMPOSITE_TOOLS = [
  'bconnect-compliance-mcp/get_vulnerability_exposure',
  'bconnect-compliance-mcp/get_unpatched_endpoints',
  'bconnect-defensecontrol-mcp/get_security_posture',
  'bconnect-endpoints-mcp/get_fleet_summary',
  'bconnect-endpoints-mcp/get_stale_endpoints',
  'bconnect-jobs-mcp/preview_assignment',
  'bconnect-jobs-mcp/explain_job_failure',
  'bconnect-jobs-mcp/diagnose_job',
  // The whole insights server is composite by construction — it owns no routes
  // and reads other modules'. Added 2026-08-14, three days late: this file's
  // SERVERS map never listed the server, so its five tools were not loaded and
  // could not have appeared here. See the map above.
  'bconnect-insights-mcp/get_estate_risk_briefing',
  'bconnect-insights-mcp/get_endpoint_briefing',
  'bconnect-insights-mcp/get_patch_readiness',
  'bconnect-insights-mcp/get_deployment_coverage',
  'bconnect-insights-mcp/get_endpoint_reach',
];

// Tools whose module method issues no HTTP call of its own. Empty since the
// 26R1 revision: `search_endpoints` — which delegated to getEndpoints(), so
// mapping it would have attributed someone else's contract — was removed
// outright (it duplicated GET /v2.0/Endpoints with lower-cased paging;
// list_endpoints({ SearchQuery }) is the replacement, see removed-tools.ts).
const DELEGATING_TOOLS: string[] = [];

// ───────────────────────────────────────────────────────────────────────────
// Multi-route dispatchers: tools that pick the module method at CALL time, so
// there is no single operation to check the schema against and they are
// deliberately unmapped here.
//
// Two generations of the same merge:
//
//  - TOK-3/TOK-22: the 33 per-(group, member-type) tools became the two
//    groups-mcp dispatchers, driven by the sparse route matrix in
//    bconnect-groups-mcp/src/utils/group-member-matrix.ts (39 concrete routes).
//  - The 26R1 family collapse: the per-platform endpoints tools became six
//    enum-parameterised dispatchers driven by the route tables in
//    bconnect-endpoints-mcp/src/endpoint-types.ts. These absorb the tools that
//    several allowlist rows below used to name — the re-points, entry by entry:
//      list_endpoints                    <- list_{windows,linux,mac,android,ios,
//                                           network,industrial,unmanaged}_endpoints.
//                                           The OrderBy/SearchQuery omissions
//                                           pinned on the windows/linux/mac rows
//                                           of OPEN_OMITTED_QUERY_PARAMS are
//                                           FIXED: the union schema exposes both.
//      list_endpoints_by_logical_group   <- list_windows_endpoints_by_logical_group
//                                           (its KNOWN_STALE_TYPES row died with
//                                           the regeneration; see below).
//      get_endpoint                      <- get_*_endpoint, incl. the unmanaged/
//                                           industrial variants.
//      update_endpoint                   <- update_*_endpoint. The pre-merge OPEN
//                                           finding (serialNumber emitted for
//                                           Android, formerly
//                                           update_android_endpoint.serialNumber in
//                                           OPEN_UNDECLARED_PARAMS) is FIXED, and
//                                           this comment said "STILL LIVE" long
//                                           after it was not — the register
//                                           contradicting the code it points at is
//                                           its own defect class. Ground truth:
//                                           UPDATABLE_FIELDS.AndroidEndpoint
//                                           (endpoint-types.ts) lists the six
//                                           modifiable properties from the 26R1
//                                           PATCH example and deliberately NOT
//                                           serialNumber (the Swagger response-
//                                           example trap is documented there), and
//                                           family-collapse.test.ts refuses the
//                                           field outright.
//      delete_endpoint                   <- delete_unmanaged_endpoint (and platform
//                                           deletes).
//      start_enrollment                  <- start_{windows,mac}_enrollment. Their
//                                           emailRecipient defect (advertised name
//                                           no schema declares) is FIXED: the tool
//                                           takes enrollmentMailAddress and projects
//                                           the body through enrollmentFieldsFor();
//                                           the server's family-collapse.test.ts
//                                           asserts the wire body.
//
// The D6 hazard the merges could reintroduce — advertising the union of every
// route's filters and forwarding them to routes that do not declare them — is
// enforced at call time (`filtersFor()` in groups-mcp, `assertFiltersDeclared()`
// in endpoints-mcp refuse an undeclared filter with -32602), and the matrices
// are pinned by each server's own dispatch/family-collapse tests.
//
// Historical note, resolved by the 2026-08-02 regeneration: the windows member
// type's EntraIdDeviceId filter (formerly five groups-mcp KNOWN_STALE_TYPES
// rows) is now in the vendored types; the industrial member routes are gone
// from spec and types alike (26R1 removed the endpoint type).
// ───────────────────────────────────────────────────────────────────────────
const MULTI_ROUTE_TOOLS = [
  'bconnect-groups-mcp/list_group_members',
  'bconnect-groups-mcp/list_ad_user_endpoints',
  'bconnect-endpoints-mcp/list_endpoints',
  'bconnect-endpoints-mcp/list_endpoints_by_logical_group',
  'bconnect-endpoints-mcp/get_endpoint',
  'bconnect-endpoints-mcp/update_endpoint',
  'bconnect-endpoints-mcp/delete_endpoint',
  'bconnect-endpoints-mcp/start_enrollment',
];

// ───────────────────────────────────────────────────────────────────────────
// OPEN — advertised tools with NO case in the executing switch. Calling one
// falls through to `default:` and throws MethodNotFound ("Unknown tool") at
// runtime, so the tool cannot work at all. A defect in the server, pinned here
// so it cannot hide inside the dispatcher accounting; this list exists to be
// emptied by an upstream fix, never added to.
// ───────────────────────────────────────────────────────────────────────────
// Tools advertised in a catalogue that reach no case arm in the executing
// switch. Empty, and it should stay that way.
//
// It held one entry: the 26R1 family collapse rewrote the endpoints switch and
// dropped `delete_maintenance_window_for_logical_group`, so the catalogue
// advertised a tool that answered "Unknown tool" while its endpoint-scoped twin
// worked — which is why nobody noticed. The case arm was restored rather than
// the tool being withdrawn.
//
// The general defect is now guarded directly by
// __tests__/every-advertised-tool-dispatches.test.ts, which drives every
// advertised tool through real dispatch. Note that guard needs dummy
// credentials to work: without them the client provider throws before the
// switch is consulted and every tool looks alike.
const OPEN_MISSING_DISPATCH: string[] = [];

// ───────────────────────────────────────────────────────────────────────────
// Routes with no entry in any generated types file — these tools cannot be
// checked at all, and are reported as unverifiable rather than passed.
// ───────────────────────────────────────────────────────────────────────────
// Tools whose URL appears in no generated types file, so nothing about them can
// be checked. Empty — and the way it emptied is the point.
//
// It held three entries, all "route drift" pinned as unverifiable rather than
// investigated. A coverage audit against all 264 declared operations forced the
// question, and both were real bugs the suite had shipped:
//
//   compliance list_mobile_device_rules / get_mobile_device_rule called
//   `/MobileDeviceRules`, which answers 404. The spec declares `/Rules`, which
//   answers 200. Those two tools had never returned data.
//
//   defensecontrol update_bitlocker_pin PATCHed `/Pin`, a route the API does not
//   serve — the original evaluation's finding B12, carried unfixed. The spec
//   declares `/Secrets`.
//
// The lesson worth keeping: "the types cannot verify this" is not the same as
// "this is fine". An entry parked here is an unanswered question, and both of
// these answered "broken" the moment anyone asked the server.
const UNVERIFIABLE_ROUTES: string[] = [];

// ───────────────────────────────────────────────────────────────────────────
// OPEN — the route exists but the module uses a verb it does not declare.
// Currently empty, and worth keeping that way: the two candidates turned out
// to be stale types, not verb bugs (see KNOWN_STALE_TYPE_ROUTES).
// ───────────────────────────────────────────────────────────────────────────
const OPEN_VERB_DRIFT: string[] = [];

// ───────────────────────────────────────────────────────────────────────────
// The route (or the verb on it) IS in the shipped 26R1 spec; the vendored
// generated types are behind it. Regenerate — do NOT change these tools.
//
// Empty since the 2026-08-02 regeneration of every `src/generated/*-types.ts`
// from the 26R1 specs. It used to carry ten rows with a single root cause —
// endpoints-types.ts was generated from 25R2 — in three classes worth
// remembering if this list ever refills: routes 26R1 added (the unmanaged and
// EntraID tools; the two extra assets paths), and a verb swap (26R1 replaced
// PUT with PATCH on the two MaintenanceWindow update routes — the tools sent
// PATCH and were right, and the naive "route declares only PUT, so the tool is
// broken" reading would have sent someone to break two working write tools).
// ───────────────────────────────────────────────────────────────────────────
const KNOWN_STALE_TYPE_ROUTES: string[] = [];

// ───────────────────────────────────────────────────────────────────────────
// OPEN — the tool sends something the operation does not declare. This is
// D14a's class: dropped with a 200, or rejected outright where the body is
// closed. Every entry here is a defect awaiting an upstream fix, not an
// exemption; the list is meant to reach zero.
// ───────────────────────────────────────────────────────────────────────────
const OPEN_UNDECLARED_PARAMS: string[] = [
  // EMPTY as of 2026-08-11 — the list reached the zero it was meant to reach.
  // The four entries that sat here (create_kiosk_release.targetId,
  // create_job_instance.scheduledStartTime, create_software_bundle.folderId,
  // add_application_to_bundle.order) were fixed together as
  // TOOL-REVIEW-MATRIX.md H2/H3 and software F1/F2. Two guards now refuse the
  // class outright instead of registering it: Rule H in
  // descriptions-match-routes.test.ts (schema property vs the shipped spec's
  // operation, wrapper-aware) and this file's own check — so a new entry here
  // should be a rare, justified deferral, not a filing cabinet.

  // Rows retired by the 26R1 family collapse:
  //  - update_android_endpoint.serialNumber — the tool was merged into
  //    update_endpoint and the drift went with it, still live but out of this
  //    file's static reach; see the update_endpoint note on MULTI_ROUTE_TOOLS.
  //  - start_{windows,mac}_enrollment.emailRecipient — FIXED by the merge. The
  //    old tools advertised `emailRecipient` (a name no enrollment schema
  //    declares; the field is `enrollmentMailAddress`) and posted their whole
  //    argument object as a body the spec closes with
  //    `additionalProperties: false`, so using the advertised parameter was a
  //    guaranteed 400. start_enrollment advertises enrollmentMailAddress and
  //    projects the body through enrollmentFieldsFor().
];

// ───────────────────────────────────────────────────────────────────────────
// Enum-typed parameters. Absence of the value list is the finding; a value the
// API does not accept would be worse and there are currently none.
// ───────────────────────────────────────────────────────────────────────────
const OPEN_ENUM_DRIFT = [
  // NEW — and it is B3's own tool. B3 was fixed by adding `category` and
  // `scopes`, but `scopes` is typed `array of string` with no value list, and
  // `type` likewise. Both are enums. Per D6's exception a wrong guess here is a
  // 400, so the tool that B3 made *able* to succeed still fails on any model
  // that guesses a scope name.
  'bconnect-variables-mcp/create_variable_definition.scopes',
  'bconnect-variables-mcp/create_variable_definition.type',
  // NEW — `AssetForCreation.ownerType` is an enum of four values, exposed as a
  // free string.
  'bconnect-assets-mcp/create_asset.ownerType',
];

const ACCEPTED_ENUM_OMISSIONS = [
  // The only omitted value in each of these is the deprecated Industrial one,
  // which is correct to leave out. 26R1 renamed it `Deprecated_IndustrialEndpoint`
  // and documents it as "Removed in 26.1. Keep to avoid gaps in enum values."
  // (The regenerated types now spell it that way everywhere; the old
  // `IndustrialEndpoint` spelling died with the stale 25R2 generation.)
  'bconnect-jobs-mcp/list_job_instances.EndpointType',
  'bconnect-jobs-mcp/list_job_instances_by_definition.EndpointType',
  'bconnect-variables-mcp/list_variable_definitions.Scope',
  'bconnect-variables-mcp/list_variable_instances.Scope',
  'bconnect-variables-mcp/list_variable_instances_by_endpoint.Scope',
  'bconnect-variables-mcp/list_variable_instances_by_logical_group.Scope',
  'bconnect-variables-mcp/list_variable_instances_by_ad_object.Scope',
  'bconnect-variables-mcp/list_variable_instances_by_job_definition.Scope',
  'bconnect-variables-mcp/list_variable_instances_by_application.Scope',
];

// ───────────────────────────────────────────────────────────────────────────
// OPEN — D12. The handler forwards a nested object the tool never describes,
// so an LLM has to guess the field names and the validator can only check that
// *an object* arrived.
// ───────────────────────────────────────────────────────────────────────────
const OPEN_WRAPPER_BODIES = [
  'bconnect-operatingsystems-mcp/create_os_folder',
  'bconnect-servermanagement-mcp/create_security_group',
  'bconnect-servermanagement-mcp/create_security_profile',
  // The six endpoints-mcp rows that used to follow are gone for three reasons,
  // recorded so the pattern is recognised if it comes back:
  //  - create_network_endpoint and the two create_maintenance_window_for_*
  //    tools were flattened — they now describe named fields and
  //    maintenanceWindowBody()/args project the body, so the D12 shape (an
  //    opaque `…Data` object an LLM has to guess the fields of) is fixed.
  //  - create/update_industrial_endpoint were deleted with the rest of the
  //    industrial surface (26R1 removed the endpoint type and its routes).
  //  - update_network_endpoint — the PATCH twin of the pattern, an opaque
  //    `updateData` on a route whose example enumerates the properties it
  //    should have been flattened to — was merged into update_endpoint, which
  //    takes named per-type fields (see endpoint-types.ts UPDATABLE_FIELDS:
  //    "this is where the two `updateData: object` blob tools went").
];

// ───────────────────────────────────────────────────────────────────────────
// OPEN — B3/B6. A field the request schema requires that the tool cannot
// supply (guaranteed 400) or exposes without requiring (fails only sometimes,
// which is worse to diagnose).
// ───────────────────────────────────────────────────────────────────────────
const OPEN_BODY_REQUIRED: string[] = [
  // EMPTY as of 2026-08-11. create_kiosk_release now exposes AND requires
  // assignmentTargetId; create_job_instance now requires endpointId — both
  // fixed with TOOL-REVIEW-MATRIX.md H2/H3.
  // create_linux_endpoint and create_windows_endpoint were fixed upstream by
  // the 26R1 revision (both now expose AND require the fields their creation
  // schemas require) and their rows retired.
];

// ───────────────────────────────────────────────────────────────────────────
// D14b — declared query filters no tool exposes. Pinned as an exact set: it
// may shrink, never grow. Two groups, and only the second is a correctness
// issue rather than an ergonomic one.
// ───────────────────────────────────────────────────────────────────────────
const OPEN_OMITTED_QUERY_PARAMS = [
  // (a) OrderBy / SearchQuery only. The D14b fix pass deliberately stopped at
  // value filters and hierarchy flags; these change result *order* or offer a
  // free-text search, neither of which changes an answer's correctness. Note
  // D15 before adding SearchQuery to job-instance tools — it matches display
  // text, not the enum value the API itself returns.
  'bconnect-activedirectory-mcp/list_ad_object_memberships',
  'bconnect-activedirectory-mcp/list_ad_objects_by_group',
  'bconnect-activedirectory-mcp/list_ad_objects_by_org_unit',
  // The list_{windows,linux,mac}_endpoints rows that used to sit here were
  // FIXED by the 26R1 family collapse: the merged `list_endpoints` exposes
  // OrderBy and SearchQuery in its filter union. (`list_group_endpoints` was
  // deleted earlier by the TOK-3 surface revision; group membership queries go
  // through the merged `bconnect-groups-mcp/list_group_members`.)
  // Was `list_endpoint_job_instances`; renamed by INT-47 to sort with its
  // `list_job_instances_by_*` siblings. The omission itself is unchanged.
  'bconnect-jobs-mcp/list_job_instances_by_endpoint',
  'bconnect-jobs-mcp/list_job_subfolders',
  'bconnect-jobs-mcp/list_kiosk_releases_by_job_definition',
  'bconnect-jobs-mcp/list_kiosk_releases_by_endpoint',
  'bconnect-jobs-mcp/list_kiosk_releases_by_ad_object',
  'bconnect-jobs-mcp/list_kiosk_releases_by_logical_group',
  'bconnect-jobs-mcp/list_job_instances_by_static_group',
  'bconnect-jobs-mcp/list_job_instances_by_dynamic_group',
  'bconnect-jobs-mcp/list_job_instances_by_universal_dynamic_group',

  // The Industrial group is gone with the surface: `list_industrial_endpoints`
  // was deleted (26R1 removed the endpoint type and its routes; its filters
  // only ever existed in the stale 25R2 types), and the three groups-mcp
  // industrial tools had already been merged into `list_group_members`.

  // (b) OPEN, and the one with real consequences — `restart_management_server`
  // omits `utcScheduleRestartTime`, so the only way to restart the management
  // server through MCP is immediately.
  'bconnect-servermanagement-mcp/restart_management_server',
];

// The vendored generated types are behind the shipped 26R1 spec: the tool is
// right and the types are wrong. Recorded so the direction of the fix is not
// mistaken — regenerate, do not edit the tool. Empty since the 2026-08-02
// regeneration: every EntraIdDeviceId row (two windows list tools here, five
// more that had merged into groups-mcp's `list_group_members`) described a
// parameter the 26R1 spec had and the 25R2-generated types lacked, and the
// regenerated types now carry it.
const KNOWN_STALE_TYPES: string[] = [];

// Files under `src/generated/` that are NOT openapi-typescript output. Empty
// since the regeneration: `bconnect-assets-mcp/assets-types.ts` used to be 197
// hand-written lines with no `paths` and no `operations` (its 26 tools were
// checked against the real copy a sibling server vendored); it is now genuine
// generated output and the assets tools are checked against their own file.
const KNOWN_STUB_TYPE_FILES: string[] = [];

/**
 * Floor on how many tools must resolve to an operation. Every real failure
 * mode of the source-reading in `lib/` shows up as tools quietly falling out
 * of the mapped set, and an unmapped tool is a tool this file does not check.
 * A mapper regression that halves coverage would otherwise turn every
 * assertion below green.
 *
 * Calibration (2026-08-02, post 26R1 regeneration + endpoints family
 * collapse): the full surface with the write gate open is 216 tools; 196
 * resolve to an operation and the remaining 20 are pinned one by one in the
 * lists above (8 composite, 8 multi-route dispatchers, 1 advertised tool with
 * no dispatch case, 3 unverifiable routes) — resolution is at the maximum
 * this tree supports. The previous value, 220, was calibrated against the
 * 247-tool surface that existed before the collapse merged the per-platform
 * endpoints families and 26R1 deleted the industrial tools; the regeneration
 * also returned the ten formerly stale-typed routes to the mapped set. The
 * floor sits just under the measured 196 so a mapper regression fails loudly
 * while a small legitimate surface change does not.
 */
const MIN_MAPPED_TOOLS = 193;

// ───────────────────────────────────────────────────────────────────────────
// This file audits the FULL tool surface, not the default posture. Since the
// TOK-1/TOK-20 revision, write tools are hidden from tools/list unless
// ALLOW_WRITE_OPERATIONS=true — but hiding a tool does not make its schema
// drift harmless; it only means the drift bites the first operator who opens
// the gate. The gate is read per tools/list call, never cached (see
// packages/mcp-core/src/tool-catalogue.ts), so opening it here affects exactly
// the catalogues this file builds and nothing outside this process.
//
// Registered BEFORE the report-building beforeAll below: vitest runs file-level
// hooks in registration order, and both drift reports (the real one and the
// mutated one in the second describe) must be built with the gate open.
// ───────────────────────────────────────────────────────────────────────────
let savedWriteGate: string | undefined;
beforeAll(() => {
  savedWriteGate = process.env.ALLOW_WRITE_OPERATIONS;
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
});
afterAll(() => {
  if (savedWriteGate === undefined) {delete process.env.ALLOW_WRITE_OPERATIONS;}
  else {process.env.ALLOW_WRITE_OPERATIONS = savedWriteGate;}
});

let report: DriftReport;
beforeAll(async () => {
  report = await buildDriftReport(ROOT, SERVERS);
}, 60_000);

const setEquals = (actual: string[], expected: readonly string[]) =>
  expect([...actual].sort()).toEqual([...expected].sort());

describe('T2 — tool schemas vs generated OpenAPI types (R1)', () => {
  it('resolves nearly every tool to a generated operation', () => {
    expect(
      report.mappedCount,
      `Only ${report.mappedCount} of ${report.toolCount} tools resolved to an operation in ` +
      'src/generated/ (full surface: the suite opens ALLOW_WRITE_OPERATIONS for its ' +
      'catalogues; 196/216 at calibration, with the other 20 pinned individually by the ' +
      'lists above). Below the floor this file stops being evidence of anything: ' +
      'unmapped tools are unchecked tools. Look at readModuleRoutes/readToolDispatch ' +
      'in __tests__/lib/tool-routes.ts before touching this number.'
    ).toBeGreaterThanOrEqual(MIN_MAPPED_TOOLS);
  });

  it('loads every server that exists — the map cannot go stale silently', () => {
    // This map has to stay literal: the loaders are static `import()`
    // specifiers, which is what lets the tooling resolve `src` rather than
    // `build`. A literal list is exactly what went wrong — `bconnect-insights-mcp`
    // shipped 2026-08-11/12 and was in none of the five guards that carried one,
    // so its five tools were outside this check for three days. Since the list
    // cannot be replaced by discovery, it is CHECKED AGAINST discovery instead.
    const onDisk = readdirSync(join(__dirname, '..'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^bconnect-.+-mcp$/.test(name))
      .sort();
    expect(onDisk.length, 'discovery found no servers, so this proves nothing').toBeGreaterThanOrEqual(14);
    expect(
      onDisk.filter((name) => !(name in SERVERS)),
      'these servers exist but are not in the SERVERS map, so nothing in this file checks them'
    ).toEqual([]);
  });

  it('accounts for every tool it does not check', () => {
    setEquals(keysOf(report.composite), COMPOSITE_TOOLS);
    setEquals(keysOf(report.unresolvedMethod), [
      ...DELEGATING_TOOLS,
      ...MULTI_ROUTE_TOOLS,
      ...OPEN_MISSING_DISPATCH,
    ]);
    expect(
      keysOf(report.unverifiableRoute).sort(),
      'A tool calls a URL that appears in no generated types file, so nothing about ' +
      'it can be checked. Either the route drifted from the operation the code types ' +
      'itself against, or the vendored types are behind the shipped spec. Both need ' +
      'a decision — do not add to UNVERIFIABLE_ROUTES to make this pass.\n' +
      explain(report.unverifiableRoute)
    ).toEqual([...UNVERIFIABLE_ROUTES].sort());
  });

  it('uses only HTTP verbs the route declares', () => {
    expect(
      keysOf(report.verbDrift),
      'A tool sends an HTTP verb its route does not declare, and the shipped 26R1 spec ' +
      'does not declare it either -> HTTP 405.\n' + explain(report.verbDrift)
    ).toEqual([...OPEN_VERB_DRIFT].sort());
  });

  it('pins the routes and verbs where the vendored types are behind the shipped spec', () => {
    expect(
      keysOf(report.staleTypeRoutes),
      'The route or verb is in the shipped 26R1 spec but not in the vendored generated ' +
      'types. The tool is right; regenerate the types.\n' + explain(report.staleTypeRoutes)
    ).toEqual([...KNOWN_STALE_TYPE_ROUTES].sort());
  });

  it('sends no parameter the operation does not declare', () => {
    expect(
      keysOf(report.undeclaredParam),
      'A tool exposes a parameter its API operation does not declare. Per D6 the API ' +
      'answers 200 and drops it, so the caller acts on a complete-looking wrong answer ' +
      '— this is exactly how includeSubGroups reported an empty group that held 20 ' +
      'endpoints. Fix the tool, or the route it is mapped to; do not extend the list.\n' +
      explain(report.undeclaredParam)
    ).toEqual([...OPEN_UNDECLARED_PARAMS].sort());
  });

  it('gives every enum-typed parameter its allowed values', () => {
    expect(
      keysOf(report.enumDrift),
      'An enum-typed parameter is exposed without its value list, or with a value the ' +
      'API does not accept. Enums are the one place D6 does NOT apply: a bad value ' +
      'returns HTTP 400, so a tool that types an enum as a bare string is worse than ' +
      'one that omits the parameter — the model guesses and the call fails.\n' +
      explain(report.enumDrift)
    ).toEqual([...OPEN_ENUM_DRIFT, ...ACCEPTED_ENUM_OMISSIONS].sort());
  });

  it('exposes and enforces every required request-body field', () => {
    expect(
      keysOf(report.bodyRequired),
      'A tool cannot supply, or does not require, a field its request schema requires. ' +
      'This is B3 and B6 — a create tool that can never succeed still passes every ' +
      'unit test, because the unit tests assert the tool\'s own schema.\n' +
      explain(report.bodyRequired)
    ).toEqual([...OPEN_BODY_REQUIRED].sort());
  });

  it('describes request bodies instead of forwarding an opaque wrapper (D12)', () => {
    setEquals(keysOf(report.wrapperBody), OPEN_WRAPPER_BODIES);
  });

  it('pins the declared query filters tools still omit (D14b)', () => {
    expect(
      keysOf(report.omittedQueryParam),
      'A tool omits a filter its operation declares. Not broken, but unreachable ' +
      'capability: exposing Category on list_installed_windows_software was worth ' +
      '-82.8% payload. This set may shrink and must never grow.\n' +
      explain(report.omittedQueryParam)
    ).toEqual([...OPEN_OMITTED_QUERY_PARAMS].sort());
  });

  it('pins where the vendored types are behind the shipped spec', () => {
    expect(
      keysOf(report.staleTypes),
      'The tool declares a parameter the shipped 26R1 spec has and the vendored ' +
      'generated types do not. The tool is right; regenerate the types.\n' +
      explain(report.staleTypes)
    ).toEqual([...KNOWN_STALE_TYPES].sort());
  });

  it('pins which src/generated files are not generated at all', () => {
    setEquals(report.stubTypeFiles, KNOWN_STUB_TYPE_FILES);
  });

  it('the shipped-spec cross-check actually found a spec to read', () => {
    // If the spec directory moved, every stale-types row would silently
    // reclassify as undeclaredParam and this file would blame the wrong side
    // of the drift. This used to be asserted via `staleTypes.length > 0`, but
    // the 2026-08-02 regeneration emptied staleTypes for real — the proxy can
    // no longer distinguish "no drift" from "no spec". So the loader the
    // report classifies through is exercised directly instead, with the same
    // repo root and release buildDriftReport() uses: the spec must be found,
    // parse to routes, and declare a parameter this suite knows is there.
    const spec = loadShippedSpec(ROOT, '26R1', 'endpoints');
    expect(spec, 'openapi-specs/26R1 has no endpoints spec — no shipped-spec comparison can happen').toBeDefined();
    expect(spec!.routes.size, 'the shipped endpoints spec parsed to zero routes').toBeGreaterThan(0);
    expect(spec!.hasRoute('/v2.0/Endpoints')).toBe(true);
    expect([...(spec!.queryParams('get', '/v2.0/Endpoints') ?? [])]).toContain('PageSize');
  });

  it('every allowlist entry still reproduces (no list has gone stale)', () => {
    // The failure this project keeps finding is a check that passes while the
    // thing it claims to verify is untrue. An allowlist entry for drift that
    // has since been fixed is that failure in miniature: it silently re-opens
    // a hole. So each entry must still correspond to a live finding.
    const live = new Set([
      ...keysOf(report.composite),
      ...keysOf(report.unresolvedMethod),
      ...keysOf(report.unverifiableRoute),
      ...keysOf(report.staleTypeRoutes),
      ...keysOf(report.verbDrift),
      ...keysOf(report.undeclaredParam),
      ...keysOf(report.enumDrift),
      ...keysOf(report.wrapperBody),
      ...keysOf(report.bodyRequired),
      ...keysOf(report.omittedQueryParam),
      ...keysOf(report.staleTypes),
    ]);
    const stale = [
      ...COMPOSITE_TOOLS, ...DELEGATING_TOOLS, ...MULTI_ROUTE_TOOLS,
      ...OPEN_MISSING_DISPATCH,
      ...UNVERIFIABLE_ROUTES, ...OPEN_VERB_DRIFT,
      ...KNOWN_STALE_TYPE_ROUTES, ...OPEN_UNDECLARED_PARAMS, ...OPEN_ENUM_DRIFT,
      ...ACCEPTED_ENUM_OMISSIONS, ...OPEN_WRAPPER_BODIES, ...OPEN_BODY_REQUIRED,
      ...OPEN_OMITTED_QUERY_PARAMS, ...KNOWN_STALE_TYPES,
    ].filter((k) => !live.has(k));
    expect(
      stale,
      'These entries no longer describe anything real — the drift was fixed, or the ' +
      'tool was renamed. Delete them; leaving them in means the next occurrence of ' +
      'the same drift passes silently.'
    ).toEqual([]);
  });
});

/**
 * Proof that the assertions above can fail.
 *
 * A green check is worth nothing unless it turns red when the thing it claims
 * to verify stops being true — and this project has spent a day finding checks
 * that passed while the thing they verified was untrue (B3's unit test asserted
 * a field the API does not have; `finegrained-gate-probe.mjs` passed against a
 * config that had no allowlist).
 *
 * So the pre-fix state is re-injected here rather than described. Three real
 * defects from this evaluation are put back into the tool schemas in memory,
 * and the checker is asked to find them:
 *
 *   D14a  `includeSubfolders` renamed back to `includeSubGroups`, the
 *         misspelling that made a logical group holding 20 endpoints report 0.
 *         The tool it originally lived on
 *         (`list_windows_endpoints_by_logical_group`) was merged into the
 *         unmapped `list_endpoints_by_logical_group` dispatcher, so the
 *         misspelling is re-injected into a surviving MAPPED by-logical-group
 *         tool with the same flag: software-mcp's
 *         `list_installed_software_by_logical_group`
 *   D6-enum  the `EndpointType` value list stripped, leaving a bare string —
 *         the state ten tools were left in, where a guessed value returns 400
 *   B6    `hostName` removed from `create_windows_endpoint`, the shape that
 *         makes a create tool unable to succeed
 *
 * Only the in-memory tool schema is changed; the modules, routes and generated
 * types are read from the real tree, which is exactly the asymmetry R1 is about.
 */
function withMutatedTools(load: ServerLoader, mutate: (tools: ToolDef[]) => void): ServerLoader {
  return async () => {
    const mod = await load();
    return {
      createServer: () => {
        const { server } = mod.createServer();
        const handlers = (server as { _requestHandlers: Map<string, (r: unknown) => Promise<{ tools?: ToolDef[] }>> })._requestHandlers;
        const real = handlers.get('tools/list')!;
        const patched = new Map(handlers);
        patched.set('tools/list', async (req: unknown) => {
          const res = await real(req);
          const tools = JSON.parse(JSON.stringify(res.tools ?? [])) as ToolDef[];
          mutate(tools);
          return { ...res, tools };
        });
        return { server: { _requestHandlers: patched } };
      },
    };
  };
}

const prop = (tools: ToolDef[], name: string) =>
  tools.find((t) => t.name === name)?.inputSchema?.properties as Record<string, unknown> | undefined;

describe('T2 — the assertion fails on the pre-fix tree', () => {
  let broken: DriftReport;

  beforeAll(async () => {
    broken = await buildDriftReport(ROOT, {
      ...SERVERS,
      'bconnect-endpoints-mcp': withMutatedTools(SERVERS['bconnect-endpoints-mcp'], (tools) => {
        // B6 — take the required body field away again.
        delete prop(tools, 'create_windows_endpoint')!.hostName;
      }),
      'bconnect-software-mcp': withMutatedTools(SERVERS['bconnect-software-mcp'], (tools) => {
        // D14a — put the misspelling back.
        const p = prop(tools, 'list_installed_software_by_logical_group')!;
        p.includeSubGroups = p.includeSubfolders;
        delete p.includeSubfolders;
      }),
      'bconnect-jobs-mcp': withMutatedTools(SERVERS['bconnect-jobs-mcp'], (tools) => {
        // D6's enum exception — strip the value list, keep the parameter.
        const p = prop(tools, 'list_job_instances')! as Record<string, { enum?: string[] }>;
        delete p.EndpointType.enum;
      }),
    });
  }, 60_000);

  it('catches includeSubGroups — the parameter the API silently drops (D14a)', () => {
    expect(keysOf(broken.undeclaredParam)).toContain(
      'bconnect-software-mcp/list_installed_software_by_logical_group.includeSubGroups'
    );
    // and it must no longer be reported as merely omitting the real flag
    expect(broken.undeclaredParam.find((f) => f.key.endsWith('.includeSubGroups'))!.detail)
      .toMatch(/declares no 'includeSubGroups'/);
  });

  it('catches an enum parameter typed as a bare string (the HTTP 400 class)', () => {
    const hit = broken.enumDrift.find((f) => f.key === 'bconnect-jobs-mcp/list_job_instances.EndpointType');
    expect(hit, 'an enum stripped of its values went unreported').toBeDefined();
    expect(hit!.detail).toMatch(/plain string/);
  });

  it('catches a required request-body field a create tool cannot supply (B6)', () => {
    const hit = broken.bodyRequired.find((f) => f.key === 'bconnect-endpoints-mcp/create_windows_endpoint');
    expect(hit).toBeDefined();
    expect(hit!.detail).toMatch(/cannot supply hostName/);
  });

  it('leaves the rest of the report alone — the injected drift is the only difference', () => {
    // Guards against a mutation harness that breaks everything and therefore
    // "catches" anything.
    expect(broken.mappedCount).toBe(report.mappedCount);
    expect(keysOf(broken.wrapperBody)).toEqual(keysOf(report.wrapperBody));
    expect(keysOf(broken.unverifiableRoute)).toEqual(keysOf(report.unverifiableRoute));
  });
});
