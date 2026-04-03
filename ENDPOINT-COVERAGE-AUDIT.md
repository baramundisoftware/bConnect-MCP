# Endpoint Coverage Audit Report

**Date**: 2026-03-27
**Prepared by**: SoftwareArchitect role — bConnect-MCP project
**Source**: Cross-reference of `openapi-specs/*.json` operationIds against registered tool names in `src/index.ts`
**Updated**: 2026-03-27 — Phase 4 top-10 tools implemented; coverage updated from 111/163 to 121/163

---

## Executive Summary

| Metric | Count | Percentage |
|--------|-------|-----------|
| Total unique operationIds in all specs | 216 | 100% |
| Implemented — strict name match (test-verified) | 71 | 32.9% |
| Implemented — semantic match (different naming convention) | 83 | 38.4% |
| **Total semantically implemented** | **154** | **71.3%** |
| Truly missing (no tool exists for the operation) | 62 | 28.7% |
| **V2.0 tools vs STATUS.md total (163)** | **121/163** | **74.2%** |

> **Important**: The coverage test uses strict `operationId → snake_case` conversion (e.g. `GetADGroups → get_ad_groups`). However `src/index.ts` uses different naming conventions (e.g. `list_ad_groups`, `restart_management_server`). Strict test coverage is 32.9% but actual semantic coverage is **71.3%** (up from 66.7% after Phase 4).

> **Phase 4 update (2026-03-27)**: 10 high-value tools implemented — `get_linux_endpoint`, `get_mac_endpoint`, `list_windows_endpoints_by_logical_group`, `list_endpoints_by_logical_group`, `start_android_enrollment`, `start_ios_enrollment`, `get_ad_object_memberships`, `list_job_instances_by_definition`, `list_job_instances_by_logical_group`, `list_job_definitions_by_folder`.

> **Additional tools beyond the 10 OpenAPI v2.0 specs**: `src/index.ts` also registers tools backed by v1 modules (`bitlocker-v1`, `complianceviolations-v1`, `ssh-v1`, `setup-integrity-v1`, `inventory-v1`, `vpp-v1`, `documentation-search`, `forum-search`, `known-issues-search`) which have no corresponding `openapi-specs/*.json` files. These are not included in the 216 total.

---

## Module-by-Module Coverage

### Module: ActiveDirectory (`bConnect_ActiveDirectory.json`)

16 operationIds

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetADGroups | GET | /v2.0/ADGroups | IMPLEMENTED | `list_ad_groups` | — |
| GetADGroupById | GET | /v2.0/ADGroups/{id} | IMPLEMENTED | `get_ad_group` | — |
| GetADGroupsByADGroupId | GET | /v2.0/ADGroups/{adGroupId}/ADGroups | **MISSING** | — | MEDIUM |
| GetADGroupsByOrgUnitId | GET | /v2.0/OrgUnits/{orgUnitId}/ADGroups | IMPLEMENTED | `list_ad_groups_by_org_unit` | — |
| GetADObjects | GET | /v2.0/ADObjects | IMPLEMENTED | `list_ad_objects` | — |
| GetADObjectById | GET | /v2.0/ADObjects/{id} | IMPLEMENTED | `get_ad_object` | — |
| GetADObjectMemberships | GET | /v2.0/ADObjects/{id}/ADGroupMemberships | IMPLEMENTED | `get_ad_object_memberships` | — |
| GetADObjectsByADGroupId | GET | /v2.0/ADGroups/{adGroupId}/ADObjects | **MISSING** | — | MEDIUM |
| GetADObjectsByOrgUnitId | GET | /v2.0/OrgUnits/{orgUnitId}/ADObjects | **MISSING** | — | LOW |
| GetADUsers | GET | /v2.0/ADUsers | IMPLEMENTED | `list_ad_users` | — |
| GetADUserById | GET | /v2.0/ADUsers/{id} | IMPLEMENTED | `get_ad_user` | — |
| GetADUsersByADGroupId | GET | /v2.0/ADGroups/{adGroupId}/ADUsers | IMPLEMENTED | `list_ad_users_by_group` | — |
| GetADUsersByOrgUnitId | GET | /v2.0/OrgUnits/{orgUnitId}/ADUsers | **MISSING** | — | LOW |
| GetOrgUnits | GET | /v2.0/OrgUnits | IMPLEMENTED | `list_org_units` | — |
| GetOrgUnit | GET | /v2.0/OrgUnits/{id} | IMPLEMENTED | `get_org_unit` | — |
| GetOrgUnitsByOrgUnitId | GET | /v2.0/OrgUnits/{orgUnitId}/OrgUnits | **MISSING** | — | LOW |

**Module coverage**: 11/16 implemented (68.8%) | 5 missing

---

### Module: Assets (`bConnect_Assets.json`)

24 operationIds

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetAssets | GET | /v2.0/Assets | IMPLEMENTED | `list_assets` | — |
| CreateAsset | POST | /v2.0/Assets | IMPLEMENTED | `create_asset` | — |
| GetAsset | GET | /v2.0/Assets/{id} | IMPLEMENTED | `get_asset` | — |
| UpdateAsset | PATCH | /v2.0/Assets/{id} | IMPLEMENTED | `update_asset` | — |
| DeleteAsset | DELETE | /v2.0/Assets/{id} | IMPLEMENTED | `delete_asset` | — |
| GetAssetsAssetStock | GET | /v2.0/AssetStock/Assets | IMPLEMENTED | `list_asset_stock_assets` | — |
| GetAssetsByLogicalGroup | GET | /v2.0/LogicalGroups/{logicalGroupId}/Assets | IMPLEMENTED | `list_assets_by_logical_group` | — |
| GetAssetsByWindowsEndpoint | GET | /v2.0/WindowsEndpoint/{endpointId}/Assets | IMPLEMENTED | `list_assets_by_endpoint` | — |
| GetAssetStockFolders | GET | /v2.0/AssetStock/Folders | IMPLEMENTED | `list_asset_stock_folders` | — |
| CreateAssetStockFolder | POST | /v2.0/AssetStock/Folders | IMPLEMENTED | `create_asset_stock_folder` | — |
| GetAssetStockFolder | GET | /v2.0/AssetStock/Folders/{id} | **MISSING** | — | LOW |
| UpdateAssetStockFolder | PATCH | /v2.0/AssetStock/Folders/{id} | IMPLEMENTED | `update_asset_stock_folder` | — |
| DeleteAssetStockFolder | DELETE | /v2.0/AssetStock/Folders/{id} | IMPLEMENTED | `delete_asset_stock_folder` | — |
| GetAssetStockFoldersByParentId | GET | /v2.0/AssetStock/Folders/{folderId}/Folders | **MISSING** | — | LOW |
| GetAssetTypeFolders | GET | /v2.0/AssetTypes/Folders | **MISSING** | — | LOW |
| CreateAssetTypeFolder | POST | /v2.0/AssetTypes/Folders | IMPLEMENTED | `create_asset_type_folder` | — |
| GetAssetTypeFolder | GET | /v2.0/AssetTypes/Folders/{id} | **MISSING** | — | LOW |
| UpdateAssetTypeFolder | PATCH | /v2.0/AssetTypes/Folders/{id} | IMPLEMENTED | `update_asset_type_folder` | — |
| DeleteAssetTypeFolder | DELETE | /v2.0/AssetTypes/Folders/{id} | IMPLEMENTED | `delete_asset_type_folder` | — |
| GetAssetTypeFoldersByParentId | GET | /v2.0/AssetTypes/Folders/{folderId}/Folders | **MISSING** | — | LOW |
| GetAssetTypes | GET | /v2.0/AssetTypes | IMPLEMENTED | `list_asset_types` | — |
| CreateAssetType | POST | /v2.0/AssetTypes | IMPLEMENTED | `create_asset_type` | — |
| GetAssetType | GET | /v2.0/AssetTypes/{id} | IMPLEMENTED | `get_asset_type` | — |
| DeleteAssetType | DELETE | /v2.0/AssetTypes/{id} | IMPLEMENTED | `delete_asset_type` | — |

