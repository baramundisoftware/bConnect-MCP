# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest 26.1.x release (supports bMS 2026 R1 and 2025 R2) | ✅ Security fixes |
| Older 26.1.x releases | ❌ Update to the latest |

All releases are pre-releases (Technical Preview). There is no separate 25.2.x line: one release
line supports both bMS releases, selected with `BCONNECT_RELEASE`.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report vulnerabilities privately through GitHub:
**[Report a vulnerability](https://github.com/baramundisoftware/bConnect-MCP/security/advisories/new)**
(the repository's *Security* tab → *Report a vulnerability*). Only the maintainers see the report.

If you can't use GitHub, email **bernd.wiedemann@baramundi.de**.

Include as much of the following as possible:

- Type of issue (credential exposure, injection, authentication bypass, etc.)
- File paths and line numbers where the issue occurs
- Steps to reproduce
- Proof-of-concept or exploit code (if available)
- Impact assessment

### What to Expect

- **Acknowledgement** within 5 business days
- **Status update** within 10 business days
- **Fix timeline** communicated once the issue is confirmed
- **Credit** in the CHANGELOG and release notes if desired

## Security Considerations

> The controls below describe the current `main` branch. Changes after the latest release are
> listed in [CHANGELOG.md](CHANGELOG.md) → Unreleased.

### Credentials at rest (`.env` and client config)

Each MCP server reads `BCONNECT_USERNAME`/`BCONNECT_PASSWORD` (or `BCONNECT_API_KEY`)
from the environment — typically a `.env` file, or, for Claude Desktop, the
`env` block of `claude_desktop_config.json`. **These are stored in plaintext.**
Until an encrypted-at-rest option ships (tracked in
[issue #60](https://github.com/baramundisoftware/bConnect-MCP/issues/60)), harden
the file so a plaintext credential is not casually readable:

**1. Least privilege first (limits the blast radius).** Use a dedicated bMS service
account scoped to only what the deployment needs — bMS RBAC governs it, so a leaked
credential can do no more than that account can. Leave `ALLOW_WRITE_OPERATIONS` /
`ALLOW_SECRET_READ` unset unless required.

**2. Restrict file permissions.**

- **Linux / macOS:** make the file owner-only and keep it out of shared paths:
  ```bash
  chmod 600 .env            # or the claude_desktop_config.json
  chmod 700 "$(dirname .env)"
  ```
- **Windows:** tighten the NTFS ACL to the running user only (remove inherited
  `Users`/`Everyone` access):
  ```powershell
  icacls "$env:APPDATA\Claude\claude_desktop_config.json" /inheritance:r /grant:r "$($env:USERNAME):(R,W)"
  ```

**3. Never commit or export it.** `.gitignore` already excludes `.env`. Avoid leaking
it via shell history, process listings, logs, or backups.

**4. Keep credentials out of the client configuration.** Start the server with
`node --env-file=/path/to/bconnect.env …/build/index.js` (Node.js reads the file itself), so
the MCP client's configuration holds no secret; restrict that file as in step 2. See
[docs/CLIENTS.md](docs/CLIENTS.md).

**5. Prefer a secret mechanism where available.** For the **gateway**, supply
credentials from mounted secrets via the `*_FILE` convention (e.g. Docker/Kubernetes
secrets) instead of plain env vars — see [HTTP Gateway](#http-gateway-bconnect-mcp-gateway).

> File permissions are a mitigation, not encryption. An option that keeps credentials
> encrypted at rest (OS credential store — Windows DPAPI / Credential Manager, macOS
> Keychain — or an external secret store) is planned in #60.

### Connection to bConnect

- **HTTPS only.** A `BCONNECT_BASE_URL` with `http://` is refused, except for this machine
  (`localhost`, `127.x.x.x`, `[::1]`) or with the explicit opt-in `BCONNECT_ALLOW_INSECURE_HTTP=true`.
- **No redirects.** The client doesn't follow HTTP redirects, so credentials only go to the
  configured host; a redirect stops the call.
- **Configuration errors stop the server**: missing credentials, an unreadable CA file, an
  invalid timeout, retry count, audit level or release.

### TLS Configuration

Always verify the bMS certificate. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`, in production or in a test against a real bMS: it disables all certificate validation, so the credentials go to whoever answers. See [docs/INSTALLATION.md](docs/INSTALLATION.md) for the correct TLS setup using `BCONNECT_CA_CERT_PATH`.

### Audit Logging

Each server supports configurable audit logging via `BCONNECT_AUDIT_LEVEL` (`none` / `security` / `write` / `all`, in any case). Levels are cumulative: `security` records every call to a security-relevant route (credential reads and changes for BitLocker and LAPS, enrollment tokens, API keys, object rights, security groups and profiles; the list is derived from the API specifications and checked by a test, see [docs/AUDIT.md](docs/AUDIT.md)), `write` adds every write, and `all` records every request. An unknown value stops the server, so a typo can't switch auditing off (in the gateway, every tool call fails with the same message instead). Audit entries are written to stderr, so auditing works in stdio mode too. A request the client refuses before sending it (a credential route while `ALLOW_SECRET_READ` is off, or a non-canonical path) is recorded as a security entry at every level except `none`.

### Write-Operation Gating

Write/mutating tools are **disabled by default**. A server exposes them only when `ALLOW_WRITE_OPERATIONS=true` is set; otherwise they are left out of the tool list, and a write tool called by name returns a clear "disabled" error. Leaving them out of the list only saves context; the refusal is the control. Leave it unset for monitoring / reporting deployments where mutation must be prevented. Secret-returning tools (BitLocker recovery keys, LAPS local-admin passwords) are additionally gated behind `ALLOW_SECRET_READ`.

### Secret-Read Gating

A tool whose response contains live credentials is **disabled by default**, whatever its HTTP method: `get_bitlocker_secrets`, `update_bitlocker_pin`, `get_local_admin_accounts` and `patch_local_admin_user_credentials`. It runs only when `ALLOW_SECRET_READ=true` is set in the server's environment; the write tools among them need `ALLOW_WRITE_OPERATIONS=true` as well. The gate is enforced twice: by tool name in the server, and by route in the shared HTTP client, which refuses these bConnect operations before any request is sent.

### Hidden characters in bMS data

Text from bMS (endpoint, job and software names, client error messages, directory descriptions) is
often not written by the administrator. Before it reaches the model, the shared client removes
characters that are invisible to people but read by a model: Unicode format characters and every
default-ignorable code point, which covers zero-width characters, direction controls, variation
selectors (used to hide bytes after an emoji), Hangul fillers and tag characters
(U+E0000–U+E0FFF). Each removed run is shown as `[hidden characters removed]`. ZWJ, ZWNJ and the two
emoji presentation selectors (U+FE0E, U+FE0F), which visible text needs, are kept.

bConnect's error text is cleaned more strictly: it is quoted on one line, the same characters
and also ZWJ/ZWNJ are removed, without a marker.

Visible text that tries to instruct the model can't be filtered reliably; keep write tools disabled
unless you need them. A value copied from a result into a write tool carries the marker into bMS.

### Rate Limiting

Each server's bConnect client has a token-bucket rate limiter, set via `BCONNECT_RATE_LIMIT_ENABLED`, `BCONNECT_RATE_LIMIT_MAX_REQUESTS` and `BCONNECT_RATE_LIMIT_WINDOW_MS`. All tool calls of a server share one client and so one limit (in the gateway: one per domain); a call over the limit fails before anything is sent.

### HTTP Gateway (`bconnect-mcp-gateway`)

The optional `bconnect-mcp-gateway` exposes all 13 servers over **HTTP** for multi-user / n8n use. (A single server also has an HTTP mode, `MCP_TRANSPORT=http`, for local use: it binds loopback and has no authentication either.) Its security model:

- **No built-in authentication — by design.** The gateway is an unopinionated HTTP component; **authentication and TLS are the operator's responsibility.** Front it with a TLS-terminating, authenticating reverse proxy / IdP (nginx, Caddy, Traefik, Entra Application Proxy, …) that terminates TLS, authenticates every caller, reaches the gateway only over a private/loopback network, and strips client-supplied identity headers. (The former per-user token map was removed.) The proxy should also check `Host` and `Origin`.
- **Fail-closed default.** The gateway binds `127.0.0.1` and **refuses to start on a non-loopback bind** unless `MCP_ALLOW_NO_AUTH=true` is set — an explicit operator assertion that a proxy is in front. This prevents an accidentally-exposed, unauthenticated bMS proxy.
- **Single service credential.** Downstream bMS calls use one `BCONNECT_*` service credential; **bMS RBAC governs what it can do**, so scope that account to least privilege. Credentials can be supplied from mounted secrets via the `*_FILE` convention instead of plain env vars.
- **Allowed host names only.** The gateway answers only requests addressed to `localhost`, `127.0.0.1`, `[::1]` or a name in `MCP_GATEWAY_ALLOWED_HOSTS`, and refuses a browser request whose `Origin` isn't one of them. A server's HTTP mode does the same (`MCP_ALLOWED_HOSTS`).
- **Write tools and secret reads stay off.** Because the gateway has no authentication of its own, it ignores `ALLOW_WRITE_OPERATIONS` and `ALLOW_SECRET_READ`, wherever they are set. Its tool lists contain only read tools.
- **Tenant isolation.** The gateway is stateless and builds a fresh MCP server + bConnect client per request; the response cache is per-request, so there is no cross-caller leakage.
- **Rate limiting / body cap.** A per-client-IP token-bucket limiter (`MCP_GATEWAY_RATE_LIMIT_*`) plus a request body-size cap (`MCP_GATEWAY_MAX_BODY`) bound abuse. Behind a proxy, every request comes from the proxy's address (the gateway doesn't read `X-Forwarded-For`), so all callers share one limit: do per-caller limiting at the proxy.
- **Structured access log.** Every request is logged with method / path / status / duration and the client address, which behind a proxy is the proxy's (`LOG_LEVEL` / `LOG_FORMAT`).

### Operational Hardening

These items are not exploitable as written, but are recommended practices to keep the supply chain and runtime trustworthy.

**Reproducible installs.** Production builds and CI must use `npm ci` against the committed `package-lock.json`, never `npm install`. `npm install` resolves a fresh dependency graph that may differ from what was reviewed; `npm ci` fails if the lockfile and `node_modules` would diverge from the lockfile, which is the property you want.

**Dependency monitoring.** Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) proposes updates weekly for the root lockfile (core, servers, template, and the gateway, which runs on the root install and has no lockfile of its own) and the GitHub Actions; minor and patch updates are grouped. Dependabot alerts and secret scanning are on. The gateway image's Node.js base image is pinned by digest and updated by hand. The April 2026 MCP host CVEs underline that timely SDK upgrades matter even when the local code is not directly affected.

**Tool-argument validation.** Tool arguments arrive untyped from the MCP host (`request.params.arguments`) and are forwarded to the bConnect REST API over HTTPS. All 13 servers share a single validation architecture:

- Per-tool rules live in `src/utils/mcp-tool-validation-rules.ts` as a domain-named object (e.g. `EndpointsRules`, `JobsRules`, `AssetsRules`) whose methods return `ValidationRule[]` per tool.
- The request handler dispatches arguments through a `validateToolArguments(name, args)` pre-pass that runs **before** the write-operation gate and **before** `getBconnect()`. Argument validation is pure; bConnect setup has side effects; the pure step runs first.
- `validateOrThrow` (from the shared `@bconnect/mcp-core` package, used by all servers) raises an `McpError` with `ErrorCode.InvalidParams` on any rule violation.

- Arguments a tool doesn't declare are refused (`Unknown argument(s) for <tool>`), and the shared client only sends request paths in canonical form.

This boundary blocks malformed or attacker-influenced arguments from reaching the bConnect REST call. Tests in each server and suite-wide guards (`__tests__/tool-arguments.test.ts`, `__tests__/declared-arguments.test.ts`) check it. Removing or weakening the pre-pass on any tool case re-opens the prompt-injection-via-arguments surface — treat changes to `index.ts` dispatch logic as security-relevant.

**Mock-integration HTTP boundary checks.** Per-server `npm run test:mock` runs the production `BConnectClient` axios path against `bConnect-Mock` (51 tests across 13 servers; run by hand, not in CI). It is a security-adjacent property: the test the unit tier cannot see is whether each module call hits the URL and HTTP method documented in the OpenAPI spec. `list_detected_vulnerabilities_for_endpoint` calling the wrong path was an internal correctness bug, but the same class of mistake on a write tool could route a `PATCH` to an unintended resource. The integration tier raises the floor against that class. Recipe: `docs/MOCK_INTEGRATION_TESTING.md`. The tests skip when the mock is unreachable and the run still passes, so a green run without the mock tests nothing.

**MCP-registry publication (forward-looking).** Should bConnect-MCP servers ever be published to a public MCP registry, marketplace poisoning becomes in-scope. The April 2026 OX Security analysis found 9 of 11 surveyed MCP registries to be compromised. Mitigation prerequisites for any future public listing: verifiable release artefacts (today a SHA-256 checksum next to each release zip; from 26.1.9 on also a build provenance attestation for the gateway image, `gh attestation verify oci://ghcr.io/baramundisoftware/bconnect-mcp-gateway:<version> --repo baramundisoftware/bConnect-MCP`), a pinned canonical install path documented in this `SECURITY.md`, and a published verification recipe so consumers can reject impostors. Today bConnect-MCP is not on any registry — leave it that way until the above is in place.

### Accepted vulnerabilities

None at present. The `ip-address` advisory accepted earlier (GHSA-v2v4-37r5-5v8g, via the MCP SDK)
was resolved by the dependency updates listed under [Unreleased] in [CHANGELOG.md](CHANGELOG.md).

## Published Advisories

### MCP stdio command-injection family (CVE-2025-49596 and related, April 2026) — **Not affected**

A class of architectural RCE vulnerabilities was disclosed against the Model Context Protocol stdio transport in April 2026. Reported variants include CVE-2025-49596 (MCP Inspector), CVE-2026-22252 (LibreChat), CVE-2026-30615 (Windsurf), CVE-2026-30616 (Bisheng), CVE-2026-30623 (GPT Researcher), CVE-2026-30624 (LiteLLM), CVE-2025-65720 (LangFlow), and others. The root cause is on the MCP **client/host** side: `StdioServerParameters` / `StdioClientTransport` accepts attacker-controllable `command` and `args` and forwards them to a subprocess spawn without an allowlist, enabling arbitrary code execution.

**bConnect-MCP is the spawned MCP server, not the spawner.** The codebase has been reviewed against this vulnerability class with the following result:

- All 13 servers and the server template use `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`. This transport reads from stdin / writes to stdout — it does not spawn child processes.
- The shipped code (servers, `@bconnect/mcp-core`, gateway) contains no calls to `child_process`, `spawn`, `exec`, `execSync`, `execFile`, `eval`, or `new Function`; only some tests spawn processes.
- Configuration comes only from environment variables (`BCONNECT_*`, `ALLOW_*`, `MCP_*`; each server's README lists the ones it reads). No configuration field is interpreted as a shell command or process path.
- Tool arguments are forwarded as typed parameters to the bConnect REST API over HTTPS via `axios`. They never cross a shell boundary.
- The MCP SDK is kept current (`^1.31.0` at the time of writing).
- The unused `puppeteer` dependency (which would have spawned a Chromium subprocess) has been removed from all manifests.

#### Deployer guidance

The host process that **launches** bConnect-MCP servers is the relevant attack surface for this CVE class. Deployers should:

1. **Use a patched MCP host.** Update Claude Desktop, MCP Inspector, LibreChat, LiteLLM, Windsurf, Cursor, and any other MCP host to a version released after the April 2026 fixes.
2. **Pin server invocation paths.** Configure hosts to launch bConnect-MCP servers by their absolute path (e.g. `node /opt/bconnect-mcp/bconnect-endpoints-mcp/build/index.js`), not via `npx` or other resolver shims that accept argument injection.
3. **Reject untrusted MCP server configurations.** Do not load MCP server entries from prompts, web pages, or downloaded files. Only add servers reviewed by the deploying organisation.
4. **Run hosts with least privilege.** Run the MCP host process as a non-administrative user; consider container or sandbox isolation for hosts that load third-party MCP servers.
5. **Verify host auth boundaries.** Hosts that expose an HTTP/SSE proxy to a browser (e.g. MCP Inspector pre-fix) must require authentication and origin checks. The bConnect-MCP **servers** expose only stdio; the optional **`bconnect-mcp-gateway`** exposes HTTP and must be fronted by an authenticating reverse proxy (see the "HTTP Gateway" section above).

This advisory will be updated if a server-side regression of this vulnerability class is identified.

#### References

- [CVE-2025-49596 (NVD)](https://nvd.nist.gov/vuln/detail/CVE-2025-49596)
- [OX Security — MCP supply chain advisory](https://www.ox.security/blog/mcp-supply-chain-advisory-rce-vulnerabilities-across-the-ai-ecosystem/)
- [LiteLLM — Security update for CVE-2026-30624](https://docs.litellm.ai/blog/mcp-stdio-command-injection-april-2026)
