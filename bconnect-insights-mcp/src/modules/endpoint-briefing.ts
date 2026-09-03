/**
 * get_endpoint_briefing — "what is going on with this machine?", in one call.
 *
 * ── The question, and what it costs today ───────────────────────────────────
 * Measured live 2026-08-12 for one endpoint: 23,738 B across SEVEN tool calls
 * in SIX servers (endpoints, software, compliance, defensecontrol ×2, jobs,
 * variables). It is the most common question in help-desk work and the most
 * server-spanning thing this suite is asked. Answering it today means knowing
 * seven tools and threading one GUID through all of them correctly.
 *
 * ── The finding that shaped the output ──────────────────────────────────────
 * On WORKSTATION1 every job's CURRENT state reads FinishedSuccessfully or
 * Rescheduled — so "all jobs succeeded" is true. It is also misleading: the
 * same rows carry 27 erroneousExecutions, including INVENTORY: (Daily) at
 * 18 errors against 16 successes. A briefing that reports current state and
 * stops is confidently wrong about the machine's health. So this leads with
 * what is WRONG, and reads the historical counters, not just the latest state.
 *
 * ── Traps this file exists to not fall into (all verified live) ─────────────
 *  1. The UNTYPED endpoint route is a strict subset: isDeactivated and
 *     clientAgentState exist only on /WindowsEndpoints/{id}. Reading the
 *     untyped route returns a plausible object missing exactly the health
 *     fields. This always uses the typed route.
 *  2. Compliance's by-endpoint route has an OVERLOADED 404: for 2 of 23
 *     Windows endpoints here it means "never scanned", not "zero
 *     vulnerabilities", and the module converts it to a DataUnavailable
 *     envelope rather than throwing. Reading `.data` alone yields undefined
 *     and would be reported as a clean machine. Checked explicitly.
 *  3. `bitLockerVolumeData` is NULL on BOOT/Recovery volumes. Filter by
 *     isSystemVolume before dereferencing.
 *  4. `vulnerabilityId` is an internal GUID; `cveId` is the CVE string. Easy
 *     to swap, and the swap is invisible until someone tries to act on it.
 *  5. That route carries NO severity or CVSS field. Nothing here may imply one.
 *
 * ── Disclosure ──────────────────────────────────────────────────────────────
 * Variable VALUES are never returned. This estate's `API KEY` variable holds a
 * 64-hex credential inherited by all 19 logical groups (TOOL-REVIEW-MATRIX.md
 * §2 S5, an open owner decision). A composite is the wrong place to re-litigate
 * that, so this returns names and counts and two named health flags only.
 */

import {
  sanitizeEstateText,
  isHonestNotFound,
  notOverloaded404,
  shortfallReason,
  type SubResource404Declaration,
} from "@bconnect/mcp-core";
import type { HttpLike, DimensionUnavailable } from "./estate-risk.js";

export interface EndpointBriefingOptions {
  endpointId?: string;
  endpointName?: string;
  /** Jobs/software/vulnerability rows to read per dimension. */
  pageSize?: number;
  /** How many items to name in each list. Counts stay exact. */
  maxNamed?: number;
  /** Definitions older than this many days are called stale. */
  staleDefinitionsAfterDays?: number;
  now?: () => number;
}

const DEFAULTS = { pageSize: 100, maxNamed: 5, staleDefinitionsAfterDays: 7 };

const unavailable = (reason: string): DimensionUnavailable => ({ available: false, reason });
const isUnavailable = (v: unknown): v is DimensionUnavailable =>
  typeof v === "object" && v !== null && (v as DimensionUnavailable).available === false;

/** A bare object route. */
async function readOne(
  http: HttpLike,
  path: string,
): Promise<Record<string, unknown> | DimensionUnavailable> {
  try {
    const res = await http.get(path, { validateStatus: () => true });
    if (res.status === 403) {return unavailable(`this credential may not read ${path} (HTTP 403)`);}
    if (res.status === 404) {return unavailable(`${path} answered 404 — no data for this endpoint, or it is not of this type`);}
    if (res.status !== 200) {return unavailable(`${path} answered HTTP ${res.status}`);}
    return (res.data ?? {}) as Record<string, unknown>;
  } catch (err) {
    return unavailable(`${path} could not be reached (${err instanceof Error ? err.message : String(err)})`);
  }
}

