# Installation Guide — bConnect MCP Suite

This guide covers installing and configuring the bConnect MCP Suite (13 servers) on Linux, Windows, and Docker.

## Prerequisites

- **baramundi Management Suite** 25R2 or 26R1 with bConnect API enabled
- **bConnect API URL** — typically `https://your-bms-server:444/bconnect`
- **API credentials** — a bMS user account with API access
- **Claude Desktop** or **Claude Code** (CLI)

---

## Installation Options

### Option A — Linux (Node.js)

**Requirements:** Node.js 20+

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

### Option B — Windows (Pre-built .exe)

Download the `.exe` files from the `releases/windows-binaries/` directory or the GitHub Release page.

Each server is a standalone executable — no Node.js installation required.

See [WINDOWS-DEPLOYMENT.md](WINDOWS-DEPLOYMENT.md) for the full Windows guide.

### Option C — Docker

See [DOCKER.md](DOCKER.md) for Docker Compose and individual container setup.

### Option D — Gateway (HTTP, multi-user, authenticated)

`bconnect-mcp-gateway` serves all 13 bConnect MCP servers on a single HTTP port
with per-user authentication. Use this when multiple users or teams need access,
each with their own bConnect credentials or API key.

#### Step 1 — Build the gateway

```bash
cd bconnect-mcp-gateway
npm ci
npm run build
cd ..
```

#### Step 2 — Generate Bearer tokens

Each user needs a unique Bearer token. Generate one per user with:

```bash
node -e "console.log('tok_' + require('crypto').randomBytes(32).toString('hex'))"
```

**Token requirements:**
- Must be unique per user — never reuse tokens across users
- Minimum 32 random bytes (64 hex characters) after the prefix
- Use a descriptive prefix (e.g. `tok_alice_`, `tok_teamA_`) to identify the user
- Treat tokens like passwords — do not share or log them

Example output:
```
tok_alice_a3f8c2d1e4b7f09a2c5e8d3b6f1a4c7e2d5b8f3a6c9e2d5b8f1a4c7e0d3b6f9
```

#### Step 3 — Create the token map

Create `/etc/mcp/tokens.json`. Each key is a Bearer token; each value contains
only the credentials for that user. **The bMS server URL is set once in `.env`
as `BCONNECT_BASE_URL` — do not repeat it here.**

```json
{
  "tok_alice_a3f8c2d1e4b7f09a2c5e8d3b6f1a4c7e2d5b8f3a6c9e2d5b8f1a4c7e0d3b6f9": {
    "apiKey": "PASTE-BCONNECT-API-KEY-FOR-ALICE-HERE"
  },
  "tok_bob_1c4e7a0d3f6b9e2c5a8d1f4b7e0c3a6d9f2b5e8c1d4a7f0b3e6c9d2a5f8b1e4c7": {
    "username": "svc-bob",
    "password": "PASTE-BOBS-BCONNECT-PASSWORD-HERE"
  }
}
```

> **Why no `baseUrl` here?** Most organizations have one baramundi server. Set
> `BCONNECT_BASE_URL` once in `.env.gateway` and all tokens share it automatically.
> Only add `"baseUrl"` to a token entry if that specific user must reach a
> **different** bMS server.

**What to replace:**

| Placeholder | Replace with |
|-------------|-------------|
| Token keys (`tok_alice_…`, `tok_bob_…`) | Your generated tokens from Step 2 |
| `PASTE-BCONNECT-API-KEY-FOR-ALICE-HERE` | API key from baramundi Management Center → Server Management → API Keys |
| `svc-bob` / `PASTE-BOBS-BCONNECT-PASSWORD-HERE` | bMS username and password (alternative to API key) |

**Authentication options per user** — use one, not both:
- `"apiKey": "..."` — recommended; generate in baramundi Management Center
- `"username": "..."` + `"password": "..."` — use an existing bMS user account

**n:m mapping** — multiple tokens can share the same bConnect API key. For example,
all members of one team can each have their own token that maps to a single shared
team API key.

Restrict file access:
```bash
chmod 600 /etc/mcp/tokens.json
```

#### Step 4 — Start the gateway

**Docker Compose (recommended):**

```bash
cp .env.gateway.example .env.gateway
# Edit .env.gateway — set BCONNECT_BASE_URL and MCP_AUTH_CONFIG_PATH

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d
```

**Node.js (bare):**