**Module coverage**: 19/24 implemented (79.2%) | 5 missing

---

### Module: DefenseControl (`bConnect_DefenseControl.json`)

11 operationIds

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetBitLockerStates | GET | /v2.0/BitLocker/WindowsEndpoints | IMPLEMENTED | `list_bitlocker_windows_endpoints` | — |
| GetBitLockerStatesByWindowsEndpointId | GET | /v2.0/BitLocker/WindowsEndpoints/{id} | IMPLEMENTED | `get_bitlocker_windows_endpoint` | — |
| GetLocalAdminUserCredentialsByWindowsEndpointId | GET | /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id} | IMPLEMENTED | `get_local_admin_accounts` | — |
| PatchLocalAdminUserCredentialsForWindowsEndpointId | PATCH | /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id} | IMPLEMENTED | `patch_local_admin_user_credentials` | — |
| TriggerUpdateOnClient | POST | /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}/TriggerUpdateOnClient | IMPLEMENTED | `trigger_update_on_client` | — |
| GetMicrosoftDefenderThreats | GET | /v2.0/MicrosoftDefender/Threats | IMPLEMENTED | `list_defender_threats` | — |
| GetMicrosoftDefenderThreat | GET | /v2.0/MicrosoftDefender/Threats/{id} | IMPLEMENTED | `get_defender_threat` | — |
| GetMicrosoftDefenderThreatsByWindowsEndpointId | GET | /v2.0/MicrosoftDefender/WindowsEndpoints/{endpointId}/Threats | IMPLEMENTED | `list_defender_threats_by_endpoint` | — |
| GetMicrosoftDefenderThreatsByLogicalGroupId | GET | /v2.0/MicrosoftDefender/LogicalGroups/{logicalGroupId}/Threats | IMPLEMENTED | `list_defender_threats_by_logical_group` | — |
| GetMicrosoftDefenderStates | GET | /v2.0/MicrosoftDefender/WindowsEndpoints | IMPLEMENTED | `list_defender_windows_endpoints` | — |
| GetMicrosoftDefenderStatesByWindowsEndpointId | GET | /v2.0/MicrosoftDefender/WindowsEndpoints/{id} | IMPLEMENTED | `get_defender_windows_endpoint` | — |

**Module coverage**: 11/11 implemented (100%) | 0 missing

---

### Module: Endpoints (`bConnect_Endpoints.json`)

89 operationIds (largest module)

#### Android Endpoints

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetAndroidEndpoints | GET | /v2.0/AndroidEndpoints | **MISSING** | — | MEDIUM |
| CreateAndroidEndpoint | POST | /v2.0/AndroidEndpoints | IMPLEMENTED | `create_android_endpoint` | — |
| GetAndroidEndpoint | GET | /v2.0/AndroidEndpoints/{id} | **MISSING** | — | MEDIUM |
| UpdateAndroidEndpoint | PATCH | /v2.0/AndroidEndpoints/{id} | IMPLEMENTED | `update_android_endpoint` | — |
| DeleteAndroidEndpoint | DELETE | /v2.0/AndroidEndpoints/{id} | IMPLEMENTED | `delete_android_endpoint` | — |
| GetAndroidEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/AndroidEndpoints | **MISSING** | — | LOW |
| GetAndroidEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/AndroidEndpoints | **MISSING** | — | LOW |
| GetAndroidEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/AndroidEndpoints | **MISSING** | — | LOW |
| GetAndroidEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/AndroidEndpoints | **MISSING** | — | LOW |
| StartAndroidEndpointEnrollment | POST | /v2.0/AndroidEndpoints/{id}/StartEnrollment | IMPLEMENTED | `start_android_enrollment` | — |

#### Generic Endpoints

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetEndpoints | GET | /v2.0/Endpoints | IMPLEMENTED | `list_endpoints` | — |
| GetEndpoint | GET | /v2.0/Endpoints/{id} | IMPLEMENTED | `get_endpoint` | — |
| DeleteEndpoint | DELETE | /v2.0/Endpoints/{id} | IMPLEMENTED | `delete_endpoint` | — |
| GetEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/Endpoints | **MISSING** | — | MEDIUM |
| GetEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/Endpoints | IMPLEMENTED | `list_endpoints_by_logical_group` | — |
| GetEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/Endpoints | **MISSING** | — | MEDIUM |
| GetEndpointsByDynamicGroupId | GET | /v2.0/DynamicGroups/{dynamicGroupId}/Endpoints | **MISSING** | — | MEDIUM |
| GetEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/Endpoints | **MISSING** | — | MEDIUM |
| GetMaintenanceWindowForEndpointById | GET | /v2.0/Endpoints/{id}/MaintenanceWindow | **MISSING** | — | MEDIUM |
| CreateMaintenanceWindowForEndpointById | POST | /v2.0/Endpoints/{id}/MaintenanceWindow | IMPLEMENTED | `create_maintenance_window_for_endpoint` | — |
| UpdateMaintenanceWindowForEndpointById | PUT | /v2.0/Endpoints/{id}/MaintenanceWindow | IMPLEMENTED | `update_maintenance_window_for_endpoint` | — |
| DeleteMaintenanceWindowForEndpointById | DELETE | /v2.0/Endpoints/{id}/MaintenanceWindow | IMPLEMENTED | `delete_maintenance_window_for_endpoint` | — |

