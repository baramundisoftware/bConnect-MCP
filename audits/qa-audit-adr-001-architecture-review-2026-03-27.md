# QA Audit — ADR-001 Architecture Review

**Scope**: ADR-001-server-split.md — architecture review sign-off
**Date**: 2026-03-27
**Reviewer**: QualityAssuranceEngineer
**Audit file**: `ADR-001-server-split.md`

---

## 1. Executive Summary

**Score: 9/10 (90%) — APPROVED with corrections applied**

ADR-001 is architecturally sound and consistent with REQ-SPLIT-001 through REQ-SPLIT-006. All 19
modules in `src/modules/` are assigned to exactly one of the 5 planned servers with no omissions
or duplicates. Three corrections were applied inline to the ADR: the tool count was updated from
the stale value of 186 to the verified current value of 196, the token estimate was adjusted
accordingly, and clarifying notes were added to the module table regarding the `forum-search`
module's current MCP registration status.

---

## 2. Per-category results

| Category | Result | Detail |
|---|---|---|
| Tool count accuracy | ⚠️ WARN → CORRECTED | ADR said 186; verified count is 196 — corrected in ADR |
| Module coverage (no tool left behind) | ✅ PASS | All 19 modules assigned |
| No duplicate module assignment | ✅ PASS | Each module appears in exactly one server |
| Server names match REQ-SPLIT-002–006 | ✅ PASS | All 5 server names match exactly |
| REQ-SPLIT-002 module assignments | ✅ PASS | endpoints, activedirectory, operatingsystems |
| REQ-SPLIT-003 module assignments | ✅ PASS | jobs, servermanagement, variables |
| REQ-SPLIT-004 module assignments | ✅ PASS | defensecontrol, assets, software, updatemanagement |
| REQ-SPLIT-005 module assignments | ✅ PASS | bitlocker-v1, complianceviolations-v1, vpp-v1, ssh-v1, setup-integrity-v1, inventory-v1 |
| REQ-SPLIT-006 module assignments | ✅ PASS | documentation-search, forum-search, known-issues-search |
| forum-search module treatment | ⚠️ WARN → CLARIFIED | Module exists but not separately registered as MCP tools in monolith — clarified in ADR |
| Approximate tool counts plausible | ✅ PASS | Per-server estimates consistent with per-module breakdown |
| ADR status field | ✅ PASS | Status: Accepted |
| Related requirements listed | ✅ PASS | REQ-SPLIT-001 through REQ-SPLIT-006 all listed |

---

## 3. Compliance Score

| Category | Score |
|---|---|
| Module assignment correctness | 5/5 |
| Tool count accuracy (after correction) | 2/2 |
| Documentation completeness | 2/3 (forum-search clarification added; minor) |
| **Total** | **9/10 (90%)** |

---

## 4. Action Required

None — all issues were corrected inline in ADR-001-server-split.md during this review.

### Corrections applied

1. **Tool count 186 → 196** in Context section and Consequences section.
   Verified by: matching `name:` entries in both `ListToolsRequestSchema` handler (lines 110–2363)
   and `CallToolRequestSchema` handler — both return 196 entries.

2. **Token estimate updated** from "37k–75k tokens" to "39k–78k tokens" (196 × 200–400).

3. **Module table Total row** corrected from "186" to "196". Added three clarifying notes:
   - `known-issues-search` is a backend module counted within `documentation-search`
   - `forum-search` module has 5 methods but they are not individually registered as MCP tools in
     the current monolith (forum search is delivered via `search_documentation`); the module is
     still correctly assigned to `bconnect-docu-mcp` for direct exposure in the split
   - The per-row sum (199) vs MCP registration count (196) discrepancy is explained

4. **QA Review section appended** to ADR-001 with full checklist and sign-off.

---

## 5. Optional Improvements

- **Requirements.md module table** (lines 157–178): the `Total` row still says 186 while the
  `Actual:` annotation on line 155 correctly says 196. The table's per-row numbers also sum to 199
  (not 186). Consider updating the Requirements.md table total to 196 and adding a footnote
  matching the one added to ADR-001 explaining the forum-search discrepancy. (Not blocking — the
  `Actual: 196` annotation is already present.)

- **forum-search module**: now that `search_documentation` covers forum threads, consider whether
  the `forum-search.ts` module's standalone `search()`, `getThread()`, `listCategories()`, and
  `getStats()` methods should be registered as additional MCP tools in the monolith, or whether
  the `bconnect-docu-mcp` split is the right time to expose them. Document the decision.
