/**
 * Shared input-schema fragments (finding TOK-10 / TOK-29)
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * The hand-written tool schemas copied their parameter descriptions verbatim out
 * of the OpenAPI specs. Two phrases dominate:
 *
 *   "The zero-indexed number of the first page that begins the set of pages
 *    that are returned in the response."                           (105 chars)
 *   "Filters result by matching the exact value against DisplayName."(~55 chars)
 *
 * Measured occurrences: the exact-match sentence appears 24× in
 * bconnect-endpoints-mcp/src/index.ts alone, 6× in groups, 2× in jobs, 2× in
 * activedirectory; the page sentence 5× in endpoints and 1× in servermanagement.
 * ~25 tokens each, paid on every session by every client, for wording that
 * teaches a model nothing the short form does not.
 *
 * ── The 1-based / 0-indexed contradiction, decided ──────────────────────────
 * The same evaluation found the suite contradicting itself: the Android and iOS
 * list tools declare "Page number (1-based)" (bconnect-endpoints-mcp/src/index.ts
 * :454 and :480) while every other tool declares zero-indexed. One of them
 * causes an off-by-one page request.
 *
 *   **Canonical: `Page` is ZERO-INDEXED. Page 0 is the first page.**
 *
 * That is the bConnect v2.0 convention — it is what the generated operation
 * types declare, what `paginate.ts` walks (`fetchPage(0)` first), and what
 * eleven of the thirteen servers already say. The two 1-based descriptions are
 * the outliers and are wrong. Import `paginationProperties` and the question is
 * settled per tool rather than per author.
 *
 * ── Fragments are objects, spread into `properties` ─────────────────────────
 * `bconnect-groups-mcp` already demonstrated the pattern locally (its
 * index.ts:53-92 builds 33 tools from shared spreads). This module lifts it out
 * of that one server so the other twelve stop re-typing it.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 * ```ts
 * import {
 *   paginationProperties, exactMatchFilters, guidProperty,
 *   detailProperty, countOnlyProperty, objectSchema,
 * } from "@bconnect/mcp-core";
 *
 * {
 *   name: "list_windows_endpoints",
 *   description: "List Windows endpoints. Compact projection by default.",
 *   inputSchema: objectSchema({
 *     ...paginationProperties,
 *     ...exactMatchFilters("DisplayName", "HostName", "Domain"),
 *     ...detailProperty,
 *     ...countOnlyProperty,
 *   }),
 * }
 * ```
 */

/** A JSON-Schema property as the tool schemas write them. */
export interface SchemaProperty {
  type: string;
  description?: string;
  enum?: readonly string[];
  items?: { type: string };
  default?: unknown;
  [key: string]: unknown;
}

/** A `properties` map: what every fragment below is, and spreads into. */
export type SchemaProperties = Record<string, SchemaProperty>;

// ── Pagination ───────────────────────────────────────────────────────────────

/**
 * The canonical `Page` wording. Zero-based — see the header.
 *
 * 33 chars against the 105-char OpenAPI sentence it replaces. "0-based" rather
 * than "zero-indexed" saves 4 B on ~62 advertised uses and says the same thing;
 * `(default 0)` states the first page outright, so the reading does not depend
 * on knowing the phrase. The word "1-based" must never appear here — that
 * contradiction is the off-by-one the header settles.
 */
export const PAGE_DESCRIPTION = "Page number, 0-based (default 0).";

/** The canonical `PageSize` wording. bConnect caps `PageSize` at 1000.
 *
 *  Left alone at 35 B: the cap and the default are both load-bearing and there
 *  is nothing here to cut that a model would not then have to guess. */
export const PAGE_SIZE_DESCRIPTION = "Rows per page, 1-1000 (default 20).";

/**
 * The canonical `SearchQuery` wording.
 *
 * Kept short deliberately. Where a route documents *which* properties it
 * searches, that is genuine information rather than boilerplate — use
 * `searchQueryOver(...)` instead of this, and pay the bytes on purpose.
 */
export const SEARCH_QUERY_DESCRIPTION = "Filter by name or description.";

