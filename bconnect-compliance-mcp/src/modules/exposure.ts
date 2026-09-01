/**
 * Vulnerability exposure — composite read-only analysis.
 *
 * LOCAL ADDITION (not upstream). Answers "which endpoints have vulnerabilities
 * above a severity threshold", which the raw API cannot do efficiently:
 * DetectedVulnerabilities carries no CVSS score, the Vulnerabilities library is
 * ~37.5k rows, PageSize caps at 1000, and there is no severity filter. Answering
 * it directly costs ~40 requests and ~31 MB (upstream finding D7).
 *
 * This does the join server-side and returns an aggregate, so the caller gets
 * one compact response instead of the raw rows (upstream finding D1).
 *
 * The library is cached at module scope. That matters because a fresh client —
 * and therefore a fresh per-client cache — is built on every tool call
 * (upstream finding R3/B8), so anything held on the client would never survive.
 * Module scope outlives the call.
 *
 * SCAN AGE (added later, answering upstream finding D17). Ranking endpoints by
 * vulnerability count without saying how old each count is invites a wrong
 * conclusion: on this estate the top-ranked endpoint's data was 4 days old and
 * the second's was 533 days old, presented as directly comparable. Every ranked
 * row now carries its own as-of date, and the response carries an estate-level
 * summary of how current the ranking is. See `scan-recency.ts` for how the date
 * is derived and why one signal is not enough. The extra cost is one cached
 * request (~650 ms cold, 0 ms warm); pass `includeScanAge: false` to skip it.
 * No pre-existing field changed — this is additive.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AxiosInstance } from "axios";
import {
  CREDENTIAL_SCOPE_NOTE,
  assessResultTrust,
  fingerprintFromHttpClient,
  fingerprintedCacheName,
} from "@bconnect/mcp-core";
import type { ComplianceModule } from "./compliance.js";
import { readCacheFileSync, writeCacheFileSync } from "./secure-disk-cache.js";
import { getScanRecency, summarizeScanRecency, type ScanRecencyIndex } from "./scan-recency.js";
import {
  BUDGET_ENV,
  startTimeBudget,
  timeBudgetReason,
  walkWithin,
  type TimeBudget,
} from "./time-budget.js";

interface LibraryEntry {
  cveId: string;
  cvssScore: number | null;
  severity: string | null;
}

interface CachedLibrary {
  byId: Map<string, LibraryEntry>;
  byCve: Map<string, LibraryEntry>;
  fetchedAt: number;
  size: number;
  /**
   * The envelope's own `totalItems` at fetch time — what the API said exists,
   * as opposed to what was absorbed (P0-NEW). Recorded in the disk cache and
   * re-validated on read: a cache whose size is below its own recorded total
   * is a truncated fetch persisted as fact and must be discarded, not served.
   * Null when the envelope omitted the field.
   */
  expectedTotal: number | null;
}

/**
 * The in-memory library, and the TENANT it belongs to.
 *
 * Keeping this at module scope is deliberate — it caches immutable fetched
 * DATA, which is what module scope is for, and a fresh client per tool call
 * means anything held on the client would never survive. But "immutable" is not
 * "tenant-neutral", and an earlier version of this comment argued only the
 * first half.
 *
 * This cache is checked BEFORE the disk cache, and the disk path is
 * provenance-fingerprinted per call precisely so a process whose environment is
 * re-read partitions to the new tenant (see `diskCachePath` and the H2 note).
 * An unkeyed memory cache in front of it silently undoes that: within the TTL
 * tenant Y is served tenant X's library, whose entry ids are per-server — so
 * every lookup misses, everything scores unscored, `aboveThreshold` collapses
 * toward 0, and `resultTrustworthy` stays true. That is the same false
 * all-clear this module exists to prevent, reached by a different door.
 *
 * So the key is the fingerprinted cache path itself: same computation as the
 * disk cache, same partition, one source of truth.
 */
let libraryCache: CachedLibrary | null = null;
let libraryCacheKey: string | null = null;

/** The library is effectively static; refresh hourly. */
const LIBRARY_TTL_MS = 60 * 60 * 1000;
const PAGE_SIZE = 1000;

/**
 * Pages fetched at once after page 0 (finding PER-14).
 *
 * The library is ~37.5k rows at PageSize 1000, so a cold load is ~38 requests.
 * They were issued strictly serially even though `totalPages` is known the
 * moment page 0 returns and every remaining page is always needed — there is no
 * early exit to preserve. Measured live: 3,085 ms cold versus 98 ms warm, so
 * essentially the entire cold path was this loop. The hourly TTL plus stdio
 * process recycling means real callers hit it regularly.
 *
 * 6 is deliberately modest. This is a shared bMS instance and the win is
 * already most of the way there at that width; the point is to stop paying 38
 * sequential round trips, not to saturate the server. Paired with the
 * keep-alive agent in BConnectClientBase the pages now share sockets too.
 */
const PAGE_CONCURRENCY = 6;

/**
 * Ceiling on library pages walked. The CVE library is a vendor-published
 * catalogue, not estate data — it is the same size for a 20-endpoint customer
 * and a 20,000-endpoint one. Measured at 37,571 rows (~38 pages); 200 leaves an
 * order of magnitude of headroom while still bounding a runaway `totalPages`.
 * The previous loop had no bound at all.
 */
