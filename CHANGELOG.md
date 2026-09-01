# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Numbers in this file are measurements, not specifications.** Byte sizes, request and page counts,
> endpoint counts and timings were taken against this project's own development estate — one bMS 26R1
> instance with 26 endpoints — unless a line says otherwise. They record the direction and rough size
> of a change. They are not claims about what any other estate will produce, and a proportion such as
> "25 of 26" is one observation, not a rate.

## [26.1.8] - Unreleased

Every manifest in the suite reports `26.1.8` (the `52782e5` version-unify commit); this section is
where that content is tracked until the repository is actually tagged/released, so a reader comparing
the installed version to this file finds a matching heading instead of `[Unreleased]`.

### Post-evaluation hardening (2026-08-04 → 2026-08-21)

162 commits after the final enterprise evaluation. Suite 1,866 → **2,661** passing; test files
141 → **209**; repository-level guards 11 → **33**.

**Added**

- **A fourteenth server (`insights`)** the v26.1.7 download did not have, carrying composite
  questions that previously cost many calls. `get_endpoint_briefing` answers in one call what took
  seven; `get_estate_risk_briefing`, `get_patch_readiness`, `get_deployment_coverage` and
  `get_endpoint_reach` followed. Registered with the installer, the credential worksheet and the
  gateway, with the route proven end to end.
- **Blast-radius preview for every assignment path.** Previously it counted only the first 1,000
  members and presented that as the total — telling an operator a destructive action was safer than
  it was. It now bounds and discloses.
- **`countOnly` on five expensive tools**, so a model can ask how many instead of listing.

**Changed — what a call costs**

- **Per-tool response shaping, driven by measurement.** Every tool ranked by bytes per row first;
  `list_group_members`, the largest response in the suite, fell **−52.3%**. `list_asset_types`,
  `list_org_units`, `list_update_management_endpoints` and `list_job_definitions` also shaped.
  **Three candidate projections were declined** because measuring them showed no gain, and the
  numbers are recorded beside the code that keeps them raw.
- The catalogue rose by 6,153 B on the 13-server basis and that is the correct trade: paid once per
  session against 23–60% off every call of a shaped tool, and 20–193× on the composites.

**Security**

- **Cross-tenant cache isolation.** Two disk caches keyed on a fixed path with nothing recording
  which server the data came from. Two MCP configurations under one OS user pointing at two bMS
  instances resolved the same file and read each other's data — and `scan-recency` keys history by
  endpoint DISPLAY NAME, which collides across estates. Caches are now fingerprinted by base URL and
  credential (hashed, never stored), the fingerprint reaching the filename so two tenants never
  contend for one file, and the provenance is re-checked on read.
- **Object KEYS sanitised at the outbound chokepoint**, not only values, with lookalike keys flagged.
  The chokepoint claim the prompt-injection argument rests on is now enforced by a guard rather than
  asserted, and a hostile estate string is driven end to end to the model in test.
- **`nanoid` high-severity advisory closed** by pinning `^3.3.18` in overrides rather than by
  `npm audit fix`.
- **Least privilege asserted at startup**, after refuting an earlier design that could not work.

**Fixed — answer integrity**

- **The empty-page class, found live and closed everywhere.** A page-0 read returning nothing was
  treated as a complete answer by the fleet digest, the ghost hunt, `diagnose_job` and estate-risk.
- **`paginateAll` returned page 0 as the whole estate** when `totalPages` was present but not a
  finite number, and reported the walk COMPLETE. Every estate aggregate reads through it. `NaN`
  falsified three independent guards in `exposure.ts` at once, because every comparison against `NaN`
  is false — redundancy is no defence against that. It now throws; absent still means "last page".
- **`shortfallReason` had the same shape in the backstop**: a string `totalItems` switched the check
  off for five callers at once. Absent and unreadable are separate paths now, and deliberately not
  via `Number(x)`, which turns `true` into 1 and `""` into 0.
- **404 semantics measured rather than assumed** — 2,870 live reads across 78 routes took an
  ambiguous backlog from **94 to 22**, each remaining case recorded at the code with its reason.
- **Writes no longer discard the body the API declares** (ARCH-2), and **ARCH-2b** covers all 63
  write methods by taint analysis over the TypeScript AST, so a typed write cannot report what the
  API did not return. `assign_job_to_*` stops reporting a 207 as unqualified success;
  `start`/`restart_microservice` report a request accepted, not a transition done.
- **Absent data can no longer read as clean.** A sentinel date is an absent fact rather than a
  739,839-day-old one; clock skew is absorbed instead of producing a negative age; an unread group is
  refused rather than called LOW RISK; CVE counts are dated, because a detection is a claim about the
  past.
- **`resultTrustworthy: true` lost an overclaim.** It now means *every read finished* — explicitly
  not "you were shown the whole estate". Measured with two credentials on one estate, **all ten
  estate-wide aggregates diverge** under an RBAC-limited key and eight report `true` while giving
  different answers; several counts reach zero, which reads as an all-clear. All ten now carry an
  unconditional credential-scope disclosure from one shared constant, quoting no figures.
- **All 25 PATCH call sites now send `application/json-patch+json`**, the only media type the 26R1
  documents declare; 21 were sending `application/json`. **Tested live afterwards: the media type is
  NOT enforced** — a bare PATCH against a folder that exists returns 200 and applies — so this is
  conformance to the published contract, **not** a fix for a demonstrated failure. The guard's header
  previously claimed a 415 and that twenty-one write tools "could not have worked"; both were
  inferences from the specification presented as measured fact, and are corrected there.

**Fixed — guards that reported clean results for things they never examined**

- **A fourteenth server was invisible to six guards**, each carrying the same thirteen-name literal;
  four shipped docs advertised the wrong tool counts for days. A guard now forbids any hand-written
  server list without a recorded reason, and the catalogue ratchet was measuring 13 of 14.
- **`test-catalog-drift` had never executed in CI under any layout.** The workflow tested one path;
  once that was fixed the guard still skipped every server for a second hard-coded path and **exited
  0 having checked nothing**. Zero checks is now a failure.
- **`packages/mcp-core` coverage read 27.68% because its tests execute `build/` while coverage
  instrumented `src/`.** It is 73.87%. Branches went from 94 to 1,088.
