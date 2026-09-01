/**
 * Reading a bConnect route from a composite, safely.
 *
 * Used by patch-readiness and (since 2026-08-12) estate-risk. That migration
 * closed a real defect: estate-risk's own copy read `.data` alone, so a
 * non-envelope 200 and the live-observed empty-page-under-intact-header state
 * both collapsed into "zero rows" and published a clean briefing.
 * `endpoint-briefing.ts` STILL carries its own reader (its reads need per-call
 * 404 declarations and it predates this file); as of 2026-08-22 the two agree
 * on the rules that matter — the short-serve trust break and the
 * unreadable-totalItems refusal below — verified by tests on both, but the
 * reader unification itself remains open work. This header said "shared by
 * every composite" once before a review pointed out that claiming it does not
 * make it so.
 *
 * It exists because those two grew their own copies of one function and they
 * DIVERGED: `estate-risk.ts` still reads `.data` alone where
 * `endpoint-briefing.ts` had learned to check the envelope. One copy, one set
 * of lessons.
 *
 * The lessons, each paid for:
 *
 *  - A 403 is a REPORTABLE state, not an error. A least-privileged deployment
 *    scoped away from one module is the state this suite is being designed
 *    towards, so `validateStatus` lets it arrive as data.
 *  - A 404 does NOT mean zero. Measured on this estate: 2 of 23 real Windows
 *    endpoints answer 404 on the compliance sub-resource, meaning "never
 *    scanned". Saying "0 vulnerabilities" there is the false all-clear this
 *    project has spent its history removing.
 *  - A 200 whose body is not the paged envelope is a SHAPE mismatch, not an
 *    empty page. Treating it as zero rows hands back a clean bill of health for
 *    a response nobody understood.
 *  - A sentinel date is an ABSENT fact, not an extreme one. bConnect emits
 *    .NET's DateTime.MinValue ("0001-01-01T00:00:00") for "never happened";
 *    read as a date it becomes ~739,839 days and a briefing reports antivirus
 *    definitions two thousand years old. Found when a machine was switched on
 *    mid-session, by which point 32 tests had passed over it.
 */

import {
  sanitizeEstateText,
  isHonestNotFound,
  type SubResource404Declaration,
} from "@bconnect/mcp-core";
import type { HttpLike, DimensionUnavailable } from "./estate-risk.js";

export type { HttpLike, DimensionUnavailable };

export const unavailable = (reason: string): DimensionUnavailable => ({ available: false, reason });

export const isUnavailable = (v: unknown): v is DimensionUnavailable =>
  typeof v === "object" && v !== null && (v as DimensionUnavailable).available === false;

export const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

/**
 * Date arithmetic comes from mcp-core, NOT from a copy here.
 *
 * This module was written to stop exactly this kind of duplication, and then
 * held its own `daysSince`/`isSentinelDate` while endpoint-briefing.ts held a
 * second pair (spelled `dayssince`) — two copies of the code whose whole job is
 * to be the one copy. Both floored the delta, so both turned a timestamp one
 * millisecond in the future into an age of MINUS ONE DAY.
 *
 * Re-exported rather than re-implemented so existing importers are unchanged.
 */
export { isSentinelDate, daysSince, isFutureBeyondSkew } from "@bconnect/mcp-core";

/** A route returning one bare object. */
export async function readOne(
  http: HttpLike,
  path: string,
): Promise<Record<string, unknown> | DimensionUnavailable> {
  try {
    const res = await http.get(path, { validateStatus: () => true });
    if (res.status === 403) {return unavailable(`this credential may not read ${path} (HTTP 403)`);}
    if (res.status === 404) {
      return unavailable(`${path} answered 404 — no data for this endpoint, or it is not of this type`);
    }
    if (res.status !== 200) {return unavailable(`${path} answered HTTP ${res.status}`);}
    return (res.data ?? {}) as Record<string, unknown>;
  } catch (err) {
    return unavailable(`${path} could not be reached (${err instanceof Error ? err.message : String(err)})`);
  }
}

export interface PagedResult {
  rows: Record<string, unknown>[];
  totalItems: number | null;
  /** True when the estate holds more rows than were read. */
  truncated: boolean;
}

/**
 * A route returning the paged envelope.
 *
 * ── `declaration`, and why it is an ARGUMENT (ARCH-1, 2026-08-14) ───────────
 * A sub-resource read has to say what its 404 means. Every other module does
 * that by routing through `readSubResource`, and the audit finds it by looking
 * inside the enclosing CLASS METHOD — which cannot work here, because these
 * reads live in top-level functions.
 *
 * Widening the audit to top-level functions was the obvious repair and is
 * wrong: `buildEndpointBriefing` holds four of these reads in one body, and
 * `getDeploymentCoverage` three in a single `Promise.all([...])`, so one
 * declaration would silently vouch for all of them. Passing it here binds it to
 * ONE read, and the audit reads it off the call's own argument list.
 *
 * It is not decorative. When the 404 arrives, a `notOverloaded404` reason is
 * appended to the note, so the caller is told what was measured rather than the
 * generic four-cause list alone — and dropping the argument changes the output,
 * which is what keeps it from rotting.
 *
 * The unused `extraParams` it replaced had no callers anywhere in src.
 */
export async function readRows(
  http: HttpLike,
  path: string,
  pageSize: number,
  declaration?: SubResource404Declaration,
): Promise<PagedResult | DimensionUnavailable> {
  try {
    const res = await http.get(path, {
      params: { PageSize: pageSize },
      validateStatus: () => true,
    });
    if (res.status === 403) {return unavailable(`this credential may not read ${path} (HTTP 403)`);}
    if (res.status === 404) {
      // The measured reason is APPENDED, never substituted: the four causes
      // stay listed because a measurement on one estate does not retire them.
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
        typeof body.note === "string" ? sanitizeEstateText(body.note) : `${path} reports its data as unavailable — this does NOT mean zero`,
      );
    }
    if (!Array.isArray(body.data)) {
      return unavailable(`${path} answered 200 with no recognisable data[] array — shape not understood`);
    }
    const rows = body.data as Record<string, unknown>[];
    // ABSENT (or JSON null) stays null: the 26R1 envelope schemas declare no
    // required fields, so a missing total is a legal 200 meaning "no total
    // known". PRESENT BUT UNREADABLE — a string "27", a boolean — is a
    // different fact: nulling it switched every downstream truncation and
    // shortfall check off at once (probed 2026-08-22: 5 rows under totalItems
    // "9" reported truncated: false). Same shape as the shortfallReason and
    // paginateAll defects fixed in mcp-core on 2026-08-19, handled here like
    // the data[] arm above: loud, never a silent zero.
    const rawTotal = body.totalItems;
    if (rawTotal !== undefined && rawTotal !== null && !(typeof rawTotal === "number" && Number.isFinite(rawTotal))) {
      return unavailable(
        `${path} answered 200 with a totalItems that is not a number (type ${typeof rawTotal}) — shape not understood`,
      );
    }
    const totalItems = typeof rawTotal === "number" ? rawTotal : null;
    return { rows, totalItems, truncated: totalItems !== null && totalItems > rows.length };
  } catch (err) {
    return unavailable(`${path} could not be reached (${err instanceof Error ? err.message : String(err)})`);
  }
}
