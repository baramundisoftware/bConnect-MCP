/**
 * get_security_posture — completeness tests (audit finding C2).
 *
 * ── The defect these exist to catch ─────────────────────────────────────────
 * `getSecurityPosture` requested `PageSize: 1000`, sent no `Page`, never read
 * `totalPages` and never read `totalItems`. Every number it returned was
 * computed over page 0 and presented as an estate figure. Driven against a
 * server reporting 5 pages of endpoints and 12,400 detected threats, it
 * answered:
 *
 *     threats  : {"total": 0, "note": "No detected threats. ..."}
 *     headline : ["No posture issues found in the checked dimensions."]
 *
 * — with no `truncated`, no `totalPages`, no `totalItems` and no
 * `resultTrustworthy` anywhere in the response. That is the same sentence as
 * "nothing needs patching" over 1,522 critical detections, which is this
 * project's worst shipped defect, in a different server.
 *
 * Before this file there was NO test that executed this function at all.
 * `grep -rl "getSecurityPosture"` returned the module, `index.ts`, and two
 * tests that only look at tool names and schema shapes.
 *
 * ── Why the numbers below and not the real estate's ─────────────────────────
 * labcorp.local answers `totalPages=1` on all three routes (measured
 * 2026-08-03: BitLocker 23/1, Defender 23/1, Threats 0/1), so no live estate
 * this project has access to can reach the bug. The stub reports the page
 * counts an ordinary 1,000+ endpoint bMS produces. Endpoint names are
 * synthesised — `ENDPOINT-0001` — deliberately: this is heading for public
 * release and fixtures must carry no real host.
 */

import { describe, it, expect } from 'vitest';
import { getSecurityPosture } from '../modules/security-posture.js';
import type { DefenseControlModule } from '../modules/defensecontrol.js';

const PAGE_SIZE = 1000;

interface StubSpec {
  /** Pages the server claims for BitLocker and Defender endpoint listings. */
  endpointPages: number;
  /** Pages and item count the server claims for detected threats. */
  threatPages: number;
  threatTotalItems: number;
  /** When true the threat envelope carries a nonzero total and an empty `data` (finding B10). */
  threatsEmptyBody?: boolean;
}

interface StubCall {
  route: 'bitlocker' | 'defender' | 'threats';
  params: Record<string, unknown>;
}

/**
 * A DefenseControlModule stand-in that answers a paged estate and records every
 * request it was handed, so the tests can assert on `Page` and `OrderBy` as
 * well as on the response.
 */
function stubEstate(spec: StubSpec) {
  const calls: StubCall[] = [];

  const rows = (route: 'bitlocker' | 'defender', page: number) =>
    Array.from({ length: PAGE_SIZE }, (_, i) => {
      const n = page * PAGE_SIZE + i;
      const name = `ENDPOINT-${String(n).padStart(4, '0')}`;
      return route === 'bitlocker'
        ? {
            endpointName: name,
            // Every endpoint is unencrypted and has no TPM: if a page beyond
            // page 0 is ever read, the counts must move.
            isSecureBootEnabled: false,
            tpmData: { tpmStatus: 'NotPresent' },
            storageMedia: [
              {
                storageVolumes: [
                  {
                    isSystemVolume: true,
                    driveLetter: 'C:',
                    bitLockerVolumeData: { protectionStatus: 'Unprotected' },
                  },
                ],
              },
            ],
          }
        : { endpointName: name, isMicrosoftDefenderActive: false, microsoftDefenderState: null };
    });

  const module = {
    async getBitLockerWindowsEndpoints(params: Record<string, unknown> = {}) {
      calls.push({ route: 'bitlocker', params });
      const page = Number(params.Page ?? 0);
      return {
        currentPage: page,
        pageSize: PAGE_SIZE,
        totalPages: spec.endpointPages,
        totalItems: spec.endpointPages * PAGE_SIZE,
        data: rows('bitlocker', page),
      };
    },
    async getMicrosoftDefenderWindowsEndpoints(params: Record<string, unknown> = {}) {
      calls.push({ route: 'defender', params });
      const page = Number(params.Page ?? 0);
      return {
        currentPage: page,
        pageSize: PAGE_SIZE,
        totalPages: spec.endpointPages,
        totalItems: spec.endpointPages * PAGE_SIZE,
        data: rows('defender', page),
      };
    },
    async getMicrosoftDefenderThreats(params: Record<string, unknown> = {}) {
      calls.push({ route: 'threats', params });
      const page = Number(params.Page ?? 0);
      return {
        currentPage: page,
        pageSize: PAGE_SIZE,
        totalPages: spec.threatPages,
        totalItems: spec.threatTotalItems,
        data: spec.threatsEmptyBody
          ? []
          : Array.from({ length: Math.min(PAGE_SIZE, spec.threatTotalItems - page * PAGE_SIZE) }, (_, i) => ({
              id: `threat-${page * PAGE_SIZE + i}`,
              name: 'Synthetic.Test.Threat',
              severity: 'Severe',
            })),
      };
    },
  } as unknown as DefenseControlModule;

  return { module, calls };
}

