/**
 * Fleet summary — composite read-only aggregate.
 *
 * LOCAL ADDITION (not upstream). Answers "how is the estate doing" without
 * returning the estate.
 *
 * `list_windows_endpoints` returns ~3.9 KB per endpoint across 53 fields, so 23
 * endpoints cost ~88,900 characters (~22k tokens) — enough to exceed a tool
 * result ceiling and to crowd out the conversation it was meant to inform
 * (upstream finding D1). Most "how is the fleet doing" questions want counts,
 * outliers and drift, not records.
 *
 * This reads the lean 27-field `/Endpoints` projection once and returns a
 * digest, typically well under 3 KB regardless of estate size.
 */

import { CREDENTIAL_SCOPE_NOTE, assessResultTrust, paginateAll, shortfallReason, truncationReason } from "@bconnect/mcp-core";
import type { EndpointsModule } from "./endpoints.js";
// LOCAL ADDITION — bMC console link builder. modules/bmc-console-link.ts
// carries the design rationale, what is vendor-documented, and why the block is
// opt-in rather than on by default.
import { consoleLinkMeta, isConsoleLinksEnabled, isRemoteDeskLinksEnabled } from "./bmc-console-link.js";

interface EndpointRow {
  id?: string;
  displayName?: string;
  hostName?: string | null;
  type?: string;
  operatingSystem?: string;
  osVersionText?: string;
  logicalGroup?: string;
  clientAgentVersion?: string;
  lastSeen?: string | null;
  activity?: string | null;
}

// NOTE — no `isDeactivated` here, deliberately. It exists only on the typed
// WindowsEndpoint schema, never on the generic /v2.0/Endpoints projection this
// module reads (confirmed against both the generated types and a live
// response). Declaring it made `undefined === true` compile and always be
// false, so the count it fed was pinned at zero by construction. See the
// totals block below.

const DAY_MS = 86_400_000;
const ENDPOINT_PAGE_SIZE = 1000;
/** 20 pages × 1000 = 20,000 endpoints. A real ceiling, not a formality: the
 *  response says when it was hit (see meta.estate below). */
const MAX_ENDPOINT_PAGES = 20;

/**
 * Explicit order for the estate walk.
 *
 * Without it a capped walk reads an arbitrary subset that differs between runs,
 * so two calls minutes apart return different totals over an unchanged estate —
 * and the truncation note below could not honestly describe what it read.
 * `DisplayName` is one of the four values `/v2.0/Endpoints` documents for
 * `OrderBy` (DisplayName, HostName, OperatingSystem, LastSeen) and is the field
 * every row in this response is identified by, so the bounded window is the one
 * a reader can name and page past.
 */
const ENDPOINT_ORDER_BY = "DisplayName asc";

/** Bucket boundaries in days; anything beyond the last is "over a year". */
const BUCKETS: Array<[label: string, maxDays: number]> = [
  ["today", 1],
  ["last 7 days", 7],
  ["last 30 days", 30],
  ["31–90 days", 90],
  ["91–365 days", 365],
];

/**
 * Count rows by a picked field, as an object KEYED BY THAT FIELD.
 *
 * ── The key position is deliberate, and it is only safe because of where the
 *    sanitising happens ─────────────────────────────────────────────────────
 * `byLogicalGroup` keys this by the logical-group NAME, which is operator-
 * controllable: live keys on the reference estate are "Tier1", "Network
 * Devices", "Domain Controllers". Anyone who can name a logical group in bMS
 * chooses those bytes.
 *
 * That was a live hole until 2026-08-14. `serializeToolResult` sanitised string
 * VALUES only and recorded that no tool keyed a map by an estate string — this
 * one did. Driven through the real handler, every hostile codepoint survived
 * here, and the `_provenance` marker did NOT fire, because it counted value
 * strips alone.
 *
 * Fixed at the chokepoint, not here, and that placement is the point: moving
 * the name into value position would fix this tool and leave the next one
 * exposed. Do NOT "harden" this by reshaping the response — the shape is a
 * measured token decision, and the control now sits where a new tool cannot
 * walk around it. `injection-key-position.test.ts` drives this exact path.
 */
