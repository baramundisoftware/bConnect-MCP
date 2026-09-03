/**
 * A stated policy for the three things this API uses interchangeably: a key
 * that is absent, a collection that is empty, and a count that is zero.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * `phase4/data-reliability.md` §M5. Measured live, bConnect answers a
 * sub-resource read for a parent that has no data with **HTTP 404** — the same
 * status it uses for "that route does not exist" and "that id is wrong". So
 * `list_detected_vulnerabilities_by_endpoint` returns *"Resource not found"*
 * for WIN10CLIENT3, a present, managed, live Windows endpoint. Re-verified
 * 2026-08-03: still 404, while WIN10CLIENT4 answers 200 with totalItems 1.
 *
 * Of the four readings a caller can take from that error — bad id, broken
 * tool, route gone, or "nothing found, therefore zero" — three are wrong and
 * the fourth is dangerous. On this estate the endpoint it lands on is
 * WIN10CLIENT10, the machine `scan-recency.ts` singles out as the one where
 * job history already looks optimistic.
 *
 * ── Why the envelope is null and not empty ──────────────────────────────────
 * §M5 proposed `{ data: [], totalItems: 0, dataAvailable: false, note }`. This
 * module deliberately does NOT use that shape, because it reproduces the
 * defect it was written to remove: any caller that reads `totalItems` without
 * first reading `dataAvailable` sees **0** and reports a clean machine. An
 * empty array and a zero are exactly what a "no vulnerabilities" answer looks
 * like.
 *
 * `data: null` and `totalItems: null` cannot be mistaken for a clean result.
 * A consumer that ignores the flag gets `null`, which breaks loudly at the
 * first `.length` or arithmetic rather than quietly reading as good news. That
 * is the same principle §M5 states in its own last sentence — never let an
 * absent key and an empty array reach a caller as the same JSON — applied to
 * its own proposal.
 *
 * ── Why this is opt-in per route and not a client-wide rule (A9) ────────────
 * The 2026-08-03 audit measured what a blanket rule would cost. Sweeping all
 * 26 endpoints on the reference estate gives 21 × 200 and 5 × 404 — but three
 * of those five are a `LinuxEndpoint` and two `NetworkEndpoint`s, and a 404
 * from `/WindowsEndpoints/{id}/…` is **correct** for them. A client-level
 * rewrite of every 404 on that route would turn "you asked a Windows-only
 * route about a Linux box" into "this machine has no vulnerabilities", which
 * is strictly worse than the error it replaced.
 *
 * So nothing here is automatic. A call site opts in only where 404 is known to
 * be overloaded, and says which platform the route serves, so the resulting
 * note can name that possibility instead of hiding it.
 *
 * ── Why the cause is enumerated and not chosen (A11) ────────────────────────
 * The audit also killed the discriminator that was proposed for this:
 * `/endpoints/v2.0/Endpoints/{id}` returns 200 for all five 404 cases, so its
 * `type` field looked like it could separate them. Verified — WIN10CLIENT3 and
 * WIN10CLIENT10 are **both** `WindowsEndpoint`, so across exactly the two
 * cases that matter the field is constant. The five 404 bodies are 139 B and
 * identical but for `traceId`, so the body carries no signal either.
 *
 * For a Windows endpoint we therefore cannot tell "never scanned" from the
 * other causes, and this module does not pretend otherwise. It lists them.
 * Naming an uncertainty is the honest output; picking one would be the same
 * class of error as the 404 itself.
 */

import { BConnectApiError } from "./tool-error.js";

/**
 * What a read returns when the API could not tell us whether there is data.
 *
 * Never `{ data: [], totalItems: 0 }` — see the header. The nulls are the
 * point: they are unusable by accident.
 */
export interface DataUnavailable {
  data: null;
  totalItems: null;
  /** Always false. Present so a consumer can branch without a type guard. */
  dataAvailable: false;
  /** Short machine-readable code. */
  dataUnavailableReason: "parent-404-overloaded";
  /** One sentence a model can act on. */
  note: string;
  /** Every cause consistent with what was observed, none of them ruled out. */
  possibleCauses: string[];
  /**
   * Causes this route has MEASURED and excluded, with what was measured.
   *
   * Present only where a route has actually done the work. Absence means
   * nothing was excluded — never that nothing could be.
   *
   * It is a separate field rather than a line in `possibleCauses`, because a
   * refuted cause is not a possible one and mixing them would make the list
   * mean two things at once. A reader needs both: what might be true, and what
   * was checked so they do not check it again.
   */
  causesRuledOut?: string[];
}

