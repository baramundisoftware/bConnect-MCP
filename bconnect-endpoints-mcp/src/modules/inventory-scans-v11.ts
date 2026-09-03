/**
 * bConnect v1.1 — custom inventory scans (registry, WMI, file).
 *
 * LOCAL ADDITION. The second v1.1 capability slice, over the shared client in
 * `@bconnect/mcp-core` (packages/mcp-core/src/v11-client.ts — read its header
 * first; it records the auth rules and why the client is GET-only).
 *
 * ── What these controllers actually are ─────────────────────────────────────
 * The handoff expected scan DEFINITIONS. They are scan RESULTS, per endpoint.
 * Established by probing, not by reading the v1.1 PDF, which is the rule this
 * project earned the hard way — building from the document is how
 * `/MobileDeviceRules` and `/Pin` shipped as routes that do not exist.
 *
 * Filtered shape (`?EndpointId=<guid>`):
 *     { EndpointId, Scans: [ { Time, Template, Data: [ ... ] } ] }
 * and when the endpoint has no data for that scan type, the `Scans` key is
 * ABSENT ENTIRELY rather than an empty array. Those are two different facts
 * and this module reports them as two different facts — conflating "no scan
 * has run" with "a scan ran and found nothing" is exactly the class of defect
 * that produced a clean-estate report over 1,522 critical vulnerabilities.
 *
 * ── What the REGISTRY tool is actually for (2026-08-07, V11-AUDIT.md row 1) ──
 * Its description used to say the registry scan lists products "the standard
 * software inventory may not list". Measured against a live 26R1 on two
 * endpoints, that is FALSE: v2.0's `list_installed_software_by_endpoint`
 * accounted for every product this returns (86/86 and 21/21) and five more, off
 * the same scan run — v2.0's `lastFound` equals this payload's `Scans[0].Time`
 * to the second.
 *
 * The one thing v2.0 will not give back is the RAW registry string. Where a
 * detection rule matches, v2.0 substitutes baramundi's recognised name and
 * version: `Zoom Workplace (64-bit)` `7.1.43453` is reported there as `Zoom`
 * `7.1.5.43453`. That substitution — not coverage — is this tool's whole
 * justification now, and the description says so.
 *
 * ── Measured live against a bMS 26R1 (2026-08-03) ───────────────────────────
 *
 *   Controller                    unfiltered        per endpoint
 *   InventoryDataFileScans            11,797 B / 13         ~907 B
 *   InventoryDataRegistryScans       325,058 B / 22       19,189 B
 *   InventoryDataWMIScans         11,930,039 B / 21      585,464 B
 *
 * **v1.1 offers no paging on these controllers at all.** `PageSize`, `Page`,
 * `Skip`, `Top`, `OrderBy` and `SearchQuery` each answer HTTP 400 "Unknown
 * parameter". The ONLY parameter any of them accepts is `EndpointId`
 * (case-insensitive). That is why every tool here requires an endpoint id:
 * it is not a convenience, it is the only bound that exists.
 *
 * A well-formed GUID that is not a Windows endpoint answers 404 with
 * `{"Message":"Endpoint [id=...] not found or is not of type WindowsEndpoint."}`;
 * a non-GUID answers 400. The shared client maps both to their own diagnosis.
 *
 * ── Why WMI is a two-step tool and not a `detail` flag ──────────────────────
 * 585 KB for ONE endpoint is not a payload a `detail: true` escape hatch can
 * honestly offer — it is roughly 150k tokens, and no caller asking "what
 * hardware is in this machine" wants it. It is also not uniformly useful: of
 * the 24 classes in a default scan, `Win32_Bus` (362,160 B) and
 * `Win32_PnPEntity` (199,401 B) are 96% of the bytes and are device-enumeration
 * noise, while `Win32_BIOS`, `Win32_Processor` and `Win32_ComputerSystem` — the
 * ones an administrator actually asks about — are under 1 KB each.
 *
 * So the tool answers the index first (24 rows, class name + item count +
 * measured size, ~1 KB) and serves one class on request. There is deliberately
 * no argument combination that returns all 24 classes' data: the structure of
 * the tool is the bound, because a flag is something a caller can set by
 * accident and a missing code path is not.
 */

