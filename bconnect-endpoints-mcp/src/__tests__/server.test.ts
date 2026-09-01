/**
 * Server tool registration tests for bconnect-endpoints-mcp
 *
 * Asserts that listTools() returns exactly the tools from:
 *   - endpoints module (~47 tools)
 *
 * And does NOT contain tools from any other domain server.
 *
 * ── TOK-20: the catalogue is now gate-dependent ────────────────────────────
 * Write tools are advertised only when ALLOW_WRITE_OPERATIONS=true. This file
 * therefore pins the surface with the gate OPEN, which is the assertion that
 * matters for "did a tool go missing": opening the gate must reproduce exactly
 * the set this server declares. The gate-closed surface, and the fact that a
 * hidden write is still callable-and-refused, are asserted in
 * tool-surface.test.ts.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';

import { listToolNames } from './lib/connect.js';

// ── Expected tool sets ─────────────────────────────────────────────────────

const ENDPOINTS_TOOLS = [
  // ── Reads ────────────────────────────────────────────────────────────────
  //
  // The six per-platform read families collapsed. "list_windows_endpoints",
  // "get_linux_endpoint" and their eighteen siblings are gone; the platform is
  // now the "type" argument of the tool below it. The negative assertions —
  // that each removed name is absent AND explains itself when called — live in
  // family-collapse.test.ts, which is where the route-per-type proof is too.
  'list_endpoints',
  'get_endpoint',
  'list_endpoints_by_logical_group',
  'list_logical_groups',
  'get_logical_group',
  'get_maintenance_window_for_endpoint',
  'get_maintenance_window_for_logical_group',
  'get_entra_id_data',

  // ── Writes ───────────────────────────────────────────────────────────────
  'update_endpoint',
  'delete_endpoint',
  'start_enrollment',
  // create_* stays per platform on purpose: zero shared parameters across the
  // six, and three different required sets. See the note in tool-catalogue.ts.
  'create_windows_endpoint',
  'create_linux_endpoint',
  'create_mac_endpoint',
  'create_android_endpoint',
  'create_ios_endpoint',
  'create_network_endpoint',
  'trigger_intune_installation',
  'create_logical_group',
  'update_logical_group',
  'delete_logical_group',
  'create_maintenance_window_for_endpoint',
  'update_maintenance_window_for_endpoint',
  'delete_maintenance_window_for_endpoint',
  'create_maintenance_window_for_logical_group',
  'update_maintenance_window_for_logical_group',
  'delete_maintenance_window_for_logical_group',
  'link_entra_id_data',
  'unlink_entra_id_data',
] as const;

/**
 * Names this server used to register and must not register again.
 *
 * Five because 26R1 deleted /v2.0/IndustrialEndpoints outright (product
 * decision 1), the rest because they collapsed into a type-taking tool. Kept
 * here as a list rather than deleted so the removal cannot silently regress —
 * a re-added "list_industrial_endpoints" fails this file.
 */
const REMOVED_TOOLS = [
  'list_industrial_endpoints',
  'get_industrial_endpoint',
  'create_industrial_endpoint',
  'update_industrial_endpoint',
  'delete_industrial_endpoint',
  'list_windows_endpoints',
  'list_linux_endpoints',
  'list_mac_endpoints',
  'list_android_endpoints',
  'list_ios_endpoints',
  'list_network_endpoints',
  'list_unmanaged_endpoints',
  'get_windows_endpoint',
  'get_linux_endpoint',
  'get_mac_endpoint',
  'get_android_endpoint',
  'get_ios_endpoint',
  'get_network_endpoint',
  'get_unmanaged_endpoint',
  'delete_windows_endpoint',
  'delete_linux_endpoint',
  'delete_mac_endpoint',
  'delete_android_endpoint',
  'delete_ios_endpoint',
  'delete_network_endpoint',
  'delete_unmanaged_endpoint',
  'update_windows_endpoint',
  'update_linux_endpoint',
  'update_mac_endpoint',
  'update_android_endpoint',
  'update_ios_endpoint',
  'update_network_endpoint',
  'start_windows_enrollment',
  'start_mac_enrollment',
  'start_android_enrollment',
  'start_ios_enrollment',
  'search_endpoints',
  'list_windows_endpoints_by_logical_group',
  'list_group_endpoints',
] as const;

