/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `defensecontrol` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  list_bitlocker_windows_endpoints: ['GetBitLockerStates'],
  get_bitlocker_windows_endpoint: ['GetBitLockerStatesByWindowsEndpointId'],
  get_local_admin_accounts: ['GetLocalAdminUserCredentialsByWindowsEndpointId'],
  patch_local_admin_user_credentials: ['PatchLocalAdminUserCredentialsForWindowsEndpointId'],
  refresh_local_admin_account_expiry: ['TriggerUpdateOnClient'],
  list_defender_threats: ['GetMicrosoftDefenderThreats'],
  get_defender_threat: ['GetMicrosoftDefenderThreat'],
  list_defender_threats_by_endpoint: ['GetMicrosoftDefenderThreatsByWindowsEndpointId'],
  list_defender_threats_by_logical_group: ['GetMicrosoftDefenderThreatsByLogicalGroupId'],
  list_defender_windows_endpoints: ['GetMicrosoftDefenderStates'],
  get_defender_windows_endpoint: ['GetMicrosoftDefenderStatesByWindowsEndpointId'],
  get_bitlocker_secrets: ['GetBitLockerSecretsByWindowsEndpointId'],
  update_bitlocker_pin: ['UpdateBitLockerPinByWindowsEndpointId'],
};
