# Tasks — bConnect-MCP Project

**Created**: 2026-03-22
**Updated**: 2026-03-30 (Requirements re-architected: file-based server split, 25R2/26R1 version awareness)
**Source**: Requirements.md (reviewed 2026-03-30)
**Scope**: Project-level — all modules, server infrastructure, production hardening, per-spec-file server split (12 V2.0 + 1 V1.1), MCP_Deployment suite installer, Docker images, Linux/Ubuntu deployment

---

## 📊 Status Summary

| Phase | Focus | Tasks | Status |
|-------|-------|-------|--------|
| C1 | MCP Server Core Infrastructure | 9 | ✅ Complete |
| C2 | V2.0 API Modules (10 modules) | 30 | ✅ Complete |
| C3 | V1.1 API Modules (6 modules) | 18 | ✅ Complete |
| C4 | Documentation & Known Issues Search | 6 | ✅ Complete |
| C5 | Testing Infrastructure & Input Validation | 12 | ✅ Complete |
| Phase 1 | SSL/TLS Production Hardening | 6 | ✅ Complete |
| Phase 2 | Production Config — Rate Limiting & Audit Logging | 7 | ✅ Complete |
| Phase 3 | Performance Test Suite | 6 | ✅ Complete |
| Phase 4 | Remaining V2.0 Endpoints (52 of 163) | 7 | ✅ Complete |
| Phase 5 | Multi-Server Architecture Design | 2 | ✅ Complete |
| Phase 6 | bconnect-endpoints-mcp (V2.0 Server 1) | 4 | ✅ Complete |
| Phase 7 | Version Awareness & Type Generation (26R1) | 5 | ✅ Complete |
| Phase 8 | Shared Server Template & ADR Update | 3 | ✅ Complete |
| Phase 9 | bconnect-activedirectory-mcp | 4 | ✅ Complete |
| Phase 10 | bconnect-assets-mcp | 4 | ✅ Complete |
| Phase 11 | bconnect-compliance-mcp (26R1 only) | 4 | ✅ Complete |
| Phase 12 | bconnect-defensecontrol-mcp | 4 | ✅ Complete |
| Phase 13 | bconnect-jobs-mcp | 4 | ✅ Complete |
| Phase 14 | bconnect-operatingsystems-mcp | 4 | ✅ Complete |
| Phase 15 | bconnect-servermanagement-mcp | 4 | ✅ Complete |
| Phase 16 | bconnect-software-mcp | 4 | ✅ Complete |
| Phase 17 | bconnect-universaldynamicgroups-mcp (26R1 only) | 4 | ✅ Complete |
| Phase 18 | bconnect-updatemanagement-mcp | 4 | ✅ Complete |
| Phase 19 | bconnect-variables-mcp | 4 | ✅ Complete |
| Phase 20 | bconnect-v11-mcp (V1.1 Legacy) | 5 | ⏸️ Postponed |
| Phase 21 | Distribution (Windows .exe + Docker) | 8 | ✅ Complete |
| Phase 22 | Documentation (all servers) | 1 | 🟡 Upcoming (MEDIUM) |

---

### MCP_Deployment — In Progress 🔵 (2026-03-23)

**Scope**: `/home/ansible/MCP/MCP_Deployment/` — Windows suite installer, winget, Linux/Ubuntu suite deployment, Docker images, Claude Code + Claude Desktop integration
**Full task plan**: `MCP_Deployment/Tasks.md`
**Critical dependency**: MCP_Deployment Phases 3–10 are blocked until bConnect-MCP Phases 5–10 (server split) are complete.

#### ✅ COMPLETED (MCP_Deployment)
- [x] Linux tarball build (`build-tarball.sh`)
- [x] Linux automated install/uninstall (`install.sh`, `uninstall.sh`)
- [x] Systemd service unit (`bconnect-mcp.service`)
- [x] Windows single-server Inno Setup installer (`bconnect-mcp-setup.iss`)
- [x] Windows full build pipeline (`build-windows-installer.ps1`, `build-installer-only.ps1`)
- [x] Linux → Windows transfer prep (`prepare-for-windows-build.sh`)

#### ✅ COMPLETE (MCP_Deployment Phase 1 — 2026-03-23)
- [x] **Phase 1: Immediate Script Fixes** — Fixed SOURCE_DIR in `build-tarball.sh`; fixed `node16`→`node18` pkg target; test scripts added

#### ✅ COMPLETE (MCP_Deployment Phase 2 — 2026-03-24)
- [x] **Phase 2: Claude Code & Ubuntu Linux Config** — `configure-claude-code-ubuntu.sh` delivered; `install-claude-desktop-ubuntu.sh` updated to official .deb; ARM64 limitation in `INSTALL-ON-UBUNTU.md`

#### 🟡 UPCOMING (MCP_Deployment — blocked on REQ-SPLIT-001, now 13 servers not 5)
- [ ] **Phase 3: Multi-Executable Build Pipeline** — 13 standalone `.exe` via pkg node20-win-x64; blocked on bConnect-MCP Phases 9–20
- [ ] **Phase 4: Dockerfiles Per Server + Registry** — 13 Dockerfiles (node:20-alpine, non-root), `build-docker-images.sh`, `ADR-003`; blocked on Phases 9–20
- [ ] **Phase 5: Suite Inno Setup Installer** — `bconnect-mcp-suite-setup.iss` with component selection (12 V2.0 + 1 V1.1); blocked on Phase 3
- [ ] **Phase 6: Linux Suite Installation Scripts** — `install-suite.sh`, `uninstall-suite.sh`, 13× systemd units; blocked on Phase 3
- [ ] **Phase 7: Docker MCP Integration on Linux** — `configure-docker-mcp-ubuntu.sh`, 13× Docker systemd units; blocked on Phase 4
- [ ] **Phase 8: Claude Desktop Auto-Config in Installer** — Fix `CreateClaudeConfig` Pascal; blocked on Phase 5
- [ ] **Phase 9: Silent Install** — `/BCONNECT_URL/USER/PASS` params + BMS snippet; blocked on Phase 5
- [ ] **Phase 10: winget Package Manifest** — 3 YAML files for `baramundi.bConnectMCPSuite`; blocked on Phase 5 + public URL
- [ ] **Phase 11: Documentation** — All deployment docs updated for 13-server suite + Docker + Linux paths

---

## ✅ Completed — C1: MCP Server Core Infrastructure

**Requirement**: REQ-SRV-001 through REQ-SRV-010

- [x] **[IMPL] MCP server identity** — `src/index.ts`: server name `bconnect-mcp-server` v1.0.0 registered via `@modelcontextprotocol/sdk` *(Developer)*
- [x] **[IMPL] Stdio transport** — `StdioServerTransport` in `src/index.ts`; server launches as subprocess *(Developer)*
- [x] **[IMPL] HTTP Basic Authentication** — credentials read from `BCONNECT_USERNAME` / `BCONNECT_PASSWORD` env vars; server throws on missing creds *(SecurityArchitect)*
- [x] **[IMPL] Input validation infrastructure** — `src/utils/parameter-validator.ts` (298 lines) + `src/utils/mcp-tool-validation-rules.ts` (546+ lines); 186/186 case statements covered *(Developer)*
- [x] **[IMPL] Rate limiting class** — `src/utils/rate-limiter.ts`: token bucket, configurable `maxRequests`/`windowMs`; 16 unit tests *(Developer)*
- [x] **[IMPL] Audit logging class** — `src/utils/audit-logger.ts`: levels `all/write/security/none`, `[SECURITY AUDIT]` prefix; 16 unit tests *(SecurityArchitect)*
- [x] **[IMPL] Response caching class** — LRU cache with TTL, auto-invalidation on writes, `X-Cache` headers; 24 unit tests *(Developer)*
- [x] **[IMPL] Batch operations class** — concurrent API calls with configurable limits, exponential backoff, progress callbacks; 20 unit tests *(Developer)*
- [x] **[IMPL] Dual client architecture** — `src/bconnect-client.ts`: V2.0 + V1.1 sub-clients sharing auth, retry, and error handling; V1.1 base path auto-derived *(SoftwareArchitect)*

