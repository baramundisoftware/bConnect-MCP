# bconnect-defensecontrol-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Defense Control — BitLocker encryption, Local Admin (LAPS) credentials, and Microsoft Defender threat monitoring  
**Tools:** 9 (13 in 26R1 mode)

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
cd bconnect-defensecontrol-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-defensecontrol": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-defensecontrol-mcp/build/index.js"],
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
| `list_bitlocker_windows_endpoints` | List all Windows endpoints with BitLocker status |
| `get_bitlocker_windows_endpoint` | Get BitLocker status for a specific endpoint |
| `get_bitlocker_secrets` | **(26R1)** Get BitLocker recovery keys and startup PIN |
| `update_bitlocker_pin` | **(26R1)** Update the BitLocker startup PIN for an endpoint |
| `get_local_admin_accounts` | Get LAPS-managed local admin credentials for an endpoint |
| `patch_local_admin_user_credentials` | Update local admin credentials via JSON Patch |
| `trigger_update_on_client` | Force a baramundi client to refresh managed data |
| `list_defender_threats` | List all Defender threat detections across endpoints |
| `get_defender_threat` | Get details of a specific Defender threat by GUID |
| `list_defender_threats_by_endpoint` | List Defender threats for a specific endpoint |
| `list_defender_threats_by_logical_group` | List Defender threats for a logical group's endpoints |
| `list_defender_windows_endpoints` | List all endpoints with Defender status |
| `get_defender_windows_endpoint` | Get Defender status for a specific endpoint |

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
| `26.1.7` | baramundi Management Suite 2026R1 | V2.0 | Current — full tool set |
| `25.2.0` *(planned)* | baramundi Management Suite 2025R2 | V2.0 | Subset of tools (25R2 spec) |
| `1.0.0` (legacy) | ≤25R2 (unspecified) | V2.0 | Pre-versioning-scheme release |

> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
> Example: `26.1.7` targets bMS 2026R1; patch-only fixes increment the last digit.
