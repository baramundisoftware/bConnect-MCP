# Docker Deployment Guide — bConnect MCP gateway

This guide covers running the **bConnect MCP gateway** as a Docker container.

> **Only the gateway is distributed as a container** (per ADR-0003). The 13 domain MCP
> servers communicate over **stdio** — they are plain Node.js processes that whichever
> MCP client you use spawns for itself, and they are **not** containerized. To run a
> stdio server, see [INSTALLATION.md](INSTALLATION.md), not this guide.
>
> The gateway is also the **only** route for clients with no stdio support at all —
> n8n, Open WebUI, OpenAI's hosted MCP tool and Microsoft Copilot Studio.

The gateway (`bconnect-mcp-gateway`) serves all 14 servers on a single HTTP port for
teams and n8n. As of the 2026-08-02 revision (`SEC-7`) it has **built-in bearer-token
authentication** — set `MCP_GATEWAY_AUTH_TOKEN` and every request must carry
`Authorization: Bearer <token>` or it gets a `401`; `docker compose up` refuses to start
without one configured. A shared token is the floor: for per-user identity, SSO, or an
audit trail tied to a real person, still front it with a TLS-terminating, authenticating
reverse proxy (see
[TLS and authentication](#tls-and-authentication-operator-responsibility)). Downstream
bMS calls use a single `BCONNECT_*` service credential (bMS RBAC governs it — scope it
to least privilege).

> **Migrating an existing deployment?** See
> [MIGRATION-tool-surface.md § Gateway authentication](MIGRATION-tool-surface.md#9-gateway-authentication-bconnect-mcp-gateway-sec-7)
> for the exact steps — the compose file previously shipped `MCP_ALLOW_NO_AUTH=true`,
> which disarmed the gateway's fail-closed guard by default; that line is now removed.

---

## Get the image

The gateway image is published to the GitHub Container Registry as a **multi-arch**
image (linux/amd64 + linux/arm64) — browse it on the
[Packages page](https://github.com/orgs/baramundisoftware/packages?repo_name=bConnect-MCP):

```bash
docker pull ghcr.io/baramundisoftware/bconnect-mcp-gateway:latest
# or pin a version: …/bconnect-mcp-gateway:26.1.8
```

To build it yourself instead, the build context must be the repo **root** — the gateway
bundles the shared `@bconnect/mcp-core` and all 14 servers:

```bash
docker build -f bconnect-mcp-gateway/Dockerfile -t bconnect-mcp-gateway:local .
```

---

## Quick Start — Docker Compose (recommended)

```bash
cp .env.gateway.example .env.gateway
# Edit .env.gateway — set BCONNECT_BASE_URL, the BCONNECT_* service credential,
# and MCP_GATEWAY_AUTH_TOKEN (24+ random characters). `docker compose up` refuses
# to start without a token configured.

docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d

# Verify. /health is a liveness probe: reachable without a token so container and
# orchestrator probes keep working, and it discloses nothing else.
curl http://localhost:3001/health
# → {"status":"ok"}

# The mounted domain list is served only to a caller carrying a configured token.
curl -H "Authorization: Bearer $MCP_GATEWAY_AUTH_TOKEN" http://localhost:3001/health
# → {"status":"ok","servers":["activedirectory",…],"count":13}

# A tool call needs the bearer token
curl -X POST http://localhost:3001/endpoints/mcp \
  -H "Authorization: Bearer $MCP_GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Manual `docker run`

```bash
# Bind loopback and set a token. The image's own default bind is now 127.0.0.1
# (it no longer sets MCP_GATEWAY_BIND=0.0.0.0) — publish a non-loopback port only
# with MCP_GATEWAY_BIND set explicitly, and either a token or MCP_ALLOW_NO_AUTH=true
# (your assertion that a fronting proxy handles auth instead).
docker run -d \
  -p 127.0.0.1:3001:3001 \
  -e BCONNECT_BASE_URL=https://bms.company.com/bconnect \
  -e BCONNECT_API_KEY=your-service-key \
  -e MCP_GATEWAY_AUTH_TOKEN=your-24-plus-character-token \
  ghcr.io/baramundisoftware/bconnect-mcp-gateway:latest
```

The service credential — and the gateway token — can be supplied from mounted secrets
via the `*_FILE` convention (audit M2), e.g. `-e BCONNECT_API_KEY_FILE=/run/secrets/bms_api_key`
and `-e MCP_GATEWAY_AUTH_TOKEN_FILE=/run/secrets/gateway_token`.

Clients connect with the bearer token, directly or via your authenticating proxy
(which supplies whatever credential/session it requires and forwards its own token to
the gateway):

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "type": "http",
      "url": "https://mcp-gateway.company.com/endpoints/mcp",
      "headers": {
        "Authorization": "Bearer your-24-plus-character-token"
      }
    }
  }
}
```

> The wrapper differs per client — VS Code uses `servers` rather than `mcpServers`,
> Cursor omits `"type"`, Continue and LibreChat write `type: streamable-http` in YAML,
> and Claude Code treats a `url` entry with no `"type"` as stdio. See
> [INSTALLATION.md → Client Configuration](INSTALLATION.md#client-configuration).

### TLS and authentication (operator responsibility)

The gateway serves plain HTTP and has **no built-in TLS**. It does have built-in
**bearer-token authentication** (`MCP_GATEWAY_AUTH_TOKEN`, described above) — that covers
"is this caller allowed to use the gateway at all" with a single shared secret, but not
TLS, per-user identity, or SSO. For those, or for anything beyond loopback, **front the
gateway with a TLS-terminating, authenticating reverse proxy** of your choice (nginx,
Caddy, Traefik, HAProxy, or your IdP's application proxy) that forwards its own bearer
token to the gateway. This is the standard pattern for self-hosted infrastructure: the
operator owns the perimeter.

The proxy in front of the gateway must:

- **Terminate TLS** — credentials and data travel in HTTP headers; never expose
  the gateway over plaintext beyond localhost.
- **Authenticate the caller** — via your IdP (OIDC/SAML) or the mechanism your
  organisation already runs.
- **Reach the gateway only over a private/loopback network** — publish the
  proxy, not the gateway. As a fail-closed default the gateway refuses to start
  on a non-loopback bind unless either `MCP_GATEWAY_AUTH_TOKEN` is set (a token
  now satisfies the guard) or `MCP_ALLOW_NO_AUTH=true` is set explicitly as your
  assertion that a proxy is doing the authenticating instead.
- **Strip any client-supplied identity headers** before injecting its own.
- **Forward its own `Authorization: Bearer <token>`** to the gateway — the proxy
  authenticates the human; the token still authenticates the proxy's calls to the
  gateway itself.

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
| `BCONNECT_AUDIT_LEVEL` | `none`, `security`, `write`, `all` | `none` |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | Skip the startup connectivity probe **and the 26R1 version gate with it** | `false` |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set to `0` for self-signed certs (dev only) | `1` |
| `BCONNECT_CA_CERT_PATH` | Path to a CA certificate inside the container | — |
| `MCP_GATEWAY_AUTH_TOKEN` | One or more shared bearer tokens (comma-separated for rotation); required on every `Authorization: Bearer <token>` request once set. 24+ characters or the gateway refuses to start | — |
| `MCP_GATEWAY_AUTH_TOKEN_FILE` | Docker-secret form of `MCP_GATEWAY_AUTH_TOKEN` | — |
| `MCP_ALLOW_NO_AUTH` | Allow a non-loopback gateway bind with **no** token (asserts a proxy is in front instead). Not set by anything shipped in this repo | `false` |
| `MCP_GATEWAY_PORT` | Gateway listen port | `3001` |
| `MCP_GATEWAY_BIND` | Gateway bind address. The compose file sets this explicitly; the container image's own default is `127.0.0.1` (no longer `0.0.0.0`) | `127.0.0.1` |
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

**The gateway requires baramundi Management Suite 26R1 or later**, and serves all 14 servers
against it. 25R2 and older are not supported: the gateway reads the bMS version from
`GET /v2.0/ManagementServer` during its startup connectivity check and refuses to start on
anything older. There is no `BCONNECT_RELEASE` setting.

This is also why the version gate is an **API** check and not a Windows-registry read — the
gateway runs in a Linux container, where there is no registry to consult, and the bMS it talks to
is a different machine anyway.

If the container cannot reach that route, set `BCONNECT_SKIP_CONNECTIVITY_CHECK=true` to skip the
probe and the gate together.

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
