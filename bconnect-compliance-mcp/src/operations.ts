/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `compliance` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  list_detected_rule_violations: ['GetDetectedRuleViolations'],
  list_detected_rule_violations_for_endpoint: ['GetDetectedRuleViolationsForEndpoint'],
  list_detected_vulnerabilities: ['GetAllDetectedVulnerabilities'],
  list_detected_vulnerabilities_for_endpoint: ['GetDetectedVulnerabilitiesByEndpoint'],
  list_mobile_device_rules: ['GetAllMobileDeviceRules'],
  get_mobile_device_rule: ['GetMobileDeviceRule'],
  list_vulnerabilities: ['GetAllVulnerabilities'],
  get_vulnerability: ['GetVulnerability'],
};
