# bconnect-groups-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Group-scoped endpoint queries — list endpoints by logical, static, dynamic, and universal dynamic groups  
**Tools:** 33

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
# Optional: BCONNECT_CA_CERT_PATH=/path/to/internal-ca.pem
```

```bash
# Run directly (development)
cd bconnect-groups-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-groups": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-groups-mcp/build/index.js"],
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

All 33 tools are read-only GET operations.

| Tool | Description |
|------|-------------|
| `list_endpoints_by_logical_group` | List all endpoints in a logical group |
| `list_android_endpoints_by_logical_group` | List Android endpoints in a logical group |
| `list_ios_endpoints_by_logical_group` | List iOS endpoints in a logical group |
| `list_linux_endpoints_by_logical_group` | List Linux endpoints in a logical group |
| `list_mac_endpoints_by_logical_group` | List macOS endpoints in a logical group |
| `list_network_endpoints_by_logical_group` | List network endpoints in a logical group |
| `list_windows_endpoints_by_logical_group` | List Windows endpoints in a logical group |
| `list_industrial_endpoints_by_logical_group` | List industrial endpoints in a logical group |
| `list_logical_groups_by_logical_group` | List child logical groups of a parent logical group |
| `list_endpoints_by_static_group` | List all endpoints in a static group |
| `list_android_endpoints_by_static_group` | List Android endpoints in a static group |
| `list_ios_endpoints_by_static_group` | List iOS endpoints in a static group |
| `list_linux_endpoints_by_static_group` | List Linux endpoints in a static group |
| `list_mac_endpoints_by_static_group` | List macOS endpoints in a static group |
| `list_network_endpoints_by_static_group` | List network endpoints in a static group |
| `list_windows_endpoints_by_static_group` | List Windows endpoints in a static group |
| `list_industrial_endpoints_by_static_group` | List industrial endpoints in a static group |
| `list_endpoints_by_dynamic_group` | List all endpoints in a dynamic group |
| `list_windows_endpoints_by_dynamic_group` | List Windows endpoints in a dynamic group |
| `list_endpoints_by_universal_dynamic_group` | List all endpoints in a universal dynamic group |
| `list_android_endpoints_by_universal_dynamic_group` | List Android endpoints in a universal dynamic group |
| `list_ios_endpoints_by_universal_dynamic_group` | List iOS endpoints in a universal dynamic group |
| `list_linux_endpoints_by_universal_dynamic_group` | List Linux endpoints in a universal dynamic group |
| `list_mac_endpoints_by_universal_dynamic_group` | List macOS endpoints in a universal dynamic group |
| `list_network_endpoints_by_universal_dynamic_group` | List network endpoints in a universal dynamic group |
| `list_windows_endpoints_by_universal_dynamic_group` | List Windows endpoints in a universal dynamic group |
| `list_industrial_endpoints_by_universal_dynamic_group` | List industrial endpoints in a universal dynamic group |

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
| `ALLOW_SECRET_READ` | No | off | `true` lets the shared client call the BitLocker-secret and LAPS operations. This server has no tool that calls them, so the setting has no effect here. |
| `BCONNECT_RELEASE` | No | `26R1` | bMS release the server talks to, `26R1` or `25R2`. It selects the API documentation used to explain an error, e.g. what a 404 means for that call. |
| `BCONNECT_AUDIT_LEVEL` | No | `none` | `none`, `security`, `write` or `all`, in any case. Levels are cumulative: `security` records credential reads and changes (BitLocker, LAPS), `write` adds every write, `all` records every request. Any other value stops the server. Entries go to stderr. |
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
