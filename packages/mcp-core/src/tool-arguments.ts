/**
 * Typed access to tool arguments that are passed to bConnect as a whole: an
 * object, or a JSON Patch document. The value is checked at runtime, so a tool
 * gets a real type instead of casting an argument it hasn't looked at, and a
 * malformed argument is refused before any request.
 */
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/**
 * One RFC 6902 operation. The generated spec types declare `value` as
 * `Record<string, never> | null`, which no real value fits, so tools use this.
 */
export interface JsonPatchOperation {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
  from?: string;
}

const PATCH_OPS: Record<JsonPatchOperation["op"], true> = { add: true, remove: true, replace: true, move: true, copy: true, test: true };
const isPatchOp = (op: unknown): op is JsonPatchOperation["op"] => typeof op === "string" && Object.hasOwn(PATCH_OPS, op);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The argument as a plain object, or an InvalidParams error naming it. */
export function objectArgument(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new McpError(ErrorCode.InvalidParams, `${name} must be an object`);
  }
  return value;
}

/** The argument as a JSON Patch document (a non-empty list of operations), or an InvalidParams error. */
export function jsonPatchArgument(value: unknown, name: string): JsonPatchOperation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, `${name} must be a non-empty JSON Patch list, e.g. [{"op":"replace","path":"/name","value":"New name"}]`);
  }
  return value.map((entry, i) => {
    if (!isRecord(entry) || !isPatchOp(entry.op) || typeof entry.path !== "string") {
      throw new McpError(ErrorCode.InvalidParams, `${name}[${i}] must have "op" (${Object.keys(PATCH_OPS).join(", ")}) and a string "path"`);
    }
    return {
      op: entry.op,
      path: entry.path,
      ...("value" in entry && { value: entry.value }),
      ...(typeof entry.from === "string" && { from: entry.from }),
    };
  });
}

/**
 * A JSON Patch replacing each field the caller gave. `paths` maps argument
 * names to the patch path bConnect expects for that route (its spelling can
 * differ per route, e.g. `/DisplayName` vs `/displayName`). Fields left out are
 * not touched; an empty result means the call changes nothing.
 */
export function patchFromArguments(args: Record<string, unknown>, paths: Record<string, string>): JsonPatchOperation[] {
  return Object.entries(paths)
    .filter(([name]) => args[name] !== undefined)
    .map(([name, path]) => ({ op: "replace", path, value: args[name] }));
}

/**
 * A request body with only the named arguments the caller gave, so nothing a
 * tool doesn't declare reaches bConnect. `rename` maps an argument name to the
 * field name the API uses, where they differ.
 */
export function pickArguments(args: Record<string, unknown>, names: readonly string[], rename: Record<string, string> = {}): Record<string, unknown> {
  return Object.fromEntries(names.filter((name) => args[name] !== undefined).map((name) => [rename[name] ?? name, args[name]]));
}

interface DeclaredTool {
  name: string;
  inputSchema: Record<string, unknown>;
}

const isDeclaredTool = (tool: object): tool is DeclaredTool =>
  "name" in tool && typeof tool.name === "string" && "inputSchema" in tool && isRecord(tool.inputSchema);

const declaredNames = (tool: DeclaredTool): string[] =>
  isRecord(tool.inputSchema.properties) ? Object.keys(tool.inputSchema.properties) : [];

/** The message for a call with arguments the tool doesn't declare. */
function undeclaredMessage(tool: string, unknown: string[], accepted: string[]): string {
  const head = `Unknown argument${unknown.length > 1 ? "s" : ""} for ${tool}: ${unknown.join(", ")}.`;
  return `${head} ${accepted.length > 0 ? `This tool accepts: ${accepted.join(", ")}.` : "This tool takes no arguments."}`;
}

export interface DeclaredArgumentsOnly<Result> {
  /** The tool list, each input schema with `additionalProperties: false`. */
  list: () => Promise<Result>;
  /** Throws InvalidParams when `args` holds an argument the tool's schema doesn't declare. */
  refuseUndeclared: (name: string, args: Record<string, unknown> | undefined) => Promise<void>;
}

