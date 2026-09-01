/**
 * Global setup for the mock-integration tier: make "the mock was not there"
 * a FAILURE when the caller says it must be.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * The tier skips when the mock is unreachable, and `vitest run` exits 0 on a
 * file whose every test skipped. Measured 2026-08-22, before this existed:
 *
 *     Test Files  1 passed (1)
 *          Tests  4 skipped (4)
 *     EXIT=0
 *
 * That is safe for a developer who has no mock running. It is NOT safe for CI,
 * where "the mock container failed to start" and "the integration tier passed"
 * must not render identically — which is exactly the shape of this project's
 * `test-catalog-drift` defect ("0 passed, 0 failed, 14 skipped", exit 0).
 *
 * So the tier has two modes and the caller picks:
 *
 *   BCONNECT_MOCK_REQUIRED unset   skip quietly if the mock is absent (dev)
 *   BCONNECT_MOCK_REQUIRED=true    refuse to run at all if it is absent (CI)
 *
 * `scripts/run-mock-tier.mjs` sets it, because it starts the mock itself and
 * therefore has no excuse for it being missing.
 */

const MOCK_BASE_URL = process.env.BCONNECT_MOCK_URL ?? 'http://127.0.0.1:13433';

export async function setup(): Promise<void> {
  if (process.env.BCONNECT_MOCK_REQUIRED !== 'true') {
    return;
  }

  let reachable = false;
  try {
    const res = await fetch(`${MOCK_BASE_URL}/health`);
    reachable = res.ok;
  } catch {
    reachable = false;
  }

  if (!reachable) {
    throw new Error(
      `BCONNECT_MOCK_REQUIRED=true but no mock answered at ${MOCK_BASE_URL}/health.\n` +
        `  Refusing to run: a skipped integration tier and a passing one must not\n` +
        `  look the same to CI. Start one with:\n` +
        `      node scripts/bconnect-mock.mjs\n` +
        `  or run the whole tier with the mock managed for you:\n` +
        `      node scripts/run-mock-tier.mjs`
    );
  }
}