const MAX_LIBRARY_PAGES = 200;

/**
 * Ceiling on DETECTION pages walked, which is a different quantity entirely and
 * used to share the constant above.
 *
 * Detections scale with the estate, not with the catalogue: they are (endpoints
 * x vulnerable products installed). The reference measurement is 2,531
 * detections across 21 scanned endpoints — ~120 per endpoint — so a
 * 20,000-endpoint estate at the same density is ~2.4M rows, or ~2,400 pages.
 * A ceiling reasoned from the library (200 pages = 200,000 rows) silently cut
 * such an estate off at 8% and called it a total.
 *
 * 2,000 pages is not a promise to issue 2,000 requests. It is the runaway
 * guard; the operative stop on a large estate is the call's time budget, which
 * reports itself. The reason this number can be large at all is that the rows
 * are folded into aggregates inside the page callback and never accumulated —
 * memory here is O(endpoints), not O(detections).
 */
const MAX_DETECTION_PAGES = 2_000;

// Disk cache. An in-process cache alone is not enough: MCP hosts do not
// guarantee the server process survives between tool calls, and measured
// against Claude Desktop it did not — every call paid the full ~5s library
// fetch while the same code hit a 64ms in-process cache when driven from one
// long-lived client. Persisting to disk makes the second call fast regardless
// of who owns the process lifecycle.
//
// The path is fixed and shared, so it is read and written through
// `secure-disk-cache.ts` (finding SEC-5): owner-only 0700/0600, and a file that
// is a symlink, not ours, or group/world-writable is refused rather than
// parsed. The consequence of trusting a planted one is spelled out in the
// `LibraryLoad` comment below — an empty library reads as a clean estate.
const CACHE_DIR = join(tmpdir(), "bconnect-mcp");
/**
 * H2 — the cache file is per-TENANT, not shared.
 *
 * secure-disk-cache closes the cross-USER case. It cannot close this one:
 * two MCP configurations under ONE OS user, pointing at two different bMS
 * servers, resolved this same path and read each other's vulnerability library.
 * No permission check fires, because the same user legitimately owns both.
 *
 * A function, not a constant: the fingerprint is read per call so a process
 * whose environment is re-read partitions to the new tenant instead of
 * continuing to serve the previous one's data.
 */
function diskCachePath(fingerprint: string): string {
  return join(CACHE_DIR, fingerprintedCacheName("vulnerability-library.json", fingerprint));
}

function readDiskCache(tenantKey: string, fingerprint: string): CachedLibrary | null {
  try {
    const text = readCacheFileSync(CACHE_DIR, tenantKey);
    if (text === null) {return null;}
    const raw = JSON.parse(text) as {
      provenance?: string;
      fetchedAt: number;
      entries: Array<[string, LibraryEntry]>;
      cveEntries: Array<[string, LibraryEntry]>;
      expectedTotal?: number | null;
    };
    if (Date.now() - raw.fetchedAt >= LIBRARY_TTL_MS) {return null;}
    // ── Provenance, re-checked rather than assumed ──────────────────────
    // The fingerprint is in the FILENAME, which is a single point of failure:
    // if two configurations ever resolve the same name, the reader has no
    // second opinion. Recording it in the payload gives it one.
    //
    // Be precise about what that buys, because the first version of this
    // comment overclaimed and a review took it apart:
    //   - It catches ACCIDENTAL collision — a future change to the hash
    //     inputs or to FINGERPRINT_LENGTH silently re-pointing existing files
    //     at a different tenant. That is the real risk and why this exists.
    //   - It does NOT heal the pre-2026-08-14 env-fingerprinted files. Under
    //     the client fingerprint those resolve a DIFFERENT filename, so this
    //     build never opens them; they were orphaned by the fingerprint change
    //     itself. The only files this check actually rejects in the wild are
    //     single-tenant ones whose data was correct — a one-off refetch.
    //   - It is NOT a defence against a poisoning attacker. The expected value
    //     is printed in the filename, so anyone able to plant a file can read
    //     it off a directory listing and write it into the payload. Ownership
    //     and mode are what defend that, in secure-disk-cache.ts.
    //
    // A file recording NO provenance is discarded rather than trusted:
    // 'nothing recorded' cannot read as 'nothing wrong'. Note the refetch is
    // once-only ONLY where the writer persists; on a truncated or short-served
    // estate the writer bails, nothing replaces the file, and every call pays
    // the walk again. That is pre-existing, and it is why the cost claim in
    // the original commit message was wrong.
    if (raw.provenance !== fingerprint) {
      return null;
    }
    // Validate on read, not only on write (P0-NEW). A pre-fix build persisted
    // a 3-entry library on an estate whose API reported totalItems=37571, and
    // this function then served it as fact for the whole TTL — downstream, a
    // truncated library is indistinguishable from a clean estate. A cache
    // written by a fixed build always records the total it was checked
    // against (`null` only when the envelope genuinely omitted totalItems), so:
    //   - field absent or malformed → legacy/pre-fix format that was never
    //     completeness-checked; untrusted, refetch once and rewrite, which is
    //     what lets an already-poisoned cache in the wild self-heal;
    //   - size below its own recorded total → poisoned; discard and refetch.
    const expectedTotal = raw.expectedTotal;
    if (expectedTotal !== null && typeof expectedTotal !== "number") {return null;}
    if (typeof expectedTotal === "number" && raw.entries.length < expectedTotal) {return null;}
    return {
      byId: new Map(raw.entries),
      byCve: new Map(raw.cveEntries),
      fetchedAt: raw.fetchedAt,
      size: raw.entries.length,
      expectedTotal: expectedTotal ?? null,
    };
  } catch {
    return null; // absent, stale or unreadable — just refetch
  }
}

