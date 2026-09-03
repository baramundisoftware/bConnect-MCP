/**
 * Assignment preview — read-only "what would this do?".
 *
 * LOCAL ADDITION (not upstream). Nothing in the API answers this today, and two
 * findings make it necessary:
 *
 *   - Assignment CASCADES to descendant groups, while membership queries return
 *     direct members only. A group reporting 0 members can reach the whole
 *     estate (upstream D9). We hit exactly that: a job assigned to a "0 member"
 *     group produced a queued instance on a live endpoint.
 *   - Assignment EXECUTES. A job runs on assignment unless an interval or
 *     scheduled time defers it (upstream D10), and neither deciding field —
 *     RepeatedExecution.IsActive or JobStartType — is exposed by v2.0.
 *
 * So an agent currently cannot tell whether `assign_job_to_logical_group` is
 * inert or an immediate fleet-wide execution. This computes that in advance.
 *
 * ISSUES NO WRITES. It only reads.
 *
 * v1.1 dependency: the safety fields live in bConnect v1.1, which accepts Basic
 * auth ONLY — the API key returns 401 there (verified). The read goes through
 * `v11.ts`, which is the one place in this server that talks to v1.1. If the
 * v1.1 surface is off (BCONNECT_ENABLE_V11 unset, or the credentials absent)
 * the scope analysis still runs, and the response says plainly that the safety
 * verdict is unavailable rather than implying the job is safe.
 */

import { type AxiosInstance } from "axios";
import { paginateAll, shortfallReason } from "@bconnect/mcp-core";
import { fetchV11Job, type V11Result } from "./v11.js";

interface GroupRow { id?: string; name?: string; parentId?: string | null }
interface EndpointRow {
  displayName?: string;
  logicalGroupId?: string;
  lastSeen?: string | null;
  isDeactivated?: boolean;
  type?: string;
}

const DAY_MS = 86_400_000;
const lower = (s: unknown): string => String(s ?? "").toLowerCase();

// bConnect caps PageSize at 1000 server-side. The page ceilings match the other
// estate-wide walks in this suite (fleet-summary.ts, stale-endpoints.ts):
// 20 pages is 20,000 rows, comfortably past any estate this tool can render,
// and `truncated` is reported rather than assumed false when it is hit.
const PAGE_SIZE = 1000;
const MAX_GROUP_PAGES = 20;
const MAX_ENDPOINT_PAGES = 20;

/**
 * Explicit orders for the three bounded walks, so hitting a cap removes a
 * nameable tail rather than an arbitrary one. This matters more here than
 * anywhere else in the server: `endpointsInReach` decides the verdict, so a
 * reshuffling walk means the same preview of the same job can read CONFIRM
 * FIRST once and LOW RISK the next time with nothing changed.
 *
 * Both values are among those their route documents for `OrderBy` — `Name` (and
 * `Dip`) on `/v2.0/LogicalGroups`, `DisplayName` (with HostName,
 * OperatingSystem, LastSeen) on `/v2.0/Endpoints` and on every
 * `/{Kind}/{id}/Endpoints` membership route.
 */
const GROUP_ORDER_BY = "Name asc";
const ENDPOINT_ORDER_BY = "DisplayName asc";

/**
 * The four group kinds a job can be assigned to, and how reach is computed for
 * each.
 *
 * `cascades` is the important column. LogicalGroups NEST, and assignment
 * follows the tree while membership queries return direct members only — that
 * is finding D9, and the reason this tool exists. The other three do not nest:
 * bConnect exposes `/{Kind}/{id}/Endpoints`, which returns the membership
 * itself, so the reach IS the member list and there is no closure to walk.
 *
 * `computed` marks the two kinds whose membership is evaluated server-side from
 * a rule rather than stored. For those the preview is a SNAPSHOT: the set can
 * change between previewing and assigning, without anyone editing the group.
 */
