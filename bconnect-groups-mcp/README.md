# bconnect-groups-mcp

Part of the **bConnect MCP Suite** — exposes the baramundi bConnect V2.0 REST API to AI assistants via the Model Context Protocol.

**Domain:** Group-scoped endpoint queries — list endpoints by logical, static, dynamic, and universal dynamic groups, and by AD user  
**Tools:** 30 (33 on bMS 25R2)

---

## Quick Start

Build from the **repo root**: the server needs the shared `@bconnect/mcp-core` package, so a
server directory can't be built on its own.

```bash
npm ci
npm run build -w @bconnect/mcp-core
npm run build -w bconnect-groups-mcp
```

Configure it in your MCP client's `env` block (below), or keep the credentials out of the
client's configuration with `node --env-file` ([docs/CLIENTS.md](../docs/CLIENTS.md)). A `.env`
file (copy `.env.example`) is read only when you start the server from `bconnect-groups-mcp/` yourself; MCP
clients start it from another directory.

```env
BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect
BCONNECT_API_KEY=<api-key>          # or BCONNECT_USERNAME + BCONNECT_PASSWORD
# Optional: BCONNECT_CA_CERT_PATH=/path/to/internal-ca.pem
```

Claude Code:

```bash
claude mcp add bconnect-groups --scope user \
  --env BCONNECT_BASE_URL=https://<your-bms-server>:443/bconnect \
  --env BCONNECT_API_KEY=<api-key> \
  -- node /absolute/path/to/bconnect-groups-mcp/build/index.js
```

Claude Desktop (`claude_desktop_config.json`) and other clients: see
[docs/CLIENTS.md](../docs/CLIENTS.md).

---

## Available Tools

All tools are read-only.

| Tool | Description |
|------|-------------|
| `list_endpoints_by_logical_group` | List all endpoints in a logical group |
| `list_android_endpoints_by_logical_group` | List Android endpoints in a logical group |
| `list_ios_endpoints_by_logical_group` | List iOS endpoints in a logical group |
| `list_linux_endpoints_by_logical_group` | List Linux endpoints in a logical group |
| `list_mac_endpoints_by_logical_group` | List macOS endpoints in a logical group |
| `list_network_endpoints_by_logical_group` | List network endpoints in a logical group |
| `list_windows_endpoints_by_logical_group` | List Windows endpoints in a logical group |
| `list_industrial_endpoints_by_logical_group` | **(25R2)** List industrial endpoints in a logical group |
| `list_logical_groups_by_logical_group` | List child logical groups of a parent logical group |
| `list_endpoints_by_static_group` | List all endpoints in a static group |
| `list_android_endpoints_by_static_group` | List Android endpoints in a static group |
| `list_ios_endpoints_by_static_group` | List iOS endpoints in a static group |
| `list_linux_endpoints_by_static_group` | List Linux endpoints in a static group |
| `list_mac_endpoints_by_static_group` | List macOS endpoints in a static group |
| `list_network_endpoints_by_static_group` | List network endpoints in a static group |
| `list_windows_endpoints_by_static_group` | List Windows endpoints in a static group |
| `list_industrial_endpoints_by_static_group` | **(25R2)** List industrial endpoints in a static group |
| `list_endpoints_by_dynamic_group` | List all endpoints in a dynamic group |
| `list_windows_endpoints_by_dynamic_group` | List Windows endpoints in a dynamic group |
| `list_endpoints_by_universal_dynamic_group` | List all endpoints in a universal dynamic group |
| `list_android_endpoints_by_universal_dynamic_group` | List Android endpoints in a universal dynamic group |
| `list_ios_endpoints_by_universal_dynamic_group` | List iOS endpoints in a universal dynamic group |
| `list_linux_endpoints_by_universal_dynamic_group` | List Linux endpoints in a universal dynamic group |
| `list_mac_endpoints_by_universal_dynamic_group` | List macOS endpoints in a universal dynamic group |
| `list_network_endpoints_by_universal_dynamic_group` | List network endpoints in a universal dynamic group |
| `list_windows_endpoints_by_universal_dynamic_group` | List Windows endpoints in a universal dynamic group |
| `list_industrial_endpoints_by_universal_dynamic_group` | **(25R2)** List industrial endpoints in a universal dynamic group |
| `list_endpoints_by_ad_user` | List all endpoints associated with an AD user |
| `list_android_endpoints_by_ad_user` | List Android endpoints associated with an AD user |
| `list_ios_endpoints_by_ad_user` | List iOS endpoints associated with an AD user |
| `list_linux_endpoints_by_ad_user` | List Linux endpoints associated with an AD user |
| `list_mac_endpoints_by_ad_user` | List macOS endpoints associated with an AD user |
| `list_windows_endpoints_by_ad_user` | List Windows endpoints associated with an AD user |

---

> Tools marked **(25R2)** exist only in bMS 2025 R2: 2026 R1 removed the industrial-endpoint API, so the server lists them only on 25R2.

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
| `ALLOW_SECRET_READ` | No | off | `true` lets the shared client call the BitLocker-secret and LAPS operations. This server has no tool that calls them, so the setting has no effect here. |
| `BCONNECT_RELEASE` | No | `26R1` | Fallback for the release of your bMS: `26R1` or `25R2`, spelt exactly so. The server reads the release from the bMS at startup and uses this value only when it can't; a different value is overridden, with a warning. The release selects the tools and list filters for that release and the API documentation used to explain an error. |
| `BCONNECT_AUDIT_LEVEL` | No | `none` | `none`, `security`, `write` or `all`, in any case. Levels are cumulative: `security` records security-relevant calls (credentials, API keys, rights, security groups and profiles, enrollments, restarts; see [docs/AUDIT.md](../docs/AUDIT.md)) and refused requests, `write` adds every write, `all` records every request. Any other value stops the server. Entries go to stderr. |
| `BCONNECT_PRETTY_JSON` | No | `false` | `true` writes tool results as indented JSON, as earlier versions did, for debugging. By default they are compact JSON, which keeps 16–22 % of each result out of the model's context (measured on list results). `true` or `false`, in any case; any other value stops the server. |
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

Releases are numbered `26.1.x` and support **bMS 2026 R1 and 2025 R2**. The server reads the
release from the bMS at startup (`version` of the management server; the account needs read access
to server management) and logs it; `BCONNECT_RELEASE` is the fallback when it can't (default `26R1`). See [CHANGELOG.md](../CHANGELOG.md) for what each
release changed.