function writeDiskCache(c: CachedLibrary, tenantKey: string, fingerprint: string): void {
  writeCacheFileSync(
    CACHE_DIR,
    tenantKey,
    JSON.stringify({
      // Whose estate this is, so a reader need not trust the filename alone.
      provenance: fingerprint,
      fetchedAt: c.fetchedAt,
      entries: [...c.byId],
      cveEntries: [...c.byCve],
      // What the API said existed when this copy was fetched, so readDiskCache
      // can re-check completeness on every read (P0-NEW).
      expectedTotal: c.expectedTotal,
    })
  );
}

/**
 * One library load, and everything the CALLER needs to know about it.
 *
 * ── Why `error` exists at all ───────────────────────────────────────────────
 * It is set when a load produced nothing usable — the fetch threw,
 * `Vulnerabilities` answered HTTP 200 with an empty envelope, or (P0-NEW) the
 * walk absorbed fewer rows than the envelope's own `totalItems` said exist or
 * could not cover `totalPages`. An incomplete library is the same hazard as an
 * empty one, only quieter: reproduced live 2026-08-02, a 3-entry fetch of a
 * 37,571-row library was cached as fact and `get_unpatched_endpoints` then
 * answered "nothing needs patching" with `resultTrustworthy: true`.
 *
 * This is not defensive padding. Reproduced live 2026-08-01 (finding
 * B10): `GET /compliance/v2.0/Vulnerabilities` stalled for exactly ~30 s at
 * every PageSize from 1 to 1000, then returned `200 {"totalItems":0,"data":[]}`
 * — a well-formed *success* saying the CVE library is empty, on a system whose
 * `DetectedVulnerabilities` returned 2,531 rows in 42 ms. With no library, every
 * detection scores as unscored, and this tool's honest arithmetic then reports
 * `aboveThreshold: 0` — "no endpoint exceeds CVSS 7", which reads as a clean
 * estate and is the single most dangerous wrong answer this tool can give.
 *
 * So an empty library is treated as an outage, never as data: it is not written
 * to the disk cache (that would poison the next hour of callers), and it is
 * reported loudly in the response.
 *
 * ── Why this is returned rather than parked in a module variable ────────────
 * `error` and `fromCache` used to be module-scope `let`s, reset on the first
 * statement of this function and read at the very end of `analyzeExposure` —
 * with an entire detections walk in between. Two calls in one process share
 * that, and the interleaving is not theoretical: a second call entering here
 * while the first is still walking detections reset a flag the first had
 * already set, and the first then published `libraryUnavailable: null`,
 * `resultTrustworthy: true` and `aboveThreshold: 0`. An empty library scores
 * nothing, so that is the false all-clear this file exists to prevent —
 * reproduced in `__tests__/exposure-concurrency.test.ts`.
 *
 * Both affected tools are cases in one switch in one process, the MCP SDK
 * dispatches `tools/call` without awaiting, and the gateway builds a server per
 * request inside a single Node process. Nothing serialises them.
 *
 * `libraryCache` below stays module-scope deliberately: it is a cache of
 * immutable fetched DATA, which is what module scope is for. What must never
 * live there is a fact about ONE call.
 */
interface LibraryLoad {
  library: CachedLibrary;
  /** Why the library is unusable, or null. Per call — never shared. */
  error: string | null;
  fromCache: boolean;
}

