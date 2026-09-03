# Troubleshooting — bConnect MCP Suite

Complete guide for diagnosing and resolving common issues with the bConnect MCP Suite (14 servers).

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Build Errors](#build-errors)
3. [Authentication Errors](#authentication-errors)
4. [Network & Connection Errors](#network--connection-errors)
5. [API Errors (4xx / 5xx)](#api-errors-4xx--5xx)
6. [Configuration Issues](#configuration-issues)
7. [MCP Tool Errors](#mcp-tool-errors)
8. [Performance Issues](#performance-issues)
9. [Debugging Techniques](#debugging-techniques)
10. [Getting Help](#getting-help)

---

## Quick Diagnostics

### Check if a Server is Running

Each server is a standalone Node.js process. Example for `bconnect-endpoints-mcp`:

```bash
cd bconnect-endpoints-mcp
node build/index.js
```

Expected output: `bconnect-endpoints-mcp started on stdio`

### Verify Configuration

Each server reads its own `.env` (or inherits from environment). Required variables:

```env
BCONNECT_BASE_URL=https://your-bms-server:443/bconnect
BCONNECT_USERNAME=your-username
BCONNECT_PASSWORD=your-password
```

### Test API Connection Directly

```bash
curl -k -u "username:password" \
  "https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
```

---

## Build Errors

### Error: `TS2307: Cannot find module '@bconnect/mcp-core'`

**Cause:** You tried to build a **single server directory** (e.g. `cd bconnect-endpoints-mcp && npm ci && npm run build`). The suite is an npm workspaces monorepo — every server imports the shared `@bconnect/mcp-core` package, which must be built from the repo **root**, core first. A server directory cannot be built on its own.

**Solution:** Build from the repository root:

```bash
cd bConnect-MCP          # the repo root, NOT a server subdirectory
npm ci
npm run build -w @bconnect/mcp-core   # build the shared core first
npm run build                          # then all servers (or -w bconnect-endpoints-mcp for one)
```

> Prefer to skip building? Download the pre-built `bconnect-mcp-suite-<version>.zip` from the [Releases page](https://github.com/baramundisoftware/bConnect-MCP/releases) — it ships compiled output; just run `npm ci --omit=dev` at the extracted root.

---

## Authentication Errors

### Error: "Authentication failed. Check your username and password."

**Cause:** Invalid credentials (HTTP 401)

**Solutions:**

1. **Test credentials with curl:**
   ```bash
   curl -k -u "username:password" \
     "https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
   ```

2. **Check for special characters in password:**
   - Passwords with `$`, `` ` ``, `\`, `"` need escaping in `.env`
   - Use single quotes: `BCONNECT_PASSWORD='P@$$w0rd!'`

3. **Verify account status in baramundi console:**
   - Account not locked or expired
   - API access permissions are granted

### Error: "Access denied. Insufficient permissions for this operation."

**Cause:** User lacks required permissions (HTTP 403)

**Solutions:**

1. Check user permissions in the baramundi Management Console
2. Verify API access is enabled for the account
3. Use an administrator account for testing

### Error: "Token expired" or "Session timeout"

**Cause:** A long-running operation exceeded the request timeout.

**Solution:** Each request uses a fixed **30-second** timeout (not configurable via an env var). For large datasets, page through results with a smaller `PageSize` so each call completes well within the timeout instead of requesting everything at once.

---

## Network & Connection Errors

### Error: "Cannot connect to bConnect API."

**Cause:** Server unreachable or network issue

**Solutions:**

1. **Verify server is reachable:**
   ```bash
   ping your-bms-server
   curl -k https://your-bms-server:443/bconnect/
   ```

2. **Verify firewall:** Port 443 must be open between client and server.

3. **Wrong port?** 443 is the default, but bConnect can be configured on a different port. Older or test installations commonly use **444**. Confirm the port in the baramundi Management Center (bConnect settings) and make sure it matches the port in `BCONNECT_BASE_URL`. A `curl` to the wrong port typically hangs (timeout) or is refused.

4. **Check the URL path.** `BCONNECT_BASE_URL` must end in `/bconnect`
   (e.g. `https://your-bms-server:443/bconnect`).

### Error: "ECONNREFUSED" or "Connection refused"

Nothing is listening on the port in `BCONNECT_BASE_URL` (443 by default; some installations use 444 — see above). Check that the baramundi bConnect service is running on the BMS server and that the port matches:

```powershell
Get-Service | Where-Object {$_.Name -like "*baramundi*"}
```

### Error: "ETIMEDOUT" or "Request timeout"

Requests use a fixed 30-second timeout. If calls time out:

- Check network latency / reachability to the bMS server (the `curl` test above).
- Reduce `PageSize` and page through large result sets so each call returns quickly.

### Error: "SSL certificate verify failed", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN"

These mean the bMS server's certificate isn't trusted by the **Node.js process**. Node
does not read the OS/Windows trust store below Node 22.15, so an internally signed bMS
cert looks untrusted even when Windows itself trusts it. Pick one:

**1. Run on Node.js ≥ 22.15 (recommended, zero export).** The suite then honors the
machine's OS certificate store automatically — if the client already trusts the bMD/CA,
it just works. Check with `node --version`.

**2. Provide the CA explicitly (any Node version):**
```env
BCONNECT_CA_CERT_PATH=/path/to/bms-ca.pem
```
or, without changing the server config, use Node's own env var:
```env
NODE_EXTRA_CA_CERTS=/path/to/bms-ca.pem
```

**3. Development only** — disables all verification (never in production):
```env
NODE_TLS_REJECT_UNAUTHORIZED=0
```

See [INSTALLATION.md](INSTALLATION.md) → "TLS / SSL Configuration" for the full guide and
how to export the baramundi CA.

---

## API Errors (4xx / 5xx)

### 400 Bad Request

**Common causes:**

- Invalid GUID format — must be `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- Wrong parameter types — `PageSize` must be a number, not a string
- Missing required parameters

### 404 Not Found

The resource doesn't exist. List resources first to get a valid ID:
```
"List all endpoints" → find the correct ID → "Show me endpoint <ID>"
```

### 429 Too Many Requests

The bMS API is throttling requests. Reduce them by enabling the server's **outbound** rate limiter so it self-throttles its calls to bMS:
```env
BCONNECT_RATE_LIMIT_ENABLED=true
BCONNECT_RATE_LIMIT_MAX_REQUESTS=100
BCONNECT_RATE_LIMIT_WINDOW_MS=60000
```
Also reduce request volume — a smaller `PageSize` and fewer parallel calls.

### 500 / 503 Server Errors

Transient server-side errors. If persistent, check the bConnect service status:

```powershell
# On the BMS server
Get-EventLog -LogName Application -Source "baramundi*" -Newest 50
Get-Content "C:\ProgramData\baramundi\Logs\bConnect.log" -Tail 100
```

---

## Configuration Issues

### Server Not Visible in Your MCP Client

MCP configuration must list each server individually. The entry itself is the same for
every client — this one, with **no credentials in it** (`--env-file` points at the file
that holds them):

```json
{
  "bconnect-endpoints": {
    "type": "stdio",
    "command": "node",
    "args": [
      "--env-file=/path/to/bconnect.env",
      "/path/to/bconnect-endpoints-mcp/build/index.js"
    ]
  },
  "bconnect-assets": {
    "type": "stdio",
    "command": "node",
    "args": [
      "--env-file=/path/to/bconnect.env",
      "/path/to/bconnect-assets-mcp/build/index.js"
    ]
  }
}
```

What differs per client is the file, the key you wrap that in, and whether `"type"`
stays. **Almost every failure in this section is silent** — the client parses the file,
finds nothing it recognises, and shows you an empty tool list with no error:

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| VS Code shows no servers, no error | The block is under `mcpServers` | VS Code's top-level key in `.vscode/mcp.json` is **`servers`** |
| Claude Code fails to connect to a gateway/HTTP entry, or tries to run it as a command | The `url` entry has no `"type"` | Add `"type": "http"`. Claude Code reads a type-less entry as stdio |
| Continue loads nothing from the YAML file | The block was written as a map | Continue's `mcpServers` is a **list**, each item carrying its own `name:` |
| Cursor rejects the entry | `"type"` was copied in from a VS Code / Claude Code example | Cursor's own examples omit `type`; remote entries are identified by the presence of `url` |
| LibreChat starts but the server exits immediately | The stdio server runs on the **LibreChat host** | If LibreChat is in Docker, the suite must be inside that container or on a mounted path, and `librechat.yaml` must be in the project root and mounted into the API container |
| VS Code / Cursor / Claude Code show nothing, and the config file exists | The file is not in the workspace you have open | These are **per-project** files. `.mcp.json`, `.vscode/mcp.json` and `.cursor/mcp.json` are read relative to the opened folder |
| Claude Desktop still shows the old set after an edit | Window closed, not quit | Fully quit from the tray/menu-bar icon and relaunch |
| Claude Code lists the server as "Pending approval" | Project-scope servers need a one-time trust decision | Run `claude` in that directory and approve. This is a security control, not a fault |
| n8n / Open WebUI / Copilot Studio see no server | They have no stdio support at all | These reach the suite only through the HTTP gateway — see [INSTALLATION.md → Option C](INSTALLATION.md#option-c--gateway-http-multi-user) |
| Gateway returns `401 Missing bearer token` / `401 Invalid bearer token` | `Authorization: Bearer <token>` absent or not matching | Set the client's header to exactly `Bearer <MCP_GATEWAY_AUTH_TOKEN>` from `.env.gateway` |
| Gateway returns `405 Method Not Allowed` on GET | Something tried to open an SSE stream | The gateway serves **POST** Streamable HTTP only. An SSE-only client cannot connect |
| n8n connects, then times out or gets nothing | The node fell back to SSE against a streamable-only gateway | Check the MCP Client Tool node's transport setting; some n8n builds are reported to ignore the dropdown |

Full per-client file paths and shapes:
[INSTALLATION.md → Client Configuration](INSTALLATION.md#client-configuration).

Then reload the client — a window reload for VS Code and Cursor, a **full quit** (tray
or menu-bar icon → Quit) for Claude Desktop, a re-run in the project directory for
Claude Code. Clients configured through a web UI take effect when the server entry is
saved; there is no local file to reload.

### Error: ".env file not found"

```bash
cp .env.example .env
# Edit .env with your credentials
```

### Server exits: "requires baramundi Management Suite 26R1"

The whole suite is **26R1-only**. Every server reads the bMS version from
`GET /v2.0/ManagementServer` during its startup connectivity check and exits if it is older than
26R1, naming the version it detected. There is no compatibility setting — `BCONNECT_RELEASE` no
longer exists. Upgrade the bMS.

`BCONNECT_SKIP_CONNECTIVITY_CHECK=true` skips the probe and the version gate with it, for
deployments that legitimately cannot reach that route. It does not make the 26R1-only routes
exist, so tools that need them will still 404.

If the server instead **warns** that it could not parse the version and carries on, that is
intended: an unreadable version string is logged with what was received rather than treated as a
refusal.

### Error: a `*_industrial_endpoint` tool is not found

26R1 removed the IndustrialEndpoints bConnect API. The five industrial tools
(`list_`/`get_`/`create_`/`update_`/`delete_industrial_endpoint`) and the `industrial` member
type in `bconnect-groups-mcp` were removed with it, so calling one returns a message naming that
reason. There is no replacement — see
[MIGRATION-tool-surface.md](MIGRATION-tool-surface.md).

---

## MCP Tool Errors

### Error: "Tool not found"

The server that exposes the tool is not loaded in your client. Verify the MCP
configuration includes it — and if the client shows *no* bConnect tools at all, start
from [Server Not Visible in Your MCP Client](#server-not-visible-in-your-mcp-client)
above, because a mis-shaped config fails silently in most clients:

| Tool domain | Server |
|---|---|
| Endpoints | `bconnect-endpoints-mcp` |
| Assets | `bconnect-assets-mcp` |
| Jobs | `bconnect-jobs-mcp` |
| Groups | `bconnect-groups-mcp` |
| Active Directory | `bconnect-activedirectory-mcp` |
| Server Management | `bconnect-servermanagement-mcp` |
| Defense Control | `bconnect-defensecontrol-mcp` |
| Software | `bconnect-software-mcp` |
| Variables | `bconnect-variables-mcp` |
| Update Management | `bconnect-updatemanagement-mcp` |
| Operating Systems | `bconnect-operatingsystems-mcp` |
| Compliance | `bconnect-compliance-mcp` |
| Universal Dynamic Groups | `bconnect-universaldynamicgroups-mcp` |

### Error: "Invalid parameters for tool"

- GUIDs must be strings in `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` format
- `PageSize` must be a number, not a string
- Booleans must be `true`/`false`, not `"true"`/`"false"`

### Error: "Tool execution timeout"

Requests use a fixed 30-second timeout. Use pagination with a smaller `PageSize` for large datasets so each call returns well within it.

---

## Performance Issues

### Slow API Responses

```
❌ PageSize=1000  (slow)
✅ PageSize=50    (faster)
```

Use filters and specific queries to reduce result set size.

### Frequent Timeouts

- Use a smaller `PageSize` and page through results.
- Enable the outbound rate limiter (`BCONNECT_RATE_LIMIT_*`) if request bursts overload the bMS server.
- Check network latency between the MCP host and the bMS server.

---

## Debugging Techniques

### Test API Directly

```bash
# Test authentication
curl -v -k -u "username:password" \
  "https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1"

# Save response
curl -k -u "username:password" \
  "https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1" \
  -o response.json && cat response.json | jq .
```

### Enable Verbose Logging

```env
DEBUG=*
LOG_LEVEL=debug
```

### Run Tests

```bash
# Unit tests across all 14 servers (root aggregate)
npm test

# Per-server tests
cd bconnect-<domain>-mcp && npm test

# Build all servers + template
npm run build

# Audit all manifests for high-severity advisories
npm run audit
```

### Check BMS Server Logs

```powershell
# Windows Event Viewer
Get-EventLog -LogName Application -Source "baramundi*" -Newest 50

# bConnect log
Get-Content "C:\ProgramData\baramundi\Logs\bConnect.log" -Tail 100
```

### Monitor Network Traffic

```bash
sudo tcpdump -i any host your-bms-server and port 443 -A
```

---

## Common Mistake Checklist

- [ ] `.env` file exists and all required variables are set
- [ ] Credentials verified with curl
- [ ] `BCONNECT_BASE_URL` includes port (e.g. `:443`)
- [ ] bMS is **26R1 or later** (the suite refuses to start on anything older)
- [ ] TLS configured correctly (`BCONNECT_CA_CERT_PATH` or `NODE_TLS_REJECT_UNAUTHORIZED=0` for dev)
- [ ] The client's MCP config lists the correct server(s) for the domain you need
- [ ] The config is in the file **that client** reads, in the workspace it has open
- [ ] The top-level key matches the client (`servers` for VS Code, `mcpServers` for the rest)
- [ ] HTTP entries carry `"type": "http"` (Claude Code reads a type-less `url` as stdio)
- [ ] No credential is inside the client config — it belongs in the `--env-file` file
- [ ] The client was reloaded/restarted after config changes (Claude Desktop: full quit)
- [ ] Gateway users: `Authorization: Bearer <MCP_GATEWAY_AUTH_TOKEN>` on every request
- [ ] Gateway users: requests are **POST** — a GET on `/<domain>/mcp` is a `405`
- [ ] BMS server is reachable (ping / curl test)
- [ ] Port 443 is open (firewall)
- [ ] bConnect service is running on the BMS server
- [ ] GUIDs are in correct UUID format

---

## Getting Help

- **README.md** — project overview and quick start
- **docs/INSTALLATION.md** — full installation, per-client configuration, TLS setup
- **docs/DOCKER.md** — Docker deployment of the gateway
- **docs/N8N.md** — the gateway from n8n workflows, and per-domain context cost
- **docs/DATA-FLOW.md** — what estate data reaches the model, and what never leaves
- **Support contact**: see [../SUPPORT.md](../SUPPORT.md). bConnect-MCP is **not**
  supported through baramundi Support
- **GitHub Issues**: open an issue in this repository

---

*bConnect MCP Suite v26.1.8 — 14 servers, 141 tools by default (221 with `ALLOW_WRITE_OPERATIONS=true`), requires bMS 26R1 or later*
