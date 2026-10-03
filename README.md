# bConnect MCP Server

Connect your AI assistant to the **baramundi Management Suite** (bMS). This project provides MCP servers that let AI tools like Claude Desktop, Claude Code, GitHub Copilot or others read and manage your bMS — endpoints, jobs, software, compliance, and more — through the bConnect REST API.

> [!WARNING] 
> 🧪 This project is currently in **Technical Preview**.
> 
> We're actively refining this project and welcome early feedback. 
> Features, APIs, and behavior may change over time.
> 
> Please perform thorough testing before deployment and use at your own risk. It is *not* recommended for production use.
>
> When working with AI services, carefully review permissions, data access, and information shared with models.
> Avoid using sensitive, confidential, or personal data unless you have verified that your security, privacy, and compliance requirements are met.
>  
> Keep an eye on AI token usage, especially during testing, as costs can add up quickly depending on the model and workload.

**276 tools** across **13 servers**, compatible with **baramundi Management Suite 2025 R2 and 2026 R1**.

---

## What You Need

- A **baramundi Management Suite** (25R2 or 26R1) with bConnect API enabled
- Your **bMS server address** (e.g. `https://bms.company.com:443/bconnect`)
- A **bMS user account** with API access, or an **API key**
  (generate one in the baramundi Management Center under **Server Management > API Keys**)
