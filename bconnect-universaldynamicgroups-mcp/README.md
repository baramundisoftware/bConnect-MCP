# bconnect-universaldynamicgroups-mcp

MCP server for the baramundi bConnect **Universal Dynamic Groups** API. Query UDG definitions and folder structure in your baramundi Management Suite.

> **Requires bConnect 26R1 or later.** Universal Dynamic Groups are a 26R1-only feature.

## Tools (6 — all read)

| Tool | R/W | Description |
|------|-----|-------------|
| `list_universal_dynamic_groups` | R | List all universal dynamic groups |
| `get_universal_dynamic_group` | R | Get a specific UDG by ID |
| `list_universal_dynamic_groups_by_folder` | R | List UDGs in a specific folder |
| `list_udg_folders` | R | List all UDG folders |
| `get_udg_folder` | R | Get a UDG folder by ID |
| `list_udg_folders_by_folder` | R | List subfolders of a UDG folder |

## Release Compatibility

| bMS Release | Supported |
|-------------|-----------|
| 25R2 | ❌ (Universal Dynamic Groups not available) |
| 26R1 | ✅ |

## Configuration

```env
BCONNECT_BASE_URL=https://your-bms-server.example.com/bconnect
BCONNECT_USERNAME=your-username
BCONNECT_PASSWORD=your-password

# Optional: CA certificate for TLS verification
BCONNECT_CA_CERT_PATH=/path/to/ca.pem

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
    "bconnect-universaldynamicgroups": {
      "command": "node",
      "args": ["/path/to/bconnect-universaldynamicgroups-mcp/build/index.js"],
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
