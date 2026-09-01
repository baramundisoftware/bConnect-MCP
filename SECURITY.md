# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 26.1.x (bMS 26R1 or later) | ✅ Active support |
| < 26.1.0 | ❌ No support |

The suite requires baramundi Management Suite **26R1 or later** and refuses to start against
anything older. 25R2 is no longer supported at any version.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use **GitHub private vulnerability reporting** — the *Report a vulnerability* button under this
repository's **Security** tab. It is private, it threads, and it does not depend on any one person
reading their mail. It is the preferred channel: a disclosure policy has to outlive whoever happens
to be maintaining the project, which an individual mailbox does not.

If you cannot use GitHub — no account, a corporate policy against it, or a report you would rather
not file against a public repository at all — write to **support@baramundi.com** instead and say in
the subject line that it is a security report about bConnect-MCP. Both routes reach the same people.
A reporter who has no workable channel discloses publicly or not at all, and neither is what we want.

> **Maintainers:** private vulnerability reporting must be switched on for this repository
> (*Settings → Code security → Private vulnerability reporting*) — the button is not present by
> default, and with the channel off this section describes something a reporter cannot do.

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

## Threat model — read this before you deploy

This section is deliberately near the top, because everything below it is detail and this is the part
that changes what you should actually do. It assumes you are deploying against an estate we cannot see.

**What this software is.** Fourteen MCP servers plus an optional HTTP gateway that read (and, if you
open the gate, write) a baramundi Management Suite through bConnect. A model chooses which tool to call
and with what arguments; the servers turn that into bConnect API calls using **one** bMS service
credential.

**The four things worth defending against, in the order they will bite you:**

1. **The shared credential's blast radius is the union of every server you deploy.** One
   `BCONNECT_API_KEY` serves all fourteen servers. bMS RBAC — not this software — is what bounds what
   that key can reach. So:
   - **Deploy only the `bconnect-*-mcp` servers you actually use.** Each additional server widens what
     the shared credential must be permitted to read.
   - **Scope the bMS service account to the union of the modules of the servers you deploy, and
     nothing more.** Do not grant BitLocker/LAPS/defensecontrol permissions unless you deploy
     `bconnect-defensecontrol-mcp`; do not grant ApiKeys/servermanagement permissions unless you deploy
     `bconnect-servermanagement-mcp`.
   - This is the primary control that bounds any request-routing defect: **a credential that cannot
     read BitLocker cannot leak BitLocker, however a request reaches that route.** It is free, it is
     configured entirely on the bMS side, and it is the single cheapest risk reduction available here.

2. **Estate data is untrusted input to the model.** Endpoint names, job names and job failure text are
   operator-controllable. Anyone who can rename an endpoint can put text into your model's context.
   See *Estate data is untrusted input* below. The control is not a filter — it is not running writes
   unattended.

3. **The write gate, the destructive gate and the secret gate are off by default, and should stay
   off unless a human is in the loop.** `ALLOW_WRITE_OPERATIONS`, `ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT`
   and `ALLOW_SECRET_READ` each open a category of action; they are enforced at dispatch and at the
   transport, not merely hidden from `tools/list`. Opening them is a deployment decision, not a
   default.

4. **The gateway authenticates callers, but it is not your edge.** With `MCP_GATEWAY_AUTH_TOKEN` set
   it checks a shared bearer token in constant time; that token says *"this caller may talk to the
   gateway"*, never *"this caller is Alice"*. TLS termination, per-user identity, and real flood
   control belong at a reverse proxy in front of it. The gateway binds to loopback by default and
   refuses to start on `0.0.0.0` without a token — that refusal is a feature, not an obstacle to
   work around.

**What is explicitly out of scope.** We do not defend against a hostile bMS server, a compromised
host running the MCP server process, or a model host that is itself malicious. A deployer who cannot
trust their bMS or their agent host has a problem this software cannot solve.

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

The optional `bconnect-mcp-gateway` exposes all 14 servers over **HTTP** for multi-user / n8n use (the individual servers remain stdio-only). Its security model, hardened per the 2026-06-22 internal audit:

