/**
 * List tools answer "how many?" without loading pages (REQ-SRV-027, #165, ADR-0013).
 *
 * Every paged list tool whose answer carries `totalItems` declares the
 * client-side option `countOnly` (generated into the server's query table).
 * `withCountOnly` wraps a server's CallTool handler: with `countOnly: true` it
 * calls the tool once with Page=0 and a page size of 1 and returns only
 * `totalItems` and the filters that were applied. The tool itself runs
 * unchanged, so its routes, its error answers and its special cases stay as
 * they are. `countOnly` never reaches bConnect: tools send only what
 * `queryParameters` names, and that leaves client-side options out.
 *
 * A tool that checks on an empty page or a 404 whether its parent object
 * exists (jobs kiosk releases, compliance findings per endpoint) still does
 * so, with one more request, and its `note` is kept in the count. A Page or
 * page size the caller gives is replaced; every other argument the caller gave
 * (path ids included) is echoed as `filters`.
 */
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { offersQueryProperty, type QueryParameterTable } from "./tool-arguments.js";
import { toolJsonResult, type ToolJsonResult } from "./tool-results.js";

/** The part of a CallTool request the wrapper reads and rewrites. */
export interface ToolCallRequest {
  params: { name: string; arguments?: Record<string, unknown> };
}

export interface CountOnlyOptions {
  /** Per tool, the argument that sets its page size where it isn't `PageSize` (e.g. a tool taking "pageSize"). */
  pageSizeArgument?: Readonly<Record<string, string>>;
}

const UNAVAILABLE = "Count unavailable: bConnect's answer has no numeric totalItems.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The page a tool returned as JSON text (written by `toolJson`, compact or indented), if it is an object. */
function pageOf(result: unknown): Record<string, unknown> | undefined {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return undefined;
  }
  const first: unknown = result.content[0];
  if (!isRecord(first) || typeof first.text !== "string") {
    return undefined;
  }
  try {
    const page: unknown = JSON.parse(first.text);
    return isRecord(page) ? page : undefined;
  } catch {
    return undefined;
  }
}

/** The page's `totalItems` when it is a count; never derived from the rows or `totalPages`. */
function totalItemsOf(page: Record<string, unknown> | undefined): number | undefined {
  const total = page?.totalItems;
  return typeof total === "number" && Number.isSafeInteger(total) && total >= 0 ? total : undefined;
}

/**
 * Wraps a server's CallTool handler with the `countOnly` option. A tool that
 * doesn't offer it in the selected release gets the request unchanged (the
 * declared-arguments check then refuses `countOnly`). The release is read on
 * every call, like the tool list reads it.
 */
export function withCountOnly<Rest extends unknown[], Result>(
  table: QueryParameterTable,
  release: () => string | undefined,
  handler: (request: ToolCallRequest, ...rest: Rest) => Promise<Result>,
  options: CountOnlyOptions = {},
): (request: ToolCallRequest, ...rest: Rest) => Promise<Result | ToolJsonResult> {
  return async (request, ...rest) => {
    const { name, arguments: args } = request.params;
    if (!args || !Object.hasOwn(args, "countOnly") || !offersQueryProperty(table, release(), name, "countOnly")) {
      return handler(request, ...rest);
    }
    const { countOnly, ...callArgs } = args;
    if (typeof countOnly !== "boolean") {
      throw new McpError(ErrorCode.InvalidParams, `countOnly for ${name} must be true or false`);
    }
    if (!countOnly) {
      return handler({ ...request, params: { ...request.params, arguments: callArgs } }, ...rest);
    }
    const pageSize = options.pageSizeArgument?.[name] ?? "PageSize";
    const result = await handler({ ...request, params: { ...request.params, arguments: { ...callArgs, Page: 0, [pageSize]: 1 } } }, ...rest);
    if (isRecord(result) && result.isError === true) {
      return result;
    }
    const notFilters = new Set(["Page", "PageSize", pageSize, "OrderBy"]);
    const filters = Object.fromEntries(Object.entries(callArgs).filter(([arg]) => !notFilters.has(arg)));
    const page = pageOf(result);
    const totalItems = totalItemsOf(page);
    return toolJsonResult({
      ...(totalItems === undefined ? { countUnavailable: UNAVAILABLE } : { totalItems }),
      ...(typeof page?.note === "string" && { note: page.note }),
      ...(Object.keys(filters).length > 0 && { filters }),
    });
  };
}
