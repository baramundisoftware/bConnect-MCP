/**
 * Renamed tools and arguments of this server (#342, naming convention: docs/TOOL_NAMING.md).
 * An old tool name answers with its replacement; an old argument name with the new one. They never
 * run: no aliases.
 */
import type { RenamedArgumentTable, ReplacedToolTable } from "@bconnect/mcp-core";

/** Old tool name → its replacement (same arguments). */
export const REPLACED_TOOLS: ReplacedToolTable = {
  patch_local_admin_user_credentials: { tool: "update_local_admin_credentials", variant: "update_local_admin_credentials" },
};

/** Per tool: old argument name → new name. */
export const RENAMED_ARGUMENTS: RenamedArgumentTable = {
  get_defender_threat: { threatId: "id" },
  get_bitlocker_windows_endpoint: { endpointId: "id" },
  get_defender_windows_endpoint: { endpointId: "id" },
};
