/**
 * `resultTrustworthy` — the shared completeness contract (audit finding M4)
 *
 * ── The rule this file exists to serve, in the owner's wording (2026-08-14) ──
 *
 *     A response must never claim more certainty than it has.
 *
 * Narrower and more testable than "never spare accuracy", and it is what the
 * code already does. It PERMITS an incomplete answer — every bounded walk in
 * this suite is one — and forbids an incomplete answer that looks complete.
 * That resolves the standing tension between completeness and honesty: the
 * answer may be partial, it may not be silently partial.
 *
 * Two families fail it, and only the first has vocabulary here:
 *   - a MISSING fact rendered as a good fact — 404 read as zero, unread as
 *     clean, a bounded walk's length published as an estate total. That is what
 *     `resultTrustworthy` and the helpers below are for.
 *   - a HALLUCINATED fact — the response ASSERTING something it never read. A
 *     property observed on one page and stated of the collection; a label
 *     describing rows the tool did not fetch. `resultTrustworthy` does not
 *     catch these, because nothing was incomplete: the tool simply said more
 *     than it knew. `shape-response.ts`'s `meta.constant` is the live example.
 *
 * ── A FOURTH family, measured 2026-08-14, and this file cannot see it ───────
 * **bConnect silently filters list results by the credential's rights.** Not a
 * 403, not a 404 — HTTP 200, a well-formed envelope, `totalItems` agreeing with
 * `data`, and fewer rows. Measured by reading the same routes with two API keys
 * on one estate, the second bound to a profile that can see only the Windows 11
 * machines:
 *
 *     /endpoints/v2.0/Endpoints                 27 -> 9
 *     /endpoints/v2.0/WindowsEndpoints          23 -> 9
 *     /endpoints/v2.0/LogicalGroups             19 -> 1
 *     /compliance/v2.0/DetectedVulnerabilities  2454 -> 1544
 *     /jobs/v2.0/JobInstances                   232 -> 133
 *     /software/v2.0/InstalledWindowsSoftware   1696 -> 1036
 *     /jobs/v2.0/JobDefinitions                 170 -> **0**
 *
 * That last row is the whole problem in one line: a restricted credential asks
 * "what jobs are defined?" and is told **zero, with HTTP 200**. Not an error,
 * not a warning — a confident, complete-looking nothing, where 170 exist.
 *
 * Every condition below is SATISFIED for those responses. The walk was not
 * bounded. The page was not short. `totalItems` was not null and did not exceed
 * the rows returned. No 404 was translated. There is nothing incomplete to
 * detect, because from the API's side nothing IS incomplete — the estate the
 * credential can see really does contain nine endpoints. The response is a true
 * statement about a smaller estate, presented as a statement about the estate.
 *
 * So `resultTrustworthy` is structurally blind here, exactly as it is to the
 * hallucinated family, and for the same reason: it measures whether a read
 * FINISHED, not whether the reader was allowed to see everything.
 *
 * Not filtered on the same run, so the scoping is per object type rather than
 * global: ADObjects 60 -> 60, UniversalDynamicGroups 55 -> 55, Microservices
 * 200 -> 200, Bundles 1 -> 1. Endpoint-derived data is scoped; the rest is not.
 *
 * ── What this means for every figure in this project ───────────────────────
 * Every "measured live" count in this repository is conditional on the API key
 * it was measured with. A deployer running a least-privileged credential —
 * which this project's own security posture recommends — gets systematically
 * understated answers with no signal.
 *
 * The fix is NOT a completeness check, because there is no incompleteness to
 * find. It is a DISCLOSURE, in the same family as the truncation disclosure
 * (`suite-truncation-disclosure.test.ts`): an estate-wide answer must say that
 * its counts are what this credential may see, not what exists. That is
 * `CREDENTIAL_SCOPE_NOTE` below, and `suite-credential-scope-disclosure` makes
 * a new estate-wide aggregate carry it or record why not.
 *
 * ── Where it bites: MEASURED at TEN of ten, after a first pass said one ─────
 * The scoping is deliberate: it is how delegated administration works, and a
 * team key SHOULD see the team's machines. So the question is not whether to
 * stop it but which answers stop being true.
 *
 * The first pass (2026-08-14, `scripts/compare-composites-by-scope.mjs`) ran the
 * five INSIGHTS composites and found one diverging aggregate. That was read as
 * "the disclosure work is one tool", and it does not support that conclusion —
 * for two structural reasons, neither of which is about the estate:
 *
 *   1. Its case list held the five insights tools. The estate-wide aggregates in
 *      this repo are TEN, across five servers. The ones it never ran read
 *      exactly the routes the scoping was measured on.
 *   2. Its divergence flag was `differs && bothTrusted`, over a projection of
 *      `{ trustworthy, headline[0] }`. `get_patch_readiness` and
 *      `get_deployment_coverage` were already untrustworthy with BOTH keys, so
 *      the flag could not fire for them by construction — and both modules
 *      `unshift` their INCOMPLETE line to `headline[0]` when untrustworthy.
 *      patch-readiness's reads "INCOMPLETE: N of 4 sources could not be read
 *      (...)", which carries no estate numbers at all: byte-identical across the
 *      two credentials however far the counts underneath diverge.
 *
 * So ONE aggregate of ten had actually been tested for the divergence the
 * conclusion was about. `scripts/compare-estate-aggregates-by-scope.mjs` tests
 * all ten, comparing every primitive leaf rather than a chosen projection and
 * subtracting a MEASURED run-to-run noise set (the full key runs twice) rather
 * than a hand-written ignore-list. Measured 2026-08-16:
 *
 *   get_fleet_summary           152 leaf paths differ   BOTH true
 *   get_stale_endpoints         224                     BOTH true
 *   get_security_posture         72                     BOTH true
 *   get_vulnerability_exposure  157                     BOTH true
 *   get_unpatched_endpoints     166                     BOTH true
 *   get_estate_risk_briefing    107                     BOTH true
 *   explain_job_failure         246                     BOTH true
 *   diagnose_job                 14                     true / false
 *   get_patch_readiness         139                     both false, unrelated
 *   get_deployment_coverage      82                     both false, unrelated
 *
 * **Ten of ten diverge. Eight assert `resultTrustworthy: true` on at least one
 * side while giving different answers.** The two that do not are false for
 * reasons that have nothing to do with scoping, so the flag does not distinguish
 * them either — it merely happens to be off, and would be on for a healthier
 * estate. Confirmed directly: called through the restarted MCP servers against a
 * DIFFERENT logical group, get_deployment_coverage answered
 * `resultTrustworthy: true`.
 *
 * The last two arrived late, and only because two exemptions were checked rather
 * than trusted. Both had been recorded as "per-object, reached by an id the
 * caller already holds":
 *
 *   explain_job_failure  every option is OPTIONAL, so the DEFAULT call walks
 *                        every JobInstance and clusters the estate's failures.
 *                        distinctCauses 6 -> 1, jobsAffected 8 -> 2. The
 *                        exemption described the arguments it MAY take, not the
 *                        call it answers.
 *   diagnose_job         the id bounds which JOB, not which endpoints' instances
 *                        of it are visible.
 *
 * The sharp part is not that counts shrink; it is that some reach ZERO or vanish:
 * `get_security_posture` reports `tpmNotEnabled` 10 -> 0 and
 * `noBitLockerVolumeData` 4 -> 0; `get_unpatched_endpoints` reports
 * `neverScanned` 6 -> 0; `get_fleet_summary` drops `byType.NetworkEndpoint`
 * entirely. A scoped key asking "how secure are we" is told zero machines lack
 * TPM. That is the MISSING-fact family above, arriving through a door this file
 * structurally cannot watch.
 *
 * Per-OBJECT composites are unaffected, and that is a real design result rather
 * than luck: a question about one endpoint both credentials can see has the
 * same answer for both. `get_endpoint_briefing` came back identical at 97 of 97
 * leaves, and serves as the known NEGATIVE that proves the instrument
 * discriminates. The exposure is in aggregation, not in joining.
 *
 * A predicted failure that did NOT occur, recorded so nobody re-derives it:
 * `get_endpoint_reach` was expected to mix scopes, because it walks every
 * universal dynamic group (unscoped, 55 for both) and reads membership per
 * group (endpoint-derived, therefore scoped). It returned the same answer to
 * both credentials. The hypothesis was reasonable and wrong.
 *
 * ── Why the disclosure is UNCONDITIONAL, and cannot be a detection ──────────
 * Nothing in a response reveals that the credential is scoped. `totalItems` is
 * itself filtered, so the envelope agrees with the rows; no header, status or
 * field differs. And no bConnect route returns a profile's permission set —
 * `get_access_rights` is per OBJECT — so the server cannot be asked either.
 * A conditional disclosure would therefore have to be a heuristic, and a
 * heuristic here is indistinguishable from a guess. The sentence is printed
 * always, which is affordable precisely because it is always true.
 *
 * ── The triage rule that bounds this work: REACHABILITY ──────────────────────
 * A defect is must-fix when a REAL ESTATE produces an input that triggers it.
 * One that is real in code but unreachable in practice — no production caller,
 * a shape the API never returns, a configuration nobody runs — is recorded at
 * the code and not fixed. Without that bound, "never spare accuracy" justifies
 * unlimited work on paths nothing reaches. Corollary: a defect gated behind an
 * off-by-default flag ranks below one live in the default posture.
 *
 * ── What the field means ─────────────────────────────────────────────────────
 * `resultTrustworthy: false` means **some input this response was computed from
 * was incomplete**, so the numbers below are a floor, not a total, and an
 * absence in them means "not read", never "not present". It is not a severity,
 * not a health score, and not a comment on the bMS.
 *
 * `resultTrustworthy: true` means **every read this response was computed from
 * FINISHED** — no walk hit its bound, no page came back shorter than the
 * envelope's own total, nothing threw. It is a statement about the READING.
 *
 * **It is NOT, and cannot be, a statement that the credential was shown the
 * whole estate.** This wording is narrower than the one this file carried until
 * 2026-08-16, which read "`false` means the response is not a statement about
 * the whole estate" — and so sold `true` as the opposite. The credential-scoping
 * measurement above disproves that reading: a rights-scoped key is served nine
 * endpoints of twenty-three, every read completes, and the flag is correctly
 * green beside an answer about a smaller estate. The flag was never wrong; the
 * definition claimed more than the flag measures, which is the same failure the
 * flag exists to prevent, made about the flag itself.
 *
 * So the two questions are separated, and both are answered:
 *
 *   "did the reads finish?"        -> `resultTrustworthy`, computed per response
 *   "was I shown everything?"      -> `CREDENTIAL_SCOPE_NOTE`, unanswerable from
 *                                     here and therefore stated, not computed
 *
 * Do NOT re-widen this definition, and do not set `resultTrustworthy: false` for
 * scoping. It is false on every response the moment you do, which destroys the
 * one signal that does discriminate — and it would be a lie in the other
 * direction, because the reads genuinely did finish.
 *
 * The three conditions that must set it false, all of them measured in this
 * repository rather than imagined:
 *
 *   1. **A bounded walk that hit its bound.** `paginateAll` reports `truncated`;
 *      any composite that renders a count over a truncated walk is reporting an
 *      undercount as a total.
 *   2. **A walk that absorbed fewer rows than the envelope's own `totalItems`.**
 *      The exact check, not a heuristic floor — this is the P0-NEW assertion in
 *      `exposure.ts`.
 *   3. **An input that failed outright** — a fetch that threw, or an envelope
 *      that answered HTTP 200 with nothing in it (finding B10).
 *
 * ── Why it needs a shared home ───────────────────────────────────────────────
 * Before this file, `resultTrustworthy` existed at exactly two lines in the
 * whole suite (`exposure.ts`, `unpatched.ts`), was not declared anywhere, and
 * had no consumer outside demo scripts. Meanwhile `stale-endpoints.ts` invented
 * a numeric `truncated` for the same idea and shares no name with it, and five
 * other composites had completeness conditions they simply did not express —
 * because there was nothing to reach for. That is how
 * `get_security_posture` came to answer "No posture issues found in the checked
 * dimensions" over an estate the server had just described as carrying 12,400
 * detected threats.
 *
 * ── The rule that makes it worth setting ─────────────────────────────────────
 * A flag alone is not the fix. **The prose must change too.** A headline that
 * reads as an estate verdict over a partial read is the defect; adding a
 * `false` beside it and leaving the headline alone just moves the lie one field
 * to the left. `reasons` exists so the caller is told what was short and by how
 * much, in numbers, and so the composite has something to splice into its own
 * verdict text.
 *
 * Deliberately NOT wired to `isError`. These responses carry real, useful data
 * — a partial read of a large estate is worth returning — and the suite's error
 * channel is for calls that failed. Whether an untrustworthy result should also
 * be an error is a product decision, not a helper's; see M4.
 */

