# bconnect-activedirectory-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Active Directory OUs, groups, users, and objects synchronized into baramundi Management Suite  
**Tools:** 16 by default (no write tools)

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
npm run build -w bconnect-activedirectory-mcp

# Run it. Credentials come from the env file, never from the command line.
node --env-file=/path/to/bconnect.env bconnect-activedirectory-mcp/build/index.js
```

### Registering it with an MCP client

Every client starts the **same process**. What differs is which file the entry
goes in, the key it sits under, and whether the entry is typed:

```json
{
  "bconnect-activedirectory": {
    "type": "stdio",
    "command": "node",
    "args": [
      "--env-file=/path/to/bconnect.env",
      "/opt/bconnect-mcp-suite/bconnect-activedirectory-mcp/build/index.js"
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
| `list_ad_groups` | List all AD groups synchronized into baramundi |
| `get_ad_group` | Get details of a specific AD group by GUID |
| `list_ad_subgroups` | List nested sub-groups of a parent AD group |
| `list_ad_groups_by_org_unit` | List AD groups within a specific OU |
| `list_ad_objects` | List all AD objects (users and groups) |
| `get_ad_object` | Get details of a specific AD object by GUID |
| `list_ad_object_memberships` | List group memberships for an AD object |
| `list_ad_objects_by_group` | List AD objects that are members of a group |
| `list_ad_objects_by_org_unit` | List AD objects within a specific OU |
| `list_ad_users` | List all AD users synchronized into baramundi |
| `get_ad_user` | Get details of a specific AD user by GUID |
| `list_ad_users_by_group` | List AD users that are members of a group |
| `list_ad_users_by_org_unit` | List AD users within a specific OU |
| `list_org_units` | List all AD organizational units |
| `get_org_unit` | Get details of a specific OU by GUID |
| `list_org_units_by_org_unit` | List child OUs within a parent OU |

---

**Surface change in 26.1.8.** Every `list_*` tool accepts `countOnly: true`, which
returns `{ totalItems, filters }` instead of a page of rows — a couple of hundred
bytes instead of a full page. This server is read-only, so the write gate
(`ALLOW_WRITE_OPERATIONS`) changes nothing about what it advertises.

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
| `26.1.8` | baramundi Management Suite 2026R1 or later | V2.0 | Current — every `list_*` tool accepts `countOnly: true` |
| `26.1.7` | baramundi Management Suite 2026R1 or later | V2.0 | Previous — 26R1-only; `BCONNECT_RELEASE` and 25R2 support removed |

> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
> Example: `26.1.8` targets bMS 2026R1; patch-only fixes increment the last digit.