- **Nine modules went from 10–37% to 100%**, and every workspace floor was raised to just under
  measured rather than merely met.
- Two guards had never run off Windows; a coverage loop could only ever report one failure because
  `set -e` aborted it at the first.

**Deployment**

- A guided installer: **four steps instead of eleven**, requirement checks, TLS failure diagnosis and
  a configuration GUI. Host configurations are generated for any supported MCP client through an
  allowlist constraining what may be written where.
- **Refuses to write a client's configuration while that client is running**, and re-reads every host
  file at the end of a run to confirm what landed.
- Two-stage machine/user deployment with a refusal that makes it safe; an offline bundle carrying the
  Node runtime; production-only packaging at half the file count, proven by running it. The bundle no
  longer carries the estate it was built against.
- Per-server bMS keys offered in the wizard, one shared key as the default.

**Infrastructure**

- **CI runs for the first time.** It had never run because GitHub Actions reads workflows only from
  the repository root and `ci.yml` sat one level down. Six jobs across Linux and Windows on Node
  22.15 and 24, plus coverage floors and a dependency audit.
- The publication cut is now **scripted and reproducible** — tracked files exported via `git archive`,
  the layout move applied, omissions declared once and read by both the cut and the guards, and an
  estate-identifier guard that ships and matches by salted hash so the published tree names nothing
  it removed.

### Security & correctness — Phase 4 (2026-08-03)

Six parallel audits (`phase4/`) then four implementation tranches. Every fix has a guard, and every
guard was made to fail before being trusted. Suite 1,378 → **1,494** passing; guards 5 → **11**.

**Fixed — wrong answers**

- **Unknown query parameters reached the wire in 11 of 13 servers.** `validateParameters` iterated over
  *rules*, so an argument with no rule was never examined, and bConnect answers HTTP 200 while silently
  ignoring an unrecognised key. Measured live: `SearchQuery` misspelt as `SearchQuer` returned **37,571
  rows instead of 1**, with the bogus key echoed back as honoured. `minCvss` — a real parameter of a
  *different* tool in the same server — behaved identically, so this was reachable by a model correctly
  remembering the wrong tool's parameter. Now refused centrally, with a suite guard.
- **Truncated reads reported as complete.** `get_security_posture` read one page and answered "No
  posture issues found" over a stubbed 12,400 threats; `scan-recency` cached a truncated walk and served
  it as fact; `get_unpatched_endpoints` reported the truncated array length as the estate size. All three
  now disclose bounds, send an explicit `OrderBy`, and refuse to cache an incomplete result.
- **Compact projections named nothing they removed.** `list_endpoints` kept 10 fields and silently
  dropped 43 — including `isDeactivated` (so "is this endpoint deactivated?" answered *no* on an estate
  with 20 ghost machines) and `logicalGroupId`, which is the id five other servers' group-scoped tools
  require. `meta.projectedAway` now names them, and `logicalGroupId` travels with its name.

**Fixed — security**

- **`X-Api-Key` was forwarded across cross-host redirects.** `follow-redirects` strips only
  `Authorization`, `Proxy-Authorization` and `Cookie`; `maxRedirects` was unset, so axios's default of 21
  applied. Both clients now set `maxRedirects: 0`.
- **The SEC-2 stderr fix never reached the server bootstraps** — its formatter was not exported, so 14
  bootstraps still handed raw `AxiosError`s to `util.inspect`, which walks `error.config.headers`. One
  had no `.catch()` at all.
- **No scheme check on `BCONNECT_BASE_URL`.** `http://` sent the API key — and the v1.1 domain
  credential — in clear text. Now refused unless `BCONNECT_ALLOW_INSECURE_HTTP=true`.
- **Path guard hardened** against `..;/` (IIS strips path parameters before resolving), quad-encoding,
  and Unicode compatibility forms. `assertSafePathSegment` moved onto the catalogue, having been wired
  into 3 of 13 servers.
- **Destructive job assignment is refused server-side.** `preview_assignment`'s REFUSE verdict was
  advisory only, and the two dynamic-group tools had no preview at all. Opt out with
  `ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT=true`.
- **Estate strings reaching advisory prose are bounded and stripped** of zero-width, bidi-override and
  Unicode TAG characters. See `SECURITY.md` → *Estate data is untrusted input* for what this does **not** do.
- `BCONNECT_AUDIT_LEVEL` now ships as `write` rather than `none`.

**Fixed — installer**

- **The installer collected v1.1 credentials and never wrote `BCONNECT_ENABLE_V11`**, so v1.1 tools were
  unreachable with no error. Adds UPN validation and a v1.1 reachability probe.
- **`verify-install` exited 0 on a completely broken install.** Fixing it exposed that the read probe for
  a default server called a tool the round-3 collapse had removed — the two defects concealed each other.
- Host-config credential containment moved from a two-name blocklist to an allowlist.
- New `install/lib/test-catalog-drift.mjs` derives the truth from the built servers.

**Changed — tool surface**

- `trigger_update_on_client` → **`refresh_local_admin_account_expiry`**. It is a baramundi LAPS operation
  described as a data refresh, and the only tool in 218 matching *trigger + update + client*.
- `list_installed_software_by_dynamic_group` → **`list_installed_software_by_universal_dynamic_group`**.
  It took a `universalDynamicGroupId`; those are a distinct group kind with a distinct id space.
- `get_microsoft_update_inventory` → **`get_endpoint_microsoft_update_inventory`**, unifying the four
  endpoint-scoped v1.1 reads on one name shape.
- HTTP **409/412/423** moved onto the actionable error channel. 409 was the suite's most-hit error path:
  25 of the development estate's 26 endpoints answered `GET .../MaintenanceWindow` with it, and it
  arrived as `-32603 InternalError`.
- The four `assign_job_to_*` tools now disclose **HTTP 207 partial success**.
- `list_update_management_endpoints` / `get_update_management_endpoint` now describe the missing-update
  counts they actually return, and say they are not the CVE-based tools.
- **Opaque ids name their producer**, with the server named when it differs. Costs ~1,090 tokens in the
  default posture; 33 tools consume an id only another server can produce and no description said so.

