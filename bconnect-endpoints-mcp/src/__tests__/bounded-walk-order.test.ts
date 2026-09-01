/**
 * The two composites walk the estate under a page cap, and both print prose
 * about what the cap left out. This file pins the thing that makes that prose
 * true.
 *
 * A capped walk of an UNORDERED collection returns an arbitrary subset that
 * differs between runs. Two consequences, and the second is the worse one:
 *
 *   - `get_fleet_summary` and `get_stale_endpoints` return different totals and
 *     a different ghost list ten minutes apart with nothing changed in the
 *     estate, and the operator concludes the tool is unreliable.
 *   - The disclosure actively misleads. "Only the first N endpoints were
 *     examined" invites the reader to page for the rest; over an unordered walk
 *     there is no first and no tail to page for.
 *
 * `DisplayName` (endpoints) and `LastAction` (job instances) are both among the
 * values their route documents for `OrderBy`, so this is not a guess that could
 * answer HTTP 400 on an unknown property.
 *
 * Every assertion here checks EVERY page, not page 0 — a walk that orders its
 * first request and then forgets has precisely the defect being guarded.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';

import { getFleetSummary } from '../modules/fleet-summary.js';
import { getStaleEndpoints } from '../modules/stale-endpoints.js';
import type { EndpointsModule } from '../modules/endpoints.js';

type Params = Record<string, unknown>;

/** An EndpointsModule stand-in that records the params of every page request. */
function recordingEndpoints(totalPages: number): {
  module: EndpointsModule;
  requests: Params[];
} {
  const requests: Params[] = [];
  const module = {
    getEndpoints: async (params: Params) => {
      requests.push(params ?? {});
      const page = Number(params?.Page ?? 0);
      return {
        totalPages,
        currentPage: page,
        data: [
          {
            id: `00000000-0000-4000-8000-00000000000${page}`,
            type: 'WindowsEndpoint',
            displayName: `HOST-${page}`,
            lastSeen: new Date().toISOString(),
            clientAgentVersion: '26.1.0',
          },
        ],
      };
    },
  } as unknown as EndpointsModule;
  return { module, requests };
}

function recordingJobsClient(totalPages: number): { client: AxiosInstance; requests: Params[] } {
  const requests: Params[] = [];
  const client = {
    get: async (_url: string, config?: { params?: Params }) => {
      requests.push(config?.params ?? {});
      return { data: { totalPages, data: [] } };
    },
  } as unknown as AxiosInstance;
  return { client, requests };
}

describe('get_fleet_summary — ordered estate walk', () => {
  it('sends DisplayName asc on every page', async () => {
    const { module, requests } = recordingEndpoints(3);
    await getFleetSummary(module);

    expect(requests).toHaveLength(3);
    for (const params of requests) {
      expect(params.OrderBy).toBe('DisplayName asc');
    }
  });

  it('reports the order it used, and names it in the truncation note', async () => {
    const { module } = recordingEndpoints(50);
    const summary = (await getFleetSummary(module)) as {
      meta: { estate: { orderBy: string; truncated: boolean }; note: string };
    };

    expect(summary.meta.estate.truncated).toBe(true);
    expect(summary.meta.estate.orderBy).toBe('DisplayName asc');
    // "the first N" is only an honest phrase once there is an order that makes
    // "first" mean something — so the note has to carry the order with it.
    expect(summary.meta.note).toContain('INCOMPLETE');
    expect(summary.meta.note).toContain('DisplayName asc');
  });
});

describe('get_stale_endpoints — both walks ordered', () => {
  it('sends DisplayName asc on every endpoint page and LastAction desc on every job page', async () => {
    const { module, requests: endpointRequests } = recordingEndpoints(3);
    const { client, requests: jobRequests } = recordingJobsClient(2);

    await getStaleEndpoints(module, client);

    expect(endpointRequests).toHaveLength(3);
    for (const params of endpointRequests) {
      expect(params.OrderBy).toBe('DisplayName asc');
    }
    expect(jobRequests).toHaveLength(2);
    for (const params of jobRequests) {
      expect(params.OrderBy).toBe('LastAction desc');
    }
  });

  it('names the endpoint order in the estate note and the job order in meta', async () => {
    const { module } = recordingEndpoints(50);
    const { client } = recordingJobsClient(1);

    const result = (await getStaleEndpoints(module, client)) as {
      meta: { jobOrderBy: string; estate: { orderBy: string }; estateNote?: string };
    };

    expect(result.meta.estate.orderBy).toBe('DisplayName asc');
    expect(result.meta.jobOrderBy).toBe('LastAction desc');
    expect(result.meta.estateNote).toContain('INCOMPLETE');
    expect(result.meta.estateNote).toContain('DisplayName asc');
  });

  it('describes a capped job history as the recent window rather than an arbitrary one', async () => {
    const { module } = recordingEndpoints(1);
    const { client } = recordingJobsClient(50);

    const result = (await getStaleEndpoints(module, client)) as { meta: { note: string } };

    expect(result.meta.note).toContain('INCOMPLETE');
    expect(result.meta.note).toContain('most recent');
    expect(result.meta.note).toContain('LastAction desc');
  });
});
