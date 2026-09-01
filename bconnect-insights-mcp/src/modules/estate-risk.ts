/**
 * get_estate_risk_briefing — the cross-module composite.
 *
 * ── Why this server exists at all ───────────────────────────────────────────
 * The thirteen domain servers each composite WITHIN their module:
 * `get_security_posture` (defensecontrol), `get_unpatched_endpoints` and
 * `get_vulnerability_exposure` (compliance), `get_stale_endpoints`
 * (endpoints). None crosses a module, because a server reaches only its own.
 * So "how exposed is this estate?" — the question an administrator actually
 * asks — is assembled by the model from several composites in three servers,
 * and it pays for all of them.
 *
 * Measured, same estate, same day: sizing the estate costs 483 B; assessing
 * security posture costs 46,951-73,899 B. A ~150x spread driven entirely by
 * question shape. `get_fleet_summary` already proved the fix in miniature —
 * 5,891-7,013 B against 25,150-27,186 B of hand-walking.
 *
 * ── The fact that makes this cheap ──────────────────────────────────────────
 * bConnect is ONE API with per-module path prefixes, so a single client reads
 * `/defensecontrol/v2.0/...` and `/compliance/v2.0/...` and `/endpoints/v2.0/...`
 * No cross-package import, no second transport, no coupling of release cycles.
 *
 * ── Degrade per dimension, never fail whole ─────────────────────────────────
 * The rule this file is built around. If compliance is unreachable the
 * briefing still reports encryption and staleness and SAYS which dimension it
 * could not read. A composite that dies because one of four modules is down is
 * strictly worse than four separate calls, because the caller loses the three
 * that were fine. Every dimension reader below returns its failure as data.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────────
 * No writes. No remediation naming specific jobs. No caching. Counts are
 * exact; NAME LISTS are capped and the cap is disclosed, because an uncapped
 * fallback once emitted 14,573 B of names.
 *
 * ── Short-serve vs sample: the trust rule, and why it differs from
 *    patch-readiness ─────────────────────────────────────────────────────────
 * The API was MEASURED (live, 2026-08-12) answering 200 with an intact
 * envelope header over an EMPTY data[], and claiming totals its stream never
 * serves. This module used to hold its own page reader that collapsed that
 * state into "zero rows", which silently removed every warning from the
 * headline while resultTrustworthy stayed true. The rule now:
 *
 *  - SHORT-SERVED (fewer rows than the requested pageSize while totalItems
 *    says more exist; the empty page is the extreme case): trust breaks, the
 *    headline says INCOMPLETE, and the reason carries the row disagreement.
 *  - SAMPLE BY DESIGN (exactly pageSize rows of a larger set): this tool's
 *    documented read model — disclosed in meta.truncated, trust intact.
 *    patch-readiness flags ANY truncation instead, because its counts are
 *    per-endpoint sums that a missing row corrupts; here the sample is
 *    labelled InSample/Examined and never presented as the estate.
 *  - A genuinely empty estate (totalItems 0) is clean, not suspicious.
 */

import {
  CREDENTIAL_SCOPE_NOTE,
  daysSince,
  isFutureBeyondSkew,
  isSentinelDate,
  sanitizeEstateText,
  shortfallReason,
} from "@bconnect/mcp-core";
import { readRows } from "./paged-read.js";

/** The slice of the shared axios client this composite needs. */
export interface HttpLike {
  get(
    path: string,
    config?: { params?: Record<string, unknown>; validateStatus?: () => boolean },
  ): Promise<{ status: number; data: unknown }>;
}

export interface RiskBriefingOptions {
  /** Name lists are capped at this; counts are always exact. */
  maxNamed?: number;
  /** Antivirus definitions older than this many days count as stale. */
  staleDefinitionsAfterDays?: number;
  /** An endpoint not seen for this many days counts as not reporting. */
  staleEndpointAfterDays?: number;
  /** Rows to request per page from each module. */
  pageSize?: number;
  /** Wall-clock budget; a dimension not started by then is reported unread. */
  budgetMs?: number;
  /** Injected in tests. Real callers get Date.now. */
  now?: () => number;
}

