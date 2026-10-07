# bconnect-defensecontrol-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Defense Control — BitLocker encryption, Local Admin (LAPS) credentials, and Microsoft Defender threat monitoring  
**Tools:** 13 (11 on bMS 25R2)

---

## Quick Start

Build from the **repo root**: the server needs the shared `@bconnect/mcp-core` package, so a
server directory can't be built on its own.

```bash
npm ci
npm run build -w @bconnect/mcp-core
npm run build -w bconnect-defensecontrol-mcp
```

Configure it in your MCP client's `env` block (below), or keep the credentials out of the
client's configuration with `node --env-file` ([docs/CLIENTS.md](../docs/CLIENTS.md)). A `.env`
file (copy `.env.example`) is read only when you start the server from `bconnect-defensecontrol-mcp/` yourself; MCP
clients start it from another directory.

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_API_KEY=<api-key>          # or BCONNECT_USERNAME + BCONNECT_PASSWORD
# Optional: BCONNECT_CA_CERT_PATH=/path/to/internal-ca.pem
```

Claude Code:

```bash
claude mcp add bconnect-defensecontrol --scope user \
  --env BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect \
  --env BCONNECT_API_KEY=<api-key> \
  -- node /absolute/path/to/bconnect-defensecontrol-mcp/build/index.js
```

Claude Desktop (`claude_desktop_config.json`) and other clients: see
[docs/CLIENTS.md](../docs/CLIENTS.md).

---

## Available Tools

Write tools (create, update, delete, start, assign, …) are **off** unless
`ALLOW_WRITE_OPERATIONS=true` is set. While they are off, the tool list leaves them out, which
keeps their descriptions out of the model's context, and a call by name is refused. A write tool whose description ends with "Not yet verified against a live bMS." hasn't
been checked against a real bMS yet.

`get_bitlocker_secrets`, `update_bitlocker_pin`, `get_local_admin_accounts` and
`patch_local_admin_user_credentials` return live credentials and also need
`ALLOW_SECRET_READ=true`.

| Tool | Description |
|------|-------------|
| `list_bitlocker_windows_endpoints` | List all Windows endpoints with BitLocker status |
| `get_bitlocker_windows_endpoint` | Get BitLocker status for a specific endpoint |
| `get_bitlocker_secrets` | **(26R1)** Get BitLocker recovery keys and startup PIN |
| `update_bitlocker_pin` | **(26R1)** Update the BitLocker startup PIN for an endpoint |
| `get_local_admin_accounts` | Get LAPS-managed local admin credentials for an endpoint |
| `patch_local_admin_user_credentials` | Set the requested expiration date of the local admin account (a past date makes the client generate new credentials) |
| `refresh_local_admin_account_expiry` | Ask an online client to apply the requested local admin expiration date now (was `trigger_update_on_client`) |
| `list_defender_threats` | List all Defender threat detections across endpoints |
| `get_defender_threat` | Get details of a specific Defender threat by GUID |
| `list_defender_threats_by_endpoint` | List Defender threats for a specific endpoint |
| `list_defender_threats_by_logical_group` | List Defender threats for a logical group's endpoints |
| `list_defender_windows_endpoints` | List all endpoints with Defender status |
| `get_defender_windows_endpoint` | Get Defender status for a specific endpoint |

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
| [`ALLOW_SECRET_READ`](../docs/CONFIGURATION.md#allow_secret_read) | Needed by the four tools that read or set BitLocker secrets or LAPS passwords; the two that set them also need `ALLOW_WRITE_OPERATIONS`. |
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
