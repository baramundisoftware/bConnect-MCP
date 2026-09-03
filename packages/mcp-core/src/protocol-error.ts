/**
 * One "MCP error <code>: " prefix per error, not two (finding A2 / INT-53)
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Every rejection this suite produced reached the model as
 *
 *     MCP error -32602: MCP error -32602: id must be a valid GUID
 *
 * The doubling is not in this repo's formatting — it is produced by throwing a
 * stock `McpError` out of a registered request handler, in three steps inside
 * `@modelcontextprotocol/sdk`:
 *
 *   1. `McpError`'s constructor calls `super(\`MCP error ${code}: ${message}\`)`,
 *      so `.message` is already prefixed (`types.js`).
 *   2. The server's `_onrequest` rejection path copies `error.message` verbatim
 *      into the JSON-RPC `error.message` field (`shared/protocol.js`), so the
 *      prefix goes out on the wire.
 *   3. The client reconstructs `new McpError(code, response.error.message)`,
 *      which prefixes the already-prefixed string a second time.
 *
 * Nothing in between can undo it: the per-server catch-alls all begin with
 * `if (error instanceof McpError) { throw error; }`, and most validation runs
 * *before* the try block anyway, so a catch-all-only fix closes nothing.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 * Carry the bare message on `.message` so step 2 puts a bare message on the
 * wire and step 3 prefixes it exactly once. `code`, `data` and — importantly —
 * `instanceof McpError` are untouched, so every `if (error instanceof McpError)`
 * branch in the thirteen servers and every `err.code` assertion in the test
 * suite keeps working.
 *
 * A `BareMcpError` thrown anywhere other than a request handler (e.g. caught
 * and inspected in-process) simply reads without the prefix, which is what a
 * human wanted from it in the first place.
 */

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/**
 * An `McpError` whose `.message` is the message you passed, with no
 * `MCP error <code>: ` prefix baked in.
 *
 * Prefer this over `new McpError(...)` for anything thrown out of an MCP
 * request handler. Use plain `McpError` only where the prefixed text is
 * genuinely wanted.
 */
export class BareMcpError extends McpError {
  constructor(code: ErrorCode | number, message: string, data?: unknown) {
    super(code, message, data);
    // `super()` stored `MCP error <code>: <message>`. Overwrite it — the SDK
    // adds the prefix again on the client side when it rebuilds the error.
    this.message = message;
    this.name = "BareMcpError";
  }
}

/**
 * Remove the SDK's `MCP error <code>: ` prefix from a message, however many
 * times it has been applied.
 *
 * Useful when re-wrapping an error whose message may already have been through
 * `McpError` — e.g. a catch-all that folds an arbitrary `Error` into a
 * protocol error.
 */
export function stripMcpErrorPrefix(message: string): string {
  let out = String(message ?? "");
  let next = out.replace(/^MCP error -?\d+: /, "");
  while (next !== out) {
    out = next;
    next = out.replace(/^MCP error -?\d+: /, "");
  }
  return out;
}
