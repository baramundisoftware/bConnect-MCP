# ADR-001: Split Monolithic MCP Server into Per-Spec-File Domain Servers

**Date**: 2026-03-27 (revised 2026-03-30)
**Status**: Accepted (supersedes initial 5-server grouping)

---

## Context

The bConnect-MCP server currently exposes **196 tools** across 18 modules in a single MCP server
process (`src/index.ts`). Each tool definition — comprising its name, description, and
`inputSchema` — consumes approximately 200–400 tokens in the MCP client's context window. With
196 tools loaded, the tool listing alone consumes an estimated **39k–78k tokens** before any
conversation begins.

This creates two practical problems:

1. **Context window exhaustion**: Large language models with bounded context windows (e.g.,
   200k tokens) lose significant capacity for actual conversation content.
2. **Cognitive overload for the model**: Presenting all device-management, security, legacy API,
   and documentation tools simultaneously makes tool selection less precise and increases the
   chance of wrong-tool invocations.

### OpenAPI spec files as the authoritative domain boundary

The baramundi engineering team has already decided the domain model: the V2.0 API is split into
separate OpenAPI spec files under `/home/ansible/MCP/bConnectOpenAPI/{release}/`. Each file
represents a coherent, independently versioned domain. Using spec files as the split boundary
means:

- The split is **objective**: no human judgment call about which modules "feel related".
- Code generation, type generation, and testing are all driven from a single source of truth
  per server.
- Release deltas are explicit: 26R1 adds `compliance.json` and `universaldynamicgroups.json` —
  two new servers appear, zero existing servers change shape.

### Tool count by module (current monolith)

| Module | Tools | API Version |
|---|---|---|
| `endpoints` | 49 | V2.0 |
| `servermanagement` | 25 | V2.0 |
| `jobs` | 21 | V2.0 |
| `assets` | 19 | V2.0 |
| `variables` | 13 | V2.0 |
| `defensecontrol` | 12 | V2.0 |
| `activedirectory` | 10 | V2.0 |
| `operatingsystems` | 9 | V2.0 |
| `documentation-search` | 6 | Local index |
| `forum-search` | 5 | Local index |
| `software` | 4 | V2.0 |
| `updatemanagement` | 3 | V2.0 |
| **Total** | **163** | |

---

## Decision

### 1. One MCP server per OpenAPI spec file

The split strategy is: **one MCP server per OpenAPI spec file**. The file name defines the
server name: `bconnect-<domain>-mcp`.

**Target servers for 26R1** (13 V2.0 servers):

| Server repo | OpenAPI spec file | Ops in spec | Est. tools |
|---|---|---|---|
| `bconnect-activedirectory-mcp` | `activedirectory.json` | 16 | ~16 |
| `bconnect-assets-mcp` | `assets.json` | 26 | ~26 |
| `bconnect-compliance-mcp` | `compliance.json` | 8 | ~8 — **26R1 only** |
| `bconnect-defensecontrol-mcp` | `defensecontrol.json` | 13 | ~13 |
| `bconnect-endpoints-mcp` | `endpoints.json` | 87 | ~50 |
| `bconnect-groups-mcp` | `endpoints.json` (group queries) | 27 | ~27 |
| `bconnect-jobs-mcp` | `jobs.json` | 34 | ~25 |
| `bconnect-operatingsystems-mcp` | `operatingsystems.json` | 9 | ~9 |
| `bconnect-servermanagement-mcp` | `servermanagement.json` | 30 | ~30 |
| `bconnect-software-mcp` | `software.json` | 19 | ~12 |
| `bconnect-universaldynamicgroups-mcp` | `universaldynamicgroups.json` | 6 | ~6 — **26R1 only** |
| `bconnect-updatemanagement-mcp` | `updatemanagement.json` | 3 | ~3 |
| `bconnect-variables-mcp` | `variables.json` | 13 | ~13 |

**Note**: The 25R2 set omits `compliance` and `universaldynamicgroups` (not present in that
release). The spec file names differ between releases (25R2 uses `bConnect_` prefix; 26R1 uses
lowercase).

**Total across all servers**: ~229 tools.

### 2. Repo naming convention

```
bconnect-<domain>-mcp
```

The `bconnect-` prefix identifies the product domain; the `-mcp` suffix identifies the
repository type. The middle segment is the OpenAPI spec filename (without extension), in
lowercase with no underscores or camelCase.

### 3. Shared infrastructure strategy: copy, do not package

The monolith shares three infrastructure files across all modules:

