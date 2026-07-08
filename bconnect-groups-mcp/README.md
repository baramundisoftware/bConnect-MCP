# bconnect-groups-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Group-scoped endpoint queries — list endpoints by logical, static, dynamic, and universal dynamic groups  
**Tools:** 27

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
BCONNECT_REJECT_UNAUTHORIZED=true
# Optional: AUDIT_LOG_LEVEL=write   (all / write / security / none)
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

All 27 tools are read-only GET operations.

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
