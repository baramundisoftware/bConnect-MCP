# bconnect-assets-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Asset inventory — assets, asset types, and asset stock/type folders  
**Tools:** 26 (24 on bMS 25R2)

---

## Quick Start

Build from the **repo root**: the server needs the shared `@bconnect/mcp-core` package, so a
server directory can't be built on its own.

```bash
npm ci
npm run build -w @bconnect/mcp-core
npm run build -w bconnect-assets-mcp
```

Configure it in your MCP client's `env` block (below), or keep the credentials out of the
client's configuration with `node --env-file` ([docs/CLIENTS.md](../docs/CLIENTS.md)). A `.env`
file (copy `.env.example`) is read only when you start the server from `bconnect-assets-mcp/` yourself; MCP
clients start it from another directory.

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_API_KEY=<api-key>          # or BCONNECT_USERNAME + BCONNECT_PASSWORD
# Optional: BCONNECT_CA_CERT_PATH=/path/to/internal-ca.pem
```

Claude Code:

```bash
claude mcp add bconnect-assets --scope user \
  --env BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect \
  --env BCONNECT_API_KEY=<api-key> \
  -- node /absolute/path/to/bconnect-assets-mcp/build/index.js
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
| `list_assets` | List all assets in baramundi |
| `create_asset` | Create a new asset |
| `get_asset` | Get details of a specific asset by GUID |
| `update_asset` | Update asset fields via JSON Patch |
| `delete_asset` | Permanently delete an asset by GUID |
| `list_assets_in_asset_stock` | List assets in the asset stock container |
| `list_assets_by_logical_group` | List assets assigned to a logical group's endpoints |
| `list_assets_by_windows_endpoint` | List assets assigned to a specific Windows endpoint |
| `list_asset_stock_folders` | List all asset stock folders |
| `create_asset_stock_folder` | Create a new asset stock folder |
| `get_asset_stock_folder` | Get details of a specific asset stock folder |
| `update_asset_stock_folder` | Update an asset stock folder via JSON Patch |
| `delete_asset_stock_folder` | Permanently delete an asset stock folder |
| `list_asset_stock_subfolders` | List child folders within an asset stock folder |
| `list_asset_type_folders` | List all asset type folders |
| `create_asset_type_folder` | Create a new asset type folder |
| `get_asset_type_folder` | Get details of a specific asset type folder |
| `update_asset_type_folder` | Update an asset type folder via JSON Patch |
| `delete_asset_type_folder` | Permanently delete an asset type folder |
| `list_asset_type_subfolders` | List child folders within an asset type folder |
| `list_asset_types` | List all asset types defined in baramundi |
| `create_asset_type` | Create a new asset type |
| `get_asset_type` | Get details of a specific asset type by GUID |
| `delete_asset_type` | Permanently delete an asset type by GUID |
| `list_assets_by_org_unit` | **(26R1)** List assets for endpoints within an OU |
| `list_assets_by_ad_object` | **(26R1)** List assets assigned to an AD object |

> Tools marked **(26R1)** need baramundi Management Suite 2026 R1 or later; the server lists them only when the bMS release it detects (or `BCONNECT_RELEASE`, as fallback) is 26R1.

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
| [`BCONNECT_RELEASE`](../docs/CONFIGURATION.md#bconnect_release) | On 25R2 the tools marked **(26R1)** aren't listed. |
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
