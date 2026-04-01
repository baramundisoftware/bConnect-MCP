# bConnect MCP Implementation Status — 25R2

> Generated: 2026-04-01 (verified/corrected: 2026-04-01)
> OpenAPI Source: `/home/ansible/MCP/bConnectOpenAPI/25R2/` (10 spec files, ~228 endpoints)
> MCP Source: `/home/ansible/MCP/bConnect-MCP/` (13 MCP servers)

## Summary

| Metric | Count |
|--------|-------|
| Total API Endpoints (25R2) | 228 |
| Implemented in MCP | 228 |
| Not Implemented | 0 |
| Coverage | **100%** |

> **All 228 endpoints covered.** `list_industrial_endpoints` and `get_industrial_endpoint` added to bconnect-endpoints-mcp.

---

## 1. ActiveDirectory (bConnect_ActiveDirectory.json → bconnect-activedirectory-mcp)

**Coverage: 16/16 (100%)**

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

## 2. Assets (bConnect_Assets.json → bconnect-assets-mcp)

**Coverage: 24/24 (100%)**

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

---

## 3. DefenseControl (bConnect_DefenseControl.json → bconnect-defensecontrol-mcp)

**Coverage: 11/11 (100%)**

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/BitLocker/WindowsEndpoints | `list_bitlocker_windows_endpoints` | ✅ |
| 2 | GET | /v2.0/BitLocker/WindowsEndpoints/{id} | `get_bitlocker_windows_endpoint` | ✅ |
| 3 | GET | /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id} | `get_local_admin_accounts` | ✅ |
| 4 | PATCH | /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id} | `patch_local_admin_user_credentials` | ✅ |
| 5 | POST | /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}/TriggerUpdateOnClient | `trigger_update_on_client` | ✅ |
| 6 | GET | /v2.0/MicrosoftDefender/Threats | `list_defender_threats` | ✅ |
| 7 | GET | /v2.0/MicrosoftDefender/Threats/{id} | `get_defender_threat` | ✅ |
| 8 | GET | /v2.0/MicrosoftDefender/WindowsEndpoints | `list_defender_windows_endpoints` | ✅ |
| 9 | GET | /v2.0/MicrosoftDefender/WindowsEndpoints/{id} | `get_defender_windows_endpoint` | ✅ |
| 10 | GET | /v2.0/MicrosoftDefender/WindowsEndpoints/{endpointId}/Threats | `list_defender_threats_by_endpoint` | ✅ |
| 11 | GET | /v2.0/MicrosoftDefender/LogicalGroups/{logicalGroupId}/Threats | `list_defender_threats_by_logical_group` | ✅ |

---

## 4. Endpoints (bConnect_Endpoints.json → bconnect-endpoints-mcp + bconnect-groups-mcp)

