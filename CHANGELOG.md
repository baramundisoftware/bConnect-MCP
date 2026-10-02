# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **Refused credential reads are audited.** A request the client refuses before sending it
  (a BitLocker or LAPS credential route while `ALLOW_SECRET_READ` is off, or a path that isn't
  in canonical form) is now recorded as a security audit entry at every
  `BCONNECT_AUDIT_LEVEL` except `none`. Before, it left no audit entry at any level. Audit
  lines escape control characters, so one entry can't forge another.
- **The credential-route gate and the path check refuse more unusual path forms.** Paths with
  malformed percent escapes are refused, and the gate recognises a credential route in more
  encodings.
- **Credentials are only sent over HTTPS.** A `BCONNECT_BASE_URL` with `http://` is refused
  unless the host is this machine (`localhost`, `127.x.x.x`, `[::1]`, e.g. the bundled mock) or
  `BCONNECT_ALLOW_INSECURE_HTTP=true` is set, which logs a warning. Before, credentials went in
  cleartext over any `http://` address. **Breaking for `http://` setups:** switch to `https://`
  (recommended) or set the opt-in. Configuration errors (missing credentials, an unreadable CA
  file, an insecure base URL) now all stop the server with a clear message.
- **Credentials are only sent to the configured bConnect host.** The client no longer follows
  HTTP redirects. Before, a redirect could carry an API key (`X-Api-Key`) to another host. A
  redirect now stops with a message naming the target address and asking to set
  `BCONNECT_BASE_URL` to it. **Behaviour change:** a bMS behind a front end that redirects (for
  example from `http://` to `https://`) needs its final address in `BCONNECT_BASE_URL`.
- **Local secret files are ignored by git.** `.gitignore` now covers every `.env` and `.env.*`
  copy in any directory (for example the `.env.gateway` the gateway setup asks for) and a
  `secrets/` directory. The `*.example` templates stay tracked.