#### Industrial Endpoints

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetIndustrialEndpoints | GET | /v2.0/IndustrialEndpoints | **MISSING** | — | MEDIUM |
| CreateIndustrialEndpoint | POST | /v2.0/IndustrialEndpoints | IMPLEMENTED | `create_industrial_endpoint` | — |
| GetIndustrialEndpoint | GET | /v2.0/IndustrialEndpoints/{id} | **MISSING** | — | MEDIUM |
| UpdateIndustrialEndpoint | PATCH | /v2.0/IndustrialEndpoints/{id} | IMPLEMENTED | `update_industrial_endpoint` | — |
| DeleteIndustrialEndpoint | DELETE | /v2.0/IndustrialEndpoints/{id} | IMPLEMENTED | `delete_industrial_endpoint` | — |
| GetIndustrialEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/IndustrialEndpoints | **MISSING** | — | LOW |
| GetIndustrialEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/IndustrialEndpoints | **MISSING** | — | LOW |
| GetIndustrialEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/IndustrialEndpoints | **MISSING** | — | LOW |

#### iOS Endpoints

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetIOSEndpoints | GET | /v2.0/IosEndpoints | **MISSING** | — | MEDIUM |
| CreateIOSEndpoint | POST | /v2.0/IosEndpoints | **MISSING** | — | MEDIUM |
| GetIOSEndpoint | GET | /v2.0/IosEndpoints/{id} | **MISSING** | — | MEDIUM |
| UpdateIOSEndpoint | PATCH | /v2.0/IosEndpoints/{id} | **MISSING** | — | MEDIUM |
| DeleteIOSEndpoint | DELETE | /v2.0/IosEndpoints/{id} | **MISSING** | — | MEDIUM |
| GetIOSEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/IosEndpoints | **MISSING** | — | LOW |
| GetIOSEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/IosEndpoints | **MISSING** | — | LOW |
| GetIOSEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/IosEndpoints | **MISSING** | — | LOW |
| GetIOSEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/IosEndpoints | **MISSING** | — | LOW |
| StartIosEndpointEnrollment | POST | /v2.0/IosEndpoints/{id}/StartEnrollment | IMPLEMENTED | `start_ios_enrollment` | — |

#### Linux Endpoints

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetLinuxEndpoints | GET | /v2.0/LinuxEndpoints | IMPLEMENTED | `list_linux_endpoints` | — |
| CreateLinuxEndpoint | POST | /v2.0/LinuxEndpoints | IMPLEMENTED | `create_linux_endpoint` | — |
| GetLinuxEndpoint | GET | /v2.0/LinuxEndpoints/{id} | IMPLEMENTED | `get_linux_endpoint` | — |
| DeleteLinuxEndpoint | DELETE | /v2.0/LinuxEndpoints/{id} | IMPLEMENTED | `delete_linux_endpoint` | — |
| UpdateLinuxEndpoint | PATCH | /v2.0/LinuxEndpoints/{id} | IMPLEMENTED | `update_linux_endpoint` | — |
| GetLinuxEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/LinuxEndpoints | **MISSING** | — | LOW |
| GetLinuxEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/LinuxEndpoints | **MISSING** | — | MEDIUM |
| GetLinuxEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/LinuxEndpoints | **MISSING** | — | LOW |
| GetLinuxEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/LinuxEndpoints | **MISSING** | — | LOW |

#### Logical Groups

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetLogicalGroups | GET | /v2.0/LogicalGroups | IMPLEMENTED | `list_logical_groups` | — |
| CreateLogicalGroup | POST | /v2.0/LogicalGroups | IMPLEMENTED | `create_logical_group` | — |
| GetLogicalGroup | GET | /v2.0/LogicalGroups/{id} | IMPLEMENTED | `get_logical_group` | — |
| UpdateLogicalGroup | PATCH | /v2.0/LogicalGroups/{id} | IMPLEMENTED | `update_logical_group` | — |
| DeleteLogicalGroup | DELETE | /v2.0/LogicalGroups/{id} | IMPLEMENTED | `delete_logical_group` | — |
| GetLogicalGroupsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/LogicalGroups | **MISSING** | — | MEDIUM |
| GetMaintenanceWindowForLogicalGroupById | GET | /v2.0/LogicalGroups/{id}/MaintenanceWindow | **MISSING** | — | MEDIUM |
| CreateMaintenanceWindowForLogicalGroupById | POST | /v2.0/LogicalGroups/{id}/MaintenanceWindow | IMPLEMENTED | `create_maintenance_window_for_logical_group` | — |
| UpdateMaintenanceWindowForLogicalGroupById | PUT | /v2.0/LogicalGroups/{id}/MaintenanceWindow | IMPLEMENTED | `update_maintenance_window_for_logical_group` | — |
| DeleteMaintenanceWindowForLogicalGroupById | DELETE | /v2.0/LogicalGroups/{id}/MaintenanceWindow | IMPLEMENTED | `delete_maintenance_window_for_logical_group` | — |

#### Mac Endpoints

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetMacEndpoints | GET | /v2.0/MacEndpoints | IMPLEMENTED | `list_mac_endpoints` | — |
| CreateMacEndpoint | POST | /v2.0/MacEndpoints | IMPLEMENTED | `create_mac_endpoint` | — |
| GetMacEndpoint | GET | /v2.0/MacEndpoints/{id} | IMPLEMENTED | `get_mac_endpoint` | — |
| UpdateMacEndpoint | PATCH | /v2.0/MacEndpoints/{id} | IMPLEMENTED | `update_mac_endpoint` | — |
| DeleteMacEndpoint | DELETE | /v2.0/MacEndpoints/{id} | IMPLEMENTED | `delete_mac_endpoint` | — |
| GetMacEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/MacEndpoints | **MISSING** | — | MEDIUM |
| GetMacEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/MacEndpoints | **MISSING** | — | LOW |
| GetMacEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/MacEndpoints | **MISSING** | — | LOW |
| GetMacEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/MacEndpoints | **MISSING** | — | LOW |
| StartMacEndpointEnrollment | POST | /v2.0/MacEndpoints/{id}/StartEnrollment | IMPLEMENTED | `start_mac_enrollment` | — |

#### Network Endpoints

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetNetworkEndpoints | GET | /v2.0/NetworkEndpoints | **MISSING** | — | MEDIUM |
| CreateNetworkEndpoint | POST | /v2.0/NetworkEndpoints | IMPLEMENTED | `create_network_endpoint` | — |
| GetNetworkEndpoint | GET | /v2.0/NetworkEndpoints/{id} | **MISSING** | — | MEDIUM |
| DeleteNetworkEndpoint | DELETE | /v2.0/NetworkEndpoints/{id} | IMPLEMENTED | `delete_network_endpoint` | — |
| UpdateNetworkEndpoint | PATCH | /v2.0/NetworkEndpoints/{id} | IMPLEMENTED | `update_network_endpoint` | — |
| GetNetworkEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/NetworkEndpoints | **MISSING** | — | LOW |
| GetNetworkEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/NetworkEndpoints | **MISSING** | — | LOW |
| GetNetworkEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/NetworkEndpoints | **MISSING** | — | LOW |

