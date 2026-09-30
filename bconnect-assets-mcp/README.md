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
BCONNECT_REJECT_UNAUTHORIZED=true
# Optional: BCONNECT_RELEASE=26R1   (enables additional tools for baramundi 2026 R1)
# Optional: AUDIT_LOG_LEVEL=write   (all / write / security / none)
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
