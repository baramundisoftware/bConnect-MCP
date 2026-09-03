# Installation Guide — bConnect MCP Suite

This guide covers installing and configuring the bConnect MCP Suite (14 servers) on Linux, Windows, and Docker.

> ## ⚠️ Read this before you install: **baramundi Management Suite 26R1 or later is required**
>
> **25R2 and older are not supported.** Several tools call bConnect routes that only exist
> from 26R1 on, so the suite refuses to run rather than return inaccurate data. Each server
> reads the bMS version from `GET /v2.0/ManagementServer` during its startup connectivity
> check and exits with a message naming the detected version if it is older than 26R1.
> There is no `BCONNECT_RELEASE` setting any more — the release is detected, not configured.
>
> **The gate refuses only on a version it actually read and understood.** If the version
> cannot be determined — the service account is scoped away from the `servermanagement`
> routes (401/403), the route is absent (404), the `version` field is missing, or the string
> does not parse — the server logs a warning naming exactly what it received and **starts
> anyway**. That is deliberate: refusing to start against a healthy 26R1 server because a
> credential is narrowly scoped would be worse than the inaccuracy the gate exists to
> prevent. A 25R2 bMS does answer this route, so a genuine downlevel server is refused.
> `BCONNECT_SKIP_CONNECTIVITY_CHECK=true` skips the probe and the gate with it, for
> deployments that cannot reach that route.

## Prerequisites

