/**
 * Tool-catalogue composition and the write gate (finding TOK-1 / TOK-20)
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * All thirteen servers register every create_/update_/delete_/start_/trigger_/
 * link_ tool unconditionally in their ListTools handler, then refuse the call
 * at dispatch time when `ALLOW_WRITE_OPERATIONS !== "true"`. In the documented
 * default posture — writes disabled — a client therefore downloads and holds in
 * context the full schema of 93 tools whose only possible answer is the string
 * "Write operation '...' is disabled".
 *
 * Measured by importing each built `createServer` factory and serialising the
 * tools/list result: 284 tools / 187,722 bytes total, of which 93 tools /
 * 45,154 bytes (~11,300 tokens, 24% of the schema budget) are write tools.
 *
 * The precedent for conditional registration already exists inside the same
 * handler — `if (is26R1) { tools.push(...) }` — so this is not a new mechanism,
 * only a shared one.
 *
 * ── What this module guarantees ─────────────────────────────────────────────
 * 1. With `ALLOW_WRITE_OPERATIONS=true`, `listTools()` returns exactly the tools
 *    the server declared, in exactly the order it declared them. Turning the
 *    gate on must be a no-op against the pre-existing surface — that is what
 *    makes this safe to adopt in thirteen servers at once.
 * 2. The gate is read per call, not captured at construction. A test (and a
 *    long-lived gateway process whose environment is re-read) can flip it.
 * 3. Hiding a tool is not the same as disabling it. A client that already knows
 *    a write tool's name can still call it, and `gateWriteTool()` answers with
 *    the same refusal string the hand-written gates return today. Visibility is
 *    a token optimisation; the gate is the security control, and it stays.
 *
 * ── Two ways to declare, because order matters ──────────────────────────────
 * `{ read, write }` is the natural shape for a new server. Existing servers
 * interleave reads and writes in one hand-maintained array, and reordering that
 * array changes the tools/list payload for no reason — so `{ tools, write }`
 * takes the declared array untouched plus the set of names that are writes.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 * ```ts
 * import { defineToolCatalogue, ListToolsRequestSchema } from "...";
 *
 * const catalogue = defineToolCatalogue({
 *   tools: TOOLS,                       // the existing hand-written array
 *   write: ["create_windows_endpoint", "delete_endpoint", ...],
 * });
 *
 * server.setRequestHandler(ListToolsRequestSchema, async () => ({
 *   tools: catalogue.listTools(),       // writes omitted unless the gate is open
 * }));
 *
 * server.setRequestHandler(CallToolRequestSchema, async (request) => {
 *   const denied = catalogue.gateWriteTool(request.params.name);
 *   if (denied) { return denied; }
 *   ...
 * });
 * ```
 */

import type { ToolTextResult } from "./tool-error.js";
import { BareMcpError } from "./protocol-error.js";
import { annotateIdParameters } from "./id-producers.js";
import { assertSafePathSegment } from "./path-guard.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/** Env var that opens the write gate. One spelling, suite-wide. */
export const ALLOW_WRITE_OPERATIONS_ENV = "ALLOW_WRITE_OPERATIONS";

/**
 * Minimum a catalogue entry has to have. Deliberately structural: servers pass
 * their own object literals through unchanged, so `listTools()` hands the SDK
 * back the very objects the server wrote, with their literal types intact.
 */
export interface ToolLike {
  name: string;
}

/** Is the write gate open? Read per call — never cached. */
export function writeOperationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ALLOW_WRITE_OPERATIONS_ENV] === "true";
}

/**
 * The refusal text, unchanged from the thirteen hand-written gates so existing
 * assertions and operator runbooks keep matching.
 */
export function writeDisabledMessage(toolName: string): string {
  return (
    `Write operation '${toolName}' is disabled. ` +
    `Set ${ALLOW_WRITE_OPERATIONS_ENV}=true to enable write operations.`
  );
}

export type ToolCatalogueSpec<T extends ToolLike> =
  | {
      /** Tools that only read. Always advertised. */
      read: readonly T[];
      /** Tools that mutate. Advertised only when the write gate is open. */
      write?: readonly T[];
      tools?: never;
    }
  | {
      /** The full declared array, in the order it should be advertised. */
      tools: readonly T[];
      /** Names within `tools` that are writes. */
      write: Iterable<string>;
      read?: never;
    };

