/**
 * Server tool registration tests for bconnect-jobs-mcp
 *
 * Asserts that listTools() returns exactly the tools from:
 *   - jobs module (~24 tools)
 *
 * And does NOT contain tools from any other domain server.
 */

import { describe, it, expect } from 'vitest';

import { createServer } from '../index.js';

// ── Expected tool sets ─────────────────────────────────────────────────────

const JOBS_TOOLS = [
  // Read operations
  'list_job_definitions',
  'get_job_definition',
  'list_job_instances',
  'get_job_instance',
  'list_endpoint_job_instances',
  'list_job_instances_by_definition',
  'list_job_instances_by_logical_group',
  'list_job_definitions_by_folder',
  // Write operations
  'create_job_instance',
  'start_job_instance',
  'stop_job_instance',
  'resume_job_instance',
  'delete_job_instance',
  // Folder management
  'create_job_folder',
  'update_job_folder',
  'delete_job_folder',
  // Assignment operations
  'assign_job_to_logical_group',
  'assign_job_to_static_group',
  'assign_job_to_dynamic_group',
  'assign_job_to_universal_dynamic_group',
  // Kiosk releases
  'create_kiosk_release',
  'withdraw_kiosk_release',
  'list_kiosk_releases',
  'get_kiosk_release',
  // Phase 26: Folder navigation
  'list_job_folders',
  'get_job_folder',
  'list_job_subfolders',
  // Phase 26: Kiosk releases by context
  'list_kiosk_releases_by_job_definition',
  'list_kiosk_releases_by_endpoint',
  'list_kiosk_releases_by_ad_object',
  'list_kiosk_releases_by_logical_group',
  // Phase 26: Job instances by group
  'list_job_instances_by_static_group',
  'list_job_instances_by_dynamic_group',
  'list_job_instances_by_universal_dynamic_group',
] as const;

const ALL_EXPECTED_TOOLS: string[] = [...JOBS_TOOLS];

// ── Tool names that must NOT appear in this server ─────────────────────────

const SERVERMANAGEMENT_TOOLS = [
  'get_management_server',
  'get_gateway',
  'get_dip_status',
  'get_vpn_appliance',
  'list_microservices',
  'get_microservice',
  'list_cloud_connectors',
  'list_pxe_relays',
  'list_security_groups',
  'get_security_group',
  'list_security_profiles',
  'get_security_profile',
  'get_object_access_rights',
  'restart_management_server',
  'cancel_scheduled_restart',
  'start_microservice',
  'stop_microservice',
  'restart_microservice',
  'create_security_group',
  'update_security_group',
  'delete_security_group',
  'create_security_profile',
  'update_security_profile',
  'delete_security_profile',
  'update_object_permission',
];

const VARIABLES_TOOLS = [
  'list_variable_definitions',
  'get_variable_definition',
  'list_variable_instances',
  'get_variable_instance',
  'list_variables_by_endpoint',
  'list_variables_by_logical_group',
  'list_variables_by_ad_object',
  'list_variables_by_windows_application',
  'list_variables_by_windows_job',
  'create_variable_definition',
  'update_variable_definition',
  'delete_variable_definition',
  'update_variable_instance',
];