/** LOCAL ADDITION — composite read-only tools, not upstream. */
const LOCAL_ADDITIONS = ['get_fleet_summary', 'get_stale_endpoints'] as const;

const ALL_EXPECTED_TOOLS: string[] = [...ENDPOINTS_TOOLS, ...LOCAL_ADDITIONS];

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
  'refresh_local_admin_account_expiry',
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

const _ALL_FORBIDDEN_TOOLS: string[] = [
  ...ACTIVEDIRECTORY_TOOLS,
  ...OPERATINGSYSTEMS_TOOLS,
  ...JOBS_TOOLS,
  ...ASSETS_TOOLS,
  ...DEFENSECONTROL_TOOLS,
  ...VARIABLES_TOOLS,
  ...V11_TOOLS,
];

// ── Helpers ────────────────────────────────────────────────────────────────

// Upstream finding OPT-39: this used to call server.request() directly, which
// only worked because createServer() monkey-patched the SDK's private
// _requestHandlers map in production code. It now goes over an
// InMemoryTransport pair like the other servers' tests — see lib/connect.ts.
async function getToolNames(): Promise<string[]> {
  return listToolNames();
}

// ── Test suite ─────────────────────────────────────────────────────────────

// TOK-20 — the gate is opened for this file so the assertions below describe
// the DECLARED surface rather than the advertised one. Restored afterwards so
// no other file inherits an open gate.
const savedWriteGate = process.env.ALLOW_WRITE_OPERATIONS;

beforeEach(() => {
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
});

afterEach(() => {
  delete process.env.BCONNECT_RELEASE;
  if (savedWriteGate === undefined) {
    delete process.env.ALLOW_WRITE_OPERATIONS;
  } else {
    process.env.ALLOW_WRITE_OPERATIONS = savedWriteGate;
  }
});

describe('bconnect-endpoints-mcp server — tool registration', () => {
  describe('listTools() response', () => {
    it('contains all expected endpoints module tools', async () => {
      const toolNames = await getToolNames();

      for (const expectedTool of ENDPOINTS_TOOLS) {
        expect(toolNames, `expected endpoints tool "${expectedTool}" to be registered`).toContain(expectedTool);
      }
    });

    it('registers exactly the declared surface', async () => {
      expect(await getToolNames()).toHaveLength(ALL_EXPECTED_TOOLS.length);
    });

    it('registers none of the removed names, with the gate open', async () => {
      const toolNames = await getToolNames();
      for (const removed of REMOVED_TOOLS) {
        expect(toolNames, `"${removed}" was removed and must not be registered`).not.toContain(
          removed
        );
      }
    });

    // ── Product decision 2: 26R1 only, so there is no release conditional ────
    //
    // The catalogue used to branch on BCONNECT_RELEASE: six tools (the unmanaged
    // trio and the three EntraID tools) were pushed only when it was unset or
    // "26R1", and six CallTool arms threw MethodNotFound otherwise. A surface
    // that changes shape with an environment variable is a surface no test can
    // pin, and 25R2 is no longer supported. This asserts the variable is inert
    // — including for the six names that used to depend on it.
    it('ignores BCONNECT_RELEASE entirely — the surface is 26R1, always', async () => {
      const withoutRelease = await getToolNames();

      for (const value of ['25R2', '24R1', 'nonsense', '']) {
        process.env.BCONNECT_RELEASE = value;
        expect(
          await getToolNames(),
          `BCONNECT_RELEASE=${JSON.stringify(value)} must not change the tool surface`
        ).toEqual(withoutRelease);
      }

      // The six that used to be conditional, named explicitly: three are now
      // enum VALUES of the collapsed tools rather than tools, three are tools.
      process.env.BCONNECT_RELEASE = '25R2';
      const under25R2 = await getToolNames();
      for (const tool of ['get_entra_id_data', 'link_entra_id_data', 'unlink_entra_id_data']) {
        expect(under25R2, `${tool} used to disappear under 25R2`).toContain(tool);
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
