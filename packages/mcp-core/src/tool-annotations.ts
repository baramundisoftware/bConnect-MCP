/**
 * MCP tool annotations for every tool (REQ-SRV-024, #296).
 *
 * Each tool's hints come from the HTTP methods of the bConnect operations it
 * calls (the generated src/tool-methods.ts of each server), not from a hand
 * list: only GET is read-only; any DELETE is destructive. The one hand-written
 * part is DESTRUCTIVE_WRITE_TOOLS, the other writes that destroy something,
 * each with its reason. The hints are for clients only: the write and secret
 * gates stay the control. __tests__/tool-annotations.guard.test.ts checks every
 * tool against the specs, its traffic and the write gate.
 *
 * withWriteToolsHidden (REQ-SRV-026, #156) uses the same classification to
 * leave the write tools out of tools/list while writes are off.
 */

/** Per tool: the HTTP methods of the operations it calls, in either bMS release. */
export type ToolMethodTable = Readonly<Record<string, readonly string[]>>;

/** What a tool does to bMS: only reads, writes, or writes something that can't be put back. */
export type ToolEffect = "read" | "write" | "destructive";

/**
 * Writes without a DELETE that are destructive anyway: tool name → why. Every
 * other write is not destructive. Add a tool only with its reason.
 */
export const DESTRUCTIVE_WRITE_TOOLS: ReadonlyMap<string, string> = new Map<string, string>([
  ["msw_cleanup", "Deletes managed-software files from the master DIP; no tool restores them."],
  ["patch_local_admin_user_credentials", "A requested expiration date in the past makes the endpoint generate new local admin credentials; the current ones stop working."],
  ["update_bitlocker_pin", "Replaces the BitLocker PIN; the old PIN can't be restored, and the device can't be unlocked without the new one."],
  ["create_job_instance", "Runs a job definition on an endpoint; a job can uninstall software, run any script or reinstall the OS."],
  ["start_job_instance", "Runs a job on an endpoint; a job can uninstall software, run any script or reinstall the OS."],
  ["resume_job_instance", "Runs the rest of a job on an endpoint; a job can uninstall software, run any script or reinstall the OS."],
  ["assign_job_to_logical_group", "Runs a job definition on every endpoint of the group; a job can uninstall software, run any script or reinstall the OS."],
  ["assign_job_to_static_group", "Runs a job definition on every endpoint of the group; a job can uninstall software, run any script or reinstall the OS."],
  ["assign_job_to_dynamic_group", "Runs a job definition on every endpoint of the group; a job can uninstall software, run any script or reinstall the OS."],
  ["assign_job_to_universal_dynamic_group", "Runs a job definition on every endpoint of the group; a job can uninstall software, run any script or reinstall the OS."],
]);

/**
 * The effect of a tool that calls `methods`: read for GET only; destructive
 * for any DELETE or a tool in DESTRUCTIVE_WRITE_TOOLS; write otherwise. Several
 * operations: the strongest effect wins. Throws for no methods, as the tool
 * then has no generated entry.
 */
export function toolEffect(name: string, methods: readonly string[]): ToolEffect {
  if (methods.length === 0) {
    throw new Error(`No HTTP methods for ${name}; run node scripts/generate-query-parameters.mjs`);
  }
  const upper = methods.map((m) => m.toUpperCase());
  if (upper.every((m) => m === "GET")) {
    return "read";
  }
  return upper.includes("DELETE") || DESTRUCTIVE_WRITE_TOOLS.has(name) ? "destructive" : "write";
}

/** Words of tool names spelled as bMS spells them in a title. */
const SPELLING: Readonly<Record<string, string>> = {
  ad: "AD", android: "Android", api: "API", bitlocker: "BitLocker", defender: "Defender", dip: "DIP",
  entra: "Entra", id: "ID", intune: "Intune", ios: "iOS", kiosk: "Kiosk", linux: "Linux", mac: "Mac",
  msw: "MSW", os: "OS", pin: "PIN", pxe: "PXE", udg: "UDG", vpn: "VPN", windows: "Windows",
};

/** A readable title from the tool name: `list_windows_endpoints` → "List Windows endpoints". */
export function toolTitle(name: string): string {
  return name.split("_").map((word, i) => {
    const spelled = Object.hasOwn(SPELLING, word) ? SPELLING[word] : word;
    return i === 0 ? spelled.charAt(0).toUpperCase() + spelled.slice(1) : spelled;
  }).join(" ");
}

/** The MCP annotations a tool declares: `destructiveHint` only where the spec gives it meaning (not read-only). */
export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
}

/** The annotations of a tool that calls `methods`. */
export function toolAnnotations(name: string, methods: readonly string[]): ToolAnnotations {
  const effect = toolEffect(name, methods);
  const title = toolTitle(name);
  return effect === "read"
    ? { title, readOnlyHint: true }
    : { title, readOnlyHint: false, destructiveHint: effect === "destructive" };
}

/** The tool with its annotations from `table`; an entry without a name is left alone. */
function annotate<Tool extends object>(tool: Tool, table: ToolMethodTable): Tool {
  if (!("name" in tool) || typeof tool.name !== "string") {
    return tool;
  }
  const methods = Object.hasOwn(table, tool.name) ? table[tool.name] : [];
  return { ...tool, annotations: toolAnnotations(tool.name, methods) };
}

/**
 * Wraps a server's tools/list handler: every tool gets its annotations from
 * `table`. A tool missing from the table is an error (the table wasn't
 * regenerated).
 */
export function withToolAnnotations<Result extends { tools: object[] }>(
  table: ToolMethodTable,
  handler: () => Result | Promise<Result>,
): () => Promise<Result> {
  return async () => {
    const result = await handler();
    return { ...result, tools: result.tools.map((tool) => annotate(tool, table)) };
  };
}

/** Whether a listed tool may stay while writes are off: only read tools; an entry without a name stays. */
function isReadTool(tool: object, table: ToolMethodTable): boolean {
  if (!("name" in tool) || typeof tool.name !== "string") {
    return true;
  }
  const methods = Object.hasOwn(table, tool.name) ? table[tool.name] : [];
  return toolEffect(tool.name, methods) === "read";
}

/**
 * Wraps a server's tools/list handler: while `writesAllowed()` is false, every
 * tool whose effect isn't "read" is left out; otherwise the list is returned as
 * is. Asked on every request, as the write gate asks on every call. Wrap only
 * the tools/list handler: the gate and the argument check keep the full list,
 * so a hidden tool called by name is refused as before. Hiding saves context;
 * the gate stays the control.
 */
export function withWriteToolsHidden<Result extends { tools: object[] }>(
  table: ToolMethodTable,
  writesAllowed: () => boolean,
  handler: () => Result | Promise<Result>,
): () => Promise<Result> {
  return async () => {
    const result = await handler();
    if (writesAllowed()) {
      return result;
    }
    return { ...result, tools: result.tools.filter((tool) => isReadTool(tool, table)) };
  };
}
