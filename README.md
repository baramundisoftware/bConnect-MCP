# bConnect MCP Suite

Connect your AI assistant to the **baramundi Management Suite** (bMS). This project provides MCP servers that let AI tools like Claude Desktop, Claude Code, Github Copilot or others read and manage your bMS — endpoints, jobs, software, compliance, and more — through the bConnect REST API.

**276 tools** across **13 servers**, compatible with **baramundi 25R2 and 26R1**.

---

## What You Need

- A **baramundi Management Suite** (25R2 or 26R1) with bConnect API enabled
- Your **bMS server address** (e.g. `https://bms.company.com:443/bconnect`)
- A **bMS user account** with API access, or an **API key**
  (generate one in the baramundi mangement console under **Server Management > API Keys**)
- **Node.js 20 or later** ([download](https://nodejs.org/)) — **22.15+ recommended** so the OS/Windows CA trust store is honored automatically

### Network Requirements

- Port **443** (HTTPS) must be open between the machine running the MCP server and your bMS server
  - 443 is the default. Some installations expose bConnect on a different port (e.g. **444** in older/test setups) — check the bConnect port in your baramundi Management Center and adjust the port in `BCONNECT_BASE_URL` accordingly.
- Test connectivity: `curl -k https://bms.company.com:443/bconnect/info/v2.0/Info`

---

## Getting Started (Step by Step)

### Step 1: Download

**Prefer a pre-built download?** Grab the latest `bconnect-mcp-suite-<version>.zip` from the [**Releases page**](https://github.com/baramundisoftware/bConnect-MCP/releases) — it ships the compiled output, so you can **skip the build (Step 2)**: extract it, run `npm ci --omit=dev` at the extracted root, then jump to Step 3. See the bundled `INSTALL.md`.

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

# Your bMS version: 26R1 or 25R2
BCONNECT_RELEASE=26R1

# For self-signed certificates (development only!)
# NODE_TLS_REJECT_UNAUTHORIZED=0
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

| Server | Tools | 25R2 | 26R1 | What It Does |
|--------|-------|------|------|--------------|
| `bconnect-endpoints-mcp` | 66 | Yes | Yes | Windows/Linux/Mac/Android/iOS endpoints, logical groups, maintenance windows |
| `bconnect-groups-mcp` | 33 | Yes | Yes | Endpoints by logical/static/dynamic/AD group |
| `bconnect-jobs-mcp` | 34 | Yes | Yes | Job definitions, instances, folders, kiosk releases |
| `bconnect-servermanagement-mcp` | 30 | Yes | Yes | Management server, microservices, security groups, API keys |
| `bconnect-assets-mcp` | 26 | Yes | Yes | Asset inventory, asset types, stock folders |
| `bconnect-software-mcp` | 19 | Yes | Yes | Installed software inventory, software bundles |
| `bconnect-activedirectory-mcp` | 16 | Yes | Yes | AD groups, users, objects, organizational units |
| `bconnect-variables-mcp` | 13 | Yes | Yes | Variable definitions and instances |
| `bconnect-defensecontrol-mcp` | 13 | Yes | Yes | BitLocker, local admin accounts, Defender threats |
| `bconnect-operatingsystems-mcp` | 9 | Yes | Yes | OS deployment folders and profiles |
| `bconnect-compliance-mcp` | 8 | No | Yes | Compliance violations, CVE vulnerabilities (26R1 only) |
| `bconnect-universaldynamicgroups-mcp` | 6 | No | Yes | Universal Dynamic Group definitions (26R1 only) |
| `bconnect-updatemanagement-mcp` | 3 | Yes | Yes | Windows Update management |
| **Total** | **276** | | | |

Install only the servers you need. Most users start with `bconnect-endpoints-mcp`.

---

## Configuration Reference

All servers use the same environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect API URL (e.g. `https://bms.company.com:443/bconnect`) |
| `BCONNECT_API_KEY` | Yes* | — | API key for authentication |
| `BCONNECT_USERNAME` | Yes* | — | Username for Basic Auth |
| `BCONNECT_PASSWORD` | Yes* | — | Password for Basic Auth |
| `BCONNECT_RELEASE` | — | `26R1` | bMS version: `25R2` or `26R1` |
| `BCONNECT_CA_CERT_PATH` | — | — | Path to CA certificate (PEM) for self-signed certs |
| `BCONNECT_AUDIT_LEVEL` | — | `none` | Audit logging: `none`, `info`, or `verbose` |
| `BCONNECT_RATE_LIMIT_ENABLED` | — | `false` | Enable rate limiting to protect the bConnect API |
| `MCP_TRANSPORT` | — | `stdio` | Transport: `stdio` (local) or `http` (network) |
| `MCP_PORT` | — | `3000` | HTTP port (when `MCP_TRANSPORT=http`) |
| `MCP_GATEWAY_PORT` | — | `3001` | Gateway listen port (when using `bconnect-mcp-gateway`) |
| `MCP_GATEWAY_BIND` | — | `127.0.0.1` | Gateway bind address (loopback-only unless behind a proxy) |
| `MCP_ALLOW_NO_AUTH` | — | `false` | Allow a non-loopback gateway bind; asserts an authenticating proxy is in front |

> \* **Authentication**: provide either `BCONNECT_API_KEY` alone, or both `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. API key takes precedence if both are set.

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

**Recommended**: Provide the CA certificate:
```env
BCONNECT_CA_CERT_PATH=/path/to/your-ca-cert.pem
```

**Development only** (not for production!):
```env
NODE_TLS_REJECT_UNAUTHORIZED=0
```

---

## Client Configuration Examples

All examples show `bconnect-endpoints-mcp` for brevity. Add more servers by repeating the pattern.

### Claude Desktop (local, stdio)

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "command": "node",
      "args": ["/path/to/bconnect-endpoints-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms.company.com:443/bconnect",
        "BCONNECT_API_KEY": "your-api-key"
      }
    }
  }
}
```


### Centralized Gateway (HTTP, multi-user)

`bconnect-mcp-gateway` serves all 13 servers on a single HTTP port — the option for
teams and n8n.

> ## ⚠️ Security: you MUST put authentication in front of the gateway
>
> **The gateway has no built-in authentication.** On its own it is an unauthenticated
> HTTP proxy to bConnect — anyone who can reach its port can call every tool using the
> gateway's bMS credential. Securing it is **your responsibility as the operator** (the
> standard model for self-hosted infrastructure services).
>
> **How to solve it — front the gateway with a TLS-terminating, authenticating reverse
> proxy or your IdP's application proxy** (nginx, Caddy, Traefik, Entra Application
> Proxy, oauth2-proxy, …). That proxy must:
> - **terminate TLS** — tokens and data must never travel in cleartext;
> - **authenticate every caller** against your identity provider (OIDC / SAML / SSO);
> - **reach the gateway only over a private/loopback network** — publish the proxy, not the gateway;
> - **strip any client-supplied identity headers** before forwarding.
>
> As a fail-closed safeguard the gateway **refuses to start on a non-loopback bind**
> unless you set `MCP_ALLOW_NO_AUTH=true` — your explicit assertion that an
> authenticating proxy is in front. Details: [docs/DOCKER.md](docs/DOCKER.md) → "TLS and authentication".

**Credentials.** The gateway uses a single bConnect service credential (`BCONNECT_*`)
for all downstream calls, and **bMS RBAC governs what it can do** — scope that account
to least privilege. (Per-user bConnect credentials keyed by the proxy-asserted identity
are a planned option.)

**Start:**

```bash
cp .env.gateway.example .env.gateway
# Edit .env.gateway — set BCONNECT_BASE_URL and the BCONNECT_* service credential

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d
```

**Configure each client** to connect *through your authenticating proxy* (which supplies
whatever credential/session the proxy requires):

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "url": "https://mcp-gateway.company.com/endpoints/mcp"
    }
  }
}
```

Available domains: `activedirectory`, `assets`, `compliance`, `defensecontrol`,
`endpoints`, `groups`, `jobs`, `operatingsystems`, `servermanagement`, `software`,
`universaldynamicgroups`, `updatemanagement`, `variables`.

For using the gateway from **n8n workflows**, see [docs/N8N.md](docs/N8N.md).

### Centralized Server (HTTP, single credential set)

Run a single server on a central machine when all users share one bConnect credential
(from the repo root — point at the server's build output):

```bash
MCP_TRANSPORT=http MCP_PORT=3000 \
BCONNECT_BASE_URL=https://bms.company.com:443/bconnect \
BCONNECT_API_KEY=your-api-key \
node bconnect-endpoints-mcp/build/index.js
```

Then configure each workstation's AI assistant to connect to the central server:

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "url": "http://mcp-server.company.com:3000/mcp"
    }
  }
}
```

