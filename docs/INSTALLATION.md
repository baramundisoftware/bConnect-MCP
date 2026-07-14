# Installation Guide — bConnect MCP Suite

This guide covers installing and configuring the bConnect MCP Suite (13 servers) on Linux, Windows, and Docker.

## Prerequisites

- **baramundi Management Suite** 25R2 or 26R1 with bConnect API enabled
- **bConnect API URL** — typically `https://your-bms-server:443/bconnect`
- **API credentials** — a bMS user account with API access
- **Claude Desktop** or **Claude Code** (CLI)

---

## Installation Options

### Option A — Linux (Node.js)

**Requirements:** Node.js 20+ (Node.js **22.15+ recommended** — honors the OS/Windows CA trust store; see TLS / SSL Configuration)

```bash
# 1. Clone or extract the suite
git clone <repository-url> bConnect-MCP
cd bConnect-MCP

# 2. Install dependencies for each server you need
cd bconnect-endpoints-mcp && npm ci && npm run build && cd ..
cd bconnect-assets-mcp    && npm ci && npm run build && cd ..
# Repeat for each server you want to use

# 3. Configure credentials (see Configuration section below)
```

### Option B — Docker

See [DOCKER.md](DOCKER.md) for Docker Compose and individual container setup.

### Option C — Gateway (HTTP, multi-user)

`bconnect-mcp-gateway` serves all 13 bConnect MCP servers on a single HTTP port —
for teams and n8n.

> **⚠️ Security: the gateway has no built-in authentication.** You MUST front it with a
> TLS-terminating, authenticating reverse proxy / IdP (nginx, Caddy, Traefik, Entra
> Application Proxy, oauth2-proxy, …) before exposing it — see [DOCKER.md](DOCKER.md) →
> "TLS and authentication". Downstream bMS calls use a single `BCONNECT_*` **service
> credential**; scope that account to least privilege (bMS RBAC governs it).

#### Step 1 — Build the gateway

```bash
cd bconnect-mcp-gateway
npm ci
npm run build
cd ..
```

#### Step 2 — Configure and start

**Docker Compose (recommended):**

```bash
cp .env.gateway.example .env.gateway
# Edit .env.gateway — set BCONNECT_BASE_URL and the BCONNECT_* service credential

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d
```

**Node.js (bare)** — binds loopback; front it with your proxy:

```bash
cd bconnect-mcp-gateway
BCONNECT_BASE_URL=https://bms.company.com/bconnect \
BCONNECT_API_KEY=your-service-key \
MCP_GATEWAY_PORT=3001 \
node --import ./build/preload.js build/gateway.js
```

Verify the gateway is running:
```bash
curl http://localhost:3001/health
# → {"status":"ok","servers":[...],"count":13}
```

#### Gateway environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BCONNECT_BASE_URL` + `BCONNECT_API_KEY` (or `BCONNECT_USERNAME`+`BCONNECT_PASSWORD`) | — | The single bConnect service credential |
| `MCP_GATEWAY_PORT` | `3001` | Listen port |
| `MCP_GATEWAY_BIND` | `127.0.0.1` | Bind address (loopback-only unless behind a proxy) |
| `MCP_ALLOW_NO_AUTH` | `false` | Allow a non-loopback bind; asserts an authenticating proxy is in front |
| `MCP_GATEWAY_RATE_LIMIT_ENABLED` | `true` | Per-client-IP inbound rate limiting; set `false` to disable |
| `MCP_GATEWAY_RATE_LIMIT_MAX` | `300` | Max requests per window, per client IP |
| `MCP_GATEWAY_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in ms |
| `MCP_GATEWAY_MAX_BODY` | `1mb` | Max accepted request body size |

> **Security:** front the gateway with an authenticating, TLS-terminating reverse proxy
> before exposing it (see [DOCKER.md](DOCKER.md)). The gateway refuses a non-loopback
> bind unless `MCP_ALLOW_NO_AUTH=true`.

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
BCONNECT_RELEASE=26R1          # or 25R2
```

> **These credentials are stored in plaintext** (in `.env` or the Claude Desktop
> config). Restrict the file to the running user (`chmod 600 .env`, or an NTFS ACL on
> Windows), use a least-privilege bMS service account, and never commit it. See
> [SECURITY.md → Credentials at rest](../SECURITY.md#credentials-at-rest-env-and-client-config)
> for the full hardening guide.

### Optional Variables

```env
BCONNECT_AUDIT_LEVEL=none            # Audit logging: none | security | write | all
ALLOW_WRITE_OPERATIONS=false         # Enable write/destructive tools (default: off)
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

### bMS Release Notes

| Value | Servers available |
|-------|------------------|
| `26R1` | All 13 servers |
| `25R2` | 11 servers (compliance and universaldynamicgroups not available) |

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

## Claude Configuration

Add each server you want to use to your Claude MCP configuration.

### Claude Code (`~/.claude/mcp_settings.json` or via `claude mcp add`)

```bash
claude mcp add bconnect-endpoints \
  node /path/to/bconnect-endpoints-mcp/build/index.js \
  -e BCONNECT_BASE_URL=https://your-bms-server:443/bconnect \
  -e BCONNECT_USERNAME=your-username \
  -e BCONNECT_PASSWORD=your-password \
  -e BCONNECT_RELEASE=26R1
```

### Claude Desktop (`claude_desktop_config.json`)

**Where is `claude_desktop_config.json`?**

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows (standard installer):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Windows (Microsoft Store / MSIX install):** the file lives inside the packaged
  app's sandbox, e.g.
  `C:\Users\<user>\AppData\Local\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json`
  — edit that copy, not one under `%APPDATA%`, or Claude Desktop won't see your changes.

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

Add one entry per server. You do not need to load all 13 — load only the domains you need.

### Gateway (Claude Desktop or Claude Code, HTTP)

When using the gateway, point each server at `/<domain>/mcp` **through your
authenticating proxy** (which supplies whatever credential/session it requires):

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "url": "https://mcp-gateway.company.com/endpoints/mcp"
    },
    "bconnect-assets": {
      "url": "https://mcp-gateway.company.com/assets/mcp"
    }
  }
}
```

Available gateway domains: `activedirectory`, `assets`, `compliance`,
`defensecontrol`, `endpoints`, `groups`, `jobs`, `operatingsystems`,
`servermanagement`, `software`, `universaldynamicgroups`, `updatemanagement`,
`variables`.

---

## Verify Installation

Start a server and confirm it responds:

```bash
cd bconnect-endpoints-mcp
node build/index.js
# Expected: bconnect-endpoints-mcp running on stdio
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

---

*bConnect MCP Suite v26.1.7 — 13 servers, 276 tools, bMS 26R1 / 25R2*
