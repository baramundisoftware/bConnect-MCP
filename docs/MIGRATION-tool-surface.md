# Migration guide: 2026-08-02 tool surface revision

This is a practical guide for updating a script, agent config, or saved prompt written against the
MCP tool surface **before** this change. It is deliberately mechanical — old name → new name,
old shape → new shape, and the flag that restores the old behaviour where one exists. For the
reasoning behind *why* this was done, and why it was safe to do now, see the "BREAKING — the MCP
tool surface was deliberately revised" entry in [`CHANGELOG.md`](../CHANGELOG.md).

> ## ⚠️ First, the requirement that decides everything else: **bMS 26R1 or later**
>
> This release drops support for baramundi Management Suite 25R2 and older, and removes the
> `BCONNECT_RELEASE` environment variable that used to select between them. If you are upgrading
> from v26.1.7 while still running an older bMS, the servers will **refuse to start** — see
> [§10](#10-the-suite-is-now-26r1-only) for what changed and what to do.
>
> The most visible consequence is that **the five `*_industrial_endpoint` tools are gone**,
> because 26R1 removed the bConnect API behind them — see [§4](#4-removed-tools).

**The 13 tools wired into the live demo did not change name, shape, or behaviour**, and need no
migration: `assign_job_to_logical_group`, `create_job_instance`, `delete_job_folder`,
`delete_job_instance`, `diagnose_job`, `explain_job_failure`, `get_stale_endpoints`,
`get_unpatched_endpoints`, `get_vulnerability_exposure`, `preview_assignment`,
`start_job_instance`, `stop_job_instance`, `update_job_folder`. Several of them are write tools
and are therefore only *advertised* in `tools/list` when `ALLOW_WRITE_OPERATIONS=true` (see §3) —
but calling any of the 13 by name has always worked and still does, gate open or shut.

---

## 1. Am I affected?

You are affected if your integration does any of the following:

- Calls a tool by one of the renamed or removed names in §2/§4.
- Calls any of the 33 old `bconnect-groups-mcp` tools in §3.
- Parses a `list_*` response body assuming every field from before is still there (§6).
- Detects tool failure only by catching a thrown error, not by checking `result.isError` (§7).
- Matches on the literal string `bConnect API error:` in a caught error message (§8).
- Calls the gateway's HTTP endpoint (`bconnect-mcp-gateway`) without an `Authorization` header (§9).
- Enumerates `tools/list` and expects to see write tools without setting
  `ALLOW_WRITE_OPERATIONS=true` (§5).
- Runs against a bMS older than 26R1, or sets `BCONNECT_RELEASE` anywhere (§10).
- Calls any `*_industrial_endpoint` tool, or passes `memberType: "industrial"` (§4).

If none of the above applies, nothing to do — **except** the 26R1 requirement in §10, which
applies to everyone.

---

## 2. Renamed tools

Old name is gone from both `tools/list` and dispatch — calling it now returns `MethodNotFound`
(`-32601`), not a deprecation warning.

| Server | Old name | New name | Notes |
|---|---|---|---|
| `bconnect-jobs-mcp` | `list_endpoint_job_instances` | `list_job_instances_by_endpoint` | Route, arguments and required fields unchanged. |
| `bconnect-compliance-mcp` | `list_detected_rule_violations_for_endpoint` | `list_detected_rule_violations_by_endpoint` | Naming-convention fix; arguments unchanged. |
| `bconnect-compliance-mcp` | `list_detected_vulnerabilities_for_endpoint` | `list_detected_vulnerabilities_by_endpoint` | Naming-convention fix; arguments unchanged. |

Fix: change the tool name in the call. Nothing else about the request changes.

---

## 3. Merged tools — `bconnect-groups-mcp`: 33 tools → 2

Every `list_<type>_endpoints_by_<kind>_group` and `list_<type>_endpoints_by_ad_user` tool is gone.
All 33 routes are still reachable through two enum-parameterised tools:

- **`list_group_members(groupKind, groupId, memberType?, ...)`** — logical / static / dynamic /
  universal dynamic groups.
- **`list_ad_user_endpoints(adUserId, endpointType?, ...)`** — AD-user-scoped endpoint lists.

### Mapping table

`<type>` below is one of: *(omitted)* → `endpoints`, `android`, `ios`, `linux`, `mac`, `network`,
`windows`, `industrial`.

| Old tool call | New call |
|---|---|
| `list_endpoints_by_logical_group {logicalGroupId}` | `list_group_members {groupKind:"logical", groupId}` |
| `list_<type>_endpoints_by_logical_group {logicalGroupId}` | `list_group_members {groupKind:"logical", memberType:"<type>", groupId}` |
| `list_logical_groups_by_logical_group {logicalGroupId}` | `list_group_members {groupKind:"logical", memberType:"childGroups", groupId}` |
| `list_<type>_endpoints_by_static_group {staticGroupId}` | `list_group_members {groupKind:"static", memberType:"<type>", groupId}` |
| `list_<type>_endpoints_by_dynamic_group {dynamicGroupId}` | `list_group_members {groupKind:"dynamic", memberType:"<type>", groupId}` (only `endpoints`/`windows` exist) |
| `list_<type>_endpoints_by_universal_dynamic_group {universalDynamicGroupId}` | `list_group_members {groupKind:"universalDynamic", memberType:"<type>", groupId}` |
| `list_<type>_endpoints_by_ad_user {adUserId}` | `list_ad_user_endpoints {adUserId, endpointType:"<type>"}` (only `endpoints`/`android`/`ios`/`linux`/`mac`/`windows` exist) |

Every one of the 33 old tool names maps to exactly one of the two rows above, parameterised by its
`<type>` and `<kind>`. There is no tool this collapse removed capability from.

### What else changed on this surface

1. **Parameters renamed.** `logicalGroupId` / `staticGroupId` / `dynamicGroupId` /
   `universalDynamicGroupId` → `groupId` (plus the new `groupKind` selector). `adUserId` is
   unchanged. **The old parameter names are now rejected as unknown (`-32602`)**, not silently
   dropped — a half-migrated call that still sends `logicalGroupId` fails loudly instead of
   quietly querying nothing.
2. **Not every `(groupKind, memberType)` pair is a real route.** 12 of the 45 nameable
   combinations don't exist: `dynamic` serves only `endpoints`/`windows`; `childGroups` exists only
   under `logical`; AD users serve neither `network` nor `industrial`. An unsupported pair returns
   `-32602` naming the member types that `groupKind` actually supports.
3. **Filters are per member type, and unsupported filters are now rejected**, not silently ignored
   by the API. `android`/`ios` accept `DisplayName` only; `windows` additionally accepts `Domain`
   and `EntraIdDeviceId`; `industrial` accepts none; `childGroups` accepts `Name`, `Dip`, `Domain`;
   everything else accepts `DisplayName`/`HostName`. Passing a filter the chosen route doesn't
   declare returns `-32602` naming the ones it does.
4. **`includeSubfolders` is rejected on any `groupKind` other than `logical`.**
5. **`countOnly: true`** (new, both tools) returns `{ totalItems, filters? }` instead of a page.

See `bconnect-groups-mcp/README.md` § "Migrating from the 33-tool surface" for the same table with
live commentary from the team that built it.

---

## 4. Removed tools

| Server | Removed tool | Use instead |
|---|---|---|
| `bconnect-endpoints-mcp` | `list_group_endpoints` | `list_endpoints_by_logical_group` — same route, same parameters, plus `SearchQuery` and `OrderBy` that the removed tool never had. |

### The industrial-endpoint tools — removed because the API was removed

These five tools were deleted, and **there is no replacement**:

| Server | Removed tool | Route it used to call |
|---|---|---|
| `bconnect-endpoints-mcp` | `list_industrial_endpoints` | `GET /v2.0/IndustrialEndpoints` |
| `bconnect-endpoints-mcp` | `get_industrial_endpoint` | `GET /v2.0/IndustrialEndpoints/{id}` |
| `bconnect-endpoints-mcp` | `create_industrial_endpoint` | `POST /v2.0/IndustrialEndpoints` |
| `bconnect-endpoints-mcp` | `update_industrial_endpoint` | `PATCH /v2.0/IndustrialEndpoints/{id}` |
| `bconnect-endpoints-mcp` | `delete_industrial_endpoint` | `DELETE /v2.0/IndustrialEndpoints/{id}` |

**This is not a product decision to shrink the tool surface.** bConnect 26R1 removed the
`IndustrialEndpoints` resource outright — 8 operations and 3 schemas are gone from the 26R1
OpenAPI specification. Since the suite is now 26R1-only (§10), every one of these tools would
have returned `404` against every supported server. Keeping them would have advertised
capability the API no longer has.

`bconnect-groups-mcp` lost the same capability in its own shape: **`industrial` is no longer a
valid `memberType`** on `list_group_members`, because the three group-scoped industrial routes
went with the resource. Passing it now returns `-32602` naming the member types that remain.

**Calling a removed industrial tool by name does not give you a generic unknown-tool error.**
It returns a message naming the actual reason — that 26R1 removed the underlying bConnect API,
so the tool was removed rather than renamed or moved. This exists specifically for someone
upgrading from v26.1.7 whose saved prompts or scripts still reference these names.

One thing that deliberately did **not** change: the `Deprecated_IndustrialEndpoint` value
survives in the generated endpoint-type enum. That is the vendor's own choice — their spec
comments it "Removed in 26.1. Keep to avoid gaps in enum values." Historical records may still
carry it, and dropping it would break their deserialisation. If you read an endpoint `type`
field, keep handling that value.

**If you used these tools:** there is no equivalent in 26R1. Industrial endpoints managed
through the old resource must be handled in the baramundi Management Center. If your integration
enumerated all endpoint types, drop `industrial` from that list.

Apart from the above, no tool was deleted outright anywhere in the suite (the groups collapse in
§3 is a rename, not a deletion — every route it covered is still reachable).

---

## 5. Write tools are hidden from `tools/list` by default

Nine servers declare write tools (create/update/delete/start/stop/assign/link/patch/trigger):
`bconnect-endpoints-mcp`, `bconnect-jobs-mcp`, `bconnect-software-mcp`, `bconnect-assets-mcp`,
`bconnect-servermanagement-mcp`, `bconnect-operatingsystems-mcp`, `bconnect-variables-mcp`,
`bconnect-defensecontrol-mcp`, `bconnect-updatemanagement-mcp`. In all nine, **write tools are no
longer returned by `tools/list` unless `ALLOW_WRITE_OPERATIONS=true`.**

This changes what an LLM client *sees*, not what it can *do*:

- **Hiding is not disabling.** A write tool called by name — whether or not it appears in
  `tools/list` — is dispatched exactly as before and refused with the same
  `Write operation '<name>' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write
  operations.` message if the gate is shut. The security boundary is unchanged; only the
  catalogue's visibility changed.
- **If your integration enumerates `tools/list` and expects to find a write tool there**, set
  `ALLOW_WRITE_OPERATIONS=true` in that server's environment. This is what the demo environment
  must do — 7 of the 13 demo-protected tools are writes.
- **If your integration calls write tools directly by name** (never reads `tools/list` to discover
  them), nothing changes for you.

Per-server tool counts, default vs. `ALLOW_WRITE_OPERATIONS=true`. These are **measured, not
hand-counted**: import each server's built `createServer`, connect it to an SDK
`InMemoryTransport`, and count / `JSON.stringify` the `tools/list` result. There is no longer a
second set of figures per release — the suite is 26R1-only (§10), so the release-conditional tool
registration that produced them is gone.

| Server | Default | With the gate open |
|---|---|---|
| `bconnect-endpoints-mcp` | 10 | 31 |
| `bconnect-jobs-mcp` | 23 | 37 |
| `bconnect-software-mcp` | 11 | 19 |
| `bconnect-assets-mcp` | 15 | 26 |
| `bconnect-servermanagement-mcp` | 16 | 30 |
| `bconnect-operatingsystems-mcp` | 5 | 9 |
| `bconnect-variables-mcp` | 9 | 13 |
| `bconnect-defensecontrol-mcp` | 11 | 14 |
| `bconnect-updatemanagement-mcp` | 2 | 3 |
| `bconnect-groups-mcp` | 2 | 2 *(no write tools)* |
| `bconnect-compliance-mcp` | 10 | 10 *(no write tools)* |
| `bconnect-activedirectory-mcp` | 16 | 16 *(no write tools)* |
| `bconnect-universaldynamicgroups-mcp` | 6 | 6 *(no write tools)* |
| `bconnect-insights-mcp` | 5 | 5 *(no write tools)* |
| **Total** | **141** | **221** |

`bconnect-defensecontrol-mcp` additionally gates one tool behind `ALLOW_SECRET_READ=true`
regardless of `ALLOW_WRITE_OPERATIONS` (`get_bitlocker_secrets`, `get_local_admin_accounts`) — this
was already true before this pass and did not change.

**`bconnect-servermanagement-mcp`'s `list_api_keys` is newly gated behind
`ALLOW_SECRET_READ=true`** (independent of `ALLOW_WRITE_OPERATIONS`). It remains advertised in
`tools/list`, like the two `defensecontrol` secret tools above, but is refused with an `isError`
result naming the missing variable until you set it. It returns the bMS API-key inventory, and was
the one credential-returning route in the suite that neither the audit set nor the deny set
previously covered.

---

## 6. Default response body changes

Four servers now shape rows by default; every shaping tool accepts `detail: true` to get the exact
pre-existing response body back, byte for byte.

### `bconnect-endpoints-mcp`

- **`list_endpoints`, `list_windows_endpoints`, `list_linux_endpoints`, `list_mac_endpoints`,
  `list_android_endpoints`, `list_ios_endpoints`, `list_network_endpoints`,
  `list_industrial_endpoints`, `list_endpoints_by_logical_group`,
  `list_windows_endpoints_by_logical_group`** — rows default to
  `{ id, displayName, hostName, type, operatingSystem, osVersionString, lastSeen, logicalGroup,
  clientAgentVersion, activity }` plus a top-level `meta: { projection, hint }`. Pass
  `detail: true` for the full API record, or `fields: [...]` to pick your own columns. Envelope
  fields (`currentPage`/`pageSize`/`totalPages`/`totalItems`/`hasPreviousPage`/`hasNextPage`) are
  untouched.
- **`search_endpoints`** — same `detail` / `fields` options, no `countOnly`.
- **`list_logical_groups`** — `countOnly` only, no row shaping.
- **Every list/search response, and `get_fleet_summary` / `get_stale_endpoints`** — per-row
  `consoleLink` and `remoteDeskLink` are gone, and so is the old `consoleLinksInfo` object. In
  their place: a top-level `consoleLinks: { template, objectType, example, note }` (plus
  `remoteDeskTemplate` / `remoteDeskExample` when `BMC_REMOTEDESK_LINKS=true`). Reconstruct a row's
  link from its `id` and `type` using the template — `get_fleet_summary`'s `needsAttention[]` /
  `agentVersionOutliers.behind[]` / `reportedErrors[]` and `get_stale_endpoints`'s `ghosts[]` gained
  `id` and `type` for exactly this purpose (previously those digests carried no `id` at all, so a
  follow-up call had to search by display name).
  **`detail: true` does not bring these back.** The removal is unconditional — those fields were
  synthesised by the suite, never returned by the API, so there is no "full" payload that contains
  them. `detail` undoes shaping, not this.
- **`countOnly: true`** on the ten `detail`/`fields` tools above returns `{ totalItems, filters? }`
  — no rows, no envelope.

### `bconnect-jobs-mcp`

- **`list_job_instances`, `list_job_instances_by_endpoint`, `list_job_instances_by_definition`,
  `list_job_instances_by_logical_group`, `list_job_instances_by_static_group`,
  `list_job_instances_by_dynamic_group`, `list_job_instances_by_universal_dynamic_group`** —
  by default:
  - `steps[]` is omitted (`meta.dropped: ["steps"]`); pass `includeSteps: true` to get it back.
  - A column constant across the whole page (from `jobDefinitionId`, `jobDefinitionName`,
    `jobDefinitionDisplayName`, `endpointId`, `endpointName`, `jobDefinitionType`, `endpointType`,
    `initiator`, `retries`, `delays`) is omitted and its single value moved to `meta.constant`
    (needs ≥ 2 rows to detect).
  - `jobDefinitionDisplayName` is omitted on any row where it equals `jobDefinitionName`
    (`meta.omittedWhenEqual`).
  - `id`, `state`, `stateDescription`, `start`, `lastAction`, `nextExecution`,
    `successfulExecutions`, `erroneousExecutions` are guaranteed present on every row regardless.
  - `detail: true` returns the untouched API payload, no `meta`.
  - `get_job_instance` (the single-record tool) is **not** projected — it's the escape hatch the
    `meta.hint` on every list points at.
- **`countOnly: true`** — same 7 tools, plus `list_job_definitions`,
  `list_job_definitions_by_folder`, `list_job_folders`, `list_job_subfolders`,
  `list_kiosk_releases`, `list_kiosk_releases_by_job_definition`, `list_kiosk_releases_by_endpoint`,
  `list_kiosk_releases_by_ad_object`, `list_kiosk_releases_by_logical_group` (16 tools total) —
  returns `{ totalItems, filters? }`.
- **Wire detail:** `detail`, `fields`, `countOnly`, `includeSteps` are stripped before the request
  reaches bConnect; they never appear as query parameters upstream.

### `bconnect-software-mcp`

- **`list_installed_windows_software`, `list_installed_software_by_endpoint`,
  `list_installed_software_by_logical_group`, `list_installed_software_by_dynamic_group`** — rows
  drop any column that echoes a supplied argument (e.g. `endpointId`) or is constant across the
  page (`endpointName`, `autUsage`, `autFirstUse`, `autLastUse`, `autLastData`, `category`, or any
  other single-valued column). A `meta` object carries `meta.projection`
  (`"compact"|"fields"|"raw"`), `meta.echoed`, `meta.constant`, `meta.hint`. `detail: true` restores
  the exact previous body. Constant-column detection needs ≥ 2 rows. `fields: [...]` also
  available.
- **`countOnly: true`** — the four tools above, plus `list_software_bundles`,
  `list_bundle_applications`, `list_bundle_applications_by_bundle`, `list_bundle_folders`,
  `list_bundle_folders_by_folder`. Every bundle list tool otherwise remains a byte-identical
  passthrough — only the four installed-software tools shape rows.

### `bconnect-groups-mcp`

- **`countOnly: true`** on both `list_group_members` and `list_ad_user_endpoints`. No row shaping
  on the default response.

### Everywhere else (10 read-heavier packages)

`bconnect-compliance-mcp`, `bconnect-assets-mcp`, `bconnect-activedirectory-mcp`,
`bconnect-operatingsystems-mcp`, `bconnect-servermanagement-mcp`,
`bconnect-universaldynamicgroups-mcp`, `bconnect-updatemanagement-mcp`, `bconnect-variables-mcp`,
`bconnect-defensecontrol-mcp` gained **`countOnly: true` on every `list_*` tool (51 tools total)**
and nothing else — no tool was renamed, merged, removed, or had its default row shape changed in
these nine servers. `countOnly` returns `{ totalItems, filters? }`; `totalPages` is deliberately not
included.

**If you need the pre-existing response body from any of the shaping tools above, pass
`detail: true`.** It is asserted byte-identical (or object-identical, depending on the server's
test suite) to the **unshaped API payload**, on every tool that has it.

> **One exception, and it is the one most likely to bite.** `detail: true` undoes *shaping*. It
> does **not** restore the per-row `consoleLink` / `remoteDeskLink` fields on
> `bconnect-endpoints-mcp` responses, because those were never part of the API payload — the
> suite synthesised them, and §6 removed that synthesis **unconditionally**. No argument brings
> them back.
>
> This paragraph previously read "byte-identical to what that tool returned before this change",
> which is false for endpoints and contradicted §6 two pages earlier. If you are migrating a
> caller that read those fields, `detail: true` is not the fix — rebuild the link from the row's
> `id` and `type` using the top-level `consoleLinks.template`, as §6 describes. The digests in
> `get_fleet_summary` and `get_stale_endpoints` gained `id` and `type` for exactly this.

---

## 7. Error channel changed (`INT-53`)

Across **all 14 servers**, an *expected* API failure — HTTP `400`, `403`, `404`, or `429` from
bConnect — now **resolves successfully** with an error payload instead of rejecting the call:

```jsonc
// Before: the SDK call threw, e.g.
// McpError: MCP error -32603: Tool execution failed: Resource not found.

// After: the call resolves with
{
  "isError": true,
  "content": [{ "type": "text", "text": "Resource not found." }]
}
```

**If your code detects failure only via `try { await client.callTool(...) } catch (e) { ... }`,
you will stop seeing 400/403/404/429 as exceptions.** Check `result.isError` after every call
instead, or in addition. `401`, `5xx`, TLS failures, and transport-level errors are **unchanged**
and still throw a JSON-RPC error — as do validation failures (`-32602`), unknown tool
(`-32601`), and every write-gate / release-guard refusal.

---

## 8. Fault message prefix changed

Where a bConnect call fails in a way that still throws (401, 5xx, TLS, transport), the message
prefix changed in servers that used the older wording:

```
Before:  bConnect API error: <detail>
After:   Tool execution failed: <detail>
```

Affects `bconnect-compliance-mcp`, `bconnect-operatingsystems-mcp`,
`bconnect-servermanagement-mcp`, `bconnect-universaldynamicgroups-mcp`,
`bconnect-updatemanagement-mcp`, `bconnect-variables-mcp`, `bconnect-defensecontrol-mcp`, and
`bconnect-software-mcp`. `bconnect-assets-mcp` and `bconnect-activedirectory-mcp` already used the
new wording. The `<detail>` text itself — the actual explanation of what went wrong — is
unchanged; only the fixed prefix moved. **If you pattern-match on `bConnect API error:` in a caught
message, update the pattern.**

---

## 9. Gateway authentication (`bconnect-mcp-gateway`, `SEC-7`)

This only affects HTTP clients going through `bconnect-mcp-gateway`. stdio clients (Claude Desktop,
Claude Code, VS Code, Cursor, Continue) do not go through the gateway and need no changes.

If the operator sets `MCP_GATEWAY_AUTH_TOKEN`, every HTTP request must now carry
`Authorization: Bearer <token>`. Without it:

- `POST /<domain>/mcp` → `401`, body
  `{"jsonrpc":"2.0","error":{"code":-32001,"message":"Missing bearer token. Send 'Authorization:
  Bearer <MCP_GATEWAY_AUTH_TOKEN>'."},"id":null}`.
- `GET /health` is **unaffected** — still open, unauthenticated, by design.

**To migrate an existing deployment:**

1. Add `MCP_GATEWAY_AUTH_TOKEN=<24+ random chars>` to `.env.gateway`, or re-run the installer with
   `-Gateway` (it generates and stores the token and prints it once). `docker compose up` refuses
   to start without a token once `MCP_GATEWAY_AUTH_TOKEN` is expected — see
   `docker-compose.gateway.yml`.
2. Add `Authorization: Bearer <token>` to every HTTP MCP client config: n8n → a Header Auth
   credential named `Authorization` with value `Bearer <token>`; Open WebUI → the server entry's
   Bearer field (token alone, no `Bearer` prefix); LibreChat → the server's `headers:` map;
   anything else → a plain `Authorization` header. The installer writes per-host instructions to
   `install\out\<host>.md` — the value itself is never written there.
3. To keep the previous token-less behaviour on a loopback bind, simply do not set
   `MCP_GATEWAY_AUTH_TOKEN`. To keep it on a non-loopback bind, set `MCP_ALLOW_NO_AUTH=true`
   yourself — the commented block in `docker-compose.gateway.yml` shows where.

See the `INSTALL.md` bundled in the release archive and [`DOCKER.md`](DOCKER.md) for the full
operator walkthrough.

---

## 10. The suite is now 26R1-only

**baramundi Management Suite 25R2 and older are no longer supported.** This is a product
decision, and it is the reason for §4's industrial removal.

### What changed

1. **`BCONNECT_RELEASE` is gone.** Remove it from every `.env`, every Claude Desktop / Claude
   Code / VS Code MCP config, every `docker run -e`, and every CI environment. It is no longer
   read, and setting it has no effect. The shipped `.env.example` files no longer mention it.
2. **26R1 tools are unconditional.** Tools that were previously registered only when
   `BCONNECT_RELEASE=26R1` are now always registered. If you were running with the variable unset
   or set to `25R2`, you will see **more** tools than before — `bconnect-compliance-mcp` and
   `bconnect-universaldynamicgroups-mcp` in particular go from advertising nothing usable to
   their full catalogue.
3. **A hard version gate at startup.** Each server reads the bMS `version` from
   `GET /v2.0/ManagementServer` as part of the connectivity check it already performs — no extra
   round-trip — and **exits with a clear message naming the detected version** if it is older than
   26R1. Several tools depend on routes added in 26R1, and returning inaccurate data is worse
   than refusing to run.
4. **An unparseable version warns rather than refuses.** If the version string is not in a shape
   the gate can compare, the server logs what it received and continues. A false refusal would be
   worse than no gate.
5. **The escape hatch is the existing one.** `BCONNECT_SKIP_CONNECTIVITY_CHECK=true` skips the
   connectivity check and the version gate with it, for deployments that legitimately cannot
   reach that route. It skips the *check*, not the requirement — tools calling 26R1-only routes
   will still fail against an older bMS.
6. **The 25R2 OpenAPI specifications and the codegen path that targeted them were deleted.**
   Generated types are produced from `openapi-specs/26R1` only.

### Why the gate reads the API and not the Windows registry

The bMS release is read from the API because that is the version of the server you are actually
talking to. A registry read would only describe the machine the MCP server happens to run on —
and in the most common deployment (Claude Desktop on an operator's workstation talking to a
remote bMS) there is no baramundi server entry there at all. The gateway additionally runs in a
Linux container, where there is no Windows registry to read.

### Migration steps

1. Confirm your bMS is 26R1 or later **before** upgrading the MCP suite.
2. Delete `BCONNECT_RELEASE` from every config file and environment (harmless if left, but
   misleading).
3. Remove any call to a `*_industrial_endpoint` tool (§4) and any `memberType: "industrial"`
   argument to `list_group_members`.
4. If you enumerate `tools/list` and assert an exact tool count, re-baseline it: 141 by default,
   221 with `ALLOW_WRITE_OPERATIONS=true` (§5).

---

## 11. Quick checklist for a script written against the old surface

- [ ] Replace any call to `list_endpoint_job_instances` with `list_job_instances_by_endpoint` (§2).
- [ ] Replace any call to `list_detected_rule_violations_for_endpoint` /
      `list_detected_vulnerabilities_for_endpoint` with the `_by_endpoint` names (§2).
- [ ] Replace any of the 33 `bconnect-groups-mcp` tool calls with `list_group_members` /
      `list_ad_user_endpoints`, renaming the id parameter to `groupId` + `groupKind` (§3).
- [ ] Replace any call to `list_group_endpoints` with `list_endpoints_by_logical_group` (§4).
- [ ] Confirm the bMS is **26R1 or later** — the servers now refuse to start otherwise (§10).
- [ ] Delete `BCONNECT_RELEASE` from every `.env`, MCP client config and CI environment (§10).
- [ ] Remove every call to `list_/get_/create_/update_/delete_industrial_endpoint` — there is no
      replacement (§4).
- [ ] Remove `memberType: "industrial"` from any `list_group_members` call (§4).
- [ ] If you enumerate `tools/list` to discover write tools, set `ALLOW_WRITE_OPERATIONS=true` on
      the relevant server (§5).
- [ ] If you parse rows from `list_endpoints*`/`list_windows_endpoints*`,
      `list_job_instances*`, or `list_installed_*software*` and need every original field, add
      `detail: true` to the call, or migrate to the compact fields plus `meta` (§6).
- [ ] If you read `consoleLink`/`remoteDeskLink` off individual rows in
      `bconnect-endpoints-mcp` responses, switch to the top-level `consoleLinks` template (§6).
- [ ] If you only catch thrown errors to detect tool failure, also check `result.isError` (§7).
- [ ] If you pattern-match `bConnect API error:` in caught messages, update to
      `Tool execution failed:` (§8).
- [ ] If you call `bconnect-mcp-gateway` over HTTP, add `Authorization: Bearer <token>` once the
      operator sets `MCP_GATEWAY_AUTH_TOKEN` (§9).
