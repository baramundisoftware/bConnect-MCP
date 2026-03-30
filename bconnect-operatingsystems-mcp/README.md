# bconnect-operatingsystems-mcp

MCP server for the baramundi bConnect **Operating Systems** API. Manage OS deployment folders and Windows endpoint OS profiles in your baramundi Management Suite.

## Tools (9 — 5 read, 4 write)

| Tool | R/W | Description |
|------|-----|-------------|
| `list_os_folders` | R | List all OS deployment folders |
| `get_os_folder` | R | Get a specific OS folder by ID |
| `list_os_folders_by_folder` | R | List subfolders of an OS folder |
| `list_os_windows_endpoints` | R | List Windows endpoints with OS deployment profiles |
| `get_os_windows_endpoint` | R | Get OS deployment profile for a specific Windows endpoint |
| `create_os_folder` | W | Create a new OS deployment folder |
| `update_os_folder` | W | Update an OS deployment folder |
| `delete_os_folder` | W | Delete an OS deployment folder |
| `update_os_windows_endpoint` | W | Update the OS deployment profile for a Windows endpoint |

## Release Compatibility

| bMS Release | Supported |
|-------------|-----------|
| 25R2 | ✅ |
| 26R1 | ✅ |

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
    "bconnect-operatingsystems": {
      "command": "node",
      "args": ["/path/to/bconnect-operatingsystems-mcp/build/index.js"],
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
