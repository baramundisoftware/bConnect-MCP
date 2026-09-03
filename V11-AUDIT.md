# v1.1 audit: every call we make, and why v2.0 cannot make it

**Purpose.** v1.1 is used only where v2.0 has no equivalent. This table is the evidence for
that claim, per call, and the thing that has to be re-checked when a bMS release closes a
gap. `BCONNECT-V11-VS-V20.md` records the original capability analysis; this records the
*code*, which is what actually reaches the API.

**Status: complete, and guarded.** Every row was established by calling both sides against a
live bMS on the same object — see §"How this was completed". The guard that keeps it current
is `bConnect-MCP-main/__tests__/v11-audit-covers-every-call-site.test.ts`.

---

## The rule this audit exists to enforce

> A v1.1 call is justified only while no v2.0 tool can produce the same answer. When one can,
> the call moves and the row is deleted.

v1.1 authenticates as a named account and carries **that account's own bMS rights**, not the
API key's — so every row here is also a privilege the installation would not otherwise have.
And per `BCONNECT-V11-VS-V20.md` §4, the API is sunsetting. Both are reasons for the table to
shrink over time, not grow.

---

## Where v1.1 is called from, and what v2.0 answers instead

Established by reading the code, then by calling both sides live. Three modules, six
controllers, and nothing else in the suite touches v1.1.

The verdicts are a closed set, because **"no tool exists" and "the tool exists but drops a
field" are different remedies** and flattening them into one column is how a field gap gets
mistaken for a missing controller:

| Verdict | Means | Remedy |
|---|---|---|
| `no v2.0 controller` | The data has no v2.0 route at all. | Keep the v1.1 call. |
| `same tool, missing fields` | A v2.0 tool answers the same question about the same object, and omits fields. | Ask the vendor for the fields. |
| `partial` | A v2.0 tool answers part of the question and structurally cannot answer the rest. | Keep the v1.1 call for the remainder; say which part. |
| `same answer, field lost` | The v2.0 tool covers the whole question, and one field of the v1.1 answer is not recoverable from it. | Re-justify or delete the v1.1 call. |

| # | v1.1 controller | Called from | For | v2.0 equivalent | Verdict | Checked against |
|---|---|---|---|---|---|---|
| 1 | `InventoryDataRegistryScans` | `bconnect-endpoints-mcp/src/modules/inventory-scans-v11.ts` | `get_endpoint_registry_inventory` | `list_installed_software_by_endpoint` | `same answer, field lost` | bMS 26.1.161.0 |
| 2 | `InventoryDataFileScans` | same | `get_endpoint_file_inventory` | **no v2.0 candidate** | `no v2.0 controller` | bMS 26.1.161.0 |
| 3 | `InventoryDataWMIScans` | same | `get_endpoint_wmi_inventory` | `get_endpoint` | `partial` | bMS 26.1.161.0 |
| 4 | `jobs` | `bconnect-jobs-mcp/src/modules/v11.ts` | destructive-job detection; enriches `diagnose_job`, `explain_job_failure`, `preview_assignment` | `get_job_definition` | `same tool, missing fields` | bMS 26.1.161.0 |
| 5 | `MicrosoftUpdateProfiles` | `bconnect-updatemanagement-mcp/src/index.ts` | `list_microsoft_update_profiles` | `get_update_management_endpoint` | `partial` | bMS 26.1.161.0 |
| 6 | `MicrosoftUpdateInventories` | same | `get_endpoint_microsoft_update_inventory` | `get_update_management_endpoint` | `partial` | bMS 26.1.161.0 |

Rows 1–3 and 5–6 are tools an operator can call directly. Row 4 is enrichment inside v2.0
tools that work without it — the code treats the surface being off as a supported state, not a
degraded one.

**The bMS these answers are facts about:** `bms-srv1.labcorp.local`, `get_management_server`
reporting **26.1.161.0**, `GET /bConnect/Version` reporting
`{"SupportedVersions":["1.0","1.1"],"CurrentVersion":"1.1"}`. Probed 2026-08-07. A gap is a
fact about a release, not about the product, and every one of these rows can close without
anyone here being told.

---

## Row by row, with the numbers

Both sides were called on the same object. Two Windows endpoints were used rather than one —
`WORKSTATION1` (`9dd53b61…`, a workstation) and `A-DC-01` (`491e03b1…`, a domain controller) —
because a coverage claim drawn from a single machine is not a coverage claim.

