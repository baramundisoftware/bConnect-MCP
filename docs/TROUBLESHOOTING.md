# Troubleshooting — bConnect MCP Suite

Complete guide for diagnosing and resolving common issues with the bConnect MCP Suite (13 servers).

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Authentication Errors](#authentication-errors)
3. [Network & Connection Errors](#network--connection-errors)
4. [API Errors (4xx / 5xx)](#api-errors-4xx--5xx)
5. [Configuration Issues](#configuration-issues)
6. [MCP Tool Errors](#mcp-tool-errors)
7. [Performance Issues](#performance-issues)
8. [Debugging Techniques](#debugging-techniques)
9. [Getting Help](#getting-help)

---

## Quick Diagnostics

### Check if a Server is Running

Each server is a standalone Node.js process. Example for `bconnect-endpoints-mcp`:

```bash
cd bconnect-endpoints-mcp
node build/index.js
```

Expected output: `bconnect-endpoints-mcp running on stdio`

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

### Error: "SSL certificate verify failed" or "CERT_HAS_EXPIRED"

**For development only:**
```env
NODE_TLS_REJECT_UNAUTHORIZED=0
```

**For production (recommended):** Provide the CA certificate:
```env
BCONNECT_CA_CERT_PATH=/path/to/bms-ca.pem
```

See [INSTALLATION.md](INSTALLATION.md) for the full TLS setup guide.

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
