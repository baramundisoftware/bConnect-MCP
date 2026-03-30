# bconnect-assets-mcp

MCP server for the baramundi bConnect **Assets** API. Manage asset inventory, asset types, and stock folders in your baramundi Management Suite.

## Tools (26 — 7 read, 19 write)

| Tool | R/W | Description |
|------|-----|-------------|
| `list_assets` | R | List all assets |
| `get_asset` | R | Get a specific asset by ID |
| `create_asset` | W | Create a new asset |
| `update_asset` | W | Update an existing asset |
| `delete_asset` | W | Delete an asset |
| `list_assets_in_asset_stock` | R | List assets in a stock folder |
| `list_assets_by_logical_group` | R | List assets assigned to a logical group |
| `list_assets_by_windows_endpoint` | R | List assets assigned to a Windows endpoint |
| `list_assets_by_org_unit` | R | List assets filtered by OU |
| `list_assets_by_ad_object` | R | List assets linked to an AD object |
| `list_asset_stock_folders` | R | List asset stock folders |
| `get_asset_stock_folder` | R | Get a stock folder by ID |
| `create_asset_stock_folder` | W | Create a new stock folder |
| `update_asset_stock_folder` | W | Update a stock folder |
| `delete_asset_stock_folder` | W | Delete a stock folder |
| `list_asset_stock_subfolders` | R | List subfolders of a stock folder |
| `list_asset_type_folders` | R | List asset type folders |
| `get_asset_type_folder` | R | Get an asset type folder by ID |
| `create_asset_type_folder` | W | Create an asset type folder |
| `update_asset_type_folder` | W | Update an asset type folder |
| `delete_asset_type_folder` | W | Delete an asset type folder |
| `list_asset_type_subfolders` | R | List subfolders of an asset type folder |
| `list_asset_types` | R | List all asset types |
| `get_asset_type` | R | Get a specific asset type by ID |
| `create_asset_type` | W | Create a new asset type |
| `delete_asset_type` | W | Delete an asset type |

## Release Compatibility

| bMS Release | Supported |
|-------------|-----------|
| 25R2 | ✅ (core tools) |
| 26R1 | ✅ (all tools) |

> Some asset type management tools require 26R1. Set `BCONNECT_RELEASE=25R2` to restrict to 25R2-compatible tools.

## Configuration

```env
BCONNECT_BASE_URL=https://your-bms-server.example.com/bconnect
BCONNECT_USERNAME=your-username
BCONNECT_PASSWORD=your-password

# Optional: CA certificate for TLS verification
BCONNECT_CA_CERT_PATH=/path/to/ca.pem

# Optional: bMS release version (25R2 or 26R1, default: 26R1)
BCONNECT_RELEASE=26R1

# Optional: rate limiting
BCONNECT_RATE_LIMIT_ENABLED=false
BCONNECT_RATE_LIMIT_MAX_REQUESTS=100
BCONNECT_RATE_LIMIT_WINDOW_MS=60000

# Optional: audit logging (none | info | verbose)
BCONNECT_AUDIT_LEVEL=none
```

## Quick Start

```bash
npm install
npm run build
node build/index.js
```

## Claude Desktop Integration

```json
{
  "mcpServers": {
    "bconnect-assets": {
      "command": "node",
      "args": ["/path/to/bconnect-assets-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms-server.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password"
      }
    }
  }
}
```

## Testing

```bash
npm test
```
