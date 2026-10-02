/**
 * The one description of the paging arguments every list tool offers (#169).
 *
 * bConnect pages start at 0 and PageSize is capped at 1000 (stated in the
 * spec's prose only). Every tool uses these definitions instead of writing its
 * own text, so no tool can tell the model that pages start at 1.
 */

export interface PagingProperty {
  type: "integer";
  description: string;
}

export const PAGE_PROPERTY: PagingProperty = {
  type: "integer",
  description: "Zero-based page number; 0 is the first page (default 0).",
};

/** PageSize with the default the tool sends when the caller gives none. */
export function pageSizeProperty(defaultSize = 20): PagingProperty {
  return { type: "integer", description: `Items per page, 1 to 1000 (default ${defaultSize}, max 1000).` };
}

export const PAGE_SIZE_PROPERTY: PagingProperty = pageSizeProperty();
