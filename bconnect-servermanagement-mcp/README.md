# bconnect-servermanagement-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Server management — management server info, microservices, security groups/profiles, object permissions, and infrastructure components  
**Tools:** 25 (30 in 26R1 mode)

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:444/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
BCONNECT_REJECT_UNAUTHORIZED=true
# Optional: BCONNECT_RELEASE=26R1   (enables additional tools for baramundi 2026 R1)
# Optional: AUDIT_LOG_LEVEL=write   (all / write / security / none)
```

```bash
# Run directly (development)
cd bconnect-servermanagement-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-servermanagement": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-servermanagement-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms-server:444/bconnect",
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
| `get_management_server` | Get baramundi Management Server info and status |
| `get_gateway` | Get Gateway configuration and status |
| `get_dip_status` | Get status of all Distribution and Inventory Points |
| `get_vpn_appliance` | Get VPN Appliance configuration and status |
| `list_microservices` | List all registered microservices |
| `get_microservice` | Get details of a specific microservice by GUID |
| `start_microservice` | Start a specific microservice |
| `stop_microservice` | Stop a specific microservice |
| `restart_microservice` | Restart a specific microservice |
| `list_cloud_connectors` | List all configured Cloud Connectors |
| `list_pxe_relays` | List all configured PXE Relay servers |
| `list_security_groups` | List all security groups in baramundi |
| `get_security_group` | Get details of a specific security group |
| `create_security_group` | Create a new security group |
| `update_security_group` | Update a security group via JSON Patch |
| `delete_security_group` | Delete a security group by GUID |
| `list_security_profiles` | List all security profiles in baramundi |
| `get_security_profile` | Get details of a specific security profile |
| `create_security_profile` | Create a new security profile |
| `update_security_profile` | Update a security profile via JSON Patch |
| `delete_security_profile` | Delete a security profile by GUID |
| `get_access_rights` | Get object permissions for a specific object |
| `update_object_permission` | Update object permissions via JSON Patch |
| `restart_management_server` | Restart the baramundi Management Server |
| `cancel_scheduled_restart` | Cancel a scheduled server restart |
| `list_api_keys` | **(26R1)** List all API keys configured in baramundi |
| `simulate_msw_cleanup` | **(26R1)** Simulate an MSW cleanup operation (dry run) |
| `msw_cleanup` | **(26R1)** Execute an MSW cleanup on the DIP |
| `list_download_jobs` | **(26R1)** List all download jobs |
| `get_download_job` | **(26R1)** Get details of a specific download job |

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