const DEFAULTS = {
  maxNamed: 10,
  staleDefinitionsAfterDays: 7,
  staleEndpointAfterDays: 30,
  pageSize: 200,
  budgetMs: 25_000,
};

/** Why a dimension has no data. Never an exception reaching the caller. */
export interface DimensionUnavailable {
  available: false;
  reason: string;
}
type Dimension<T> = (T & { available: true }) | DimensionUnavailable;

const unavailable = (reason: string): DimensionUnavailable => ({ available: false, reason });

/**
 * The shapes below are the tool's PUBLIC contract — what a model receives —
 * so they are named rather than inferred. `explicit-function-return-type` is
 * what forced the issue, and it was right to: an inferred return type on a
 * composite means the payload shape can change without anything saying so.
 */
export interface CappedNames {
  names: string[];
  namedShown?: number;
  namedTotal?: number;
  namedNote?: string;
}

export interface EncryptionFacts {
  endpointsExamined: number;
  endpointsInEstate: number | null;
  systemVolumeProtected: number;
  systemVolumeUnprotected: number;
  noBitLockerVolumeData: number;
  tpmNotEnabled: number;
  unprotectedEndpoints: CappedNames;
}

export interface DefenderFacts {
  endpointsExamined: number;
  active: number;
  inactive: number;
  inactiveEndpoints: CappedNames;
  definitionsStale: number;
  definitionAgeUnknown: number;
  worstDefinitionAgeDays: number | null;
  staleDefinitionEndpoints: Array<{ endpoint: string; definitionAgeDays: number }>;
}

export interface VulnerabilityFacts {
  detectionsInEstate: number | null;
  detectionsExamined: number;
  ignoredInSample: number;
  distinctCvesInSample: number;
  endpointsAffectedInSample: number;
  mostAffectedEndpoints: Array<{ endpoint: string; detections: number }>;
}

export interface ReportingFacts {
  endpointsExamined: number;
  endpointsInEstate: number | null;
  currentlyReporting: number;
  notReporting: number;
  neverSeen: number;
  neverSeenEndpoints: CappedNames;
  /**
   * Endpoints whose lastSeen cannot be turned into an age: a timestamp beyond
   * the clock-skew window (a clock or data fault, stated in the headline) or
   * one that does not parse. NOT counted as reporting — "your clock is wrong"
   * must never read as "seen today".
   */
  ageUnknown: number;
  /** The subset of ageUnknown whose lastSeen sits in the FUTURE beyond skew. */
  futureSeen: number;
  longestSilentDays: number | null;
  notReportingEndpoints: Array<{ endpoint: string; daysSinceSeen: number }>;
}

export interface EstateRiskBriefing {
  query: {
    maxNamed: number;
    staleDefinitionsAfterDays: number;
    staleEndpointAfterDays: number;
    pageSize: number;
  };
  headline: string[];
  encryption: Dimension<EncryptionFacts>;
  defender: Dimension<DefenderFacts>;
  vulnerabilities: Dimension<VulnerabilityFacts>;
  endpoints: Dimension<ReportingFacts>;
  meta: {
    /** The unconditional estate-scope disclosure. See result-trust.ts. */
    credentialScope: string;
    dimensionsRead: number;
    dimensionsTotal: number;
    resultTrustworthy: boolean;
    resultTrustworthyReasons: string[];
    /** Dimensions read as a full page of a larger set — a sample by design. */
    truncated: string[];
    coverage: string;
    note: string;
  };
}

/** A capped name list plus the disclosure that it was capped. */
function capNames(names: string[], maxNamed: number): CappedNames {
  const shown = names.slice(0, maxNamed).map((n) => sanitizeEstateText(n));
  const out: CappedNames = { names: shown };
  if (names.length > shown.length) {
    out.namedShown = shown.length;
    out.namedTotal = names.length;
    out.namedNote =
      `Counts above are exact. This NAME LIST is capped at maxNamed=${maxNamed}, showing ` +
      `${shown.length} of ${names.length}. Raise maxNamed to name more.`;
  }
  return out;
}

