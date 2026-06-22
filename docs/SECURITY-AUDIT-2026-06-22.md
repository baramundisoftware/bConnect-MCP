# bConnect MCP Suite — Security Audit

**Date:** 2026-06-22
**Auditor:** Security & DevOps review (internal)
**Scope:** 13 `bconnect-*-mcp` servers, `bconnect-mcp-gateway`, deployment in both **stdio** and **HTTP (gateway)** modes, dependency posture, and GitHub repository security configuration.
**Repo:** `baramundisoftware/bConnect-MCP` (private)

> **Status:** C1 and C2 (both critical) are **FIXED** in this branch — see §2.
> C3 and the dependency/posture items remain open; treat as confidential until P1–P3 are addressed.

---

## 1. Executive summary

The suite's tenant isolation, input validation, and container baseline are sound. The material risk is concentrated in the **HTTP gateway authentication path** and in **secret-returning tools**, none of which are caught by the repository's current automated tooling (CodeQL is disabled).

| Area | Verdict |
|------|---------|
| stdio mode (single user) | Acceptable today; keep `ALLOW_WRITE_OPERATIONS` off unless needed (C3, H3). |
| HTTP gateway (multi-user / n8n) | **Not production-ready** until C1 + C2 are fixed (remotely exploitable, unauthenticated path to bMS). |
| Dependencies | 91 Dependabot alerts → **7 unique packages, 3 runtime**, all fixable, low practical risk. |
| GitHub posture | Dependabot on; **code scanning and secret scanning OFF**. |

**Fix C1 first.** It is a verified, ~3-line authentication bypass.

---

## 2. Code & configuration findings

Severity: CRITICAL / HIGH / MEDIUM / LOW. Mode: `[HTTP]` gateway, `[STDIO]` stdio, `[BOTH]`.

### C1 — Authentication bypass via prototype pollution `[HTTP]` — CRITICAL (VERIFIED — FIXED 2026-06-22)

> **Resolved** in `bconnect-mcp-gateway/src/auth.ts` via an own-property guard
> (`Object.prototype.hasOwnProperty.call(tokenMap, token)`) before the credential
> lookup, with a parameterised regression test covering `__proto__`, `constructor`,
> `toString`, `hasOwnProperty`, `valueOf`, `isPrototypeOf`. Re-verified live: all
> payloads now return 401, valid tokens still 200.


`bconnect-mcp-gateway/src/auth.ts:91` resolves a Bearer token with a plain-object index:

```js
const token = authHeader.slice(7);
const credentials = tokenMap[token];      // <-- inherited Object.prototype keys are truthy
if (!credentials) { /* 401 */ }
```

Because `tokenMap` is a `JSON.parse` object, inherited prototype keys (`__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf`, …) return truthy values, pass the `!credentials` gate, and resolve `credentials` to a non-undefined value with no `apiKey`/`username`/`password`. The request then falls back to the gateway's environment credentials (`BCONNECT_USERNAME`/`PASSWORD`/`API_KEY`). An unauthenticated caller gains full bMS tool access as the fallback identity.

**Verified live** against a token-auth-enabled gateway:

```
Bearer <valid token>   -> 200   (legitimate)
Bearer wrongtoken      -> 401   (correctly rejected)
Bearer __proto__       -> 200   BYPASS
Bearer constructor     -> 200   BYPASS
Bearer toString        -> 200   BYPASS
Bearer hasOwnProperty  -> 200   BYPASS
```

**Fix:** reject non-own keys and compare in constant time. Preferred: load the token map into a `Map` in `loadTokenMap()` so `.get()` is immune by construction.

```js
// loadTokenMap: return new Map(Object.entries(parsed))
// middleware:
if (!tokenMap.has(token)) { res.status(401).json({ error: "Invalid or unknown token" }); return; }
const credentials = tokenMap.get(token);
```

Add a regression test asserting `__proto__` / `constructor` / `toString` → 401.

### C2 — Unauthenticated-by-default + binds `0.0.0.0` `[HTTP]` — CRITICAL (FIXED 2026-06-22)