/**
 * Tools accept only the arguments they declare (REQ-SRV-022, #163).
 *
 * Wraps a server's list-tools function. `list` advertises closed input
 * schemas; `refuseUndeclared` checks a call against the same list, so no tool
 * needs its own list of names. An unknown tool name is left to the server.
 */
export function declaredArgumentsOnly<Result extends { tools: object[] }>(
  listTools: () => Result | Promise<Result>,
): DeclaredArgumentsOnly<Result> {
  return {
    list: async () => {
      const result = await listTools();
      return {
        ...result,
        tools: result.tools.map((tool) => isDeclaredTool(tool)
          ? { ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: false } }
          : tool),
      };
    },
    refuseUndeclared: async (name, args) => {
      const tool = (await listTools()).tools.filter(isDeclaredTool).find((t) => t.name === name);
      if (!tool || !args) {
        return;
      }
      const accepted = declaredNames(tool);
      const unknown = Object.keys(args).filter((arg) => !accepted.includes(arg));
      if (unknown.length > 0) {
        throw new McpError(ErrorCode.InvalidParams, undeclaredMessage(name, unknown, accepted));
      }
    },
  };
}

/** Per bMS release, per tool: the query parameters the tool offers and sends, as schema properties (#179). */
export type QueryParameterTable = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, object>>>>>>;

/** 25R2 only when set so; unset or anything else is 26R1, as the servers treat it. */
const releaseKey = (release: string | undefined): "25R2" | "26R1" => (release === "25R2" ? "25R2" : "26R1");

/**
 * The table entry for the selected release. A tool whose route only the other release has (its
 * tool is listed on both) keeps that release's parameters, as before the tables. An error when no
 * release lists the tool (the table wasn't regenerated).
 */
function queryEntry(table: QueryParameterTable, release: string | undefined, tool: string): Readonly<Record<string, object>> {
  const key = releaseKey(release);
  const entry = table[key]?.[tool] ?? table[key === "25R2" ? "26R1" : "25R2"]?.[tool];
  if (!entry) {
    throw new Error(`No query parameters for ${tool}; run node scripts/generate-query-parameters.mjs`);
  }
  return entry;
}

/** The query parameters `tool` offers in `release`, as input-schema properties. */
export function queryProperties(table: QueryParameterTable, release: string | undefined, tool: string): Record<string, object> {
  return { ...queryEntry(table, release, tool) };
}

/** The names of the query parameters `tool` sends in `release`, for `pickArguments`. */
export function queryParameters(table: QueryParameterTable, release: string | undefined, tool: string): string[] {
  return Object.keys(queryEntry(table, release, tool));
}

const isSchemaTool = (tool: object): tool is { name: string; inputSchema: Record<string, unknown> } =>
  "name" in tool && typeof tool.name === "string" && "inputSchema" in tool && isRecord(tool.inputSchema);

/**
 * Builds each listed tool's query parameters from the table (#179): the tool's
 * own properties (its path arguments) stay, every query parameter comes from
 * the table for the selected release (or the other release's, when only that
 * one has the tool's route), and one only the other release declares is
 * removed. A tool without a table entry is listed unchanged.
 */
export function withQueryProperties<Result extends { tools: object[] }>(
  table: QueryParameterTable,
  release: () => string | undefined,
  handler: () => Result | Promise<Result>,
): () => Promise<Result> {
  return async () => {
    const result = await handler();
    const selected = release();
    return {
      ...result,
      tools: result.tools.map((tool) => {
        if (!isSchemaTool(tool) || !Object.values(table).some((byTool) => byTool[tool.name])) {
          return tool;
        }
        const queryNames = new Set(Object.values(table).flatMap((byTool) => Object.keys(byTool[tool.name] ?? {})));
        const own = isRecord(tool.inputSchema.properties) ? tool.inputSchema.properties : {};
        const pathArguments = Object.fromEntries(Object.entries(own).filter(([name]) => !queryNames.has(name)));
        const offered = queryEntry(table, selected, tool.name);
        return { ...tool, inputSchema: { ...tool.inputSchema, properties: { ...pathArguments, ...offered } } };
      }),
    };
  };
}
