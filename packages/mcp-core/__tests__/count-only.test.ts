/**
 * The countOnly idiom (TOK-8 / TOK-25).
 *
 * The mechanism is the one the prior evaluation record measured against the
 * live estate: a page past the end of the result set returns the envelope with
 * no rows — `PageSize=1&Page=100000` gave `totalItems` in 122 bytes, a 99.96%
 * saving against the 15-18 KB default page. This pins the request the helper
 * issues, because getting the probe wrong (page 0, PageSize 1) still
 * materialises a 700 B - 3.1 KB row and quietly loses most of the saving.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  COUNT_PROBE_PAGE,
  COUNT_PROBE_PAGE_SIZE,
  isCountOnlyRequest,
  countOnlyParams,
  countedFilters,
  countResultFromEnvelope,
  fetchCount,
} from '@bconnect/mcp-core';

/** What bConnect answers for a page past the end. */
const EMPTY_PAGE_PAST_THE_END = {
  page: COUNT_PROBE_PAGE,
  pageSize: 1,
  totalItems: 37571,
  totalPages: 37571,
  data: [],
};

describe('isCountOnlyRequest', () => {
  it('is true only for the boolean', () => {
    expect(isCountOnlyRequest({ countOnly: true })).toBe(true);
    expect(isCountOnlyRequest({ countOnly: 'true' })).toBe(false);
    expect(isCountOnlyRequest({})).toBe(false);
    expect(isCountOnlyRequest(undefined)).toBe(false);
  });
});

describe('the probe request', () => {
  it('asks for a page past the end, not page 0', () => {
    const params = countOnlyParams({ countOnly: true });

    expect(params.Page).toBe(COUNT_PROBE_PAGE);
    expect(params.PageSize).toBe(COUNT_PROBE_PAGE_SIZE);
    expect(COUNT_PROBE_PAGE).toBeGreaterThan(37571); // clears the largest resource measured
  });

  it('keeps the caller’s filters — the count has to be a count of what they asked', () => {
    const params = countOnlyParams({ Severity: 'Critical', DisplayName: 'WORKSTATION1', countOnly: true });

    expect(params.Severity).toBe('Critical');
    expect(params.DisplayName).toBe('WORKSTATION1');
  });

  it('overrides the caller’s paging and drops the shaping flags', () => {
    const params = countOnlyParams({ Page: 3, PageSize: 20, OrderBy: 'Name asc', detail: true, fields: ['id'], countOnly: true });

    expect(params.Page).toBe(COUNT_PROBE_PAGE);
    expect(params.PageSize).toBe(COUNT_PROBE_PAGE_SIZE);
    expect(params.OrderBy).toBeUndefined();
    expect(params.detail).toBeUndefined();
    expect(params.fields).toBeUndefined();
    expect(params.countOnly).toBeUndefined();
  });
});

describe('the result', () => {
  it('reports the count and the filters it counted', () => {
    expect(countResultFromEnvelope(EMPTY_PAGE_PAST_THE_END, { Severity: 'Critical', countOnly: true })).toEqual({
      totalItems: 37571,
      filters: { Severity: 'Critical' },
    });
  });

  it('omits `filters` when nothing was filtered', () => {
    expect(countResultFromEnvelope(EMPTY_PAGE_PAST_THE_END, { countOnly: true })).toEqual({
      totalItems: 37571,
    });
  });

  it('does not forward the probe’s totalPages, which is the item count again', () => {
    const result = countResultFromEnvelope(EMPTY_PAGE_PAST_THE_END, {});
    expect(result).not.toHaveProperty('totalPages');
  });

  it('stays close to the 122 bytes the idiom was measured at', () => {
    const bytes = JSON.stringify(countResultFromEnvelope(EMPTY_PAGE_PAST_THE_END, { Severity: 'Critical' })).length;

    expect(bytes).toBeLessThan(122);
    // Against the ~15,700 B default page measured on list_job_instances.
    expect(1 - bytes / 15700).toBeGreaterThan(0.99);
  });

  it('says so, rather than guessing, when a route returns no count', () => {
    const result = countResultFromEnvelope({ data: [] }, { Severity: 'Critical' });

    expect(result.totalItems).toBeNull();
    expect(result.note).toMatch(/did not return totalItems/);
    expect(result.filters).toEqual({ Severity: 'Critical' });
  });

  it('treats a non-numeric totalItems as absent', () => {
    expect(countResultFromEnvelope({ totalItems: 'many' }, {}).totalItems).toBeNull();
    expect(countResultFromEnvelope(undefined, {}).totalItems).toBeNull();
  });
});

describe('fetchCount', () => {
  it('issues exactly one request, with the probe parameters', async () => {
    const fetchPage = vi.fn().mockResolvedValue(EMPTY_PAGE_PAST_THE_END);

    const result = await fetchCount(fetchPage, { Severity: 'Critical', countOnly: true });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith({
      Severity: 'Critical',
      Page: COUNT_PROBE_PAGE,
      PageSize: COUNT_PROBE_PAGE_SIZE,
    });
    expect(result).toEqual({ totalItems: 37571, filters: { Severity: 'Critical' } });
  });
});

describe('countedFilters', () => {
  it('drops paging, ordering, shaping and undefined values', () => {
    expect(
      countedFilters({ Page: 2, PageSize: 50, OrderBy: 'Name asc', countOnly: true, detail: false, fields: [], DisplayName: 'A', HostName: undefined })
    ).toEqual({ DisplayName: 'A' });
  });
});