`app.ts:50` sets `authEnabled = false` whenever the token map is empty, and `auth.ts:79-82` then passes **all** requests through. The gateway image binds `0.0.0.0` and `docker-compose.gateway.yml` publishes the port on all host interfaces. A gateway started without `MCP_AUTH_CONFIG` is an open bMS proxy. The standalone per-server HTTP mode (`index.ts:~1436`) had **no auth middleware at all** and bound all interfaces.

**Fix (applied):** fail closed in both paths.
- `gateway.ts` — refuses to start when auth is disabled **and** the bind address is non-loopback, unless `MCP_ALLOW_NO_AUTH=true` is set.
- All 13 servers + template (`index.ts` standalone HTTP block) — `MCP_BIND` now defaults to `127.0.0.1`; binding a non-loopback address is refused (exit 1) unless `MCP_ALLOW_NO_AUTH=true`. (The standalone server has no client-auth layer, so loopback-by-default + explicit opt-in is the correct hardening; front it with the authenticated gateway for remote access.)

Verified live: gateway and standalone server both refuse non-loopback binds without the override, start on loopback by default, and start with the override.

### C3 — Secrets returned to the model unredacted, reachable read-only `[BOTH]` — CRITICAL

`bconnect-defensecontrol-mcp/src/index.ts:368-387` — `get_bitlocker_secrets` (recovery keys + startup PIN) and `get_local_admin_accounts` (cleartext LAPS admin password) serialize the full API response to the model via `JSON.stringify`. No redaction exists anywhere in the codebase. Because these are GET tools they are **not** behind `ALLOW_WRITE_OPERATIONS`. `list_api_keys` (servermanagement) likewise returns key objects with no MCP-side filtering.

**Fix:** redact/mask secret fields before returning, or gate these tools behind an explicit `ALLOW_SECRET_READ` opt-in. Never let them enter transcripts by default.

### H1 — No TLS on the gateway `[HTTP]` — HIGH

Bearer tokens travel in cleartext HTTP headers. Documentation recommends a reverse proxy but nothing enforces it. Combined with C2's `0.0.0.0` bind, tokens are sniffable.

**Fix:** mandate TLS termination; document loopback-only bind as the alternative.

### H2 — No rate limiting + no container resource limits → DoS `[HTTP]` — HIGH

The gateway creates a fresh MCP server + bConnect client per request (`app.ts:67-78`); no compose file sets `cpus`/`mem_limit`/`pids_limit`, and there is no gateway-layer rate limiting. A runaway n8n loop or any valid-token caller can drive unbounded instantiation → OOM/CPU starvation.

**Fix:** add `express-rate-limit` per token, an `express.json({ limit: '256kb' })` cap, and `deploy.resources.limits` in both compose files.

### H3 — Destructive tools gated by a single global flag `[BOTH]` — HIGH

`restart_management_server`, `msw_cleanup`, 12× `delete_*`, `update_object_permission`, `patch_local_admin_user_credentials` are gated solely by `ALLOW_WRITE_OPERATIONS=true`. No per-tool RBAC, confirmation, or forced dry-run (a `simulate_msw_cleanup` exists but the model is not required to call it first).

**Fix:** per-tool allowlists; a confirmation/dry-run convention for irreversible operations.

### Medium / Low
- **M1 `[HTTP]`** — `tokens.json` holds plaintext tokens and bConnect credentials; comparison is not constant-time. Store hashed tokens.
- **M2 `[BOTH]`** — credentials passed as env vars (visible in `docker inspect`). Move to mounted secrets; the gateway token-map mount is the model to follow.
- **M3 `[BOTH]`** — Docker base images use floating `node:20-alpine` tags, no digest pin → non-reproducible builds.
- **M4 `[BOTH]`** — no structured logging, no `LOG_LEVEL`/`LOG_FORMAT`, no gateway access log.
- **M5 `[HTTP]`** — gateway bypasses the startup connectivity check; operators get no early "bMS unreachable" signal.
- **L1** — enabling `includeParameters:true` in audit config would log PATCH bodies containing new passwords/PINs (off by default — latent).
- **L2** — inconsistent default base URLs (`bms.example.com:444` vs `bms-server`) let a misconfig silently target a dead host instead of failing.

