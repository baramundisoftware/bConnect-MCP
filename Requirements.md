# bConnect-MCP — Project Requirements

The bConnect-MCP project exposes the baramundi bConnect REST API as MCP (Model Context Protocol) tools
so that AI assistants (Claude and compatible agents) can manage endpoints, jobs, assets, Active Directory
objects, and related infrastructure through natural-language interaction.

**Persona**: Senior IT administrator using an AI assistant to query, configure, and
automate device management in a baramundi Management Suite environment.

**API Versions covered**: V2.0 (primary, OpenAPI-spec-backed)
**bConnect Releases supported**: 25R2 and 26R1 (see REQ-SRV-011 for version-awareness details)
**Coverage target**: 100% of the bConnect 26R1 V2.0 API (264 endpoints across 12 OpenAPI specs)

**MCP Server entry point**: `build/index.js` (compiled from `src/index.ts`)

**Architecture principle — Context Efficiency**:
Each MCP tool definition consumes ~200–400 tokens in the LLM's context window. With 13 V2.0 servers
(~253 tools), loading all servers simultaneously costs ~48K tokens (~24% of a 200K context). The split
architecture allows administrators to connect only the servers relevant to their current task:

| Loading profile | Servers | Tools | Context cost | Covers |
|----------------|---------|-------|-------------|--------|
| Daily Operations | endpoints + defensecontrol + updatemanagement | ~69 | ~10.5K (5%) | Endpoint overview, security, patches |
| Software Deployment | endpoints + jobs + software | ~96 | ~16K (8%) | Find targets, deploy, track |
| Security Audit | defensecontrol + compliance + updatemanagement | ~27 | ~6K (3%) | BitLocker, Defender, compliance |
| Fleet Reporting | endpoints + groups + activedirectory | ~92 | ~16K (8%) | Endpoints by any group type or AD user |
| Infrastructure | servermanagement | ~31 | ~4K (2%) | Server health, microservices |

The **bconnect-groups-mcp** server is a pragmatic addition: it absorbs the 27 "list endpoints by group
type" API endpoints that would otherwise bloat the endpoints server. Admins who need group-based queries
add it; the 90% who don't, save ~5K tokens of context.

---

## Project-Level Requirements

### REQ-SRV-001 — MCP Server Identity

**Status**: COMPLETED ✅

**Description**: The server shall identify itself with a fixed name and version in the MCP handshake.

**Implementation**:
- Server name: per-domain (e.g. `bconnect-endpoints-mcp`, `bconnect-jobs-mcp`, …)
- Server version: `26.1.0` (bMS-aligned scheme per REQ-VER-001)
- MCP SDK: `@modelcontextprotocol/sdk`
- Capabilities advertised: `{ tools: {} }`

---

### REQ-SRV-002 — Transport Layer

**Status**: COMPLETED ✅

**Description**: The server shall communicate over stdio so it can be launched as a subprocess by any
MCP-compatible host (Claude Desktop, Claude Code, custom hosts).

**Implementation**:
- Transport: `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
- No HTTP/SSE transport is required at this time

---

### REQ-SRV-003 — Authentication

**Status**: COMPLETED ✅

**Description**: The server shall authenticate against the baramundi bConnect REST API using HTTP Basic
Authentication. Credentials must not be hard-coded; they are read from environment variables at startup.
The server shall fail fast if credentials are absent.

**Implementation**:
- `BCONNECT_USERNAME` — required, username for bConnect API
- `BCONNECT_PASSWORD` — required, password for bConnect API
- `BCONNECT_BASE_URL` — optional, defaults to `https://bms-win22srv:444/bconnect`
- `NODE_TLS_REJECT_UNAUTHORIZED` — optional, set to `"0"` to disable TLS verification (dev only)

**Security Note**: `NODE_TLS_REJECT_UNAUTHORIZED=0` must never be set in production.

---

### REQ-SRV-004 — Input Validation

**Status**: COMPLETED ✅

**Description**: Every MCP tool call shall validate its parameters before forwarding to the API. Invalid
input shall produce a clear MCP error rather than a failed API request.

**Implementation**:
- `src/utils/parameter-validator.ts` — 298-line validation utility
- `src/utils/mcp-tool-validation-rules.ts` — 546+ lines of per-tool validation rules
- Validation covers: GUID format, pagination ranges, enum values, required fields, string lengths
- Security: prevents injection, path traversal, and DoS via oversized inputs

---

### REQ-SRV-005 — Rate Limiting

**Status**: COMPLETED ✅

**Description**: The HTTP client shall support configurable rate limiting using a token bucket algorithm
to prevent API throttling.

**Implementation**:
- `RateLimiter` class in `src/` with configurable `maxRequests` and `windowMs`
- Default: 100 requests/minute (disabled by default for backward compatibility)
- Adds `X-RateLimit-*` headers to responses

---

### REQ-SRV-006 — Audit Logging

**Status**: COMPLETED ✅

**Description**: All API operations shall be loggable for compliance purposes. Security-sensitive
operations (BitLocker secrets, TPM passwords, PINs) shall be flagged with `[SECURITY AUDIT]` prefix.

**Implementation**:
- `AuditLogger` class with levels: `'all'`, `'write'`, `'security'`, `'none'`
- Default: `'none'` (disabled for backward compatibility)
- Custom log handler support for Splunk, ELK, and external systems

---

### REQ-SRV-007 — Response Caching

**Status**: COMPLETED ✅

**Description**: GET responses may be cached using an LRU cache with TTL to reduce API load.

**Implementation**:
- `ResponseCache` class with LRU eviction, configurable TTL (default: 5 minutes)
- Default: disabled; enabled via `config.cache.enabled = true`
- Automatic cache invalidation on write operations (POST, PATCH, DELETE)
- `X-Cache: HIT|MISS` headers for visibility

---

### REQ-SRV-008 — Batch Operations

**Status**: COMPLETED ✅

**Description**: The client shall support executing multiple API operations concurrently with
configurable concurrency limits and retry logic.

**Implementation**:
- `BatchOperations` class, default concurrency: 5
- Exponential backoff retry logic
- Progress callbacks: total, completed, succeeded, failed, percentage

---

### REQ-SRV-010 — Tool Count Target

**Status**: IN PROGRESS 🚧 (280 of ~292 target tools implemented)

**Description**: The MCP servers shall collectively expose tools covering 100% of the bConnect 26R1
V2.0 API (264 endpoints). Split servers currently have 280 tools.

**Current**: 280 tools across 13 V2.0 split servers (100% of 26R1 V2.0 API)
**Target**: 100% of 26R1 V2.0 API

**Original monolith distribution by module**:
| Module | Tools | API |
|--------|-------|-----|
| endpoints | 49 | V2.0 |
| servermanagement | 25 | V2.0 |
| jobs | 21 | V2.0 |
| assets | 19 | V2.0 |
| variables | 13 | V2.0 |
| defensecontrol | 12 | V2.0 |
| activedirectory | 10 | V2.0 |
| operatingsystems | 9 | V2.0 |
| documentation-search | 6 | Docu |
| forum-search | 5 | Docu |
| software | 4 | V2.0 |
| updatemanagement | 3 | V2.0 |
| **Total** | **163** | |

---

### REQ-SRV-011 — bConnect Version Awareness

**Status**: COMPLETED ✅ (implemented in Phases 7–26; `BCONNECT_RELEASE` env var gates 26R1-only servers)

**Description**: The MCP server infrastructure shall be version-aware, supporting two distinct
bConnect release series: **25R2** and **26R1**. Each release has its own set of OpenAPI specs
located at `/home/ansible/MCP/bConnectOpenAPI/{release}/`. The server shall declare which
bConnect release it targets and load only the OpenAPI types for that release.

**Supported releases**:
| Release | Spec path | API modules |
|---------|-----------|-------------|
| 25R2 | `/home/ansible/MCP/bConnectOpenAPI/25R2/` | activedirectory, assets, defensecontrol, endpoints, jobs, operatingsystems, servermanagement, software, updatemanagement, variables (10 files) |
| 26R1 | `/home/ansible/MCP/bConnectOpenAPI/26R1/` | activedirectory, assets, **compliance** *(new)*, defensecontrol, endpoints, jobs, operatingsystems, servermanagement, software, **universaldynamicgroups** *(new)*, updatemanagement, variables (12 files) |

**Requirements**:
- The target release (25R2 or 26R1) shall be configurable via environment variable `BCONNECT_RELEASE` (values: `25R2`, `26R1`; default: `26R1`)
- Each MCP server module shall document which releases it supports
- Modules only present in 26R1 (`compliance`, `universaldynamicgroups`) shall be excluded when `BCONNECT_RELEASE=25R2`
- OpenAPI-generated TypeScript types shall be generated from the correct release's spec file
- The MCP server identity string shall include the release (e.g., `bconnect-mcp-server/26R1`)

**Security note**: Version mismatch between server and bConnect instance shall produce a clear
error message at startup, not silent degradation.

**Priority**: HIGH

---

### REQ-SPLIT-001 — Multi-Server Architecture (Spec-Based Split + Pragmatic Groups Server)

**Status**: COMPLETED ✅ (12 spec-based servers built; groups server PLANNED)

**Description**: The single monolithic MCP server (196 tools, ~39K–78K tokens) has been split into
dedicated servers, one per OpenAPI spec file, plus one pragmatic cross-spec server for group-scoped
endpoint queries. This separation maps to the baramundi API domain model and allows AI assistants to
load only the servers relevant to their current task.

**Split strategy**: One MCP server per OpenAPI spec file (12 servers), plus `bconnect-groups-mcp`
which absorbs the "list endpoints by group type" endpoints from `endpoints.json`. This is a deliberate
exception to the one-spec-one-server rule — it keeps the endpoints server lean (daily use) while
making group-based reporting available on demand.

**Target servers for 26R1** (13 V2.0 servers):

| Server name | Source | Tools | Context tokens | Status |
|-------------|--------|-------|---------------|--------|
| `bconnect-activedirectory-mcp` | `activedirectory.json` | 17 | ~4,500 | ✅ Done |
| `bconnect-assets-mcp` | `assets.json` | 26 | ~5,300 | ✅ Done |
| `bconnect-compliance-mcp` | `compliance.json` | 8 | ~2,200 | ✅ Done (26R1 only) |
| `bconnect-defensecontrol-mcp` | `defensecontrol.json` | 13 | ~3,000 | ✅ Done |
| `bconnect-endpoints-mcp` | `endpoints.json` (core) | 64 | ~8,500 | ✅ Done (64 in 26R1, 58 in 25R2) |
| `bconnect-groups-mcp` | `endpoints.json` (group queries) | 27 | ~5,000 | ✅ Done |
| `bconnect-jobs-mcp` | `jobs.json` | 33 | ~6,200 | ✅ Done |
| `bconnect-operatingsystems-mcp` | `operatingsystems.json` | 9 | ~2,000 | ✅ Done |
| `bconnect-servermanagement-mcp` | `servermanagement.json` | 30 | ~4,200 | ✅ Done |
| `bconnect-software-mcp` | `software.json` | 19 | ~4,500 | ✅ Done |
| `bconnect-universaldynamicgroups-mcp` | `universaldynamicgroups.json` | 6 | ~1,800 | ✅ Done (26R1 only) |
| `bconnect-updatemanagement-mcp` | `updatemanagement.json` | 3 | ~900 | ✅ Done |
| `bconnect-variables-mcp` | `variables.json` | 12 | ~3,100 | ✅ Done |
| **Total** | | **~269** | **~51,200** | |

