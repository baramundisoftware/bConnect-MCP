/**
 * MCP Tool Validation Rules — bconnect-compliance-mcp
 *
 * Centralised validation rules for the 8 tools exposed by this server (26R1 only).
 * Replaces the inline `typeof` checks that previously lived in `index.ts`.
 *
 * See parameter-validator.ts for the ValidationRule type and validateOrThrow.
 */

import { ValidationRule, CommonRules } from "@bconnect/mcp-core";

/**
 * Pagination rules used by every list tool in this domain.
 */
const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy()
];

export const ComplianceRules = {
  // GET /v2.0/Compliance/RuleViolations
  listDetectedRuleViolations: (): ValidationRule[] => paginationRules(),

  // GET /v2.0/Compliance/Endpoints/{endpointId}/DetectedRuleViolations
  listDetectedRuleViolationsForEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    ...paginationRules()
  ],

  // GET /v2.0/Compliance/DetectedVulnerabilities
  listDetectedVulnerabilities: (): ValidationRule[] => paginationRules(),

  // GET /v2.0/WindowsEndpoints/{endpointId}/DetectedVulnerabilities
  listDetectedVulnerabilitiesForEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    ...paginationRules()
  ],

  // GET /v2.0/Compliance/MobileDeviceRules
  listMobileDeviceRules: (): ValidationRule[] => paginationRules(),

  // GET /v2.0/Compliance/MobileDeviceRules/{ruleId}
  getMobileDeviceRule: (): ValidationRule[] => [
    CommonRules.guid('ruleId')
  ],

  // GET /v2.0/Compliance/Vulnerabilities
  listVulnerabilities: (): ValidationRule[] => paginationRules(),

  // GET /v2.0/Compliance/Vulnerabilities/{vulnerabilityId}
  getVulnerability: (): ValidationRule[] => [
    CommonRules.guid('vulnerabilityId')
  ]
};