export interface ToolCatalogue<T extends ToolLike> {
  /**
   * The tools to advertise right now: everything when the write gate is open,
   * reads only when it is shut.
   */
  listTools(env?: NodeJS.ProcessEnv): T[];
  /** Every declared tool, gate or no gate. */
  allTools(): T[];
  /** Names of the write tools, as declared. */
  readonly writeToolNames: ReadonlySet<string>;
  /** Names of the read tools, as declared. */
  readonly readToolNames: ReadonlySet<string>;
  isWriteTool(name: string): boolean;
  /**
   * `undefined` when the call may proceed; the refusal tool result when it is a
   * write and the gate is shut. Call it before dispatch, for every tool.
   */
  gateWriteTool(name: string, env?: NodeJS.ProcessEnv): ToolTextResult | undefined;
  /**
   * `name -> declared property names`, for the argument validators that reject
   * unknown keys (SEC-0/D6: bConnect answers 200 and ignores a misspelt filter,
   * so an unknown key silently produces a confident wrong answer).
   */
  declaredParameters(): Map<string, Set<string>>;
  /**
   * Throw `-32602` if `args` carries a key this tool's schema does not declare.
   *
   * Call it before dispatch for EVERY tool. It is not a nicety: `validateParameters`
   * iterates over *rules*, so an argument with no rule was never examined by
   * anything, and bConnect answers HTTP 200 while silently ignoring a query key
   * it does not recognise (finding D6). The two together mean a single typo
   * returns the full unfiltered collection, labelled as a filtered result.
   *
   * Measured live before this existed: `list_vulnerabilities` with `SearchQuery`
   * misspelt as `SearchQuer` returned **37,571 items instead of 1**, HTTP 200,
   * with the bogus key echoed back in `filters` as though it had been honoured.
   *
   * A tool name the catalogue does not know is left alone — dispatch answers
   * that with MethodNotFound, and it is not this function's business.
   */
  assertKnownParameters(name: string, args: Record<string, unknown> | undefined): void;
  /**
   * Throw if any id-shaped argument is not a single, traversal-free path
   * segment. Call it before dispatch for EVERY tool.
   *
   * Modules build URLs by interpolating a caller-supplied id into
   * `` `${basePath}/Endpoints/${id}` ``, and `basePath` is only a prefix — so
   * an id of `../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints` walks
   * out of the module. Verified live in a prior phase: it returned 23 BitLocker
   * records and the API-key inventory. One credential serves all 13 servers, so
   * the traversal from any one of them reaches the union of what every deployed
   * server can read.
   *
   * `assertSafePathSegment` existed and was wired into 3 of 13 servers. The
   * other 10 relied on GUID-format validation, which covers GUID-typed ids and
   * nothing else, or on the transport interceptor alone — which is the backstop
   * and should not be the only wall. Being on the catalogue makes it structural:
   * a new server gets it by using the catalogue, not by remembering.
   */
  assertSafePathParameters(name: string, args: Record<string, unknown> | undefined): void;
}

/**
 * Reject an argument key that no schema declares.
 *
 * Exported separately so a server with a second, separately gated catalogue
 * (the bConnect v1.1 slices) can apply the same check with its own declared
 * set, without either catalogue having to know about the other.
 */
export function assertNoUnknownParameters(
  toolName: string,
  args: Record<string, unknown> | undefined,
  declared: ReadonlySet<string>
): void {
  const unknownKeys = Object.keys(args ?? {}).filter((key) => !declared.has(key));
  if (unknownKeys.length === 0) {
    return;
  }
  const declaredList = [...declared].join(", ") || "(none)";
  throw new BareMcpError(
    ErrorCode.InvalidParams,
    `${toolName}: unknown parameter${unknownKeys.length > 1 ? "s" : ""} ` +
      `${unknownKeys.map((key) => `'${key}'`).join(", ")}. ` +
      `This tool accepts: ${declaredList}. ` +
      "The bConnect API ignores unrecognised query keys and returns the full unfiltered " +
      "set with HTTP 200, so a misspelled filter would have produced a wrong answer that " +
      "looked correct."
  );
}

/** Property names an entry's `inputSchema` declares, if it has one. */
function declaredPropertyNames(tool: ToolLike): Set<string> {
  const schema = (tool as { inputSchema?: { properties?: Record<string, unknown> } }).inputSchema;
  return new Set(Object.keys(schema?.properties ?? {}));
}

/**
 * Compose a server's tool catalogue.
 *
 * @throws {Error} if a tool name is declared twice, or if `{ tools, write }`
 *                 names a write tool that is not in `tools`. Both are
 *                 copy-paste mistakes that otherwise surface as a tool the gate
 *                 silently fails to cover — the class of bug that let
 *                 `link_entra_id_data` execute ungated (finding F21).
 */
