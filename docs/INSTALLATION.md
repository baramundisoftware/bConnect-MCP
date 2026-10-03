# Installation Guide — bConnect MCP Suite

This guide covers installing and configuring the bConnect MCP Suite (13 servers on 26R1; 11 on 25R2) on Linux, Windows, and Docker.

## Prerequisites

- **baramundi Management Suite** 25R2 or 26R1 with bConnect API enabled
- **bConnect API URL** — typically `https://your-bms-server:443/bconnect`
- **API credentials** — an API key (recommended) or a bMS user account with API access
- **Claude Desktop** or **Claude Code** (CLI)

---

## Installation Options

### Option A — Node.js (Linux, macOS, Windows)

**Requirements:** Node.js **22.15 or 24**, the versions CI tests. 22.15 and later also honor the
OS/Windows CA trust store (see [TLS / SSL Configuration](#tls--ssl-configuration)). The
packages still allow Node 20, but nobody tests it.

> **On Windows:** the build scripts are bash. Install [Git for Windows](https://gitforwindows.org/)
> and make Git Bash npm's script shell once, because npm runs scripts with `cmd.exe` otherwise,
> whichever shell you type in (the setting applies to all your npm projects):
> `npm config set script-shell "C:\Program Files\Git\bin\bash.exe"`

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

### Option B — Docker (gateway only)

Only the HTTP gateway (Option C) ships as a container image; the 13 servers run as local
processes over stdio. See [DOCKER.md](DOCKER.md).

### Option C — Gateway (HTTP, multi-user)

`bconnect-mcp-gateway` serves all 13 bConnect MCP servers on a single HTTP port —
for teams and n8n.

> **⚠️ Security: the gateway has no built-in authentication.** You MUST front it with a
> TLS-terminating, authenticating reverse proxy / IdP (nginx, Caddy, Traefik, Entra
> Application Proxy, oauth2-proxy, …) before exposing it — see [DOCKER.md](DOCKER.md) →
> "TLS and authentication". Downstream bMS calls use a single `BCONNECT_*` **service
> credential**; scope that account to least privilege (bMS RBAC governs it).

#### Step 1 — Build the gateway

The gateway loads the shared `@bconnect/mcp-core` package and the built output of
all 13 servers. Install once from the repo **root**, build the core, then the
servers, then the gateway:

```bash
# from the repo root
npm ci
npm run build -w @bconnect/mcp-core   # the shared core first
npm run build                         # all 13 servers

# then the gateway: build only, no `npm ci` / `npm install` here. The gateway
# isn't a workspace member; its dependencies come from the root install.
cd bconnect-mcp-gateway
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

The servers the gateway hosts run in its process and read the same environment: the shared
settings (release, CA file, timeouts, audit level, rate limits) apply to all of them; see
[DOCKER.md → Environment Variables](DOCKER.md#environment-variables).

> **Write tools and secret reads are off in the gateway.** The gateway has no authentication of
> its own, so whoever reaches it could use them. It therefore ignores `ALLOW_WRITE_OPERATIONS`
> and `ALLOW_SECRET_READ`, however it is started and wherever they are set (environment,
> `.env.gateway`, a `.env` file): every write tool and every tool that returns credentials
> (BitLocker keys and PIN, LAPS passwords) is refused, and the gateway logs a warning at startup
> if either was set. This stays so until the gateway has its own authentication.

> **Security:** front the gateway with an authenticating, TLS-terminating reverse proxy
> before exposing it (see [DOCKER.md](DOCKER.md)). The gateway refuses a non-loopback
> bind unless `MCP_ALLOW_NO_AUTH=true`.

---

## Configuration

Each server is configured via environment variables. When you start a server yourself from its
own directory, it also reads a `.env` file there: dotenv looks in the **current working
directory**, not in the server's directory. Claude Desktop and Claude Code start servers from
elsewhere, so for them set the variables in the client configuration's `env` block (see
[Claude Configuration](#claude-configuration)).

```bash
cd bconnect-<domain>-mcp
cp .env.example .env
```

### Required Variables

```env
BCONNECT_BASE_URL=https://your-bms-server:443/bconnect   # must be https:// (see below)

# One credential: an API key (recommended) …
BCONNECT_API_KEY=your-api-key
# … or a username and password
# BCONNECT_USERNAME=your-username
# BCONNECT_PASSWORD=your-password

BCONNECT_RELEASE=26R1          # optional: 26R1 (default) or 25R2, the release of your bMS
```

The password must be **ASCII only**: bConnect rejects `§`, umlauts or `ß` (HTTP 401), so the
servers refuse such a password before signing in, and no attempt counts toward the account
lockout. A username may contain Latin-1 characters such as `ö`.

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

# Outbound rate limiting (server → bMS). Limits the requests one client sends and
# fails a request over the limit. Each tool call still creates a new client, so the
# limit applies only within one tool call for now (#160). Off by default.
BCONNECT_RATE_LIMIT_ENABLED=false    # Enable the client-side rate limiter
BCONNECT_RATE_LIMIT_MAX_REQUESTS=100 # Max requests per window (default: 100)
BCONNECT_RATE_LIMIT_WINDOW_MS=60000  # Window size in ms (default: 60000 = 1 min)

BCONNECT_TIMEOUT_MS=30000            # Wait per request, 1000–600000 ms (default: 30000)
BCONNECT_MAX_RETRIES=0               # Retries for reads after a network error, timeout or 502/503/504 (0–5); writes are never retried
BCONNECT_CA_CERT_PATH=               # PEM file with the bMS CA (see TLS / SSL Configuration)
BCONNECT_ALLOW_INSECURE_HTTP=false   # http:// is refused except for localhost; true allows it (credentials unencrypted)
BCONNECT_SKIP_CONNECTIVITY_CHECK=false  # true skips the startup check against bConnect
```

An invalid value for `BCONNECT_TIMEOUT_MS`, `BCONNECT_MAX_RETRIES` or `BCONNECT_AUDIT_LEVEL`, or
a CA file that can't be read, stops the server at startup with a message naming the setting.
Each server's README lists every variable it reads (checked by a test), including the HTTP
transport settings `MCP_TRANSPORT`, `MCP_PORT` and `MCP_BIND`.

> **`ALLOW_SECRET_READ`** gates the DefenseControl tools whose response contains
> **live credentials**: `get_bitlocker_secrets` and `update_bitlocker_pin` (BitLocker
> recovery keys + startup PIN), `get_local_admin_accounts` and
> `patch_local_admin_user_credentials` (cleartext LAPS password). It is **off by
> default**, so those secrets can't land in an LLM context or transcript
> unintentionally. It is **independent of `ALLOW_WRITE_OPERATIONS`**: the two write
> tools need both gates. Set it to `true` only on a server where retrieving these
> secrets is an intended, authorized use, then restart the server; a running
> server doesn't pick up the change, and the assistant can't set it.

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
> a server's **outbound** calls to bMS, but only within one tool call for now: each
> tool call creates a new client, so the limit doesn't apply across calls yet (#160). They do **not** limit
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

### Recommended: BCONNECT_CA_CERT_PATH

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

> **Never use `NODE_TLS_REJECT_UNAUTHORIZED=0`** (see below). It disables all certificate validation and exposes every connection to man-in-the-middle attacks.

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

### Don't disable TLS verification

Don't set `NODE_TLS_REJECT_UNAUTHORIZED=0`, not even for a test: it turns off certificate
checks for every TLS connection of the process, so anyone in the network path can pose as the
bMS, receive the credentials and send the model forged data. If the certificate isn't trusted,
use one of the options above; for a lab bMS with a self-signed certificate, export that
certificate and point `BCONNECT_CA_CERT_PATH` at it.

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

**Method A — openssl s_client**

`BCONNECT_CA_CERT_PATH` needs the certificate of the **CA that signed** the bMS certificate,
not the bMS certificate itself (except for a self-signed bMS certificate, which is its own CA).
First see what the server sends:

```bash
openssl s_client -showcerts -connect your-bms-server:443 </dev/null 2>/dev/null \
  | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' > bms-chain.pem
openssl crl2pkcs7 -nocrl -certfile bms-chain.pem | openssl pkcs7 -print_certs -noout
```

- **One certificate whose subject equals its issuer:** self-signed. Use `bms-chain.pem` as the CA file.
- **Otherwise:** servers usually don't send their root CA. Get the root (and any intermediate)
  CA certificate from your PKI team or a machine that trusts it (on Windows: Method A above),
  and save them in one PEM file.

Check your CA file (e.g. `/etc/ssl/certs/bms-ca.pem`) before you use it. `OK` means the
certificate chain and the host name check out, as the servers will check them:

```bash
openssl verify -CAfile /etc/ssl/certs/bms-ca.pem -untrusted bms-chain.pem \
  -verify_hostname your-bms-server bms-chain.pem
```

---

### Verifying TLS Is Working

**Test with curl before starting the server:**

```bash
curl --cacert /etc/ssl/certs/bms-ca.pem -u "username" -w '\nHTTP %{http_code}\n' \
  "https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
```

curl asks for the password, so it doesn't end up in your shell history. `HTTP 200` confirms the CA cert is correct and `BCONNECT_CA_CERT_PATH` will work.

**Common TLS errors:**

| Error code | Cause | Fix |
|------------|-------|-----|
| `BCONNECT_CA_CERT_PATH can't be read: <path> (ENOENT)` | File not found; the server stops at startup (an empty file is refused too) | Check the path |
| `SELF_SIGNED_CERT_IN_CHAIN` | CA cert not trusted | Export the correct issuing CA |
| `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | The CA that signed the bMS certificate isn't trusted | Provide that CA (most common case with an internal CA) |
| `DEPTH_ZERO_SELF_SIGNED_CERT` | Self-signed bMS certificate | Use that certificate as the CA file |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | Cert chain incomplete | Export the full chain |
| `ERR_TLS_CERT_ALTNAME_INVALID` | Hostname mismatch | Use the hostname in the cert CN/SAN |

---

## Claude Configuration

Add each server you want to use to your Claude MCP configuration. For VS Code / GitHub
Copilot, Cursor, Continue, LibreChat and HTTP-only clients, and for keeping the credentials out
of the client configuration, see [CLIENTS.md](CLIENTS.md).

### Claude Code (`claude mcp add`)

Options come before the server name, and `--` separates them from the command.
Use an **absolute** path to `build/index.js`:

```bash
claude mcp add bconnect-endpoints \
  --scope user \
  --env BCONNECT_BASE_URL=https://your-bms-server:443/bconnect \
  --env BCONNECT_API_KEY=your-api-key \
  --env BCONNECT_RELEASE=26R1 \
  -- node /path/to/bconnect-endpoints-mcp/build/index.js
```

`--scope user` makes the server available in every project; the default `local`
scope loads it only in the directory you ran the command from, and `project` writes
it to `.mcp.json` for the whole team. With Basic authentication, use
`--env BCONNECT_USERNAME=… --env BCONNECT_PASSWORD=…` instead of the API key.

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

### Gateway (HTTP)

With the gateway, each domain is an MCP server at `/<domain>/mcp`, reached **through your
authenticating proxy** (which supplies whatever credential/session it requires). It speaks
MCP's HTTP Streamable transport.

**Claude Code:**

```bash
claude mcp add --transport http bconnect-endpoints https://mcp-gateway.company.com/endpoints/mcp
claude mcp add --transport http bconnect-assets    https://mcp-gateway.company.com/assets/mcp
```

Add `--header "Authorization: Bearer …"` if your proxy expects a token.

**Claude Desktop:** `claude_desktop_config.json` starts local (stdio) servers. To reach the
gateway from there, run a local stdio-to-HTTP bridge as the `command`, or use the servers
directly over stdio as shown above.

Available gateway domains: `activedirectory`, `assets`, `compliance`,
`defensecontrol`, `endpoints`, `groups`, `jobs`, `operatingsystems`,
`servermanagement`, `software`, `universaldynamicgroups`, `updatemanagement`,
`variables`.

---

## Verify Installation

Start a server and confirm it responds:

With a `.env` in the server directory (see [Configuration](#configuration)):

```bash
cd bconnect-endpoints-mcp
node build/index.js
# Expected on stderr:
#   bconnect-endpoints-mcp: verifying bConnect API connectivity...
#   bconnect-endpoints-mcp: API connectivity verified.
#   bconnect-endpoints-mcp started on stdio
```

The server then waits for an MCP client on stdin; stop it with Ctrl+C. If it exits instead, the
message says why; see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#server-exits-at-startup).

Test API connectivity:

```bash
curl --cacert /path/to/bms-ca.pem -u "username" -w '\nHTTP %{http_code}\n' \
  "https://your-bms-server:443/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
```

curl asks for the password, so it doesn't end up in your shell history. With an API key,
use `-H "X-Api-Key: <key>"` instead of `-u`. Leave out `--cacert` if your system already
trusts the bMS certificate. Don't add `-k`: it skips the certificate check, so curl would
succeed where the MCP servers fail.

---

## Next Steps

- See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) if you encounter issues
- See [DOCKER.md](DOCKER.md) for containerised deployment
- See [N8N.md](N8N.md) for using the gateway from n8n workflows

---

*bConnect MCP Suite — 13 servers; 276 tools on bMS 26R1, 240 on 25R2*
