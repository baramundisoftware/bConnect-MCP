/**
 * Opt-in response projection for list tools (findings TOK-2/-4/-5/-7 =
 * TOK-21/23/24/27)
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * The list tools hand the API's payload straight to the model. Measured live on
 * a bMS 26R1 estate:
 *
 *   list_windows_endpoints   ~3.1 KB per row (cpu block, per-volume GUIDs,
 *                            energy scheme, boot mode …) — a 20-row page is
 *                            ~60 KB for a question that wanted name + OS +
 *                            lastSeen
 *   software inventory       ~430 B per row of which ~270 B is either echoed
 *                            back from the caller's own arguments
 *                            (endpointId, endpointName) or null/constant on
 *                            every row (autFirstUse, autLastUse, autLastData,
 *                            autUsage="AutDeactivated")
 *   list_job_instances       ~1.3 KB per instance; `steps[]` alone is 44.5%
 *   get_fleet_summary        ~4.6 KB of a ~9.6 KB "compact digest" is
 *                            per-row consoleLink strings derivable from
 *                            id + type via a fixed template
 *
 * ── Two rules this module is built around ───────────────────────────────────
 * **It never shapes anything you did not ask it to.** There is no global
 * interceptor and nothing hooks the client. A server opts in per tool by
 * declaring a projection and calling the shaper in that tool's case arm; every
 * other tool keeps passing the raw payload through. A silent suite-wide
 * reshaper would be the largest blast radius in the evaluation, and a model
 * that cannot get at a field it can see documented is worse off than one paying
 * for bytes it did not need.
 *
 * **Nothing is dropped without saying so, and `detail: true` is exact.** A
 * dropped column is named in `meta`, and a column that was constant across the
 * page has its single value recorded there — so the compact form is lossless in
 * information even where it is 60% smaller in bytes. `detail: true` returns the
 * payload object unchanged, byte for byte: the escape hatch is the raw thing,
 * not a second projection.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 * ```ts
 * import { createListShaper } from "@bconnect/mcp-core";
 *
 * // Declared once, next to the tool.
 * const shapeWindowsEndpoints = createListShaper({
 *   compactFields: [
 *     "id", "displayName", "hostName", "operatingSystem",
 *     "osVersionString", "lastSeen", "logicalGroup", "clientAgentVersion",
 *   ],
 *   meta: { consoleLinkTemplate: "bMC:///navigationCriteria={id} ..." },
 * });
 *
 * case "list_windows_endpoints": {
 *   const raw = await bconnect.endpoints.listWindowsEndpoints(args);
 *   return toolTextResult(serializeToolResult(
 *     shapeWindowsEndpoints(raw, { full: args?.detail === true, args })
 *   ));
 * }
 * ```
 */

/** A bConnect list payload: an envelope with a `data` array of rows. */
export interface ListEnvelope<TRow = Record<string, unknown>> {
  data?: TRow[];
  [key: string]: unknown;
}

/** A row. bConnect rows are flat-ish JSON objects. */
export type Row = Record<string, unknown>;

export interface RowProjection {
  /**
   * Fields kept by the compact projection, in this order. Omit to keep every
   * field the API returned and rely on the drop rules alone — which is what the
   * software inventory needs (its problem is echo and constants, not breadth).
   */
  compactFields?: readonly string[];

  /**
   * Fields dropped from the compact projection unconditionally: per-row
   * `consoleLink` strings that a single `meta.consoleLinkTemplate` replaces,
   * `steps[]` that `get_job_instance` will return in full on request.
   */
  alwaysDrop?: readonly string[];

  /**
   * Drop row fields whose value equals the caller's own argument of the same
   * name — `endpointId` repeated on all 20 rows of
   * `list_installed_software_by_endpoint`. Requires `args` in the options.
   */
  dropEchoedArgs?: readonly string[];

  /**
   * Drop fields that hold the same value on every row of the page, recording
   * that value once in `meta.constant`. Catches both the always-null AUT
   * columns and the constant `endpointName`. Lossless: the value is still in
   * the response, once instead of twenty times.
   */
  dropConstantColumns?: boolean;

  /**
   * Drop fields that are null/undefined on every row, listing them in
   * `meta.nullColumns`. Implied by `dropConstantColumns`; use this alone when
   * you want the nulls gone but non-null constants kept.
   */
  dropNullColumns?: boolean;

