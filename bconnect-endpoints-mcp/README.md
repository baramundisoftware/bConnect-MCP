# bconnect-endpoints-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Managed endpoints — Windows, Linux, macOS, Android, iOS, network, and industrial devices  
**Tools:** 58 (66 in 26R1 mode)

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
# Optional: BCONNECT_RELEASE=25R2   (hides the tools that need baramundi 2026 R1)
# Optional: BCONNECT_CA_CERT_PATH=/path/to/internal-ca.pem
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

Run inside the HTTP gateway, the server's own startup code doesn't run: `MCP_TRANSPORT`, `MCP_PORT`, `MCP_BIND`, `MCP_ALLOW_NO_AUTH` and `BCONNECT_SKIP_CONNECTIVITY_CHECK` then have no effect here, and the gateway's own settings apply.

<!-- env:start -->
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect base URL, e.g. `https://bms.corp.local:443/bconnect`. If unset, a placeholder is used and the startup check fails. |
| `BCONNECT_API_KEY` | One of | — | API key. Set this, or `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. Used instead of them when both are set. |
| `BCONNECT_USERNAME` | One of | — | User for Basic authentication, together with `BCONNECT_PASSWORD`. |
| `BCONNECT_PASSWORD` | One of | — | Password for `BCONNECT_USERNAME`. |
| `BCONNECT_CA_CERT_PATH` | No | — | PEM file with the CA certificate that signed the bMS server certificate (internal CA). When set, only this CA is trusted; when unset, Node's default and (Node 22.15 or later) the operating system's trusted CAs are used. The server fails if the file can't be read or is empty. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | verify | `0` turns certificate verification off for every TLS connection of the process. Development only; use `BCONNECT_CA_CERT_PATH` instead. |
| `BCONNECT_RELEASE` | No | `26R1` | Any value other than `26R1` (e.g. `25R2`, but also an empty value) hides the tools that need baramundi Management Suite 2026 R1. |
| `ALLOW_WRITE_OPERATIONS` | No | off | `true` enables the tools that create, change or delete data, or start actions. |
| `ALLOW_SECRET_READ` | No | off | `true` lets the shared client call the BitLocker-secret and LAPS operations. This server has no tool that calls them, so the setting has no effect here. |
| `BCONNECT_AUDIT_LEVEL` | No | `none` | `all`, `write`, `security` or `none`; any other value means `none`. Entries for successful calls are written to stdout, which breaks stdio mode (#168). |
| `BCONNECT_RATE_LIMIT_ENABLED` | No | off | `true` limits the requests one client sends. Each tool call still creates a new client, so the limit doesn't apply across calls yet (#160). |
| `BCONNECT_RATE_LIMIT_MAX_REQUESTS` | No | `100` | Requests allowed per window when the rate limit is on. |
| `BCONNECT_RATE_LIMIT_WINDOW_MS` | No | `60000` | Window length in milliseconds. |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | No | off | `true` skips the startup connectivity check. |
| `MCP_TRANSPORT` | No | `stdio` | `http` serves MCP over HTTP instead of stdio. |
| `MCP_PORT` | No | `3000` | Port in HTTP mode. |
| `MCP_BIND` | No | `127.0.0.1` | Address to bind in HTTP mode. HTTP mode has no client authentication: keep it on loopback, or put an authenticating reverse proxy in front. |
| `MCP_ALLOW_NO_AUTH` | No | off | `true` allows binding HTTP mode to an address other than loopback, without authentication. Not recommended. |
<!-- env:end -->

---

## Part of the Suite

This server is one of 13 in the bConnect MCP Suite. See the [suite README](../MCP_Deployment/README.md) for deployment options (Windows installer, Linux systemd, Docker).

---

## Compatibility

| MCP server version | Supported bMS release | bConnect API | Notes |
|--------------------|-----------------------|--------------|-------|
| `26.1.7` | baramundi Management Suite 2026R1 | V2.0 | Current — full tool set |
| `25.2.0` *(planned)* | baramundi Management Suite 2025R2 | V2.0 | Subset of tools (25R2 spec) |
| `1.0.0` (legacy) | ≤25R2 (unspecified) | V2.0 | Pre-versioning-scheme release |

> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
> Example: `26.1.7` targets bMS 2026R1; patch-only fixes increment the last digit.
