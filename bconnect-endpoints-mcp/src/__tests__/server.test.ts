/**
 * Server tool registration tests for bconnect-endpoints-mcp
 *
 * Asserts that listTools() returns exactly the tools from:
 *   - endpoints module (~47 tools)
 *
 * And does NOT contain tools from any other domain server.
 */

import { describe, it, expect } from 'vitest';

import { createServer } from '../index.js';

// ── Expected tool sets ─────────────────────────────────────────────────────

const ENDPOINTS_TOOLS = [
  // Read operations
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
  // Mobile enrollment
  'start_android_enrollment',
  'start_ios_enrollment',
  // Android CRUD (Phase 24: added list + get)
  'list_android_endpoints',
  'get_android_endpoint',
  'create_android_endpoint',
  'update_android_endpoint',
  'delete_android_endpoint',
  // iOS CRUD (Phase 24: added list + get + full CRUD)
  'list_ios_endpoints',
  'get_ios_endpoint',
  'create_ios_endpoint',
  'update_ios_endpoint',
  'delete_ios_endpoint',
  // Windows CRUD
  'create_windows_endpoint',
  'update_windows_endpoint',
  'delete_windows_endpoint',
  'start_windows_enrollment',
  'trigger_intune_installation',
  // Linux CRUD
  'create_linux_endpoint',
  'update_linux_endpoint',
  'delete_linux_endpoint',
  // Mac CRUD
  'create_mac_endpoint',
  'update_mac_endpoint',
  'delete_mac_endpoint',
  'start_mac_enrollment',
  // Logical groups CRUD
  'create_logical_group',
  'update_logical_group',
  'delete_logical_group',
  // Maintenance windows (Phase 24: added GET)
  'get_maintenance_window_for_endpoint',
  'create_maintenance_window_for_endpoint',
  'update_maintenance_window_for_endpoint',
  'delete_maintenance_window_for_endpoint',
  'get_maintenance_window_for_logical_group',
  'create_maintenance_window_for_logical_group',
  'update_maintenance_window_for_logical_group',
  'delete_maintenance_window_for_logical_group',
  // Industrial & network endpoints (Phase 24: added list + get for network)
  'create_industrial_endpoint',
  'update_industrial_endpoint',
  'delete_industrial_endpoint',
  'list_network_endpoints',
  'get_network_endpoint',
  'create_network_endpoint',
  'update_network_endpoint',
  'delete_network_endpoint',
  // Generic delete
  'delete_endpoint',
] as const;

// 26R1-only tools (gated by BCONNECT_RELEASE=26R1)
const ENDPOINTS_TOOLS_26R1_ONLY = [
  'list_unmanaged_endpoints',
  'get_unmanaged_endpoint',
  'delete_unmanaged_endpoint',
  'get_entra_id_data',
  'link_entra_id_data',
  'unlink_entra_id_data',
] as const;

const ALL_EXPECTED_TOOLS: string[] = [...ENDPOINTS_TOOLS];
const ALL_EXPECTED_TOOLS_26R1: string[] = [...ENDPOINTS_TOOLS, ...ENDPOINTS_TOOLS_26R1_ONLY];

// ── Tool names that must NOT appear in this server ─────────────────────────

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

const JOBS_TOOLS = [
  'list_job_definitions',
  'get_job_definition',
  'list_job_instances',
  'get_job_instance',
  'list_endpoint_job_instances',
  'list_job_instances_by_definition',
  'list_job_instances_by_logical_group',
  'list_job_definitions_by_folder',
  'create_job_instance',
  'start_job_instance',
  'stop_job_instance',
  'resume_job_instance',
  'delete_job_instance',
  'create_job_folder',
  'update_job_folder',
  'delete_job_folder',
  'assign_job_to_logical_group',
  'assign_job_to_static_group',
  'assign_job_to_dynamic_group',
  'assign_job_to_universal_dynamic_group',
  'create_kiosk_release',
  'withdraw_kiosk_release',
  'list_kiosk_releases',
  'get_kiosk_release',
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
  ...ACTIVEDIRECTORY_TOOLS,
  ...OPERATINGSYSTEMS_TOOLS,
  ...JOBS_TOOLS,
  ...ASSETS_TOOLS,
  ...DEFENSECONTROL_TOOLS,
  ...VARIABLES_TOOLS,
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

describe('bconnect-endpoints-mcp server — tool registration', () => {
  describe('listTools() response', () => {
    it('contains all expected endpoints module tools', async () => {
      const toolNames = await getToolNames();

      for (const expectedTool of ENDPOINTS_TOOLS) {
        expect(toolNames, `expected endpoints tool "${expectedTool}" to be registered`).toContain(expectedTool);
      }
    });

    it('returns exactly 58 tools in 25R2 mode (endpoints module, no 26R1-only)', async () => {
      const toolNames = await getToolNames();

      // Without BCONNECT_RELEASE=26R1, 26R1-only tools (unmanaged, EntraID) are excluded
      expect(toolNames).toHaveLength(ALL_EXPECTED_TOOLS.length);
    });

    it('does not contain 26R1-only tools in default (25R2) mode', async () => {
      const toolNames = await getToolNames();

      for (const tool of ENDPOINTS_TOOLS_26R1_ONLY) {
        expect(toolNames, `26R1-only tool "${tool}" must NOT appear in 25R2 mode`).not.toContain(tool);
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

    it('does not contain any jobs module tools', async () => {
      const toolNames = await getToolNames();

      for (const forbiddenTool of JOBS_TOOLS) {
        expect(toolNames, `jobs tool "${forbiddenTool}" must NOT be registered in this server`).not.toContain(forbiddenTool);
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

    it('does not contain any variables module tools', async () => {
      const toolNames = await getToolNames();

      for (const forbiddenTool of VARIABLES_TOOLS) {
        expect(toolNames, `variables tool "${forbiddenTool}" must NOT be registered in this server`).not.toContain(forbiddenTool);
      }
    });

    it('does not contain any V1.1 API tools', async () => {
      const toolNames = await getToolNames();

      for (const forbiddenTool of V11_TOOLS) {
        expect(toolNames, `V1.1 tool "${forbiddenTool}" must NOT be registered in this server`).not.toContain(forbiddenTool);
      }
    });

    it('contains no tools outside the endpoints module', async () => {
      const toolNames = await getToolNames();
      const unexpectedTools = toolNames.filter((name) => !ALL_EXPECTED_TOOLS.includes(name));

      expect(
        unexpectedTools,
        `Unexpected tools found: ${unexpectedTools.join(', ')}`
      ).toHaveLength(0);
    });
  });
});
