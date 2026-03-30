# bconnect-updatemanagement-mcp

MCP server for the baramundi bConnect **Update Management** API. Query and configure Windows update management settings for endpoints in your baramundi Management Suite.

## Tools (3 — 2 read, 1 write)

| Tool | R/W | Description |
|------|-----|-------------|
| `list_update_management_endpoints` | R | List all endpoints with update management configuration |
| `get_update_management_endpoint` | R | Get update management settings for a specific endpoint |
| `update_update_management_endpoint` | W | Update the update management configuration for an endpoint |

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
    "bconnect-updatemanagement": {
      "command": "node",
      "args": ["/path/to/bconnect-updatemanagement-mcp/build/index.js"],
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
