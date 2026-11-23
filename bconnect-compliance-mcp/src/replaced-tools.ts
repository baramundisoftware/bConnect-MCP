/**
 * Renamed tools and arguments of this server (#342, naming convention: docs/TOOL_NAMING.md).
 * An old tool name answers with its replacement; an old argument name with the new one. They never
 * run: no aliases.
 */
import type { RenamedArgumentTable, ReplacedToolTable } from "@bconnect/mcp-core";

/** Old tool name → its replacement (same arguments). */
export const REPLACED_TOOLS: ReplacedToolTable = {
  list_detected_vulnerabilities_for_endpoint: { tool: "list_detected_vulnerabilities_by_endpoint", variant: "list_detected_vulnerabilities_by_endpoint" },
  list_detected_rule_violations_for_endpoint: { tool: "list_detected_rule_violations_by_endpoint", variant: "list_detected_rule_violations_by_endpoint" },
};

/** Per tool: old argument name → new name. */
export const RENAMED_ARGUMENTS: RenamedArgumentTable = {
  get_vulnerability: { vulnerabilityId: "id" },
  get_mobile_device_rule: { ruleId: "id" },
};