/**
 * A paged route.
 *
 * TRAP 2, corrected after review. The M5 `DataUnavailable` envelope
 * (`data:null, dataAvailable:false`) is minted by each SERVER's module layer
 * (`compliance.ts` readSubResource), and this composite talks to the raw axios
 * client — so bConnect delivers a bare HTTP 404 here and that envelope never
 * arrives. The envelope check is kept because it costs nothing and the sibling
 * composite lacks it, but the branch that actually runs in production is the
 * 404 one below, and it must carry absent-data.ts's language itself.
 */
async function readRows(
  http: HttpLike,
  path: string,
  pageSize: number,
  declaration?: SubResource404Declaration,
): Promise<{ rows: Record<string, unknown>[]; totalItems: number | null } | DimensionUnavailable> {
  try {
    const res = await http.get(path, { params: { PageSize: pageSize }, validateStatus: () => true });
    if (res.status === 403) {return unavailable(`this credential may not read ${path} (HTTP 403)`);}
    if (res.status === 404) {
      // The overloaded 404. Measured on this estate: 2 of 23 real Windows
      // endpoints answer 404 on the vulnerabilities sub-resource, meaning
      // "never scanned" — NOT "clean". Saying so is the whole point.
      //
      // `declaration` mirrors paged-read.ts's copy — see its header for why the
      // declaration is an argument rather than something the audit infers from
      // the enclosing function. THIS function is the reason: it holds four
      // sub-resource reads, so function-scoped attribution would let one
      // declaration vouch for all four.
      const measured =
        declaration && isHonestNotFound(declaration) ? ` Measured for this route: ${declaration.reason}` : "";
      return unavailable(
        `${path} answered 404. This does NOT mean zero: it means the parent has no data yet, ` +
          `or is not of the type this route serves, or the id is wrong, or rights are missing. ` +
          `Do not report this as a clean result.${measured}`,
      );
    }
    if (res.status !== 200) {return unavailable(`${path} answered HTTP ${res.status}`);}
    const body = (res.data ?? {}) as { data?: unknown; totalItems?: unknown; dataAvailable?: unknown; note?: unknown };
    if (body.dataAvailable === false || body.data === null) {
      return unavailable(
        typeof body.note === "string"
          ? sanitizeEstateText(body.note)
          : `${path} reports its data as unavailable — this does NOT mean zero`,
      );
    }
    // A body that is not the paged envelope is a SHAPE mismatch, not an empty
    // page: treating it as zero rows would hand back a clean bill of health
    // for a response nobody understood.
    if (!Array.isArray(body.data)) {
      return unavailable(`${path} answered 200 with no recognisable data[] array — shape not understood`);
    }
    const rows = body.data as Record<string, unknown>[];
    // Same rule as paged-read.ts (see its comment): an absent total is legal
    // and null; a PRESENT but unreadable one is a shape mismatch, loud —
    // nulling it would switch the short-serve and truncation accounting off.
    const rawTotal = body.totalItems;
    if (rawTotal !== undefined && rawTotal !== null && !(typeof rawTotal === "number" && Number.isFinite(rawTotal))) {
      return unavailable(
        `${path} answered 200 with a totalItems that is not a number (type ${typeof rawTotal}) — shape not understood`,
      );
    }
    return { rows, totalItems: typeof rawTotal === "number" ? rawTotal : null };
  } catch (err) {
    return unavailable(`${path} could not be reached (${err instanceof Error ? err.message : String(err)})`);
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * .NET's DateTime.MinValue, which bConnect emits as a "no value yet" sentinel.
 *
 * Found the hard way: WORKSTATION1 was powered on mid-session and its Defender
 * block came back with `definitionCreation: "0001-01-01T00:00:00"` and
 * `definitionVersion: "0.0"`. Treated as a real date that is 739,839 days —
 * about 2,026 years — and the briefing duly reported "Antivirus definitions are
 * 739839 days old". Absurd on its face, and none of 32 tests caught it, because
 * every fixture used a plausible date. A sentinel is an ABSENT fact, not an
 * extreme one.
 *
 * The cut-off is deliberately generous rather than an equality check on
 * 0001-01-01: any timestamp before 2000 in this estate is a sentinel or a clock
 * fault, and either way it is not an age worth reporting.
 *
 * Both this and the sentinel rule now live in mcp-core, because this file held
 * one copy while paged-read.ts held another and the local spelling here was
 * `dayssince` — near enough to `daysSince` to read as the same function and
 * different enough to drift. They also both FLOORED the delta, so a timestamp a
 * millisecond in the future became an age of minus one day.
 *
 * Imported, not re-exported: `export { x } from …` creates no local binding,
 * and the three call sites below would silently be undefined.
 */
import { isSentinelDate, daysSince as dayssince, isFutureBeyondSkew } from "@bconnect/mcp-core";

export interface EndpointBriefing {
  endpoint: { id: string; name: string | null; hostName: string | null } | null;
  headline: string[];
  identity: Record<string, unknown> | DimensionUnavailable;
  encryption: Record<string, unknown> | DimensionUnavailable;
  antivirus: Record<string, unknown> | DimensionUnavailable;
  vulnerabilities: Record<string, unknown> | DimensionUnavailable;
  jobs: Record<string, unknown> | DimensionUnavailable;
  software: Record<string, unknown> | DimensionUnavailable;
  configuration: Record<string, unknown> | DimensionUnavailable;
  meta: {
    dimensionsRead: number;
    dimensionsTotal: number;
    resultTrustworthy: boolean;
    resultTrustworthyReasons: string[];
    /** Rows requested per paged dimension. */
    pageSize: number;
    /** Dimensions whose estate total exceeds the rows actually read. */
    truncated: string[];
    note: string;
  };
}

/**
 * Resolve a display name to exactly one endpoint id.
 *
 * Saves the caller a `list_endpoints` round trip AND removes the step most
 * likely to be got wrong. Ambiguity is refused rather than guessed: acting on
 * the wrong machine is the one error a help-desk tool must not make.
 */
async function resolveByName(
  http: HttpLike,
  name: string,
): Promise<{ id: string; row: Record<string, unknown> } | DimensionUnavailable> {
  // 1000 is the API's own page maximum, and totalItems is then CHECKED against
  // what arrived. The first version read a hardcoded 50 and ignored totalItems,
  // so on a larger estate a name on page 2 answered "no endpoint is named X" —
  // and, worse, a duplicate outside the window made an ambiguous name look
  // unique and brief the wrong machine. That defeats the refusal this function
  // exists for.
  const res = await readRows(http, "/endpoints/v2.0/Endpoints", 1000);
  if (isUnavailable(res)) {return res;}
  const truncated = res.totalItems !== null && res.totalItems > res.rows.length;
  const wanted = name.trim().toLowerCase();
  const hits = res.rows.filter(
    (r) => str(r.displayName)?.toLowerCase() === wanted || str(r.hostName)?.toLowerCase() === wanted,
  );
  if (truncated) {
    return unavailable(
      `this estate has ${res.totalItems} endpoints and only ${res.rows.length} could be read in one ` +
        `page, so a name cannot be resolved unambiguously. Pass endpointId instead.`,
    );
  }
  if (hits.length === 0) {
    return unavailable(`no endpoint is named "${sanitizeEstateText(name)}"`);
  }
  if (hits.length > 1) {
    return unavailable(
      `"${sanitizeEstateText(name)}" matches ${hits.length} endpoints. Pass endpointId instead — ` +
        `briefing the wrong machine is worse than briefing none.`,
    );
  }
  const id = str(hits[0].id);
  if (!id) {return unavailable(`the endpoint named "${sanitizeEstateText(name)}" has no id`);}
  return { id, row: hits[0] };
}

export async function buildEndpointBriefing(
  http: HttpLike,
  options: EndpointBriefingOptions = {},
): Promise<EndpointBriefing> {
  // Field-by-field, never a spread: an omitted argument arrives as an explicit
  // undefined from the dispatch arm and a spread would overwrite the default
  // with it. That bug shipped once in estate-risk.ts and was caught by a test.
  const o = {
    pageSize: options.pageSize ?? DEFAULTS.pageSize,
    maxNamed: options.maxNamed ?? DEFAULTS.maxNamed,
    staleDefinitionsAfterDays: options.staleDefinitionsAfterDays ?? DEFAULTS.staleDefinitionsAfterDays,
  };
  const now = (options.now ?? Date.now)();

  let id = options.endpointId;
  if (!id && options.endpointName) {
    const found = await resolveByName(http, options.endpointName);
    if (isUnavailable(found)) {
      return {
        endpoint: null,
        headline: [`Cannot brief: ${found.reason}`],
        identity: found, encryption: found, antivirus: found,
        vulnerabilities: found, jobs: found, software: found, configuration: found,
        meta: {
          dimensionsRead: 0, dimensionsTotal: 7, resultTrustworthy: false,
          resultTrustworthyReasons: [found.reason],
          pageSize: o.pageSize, truncated: [],
          note: "No endpoint was identified, so nothing was read.",
        },
      };
    }
    // Only the ID is taken from name resolution. The ROW is deliberately
    // discarded: it comes from the untyped list and using it to fill identity
    // is the trap-1 back door an adversarial review found here.
    id = found.id;
  }
  if (!id) {
    throw new Error("get_endpoint_briefing needs endpointId or endpointName");
  }

  // TRAP 1: the TYPED route. The untyped one omits isDeactivated and
  // clientAgentState — the health fields — while answering 200.
  const identityRaw = await readOne(http, `/endpoints/v2.0/WindowsEndpoints/${id}`);
  const bitlockerRaw = await readOne(http, `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/${id}`);
  const defenderRaw = await readOne(http, `/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints/${id}`);
  // Each read carries its own 404 declaration. They are passed per call rather
  // than inferred from this function because this function holds FOUR of them —
  // see paged-read.ts's header.
  const vulnRaw = await readRows(
    http,
    `/compliance/v2.0/WindowsEndpoints/${id}/DetectedVulnerabilities`,
    o.pageSize,
    {
      subject: "detected vulnerabilities",
      servesPlatform: "Windows",
      howToDisambiguate:
        "Call get_endpoint with this id: a non-Windows endpoint makes the 404 correct; a Windows " +
        "endpoint means the scan data is MISSING, not empty.",
    },
  );
  const jobsRaw = await readRows(
    http,
    `/jobs/v2.0/Endpoints/${id}/JobInstances`,
    o.pageSize,
    notOverloaded404(
      "Measured 2026-08-14: 26 of 26 endpoints answer 200 (2 with totalItems 0); a nonexistent id answers 404.",
    ),
  );
  const swRaw = await readRows(
    http,
    `/software/v2.0/WindowsEndpoints/${id}/InstalledWindowsSoftware`,
    o.pageSize,
    notOverloaded404(
      "Measured 2026-08-14: 23 of 23 Windows endpoints answer 200 (1 with totalItems 0); a nonexistent id answers 404.",
    ),
  );
  const varsRaw = await readRows(
    http,
    `/variables/v2.0/Endpoints/${id}/VariableInstances`,
    o.pageSize,
    notOverloaded404(
      "Measured 2026-08-14: 26 of 26 endpoints answer 200 (3 with totalItems 0); a nonexistent id answers 404.",
    ),
  );

  const headline: string[] = [];

  // ── identity ──────────────────────────────────────────────────────────────
  //
  // NO FALLBACK to the name-resolution row. That row comes from the UNTYPED
  // /Endpoints list, which is the strict subset trap 1 exists to reject: it
  // carries no isDeactivated and no clientAgentState, so rebuilding identity
  // from it yields `isDeactivated: false` (from `undefined === true`) and
  // `agentState: null` — both health signals silently absent, both headlines
  // suppressed, and resultTrustworthy still true. An adversarial review found
  // exactly that, and it is this tool's own headline defect class reappearing
  // inside the tool built to prevent it. If the typed route cannot be read,
  // identity DEGRADES like every other dimension.
  const identity = isUnavailable(identityRaw)
    ? identityRaw
    : {
        available: true as const,
        name: sanitizeEstateText(str(identityRaw.displayName) ?? "(unnamed)"),
        hostName: str(identityRaw.hostName),
        os: [str(identityRaw.operatingSystem), str(identityRaw.osVersionString)].filter(Boolean).join(" "),
        lastSeen: str(identityRaw.lastSeen),
        daysSinceSeen: dayssince(identityRaw.lastSeen, now),
        activity: sanitizeEstateText(str(identityRaw.activity) ?? ""),
        agentState: str(identityRaw.clientAgentState),
        agentVersion: str(identityRaw.clientAgentVersion),
        logicalGroup: sanitizeEstateText(str(identityRaw.logicalGroup) ?? ""),
        isDeactivated: identityRaw.isDeactivated === true,
      };
  if (!isUnavailable(identity)) {
    const d = identity.daysSinceSeen;
    if (identity.isDeactivated) {headline.push("This endpoint is DEACTIVATED in bMS.");}
    // A null lastSeen is NEVER SEEN, not "current". Silence here would let an
    // endpoint that has never checked in read as healthy.
    if (identity.lastSeen === null) {headline.push("This endpoint has never checked in.");}
    // A check-in dated well ahead of us is a clock or data fault. daysSince
    // returns null for it, and a bare null here would read as "not reported" —
    // so the disagreement is stated rather than absorbed. Ordinary skew never
    // reaches this: it is already folded into 0 days.
    else if (d === null && isFutureBeyondSkew(identity.lastSeen, now)) {
      headline.push(
        "bMS reports this endpoint's last check-in in the FUTURE — the bMS clock and this server's clock disagree, so its age is UNKNOWN rather than current.",
      );
    }
    else if (d !== null && d > 30) {headline.push(`Not seen for ${d} days — its data below is that old.`);}
    if (identity.agentState && identity.agentState !== "Running") {
      headline.push(`Client agent state is ${identity.agentState}, not Running.`);
    }
  }

  // ── encryption (TRAP 3: system volume only) ───────────────────────────────
  let encryption: Record<string, unknown> | DimensionUnavailable;
  if (isUnavailable(bitlockerRaw)) {encryption = bitlockerRaw;}
  else {
    const media = (bitlockerRaw.storageMedia ?? []) as Array<{ storageVolumes?: Array<Record<string, unknown>> }>;
    const vols = media.flatMap((m) => m.storageVolumes ?? []);
    const sys = vols.find((v) => v.isSystemVolume === true);
    const bl = (sys?.bitLockerVolumeData ?? null) as { protectionStatus?: string; conversionStatus?: string } | null;
    const tpm = ((bitlockerRaw.tpmData ?? null) as { tpmStatus?: string } | null)?.tpmStatus ?? null;
    encryption = {
      available: true as const,
      systemVolumeProtection: bl?.protectionStatus ?? (sys ? "no BitLocker data" : "no system volume reported"),
      conversionStatus: bl?.conversionStatus ?? null,
      tpmStatus: tpm,
    };
    // Absence is reported as absence. "not encrypted (no BitLocker data)" is a
    // false claim wearing a hedge — and it contradicted the field two lines
    // above, which correctly said no system volume was reported.
    if (bl?.protectionStatus === "Protected") {
      // healthy, nothing to say
    } else if (bl?.protectionStatus) {
      headline.push(`System volume is not encrypted (${bl.protectionStatus}).`);
    } else {
      headline.push(
        sys
          ? "System volume reports no BitLocker data — encryption state is UNKNOWN, not known-good."
          : "No system volume was reported — encryption state is UNKNOWN, not known-good.",
      );
    }
    if (tpm && tpm !== "Enabled" && tpm !== "Activated") {headline.push(`TPM is ${tpm}, so BitLocker cannot use it.`);}
  }

  // ── antivirus ─────────────────────────────────────────────────────────────
  let antivirus: Record<string, unknown> | DimensionUnavailable;
  if (isUnavailable(defenderRaw)) {antivirus = defenderRaw;}
  else {
    const av = ((defenderRaw.microsoftDefenderState ?? null) as
      { antivirus?: { isActive?: boolean; definitionCreation?: string; definitionVersion?: string } } | null)?.antivirus;
    const ageDays = dayssince(av?.definitionCreation, now);
    const definitionsNeverReported = isSentinelDate(av?.definitionCreation);

    // Tri-state: a MISSING flag is unknown, not inactive. Reporting absence as
    // "Defender is INACTIVE" cries wolf, and a briefing that cries wolf gets
    // ignored on the day it is right.
    const overall = typeof defenderRaw.isMicrosoftDefenderActive === "boolean"
      ? defenderRaw.isMicrosoftDefenderActive
      : null;
    // The two flags can DISAGREE, observed live on a freshly-booted endpoint:
    // isMicrosoftDefenderActive true while antivirus.isActive false. Reading
    // only the top-level one reports protection that is not running yet. Any
    // subsystem reporting inactive makes the whole thing not-active, and the
    // disagreement is surfaced rather than silently resolved.
    const avActive = typeof av?.isActive === "boolean" ? av.isActive : null;
    const active = overall === null && avActive === null ? null
      : overall === false || avActive === false ? false
      : true;

    antivirus = {
      available: true as const,
      defenderActive: active,
      defenderReportedActive: overall,
      antivirusSubsystemActive: avActive,
      definitionAgeDays: ageDays,
      definitionsNeverReported,
      definitionVersion: definitionsNeverReported ? null : str(av?.definitionVersion),
    };
    if (active === false) {
      headline.push(
        overall !== avActive && overall !== null && avActive !== null
          ? "Microsoft Defender reports active overall, but its ANTIVIRUS subsystem reports INACTIVE."
          : "Microsoft Defender reports INACTIVE.",
      );
    } else if (active === null) {headline.push("Defender activity is UNKNOWN — the endpoint reported no state.");}
    if (definitionsNeverReported) {
      // NOT "definitions are N days old". The endpoint has never reported one.
      headline.push("Antivirus definitions have NEVER been reported by this endpoint.");
    } else if (av?.definitionCreation && ageDays === null) {
      headline.push("Antivirus definition date could not be read.");
    }
    if (ageDays !== null && ageDays > o.staleDefinitionsAfterDays) {
      headline.push(`Antivirus definitions are ${ageDays} days old.`);
    }
  }

  // ── vulnerabilities (TRAP 2 handled in readRows; TRAPS 4 and 5 here) ──────
  let vulnerabilities: Record<string, unknown> | DimensionUnavailable;
  if (isUnavailable(vulnRaw)) {vulnerabilities = vulnRaw;}
  else {
    const live = vulnRaw.rows.filter((r) => r.ignored !== true);
    // cveId, never vulnerabilityId — the latter is an internal GUID.
    const cves = [...new Set(live.map((r) => str(r.cveId)).filter((c): c is string => !!c))];
    vulnerabilities = {
      available: true as const,
      detected: vulnRaw.totalItems ?? live.length,
      ignored: vulnRaw.rows.length - live.length,
      exampleCves: cves.slice(0, o.maxNamed),
      // Said plainly because the route has no severity or CVSS field at all;
      // silence here would invite a reader to assume one was considered.
      severityNote: "This route carries no severity or CVSS score. Use get_vulnerability for detail.",
    };
    if (live.length > 0) {headline.push(`${vulnRaw.totalItems ?? live.length} detected vulnerabilities.`);}
  }

  // ── jobs: current state AND the historical counters ───────────────────────
  let jobs: Record<string, unknown> | DimensionUnavailable;
  if (isUnavailable(jobsRaw)) {jobs = jobsRaw;}
  else {
    const failingNow = jobsRaw.rows.filter((r) => /error|fail|abort/i.test(String(r.state ?? "")));
    // A row with NO counter is not a row with zero errors. Scoring it 0 filters
    // it out silently and, with every other dimension clean, the briefing prints
    // "Nothing wrong found" over a job whose history nobody read. Counted in its
    // own bucket instead, exactly as the sibling does for definitionAgeUnknown.
    const errorCountUnknown = jobsRaw.rows.filter((r) => typeof r.erroneousExecutions !== "number").length;
    const troubled = jobsRaw.rows
      .filter((r) => typeof r.erroneousExecutions === "number")
      .map((r) => ({
        job: sanitizeEstateText(str(r.jobDefinitionName) ?? "(unnamed)"),
        jobDefinitionId: str(r.jobDefinitionId),
        errors: r.erroneousExecutions as number,
        successes: typeof r.successfulExecutions === "number" ? r.successfulExecutions : null,
        state: str(r.state),
      }))
      .filter((j) => j.errors > 0)
      .sort((a, b) => b.errors - a.errors);
    const totalErrors = troubled.reduce((a, j) => a + j.errors, 0);
    jobs = {
      available: true as const,
      assigned: jobsRaw.totalItems ?? jobsRaw.rows.length,
      rowsExamined: jobsRaw.rows.length,
      currentlyFailing: failingNow.length,
      jobsWithPastErrors: troubled.length,
      errorCountUnknown,
      totalErroneousExecutions: totalErrors,
      // The id is kept ONLY for the jobs actually flagged: it is the handle
      // explain_job_failure needs, and withholding it would force a second
      // round trip to re-find exactly the job this briefing just named.
      troubled: troubled.slice(0, o.maxNamed).map((j) => ({
        job: j.job, state: j.state, errors: j.errors, successes: j.successes, jobDefinitionId: j.jobDefinitionId,
      })),
    };
    if (failingNow.length > 0) {headline.push(`${failingNow.length} job(s) are currently in a failed state.`);}
    if (errorCountUnknown > 0) {
      headline.push(`${errorCountUnknown} job(s) report no execution counters — their history was not read.`);
    }
    if (totalErrors > 0) {
      const worst = troubled[0];
      headline.push(
        `${totalErrors} failed job execution(s) in history across ${troubled.length} job(s) — worst is ` +
          `"${worst.job}" at ${worst.errors} errors to ${worst.successes} successes. Current state alone does not show this.`,
      );
    }
  }

  // ── software: count plus REAL installs, not inventory noise ──────────────
  let software: Record<string, unknown> | DimensionUnavailable;
  if (isUnavailable(swRaw)) {software = swRaw;}
  else {
    // `installed` is null on OS-bundled/AppX inventory rows and set on actual
    // deployment events, so it is the field that separates signal from the
    // catalogue. Measured: 2 of 20 sampled rows carried a date.
    const real = swRaw.rows
      .filter((r) => str(r.installed))
      .sort((a, b) => String(b.installed).localeCompare(String(a.installed)));
    software = {
      available: true as const,
      installedCount: swRaw.totalItems ?? swRaw.rows.length,
      recentInstalls: real.slice(0, o.maxNamed).map((r) => ({
        name: sanitizeEstateText(str(r.name) ?? "(unnamed)"),
        version: str(r.version),
        installed: str(r.installed),
      })),
      note: "Products with no install date (OS-bundled and inventoried apps) are counted, not listed. Use list_installed_software_by_endpoint with SearchQuery to look one up.",
    };
  }

  // ── configuration: names and flags, never values ─────────────────────────
  let configuration: Record<string, unknown> | DimensionUnavailable;
  if (isUnavailable(varsRaw)) {configuration = varsRaw;}
  else {
    // A variable name can repeat across scopes (Endpoint, LogicalGroup, …) and
    // the endpoint-scoped row is the one that governs. Building a Map kept
    // whichever came LAST, so a group-scoped "T" could mask an endpoint-scoped
    // "F" — patching off, headline silent. Prefer the endpoint scope explicitly.
    const patchingRows = varsRaw.rows.filter((r) => String(r.name ?? "").toLowerCase() === "patching enabled");
    const patching = patchingRows.find((r) => String(r.scope ?? "") === "Endpoint") ?? patchingRows[0];
    const raw = patching ? String(patching.value ?? "").trim().toUpperCase() : null;
    // Tri-state, and an unrecognised value is UNKNOWN rather than false: bMS
    // checkbox variables use T/F here, but "Yes"/"1"/"Enabled" are all shapes a
    // human could enter, and calling any of them "disabled" is a false alarm.
    const TRUE = ["T", "TRUE", "1", "YES", "Y", "ENABLED"];
    const FALSE = ["F", "FALSE", "0", "NO", "N", "DISABLED"];
    const patchingEnabled = raw === null || raw === "" ? null
      : TRUE.includes(raw) ? true
      : FALSE.includes(raw) ? false
      : null;
    configuration = {
      available: true as const,
      variableCount: varsRaw.totalItems ?? varsRaw.rows.length,
      patchingEnabled,
      valuesWithheld: "Variable values are not returned; some carry credentials.",
    };
    if (patchingEnabled === false) {headline.push("Patching is disabled on this endpoint by variable.");}
  }

  // Which dimensions read fewer rows than the estate holds — split by WHY,
  // per the short-serve rule estate-risk.ts adopted on 2026-08-12 and this
  // module missed until 2026-08-22 (paged-read.ts's header carried the
  // migration as QUEUED). SHORT-SERVED — fewer rows than the requested page
  // while the server's own totalItems says more exist; the live-observed
  // empty page under an intact header is the extreme case — breaks trust:
  // row-derived detail is a floor over what WAS served, and the old wording
  // ("the first N rows were read") was false on exactly that state. SAMPLED —
  // a full page of a larger set — is this tool's documented read model:
  // disclosed, trust intact. Probed before this split: an empty vulnerability
  // page under totalItems 27 kept resultTrustworthy true and silenced the
  // vulnerability headline while `detected: 27` sat in the body.
  const truncatedDimensions: string[] = [];
  const shortfalls: Array<{ dim: string; reason: string }> = [];
  for (const [label, raw] of [["vulnerabilities", vulnRaw], ["jobs", jobsRaw], ["software", swRaw], ["configuration", varsRaw]] as const) {
    if (isUnavailable(raw) || raw.totalItems === null || raw.totalItems <= raw.rows.length) {continue;}
    if (raw.rows.length < o.pageSize) {
      shortfalls.push({
        dim: label,
        reason:
          shortfallReason(`The ${label} read`, raw.rows.length, raw.totalItems) ??
          `served ${raw.rows.length} of its own ${raw.totalItems} row(s)`,
      });
    } else {
      truncatedDimensions.push(label);
    }
  }
  if (truncatedDimensions.length) {
    headline.push(
      `Only the first ${o.pageSize} rows were read for: ${truncatedDimensions.join(", ")} — ` +
        `the totals are estate-wide but the detail below is a sample.`,
    );
  }

  const dims = { identity, encryption, antivirus, vulnerabilities, jobs, software, configuration };
  const unread = Object.entries(dims).filter(([, d]) => isUnavailable(d));
  if (shortfalls.length) {
    headline.unshift(
      `INCOMPLETE: the server returned fewer rows than its own totals for ` +
        `${shortfalls.map((s) => s.dim).join(", ")} — counts and lists in those dimensions are ` +
        `floors over what WAS served, not this endpoint's whole record. An empty or short page ` +
        `under an intact header has been observed live on this API. Retry; do not read absence ` +
        `as health.`,
    );
  }
  if (unread.length) {
    headline.unshift(
      `INCOMPLETE: ${unread.length} of 7 dimensions could not be read (${unread.map(([k]) => k).join(", ")}).`,
    );
  } else if (headline.length === 0 && shortfalls.length === 0) {
    headline.push("Nothing wrong found in any of the seven dimensions examined.");
  }

  return {
    endpoint: {
      id,
      name: isUnavailable(identity) ? null : (identity.name as string),
      hostName: isUnavailable(identity) ? null : (identity.hostName as string | null),
    },
    headline,
    ...dims,
    meta: {
      dimensionsRead: 7 - unread.length,
      dimensionsTotal: 7,
      // FALSE on any unread dimension OR any short-serve — an unavailable or
      // underdelivered answer must never be readable as a clean one. A full
      // page of a larger set (meta.truncated) does not break trust.
      resultTrustworthy: unread.length === 0 && shortfalls.length === 0,
      resultTrustworthyReasons: [
        ...unread.map(([k, d]) => `${k}: ${(d as DimensionUnavailable).reason}`),
        ...shortfalls.map((s) => `${s.dim}: ${s.reason}`),
      ],
      // Named counts come from the API's totalItems; every aggregate and named
      // list is computed over the ONE page read here. Without this the two sit
      // side by side and read as the same population — 250 assigned jobs beside
      // an error total summed over 100 of them, stated absolutely.
      pageSize: o.pageSize,
      truncated: truncatedDimensions,
      note:
        "Counts named 'assigned', 'detected', 'installedCount' and 'variableCount' are estate totals; " +
        "lists and error sums are computed over one page of pageSize rows. Any dimension in " +
        "meta.truncated has more rows than were read. Figures reflect this endpoint's last check-in.",
    },
  };
}