**Coverage target**: With all 13 V2.0 servers, the bConnect 26R1 V2.0 API is **100% covered**
(264/264 endpoints). No API endpoint is left without an MCP tool.

**Why a separate groups server?** The `endpoints.json` spec defines 95 endpoints. Of these, 27 are
"list endpoints by {Static Group | Dynamic Group | Universal Dynamic Group | AD User}" variants —
one per endpoint type per group type. These are read-only convenience queries that a senior admin uses
only when doing group-based reporting. Loading them alongside the core endpoint CRUD tools wastes
~5,000 tokens in the 90% of sessions that don't need group queries. The groups server exists so that
context efficiency and API completeness are not in conflict.

**Shared infrastructure** (copied into each server):
- `src/bconnect-client.ts` — HTTP client + auth + version detection
- `src/utils/parameter-validator.ts` — input validation
- `src/utils/mcp-tool-validation-rules.ts` — per-tool validation rules
- `.env` — credentials + `BCONNECT_RELEASE` setting

**Note**: The 25R2 set omits `compliance` and `universaldynamicgroups` (not present in that release).
The spec file names differ between releases (25R2 uses `bConnect_` prefix; 26R1 uses lowercase).

**Priority**: HIGH

---

### REQ-SPLIT-002 — bconnect-activedirectory-mcp

**Status**: COMPLETED ✅

**Description**: Dedicated MCP server for Active Directory integration. Covers AD users, groups,
organizational units, and generic AD object lookup.

**OpenAPI spec**: `activedirectory.json` (25R2: `bConnect_ActiveDirectory.json`)
**Releases**: 25R2 + 26R1
**Est. tools**: ~16
**Priority**: HIGH

---

### REQ-SPLIT-003 — bconnect-assets-mcp

**Status**: COMPLETED ✅

**Description**: Dedicated MCP server for asset lifecycle management. Covers asset CRUD, asset
types, asset stock, and folder management.

**OpenAPI spec**: `assets.json` (25R2: `bConnect_Assets.json`)
**Releases**: 25R2 + 26R1 (26R1 adds 2 operations: 24 → 26)
**Est. tools**: ~26
**Priority**: HIGH

---

### REQ-SPLIT-004 — bconnect-compliance-mcp

**Status**: COMPLETED ✅

**Description**: Dedicated MCP server for compliance management. New in 26R1 — no equivalent in 25R2.
Covers compliance rules, violation queries, and remediation workflows.

**OpenAPI spec**: `compliance.json`
**Releases**: 26R1 only
**Est. tools**: ~8
**Priority**: HIGH

---

### REQ-SPLIT-005 — bconnect-defensecontrol-mcp

**Status**: COMPLETED ✅

**Description**: Dedicated MCP server for Windows Defender and security posture. Covers Defender
threats by endpoint/group, Defender Windows endpoint list, local admin accounts, and LAPS.

**OpenAPI spec**: `defensecontrol.json` (25R2: `bConnect_DefenseControl.json`)
**Releases**: 25R2 + 26R1 (26R1 adds 2 operations: 11 → 13)
**Est. tools**: ~13
**Priority**: HIGH

---

### REQ-SPLIT-006 — bconnect-endpoints-mcp

**Status**: COMPLETED ✅ (64 tools in 26R1, 58 tools in 25R2)

**Description**: Dedicated MCP server for endpoint lifecycle management. Covers all device types
(Windows, Linux, Mac, Android, iOS, Industrial, Network, Unmanaged), logical group management,
enrollment workflows, maintenance windows, and EntraID data. Group-scoped listing endpoints
("list endpoints by static/dynamic/UDG/AD user") are handled by `bconnect-groups-mcp` (REQ-SPLIT-015)
to keep this server lean for daily use.

**OpenAPI spec**: `endpoints.json` (25R2: `bConnect_Endpoints.json`)
**Releases**: 25R2 + 26R1
**Tools**: 64 (26R1) / 58 (25R2) — 26R1-only tools: Android detail, iOS CRUD, Unmanaged, EntraID
**Priority**: HIGH

**Tools added** (17 — completed in Phase 24):

| Tool name | Method | Endpoint | Why needed |
|-----------|--------|----------|------------|
| `list_android_endpoints` | GET | /v2.0/AndroidEndpoints | Fleet visibility parity with Windows/Linux/Mac |
| `get_android_endpoint` | GET | /v2.0/AndroidEndpoints/{id} | Detail view for Android devices |
| `list_ios_endpoints` | GET | /v2.0/IosEndpoints | Fleet visibility for iOS devices |
| `get_ios_endpoint` | GET | /v2.0/IosEndpoints/{id} | Detail view for iOS devices |
| `create_ios_endpoint` | POST | /v2.0/IosEndpoints | iOS device onboarding |
| `update_ios_endpoint` | PATCH | /v2.0/IosEndpoints/{id} | iOS device management |
| `delete_ios_endpoint` | DELETE | /v2.0/IosEndpoints/{id} | iOS device lifecycle |
| `list_network_endpoints` | GET | /v2.0/NetworkEndpoints | Network device inventory |
| `get_network_endpoint` | GET | /v2.0/NetworkEndpoints/{id} | Network device details |
| `list_unmanaged_endpoints` | GET | /v2.0/UnmanagedEndpoints | **Security**: find rogue devices (26R1) |
| `get_unmanaged_endpoint` | GET | /v2.0/UnmanagedEndpoints/{id} | Inspect unmanaged device (26R1) |
| `delete_unmanaged_endpoint` | DELETE | /v2.0/UnmanagedEndpoints/{id} | Clean up unmanaged device (26R1) |
| `get_maintenance_window_for_endpoint` | GET | /v2.0/Endpoints/{id}/MaintenanceWindow | Fix asymmetry: can write but not read |
| `get_maintenance_window_for_logical_group` | GET | /v2.0/LogicalGroups/{id}/MaintenanceWindow | Fix asymmetry: can write but not read |
| `get_entra_id_data` | GET | /v2.0/EntraIdData/{deviceId} | Entra ID device info (26R1) |
| `link_entra_id_data` | POST | /v2.0/Endpoints/{id}/EntraIdData | Link Entra ID to endpoint (26R1) |
| `unlink_entra_id_data` | DELETE | /v2.0/Endpoints/{id}/EntraIdData | Unlink Entra ID from endpoint (26R1) |

**Not in this server** (moved to `bconnect-groups-mcp`):
- All "list endpoints by Static Group" (7 endpoint types)
- All "list endpoints by Dynamic Group" (2 endpoint types)
- All "list endpoints by Universal Dynamic Group" (7 endpoint types)
- All "list endpoints by AD User" (6 endpoint types)
- "list endpoints by Logical Group" for non-core types (Android, iOS, Linux, Mac, Network = 5)

---

### REQ-SPLIT-007 — bconnect-jobs-mcp

**Status**: COMPLETED ✅ (33 tools — Phase 26)

**Description**: Dedicated MCP server for job automation. Covers job definitions, job instances,
job folders, kiosk job releases, and group job assignments.

**OpenAPI spec**: `jobs.json` (25R2: `bConnect_Jobs.json`)
**Releases**: 25R2 + 26R1 (operation count identical: 34)
**Tools**: 33 (9 added in Phase 26 from baseline of 24/25)
**Priority**: HIGH

**Tools added in Phase 26** (9):

| Tool name | Method | Endpoint | Why needed |
|-----------|--------|----------|------------|
| `list_job_folders` | GET | /v2.0/Folders | Navigate job folder tree |
| `get_job_folder` | GET | /v2.0/Folders/{id} | Get folder details |
| `list_job_subfolders` | GET | /v2.0/Folders/{folderId}/Folders | Browse folder hierarchy |
| `list_kiosk_releases_by_job_definition` | GET | /v2.0/JobDefinitions/{id}/KioskReleases | Find kiosk releases for a job |
| `list_kiosk_releases_by_endpoint` | GET | /v2.0/Endpoints/{id}/KioskReleases | Find kiosk releases available to endpoint |
| `list_kiosk_releases_by_ad_object` | GET | /v2.0/ADObjects/{id}/KioskReleases | Find kiosk releases for AD user |
| `list_kiosk_releases_by_logical_group` | GET | /v2.0/LogicalGroups/{id}/KioskReleases | Find kiosk releases for group |
| `list_job_instances_by_static_group` | GET | /v2.0/StaticGroups/{id}/JobInstances | Job status for static group members |
| `list_job_instances_by_dynamic_group` | GET | /v2.0/DynamicGroups/{id}/JobInstances | Job status for dynamic group members |

---

### REQ-SPLIT-008 — bconnect-operatingsystems-mcp

**Status**: COMPLETED ✅

**Description**: Dedicated MCP server for OS image management. Covers OS folders, Windows OS
endpoint records, and DIP (Deployment Image Package) status.

**OpenAPI spec**: `operatingsystems.json` (25R2: `bConnect_OperatingSystems.json`)
**Releases**: 25R2 + 26R1 (operation count identical: 9)
**Est. tools**: ~9
**Priority**: MEDIUM

---

### REQ-SPLIT-009 — bconnect-servermanagement-mcp

**Status**: COMPLETED ✅

**Description**: Dedicated MCP server for baramundi server infrastructure management. Covers the
management server, microservices, gateways, VPN appliances, cloud connectors, PXE relays,
security groups/profiles, and object permissions.

**OpenAPI spec**: `servermanagement.json` (25R2: `bConnect_ServerManagement.json`)
**Releases**: 25R2 + 26R1 (26R1 adds 5 operations: 25 → 30)
**Est. tools**: ~30
**Priority**: HIGH

---

### REQ-SPLIT-010 — bconnect-software-mcp

**Status**: COMPLETED ✅

**Description**: Dedicated MCP server for software inventory. Covers installed Windows software
queries by endpoint, logical group, and Universal Dynamic Group. Significantly expanded in 26R1.