#### Windows Endpoints

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetWindowsEndpoints | GET | /v2.0/WindowsEndpoints | IMPLEMENTED | `list_windows_endpoints` | — |
| CreateWindowsEndpoint | POST | /v2.0/WindowsEndpoints | IMPLEMENTED | `create_windows_endpoint` | — |
| GetWindowsEndpoint | GET | /v2.0/WindowsEndpoints/{id} | IMPLEMENTED | `get_windows_endpoint` | — |
| UpdateWindowsEndpoint | PATCH | /v2.0/WindowsEndpoints/{id} | IMPLEMENTED | `update_windows_endpoint` | — |
| DeleteWindowsEndpoint | DELETE | /v2.0/WindowsEndpoints/{id} | IMPLEMENTED | `delete_windows_endpoint` | — |
| StartWindowsEndpointEnrollment | POST | /v2.0/WindowsEndpoints/{id}/StartEnrollment | IMPLEMENTED | `start_windows_enrollment` | — |
| TriggerInstallationViaIntune | POST | /v2.0/WindowsEndpoints/{id}/TriggerInstallationViaIntune | IMPLEMENTED | `trigger_intune_installation` | — |
| GetWindowsEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/WindowsEndpoints | **MISSING** | — | MEDIUM |
| GetWindowsEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/WindowsEndpoints | IMPLEMENTED | `list_windows_endpoints_by_logical_group` | — |
| GetWindowsEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/WindowsEndpoints | **MISSING** | — | MEDIUM |
| GetWindowsEndpointsByDynamicGroupId | GET | /v2.0/DynamicGroups/{dynamicGroupId}/WindowsEndpoints | **MISSING** | — | MEDIUM |
| GetWindowsEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/WindowsEndpoints | **MISSING** | — | MEDIUM |

**Module coverage (Endpoints)**: 45/89 implemented (50.6%) | 44 missing

---

### Module: Jobs (`bConnect_Jobs.json`)

34 operationIds

#### Folders (Job Folders)

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetFolders | GET | /v2.0/Folders | **MISSING** | — | MEDIUM |
| CreateFolder | POST | /v2.0/Folders | IMPLEMENTED | `create_job_folder` | — |
| GetFolder | GET | /v2.0/Folders/{id} | **MISSING** | — | MEDIUM |
| UpdateFolder | PATCH | /v2.0/Folders/{id} | IMPLEMENTED | `update_job_folder` | — |
| DeleteFolder | DELETE | /v2.0/Folders/{id} | IMPLEMENTED | `delete_job_folder` | — |
| GetFoldersByFolderId | GET | /v2.0/Folders/{folderId}/Folders | **MISSING** | — | LOW |

> Note: `GetFolders`/`GetFolder`/`GetFoldersByFolderId` appear in both `bConnect_Jobs.json` and `bConnect_OperatingSystems.json`. The OS-context equivalents (`list_os_folders`, `get_os_folder`, `list_os_folders_by_parent`) are implemented but serve a different domain. For the Jobs domain specifically, list and get-by-id folder tools are missing.

#### Job Definitions

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetJobDefinitions | GET | /v2.0/JobDefinitions | IMPLEMENTED | `list_job_definitions` | — |
| GetJobDefinition | GET | /v2.0/JobDefinitions/{id} | IMPLEMENTED | `get_job_definition` | — |
| GetJobDefinitionsByFolderId | GET | /v2.0/Folders/{folderId}/JobDefinitions | IMPLEMENTED | `list_job_definitions_by_folder` | — |

#### Job Instances

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| CreateJobInstance | POST | /v2.0/JobInstances | IMPLEMENTED | `create_job_instance` | — |
| GetJobInstances | GET | /v2.0/JobInstances | IMPLEMENTED | `list_job_instances` | — |
| GetJobInstance | GET | /v2.0/JobInstances/{id} | IMPLEMENTED | `get_job_instance` | — |
| DeleteJobInstance | DELETE | /v2.0/JobInstances/{id} | IMPLEMENTED | `delete_job_instance` | — |
| StartJobInstance | POST | /v2.0/JobInstances/{id}/Start | IMPLEMENTED | `start_job_instance` | — |
| StopJobInstance | POST | /v2.0/JobInstances/{id}/Stop | IMPLEMENTED | `stop_job_instance` | — |
| ResumeJobInstance | POST | /v2.0/JobInstances/{id}/Resume | IMPLEMENTED | `resume_job_instance` | — |
| GetJobInstancesByJobDefinitionId | GET | /v2.0/JobDefinitions/{jobDefinitionId}/JobInstances | IMPLEMENTED | `list_job_instances_by_definition` | — |
| GetJobInstancesByEndpointId | GET | /v2.0/Endpoints/{endpointId}/JobInstances | IMPLEMENTED | `list_endpoint_job_instances` | — |
| GetJobInstancesByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/JobInstances | IMPLEMENTED | `list_job_instances_by_logical_group` | — |
| AssignJobDefinitionToLogicalGroup | POST | /v2.0/LogicalGroups/{logicalGroupId}/AssignJobDefinition | IMPLEMENTED | `assign_job_to_logical_group` | — |
| GetJobInstancesByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/JobInstances | **MISSING** | — | MEDIUM |
| AssignJobDefinitionToStaticGroup | POST | /v2.0/StaticGroups/{staticGroupId}/AssignJobDefinition | IMPLEMENTED | `assign_job_to_static_group` | — |
| GetJobInstancesByDynamicGroupId | GET | /v2.0/DynamicGroups/{dynamicGroupId}/JobInstances | **MISSING** | — | MEDIUM |
| AssignJobDefinitionToWindowsDynamicGroup | POST | /v2.0/DynamicGroups/{dynamicGroupId}/AssignJobDefinition | IMPLEMENTED | `assign_job_to_dynamic_group` | — |
| GetJobInstancesByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/JobInstances | **MISSING** | — | MEDIUM |
| AssignJobDefinitionToUniversalDynamicGroup | POST | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/AssignJobDefinition | IMPLEMENTED | `assign_job_to_universal_dynamic_group` | — |

