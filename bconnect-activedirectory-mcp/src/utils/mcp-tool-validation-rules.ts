/**
 * MCP Tool Validation Rules — bconnect-activedirectory-mcp
 *
 * Centralised validation rules for the 17 read-only AD tools exposed by this server.
 * Replaces the inline `typeof` checks that previously lived in `index.ts`.
 *
 * See parameter-validator.ts for the ValidationRule type and validateOrThrow.
 */

import { ValidationRule, CommonRules } from "@bconnect/mcp-core";

/**
 * TOK-25 — `countOnly` is a boolean on every list tool in the suite. Declared
 * here so a caller who passes `countOnly: "true"` is rejected with a typed
 * -32602 rather than silently getting a full page back.
 */
const countOnlyRule = (): ValidationRule => ({
  name: 'countOnly',
  required: false,
  type: 'boolean',
  message: 'countOnly must be a boolean'
});

const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy(),
  countOnlyRule()
];

const guidScopedListRules = (guidName: string): ValidationRule[] => [
  CommonRules.guid(guidName),
  ...paginationRules()
];

/**
 * detail/fields must be declared in the RULES as well as the schema:
 * assertKnownParameters builds its allowlist from the declared set and refuses
 * anything else with -32602 before dispatch, so without these the projection's
 * own "Pass detail:true for the full API record" hint would be false.
 *
 * Shared by every tool routed through `shapeAdRows` — the nine group/object/user
 * listings — and by `listOrgUnits`, which had its own inline copy first.
 */
const shapingRules = (): ValidationRule[] => [
  { name: 'detail', required: false, type: 'boolean' },
  { name: 'fields', required: false, type: 'array' },
];

/** A projected list: paging plus the shaping vocabulary. */
const projectedListRules = (): ValidationRule[] => [...paginationRules(), ...shapingRules()];

/** A projected list scoped to one parent GUID. */
const projectedGuidScopedListRules = (guidName: string): ValidationRule[] => [
  ...guidScopedListRules(guidName),
  ...shapingRules(),
];

export const ActiveDirectoryRules = {
  // ── AD Groups ─────────────────────────────────────────────────────
  listAdGroups: (): ValidationRule[] => projectedListRules(),
  getAdGroup: (): ValidationRule[] => [CommonRules.guid('id')],
  listAdSubgroups: (): ValidationRule[] => projectedGuidScopedListRules('adGroupId'),
  listAdGroupsByOrgUnit: (): ValidationRule[] => projectedGuidScopedListRules('orgUnitId'),

  // ── AD Objects ────────────────────────────────────────────────────
  listAdObjects: (): ValidationRule[] => projectedListRules(),
  getAdObject: (): ValidationRule[] => [CommonRules.guid('id')],
  listAdObjectMemberships: (): ValidationRule[] => [
    CommonRules.guid('id'),
    CommonRules.page(),
    CommonRules.pageSize()
  ],
  listAdObjectsByGroup: (): ValidationRule[] => projectedGuidScopedListRules('adGroupId'),
  listAdObjectsByOrgUnit: (): ValidationRule[] => projectedGuidScopedListRules('orgUnitId'),

  // ── AD Users ──────────────────────────────────────────────────────
  listAdUsers: (): ValidationRule[] => projectedListRules(),
  getAdUser: (): ValidationRule[] => [CommonRules.guid('id')],
  listAdUsersByGroup: (): ValidationRule[] => projectedGuidScopedListRules('adGroupId'),
  listAdUsersByOrgUnit: (): ValidationRule[] => projectedGuidScopedListRules('orgUnitId'),

  // ── Org Units ─────────────────────────────────────────────────────
  listOrgUnits: (): ValidationRule[] => projectedListRules(),
  getOrgUnit: (): ValidationRule[] => [CommonRules.guid('id')],
  listOrgUnitsByOrgUnit: (): ValidationRule[] => guidScopedListRules('orgUnitId')
};
