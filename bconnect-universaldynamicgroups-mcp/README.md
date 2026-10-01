# bconnect-universaldynamicgroups-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Universal Dynamic Groups — UDG definitions and folder hierarchy (requires baramundi 2026 R1)  
**Tools:** 6 (all require 26R1)

> **Note:** This server is only functional when `BCONNECT_RELEASE=26R1` (the default). Universal Dynamic Groups do not exist in baramundi 25R2; with `BCONNECT_RELEASE=25R2`, no tools are exposed.

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
BCONNECT_RELEASE=26R1
# Optional: BCONNECT_CA_CERT_PATH=/path/to/internal-ca.pem
```

```bash
# Run directly (development)
cd bconnect-universaldynamicgroups-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-universaldynamicgroups": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-universaldynamicgroups-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms-server:443/bconnect",
        "BCONNECT_USERNAME": "mcp-reader",
        "BCONNECT_PASSWORD": "<password>",
        "BCONNECT_RELEASE": "26R1"
      }
    }
  }
}
```

---

## Available Tools

All tools require `BCONNECT_RELEASE=26R1`.

| Tool | Description |
|------|-------------|
| `list_universal_dynamic_groups` | **(26R1)** List all Universal Dynamic Groups in baramundi |
| `get_universal_dynamic_group` | **(26R1)** Get details of a specific UDG by GUID |
| `list_universal_dynamic_groups_by_folder` | **(26R1)** List UDGs within a specific folder |
| `list_udg_folders` | **(26R1)** List all UDG folders in baramundi |
| `get_udg_folder` | **(26R1)** Get details of a specific UDG folder |
| `list_udg_folders_by_folder` | **(26R1)** List sub-folders within a UDG folder |

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
| `BCONNECT_RELEASE` | No | `26R1` | Any value other than `26R1` (e.g. `25R2`, but also an empty value) hides the tools that need baramundi Management Suite 2026 R1. |
| `ALLOW_SECRET_READ` | No | off | `true` lets the shared client call the BitLocker-secret and LAPS operations. This server has no tool that calls them, so the setting has no effect here. |
| `BCONNECT_AUDIT_LEVEL` | No | `none` | `all`, `write`, `security` or `none`; any other value means `none`. Request entries, and the response entries of successful calls, are written to stdout (warnings and errors to stderr), which breaks stdio mode (#168). |
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
| `26.1.7` | baramundi Management Suite 2026R1 | V2.0 | **26R1 only** — UDGs do not exist in 25R2 |
| `1.0.0` (legacy) | ≤25R2 (unspecified) | V2.0 | Pre-versioning-scheme release (no UDG tools) |

> This server requires `BCONNECT_RELEASE=26R1`. It exposes 0 tools when targeting 25R2.
> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
