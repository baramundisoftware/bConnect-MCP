/**
 * Groups tools removed when the per-kind, per-type copies became one tool per operation
 * (REQ-SRV-029, #174). Each old name is refused with its replacement and the arguments to
 * use; none of them is listed or runs (no aliases).
 */
import type { ReplacedToolTable } from "@bconnect/mcp-core";

/** Old name part → endpoint type; "" is the call without a type (all endpoints). */
const SHORTS = ["", "windows_", "mac_", "linux_", "android_", "ios_", "network_", "industrial_"] as const;
const TYPES: Readonly<Record<(typeof SHORTS)[number], string>> = {
  "": "", windows_: "WindowsEndpoint", mac_: "MacEndpoint", linux_: "LinuxEndpoint", android_: "AndroidEndpoint",
  ios_: "IOSEndpoint", network_: "NetworkEndpoint", industrial_: "IndustrialEndpoint",
};

/** Old name suffix → group kind, the old id argument, and the endpoint types the API had for it. */
const KINDS = [
  ["logical_group", "LogicalGroup", "logicalGroupId", SHORTS],
  ["static_group", "StaticGroup", "staticGroupId", SHORTS],
  ["dynamic_group", "DynamicGroup", "dynamicGroupId", ["", "windows_"]],
  ["universal_dynamic_group", "UniversalDynamicGroup", "universalDynamicGroupId", SHORTS],
] as const;
const AD_USER_TYPES = ["", "windows_", "mac_", "linux_", "android_", "ios_"] as const;

export const REPLACED_TOOLS: ReplacedToolTable = {
  ...Object.fromEntries(KINDS.flatMap(([suffix, kind, idArgument, shorts]) => shorts.map((short) => [
    `list_${short}endpoints_by_${suffix}`,
    { tool: "list_group_members", variant: `list_group_members[groupKind=${kind},memberType=${TYPES[short]}]`, rename: { [idArgument]: "groupId" } },
  ]))),
  list_logical_groups_by_logical_group: {
    tool: "list_group_members", variant: "list_group_members[groupKind=LogicalGroup,memberType=LogicalGroup]", rename: { logicalGroupId: "groupId" },
  },
  ...Object.fromEntries(AD_USER_TYPES.map((short) => [
    `list_${short}endpoints_by_ad_user`,
    { tool: "list_ad_user_endpoints", variant: `list_ad_user_endpoints[endpointType=${TYPES[short]}]` },
  ])),
};
