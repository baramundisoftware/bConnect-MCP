# bconnect-operatingsystems-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** OS inventories and folders — operating system folder hierarchy and Windows endpoint OS installation configurations  
**Tools:** 9

---

## Quick Start

Build from the **repo root**: the server needs the shared `@bconnect/mcp-core` package, so a
server directory can't be built on its own.

```bash
npm ci
npm run build -w @bconnect/mcp-core
npm run build -w bconnect-operatingsystems-mcp
```

Configure it in your MCP client's `env` block (below), or copy `.env.example` to `.env` in
`bconnect-operatingsystems-mcp/`: a `.env` file is read from the directory the server is started in.

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_API_KEY=<api-key>          # or BCONNECT_USERNAME + BCONNECT_PASSWORD
# Optional: BCONNECT_CA_CERT_PATH=/path/to/internal-ca.pem
```

Claude Code:

```bash
claude mcp add bconnect-operatingsystems --scope user \
  --env BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect \
  --env BCONNECT_API_KEY=<api-key> \
  -- node /absolute/path/to/bconnect-operatingsystems-mcp/build/index.js
```

Claude Desktop (`claude_desktop_config.json`) and other clients: see
[docs/CLIENTS.md](../docs/CLIENTS.md).

---

## Available Tools

Write tools (create, update, delete, start, assign, …) are **off** unless
`ALLOW_WRITE_OPERATIONS=true` is set: they still appear in the tool list, but each call is
refused. A write tool whose description ends with "Not yet verified against a live bMS." hasn't
been checked against a real bMS yet.

| Tool | Description |
|------|-------------|
| `list_os_folders` | List all OS folders in baramundi |
| `get_os_folder` | Get details of a specific OS folder by GUID |
| `list_os_folders_by_folder` | List sub-folders within a specific OS folder |
| `list_os_windows_endpoints` | List all Windows endpoints with OS install info |
| `get_os_windows_endpoint` | Get OS install configuration for a specific endpoint |
| `create_os_folder` | Create a new OS folder |
| `update_os_folder` | Update an OS folder via JSON Patch |
| `delete_os_folder` | Delete an OS folder by GUID |
| `update_os_windows_endpoint` | Update OS install configuration for a Windows endpoint |

---

## Environment Variables

Run inside the HTTP gateway, the server's own startup code doesn't run: `MCP_TRANSPORT`, `MCP_PORT`, `MCP_BIND` and `BCONNECT_SKIP_CONNECTIVITY_CHECK` then have no effect, and the gateway's own settings apply. The gateway reads `MCP_ALLOW_NO_AUTH` itself, for its own bind address.

<!-- env:start -->
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect base URL, e.g. `https://bms.corp.local:443/bconnect`. If unset, a placeholder is used and the startup check fails. |
| `BCONNECT_API_KEY` | One of | — | API key. Set this, or `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. Used instead of them when both are set. |
| `BCONNECT_USERNAME` | One of | — | User for Basic authentication, together with `BCONNECT_PASSWORD`. Latin-1 characters only (e.g. `ö` works, `€` doesn't). |
| `BCONNECT_PASSWORD` | One of | — | Password for `BCONNECT_USERNAME`. ASCII characters only: bConnect's API rejects a password with `§`, an umlaut or `ß` (401) even though Windows accepts it, so such a password is refused at startup (in the gateway: on every tool call) before anything is sent. Use an ASCII-only password or an API key. |
| `BCONNECT_CA_CERT_PATH` | No | — | PEM file with the CA certificate that signed the bMS server certificate (internal CA). When set, only this CA is trusted; when unset, Node's default and (Node 22.15 or later) the operating system's trusted CAs are used. The server fails if the file can't be read or is empty. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | verify | Leave unset. `0` turns certificate verification off for every TLS connection of the process, so anyone in the network path can pose as the bMS and receive the credentials. Trust the CA instead: Node ≥ 22.15 (OS store) or `BCONNECT_CA_CERT_PATH`. |
| `BCONNECT_ALLOW_INSECURE_HTTP` | No | off | `true` allows an `http://` base URL to a host other than this machine, which sends the bConnect credentials unencrypted; the server warns once at startup. Test setups only. `http://` to `localhost`, `127.x.x.x` or `[::1]` (the bundled mock) needs no opt-in. |
| `ALLOW_WRITE_OPERATIONS` | No | off | `true` enables the tools that create, change or delete data, or start actions. |
| `ALLOW_SECRET_READ` | No | off | `true` lets the shared client call the BitLocker-secret and LAPS operations. This server has no tool that calls them, so the setting has no effect here. |
| `BCONNECT_RELEASE` | No | `26R1` | The release of your bMS: `26R1` or `25R2`, spelt exactly so. It selects the tools and list filters for that release and the API documentation used to explain an error. |
| `BCONNECT_AUDIT_LEVEL` | No | `none` | `none`, `security`, `write` or `all`, in any case. Levels are cumulative: `security` records security-relevant calls (credentials, API keys, rights, security groups and profiles, enrollments, restarts; see [docs/AUDIT.md](../docs/AUDIT.md)) and refused requests, `write` adds every write, `all` records every request. Any other value stops the server. Entries go to stderr. |
| `BCONNECT_RATE_LIMIT_ENABLED` | No | off | `true` limits the requests one client sends. Each tool call still creates a new client, so the limit doesn't apply across calls yet (#160). |
| `BCONNECT_RATE_LIMIT_MAX_REQUESTS` | No | `100` | Requests allowed per window when the rate limit is on. |
| `BCONNECT_RATE_LIMIT_WINDOW_MS` | No | `60000` | Window length in milliseconds. |
| `BCONNECT_TIMEOUT_MS` | No | `30000` | How long to wait for bConnect's answer, in milliseconds, 1000 to 600000. A request that runs out says so ("didn't answer within …"). Any other value stops the server; in the gateway, every tool call reports it. |
| `BCONNECT_MAX_RETRIES` | No | `0` | Retries for read requests (GET) after a network error, a timeout or HTTP 502/503/504, 0 to 5. Write requests are never retried. A read can then take up to (retries + 1) × the timeout, e.g. 90 s with 2 retries and the default timeout; keep that below your MCP client's own timeout. Any other value stops the server; in the gateway, every tool call reports it. |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | No | off | `true` skips the startup connectivity check. |
| `MCP_TRANSPORT` | No | `stdio` | `http` serves MCP over HTTP instead of stdio. |
| `MCP_PORT` | No | `3000` | Port in HTTP mode. |
| `MCP_BIND` | No | `127.0.0.1` | Address to bind in HTTP mode. HTTP mode has no client authentication: keep it on loopback, or put an authenticating reverse proxy in front. |
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