  /**
   * Below this many rows, constant/null-column detection is switched off — on a
   * one-row page every column is "constant" and the projection would eat the
   * answer.
   * @default 2
   */
  minRowsForConstantDrop?: number;

  /** Fixed entries merged into `meta`, e.g. a `consoleLinkTemplate`. */
  meta?: Readonly<Record<string, unknown>>;

  /**
   * The sentence that tells the model how to get the rest. Set `null` to emit
   * none.
   * @default "Pass detail:true for the full API record."
   */
  fullModeHint?: string | null;
}

export interface ShapeOptions {
  /** The caller asked for the raw record (`detail: true`). */
  full?: boolean;
  /** The caller named the fields it wants. Ignored when `full`. */
  fields?: readonly string[];
  /** The caller's tool arguments, needed by `dropEchoedArgs`. */
  args?: Record<string, unknown>;
  /**
   * How many rows the COLLECTION holds, when the envelope reported it. Used
   * only to scope `meta.constant`: a constancy observed over 20 of 52 rows is
   * not a fact about 52.
   *
   * `shapeListResponse` fills this from the envelope's `totalItems`. A direct
   * `shapeRows` caller that omits it gets the conservative "total unknown"
   * scope rather than a silent collection-wide claim — absent must not read as
   * "the page covers everything".
   */
  collectionTotal?: number;
}

/** What was removed, and what it was. Emitted once per response. */
export interface ShapeMeta {
  /** `compact` (the projection), `fields` (caller-chosen), `raw` (untouched). */
  projection: "compact" | "fields" | "raw";
  /**
   * Fields identical on every row THAT WAS READ, with their single value.
   *
   * Read `constantScope` before quoting this as a property of the collection.
   * On a single-page result the two populations are the same and no scope is
   * emitted; on a paged one they are not, and the claim covers only the rows in
   * this response.
   */
  constant?: Record<string, unknown>;
  /**
   * Present exactly when `constant` describes FEWER rows than the collection
   * holds — a paged read, or an envelope that never said how many exist.
   *
   * Absent on a single-page result, where the claim is genuinely
   * collection-wide and a caveat would be a fixed token cost buying nothing.
   */
  constantScope?: string;
  /** Fields null on every row. */
  nullColumns?: string[];
  /** Fields whose value merely echoed a request argument, with that value. */
  echoed?: Record<string, unknown>;
  /** Fields dropped by `alwaysDrop`. */
  dropped?: string[];
  /** How to get the full record. */
  hint?: string;
  [key: string]: unknown;
}

export interface ShapedList<TRow = Row> extends ListEnvelope<TRow> {
  data: TRow[];
  meta: ShapeMeta;
}

/**
 * The one sentence that tells a caller how to get the unprojected record.
 *
 * Exported because it was module-private, and two v1.1 slices that needed the
 * same wording each declared their own copy with a comment naming this constant
 * (ARCH-9). A hand-maintained parallel copy of a string is the failure mode this
 * codebase has hit most often; import it.
 */
export const DEFAULT_FULL_MODE_HINT = "Pass detail:true for the full API record.";

/**
 * The compact projection for a bConnect ENDPOINT row, shared by every tool that
 * returns one.
 *
 * Lives here rather than in one server because two servers return this same row
 * from different routes — `bconnect-endpoints-mcp`'s `list_endpoints` /
 * `list_endpoints_by_logical_group`, and `bconnect-groups-mcp`'s
 * `list_group_members` for every memberType except `childGroups`. It was
 * declared privately in the endpoints server first; copying the list into the
 * second one is exactly the hand-maintained parallel copy that
 * `DEFAULT_FULL_MODE_HINT` above exists to warn about, and this list encodes a
 * decision (below) that a copy would lose.
 *
 * ── Why `logicalGroupId` is in here despite costing ~45 B per row ────────────
 * Keeping only the group's NAME and not its ID made `list_endpoints` a dead end.
 * `logicalGroupId` is what group-scoped tools in five other servers take —
 * `list_installed_software_by_logical_group`, `list_job_instances_by_logical_
 * group`, `list_defender_threats_by_logical_group` — and nothing anywhere turns
 * a group name back into an id. So a model that had correctly worked out the
 * sequence still could not perform it without a second, 55 KB `detail:true` call
 * for one field. `meta.projectedAway` naming an id is not the same as supplying
 * the one id the rest of the suite is keyed on.
 *
 * That reasoning generalises, and it is the rule to apply before adding or
 * removing anything here: **never project away an `*Id` another tool consumes as
 * a parameter**, however expensive the column looks.
 */
