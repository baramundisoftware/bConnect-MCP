/**
 * get_fleet_summary / get_stale_endpoints — an empty page under an intact
 * header is an incident, not an estate.
 *
 * The input shape was MEASURED live (2026-08-12): the bConnect API can answer
 * HTTP 200 with `data: []` while the envelope header keeps its real
 * `totalItems`, and can claim totals its stream never serves. Both walks here
 * discarded `totalItems` at their `.data ?? []` casts, so that state rendered
 * a full zero-endpoint estate digest ("Aggregated from the 0-endpoint
 * projection") and the prose all-clear "No ghosts found among 0 endpoints" —
 * with no machine-readable trust marker on either tool, and
 * `meta.estate.truncated: false` because `paginateAll`'s only completeness
 * signal is totalPages vs the page cap.
 *
 * The fix follows the suite's shared contract (result-trust.ts): capture
 * page-0 totalItems, compose `assessResultTrust` with `shortfallReason`, and
 * change the prose too — a flag beside an unchanged all-clear just moves the
 * lie one field to the left. Controls pin the other direction: a genuinely
 * empty estate (totalItems 0) and a fully-served walk stay trustworthy.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';

import { getFleetSummary } from '../modules/fleet-summary.js';
import { getStaleEndpoints } from '../modules/stale-endpoints.js';
import type { EndpointsModule } from '../modules/endpoints.js';

interface Envelope {
  data: Array<Record<string, unknown>>;
  totalPages: number;
  totalItems?: number;
}

const endpointsStub = (envelope: Envelope): EndpointsModule =>
  ({ async getEndpoints() { return envelope; } }) as unknown as EndpointsModule;

const jobsClientStub = (envelope: Envelope): AxiosInstance =>
  ({ async get() { return { data: envelope }; } }) as unknown as AxiosInstance;

const recent = (): string => new Date(Date.now() - 86_400_000).toISOString();

describe('get_fleet_summary — shortfall', () => {
  it('0 rows served while the server reports 26 → trust breaks and the digest says INCOMPLETE', async () => {
    const summary = (await getFleetSummary(endpointsStub({ data: [], totalPages: 1, totalItems: 26 }))) as {
      totals: { endpoints: number; endpointsExamined: number };
      meta: {
        resultTrustworthy: boolean;
        resultTrustworthyReasons: string[];
        estate: { totalItems: number | null };
        note: string;
      };
    };

    expect(summary.meta.resultTrustworthy).toBe(false);
    const reasons = summary.meta.resultTrustworthyReasons.join(' ');
    expect(reasons).toMatch(/26/);
    expect(reasons).toMatch(/not read/);
    // The estate-shaped name carries the server's own count, with what was
    // actually read beside it — a bounded walk must not publish its own length
    // as a total (the H4 rule).
    expect(summary.totals.endpoints).toBe(26);
    expect(summary.totals.endpointsExamined).toBe(0);
    expect(summary.meta.note).toMatch(/INCOMPLETE/);
  });

  it('control: a genuinely empty estate (totalItems 0) is clean and trustworthy', async () => {
    const summary = (await getFleetSummary(endpointsStub({ data: [], totalPages: 1, totalItems: 0 }))) as {
      totals: { endpoints: number };
      meta: { resultTrustworthy: boolean; resultTrustworthyReasons: string[]; note: string };
    };

    expect(summary.meta.resultTrustworthy).toBe(true);
    expect(summary.meta.resultTrustworthyReasons).toEqual([]);
    expect(summary.totals.endpoints).toBe(0);
    expect(summary.meta.note).not.toMatch(/INCOMPLETE/);
  });

  it('control: a fully-served walk stays trustworthy', async () => {
    const rows = [
      { id: 'a', displayName: 'EP-1', lastSeen: recent() },
      { id: 'b', displayName: 'EP-2', lastSeen: recent() },
    ];
    const summary = (await getFleetSummary(endpointsStub({ data: rows, totalPages: 1, totalItems: 2 }))) as {
      totals: { endpoints: number; endpointsExamined: number };
      meta: { resultTrustworthy: boolean };
    };

    expect(summary.totals.endpoints).toBe(2);
    expect(summary.totals.endpointsExamined).toBe(2);
    expect(summary.meta.resultTrustworthy).toBe(true);
  });

  it('a walk that hit its PAGE CAP is one condition, not two, and prescribes no retry', async () => {
    // 50 declared pages against the 20-page cap, totalItems present: absorbing
    // fewer rows than totalItems is EXPECTED, so the shortfall guard stands
    // down in favour of the truncation reason (adversarial review, M1).
    const summary = (await getFleetSummary(
      endpointsStub({
        data: [{ id: 'a', displayName: 'EP-1', lastSeen: recent() }],
        totalPages: 50,
        totalItems: 50_000,
      }),
    )) as {
      totals: { endpoints: number; endpointsExamined: number };
      meta: { resultTrustworthy: boolean; resultTrustworthyReasons: string[]; note: string };
    };

    expect(summary.totals.endpoints).toBe(50_000);
    expect(summary.totals.endpointsExamined).toBe(20);
    expect(summary.meta.resultTrustworthy).toBe(false);
    expect(summary.meta.resultTrustworthyReasons).toHaveLength(1);
    expect(summary.meta.resultTrustworthyReasons[0]).toMatch(/MAX_ENDPOINT_PAGES/);
    expect(summary.meta.note).not.toMatch(/[Rr]etry/);
  });
});

describe('get_stale_endpoints — shortfall', () => {
  it('0 endpoints served while the server reports 26 → no all-clear, trust breaks', async () => {
    const result = (await getStaleEndpoints(
      endpointsStub({ data: [], totalPages: 1, totalItems: 26 }),
      jobsClientStub({ data: [], totalPages: 1, totalItems: 0 }),
    )) as {
      headline: string[];
      meta: { resultTrustworthy: boolean; resultTrustworthyReasons: string[] };
    };

    // "No ghosts found among 0 endpoints" over 26 unread machines is the
    // all-clear this test exists to kill.
    expect(result.headline.join(' ')).not.toMatch(/No ghosts found among 0 endpoints/);
    expect(result.headline.join(' ')).toMatch(/INCOMPLETE/);
    expect(result.meta.resultTrustworthy).toBe(false);
    expect(result.meta.resultTrustworthyReasons.join(' ')).toMatch(/26/);
  });

  it('an empty job-history page under an intact header must not silently zero the never-succeeded signal', async () => {
    const rows = [
      { id: 'a', displayName: 'EP-1', lastSeen: recent() },
      { id: 'b', displayName: 'EP-2', lastSeen: recent() },
    ];
    const result = (await getStaleEndpoints(
      endpointsStub({ data: rows, totalPages: 1, totalItems: 2 }),
      jobsClientStub({ data: [], totalPages: 1, totalItems: 231 }),
    )) as {
      headline: string[];
      meta: { resultTrustworthy: boolean; resultTrustworthyReasons: string[]; note: string };
    };

    expect(result.meta.resultTrustworthy).toBe(false);
    const reasons = result.meta.resultTrustworthyReasons.join(' ');
    expect(reasons).toMatch(/231/);
    // The PROSE must change too, not just the marker — a false beside an
    // unchanged all-clear moves the lie one field to the left (adversarial
    // review, H1: this exact fixture used to render "No ghosts found among 2
    // endpoints" with the generic joined-by-endpointId note).
    const headline = result.headline.join(' ');
    expect(headline).not.toMatch(/No ghosts found/);
    expect(headline).toMatch(/INCOMPLETE/);
    expect(headline).toMatch(/231/);
    expect(result.meta.note).toMatch(/INCOMPLETE/);
  });

  it('a job-history walk that hit its PAGE CAP is one condition, not two, and prescribes no retry', async () => {
    // 40 declared pages of 2 rows each against the 20-page cap: rows < totalItems
    // is EXPECTED here, and the shortfall guard must stand down in favour of the
    // truncation reason (adversarial review, M1).
    const rows = [
      { id: 'a', displayName: 'EP-1', lastSeen: recent() },
    ];
    let jobPage = 0;
    const jobsClient = {
      async get() {
        jobPage++;
        return { data: { data: [
          { endpointId: 'a', successfulExecutions: 1, erroneousExecutions: 0 },
          { endpointId: 'a', successfulExecutions: 1, erroneousExecutions: 0 },
        ], totalPages: 40, totalItems: 5000 } };
      },
    } as unknown as AxiosInstance;

    const result = (await getStaleEndpoints(
      endpointsStub({ data: rows, totalPages: 1, totalItems: 1 }),
      jobsClient,
    )) as {
      meta: { resultTrustworthy: boolean; resultTrustworthyReasons: string[] };
    };

    expect(jobPage).toBe(20);
    expect(result.meta.resultTrustworthy).toBe(false);
    // Exactly the truncation reason — no doubled shortfall sentence, and no
    // "retry" advice for a client-side bound retrying cannot lift.
    expect(result.meta.resultTrustworthyReasons).toHaveLength(1);
    expect(result.meta.resultTrustworthyReasons[0]).toMatch(/page cap|MAX_JOB_PAGES|pages/);
    expect(result.meta.resultTrustworthyReasons.join(' ')).not.toMatch(/[Rr]etry/);
  });

  it('control: genuinely empty estate and history stay trustworthy, and the ghost cap field says what it is', async () => {
    const result = (await getStaleEndpoints(
      endpointsStub({ data: [], totalPages: 1, totalItems: 0 }),
      jobsClientStub({ data: [], totalPages: 1, totalItems: 0 }),
    )) as Record<string, unknown> & {
      meta: { resultTrustworthy: boolean; resultTrustworthyReasons: string[] };
    };

    expect(result.meta.resultTrustworthy).toBe(true);
    expect(result.meta.resultTrustworthyReasons).toEqual([]);
    // The numeric that counted ghosts dropped by the DISPLAY cap used to be
    // named `truncated` — a coverage word for a formatting fact. Renamed.
    expect(result.ghostsNotListed).toBe(0);
    expect(result.truncated).toBeUndefined();
  });

  it('control: a fully-served walk with a real ghost keeps its verdict and its trust', async () => {
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const result = (await getStaleEndpoints(
      endpointsStub({ data: [{ id: 'g', displayName: 'GHOST-1', lastSeen: old }], totalPages: 1, totalItems: 1 }),
      jobsClientStub({ data: [], totalPages: 1, totalItems: 0 }),
    )) as {
      totals: { ghosts: number };
      meta: { resultTrustworthy: boolean };
    };

    expect(result.totals.ghosts).toBe(1);
    expect(result.meta.resultTrustworthy).toBe(true);
  });
});
