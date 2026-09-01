/**
 * A cache file must carry the tenant it was fetched for, and be re-checked on
 * read — not merely be NAMED after it.
 *
 * ── Why the filename is not enough ──────────────────────────────────────────
 * `cache-provenance.ts` puts the fingerprint in the filename so two bMS servers
 * under one OS user cannot read each other's cache. That works, and it is a
 * single point of failure: the moment two configurations resolve the same
 * filename, the reader has no second opinion and serves foreign data as fact.
 *
 * What it does catch: an ACCIDENTAL collision. If `FINGERPRINT_LENGTH` or the
 * hash inputs are ever adjusted, every existing file silently re-points at a
 * different tenant, and without a payload check the reader cannot tell.
 *
 * What it does NOT catch, stated because the first version of this header
 * claimed otherwise and a review enumerated it away:
 *   - It does not heal the pre-2026-08-14 env-fingerprinted files. Under the
 *     client fingerprint those resolve a DIFFERENT filename, so this build
 *     never opens them — the fingerprint change orphaned them by itself.
 *   - It is not a defence against a poisoning attacker: the expected value is
 *     printed in the filename, so anyone able to plant a file can read it off a
 *     directory listing. Ownership and mode defend that, in secure-disk-cache.
 *
 * `readDiskCache` already re-validates COMPLETENESS on read rather than
 * trusting what it wrote. Provenance is the weaker sibling of that argument —
 * worth having, worth not overselling.
 *
 * ── What these tests plant ──────────────────────────────────────────────────
 * A structurally perfect, in-TTL, complete cache file at the CURRENT tenant's
 * own path, whose payload says it was fetched for someone else. That is what a
 * filename collision looks like from the reader's side. It must be discarded
 * and refetched, not served.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AxiosInstance } from "axios";
import { fingerprintFromHttpClient, fingerprintedCacheName } from "@bconnect/mcp-core";

const OURS = "https://bms-ours.example.invalid/bconnect";
const THEIRS = "https://bms-theirs.example.invalid/bconnect";

function client(baseURL: string, calls: { n: number }, scannedAt: string): AxiosInstance {
  return {
    defaults: { baseURL, headers: { common: { "X-Api-Key": "shared-key" } } },
    async get() {
      calls.n++;
      return {
        data: {
          totalPages: 1,
          totalItems: 1,
          data: [
            {
              id: "ji-1",
              endpointName: "WIN10-01",
              endpointId: "e-1",
              jobDefinitionName: "SCAN: Vulnerability",
              steps: [
                { type: "WindowsComplianceScan", state: "FinishedSuccessfully", lastAction: scannedAt },
              ],
            },
          ],
        },
      };
    },
  } as unknown as AxiosInstance;
}

const OUR_SCAN = "2026-08-13T00:00:00Z";
const THEIR_SCAN = "2026-01-02T00:00:00Z";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cache-prov-"));
  vi.stubEnv("TMPDIR", dir);
  vi.stubEnv("TEMP", dir);
  vi.stubEnv("TMP", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function fresh() {
  vi.resetModules();
  return {
    scan: await import("../modules/scan-recency.js"),
    disk: await import("../modules/secure-disk-cache.js"),
  };
}

/** Where OUR tenant's history file lives. */
function ourCachePath(): string {
  return join(
    dir,
    "bconnect-mcp",
    fingerprintedCacheName(
      "compliance-scan-history.json",
      fingerprintFromHttpClient({
        defaults: { baseURL: OURS, headers: { common: { "X-Api-Key": "shared-key" } } },
      }),
    ),
  );
}

/** A complete, in-TTL history payload — the only thing wrong is whose it is. */
function foreignPayload(provenance: string | undefined): string {
  const body: Record<string, unknown> = {
    fetchedAt: Date.now(),
    entries: [
      [
        "WIN10-01",
        {
          endpointId: "e-foreign",
          lastAttempt: THEIR_SCAN,
          lastSuccess: THEIR_SCAN,
          stepState: "FinishedSuccessfully",
          jobName: "SCAN: Vulnerability",
          inProgress: false,
        },
      ],
    ],
    instancesExamined: 1,
    pagesFetched: 1,
    bytes: 100,
    totalPages: 1,
    totalItems: 1,
    truncated: false,
    orderBy: "lastChanged desc",
  };
  if (provenance !== undefined) {
    body.provenance = provenance;
  }
  return JSON.stringify(body);
}