### 1. `InventoryDataRegistryScans` → `list_installed_software_by_endpoint` — *the row that should not survive as written*

**v2.0 accounts for every product the v1.1 registry scan reports, and for more.**

| | WORKSTATION1 | A-DC-01 |
|---|---:|---:|
| v1.1 registry products (unique) | 86 | 21 |
| …also present verbatim in v2.0 `source: Inventoried` | 74 | 12 |
| …present in v2.0 as a `source: ManagedSoftware` row | 12 | 9 |
| **unaccounted for by v2.0** | **0** | **0** |
| v2.0 rows with no v1.1 registry counterpart | 5 | 6 |

It is also the **same scan run**: v2.0's `lastFound` is `2026-08-05T01:03:56Z`, equal to the
v1.1 `Scans[0].Time` to the second.

What v2.0 does not give back is the **raw registry `DisplayName` and `Version`** for a product
a detection rule matched — it substitutes baramundi's recognised name and version:

| v1.1 registry says | v2.0 says |
|---|---|
| `Zoom Workplace (64-bit)` `7.1.43453` | `Zoom` `7.1.5.43453` |
| `baramundi Automation Studio` `26.1.161.0` | `Management Suite` `Automation Studio 2026 R1` |
| `Microsoft Edge` `151.0.4129.59` | `Edge` `151.0.4129.59` |
| `Adobe Acrobat (64-bit)` `26.001.21771` | `Reader` `26.001.21771-x64` |

That is a field, and a narrow one. **It does not support the tool's own justification.**
`v11-tool-catalogue.ts` tells the caller this scan "includes desktop applications, AppX
packages and runtimes that the standard software inventory may not list" — measured, the
standard software inventory listed all of them and five more. The description is wrong on this
estate, at this release, and it is the reason a model would choose the v1.1 tool over the v2.0
one.

**Decision taken 2026-08-07: narrow the description, keep the tool.** The description now
leads with what the tool uniquely answers — the literal registry `DisplayName` and `Version`,
before software recognition rewrites them — and points the caller at
`list_installed_software_by_endpoint` for "what is installed on this machine", saying that it
reads the same scan run and returned more. The coverage claim is stated as a measurement
against *this* estate rather than as a property of the product, because another deployment's
detection-rule set could make the two answers differ.

The row therefore stays, and its verdict stays `same answer, field lost`: the field is real,
it is the only thing keeping the call, and the tool now says so instead of claiming coverage
it does not have. Two guards hold that in place — the pointer to
`list_installed_software_by_endpoint` must name a tool that exists (see §"The guard"), and
`REGISTRY_ITEM_FIELDS` in `inventory-scans-v11.ts` carries a comment saying `ProductName` and
`Version` are now load-bearing, since projecting either away would leave the tool with no
reason to exist.

### 2. `InventoryDataFileScans` → nothing

No v2.0 tool in the suite returns a file path. Checked three ways, because "no candidate" is
the strongest row type and the easiest to assert carelessly:

- The whole advertised surface — **221 tools with every gate open**, of which 216 are v2.0 and
  five are the v1.1 slice itself — contains no v2.0 tool that takes or returns a file path.
  The only tool in the suite whose name carries "file" is `get_endpoint_file_inventory`, the
  v1.1 one under discussion.
- `GET /endpoints/v2.0/InventoryDataFileScans`, `/software/v2.0/WindowsEndpoints/{id}/…`, and
  `/endpoints/v2.0/WindowsEndpoints/{id}/InventoryData` all answer **404**.
- The 26R1 OpenAPI documents for endpoints and software describe no such path.

The v1.1 answer is small (1.5 KB per endpoint) and carries `Path`, `Size`, `LastWriteTime`,
`Version`, `Company`, `ProductName` per match, across 3–4 templates per endpoint. Nothing in
v2.0 is close.

### 3. `InventoryDataWMIScans` → `get_endpoint` — partial, and template-dependent

`get_endpoint` (type `WindowsEndpoint`) answers the **hardware-summary** question and answers
it well: `manufacturer`, `modelName`, `serialNumber`, `uuid`, `totalRAM`, `bootMode`,
`osVersionText`, `primaryMAC`/`macList`/`ipList`, a structured `cpu` object (name, type,
architecture, frequency, physical/logical/total cores) and a structured `storageMedia` array
down to volumes, file systems and free space.

In one respect it beats the scan: `serialNumber` is populated, while this estate's
`Win32_BIOS` scan does not collect `SerialNumber` at all (it returns four properties:
`BiosCharacteristics`, `BIOSVersion`, `Manufacturer`, `ReleaseDate`).

