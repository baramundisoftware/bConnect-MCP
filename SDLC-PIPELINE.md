# SDLC Pipeline — bConnect-MCP

## Overview

This document describes the full Software Development Lifecycle (SDLC) pipeline for the
bConnect-MCP project, implemented as Claude Code slash commands. The pipeline extends the
inner build loop (`/process-start-task`) with phase-gate commands that enforce design review,
code review, security scanning, QA validation, and release management.

**Current version**: 2.0.0 (13-server split architecture)
**Workflow model:** Trunk-based development on `master` (solo developer).
No feature branches or pull requests. Gates enforce quality and security directly before
pushing to `origin/master`.

**Architecture**: 13 independent MCP servers, each a separate npm package in its own
subdirectory. Commands that touch tests or security scans run across all 13 servers.

---

## The Gap: What `/process-start-task` Covers

The core task executor handles:

- Reading `Tasks.md` and dispatching the right developer role
- TDD implementation loop (Red → Green → Refactor)
- Per-server: lint, type-check (`tsc --noEmit`), vitest
- Git commit per task

It does **not** cover: design approval, code review, security scanning, cross-server E2E
testing against bConnectMock, UAT sign-off, versioning, or release packaging.

---

## Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  PHASE START  (new phase begins on master)                   │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
          ┌────────────────────────────┐
          │   /process-design-review   │
          │                            │
          │  Roles: architect,         │
          │         product-owner      │
          │                            │
          │  • Read Requirements.md    │
          │  • Draft/review ADR        │
          │  • Define API contract     │
          │  • Context-window impact   │
          │    (tools × tokens)        │
          │  • Identify security risks │
          │  • ⛔ USER SIGN-OFF        │
          └────────────┬───────────────┘
                       │ ✅ Design approved
                       ▼
          ┌────────────────────────────┐
          │   /process-start-task      │
          │   (loops until phase done) │
          │                            │
          │  Roles: all developer      │
          │         roles              │
          │                            │
          │  • TDD per task            │
          │  • Per-server lint +       │
          │    type-check + vitest     │
          │  • Commit to master        │
          └────────────┬───────────────┘
                       │ ✅ All tasks committed (local)
                       ▼
          ┌────────────────────────────┐
          │   /process-pr-review       │
          │   (push gate, not PR)      │
          │                            │
          │  Roles: security-engineer, │
          │         qa-engineer,       │
          │         lead-dev           │
          │                            │
          │  • npm audit (all 13 pkgs) │
          │  • License compliance      │
          │  • semgrep SAST scan       │
          │  • Secrets scan            │
          │  • Full vitest suite       │
          │    (all 13 servers)        │
          │  • AI code review summary  │
          │  • ⛔ USER SIGN-OFF        │
          │  • git push origin master  │
          └────────────┬───────────────┘
                       │ ✅ Pushed to origin/master
                       ▼
          ┌────────────────────────────┐
          │   /process-qa-gate         │
          │                            │
          │  Roles: qa-engineer,       │
          │         perf-engineer      │
          │                            │
          │  • E2E tests (bConnectMock)│
          │    — 25R2 and 26R1 nodes  │
          │  • System tests (live BMS) │
          │  • Regression suite        │
          │  • Context-window sanity   │
          │    (tool-count × 300 tok)  │
          │  • Doc consistency sweep   │
          │  • UAT checklist           │
          │  • ⛔ USER SIGN-OFF        │
          └────────────┬───────────────┘
                       │ ✅ QA passed
                       ▼
          ┌────────────────────────────┐
          │   /it-auditor (optional)   │
          │                            │
          │  Role: IT Auditor          │
          │                            │
          │  • 6-domain independent    │
          │    audit (code, security,  │
          │    CI/CD, architecture,    │
          │    supply chain, docs)     │
          │  • bConnect-specific:      │
          │    API coverage audit      │
          │    (264/264 endpoints)     │
          │  • Formal audit report     │
          │  • ⛔ USER SIGN-OFF        │
          └────────────┬───────────────┘
                       │ ✅ Audit passed (or skipped)
                       ▼
          ┌────────────────────────────┐
          │   /process-release         │
          │                            │
          │  Roles: tech-writer,       │
          │         devops-engineer    │
          │                            │
          │  • Semver bump (all 13)    │
          │  • CHANGELOG.md update     │
          │  • git tag -s vX.Y.Z       │
          │  • SBOM generation         │
          │  • Ansible deployment      │
          │    packaging (optional)    │
          │  • GitHub Release + assets │
          │  • Post-deploy smoke test  │
          └────────────────────────────┘
                       │
                       ▼
               PHASE COMPLETE
         (restart Claude, next phase)