**OpenAPI spec**: `software.json` (25R2: `bConnect_Software.json`)
**Releases**: 25R2 + 26R1 (26R1 adds 15 operations: 4 → 19)
**Est. tools**: ~12 (26R1); ~4 (25R2)
**Priority**: HIGH

---

### REQ-SPLIT-011 — bconnect-universaldynamicgroups-mcp

**Status**: COMPLETED ✅

**Description**: Dedicated MCP server for Universal Dynamic Groups (UDGs). New in 26R1 — no
equivalent in 25R2. UDGs are dynamic membership groups based on filter criteria.

**OpenAPI spec**: `universaldynamicgroups.json`
**Releases**: 26R1 only
**Est. tools**: ~6
**Priority**: HIGH

---

### REQ-SPLIT-012 — bconnect-updatemanagement-mcp

**Status**: COMPLETED ✅

**Description**: Dedicated MCP server for Windows Update management. Covers Windows Update
endpoint list and status queries.

**OpenAPI spec**: `updatemanagement.json` (25R2: `bConnect_UpdateManagement.json`)
**Releases**: 25R2 + 26R1 (operation count identical: 3)
**Est. tools**: ~3
**Priority**: MEDIUM

---

### REQ-SPLIT-013 — bconnect-variables-mcp

**Status**: COMPLETED ✅

**Description**: Dedicated MCP server for variable management. Covers variable definitions,
variable instances, and variables scoped to endpoints, groups, AD objects, applications, and jobs.

**OpenAPI spec**: `variables.json` (25R2: `bConnect_Variables.json`)
**Releases**: 25R2 + 26R1 (operation count identical: 13)
**Est. tools**: ~13
**Priority**: HIGH

---

### REQ-SPLIT-015 — bconnect-groups-mcp (Cross-Spec Group Query Server)

**Status**: COMPLETED ✅ (27 tools — Phase 25)

**Description**: Dedicated MCP server for listing endpoints scoped to specific group types (Static
Groups, Dynamic Groups, Universal Dynamic Groups) and AD Users. This is a pragmatic exception to the
one-spec-one-server rule: these 27 endpoints live in `endpoints.json` but are extracted into their own
server to keep `bconnect-endpoints-mcp` lean for daily use.

**Rationale**: The `endpoints.json` spec defines 95 endpoints. Of these, 27 are "list {endpoint type}
by {group type}" — one per combination of 7 endpoint types × 4 group scopes (minus some that don't
exist). A senior admin uses these only for group-based reporting or auditing. Loading them in every
session wastes ~5,000 tokens. Extracting them gives admins a choice: connect `bconnect-groups-mcp`
when doing fleet reporting, skip it otherwise.

**Source endpoints from `endpoints.json`**:
- No separate OpenAPI spec — endpoints are carved out from `endpoints.json`
**Releases**: 25R2 + 26R1
**Est. tools**: 27
**Priority**: MEDIUM

**Tools** (27 — all read-only):

| Tool name | Method | Endpoint |
|-----------|--------|----------|
| **By Logical Group (non-core types)** | | |
| `list_android_endpoints_by_logical_group` | GET | /v2.0/LogicalGroups/{id}/AndroidEndpoints |
| `list_ios_endpoints_by_logical_group` | GET | /v2.0/LogicalGroups/{id}/IosEndpoints |
| `list_linux_endpoints_by_logical_group` | GET | /v2.0/LogicalGroups/{id}/LinuxEndpoints |
| `list_mac_endpoints_by_logical_group` | GET | /v2.0/LogicalGroups/{id}/MacEndpoints |
| `list_network_endpoints_by_logical_group` | GET | /v2.0/LogicalGroups/{id}/NetworkEndpoints |
| **By Static Group** | | |
| `list_endpoints_by_static_group` | GET | /v2.0/StaticGroups/{id}/Endpoints |
| `list_windows_endpoints_by_static_group` | GET | /v2.0/StaticGroups/{id}/WindowsEndpoints |
| `list_android_endpoints_by_static_group` | GET | /v2.0/StaticGroups/{id}/AndroidEndpoints |
| `list_ios_endpoints_by_static_group` | GET | /v2.0/StaticGroups/{id}/IosEndpoints |
| `list_linux_endpoints_by_static_group` | GET | /v2.0/StaticGroups/{id}/LinuxEndpoints |
| `list_mac_endpoints_by_static_group` | GET | /v2.0/StaticGroups/{id}/MacEndpoints |
| `list_network_endpoints_by_static_group` | GET | /v2.0/StaticGroups/{id}/NetworkEndpoints |
| **By Dynamic Group** | | |
| `list_endpoints_by_dynamic_group` | GET | /v2.0/DynamicGroups/{id}/Endpoints |
| `list_windows_endpoints_by_dynamic_group` | GET | /v2.0/DynamicGroups/{id}/WindowsEndpoints |
| **By Universal Dynamic Group** | | |
| `list_endpoints_by_udg` | GET | /v2.0/UniversalDynamicGroups/{id}/Endpoints |
| `list_windows_endpoints_by_udg` | GET | /v2.0/UniversalDynamicGroups/{id}/WindowsEndpoints |
| `list_android_endpoints_by_udg` | GET | /v2.0/UniversalDynamicGroups/{id}/AndroidEndpoints |
| `list_ios_endpoints_by_udg` | GET | /v2.0/UniversalDynamicGroups/{id}/IosEndpoints |
| `list_linux_endpoints_by_udg` | GET | /v2.0/UniversalDynamicGroups/{id}/LinuxEndpoints |
| `list_mac_endpoints_by_udg` | GET | /v2.0/UniversalDynamicGroups/{id}/MacEndpoints |
| `list_network_endpoints_by_udg` | GET | /v2.0/UniversalDynamicGroups/{id}/NetworkEndpoints |
| **By AD User** | | |
| `list_endpoints_by_ad_user` | GET | /v2.0/ADUsers/{id}/Endpoints |
| `list_windows_endpoints_by_ad_user` | GET | /v2.0/ADUsers/{id}/WindowsEndpoints |
| `list_android_endpoints_by_ad_user` | GET | /v2.0/ADUsers/{id}/AndroidEndpoints |
| `list_ios_endpoints_by_ad_user` | GET | /v2.0/ADUsers/{id}/IosEndpoints |
| `list_linux_endpoints_by_ad_user` | GET | /v2.0/ADUsers/{id}/LinuxEndpoints |
| `list_mac_endpoints_by_ad_user` | GET | /v2.0/ADUsers/{id}/MacEndpoints |

**Key inputSchema properties** (all tools share the same pattern):
- `{groupType}Id` or `adUserId` (string, GUID) — required, the group/user to scope the query
- `SearchQuery` (string) — optional search across endpoint DisplayName, HostName, etc.
- `PageSize` / `Page` / `OrderBy` — standard pagination

**Implementation notes**:
- All 27 tools are read-only GET operations — no write operations
- All share the same HTTP client and pagination logic as `bconnect-endpoints-mcp`
- Copy `bconnect-client.ts` and validation utils from the endpoints server template
- The group/user IDs should be validated as GUID format before API call

---

## Module Requirements

---

## ✅ IMPLEMENTED — Endpoints API (V2.0)

**Status**: COMPLETED ✅

**Description**: Exposes endpoint lifecycle management for all platform types (Windows, Linux, Mac,
Android, Industrial, Network). Supports full CRUD, group management, enrollment workflows, maintenance
windows, and generic delete.

**Implementation**:
- **Module file**: `src/modules/endpoints.ts`
- **Tool registration**: `src/index.ts` — ListToolsRequestSchema + CallToolRequestSchema
- **OpenAPI spec**: `/home/ansible/MCP/bConnectOpenAPI/26R1/endpoints.json` (25R2: `bConnect_Endpoints.json`)
- **Generated types**: `src/generated/endpoints-types.ts`
- **Tests**: `src/modules/__tests__/endpoints.test.ts`
- **Integration tests**: `src/__tests__/integration/endpoints.integration.test.ts`
- **E2E tests**: `src/__tests__/e2e/v2.0/endpoints.e2e.test.ts` (35 tests)

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `list_endpoints` | R | List all endpoints with filtering, searching, and pagination across DisplayName, HostName, PrimaryIP, OSVersionString, SerialNumber, Comment |
| `get_endpoint` | R | Get full details for a single endpoint by GUID |
| `search_endpoints` | R | Free-text search across all endpoint fields; returns up to `pageSize` results |
| `list_windows_endpoints` | R | List Windows-only endpoints with optional search and pagination |
| `get_windows_endpoint` | R | Get detailed Windows endpoint record by GUID |
| `list_logical_groups` | R | List all logical endpoint groups in the hierarchy |
| `get_logical_group` | R | Get a single logical group by GUID |
| `list_group_endpoints` | R | List all endpoints assigned to a specific logical group |
| `list_linux_endpoints` | R | List Linux-only endpoints with optional search and pagination |
| `list_mac_endpoints` | R | List Mac-only endpoints with optional search and pagination |
| `create_android_endpoint` | **W** | Create an Android endpoint with optional group assignment, serial number, enterprise profile type |
| `update_android_endpoint` | **W** | Update an Android endpoint's display name, group, comment, or serial number |
| `delete_android_endpoint` | **W** | Permanently delete an Android endpoint |
| `create_windows_endpoint` | **W** | Create a Windows endpoint with display name, hostname, MAC address, and optional group |
| `update_windows_endpoint` | **W** | Update Windows endpoint display name or comment |
| `delete_windows_endpoint` | **W** | Permanently delete a Windows endpoint |
| `start_windows_enrollment` | **W** | Start Internet enrollment for a Windows endpoint; optionally email instructions |
| `trigger_intune_installation` | **W** | Trigger baramundi Agent installation via Microsoft Intune co-management |
| `create_linux_endpoint` | **W** | Create a Linux endpoint with display name and optional group |
| `update_linux_endpoint` | **W** | Update Linux endpoint display name or comment |
| `delete_linux_endpoint` | **W** | Permanently delete a Linux endpoint |
| `create_mac_endpoint` | **W** | Create a Mac endpoint with display name and optional group |
| `update_mac_endpoint` | **W** | Update Mac endpoint display name or comment |
| `delete_mac_endpoint` | **W** | Permanently delete a Mac endpoint |
| `start_mac_enrollment` | **W** | Start enrollment for a Mac endpoint; optionally email instructions |
| `create_logical_group` | **W** | Create a logical group with name, optional parent group, and comment |
| `update_logical_group` | **W** | Update a logical group's name or comment |
| `delete_logical_group` | **W** | Permanently delete an empty logical group |
| `create_maintenance_window_for_endpoint` | **W** | Create a scheduled maintenance window for a specific endpoint |
| `update_maintenance_window_for_endpoint` | **W** | Update maintenance window configuration for a specific endpoint |
| `delete_maintenance_window_for_endpoint` | **W** | Remove maintenance window from a specific endpoint |
| `create_maintenance_window_for_logical_group` | **W** | Create a maintenance window applied to all endpoints in a logical group |
| `update_maintenance_window_for_logical_group` | **W** | Update maintenance window for a logical group |
| `delete_maintenance_window_for_logical_group` | **W** | Remove maintenance window from a logical group |
| `create_industrial_endpoint` | **W** | Create an industrial endpoint (PLC, SCADA device) |
| `update_industrial_endpoint` | **W** | Update an existing industrial endpoint |
| `delete_industrial_endpoint` | **W** | Permanently delete an industrial endpoint |
| `create_network_endpoint` | **W** | Create a network endpoint (switch, router, printer) |
| `update_network_endpoint` | **W** | Update an existing network endpoint |
| `delete_network_endpoint` | **W** | Permanently delete a network endpoint |
| `delete_endpoint` | **W** | Generic delete for any endpoint type by GUID |

