/**
 * One error channel for every server (findings INT-11 / INT-53, INT-1)
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * The suite answers a failing tool call in two incompatible ways:
 *
 *   - the write gate and the secret gate return `{ isError: true, content: [...] }`
 *     — a *tool result* the model reads and can recover from;
 *   - every other failure throws `McpError(InternalError, "Tool execution
 *     failed: ...")` — a *protocol* error, which MCP clients surface
 *     differently, and which miscodes a 404 (the caller passed a bad id) as
 *     -32603 "internal error".
 *
 * So the two most common recoverable mistakes a model makes — wrong id, denied
 * permission — arrive on the channel reserved for "the server is broken", while
 * a policy refusal arrives on the channel reserved for "here is your answer".
 *
 * ── The rule this module implements ─────────────────────────────────────────
 *   expected API failure (400 / 403 / 404 / 429) -> isError tool result
 *   policy refusal (write gate, secret gate)     -> isError tool result
 *   caller's request was malformed (validation)  -> protocol error, unchanged
 *   anything else (401, 5xx, TLS, transport, bug) -> protocol InternalError
 *
 * 401 and 5xx sit deliberately on the fault side: no argument the model can
 * choose will fix bad service credentials or a bMS that is down, so presenting
 * them as a recoverable tool result invites a retry loop. 400/403/404/429 are
 * all answerable by the model — correct the body, drop the field, use a
 * different id, slow down.
 *
 * ── Why the status has to be carried, not guessed ───────────────────────────
 * `BConnectClientBase.handleError()` used to throw a plain `Error` whose text
 * was the only surviving evidence of what happened, so anything downstream had
 * to pattern-match English sentences to find out whether it was looking at a
 * 404 or a 500. `BConnectApiError` (below) carries `status`, `method` and
 * `path`; the message is unchanged byte-for-byte, so every existing assertion
 * on the text still passes. `classifyToolError` still falls back to matching
 * those sentences, because errors constructed by hand inside the servers'
 * modules never went through `handleError` at all.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 * ```ts
 * import { handleToolError } from "@bconnect/mcp-core";
 *
 * server.setRequestHandler(CallToolRequestSchema, async (request) => {
 *   const { name, arguments: args } = request.params;
 *   try {
 *     switch (name) { ... }
 *   } catch (error: unknown) {
 *     // Replaces:
 *     //   if (error instanceof McpError) { throw error; }
 *     //   throw new BareMcpError(ErrorCode.InternalError, `Tool execution failed: ${...}`);
 *     return handleToolError(error, { tool: name });
 *   }
 * });
 * ```
 */

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { BareMcpError, stripMcpErrorPrefix } from "./protocol-error.js";

// ── The transport-level error the client throws ──────────────────────────────

/**
 * An HTTP failure from the bConnect API, carrying the status that produced it.
 *
 * Thrown by `BConnectClientBase.handleError()` in place of the plain `Error` it
 * used to throw. `message` is identical to what that method produced before —
 * the sentence, the request summary, the API's own detail and the release hint
 * — so nothing that reads the text needs to change.
 */
export class BConnectApiError extends Error {
  /** HTTP status returned by bConnect. */
  readonly status: number;
  /** Upper-case HTTP method, when known. */
  readonly method?: string;
  /** Request path (never the host — see the sanitisation in `handleError`). */
  readonly path?: string;

  constructor(
    status: number,
    message: string,
    where?: { method?: string; path?: string }
  ) {
    super(message);
    this.name = "BConnectApiError";
    this.status = status;
    this.method = where?.method;
    this.path = where?.path;
  }
}

// ── Classification ───────────────────────────────────────────────────────────

/**
 * HTTP statuses an LLM caller can act on by itself.
 *
 * 400 — the body or a filter was wrong; the API's validation detail is in the
 *       message. 403 — this credential may not do that. 404 — wrong id, or the
 *       route does not exist on this release. 429 — back off.
 * 409 — the resource's current state conflicts with the request. 412 — a
 *       precondition the caller can satisfy. 423 — something else holds the
 *       lock; wait and retry.
 *
 * 409/412/423 were absent, and that was the most-hit error path in the suite.
 * Measured live: 25 of 26 endpoints and 18 of 19 logical groups answer
 * `GET .../MaintenanceWindow` with 409 and the detail *"Requested resource has
 * no maintenance window"* — a complete, ordinary answer to "does this machine
 * have a maintenance window?". Routing it to `-32603 InternalError` tells the
 * model the server is broken, on 96% of calls, for a question that was
 * answered correctly. A model that sees that concludes the tool does not work
 * and stops calling it.
 *
 * 26R1 declares 409 on 47 operations, 412 on 1 and 423 on 2, and every one is
 * caller-recoverable: a name already exists, a folder is not empty, another
 * cleanup is running, there is no maintenance window.
 */
export const EXPECTED_HTTP_STATUSES: readonly number[] = Object.freeze([
  400, 403, 404, 409, 412, 423, 429,
]);

