/**
 * bConnect v1.1 — Microsoft Update profiles and inventories.
 *
 * LOCAL ADDITION. The first v1.1 capability slice. What was generic about it —
 * the client, the gate, and the failure-path messages — has since moved to
 * `@bconnect/mcp-core` (see packages/mcp-core/src/v11-client.ts), because a
 * second consumer arrived (the endpoints inventory-scan slice) and a second
 * hand-maintained copy is this project's most repeated defect: every
 * hand-maintained parallel list here has drifted. Nothing about that move
 * changed behaviour; this file re-exports the shared pieces so the names it
 * introduced still resolve at this import site.
 *
 * What remains below is the part that is genuinely about Microsoft Update:
 * shaping one endpoint's update inventory.
 *
 * Read DESIGN-NOTES-v11-and-licensing.md ("RESOLVED 2026-08-03") and
 * packages/mcp-core/src/v11-client.ts before extending.
 *
 * ── Verified live against a bMS 26R1 (2026-08-03) ───────────────────────────
 *   GET MicrosoftUpdateProfiles          -> 6 items, 1,230 bytes
 *   GET MicrosoftUpdateInventories       -> {Endpoints:[22]}, 164,470 bytes
 *   GET ...?EndpointId=<guid>            -> {Endpoints:[1]},  12,548 bytes
 *
 * The server-side EndpointId filter works and its name is case-insensitive.
 * An UNKNOWN parameter name (e.g. ?Endpoint=) returns HTTP 400: unlike v2.0,
 * which answers 200 and silently drops a misspelt parameter (finding D6),
 * v1.1 rejects the whole request. That is a real safety difference — a typo
 * fails loudly here instead of producing a confident wrong answer.
 */

import { V11Client, projectRow, type Row } from "@bconnect/mcp-core";

// The shared v1.1 surface, re-exported so this module stays the import site
// the updatemanagement server and its tests already use.
export {
  ENABLE_V11_ENV,
  v11Enabled,
  v11DisabledMessage,
  gateV11Tool,
  v11UnreachableMessage,
  V11_UNAUTHORIZED_MESSAGE,
  v11BadRequestMessage,
  v11NotFoundMessage,
  V11Client,
  type V11ClientOptions,
  type V11TransportResponse,
} from "@bconnect/mcp-core";

/**
 * The Microsoft Update slice's client.
 *
 * A named subclass rather than a bare alias, deliberately: the surface tests
 * stub `MicrosoftUpdateV11Client.prototype.transport`, and a distinct
 * prototype means stubbing this one cannot silently affect another server's
 * v1.1 calls in a shared test process.
 */
export class MicrosoftUpdateV11Client extends V11Client {}

// ─── Inventory shaping ───────────────────────────────────────────────────────
//
// Even filtered to one endpoint, MicrosoftUpdateInventories?EndpointId=<guid>
// is 12,548 bytes (measured live) — each update record repeats Title,
// SupportURL, Products[], deployment timestamps and more. The compact digest
// below answers the questions the record is actually consulted for (what is
// missing, how bad, by when) and follows the mcp-core shape-response
// conventions: nothing is dropped without being named in `meta`, and
// `detail: true` returns the raw payload byte for byte.

/** Same wording as mcp-core's shape-response DEFAULT_FULL_MODE_HINT. */
export const V11_FULL_MODE_HINT = "Pass detail:true for the full API record.";

/** Fields kept per missing-critical update. Everything else goes to meta.dropped. */
const CRITICAL_ITEM_FIELDS = [
  "Title",
  "UpdateId",
  "RevisionNumber",
  "Classification",
  "MsrcSeverity",
  "InstallationDeadline",
] as const;

interface UpdateRecord extends Row {
  IsInstalled?: boolean;
  Classification?: string;
  MsrcSeverity?: string | null;
}

interface InventoryEnvelope {
  Endpoints?: Array<{ EndpointID?: string; UpdateInformation?: UpdateRecord[] } & Row>;
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/**
 * Shape the one-endpoint inventory payload.
 *
 * `detail: true` returns the endpoint's raw record unchanged — the escape
 * hatch is the raw thing, not a second projection (shape-response rule 2).
 */
export function shapeInventory(
  payload: unknown,
  options: { endpointId: string; detail?: boolean }
): unknown {
  const endpoints = (payload as InventoryEnvelope)?.Endpoints;
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    return {
      endpointId: options.endpointId,
      note:
        "The bMS holds no Microsoft Update inventory for that endpoint id. Either the " +
        "endpoint is not under Microsoft Update Management or no inventory has run yet.",
    };
  }

  // The server-side filter returns exactly one endpoint; match defensively.
  const wanted = options.endpointId.toLowerCase();
  const endpoint =
    endpoints.find((e) => String(e.EndpointID ?? "").toLowerCase() === wanted) ?? endpoints[0];

  if (options.detail === true) {
    return endpoint;
  }

  const updates: UpdateRecord[] = Array.isArray(endpoint.UpdateInformation)
    ? endpoint.UpdateInformation
    : [];

  const missingByClassification: Record<string, number> = {};
  const missingBySeverity: Record<string, number> = {};
  const missingCritical: Row[] = [];
  let installed = 0;

  const seenFields = new Set<string>();
  for (const update of updates) {
    for (const key of Object.keys(update)) {
      seenFields.add(key);
    }
    if (update.IsInstalled === true) {
      installed += 1;
      continue;
    }
    bump(missingByClassification, update.Classification || "Unclassified");
    bump(missingBySeverity, update.MsrcSeverity || "Unspecified");
    if (update.MsrcSeverity === "Critical") {
      missingCritical.push(projectRow(update, CRITICAL_ITEM_FIELDS));
    }
  }

  // Honest meta: name what the compact digest dropped, measured from the
  // actual payload rather than hand-maintained (hand-maintained lists drift).
  const kept = new Set<string>(CRITICAL_ITEM_FIELDS);
  const dropped = [...seenFields].filter((key) => !kept.has(key)).sort();

  return {
    endpointId: endpoint.EndpointID ?? options.endpointId,
    updates: { total: updates.length, installed, missing: updates.length - installed },
    missingByClassification,
    missingBySeverity,
    // Missing updates Microsoft rates Critical, projected to the fields above.
    missingCritical,
    meta: {
      projection: "compact",
      dropped,
      hint: V11_FULL_MODE_HINT,
    },
  };
}
