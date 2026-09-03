/**
 * explain_job_failure — instance-walk bound and honesty tests (audit finding M2).
 *
 * ── The two defects these exist to catch, which point in opposite directions ──
 *
 * 1. **No ceiling at all.** The walk was
 *
 *        for (let p = 1; p < totalPages; p++) { ... }
 *
 *    straight off the envelope. This was the one composite in the suite with no
 *    bound anywhere. A large estate — or a server reporting an implausible
 *    `totalPages` — issues that many serial requests with nothing to stop it.
 *    Every other paged composite in the repo learned this lesson; this one never
 *    did.
 *
 * 2. **`meta.pagesFetched` reported intent, not fact.** It was assigned
 *    `totalPages` — the number of pages the walk *meant* to read. A caller
 *    reading `pagesFetched` was reading a number that had never been observed.
 *    `stale-endpoints.ts` documents this exact defect as fixed in that module;
 *    here it was still shipping.
 *
 * Both matter because every figure in `totals` is a count over the walk, and
 * the error direction is always "fewer failures than there are" — the same
 * direction as "nothing needs patching".
 *
 * Also covered: `MAX_CONFIG_LOOKUPS` capped v1.1 configuration reads at 5 and
 * `meta.configLookups` reported how many were *done*, never how many were
 * *eligible*, so a 40-job failure spread returned config for 5 with nothing
 * saying 35 were skipped.
 *
 * ── What each test breaks ───────────────────────────────────────────────────
 * Every assertion below was confirmed to fail against the pre-fix module; see
 * the report for the mutations used and the observed pre-fix output.
 *
 * All names and ids are synthesised. This is heading for public release.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import type { JobsModule } from '../modules/jobs.js';
import { explainJobFailure } from '../modules/explain-job-failure.js';

/** The module's own bound, restated so the stub can straddle it deliberately. */
const MAX_INSTANCE_PAGES = 25;
const MAX_CONFIG_LOOKUPS = 5;

/** See diagnose-job-endpoint-walk.test.ts — page fullness is not the subject. */
const ROWS_PER_PAGE = 2;

const FRESH = new Date().toISOString();
const jobId = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// v1.1 is not the subject here; it is stubbed present so the config-lookup
// bound is reachable.
vi.mock('../modules/v11.js', () => ({
  v11Configured: () => true,
  fetchV11Job: async () => ({
    job: { Destructive: false, JobExecutionTimeout: 0, Steps: [{ Type: 'ManagedSoftware' }], WindowsProperties: {} },
    reason: null,
  }),
}));

interface Scenario {
  /** Pages the instance listing claims to have. */
  totalPages: number;
  /** `totalItems` the envelope reports on page 0. */
  totalItems?: number;
  /** Distinct job definitions to spread the failures across. */
  distinctJobs?: number;
}

interface Recorded {
  params: Array<Record<string, unknown>>;
}

function stubs(scenario: Scenario): { jobs: JobsModule; client: AxiosInstance; recorded: Recorded } {
  const recorded: Recorded = { params: [] };
  const distinctJobs = scenario.distinctJobs ?? 1;

  const jobs = {
    async getJobInstances(params: Record<string, unknown>) {
      recorded.params.push(params);
      const page = Number(params.Page ?? 0);
      const data = [];
      for (let i = 0; i < ROWS_PER_PAGE; i++) {
        const index = page * ROWS_PER_PAGE + i;
        data.push({
          id: `instance-${index}`,
          jobDefinitionId: jobId(index % distinctJobs),
          jobDefinitionName: `Job ${index % distinctJobs}`,
          endpointName: `ENDPOINT-${index}`,
          start: FRESH,
          lastAction: FRESH,
          state: 'FinishedWithError',
          stateDescription: 'Finished with error: Could not connect to client',
          successfulExecutions: 0,
          erroneousExecutions: 1,
          steps: [{ type: 'Install', state: 'FinishedWithError', stateDescription: 'Could not connect to client' }],
        });
      }
      return {
        totalPages: scenario.totalPages,
        totalItems: scenario.totalItems ?? scenario.totalPages * ROWS_PER_PAGE,
        data,
      };
    },
  } as unknown as JobsModule;

  const client = {} as unknown as AxiosInstance;
  return { jobs, client, recorded };
}