**Coverage floors** raised from a bar nothing could fail (compliance 16 against 86.62% actual) to three
points under measured, per server. The root floor moved 60 → 50 because it exceeded the suite's own
53.7% and failed `npm run test:coverage` on a clean checkout.

**`.gitattributes` added.** Without it a clone on Windows with `core.autocrlf=true` fails its own test
suite, and `git status` shows nothing wrong.

### Added — bConnect v1.1, behind a gate (2026-08-03)

bConnect v1.1 is a second API version the suite did not previously reach. It exposes capabilities
v2.0 has no route for, and it is **off by default**: the tools appear in `tools/list` only when
`BCONNECT_ENABLE_V11=true` **and** both `BCONNECT_V11_USERNAME` (UPN form) and
`BCONNECT_V11_PASSWORD` are set. That is the `ALLOW_WRITE_OPERATIONS` precedent — a deployment that
cannot authenticate to v1.1 pays no schema-token cost for tools it could never call. Hiding them is
the token optimisation; the refusal at dispatch is the control.

Two slices so far, both **GET-only by construction** — the shared client refuses any other method
before it reads a credential or opens a socket:

- **Microsoft Update** (`bconnect-updatemanagement-mcp`): `list_microsoft_update_profiles`,
  `get_endpoint_microsoft_update_inventory`.
- **Custom inventory scans** (`bconnect-endpoints-mcp`): `get_endpoint_registry_inventory`,
  `get_endpoint_file_inventory`, `get_endpoint_wmi_inventory`.

**Every fact below was measured against a live 26R1 server, not read from the v1.1 PDF.** Building
from the document is how `/MobileDeviceRules` and `/Pin` shipped as routes the API does not serve.
The v1.1 PDF describes six `InventoryData*Scans` controllers; four of them 404 on 26R1, and the
three that answer return scan *results per endpoint*, not the scan *definitions* the name suggests.

**v1.1 offers no paging on the inventory controllers at all.** `PageSize`, `Page`, `Skip`, `Top`,
`OrderBy` and `SearchQuery` each answer HTTP 400 "Unknown parameter"; the only parameter accepted is
`EndpointId`. So every tool in the inventory slice *requires* an endpoint id — not for convenience,
but because it is the only bound that exists. Measured unfiltered: file scans 11,797 B, registry
scans 325,058 B, **WMI scans 11,930,039 B**.

`get_endpoint_wmi_inventory` is consequently **two steps, with no escape hatch**. One endpoint's WMI
scan measured 585,464 B across 24 classes, of which `Win32_Bus` and `Win32_PnPEntity` alone are 96%
of the bytes while `Win32_BIOS` and `Win32_Processor` are under 1 KB each. Calling the tool without
`className` returns the index — every class, its instance count and its measured size, **1,934 B
against that 585 KB scan** — and naming a class returns just that class. There is deliberately no
argument combination that returns everything: `detail:true` without `className` is refused with
`-32602` before any request is sent. A bound a caller can switch off is not a bound.

Unlike v2.0 — which answers 200 and silently ignores a misspelt query parameter (finding D6) — v1.1
rejects the whole request with 400. A well-formed GUID that is not a Windows endpoint answers 404,
and a non-GUID answers 400; the three are diagnosed separately rather than collapsed into one
"request failed". Absent `Scans`, empty `Scans`, and a scan that ran and matched nothing are
likewise three different answers, because the operator's next action differs for each.

**Internal:** the v1.1 client moved from `bconnect-updatemanagement-mcp` into
`@bconnect/mcp-core` (`v11-client.ts`) when the second consumer arrived, rather than being copied.
The path-containment guard is untouched: the client takes a controller *name*, never a path, always
derives the v1.1 root itself, and refuses any method but GET — so it cannot express a
`/<module>/v2.0/` request. Tests assert that by trying.

### BREAKING — the MCP tool surface was deliberately revised (round 3, 2026-08-02)

`ROUND3-PLAN.md`'s Class C held 15 proposals back from round 2 for exactly this reason: every one
of them breaks the tool surface — a tool renamed, merged, removed, or its default response body
reshaped — and round 2 had been scoped to never do that. This entry is the decision, taken now,
to spend that breakage deliberately rather than defer it. See
`docs/MIGRATION-tool-surface.md` for the practical old-name → new-name guide; this entry explains
why.

**Why now, and why it gets more expensive later.** This project has no git remote and no
published client yet — nobody's script, agent config, or saved prompt currently depends on a tool
name we are about to change. The catalogue every client sees at session start cost **~46,900
tokens** (284 tools / 187,722 bytes, `EVAL-2026-08-02.md`) before this change, most of it 33
near-identical copies of one pagination schema in `bconnect-groups-mcp` and ~93 write-tool schemas
advertised unconditionally regardless of whether writes were even enabled. Fixing that shape later
— after a customer has a script calling `list_windows_endpoints_by_logical_group` by name, or a
saved agent prompt that enumerates tool names — turns the identical change into a semver-major
release with a deprecation window, parallel old/new tool names, and a customer migration project.
Today it is a rename. The choice was between paying a breakage cost now, while the number of
callers is exactly zero, or paying a larger one later while pretending a 0.x project already had a
stable contract. We chose now.

**What did not move.** Thirteen tools are wired into the live customer demo
(`DEMO-RUN-OF-SHOW.md` and the patch-queue demo) and were treated as a hard constraint throughout:
`assign_job_to_logical_group`, `create_job_instance`, `delete_job_folder`, `delete_job_instance`,
`diagnose_job`, `explain_job_failure`, `get_stale_endpoints`, `get_unpatched_endpoints`,
`get_vulnerability_exposure`, `preview_assignment`, `start_job_instance`, `stop_job_instance`,
`update_job_folder`. None of these names changed, none were merged away, and each was re-verified
present and dispatching correctly end to end against the built servers. **Operational note for the
demo:** seven of the thirteen are write tools in `bconnect-jobs-mcp`
(`create_job_instance`, `start_job_instance`, `stop_job_instance`, `delete_job_instance`,
`create_job_folder`\*, `update_job_folder`, `delete_job_folder`) and are now hidden from
`tools/list` unless `ALLOW_WRITE_OPERATIONS=true` — hidden, not disabled, so a direct call by name
still works either way, but an LLM client that only knows what it was shown in the catalogue will
not see them with the gate shut. The demo environment must run with the gate open.
(\* `create_job_folder` is not itself one of the 13 but ships alongside the others under the same
gate.)

