# bconnect-software-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Software inventory and deployment — installed Windows software inventory and software bundle management  
**Tools:** 4 (19 in 26R1 mode)

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:444/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
BCONNECT_REJECT_UNAUTHORIZED=true
# Optional: BCONNECT_RELEASE=26R1   (enables additional tools for baramundi 2026 R1)
# Optional: AUDIT_LOG_LEVEL=write   (all / write / security / none)
```

```bash
# Run directly (development)
cd bconnect-software-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-software": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-software-mcp/build/index.js"],
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
| `list_installed_windows_software` | List all installed Windows software across all endpoints |
| `list_installed_software_by_endpoint` | List installed software on a specific endpoint |
| `list_installed_software_by_logical_group` | List installed software for a logical group's endpoints |
| `list_installed_software_by_dynamic_group` | List installed software for a Universal Dynamic Group |
| `list_software_bundles` | **(26R1)** List all software bundles in baramundi |
| `get_software_bundle` | **(26R1)** Get details of a specific software bundle |
| `create_software_bundle` | **(26R1)** Create a new software bundle |
| `delete_software_bundle` | **(26R1)** Delete a software bundle by GUID |
| `list_bundle_applications` | **(26R1)** List all bundle applications |
| `list_bundle_applications_by_bundle` | **(26R1)** List applications within a specific bundle |
| `add_application_to_bundle` | **(26R1)** Add an application to a bundle |
| `delete_bundle_application` | **(26R1)** Remove an application from a bundle |
| `replace_application_in_bundle` | **(26R1)** Replace an application in a bundle |
| `list_bundle_folders` | **(26R1)** List all bundle folders |
| `get_bundle_folder` | **(26R1)** Get details of a specific bundle folder |
| `list_bundle_folders_by_folder` | **(26R1)** List sub-folders within a bundle folder |
| `create_bundle_folder` | **(26R1)** Create a new bundle folder |
| `delete_bundle_folder` | **(26R1)** Delete a bundle folder by GUID |
| `update_bundle_folder` | **(26R1)** Update a bundle folder via JSON Patch |

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
| `26.1.0` | baramundi Management Suite 2026R1 | V2.0 | Current — full tool set |
| `25.2.0` *(planned)* | baramundi Management Suite 2025R2 | V2.0 | Subset of tools (25R2 spec) |
| `1.0.0` (legacy) | ≤25R2 (unspecified) | V2.0 | Pre-versioning-scheme release |

> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
> Example: `26.1.0` targets bMS 2026R1; patch-only fixes increment the last digit.
