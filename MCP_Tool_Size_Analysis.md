# MCP Tool Size Analysis — Balancing Completeness vs. Context Efficiency

> Generated: 2026-03-31
> Perspective: Senior IT Administrator performing daily baramundi management tasks
> Architecture: 12 domain-split MCP servers (per ADR-001)

---

## 1. The Core Problem

Every MCP tool you connect costs context tokens — before you even ask your first question. Tool definitions (name, description, input schema) are injected into the LLM's context window at session start. The more tools loaded, the less room remains for your actual conversation, API responses, and reasoning.

**The math is simple:**

| What | Tokens | % of 200K context |
|------|--------|-------------------|
| All 12 servers loaded simultaneously | ~43,000 | **21.5%** |
| Endpoints server alone | ~6,600 | 3.3% |
| UpdateManagement server alone | ~900 | 0.4% |
| Typical 3-server workflow | ~12,000–16,000 | 6–8% |
| Old monolith (196 tools) | ~39,000–78,000 | **20–39%** |

The 12-server split was the right call — it dropped worst-case context waste from 39–78K tokens to whatever subset you actually need. But within that split, **not all servers are created equal**, and daily workflows rarely need all 12.

---

## 2. Server Size Inventory

| Server | Tools | Schema Size (chars) | Est. Tokens | Weight Class |
|--------|-------|-------------------|-------------|-------------|
| **bconnect-endpoints-mcp** | **48** | **26,629** | **~6,600** | 🔴 Heavy |
| bconnect-assets-mcp | 27 | 21,294 | ~5,300 | 🟠 Large |
| bconnect-jobs-mcp | 25 | 20,138 | ~5,000 | 🟠 Large |
| bconnect-activedirectory-mcp | 17 | 18,179 | ~4,500 | 🟡 Medium |
| bconnect-software-mcp | 20 | 17,967 | ~4,500 | 🟡 Medium |
| bconnect-servermanagement-mcp | 31 | 16,984 | ~4,200 | 🟡 Medium |
| bconnect-variables-mcp | 14 | 12,335 | ~3,100 | 🟡 Medium |
| bconnect-defensecontrol-mcp | 14 | 11,846 | ~3,000 | 🟢 Moderate |
| bconnect-compliance-mcp | 9 | 8,937 | ~2,200 | 🟢 Moderate |
| bconnect-operatingsystems-mcp | 10 | 8,185 | ~2,000 | 🟢 Moderate |
| bconnect-universaldynamicgroups-mcp | 7 | 7,069 | ~1,800 | 🟢 Moderate |
| bconnect-updatemanagement-mcp | 4 | 3,568 | ~900 | ✅ Light |

**Total: ~226 tools, ~172K chars, ~43K tokens**

---

## 3. What Does a Senior IT Admin Actually Do Daily?

Let's be honest about real-world usage patterns. A senior baramundi admin doesn't wake up and think "today I will use all 264 API endpoints." The daily work clusters into **5–6 recurring workflows**:

### Workflow A: "What's the state of my endpoints?"
> _Morning check: How many endpoints are online, which ones have issues?_

| Servers needed | Tools used (realistically) | Context cost |
|---------------|---------------------------|-------------|
| endpoints | `list_endpoints`, `list_windows_endpoints`, `get_endpoint`, `search_endpoints` | ~6,600 tokens |
| | _Maybe_ defensecontrol for security posture | +3,000 tokens |
| **Total** | **4–6 tools out of 48+14 loaded** | **~9,600 tokens** |

**Verdict:** You load 62 tools to use 6. That's **90% waste** in the endpoints server alone.

### Workflow B: "Deploy software to a group of machines"
> _Roll out a patch, assign a job, check deployment status_

| Servers needed | Tools used (realistically) | Context cost |
|---------------|---------------------------|-------------|
| jobs | `list_job_definitions`, `create_job_instance`, `start_job_instance`, `assign_job_to_logical_group` | ~5,000 tokens |
| endpoints | `list_logical_groups`, `list_windows_endpoints_by_logical_group` | +6,600 tokens |
| software (26R1) | `list_software_bundles`, `list_installed_software_by_endpoint` | +4,500 tokens |
| **Total** | **~8 tools out of 93 loaded** | **~16,100 tokens** |

**Verdict:** 93 tools loaded, ~8 used. The cross-server dependency on endpoints is the expensive part.

### Workflow C: "Security audit — BitLocker & Defender status"
> _Check compliance, review threats, verify encryption_

| Servers needed | Tools used (realistically) | Context cost |
|---------------|---------------------------|-------------|
| defensecontrol | `list_bitlocker_windows_endpoints`, `list_defender_threats`, `list_defender_windows_endpoints` | ~3,000 tokens |
| compliance (26R1) | `list_detected_vulnerabilities`, `list_detected_rule_violations` | +2,200 tokens |
| **Total** | **~5 tools out of 23 loaded** | **~5,200 tokens** |

