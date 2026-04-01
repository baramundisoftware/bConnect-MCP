#!/usr/bin/env node
/**
 * Patches all 13 bConnect MCP servers with:
 *  1. REQ-SRV-012 — Write-operation gate (ALLOW_WRITE_OPERATIONS)
 *  2. REQ-SRV-013 — Startup connectivity check
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Write tool names per server ───────────────────────────────────────────────

const WRITE_TOOLS = {
  "bconnect-endpoints-mcp": [
    "start_android_enrollment", "start_ios_enrollment",
    "create_android_endpoint", "update_android_endpoint", "delete_android_endpoint",
    "create_ios_endpoint", "update_ios_endpoint", "delete_ios_endpoint",
    "create_windows_endpoint", "update_windows_endpoint", "delete_windows_endpoint",
    "start_windows_enrollment", "trigger_intune_installation",
    "create_linux_endpoint", "update_linux_endpoint", "delete_linux_endpoint",
    "create_mac_endpoint", "update_mac_endpoint", "delete_mac_endpoint",
    "start_mac_enrollment",
    "create_logical_group", "update_logical_group", "delete_logical_group",
    "create_maintenance_window_for_endpoint", "update_maintenance_window_for_endpoint", "delete_maintenance_window_for_endpoint",
    "create_maintenance_window_for_logical_group", "update_maintenance_window_for_logical_group", "delete_maintenance_window_for_logical_group",
    "create_industrial_endpoint", "update_industrial_endpoint", "delete_industrial_endpoint",
    "create_network_endpoint", "update_network_endpoint", "delete_network_endpoint",
    "delete_endpoint", "delete_unmanaged_endpoint",
  ],
  "bconnect-jobs-mcp": [
    "create_job_instance", "start_job_instance", "stop_job_instance", "resume_job_instance", "delete_job_instance",
    "create_job_folder", "update_job_folder", "delete_job_folder",
    "assign_job_to_logical_group", "assign_job_to_static_group", "assign_job_to_dynamic_group", "assign_job_to_universal_dynamic_group",
    "create_kiosk_release",
  ],
  "bconnect-assets-mcp": [
    "create_asset", "update_asset", "delete_asset",
    "create_asset_stock_folder", "update_asset_stock_folder", "delete_asset_stock_folder",
    "create_asset_type_folder", "update_asset_type_folder", "delete_asset_type_folder",
    "create_asset_type", "delete_asset_type",
  ],
  "bconnect-software-mcp": [
    "create_software_bundle", "delete_software_bundle",
    "add_application_to_bundle", "delete_bundle_application",
    "create_bundle_folder", "delete_bundle_folder", "update_bundle_folder",
  ],
  "bconnect-variables-mcp": [
    "create_variable_definition", "update_variable_definition", "delete_variable_definition",
    "update_variable_instance",
  ],
  "bconnect-defensecontrol-mcp": [
    "update_bitlocker_pin", "patch_local_admin_user_credentials", "trigger_update_on_client",
  ],
  "bconnect-updatemanagement-mcp": [
    "update_update_management_endpoint",
  ],
  "bconnect-operatingsystems-mcp": [
    "create_os_folder", "update_os_folder", "delete_os_folder", "update_os_windows_endpoint",
  ],
  "bconnect-servermanagement-mcp": [
    "start_microservice", "stop_microservice", "restart_microservice",
    "create_security_group", "update_security_group", "delete_security_group",
    "create_security_profile", "update_security_profile", "delete_security_profile",
    "update_object_permission", "restart_management_server", "cancel_scheduled_restart",
    "simulate_msw_cleanup", "msw_cleanup",
  ],
  // Read-only servers — no write gate needed, startup check only
  "bconnect-activedirectory-mcp": [],
  "bconnect-compliance-mcp": [],
  "bconnect-universaldynamicgroups-mcp": [],
  "bconnect-groups-mcp": [],
};

// ── Write-gate snippet to inject ─────────────────────────────────────────────

function writeGateSnippet(serverName, tools) {
  if (tools.length === 0) return null;
  const toolList = tools.map(t => `    "${t}",`).join("\n");
  return `
    // ── Write-operation gate (REQ-SRV-012) ───────────────────────────────────
    const WRITE_TOOLS = new Set<string>([
${toolList}
    ]);
    if (WRITE_TOOLS.has(name) && process.env.ALLOW_WRITE_OPERATIONS !== "true") {
      return {
        content: [{
          type: "text" as const,
          text: \`Write operation '\${name}' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.\`
        }],
        isError: true
      };
    }
`;
}

// ── Startup check snippet to inject ──────────────────────────────────────────
// Self-contained: creates a temporary BConnectClient so it works in servers
// where main() does not pre-build a client (lazy getBconnect() pattern).

function startupCheckSnippet(serverName) {
  return `
  // Startup connectivity check (REQ-SRV-013)
  dotenv.config();
  {
    const _startupUrl = process.env.BCONNECT_BASE_URL || "https://bms-win22srv:444/bconnect";
    const _startupUser = process.env.BCONNECT_USERNAME;
    const _startupPass = process.env.BCONNECT_PASSWORD;
    if (!_startupUser || !_startupPass) {
      console.error("${serverName}: BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
      process.exit(1);
    }
    const _caCertPath = process.env.BCONNECT_CA_CERT_PATH;
    const _caCert = _caCertPath ? fs.readFileSync(_caCertPath, "utf8") : undefined;
    const _startupClient = new BConnectClient({
      baseUrl: _startupUrl,
      username: _startupUser,
      password: _startupPass,
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
      ...(_caCert && { ca: _caCert }),
    });
    console.error(\`${serverName}: verifying bConnect API connectivity...\`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(\`${serverName}: cannot reach bConnect API at \${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.\`);
      process.exit(1);
    }
    console.error(\`${serverName}: API connectivity verified.\`);
  }
`;
}

// ── Patch a single server ─────────────────────────────────────────────────────

function patchServer(serverName) {
  const filePath = join(ROOT, serverName, "src", "index.ts");
  let src = readFileSync(filePath, "utf8");

  let changed = false;

  // ── REQ-SRV-012: Write-gate ────────────────────────────────────────────────
  const writeTools = WRITE_TOOLS[serverName];
  const gateSnippet = writeGateSnippet(serverName, writeTools);

  if (gateSnippet && !src.includes("WRITE_TOOLS")) {
    // Inject after `const { name, arguments: args } = request.params;`
    const anchor = "const { name, arguments: args } = request.params;";
    if (!src.includes(anchor)) {
      console.error(`  [SKIP write-gate] anchor not found in ${serverName}`);
    } else {
      src = src.replace(anchor, anchor + "\n" + gateSnippet);
      changed = true;
      console.log(`  [OK] write-gate injected (${writeTools.length} write tools)`);
    }
  } else if (!gateSnippet) {
    console.log(`  [SKIP write-gate] no write tools`);
  } else {
    console.log(`  [SKIP write-gate] already present`);
  }

  // ── REQ-SRV-013: Startup check ────────────────────────────────────────────
  if (src.includes("REQ-SRV-013")) {
    console.log(`  [SKIP startup-check] already present`);
  } else {
    // Inject before `const { server } = createServer();`
    const anchor = "const { server } = createServer();";
    if (!src.includes(anchor)) {
      console.error(`  [SKIP startup-check] anchor not found in ${serverName}`);
    } else {
      src = src.replace(anchor, startupCheckSnippet(serverName) + "\n  " + anchor);
      changed = true;
      console.log(`  [OK] startup-check injected`);
    }
  }

  if (changed) {
    writeFileSync(filePath, src, "utf8");
    console.log(`  → written: ${filePath}`);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

for (const serverName of Object.keys(WRITE_TOOLS)) {
  console.log(`\nPatching ${serverName}...`);
  try {
    patchServer(serverName);
  } catch (e) {
    console.error(`  [ERROR] ${e.message}`);
  }
}

console.log("\nDone.");
