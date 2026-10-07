/**
 * Write tools say they're unverified until checked live (REQ-XC-003 AC 5).
 *
 * A write tool counts as done only with a recorded live verification against a
 * real bMS (mock runs don't count). Until then `tools/list` ends its
 * description with UNVERIFIED_WRITE_NOTE, so the model can tell the user.
 */
import { selectedRelease, type ToolReleaseTable } from "./release.js";
import { describeVariant, type ToolVariantTable } from "./tool-variants.js";

/** Appended to the description of every write tool without a recorded live check. */
export const UNVERIFIED_WRITE_NOTE = "Not yet verified against a live bMS.";

/**
 * Write tools with a recorded live verification: tool name (for a merged tool,
 * the variant key, e.g. `update_endpoint[type=WindowsEndpoint]`) → where and
 * when it was checked. Add a tool only together with its row in the "Live verification
 * of write tools" table in Tasks.md.
 */
export const LIVE_VERIFIED_WRITE_TOOLS: ReadonlyMap<string, string> = new Map<string, string>([
  ["update_endpoint[type=WindowsEndpoint]", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: comment changed and read back"],
  ["update_endpoint[type=MacEndpoint]", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: comment changed with the capitalised path /Comment and read back"],
  ["update_logical_group", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: comment changed and read back"],
  ["create_windows_endpoint", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: record without a device created and read back"],
  ["create_mac_endpoint", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: record without a device created and read back"],
  ["create_logical_group", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: created below an existing group; a child created seconds after its new parent once landed at the root (bMS side, likely timing)"],
  ["delete_endpoint[type=WindowsEndpoint]", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: test record deleted"],
  ["delete_endpoint[type=MacEndpoint]", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: test record deleted"],
  ["delete_logical_group", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: test group deleted; an account without delete rights gets 403"],
  ["create_maintenance_window_for_logical_group", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: Everyday with one interval created and read back"],
  ["update_maintenance_window_for_logical_group", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: Everyday → Anytime → Never → Everyday, read back after each step"],
  ["delete_maintenance_window_for_logical_group", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: window deleted"],
  ["create_job_folder", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: folder and sub-folder created; listed with its parent"],
  ["update_job_folder", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: comment changed (JSON Patch) and read back"],
  ["delete_job_folder", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: test folders deleted"],
  ["create_kiosk_release", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: release to a test group created and read back with the right target"],
  ["withdraw_kiosk_release", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: test release withdrawn; an existing release untouched"],
  ["assign_job_to_logical_group", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: instances created on all sub-group levels; on a busy bMS the answer can take longer than 30 s, and the outcome is then reported as unknown"],
  ["delete_job_instance", "2026-10-02, bMS 26.1.161 (26R1), test bMS, restricted account in a sandbox: test job instances deleted"],
]);

/** A merged write tool's variants and their releases (REQ-SRV-029): live checks are recorded per variant key. */
export interface WriteToolVariants {
  variants: ToolVariantTable;
  releases: ToolReleaseTable;
}

/**
 * What a write tool's description ends with: nothing when it has a recorded live
 * check, else UNVERIFIED_WRITE_NOTE. A merged tool is checked per variant of the
 * selected release: all verified → nothing; none → the note; some → the note
 * naming the unverified ones ("… for: type "AndroidEndpoint"; without type.").
 */
function unverifiedNote(name: string, variants: WriteToolVariants | undefined): string | undefined {
  if (!variants || !Object.hasOwn(variants.variants, name)) {
    return LIVE_VERIFIED_WRITE_TOOLS.has(name) ? undefined : UNVERIFIED_WRITE_NOTE;
  }
  const release = selectedRelease();
  const here = Object.entries(variants.variants[name]).filter(([key]) => (variants.releases[key] ?? []).includes(release));
  const unverified = here.filter(([key]) => !LIVE_VERIFIED_WRITE_TOOLS.has(key));
  if (unverified.length === 0) {
    return undefined;
  }
  if (unverified.length === here.length) {
    return UNVERIFIED_WRITE_NOTE;
  }
  return `${UNVERIFIED_WRITE_NOTE.replace(/\.$/, "")} for: ${unverified.map(([, select]) => describeVariant(select)).join("; ")}.`;
}

/** The tool with its unverified note appended if it's a write tool without a recorded live check. */
function markIfUnverified<Tool extends object>(tool: Tool, writeTools: ReadonlySet<string>, variants?: WriteToolVariants): Tool {
  if (!("name" in tool) || typeof tool.name !== "string" || !writeTools.has(tool.name)) {
    return tool;
  }
  const note = unverifiedNote(tool.name, variants);
  if (note === undefined) {
    return tool;
  }
  const description = "description" in tool && typeof tool.description === "string" ? tool.description : "";
  return { ...tool, description: `${description} ${note}`.trim() };
}

/**
 * Wraps a server's tools/list handler: each tool in `writeTools` that has no
 * recorded live check gets UNVERIFIED_WRITE_NOTE at the end of its description;
 * a merged tool in `variants` is checked per variant of the selected release.
 */
export function withUnverifiedWriteMarker<Result extends { tools: object[] }>(
  writeTools: ReadonlySet<string>,
  handler: () => Result | Promise<Result>,
  variants?: WriteToolVariants,
): () => Promise<Result> {
  return async () => {
    const result = await handler();
    return { ...result, tools: result.tools.map((tool) => markIfUnverified(tool, writeTools, variants)) };
  };
}
