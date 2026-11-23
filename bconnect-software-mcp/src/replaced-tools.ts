/**
 * Renamed tools and arguments of this server (#342, naming convention: docs/TOOL_NAMING.md).
 * An old tool name answers with its replacement; an old argument name with the new one. They never
 * run: no aliases.
 */
import type { RenamedArgumentTable, ReplacedToolTable } from "@bconnect/mcp-core";

/** Old tool name → its replacement (same arguments). */
export const REPLACED_TOOLS: ReplacedToolTable = {
  list_installed_software_by_dynamic_group: { tool: "list_installed_software_by_universal_dynamic_group", variant: "list_installed_software_by_universal_dynamic_group" },
};

/** Per tool: old argument name → new name. */
export const RENAMED_ARGUMENTS: RenamedArgumentTable = {
  get_software_bundle: { bundleId: "id" },
  delete_software_bundle: { bundleId: "id" },
};
