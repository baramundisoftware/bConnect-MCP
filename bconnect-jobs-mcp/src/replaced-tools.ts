/**
 * Renamed tools and arguments of this server (#342, naming convention: docs/TOOL_NAMING.md).
 * An old tool name answers with its replacement; an old argument name with the new one. They never
 * run: no aliases.
 */
import type { RenamedArgumentTable, ReplacedToolTable } from "@bconnect/mcp-core";

/** Old tool name → its replacement (same arguments). */
export const REPLACED_TOOLS: ReplacedToolTable = {
  list_endpoint_job_instances: { tool: "list_job_instances_by_endpoint", variant: "list_job_instances_by_endpoint" },
};

/** Per tool: old argument name → new name. */
export const RENAMED_ARGUMENTS: RenamedArgumentTable = {
};
