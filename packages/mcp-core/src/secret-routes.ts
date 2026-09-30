/**
 * Secret-route gate (REQ-SRV-017, ADR-0004): the second of two locks.
 *
 * The first lock is each server's tool-name list (SECRET_READ_TOOLS). This one
 * sits in the shared HTTP client and looks at the request itself, so a new,
 * renamed or overlooked tool that reaches one of these operations is refused as
 * well, whichever server sent it.
 *
 * Each entry is an operation whose response carries a credential, written as the
 * OpenAPI path template of its spec. The secret-gate guard test derives the same
 * set from the specs' response schemas and fails if the two disagree, so this
 * list can't drift from the API.
 */

export interface SecretRoute {
  method: string;   // upper-case HTTP method
  domain: string;   // URL segment under the bConnect base URL, e.g. "defensecontrol"
  path: string;     // spec path template, e.g. /v2.0/BitLocker/WindowsEndpoints/{id}/Secrets
}

export const SECRET_ROUTES: readonly SecretRoute[] = Object.freeze([
  // BitLocker recovery keys + initial startup PIN (26R1)
  { method: "GET", domain: "defensecontrol", path: "/v2.0/BitLocker/WindowsEndpoints/{id}/Secrets" },
  { method: "PATCH", domain: "defensecontrol", path: "/v2.0/BitLocker/WindowsEndpoints/{id}/Secrets" },
  // LAPS local administrator username + password (25R2, 26R1)
  { method: "GET", domain: "defensecontrol", path: "/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}" },
  { method: "PATCH", domain: "defensecontrol", path: "/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}" },
]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MATCHERS = SECRET_ROUTES.map((route) => ({
  method: route.method,
  // Exact path shape: the template's placeholders match one segment, and the
  // path must end there (…/{id}/TriggerUpdateOnClient is not the LAPS resource).
  pattern: new RegExp(
    "(?:^|/)" + escape(route.domain) + escape(route.path).replace(/\\\{[^}]+\\\}/g, "[^/]+") + "/?$",
    "i",
  ),
}));

/** Refusal raised before a secret-bearing request is sent. */
export class SecretRouteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretRouteBlockedError";
  }
}

/** The URL path of a request, without query or fragment. */
function pathOf(url: string): string {
  const raw = String(url ?? "");
  const path = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : raw;
  return path.split(/[?#]/)[0];
}

export function isSecretRoute(method: string, url: string): boolean {
  const upper = String(method ?? "GET").toUpperCase();
  const path = pathOf(url);
  return MATCHERS.some((m) => m.method === upper && m.pattern.test(path));
}

/** Throws SecretRouteBlockedError unless ALLOW_SECRET_READ=true. */
export function assertSecretRouteAllowed(
  method: string,
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isSecretRoute(method, url) || env.ALLOW_SECRET_READ === "true") return;
  throw new SecretRouteBlockedError(
    `Refusing ${String(method).toUpperCase()} ${pathOf(url)}: the response contains live credentials ` +
    `(BitLocker recovery keys / PIN or a LAPS password). An operator must set ALLOW_SECRET_READ=true ` +
    `in the MCP server's environment and restart it; the model cannot set it.`,
  );
}