```

---

## Command Reference

| Command | Gate | Human Sign-off | Roles Invoked |
|---|---|:---:|---|
| `/process-design-review` | Pre-build | ✅ Required | architect, product-owner |
| `/process-start-task` | Build loop | — | all developer roles |
| `/process-pr-review` | Push gate | ✅ Required | security-engineer, qa-engineer, lead-dev |
| `/process-qa-gate` | Pre-release | ✅ Required | qa-engineer, perf-engineer |
| `/it-auditor` | Audit | Optional (required for major releases) | it-auditor |
| `/process-release` | Release | ✅ Required | tech-writer, devops-engineer |

> **Note on `/process-pr-review`:** Despite the name, this project uses trunk-based
> development — no PRs are opened. The command runs all security and code-review checks
> locally across all 13 servers, presents a consolidated summary, and pushes directly to
> `origin/master` after your approval.

---

## Roles Required

All roles are globally defined in `~/.claude/commands/`.

| Role Command | Used In | Primary Responsibility |
|---|---|---|
| `/architect` | design-review | ADRs, server-split boundaries, context-window analysis |
| `/product-owner` | design-review | API coverage targets, acceptance criteria per release |
| `/lead-dev` | start-task, pr-review | Implementation, cross-server code review |
| `/backend-dev` | start-task | MCP tool definitions, bConnect API modules |
| `/test-engineer` | start-task | Vitest TDD per server |
| `/security-engineer` | pr-review | OWASP, SAST, SCA, dependency scan, secrets, write-op gate |
| `/qa-engineer` | pr-review, qa-gate | bConnectMock E2E, UAT, doc consistency |
| `/perf-engineer` | qa-gate | Response-time baselines, context-token budget |
| `/tech-writer` | release | CHANGELOG, per-server READMEs, release notes |
| `/devops-engineer` | release | Semver, git tag, SBOM, Ansible packaging, GitHub Release |
| `/it-auditor` | audit | 6-domain audit + bConnect API coverage audit |

---

## Security Integration

Security is not a single step — it runs at five checkpoints.

### 1. Design Review (`/process-design-review`)
- Threat model for new MCP tools (write-op gate, rate limiting)
- Identify injection risks in tool `inputSchema` parameters before code is written
- Review credential handling design (Basic Auth, env vars)
- SSL/TLS strategy documented (custom CA support, NODE_TLS_REJECT_UNAUTHORIZED)
- Context-window impact: ensure new tools don't push a loading profile over budget

### 2. Push Gate (`/process-pr-review`) — Primary security gate

Run across all 13 servers:

```bash
# Per server (loop all 13 bconnect-*-mcp/ directories):
for dir in bconnect-*-mcp/; do
  echo "=== $dir ==="

  # Dependency vulnerabilities
  npm audit --audit-level=high --prefix "$dir"

  # License compliance (SCA)
  npx license-checker --production \
    --failOn "GPL-3.0-only;GPL-3.0-or-later;AGPL-3.0-only;AGPL-3.0-or-later;SSPL-1.0" \
    --prefix "$dir"

  # Type safety
  npm run type-check --prefix "$dir"
done

# Secrets scan (repo-wide)
npx secretlint "**/*"

