# Client Configuration

How to register the bConnect MCP servers with each MCP client. All examples show
`bconnect-endpoints-mcp`; add more servers by repeating the pattern (for Claude Code, see
[All servers at once](#all-servers-at-once-switched-on-and-off-in-mcp)). Build the servers first
([INSTALLATION.md](INSTALLATION.md)).

Back to the [suite README](../README.md).

## What differs per client

The servers are ordinary stdio MCP servers, plus the HTTP gateway that serves all 13 under
one port. The **command line is the same for every client**. What changes is the file, the
top-level key the entries sit under, and whether each entry carries a `"type"`. Getting one of
those wrong is the usual cause of "the server just doesn't appear": most clients ignore a
configuration they can't interpret instead of reporting an error.

| Client | Transport | Config file | Top-level key | `"type"` on entries |
|--------|-----------|-------------|---------------|---------------------|
| Claude Code (CLI) | stdio + HTTP | `.mcp.json` in the project root, or `claude mcp add` | `mcpServers` | `"stdio"` / `"http"`; an entry with `url` needs `"http"` |
| VS Code (GitHub Copilot agent mode) | stdio + HTTP | `.vscode/mcp.json` (workspace) | **`servers`** | **required**: `"stdio"` / `"http"` |
| Claude Desktop | stdio | `claude_desktop_config.json` | `mcpServers` | omit |
| Cursor | stdio + HTTP | `.cursor/mcp.json` (or `~/.cursor/mcp.json`) | `mcpServers` | omit; a remote entry has `url` |
| Continue | stdio + HTTP | `~/.continue/mcpServers/<name>.yaml` | `mcpServers`, a YAML **list** | `stdio` / `streamable-http` |
| LibreChat | stdio + HTTP | `librechat.yaml` | `mcpServers` | `stdio` / `streamable-http` |
| n8n, Open WebUI, Copilot Studio | HTTP only | in the application | — | — |

Two mistakes fail **silently**:

- **VS Code's top-level key is `servers`, not `mcpServers`.** A block copied from a Claude
  configuration into `.vscode/mcp.json` is read, ignored, and reported as nothing.
- **Claude Code reads a `url` entry without `"type": "http"` as stdio**, and the server never
  connects.

## Keep credentials out of the client configuration

Client configuration files aren't secret stores: some are readable by other users, some end
up in version control. Put the settings in a file of their own and let Node.js read it:

```env
# /path/to/bconnect.env — readable only by you (chmod 600, or an NTFS ACL on Windows)
BCONNECT_BASE_URL=https://bms.company.com:443/bconnect
BCONNECT_API_KEY=your-api-key        # or BCONNECT_USERNAME + BCONNECT_PASSWORD
BCONNECT_RELEASE=26R1                # 25R2 for a 2025 R2 bMS
```

Then start the server with `node --env-file=/path/to/bconnect.env …/build/index.js`, as every
example below does. See [SECURITY.md → Credentials at rest](../SECURITY.md#credentials-at-rest-env-and-client-config).
Alternatively, put the variables in the entry's `env` block.

## Claude Desktop (stdio)

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/`
- Windows (standard installer): `%APPDATA%\Claude\`
- Windows (Microsoft Store / MSIX): inside the app's package folder, e.g.
  `C:\Users\<user>\AppData\Local\Packages\Claude_<id>\LocalCache\Roaming\Claude\`

Claude Desktop reads the file only at start: **quit it fully** from the tray or menu-bar icon,
closing the window isn't enough.

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

Claude Desktop starts local (stdio) servers from this file; it has no entry for an HTTP server
here. To use the gateway from Claude Desktop, run a local stdio-to-HTTP bridge as the
`command`, or use the servers directly as above.

## Claude Code (stdio)

From the CLI:

```bash
claude mcp add bconnect-endpoints --scope user \
  -- node --env-file=/path/to/bconnect.env /path/to/bconnect-endpoints-mcp/build/index.js
```

Or in `.mcp.json` in the project root:

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

> **Scope matters.** The default `--scope local` ties the server to the directory you ran
> `claude` from. `--scope user` makes it available in every project; `--scope project` writes
> it to the project's `.mcp.json` for the team, and such a server needs a one-time trust
> approval in Claude Code before it starts.

### All servers at once, switched on and off in `/mcp`

Claude Code can register all 13 servers and leave the unused ones disabled. From the suite's
root folder (Linux, macOS, Git Bash on Windows):

```bash
for dir in "$PWD"/bconnect-*-mcp; do
  name=$(basename "$dir" -mcp)                  # e.g. bconnect-endpoints
  claude mcp add "$name" --scope user \
    -- node --env-file=/path/to/bconnect.env "$dir/build/index.js"
done
claude mcp list
```

For a 25R2 bMS, leave out `bconnect-compliance` and `bconnect-universaldynamicgroups`: they
exist only on 26R1 and stop at startup on 25R2.

Then switch servers on and off in Claude Code with **`/mcp`** → select the server → **Disable**
or **Enable**, without editing any configuration.

**What it costs in tokens.** Claude Code loads MCP tool definitions on demand: until a tool is
used, the model sees only its name. A disabled server isn't started and costs nothing. Measured
with `/context` on 26.1.9 (`bconnect-endpoints`, 66 tools):

| `bconnect-endpoints` | In context |
|----------------------|-----------:|
| All 66 tool definitions in full | ≈ 20,600 tokens |
| Enabled, 3 tools used | ≈ 700 tokens for those 3, plus the 63 names |
| Disabled | 0 |

Since 26.1.10 the endpoints server lists 10 tools while writes are off and 32 with writes on (it
had 66), so its share is smaller than measured here.

`/context` shows it for your setup: "MCP tools … (loaded on-demand)" lists the tools in context
with their size, and the others under "Available". Disabling a server you don't use still pays
off beyond tokens: no Node.js process and no startup check against the bMS, fewer similar tool
names for the model to choose from, and its write tools out of reach.

> **Check this per client.** A client that sends every tool definition with each request, such
> as n8n's AI Agent, pays the full size of every server it loads; there, load only the servers
> you need (see [N8N.md](N8N.md#never-connect-all-13-domains-to-a-single-ai-agent)).

## VS Code: GitHub Copilot agent mode (stdio)

`.vscode/mcp.json` in the workspace you open. **The key is `servers`:**

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

Server entries don't go in `settings.json`; only behaviour settings live there.

## Cursor (stdio)

`.cursor/mcp.json` in the workspace, or `~/.cursor/mcp.json` for all workspaces. Same shape as
Claude Desktop, without `"type"`.

## Continue (stdio)

A file of its own under `~/.continue/mcpServers/`. Here `mcpServers` is a YAML **list** of
entries, each with its own `name:`. MCP tools are available in agent mode.

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

## LibreChat (stdio)

Under the top-level `mcpServers:` key of `librechat.yaml`. The servers run on the LibreChat
host: if LibreChat runs in a container, the suite must be inside it or on a mounted path.

```yaml
mcpServers:
  bconnect-endpoints:
    type: stdio
    command: node
    args:
      - --env-file=/path/to/bconnect.env
      - /path/to/bconnect-endpoints-mcp/build/index.js
```

## Through the HTTP gateway

`bconnect-mcp-gateway` serves all 13 servers on one HTTP port, each at `/<domain>/mcp`
(Streamable HTTP). It has **no authentication of its own**: clients reach it through your
authenticating, TLS-terminating reverse proxy, which supplies whatever token or session it
requires. Write tools and secret reads are off in the gateway, and it answers only host names it
knows (`MCP_GATEWAY_ALLOWED_HOSTS`). Setup:
[INSTALLATION.md → Option C](INSTALLATION.md#option-c--gateway-http-multi-user) and
[DOCKER.md](DOCKER.md).

Claude Code:

```bash
claude mcp add --transport http bconnect-endpoints https://mcp-gateway.company.com/endpoints/mcp
# add --header "Authorization: Bearer <token>" if your proxy expects one
```

Other clients, e.g. `.mcp.json`:

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

Adjust the wrapper per client as in the table above: VS Code puts the entry under `servers`;
Cursor omits `"type"`; Continue and LibreChat write `type: streamable-http`.

Domains: `activedirectory`, `assets`, `compliance`, `defensecontrol`, `endpoints`, `groups`,
`jobs`, `operatingsystems`, `servermanagement`, `software`, `universaldynamicgroups`,
`updatemanagement`, `variables`.

### HTTP-only clients

These have no way to start a local process, so the gateway is their only route:

- **n8n**: MCP Client Tool node, one per domain. See [N8N.md](N8N.md).
- **Open WebUI**: add the gateway's URL at your proxy as an MCP (Streamable HTTP) server in the
  admin settings.
- **Microsoft Copilot Studio** and other cloud-hosted agents: the call comes from the vendor's
  cloud, so the gateway has to be reachable from the internet, behind a proxy that
  authenticates each person.

## Any other MCP client

Anything that can start a process or call a URL works with the same command line:

```text
node --env-file=/path/to/bconnect.env /path/to/bconnect-endpoints-mcp/build/index.js
```

If that works in a terminal (the server prints its startup lines on stderr and waits) but not
in your client, the problem is the client's wrapper, not the server: check the file, the
top-level key and `"type"` against the table at the top.