/** True when a read returned the unavailable envelope rather than data. */
export function isDataUnavailable(value: unknown): value is DataUnavailable {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as DataUnavailable).dataAvailable === false &&
    (value as DataUnavailable).dataUnavailableReason === "parent-404-overloaded"
  );
}

export interface ParentNotFoundPolicy {
  /** Human name of the sub-resource, e.g. "detected vulnerabilities". */
  subject: string;
  /** Discriminator against `HonestNotFound`. Never set on a policy. */
  subResource404?: undefined;
  /**
   * The platform this route serves, e.g. "Windows". Named in the note (A9).
   *
   * REQUIRED, and briefly was not. It was made optional on 2026-08-14 for
   * `/compliance/v2.0/Endpoints/{id}/DetectedRuleViolations`, on the reasoning
   * that its path segment is `/Endpoints/` rather than `/WindowsEndpoints/` and
   * so it must serve every type. That was a path shape read instead of a spec:
   * 26R1 says "Gets detected rule violations for an **Android, iOS or macOS**
   * endpoint by endpoint id". The route is platform-restricted like every other
   * one here, the omission dropped the cause that actually explained its 404s,
   * and the capability had no honest user. Required again.
   */
  servesPlatform: string;
  /**
   * How a caller can find out which cause applies. Kept as an instruction
   * rather than performed here: resolving it costs another request, and the
   * call site decides whether that is worth it.
   */
  howToDisambiguate: string;
  /**
   * What was measured to EXCLUDE missing rights, if anything was.
   *
   * ── Why rights are listed at all (added 2026-08-14) ──────────────────────
   * The enumeration named four causes and not this one, while bConnect refuses
   * on some routes with the literal words *"not found or not visible due to
   * missing rights"* — so a 404 caused by a scoped-away credential was being
   * presented as four causes none of which was the real one. `readRows` in the
   * insights composites had listed rights all along, so the two vocabularies
   * disagreed. Found because the owner changed permissions and asked whether
   * that was the cause, which the envelope gave them no way to consider.
   *
   * ── Why excluding it is a FIELD and not a deletion ───────────────────────
   * `/compliance/v2.0/Endpoints/{id}/DetectedRuleViolations` has since had
   * rights tested and excluded. Leaving the cause listed there would name a
   * possibility already refuted — the same error as claiming a platform
   * restriction that does not exist. Silently dropping it would lose the fact
   * that somebody checked, and the next reader would check again. So the
   * measurement is carried instead, and lands in `causesRuledOut`.
   */
  rightsRuledOut?: string;
}

/** Build the envelope. Exported for tests and for non-throwing call sites. */
export function dataUnavailableForParent(
  parentId: string,
  policy: ParentNotFoundPolicy
): DataUnavailable {
  return {
    data: null,
    totalItems: null,
    dataAvailable: false,
    dataUnavailableReason: "parent-404-overloaded",
    note:
      `The API answered 404 for ${policy.subject} on ${parentId}. On this API a 404 here does NOT ` +
      `mean zero — it is also how the server reports "this parent has no data yet". ` +
      `Do not report this as a clean result. ${policy.howToDisambiguate}`,
    possibleCauses: [
      `${parentId} exists and is managed, but has never produced ${policy.subject} — the most common case.`,
      // "a Windows endpoint" but "an Android, iOS or macOS endpoint". The
      // article was hardcoded to "a" while every declared platform happened to
      // start with a consonant; the first multi-platform route produced "is not
      // a Android...". A test matching /an? Android/ accepted it.
      `${parentId} is not ${/^[aeiou]/i.test(policy.servesPlatform) ? "an" : "a"} ${policy.servesPlatform} endpoint; this route serves ${policy.servesPlatform} endpoints only, and a 404 is correct for any other platform.`,
      `${parentId} is not a valid endpoint id.`,
      // Omitted only where a route has MEASURED that rights are not the cause.
      ...(policy.rightsRuledOut
        ? []
        : [
            `The credential this server runs as may not be permitted to read ${policy.subject} for ` +
              `${parentId}. bConnect refuses some routes with "not found or not visible due to ` +
              `missing rights", so a scoped-away API key or service account can be indistinguishable ` +
              `from absent data. Check the profile's rights on this object before reading the 404 ` +
              `as "no data".`,
          ]),
      `This bConnect deployment does not serve this route.`,
    ],
    ...(policy.rightsRuledOut
      ? { causesRuledOut: [`Missing rights — ${policy.rightsRuledOut}`] }
      : {}),
  };
}

