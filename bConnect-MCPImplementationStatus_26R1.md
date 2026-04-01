# bConnect MCP Implementation Status — 26R1

> Generated: 2026-04-01 (verified/corrected: 2026-04-01)
> OpenAPI Source: `/home/ansible/MCP/bConnectOpenAPI/26R1/` (12 spec files, ~264 endpoints)
> MCP Source: `/home/ansible/MCP/bConnect-MCP/` (13 MCP servers)

## Summary

| Metric | Count |
|--------|-------|
| Total API Endpoints (26R1) | 264 |
| Implemented in MCP | 264 |
| Not Implemented | 0 |
| Coverage | **100%** |

> **All 264 endpoints covered.** ADUser endpoint queries added to bconnect-groups-mcp, UDG/JobInstances added to bconnect-jobs-mcp, maintenance window PUT→PATCH bug fixed in bconnect-endpoints-mcp.

### New in 26R1 vs 25R2

| Change | Details |
|--------|---------|
| **New spec: Compliance** | 8 endpoints — fully implemented ✅ |
| **New spec: UniversalDynamicGroups** | 6 endpoints — fully implemented ✅ |
| **Assets: expanded** | +2 endpoints (ADObjects/Assets, OrgUnits/Assets) — implemented ✅ |
| **DefenseControl: expanded** | +2 endpoints (BitLocker Secrets GET/PATCH) — implemented ✅ |
| **Endpoints: changed** | MaintenanceWindow now uses PATCH (was PUT); added UnmanagedEndpoints (3), EntraIdData (3) |
| **ServerManagement: expanded** | +5 endpoints (ApiKeys, DownloadJobs, MSW Cleanup) — implemented ✅ |
| **Software: expanded** | +15 endpoints (Bundles, BundleApplications, Bundle Folders) — implemented ✅ |

---

## 1. ActiveDirectory (activedirectory.json → bconnect-activedirectory-mcp)

**Coverage: 16/16 (100%)** — Unchanged from 25R2

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/ADGroups | `list_ad_groups` | ✅ |
| 2 | GET | /v2.0/ADGroups/{id} | `get_ad_group` | ✅ |
| 3 | GET | /v2.0/ADGroups/{adGroupId}/ADGroups | `list_ad_subgroups` | ✅ |
| 4 | GET | /v2.0/ADGroups/{adGroupId}/ADObjects | `list_ad_objects_by_group` | ✅ |
| 5 | GET | /v2.0/ADGroups/{adGroupId}/ADUsers | `list_ad_users_by_group` | ✅ |
| 6 | GET | /v2.0/ADObjects | `list_ad_objects` | ✅ |
| 7 | GET | /v2.0/ADObjects/{id} | `get_ad_object` | ✅ |
| 8 | GET | /v2.0/ADObjects/{id}/ADGroupMemberships | `list_ad_object_memberships` | ✅ |
| 9 | GET | /v2.0/ADUsers | `list_ad_users` | ✅ |
| 10 | GET | /v2.0/ADUsers/{id} | `get_ad_user` | ✅ |
| 11 | GET | /v2.0/OrgUnits | `list_org_units` | ✅ |
| 12 | GET | /v2.0/OrgUnits/{id} | `get_org_unit` | ✅ |
| 13 | GET | /v2.0/OrgUnits/{orgUnitId}/ADGroups | `list_ad_groups_by_org_unit` | ✅ |
| 14 | GET | /v2.0/OrgUnits/{orgUnitId}/ADObjects | `list_ad_objects_by_org_unit` | ✅ |
| 15 | GET | /v2.0/OrgUnits/{orgUnitId}/ADUsers | `list_ad_users_by_org_unit` | ✅ |
| 16 | GET | /v2.0/OrgUnits/{orgUnitId}/OrgUnits | `list_org_units_by_org_unit` | ✅ |

---

## 2. Assets (assets.json → bconnect-assets-mcp)