- **No built-in authentication — by design.** The gateway is an unopinionated HTTP component; **authentication and TLS are the operator's responsibility.** Front it with a TLS-terminating, authenticating reverse proxy / IdP (nginx, Caddy, Traefik, Entra Application Proxy, …) that terminates TLS, authenticates every caller, reaches the gateway only over a private/loopback network, and strips client-supplied identity headers. (The former per-user token map was removed — see ADR-0003.)
- **Fail-closed default.** The gateway binds `127.0.0.1` and **refuses to start on a non-loopback bind** unless `MCP_ALLOW_NO_AUTH=true` is set — an explicit operator assertion that a proxy is in front. This prevents an accidentally-exposed, unauthenticated bMS proxy.
- **Single service credential.** Downstream bMS calls use one `BCONNECT_*` service credential; **bMS RBAC governs what it can do**, so scope that account to least privilege. Credentials can be supplied from mounted secrets via the `*_FILE` convention instead of plain env vars.
- **Tenant isolation.** The gateway is stateless and builds a fresh MCP server + bConnect client per request; the response cache is per-request, so there is no cross-caller leakage.
- **Rate limiting / body cap.** A per-client-IP token-bucket limiter (`MCP_GATEWAY_RATE_LIMIT_*`) plus a request body-size cap (`MCP_GATEWAY_MAX_BODY`) bound abuse; richer edge/flood limiting belongs at the proxy.
- **Structured access log.** Every request is logged with method / path / status / duration and a client-IP caller id (`LOG_LEVEL` / `LOG_FORMAT`).

### Operational Hardening

These items are not exploitable as written, but are recommended practices to keep the supply chain and runtime trustworthy.

**Scope the bConnect API key to only the servers you deploy — and deploy only the servers you need.**
This is the cheapest control available and nothing previously asked for it.

The suite uses **one credential for all 14 servers**. bConnect API keys are RBAC-scoped in the bMS, so
data the key cannot see is unreachable no matter what a tool does — but that means the key has to be
scoped to the *union* of what every server you deploy needs. Deploy `bconnect-defensecontrol-mcp` and
the key needs BitLocker rights; deploy `bconnect-servermanagement-mcp` and it needs the API-key
inventory. Any weakness in any server then reaches all of it.

So the blast radius shrinks by **deploying fewer servers**, not by scoping the key while keeping them
all. Concretely:

1. In the installer's server-selection step, choose only the servers whose tools you will actually use.
   The default selection is not a recommendation to keep everything.
2. In the bMC console, scope the API key's rights to the union those servers need — and no more.
3. Re-run the installer's server selection when your usage changes, and narrow the key again. Adding a
   server later means widening the key; that should be a decision, not a default.

A minimal, tightly-scoped install has materially less reach than a full one. Severity of any
traversal-class finding in this suite is partly a property of your deployment, not only of the code.

**Reproducible installs.** Production builds and CI must use `npm ci` against the committed `package-lock.json`, never `npm install`. `npm install` resolves a fresh dependency graph that may differ from what was reviewed; `npm ci` fails if the lockfile and `node_modules` would diverge from the lockfile, which is the property you want.

**Dependency monitoring.** All 18 manifests (root + the 14 servers + the gateway + the shared core + the template) are subscribed to automated dependency updates via [`renovate.json`](renovate.json) at the repo root so CVE-bearing transitive dependencies surface as PRs rather than ageing silently. The config groups MCP SDK / axios / OpenAPI-tooling updates across manifests so a single ecosystem bump becomes one PR rather than fifteen, runs lockfile maintenance monthly, and keeps `vulnerabilityAlerts` always-on with no schedule. Activation requires either pushing to a GitHub repo with the Renovate App installed, or pointing self-hosted Renovate at the repo. The April 2026 MCP host CVEs underline that timely SDK upgrades matter even when the local code is not directly affected.

**Tool-argument validation.** Tool arguments arrive untyped from the MCP host (`request.params.arguments`) and are forwarded to the bConnect REST API over HTTPS. All 14 servers share a single validation architecture:

