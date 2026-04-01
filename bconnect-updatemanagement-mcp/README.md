# bconnect-updatemanagement-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Windows Update management — Microsoft Update profile assignment and status for managed Windows endpoints  
**Tools:** 3

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:444/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
BCONNECT_REJECT_UNAUTHORIZED=true
# Optional: AUDIT_LOG_LEVEL=write   (all / write / security / none)
```

```bash
# Run directly (development)
cd bconnect-updatemanagement-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-updatemanagement": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-updatemanagement-mcp/build/index.js"],
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
| `list_update_management_endpoints` | List all Windows endpoints with update management status |
| `get_update_management_endpoint` | Get update management status for a specific endpoint |
| `update_update_management_endpoint` | Assign or remove an update profile from an endpoint |

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