const GROUP_KINDS = {
  logical: {
    option: "logicalGroupId", segment: "LogicalGroups",
    label: "logical group", cascades: true, computed: false,
  },
  static: {
    option: "staticGroupId", segment: "StaticGroups",
    label: "static group", cascades: false, computed: false,
  },
  dynamic: {
    option: "dynamicGroupId", segment: "DynamicGroups",
    label: "dynamic group", cascades: false, computed: true,
  },
  universalDynamic: {
    option: "universalDynamicGroupId", segment: "UniversalDynamicGroups",
    label: "universal dynamic group", cascades: false, computed: true,
  },
} as const;

type GroupKind = keyof typeof GROUP_KINDS;

export interface PreviewOptions {
  jobDefinitionId: string;
  /** Exactly one of the four must be given — they mirror the assign_* tools. */
  logicalGroupId?: string;
  staticGroupId?: string;
  dynamicGroupId?: string;
  universalDynamicGroupId?: string;
  liveWithinDays?: number;
}

/**
 * Which group was asked about. Refuses zero and refuses more than one, rather
 * than picking — a preview aimed at the wrong group is worse than no preview,
 * because its verdict looks authoritative.
 */
function selectTarget(opts: PreviewOptions): { kind: GroupKind; id: string } {
  const given = (Object.keys(GROUP_KINDS) as GroupKind[])
    .map((kind) => ({ kind, id: opts[GROUP_KINDS[kind].option] }))
    .filter((x): x is { kind: GroupKind; id: string } => Boolean(x.id));

  if (given.length === 1) { return given[0]!; }
  const names = Object.values(GROUP_KINDS).map((k) => k.option).join(", ");
  if (given.length === 0) {
    throw new Error(`preview_assignment needs exactly one group id. Pass one of: ${names}.`);
  }
  throw new Error(
    `preview_assignment got ${given.length} group ids (${given.map((g) => GROUP_KINDS[g.kind].option).join(", ")}). ` +
    `Pass exactly one — a job is assigned to one group, and guessing which you meant could preview the wrong blast radius.`
  );
}

/**
 * Read the job's own safety facts out of the v1.1 record.
 *
 * Shared by both scope paths so a change to what "destructive" or "immediate"
 * means cannot land in one and not the other. Every field stays null when the
 * v1.1 lookup failed — the one thing this must never do is let an unreadable
 * job present as a safe one.
 */
function assessJob(v11Result: V11Result): {
  v11: Record<string, unknown> | null;
  rep: { IsActive?: boolean; RepetitionEntries?: unknown[] } | undefined;
  startType: string;
  destructive: boolean | null;
  scheduled: boolean;
  passive: boolean;
  timing: string;
} {
  const v11 = v11Result.job;
  const wp = (v11?.WindowsProperties ?? {}) as Record<string, unknown>;
  const rep = wp.RepeatedExecution as { IsActive?: boolean; RepetitionEntries?: unknown[] } | undefined;
  const startType = String(wp.JobStartType ?? "");
  const destructive = v11 ? v11.Destructive === true : null;
  const scheduled = rep?.IsActive === true;
  const passive = /^Passive/i.test(startType);

  const timing = !v11
    ? `unknown — ${v11Result.reason}`
    : scheduled
      ? "deferred — a schedule is set, so it runs at the scheduled time"
      : passive
        ? "waits to be triggered (passive)"
        : "IMMEDIATE — runs as soon as a targeted endpoint is online";

  return { v11, rep, startType, destructive, scheduled, passive, timing };
}

/**
 * Members of a non-nesting group, straight from its own membership route.
 *
 * A 404 here is NOT zero endpoints. Verified live 2026-08-04 against a
 * well-formed but nonexistent id: bConnect answers 404 with
 * `"Object [<id>] not found or not visible due to missing rights."`, so a
 * missing group is distinguishable from an empty one — an empty 200 really does
 * mean "this group exists and has no members". That distinction is load-bearing
 * here: silently reading a bad id as zero reach would render LOW RISK for an
 * assignment nobody has actually previewed.
 *
 * The 404 is also how a wrong-KIND id shows up. Dynamic and Universal Dynamic
 * group ids are not interchangeable, and passing one where the other belongs
 * 404s exactly like a missing route — so the message says so.
 */
