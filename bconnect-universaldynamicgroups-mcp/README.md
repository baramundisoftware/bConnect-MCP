# bconnect-universaldynamicgroups-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Universal Dynamic Groups — UDG definitions and folder hierarchy (requires baramundi 2026 R1)  
**Tools:** 6 (all require 26R1)

> **Note:** This server is only functional when `BCONNECT_RELEASE=26R1`. Universal Dynamic Groups do not exist in baramundi 25R2. With the default release setting, no tools are exposed.

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:444/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
BCONNECT_REJECT_UNAUTHORIZED=true
BCONNECT_RELEASE=26R1
# Optional: AUDIT_LOG_LEVEL=write   (all / write / security / none)
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
        "BCONNECT_BASE_URL": "https://bms-server:444/bconnect",
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