- **baramundi Management Suite 26R1 or later** with bConnect API enabled (25R2 and older are not supported — see the box above)
- **bConnect API URL** — typically `https://your-bms-server:443/bconnect`
- **API credentials** — a bMS user account with API access
- **An MCP-capable client** — anything that speaks the Model Context Protocol. See
  [Client Configuration](#client-configuration) for the ten this suite ships
  configuration for, and how to configure one it does not list

---

## Installation Options

### Option A — Linux (Node.js)

**Requirements:** Node.js 20+ (Node.js **22.15+ recommended** — honors the OS/Windows CA trust store; see TLS / SSL Configuration)

```bash
# 1. Clone or extract the suite
git clone <repository-url> bConnect-MCP
cd bConnect-MCP

# 2. Build from the repo ROOT. The servers import the shared @bconnect/mcp-core
#    package, so build the core first, then the servers — a single server
#    directory cannot be built on its own.
npm ci
npm run build -w @bconnect/mcp-core     # shared core first
npm run build                            # all servers (or -w bconnect-endpoints-mcp for one)

# 3. Configure credentials (see Configuration section below)
```

### Option B — Docker

See [DOCKER.md](DOCKER.md) for Docker Compose and individual container setup.

### Option C — Gateway (HTTP, multi-user)

`bconnect-mcp-gateway` serves all 13 bConnect MCP servers on a single HTTP port —
for teams and n8n.

> **⚠️ Security: the gateway requires a bearer token.** As of the 2026-08-02 revision,
> set `MCP_GATEWAY_AUTH_TOKEN` (24+ random characters) — `docker compose up` refuses to
> start without one. Every HTTP request must then carry
> `Authorization: Bearer <token>`. A shared token is the floor, not the ceiling: for
> per-user identity or SSO, still front it with a TLS-terminating, authenticating
> reverse proxy / IdP (nginx, Caddy, Traefik, Entra Application Proxy, oauth2-proxy, …)
> that forwards its own token — see [DOCKER.md](DOCKER.md) → "TLS and authentication".
> Downstream bMS calls use a single `BCONNECT_*` **service credential**; scope that
> account to least privilege (bMS RBAC governs it).

#### Step 1 — Build the gateway

The gateway depends on the shared `@bconnect/mcp-core` package, so build the core
from the repo **root** first, then the gateway:

```bash
# from the repo root — build the shared core first
npm ci
npm run build -w @bconnect/mcp-core

# then build the gateway
cd bconnect-mcp-gateway
npm ci
npm run build
cd ..
```

#### Step 2 — Configure and start

**Docker Compose (recommended):**

```bash
cp .env.gateway.example .env.gateway
# Edit .env.gateway — set BCONNECT_BASE_URL, the BCONNECT_* service credential,
# and MCP_GATEWAY_AUTH_TOKEN (24+ random characters; or re-run the installer with
# -Gateway / -RotateGatewayToken to generate and print one)

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d
```

**Node.js (bare)** — binds loopback; front it with your proxy:

```bash
cd bconnect-mcp-gateway
BCONNECT_BASE_URL=https://bms.company.com/bconnect \
BCONNECT_API_KEY=your-service-key \
MCP_GATEWAY_AUTH_TOKEN=your-24-plus-character-token \
MCP_GATEWAY_PORT=3001 \
node --import ./build/preload.js build/gateway.js
```

Verify the gateway is running. `/health` is a **liveness probe**, reachable without a
token so container and orchestrator probes keep working — and it says nothing else to
an unauthenticated caller:

```bash
curl http://localhost:3001/health
# → {"status":"ok"}

# The mounted domain list is served only to a caller carrying a configured token:
curl -H "Authorization: Bearer $MCP_GATEWAY_AUTH_TOKEN" http://localhost:3001/health
# → {"status":"ok","servers":["activedirectory",...],"count":13}

curl -X POST http://localhost:3001/endpoints/mcp \
  -H "Authorization: Bearer $MCP_GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

#### Gateway environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BCONNECT_BASE_URL` + `BCONNECT_API_KEY` (or `BCONNECT_USERNAME`+`BCONNECT_PASSWORD`) | — | The single bConnect service credential |
| `MCP_GATEWAY_AUTH_TOKEN` | — | One or more shared bearer tokens (comma-separated for rotation). Required on every request once set; 24+ characters or the gateway refuses to start |
| `MCP_GATEWAY_AUTH_TOKEN_FILE` | — | Docker-secret form of the token above |
| `MCP_GATEWAY_PORT` | `3001` | Listen port |
| `MCP_GATEWAY_BIND` | `127.0.0.1` | Bind address (loopback-only unless behind a proxy) |
| `MCP_ALLOW_NO_AUTH` | `false` | Allow a non-loopback bind with **no** token; asserts an authenticating proxy is in front instead. Not set by anything shipped in this repo |
| `MCP_GATEWAY_RATE_LIMIT_ENABLED` | `true` | Per-client-IP inbound rate limiting; set `false` to disable |
| `MCP_GATEWAY_RATE_LIMIT_MAX` | `300` | Max requests per window, per client IP |
| `MCP_GATEWAY_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in ms |
| `MCP_GATEWAY_MAX_BODY` | `1mb` | Max accepted request body size |

> **Security:** set `MCP_GATEWAY_AUTH_TOKEN`, and for per-user identity or SSO also front
> the gateway with an authenticating, TLS-terminating reverse proxy before exposing it
> (see [DOCKER.md](DOCKER.md)). The gateway refuses a non-loopback bind unless either a
> token or `MCP_ALLOW_NO_AUTH=true` is set.

---

## Configuration

Each server is configured via environment variables. Create a `.env` file in each server directory (or set environment variables directly):

```bash
cp .env.example .env
```

### Required Variables

```env
BCONNECT_BASE_URL=https://your-bms-server:443/bconnect
BCONNECT_USERNAME=your-username
BCONNECT_PASSWORD=your-password
```

> **These credentials are stored in plaintext** — in `.env`, or in whatever env file
> your client's entry points `--env-file` at. Restrict that file to the running user
> (`chmod 600 .env`, or an NTFS ACL on Windows), use a least-privilege bMS service
> account, and never commit it. Keep it out of the client config file itself: several
> clients' configs are world-readable by default and some are committed to version
> control. See
> [SECURITY.md → Credentials at rest](../SECURITY.md#credentials-at-rest-env-and-client-config)
> for the full hardening guide.

### Optional Variables

```env
BCONNECT_AUDIT_LEVEL=none            # Audit logging: none | security | write | all
ALLOW_WRITE_OPERATIONS=false         # Enable write/destructive tools (default: off).
                                      # Also controls whether write tools appear in
                                      # tools/list — with it unset they're hidden
                                      # (not disabled: calling one by name is refused
                                      # the same way either way).
ALLOW_SECRET_READ=false              # Enable secret-returning reads (default: off) — see below

# Outbound rate limiting (server → bMS). Throttles the calls each MCP server
# makes to the bMS API. Off by default; set ENABLED=true to activate.
BCONNECT_RATE_LIMIT_ENABLED=false    # Enable the client-side rate limiter
BCONNECT_RATE_LIMIT_MAX_REQUESTS=100 # Max requests per window (default: 100)
BCONNECT_RATE_LIMIT_WINDOW_MS=60000  # Window size in ms (default: 60000 = 1 min)
```

> **`ALLOW_SECRET_READ`** gates the DefenseControl tools that return **live
> credentials** — `get_bitlocker_secrets` (recovery keys + PIN) and
> `get_local_admin_accounts` (cleartext LAPS passwords). It is **off by default**
> so those secrets cannot land in an LLM context/transcript unintentionally. Set
> it to `true` only on a server/deployment where retrieving those secrets is an
> intended, authorized use.

> **What write tools can (and can't) do.** With `ALLOW_WRITE_OPERATIONS=true`, the
> assistant can **create, modify, start, assign and delete many bMS objects** — e.g.
> create an endpoint, asset, logical group or folder; create and start a job instance;
> assign a job to a group; build a software bundle from existing applications; create a
> security group/profile. What it **cannot** do is author the underlying content that
> bConnect itself does not expose: notably **job definitions** — the step and
> installation logic of a job is read-only over bConnect, so the assistant can create
> *instances* of an existing definition and assign them but cannot define a new job's
> steps; likewise it bundles **already-imported** applications rather than authoring the
> installer packages themselves. Every call is further governed by that credential's
> bMS RBAC, so the effective write surface is whatever bConnect exposes ∩ what your
> service account is permitted to do.

> **Two layers of rate limiting.** The `BCONNECT_RATE_LIMIT_*` vars above throttle
> a server's **outbound** calls to bMS (per process). They do **not** limit
> **inbound** requests to the HTTP gateway — that is configured separately on the
> gateway (`MCP_GATEWAY_RATE_LIMIT_*`, see the Gateway environment variables table).

### bMS Release Requirement

All 14 servers require **bMS 26R1 or later**. There is no configuration for this: the release is
read from `GET /v2.0/ManagementServer` at startup, and a bMS older than 26R1 is refused with a
message naming the detected version. If the version string cannot be parsed, the server logs what
it received and continues — an unreadable version is a warning, not a refusal.

One consequence worth knowing before you upgrade a script: **26R1 removed the IndustrialEndpoints
bConnect API**, so the five `*_industrial_endpoint` tools and the `industrial` member type in
`bconnect-groups-mcp` were removed with it. See
[MIGRATION-tool-surface.md](MIGRATION-tool-surface.md).

---

## TLS / SSL Configuration

The bConnect MCP Suite connects to your bMS server over HTTPS. Most baramundi deployments use a self-signed or corporate CA certificate. This section explains how to configure TLS correctly.

### Default Behaviour

TLS certificate verification is **enabled by default**. If your bMS server uses a certificate from a public CA (Let's Encrypt, DigiCert, etc.), no TLS configuration is needed.

**OS/client trust store (Node.js ≥ 22.15).** When you run the suite on Node.js 22.15 or
newer, it also honors your **operating-system certificate store** automatically. So if
the machine already trusts the bMD/corporate CA (as a domain-joined Windows client
typically does), connections work **without** any manual certificate export — the OS
store is merged with Node's bundled public CAs. On older Node the suite falls back to
Node's bundled CA list only, and you must supply the CA yourself (see below). This is
why Node **22.15+** is recommended.

> **Why this matters.** Node does *not* read the Windows/macOS trust store on its own —
> below 22.15 it validates against a built-in public-CA list only, so an internally
> signed bMS certificate looks untrusted even though Windows itself trusts it. Upgrading
> Node to ≥ 22.15 is the simplest fix; the options below cover locked-down or older
> environments.

### Production: Using BCONNECT_CA_CERT_PATH (Recommended)

Set `BCONNECT_CA_CERT_PATH` to the path of a PEM-encoded CA certificate file. The server loads this cert at startup and uses it to verify the bMS server's certificate.

```env
BCONNECT_CA_CERT_PATH=/etc/ssl/certs/bms-ca.pem
```

Windows example:
```ini
BCONNECT_CA_CERT_PATH=C:\certs\bms-ca.pem
```

Docker / Kubernetes — mount the PEM as a secret:
```env
BCONNECT_CA_CERT_PATH=/run/secrets/bms-ca.pem
```

> **Never use `NODE_TLS_REJECT_UNAUTHORIZED=0` in production.** It disables all certificate validation and exposes every connection to man-in-the-middle attacks.

`BCONNECT_CA_CERT_PATH` is an **override**: when set, the server trusts exactly that CA.
Use it when you want an explicit, pinned trust anchor regardless of what the host trusts —
e.g. hardened servers, containers, or Node < 22.15 where the OS store is not consulted.

### Alternative: NODE_EXTRA_CA_CERTS (any Node version)

If you can't run Node ≥ 22.15 but don't want to change the server config, point Node's
own `NODE_EXTRA_CA_CERTS` at a PEM file. Node **appends** it to its bundled CA list at
startup, so it works alongside public CAs:

```env
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/bms-ca.pem
```

This still requires exporting the CA to a file (like `BCONNECT_CA_CERT_PATH`); the
zero-export path is running on Node ≥ 22.15 so the OS trust store is honored directly.

### Development Only: Disable TLS Verification

```env
NODE_TLS_REJECT_UNAUTHORIZED=0
```

Use only in isolated development or lab environments.

---

### Exporting the baramundi CA Certificate

#### On Windows

**Method A — Windows Certificate Manager (MMC)**

1. Open **Run** (`Win+R`), type `certmgr.msc`, press Enter.
2. Navigate to **Trusted Root Certification Authorities > Certificates**.
3. Locate the CA that signed your baramundi server certificate.
4. Right-click → **All Tasks > Export** → **Base-64 encoded X.509 (.CER)**.
5. Save as `bms-ca.cer`, then rename to `.pem`:
   ```powershell
   Rename-Item -Path "C:\certs\bms-ca.cer" -NewName "bms-ca.pem"
   ```

**Method B — PowerShell one-liner**

```powershell
$hostname = "your-bms-server"
$port     = 443

$tcpClient = [System.Net.Sockets.TcpClient]::new($hostname, $port)
$sslStream = [System.Net.Security.SslStream]::new($tcpClient.GetStream(), $false, { $true })
$sslStream.AuthenticateAsClient($hostname)
$cert      = $sslStream.RemoteCertificate
$sslStream.Close(); $tcpClient.Close()

$certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
$pem = "-----BEGIN CERTIFICATE-----`n" +
       [Convert]::ToBase64String($certBytes, [Base64FormattingOptions]::InsertLineBreaks) +
       "`n-----END CERTIFICATE-----"
$pem | Set-Content -Encoding ascii "C:\certs\bms-ca.pem"
```

> Note: exports the leaf certificate, which works for self-signed certs. For a CA-signed cert, export the issuing CA from MMC (Method A).

#### On Linux / macOS

**Method A — openssl s_client (recommended)**

```bash
openssl s_client -showcerts -connect your-bms-server:443 </dev/null 2>/dev/null \
  | openssl x509 -outform PEM > /etc/ssl/certs/bms-ca.pem

# Verify
openssl x509 -in /etc/ssl/certs/bms-ca.pem -noout -subject -issuer -dates
```

If the server uses an intermediate CA, capture the full chain:

```bash
openssl s_client -showcerts -connect your-bms-server:443 </dev/null 2>/dev/null \
  | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' \
  > /etc/ssl/certs/bms-ca-chain.pem
```

---

### Verifying TLS Is Working

**Test with curl before starting the server:**

```bash
curl --cacert /etc/ssl/certs/bms-ca.pem \
     -u "username:password" \
     https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1
```

A `200` response confirms the CA cert is correct and `BCONNECT_CA_CERT_PATH` will work.

**Common TLS errors:**

| Error code | Cause | Fix |
|------------|-------|-----|
| `ENOENT` | `BCONNECT_CA_CERT_PATH` file not found | Check the path |
| `SELF_SIGNED_CERT_IN_CHAIN` | CA cert not trusted | Export the correct issuing CA |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Cert chain incomplete | Export the full chain |
| `ERR_TLS_CERT_ALTNAME_INVALID` | Hostname mismatch | Use the hostname in the cert CN/SAN |

---

## Client Configuration

Add each server you want to use to your MCP client's configuration. Load only the
domains you need — you do not need all 13.

**The command line is the same for every client.** Only three things change: the file
the entry goes in, the top-level key it sits under, and whether the entry carries a
`"type"`. Get one of those wrong and most clients ignore the entry without reporting
anything.

| Client | Transport | Config file | Top-level key | `"type"` on entries |
|--------|-----------|-------------|---------------|---------------------|
| Claude Code (CLI) | stdio + HTTP | `.mcp.json` in the project root (or `claude mcp add`) | `mcpServers` | **required** |
| VS Code (Copilot agent mode) | stdio + HTTP | `.vscode/mcp.json` (workspace) | **`servers`** | **required** |
| Claude Desktop | stdio | `claude_desktop_config.json` | `mcpServers` | omit |
| Cursor | stdio + HTTP | `.cursor/mcp.json`, or `~/.cursor/mcp.json` | `mcpServers` | omit |
| Continue | stdio + HTTP | `~/.continue/mcpServers/<name>.yaml` | `mcpServers`, a YAML **list** | yes |
| LibreChat | stdio + HTTP | `librechat.yaml` (paste under `mcpServers:`) | `mcpServers` | yes |
| Open WebUI | **HTTP only** | web UI: Admin Settings → External Tools | — | — |
| n8n | **HTTP only** | MCP Client Tool node + MCP Server credential | — | — |
| OpenAI Responses API / Agents SDK | HTTP (hosted) or stdio (Agents SDK) | your own code | — | — |
| Microsoft Copilot Studio | **HTTP only** | Power Platform custom connector | — | — |

The two that bite hardest, because neither produces an error:

- **VS Code's key is `servers`**, not `mcpServers`. A block copied from a Claude config
  into `.vscode/mcp.json` is read and discarded.
- **Claude Code reads a `url` entry with no `"type"` as stdio.** The HTTP examples below
  carry `"type": "http"` for that reason.

### stdio — the portable entry

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

Wrap that in `{"mcpServers": …}` or `{"servers": …}` per the table, and drop `"type"`
for Claude Desktop and Cursor. `--env-file` needs Node 20.6+ (22.15+ is recommended
anyway); on an older Node, put the variables in the environment instead. **Do not put
credentials in the client config file** — see
[SECURITY.md → Credentials at rest](../SECURITY.md#credentials-at-rest-env-and-client-config).

**Claude Code** can register the same thing from the CLI, which avoids hand-editing:

```bash
claude mcp add bconnect-endpoints \
  --scope user \
  -- node --env-file=/path/to/bconnect.env /path/to/bconnect-endpoints-mcp/build/index.js
```

`--scope local` (the default) binds the server to the directory you ran `claude` from;
`--scope user` makes it available everywhere; `--scope project` writes the repo's
`.mcp.json`, which then needs a one-time in-app trust approval.

**Claude Desktop** — where the file lives, and it needs a **full quit** (tray icon →
Quit) before it re-reads it:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows (standard installer):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Windows (Microsoft Store / MSIX install):** the file lives inside the packaged
  app's sandbox, e.g.
  `C:\Users\<user>\AppData\Local\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json`
  — edit that copy, not one under `%APPDATA%`, or Claude Desktop won't see your changes.

**Continue** is the odd one out: `mcpServers` is a YAML **list** whose items each carry
their own `name:`, and the file needs a `name`/`version`/`schema` header. MCP works in
**agent mode** only.

```yaml
name: bconnect-mcp
version: 0.0.1
schema: v1
mcpServers:
  - name: bconnect-endpoints
    type: stdio
    command: node
    args:
      - --env-file=/path/to/bconnect.env
      - /path/to/bconnect-endpoints-mcp/build/index.js
```

**LibreChat** runs stdio servers on the **LibreChat host** — if LibreChat is in Docker,
the suite must be inside that container or on a mounted path, and `librechat.yaml` must
be in the project root and mounted into the API container.

### HTTP — via the gateway

Point each entry at `/<domain>/mcp` and supply the gateway's bearer token (directly, or
via your authenticating proxy, which forwards its own):

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "type": "http",
      "url": "https://mcp-gateway.company.com/endpoints/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_GATEWAY_AUTH_TOKEN>"
      }
    },
    "bconnect-assets": {
      "type": "http",
      "url": "https://mcp-gateway.company.com/assets/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_GATEWAY_AUTH_TOKEN>"
      }
    }
  }
}
```

Same wrapper rules: `servers` for VS Code; no `"type"` for Cursor, which identifies a
remote entry by the presence of `url`; `type: streamable-http` for Continue and
LibreChat. Claude Desktop has no documented HTTP entry in `claude_desktop_config.json`
at all — its remote-server path is Connectors/Extensions — so do not expect one to work
there.

Available gateway domains: `activedirectory`, `assets`, `compliance`,
`defensecontrol`, `endpoints`, `groups`, `jobs`, `operatingsystems`,
`servermanagement`, `software`, `universaldynamicgroups`, `updatemanagement`,
`variables`.

### HTTP-only clients

n8n, Open WebUI, OpenAI's hosted MCP tool and Copilot Studio have **no stdio path** —
no `command`, no `args`, no local process — so the gateway is the only route.

- **n8n** — one MCP Server credential per domain URL, token supplied as a Header Auth
  credential. Full guide: [N8N.md](N8N.md).
- **Open WebUI** — native MCP since v0.6.31, Streamable HTTP only, configured in
  Admin Settings → External Tools (type *MCP (Streamable HTTP)*). A containerised Open
  WebUI reaching a gateway on the host needs `http://host.docker.internal:<port>`.
- **OpenAI** — the Responses API hosted tool calls the URL **from OpenAI's servers**, so
  it needs a publicly reachable or tunnelled endpoint; the Agents SDK's
  `MCPServerStdio` spawns the server locally and needs no gateway at all, which is the
  better fit for a firewalled host.
- **Copilot Studio** — Streamable HTTP only, through a Power Platform connector, so the
  call originates in Microsoft's cloud. The connector Swagger needs
  `x-ms-agentic-protocol: mcp-streamable-1.0` on a POST operation. Anything Microsoft's
  cloud can reach must sit behind a TLS-terminating proxy that authenticates a person.

### Any other MCP client

The whole interface is one command line:

```text
node --env-file=/path/to/bconnect.env /path/to/bconnect-endpoints-mcp/build/index.js
```

Any client that can spawn a process, or call a URL, can be configured from that. If it
does not work, the wrapper is wrong, not the server.

---

## Verify Installation

Start a server and confirm it responds:

```bash
cd bconnect-endpoints-mcp
node build/index.js
# Expected: bconnect-endpoints-mcp started on stdio
```

Test API connectivity:

```bash
curl -k -u "username:password" \
  "https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
```

---

## Next Steps

- See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) if you encounter issues
- See [DOCKER.md](DOCKER.md) for containerised deployment
- See [N8N.md](N8N.md) for using the gateway from n8n workflows
- See [DATA-FLOW.md](DATA-FLOW.md) for what estate data reaches the model your client is
  backed by — the question a security review will ask before this is approved

---

*bConnect MCP Suite v26.1.8 — 14 servers; 141 tools by default, 221 with `ALLOW_WRITE_OPERATIONS=true`; requires bMS 26R1 or later*
