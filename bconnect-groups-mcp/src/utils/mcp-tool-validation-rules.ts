/**
 * MCP Tool Validation Rules — bconnect-groups-mcp
 *
 * Input validation rules per route of the two group-scoped tools (REQ-SRV-029): the
 * path argument is a GUID, paging and filters are checked as before.
 */

import { ValidationRule, CommonRules } from "@bconnect/mcp-core";
import { TOOL_VARIANTS } from "../tool-variants.js";

const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy(),
];

export const GroupsRules = {
  listGroupMembers: (): ValidationRule[] => [CommonRules.guid('groupId'), ...paginationRules()],
  listAdUserEndpoints: (): ValidationRule[] => [CommonRules.guid('adUserId'), ...paginationRules()],
};

/** Per route (variant key): its rules. */
export const TOOL_RULES: Record<string, () => ValidationRule[]> = {
  ...Object.fromEntries(Object.keys(TOOL_VARIANTS.list_group_members).map((route) => [route, GroupsRules.listGroupMembers])),
  ...Object.fromEntries(Object.keys(TOOL_VARIANTS.list_ad_user_endpoints).map((route) => [route, GroupsRules.listAdUserEndpoints])),
};
