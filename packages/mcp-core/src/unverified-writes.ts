/**
 * Write tools say they're unverified until checked live (REQ-XC-003 AC 5).
 *
 * A write tool counts as done only with a recorded live verification against a
 * real bMS (mock runs don't count). Until then `tools/list` ends its
 * description with UNVERIFIED_WRITE_NOTE, so the model can tell the user.
 */

/** Appended to the description of every write tool without a recorded live check. */
export const UNVERIFIED_WRITE_NOTE = "Not yet verified against a live bMS.";

/**
 * Write tools with a recorded live verification: tool name → where and when it
 * was checked. Add a tool only together with its row in the "Live verification
 * of write tools" table in Tasks.md.
 */
export const LIVE_VERIFIED_WRITE_TOOLS: ReadonlyMap<string, string> = new Map<string, string>([
  // e.g. ["update_windows_endpoint", "2026-10-05, bMS 26.1.161, test bMS"],
]);

interface ListedTool {
  name: string;
  description?: string;
}

/**
 * Wraps a server's tools/list handler: each tool in `writeTools` that has no
 * recorded live check gets UNVERIFIED_WRITE_NOTE at the end of its description.
 */
export function withUnverifiedWriteMarker<T extends { tools: ListedTool[] }>(
  writeTools: ReadonlySet<string>,
  handler: () => T | Promise<T>,
): () => Promise<T> {
  return async () => {
    const result = await handler();
    return {
      ...result,
      tools: result.tools.map((tool) =>
        writeTools.has(tool.name) && !LIVE_VERIFIED_WRITE_TOOLS.has(tool.name)
          ? { ...tool, description: `${tool.description ?? ""} ${UNVERIFIED_WRITE_NOTE}`.trim() }
          : tool),
    };
  };
}
