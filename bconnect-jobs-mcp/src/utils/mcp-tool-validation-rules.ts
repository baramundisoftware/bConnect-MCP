/**
 * MCP Tool Validation Rules — bconnect-jobs-mcp
 *
 * ── What this file used to be ────────────────────────────────────────────────
 * A 1,287-line snapshot of the pre-split monolith ("Centralized validation
 * rules for all 121 MCP tools"), still exporting EndpointsRules,
 * ActiveDirectoryRules, ServerManagementRules, VariablesRules,
 * DefenseControlRules, OperatingSystemsRules, SoftwareRules,
 * UpdateManagementRules, V11Rules and DocumentationSearchRules — none of which
 * this server owns — and imported by nothing. Meanwhile src/index.ts ran a
 * `validateToolArguments()` whose switch had ~37 fall-through case labels and
 * no statements, so caller-supplied ids reached the API completely unchecked.
 * OPT-31 / SEC-1 / INT-49 are all that one defect. Live evidence:
 * `get_job_definition {id: "../../../servermanagement/v2.0/ApiKeys"}` returned
 * the bMS API-key inventory, because `basePath` is only a prefix and `../`
 * walks out of the jobs module.
 *
 * ── What it is now ───────────────────────────────────────────────────────────
 * Rules for the 37 tools this server actually registers, and nothing else, plus
 * the `validateToolParameters()` dispatch that src/index.ts calls on every
 * CallTool request. Every entry is checked against the tool's own inputSchema
 * in src/index.ts — a rule that requires a field the schema does not declare
 * would reject legitimate calls, which is how the previous copy had drifted
 * (its createJobFolder required `Name` while the tool declares `name`).
 *
 * ── Defence in depth ─────────────────────────────────────────────────────────
 * Arguments that get interpolated into a URL path are additionally passed
 * through `assertSafePathSegment()` from @bconnect/mcp-core, which is what the
 * transport-level containment interceptor in BConnectClientBase uses too. GUID
 * validation already excludes `/` and `..`, so this is belt-and-braces — its
 * value is that a traversal attempt keeps producing a precise -32602 even if
 * one of these rules is later loosened from GUID to a free-form id.
 */

import {
  ValidationRule,
  CommonRules,
  validateOrThrow,
  assertSafePathSegment,
} from "@bconnect/mcp-core";

/**
 * Common pagination parameters used across the list tools.
 */
export const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy(),
  // TOK-25 — every paged list tool in this server declares `countOnly`, so
  // every one of them type-checks it here. A truthy string ("true") would
  // otherwise sail past `isCountOnlyRequest`'s `=== true` and silently return
  // rows the caller did not want.
  { name: 'countOnly', required: false, type: 'boolean' }
];

/**
 * TOK-27 — the shaping flags the seven job-instance list tools declare.
 *
 * Appended to those tools' rule sets only. A rule for a parameter the tool's
 * inputSchema does not declare would reject legitimate calls, which is the
 * drift this file's header records.
 */
export const jobInstanceShapingRules = (): ValidationRule[] => [
  { name: 'detail', required: false, type: 'boolean' },
  { name: 'includeSteps', required: false, type: 'boolean' }
];

/**
 * Jobs API validation rules.
 *
 * Names mirror the operation, not the tool, so several tools can share one
 * entry where they share a shape.
 */