- **Four write tools are now refused while write operations are disabled.**
  `withdraw_kiosk_release`, `link_entra_id_data`, `unlink_entra_id_data` and
  `replace_application_in_bundle` were missing from their server's write gate and sent
  their request even with `ALLOW_WRITE_OPERATIONS` unset. They now return the same
  refusal as every other write tool (#190).
- **Updated dependencies with known advisories.** All updates stay within their major
  version: axios 1.20.0, hono 4.13.12, @hono/node-server 1.19.17, js-yaml 4.3.2,
  fast-uri 3.1.8, ip-address 10.7.2, qs 6.16.0, body-parser, and express 4.22.3 in the
  gateway. `npm audit --omit=dev` now reports no vulnerabilities for the servers or the
  gateway. `openapi-typescript`, a code generator, is now a development dependency, so a
  production install (`npm ci --omit=dev`) no longer pulls it in. dotenv stays on 16:
  from 17 on it writes to stdout, which breaks stdio MCP clients.
- **Tool arguments are validated in every server.** The endpoints, groups and jobs servers
  now check each tool's arguments before sending a request, as the other servers already
  did: ID arguments must be GUIDs. Invalid input is refused with an `Invalid parameters`
  error and nothing is sent.
- **The shared client only sends canonical request paths.** `@bconnect/mcp-core` refuses a
  request whose path contains dot segments, backslashes, percent-encoded separators or a
  query string, whichever tool built it. Query parameters are always passed separately.
- **Credential-returning write tools now require `ALLOW_SECRET_READ`.**
  `update_bitlocker_pin` and `patch_local_admin_user_credentials` return the same BitLocker
  recovery keys / startup PIN and LAPS password as `get_bitlocker_secrets` and
  `get_local_admin_accounts`, but were gated only by `ALLOW_WRITE_OPERATIONS`. They now need
  both gates. The refusal says an operator must set the variable and restart the server.
- **Second lock in the shared client.** `@bconnect/mcp-core` refuses the BitLocker-secrets and
  LAPS operations before sending unless `ALLOW_SECRET_READ=true`, whichever tool issues the
  request, matching on the canonical request path.
- **Guard test.** Derives the credential-returning operations from the 25R2/26R1 OpenAPI
  response schemas, exercises every tool of every server, and fails if one reaches such an
  operation without the gate, or calls a path the spec doesn't declare.

### Changed
- **`update_network_endpoint`, `update_industrial_endpoint` and the maintenance-window updates
  take named fields** instead of an untyped `updateData` / `maintenanceWindowData` object, which
  was never sent in a form bConnect accepts.
- **`create_job_instance` no longer offers `scheduledStartTime`.** The API has no such field; the
  job always started immediately. The description now says so; `endpointId` is required and
  `startIfAlreadyAssigned` is available.
- **`BCONNECT_REJECT_UNAUTHORIZED` is removed.** Only the groups server read it, while the
  READMEs listed it for every server. To turn certificate checks off for development, set
  `NODE_TLS_REJECT_UNAUTHORIZED=0`, which every server honors. In production, keep
  verification on and point `BCONNECT_CA_CERT_PATH` at your internal CA instead (#197).
- **One shared function builds every server's bConnect client config.** `@bconnect/mcp-core`
  now reads the connection settings (base URL, credentials, API key, CA certificate, TLS,
  audit level, rate limit) for the tool client and the startup check of all 13 servers, so
  the servers can't drift apart again (#197). Effects:
  - The groups server no longer refuses to start without `BCONNECT_BASE_URL`. Like the other
    servers, it falls back to the placeholder URL `https://bms.example.com:443/bconnect`;
    run alone, its startup check then fails against it. In the gateway, where no startup
    check runs, groups tool calls now go to the placeholder URL instead of being refused,
    as the other servers' calls already did.
  - Ten servers used `https://bms-server/bconnect` as the tool calls' fallback base URL and
    a different one for the startup check; all now use the same placeholder.
  - An empty `BCONNECT_BASE_URL`, or an empty base URL passed per request, now counts as
    unset (it used to be passed on as an empty URL).
  - Missing credentials give the same error in every server: tool calls fail with an
    internal error (groups returned an invalid-request error with a different text), and
    the server exits at startup with one line naming both ways to authenticate (endpoints
    and jobs printed a stack trace).
  - An empty `BCONNECT_CA_CERT_PATH` file is an error. It used to replace the trusted CAs
    with Node's built-in list without saying so.
- **`BCONNECT_RELEASE` now defaults to `26R1`** (was `25R2`), matching the documented
  default and the advertised tool counts (e.g. 66 endpoints tools, 276 total). Following
  the README with no `BCONNECT_RELEASE` set previously registered the smaller 25R2 subset
  (60 endpoints tools) silently. Set `BCONNECT_RELEASE=25R2` explicitly on older servers;
  the 26R1-only tools 404 there. Added `BCONNECT_RELEASE` to the endpoints/jobs
  `.env.example` files. This applies to every server that reads the variable, including
  servermanagement, which now also refuses a 26R1-only tool on 25R2 with the same message
  as the others.

### Removed
- **Per-server container files** (aligning with ADR-0003 — only the gateway is
  distributed as a container; the 13 servers run over stdio via Node/Claude Desktop).
  Removed `docker-compose.yml`, the 13 per-server `Dockerfile`s, and
  `build-tests/docker-smoke.test.sh`. These built each server from its own directory,
  which stopped working after the workspace refactor (no per-server lockfile;
  `@bconnect/mcp-core` is a private `file:` dependency). The gateway image
  (`docker-compose.gateway.yml` + `bconnect-mcp-gateway/Dockerfile`) is unaffected.

### Fixed
- **Endpoint and logical-group updates work.** The Windows, Linux, Mac, network and industrial
  endpoint updates, `update_logical_group` and both maintenance-window updates now offer the
  fields bConnect lets you change (display name, logical group, comment, host name, IP and MAC,
  registered user, …) as named arguments, and send them as a JSON Patch. Before, they sent their
  arguments as a plain object, which bConnect doesn't accept. A call that changes nothing is
  refused.
- **Update requests use the content type bConnect declares.** Every PATCH is now sent as
  `application/json-patch+json`, as all PATCH operations in the 25R2 and 26R1 specs require. 22
  update tools (endpoints, assets, OS, server management, variables, job folders, LAPS expiry)
  sent `application/json` before.
- **`restart_management_server` can schedule the restart** with `utcScheduleRestartTime`
  (ISO 8601, UTC). Without it the restart is immediate, as before; the description now says so.
- **Write tools report what bMS returned.** Windows and Mac enrollment return the install
  command, token, URL and QR text; `trigger_intune_installation` reports "not triggered" when bMS
  answers false; endpoint and maintenance-window updates, the MSW cleanup (and its simulation) and
  security group, profile and permission updates return bMS's result instead of a fixed text.
  Malformed object or JSON Patch arguments are refused before any request.
- **Job write tools send what the API accepts and report what happened.** `create_kiosk_release`
  sends `assignmentTargetId`, `update_job_folder` sends a JSON Patch (and refuses a call that
  changes nothing), and the four `assign_job_to_*_group` tools send only the assignment fields.
  A group assignment that bMS answers with 207 is reported as "fully or partially succeeded"
  with bMS's details on failed targets, instead of "Created undefined job instances". The assign
  tools' descriptions now say that a job instance is created and started for every member,
  including all sub-groups of a logical group.
- **Gateway settings in `.env.gateway` now take effect** (#98, reported by @AndreasHanikel).
  `docker-compose.gateway.yml` passes `LOG_LEVEL`, `LOG_FORMAT`, the inbound rate limit
  (`MCP_GATEWAY_RATE_LIMIT_*`), `MCP_GATEWAY_MAX_BODY`, `BCONNECT_RELEASE` and the outbound rate
  limit (`BCONNECT_RATE_LIMIT_*`), plus `BCONNECT_ALLOW_INSECURE_HTTP`, to the container;
  before, they were silently ignored.
  `.env.gateway.example` documents `BCONNECT_AUDIT_LEVEL` and the other forwarded settings.
- **The mobile device rule tools return rules.** `list_mobile_device_rules` and
  `get_mobile_device_rule` called `/MobileDeviceRules`, a route the API doesn't have, so they
  always failed with 404 and never returned data. They now call `/v2.0/Rules` and
  `/v2.0/Rules/{id}`, as the API declares (#176).
- **groups tools now work against a bConnect server with an internal CA (#197).** The groups
  server's tool calls ignored `BCONNECT_CA_CERT_PATH` and `NODE_TLS_REJECT_UNAUTHORIZED`:
  the server started, and then every groups tool failed with a TLS error. Its tool calls now
  use the CA, TLS and `BCONNECT_AUDIT_LEVEL` settings like every other server, and the
  startup check uses the same settings as tool calls.
- **Audit logging works in stdio mode (#168).** Audit entries went to stdout, which carries
  the MCP protocol in stdio mode, so enabling auditing broke the connection to Claude Desktop
  or Claude Code. Every audit entry now goes to stderr.
- **Audit levels include each other (#168).** `write` now also records what `security`
  records, and `security` now also records reading or changing a LAPS password, not only
  BitLocker secrets. Before, a LAPS password read was recorded at no level except `all`.
- **A mistyped `BCONNECT_AUDIT_LEVEL` no longer switches auditing off (#161).** Case and
  surrounding spaces no longer matter (`WRITE` and ` write ` mean `write`). **Behaviour
  change:** any value other than `none`, `security`, `write` or `all` now stops the server
  with a message naming the value and the valid levels. Before, it silently meant `none`.
  Unset or empty still means `none`.
- **The `BCONNECT_RATE_LIMIT_*` settings now reach every server's client.** Nine servers
  (compliance, defensecontrol, groups, operatingsystems, servermanagement, software,
  universaldynamicgroups, updatemanagement, variables) never passed them on. Each tool call
  still creates a new client, so the limit applies only within one tool call, not across
  calls, until #160 is done.
- **Servers no longer exit at startup with "Resource not found" (#111).** The connectivity
  check requested `/v2.0/WindowsEndpoints` without a domain prefix, a route bConnect doesn't
  have, so every server stopped unless `BCONNECT_SKIP_CONNECTIVITY_CHECK=true` was set. Each
  server now probes a list route of its own domain (e.g. `/endpoints/v2.0/Endpoints`) with
  `PageSize=1`. `BCONNECT_SKIP_CONNECTIVITY_CHECK` is no longer needed for this, and
  `healthCheckPath` in the client config still overrides the route.
- **Gateway robustness.** An error while handling one MCP request could terminate the whole
  gateway process for every client. The request now fails on its own (HTTP 500 with a JSON-RPC
  error, details only in the server log), and the domain in `POST /<domain>/mcp` is matched
  against the registered domains only; anything else is `404 Unknown MCP domain`.
- **`update_bitlocker_pin` called a route the API doesn't have** (`PATCH …/{id}/Pin`); it now
  uses the spec operation `PATCH …/BitLocker/WindowsEndpoints/{id}/Secrets`.
- **Startup connectivity check.** `BConnectClientBase.testConnection()` probed a
  non-existent `/info` route (always 404) — latent because every deployment either set
  `BCONNECT_SKIP_CONNECTIVITY_CHECK=true` or ran the gateway (which never probes). A
  standalone server started from a plain `.env` (no skip flag) failed at startup. It now
  probes a real lightweight list endpoint (`/v2.0/WindowsEndpoints?$top=1`), overridable
  via `healthCheckPath` for credentials scoped away from endpoints.
- **esbuild** dev dependency bumped `0.27.7` → `0.28.1` (Dependabot alerts; dev-only).
- **TLS: honor the OS/client CA trust store on Node ≥ 22.15** (issue #59) — an
  already-trusted enterprise CA now works without a manual export; clearer TLS errors.
- **Docs** actualized: build-from-root (workspaces) instructions, Node 22 baseline,
  gateway-only Docker guide, credentials-at-rest hardening, and a Repository layout section.

## [26.1.7] - 2026-07-14

> Version bumped `26.1.5` → `26.1.7` across the suite (26.1.6 was documented but
> never tagged/released).

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
- **Node.js baseline raised to 22 (LTS).** Docker images now build on `node:22-alpine`
  and `engines.node` is `>=20.0.0` (18 is EOL). The automatic OS-trust-store behavior
  below requires Node ≥ 22.15.

### Fixed
- **TLS: honor the OS/client CA trust store (issue #59).** Node validates TLS against
  its bundled CA list only and never reads the OS certificate store, so an internally
  signed bMS certificate that Windows already trusts still failed until the admin
  manually exported it and set `BCONNECT_CA_CERT_PATH`. On **Node.js ≥ 22.15** the
  shared client now merges the OS trust store (`tls.getCACertificates("system")`) with
  Node's bundle, so an already-trusted CA works with **zero export**. `BCONNECT_CA_CERT_PATH`
  remains an explicit override; behavior is unchanged on older Node (feature-detected).
- **Clearer TLS errors.** A certificate-not-trusted failure now returns an actionable
  message (upgrade Node, set `BCONNECT_CA_CERT_PATH`, or `NODE_EXTRA_CA_CERTS`) instead
  of a generic "cannot connect".

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
