/**
 * exposure.ts — the trust flags are MODULE state, and two calls share it.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * `lastLibraryError` and `lastDetectionsIncomplete` live at module scope. Each
 * is reset on the FIRST STATEMENT of its loader and read at the END of
 * `analyzeExposure`, with a full detections walk in between. So a second call
 * entering `loadLibrary` while the first is still walking detections resets a
 * flag the first call has already set — and the first call then publishes
 * `libraryUnavailable: null`, `resultTrustworthy: true`, and (because an
 * unloaded library scores nothing) `aboveThreshold: 0`.
 *
 * That is the false all-clear this file's own header calls "the single most
 * dangerous wrong answer this tool can give", reachable without any API fault
 * in the reading call at all.
 *
 * ── Why this is a test and not a note ───────────────────────────────────────
 * Two independent reviews reached this conclusion by READING the control flow;
 * neither reproduced it. A race argued from source is a hypothesis. The second
 * test below reproduces it deterministically: a gate parks call A inside its
 * detections walk, call B runs to completion in that window, and A is then
 * released and asked what it thinks it knows.
 *
 * The third test covers the mirror direction — B's outage attributed to a
 * healthy A, a false ALARM rather than a false all-clear.
 *
 * ── A trap worth naming, because it cost a round here ───────────────────────
 * The gate is a PROMISE and the thing that opens it is a FUNCTION. An earlier
 * draft of the third test awaited the resolver rather than the promise;
 * `await someFunction` resolves immediately, so call A never parked, the two
 * calls never overlapped, and the test passed while proving nothing. It was
 * caught by a lint error about an unused variable, not by the test result —
 * which is the whole problem with a concurrency test that cannot fail loudly:
 * a broken harness and a fixed defect look identical from the outside. Both
 * tests below therefore assert the interleaving actually happened (`vulnCalls`
 * and `detCalls` reach 2) rather than trusting the gate to have worked.
 *
 * Concurrency is not exotic here. Both affected tools are cases in ONE switch in
 * ONE process, the MCP SDK dispatches `tools/call` without awaiting, and the
 * gateway builds a server per request inside a single Node process. A model
 * issuing `get_vulnerability_exposure` and `get_unpatched_endpoints` together is
 * ordinary behaviour.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComplianceModule } from "../modules/compliance.js";

type Row = Record<string, unknown>;

const libRow = (i: number): Row => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
  cveId: `CVE-2026-${1000 + i}`,
  cvssScore: 9.8,
  severity: "Critical",
});

const detRow = (i: number): Row => ({
  id: `d0000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
  vulnerabilityId: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
  cveId: `CVE-2026-${1000 + i}`,
  endpointId: "e0000000-0000-0000-0000-000000000001",
  endpointName: "WIN11CLIENT1",
  detected: "2026-08-01T00:00:00Z",
  ignored: false,
});

let dir: string;

beforeEach(() => {
  // Isolated tmpdir, stubbed BEFORE the module is imported: exposure.ts computes
  // CACHE_DIR once at load, so a later stub would not move it.
  dir = mkdtempSync(join(tmpdir(), "exposure-race-"));
  vi.stubEnv("TMPDIR", dir);
  vi.stubEnv("TEMP", dir);
  vi.stubEnv("TMP", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function freshExposure() {
  vi.resetModules();
  return await import("../modules/exposure.js");
}

/** Spin until `predicate` holds, so the test observes real state, not a guess. */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 2_000; i++) {
    if (predicate()) {return;}
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

/**
 * Let already-scheduled continuations run.
 *
 * Deliberately does NOT observe the module's own error state. An earlier draft
 * polled the exported `libraryUnavailableReason()` getter, which reads the very
 * global the fix removes — a test that can only express its precondition in
 * terms of the defect cannot survive the repair. Counting the fake's calls and
 * then draining the queue says the same thing from outside.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

/**
 * A compliance module whose FIRST library read is an outage and whose SECOND is
 * healthy, and whose FIRST detections read parks until released.
 *
 * That shape is the interleaving: call A takes the outage and parks; call B
 * takes the healthy library and runs straight through, resetting the flag A had
 * already set.
 */
function racingCompliance(release: Promise<void>) {
  const state = { vulnCalls: 0, detCalls: 0 };
  const module = {
    // The cache partitions on the identity of the CLIENT that fetched the
    // rows, not on ambient env vars, so a faithful fake must carry one.
    getHttpClient: () => ({
      defaults: { baseURL: 'https://bms-test.invalid/bconnect', headers: { common: { 'X-Api-Key': 'test-key' } } },
    }),
    async getAllVulnerabilities() {
      const call = ++state.vulnCalls;
      if (call === 1) {
        // Intact envelope header over an empty body — the state measured live
        // on this estate, and the one that makes an empty library look clean.
        return { totalItems: 10, totalPages: 1, data: [] };
      }
      return { totalItems: 1, totalPages: 1, data: [libRow(0)] };
    },
    async getAllDetectedVulnerabilities(params: { Page?: number }) {
      const call = ++state.detCalls;
      if (call === 1) {await release;}
      return {
        totalItems: 1,
        totalPages: 1,
        data: (params.Page ?? 0) === 0 ? [detRow(0)] : [],
      };
    },
  } as unknown as ComplianceModule;
  return { module, state };
}

describe("a concurrent call must not erase another call's library outage", () => {
  it("vacuity: the same fake really does produce an outage when run ALONE", async () => {
    // Without this, the race test could pass for the trivial reason that the
    // fixture never produced an outage to erase.
    const exposure = await freshExposure();
    const { module } = racingCompliance(Promise.resolve());
    const solo = await exposure.analyzeExposure(module, { refreshLibrary: true });
    expect(solo.libraryUnavailable).not.toBeNull();
    // The empty-envelope path, which is the one this fixture exercises: an
    // intact header over zero rows is reported as an API failure-reported-as-
    // success, NOT as the totalItems-vs-absorbed shortfall (that is a different
    // branch, for a partially-served library).
    expect(String(solo.libraryUnavailable)).toMatch(/empty page set/i);
  });

  it("keeps call A's outage when call B resets the flag mid-walk", async () => {
    const exposure = await freshExposure();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { module, state } = racingCompliance(gate);

    // A starts: takes the failing library, then parks inside its detections walk.
    // The flag is what proves A is still parked when B finishes — see the
    // interleaving assertions below.
    let aSettled = false;
    const a = exposure
      .analyzeExposure(module, { refreshLibrary: true })
      .then((r) => { aSettled = true; return r; });

    // A has served its (failing) library and is now parked in its detections
    // walk. Draining the queue lets loadLibrary's continuation record the
    // outage, so B's reset genuinely lands AFTER A's write — which is the only
    // ordering in which the pre-fix build loses it.
    await waitFor(
      () => state.vulnCalls >= 1 && state.detCalls >= 1,
      "A to serve its library and reach its detections walk",
    );
    await settle();

    // B runs to completion INSIDE A's window. Its own answer is legitimately
    // clean — B's library really did load.
    const b = await exposure.analyzeExposure(module, { refreshLibrary: true });
    expect(b.libraryUnavailable).toBeNull();

    // ── The interleaving actually happened — asserted BEFORE release ─────────
    // This has to be checked here, not after `await a`. An earlier version
    // asserted the call counters afterwards, which proves nothing: by then both
    // calls have finished, so 2/2 holds whether they overlapped or ran strictly
    // one after the other. It would have passed against the very harness bug it
    // was written to catch (awaiting the resolver instead of the gate).
    //
    // Checked here, the two together are the actual property: B's whole call
    // ran, and A has still not returned — so B's reset landed inside A's window.
    expect(state.vulnCalls).toBe(2);
    expect(state.detCalls).toBe(2);
    expect(aSettled).toBe(false);

    release();
    const resultA = await a;

    // A read a library that did not load. It must still say so.
    expect(resultA.libraryUnavailable).not.toBeNull();
    expect(String(resultA.libraryUnavailable)).toMatch(/empty page set/i);
    // And the reason it matters: with no library, nothing can be scored, so a
    // silent A would publish an empty estate as a clean one.
    expect(resultA.library.byId.size).toBe(0);
  });

  it("does not attribute call B's outage to a healthy call A — the false-alarm direction", async () => {
    // A's library is fine; B's is not. A must not inherit B's outage — a false
    // ALARM on a healthy call, the mirror of the false all-clear above.
    const exposure = await freshExposure();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const state = { vulnCalls: 0, detCalls: 0 };
    const module = {
    // The cache partitions on the identity of the CLIENT that fetched the
    // rows, not on ambient env vars, so a faithful fake must carry one.
    getHttpClient: () => ({
      defaults: { baseURL: 'https://bms-test.invalid/bconnect', headers: { common: { 'X-Api-Key': 'test-key' } } },
    }),
      async getAllVulnerabilities() {
        const call = ++state.vulnCalls;
        // FIRST call healthy (that is A), second an outage (that is B).
        return call === 1
          ? { totalItems: 1, totalPages: 1, data: [libRow(0)] }
          : { totalItems: 10, totalPages: 1, data: [] };
      },
      async getAllDetectedVulnerabilities(params: { Page?: number }) {
        const call = ++state.detCalls;
        // `gate`, not `release`. An earlier draft awaited the RESOLVER, which is
        // a function: awaiting it resolves immediately, so call A never parked,
        // no interleaving occurred, and the test passed while proving nothing.
        if (call === 1) {await gate;}
        return { totalItems: 1, totalPages: 1, data: (params.Page ?? 0) === 0 ? [detRow(0)] : [] };
      },
    } as unknown as ComplianceModule;

    let aSettled = false;
    const a = exposure
      .analyzeExposure(module, { refreshLibrary: true })
      .then((r) => { aSettled = true; return r; });
    await waitFor(
      () => state.vulnCalls >= 1 && state.detCalls >= 1,
      "A to serve its library and reach its detections walk",
    );
    await settle();

    const b = await exposure.analyzeExposure(module, { refreshLibrary: true });
    expect(b.libraryUnavailable).not.toBeNull();

    // Same interleaving proof, and for the same reason it must come first.
    expect(state.vulnCalls).toBe(2);
    expect(state.detCalls).toBe(2);
    expect(aSettled).toBe(false);

    release();
    const resultA = await a;

    expect(resultA.library.byId.size).toBe(1);
    expect(resultA.libraryUnavailable).toBeNull();
  });
});
