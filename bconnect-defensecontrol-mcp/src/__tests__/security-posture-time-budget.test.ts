/**
 * get_security_posture — the call has a clock, and a spent clock is a partial
 * read, not a verdict.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * The three walks here were bounded by pages and by nothing else.
 * `BCONNECT_TIMEOUT_MS` bounds one request; three walks of hundreds of requests
 * had no overall deadline, and the only clock that mattered belonged to the MCP
 * client. Past its tool-call timeout the customer gets an error with nothing in
 * it — on the tool that answers "how exposed are we" — rather than the partial
 * answer this module already knows how to caveat.
 *
 * ── The property being pinned ───────────────────────────────────────────────
 * C2's rule applies to the clock exactly as it applies to the page bound: the
 * verdict changes when the read is partial. `headline` must lead with what was
 * and was not read, and must not be reachable in its clean form over a walk the
 * budget cut short. A `resultTrustworthy: false` beside an unchanged
 * "No posture issues found" would still be the bug.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { getSecurityPosture } from '../modules/security-posture.js';
import type { DefenseControlModule } from '../modules/defensecontrol.js';

/**
 * An estate of `pages` pages per route whose FIRST page takes `page0Ms`. Making
 * page 0 slow is what keeps this deterministic: the budget is provably spent by
 * the time page 1 would be requested, so exactly one page per route is fetched.
 */
function slowEstate(pages: number, page0Ms: number, threatTotalItems: number) {
  const pagesRequested: number[] = [];

  const endpointRow = (n: number) => ({
    endpointName: `ENDPOINT-${String(n).padStart(4, '0')}`,
    isSecureBootEnabled: true,
    tpmData: { tpmStatus: 'Enabled' },
    storageMedia: [
      { storageVolumes: [{ isSystemVolume: true, bitLockerVolumeData: { protectionStatus: 'Protected' } }] },
    ],
    isMicrosoftDefenderActive: true,
    microsoftDefenderState: { antivirus: { isActive: true, definitionCreation: new Date().toISOString() } },
  });

  const answer = async (params: Record<string, unknown>, totalItems: number) => {
    const page = Number(params.Page ?? 0);
    pagesRequested.push(page);
    if (page === 0) {
      await new Promise((resolve) => setTimeout(resolve, page0Ms));
    }
    return { totalPages: pages, totalItems, data: [endpointRow(page)] };
  };

  const module = {
    async getBitLockerWindowsEndpoints(params: Record<string, unknown> = {}) {
      return answer(params, pages);
    },
    async getMicrosoftDefenderWindowsEndpoints(params: Record<string, unknown> = {}) {
      return answer(params, pages);
    },
    async getMicrosoftDefenderThreats(params: Record<string, unknown> = {}) {
      return answer(params, threatTotalItems);
    },
  } as unknown as DefenseControlModule;

  return { module, pagesRequested };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSecurityPosture under a spent time budget', () => {
  it('stops walking, still answers, and refuses to call the partial read an estate verdict', async () => {
    vi.stubEnv('BCONNECT_COMPOSITE_BUDGET_MS', '1000');
    const stub = slowEstate(20, 1_200, 12_400);

    const res = await getSecurityPosture(stub.module);
    const meta = res.meta as Record<string, unknown>;
    const headline = res.headline as string[];

    // One page per route and no more.
    expect(stub.pagesRequested.every((p) => p === 0)).toBe(true);
    expect(stub.pagesRequested).toHaveLength(3);

    // The answer came back, and it says what it is.
    expect(meta.resultTrustworthy).toBe(false);
    const reasons = (meta.resultTrustworthyReasons as string[]).join(' ');
    expect(reasons).toMatch(/time budget/i);
    expect(reasons).toMatch(/BCONNECT_COMPOSITE_BUDGET_MS/);

    // The verdict changed — this is the part a `false` in meta alone would not fix.
    expect(headline[0]).toMatch(/INCOMPLETE READ/);
    expect(headline.join(' ')).not.toMatch(/No posture issues found in the checked dimensions/);

    // And the threat count is still the server's own figure, not the one row read.
    expect((res.threats as Record<string, unknown>).total).toBe(12_400);
    expect((res.threats as Record<string, unknown>).rowsExamined).toBe(1);

    const coverage = meta.coverage as Record<string, Record<string, unknown>>;
    expect(coverage.bitlocker.outOfTime).toBe(true);
    expect(coverage.defender.outOfTime).toBe(true);
    expect(coverage.threats.outOfTime).toBe(true);
    expect((meta.timeBudget as Record<string, unknown>).budgetMs).toBe(1_000);
  });

  it('reaches the clean verdict when the budget is ample and the walk covers the estate', async () => {
    vi.stubEnv('BCONNECT_COMPOSITE_BUDGET_MS', '20000');
    const stub = slowEstate(1, 0, 0);

    const res = await getSecurityPosture(stub.module);
    const meta = res.meta as Record<string, unknown>;

    expect(meta.resultTrustworthy).toBe(true);
    expect(res.headline).toEqual(['No posture issues found in the checked dimensions.']);
    const coverage = meta.coverage as Record<string, Record<string, unknown>>;
    expect(coverage.threats.outOfTime).toBe(false);
  });
});