import { V11Client, projectRow, type Row } from "@bconnect/mcp-core";

/** The three controllers this slice reads. Names are the wire names. */
export const REGISTRY_CONTROLLER = "InventoryDataRegistryScans";
export const WMI_CONTROLLER = "InventoryDataWMIScans";
export const FILE_CONTROLLER = "InventoryDataFileScans";

/** Same wording as mcp-core's shape-response DEFAULT_FULL_MODE_HINT. */
export const V11_FULL_MODE_HINT = "Pass detail:true for the full API record.";

/** The endpoints server's v1.1 client. A distinct prototype per server, so a
 *  test stubbing this one cannot reach another server's v1.1 calls. */
export class InventoryScansV11Client extends V11Client {}

// ─── Envelope ────────────────────────────────────────────────────────────────

interface ScanRecord extends Row {
  Time?: string;
  Template?: string;
  Data?: unknown[];
}

interface ScanEnvelope {
  EndpointId?: string;
  Scans?: ScanRecord[];
}

/**
 * Why the endpoint has no usable scan payload, said precisely.
 *
 * `Scans` absent, `Scans: []`, and a scan with an empty `Data` are three
 * different states of the world and the operator's next action differs for
 * each. They get three different sentences.
 */
export function noScanNote(kind: string, endpointId: string, envelope: ScanEnvelope): string {
  if (envelope.Scans === undefined) {
    return (
      `No ${kind} inventory scan has ever run on endpoint ${endpointId}. The bMS returned the ` +
      `endpoint with no Scans member at all, which is distinct from a scan that ran and found ` +
      `nothing. Assign a ${kind} inventory job to this endpoint if you expect data here.`
    );
  }
  return (
    `Endpoint ${endpointId} has a ${kind} inventory record but it contains no scans. A scan is ` +
    `configured but has not produced a result — check the job's last run on this endpoint.`
  );
}

/**
 * The most recent scan in an envelope, or `undefined`.
 *
 * Every payload measured carried exactly one scan per endpoint for registry
 * and WMI, and up to three for files. Rather than assume index 0 is newest —
 * an assumption nothing on the wire guarantees — this sorts by `Time`.
 */
export function latestScan(envelope: ScanEnvelope): ScanRecord | undefined {
  const scans = envelope.Scans;
  if (!Array.isArray(scans) || scans.length === 0) {
    return undefined;
  }
  return [...scans].sort((a, b) => String(b.Time ?? "").localeCompare(String(a.Time ?? "")))[0];
}

