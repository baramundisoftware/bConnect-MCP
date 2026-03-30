# Changelog

All notable changes to this project are documented in this file.

The version scheme follows **baramundi Management Suite year.release.patch** format:
- `26.1.x` — baramundi 26R1
- `25.2.x` — baramundi 25R2

---

## [26.1.0] — 2026-03-31

### Added

**12 domain-specific MCP servers** replacing the previous single-server architecture:

| Server | Tools | bMS |
|--------|-------|-----|
| bconnect-endpoints-mcp | 47 | 25R2 + 26R1 |
| bconnect-servermanagement-mcp | 30 | 25R2 + 26R1 |
| bconnect-assets-mcp | 26 | 25R2 + 26R1 |
| bconnect-jobs-mcp | 24 | 25R2 + 26R1 |
| bconnect-software-mcp | 19 | 25R2 + 26R1 |
| bconnect-activedirectory-mcp | 16 | 25R2 + 26R1 |
| bconnect-variables-mcp | 13 | 25R2 + 26R1 |
| bconnect-defensecontrol-mcp | 13 | 25R2 + 26R1 |
| bconnect-operatingsystems-mcp | 9 | 25R2 + 26R1 |
| bconnect-compliance-mcp | 8 | 26R1 only |
| bconnect-universaldynamicgroups-mcp | 6 | 26R1 only |
| bconnect-updatemanagement-mcp | 3 | 25R2 + 26R1 |

**Total: 212 tools** (106 read, 106 write)

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
