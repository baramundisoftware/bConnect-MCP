# bconnect-software-mcp

MCP server for the baramundi bConnect **Software** API. Query installed software inventory and manage software bundle definitions in your baramundi Management Suite.

## Tools (19 — 6 read, 13 write)

### Installed Software Inventory

| Tool | R/W | Description |
|------|-----|-------------|
| `list_installed_windows_software` | R | List all installed software across Windows endpoints |
| `list_installed_software_by_endpoint` | R | List installed software on a specific endpoint |
| `list_installed_software_by_logical_group` | R | List installed software for a logical group |
| `list_installed_software_by_dynamic_group` | R | List installed software for a dynamic group |

### Software Bundles

| Tool | R/W | Description |
|------|-----|-------------|
| `list_software_bundles` | R | List all software bundles |
| `get_software_bundle` | R | Get a specific software bundle by ID |
| `create_software_bundle` | W | Create a new software bundle |
| `delete_software_bundle` | W | Delete a software bundle |

### Bundle Applications

| Tool | R/W | Description |
|------|-----|-------------|
| `list_bundle_applications` | R | List all bundle applications |
| `list_bundle_applications_by_bundle` | R | List applications in a specific bundle |
| `add_application_to_bundle` | W | Add an application to a bundle |
| `delete_bundle_application` | W | Remove an application from a bundle |
| `replace_application_in_bundle` | W | Replace an application in a bundle |

### Bundle Folders

| Tool | R/W | Description |
|------|-----|-------------|
| `list_bundle_folders` | R | List all bundle folders |
| `get_bundle_folder` | R | Get a bundle folder by ID |
| `list_bundle_folders_by_folder` | R | List subfolders of a bundle folder |
| `create_bundle_folder` | W | Create a new bundle folder |
| `update_bundle_folder` | W | Update a bundle folder |
| `delete_bundle_folder` | W | Delete a bundle folder |

## Release Compatibility

| bMS Release | Supported |
|-------------|-----------|
| 25R2 | ✅ (installed software inventory tools) |
| 26R1 | ✅ (all tools, including bundle management) |

> Bundle management tools (create/delete bundles, manage applications) require 26R1. Set `BCONNECT_RELEASE=25R2` to restrict to inventory-only tools.

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
    "bconnect-software": {
      "command": "node",
      "args": ["/path/to/bconnect-software-mcp/build/index.js"],
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