What it structurally cannot do is return **an arbitrary WMI class**. Of the 24 classes
collected on WORKSTATION1, roughly nine map onto a `get_endpoint` field
(`Win32_ComputerSystem`, `Win32_Processor`, `Win32_BIOS`, `Win32_LogicalDisk`,
`Win32_DiskDrive`, `Win32_DiskPartition`, `Win32_PhysicalMedia`, `Win32_PhysicalMemory`,
`Win32_NetworkAdapterConfiguration`) and **fifteen have no counterpart at all** —
`Win32_Bus` (180 instances, 348 KB), `Win32_PnPEntity`, `Win32_CacheMemory`,
`Win32_SystemSlot`, `Win32_PortConnector`, `Win32_VideoController`,
`Win32_ComputerSystemProduct`, `Win32_OnBoardDevice`, `Win32_CDROMDrive`,
`Win32_DesktopMonitor`, `Win32_BaseBoard`, `Win32_PhysicalMemoryArray`,
`Win32_SystemEnclosure`, `Win32_OperatingSystem`, `Win32_PageFile`.

**The caveat that limits this row:** the class set is defined by the scan template on the
estate, not by the release. Both endpoints probed here returned the same 24 classes, which is
consistent with one template, and a deployment with a different template will have a different
answer. This row is therefore a fact about 26.1.161.0 *and* about this estate's template.

### 4. `jobs` → `get_job_definition` — the same tool, and eleven fields short

This is the row `BCONNECT-V11-VS-V20.md` §3 predicted: the valuable gap is a field, not a
controller. Same job (`Clone Windows 10`, `d328dd09-…`), same question, both sides live:

`get_job_definition` returns ten fields — `id`, `name`, `displayName`, `type`, `folderId`,
`folder`, `category`, `description`, `comment`, `validity` — of which five are `null` on this
job.

v1.1 returns, and v2.0 does not carry at all:

| Field | Value on this job | Why it matters |
|---|---|---|
| **`Destructive`** | `true` | The flag the suite's destructive-assignment gate is built on (`destructiveRefusalMessage`). Without it that gate cannot be evaluated and the assignment proceeds disclosed-but-unchecked. |
| `Steps` | `[{Sequence: 1, Type: "CloningBackup"}]` | What the job actually does. |
| `AbortOnError` | `true` | Whether one failed step aborts the run. |
| `JobExecutionTimeout` | `0` | Per-job timeout; `0` estate-wide, per §5.1 of the capability analysis. |
| `Initiator` | the creating operator's UPN | Who created it. |
| `WindowsProperties` | 14 keys | `Priority`, `MinBandwidth`, `Options`, `RepeatedExecution`, `RetryInterval`, `UserActionType`, `MaxDelayMinutes`, `JobStartType`, `AtEndOfJobAction`, … — the execution behaviour that explains a failing job. |

**Neither side is a superset**, which is why this is enrichment rather than a migration: v2.0
carries `folder`, `folderId`, `category`, `description`, `comment` and `validity`, and v1.1
carries none of them. The shipped design — read v1.1 from inside a v2.0 tool, and disclose
when it could not be read — is the right shape for this row and should not be "fixed" into a
v1.1-only path.

**Correction to `BCONNECT-V11-VS-V20.md` §5.4**, which recorded `AbortOnError` as not returned
by 26R1: it **is** returned, at 26.1.161.0, on this job. `RemoveInstanceAfterCompletion` and
`WindowsProperties.MaxConcurrentTargets` remain absent, as §5.4 says.

### 5. `MicrosoftUpdateProfiles` → `get_update_management_endpoint` — the id, never the definition

v2.0 tells you **which** profile an endpoint is on (`updateProfileId`, `updateProfileName`)
and nothing about what that profile does. v1.1 returns all six profiles on this estate with
`UpdateDeferralPeriodInDays`, `BlockedClassifications` and `BlockedProducts`.

That difference is load-bearing rather than cosmetic, and the two rows below demonstrate it on
one machine: WORKSTATION1 is on `3. Production`, which blocks the `Drivers` classification —
and its v2.0 `blockedUpdates: 2` is exactly the two driver updates in its v1.1 update
inventory. **Without the profile definition, `blockedUpdates: 2` is a number with no
explanation.**