export const JobsRules = {
  // GET /JobDefinitions
  listJobDefinitions: (): ValidationRule[] => paginationRules(),

  // GET /JobDefinitions/{id}
  getJobDefinition: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /JobInstances
  listJobInstances: (): ValidationRule[] => [...paginationRules(), ...jobInstanceShapingRules()],

  // GET /JobInstances/{id} — also start/stop/resume/delete, all keyed on `id`
  getJobInstance: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /Endpoints/{endpointId}/JobInstances
  // INT-47: the tool is `list_job_instances_by_endpoint`; the rule keeps its
  // operation-shaped name, which is why several tools can share one entry.
  listJobInstancesByEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    ...paginationRules(),
    ...jobInstanceShapingRules()
  ],

  // GET /JobDefinitions/{jobDefinitionId}/JobInstances
  listJobInstancesByDefinition: (): ValidationRule[] => [
    CommonRules.guid('jobDefinitionId'),
    ...paginationRules(),
    ...jobInstanceShapingRules()
  ],

  // GET /LogicalGroups/{logicalGroupId}/JobInstances
  listJobInstancesByLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('logicalGroupId'),
    ...paginationRules(),
    ...jobInstanceShapingRules()
  ],

  // GET /StaticGroups|DynamicGroups|UniversalDynamicGroups/{id}/JobInstances
  listJobInstancesByGroup: (idField: string): ValidationRule[] => [
    CommonRules.guid(idField),
    ...paginationRules(),
    ...jobInstanceShapingRules()
  ],

  // GET /Folders/{folderId}/JobDefinitions
  listJobDefinitionsByFolder: (): ValidationRule[] => [
    CommonRules.guid('folderId'),
    ...paginationRules()
  ],

  // GET /Folders
  listJobFolders: (): ValidationRule[] => paginationRules(),

  // GET /Folders/{id}
  getJobFolder: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /Folders/{folderId}/Folders
  listJobSubfolders: (): ValidationRule[] => [
    CommonRules.guid('folderId'),
    ...paginationRules()
  ],

  // POST /JobInstances — endpointId is optional in the tool's own schema (only
  // jobDefinitionId is required), so it is an optional GUID here, not a
  // required one.
  // Corrected 2026-08-11: JobInstanceForCreation REQUIRES endpointId (the
  // schema said so all along); the tool now declares it required, and the
  // rule agrees so a missing endpoint fails here with a message rather than
  // as a bMS 400.
  createJobInstance: (): ValidationRule[] => [
    CommonRules.guid('jobDefinitionId'),
    CommonRules.guid('endpointId')
  ],

  // POST /Folders — the tool declares lowercase `name` / `parentId` / `comment`
  createJobFolder: (): ValidationRule[] => [
    {
      name: 'name',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 255,
      message: 'name must be between 1 and 255 characters'
    },
    CommonRules.guidOptional('parentId')
  ],

  // PATCH /Folders/{id}, DELETE /Folders/{id}
  updateJobFolder: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /LogicalGroups|StaticGroups|.../{id}/AssignJobDefinition — the group
  // id is the path segment, jobDefinitionId travels in the body.
  assignJob: (groupIdField: string): ValidationRule[] => [
    CommonRules.guid(groupIdField),
    CommonRules.guid('jobDefinitionId')
  ],

  // POST /KioskReleases — KioskReleaseForCreation requires BOTH keys, and the
  // target's name is `assignmentTargetId`. The rule said `targetId` (optional)
  // until 2026-08-11, matching a tool schema under which the required key was
  // never sent under its right name (TOOL-REVIEW-MATRIX.md H2).
  createKioskRelease: (): ValidationRule[] => [
    CommonRules.guid('jobDefinitionId'),
    CommonRules.guid('assignmentTargetId')
  ],

  // GET /KioskReleases
  listKioskReleases: (): ValidationRule[] => paginationRules(),

  // GET /KioskReleases/{id}, DELETE /KioskReleases/{id}
  getKioskRelease: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /{context}/{id}/KioskReleases — generic factory
  listKioskReleasesByContext: (idField: string): ValidationRule[] => [
    CommonRules.guid(idField),
    ...paginationRules()
  ]
};

/**
 * Composite read-only analysis tools (LOCAL ADDITIONS — see src/modules/).
 *
 * These build URLs from their id arguments exactly like the generated tools do,
 * so they are validated on the same footing.
 */
export const CompositeRules = {
  // All four group ids are OPTIONAL here and each is GUID-checked when present.
  // "exactly one" is enforced in the module (selectTarget), not by this rule
  // set, which has no way to express a mutually-exclusive required group — and
  // a rule that required logicalGroupId would make the other three unreachable.
  previewAssignment: (): ValidationRule[] => [
    CommonRules.guid('jobDefinitionId'),
    CommonRules.guidOptional('logicalGroupId'),
    CommonRules.guidOptional('staticGroupId'),
    CommonRules.guidOptional('dynamicGroupId'),
    CommonRules.guidOptional('universalDynamicGroupId'),
    { name: 'liveWithinDays', required: false, type: 'number', min: 0, max: 3650 }
  ],

  explainJobFailure: (): ValidationRule[] => [
    CommonRules.guidOptional('jobDefinitionId'),
    { name: 'sinceDays', required: false, type: 'number', min: 0, max: 3650 },
    { name: 'endpointName', required: false, type: 'string', minLength: 1, maxLength: 255 },
    { name: 'topClusters', required: false, type: 'number', min: 1, max: 100 },
    { name: 'includeInstanceIds', required: false, type: 'boolean' }
  ],

  diagnoseJob: (): ValidationRule[] => [
    CommonRules.guid('jobDefinitionId'),
    { name: 'sinceDays', required: false, type: 'number', min: 0, max: 3650 },
    { name: 'maxInstances', required: false, type: 'number', min: 1, max: 100000 },
    { name: 'staleAfterDays', required: false, type: 'number', min: 0, max: 3650 }
  ]
};

/**
 * Run the path-segment guard over the named arguments, then the rule set.
 *
 * `pathSegments` lists the arguments this tool interpolates into a URL path.
 * They are guarded before the rules run so the error names the traversal rather
 * than complaining about GUID formatting.
 */
function validate(
  args: Record<string, unknown> | undefined,
  rules: ValidationRule[],
  pathSegments: string[] = []
): void {
  for (const parameterName of pathSegments) {
    const value = args?.[parameterName];
    if (value !== undefined && value !== null) {
      assertSafePathSegment(value, parameterName);
    }
  }
  validateOrThrow(args, rules);
}

