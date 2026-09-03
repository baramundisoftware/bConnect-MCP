/**
 * diagnose_job — endpoint-walk completeness tests (audit finding M1).
 *
 * ── The defect these exist to catch ─────────────────────────────────────────
 * `diagnose-job.ts` read the endpoint listing with a single
 * `client.get("/endpoints/v2.0/Endpoints", { params: { PageSize: 1000 } })` —
 * no `Page`, no loop, no order — and then classified every failing endpoint it
 * could not find in that one page as stale:
 *
 *     if (!ep?.lastSeen) { return true; }   // unknown/never-seen counts as stale
 *
 * Past 1,000 endpoints those two lines compound into a manufactured verdict.
 * Every endpoint on page 2+ is absent from the index, so it counts as stale,
 * so `staleCount` inflates, so `selfPerpetuating` flips true, so `verdict` is
 * overwritten with "UNRELIABLE — SELF-PERPETUATING" and a confident prose
 * explanation is pushed into `reasons[]`. Nothing in `staleEndpointRisk` or
 * `meta` recorded that the endpoint list was one page.
 *
 * This is the failure direction that matters least on the reference estate (26
 * endpoints, one page) and most on an ordinary one. It is also the direction
 * that erodes trust fastest: a diagnostic that invents a severe verdict out of
 * its own page bound cannot be believed when it reports a real one.
 *
 * ── What each test breaks ───────────────────────────────────────────────────
 * Every assertion below was confirmed to fail against the pre-fix module. See
 * the report for the exact mutations and their observed output — in particular
 * that the pre-fix code produced `selfPerpetuating: true` and the
 * SELF-PERPETUATING verdict on an estate where *no endpoint is stale at all*,
 * which is the whole finding.
 *
 * All names and ids are synthesised. This is heading for public release.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import type { JobsModule } from '../modules/jobs.js';
import { diagnoseJob } from '../modules/diagnose-job.js';

/** The module's own bound, restated so the stub can straddle it deliberately. */
const MAX_ENDPOINT_PAGES = 25;

/**
 * Rows per stubbed page — deliberately not the module's `PageSize: 1000`.
 * The subject is page arithmetic and name resolution, neither of which depends
 * on how full a page is, and a 1,000-row stub would materialise 25,000 objects
 * per case for no extra signal. A server returning fewer rows than the
 * requested PageSize is also perfectly legal.
 */
const ROWS_PER_PAGE = 2;

const endpointName = (n: number): string => `ENDPOINT-${String(n).padStart(5, '0')}`;

const JOB_ID = '22222222-2222-2222-2222-222222222222';

/** A recent check-in, so a resolved endpoint is never stale by accident. */
const FRESH = new Date().toISOString();

interface Scenario {
  /** Pages the endpoints listing claims to have. */
  endpointPages: number;
  /**
   * Endpoint index behind the job's failures. Whether it lands inside the
   * bounded walk is the entire experiment.
   */
  failingIndex: number;
  /** `lastSeen` for the failing endpoint, when it is resolvable. */
  failingLastSeen?: string | null;
}

interface Recorded {
  endpointParams: Array<Record<string, unknown>>;
}