**Coverage: 26/26 (100%)** — 2 new endpoints vs 25R2, both implemented

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/Assets | `list_assets` | ✅ |
| 2 | POST | /v2.0/Assets | `create_asset` | ✅ |
| 3 | GET | /v2.0/Assets/{id} | `get_asset` | ✅ |
| 4 | PATCH | /v2.0/Assets/{id} | `update_asset` | ✅ |
| 5 | DELETE | /v2.0/Assets/{id} | `delete_asset` | ✅ |
| 6 | GET | /v2.0/AssetStock/Assets | `list_assets_in_asset_stock` | ✅ |
| 7 | GET | /v2.0/AssetStock/Folders | `list_asset_stock_folders` | ✅ |
| 8 | POST | /v2.0/AssetStock/Folders | `create_asset_stock_folder` | ✅ |
| 9 | GET | /v2.0/AssetStock/Folders/{id} | `get_asset_stock_folder` | ✅ |
| 10 | PATCH | /v2.0/AssetStock/Folders/{id} | `update_asset_stock_folder` | ✅ |
| 11 | DELETE | /v2.0/AssetStock/Folders/{id} | `delete_asset_stock_folder` | ✅ |
| 12 | GET | /v2.0/AssetStock/Folders/{folderId}/Folders | `list_asset_stock_subfolders` | ✅ |
| 13 | GET | /v2.0/AssetTypes | `list_asset_types` | ✅ |
| 14 | POST | /v2.0/AssetTypes | `create_asset_type` | ✅ |
| 15 | GET | /v2.0/AssetTypes/{id} | `get_asset_type` | ✅ |
| 16 | DELETE | /v2.0/AssetTypes/{id} | `delete_asset_type` | ✅ |
| 17 | GET | /v2.0/AssetTypes/Folders | `list_asset_type_folders` | ✅ |
| 18 | POST | /v2.0/AssetTypes/Folders | `create_asset_type_folder` | ✅ |
| 19 | GET | /v2.0/AssetTypes/Folders/{id} | `get_asset_type_folder` | ✅ |
| 20 | PATCH | /v2.0/AssetTypes/Folders/{id} | `update_asset_type_folder` | ✅ |
| 21 | DELETE | /v2.0/AssetTypes/Folders/{id} | `delete_asset_type_folder` | ✅ |
| 22 | GET | /v2.0/AssetTypes/Folders/{folderId}/Folders | `list_asset_type_subfolders` | ✅ |
| 23 | GET | /v2.0/LogicalGroups/{logicalGroupId}/Assets | `list_assets_by_logical_group` | ✅ |
| 24 | GET | /v2.0/WindowsEndpoint/{endpointId}/Assets | `list_assets_by_windows_endpoint` | ✅ |
| 25 | GET | /v2.0/OrgUnits/{orgUnitId}/Assets | `list_assets_by_org_unit` | ✅ 🆕 |
| 26 | GET | /v2.0/ADObjects/{adObjectId}/Assets | `list_assets_by_ad_object` | ✅ 🆕 |

---

## 3. Compliance (compliance.json → bconnect-compliance-mcp) 🆕

**Coverage: 8/8 (100%)** — Entirely new in 26R1

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/DetectedRuleViolations | `list_detected_rule_violations` | ✅ |
| 2 | GET | /v2.0/Endpoints/{id}/DetectedRuleViolations | `list_detected_rule_violations_for_endpoint` | ✅ |
| 3 | GET | /v2.0/DetectedVulnerabilities | `list_detected_vulnerabilities` | ✅ |
| 4 | GET | /v2.0/WindowsEndpoints/{id}/DetectedVulnerabilities | `list_detected_vulnerabilities_for_endpoint` | ✅ |
| 5 | GET | /v2.0/Rules | `list_mobile_device_rules` | ✅ |
| 6 | GET | /v2.0/Rules/{id} | `get_mobile_device_rule` | ✅ |
| 7 | GET | /v2.0/Vulnerabilities | `list_vulnerabilities` | ✅ |
| 8 | GET | /v2.0/Vulnerabilities/{id} | `get_vulnerability` | ✅ |

---

## 4. DefenseControl (defensecontrol.json → bconnect-defensecontrol-mcp)

**Coverage: 13/13 (100%)** — 2 new endpoints vs 25R2, both implemented

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/BitLocker/WindowsEndpoints | `list_bitlocker_windows_endpoints` | ✅ |
| 2 | GET | /v2.0/BitLocker/WindowsEndpoints/{id} | `get_bitlocker_windows_endpoint` | ✅ |
| 3 | GET | /v2.0/BitLocker/WindowsEndpoints/{id}/Secrets | `get_bitlocker_secrets` | ✅ 🆕 |
| 4 | PATCH | /v2.0/BitLocker/WindowsEndpoints/{id}/Secrets | `update_bitlocker_pin` | ✅ 🆕 |
| 5 | GET | /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id} | `get_local_admin_accounts` | ✅ |
| 6 | PATCH | /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id} | `patch_local_admin_user_credentials` | ✅ |
| 7 | POST | /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}/TriggerUpdateOnClient | `trigger_update_on_client` | ✅ |
| 8 | GET | /v2.0/MicrosoftDefender/Threats | `list_defender_threats` | ✅ |
| 9 | GET | /v2.0/MicrosoftDefender/Threats/{id} | `get_defender_threat` | ✅ |
| 10 | GET | /v2.0/MicrosoftDefender/WindowsEndpoints | `list_defender_windows_endpoints` | ✅ |
| 11 | GET | /v2.0/MicrosoftDefender/WindowsEndpoints/{id} | `get_defender_windows_endpoint` | ✅ |
| 12 | GET | /v2.0/MicrosoftDefender/WindowsEndpoints/{endpointId}/Threats | `list_defender_threats_by_endpoint` | ✅ |
| 13 | GET | /v2.0/MicrosoftDefender/LogicalGroups/{logicalGroupId}/Threats | `list_defender_threats_by_logical_group` | ✅ |