```bash
cd bconnect-mcp-gateway
MCP_AUTH_CONFIG=/etc/mcp/tokens.json \
MCP_GATEWAY_PORT=3001 \
MCP_GATEWAY_BIND=0.0.0.0 \
node --import ./build/preload.js build/gateway.js
```

Verify the gateway is running:
```bash
curl http://localhost:3001/health
# → {"status":"ok","servers":[...],"count":13,"authEnabled":true}
```

`authEnabled: true` confirms the token map was loaded successfully.

#### Gateway environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_AUTH_CONFIG` | — | Path to token map JSON. When unset, auth is disabled (env-var fallback). |
| `MCP_GATEWAY_PORT` | `3001` | Listen port |
| `MCP_GATEWAY_BIND` | `127.0.0.1` | Bind address (`0.0.0.0` to accept remote connections) |

> **Security:** Always put a TLS-terminating reverse proxy (nginx, Caddy) in front
> of the gateway in production — Bearer tokens travel in HTTP headers and must be
> encrypted in transit. The token map file should be readable only by the gateway
> process user.

---

## Configuration

Each server is configured via environment variables. Create a `.env` file in each server directory (or set environment variables directly):

```bash
cp .env.example .env
```

### Required Variables

```env
BCONNECT_BASE_URL=https://your-bms-server:444/bconnect
BCONNECT_USERNAME=your-username
BCONNECT_PASSWORD=your-password
BCONNECT_RELEASE=26R1          # or 25R2
```

### Optional Variables

```env
BCONNECT_TIMEOUT=30000         # Request timeout in ms (default: 30000)
BCONNECT_MAX_RETRIES=3         # Retry attempts for 429/5xx errors
BCONNECT_RETRY_DELAY=100       # Base delay between retries in ms
BCONNECT_AUDIT_LEVEL=off       # Audit logging: off | basic | full
```

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
$port     = 444

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
openssl s_client -showcerts -connect your-bms-server:444 </dev/null 2>/dev/null \
  | openssl x509 -outform PEM > /etc/ssl/certs/bms-ca.pem

# Verify
openssl x509 -in /etc/ssl/certs/bms-ca.pem -noout -subject -issuer -dates
```

If the server uses an intermediate CA, capture the full chain:

```bash
openssl s_client -showcerts -connect your-bms-server:444 </dev/null 2>/dev/null \
  | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' \
  > /etc/ssl/certs/bms-ca-chain.pem
```

---

### Verifying TLS Is Working

**Test with curl before starting the server:**

```bash
curl --cacert /etc/ssl/certs/bms-ca.pem \
     -u "username:password" \
     https://your-bms-server:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1
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
  node /path/to/bconnect-endpoints-mcp/dist/index.js \
  -e BCONNECT_BASE_URL=https://your-bms-server:444/bconnect \
  -e BCONNECT_USERNAME=your-username \
  -e BCONNECT_PASSWORD=your-password \
  -e BCONNECT_RELEASE=26R1
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "command": "node",
      "args": ["/path/to/bconnect-endpoints-mcp/dist/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms-server:444/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password",
        "BCONNECT_RELEASE": "26R1"
      }
    },
    "bconnect-assets": {
      "command": "node",
      "args": ["/path/to/bconnect-assets-mcp/dist/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms-server:444/bconnect",
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

When using the gateway, point each server at `/<domain>/mcp` and supply the user's
Bearer token in the `Authorization` header:

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "url": "http://mcp-gateway.company.com:3001/endpoints/mcp",
      "headers": { "Authorization": "Bearer tok_alice_<random>" }
    },
    "bconnect-assets": {
      "url": "http://mcp-gateway.company.com:3001/assets/mcp",
      "headers": { "Authorization": "Bearer tok_alice_<random>" }
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
node dist/index.js
# Expected: bconnect-endpoints-mcp running on stdio
```

Test API connectivity:

```bash
curl -k -u "username:password" \
  "https://your-bms-server:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
```

---

## Next Steps

- See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) if you encounter issues
- See [DOCKER.md](DOCKER.md) for containerised deployment
- See [WINDOWS-DEPLOYMENT.md](WINDOWS-DEPLOYMENT.md) for Windows-specific setup
- See [N8N.md](N8N.md) for using the gateway from n8n workflows

---

*bConnect MCP Suite v26.1.5 — 13 servers, 268 tools, bMS 26R1 / 25R2*