function stubs(scenario: Scenario): {
  jobs: JobsModule;
  client: AxiosInstance;
  recorded: Recorded;
} {
  const recorded: Recorded = { endpointParams: [] };
  const failingName = endpointName(scenario.failingIndex);

  const jobs = {
    async getJobDefinition() {
      return { name: 'Weekly patch', folder: 'Patching', type: 'WindowsJob' };
    },
    async getJobInstancesByJobDefinition() {
      // One failed instance, attributed to the failing endpoint.
      return {
        totalPages: 1,
        totalItems: 1,
        data: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            jobDefinitionId: JOB_ID,
            jobDefinitionName: 'Weekly patch',
            endpointName: failingName,
            start: FRESH,
            lastAction: FRESH,
            state: 'FinishedWithError',
            stateDescription: 'Finished with error: Could not connect to client',
            successfulExecutions: 0,
            erroneousExecutions: 1,
            steps: [{ type: 'Install', state: 'FinishedWithError', stateDescription: 'Could not connect to client' }],
          },
        ],
      };
    },
  } as unknown as JobsModule;

  const client = {
    async get(_url: string, config?: { params?: Record<string, unknown> }) {
      const params = config?.params ?? {};
      recorded.endpointParams.push(params);
      const page = Number(params.Page ?? 0);

      const data: Array<Record<string, unknown>> = [];
      for (let i = 0; i < ROWS_PER_PAGE; i++) {
        const index = page * ROWS_PER_PAGE + i;
        data.push({
          displayName: endpointName(index),
          lastSeen: index === scenario.failingIndex
            ? (scenario.failingLastSeen === undefined ? FRESH : scenario.failingLastSeen)
            : FRESH,
        });
      }
      return {
        data: {
          totalPages: scenario.endpointPages,
          totalItems: scenario.endpointPages * ROWS_PER_PAGE,
          data,
        },
      };
    },
  } as unknown as AxiosInstance;

  return { jobs, client, recorded };
}

/**
 * The v1.1 configuration the self-perpetuation signal requires. Without
 * `RepeatedExecution.IsActive` and `ErrorBehavior: "PlanNew"` the module never
 * reaches the endpoint walk at all, so every test here needs it.
 */
vi.mock('../modules/v11.js', () => ({
  v11Configured: () => true,
  fetchV11Job: async () => ({
    job: {
      Destructive: false,
      JobExecutionTimeout: 0,
      Steps: [{ Type: 'ManagedSoftware' }],
      WindowsProperties: {
        RepeatedExecution: {
          IsActive: true,
          ErrorBehavior: 'PlanNew',
          RepetitionEntries: [{ Minutes: 1440 }],
        },
      },
    },
    reason: null,
  }),
}));