### Other MCP Clients

Most MCP clients use the same JSON format. Add to your client's configuration file
(e.g. `.mcp.json`, `.vscode/mcp.json`, or equivalent):

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "command": "node",
      "args": ["/path/to/bconnect-endpoints-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms.company.com:443/bconnect",
        "BCONNECT_API_KEY": "your-api-key"
      }
    }
  }
}
```

---

## Build All Servers

From the repo root — install the workspace once, build the shared core, then all servers:

```bash
npm ci
npm run build -w @bconnect/mcp-core   # shared core first
npm run build                          # all servers
```

## Testing

```bash
# Test a single server
cd bconnect-endpoints-mcp && npm test

# Test all servers
for dir in bconnect-*-mcp; do
  (cd "$dir" && npm test)
done
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **Connection refused** | Check `BCONNECT_BASE_URL` includes `/bconnect`. Verify port 443 is open and the bConnect service is running on your bMS server. |
| **SSL/TLS certificate errors** | Set `BCONNECT_CA_CERT_PATH` to your CA certificate. Only use `NODE_TLS_REJECT_UNAUTHORIZED=0` for development. |
| **401 Unauthorized** | Verify your credentials. If using an API key, check it hasn't expired. If using Basic Auth, confirm the user has bConnect API access in the bMS console. |
| **404 Not Found** | Verify `BCONNECT_RELEASE` matches your bMS version. 26R1 endpoints don't exist on a 25R2 server. |
| **compliance / universaldynamicgroups won't start** | These servers require 26R1. Remove them from your config when using a 25R2 bMS. |
| **Tool not showing in AI assistant** | Restart your AI assistant after changing the MCP config. Verify the server process starts without errors. |