async function loadLibrary(
  compliance: ComplianceModule,
  force = false,
  budget: TimeBudget = startTimeBudget()
): Promise<LibraryLoad> {
  let error: string | null = null;
  const fingerprint = fingerprintFromHttpClient(compliance.getHttpClient());
  const tenantKey = diskCachePath(fingerprint);
  if (!force && libraryCache && libraryCacheKey === tenantKey && Date.now() - libraryCache.fetchedAt < LIBRARY_TTL_MS) {
    return { library: libraryCache, error: null, fromCache: true };
  }
  if (!force) {
    const fromDisk = readDiskCache(tenantKey, fingerprint);
    if (fromDisk) {
      libraryCache = fromDisk;
      libraryCacheKey = tenantKey;
      return { library: fromDisk, error: null, fromCache: true };
    }
  }

  const byId = new Map<string, LibraryEntry>();
  const byCve = new Map<string, LibraryEntry>();

  const absorb = (rows: unknown[]): void => {
    for (const r of rows as Array<Record<string, unknown>>) {
      const entry: LibraryEntry = {
        cveId: String(r.cveId ?? ""),
        cvssScore: typeof r.cvssScore === "number" ? r.cvssScore : null,
        severity: r.severity == null ? null : String(r.severity),
      };
      if (r.id) {byId.set(String(r.id).toLowerCase(), entry);}
      if (entry.cveId) {byCve.set(entry.cveId, entry);}
    }
  };

  // The envelope's own `totalItems` — the API's statement of how many rows
  // exist, taken from page 0 (the authority; it is fetched alone before the
  // fan-out, so there is no write race). Asserted against `byId.size` below:
  // an exact check, not a heuristic threshold (P0-NEW).
  let expectedTotal: number | null = null;
  // Set when the walk could not cover `totalPages` — a partial library must be
  // treated as an outage, never persisted as fact (P0-NEW).
  let coverageIncomplete: string | null = null;

  try {
    // Pages are absorbed inside `fetchPage` and `items: []` is handed back, so
    // paginateAll walks the pages without also accumulating all ~37.5k raw rows
    // (~31 MB) into an array we would immediately throw away — the two Maps
    // above are the real output. It also keeps the pre-existing error
    // semantics: if a page fails part-way through, whatever was already
    // absorbed stays absorbed, exactly as the serial loop behaved — the
    // difference being that up to `PAGE_CONCURRENCY - 1` sibling requests are
    // still in flight when the rejection surfaces, and their rows land in the
    // maps a moment after the error path has read `byId.size`. Only ever more
    // real data, never less, and never an empty library treated as fact.
    const walk = await walkWithin<never>(
      budget,
      async (page) => {
        const res = await compliance.getAllVulnerabilities({ PageSize: PAGE_SIZE, Page: page });
        if (page === 0 && typeof res.totalItems === "number") {expectedTotal = res.totalItems;}
        absorb(res.data ?? []);
        // The envelope types totalPages as nullable; paginateAll reads absent
        // as "this is the last page", which is what `?? 1` meant before.
        return { items: [], totalPages: res.totalPages ?? undefined };
      },
      { maxPages: MAX_LIBRARY_PAGES, concurrency: PAGE_CONCURRENCY }
    );
    if (walk.truncated || walk.outOfTime || walk.pagesFetched < walk.totalPages) {
      console.error(
        `[bconnect-compliance] vulnerability library truncated at ${walk.pagesFetched} of ` +
          `${walk.totalPages} pages (MAX_LIBRARY_PAGES=${MAX_LIBRARY_PAGES}, ` +
          `outOfTime=${walk.outOfTime}); CVSS scores are incomplete`
      );
      // P0-NEW: this used to be stderr-only, and control then fell through to
      // the cache assignment below — a partial library persisted as fact. The
      // clock is the second way to get there and lands in the same place: a
      // half-loaded library is an outage whatever stopped it, and in particular
      // is never written to disk to be served for the rest of the TTL.
      coverageIncomplete =
        timeBudgetReason("The vulnerability library walk", walk, budget) ??
        `The vulnerability library walk covered only ${walk.pagesFetched} of ${walk.totalPages} ` +
          `pages (MAX_LIBRARY_PAGES=${MAX_LIBRARY_PAGES}), so the library is incomplete and any ` +
          `ranking built from it would undercount.`;
    }
  } catch (err) {
    // A stalled/failed library fetch must not fail the whole query — the
    // detection side is still worth reporting, and a caller told "the API
    // errored" can act, whereas one told "0 vulnerabilities" cannot.
    error = err instanceof Error ? err.message : String(err);
  }

  const loaded: CachedLibrary = { byId, byCve, fetchedAt: Date.now(), size: byId.size, expectedTotal };

  if (byId.size === 0) {
    if (!error) {
      // No internal identifier in emitted text: a caller has no document to
      // resolve it against, and a citation they cannot follow reads as a leaked
      // note rather than as evidence. The finding lives in the comment above.
      error =
        "GET /compliance/v2.0/Vulnerabilities returned HTTP 200 with an empty page set. " +
        "The CVE library cannot be empty on a system that reports detections, so this is an " +
        "API-side failure reported as success, not a clean estate.";
    }
    // Neither cached in memory nor written to disk: an outage must not be
    // remembered as a fact for the next hour.
    return { library: loaded, error, fromCache: false };
  }

  // The floor above zero (P0-NEW). B10 hardened the empty case and left the
  // truncated one wide open: the guard above is `=== 0`, so a 3-entry fetch of
  // a 37,571-row library was accepted as fact, written to disk, and served for
  // the whole TTL — reproduced live 2026-08-02, where get_unpatched_endpoints
  // answered "nothing needs patching" with `resultTrustworthy: true` on an
  // estate with 1,522 detections above CVSS 7. The check is exact — the
  // envelope's own totalItems against the rows actually absorbed — because a
  // magic minimum would break a genuinely small library and still be a guess.
  if (!error && coverageIncomplete) {
    error = coverageIncomplete;
  }
  if (!error && expectedTotal !== null && byId.size < expectedTotal) {
    error =
      `GET /compliance/v2.0/Vulnerabilities reported totalItems=${expectedTotal} but only ` +
      `${byId.size} row(s) were absorbed. The CVE library is incomplete — a truncated fetch ` +
      `scores only the CVEs it happened to include, which reads as a clean estate — so it is ` +
      `treated as an API-side outage, not as data.`;
  }
  if (error) {
    // Exactly the empty-case rule: an incomplete library is an outage, never a
    // fact — not held at module scope, not written to disk (either would
    // poison every caller for the TTL, and the disk copy would outlive this
    // process). What WAS absorbed is still returned so the detection side can
    // score what it can, loudly flagged as untrustworthy via the returned error.
    return { library: loaded, error, fromCache: false };
  }

  libraryCache = loaded;
  libraryCacheKey = tenantKey;
  writeDiskCache(libraryCache, tenantKey, fingerprint);
  return { library: libraryCache, error: null, fromCache: false };
}

