/**
 * Security-sensitive bConnect routes (findings SEC-1, SEC-4, A1)
 *
 * ── TWO sets, deliberately. Do not merge them again ─────────────────────────
 * This file defines two route sets with two different jobs, and conflating
 * them is exactly the mistake A1 records:
 *
 *   `SECURITY_SENSITIVE_ROUTES` — the AUDIT set. Broad on purpose. Anything
 *     plausibly credential-adjacent belongs here, including patterns that match
 *     no route in 26R1, because over-auditing costs a log line and
 *     under-auditing costs the record of a credential read. Consumed by
 *     `AuditLogger` via `isSecuritySensitiveRoute()`.
 *
 *   `CREDENTIAL_RETURNING_ROUTES` — the DENY set. Narrow on purpose. Only
 *     routes whose *response body* carries a credential. Consumed by
 *     `BConnectClientBase`'s request interceptor via
 *     `assertSecurityRouteAllowed()`, which refuses the request outright.
 *
 * A route that rotates, refreshes or triggers a credential change WITHOUT
 * returning the secret must NOT be in the deny set — it is a write, and writes
 * are governed by `ALLOW_WRITE_OPERATIONS`. Round 2 used the single broad table
 * as the deny-list, and `/LocalAdministrativeAccounts/i` therefore swallowed
 * `.../TriggerUpdateOnClient`: the `refresh_local_admin_account_expiry` tool became
 * unreachable in the documented posture (`ALLOW_WRITE_OPERATIONS=true`,
 * `ALLOW_SECRET_READ` unset) with a refusal about credential exposure that was
 * simply untrue of that route. Promoting speculative audit patterns into a
 * request blocker is a category error. Keep the sets separate.
 *
 * ── Why the audit set is shared with the deny set at all ────────────────────
 * Two independent consumers used to disagree about what "sensitive" means, and
 * the disagreement was the defect:
 *
 *   - `AuditLogger` carried six hand-written regexes
 *     (`/\/BitLockerSecrets/i`, `/\/TpmOwnerPasswords/i`, `/\/BitLockerPINs/i`,
 *     `/\/Secrets/i`, `/\/Password/i`, `/\/Credential/i`). Only one of them
 *     matched a route this suite actually issues. So an operator who set
 *     `BCONNECT_AUDIT_LEVEL=security` — precisely the setting for "log the
 *     dangerous things" — got a log that was blind to LAPS credential reads
 *     (`/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}`,
 *     which contains none of "Secrets", "Password" or "Credential") and to
 *     BitLocker PIN changes (`.../BitLocker/WindowsEndpoints/{id}/Pin`, which
 *     `/\/BitLockerPINs/i` does not match).
 *   - The safety gates (`ALLOW_SECRET_READ`, `ALLOW_WRITE_OPERATIONS`) key on
 *     the incoming MCP *tool name*, never on the route. They protect a name,
 *     not a resource, and exist in only 1 of 13 servers.
 *
 * Both now read this file, so the classifier and the deny-list cannot drift
 * apart again.
 *
 * ── The deny-list, and what it deliberately is not ──────────────────────────
 * `BConnectClientBase` refuses any request whose path matches
 * `CREDENTIAL_RETURNING_ROUTES` unless `ALLOW_SECRET_READ=true`, whatever
 * server or tool name originated it. The twelve non-defensecontrol servers have
 * no legitimate reason to touch these routes at all.
 *
 * It is a deny-list, NOT a per-server basePath prefix allowlist: an allowlist
 * would break confirmed legitimate cross-module traffic (the endpoints server
 * GETs `/jobs/v2.0/JobInstances` in `stale-endpoints.ts`). The traversal vector
 * an allowlist was proposed to catch is closed by `path-guard.ts` instead.
 *
 * ── Consequence worth knowing ───────────────────────────────────────────────
 * The LAPS resource itself — GET and PATCH of
 * `.../LocalAdministrativeAccounts/WindowsEndpoints/{id}` — is denied in the
 * documented remediation posture (`ALLOW_WRITE_OPERATIONS=true`,
 * `ALLOW_SECRET_READ` unset). That is the intent:
 * `patch_local_admin_user_credentials` returns the cleartext LAPS password in
 * its response body and had no secret gate at all. Its `.../TriggerUpdateOnClient`
 * sub-resource returns a boolean and is not denied — only audited.
 */

import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { RequestBlockedError } from "./path-guard.js";

/**
 * AUDIT set — routes worth recording at `BCONNECT_AUDIT_LEVEL=security`.
 *
 * Deliberately broader than the deny set. It covers the whole LAPS sub-tree
 * (including `.../TriggerUpdateOnClient`, which rotates a password without
 * returning one — worth an audit record, not worth a refusal) plus patterns
 * retained from the original hand-written list that match no 26R1 route, so a
 * deployment which was somehow matching them keeps being audited.
 *
 * Adding a speculative pattern here is cheap and safe. Adding one to
 * `CREDENTIAL_RETURNING_ROUTES` breaks a tool — see the header.
 */
