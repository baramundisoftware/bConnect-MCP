/**
 * Shared schema fragments (TOK-10 / TOK-29).
 *
 * Two things are pinned here. The measurable one: the boilerplate the servers
 * copied out of the OpenAPI specs is shorter now, and stays shorter. The
 * correctness one: `Page` has exactly one meaning across the suite — zero-
 * indexed — because two servers used to declare "1-based" and one of the two
 * conventions necessarily produced an off-by-one page request.
 */

import { describe, it, expect } from 'vitest';
import {
  PAGE_DESCRIPTION,
  PAGE_SIZE_DESCRIPTION,
  SEARCH_QUERY_DESCRIPTION,
  ORDER_BY_DESCRIPTION,
  VERBOSE_PAGE_DESCRIPTION,
  verboseExactMatchDescription,
  pageProperties,
  paginationProperties,
  exactMatchFilter,
  exactMatchFilters,
  searchQueryOver,
  orderByOver,
  dateFilterProperty,
  guidProperty,
  booleanProperty,
  enumProperty,
  includeSubfoldersProperty,
  detailProperty,
  fieldsProperty,
  countOnlyProperty,
  projectionProperties,
  objectSchema,
} from '@bconnect/mcp-core';

describe('Page is zero-based, everywhere, once', () => {
  // MIGRATED (boilerplate compression): this used to assert the literal phrase
  // "zero-indexed". The wording is now "Page number, 0-based (default 0)." —
  // 4 B shorter on 62 advertised uses, same claim. What is actually load-
  // bearing is that the suite states ONE convention and that it is the
  // zero-based one, so the assertion now accepts either spelling of it and
  // still forbids the "1-based" outlier that caused the off-by-one.
  it('states the zero-based convention and never 1-based', () => {
    expect(PAGE_DESCRIPTION).toMatch(/0-based|zero-indexed/i);
    expect(PAGE_DESCRIPTION).not.toMatch(/1-based/i);
    expect(JSON.stringify(paginationProperties)).not.toMatch(/1-based/i);
  });

  it('agrees with what paginateAll actually walks — the first page is 0', () => {
    expect(PAGE_DESCRIPTION).toMatch(/default 0/);
  });

  it('declares the 1-1000 PageSize cap the API enforces', () => {
    expect(PAGE_SIZE_DESCRIPTION).toMatch(/1-1000/);
  });
});

describe('the measured saving', () => {
  it('replaces the 105-char OpenAPI page sentence with a shorter one', () => {
    expect(VERBOSE_PAGE_DESCRIPTION.length).toBe(105);
    expect(PAGE_DESCRIPTION.length).toBeLessThan(45);
    // 6 occurrences suite-wide (5 endpoints + 1 servermanagement).
    expect((VERBOSE_PAGE_DESCRIPTION.length - PAGE_DESCRIPTION.length) * 6).toBeGreaterThan(390);
  });

  it('replaces the exact-match filter sentence with a shorter one', () => {
    const verbose = verboseExactMatchDescription('DisplayName');
    const short = exactMatchFilter('DisplayName').DisplayName.description ?? '';

    expect(short.length).toBeLessThan(verbose.length);
    // 34 occurrences counted across endpoints (24), groups (6), jobs (2), AD (2).
    expect((verbose.length - short.length) * 34).toBeGreaterThan(800);
  });
});

/**
 * The compression pass, pinned string by string.
 *
 * Every number below was measured against the BUILT catalogue over
 * InMemoryTransport, both write postures: the `uses` column is how many times
 * the old string appeared in `tools/list`, and the per-string savings sum to
 * 1,870 B in each posture (124,865 → 122,995 default; 170,994 → 169,124
 * writes-on). Predicted and measured agreed exactly, which is what proves no
 * hand-written copy of any of these six strings survives anywhere in the suite.
 *
 * These are upper bounds, not targets: a later edit that lengthens one of these
 * strings should fail here and be argued for, because each byte is paid on
 * every session by every client.
 */
describe('boilerplate compression: each string is capped at what was measured', () => {
  const CAPS: ReadonlyArray<readonly [string, string, number, number, number]> = [
    // label,              text,                                              old, cap, uses
    ['countOnly', countOnlyProperty.countOnly.description ?? '', 64, 53, 89],
    ['detail', detailProperty.detail.description ?? '', 77, 67, 22],
    ['fields', fieldsProperty.fields.description ?? '', 59, 52, 15],
    ['Page', PAGE_DESCRIPTION, 37, 33, 62],
    ['OrderBy', ORDER_BY_DESCRIPTION, 28, 22, 11],
    ['includeSubfolders', includeSubfoldersProperty.includeSubfolders.description ?? '', 131, 89, 6],
  ];

  it.each(CAPS)('%s is at most %s bytes', (_label, text, _old, cap) => {
    expect(text.length).toBeLessThanOrEqual(cap);
  });

  it('sums to the 1,870 B measured against the built catalogue', () => {
    // Computed from the live strings, not from the `cap` column, so this fails
    // if any one of them grows back — which is the regression worth catching.
    const total = CAPS.reduce((sum, [, text, old, , uses]) => sum + (old - text.length) * uses, 0);
    expect(total).toBe(1870);
  });

  it('leaves PageSize and SearchQuery alone — already minimal', () => {
    // Cutting either would delete a fact (the 1000 cap; what is searched) and
    // return 0 B, because both are already the shortest true statement.
    expect(PAGE_SIZE_DESCRIPTION.length).toBe(35);
    expect(SEARCH_QUERY_DESCRIPTION.length).toBe(30);
  });
});