/**
 * Why `DetectionFold.incomplete` exists, and why it is NOT an exact check.
 *
 * It is set when a detections walk could not cover every page (P0-NEW).
 * Mirrors the library error: the truncation used to be stderr-only and then
 * fell through, so the undercount was presented as the estate total with
 * `resultTrustworthy` still true — the same defect shape as the library walk,
 * minus the cache (there is nothing to poison here, only the current answer).
 *
 * Deliberately NOT an exact totalItems check like the library's: detections
 * are live-mutating data, so page 0's totalItems can legitimately drift from
 * the rows collected while the walk is in flight, and an exact assertion would
 * cry outage on a healthy, busy estate. Coverage of `totalPages` is the hard
 * fact; a mid-walk fetch failure already rejects out of this function.
 *
 * That decision now has a measured boundary (2026-08-12). This estate carries
 * a STABLE count-vs-stream gap on this route — totalItems 2,454 against 1,954
 * servable rows across repeated full sweeps — so an exact check would read
 * INCOMPLETE forever here, which is the operator-trains-to-ignore-it failure.
 * The partial case therefore stays unflagged (both numbers are published side
 * by side as detectionsInEstate / detectionsExamined, and the gap is an open
 * question for baramundi). The ZERO-rows case is different — no drift covers
 * 0 of totalItems — and is asserted below (finding B10, also measured live:
 * this API has served 200s with an empty data[] under an intact header).
 */

/** What the detections walk covered, and what it added up to. */
export interface DetectionAggregate {
  /** Detection rows actually read and folded in. */
  rowsExamined: number;
  /**
   * `totalItems` as page 0 reported it: the server's own statement of how many
   * detections exist. It stays exact when the walk is bounded, and it is
   * therefore the only detection figure a partial walk may publish as a total.
   * Null when the envelope omitted the field.
   */
  totalItems: number | null;
  /** Rows surviving the ignored / endpointName filters. */
  afterFilters: number;
  /** Rows at or above the CVSS threshold. */
  aboveThreshold: number;
  /** Distinct CVE ids at or above the threshold. */
  distinctCvesAboveThreshold: number;
}

/** Everything the fold accumulates, so the raw rows never have to be kept. */
interface DetectionFold {
  aggregate: DetectionAggregate;
  /** Why the walk undercounts, or null. Per call — never module scope. */
  incomplete: string | null;
  byEndpoint: Map<string, EndpointExposure>;
  severityMix: Record<string, number>;
  unscored: number;
  /** Newest `detected` per endpoint, keyed by display name. */
  newest: Map<string, { at: string; endpointId: string | null }>;
}

/**
 * Walk `DetectedVulnerabilities` and reduce it in flight.
 *
 * ── Why this does not return rows ───────────────────────────────────────────
 * It used to. `loadDetected` accumulated every page into one array and handed
 * it back whole, bounded only by the CVE library's page ceiling — up to 200,000
 * row objects resident in a Node process the MCP host spawned with a default
 * heap, on the tool an operator reaches for during an incident. That ceiling was
 * reasoned from the library's size, and detections do not scale like the
 * library: they scale with the estate. Nothing downstream ever needed the rows.
 * Everything downstream needs is a per-endpoint aggregate, a severity histogram
 * and one timestamp per endpoint, all of which are O(endpoints).
 *
 * So the fold happens inside the page callback and `items: []` goes back to the
 * walker, exactly as the library walk beside it already did.
 *
 * ── Why the library is awaited in here ──────────────────────────────────────
 * Scoring a row needs the library, and folding means scoring at read time. The
 * library load is still started first and runs concurrently: the `await` sits
 * AFTER this page's HTTP request has been issued, so the two overlap as they did
 * when they were a `Promise.all`, and only the first page ever waits.
 */