export const SECURITY_SENSITIVE_ROUTES: readonly RegExp[] = Object.freeze([
  // Real routes.
  /LocalAdministrativeAccounts/i,
  /\/Secrets(?:\/|$)/i,
  /\/Pin(?:\/|$)/i,
  // D1 / P1-1. The bMS API-key inventory. The tool-name gate was done first
  // (`list_api_keys` requires ALLOW_SECRET_READ) because it returns a readable
  // `isError` a model can act on, where the transport raises -32600, which it
  // cannot; this is the second layer.
  //
  // AUDIT ONLY, and deliberately not in the deny set — the register said
  // "both", which the schema does not support. `ApiKey` carries `name`,
  // `expirationDate`, `comment`, `isActive`, `isAvailableViaGateway` and
  // `securityProfiles`, and no key material. `/v2.0/ApiKeys` declares `get`
  // only: there is no `ApiKeyForCreation` and no POST, so no response on this
  // path returns a usable key. Denying it would refuse a route that returns no
  // credential — the guess-built blocker this file's header forbids. Knowing
  // WHICH keys exist and when they expire is still worth an audit record.
  /\/ApiKeys(?:\/|$)/i,
  // Retained from the previous hand-written list; match nothing in 26R1.
  /\/BitLockerSecrets/i,
  /\/BitLockerPINs/i,
  /\/TpmOwnerPasswords/i,
  /\/Password/i,
  /\/Credential/i,
]);

/**
 * DENY set — routes whose RESPONSE BODY carries a credential. Read off the
 * return types in `bconnect-defensecontrol-mcp/src/modules/defensecontrol.ts`,
 * not guessed:
 *
 *   GET   `.../LocalAdministrativeAccounts/WindowsEndpoints/{id}`
 *                                       -> LocalAdminAccountWindowsEndpoint (LAPS user + password)
 *   PATCH `.../LocalAdministrativeAccounts/WindowsEndpoints/{id}`
 *                                       -> LocalAdminAccountWindowsEndpoint
 *   GET   `.../BitLocker/WindowsEndpoints/{id}/Secrets`   -> BitLockerSecrets
 *   PATCH `.../BitLocker/WindowsEndpoints/{id}/Pin`       -> BitLockerSecrets
 *
 * Explicitly NOT here:
 *
 *   POST  `.../LocalAdministrativeAccounts/WindowsEndpoints/{id}/TriggerUpdateOnClient`
 *                                       -> boolean. Rotates, returns nothing.
 *                                       Governed by ALLOW_WRITE_OPERATIONS.
 *   `/\/Password/i`, `/\/Credential/i`, `/\/TpmOwnerPasswords/i`, … — speculative
 *                                       audit patterns that match no route the
 *                                       suite issues. A blocker must not be
 *                                       built out of guesses.
 */
export const CREDENTIAL_RETURNING_ROUTES: readonly RegExp[] = Object.freeze([
  // The LAPS resource itself, but not its sub-resources.
  /\/LocalAdministrativeAccounts\/WindowsEndpoints\/[^/]+\/?$/i,
  /\/Secrets(?:\/|$)/i,
  /\/Pin(?:\/|$)/i,
]);

/** A request refused because it addresses a credential-bearing route. */
export class SecuritySensitiveRouteError extends RequestBlockedError {
  constructor(message: string) {
    super(ErrorCode.InvalidRequest, message);
    this.name = "SecuritySensitiveRouteError";
  }
}

/** Path only — a query string can never change which resource is addressed. */
function pathOf(path: string): string {
  return String(path ?? "").split(/[?#]/)[0];
}

/**
 * Does this request path touch a credential in any way — read, rotate, or
 * merely address the sub-tree one lives in?
 *
 * The AUDIT question. Used by `AuditLogger` to decide what to record at
 * `BCONNECT_AUDIT_LEVEL=security` and what to tag `[SECURITY AUDIT]`. It is NOT
 * the deny question — see `isCredentialReturningRoute`.
 */
export function isSecuritySensitiveRoute(path: string): boolean {
  const candidate = pathOf(path);
  return SECURITY_SENSITIVE_ROUTES.some((pattern) => pattern.test(candidate));
}

/**
 * Would the response to this request contain a credential?
 *
 * The DENY question, and a strict subset of the audit question. A route that
 * rotates a credential without returning it answers `false` here and `true` to
 * `isSecuritySensitiveRoute` — refused by neither gate, recorded by the audit
 * log, and governed by `ALLOW_WRITE_OPERATIONS` like any other write.
 */
export function isCredentialReturningRoute(path: string): boolean {
  const candidate = pathOf(path);
  return CREDENTIAL_RETURNING_ROUTES.some((pattern) => pattern.test(candidate));
}

/**
 * The one release valve. Same variable the defensecontrol server's tool-name
 * gate reads, so an operator who has already opened that gate sees no change.
 */
export function isSecretReadAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALLOW_SECRET_READ === "true";
}

/**
 * Throw unless a credential-RETURNING route is explicitly permitted.
 *
 * Called from a `BConnectClientBase` request interceptor. The tool-name gate in
 * bconnect-defensecontrol-mcp stays as the outer layer; this is the layer no
 * server can forget to install.
 *
 * Keyed on `isCredentialReturningRoute`, never on `isSecuritySensitiveRoute`:
 * the audit set is broad by design and must not be able to block a request.
 */
export function assertSecurityRouteAllowed(
  method: string,
  path: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (!isCredentialReturningRoute(path)) {
    return;
  }
  if (isSecretReadAllowed(env)) {
    return;
  }
  throw new SecuritySensitiveRouteError(
    `Refusing ${method.toUpperCase()} ${pathOf(path)}: this route returns a ` +
    `credential (BitLocker recovery secrets / PIN, or a LAPS local-administrator ` +
    `password) in its response. Set ALLOW_SECRET_READ=true on the MCP server to ` +
    `permit it — the response would otherwise land in the model context unredacted.`
  );
}
