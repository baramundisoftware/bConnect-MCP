# Docker Deployment Guide — bConnect MCP Suite 26.1.5

This guide covers running bConnect MCP servers as Docker containers.

Two Docker Compose files serve different use cases:

| File | Use case | Transport |
|------|----------|-----------|
| `docker-compose.yml` | Single developer, Claude Desktop / Claude Code | stdio via `docker exec` |
| `docker-compose.gateway.yml` | Teams, n8n, multi-user HTTP access | HTTP, Bearer token auth |

---

## Quick Start — stdio (Claude Desktop / Claude Code)

```bash
# Copy and fill in credentials
cp .env.example .env

# Start all 13 servers
docker compose up -d

# Or start only the servers you need
docker compose up -d bconnect-endpoints-mcp bconnect-assets-mcp

# Check logs
docker compose logs -f bconnect-activedirectory-mcp
```

## Quick Start — Gateway (multi-user HTTP)

```bash
cp .env.gateway.example .env.gateway
# Edit .env.gateway — set BCONNECT_BASE_URL and MCP_AUTH_CONFIG_PATH

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d

# Verify
curl http://localhost:3001/health
# → {"status":"ok","count":13,"authEnabled":true}
```

---

## Building Images

Each server has its own `Dockerfile` based on `node:20-alpine` with a non-root user.

```bash
# Build a single server
docker build -t bconnect-activedirectory-mcp:26.1.5 ./bconnect-activedirectory-mcp

# Build all via docker compose
docker compose build

# Build with no cache
docker compose build --no-cache
```

---

## Docker Smoke Test

A smoke test is provided in `build-tests/docker-smoke.test.sh`. It builds `bconnect-activedirectory-mcp`, starts a container, sends an MCP `initialize` request via stdin, and asserts the response contains `serverInfo.name`.

```bash
# Build and test
./build-tests/docker-smoke.test.sh

# Test existing image (skip build)
./build-tests/docker-smoke.test.sh --skip-build
```

Expected output:
```
PASS: Response contains serverInfo
PASS: serverInfo.name = bconnect-activedirectory-mcp
PASS: Response contains protocolVersion
PASS: Docker smoke test succeeded
```

---

## Connecting Claude Desktop to Docker Containers

MCP servers communicate via stdio, not HTTP. Use `docker run --rm -i` to pipe stdin/stdout:

```json
{
  "mcpServers": {
    "bconnect-activedirectory": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--env", "BCONNECT_BASE_URL=https://bms.company.com/bconnect",
        "--env", "BCONNECT_USERNAME=mcp-user",
        "--env", "BCONNECT_PASSWORD=your-password",
        "bconnect-activedirectory-mcp:26.1.5"
      ]
    }
  }
}
```

Or with `docker compose` (pre-started containers via `docker exec`):

```json
{
  "mcpServers": {
    "bconnect-activedirectory": {
      "command": "docker",
      "args": ["exec", "-i", "bconnect-activedirectory-mcp", "node", "build/index.js"]
    }
  }
}
```

---

## Gateway Container (Multi-user, Authenticated)

`bconnect-mcp-gateway` runs all 13 servers on a single HTTP port and maps Bearer
tokens to bConnect credentials. This is the recommended approach for shared
deployments where different users or teams have different bConnect API keys.

**With Docker Compose (recommended):**

```bash
cp .env.gateway.example .env.gateway
# Edit .env.gateway — set BCONNECT_BASE_URL and MCP_AUTH_CONFIG_PATH

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d
```

**With `docker run` (manual):**

```bash
# Build (context must be the repo root — gateway imports all 13 servers)
docker build -f bconnect-mcp-gateway/Dockerfile -t bconnect-mcp-gateway:26.1.5 .

# Run with a mounted token map
docker run -d \
  -p 3001:3001 \
  -v /etc/mcp/tokens.json:/run/secrets/tokens.json:ro \
  -e MCP_AUTH_CONFIG=/run/secrets/tokens.json \
  -e MCP_GATEWAY_PORT=3001 \
  -e MCP_GATEWAY_BIND=0.0.0.0 \
  bconnect-mcp-gateway:26.1.5
```

