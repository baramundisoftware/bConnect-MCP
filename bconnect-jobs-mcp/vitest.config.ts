import { createServerVitestConfig } from '../vitest.shared';

// Coverage ratchet (QA-2 in EVAL-2026-08-02.md): thresholds are pinned to
// this server's CURRENT measured floor, not the aspirational 60% every
// server used to declare unenforced. Measured fresh via
// `npx vitest run --coverage` on 2026-08-02. Only raise these
// numbers after adding tests that justify it — this gate is meant to be
// honest, not aspirational.
// The sentence that used to end this comment — that the real target returns
// "once the mock-integration tier (where the module logic lives) is wired into
// CI" — was REMOVED on 2026-08-19 because it is false. See the note on
// coverage.exclude in ../vitest.shared.ts for the measurement.
// Ratcheted 18 -> 45 by the Class C pass (TOK-20/25/27, INT-47/53), which added
// 38 tests across tool-surface / tool-dispatch / job-instance-projection and
// took the measured floor to 49.3%. Re-measured with `npx vitest run --coverage`
// on 2026-08-02. Same rule as before: raise only behind tests that justify it.
//
// Ratcheted 46 -> 78 on 2026-08-03 (F2 in phase4/optimization.md). The main
// contributor is jobs-module-writes.test.ts: jobs.ts — the base API module
// where every write method lives (createJobInstance, start/stop/resume/
// deleteJobInstance, createFolder/updateFolder/deleteFolder, all four
// assignJobDefinitionTo* group variants, createKioskRelease/
// withdrawKioskRelease) — went from 15.96% to 100% statements/branches. That
// file also closed the remaining read-method gaps in the same module.
// diagnose-job.ts and explain-job-failure.ts moved independently in the same
// window (a different, concurrently-running pass fixing the endpoint/instance
// walk bounds — M1/M2).
//
// Ratcheted 78 -> 84 later the same day, after diagnose-job-verdict.test.ts
// (verdict thresholds, the fetchError/v1.1-unavailable degrade paths, the
// timeout/AbortOnError/Destructive reason strings, and the stepOutcomes
// granularity-mismatch note) took diagnose-job.ts to 99%/84.53%
// statements/branches. Re-measured twice for stability at 88.89% statements
// with the concurrent M1/M2 pass's own tests also green; floor set ~5 points
// under rather than the usual ~3 because two files here are still under
// another pass's active edit at measurement time.
export default createServerVitestConfig({ statements: 84, lines: 84 });
