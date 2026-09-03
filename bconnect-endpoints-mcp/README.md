# bconnect-endpoints-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Managed endpoints — Windows, Linux, macOS, Android, iOS, network, and unmanaged devices  
**Tools:** 10 by default (31 with `ALLOW_WRITE_OPERATIONS=true`)

> **Requires baramundi Management Suite 26R1 or later.** The server reads the bMS version
> from `GET /v2.0/ManagementServer` during its startup connectivity check and exits if it is
> older. There is no `BCONNECT_RELEASE` setting.

> **Removed in this release: the five `*_industrial_endpoint` tools.** 26R1 deleted the
> `IndustrialEndpoints` bConnect resource (8 operations, 3 schemas), so `list_`, `get_`,
> `create_`, `update_` and `delete_industrial_endpoint` would 404 against every supported
> server. Calling one by name returns a message naming that reason rather than a generic
> unknown-tool error. There is no replacement — see
> [../docs/MIGRATION-tool-surface.md](../docs/MIGRATION-tool-surface.md). The
> `Deprecated_IndustrialEndpoint` enum value is deliberately kept in the generated types, per
> the vendor's own note, so historical records still deserialise.

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
npm run build -w bconnect-endpoints-mcp

# Run it. Credentials come from the env file, never from the command line.
node --env-file=/path/to/bconnect.env bconnect-endpoints-mcp/build/index.js
```

### Registering it with an MCP client

Every client starts the **same process**. What differs is which file the entry
goes in, the key it sits under, and whether the entry is typed:

```json
{
  "bconnect-endpoints": {
    "type": "stdio",
    "command": "node",
    "args": [
      "--env-file=/path/to/bconnect.env",
      "/opt/bconnect-mcp-suite/bconnect-endpoints-mcp/build/index.js"
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

> **Breaking surface change, 2026-08-02** (findings TOK-20/21/23/25/26):
>
> - **Write tools are advertised only when `ALLOW_WRITE_OPERATIONS=true`.** With the
>   gate shut the catalogue is 10 tools / 8,282 B instead of 31 / 19,190 B. Hiding
>   is not disabling: calling a hidden write by name still returns the same
>   `Write operation '…' is disabled` refusal.
> - **The endpoint list tools return a compact ten-field projection by default**
>   (`id`, `displayName`, `hostName`, `type`, `operatingSystem`, `osVersionString`,
>   `lastSeen`, `logicalGroup`, `clientAgentVersion`, `activity`). Pass
>   `detail: true` for the raw API record, or `fields: [...]` to choose your own.
>   A 20-row `list_endpoints({ type: 'WindowsEndpoint' })` page went from ~65 KB to ~8.8 KB.
> - **`countOnly: true`** on a list tool returns `{ totalItems, filters }` and no
>   rows.
> - **`consoleLink` is no longer written on every row.** Responses carry one
>   `consoleLinks` block — `template`, the `type → navigationObjectType` table and
>   one fully-expanded `example` — which reconstructs any row's `bMC:///` URI from
>   its `id` and `type`.
> - **`list_group_endpoints` has been removed.** It issued the identical request as
>   `list_endpoints_by_logical_group`, which accepts everything it did plus
>   `SearchQuery` and `OrderBy`. Use that one.

> - **The six per-platform tool families have collapsed into five tools that take the
>   platform as a `type` argument.** `list_windows_endpoints`, `get_linux_endpoint`,
>   `delete_mac_endpoint`, `update_android_endpoint`, `start_ios_enrollment` and their
>   siblings are gone; call `list_endpoints({ type: 'WindowsEndpoint' })` and so on. The
>   enum values are the API's own spelling — exactly what each row reports in its `type`
>   field — so a value read off a list can be fed straight back in. Every original route
>   is still reachable, and `list_endpoints_by_logical_group` now also reaches the Linux,
>   Mac, Android, iOS and Network group routes, which had no tool at all before.
>   Filters and fields are validated PER TYPE: `Domain` is Windows-only,
>   `UnmanagedEndpoint` accepts no filters, and asking for one you do not have is
>   refused rather than silently ignored (bConnect would answer HTTP 200 and drop it).
>   Calling a removed name returns a message naming the replacement and the `type` to
>   pass.
> - **`create_*_endpoint` deliberately did NOT collapse.** The six create tools share
>   zero parameters and have three different required sets, so a single `create_endpoint`
>   would advertise a union whose valid subset is implied only by the enum value — on the
>   tools that create real objects in a real bMS.

| Tool | Description |
|------|-------------|
| `list_endpoints` | List endpoints. Optional `type` selects one platform's route; omit it for all. |
| `get_endpoint` | Get one endpoint by GUID. Optional `type` reads the platform's own record. |
| `list_endpoints_by_logical_group` | List a logical group's endpoints. Optional `type`; `includeSubfolders` reaches sub-groups. |
| `list_logical_groups` | List logical groups |
| `get_logical_group` | Get one logical group by GUID |
| `get_maintenance_window_for_endpoint` | Get an endpoint's maintenance window |
| `get_maintenance_window_for_logical_group` | Get a logical group's maintenance window |
| `get_entra_id_data` | Get the endpoint linked to a Microsoft Entra **device id** |
| `get_fleet_summary` | Composite: fleet-wide digest — counts, OS mix, agent outliers, what needs attention |
| `get_stale_endpoints` | Composite: ghost machines — not seen for N days, or checking in but never succeeding a job |

Write tools (advertised only with `ALLOW_WRITE_OPERATIONS=true`):

| Tool | Description |
|------|-------------|
| `update_endpoint` | Update an endpoint. `type` required; fields validated per type. |
| `delete_endpoint` | Delete an endpoint. Optional `type` uses that platform's own route. |
| `start_enrollment` | Start MDM enrollment. `type` required (Windows, Mac, Android, iOS). |
| `create_windows_endpoint` | Create a Windows endpoint (requires `displayName` **and** `hostName`) |
| `create_linux_endpoint` | Create a Linux endpoint (requires `displayName` **and** `hostName`) |
| `create_mac_endpoint` | Create a Mac endpoint |
| `create_android_endpoint` | Create an Android endpoint |
| `create_ios_endpoint` | Create an iOS/iPadOS endpoint |
| `create_network_endpoint` | Create a network endpoint (requires `displayName` **and** `primaryIP`) |
| `trigger_intune_installation` | Trigger Agent installation on a Windows endpoint via Intune |
| `create_logical_group` | Create a logical group |
| `update_logical_group` | Update a logical group |
| `delete_logical_group` | Delete a logical group (must be empty) |
| `create_maintenance_window_for_endpoint` | Create an endpoint's maintenance window |
| `update_maintenance_window_for_endpoint` | Update an endpoint's maintenance window |
| `delete_maintenance_window_for_endpoint` | Delete an endpoint's maintenance window |
| `create_maintenance_window_for_logical_group` | Create a logical group's maintenance window |
| `update_maintenance_window_for_logical_group` | Update a logical group's maintenance window |
| `delete_maintenance_window_for_logical_group` | Delete a logical group's maintenance window |
| `link_entra_id_data` | Link a Microsoft Entra device to an endpoint |
| `unlink_entra_id_data` | Unlink Microsoft Entra data from an endpoint |
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

## Regenerating the generated layer

`src/generated/` holds two artifacts, both derived from
`openapi-specs/26R1/bConnect_Endpoints.json`:

| File | Consumer |
|------|----------|
| `endpoints-types.ts` | the compiler — `openapi-typescript` output |
| `endpoints-operation-index.ts` | the runtime — what `defineTools()` reads to build each tool's schema and its validation rules |

```bash
npm run generate
```

`src/__tests__/generated-artifacts.test.ts` fails if either file differs from a fresh
run, so a spec bump cannot land half-applied.

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