/**
 * The other answer a sub-resource read can give: this route's 404 means what
 * it says.
 *
 * ── Why a declaration and not silence (ARCH-1) ──────────────────────────────
 * The policy above shipped opted into by exactly one route out of the thirty-
 * four sub-resource reads in the suite, and the 2026-08-04 audit measured what
 * that costs on its own sibling: `/compliance/v2.0/Endpoints/{id}/
 * DetectedRuleViolations` answered 404 for six of six valid endpoint ids, and
 * the bare error told the caller it was either a wrong id or a route this bMS
 * does not serve. Both false.
 *
 * Silence cannot be audited: a route with no policy looks exactly like a route
 * nobody has looked at yet, which is what those 33 were. So the two answers are
 * both written down. Use this one where the 404 HAS been checked and is honest,
 * and say what was measured — the next reader has to be able to re-run it:
 *
 *     return readSubResource(
 *       () => this.httpClient.get(`${this.basePath}/Bundles/${id}/BundleApplications`),
 *       id,
 *       notOverloaded404("Measured 2026-08-04: an empty bundle answers 200 with totalItems 0.")
 *     );
 *
 * It changes no behaviour whatsoever — the read is awaited and every status
 * propagates untouched. Its whole value is that it is visible to a reader and
 * to `findSubResourceReads` in sub-resource-audit.ts.
 */
export interface HonestNotFound {
  subResource404: "not-overloaded";
  /** What was measured, and when. */
  reason: string;
}

/** Declare that this route's 404 is a real not-found. See `HonestNotFound`. */
export function notOverloaded404(reason: string): HonestNotFound {
  return { subResource404: "not-overloaded", reason };
}

/** Either half of the declaration a sub-resource read must carry. */
export type SubResource404Declaration = ParentNotFoundPolicy | HonestNotFound;

/**
 * The third case, and the one this module had no words for: the **200** is
 * overloaded, not the 404.
 *
 * ── Measured 2026-08-14, live ───────────────────────────────────────────────
 * `GET /jobs/v2.0/JobDefinitions/{id}/KioskReleases` answers **HTTP 200 with
 * `totalItems: 0` for a job definition that does not exist.** Reproduced with
 * two independent well-formed nonexistent GUIDs. Its own sibling
 * `/JobDefinitions/{id}/JobInstances` answers 404 for those same ids, and the
 * other three KioskReleases parents (Endpoints, LogicalGroups, ADObjects) all
 * answer 404. This route is alone in it across the 78 measured.
 *
 * It is the M5 defect INVERTED. M5 is a missing fact arriving as an error that
 * reads like zero; this is **a wrong id arriving as a factual zero** — no
 * error, nothing to notice, and `list_kiosk_releases_by_job_definition`
 * reporting "this job has no kiosk releases" for a stale or mistyped id.
 *
 * Neither declaration above helps. `notOverloaded404` is *technically* true
 * here — the route's 404 is honest because it never issues one — and saying
 * only that would be actively misleading, because the danger is in the 200.
 *
 * ── Why the parent is checked only when the page is empty ───────────────────
 * A non-empty page is its own proof that the parent exists, so the common case
 * costs nothing. The extra request is paid exactly in the ambiguous case, which
 * is the one that is currently wrong. Measured on the same estate: the parent
 * `GET /JobDefinitions/{id}` answers 200 for a real id, 404 for a nonexistent
 * one and 400 for a malformed one — a complete discriminator.
 *
 * ── Why this throws rather than returning the unavailable envelope ──────────
 * `DataUnavailable` says "we do not know". Here we DO know: the parent is
 * absent, so the id is wrong. That is an error, and it is the same answer every
 * other sub-resource on this API gives for a bad id. Returning the envelope
 * would be its own small dishonesty.
 */
export interface EmptyIsAmbiguousPolicy {
  /** Human name of the sub-resource, e.g. "kiosk releases". */
  subject: string;
  /** Human name of the parent, e.g. "job definition". */
  parentKind: string;
  /** What was measured, and when. Same contract as `notOverloaded404`. */
  reason: string;
}

/** True for a paged body that reports no rows. */
function isEmptyPage(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const page = value as { data?: unknown; totalItems?: unknown };
  if (typeof page.totalItems === "number") {
    return page.totalItems === 0;
  }
  return Array.isArray(page.data) && page.data.length === 0;
}