describe('meaning survives the compression', () => {
  it('countOnly still says it returns a count instead of rows, and defaults off', () => {
    const text = countOnlyProperty.countOnly.description ?? '';
    expect(text).toMatch(/count/i);
    expect(text).toMatch(/not the rows/i);
    expect(text).toMatch(/default false/);
  });

  it('detail still contrasts the full record with the compact projection', () => {
    const text = detailProperty.detail.description ?? '';
    expect(text).toMatch(/full record/i);
    expect(text).toMatch(/compact projection/i);
    expect(text).toMatch(/default false/);
  });

  it('fields still states that it overrides the projection', () => {
    // Without the precedence rule a caller cannot predict `fields` + `detail`.
    expect(fieldsProperty.fields.description ?? '').toMatch(/overrides the projection/i);
  });

  it('OrderBy keeps the example, which is the half that teaches the syntax', () => {
    expect(ORDER_BY_DESCRIPTION).toMatch(/'Name asc'/);
  });

  it('includeSubfolders keeps the D14a causal clause', () => {
    // D14a: without this parameter a parent group reports zero members, which
    // reads as an empty group rather than a missing argument. The second
    // sentence IS the finding — shortening past it would be a regression, not
    // a saving.
    const text = includeSubfoldersProperty.includeSubfolders.description ?? '';
    expect(text).toMatch(/zero members/);
    expect(text).toMatch(/parent group/);
    expect(text).toMatch(/default false/);
  });
});

describe('parameterised fragments, for the variation that is real', () => {
  it('names the searched properties when the route constrains them', () => {
    expect(searchQueryOver('Name', 'InventoryNumber', 'Contact')).toEqual({
      SearchQuery: {
        type: 'string',
        description: 'Free-text search over Name, InventoryNumber, Contact.',
      },
    });
  });

  it('names the sortable columns and leads with the example', () => {
    const text = orderByOver('AssetId', 'OwnerId', 'OwnerType').OrderBy.description ?? '';
    expect(text).toBe("Sort, e.g. 'AssetId asc'. Fields: AssetId, OwnerId, OwnerType.");
    // The 117-B vendor sentence it replaces.
    expect(text.length).toBeLessThan(117);
  });

  it('keeps the lt/gt prefix and the space after it, which is what gets fumbled', () => {
    const text = dateFilterProperty('LastAction').LastAction.description ?? '';
    expect(text).toMatch(/ISO 8601/);
    expect(text).toMatch(/'lt '/);
    expect(text).toMatch(/'gt '/);
    expect(text).toMatch(/e\.g\. gt 2023-07-28/);
    // The vendor sentence is 166 B on 7 tools.
    expect(text.length).toBeLessThan(100);
  });
});

describe('fragments', () => {
  it('pageProperties is Page + PageSize only', () => {
    expect(Object.keys(pageProperties)).toEqual(['Page', 'PageSize']);
  });

  it('paginationProperties adds SearchQuery and OrderBy', () => {
    expect(Object.keys(paginationProperties)).toEqual(['Page', 'PageSize', 'SearchQuery', 'OrderBy']);
  });

  it('is frozen, so one server cannot mutate another server’s schema', () => {
    // Every server spreads these into its own `properties`; a shared mutable
    // object would let a stray assignment travel across the suite.
    expect(Object.isFrozen(paginationProperties)).toBe(true);
    expect(Object.isFrozen(detailProperty)).toBe(true);
  });

  it('builds exact-match filters, merged in order', () => {
    expect(exactMatchFilters('DisplayName', 'HostName')).toEqual({
      DisplayName: { type: 'string', description: 'Exact-match filter on DisplayName.' },
      HostName: { type: 'string', description: 'Exact-match filter on HostName.' },
    });
  });

  it('builds guid, boolean and enum properties', () => {
    expect(guidProperty('logicalGroupId', 'logical group')).toEqual({
      logicalGroupId: { type: 'string', description: 'GUID of the logical group.' },
    });
    expect(booleanProperty('force', 'Skip the confirmation.')).toEqual({
      force: { type: 'boolean', description: 'Skip the confirmation.' },
    });
    expect(enumProperty('groupKind', ['logical', 'static'], 'Kind of group.')).toEqual({
      groupKind: { type: 'string', enum: ['logical', 'static'], description: 'Kind of group.' },
    });
  });

  it('keeps the includeSubfolders warning, which is not boilerplate', () => {
    // D14a: without this parameter a parent group reports zero members, which
    // reads as an empty group rather than a missing argument. Worth its bytes.
    expect(includeSubfoldersProperty.includeSubfolders.description).toMatch(/zero members/);
  });

  it('spells the shaping vocabulary the same way for every server', () => {
    expect(Object.keys(projectionProperties)).toEqual(['detail', 'fields', 'countOnly']);
    expect(projectionProperties.detail).toEqual(detailProperty.detail);
    expect(projectionProperties.fields).toEqual(fieldsProperty.fields);
    expect(projectionProperties.countOnly).toEqual(countOnlyProperty.countOnly);
  });
});

describe('objectSchema', () => {
  it('wraps properties in the MCP object schema', () => {
    expect(objectSchema({ ...guidProperty('id', 'endpoint') }, ['id'])).toEqual({
      type: 'object',
      properties: { id: { type: 'string', description: 'GUID of the endpoint.' } },
      required: ['id'],
    });
  });

  it('omits `required` when there is none', () => {
    const schema = objectSchema({ ...pageProperties });
    expect(schema.required).toBeUndefined();
    expect(schema.type).toBe('object');
  });

  it('refuses a required parameter that is not declared', () => {
    expect(() => objectSchema({ ...pageProperties }, ['endpointId'])).toThrow(
      /required parameter\(s\) not declared: endpointId/
    );
  });
});
