# bconnect-updatemanagement-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Windows Update management — Microsoft Update profile assignment and status for managed Windows endpoints  
**Tools:** 2 by default (3 with `ALLOW_WRITE_OPERATIONS=true`)

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
npm run build -w bconnect-updatemanagement-mcp

# Run it. Credentials come from the env file, never from the command line.
node --env-file=/path/to/bconnect.env bconnect-updatemanagement-mcp/build/index.js
```

### Registering it with an MCP client

Every client starts the **same process**. What differs is which file the entry
goes in, the key it sits under, and whether the entry is typed:

```json
{
  "bconnect-updatemanagement": {
    "type": "stdio",
    "command": "node",
    "args": [
      "--env-file=/path/to/bconnect.env",
      "/opt/bconnect-mcp-suite/bconnect-updatemanagement-mcp/build/index.js"
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
| `list_update_management_endpoints` | List all Windows endpoints with update management status |
| `get_update_management_endpoint` | Get update management status for a specific endpoint |
| `update_update_management_endpoint` | Assign or remove an update profile from an endpoint |
| `list_microsoft_update_profiles` | *(v1.1, gated)* List Microsoft Update profiles: deferral days, blocked classifications/products |
| `get_endpoint_microsoft_update_inventory` | *(v1.1, gated)* Per-endpoint Microsoft Update inventory digest; `detail:true` for the raw record |

### bConnect v1.1 tools (optional)

The two `microsoft_update` tools read the **bConnect v1.1** interface
(`/bConnect/v1.1/MicrosoftUpdateProfiles` and `…/MicrosoftUpdateInventories`), which the
v2.0 API does not expose. They are advertised **only** when all three of the following
are set — otherwise they are absent from `tools/list` entirely and cost no schema tokens:

```env
BCONNECT_ENABLE_V11=true
BCONNECT_V11_USERNAME=<account>@<domain>   # UPN form; a bare account name is a 401
BCONNECT_V11_PASSWORD=<password>
```

Three constraints, all verified against a live bMS 26R1:

- **Basic auth only.** The v2.0 API key is never accepted by v1.1 — hence the separate
  credential, so the 13 v2.0 servers are unaffected. The account must be a member of the
  bConnect security group on the bMS.
- **LAN-only.** v1.1 is not served through the bConnect gateway; a gateway or WAN
  deployment cannot reach it, and the tools say so when a connection fails.
- **Strict parameters.** v1.1 answers HTTP 400 to an unknown query-parameter name,
  where v2.0 silently ignores it.

`get_endpoint_microsoft_update_inventory` **requires** `endpointId` and uses the server-side
`EndpointId` filter: the unfiltered controller answer is ~164 KB for 22 endpoints,
so no unfiltered variant is exposed. The compact digest is ~1 KB (measured live:
1,042 bytes vs 12,532 for `detail:true`).

---

**Surface change in 26.1.8.** Write tools are no longer advertised in `tools/list`
unless `ALLOW_WRITE_OPERATIONS=true`. They are still declared and still dispatched:
calling one by name while the gate is shut returns the same refusal it always did
(`Write operation '<name>' is disabled…`). Hiding is a token optimisation; the gate
is the security control and is unchanged.

Every `list_*` tool accepts `countOnly: true`, which returns `{ totalItems, filters }`
instead of a page of rows — a couple of hundred bytes instead of a full page.

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