**Verdict:** This is the **best ratio** — small, focused servers, low waste. Exactly how it should work.

### Workflow D: "Server health & infrastructure"
> _Check management server, microservices, restart if needed_

| Servers needed | Tools used (realistically) | Context cost |
|---------------|---------------------------|-------------|
| servermanagement | `get_management_server`, `list_microservices`, `get_dip_status`, `restart_microservice` | ~4,200 tokens |
| **Total** | **~4 tools out of 31 loaded** | **~4,200 tokens** |

**Verdict:** Single-server workflow, clean. But 31 tools for a "check health" task is heavy — security group/profile management (10 tools) is rarely used in the same session as server monitoring.

### Workflow E: "Find a user and their devices"
> _HR asks about a specific employee's managed devices_

| Servers needed | Tools used (realistically) | Context cost |
|---------------|---------------------------|-------------|
| activedirectory | `list_ad_users`, `get_ad_user`, `list_ad_object_memberships` | ~4,500 tokens |
| endpoints | `list_endpoints` (search by user) | +6,600 tokens |
| **Total** | **~4 tools out of 65 loaded** | **~11,100 tokens** |

**Verdict:** Again, endpoints is the tax you pay on almost every workflow.

### Workflow F: "Manage variables / OS configuration"
> _Set custom variables, configure OS install profiles_

| Servers needed | Tools used (realistically) | Context cost |
|---------------|---------------------------|-------------|
| variables | `list_variable_definitions`, `update_variable_instance` | ~3,100 tokens |
| operatingsystems | `list_os_windows_endpoints`, `update_os_windows_endpoint` | +2,000 tokens |
| **Total** | **~4 tools out of 24 loaded** | **~5,100 tokens** |

**Verdict:** Efficient. Small, focused servers doing exactly their job.

---

## 4. The Efficiency Matrix

| Server | Daily relevance | Context cost | Tools actually used daily | Efficiency |
|--------|----------------|-------------|--------------------------|------------|
| **endpoints** | Every day | 6,600 tok | 5–8 of 48 | 🔴 **10–17%** |
| **jobs** | 3–4x/week | 5,000 tok | 4–6 of 25 | 🟡 16–24% |
| **servermanagement** | Daily (monitoring) | 4,200 tok | 3–5 of 31 | 🟡 10–16% |
| **defensecontrol** | 2–3x/week | 3,000 tok | 3–5 of 14 | 🟢 21–36% |
| **activedirectory** | 2–3x/week | 4,500 tok | 3–5 of 17 | 🟢 18–29% |
| **software** | 2–3x/week | 4,500 tok | 2–4 of 20 | 🟡 10–20% |
| **compliance** | 1–2x/week | 2,200 tok | 2–4 of 9 | 🟢 22–44% |
| **assets** | 1–2x/week | 5,300 tok | 2–4 of 27 | 🟡 7–15% |
| **variables** | 1x/week | 3,100 tok | 2–3 of 14 | 🟡 14–21% |
| **updatemanagement** | 1–2x/week | 900 tok | 2–3 of 4 | ✅ **50–75%** |
| **operatingsystems** | Rarely | 2,000 tok | 1–2 of 10 | 🟢 10–20% |
| **universaldynamicgroups** | Rarely | 1,800 tok | 1–2 of 7 | 🟢 14–29% |

**Key insight:** The three servers you use most (endpoints, jobs, servermanagement) are also the three with the worst efficiency ratios.

---

## 5. Are the Current Tools Sufficient?

### What's there and works well

For 10 of 12 domains, coverage is **100%** — every API endpoint has a corresponding MCP tool. A senior admin can do everything the API allows in:
- Active Directory lookups
- Asset management (full CRUD)
- Compliance checks (26R1)
- Defense/security monitoring
- OS configuration
- Server management & infrastructure
- Software inventory and bundles (26R1)
- Universal dynamic groups (26R1)
- Update management
- Variable management

### What's missing (and does it matter?)

The **Endpoints** server has 48 tools but is missing **38 API endpoints** (60% coverage). The **Jobs** server is missing **9 endpoints** (74% coverage). Let's assess what's actually needed:

#### Endpoints — Missing but NEEDED by a senior admin:

| Missing | Impact | Priority |
|---------|--------|----------|
| `list_android_endpoints`, `get_android_endpoint` | Can't browse Android fleet without going generic | 🟡 Medium |
| `list_ios_endpoints`, `get_ios_endpoint`, iOS CRUD | Can't manage iOS fleet at all | 🟡 Medium |
| `list_network_endpoints`, `get_network_endpoint` | Can't browse network devices | 🟡 Medium |
| `list_unmanaged_endpoints` (26R1) | Can't find rogue/unmanaged devices | 🔴 **High** |
| `get_maintenance_window` (read) | Can create/update/delete but can't read — **asymmetric** | 🟡 Medium |