async function fetchGroupMembers(
  client: AxiosInstance, kind: GroupKind, id: string
): Promise<{ items: EndpointRow[]; pagesFetched: number; totalPages: number | null; truncated: boolean; totalItems: number | null }> {
  const { segment, label } = GROUP_KINDS[kind];
  try {
    // `totalItems` is captured from page 0 because `paginateAll` cannot see it:
    // its only completeness signal is totalPages vs the page cap, and the API
    // has been MEASURED serving 200s whose data[] is empty (or short) while the
    // header still states the real totalItems. Discarding the field here is what
    // let that state preview as zero blast radius.
    let totalItems: number | null = null;
    const walk = await paginateAll<EndpointRow>(
      async (page) => {
        const res = await client.get(`/endpoints/v2.0/${segment}/${id}/Endpoints`, {
          params: { PageSize: PAGE_SIZE, Page: page, OrderBy: ENDPOINT_ORDER_BY },
        });
        const body = (res.data ?? {}) as { data?: EndpointRow[]; totalPages?: number | null; totalItems?: number | null };
        if (page === 0 && typeof body.totalItems === "number") { totalItems = body.totalItems; }
        return { items: body.data ?? [], totalPages: body.totalPages ?? undefined };
      },
      { maxPages: MAX_ENDPOINT_PAGES }
    );
    return { ...walk, totalItems };
  } catch (err) {
    const status = (err as { status?: number; response?: { status?: number } }).status
      ?? (err as { response?: { status?: number } }).response?.status;
    if (status === 404) {
      throw new Error(
        `${label} ${id} was not found (HTTP 404). This is not "no endpoints" — the group does not exist, ` +
        `is not visible with these credentials, or the id belongs to a different group kind ` +
        `(dynamic and universal dynamic ids are NOT interchangeable and fail this way). ` +
        `No preview was produced; do not read this as a safe assignment.`
      );
    }
    throw err;
  }
}