export const ENDPOINT_COMPACT_FIELDS = [
  "id",
  "displayName",
  "hostName",
  "type",
  "operatingSystem",
  "osVersionString",
  "lastSeen",
  "logicalGroup",
  "logicalGroupId",
  "clientAgentVersion",
  "activity",
] as const;

function isPlainObject(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Field names that are `null`/`undefined` on every row. */
export function findNullColumns(rows: readonly Row[]): string[] {
  if (rows.length === 0) {
    return [];
  }
  const candidates = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      candidates.add(key);
    }
  }
  return [...candidates].filter((key) =>
    rows.every((row) => row[key] === null || row[key] === undefined)
  );
}

/**
 * Field names that hold one and the same value on every row, with that value.
 *
 * Comparison is by serialised form, so `{a:1}` on every row counts as constant
 * — the point is that repeating it per row buys the reader nothing.
 */
export function findConstantColumns(rows: readonly Row[]): Record<string, unknown> {
  if (rows.length === 0) {
    return {};
  }
  const constant: Record<string, unknown> = {};
  for (const key of Object.keys(rows[0])) {
    const first = JSON.stringify(rows[0][key] ?? null);
    const same = rows.every(
      (row) => key in row && JSON.stringify(row[key] ?? null) === first
    );
    if (same) {
      constant[key] = rows[0][key] ?? null;
    }
  }
  return constant;
}

/** Keep `fields`, in the order given; missing fields are simply absent. */
export function projectRow(row: Row, fields: readonly string[]): Row {
  const out: Row = {};
  for (const field of fields) {
    if (field in row) {
      out[field] = row[field];
    }
  }
  return out;
}

/** `projectRow` across an array. */
export function projectRows(rows: readonly Row[], fields: readonly string[]): Row[] {
  return rows.map((row) => projectRow(row, fields));
}

/**
 * Apply a projection to a bare array of rows.
 *
 * The primitive `shapeListResponse` is built on, exported for composite tools
 * whose rows are nested (the `needsAttention` / `agentVersionOutliers` arrays
 * inside `get_fleet_summary`) rather than sitting in an envelope's `data`.
 */