**Key inputSchema properties**:
- `id` (string, GUID) — required for all get/update/delete operations
- `SearchQuery` (string) — free-text search across multiple fields
- `PageSize` (number, 1–1000, default 20) — pagination page size
- `Page` (number, 0-indexed) — pagination page number
- `OrderBy` (string) — field + direction, e.g., `"DisplayName asc"`
- `displayName` (string) — human-readable endpoint name
- `logicalGroupId` (string, GUID) — group assignment
- `androidEnterpriseProfileType` (enum: None, DeviceOwner, WorkProfile, DedicatedDevice)
- `maintenanceWindowData` (object) — maintenance window schedule configuration
- `endpointData` / `updateData` (object) — industrial/network endpoint payload

**Quality**:
- ✅ Build passes with 0 TypeScript errors
- ✅ 35 E2E tests passing (100%)
- ✅ All write tools include WARNING in description
- ✅ All IDs validated as GUID format before API call

---

## ✅ IMPLEMENTED — Jobs API (V2.0)

**Status**: COMPLETED ✅

**Description**: Manages job definitions, job instances (execution), job folders, group assignments, and
kiosk releases for end-user self-service software installation.

**Implementation**:
- **Module file**: `src/modules/jobs.ts`
- **OpenAPI spec**: `/home/ansible/MCP/bConnectOpenAPI/26R1/jobs.json` (25R2: `bConnect_Jobs.json`)
- **Generated types**: `src/generated/jobs-types.ts`
- **E2E tests**: `src/__tests__/e2e/v2.0/jobs.e2e.test.ts` (17 tests)

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `list_job_definitions` | R | List all job definitions with filtering, search, and pagination |
| `get_job_definition` | R | Get a single job definition by GUID |
| `list_job_instances` | R | List all job instances (execution history) with filtering and pagination |
| `get_job_instance` | R | Get a single job instance by GUID |
| `list_endpoint_job_instances` | R | List all job instances for a specific endpoint |
| `list_kiosk_releases` | R | List all kiosk releases available for end-user self-service |
| `get_kiosk_release` | R | Get kiosk release details including assignment target and supported platforms |
| `create_job_instance` | **W** | Assign a job definition to an endpoint, creating a job instance |
| `start_job_instance` | **W** | Start a pending job instance |
| `stop_job_instance` | **W** | Stop a running job instance |
| `resume_job_instance` | **W** | Resume a paused job instance (Windows endpoints only) |
| `delete_job_instance` | **W** | Permanently delete a job instance |
| `create_job_folder` | **W** | Create a folder in the jobs hierarchy |
| `update_job_folder` | **W** | Update a job folder's name or comment |
| `delete_job_folder` | **W** | Permanently delete an empty job folder |
| `assign_job_to_logical_group` | **W** | Assign a job definition to all endpoints in a logical group |
| `assign_job_to_static_group` | **W** | Assign a job definition to all endpoints in a static group |
| `assign_job_to_dynamic_group` | **W** | Assign a job definition to all endpoints in a Windows dynamic group |
| `assign_job_to_universal_dynamic_group` | **W** | Assign a job definition to all endpoints in a universal dynamic group |
| `create_kiosk_release` | **W** | Create a kiosk release to expose a job for end-user self-service |
| `withdraw_kiosk_release` | **W** | Withdraw (remove) a kiosk release |

**Key inputSchema properties**:
- `id` (string, GUID) — job definition, instance, folder, or kiosk release ID
- `jobDefinitionId` (string, GUID) — job to assign
- `endpointId` (string, GUID) — target endpoint for instance creation
- `scheduledStartTime` (string, ISO 8601) — optional future start time
- `logicalGroupId` / `staticGroupId` / `dynamicGroupId` / `universalDynamicGroupId` (string, GUID)
- `targetId` (string, GUID) — endpoint, group, or AD object for kiosk release

**Quality**:
- ✅ 17 E2E tests passing (100%)
- ✅ All write operations have WARNING labels in descriptions

---

## ✅ IMPLEMENTED — Assets API (V2.0)

**Status**: COMPLETED ✅

**Description**: Manages physical and logical assets tracked in baramundi's asset management system.
Supports asset types, stock folders, type folders, and per-endpoint/per-group asset queries.

**Implementation**:
- **Module file**: `src/modules/assets.ts`
- **OpenAPI spec**: `/home/ansible/MCP/bConnectOpenAPI/26R1/assets.json` (25R2: `bConnect_Assets.json`)
- **Generated types**: `src/generated/assets-types.ts`
- **E2E tests**: `src/__tests__/e2e/v2.0/assets.e2e.test.ts` (13 tests)

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `list_assets` | R | List all assets with search across Name, InventoryNumber, Contact, CostCenter |
| `get_asset` | R | Get a single asset by GUID |
| `list_asset_types` | R | List all asset types with optional summary data |
| `get_asset_type` | R | Get a single asset type by GUID |
| `list_assets_by_logical_group` | R | List assets assigned to a specific logical group |
| `list_assets_by_endpoint` | R | List assets assigned to a specific Windows endpoint |
| `list_asset_stock_assets` | R | List unassigned (stock) assets |
| `list_asset_stock_folders` | R | List all folders in the asset stock hierarchy |
| `create_asset` | **W** | Create a new asset with name, asset type, inventory number, and contact |
| `update_asset` | **W** | Update asset name or contact information |
| `delete_asset` | **W** | Permanently delete an asset |
| `create_asset_type` | **W** | Create a new asset type category |
| `delete_asset_type` | **W** | Permanently delete an asset type |
| `create_asset_stock_folder` | **W** | Create a new folder in the asset stock hierarchy |
| `update_asset_stock_folder` | **W** | Update a stock folder's name |
| `delete_asset_stock_folder` | **W** | Permanently delete an asset stock folder |
| `create_asset_type_folder` | **W** | Create a new folder in the asset types hierarchy |
| `update_asset_type_folder` | **W** | Update an asset type folder's name |
| `delete_asset_type_folder` | **W** | Permanently delete an asset type folder |

**Key inputSchema properties**:
- `id` (string, GUID) — asset, asset type, or folder ID
- `name` (string) — asset or folder name
- `assetTypeId` (string, GUID) — required when creating an asset
- `inventoryNumber` (string) — optional asset inventory tracking number
- `contact` (string) — person or department responsible for the asset
- `parentFolderId` (string, GUID) — optional parent folder for folder creation
- `ShowSummary` (boolean) — include aggregate data in asset type listing
- `logicalGroupId` / `endpointId` (string, GUID) — filter assets by assignment

**Quality**:
- ✅ 13 E2E tests passing (100%)

---

## ✅ IMPLEMENTED — Active Directory API (V2.0)

**Status**: COMPLETED ✅ (Read-only)

**Description**: Exposes Active Directory objects (users, groups, organizational units, generic AD
objects) for querying. No write operations — AD is managed externally.

**Implementation**:
- **Module file**: `src/modules/activedirectory.ts`
- **OpenAPI spec**: `/home/ansible/MCP/bConnectOpenAPI/26R1/activedirectory.json` (25R2: `bConnect_ActiveDirectory.json`)
- **Generated types**: `src/generated/activedirectory-types.ts`
- **E2E tests**: `src/__tests__/e2e/v2.0/activedirectory.e2e.test.ts` (7 tests)

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `list_ad_groups` | R | List all Active Directory groups with search and pagination |
| `get_ad_group` | R | Get a single AD group by GUID |
| `list_ad_users` | R | List all Active Directory users with search and pagination |
| `get_ad_user` | R | Get a single AD user by GUID |
| `list_ad_objects` | R | List all Active Directory objects (generic) with search and pagination |
| `get_ad_object` | R | Get a single AD object by GUID |
| `list_org_units` | R | List all organizational units with search and pagination |
| `get_org_unit` | R | Get a single organizational unit by GUID |
| `list_ad_users_by_group` | R | List all users that belong to a specific AD group |
| `list_ad_groups_by_org_unit` | R | List all groups within a specific organizational unit |

**Key inputSchema properties**:
- `id` (string, GUID) — AD object ID
- `adGroupId` (string, GUID) — for filtering users by group
- `orgUnitId` (string, GUID) — for filtering groups by OU
- `SearchQuery` (string) — full-text search across AD object properties
- `PageSize` / `Page` / `OrderBy` — standard pagination

**Quality**:
- ✅ 7 E2E tests passing (100%)
- ✅ No write operations — intentional, read-only domain

---

## ✅ IMPLEMENTED — Software API (V2.0)

**Status**: COMPLETED ✅ (Read-only)

**Description**: Queries installed Windows software across all endpoints or scoped to a specific endpoint,
logical group, or universal dynamic group.

**Implementation**:
- **Module file**: `src/modules/software.ts`
- **OpenAPI spec**: `/home/ansible/MCP/bConnectOpenAPI/26R1/software.json` (25R2: `bConnect_Software.json`)
- **Generated types**: `src/generated/software-types.ts`
- **E2E tests**: `src/__tests__/e2e/v2.0/software.e2e.test.ts` (1 test)

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `list_installed_windows_software` | R | List all installed Windows software across all endpoints with filtering and pagination |
| `list_installed_software_by_endpoint` | R | List installed software on a specific endpoint |
| `list_installed_software_by_logical_group` | R | List installed software on endpoints within a logical group |
| `list_installed_software_by_universal_dynamic_group` | R | List installed software on endpoints in a universal dynamic group |

**Key inputSchema properties**:
- `endpointId` (string, GUID) — filter to specific endpoint
- `logicalGroupId` (string, GUID) — filter to logical group
- `universalDynamicGroupId` (string, GUID) — filter to universal dynamic group
- `SearchQuery` (string) — search across software name and properties

**Quality**:
- ✅ 1 E2E test passing (100%)

---