/**
 * One page from a module route, read through the SHARED paged reader.
 *
 * This module used to hold its own copy, and the copy was the defect: it
 * collapsed a non-envelope 200 into zero rows, never saw `totalItems`, and so
 * could not tell an empty estate from an outage. `readRows` carries the
 * paid-for lessons (403 is reportable, 404 is not zero, a shape mismatch is
 * not an empty page); this wrapper adds the one judgement specific to a
 * one-page composite — short-serve vs sample, see the module header.
 */
interface DimensionPage {
  rows: Record<string, unknown>[];
  totalItems: number | null;
  /** The row disagreement, when the server underdelivered vs BOTH its own totalItems and the request. */
  shortfall: string | null;
  /** True when the full requested page arrived and more exist: a sample by design. */
  sampled: boolean;
}

async function readDimensionPage(
  http: HttpLike,
  path: string,
  pageSize: number,
  what: string,
): Promise<DimensionPage | DimensionUnavailable> {
  const res = await readRows(http, path, pageSize);
  if (isUnavailable(res)) {return res;}
  const shortServed =
    res.totalItems !== null && res.totalItems > res.rows.length && res.rows.length < pageSize;
  return {
    rows: res.rows,
    totalItems: res.totalItems,
    shortfall: shortServed ? shortfallReason(what, res.rows.length, res.totalItems) : null,
    sampled: !shortServed && res.totalItems !== null && res.totalItems > res.rows.length,
  };
}

const isUnavailable = (v: unknown): v is DimensionUnavailable =>
  typeof v === "object" && v !== null && (v as DimensionUnavailable).available === false;

// ─── Dimension 1: encryption and TPM (defensecontrol/BitLocker) ─────────────

interface Volume {
  isSystemVolume?: boolean;
  bitLockerVolumeData?: { protectionStatus?: string } | null;
}
interface BitLockerRow {
  endpointName?: string;
  tpmData?: { tpmStatus?: string } | null;
  storageMedia?: Array<{ storageVolumes?: Volume[] }>;
}

function summarizeEncryption(page: DimensionPage, o: Required<Pick<RiskBriefingOptions, "maxNamed">>): Dimension<EncryptionFacts> {
  let protectedCount = 0;
  const unprotected: string[] = [];
  let noVolumeData = 0;
  const noTpm: string[] = [];

  for (const raw of page.rows) {
    const e = raw as BitLockerRow;
    const vols = (e.storageMedia ?? []).flatMap((m) => m.storageVolumes ?? []);
    const withBl = vols.filter((v) => v.bitLockerVolumeData);
    // The SYSTEM volume only — never `?? withBl[0]`. That fallback credited a
    // data volume's protection to the machine: probed 2026-08-22, a system
    // volume with no BitLocker data beside a Protected data volume counted as
    // systemVolumeProtected and the headline read "No exposure found".
    // endpoint-briefing.ts refuses the same guess ("no BitLocker data …
    // UNKNOWN, not known-good"). Live rows carry bitLockerVolumeData on the
    // system volume even when Unprotected (WORKSTATION1), so on every shape
    // observed so far this changes nothing; on the unobserved shape it now
    // lands in noBitLockerVolumeData instead of borrowing another volume's
    // status.
    const sys = withBl.find((v) => v.isSystemVolume);
    if (!sys) {noVolumeData++;}
    else if (sys.bitLockerVolumeData?.protectionStatus === "Protected") {protectedCount++;}
    else {unprotected.push(e.endpointName ?? "(unnamed)");}
    if (e.tpmData?.tpmStatus !== "Enabled") {noTpm.push(e.endpointName ?? "(unnamed)");}
  }

  return {
    available: true as const,
    endpointsExamined: page.rows.length,
    endpointsInEstate: page.totalItems,
    systemVolumeProtected: protectedCount,
    systemVolumeUnprotected: unprotected.length,
    noBitLockerVolumeData: noVolumeData,
    tpmNotEnabled: noTpm.length,
    unprotectedEndpoints: capNames(unprotected, o.maxNamed),
  };
}

