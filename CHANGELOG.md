# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed (breaking)
- **Gateway token-map authentication (`MCP_AUTH_CONFIG`).** The gateway no longer
  authenticates callers or maps Bearer tokens to bConnect credentials. Per ADR-0003,
  **authentication is the operator's responsibility** — front the gateway with an
  authenticating, TLS-terminating reverse proxy / IdP — and the gateway uses a single
  `BCONNECT_*` **service credential** (bMS RBAC governs it). Removed `MCP_AUTH_CONFIG`,
  the token map, hashed-token mode, and the `hash-token` helper.

### Changed
- Gateway fail-closed default: a non-loopback bind now requires `MCP_ALLOW_NO_AUTH=true`
  (asserting an authenticating proxy is in front). Loopback bind is otherwise unchanged.
- Inbound rate limiting is now keyed **per client IP** (was per Bearer token).
- `docker-compose.gateway.yml` publishes the host port on **loopback only** by default.
- README / `docs/DOCKER.md` / `docs/INSTALLATION.md` / `docs/N8N.md` updated to the
  proxy-fronted, service-credential model, with a prominent operator-security notice.

## [26.1.6] - 2026-06-17

### Added
- **`docker-compose.gateway.yml`** — new dedicated Docker Compose file for the
  HTTP gateway (multi-user / n8n) use case. Separates the gateway deployment from
  the stdio server deployment (`docker-compose.yml`). Includes healthcheck and
  token map volume mount.
- **`.env.gateway.example`** — new env template for the gateway, containing only
  the variables it needs: `BCONNECT_BASE_URL`, TLS settings, `MCP_AUTH_CONFIG_PATH`,
  `MCP_GATEWAY_HOST_PORT`, and commented single-credential fallback vars. Used with
  `--env-file .env.gateway`.

### Changed
- **`docker-compose.yml`** — gateway service (`mcp-gateway`) removed; stdio-only now.
- **`.env.example`** — simplified to stdio use case; gateway variables removed.
- **Token map examples** across README, `docs/INSTALLATION.md`, `docs/DOCKER.md`,
  and `docs/N8N.md` — removed `baseUrl` from per-user entries. `BCONNECT_BASE_URL`
  is set once in `.env.gateway` and shared by all tokens; `baseUrl` in a token entry
  is now documented as an advanced/multi-server override only.
- **`docs/N8N.md`** — added AI Agent + MCP tool node setup guide (Step 2: MCP Server
  credential, Step 3: wire Tool: MCP sub-node); added **Context Window & Performance**
  section with token cost table per domain combination and per-use-case domain
  recommendations.
- All gateway startup commands updated to use
  `docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d`.
- All `.env` references in gateway context corrected to `.env.gateway` across
  `docker-compose.gateway.yml`, README, `docs/INSTALLATION.md`, `docs/DOCKER.md`,
  and `docs/N8N.md`.

## [26.1.5] - 2026-06-16

### Added
- **`docs/N8N.md`** — new integration guide for using the bConnect MCP gateway
  from n8n workflows. Covers: storing Bearer tokens as n8n Header Auth credentials,
  MCP Client node configuration, HTTP Request node alternative, domain reference
  table, multi-user example (2 users / 2 bConnect API keys), troubleshooting table,
  and security notes.

### Changed
- **`docs/INSTALLATION.md` Option D** rewritten for clarity: broken into 4 explicit
  steps (build, generate tokens, create token map, start gateway); token requirements
  documented (min 32 random bytes, unique per user, descriptive prefix); placeholder
  table explains every value to replace; apiKey vs username/password options clarified;
  health check verification and `chmod 600` guidance added.
- README and `docs/INSTALLATION.md` updated with pointer to the new N8N.md.
- Version bumped to `26.1.5` across all `package.json` files, `src/index.ts` server
  version strings, and documentation footers (`DOCKER.md`, `INSTALLATION.md`,
  `TROUBLESHOOTING.md`, `WINDOWS-DEPLOYMENT.md`, `N8N.md`).
- **SBOM regenerated** (`releases/sbom.json`) using `@cyclonedx/cyclonedx-npm` 5.0.0
  (previously 4.2.1); updated timestamp, version reference, and dependency tree.
- `docker-compose.yml` gateway image tag corrected from stale `26.1.1` to `26.1.5`.

## [26.1.4] - 2026-06-16

### Added
- **Auth middleware unit tests** (`bconnect-mcp-gateway/src/__tests__/auth.test.ts`, 23 tests):
  `loadTokenMap` and `createAuthMiddleware` are now fully covered — missing file,
  invalid JSON, non-object root (all call `process.exit(1)`); auth disabled pass-through;
  401 on missing/wrong/unknown Bearer token; correct credential resolution per token;
  no credential leakage between requests; n:m sharing verified.
- **Credential injection tests** (`bconnect-compliance-mcp/src/__tests__/credentials.test.ts`,
  6 tests): verifies that `createServer(credentials)` passes injected apiKey and
  username/password to `BConnectClient`, takes priority over env vars, falls back to env
  vars when omitted, and is stateless across tool calls. `BConnectClient` is mocked so
  no real bConnect connection is made.
- **Gateway refactored** into three modules for testability: `auth.ts` (token map +
  middleware, no server imports), `app.ts` (`createApp` factory), `gateway.ts` (startup
  only). The public gateway behaviour is unchanged.
- **`bconnect-mcp-gateway`** now has `test`, `test:watch`, and `test:coverage` npm
  scripts with a `vitest.config.ts`.

## [26.1.3] - 2026-06-16

### Added
- **Gateway authentication via token map** (`MCP_AUTH_CONFIG`): `bconnect-mcp-gateway`
  now supports per-user Bearer token authentication. Set `MCP_AUTH_CONFIG` to a JSON
  file mapping tokens to bConnect credentials (baseUrl, apiKey or username/password).
  Multiple MCP tokens can share one bConnect API key (n:m mapping). When unset, the
  gateway falls back to `BCONNECT_*` env vars — fully backwards compatible.
- `BConnectCredentials` interface exported from all 13 servers; `createServer()` now
  accepts an optional `credentials` parameter so the gateway can inject per-request
  bConnect credentials without touching environment variables.
- Gateway environment variables: `MCP_GATEWAY_PORT` (default `3001`),
  `MCP_GATEWAY_BIND` (default `127.0.0.1`), `MCP_AUTH_CONFIG`.
- `/health` endpoint now reports `authEnabled` status.
- Documentation updated: README, `docs/INSTALLATION.md`, `docs/DOCKER.md` — covers
  gateway setup, token map format, and client configuration examples.

## [26.1.2] - 2026-06-09

### Fixed
- Updated copyright from "baramundi software AG" to "baramundi software GmbH"
- Resolved all runtime dependency vulnerabilities (hono, fast-uri, ip-address)
- Set author field in package.json

### Added
- Dependabot configuration for automated dependency updates
- `.editorconfig`, `.nvmrc`, and `.prettierrc.json` for contributor consistency

## [26.1.1] - 2026-06-09

Initial release. 12 domain-specific MCP servers for the baramundi bConnect REST API,
providing 212 tools across endpoints, jobs, assets, software, compliance, and more.

- 12 servers: endpoints, jobs, assets, software, activedirectory, servermanagement,
  defensecontrol, variables, operatingsystems, compliance (26R1), universaldynamicgroups (26R1),
  updatemanagement
- Compatible with baramundi Management Suite 25R2 and 26R1
- Authentication via Basic Auth or API Key
- Transport modes: stdio (local) and HTTP (network/Docker)
- Unit tests and mock-integration tests across all servers