/** The completeness verdict a composite tool attaches to its own response. */
export interface ResultTrust {
  /**
   * False when any input this response was computed from was incomplete.
   * See the module header — this is a statement about coverage, not health.
   */
  resultTrustworthy: boolean;
  /**
   * Every condition that made it false, in plain language and carrying numbers.
   * Empty when `resultTrustworthy` is true. Order is the order given.
   */
  resultTrustworthyReasons: string[];
}

/**
 * The sentence every ESTATE-WIDE aggregate owes its caller, unconditionally.
 *
 * ── Why a shared constant and not eight strings ─────────────────────────────
 * Eight copies of one sentence is a hand-written list by another name, and this
 * project has found that class four times: it does not fail when it goes stale,
 * it reports a clean figure for something it never looked at. Here the failure
 * would be quieter still — seven tools reworded and one left behind, with
 * nothing to notice. `suite-credential-scope-disclosure` asserts the IMPORTED
 * constant reaches each response, so a copy-pasted paraphrase fails.
 *
 * ── Why the wording carries no numbers ──────────────────────────────────────
 * An earlier draft quoted the measurement (27 -> 9 endpoints, 2,454 -> 1,544
 * detections, 170 -> 0 job definitions) because it makes the warning concrete
 * and credible. Those are figures from ONE estate — ours. Shipped, every
 * customer's response would carry our lab's numbers as though they described
 * theirs, which is the hallucinated-fact family in the very text written to
 * prevent the missing-fact one. The numbers live in the module header, where
 * they are a record of what we measured rather than a claim about the reader.
 *
 * ── Where it goes ───────────────────────────────────────────────────────────
 * `meta.credentialScope`, beside `resultTrustworthy` rather than inside it —
 * the two answer different questions and must not be conflated. See the module
 * header: "did the reads finish?" versus "was I shown everything?".
 */