/** The exact scenario from the audit's reproduction. */
const AUDIT_SCENARIO: StubSpec = {
  endpointPages: 5,
  threatPages: 13,
  threatTotalItems: 12_400,
  threatsEmptyBody: true,
};

describe('getSecurityPosture — page 0 must not be reported as the estate (C2)', () => {
  it('reads every page of the endpoint listings rather than only page 0', async () => {
    const stub = stubEstate({ endpointPages: 5, threatPages: 1, threatTotalItems: 0 });
    const res = await getSecurityPosture(stub.module);

    const bitlockerPages = stub.calls.filter((c) => c.route === 'bitlocker').map((c) => c.params.Page);
    expect([...bitlockerPages].sort()).toEqual([0, 1, 2, 3, 4]);

    const encryption = res.encryption as Record<string, number>;
    // 5 pages x 1000 rows, every one unencrypted. Page 0 alone gives 1000.
    expect(encryption.endpointsReporting).toBe(5000);
    expect(encryption.systemVolumeUnprotected).toBe(5000);
  });

  it('reports the server-stated threat total, not the length of one page', async () => {
    const stub = stubEstate(AUDIT_SCENARIO);
    const res = await getSecurityPosture(stub.module);
    const threats = res.threats as Record<string, unknown>;

    // The audit's reproduction: server says 12,400, module said 0.
    expect(threats.total).toBe(12_400);
    expect(String(threats.note)).not.toMatch(/No detected threats/i);
  });

  it('does not answer "No posture issues found" over an estate the server says has 12,400 threats', async () => {
    const stub = stubEstate(AUDIT_SCENARIO);
    const res = await getSecurityPosture(stub.module);

    const headline = res.headline as string[];
    expect(headline.join(' ')).not.toMatch(/No posture issues found/i);
    // The verdict itself has to change, not merely gain a footnote elsewhere.
    expect(headline.join(' ')).toMatch(/12,?400/);
  });

  it('states the bound in the response when a walk is truncated', async () => {
    // 400 pages of endpoints against a 25-page bound.
    const stub = stubEstate({ endpointPages: 400, threatPages: 1, threatTotalItems: 0 });
    const res = await getSecurityPosture(stub.module);

    const coverage = (res.meta as Record<string, unknown>).coverage as Record<
      string,
      { pagesFetched: number; totalPages: number; truncated: boolean; totalItems: number | null }
    >;
    expect(coverage.bitlocker.truncated).toBe(true);
    expect(coverage.bitlocker.totalPages).toBe(400);
    expect(coverage.bitlocker.pagesFetched).toBeLessThan(400);
    expect(coverage.bitlocker.totalItems).toBe(400_000);

    // A truncated read is not an estate verdict, and the headline must say so.
    expect((res.headline as string[]).join(' ')).toMatch(/not an estate verdict/i);
  });

  it('sets resultTrustworthy false with a reason when any input is partial', async () => {
    const stub = stubEstate(AUDIT_SCENARIO);
    const res = await getSecurityPosture(stub.module);
    const meta = res.meta as Record<string, unknown>;

    expect(meta.resultTrustworthy).toBe(false);
    expect(meta.resultTrustworthyReasons).toEqual(
      expect.arrayContaining([expect.stringContaining('12400')])
    );
  });

  it('sets resultTrustworthy true and keeps the clean headline on a complete single-page read', async () => {
    // The live labcorp.local shape, measured 2026-08-03: everything fits one page.
    const clean = {
      async getBitLockerWindowsEndpoints() {
        return { totalPages: 1, totalItems: 2, data: [
          { endpointName: 'ENDPOINT-0001', isSecureBootEnabled: true, tpmData: { tpmStatus: 'Enabled' },
            storageMedia: [{ storageVolumes: [{ isSystemVolume: true, bitLockerVolumeData: { protectionStatus: 'Protected' } }] }] },
          { endpointName: 'ENDPOINT-0002', isSecureBootEnabled: true, tpmData: { tpmStatus: 'Enabled' },
            storageMedia: [{ storageVolumes: [{ isSystemVolume: true, bitLockerVolumeData: { protectionStatus: 'Protected' } }] }] },
        ] };
      },
      async getMicrosoftDefenderWindowsEndpoints() {
        return { totalPages: 1, totalItems: 2, data: [
          { endpointName: 'ENDPOINT-0001', isMicrosoftDefenderActive: true,
            microsoftDefenderState: { antivirus: { isActive: true, definitionCreation: new Date().toISOString(), definitionVersion: '1.0' } } },
          { endpointName: 'ENDPOINT-0002', isMicrosoftDefenderActive: true,
            microsoftDefenderState: { antivirus: { isActive: true, definitionCreation: new Date().toISOString(), definitionVersion: '1.0' } } },
        ] };
      },
      async getMicrosoftDefenderThreats() {
        return { totalPages: 1, totalItems: 0, data: [] };
      },
    } as unknown as DefenseControlModule;

    const res = await getSecurityPosture(clean);
    const meta = res.meta as Record<string, unknown>;

    expect(meta.resultTrustworthy).toBe(true);
    expect(meta.resultTrustworthyReasons).toEqual([]);
    // A complete read of a genuinely clean estate keeps the plain verdict.
    expect(res.headline as string[]).toEqual(['No posture issues found in the checked dimensions.']);
  });
});

