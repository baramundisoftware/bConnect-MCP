# bconnect-jobs-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Deployment jobs and task execution — job definitions, job instances, folders, kiosk releases, and group assignment  
**Tools:** 23 by default (37 with `ALLOW_WRITE_OPERATIONS=true`)

> **Requires baramundi Management Suite 26R1 or later.** The server reads the bMS version
> from `GET /v2.0/ManagementServer` during its startup connectivity check and exits if it is
> older. There is no `BCONNECT_RELEASE` setting.

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
# Optional: BCONNECT_AUDIT_LEVEL=write   (all / write / security / none)
```

```bash
# Build from the repo ROOT. Every server imports @bconnect/mcp-core, so a
# server directory cannot be built on its own.
npm ci
npm run build -w @bconnect/mcp-core
npm run build -w bconnect-jobs-mcp

# Run it. Credentials come from the env file, never from the command line.
node --env-file=/path/to/bconnect.env bconnect-jobs-mcp/build/index.js
```

### Registering it with an MCP client

Every client starts the **same process**. What differs is which file the entry
goes in, the key it sits under, and whether the entry is typed:

```json
{
  "bconnect-jobs": {
    "type": "stdio",
    "command": "node",
    "args": [
      "--env-file=/path/to/bconnect.env",
      "/opt/bconnect-mcp-suite/bconnect-jobs-mcp/build/index.js"
    ]
  }
}
```

| Client | File | Wrap the entry in | `"type"` |
|--------|------|-------------------|:----------:|
| Claude Code | `.mcp.json` in the project root | `mcpServers` | keep |
| VS Code (Copilot agent mode) | `.vscode/mcp.json` | **`servers`** | keep |
| Claude Desktop | `claude_desktop_config.json` | `mcpServers` | drop |
| Cursor | `.cursor/mcp.json` | `mcpServers` | drop |
| Continue | `~/.continue/mcpServers/<name>.yaml` | `mcpServers`, a YAML **list** whose items each carry their own `name:` | keep |
| LibreChat | `librechat.yaml` | `mcpServers` | keep |

`servers` vs `mcpServers` is the usual silent failure: VS Code ignores an
`mcpServers` block without reporting anything. n8n, Open WebUI, OpenAI's hosted
tool and Copilot Studio have no stdio path at all and reach the suite over the
HTTP gateway instead — see the [suite README](../README.md#client-configuration).

> `--env-file` needs Node 20.6 or newer (22.15+ is recommended anyway). On an
> older Node, export the variables into the environment before launching.

> No credential appears in the entry above. A client config is not a secrets
> store — several of them are world-readable by default and some are committed
> to version control. See [SECURITY.md](../SECURITY.md#credentials-at-rest-env-and-client-config).

---

## Available Tools

**Write tools are advertised only when `ALLOW_WRITE_OPERATIONS=true` (TOK-20).** With the gate
shut the catalogue is the 23 read tools below; the 14 mutating tools are hidden, not removed —
calling one by name still returns the same `Write operation ... is disabled` refusal.

**Assigning a job the bMS flags `Destructive` is refused server-side** — a second gate inside the
write gate, because a deployer who accepted writes has not thereby accepted an unattended wipe.
`ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT=true` permits it anyway. Reading that flag needs the bConnect
v1.1 surface, which is off unless `BCONNECT_ENABLE_V11=true` and `BCONNECT_V11_USERNAME` (UPN form,
`user@domain`) / `BCONNECT_V11_PASSWORD` are set; v1.1 accepts Basic auth only and is reachable on
the management LAN only. **With v1.1 off the flag cannot be read and the assignment proceeds** —
the result then carries a `NOT CHECKED` line naming the reason, so an unverified assignment is
never mistaken for a verified one. The same three variables supply the safety and configuration
fields in `preview_assignment`, `diagnose_job` and `explain_job_failure`; each reports plainly when
they are unavailable.

**The seven `list_job_instances*` tools return compact rows by default (TOK-27).** `steps[]` and any
column that is identical across the page are omitted and named once in `meta`; a
`jobDefinitionDisplayName` equal to `jobDefinitionName` is omitted on that row. Measured live on a
20-row page: 21,389 B -> 11,699 B (-45.3%). Pass `includeSteps: true` for the steps, or
`detail: true` for the unmodified API record.

**Every paged list tool accepts `countOnly: true` (TOK-25),** which returns `totalItems` and the
filters it counted instead of a page of rows.

| Tool | Description |
|------|-------------|
| `list_job_definitions` | List all job definitions in baramundi |
| `get_job_definition` | Get details of a specific job definition by GUID |
| `list_job_instances` | List all job instances (execution history) |
| `get_job_instance` | Get details of a specific job instance by GUID |
| `list_job_instances_by_endpoint` | List all job instances for a specific endpoint |
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
| `list_job_instances_by_universal_dynamic_group` | List job instances for a universal dynamic group's endpoints |
| `diagnose_job` | Composite tool: diagnose why a job instance is stuck or failing, combining instance state with related error detail |
| `explain_job_failure` | Composite tool: plain-language explanation of a job instance's failure cause |
| `preview_assignment` | Composite tool: preview which endpoints a job assignment would reach before committing it |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect REST API base URL |
| `BCONNECT_USERNAME` | Yes | — | API username |
| `BCONNECT_PASSWORD` | Yes | — | API password |
| `BCONNECT_CA_CERT_PATH` | No | — | Path to CA certificate (PEM) for self-signed certs (use instead of disabling TLS) |
| `BCONNECT_TIMEOUT_MS` | No | `30000` | HTTP request timeout in milliseconds |
| `BCONNECT_MAX_RETRIES` | No | `0` | Number of automatic retries for failed requests |
| `BCONNECT_RETRY_DELAY_MS` | No | `100` | Delay between retries in milliseconds |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | No | `false` | Skip the startup connectivity probe **and the 26R1 version gate with it** |
| `BCONNECT_AUDIT_LEVEL` | No | `write` | `all` / `write` / `security` / `none` |
| `BCONNECT_AUDIT_INCLUDE_PARAMS` | No | `false` | Include tool call parameters (redacted) in audit log entries |

---

## Part of the Suite

This server is one of 13 in the bConnect MCP Suite. See the [suite README](../README.md) for the server list, the configuration reference and client-configuration examples, and [docs/INSTALLATION.md](../docs/INSTALLATION.md) for deployment options (Windows, Linux, Docker, HTTP gateway).

---

## Compatibility

| MCP server version | Supported bMS release | bConnect API | Notes |
|--------------------|-----------------------|--------------|-------|
| `26.1.8` | baramundi Management Suite 2026R1 or later | V2.0 | Current — 26R1-only; `BCONNECT_RELEASE` and 25R2 support removed |

> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
> Example: `26.1.8` targets bMS 2026R1; patch-only fixes increment the last digit.