async function reduceDetections(
  compliance: ComplianceModule,
  libraryPromise: Promise<LibraryLoad>,
  opts: { minCvss: number; includeIgnored: boolean; endpointName?: string },
  budget: TimeBudget
): Promise<DetectionFold> {
  // Per call, never module scope — see LibraryLoad above for what sharing it cost.
  let incomplete: string | null = null;

  const byEndpoint = new Map<string, EndpointExposure>();
  const severityMix: Record<string, number> = {};
  const distinctAbove = new Set<string>();
  const newest = new Map<string, { at: string; endpointId: string | null }>();
  let unscored = 0;
  let rowsExamined = 0;
  let afterFilters = 0;
  let aboveThreshold = 0;
  let totalItems: number | null = null;

  const fold = (rows: Array<Record<string, unknown>>, library: CachedLibrary): void => {
    for (const d of rows) {
      rowsExamined++;

      // Newest `detected` per endpoint, taken BEFORE the filters. Scan age is a
      // property of the endpoint, not of the subset the caller asked about, and
      // the previous shape passed the unfiltered rows to `getScanRecency` for
      // exactly that reason.
      const rawName = d.endpointName;
      const keyName = String(rawName ?? "");
      const at = d.detected == null ? null : String(d.detected);
      if (keyName && at) {
        const cur = newest.get(keyName);
        if (!cur || Date.parse(at) > Date.parse(cur.at)) {
          newest.set(keyName, { at, endpointId: d.endpointId == null ? null : String(d.endpointId) });
        }
      }

      if (!opts.includeIgnored && d.ignored === true) {continue;}
      if (opts.endpointName && String(d.endpointName) !== opts.endpointName) {continue;}
      afterFilters++;

      const hit =
        library.byId.get(String(d.vulnerabilityId ?? "").toLowerCase()) ??
        library.byCve.get(String(d.cveId ?? ""));
      if (!hit) {unscored++;}

      const bucket = hit?.severity ?? "unscored";
      severityMix[bucket] = (severityMix[bucket] ?? 0) + 1;

      const cvss = hit?.cvssScore ?? null;
      if (cvss === null || cvss < opts.minCvss) {continue;}

      aboveThreshold++;
      const cveId = String(d.cveId ?? "");
      distinctAbove.add(cveId);
      const endpointName = String(rawName ?? "(unknown)");
      const e = byEndpoint.get(endpointName) ?? { count: 0, max: 0, worst: new Set<string>() };
      e.count++;
      e.max = Math.max(e.max, cvss);
      if (cvss >= 9) {e.worst.add(cveId);}
      byEndpoint.set(endpointName, e);
    }
  };

  // Same fan-out as the library above (finding PER-14): every page is always
  // needed and totalPages is known after page 0. Unlike the library this is not
  // disk-cached and deliberately so — `lastSeen`-grade freshness is the product
  // here, and a cached detection set would answer an incident question with
  // yesterday's scan.
  const walk = await walkWithin<never>(
    budget,
    async (page) => {
      const res = await compliance.getAllDetectedVulnerabilities({ PageSize: PAGE_SIZE, Page: page });
      if (page === 0 && typeof res.totalItems === "number") {totalItems = res.totalItems;}
      fold((res.data ?? []) as unknown as Array<Record<string, unknown>>, (await libraryPromise).library);
      return { items: [], totalPages: res.totalPages ?? undefined };
    },
    { maxPages: MAX_DETECTION_PAGES, concurrency: PAGE_CONCURRENCY }
  );

  if (walk.truncated || walk.outOfTime || walk.pagesFetched < walk.totalPages) {
    console.error(
      `[bconnect-compliance] detected-vulnerability walk stopped at ${walk.pagesFetched} of ` +
        `${walk.totalPages} pages (MAX_DETECTION_PAGES=${MAX_DETECTION_PAGES}, ` +
        `outOfTime=${walk.outOfTime}); the exposure counts undercount`
    );
    incomplete =
      timeBudgetReason("The detected-vulnerability walk", walk, budget) ??
      `The detected-vulnerability walk covered only ${walk.pagesFetched} of ${walk.totalPages} ` +
        `pages (MAX_DETECTION_PAGES=${MAX_DETECTION_PAGES}), so every detection-derived count in ` +
        `this response is a floor rather than an estate total.`;
  } else if (rowsExamined === 0 && typeof totalItems === "number" && totalItems > 0) {
    // Finding B10's exact scenario, measured live 2026-08-12: the API can
    // answer 200 with an empty data[] under an intact header. A walk that
    // covered every declared page while absorbing ZERO of the detections the
    // server itself counts is not a clean estate — and unlike the partial case
    // below, no drift rationale covers 0 of totalItems.
    incomplete =
      `The detected-vulnerability walk covered every page yet absorbed 0 of the ${totalItems} ` +
      `detection(s) the server itself reports — an empty page under an intact header, which this ` +
      `API has served live. An empty or short queue from this state means the read failed, not ` +
      `that nothing needs patching. Retry; if it persists, the server's own count disagrees with ` +
      `what it serves.`;
  }

  return {
    incomplete,
    aggregate: {
      rowsExamined,
      totalItems,
      afterFilters,
      aboveThreshold,
      distinctCvesAboveThreshold: distinctAbove.size,
    },
    byEndpoint,
    severityMix,
    unscored,
    newest,
  };
}

export interface ExposureOptions {
  minCvss?: number;
  includeIgnored?: boolean;
  topEndpoints?: number;
  endpointName?: string;
  refreshLibrary?: boolean;
  /** Annotate each ranked endpoint with its scan date (default: true — D17). */
  includeScanAge?: boolean;
  /** Age beyond which a scan is called stale in the summary (default: 30 days). */
  staleAfterDays?: number;
}

/** Per-endpoint aggregate of detections at or above the CVSS threshold. */
export interface EndpointExposure {
  count: number;
  max: number;
  worst: Set<string>;
}