export async function previewAssignment(
  client: AxiosInstance,
  opts: PreviewOptions
): Promise<Record<string, unknown>> {
  const liveWithinDays = opts.liveWithinDays ?? 7;
  const startedAt = Date.now();
  const targetRef = selectTarget(opts);
  const kindInfo = GROUP_KINDS[targetRef.kind];

  // Non-nesting kinds take the short path: their own membership route returns
  // the reach directly, so there is no estate-wide group walk and no closure.
  // Everything after the scope block — the v1.1 safety lookup, the online
  // count, the verdict, the truncation disclosure — is shared.
  if (!kindInfo.cascades) {
    return previewNonNesting(client, opts, targetRef.kind, targetRef.id, liveWithinDays, startedAt);
  }

  // PER-16: the v1.1 safety lookup depends on nothing computed from the three
  // v2.0 reads, so it joins them here instead of costing a second phase after
  // the scope analysis. fetchV11Job never rejects — it reports failure through
  // `reason` — so adding it cannot change how this Promise.all settles.
  //
  // LOCAL FIX — PER-17 / B4. The two estate reads fetched exactly one
  // PageSize-1000 page and the row counts were then reported as totals. That is
  // worse here than anywhere else it occurred: `endpointsInReach` feeds the
  // REFUSE / CONFIRM FIRST verdict, so a truncated read tells a human a
  // destructive job is SAFER than it is. Truncating the group read is worse
  // still — a target group past page 0 makes the lookup below throw "not
  // found", and every group missing from the walk drops its endpoints out of
  // the descendant closure. Both now page through, bounded, and a walk that hit
  // its bound is reported as a blocker, never silently.
  // Page-0 totalItems for both estate walks — paginateAll cannot see the field,
  // and the API has been MEASURED serving intact headers over empty or short
  // data[]. See fetchGroupMembers for the full account.
  let groupsTotalItems: number | null = null;
  let endpointsTotalItems: number | null = null;
  const [defRes, groupsWalk, endpointsWalk, v11Result] = await Promise.all([
    client.get(`/jobs/v2.0/JobDefinitions/${opts.jobDefinitionId}`),
    paginateAll<GroupRow>(
      async (page) => {
        const res = await client.get(`/endpoints/v2.0/LogicalGroups`, {
          params: { PageSize: PAGE_SIZE, Page: page, OrderBy: GROUP_ORDER_BY },
        });
        // The envelope types totalPages as nullable; paginateAll reads absent
        // as "this is the last page".
        const body = (res.data ?? {}) as { data?: GroupRow[]; totalPages?: number | null; totalItems?: number | null };
        if (page === 0 && typeof body.totalItems === "number") { groupsTotalItems = body.totalItems; }
        return { items: body.data ?? [], totalPages: body.totalPages ?? undefined };
      },
      { maxPages: MAX_GROUP_PAGES }
    ),
    paginateAll<EndpointRow>(
      async (page) => {
        const res = await client.get(`/endpoints/v2.0/Endpoints`, {
          params: { PageSize: PAGE_SIZE, Page: page, OrderBy: ENDPOINT_ORDER_BY },
        });
        const body = (res.data ?? {}) as { data?: EndpointRow[]; totalPages?: number | null; totalItems?: number | null };
        if (page === 0 && typeof body.totalItems === "number") { endpointsTotalItems = body.totalItems; }
        return { items: body.data ?? [], totalPages: body.totalPages ?? undefined };
      },
      { maxPages: MAX_ENDPOINT_PAGES }
    ),
    fetchV11Job(client, opts.jobDefinitionId),
  ]);

  const def = defRes.data as Record<string, unknown>;
  const groups = groupsWalk.items;
  const endpoints = endpointsWalk.items;
  const scopeTruncated = groupsWalk.truncated || endpointsWalk.truncated;
  // Only over an UNtruncated walk: a capped walk is expected to absorb fewer
  // rows than totalItems, and the page-cap blocker above owns that condition —
  // asserting both would put two blockers on one cause (adversarial review, M1).
  const groupsShortfall = groupsWalk.truncated
    ? null
    : shortfallReason("The logical-group listing", groups.length, groupsTotalItems);
  const endpointsShortfall = endpointsWalk.truncated
    ? null
    : shortfallReason("The estate endpoint listing", endpoints.length, endpointsTotalItems);

  const target = groups.find((g) => lower(g.id) === lower(targetRef.id));
  if (!target) {
    // Say which of the two things happened. "Not found" after a bounded walk
    // may mean "not present" or "past the bound", and those need different
    // actions from the caller.
    throw new Error(
      `logical group ${targetRef.id} not found` +
        (groupsWalk.truncated
          ? ` in the first ${groupsWalk.pagesFetched} of ${groupsWalk.totalPages} pages of ` +
            `/LogicalGroups (${MAX_GROUP_PAGES}-page cap) — the group may exist beyond the cap`
          : groupsShortfall
            ? ` — but the group listing was SHORT-SERVED (${groupsShortfall}) so the group may be ` +
              `among the rows the server did not return. Retry before concluding it does not exist`
            : "")
    );
  }

  // Descendant closure — assignment cascades, membership queries do not (D9).
  const descendants: GroupRow[] = [];
  const walk = (id: string): void => {
    for (const g of groups.filter((x) => lower(x.parentId) === lower(id))) {
      descendants.push(g);
      walk(String(g.id));
    }
  };
  walk(String(target.id));

  const scopeIds = new Set([lower(target.id), ...descendants.map((g) => lower(g.id))]);
  const inScope = endpoints.filter((e) => scopeIds.has(lower(e.logicalGroupId)));
  const direct = endpoints.filter((e) => lower(e.logicalGroupId) === lower(target.id));

  const now = Date.now();
  const ageDays = (e: EndpointRow): number | null =>
    e.lastSeen ? Math.floor((now - new Date(e.lastSeen).getTime()) / DAY_MS) : null;
  const live = inScope.filter((e) => {
    const d = ageDays(e);
    return d !== null && d <= liveWithinDays && e.isDeactivated !== true;
  });

  const { v11, rep, startType, destructive, scheduled, passive, timing } = assessJob(v11Result);

  const blockers: string[] = [];
  if (destructive === true) {
    blockers.push("job is flagged Destructive (contains a wipe step) — refuse");
  }
  if (destructive === null) {
    blockers.push(`safety metadata unavailable — ${v11Result.reason ?? "unknown reason"}`);
  }
  if (!scheduled && !passive && v11 && live.length > 0) {
    blockers.push(`${live.length} endpoint(s) are online and would execute immediately`);
  }
  if (inScope.length > direct.length) {
    blockers.push(`scope cascades: ${direct.length} direct member(s) but ${inScope.length} endpoint(s) in reach`);
  }
  // A count computed over a partial estate is a blocker, not a footnote: every
  // number below is a floor, so the preview cannot be allowed to read LOW RISK.
  if (scopeTruncated) {
    blockers.push(
      `scope is INCOMPLETE — the estate read stopped at its page cap ` +
        `(groups ${groupsWalk.pagesFetched}/${groupsWalk.totalPages}, ` +
        `endpoints ${endpointsWalk.pagesFetched}/${endpointsWalk.totalPages}); ` +
        `every count below is a LOWER BOUND and understates the blast radius`
    );
  }
  // Same rule for a walk that COMPLETED but absorbed fewer rows than the
  // envelope's own totalItems. Measured live: the API can serve an intact
  // header over an empty (or short) data[], and a genuinely empty estate
  // reports totalItems 0 — so this fires only on the disagreement.
  for (const shortfall of [groupsShortfall, endpointsShortfall]) {
    if (shortfall) {
      blockers.push(
        `scope is INCOMPLETE — ${shortfall} Every count below is a LOWER BOUND and ` +
          `understates the blast radius`
      );
    }
  }

  const verdict =
    destructive === true ? "REFUSE"
      : blockers.length ? "CONFIRM FIRST"
        : "LOW RISK";

  return {
    // Self-describing: state what was evaluated, not just the conclusion.
    query: { jobDefinitionId: opts.jobDefinitionId, groupKind: "logical", logicalGroupId: targetRef.id, liveWithinDays },
    job: {
      name: def.name ?? null,
      folder: def.folder ?? null,
      type: def.type ?? null,
      destructive,
      jobStartType: v11 ? startType : null,
      scheduled: v11 ? scheduled : null,
      repetitionEntries: rep?.RepetitionEntries ?? null,
      steps: v11 ? ((v11.Steps as unknown[]) ?? []).map((s) => (s as { Type?: string }).Type ?? "?") : null,
      safetyMetadataSource: v11 ? "bConnect v1.1" : `unavailable — ${v11Result.reason}`,
    },
    scope: {
      group: target.name ?? null,
      directMembers: direct.length,
      descendantGroups: descendants.length,
      descendantGroupNames: descendants.map((g) => g.name).filter(Boolean),
      endpointsInReach: inScope.length,
      endpointsOnlineNow: live.length,
      onlineEndpointNames: live.map((e) => e.displayName).filter(Boolean),
    },
    whatWouldHappen: {
      instancesExpected: inScope.length,
      executionTiming: timing,
      wouldExecuteNowOn: !v11 || scheduled || passive ? [] : live.map((e) => e.displayName).filter(Boolean),
      reversible:
        "Deleting the resulting instances removes the assignment, but does NOT undo work already executed on an endpoint.",
    },
    verdict,
    blockers,
    meta: {
      elapsedMs: Date.now() - startedAt,
      // LOCAL ADDITION — PER-17 / B4. Say what the counts were computed over,
      // so a truncated walk can never be mistaken for a complete one.
      estate: {
        pageSize: PAGE_SIZE,
        groups: {
          pagesFetched: groupsWalk.pagesFetched,
          totalPages: groupsWalk.totalPages,
          totalItems: groupsTotalItems,
          rowsExamined: groups.length,
          orderBy: GROUP_ORDER_BY,
          truncated: groupsWalk.truncated,
          shortfall: groupsShortfall,
        },
        endpoints: {
          pagesFetched: endpointsWalk.pagesFetched,
          totalPages: endpointsWalk.totalPages,
          totalItems: endpointsTotalItems,
          rowsExamined: endpoints.length,
          orderBy: ENDPOINT_ORDER_BY,
          truncated: endpointsWalk.truncated,
          shortfall: endpointsShortfall,
        },
        truncated: scopeTruncated,
      },
      note:
        (scopeTruncated
          ? `INCOMPLETE — the estate read hit its page cap (groups ${MAX_GROUP_PAGES}, ` +
            `endpoints ${MAX_ENDPOINT_PAGES}). endpointsInReach, endpointsOnlineNow and ` +
            `instancesExpected are LOWER BOUNDS and understate the blast radius. `
          : "") +
        (groupsShortfall || endpointsShortfall
          ? `INCOMPLETE — the server returned fewer rows than its own totalItems ` +
            `(${[groupsShortfall, endpointsShortfall].filter(Boolean).join(" ")}). ` +
            `endpointsInReach, endpointsOnlineNow and instancesExpected are LOWER BOUNDS. `
          : "") +
        "Read-only preview. No assignment was made and nothing was changed.",
    },
  };
}