No v2.0 route serves profiles. `/updatemanagement/v2.0/Profiles`, `/UpdateProfiles` and
`/MicrosoftUpdateProfiles` each answer 404, and the 26R1 updatemanagement OpenAPI document
describes exactly two paths, `/v2.0/WindowsEndpoints` and `/v2.0/WindowsEndpoints/{id}` — both
of which the suite already exposes.

### 6. `MicrosoftUpdateInventories` → `get_update_management_endpoint` — the counts, never the items

v2.0's counts **reconcile exactly** with v1.1's itemisation, on both endpoints:

| | WORKSTATION1 | A-DC-01 |
|---|---|---|
| v1.1 update records | 18 (10 installed, 8 not) | 24 (10 installed, 14 not) |
| v1.1 not-installed, by classification | Drivers 2, Definition Updates 6 | Update Rollups 6, Security 4, Definition 4 |
| v2.0 `missingCritical / missingSecurity / missingOther` | 0 / 0 / 6 | 0 / 4 / 10 |
| v2.0 `blockedUpdates` / `deferredUpdates` | 2 / 0 | 0 / 0 |
| **totals agree** | 6 + 2 = 8 ✓ | 4 + 10 = 14 ✓ |

So this is the same data, aggregated. What has no v2.0 route is the **item**: `Title`,
`UpdateId`, `RevisionNumber`, `KBArticleIDs`, `CveIDs`, `SecurityBulletinIDs`, `MsrcSeverity`,
`Classification`, `Products`, `SupportURL`, `InstallationDeadline`, `IsInstalled`. Probed:
`/updatemanagement/v2.0/WindowsEndpoints/{id}/Updates`, `…/Inventory`,
`/updatemanagement/v2.0/Updates` and `/Inventories` all answer 404.

**Explicitly not a candidate, and it looks like one:**
`list_detected_vulnerabilities_by_endpoint` and `get_unpatched_endpoints` in
`bconnect-compliance`. They read a different data source — third-party vulnerability
detection, not the Microsoft Update inventory. On WORKSTATION1 compliance returns eight CVE
rows (`CVE-2025-14819`, `CVE-2025-4947`, …) and the eight missing Microsoft updates carry no
CVE ids at all, so the two sets do not overlap by even one item. Substituting one for the
other would produce a confident wrong answer, which is the specific failure this suite has
already shipped once.

---

## How this was completed, and why not from the PDF

`inventory-scans-v11.ts` carries this, and it is the whole methodology:

> Established by probing, not by reading the v1.1 PDF, which is the rule this project earned
> the hard way — building from the document is how `/MobileDeviceRules` and `/Pin` shipped as
> routes that do not exist.

**So the equivalence column was not filled from the PDF.** The document is a source of
*candidates*; only a live call establishes what a route returns, or that it exists. Two routes
have already shipped on the strength of the document alone and were not real.

Two probes produced everything above, and both are read-only:

| Script | What it establishes |
|---|---|
| `bConnect-MCP-main/scripts/v11/equivalence-probe.mjs` | Calls the v1.1 tool and the v2.0 candidate **as MCP tools, in-process over `InMemoryTransport`**, on the same object — because the audit's question is "can the v2.0 *tool* answer this", not "does some route exist". Takes an endpoint GUID; writes `equivalence-probe-<prefix>.json`. |
| `bConnect-MCP-main/scripts/v11/probe-v20-route-absence.mjs` | Whether a v2.0 *route* exists for what v1.1 is still called for. Distinguishes "the API has it, the suite has no tool" from "the API does not have it" — two very different remedies. |

### The calibration that makes the absence rows readable

Finding **F17** says bConnect answers **401, not 404**, for a URL whose module or version
segment does not exist — which would make every "404 means no such route" claim above
worthless if it applied here. It does not, and the route probe carries the calibration rows
that show why:

| Probe | HTTP |
|---|---|
| `/updatemanagement/v2.0/WindowsEndpoints` (known good) | **200** |
| `/updatemanagement/v2.0/ThisRouteDoesNotExist` (bad path, real module) | **404** |
| `/definitelynotamodule/v2.0/Whatever` (bad module) | **401** |

**So F17's 401 is a property of an unknown *module* segment, not of an unknown path.** Inside
a real module an unknown path answers 404 and the answer is readable. This is a refinement of
F17 rather than a contradiction of it, and it is what licenses every 404 quoted above.

**What a 404 still does not prove:** the probed names were guessed. A 404 on
`/updatemanagement/v2.0/Profiles` establishes that *that* route does not exist, not that no
route anywhere serves profiles under a name nobody thought of. For rows 5 and 6 the OpenAPI
document narrows it further — 26R1's updatemanagement module documents exactly two paths — but
for rows 1–3 the absence rests on the guessed names plus the specs plus the whole advertised
tool surface, and that is the honest strength of the claim.