export const CREDENTIAL_SCOPE_NOTE =
  "Counts here describe the estate THIS API KEY MAY SEE. bConnect filters list results by the " +
  "key's rights and answers HTTP 200 with fewer rows and no warning, so a rights-scoped key is " +
  "served a smaller estate that looks complete. A zero or a missing category therefore means " +
  "'none among the objects this key can see', never 'none exist'. resultTrustworthy reports " +
  "whether the reads FINISHED; it cannot report whether this key was shown the whole estate.";

/**
 * Compose a `ResultTrust` from a list of conditions.
 *
 * Each argument is either a sentence describing an incompleteness, or
 * `null`/`undefined`/`""` meaning "this condition did not apply" — which is the
 * shape the existing `libraryUnavailable` / `detectionsIncomplete` flags already
 * use, so a composite passes them straight in.
 *
 * @example
 * ```ts
 * const trust = assessResultTrust(
 *   analysis.libraryUnavailable,
 *   analysis.detectionsIncomplete,
 *   walk.truncated
 *     ? `The endpoint listing walk covered ${walk.pagesFetched} of ${walk.totalPages} pages.`
 *     : null
 * );
 * // -> { resultTrustworthy: false, resultTrustworthyReasons: [ ... ] }
 * ```
 */
export function assessResultTrust(
  ...conditions: Array<string | null | undefined>
): ResultTrust {
  const reasons = conditions.filter(
    (c): c is string => typeof c === "string" && c.trim().length > 0
  );
  return { resultTrustworthy: reasons.length === 0, resultTrustworthyReasons: reasons };
}