**What changed, by server:**

- **`bconnect-groups-mcp` — 33 tools collapsed into 2.** Every `list_<type>_endpoints_by_<kind>_group`
  and `list_<type>_endpoints_by_ad_user` tool (33 names, one per OS type × group kind, all wrapping
  the same pagination-and-filter schema) is gone. In their place: `list_group_members(groupKind,
  groupId, memberType, …)` and `list_ad_user_endpoints(adUserId, endpointType, …)`. All 33 routes
  are still reachable — this is a name change, not a capability cut. Old id parameters
  (`logicalGroupId`, `staticGroupId`, …) are now rejected as unknown rather than silently dropped,
  and an unsupported `(groupKind, memberType)` pair or a filter the chosen route doesn't declare is
  now refused with `-32602` naming what's actually accepted — bugs that were previously unreachable
  (each old tool advertised only its own narrow schema) become reachable once one tool advertises
  the union, so the validation had to get stricter to match.
- **`bconnect-endpoints-mcp` — `list_group_endpoints` removed.** It issued the identical request as
  `list_endpoints_by_logical_group`, which accepts everything it did plus `SearchQuery` and
  `OrderBy`; the round-2 tool description already said "prefer this over `list_group_endpoints`"
  before this pass deleted the tool it was steering people away from. The 11 endpoint-shaped
  list/search tools now default to a compact 10-field row projection (`detail: true` for the raw
  record, `fields: [...]` to choose your own), and per-row `consoleLink`/`remoteDeskLink` were
  replaced suite-wide by one `consoleLinks` template block per response instead of one URI per row.
- **`bconnect-jobs-mcp` — `list_endpoint_job_instances` renamed to `list_job_instances_by_endpoint`**
  (naming-convention fix, `INT-47`; no other jobs tool was renamed, merged, or removed). The seven
  `list_job_instances*` tools now omit `steps[]` and any page-constant column by default —
  `includeSteps: true` or `detail: true` restores them — because `steps[]` alone measured at 34–44%
  of a job-instance page.
- **`bconnect-compliance-mcp` — two tools renamed** for the naming convention the rest of the suite
  already used: `list_detected_rule_violations_for_endpoint` →
  `list_detected_rule_violations_by_endpoint`, `list_detected_vulnerabilities_for_endpoint` →
  `list_detected_vulnerabilities_by_endpoint`. Nothing else in compliance changed shape.
- **Write tools are hidden from `tools/list` unless `ALLOW_WRITE_OPERATIONS=true`**, across all nine
  servers that declare any (`endpoints`, `jobs`, `software`, `assets`, `servermanagement`,
  `operatingsystems`, `variables`, `defensecontrol`, `updatemanagement`). Hiding is a token
  optimization, not a new security control — a hidden write tool called by name still returns the
  exact same `Write operation '<name>' is disabled…` refusal it always did; the gate that matters
  was already there. `bconnect-servermanagement-mcp`'s `list_api_keys` additionally now requires
  `ALLOW_SECRET_READ=true` (finding D1 — it returns the bMS API-key inventory and was, until now,
  the one credential-returning route neither the audit set nor the deny set covered).
- **`countOnly: true` added to every paginated `list_*` tool suite-wide** (npm workspace search:
  51 tools in the 10-package territory alone, plus the list tools in endpoints/jobs/software/groups)
  — returns `{ totalItems, filters? }` with no rows, because "how many" previously cost a full page.
- **Error channel unified (`INT-53`) across all 13 servers.** An expected API failure — HTTP 400,
  403, 404, or 429 from bConnect — now resolves as `{ isError: true, content: [...] }` instead of
  rejecting the JSON-RPC call with a thrown `-32603`. A client that detected tool failure only via
  `try { await callTool() } catch` will now see these four statuses as a *successful* call carrying
  `isError: true`, not a caught exception. 401, 5xx, TLS and transport failures are unchanged and
  still throw. The message text itself did not change.
- **Gateway (`bconnect-mcp-gateway`) — bearer-token authentication added, `SEC-7`.** This was the
  one Class C proposal with a cost to *not* shipping now: the compose file shipped
  `MCP_ALLOW_NO_AUTH=true`, which disarmed the gateway's own fail-closed guard by default. Setting
  `MCP_GATEWAY_AUTH_TOKEN` now requires every HTTP call to carry `Authorization: Bearer <token>`;
  without it, an unauthenticated `tools/list` goes from handing over the full 19,712-byte catalogue
  to a 140-byte `401` (`WWW-Authenticate: Bearer`). An authenticated caller sees a byte-identical
  response to before. `GET /health` stays open by design (container healthchecks and
  `verify-gateway.mjs` depend on it). stdio clients (Claude Desktop, Claude Code, VS Code, Cursor)
  do not go through the gateway and are unaffected. See `docs/MIGRATION-tool-surface.md` §
  "Gateway authentication" for the operator steps.