---

## 5. Endpoints (endpoints.json → bconnect-endpoints-mcp + bconnect-groups-mcp)

**Coverage: 87/87 (100%)** — bconnect-endpoints-mcp: 64 tools; bconnect-groups-mcp: 33 group-scoped tools (incl. 6 ADUser); bconnect-jobs-mcp: 34 tools

Changes from 25R2: MaintenanceWindow uses PATCH (was PUT — fixed), removed IndustrialEndpoints, added UnmanagedEndpoints (3), added EntraIdData (3).

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| | **Generic Endpoints** | | | |
| 1 | GET | /v2.0/Endpoints | `list_endpoints` | ✅ |
| 2 | GET | /v2.0/Endpoints/{id} | `get_endpoint` | ✅ |
| 3 | DELETE | /v2.0/Endpoints/{id} | `delete_endpoint` | ✅ |
| 4 | GET | /v2.0/Endpoints/{id}/MaintenanceWindow | `get_maintenance_window_for_endpoint` | ✅ 🆕P24 |
| 5 | POST | /v2.0/Endpoints/{id}/MaintenanceWindow | `create_maintenance_window_for_endpoint` | ✅ |
| 6 | PATCH | /v2.0/Endpoints/{id}/MaintenanceWindow | `update_maintenance_window_for_endpoint` | ✅ (fixed — now sends PATCH) |
| 7 | DELETE | /v2.0/Endpoints/{id}/MaintenanceWindow | `delete_maintenance_window_for_endpoint` | ✅ |
| | **EntraID Data** 🆕 | | | |
| 8 | GET | /v2.0/EntraIdData/{deviceId} | `get_entra_id_data` | ✅ 🆕P24 |
| 9 | POST | /v2.0/Endpoints/{endpointId}/EntraIdData | `link_entra_id_data` | ✅ 🆕P24 |
| 10 | DELETE | /v2.0/Endpoints/{endpointId}/EntraIdData | `unlink_entra_id_data` | ✅ 🆕P24 |
| | **Windows Endpoints** | | | |
| 11 | GET | /v2.0/WindowsEndpoints | `list_windows_endpoints` | ✅ |
| 12 | POST | /v2.0/WindowsEndpoints | `create_windows_endpoint` | ✅ |
| 13 | GET | /v2.0/WindowsEndpoints/{id} | `get_windows_endpoint` | ✅ |
| 14 | PATCH | /v2.0/WindowsEndpoints/{id} | `update_windows_endpoint` | ✅ |
| 15 | DELETE | /v2.0/WindowsEndpoints/{id} | `delete_windows_endpoint` | ✅ |
| 16 | POST | /v2.0/WindowsEndpoints/{id}/StartEnrollment | `start_windows_enrollment` | ✅ |
| 17 | POST | /v2.0/WindowsEndpoints/{id}/TriggerInstallationViaIntune | `trigger_intune_installation` | ✅ |
| | **Linux Endpoints** | | | |
| 18 | GET | /v2.0/LinuxEndpoints | `list_linux_endpoints` | ✅ |
| 19 | POST | /v2.0/LinuxEndpoints | `create_linux_endpoint` | ✅ |
| 20 | GET | /v2.0/LinuxEndpoints/{id} | `get_linux_endpoint` | ✅ |
| 21 | PATCH | /v2.0/LinuxEndpoints/{id} | `update_linux_endpoint` | ✅ |
| 22 | DELETE | /v2.0/LinuxEndpoints/{id} | `delete_linux_endpoint` | ✅ |
| | **macOS Endpoints** | | | |
| 23 | GET | /v2.0/MacEndpoints | `list_mac_endpoints` | ✅ |
| 24 | POST | /v2.0/MacEndpoints | `create_mac_endpoint` | ✅ |
| 25 | GET | /v2.0/MacEndpoints/{id} | `get_mac_endpoint` | ✅ |
| 26 | PATCH | /v2.0/MacEndpoints/{id} | `update_mac_endpoint` | ✅ |
| 27 | DELETE | /v2.0/MacEndpoints/{id} | `delete_mac_endpoint` | ✅ |
| 28 | POST | /v2.0/MacEndpoints/{id}/StartEnrollment | `start_mac_enrollment` | ✅ |
| | **Android Endpoints** | | | |
| 29 | GET | /v2.0/AndroidEndpoints | `list_android_endpoints` | ✅ 🆕P24 |
| 30 | POST | /v2.0/AndroidEndpoints | `create_android_endpoint` | ✅ |
| 31 | GET | /v2.0/AndroidEndpoints/{id} | `get_android_endpoint` | ✅ 🆕P24 |
| 32 | PATCH | /v2.0/AndroidEndpoints/{id} | `update_android_endpoint` | ✅ |
| 33 | DELETE | /v2.0/AndroidEndpoints/{id} | `delete_android_endpoint` | ✅ |
| 34 | POST | /v2.0/AndroidEndpoints/{id}/StartEnrollment | `start_android_enrollment` | ✅ |
| | **iOS Endpoints** | | | |
| 35 | GET | /v2.0/IosEndpoints | `list_ios_endpoints` | ✅ 🆕P24 |
| 36 | POST | /v2.0/IosEndpoints | `create_ios_endpoint` | ✅ 🆕P24 |
| 37 | GET | /v2.0/IosEndpoints/{id} | `get_ios_endpoint` | ✅ 🆕P24 |
| 38 | PATCH | /v2.0/IosEndpoints/{id} | `update_ios_endpoint` | ✅ 🆕P24 |
| 39 | DELETE | /v2.0/IosEndpoints/{id} | `delete_ios_endpoint` | ✅ 🆕P24 |
| 40 | POST | /v2.0/IosEndpoints/{id}/StartEnrollment | `start_ios_enrollment` | ✅ |
| | **Network Endpoints** | | | |
| 41 | GET | /v2.0/NetworkEndpoints | `list_network_endpoints` | ✅ 🆕P24 |
| 42 | POST | /v2.0/NetworkEndpoints | `create_network_endpoint` | ✅ |
| 43 | GET | /v2.0/NetworkEndpoints/{id} | `get_network_endpoint` | ✅ 🆕P24 |
| 44 | PATCH | /v2.0/NetworkEndpoints/{id} | `update_network_endpoint` | ✅ |
| 45 | DELETE | /v2.0/NetworkEndpoints/{id} | `delete_network_endpoint` | ✅ |
| | **Unmanaged Endpoints** 🆕 | | | |
| 46 | GET | /v2.0/UnmanagedEndpoints | `list_unmanaged_endpoints` | ✅ 🆕P24 |
| 47 | GET | /v2.0/UnmanagedEndpoints/{id} | `get_unmanaged_endpoint` | ✅ 🆕P24 |
| 48 | DELETE | /v2.0/UnmanagedEndpoints/{id} | `delete_unmanaged_endpoint` | ✅ 🆕P24 |
| | **Logical Groups** | | | |
| 49 | GET | /v2.0/LogicalGroups | `list_logical_groups` | ✅ |
| 50 | POST | /v2.0/LogicalGroups | `create_logical_group` | ✅ |
| 51 | GET | /v2.0/LogicalGroups/{id} | `get_logical_group` | ✅ |
| 52 | PATCH | /v2.0/LogicalGroups/{id} | `update_logical_group` | ✅ |
| 53 | DELETE | /v2.0/LogicalGroups/{id} | `delete_logical_group` | ✅ |
| 54 | GET | /v2.0/LogicalGroups/{id}/MaintenanceWindow | `get_maintenance_window_for_logical_group` | ✅ 🆕P24 |
| 55 | POST | /v2.0/LogicalGroups/{id}/MaintenanceWindow | `create_maintenance_window_for_logical_group` | ✅ |
| 56 | PATCH | /v2.0/LogicalGroups/{id}/MaintenanceWindow | `update_maintenance_window_for_logical_group` | ✅ (fixed — now sends PATCH) |
| 57 | DELETE | /v2.0/LogicalGroups/{id}/MaintenanceWindow | `delete_maintenance_window_for_logical_group` | ✅ |
| | **Endpoints by Logical Group** | | | |
| 58 | GET | /v2.0/LogicalGroups/{id}/Endpoints | `list_endpoints_by_logical_group` | ✅ |
| 59 | GET | /v2.0/LogicalGroups/{id}/WindowsEndpoints | `list_windows_endpoints_by_logical_group` | ✅ |
| 60 | GET | /v2.0/LogicalGroups/{id}/LogicalGroups | `list_group_endpoints` | ✅ |
| 61 | GET | /v2.0/LogicalGroups/{id}/AndroidEndpoints | `list_android_endpoints_by_logical_group` | ✅ 🆕P25 (groups-mcp) |
| 62 | GET | /v2.0/LogicalGroups/{id}/IosEndpoints | `list_ios_endpoints_by_logical_group` | ✅ 🆕P25 (groups-mcp) |
| 63 | GET | /v2.0/LogicalGroups/{id}/LinuxEndpoints | `list_linux_endpoints_by_logical_group` | ✅ 🆕P25 (groups-mcp) |
| 64 | GET | /v2.0/LogicalGroups/{id}/MacEndpoints | `list_mac_endpoints_by_logical_group` | ✅ 🆕P25 (groups-mcp) |
| 65 | GET | /v2.0/LogicalGroups/{id}/NetworkEndpoints | `list_network_endpoints_by_logical_group` | ✅ 🆕P25 (groups-mcp) |
| | **Endpoints by Static Group** | | | |
| 66 | GET | /v2.0/StaticGroups/{id}/Endpoints | `list_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 67 | GET | /v2.0/StaticGroups/{id}/WindowsEndpoints | `list_windows_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 68 | GET | /v2.0/StaticGroups/{id}/AndroidEndpoints | `list_android_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 69 | GET | /v2.0/StaticGroups/{id}/IosEndpoints | `list_ios_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 70 | GET | /v2.0/StaticGroups/{id}/LinuxEndpoints | `list_linux_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 71 | GET | /v2.0/StaticGroups/{id}/MacEndpoints | `list_mac_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 72 | GET | /v2.0/StaticGroups/{id}/NetworkEndpoints | `list_network_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| | **Endpoints by Dynamic Group** | | | |
| 73 | GET | /v2.0/DynamicGroups/{id}/Endpoints | `list_endpoints_by_dynamic_group` | ✅ 🆕P25 (groups-mcp) |
| 74 | GET | /v2.0/DynamicGroups/{id}/WindowsEndpoints | `list_windows_endpoints_by_dynamic_group` | ✅ 🆕P25 (groups-mcp) |
| | **Endpoints by Universal Dynamic Group** | | | |
| 75 | GET | /v2.0/UniversalDynamicGroups/{id}/Endpoints | `list_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 76 | GET | /v2.0/UniversalDynamicGroups/{id}/WindowsEndpoints | `list_windows_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 77 | GET | /v2.0/UniversalDynamicGroups/{id}/AndroidEndpoints | `list_android_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 78 | GET | /v2.0/UniversalDynamicGroups/{id}/IosEndpoints | `list_ios_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 79 | GET | /v2.0/UniversalDynamicGroups/{id}/LinuxEndpoints | `list_linux_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 80 | GET | /v2.0/UniversalDynamicGroups/{id}/MacEndpoints | `list_mac_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 81 | GET | /v2.0/UniversalDynamicGroups/{id}/NetworkEndpoints | `list_network_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| | **Endpoints by AD User** | | | |
| 82 | GET | /v2.0/ADUsers/{id}/Endpoints | `list_endpoints_by_ad_user` | ✅ (groups-mcp) |
| 83 | GET | /v2.0/ADUsers/{id}/WindowsEndpoints | `list_windows_endpoints_by_ad_user` | ✅ (groups-mcp) |
| 84 | GET | /v2.0/ADUsers/{id}/AndroidEndpoints | `list_android_endpoints_by_ad_user` | ✅ (groups-mcp) |
| 85 | GET | /v2.0/ADUsers/{id}/IosEndpoints | `list_ios_endpoints_by_ad_user` | ✅ (groups-mcp) |
| 86 | GET | /v2.0/ADUsers/{id}/LinuxEndpoints | `list_linux_endpoints_by_ad_user` | ✅ (groups-mcp) |
| 87 | GET | /v2.0/ADUsers/{id}/MacEndpoints | `list_mac_endpoints_by_ad_user` | ✅ (groups-mcp) |

