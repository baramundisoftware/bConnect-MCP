# bconnect-compliance-mcp

MCP server for the baramundi bConnect **Compliance** API. Read compliance rule violations, CVE vulnerabilities, and mobile device rule data from your baramundi Management Suite.

> **Requires bConnect 26R1 or later.** This server does not work with 25R2 deployments.

## Tools (8 — all read)

| Tool | R/W | Description |
|------|-----|-------------|
| `list_detected_rule_violations` | R | List all detected compliance rule violations |
| `list_detected_rule_violations_for_endpoint` | R | List rule violations for a specific endpoint |
| `list_detected_vulnerabilities` | R | List all detected CVE vulnerabilities |
| `list_detected_vulnerabilities_for_endpoint` | R | List CVE vulnerabilities for a specific endpoint |
| `list_mobile_device_rules` | R | List all mobile device compliance rules |
| `get_mobile_device_rule` | R | Get a specific mobile device rule by ID |
| `list_vulnerabilities` | R | List all known CVE vulnerabilities in the database |
| `get_vulnerability` | R | Get details for a specific CVE vulnerability |

## Release Compatibility

| bMS Release | Supported |
|-------------|-----------|
| 25R2 | ❌ (compliance API not available) |
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
    "bconnect-compliance": {
      "command": "node",
      "args": ["/path/to/bconnect-compliance-mcp/build/index.js"],
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
