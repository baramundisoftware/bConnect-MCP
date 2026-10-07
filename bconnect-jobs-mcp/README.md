# bconnect-jobs-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Deployment jobs and task execution — job definitions, job instances, folders, kiosk releases, and group assignment  
**Tools:** 34

---

## Quick Start

Build from the **repo root**: the server needs the shared `@bconnect/mcp-core` package, so a
server directory can't be built on its own.

```bash
npm ci
npm run build -w @bconnect/mcp-core
npm run build -w bconnect-jobs-mcp
```

Configure it in your MCP client's `env` block (below), or keep the credentials out of the
client's configuration with `node --env-file` ([docs/CLIENTS.md](../docs/CLIENTS.md)). A `.env`
file (copy `.env.example`) is read only when you start the server from `bconnect-jobs-mcp/` yourself; MCP
clients start it from another directory.

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_API_KEY=<api-key>          # or BCONNECT_USERNAME + BCONNECT_PASSWORD
# Optional: BCONNECT_CA_CERT_PATH=/path/to/internal-ca.pem
```

Claude Code:

```bash
claude mcp add bconnect-jobs --scope user \
  --env BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect \
  --env BCONNECT_API_KEY=<api-key> \
  -- node /absolute/path/to/bconnect-jobs-mcp/build/index.js
```

Claude Desktop (`claude_desktop_config.json`) and other clients: see
[docs/CLIENTS.md](../docs/CLIENTS.md).

---

## Available Tools

Write tools (create, update, delete, start, assign, …) are **off** unless
`ALLOW_WRITE_OPERATIONS=true` is set. While they are off, the tool list leaves them out, which
keeps their descriptions out of the model's context, and a call by name is refused. A write tool whose description ends with "Not yet verified against a live bMS." hasn't
been checked against a real bMS yet.

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
| `start_job_instance` | Start a pending or paused job instance |
| `stop_job_instance` | Stop a running job instance |
| `resume_job_instance` | Resume a paused job instance (Windows endpoints only) |
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
| `list_job_folders` | List job folders at every level (`parentId` gives the hierarchy) |
| `get_job_folder` | Get details of a specific job folder by GUID |
| `list_job_subfolders` | List sub-folders within a specific job folder |
| `list_kiosk_releases_by_job_definition` | List kiosk releases for a specific job definition |
| `list_kiosk_releases_by_endpoint` | List kiosk releases available to a specific endpoint |
| `list_kiosk_releases_by_ad_object` | List kiosk releases available to an AD object |
| `list_kiosk_releases_by_logical_group` | List kiosk releases available to a logical group |
| `list_job_instances_by_static_group` | List job instances for a static group's endpoints |
| `list_job_instances_by_dynamic_group` | List job instances for a dynamic group's endpoints |
| `list_job_instances_by_universal_dynamic_group` | List job instances for a universal dynamic group's endpoints |

---

## Environment Variables

The variables this server reads (a test checks the list). Each is described, with its default, in [docs/CONFIGURATION.md](../docs/CONFIGURATION.md); the second column says only what is different in this server. When the HTTP gateway hosts the server, `MCP_TRANSPORT`, `MCP_PORT`, `MCP_BIND` and `MCP_ALLOWED_HOSTS` have no effect, `ALLOW_WRITE_OPERATIONS` and `ALLOW_SECRET_READ` are ignored (always off), and the gateway's own settings apply ([Gateway](../docs/CONFIGURATION.md#gateway)).

<!-- env:start -->
| Variable | In this server |
|----------|----------------|
| [`BCONNECT_BASE_URL`](../docs/CONFIGURATION.md#bconnect_base_url) |  |
| [`BCONNECT_API_KEY`](../docs/CONFIGURATION.md#bconnect_api_key) |  |
| [`BCONNECT_USERNAME`](../docs/CONFIGURATION.md#bconnect_username) |  |
| [`BCONNECT_PASSWORD`](../docs/CONFIGURATION.md#bconnect_password) |  |
| [`BCONNECT_CA_CERT_PATH`](../docs/CONFIGURATION.md#bconnect_ca_cert_path) |  |
| [`NODE_TLS_REJECT_UNAUTHORIZED`](../docs/CONFIGURATION.md#node_tls_reject_unauthorized) |  |
| [`BCONNECT_ALLOW_INSECURE_HTTP`](../docs/CONFIGURATION.md#bconnect_allow_insecure_http) |  |
| [`ALLOW_WRITE_OPERATIONS`](../docs/CONFIGURATION.md#allow_write_operations) |  |
| [`ALLOW_SECRET_READ`](../docs/CONFIGURATION.md#allow_secret_read) | No effect: this server has no tool that returns secrets. |
| [`BCONNECT_RELEASE`](../docs/CONFIGURATION.md#bconnect_release) |  |
| [`BCONNECT_AUDIT_LEVEL`](../docs/CONFIGURATION.md#bconnect_audit_level) |  |
| [`BCONNECT_PRETTY_JSON`](../docs/CONFIGURATION.md#bconnect_pretty_json) |  |
| [`BCONNECT_RATE_LIMIT_ENABLED`](../docs/CONFIGURATION.md#bconnect_rate_limit_enabled) |  |
| [`BCONNECT_RATE_LIMIT_MAX_REQUESTS`](../docs/CONFIGURATION.md#bconnect_rate_limit_max_requests) |  |
| [`BCONNECT_RATE_LIMIT_WINDOW_MS`](../docs/CONFIGURATION.md#bconnect_rate_limit_window_ms) |  |
| [`BCONNECT_TIMEOUT_MS`](../docs/CONFIGURATION.md#bconnect_timeout_ms) |  |
| [`BCONNECT_MAX_RETRIES`](../docs/CONFIGURATION.md#bconnect_max_retries) |  |
| [`BCONNECT_SKIP_CONNECTIVITY_CHECK`](../docs/CONFIGURATION.md#bconnect_skip_connectivity_check) |  |
| [`MCP_TRANSPORT`](../docs/CONFIGURATION.md#mcp_transport) |  |
| [`MCP_PORT`](../docs/CONFIGURATION.md#mcp_port) |  |
| [`MCP_BIND`](../docs/CONFIGURATION.md#mcp_bind) |  |
| [`MCP_ALLOWED_HOSTS`](../docs/CONFIGURATION.md#mcp_allowed_hosts) |  |
| [`MCP_ALLOW_NO_AUTH`](../docs/CONFIGURATION.md#mcp_allow_no_auth) |  |
<!-- env:end -->

---

## Part of the Suite

This server is one of 13 in the bConnect MCP Suite. See the [suite README](../README.md) for an
overview and [docs/INSTALLATION.md](../docs/INSTALLATION.md) for setup, including the HTTP gateway
that serves all 13 servers.

---

## Compatibility

Releases are numbered `26.1.x` and support **bMS 2026 R1 and 2025 R2**. The server reads the
release from the bMS at startup (`version` of the management server; the account needs read access
to server management) and logs it; `BCONNECT_RELEASE` is the fallback when it can't (default `26R1`). See [CHANGELOG.md](../CHANGELOG.md) for what each
release changed.
