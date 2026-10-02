# bconnect-assets-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Asset inventory — assets, asset types, and asset stock/type folders  
**Tools:** 22 (26 in 26R1 mode)

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
cd bconnect-assets-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-assets": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-assets-mcp/build/index.js"],
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
| `list_assets` | List all assets in baramundi |
| `create_asset` | Create a new asset |
| `get_asset` | Get details of a specific asset by GUID |
| `update_asset` | Update asset fields via JSON Patch |
| `delete_asset` | Permanently delete an asset by GUID |
| `list_assets_in_asset_stock` | List assets in the asset stock container |
| `list_assets_by_logical_group` | List assets assigned to a logical group's endpoints |
| `list_assets_by_windows_endpoint` | List assets assigned to a specific Windows endpoint |
| `list_asset_stock_folders` | List all asset stock folders |
| `create_asset_stock_folder` | Create a new asset stock folder |
| `get_asset_stock_folder` | Get details of a specific asset stock folder |
| `update_asset_stock_folder` | Update an asset stock folder via JSON Patch |
| `delete_asset_stock_folder` | Permanently delete an asset stock folder |
| `list_asset_stock_subfolders` | List child folders within an asset stock folder |
| `list_asset_type_folders` | List all asset type folders |
| `create_asset_type_folder` | Create a new asset type folder |
| `get_asset_type_folder` | Get details of a specific asset type folder |
| `update_asset_type_folder` | Update an asset type folder via JSON Patch |
| `delete_asset_type_folder` | Permanently delete an asset type folder |
| `list_asset_type_subfolders` | List child folders within an asset type folder |
| `list_asset_types` | List all asset types defined in baramundi |
| `create_asset_type` | Create a new asset type |
| `get_asset_type` | Get details of a specific asset type by GUID |
| `delete_asset_type` | Permanently delete an asset type by GUID |
| `list_assets_by_org_unit` | **(26R1)** List assets for endpoints within an OU |
| `list_assets_by_ad_object` | **(26R1)** List assets assigned to an AD object |

> Tools marked **(26R1)** require `BCONNECT_RELEASE=26R1` and baramundi Management Suite 2026 R1 or later.

---

## Environment Variables

Run inside the HTTP gateway, the server's own startup code doesn't run: `MCP_TRANSPORT`, `MCP_PORT`, `MCP_BIND` and `BCONNECT_SKIP_CONNECTIVITY_CHECK` then have no effect, and the gateway's own settings apply. The gateway reads `MCP_ALLOW_NO_AUTH` itself, for its own bind address.

<!-- env:start -->
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect base URL, e.g. `https://bms.corp.local:443/bconnect`. If unset, a placeholder is used and the startup check fails. |
| `BCONNECT_API_KEY` | One of | — | API key. Set this, or `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. Used instead of them when both are set. |
| `BCONNECT_USERNAME` | One of | — | User for Basic authentication, together with `BCONNECT_PASSWORD`. |
| `BCONNECT_PASSWORD` | One of | — | Password for `BCONNECT_USERNAME`. |
| `BCONNECT_CA_CERT_PATH` | No | — | PEM file with the CA certificate that signed the bMS server certificate (internal CA). When set, only this CA is trusted; when unset, Node's default and (Node 22.15 or later) the operating system's trusted CAs are used. The server fails if the file can't be read or is empty. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | verify | `0` turns certificate verification off for every TLS connection of the process. Development only; use `BCONNECT_CA_CERT_PATH` instead. |
| `BCONNECT_ALLOW_INSECURE_HTTP` | No | off | `true` allows an `http://` base URL to a host other than this machine, which sends the bConnect credentials unencrypted; the server warns once at startup. Test setups only. `http://` to `localhost`, `127.x.x.x` or `[::1]` (the bundled mock) needs no opt-in. |
| `BCONNECT_RELEASE` | No | `26R1` | Any value other than `26R1` (e.g. `25R2`, but also an empty value) hides the tools that need baramundi Management Suite 2026 R1. It also selects the API documentation used to explain an error. |
| `ALLOW_WRITE_OPERATIONS` | No | off | `true` enables the tools that create, change or delete data, or start actions. |
| `ALLOW_SECRET_READ` | No | off | `true` lets the shared client call the BitLocker-secret and LAPS operations. This server has no tool that calls them, so the setting has no effect here. |
| `BCONNECT_AUDIT_LEVEL` | No | `none` | `none`, `security`, `write` or `all`, in any case. Levels are cumulative: `security` records credential reads and changes (BitLocker, LAPS), `write` adds every write, `all` records every request. Any other value stops the server. Entries go to stderr. |
| `BCONNECT_RATE_LIMIT_ENABLED` | No | off | `true` limits the requests one client sends. Each tool call still creates a new client, so the limit doesn't apply across calls yet (#160). |
| `BCONNECT_RATE_LIMIT_MAX_REQUESTS` | No | `100` | Requests allowed per window when the rate limit is on. |
| `BCONNECT_RATE_LIMIT_WINDOW_MS` | No | `60000` | Window length in milliseconds. |
| `BCONNECT_TIMEOUT_MS` | No | `30000` | How long to wait for bConnect's answer, in milliseconds, 1000 to 600000. A request that runs out says so ("didn't answer within …"). Any other value stops the server. |
| `BCONNECT_MAX_RETRIES` | No | `0` | Retries for read requests (GET) after a network error, a timeout or HTTP 502/503/504, 0 to 5. Write requests are never retried. Any other value stops the server. |
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