const ENDPOINTS_TOOLS = [
  'list_endpoints',
  'get_endpoint',
  'search_endpoints',
  'list_windows_endpoints',
  'get_windows_endpoint',
  'list_logical_groups',
  'get_logical_group',
  'list_group_endpoints',
  'list_linux_endpoints',
  'list_mac_endpoints',
  'get_linux_endpoint',
  'get_mac_endpoint',
  'list_endpoints_by_logical_group',
  'list_windows_endpoints_by_logical_group',
  'start_android_enrollment',
  'start_ios_enrollment',
  'create_android_endpoint',
  'update_android_endpoint',
  'delete_android_endpoint',
  'create_windows_endpoint',
  'update_windows_endpoint',
  'delete_windows_endpoint',
  'start_windows_enrollment',
  'trigger_intune_installation',
  'create_linux_endpoint',
  'update_linux_endpoint',
  'delete_linux_endpoint',
  'create_mac_endpoint',
  'update_mac_endpoint',
  'delete_mac_endpoint',
  'start_mac_enrollment',
  'create_logical_group',
  'update_logical_group',
  'delete_logical_group',
  'create_maintenance_window_for_endpoint',
  'update_maintenance_window_for_endpoint',
  'delete_maintenance_window_for_endpoint',
  'create_maintenance_window_for_logical_group',
  'update_maintenance_window_for_logical_group',
  'delete_maintenance_window_for_logical_group',
  'create_industrial_endpoint',
  'update_industrial_endpoint',
  'delete_industrial_endpoint',
  'create_network_endpoint',
  'update_network_endpoint',
  'delete_network_endpoint',
  'delete_endpoint',
];

const ACTIVEDIRECTORY_TOOLS = [
  'list_ad_groups',
  'get_ad_group',
  'list_ad_users',
  'get_ad_user',
  'list_ad_objects',
  'get_ad_object',
  'list_org_units',
  'get_org_unit',
  'list_ad_users_by_group',
  'list_ad_groups_by_org_unit',
  'get_ad_object_memberships',
];

const OPERATINGSYSTEMS_TOOLS = [
  'list_os_folders',
  'get_os_folder',
  'list_os_folders_by_parent',
  'list_os_windows_endpoints',
  'get_os_windows_endpoint',
  'create_os_folder',
  'update_os_folder',
  'delete_os_folder',
  'update_os_windows_endpoint',
];

const ASSETS_TOOLS = [
  'list_assets',
  'get_asset',
  'list_asset_types',
  'get_asset_type',
  'list_assets_by_logical_group',
  'list_assets_by_endpoint',
  'list_asset_stock_assets',
  'list_asset_stock_folders',
  'create_asset',
  'update_asset',
  'delete_asset',
];

const DEFENSECONTROL_TOOLS = [
  'list_bitlocker_windows_endpoints',
  'get_bitlocker_windows_endpoint',
  'get_local_admin_accounts',
  'trigger_local_admin_accounts_update',
  'trigger_update_on_client',
  'patch_local_admin_user_credentials',
  'list_defender_threats',
  'get_defender_threat',
  'list_defender_threats_by_endpoint',
  'list_defender_threats_by_logical_group',
  'list_defender_windows_endpoints',
  'get_defender_windows_endpoint',
];

const V11_TOOLS = [
  'list_compliance_violations_v1',
  'get_compliance_violation_v1',
  'list_compliance_violations_by_endpoint_v1',
  'get_endpoint_secrets_v1',
  'get_bitlocker_recovery_keys_v1',
  'get_tpm_owner_passwords_v1',
  'get_bitlocker_pins_v1',
  'get_secret_by_volume_v1',
  'list_vpp_users_v1',
  'get_vpp_user_v1',
  'create_vpp_user_v1',
  'delete_vpp_user_v1',
  'list_vpp_license_associations_v1',
  'assign_vpp_license_v1',
  'revoke_vpp_license_v1',
  'get_endpoint_ssh_info_v1',
  'get_bfcrx_integrity_v1',
  'get_agent_setup_integrity_v1',
  'get_inventory_file_scans_v1',
  'get_inventory_wmi_scans_v1',
  'get_inventory_custom_scans_v1',
  'get_inventory_hardware_scans_v1',
  'get_inventory_snmp_scans_v1',
];