#### Kiosk Releases

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetKioskReleases | GET | /v2.0/KioskReleases | IMPLEMENTED | `list_kiosk_releases` | — |
| CreateKioskRelease | POST | /v2.0/KioskReleases | IMPLEMENTED | `create_kiosk_release` | — |
| GetKioskRelease | GET | /v2.0/KioskReleases/{id} | IMPLEMENTED | `get_kiosk_release` | — |
| WithdrawKioskRelease | DELETE | /v2.0/KioskReleases/{id} | IMPLEMENTED | `withdraw_kiosk_release` | — |
| GetKioskReleasesByAdObjectId | GET | /v2.0/ADObjects/{adObjectId}/KioskReleases | **MISSING** | — | LOW |
| GetKioskReleasesByJobDefinitionId | GET | /v2.0/JobDefinitions/{jobDefinitionId}/KioskReleases | **MISSING** | — | LOW |
| GetKioskReleasesByEndpointId | GET | /v2.0/Endpoints/{endpointId}/KioskReleases | **MISSING** | — | LOW |
| GetKioskReleasesByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/KioskReleases | **MISSING** | — | LOW |

**Module coverage (Jobs)**: 24/34 implemented (70.6%) | 10 missing

---

### Module: OperatingSystems (`bConnect_OperatingSystems.json`)

9 operationIds (6 are duplicates of Jobs spec, 3 are duplicates of Endpoints spec)

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetFolders | GET | /v2.0/Folders | IMPLEMENTED | `list_os_folders` | — |
| CreateFolder | POST | /v2.0/Folders | IMPLEMENTED | `create_os_folder` | — |
| GetFolder | GET | /v2.0/Folders/{id} | IMPLEMENTED | `get_os_folder` | — |
| UpdateFolder | PATCH | /v2.0/Folders/{id} | IMPLEMENTED | `update_os_folder` | — |
| DeleteFolder | DELETE | /v2.0/Folders/{id} | IMPLEMENTED | `delete_os_folder` | — |
| GetFoldersByFolderId | GET | /v2.0/Folders/{folderId}/Folders | IMPLEMENTED | `list_os_folders_by_parent` | — |
| GetWindowsEndpoints | GET | /v2.0/WindowsEndpoints | IMPLEMENTED | `list_os_windows_endpoints` | — |
| GetWindowsEndpoint | GET | /v2.0/WindowsEndpoints/{id} | IMPLEMENTED | `get_os_windows_endpoint` | — |
| UpdateWindowsEndpoint | PATCH | /v2.0/WindowsEndpoints/{id} | IMPLEMENTED | `update_os_windows_endpoint` | — |

**Module coverage (OperatingSystems)**: 9/9 implemented (100%) | 0 missing

> Note: All 9 operationIds are shared with other specs. The OS module has dedicated domain-prefixed tools (`list_os_*`, `get_os_*`) that satisfy full coverage in the OS context.

---

### Module: ServerManagement (`bConnect_ServerManagement.json`)

25 operationIds

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetCloudConnectors | GET | /v2.0/CloudConnectors | IMPLEMENTED | `list_cloud_connectors` | — |
| GetDipStatus | GET | /v2.0/Dips | IMPLEMENTED | `get_dip_status` | — |
| GetGateway | GET | /v2.0/Gateway | IMPLEMENTED | `get_gateway` | — |
| GetManagementServer | GET | /v2.0/ManagementServer | IMPLEMENTED | `get_management_server` | — |
| RestartBaramundiManagementServer | POST | /v2.0/Restart | IMPLEMENTED | `restart_management_server` | — |
| CancelScheduledRestartBaramundiManagementServer | POST | /v2.0/CancelScheduledRestart | IMPLEMENTED | `cancel_scheduled_restart` | — |
| GetMicroservices | GET | /v2.0/Microservices | IMPLEMENTED | `list_microservices` | — |
| GetMicroservice | GET | /v2.0/Microservices/{id} | IMPLEMENTED | `get_microservice` | — |
| StartMicroservice | POST | /v2.0/Microservices/{id}/Start | IMPLEMENTED | `start_microservice` | — |
| StopMicroservice | POST | /v2.0/Microservices/{id}/Stop | IMPLEMENTED | `stop_microservice` | — |
| RestartMicroservice | POST | /v2.0/Microservices/{id}/Restart | IMPLEMENTED | `restart_microservice` | — |
| GetAccessRights | GET | /v2.0/Objects/{id}/Rights | IMPLEMENTED | `get_object_access_rights` | — |
| UpdateObjectPermission | PATCH | /v2.0/Objects/{id} | IMPLEMENTED | `update_object_permission` | — |
| GetPxeRelays | GET | /v2.0/PxeRelays | IMPLEMENTED | `list_pxe_relays` | — |
| GetSecurityGroups | GET | /v2.0/SecurityGroups | IMPLEMENTED | `list_security_groups` | — |
| CreateSecurityGroup | POST | /v2.0/SecurityGroups | IMPLEMENTED | `create_security_group` | — |
| GetSecurityGroup | GET | /v2.0/SecurityGroups/{id} | IMPLEMENTED | `get_security_group` | — |
| DeleteSecurityGroup | DELETE | /v2.0/SecurityGroups/{id} | IMPLEMENTED | `delete_security_group` | — |
| UpdateSecurityGroup | PATCH | /v2.0/SecurityGroups/{id} | IMPLEMENTED | `update_security_group` | — |
| GetSecurityProfiles | GET | /v2.0/SecurityProfiles | IMPLEMENTED | `list_security_profiles` | — |
| CreateSecurityProfile | POST | /v2.0/SecurityProfiles | IMPLEMENTED | `create_security_profile` | — |
| GetSecurityProfile | GET | /v2.0/SecurityProfiles/{id} | IMPLEMENTED | `get_security_profile` | — |
| DeleteSecurityProfile | DELETE | /v2.0/SecurityProfiles/{id} | IMPLEMENTED | `delete_security_profile` | — |
| UpdateSecurityProfile | PATCH | /v2.0/SecurityProfiles/{id} | IMPLEMENTED | `update_security_profile` | — |
| GetVpnAppliance | GET | /v2.0/VpnAppliance | IMPLEMENTED | `get_vpn_appliance` | — |

**Module coverage (ServerManagement)**: 25/25 implemented (100%) | 0 missing

---

### Module: Software (`bConnect_Software.json`)

4 operationIds

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetInstalledWindowsSoftware | GET | /v2.0/InstalledWindowsSoftware | IMPLEMENTED | `list_installed_windows_software` | — |
| GetInstalledWindowsSoftwareByEndpointId | GET | /v2.0/WindowsEndpoints/{endpointId}/InstalledWindowsSoftware | IMPLEMENTED | `list_installed_software_by_endpoint` | — |
| GetInstalledWindowsSoftwareByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/InstalledWindowsSoftware | IMPLEMENTED | `list_installed_software_by_logical_group` | — |
| GetInstalledWindowsSoftwareByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/InstalledWindowsSoftware | IMPLEMENTED | `list_installed_software_by_universal_dynamic_group` | — |

**Module coverage (Software)**: 4/4 implemented (100%) | 0 missing

---

### Module: UpdateManagement (`bConnect_UpdateManagement.json`)