/**
 * Preview for the three kinds that do not nest: static, dynamic and universal
 * dynamic groups.
 *
 * Shorter than the logical path because the API does the hard part: each of
 * these exposes `/{Kind}/{id}/Endpoints`, which IS the reach. There is no group
 * tree to walk, so `descendantGroups` is 0 as a FACT about this kind rather
 * than as an unmeasured default — the response says which, because "0
 * descendants" read as "no cascade" is precisely the misreading that made the
 * logical-group case dangerous (D9).
 *
 * The two computed kinds get an extra blocker. Their membership is evaluated
 * server-side from a rule, so the preview is a snapshot of a set that can move
 * on its own between previewing and assigning. Nobody has to edit the group for
 * the blast radius to change, and a preview that did not say so would be
 * quietly claiming more than it knows.
 */
async function previewNonNesting(
  client: AxiosInstance,
  opts: PreviewOptions,
  kind: GroupKind,
  groupId: string,
  liveWithinDays: number,
  startedAt: number
): Promise<Record<string, unknown>> {
  const info = GROUP_KINDS[kind];

  const [defRes, membersWalk, v11Result] = await Promise.all([
    client.get(`/jobs/v2.0/JobDefinitions/${opts.jobDefinitionId}`),
    fetchGroupMembers(client, kind, groupId),
    fetchV11Job(client, opts.jobDefinitionId),
  ]);

  const def = defRes.data as Record<string, unknown>;
  const members = membersWalk.items;
  const scopeTruncated = membersWalk.truncated;
  // A completed walk that absorbed fewer rows than the envelope's own
  // totalItems. Measured live: the API can serve an intact header over an
  // empty or short data[]. A genuinely empty group reports totalItems 0, so
  // this stays null there — an empty 200 with a zero count really does mean
  // "this group exists and has no members".
  const membersShortfall = membersWalk.truncated
    ? null
    : shortfallReason(`The ${info.label} membership read`, members.length, membersWalk.totalItems);

  const now = Date.now();
  const ageDays = (e: EndpointRow): number | null =>
    e.lastSeen ? Math.floor((now - new Date(e.lastSeen).getTime()) / DAY_MS) : null;
  const live = members.filter((e) => {
    const d = ageDays(e);
    return d !== null && d <= liveWithinDays && e.isDeactivated !== true;
  });

  const { v11, rep, startType, destructive, scheduled, passive, timing } = assessJob(v11Result);

  const blockers: string[] = [];
  if (destructive === true) {
    blockers.push("job is flagged Destructive (contains a wipe step) — refuse");
  }
  if (destructive === null) {
    blockers.push(`safety metadata unavailable — ${v11Result.reason ?? "unknown reason"}`);
  }
  if (!scheduled && !passive && v11 && live.length > 0) {
    blockers.push(`${live.length} endpoint(s) are online and would execute immediately`);
  }
  if (info.computed) {
    blockers.push(
      `${info.label} membership is evaluated by the server from a rule, not stored — this preview is a ` +
      `SNAPSHOT. The set can change between this call and the assignment without anyone editing the group`
    );
  }
  if (scopeTruncated) {
    blockers.push(
      `scope is INCOMPLETE — the membership read stopped at its page cap ` +
      `(${membersWalk.pagesFetched}/${membersWalk.totalPages}); every count below is a LOWER BOUND ` +
      `and understates the blast radius`
    );
  }
  if (membersShortfall) {
    blockers.push(
      `scope is INCOMPLETE — ${membersShortfall} Every count below is a LOWER BOUND and ` +
      `understates the blast radius`
    );
  }

  const verdict =
    destructive === true ? "REFUSE"
      : blockers.length ? "CONFIRM FIRST"
        : "LOW RISK";

  return {
    query: {
      jobDefinitionId: opts.jobDefinitionId,
      groupKind: kind,
      [info.option]: groupId,
      liveWithinDays,
    },
    job: {
      name: def.name ?? null,
      folder: def.folder ?? null,
      type: def.type ?? null,
      destructive,
      jobStartType: v11 ? startType : null,
      scheduled: v11 ? scheduled : null,
      repetitionEntries: rep?.RepetitionEntries ?? null,
      steps: v11 ? ((v11.Steps as unknown[]) ?? []).map((s) => (s as { Type?: string }).Type ?? "?") : null,
      safetyMetadataSource: v11 ? "bConnect v1.1" : `unavailable — ${v11Result.reason}`,
    },
    scope: {
      // No GET-by-id route exists for these kinds, so the name cannot be read
      // back. Saying null is better than omitting the field and letting a
      // caller assume the logical-group shape.
      group: null,
      groupNameAvailable: false,
      directMembers: members.length,
      descendantGroups: 0,
      descendantGroupNames: [],
      endpointsInReach: members.length,
      endpointsOnlineNow: live.length,
      onlineEndpointNames: live.map((e) => e.displayName).filter(Boolean),
    },
    whatWouldHappen: {
      instancesExpected: members.length,
      executionTiming: timing,
      wouldExecuteNowOn: !v11 || scheduled || passive ? [] : live.map((e) => e.displayName).filter(Boolean),
      reversible:
        "Deleting the resulting instances removes the assignment, but does NOT undo work already executed on an endpoint.",
    },
    verdict,
    blockers,
    meta: {
      elapsedMs: Date.now() - startedAt,
      estate: {
        pageSize: PAGE_SIZE,
        members: {
          pagesFetched: membersWalk.pagesFetched,
          totalPages: membersWalk.totalPages,
          totalItems: membersWalk.totalItems,
          rowsExamined: members.length,
          orderBy: ENDPOINT_ORDER_BY,
          truncated: membersWalk.truncated,
          shortfall: membersShortfall,
        },
        truncated: scopeTruncated,
      },
      scopeModel:
        `${info.label}s do not nest, so assignment cannot cascade the way it does for logical groups. ` +
        `descendantGroups is 0 because this kind HAS no descendants — not because none were found. ` +
        `Reach was read from /${info.segment}/{id}/Endpoints, which returns the membership itself.`,
      note:
        (scopeTruncated
          ? `INCOMPLETE — the membership read hit its ${MAX_ENDPOINT_PAGES}-page cap. endpointsInReach, ` +
            `endpointsOnlineNow and instancesExpected are LOWER BOUNDS. `
          : "") +
        (membersShortfall
          ? `INCOMPLETE — ${membersShortfall} endpointsInReach, endpointsOnlineNow and ` +
            `instancesExpected are LOWER BOUNDS. `
          : "") +
        (info.computed
          ? "Membership is server-computed; this is a snapshot, not a guarantee about assignment time. "
          : "") +
        "Read-only preview. No assignment was made and nothing was changed.",
    },
  };
}
