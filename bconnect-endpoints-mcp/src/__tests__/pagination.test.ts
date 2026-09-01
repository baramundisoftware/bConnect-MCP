/**
 * Composite-tool pagination and concurrency tests
 * (upstream findings PER-17 and PER-16).
 *
 * PER-17: get_fleet_summary and get_stale_endpoints each fetched exactly one
 * PageSize-1000 page and presented it as the whole estate — no totalPages
 * check, no truncation flag. On an estate over 1000 endpoints they returned
 * authoritative-looking totals ("endpoints: 1000") computed over an arbitrary
 * first page. Entirely latent on the 26-endpoint labcorp.local estate, which
 * is exactly why it needs a test rather than a live check: the failure mode is
 * a silent wrong answer, and nothing on this estate would ever show it.
 *
 * PER-16: get_stale_endpoints then awaited the /jobs JobInstances history only
 * after the endpoints walk had finished, though the two have no data
 * dependency.
 *
 * These use fakes, not the network. The point is the loop, not the API.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';

import { getFleetSummary } from '../modules/fleet-summary.js';
import { getStaleEndpoints } from '../modules/stale-endpoints.js';
import type { EndpointsModule } from '../modules/endpoints.js';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface FakeEndpointsOptions {
  totalPages: number;
  rowsPerPage?: number;
  onRequest?: (page: number) => void;
  pageDelayMs?: number;
}

/** An EndpointsModule stand-in that serves `totalPages` pages of rows. */
function fakeEndpoints(options: FakeEndpointsOptions): {
  module: EndpointsModule;
  requestedPages: number[];
} {
  const { totalPages, rowsPerPage = 2, onRequest, pageDelayMs = 0 } = options;
  const requestedPages: number[] = [];

  const module = {
    getEndpoints: async (params: { Page?: number }) => {
      const page = params?.Page ?? 0;
      requestedPages.push(page);
      onRequest?.(page);
      if (pageDelayMs > 0) {
        await delay(pageDelayMs);
      }
      return {
        totalPages,
        currentPage: page,
        data: Array.from({ length: rowsPerPage }, (_unused, index) => ({
          id: `endpoint-${page}-${index}`,
          displayName: `HOST-${page}-${index}`,
          // Recent enough that nothing counts as stale by default.
          lastSeen: new Date().toISOString(),
          clientAgentVersion: '26.1.0',
        })),
      };
    },
  } as unknown as EndpointsModule;

  return { module, requestedPages };
}

/** An axios stand-in serving `totalPages` pages of job instances. */
function fakeJobsClient(totalPages: number, onRequest?: (page: number) => void): AxiosInstance {
  return {
    get: async (_url: string, config?: { params?: { Page?: number } }) => {
      const page = config?.params?.Page ?? 0;
      onRequest?.(page);
      return {
        data: {
          totalPages,
          data: [
            {
              endpointId: `endpoint-${page}-0`,
              successfulExecutions: 0,
              erroneousExecutions: 9,
              lastAction: '2026-07-01T00:00:00Z',
            },
          ],
        },
      };
    },
  } as unknown as AxiosInstance;
}

describe('get_fleet_summary walks every page', () => {
  it('counts rows from all pages, not just the first', async () => {
    const { module, requestedPages } = fakeEndpoints({ totalPages: 3, rowsPerPage: 2 });

    const summary = (await getFleetSummary(module)) as {
      totals: { endpoints: number };
      meta: { estate: { pagesFetched: number; totalPages: number; truncated: boolean } };
    };

    expect(requestedPages).toEqual([0, 1, 2]);
    expect(summary.totals.endpoints).toBe(6);
    expect(summary.meta.estate).toMatchObject({ pagesFetched: 3, totalPages: 3, truncated: false });
  });

  it('reports truncation instead of presenting a partial total as complete', async () => {
    const { module, requestedPages } = fakeEndpoints({ totalPages: 50, rowsPerPage: 1 });

    const summary = (await getFleetSummary(module)) as {
      totals: { endpoints: number };
      meta: { estate: { truncated: boolean; pagesFetched: number }; note: string };
    };

    // Bounded at 20 pages — the walk must stop, and must say that it stopped.
    expect(requestedPages).toHaveLength(20);
    expect(summary.meta.estate.truncated).toBe(true);
    expect(summary.meta.estate.pagesFetched).toBe(20);
    expect(summary.meta.note).toContain('INCOMPLETE');
    expect(summary.totals.endpoints).toBe(20);
  });

  it('says nothing about truncation when the estate fits in one page', async () => {
    const { module, requestedPages } = fakeEndpoints({ totalPages: 1, rowsPerPage: 26 });

    const summary = (await getFleetSummary(module)) as {
      totals: { endpoints: number };
      meta: { estate: { truncated: boolean }; note: string };
    };

    expect(requestedPages).toEqual([0]);
    expect(summary.totals.endpoints).toBe(26);
    expect(summary.meta.estate.truncated).toBe(false);
    expect(summary.meta.note).not.toContain('INCOMPLETE');
  });
});

