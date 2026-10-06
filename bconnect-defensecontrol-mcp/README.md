# bconnect-defensecontrol-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Defense Control — BitLocker encryption, Local Admin (LAPS) credentials, and Microsoft Defender threat monitoring  
**Tools:** 13 (11 with `BCONNECT_RELEASE=25R2`)

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
`ALLOW_WRITE_OPERATIONS=true` is set: they still appear in the tool list, but each call is
refused. A write tool whose description ends with "Not yet verified against a live bMS." hasn't
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

> Tools marked **(26R1)** require `BCONNECT_RELEASE=26R1` and baramundi Management Suite 2026 R1 or later.

---

## Environment Variables

Run inside the HTTP gateway, the server's own startup code doesn't run: `MCP_TRANSPORT`, `MCP_PORT`, `MCP_BIND` and `BCONNECT_SKIP_CONNECTIVITY_CHECK` then have no effect, and the gateway's own settings apply. The gateway reads `MCP_ALLOW_NO_AUTH` itself, for its own bind address.

<!-- env:start -->
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect base URL, e.g. `https://bms.corp.local:443/bconnect`. Without it the server doesn't start. |
| `BCONNECT_API_KEY` | One of | — | API key. Set this, or `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. Used instead of them when both are set. |
| `BCONNECT_USERNAME` | One of | — | User for Basic authentication, together with `BCONNECT_PASSWORD`. Latin-1 characters only (e.g. `ö` works, `€` doesn't). |
| `BCONNECT_PASSWORD` | One of | — | Password for `BCONNECT_USERNAME`. ASCII characters only: bConnect's API rejects a password with `§`, an umlaut or `ß` (401) even though Windows accepts it, so such a password is refused at startup (in the gateway: on every tool call) before anything is sent. Use an ASCII-only password or an API key. |
| `BCONNECT_CA_CERT_PATH` | No | — | PEM file with the CA certificate that signed the bMS server certificate (internal CA). When set, only this CA is trusted; when unset, Node's default and (Node 22.15 or later) the operating system's trusted CAs are used. The server fails if the file can't be read or is empty. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | verify | Leave unset. `0` turns certificate verification off for every TLS connection of the process, so anyone in the network path can pose as the bMS and receive the credentials. Trust the CA instead: Node ≥ 22.15 (OS store) or `BCONNECT_CA_CERT_PATH`. |
| `BCONNECT_ALLOW_INSECURE_HTTP` | No | off | `true` allows an `http://` base URL to a host other than this machine, which sends the bConnect credentials unencrypted; the server warns once at startup. Test setups only. `http://` to `localhost`, `127.x.x.x` or `[::1]` (the bundled mock) needs no opt-in. |
| `BCONNECT_RELEASE` | No | `26R1` | The release of your bMS: `26R1` or `25R2`, spelt exactly so. It selects the tools and list filters for that release and the API documentation used to explain an error. With `25R2`, the tools marked **(26R1)** are hidden. |
| `ALLOW_WRITE_OPERATIONS` | No | off | `true` enables the tools that create, change or delete data, or start actions. |
| `ALLOW_SECRET_READ` | No | off | `true` lets tools return BitLocker recovery keys / PINs and LAPS passwords. Also needs `ALLOW_WRITE_OPERATIONS=true` for the write tools that return them. |
| `BCONNECT_AUDIT_LEVEL` | No | `none` | `none`, `security`, `write` or `all`, in any case. Levels are cumulative: `security` records security-relevant calls (credentials, API keys, rights, security groups and profiles, enrollments, restarts; see [docs/AUDIT.md](../docs/AUDIT.md)) and refused requests, `write` adds every write, `all` records every request. Any other value stops the server. Entries go to stderr. |
| `BCONNECT_RATE_LIMIT_ENABLED` | No | off | `true` limits the requests the server sends to bConnect, across all its tool calls; a call over the limit fails at once. |
| `BCONNECT_RATE_LIMIT_MAX_REQUESTS` | No | `100` | Requests allowed per window when the rate limit is on. |
| `BCONNECT_RATE_LIMIT_WINDOW_MS` | No | `60000` | Window length in milliseconds. |
| `BCONNECT_TIMEOUT_MS` | No | `30000` | How long to wait for bConnect's answer, in milliseconds, 1000 to 600000. A request that runs out says so ("didn't answer within …"). Any other value stops the server; in the gateway, every tool call reports it. |
| `BCONNECT_MAX_RETRIES` | No | `0` | Retries for read requests (GET) after a network error, a timeout or HTTP 502/503/504, 0 to 5. Write requests are never retried. A read can then take up to (retries + 1) × the timeout, e.g. 90 s with 2 retries and the default timeout; keep that below your MCP client's own timeout. Any other value stops the server; in the gateway, every tool call reports it. |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | No | off | `true` skips the startup connectivity check. |
| `MCP_TRANSPORT` | No | `stdio` | `http` serves MCP over HTTP instead of stdio. |
| `MCP_PORT` | No | `3000` | Port in HTTP mode. |
| `MCP_BIND` | No | `127.0.0.1` | Address to bind in HTTP mode. HTTP mode has no client authentication: keep it on loopback, or put an authenticating reverse proxy in front. |
| `MCP_ALLOWED_HOSTS` | No | — | HTTP mode answers only requests addressed to `localhost`, `127.0.0.1`, `[::1]` or a host name listed here (comma-separated, ports ignored); others get 403. |
| `MCP_ALLOW_NO_AUTH` | No | off | `true` allows binding HTTP mode to an address other than loopback, without authentication. Not recommended. |
<!-- env:end -->

---

## Part of the Suite

This server is one of 13 in the bConnect MCP Suite. See the [suite README](../README.md) for an
overview and [docs/INSTALLATION.md](../docs/INSTALLATION.md) for setup, including the HTTP gateway
that serves all 13 servers.

---

## Compatibility

Releases are numbered `26.1.x` and support **bMS 2026 R1 and 2025 R2**: set `BCONNECT_RELEASE`
to the release of your bMS (default `26R1`). See [CHANGELOG.md](../CHANGELOG.md) for what each
release changed.