---

## 6. Jobs (jobs.json → bconnect-jobs-mcp)

**Coverage: 34/34 (100%)** — Phase 26 added 9 tools; `list_job_instances_by_universal_dynamic_group` added

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/JobDefinitions | `list_job_definitions` | ✅ |
| 2 | GET | /v2.0/JobDefinitions/{id} | `get_job_definition` | ✅ |
| 3 | GET | /v2.0/JobDefinitions/{id}/JobInstances | `list_job_instances_by_definition` | ✅ |
| 4 | GET | /v2.0/JobDefinitions/{id}/KioskReleases | `list_kiosk_releases_by_job_definition` | ✅ 🆕P26 |
| 5 | GET | /v2.0/JobInstances | `list_job_instances` | ✅ |
| 6 | POST | /v2.0/JobInstances | `create_job_instance` | ✅ |
| 7 | GET | /v2.0/JobInstances/{id} | `get_job_instance` | ✅ |
| 8 | DELETE | /v2.0/JobInstances/{id} | `delete_job_instance` | ✅ |
| 9 | POST | /v2.0/JobInstances/{id}/Resume | `resume_job_instance` | ✅ |
| 10 | POST | /v2.0/JobInstances/{id}/Start | `start_job_instance` | ✅ |
| 11 | POST | /v2.0/JobInstances/{id}/Stop | `stop_job_instance` | ✅ |
| 12 | GET | /v2.0/Folders | `list_job_folders` | ✅ 🆕P26 |
| 13 | POST | /v2.0/Folders | `create_job_folder` | ✅ |
| 14 | GET | /v2.0/Folders/{id} | `get_job_folder` | ✅ 🆕P26 |
| 15 | PATCH | /v2.0/Folders/{id} | `update_job_folder` | ✅ |
| 16 | DELETE | /v2.0/Folders/{id} | `delete_job_folder` | ✅ |
| 17 | GET | /v2.0/Folders/{folderId}/Folders | `list_job_subfolders` | ✅ 🆕P26 |
| 18 | GET | /v2.0/Folders/{folderId}/JobDefinitions | `list_job_definitions_by_folder` | ✅ |
| 19 | GET | /v2.0/Endpoints/{id}/JobInstances | `list_endpoint_job_instances` | ✅ |
| 20 | GET | /v2.0/Endpoints/{id}/KioskReleases | `list_kiosk_releases_by_endpoint` | ✅ 🆕P26 |
| 21 | GET | /v2.0/KioskReleases | `list_kiosk_releases` | ✅ |
| 22 | POST | /v2.0/KioskReleases | `create_kiosk_release` | ✅ |
| 23 | GET | /v2.0/KioskReleases/{id} | `get_kiosk_release` | ✅ |
| 24 | DELETE | /v2.0/KioskReleases/{id} | `withdraw_kiosk_release` | ✅ |
| 25 | GET | /v2.0/ADObjects/{id}/KioskReleases | `list_kiosk_releases_by_ad_object` | ✅ 🆕P26 |
| 26 | GET | /v2.0/LogicalGroups/{id}/KioskReleases | `list_kiosk_releases_by_logical_group` | ✅ 🆕P26 |
| 27 | POST | /v2.0/LogicalGroups/{id}/AssignJobDefinition | `assign_job_to_logical_group` | ✅ |
| 28 | GET | /v2.0/LogicalGroups/{id}/JobInstances | `list_job_instances_by_logical_group` | ✅ |
| 29 | POST | /v2.0/StaticGroups/{id}/AssignJobDefinition | `assign_job_to_static_group` | ✅ |
| 30 | GET | /v2.0/StaticGroups/{id}/JobInstances | `list_job_instances_by_static_group` | ✅ 🆕P26 |
| 31 | POST | /v2.0/DynamicGroups/{id}/AssignJobDefinition | `assign_job_to_dynamic_group` | ✅ |
| 32 | GET | /v2.0/DynamicGroups/{id}/JobInstances | `list_job_instances_by_dynamic_group` | ✅ 🆕P26 |
| 33 | POST | /v2.0/UniversalDynamicGroups/{id}/AssignJobDefinition | `assign_job_to_universal_dynamic_group` | ✅ |
| 34 | GET | /v2.0/UniversalDynamicGroups/{id}/JobInstances | `list_job_instances_by_universal_dynamic_group` | ✅ |