describe('getSecurityPosture — the bounded walk must be ordered (C2)', () => {
  it('sends an explicit OrderBy on every paged route', async () => {
    const stub = stubEstate({ endpointPages: 2, threatPages: 2, threatTotalItems: 1500 });
    await getSecurityPosture(stub.module);

    for (const call of stub.calls) {
      expect(String(call.params.OrderBy ?? ''), `${call.route} page ${call.params.Page}`).not.toBe('');
    }

    // Measured live 2026-08-03 against 26R1: these exact values answer HTTP 200,
    // and a value the route does not know answers HTTP 400 — so an unordered or
    // invented OrderBy is not a harmless default here.
    //
    // Note `EndpointId`, which the 26R1 spec text names as a legal OrderBy on
    // BitLocker/WindowsEndpoints, answers HTTP 400 on the live server. Only
    // EndpointName works. Do not "restore" it from the spec.
    const bl = stub.calls.find((c) => c.route === 'bitlocker');
    expect(bl?.params.OrderBy).toBe('EndpointName asc');
    const df = stub.calls.find((c) => c.route === 'defender');
    expect(df?.params.OrderBy).toBe('EndpointName asc');
    const th = stub.calls.find((c) => c.route === 'threats');
    expect(th?.params.OrderBy).toBe('Severity desc, Name asc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// maxNamed truncation must DISCLOSE itself
//
// The module applies "nothing is dropped without saying so" rigorously to its
// pagination — meta.coverage, resultTrustworthy, a headline that changes on a
// partial read — and did not apply it to the named lists, which `maxNamed`
// silently shortened.
//
// That omission was measured as expensive. On the reference estate the default
// names 10 of 19 unprotected endpoints and 10 of 17 with stale definitions, and
// in an instrumented session a model called this composite and THEN pulled
// list_defender_windows_endpoints (8,236 B) + list_bitlocker_windows_endpoints
// (6,337 B) — 14,573 B — to recover the names the cap had removed. Naming every
// one costs 735 B (2,818 -> 3,553 B). The caller could not make that trade
// because nothing said the list was short.
//
// Disclosure rather than a bigger default: naming everything is fine on 23
// endpoints and ruinous on 20,000.
//
// The field is namedNote, NOT namedTruncated: suite-truncation-disclosure
// refuses a sixth incompleteness vocabulary, and this is not that concept —
// the counts are exact, only the name list is capped.
//
// Falsified: delete the two `...namedCap(...)` spreads in security-posture.ts
// and the first two tests fail.
// ─────────────────────────────────────────────────────────────────────────────

describe('maxNamed truncation is disclosed', () => {
  it('says how many were shown, of how many, and how to see more', async () => {
    // 3 pages x 1000 rows, every one unencrypted, named list capped at 5.
    const { module: mod } = stubEstate({ endpointPages: 3, threatPages: 1, threatTotalItems: 0 });
    const out = (await getSecurityPosture(mod as unknown as DefenseControlModule, {
      maxNamed: 5,
    })) as Record<string, Record<string, unknown>>;

    expect(out.encryption.unprotectedEndpoints).toHaveLength(5);
    expect(out.encryption.namedShown).toBe(5);
    expect(out.encryption.namedTotal).toBe(3000);
    // The sentence must name the lever AND steer away from the expensive
    // fallback, which is the behaviour that cost 14,573 B in a real session.
    expect(String(out.encryption.namedNote)).toMatch(/maxNamed/);
    expect(String(out.encryption.namedNote)).toMatch(/raw list_\*|do NOT fall back/i);
  });

  it('discloses the defender cap too', async () => {
    const { module: mod } = stubEstate({ endpointPages: 3, threatPages: 1, threatTotalItems: 0 });
    const out = (await getSecurityPosture(mod as unknown as DefenseControlModule, {
      maxNamed: 5,
    })) as Record<string, Record<string, unknown>>;
    expect(out.defender.namedShown).toBe(5);
    expect(Number(out.defender.namedTotal)).toBeGreaterThan(5);
    expect(String(out.defender.namedNote)).toMatch(/maxNamed/);
  });

  it('costs NOTHING when the cap did not bite — no key at all', async () => {
    // The whole design of a detection-time disclosure: a response that hid
    // nothing must be byte-identical to one with no disclosure mechanism.
    const { module: mod } = stubEstate({ endpointPages: 3, threatPages: 1, threatTotalItems: 0 });
    const out = (await getSecurityPosture(mod as unknown as DefenseControlModule, {
      maxNamed: 100000,
    })) as Record<string, Record<string, unknown>>;

    expect('namedNote' in out.encryption).toBe(false);
    expect('namedShown' in out.encryption).toBe(false);
    expect('namedTotal' in out.encryption).toBe(false);
    expect('namedNote' in out.defender).toBe(false);
  });
});
