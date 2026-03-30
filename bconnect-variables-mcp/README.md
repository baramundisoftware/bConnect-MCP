# bconnect-variables-mcp

MCP server for the baramundi bConnect **Variables** API. Manage variable definitions and their instances across endpoints, logical groups, AD objects, job definitions, and applications.

## Tools (13 — 7 read, 6 write)

### Variable Definitions

| Tool | R/W | Description |
|------|-----|-------------|
| `list_variable_definitions` | R | List all variable definitions |
| `get_variable_definition` | R | Get a specific variable definition by ID |
| `create_variable_definition` | W | Create a new variable definition |
| `update_variable_definition` | W | Update a variable definition |
| `delete_variable_definition` | W | Delete a variable definition |

### Variable Instances

| Tool | R/W | Description |
|------|-----|-------------|
| `list_variable_instances` | R | List all variable instances |
| `get_variable_instance` | R | Get a specific variable instance by ID |
| `list_variable_instances_by_endpoint` | R | List variable instances for a specific endpoint |
| `list_variable_instances_by_logical_group` | R | List variable instances for a logical group |
| `list_variable_instances_by_ad_object` | R | List variable instances for an AD object |
| `list_variable_instances_by_job_definition` | R | List variable instances for a job definition |
| `list_variable_instances_by_application` | R | List variable instances for an application |
| `update_variable_instance` | W | Update a variable instance value |

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
    "bconnect-variables": {
      "command": "node",
      "args": ["/path/to/bconnect-variables-mcp/build/index.js"],
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
