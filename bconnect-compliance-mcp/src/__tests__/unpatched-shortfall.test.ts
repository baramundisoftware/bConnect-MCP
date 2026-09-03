/**
 * get_unpatched_endpoints — an empty page under an intact header is an
 * incident, not an estate (the short-serve companion to the H4 tests).
 *
 * The input shape was MEASURED live (2026-08-12): the bConnect API can answer
 * HTTP 200 with `data: []` while the envelope header keeps its real
 * `totalItems`. The H4 fix taught this module to stop blaming a "renamed or
 * deleted endpoint" when the walk hit its PAGE BOUND — but a walk that
 * COMPLETED while the server short-served it left `endpointsIncomplete` null,
 * so the confident wrong sentence came back, the loud caveat stayed silent,
 * and `resultTrustworthy` stayed true. Same hole on the detections side: a
 * walk that covered every declared page while absorbing 0 of the detections
 * the server itself counts produced a clean, empty, trustworthy patch queue —
 * finding B10's exact scenario.
 *
 * What this deliberately does NOT flag: a PARTIAL detections shortfall
 * (rows > 0 but fewer than totalItems). That is `exposure.ts`'s documented
 * decision — detections are live-mutating, and this estate carries a stable
 * measured count-vs-stream gap (2,454 claimed vs 1,954 served) that would
 * otherwise read INCOMPLETE forever. The zero-rows case is different: no
 * drift rationale covers 0 of 2,454. Controls pin the boundary.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AxiosInstance } from 'axios';
import type { ComplianceModule } from '../modules/compliance.js';

const TEST_TMP = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return mkdtempSync(join(tmpdir(), 'unpatched-shortfall-test-'));
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, tmpdir: () => TEST_TMP }, tmpdir: () => TEST_TMP };
});

afterAll(() => {
  rmSync(TEST_TMP, { recursive: true, force: true });
});

const CVE_ID = '11111111-1111-1111-1111-111111111111';
const EP = (n: number) => `ENDPOINT-${String(n).padStart(5, '0')}`;
const EP_ID = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

interface Envelope {
  data: Array<Record<string, unknown>>;
  totalPages: number;
  totalItems: number;
}

const detection = (n: number): Record<string, unknown> => ({
  vulnerabilityId: CVE_ID,
  endpointName: EP(n),
  endpointId: EP_ID(n),
  detected: '2026-08-01T00:00:00Z',
  isIgnored: false,
});

const endpointRow = (n: number): Record<string, unknown> => ({
  id: EP_ID(n),
  displayName: EP(n),
  type: 'WindowsEndpoint',
  operatingSystem: 'Synthetic OS',
  lastSeen: new Date().toISOString(),
  activity: null,
});

function stubCompliance(detections: Envelope): ComplianceModule {
  return {
    // The cache partitions on the identity of the CLIENT that fetched the
    // rows, not on ambient env vars, so a faithful fake must carry one.
    getHttpClient: () => ({
      defaults: { baseURL: 'https://bms-test.invalid/bconnect', headers: { common: { 'X-Api-Key': 'test-key' } } },
    }),
    async getAllVulnerabilities() {
      return {
        totalPages: 1,
        totalItems: 1,
        data: [{ id: CVE_ID, cveId: 'CVE-0000-00001', cvssScore: 9.8, severity: 'Critical' }],
      };
    },
    async getAllDetectedVulnerabilities() {
      return detections;
    },
  } as unknown as ComplianceModule;
}

function stubHttp(endpointEnvelope: Envelope): AxiosInstance {
  return {
    async get(url: string) {
      if (url.includes('/JobInstances')) {
        return { data: { totalPages: 1, totalItems: 0, data: [] } };
      }
      return { data: { currentPage: 0, ...endpointEnvelope } };
    },
  } as unknown as AxiosInstance;
}

/** Fresh module registry per test — exposure and scan-recency hold module-scope caches. */
async function run(endpointEnvelope: Envelope, detections: Envelope) {
  vi.resetModules();
  rmSync(join(TEST_TMP, 'bconnect-mcp'), { recursive: true, force: true });
  const { getUnpatchedEndpoints } = await import('../modules/unpatched.js');
  return await getUnpatchedEndpoints(stubCompliance(detections), stubHttp(endpointEnvelope), {
    refresh: true,
  });
}

