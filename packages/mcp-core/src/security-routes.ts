/**
 * Security-relevant routes (REQ-XC-006 AC 3; #168): audited at every
 * BCONNECT_AUDIT_LEVEL except none, and flagged as security audit entries.
 *
 * The rule, checked against both specs by __tests__/security-routes.guard.test.ts:
 * every operation tagged ApiKeys, LocalAdministrativeAccounts, Objects,
 * SecurityGroups or SecurityProfiles, plus every operation whose answer carries
 * a credential (BitLocker, LAPS, enrollment tokens). A new such operation in a future spec fails the
 * guard until it's listed here. Written as OpenAPI path templates.
 */
import { type SecretRoute, canonicalPathOf, routeMatcher } from "./secret-routes.js";

export const SECURITY_ROUTES: readonly SecretRoute[] = Object.freeze([
  // Credentials: BitLocker recovery keys and PIN (26R1), LAPS (25R2, 26R1)
  { method: "GET", domain: "defensecontrol", path: "/v2.0/BitLocker/WindowsEndpoints/{id}/Secrets" },
  { method: "PATCH", domain: "defensecontrol", path: "/v2.0/BitLocker/WindowsEndpoints/{id}/Secrets" },
  { method: "GET", domain: "defensecontrol", path: "/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}" },
  { method: "PATCH", domain: "defensecontrol", path: "/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}" },
  { method: "POST", domain: "defensecontrol", path: "/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}/TriggerUpdateOnClient" },
  // Enrollment tokens: the answer carries a token that enrolls a device (not
  // gated by ALLOW_SECRET_READ, see the secret-gate guard's allow-list, but audited)
  { method: "POST", domain: "endpoints", path: "/v2.0/AndroidEndpoints/{id}/StartEnrollment" },
  { method: "POST", domain: "endpoints", path: "/v2.0/IosEndpoints/{id}/StartEnrollment" },
  { method: "POST", domain: "endpoints", path: "/v2.0/MacEndpoints/{id}/StartEnrollment" },
  // API keys (26R1)
  { method: "GET", domain: "servermanagement", path: "/v2.0/ApiKeys" },
  // Object rights
  { method: "PATCH", domain: "servermanagement", path: "/v2.0/Objects/{id}" },
  { method: "GET", domain: "servermanagement", path: "/v2.0/Objects/{id}/Rights" },
  // Security groups
  { method: "GET", domain: "servermanagement", path: "/v2.0/SecurityGroups" },
  { method: "POST", domain: "servermanagement", path: "/v2.0/SecurityGroups" },
  { method: "GET", domain: "servermanagement", path: "/v2.0/SecurityGroups/{id}" },
  { method: "PATCH", domain: "servermanagement", path: "/v2.0/SecurityGroups/{id}" },
  { method: "DELETE", domain: "servermanagement", path: "/v2.0/SecurityGroups/{id}" },
  // Security profiles
  { method: "GET", domain: "servermanagement", path: "/v2.0/SecurityProfiles" },
  { method: "POST", domain: "servermanagement", path: "/v2.0/SecurityProfiles" },
  { method: "GET", domain: "servermanagement", path: "/v2.0/SecurityProfiles/{id}" },
  { method: "PATCH", domain: "servermanagement", path: "/v2.0/SecurityProfiles/{id}" },
  { method: "DELETE", domain: "servermanagement", path: "/v2.0/SecurityProfiles/{id}" },
]);

const MATCHERS = SECURITY_ROUTES.map(routeMatcher);

/** True when the request goes to a security-relevant operation, in any encoding the secret gate reads. */
export function isSecurityRoute(method: string, url: string): boolean {
  const upper = String(method ?? "GET").toUpperCase();
  const path = canonicalPathOf(url);
  return MATCHERS.some((m) => m.method === upper && m.pattern.test(path));
}