- **Node.js 22.15 or 24** ([download](https://nodejs.org/)), the versions CI tests; 22.15 and later also honor the OS/Windows CA trust store. The packages still allow Node.js 20, but it isn't tested.

### Network Requirements

- Port **443** (HTTPS) must be open between the machine running the MCP server and your bMS server
  - 443 is the default. Some installations expose bConnect on a different port (e.g. **444** in older/test setups) — check the bConnect port in your baramundi Management Center and adjust the port in `BCONNECT_BASE_URL` accordingly.
- Test connectivity: `curl -sS -o /dev/null -w '%{http_code}\n' https://bms.company.com:443/bconnect/`. Any HTTP status, even 401 or 404, means the network and the certificate are fine. Add `--cacert <your-ca.pem>` for an internal CA; don't use `-k`, it hides exactly the certificate problem the servers would hit.

---

## Getting Started (Step by Step)

### Step 1: Download

**Prefer a pre-built download?** Grab the latest `bconnect-mcp-suite-<version>.zip` from the [**Releases page**](https://github.com/baramundisoftware/bConnect-MCP/releases) — it ships the compiled output, so you can **skip the build (Step 2)**: extract it, run `npm ci --omit=dev` at the extracted root, then jump to Step 3. See the bundled `INSTALL.md`.

> This README describes the current `main` branch. The latest release may predate some of it; the changes since then are listed under [Unreleased] in [CHANGELOG.md](CHANGELOG.md).

To build from source instead:

```bash
git clone https://github.com/baramundisoftware/bConnect-MCP.git
cd bConnect-MCP
```

### Step 2: Build the Suite

The 13 servers share a common package (`@bconnect/mcp-core`), so they build **together from the repo root** — the shared core first, then the servers. Building a single server directory on its own fails with `Cannot find module '@bconnect/mcp-core'`.

```bash
# from the repo root (bConnect-MCP) — NOT a server subdirectory
npm ci
npm run build -w @bconnect/mcp-core   # build the shared core first
npm run build                          # then all servers
```

> **On Windows:** `npm run build` loops over the server directories using bash syntax that `cmd.exe`
> cannot parse (`d was unexpected at this time`). npm runs scripts with `cmd.exe` whichever shell you
> type in, so make Git Bash npm's script shell once (it applies to all your npm projects):
> `npm config set script-shell "C:\Program Files\Git\bin\bash.exe"`.
> Git Bash ships with [Git for Windows](https://gitforwindows.org/).

> Only need one server? After the `npm ci` + core build above, build just that one:
> `npm run build -w bconnect-endpoints-mcp`.

### Step 3: Configure Your bMS Connection

We'll start with `bconnect-endpoints-mcp` (endpoint management — the most common use case). Copy its example config and fill in your values:

```bash
cd bconnect-endpoints-mcp
cp .env.example .env
```

Edit `.env`:

```env
# Your bMS server address (include /bconnect at the end)
BCONNECT_BASE_URL=https://bms.company.com:443/bconnect

# Option 1: API Key (recommended)
BCONNECT_API_KEY=your-api-key-here

# Option 2: Username + Password (use one or the other, not both)
# BCONNECT_USERNAME=your-username
# BCONNECT_PASSWORD=your-password

# Your bMS version: 26R1 or 25R2, spelt exactly so
BCONNECT_RELEASE=26R1
```

### Step 4: Start the Server

From the `bconnect-endpoints-mcp` directory (where you are after Step 3 — it holds
your `.env` and the `build/` output):

```bash
node build/index.js
```

You should see (these status lines go to **stderr**):

```
bconnect-endpoints-mcp: verifying bConnect API connectivity...
bconnect-endpoints-mcp: API connectivity verified.
bconnect-endpoints-mcp started on stdio
```

### Step 5: Verify It Works

In another terminal, send a test request. Run this **from the repo root** and point at
the server's build output — credentials are passed inline, so no `.env` is needed:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  BCONNECT_BASE_URL=https://bms.company.com:443/bconnect \
  BCONNECT_API_KEY=your-api-key \
  node bconnect-endpoints-mcp/build/index.js
```

You should see a JSON response listing all available tools (e.g. `list_windows_endpoints`, `get_windows_endpoint`, etc.). (`build/index.js` lives inside each **server** directory, never at the repo root.)

### Step 6: Connect to Your AI Assistant

**Claude Desktop** — edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "command": "node",
      "args": ["/path/to/bconnect-endpoints-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms.company.com:443/bconnect",
        "BCONNECT_API_KEY": "your-api-key",
        "BCONNECT_RELEASE": "26R1"
      }
    }
  }
}
```

**Claude Code (CLI)** — register the server with `claude mcp add` (use an **absolute** path to `build/index.js`):

```bash
claude mcp add bconnect-endpoints \
  --scope user \
  --env BCONNECT_BASE_URL=https://bms.company.com:443/bconnect \
  --env BCONNECT_API_KEY=your-api-key \
  --env BCONNECT_RELEASE=26R1 \
  -- node /path/to/bconnect-endpoints-mcp/build/index.js
```

> **Scope matters.** The default `--scope local` keys the config to the directory you
> run `claude` from, so the server loads only in that project (and won't appear if you
> start `claude` elsewhere). Use `--scope user` to make it available in every project,
> or `--scope project` to commit it to the repo's `.mcp.json` for the team.

**VS Code / GitHub Copilot, Cursor, Continue, LibreChat and others** — see
[docs/CLIENTS.md](docs/CLIENTS.md): the file, the top-level key (VS Code uses `servers`) and the
`"type"` field differ per client. It also shows how to keep the credentials out of the client's
configuration with `node --env-file`.

Restart your AI assistant. You can now ask it questions like:
- *"List all Windows endpoints"*
- *"Show me endpoints that haven't been seen in 30 days"*
- *"What software is installed on endpoint X?"*

---

## Docker Deployment

The **gateway** (multi-user / n8n) is published as a multi-arch image (linux/amd64 + arm64) on GHCR — browse it on the [**Packages page**](https://github.com/orgs/baramundisoftware/packages?repo_name=bConnect-MCP):

```bash
docker pull ghcr.io/baramundisoftware/bconnect-mcp-gateway:latest
```

Only the gateway is distributed as a container; the 13 stdio servers run via Node.js / Claude Desktop (see [Getting Started](#getting-started-step-by-step) above). See [docs/DOCKER.md](docs/DOCKER.md) for the full gateway guide — Compose, `docker run`, TLS/auth, and mounted secrets.

---

## Available Servers

| Server | Tools on 26R1 | Tools on 25R2 | What It Does |
|--------|------|------|--------------|
| `bconnect-endpoints-mcp` | 66 | 60 | Windows/Linux/Mac/Android/iOS/industrial endpoints, logical groups, maintenance windows |
| `bconnect-groups-mcp` | 33 | 33 | Endpoints by logical/static/dynamic/universal dynamic group and by AD user |
| `bconnect-jobs-mcp` | 34 | 34 | Job definitions, instances, folders, kiosk releases |
| `bconnect-servermanagement-mcp` | 30 | 25 | Management server, microservices, security groups, API keys |
| `bconnect-assets-mcp` | 26 | 24 | Asset inventory, asset types, stock folders |
| `bconnect-software-mcp` | 19 | 4 | Installed software inventory, software bundles |
| `bconnect-activedirectory-mcp` | 16 | 16 | AD groups, users, objects, organizational units |
| `bconnect-variables-mcp` | 13 | 13 | Variable definitions and instances |
| `bconnect-defensecontrol-mcp` | 13 | 11 | BitLocker, local admin accounts, Defender threats |
| `bconnect-operatingsystems-mcp` | 9 | 9 | OS folders and the OS deployment settings of Windows endpoints |
| `bconnect-compliance-mcp` | 8 | — | Compliance violations, CVE vulnerabilities (needs 26R1) |
| `bconnect-universaldynamicgroups-mcp` | 6 | — | Universal Dynamic Group definitions (needs 26R1) |
| `bconnect-updatemanagement-mcp` | 3 | 3 | Windows Update management |
| **Total** | **276** | **232** | |

Set `BCONNECT_RELEASE=25R2` for a 2025 R2 bMS. Compliance and universal dynamic groups don't exist
there: don't configure those two servers for a 25R2 bMS.

Install only the servers you need. Most users start with `bconnect-endpoints-mcp`.

---

## Configuration Reference

The variables most deployments set. Each server's README lists exactly the variables that server reads.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect API URL (e.g. `https://bms.company.com:443/bconnect`) |
| `BCONNECT_API_KEY` | Yes* | — | API key for authentication |
| `BCONNECT_USERNAME` | Yes* | — | Username for Basic Auth |
| `BCONNECT_PASSWORD` | Yes* | — | Password for Basic Auth |
| `BCONNECT_RELEASE` | — | `26R1` | bMS version: `25R2` or `26R1`, spelt exactly so |
| `BCONNECT_CA_CERT_PATH` | — | — | Path to CA certificate (PEM) for self-signed certs |
| `ALLOW_WRITE_OPERATIONS` | — | off | `true` enables the write tools (create, update, delete, start, assign …) |
| `ALLOW_SECRET_READ` | — | off | `true` enables the tools that return BitLocker keys/PIN or LAPS passwords (defensecontrol) |
| `BCONNECT_TIMEOUT_MS` | — | `30000` | How long to wait for bConnect, 1000 to 600000 ms |
| `BCONNECT_MAX_RETRIES` | — | `0` | Retries for reads after a network error, a timeout or 502/503/504, 0 to 5; writes are never retried |
| `BCONNECT_ALLOW_INSECURE_HTTP` | — | `false` | `http://` base URLs are refused except for this machine; `true` allows them (credentials unencrypted) |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | — | `false` | `true` skips the startup call to bConnect |
| `BCONNECT_AUDIT_LEVEL` | — | `none` | Audit logging: `none`, `security`, `write` or `all`, in any case; levels are cumulative. Any other value stops the server. Entries go to stderr; what each level records: [docs/AUDIT.md](docs/AUDIT.md) |
| `BCONNECT_RATE_LIMIT_ENABLED` | — | `false` | Limit the requests one client sends. Each tool call still creates a new client, so the limit doesn't apply across calls yet (#160) |
| `MCP_TRANSPORT` | — | `stdio` | Transport: `stdio` (local) or `http` (loopback only, no authentication) |
| `MCP_PORT` | — | `3000` | HTTP port (when `MCP_TRANSPORT=http`) |
| `MCP_BIND` | — | `127.0.0.1` | HTTP bind address (when `MCP_TRANSPORT=http`) |
| `MCP_GATEWAY_PORT` | — | `3001` | Gateway listen port (when using `bconnect-mcp-gateway`) |
| `MCP_GATEWAY_BIND` | — | `127.0.0.1` | Gateway bind address (loopback-only unless behind a proxy) |
| `MCP_ALLOW_NO_AUTH` | — | `false` | Allow a non-loopback bind (gateway or HTTP mode); asserts an authenticating proxy is in front |

> \* **Authentication**: provide either `BCONNECT_API_KEY` alone, or both `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. API key takes precedence if both are set. The password must be ASCII only (bConnect rejects `§`, umlauts or `ß`; the servers refuse such a password before signing in).

### How to Find Your bMS Server URL

1. Open the **baramundi Management Center** on your bMS server
2. The server address is the machine name or IP where bMS is installed
3. bConnect listens on **port 443** by default (HTTPS). If your installation uses a different port (e.g. **444** in older/test setups), use that port instead — you can check it in the bConnect settings of the Management Center
4. Your URL will be: `https://<server-name>:443/bconnect`

### How to Generate an API Key

1. Open the **baramundi Management Center**
2. Go to **Server Management > API Keys**
3. Click **Create New API Key**
4. Give it a descriptive name (e.g. "MCP Server bConnect")
5. Copy the generated key — you won't see it again
6. Use this key as `BCONNECT_API_KEY`

### SSL/TLS Certificates

If your bMS server uses a self-signed or internal CA certificate:

- On **Node.js ≥ 22.15** the servers also trust the machine's OS certificate store, so a CA
  the machine already trusts needs no setting.
- Otherwise provide the CA certificate:
  ```env
  BCONNECT_CA_CERT_PATH=/path/to/your-ca-cert.pem
  ```
  or Node's own `NODE_EXTRA_CA_CERTS=/path/to/your-ca-cert.pem`.

Don't set `NODE_TLS_REJECT_UNAUTHORIZED=0`, not even for a test: it turns off certificate checks for every TLS connection of the process, so anyone in the network path can pose as the bMS, receive the credentials and send the model forged data.

---

## Client Configuration Examples

Configuration for Claude Desktop, Claude Code, VS Code / GitHub Copilot, Cursor, Continue,
LibreChat and HTTP-only clients: **[docs/CLIENTS.md](docs/CLIENTS.md)**.

### Centralized Gateway (HTTP, multi-user)

`bconnect-mcp-gateway` serves all 13 servers on a single HTTP port — the option for
teams and n8n.

> ## ⚠️ Security: you MUST put authentication in front of the gateway
>
> **The gateway has no built-in authentication.** On its own it is an unauthenticated
> HTTP proxy to bConnect — anyone who can reach its port can call every read tool using the
> gateway's bMS credential. Securing it is **your responsibility as the operator** (the
> standard model for self-hosted infrastructure services).
>
> **How to solve it — front the gateway with a TLS-terminating, authenticating reverse
> proxy or your IdP's application proxy** (nginx, Caddy, Traefik, Entra Application
> Proxy, oauth2-proxy, …). That proxy must:
> - **terminate TLS** — tokens and data must never travel in cleartext;
> - **authenticate every caller** against your identity provider (OIDC / SAML / SSO);
> - **reach the gateway only over a private/loopback network** — publish the proxy, not the gateway;
> - **check `Host` and `Origin`**, and **strip any client-supplied identity headers** before forwarding.
>
> As a fail-closed safeguard the gateway **refuses to start on a non-loopback bind**
> unless you set `MCP_ALLOW_NO_AUTH=true` — your explicit assertion that an
> authenticating proxy is in front. For the same reason, write tools and secret reads are
> off in the gateway. Details: [docs/DOCKER.md](docs/DOCKER.md#tls-and-authentication-operator-responsibility).

**Credentials.** The gateway uses a single bConnect service credential (`BCONNECT_*`)
for all downstream calls, and **bMS RBAC governs what it can do** — scope that account
to least privilege.

**Start** (the compose file builds the image from this checkout; to use the published
image, see [docs/DOCKER.md](docs/DOCKER.md)):

```bash
cp .env.gateway.example .env.gateway
# Edit .env.gateway — set BCONNECT_BASE_URL and the BCONNECT_* service credential

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d
```

**Configure each client** to connect *through your authenticating proxy* (which supplies
whatever credential/session the proxy requires). Claude Code:

```bash
claude mcp add --transport http bconnect-endpoints https://mcp-gateway.company.com/endpoints/mcp
```

In a configuration file (here `.mcp.json`; other clients: [docs/CLIENTS.md](docs/CLIENTS.md#through-the-http-gateway)):

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "type": "http",
      "url": "https://mcp-gateway.company.com/endpoints/mcp"
    }
  }
}
```

Claude Desktop starts only local (stdio) servers from its configuration file; use the servers
directly there.

Available domains: `activedirectory`, `assets`, `compliance`, `defensecontrol`,
`endpoints`, `groups`, `jobs`, `operatingsystems`, `servermanagement`, `software`,
`universaldynamicgroups`, `updatemanagement`, `variables`.

For using the gateway from **n8n workflows**, see [docs/N8N.md](docs/N8N.md).

> A single server also has an HTTP mode (`MCP_TRANSPORT=http`), for local use only: it binds
> loopback and has no authentication. For access from other machines, use the gateway.

---

## Build All Servers

From the repo root — install the workspace once, build the shared core, then all servers:

```bash
npm ci
npm run build -w @bconnect/mcp-core   # shared core first
npm run build                          # all servers
```

> **On Windows:** `npm run build`, `npm run audit` and `npm run sbom` use bash syntax that `cmd.exe`
> cannot parse (`d was unexpected at this time`). Set Git Bash as npm's script shell once, as
> described in [Getting Started](#getting-started-step-by-step).

## Testing

From the repo root, after the build above:

```bash
npm test          # every server's tests plus the suite-wide checks
npm run lint
```

Optional tiers run by hand: [docs/MOCK_INTEGRATION_TESTING.md](docs/MOCK_INTEGRATION_TESTING.md)
(against bConnect-Mock) and [docs/LIVE_BMS_TESTING.md](docs/LIVE_BMS_TESTING.md) (read-only,
against a real bMS).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **Connection refused** | Check `BCONNECT_BASE_URL` includes `/bconnect`. Verify port 443 is open and the bConnect service is running on your bMS server. |
| **SSL/TLS certificate errors** | Run on Node.js ≥ 22.15 (OS trust store), or set `BCONNECT_CA_CERT_PATH` or `NODE_EXTRA_CA_CERTS` to your CA certificate. Don't turn verification off. |
| **401 Unauthorized** | Verify your credentials. If using an API key, check it hasn't expired. If using Basic Auth, confirm the user has bConnect API access in the bMS console. |
| **A tool answers with an error from bConnect** | The answer names the status, the call, what the bConnect API documentation says the status means for that call, and bConnect's own message. A 404 can mean a wrong id, missing read rights or, on some calls, "no data"; the documented meaning says which apply. |
| **"The bConnect API didn't answer within 30 s" on vulnerability or installed-software lists** | These lists are slow on a large or busy bMS (30 to 50 s on a test bMS 26R1). Set `BCONNECT_TIMEOUT_MS=90000`; see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md). |
| **Server exits at startup with "cannot reach bConnect API"** | The startup call failed; the line before it names the cause (credentials, certificate, timeout, address). Check that `BCONNECT_BASE_URL` ends in `/bconnect`. See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md#server-exits-at-startup). |
| **404 only on some tools** | They may need 26R1. On a 25R2 bMS set `BCONNECT_RELEASE=25R2`, which hides them. |
| **compliance / universaldynamicgroups won't start** | These servers need 26R1: their startup check fails on a 25R2 bMS. Remove them from your config. |
| **"BCONNECT_BASE_URL uses http://"** | Use `https://`. `http://` is allowed only for this machine or with `BCONNECT_ALLOW_INSECURE_HTTP=true` (credentials unencrypted). |
| **"Redirects are not followed"** | bConnect or a proxy redirected the call. Set `BCONNECT_BASE_URL` to the final address. |
| **"Unknown argument(s) for …"** | The tool doesn't have that argument (often a misspelt filter); the message lists the ones it accepts. |
| **Password with `§`, umlauts or `ß` refused** | bConnect only accepts ASCII passwords. Change the password or use an API key. |
| **Tool not showing in AI assistant** | Restart your AI assistant after changing the MCP config. Verify the server process starts without errors. |

For detailed troubleshooting, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

---

## Security

- **Keep credentials out of shared files** — use a `.env` or env file readable only by you (`node --env-file`, see [docs/CLIENTS.md](docs/CLIENTS.md)), never commit it
- **Use API keys** instead of username/password when possible
- **Use `BCONNECT_CA_CERT_PATH`** for self-signed certificates instead of disabling TLS
- **Audit logging** (`BCONNECT_AUDIT_LEVEL=security`, `write` or `all`) writes to stderr; `security` records every call to a security-relevant route: credentials, API keys, object rights, security groups and profiles ([docs/AUDIT.md](docs/AUDIT.md))
- **Write tools are off** unless `ALLOW_WRITE_OPERATIONS=true`, and off in the gateway. A write tool whose description ends with "Not yet verified against a live bMS." hasn't been checked against a real bMS yet. Try writes on a test system first
- **Secret reads** (BitLocker keys/PIN, LAPS passwords) are off unless `ALLOW_SECRET_READ=true`, and off in the gateway
- **Rate limiting** (`BCONNECT_RATE_LIMIT_ENABLED=true`) applies only within one tool call for now; it does not protect the bConnect API across calls (#160)

See [SECURITY.md](SECURITY.md) for the full security policy.

---

## Architecture

Each server is an independent Node.js process that connects directly to the bConnect REST API. Servers share no **runtime** state — but they are built from a shared code library (`@bconnect/mcp-core`); see [Repository layout](#repository-layout) below.

```
AI Assistant (Claude, VS Code, etc.)
    │
    ├── bconnect-endpoints-mcp              → Endpoints, groups, maintenance windows
    ├── bconnect-groups-mcp                 → Endpoints by group and by AD user
    ├── bconnect-jobs-mcp                   → Jobs, instances, folders, kiosk
    ├── bconnect-assets-mcp                 → Assets, types, stock folders
    ├── bconnect-activedirectory-mcp        → AD groups, users, org units
    ├── bconnect-servermanagement-mcp       → Server config, API keys, microservices
    ├── bconnect-software-mcp               → Software inventory, bundles
    ├── bconnect-variables-mcp              → Variables and instances
    ├── bconnect-defensecontrol-mcp         → BitLocker, Defender, local admins
    ├── bconnect-operatingsystems-mcp       → OS folders, Windows endpoints' OS settings
    ├── bconnect-compliance-mcp             → CVE vulnerabilities (26R1 only)
    ├── bconnect-universaldynamicgroups-mcp → Dynamic groups (26R1 only)
    └── bconnect-updatemanagement-mcp       → Windows Update management
```

### Repository layout

This repo is an **npm workspaces monorepo**: all workspace members share one root `package-lock.json` and a common library, which is why builds run from the root (`@bconnect/mcp-core` first, then the servers).

```
bConnect-MCP/
├── packages/
│   └── mcp-core/              @bconnect/mcp-core — the shared library every server
│                             imports: BConnectClientBase (HTTP / auth / TLS / retry),
│                             configuration, argument validation, error results,
│                             audit logging, response cleaning.
├── bconnect-endpoints-mcp/   ┐  the 13 domain MCP servers (stdio) — each a workspace
│   … (13 servers) …          │  member depending on @bconnect/mcp-core. A fix in the
├── bconnect-variables-mcp/   ┘  core applies to all 13 at once.
├── bconnect-server-template/    scaffold for adding a new server (workspace member)
├── bconnect-mcp-gateway/        optional HTTP gateway (multi-user / n8n); NOT a
│                                workspace member — it bundles the core + all servers.
├── docs/                        installation, clients, Docker, n8n, troubleshooting,
│                                audit, mock and live testing
└── scripts/                     local CI, image publish, release (see package.json)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
