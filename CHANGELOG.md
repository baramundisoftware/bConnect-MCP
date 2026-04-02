# Changelog

All notable changes to this project are documented in this file.

The version scheme follows **baramundi Management Suite year.release.patch** format:
- `26.1.x` — baramundi 26R1
- `25.2.x` — baramundi 25R2

---

## [26.1.0] — 2026-04-03

### Added

**13 domain-specific MCP servers** replacing the previous single-server architecture.
100% coverage of the bConnect 26R1 V2.0 API (264/264 endpoints).

| Server | Tools (26R1) | Tools (25R2) | bMS |
|--------|:---:|:---:|-----|
| bconnect-endpoints-mcp | 64 | 58 | 25R2 + 26R1 |
| bconnect-servermanagement-mcp | 30 | 30 | 25R2 + 26R1 |
| bconnect-assets-mcp | 26 | 24 | 25R2 + 26R1 |
| bconnect-groups-mcp | 27 | 27 | 25R2 + 26R1 |
| bconnect-jobs-mcp | 34 | 34 | 25R2 + 26R1 |
| bconnect-software-mcp | 19 | 19 | 25R2 + 26R1 |
| bconnect-activedirectory-mcp | 17 | 17 | 25R2 + 26R1 |
| bconnect-variables-mcp | 12 | 12 | 25R2 + 26R1 |
| bconnect-defensecontrol-mcp | 13 | 11 | 25R2 + 26R1 |
| bconnect-operatingsystems-mcp | 9 | 9 | 25R2 + 26R1 |
| bconnect-compliance-mcp | 8 | — | 26R1 only |
| bconnect-universaldynamicgroups-mcp | 6 | — | 26R1 only |
| bconnect-updatemanagement-mcp | 3 | 3 | 25R2 + 26R1 |
| **Total** | **268** | **244** | |

**268 tools in 26R1 configuration** (244 when targeting 25R2)

**Gap closure** (Phases 24–26 — 2026-04-01 to 2026-04-03):
- `bconnect-endpoints-mcp`: +17 tools (Android, iOS, Network, Unmanaged endpoints, EntraID, Industrial)
- `bconnect-groups-mcp`: new 13th server — 27 group-scoped read-only endpoint queries
- `bconnect-jobs-mcp`: +9 tools (folder navigation, kiosk-release context queries, group-scoped instances)

**bMS-aligned versioning** (Phase 27 — 2026-04-03): all 13 servers bumped from `1.0.0` → `26.1.0`.

**26R1 type generation**: All servers use TypeScript types generated from 26R1 OpenAPI specs. A `BCONNECT_RELEASE` environment variable gates 26R1-only operations when connecting to a 25R2 instance.

**Production hardening** (applied to all servers):
- Token bucket rate limiter (`BCONNECT_RATE_LIMIT_ENABLED`)
- Configurable audit logger (`BCONNECT_AUDIT_LEVEL`: `none` | `info` | `verbose`)
- LRU response cache with TTL
- Concurrent batch execution with exponential backoff
- Input validation for all tool parameters
- TLS CA certificate support (`BCONNECT_CA_CERT_PATH`)

**Distribution**:
- Docker images (one per server, `node:20-alpine`, non-root)
- Linux tarball builds for x86_64 and aarch64
- Windows `.exe` binaries via `pkg`

### Architecture

Each OpenAPI spec file now maps to exactly one MCP server (REQ-SPLIT-001). This replaces the previous grouping where one server handled multiple API domains.

### Deprecated

The single `bconnect-mcp-server` (previously `src/index.ts` with 117 tools) is superseded by the 12-server suite. The V1.1 legacy server (`bconnect-v11-mcp`) is planned for a future release.
