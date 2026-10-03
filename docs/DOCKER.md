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

The compose file **builds the image from your checkout** (the first start takes a few
minutes). To run the published image instead, replace its `build:` block and `image:` line
with `image: ghcr.io/baramundisoftware/bconnect-mcp-gateway:<version>`.

---

## Manual `docker run`

```bash
# Inside the container the gateway binds 0.0.0.0 (the image sets
# MCP_GATEWAY_BIND), so it only starts with MCP_ALLOW_NO_AUTH=true: your
# assertion that a proxy in front handles authentication. Publish the port on
# 127.0.0.1 so that only the host and your proxy can reach it.
docker run -d \
  -p 127.0.0.1:3001:3001 \
  -e MCP_ALLOW_NO_AUTH=true \
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

- **Terminate TLS** — the callers' tokens or cookies and all tool data travel over
  this connection; never expose the gateway over plaintext beyond localhost.
- **Authenticate the caller** — via your IdP (OIDC/SAML) or the mechanism your
  organisation already runs.
- **Reach the gateway only over a private/loopback network** — publish the
  proxy, not the gateway. As a fail-closed default the gateway refuses to start
  on a non-loopback bind without auth unless `MCP_ALLOW_NO_AUTH=true` is set
  explicitly.
- **Check `Host` and `Origin`** — accept only the host names you serve the gateway
  under, and reject browser requests from origins you don't expect.
- **Strip any client-supplied identity headers** before injecting its own.

Clients then connect to `https://<host>/<domain>/mcp` through the proxy, which
supplies whatever credential/session it requires.

> Per-IP rate limiting is enforced in the gateway itself as a coarse backstop
> (`MCP_GATEWAY_RATE_LIMIT_*`). Behind a proxy, the gateway sees every request as coming
> from the proxy's address (it doesn't read `X-Forwarded-For`), so all callers share one
> limit and the access log shows the proxy's address. Do per-caller limiting and logging
> at your proxy.

### Resource limits

The gateway compose file sets memory/CPU/pids limits (audit H2) to bound a runaway
request rate. Tune via `.env.gateway`: `MCP_GATEWAY_MEM_LIMIT` (default `512m`) and
`MCP_GATEWAY_CPU_LIMIT` (`1.0`).

### Reproducible base image

The gateway Dockerfile pins `node:22-alpine` to a SHA256 **digest** (audit M3), so image
builds are reproducible and don't silently absorb upstream base-image changes. Nothing
updates the digest automatically yet (Dependabot covers npm and GitHub Actions only), so
bump it by hand to pick up Node.js and Alpine security fixes.

---

## Environment Variables

The gateway uses one bConnect **service credential** (`BCONNECT_API_KEY`, or
`BCONNECT_USERNAME` + `BCONNECT_PASSWORD`) for all downstream calls. With Compose, set these
in `.env.gateway`; `docker-compose.gateway.yml` passes on the variables below. The defaults
are the code's; where Compose or the image sets another, the table says so.

> **Write tools and secret reads are off in the gateway.** The gateway has no authentication of
> its own, so whoever reaches it could use them. It therefore ignores `ALLOW_WRITE_OPERATIONS`
> and `ALLOW_SECRET_READ`, however it is started and wherever they are set (environment,
> `.env.gateway`, a `.env` file): every write tool and every tool that returns credentials
> (BitLocker keys and PIN, LAPS passwords) is refused, and the gateway logs a warning at startup
> if either was set. This stays so until the gateway has its own authentication.

