# Docker Deployment Guide — bConnect MCP Suite 26.1.4

This guide covers running bConnect MCP servers as Docker containers.

---

## Quick Start

```bash
# Copy and fill in credentials
cp .env.example .env

# Start all servers
docker compose up -d

# Check logs
docker compose logs -f bconnect-activedirectory-mcp
```

---

## Building Images

Each server has its own `Dockerfile` based on `node:20-alpine` with a non-root user.

```bash
# Build a single server
docker build -t bconnect-activedirectory-mcp:26.1.4 ./bconnect-activedirectory-mcp

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
        "bconnect-activedirectory-mcp:26.1.4"
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

```bash
# Build the gateway image
docker build -t bconnect-mcp-gateway:26.1.4 ./bconnect-mcp-gateway

# Run with a mounted token map
docker run -d \
  -p 3001:3001 \
  -v /etc/mcp/tokens.json:/run/secrets/tokens.json:ro \
  -e MCP_AUTH_CONFIG=/run/secrets/tokens.json \
  -e MCP_GATEWAY_PORT=3001 \
  -e MCP_GATEWAY_BIND=0.0.0.0 \
  bconnect-mcp-gateway:26.1.4
```

Token map format (`/etc/mcp/tokens.json`):

```json
{
  "tok_alice_<random>": {
    "baseUrl":  "https://bms.company.com:444/bconnect",
    "apiKey":   "bconnect-api-key-team-a"
  },
  "tok_bob_<random>": {
    "baseUrl":  "https://bms.company.com:444/bconnect",
    "username": "svc-readonly",
    "password": "secret"
  }
}
```

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
  bconnect-activedirectory-mcp:26.1.4
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