# Static analysis — OWASP ruleset (repo-wide src/)
npx semgrep --config=auto bconnect-*-mcp/src/
```

Findings are classified:

| Severity | Action |
|---|---|
| Critical / High | **BLOCK** — must fix before push |
| Medium | Document + create follow-up task in `Tasks.md` |
| Low / Info | Log in code review summary |

### 3. QA Gate (`/process-qa-gate`)
- E2E tests against bConnectMock (25R2 node + 26R1 node) — all 13 servers exercised
- System tests against live BMS server (`BMS_URL` env var required)
- Live API integration tests validate no credential exposure in logs
- Write-op gate (`BCONNECT_WRITE_OPS_ENABLED`) explicitly tested for both on/off states
- SSL bypass flag tested and behavior documented as risk-accepted
- SSRF vector (user-supplied server URL) validated

### 4. Release Gate (`/process-release`) — SBOM and signing

```bash
# SBOM generation (CycloneDX) — run per server, merge into root sbom.json
for dir in bconnect-*-mcp/; do
  npx @cyclonedx/cyclonedx-npm --package-lock-only --output-format json \
    --output-file "../sbom-${dir%/}.json" \
    --prefix "$dir"
done

# GPG sign the release tarball (if packaged)
gpg --detach-sign --armor bconnect-mcp-v*.tar.gz
```

Release assets (uploaded to GitHub Release):
- `bconnect-mcp-v<version>.tar.gz` — all 13 built servers packaged
- `bconnect-mcp-v<version>.tar.gz.asc` — GPG detach-signature
- `sbom.json` — merged CycloneDX Software Bill of Materials

### 5. Project-Specific Security Concerns (bConnect MCP)

| Risk | Location | Mitigation |
|---|---|---|
| Write-op execution | All mutating tools (POST/PATCH/DELETE) | `BCONNECT_WRITE_OPS_ENABLED` gate (REQ-SRV-012) |
| Credential exposure | Axios request logging | Verify Basic Auth header is never logged by transport layer |
| SSL bypass | `NODE_TLS_REJECT_UNAUTHORIZED` | Feature intentional for self-signed BMS certs; documented as risk-accepted |
| SSRF | `BMS_URL` env var | Validate URL format; document that only internal BMS URLs should be used |
| Input injection | Tool `inputSchema` parameters | 100% input validation via `parameter-validator.ts` (all 267 tools) |
| Unsigned artifacts | Release tarball | GPG detach-signature + CycloneDX SBOM on every GitHub Release |
| Dependency chain | `node_modules` (×13) | `npm audit` + license-checker across all 13 servers on every push gate |

---

## Required Tools / Extensions

### Already Available
- `npm audit` — dependency vulnerability scan
- `npx` — runs semgrep, secretlint, license-checker, cyclonedx without global install
- `gh` (GitHub CLI) — release management, CI status checks
- `git` — tagging, branching
- `docker` / `docker compose` — bConnectMock for E2E tests (25R2 + 26R1 nodes)
- `gpg` — release tarball signing

### Install Once (recommended global)
```bash
# Secrets scanning
npm install -g secretlint @secretlint/secretlint-rule-preset-recommend

# CHANGELOG generation
npm install -g conventional-changelog-cli

# SBOM generation
npm install -g @cyclonedx/cyclonedx-npm

# License compliance
npm install -g license-checker
```

### GitHub Repository Settings
- **Dependabot alerts**: enable in repo Settings → Security → Dependabot
- **GitHub Actions**: CI workflow (`.github/workflows/ci.yml`) — runs vitest + audit across all 13 servers on every push/PR to master
- **GPG signing key**: stored as `GPG_PRIVATE_KEY` + `GPG_PASSPHRASE` in GitHub repo secrets (for release tarball signing)
- **Branch protection**: require CI status checks on `master`, disable force-push
- **Signed git tags**: all release tags must use `git tag -s` — never `git tag -a`

### CI Workflow (`.github/workflows/ci.yml`) — to be created

Two jobs run on every push to `master` / PR against `master`:

**Job 1: `dependency-review`** (PRs only)
- `actions/dependency-review-action@v4` — blocks high/critical vulns and denied licenses (GPL-3.0, AGPL-3.0, SSPL-1.0)

**Job 2: `build-and-test`** (every push + PR, matrix: all 13 servers)
- `npm ci`
- `npm run build` (TypeScript compilation)
- `npm test` (Vitest unit + integration)
- `npm audit --omit=dev --audit-level=high`
- `license-checker --production --failOn` (denied licenses)

**Permissions**: `contents: read`, `id-token: write`

---

## Multi-Server Workflow Notes

Because bConnect-MCP is 13 independent npm packages, some commands need explicit multi-server scope:

### Running tests across all servers
```bash
for dir in bconnect-*-mcp/; do
  echo "=== $dir ===" && npm test --prefix "$dir"
