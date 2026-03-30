# bconnect-activedirectory-mcp

MCP server for the baramundi bConnect **Active Directory** API. Provides read-only access to AD groups, users, objects, and organizational units synced to your baramundi Management Suite.

## Tools (16 — all read)

| Tool | R/W | Description |
|------|-----|-------------|
| `list_ad_groups` | R | List all AD groups |
| `get_ad_group` | R | Get a specific AD group by ID |
| `list_ad_subgroups` | R | List subgroups of a group |
| `list_ad_groups_by_org_unit` | R | List AD groups filtered by OU |
| `list_ad_objects` | R | List all AD objects |
| `get_ad_object` | R | Get a specific AD object by ID |
| `list_ad_object_memberships` | R | List group memberships of an AD object |
| `list_ad_objects_by_group` | R | List AD objects in a group |
| `list_ad_objects_by_org_unit` | R | List AD objects in an OU |
| `list_ad_users` | R | List all AD users |
| `get_ad_user` | R | Get a specific AD user by ID |
| `list_ad_users_by_group` | R | List AD users in a group |
| `list_ad_users_by_org_unit` | R | List AD users in an OU |
| `list_org_units` | R | List all organizational units |
| `get_org_unit` | R | Get a specific OU by ID |
| `list_org_units_by_org_unit` | R | List OUs nested under a parent OU |

## Release Compatibility

| bMS Release | Supported |
|-------------|-----------|
| 25R2 | ✅ |
| 26R1 | ✅ |

## Configuration

Create a `.env` file in this directory (or set environment variables):

```env
BCONNECT_BASE_URL=https://your-bms-server.example.com/bconnect
BCONNECT_USERNAME=your-username
BCONNECT_PASSWORD=your-password

# Optional: CA certificate for TLS verification (preferred over disabling TLS)
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

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bconnect-activedirectory": {
      "command": "node",
      "args": ["/path/to/bconnect-activedirectory-mcp/build/index.js"],
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