**Coverage: 89/89 (100%)** — bconnect-endpoints-mcp: 60 tools (Phase 24 + list/get industrial); bconnect-groups-mcp: 33 group-scoped tools

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| | **Generic Endpoints** | | | |
| 1 | GET | /v2.0/Endpoints | `list_endpoints` | ✅ |
| 2 | GET | /v2.0/Endpoints/{id} | `get_endpoint` | ✅ |
| 3 | DELETE | /v2.0/Endpoints/{id} | `delete_endpoint` | ✅ |
| 4 | GET | /v2.0/Endpoints/{id}/MaintenanceWindow | `get_maintenance_window_for_endpoint` | ✅ 🆕P24 |
| 5 | POST | /v2.0/Endpoints/{id}/MaintenanceWindow | `create_maintenance_window_for_endpoint` | ✅ |
| 6 | PUT | /v2.0/Endpoints/{id}/MaintenanceWindow | `update_maintenance_window_for_endpoint` | ✅ |
| 7 | DELETE | /v2.0/Endpoints/{id}/MaintenanceWindow | `delete_maintenance_window_for_endpoint` | ✅ |
| | **Windows Endpoints** | | | |
| 8 | GET | /v2.0/WindowsEndpoints | `list_windows_endpoints` | ✅ |
| 9 | POST | /v2.0/WindowsEndpoints | `create_windows_endpoint` | ✅ |
| 10 | GET | /v2.0/WindowsEndpoints/{id} | `get_windows_endpoint` | ✅ |
| 11 | PATCH | /v2.0/WindowsEndpoints/{id} | `update_windows_endpoint` | ✅ |
| 12 | DELETE | /v2.0/WindowsEndpoints/{id} | `delete_windows_endpoint` | ✅ |
| 13 | POST | /v2.0/WindowsEndpoints/{id}/StartEnrollment | `start_windows_enrollment` | ✅ |
| 14 | POST | /v2.0/WindowsEndpoints/{id}/TriggerInstallationViaIntune | `trigger_intune_installation` | ✅ |
| | **Linux Endpoints** | | | |
| 15 | GET | /v2.0/LinuxEndpoints | `list_linux_endpoints` | ✅ |
| 16 | POST | /v2.0/LinuxEndpoints | `create_linux_endpoint` | ✅ |
| 17 | GET | /v2.0/LinuxEndpoints/{id} | `get_linux_endpoint` | ✅ |
| 18 | PATCH | /v2.0/LinuxEndpoints/{id} | `update_linux_endpoint` | ✅ |
| 19 | DELETE | /v2.0/LinuxEndpoints/{id} | `delete_linux_endpoint` | ✅ |
| | **macOS Endpoints** | | | |
| 20 | GET | /v2.0/MacEndpoints | `list_mac_endpoints` | ✅ |
| 21 | POST | /v2.0/MacEndpoints | `create_mac_endpoint` | ✅ |
| 22 | GET | /v2.0/MacEndpoints/{id} | `get_mac_endpoint` | ✅ |
| 23 | PATCH | /v2.0/MacEndpoints/{id} | `update_mac_endpoint` | ✅ |
| 24 | DELETE | /v2.0/MacEndpoints/{id} | `delete_mac_endpoint` | ✅ |
| 25 | POST | /v2.0/MacEndpoints/{id}/StartEnrollment | `start_mac_enrollment` | ✅ |
| | **Android Endpoints** | | | |
| 26 | GET | /v2.0/AndroidEndpoints | `list_android_endpoints` | ✅ 🆕P24 |
| 27 | POST | /v2.0/AndroidEndpoints | `create_android_endpoint` | ✅ |
| 28 | GET | /v2.0/AndroidEndpoints/{id} | `get_android_endpoint` | ✅ 🆕P24 |
| 29 | PATCH | /v2.0/AndroidEndpoints/{id} | `update_android_endpoint` | ✅ |
| 30 | DELETE | /v2.0/AndroidEndpoints/{id} | `delete_android_endpoint` | ✅ |
| 31 | POST | /v2.0/AndroidEndpoints/{id}/StartEnrollment | `start_android_enrollment` | ✅ |
| | **iOS Endpoints** | | | |
| 32 | GET | /v2.0/IosEndpoints | `list_ios_endpoints` | ✅ 🆕P24 |
| 33 | POST | /v2.0/IosEndpoints | `create_ios_endpoint` | ✅ 🆕P24 |
| 34 | GET | /v2.0/IosEndpoints/{id} | `get_ios_endpoint` | ✅ 🆕P24 |
| 35 | PATCH | /v2.0/IosEndpoints/{id} | `update_ios_endpoint` | ✅ 🆕P24 |
| 36 | DELETE | /v2.0/IosEndpoints/{id} | `delete_ios_endpoint` | ✅ 🆕P24 |
| 37 | POST | /v2.0/IosEndpoints/{id}/StartEnrollment | `start_ios_enrollment` | ✅ |
| | **Industrial Endpoints** | | | |
| 38 | GET | /v2.0/IndustrialEndpoints | `list_industrial_endpoints` | ✅ |
| 39 | POST | /v2.0/IndustrialEndpoints | `create_industrial_endpoint` | ✅ |
| 40 | GET | /v2.0/IndustrialEndpoints/{id} | `get_industrial_endpoint` | ✅ |
| 41 | PATCH | /v2.0/IndustrialEndpoints/{id} | `update_industrial_endpoint` | ✅ |
| 42 | DELETE | /v2.0/IndustrialEndpoints/{id} | `delete_industrial_endpoint` | ✅ |
| | **Network Endpoints** | | | |
| 43 | GET | /v2.0/NetworkEndpoints | `list_network_endpoints` | ✅ 🆕P24 |
| 44 | POST | /v2.0/NetworkEndpoints | `create_network_endpoint` | ✅ |
| 45 | GET | /v2.0/NetworkEndpoints/{id} | `get_network_endpoint` | ✅ 🆕P24 |
| 46 | PATCH | /v2.0/NetworkEndpoints/{id} | `update_network_endpoint` | ✅ |
| 47 | DELETE | /v2.0/NetworkEndpoints/{id} | `delete_network_endpoint` | ✅ |
| | **Logical Groups** | | | |
| 48 | GET | /v2.0/LogicalGroups | `list_logical_groups` | ✅ |
| 49 | POST | /v2.0/LogicalGroups | `create_logical_group` | ✅ |
| 50 | GET | /v2.0/LogicalGroups/{id} | `get_logical_group` | ✅ |
| 51 | PATCH | /v2.0/LogicalGroups/{id} | `update_logical_group` | ✅ |
| 52 | DELETE | /v2.0/LogicalGroups/{id} | `delete_logical_group` | ✅ |
| 53 | GET | /v2.0/LogicalGroups/{id}/MaintenanceWindow | `get_maintenance_window_for_logical_group` | ✅ 🆕P24 |
| 54 | POST | /v2.0/LogicalGroups/{id}/MaintenanceWindow | `create_maintenance_window_for_logical_group` | ✅ |
| 55 | PUT | /v2.0/LogicalGroups/{id}/MaintenanceWindow | `update_maintenance_window_for_logical_group` | ✅ |
| 56 | DELETE | /v2.0/LogicalGroups/{id}/MaintenanceWindow | `delete_maintenance_window_for_logical_group` | ✅ |
| | **Endpoints by Logical Group** | | | |
| 57 | GET | /v2.0/LogicalGroups/{id}/Endpoints | `list_endpoints_by_logical_group` | ✅ |
| 58 | GET | /v2.0/LogicalGroups/{id}/WindowsEndpoints | `list_windows_endpoints_by_logical_group` | ✅ |
| 59 | GET | /v2.0/LogicalGroups/{id}/LogicalGroups | `list_group_endpoints` | ✅ |
| 60 | GET | /v2.0/LogicalGroups/{id}/AndroidEndpoints | `list_android_endpoints_by_logical_group` | ✅ 🆕P25 (groups-mcp) |
| 61 | GET | /v2.0/LogicalGroups/{id}/IosEndpoints | `list_ios_endpoints_by_logical_group` | ✅ 🆕P25 (groups-mcp) |
| 62 | GET | /v2.0/LogicalGroups/{id}/LinuxEndpoints | `list_linux_endpoints_by_logical_group` | ✅ 🆕P25 (groups-mcp) |
| 63 | GET | /v2.0/LogicalGroups/{id}/MacEndpoints | `list_mac_endpoints_by_logical_group` | ✅ 🆕P25 (groups-mcp) |
| 64 | GET | /v2.0/LogicalGroups/{id}/NetworkEndpoints | `list_network_endpoints_by_logical_group` | ✅ 🆕P25 (groups-mcp) |
| 65 | GET | /v2.0/LogicalGroups/{id}/IndustrialEndpoints | `list_industrial_endpoints_by_logical_group` | ✅ 🆕P25 (groups-mcp) |
| | **Endpoints by Static Group** | | | |
| 66 | GET | /v2.0/StaticGroups/{id}/Endpoints | `list_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 67 | GET | /v2.0/StaticGroups/{id}/WindowsEndpoints | `list_windows_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 68 | GET | /v2.0/StaticGroups/{id}/AndroidEndpoints | `list_android_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 69 | GET | /v2.0/StaticGroups/{id}/IosEndpoints | `list_ios_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 70 | GET | /v2.0/StaticGroups/{id}/LinuxEndpoints | `list_linux_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 71 | GET | /v2.0/StaticGroups/{id}/MacEndpoints | `list_mac_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 72 | GET | /v2.0/StaticGroups/{id}/NetworkEndpoints | `list_network_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| 73 | GET | /v2.0/StaticGroups/{id}/IndustrialEndpoints | `list_industrial_endpoints_by_static_group` | ✅ 🆕P25 (groups-mcp) |
| | **Endpoints by Dynamic Group** | | | |
| 74 | GET | /v2.0/DynamicGroups/{id}/Endpoints | `list_endpoints_by_dynamic_group` | ✅ 🆕P25 (groups-mcp) |
| 75 | GET | /v2.0/DynamicGroups/{id}/WindowsEndpoints | `list_windows_endpoints_by_dynamic_group` | ✅ 🆕P25 (groups-mcp) |
| | **Endpoints by Universal Dynamic Group** | | | |
| 76 | GET | /v2.0/UniversalDynamicGroups/{id}/Endpoints | `list_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 77 | GET | /v2.0/UniversalDynamicGroups/{id}/WindowsEndpoints | `list_windows_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 78 | GET | /v2.0/UniversalDynamicGroups/{id}/AndroidEndpoints | `list_android_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 79 | GET | /v2.0/UniversalDynamicGroups/{id}/IosEndpoints | `list_ios_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 80 | GET | /v2.0/UniversalDynamicGroups/{id}/LinuxEndpoints | `list_linux_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 81 | GET | /v2.0/UniversalDynamicGroups/{id}/MacEndpoints | `list_mac_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 82 | GET | /v2.0/UniversalDynamicGroups/{id}/NetworkEndpoints | `list_network_endpoints_by_udg` | ✅ 🆕P25 (groups-mcp) |
| 83 | GET | /v2.0/UniversalDynamicGroups/{id}/IndustrialEndpoints | `list_industrial_endpoints_by_universal_dynamic_group` | ✅ 🆕P25 (groups-mcp) |
| | **Endpoints by AD User** | | | |
| 84 | GET | /v2.0/ADUsers/{id}/Endpoints | `list_endpoints_by_ad_user` | ✅ (groups-mcp) |
| 85 | GET | /v2.0/ADUsers/{id}/WindowsEndpoints | `list_windows_endpoints_by_ad_user` | ✅ (groups-mcp) |
| 86 | GET | /v2.0/ADUsers/{id}/AndroidEndpoints | `list_android_endpoints_by_ad_user` | ✅ (groups-mcp) |
| 87 | GET | /v2.0/ADUsers/{id}/IosEndpoints | `list_ios_endpoints_by_ad_user` | ✅ (groups-mcp) |
| 88 | GET | /v2.0/ADUsers/{id}/LinuxEndpoints | `list_linux_endpoints_by_ad_user` | ✅ (groups-mcp) |
| 89 | GET | /v2.0/ADUsers/{id}/MacEndpoints | `list_mac_endpoints_by_ad_user` | ✅ (groups-mcp) |

### Remaining Endpoint Gaps

None — 89/89 endpoints covered (100%).

---

## 5. Jobs (bConnect_Jobs.json → bconnect-jobs-mcp)

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

## 6. OperatingSystems (bConnect_OperatingSystems.json → bconnect-operatingsystems-mcp)

**Coverage: 9/9 (100%)**

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

## 7. ServerManagement (bConnect_ServerManagement.json → bconnect-servermanagement-mcp)

**Coverage: 25/25 (100%)**

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/ManagementServer | `get_management_server` | ✅ |
| 2 | POST | /v2.0/Restart | `restart_management_server` | ✅ |
| 3 | POST | /v2.0/CancelScheduledRestart | `cancel_scheduled_restart` | ✅ |
| 4 | GET | /v2.0/Gateway | `get_gateway` | ✅ |
| 5 | GET | /v2.0/Dips | `get_dip_status` | ✅ |
| 6 | GET | /v2.0/VpnAppliance | `get_vpn_appliance` | ✅ |
| 7 | GET | /v2.0/CloudConnectors | `list_cloud_connectors` | ✅ |
| 8 | GET | /v2.0/PxeRelays | `list_pxe_relays` | ✅ |
| 9 | GET | /v2.0/Microservices | `list_microservices` | ✅ |
| 10 | GET | /v2.0/Microservices/{id} | `get_microservice` | ✅ |
| 11 | POST | /v2.0/Microservices/{id}/Start | `start_microservice` | ✅ |
| 12 | POST | /v2.0/Microservices/{id}/Stop | `stop_microservice` | ✅ |
| 13 | POST | /v2.0/Microservices/{id}/Restart | `restart_microservice` | ✅ |
| 14 | GET | /v2.0/Objects/{id}/Rights | `get_access_rights` | ✅ |
| 15 | PATCH | /v2.0/Objects/{id} | `update_object_permission` | ✅ |
| 16 | GET | /v2.0/SecurityGroups | `list_security_groups` | ✅ |
| 17 | POST | /v2.0/SecurityGroups | `create_security_group` | ✅ |
| 18 | GET | /v2.0/SecurityGroups/{id} | `get_security_group` | ✅ |
| 19 | PATCH | /v2.0/SecurityGroups/{id} | `update_security_group` | ✅ |
| 20 | DELETE | /v2.0/SecurityGroups/{id} | `delete_security_group` | ✅ |
| 21 | GET | /v2.0/SecurityProfiles | `list_security_profiles` | ✅ |
| 22 | POST | /v2.0/SecurityProfiles | `create_security_profile` | ✅ |
| 23 | GET | /v2.0/SecurityProfiles/{id} | `get_security_profile` | ✅ |
| 24 | PATCH | /v2.0/SecurityProfiles/{id} | `update_security_profile` | ✅ |
| 25 | DELETE | /v2.0/SecurityProfiles/{id} | `delete_security_profile` | ✅ |

---

## 8. Software (bConnect_Software.json → bconnect-software-mcp)

**Coverage: 4/4 (100%)**

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/InstalledWindowsSoftware | `list_installed_windows_software` | ✅ |
| 2 | GET | /v2.0/WindowsEndpoints/{id}/InstalledWindowsSoftware | `list_installed_software_by_endpoint` | ✅ |
| 3 | GET | /v2.0/LogicalGroups/{id}/InstalledWindowsSoftware | `list_installed_software_by_logical_group` | ✅ |
| 4 | GET | /v2.0/UniversalDynamicGroups/{id}/InstalledWindowsSoftware | `list_installed_software_by_dynamic_group` | ✅ |

---

## 9. UpdateManagement (bConnect_UpdateManagement.json → bconnect-updatemanagement-mcp)

**Coverage: 3/3 (100%)**

| # | Method | Endpoint | MCP Tool | Status |
|---|--------|----------|----------|--------|
| 1 | GET | /v2.0/WindowsEndpoints | `list_update_management_endpoints` | ✅ |
| 2 | GET | /v2.0/WindowsEndpoints/{id} | `get_update_management_endpoint` | ✅ |
| 3 | PATCH | /v2.0/WindowsEndpoints/{id} | `update_update_management_endpoint` | ✅ |

---

## 10. Variables (bConnect_Variables.json → bconnect-variables-mcp)

**Coverage: 13/13 (100%)**

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
| 13 | GET | /v2.0/WindowsApplications/{id}/VariableInstances | `list_variable_instances_by_application` | ✅ |

---

## Coverage by API Domain

| Domain | Endpoints | Implemented | Coverage | Phase |
|--------|-----------|-------------|----------|-------|
| ActiveDirectory | 16 | 16 | 100% | — |
| Assets | 24 | 24 | 100% | — |
| DefenseControl | 11 | 11 | 100% | — |
| Endpoints (endpoints-mcp) | 60 | 60 | 100% | P24 + industrial list/get |
| Endpoints (groups-mcp) | 33 | 33 | 100% | P25 + ADUsers |
| **Jobs** | **34** | **34** | **100%** | P26 |
| OperatingSystems | 9 | 9 | 100% | — |
| ServerManagement | 25 | 25 | 100% | — |
| Software | 4 | 4 | 100% | — |
| UpdateManagement | 3 | 3 | 100% | — |
| Variables | 13 | 13 | 100% | — |
| **TOTAL** | **228** | **228** | **100%** | |

> Note: 89 endpoints.json rows = 60 (endpoints-mcp) + 27 (groups-mcp group-type queries) + 6 (groups-mcp ADUser queries) = 93 tools covering 89 spec rows (some overlap on logical group endpoint queries).

## Not Implemented — Summary

### 0 remaining endpoints — **100% coverage achieved**

All 228 endpoints covered across 13 MCP servers.
