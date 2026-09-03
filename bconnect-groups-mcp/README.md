# bconnect-groups-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Group-scoped endpoint queries — list the members of a logical, static, dynamic or universal dynamic group, and the endpoints of an AD user  
**Tools:** 2 enum-parameterised tools covering 30 routes (was 33 tools before `26.1.8` — see *Migrating* below; the 3 industrial routes went with the 26R1 API removal)

> **Requires baramundi Management Suite 26R1 or later.** The server reads the bMS version
> from `GET /v2.0/ManagementServer` during its startup connectivity check and exits if it is
> older. There is no `BCONNECT_RELEASE` setting.

---

## Quick Start

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_USERNAME=mcp-reader
BCONNECT_PASSWORD=<password>
BCONNECT_REJECT_UNAUTHORIZED=true
# Optional: BCONNECT_AUDIT_LEVEL=write   (all / write / security / none)
```

```bash
# Build from the repo ROOT. Every server imports @bconnect/mcp-core, so a
# server directory cannot be built on its own.
npm ci
npm run build -w @bconnect/mcp-core
npm run build -w bconnect-groups-mcp

# Run it. Credentials come from the env file, never from the command line.
node --env-file=/path/to/bconnect.env bconnect-groups-mcp/build/index.js
```

### Registering it with an MCP client

Every client starts the **same process**. What differs is which file the entry
goes in, the key it sits under, and whether the entry is typed:

```json
{
  "bconnect-groups": {
    "type": "stdio",
    "command": "node",
    "args": [
      "--env-file=/path/to/bconnect.env",
      "/opt/bconnect-mcp-suite/bconnect-groups-mcp/build/index.js"
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

Both tools are read-only GET operations.

| Tool | Description |
|------|-------------|
| `list_group_members` | List the members of a logical, static, dynamic or universal dynamic group — `groupKind` x `memberType` selects the route |
| `list_ad_user_endpoints` | List the endpoints related to an Active Directory user — `endpointType` selects the route |

### `list_group_members`

| Parameter | Type | Notes |
|-----------|------|-------|
| `groupKind` | enum, **required** | `logical` / `static` / `dynamic` / `universalDynamic` |
| `groupId` | GUID, **required** | The group |
| `memberType` | enum | `endpoints` (default, any OS type) / `android` / `ios` / `linux` / `mac` / `network` / `windows` / `childGroups` |
| `Page`, `PageSize`, `SearchQuery`, `OrderBy` | | `Page` is zero-indexed; page 0 is the first page |
| `DisplayName`, `HostName`, `Domain`, `EntraIdDeviceId`, `Name`, `Dip` | string | Exact-match filters — see the applicability table below |
| `includeSubfolders` | boolean | `logical` groups only. Without it a parent group commonly reports zero members |
| `countOnly` | boolean | Return `{ totalItems, filters }` instead of a page of rows |

### `list_ad_user_endpoints`

| Parameter | Type | Notes |
|-----------|------|-------|
| `adUserId` | GUID, **required** | The AD user |
| `endpointType` | enum | `endpoints` (default) / `android` / `ios` / `linux` / `mac` / `windows` |
| `Page`, `PageSize`, `SearchQuery`, `OrderBy` | | |
| `DisplayName`, `HostName`, `Domain`, `EntraIdDeviceId` | string | Exact-match filters — see below |
| `countOnly` | boolean | As above |

### The matrix is sparse

Not every `groupKind` x `memberType` pair is a route the API serves. An unsupported
pair is refused with `-32602` naming the pairs that kind does support.

| `groupKind` | Supported `memberType` |
|-------------|------------------------|
| `logical` | all nine, including `childGroups` |
| `static` | all but `childGroups` |
| `universalDynamic` | all but `childGroups` |
| `dynamic` | `endpoints`, `windows` |
| *(AD user, via `list_ad_user_endpoints`)* | `endpoints`, `android`, `ios`, `linux`, `mac`, `windows` |

### Filters are per member type

bConnect answers HTTP 200 and **silently ignores** a query parameter the route does
not declare, so a filter that does not apply is refused here rather than dropped
upstream — a dropped filter returns an unfiltered result that looks filtered.

| `memberType` | Declared filters |
|--------------|------------------|
| `endpoints`, `linux`, `mac`, `network` | `DisplayName`, `HostName` |
| `android`, `ios` | `DisplayName` |
| `windows` | `DisplayName`, `HostName`, `Domain`, `EntraIdDeviceId` |
| `childGroups` | `Name`, `Dip`, `Domain` |

### Migrating from the 33-tool surface

Before version `26.1.8` this server advertised one operation as 33 tools —
`list_<type>_endpoints_by_<kind>_group` and `list_<type>_endpoints_by_ad_user`.
Measured on the built `createServer`, that catalogue was **33 tools / 29,764 bytes**
of `tools/list` for 3,189 bytes of description text; the rest was 33 repetitions of
the same pagination and filter schema, paid by every client at session start. It is
now **2 tools / 3,778 bytes** (−87.3%). 30 of the 33 routes are still reachable — the 3 that are
not went with the 26R1 removal of the `IndustrialEndpoints` API, not with this collapse (see
below).

| Old tool | New call |
|----------|----------|
| `list_endpoints_by_logical_group {logicalGroupId}` | `list_group_members {groupKind:"logical", groupId}` |
| `list_windows_endpoints_by_logical_group {logicalGroupId}` | `list_group_members {groupKind:"logical", memberType:"windows", groupId}` |
| `list_logical_groups_by_logical_group {logicalGroupId}` | `list_group_members {groupKind:"logical", memberType:"childGroups", groupId}` |
| `list_<type>_endpoints_by_static_group {staticGroupId}` | `list_group_members {groupKind:"static", memberType:"<type>", groupId}` |
| `list_<type>_endpoints_by_dynamic_group {dynamicGroupId}` | `list_group_members {groupKind:"dynamic", memberType:"<type>", groupId}` |
| `list_<type>_endpoints_by_universal_dynamic_group {universalDynamicGroupId}` | `list_group_members {groupKind:"universalDynamic", memberType:"<type>", groupId}` |
| `list_<type>_endpoints_by_ad_user {adUserId}` | `list_ad_user_endpoints {adUserId, endpointType:"<type>"}` |

**Three of the 33 are not reachable at all any more**, and not because of this collapse: the
industrial variants (`list_industrial_endpoints_by_logical_group`, `…_by_static_group`,
`…_by_universal_dynamic_group`) called the `IndustrialEndpoints` resource, which **26R1 removed
from bConnect**. `memberType: "industrial"` is therefore no longer a valid value — passing it is
refused with `-32602`. See [../docs/MIGRATION-tool-surface.md](../docs/MIGRATION-tool-surface.md).

The old id parameter names (`logicalGroupId`, `staticGroupId`, `dynamicGroupId`,
`universalDynamicGroupId`) are rejected as unknown parameters rather than ignored,
so a half-migrated client fails loudly instead of querying the wrong thing.


---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect REST API base URL |
| `BCONNECT_USERNAME` | Yes | — | API username |
| `BCONNECT_PASSWORD` | Yes | — | API password |
| `BCONNECT_REJECT_UNAUTHORIZED` | No | `true` | **Divergence from the rest of the suite:** this server's startup client (the single rejectUnauthorizedFromEnv() resolver in src/index.ts, used by both the runtime provider and the startup check) reads this variable directly, in addition to the shared `NODE_TLS_REJECT_UNAUTHORIZED` mechanism the other 12 servers use. Set `false` to allow self-signed TLS. Prefer `BCONNECT_CA_CERT_PATH` below for a properly trusted self-signed cert instead of disabling verification |
| `BCONNECT_CA_CERT_PATH` | No | — | Path to CA certificate (PEM) for self-signed certs (use instead of disabling TLS) |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | No | `false` | Skip the startup connectivity probe **and the 26R1 version gate with it** |
| `BCONNECT_TIMEOUT_MS` | No | `30000` | HTTP request timeout in milliseconds |
| `BCONNECT_MAX_RETRIES` | No | `0` | Number of automatic retries for failed requests |
| `BCONNECT_RETRY_DELAY_MS` | No | `100` | Delay between retries in milliseconds |
| `BCONNECT_AUDIT_LEVEL` | No | `write` | `all` / `write` / `security` / `none` |
| `BCONNECT_AUDIT_INCLUDE_PARAMS` | No | `false` | Include tool call parameters (redacted) in audit log entries |

---

## Part of the Suite

This server is one of 13 in the bConnect MCP Suite. See the [suite README](../README.md) for the server list, the configuration reference and client-configuration examples, and [docs/INSTALLATION.md](../docs/INSTALLATION.md) for deployment options (Windows, Linux, Docker, HTTP gateway).

---

## Compatibility

| MCP server version | Supported bMS release | bConnect API | Notes |
|--------------------|-----------------------|--------------|-------|
| `26.1.8` | baramundi Management Suite 2026R1 | V2.0 | Current — TOK-22: the 33-tool matrix collapsed to `list_group_members` + `list_ad_user_endpoints`. **Breaking**: the 33 old tool names are gone |
| `26.1.7` | baramundi Management Suite 2026R1 | V2.0 | Previous — 33 separate tools |

> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
> Example: `26.1.8` targets bMS 2026R1; patch-only fixes increment the last digit.