## ✅ IMPLEMENTED — Update Management API (V2.0)

**Status**: COMPLETED ✅

**Description**: Lists Windows endpoints with Microsoft Update Management status and allows assignment
or removal of update profiles.

**Implementation**:
- **Module file**: `src/modules/updatemanagement.ts`
- **OpenAPI spec**: `/home/ansible/MCP/bConnectOpenAPI/26R1/updatemanagement.json` (25R2: `bConnect_UpdateManagement.json`)
- **Generated types**: `src/generated/updatemanagement-types.ts`
- **E2E tests**: `src/__tests__/e2e/v2.0/updatemanagement.e2e.test.ts` (2 tests)

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `list_update_management_windows_endpoints` | R | List all Windows endpoints with update status, profile, and last update timestamps |
| `get_update_management_windows_endpoint` | R | Get Microsoft Update Management info for a specific endpoint |
| `update_update_management_windows_endpoint` | **W** | Assign or reset (null) the update profile for a Windows endpoint via JSON Patch |

**Key inputSchema properties**:
- `id` (string, GUID) — Windows endpoint ID
- `SearchQuery` (string) — search across endpoint name and update profile name
- `OrderBy` (string) — sort by EndpointName, LastInventory, or LastSuccessfulUpdate
- `updateData` (object) — JSON Patch document, e.g., `[{"op":"replace","path":"/updateProfileId","value":"<guid>"}]`

**Quality**:
- ✅ 2 E2E tests passing (100%)
- ✅ JSON Patch format documented in tool description

---

## ✅ IMPLEMENTED — Defense Control API (V2.0)

**Status**: COMPLETED ✅

**Description**: Queries BitLocker encryption status, local administrator accounts, and Microsoft Defender
threat data. Provides limited write operations for local admin account lifecycle management.

**Implementation**:
- **Module file**: `src/modules/defensecontrol.ts`
- **OpenAPI spec**: `/home/ansible/MCP/bConnectOpenAPI/26R1/defensecontrol.json` (25R2: `bConnect_DefenseControl.json`)
- **Generated types**: `src/generated/defensecontrol-types.ts`
- **E2E tests**: `src/__tests__/e2e/v2.0/defensecontrol.e2e.test.ts` (3 tests)

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `list_bitlocker_windows_endpoints` | R | List BitLocker encryption status for all Windows endpoints |
| `get_bitlocker_windows_endpoint` | R | Get BitLocker encryption status for a specific endpoint |
| `get_local_admin_accounts` | R | Get local administrative account information for a Windows endpoint |
| `list_defender_threats` | R | List all Microsoft Defender threats detected across endpoints |
| `get_defender_threat` | R | Get details for a specific Defender threat |
| `list_defender_threats_by_endpoint` | R | List Defender threats for a specific endpoint |
| `list_defender_threats_by_logical_group` | R | List Defender threats for endpoints in a logical group |
| `list_defender_windows_endpoints` | R | List Microsoft Defender protection status for all Windows endpoints |
| `get_defender_windows_endpoint` | R | Get Defender protection status for a specific endpoint |
| `trigger_local_admin_accounts_update` | **W** | Trigger immediate local admin account update on an endpoint |
| `trigger_update_on_client` | **W** | Request client to immediately update its local admin account expiration (requires client online) |
| `patch_local_admin_user_credentials` | **W** | Change the expiration date of a local admin account via JSON Patch |

**Key inputSchema properties**:
- `id` (string, GUID) — Windows endpoint ID
- `endpointId` (string, GUID) — endpoint filter for threat queries
- `logicalGroupId` (string, GUID) — group filter for threat queries
- `timeout` (number, 0–60 seconds) — optional timeout for client update request
- `updateData` (object) — JSON Patch document to update `RequestedExpirationDate`

**Security Note**: `get_local_admin_accounts` returns sensitive credential metadata. For actual secret
retrieval (BitLocker keys, TPM passwords), use the V1.1 BitLocker tools.

**Quality**:
- ✅ 3 E2E tests passing (100%)

---

## ✅ IMPLEMENTED — Variables API (V2.0)

**Status**: COMPLETED ✅

**Description**: Manages baramundi variable definitions and their instances. Variables allow dynamic
data injection into jobs and configuration scripts scoped to endpoints, groups, AD objects, applications,
or job definitions.

**Implementation**:
- **Module file**: `src/modules/variables.ts`
- **OpenAPI spec**: `/home/ansible/MCP/bConnectOpenAPI/26R1/variables.json` (25R2: `bConnect_Variables.json`)
- **Generated types**: `src/generated/variables-types.ts`
- **E2E tests**: `src/__tests__/e2e/v2.0/variables.e2e.test.ts` (7 tests)

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `list_variable_definitions` | R | List all variable definitions with optional search |
| `get_variable_definition` | R | Get a single variable definition by ID |
| `list_variable_instances` | R | List all variable instances with optional search |
| `get_variable_instance` | R | Get a single variable instance by ID |
| `list_variables_by_endpoint` | R | List variables scoped to a specific endpoint |
| `list_variables_by_logical_group` | R | List variables scoped to a specific logical group |
| `list_variables_by_ad_object` | R | List variables scoped to a specific AD object |
| `list_variables_by_windows_application` | R | List variables scoped to a specific Windows application |
| `list_variables_by_windows_job` | R | List variables scoped to a specific Windows job definition |
| `create_variable_definition` | **W** | Create a new variable definition (name, type, comment, etc.) |
| `update_variable_definition` | **W** | Update a variable definition's properties via JSON Patch |
| `delete_variable_definition` | **W** | Permanently delete a variable definition |
| `update_variable_instance` | **W** | Update a variable instance's value via JSON Patch |

**Key inputSchema properties**:
- `id` (string) — variable definition or instance ID
- `endpointId` / `logicalGroupId` / `adObjectId` / `windowsApplicationId` / `windowsJobDefinitionId` (string, GUID) — scope filters
- `varDefData` (object) — variable definition payload (name, type, comment, default value)
- `updateData` (object) — JSON Patch document for partial updates

**Quality**:
- ✅ 7 E2E tests passing (100%)

---

## ✅ IMPLEMENTED — Operating Systems API (V2.0)

**Status**: COMPLETED ✅

**Description**: Manages OS installation configuration for Windows endpoints, including OS folder
hierarchy and boot environment / hardware profile settings.

**Implementation**:
- **Module file**: `src/modules/operatingsystems.ts`
- **OpenAPI spec**: `/home/ansible/MCP/bConnectOpenAPI/26R1/operatingsystems.json` (25R2: `bConnect_OperatingSystems.json`)
- **Generated types**: `src/generated/operatingsystems-types.ts`
- **E2E tests**: `src/__tests__/e2e/v2.0/operatingsystems.e2e.test.ts` (3 tests)

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `list_os_folders` | R | List all OS folders with optional search and pagination |
| `get_os_folder` | R | Get a single OS folder by ID |
| `list_os_folders_by_parent` | R | List OS folders within a specific parent folder |
| `list_os_windows_endpoints` | R | List Windows endpoints with OS installation configuration |
| `get_os_windows_endpoint` | R | Get OS installation info for a specific Windows endpoint |
| `create_os_folder` | **W** | Create a new OS folder with name, optional parent, and comment |
| `update_os_folder` | **W** | Update OS folder properties via JSON Patch |
| `delete_os_folder` | **W** | Permanently delete an empty OS folder |
| `update_os_windows_endpoint` | **W** | Update Windows endpoint OS install config (boot environment, hardware profile) |

**Key inputSchema properties**:
- `id` (string, GUID) — OS folder or Windows endpoint ID
- `folderId` (string, GUID) — parent folder filter
- `folderData` (object) — OS folder creation payload
- `updateData` (object) — JSON Patch document for OS folder or endpoint config update

**Note**: Method names in the module use `getWindowsEndpoints()` (not `getOperatingSystems()`).

**Quality**:
- ✅ 3 E2E tests passing (100%)

---

## ✅ IMPLEMENTED — Server Management API (V2.0)

**Status**: COMPLETED ✅

**Description**: Manages baramundi infrastructure components: management server control, microservices,
cloud connectors, PXE relays, security groups, security profiles, and object permissions.

**Implementation**:
- **Module file**: `src/modules/servermanagement.ts`
- **OpenAPI spec**: `/home/ansible/MCP/bConnectOpenAPI/26R1/servermanagement.json` (25R2: `bConnect_ServerManagement.json`)
- **Generated types**: `src/generated/servermanagement-types.ts`
- **E2E tests**: `src/__tests__/e2e/v2.0/servermanagement.e2e.test.ts` (7 tests)

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `get_management_server` | R | Get management server information and status |
| `get_gateway` | R | Get gateway information and status |
| `get_dip_status` | R | Get DIP (baramundi Infrastructure Platform) status |
| `get_vpn_appliance` | R | Get VPN appliance information |
| `list_microservices` | R | List all microservices with their status |
| `get_microservice` | R | Get a specific microservice by ID |
| `list_cloud_connectors` | R | List all cloud connectors |
| `list_pxe_relays` | R | List all PXE relay servers |
| `list_security_groups` | R | List all security groups with search and pagination |
| `get_security_group` | R | Get a specific security group by ID |
| `list_security_profiles` | R | List all security profiles with search and pagination |
| `get_security_profile` | R | Get a specific security profile by ID |
| `get_object_access_rights` | R | Get access rights for a specific object |
| `restart_management_server` | **W** | Restart the baramundi Management Server (impacts all connected clients) |
| `cancel_scheduled_restart` | **W** | Cancel a previously scheduled server restart |
| `start_microservice` | **W** | Start a microservice by ID |
| `stop_microservice` | **W** | Stop a microservice by ID |
| `restart_microservice` | **W** | Restart a microservice by ID |
| `create_security_group` | **W** | Create a new security group with name and optional comment |
| `update_security_group` | **W** | Update a security group's properties |
| `delete_security_group` | **W** | Permanently delete a security group |
| `create_security_profile` | **W** | Create a new security profile with name and optional comment |
| `update_security_profile` | **W** | Update a security profile's properties |
| `delete_security_profile` | **W** | Permanently delete a security profile |
| `update_object_permission` | **W** | Update access permissions for a specific object |

**Key inputSchema properties**:
- `id` (string, GUID) — microservice, security group, security profile, or object ID
- `objectId` (string, GUID) — object for permission management
- `groupName` (string) — security group name for creation
- `name` (string) — security profile name for creation

**Security Note**: `restart_management_server` is a high-impact operation that interrupts all client
connections. Always confirm with the user before executing.

**Quality**:
- ✅ 7 E2E tests passing (100%)

## ✅ IMPLEMENTED — Documentation Search

**Status**: COMPLETED ✅

