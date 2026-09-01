/**
 * Grouping the detected-vulnerability rows by the endpoint they belong to.
 *
 * ── Why grouping rather than interning ──────────────────────────────────────
 * The re-rank of 2026-08-13 found a signal nothing had looked for: columns that
 * REPEAT from a small set. Not constant (so `dropConstantColumns` cannot see
 * them) and not noise (so `alwaysDrop` must not take them). This tool carried
 * the largest share found anywhere — `endpointId`, `endpointName` and
 * `detected` are 47% of the payload, denormalised onto every CVE row.
 *
 * The obvious fix — replace repeats with `"@1"` and put a lookup table in
 * `meta` — is lossless in BYTES and not in accuracy: a model then has to
 * dereference, and this project rates accuracy above tokens. Grouping saves the
 * same bytes and reads BETTER, because the endpoint sits at the head of its own
 * block and nothing has to be resolved.
 *
 * ── Measured, whole pages and several page sizes ────────────────────────────
 *   PageSize   20:  4,431 ->  2,166 B   (51 / 43 / 42 / 51 % across four pages)
 *   PageSize  200: 43,201 -> 18,111 B   (58.1%)
 *   PageSize 1000: 215,485 -> 85,961 B  (60.1%)
 * It grows with page size because the rows cluster harder: 3-6 endpoints per
 * 20-row page, 17 endpoints per 1000 rows.
 *
 * ── The hoist is safe, and that was checked rather than assumed ─────────────
 * `detected` is hoisted to the endpoint only because a scan writes its whole
 * result set in one pass: measured across a 1000-row sample, **0 of 17
 * endpoints carry more than one distinct `detected` value**, which independently
 * confirms what `scan-recency.ts` relies on. If an endpoint ever does disagree
 * with itself, the differing row keeps its own `detected` and the group's
 * `scannedAt` still describes the rest — the code below does that rather than
 * trusting the measurement to hold forever.
 *
 * ── What the caller must not confuse ────────────────────────────────────────
 * After grouping, `data.length` counts ENDPOINTS while the envelope's
 * `totalItems` counts DETECTIONS. Those are different populations and this
 * suite has a history of exactly that confusion, so both are stated in `meta`
 * rather than left to be inferred from an array length.
 */

/** One raw detection row as bConnect returns it. */
interface DetectionRow {
  endpointId?: unknown;
  endpointName?: unknown;
  vulnerabilityId?: unknown;
  cveId?: unknown;
  detected?: unknown;
  ignored?: unknown;
  [k: string]: unknown;
}

/** The keys hoisted onto the group. Everything else stays with the CVE. */
const HOISTED = new Set(["endpointId", "endpointName", "detected"]);

export interface GroupedDetections {
  endpoint: { id: unknown; name: unknown; scannedAt: unknown };
  detections: number;
  cves: Array<Record<string, unknown>>;
}

export function groupDetectionsByEndpoint(rows: DetectionRow[]): {
  groups: GroupedDetections[];
  endpoints: number;
  rows: number;
  ignoredRows: number;
} {
  const byEndpoint = new Map<string, GroupedDetections>();
  let ignoredRows = 0;

  for (const row of rows) {
    const key = String(row.endpointId ?? row.endpointName ?? "(unknown)");
    let group = byEndpoint.get(key);
    if (!group) {
      group = {
        endpoint: { id: row.endpointId ?? null, name: row.endpointName ?? null, scannedAt: row.detected ?? null },
        detections: 0,
        cves: [],
      };
      byEndpoint.set(key, group);
    }

    const cve: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (HOISTED.has(k)) {continue;}
      // `ignored` is sparse: false on all but a handful of rows (5 of 1000
      // measured), so it is carried only when TRUE and its default is stated in
      // meta. Absence means false, and nothing else.
      if (k === "ignored") {
        if (v === true) {cve.ignored = true; ignoredRows++;}
        continue;
      }
      cve[k] = v;
    }
    // The group's scannedAt describes the endpoint. A row that disagrees keeps
    // its own date rather than being silently folded under the group's — the
    // measurement says this never happens today, and the code does not depend
    // on that staying true.
    if (String(row.detected ?? "") !== String(group.endpoint.scannedAt ?? "")) {
      cve.detected = row.detected ?? null;
    }
    group.cves.push(cve);
    group.detections++;
  }

  return { groups: [...byEndpoint.values()], endpoints: byEndpoint.size, rows: rows.length, ignoredRows };
}

/**
 * Apply the grouping to a paged envelope, leaving it untouched when the caller
 * asked for the raw record or when the body is not the paged shape.
 */
export function shapeDetectionsGrouped<T extends { data?: unknown; totalItems?: unknown }>(
  payload: T,
  full: boolean,
): unknown {
  if (full || !payload || !Array.isArray(payload.data)) {return payload;}
  const { groups, endpoints, rows, ignoredRows } = groupDetectionsByEndpoint(payload.data as DetectionRow[]);
  return {
    ...payload,
    data: groups,
    meta: {
      projection: "grouped-by-endpoint",
      // The distinction this suite keeps getting wrong when it is left implicit.
      endpointsInPage: endpoints,
      detectionRowsInPage: rows,
      detectionsInEstate: payload.totalItems ?? null,
      countsNote:
        "data[] is one entry per ENDPOINT; totalItems counts DETECTIONS. They are different " +
        "populations — do not read data.length as a detection count.",
      ignoredNote:
        `'ignored' is carried only when true (${ignoredRows} row(s) here); its absence means false.`,
      // Lossless in CONTENT, not in ORDER — said plainly because a caller who
      // passed OrderBy is entitled to know their sort no longer describes the
      // top level. Within an endpoint the CVEs keep the order the API gave
      // them; across endpoints the global sequence becomes first-seen order.
      orderingNote:
        "Rows are regrouped, so any OrderBy applies WITHIN an endpoint's cves[] and no longer to " +
        "the top level, which is ordered by first appearance. Pass detail:true to sort globally.",
      hint:
        "endpointId, endpointName and detected were hoisted onto each endpoint rather than repeated " +
        "on every CVE. Nothing was dropped. Pass detail:true for the flat one-row-per-detection record.",
    },
  };
}
