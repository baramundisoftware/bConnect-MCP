# ADR-001: File-Based MCP Server Split

**Date**: 2026-03-30
**Status**: Accepted (supersedes earlier single-server grouping concept)

---

## Context

The original bConnect-MCP project was a single monolithic MCP server (`src/index.ts`) registering
all baramundi bConnect API tools. As the tool count grew (196 tools across 13 API domains), it
became impractical for AI assistants to load the full server — each tool definition consumes
200–400 tokens in the model context window, making the monolith a ~60 K-token context liability
regardless of which domain the user actually needs.

An earlier split strategy (recorded informally) proposed grouping related domains into 5–6 named
servers (e.g., `bconnect-core`, `bconnect-mgmt`). That grouping was abandoned because it introduced
arbitrary boundaries that diverged from the upstream API domain model, making future spec updates
harder to track.

---

## Decision

**One MCP server per OpenAPI spec file.** The file name (without extension, with `bconnect-`
prefix and `-mcp` suffix) defines the server name and package name.

This produces **13 servers for the 26R1 release** (12 V2.0 servers + 1 V1.1 legacy server):

| Server name | OpenAPI spec file | Ops in spec | Est. tools | Releases |
|---|---|---|---|---|
| `bconnect-activedirectory-mcp` | `activedirectory.json` | 16 | ~16 | 25R2 + 26R1 |
| `bconnect-assets-mcp` | `assets.json` | 26 | ~26 | 25R2 + 26R1 |
| `bconnect-compliance-mcp` | `compliance.json` | 8 | ~8 | **26R1 only** |
| `bconnect-defensecontrol-mcp` | `defensecontrol.json` | 13 | ~13 | 25R2 + 26R1 |
| `bconnect-endpoints-mcp` | `endpoints.json` | 87 | ~50 | 25R2 + 26R1 |
| `bconnect-jobs-mcp` | `jobs.json` | 34 | ~25 | 25R2 + 26R1 |
| `bconnect-operatingsystems-mcp` | `operatingsystems.json` | 9 | ~9 | 25R2 + 26R1 |
| `bconnect-servermanagement-mcp` | `servermanagement.json` | 30 | ~30 | 25R2 + 26R1 |
| `bconnect-software-mcp` | `software.json` | 19 | ~12 | 25R2 + 26R1 |
| `bconnect-universaldynamicgroups-mcp` | `universaldynamicgroups.json` | 6 | ~6 | **26R1 only** |
| `bconnect-updatemanagement-mcp` | `updatemanagement.json` | 3 | ~3 | 25R2 + 26R1 |
| `bconnect-variables-mcp` | `variables.json` | 13 | ~13 | 25R2 + 26R1 |
| `bconnect-v11-mcp` | *(V1.1 legacy, no spec file)* | — | ~23 | 25R2 + 26R1 |

`bconnect-endpoints-mcp` is the **reference implementation** — built in Phase 6, it already follows
the pattern all subsequent servers must replicate.

### Shared infrastructure strategy

Shared infrastructure is **replicated by copy** (not extracted into a shared npm package). Each
server contains its own copy of:

- `src/bconnect-client.ts` — Axios HTTP client, auth, retry, rate limiting, audit logging
- `src/utils/parameter-validator.ts` — input validation framework
- `src/utils/mcp-tool-validation-rules.ts` — per-tool validation rules
- `src/utils/rate-limiter.ts` — token bucket rate limiter
- `src/utils/audit-logger.ts` — configurable audit logger

**Why copy rather than shared package?**
- Avoids npm workspace complexity and cross-server coupling
- Each server can evolve its validation rules independently
- Standalone `.exe` packaging via `pkg` works without workspace resolution
- Simpler CI: each server directory is a self-contained build unit

### Version awareness

Each server reads `BCONNECT_RELEASE` from the environment (`25R2` or `26R1`). Servers built for
both releases implement conditional logic where API behaviour differs. Servers marked `26R1 only`
(`compliance`, `universaldynamicgroups`) will reject startup with a clear error if
`BCONNECT_RELEASE=25R2` is set.

### Tool count accountability (no tool left behind)

All 196 tools from the original monolith must appear in exactly one of the 13 servers:

| Domain origin | Destination server |
|---|---|
| `src/modules/endpoints.ts` (41 tools) | `bconnect-endpoints-mcp` |
| `src/modules/activedirectory.ts` (16 tools) | `bconnect-activedirectory-mcp` |
| `src/modules/operatingsystems.ts` (9 tools) | `bconnect-operatingsystems-mcp` |
| `src/modules/assets.ts` (26 tools) | `bconnect-assets-mcp` |
| `src/modules/defensecontrol.ts` (11→13 tools) | `bconnect-defensecontrol-mcp` |
| `src/modules/jobs.ts` (21 tools) | `bconnect-jobs-mcp` |
| `src/modules/servermanagement.ts` (25→30 tools) | `bconnect-servermanagement-mcp` |
| `src/modules/software.ts` (12 tools) | `bconnect-software-mcp` |
| `src/modules/updatemanagement.ts` (3 tools) | `bconnect-updatemanagement-mcp` |
| `src/modules/variables.ts` (13 tools) | `bconnect-variables-mcp` |
| `src/modules/bitlocker.ts` + V1.1 tools (~23 total) | `bconnect-v11-mcp` |
| net-new: `compliance` (26R1) | `bconnect-compliance-mcp` |
| net-new: `universaldynamicgroups` (26R1) | `bconnect-universaldynamicgroups-mcp` |

No tool is present in more than one server. No tool from the monolith is dropped.

---

## Consequences

**Positive:**
- AI assistants load only the server(s) relevant to their task — typical context footprint drops
  from ~60 K tokens to 3–20 K tokens per loaded server
- Domain alignment with the upstream OpenAPI spec makes API version tracking trivial
- Isolated build and test per server; a broken software build does not block an assets deployment
- Standalone `.exe` per server enables selective installation on Windows endpoints

**Negative / trade-offs:**
- 13 separate `package.json` / `tsconfig.json` files to maintain
- Shared infrastructure duplication — a bug fix in `bconnect-client.ts` must be propagated to all 13 servers
- Claude Desktop / claude-code config entries grow from 1 to 13 server entries
- Users must load the correct server(s); there is no single "do everything" entry point

**Mitigations:**
- `bconnect-server-template/` provides a canonical scaffold; new servers copy from it
- `CONTRIBUTING.md` documents the propagation protocol for shared infra changes
- MCP_Deployment suite installer handles all 13 server entries in Claude Desktop config automatically
