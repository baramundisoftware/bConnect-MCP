# bconnect-endpoints-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Managed endpoints — Windows, Linux, macOS, Android, iOS, network, and industrial devices  
**Tools:** 58 (64 in 26R1 mode)

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
BCONNECT_REJECT_UNAUTHORIZED=true
# Optional: BCONNECT_RELEASE=26R1   (enables additional tools for baramundi 2026 R1)
# Optional: AUDIT_LOG_LEVEL=write   (all / write / security / none)
```

```bash
# Run directly (development)
cd bconnect-endpoints-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-endpoints": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-endpoints-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms-server:443/bconnect",
        "BCONNECT_USERNAME": "mcp-reader",
        "BCONNECT_PASSWORD": "<password>"
      }
    }
  }
}
```

---

## Available Tools

| Tool | Description |
|------|-------------|
| `list_endpoints` | List all managed endpoints across all OS types |
| `get_endpoint` | Get details of a specific endpoint by GUID |
| `search_endpoints` | Search endpoints by name or other criteria |
| `list_windows_endpoints` | List all managed Windows endpoints |
| `get_windows_endpoint` | Get details of a specific Windows endpoint |
| `list_logical_groups` | List all logical groups |
| `get_logical_group` | Get details of a specific logical group |
| `list_group_endpoints` | List endpoints belonging to a group |
| `list_linux_endpoints` | List all managed Linux endpoints |
| `list_mac_endpoints` | List all managed macOS endpoints |
| `get_linux_endpoint` | Get details of a specific Linux endpoint |
| `get_mac_endpoint` | Get details of a specific macOS endpoint |
| `list_endpoints_by_logical_group` | List all endpoints in a logical group |
| `list_windows_endpoints_by_logical_group` | List Windows endpoints in a logical group |
| `list_android_endpoints` | List all managed Android endpoints |
| `get_android_endpoint` | Get details of a specific Android endpoint |
| `list_ios_endpoints` | List all managed iOS endpoints |
| `get_ios_endpoint` | Get details of a specific iOS endpoint |
| `start_android_enrollment` | Start enrollment for an Android device |
| `start_ios_enrollment` | Start enrollment for an iOS device |
| `create_android_endpoint` | Create a new Android endpoint record |
| `update_android_endpoint` | Update an existing Android endpoint |
| `delete_android_endpoint` | Delete an Android endpoint by GUID |
| `create_ios_endpoint` | Create a new iOS endpoint record |
| `update_ios_endpoint` | Update an existing iOS endpoint |
| `delete_ios_endpoint` | Delete an iOS endpoint by GUID |
| `create_windows_endpoint` | Create a new Windows endpoint record |
| `update_windows_endpoint` | Update an existing Windows endpoint |
| `delete_windows_endpoint` | Delete a Windows endpoint by GUID |
| `start_windows_enrollment` | Start enrollment for a Windows device |
| `trigger_intune_installation` | Trigger an Intune installation on an endpoint |
| `create_linux_endpoint` | Create a new Linux endpoint record |
| `update_linux_endpoint` | Update an existing Linux endpoint |
| `delete_linux_endpoint` | Delete a Linux endpoint by GUID |
| `create_mac_endpoint` | Create a new macOS endpoint record |
| `update_mac_endpoint` | Update an existing macOS endpoint |
| `delete_mac_endpoint` | Delete a macOS endpoint by GUID |
| `start_mac_enrollment` | Start enrollment for a macOS device |
| `create_logical_group` | Create a new logical group |
| `update_logical_group` | Update an existing logical group |
| `delete_logical_group` | Delete a logical group by GUID |
| `get_maintenance_window_for_endpoint` | Get the maintenance window for an endpoint |
| `create_maintenance_window_for_endpoint` | Create a maintenance window for an endpoint |
| `update_maintenance_window_for_endpoint` | Update a maintenance window for an endpoint |
| `delete_maintenance_window_for_endpoint` | Delete a maintenance window for an endpoint |
| `get_maintenance_window_for_logical_group` | Get the maintenance window for a logical group |
| `create_maintenance_window_for_logical_group` | Create a maintenance window for a logical group |
| `update_maintenance_window_for_logical_group` | Update a maintenance window for a logical group |
| `delete_maintenance_window_for_logical_group` | Delete a maintenance window for a logical group |
| `create_industrial_endpoint` | Create a new industrial endpoint (PLC, SCADA) |
| `update_industrial_endpoint` | Update an existing industrial endpoint |
| `delete_industrial_endpoint` | Delete an industrial endpoint by GUID |
| `list_network_endpoints` | List all network endpoints (switches, routers, printers) |
| `get_network_endpoint` | Get details of a specific network endpoint |
| `create_network_endpoint` | Create a new network endpoint |
| `update_network_endpoint` | Update an existing network endpoint |
| `delete_network_endpoint` | Delete a network endpoint by GUID |
| `delete_endpoint` | Delete any endpoint by GUID (generic delete) |
| `list_unmanaged_endpoints` | **(26R1)** List all unmanaged detected endpoints |
| `get_unmanaged_endpoint` | **(26R1)** Get details of an unmanaged endpoint |
| `delete_unmanaged_endpoint` | **(26R1)** Delete an unmanaged endpoint record |
| `get_entra_id_data` | **(26R1)** Get Microsoft EntraID data for an endpoint |
| `link_entra_id_data` | **(26R1)** Link an EntraID device to a baramundi endpoint |
| `unlink_entra_id_data` | **(26R1)** Unlink EntraID data from an endpoint |

> Tools marked **(26R1)** require `BCONNECT_RELEASE=26R1` and baramundi Management Suite 2026 R1 or later.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect REST API base URL |
| `BCONNECT_USERNAME` | Yes | — | API username |
| `BCONNECT_PASSWORD` | Yes | — | API password |
| `BCONNECT_REJECT_UNAUTHORIZED` | No | `true` | Set `false` to allow self-signed TLS |
| `BCONNECT_RELEASE` | No | `25R2` | Set `26R1` to enable additional tools |
| `AUDIT_LOG_LEVEL` | No | `write` | `all` / `write` / `security` / `none` |

---

## Part of the Suite

This server is one of 13 in the bConnect MCP Suite. See the [suite README](../MCP_Deployment/README.md) for deployment options (Windows installer, Linux systemd, Docker).

---

## Compatibility

| MCP server version | Supported bMS release | bConnect API | Notes |
|--------------------|-----------------------|--------------|-------|
| `26.1.0` | baramundi Management Suite 2026R1 | V2.0 | Current — full tool set |
| `25.2.0` *(planned)* | baramundi Management Suite 2025R2 | V2.0 | Subset of tools (25R2 spec) |
| `1.0.0` (legacy) | ≤25R2 (unspecified) | V2.0 | Pre-versioning-scheme release |

> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
> Example: `26.1.0` targets bMS 2026R1; patch-only fixes increment the last digit.