describe('get_stale_endpoints walks every page of both sources', () => {
  it('counts endpoints across pages and joins job history across pages', async () => {
    const { module, requestedPages } = fakeEndpoints({ totalPages: 3, rowsPerPage: 2 });
    const jobPages: number[] = [];
    const client = fakeJobsClient(2, (page) => jobPages.push(page));

    const result = (await getStaleEndpoints(module, client)) as {
      totals: { endpoints: number };
      meta: { jobPagesFetched: number; jobInstancesExamined: number; estate: { truncated: boolean } };
    };

    expect(requestedPages).toEqual([0, 1, 2]);
    expect(jobPages).toEqual([0, 1]);
    expect(result.totals.endpoints).toBe(6);
    // jobPagesFetched used to be assigned totalPages BEFORE the pages were
    // fetched; it now reports pages actually read.
    expect(result.meta.jobPagesFetched).toBe(2);
    expect(result.meta.jobInstancesExamined).toBe(2);
    expect(result.meta.estate.truncated).toBe(false);
  });

  it('flags a truncated estate walk in its own note', async () => {
    const { module } = fakeEndpoints({ totalPages: 50, rowsPerPage: 1 });
    const client = fakeJobsClient(1);

    const result = (await getStaleEndpoints(module, client)) as {
      meta: { estate: { truncated: boolean }; estateNote?: string };
    };

    expect(result.meta.estate.truncated).toBe(true);
    expect(result.meta.estateNote).toContain('INCOMPLETE');
  });

  it('degrades rather than failing when job history cannot be read', async () => {
    const { module } = fakeEndpoints({ totalPages: 1, rowsPerPage: 2 });
    const client = {
      get: async () => {
        throw new Error('403 Forbidden');
      },
    } as unknown as AxiosInstance;

    const result = (await getStaleEndpoints(module, client)) as {
      totals: { endpoints: number };
      meta: { note: string };
    };

    expect(result.totals.endpoints).toBe(2);
    expect(result.meta.note).toContain('Job history unavailable');
    expect(result.meta.note).toContain('403 Forbidden');
  });

  it('distinguishes includeJobHistory=false from a job-history failure', async () => {
    const { module } = fakeEndpoints({ totalPages: 1, rowsPerPage: 2 });
    let jobRequests = 0;
    const client = fakeJobsClient(1, () => {
      jobRequests++;
    });

    const result = (await getStaleEndpoints(module, client, { includeJobHistory: false })) as {
      meta: { note: string };
    };

    expect(jobRequests).toBe(0);
    expect(result.meta.note).toContain('includeJobHistory=false');
  });

  it('starts the job-history fetch without waiting for the endpoints walk', async () => {
    // PER-16. Serially, the first jobs request cannot happen until the last
    // endpoints page has come back.
    const events: string[] = [];
    const { module } = fakeEndpoints({
      totalPages: 2,
      rowsPerPage: 1,
      pageDelayMs: 20,
      onRequest: (page) => events.push(`endpoints-request-${page}`),
    });
    const client = fakeJobsClient(1, () => events.push('jobs-request'));

    await getStaleEndpoints(module, client);

    expect(events).toContain('jobs-request');
    expect(events.indexOf('jobs-request')).toBeLessThan(events.indexOf('endpoints-request-1'));
  });
});