const ALL_FORBIDDEN_TOOLS: string[] = [
  ...SERVERMANAGEMENT_TOOLS,
  ...VARIABLES_TOOLS,
  ...ENDPOINTS_TOOLS,
  ...ACTIVEDIRECTORY_TOOLS,
  ...OPERATINGSYSTEMS_TOOLS,
  ...ASSETS_TOOLS,
  ...DEFENSECONTROL_TOOLS,
  ...V11_TOOLS,
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function getToolNames(): Promise<string[]> {
  const { server } = createServer();

  const response = await server.request(
    { method: 'tools/list', params: {} },
    {} as never
  );

  const tools = (response as { tools: Array<{ name: string }> }).tools;
  return tools.map((t) => t.name);
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('bconnect-jobs-mcp server — tool registration', () => {
  describe('listTools() response', () => {
    it('contains all expected jobs module tools', async () => {
      const toolNames = await getToolNames();

      for (const expectedTool of JOBS_TOOLS) {
        expect(toolNames, `expected jobs tool "${expectedTool}" to be registered`).toContain(expectedTool);
      }
    });

    it('returns exactly 34 tools (jobs module only)', async () => {
      const toolNames = await getToolNames();

      expect(toolNames).toHaveLength(ALL_EXPECTED_TOOLS.length);
    });

    it('does not contain any servermanagement module tools', async () => {
      const toolNames = await getToolNames();

      for (const forbiddenTool of SERVERMANAGEMENT_TOOLS) {
        expect(toolNames, `servermanagement tool "${forbiddenTool}" must NOT be registered in this server`).not.toContain(forbiddenTool);
      }
    });

    it('does not contain any variables module tools', async () => {
      const toolNames = await getToolNames();

      for (const forbiddenTool of VARIABLES_TOOLS) {
        expect(toolNames, `variables tool "${forbiddenTool}" must NOT be registered in this server`).not.toContain(forbiddenTool);
      }
    });

    it('does not contain any endpoints module tools', async () => {
      const toolNames = await getToolNames();

      for (const forbiddenTool of ENDPOINTS_TOOLS) {
        expect(toolNames, `endpoints tool "${forbiddenTool}" must NOT be registered in this server`).not.toContain(forbiddenTool);
      }
    });

    it('does not contain any activedirectory module tools', async () => {
      const toolNames = await getToolNames();

      for (const forbiddenTool of ACTIVEDIRECTORY_TOOLS) {
        expect(toolNames, `activedirectory tool "${forbiddenTool}" must NOT be registered in this server`).not.toContain(forbiddenTool);
      }
    });

    it('does not contain any operatingsystems module tools', async () => {
      const toolNames = await getToolNames();

      for (const forbiddenTool of OPERATINGSYSTEMS_TOOLS) {
        expect(toolNames, `operatingsystems tool "${forbiddenTool}" must NOT be registered in this server`).not.toContain(forbiddenTool);
      }
    });

    it('does not contain any assets module tools', async () => {
      const toolNames = await getToolNames();

      for (const forbiddenTool of ASSETS_TOOLS) {
        expect(toolNames, `assets tool "${forbiddenTool}" must NOT be registered in this server`).not.toContain(forbiddenTool);
      }
    });

    it('does not contain any defensecontrol module tools', async () => {
      const toolNames = await getToolNames();

      for (const forbiddenTool of DEFENSECONTROL_TOOLS) {
        expect(toolNames, `defensecontrol tool "${forbiddenTool}" must NOT be registered in this server`).not.toContain(forbiddenTool);
      }
    });

    it('does not contain any V1.1 API tools', async () => {
      const toolNames = await getToolNames();

      for (const forbiddenTool of V11_TOOLS) {
        expect(toolNames, `V1.1 tool "${forbiddenTool}" must NOT be registered in this server`).not.toContain(forbiddenTool);
      }
    });

    it('contains no tools outside the jobs module', async () => {
      const toolNames = await getToolNames();
      const unexpectedTools = toolNames.filter((name) => !ALL_EXPECTED_TOOLS.includes(name));

      expect(
        unexpectedTools,
        `Unexpected tools found: ${unexpectedTools.join(', ')}`
      ).toHaveLength(0);
    });
  });
});