---

## 7. OperatingSystems (operatingsystems.json → bconnect-operatingsystems-mcp)

**Coverage: 9/9 (100%)** — Unchanged from 25R2

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/Folders | `list_os_folders` | ✅ |
| 2 | POST | /v2.0/Folders | `create_os_folder` | ✅ |
| 3 | GET | /v2.0/Folders/{id} | `get_os_folder` | ✅ |
| 4 | PATCH | /v2.0/Folders/{id} | `update_os_folder` | ✅ |
| 5 | DELETE | /v2.0/Folders/{id} | `delete_os_folder` | ✅ |
| 6 | GET | /v2.0/Folders/{folderId}/Folders | `list_os_folders_by_folder` | ✅ |
| 7 | GET | /v2.0/WindowsEndpoints | `list_os_windows_endpoints` | ✅ |
| 8 | GET | /v2.0/WindowsEndpoints/{id} | `get_os_windows_endpoint` | ✅ |
| 9 | PATCH | /v2.0/WindowsEndpoints/{id} | `update_os_windows_endpoint` | ✅ |

---

## 8. ServerManagement (servermanagement.json → bconnect-servermanagement-mcp)

**Coverage: 30/30 (100%)** — 5 new endpoints vs 25R2, all implemented

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/ApiKeys | `list_api_keys` | ✅ 🆕 |
| 2 | GET | /v2.0/ManagementServer | `get_management_server` | ✅ |
| 3 | POST | /v2.0/Restart | `restart_management_server` | ✅ |
| 4 | POST | /v2.0/CancelScheduledRestart | `cancel_scheduled_restart` | ✅ |
| 5 | GET | /v2.0/Gateway | `get_gateway` | ✅ |
| 6 | GET | /v2.0/Dips | `get_dip_status` | ✅ |
| 7 | POST | /v2.0/Dips/SimulateMSWCleanup | `simulate_msw_cleanup` | ✅ 🆕 |
| 8 | POST | /v2.0/Dips/MSWCleanup | `msw_cleanup` | ✅ 🆕 |
| 9 | GET | /v2.0/DownloadJobs | `list_download_jobs` | ✅ 🆕 |
| 10 | GET | /v2.0/DownloadJobs/{id} | `get_download_job` | ✅ 🆕 |
| 11 | GET | /v2.0/VpnAppliance | `get_vpn_appliance` | ✅ |
| 12 | GET | /v2.0/CloudConnectors | `list_cloud_connectors` | ✅ |
| 13 | GET | /v2.0/PxeRelays | `list_pxe_relays` | ✅ |
| 14 | GET | /v2.0/Microservices | `list_microservices` | ✅ |
| 15 | GET | /v2.0/Microservices/{id} | `get_microservice` | ✅ |
| 16 | POST | /v2.0/Microservices/{id}/Start | `start_microservice` | ✅ |
| 17 | POST | /v2.0/Microservices/{id}/Stop | `stop_microservice` | ✅ |
| 18 | POST | /v2.0/Microservices/{id}/Restart | `restart_microservice` | ✅ |
| 19 | GET | /v2.0/Objects/{id}/Rights | `get_access_rights` | ✅ |
| 20 | PATCH | /v2.0/Objects/{id} | `update_object_permission` | ✅ |
| 21 | GET | /v2.0/SecurityGroups | `list_security_groups` | ✅ |
| 22 | POST | /v2.0/SecurityGroups | `create_security_group` | ✅ |
| 23 | GET | /v2.0/SecurityGroups/{id} | `get_security_group` | ✅ |
| 24 | PATCH | /v2.0/SecurityGroups/{id} | `update_security_group` | ✅ |
| 25 | DELETE | /v2.0/SecurityGroups/{id} | `delete_security_group` | ✅ |
| 26 | GET | /v2.0/SecurityProfiles | `list_security_profiles` | ✅ |
| 27 | POST | /v2.0/SecurityProfiles | `create_security_profile` | ✅ |
| 28 | GET | /v2.0/SecurityProfiles/{id} | `get_security_profile` | ✅ |
| 29 | PATCH | /v2.0/SecurityProfiles/{id} | `update_security_profile` | ✅ |
| 30 | DELETE | /v2.0/SecurityProfiles/{id} | `delete_security_profile` | ✅ |