/**
 * The canonical `OrderBy` wording. 22 B, down from 28.
 *
 * The suite carried seven wordings of this parameter across 51 uses, from
 * `"Sort field"` (10 B) to a 117-B sentence enumerating the sortable columns.
 * The example is the part that teaches — a model that sees `'Name asc'` infers
 * both halves of the syntax — so the example stays and the narration goes.
 */
export const ORDER_BY_DESCRIPTION = "Sort, e.g. 'Name asc'.";

/**
 * The verbose originals, exported for one reason: so a test can assert the
 * saving is real and did not quietly regress. Do not put these in a schema.
 */
export const VERBOSE_PAGE_DESCRIPTION =
  "The zero-indexed number of the first page that begins the set of pages that are returned in the response.";

/** As above — the phrase the exact-match filters were copied from. */
export function verboseExactMatchDescription(field: string): string {
  return `Filters result by matching the exact value against ${field}.`;
}

/** `Page` alone, for routes that declare no search or ordering. */
export const pageProperty: SchemaProperties = Object.freeze({
  Page: { type: "number", description: PAGE_DESCRIPTION },
});

/** `PageSize` alone. */
export const pageSizeProperty: SchemaProperties = Object.freeze({
  PageSize: { type: "number", description: PAGE_SIZE_DESCRIPTION },
});

/** `Page` + `PageSize`. The minimum every paged route declares. */
export const pageProperties: SchemaProperties = Object.freeze({
  ...pageProperty,
  ...pageSizeProperty,
});

/** Free-text search, where the route declares it. */
export const searchQueryProperty: SchemaProperties = Object.freeze({
  SearchQuery: { type: "string", description: SEARCH_QUERY_DESCRIPTION },
});

/**
 * Free-text search that names the properties the route actually searches.
 *
 * The legitimate variant: `"Filter results by matching against Name,
 * InventoryNumber, Contact, or CostCenter."` is more useful than the generic
 * form because the route really does search exactly those. Parameterised rather
 * than flattened away — the drift being killed is fourteen *arbitrary* spellings
 * of the same thing, not the cases where the difference is real.
 */
export function searchQueryOver(...fields: string[]): SchemaProperties {
  return {
    SearchQuery: {
      type: "string",
      description: `Free-text search over ${fields.join(", ")}.`,
    },
  };
}

/** Sort order, where the route declares it. */
export const orderByProperty: SchemaProperties = Object.freeze({
  OrderBy: { type: "string", description: ORDER_BY_DESCRIPTION },
});

/**
 * Sort order that names the sortable columns, for routes that constrain them.
 *
 * `"Sort, e.g. 'OwnerId asc'. Fields: AssetId, OwnerId, OwnerType."` in place of
 * the 117-B vendor sentence: same three facts, the example first.
 */
export function orderByOver(...fields: string[]): SchemaProperties {
  const example = fields[0] ?? "Name";
  return {
    OrderBy: {
      type: "string",
      description: `Sort, e.g. '${example} asc'. Fields: ${fields.join(", ")}.`,
    },
  };
}

/**
 * A date filter with bConnect's `lt`/`gt` prefix convention.
 *
 * The vendor sentence is 166 B and appears on 7 tools. Three facts survive: the
 * format, the two prefixes, and one example that shows the space after the
 * prefix — which is the part a model gets wrong.
 */
export function dateFilterProperty(field: string): SchemaProperties {
  return {
    [field]: {
      type: "string",
      description:
        `Filter on ${field}, ISO 8601, optional 'lt '/'gt ' prefix ` +
        `(e.g. gt 2023-07-28T08:01:03Z).`,
    },
  };
}

/**
 * The full paged-list parameter set: `Page`, `PageSize`, `SearchQuery`,
 * `OrderBy`.
 *
 * Advertise only what the route declares — bConnect answers HTTP 200 and
 * silently ignores a parameter it does not know (finding D6), so a tool that
 * offers `OrderBy` on a route without it returns an unsorted list that looks
 * sorted. `pageProperties` is the safe subset.
 */
export const paginationProperties: SchemaProperties = Object.freeze({
  ...pageProperties,
  ...searchQueryProperty,
  ...orderByProperty,
});

// ── Filters and ids ──────────────────────────────────────────────────────────