---

## ✅ Completed — C2: V2.0 API Modules (10 modules, 94 tools)

**Requirement**: All V2.0 module sections in Requirements.md

- [x] **[IMPL] Endpoints module** — `src/modules/endpoints.ts`: 41 tools (10R + 31W); Android, Windows, Linux, Mac, Logical groups, Industrial, Network, Maintenance Windows *(Developer)*
- [x] **[TEST] Endpoints E2E** — `src/__tests__/e2e/v2.0/endpoints.e2e.test.ts`: 35 tests passing *(TestEngineer)*
- [x] **[IMPL] Jobs module** — `src/modules/jobs.ts`: 21 tools (8R + 13W); instances, folders, group assignments, kiosk releases *(Developer)*
- [x] **[TEST] Jobs E2E** — `src/__tests__/e2e/v2.0/jobs.e2e.test.ts`: 17 tests passing *(TestEngineer)*
- [x] **[IMPL] Assets module** — `src/modules/assets.ts`: 19 tools (8R + 11W); assets, types, stock folders, type folders *(Developer)*
- [x] **[TEST] Assets E2E** — `src/__tests__/e2e/v2.0/assets.e2e.test.ts`: 13 tests passing *(TestEngineer)*
- [x] **[IMPL] Active Directory module** — `src/modules/activedirectory.ts`: 10 tools (10R); users, groups, OUs, objects *(Developer)*
- [x] **[TEST] Active Directory E2E** — `src/__tests__/e2e/v2.0/activedirectory.e2e.test.ts`: 7 tests passing *(TestEngineer)*
- [x] **[IMPL] Software module** — `src/modules/software.ts`: 4 tools (4R); installed software per endpoint/group *(Developer)*
- [x] **[IMPL] Update Management module** — `src/modules/updatemanagement.ts`: 3 tools (2R + 1W); update profile assignment via JSON Patch *(Developer)*
- [x] **[IMPL] Defense Control module** — `src/modules/defensecontrol.ts`: 12 tools (9R + 3W); BitLocker status, Defender threats, local admin accounts *(Developer)*
- [x] **[TEST] Defense Control E2E** — `src/__tests__/e2e/v2.0/defensecontrol.e2e.test.ts`: 3 tests passing *(TestEngineer)*
- [x] **[IMPL] Variables module** — `src/modules/variables.ts`: 13 tools (9R + 4W); definitions, instances, scope-based queries *(Developer)*
- [x] **[TEST] Variables E2E** — `src/__tests__/e2e/v2.0/variables.e2e.test.ts`: 7 tests passing *(TestEngineer)*
- [x] **[IMPL] Operating Systems module** — `src/modules/operatingsystems.ts`: 9 tools (5R + 4W); OS folders, Windows endpoint OS config *(Developer)*
- [x] **[IMPL] Server Management module** — `src/modules/servermanagement.ts`: 25 tools (13R + 12W); server control, microservices, cloud connectors, PXE relays, security groups/profiles, permissions *(Developer)*
- [x] **[TEST] Server Management E2E** — `src/__tests__/e2e/v2.0/servermanagement.e2e.test.ts`: 7 tests passing *(TestEngineer)*
- [x] **[IMPL] OpenAPI type generation** — `src/generated/*-types.ts`: 10 type files generated from `openapi-specs/*.json` *(Developer)*
- [x] **[LINT] V2.0 build quality** — Clean TypeScript build (0 errors), 86.35% coverage maintained *(QualityAssuranceEngineer)*

---

## ✅ Completed — C3: V1.1 API Modules (6 modules, 23 tools)

**Requirement**: All V1.1 module sections in Requirements.md

- [x] **[IMPL] Compliance Violations V1.1** — `src/modules/complianceviolations-v1.ts`: 3 tools (3R); CVE, MDM policy, industrial violations; reference V1.1 integration pattern *(Developer)*
- [x] **[TEST] Compliance Violations E2E** — `src/__tests__/e2e/v1.1/complianceviolations.e2e.test.ts`: 8 tests passing *(TestEngineer)*
- [x] **[IMPL] BitLocker Secrets V1.1** — `src/modules/bitlocker-v1.ts`: 5 tools (5R); recovery keys, TPM passwords, PINs; all access audit-logged with `[SECURITY AUDIT]` prefix *(SecurityArchitect)*
- [x] **[TEST] BitLocker E2E** — `src/__tests__/e2e/v1.1/bitlocker.e2e.test.ts`: 15 tests passing *(TestEngineer)*
- [x] **[IMPL] Apple VPP V1.1** — `src/modules/vpp-v1.ts`: 7 tools (2R + 5W); VPP users, license assignment/revocation *(Developer)*
- [x] **[TEST] VPP E2E** — `src/__tests__/e2e/v1.1/vpp.e2e.test.ts`: 17 tests passing *(TestEngineer)*
- [x] **[IMPL] SSH Server V1.1** — `src/modules/ssh-v1.ts`: 1 tool (1R); SSH port, version, host key fingerprints for Linux/Unix endpoints *(Developer)*
- [x] **[TEST] SSH E2E** — `src/__tests__/e2e/v1.1/ssh.e2e.test.ts`: 3 tests passing *(TestEngineer)*
- [x] **[IMPL] Setup Integrity V1.1** — `src/modules/setup-integrity-v1.ts`: 2 tools (2R); SHA-256 hashes of Bfcrx and Management Agent setup files *(SecurityArchitect)*
- [x] **[TEST] Setup Integrity E2E** — `src/__tests__/e2e/v1.1/setupintegrity.e2e.test.ts`: 2 tests passing *(TestEngineer)*
- [x] **[IMPL] Detailed Inventory V1.1** — `src/modules/inventory-v1.ts`: 5 tools (5R); file, WMI, custom, hardware, SNMP scans *(Developer)*
- [x] **[TEST] Inventory E2E** — `src/__tests__/e2e/v1.1/inventory.e2e.test.ts`: 15 tests passing *(TestEngineer)*
- [x] **[LINT] V1.1 build quality** — Clean build, all V1.1 modules integrated into `BConnectClient.v1Client` *(QualityAssuranceEngineer)*

---

## ✅ Completed — C4: Documentation & Known Issues Search

**Requirement**: Documentation Search and Known Issues Search sections in Requirements.md

- [x] **[IMPL] Documentation Search module** — `src/modules/documentation-search.ts`: 4 tools; indexes 13,500+ documents (forum, feedback, release notes, preview docs, website) *(Developer)*
- [x] **[IMPL] Known Issues Search module** — `src/modules/known-issues-search.ts`: 2 tools; cross-references 1,664 known issues with 9,856 forum threads *(Developer)*
- [x] **[TEST] Documentation Search test suite** — 115 tests: unit, integration, E2E workflows, performance, error handling *(TestEngineer)*
- [x] **[IMPL] Forum Search sub-module** — `src/modules/forum-search.ts`: fuzzy matching, ranked results, excerpt generation *(Developer)*

---

## ✅ Completed — C5: Testing Infrastructure & Input Validation

**Requirement**: REQ-SRV-004, all module test coverage

