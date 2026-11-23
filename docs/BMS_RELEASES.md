# bMS releases: what differs for the servers

The servers support bMS **25R2**, **26R1** and **26R2**. Each server reads the release from the bMS
at startup and lists only the tools whose API routes exist in it; a tool another release has is
refused by name ("… is only available in bMS …; this server uses …"). Without the detection,
[`BCONNECT_RELEASE`](CONFIGURATION.md#bconnect_release) decides, default `26R1`.

The tables per release are generated from the bundled OpenAPI specifications
(`openapi-specs/<release>/`), and the spec-conformance tests check every tool against each of
them.

## 26R1 → 26R2

Compared from the specifications of both releases: operations by method and path, parameters,
request bodies, responses and component schemas. One operation is gone, 17 are new, and one
request enum gains values. Most other changes add `maxLength` to existing parameters and fields.

| Domain | Operations 26R1 → 26R2 | What changes |
|---|---|---|
| activedirectory | 16 → 16 | `ADObjectType` values in answers: `User`, `Group` become `ADUser`, `ADGroup`, `EntraIDUser`, `EntraIDGroup` |
| assets | 26 → 26 | `maxLength` only |
| compliance | 8 → 8 | `maxLength` only |
| defensecontrol | 13 → 13 | `maxLength` only |
| endpoints | 87 → 94 | +6 Intune remote actions on Windows endpoints (#356); +1 Entra ID data by endpoint ID (#353); `NetworkEndpoint` drops 15 hardware and network fields and gains `deviceInfo`; `UnmanagedEndpoint`: `networkGroupName` becomes `computerGroupName`, plus Kerberos, SID, domain, token expiry and key fingerprint; three `…AMAPI` Android profile types (also offered by `create_android_endpoint`) |
| jobs | 34 → 34 | `JobValidity.validityPeriods` becomes a base type with the same three variants; one new job step type |
| operatingsystems | 9 → 9 | `maxLength` only |
| servermanagement | 30 → 33 | **removed:** Cloud Connectors (`list_cloud_connectors`); +4 API key operations: get, create, update, delete (#357); right `IntuneAction`; `DownloadJob.interval` becomes a base type |
| software | 19 → 19 | `maxLength` only |
| universaldynamicgroups | 6 → 12 | +6 thresholds: list, list per group, get, create, update, delete (#354, #355) |
| updatemanagement | 3 → 3 | Windows endpoints gain `osUpdateVersion`, `osUpdateReleaseDate`, `requiredOSUpdateInstalled` |
| variables | 13 → 13 | `maxLength` only |

### What that means for the tools

- **Everything else 26R1 offers** is offered on 26R2 by the same code; only the generated tables
  (list filters, error meanings) come from the 26R2 specifications.
- **The industrial-endpoint tools stay 25R2-only:** 26R2 has no industrial-endpoint API either, so
  `create_industrial_endpoint` and the `IndustrialEndpoint` type of `list_endpoints`,
  `get_endpoint`, `update_endpoint`, `delete_endpoint` and `list_group_members` aren't offered
  there and are refused by name (see [25R2 → 26R1](#25r2--26r1)).
- **`list_cloud_connectors`** isn't listed on 26R2; called by name, it's refused naming the release.
- **`create_android_endpoint`** offers the three AMAPI profile types on 26R2 only.
- **`get_entra_id_data`** takes `endpointId` instead of `deviceId` on 26R2 (#353).
- **Thresholds, read:** `list_thresholds` (all, or one group's with `dynamicGroupId`) and
  `get_threshold` (#354).
- **The other 13 new operations** have no tools yet; each has its own issue (#355 to #357). The
  spec-conformance baseline lists them with those issues.
- **`maxLength`** isn't checked by the tools yet; bMS refuses an over-long value itself (#358).
- **Security:** creating an API key answers with its secret, so that route is behind
  `ALLOW_SECRET_READ`, and all API key routes are audited as security routes
  ([AUDIT.md](AUDIT.md)).
- Answers pass through unchanged, so the renamed `ADObjectType` values and the changed endpoint
  fields reach the client as bMS sends them.

## 25R2 → 26R1

26R1 added the compliance and universal dynamic groups APIs, software bundles, API keys, download
jobs and MSW cleanup; it removed the Industrial endpoints. Tools that need 26R1 or later are marked
**(26R1)** in the server READMEs; on 25R2 the compliance and universaldynamicgroups servers stop
at startup.
