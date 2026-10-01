# bconnect-servermanagement-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Server management — management server info, microservices, security groups/profiles, object permissions, and infrastructure components  
**Tools:** 25 (30 in 26R1 mode)

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

<!-- env:start -->
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect base URL, e.g. `https://bms.corp.local:443/bconnect`. If unset, a placeholder is used and the startup check fails. |
| `BCONNECT_API_KEY` | One of | — | API key. Set this, or `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. Used instead of them when both are set. |
| `BCONNECT_USERNAME` | One of | — | User for Basic authentication, together with `BCONNECT_PASSWORD`. |
| `BCONNECT_PASSWORD` | One of | — | Password for `BCONNECT_USERNAME`. |
| `BCONNECT_CA_CERT_PATH` | No | — | PEM file with the CA certificate that signed the bMS server certificate (internal CA). The server fails if the file can't be read. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | verify | `0` turns certificate verification off for every TLS connection of the process. Development only; use `BCONNECT_CA_CERT_PATH` instead. |
| `BCONNECT_RELEASE` | No | `26R1` | `25R2` hides the tools that need baramundi Management Suite 2026 R1. |
| `ALLOW_WRITE_OPERATIONS` | No | off | `true` enables the tools that create, change or delete data, or start actions. |
| `ALLOW_SECRET_READ` | No | off | `true` lets the shared client call the BitLocker-secret and LAPS operations. This server has no tool that calls them, so the setting has no effect here. |
| `BCONNECT_AUDIT_LEVEL` | No | `none` | `all`, `write`, `security` or `none`; any other value means `none`. Audit entries are written to stdout, which breaks stdio mode (#168). |
| `BCONNECT_RATE_LIMIT_ENABLED` | No | off | `true` limits the requests one client sends. Each tool call still creates a new client, so the limit doesn't apply across calls yet (#160). |
| `BCONNECT_RATE_LIMIT_MAX_REQUESTS` | No | `100` | Requests allowed per window when the rate limit is on. |
| `BCONNECT_RATE_LIMIT_WINDOW_MS` | No | `60000` | Window length in milliseconds. |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | No | off | `true` skips the startup connectivity check. |
| `MCP_TRANSPORT` | No | `stdio` | `http` serves MCP over HTTP instead of stdio. |
| `MCP_PORT` | No | `3000` | Port in HTTP mode. |
| `MCP_BIND` | No | `127.0.0.1` | Address to bind in HTTP mode. HTTP mode has no client authentication; front it with the gateway. |
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
