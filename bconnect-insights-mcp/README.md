# bconnect-server-template

Scaffold for a **new** bConnect MCP server. This directory is not a shipping
server — it is a compiling, testable skeleton of the same validation-first
dispatch architecture the 13 production servers use, so a new domain starts from
something that already obeys the suite-wide rules instead of rediscovering them.

**Domain:** none — `DOMAIN` is a placeholder throughout
**Tools:** 0. `TOOLS` is empty on purpose; the catalogue, validation and dispatch
wiring around it is what the template provides.

> It is a workspace member, so `npm run build` at the repo root compiles it and
> `npm test` runs its tests. Keep it building: a template that no longer compiles
> is worse than no template, because it is copied before it is read.

---

## Creating a server from it

```bash
# from the repo root
cp -r bconnect-server-template bconnect-<domain>-mcp
```

Then, in the copy:

1. Replace `DOMAIN` with the real domain name (`assets`, `jobs`, …) in
   `package.json`, `src/index.ts` and `src/bconnect-client.ts`.
2. Replace `DomainRules` with the real per-domain rules object in
   `src/utils/mcp-tool-validation-rules.ts`.
3. Add tool definitions to the `TOOLS` array in `src/index.ts`.
   Replace `serverName: "bconnect-DOMAIN-mcp"` too: it is what enables the
   optional per-server credential `BCONNECT_API_KEY__<DOMAIN>`, and a wrong or
   missing value fails silently, keeping the shared key.
4. Name every mutating tool in `defineToolCatalogue`'s `write` list. Naming a
   tool that is not in `TOOLS` is a hard error — that check is the reason a
   write tool cannot silently escape the gate.
5. Add one `validateToolArguments()` case per tool.
6. Add the matching dispatch case. No inline argument validation there:
   validation has already run.
7. Add the new directory to the root `package.json` workspaces list and rebuild
   from the root.

Three suite-wide behaviours come from `@bconnect/mcp-core` and must not be
reimplemented in a server:

| Behaviour | Where it lives |
|-----------|----------------|
| Write tools hidden from `tools/list` unless `ALLOW_WRITE_OPERATIONS=true`, and still refused when called by name | `tool-catalogue.ts` |
| `countOnly: true` answers "how many?" from the envelope instead of a page of rows | `count-only.ts` |
| 400/403/404/429 resolve as readable `isError` results; everything else stays a protocol error | `tool-error.ts` |

---

## Building and running

```bash
# Build from the repo ROOT. Every server imports @bconnect/mcp-core, so a
# server directory cannot be built on its own.
npm ci
npm run build -w @bconnect/mcp-core
npm run build -w bconnect-<domain>-mcp

# Run it. Credentials come from the env file, never from the command line.
node --env-file=/path/to/bconnect.env bconnect-<domain>-mcp/build/index.js
```

### Registering it with an MCP client

Every client starts the **same process**. What differs is which file the entry
goes in, the key it sits under, and whether the entry is typed:

```json
{
  "bconnect-<domain>": {
    "type": "stdio",
    "command": "node",
    "args": [
      "--env-file=/path/to/bconnect.env",
      "/opt/bconnect-mcp-suite/bconnect-<domain>-mcp/build/index.js"
    ]
  }
}
```

| Client | File | Wrap the entry in | `"type"` |
|--------|------|-------------------|:----------:|
| Claude Code | `.mcp.json` in the project root | `mcpServers` | keep |
| VS Code (Copilot agent mode) | `.vscode/mcp.json` | **`servers`** | keep |
| Claude Desktop | `claude_desktop_config.json` | `mcpServers` | drop |
| Cursor | `.cursor/mcp.json` | `mcpServers` | drop |
| Continue | `~/.continue/mcpServers/<name>.yaml` | `mcpServers`, a YAML **list** whose items each carry their own `name:` | keep |
| LibreChat | `librechat.yaml` | `mcpServers` | keep |

`servers` vs `mcpServers` is the usual silent failure: VS Code ignores an
`mcpServers` block without reporting anything. n8n, Open WebUI, OpenAI's hosted
tool and Copilot Studio have no stdio path at all and reach the suite over the
HTTP gateway instead — see the [suite README](../README.md#client-configuration).

> `--env-file` needs Node 20.6 or newer (22.15+ is recommended anyway). On an
> older Node, export the variables into the environment before launching.

> No credential appears in the entry above. A client config is not a secrets
> store — several of them are world-readable by default and some are committed
> to version control. See [SECURITY.md](../SECURITY.md#credentials-at-rest-env-and-client-config).

A new server is **not** automatically served by `bconnect-mcp-gateway`: the
gateway's domain map is an explicit list in `bconnect-mcp-gateway/src/app.ts`.
Add it there if the new domain should be reachable over HTTP.

---

## Environment Variables

Identical to every other server in the suite — see the
[configuration reference](../README.md#configuration-reference). The minimum is
`BCONNECT_BASE_URL` plus either `BCONNECT_API_KEY` or
`BCONNECT_USERNAME`/`BCONNECT_PASSWORD`.

---

## Tests

```bash
npm test -w bconnect-server-template
```

`src/__tests__/template.test.ts` and `bootstrap.test.ts` assert that the skeleton
still handshakes and that its bootstrap matches the shared one. They are the
reason a change to `@bconnect/mcp-core`'s server bootstrap cannot quietly leave
the template behind.

---

## Part of the Suite

See the [suite README](../README.md) for the server list, the configuration
reference and client-configuration examples, and
[docs/INSTALLATION.md](../docs/INSTALLATION.md) for deployment options (Windows,
Linux, Docker, HTTP gateway).

---

## Compatibility

| MCP server version | Supported bMS release | bConnect API | Notes |
|--------------------|-----------------------|--------------|-------|
| `26.1.8` | baramundi Management Suite 2026R1 or later | V2.0 | Current — 26R1-only; `BCONNECT_RELEASE` and 25R2 support removed |

> Version scheme: `<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>`
> Example: `26.1.8` targets bMS 2026R1; patch-only fixes increment the last digit.
