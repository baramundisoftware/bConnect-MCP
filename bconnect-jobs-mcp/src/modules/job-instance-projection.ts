/**
 * Response projection for the job-instance list tools (finding TOK-7 / TOK-27)
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * `GET /JobInstances` returns every field of every instance, including the
 * nested `steps[]` array with its per-step `windowsApplicationId` /
 * `windowsInventoryTemplateId` / `windowsComplianceScanProfileId` GUIDs and
 * per-step `stateDescription` prose. Measured on this estate (live page 0,
 * `PageSize=20`, 2026-08-02):
 *
 *     20 rows, everything                    21,389 B
 *     20 rows, `steps[]` removed             14,044 B    (steps[] = 34.3%)
 *
 * and `jobDefinitionDisplayName` was byte-identical to `jobDefinitionName` on
 * 13 of those 20 rows. `explain_job_failure`'s own description already warns
 * callers off the raw tool ("the raw history is ~1.3 KB per instance across
 * dozens of pages") — but that was advisory prose, and the tool still returned
 * everything by default.
 *
 * ── What this module does, and deliberately does not do ─────────────────────
 * It is a thin binding of `@bconnect/mcp-core`'s `createListShaper` to the
 * job-instance row shape, plus one rule core has no primitive for. It is called
 * from the tool case arms in src/index.ts and nowhere else — in particular NOT
 * from `src/modules/jobs.ts`, so `explain_job_failure`, `diagnose_job` and
 * `preview_assignment` keep receiving full rows including `steps[]`, which all
 * three read (see explain-job-failure.ts:205 and diagnose-job.ts:218). Those
 * three are protected demo tools; they get the detail by going straight to the
 * client, not by weakening the default here.
 *
 * ── Three rules ─────────────────────────────────────────────────────────────
 * 1. `steps[]` is dropped unless `includeSteps: true`. `get_job_instance`
 *    returns it in full for one instance, and it is the single biggest block on
 *    a page nobody asked to see step-level detail from.
 * 2. A column that holds one value across the whole page is dropped and that
 *    value reported once in `meta.constant` — which is what `endpointId` /
 *    `endpointName` are on `list_job_instances_by_endpoint`, and what
 *    `jobDefinitionId` / `jobDefinitionName` are on
 *    `list_job_instances_by_definition`. Only the columns in
 *    `CONSTANT_DROP_CANDIDATES` are eligible: this is deliberately NOT core's
 *    blanket `dropConstantColumns`, because a page that happens to be
 *    homogeneous would then lose `state`, and a caller filtering rows on
 *    `state` would get zero matches and no error. Scope and provenance columns
 *    are droppable; the per-row answer is not. A two-row minimum keeps a
 *    one-row page from having every eligible column declared "constant".
 * 3. `jobDefinitionDisplayName` is omitted on the rows where it is exactly
 *    `jobDefinitionName`, and kept on the rows where it differs. The evaluation
 *    verifier found both cases on one page ('INSTALL: Google Chrome' vs
 *    'Google Chrome'), which is why this is emit-when-different rather than a
 *    blanket drop.
 *
 * `stateDescription` is deliberately KEPT even though the finding lists it as
 * derivable. It restates `state` + `lastAction` only on the successes; on the
 * rows that matter it is the only place the failure text lives ("Retry pending
 * on 02.08.2026 at 12:27: Could not connect to client. (Unable to reach client
 * [172.16.1.2] via ping)"). Dropping it would push every failure investigation
 * to `detail: true` and give the saving straight back.
 *
 * Nothing here is lossy in information: a dropped constant is in `meta`, an
 * omitted display name equals the name beside it, and `detail: true` returns
 * the API payload object unchanged.
 */

import { createListShaper, findConstantColumns, type ListEnvelope, type Row } from "@bconnect/mcp-core";

/** How a caller gets back what the compact projection left out. */
export const JOB_INSTANCE_FULL_MODE_HINT =
  "steps[] omitted; pass includeSteps:true for steps, or detail:true for the raw API record.";

/**
 * `meta` key naming the field that was omitted only on the rows where it
 * duplicated another field, and which field that was.
 */
export const OMITTED_WHEN_EQUAL_META_KEY = "omittedWhenEqual";

/**
 * The only columns eligible to be dropped for being constant across a page.
 *
 * Two groups, and nothing else:
 *   - scope    the caller already knows these, because they scoped the query by
 *              them (`list_job_instances_by_endpoint` echoes one endpointId on
 *              every row of the page)
 *   - noise    provenance and counters that carry no per-row information when
 *              they are identical everywhere
 *
 * Everything absent from this list survives even when it is constant —
 * `id`, `state`, `stateDescription`, `start`, `lastAction`, `nextExecution`,
 * `successfulExecutions`, `erroneousExecutions`. Those are what a caller reads
 * per row to decide something, and a script that filters on `state` must not
 * silently see zero matches because one page happened to be homogeneous.
 */
export const CONSTANT_DROP_CANDIDATES: readonly string[] = Object.freeze([
  // scope
  "jobDefinitionId",
  "jobDefinitionName",
  "jobDefinitionDisplayName",
  "endpointId",
  "endpointName",
  // noise
  "jobDefinitionType",
  "endpointType",
  "initiator",
  "retries",
  "delays",
]);

/** Below this many rows every column of the page is trivially "constant". */
export const MIN_ROWS_FOR_CONSTANT_DROP = 2;

const shapeWithoutSteps = createListShaper({
  alwaysDrop: ["steps"],
  fullModeHint: JOB_INSTANCE_FULL_MODE_HINT,
});

const shapeWithSteps = createListShaper({
  fullModeHint: "Pass detail:true for the raw API record.",
});

