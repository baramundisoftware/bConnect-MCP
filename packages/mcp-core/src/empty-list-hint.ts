/**
 * An empty, unfiltered list says that missing rights can be the cause (#402).
 *
 * bMS doesn't refuse a list the account has no rights on: it answers 200 with
 * the objects filtered by the account's rights, so a restricted account gets an
 * empty list and no error. A model would answer "there are none". When a list
 * tool returns no entries and the caller gave no filter, the result gets a
 * second text content with EMPTY_LIST_HINT; the JSON in the first stays as it
 * is, so clients that parse it are unaffected.
 *
 * No hint when the caller filtered (any argument other than paging, sorting and
 * `countOnly`, path ids included), asked for a page after the first, the tool
 * failed, or the result carries its own `note` (e.g. "no findings for this
 * endpoint"). Empty means `totalItems: 0`, an empty `data` array without
 * `totalItems`, or an empty JSON array.
 */
import type { ToolCallRequest } from "./count-only.js";
import type { ToolJsonResult } from "./tool-results.js";

export const EMPTY_LIST_HINT =
  "No entries. bMS also returns an empty list when the account has no rights on these objects: " +
  "if objects are expected, check the account's security profile (see docs/TROUBLESHOOTING.md).";

/** Arguments that page or sort, and client-side options; every other argument is a filter. */
const NOT_FILTERS = new Set(["Page", "PageSize", "pageSize", "OrderBy", "countOnly"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The JSON text of the tool's answer when it is one text content. */
function jsonTextOf(result: unknown): string | undefined {
  if (!isRecord(result) || result.isError === true || !Array.isArray(result.content) || result.content.length !== 1) {
    return undefined;
  }
  const first: unknown = result.content[0];
  return isRecord(first) && first.type === "text" && typeof first.text === "string" ? first.text : undefined;
}

/** Whether the JSON text is an empty list without a note of its own. */
function isEmptyList(text: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (!isRecord(value) || value.note !== undefined) {
    return false;
  }
  if (value.totalItems !== undefined) {
    return value.totalItems === 0;
  }
  return Array.isArray(value.data) && value.data.length === 0;
}

/** Whether the call lists everything the account can see: no filter, first page. */
function isUnfiltered(args: Record<string, unknown> | undefined): boolean {
  if (!args) {
    return true;
  }
  if (args.Page !== undefined && args.Page !== 0) {
    return false;
  }
  return Object.keys(args).every((arg) => NOT_FILTERS.has(arg));
}

/** Wraps a CallTool handler: an empty, unfiltered `list_*` result gets EMPTY_LIST_HINT. */
export function withEmptyListHint<Rest extends unknown[], Result>(
  handler: (request: ToolCallRequest, ...rest: Rest) => Promise<Result>,
): (request: ToolCallRequest, ...rest: Rest) => Promise<Result | ToolJsonResult> {
  return async (request, ...rest) => {
    const result = await handler(request, ...rest);
    const { name, arguments: args } = request.params;
    const text = name.startsWith("list_") && isUnfiltered(args) ? jsonTextOf(result) : undefined;
    if (text === undefined || !isEmptyList(text)) {
      return result;
    }
    return { content: [{ type: "text", text }, { type: "text", text: EMPTY_LIST_HINT }] };
  };
}
