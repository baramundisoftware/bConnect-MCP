# Docker Deployment Guide — bConnect MCP gateway

This guide covers running the **bConnect MCP gateway** as a Docker container.

> **Only the gateway is distributed as a container** (per ADR-0003). The 13 domain MCP
> servers communicate over **stdio** and are run directly with Node.js / Claude Desktop —
> they are **not** containerized. To run a stdio server, see
> [INSTALLATION.md](INSTALLATION.md), not this guide.

The gateway (`bconnect-mcp-gateway`) serves all 13 servers on a single HTTP port for
teams and n8n. It has **no built-in authentication** — you MUST front it with a
TLS-terminating, authenticating reverse proxy (see
[TLS and authentication](#tls-and-authentication-operator-responsibility)). Downstream
bMS calls use a single `BCONNECT_*` service credential (bMS RBAC governs it — scope it
to least privilege).

---

## Get the image

The gateway image is published to the GitHub Container Registry as a **multi-arch**
image (linux/amd64 + linux/arm64) — browse it on the
[Packages page](https://github.com/orgs/baramundisoftware/packages?repo_name=bConnect-MCP):

```bash
docker pull ghcr.io/baramundisoftware/bconnect-mcp-gateway:latest
# or pin a version: …/bconnect-mcp-gateway:26.1.7
```

To build it yourself instead, the build context must be the repo **root** — the gateway
bundles the shared `@bconnect/mcp-core` and all 13 servers:

```bash
docker build -f bconnect-mcp-gateway/Dockerfile -t bconnect-mcp-gateway:local .
```

---

## Quick Start — Docker Compose (recommended)

```bash
cp .env.gateway.example .env.gateway
# Edit .env.gateway — set BCONNECT_BASE_URL and the BCONNECT_* service credential

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d

# Verify
curl http://localhost:3001/health
# → {"status":"ok","servers":[…],"count":13}
```

---

## Manual `docker run`

```bash
# Bind loopback and front it with your proxy. Publishing a non-loopback port
# requires MCP_ALLOW_NO_AUTH=true (your assertion that a proxy handles auth).
docker run -d \
  -p 127.0.0.1:3001:3001 \
  -e BCONNECT_BASE_URL=https://bms.company.com/bconnect \
  -e BCONNECT_API_KEY=your-service-key \
  ghcr.io/baramundisoftware/bconnect-mcp-gateway:latest
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

### Reproducible base image

The gateway Dockerfile pins `node:22-alpine` to a SHA256 **digest** (audit M3), so image
builds are reproducible and don't silently absorb upstream base-image changes. Dependabot
bumps the digest like any other dependency.

---

## Environment Variables

The gateway uses one bConnect **service credential** (`BCONNECT_API_KEY`, or
`BCONNECT_USERNAME` + `BCONNECT_PASSWORD`) for all downstream calls.

| Variable | Description | Default |
|----------|-------------|---------|
| `BCONNECT_BASE_URL` | bConnect V2.0 API base URL | `https://bms-server/bconnect` |
| `BCONNECT_API_KEY` | API key (or use username/password below) | *(one credential required)* |
| `BCONNECT_USERNAME` / `BCONNECT_PASSWORD` | API username + password (alternative to the key) | — |
| `BCONNECT_RELEASE` | API release: `25R2` or `26R1` | `26R1` |
| `BCONNECT_AUDIT_LEVEL` | `none`, `security`, `write`, `all` | `none` |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set to `0` for self-signed certs (dev only) | `1` |
| `BCONNECT_CA_CERT_PATH` | Path to a CA certificate inside the container | — |
| `MCP_ALLOW_NO_AUTH` | Allow a non-loopback gateway bind (asserts a proxy is in front) | `false` |
| `MCP_GATEWAY_PORT` | Gateway listen port | `3001` |
| `MCP_GATEWAY_BIND` | Gateway bind address | `127.0.0.1` |
| `MCP_GATEWAY_RATE_LIMIT_ENABLED` | Per-client-IP inbound rate limiting | `true` |
| `MCP_GATEWAY_RATE_LIMIT_MAX` | Max requests per window, per client IP | `300` |
| `MCP_GATEWAY_RATE_LIMIT_WINDOW_MS` | Rate-limit window (ms) | `60000` |
| `MCP_GATEWAY_MAX_BODY` | Max accepted request body size | `1mb` |
| `LOG_LEVEL` | Gateway log level: `error`, `warn`, `info`, `debug` | `info` |
| `LOG_FORMAT` | Gateway log format: `text` or `json` (use `json` for ELK/Loki) | `text` |

> The gateway writes a structured **access log** (method, path, status, duration, and the
> caller's **client IP** — real identity lives at the fronting reverse proxy) for every
> request. Set `LOG_FORMAT=json` for machine-ingestible logs.

---

## Custom CA Certificates

If your bMS uses a custom CA, mount the PEM into the container and point
`BCONNECT_CA_CERT_PATH` at it:

```bash
docker run -d \
  -p 127.0.0.1:3001:3001 \
  -v /path/to/your-ca.pem:/certs/ca.pem:ro \
  -e BCONNECT_CA_CERT_PATH=/certs/ca.pem \
  -e BCONNECT_BASE_URL=https://bms.company.com/bconnect \
  -e BCONNECT_API_KEY=your-service-key \
  ghcr.io/baramundisoftware/bconnect-mcp-gateway:latest
```

On Node.js ≥ 22.15 the image also honors the OS trust store automatically; see
[INSTALLATION.md → TLS / SSL Configuration](INSTALLATION.md#tls--ssl-configuration).

---

## Server Compatibility

The gateway serves all 13 servers on 26R1. On 25R2, two servers are unavailable and
return no tools:

| Server | Requires 26R1 |
|--------|--------------|
| bconnect-compliance-mcp | Yes (`BCONNECT_RELEASE=26R1`) |
| bconnect-universaldynamicgroups-mcp | Yes (`BCONNECT_RELEASE=26R1`) |
| All others | No (works with 25R2 and 26R1) |

---

## Security Notes

- The gateway container runs as the non-root user `bconnect`.
- No credentials are embedded in the image.
- **Prefer mounted secrets over env vars (audit M2).** The gateway supports the
  Docker/Compose `*_FILE` convention for the service credential — mount the secret
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
- See [SECURITY.md → HTTP Gateway](../SECURITY.md#http-gateway-bconnect-mcp-gateway) for the full gateway security model.
