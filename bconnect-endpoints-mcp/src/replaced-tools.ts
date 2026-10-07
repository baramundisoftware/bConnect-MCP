/**
 * Endpoint tools removed when the per-type copies became one tool per operation
 * (REQ-SRV-029, #174). Each old name is refused with its replacement and the
 * arguments to use; none of them is listed or runs (no aliases).
 */
import type { ReplacedToolTable } from "@bconnect/mcp-core";

const TYPES = {
  windows: "WindowsEndpoint", mac: "MacEndpoint", android: "AndroidEndpoint", ios: "IOSEndpoint",
  linux: "LinuxEndpoint", network: "NetworkEndpoint", industrial: "IndustrialEndpoint",
} as const;
const ENROLLMENT_TYPES = ["windows", "mac", "android", "ios"] as const;

export const REPLACED_TOOLS: ReplacedToolTable = {
  ...Object.fromEntries(Object.entries(TYPES).flatMap(([short, type]) => [
    [`list_${short}_endpoints`, { tool: "list_endpoints", variant: `list_endpoints[type=${type}]` }],
    [`get_${short}_endpoint`, { tool: "get_endpoint", variant: `get_endpoint[type=${type}]` }],
    [`update_${short}_endpoint`, { tool: "update_endpoint", variant: `update_endpoint[type=${type}]` }],
    [`delete_${short}_endpoint`, { tool: "delete_endpoint", variant: `delete_endpoint[type=${type}]` }],
  ])),
  ...Object.fromEntries(ENROLLMENT_TYPES.map((short) =>
    [`start_${short}_enrollment`, { tool: "start_enrollment", variant: `start_enrollment[type=${TYPES[short]}]` }])),
  search_endpoints: { tool: "list_endpoints", variant: "list_endpoints[type=]", rename: { query: "SearchQuery", pageSize: "PageSize" } },
  list_group_endpoints: { tool: "list_endpoints_by_logical_group", variant: "list_endpoints_by_logical_group[type=]" },
  list_windows_endpoints_by_logical_group: { tool: "list_endpoints_by_logical_group", variant: "list_endpoints_by_logical_group[type=WindowsEndpoint]" },
};