**Measured, before → after** (method: import the built `createServer`, drive `tools/list` over the
SDK `InMemoryTransport`, `JSON.stringify` the result, `Buffer.byteLength` utf-8 — same method as
`EVAL-2026-08-02.md`; figures below are 26R1, re-measured fresh against this commit's build):

| Posture | Tools | Bytes | ~Tokens (@4B/tok) |
|---|---|---|---|
| Before (baseline, unconditional writes shown) | 284 | 187,722 B | ~46,931 |
| After, `ALLOW_WRITE_OPERATIONS=true` (the demo's posture, all 13 protected tools present) | 252 | 173,763 B | ~43,441 |
| After, default posture (`ALLOW_WRITE_OPERATIONS` unset — what a fresh install sees) | 154 | 126,983 B | ~31,746 |

The demo posture only drops 32 tools (the 31 collapsed out of `bconnect-groups-mcp` plus the one
`list_group_endpoints` removal) — it still advertises every write schema, because the demo runs
with the gate open. The default posture is where the real saving lands: **60,739 fewer bytes,
~15,185 fewer tokens, every session that doesn't set `ALLOW_WRITE_OPERATIONS`** — which is every
session except a demo or an automation that explicitly opts in.

Representative per-call savings, measured on the development estate's real fixtures (not estimates) by the territories that
built them:
- `bconnect-groups-mcp` catalogue: 29,764 B → 3,778 B (**−87.3%**), −31 tool names.
- `bconnect-endpoints-mcp`, `list_windows_endpoints` 20-row page: 64,981 B (old default) → 8,782 B
  compact (**−86.5%**); `get_fleet_summary` over its 26 endpoints: 8,040 B → 6,261 B (**−22.1%**).
- `bconnect-jobs-mcp`, `list_job_instances` 20-row page (live 26R1 data): 21,389 B → 11,699 B
  compact (**−45.3%**); `countOnly: true` on the same query: 63 B (**−99.7%**).
- `bconnect-software-mcp`, `list_installed_software_by_endpoint` 20-row page: 8,630 B → 3,338 B
  compact (**−61.3%**); `countOnly: true`: 51 B (**−99.4%**).
- Gateway: an unauthenticated `tools/list` on `/endpoints/mcp` goes from 19,712 B to a 140-byte
  `401` (**−99.3%**); an authenticated caller's response is byte-identical to before.

Every server's `detail: true` returns the exact pre-existing response body — verified by object
identity in the endpoints and jobs test suites, and by string equality in software's — so nothing
that used to be reachable became unreachable; it moved behind an explicit opt-in.

### Security

Findings from the 2026-08-02 six-category evaluation (`EVAL-2026-08-02.md`, 62 verified
findings). Remediation record and adversarial review: `REMEDIATION-2026-08-02.md`.

- **Path traversal in tool ID parameters — CRITICAL, now closed.** `bconnect-endpoints-mcp`,
  `bconnect-jobs-mcp` and `bconnect-groups-mcp` each defined a local
  `validateToolArguments(name, _args)` whose body was a `switch` containing ~40 fall-through
  `case` labels and **no statements** — it validated nothing. Each of those packages also
  shipped a fully implemented `src/utils/mcp-tool-validation-rules.ts` (1,139 lines in
  endpoints, 1,287 in jobs) that no `index.ts` ever imported. Caller-supplied IDs therefore
  flowed unvalidated and unencoded into template-literal URL paths, and because the module
  prefix (`/endpoints/v2.0`) is only a prefix, `../` segments escaped into **any** bConnect
  module the shared service credential could reach. Confirmed live before the fix:
  `get_endpoint {id: "../LogicalGroups"}` returned the LogicalGroups collection,
  `get_endpoint {id: "../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints"}` returned 23
  BitLocker records, and `get_job_definition {id: "../../../servermanagement/v2.0/ApiKeys"}`
  returned the bMS API-key inventory. Fixed at two independent layers, because per-parameter
  validation alone depends on every one of ~28 call sites remembering to call it:
  - `packages/mcp-core/src/path-guard.ts` — `assertSafePathSegment()` / `encodePathSegment()`
    reject `/`, `\`, `..`, control characters, and single **and double** percent-encoded forms.
  - `BConnectClientBase` registers a request interceptor calling `assertRequestPathContained()`
    on the final relative URL before dispatch, so a call site that forgets to validate is still
    contained.
  - The three servers now wire their previously-dead validator into the CallTool handler as its
    first statement, ahead of the write gate.
  Verified after the fix by sweeping all 129 id-bearing read tools across all 13 built servers:
  zero not rejected. Legitimate cross-module traffic, valid GUIDs and query strings containing
  `..` are unaffected.
- **Credentials no longer printed to stderr on startup failure.** `testConnection()` passed the
  raw `AxiosError` to `console.error`, and Node's `util.inspect` walks `error.config.headers` —
  which carries `Authorization: Basic base64(user:password)` or `X-Api-Key`. It now receives a
  single preformatted, sanitised string.
- **Credential-bearing routes are auditable and deny-listed.** New
  `packages/mcp-core/src/security-routes.ts` is consumed by both the request guard and
  `AuditLogger.isSecuritySensitive()`, so a security-sensitive route is audited *before* it is
  refused (axios unshifts request interceptors, so the guard registered first runs last).
- **`update_bitlocker_pin` and `patch_local_admin_user_credentials` now sit behind the secret
  gate.** Both returned live secrets (BitLocker recovery keys / LAPS credentials) in their tool
  responses while governed only by `ALLOW_WRITE_OPERATIONS`; `SECRET_READ_TOOLS` now covers all
  four tools.
- **`.env.gateway` and `.env.production` are git-ignored.** The deployment docs instruct
  operators to create `.env.gateway`; `.gitignore` did not cover it. All 15 `.env.example`
  files remain tracked.
- **Gateway: DNS-rebinding / Origin protection** added for the Streamable HTTP transport
  (`bconnect-mcp-gateway/src/host-guard.ts`).
- **Compliance disk cache** now checks file type, symlinks, and (on POSIX) ownership and mode
  bits before trusting a cached vulnerability library.
- **Unknown query parameters are no longer forwarded.** List handlers spread the whole `args`
  object into the query string; the bConnect v2.0 API silently ignores unrecognised keys and
  returns HTTP 200 with the *full unfiltered* set, so a misspelled filter produced a confident
  wrong answer. Every `queryParams()` call site is now checked against its tool's advertised
  schema, and `PageSize` is bounded 1–1000.

### Changed
- **`BCONNECT_RELEASE` now defaults to `26R1`** (was `25R2`), matching the documented
  default and the advertised tool counts (e.g. 66 endpoints tools, 276 total). Following
  the README with no `BCONNECT_RELEASE` set previously registered the smaller 25R2 subset
  (60 endpoints tools) silently. Set `BCONNECT_RELEASE=25R2` explicitly on older servers;
  the 26R1-only tools 404 there. Added `BCONNECT_RELEASE` to the endpoints/jobs
  `.env.example` files.

### Removed
- **Per-server container files** (aligning with ADR-0003 — only the gateway is
  distributed as a container; the 13 servers run over stdio via Node/Claude Desktop).
  Removed `docker-compose.yml`, the 13 per-server `Dockerfile`s, and
  `build-tests/docker-smoke.test.sh`. These built each server from its own directory,
  which stopped working after the workspace refactor (no per-server lockfile;
  `@bconnect/mcp-core` is a private `file:` dependency). The gateway image
  (`docker-compose.gateway.yml` + `bconnect-mcp-gateway/Dockerfile`) is unaffected.
- **~12,000 lines of unreferenced generated OpenAPI types** (2026-08-02 evaluation), nine files
  each from `bconnect-endpoints-mcp/src/generated` and `bconnect-jobs-mcp/src/generated`.
- **Unused production dependencies** (`node-cache`, `winston`, `@types/node-cache`) from 12
  server manifests; `openapi-typescript` / `openapi-fetch` moved to `devDependencies`.
- **The SDK `_requestHandlers` monkey-patch** in `bconnect-endpoints-mcp`, whose tests now run
  over a real `InMemoryTransport`.

### Fixed
- **Startup connectivity check.** `BConnectClientBase.testConnection()` probed a
  non-existent `/info` route (always 404) — latent because every deployment either set
  `BCONNECT_SKIP_CONNECTIVITY_CHECK=true` or ran the gateway (which never probes). A
  standalone server started from a plain `.env` (no skip flag) failed at startup. It now
  probes a real lightweight list endpoint, overridable via `healthCheckPath` for credentials
  scoped away from endpoints.
  **Corrected 2026-08-02:** the replacement probe was still broken in two ways, both fixed now.
  The path `/v2.0/WindowsEndpoints` omitted the **module segment** — module clients use
  `/endpoints/v2.0`, `/defensecontrol/v2.0` etc., and `baseURL` is the bare `baseUrl` — so the
  probe resolved to `/bconnect/v2.0/WindowsEndpoints` and returned **401 on every server**. No
  server overrode `healthCheckPath`, so there was no working configuration; deployments only
  survived by setting `BCONNECT_SKIP_CONNECTIVITY_CHECK=true`. The default is now
  `/endpoints/v2.0/Endpoints`. Separately, the probe sent OData `$top=1`, which the v2.0 API
  does not implement — it was silently ignored and the probe fetched a full default page
  (~80 KB instead of ~3.9 KB). It now sends `PageSize: 1`.
- **esbuild** dev dependency bumped `0.27.7` → `0.28.1` (Dependabot alerts; dev-only).
- **TLS: honor the OS/client CA trust store on Node ≥ 22.15** (issue #59) — an
  already-trusted enterprise CA now works without a manual export; clearer TLS errors.
- **Docs** actualized: build-from-root (workspaces) instructions, Node 22 baseline,
  gateway-only Docker guide, credentials-at-rest hardening, and a Repository layout section.

#### Performance (2026-08-02 evaluation)

- **HTTP keep-alive was off on every request.** The client built `new https.Agent(opts)` with no
  `keepAlive` key; unlike `https.globalAgent`, a hand-constructed agent defaults to
  `keepAlive: false`, so every API call paid a fresh TCP+TLS handshake (measured: 20 requests =
  20 handshakes, 3.3 ms/req vs 0.5 ms/req on loopback — worse on a real network). Now
  `keepAlive: true, keepAliveMsecs: 15000, maxSockets: 32, maxFreeSockets: 8`. The agent-level
  `timeout` is deliberately left unset — it would cap in-flight requests, not just idle sockets.
- **`timeout`, `maxRetries` and `retryDelay` were unreachable.** They existed in the config type
  but no deployment could set them, leaving the axios default of 30,000 ms sitting exactly on the
  server's own ~30 s deadline. Now settable via `BCONNECT_TIMEOUT_MS`, `BCONNECT_MAX_RETRIES`,
  `BCONNECT_RETRY_DELAY_MS`, each defaulting to the previous hardcoded value.
- **Serial pagination in composite tools** replaced with a shared `paginateAll()` helper
  (`packages/mcp-core/src/paginate.ts`). The 37,571-row vulnerability library was fetched in ~38
  sequential page requests.
- **Independent fetches now run concurrently** in the composite tools that awaited them serially.
- **CA certificate and `.env` re-read from disk on every tool call**; the CA read is now memoised
  on (path, mtime, size), falling through to a real read when `stat` fails so ENOENT behaviour is
  unchanged.

#### Correctness and consistency (2026-08-02 evaluation)

- **API error detail is no longer discarded.** `handleError` mapped every HTTP failure to a fixed
  string, so a 404 became exactly `Resource not found.` — no resource type, no offending ID, and
  no hint that a 404 can also mean a wrong `BCONNECT_RELEASE`.
- **`bconnect-groups-mcp` used two different TLS variables**: `BCONNECT_REJECT_UNAUTHORIZED` for
  the runtime client and `NODE_TLS_REJECT_UNAUTHORIZED` for the startup client. Both now resolve
  through one function. The variable name is unchanged, so the documented behaviour still holds.
- **Root README documented audit levels that do not exist.** It listed `none, info, verbose` and
  the Security section recommended `BCONNECT_AUDIT_LEVEL=info`; the code accepts only
  `none|security|write|all` and silently coerced anything else to `none` — so following the
  project's own hardening advice disabled auditing. README corrected and an unrecognised level
  now warns on stderr instead of silently coercing.
- **13 per-server READMEs documented phantom environment variables.** `AUDIT_LOG_LEVEL` is read
  nowhere and was removed from all 13. `BCONNECT_REJECT_UNAUTHORIZED` is genuinely read by
  `bconnect-groups-mcp` only, so it survives — annotated as a deliberate divergence — and was
  removed from the other 12.
- **Documented tool counts were stale**; all per-server counts and the 284 total now match the
  live `tools/list` output of the built servers.
- **`bconnect-groups-mcp` had no `.env.example`** (the only server missing one). Added.
- Added `BCONNECT_TIMEOUT_MS`, `BCONNECT_MAX_RETRIES`, `BCONNECT_RETRY_DELAY_MS`,
  `BCONNECT_AUDIT_INCLUDE_PARAMS`, `ALLOW_WRITE_OPERATIONS` and `ALLOW_SECRET_READ` to the README
  configuration table and the `.env.example` files.

#### Build, test and CI (2026-08-02 evaluation)

- **Root `npm run build` never built `@bconnect/mcp-core`.** It looped over
  `bconnect-*-mcp bconnect-server-template`, a glob that cannot match `packages/mcp-core`, whose
  exports map points at `./build/index.js` with no `prepare` hook — so a clean clone could not
  build at all. Now `npm run build --workspaces --if-present`, which also picks up the gateway.
  `audit` and `sbom` had the same defect and were fixed the same way.
- **The CI gate never ran the tests that exercise real client/module logic.** Root
  `vitest.config.ts` excludes `**/mock-integration/**` and `scripts/ci-local.sh` never invoked
  `test:mock`, so the only tests that instantiate a real client were never run. The mock tier is
  now wired in, env-gated on `BCONNECT_MOCK_URL`, and **states explicitly when it did not run**
  instead of reporting green.
- **Mock tests self-skipped via an early `return`**, so an unreachable mock reported as passing.
  They now use `it.skip`, which reports as skipped.
- **eslint was configured with real rules but wired to nothing.** Now wired into
  `scripts/ci-local.sh` and a root `lint` script, deliberately **non-blocking for now** and
  reporting its count (92 problems, down from 105).
- **Coverage thresholds** are now enforced at the *measured* floor per package rather than a
  declared-but-unenforced 60% that no package could pass. See Known issues.
- Per-package `tsconfig.json` / `vitest.config.ts` reduced to `extends` of shared bases.

### Known issues (opened by, or left open after, the 2026-08-02 remediation)

- **`trigger_update_on_client` is currently unreachable** — a surface regression. The LAPS
  deny-list pattern `/LocalAdministrativeAccounts/i` covers the whole sub-tree, but this tool
  does not return a credential; it asks the client to refresh one. It also fails as a thrown
  `-32600` rather than the `isError` shape the sibling gate uses, so one policy produces two
  client-visible shapes. Pending decision.
- **Every MCP error message carries a doubled prefix** (`MCP error -32602: MCP error -32602: …`).
  `McpError.message` already embeds the prefix and the server serialises `error.message` into the
  JSON-RPC `error.message` field. Systemic, and now on every rejection this remediation added.
- **`packages/mcp-core` and `bconnect-mcp-gateway` are outside the lint gate.**
  `eslint.config.cjs` scopes its TS-parser block to `bconnect-*-mcp/src/**`, so every new
  security-critical file (`path-guard.ts`, `security-routes.ts`, `host-guard.ts`,
  `server-pool.ts`) is unlinted. Must be fixed before lint is made blocking.
- **`preview_assignment` still truncates at one page.** It fetches LogicalGroups and Endpoints
  with `PageSize: 1000` and no `paginateAll`, and the result feeds the REFUSE/CONFIRM verdict —
  so the suite's blast-radius safety primitive under-reports on estates over 1000. Latent on the
  current 26-endpoint estate.
- **`bconnect-jobs-mcp` still ships the SDK `_requestHandlers` monkey-patch** (removed from
  endpoints only).
- **Root `package.json` still declares `node-cache`, `winston`, `limiter` and
  `@types/node-cache`** as production dependencies; nothing imports them. `package-lock.json` is
  stale against the manifest changes — `npm ci` still succeeds but reproduces the old tree.
- **Generated types are still 25R2, not 26R1**, papered over with a local intersection type in
  `bconnect-endpoints-mcp`. The 26R1 `UnmanagedEndpoints` routes are absent entirely.
- **Compliance disk-cache hardening is inert on Windows** — ownership and mode-bit checks gate on
  `process.getuid`, and the four tests covering them skip on non-POSIX hosts.

## [26.1.7] - 2026-07-14

> Version bumped `26.1.5` → `26.1.7` across the suite (26.1.6 was documented but
> never tagged/released).

### Removed (breaking)
- **Gateway token-map authentication (`MCP_AUTH_CONFIG`).** The gateway no longer
  authenticates callers or maps Bearer tokens to bConnect credentials. Per ADR-0003,
  **authentication is the operator's responsibility** — front the gateway with an
  authenticating, TLS-terminating reverse proxy / IdP — and the gateway uses a single
  `BCONNECT_*` **service credential** (bMS RBAC governs it). Removed `MCP_AUTH_CONFIG`,
  the token map, hashed-token mode, and the `hash-token` helper.

### Changed
- Gateway fail-closed default: a non-loopback bind now requires `MCP_ALLOW_NO_AUTH=true`
  (asserting an authenticating proxy is in front). Loopback bind is otherwise unchanged.
- Inbound rate limiting is now keyed **per client IP** (was per Bearer token).
- `docker-compose.gateway.yml` publishes the host port on **loopback only** by default.
- README / `docs/DOCKER.md` / `docs/INSTALLATION.md` / `docs/N8N.md` updated to the
  proxy-fronted, service-credential model, with a prominent operator-security notice.
- **Node.js baseline raised to 22 (LTS).** Docker images now build on `node:22-alpine`
  and `engines.node` is `>=20.0.0` (18 is EOL). The automatic OS-trust-store behavior
  below requires Node ≥ 22.15.

### Fixed
- **TLS: honor the OS/client CA trust store (issue #59).** Node validates TLS against
  its bundled CA list only and never reads the OS certificate store, so an internally
  signed bMS certificate that Windows already trusts still failed until the admin
  manually exported it and set `BCONNECT_CA_CERT_PATH`. On **Node.js ≥ 22.15** the
  shared client now merges the OS trust store (`tls.getCACertificates("system")`) with
  Node's bundle, so an already-trusted CA works with **zero export**. `BCONNECT_CA_CERT_PATH`
  remains an explicit override; behavior is unchanged on older Node (feature-detected).
- **Clearer TLS errors.** A certificate-not-trusted failure now returns an actionable
  message (upgrade Node, set `BCONNECT_CA_CERT_PATH`, or `NODE_EXTRA_CA_CERTS`) instead
  of a generic "cannot connect".

## [26.1.6] - 2026-06-17

### Added
- **`docker-compose.gateway.yml`** — new dedicated Docker Compose file for the
  HTTP gateway (multi-user / n8n) use case. Separates the gateway deployment from
  the stdio server deployment (`docker-compose.yml`). Includes healthcheck and
  token map volume mount.
- **`.env.gateway.example`** — new env template for the gateway, containing only
  the variables it needs: `BCONNECT_BASE_URL`, TLS settings, `MCP_AUTH_CONFIG_PATH`,
  `MCP_GATEWAY_HOST_PORT`, and commented single-credential fallback vars. Used with
  `--env-file .env.gateway`.

### Changed
- **`docker-compose.yml`** — gateway service (`mcp-gateway`) removed; stdio-only now.
- **`.env.example`** — simplified to stdio use case; gateway variables removed.
- **Token map examples** across README, `docs/INSTALLATION.md`, `docs/DOCKER.md`,
  and `docs/N8N.md` — removed `baseUrl` from per-user entries. `BCONNECT_BASE_URL`
  is set once in `.env.gateway` and shared by all tokens; `baseUrl` in a token entry
  is now documented as an advanced/multi-server override only.
- **`docs/N8N.md`** — added AI Agent + MCP tool node setup guide (Step 2: MCP Server
  credential, Step 3: wire Tool: MCP sub-node); added **Context Window & Performance**
  section with token cost table per domain combination and per-use-case domain
  recommendations.
- All gateway startup commands updated to use
  `docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d`.
- All `.env` references in gateway context corrected to `.env.gateway` across
  `docker-compose.gateway.yml`, README, `docs/INSTALLATION.md`, `docs/DOCKER.md`,
  and `docs/N8N.md`.

## [26.1.5] - 2026-06-16

### Added
- **`docs/N8N.md`** — new integration guide for using the bConnect MCP gateway
  from n8n workflows. Covers: storing Bearer tokens as n8n Header Auth credentials,
  MCP Client node configuration, HTTP Request node alternative, domain reference
  table, multi-user example (2 users / 2 bConnect API keys), troubleshooting table,
  and security notes.

### Changed
- **`docs/INSTALLATION.md` Option D** rewritten for clarity: broken into 4 explicit
  steps (build, generate tokens, create token map, start gateway); token requirements
  documented (min 32 random bytes, unique per user, descriptive prefix); placeholder
  table explains every value to replace; apiKey vs username/password options clarified;
  health check verification and `chmod 600` guidance added.
- README and `docs/INSTALLATION.md` updated with pointer to the new N8N.md.
- Version bumped to `26.1.5` across all `package.json` files, `src/index.ts` server
  version strings, and documentation footers (`DOCKER.md`, `INSTALLATION.md`,
  `TROUBLESHOOTING.md`, `WINDOWS-DEPLOYMENT.md`, `N8N.md`).
- **SBOM regenerated** (`releases/sbom.json`) using `@cyclonedx/cyclonedx-npm` 5.0.0
  (previously 4.2.1); updated timestamp, version reference, and dependency tree.
- `docker-compose.yml` gateway image tag corrected from stale `26.1.1` to `26.1.5`.

## [26.1.4] - 2026-06-16

### Added
- **Auth middleware unit tests** (`bconnect-mcp-gateway/src/__tests__/auth.test.ts`, 23 tests):
  `loadTokenMap` and `createAuthMiddleware` are now fully covered — missing file,
  invalid JSON, non-object root (all call `process.exit(1)`); auth disabled pass-through;
  401 on missing/wrong/unknown Bearer token; correct credential resolution per token;
  no credential leakage between requests; n:m sharing verified.
- **Credential injection tests** (`bconnect-compliance-mcp/src/__tests__/credentials.test.ts`,
  6 tests): verifies that `createServer(credentials)` passes injected apiKey and
  username/password to `BConnectClient`, takes priority over env vars, falls back to env
  vars when omitted, and is stateless across tool calls. `BConnectClient` is mocked so
  no real bConnect connection is made.
- **Gateway refactored** into three modules for testability: `auth.ts` (token map +
  middleware, no server imports), `app.ts` (`createApp` factory), `gateway.ts` (startup
  only). The public gateway behaviour is unchanged.
- **`bconnect-mcp-gateway`** now has `test`, `test:watch`, and `test:coverage` npm
  scripts with a `vitest.config.ts`.

## [26.1.3] - 2026-06-16

### Added
- **Gateway authentication via token map** (`MCP_AUTH_CONFIG`): `bconnect-mcp-gateway`
  now supports per-user Bearer token authentication. Set `MCP_AUTH_CONFIG` to a JSON
  file mapping tokens to bConnect credentials (baseUrl, apiKey or username/password).
  Multiple MCP tokens can share one bConnect API key (n:m mapping). When unset, the
  gateway falls back to `BCONNECT_*` env vars — fully backwards compatible.
- `BConnectCredentials` interface exported from all 13 servers; `createServer()` now
  accepts an optional `credentials` parameter so the gateway can inject per-request
  bConnect credentials without touching environment variables.
- Gateway environment variables: `MCP_GATEWAY_PORT` (default `3001`),
  `MCP_GATEWAY_BIND` (default `127.0.0.1`), `MCP_AUTH_CONFIG`.
- `/health` endpoint now reports `authEnabled` status.
- Documentation updated: README, `docs/INSTALLATION.md`, `docs/DOCKER.md` — covers
  gateway setup, token map format, and client configuration examples.

## [26.1.2] - 2026-06-09

### Fixed
- Updated copyright from "baramundi software AG" to "baramundi software GmbH"
- Resolved all runtime dependency vulnerabilities (hono, fast-uri, ip-address)
- Set author field in package.json

### Added
- Dependabot configuration for automated dependency updates
- `.editorconfig`, `.nvmrc`, and `.prettierrc.json` for contributor consistency

## [26.1.1] - 2026-06-09

Initial release. 12 domain-specific MCP servers for the baramundi bConnect REST API,
providing 212 tools across endpoints, jobs, assets, software, compliance, and more.

- 12 servers: endpoints, jobs, assets, software, activedirectory, servermanagement,
  defensecontrol, variables, operatingsystems, compliance (26R1), universaldynamicgroups (26R1),
  updatemanagement
- Compatible with baramundi Management Suite 25R2 and 26R1
- Authentication via Basic Auth or API Key
- Transport modes: stdio (local) and HTTP (network/Docker)
- Unit tests and mock-integration tests across all servers