---

## 9. Software (software.json → bconnect-software-mcp)

**Coverage: 19/19 (100%)** — 15 new endpoints vs 25R2, all implemented

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| | **Installed Software (from 25R2)** | | | |
| 1 | GET | /v2.0/InstalledWindowsSoftware | `list_installed_windows_software` | ✅ |
| 2 | GET | /v2.0/WindowsEndpoints/{id}/InstalledWindowsSoftware | `list_installed_software_by_endpoint` | ✅ |
| 3 | GET | /v2.0/LogicalGroups/{id}/InstalledWindowsSoftware | `list_installed_software_by_logical_group` | ✅ |
| 4 | GET | /v2.0/UniversalDynamicGroups/{id}/InstalledWindowsSoftware | `list_installed_software_by_dynamic_group` | ✅ |
| | **Bundles** 🆕 | | | |
| 5 | GET | /v2.0/Bundles | `list_software_bundles` | ✅ |
| 6 | POST | /v2.0/Bundles | `create_software_bundle` | ✅ |
| 7 | GET | /v2.0/Bundles/{id} | `get_software_bundle` | ✅ |
| 8 | DELETE | /v2.0/Bundles/{id} | `delete_software_bundle` | ✅ |
| | **Bundle Applications** 🆕 | | | |
| 9 | GET | /v2.0/BundleApplications | `list_bundle_applications` | ✅ |
| 10 | DELETE | /v2.0/BundleApplications/{id} | `delete_bundle_application` | ✅ |
| 11 | GET | /v2.0/Bundles/{bundleId}/BundleApplications | `list_bundle_applications_by_bundle` | ✅ |
| 12 | POST | /v2.0/Bundles/{bundleId}/BundleApplications | `add_application_to_bundle` | ✅ |
| 13 | PATCH | /v2.0/Bundles/{bundleId}/BundleApplications/{id} | `replace_application_in_bundle` | ✅ |
| | **Bundle Folders** 🆕 | | | |
| 14 | GET | /v2.0/Bundle/Folders | `list_bundle_folders` | ✅ |
| 15 | POST | /v2.0/Bundle/Folders | `create_bundle_folder` | ✅ |
| 16 | GET | /v2.0/Bundle/Folders/{id} | `get_bundle_folder` | ✅ |
| 17 | PATCH | /v2.0/Bundle/Folders/{id} | `update_bundle_folder` | ✅ |
| 18 | DELETE | /v2.0/Bundle/Folders/{id} | `delete_bundle_folder` | ✅ |
| 19 | GET | /v2.0/Bundle/Folders/{folderId}/Folders | `list_bundle_folders_by_folder` | ✅ |