#### Endpoints — Missing but RARELY needed:

| Missing | Impact | Priority |
|---------|--------|----------|
| Endpoints by Static Group (7 tools) | Use `list_endpoints` with search instead | 🟢 Low |
| Endpoints by Dynamic Group (2 tools) | Use `list_endpoints` with search instead | 🟢 Low |
| Endpoints by UDG (7 tools) | Use `list_endpoints` with search instead | 🟢 Low |
| Endpoints by AD User (6 tools) | Use `list_endpoints` with search instead | 🟢 Low |
| EntraID Data (3 tools, 26R1) | Niche, not daily workflow | 🟢 Low |

**The "by group type" endpoints (22 missing) are the right tools to NOT implement.** They're convenience aliases — a senior admin can achieve the same result through `list_endpoints` + search/filter, or by getting the group first and then listing its members via `list_endpoints_by_logical_group`. Implementing all 22 would add ~8,000 tokens of context for endpoints that duplicate existing functionality.

#### Jobs — Missing but worth noting:

| Missing | Impact | Priority |
|---------|--------|----------|
| `list_job_folders`, `get_job_folder`, `list_job_subfolders` | Can't navigate folder tree | 🟡 Medium |
| Job instances by static/dynamic/UDG group | Use `list_job_instances` + filter instead | 🟢 Low |
| Kiosk releases by context | Niche, use `list_kiosk_releases` instead | 🟢 Low |

---

## 6. Verdict — Tool Completeness vs. Context Waste

### The Tradeoff Spectrum

```
MORE TOOLS                                              FEWER TOOLS
(complete but wasteful)                                 (lean but gaps)
◄──────────────────────────────────────────────────────────────────►
         │                    │                     │
    All 264 endpoints    Current state (226)    Core-only (~150)
    = ~52K tokens        = ~43K tokens          = ~30K tokens
    = 100% coverage      = 83% coverage         = ~65% coverage
    = massive waste      = good balance          = might hit walls
```

### The answer: Current state is close to optimal

The existing 226-tool, 12-server architecture hits a **sweet spot**:

1. **The "missing" 38 endpoints in the Endpoints server are mostly group-listing variants** that provide no unique capability. Not implementing them saves ~8,000–10,000 tokens of context waste with zero functional loss. This was the right call.

2. **The 10 domains at 100% coverage need no changes.** They're complete and their tool counts are appropriate.

3. **The servers a senior admin uses most days (endpoints + jobs) are the ones with gaps — but the gaps don't hurt daily work.** The `list_endpoints` + `search_endpoints` tools are powerful enough to replace 22 missing "by group" variants.

### What SHOULD be added (high-value, low-cost):

| Tool | Server | Why | Token cost |
|------|--------|-----|-----------|
| `list_unmanaged_endpoints` | endpoints | Security visibility — finding rogue devices is a real daily task | ~400 tok |
| `get_maintenance_window` | endpoints | Asymmetric: can write but not read — confusing for admins | ~300 tok |
| `list_android_endpoints` | endpoints | Fleet visibility parity with Windows/Linux/Mac | ~350 tok |
| `list_ios_endpoints` | endpoints | Fleet visibility parity | ~350 tok |
| `list_network_endpoints` | endpoints | Fleet visibility parity | ~350 tok |
| `list_job_folders` | jobs | Can't navigate job folder tree without this | ~300 tok |

**Cost of these 6 additions: ~2,050 tokens.** That's 1% of context for meaningful capability gains.

### What should NOT be added:

| Category | Tools saved | Tokens saved | Why skip |
|----------|-----------|-------------|---------|
| Endpoints by Static Group | 7 | ~2,450 | Use `list_endpoints` + filter |
| Endpoints by Dynamic Group | 2 | ~700 | Use `list_endpoints` + filter |
| Endpoints by UDG | 7 | ~2,450 | Use `list_endpoints` + filter |
| Endpoints by AD User | 6 | ~2,100 | Use `activedirectory` server + `list_endpoints` |
| Android/iOS/Industrial/Network by Logical Group | 5 | ~1,750 | Use `list_endpoints_by_logical_group` |
| EntraID Data | 3 | ~1,200 | Niche, not daily ops |
| Kiosk releases by context | 3 | ~1,050 | Use `list_kiosk_releases` |
| **Total skipped** | **33** | **~11,700** | |

**Skipping these 33 tools saves ~12K tokens** — that's 6% of your context window preserved for actual work.

---