/**
 * The sentence a bounded walk owes its caller when it hit the bound.
 *
 * One wording, so `pagesFetched`/`totalPages` are reported the same way in every
 * composite and a reader never has to guess whether a bare `pagesFetched: 25`
 * means "the history was 25 pages long" or "we stopped at 25".
 *
 * @param what   what was being walked, as a noun phrase ("the endpoint listing")
 * @param walk   the `paginateAll` result's page counters
 * @param boundName  the constant that produced the bound, named so it is greppable
 */
export function truncationReason(
  what: string,
  walk: { pagesFetched: number; totalPages: number; truncated: boolean },
  boundName: string
): string | null {
  if (!walk.truncated) {
    return null;
  }
  return (
    `${what} was read to page ${walk.pagesFetched} of ${walk.totalPages} ` +
    `(bounded by ${boundName}), so this is a partial read. Counts derived from it are a ` +
    `floor, not a total, and anything absent from them was not read rather than not present.`
  );
}

/**
 * The sentence a walk owes its caller when it absorbed fewer rows than the
 * envelope's own `totalItems` said exist — the exact P0-NEW assertion.
 *
 * Returns null when the envelope OMITTED `totalItems` (nothing to assert
 * against) or when the walk covered it. A `totalItems` that is present but not
 * a finite number is neither of those: it returns a reason saying the count
 * could not be checked, because silently skipping the check is how five callers
 * lose their only shortfall guard at once.
 */
