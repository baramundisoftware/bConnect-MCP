# bconnect-endpoints-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Managed endpoints — Windows, Linux, macOS, Android, iOS, network, and industrial devices  
**Tools:** 32 (25 on bMS 25R2)

---

## Quick Start

Build from the **repo root**: the server needs the shared `@bconnect/mcp-core` package, so a
server directory can't be built on its own.

```bash
npm ci
npm run build -w @bconnect/mcp-core
npm run build -w bconnect-endpoints-mcp
```

Configure it in your MCP client's `env` block (below), or keep the credentials out of the
client's configuration with `node --env-file` ([docs/CLIENTS.md](../docs/CLIENTS.md)). A `.env`
file (copy `.env.example`) is read only when you start the server from `bconnect-endpoints-mcp/` yourself; MCP
clients start it from another directory.

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_API_KEY=<api-key>          # or BCONNECT_USERNAME + BCONNECT_PASSWORD
# Optional: BCONNECT_CA_CERT_PATH=/path/to/internal-ca.pem
```

Claude Code:

```bash
claude mcp add bconnect-endpoints --scope user \
  --env BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect \
  --env BCONNECT_API_KEY=<api-key> \
  -- node /absolute/path/to/bconnect-endpoints-mcp/build/index.js
```

Claude Desktop (`claude_desktop_config.json`) and other clients: see
[docs/CLIENTS.md](../docs/CLIENTS.md).

---

## Available Tools

Write tools (create, update, delete, start, assign, …) are **off** unless
`ALLOW_WRITE_OPERATIONS=true` is set. While they are off, the tool list leaves them out, which
keeps their descriptions out of the model's context, and a call by name is refused. A write tool whose description ends with "Not yet verified against a live bMS." hasn't
been checked against a real bMS yet.

Tools that differ only by device type are one tool with a `type` argument: the API's endpoint
type names (`WindowsEndpoint`, `MacEndpoint`, `LinuxEndpoint`, `AndroidEndpoint`, `IOSEndpoint`,
`NetworkEndpoint`; `IndustrialEndpoint` on bMS 25R2 only), the same values as the `type` field of
the results. The tool list offers only the values the connected bMS release has, and each
type-specific filter or field says which types take it. A call with a filter or field the chosen
type doesn't have is refused before anything is sent.

| Tool | Description |
|------|-------------|
| `list_endpoints` | List endpoints, one page at a time; `type` (optional) for one device type and its own filters |
| `get_endpoint` | Get an endpoint by GUID; `type` (optional) for the type-specific details |
| `delete_endpoint` | Delete an endpoint by GUID; `type` (optional) to delete through that type's route |
| `update_endpoint` | Update an endpoint of the given `type` (JSON Patch of the fields given) |
| `start_enrollment` | Start the enrollment of an endpoint of the given `type` (Windows, Mac, Android, iOS) |
| `list_endpoints_by_logical_group` | List the endpoints of a logical group; `type` (optional): `WindowsEndpoint` |
| `create_windows_endpoint` | Create a new Windows endpoint |
| `create_linux_endpoint` | Create a new Linux endpoint |
| `create_mac_endpoint` | Create a new macOS endpoint |
| `create_android_endpoint` | Create a new Android endpoint |
| `create_ios_endpoint` | Create a new iOS endpoint |
| `create_network_endpoint` | Create a new network endpoint |
| `create_industrial_endpoint` | **(25R2)** Create a new industrial endpoint (PLC, SCADA) |
| `trigger_intune_installation` | Trigger the baramundi Agent installation via Intune (Windows) |
| `list_logical_groups` | List logical groups |
| `get_logical_group` | Get details of a specific logical group |
| `create_logical_group` | Create a new logical group |
| `update_logical_group` | Update an existing logical group |
| `delete_logical_group` | Delete a logical group by GUID |
| `get_maintenance_window_for_endpoint` | Get the maintenance window for an endpoint |
| `create_maintenance_window_for_endpoint` | Create a maintenance window for an endpoint |
| `update_maintenance_window_for_endpoint` | **(26R1)** Update a maintenance window for an endpoint |
| `delete_maintenance_window_for_endpoint` | Delete a maintenance window for an endpoint |
| `get_maintenance_window_for_logical_group` | Get the maintenance window for a logical group |
| `create_maintenance_window_for_logical_group` | Create a maintenance window for a logical group |
| `update_maintenance_window_for_logical_group` | **(26R1)** Update a maintenance window for a logical group |
| `delete_maintenance_window_for_logical_group` | Delete a maintenance window for a logical group |
| `list_unmanaged_endpoints` | **(26R1)** List all unmanaged detected endpoints |
| `get_unmanaged_endpoint` | **(26R1)** Get details of an unmanaged endpoint |
| `delete_unmanaged_endpoint` | **(26R1)** Delete an unmanaged endpoint record |
| `get_entra_id_data` | **(26R1)** Get Microsoft Entra ID data by its Entra ID device ID (not the bMS endpoint ID) |
| `link_entra_id_data` | **(26R1)** Link an EntraID device to a baramundi endpoint |
| `unlink_entra_id_data` | **(26R1)** Unlink EntraID data from an endpoint |

The per-type tools of earlier versions (`list_windows_endpoints`, `get_mac_endpoint`,
`update_android_endpoint`, `start_ios_enrollment`, …) and `search_endpoints` /
`list_group_endpoints` are gone; calling one returns the tool and argument that replace it. The
full mapping is in the [CHANGELOG](../CHANGELOG.md).

> Tools marked **(26R1)** need baramundi Management Suite 2026 R1 or later; the server lists them only when the bMS release it detects (or `BCONNECT_RELEASE`, as fallback) is 26R1.
> Tools marked **(25R2)** exist only in bMS 2025 R2: 2026 R1 removed the industrial-endpoint API (so does the `IndustrialEndpoint` type). Updating a maintenance window needs 26R1: 25R2 updates with `PUT`, and its API specification describes that request in two contradicting ways, so the update tools aren't offered on 25R2 until a 25R2 bMS confirms it (declared in `src/unsupported-operations.ts`). Creating one works in both releases with that release's window types: 25R2 `Unrestricted` (the default, no intervals), `Everyday`, `WorkdayWeekend`, `IndividualWeekday`; 26R1 `Anytime` (the default) and `Never` (both without intervals) instead of `Unrestricted`, plus the same three. A type the release doesn't have is refused before anything is sent.

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
| [`BCONNECT_RELEASE`](../docs/CONFIGURATION.md#bconnect_release) | On 25R2 the tools marked **(26R1)** aren't listed, on 26R1 those marked **(25R2)**. |
| [`ALLOW_WRITE_OPERATIONS`](../docs/CONFIGURATION.md#allow_write_operations) |  |
| [`ALLOW_SECRET_READ`](../docs/CONFIGURATION.md#allow_secret_read) | No effect: this server has no tool that returns secrets. |
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