// ─── Dimension 2: Defender activity and definition age ─────────────────────

interface DefenderRow {
  endpointName?: string;
  isMicrosoftDefenderActive?: boolean;
  microsoftDefenderState?: {
    antivirus?: { isActive?: boolean; definitionCreation?: string; definitionVersion?: string };
  } | null;
}

function summarizeDefender(
  page: DimensionPage,
  o: Required<Pick<RiskBriefingOptions, "maxNamed" | "staleDefinitionsAfterDays">>,
  now: number,
): Dimension<DefenderFacts> {
  let active = 0;
  const inactive: string[] = [];
  let ageUnknown = 0;
  const stale: Array<{ endpoint: string; definitionAgeDays: number }> = [];

  for (const raw of page.rows) {
    const e = raw as DefenderRow;
    const name = e.endpointName ?? "(unnamed)";
    if (e.isMicrosoftDefenderActive) {active++;} else {inactive.push(name);}

    // daysSince, never raw floor arithmetic: a sentinel definitionCreation
    // ("0001-01-01") became a 739,839-day-old definition here — the defect
    // class already fixed in endpoint-briefing, alive in this module because
    // it held its own date math. null covers absent, malformed, sentinel and
    // far-future alike; all of them are UNKNOWN, none of them is an age.
    const ageDays = daysSince(e.microsoftDefenderState?.antivirus?.definitionCreation, now);
    if (ageDays === null) {ageUnknown++; continue;}
    if (ageDays > o.staleDefinitionsAfterDays) {stale.push({ endpoint: name, definitionAgeDays: ageDays });}
  }
  stale.sort((a, b) => b.definitionAgeDays - a.definitionAgeDays);

  return {
    available: true as const,
    endpointsExamined: page.rows.length,
    active,
    inactive: inactive.length,
    inactiveEndpoints: capNames(inactive, o.maxNamed),
    definitionsStale: stale.length,
    definitionAgeUnknown: ageUnknown,
    worstDefinitionAgeDays: stale.length ? stale[0].definitionAgeDays : null,
    staleDefinitionEndpoints: stale.slice(0, o.maxNamed).map((s) => ({
      endpoint: sanitizeEstateText(s.endpoint),
      definitionAgeDays: s.definitionAgeDays,
    })),
  };
}

// ─── Dimension 3: detected vulnerabilities (compliance) ────────────────────

interface VulnRow {
  endpointName?: string;
  cveId?: string;
  ignored?: boolean;
}

function summarizeVulnerabilities(page: DimensionPage, o: Required<Pick<RiskBriefingOptions, "maxNamed">>): Dimension<VulnerabilityFacts> {
  const byEndpoint = new Map<string, number>();
  let ignored = 0;
  const cves = new Set<string>();

  for (const raw of page.rows) {
    const v = raw as VulnRow;
    if (v.ignored) {ignored++; continue;}
    const name = v.endpointName ?? "(unnamed)";
    byEndpoint.set(name, (byEndpoint.get(name) ?? 0) + 1);
    if (v.cveId) {cves.add(v.cveId);}
  }

  const worst = [...byEndpoint.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, o.maxNamed)
    .map(([endpoint, detections]) => ({ endpoint: sanitizeEstateText(endpoint), detections }));

  return {
    available: true as const,
    // The estate total, which is the honest headline number: the sample below
    // is one page and says so in meta.coverage.
    detectionsInEstate: page.totalItems,
    detectionsExamined: page.rows.length,
    ignoredInSample: ignored,
    distinctCvesInSample: cves.size,
    endpointsAffectedInSample: byEndpoint.size,
    mostAffectedEndpoints: worst,
  };
}

// ─── Dimension 4: endpoints not reporting (endpoints) ──────────────────────

interface EndpointRow {
  displayName?: string;
  lastSeen?: string | null;
}