**Description**: Full-text search across 13,500+ indexed baramundi documentation items: forum threads,
feedback portal (FAQ/KB/Ideas), release notes, preview documents, and website content. Uses fuzzy
matching and returns ranked results with excerpts.

**Implementation**:
- **Module file**: `src/modules/documentation-search.ts`
- **No API calls** — local index built from crawled and parsed documents
- **Tests**: 115 tests across unit, integration, E2E, performance, and error handling suites

**Coverage**:
- 13,036 forum threads (baramundi Connect, Job Management, and more)
- 456 website pages (blog, products, solutions, resources, company, case studies)
- 10 release notes (2024R1 through 2025R2)
- 4 preview documents (bMS 2024/2025 R1/R2)
- 1,527 feedback portal items (11 FAQ, 283 KB, 1,233 Ideas)

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `search_documentation` | R | Full-text search across all documentation sources. Supports source, type, and category filters. Returns ranked results with excerpts. |
| `get_documentation_item` | R | Get full markdown content of a specific documentation item by ID (e.g., `forum-job-management-14037`) |
| `list_documentation_sources` | R | List all indexed documentation sources with document counts per category |
| `get_popular_topics` | R | Analyze titles across indexed documents to surface frequently discussed topics |

**Key inputSchema properties**:
- `query` (string, required) — search query, supports fuzzy matching and partial words
- `source` (enum: all, forum, feedback, release-notes, preview, website) — source filter
- `type` (string) — document type filter (thread, faq, kb, idea, release-note, blog, product, etc.)
- `category` (string) — category filter (e.g., baramundi-connect, job-management)
- `limit` (number) — max results, default 20
- `id` (string) — document ID for `get_documentation_item`

**Quality**:
- ✅ 115 documentation search tests passing (100%)
- ✅ Performance tests: indexing and search within acceptable thresholds
- ✅ Real documents indexed: 13,500+

---

## ✅ IMPLEMENTED — Known Issues Search

**Status**: COMPLETED ✅

**Description**: Cross-references 1,664 known issues from baramundi release notes (2024R1–2025R2) with
9,856 forum threads using semantic search. Each known issue is linked to the top 5 relevant forum
threads that may contain solutions or workarounds.

**Implementation**:
- **Module file**: `src/modules/known-issues-search.ts`
- **No API calls** — local index built from release note and forum data

**Tools exposed**:

| Tool name | R/W | Description |
|-----------|-----|-------------|
| `search_known_issues` | R | Search known issues from release notes and find related forum solutions. Supports version and language filters. |
| `get_known_issues_summary` | R | Get summary statistics: total issues, issues with solutions, coverage percentage |

**Key inputSchema properties**:
- `query` (string, required) — search keywords (e.g., "Windows 11", "installation error", "patch management")
- `version` (string) — release version filter (e.g., "2024R2", "2024R2S1", "2025R1")
- `language` (enum: DE, EN) — language filter
- `limit` (number) — max results, default 10

**Quality**:
- ✅ Cross-references 100% of known issues to forum solutions

---

## Integration Overview

```
src/
├── index.ts                          # MCP server entry — tool registration + routing
├── bconnect-client.ts                # HTTP client for V2.0 API
├── modules/
│   ├── endpoints.ts                  # Endpoints API (V2.0)
│   ├── jobs.ts                       # Jobs API (V2.0)
│   ├── assets.ts                     # Assets API (V2.0)
│   ├── activedirectory.ts            # Active Directory API (V2.0)
│   ├── software.ts                   # Software API (V2.0)
│   ├── updatemanagement.ts           # Update Management API (V2.0)
│   ├── defensecontrol.ts             # Defense Control API (V2.0)
│   ├── variables.ts                  # Variables API (V2.0)
│   ├── operatingsystems.ts           # Operating Systems API (V2.0)
│   ├── servermanagement.ts           # Server Management API (V2.0)
│   ├── documentation-search.ts       # Documentation Search (local index)
│   ├── known-issues-search.ts        # Known Issues Search (local index)
│   └── forum-search.ts               # Forum search (sub-module)
├── generated/
│   ├── endpoints-types.ts            # Types from bConnect_Endpoints.json
│   ├── jobs-types.ts                 # Types from bConnect_Jobs.json
│   ├── assets-types.ts               # Types from bConnect_Assets.json
│   ├── activedirectory-types.ts      # Types from bConnect_ActiveDirectory.json
│   ├── software-types.ts             # Types from bConnect_Software.json
│   ├── updatemanagement-types.ts     # Types from bConnect_UpdateManagement.json
│   ├── defensecontrol-types.ts       # Types from bConnect_DefenseControl.json
│   ├── variables-types.ts            # Types from bConnect_Variables.json
│   ├── operatingsystems-types.ts     # Types from bConnect_OperatingSystems.json
│   └── servermanagement-types.ts     # Types from bConnect_ServerManagement.json
└── utils/
    ├── parameter-validator.ts        # 298-line validation utility
    └── mcp-tool-validation-rules.ts  # 546+ lines of per-tool validation rules
```

**Dependencies**:
- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `axios` + `axios-retry` — HTTP client with retry logic
- `dotenv` — environment variable loading
- `msw` (dev) — Mock Service Worker for test HTTP interception

---

## Quality Checklist

- ✅ All requirements have clear status indicators (COMPLETED ✅)
- ✅ Each requirement lists the exact tool names as they appear in `src/index.ts`
- ✅ inputSchema properties described with types and human-readable descriptions
- ✅ Read (R) vs Write (**W**) classification on every tool
- ✅ OpenAPI type references documented for all V2.0 modules
- ✅ V1.1 modules note "No OpenAPI spec — manually typed"
- ✅ Security considerations documented (BitLocker audit logging, TLS, admin warnings)
- ✅ V1.1 quirks documented (no pagination, query parameters vs path parameters)
- ✅ Known live-testing limitations documented (BitLocker needs enabled device, VPP needs token)
- ✅ Build: `npm run build` → 0 TypeScript errors
- ✅ Tests: 812+ tests passing (98.5% pass rate)
- ✅ Coverage: 86.35% (exceeds 60% target)

---

## Planned / Future Work

### ✅ IMPLEMENTED — SSL Certificate Verification (Production Hardening)

**Status**: COMPLETED ✅

**Description**: Remove `NODE_TLS_REJECT_UNAUTHORIZED=0` workaround for production deployments.
Configure proper CA certificate validation or self-signed cert trust for the baramundi management server.

**Priority**: HIGH — required before production deployment

---

### ✅ IMPLEMENTED — Performance Benchmarks

**Status**: COMPLETED ✅

**Description**: Formal performance test suite targeting <500ms P95 response time and documented memory
usage baselines under load.

**Implementation**:
- **Tests**: `src/__tests__/performance/api-performance.test.ts` (8 endpoints, 100 calls each, P50/P95)
- **Tests**: `src/__tests__/performance/memory-usage.test.ts` (heap delta and leak detection)
- **Script**: `npm run test:performance`
- **Report**: `PERFORMANCE-REPORT.md`

**Quality**:
- ✅ All 10 tests pass
- ✅ P95 < 500ms (actual: < 3ms with MSW)
- ✅ Heap delta < 200MB (actual: ~38MB)
- ✅ No memory leaks detected

---

### ✅ IMPLEMENTED — Remaining bConnect V2.0 Endpoints (Top 10 of 52 implemented)

**Status**: COMPLETED ✅

**Description**: 42 bConnect V2.0 API endpoints are not yet exposed as MCP tools (current coverage:
121/163 = 74%). These include less-commonly-used operations across existing modules.

**Priority**: LOW — existing coverage satisfies primary IT administration use cases

---

---

### 📋 PLANNED — REQ-AUTH-002: API Key Authentication (future bConnect release)

**Status**: PLANNED 📋

**Priority**: MEDIUM — API key authentication is the modern alternative to HTTP Basic Auth; may be introduced in a future bMS release after 26R1

**Description**: Add support for API key authentication as an alternative to HTTP Basic Authentication. Both 25R2 and 26R1 OpenAPI specs define only `basicAuth` (HTTP Basic). A future release may introduce API key support; the MCP server should be prepared to send API keys per the `securitySchemes` defined in that release's spec. Existing Basic Auth support is preserved for backward compatibility.

**Background**: Both 25R2 and 26R1 bConnect OpenAPI specs define only `basicAuth` (HTTP Basic, `Authorization: Basic <base64>`). A future bConnect release may add an `apiKeyAuth` security scheme. The exact header name must be confirmed from that release's OpenAPI spec before implementation.

**Dependency**: Requires a future bConnect release spec that introduces API key support.

**Planned changes**:

- **`BConnectConfig` interface** (`src/bconnect-client.ts`):
  - Add `apiKey?: string` — API key string value
  - Add `authMethod?: 'basic' | 'apikey'` — explicit auth method selector; if omitted, inferred: `apiKey` present → `apikey`, else → `basic`
  - Existing `username` / `password` fields remain required only when `authMethod === 'basic'`

- **`src/index.ts`**:
  - Read `BCONNECT_API_KEY` env var
  - Read `BCONNECT_AUTH_METHOD` env var (`basic` | `apikey`; default: `basic` if only username/password set, `apikey` if only `BCONNECT_API_KEY` set)
  - Validation: server must throw at startup if neither Basic Auth credentials nor API key are configured
  - Pass `apiKey` and `authMethod` to `BConnectClient` config

- **`.env.example`**:
  - Add `BCONNECT_API_KEY=` (commented, with note: bMS 26R2+ only)
  - Add `BCONNECT_AUTH_METHOD=basic` (with note: use `apikey` for 26R2+)

- **HTTP client** (`src/bconnect-client.ts`):
  - When `authMethod === 'apikey'`: attach API key per future spec scheme (TBD: `Authorization: Bearer <key>` or `X-API-Key: <key>`)
  - When `authMethod === 'basic'`: existing `Authorization: Basic <base64>` unchanged
  - Remove `auth: { username, password }` from axios config when using API key mode

**Security notes**:
- `BCONNECT_API_KEY` must never appear in logs — treat same as password (mask in audit log)
- API key must be validated as non-empty string at startup; fail-fast if empty
- API key value must not be stored in plain text in config files committed to VCS

**Planned tools affected**: None — this is infrastructure; all 117 existing tools automatically use the configured auth method

**Tests required**:
- TDD: assert `BConnectClient` receives `apiKey` when `BCONNECT_API_KEY` env var is set
- TDD: assert `BConnectClient` uses `authMethod: 'apikey'` when only API key is configured
- TDD: assert server throws at startup when neither Basic Auth credentials nor API key are provided
- TDD: assert API key is masked in audit log entries
- Security test: assert `BCONNECT_API_KEY` does not appear in any test output or log fixtures