done
```

### Building all servers
```bash
for dir in bconnect-*-mcp/; do
  npm run build --prefix "$dir"
done
```

### Bumping versions (release)
```bash
# Bump all 13 package.json versions to the new semver
NEW_VERSION="2.1.0"
for dir in bconnect-*-mcp/; do
  npm version "$NEW_VERSION" --no-git-tag-version --prefix "$dir"
done
```

### bConnectMock for E2E
- Mock repo: `/home/ansible/MCP/bConnectMock_V2.0/`
- OpenAPI specs: `/home/ansible/MCP/bConnectOpenAPI/25R2/` and `26R1/`
- Start both API versions: `docker compose up` (25R2 node) + `docker compose -f docker-compose.26r1.yml up`

---

## When to Use Which Commands

### Full feature development (new server or new tools)
```
/process-design-review  →  /process-start-task  →  /process-pr-review
```

### Patch / bugfix (no design change needed)
```
/process-start-task  →  /process-pr-review
```

### Release (after QA sign-off on accumulated phases)
```
/process-qa-gate  →  /process-release
```

### Major release (v2.0.0, v3.0.0 — includes full audit)
```
/process-qa-gate  →  /it-auditor  →  /process-release
```

### Emergency hotfix
```
/process-start-task  →  /process-pr-review  →  /process-release
```
*(skip qa-gate — document as risk-accepted in release notes)*

### API coverage gap closure (new bConnect release)
```
/process-design-review  →  /process-start-task  →  /process-pr-review  →  /process-qa-gate
```
*(new bConnect release = design review required: assess new OpenAPI specs, context-window impact)*

---

## Project Setup Requirements

| File / Setting | Required By | Purpose |
|---|---|---|
| `Tasks.md` | all process commands | Task backlog and done tracking |
| `Requirements.md` | design-review, release | Requirements and acceptance criteria |
| `CLAUDE.md` | all commands | Project context, conventions |
| `bconnect-*-mcp/vitest.config.ts` | build, test | Per-server test runner configuration |
| `CHANGELOG.md` | release | Release history |
| `ADR-001-server-split.md` | design-review | Authoritative split-architecture decision record |
| `.github/workflows/ci.yml` | ongoing | CI: build + test + audit (matrix: all 13 servers) |
| `docker-compose.yml` | qa-gate | bConnectMock 25R2 node for E2E tests |
| `docker-compose.26r1.yml` | qa-gate | bConnectMock 26R1 node for E2E tests |
| `GPG_PRIVATE_KEY` (GitHub secret) | release | For release tarball signing |
| `GPG_PASSPHRASE` (GitHub secret) | release | Passphrase for GPG signing key |
| Dependabot enabled | ongoing | Automated dependency vulnerability alerts (×13 packages) |

---

## bConnect-Specific QA Checklist

These items are bConnect-specific and must be validated in `/process-qa-gate`:

- [ ] All 267 tools respond correctly against bConnectMock 25R2
- [ ] All 267 tools respond correctly against bConnectMock 26R1
- [ ] `BCONNECT_API_VERSION` env var switches between 25R2 / 26R1 tool sets correctly
- [ ] `BCONNECT_WRITE_OPS_ENABLED=false` blocks all POST/PATCH/DELETE tools
- [ ] `BCONNECT_WRITE_OPS_ENABLED=true` allows write tools through
- [ ] Server startup connectivity check (REQ-SRV-013) fires on launch and fails fast if BMS unreachable
- [ ] No Basic Auth credentials appear in any log output
- [ ] SSL bypass (`NODE_TLS_REJECT_UNAUTHORIZED=0`) documented and tested
- [ ] Context-window budget: each loading profile stays within target (see Requirements.md table)
- [ ] API coverage: 264/264 bConnect 26R1 endpoints covered across all 13 servers

---

*Document version: 1.0 — 2026-04-01 (initial, adapted from n8nconnector SDLC-PIPELINE v1.2)*
