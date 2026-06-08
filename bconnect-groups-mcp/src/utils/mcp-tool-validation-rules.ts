/**
 * MCP Tool Validation Rules — bconnect-groups-mcp
 *
 * Input validation rules for all 33 group-scoped endpoint query tools.
 */

import { ValidationRule, CommonRules } from './parameter-validator.js';

const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy(),
];

export const GroupsRules = {
  // ── Logical Group (9) ─────────────────────────────────────────────────────
  listEndpointsByLogicalGroup:          (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listAndroidEndpointsByLogicalGroup:   (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listIosEndpointsByLogicalGroup:       (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listLinuxEndpointsByLogicalGroup:     (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listMacEndpointsByLogicalGroup:       (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listNetworkEndpointsByLogicalGroup:   (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listWindowsEndpointsByLogicalGroup:   (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listIndustrialEndpointsByLogicalGroup:(): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listLogicalGroupsByLogicalGroup:      (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],

  // ── Static Group (8) ──────────────────────────────────────────────────────
  listEndpointsByStaticGroup:          (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listAndroidEndpointsByStaticGroup:   (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listIosEndpointsByStaticGroup:       (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listLinuxEndpointsByStaticGroup:     (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listMacEndpointsByStaticGroup:       (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listNetworkEndpointsByStaticGroup:   (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listWindowsEndpointsByStaticGroup:   (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listIndustrialEndpointsByStaticGroup:(): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],

  // ── Dynamic Group (2) ─────────────────────────────────────────────────────
  listEndpointsByDynamicGroup:         (): ValidationRule[] => [CommonRules.guid('dynamicGroupId'),           ...paginationRules()],
  listWindowsEndpointsByDynamicGroup:  (): ValidationRule[] => [CommonRules.guid('dynamicGroupId'),           ...paginationRules()],

  // ── Universal Dynamic Group (8) ───────────────────────────────────────────
  listEndpointsByUDG:                  (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listAndroidEndpointsByUDG:           (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listIosEndpointsByUDG:               (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listLinuxEndpointsByUDG:             (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listMacEndpointsByUDG:               (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listNetworkEndpointsByUDG:           (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listWindowsEndpointsByUDG:           (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listIndustrialEndpointsByUDG:        (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],

  // ── AD User (6) ───────────────────────────────────────────────────────────
  listEndpointsByADUser:               (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
  listAndroidEndpointsByADUser:        (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
  listIosEndpointsByADUser:            (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
  listLinuxEndpointsByADUser:          (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
  listMacEndpointsByADUser:            (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
  listWindowsEndpointsByADUser:        (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
};