**Open question — requires future spec**:
> What is the exact HTTP header/scheme for API key auth in a future bConnect release?
> Options: `Authorization: Bearer <key>` (bearerAuth) or `X-API-Key: <key>` (apiKey in header).
> Confirm from `components.securitySchemes` in that release's OpenAPI JSON files before implementing.

---

### ✅ RESOLVED — REQ-BMS-001: bConnect OpenAPI Spec Location

**Status**: RESOLVED ✅ (superseded by REQ-SRV-011)

**Description**: OpenAPI specs are available at `/home/ansible/MCP/bConnectOpenAPI/` with one
subfolder per release. Both 25R2 and 26R1 specs are present. See REQ-SRV-011 for version-awareness
requirements.

**Spec locations**:
- 25R2 specs: `/home/ansible/MCP/bConnectOpenAPI/25R2/` — 10 files (`bConnect_*.json`, `PascalCase`)
- 26R1 specs: `/home/ansible/MCP/bConnectOpenAPI/26R1/` — 12 files (`lowercase.json`)

**26R1 additions vs 25R2**:
- `compliance.json` — new module (8 operations)
- `universaldynamicgroups.json` — new module (6 operations)
- `software.json` — significantly expanded (4 → 19 operations)
- `assets.json` — 2 new operations (24 → 26)
- `defensecontrol.json` — 2 new operations (11 → 13)
- `servermanagement.json` — 5 new operations (25 → 30)

**Generated types** shall be produced via `openapi-typescript` from the target release's folder:
```json
"generate-types:25R2": "openapi-typescript /home/ansible/MCP/bConnectOpenAPI/25R2/*.json --output src/generated/25R2/",
"generate-types:26R1": "openapi-typescript /home/ansible/MCP/bConnectOpenAPI/26R1/*.json --output src/generated/26R1/",
"generate-types": "npm run generate-types:26R1"
```

---

### 📋 PLANNED — REQ-VER-001: bMS-Aligned Package Version Numbering

**Status**: PLANNED 📋

**Priority**: HIGH — users and deployment scripts need to know which bMS release a given MCP server build supports; `1.0.0` conveys nothing about compatibility

**Description**: Adopt a version numbering scheme that encodes the target baramundi Management Suite release directly in the MCP server's `package.json` version string. This makes bMS compatibility immediately readable without consulting documentation.

**Proposed scheme**:

```
<bMS-year-2digit>.<bMS-release-number>.<mcp-patch>
```

**Mapping table — historical and future**:

| bMS Release | Full name | MCP version | Notes |
|-------------|-----------|-------------|-------|
| 24R1 | bMS 2024R1 | `24.1.0` | First release in scheme |
| 24R2 | bMS 2024R2 | `24.2.0` | |
| 24R2S1 | bMS 2024R2S1 | `24.2.1` | S-release (security/hotfix) = patch bump |
| 25R1 | bMS 2025R1 | `25.1.0` | |
| 25R2 | bMS 2025R2 | `25.2.0` | Supported — specs at `/home/ansible/MCP/bConnectOpenAPI/25R2/` |
| 26R1 | bMS 2026R1 | `26.1.0` | **Current target** — specs at `/home/ansible/MCP/bConnectOpenAPI/26R1/` |

> `<mcp-patch>` increments for MCP-server-only fixes (bug fixes, new tools, config changes) that do not change the bMS target. Example: `26.2.1` = second patch of 26R2-targeted server.

**Changes required**:

- **`package.json`**: change `"version"` from `"1.0.0"` to `"26.1.0"` (targeting 26R1 specs; use `"25.2.0"` for a 25R2-only build)
- **`src/index.ts`**: update server version constant from `"1.0.0"` to match `package.json` version — this version is advertised in the MCP handshake
- **`README.md`** / **`QUICKSTART.md`**: add a **Compatibility Matrix** section documenting supported bMS versions per MCP server version
- **`CHANGELOG.md`** (new file): establish versioned changelog starting from `25.2.0`

**Compatibility matrix (to add to README)**:

| MCP server version | Supported bMS release | bConnect API | Notes |
|--------------------|-----------------------|--------------|-------|
| `1.0.0` (legacy) | ≤25R2 (unspecified) | V2.0 + V1.1 | Pre-versioning-scheme release |
| `25.2.0` | bMS 2025R2 | V2.0 + V1.1 | Supported |
| `26.1.0` | bMS 2026R1 | V2.0 + V1.1 | **Current target** (adds compliance, UDGs, expanded software) |

**Backward compatibility**:
- Users on bMS 25R2 use MCP server `25.2.x`
- Users on bMS 26R1 use MCP server `26.1.x`
- No single binary supports both simultaneously — users must install the version matching their bMS release
- Claude Desktop / Claude Code config `mcpServers` entries reference the installed binary path, not the version; no config change required on upgrade

**Versioning rules** (to document in CONTRIBUTING.md or README):
1. Major = bMS year (2-digit): `24`, `25`, `26` …
2. Minor = bMS release number within year: `1` (R1), `2` (R2) …
3. Patch = MCP-server-only fixes; resets to `0` on each new bMS release
4. S-releases (e.g. 24R2S1): the S-number becomes the patch: `24.2.1`
5. NEVER use this scheme for npm package publication — it is for internal/binary distribution only (major version `26` breaks npm semver conventions for public packages)

---

---

### 📋 PLANNED — REQ-WIN-001: Windows Self-Contained Binary Distribution

**Status**: PLANNED 📋

**Priority**: HIGH — IT administrators running baramundi Management Suite work primarily on Windows; requiring Node.js installation is a deployment barrier in enterprise environments

**Description**: Produce a single self-contained Windows `.exe` file that runs the MCP server with no Node.js installation required. Built with `pkg` (or `@yao-pkg/pkg`), the binary embeds the Node.js runtime, compiled JavaScript, and all dependencies. The binary is suitable for use as a Claude Desktop/Claude Code MCP subprocess and as a Windows Service.

**Background**:

- `pkg` and `pkg:all` scripts **already exist** in `package.json` but target `node16` — must be updated to `node20` to match the project's current runtime
- Linux tarballs already exist (`bconnect-mcp-1.0.0-linux-x86_64.tar.gz`, `bconnect-mcp-1.0.0-linux-aarch64.tar.gz`), establishing the release artifact pattern
- Windows targets: x64 (primary) and arm64 (Surface Pro X, Qualcomm-based devices)
- Enterprise Windows environments may require code signing (`signtool.exe`) to avoid SmartScreen warnings

**Planned changes**:

- **`package.json`** — update existing `pkg` and `pkg:all` scripts:
  - Change `node16` → `node20` for all targets
  - Add `node20-win-arm64` target to `pkg:all`
  - Rename output artifact to include version: `dist/bconnect-mcp-<version>-win-x64.exe`
  - Add `"pkg:win"` script for Windows-only build: `pkg . --targets node20-win-x64,node20-win-arm64 --output dist/bconnect-mcp-win`
  - Add `"pkg:linux"` script: `pkg . --targets node20-linux-x64,node20-linux-arm64 --output dist/bconnect-mcp-linux`

- **`package.json` pkg config block** — add `"pkg"` configuration:
  ```json
  "pkg": {
    "scripts": "build/**/*.js",
    "assets": ["data/**/*", "openapi-specs/**/*", ".env.example"],
    "targets": ["node20-win-x64", "node20-win-arm64", "node20-linux-x64", "node20-linux-arm64"],
    "outputPath": "dist/"
  }
  ```

- **`dist/`** — release artifacts per version:
  ```
  dist/
  ├── bconnect-mcp-26.2.0-win-x64.exe
  ├── bconnect-mcp-26.2.0-win-x64.exe.sha256
  ├── bconnect-mcp-26.2.0-win-arm64.exe
  ├── bconnect-mcp-26.2.0-linux-x86_64.tar.gz
  └── bconnect-mcp-26.2.0-linux-aarch64.tar.gz
  ```