- [x] **[IMPL] MSW (Mock Service Worker) infrastructure** — `src/__tests__/setup/handlers.ts` + `src/__tests__/mocks/handlers.ts`: V2.0 + V1.1 mock handlers for all 16 modules *(SystemTestEngineer)*
- [x] **[TEST] Integration test suite** — 95 tests across 9 files; all 10 V2.0 + 6 V1.1 modules covered; 1.38s execution *(TestEngineer)*
- [x] **[TEST] E2E test suite** — 209 tests: 149 V2.0 (10 files) + 60 V1.1 (6 files); 100% pass rate; 3.38s execution *(SystemTestEngineer)*
- [x] **[TEST] Unit test suite** — 510 unit tests (494 passing, 16 skipped); 86.35% code coverage *(TestEngineer)*
- [x] **[IMPL] Input validation rules** — `src/utils/mcp-tool-validation-rules.ts`: 186/186 case statements validated (GUID, pagination, enums, ranges, required fields) *(Developer)*
- [x] **[TEST] Validator tests** — `src/utils/__tests__/parameter-validator.test.ts`: 40 tests, 100% pass rate *(TestEngineer)*
- [x] **[LINT] Full build quality gate** — 0 TypeScript errors, 86.35% coverage, 812 tests passing *(QualityAssuranceEngineer)*

---

## ✅ Complete — Phase 1: SSL/TLS Production Hardening

**Priority**: HIGH — required before production deployment; currently `.env.example` actively disables TLS verification
**Depends on**: Nothing — can start immediately
**Requirement**: PLANNED — SSL Certificate Verification (Requirements.md)
**Deliverables**:
- `.env.example` with `NODE_TLS_REJECT_UNAUTHORIZED=0` removed from active config (moved to commented warning)
- `src/index.ts` reads `BCONNECT_CA_CERT_PATH` env var and passes CA cert to `BConnectClient`
- Integration test asserting CA cert loading from env var
- Updated `SSL-CERTIFICATE-GUIDE.md` with env-var-based CA cert setup

**Implementation gap found**: `src/index.ts` only reads `BCONNECT_BASE_URL`, `BCONNECT_USERNAME`, `BCONNECT_PASSWORD`, and `NODE_TLS_REJECT_UNAUTHORIZED`. The `BConnectClient` supports `ca`, `cert`, `key`, and `passphrase` TLS options but there is no env var mapping for them. Self-signed cert support requires loading a CA PEM from disk — this path is missing.

**Security finding**: `.env.example` has `NODE_TLS_REJECT_UNAUTHORIZED=0` as an **active, uncommented** line. New users cloning the repo will disable TLS verification automatically.

---

- [x] 🔴 **[TEST] Write assertion: BConnectClient receives `ca` from BCONNECT_CA_CERT_PATH env var** *(TestEngineer)* — deliverable: assertion in `src/__tests__/bconnect-client.test.ts`; assert that when `process.env.BCONNECT_CA_CERT_PATH` is set to a temp PEM file, `BConnectClient` is initialized with `ca` option set; `npm test` → **FAILS** (index.ts does not yet read this env var)

- [x] 🟢 **[IMPL] Add BCONNECT_CA_CERT_PATH env var to index.ts** *(Developer)* — deliverable: `src/index.ts`; read `BCONNECT_CA_CERT_PATH`, use `fs.readFileSync` to load PEM, pass as `ca` to `BConnectClient` config; `npm test` → PASSES

- [x] 🔴 **[TEST] Write assertion: .env.example does not contain active NODE_TLS_REJECT_UNAUTHORIZED=0** *(SecurityArchitect)* — deliverable: assertion in `src/__tests__/security/env-example.test.ts`; read `.env.example` file, assert `NODE_TLS_REJECT_UNAUTHORIZED=0` does not appear as an uncommented, active line; `npm test` → **FAILS** (currently `.env.example` has it active)

- [x] 🟢 **[IMPL] Fix .env.example — remove active TLS bypass** *(SecurityArchitect)* — deliverable: `.env.example`; move `NODE_TLS_REJECT_UNAUTHORIZED=0` inside a `# DEVELOPMENT ONLY — NEVER USE IN PRODUCTION` comment block; add `BCONNECT_CA_CERT_PATH=` as an optional entry with instructions; `npm test` → PASSES

- [x] 🟢 **[DOCS] Update SSL-CERTIFICATE-GUIDE.md with BCONNECT_CA_CERT_PATH env var** *(DocumentationSpecialist)* — deliverable: `SSL-CERTIFICATE-GUIDE.md`; add section showing how to export baramundi server cert, set `BCONNECT_CA_CERT_PATH=/path/to/bms-ca.pem`, and verify TLS is working

- [x] 🔵 **[LINT] npm run build + security audit** *(QualityAssuranceEngineer)* — deliverable: 0 build errors; verify `rejectUnauthorized` defaults to `true` in all test paths; grep for `NODE_TLS_REJECT_UNAUTHORIZED=0` in src/ returns 0 results

---

## ✅ Complete — Phase 2: Production Configuration — Rate Limiting & Audit Logging

**Priority**: HIGH — rate limiting and audit logging classes are built and tested but cannot be enabled without code changes; production deployments need env-var control
**Depends on**: Phase 1 complete (env var pattern established)
**Requirement**: REQ-SRV-005 (Rate Limiting), REQ-SRV-006 (Audit Logging) — both COMPLETED as classes but not configurable via env without editing source
**Deliverables**:
- `src/index.ts` reads `BCONNECT_RATE_LIMIT_ENABLED`, `BCONNECT_RATE_LIMIT_MAX_REQUESTS`, `BCONNECT_RATE_LIMIT_WINDOW_MS`
- `src/index.ts` reads `BCONNECT_AUDIT_LEVEL` (none/security/write/all)
- `.env.example` updated with production-configuration env vars
- Tests verifying env-var-driven enablement

**Implementation gap found**: `src/index.ts` creates `BConnectClient` without setting `rateLimit` or `audit` config options. Enabling these features requires editing `src/index.ts`. There are no env vars to activate them at runtime.

---

- [x] 🔴 **[TEST] Write assertion: rate limiting is enabled when BCONNECT_RATE_LIMIT_ENABLED=true** *(TestEngineer)* — deliverable: assertion in `src/__tests__/bconnect-client.test.ts`; set `process.env.BCONNECT_RATE_LIMIT_ENABLED = 'true'`, assert `BConnectClient` is constructed with `rateLimit.enabled: true`; `npm test` → **FAILS** (index.ts does not read this env var)

- [x] 🟢 **[IMPL] Add BCONNECT_RATE_LIMIT_* env vars to index.ts** *(Developer)* — deliverable: `src/index.ts`; read `BCONNECT_RATE_LIMIT_ENABLED` (boolean), `BCONNECT_RATE_LIMIT_MAX_REQUESTS` (number, default 100), `BCONNECT_RATE_LIMIT_WINDOW_MS` (number, default 60000); pass to `BConnectClient` config; `npm test` → PASSES

- [x] 🔴 **[TEST] Write assertion: audit level is set from BCONNECT_AUDIT_LEVEL env var** *(TestEngineer)* — deliverable: assertion in `src/__tests__/bconnect-client.test.ts`; set `process.env.BCONNECT_AUDIT_LEVEL = 'write'`, assert `BConnectClient` audit config level equals `'write'`; `npm test` → **FAILS** (index.ts does not read this env var)

- [x] 🟢 **[IMPL] Add BCONNECT_AUDIT_LEVEL env var to index.ts** *(Developer)* — deliverable: `src/index.ts`; read `BCONNECT_AUDIT_LEVEL` (none/security/write/all, default 'none'); pass to `BConnectClient` audit config; `npm test` → PASSES