### Positives (verified — do not regress)
- **Tenant isolation correct**: fresh server + client per request; the response cache is a per-client instance, so it is per-request in gateway mode — **no cross-tenant cache leak**.
- **Stateless gateway** (`sessionIdGenerator: undefined`) → N replicas behind a plain LB, no session affinity needed.
- **No path traversal / SSRF via tool args** — IDs are anchored-GUID-validated before interpolation; query params use axios encoding; the host comes only from env.
- **Log hygiene** — hostnames stripped from connection errors; `Basic`/`X-Api-Key` headers never logged.
- Non-root containers, multi-stage builds, sane `.dockerignore`/`.gitignore`, no committed secrets, committed lockfile, SBOM, Renovate.

---

## 3. Dependency findings (Dependabot, live 2026-06-22)

91 open alerts de-duplicate to **7 unique packages** (each shared dep is counted once per lockfile across the monorepo):

| Package | Severity | Scope | Instances | Ships in prod? |
|---|---|---|---|---|
| form-data | High | runtime | 15 | Yes (axios transitive) |
| hono | High / Med | runtime | 5 | Yes (MCP SDK transitive) |
| js-yaml | Medium | runtime | 3 | Yes |
| vitest | **Critical** | development | 13 | No (test only) |
| vite | High | development | 26 | No (test only) |
| brace-expansion | Medium | development | 13 | No (test only) |
| esbuild | Low | development | 16 | No (test only) |

**Runtime exposure is 23 alerts across 3 packages**, all fixable, all low practical risk here:
- **form-data** CRLF injection requires attacker-controlled multipart field names; the client sends JSON, not multipart.
- **hono** advisories are serve-static / AWS-Lambda / hono-CORS specific; the gateway uses **Express**, not hono's HTTP layer (hono ships only inside the MCP SDK).
- **js-yaml** is a quadratic-complexity DoS via crafted YAML merge keys.

All 13 **Critical** alerts are dev-only `vitest` (UI-server arbitrary file read — only exploitable if the Vitest UI is exposed; CI does not).

---

## 4. GitHub repository posture (live 2026-06-22)

- ✅ **Dependabot alerts** — enabled (91 open, analysed above).
- 🔴 **Code scanning (CodeQL)** — **DISABLED** ("Advanced Security must be enabled"). This is why C1 was never auto-detected; Dependabot inspects dependencies only, never first-party code.
- 🟠 **Secret scanning + push protection** — **DISABLED**. A hardcoded API key would not be blocked on push.

---

## 5. Remediation plan

### P0 — code (today; not covered by any current GitHub tooling)
1. **C1** — ✅ DONE — own-property token-lookup guard + regression test (this branch).
2. **C2** — ✅ DONE — fail-closed on non-loopback bind in gateway + all standalone servers; `MCP_BIND` defaults to loopback (this branch).

### P1 — runtime dependencies (clears the 23 runtime alerts)
Add `overrides` to each top-level manifest, then `npm install` + rebuild images:
```jsonc
"overrides": { "form-data": ">=4.0.6", "hono": ">=4.12.25", "js-yaml": ">=4.1.2" }
```

### P2 — dev dependencies (clears the 13 Critical + remaining dev alerts)
```
npm i -D vitest@latest @vitest/coverage-v8@latest vite@latest esbuild@latest
```
across all 13 servers + template + gateway + root.

### P3 — GitHub posture & ongoing hardening
- Enable **secret scanning + push protection**.
- Enable **CodeQL** (JS/TS) — catches C1-class bugs going forward.
- Add `.github/dependabot.yml` with grouped weekly updates (avoids 15× duplicate PRs).
- Pin Docker base images by digest; add JSON logging + `LOG_LEVEL`/`LOG_FORMAT`; move env credentials to mounted secrets; hash tokens at rest.

---

## 6. Go / no-go

- **stdio:** acceptable now; residual risk is C3 + H3 (what the model can see/do), not network exposure.
- **HTTP gateway:** ship only after **C1 + C2 + H1 + H2**. C1 is the single highest priority and the cheapest fix.

---

*Methodology: source review of the gateway auth/transport path and the bConnect client; live exploit verification of C1 against a locally-run gateway; `npm audit` reconciled against live GitHub Dependabot alerts; GitHub security configuration queried via the REST API.*
