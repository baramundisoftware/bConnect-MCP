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
// Raised from 44 to 74 by the TOK-22 collapse: the routing matrix and the
// validation rules moved into src/utils/, which coverage measures (src/index.ts
// is excluded as the MCP entry point), and dispatch.test.ts walks all 33 cells.
// Measured 74.18% on 2026-08-02 with `npx vitest run --coverage`.
export default createServerVitestConfig({ statements: 97, lines: 97 });
