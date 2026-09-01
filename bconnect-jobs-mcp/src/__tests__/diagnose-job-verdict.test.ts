/**
 * diagnose_job — verdict, configuration and reasons construction
 * (F2 in phase4/optimization.md).
 *
 * `diagnose-job-endpoint-walk.test.ts` (another, concurrently-landed pass —
 * see its own header) covers the M1 endpoint-walk bound thoroughly. This
 * file covers a different slice of the same 472-line composite that was
 * 2.42% covered at the start of this pass: the verdict thresholds, the
 * fetch-error degrade path, the v1.1-unavailable degrade path, the
 * timeout/AbortOnError/Destructive reason strings, and the
 * stepOutcomes-vs-configuration mismatch note. None of this had a single
 * assertion before.
 *
 * `fetchV11Job` is mocked directly (same technique the M1 file uses) so each
 * case can drive v1.1 availability precisely. `isFailure`/`normaliseCause`
 * are NOT mocked — they are exercised for real, because they are exactly the
 * shared classification diagnose-job.ts depends on getting right (X5:
 * `Rescheduled` is a success, not a failure).
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

const JOB_ID = '44444444-4444-4444-4444-444444444444';
const NOW = new Date();
const isoDaysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

/** No endpoint-walk traffic expected in most of these — RepeatedExecution.IsActive is false/absent. */
const noEndpointTraffic: AxiosInstance = {
  async get() {
    throw new Error('unexpected endpoint listing request');
  },
} as unknown as AxiosInstance;

function jobsStub(opts: {
  definition?: Record<string, unknown> | 'reject';
  instances?: Array<Record<string, unknown>>;
  instancesReject?: boolean;
}): JobsModule {
  return {
    async getJobDefinition() {
      if (opts.definition === 'reject') {throw new Error('404');}
      return opts.definition ?? { name: 'Weekly patch', folder: 'Patching', type: 'WindowsJob' };
    },
    async getJobInstancesByJobDefinition() {
      if (opts.instancesReject) {throw new Error('No job definition with that id.');}
      const data = opts.instances ?? [];
      return { totalPages: 1, totalItems: data.length, data };
    },
  } as unknown as JobsModule;
}

const inst = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: crypto.randomUUID?.() ?? String(Math.random()),
  jobDefinitionId: JOB_ID,
  endpointName: 'EP-1',
  start: isoDaysAgo(1),
  lastAction: isoDaysAgo(1),
  state: 'Finished',
  successfulExecutions: 1,
  erroneousExecutions: 0,
  steps: [],
  ...overrides,
});

