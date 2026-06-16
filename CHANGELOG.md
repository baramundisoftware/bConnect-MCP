# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
