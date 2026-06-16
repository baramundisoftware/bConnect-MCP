# bConnect MCP Suite

[![CI](https://github.com/baramundisoftware/bConnect-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/baramundisoftware/bConnect-MCP/actions/workflows/ci.yml)

Connect your AI assistant to the **baramundi Management Suite** (bMS). This project provides MCP servers that let AI tools like Claude Desktop, Claude Code, Github Copilot or others read and manage your bMS — endpoints, jobs, software, compliance, and more — through the bConnect REST API.

**212 tools** across **12 servers**, compatible with **baramundi 25R2 and 26R1**.

---

## What You Need

- A **baramundi Management Suite** (25R2 or 26R1) with bConnect API enabled
- Your **bMS server address** (e.g. `https://bms.company.com:444/bconnect`)
- A **bMS user account** with API access, or an **API key**
  (generate one in the baramundi mangement console under **Server Management > API Keys**)
- **Node.js 20 or later** ([download](https://nodejs.org/))

### Network Requirements

- Port **444** (HTTPS) must be open between the machine running the MCP server and your bMS server
- Test connectivity: `curl -k https://bms.company.com:444/bconnect/info/v2.0/Info`

---

## Getting Started (Step by Step)

### Step 1: Download

```bash
git clone https://github.com/baramundisoftware/bConnect-MCP.git
cd bConnect-MCP
```

### Step 2: Build a Server

Start with `bconnect-endpoints-mcp` — it covers endpoint management, the most common use case:

```bash
cd bconnect-endpoints-mcp
npm ci
npm run build
```

### Step 3: Configure Your bMS Connection

Copy the example config and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Your bMS server address (include /bconnect at the end)
BCONNECT_BASE_URL=https://bms.company.com:444/bconnect

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

```bash
node build/index.js
```

You should see: `bconnect-endpoints-mcp running on stdio`

### Step 5: Verify It Works

In another terminal, send a test request:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  BCONNECT_BASE_URL=https://bms.company.com:444/bconnect \
  BCONNECT_API_KEY=your-api-key \
  node build/index.js
```

You should see a JSON response listing all available tools (e.g. `list_windows_endpoints`, `get_endpoint_by_id`, etc.).

### Step 6: Connect to Your AI Assistant

Add the server to your AI assistant's MCP configuration. Example for Claude Desktop — edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "command": "node",
      "args": ["/path/to/bconnect-endpoints-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms.company.com:444/bconnect",
        "BCONNECT_API_KEY": "your-api-key"
      }
    }
  }
}
```

Restart your AI assistant. You can now ask it questions like:
- *"List all Windows endpoints"*
- *"Show me endpoints that haven't been seen in 30 days"*
- *"What software is installed on endpoint X?"*

---

## Windows Deployment

See [docs/WINDOWS-DEPLOYMENT.md](docs/WINDOWS-DEPLOYMENT.md) for the full guide:

1. Install Node.js 20+ on your Windows machine
2. Download the release archive from [GitHub Releases](https://github.com/baramundisoftware/bConnect-MCP/releases)
3. Extract to `C:\bConnect-MCP\`
4. For each server: `cd bconnect-<name>-mcp && npm ci --production`
5. Create a `.env` file with your bMS credentials
6. Start: `node build/index.js`

---

## Docker Deployment

See [docs/DOCKER.md](docs/DOCKER.md) for the full guide. Quick start:

```bash
docker run -d \
  -p 3000:3000 \
  -e BCONNECT_BASE_URL=https://bms.company.com:444/bconnect \
  -e BCONNECT_API_KEY=your-api-key \
  -e MCP_TRANSPORT=http \
  -e MCP_PORT=3000 \
  bconnect-endpoints-mcp
```

---

## Available Servers

| Server | Tools | 25R2 | 26R1 | What It Does |
|--------|-------|------|------|--------------|
| `bconnect-endpoints-mcp` | 47 | Yes | Yes | Windows/Linux/Mac/Android/iOS endpoints, logical groups, maintenance windows |
| `bconnect-servermanagement-mcp` | 30 | Yes | Yes | Management server, microservices, security groups, API keys |
| `bconnect-assets-mcp` | 26 | Yes | Yes | Asset inventory, asset types, stock folders |
| `bconnect-jobs-mcp` | 24 | Yes | Yes | Job definitions, instances, folders, kiosk releases |
| `bconnect-software-mcp` | 19 | Yes | Yes | Installed software inventory, software bundles |
| `bconnect-activedirectory-mcp` | 16 | Yes | Yes | AD groups, users, objects, organizational units |
| `bconnect-variables-mcp` | 13 | Yes | Yes | Variable definitions and instances |
| `bconnect-defensecontrol-mcp` | 13 | Yes | Yes | BitLocker, local admin accounts, Defender threats |
| `bconnect-operatingsystems-mcp` | 9 | Yes | Yes | OS deployment folders and profiles |
| `bconnect-compliance-mcp` | 8 | No | Yes | Compliance violations, CVE vulnerabilities (26R1 only) |
| `bconnect-universaldynamicgroups-mcp` | 6 | No | Yes | Universal Dynamic Group definitions (26R1 only) |
| `bconnect-updatemanagement-mcp` | 3 | Yes | Yes | Windows Update management |
| **Total** | **212** | | | |

Install only the servers you need. Most users start with `bconnect-endpoints-mcp`.

---

## Configuration Reference

All servers use the same environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect API URL (e.g. `https://bms.company.com:444/bconnect`) |
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
| `MCP_GATEWAY_BIND` | — | `127.0.0.1` | Gateway bind address |
| `MCP_AUTH_CONFIG` | — | — | Path to token map JSON; enables per-user auth in gateway mode (see below) |

> \* **Authentication**: provide either `BCONNECT_API_KEY` alone, or both `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. API key takes precedence if both are set.

### How to Find Your bMS Server URL

1. Open the **baramundi Management Center** on your bMS server
2. The server address is the machine name or IP where bMS is installed
3. bConnect listens on **port 444** by default (HTTPS)
4. Your URL will be: `https://<server-name>:444/bconnect`

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
        "BCONNECT_BASE_URL": "https://bms.company.com:444/bconnect",
        "BCONNECT_API_KEY": "your-api-key"
      }
    }
  }
}
```


### Centralized Gateway (HTTP, multi-user, authenticated)

`bconnect-mcp-gateway` serves all 13 servers on a single HTTP port and supports
per-user authentication via a token map. This is the recommended approach when
multiple users or teams need access with different bConnect API credentials.

**1. Create the token map** (`/etc/mcp/tokens.json`):

```json
{
  "tok_alice_<random>": {
    "baseUrl": "https://bms.company.com:444/bconnect",
    "apiKey": "bconnect-key-team-a"
  },
  "tok_bob_<random>": {
    "baseUrl": "https://bms.company.com:444/bconnect",
    "username": "svc-readonly",
    "password": "secret"
  },
  "tok_carol_<random>": {
    "baseUrl": "https://bms.company.com:444/bconnect",
    "apiKey": "bconnect-key-team-a"
  }
}
```

Multiple MCP tokens can share the same bConnect API key (n:m mapping).
bConnect credentials stay on the server — clients only know their own token.

**2. Start the gateway:**

```bash
cd bconnect-mcp-gateway
MCP_AUTH_CONFIG=/etc/mcp/tokens.json \
MCP_GATEWAY_PORT=3001 \
node build/gateway.js
```

**3. Configure each client** with its own token:

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "url": "http://mcp-gateway.company.com:3001/endpoints/mcp",
      "headers": { "Authorization": "Bearer tok_alice_<random>" }
    },
    "bconnect-assets": {
      "url": "http://mcp-gateway.company.com:3001/assets/mcp",
      "headers": { "Authorization": "Bearer tok_alice_<random>" }
    }
  }
}
```

Available domains: `activedirectory`, `assets`, `compliance`, `defensecontrol`,
`endpoints`, `groups`, `jobs`, `operatingsystems`, `servermanagement`, `software`,
`universaldynamicgroups`, `updatemanagement`, `variables`.

> **Security note:** Use TLS in front of the gateway (nginx, Caddy) and keep the token map file readable only by the gateway process.

For using the gateway from **n8n workflows**, see [docs/N8N.md](docs/N8N.md).

### Centralized Server (HTTP, single credential set)

Run a single server on a central machine when all users share one bConnect credential:

```bash
MCP_TRANSPORT=http MCP_PORT=3000 \
BCONNECT_BASE_URL=https://bms.company.com:444/bconnect \
BCONNECT_API_KEY=your-api-key \
node build/index.js
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
        "BCONNECT_BASE_URL": "https://bms.company.com:444/bconnect",
        "BCONNECT_API_KEY": "your-api-key"
      }
    }
  }
}
```

---

## Build All Servers

```bash
for dir in bconnect-*-mcp; do
  echo "Building $dir..."
  (cd "$dir" && npm ci && npm run build)
done
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
| **Connection refused** | Check `BCONNECT_BASE_URL` includes `/bconnect`. Verify port 444 is open and the bConnect service is running on your bMS server. |
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

Each server is an independent Node.js process. Servers share no state — each connects directly to the bConnect REST API.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
