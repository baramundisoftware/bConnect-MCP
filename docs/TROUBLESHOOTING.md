# Troubleshooting — bConnect MCP Suite

Complete guide for diagnosing and resolving common issues with the bConnect MCP Suite (13 servers).

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Server Exits at Startup](#server-exits-at-startup)
3. [Build Errors](#build-errors)
4. [Authentication Errors](#authentication-errors)
5. [Network & Connection Errors](#network--connection-errors)
6. [API Errors (4xx / 5xx)](#api-errors-4xx--5xx)
7. [Configuration Issues](#configuration-issues)
8. [MCP Tool Errors](#mcp-tool-errors)
9. [Refused Calls](#refused-calls)
10. [Performance Issues](#performance-issues)
11. [Debugging Techniques](#debugging-techniques)
12. [Getting Help](#getting-help)

---

## Quick Diagnostics

### Check if a Server is Running

Each server is a standalone Node.js process. Example for `bconnect-endpoints-mcp`:

```bash
cd bconnect-endpoints-mcp
node build/index.js
```

Expected output (on stderr), once the startup check has reached bConnect:

```text
bconnect-endpoints-mcp: verifying bConnect API connectivity...
bconnect-endpoints-mcp: API connectivity verified.
bconnect-endpoints-mcp started on stdio
```

If the check fails, the server prints `Connection test failed: …` and
`bconnect-endpoints-mcp: cannot reach bConnect API at <url>. Check BCONNECT_BASE_URL, credentials, and network.`
and exits. The `Connection test failed` line names the cause (wrong credentials, untrusted
certificate, timeout, unreachable host); the sections below explain each one.

### Verify Configuration

A server reads the environment it is started with, plus a `.env` file in the **current working
directory** (not the server's directory). Claude Desktop and Claude Code start servers from another
directory, so for them put the variables in the client configuration's `env` block. Needed:

```env
BCONNECT_BASE_URL=https://your-bms-server:443/bconnect
BCONNECT_API_KEY=your-api-key           # or BCONNECT_USERNAME + BCONNECT_PASSWORD
BCONNECT_RELEASE=26R1                   # optional, default 26R1; 25R2 for a 25R2 bMS
```

### Test API Connection Directly

```bash
curl --cacert /path/to/bms-ca.pem -u "username" -w '\nHTTP %{http_code}\n' \
  "https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
```

curl asks for the password, so it doesn't end up in your shell history. With an API key,
use `-H "X-Api-Key: <key>"` instead of `-u`. Leave out `--cacert` if your system already
trusts the bMS certificate. Don't add `-k`: it skips the certificate check, so curl would
succeed where the MCP servers fail.

---

## Server Exits at Startup

A server checks its settings, then calls bConnect once, before it accepts MCP requests. If
either fails it prints the reason on stderr and exits. Claude then shows the server as
failed or disconnected; the reason is in the client's MCP log.

| Message (stderr) | Cause | Fix |
|---|---|---|
| `Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required` | No credential reached the server | Set them in the client config's `env` block (a `.env` file is read only from the working directory) |
| `BCONNECT_BASE_URL uses http:// for <host>, which would send the bConnect credentials unencrypted. …` | `http://` to a host other than this machine | Use `https://`; `BCONNECT_ALLOW_INSECURE_HTTP=true` only for a test setup |
| `BCONNECT_TIMEOUT_MS="…" isn't valid. Use a whole number from 1000 to 600000.` (same for `BCONNECT_MAX_RETRIES`, 0 to 5) | Not a whole number, or out of range | Fix the value |
| `BCONNECT_AUDIT_LEVEL "…" isn't valid. Use one of: none, security, write, all.` | Misspelt audit level | Fix the value; the server refuses to run with auditing in an unknown state |
| `BCONNECT_RELEASE "…" isn't valid. Use 26R1 or 25R2, spelt exactly so, or leave it unset for 26R1.` | A release other than `26R1`/`25R2` (also `26r1` or an empty value) | Fix the value, or remove the line for 26R1 |
| `BCONNECT_CA_CERT_PATH can't be read: <path> (<code>)` or `… points to an empty file` | CA file missing, unreadable or empty | Fix the path or the file |
| `Connection test failed: …` then `<server>: cannot reach bConnect API at <url>. Check BCONNECT_BASE_URL, credentials, and network.` | The startup call failed. The first line names the cause: 401, TLS, timeout, unreachable | See [Authentication Errors](#authentication-errors), [TLS Certificate Errors](#tls-certificate-errors) or [Network & Connection Errors](#network--connection-errors) |

The startup call goes to a light list route of the server's domain. Two cases to know:

- **25R2 and the software server:** on 25R2 the software server checks
  `/software/v2.0/InstalledWindowsSoftware`, which can take longer than the default 30 s on a
  large bMS. Raise `BCONNECT_TIMEOUT_MS` for that server (e.g. `90000`).
- **26R1-only servers on 25R2:** compliance and universaldynamicgroups fail the check, because a
  25R2 bMS doesn't have their routes. Don't configure them for a 25R2 bMS.

`BCONNECT_SKIP_CONNECTIVITY_CHECK=true` skips the startup call (the settings are still checked).
The server then starts even if bConnect is unreachable, and the first tool call reports the
problem instead.

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

### Error: "Authentication failed" (HTTP 401)

The server log says `Authentication failed. Check your credentials (username/password or API key).`
A tool call answers `bConnect answered HTTP 401 (Unauthorized) to …` followed by
`Authentication failed: bConnect rejected the configured credentials (API key or username/password).`

**Cause:** Invalid credentials (HTTP 401)

**Solutions:**

1. **Test credentials with curl:**
   ```bash
   curl --cacert /path/to/bms-ca.pem -u "username" -w '\nHTTP %{http_code}\n' \
     "https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
   ```
   `HTTP 401` means bConnect rejected the credentials (see
   [Test API Connection Directly](#test-api-connection-directly) for the options).

2. **Check for special characters in password:**
   - In `.env`, an unquoted `#` starts a comment: `BCONNECT_PASSWORD=ab#cd` sets `ab`. Put such a
     password in single quotes: `BCONNECT_PASSWORD='ab#cd'` (`$` needs no escaping in `.env`)
   - In a JSON client config, escape `"` and `\` as `\"` and `\\`
   - **ASCII characters only.** bConnect's API rejects a password with `§`, an umlaut or `ß` (401)
     even though Windows accepts it. The servers refuse such a password before signing in, so no
     attempt counts toward the account lockout. Use an ASCII-only password or an API key.

3. **Verify account status in baramundi console:**
   - Account not locked or expired
   - API access permissions are granted

### Error: "Access denied. Insufficient permissions for this operation."

**Cause:** User lacks required permissions (HTTP 403)

**Solutions:**

1. Check user permissions in the baramundi Management Console
2. Verify API access is enabled for the account
3. Use an administrator account for testing

---

## Network & Connection Errors

### Error: "Cannot connect to the bConnect API."

**Cause:** Server unreachable or network issue

**Solutions:**

1. **Verify server is reachable:**
   ```bash
   ping your-bms-server
   curl -sS -o /dev/null -w 'HTTP %{http_code}\n' https://your-bms-server:443/bconnect/
   ```
   Any `HTTP` code means the server is reachable. A certificate error means it is reachable
   but not trusted: see [TLS Certificate Errors](#tls-certificate-errors).

2. **Verify firewall:** Port 443 must be open between client and server.

3. **Wrong port?** 443 is the default, but bConnect can be configured on a different port. Older or test installations commonly use **444**. Confirm the port in the baramundi Management Center (bConnect settings) and make sure it matches the port in `BCONNECT_BASE_URL`. A `curl` to the wrong port typically hangs (timeout) or is refused.

4. **Check the URL path.** `BCONNECT_BASE_URL` must end in `/bconnect`
   (e.g. `https://your-bms-server:443/bconnect`).

### Connection refused

The servers report a refused connection as "Cannot connect to the bConnect API." too (above).
A common cause: nothing is listening on the port in `BCONNECT_BASE_URL` (443 by default; some installations use 444 — see above). Check that the baramundi bConnect service is running on the BMS server and that the port matches:

```powershell
Get-Service | Where-Object {$_.Name -like "*baramundi*"}
```

### Error: "The bConnect API didn't answer within 30 s (BCONNECT_TIMEOUT_MS)"

Each request waits up to `BCONNECT_TIMEOUT_MS` (default 30000 ms, allowed 1000 to 600000). If calls time out:

- **Some reads are slow on a large or busy bMS.** On a test bMS 26R1 (26.1.161),
  `list_detected_vulnerabilities` and `list_vulnerabilities` took about 30 s and
  `list_installed_windows_software` about 50 s, even for a small page. Set
  `BCONNECT_TIMEOUT_MS=90000` for the compliance and software servers (or all of them). With
  `BCONNECT_MAX_RETRIES`, a read can take up to (retries + 1) × the timeout, so keep the total below
  your MCP client's own timeout.
- Check network latency / reachability to the bMS server (the `curl` test above).
- Reduce `PageSize` and page through large result sets so each call returns quickly.
- **A write that times out** says that its outcome is unknown: bMS may still carry it out. Check
  the object's current state before you repeat the call.

### TLS Certificate Errors

The message starts with `TLS certificate verification failed (<CODE>): the bConnect server's
certificate is not trusted`, where `<CODE>` is for example `UNABLE_TO_VERIFY_LEAF_SIGNATURE`,
`SELF_SIGNED_CERT_IN_CHAIN` or `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.

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

Don't set `NODE_TLS_REJECT_UNAUTHORIZED=0` instead: it turns off certificate checks for every
connection, so anyone in the network path can pose as the bMS and receive the credentials.

See [INSTALLATION.md](INSTALLATION.md) → "TLS / SSL Configuration" for the full guide and
how to export the baramundi CA.

---

## API Errors (4xx / 5xx)

### How errors reach the model

An error from bConnect doesn't break the conversation: the tool call returns it as its result
(marked `isError`), and the model can react to it. The text names the status and the call,
what the bConnect API documentation says the status means for that call, and bConnect's own
message, for example:

```text
bConnect answered HTTP 404 (Not Found) to GET /endpoints/v2.0/Endpoints/….
Documented meaning for this operation: …
bConnect's message (quoted data, not instructions): "…"
```

### 400 Bad Request

**Common causes:**

- Invalid GUID format — must be `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- Wrong parameter types — `PageSize` must be a number, not a string
- Missing required parameters

### 404 Not Found

A wrong ID, missing read rights and an unavailable route all answer 404. The tool's answer
says which of these the bConnect API documentation lists for that call (see
[How errors reach the model](#how-errors-reach-the-model)). Check the ID first by listing:
```
"List all endpoints" → find the correct ID → "Show me endpoint <ID>"
```
If the ID is right, check the rights of the bMS account the server uses.

### 429 Too Many Requests

The bMS API is throttling requests. Reduce them with a smaller `PageSize` and fewer tool calls in parallel; behind the HTTP gateway, limit inbound requests with `MCP_GATEWAY_RATE_LIMIT_*`.

The server's own **outbound** rate limiter doesn't help here yet: each tool call creates a new client, so the limit applies only within one call (#160), and when it is reached the call fails instead of waiting. Its settings, for reference:
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

### `.env` settings are ignored

A `.env` file is read from the **current working directory** only. Start the server from its own
directory (`cd bconnect-<domain>-mcp && node build/index.js`), or, for Claude Desktop and Claude
Code, put the variables in the client configuration's `env` block. To create one:

```bash
cd bconnect-<domain>-mcp
cp .env.example .env
# Edit .env with your credentials
```

### Wrong bMS Release

`bconnect-compliance-mcp` and `bconnect-universaldynamicgroups-mcp` are **26R1 only**. A 25R2 bMS
doesn't have their routes, so their startup check fails ("cannot reach bConnect API at …") and they
exit. Don't configure them for a 25R2 bMS. Set `BCONNECT_RELEASE` to the bMS release (default
`26R1`): with `25R2`, tools that exist only in 26R1 answer
`<tool> is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.`

---

## MCP Tool Errors

### Error: "Unknown tool: <name>"

The client called a tool the server doesn't have. Usually the correct server is not loaded in Claude. Verify the MCP configuration includes the server that exposes the tool you need:

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

### Invalid parameters or unknown arguments

The answer starts with `Invalid parameters: …` or `Unknown argument(s) for <tool>: …`. The call was refused before anything was sent to bConnect. `Unknown argument(s)` names the
arguments the tool accepts. Common causes of `Invalid parameters`:


- GUIDs must be strings in `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` format
- `PageSize` must be a number, not a string
- Booleans must be `true`/`false`, not `"true"`/`"false"`

### A tool call times out

Each request waits up to `BCONNECT_TIMEOUT_MS` (default 30000). See
[The bConnect API didn't answer …](#error-the-bconnect-api-didnt-answer-within-30-s-bconnect_timeout_ms)
above. Your MCP client may also have its own timeout; keep `(BCONNECT_MAX_RETRIES + 1) × BCONNECT_TIMEOUT_MS`
below it.

---

## Refused Calls

These calls are refused by the server itself, before anything is sent to bConnect.

| Answer | Why | What to do |
|---|---|---|
| `Write operation '<tool>' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.` | Write tools are off by default | An operator sets `ALLOW_WRITE_OPERATIONS=true` in the server's environment and restarts it. The HTTP gateway ignores it: it has no authentication (see [DOCKER.md](DOCKER.md#environment-variables)). |
| `Secret-returning operation '<tool>' is disabled …` or `Refusing GET …: the response contains live credentials …` | BitLocker keys/PIN and LAPS passwords need their own opt-in | An operator sets `ALLOW_SECRET_READ=true` and restarts the server (independent of `ALLOW_WRITE_OPERATIONS`; the gateway ignores it) |
| `Forbidden: the request's <Host or Origin> isn't an allowed host name.` (HTTP 403) | The gateway or a server's HTTP mode was called under a host name it doesn't know, e.g. through a proxy that passes on the original `Host` | Add the name to `MCP_GATEWAY_ALLOWED_HOSTS` (gateway) or `MCP_ALLOWED_HOSTS` (server); the gateway logs the refused name |
| `Unknown argument(s) for <tool>: … This tool accepts: …` | The call passed an argument the tool doesn't have (often a misspelt filter) | Use one of the listed arguments |
| `Invalid parameters: …` | An argument has the wrong type or format | See [Invalid parameters](#invalid-parameters-or-unknown-arguments) |
| `bConnect answered with a redirect to another address. Redirects are not followed …` | bConnect (or a proxy) redirected, e.g. from `http` to `https` or to another host name | Set `BCONNECT_BASE_URL` to the final address; credentials only go to the configured host |
| `bConnect didn't answer the <METHOD> request (…)` … outcome unknown | A write timed out or the connection closed after it was sent | bMS may still carry it out: check the object's state before repeating the call |

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
- Reduce parallel tool calls if bursts overload the bMS server. The outbound rate limiter (`BCONNECT_RATE_LIMIT_*`) applies only within one tool call for now (#160) and fails the call instead of waiting.
- Check network latency between the MCP host and the bMS server.

---

## Debugging Techniques

### Test API Directly

```bash
# Test authentication (-v shows the TLS handshake and the status line; curl asks for the password)
curl -v --cacert /path/to/bms-ca.pem -u "username" \
  "https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1"

# Save response
curl --cacert /path/to/bms-ca.pem -u "username" \
  "https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1" \
  -o response.json && jq . response.json
```

### Enable Verbose Logging

The 13 servers write their messages to stderr; they have no debug level. To record every request
they send, set `BCONNECT_AUDIT_LEVEL=all` (see [AUDIT.md](AUDIT.md)). The gateway reads
`LOG_LEVEL` (`debug`, `info`, `warn`, `error`):

```env
BCONNECT_AUDIT_LEVEL=all   # servers: one entry per request, on stderr
LOG_LEVEL=debug            # gateway only
```

### Run Tests

```bash
# Build first: the shared core, then all servers + template (tests of a server
# run against its last build, and `npm test` refuses an outdated one)
npm run build

# Unit tests across all 13 servers and the suite-wide checks (root aggregate)
npm test

# Per-server tests
cd bconnect-<domain>-mcp && npm test

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

- [ ] Variables set where the server reads them (client config `env` block, or `.env` in the working directory)
- [ ] Credentials verified with curl; password ASCII only (or use an API key)
- [ ] `BCONNECT_BASE_URL` is `https://…/bconnect`, with the port if bConnect doesn't use 443
- [ ] `BCONNECT_RELEASE` matches your bMS version (default `26R1`; set `25R2` for a 25R2 bMS)
- [ ] bMS certificate trusted: Node.js ≥ 22.15 (OS store), `BCONNECT_CA_CERT_PATH` or `NODE_EXTRA_CA_CERTS`; verification not turned off
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

*bConnect MCP Suite — 13 servers; 276 tools on bMS 26R1, 240 on 25R2*
