/**
 * Insights — mock integration, and the suite's FAILURE-PATH tier.
 *
 * ── Two gaps closed at once ─────────────────────────────────────────────────
 * 1. `bconnect-insights-mcp` is the 14th server and had no mock tier at all —
 *    the same blind spot that left it out of six guards in August, found again
 *    on 2026-08-22.
 * 2. "What happens on a bMS that is slow, down, or returns a 5xx MID-WALK?" was
 *    the least-exercised behaviour in the suite. It was never tested because
 *    `msw` — which every unit test here uses — intercepts at the fetch layer
 *    and cannot produce a dropped socket, a connection that is accepted and
 *    never answered, or a body that stops arriving. Those are precisely what a
 *    composite walking dozens of pages meets on a real estate.
 *
 * This tier drives the REAL production client over a REAL socket against
 * `scripts/bconnect-mock.mjs`, whose fault injection stages each condition on
 * purpose. `after: 2` is the important knob: two dimensions are served
 * normally and the rest fail, which is a mid-walk failure rather than a server
 * that was down before the call started.
 *
 * ── The property under test, in one sentence ────────────────────────────────
 * A composite must DEGRADE — return what it read, say plainly what it could
 * not, and refuse to look clean — and must never crash, hang, or report an
 * unread dimension as an empty one. Every assertion below is a form of that.
 */

import { describe, it, beforeAll, afterEach, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { buildEstateRiskBriefing, type HttpLike } from '../../modules/estate-risk.js';
import { buildEndpointBriefing } from '../../modules/endpoint-briefing.js';
import {
  checkMockAvailable,
  createClient,
  reset,
  setFault,
  MOCK_UNREACHABLE,
} from './helpers.js';

let available = false;
let http: HttpLike;
/** A second client with a short timeout, for the slow-bMS case only. */
let impatient: HttpLike;

beforeAll(async () => {
  available = await checkMockAvailable();
  if (!available) {
    return;
  }
  http = createClient().getHttpClient() as unknown as HttpLike;
  impatient = createClient(800).getHttpClient() as unknown as HttpLike;
  await reset();
});

afterEach(async () => {
  if (available) {
    await reset();
  }
});

describe('the happy path, so the failure cases mean something', () => {
  it('reads all four dimensions and reports them trustworthy', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);

    const briefing = await buildEstateRiskBriefing(http);

    expect(briefing.meta.dimensionsRead).toBe(4);
    expect(briefing.meta.resultTrustworthy).toBe(true);
    expect(briefing.meta.resultTrustworthyReasons).toEqual([]);
    expect(briefing.encryption.available).toBe(true);
    expect(briefing.endpoints.available).toBe(true);
  });
});

describe('a bMS that fails MID-WALK', () => {
  it('keeps the dimensions it read, names the ones it did not, and is never an all-clear', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);

    // Two dimensions served, then every subsequent request 500s. This is the
    // case a unit test cannot stage: the failure begins partway through a
    // sequence of real requests.
    await setFault({ mode: 'status-500', after: 2 });
    const briefing = await buildEstateRiskBriefing(http);

    // Degrade, never fail whole: the first two dimensions survive.
    expect(briefing.encryption.available).toBe(true);
    expect(briefing.defender.available).toBe(true);
    // And the rest are reported as unread rather than as empty.
    expect(briefing.vulnerabilities.available).toBe(false);
    expect(briefing.endpoints.available).toBe(false);

    expect(briefing.meta.dimensionsRead).toBe(2);
    expect(briefing.meta.resultTrustworthy).toBe(false);
    expect(briefing.meta.resultTrustworthyReasons.join(' ')).toMatch(/500/);

    // The headline must LEAD with the incompleteness and must never render the
    // all-clear sentence over data nobody read.
    expect(briefing.headline[0]).toMatch(/INCOMPLETE/);
    expect(briefing.headline.join(' ')).not.toMatch(/No exposure found/);
  });

  it('survives the socket being destroyed, which msw cannot reproduce', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);

    await setFault({ mode: 'drop', after: 1 });
    const briefing = await buildEstateRiskBriefing(http);

    expect(briefing.meta.resultTrustworthy).toBe(false);
    expect(briefing.headline[0]).toMatch(/INCOMPLETE/);
    // A transport failure is described, never inspected — SEC-2's rule — so the
    // reason says it could not be reached without pasting a stack trace.
    expect(briefing.meta.resultTrustworthyReasons.join(' ')).toMatch(/could not be reached|socket|network/i);
  });

  it('a slow bMS times out into an unavailable dimension rather than hanging', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);

    // The mock holds the response for longer than this client will wait.
    await setFault({ mode: 'slow', delayMs: 3000, after: 1 });
    const started = Date.now();
    const briefing = await buildEstateRiskBriefing(impatient);
    const elapsed = Date.now() - started;

    expect(briefing.meta.resultTrustworthy).toBe(false);
    expect(briefing.headline[0]).toMatch(/INCOMPLETE/);
    // It gave up on its own clock rather than the mock's: proof the timeout is
    // real and not merely the request eventually finishing.
    expect(elapsed).toBeLessThan(3000);
  });

  it('a 403 mid-walk is reported as a rights problem, not as zero rows', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);

    await setFault({ mode: 'status-403', after: 2 });
    const briefing = await buildEstateRiskBriefing(http);

    expect(briefing.vulnerabilities.available).toBe(false);
    expect(briefing.meta.resultTrustworthyReasons.join(' ')).toMatch(/403|may not read/i);
    expect(briefing.meta.resultTrustworthy).toBe(false);
  });
});