- Per-tool rules live in `src/utils/mcp-tool-validation-rules.ts` as a domain-named object (e.g. `EndpointsRules`, `JobsRules`, `AssetsRules`) whose methods return `ValidationRule[]` per tool.
- The request handler dispatches arguments through a `validateToolArguments(name, args)` pre-pass that runs **before** the write-operation gate and **before** `getBconnect()`. Argument validation is pure; bConnect setup has side effects; the pure step runs first.
- `validateOrThrow` (from the shared `@bconnect/mcp-core` package, used by all servers) raises an `McpError` with `ErrorCode.InvalidParams` on any rule violation.

This boundary blocks malformed or attacker-influenced arguments from reaching the bConnect REST call. An audit (2026-05-05) confirmed 0 bypassing tool cases across all 14 servers, and 50 explicit validator regression tests prove every server rejects its known-bad-argument shapes. Removing or weakening the pre-pass on any tool case re-opens the prompt-injection-via-arguments surface — treat changes to `index.ts` dispatch logic as security-relevant.

**Mock-integration HTTP boundary checks.** Per-server `npm run test:mock` runs the production `BConnectClient` axios path against the in-repo mock `scripts/bconnect-mock.mjs` (62 tests across 14 servers, run with `node scripts/run-mock-tier.mjs`). It is a security-adjacent property: the test the unit tier cannot see is whether each module call hits the URL and HTTP method documented in the OpenAPI spec. P29.2 — `list_detected_vulnerabilities_for_endpoint` calling the wrong path — was an internal correctness bug, but the same class of mistake on a write tool could route a `PATCH` to an unintended resource. The integration tier raises the floor against that class. Recipe: `docs/MOCK_INTEGRATION_TESTING.md`. The tests skip cleanly when no mock is reachable, so the tier is safe to invoke anywhere; set `BCONNECT_MOCK_REQUIRED=true` (the runner does) to make an absent mock a hard failure instead, because a skipped tier and a passing one must not look alike to CI.

**MCP-registry publication (forward-looking).** Should bConnect-MCP servers ever be published to a public MCP registry, marketplace poisoning becomes in-scope. The April 2026 OX Security analysis found 9 of 11 surveyed MCP registries to be compromised. Mitigation prerequisites for any future public listing: signed release artefacts (the existing `releases/` GPG-signature workflow), a pinned canonical install path documented in this `SECURITY.md`, and a published verification recipe so consumers can reject impostors. Today bConnect-MCP is not on any registry — leave it that way until the above is in place.

**npm name-squatting (open the moment this repo goes public).** The package names in this repo —
`bconnect-jobs-mcp`, `bconnect-endpoints-mcp`, and the rest — are **unregistered on npm**. Nothing here
is published to npm and no script in the repo runs `npm publish`; the servers are consumed by the
gateway through `file:` dependencies. But the moment the source is public, anyone can register those
names and serve their own code to someone who reasonably types `npm i bconnect-jobs-mcp`. Of the 16
manifests, only the repo root, `packages/mcp-core` and `bconnect-mcp-gateway` set `"private": true`.

Two actions, and only the first can be done in the repository:

- Set `"private": true` on the remaining 13 server manifests and `bconnect-server-template`. They are
  consumed via `file:` deps, so this costs nothing — but verify the container build first, since the
  Dockerfile installs them as `file:` dependencies and packs them with a generated `.npmignore`.
- **Register the names on npm with 2FA enabled, before the repository is made public.** This requires
  an npm account and an organisation decision about who owns it; it cannot be done from the source
  tree, and it cannot be undone once someone else takes the name.

### Estate data is untrusted input, and it is returned to the model unmodified

Everything above about prompt injection describes the **inbound** direction: the model chooses tool
arguments, and those arguments are validated before anything happens. That boundary is real and well
tested. It is also only half of the problem, and this section exists because a reader who stopped at
the previous paragraph would reasonably conclude injection had been assessed and handled.