/**
 * Run a sub-resource read whose EMPTY page cannot be trusted, confirming the
 * parent exists before letting a zero out.
 *
 * `confirmParent` is expected to reject with a 404 `BConnectApiError` when the
 * parent is absent — a plain get-by-id does exactly that. Any other failure
 * from it propagates untouched: a 403 or a 5xx while confirming means we still
 * do not know, and must not be reported as either a zero or a bad id.
 */
export async function readSubResourceWhereEmptyIsAmbiguous<T>(
  read: () => Promise<T>,
  parentId: string,
  confirmParent: () => Promise<unknown>,
  policy: EmptyIsAmbiguousPolicy
): Promise<T> {
  const result = await read();
  if (!isEmptyPage(result)) {
    return result;
  }
  try {
    await confirmParent();
  } catch (error) {
    if (error instanceof BConnectApiError && error.status === 404) {
      throw new BConnectApiError(
        404,
        `${policy.parentKind} ${parentId} does not exist, so this is NOT "no ${policy.subject}". ` +
          `This route answers 200 with totalItems 0 for a ${policy.parentKind} that is absent, ` +
          `which is why the parent was checked. Correct the id and call again; do not report ` +
          `zero ${policy.subject}.`,
        { method: "GET", path: `parent of ${policy.subject}` }
      );
    }
    throw error;
  }
  return result;
}

/** True for the "this 404 is honest" half. */
export function isHonestNotFound(value: SubResource404Declaration): value is HonestNotFound {
  return (value as HonestNotFound).subResource404 === "not-overloaded";
}

/**
 * Run a sub-resource read under a declared 404 policy.
 *
 * With a `ParentNotFoundPolicy`, an overloaded 404 becomes the envelope. Only
 * 404 is translated: every other status keeps its existing behaviour, including
 * 401/5xx, which must stay faults — see `tool-error.ts` for why.
 *
 * With `notOverloaded404(...)` nothing is translated at all; the call site has
 * declared that this route's 404 is honest, and the wrapper exists so that
 * declaration is on the record rather than assumed.
 */
export async function readSubResource<T>(
  read: () => Promise<T>,
  parentId: string,
  policy: ParentNotFoundPolicy
): Promise<T | DataUnavailable>;
export async function readSubResource<T>(
  read: () => Promise<T>,
  parentId: string,
  policy: HonestNotFound
): Promise<T>;
export async function readSubResource<T>(
  read: () => Promise<T>,
  parentId: string,
  policy: SubResource404Declaration
): Promise<T | DataUnavailable> {
  if (isHonestNotFound(policy)) {
    return await read();
  }
  try {
    return await read();
  } catch (error) {
    if (error instanceof BConnectApiError && error.status === 404) {
      return dataUnavailableForParent(parentId, policy);
    }
    throw error;
  }
}

/**
 * Distinguish an ABSENT collection key from a present-but-empty one.
 *
 * The v1.1 inventory routes return `{"EndpointId":"…"}` with the collection
 * key missing rather than an empty array when there is no scan data — the same
 * absent/empty/zero conflation as the 404 above, in a different disguise. An
 * empty array is a fact ("we looked, there are none"); an absent key is not.
 *
 * Returns the rows when the key is present (even if empty), and the
 * unavailable envelope when it is absent.
 *
 * ── Not yet called in production, and kept anyway (ARCH-9) ──────────────────
 * The two v1.1 inventory slices this was written for —
 * `bconnect-endpoints-mcp/src/modules/inventory-scans-v11.ts` and
 * `bconnect-updatemanagement-mcp/src/modules/microsoft-update-v11.ts` — make
 * the absent-key distinction inline instead, and their local version ASSERTS a
 * cause ("No <kind> inventory scan has ever run on endpoint <id>") where the
 * A11 rule above is to enumerate causes and pick none. This is the correct
 * implementation of the same distinction and the two slices should route
 * through it; that edit belongs to those workspaces, so it is recorded here
 * rather than done here. Deleting this would remove the right answer and leave
 * the wrong one.
 */
export function collectionOrUnavailable<T>(
  payload: Record<string, unknown>,
  key: string,
  parentId: string,
  policy: ParentNotFoundPolicy
): { data: T[]; totalItems: number; dataAvailable: true } | DataUnavailable {
  const raw = payload[key];
  if (Array.isArray(raw)) {
    return { data: raw as T[], totalItems: raw.length, dataAvailable: true };
  }
  return dataUnavailableForParent(parentId, policy);
}