describe('a 200 that is not what it appears to be', () => {
  it('an EMPTY page under an intact header breaks trust — the state observed live', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);

    // data: [] while totalItems says 27. Measured on the real API 2026-08-12;
    // here it is reproduced over a real socket rather than a stub.
    await setFault({ mode: 'empty-page' });
    const briefing = await buildEstateRiskBriefing(http);

    expect(briefing.meta.resultTrustworthy).toBe(false);
    expect(briefing.headline.join(' ')).toMatch(/INCOMPLETE/);
    expect(briefing.headline.join(' ')).not.toMatch(/No exposure found/);
  });

  it('a totalItems that is a STRING is a shape mismatch, loud, not a silent zero', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);

    await setFault({ mode: 'string-total' });
    const briefing = await buildEstateRiskBriefing(http);

    expect(briefing.meta.resultTrustworthy).toBe(false);
    expect(briefing.meta.resultTrustworthyReasons.join(' ')).toMatch(/totalItems/);
  });

  it('a body that is not the paged envelope is refused rather than read as empty', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);

    await setFault({ mode: 'not-envelope' });
    const briefing = await buildEstateRiskBriefing(http);

    expect(briefing.meta.resultTrustworthy).toBe(false);
    expect(briefing.meta.resultTrustworthyReasons.join(' ')).toMatch(/shape not understood/);
  });
});

describe('the per-endpoint composite degrades the same way', () => {
  it('reports every dimension it could not read, over a real 503', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);

    await setFault({ mode: 'status-503' });
    const briefing = await buildEndpointBriefing(http, {
      endpointId: 'aaaa0001-0001-0001-0001-000000000001',
    });

    expect(briefing.meta.resultTrustworthy).toBe(false);
    expect(briefing.meta.dimensionsRead).toBe(0);
    expect(briefing.headline[0]).toMatch(/INCOMPLETE/);
    // Not "nothing wrong found" — the sentence this suite exists to prevent.
    expect(briefing.headline.join(' ')).not.toMatch(/Nothing wrong found/);
  });
});

describe('the client itself, over a real socket', () => {
  it('reports the mock bMS version through the production probe path', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);

    const client = createClient();
    await expect(client.testConnection()).resolves.toBe(true);
    const probe = client.getConnectionProbe();
    expect(probe?.outcome).toBe('version');
  });

  it('a 500 on the probe route is a failed connection, not a silent success', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);

    await setFault({ mode: 'status-500' });
    const client = createClient();
    await expect(client.testConnection()).resolves.toBe(false);
    expect(client.getConnectionProbe()?.outcome).toBe('failed');
  });
});

/** Keeps the axios type import honest — the client's instance IS an AxiosInstance. */
export type _Instance = AxiosInstance;