describe('diagnose_job — the endpoint walk is bounded, ordered and disclosed (M1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pages the endpoint listing instead of reading page 0 only', async () => {
    const { jobs, client, recorded } = stubs({ endpointPages: 4, failingIndex: 7 });
    await diagnoseJob(jobs, client, { jobDefinitionId: JOB_ID });

    // Pre-fix this was a single request with no `Page` at all.
    expect(recorded.endpointParams).toHaveLength(4);
    expect(recorded.endpointParams.map((p) => p.Page)).toEqual([0, 1, 2, 3]);
  });

  it('sends an explicit OrderBy so a bounded walk is a nameable slice, not an arbitrary one', async () => {
    const { jobs, client, recorded } = stubs({ endpointPages: 2, failingIndex: 1 });
    await diagnoseJob(jobs, client, { jobDefinitionId: JOB_ID });

    // Measured live 2026-08-03: the server's default order is not sorted by
    // anything, and an unknown property answers HTTP 400 — so this value is
    // checked by the server rather than merely declared by the spec.
    expect(recorded.endpointParams.length).toBeGreaterThan(0);
    for (const p of recorded.endpointParams) {
      expect(p.OrderBy).toBe('DisplayName asc');
    }
  });

  it('stops at MAX_ENDPOINT_PAGES rather than following totalPages without a ceiling', async () => {
    const { jobs, client, recorded } = stubs({ endpointPages: 60, failingIndex: 0 });
    const out = await diagnoseJob(jobs, client, { jobDefinitionId: JOB_ID });

    expect(recorded.endpointParams).toHaveLength(MAX_ENDPOINT_PAGES);
    const meta = out.meta as Record<string, unknown>;
    const walk = meta.endpointWalk as Record<string, unknown>;
    expect(walk.pagesFetched).toBe(MAX_ENDPOINT_PAGES);
    expect(walk.totalPages).toBe(60);
    expect(walk.truncated).toBe(true);
  });

  /**
   * The finding itself. The failing endpoint sits on page 30 of 60, well past
   * the bound, and is perfectly healthy — it checked in moments ago. Pre-fix,
   * "not in my index" was read as "stale", so this estate produced
   * `staleCount: 1`, `selfPerpetuating: true` and the SELF-PERPETUATING verdict.
   */
  it('does NOT count an endpoint it never read as stale, and does not manufacture the verdict', async () => {
    const { jobs, client } = stubs({ endpointPages: 60, failingIndex: 60 });
    const out = await diagnoseJob(jobs, client, { jobDefinitionId: JOB_ID });

    const risk = (out.reliabilitySignals as Record<string, unknown>).staleEndpointRisk as Record<string, unknown>;
    expect(risk.staleCount).toBe(0);
    expect(risk.staleEndpoints).toEqual([]);
    // Named separately, never folded into staleCount.
    expect(risk.unresolvedCount).toBe(1);
    expect(risk.unresolvedEndpoints).toEqual([endpointName(60)]);

    // Undetermined — not true (the pre-fix answer) and not false either.
    expect((out.reliabilitySignals as Record<string, unknown>).selfPerpetuating).toBeNull();
    expect(out.verdict).not.toContain('SELF-PERPETUATING');
  });

  it('still reports a genuinely never-seen endpoint as stale — absence and never-seen are different', async () => {
    // Resolvable (page 0 of 1) and lastSeen null: a real observation, not a gap.
    const { jobs, client } = stubs({ endpointPages: 1, failingIndex: 0, failingLastSeen: null });
    const out = await diagnoseJob(jobs, client, { jobDefinitionId: JOB_ID });

    const risk = (out.reliabilitySignals as Record<string, unknown>).staleEndpointRisk as Record<string, unknown>;
    expect(risk.staleCount).toBe(1);
    expect(risk.unresolvedCount).toBe(0);
    expect((out.reliabilitySignals as Record<string, unknown>).selfPerpetuating).toBe(true);
    expect(out.verdict).toContain('SELF-PERPETUATING');
  });

  it('on a complete walk, a name absent from the full listing still means renamed-or-deleted', async () => {
    // One page, one page total — the index IS the estate, so the inference holds.
    const { jobs, client } = stubs({ endpointPages: 1, failingIndex: 99 });
    const out = await diagnoseJob(jobs, client, { jobDefinitionId: JOB_ID });

    const risk = (out.reliabilitySignals as Record<string, unknown>).staleEndpointRisk as Record<string, unknown>;
    expect(risk.staleCount).toBe(1);
    expect(risk.unresolvedCount).toBe(0);
    expect((out.reliabilitySignals as Record<string, unknown>).selfPerpetuating).toBe(true);
  });

  it('sets resultTrustworthy false with reasons, and qualifies the verdict, on a truncated walk', async () => {
    const { jobs, client } = stubs({ endpointPages: 60, failingIndex: 60 });
    const out = await diagnoseJob(jobs, client, { jobDefinitionId: JOB_ID });
    const meta = out.meta as Record<string, unknown>;

    expect(meta.resultTrustworthy).toBe(false);
    expect(meta.resultTrustworthyReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('MAX_ENDPOINT_PAGES'),
        expect.stringContaining('UNDETERMINED'),
      ])
    );
    // The flag alone is not the fix — the headline must change too.
    expect(out.verdict).toContain('PARTIAL READ');
    expect((out.reasons as string[])[0]).toContain('INCOMPLETE READ');
  });

  it('leaves resultTrustworthy true and the verdict unqualified on a complete walk', async () => {
    const { jobs, client } = stubs({ endpointPages: 1, failingIndex: 0 });
    const out = await diagnoseJob(jobs, client, { jobDefinitionId: JOB_ID });
    const meta = out.meta as Record<string, unknown>;

    expect(meta.resultTrustworthy).toBe(true);
    expect(meta.resultTrustworthyReasons).toEqual([]);
    expect(out.verdict).not.toContain('PARTIAL READ');
    // A resolved, freshly-seen endpoint is not stale, so this is a real negative.
    expect((out.reliabilitySignals as Record<string, unknown>).selfPerpetuating).toBe(false);
  });
});