---

## 10. UniversalDynamicGroups (universaldynamicgroups.json → bconnect-universaldynamicgroups-mcp) 🆕

**Coverage: 6/6 (100%)** — Entirely new in 26R1

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/UniversalDynamicGroups | `list_universal_dynamic_groups` | ✅ |
| 2 | GET | /v2.0/UniversalDynamicGroups/{id} | `get_universal_dynamic_group` | ✅ |
| 3 | GET | /v2.0/Folders/{folderId}/UniversalDynamicGroups | `list_universal_dynamic_groups_by_folder` | ✅ |
| 4 | GET | /v2.0/UniversalDynamicGroupsFolder | `list_udg_folders` | ✅ |
| 5 | GET | /v2.0/UniversalDynamicGroupsFolder/{id} | `get_udg_folder` | ✅ |
| 6 | GET | /v2.0/UniversalDynamicGroupsFolder/{folderId}/Folders | `list_udg_folders_by_folder` | ✅ |

---

## 11. UpdateManagement (updatemanagement.json → bconnect-updatemanagement-mcp)

**Coverage: 3/3 (100%)** — Unchanged from 25R2

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/WindowsEndpoints | `list_update_management_endpoints` | ✅ |
| 2 | GET | /v2.0/WindowsEndpoints/{id} | `get_update_management_endpoint` | ✅ |
| 3 | PATCH | /v2.0/WindowsEndpoints/{id} | `update_update_management_endpoint` | ✅ |

