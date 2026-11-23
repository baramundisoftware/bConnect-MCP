# Tool naming

How the tools of the bConnect MCP servers are named, and how their arguments are named. A model
picks a tool by its name first, so names follow one pattern across all 13 servers. The guard
`__tests__/tool-naming.guard.test.ts` checks every tool of every release against the rules below
(and `__tests__/tool-names.guard.test.ts` that no two servers list the same name).

## Tool names

`<verb>_<object>[_by_<parent>]`, in lower case with underscores (`snake_case`).

| Rule | Examples |
|---|---|
| Start with a verb from the list below. | `list_endpoints`, `get_job_definition`, `run_msw_cleanup` |
| A list is plural, everything else singular. | `list_job_folders`, `get_job_folder` |
| A list restricted to one parent object ends in `_by_<parent>`. | `list_job_instances_by_endpoint`, `list_assets_by_org_unit` |
| A single sub-resource that belongs to one object ends in `_for_<owner>`. | `get_maintenance_window_for_endpoint` |
| A list never uses `_for_` or `_in_`. | not `list_detected_vulnerabilities_for_endpoint` |
| Use bMS's terms for objects (`logical_group`, `universal_dynamic_group`, `asset_stock`). | `list_asset_stock_assets` |
| Tools that differ only by endpoint type or group kind are one tool, the type an argument. | `list_endpoints` with `type` (REQ-SRV-029) |

**Verbs:** `list`, `get`, `create`, `update`, `delete`, `add`, `replace`, `assign`, `link`,
`unlink`, `start`, `stop`, `restart`, `resume`, `cancel`, `run`, `simulate`, `trigger`,
`refresh`, `withdraw`. `update` changes an existing object (also for a JSON Patch); there's no
`patch_`, `set_` or `modify_`. A new verb is added to this list and to the guard together.

## Argument names

| Rule | Examples |
|---|---|
| The ID of the object the tool names is `id`. | `get_vulnerability(id)`, `update_os_windows_endpoint(id)` |
| The ID of another object (a parent, a target) is `<object>Id`. | `list_job_instances_by_endpoint(endpointId)`, `get_bitlocker_secrets(endpointId)` |
| Query parameters keep the API's names. | `PageSize`, `OrderBy`, `SearchQuery` |
| Body fields use the API's field names in camelCase. | `displayName`, `logicalGroupId` |

A tool whose object belongs to another one and has no ID of its own takes the owner's ID:
`get_bitlocker_secrets(endpointId)` (the secrets of an endpoint), `get_access_rights(objectId)`. The
guard lists those tools with the reason.

## Renaming a tool or an argument

A rename is a breaking change: it goes into a release's batch and the CHANGELOG lists the old and
the new name. The old name keeps answering, without running:

- **A renamed tool** goes into the server's `src/replaced-tools.ts` (`REPLACED_TOOLS`). Called by
  its old name, it is refused with `MethodNotFound`: "`<old>` was replaced by `<new>`: call `<new>`."
- **A renamed argument** goes into `RENAMED_ARGUMENTS` in the same file. Called with the old
  argument, the tool refuses with `InvalidParams`: "`<tool>` takes `id` instead of `<old>`: call it
  with `id`." Nothing is sent to bMS.

There are no aliases: an old name never runs, so a client finds out and changes it once.

## The rename batch of v26.2.0 (#342)

| Before | Now |
|---|---|
| `list_installed_software_by_dynamic_group` | `list_installed_software_by_universal_dynamic_group` |
| `list_endpoint_job_instances` | `list_job_instances_by_endpoint` |
| `list_detected_vulnerabilities_for_endpoint` | `list_detected_vulnerabilities_by_endpoint` |
| `list_detected_rule_violations_for_endpoint` | `list_detected_rule_violations_by_endpoint` |
| `msw_cleanup` | `run_msw_cleanup` |
| `patch_local_admin_user_credentials` | `update_local_admin_credentials` |
| `list_assets_in_asset_stock` | `list_asset_stock_assets` |
| `get_vulnerability(vulnerabilityId)` | `get_vulnerability(id)` |
| `get_mobile_device_rule(ruleId)` | `get_mobile_device_rule(id)` |
| `get_defender_threat(threatId)` | `get_defender_threat(id)` |
| `get_bitlocker_windows_endpoint(endpointId)` | `get_bitlocker_windows_endpoint(id)` |
| `get_defender_windows_endpoint(endpointId)` | `get_defender_windows_endpoint(id)` |
| `get_software_bundle(bundleId)`, `delete_software_bundle(bundleId)` | `…(id)` |
| `get_os_windows_endpoint(endpointId)`, `update_os_windows_endpoint(endpointId)` | `…(id)` |
