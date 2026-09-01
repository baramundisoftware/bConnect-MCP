/**
 * scan-recency.ts — the in-memory history cache must partition by TENANT.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * `loadComplianceScanHistory` checks `historyCache` (module scope, unkeyed)
 * BEFORE `readDiskCache()`, whose path is fingerprinted per call precisely so a
 * process whose environment is re-read partitions to the new bMS. An unkeyed
 * memory cache in front of that silently undoes the partition for the whole
 * 15-minute TTL.
 *
 * What makes it a WRONG FACT rather than a stale one is the key. This history
 * is keyed by endpoint DISPLAY NAME — `cache-provenance.ts` says so and says
 * why it matters: `WIN10-01` exists in most estates. So server B's endpoint
 * inherits server A's scan date, and `neverScanned` / `scanAgeDays` answer for
 * a machine nobody looked at. "This endpoint was scanned 2 days ago" is then
 * false about a real machine, which is worse than admitting ignorance.
 *
 * `exposure.ts`'s `libraryCache` had the identical gap and was keyed on
 * 2026-08-14; this is the sibling, and the consequence here is worse because
 * the library's ids are per-server (so a mismatch degrades to "unscored")
 * while a display name collides silently and looks right.
 *
 * ── Why the fixture is what it is ───────────────────────────────────────────
 * Two tenants differ only by `BCONNECT_BASE_URL`, which is one of the three
 * fingerprint inputs. Both estates contain an endpoint called WIN10-01 —
 * deliberately the same name, because that IS the attack surface — and the two
 * servers report different scan dates for it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AxiosInstance } from "axios";

/** The name that exists on both estates. This is the point of the test. */
const SHARED_NAME = "WIN10-01";
const TENANT_A = "https://bms-a.example.invalid/bconnect";
const TENANT_B = "https://bms-b.example.invalid/bconnect";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scan-tenant-"));
  vi.stubEnv("TMPDIR", dir);
  vi.stubEnv("TEMP", dir);
  vi.stubEnv("TMP", dir);
  vi.stubEnv("BCONNECT_API_KEY", "key-shared-by-both");
  vi.stubEnv("BCONNECT_USERNAME", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function freshScanRecency() {
  // CACHE_DIR is computed once at module load, so the tmpdir stub must be in
  // place before the import — same reason as the exposure suite.
  vi.resetModules();
  return await import("../modules/scan-recency.js");
}

/**
 * A job-history page for one endpoint, with a scan step at a given date.
 * `state` and step naming follow what scan-recency's reducer looks for.
 */
function historyHttp(scannedAt: string, calls: { n: number }, baseURL: string): AxiosInstance {
  return {
    // The identity the cache partitions on. It is read off the CLIENT, not off
    // process.env, because `resolveClientConfig` takes the base URL from
    // per-request gateway credentials or `__SUFFIX` scoped variables before it
    // ever looks at the ambient environment — so an env-based fingerprint
    // cannot tell two gateway tenants apart. An earlier version of this test
    // switched BCONNECT_BASE_URL and left the fake client identical, which
    // meant both "tenants" hashed the same and the test was checking nothing
    // once the fix moved to the client.
    defaults: { baseURL, headers: { common: { "X-Api-Key": "key-shared-by-both" } } },
    async get() {
      calls.n++;
      return {
        data: {
          totalPages: 1,
          totalItems: 1,
          data: [
            {
              id: "ji-1",
              endpointName: SHARED_NAME,
              endpointId: "e-1",
              jobDefinitionName: "SCAN: Vulnerability",
              // The reducer reads the SCAN STEP, not the instance: it filters
              // on `step.type === "WindowsComplianceScan"` and takes the date
              // from `step.lastAction`. An earlier draft of this fixture put
              // the date on the instance and produced no entries at all — the
              // vacuity guard below is what caught it.
              steps: [
                {
                  type: "WindowsComplianceScan",
                  state: "FinishedSuccessfully",
                  lastAction: scannedAt,
                },
              ],
            },
          ],
        },
      };
    },
  } as unknown as AxiosInstance;
}

const A_SCAN = "2026-08-13T00:00:00Z";
const B_SCAN = "2026-01-02T00:00:00Z";

describe("the scan-history cache partitions by tenant", () => {
  it("does not serve tenant A's scan history to tenant B", async () => {
    const scan = await freshScanRecency();
    const callsA = { n: 0 };
    const callsB = { n: 0 };

    vi.stubEnv("BCONNECT_BASE_URL", TENANT_A);
    const a = await scan.loadComplianceScanHistory(historyHttp(A_SCAN, callsA, TENANT_A));
    expect(callsA.n).toBeGreaterThan(0);
    const aEntry = a.byEndpoint.get(SHARED_NAME);
    expect(aEntry, "tenant A must have produced an entry — otherwise this proves nothing").toBeTruthy();

    // The environment is re-read to a DIFFERENT bMS, inside the 15-minute TTL.
    vi.stubEnv("BCONNECT_BASE_URL", TENANT_B);
    const b = await scan.loadComplianceScanHistory(historyHttp(B_SCAN, callsB, TENANT_B));

    // Tenant B must have been fetched, not served from tenant A's memory.
    expect(callsB.n, "tenant B's history was served from another tenant's cache").toBeGreaterThan(0);

    const bEntry = b.byEndpoint.get(SHARED_NAME);
    expect(bEntry).toBeTruthy();
    // The named field, not a substring of the stringified object: matching on
    // the whole blob would pass if B's date landed in `jobName` or `stepState`
    // instead of the scan date, which is not the property being claimed.
    expect(bEntry?.lastSuccess).toBe(B_SCAN);
    expect(bEntry?.lastAttempt).toBe(B_SCAN);
  });

  it("still serves the SAME tenant from the MEMORY cache — the key must not disable it", async () => {
    // The over-flagging control: a key that never matches would look exactly
    // like a fix while turning a 15-minute cache into a per-call refetch of the
    // whole job history.
    //
    // The disk cache has to be removed between the two calls for this to mean
    // anything. An earlier version did not, and a review showed it passed via
    // the DISK path whether or not the memory key ever matched — the first call
    // writes a complete, non-truncated file, and every read guard then accepts
    // it. So the assertion held while proving nothing about the thing it names.
    const scan = await freshScanRecency();
    const calls = { n: 0 };

    vi.stubEnv("BCONNECT_BASE_URL", TENANT_A);
    await scan.loadComplianceScanHistory(historyHttp(A_SCAN, calls, TENANT_A));
    const afterFirst = calls.n;
    expect(afterFirst).toBeGreaterThan(0);

    // Only the in-memory key can produce a hit now.
    rmSync(join(dir, "bconnect-mcp"), { recursive: true, force: true });

    await scan.loadComplianceScanHistory(historyHttp(A_SCAN, calls, TENANT_A));
    expect(calls.n, "a second call for the same tenant must hit the MEMORY cache").toBe(afterFirst);
  });
});