| File | Purpose |
|---|---|
| `src/bconnect-client.ts` | Axios HTTP client singleton with auth, TLS, rate limiting, audit log |
| `src/utils/parameter-validator.ts` | Input validation helper used by every module |
| `src/utils/mcp-tool-validation-rules.ts` | Per-tool validation rule definitions |

**Decision**: Copy these files into each new repository rather than extracting them into a
shared npm package.

**Rationale**:

- A shared package introduces release coordination overhead: all servers must be updated
  whenever a shared dependency changes.
- The files are stable and small. `bconnect-client.ts` is ~150 lines.
- Each server can evolve its validation rules independently.
- `bconnect-docu-mcp` (documentation) needs no HTTP client at all.

**Future consideration**: Once all servers are stable and cross-server changes emerge, extract
`bconnect-client.ts` into an `@baramundi/bconnect-client` npm package.

### 4. Superseded: initial 5-server grouping

The original ADR (2026-03-27) grouped modules by domain affinity into 5 servers:

| Old server | Modules bundled |
|---|---|
| `bconnect-endpoints-mcp` | endpoints + activedirectory + operatingsystems |
| `bconnect-jobs-mcp` | jobs + servermanagement + variables |
| `bconnect-security-mcp` | defensecontrol + assets + software + updatemanagement |
| `bconnect-docu-mcp` | documentation + forum + known-issues |
| `bconnect-docu-mcp` | documentation + forum + known-issues |

This grouping was subjective (human judgment calls about affinity) and did not align with the
API's own domain model. The `bconnect-endpoints-mcp` and `bconnect-jobs-mcp` directories were
initially scaffolded under this approach and have been rescoped (2026-03-30):

- `bconnect-endpoints-mcp`: activedirectory and operatingsystems modules removed; now contains
  only the `endpoints` module.
- `bconnect-jobs-mcp`: servermanagement and variables modules removed; now contains only the
  `jobs` module.

The modules removed from these two directories will be implemented in their own dedicated
servers (Phases 9, 14, 15, 19 in Tasks.md).

### 5. The monolithic server remains operational during the transition

The existing `bConnect-MCP` monolith (`src/index.ts`) **is not decommissioned until all domain
servers are independently stable** and covered by the same level of tests currently in the
monolith.

Migration criteria for cutting over from the monolith:

1. All new repositories exist with their modules migrated.
2. Each new server has passing unit tests equivalent to the monolith's `__tests__/` coverage.
3. Each new server has been smoke-tested end-to-end against a live bConnect environment.
4. MCP client configurations have been updated to reference the new servers.
5. A 2-week parallel operation period completes without regression reports.

---

## Consequences

### Positive

- **Reduced context consumption**: Each server exposes 3–50 tools instead of 196, saving
  ~25k–70k tokens per session in tool listing overhead.
- **Objective domain boundaries**: Spec files are the authoritative source — no human
  judgment required for module assignment.
- **Release deltas are explicit**: New 26R1 modules appear as entirely new servers; no
  existing server is reshaped.
- **Independent deployability**: Each server can be access-restricted independently.
- **Focused toolsets**: Each server serves one API domain; tool selection by the model is
  precise within a narrow, coherent set.

### Negative / Trade-offs

- **Increased operational surface**: Administrators must configure and maintain 13 server
  processes instead of 1. Claude Desktop and claude-code configurations become more complex.
- **Credential duplication**: Each V2.0 server needs its own `.env` with credentials.
- **Infrastructure file duplication**: Copying `bconnect-client.ts` and `utils/` into 12 repos
  means bug fixes must be applied to 12 files.
- **Migration effort**: Each module must be extracted, tested in isolation, and validated
  against a live environment before the monolith can be decommissioned.

---

## Related requirements

- REQ-SPLIT-001 — Multi-Server Architecture (File-Based Split)
- REQ-SPLIT-002 — bconnect-activedirectory-mcp
- REQ-SPLIT-003 — bconnect-assets-mcp
- REQ-SPLIT-004 — bconnect-compliance-mcp (26R1 only)
- REQ-SPLIT-005 — bconnect-defensecontrol-mcp
- REQ-SPLIT-006 — bconnect-endpoints-mcp
- REQ-SPLIT-007 — bconnect-jobs-mcp
- REQ-SPLIT-008 — bconnect-operatingsystems-mcp
- REQ-SPLIT-009 — bconnect-servermanagement-mcp
- REQ-SPLIT-010 — bconnect-software-mcp
- REQ-SPLIT-011 — bconnect-universaldynamicgroups-mcp (26R1 only)
- REQ-SPLIT-012 — bconnect-updatemanagement-mcp
- REQ-SPLIT-013 — bconnect-variables-mcp