---

## The guard

`bConnect-MCP-main/__tests__/v11-audit-covers-every-call-site.test.ts` reads this file and
fails when:

1. a v1.1 call site exists in the suite with **no row here**;
2. a row exists for a controller **nothing calls any more** — the reverse direction, so the
   table cannot go stale by keeping a call it no longer makes;
3. a row names **neither a v2.0 candidate nor an explicit "no candidate"**;
4. a row names a v2.0 tool **that the suite does not actually advertise** — the
   `/MobileDeviceRules` failure mode, transposed to this table;
5. a v1.1 **tool description** points at a tool that does not exist — the same failure one
   level down, and the thing that keeps row 1's corrected description honest: that description
   now steers callers to `list_installed_software_by_endpoint`, and a pointer at a renamed
   tool would route a model somewhere that cannot answer;
6. a row's verdict is **not one of the four defined above**;
7. a row has **no checked-against bMS version** that parses as one.

Call sites are discovered by running over the source, not by a list anyone maintains. What
makes that discovery complete is a fifth assertion: **exactly one file in the suite constructs
the `/bConnect/v1.1` root** (`packages/mcp-core/src/v11-client.ts`), so every v1.1 request in
the suite necessarily goes through `V11Client`, and scanning the files that reference
`V11Client` cannot miss one. If a controller argument is an expression the guard cannot
resolve to a literal, it **fails** rather than skipping — an unreadable call site is the one
case where quiet success would be worst.

**One thing the guard needs that the publication tree does not yet ship.** This document lives
at the working-repository root, and per `PUBLICATION-PROCEDURE.md` the publication tree's root
is `bConnect-MCP-main/` — so a published checkout has the v1.1 call sites and not the audit
that justifies them, and this guard will fail there. The guard resolves the file from an
ordered list of candidate paths (the `"install" "../install"` precedent in `release.sh`) and
names them all in its failure message. Shipping `V11-AUDIT.md` with the suite is the fix;
weakening the guard to skip when the file is absent is not, because "the audit is missing" and
"the audit is satisfied" would then look the same.

**And shipping it collides with the estate scrub, which is a decision rather than a
detail.** `PUBLICATION-PROCEDURE.md` §4 records that every `labcorp.local` identifier is gone
from the publication tree, verified by an independent sweep at zero hits. This document is full
of them — hostnames, endpoint and job GUIDs, a service-account UPN — because that is what
makes its numbers checkable. So publishing means running this file through the same replacement
map and re-running that sweep with it included. §4 has been amended to say so, including the
two things the scrub must not touch: the bMS version in each row (a vendor build number, and
the guard requires it) and the v2.0 tool names (the guard checks them against the real
advertised surface). The alternative — publish without the audit and without the guard — is a
legitimate choice, but it is the repository owner's to make explicitly, not one to arrive at by
a test quietly skipping.

**The probe scripts do not ship either.** `scripts/v11/` is on §4's removed list, so
`equivalence-probe.mjs` and `probe-v20-route-absence.mjs` are working-repository tooling. Their
captured output is gitignored for the reason the neighbouring rules exist: one run's JSON is a
full WMI dump, serial numbers and MAC addresses included.

---

## What has NOT been done

- **No second estate.** Every row is one bMS, `bms-srv1.labcorp.local` at 26.1.161.0. Row 3 in
  particular is partly a fact about this estate's WMI scan template.
- **No second release.** Nothing here says when a gap opened or predicts when it closes.
- **Row 1's coverage claim is not asserted by any test.** The description was corrected on
  2026-08-07 and a guard keeps its pointer from dangling, but nothing checks the underlying
  measurement — that `list_installed_software_by_endpoint` still covers everything the
  registry scan returns. That check needs a live bMS, so it lives in
  `scripts/v11/equivalence-probe.mjs` and runs when someone runs it, not in the suite.
- **`Scans[0].Template` is empty on this estate** (`""`, rendered as `(unnamed template)`), so
  nothing above distinguishes "one template" from "several templates that happen to collect
  the same classes". Both endpoints returning the same 24 WMI classes is consistent with
  either.
- **The endpoints probed were both Windows and both recently seen.** The v1.1 inventory
  controllers serve Windows endpoints only, so that is not a sampling choice, but a stale
  endpoint may answer differently and was not tried.
