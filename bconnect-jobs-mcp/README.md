# bconnect-jobs-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Deployment jobs and task execution — job definitions, job instances, folders, kiosk releases, and group assignment  
**Tools:** 34

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
# Optional: BCONNECT_CA_CERT_PATH=/path/to/internal-ca.pem
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
        "BCONNECT_BASE_URL": "https://bms-server:443/bconnect",
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

Run inside the HTTP gateway, the server's own startup code doesn't run: `MCP_TRANSPORT`, `MCP_PORT`, `MCP_BIND` and `BCONNECT_SKIP_CONNECTIVITY_CHECK` then have no effect, and the gateway's own settings apply. The gateway reads `MCP_ALLOW_NO_AUTH` itself, for its own bind address.

<!-- env:start -->
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect base URL, e.g. `https://bms.corp.local:443/bconnect`. If unset, a placeholder is used and the startup check fails. |
| `BCONNECT_API_KEY` | One of | — | API key. Set this, or `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. Used instead of them when both are set. |
| `BCONNECT_USERNAME` | One of | — | User for Basic authentication, together with `BCONNECT_PASSWORD`. |
| `BCONNECT_PASSWORD` | One of | — | Password for `BCONNECT_USERNAME`. |
| `BCONNECT_CA_CERT_PATH` | No | — | PEM file with the CA certificate that signed the bMS server certificate (internal CA). When set, only this CA is trusted; when unset, Node's default and (Node 22.15 or later) the operating system's trusted CAs are used. The server fails if the file can't be read or is empty. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | verify | `0` turns certificate verification off for every TLS connection of the process. Development only; use `BCONNECT_CA_CERT_PATH` instead. |
| `BCONNECT_ALLOW_INSECURE_HTTP` | No | off | `true` allows an `http://` base URL to a host other than this machine, which sends the bConnect credentials unencrypted; the server warns once at startup. Test setups only. `http://` to `localhost`, `127.x.x.x` or `[::1]` (the bundled mock) needs no opt-in. |
| `ALLOW_WRITE_OPERATIONS` | No | off | `true` enables the tools that create, change or delete data, or start actions. |
| `ALLOW_SECRET_READ` | No | off | `true` lets the shared client call the BitLocker-secret and LAPS operations. This server has no tool that calls them, so the setting has no effect here. |
| `BCONNECT_RELEASE` | No | `26R1` | bMS release the server talks to, `26R1` or `25R2`. It selects the API documentation used to explain an error, e.g. what a 404 means for that call. |
| `BCONNECT_AUDIT_LEVEL` | No | `none` | `none`, `security`, `write` or `all`, in any case. Levels are cumulative: `security` records credential reads and changes (BitLocker, LAPS), `write` adds every write, `all` records every request. Any other value stops the server. Entries go to stderr. |
| `BCONNECT_RATE_LIMIT_ENABLED` | No | off | `true` limits the requests one client sends. Each tool call still creates a new client, so the limit doesn't apply across calls yet (#160). |
| `BCONNECT_RATE_LIMIT_MAX_REQUESTS` | No | `100` | Requests allowed per window when the rate limit is on. |
| `BCONNECT_RATE_LIMIT_WINDOW_MS` | No | `60000` | Window length in milliseconds. |
| `BCONNECT_TIMEOUT_MS` | No | `30000` | How long to wait for bConnect's answer, in milliseconds, 1000 to 600000. A request that runs out says so ("didn't answer within …"). Any other value stops the server. |
| `BCONNECT_MAX_RETRIES` | No | `0` | Retries for read requests (GET) after a network error, a timeout or HTTP 502/503/504, 0 to 5. Write requests are never retried. Any other value stops the server. |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | No | off | `true` skips the startup connectivity check. |
| `MCP_TRANSPORT` | No | `stdio` | `http` serves MCP over HTTP instead of stdio. |
| `MCP_PORT` | No | `3000` | Port in HTTP mode. |
| `MCP_BIND` | No | `127.0.0.1` | Address to bind in HTTP mode. HTTP mode has no client authentication: keep it on loopback, or put an authenticating reverse proxy in front. |
| `MCP_ALLOW_NO_AUTH` | No | off | `true` allows binding HTTP mode to an address other than loopback, without authentication. Not recommended. |
<!-- env:end -->

---

## Part of the Suite

This server is one of 13 in the bConnect MCP Suite. See the [suite README](../MCP_Deployment/README.md) for deployment options (Windows installer, Linux systemd, Docker).

---

## Compatibility

| MCP server version | Supported bMS release | bConnect API | Notes |
|--------------------|-----------------------|--------------|-------|
| `26.1.7` | baramundi Management Suite 2026R1 | V2.0 | Current — full tool set |
| `25.2.0` *(planned)* | baramundi Management Suite 2025R2 | V2.0 | Subset of tools (25R2 spec) |
| `1.0.0` (legacy) | ≤25R2 (unspecified) | V2.0 | Pre-versioning-scheme release |

> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
> Example: `26.1.7` targets bMS 2026R1; patch-only fixes increment the last digit.
