# bconnect-jobs-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Deployment jobs and task execution — job definitions, job instances, folders, kiosk releases, and group assignment  
**Tools:** 33

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
cd bconnect-jobs-mcp
npm install && npm run build
node build/index.js

# Claude Code / Claude Desktop entry (~/.claude.json or claude_desktop_config.json):
{
  "mcpServers": {
    "bconnect-jobs": {
      "command": "node",
      "args": ["/opt/bconnect-mcp-suite/bconnect-jobs-mcp/build/index.js"],
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
| `list_job_definitions` | List all job definitions in baramundi |
| `get_job_definition` | Get details of a specific job definition by GUID |
| `list_job_instances` | List all job instances (execution history) |
| `get_job_instance` | Get details of a specific job instance by GUID |
| `list_endpoint_job_instances` | List all job instances for a specific endpoint |
| `list_job_instances_by_definition` | List all instances of a specific job definition |
| `list_job_instances_by_logical_group` | List job instances for a logical group's endpoints |
| `list_job_definitions_by_folder` | List job definitions within a specific folder |
| `create_job_instance` | Create a new job instance (trigger a deployment) |
| `start_job_instance` | Start a paused job instance |
| `stop_job_instance` | Stop a running job instance |
| `resume_job_instance` | Resume a stopped job instance |
| `delete_job_instance` | Delete a job instance by GUID |
| `create_job_folder` | Create a new job folder |
| `update_job_folder` | Update an existing job folder via JSON Patch |
| `delete_job_folder` | Delete a job folder by GUID |
| `assign_job_to_logical_group` | Assign a job definition to a logical group |
| `assign_job_to_static_group` | Assign a job definition to a static group |
| `assign_job_to_dynamic_group` | Assign a job definition to a dynamic group |
| `assign_job_to_universal_dynamic_group` | Assign a job definition to a universal dynamic group |
| `create_kiosk_release` | Create a new kiosk release for a job definition |
| `withdraw_kiosk_release` | Withdraw an existing kiosk release |
| `list_kiosk_releases` | List all kiosk releases in baramundi |
| `get_kiosk_release` | Get details of a specific kiosk release |
| `list_job_folders` | List all top-level job folders |
| `get_job_folder` | Get details of a specific job folder by GUID |
| `list_job_subfolders` | List sub-folders within a specific job folder |
| `list_kiosk_releases_by_job_definition` | List kiosk releases for a specific job definition |
| `list_kiosk_releases_by_endpoint` | List kiosk releases available to a specific endpoint |
| `list_kiosk_releases_by_ad_object` | List kiosk releases available to an AD object |
| `list_kiosk_releases_by_logical_group` | List kiosk releases available to a logical group |
| `list_job_instances_by_static_group` | List job instances for a static group's endpoints |
| `list_job_instances_by_dynamic_group` | List job instances for a dynamic group's endpoints |

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
| `26.1.0` | baramundi Management Suite 2026R1 | V2.0 | Current — full tool set |
| `25.2.0` *(planned)* | baramundi Management Suite 2025R2 | V2.0 | Subset of tools (25R2 spec) |
| `1.0.0` (legacy) | ≤25R2 (unspecified) | V2.0 | Pre-versioning-scheme release |

> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
> Example: `26.1.0` targets bMS 2026R1; patch-only fixes increment the last digit.
