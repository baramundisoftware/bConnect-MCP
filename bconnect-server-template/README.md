# bconnect-DOMAIN-mcp (server template)

Skeleton for a new bConnect MCP server. The steps to turn it into a real server are at the
top of `src/index.ts`. Copy this README along with the code and keep the environment table
below in sync with what the new server reads. A test compares the table with the variables
the server's `src/` and `@bconnect/mcp-core` actually read, and fails on any difference.

The connection settings (base URL, credentials, CA certificate, TLS, audit level, rate limit)
are read by `clientConfigFromEnv()` in `@bconnect/mcp-core`. Don't read them in the server.

## Environment Variables

Run inside the HTTP gateway, the server's own startup code doesn't run: `MCP_TRANSPORT`, `MCP_PORT`, `MCP_BIND` and `BCONNECT_SKIP_CONNECTIVITY_CHECK` then have no effect, and the gateway's own settings apply. The gateway reads `MCP_ALLOW_NO_AUTH` itself, for its own bind address.

<!-- env:start -->
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect base URL, e.g. `https://bms.corp.local:443/bconnect`. If unset, a placeholder is used and the startup check fails. |
| `BCONNECT_API_KEY` | One of | — | API key. Set this, or `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. Used instead of them when both are set. |
| `BCONNECT_USERNAME` | One of | — | User for Basic authentication, together with `BCONNECT_PASSWORD`. |
| `BCONNECT_PASSWORD` | One of | — | Password for `BCONNECT_USERNAME`. |
| `BCONNECT_CA_CERT_PATH` | No | — | PEM file with the CA certificate that signed the bMS server certificate (internal CA). When set, only this CA is trusted; when unset, Node's default and (Node 22.15 or later) the operating system's trusted CAs are used. The server fails if the file can't be read or is empty. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | verify | `0` turns certificate verification off for every TLS connection of the process. Development only; use `BCONNECT_CA_CERT_PATH` instead. |
| `BCONNECT_ALLOW_INSECURE_HTTP` | No | off | `true` allows an `http://` base URL to a host other than this machine, which sends the bConnect credentials unencrypted; the server warns once at startup. Test setups only. `http://` to `localhost`, `127.x.x.x` or `[::1]` (the bundled mock) needs no opt-in. |
| `ALLOW_WRITE_OPERATIONS` | No | off | `true` enables the tools that create, change or delete data, or start actions. |
| `ALLOW_SECRET_READ` | No | off | `true` lets the shared client call the BitLocker-secret and LAPS operations. This server has no tool that calls them, so the setting has no effect here. |
| `BCONNECT_RELEASE` | No | `26R1` | bMS release the server talks to, `26R1` or `25R2`. It selects the API documentation used to explain an error, e.g. what a 404 means for that call. |
| `BCONNECT_AUDIT_LEVEL` | No | `none` | `none`, `security`, `write` or `all`, in any case. Levels are cumulative: `security` records credential reads and changes (BitLocker, LAPS), `write` adds every write, `all` records every request. Any other value stops the server. Entries go to stderr. |
| `BCONNECT_RATE_LIMIT_ENABLED` | No | off | `true` limits the requests one client sends. Each tool call still creates a new client, so the limit doesn't apply across calls yet (#160). |
| `BCONNECT_RATE_LIMIT_MAX_REQUESTS` | No | `100` | Requests allowed per window when the rate limit is on. |
| `BCONNECT_RATE_LIMIT_WINDOW_MS` | No | `60000` | Window length in milliseconds. |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | No | off | `true` skips the startup connectivity check. |
| `MCP_TRANSPORT` | No | `stdio` | `http` serves MCP over HTTP instead of stdio. |
| `MCP_PORT` | No | `3000` | Port in HTTP mode. |
| `MCP_BIND` | No | `127.0.0.1` | Address to bind in HTTP mode. HTTP mode has no client authentication: keep it on loopback, or put an authenticating reverse proxy in front. |
| `MCP_ALLOW_NO_AUTH` | No | off | `true` allows binding HTTP mode to an address other than loopback, without authentication. Not recommended. |
<!-- env:end -->
