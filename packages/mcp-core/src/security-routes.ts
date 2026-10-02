/**
 * Security-relevant routes (REQ-XC-006 AC 3; #168): audited at every
 * BCONNECT_AUDIT_LEVEL except none, and flagged as security audit entries.
 *
 * The rule, checked against both specs by __tests__/security-routes.guard.test.ts:
 * every operation tagged ApiKeys, LocalAdministrativeAccounts, Objects,
 * SecurityGroups or SecurityProfiles; every write tagged ManagementServer,
 * Microservices, VariableDefinitions or VariableInstances; every operation
 * whose answer or request body carries a credential (BitLocker, LAPS,
 * enrollment, endpoint passwords). Every other tag is classified there as not
 * security-relevant, with a reason. A new such operation in a future spec fails the
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
  { method: "POST", domain: "endpoints", path: "/v2.0/WindowsEndpoints/{id}/StartEnrollment" },
  // Endpoints created with credentials in the request body
  { method: "POST", domain: "endpoints", path: "/v2.0/LinuxEndpoints" },
  { method: "POST", domain: "endpoints", path: "/v2.0/NetworkEndpoints" },
  { method: "POST", domain: "endpoints", path: "/v2.0/IndustrialEndpoints" },
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
  // Server availability: restart, microservices
  { method: "POST", domain: "servermanagement", path: "/v2.0/Restart" },
  { method: "POST", domain: "servermanagement", path: "/v2.0/CancelScheduledRestart" },
  { method: "POST", domain: "servermanagement", path: "/v2.0/Microservices/{id}/Start" },
  { method: "POST", domain: "servermanagement", path: "/v2.0/Microservices/{id}/Stop" },
  { method: "POST", domain: "servermanagement", path: "/v2.0/Microservices/{id}/Restart" },
  // Variable writes (a variable can be of type Password)
  { method: "POST", domain: "variables", path: "/v2.0/VariableDefinitions" },
  { method: "PATCH", domain: "variables", path: "/v2.0/VariableDefinitions/{id}" },
  { method: "DELETE", domain: "variables", path: "/v2.0/VariableDefinitions/{id}" },
  { method: "PATCH", domain: "variables", path: "/v2.0/VariableInstances/{id}" },
]);

const MATCHERS = SECURITY_ROUTES.map(routeMatcher);

/** True when the request goes to a security-relevant operation, in any encoding the secret gate reads. */
export function isSecurityRoute(method: string, url: string): boolean {
  const upper = String(method ?? "GET").toUpperCase();
  const path = canonicalPathOf(url);
  return MATCHERS.some((m) => m.method === upper && m.pattern.test(path));
}
