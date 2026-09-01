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

## Breaking change: 2026-08-02 tool surface revision

This project has no published clients yet, so a round of held proposals from the last evaluation
was taken as one deliberate, versioned break rather than deferred to a future major release. If
you wrote anything against tool names or response shapes before this date:

- **`bconnect-groups-mcp`'s 33 tools collapsed into 2** (`list_group_members`,
  `list_ad_user_endpoints`).
- **3 tools were renamed** (`list_endpoint_job_instances`,
  `list_detected_rule_violations_for_endpoint`, `list_detected_vulnerabilities_for_endpoint`).
- **1 tool was removed** (`list_group_endpoints` — use `list_endpoints_by_logical_group`).
- **The 5 industrial-endpoint tools were removed** (`list_industrial_endpoints`,
  `get_industrial_endpoint`, `create_industrial_endpoint`, `update_industrial_endpoint`,
  `delete_industrial_endpoint`), together with the `industrial` member type in
  `bconnect-groups-mcp`. **26R1 removed the underlying bConnect API**, so these tools would
  404 against every supported server. Calling one by name returns a message saying exactly
  that rather than a generic unknown-tool error. There is no replacement.
- **25R2 support was dropped and `BCONNECT_RELEASE` was removed.** The suite is 26R1-only and
  detects the bMS version at startup (see the requirement box above).
- **Write tools are hidden from `tools/list` by default** across 9 servers unless
  `ALLOW_WRITE_OPERATIONS=true` — hidden, not disabled; a direct call by name still works either
  way.
- **Several `list_*` tools default to compact rows** (`bconnect-endpoints-mcp`,
  `bconnect-jobs-mcp`, `bconnect-software-mcp`); pass `detail: true` for the original body.
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

## What You Need

- A **baramundi Management Suite 26R1 or later** with bConnect API enabled — **25R2 and older
  will not work**, and the servers refuse to start against them (see the box at the top)
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

The 14 servers share a common package (`@bconnect/mcp-core`), so they build **together from the repo root** — the shared core first, then the servers. Building a single server directory on its own fails with `Cannot find module '@bconnect/mcp-core'`.

```bash
# from the repo root (bConnect-MCP) — NOT a server subdirectory
npm ci
npm run build -w @bconnect/mcp-core   # build the shared core first
npm run build                          # then all servers
```