**The outbound direction — bMS data → model context — is not, and cannot fully be, defended.** Endpoint
names, logical group names, job and job-definition names, software titles, registered-user names and
job failure text are all *operator*-controllable inside a customer estate. Anyone who can rename an
endpoint, or cause a job to exit with a crafted message, can put text of their choosing into the
model's context. There is no reliable way to strip "instructions" from free text, and this project
does not claim to.

What is done, and its limits:

- Estate strings that reach model-facing **advisory prose** are passed through `sanitizeEstateText`
  (`packages/mcp-core/src/untrusted-text.ts`). That bounds their length and strips characters that are
  never legitimate in a bMS object name and exist mainly to make text render as something other than
  what it is: zero-width characters, bidirectional overrides, Unicode TAG characters, stray control
  characters. **It does not detect or neutralise instructions.**
- Where a value can be carried in its own structured field instead of interpolated into a sentence, it
  is. A name in `endpointName` is data; the same name inside *"the worst offender is X"* is a sentence
  a model may act on.
- **Every** tool result — all 276 result sites — is serialised through
  `serializeToolResult` (`packages/mcp-core/src/serialize.ts`), which strips invisible and
  text-reordering characters from every string on the way out — **both values and object keys**. This
  is the one control here that a new tool cannot forget to apply, because it sits on the single
  chokepoint rather than at each projection. `JSON.stringify` on its own neutralises the *transport*
  (quoting, escaping) but gives **no semantic isolation**, and zero-width/bidi/TAG codepoints
  previously passed through byte-for-byte inside the quotes.
- **Keys were a real gap until 2026-08-14, and the reassurance about them was wrong.** The chokepoint
  used to sanitise values only, and recorded that no tool keyed a map by an estate string. Four did.
  `get_fleet_summary` keys `byLogicalGroup` by the **logical-group name** — the most
  operator-controllable string in the product — and `list_assets` folds `additionalProperties[]` by
  the operator-defined property name. Driven through the real handler, every hostile codepoint
  survived in key position **and the `_provenance` marker did not fire**, because the marker counted
  only value strips: the one result that most warranted the warning was the only one that went out
  unannounced. Both halves are fixed and both are regression-tested, at the chokepoint and end to end
  through `get_fleet_summary`.
- **Lookalike names are flagged, never merged.** Two keys that differ only by invisible characters
  become identical once those are removed — the signature of a deliberately confusable pair. Merging
  them into one key would silently drop a count, so nothing is merged: later entries keep a `~N`
  suffix, `_keyCollisions` names the affected key, and `_provenance` says what happened.
- When that stripping actually removes something, the result carries a **`_provenance`** field saying
  the strings are estate data and not instructions. It is emitted on detection rather than on every
  call, so it stays high-signal and costs nothing on a clean payload — a clean result is byte-identical
  to a plain compact `JSON.stringify`.
- **None of this detects instructions.** A plainly-worded instruction typed into an endpoint name
  reaches the model intact. The stripping removes a character class that is never legitimate in a bMS
  object name; it is not, and cannot be, a semantic filter.

**Deployer guidance, and this is the actual control:**

1. **Do not run with `ALLOW_WRITE_OPERATIONS=true` on an unattended agent loop.** The read surface is
   the safe one. If a human is not reading the model's proposed writes before they execute, estate text
   is an instruction channel into your change process.
2. If you do enable writes, narrow them with `ALLOWED_WRITE_TOOLS` (`bconnect-jobs-mcp`) rather than
   opening all of a server's write tools at once.
3. Leave `ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT` unset. With it unset, the four `assign_job_to_*` tools
   refuse a job the bMS flags `Destructive` — a wipe or OS-deployment step — regardless of what the
   model was persuaded to attempt. Note this check needs bConnect v1.1 credentials to work: without
   them the flag cannot be read and the assignment proceeds.
4. Keep `BCONNECT_AUDIT_LEVEL` at `write` or higher, so a write that should not have happened is
   attributable afterwards. The shipped `.env.example` files default to `write`.

### Accepted vulnerabilities (unreachable in our usage)

