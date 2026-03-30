# bconnect-endpoints-mcp

MCP server for the baramundi bConnect **Endpoints** API. Full lifecycle management of Windows, Linux, macOS, Android, iOS, industrial, and network endpoints — including logical groups and maintenance windows.

## Tools (47 — 14 read, 33 write)

### General Endpoints

| Tool | R/W | Description |
|------|-----|-------------|
| `list_endpoints` | R | List all endpoints |
| `get_endpoint` | R | Get a specific endpoint by ID |
| `search_endpoints` | R | Search endpoints by criteria |
| `delete_endpoint` | W | Delete any endpoint by ID |

### Windows Endpoints

| Tool | R/W | Description |
|------|-----|-------------|
| `list_windows_endpoints` | R | List all Windows endpoints |
| `get_windows_endpoint` | R | Get a Windows endpoint by ID |
| `create_windows_endpoint` | W | Create a new Windows endpoint |
| `update_windows_endpoint` | W | Update a Windows endpoint |
| `delete_windows_endpoint` | W | Delete a Windows endpoint |
| `start_windows_enrollment` | W | Start Windows endpoint enrollment |
| `trigger_intune_installation` | W | Trigger Intune installation on an endpoint |

### Linux Endpoints

| Tool | R/W | Description |
|------|-----|-------------|
| `list_linux_endpoints` | R | List all Linux endpoints |
| `get_linux_endpoint` | R | Get a Linux endpoint by ID |
| `create_linux_endpoint` | W | Create a new Linux endpoint |
| `update_linux_endpoint` | W | Update a Linux endpoint |
| `delete_linux_endpoint` | W | Delete a Linux endpoint |

### macOS Endpoints

| Tool | R/W | Description |
|------|-----|-------------|
| `list_mac_endpoints` | R | List all macOS endpoints |
| `get_mac_endpoint` | R | Get a macOS endpoint by ID |
| `create_mac_endpoint` | W | Create a new macOS endpoint |
| `update_mac_endpoint` | W | Update a macOS endpoint |
| `delete_mac_endpoint` | W | Delete a macOS endpoint |
| `start_mac_enrollment` | W | Start macOS enrollment |

### Android / iOS Endpoints

| Tool | R/W | Description |
|------|-----|-------------|
| `start_android_enrollment` | W | Start Android enrollment |
| `create_android_endpoint` | W | Create an Android endpoint |
| `update_android_endpoint` | W | Update an Android endpoint |
| `delete_android_endpoint` | W | Delete an Android endpoint |
| `start_ios_enrollment` | W | Start iOS enrollment |

### Industrial & Network Endpoints

| Tool | R/W | Description |
|------|-----|-------------|
| `create_industrial_endpoint` | W | Create an industrial endpoint |
| `update_industrial_endpoint` | W | Update an industrial endpoint |
| `delete_industrial_endpoint` | W | Delete an industrial endpoint |
| `create_network_endpoint` | W | Create a network endpoint |
| `update_network_endpoint` | W | Update a network endpoint |
| `delete_network_endpoint` | W | Delete a network endpoint |

### Logical Groups

| Tool | R/W | Description |
|------|-----|-------------|
| `list_logical_groups` | R | List all logical groups |
| `get_logical_group` | R | Get a logical group by ID |
| `list_group_endpoints` | R | List endpoints in a logical group |
| `list_endpoints_by_logical_group` | R | List all endpoints in a group |
| `list_windows_endpoints_by_logical_group` | R | List Windows endpoints in a group |
| `create_logical_group` | W | Create a new logical group |
| `update_logical_group` | W | Update a logical group |
| `delete_logical_group` | W | Delete a logical group |

### Maintenance Windows

| Tool | R/W | Description |
|------|-----|-------------|
| `create_maintenance_window_for_endpoint` | W | Create a maintenance window for an endpoint |
| `update_maintenance_window_for_endpoint` | W | Update a maintenance window for an endpoint |
| `delete_maintenance_window_for_endpoint` | W | Delete a maintenance window from an endpoint |
| `create_maintenance_window_for_logical_group` | W | Create a maintenance window for a logical group |
| `update_maintenance_window_for_logical_group` | W | Update a maintenance window for a logical group |
| `delete_maintenance_window_for_logical_group` | W | Delete a maintenance window from a logical group |

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
    "bconnect-endpoints": {
      "command": "node",
      "args": ["/path/to/bconnect-endpoints-mcp/build/index.js"],
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