For detailed troubleshooting, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

---

## Security

- **Never hardcode credentials** — always use environment variables or `.env` files
- **Use API keys** instead of username/password when possible
- **Use `BCONNECT_CA_CERT_PATH`** for self-signed certificates instead of disabling TLS
- **Enable audit logging** (`BCONNECT_AUDIT_LEVEL=info`) on production servers
- **Enable rate limiting** (`BCONNECT_RATE_LIMIT_ENABLED=true`) to protect your bConnect API

See [SECURITY.md](SECURITY.md) for the full security policy.

---

## Architecture

Each server is an independent Node.js process that connects directly to the bConnect REST API. Servers share no **runtime** state — but they are built from a shared code library (`@bconnect/mcp-core`); see [Repository layout](#repository-layout) below.

```
AI Assistant (Claude, VS Code, etc.)
    │
    ├── bconnect-endpoints-mcp              → Endpoints, groups, maintenance windows
    ├── bconnect-jobs-mcp                   → Jobs, instances, folders, kiosk
    ├── bconnect-assets-mcp                 → Assets, types, stock folders
    ├── bconnect-activedirectory-mcp        → AD groups, users, org units
    ├── bconnect-servermanagement-mcp       → Server config, API keys, microservices
    ├── bconnect-software-mcp               → Software inventory, bundles
    ├── bconnect-variables-mcp              → Variables and instances
    ├── bconnect-defensecontrol-mcp         → BitLocker, Defender, local admins
    ├── bconnect-operatingsystems-mcp       → OS deployment profiles
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
│                             parameter validation, rate limiting, audit logging,
│                             response caching, batch operations.
├── bconnect-endpoints-mcp/   ┐  the 13 domain MCP servers (stdio) — each a workspace
│   … (13 servers) …          │  member depending on @bconnect/mcp-core. A fix in the
├── bconnect-variables-mcp/   ┘  core applies to all 13 at once.
├── bconnect-server-template/    scaffold for adding a new server (workspace member)
├── bconnect-mcp-gateway/        optional HTTP gateway (multi-user / n8n); NOT a
│                                workspace member — it bundles the core + all servers.
├── docs/                        installation, Docker, n8n, troubleshooting
└── scripts/                     local CI, image publish, release (see package.json)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