| Variable | Description | Default |
|----------|-------------|---------|
| `BCONNECT_BASE_URL` | bConnect V2.0 API base URL; must be `https://` | none useful: set it (Compose: `https://bms-server/bconnect`) |
| `BCONNECT_ALLOW_INSECURE_HTTP` | `true` allows an `http://` base URL to another host (credentials unencrypted) | `false` |
| `BCONNECT_API_KEY` | API key (or use username/password below) | *(one credential required)* |
| `BCONNECT_USERNAME` / `BCONNECT_PASSWORD` | API username + password (alternative to the key); the password must be ASCII-only (bConnect rejects `§`, umlauts, `ß`) | — |
| `BCONNECT_RELEASE` | API release: `25R2` or `26R1` | `26R1` |
| `BCONNECT_AUDIT_LEVEL` | `none`, `security`, `write`, `all` | `none` |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Leave unset: `0` turns off certificate checks for every bMS call. For an internal CA, use `BCONNECT_CA_CERT_PATH` | — |
| `BCONNECT_CA_CERT_PATH` | Path to a CA certificate inside the container | — |
| `BCONNECT_TIMEOUT_MS` | Wait per bMS request, 1000–600000 ms; slow reads on a busy bMS may need `90000` | `30000` |
| `BCONNECT_MAX_RETRIES` | Retries for reads after a network error, timeout or 502/503/504 (0–5); writes are never retried | `0` |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | Accepted for compatibility; the gateway makes no startup call to bConnect | `false` |
| `BCONNECT_RATE_LIMIT_ENABLED` / `_MAX_REQUESTS` / `_WINDOW_MS` | Outbound limit towards bMS, per tool call for now (#160) | `false` / `100` / `60000` |
| `MCP_ALLOW_NO_AUTH` | Allow a non-loopback gateway bind (asserts a proxy is in front) | `false` |
| `MCP_GATEWAY_PORT` | Gateway listen port | `3001` |
| `MCP_GATEWAY_BIND` | Gateway bind address | `127.0.0.1` (the image and Compose: `0.0.0.0`, see [Manual `docker run`](#manual-docker-run)) |
| `MCP_GATEWAY_RATE_LIMIT_ENABLED` | Per-client-IP inbound rate limiting | `true` |
| `MCP_GATEWAY_RATE_LIMIT_MAX` | Max requests per window, per client IP | `300` |
| `MCP_GATEWAY_RATE_LIMIT_WINDOW_MS` | Rate-limit window (ms) | `60000` |
| `MCP_GATEWAY_MAX_BODY` | Max accepted request body size | `1mb` |
| `LOG_LEVEL` | Gateway log level: `error`, `warn`, `info`, `debug` | `info` |
| `LOG_FORMAT` | Gateway log format: `text` or `json` (use `json` for ELK/Loki) | `text` |

> The gateway writes a structured **access log** (method, path, status, duration, and the
> client address — behind a proxy that is the proxy's address; real identity lives at the
> proxy) for every request. Set `LOG_FORMAT=json` for machine-ingestible logs.

---

## Custom CA Certificates

If your bMS uses a custom CA, mount the PEM into the container and point
`BCONNECT_CA_CERT_PATH` at it:

```bash
docker run -d \
  -p 127.0.0.1:3001:3001 \
  -e MCP_ALLOW_NO_AUTH=true \
  -v /path/to/your-ca.pem:/certs/ca.pem:ro \
  -e BCONNECT_CA_CERT_PATH=/certs/ca.pem \
  -e BCONNECT_BASE_URL=https://bms.company.com/bconnect \
  -e BCONNECT_API_KEY=your-service-key \
  ghcr.io/baramundisoftware/bconnect-mcp-gateway:latest
```

Inside the container, the "OS trust store" is the image's own (Alpine's public CAs), not your
host's, so an internal CA always needs `BCONNECT_CA_CERT_PATH`. With Compose, set
`BCONNECT_CA_CERT_PATH` in `.env.gateway` to the file on the host, as an **absolute path in
`/…` form** (e.g. `/etc/ssl/certs/bms-ca.pem`): the compose file mounts it at the same path
inside the container, so a relative or Windows path doesn't work there. See
[INSTALLATION.md → TLS / SSL Configuration](INSTALLATION.md#tls--ssl-configuration) for how to
export the CA.

---

## Server Compatibility

The gateway serves all 13 servers on 26R1 (276 tools). On 25R2 it lists 240 tools, and two
servers don't work (compliance's 8 tools are among the 240 but fail):

| Server | Requires 26R1 |
|--------|--------------|
| bconnect-compliance-mcp | Yes: its tools are always offered and fail against 25R2, where the compliance API doesn't exist |
| bconnect-universaldynamicgroups-mcp | Yes: with `BCONNECT_RELEASE=25R2` it offers no tools |
| All others | No (works with 25R2 and 26R1) |

---

## Security Notes

- The gateway container runs as the non-root user `bconnect`.
- No credentials are embedded in the image.
- **Prefer mounted secrets over env vars (audit M2).** The gateway supports the
  Docker/Compose `*_FILE` convention for the service credential — mount the secret
  and point `<VAR>_FILE` at it instead of putting the value in the environment (where
  `docker inspect` would expose it). An explicit env var still wins if both are set.

  The shipped `docker-compose.gateway.yml` doesn't mount any secrets yet. Add them
  with a second compose file, e.g. `docker-compose.secrets.yml`, and start with
  `docker compose -f docker-compose.gateway.yml -f docker-compose.secrets.yml --env-file .env.gateway up -d`.
  Leave the credential itself empty in `.env.gateway`:

  ```yaml
  # docker-compose.secrets.yml (your own file, not shipped)
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