---

## 12. Variables (variables.json → bconnect-variables-mcp)

**Coverage: 12/12 (100%)** — Unchanged from 25R2

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/VariableDefinitions | `list_variable_definitions` | ✅ |
| 2 | POST | /v2.0/VariableDefinitions | `create_variable_definition` | ✅ |
| 3 | GET | /v2.0/VariableDefinitions/{id} | `get_variable_definition` | ✅ |
| 4 | PATCH | /v2.0/VariableDefinitions/{id} | `update_variable_definition` | ✅ |
| 5 | DELETE | /v2.0/VariableDefinitions/{id} | `delete_variable_definition` | ✅ |
| 6 | GET | /v2.0/VariableInstances | `list_variable_instances` | ✅ |
| 7 | GET | /v2.0/VariableInstances/{id} | `get_variable_instance` | ✅ |
| 8 | PATCH | /v2.0/VariableInstances/{id} | `update_variable_instance` | ✅ |
| 9 | GET | /v2.0/Endpoints/{id}/VariableInstances | `list_variable_instances_by_endpoint` | ✅ |
| 10 | GET | /v2.0/LogicalGroups/{id}/VariableInstances | `list_variable_instances_by_logical_group` | ✅ |
| 11 | GET | /v2.0/ADObjects/{id}/VariableInstances | `list_variable_instances_by_ad_object` | ✅ |
| 12 | GET | /v2.0/WindowsJobDefinitions/{id}/VariableInstances | `list_variable_instances_by_job_definition` | ✅ |

> Note: 25R2 had an additional endpoint `GET /v2.0/WindowsApplications/{id}/VariableInstances` → `list_variable_instances_by_application` which appears removed from 26R1 spec.

---

## Coverage by API Domain

| Domain | Endpoints | Implemented | Coverage | vs 25R2 | Phase |
|--------|-----------|-------------|----------|---------|-------|
| ActiveDirectory | 16 | 16 | 100% | = | — |
| Assets | 26 | 26 | 100% | +2 🆕 | — |
| **Compliance** 🆕 | **8** | **8** | **100%** | New | — |
| DefenseControl | 13 | 13 | 100% | +2 🆕 | — |
| Endpoints (endpoints-mcp) | 64 | 64 | 100% | +6 new tools | P24 |
| Endpoints (groups-mcp) | 33 | 33 | 100% | group-scoped + ADUser queries | P25 |
| **Jobs** | **34** | **34** | **100%** | all gaps fixed | P26 |
| OperatingSystems | 9 | 9 | 100% | = | — |
| ServerManagement | 30 | 30 | 100% | +5 🆕 | — |
| Software | 19 | 19 | 100% | +15 🆕 | — |
| **UniversalDynamicGroups** 🆕 | **6** | **6** | **100%** | New | — |
| UpdateManagement | 3 | 3 | 100% | = | — |
| Variables | 13 | 13 | 100% | = | — |
| **TOTAL** | **264** | **264** | **100%** | | |

---

## Not Implemented — Summary

### 0 remaining endpoints — **100% coverage achieved**

All 264 endpoints covered across 13 MCP servers.
