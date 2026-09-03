/**
 * diagnose_job — the instance-history walk vs the envelope's own totalItems.
 *
 * The module already captured `totalItems` from the envelope and published it
 * as `history.totalInstancesForThisJob` — and then never asserted it against
 * what the walk absorbed. The bConnect API was MEASURED (live, 2026-08-12)
 * serving HTTP 200 with an empty data[] under an intact header, so a job with
 * 40 instances on the server could diagnose as "UNKNOWN — no instance history"
 * with `resultTrustworthy: true` and an empty reasons list: the machine-
 * readable marker asserting the opposite of what the numbers beside it show.
 *
 * Second defect, same input: the walk's only page bound was the
 * server-reported totalPages. Rows never advancing (empty pages) meant one
 * request per server-declared page, unbounded by anything this module owns —
 * the exact walk shape MAX_INSTANCE_PAGES was added to explain-job-failure
 * for.
 *
 * Controls pin the other direction: a genuinely empty history
 * (totalItems 0) and a fully-served history must stay trustworthy — a
 * diagnostic that cries PARTIAL READ over healthy data erodes the flag as
 * fast as the silent kind (this file's sibling learned that on the
 * self-perpetuating signal).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import type { JobsModule } from '../modules/jobs.js';

const fetchV11JobMock = vi.fn();
vi.mock('../modules/v11.js', () => ({
  v11Configured: () => true,
  fetchV11Job: (...args: unknown[]) => fetchV11JobMock(...args),
}));

import { diagnoseJob } from '../modules/diagnose-job.js';

const JOB_ID = '55555555-5555-5555-5555-555555555555';

const noEndpointTraffic: AxiosInstance = {
  async get() {
    throw new Error('unexpected endpoint listing request');
  },
} as unknown as AxiosInstance;

function jobsStub(instancePage: { totalPages: number; totalItems: number; data: Array<Record<string, unknown>> }): {
  jobs: JobsModule;
  instanceCalls: () => number;
} {
  let calls = 0;
  const jobs = {
    async getJobDefinition() {
      return { name: 'Weekly patch', folder: 'Patching', type: 'WindowsJob' };
    },
    async getJobInstancesByJobDefinition() {
      calls++;
      return instancePage;
    },
  } as unknown as JobsModule;
  return { jobs, instanceCalls: () => calls };
}

const inst = (i: number): Record<string, unknown> => ({
  id: `i-${i}`,
  jobDefinitionId: JOB_ID,
  endpointName: `EP-${i}`,
  start: new Date(Date.now() - 86_400_000).toISOString(),
  lastAction: new Date(Date.now() - 86_400_000).toISOString(),
  state: 'Finished',
  successfulExecutions: 1,
  erroneousExecutions: 0,
  steps: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchV11JobMock.mockResolvedValue({
    job: { Destructive: false, JobExecutionTimeout: 0, Steps: [{ Type: 'ManagedSoftware' }] },
    reason: null,
  });
});

describe('diagnose_job — an empty history page under an intact header breaks trust', () => {
  it('0 instances served while the server reports 40 → resultTrustworthy false, with the disagreement in the reasons', async () => {
    const { jobs } = jobsStub({ totalPages: 1, totalItems: 40, data: [] });
    const d = (await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID })) as {
      verdict: string;
      history: { instancesExamined: number; totalInstancesForThisJob: number | null };
      meta: { resultTrustworthy: boolean; resultTrustworthyReasons: string[] };
    };

    expect(d.history.instancesExamined).toBe(0);
    expect(d.meta.resultTrustworthy).toBe(false);
    const reasons = d.meta.resultTrustworthyReasons.join(' ');
    expect(reasons).toMatch(/40/);
    expect(reasons).toMatch(/not read/);
    // The verdict headline carries the qualification, same rule as a capped walk.
    expect(d.verdict).toMatch(/PARTIAL READ/);
  });

  it('the walk stops at its own page bound, and the reason NAMES that bound', async () => {
    // 500 declared pages, every one empty: rows never advance, so only a page
    // cap this module owns can end the walk.
    const { jobs, instanceCalls } = jobsStub({ totalPages: 500, totalItems: 40, data: [] });
    const d = (await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID })) as {
      meta: { resultTrustworthy: boolean; resultTrustworthyReasons: string[] };
    };

    expect(instanceCalls()).toBeLessThan(100);
    // The loop has three exits; here maxInstances bounded NOTHING (0 rows) —
    // reporting "bounded by maxInstances" for a MAX_HISTORY_PAGES stop is a
    // confident wrong diagnosis (adversarial review, M3). One reason, and it
    // names the bound that actually fired.
    expect(d.meta.resultTrustworthy).toBe(false);
    expect(d.meta.resultTrustworthyReasons).toHaveLength(1);
    expect(d.meta.resultTrustworthyReasons[0]).toMatch(/MAX_HISTORY_PAGES/);
    expect(d.meta.resultTrustworthyReasons[0]).not.toMatch(/bounded by maxInstances/);
  });
});

describe('diagnose_job — controls: honest data stays trustworthy', () => {
  it('a genuinely empty history (totalItems 0) is UNKNOWN and trustworthy, not PARTIAL', async () => {
    const { jobs } = jobsStub({ totalPages: 1, totalItems: 0, data: [] });
    const d = (await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID })) as {
      verdict: string;
      meta: { resultTrustworthy: boolean; resultTrustworthyReasons: string[] };
    };

    expect(d.meta.resultTrustworthy).toBe(true);
    expect(d.meta.resultTrustworthyReasons).toEqual([]);
    expect(d.verdict).toMatch(/UNKNOWN/);
    expect(d.verdict).not.toMatch(/PARTIAL READ/);
  });

  it('a fully-served history stays trustworthy', async () => {
    const rows = [inst(1), inst(2), inst(3)];
    const { jobs } = jobsStub({ totalPages: 1, totalItems: 3, data: rows });
    const d = (await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID })) as {
      meta: { resultTrustworthy: boolean };
      history: { instancesExamined: number; totalInstancesForThisJob: number | null };
    };

    expect(d.history.instancesExamined).toBe(3);
    expect(d.history.totalInstancesForThisJob).toBe(3);
    expect(d.meta.resultTrustworthy).toBe(true);
  });
});
