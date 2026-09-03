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
//
// Ratcheted 83 -> 86 on 2026-08-03 (F2 in phase4/optimization.md).
// unpatched-reachability-and-caveats.test.ts took unpatched.ts from 100%
// statements / 60.25% branches to 100%/100%: the reachability blockers
// (never-checked-in vs. offline-too-long), the onlyReachable filter, every
// caveat (stale scan, scan-age span, in-progress scan, neverScannedReachable,
// upstream incompleteness ordering) and the scan-recency-lookup-failure
// degrade path (a thrown Error AND a non-Error throw) are now exercised —
// none of that "verdict" logic had a single assertion before. Measured fresh
// with `npx vitest run --coverage`: 88.95% statements. `exposure.ts` was
// under concurrent edit by another pass at measurement time, so the floor is
// set a few points under rather than pinned to the exact figure.
export default createServerVitestConfig({ statements: 86, lines: 86 });