describe("a cache file is only trusted for the tenant it records", () => {
  it("vacuity: the planted file IS otherwise acceptable — same shape a real one has", async () => {
    // If the plant were rejected for being malformed, in-TTL-expired or
    // incomplete, the provenance assertions below would pass for the wrong
    // reason. Prove it is served when the provenance matches.
    const { scan, disk } = await fresh();
    const calls = { n: 0 };
    const ours = fingerprintFromHttpClient({
      defaults: { baseURL: OURS, headers: { common: { "X-Api-Key": "shared-key" } } },
    });
    disk.writeCacheFileSync(join(dir, "bconnect-mcp"), ourCachePath(), foreignPayload(ours));

    const res = await scan.loadComplianceScanHistory(client(OURS, calls, OUR_SCAN));
    expect(calls.n, "a matching-provenance file must be served from disk").toBe(0);
    expect(res.byEndpoint.get("WIN10-01")?.lastSuccess).toBe(THEIR_SCAN);
  });

  it("discards a file whose payload names a DIFFERENT tenant, even at our own path", async () => {
    const { scan, disk } = await fresh();
    const calls = { n: 0 };
    const theirs = fingerprintFromHttpClient({
      defaults: { baseURL: THEIRS, headers: { common: { "X-Api-Key": "shared-key" } } },
    });
    // Their data, our filename — what a fingerprint collision looks like.
    disk.writeCacheFileSync(join(dir, "bconnect-mcp"), ourCachePath(), foreignPayload(theirs));

    const res = await scan.loadComplianceScanHistory(client(OURS, calls, OUR_SCAN));

    expect(calls.n, "the foreign file was served instead of being refetched").toBeGreaterThan(0);
    // Our scan date, not theirs. Asserted by name — a stringify match would
    // pass if their date landed in some other field.
    expect(res.byEndpoint.get("WIN10-01")?.lastSuccess).toBe(OUR_SCAN);
  });

  it("discards a PRE-FIX file that records no provenance at all", async () => {
    // Files written before this check exist in %TEMP% right now and are inside
    // their TTL. "No provenance recorded" cannot mean "provenance fine" — that
    // is the missing-fact-reads-as-good-fact rule this suite is built on.
    const { scan, disk } = await fresh();
    const calls = { n: 0 };
    disk.writeCacheFileSync(join(dir, "bconnect-mcp"), ourCachePath(), foreignPayload(undefined));

    const res = await scan.loadComplianceScanHistory(client(OURS, calls, OUR_SCAN));

    expect(calls.n, "an unprovenanced file must be refetched, not trusted").toBeGreaterThan(0);
    expect(res.byEndpoint.get("WIN10-01")?.lastSuccess).toBe(OUR_SCAN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The SAME guard in exposure.ts, which nothing exercised
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Both modules got this guard from one script, and only one got a test.
 *
 * A review made the point sharply: delete the check in `exposure.ts` and the
 * whole suite stayed green, because the only exposure-cache plants in the repo
 * carry CORRECT provenance. Half the change was unfalsifiable. The CVE library
 * is the more dangerous of the two to serve across tenants — its entry ids are
 * per-server, so a foreign library scores every detection as unscored and
 * `aboveThreshold` collapses to 0, which reads as a clean estate.
 */
describe("the CVE library cache is only trusted for the tenant it records", () => {
  const libClient = (baseURL: string, calls: { n: number }) =>
    ({
      defaults: { baseURL, headers: { common: { "X-Api-Key": "shared-key" } } },
      async getAllVulnerabilities() {
        calls.n++;
        return {
          totalItems: 1,
          totalPages: 1,
          data: [{ id: "v-1", cveId: "CVE-2026-0001", cvssScore: 9.8, severity: "Critical" }],
        };
      },
      async getAllDetectedVulnerabilities() {
        return { totalItems: 0, totalPages: 1, data: [] };
      },
    }) as unknown as { getHttpClient: () => unknown };

  function libraryPath(baseURL: string): string {
    return join(
      dir,
      "bconnect-mcp",
      fingerprintedCacheName(
        "vulnerability-library.json",
        fingerprintFromHttpClient({
          defaults: { baseURL, headers: { common: { "X-Api-Key": "shared-key" } } },
        }),
      ),
    );
  }

  function libraryPayload(provenance: string | undefined): string {
    const entries = [["v-1", { cveId: "CVE-2026-0001", cvssScore: 9.8, severity: "Critical" }]];
    const body: Record<string, unknown> = {
      fetchedAt: Date.now(),
      entries,
      cveEntries: [["CVE-2026-0001", { cveId: "CVE-2026-0001", cvssScore: 9.8, severity: "Critical" }]],
      expectedTotal: 1,
    };
    if (provenance !== undefined) {body.provenance = provenance;}
    return JSON.stringify(body);
  }

  async function freshExposure() {
    vi.resetModules();
    return {
      exposure: await import("../modules/exposure.js"),
      disk: await import("../modules/secure-disk-cache.js"),
    };
  }

  /** The module under test wants a ComplianceModule; give it one with a client. */
  const asModule = (c: ReturnType<typeof libClient>) => {
    const mod = c as unknown as Record<string, unknown>;
    mod.getHttpClient = () => (c as unknown as { defaults: unknown }).defaults
      ? { defaults: (c as unknown as { defaults: unknown }).defaults }
      : {};
    return mod as never;
  };

  it("vacuity: a matching-provenance library IS served from disk", async () => {
    const { exposure, disk } = await freshExposure();
    const calls = { n: 0 };
    const ours = fingerprintFromHttpClient({
      defaults: { baseURL: OURS, headers: { common: { "X-Api-Key": "shared-key" } } },
    });
    disk.writeCacheFileSync(join(dir, "bconnect-mcp"), libraryPath(OURS), libraryPayload(ours));

    await exposure.analyzeExposure(asModule(libClient(OURS, calls)), {});
    expect(calls.n, "a matching file must be served without refetching").toBe(0);
  });

  it("discards a library whose payload names a different tenant", async () => {
    const { exposure, disk } = await freshExposure();
    const calls = { n: 0 };
    const theirs = fingerprintFromHttpClient({
      defaults: { baseURL: THEIRS, headers: { common: { "X-Api-Key": "shared-key" } } },
    });
    disk.writeCacheFileSync(join(dir, "bconnect-mcp"), libraryPath(OURS), libraryPayload(theirs));

    await exposure.analyzeExposure(asModule(libClient(OURS, calls)), {});
    expect(calls.n, "a foreign library was served instead of being refetched").toBeGreaterThan(0);
  });

  it("discards a PRE-FIX library that records no provenance", async () => {
    const { exposure, disk } = await freshExposure();
    const calls = { n: 0 };
    disk.writeCacheFileSync(join(dir, "bconnect-mcp"), libraryPath(OURS), libraryPayload(undefined));

    await exposure.analyzeExposure(asModule(libClient(OURS, calls)), {});
    expect(calls.n, "an unprovenanced library must be refetched").toBeGreaterThan(0);
  });
});