describe('the endpoint walk — short-served but NOT truncated', () => {
  it('does not blame a renamed-or-deleted endpoint when the server served 0 of its own 26 rows', async () => {
    const res = await run(
      { data: [], totalPages: 1, totalItems: 26 },
      { data: [detection(0)], totalPages: 1, totalItems: 1 },
    );

    const rows = res.endpoints as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.endpointName === EP(0));
    expect(row, 'the endpoint must still be listed, labelled').toBeDefined();

    const blockers = ((row?.blockers as string[]) ?? []).join(' ');
    // The confident wrong explanation the H4 fix killed for the bounded case,
    // resurrected by the short-serve because endpointsIncomplete keyed only on
    // the walk's own bound.
    expect(blockers).not.toMatch(/renamed or deleted endpoint/i);
    // The true one, carrying the disagreement.
    expect(blockers).toMatch(/26/);
    expect(blockers).toMatch(/not read/);

    const caveats = (res.caveats as string[]).join(' ');
    expect(caveats).toMatch(/ENDPOINT LISTING IS INCOMPLETE/i);

    const meta = res.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(false);
    expect((meta.resultTrustworthyReasons as string[]).join(' ')).toMatch(/26/);
  });

  it('flags a SHORT page the same way (1 row served of 3 the server counts)', async () => {
    const res = await run(
      { data: [endpointRow(0)], totalPages: 1, totalItems: 3 },
      { data: [detection(0)], totalPages: 1, totalItems: 1 },
    );

    const meta = res.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(false);
    expect((meta.resultTrustworthyReasons as string[]).join(' ')).toMatch(/2 row\(s\) were not read/);
  });

  it('a page-cap truncation stays ONE condition — the shortfall guard stands down', async () => {
    // 40 declared pages of 1 row each against the 25-page cap: absorbing fewer
    // rows than totalItems is EXPECTED, and doubling the reason would prescribe
    // a retry the client-side bound cannot honour.
    let page = -1;
    const http = {
      async get(url: string) {
        if (url.includes('/JobInstances')) {
          return { data: { totalPages: 1, totalItems: 0, data: [] } };
        }
        page++;
        return { data: { currentPage: page, totalPages: 40, totalItems: 40, data: [endpointRow(page)] } };
      },
    } as unknown as AxiosInstance;

    vi.resetModules();
    rmSync(join(TEST_TMP, 'bconnect-mcp'), { recursive: true, force: true });
    const { getUnpatchedEndpoints } = await import('../modules/unpatched.js');
    const res = await getUnpatchedEndpoints(
      stubCompliance({ data: [detection(0)], totalPages: 1, totalItems: 1 }),
      http,
      { refresh: true },
    );

    const meta = res.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(false);
    expect(meta.resultTrustworthyReasons as string[]).toHaveLength(1);
    expect((meta.resultTrustworthyReasons as string[]).join(' ')).not.toMatch(/[Rr]etry/);
  });
});

describe('the detections walk — zero rows under a non-zero count', () => {
  it('an empty patch queue produced by an empty page is NOT a clean estate', async () => {
    const res = await run(
      { data: [endpointRow(0), endpointRow(1)], totalPages: 1, totalItems: 2 },
      { data: [], totalPages: 1, totalItems: 2454 },
    );

    const caveats = (res.caveats as string[]).join(' ');
    expect(caveats).toMatch(/DETECTIONS LISTING IS INCOMPLETE/i);
    expect(caveats).toMatch(/2454/);

    const meta = res.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(false);
    expect((meta.resultTrustworthyReasons as string[]).join(' ')).toMatch(/2454/);
  });

  it('control: genuinely zero detections (totalItems 0) is a clean estate and stays trustworthy', async () => {
    const res = await run(
      { data: [endpointRow(0), endpointRow(1)], totalPages: 1, totalItems: 2 },
      { data: [], totalPages: 1, totalItems: 0 },
    );

    const meta = res.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(true);
    expect(meta.resultTrustworthyReasons).toEqual([]);
    expect((res.caveats as string[]).join(' ')).not.toMatch(/DETECTIONS LISTING IS INCOMPLETE/i);
  });

  it('control: a PARTIAL detections shortfall stays unflagged — the documented live-drift decision', async () => {
    // 1 of 3 served. exposure.ts deliberately does not assert exact totalItems
    // over a non-empty walk (live-mutating data; measured stable phantom gap).
    // This control pins that boundary so the zero-rows fix cannot creep.
    const res = await run(
      { data: [endpointRow(0)], totalPages: 1, totalItems: 1 },
      { data: [detection(0)], totalPages: 1, totalItems: 3 },
    );

    const meta = res.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(true);
    expect((res.caveats as string[]).join(' ')).not.toMatch(/DETECTIONS LISTING IS INCOMPLETE/i);
  });
});