export interface ExposureAnalysis {
  library: CachedLibrary;
  /** Whether this call served the library from cache. Per call — it used to be a
   *  module variable, so a concurrent load flipped it under a finished call. */
  libraryFromCache: boolean;
  /**
   * One synthetic row per endpoint carrying that endpoint's NEWEST `detected`
   * timestamp and its id — the only thing `scan-recency.ts` reads out of the
   * detection rows, in the shape it already reads them in. This is what lets the
   * raw rows be discarded: it is O(endpoints) where they were O(detections).
   */
  newestDetectionPerEndpoint: Array<Record<string, unknown>>;
  /** What the detections walk covered, and what it added up to. */
  detections: DetectionAggregate;
  byEndpoint: Map<string, EndpointExposure>;
  severityMix: Record<string, number>;
  unscored: number;
  /** Non-null when the CVE library could not be loaded — see `loadLibrary`. */
  libraryUnavailable: string | null;
  /** Non-null when the detections walk could not cover every page (P0-NEW). */
  detectionsIncomplete: string | null;
}

/**
 * The join itself, separated from its presentation so composite tools that need
 * the same numbers (`get_unpatched_endpoints`) reuse it instead of re-deriving
 * it — and, more importantly, reuse the same single walk of detections rather
 * than paying for them twice.
 *
 * `budget` is passed in by a composite that owns the whole call's clock, so the
 * library walk, the detections walk and the caller's own walks all draw down one
 * deadline instead of three.
 */
export async function analyzeExposure(
  compliance: ComplianceModule,
  opts: Pick<ExposureOptions, "minCvss" | "includeIgnored" | "endpointName" | "refreshLibrary"> = {},
  budget: TimeBudget = startTimeBudget()
): Promise<ExposureAnalysis> {
  const minCvss = opts.minCvss ?? 7;
  const includeIgnored = opts.includeIgnored ?? false;

  const libraryPromise = loadLibrary(compliance, opts.refreshLibrary, budget);
  // The detections fold awaits this promise, so a library rejection still
  // surfaces to the caller. This handler exists only so that a detections-side
  // failure reaching the caller FIRST cannot leave the library rejection
  // unobserved — the `Promise.all` this replaced attached one implicitly.
  libraryPromise.catch(() => undefined);

  const reduced = await reduceDetections(
    compliance,
    libraryPromise,
    { minCvss, includeIgnored, endpointName: opts.endpointName },
    budget
  );
  const loadedLibrary = await libraryPromise;
  const library = loadedLibrary.library;

  return {
    library,
    libraryFromCache: loadedLibrary.fromCache,
    newestDetectionPerEndpoint: [...reduced.newest].map(([endpointName, v]) => ({
      endpointName,
      detected: v.at,
      endpointId: v.endpointId,
    })),
    detections: reduced.aggregate,
    byEndpoint: reduced.byEndpoint,
    severityMix: reduced.severityMix,
    unscored: reduced.unscored,
    libraryUnavailable: loadedLibrary.error,
    detectionsIncomplete: reduced.incomplete,
  };
}