3 operationIds (all duplicates of Endpoints spec — UpdateManagement-context views)

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetWindowsEndpoints | GET | /v2.0/WindowsEndpoints | IMPLEMENTED | `list_update_management_windows_endpoints` | — |
| GetWindowsEndpoint | GET | /v2.0/WindowsEndpoints/{id} | IMPLEMENTED | `get_update_management_windows_endpoint` | — |
| UpdateWindowsEndpoint | PATCH | /v2.0/WindowsEndpoints/{id} | IMPLEMENTED | `update_update_management_windows_endpoint` | — |

**Module coverage (UpdateManagement)**: 3/3 implemented (100%) | 0 missing

---

### Module: Variables (`bConnect_Variables.json`)

13 operationIds

| operationId | HTTP | Path | Status | Registered Tool | IT Admin Value |
|-------------|------|------|--------|-----------------|----------------|
| GetVariableDefinitions | GET | /v2.0/VariableDefinitions | IMPLEMENTED | `list_variable_definitions` | — |
| CreateVariableDefinition | POST | /v2.0/VariableDefinitions | IMPLEMENTED | `create_variable_definition` | — |
| GetVariableDefinitionById | GET | /v2.0/VariableDefinitions/{id} | IMPLEMENTED | `get_variable_definition` | — |
| UpdateVariableDefinition | PATCH | /v2.0/VariableDefinitions/{id} | IMPLEMENTED | `update_variable_definition` | — |
| DeleteVariableDefinition | DELETE | /v2.0/VariableDefinitions/{id} | IMPLEMENTED | `delete_variable_definition` | — |
| GetVariableInstances | GET | /v2.0/VariableInstances | IMPLEMENTED | `list_variable_instances` | — |
| GetVariableInstanceById | GET | /v2.0/VariableInstances/{id} | IMPLEMENTED | `get_variable_instance` | — |
| UpdateVariableInstance | PATCH | /v2.0/VariableInstances/{id} | IMPLEMENTED | `update_variable_instance` | — |
| GetVariableInstancesByEndpointId | GET | /v2.0/Endpoints/{endpointId}/VariableInstances | IMPLEMENTED | `list_variables_by_endpoint` | — |
| GetVariableInstancesByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/VariableInstances | IMPLEMENTED | `list_variables_by_logical_group` | — |
| GetVariableInstancesByADObjectId | GET | /v2.0/ADObjects/{adObjectId}/VariableInstances | IMPLEMENTED | `list_variables_by_ad_object` | — |
| GetVariableInstancesByWindowsJobDefinitonId | GET | /v2.0/WindowsJobDefinitions/{windowsJobDefinitionId}/VariableInstances | IMPLEMENTED | `list_variables_by_windows_job` | — |
| GetVariableInstancesByWindowsApplicationId | GET | /v2.0/WindowsApplications/{windowsApplicationId}/VariableInstances | IMPLEMENTED | `list_variables_by_windows_application` | — |

**Module coverage (Variables)**: 13/13 implemented (100%) | 0 missing

---

## Summary by Module

| Module | Spec File | Total Ops | Implemented | Missing | Coverage |
|--------|-----------|-----------|-------------|---------|----------|
| ActiveDirectory | bConnect_ActiveDirectory.json | 16 | 11 | 5 | 68.8% |
| Assets | bConnect_Assets.json | 24 | 19 | 5 | 79.2% |
| DefenseControl | bConnect_DefenseControl.json | 11 | 11 | 0 | **100%** |
| Endpoints | bConnect_Endpoints.json | 89 | 45 | 44 | 50.6% |
| Jobs | bConnect_Jobs.json | 34 | 24 | 10 | 70.6% |
| OperatingSystems | bConnect_OperatingSystems.json | 9 | 9 | 0 | **100%** |
| ServerManagement | bConnect_ServerManagement.json | 25 | 25 | 0 | **100%** |
| Software | bConnect_Software.json | 4 | 4 | 0 | **100%** |
| UpdateManagement | bConnect_UpdateManagement.json | 3 | 3 | 0 | **100%** |
| Variables | bConnect_Variables.json | 13 | 13 | 0 | **100%** |
| **TOTAL** | | **228** | **164** | **64** | **71.9%** |

> Note: Row totals exceed 216 unique operationIds because `GetFolders`, `GetWindowsEndpoints`, and `UpdateWindowsEndpoint` appear in multiple spec files. The summary above counts per-spec occurrences; the unique-operationId count is 216 with approximately 152 implemented (70.4%).
>
> **STATUS.md metric**: 121/163 tools implemented (74.2%). This figure counts unique v2.0 tools registered in `src/index.ts` against the 163 total endpoints documented in STATUS.md.

---

## Complete List of Truly Missing Endpoints

The following operationIds have no semantically equivalent tool registered in `src/index.ts`:

### ActiveDirectory (5 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 1 | GetADGroupsByADGroupId | GET | /v2.0/ADGroups/{adGroupId}/ADGroups | MEDIUM | Nested AD group traversal — useful for group hierarchy analysis |
| 2 | GetADObjectsByADGroupId | GET | /v2.0/ADGroups/{adGroupId}/ADObjects | MEDIUM | List all AD objects in a group |
| 3 | GetADObjectsByOrgUnitId | GET | /v2.0/OrgUnits/{orgUnitId}/ADObjects | LOW | Filter AD objects by org unit |
| 4 | GetADUsersByOrgUnitId | GET | /v2.0/OrgUnits/{orgUnitId}/ADUsers | LOW | Filter users by org unit |
| 5 | GetOrgUnitsByOrgUnitId | GET | /v2.0/OrgUnits/{orgUnitId}/OrgUnits | LOW | Traverse org unit tree |

### Assets (5 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 7 | GetAssetStockFolder | GET | /v2.0/AssetStock/Folders/{id} | LOW | Get specific asset stock folder details |
| 8 | GetAssetStockFoldersByParentId | GET | /v2.0/AssetStock/Folders/{folderId}/Folders | LOW | Navigate asset stock folder hierarchy |
| 9 | GetAssetTypeFolders | GET | /v2.0/AssetTypes/Folders | LOW | List all asset type folders |
| 10 | GetAssetTypeFolder | GET | /v2.0/AssetTypes/Folders/{id} | LOW | Get specific asset type folder |
| 11 | GetAssetTypeFoldersByParentId | GET | /v2.0/AssetTypes/Folders/{folderId}/Folders | LOW | Navigate asset type folder hierarchy |

### Endpoints — Android (6 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 12 | GetAndroidEndpoints | GET | /v2.0/AndroidEndpoints | MEDIUM | List all Android/Enterprise devices |
| 13 | GetAndroidEndpoint | GET | /v2.0/AndroidEndpoints/{id} | MEDIUM | Inspect a specific Android device |
| 14 | GetAndroidEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/AndroidEndpoints | LOW | Filter Android endpoints by logical group |
| 15 | GetAndroidEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/AndroidEndpoints | LOW | Filter Android endpoints by static group |
| 16 | GetAndroidEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/AndroidEndpoints | LOW | List Android devices owned by a user |
| 17 | GetAndroidEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/AndroidEndpoints | LOW | Filter Android endpoints by dynamic group |