**Current state: `npm audit` reports 0 vulnerabilities**, from 11 (1 critical, 6 high) at the start of
this triage. Nothing is currently being carried as an accepted advisory. This section records how each
one was resolved and — more usefully — the two *structural* risks that remain, because an
accepted-risk entry with bad reasoning is worse than an open finding: it stops the next person looking.

[GHSA-v422-hmwv-36x6](https://github.com/advisories/GHSA-v422-hmwv-36x6) (`body-parser`) was
**reachable against the lockfile as committed, and is not reachable in what now ships.** The
distinction is worth stating precisely, because an independent audit corrected our first write-up of
it and a wrong reason in this file would stop anyone looking again.

The gateway passed `MCP_GATEWAY_MAX_BODY` to `express.json({ limit })` unvalidated. In **body-parser
2.2.2** — the version the committed lockfile pinned — the limit is resolved as
`bytes.parse(opts.limit || '100kb')` with no null check, so a value that does not begin with a digit
(`"1mb"` *with the quotes kept*, `unlimited`, `off`) resolves to null and raw-body stops enforcing:
the cap silently disappears. That was real.

The same change set upgraded the dependency. In **both versions now resolvable** — 2.3.0 at the root
(the Dockerfile path) and 1.20.6 in the gateway's own lockfile — those values **throw**
`TypeError: option limit "…" is invalid` at construction. The process refuses to start rather than
serving uncapped. Verified directly against the installed 2.3.0.

So the dependency upgrade is what closed this advisory, and
`bconnect-mcp-gateway/src/body-limit.ts` is **robustness, not the control**: it resolves the limit to
an explicit byte count, which turns a startup `TypeError` into a message naming the offending value,
and pins the behaviour so a future dependency resolution cannot reintroduce the fail-open. Keep it
for those reasons. Do not cite it as the mitigation for this advisory.

| Advisory | Package | Reached us via | Verdict | Action |
|---|---|---|---|---|
| GHSA-v422-hmwv-36x6 | `body-parser` | gateway → `express` | **Was reachable at 2.2.2; not reachable at 2.3.0 / 1.20.6, which throw instead of uncapping** | Closed by the upgrade. `body-limit.ts` is robustness, not the mitigation |
| GHSA-w8wr-v893-vjvp + 4 more | `tar` (critical) | `@cyclonedx/cyclonedx-npm` (dev) → `libxmljs2` → `node-gyp` | Build-time only; runs on `npm run sbom`, never on a served request | Upgraded to `^7.5.22` |
| GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 | `brace-expansion` | `eslint`, `@typescript-eslint`, `test-exclude`, `@redocly` (all dev) | Glob expansion of **our own** lint/coverage patterns; no estate or caller input reaches it | Upgraded to `^2.1.4` / `^5.0.9` |
| GHSA-52cp-r559-cp3m | `js-yaml` | `openapi-typescript` → `@redocly/openapi-core` (dev) | Parses the OpenAPI specs **we** vendor, at type-generation time | Upgraded to `^4.3.1` — note the previous `js-yaml` override pinned `^4.2.0`, holding it *on* the vulnerable version |
| GHSA-r28c-9q8g-f849, GHSA-fxqj-rqcc-2cmp | `postcss` | `vitest` → `vite` (dev) | No CSS is processed by anything shipped | Upgraded to `^8.5.25` |
| GHSA-mwp4-54f8-5fhr + 2 more | `ip-address` | SDK → `express-rate-limit`; also `node-gyp` (dev) | Not loaded — see the module-trace note below | Upgraded to `^10.4.0` |
| GHSA-frvp-7c67-39w9 | `@hono/node-server` | SDK (production) | Package **is** loaded in the gateway; the vulnerable `serveStatic` export is never imported | Upgraded to `^2.0.5` (needs SDK ≥ 1.30.0, which widened its range) |
| GHSA-8j4g-w8fx-2239 | `hono` | SDK (production) | `@hono/node-server` imports only Node built-ins; `hono` itself is never loaded, and no hono CORS middleware exists here | Upgraded to `^4.12.34` |
| GHSA-v2hh-gcrm-f6hx, GHSA-4c8g-83qw-93j6, GHSA-7p8r-x3mc-p8w7 | `fast-uri` | **SDK → `ajv`** (production), and `cyclonedx` (dev) | Loaded in production — see the correction below | Upgraded to `^3.1.5` |

**A correction worth keeping.** An earlier assessment recorded `fast-uri` as dev-only, reaching us
through the SBOM tool. That was wrong. `npm ls fast-uri` shows only the `cyclonedx` path because `ajv`
is deduplicated, but the MCP SDK also depends on `ajv`, and a module-load trace of exactly the SDK
entry points this suite imports (`server/index.js`, `server/stdio.js`, `server/streamableHttp.js`)
shows `ajv` → `ajv-formats` → **`fast-uri` loaded into the server process**. The advisories are
host-confusion bugs that matter when a parsed URI gates a network decision; here `fast-uri` only ever
sees `$id`/`$ref` strings from schemas *we* author, no tool schema in the repo declares
`"format": "uri"` or `"uri-reference"`, and ajv is not configured to fetch remote schemas. So it is
genuinely unreachable — but for a completely different reason than the one previously written down,
and the previous reason would have survived a change that made it exploitable.

The same trace is why `ip-address` is not reachable: the SDK's OAuth handlers
(`server/auth/handlers/*`) are what import `express-rate-limit`, and this suite imports none of them.
`@hono/node-server` *is* loaded — `server/streamableHttp.js` imports `getRequestListener` from it at
the top level — which contradicts the earlier "not mounted" note; what saves us is that the vulnerable
code is in the separate `serve-static` export, which nothing here imports.

**Both structural risks previously described here are now closed.** `bconnect-mcp-gateway` was added
to the root `workspaces` array (`packages/*`, `bconnect-*-mcp`, `bconnect-mcp-gateway`,
`bconnect-server-template`), so `npm audit` and `npm run audit` at the repo root cover it like every
other component — including the one that listens on a network port. Its declared dependency is also
the one it runs: `package.json` asks for `express: ^4.21.0`, and the root `package-lock.json` resolves
`bconnect-mcp-gateway/node_modules/express` to `4.22.2` — not the root's own hoisted `express` 5.x,
which the gateway does not import. There is no separate `bconnect-mcp-gateway/package-lock.json`
describing a different tree; the gateway has no lockfile of its own, only the root's.

**Re-run the triage with:** `npm audit` at the root, plus `npm ls express --all` to confirm the
resolved version if this ever changes — a workspace move or a manual `npm install` inside
`bconnect-mcp-gateway/` would reopen exactly this class of risk.

## Published Advisories

### MCP stdio command-injection family (CVE-2025-49596 and related, April 2026) — **Not affected**

A class of architectural RCE vulnerabilities was disclosed against the Model Context Protocol stdio transport in April 2026. Reported variants include CVE-2025-49596 (MCP Inspector), CVE-2026-22252 (LibreChat), CVE-2026-30615 (Windsurf), CVE-2026-30616 (Bisheng), CVE-2026-30623 (GPT Researcher), CVE-2026-30624 (LiteLLM), CVE-2025-65720 (LangFlow), and others. The root cause is on the MCP **client/host** side: `StdioServerParameters` / `StdioClientTransport` accepts attacker-controllable `command` and `args` and forwards them to a subprocess spawn without an allowlist, enabling arbitrary code execution.

**bConnect-MCP is the spawned MCP server, not the spawner.** The codebase has been reviewed against this vulnerability class with the following result:

- All 14 servers and the server template use `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`. This transport reads from stdin / writes to stdout — it does not spawn child processes.
- The codebase contains no calls to `child_process`, `spawn`, `exec`, `execSync`, `execFile`, `eval`, or `new Function` (verified by full-tree grep).
- Configuration is sourced exclusively from environment variables (`BCONNECT_BASE_URL`, `BCONNECT_USERNAME`, `BCONNECT_PASSWORD`, `BCONNECT_CA_CERT_PATH`, `BCONNECT_AUDIT_LEVEL`, `BCONNECT_RATE_LIMIT_*`). No configuration field is interpreted as a shell command or process path.
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