export async function getVulnerabilityExposure(
  compliance: ComplianceModule,
  opts: ExposureOptions = {},
  /**
   * Raw axios client, for the cross-domain part of the scan-age lookup. The
   * compliance module wraps `/compliance/v2.0` only, and the scan date lives in
   * `/jobs/v2.0` — the whole reason D17 is expensive to answer by hand. Optional
   * so existing callers and the unit tests keep working unchanged; scan age is
   * simply omitted when it is absent.
   */
  http?: AxiosInstance
): Promise<Record<string, unknown>> {
  const minCvss = opts.minCvss ?? 7;
  const includeIgnored = opts.includeIgnored ?? false;
  const topEndpoints = opts.topEndpoints ?? 20;
  const staleAfterDays = opts.staleAfterDays ?? 30;
  const wantScanAge = (opts.includeScanAge ?? true) && http != null;

  // One clock for the whole call, drawn down by both walks below and by the
  // job-history walk inside the scan-age lookup.
  const budget = startTimeBudget();
  const startedAt = budget.startedAt;
  const {
    library,
    libraryFromCache,
    newestDetectionPerEndpoint,
    detections,
    byEndpoint,
    severityMix,
    unscored,
    libraryUnavailable,
    detectionsIncomplete,
  } = await analyzeExposure(compliance, opts, budget);

  // Scan age (D17). Derived from the detections already in hand plus one cached
  // job-history request — never a per-endpoint lookup. See scan-recency.ts.
  let scanIndex: ScanRecencyIndex | null = null;
  let scanError: string | null = null;
  if (wantScanAge) {
    try {
      scanIndex = await getScanRecency(http as AxiosInstance, newestDetectionPerEndpoint, { budget });
    } catch (err) {
      // Scan age is an enrichment. A jobs-API failure — or an API key without
      // jobs scope — must degrade the answer, never fail the query.
      scanError = err instanceof Error ? err.message : String(err);
    }
  }

  const ranked = [...byEndpoint.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].max - a[1].max)
    .slice(0, topEndpoints)
    .map(([endpointName, v]) => {
      const base = {
        endpointName,
        vulnerabilitiesAboveThreshold: v.count,
        highestCvss: v.max,
        exampleCriticalCves: [...v.worst].slice(0, 3),
      };
      const s = scanIndex?.byEndpoint.get(endpointName);
      if (!s) {return base;}
      return {
        ...base,
        // Additive. The count above is only meaningful as of this date.
        lastScan: s.lastScan,
        scanAgeDays: s.scanAgeDays,
        scanSource: s.scanSource,
        scanInProgress: s.scanInProgress,
        scanIsStale: s.scanAgeDays == null ? null : s.scanAgeDays > staleAfterDays,
        scanNote: s.note,
      };
    });

  return {
    // State what was actually applied, rather than leaving the caller to assume
    // (upstream §12 — self-describing responses).
    query: {
      minCvss,
      includeIgnored,
      endpointName: opts.endpointName ?? null,
      topEndpoints,
    },
    totals: {
      // The server's own `totalItems`, not the length of what was read. A
      // bounded or time-limited walk still reports the estate's real detection
      // count here, and `detectionsExamined` beside it says how much of that
      // was actually folded in — the pair a caller needs to tell a small estate
      // from a short read.
      detectedVulnerabilities: detections.totalItems ?? detections.rowsExamined,
      detectionsExamined: detections.rowsExamined,
      afterIgnoredFilter: detections.afterFilters,
      aboveThreshold: detections.aboveThreshold,
      distinctCvesAboveThreshold: detections.distinctCvesAboveThreshold,
      endpointsAffected: byEndpoint.size,
      unscored,
    },
    severityMix,
    // D17. Present whenever scan age could be computed; the ranking above is
    // only comparable across endpoints whose scans are of similar age, and on
    // most estates they are not.
    scanRecency: scanIndex ? summarizeScanRecency(scanIndex, staleAfterDays) : null,
    endpoints: ranked,
    meta: {
      // An estate-wide aggregate, so it owes the scope disclosure. See
      // result-trust.ts. Measured under a scoped key: detectedVulnerabilities
      // 2454 -> 1544, Critical 142 -> 105, endpointsAffected 17 -> 9, both
      // responses `resultTrustworthy: true`.
      credentialScope: CREDENTIAL_SCOPE_NOTE,
      libraryEntries: library.size,
      // Report the hit directly. Age alone was misleading: on a cold call the
      // library is fetched during the call, so its age rounds to 0 seconds and
      // looks identical to a fresh cache hit.
      libraryFromCache,
      libraryAgeSeconds: Math.round((Date.now() - library.fetchedAt) / 1000),
      scanAge: scanIndex
        ? {
            historyFromCache: scanIndex.meta.fromCache,
            historyLoadMs: scanIndex.meta.loadMs,
            historyCacheAgeSeconds: scanIndex.meta.cacheAgeSeconds,
            jobInstancesExamined: scanIndex.meta.instancesExamined,
            historyPagesFetched: scanIndex.meta.pagesFetched,
            // H1 — scan-recency's own rule: never report pagesFetched (or a
            // row count) without what it was measured against. This block
            // violated it while its sibling in unpatched.ts complied.
            historyTotalPages: scanIndex.meta.historyTotalPages,
            historyTotalItems: scanIndex.meta.historyTotalItems,
            historyTruncated: scanIndex.meta.historyTruncated,
            historyIncomplete: scanIndex.meta.historyIncomplete,
            historyBytes: scanIndex.meta.historyBytes,
          }
        : null,
      scanAgeUnavailable: wantScanAge && !scanIndex ? (scanError ?? "unknown") : null,
      // What the walks were allowed, and what they used of it. Reported whether
      // or not the budget bit, so a caller comparing two runs can see the call
      // approaching its ceiling before it starts truncating.
      timeBudget: {
        budgetMs: budget.totalMs,
        elapsedMs: budget.elapsedMs(),
        envVar: BUDGET_ENV,
      },
      // Never let an API outage read as good news. Without the CVE library every
      // detection is unscored and the counts above collapse to zero, which is
      // indistinguishable from a clean estate unless we say so. Finding B10;
      // the same field now also carries the incomplete-library case (P0-NEW),
      // so "the library was truncated" and "your estate is clean" can never
      // read the same to a caller.
      libraryUnavailable,
      // M4. This was `resultTrustworthy: libraryUnavailable == null && detectionsIncomplete == null`
      // computed by hand — the original of the field, emitting a bare boolean and
      // no reasons, so a caller who saw `false` had to reconstruct why from the
      // prose in `note`. It now goes through the shared contract in
      // `@bconnect/mcp-core`, which also carries
      // `resultTrustworthyReasons`. The two conditions are unchanged; the scan-recency
      // conditions are deliberately NOT folded in here, because unlike
      // `get_unpatched_endpoints` this tool's counts do not depend on scan age —
      // it is reported alongside them as a qualifier and `scanAgeUnavailable`
      // already says when it is missing.
      ...assessResultTrust(libraryUnavailable, detectionsIncomplete),
      elapsedMs: Date.now() - startedAt,
      note: [
        libraryUnavailable
          ? `THE CVE LIBRARY DID NOT LOAD, so no detection could be scored and every count above the ` +
            `threshold is zero for that reason — NOT because nothing was found. ` +
            `${detections.totalItems ?? detections.rowsExamined} detection(s) are reported by this bMS ` +
            `and are unranked. Cause: ${libraryUnavailable}`
          : unscored > 0
            ? `${unscored} detection(s) had no matching library entry and are excluded from the threshold count.`
            : "All detections matched a library entry.",
        // A truncated detections walk is a different failure from a missing
        // library — the scores are right, the totals are short (P0-NEW).
        ...(detectionsIncomplete ? [detectionsIncomplete] : []),
      ].join(" "),
    },
  };
}
