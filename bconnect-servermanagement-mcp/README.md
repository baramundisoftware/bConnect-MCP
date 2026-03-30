# bconnect-servermanagement-mcp

MCP server for the baramundi bConnect **Server Management** API. Manage the baramundi Management Server, microservices, security groups, access rights, API keys, and MSW cleanup operations.

## Tools (30 — 17 read, 13 write)

### Server & Infrastructure

| Tool | R/W | Description |
|------|-----|-------------|
| `get_management_server` | R | Get management server info and status |
| `restart_management_server` | W | Schedule a management server restart |
| `cancel_scheduled_restart` | W | Cancel a scheduled restart |
| `get_gateway` | R | Get gateway configuration |
| `get_dip_status` | R | Get DIP (Data Integration Platform) status |
| `get_vpn_appliance` | R | Get VPN appliance configuration |
| `list_cloud_connectors` | R | List cloud connectors |
| `list_pxe_relays` | R | List PXE relay servers |

### Microservices

| Tool | R/W | Description |
|------|-----|-------------|
| `list_microservices` | R | List all microservices |
| `get_microservice` | R | Get a specific microservice by ID |
| `start_microservice` | W | Start a microservice |
| `stop_microservice` | W | Stop a microservice |
| `restart_microservice` | W | Restart a microservice |

### Security Groups & Profiles

| Tool | R/W | Description |
|------|-----|-------------|
| `list_security_groups` | R | List all security groups |
| `get_security_group` | R | Get a security group by ID |
| `create_security_group` | W | Create a new security group |
| `update_security_group` | W | Update a security group |
| `delete_security_group` | W | Delete a security group |
| `list_security_profiles` | R | List all security profiles |
| `get_security_profile` | R | Get a security profile by ID |
| `create_security_profile` | W | Create a new security profile |
| `update_security_profile` | W | Update a security profile |
| `delete_security_profile` | W | Delete a security profile |

### Access Rights & API Keys

| Tool | R/W | Description |
|------|-----|-------------|
| `get_access_rights` | R | Get access rights for an object |
| `update_object_permission` | W | Update permissions on an object |
| `list_api_keys` | R | List all API keys |

### MSW Cleanup

| Tool | R/W | Description |
|------|-----|-------------|
| `simulate_msw_cleanup` | W | Simulate MSW cleanup (dry run) |
| `msw_cleanup` | W | Execute MSW cleanup |
| `list_download_jobs` | R | List download jobs |
| `get_download_job` | R | Get a specific download job |

## Release Compatibility

| bMS Release | Supported |
|-------------|-----------|
| 25R2 | ✅ (core tools) |
| 26R1 | ✅ (all tools, including API keys and MSW cleanup) |

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

# Recommended: audit logging for server management operations
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
    "bconnect-servermanagement": {
      "command": "node",
      "args": ["/path/to/bconnect-servermanagement-mcp/build/index.js"],
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
