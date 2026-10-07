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
| `BCONNECT_RELEASE` | No | `26R1` | Fallback for the release of your bMS: `26R1` or `25R2`, spelt exactly so. The server reads the release from the bMS at startup and uses this value only when it can't; a different value is overridden, with a warning. The release selects the tools and list filters for that release and the API documentation used to explain an error. On 25R2, the tools marked **(26R1)** are not listed. |
| `ALLOW_WRITE_OPERATIONS` | No | off | `true` enables the tools that create, change or delete data, or start actions. Off, they are left out of the tool list and refused when called. |
| `ALLOW_SECRET_READ` | No | off | `true` lets the shared client call the BitLocker-secret and LAPS operations. This server has no tool that calls them, so the setting has no effect here. |
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
