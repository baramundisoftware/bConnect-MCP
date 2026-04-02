# bconnect-compliance-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Compliance rules, CVE vulnerabilities, and mobile device rule violations (requires baramundi 2026 R1)  
**Tools:** 7

> **Note:** This server requires baramundi Management Suite 2026 R1 or later. The compliance API does not exist in 25R2.

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:444/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
BCONNECT_REJECT_UNAUTHORIZED=true
# Optional: AUDIT_LOG_LEVEL=write   (all / write / security / none)
```

```bash
# Run directly (development)
cd bconnect-compliance-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-compliance": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-compliance-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms-server:444/bconnect",
        "BCONNECT_USERNAME": "mcp-reader",
        "BCONNECT_PASSWORD": "<password>"
      }
    }
  }
}
```

---

## Available Tools

| Tool | Description |
|------|-------------|
| `list_detected_rule_violations` | List all compliance rule violations across endpoints |
| `list_detected_rule_violations_for_endpoint` | List compliance violations for a specific endpoint |
| `list_detected_vulnerabilities` | List all detected CVE vulnerabilities across endpoints |
| `list_detected_vulnerabilities_for_endpoint` | List CVE vulnerabilities for a specific endpoint |
| `list_mobile_device_rules` | List all mobile device compliance rules |
| `get_mobile_device_rule` | Get details of a specific mobile device rule |
| `list_vulnerabilities` | List all CVEs in the baramundi vulnerability library |
| `get_vulnerability` | Get details of a specific CVE by GUID |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect REST API base URL |
| `BCONNECT_USERNAME` | Yes | — | API username |
| `BCONNECT_PASSWORD` | Yes | — | API password |
| `BCONNECT_REJECT_UNAUTHORIZED` | No | `true` | Set `false` to allow self-signed TLS |
| `BCONNECT_RELEASE` | No | `25R2` | Set `26R1` to enable additional tools |
| `AUDIT_LOG_LEVEL` | No | `write` | `all` / `write` / `security` / `none` |

---

## Part of the Suite

This server is one of 13 in the bConnect MCP Suite. See the [suite README](../MCP_Deployment/README.md) for deployment options (Windows installer, Linux systemd, Docker).

---

## Compatibility

| MCP server version | Supported bMS release | bConnect API | Notes |
|--------------------|-----------------------|--------------|-------|
| `26.1.0` | baramundi Management Suite 2026R1 | V2.0 | **26R1 only** — compliance API does not exist in 25R2 |
| `1.0.0` (legacy) | ≤25R2 (unspecified) | V2.0 | Pre-versioning-scheme release (no compliance tools) |

> This server requires `BCONNECT_RELEASE=26R1`. It has no tools when targeting 25R2.
> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