- [x] 🔴 **[TEST] Write assertion: .env.example documents all new production env vars** *(QualityAssuranceEngineer)* — deliverable: assertion in `src/__tests__/security/env-example.test.ts`; assert `.env.example` contains entries for `BCONNECT_CA_CERT_PATH`, `BCONNECT_RATE_LIMIT_ENABLED`, `BCONNECT_AUDIT_LEVEL`; `npm test` → **FAILS** (these entries don't exist yet)

- [x] 🟢 **[IMPL] Update .env.example with production configuration section** *(SecurityArchitect)* — deliverable: `.env.example`; add `## Production Security Settings` section with `BCONNECT_CA_CERT_PATH`, `BCONNECT_RATE_LIMIT_ENABLED=false`, `BCONNECT_RATE_LIMIT_MAX_REQUESTS=100`, `BCONNECT_AUDIT_LEVEL=none`; `npm test` → PASSES

- [x] 🔵 **[LINT] npm run build + verify env var coverage** *(QualityAssuranceEngineer)* — deliverable: 0 build errors; all 6 new env vars (`BCONNECT_CA_CERT_PATH`, `BCONNECT_RATE_LIMIT_ENABLED`, `BCONNECT_RATE_LIMIT_MAX_REQUESTS`, `BCONNECT_RATE_LIMIT_WINDOW_MS`, `BCONNECT_AUDIT_LEVEL`, plus existing 4) documented in `.env.example`

---

## ✅ Complete — Phase 3: Performance Test Suite

**Priority**: MEDIUM
**Depends on**: Phases 1 and 2 complete (stable configuration baseline)
**Requirement**: PLANNED — Performance Benchmarks (Requirements.md)
**Deliverables**:
- `src/__tests__/performance/api-performance.test.ts` — P95 response time < 500ms for list operations
- `src/__tests__/performance/memory-usage.test.ts` — memory baseline under load
- `package.json` `test:performance` script
- Performance results documented in `PERFORMANCE-REPORT.md`

**Implementation gap found**: No API performance tests exist. `src/modules/__tests__/documentation-search-performance.test.ts` covers doc-search only. The existing performance test references `/workspaces/claudinno/docs.baramundi.com` — a path that does not exist in the current environment (`/home/ansible/MCP/bConnect-MCP`).

---

- [x] 🔴 **[TEST] Write assertion: list_endpoints MSW-backed response completes in < 500ms** *(TestEngineer)* — deliverable: `src/__tests__/performance/api-performance.test.ts`; use MSW to mock `/Endpoints`, assert P95 of 100 sequential `list_endpoints` calls < 500ms; `npm test` → **FAILS** (file does not exist)

- [x] 🟢 **[IMPL] Implement API performance test suite** *(SystemTestEngineer)* — deliverable: `src/__tests__/performance/api-performance.test.ts`; 8 tests covering list operations for Endpoints, Jobs, Assets, Active Directory; uses MSW to avoid live server dependency; measures P50 and P95; `npm test` → PASSES

- [x] 🔴 **[TEST] Write assertion: memory usage stays < 200MB for 1,000 sequential calls** *(TestEngineer)* — deliverable: `src/__tests__/performance/memory-usage.test.ts`; use `process.memoryUsage()` before and after 1,000 MSW-backed calls; assert heap used delta < 200MB; `npm test` → **FAILS** (file does not exist)

- [x] 🟢 **[IMPL] Implement memory usage test** *(SystemTestEngineer)* — deliverable: `src/__tests__/performance/memory-usage.test.ts`; baseline + under-load measurement with forced GC between phases; `npm test` → PASSES

- [x] 🟢 **[IMPL] Add test:performance script to package.json** *(DevOpsEngineer)* — deliverable: `package.json`; add `"test:performance": "vitest run src/__tests__/performance"` script; verify `npm run test:performance` runs without error

- [x] 🔵 **[LINT] npm run build + performance gate** *(QualityAssuranceEngineer)* — deliverable: 0 build errors; `npm run test:performance` exits 0; results documented in `PERFORMANCE-REPORT.md` with P50/P95 values and memory baseline

---

## ✅ Complete — Phase 4: Remaining V2.0 Endpoints (52 unimplemented)

**Priority**: LOW — current coverage satisfies primary IT admin use cases; implement highest-value gaps
**Depends on**: None — independent of Phases 1–3; can start at any time
**Requirement**: PLANNED — Remaining bConnect V2.0 Endpoints (52 of 163) (Requirements.md)
**Deliverables**:
- Coverage audit report identifying all 52 missing endpoints by module
- Implementation of top-priority missing endpoints (minimum: top 10 by IT admin value)
- Updated Requirements.md status for each newly implemented endpoint
- Tests for each new tool

**Analysis**: OpenAPI specs contain 228 total `operationId` entries across 10 modules. STATUS.md reports 111/163 implemented (68%). The largest gap is Endpoints (89 operationIds in spec, ~41 tools implemented = ~48 gaps in this module alone).

---

- [x] 🔴 **[TEST] Write audit assertion: enumerate implemented tools vs OpenAPI operationIds** *(TestEngineer)* — deliverable: `src/__tests__/coverage/endpoint-coverage.test.ts`; parse all `openapi-specs/*.json`, extract `operationId` list, compare against tools registered in `ListToolsRequestSchema`; output coverage report to console; `npm test` → **FAILS** (file does not exist; expected to report 52+ gaps)

- [x] 🟢 **[IMPL] Create endpoint coverage audit report** *(SoftwareArchitect)* — deliverable: `ENDPOINT-COVERAGE-AUDIT.md`; run the coverage test, capture output, format as a markdown table listing each gap with module, operationId, HTTP method, and estimated IT admin value (HIGH/MEDIUM/LOW); `npm test` → PASSES

- [x] 🔴 **[TEST] Write assertions for top 10 missing endpoints** *(TestEngineer)* — deliverable: test cases in relevant `e2e` or `integration` test files; assert each of the 10 highest-value missing tool names appears in `list_tools()` output; `npm test` → **FAILS** (tools not yet registered)

- [x] 🟢 **[IMPL] Implement top 10 missing V2.0 tools** *(Developer)* — deliverable: updated module file(s) in `src/modules/`; add methods and register tools in `src/index.ts` for the 10 highest-value gaps identified in the audit; `npm test` → PASSES

- [x] 🟢 **[IMPL] Add input validation rules for new tools** *(Developer)* — deliverable: `src/utils/mcp-tool-validation-rules.ts`; add validation case for each new tool name; `npm test` → PASSES

- [x] 🟢 **[IMPL] Update Requirements.md status** *(RequirementsEngineer)* — deliverable: `Requirements.md`; update endpoint count from 111/163 to reflect new coverage; mark new tools as ✅ IMPLEMENTED in relevant module section

- [x] 🔵 **[LINT] npm run build + coverage check** *(QualityAssuranceEngineer)* — deliverable: 0 build errors; code coverage ≥ 86.35% maintained; all new tools have validation rules; E2E pass rate remains 100%

---

## ✅ Complete — Phase 5: Multi-Server Architecture Design

**Priority**: HIGH — blocks all split phases; must be done first
**Depends on**: Nothing — can start immediately
**Requirement**: REQ-SPLIT-001 — Multi-Server Architecture
**Deliverables**:
- `ADR-001-server-split.md` — Architecture Decision Record documenting the file-based split rationale, shared infrastructure strategy (copy vs. shared npm package), repo layout, and migration path from monolithic server
- Updated `Requirements.md` REQ-SPLIT-001 status: 📋 → 🚧

**Note (2026-03-30)**: Initial ADR described a 5-server domain-affinity grouping. Requirements were re-architected to use one server per OpenAPI spec file (12 V2.0 + 1 V1.1). ADR-001 revised accordingly; bconnect-endpoints-mcp and bconnect-jobs-mcp rescoped (see Phase 6 note).

---

- [x] 🟢 **[ARCH] Create ADR-001-server-split.md** *(SoftwareArchitect)* — deliverable: `ADR-001-server-split.md`; document: why 196 tools → 13 servers (one per spec file), module-to-server assignment table, shared infrastructure decision (copy `bconnect-client.ts` + `utils/`), new repo naming convention `bconnect-<domain>-mcp`, migration note (monolithic server remains until all servers are stable)

- [x] 🔵 **[REVIEW] Architecture review sign-off** *(QualityAssuranceEngineer)* — deliverable: ADR-001 reviewed; confirm all 196 tools are accounted for across 13 servers (no tool left behind, no tool duplicated); verify module-to-server assignments match REQ-SPLIT-002 through REQ-SPLIT-014

---

## ✅ Complete — Phase 6: bconnect-endpoints-mcp (rescoped to endpoints only)

**Priority**: HIGH
**Depends on**: Phase 5 complete (architecture decision)
**Requirement**: REQ-SPLIT-006 — bconnect-endpoints-mcp
**Deliverables**:
- `bconnect-endpoints-mcp/` with full project scaffold
- `src/index.ts` registering only the ~47 tools from the `endpoints` module
- Integration test asserting `listTools()` returns exactly the expected tool set
- Clean build (0 TypeScript errors)

**Note (2026-03-30)**: Originally scaffolded with endpoints + activedirectory + operatingsystems (~68 tools) under the superseded 5-server grouping. Rescoped to endpoints only. `activedirectory.ts` and `operatingsystems.ts` removed from `src/modules/`; AD and OS tools removed from `src/index.ts`; test updated. Those modules will be implemented in their own dedicated servers (Phases 9 and 14).

---

- [x] 🟢 **[INFRA] Create project scaffold for bconnect-endpoints-mcp** *(DevOpsEngineer)* — deliverable: `bconnect-endpoints-mcp/package.json` + `tsconfig.json` + `.env.example` + `src/` directory structure; copy `bconnect-client.ts`, `utils/parameter-validator.ts`, `utils/mcp-tool-validation-rules.ts`, and `utils/rate-limiter.ts` from monolithic repo; `npm install` succeeds

- [x] 🔴 **[TEST] Write assertion: listTools() returns all ~47 endpoints-only tools** *(TestEngineer)* — deliverable: `__tests__/server.test.ts`; assert `listTools()` response contains all tool names from `endpoints` module only and does NOT contain any tool from AD, OS, jobs, assets, defensecontrol, variables, or V1.1 modules

- [x] 🟢 **[IMPL] Create src/index.ts registering endpoints tools only** *(Developer)* — deliverable: `bconnect-endpoints-mcp/src/index.ts`; module `endpoints.ts` only; server name: `bconnect-endpoints-mcp`; `npm test` → PASSES

- [x] 🔵 **[LINT] npm run build + tool isolation check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; no `any` types in module files; `listTools()` count ~47; no cross-server tool leakage

---

## ✅ Complete — Phase 7: Version Awareness & Type Generation (26R1)

**Priority**: HIGH — BLOCKER for all new server builds; also covers REQ-VER-001 (version numbering)
**Depends on**: Phase 6 complete
**Requirement**: REQ-SRV-011 (Version Awareness), REQ-VER-001 (bMS-Aligned Versioning), REQ-BMS-001 (Spec Location — resolved)
**Deliverables**:
- `package.json` `generate-types:25R2` and `generate-types:26R1` scripts pointing to `/home/ansible/MCP/bConnectOpenAPI/{release}/`
- `src/generated/26R1/` — 12 TypeScript type files generated from 26R1 specs
- `src/generated/25R2/` — 10 TypeScript type files generated from 25R2 specs (existing files moved/re-generated)
- `src/index.ts` reads `BCONNECT_RELEASE` env var; server identity string includes release
- `package.json` version updated from `1.0.0` → `26.1.0`
- `.env.example` updated with `BCONNECT_RELEASE=26R1`

---

- [x] 🔴 **[TEST] Write assertion: package.json version matches bMS-aligned format and generate-types scripts exist** *(TestEngineer)* — deliverable: `src/__tests__/server-identity.test.ts`; assert `package.json` version matches `/^\d{2}\.\d+\.\d+$/`; assert `package.json` scripts include `generate-types:25R2` and `generate-types:26R1`; `npm test` → **FAILS** (version is `1.0.0`, scripts absent) ✅ RED confirmed (11/11 tests failing as expected)

- [x] 🟢 **[IMPL] Update package.json: version → 26.1.0, add generate-types scripts, update pkg config** *(Developer)* — deliverable: `package.json`; set `"version": "26.1.0"`; add `"generate-types:25R2": "openapi-typescript /home/ansible/MCP/bConnectOpenAPI/25R2/*.json --output src/generated/25R2/"` and `"generate-types:26R1": "openapi-typescript /home/ansible/MCP/bConnectOpenAPI/26R1/*.json --output src/generated/26R1/"`; update `pkg` assets array and targets to node20; `npm test` → 11/11 PASSES ✅

- [x] 🟢 **[IMPL] Generate 26R1 TypeScript types and reorganize src/generated/ by release** *(Developer)* — deliverable: `src/generated/26R1/` (12 type files); `src/generated/25R2/` (10 type files); `src/generated/index.ts` reference barrel; existing flat files preserved for backward compatibility; `npm run build` 0 errors ✅

- [x] 🔴 **[TEST] Write assertion: BCONNECT_RELEASE env var sets server identity and excludes 25R2-only modules** *(TestEngineer)* — deliverable: `src/__tests__/version-awareness.test.ts`; assert server name contains release string, BCONNECT_RELEASE read with 26R1 default, .env.example documents it, compliance/UDG gated on 26R1; `npm test` → 9/9 FAILS ✅ RED confirmed

- [x] 🟢 **[IMPL] Add BCONNECT_RELEASE env var to src/index.ts; version-gate 26R1-only modules** *(Developer)* — deliverable: `src/index.ts`; reads `BCONNECT_RELEASE` (default `26R1`); server name = `` `bconnect-mcp-server/${bconnectRelease}` ``; version = `26.1.0`; compliance/UDG gated via spread; `.env.example` updated with `BCONNECT_RELEASE=26R1` and 25R2 note; `npm test` → 9/9 PASSES ✅

- [x] 🔵 **[LINT] npm run build + version gate verification** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors ✅; server-identity 11/11 ✅; version-awareness 9/9 ✅; BCONNECT_RELEASE read in index.ts (2 refs) ✅; 26R1: 12 type files ✅; 25R2: 10 type files ✅

---

## ✅ Complete — Phase 8: Shared Server Template & ADR Update

**Priority**: HIGH — establishes the reusable scaffold all Phases 9–20 copy from
**Depends on**: Phase 7 complete (types generated, version scheme in place)
**Requirement**: REQ-SPLIT-001 — Multi-Server Architecture (file-based split completion)
**Deliverables**:
- Updated `ADR-001-server-split.md` reflecting file-based split (replaces 5-server grouping)
- `bconnect-server-template/` — reference scaffold: `package.json`, `tsconfig.json`, `.env.example`, `src/index.ts` stub, shared infra files
- `CONTRIBUTING.md` — versioning rules (bMS year.release.patch) and server naming convention

---

- [x] 🟢 **[ARCH] Update ADR-001-server-split.md for file-based split** *(SoftwareArchitect)* — deliverable: `ADR-001-server-split.md`; supersede old 5-server grouping; document new decision: one server per OpenAPI spec file; include 26R1 server table (13 servers), rationale (domain alignment, token budget), shared infra copy strategy, and note that `bconnect-endpoints-mcp` already implements the pattern

- [x] 🟢 **[INFRA] Create bconnect-server-template/ scaffold** *(DevOpsEngineer)* — deliverable: `bconnect-server-template/`; includes `package.json` (version `26.1.0`), `tsconfig.json`, `.env.example` (with `BCONNECT_RELEASE`, `BCONNECT_BASE_URL`, `BCONNECT_USERNAME`, `BCONNECT_PASSWORD`, `BCONNECT_CA_CERT_PATH`, `BCONNECT_AUDIT_LEVEL`), `src/index.ts` stub with MCP server setup, copies of `bconnect-client.ts` + `parameter-validator.ts` + `rate-limiter.ts` + `audit-logger.ts`

- [x] 🔵 **[REVIEW] Template review sign-off** *(QualityAssuranceEngineer)* — deliverable: template `npm install` + `npm run build` succeeds; ADR-001 accounts for all 196 existing tools across the 13 new servers (no tool left behind, none duplicated); file-based split matches REQ-SPLIT-002 through REQ-SPLIT-014

---

## ✅ Complete — Phase 9: bconnect-activedirectory-mcp

**Priority**: HIGH
**Depends on**: Phase 8 complete (template ready, 26R1 types generated)
**Requirement**: REQ-SPLIT-002 — bconnect-activedirectory-mcp
**Deliverables**: `bconnect-activedirectory-mcp/` with ~16 tools; 26R1 typed; clean build; isolation test passing

---

- [x] 🟢 **[INFRA] Scaffold bconnect-activedirectory-mcp from template** *(DevOpsEngineer)* — deliverable: `bconnect-activedirectory-mcp/` with full scaffold; copy `activedirectory.ts` module + 26R1 generated types; `npm install` succeeds

- [x] 🔴 **[TEST] Write assertion: listTools() returns all ~16 activedirectory-mcp tools** *(TestEngineer)* — deliverable: `bconnect-activedirectory-mcp/__tests__/server.test.ts`; assert `listTools()` contains all AD tool names and excludes tools from any other domain; `npm test` → **FAILS** (index.ts not yet created)

- [x] 🟢 **[IMPL] Create src/index.ts registering activedirectory tools** *(Developer)* — deliverable: `bconnect-activedirectory-mcp/src/index.ts`; server name `bconnect-activedirectory-mcp`; registers all tools from `activedirectory.ts`; `npm test` → PASSES

- [x] 🔵 **[LINT] npm run build + tool isolation check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; `listTools()` count ~16; no cross-server tool leakage; no `any` types in module file

---

## ✅ Complete — Phase 10: bconnect-assets-mcp

**Priority**: HIGH
**Depends on**: Phase 8 complete; can run in parallel with Phases 9, 11–19
**Requirement**: REQ-SPLIT-003 — bconnect-assets-mcp
**Deliverables**: `bconnect-assets-mcp/` with ~26 tools; 26R1 typed (26 ops vs 24 in 25R2); clean build; isolation test passing

---

- [x] 🟢 **[INFRA] Scaffold bconnect-assets-mcp from template** *(DevOpsEngineer)* — deliverable: `bconnect-assets-mcp/` with full scaffold; copy `assets.ts` module + 26R1 generated types; `npm install` succeeds

- [x] 🔴 **[TEST] Write assertion: listTools() returns all ~26 assets-mcp tools** *(TestEngineer)* — deliverable: `bconnect-assets-mcp/src/__tests__/server.test.ts`; 6 tests (26R1: 26 tools, 25R2: 24 tools, isolation, descriptions, unknown tool); `npm test` → 6/6 PASSING

- [x] 🟢 **[IMPL] Create src/index.ts registering assets tools** *(Developer)* — deliverable: `bconnect-assets-mcp/src/index.ts`; server name `bconnect-assets-mcp`; 24 base tools + 2 26R1-only (list_assets_by_org_unit, list_assets_by_ad_object); fixed 3 short descriptions; `npm test` → PASSES

- [x] 🔵 **[LINT] npm run build + tool isolation check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; `listTools()` count 26 (26R1) / 24 (25R2); 6 tests passing; clean build

---

## ✅ Complete — Phase 11: bconnect-compliance-mcp *(26R1 only)*

**Priority**: HIGH — new module, no existing implementation to copy
**Depends on**: Phase 8 complete; 26R1 types required (no 25R2 equivalent)
**Requirement**: REQ-SPLIT-004 — bconnect-compliance-mcp
**Deliverables**: `bconnect-compliance-mcp/` with 8 tools; net-new module implementation from compliance-types.ts; clean build; isolation test passing

---

- [x] 🔴 **[TEST] Write assertion: listTools() returns 8 compliance-mcp tools** *(TestEngineer)* — deliverable: `bconnect-compliance-mcp/src/__tests__/server.test.ts`; 5 tests; `npm test` → **FAILS** before index.ts

- [x] 🟢 **[INFRA] Scaffold bconnect-compliance-mcp from template** *(DevOpsEngineer)* — deliverable: scaffolded from activedirectory-mcp; `src/modules/compliance.ts` + `src/generated/compliance-types.ts`; `npm install` succeeds

- [x] 🟢 **[IMPL] Implement compliance module and register tools in src/index.ts** *(Developer)* — deliverable: `src/modules/compliance.ts` (typed module) + `src/index.ts`; 8 tools: rule violations (2), detected vulnerabilities (2), mobile device rules (2), CVE library (2); `npm test` → 5/5 PASSING

- [x] 🔵 **[LINT] npm run build + 26R1-only gate check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; `listTools()` count = 8; clean build

---

## ✅ Complete — Phase 12: bconnect-defensecontrol-mcp

**Priority**: HIGH
**Depends on**: Phase 8 complete; can run in parallel with Phases 9–11, 13–19
**Requirement**: REQ-SPLIT-005 — bconnect-defensecontrol-mcp
**Deliverables**: `bconnect-defensecontrol-mcp/` with 13 tools; 26R1 typed (13 ops vs 11 in 25R2); clean build; isolation test passing

---

- [x] 🟢 **[INFRA] Scaffold bconnect-defensecontrol-mcp from template** *(DevOpsEngineer)* — scaffolded; copied defensecontrol.ts module + 26R1 types; extended module with getBitLockerSecrets + updateBitLockerPin (26R1)

- [x] 🔴 **[TEST] Write assertion: listTools() returns all 13 defensecontrol-mcp tools** *(TestEngineer)* — `src/__tests__/server.test.ts` with 5 tests; RED confirmed before index.ts

- [x] 🟢 **[IMPL] Create src/index.ts registering defensecontrol tools** *(Developer)* — 11 base tools + 2 26R1-only (get_bitlocker_secrets, update_bitlocker_pin); `npm test` → 5/5 PASSING

- [x] 🔵 **[LINT] npm run build + tool isolation check** *(QualityAssuranceEngineer)* — 0 TypeScript errors; 13 tools (26R1) / 11 tools (25R2); clean build

---

## ✅ Complete — Phase 13: bconnect-jobs-mcp (rescoped to jobs only)

**Priority**: HIGH
**Depends on**: Phase 5 complete (architecture decision)
**Requirement**: REQ-SPLIT-007 — bconnect-jobs-mcp
**Deliverables**: `bconnect-jobs-mcp/` with ~24 tools from `jobs` module only; clean build; isolation test passing

**Note (2026-03-30)**: Originally scaffolded with jobs + servermanagement + variables (~62 tools) under the superseded 5-server grouping. Rescoped to jobs only. `servermanagement.ts` and `variables.ts` removed from `src/modules/`; SM and Variables tools removed from `src/index.ts`; test updated. Those modules will be implemented in their own dedicated servers (Phases 15 and 19).

---

- [x] 🟢 **[INFRA] Scaffold bconnect-jobs-mcp** *(DevOpsEngineer)* — deliverable: `bconnect-jobs-mcp/` with jobs-only scope; `jobs.ts` module; `npm install` succeeds

- [x] 🔴 **[TEST] Write assertion: listTools() returns ~24 jobs-only tools** *(TestEngineer)* — deliverable: `bconnect-jobs-mcp/__tests__/server.test.ts`; assert servermanagement and variables tools are NOT present

- [x] 🟢 **[IMPL] src/index.ts registers jobs tools only** *(Developer)* — deliverable: `bconnect-jobs-mcp/src/index.ts`; server name `bconnect-jobs-mcp`; registers only `jobs.ts` tools

- [x] 🔵 **[LINT] npm run build + isolation check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; `listTools()` count ~24; no servermanagement or variables tool names present

---

## ✅ Complete — Phase 14: bconnect-operatingsystems-mcp

**Priority**: MEDIUM
**Depends on**: Phase 8 complete
**Requirement**: REQ-SPLIT-008 — bconnect-operatingsystems-mcp
**Deliverables**: `bconnect-operatingsystems-mcp/` with ~9 tools; clean build; isolation test passing

---

- [x] 🟢 **[INFRA] Scaffold bconnect-operatingsystems-mcp from template** *(DevOpsEngineer)* — deliverable: `bconnect-operatingsystems-mcp/` with full scaffold; copy `operatingsystems.ts` + 26R1 types; `npm install` succeeds

- [x] 🔴 **[TEST] Write assertion: listTools() returns ~9 operatingsystems-mcp tools** *(TestEngineer)* — deliverable: `bconnect-operatingsystems-mcp/__tests__/server.test.ts`; `npm test` → **FAILS**

- [x] 🟢 **[IMPL] Create src/index.ts registering operatingsystems tools** *(Developer)* — deliverable: `bconnect-operatingsystems-mcp/src/index.ts`; server name `bconnect-operatingsystems-mcp`; `npm test` → PASSES

- [x] 🔵 **[LINT] npm run build + tool isolation check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; `listTools()` count ~9

---

## ✅ Complete — Phase 15: bconnect-servermanagement-mcp

**Priority**: HIGH
**Depends on**: Phase 8 complete
**Requirement**: REQ-SPLIT-009 — bconnect-servermanagement-mcp
**Deliverables**: `bconnect-servermanagement-mcp/` with ~30 tools; 26R1 typed (30 ops vs 25 in 25R2); clean build; isolation test passing

---

- [x] 🟢 **[INFRA] Scaffold bconnect-servermanagement-mcp from template** *(DevOpsEngineer)* — deliverable: `bconnect-servermanagement-mcp/` with full scaffold; copy `servermanagement.ts` + 26R1 types; `npm install` succeeds

- [x] 🔴 **[TEST] Write assertion: listTools() returns all ~30 servermanagement-mcp tools** *(TestEngineer)* — deliverable: `bconnect-servermanagement-mcp/__tests__/server.test.ts`; `npm test` → **FAILS**

- [x] 🟢 **[IMPL] Create src/index.ts registering servermanagement tools** *(Developer)* — deliverable: `bconnect-servermanagement-mcp/src/index.ts`; server name `bconnect-servermanagement-mcp`; implement 5 new 26R1 operations; `npm test` → PASSES

- [x] 🔵 **[LINT] npm run build + tool isolation check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; `listTools()` count ~30

---

## ✅ Complete — Phase 16: bconnect-software-mcp

**Priority**: HIGH — significantly expanded in 26R1 (4 → 19 operations)
**Depends on**: Phase 8 complete
**Requirement**: REQ-SPLIT-010 — bconnect-software-mcp
**Deliverables**: `bconnect-software-mcp/` with 19 tools (4 in 25R2 / 19 in 26R1); clean build; 9 tests passing

---

- [x] 🟢 **[INFRA] Scaffold bconnect-software-mcp from template** *(DevOpsEngineer)* — deliverable: `bconnect-software-mcp/` with full scaffold; `software.ts` module + 26R1 types; `npm install` succeeds

- [x] 🔴 **[TEST] Write assertion: listTools() returns software-mcp tools** *(TestEngineer)* — deliverable: `src/__tests__/server.test.ts`; 9 tests covering 25R2 (4 tools) and 26R1 (19 tools); `npm test` → 9/9 PASSING

- [x] 🟢 **[IMPL] Implement software module and register tools in src/index.ts** *(Developer)* — deliverable: `src/modules/software.ts` (19 methods); `src/index.ts` with 4 installed-software + 15 26R1-only bundle/folder tools; `npm test` → PASSES

- [x] 🔵 **[LINT] npm run build + 26R1 expansion check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; 25R2=4 tools / 26R1=19 tools; clean build

---

## ✅ Complete — Phase 17: bconnect-universaldynamicgroups-mcp *(26R1 only)*

**Priority**: HIGH — new module, no existing implementation
**Depends on**: Phase 8 complete; 26R1 types required
**Requirement**: REQ-SPLIT-011 — bconnect-universaldynamicgroups-mcp
**Deliverables**: `bconnect-universaldynamicgroups-mcp/` with 6 tools (26R1 only, 0 in 25R2); clean build; 6 tests passing

---

- [x] 🔴 **[TEST] Write assertion: listTools() returns 6 universaldynamicgroups-mcp tools** *(TestEngineer)* — deliverable: `src/__tests__/server.test.ts`; 6 tests; 25R2=0 tools gate; `npm test` → 6/6 PASSING

- [x] 🟢 **[INFRA] Scaffold bconnect-universaldynamicgroups-mcp from template** *(DevOpsEngineer)* — deliverable: `bconnect-universaldynamicgroups-mcp/` with full scaffold + 26R1 UDG types; `npm install` succeeds

- [x] 🟢 **[IMPL] Implement UDG module and register tools in src/index.ts** *(Developer)* — deliverable: `src/modules/universaldynamicgroups.ts` (6 methods) + `src/index.ts`; server name `bconnect-universaldynamicgroups-mcp`; `npm test` → PASSES

- [x] 🔵 **[LINT] npm run build + 26R1-only gate check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; 26R1=6 tools / 25R2=0 tools; clean build

---

## ✅ Complete — Phase 18: bconnect-updatemanagement-mcp

**Priority**: MEDIUM
**Depends on**: Phase 8 complete
**Requirement**: REQ-SPLIT-012 — bconnect-updatemanagement-mcp
**Deliverables**: `bconnect-updatemanagement-mcp/` with 3 tools; clean build; 5 tests passing

---

- [x] 🟢 **[INFRA] Scaffold bconnect-updatemanagement-mcp from template** *(DevOpsEngineer)* — deliverable: `bconnect-updatemanagement-mcp/` scaffolded; `updatemanagement.ts` module + 26R1 types; `npm install` succeeds

- [x] 🔴 **[TEST] Write assertion: listTools() returns 3 updatemanagement-mcp tools** *(TestEngineer)* — deliverable: `src/__tests__/server.test.ts`; 5 tests; `npm test` → 5/5 PASSING

- [x] 🟢 **[IMPL] Create src/index.ts registering updatemanagement tools** *(Developer)* — deliverable: `src/index.ts`; server name `bconnect-updatemanagement-mcp`; list/get/update WindowsEndpoints; `npm test` → PASSES

- [x] 🔵 **[LINT] npm run build + tool isolation check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; `listTools()` count 3; clean build

---

## ✅ Complete — Phase 19: bconnect-variables-mcp

**Priority**: HIGH
**Depends on**: Phase 8 complete
**Requirement**: REQ-SPLIT-013 — bconnect-variables-mcp
**Deliverables**: `bconnect-variables-mcp/` with 13 tools; clean build; 5 tests passing

---

- [x] 🟢 **[INFRA] Scaffold bconnect-variables-mcp from template** *(DevOpsEngineer)* — deliverable: `bconnect-variables-mcp/` scaffolded; `variables.ts` module + 26R1 types; `npm install` succeeds

- [x] 🔴 **[TEST] Write assertion: listTools() returns 13 variables-mcp tools** *(TestEngineer)* — deliverable: `src/__tests__/server.test.ts`; 5 tests; `npm test` → 5/5 PASSING

- [x] 🟢 **[IMPL] Create src/index.ts registering variables tools** *(Developer)* — deliverable: `src/index.ts`; server name `bconnect-variables-mcp`; 13 tools covering definitions (CRUD) + instances (read/update, 5 scoped variants); `npm test` → PASSES

- [x] 🔵 **[LINT] npm run build + tool isolation check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; `listTools()` count 13; clean build

---

## ⏸️ Postponed — Phase 20: bconnect-v11-mcp (V1.1 Legacy)

**Priority**: POSTPONED — V1.1 server not required at this time (decision: 2026-03-30)
**Depends on**: Phase 8 complete
**Requirement**: REQ-SPLIT-014 — bconnect-v11-mcp
**Deliverables**: `bconnect-v11-mcp/` with ~23 V1.1 tools; BitLocker audit log assertions passing; clean build

---

- [ ] 🟢 **[INFRA] Scaffold bconnect-v11-mcp from template (no OpenAPI types — V1.1 is manually typed)** *(DevOpsEngineer)* — deliverable: `bconnect-v11-mcp/` with scaffold; `.env.example` sets `BCONNECT_AUDIT_LEVEL=security` as recommended default; copy all 6 V1.1 modules; `npm install` succeeds

- [ ] 🔴 **[TEST] Write assertion: listTools() returns all ~23 V1.1 tools** *(TestEngineer)* — deliverable: `bconnect-v11-mcp/__tests__/server.test.ts`; assert all tool names end in `_v1`; assert no V2.0 tools present; `npm test` → **FAILS**

- [ ] 🔴 **[TEST] Write security assertion: BitLocker tools emit [SECURITY AUDIT] log entries** *(SecurityArchitect)* — deliverable: `bconnect-v11-mcp/__tests__/security/bitlocker-audit.test.ts`; mock `audit-logger`; assert `get_bitlocker_recovery_keys_v1`, `get_tpm_owner_passwords_v1`, `get_bitlocker_pins_v1` each trigger audit log with `[SECURITY AUDIT]` prefix; `npm test` → **FAILS**

- [ ] 🟢 **[IMPL] Create src/index.ts registering all V1.1 tools with audit logging** *(Developer)* — deliverable: `bconnect-v11-mcp/src/index.ts`; server name `bconnect-v11-mcp`; register all 6 V1.1 modules; wire AuditLogger to CallTool handler; `npm test` → PASSES (both server and BitLocker audit assertions)

- [ ] 🔵 **[LINT] npm run build + security audit check** *(QualityAssuranceEngineer)* — deliverable: 0 TypeScript errors; `listTools()` count ~23; grep confirms `[SECURITY AUDIT]` in BitLocker handler paths

---

## ✅ Complete — Phase 21: Distribution (Windows .exe + Docker)

**Priority**: HIGH (Windows) / MEDIUM (Docker)
**Depends on**: All server builds (Phases 9–20) complete
**Requirement**: REQ-WIN-001 (Windows Binary), REQ-WIN-002 (Docker)
**Deliverables**: One `.exe` per server + one `Dockerfile` per server; `WINDOWS-DEPLOYMENT.md`; `docker-compose.yml` reference

---

- [x] 🔴 **[TEST] Write assertion: pkg:win exits 0 and produces dist/*.exe for each server** *(TestEngineer)* — deliverable: `build-tests/pkg-output.test.sh`
- [x] 🟢 **[IMPL] Update package.json pkg scripts: node16 → node20, add per-server build targets** *(DevOpsEngineer)* — fixed `bconnect-endpoints-mcp` and `bconnect-jobs-mcp`; added `pkg:win` to all 12 servers
- [x] 🟢 **[IMPL] Generate SHA-256 checksums for all .exe artifacts** *(DevOpsEngineer)* — `scripts/generate-checksums.sh`
- [x] 🟢 **[IMPL] Create Dockerfile for each server (node:20-alpine, non-root)** *(DevOpsEngineer)* — 12 Dockerfiles created
- [x] 🟢 **[IMPL] Create docker-compose.yml reference and WINDOWS-DEPLOYMENT.md** *(DevOpsEngineer)* — delivered
- [x] 🔴 **[TEST] Write smoke test: Docker container starts and responds to MCP handshake** *(SystemTestEngineer)* — `build-tests/docker-smoke.test.sh`
- [x] 🟢 **[IMPL] Validate Docker smoke test passes for representative server** *(SystemTestEngineer)* — PASS; `DOCKER.md` delivered
- [x] 🔵 **[LINT] Distribution build quality gate** *(QualityAssuranceEngineer)* — `build-tests/quality-gate.sh`; 38/38 checks pass

---

## 🟡 Upcoming — Phase 22: Documentation (All Servers)

**Priority**: MEDIUM
**Depends on**: All preceding phases complete (Phases 7–21)
**Requirement**: All implemented requirements (REQ-SPLIT-002 through REQ-SPLIT-014, REQ-SRV-011, REQ-VER-001, REQ-WIN-001/002)
**Deliverables**: `README.md` per server + root `README.md` updated with 13-server architecture; `CLAUDE.md` updated; `CHANGELOG.md` started at `26.1.0`; `CONTRIBUTING.md` with versioning rules

---

- [ ] 📚 **[DOCS] Write README.md for each new server and update root project documentation** *(DocumentationSpecialist)* — deliverable: one `README.md` per server directory (purpose, tool list with R/W annotations, env vars, quick-start, release compatibility); root `README.md` updated with 13-server architecture table, `BCONNECT_RELEASE` usage guide, and compatibility matrix (25R2 ↔ 26R1 server coverage); `CLAUDE.md` updated with correct tool count (196+) and per-server module assignments; `CHANGELOG.md` created with `## [26.1.0]` entry; `CONTRIBUTING.md` updated with bMS-aligned version scheme rules; no doc references the old 5-server grouping

---

## 📝 Planning Notes

Key decisions recorded during planning (2026-03-30):

- **File-based split over functional grouping**: Each OpenAPI spec file maps to one MCP server. This is a cleaner domain model than the old grouping (e.g., jobs+servermanagement+variables) and avoids arbitrary decisions about which modules belong together.
- **26R1 as primary target**: All new servers default to 26R1 types. The `BCONNECT_RELEASE=25R2` env var gates out the two 26R1-only servers (compliance, universaldynamicgroups).
- **Phase 7 is the blocker**: Nothing in Phases 9–20 can start until 26R1 types are generated and the version barrel is in place.
- **Phase 13 (jobs-mcp) replaces old Phase 7**: The previous in-progress `bconnect-jobs-mcp` bundled three spec files (jobs+servermanagement+variables). It must be rebuilt as a jobs-only server per the new architecture.
- **V1.1 server is release-independent**: `bconnect-v11-mcp` does not use OpenAPI types and works identically against both 25R2 and 26R1 bConnect instances.
- **REQ-AUTH-002 (API Key Auth) deferred**: Neither 25R2 nor 26R1 specs define API key authentication — only `basicAuth`. This requirement is blocked on a future bConnect release.
- **MCP_Deployment phases 3–10 remain blocked**: Still requires all split servers to be complete before multi-executable installer and Docker registry work can proceed.

