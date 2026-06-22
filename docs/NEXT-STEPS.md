# bConnect MCP — Next Steps / Follow-up Backlog

**Created:** 2026-06-22
**Companion to:** [`SECURITY-AUDIT-2026-06-22.md`](SECURITY-AUDIT-2026-06-22.md)
**Architecture decisions:** [ADR-0001 — Reverse proxy for TLS + edge rate limiting](adr/0001-reverse-proxy-tls-edge-ratelimit.md) · [ADR-0002 — Shared `@bconnect/mcp-core` via npm workspaces](adr/0002-shared-mcp-core-npm-workspaces.md)
**Reviewed by:** Solutions Architect (2026-06-22) — see reframes inline below

Actionable backlog after the 2026-06-22 security & DevOps audit. Grouped by theme,
each item tagged with priority (P0 highest), rough effort, and the suggested role.
Items already completed are marked ✅ with their PR (#15 = C1/C2 security fixes, #16 = CI hardening).

---

## A. Security remediation (from the audit)

| ID | Item | Pri | Effort | Role | Status |
|----|------|-----|--------|------|--------|
| C1 | Prototype-pollution auth bypass — own-property token guard + regression test | P0 | S | security-engineer | ✅ done (PR #15) |
| C2 | Fail closed on non-loopback bind (gateway + 14 standalone servers); `MCP_BIND` default loopback | P0 | S | security-engineer | ✅ done (PR #15) |
| C3 | Secret-returning tools (`get_bitlocker_secrets`, `get_local_admin_accounts`, `list_api_keys`) — redact or gate behind `ALLOW_SECRET_READ` | P1 | M | security-engineer + backend-dev | open (approach: opt-in gate, TBD) |
| H1 | Gateway TLS — **adopt a reverse proxy (Caddy) for TLS termination** rather than in-app TLS; refuse cleartext non-loopback. See ADR-0001 | P1 | S | devops-engineer | open |
| H2 | **Edge** rate-limit + body caps at the proxy; keep **per-token** rate-limit in-app (`express-rate-limit`); add container resource limits. See ADR-0001 | P1 | M | devops-engineer | open |
| H3 | Destructive tools — per-tool allowlist + confirmation/dry-run convention (replace single `ALLOW_WRITE_OPERATIONS`) | P2 | L | architect + backend-dev | open |
| M1 | Hash tokens at rest in `tokens.json`; constant-time compare | P2 | S | security-engineer | open |
| M2 | Move credentials from env vars to **Docker/Compose secrets** (or SOPS-encrypted files for at-rest-in-git); avoid heavyweight Vault/KMS for an on-prem product | P2 | M | devops-engineer | open |
| M3 | Pin Docker base images by digest (`node:20-alpine@sha256:…`) | P2 | S | devops-engineer | open |
| M4 | Structured/JSON logging + `LOG_LEVEL`/`LOG_FORMAT` + gateway access log | P2 | M | devops-engineer | open |
| M5 | Gateway honours `BCONNECT_SKIP_CONNECTIVITY_CHECK` / early bMS-reachability signal | P3 | S | backend-dev | open |
| L1 | Audit `includeParameters` must never log secrets even if enabled | P3 | S | security-engineer | open |
| L2 | Require `BCONNECT_BASE_URL` explicitly (drop misleading placeholder defaults) | P3 | S | backend-dev | open |

## B. Dependency remediation (Dependabot, 91 alerts → 7 packages)

| ID | Item | Pri | Effort | Role | Status |
|----|------|-----|--------|------|--------|
| D1 | Runtime: pin fixed transitives via `overrides` — `form-data >=4.0.6`, `hono >=4.12.25`, `js-yaml >=4.1.2`. **Deferred — fold into Q1 as a single root-level `overrides` (avoids 15× per-manifest churn; runtime alerts are low practical risk here).** | P1 | S | devops-engineer | deferred → Q1 |
| D2 | Dev tooling: bump `vitest` / `@vitest/coverage-v8` / `vite` / `esbuild` to latest (clears all 13 "critical" + dev highs) | P2 | S | devops-engineer | open |
| D3 | Add `.github/dependabot.yml` with **grouped** weekly updates so the monorepo stops generating 15× duplicate PRs | P2 | S | devops-engineer | ✅ done (PR #16 — same as G4) |

## C. Code quality / tech debt — shared-core extraction (the big one)

The 13 servers + template were built by copy-paste. This is now a **maintenance and
security liability**: a fix to shared logic must be applied up to 14 times.

| ID | Item | Pri | Effort | Role | Notes |
|----|------|-----|--------|------|-------|
| Q1 | **Extract a shared `@bconnect/mcp-core` package via npm workspaces** for `bconnect-client.ts` + the three `utils/*`. **Spike validated 2026-06-22** (response-cache extracted → endpoints builds + 11 tests green; SEA/.exe gate removed — MCP_Deployment out of scope; esbuild version-skew needs root `overrides`). **Decide wrap raw SDK vs. FastMCP-TS** (other session). See ADR-0002 | P1 | L | solutions-architect + architect + lead-dev | **deferred** → full extraction pending FastMCP decision |
| Q2 | Reconcile the **14 drifted `bconnect-client.ts` copies** before/while extracting — all ~459 lines, **every hash differs**, so they have already diverged. Diff them, pick the canonical version, fold fixes in. | P1 | M | lead-dev | Security-sensitive: error handling, TLS, retry all live here |
| Q3 | Fold the `bconnect-server-template` into the shared package so new servers inherit fixes automatically | P2 | M | architect | Template is currently a 15th divergent copy |
| Q4 | Add a CI guard (or jscpd/`tsr` check) that fails if client/util code is copy-pasted again | P3 | S | devops-engineer | Prevents regression of Q1 |

**Drift evidence (2026-06-22):**
- `bconnect-client.ts` — 14 copies, ~459 lines each, **14 distinct md5 hashes** (drifted).
- `utils/audit-logger.ts` — 13 identical + 1 template variant.
- `utils/parameter-validator.ts` — 13 identical + 1 template variant.
- `utils/response-cache.ts` — 13 identical + 1 template variant.

> The C1/C2 fixes are an immediate example of the cost: C2 had to be applied to 14
> separate `index.ts` files. Q1/Q2 would make such fixes one-line, one-place changes.

## D. GitHub repository posture (P3)

| ID | Item | Pri | Effort | Role | Status |
|----|------|-----|--------|------|--------|
| G1 | Secret scanning + push protection | P2 | S (config) | devops-engineer | **deferred → free on going public** (~2026-12). GHAS not funded. |
| G2 | Code scanning (CodeQL) + add `.github/workflows/codeql.yml` | P3 | S (config) | devops-engineer | **deferred → free on going public** (~2026-12). GHAS not funded. |
| G3 | Semgrep + `npm audit` in CI (license-free SAST/SCA) | P2 | S | devops-engineer | ✅ done (PR #16, non-blocking) |
| G4 | `.github/dependabot.yml` — all packages, grouped | P2 | S | devops-engineer | ✅ done (PR #16) |
| G5 | Pin GitHub Actions to commit SHAs (supply-chain) | P2 | S | devops-engineer | ✅ done (PR #16) |
| G6 | Branch protection on `main` (require PR review + passing CI) | P2 | S (config) | devops-engineer | **deferred → free on going public** (~2026-12); needs Pro while private |

> **Go-public plan (~2026-12, ~6 months out).** The connector ships with any bMS
> license, so the repo is planned to go **public**. That unlocks secret scanning,
> CodeQL, and branch protection **for free** — so **do not fund GHAS**; G1/G2/G6 wait
> for the visibility flip. **Pre-flight checklist (run before flipping, not now):**
> (1) full **git-history** secret scan (gitleaks/trufflehog — history, not just HEAD);
> (2) ensure C1 (PR #15) is merged first so no live exploit is published;
> (3) confirm internal docs (`Tasks.md`, `Requirements.md`, audit, ADRs, `handover/`,
> `reports/`) were never committed historically; (4) then enable the three free features.

### Do we *have* to configure Code Quality? — No.

- **Not required** for the suite to build, run, or release. It's defence-in-depth.
- This is an **Organization-owned private** repo with `security_and_analysis: null`, so
  CodeQL / "Code quality" / secret scanning need **GitHub Advanced Security (GHAS)** —
  a paid, per-committer add-on enabled at the org level. You cannot toggle it on for free
  on a private repo. (If the repo were **public**, all of this is free.)
- **Honest caveat:** default CodeQL JS/TS queries would **not** have caught C1
  (prototype-pollution via lookup is a logic pattern outside the standard suite). So GHAS
  is worth it for ongoing coverage, but it is not a substitute for review/hardening.
- **Recommended path (OSS-first — Solutions Architect reframe):**
  1. **Now, free:** add `dependabot.yml` (G4) + a CI workflow running **semgrep + npm audit + osv-scanner** (G3). This is the *primary* scanning posture — every PR, no licensing.
  2. **Only if the org already pays for GHAS:** add secret scanning + push protection (G1) as incremental value; CodeQL (G2) is nice-to-have (it would not have caught C1).
  3. Treat GHAS as an **optional add-on, not a prerequisite** — it must never block the posture workstream.

---

## Suggested sequencing (Solutions Architect)

> **Hard rule:** no further change to `bconnect-client.ts` logic (TLS, retry, error handling) until Q1 ships — otherwise the 14× duplication tax is paid again. The remaining P1 security items (C3, H2, M1) do *not* touch the client, so security-first is safe.

1. ✅ **Land C1/C2** — PR #15 (open, awaiting review/merge).
2. ✅ **Free posture wins** — Dependabot all-packages + Semgrep + action SHA-pins → PR #16 (open). (D1 `overrides` deferred — applied once at the workspace root during Q1.)
3. **Adopt the edge** — Caddy reverse proxy for TLS + edge rate-limit (ADR-0001) → reframes H1/H2. ← *next unstarted*
4. **Remaining security** — C3 (opt-in gate) → per-token rate-limit (H2 app side) → M1.
5. **Shared-core keystone** — Q1 spike → ADR-0002 decision → Q1/Q2 extraction. Every future client fix flows through this.
6. **GHAS** — only if/when the org funds it (G1/G2).