export interface JobInstanceShapeOptions {
  /** `detail: true` — return the API payload object unchanged. */
  full?: boolean;
  /** `includeSteps: true` — keep `steps[]` in the compact projection. */
  includeSteps?: boolean;
  /** The caller's tool arguments (unused today; kept for `dropEchoedArgs`). */
  args?: Record<string, unknown>;
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rule 2: drop the eligible columns that hold one value across the whole page,
 * recording each dropped column's single value once in `meta.constant`.
 *
 * Built on core's `findConstantColumns` primitive rather than its
 * `dropConstantColumns` flag, because the flag drops every constant column and
 * this row shape has columns that must survive being constant — see
 * `CONSTANT_DROP_CANDIDATES`.
 */
export function dropConstantScopeColumns<TPayload>(payload: TPayload): TPayload {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows) || rows.length < MIN_ROWS_FOR_CONSTANT_DROP) {
    return payload;
  }
  const objectRows = rows.filter(isRow);
  if (objectRows.length !== rows.length) {
    return payload;
  }

  const constant = findConstantColumns(objectRows);
  const drop = CONSTANT_DROP_CANDIDATES.filter((key) => key in constant);
  if (drop.length === 0) {
    return payload;
  }

  const shaped = objectRows.map((sourceRow) => {
    const copy = { ...sourceRow };
    for (const key of drop) {
      delete copy[key];
    }
    return copy;
  });

  const existingMeta = (payload as { meta?: Record<string, unknown> }).meta;
  // ── Scope the claim, exactly as core does ───────────────────────────────
  // This module builds `meta.constant` by hand rather than via core's
  // `dropConstantColumns`, for the good reason in the header — the blanket
  // flag would drop `state` on a homogeneous page. Building it by hand also
  // meant missing the scope core gained on 2026-08-14, and the numbers here
  // are worse than the case that prompted it: the live-shaped fixture is 4
  // rows against totalItems 229, so `retries: 0` answered "are jobs retrying?"
  // with NO from a page of four, with the column stripped from every row so
  // nothing could contradict it. Seven tools reach this shaper.
  //
  // Absent total is scoped too — unknown is not "the page covers everything".
  const total = (payload as { totalItems?: unknown }).totalItems;
  const scoped = typeof total !== "number" || shaped.length < total;
  return {
    ...(payload as object),
    data: shaped,
    meta: {
      ...(existingMeta ?? {}),
      constant: Object.fromEntries(drop.map((key) => [key, constant[key]])),
      ...(scoped
        ? {
            constantScope:
              typeof total === "number"
                ? `Observed across the ${shaped.length} row(s) in this response, of ${total} in ` +
                  `the collection — not verified on the rest.`
                : `Observed across the ${shaped.length} row(s) in this response. The envelope did ` +
                  `not report a collection total, so whether it holds beyond them is unknown.`,
          }
        : {}),
    },
  } as TPayload;
}

/**
 * Rule 3: drop a display-name column on the rows where it is exactly the name
 * column beside it, keep it where it differs, and say so once in `meta`.
 *
 * Returns the payload untouched when it is not a `{ data: [...] }` envelope or
 * when no row was a duplicate — so the `meta` note is never paid for on a page
 * that did not benefit from it.
 *
 * ── Why the column pair is a parameter ──────────────────────────────────────
 * The rule was written for job INSTANCES
 * (`jobDefinitionDisplayName`/`jobDefinitionName`) and `list_job_definitions`
 * needs exactly the same rule over `displayName`/`name`: measured across all
 * 170 definitions on the reference estate, the two are identical on **138 rows
 * (81.2%)** and genuinely differ on the rest ("OS: Windows 11 In-Place Upgrade"
 * against "Windows 11 In-Place Upgrade"), which is the same emit-when-different
 * shape this rule already exists for.
 *
 * Parameterising beats copying: a second implementation of "omit it only where
 * it is byte-identical" is the hand-maintained parallel copy this codebase has
 * been bitten by more than any other defect, and the subtle half — that the
 * `meta` note is withheld when nothing collapsed — is the half a copy loses.
 * The defaults keep every existing call site behaving identically.
 */
export function collapseDuplicateDisplayNames<TPayload>(
  payload: TPayload,
  displayNameField = "jobDefinitionDisplayName",
  nameField = "jobDefinitionName"
): TPayload {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) {
    return payload;
  }

  let collapsed = 0;
  const shaped = rows.map((row) => {
    if (!isRow(row)) {
      return row;
    }
    if (
      displayNameField in row &&
      nameField in row &&
      row[displayNameField] === row[nameField]
    ) {
      collapsed += 1;
      const { [displayNameField]: _omitted, ...rest } = row;
      return rest;
    }
    return row;
  });

  if (collapsed === 0) {
    return payload;
  }

  const existingMeta = (payload as { meta?: Record<string, unknown> }).meta;
  return {
    ...(payload as object),
    data: shaped,
    meta: {
      ...(existingMeta ?? {}),
      [OMITTED_WHEN_EQUAL_META_KEY]: { [displayNameField]: nameField },
    },
  } as TPayload;
}

/**
 * Shape one page of job instances.
 *
 * @param payload  the bConnect list envelope, exactly as the client returned it
 * @param options  `full` (detail:true) short-circuits to the payload unchanged
 */
export function shapeJobInstanceList<TPayload extends ListEnvelope>(
  payload: TPayload,
  options: JobInstanceShapeOptions = {}
): TPayload | Record<string, unknown> {
  if (options.full === true) {
    return payload;
  }
  const shaper = options.includeSteps === true ? shapeWithSteps : shapeWithoutSteps;
  return collapseDuplicateDisplayNames(
    dropConstantScopeColumns(shaper(payload, { args: options.args }))
  );
}