export function shapeRows(
  rows: readonly Row[],
  projection: RowProjection,
  options: ShapeOptions = {}
): { rows: Row[]; meta: ShapeMeta } {
  if (options.full === true) {
    return { rows: [...rows], meta: { projection: "raw" } };
  }

  const meta: ShapeMeta = { projection: options.fields?.length ? "fields" : "compact" };
  const minRows = projection.minRowsForConstantDrop ?? 2;
  const drop = new Set<string>();

  // 1. Fields the caller's own arguments already carry.
  if (projection.dropEchoedArgs?.length && options.args) {
    const echoed: Record<string, unknown> = {};
    for (const key of projection.dropEchoedArgs) {
      const argValue = options.args[key];
      if (argValue === undefined) {
        continue;
      }
      const allEcho =
        rows.length > 0 &&
        rows.every((row) => key in row && String(row[key]) === String(argValue));
      if (allEcho) {
        echoed[key] = argValue;
        drop.add(key);
      }
    }
    if (Object.keys(echoed).length > 0) {
      meta.echoed = echoed;
    }
  }

  // 2. Constant / null columns, reported once.
  if (rows.length >= minRows) {
    if (projection.dropConstantColumns) {
      const constant = findConstantColumns(rows);
      for (const key of Object.keys(constant)) {
        if (drop.has(key)) {
          delete constant[key];
        } else {
          drop.add(key);
        }
      }
      if (Object.keys(constant).length > 0) {
        meta.constant = constant;
        // ── Scope the claim to what was actually read ─────────────────────
        // `findConstantColumns` sees one PAGE, and the columns it names are
        // then stripped from every row — so an unqualified `constant` states a
        // property of the collection that nothing in the response can
        // contradict. Measured live: `list_ad_groups` at PageSize 20 reported
        // `constant: {domain, type}` beside `totalItems: 52, totalPages: 3`.
        //
        // `resultTrustworthy` cannot cover this: nothing was incomplete, the
        // page was served whole. The response simply said more than it read.
        //
        // Scoped rather than abandoned. Where the page IS the collection the
        // fact is genuinely collection-wide and this costs nothing; only a
        // paged read pays, and only for the sentence that makes it true.
        // An ABSENT total is not "the page covers everything" — unknown is
        // scoped too.
        const total = options.collectionTotal;
        if (typeof total !== "number" || rows.length < total) {
          meta.constantScope =
            typeof total === "number"
              ? `Observed across the ${rows.length} row(s) in this response, of ${total} in the ` +
                `collection — not verified on the rest.`
              : `Observed across the ${rows.length} row(s) in this response. The envelope did not ` +
                `report a collection total, so whether it holds beyond them is unknown.`;
        }
      }
    } else if (projection.dropNullColumns) {
      const nullColumns = findNullColumns(rows).filter((key) => !drop.has(key));
      for (const key of nullColumns) {
        drop.add(key);
      }
      if (nullColumns.length > 0) {
        meta.nullColumns = nullColumns;
      }
    }
  }

  // 3. Fields this tool always drops.
  if (projection.alwaysDrop?.length) {
    const dropped = projection.alwaysDrop.filter((key) =>
      rows.some((row) => key in row)
    );
    for (const key of dropped) {
      drop.add(key);
    }
    if (dropped.length > 0) {
      meta.dropped = dropped;
    }
  }

  // 4. Select. Caller-named fields win over the declared compact projection;
  //    when neither is given, every field survives except the dropped ones.
  const selected = options.fields?.length
    ? options.fields
    : projection.compactFields;

  // 4b. Name what the projection removed.
  //
  // The contract at the top of this file says "nothing is dropped without
  // saying so", and until now that was true of `alwaysDrop`, the constant
  // columns and the echoed arguments — but NOT of the compact projection
  // itself, which is the one that removes the most. Measured live,
  // `list_endpoints({type:"WindowsEndpoint"})` kept 10 fields and silently
  // removed 43, with `meta` saying only `{"projection":"compact"}`.
  //
  // Three of those 43 were load-bearing. `isDeactivated` meant "is this
  // endpoint deactivated?" was answered NO on an estate with 20 ghost
  // machines. `logicalGroupId` was removed while the group NAME was kept, so
  // a list_endpoints result could not feed any of the several tools that take
  // a logical group id — and nothing said the id had been dropped.
  //
  // The distinction that matters is between "the projection removed it" and
  // "the estate does not have it". Without this, a caller cannot tell.
  if (selected && !options.fields?.length) {
    const present = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        present.add(key);
      }
    }
    const projectedAway = [...present]
      .filter((key) => !selected.includes(key) && !drop.has(key))
      .sort();
    if (projectedAway.length > 0) {
      meta.projectedAway = projectedAway;
    }
  }

  const shaped = rows.map((row) => {
    const base = selected ? projectRow(row, selected) : { ...row };
    for (const key of drop) {
      delete base[key];
    }
    return base;
  });

  if (projection.meta) {
    Object.assign(meta, projection.meta);
  }

  const hint = projection.fullModeHint === undefined
    ? DEFAULT_FULL_MODE_HINT
    : projection.fullModeHint;
  const somethingWasRemoved = drop.size > 0 || selected !== undefined;
  if (hint !== null && somethingWasRemoved) {
    // The escape hatch alone is not enough. A caller who does not know a field
    // was removed has no reason to reach for it, so where the projection
    // removed named fields the hint states the CONSEQUENCE first: their
    // absence from this response is not their absence from the estate.
    meta.hint = meta.projectedAway
      ? "Fields listed in meta.projectedAway were removed by the compact projection. " +
        "Their absence here is NOT evidence they are unset on the estate. " +
        hint
      : hint;
  }

  return { rows: shaped, meta };
}

/**
 * Combine a `meta` the payload already carried with the one this projection
 * produced, without losing either.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `shapeListResponse` used to end `return { ...envelope, data: shaped, meta }`.
 * The envelope copy carries the payload's OWN `meta` when it has one, and the
 * trailing `meta` then silently overwrote it.
 *
 * That is not hypothetical. `bconnect-activedirectory-mcp` elides the redundant
 * `LDAP://<ldapPath>` substring out of `comment`, leaves a `{ldapPath}` marker
 * in its place, and discloses the substitution as
 * `meta.commentLdapPathElided` + `meta.hint` — and NINE of its tool
 * descriptions end "see meta". Compose that with any projection and the
 * disclosure explaining the marker disappears while the marker stays in the
 * data, which is precisely the "nothing is dropped without saying so" contract
 * both transforms were written to honour.
 *
 * ── Why a plain spread is not the fix ───────────────────────────────────────
 * `{ ...prior, ...next }` moves the bug rather than removing it: both metas
 * define `hint`, so one disclosure would still be lost silently. So `hint` is
 * CONCATENATED — both sentences are prose written for a model and both remain
 * true of the payload — and any other key present in both with a different
 * value is preserved under `upstream` rather than dropped.
 *
 * Costs nothing in the ordinary case: with no prior `meta` the projection's own
 * object is returned unchanged, so no byte is added to the 68 tools that carry
 * no upstream disclosure.
 */