/** How a failure should reach the client. */
export type ToolErrorKind =
  /** Recoverable by the caller: return as an `isError` tool result. */
  | "expected"
  /** Already a protocol error (validation, gate, unknown tool): rethrow as-is. */
  | "protocol"
  /** Nobody's fault but the deployment's: protocol `InternalError`. */
  | "fault";

export interface ClassifiedToolError {
  kind: ToolErrorKind;
  /** HTTP status when one is known — carried, or recovered from the message. */
  status?: number;
  /** The message with any `MCP error <code>: ` prefixes removed. */
  message: string;
  /** Set when `kind === "protocol"`: the code the error already carries. */
  code?: number;
}

/**
 * Sentences `BConnectClientBase.handleError()` emits, mapped back to the status
 * that produced them.
 *
 * Only a fallback. Errors that come from `handleError` carry `status` on a
 * `BConnectApiError` and never reach this table; errors constructed by hand in
 * a server module (or by an older build of mcp-core) do.
 */
const MESSAGE_STATUS_PATTERNS: readonly { pattern: RegExp; status: number }[] = Object.freeze([
  { pattern: /^bConnect API error \(HTTP (\d{3})\)/, status: 0 }, // 0 = read it out of the match
  { pattern: /^Authentication failed\./, status: 401 },
  { pattern: /^Access denied\. Insufficient permissions/, status: 403 },
  { pattern: /^Resource not found\./, status: 404 },
  { pattern: /^Rate limit exceeded/, status: 429 },
  { pattern: /^bConnect API returned an internal server error\./, status: 500 },
]);

/** Pull an HTTP status off whatever shape the error happens to have. */
function statusOf(error: unknown): number | undefined {
  if (error instanceof BConnectApiError) {
    return error.status;
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      status?: unknown;
      statusCode?: unknown;
      response?: { status?: unknown };
    };
    for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
  }

  const message = error instanceof Error ? error.message : "";
  for (const { pattern, status } of MESSAGE_STATUS_PATTERNS) {
    const match = pattern.exec(message);
    if (match) {
      return status === 0 ? Number(match[1]) : status;
    }
  }

  return undefined;
}

/**
 * Decide which channel a thrown value belongs on.
 *
 * Pure — it neither throws nor formats. `handleToolError` is the thing you
 * normally want; this is exported for servers that need to branch themselves
 * (e.g. to add a domain-specific hint before answering).
 */
export function classifyToolError(error: unknown): ClassifiedToolError {
  if (error instanceof McpError) {
    // Validation failures, `Unknown tool`, and the request-blocked guards are
    // already protocol errors with the right code. Reclassifying them would
    // undo work that A2/SEC-0 did deliberately.
    return {
      kind: "protocol",
      message: stripMcpErrorPrefix(error.message),
      code: error.code,
    };
  }

  const message = stripMcpErrorPrefix(
    error instanceof Error ? error.message : String(error)
  );
  const status = statusOf(error);

  if (status !== undefined && EXPECTED_HTTP_STATUSES.includes(status)) {
    return { kind: "expected", status, message };
  }

  return { kind: "fault", ...(status === undefined ? {} : { status }), message };
}

// ── Result shapes ────────────────────────────────────────────────────────────

/**
 * The MCP `CallToolResult` subset this module produces.
 *
 * Structurally assignable to the SDK's `CallToolResult`, and declared locally so
 * a server can return it from a handler without importing SDK result types.
 */
export interface ToolTextResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

/** A successful tool result carrying one text block. */
export function toolTextResult(text: string): ToolTextResult {
  return { content: [{ type: "text", text }] };
}

/**
 * A failed-but-readable tool result: `isError: true` plus the message.
 *
 * The same shape the write gate and the secret gate already return, so a model
 * sees one failure shape across policy refusals and API failures alike. No
 * decoration is added — `handleError` messages already carry the request
 * summary, the API's own validation detail and the release hint, and every
 * extra word here is charged to the caller's context on every failure.
 */
export function toolErrorResult(message: string): ToolTextResult {
  return { content: [{ type: "text", text: stripMcpErrorPrefix(message) }], isError: true };
}

/**
 * The one-line catch-all. Returns a readable tool result for failures the caller
 * can act on, and throws a protocol error for everything else.
 *
 * Takes no tool name on purpose: the fault text is kept byte-identical to the
 * thirteen hand-written catch-alls it replaces, and an MCP client already knows
 * which tool call it is holding the answer to — the name would be paid for in
 * the model's context on every failure and tell it nothing new.
 *
 * @throws {McpError} for protocol errors (rethrown untouched) and for faults
 *                    (`InternalError`, message unchanged from the old catch-all).
 */
export function handleToolError(error: unknown): ToolTextResult {
  const classified = classifyToolError(error);

  if (classified.kind === "protocol") {
    throw error as McpError;
  }

  if (classified.kind === "expected") {
    return toolErrorResult(classified.message);
  }

  throw new BareMcpError(
    ErrorCode.InternalError,
    `Tool execution failed: ${classified.message}`
  );
}