const V11_NONE = { job: null, reason: 'BCONNECT_V11_USERNAME/PASSWORD not configured' };
const v11Job = (overrides: Record<string, unknown> = {}): { job: Record<string, unknown>; reason: null } => ({
  job: {
    Destructive: false,
    JobExecutionTimeout: 0,
    Steps: [{ Type: 'ManagedSoftware' }],
    ...overrides,
  },
  reason: null,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('diagnose_job — verdict thresholds', () => {
  it('UNKNOWN when the instance-history fetch itself fails (bad jobDefinitionId)', async () => {
    fetchV11JobMock.mockResolvedValue(V11_NONE);
    const jobs = jobsStub({ instancesReject: true });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });

    expect(out.verdict).toBe('UNKNOWN — instance history could not be fetched');
    const history = out.history as Record<string, unknown>;
    expect(history.fetchError).toContain('No job definition with that id.');
    const reasons = out.reasons as string[];
    expect(reasons.join(' ')).toContain('Instance history could not be fetched');
    const meta = out.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(false);
  });

  it('UNKNOWN — no instance history when the window is empty rather than the fetch failing', async () => {
    fetchV11JobMock.mockResolvedValue(V11_NONE);
    const jobs = jobsStub({ instances: [] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });

    expect(out.verdict).toMatch(/^UNKNOWN — no instance history for this job in the examined window/);
    expect((out.history as Record<string, unknown>).fetchError).toBeNull();
  });

  it('RELIABLE when nothing in the examined window failed', async () => {
    fetchV11JobMock.mockResolvedValue(V11_NONE);
    const jobs = jobsStub({ instances: [inst(), inst(), inst()] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect(out.verdict).toMatch(/^RELIABLE/);
  });

  it('MOSTLY RELIABLE under a 20% failure rate', async () => {
    fetchV11JobMock.mockResolvedValue(V11_NONE);
    // 1 of 10 fails = 10%.
    const instances = [inst({ state: 'FinishedWithError' }), ...Array.from({ length: 9 }, () => inst())];
    const jobs = jobsStub({ instances });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect(out.verdict).toMatch(/^MOSTLY RELIABLE/);
  });

  it('FLAKY between 20% and 50% failure rate', async () => {
    fetchV11JobMock.mockResolvedValue(V11_NONE);
    // 3 of 10 fails = 30%.
    const instances = [
      ...Array.from({ length: 3 }, () => inst({ state: 'FinishedWithError' })),
      ...Array.from({ length: 7 }, () => inst()),
    ];
    const jobs = jobsStub({ instances });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect(out.verdict).toMatch(/^FLAKY/);
  });

  it('UNRELIABLE at or above 50% failure rate', async () => {
    fetchV11JobMock.mockResolvedValue(V11_NONE);
    const instances = [inst({ state: 'FinishedWithError' }), inst()];
    const jobs = jobsStub({ instances });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect(out.verdict).toMatch(/^UNRELIABLE/);
  });

  it('`Rescheduled` does not count as a failure (X5) — a job with only Rescheduled instances reads RELIABLE', async () => {
    fetchV11JobMock.mockResolvedValue(V11_NONE);
    const jobs = jobsStub({ instances: [inst({ state: 'Rescheduled' }), inst({ state: 'Rescheduled' })] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect(out.verdict).toMatch(/^RELIABLE/);
  });

  it('sinceDays scopes out instances older than the window, changing the verdict', async () => {
    fetchV11JobMock.mockResolvedValue(V11_NONE);
    const jobs = jobsStub({
      instances: [
        inst({ state: 'FinishedWithError', start: isoDaysAgo(60), lastAction: isoDaysAgo(60) }),
        inst({ state: 'Finished', start: isoDaysAgo(1), lastAction: isoDaysAgo(1) }),
      ],
    });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID, sinceDays: 7 });

    // Only the recent, successful instance is in-window.
    expect(out.verdict).toMatch(/^RELIABLE/);
    expect((out.history as Record<string, unknown>).instancesExamined).toBe(1);
  });
});

describe('diagnose_job — v1.1 configuration degrade path', () => {
  it('sets configuration.available false, names missingSignals, and adds a reasons entry when v1.1 is unavailable', async () => {
    fetchV11JobMock.mockResolvedValue({ job: null, reason: 'v1.1 credentials rejected (401)' });
    const jobs = jobsStub({ instances: [inst()] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });

    const config = out.configuration as Record<string, unknown>;
    expect(config.available).toBe(false);
    expect(config.source).toBeNull();
    expect(config.unavailableReason).toBe('v1.1 credentials rejected (401)');
    expect(config.destructive).toBeNull();
    expect(config.abortOnError).toBeNull();

    const meta = out.meta as Record<string, unknown>;
    expect(meta.diagnosisComplete).toBe(false);
    expect(meta.missingSignals).toEqual([
      'Destructive flag (v1.1 unavailable)',
      'AbortOnError x multi-step interaction (v1.1 unavailable)',
      'RepeatedExecution / self-perpetuating-failure check (v1.1 unavailable)',
    ]);
    expect((out.reasons as string[]).join(' ')).toContain('v1.1 configuration unavailable (v1.1 credentials rejected (401))');
  });

  it('populates configuration fully when v1.1 IS available', async () => {
    fetchV11JobMock.mockResolvedValue(
      v11Job({ Destructive: true, JobExecutionTimeout: 3600, AbortOnError: true })
    );
    const jobs = jobsStub({ instances: [inst()] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });

    const config = out.configuration as Record<string, unknown>;
    expect(config.available).toBe(true);
    expect(config.source).toBe('bConnect v1.1');
    expect(config.destructive).toBe(true);
    expect(config.jobExecutionTimeout).toBe(3600);
    expect(config.timeoutNote).toBeNull();
    expect(config.abortOnError).toBe(true);
    expect((out.meta as Record<string, unknown>).missingSignals).toBeNull();
    expect((out.reasons as string[]).join(' ')).toContain('Job is flagged Destructive');
  });
});

describe('diagnose_job — timeout reason branches (D16)', () => {
  it('says the configured timeout is unknown when v1.1 was not read', async () => {
    fetchV11JobMock.mockResolvedValue(V11_NONE);
    const jobs = jobsStub({ instances: [inst({ state: 'FinishedWithError', stateDescription: 'Execution timeout' })] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect((out.reasons as string[]).join(' ')).toMatch(/Configured timeout unknown — v1\.1 was not read/);
  });

  it('says JobExecutionTimeout=0 means no per-job limit, not unlimited, when v1.1 is available', async () => {
    fetchV11JobMock.mockResolvedValue(v11Job({ JobExecutionTimeout: 0 }));
    const jobs = jobsStub({ instances: [inst({ state: 'FinishedWithError', stateDescription: 'Execution timeout' })] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect((out.reasons as string[]).join(' ')).toMatch(/JobExecutionTimeout reads 0 on this job/);
    expect((out.configuration as Record<string, unknown>).timeoutNote).toMatch(/does NOT mean unlimited/);
  });

  it('reports the actual configured timeout value when one is set', async () => {
    fetchV11JobMock.mockResolvedValue(v11Job({ JobExecutionTimeout: 7200 }));
    const jobs = jobsStub({ instances: [inst({ state: 'FinishedWithError', stateDescription: 'Execution timeout' })] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect((out.reasons as string[]).join(' ')).toContain('Configured JobExecutionTimeout: 7200');
  });
});

describe('diagnose_job — AbortOnError x multi-step risk (D11)', () => {
  it('is null (no risk statement) for a single-step job', async () => {
    fetchV11JobMock.mockResolvedValue(v11Job({ Steps: [{ Type: 'ManagedSoftware' }] }));
    const jobs = jobsStub({ instances: [inst()] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect((out.reliabilitySignals as Record<string, unknown>).abortOnErrorRisk).toBeNull();
  });

  it('flags a risk for a multi-step job where AbortOnError is absent (false-or-unset, D11)', async () => {
    fetchV11JobMock.mockResolvedValue(
      v11Job({ Steps: [{ Type: 'ManagedSoftware' }, { Type: 'WindowsApplicationInstallation' }] })
    );
    const jobs = jobsStub({ instances: [inst()] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    const risk = (out.reliabilitySignals as Record<string, unknown>).abortOnErrorRisk as string;
    expect(risk).toMatch(/2 steps/);
    // "absent … not coerced to false" is the whole point: the field's absence is
    // reported as what it is, and the sentence stays about the record this call
    // actually read rather than about how bMS serialises the field in general.
    expect(risk).toMatch(/absent from the v1\.1 record/);
    expect(risk).toMatch(/false-or-unset/);
    expect(risk).not.toMatch(/estate/i);
  });

  it('reports independence when AbortOnError is explicitly false on a multi-step job', async () => {
    fetchV11JobMock.mockResolvedValue(
      v11Job({ Steps: [{ Type: 'A' }, { Type: 'B' }], AbortOnError: false })
    );
    const jobs = jobsStub({ instances: [inst()] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    const risk = (out.reliabilitySignals as Record<string, unknown>).abortOnErrorRisk as string;
    expect(risk).toMatch(/explicitly false/);
    expect(risk).toMatch(/each step's own reliability/);
  });
});

describe('diagnose_job — stepOutcomes vs. configured Steps granularity mismatch note', () => {
  it('flags when runtime step types outnumber configured steps', async () => {
    fetchV11JobMock.mockResolvedValue(v11Job({ Steps: [{ Type: 'ManagedSoftware' }] }));
    const jobs = jobsStub({
      instances: [
        inst({ steps: [{ type: 'WindowsApplicationInstallation', state: 'Finished' }] }),
        inst({ steps: [{ type: 'WindowsApplicationUninstall', state: 'Finished' }] }),
      ],
    });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect(out.stepOutcomesNote).toMatch(/not the same granularity/);
    expect(out.stepOutcomesNote).toMatch(/1 configured step/);
    expect(out.stepOutcomesNote).toMatch(/2 distinct runtime step type/);
  });

  it('is null when the counts match', async () => {
    fetchV11JobMock.mockResolvedValue(v11Job({ Steps: [{ Type: 'ManagedSoftware' }] }));
    const jobs = jobsStub({ instances: [inst({ steps: [{ type: 'ManagedSoftware', state: 'Finished' }] })] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect(out.stepOutcomesNote).toBeNull();
  });
});

describe('diagnose_job — endpoint lookup failure degrades rather than crashing', () => {
  it('catches an HTTP failure in the endpoint walk and reports it as unavailable, not a thrown error', async () => {
    fetchV11JobMock.mockResolvedValue(
      v11Job({
        WindowsProperties: {
          RepeatedExecution: { IsActive: true, ErrorBehavior: 'PlanNew', RepetitionEntries: [{ Minutes: 60 }] },
        },
      })
    );
    const jobs = jobsStub({ instances: [inst({ state: 'FinishedWithError', endpointName: 'EP-DOWN' })] });
    const failingHttp = {
      async get() {
        throw new Error('403 Forbidden');
      },
    } as unknown as AxiosInstance;

    const out = await diagnoseJob(jobs, failingHttp, { jobDefinitionId: JOB_ID });

    const risk = (out.reliabilitySignals as Record<string, unknown>).staleEndpointRisk as Record<string, unknown>;
    expect(risk.unavailable).toContain('endpoint lookup failed: 403 Forbidden');
    const meta = out.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(false);
    expect(meta.resultTrustworthyReasons).toEqual(
      expect.arrayContaining([expect.stringContaining('could not be read (403 Forbidden)')])
    );
  });

  it('does not attempt the endpoint walk at all when RepeatedExecution is not active', async () => {
    fetchV11JobMock.mockResolvedValue(
      v11Job({ WindowsProperties: { RepeatedExecution: { IsActive: false } } })
    );
    const jobs = jobsStub({ instances: [inst({ state: 'FinishedWithError' })] });
    // noEndpointTraffic throws if .get() is ever called — this proves the walk
    // was skipped rather than merely failing silently.
    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });

    expect((out.reliabilitySignals as Record<string, unknown>).staleEndpointRisk).toBeNull();
    expect((out.reliabilitySignals as Record<string, unknown>).selfPerpetuating).toBeNull();
  });

  it('does not attempt the endpoint walk when there are no failing instances to resolve', async () => {
    fetchV11JobMock.mockResolvedValue(
      v11Job({
        WindowsProperties: {
          RepeatedExecution: { IsActive: true, ErrorBehavior: 'PlanNew' },
        },
      })
    );
    const jobs = jobsStub({ instances: [inst({ state: 'Finished' })] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect((out.reliabilitySignals as Record<string, unknown>).staleEndpointRisk).toBeNull();
  });
});

describe('diagnose_job — job definition lookup failure is non-fatal', () => {
  it('surfaces job.name === null rather than crashing when getJobDefinition rejects', async () => {
    fetchV11JobMock.mockResolvedValue(V11_NONE);
    const jobs = jobsStub({ definition: 'reject', instances: [inst()] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });
    expect((out.job as Record<string, unknown>).name).toBeNull();
    // The rest of the diagnosis still runs.
    expect(out.verdict).toMatch(/^RELIABLE/);
  });
});

describe('diagnose_job — the completeness reason must not fire when the signal never applied', () => {
  it('flags PARTIAL READ / resultTrustworthy:false for an ordinary job where RepeatedExecution was never active — not just for a genuinely truncated endpoint walk', async () => {
    // `selfPerpetuating` is declared `let selfPerpetuating: boolean | null = null`
    // and is only ever reassigned inside `if (v11 && rep?.IsActive === true &&
    // failingEndpointNames.length > 0)`. Every other job — no v1.1, no
    // RepeatedExecution, or IsActive=false — leaves it at its initial `null`,
    // and `assessResultTrust` reads `selfPerpetuating === null` as "the signal
    // was computed and came back UNDETERMINED because of a bounded walk",
    // pushing a reason that names a specific endpoint-listing bound
    // (`meta.resultTrustworthyReasons` mentions "the endpoint listing was
    // bounded") EVEN THOUGH NO ENDPOINT LISTING WAS EVER READ
    // (`meta.endpointWalk` is null here). This is not a truncation finding —
    // it fires with `endpointPages` never requested at all.
    //
    // This test documents CURRENT behaviour (it is not a regression guard for
    // a fix — diagnose-job.ts is out of this pass's edit scope, and another
    // pass is actively changing this file). Flagged in the report as a
    // candidate defect: the vast majority of jobs do not have
    // RepeatedExecution.IsActive=true, so this puts a false, specific-sounding
    // "bounded walk" explanation into ordinary diagnoses' resultTrustworthyReasons.
    fetchV11JobMock.mockResolvedValue(V11_NONE);
    const jobs = jobsStub({ instances: [inst(), inst(), inst()] });

    const out = await diagnoseJob(jobs, noEndpointTraffic, { jobDefinitionId: JOB_ID });

    // FIXED. The reason is now gated on `endpointWalk !== null`, so it fires
    // only when the listing was actually read and the answer was genuinely
    // undecidable — not when the signal never applied to this job at all.
    expect(out.verdict).toBe('RELIABLE');
    const meta = out.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(true);
    // The listing was never requested, so there is nothing to be incomplete
    // ABOUT — and no sentence claiming otherwise.
    expect(meta.endpointWalk).toBeNull();
    expect(meta.resultTrustworthyReasons ?? []).toEqual([]);
  });
});
