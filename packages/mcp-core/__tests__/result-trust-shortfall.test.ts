/**
 * `shortfallReason` — the backstop five walk callers rely on.
 *
 * `get_fleet_summary`, `get_stale_endpoints`, `diagnose_job`,
 * `explain_job_failure` and `preview_assignment` each capture page 0's
 * `totalItems` explicitly — `paginateAll` cannot see the field — and hand it
 * here so a walk that absorbed fewer rows than the server declared says so.
 * When this returns null, `assessResultTrust` reads no reasons and the response
 * asserts `resultTrustworthy: true`.
 *
 * ── The defect these tests were written after ───────────────────────────────
 * The guard was `typeof totalItems !== "number" || absorbed >= totalItems`,
 * which sent TWO different situations down the same "nothing to assert against"
 * path:
 *
 *   ABSENT      — the envelope omitted totalItems. Correctly nothing to check.
 *   UNREADABLE  — the envelope sent something that is not a number.
 *
 * Measured 2026-08-19: `shortfallReason("w", 5, "9")` returned null. An envelope
 * reporting `"totalItems": "1544"` as a string switched the check off silently,
 * for every caller at once.
 *
 * Same shape as the `paginateAll` defect found the same day — a value present
 * but unusable, absorbed as though it were missing. NaN happened to behave
 * correctly by accident: `typeof NaN === "number"` is true and `absorbed >= NaN`
 * is false, so it fell through and emitted a reason. A numeric string did not
 * get that luck.
 *
 * ── Why not plain `Number(x)` ───────────────────────────────────────────────
 * Because it is too permissive for a guard: `Number(true)` is 1 and `Number("")`
 * is 0, and either satisfies `absorbed >= declared`, suppressing the check again
 * through a different door. Only a number or a non-empty numeric string counts.
 */

import { describe, it, expect } from 'vitest';
import { shortfallReason, assessResultTrust } from '@bconnect/mcp-core';

describe('shortfallReason — the cases that must SUPPRESS', () => {
  it('says nothing when the walk covered the declared total', () => {
    expect(shortfallReason('the endpoint listing', 9, 9)).toBeNull();
    expect(shortfallReason('the endpoint listing', 12, 9)).toBeNull();
  });

  it('says nothing when the envelope genuinely omitted totalItems', () => {
    // ABSENT is the one case with nothing to assert against, and it is the
    // contract every caller depends on when a route does not report a total.
    expect(shortfallReason('w', 5, null)).toBeNull();
    expect(shortfallReason('w', 5, undefined)).toBeNull();
  });
});

describe('shortfallReason — the cases that must REPORT', () => {
  it('reports a genuine shortfall with both numbers and the difference', () => {
    const reason = shortfallReason('the endpoint listing', 5, 9);
    expect(reason).toContain('5 row(s)');
    expect(reason).toContain('9 exist');
    expect(reason).toContain('4 row(s) were not read');
  });

  it('compares a NUMERIC STRING instead of silently skipping the check', () => {
    // The regression. This returned null before 2026-08-19.
    const reason = shortfallReason('w', 5, '9');
    expect(reason, 'a numeric string must be compared, not treated as absent').not.toBeNull();
    expect(reason).toContain('9 exist');
  });

  it('reports — never suppresses — a totalItems that is not a number at all', () => {
    for (const unreadable of [Number.NaN, Number.POSITIVE_INFINITY, 'lots', '', true, {}]) {
      const reason = shortfallReason('w', 5, unreadable as never);
      expect(reason, `totalItems=${String(unreadable)} must not suppress the check`).not.toBeNull();
      expect(reason).toContain('not a number this walk can check itself against');
    }
  });

  it('names the offending value accurately, including NaN', () => {
    // `JSON.stringify(NaN)` is the string "null", which would have this message
    // report a value the envelope never sent.
    expect(shortfallReason('w', 5, Number.NaN)).toContain('as NaN');
    expect(shortfallReason('w', 5, 'lots' as never)).toContain('as "lots"');
  });
});

describe('shortfallReason — what it does to resultTrustworthy', () => {
  it('an unreadable total makes the response untrustworthy rather than confident', () => {
    // The property that matters. Suppressing the reason is not a cosmetic
    // difference: it flips the response's own claim about itself.
    const suppressed = assessResultTrust(shortfallReason('w', 5, null));
    expect(suppressed.resultTrustworthy).toBe(true);

    const unreadable = assessResultTrust(shortfallReason('w', 5, 'lots' as never));
    expect(unreadable.resultTrustworthy).toBe(false);
    expect(unreadable.resultTrustworthyReasons).toHaveLength(1);
  });

  it('a numeric-string shortfall reaches resultTrustworthy false, as a number would', () => {
    const asNumber = assessResultTrust(shortfallReason('w', 5, 9));
    const asString = assessResultTrust(shortfallReason('w', 5, '9'));
    expect(asString.resultTrustworthy).toBe(false);
    expect(asString).toEqual(asNumber);
  });
});
