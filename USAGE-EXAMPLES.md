# bConnect MCP Server - Usage Examples

**Complete guide for all 94 V2.0 MCP tools across 10 API modules**

## Table of Contents

**V2.0 API Modules:**
1. [Getting Started](#getting-started)
2. [Endpoints API (10 tools)](#endpoints-api-10-tools)
3. [Jobs API (5 tools)](#jobs-api-5-tools)
4. [Assets API (13 tools)](#assets-api-13-tools)
5. [Active Directory API (16 tools)](#active-directory-api-16-tools)
6. [Software API (4 tools)](#software-api-4-tools)
7. [Update Management API (2 tools)](#update-management-api-2-tools)
8. [Defense Control API (10 tools)](#defense-control-api-10-tools)
9. [Variables API (9 tools)](#variables-api-9-tools)
10. [Operating Systems API (5 tools)](#operating-systems-api-5-tools)
11. [Server Management API (13 tools)](#server-management-api-13-tools)

**Documentation Search:**
12. [Documentation Search (6 tools)](#documentation-search-6-tools)

**Additional:**
19. [Common Patterns](#common-patterns)

---

## Getting Started

The bConnect MCP Server is already configured. Simply ask Claude natural language questions:

```
"List all Windows endpoints"
"Show me job execution history"
"What assets do we have?"
"List all AD groups"
```

Claude will automatically use the appropriate MCP tools to answer your questions.

---

## Endpoints API (10 tools)

### 1. `list_endpoints` - List all managed endpoints

**Natural Language:**
```
"Show me all endpoints"
"List all managed devices"
"How many endpoints do we have?"
```

**Parameters:**
- `OrderBy` (optional): Sort order (e.g., "DisplayName asc")
- `SearchQuery` (optional): Search across name, IP, serial number
- `DisplayName` (optional): Filter by exact display name
- `Page` (optional): Page number (zero-indexed)
- `PageSize` (optional): Items per page (default: 20, max: 1000)

**Example:**
```
"List the first 50 endpoints sorted by name"
"Search for endpoints containing 'WIN'"
"Show me endpoints on page 2 with 100 items per page"
```

### 2. `get_endpoint` - Get specific endpoint details

**Natural Language:**
```
"Show me details for endpoint <ID>"
"Get information about endpoint bms-win22srv"
"What's the status of endpoint <ID>?"
```

**Parameters:**
- `id` (required): Endpoint GUID

**Example:**
```
"Show details for endpoint 98cdf559-1733-42b4-ae1f-42eabf7f9281"
```

### 3. `search_endpoints` - Search endpoints

**Natural Language:**
```
"Search for endpoints with 'BMS' in the name"
"Find all endpoints with IP 192.168"
"Search for serial number ABC123"
```

**Parameters:**
- `query` (required): Search string
- `pageSize` (optional): Number of results (default: 50)

**Example:**
```
"Search for endpoints matching 'Windows' and show 100 results"
```

### 4. `list_windows_endpoints` - List Windows endpoints

**Natural Language:**
```
"List all Windows endpoints"
"Show me Windows machines"
"How many Windows devices do we have?"
```

**Parameters:**
- Same as `list_endpoints`

**Example:**
```
"List Windows endpoints sorted by last seen date"
```

### 5. `get_windows_endpoint` - Get Windows endpoint details

**Natural Language:**
```
"Show me details for Windows endpoint <ID>"
"Get full info about Windows machine <ID>"
```

**Parameters:**
- `id` (required): Windows endpoint GUID

### 6. `list_logical_groups` - List all logical groups

**Natural Language:**
```
"List all logical groups"
"Show me endpoint groups"
"What groups exist?"
```

**Example:**
```
"List all logical groups"
```

### 7. `get_logical_group` - Get logical group details

**Natural Language:**
```
"Show me details for group <ID>"
"Get information about logical group <ID>"
```

**Parameters:**
- `id` (required): Logical group GUID

### 8. `list_group_endpoints` - List endpoints in a group

**Natural Language:**
```
"Show me all endpoints in group <ID>"
"List devices in logical group <ID>"
"What endpoints belong to group <ID>?"
```

**Parameters:**
- `logicalGroupId` (required): Logical group GUID
- `PageSize` (optional): Items per page

**Example:**
```
"List all endpoints in group abc123 with 50 items per page"
```

### 9. `list_linux_endpoints` - List Linux endpoints

**Natural Language:**
```
"List all Linux endpoints"
"Show me Linux machines"
```

**Parameters:**
- Same as `list_endpoints`

### 10. `list_mac_endpoints` - List Mac endpoints

**Natural Language:**
```
"List all Mac endpoints"
"Show me Apple devices"
```

**Parameters:**
- Same as `list_endpoints`

---

## Jobs API (5 tools)

### 1. `list_job_definitions` - List all job definitions

**Natural Language:**
```
"List all job definitions"
"Show me available jobs"
"What jobs can I run?"
```

**Parameters:**
- `OrderBy` (optional): Sort order
- `Page` (optional): Page number
- `PageSize` (optional): Items per page
- `SearchQuery` (optional): Search query

**Example:**
```
"List job definitions sorted by name"
"Search for jobs containing 'Windows Update'"
```

### 2. `get_job_definition` - Get job definition details

**Natural Language:**
```
"Show me details for job <ID>"
"Get information about job definition <ID>"
```

**Parameters:**
- `id` (required): Job definition GUID

### 3. `list_job_instances` - List job execution history

**Natural Language:**
```
"Show me job execution history"
"List all job instances"
"What jobs have run?"
```

**Parameters:**
- Same as `list_job_definitions`

**Example:**
```
"Show me the last 50 job executions"
```

### 4. `get_job_instance` - Get job instance details

**Natural Language:**
```
"Show me details for job instance <ID>"
"Get execution details for job <ID>"
"Did job <ID> succeed?"
```

**Parameters:**
- `id` (required): Job instance GUID

### 5. `list_endpoint_job_instances` - List jobs for an endpoint

**Natural Language:**
```
"Show me all jobs for endpoint <ID>"
"What jobs have run on endpoint <ID>?"
"List job history for device <ID>"
```

**Parameters:**
- `endpointId` (required): Endpoint GUID
- `Page` (optional): Page number
- `PageSize` (optional): Items per page

**Example:**
```
"Show me the last 20 jobs for endpoint abc123"
```

---

## Assets API (13 tools)

### 1. `list_assets` - List all assets

**Natural Language:**
```
"List all assets"
"Show me asset inventory"
"What hardware do we have?"
```

**Parameters:**
- `OrderBy`, `Page`, `PageSize`, `SearchQuery` (optional)

**Example:**
```
"List assets sorted by name"
"Search for assets containing 'Laptop'"
```

### 2. `get_asset` - Get asset details

**Natural Language:**
```
"Show me details for asset <ID>"
"Get asset information for <ID>"
```

**Parameters:**
- `id` (required): Asset GUID

### 3. `list_asset_types` - List all asset types

**Natural Language:**
```
"List all asset types"
"What types of assets do we track?"
```

**Parameters:**
- `PageSize`, `SearchQuery`, `ShowSummary` (optional)

### 4. `get_asset_type` - Get asset type details

**Natural Language:**
```
"Show me details for asset type <ID>"
```

**Parameters:**
- `id` (required): Asset type GUID

### 5. `list_assets_by_logical_group` - List assets for a group

**Natural Language:**
```
"Show me assets for group <ID>"
"What assets are in logical group <ID>?"
```

**Parameters:**
- `logicalGroupId` (required): Logical group GUID
- `PageSize` (optional)

### 6. `list_assets_by_endpoint` - List assets for an endpoint

**Natural Language:**
```
"Show me assets for endpoint <ID>"
"What hardware is assigned to endpoint <ID>?"
```

**Parameters:**
- `endpointId` (required): Endpoint GUID
- `PageSize` (optional)

### 7. `list_asset_stock_assets` - List unassigned assets

**Natural Language:**
```
"List all unassigned assets"
"Show me assets in stock"
"What assets are available?"
```

**Parameters:**
- `PageSize`, `SearchQuery` (optional)

### 8. `list_asset_stock_folders` - List asset stock folders

**Natural Language:**
```
"List all asset stock folders"
"Show me stock organization"
```

**Parameters:**
- `PageSize`, `SearchQuery` (optional)

### 9-13. Additional asset tools (similar patterns)

---

## Active Directory API (16 tools)

### 1. `list_ad_groups` - List AD groups

**Natural Language:**
```
"List all AD groups"
"Show me Active Directory groups"
```

**Parameters:**
- `OrderBy`, `Page`, `PageSize`, `SearchQuery` (optional)

**Example:**
```
"Search for AD groups containing 'Admin'"
```

### 2. `get_ad_group` - Get AD group details

**Natural Language:**
```
"Show me details for AD group <ID>"
```

**Parameters:**
- `id` (required): AD Group GUID

### 3. `list_ad_users` - List AD users

**Natural Language:**
```
"List all AD users"
"Show me Active Directory users"
```

**Parameters:**
- `OrderBy`, `Page`, `PageSize`, `SearchQuery` (optional)

**Example:**
```
"List AD users sorted by name"
```

### 4. `get_ad_user` - Get AD user details

**Natural Language:**
```
"Show me details for AD user <ID>"
```

**Parameters:**
- `id` (required): AD User GUID

### 5. `list_ad_objects` - List AD objects

**Natural Language:**
```
"List all AD objects"
```

**Parameters:**
- `OrderBy`, `Page`, `PageSize`, `SearchQuery` (optional)

### 6. `get_ad_object` - Get AD object details

**Natural Language:**
```
"Show me details for AD object <ID>"
```

**Parameters:**
- `id` (required): AD Object GUID

### 7. `list_org_units` - List organizational units

**Natural Language:**
```
"List all organizational units"
"Show me AD OUs"
```

**Parameters:**
- `OrderBy`, `Page`, `PageSize`, `SearchQuery` (optional)

### 8. `get_org_unit` - Get OU details

**Natural Language:**
```
"Show me details for OU <ID>"
```

**Parameters:**
- `id` (required): OU GUID

### 9. `list_ad_users_by_group` - List users in AD group

**Natural Language:**
```
"Show me all users in AD group <ID>"
"List members of group <ID>"
```

**Parameters:**
- `adGroupId` (required): AD Group GUID
- `PageSize`, `SearchQuery` (optional)

### 10. `list_ad_groups_by_org_unit` - List groups in OU

**Natural Language:**
```
"Show me all groups in OU <ID>"
```

**Parameters:**
- `orgUnitId` (required): OU GUID
- `PageSize`, `SearchQuery` (optional)

### 11-16. Additional AD tools (similar patterns)

---

## Software API (4 tools)

### 1. `list_installed_windows_software` - List all installed software

**Natural Language:**
```
"List all installed Windows software"
"Show me software inventory"
"What applications are installed?"
```

**Parameters:**
- `OrderBy`, `Page`, `PageSize`, `SearchQuery` (optional)

**Example:**
```
"Search for installed software containing 'Office'"
```

### 2. `list_installed_software_by_endpoint` - List software on endpoint

**Natural Language:**
```
"Show me software installed on endpoint <ID>"
"What applications are on device <ID>?"
```

**Parameters:**
- `endpointId` (required): Endpoint GUID
- `PageSize`, `SearchQuery` (optional)

### 3. `list_installed_software_by_logical_group` - List software for group

**Natural Language:**
```
"Show me software for group <ID>"
```

**Parameters:**
- `logicalGroupId` (required): Logical group GUID
- `PageSize`, `SearchQuery` (optional)

### 4. `list_installed_software_by_universal_dynamic_group` - List software for dynamic group

**Natural Language:**
```
"Show me software for universal dynamic group <ID>"
```

**Parameters:**
- `universalDynamicGroupId` (required): Group GUID
- `PageSize`, `SearchQuery` (optional)

---

## Update Management API (2 tools)

### 1. `list_update_management_windows_endpoints` - List Windows update status

**Natural Language:**
```
"Show me Windows update status"
"List endpoints with update information"
"What's the patch status?"
```

**Parameters:**
- `OrderBy`, `Page`, `PageSize`, `SearchQuery` (optional)

**Example:**
```
"Show me endpoints needing updates"
```

### 2. `get_update_management_windows_endpoint` - Get update details for endpoint

**Natural Language:**
```
"Show me update status for endpoint <ID>"
"What updates are pending on device <ID>?"
```

**Parameters:**
- `id` (required): Windows endpoint GUID

---

## Defense Control API (10 tools)

### 1. `list_bitlocker_windows_endpoints` - List BitLocker status

**Natural Language:**
```
"Show me BitLocker encryption status"
"List endpoints with BitLocker"
"What devices are encrypted?"
```

**Parameters:**
- `OrderBy`, `Page`, `PageSize`, `SearchQuery` (optional)

### 2. `get_bitlocker_windows_endpoint` - Get BitLocker details

**Natural Language:**
```
"Show me BitLocker status for endpoint <ID>"
"Is device <ID> encrypted?"
```

**Parameters:**
- `id` (required): Windows endpoint GUID

### 3. `get_local_admin_accounts` - Get local admin accounts

**Natural Language:**
```
"Show me local admin accounts for endpoint <ID>"
"What admin accounts exist on device <ID>?"
```

**Parameters:**
- `id` (required): Windows endpoint GUID

### 4. `trigger_local_admin_accounts_update` - Trigger admin account update

**Natural Language:**
```
"Update local admin accounts for endpoint <ID>"
"Refresh admin account information for device <ID>"
```

**Parameters:**
- `id` (required): Windows endpoint GUID

### 5. `list_defender_threats` - List all detected threats

**Natural Language:**
```
"Show me all detected threats"
"List Microsoft Defender threats"
"What malware has been detected?"
```

**Parameters:**
- `Page`, `PageSize`, `SearchQuery` (optional)

### 6. `get_defender_threat` - Get threat details

**Natural Language:**
```
"Show me details for threat <ID>"
```

**Parameters:**
- `id` (required): Threat GUID

### 7. `list_defender_threats_by_endpoint` - List threats for endpoint

**Natural Language:**
```
"Show me threats detected on endpoint <ID>"
"What malware was found on device <ID>?"
```

**Parameters:**
- `endpointId` (required): Endpoint GUID
- `PageSize`, `SearchQuery` (optional)

### 8. `list_defender_threats_by_logical_group` - List threats for group

**Natural Language:**
```
"Show me threats for group <ID>"
```

**Parameters:**
- `logicalGroupId` (required): Logical group GUID
- `PageSize`, `SearchQuery` (optional)

### 9. `list_defender_windows_endpoints` - List Defender status

**Natural Language:**
```
"Show me Microsoft Defender status"
"List antivirus status for all endpoints"
```

**Parameters:**
- `Page`, `PageSize`, `SearchQuery` (optional)

### 10. `get_defender_windows_endpoint` - Get Defender details

**Natural Language:**
```
"Show me Defender status for endpoint <ID>"
```

**Parameters:**
- `id` (required): Windows endpoint GUID

---

## Variables API (9 tools)

### 1. `list_variable_definitions` - List all variable definitions

**Natural Language:**
```
"List all variable definitions"
"Show me available variables"
"What variables can I use?"
```

**Parameters:**
- `PageSize`, `SearchQuery` (optional)

### 2. `get_variable_definition` - Get variable definition details

**Natural Language:**
```
"Show me details for variable <ID>"
```

**Parameters:**
- `id` (required): Variable definition GUID

### 3. `list_variable_instances` - List all variable instances

**Natural Language:**
```
"List all variable instances"
"Show me variable values"
```

**Parameters:**
- `PageSize`, `SearchQuery` (optional)

### 4. `get_variable_instance` - Get variable instance details

**Natural Language:**
```
"Show me details for variable instance <ID>"
```

**Parameters:**
- `id` (required): Variable instance GUID

### 5. `list_variables_by_endpoint` - List variables for endpoint

**Natural Language:**
```
"Show me variables for endpoint <ID>"
"What variables are set on device <ID>?"
```

**Parameters:**
- `endpointId` (required): Endpoint GUID
- `PageSize` (optional)

### 6. `list_variables_by_logical_group` - List variables for group

**Natural Language:**
```
"Show me variables for group <ID>"
```

**Parameters:**
- `logicalGroupId` (required): Logical group GUID
- `PageSize` (optional)

### 7. `list_variables_by_ad_object` - List variables for AD object

**Natural Language:**
```
"Show me variables for AD object <ID>"
```

**Parameters:**
- `adObjectId` (required): AD Object GUID
- `PageSize` (optional)

### 8. `list_variables_by_windows_application` - List variables for application

**Natural Language:**
```
"Show me variables for Windows application <ID>"
```

**Parameters:**
- `windowsApplicationId` (required): Application GUID
- `PageSize` (optional)

### 9. `list_variables_by_windows_job` - List variables for job

**Natural Language:**
```
"Show me variables for job <ID>"
```

**Parameters:**
- `windowsJobDefinitionId` (required): Job definition GUID
- `PageSize` (optional)

---

## Operating Systems API (5 tools)

### 1. `list_os_folders` - List OS folders

**Natural Language:**
```
"List all OS folders"
"Show me operating system organization"
```

**Parameters:**
- `PageSize`, `SearchQuery` (optional)

### 2. `get_os_folder` - Get OS folder details

**Natural Language:**
```
"Show me details for OS folder <ID>"
```

**Parameters:**
- `id` (required): OS folder GUID

### 3. `list_os_folders_by_parent` - List OS folders within parent

**Natural Language:**
```
"Show me OS folders in parent <ID>"
```

**Parameters:**
- `folderId` (required): Parent folder GUID
- `PageSize` (optional)

### 4. `list_os_windows_endpoints` - List Windows endpoints with OS info

**Natural Language:**
```
"Show me Windows endpoints with OS information"
"List OS deployment status"
```

**Parameters:**
- `PageSize`, `SearchQuery` (optional)

### 5. `get_os_windows_endpoint` - Get OS info for endpoint

**Natural Language:**
```
"Show me OS information for endpoint <ID>"
"What OS is installed on device <ID>?"
```

**Parameters:**
- `id` (required): Windows endpoint GUID

---

## Server Management API (13 tools)

### 1. `get_management_server` - Get management server info

**Natural Language:**
```
"Show me management server information"
"Get baramundi server details"
"What's the server status?"
```

### 2. `get_gateway` - Get gateway info

**Natural Language:**
```
"Show me gateway information"
```

### 3. `get_dip_status` - Get DIP status

**Natural Language:**
```
"Show me DIP status"
"Get Distributed Installation Point information"
```

### 4. `get_vpn_appliance` - Get VPN appliance info

**Natural Language:**
```
"Show me VPN appliance information"
```

### 5. `list_microservices` - List all microservices

**Natural Language:**
```
"List all microservices"
"Show me baramundi services"
```

### 6. `get_microservice` - Get microservice details

**Natural Language:**
```
"Show me details for microservice <ID>"
```

**Parameters:**
- `id` (required): Microservice GUID

### 7. `list_cloud_connectors` - List cloud connectors

**Natural Language:**
```
"List all cloud connectors"
```

### 8. `list_pxe_relays` - List PXE relays

**Natural Language:**
```
"List all PXE relays"
"Show me boot relay servers"
```

### 9. `list_security_groups` - List security groups

**Natural Language:**
```
"List all security groups"
```

**Parameters:**
- `PageSize`, `SearchQuery` (optional)

### 10. `get_security_group` - Get security group details

**Natural Language:**
```
"Show me details for security group <ID>"
```

**Parameters:**
- `id` (required): Security group GUID

### 11. `list_security_profiles` - List security profiles

**Natural Language:**
```
"List all security profiles"
```

**Parameters:**
- `PageSize`, `SearchQuery` (optional)

### 12. `get_security_profile` - Get security profile details

**Natural Language:**
```
"Show me details for security profile <ID>"
```

**Parameters:**
- `id` (required): Security profile GUID

### 13. `get_object_access_rights` - Get access rights for object

**Natural Language:**
```
"Show me access rights for object <ID>"
"What permissions exist for object <ID>?"
```

**Parameters:**
- `objectId` (required): Object GUID

---

## Documentation Search (6 tools)

Search across **15,408+ baramundi documentation items** including forum threads, release notes, knowledge base articles, known issues, and preview documents.

### 1. `search_documentation` - Full-text search across all documentation

**Natural Language:**
```
"Search documentation for 'BitLocker recovery'"
"Find forum threads about bConnect API"
"Search for deployment automation tutorials"
"Look up information about job scheduling"
```

**Parameters:**
- `query` (required): Search terms (supports multi-word queries)
- `source` (optional): Filter by source ('forum', 'feedback', 'release-notes', 'preview', 'website', 'known-issues')
- `type` (optional): Document type ('thread', 'faq', 'kb', 'idea', 'release-note', 'preview-doc', 'known-issue')
- `category` (optional): Filter by category (e.g., 'job-management', 'baramundi-connect')
- `limit` (optional): Maximum results to return (default: 10, max: 100)

**Examples:**
```
"Search for 'Windows 11 compatibility' in all documentation"
"Find forum threads about 'patch management'"
"Search release notes for 'new features in 2025'"
"Look up known issues related to 'BitLocker'"
"Search the knowledge base for 'troubleshooting network issues'"
```

**Response includes:**
- Relevance score (higher = better match)
- Document title and excerpt
- Source and category
- Direct URL to full document
- Coverage statistics (documents searched per source)

**Use Cases:**
- Find solutions to technical problems
- Discover best practices and tutorials
- Research new features before deployment
- Check known issues before troubleshooting
- Learn from community discussions

---

### 2. `get_documentation_item` - Get full content of a specific document

**Natural Language:**
```
"Show me the full content of document <ID>"
"Get complete details for forum thread <ID>"
"Display the entire knowledge base article <ID>"
```

**Parameters:**
- `id` (required): Document ID (e.g., 'forum-job-management-14037')

**Example:**
```
"Show me the full content of forum-job-management-14037"
"Get the complete release notes document release-notes-2025R1-EN"
```

**Response includes:**
- Full document content (complete text)
- Metadata (author, date, replies, votes, solved status)
- Source information
- Direct URL

**Use Cases:**
- Read complete forum discussions
- Review full release notes
- Study detailed knowledge base articles
- Examine known issue descriptions
- Access full preview document content

---

### 3. `list_documentation_sources` - Show coverage statistics

**Natural Language:**
```
"What documentation sources are available?"
"Show me documentation coverage statistics"
"How many forum threads are indexed?"
"List all documentation categories"
```

**No parameters required**

**Response includes:**
- **Forum:** 13,065 threads across 33 categories
- **Feedback Portal:** ~1,500 items (FAQ, KB, Ideas)
- **Release Notes:** 26 versions
- **Preview Documents:** 4 PDFs (2024-2025 releases)
- **Website:** ~457 pages
- **Known Issues:** ~356 technical issues
- **Total:** 15,408+ searchable documents

**Use Cases:**
- Understand documentation coverage
- Check which sources are available
- Plan documentation searches
- Verify indexing completeness

---

### 4. `get_popular_topics` - Get most discussed topics

**Natural Language:**
```
"What are the most popular topics in the forum?"
"Show me trending topics in documentation"
"What topics get discussed most frequently?"
"List top keywords from the knowledge base"
```

**Parameters:**
- `source` (optional): Filter by source ('forum', 'feedback', 'release-notes', 'website', 'known-issues')
- `limit` (optional): Number of topics to return (default: 10)

**Examples:**
```
"Show me the top 10 forum topics"
"What are the most common keywords in known issues?"
"List popular topics from the knowledge base"
```

**Response includes:**
- Topic/keyword name
- Document count (how many docs mention it)
- Source (where the topic appears)

**Use Cases:**
- Identify trending issues
- Discover common use cases
- Find frequently discussed features
- Understand community interests
- Plan documentation improvements

---

### 5. `search_known_issues` - Search technical known issues database

**Natural Language:**
```
"Search known issues for 'Windows Update'"
"Find known issues about 'deployment failures'"
"Look up problems with 'bConnect API'"
"Check known issues for 'performance'"
```

**Parameters:**
- `query` (required): Search terms
- `limit` (optional): Maximum results (default: 10)

**Examples:**
```
"Search known issues for BitLocker recovery problems"
"Find known issues related to SCCM integration"
"Look up issues with job execution timeouts"
```

**Response includes:**
- Issue title and description
- Affected versions
- Workarounds or solutions
- Related forum discussions
- Issue status

**Use Cases:**
- Check if a problem is already known before troubleshooting
- Find workarounds for issues
- Verify bug fixes in new releases
- Research compatibility problems
- Plan upgrade strategy

---

### 6. `get_known_issues_summary` - Get known issues coverage summary

**Natural Language:**
```
"Show me known issues statistics"
"How many known issues are documented?"
"Give me a summary of known issues"
```

**No parameters required**

**Response includes:**
- Total known issues count (~356 issues)
- Issues by category
- Coverage statistics
- Most recent issues
- Issue distribution

**Use Cases:**
- Understand issue landscape
- Plan troubleshooting approach
- Assess product stability
- Track issue resolution over time

---

### Documentation Search Tips

**Effective Searching:**
1. **Use specific terms**: "BitLocker recovery key" is better than "BitLocker"
2. **Try multiple phrasings**: If one search doesn't work, rephrase your query
3. **Filter by source**: Narrow results to forum/kb/release-notes for faster answers
4. **Check known issues first**: Save time by checking if your problem is documented
5. **Read full documents**: Use `get_documentation_item` to see complete context

**Search Workflow:**
```
1. Start broad: "Search for 'deployment'"
2. Review results and refine
3. Filter by source: "Search forum for 'deployment automation'"
4. Get details: "Show me full content of forum-job-management-12345"
5. Find related: "What are popular topics about deployment?"
```

**Coverage by Source:**
- **Forum** (13,065 threads): Best for community solutions, real-world problems
- **Knowledge Base** (~283 articles): Official documentation, how-to guides
- **Release Notes** (26 versions): New features, breaking changes, bug fixes
- **Known Issues** (~356 issues): Known bugs, workarounds, compatibility
- **Preview Documents** (4 PDFs): Upcoming features, future roadmap
- **Website** (~457 pages): Product information, marketing, overviews

**Performance:**
- Index size: 15,408+ documents
- Search speed: <100ms typical
- Full-text search with fuzzy matching
- Automatic relevance ranking

---

## Common Patterns

### Pagination

All list operations support pagination:

```
"List endpoints with 100 items per page"
"Show me page 2 of the job definitions"
"Get the first 50 assets"
```

### Searching

Most list operations support searching:

```
"Search for endpoints containing 'Windows'"
"Find jobs with 'Update' in the name"
"Search for assets matching 'Laptop'"
```

### Sorting

Many list operations support sorting:

```
"List endpoints sorted by name"
"Show me jobs ordered by last run date"
"Sort assets by purchase date"
```

### Combining Parameters

You can combine multiple parameters:

```
"Search for Windows endpoints containing 'BMS', sorted by name, with 50 items per page"
"Find all threats in the last week, sorted by severity, showing 100 results"
```

### Getting Details

Always use GUIDs to get specific details:

```
"Show me full details for endpoint 98cdf559-1733-42b4-ae1f-42eabf7f9281"
"Get complete information about job abc123-def456"
```

### Error Handling

The MCP server includes automatic retry logic:
- Network errors: Automatic retry with exponential backoff
- Rate limits (429): Automatic retry
- Server errors (5xx): Automatic retry
- Client errors (4xx): No retry (fix your request)

Configure retry behavior in `.env`:
```env
BCONNECT_MAX_RETRIES=3
BCONNECT_RETRY_DELAY=100
```

---

## Tips for Best Results

1. **Be specific**: Include relevant filters and limits
2. **Use natural language**: Claude understands your intent
3. **Combine tools**: Claude can chain multiple tools to answer complex questions
4. **Check GUIDs**: Most detail operations require exact GUIDs
5. **Use pagination**: Large datasets are automatically paginated

---

**Total: 94 V2.0 MCP Tools** across 10 API modules, all ready to use with natural language.

**V2.0 APIs:** 10 modules (Endpoints, Jobs, Assets, Active Directory, Software, Update Management, Defense Control, Variables, Operating Systems, Server Management)