Token map format (`/etc/mcp/tokens.json`):

```json
{
  "tok_alice_<random>": {
    "apiKey": "bconnect-api-key-team-a"
  },
  "tok_bob_<random>": {
    "username": "svc-readonly",
    "password": "secret"
  }
}
```

> `BCONNECT_BASE_URL` is set once in `.env.gateway` and shared by all tokens. Only add
> `"baseUrl"` to a token entry if that user needs to reach a different bMS server.

**Hash tokens at rest (recommended — audit M1).** Instead of plaintext token keys,
use the **SHA-256 hex** of each token as the key, so a leaked `tokens.json` can't be
replayed. The gateway auto-detects a hashed map and hashes the presented token before
lookup. Generate a key with the bundled helper:

```bash
node bconnect-mcp-gateway/build/hash-token.js tok_alice_<random>
# → 9f86d081…   (use this as the key)
```

```json
{
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08": {
    "apiKey": "bconnect-api-key-team-a"
  }
}
```

A map is treated as hashed only when **every** key is a 64-char SHA-256 hex; otherwise
it stays in (legacy) plaintext mode and the gateway logs a recommendation to migrate.

Each client supplies its token in the `Authorization` header:

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "url": "http://mcp-gateway.company.com:3001/endpoints/mcp",
      "headers": { "Authorization": "Bearer tok_alice_<random>" }
    }
  }
}
```

When `MCP_AUTH_CONFIG` is not set the gateway falls back to the `BCONNECT_*`
environment variables (single-credential mode, no auth required).

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BCONNECT_BASE_URL` | bConnect V2.0 API base URL | `https://bms-server/bconnect` |
| `BCONNECT_USERNAME` | API username | *(required)* |
| `BCONNECT_PASSWORD` | API password | *(required)* |
| `BCONNECT_RELEASE` | API release: `25R2` or `26R1` | `26R1` |
| `BCONNECT_AUDIT_LEVEL` | `none`, `security`, `write`, `all` | `none` |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set to `0` for self-signed certs | `1` |
| `BCONNECT_CA_CERT_PATH` | Path to CA certificate inside container | — |
| `MCP_AUTH_CONFIG` | Path to token map JSON (gateway only) | — |
| `MCP_GATEWAY_PORT` | Gateway listen port | `3001` |
| `MCP_GATEWAY_BIND` | Gateway bind address | `127.0.0.1` |

---

## Custom CA Certificates

If your bMS uses a custom CA:

```bash
# Mount cert into container
docker run --rm -i \
  -v /path/to/your-ca.pem:/certs/ca.pem:ro \
  --env BCONNECT_CA_CERT_PATH=/certs/ca.pem \
  --env BCONNECT_BASE_URL=https://bms.company.com/bconnect \
  --env BCONNECT_USERNAME=mcp-user \
  --env BCONNECT_PASSWORD=your-password \
  bconnect-activedirectory-mcp:26.1.5
```

---

## Server Compatibility

| Server | Requires 26R1 |
|--------|--------------|
| bconnect-compliance-mcp | Yes (`BCONNECT_RELEASE=26R1`) |
| bconnect-universaldynamicgroups-mcp | Yes (`BCONNECT_RELEASE=26R1`) |
| All others | No (works with 25R2 and 26R1) |

---

## Security Notes

- All containers run as non-root user `bconnect`
- No credentials are embedded in images — always pass via environment variables
- Use Docker secrets or a secrets manager for production deployments
- The `bconnect-compliance-mcp` and `bconnect-universaldynamicgroups-mcp` servers exit gracefully when `BCONNECT_RELEASE=25R2`
