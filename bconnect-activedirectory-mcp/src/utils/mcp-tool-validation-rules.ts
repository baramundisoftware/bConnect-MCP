/**
 * MCP Tool Validation Rules — bconnect-activedirectory-mcp
 *
 * Centralised validation rules for the 17 read-only AD tools exposed by this server.
 * Replaces the inline `typeof` checks that previously lived in `index.ts`.
 *
 * See parameter-validator.ts for the ValidationRule type and validateOrThrow.
 */

import { ValidationRule, CommonRules } from './parameter-validator.js';

const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy()
];

const guidScopedListRules = (guidName: string): ValidationRule[] => [
  CommonRules.guid(guidName),
  ...paginationRules()
];

export const ActiveDirectoryRules = {
  // ── AD Groups ─────────────────────────────────────────────────────
  listAdGroups: (): ValidationRule[] => paginationRules(),
  getAdGroup: (): ValidationRule[] => [CommonRules.guid('id')],
  listAdSubgroups: (): ValidationRule[] => guidScopedListRules('adGroupId'),
  listAdGroupsByOrgUnit: (): ValidationRule[] => guidScopedListRules('orgUnitId'),

  // ── AD Objects ────────────────────────────────────────────────────
  listAdObjects: (): ValidationRule[] => paginationRules(),
  getAdObject: (): ValidationRule[] => [CommonRules.guid('id')],
  listAdObjectMemberships: (): ValidationRule[] => [
    CommonRules.guid('id'),
    CommonRules.page(),
    CommonRules.pageSize()
  ],
  listAdObjectsByGroup: (): ValidationRule[] => guidScopedListRules('adGroupId'),
  listAdObjectsByOrgUnit: (): ValidationRule[] => guidScopedListRules('orgUnitId'),

  // ── AD Users ──────────────────────────────────────────────────────
  listAdUsers: (): ValidationRule[] => paginationRules(),
  getAdUser: (): ValidationRule[] => [CommonRules.guid('id')],
  listAdUsersByGroup: (): ValidationRule[] => guidScopedListRules('adGroupId'),
  listAdUsersByOrgUnit: (): ValidationRule[] => guidScopedListRules('orgUnitId'),

  // ── Org Units ─────────────────────────────────────────────────────
  listOrgUnits: (): ValidationRule[] => paginationRules(),
  getOrgUnit: (): ValidationRule[] => [CommonRules.guid('id')],
  listOrgUnitsByOrgUnit: (): ValidationRule[] => guidScopedListRules('orgUnitId')
};