/** `Time` / `Template` as reported, so every answer carries its own provenance. */
function provenance(scan: ScanRecord, scanCount: number): Row {
  return {
    scanTime: scan.Time ?? null,
    template: scan.Template === "" ? "(unnamed template)" : (scan.Template ?? null),
    // Reported so a caller knows this is one of several, not the whole record.
    scansOnRecord: scanCount,
  };
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Fields kept per registry entry.
 *
 * `Name` is dropped: measured live, it is the MSI product code
 * (`{b306645c-…}`) or the AppX package identity, both of which repeat
 * information already in `ProductName` and neither of which a caller can act
 * on. `ProductName` + `Version` + `Company` is what the question is about.
 *
 * `ProductName` and `Version` are now LOAD-BEARING rather than merely useful:
 * `ProductName` is the registry's own DisplayName, and the pair of them is the
 * only thing this tool offers that `list_installed_software_by_endpoint` does
 * not (see the header). Projecting either away would leave the tool with no
 * reason to exist.
 */
const REGISTRY_ITEM_FIELDS = ["ProductName", "Version", "Company"] as const;

export function shapeRegistryScan(
  payload: unknown,
  options: { endpointId: string; detail?: boolean }
): unknown {
  const envelope = (payload ?? {}) as ScanEnvelope;
  if (options.detail === true) {
    return envelope;
  }

  const scan = latestScan(envelope);
  if (!scan) {
    return { endpointId: options.endpointId, note: noScanNote("registry", options.endpointId, envelope) };
  }

  const data = Array.isArray(scan.Data) ? (scan.Data as Row[]) : [];
  const seenFields = new Set<string>();
  for (const row of data) {
    for (const key of Object.keys(row ?? {})) {
      seenFields.add(key);
    }
  }
  const kept = new Set<string>(REGISTRY_ITEM_FIELDS);

  return {
    endpointId: envelope.EndpointId ?? options.endpointId,
    ...provenance(scan, envelope.Scans?.length ?? 0),
    entries: data.length,
    products: data.map((row) => projectRow(row, REGISTRY_ITEM_FIELDS)),
    meta: {
      projection: "compact",
      dropped: [...seenFields].filter((key) => !kept.has(key)).sort(),
      hint: V11_FULL_MODE_HINT,
    },
  };
}

// ─── Files ───────────────────────────────────────────────────────────────────

/**
 * Fields kept per file entry. This payload is small (~907 B per endpoint
 * measured), so the projection is mild — it drops the three fields that
 * restate others (`OriginalName`, `ProductVersion`, `Description`) and keeps
 * everything a file-inventory question is actually about.
 */
const FILE_ITEM_FIELDS = [
  "Name",
  "Path",
  "Version",
  "Company",
  "ProductName",
  "Size",
  "LastWriteTime",
] as const;

export function shapeFileScan(
  payload: unknown,
  options: { endpointId: string; detail?: boolean }
): unknown {
  const envelope = (payload ?? {}) as ScanEnvelope;
  if (options.detail === true) {
    return envelope;
  }

  const scans = Array.isArray(envelope.Scans) ? envelope.Scans : [];
  if (scans.length === 0) {
    return { endpointId: options.endpointId, note: noScanNote("file", options.endpointId, envelope) };
  }

  // Files differ from registry and WMI: up to three scans per endpoint were
  // measured, each from a different template, and they are not versions of
  // one another — they are different searches. Collapsing to the newest would
  // silently discard two thirds of the answer, so all are returned.
  const seenFields = new Set<string>();
  const kept = new Set<string>(FILE_ITEM_FIELDS);
  const shaped = scans.map((scan) => {
    const data = Array.isArray(scan.Data) ? (scan.Data as Row[]) : [];
    for (const row of data) {
      for (const key of Object.keys(row ?? {})) {
        seenFields.add(key);
      }
    }
    return {
      scanTime: scan.Time ?? null,
      template: scan.Template === "" ? "(unnamed template)" : (scan.Template ?? null),
      matches: data.length,
      files: data.map((row) => projectRow(row, FILE_ITEM_FIELDS)),
    };
  });

  return {
    endpointId: envelope.EndpointId ?? options.endpointId,
    scans: shaped,
    meta: {
      projection: "compact",
      dropped: [...seenFields].filter((key) => !kept.has(key)).sort(),
      hint: V11_FULL_MODE_HINT,
    },
  };
}

// ─── WMI ─────────────────────────────────────────────────────────────────────

interface WmiProperty {
  Name?: string;
  Value?: unknown;
}
interface WmiInstance {
  Properties?: WmiProperty[];
}
interface WmiClass extends Row {
  ClassName?: string;
  Items?: WmiInstance[];
}

/**
 * The class index — what a caller gets when they name no class.
 *
 * ~1 KB in place of 585 KB, and it is the honest answer to "what did the WMI
 * scan collect": the classes, how many instances each holds, and how large
 * each is, so the caller can choose. `bytes` is measured from this very
 * payload rather than remembered from a probe, because a hand-maintained
 * number would drift the moment a deployment used a different WMI template.
 */
export function shapeWmiIndex(payload: unknown, options: { endpointId: string }): unknown {
  const envelope = (payload ?? {}) as ScanEnvelope;
  const scan = latestScan(envelope);
  if (!scan) {
    return { endpointId: options.endpointId, note: noScanNote("WMI", options.endpointId, envelope) };
  }

  const classes = Array.isArray(scan.Data) ? (scan.Data as WmiClass[]) : [];
  const index = classes
    .map((entry) => ({
      className: entry.ClassName ?? "(unnamed)",
      instances: Array.isArray(entry.Items) ? entry.Items.length : 0,
      bytes: Buffer.byteLength(JSON.stringify(entry ?? null)),
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    endpointId: envelope.EndpointId ?? options.endpointId,
    ...provenance(scan, envelope.Scans?.length ?? 0),
    classes: index,
    meta: {
      projection: "index",
      totalBytesIfFullyExpanded: index.reduce((sum, row) => sum + row.bytes, 0),
      hint:
        "This is the index, not the data. Pass className to get one class's instances. " +
        "There is no argument that returns every class — one endpoint's full WMI scan was " +
        "585 KB when measured, which is why this tool is two steps.",
    },
  };
}

/**
 * One class's instances, with each instance's `Properties[{Name,Value}]` array
 * folded into a plain object.
 *
 * The wire form spends roughly two thirds of its bytes repeating the strings
 * `"Name"` and `"Value"`; folding is lossless as long as property names within
 * an instance are unique. They are not guaranteed to be, so a collision is
 * detected and reported rather than silently overwriting — a silently dropped
 * property is precisely the shape of defect this project keeps finding.
 */
export function shapeWmiClass(
  payload: unknown,
  options: { endpointId: string; className: string; detail?: boolean }
): unknown {
  const envelope = (payload ?? {}) as ScanEnvelope;
  const scan = latestScan(envelope);
  if (!scan) {
    return { endpointId: options.endpointId, note: noScanNote("WMI", options.endpointId, envelope) };
  }

  const classes = Array.isArray(scan.Data) ? (scan.Data as WmiClass[]) : [];
  const wanted = options.className.toLowerCase();
  const entry = classes.find((c) => String(c.ClassName ?? "").toLowerCase() === wanted);

  if (!entry) {
    // Actionable by construction: the caller is told what IS there, so the
    // next call succeeds. An error that only says "not found" costs a turn.
    const available = classes.map((c) => c.ClassName ?? "(unnamed)").sort();
    return {
      endpointId: envelope.EndpointId ?? options.endpointId,
      note:
        `The WMI scan on this endpoint collected no class named '${options.className}'. ` +
        `Class names are matched case-insensitively. Available on this endpoint: ` +
        `${available.join(", ") || "(none)"}.`,
      availableClasses: available,
    };
  }

  if (options.detail === true) {
    return entry;
  }

  const collisions = new Set<string>();
  let droppedPath = false;
  const instances = (Array.isArray(entry.Items) ? entry.Items : []).map((item) => {
    const folded: Record<string, unknown> = {};
    for (const property of Array.isArray(item?.Properties) ? item.Properties : []) {
      const key = property?.Name;
      if (typeof key !== "string") {
        continue;
      }
      // `__PATH` is the WMI object path, e.g.
      // `\\HOSTNAME\root\CIMV2:Win32_OperatingSystem=@`. It restates the class
      // name and the machine, both of which the caller already has, and it is
      // the one field in this payload that carries a hostname — which a public
      // deployment has no reason to spend tokens echoing back.
      if (key === "__PATH") {
        droppedPath = true;
        continue;
      }
      if (key in folded) {
        collisions.add(key);
      }
      folded[key] = property.Value ?? null;
    }
    return folded;
  });

  return {
    endpointId: envelope.EndpointId ?? options.endpointId,
    ...provenance(scan, envelope.Scans?.length ?? 0),
    className: entry.ClassName ?? options.className,
    instances,
    meta: {
      projection: "compact",
      // Nothing is dropped without being named — shape-response rule 1.
      dropped: droppedPath ? ["__PATH"] : [],
      // Named because it is a real, if unlikely, way to lose data.
      ...(collisions.size > 0
        ? {
            duplicatePropertyNames: [...collisions].sort(),
            warning:
              "This class returned instances with repeated property names; only the last value " +
              "of each is shown above. Pass detail:true for the unfolded API record.",
          }
        : {}),
      hint: V11_FULL_MODE_HINT,
    },
  };
}