- **`WINDOWS-DEPLOYMENT.md`** (new file) — step-by-step guide:
  1. Download `bconnect-mcp-<version>-win-x64.exe`
  2. Place in `C:\Program Files\bconnect-mcp\`
  3. Create `.env` file alongside the exe with `BCONNECT_BASE_URL`, `BCONNECT_USERNAME`, `BCONNECT_PASSWORD`, `BCONNECT_CA_CERT_PATH`
  4. Configure `mcpServers` in Claude Desktop `config.json`:
     ```json
     "bconnect-mcp": {
       "command": "C:\\Program Files\\bconnect-mcp\\bconnect-mcp-26.2.0-win-x64.exe",
       "env": { "BCONNECT_BASE_URL": "https://your-bms-server:444/bconnect" }
     }
     ```
  5. Optional: install as Windows Service using NSSM

**Security / signing considerations**:

- Windows SmartScreen blocks unsigned executables from the internet — in enterprise environments managed via Group Policy, this may not apply to internally distributed binaries
- For external distribution: code signing via `signtool.exe` with an EV certificate eliminates SmartScreen warnings; documented as optional post-build step
- SHA-256 checksum file (`.sha256`) must accompany every `.exe` release artifact for integrity verification
- The `.env` file must be stored outside the binary (not embedded) to keep credentials out of the exe; the pkg config must NOT bundle `.env` or `.env.*` files

**Planned tools affected**: None — build/distribution infrastructure only; no MCP tool changes

**Tests required**:

- Build test: `npm run pkg:win` exits 0 and produces `dist/bconnect-mcp-*-win-x64.exe`
- Size check: assert output `.exe` is < 100 MB (pkg with GZip compression typically 40–60 MB)
- SHA-256 test: assert `.sha256` file is generated alongside the `.exe`
- Smoke test (Windows CI): launch the `.exe` with `--help` or check that stdio MCP handshake starts (requires Windows runner)

---

### 📋 PLANNED — REQ-WIN-002: Docker Container Distribution

**Status**: PLANNED 📋

**Priority**: MEDIUM — supports IT environments using container infrastructure, Docker Desktop on Windows, or Rancher Desktop; also enables consistent cross-platform deployment without OS-specific binaries

**Description**: Publish a Docker image for the MCP server that runs on Windows (via Docker Desktop or Rancher Desktop), Linux, and macOS. Claude Desktop and Claude Code support MCP servers launched as subprocesses — a Docker-based launcher script wraps `docker run` so the host application treats it identically to a native binary.

**Background**:

- No `Dockerfile` exists yet in the project
- The MCP server communicates via stdio — Docker stdio passthrough (`docker run -i`) handles this transparently
- Claude Desktop config accepts any command that starts an stdio MCP server; `docker run -i` qualifies
- The `data/` directory (13,500+ document index) must be either bundled in the image or mounted at runtime
- The image must NOT contain credentials — env vars are passed at `docker run` time

**Planned changes**:

- **`Dockerfile`** (new file):
  ```dockerfile
  FROM node:20-alpine
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci --only=production
  COPY build/ ./build/
  COPY data/ ./data/
  COPY openapi-specs/ ./openapi-specs/
  ENV NODE_ENV=production
  EXPOSE_STDIO=true
  CMD ["node", "build/index.js"]
  ```
  Key decisions:
  - `node:20-alpine` — minimal base image (~50 MB + app ~20 MB = ~70 MB total)
  - `npm ci --only=production` — excludes dev dependencies (vitest, msw, etc.)
  - `data/` bundled in image (document index is static per release; avoids volume mount requirement)
  - No credentials in image — all `BCONNECT_*` env vars passed at runtime

- **`.dockerignore`** (new file): exclude `node_modules/`, `src/`, `*.test.ts`, `.env`, `.env.*`, `recordings/`, `__fixtures__/`, `dist/`

- **`docker-compose.yml`** (new file — reference configuration):
  ```yaml
  services:
    bconnect-mcp:
      image: bconnect-mcp:26.2.0
      stdin_open: true
      tty: false
      environment:
        BCONNECT_BASE_URL: ${BCONNECT_BASE_URL}
        BCONNECT_USERNAME: ${BCONNECT_USERNAME}
        BCONNECT_PASSWORD: ${BCONNECT_PASSWORD}
        BCONNECT_CA_CERT_PATH: /certs/bms-ca.pem
      volumes:
        - ./certs:/certs:ro
  ```

- **`WINDOWS-DEPLOYMENT.md`** — add Docker section:
  ```json
  "bconnect-mcp": {
    "command": "docker",
    "args": ["run", "-i", "--rm",
             "-e", "BCONNECT_BASE_URL=https://your-bms-server:444/bconnect",
             "-e", "BCONNECT_USERNAME=Administrator",
             "-e", "BCONNECT_PASSWORD=your-password",
             "bconnect-mcp:26.2.0"],
    "env": {}
  }
  ```
  Note: for CA cert, mount with `-v C:/certs/bms-ca.pem:/certs/bms-ca.pem:ro -e BCONNECT_CA_CERT_PATH=/certs/bms-ca.pem`

- **`package.json`** — add Docker build scripts:
  ```json
  "docker:build": "docker build -t bconnect-mcp:$(node -p \"require('./package.json').version\") .",
  "docker:build:multiarch": "docker buildx build --platform linux/amd64,linux/arm64 -t bconnect-mcp:$(node -p \"require('./package.json').version\") ."
  ```

**Security considerations**:

- Image must never contain `BCONNECT_USERNAME`, `BCONNECT_PASSWORD`, or `BCONNECT_API_KEY` — these are runtime env vars only
- CA certificate must be mounted as a read-only volume (`/certs/bms-ca.pem:ro`) — never bundled in the image
- Run as non-root user: add `USER node` to Dockerfile before `CMD` (node:alpine images include a `node` user)
- Multi-arch build (`linux/amd64` + `linux/arm64`) supports both x64 Windows hosts (via Docker Desktop) and ARM-based devices

**Planned tools affected**: None — container packaging only; no MCP tool changes

**Tests required**:

- Build test: `npm run docker:build` exits 0 and produces a tagged image
- Size check: assert image size < 300 MB (`docker image inspect`)
- Smoke test: `docker run -i --rm -e BCONNECT_BASE_URL=... bconnect-mcp:<version>` — verify MCP `initialize` handshake completes over stdin/stdout (use MSW-backed integration test)
- Security test: assert `docker inspect` shows no `BCONNECT_PASSWORD` or `BCONNECT_API_KEY` in image env

---

---

## Safety & Resilience Requirements (Inspired by mchluba/unofficial-baramundi-mcp-server)

> These requirements were identified by comparing bConnect-MCP with Marco Chluba's
> [unofficial-baramundi-mcp-server](https://github.com/mchluba/unofficial-baramundi-mcp-server).
> All are currently **POSTPONED** — not yet scheduled for implementation.

---

### REQ-SRV-012 — Write-Operation Gate

**Status**: POSTPONED ⏸

**Description**: All MCP tools that perform write operations (POST, PUT, PATCH, DELETE) shall be
blocked by default unless the operator explicitly opts in via an environment variable.

**Motivation**: With ~253 tools across 13 servers, many of which mutate state, an LLM operating
without human oversight could trigger destructive actions (deleting endpoints, killing jobs,
modifying policy). A gate prevents this class of accident without requiring per-tool changes.

**Proposed Implementation**:
- New env var: `ALLOW_WRITE_OPERATIONS` — defaults to `false`
- At tool registration time, each server checks this flag
- If `false`: write tools are registered as stubs that return a clear error:
  `"Write operations are disabled. Set ALLOW_WRITE_OPERATIONS=true to enable."`
- If `true`: tools are registered normally
- Write tools must be identified and annotated in each server (e.g. via a `isWriteOperation` flag
  passed to the tool registration helper)
- Apply to all 13 servers

**Tests required**:
- Default: write tool returns error, read tool succeeds
- `ALLOW_WRITE_OPERATIONS=true`: write tool executes normally

---

### REQ-SRV-013 — Startup Connectivity Check

**Status**: POSTPONED ⏸

**Description**: Each MCP server shall verify connectivity to its bConnect API domain at startup,
before accepting any MCP connections. If the check fails, the server shall exit with a clear error.

**Motivation**: Currently, misconfigured credentials or an unreachable API only surface when a tool
is called, producing confusing MCP-level errors. Fail-fast at startup gives operators immediate,
actionable feedback.

**Proposed Implementation**:
- Each server performs one lightweight GET call to its primary bConnect domain endpoint at startup
- Call is made in `index.ts` before `server.connect(transport)`
- On failure: log a clear error (`"Cannot reach bConnect API at <url>: <reason>"`) and `process.exit(1)`
- Timeout: 10 seconds maximum for the startup check
- The check should use the same HTTP client and credentials as normal tool calls

**Tests required**:
- Reachable API: server starts and connects normally
- Unreachable API: server exits with non-zero code and descriptive error message
- Wrong credentials: server exits with `401 Unauthorized` message

---

### REQ-SRV-014 — Partial Failure Handling in Composite Tool Calls

**Status**: POSTPONED ⏸

**Description**: Where MCP tools make multiple parallel API calls, they shall use `Promise.allSettled()`
instead of `Promise.all()` so that a single sub-call failure does not abort the entire tool response.
Failed sections shall be returned as `unavailable` with a reason rather than propagating as errors.

**Motivation**: Some bConnect sub-services (e.g. update management, software inventory) may be
temporarily slow or unavailable. Tools that aggregate data from multiple endpoints should degrade
gracefully rather than failing completely.

**Proposed Implementation**:
- Audit all tools that use `Promise.all()` across multiple API calls
- Replace with `Promise.allSettled()` where the calls are independent
- Return partial results with per-section status: `"available"` or `"unavailable: <reason>"`
- Apply primarily to composite tools in `bconnect-endpoints-mcp` and `bconnect-updatemanagement-mcp`

**Tests required**:
- All sub-calls succeed: full result returned
- One sub-call fails: partial result returned with `unavailable` section, no thrown error
- All sub-calls fail: error returned (no partial result to return)

---

### REQ-SRV-015 — LLM-Guidance in Input Schema Descriptions

**Status**: POSTPONED ⏸

**Description**: Tool input schemas shall include explicit natural-language guidance to the LLM
about what values to pass — particularly distinguishing exact-match vs fragment inputs, and warning
against passing full natural-language questions as parameter values.

**Motivation**: Marco Chluba's server demonstrates that schema description quality directly affects
LLM accuracy. Without guidance, LLMs frequently pass full questions instead of extracted values,
or pass fragments to tools that require exact IDs.

**Proposed Implementation**:
- Audit the 20 most frequently used tools across all 13 servers
- For each input parameter, enrich the `describe()` string with:
  - What format is expected (exact GUID, name fragment, exact host name, etc.)
  - What NOT to pass (e.g. "Do not pass the full natural-language question")
  - When to use this tool vs a related tool
- Priority servers: `bconnect-endpoints-mcp`, `bconnect-jobs-mcp`, `bconnect-updatemanagement-mcp`
- Generated tool schemas should allow description overrides without regenerating from OpenAPI

**Tests required**:
- All enriched parameters have non-empty, human-readable descriptions
- Descriptions do not exceed 500 characters (MCP context efficiency)

---

### REQ-SRV-016 — Use-Case Composite Tools (Workflows Server)

**Status**: POSTPONED ⏸

**Description**: A new `bconnect-workflows-mcp` server (or additions to existing domain servers)
shall provide a small set of high-level, use-case-oriented tools that combine multiple bConnect API
calls into single, intent-answering responses — complementing the existing API-mirroring tools.

**Motivation**: bConnect-MCP's tools are API-shaped. An admin asking "which devices need patches?"
must currently know the API, understand response schemas, and mentally compose results. Composite
tools answer real admin questions directly, reducing the number of LLM tool-call roundtrips and
making the server useful to non-technical operators.

**Proposed tools**:

| Tool | Combines | Use case |
|---|---|---|
| `get_device_full_dossier` | endpoint details + variables + update status + software | "Tell me everything about this device" |
| `find_devices_with_missing_updates` | updatemanagement list + severity filter + sort | "Which devices need patches?" |
| `find_devices_with_update_problems` | updatemanagement + problem state classification | "Which devices have update issues?" |
| `find_devices_by_variable` | variables list + group by device | "Find devices where Location = Berlin" |
| `deploy_job_to_devices` | job lookup + assignment (write-gated) | "Deploy this job to these devices" |

**Design principles** (from mchluba's approach):
- Tool names are framed around admin intent, not API operations
- Each tool description explicitly states what to pass and what NOT to pass
- Write tools require `ALLOW_WRITE_OPERATIONS=true` (REQ-SRV-012)
- Composite calls use `Promise.allSettled()` (REQ-SRV-014)
- Results are pre-formatted for LLM consumption (sections, labels, sorted by relevance)

**Implementation options**:
- Option A: New `bconnect-workflows-mcp` server (cleanest separation)
- Option B: Add composite tools to the most relevant domain servers

**Tests required**:
- Each tool returns a correctly structured result for a mocked multi-API response
- Partial API failures return gracefully degraded results (per REQ-SRV-014)
- Write tools blocked when `ALLOW_WRITE_OPERATIONS=false`

---

*Requirements derived from implementation — last reviewed 2026-03-31*
*Updated with pragmatic groups-server approach and 100% 26R1 coverage target*
*REQ-SRV-012 through REQ-SRV-016 added 2026-04-01 — inspired by mchluba/unofficial-baramundi-mcp-server comparison*