## 7. Recommended Server Loading Profiles

A senior admin should configure their MCP client based on what they're doing, not load everything at once. Here are recommended profiles:

### Profile: "Daily Operations" (most common)
```json
["bconnect-endpoints-mcp", "bconnect-defensecontrol-mcp", "bconnect-updatemanagement-mcp"]
```
- **Tools loaded:** 66
- **Context cost:** ~10,500 tokens (5.3%)
- **Covers:** Endpoint overview, security posture, patch status

### Profile: "Software Deployment"
```json
["bconnect-endpoints-mcp", "bconnect-jobs-mcp", "bconnect-software-mcp"]
```
- **Tools loaded:** 93
- **Context cost:** ~16,100 tokens (8.1%)
- **Covers:** Find targets, create jobs, deploy software

### Profile: "Security Audit"
```json
["bconnect-defensecontrol-mcp", "bconnect-compliance-mcp", "bconnect-updatemanagement-mcp"]
```
- **Tools loaded:** 27
- **Context cost:** ~6,100 tokens (3.1%)
- **Covers:** BitLocker, Defender, compliance rules, patch levels

### Profile: "User & Device Investigation"
```json
["bconnect-activedirectory-mcp", "bconnect-endpoints-mcp", "bconnect-variables-mcp"]
```
- **Tools loaded:** 79
- **Context cost:** ~14,200 tokens (7.1%)
- **Covers:** Find user, find their devices, check custom variables

### Profile: "Infrastructure Management"
```json
["bconnect-servermanagement-mcp"]
```
- **Tools loaded:** 31
- **Context cost:** ~4,200 tokens (2.1%)
- **Covers:** Server health, microservices, security groups, DIPs

### Profile: "Full Fleet" (when you need everything)
```json
["bconnect-endpoints-mcp", "bconnect-jobs-mcp", "bconnect-activedirectory-mcp",
 "bconnect-defensecontrol-mcp", "bconnect-software-mcp", "bconnect-servermanagement-mcp"]
```
- **Tools loaded:** 155
- **Context cost:** ~28,300 tokens (14.2%)
- **Covers:** 90% of daily tasks across all domains

---

## 8. Could the Split Be Better?

The current split follows OpenAPI spec files, which is clean and objective. But from a **usage perspective**, two improvements would help:

### Observation 1: Endpoints (48 tools) is too heavy

The endpoints server is a "tax" on nearly every workflow. It could benefit from splitting into:
- **bconnect-endpoints-read-mcp** (~15 tools): list/get/search for all endpoint types
- **bconnect-endpoints-write-mcp** (~33 tools): create/update/delete, enrollment, maintenance windows

A senior admin doing morning checks loads only the read server (15 tools, ~2,200 tokens) instead of the full 48. The write server is only needed for active changes.

**Downside:** Breaks the "one spec = one server" principle from ADR-001. Creates ambiguity about which server to connect.

### Observation 2: Some servers are so small they could merge

| Candidate merge | Combined tools | Combined tokens | Rationale |
|----------------|---------------|-----------------|-----------|
| updatemanagement + compliance | 13 | ~3,100 | Both about "are my endpoints compliant/patched?" |
| operatingsystems + updatemanagement | 14 | ~2,900 | Both about Windows endpoint configuration |
| universaldynamicgroups into endpoints | 55 | ~8,400 | UDGs are just a grouping mechanism for endpoints |

**Downside:** Same as above — breaks the clean spec-to-server mapping.

### Recommendation: Keep the current split

The spec-aligned split is the right long-term architecture. The "efficiency problem" is better solved through **loading profiles** (Section 7) than through restructuring the servers. The overhead of small servers (900–2,000 tokens each) is negligible — the real cost is always the endpoints server.

---

## 9. Final Summary

| Question | Answer |
|----------|--------|
| Is the current tool set sufficient for daily admin work? | **Yes**, with 6 small additions recommended |
| Is context waste a problem? | **Only if you load all 12 servers** (~43K tokens). With profiles, it's 3–14% |
| Should missing "by group" endpoints be implemented? | **No** — they're convenience aliases that cost 12K tokens for zero unique capability |
| Should the server split change? | **No** — use loading profiles instead |
| What's the single biggest improvement? | **Add `list_unmanaged_endpoints`** (26R1) — it's the only missing tool that blocks a real security workflow |
| What's the best daily configuration? | **3 servers** (endpoints + defensecontrol + updatemanagement) = 66 tools, ~10.5K tokens, covers 70% of daily tasks |

### The Golden Rule

> **Connect only the servers you need for the task at hand.**
> The split architecture exists precisely so you don't pay the context tax for tools you won't use.
> Three well-chosen servers (10K tokens) beat twelve loaded servers (43K tokens) every time.