function summarizeStaleEndpoints(
  page: DimensionPage,
  o: Required<Pick<RiskBriefingOptions, "maxNamed" | "staleEndpointAfterDays">>,
  now: number,
): Dimension<ReportingFacts> {
  let reporting = 0;
  let futureSeen = 0;
  let unreadable = 0;
  const neverSeen: string[] = [];
  const stale: Array<{ endpoint: string; daysSinceSeen: number }> = [];

  for (const raw of page.rows) {
    const e = raw as EndpointRow;
    const name = e.displayName ?? "(unnamed)";
    // A sentinel lastSeen is "never happened" — the same fact as an absent
    // one. Parsed as a date it was 739,839 days of silence here.
    if (!e.lastSeen || isSentinelDate(e.lastSeen)) {neverSeen.push(name); continue;}
    const days = daysSince(e.lastSeen, now);
    if (days === null) {
      // Beyond-skew future is a clock fault; anything else unparseable is bad
      // data. Both are UNKNOWN, and neither may land in `reporting` — a broken
      // clock used to read as a healthy check-in here.
      if (isFutureBeyondSkew(e.lastSeen, now)) {futureSeen++;} else {unreadable++;}
      continue;
    }
    if (days > o.staleEndpointAfterDays) {stale.push({ endpoint: name, daysSinceSeen: days });}
    else {reporting++;}
  }
  stale.sort((a, b) => b.daysSinceSeen - a.daysSinceSeen);

  return {
    available: true as const,
    endpointsExamined: page.rows.length,
    endpointsInEstate: page.totalItems,
    currentlyReporting: reporting,
    notReporting: stale.length,
    neverSeen: neverSeen.length,
    neverSeenEndpoints: capNames(neverSeen, o.maxNamed),
    ageUnknown: futureSeen + unreadable,
    longestSilentDays: stale.length ? stale[0].daysSinceSeen : null,
    notReportingEndpoints: stale.slice(0, o.maxNamed).map((s) => ({
      endpoint: sanitizeEstateText(s.endpoint),
      daysSinceSeen: s.daysSinceSeen,
    })),
    futureSeen,
  };
}

// ─── The briefing ───────────────────────────────────────────────────────────

