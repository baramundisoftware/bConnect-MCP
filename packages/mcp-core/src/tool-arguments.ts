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