> **On Windows:** run these from **Git Bash**, not PowerShell or cmd. `npm run build` loops over the
> server directories using shell syntax that `cmd.exe` cannot parse, so PowerShell and cmd fail with
> `d was unexpected at this time`. Git Bash ships with [Git for Windows](https://gitforwindows.org/).

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

# (No release setting: the suite is 26R1-only and detects the bMS version itself.)

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

The connectivity step also reads the bMS release. On a bMS older than 26R1 the server prints
the detected version alongside the 26R1 requirement and exits instead of starting.

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

### Step 6: Connect to Your MCP Client

Every client starts the **same process**; only the file, the container key and the
entry shape differ. The canonical entry is below — `--env-file` points at the `.env`
you filled in at Step 3 (or any other file holding the same variables), so **no
credential goes into the client's config file**:

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

Put it in the file, and under the key, your client expects:

| Client | Config file | Wrap the entry in | `"type"` |
|--------|-------------|-------------------|:--------:|
| Claude Code (CLI) | `.mcp.json` in the project root | `mcpServers` | keep |
| VS Code (Copilot agent mode) | `.vscode/mcp.json` | **`servers`** | keep |
| Claude Desktop | `claude_desktop_config.json` | `mcpServers` | drop |
| Cursor | `.cursor/mcp.json` | `mcpServers` | drop |
| Continue | `~/.continue/mcpServers/<name>.yaml` | `mcpServers`, a YAML **list** whose items each carry their own `name:` | keep |
| LibreChat | `librechat.yaml` | `mcpServers` | keep |
| n8n, Open WebUI, OpenAI, Copilot Studio | no stdio path — use the [gateway](#centralized-gateway-http-multi-user) | — | — |

Full paths, per-client caveats and the HTTP shapes are in
[Client Configuration](#client-configuration) below.

> `--env-file` needs Node 20.6 or newer (22.15+ is recommended anyway). On an older
> Node, export the variables into the environment before launching the client.

Reload or restart your client — Claude Desktop needs a **full quit** (tray icon → Quit),
VS Code a window reload, Claude Code a re-run in the project directory. You can now ask
questions like:
- *"List all Windows endpoints"*
- *"Show me endpoints that haven't been seen in 30 days"*
- *"What software is installed on endpoint X?"*

---

## Docker Deployment

The **gateway** (multi-user / n8n) is published as a multi-arch image (linux/amd64 + arm64) on GHCR — browse it on the [**Packages page**](https://github.com/orgs/baramundisoftware/packages?repo_name=bConnect-MCP):

```bash
docker pull ghcr.io/baramundisoftware/bconnect-mcp-gateway:latest
```

Only the gateway is distributed as a container; the 13 stdio servers are plain Node.js processes that whichever MCP client you use spawns for itself (see [Getting Started](#getting-started-step-by-step) above). See [docs/DOCKER.md](docs/DOCKER.md) for the full gateway guide — Compose, `docker run`, TLS/auth, and mounted secrets.

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

All servers use the same environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect API URL (e.g. `https://bms.company.com:443/bconnect`) |
| `BCONNECT_API_KEY` | Yes* | — | API key for authentication |
| `BCONNECT_USERNAME` | Yes* | — | Username for Basic Auth |
| `BCONNECT_PASSWORD` | Yes* | — | Password for Basic Auth |
| `BCONNECT_CA_CERT_PATH` | — | — | Path to CA certificate (PEM) for self-signed certs |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | — | `false` | Skip the startup connectivity probe **and the 26R1 version gate with it**. For deployments that cannot reach `GET /v2.0/ManagementServer` |
| `BCONNECT_TIMEOUT_MS` | — | `30000` | HTTP request timeout in milliseconds |
| `BCONNECT_MAX_RETRIES` | — | `0` | Number of automatic retries for failed requests |
| `BCONNECT_RETRY_DELAY_MS` | — | `100` | Delay between retries in milliseconds |
| `BCONNECT_AUDIT_LEVEL` | — | `none` | Audit logging: `none`, `security`, `write`, or `all` |
| `BCONNECT_AUDIT_INCLUDE_PARAMS` | — | `false` | Include tool call parameters (redacted) in audit log entries |
| `BCONNECT_RATE_LIMIT_ENABLED` | — | `false` | Enable rate limiting to protect the bConnect API |
| `ALLOW_WRITE_OPERATIONS` | — | `false` | Advertise **and** enable the suite's create/update/delete/start tools (9 servers, 80 tool schemas). With the gate shut, write tools are hidden from `tools/list` (a token-cost optimization) but still dispatch — a direct call by name is refused with an actionable message either way |
| `ALLOW_SECRET_READ` | — | `false` | Enable tools that can return BitLocker recovery keys and LAPS passwords (`bconnect-defensecontrol-mcp`). Refused until set to `true` |
| `ALLOWED_WRITE_TOOLS` | — | unset | Narrows `ALLOW_WRITE_OPERATIONS` to an explicit, comma-separated subset of tool names for this process (e.g. `assign_job_to_static_group,start_job_instance`). Implemented in `bconnect-jobs-mcp` only today — setting it for any other server's write tools is a silent no-op. Unset changes nothing: all-or-nothing behaviour under `ALLOW_WRITE_OPERATIONS` |
| `ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT` | — | `false` | Permits assigning a job the bMS itself flags `Destructive` (`bconnect-jobs-mcp`). The check that enforces this needs bConnect v1.1 credentials (see `BCONNECT_ENABLE_V11` below) to read the flag at all — without them the assignment proceeds regardless of this variable |
| `BCONNECT_ENABLE_V11` | — | `false` | Opt-in to the bConnect v1.1 (SOAP-adjacent) surface used for a handful of read tools (`preview_assignment`, `explain_job_failure`) and the Destructive-job check above. Also requires `BCONNECT_V11_USERNAME`/`BCONNECT_V11_PASSWORD` (a domain account, Basic auth, management-LAN only); without all three, v1.1 tools are absent from `tools/list` and the Destructive check silently cannot run |
| `MCP_TRANSPORT` | — | `stdio` | Transport: `stdio` (local) or `http` (network) |
| `MCP_PORT` | — | `3000` | HTTP port (when `MCP_TRANSPORT=http`) |
| `MCP_GATEWAY_PORT` | — | `3001` | Gateway listen port (when using `bconnect-mcp-gateway`) |
| `MCP_GATEWAY_BIND` | — | `127.0.0.1` | Gateway bind address (loopback-only unless behind a proxy) |
| `MCP_ALLOW_NO_AUTH` | — | `false` | Allow a non-loopback gateway bind with no `MCP_GATEWAY_AUTH_TOKEN`; asserts an authenticating proxy is in front. Not set by anything shipped in this repo |
| `MCP_GATEWAY_AUTH_TOKEN` | — | — | One or more shared bearer tokens (comma-separated for rotation), required on every `Authorization: Bearer <token>` HTTP request to the gateway once set. 24+ characters, or the gateway refuses to start. See [docs/MIGRATION-tool-surface.md § Gateway authentication](docs/MIGRATION-tool-surface.md#9-gateway-authentication-bconnect-mcp-gateway-sec-7) |
| `MCP_GATEWAY_AUTH_TOKEN_FILE` | — | — | Docker-secret form of `MCP_GATEWAY_AUTH_TOKEN` — path to a file containing the token |

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

## Client Configuration

All examples show `bconnect-endpoints-mcp` for brevity. Add more servers by repeating the pattern.

### The one thing that differs per client

The servers are ordinary stdio MCP servers plus one Streamable-HTTP gateway. The
**command line is identical for every client** — what changes is the file, the
top-level key the entries sit under, and whether each entry carries a `"type"`.
Getting one of those three wrong is the usual cause of "the server just doesn't
appear", because most clients ignore a config they cannot interpret rather than
reporting an error.

| Client | Transport | Config file | Top-level key | `"type"` on entries |
|--------|-----------|-------------|---------------|---------------------|
| Claude Code (CLI) | stdio + HTTP | `.mcp.json` in the project root (or `claude mcp add`) | `mcpServers` | **required** — `"stdio"` / `"http"` |
| VS Code (Copilot agent mode) | stdio + HTTP | `.vscode/mcp.json` (workspace) | **`servers`** | **required** — `"stdio"` / `"http"` |
| Claude Desktop | stdio | `claude_desktop_config.json` | `mcpServers` | omit |
| Cursor | stdio + HTTP | `.cursor/mcp.json` (or `~/.cursor/mcp.json`) | `mcpServers` | omit — remote entries are identified by the presence of `url` |
| Continue | stdio + HTTP | `~/.continue/mcpServers/<name>.yaml` | `mcpServers`, a YAML **list** | yes — `stdio` / `streamable-http` |
| LibreChat | stdio + HTTP | `librechat.yaml` | `mcpServers` | yes — `stdio` / `streamable-http` |
| Open WebUI | HTTP only | configured in the web UI (Admin Settings → External Tools) | — | — |
| n8n | HTTP only | MCP Client Tool node + MCP Server credential | — | — |
| OpenAI Responses API / Agents SDK | HTTP (hosted) or stdio (Agents SDK) | your own code | — | — |
| Microsoft Copilot Studio | HTTP only | Power Platform custom connector (Swagger) | — | — |

Two consequences worth stating plainly, because both fail **silently**:

- **VS Code's top-level key is `servers`, not `mcpServers`.** A block copied from a
  Claude config into `.vscode/mcp.json` is parsed, ignored, and reported as nothing.
- **Claude Code reads a `url` entry with no `"type"` as stdio.** Every HTTP example
  below therefore carries `"type": "http"`; dropping it does not degrade gracefully.

Cursor is the mirror image: its own documentation marks `type` required in a table
and then omits it from every example, so the shipped configuration follows the
examples and leaves it out.

### Claude Desktop (local, stdio)

Edit `claude_desktop_config.json` (`%APPDATA%\Claude\` on Windows,
`~/Library/Application Support/Claude/` on macOS). Claude Desktop needs a **full
quit** from the tray/menu-bar icon, not a window close, before it re-reads this file.

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "command": "node",
      "args": [
        "--env-file=/path/to/bconnect.env",
        "/path/to/bconnect-endpoints-mcp/build/index.js"
      ]
    }
  }
}
```

### Claude Code (local, stdio)

Either write `.mcp.json` in the project root — note the `"type"` — or register it
from the CLI:

```bash
claude mcp add bconnect-endpoints \
  --scope user \
  -- node --env-file=/path/to/bconnect.env /path/to/bconnect-endpoints-mcp/build/index.js
```

> **Scope matters.** The default `--scope local` keys the config to the directory you
> run `claude` from, so the server loads only in that project (and won't appear if you
> start `claude` elsewhere). Use `--scope user` to make it available in every project,
> or `--scope project` to commit it to the repo's `.mcp.json` for the team. A
> project-scope server also needs a one-time in-app trust approval before it starts.

### VS Code — Copilot agent mode (local, stdio)

`.vscode/mcp.json` in the workspace you actually open. **The key is `servers`:**

```json
{
  "servers": {
    "bconnect-endpoints": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--env-file=/path/to/bconnect.env",
        "/path/to/bconnect-endpoints-mcp/build/index.js"
      ]
    }
  }
}
```

VS Code also reads `inputs` and `sandbox` from this file; leave them alone if present.
Server configuration does **not** go in `settings.json` — only behaviour settings
(`chat.mcp.access`, `chat.mcp.discovery.enabled`, …) live there.

### Cursor (local, stdio)

`.cursor/mcp.json` in the workspace, or `~/.cursor/mcp.json` globally. Same shape as
Claude Desktop — no `type`.

### Continue (local, stdio)

A standalone block file under `~/.continue/mcpServers/`. `mcpServers` here is a YAML
**list** of objects each carrying its own `name:`, not a map — a config translated
field-for-field from any of the clients above is wrong. MCP is available in **agent
mode** only.

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

### LibreChat (local, stdio)

Paste under the top-level `mcpServers:` key of `librechat.yaml`. The stdio servers run
on the **LibreChat host** — if LibreChat is containerised, the suite must be inside
that container or on a mounted path.

```yaml
mcpServers:
  bconnect-endpoints:
    type: stdio
    command: node
    args:
      - --env-file=/path/to/bconnect.env
      - /path/to/bconnect-endpoints-mcp/build/index.js
```


### Centralized Gateway (HTTP, multi-user)

`bconnect-mcp-gateway` serves all 14 servers on a single HTTP port — the option for
teams and n8n.

> ## ⚠️ Security: the gateway MUST be authenticated before you expose it
>
> **As of the 2026-08-02 revision, the gateway has built-in bearer-token authentication**
> (`SEC-7`) — set `MCP_GATEWAY_AUTH_TOKEN` and every HTTP request must carry
> `Authorization: Bearer <token>`, or it gets a `401` before it can call any tool. `docker
> compose up` refuses to start without a token configured. This closes the gap where the
> shipped compose file previously set `MCP_ALLOW_NO_AUTH=true` by default, disarming the
> gateway's own fail-closed guard.
>
> A bearer token is the floor, not the ceiling. For anything beyond a single shared team
> credential — per-user identity, SSO, audit trails tied to a real person — **still front the
> gateway with a TLS-terminating, authenticating reverse proxy or your IdP's application
> proxy** (nginx, Caddy, Traefik, Entra Application Proxy, oauth2-proxy, …), and let it forward
> its own bearer token to the gateway. That proxy must:
> - **terminate TLS** — tokens and data must never travel in cleartext;
> - **authenticate every caller** against your identity provider (OIDC / SAML / SSO);
> - **reach the gateway only over a private/loopback network** — publish the proxy, not the gateway;
> - **strip any client-supplied identity headers** before forwarding.
>
> As a fail-closed safeguard the gateway **refuses to start on a non-loopback bind** unless
> either `MCP_GATEWAY_AUTH_TOKEN` is set (a token now satisfies the guard) or you set
> `MCP_ALLOW_NO_AUTH=true` as an explicit assertion that an authenticating proxy is in front.
> Details: [docs/DOCKER.md](docs/DOCKER.md) → "TLS and authentication" and
> [docs/MIGRATION-tool-surface.md § Gateway authentication](docs/MIGRATION-tool-surface.md#9-gateway-authentication-bconnect-mcp-gateway-sec-7).

**Credentials.** The gateway uses a single bConnect service credential (`BCONNECT_*`)
for all downstream calls, and **bMS RBAC governs what it can do** — scope that account
to least privilege. (Per-user bConnect credentials keyed by the proxy-asserted identity
are a planned option.)

**Start:**

```bash
cp .env.gateway.example .env.gateway
# Edit .env.gateway — set BCONNECT_BASE_URL, the BCONNECT_* service credential,
# and MCP_GATEWAY_AUTH_TOKEN (24+ random characters; the installer's -Gateway flag
# will generate and print one for you if you'd rather not pick your own)

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d
```

**Configure each client** with the gateway's bearer token (directly, or via your
authenticating proxy, which supplies whatever credential/session it requires and forwards
its own token to the gateway):

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "type": "http",
      "url": "https://mcp-gateway.company.com/endpoints/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

> **Adjust the wrapper per client**, exactly as for stdio: VS Code puts this under
> `servers`, not `mcpServers`; Cursor omits `"type"` and identifies the entry as remote
> by the presence of `url`; Continue writes `type: streamable-http` in a YAML list; and
> Claude Code **requires** the `"type"` — without it a `url` entry is read as stdio and
> the server never connects. Claude Desktop has no documented HTTP entry in this file at
> all (its remote-server path is Connectors/Extensions), so do not expect one to work.

> Header syntax also varies — n8n uses a Header Auth credential, Open WebUI a Bearer
> field (token alone, no `Bearer` prefix), LibreChat a `headers:` map. See
> [docs/MIGRATION-tool-surface.md § Gateway authentication](docs/MIGRATION-tool-surface.md#9-gateway-authentication-bconnect-mcp-gateway-sec-7)
> for client-specific instructions.

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

Then configure each workstation's MCP client to connect to the central server (same
per-client wrapper rules as the gateway block above):

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "type": "http",
      "url": "http://mcp-server.company.com:3000/mcp"
    }
  }
}
```

### HTTP-only clients (n8n, Open WebUI, OpenAI, Copilot Studio)

These four have **no stdio path at all** — no `command`, no `args`, no local process —
so the gateway is not an optimisation for them, it is the only route.

- **n8n** — MCP Client Tool node + one **MCP Server** credential per domain URL, with
  the token as a Header Auth credential (`Authorization: Bearer <token>`). Full guide:
  [docs/N8N.md](docs/N8N.md).
- **Open WebUI** — native MCP since v0.6.31, **Streamable HTTP only**. Admin Settings →
  External Tools → Add Server, type *MCP (Streamable HTTP)*. Containerised Open WebUI
  reaching a gateway on the host needs `http://host.docker.internal:<port>`.
- **OpenAI** — two different products. The Responses API *hosted MCP tool* calls the
  URL **from OpenAI's servers**, so it needs a publicly reachable (or tunnelled)
  endpoint; the Agents SDK's `MCPServerStdio` spawns the server in your own process and
  needs no gateway and no inbound firewall hole. For a firewalled Windows host the
  Agents SDK is by far the better fit. Leave `require_approval` at its default for a
  suite that can write to an estate.
- **Microsoft Copilot Studio** — Streamable HTTP only, reached through a Power Platform
  connector, so the call originates in Microsoft's cloud. The marker that makes the
  custom connector MCP rather than REST is `x-ms-agentic-protocol: mcp-streamable-1.0`
  on a POST operation. An internet-reachable gateway must sit behind a TLS-terminating
  proxy that authenticates a **person** — the gateway's own bearer token does not
  expire, does not name a caller, and cannot be revoked for one consumer.

### Any other MCP client

Anything that can spawn a process or call a URL can be configured from the command line
itself. That is the whole interface:

```text
node --env-file=/path/to/bconnect.env /path/to/bconnect-endpoints-mcp/build/index.js
```

It is byte-for-byte the command line every client above is given, so if this does not
work in your client, the problem is the wrapper, not the server. Start from the
portable JSON block:

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--env-file=/path/to/bconnect.env",
        "/path/to/bconnect-endpoints-mcp/build/index.js"
      ]
    }
  }
}
```

…then apply your client's own two adjustments from the table at the top of this
section: rename the container key if it is not `mcpServers`, and drop `"type"` if your
client does not use it. The guided installer emits exactly this, filled in with your
real paths, as `install\out\generic.md`.

> **No credential appears in any entry above.** `--env-file` points at a file holding
> `BCONNECT_BASE_URL` and either `BCONNECT_API_KEY` or `BCONNECT_USERNAME` /
> `BCONNECT_PASSWORD`. Client config files are not secret stores — some are
> world-readable by default and several are committed to version control. Restrict the
> env file to the running user and see
> [SECURITY.md → Credentials at rest](SECURITY.md#credentials-at-rest-env-and-client-config).

---

## Build All Servers

From the repo root — install the workspace once, build the shared core, then all servers:

```bash
npm ci
npm run build -w @bconnect/mcp-core   # shared core first
npm run build                          # all servers
```

> **On Windows:** run these from **Git Bash** — `npm run build` uses shell syntax `cmd.exe` cannot
> parse, so PowerShell and cmd fail with `d was unexpected at this time`. Same applies to
> `npm run audit` and `npm run sbom`.

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

This repo is an **npm workspaces monorepo**: all workspace members share one root `package-lock.json` and a common library, which is why builds run from the root (`@bconnect/mcp-core` first, then the servers).

```
bConnect-MCP/
├── packages/
│   └── mcp-core/              @bconnect/mcp-core — the shared library every server
│                             imports: BConnectClientBase (HTTP / auth / TLS / retry),
│                             parameter validation, rate limiting, audit logging,
│                             response caching, batch operations.
├── bconnect-endpoints-mcp/   ┐  the 13 domain MCP servers (stdio) — each a workspace
│   … (14 servers) …          │  member depending on @bconnect/mcp-core. A fix in the
├── bconnect-variables-mcp/   ┘  core applies to all 13 at once.
├── bconnect-server-template/    scaffold for adding a new server (workspace member)
├── bconnect-mcp-gateway/        optional HTTP gateway (multi-user / n8n); NOT a
│                                workspace member — it bundles the core + all servers.
├── docs/                        installation, Docker, n8n, troubleshooting, data flow
└── scripts/                     local CI, image publish, release (see package.json)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
