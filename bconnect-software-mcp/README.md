# bconnect-software-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Software inventory and deployment — installed Windows software inventory and software bundle management  
**Tools:** 11 by default (19 with `ALLOW_WRITE_OPERATIONS=true`)

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
npm run build -w bconnect-software-mcp

# Run it. Credentials come from the env file, never from the command line.
node --env-file=/path/to/bconnect.env bconnect-software-mcp/build/index.js
```

### Registering it with an MCP client

Every client starts the **same process**. What differs is which file the entry
goes in, the key it sits under, and whether the entry is typed:

```json
{
  "bconnect-software": {
    "type": "stdio",
    "command": "node",
    "args": [
      "--env-file=/path/to/bconnect.env",
      "/opt/bconnect-mcp-suite/bconnect-software-mcp/build/index.js"
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
| `list_installed_windows_software` | List all installed Windows software across all endpoints |
| `list_installed_software_by_endpoint` | List installed software on a specific endpoint |
| `list_installed_software_by_logical_group` | List installed software for a logical group's endpoints |
| `list_installed_software_by_universal_dynamic_group` | List installed software for a Universal Dynamic Group |
| `list_software_bundles` | List all software bundles in baramundi |
| `get_software_bundle` | Get details of a specific software bundle |
| `create_software_bundle` | Create a new software bundle |
| `delete_software_bundle` | Delete a software bundle by GUID |
| `list_bundle_applications` | List all bundle applications |
| `list_bundle_applications_by_bundle` | List applications within a specific bundle |
| `add_application_to_bundle` | Add an application to a bundle |
| `delete_bundle_application` | Remove an application from a bundle |
| `replace_application_in_bundle` | Replace an application in a bundle |
| `list_bundle_folders` | List all bundle folders |
| `get_bundle_folder` | Get details of a specific bundle folder |
| `list_bundle_folders_by_folder` | List sub-folders within a bundle folder |
| `create_bundle_folder` | Create a new bundle folder |
| `delete_bundle_folder` | Delete a bundle folder by GUID |
| `update_bundle_folder` | Update a bundle folder via JSON Patch |

### Which tools are advertised (breaking surface change)

The eight write tools — `create_software_bundle`, `delete_software_bundle`,
`add_application_to_bundle`, `delete_bundle_application`, `replace_application_in_bundle`,
`create_bundle_folder`, `delete_bundle_folder`, `update_bundle_folder` — are **no longer listed by
`tools/list` unless `ALLOW_WRITE_OPERATIONS=true`**. In the default (read-only) posture their only
possible answer was the refusal string, so their schemas cost context for nothing: 26R1
`tools/list` is **13,711 → 10,850 bytes (−20.9%)**.

Hiding is not disabling. A client that already knows a write tool's name still gets the same
refusal, word for word, and the gate is unchanged. No tool was renamed or removed.

### Response shaping on the installed-software tools

The four `list_installed_software*` tools return a **compact projection by default**. Columns that
merely echo an argument you supplied (`endpointId`), and columns that hold the same value on every
row of the page (`endpointName`, and `autUsage`/`autFirstUse`/`autLastUse`/`autLastData` wherever
application usage tracking is off) are reported **once** under `meta.echoed` / `meta.constant`
instead of on all twenty rows. Measured on a 20-row page: **8,630 → 3,338 bytes (−61.3%)**.

Nothing is lost — every dropped value is still in the response, once — and three parameters take it
back or narrow it further:

| Parameter | Effect |
|---|---|
| `detail: true` | the raw API record, byte for byte, with no `meta` |
| `fields: ["name","version"]` | only these columns |
| `countOnly: true` | just `{ totalItems, filters }`, without fetching a row (~120 bytes) |

`countOnly` is also available on `list_software_bundles`, `list_bundle_applications`,
`list_bundle_applications_by_bundle`, `list_bundle_folders` and `list_bundle_folders_by_folder`.
The bundle list tools are otherwise unshaped: their rows carry no echoed or always-null block.

### Error responses

Failures you can act on — HTTP 400 (bad filter), 403 (denied), 404 (wrong id), 429 (slow down) —
now come back as a readable tool result with `isError: true`, the same shape the write gate
returns, instead of a JSON-RPC `-32603 internal error`. 401, 5xx, TLS and transport failures stay
protocol errors: no argument you can change fixes bad credentials or a bMS that is down.

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
| `ALLOW_WRITE_OPERATIONS` | No | `false` | `true` both enables **and advertises** the eight write tools |

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
