# @baramundi/bconnect-mcp

MCP servers for baramundi Management Suite (bMS), through its bConnect REST API. One command
starts one domain, several, or all of them as a single MCP server for an MCP client (Claude
Desktop, VS Code, Cursor and others).

**Technical Preview.** Published under the npm tag `next`.

## Start

Node.js 22 or 24 is required.

```
npx -y @baramundi/bconnect-mcp@next endpoints        # one domain
npx -y @baramundi/bconnect-mcp@next endpoints,jobs   # several domains as one server
npx -y @baramundi/bconnect-mcp@next all              # every domain the bMS release has
```

Domains: `activedirectory`, `assets`, `compliance`, `defensecontrol`, `endpoints`, `groups`,
`jobs`, `operatingsystems`, `servermanagement`, `software`, `universaldynamicgroups`,
`updatemanagement`, `variables`.

## Settings

Settings come from the environment (or a `.env` file in the working directory):

| Variable | |
|---|---|
| `BCONNECT_BASE_URL` | The bConnect address, over https, e.g. `https://bms.example.com/bconnect` |
| `BCONNECT_API_KEY` | An API key, or `BCONNECT_USERNAME` and `BCONNECT_PASSWORD` |
| `ALLOW_WRITE_OPERATIONS` | `true` lists the tools that change bMS; off by default |
| `ALLOW_SECRET_READ` | `true` lists the tools that read secrets (BitLocker, LAPS, API keys); off by default |

The servers detect the bMS release (25R2, 26R1, 26R2) at startup. Every setting:
[CONFIGURATION.md](https://github.com/baramundisoftware/bConnect-MCP/blob/main/docs/CONFIGURATION.md).

## MCP client

```json
{
  "mcpServers": {
    "bconnect": {
      "command": "npx",
      "args": ["-y", "@baramundi/bconnect-mcp@next", "all"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms.example.com/bconnect",
        "BCONNECT_API_KEY": "<your API key>"
      }
    }
  }
}
```

More clients, the gateway image for HTTP and the documentation:
[github.com/baramundisoftware/bConnect-MCP](https://github.com/baramundisoftware/bConnect-MCP).

## License

MIT
