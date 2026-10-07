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

**212 tools** across **13 servers** (211 on bMS 26R1, 166 on 25R2), compatible with **baramundi Management Suite 2025 R2 and 2026 R1**.

---

## Contents

- [Quick start](#quick-start)
- [Ways to install](#ways-to-install)
- [What you need](#what-you-need)
- [Available servers](#available-servers)
- [Configuration](#configuration)
- [Clients](#clients)
- [Gateway (HTTP, multi-user)](#gateway-http-multi-user)
- [Build and test](#build-and-test)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

---

## Quick start

One server, from source, registered in Claude Code. [docs/INSTALLATION.md](docs/INSTALLATION.md) is
the full guide (release download, checksums, Claude Desktop, the gateway, certificates).

> This README describes the current `main` branch. The latest release may predate some of it; the changes since then are listed under [Unreleased] in [CHANGELOG.md](CHANGELOG.md).

**1. Install and build** (Node.js 22.15 or 24; the 13 servers share `@bconnect/mcp-core`, so they
build together from the repo root):

```bash
git clone https://github.com/baramundisoftware/bConnect-MCP.git
cd bConnect-MCP
npm ci
npm run build
```

> **On Windows:** npm runs scripts with `cmd.exe`, which can't parse the build scripts (`d was
> unexpected at this time`). Make Git Bash npm's script shell once:
> `npm config set script-shell "C:\Program Files\Git\bin\bash.exe"`.

**2. Put the bMS settings in an env file** that only you can read, outside the repository (e.g.
`~/bconnect.env`, then `chmod 600 ~/bconnect.env`):

```env
BCONNECT_BASE_URL=https://bms.company.com:443/bconnect
BCONNECT_API_KEY=your-api-key
```

How to find the URL and create an API key, and every other setting:
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

**3. Check that the server answers.** From the repo root, this lists the server's tools without an
MCP client:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  node --env-file="$HOME/bconnect.env" bconnect-endpoints-mcp/build/index.js
```

The server first connects to the bMS, so this also checks the URL and the key: the startup log goes
to stderr, the tool list is one JSON line on stdout. If it stops with `cannot reach bConnect API`,
see [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md#server-exits-at-startup).

**4. Register it in Claude Code**, from the repo root, so the paths are absolute (`--scope user`
makes it available in every project):

```bash
claude mcp add bconnect-endpoints --scope user \
  -- node --env-file="$HOME/bconnect.env" "$PWD/bconnect-endpoints-mcp/build/index.js"
```

Restart Claude Code and ask, e.g. *"List all Windows endpoints"*. Other clients (Claude Desktop,
VS Code / GitHub Copilot, Cursor, …) and registering all 13 servers at once:
[docs/CLIENTS.md](docs/CLIENTS.md). If a server doesn't show up or stops at startup:
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

---

## Ways to install

There are three ways to get the suite. Pick one; the bMS settings are the same for all of them.

| Way | What you get | Needs | Best for | How |
| --- | --- | --- | --- | --- |
| **Release download** | `bconnect-mcp-suite-<version>.zip` from the [Releases page](https://github.com/baramundisoftware/bConnect-MCP/releases), already built (with a `.sha256` checksum file) | Node.js | one user, a fixed version, no build tools | [INSTALLATION.md](docs/INSTALLATION.md#from-the-release-download-no-build) (`npm ci --omit=dev`, no build; then steps 2–4 of the [Quick start](#quick-start)) |
| **From source** | a `git clone` of this repository, built locally | Node.js, Git | the newest changes on `main`, contributing | [Quick start](#quick-start), [INSTALLATION.md](docs/INSTALLATION.md#from-source) |
| **Gateway container** | the image `ghcr.io/baramundisoftware/bconnect-mcp-gateway` from [GitHub Packages](https://github.com/orgs/baramundisoftware/packages?repo_name=bConnect-MCP) | Docker | several users or tools (e.g. n8n) sharing one HTTP endpoint | [Gateway](#gateway-http-multi-user) |

The first two run the 13 servers as local processes that your AI assistant starts over stdio. The
container runs the HTTP gateway, which serves all 13 servers to clients over the network; the gateway
can also run without Docker from a source build; the release download doesn't include it (see
[Gateway](#gateway-http-multi-user)).

The servers are not published to the npm registry, so `npx` / `npm install -g` don't apply.

---

## What you need

- A **baramundi Management Suite** (25R2 or 26R1) with the bConnect API enabled, its address
  (e.g. `https://bms.company.com:443/bconnect`) and an **API key** or a user with API access.
- **Node.js 22.15 or 24** ([download](https://nodejs.org/)), the versions CI tests; 22.15 and later
  also trust the operating system's CA store. Not needed for the gateway container.
- **Port 443** (HTTPS, or your bConnect port) open from the machine that runs the servers to the bMS.
  To check the network and the certificate first, see
  [INSTALLATION.md → Verifying TLS Is Working](docs/INSTALLATION.md#verifying-tls-is-working).

---

## Available servers

| Server | Tools on 26R1 | Tools on 25R2 | What It Does |
|--------|------|------|--------------|
| `bconnect-endpoints-mcp` | 32 | 25 | Windows/Linux/Mac/Android/iOS/network/industrial endpoints (one tool per operation, type as argument), logical groups, maintenance windows |
| `bconnect-groups-mcp` | 2 | 2 | Members of logical/static/dynamic/universal dynamic groups and endpoints of an AD user (group kind and member type as arguments) |
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
| **Total** | **211** | **166** | |

— means the server needs 26R1 and lists no tools on 25R2. Each release lists only the tools whose API routes it has: 26R1 has no industrial-endpoint tools, 25R2 no 26R1-only tools.

Each server reads the release from the bMS at startup and logs it (for example
`bMS 26.1.161.0 → release 26R1`); `BCONNECT_RELEASE` is only the fallback. Compliance and universal
dynamic groups don't exist in 2025 R2: don't configure those two servers for a 25R2 bMS. Started on
one, they stop at once and say so (`needs bMS 26R1; this server uses 25R2 …`).

Install only the servers you need. Most users start with `bconnect-endpoints-mcp`.

The counts include the write tools. While writes are off (the default, and always in the gateway),
the tool list leaves them out: 130 tools on 26R1, 100 on 25R2. Every MCP client loads the whole
tool list into the model's context, so this saves about 66 KB (≈ 19,000 tokens at 3.5 characters
per token, −33 %) per session on 26R1, and 55 KB (≈ 16,000 tokens, −34 %) on 25R2. A write tool called by name is still refused.

---

## Configuration

Every setting of the servers and the gateway, with its default and what it does, is in
**[docs/CONFIGURATION.md](docs/CONFIGURATION.md)**; each server's README lists the ones that server
reads. Most deployments set only these:

- [`BCONNECT_BASE_URL`](docs/CONFIGURATION.md#bconnect_base_url): `https://<your-bms-server>:443/bconnect`
  ([how to find it](docs/CONFIGURATION.md#how-to-find-your-bms-server-url)).
- One credential: [`BCONNECT_API_KEY`](docs/CONFIGURATION.md#bconnect_api_key)
  ([how to generate one](docs/CONFIGURATION.md#how-to-generate-an-api-key)), or
  [`BCONNECT_USERNAME`](docs/CONFIGURATION.md#bconnect_username) and
  [`BCONNECT_PASSWORD`](docs/CONFIGURATION.md#bconnect_password) (ASCII-only password).
- With an internal CA: [`BCONNECT_CA_CERT_PATH`](docs/CONFIGURATION.md#bconnect_ca_cert_path), unless
  Node.js 22.15 or later already trusts it ([TLS and CA certificates](docs/CONFIGURATION.md#tls-and-ca-certificates)).
- To allow changes: [`ALLOW_WRITE_OPERATIONS`](docs/CONFIGURATION.md#allow_write_operations)`=true`
  (off by default; the gateway always keeps it off).

**Compact tool results.** Tool results are compact JSON: the same data without indentation. Each
result stays in the model's context for the rest of the conversation, and the indentation alone was
16–22 % of it. Measured against the bConnect mock (bMS 26R1): `list_endpoints` (31 endpoints) 28.4 KB → 23.5 KB,
`list_endpoints` with type `WindowsEndpoint` (10) 10.5 KB → 8.8 KB, `list_job_instances` (5) 5.4 KB → 4.5 KB,
`list_job_definitions` (5) 2.2 KB → 1.7 KB. Set `BCONNECT_PRETTY_JSON=true` to get the indented
format back, for example while debugging.

**Counting without loading pages.** Every list tool that pages its results accepts `countOnly: true`.
The tool then asks bConnect for a single row with the same filters and returns only the total and the
filters it applied, for example `{"totalItems":10,"filters":{"DisplayName":"x"}}`. If bConnect's answer
has no total, the result says the count is unavailable instead of guessing; a note the tool adds (for
example that a parent object's existence couldn't be confirmed) is kept. Measured against the
bConnect mock (bMS 26R1): `list_endpoints` with type `WindowsEndpoint` 8.8 KB for one page of 10 endpoints, 54 bytes with
`countOnly` (`{"totalItems":10,"filters":{"type":"WindowsEndpoint"}}`). The option adds one short property to
each paged list tool, about 6.6 KB to the tool list on 26R1 (82 tools) and 5.1 KB on 25R2 (64 tools).

---

## Clients

Claude Code, Claude Desktop, VS Code / GitHub Copilot, Cursor, Continue, LibreChat and HTTP-only
clients, keeping the API key out of the client's configuration (`node --env-file`), and registering
all 13 servers at once: **[docs/CLIENTS.md](docs/CLIENTS.md)**.

---

## Gateway (HTTP, multi-user)

`bconnect-mcp-gateway` serves all 13 servers on one HTTP port, for teams and n8n. It is published as a
multi-arch image (linux/amd64 + arm64) on GHCR ([Packages page](https://github.com/orgs/baramundisoftware/packages?repo_name=bConnect-MCP)):

```bash
# The container binds 0.0.0.0, so it only starts with MCP_ALLOW_NO_AUTH=true: your assertion that a
# proxy in front handles authentication. Publishing on 127.0.0.1 keeps it off the network until then.
docker run -d --name bconnect-mcp-gateway \
  -p 127.0.0.1:3001:3001 \
  -e MCP_ALLOW_NO_AUTH=true \
  -e BCONNECT_BASE_URL=https://bms.company.com:443/bconnect \
  -e BCONNECT_API_KEY=your-service-key \
  ghcr.io/baramundisoftware/bconnect-mcp-gateway:latest

curl http://localhost:3001/health
# → {"status":"ok","servers":[…],"count":13}
```

Clients then connect to `http://localhost:3001/<server>/mcp`, e.g. `/endpoints/mcp`.

> **⚠️ The gateway has no built-in authentication.** Anyone who can reach its port can call every
> read tool with the gateway's bMS credential. Put a TLS-terminating, authenticating reverse proxy
> in front (nginx, Caddy, Traefik, Entra Application Proxy, oauth2-proxy, …) that authenticates every
> caller, reaches the gateway only over a private or loopback network, checks `Host` and `Origin`
> and strips client-supplied identity headers. The gateway refuses a non-loopback bind unless
> `MCP_ALLOW_NO_AUTH=true`, and it keeps write tools and secret reads off. It uses one service
> credential for every call, so bMS RBAC on that account decides what it can do: keep it least
> privilege.

Compose, TLS and authentication, mounted secrets and custom CA certificates:
[docs/DOCKER.md](docs/DOCKER.md); n8n workflows: [docs/N8N.md](docs/N8N.md); a source build without
Docker: [INSTALLATION.md → Option C](docs/INSTALLATION.md#option-c--gateway-http-multi-user). A single
server also has an HTTP mode (`MCP_TRANSPORT=http`), for local use only: it binds loopback and has no
authentication.

---

## Build and test

From the repo root (on Windows, with Git Bash as npm's script shell, see [Quick start](#quick-start)):

```bash
npm ci
npm run build     # the shared core first, then all servers and the template
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
| **Server exits at startup with "cannot reach bConnect API"** | The startup call failed; the cause is in brackets (credentials, certificate, timeout, address). Check that `BCONNECT_BASE_URL` ends in `/bconnect`. See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md#server-exits-at-startup). |
| **404 only on some tools** | They may need 26R1. Check the release the server logged at startup; if it says it could not detect the release, set `BCONNECT_RELEASE=25R2` for a 25R2 bMS, which hides them. |
| **compliance / universaldynamicgroups stop with "needs bMS 26R1"** | These servers need 26R1; on a 25R2 bMS they stop at startup and name the release in use. Remove them from your config. |
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
- **Write tools are off** unless `ALLOW_WRITE_OPERATIONS=true`, and off in the gateway. While they are off, the tool list leaves them out and a call by name is refused. A write tool whose description ends with "Not yet verified against a live bMS." hasn't been checked against a real bMS yet. Try writes on a test system first
- **Secret reads** (BitLocker keys/PIN, LAPS passwords) are off unless `ALLOW_SECRET_READ=true`, and off in the gateway
- **Tool hints for clients**: every tool declares MCP annotations: a readable `title`, `readOnlyHint: true` on tools that only read (they carry no `destructiveHint`), and on every other tool `readOnlyHint: false` plus `destructiveHint` (true for tools that delete or whose effect can't be undone, such as running a job or replacing a BitLocker PIN). A client can use them to run reads without asking and to ask before destructive calls. They are derived from the API operations each tool calls and are hints only: the write and secret gates above are unchanged and still decide what runs
- **Rate limiting** (`BCONNECT_RATE_LIMIT_ENABLED=true`) caps the requests each server sends to the bConnect API, across all its tool calls

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
