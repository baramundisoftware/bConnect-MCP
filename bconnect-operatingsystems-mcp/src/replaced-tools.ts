/**
 * Renamed tools and arguments of this server (#342, naming convention: docs/TOOL_NAMING.md).
 * An old tool name answers with its replacement; an old argument name with the new one. They never
 * run: no aliases.
 */
import type { RenamedArgumentTable, ReplacedToolTable } from "@bconnect/mcp-core";

/** Old tool name → its replacement (same arguments). */
export const REPLACED_TOOLS: ReplacedToolTable = {
};

/** Per tool: old argument name → new name. */
export const RENAMED_ARGUMENTS: RenamedArgumentTable = {
  get_os_windows_endpoint: { endpointId: "id" },
  update_os_windows_endpoint: { endpointId: "id" },
};
