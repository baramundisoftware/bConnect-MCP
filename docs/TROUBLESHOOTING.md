# Troubleshooting — bConnect MCP Suite

Complete guide for diagnosing and resolving common issues with the bConnect MCP Suite (13 servers).

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
BCONNECT_RELEASE=26R1          # or 25R2
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

### Server Not Visible in Claude

MCP configuration must list each server individually. Example `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "command": "node",
      "args": ["/path/to/bconnect-endpoints-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms-server:443/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password",
        "BCONNECT_RELEASE": "26R1"
      }
    },
    "bconnect-assets": {
      "command": "node",
      "args": ["/path/to/bconnect-assets-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms-server:443/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password",
        "BCONNECT_RELEASE": "26R1"
      }
    }
  }
}
```

Add an entry for each server you want to use. Restart Claude after changes.

### Error: ".env file not found"

```bash
cp .env.example .env
# Edit .env with your credentials
```

### Wrong bMS Release

`bconnect-compliance-mcp` and `bconnect-universaldynamicgroups-mcp` are **26R1 only**. They will refuse to start with `BCONNECT_RELEASE=25R2`.

---

## MCP Tool Errors

### Error: "Tool not found"

The correct server is not loaded in Claude. Verify the MCP configuration includes the server that exposes the tool you need:

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
| Compliance (26R1) | `bconnect-compliance-mcp` |
| Universal Dynamic Groups (26R1) | `bconnect-universaldynamicgroups-mcp` |

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
# Unit tests across all 13 servers (root aggregate)
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
- [ ] `BCONNECT_RELEASE` matches your bMS version (`26R1` or `25R2`)
- [ ] TLS configured correctly (`BCONNECT_CA_CERT_PATH` or `NODE_TLS_REJECT_UNAUTHORIZED=0` for dev)
- [ ] Claude MCP config lists the correct server(s) for the domain you need
- [ ] Claude was restarted after config changes
- [ ] BMS server is reachable (ping / curl test)
- [ ] Port 443 is open (firewall)
- [ ] bConnect service is running on the BMS server
- [ ] GUIDs are in correct UUID format
- [ ] 26R1-only servers not used with `BCONNECT_RELEASE=25R2`

---

## Getting Help

- **README.md** — project overview and quick start
- **docs/DOCKER.md** — Docker deployment
- **docs/INSTALLATION.md** — full installation and TLS setup
- **bConnect-MCP support**: bernd.wiedemann@baramundi.de (bConnect-MCP is **not** supported through baramundi Support — see [../SUPPORT.md](../SUPPORT.md))
- **GitHub Issues**: open an issue in this repository

---

*bConnect MCP Suite v26.1.7 — 13 servers, 276 tools, bMS 26R1 / 25R2*
