import { createServerVitestConfig } from '../vitest.shared';

// Coverage ratchet (QA-2 in EVAL-2026-08-02.md): thresholds are pinned a few
// points under this server's CURRENT measured coverage, not an aspiration.
//
// 43 -> 86 on 2026-08-19, after `src/__tests__/software-module-routes.test.ts`
// took `software.ts` from 12.56% to 100% and the workspace from 41.97% to
// 89.01%. Leaving the floor at 43 would have let 46 points regress unnoticed.
//
// ── The claim that used to be here, and why it was wrong ────────────────────
// This comment said the real target "returns once the mock-integration tier
// (where the module logic lives) is wired into CI — see QA-1". The module
// logic did not live there. MEASURED 2026-08-19: every workspace in this repo
// has exactly ONE mock-tier file, failing and passing alike, and the passing
// ones (jobs 96.3%, compliance 94.13%, endpoints 86.26%) cover their modules
// in the DEFAULT tier. The mock tier was covering the modules nowhere. What
// separated passing from failing was default-tier test-file count: 20-22 files
// gave 86-96%, 4-6 files gave 10-20%.
//
// So the floor was never blocked on CI wiring, and this workspace reached 89%
// with no mock server involved. bConnect-Mock is an external HTTP service on
// port 13433, absent from this repository — a floor must not depend on it.
export default createServerVitestConfig({ statements: 86, lines: 86 });
