# bconnect-activedirectory-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Active Directory OUs, groups, users, and objects synchronized into baramundi Management Suite  
**Tools:** 16

---

## Quick Start

Build from the **repo root**: the server needs the shared `@bconnect/mcp-core` package, so a
server directory can't be built on its own.

```bash
npm ci
npm run build -w @bconnect/mcp-core
npm run build -w bconnect-activedirectory-mcp
```

Configure it in your MCP client's `env` block (below), or keep the credentials out of the
client's configuration with `node --env-file` ([docs/CLIENTS.md](../docs/CLIENTS.md)). A `.env`
file (copy `.env.example`) is read only when you start the server from `bconnect-activedirectory-mcp/` yourself; MCP
clients start it from another directory.

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_API_KEY=<api-key>          # or BCONNECT_USERNAME + BCONNECT_PASSWORD
# Optional: BCONNECT_CA_CERT_PATH=/path/to/internal-ca.pem
```

Claude Code:

```bash
claude mcp add bconnect-activedirectory --scope user \
  --env BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect \
  --env BCONNECT_API_KEY=<api-key> \
  -- node /absolute/path/to/bconnect-activedirectory-mcp/build/index.js
```

Claude Desktop (`claude_desktop_config.json`) and other clients: see
[docs/CLIENTS.md](../docs/CLIENTS.md).

---

## Available Tools

All tools are read-only.

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

## Environment Variables

The variables this server reads (a test checks the list). Each is described, with its default, in [docs/CONFIGURATION.md](../docs/CONFIGURATION.md); the second column says only what is different in this server. When the HTTP gateway hosts the server, `MCP_TRANSPORT`, `MCP_PORT`, `MCP_BIND` and `MCP_ALLOWED_HOSTS` have no effect, `ALLOW_SECRET_READ` is ignored (always off), and the gateway's own settings apply ([Gateway](../docs/CONFIGURATION.md#gateway)).

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
| [`ALLOW_SECRET_READ`](../docs/CONFIGURATION.md#allow_secret_read) | No effect: this server has no tool that returns secrets. |
| [`BCONNECT_RELEASE`](../docs/CONFIGURATION.md#bconnect_release) |  |
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
