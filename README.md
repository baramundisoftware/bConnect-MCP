# bConnect MCP Suite

Connect your AI assistant to the **baramundi Management Suite** (bMS). This project provides MCP servers that let an MCP-capable client — Claude Desktop, Claude Code, VS Code (Copilot agent mode), Cursor, Continue, LibreChat, Open WebUI, n8n, OpenAI's Responses API / Agents SDK, Microsoft Copilot Studio, or anything else that speaks the protocol — read and manage your bMS through the bConnect REST API: endpoints, jobs, software, compliance, and more.

The servers are ordinary stdio MCP servers plus one Streamable-HTTP gateway, and nothing in them is client-specific. What differs between clients is only **which file the configuration goes in and what shape it takes** — see [Client Configuration](#client-configuration).

**141 tools** advertised by default across **14 servers** (**221** with `ALLOW_WRITE_OPERATIONS=true`
— see [Breaking change: 2026-08-02 tool surface revision](#breaking-change-2026-08-02-tool-surface-revision)).

> ## ⚠️ Requires baramundi Management Suite **26R1 or later**
>
> **25R2 and older are not supported.** Check your bMS release *before* installing: several
> tools call bConnect routes that only exist from 26R1 on, and publishing inaccurate data is
> worse than refusing to run. Each server reads the bMS version from
> `GET /v2.0/ManagementServer` during its startup connectivity check and **exits with a clear
> message naming the detected version** if it is older than 26R1. There is no
> `BCONNECT_RELEASE` setting any more — the release is detected, not configured.
>
> If your deployment legitimately cannot reach that route, `BCONNECT_SKIP_CONNECTIVITY_CHECK=true`
> skips the connectivity probe and the version gate with it. You are then on your own for
> compatibility.

---

## Contents

- [Quick start](#quick-start) — running in about a few minutes from the release zip
- [What you need](#what-you-need) — prerequisites and network requirements
- [Build from source](#build-from-source) — if you are not using the release zip
- [Client Configuration](#client-configuration) — per-client config files and shapes
- [Available servers](#available-servers) — the 14 servers and their tool counts
- [Configuration Reference](#configuration-reference) — environment variables
- [Docker deployment](#docker-deployment) — the multi-user HTTP gateway
- [Testing](#testing) · [Troubleshooting](#troubleshooting) · [Security](#security) · [Architecture](#architecture)
- [Breaking change: 2026-08-02 tool surface revision](#breaking-change-2026-08-02-tool-surface-revision)

---

## Quick start

Fastest path: the pre-built `bconnect-mcp-suite-<version>.zip` from the
[**Releases page**](https://github.com/baramundisoftware/bConnect-MCP/releases) ships compiled
output, so there is nothing to build. Extract it, then:

```bash
# 1. install runtime dependencies
npm ci --omit=dev

# 2. credentials — in an env file, never in a client config file
cat > bconnect.env <<'EOF'
BCONNECT_BASE_URL=https://bms.company.com:443/bconnect
BCONNECT_API_KEY=your-api-key-here
EOF

# 3. smoke-test the endpoints server (status lines go to stderr)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  node --env-file=bconnect.env bconnect-endpoints-mcp/build/index.js
```

A JSON response listing tools (`list_windows_endpoints`, `get_windows_endpoint`, …) means the
connection works. Now hand the **same command line** to your MCP client:

```json
{
  "bconnect-endpoints": {
    "type": "stdio",
    "command": "node",
    "args": [
      "--env-file=/path/to/bconnect.env",
      "/path/to/bconnect-endpoints-mcp/build/index.js"
    ]
  }
}
```

Put that entry in the file, and under the top-level key, your client expects — see
[Client Configuration](#client-configuration) below. Reload or restart your client (Claude
Desktop needs a **full quit** from the tray icon, VS Code a window reload, Claude Code a re-run
in the project directory). Then ask:

- *"List all Windows endpoints"*
- *"Show me endpoints that haven't been seen in 30 days"*
- *"What software is installed on endpoint X?"*

A guided installer that writes the client config for you ships in `install/`; see
[docs/INSTALLATION.md](docs/INSTALLATION.md).

---

## What You Need

- A **baramundi Management Suite 26R1 or later** with bConnect API enabled — **25R2 and older
  will not work**, and the servers refuse to start against them (see the box at the top)
- Your **bMS server address** (e.g. `https://bms.company.com:443/bconnect`)
- A **bMS user account** with API access, or an **API key**
  (generate one in the baramundi mangement console under **Server Management > API Keys**)
- **Node.js 20 or later** ([download](https://nodejs.org/)) — **22.15+ recommended** so the OS/Windows CA trust store is honored automatically, and because `--env-file` needs 20.6+
- Port **443** (HTTPS) open between the machine running the MCP server and your bMS server.
  443 is the default; some installations expose bConnect on a different port (e.g. **444** in
  older/test setups) — check it in the baramundi Management Center and adjust `BCONNECT_BASE_URL`
  accordingly. Test with `curl -k https://bms.company.com:443/bconnect/info/v2.0/Info`.

---

## Build from source

Skip this if you used the release zip. This repo is an **npm workspaces monorepo**: the servers
share `@bconnect/mcp-core`, so they build **together from the repo root**. Building a single
server directory on its own fails with `Cannot find module '@bconnect/mcp-core'`.

```bash
git clone https://github.com/baramundisoftware/bConnect-MCP.git
cd bConnect-MCP
npm ci
npm run build   # workspace order resolves itself: the shared core first, then the servers
```

> Only need one server? `npm run build -w bconnect-endpoints-mcp` — npm builds
> `@bconnect/mcp-core` first as its dependency.

Each server ships a `.env.example`. Copy it, fill in the values from
[Configuration Reference](#configuration-reference), and start the server:

```bash
cd bconnect-endpoints-mcp
cp .env.example .env
node build/index.js
```

Status lines go to **stderr**, then the server waits on stdio:

```
bconnect-endpoints-mcp: verifying bConnect API connectivity...
bconnect-endpoints-mcp: API connectivity verified.
bconnect-endpoints-mcp started on stdio
```

The connectivity step also reads the bMS release. On a bMS older than 26R1 the server prints
the detected version alongside the 26R1 requirement and exits instead of starting.
(`build/index.js` lives inside each **server** directory, never at the repo root.)

---

## Docker Deployment

The **gateway** (multi-user / n8n) is published as a multi-arch image (linux/amd64 + arm64) on GHCR — browse it on the [**Packages page**](https://github.com/orgs/baramundisoftware/packages?repo_name=bConnect-MCP):

```bash
docker pull ghcr.io/baramundisoftware/bconnect-mcp-gateway:latest
```

Only the gateway is distributed as a container; the stdio servers are plain Node.js processes that whichever MCP client you use spawns for itself. The gateway **must be authenticated** (`MCP_GATEWAY_AUTH_TOKEN`) before you expose it. See [docs/DOCKER.md](docs/DOCKER.md) for the full gateway guide — Compose, `docker run`, TLS/auth, and mounted secrets — and [docs/CLIENTS.md](docs/CLIENTS.md) for pointing clients at it.

---

## Available Servers

Every server requires bMS 26R1 (see the box at the top), so there is no longer a per-release
column. Tool counts were derived from the built servers' actual `tools/list` output — import the
built `createServer`, connect over the SDK `InMemoryTransport`, count and `JSON.stringify` the
result — not hand-counted. "Default" is what a fresh install sees; "writes enabled" is with
`ALLOW_WRITE_OPERATIONS=true` set (see [Breaking change](#breaking-change-2026-08-02-tool-surface-revision)
above).

| Server | Tools (default) | Tools (writes enabled) | What It Does |
|--------|:---:|:---:|--------------|
| `bconnect-endpoints-mcp` | 10 | 31 | Windows/Linux/Mac/Android/iOS/network/unmanaged endpoints, logical groups, maintenance windows, plus composite tools `get_fleet_summary` and `get_stale_endpoints` |
| `bconnect-jobs-mcp` | 23 | 37 | Job definitions, instances, folders, kiosk releases, plus composite tools `diagnose_job`, `explain_job_failure`, `preview_assignment` |
| `bconnect-servermanagement-mcp` | 16 | 30 | Management server, microservices, security groups, API keys |
| `bconnect-activedirectory-mcp` | 16 | 16 | AD groups, users, objects, organizational units |
| `bconnect-assets-mcp` | 15 | 26 | Asset inventory, asset types, stock folders |
| `bconnect-software-mcp` | 11 | 19 | Installed software inventory, software bundles |
| `bconnect-defensecontrol-mcp` | 11 | 14 | BitLocker, local admin accounts, Defender threats, plus composite tool `get_security_posture` |
| `bconnect-compliance-mcp` | 10 | 10 | Compliance violations, CVE vulnerabilities, plus composite tools `get_unpatched_endpoints`, `get_vulnerability_exposure` |
| `bconnect-variables-mcp` | 9 | 13 | Variable definitions and instances |
| `bconnect-universaldynamicgroups-mcp` | 6 | 6 | Universal Dynamic Group definitions |
| `bconnect-operatingsystems-mcp` | 5 | 9 | OS deployment folders and profiles |
| `bconnect-groups-mcp` | 2 | 2 | Endpoints by logical/static/dynamic/AD group, and by AD user — `list_group_members` + `list_ad_user_endpoints` cover the 30 routes a 33-tool matrix used to |
| `bconnect-updatemanagement-mcp` | 2 | 3 | Windows Update management |
| `bconnect-insights-mcp` | 5 | 5 | CROSS-MODULE composites, read-only: `get_estate_risk_briefing` answers "how exposed is this estate" from encryption, Defender, vulnerabilities and reporting in one call. `get_endpoint_briefing` does the same for ONE endpoint across six servers. `get_patch_readiness` joins update state, CVE detections and patch JOB outcomes. `get_deployment_coverage` answers "I deployed this — did it land?" `get_endpoint_reach` answers "what reaches this endpoint, and why". Reads other modules' routes; owns none |
| **Total** | **141** | **221** | |

Install only the servers you need. Most users start with `bconnect-endpoints-mcp`.

> The composite tools above (e.g. `get_fleet_summary`, `get_stale_endpoints`, `get_unpatched_endpoints`, `get_vulnerability_exposure`, `diagnose_job`, `explain_job_failure`, `preview_assignment`, `get_security_posture`) are this project's own additions on top of the vendored bConnect API surface — they combine multiple API calls into one higher-value answer and are usually the best place to start.

> Every `list_*` tool in the suite accepts `countOnly: true` (returns `{ totalItems, filters? }`
> instead of a page of rows), and the list tools in `bconnect-endpoints-mcp`, `bconnect-jobs-mcp`
> and `bconnect-software-mcp` return compact rows by default — pass `detail: true` for the
> unmodified API record. See [`docs/MIGRATION-tool-surface.md`](docs/MIGRATION-tool-surface.md)
> for the full list of what shape changed and how to opt back into the old one.

---

## Configuration Reference

All servers read the same environment variables. These four get you running:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect API URL (e.g. `https://bms.company.com:443/bconnect`) |
| `BCONNECT_API_KEY` | Yes* | — | API key for authentication |
| `BCONNECT_USERNAME` / `BCONNECT_PASSWORD` | Yes* | — | Basic Auth alternative to the API key |
| `BCONNECT_CA_CERT_PATH` | — | — | Path to CA certificate (PEM) for self-signed certs |

> \* **Authentication**: provide either `BCONNECT_API_KEY` alone, or both `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. API key takes precedence if both are set.

**→ [docs/CONFIGURATION.md](docs/CONFIGURATION.md)** documents the complete set — timeouts and
retries, audit logging, rate limiting, the `ALLOW_WRITE_OPERATIONS` / `ALLOW_SECRET_READ` /
`ALLOWED_WRITE_TOOLS` / `BCONNECT_ENABLE_V11` gates, and every `MCP_*` transport and gateway
setting — plus how to find your bMS server URL, how to generate an API key, and how to configure
TLS against an internal CA.

---

## Client Configuration

**→ [docs/CLIENTS.md](docs/CLIENTS.md)** is the complete guide: config file paths, top-level keys,
`"type"` handling and worked examples for Claude Desktop, Claude Code, VS Code, Cursor, Continue,
LibreChat, the HTTP gateway, n8n, Open WebUI, OpenAI and Microsoft Copilot Studio.

The servers are ordinary stdio MCP servers plus one Streamable-HTTP gateway, and the **command
line is identical for every client** — what changes is the file, the top-level key the entries sit
under, and whether each entry carries a `"type"`. Getting one of those three wrong is the usual
cause of "the server just doesn't appear", because most clients ignore a config they cannot
interpret rather than reporting an error.

| Client | Config file | Wrap the entry in | `"type"` |
|--------|-------------|-------------------|:--------:|
| Claude Code (CLI) | `.mcp.json` in the project root | `mcpServers` | keep |
| VS Code (Copilot agent mode) | `.vscode/mcp.json` | **`servers`** | keep |
| Claude Desktop | `claude_desktop_config.json` | `mcpServers` | drop |
| Cursor | `.cursor/mcp.json` | `mcpServers` | drop |
| Continue | `~/.continue/mcpServers/<name>.yaml` | `mcpServers`, a YAML **list** whose items each carry their own `name:` | keep |
| LibreChat | `librechat.yaml` | `mcpServers` | keep |
| n8n, Open WebUI, OpenAI, Copilot Studio | no stdio path — use the [gateway](docs/CLIENTS.md) | — | — |

Two consequences worth stating plainly, because both fail **silently**:

- **VS Code's top-level key is `servers`, not `mcpServers`.** A block copied from a
  Claude config into `.vscode/mcp.json` is parsed, ignored, and reported as nothing.
- **Claude Code reads a `url` entry with no `"type"` as stdio.** Every HTTP example
  carries `"type": "http"`; dropping it does not degrade gracefully.

> **No credential belongs in a client config file.** `--env-file` points at a file holding
> `BCONNECT_BASE_URL` and either `BCONNECT_API_KEY` or `BCONNECT_USERNAME` /
> `BCONNECT_PASSWORD`. Some client config files are world-readable by default and several are
> committed to version control. Restrict the env file to the running user and see
> [SECURITY.md → Credentials at rest](SECURITY.md#credentials-at-rest-env-and-client-config).

---

## Testing

The whole suite is one Vitest project, run from the repo root:

```bash
npm test                # every test in the monorepo
npm test -- endpoints   # only test files whose path matches "endpoints"
npm run typecheck       # tsc across all workspaces
npm run lint            # eslint, zero warnings tolerated
```

Mock-tier integration tests are described in
[docs/MOCK_INTEGRATION_TESTING.md](docs/MOCK_INTEGRATION_TESTING.md).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **Connection refused** | Check `BCONNECT_BASE_URL` includes `/bconnect`. Verify port 443 is open and the bConnect service is running on your bMS server. |
| **SSL/TLS certificate errors** | Set `BCONNECT_CA_CERT_PATH` to your CA certificate. Only use `NODE_TLS_REJECT_UNAUTHORIZED=0` for development. |
| **401 Unauthorized** | Verify your credentials. If using an API key, check it hasn't expired. If using Basic Auth, confirm the user has bConnect API access in the bMS console. |
| **404 Not Found** | Check the object exists and that your account can see it. If you are on a bMS older than 26R1 the server should have refused to start — see the next row. |
| **Server exits: "requires baramundi Management Suite 26R1"** | Your bMS is older than 26R1, which this suite does not support. Upgrade the bMS. There is no compatibility flag; `BCONNECT_SKIP_CONNECTIVITY_CHECK=true` only skips the check, it does not make the missing routes exist. |
| **`*_industrial_endpoint` tool not found** | 26R1 removed the IndustrialEndpoints bConnect API, so those 5 tools were removed. There is no replacement — see [docs/MIGRATION-tool-surface.md](docs/MIGRATION-tool-surface.md). |
| **Server or tool not showing in your MCP client** | Check the container key (`servers` in VS Code, `mcpServers` elsewhere) and, for HTTP entries, that `"type": "http"` is present — both fail silently. Then reload/restart the client (Claude Desktop needs a full quit) and verify the server process starts without errors. |

For detailed troubleshooting, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

---

## Security

- **Never hardcode credentials** — always use environment variables or `.env` files
- **Use API keys** instead of username/password when possible
- **Use `BCONNECT_CA_CERT_PATH`** for self-signed certificates instead of disabling TLS
- **Enable audit logging** (`BCONNECT_AUDIT_LEVEL=all` or `=security`) on production servers
- **Enable rate limiting** (`BCONNECT_RATE_LIMIT_ENABLED=true`) to protect your bConnect API
- **Authenticate the gateway** (`MCP_GATEWAY_AUTH_TOKEN`) before exposing it, and front it with a
  TLS-terminating, authenticating reverse proxy for anything beyond one shared team credential

See [SECURITY.md](SECURITY.md) for the full security policy, and
[docs/DATA-FLOW.md](docs/DATA-FLOW.md) for what estate data leaves your network and
where it goes — the question a security review will ask first.

---

## Architecture

Each server is an independent Node.js process that connects directly to the bConnect REST API. Servers share no **runtime** state — but they are built from a shared code library (`@bconnect/mcp-core`); see [Repository layout](#repository-layout) below.

```
Any MCP client (stdio: Claude Desktop/Code, VS Code, Cursor, Continue, LibreChat, …)
    │                                        (HTTP-only clients go via the gateway)
    ├── bconnect-endpoints-mcp              → Endpoints, groups, maintenance windows
    ├── bconnect-jobs-mcp                   → Jobs, instances, folders, kiosk
    ├── bconnect-assets-mcp                 → Assets, types, stock folders
    ├── bconnect-activedirectory-mcp        → AD groups, users, org units
    ├── bconnect-servermanagement-mcp       → Server config, API keys, microservices
    ├── bconnect-software-mcp               → Software inventory, bundles
    ├── bconnect-variables-mcp              → Variables and instances
    ├── bconnect-defensecontrol-mcp         → BitLocker, Defender, local admins
    ├── bconnect-operatingsystems-mcp       → OS deployment profiles
    ├── bconnect-compliance-mcp             → CVE vulnerabilities
    ├── bconnect-groups-mcp                 → Endpoints by group, and by AD user
    ├── bconnect-insights-mcp               → Cross-module estate risk briefing
    ├── bconnect-universaldynamicgroups-mcp → Dynamic groups
    └── bconnect-updatemanagement-mcp       → Windows Update management
```

### Repository layout

This repo is an **npm workspaces monorepo**: all workspace members share one root `package-lock.json` and a common library, which is why builds run from the root.

```
bConnect-MCP/
├── packages/
│   └── mcp-core/              @bconnect/mcp-core — the shared library every server
│                             imports: BConnectClientBase (HTTP / auth / TLS / retry),
│                             parameter validation, rate limiting, audit logging,
│                             response caching, batch operations.
├── bconnect-endpoints-mcp/   ┐  the domain MCP servers (stdio) — each a workspace
│   … (14 servers) …          │  member depending on @bconnect/mcp-core. A fix in the
├── bconnect-variables-mcp/   ┘  core applies to all of them at once.
├── bconnect-server-template/    scaffold for adding a new server (workspace member)
├── bconnect-mcp-gateway/        optional HTTP gateway (multi-user / n8n); NOT a
│                                workspace member — it bundles the core + all servers.
├── docs/                        clients, configuration, Docker, n8n, troubleshooting
└── scripts/                     local CI, image publish, release (see package.json)
```

---

## Breaking change: 2026-08-02 tool surface revision

This project has no published clients yet, so a round of held proposals from the last evaluation
was taken as one deliberate, versioned break rather than deferred to a future major release. If
you wrote anything against tool names or response shapes before this date:

- **`bconnect-groups-mcp`'s 33 tools collapsed into 2** (`list_group_members`,
  `list_ad_user_endpoints`); **3 tools were renamed**; **`list_group_endpoints` was removed**
  (use `list_endpoints_by_logical_group`).
- **The 5 industrial-endpoint tools were removed**, together with the `industrial` member type in
  `bconnect-groups-mcp`. **26R1 removed the underlying bConnect API**, so these tools would 404
  against every supported server. Calling one by name returns a message saying exactly that
  rather than a generic unknown-tool error. There is no replacement.
- **25R2 support was dropped and `BCONNECT_RELEASE` was removed.** The suite is 26R1-only and
  detects the bMS version at startup (see the requirement box at the top).
- **Write tools are hidden from `tools/list` by default** unless `ALLOW_WRITE_OPERATIONS=true` —
  hidden, not disabled; a direct call by name still works either way.
- **Several `list_*` tools default to compact rows**; pass `detail: true` for the original body.
  Every `list_*` tool suite-wide now accepts `countOnly: true`.
- **A 400/403/404/429 from bConnect now resolves as `{ isError: true, ... }` instead of throwing.**

The 13 tools behind the live demo (`assign_job_to_logical_group`, `create_job_instance`,
`delete_job_folder`, `delete_job_instance`, `diagnose_job`, `explain_job_failure`,
`get_stale_endpoints`, `get_unpatched_endpoints`, `get_vulnerability_exposure`,
`preview_assignment`, `start_job_instance`, `stop_job_instance`, `update_job_folder`) were
untouched by name or behaviour throughout.

**Full mapping table, per-tool response shape changes, and a migration checklist:**
[`docs/MIGRATION-tool-surface.md`](docs/MIGRATION-tool-surface.md). Reasoning and measured
before/after numbers: [`CHANGELOG.md`](CHANGELOG.md#unreleased).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
