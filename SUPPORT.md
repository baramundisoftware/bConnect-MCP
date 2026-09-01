# Support

## Documentation

- **[docs/INSTALLATION.md](docs/INSTALLATION.md)** — installation, configuration, TLS setup
- **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** — common issues and solutions
- **[docs/DOCKER.md](docs/DOCKER.md)** — Docker deployment

## Getting Help

> **bConnect-MCP is not supported through baramundi Support.** It is a separate project.
> Do not contact the baramundi support portal for questions about these MCP servers.

For questions, bugs, or feature requests specific to **bConnect-MCP**, open a **GitHub issue** in
this repository. Please include:

- bConnect MCP Suite version (`package.json` → `version`)
- baramundi Management Suite release (bMC console → Help → About) — the suite requires 26R1 or later
- Which server(s) are affected
- Steps to reproduce
- Relevant log output

**Do not paste estate data into a public issue** — endpoint names, group names, job names, URLs and
credentials. Redact them, or use the private channel below.

### When it cannot be public

- A **security vulnerability** goes through GitHub private vulnerability reporting, never an issue.
  See [SECURITY.md](SECURITY.md).
- Anything else that carries estate detail: **support@baramundi.com**

## What Is Out of Scope

- The **baramundi Management Suite** and the **bConnect REST API** themselves — these are a
  separate baramundi product, not part of bConnect-MCP.
- General MCP protocol questions (see https://modelcontextprotocol.io)
- Your **MCP client** itself — Claude Desktop, Claude Code, VS Code / GitHub Copilot, Cursor,
  Continue, LibreChat, Open WebUI, n8n or any other. How a client discovers, launches and displays
  MCP servers is its vendor's behaviour, not this suite's; ask them. What we own is what these
  servers do once your client has launched them.
