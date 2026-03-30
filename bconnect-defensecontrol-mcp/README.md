# bconnect-defensecontrol-mcp

MCP server for the baramundi bConnect **Defense Control** API. Manage BitLocker encryption, local admin accounts, and Microsoft Defender threat data for endpoints in your baramundi Management Suite.

## Tools (13 — 9 read, 4 write)

| Tool | R/W | Description |
|------|-----|-------------|
| `list_bitlocker_windows_endpoints` | R | List Windows endpoints with BitLocker status |
| `get_bitlocker_windows_endpoint` | R | Get BitLocker status for a specific endpoint |
| `get_bitlocker_secrets` | R | Get BitLocker recovery keys (audit logged) |
| `update_bitlocker_pin` | W | Update a BitLocker PIN on an endpoint |
| `get_local_admin_accounts` | R | Get local admin accounts for an endpoint |
| `patch_local_admin_user_credentials` | W | Update local admin credentials |
| `trigger_update_on_client` | W | Trigger a defense control update on a client |
| `list_defender_threats` | R | List all Defender threat detections |
| `get_defender_threat` | R | Get details for a specific threat |
| `list_defender_threats_by_endpoint` | R | List Defender threats for a specific endpoint |
| `list_defender_threats_by_logical_group` | R | List Defender threats for a logical group |
| `list_defender_windows_endpoints` | R | List Windows endpoints with Defender status |
| `get_defender_windows_endpoint` | R | Get Defender status for a specific endpoint |

> **Note:** `get_bitlocker_secrets` access is audit-logged at `info` level regardless of the `BCONNECT_AUDIT_LEVEL` setting.

## Release Compatibility

| bMS Release | Supported |
|-------------|-----------|
| 25R2 | ✅ (core BitLocker + Defender tools) |
| 26R1 | ✅ (all tools) |

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

# Audit logging — recommended verbose for security-sensitive operations
BCONNECT_AUDIT_LEVEL=info
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
    "bconnect-defensecontrol": {
      "command": "node",
      "args": ["/path/to/bconnect-defensecontrol-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms-server.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password",
        "BCONNECT_AUDIT_LEVEL": "info"
      }
    }
  }
}
```

## Testing

```bash
npm test
```