export async function buildEstateRiskBriefing(http: HttpLike, options: RiskBriefingOptions = {}): Promise<EstateRiskBriefing> {
  // Field by field with `??`, NOT `{ ...DEFAULTS, ...options }`.
  //
  // The dispatch arm builds its options object from `args?.x`, so an argument
  // the caller omitted arrives as an explicit `undefined` — and a spread
  // overwrites the default WITH that undefined. Caught by the first test run:
  // `staleDefinitionsAfterDays` became undefined, `ageDays > undefined` is
  // always false, and a 400-day-old definition was reported as fresh. Silent,
  // and it would have made the tool confidently wrong rather than broken.
  const o = {
    maxNamed: options.maxNamed ?? DEFAULTS.maxNamed,
    staleDefinitionsAfterDays: options.staleDefinitionsAfterDays ?? DEFAULTS.staleDefinitionsAfterDays,
    staleEndpointAfterDays: options.staleEndpointAfterDays ?? DEFAULTS.staleEndpointAfterDays,
    pageSize: options.pageSize ?? DEFAULTS.pageSize,
    budgetMs: options.budgetMs ?? DEFAULTS.budgetMs,
  };
  const now = (options.now ?? Date.now)();
  const started = now;

  // Sequential, not parallel. Four concurrent page reads against one bMS at
  // startup of a question is a poor first impression, and the time budget
  // below can only stop work that has not begun.
  const outOfBudget = (): DimensionUnavailable | null =>
    (options.now ?? Date.now)() - started > o.budgetMs
      ? unavailable("time budget exhausted before this dimension was read")
      : null;

  const encPage = await readDimensionPage(
    http, "/defensecontrol/v2.0/BitLocker/WindowsEndpoints", o.pageSize, "The BitLocker endpoint listing");
  const defPage = outOfBudget() ?? await readDimensionPage(
    http, "/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints", o.pageSize, "The Defender endpoint listing");
  const vulnPage = outOfBudget() ?? await readDimensionPage(
    http, "/compliance/v2.0/DetectedVulnerabilities", o.pageSize, "The detected-vulnerabilities listing");
  const epPage = outOfBudget() ?? await readDimensionPage(
    http, "/endpoints/v2.0/Endpoints", o.pageSize, "The endpoint listing");

  const encryption = isUnavailable(encPage) ? encPage : summarizeEncryption(encPage, o);
  const defender = isUnavailable(defPage) ? defPage : summarizeDefender(defPage, o, now);
  const vulnerabilities = isUnavailable(vulnPage) ? vulnPage : summarizeVulnerabilities(vulnPage, o);
  const endpoints = isUnavailable(epPage) ? epPage : summarizeStaleEndpoints(epPage, o, now);

  const dims: Record<string, Dimension<Record<string, unknown>>> = {
    encryption, defender, vulnerabilities, endpoints,
  } as Record<string, Dimension<Record<string, unknown>>>;

  const unread = Object.entries(dims).filter(([, d]) => !d.available);

  // The short-serve and sample verdicts, per dimension (see the module header).
  const pages: Array<[string, DimensionPage | DimensionUnavailable]> = [
    ["encryption", encPage], ["defender", defPage], ["vulnerabilities", vulnPage], ["endpoints", epPage],
  ];
  const shortfalls = pages
    .filter((p): p is [string, DimensionPage] => !isUnavailable(p[1]) && p[1].shortfall !== null)
    .map(([name, p]) => ({ name, reason: `${name}: ${p.shortfall}` }));
  const sampledDimensions = pages
    .filter((p): p is [string, DimensionPage] => !isUnavailable(p[1]) && p[1].sampled)
    .map(([name]) => name);

  const headline: string[] = [];

  if (encryption.available && encryption.systemVolumeUnprotected > 0) {
    headline.push(
      `${encryption.systemVolumeUnprotected} of ${encryption.endpointsExamined} endpoints examined have an unencrypted system volume`,
    );
  }
  if (defender.available) {
    if (defender.inactive > 0) {headline.push(`${defender.inactive} endpoint(s) report Defender inactive`);}
    if (defender.definitionsStale > 0) {
      headline.push(
        `${defender.definitionsStale} endpoint(s) have antivirus definitions older than ` +
          `${o.staleDefinitionsAfterDays} days (worst: ${defender.worstDefinitionAgeDays} days)`,
      );
    }
  }
  if (vulnerabilities.available) {
    const activeInSample = vulnerabilities.detectionsExamined - vulnerabilities.ignoredInSample;
    if ((vulnerabilities.detectionsInEstate ?? 0) > 0) {
      headline.push(
        `${vulnerabilities.detectionsInEstate} vulnerability detection(s) across the estate; ` +
          `the ${vulnerabilities.detectionsExamined} examined here affect ` +
          `${vulnerabilities.endpointsAffectedInSample} endpoint(s)`,
      );
    } else if (activeInSample > 0) {
      // The only dimension whose headline keyed on the API's estate TOTAL
      // rather than the examined sample — and the 26R1 envelope schemas mark
      // every field optional, so an absent totalItems is a legal 200. Probed
      // 2026-08-22: detection rows in hand, total absent, and the briefing
      // said "No exposure found in any of the four dimensions examined". The
      // sample is a floor the reader must see whatever the total claims.
      headline.push(
        `at least ${activeInSample} vulnerability detection(s) in the one page examined here ` +
          `(no usable estate total was reported), affecting ` +
          `${vulnerabilities.endpointsAffectedInSample} endpoint(s)`,
      );
    }
  }
  if (endpoints.available && (endpoints.notReporting > 0 || endpoints.neverSeen > 0)) {
    headline.push(
      `${endpoints.notReporting} endpoint(s) have not reported in over ${o.staleEndpointAfterDays} days` +
        (endpoints.neverSeen ? `, and ${endpoints.neverSeen} have never been seen` : ""),
    );
  }
  if (endpoints.available && endpoints.futureSeen > 0) {
    headline.push(
      `${endpoints.futureSeen} endpoint(s) report a last check-in in the FUTURE — the bMS clock and ` +
        `this server's clock disagree, so their age is UNKNOWN rather than current.`,
    );
  }
  if (endpoints.available && endpoints.ageUnknown - endpoints.futureSeen > 0) {
    // The old code routed an unparseable lastSeen into neverSeen, which at
    // least reached the headline; silently folding it into a body-level count
    // let a machine whose reporting state is unknowable read as absence of
    // risk in the prose (adversarial review, M4).
    headline.push(
      `${endpoints.ageUnknown - endpoints.futureSeen} endpoint(s) have a lastSeen that cannot be ` +
        `read as a date — their reporting state is UNKNOWN, not healthy.`,
    );
  }

  // The disclosures that decide whether a reader may trust the rest. FIRST in
  // the headline, because a briefing missing part of its subject must not read
  // as an all-clear.
  if (shortfalls.length) {
    headline.unshift(
      `INCOMPLETE: the server returned fewer rows than its own totals for ` +
        `${shortfalls.map((s) => s.name).join(", ")} — counts in those dimensions are floors over ` +
        `what WAS served, not the estate. An empty or short page under an intact header has been ` +
        `observed live on this API. Retry; if it persists, the server's own count disagrees with ` +
        `what it serves. Do not read absence as health.`,
    );
  }
  if (unread.length) {
    headline.unshift(
      `INCOMPLETE: ${unread.length} of 4 dimensions could not be read (` +
        `${unread.map(([k]) => k).join(", ")}). This briefing is not a complete picture.`,
    );
  } else if (headline.length === 0 && shortfalls.length === 0) {
    headline.push("No exposure found in any of the four dimensions examined.");
  }

  return {
    query: {
      maxNamed: o.maxNamed,
      staleDefinitionsAfterDays: o.staleDefinitionsAfterDays,
      staleEndpointAfterDays: o.staleEndpointAfterDays,
      pageSize: o.pageSize,
    },
    headline,
    encryption,
    defender,
    vulnerabilities,
    endpoints,
    meta: {
      // The original measured case, and the one that named the family: this
      // tool answered "19 of 23 endpoints examined have an unencrypted system
      // volume" to a full key and "9 of 9" to a scoped one, BOTH asserting
      // resultTrustworthy: true. All four dimensions here read endpoint-derived
      // routes, so all four are filtered. See result-trust.ts.
      credentialScope: CREDENTIAL_SCOPE_NOTE,
      dimensionsRead: 4 - unread.length,
      dimensionsTotal: 4,
      // resultTrustworthy is FALSE whenever any dimension is missing OR was
      // short-served (fewer rows than requested while the server's own
      // totalItems says more exist — the empty page is the extreme case,
      // observed live). The suite's own precedent: an unavailable answer must
      // never be readable as a clean one. A SAMPLE by design — a full page of
      // a larger set — does not break trust; it is disclosed in `truncated`.
      resultTrustworthy: unread.length === 0 && shortfalls.length === 0,
      resultTrustworthyReasons: [
        ...unread.map(([k, d]) => `${k}: ${(d as DimensionUnavailable).reason}`),
        ...shortfalls.map((s) => s.reason),
      ],
      /** Dimensions whose estate total exceeds the (full) page read here. */
      truncated: sampledDimensions,
      coverage:
        "Each dimension reads ONE page of up to pageSize rows. Counts labelled 'InEstate' are the " +
        "API's own totals; counts labelled 'Examined' or 'InSample' describe the page read here. " +
        "Where the two differ, the estate is larger than the sample and the dimension is named in " +
        "meta.truncated.",
      note:
        "Counts reflect each endpoint's last check-in, so a stale endpoint's posture data is as " +
        "old as its last contact.",
    },
  };
}