export function defineToolCatalogue<T extends ToolLike>(
  spec: ToolCatalogueSpec<T>
): ToolCatalogue<T> {
  let ordered: readonly T[];
  let writeNames: Set<string>;

  if (spec.tools !== undefined) {
    ordered = spec.tools;
    writeNames = new Set(spec.write);
    const declared = new Set(ordered.map((tool) => tool.name));
    const missing = [...writeNames].filter((name) => !declared.has(name));
    if (missing.length > 0) {
      throw new Error(
        `defineToolCatalogue: write tool(s) not present in \`tools\`: ${missing.join(", ")}. ` +
          "A gated name that matches no advertised tool gates nothing."
      );
    }
  } else {
    ordered = [...spec.read, ...(spec.write ?? [])];
    writeNames = new Set((spec.write ?? []).map((tool) => tool.name));
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tool of ordered) {
    if (seen.has(tool.name)) {
      duplicates.add(tool.name);
    }
    seen.add(tool.name);
  }
  if (duplicates.size > 0) {
    throw new Error(
      `defineToolCatalogue: duplicate tool name(s): ${[...duplicates].join(", ")}. ` +
        "Two entries with one name means the second is unreachable and its schema " +
        "bytes are paid for nothing."
    );
  }

  const readNames = new Set(ordered.map((tool) => tool.name).filter((name) => !writeNames.has(name)));

  // Tell a caller where each opaque id comes from, once, here — rather than in
  // 127 hand-edited descriptions across 13 servers, which is the drift this
  // project keeps finding. A producer in ANOTHER server is named with its
  // server, because 33 tools consume an id only a different server can make
  // and no description used to admit that. See id-producers.ts.
  const ownNames = new Set(ordered.map((tool) => tool.name));
  const annotated = annotateIdParameters(ordered, ownNames);
  const annotatedReads = annotated.filter((tool) => !writeNames.has(tool.name));

  /** Memo for `assertKnownParameters`, which runs on every tool call. */
  let declaredByName: Map<string, Set<string>> | undefined;

  return {
    listTools(env: NodeJS.ProcessEnv = process.env): T[] {
      return writeOperationsEnabled(env) ? [...annotated] : [...annotatedReads];
    },
    allTools(): T[] {
      return [...annotated];
    },
    writeToolNames: writeNames,
    readToolNames: readNames,
    isWriteTool(name: string): boolean {
      return writeNames.has(name);
    },
    gateWriteTool(name: string, env: NodeJS.ProcessEnv = process.env): ToolTextResult | undefined {
      if (!writeNames.has(name) || writeOperationsEnabled(env)) {
        return undefined;
      }
      return {
        content: [{ type: "text", text: writeDisabledMessage(name) }],
        isError: true,
      };
    },
    declaredParameters(): Map<string, Set<string>> {
      return new Map(ordered.map((tool) => [tool.name, declaredPropertyNames(tool)]));
    },
    assertKnownParameters(name: string, args: Record<string, unknown> | undefined): void {
      // Built once per catalogue, not per call: this runs on the hot path of
      // every tool invocation, and `declaredParameters()` rebuilds the whole map.
      declaredByName ??= new Map(
        ordered.map((tool) => [tool.name, declaredPropertyNames(tool)])
      );
      const declared = declaredByName.get(name);
      if (!declared) {
        return; // not ours — dispatch answers an unknown name with MethodNotFound
      }
      assertNoUnknownParameters(name, args, declared);
    },
    assertSafePathParameters(name: string, args: Record<string, unknown> | undefined): void {
      if (!ownNames.has(name) || !args) {
        return;
      }
      for (const [key, value] of Object.entries(args)) {
        // Only the arguments that can reach a URL path. bConnect interpolates
        // resource ids and nothing else, so widening this to every string
        // would reject legitimate filter values containing a slash.
        if (!/(^id$|id$)/i.test(key) || value === undefined || value === null) {
          continue;
        }
        assertSafePathSegment(value, key);
      }
    },
  };
}

/**
 * Verb prefixes that mark a bConnect tool as a write.
 *
 * The suite's own convention, taken from the hand-maintained `WRITE_TOOLS` sets.
 * Offered as a *check*, not as the gate: `defineToolCatalogue` never infers, so
 * a tool named `patch_local_admin_user_credentials` cannot start or stop being
 * gated because someone renamed it. Use `writeVerbCandidates()` in a test to
 * assert the declared set and the naming convention agree.
 */
export const WRITE_TOOL_VERB_PREFIXES: readonly string[] = Object.freeze([
  "create_",
  "update_",
  "delete_",
  "patch_",
  "add_",
  "replace_",
  "assign_",
  "link_",
  "unlink_",
  "start_",
  "stop_",
  "resume_",
  "trigger_",
  // Added when `trigger_update_on_client` was renamed to
  // `refresh_local_admin_account_expiry`. The old name matched `trigger_` and
  // the new one matched nothing, so a declared write tool stopped looking like
  // one — and this list is exactly the cross-check that is supposed to notice.
  // It noticed, which is why it is a check and not a comment.
  "refresh_",
  "withdraw_",
]);

/** Tool names whose verb prefix says "write". */
export function writeVerbCandidates(names: Iterable<string>): string[] {
  return [...names].filter((name) =>
    WRITE_TOOL_VERB_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}
