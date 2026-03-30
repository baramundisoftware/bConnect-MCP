# bconnect-jobs-mcp

MCP server for the baramundi bConnect **Jobs** API. Manage job definitions, job instances, folder organization, group assignments, and kiosk releases in your baramundi Management Suite.

## Tools (24 — 8 read, 16 write)

### Job Definitions

| Tool | R/W | Description |
|------|-----|-------------|
| `list_job_definitions` | R | List all job definitions |
| `get_job_definition` | R | Get a specific job definition by ID |
| `list_job_definitions_by_folder` | R | List job definitions in a folder |

### Job Instances

| Tool | R/W | Description |
|------|-----|-------------|
| `list_job_instances` | R | List all job instances |
| `get_job_instance` | R | Get a specific job instance by ID |
| `list_endpoint_job_instances` | R | List job instances for a specific endpoint |
| `list_job_instances_by_definition` | R | List instances for a job definition |
| `list_job_instances_by_logical_group` | R | List job instances for a logical group |
| `create_job_instance` | W | Create a new job instance |
| `start_job_instance` | W | Start a job instance |
| `stop_job_instance` | W | Stop a running job instance |
| `resume_job_instance` | W | Resume a paused job instance |
| `delete_job_instance` | W | Delete a job instance |

### Job Folders

| Tool | R/W | Description |
|------|-----|-------------|
| `create_job_folder` | W | Create a job definition folder |
| `update_job_folder` | W | Rename or move a job folder |
| `delete_job_folder` | W | Delete a job folder |

### Job Assignments

| Tool | R/W | Description |
|------|-----|-------------|
| `assign_job_to_logical_group` | W | Assign a job to a logical group |
| `assign_job_to_static_group` | W | Assign a job to a static group |
| `assign_job_to_dynamic_group` | W | Assign a job to a dynamic group |
| `assign_job_to_universal_dynamic_group` | W | Assign a job to a universal dynamic group |

### Kiosk Releases

| Tool | R/W | Description |
|------|-----|-------------|
| `list_kiosk_releases` | R | List all kiosk releases |
| `get_kiosk_release` | R | Get a specific kiosk release |
| `create_kiosk_release` | W | Create a new kiosk release |
| `withdraw_kiosk_release` | W | Withdraw a kiosk release |

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
    "bconnect-jobs": {
      "command": "node",
      "args": ["/path/to/bconnect-jobs-mcp/build/index.js"],
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