export function shortfallReason(
  what: string,
  absorbed: number,
  totalItems: number | string | null | undefined
): string | null {
  if (totalItems === null || totalItems === undefined) {
    return null;
  }

  // ABSENT and UNREADABLE are different, and conflating them is how a backstop
  // disappears. This used to read `typeof totalItems !== "number"`, which sent
  // BOTH cases down the same "nothing to assert against" path — so an envelope
  // reporting `"totalItems": "1544"` as a string silently switched this check
  // off, for the five walk callers that rely on it as their only shortfall
  // guard. Measured 2026-08-19: `shortfallReason("w", 5, "9")` returned null.
  //
  // Same shape as the `paginateAll` defect found the same day: a value that is
  // present but not usable, absorbed as though it were missing. NaN already
  // behaved correctly here by accident — `typeof NaN === "number"` is true and
  // `absorbed >= NaN` is false, so it fell through and emitted a reason.
  // Only a number, or a non-empty numeric STRING, counts as readable.
  // Plain `Number(x)` is too permissive for a guard: it turns `true` into 1 and
  // `""` into 0, either of which would satisfy `absorbed >= declared` and
  // suppress the check again through a different door.
  const declared =
    typeof totalItems === "number"
      ? totalItems
      : typeof totalItems === "string" && totalItems.trim() !== ""
        ? Number(totalItems)
        : Number.NaN;
  if (!Number.isFinite(declared)) {
    return (
      `${what} yielded ${absorbed} row(s) and the server reported totalItems as ` +
      `${typeof totalItems === "string" ? JSON.stringify(totalItems) : String(totalItems)}, which is not a number this walk can check itself ` +
      `against. Treat the count as unverified rather than complete.`
    );
  }
  if (absorbed >= declared) {
    return null;
  }
  return (
    `${what} yielded ${absorbed} row(s) but the server reported ${declared} exist — ` +
    `${declared - absorbed} row(s) were not read.`
  );
}
