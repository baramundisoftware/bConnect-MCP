# bconnect-compliance-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Compliance rules, CVE vulnerabilities, and mobile device rule violations (requires baramundi 2026 R1)  
**Tools:** 8

> **Note:** This server requires baramundi Management Suite 2026 R1 or later. The compliance API does not exist in 25R2.

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
cd bconnect-compliance-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-compliance": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-compliance-mcp/build/index.js"],
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
| `list_detected_rule_violations` | List all compliance rule violations across endpoints |
| `list_detected_rule_violations_for_endpoint` | List compliance violations for a specific endpoint |
| `list_detected_vulnerabilities` | List all detected CVE vulnerabilities across endpoints |
| `list_detected_vulnerabilities_for_endpoint` | List CVE vulnerabilities for a specific endpoint |
| `list_mobile_device_rules` | List all mobile device compliance rules |
| `get_mobile_device_rule` | Get details of a specific mobile device rule |
| `list_vulnerabilities` | List all CVEs in the baramundi vulnerability library |
| `get_vulnerability` | Get details of a specific CVE by GUID |

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
| `26.1.7` | baramundi Management Suite 2026R1 | V2.0 | **26R1 only** — compliance API does not exist in 25R2 |
| `1.0.0` (legacy) | ≤25R2 (unspecified) | V2.0 | Pre-versioning-scheme release (no compliance tools) |

> This server needs baramundi Management Suite 2026 R1: the compliance API doesn't exist in 25R2. It always offers all its tools, whatever release the other servers are set to.
> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