function mergeShapeMeta(prior: unknown, next: ShapeMeta): ShapeMeta {
  if (!isPlainObject(prior)) {
    return next;
  }
  const merged: ShapeMeta = { ...prior, ...next };

  const priorHint = prior.hint;
  if (typeof priorHint === "string" && typeof next.hint === "string" && priorHint !== next.hint) {
    merged.hint = `${priorHint} ${next.hint}`;
  }

  // Anything else the spread would have clobbered. Compared by value, so a key
  // that happens to agree is not reported as a conflict.
  const overwritten: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(prior)) {
    if (key === "hint" || !(key in next)) {
      continue;
    }
    if (JSON.stringify(value) !== JSON.stringify(next[key])) {
      overwritten[key] = value;
    }
  }
  if (Object.keys(overwritten).length > 0) {
    merged.upstream = overwritten;
  }
  return merged;
}

/**
 * Apply a projection to a bConnect list envelope.
 *
 * The envelope's own fields (`page`, `pageSize`, `totalItems`, `totalPages`)
 * are preserved untouched — they are how the caller knows whether to page, and
 * they cost ~60 bytes.
 *
 * A `meta` the payload already carried is merged rather than overwritten — see
 * `mergeShapeMeta`.
 *
 * With `options.full === true` the payload is returned exactly as received,
 * same object reference, no `meta` added.
 */
export function shapeListResponse<TPayload extends ListEnvelope>(
  payload: TPayload,
  projection: RowProjection,
  options: ShapeOptions = {}
): TPayload | ShapedList {
  if (options.full === true) {
    return payload;
  }
  if (!payload || !Array.isArray(payload.data)) {
    // Not the envelope shape this helper understands — a route that returns a
    // bare array or a single object. Passing it through unchanged is the only
    // honest answer; shaping a shape you did not recognise is how a helper
    // starts eating fields.
    return payload;
  }

  const rows = payload.data.filter(isPlainObject);
  // The envelope's own count, forwarded so `meta.constant` can say whether it
  // describes the collection or only this page. Left undefined when the
  // envelope omitted it, which scopes the claim conservatively rather than
  // treating an absent total as "the page covers everything".
  const total = (payload as { totalItems?: unknown }).totalItems;
  const { rows: shaped, meta } = shapeRows(rows, projection, {
    ...options,
    ...(typeof total === "number" ? { collectionTotal: total } : {}),
  });

  const envelope: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key !== "data") {
      envelope[key] = value;
    }
  }

  return { ...envelope, data: shaped, meta: mergeShapeMeta(envelope.meta, meta) };
}

/**
 * Apply a projection to a single record (`get_*` tools).
 *
 * Constant- and null-column detection cannot apply to one record, so only
 * `compactFields`, `alwaysDrop`, `dropEchoedArgs` and caller-named `fields` are
 * honoured. Returns the record unchanged when `full` is set.
 */
export function shapeRecord<TRecord extends Row>(
  record: TRecord,
  projection: RowProjection,
  options: ShapeOptions = {}
): TRecord | Row {
  if (options.full === true || !isPlainObject(record)) {
    return record;
  }
  const { rows } = shapeRows([record], { ...projection, minRowsForConstantDrop: Number.POSITIVE_INFINITY }, options);
  return rows[0] ?? {};
}

/**
 * Bind a projection to a tool once, at module scope.
 *
 * The returned function is the thing the tool's case arm calls. Declaring the
 * projection next to the tool rather than inside the handler is what stops the
 * field list drifting away from the description that advertises it.
 */
export function createListShaper(
  projection: RowProjection
): <TPayload extends ListEnvelope>(
  payload: TPayload,
  options?: ShapeOptions
) => TPayload | ShapedList {
  return (payload, options = {}) => shapeListResponse(payload, projection, options);
}