/** One exact-match filter: `{ DisplayName: { type: "string", ... } }`. */
export function exactMatchFilter(field: string): SchemaProperties {
  return { [field]: { type: "string", description: `Exact-match filter on ${field}.` } };
}

/** Several exact-match filters, merged in the order given. */
export function exactMatchFilters(...fields: string[]): SchemaProperties {
  return Object.assign({}, ...fields.map(exactMatchFilter)) as SchemaProperties;
}

/**
 * A GUID path/id parameter.
 *
 * @param name  parameter name, e.g. `logicalGroupId`
 * @param what  what it identifies, e.g. `logical group`
 */
export function guidProperty(name: string, what: string): SchemaProperties {
  return { [name]: { type: "string", description: `GUID of the ${what}.` } };
}

/** A boolean flag. */
export function booleanProperty(name: string, description: string): SchemaProperties {
  return { [name]: { type: "boolean", description } };
}

/** An enum parameter — the collapse-the-matrix primitive (TOK-3/TOK-22). */
export function enumProperty(
  name: string,
  values: readonly string[],
  description: string
): SchemaProperties {
  return { [name]: { type: "string", enum: [...values], description } };
}

/**
 * The sub-group traversal flag.
 *
 * 131 B → 88 B. The causal clause is the load-bearing half and it stays: without
 * this flag a parent logical group commonly reports zero members, which reads as
 * an empty group rather than a missing parameter (finding D14a). What went is
 * the restatement of the flag's own name — "Also return objects held in
 * sub-groups of the given group" says no more than "Include sub-groups". Do not
 * cut it further; the second sentence is the finding.
 */
export const includeSubfoldersProperty: SchemaProperties = Object.freeze({
  includeSubfolders: {
    type: "boolean",
    description:
      "Include sub-groups (default false). " +
      "Without it a parent group often reports zero members.",
  },
});

// ── Response-shaping parameters ──────────────────────────────────────────────
//
// These three are the caller-facing half of `shape-response.ts` and
// `count-only.ts`. They live here so all thirteen servers spell them the same
// way — a `detail` in one server and a `full` in another is exactly the drift
// this package exists to stop.

/**
 * Opt out of the compact projection and get the raw API record.
 *
 * 77 B → 67 B. "API" dropped: there is no other kind of record on offer, and
 * the contrast with "compact projection" carries the meaning by itself.
 */
export const detailProperty: SchemaProperties = Object.freeze({
  detail: {
    type: "boolean",
    description: "Return the full record, not the compact projection (default false).",
  },
});

/**
 * Pick specific fields. Ignored when `detail` is true.
 *
 * 59 B → 52 B. One sentence instead of two; "overrides the projection" keeps
 * the precedence rule, which is the only thing a caller can get wrong.
 */
export const fieldsProperty: SchemaProperties = Object.freeze({
  fields: {
    type: "array",
    items: { type: "string" },
    description: "Return only these fields (overrides the projection).",
  },
});

/**
 * Ask for the match count instead of the rows. See `count-only.ts`.
 *
 * 64 B → 53 B, on 89 advertised uses — the single largest repeated string in the
 * catalogue and therefore the largest prose saving available.
 */
export const countOnlyProperty: SchemaProperties = Object.freeze({
  countOnly: {
    type: "boolean",
    description: "Return the match count, not the rows (default false).",
  },
});

/** `detail` + `fields` + `countOnly`: the whole shaping vocabulary. */
export const projectionProperties: SchemaProperties = Object.freeze({
  ...detailProperty,
  ...fieldsProperty,
  ...countOnlyProperty,
});

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Wrap a `properties` map in the object schema MCP expects.
 *
 * Saves nothing in bytes; it exists so `type: "object"` cannot be forgotten or
 * misspelt, and so `required` is always an array of names that exist.
 *
 * @throws {Error} if `required` names a property that was not declared — a
 *                 required parameter no schema advertises is unsatisfiable.
 */
export function objectSchema(
  properties: SchemaProperties,
  required: readonly string[] = []
): { type: "object"; properties: SchemaProperties; required?: string[] } {
  const missing = required.filter((name) => !(name in properties));
  if (missing.length > 0) {
    throw new Error(
      `objectSchema: required parameter(s) not declared: ${missing.join(", ")}.`
    );
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required: [...required] } : {}),
  };
}
