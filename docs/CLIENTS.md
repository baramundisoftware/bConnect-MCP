# Client Configuration

How to register the bConnect MCP servers with each MCP client. All examples show
`bconnect-endpoints-mcp` for brevity — add more servers by repeating the pattern.

Back to the [suite README](../README.md).

## The one thing that differs per client

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

> **No credential appears in any entry on this page.** `--env-file` points at a file
> holding `BCONNECT_BASE_URL` and either `BCONNECT_API_KEY` or `BCONNECT_USERNAME` /
> `BCONNECT_PASSWORD`. Client config files are not secret stores — some are
> world-readable by default and several are committed to version control. Restrict the
> env file to the running user and see
> [SECURITY.md → Credentials at rest](../SECURITY.md#credentials-at-rest-env-and-client-config).
>
> `--env-file` needs Node 20.6 or newer (22.15+ is recommended anyway). On an older
> Node, export the variables into the environment before launching the client.

## Claude Desktop (local, stdio)

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

## Claude Code (local, stdio)

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

## VS Code — Copilot agent mode (local, stdio)

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

## Cursor (local, stdio)

`.cursor/mcp.json` in the workspace, or `~/.cursor/mcp.json` globally. Same shape as
Claude Desktop — no `type`.

## Continue (local, stdio)

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

## LibreChat (local, stdio)

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

## Centralized Gateway (HTTP, multi-user)

`bconnect-mcp-gateway` serves all 14 servers on a single HTTP port — the option for
teams and n8n.

> ### ⚠️ Security: the gateway MUST be authenticated before you expose it
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
> Details: [DOCKER.md](DOCKER.md) → "TLS and authentication" and
> [MIGRATION-tool-surface.md § Gateway authentication](MIGRATION-tool-surface.md#9-gateway-authentication-bconnect-mcp-gateway-sec-7).

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
> [MIGRATION-tool-surface.md § Gateway authentication](MIGRATION-tool-surface.md#9-gateway-authentication-bconnect-mcp-gateway-sec-7)
> for client-specific instructions.

Available domains: `activedirectory`, `assets`, `compliance`, `defensecontrol`,
`endpoints`, `groups`, `jobs`, `operatingsystems`, `servermanagement`, `software`,
`universaldynamicgroups`, `updatemanagement`, `variables`.

For using the gateway from **n8n workflows**, see [N8N.md](N8N.md). For the full gateway
guide — Compose, `docker run`, TLS/auth, mounted secrets — see [DOCKER.md](DOCKER.md).

## Centralized Server (HTTP, single credential set)

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

## HTTP-only clients (n8n, Open WebUI, OpenAI, Copilot Studio)

These four have **no stdio path at all** — no `command`, no `args`, no local process —
so the gateway is not an optimisation for them, it is the only route.

- **n8n** — MCP Client Tool node + one **MCP Server** credential per domain URL, with
  the token as a Header Auth credential (`Authorization: Bearer <token>`). Full guide:
  [N8N.md](N8N.md).
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

## Any other MCP client

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
page: rename the container key if it is not `mcpServers`, and drop `"type"` if your
client does not use it. The guided installer emits exactly this, filled in with your
real paths, as `install\out\generic.md`.