### Endpoints — Generic (5 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 18 | GetEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/Endpoints | MEDIUM | All endpoints owned by a specific user |
| 19 | GetEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/Endpoints | MEDIUM | List endpoints in a static group |
| 20 | GetEndpointsByDynamicGroupId | GET | /v2.0/DynamicGroups/{dynamicGroupId}/Endpoints | MEDIUM | List endpoints in a Windows dynamic group |
| 21 | GetEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/Endpoints | MEDIUM | List endpoints in a universal dynamic group |
| 22 | GetMaintenanceWindowForEndpointById | GET | /v2.0/Endpoints/{id}/MaintenanceWindow | MEDIUM | Read maintenance window — needed alongside create/update/delete |

### Endpoints — Industrial (5 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 25 | GetIndustrialEndpoints | GET | /v2.0/IndustrialEndpoints | MEDIUM | List all OT/industrial endpoints |
| 26 | GetIndustrialEndpoint | GET | /v2.0/IndustrialEndpoints/{id} | MEDIUM | Inspect a specific industrial endpoint |
| 27 | GetIndustrialEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/IndustrialEndpoints | LOW | Filter industrial endpoints by group |
| 28 | GetIndustrialEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/IndustrialEndpoints | LOW | Filter industrial endpoints by static group |
| 29 | GetIndustrialEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/IndustrialEndpoints | LOW | Filter industrial endpoints by dynamic group |

### Endpoints — iOS (9 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 23 | GetIOSEndpoints | GET | /v2.0/IosEndpoints | MEDIUM | List all iOS/iPadOS devices |
| 24 | CreateIOSEndpoint | POST | /v2.0/IosEndpoints | MEDIUM | Register a new iOS device |
| 25 | GetIOSEndpoint | GET | /v2.0/IosEndpoints/{id} | MEDIUM | Inspect a specific iOS device |
| 26 | UpdateIOSEndpoint | PATCH | /v2.0/IosEndpoints/{id} | MEDIUM | Modify iOS endpoint properties |
| 27 | DeleteIOSEndpoint | DELETE | /v2.0/IosEndpoints/{id} | MEDIUM | Remove an iOS endpoint |
| 28 | GetIOSEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/IosEndpoints | LOW | Filter iOS endpoints by logical group |
| 29 | GetIOSEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/IosEndpoints | LOW | Filter iOS endpoints by static group |
| 30 | GetIOSEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/IosEndpoints | LOW | List iOS devices owned by a user |
| 31 | GetIOSEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/IosEndpoints | LOW | Filter iOS endpoints by dynamic group |

### Endpoints — Linux (4 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 32 | GetLinuxEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/LinuxEndpoints | LOW | Linux endpoints by user |
| 33 | GetLinuxEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/LinuxEndpoints | MEDIUM | Linux endpoints by logical group |
| 34 | GetLinuxEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/LinuxEndpoints | LOW | Linux endpoints by static group |
| 35 | GetLinuxEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/LinuxEndpoints | LOW | Linux endpoints by dynamic group |

### Endpoints — Logical Groups (2 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 36 | GetLogicalGroupsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/LogicalGroups | MEDIUM | Navigate logical group hierarchy |
| 37 | GetMaintenanceWindowForLogicalGroupById | GET | /v2.0/LogicalGroups/{id}/MaintenanceWindow | MEDIUM | Read maintenance window for a logical group |

### Endpoints — Mac (4 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 38 | GetMacEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/MacEndpoints | MEDIUM | Mac endpoints by logical group |
| 39 | GetMacEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/MacEndpoints | LOW | Mac endpoints by static group |
| 40 | GetMacEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/MacEndpoints | LOW | Mac endpoints by user |
| 41 | GetMacEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/MacEndpoints | LOW | Mac endpoints by dynamic group |

### Endpoints — Network (5 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 42 | GetNetworkEndpoints | GET | /v2.0/NetworkEndpoints | MEDIUM | List all network devices (switches, routers, printers) |
| 43 | GetNetworkEndpoint | GET | /v2.0/NetworkEndpoints/{id} | MEDIUM | Inspect a specific network device |
| 44 | GetNetworkEndpointsByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/NetworkEndpoints | LOW | Network endpoints by logical group |
| 45 | GetNetworkEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/NetworkEndpoints | LOW | Network endpoints by static group |
| 46 | GetNetworkEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/NetworkEndpoints | LOW | Network endpoints by dynamic group |

### Endpoints — Windows (4 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 47 | GetWindowsEndpointsByADObjectId | GET | /v2.0/ADUsers/{adUserId}/WindowsEndpoints | MEDIUM | Windows devices owned by a user |
| 48 | GetWindowsEndpointsByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/WindowsEndpoints | MEDIUM | Windows endpoints by static group |
| 49 | GetWindowsEndpointsByDynamicGroupId | GET | /v2.0/DynamicGroups/{dynamicGroupId}/WindowsEndpoints | MEDIUM | Windows endpoints by dynamic group |
| 50 | GetWindowsEndpointsByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/WindowsEndpoints | MEDIUM | Windows endpoints by universal dynamic group |

### Jobs — Folders (3 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 51 | GetFolders (Jobs context) | GET | /v2.0/Folders | MEDIUM | List job/software folders — needed for folder navigation |
| 52 | GetFolder (Jobs context) | GET | /v2.0/Folders/{id} | MEDIUM | Get specific job folder by ID |
| 53 | GetFoldersByFolderId (Jobs context) | GET | /v2.0/Folders/{folderId}/Folders | LOW | Navigate folder hierarchy within jobs |

### Jobs — Job Definitions & Instances (2 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 54 | GetJobInstancesByStaticGroupId | GET | /v2.0/StaticGroups/{staticGroupId}/JobInstances | MEDIUM | Track job executions across a static group |
| 55 | GetJobInstancesByDynamicGroupId | GET | /v2.0/DynamicGroups/{dynamicGroupId}/JobInstances | MEDIUM | Track job executions across a dynamic group |
| 56 | GetJobInstancesByUniversalDynamicGroupId | GET | /v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/JobInstances | MEDIUM | Track job executions across a universal dynamic group |

### Jobs — Kiosk Releases (4 missing)