/**
 * Dispatch function — validates tool parameters by tool name.
 *
 * Called from the CallTool handler in src/index.ts before any client is built.
 * Unknown names fall through untouched; dispatch answers those with
 * MethodNotFound.
 *
 * @param toolName  The MCP tool name (snake_case).
 * @param args      Raw arguments object from the MCP request.
 */
export function validateToolParameters(
  toolName: string,
  args: Record<string, unknown> | undefined
): void {
  switch (toolName) {
    // ── Composite analysis (LOCAL ADDITIONS) ────────────────────────────────
    case 'preview_assignment':
      return validate(args, CompositeRules.previewAssignment(), ['jobDefinitionId']);
    case 'explain_job_failure':
      return validate(args, CompositeRules.explainJobFailure(), ['jobDefinitionId']);
    case 'diagnose_job':
      return validate(args, CompositeRules.diagnoseJob(), ['jobDefinitionId']);

    // ── Job definitions ─────────────────────────────────────────────────────
    case 'list_job_definitions':
      return validate(args, JobsRules.listJobDefinitions());
    case 'get_job_definition':
      return validate(args, JobsRules.getJobDefinition(), ['id']);
    case 'list_job_definitions_by_folder':
      return validate(args, JobsRules.listJobDefinitionsByFolder(), ['folderId']);

    // ── Job instances ───────────────────────────────────────────────────────
    case 'list_job_instances':
      return validate(args, JobsRules.listJobInstances());
    case 'get_job_instance':
    case 'start_job_instance':
    case 'stop_job_instance':
    case 'resume_job_instance':
    case 'delete_job_instance':
      return validate(args, JobsRules.getJobInstance(), ['id']);
    case 'list_job_instances_by_endpoint':
      return validate(args, JobsRules.listJobInstancesByEndpoint(), ['endpointId']);
    case 'list_job_instances_by_definition':
      return validate(args, JobsRules.listJobInstancesByDefinition(), ['jobDefinitionId']);
    case 'list_job_instances_by_logical_group':
      return validate(args, JobsRules.listJobInstancesByLogicalGroup(), ['logicalGroupId']);
    case 'list_job_instances_by_static_group':
      return validate(args, JobsRules.listJobInstancesByGroup('staticGroupId'), ['staticGroupId']);
    case 'list_job_instances_by_dynamic_group':
      return validate(args, JobsRules.listJobInstancesByGroup('dynamicGroupId'), ['dynamicGroupId']);
    case 'list_job_instances_by_universal_dynamic_group':
      return validate(
        args,
        JobsRules.listJobInstancesByGroup('universalDynamicGroupId'),
        ['universalDynamicGroupId']
      );
    case 'create_job_instance':
      return validate(args, JobsRules.createJobInstance());

    // ── Job folders ─────────────────────────────────────────────────────────
    case 'list_job_folders':
      return validate(args, JobsRules.listJobFolders());
    case 'get_job_folder':
      return validate(args, JobsRules.getJobFolder(), ['id']);
    case 'list_job_subfolders':
      return validate(args, JobsRules.listJobSubfolders(), ['folderId']);
    case 'create_job_folder':
      return validate(args, JobsRules.createJobFolder());
    case 'update_job_folder':
    case 'delete_job_folder':
      return validate(args, JobsRules.updateJobFolder(), ['id']);

    // ── Job assignment ──────────────────────────────────────────────────────
    case 'assign_job_to_logical_group':
      return validate(args, JobsRules.assignJob('logicalGroupId'), ['logicalGroupId']);
    case 'assign_job_to_static_group':
      return validate(args, JobsRules.assignJob('staticGroupId'), ['staticGroupId']);
    case 'assign_job_to_dynamic_group':
      return validate(args, JobsRules.assignJob('dynamicGroupId'), ['dynamicGroupId']);
    case 'assign_job_to_universal_dynamic_group':
      return validate(args, JobsRules.assignJob('universalDynamicGroupId'), ['universalDynamicGroupId']);

    // ── Kiosk releases ──────────────────────────────────────────────────────
    case 'create_kiosk_release':
      return validate(args, JobsRules.createKioskRelease());
    case 'withdraw_kiosk_release':
    case 'get_kiosk_release':
      return validate(args, JobsRules.getKioskRelease(), ['id']);
    case 'list_kiosk_releases':
      return validate(args, JobsRules.listKioskReleases());
    case 'list_kiosk_releases_by_job_definition':
      return validate(args, JobsRules.listKioskReleasesByContext('jobDefinitionId'), ['jobDefinitionId']);
    case 'list_kiosk_releases_by_endpoint':
      return validate(args, JobsRules.listKioskReleasesByContext('endpointId'), ['endpointId']);
    case 'list_kiosk_releases_by_ad_object':
      return validate(args, JobsRules.listKioskReleasesByContext('adObjectId'), ['adObjectId']);
    case 'list_kiosk_releases_by_logical_group':
      return validate(args, JobsRules.listKioskReleasesByContext('logicalGroupId'), ['logicalGroupId']);

    default:
      // Unknown tool — no validation rules defined; dispatch answers with
      // MethodNotFound.
      break;
  }
}
