# Docker Deployment Guide — bConnect MCP Suite 26.1.7

This guide covers running bConnect MCP servers as Docker containers.

Two Docker Compose files serve different use cases:

| File | Use case | Transport |
|------|----------|-----------|
| `docker-compose.yml` | Single developer, Claude Desktop / Claude Code | stdio via `docker exec` |
| `docker-compose.gateway.yml` | Teams, n8n, multi-user HTTP access | HTTP (auth via a fronting reverse proxy) |

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
# Edit .env.gateway — set BCONNECT_BASE_URL and the BCONNECT_* service credential

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d

# Verify
curl http://localhost:3001/health
# → {"status":"ok","count":13}
```

---

## Building Images

Each server has its own `Dockerfile` based on `node:20-alpine` with a non-root user.

```bash
# Build a single server
docker build -t bconnect-activedirectory-mcp:26.1.7 ./bconnect-activedirectory-mcp

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
        "bconnect-activedirectory-mcp:26.1.7"
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

## Gateway Container (Multi-user)

`bconnect-mcp-gateway` runs all 13 servers on a single HTTP port. It has **no
built-in authentication** — see "TLS and authentication" below; you **must** front it
with an authenticating reverse proxy. Downstream bMS calls use a single `BCONNECT_*`
service credential (bMS RBAC governs it — scope it to least privilege).

**With Docker Compose (recommended):**

```bash
cp .env.gateway.example .env.gateway
# Edit .env.gateway — set BCONNECT_BASE_URL and the BCONNECT_* service credential

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d
```

**With `docker run` (manual):**

```bash
# Build (context must be the repo root — gateway imports all 13 servers)
docker build -f bconnect-mcp-gateway/Dockerfile -t bconnect-mcp-gateway:26.1.7 .

# Bind loopback and front it with your proxy. Publishing a non-loopback port
# requires MCP_ALLOW_NO_AUTH=true (your assertion that a proxy handles auth).
docker run -d \
  -p 127.0.0.1:3001:3001 \
  -e BCONNECT_BASE_URL=https://bms.company.com/bconnect \
  -e BCONNECT_API_KEY=your-service-key \
  bconnect-mcp-gateway:26.1.7
```

The service credential can be supplied from mounted secrets via the `*_FILE`
convention (audit M2), e.g. `-e BCONNECT_API_KEY_FILE=/run/secrets/bms_api_key`.

Clients connect **through your authenticating proxy** (which supplies whatever
credential/session the proxy requires):

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "url": "https://mcp-gateway.company.com/endpoints/mcp"
    }
  }
}
```

### TLS and authentication (operator responsibility)

The gateway serves plain HTTP and has **no built-in TLS or authentication** — by
design. Any deployment beyond loopback **must** be fronted by a TLS-terminating,
authenticating reverse proxy of your choice (nginx, Caddy, Traefik, HAProxy, or
your IdP's application proxy). This is the standard pattern for self-hosted
infrastructure: the operator owns the perimeter.

The proxy in front of the gateway must:

- **Terminate TLS** — credentials and data travel in HTTP headers; never expose
  the gateway over plaintext beyond localhost.
- **Authenticate the caller** — via your IdP (OIDC/SAML) or the mechanism your
  organisation already runs.
- **Reach the gateway only over a private/loopback network** — publish the
  proxy, not the gateway. As a fail-closed default the gateway refuses to start
  on a non-loopback bind without auth unless `MCP_ALLOW_NO_AUTH=true` is set
  explicitly.
- **Strip any client-supplied identity headers** before injecting its own.

Clients then connect to `https://<host>/<domain>/mcp` through the proxy, which
supplies whatever credential/session it requires.

> Per-IP rate limiting is enforced in the gateway itself as a coarse backstop
> (`MCP_GATEWAY_RATE_LIMIT_*`); add richer edge/flood/per-identity limiting at your proxy.

### Resource limits

The gateway compose file sets memory/CPU/pids limits (audit H2) to bound a runaway
request rate. Tune via `.env.gateway`: `MCP_GATEWAY_MEM_LIMIT` (default `512m`) and
`MCP_GATEWAY_CPU_LIMIT` (`1.0`).

### Reproducible base images

All Dockerfiles pin `node:20-alpine` to a SHA256 **digest** (audit M3), so image builds
are reproducible and don't silently absorb upstream base-image changes. Dependabot bumps
the digest like any other dependency.

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
| `MCP_ALLOW_NO_AUTH` | Allow a non-loopback gateway bind (asserts a proxy is in front) | `false` |
| `MCP_GATEWAY_PORT` | Gateway listen port | `3001` |
| `MCP_GATEWAY_BIND` | Gateway bind address | `127.0.0.1` |
| `LOG_LEVEL` | Gateway log level: `error`, `warn`, `info`, `debug` | `info` |
| `LOG_FORMAT` | Gateway log format: `text` or `json` (use `json` for ELK/Loki) | `text` |

> The gateway writes a structured **access log** (method, path, status, duration, and a
> non-reversible caller id — a SHA-256 prefix of the token, never the raw token) for every
> request. Set `LOG_FORMAT=json` for machine-ingestible logs.

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
  bconnect-activedirectory-mcp:26.1.7
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
- No credentials are embedded in images
- **Prefer mounted secrets over env vars (audit M2).** The gateway supports the
  Docker/Compose `*_FILE` convention for the fallback credentials — mount the secret
  and point `<VAR>_FILE` at it instead of putting the value in the environment (where
  `docker inspect` would expose it). An explicit env var still wins if both are set.

  ```yaml
  # docker-compose.gateway.yml (excerpt)
  services:
    mcp-gateway:
      environment:
        BCONNECT_API_KEY_FILE: /run/secrets/bms_api_key
      secrets:
        - bms_api_key
  secrets:
    bms_api_key:
      file: ./secrets/bms_api_key.txt
  ```

  Supported: `BCONNECT_USERNAME_FILE`, `BCONNECT_PASSWORD_FILE`, `BCONNECT_API_KEY_FILE`.
  This is how the gateway's single service credential is supplied from mounted secrets.
- The `bconnect-compliance-mcp` and `bconnect-universaldynamicgroups-mcp` servers exit gracefully when `BCONNECT_RELEASE=25R2`
