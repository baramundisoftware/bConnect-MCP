# bconnect-variables-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** bConnect variables and custom properties — variable definitions and instance values across endpoints, groups, AD objects, and jobs  
**Tools:** 12

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
cd bconnect-variables-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-variables": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-variables-mcp/build/index.js"],
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
| `list_variable_definitions` | List all variable definitions in baramundi |
| `get_variable_definition` | Get details of a specific variable definition by GUID |
| `create_variable_definition` | Create a new variable definition |
| `update_variable_definition` | Update a variable definition via JSON Patch |
| `delete_variable_definition` | Delete a variable definition by GUID |
| `list_variable_instances` | List all variable instances across all objects |
| `get_variable_instance` | Get details of a specific variable instance by GUID |
| `list_variable_instances_by_endpoint` | List variable instances assigned to a specific endpoint |
| `list_variable_instances_by_logical_group` | List variable instances assigned to a logical group |
| `list_variable_instances_by_ad_object` | List variable instances assigned to an AD object |
| `list_variable_instances_by_job_definition` | List variable instances assigned to a job definition |
| `list_variable_instances_by_application` | List variable instances assigned to a Windows application |
| `update_variable_instance` | Update the value of a variable instance via JSON Patch |

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
