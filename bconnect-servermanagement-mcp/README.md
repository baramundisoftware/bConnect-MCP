# bconnect-servermanagement-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Server management — management server info, microservices, security groups/profiles, object permissions, and infrastructure components  
**Tools:** 16 by default (30 with `ALLOW_WRITE_OPERATIONS=true`)

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
npm run build -w bconnect-servermanagement-mcp

# Run it. Credentials come from the env file, never from the command line.
node --env-file=/path/to/bconnect.env bconnect-servermanagement-mcp/build/index.js
```

### Registering it with an MCP client

Every client starts the **same process**. What differs is which file the entry
goes in, the key it sits under, and whether the entry is typed:

```json
{
  "bconnect-servermanagement": {
    "type": "stdio",
    "command": "node",
    "args": [
      "--env-file=/path/to/bconnect.env",
      "/opt/bconnect-mcp-suite/bconnect-servermanagement-mcp/build/index.js"
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

| Tool | Description |
|------|-------------|
| `get_management_server` | Get baramundi Management Server info and status |
| `get_gateway` | Get Gateway configuration and status |
| `get_dip_status` | Get status of all Distribution and Inventory Points |
| `get_vpn_appliance` | Get VPN Appliance configuration and status |
| `list_microservices` | List all registered microservices |
| `get_microservice` | Get details of a specific microservice by GUID |
| `start_microservice` | Start a specific microservice |
| `stop_microservice` | Stop a specific microservice |
| `restart_microservice` | Restart a specific microservice |
| `list_cloud_connectors` | List all configured Cloud Connectors |
| `list_pxe_relays` | List all configured PXE Relay servers |
| `list_security_groups` | List all security groups in baramundi |
| `get_security_group` | Get details of a specific security group |
| `create_security_group` | Create a new security group |
| `update_security_group` | Update a security group via JSON Patch |
| `delete_security_group` | Delete a security group by GUID |
| `list_security_profiles` | List all security profiles in baramundi |
| `get_security_profile` | Get details of a specific security profile |
| `create_security_profile` | Create a new security profile |
| `update_security_profile` | Update a security profile via JSON Patch |
| `delete_security_profile` | Delete a security profile by GUID |
| `get_access_rights` | Get object permissions for a specific object |
| `update_object_permission` | Update object permissions via JSON Patch |
| `restart_management_server` | Restart the baramundi Management Server |
| `cancel_scheduled_restart` | Cancel a scheduled server restart |
| `list_api_keys` | List all API keys configured in baramundi |
| `simulate_msw_cleanup` | Simulate an MSW cleanup operation (dry run) |
| `msw_cleanup` | Execute an MSW cleanup on the DIP |
| `list_download_jobs` | List all download jobs |
| `get_download_job` | Get details of a specific download job |

---

**Surface change in 26.1.8.** Write tools are no longer advertised in `tools/list`
unless `ALLOW_WRITE_OPERATIONS=true`. They are still declared and still dispatched:
calling one by name while the gate is shut returns the same refusal it always did.

`list_api_keys` now requires `ALLOW_SECRET_READ=true` (finding D1). It returns the
bMS API-key inventory, and was previously the one credential-returning route in the
suite that neither the audit set nor the deny set covered.

Every `list_*` tool accepts `countOnly: true`, which returns `{ totalItems, filters }`
instead of a page of rows.

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
| `26.1.8` | baramundi Management Suite 2026R1 or later | V2.0 | Current — write tools no longer advertised in `tools/list` by default |
| `26.1.7` | baramundi Management Suite 2026R1 or later | V2.0 | Previous — 26R1-only; `BCONNECT_RELEASE` and 25R2 support removed |

> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
> Example: `26.1.8` targets bMS 2026R1; patch-only fixes increment the last digit.