| # | operationId | HTTP | Path | IT Admin Value | Rationale |
|---|-------------|------|------|----------------|-----------|
| 57 | GetKioskReleasesByAdObjectId | GET | /v2.0/ADObjects/{adObjectId}/KioskReleases | LOW | Kiosk releases available to a specific AD object |
| 58 | GetKioskReleasesByJobDefinitionId | GET | /v2.0/JobDefinitions/{jobDefinitionId}/KioskReleases | LOW | Which kiosk releases use a given job definition |
| 59 | GetKioskReleasesByEndpointId | GET | /v2.0/Endpoints/{endpointId}/KioskReleases | LOW | Kiosk releases applicable to a specific endpoint |
| 60 | GetKioskReleasesByLogicalGroupId | GET | /v2.0/LogicalGroups/{logicalGroupId}/KioskReleases | LOW | Kiosk releases for a logical group |

---

## Phase 4 — 10 Tools Implemented (2026-03-27)

All 10 previously top-priority missing tools have been implemented:

| # | operationId | Module | HTTP | Tool Name | Value |
|---|-------------|--------|------|-----------|-------|
| 1 | GetWindowsEndpointsByLogicalGroupId | Endpoints | GET | `list_windows_endpoints_by_logical_group` | HIGH |
| 2 | GetEndpointsByLogicalGroupId | Endpoints | GET | `list_endpoints_by_logical_group` | HIGH |
| 3 | GetJobInstancesByJobDefinitionId | Jobs | GET | `list_job_instances_by_definition` | HIGH |
| 4 | GetJobInstancesByLogicalGroupId | Jobs | GET | `list_job_instances_by_logical_group` | HIGH |
| 5 | GetJobDefinitionsByFolderId | Jobs | GET | `list_job_definitions_by_folder` | HIGH |
| 6 | GetLinuxEndpoint | Endpoints | GET | `get_linux_endpoint` | HIGH |
| 7 | GetMacEndpoint | Endpoints | GET | `get_mac_endpoint` | HIGH |
| 8 | StartAndroidEndpointEnrollment | Endpoints | POST | `start_android_enrollment` | HIGH |
| 9 | StartIosEndpointEnrollment | Endpoints | POST | `start_ios_enrollment` | HIGH |
| 10 | GetADObjectMemberships | ActiveDirectory | GET | `get_ad_object_memberships` | MEDIUM |

## Priority-Ordered Next 10 Missing Tools to Implement

Ranked by IT admin value — remaining gaps after Phase 4:

| Rank | operationId | Module | HTTP | Suggested Tool Name | Value | Justification |
|------|-------------|--------|------|---------------------|-------|---------------|
| 1 | GetAndroidEndpoints | Endpoints | GET | `list_android_endpoints` | MEDIUM | List all managed Android devices — basic inventory currently missing |
| 2 | GetAndroidEndpoint | Endpoints | GET | `get_android_endpoint` | MEDIUM | Single-item read for Android — asymmetric CRUD |
| 3 | GetIOSEndpoints | Endpoints | GET | `list_ios_endpoints` | MEDIUM | List all iOS/iPadOS devices |
| 4 | GetIOSEndpoint | Endpoints | GET | `get_ios_endpoint` | MEDIUM | Single-item read for iOS |
| 5 | GetIndustrialEndpoints | Endpoints | GET | `list_industrial_endpoints` | MEDIUM | List OT/industrial endpoints |
| 6 | GetIndustrialEndpoint | Endpoints | GET | `get_industrial_endpoint` | MEDIUM | Single-item read for industrial endpoints |
| 7 | GetNetworkEndpoints | Endpoints | GET | `list_network_endpoints` | MEDIUM | List network devices (switches, routers, printers) |
| 8 | GetNetworkEndpoint | Endpoints | GET | `get_network_endpoint` | MEDIUM | Single-item read for network devices |
| 9 | GetLinuxEndpointsByLogicalGroupId | Endpoints | GET | `list_linux_endpoints_by_logical_group` | MEDIUM | Linux endpoints by group — completes cross-platform group queries |
| 10 | GetWindowsEndpointsByStaticGroupId | Endpoints | GET | `list_windows_endpoints_by_static_group` | MEDIUM | Windows endpoints by static group |

---

## Naming Convention Gap Analysis

The strict `operationId → snake_case` conversion used by the coverage test accounts for 32.9% coverage. The actual semantic coverage is 71.3% (as of 2026-03-27) because `src/index.ts` uses alternative naming patterns:

| Pattern | operationId example | Test expects | Actual tool name |
|---------|---------------------|--------------|------------------|
| `list_` prefix for collections | `GetADGroups` | `get_ad_groups` | `list_ad_groups` |
| Shortened names | `GetMicrosoftDefenderThreats` | `get_microsoft_defender_threats` | `list_defender_threats` |
| Domain prefix stripped | `RestartBaramundiManagementServer` | `restart_baramundi_management_server` | `restart_management_server` |
| Context prefix added | `GetWindowsEndpoints` (OS context) | `get_windows_endpoints` | `list_os_windows_endpoints` |
| Suffix stripped | `GetBitLockerStatesByWindowsEndpointId` | `get_bit_locker_states_by_windows_endpoint_id` | `get_bitlocker_windows_endpoint` |
| Semantic rename | `CancelScheduledRestartBaramundiManagementServer` | `cancel_scheduled_restart_baramundi_management_server` | `cancel_scheduled_restart` |

---

## Tools Outside the 10 OpenAPI Specs (v1 modules and search)

These tools are registered in `src/index.ts` but backed by v1 API modules or external search systems with no `openapi-specs/*.json` source file. They are not counted in the 216 total:

| Module | Example tools | Notes |
|--------|--------------|-------|
| `bitlocker-v1` | `get_bitlocker_pins_v1`, `get_bitlocker_recovery_keys_v1`, `get_tpm_owner_passwords_v1`, `get_secret_by_volume_v1` | v1 BitLocker API — recovery key retrieval |
| `complianceviolations-v1` | `list_compliance_violations_v1`, `get_compliance_violation_v1`, `list_compliance_violations_by_endpoint_v1` | v1 compliance API |
| `ssh-v1` | `get_endpoint_ssh_info_v1`, `get_endpoint_secrets_v1` | v1 SSH certificate management |
| `setup-integrity-v1` | `get_agent_setup_integrity_v1`, `get_bfcrx_integrity_v1` | v1 setup integrity checks |
| `inventory-v1` | `get_inventory_hardware_scans_v1`, `get_inventory_wmi_scans_v1`, etc. | v1 inventory scans |
| `vpp-v1` | `list_vpp_users_v1`, `get_vpp_user_v1`, `assign_vpp_license_v1`, etc. | Apple VPP license management |
| `documentation-search` | `search_documentation`, `list_documentation_sources`, `get_documentation_item` | baramundi doc search (external) |
| `forum-search` | `get_popular_topics` | Community forum search |
| `known-issues-search` | `search_known_issues`, `get_known_issues_summary` | Known issues search |
| Generic search | `search_endpoints` | Cross-type endpoint search |