describe('explain_job_failure — the instance walk is bounded, ordered and honestly reported (M2)', () => {
  it('stops at MAX_INSTANCE_PAGES instead of following totalPages without a ceiling', async () => {
    const { jobs, client, recorded } = stubs({ totalPages: 400 });
    await explainJobFailure(jobs, client, {});

    // A6, corrected by the 2026-08-03 audit. The absence of a ceiling is real:
    // HEAD was `for (let p = 1; p < totalPages; p++)` with nothing stopping it.
    // But 400 is this STUB's number, not an estate observation, and the note
    // that used to sit here read as though we had watched 400 requests leave.
    // Live, `/jobs/v2.0/JobInstances` holds 229 items; at the module's
    // PAGE_SIZE = 1000 that is totalPages = 1, so the old code issued ONE
    // request, and 400 is unreachable on this estate at any PageSize (the
    // maximum is 229, at PageSize=1). MAX_CONFIG_LOOKUPS = 5 was already in
    // HEAD, so the real worst case was <=6 requests.
    //
    // The bound is still right — it is what keeps this bounded on an estate
    // larger than the one we measured — but it is defence against growth, not
    // a repair of observed pain. 400 here is a constructed scenario chosen to
    // exceed the ceiling; that is what makes it a good test and what makes it
    // bad evidence.
    expect(recorded.params).toHaveLength(MAX_INSTANCE_PAGES);
    expect(recorded.params.map((p) => p.Page)).toEqual(
      Array.from({ length: MAX_INSTANCE_PAGES }, (_, i) => i)
    );
  });

  it('sends an explicit OrderBy so the bounded window is the recent one, not an arbitrary one', async () => {
    const { jobs, client, recorded } = stubs({ totalPages: 3 });
    await explainJobFailure(jobs, client, {});

    // Measured live 2026-08-03 on /jobs/v2.0/JobInstances: the default order is
    // not chronological in either direction, `Start desc` is honoured, and an
    // unknown property answers HTTP 400.
    expect(recorded.params.length).toBeGreaterThan(0);
    for (const p of recorded.params) {
      expect(p.OrderBy).toBe('Start desc');
    }
  });

  it('reports pagesFetched as a counted fact, not as the totalPages it intended to read', async () => {
    const { jobs, client } = stubs({ totalPages: 400 });
    const out = await explainJobFailure(jobs, client, {});
    const meta = out.meta as Record<string, unknown>;

    // A7, corrected by the 2026-08-03 audit. HEAD really did publish
    // `pagesFetched: totalPages` — but because HEAD's walk had no early exit,
    // it fetched exactly `totalPages` pages, so that number WAS observed. The
    // old note called it "a number never observed", which describes the
    // BOUNDED walk, not the unbounded one it was blaming.
    //
    // So the ordering is the opposite of how it was written: adding the
    // ceiling (A6) is what turned `pagesFetched: totalPages` into a claim
    // about pages nobody read. The reporting had to change BECAUSE the walk
    // gained a bound. The fix stands; the reason recorded for it did not.
    // Both numbers are now published side by side, which is what makes the
    // truncation visible rather than implied.
    expect(meta.pagesFetched).toBe(MAX_INSTANCE_PAGES);
    expect(meta.totalPages).toBe(400);
    expect(meta.truncated).toBe(true);
    expect(meta.pagesFetched).not.toBe(meta.totalPages);
  });

  it('reports instancesInEstate from the envelope, not from the length of a bounded walk', async () => {
    const { jobs, client } = stubs({ totalPages: 400, totalItems: 800 });
    const out = await explainJobFailure(jobs, client, {});
    const totals = out.totals as Record<string, unknown>;

    // The server's own figure survives a bounded walk; the array length does not.
    expect(totals.instancesInEstate).toBe(800);
    expect(totals.instancesRead).toBe(MAX_INSTANCE_PAGES * ROWS_PER_PAGE);
    expect(totals.instanceWalkTruncated).toBe(true);
  });

  it('sets resultTrustworthy false with reasons and changes the headline on a truncated walk', async () => {
    const { jobs, client } = stubs({ totalPages: 400, totalItems: 800 });
    const out = await explainJobFailure(jobs, client, {});
    const meta = out.meta as Record<string, unknown>;

    expect(meta.resultTrustworthy).toBe(false);
    expect(meta.resultTrustworthyReasons).toEqual(
      expect.arrayContaining([expect.stringContaining('MAX_INSTANCE_PAGES')])
    );
    // The flag alone would not fix it — the first line is what a caller reads.
    expect((out.headline as string[])[0]).toContain('INCOMPLETE READ');
    expect((out.headline as string[])[0]).toContain('50 of 800');
  });

  it('never opens with a clean "no failed instances" line over a partial read', async () => {
    // A truncated walk whose read portion happens to contain no failures.
    const jobs = {
      async getJobInstances(params: Record<string, unknown>) {
        return {
          totalPages: 400,
          totalItems: 800,
          data: [
            {
              id: `ok-${String(params.Page)}`,
              jobDefinitionId: jobId(0),
              jobDefinitionName: 'Job 0',
              endpointName: 'ENDPOINT-OK',
              start: FRESH,
              lastAction: FRESH,
              state: 'FinishedSuccessfully',
              successfulExecutions: 1,
              erroneousExecutions: 0,
              steps: [],
            },
          ],
        };
      },
    } as unknown as JobsModule;

    const out = await explainJobFailure(jobs, {} as unknown as AxiosInstance, {});
    const headline = out.headline as string[];

    expect(headline[0]).toContain('INCOMPLETE READ');
    expect(headline.join(' ')).toContain('not a statement about the estate');
    // The bare, reassuring sentence must not be the first thing a caller reads.
    expect(headline[0]).not.toMatch(/^No failed instances among/);
  });

  it('reports how many job definitions were ELIGIBLE for config lookup, not only how many were done', async () => {
    // 40 distinct job definitions behind failures; only 5 get looked up.
    const { jobs, client } = stubs({ totalPages: 20, distinctJobs: 40 });
    const out = await explainJobFailure(jobs, client, {});
    const meta = out.meta as Record<string, unknown>;

    expect(meta.configLookups).toBe(MAX_CONFIG_LOOKUPS);
    // Pre-fix there was no such field at all — 35 skipped jobs went unmentioned.
    expect(meta.configEligible).toBe(40);
    expect(meta.resultTrustworthyReasons).toEqual(
      expect.arrayContaining([expect.stringContaining('MAX_CONFIG_LOOKUPS')])
    );
  });

  it('leaves resultTrustworthy true and the headline clean on a complete walk', async () => {
    const { jobs, client, recorded } = stubs({ totalPages: 2, totalItems: 4 });
    const out = await explainJobFailure(jobs, client, {});
    const meta = out.meta as Record<string, unknown>;

    expect(recorded.params).toHaveLength(2);
    expect(meta.pagesFetched).toBe(2);
    expect(meta.truncated).toBe(false);
    expect(meta.resultTrustworthy).toBe(true);
    expect(meta.resultTrustworthyReasons).toEqual([]);
    expect((out.headline as string[])[0]).not.toContain('INCOMPLETE READ');
  });
});
