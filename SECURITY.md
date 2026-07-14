# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 26.1.x (bMS 26R1) | ✅ Active support |
| 25.2.x (bMS 25R2) | ⚠️ Security fixes only |
| < 25.2.0 | ❌ No support |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report vulnerabilities by email to:

**bernd.wiedemann@baramundi.de**

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

**4. Prefer a secret mechanism where available.** For the **gateway**, supply
credentials from mounted secrets via the `*_FILE` convention (e.g. Docker/Kubernetes
secrets) instead of plain env vars — see [HTTP Gateway](#http-gateway-bconnect-mcp-gateway).

> **Before customer / GA hand-off:** file permissions are a mitigation, not encryption.
> A non-plaintext, decrypted-at-runtime option (OS credential store — Windows DPAPI /
> Credential Manager, macOS Keychain — or an external secret store) is planned in #60
> and should land before leaving credential configuration to customers.

### TLS Configuration

Production deployments must use proper TLS certificate verification. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` in production — it disables all certificate validation. See [docs/INSTALLATION.md](docs/INSTALLATION.md) for the correct TLS setup using `BCONNECT_CA_CERT_PATH`.

### Audit Logging

Each server supports configurable audit logging via `BCONNECT_AUDIT_LEVEL` (`none` / `security` / `write` / `all`). Enable it in production to track API calls.

### Write-Operation Gating

Write/mutating tools are **disabled by default**. A server exposes them only when `ALLOW_WRITE_OPERATIONS=true` is set; otherwise every write tool returns a clear "disabled" error. Leave it unset for monitoring / reporting deployments where mutation must be prevented. Secret-returning tools (BitLocker recovery keys, LAPS local-admin passwords) are additionally gated behind `ALLOW_SECRET_READ`.

### Rate Limiting

Each server can enforce a token-bucket rate limiter to protect the bConnect API. Enable and tune it via `BCONNECT_RATE_LIMIT_ENABLED`, `BCONNECT_RATE_LIMIT_MAX_REQUESTS`, and `BCONNECT_RATE_LIMIT_WINDOW_MS`.

### HTTP Gateway (`bconnect-mcp-gateway`)

The optional `bconnect-mcp-gateway` exposes all 13 servers over **HTTP** for multi-user / n8n use (the individual servers remain stdio-only). Its security model, hardened per the 2026-06-22 internal audit:

- **No built-in authentication — by design.** The gateway is an unopinionated HTTP component; **authentication and TLS are the operator's responsibility.** Front it with a TLS-terminating, authenticating reverse proxy / IdP (nginx, Caddy, Traefik, Entra Application Proxy, …) that terminates TLS, authenticates every caller, reaches the gateway only over a private/loopback network, and strips client-supplied identity headers. (The former per-user token map was removed — see ADR-0003.)
- **Fail-closed default.** The gateway binds `127.0.0.1` and **refuses to start on a non-loopback bind** unless `MCP_ALLOW_NO_AUTH=true` is set — an explicit operator assertion that a proxy is in front. This prevents an accidentally-exposed, unauthenticated bMS proxy.
- **Single service credential.** Downstream bMS calls use one `BCONNECT_*` service credential; **bMS RBAC governs what it can do**, so scope that account to least privilege. Credentials can be supplied from mounted secrets via the `*_FILE` convention instead of plain env vars.
- **Tenant isolation.** The gateway is stateless and builds a fresh MCP server + bConnect client per request; the response cache is per-request, so there is no cross-caller leakage.
- **Rate limiting / body cap.** A per-client-IP token-bucket limiter (`MCP_GATEWAY_RATE_LIMIT_*`) plus a request body-size cap (`MCP_GATEWAY_MAX_BODY`) bound abuse; richer edge/flood limiting belongs at the proxy.
- **Structured access log.** Every request is logged with method / path / status / duration and a client-IP caller id (`LOG_LEVEL` / `LOG_FORMAT`).

### Operational Hardening

These items are not exploitable as written, but are recommended practices to keep the supply chain and runtime trustworthy.

**Reproducible installs.** Production builds and CI must use `npm ci` against the committed `package-lock.json`, never `npm install`. `npm install` resolves a fresh dependency graph that may differ from what was reviewed; `npm ci` fails if the lockfile and `node_modules` would diverge from the lockfile, which is the property you want.

**Dependency monitoring.** All 15 manifests (root + 13 servers + template) are subscribed to automated dependency updates via [`renovate.json`](renovate.json) at the repo root so CVE-bearing transitive dependencies surface as PRs rather than ageing silently. The config groups MCP SDK / axios / OpenAPI-tooling updates across manifests so a single ecosystem bump becomes one PR rather than fifteen, runs lockfile maintenance monthly, and keeps `vulnerabilityAlerts` always-on with no schedule. Activation requires either pushing to a GitHub repo with the Renovate App installed, or pointing self-hosted Renovate at the repo. The April 2026 MCP host CVEs underline that timely SDK upgrades matter even when the local code is not directly affected.

**Tool-argument validation.** Tool arguments arrive untyped from the MCP host (`request.params.arguments`) and are forwarded to the bConnect REST API over HTTPS. All 13 servers share a single validation architecture:

- Per-tool rules live in `src/utils/mcp-tool-validation-rules.ts` as a domain-named object (e.g. `EndpointsRules`, `JobsRules`, `AssetsRules`) whose methods return `ValidationRule[]` per tool.
- The request handler dispatches arguments through a `validateToolArguments(name, args)` pre-pass that runs **before** the write-operation gate and **before** `getBconnect()`. Argument validation is pure; bConnect setup has side effects; the pure step runs first.
- `validateOrThrow` (from the shared `@bconnect/mcp-core` package, used by all servers) raises an `McpError` with `ErrorCode.InvalidParams` on any rule violation.

This boundary blocks malformed or attacker-influenced arguments from reaching the bConnect REST call. An audit (2026-05-05) confirmed 0 bypassing tool cases across all 13 servers, and 50 explicit validator regression tests prove every server rejects its known-bad-argument shapes. Removing or weakening the pre-pass on any tool case re-opens the prompt-injection-via-arguments surface — treat changes to `index.ts` dispatch logic as security-relevant.

**Mock-integration HTTP boundary checks.** Per-server `npm run test:mock` runs the production `BConnectClient` axios path against `bConnect-Mock` (51 tests across 13 servers). It is a security-adjacent property: the test the unit tier cannot see is whether each module call hits the URL and HTTP method documented in the OpenAPI spec. P29.2 — `list_detected_vulnerabilities_for_endpoint` calling the wrong path — was an internal correctness bug, but the same class of mistake on a write tool could route a `PATCH` to an unintended resource. The integration tier raises the floor against that class. Recipe: `docs/MOCK_INTEGRATION_TESTING.md`. The tests skip cleanly when the mock is unreachable, so the tier is safe to leave wired into CI.

**MCP-registry publication (forward-looking).** Should bConnect-MCP servers ever be published to a public MCP registry, marketplace poisoning becomes in-scope. The April 2026 OX Security analysis found 9 of 11 surveyed MCP registries to be compromised. Mitigation prerequisites for any future public listing: signed release artefacts (the existing `releases/` GPG-signature workflow), a pinned canonical install path documented in this `SECURITY.md`, and a published verification recipe so consumers can reject impostors. Today bConnect-MCP is not on any registry — leave it that way until the above is in place.

### Accepted vulnerabilities (unreachable in our usage)

A baseline `npm audit` after the SDK and axios bumps surfaced one transitive moderate-severity advisory we have decided to **accept** rather than remediate:

- **[GHSA-v2v4-37r5-5v8g](https://github.com/advisories/GHSA-v2v4-37r5-5v8g)** — `ip-address`, XSS in `Address6` HTML-emitting methods. Reaches us via `@modelcontextprotocol/sdk@1.29.0` → `express-rate-limit` → `ip-address`.

**Why it is unreachable here:**
- The vulnerable methods in `ip-address` are **HTML-emitting renderers** (`Address6` HTML output). **No component renders HTML** — the stdio servers speak JSON-RPC over stdio and the HTTP gateway serves MCP JSON-RPC only, so the `Address6` HTML path is never invoked on any transport.
- The stdio servers never instantiate the SDK's HTTP transport at all. The HTTP gateway *does* use an HTTP transport and carries `express-rate-limit` transitively, but it applies its own token-bucket limiter and still never reaches the HTML-emitting `ip-address` methods.

**Why we are not "fixing" it:** `npm audit fix --force` resolves this advisory by **downgrading** the SDK from `1.29.0` to `1.25.3`, which is a breaking change going backwards over the very upgrade we just landed in `a991dce`. Carrying a dormant transitive at the latest SDK is preferable to rolling back into an older SDK that may itself contain unrelated issues.

**Re-evaluate when:** the SDK ships a release whose `express-rate-limit` pin moves past the vulnerable `ip-address` range, or `express-rate-limit` releases a fix without an SDK bump being required. At that point `npm audit fix` (no `--force`) will resolve cleanly.

## Published Advisories

### MCP stdio command-injection family (CVE-2025-49596 and related, April 2026) — **Not affected**

A class of architectural RCE vulnerabilities was disclosed against the Model Context Protocol stdio transport in April 2026. Reported variants include CVE-2025-49596 (MCP Inspector), CVE-2026-22252 (LibreChat), CVE-2026-30615 (Windsurf), CVE-2026-30616 (Bisheng), CVE-2026-30623 (GPT Researcher), CVE-2026-30624 (LiteLLM), CVE-2025-65720 (LangFlow), and others. The root cause is on the MCP **client/host** side: `StdioServerParameters` / `StdioClientTransport` accepts attacker-controllable `command` and `args` and forwards them to a subprocess spawn without an allowlist, enabling arbitrary code execution.

**bConnect-MCP is the spawned MCP server, not the spawner.** The codebase has been reviewed against this vulnerability class with the following result:

- All 13 servers and the server template use `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`. This transport reads from stdin / writes to stdout — it does not spawn child processes.
- The codebase contains no calls to `child_process`, `spawn`, `exec`, `execSync`, `execFile`, `eval`, or `new Function` (verified by full-tree grep).
- Configuration is sourced exclusively from environment variables (`BCONNECT_BASE_URL`, `BCONNECT_USERNAME`, `BCONNECT_PASSWORD`, `BCONNECT_CA_CERT_PATH`, `BCONNECT_RELEASE`, `BCONNECT_AUDIT_LEVEL`, `BCONNECT_RATE_LIMIT_*`). No configuration field is interpreted as a shell command or process path.
- Tool arguments are forwarded as typed parameters to the bConnect REST API over HTTPS via `axios`. They never cross a shell boundary.
- The MCP SDK is pinned to `^1.29.0`, the current upstream release.
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
