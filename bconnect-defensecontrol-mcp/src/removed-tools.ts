/**
 * A removed or renamed tool explains itself (INT4-14, product decision 4).
 *
 * `bconnect-endpoints-mcp/src/removed-tools.ts` fixed this first; its own
 * header states the case exactly: "Falling through to `Unknown tool:
 * get_windows_endpoint` would be true and useless." Twelve of the thirteen
 * other servers still shipped the useless version. This is the same fix,
 * applied here.
 *
 * The strong `list_*`/`get_*`/`_by_*` naming conventions this catalogue uses
 * are exactly what invites a model to guess a plausible name that used to
 * exist, or that exists on a sibling server. `Unknown tool: <name>` answers
 * that guess with nothing actionable. This module answers it with the reason
 * — renamed, gated, or never existed — and the replacement to call instead.
 *
 * The code is still MethodNotFound. Nothing here makes a removed/renamed name
 * callable.
 */

/** Tool name -> why it does not dispatch under that name, and what to call instead. */
export const REMOVED_TOOLS: Readonly<Record<string, string>> = Object.freeze({
  // Renamed 2026-08-03 (INT4-1): the old name described a data refresh; the
  // route is a baramundi LAPS credential-expiry operation, and it is the only
  // tool in the whole suite matching "trigger + update + client" — exactly
  // the name a model asked to "force this machine to update now" would guess.
  trigger_update_on_client:
    "trigger_update_on_client was renamed to refresh_local_admin_account_expiry. " +
    "Same route (POST .../TriggerUpdateOnClient, same parameters: endpointId, " +
    "timeout), new name because the old one described a data refresh and the " +
    "route is a baramundi LAPS credential-expiry operation — it does not " +
    "install software, run Windows updates, or refresh inventory.",
});

/** The explanation for a removed/renamed name, or `undefined` if it was never a tool. */
export function removalReason(toolName: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(REMOVED_TOOLS, toolName)
    ? REMOVED_TOOLS[toolName]
    : undefined;
}