function tally(rows: EndpointRow[], pick: (r: EndpointRow) => string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = pick(r);
    out[k && String(k).trim() ? String(k) : "(unset)"] = (out[k && String(k).trim() ? String(k) : "(unset)"] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export interface FleetSummaryOptions {
  staleAfterDays?: number;
  includeGroups?: boolean;
  maxOutliers?: number;
  /** Emit the RemoteDesk template alongside the console-link template in
   * `consoleLinks`. Defaults to isRemoteDeskLinksEnabled()
   * (BMC_REMOTEDESK_LINKS=true), off unless set. Exposed here mainly so tests
   * don't need env-var juggling — see bmc-console-link.ts. */
  includeRemoteDesk?: boolean;
  /** Emit the `consoleLinks` block at all. Defaults to isConsoleLinksEnabled()
   * (BMC_CONSOLE_LINKS=true), off unless set — see bmc-console-link.ts for why
   * an unverified deep link is not a default affordance. */
  includeConsoleLinks?: boolean;
}

/**
 * The two fields a caller needs to reconstruct this row's console link from
 * `consoleLinks.template` — TOK-23.
 *
 * This used to be `linkFields()`, which wrote a fully-expanded 131-165
 * character `bMC:///` URI onto every needsAttention / agentVersionOutliers /
 * reportedErrors entry. Measured live: ~4.4 KB of a ~9.8 KB response, so
 * roughly half of the tool that exists specifically to be the compact digest
 * was repeated URL boilerplate. `id` + `type` cost ~60 bytes and carry the
 * same information, because the URI is a pure function of them.
 */
function linkFields(r: EndpointRow): { id?: string; type?: string } {
  return {
    ...(r.id ? { id: r.id } : {}),
    ...(r.type ? { type: r.type } : {}),
  };
}

export async function getFleetSummary(
  endpoints: EndpointsModule,
  opts: FleetSummaryOptions = {}
): Promise<Record<string, unknown>> {
  const staleAfterDays = opts.staleAfterDays ?? 30;
  const maxOutliers = opts.maxOutliers ?? 10;
  const includeRemoteDesk = opts.includeRemoteDesk ?? isRemoteDeskLinksEnabled();
  const includeConsoleLinks = opts.includeConsoleLinks ?? isConsoleLinksEnabled();
  const startedAt = Date.now();

  // The generic /Endpoints projection is 27 fields rather than the 53 the typed
  // variants return, and it includes every platform — not just Windows.
  //
  // LOCAL FIX — PER-17. This fetched exactly one PageSize-1000 page and
  // reported rows.length as `totals.endpoints`, so an estate over 1000
  // endpoints got an authoritative-looking total computed over an arbitrary
  // first page, with nothing in the response saying so. Latent on this
  // 26-endpoint estate; a silent wrong answer presented as a total on a large
  // one. Now walks every page, bounded, and reports whether the bound was hit.
  // Page-0 `totalItems` is captured because `paginateAll` cannot see it: its
  // only completeness signal is totalPages vs the page cap, and the API has
  // been MEASURED serving 200s whose data[] is empty (or short) while the
  // header still carries the real count. Discarding the field here rendered a
  // full zero-endpoint estate digest over that state.
  let totalItems: number | null = null;
  const estate = await paginateAll<EndpointRow>(
    async (pageNumber) => {
      const body = (await endpoints.getEndpoints({
        PageSize: ENDPOINT_PAGE_SIZE,
        Page: pageNumber,
        OrderBy: ENDPOINT_ORDER_BY,
      } as never)) as { data?: EndpointRow[]; totalPages?: number; totalItems?: number };
      if (pageNumber === 0 && typeof body.totalItems === "number") { totalItems = body.totalItems; }
      return { items: body.data ?? [], totalPages: body.totalPages };
    },
    { maxPages: MAX_ENDPOINT_PAGES }
  );
  const rows = estate.items;
  // Only over an UNtruncated walk: a capped walk is expected to absorb fewer
  // rows than totalItems, and truncationReason owns that condition — asserting
  // both would double-report one cause and prescribe "retry" for a client-side
  // bound retrying cannot lift (adversarial review, M1).
  const estateShortfall = estate.truncated
    ? null
    : shortfallReason("The endpoint listing walk", rows.length, totalItems);

  const now = Date.now();
  const ageDays = (r: EndpointRow): number | null =>
    r.lastSeen ? Math.floor((now - new Date(r.lastSeen).getTime()) / DAY_MS) : null;

  const never = rows.filter((r) => ageDays(r) === null);
  const seen = rows.filter((r) => ageDays(r) !== null);
  const stale = seen.filter((r) => (ageDays(r) as number) > staleAfterDays);
  const current = seen.filter((r) => (ageDays(r) as number) <= staleAfterDays);

  // Check-in distribution
  const checkIn: Record<string, number> = {};
  for (const [label] of BUCKETS) {checkIn[label] = 0;}
  checkIn["over a year"] = 0;
  checkIn["never seen"] = never.length;
  for (const r of seen) {
    const d = ageDays(r) as number;
    const hit = BUCKETS.find(([, max]) => d <= max);
    checkIn[hit ? hit[0] : "over a year"]++;
  }

  // Endpoints worth a human's attention, worst first.
  const attention = [
    ...never.map((r) => ({
      endpoint: r.displayName ?? "(unnamed)",
      reason: "never checked in",
      lastSeenDays: null as number | null,
      activity: r.activity ?? null,
      ...linkFields(r),
    })),
    ...stale
      .sort((a, b) => (ageDays(b) as number) - (ageDays(a) as number))
      .map((r) => ({
        endpoint: r.displayName ?? "(unnamed)",
        reason: `not seen for ${ageDays(r)} days`,
        lastSeenDays: ageDays(r),
        activity: r.activity ?? null,
        ...linkFields(r),
      })),
  ].slice(0, maxOutliers);

  // An agent version well behind the rest usually means a broken or stalled agent.
  const agentTally = tally(rows, (r) => r.clientAgentVersion);
  const agentVersions = Object.keys(agentTally).filter((v) => v !== "(unset)");
  const newest = agentVersions.sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" })
  )[0];
  const behind = rows
    .filter((r) => r.clientAgentVersion && r.clientAgentVersion !== newest)
    .map((r) => ({
      endpoint: r.displayName,
      agentVersion: r.clientAgentVersion,
      ...linkFields(r),
    }))
    .slice(0, maxOutliers);

  // Surface reported errors verbatim — these are often the actual story.
  const errors = rows
    .filter((r) => r.activity && /error|could not|fail|unable/i.test(r.activity))
    .map((r) => ({
      endpoint: r.displayName,
      activity: String(r.activity).slice(0, 160),
      ...linkFields(r),
    }))
    .slice(0, maxOutliers);

  return {
    // Say what was applied rather than leaving it implied.
    query: { staleAfterDays, maxOutliers, includeGroups: opts.includeGroups ?? true },
    totals: {
      // The server's own count under the estate-shaped name, with what was
      // actually read beside it — a bounded walk must not publish its own
      // length as a total (the H4 rule, and the live-measured empty-page case).
      endpoints: totalItems ?? rows.length,
      endpointsExamined: rows.length,
      currentlyReporting: current.length,
      stale: stale.length,
      neverSeen: never.length,
      // `deactivated` was removed rather than fixed. It read `isDeactivated`
      // off the generic /Endpoints projection, which does not carry that field
      // — so it reported 0 unconditionally, and read as "no deactivated
      // endpoints" when it actually meant "cannot see this from here". A
      // structurally-impossible number is worse than an absent one.
      //
      // Not worth fetching /WindowsEndpoints to restore it either. This tool
      // earns its place by being the cheap call (the lean projection is 25 KB
      // for 26 endpoints against 63 KB for 23 — upstream D1), and a deactivated
      // client in bMS is no longer managed at all: it is an archive of what was
      // installed and configured at the moment it was switched off. That is a
      // different question from "how is the fleet doing", which is this tool's
      // question, so its absence costs this tool nothing.
    },
    checkInDistribution: checkIn,
    byType: tally(rows, (r) => r.type),
    byOperatingSystem: tally(rows, (r) => r.operatingSystem),
    byAgentVersion: agentTally,
    // ── DECLINED 2026-08-14: a "how is this logical group doing?" composite ───
    // Nine tools across seven servers key on one logicalGroupId, and this tally
    // is only a name->count, so the structural case looks excellent. It is a
    // RECORDED DECLINE: COMPOSITE-SERVER-PLAN.md costed it at 8,439 B / 5 calls
    // / 5 servers and rejected it because 89% of that is a single call
    // (list_installed_software_by_logical_group, 7,531 B) — a shaping question,
    // not a composite one.
    //
    // The one thing that could reopen it, stated as a hypothesis and nothing
    // more: that same route is what BYTE-RANKING §8 later measured dominating a
    // 113,389 B hand-walk for get_deployment_coverage, "every product on every
    // endpoint in the group". 7,531 B vs ~100 KB for one route is a difference
    // of read model — a default page against the whole population — and §8's
    // candidate C is the recorded precedent for a costing that measured the
    // wrong thing and understated by ~18x. Nothing here is measured. Re-measure
    // that route over the whole population FIRST; until that number exists the
    // rejection stands.
    ...(opts.includeGroups === false ? {} : { byLogicalGroup: tally(rows, (r) => r.logicalGroup) }),
    needsAttention: attention,
    agentVersionOutliers: { newestSeen: newest ?? null, behind },
    reportedErrors: errors,
    // LOCAL ADDITION — see modules/bmc-console-link.ts. TOK-23: one template
    // plus one worked example, instead of a URI on every row above. Absent
    // entirely unless BMC_CONSOLE_LINKS=true; the example is expanded from the
    // first needsAttention entry, so the link a human wants needs no
    // substitution.
    ...(includeConsoleLinks
      ? {
          consoleLinks: consoleLinkMeta(
            (never[0] ?? stale[0] ?? rows[0]) as never,
            includeRemoteDesk
          ),
        }
      : {}),
    meta: {
      // An estate-wide aggregate, so it owes the scope disclosure. See
      // result-trust.ts: bConnect filters this walk by the key's rights and
      // says nothing, and `resultTrustworthy` below correctly stays TRUE
      // because the reads did finish. Measured here: totals.endpoints 27 -> 9
      // and byType.NetworkEndpoint vanishing entirely under a scoped key.
      credentialScope: CREDENTIAL_SCOPE_NOTE,
      elapsedMs: Date.now() - startedAt,
      // The shared completeness contract — see result-trust.ts. Two conditions:
      // the page-cap bound, and the live-measured short-serve (fewer rows than
      // the envelope's own totalItems, the empty page being the extreme case).
      ...assessResultTrust(
        truncationReason("The endpoint listing", estate, "MAX_ENDPOINT_PAGES"),
        estateShortfall,
      ),
      // LOCAL ADDITION — PER-17. Say what the totals were computed over, so a
      // truncated walk can never be mistaken for a complete one.
      estate: {
        pagesFetched: estate.pagesFetched,
        totalPages: estate.totalPages,
        totalItems,
        rowsExamined: rows.length,
        pageSize: ENDPOINT_PAGE_SIZE,
        orderBy: ENDPOINT_ORDER_BY,
        truncated: estate.truncated,
      },
      note:
        (estate.truncated
          ? `INCOMPLETE — stopped after ${estate.pagesFetched} of ${estate.totalPages} pages ` +
            `(${MAX_ENDPOINT_PAGES}-page cap). Every count below covers only the first ` +
            `${rows.length} endpoints ordered by ${ENDPOINT_ORDER_BY}, and UNDERSTATES the estate. `
          : "") +
        (estateShortfall
          ? `INCOMPLETE — ${estateShortfall} Distribution and outlier blocks below describe only ` +
            `what WAS served. An empty or short page under an intact header has been observed ` +
            `live on this API. Retry; if it persists, the server's own count disagrees with what ` +
            `it serves. Do not read absence as health. `
          : "") +
        `Aggregated from the ${rows.length}-endpoint /Endpoints projection. ` +
        `Counts reflect last check-in, so a stale endpoint's inventory is as old as its lastSeen.`,
    },
  };
}
