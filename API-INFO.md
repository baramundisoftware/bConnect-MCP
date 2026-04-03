# bConnect API Information

## API Endpoint

```
Base URL: https://bms-win22srv:444/bconnect
Documentation: https://bms-win22srv:444/bconnect/docs/
```

## Authentication

**Method:** HTTP Basic Auth
```bash
Username: Administrator
Password: baramundi-2008
```

## Complete API Module Overview

**V2.0 API:** 10 Modules | 163 Endpoints | 246 Operations
**Total Implemented:** 10/10 V2.0 Modules (100%) | 94 MCP Tools

| Module | Endpoints | GET | POST | PATCH | DELETE | Status |
|--------|-----------|-----|------|-------|--------|--------|
| **Endpoints** | 58 | 53 | 15 | 8 | 11 | ✅ Implemented |
| **Jobs** | 27 | 20 | 10 | 1 | 3 | ✅ Implemented |
| **Assets** | 13 | 13 | 4 | 3 | 4 | ✅ Implemented |
| **Active Directory** | 16 | 16 | 0 | 0 | 0 | ✅ Implemented |
| **Server Management** | 19 | 13 | 7 | 3 | 2 | ✅ Implemented |
| **Defense Control** | 10 | 9 | 1 | 1 | 0 | ✅ Implemented |
| **Variables** | 9 | 9 | 1 | 2 | 1 | ✅ Implemented |
| **Operating Systems** | 5 | 5 | 1 | 2 | 1 | ✅ Implemented |
| **Software** | 4 | 4 | 0 | 0 | 0 | ✅ Implemented |
| **Update Management** | 2 | 2 | 0 | 1 | 0 | ✅ Implemented |

---

## 1. Endpoints API ✅ (Implemented)

Manage Windows, Linux, Mac, Android, iOS, Industrial, and Network endpoints.

```
OpenAPI Spec: https://bms-win22srv:444/bconnect/endpoints/openAPI/v2.0/bConnect_Endpoints.json
Base Path: /endpoints/v2.0/
Version: 2.0
Endpoints: 58 | Operations: GET=53, POST=15, PATCH=8, DELETE=11
```

**Key Features:**
- Windows/Linux/Mac/Android/iOS/Industrial/Network endpoint management
- Logical Groups, Static Groups, Dynamic Groups, Universal Dynamic Groups
- Endpoint CRUD operations (Create, Read, Update, Delete)
- Maintenance Windows management
- Agent deployment and configuration

**Example:**
```bash
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/WindowsEndpoints?PageSize=10"
```

---

## 2. Jobs API ✅ (Implemented)

Job and deployment management for software, updates, and configurations.

```
OpenAPI Spec: https://bms-win22srv:444/bconnect/jobs/openAPI/v2.0/bConnect_Jobs.json
Base Path: /jobs/v2.0/
Version: 2.0
Endpoints: 27 | Operations: GET=20, POST=10, PATCH=1, DELETE=3
```

**Key Features:**
- Job Definitions (create, read, update, delete)
- Job Instances (execution history and status)
- Job Folders (organization)
- Kiosk Releases (self-service deployments)
- Assign jobs to endpoints, groups, or AD objects
- Start, stop, resume job executions

**Example:**
```bash
# List all job definitions
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/jobs/v2.0/JobDefinitions"

# Get job instances for specific endpoint
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/jobs/v2.0/Endpoints/{endpointId}/JobInstances"
```

---

## 3. Assets API ✅ (Implemented)

Hardware and software asset management.

```
OpenAPI Spec: https://bms-win22srv:444/bconnect/assets/openAPI/v2.0/bConnect_Assets.json
Base Path: /assets/v2.0/
Version: 2.0
Endpoints: 13 | Operations: GET=13, POST=4, PATCH=3, DELETE=4
```

**Key Features:**
- Asset inventory (create, read, update, delete)
- Asset Types and Type Folders
- Asset Stock management
- Asset Folders (organization)
- Link assets to endpoints

**Example:**
```bash
# List all assets
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/assets/v2.0/Assets"

# Get assets by endpoint
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/assets/v2.0/Endpoints/{endpointId}/Assets"
```

---

## 4. Active Directory API ✅ (Implemented)

Integration with Active Directory for user and computer management.

```
OpenAPI Spec: https://bms-win22srv:444/bconnect/activedirectory/openAPI/v2.0/bConnect_ActiveDirectory.json
Base Path: /activedirectory/v2.0/
Version: 2.0
Endpoints: 16 | Operations: GET=16 (Read-only)
```

**Key Features:**
- AD Groups (list, get details, subgroups, members)
- AD Users (list, get details, group memberships)
- AD Objects (list, get details, memberships)
- Organizational Units (list, get details, child OUs, members)
- Read-only access (no AD modifications via API)

**Example:**
```bash
# List AD groups
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/activedirectory/v2.0/Groups"

# Get AD user details
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/activedirectory/v2.0/Users/{userId}"
```

---

## 5. Server Management API ✅ (Implemented)

Manage baramundi Management Server configuration and monitoring.

```
OpenAPI Spec: https://bms-win22srv:444/bconnect/servermanagement/openAPI/v2.0/bConnect_ServerManagement.json
Base Path: /servermanagement/v2.0/
Version: 2.0
Endpoints: 19 | Operations: GET=13, POST=7, PATCH=3, DELETE=2
```

**Key Features:**
- Server configuration and settings
- Network scan profiles
- Distributed Installation Points (DIPs)
- Server health monitoring
- License management
- Background tasks monitoring

**Example:**
```bash
# Get server information
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/servermanagement/v2.0/ServerInformation"

# List network scan profiles
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/servermanagement/v2.0/NetworkScanProfiles"
```

---

## 6. Defense Control API ✅ (Implemented)

Application and device control policies for security.

```
OpenAPI Spec: https://bms-win22srv:444/bconnect/defensecontrol/openAPI/v2.0/bConnect_DefenseControl.json
Base Path: /defensecontrol/v2.0/
Version: 2.0
Endpoints: 10 | Operations: GET=9, POST=1, PATCH=1, DELETE=0
```

**Key Features:**
- Application Control policies (whitelist/blacklist)
- Device Control policies (USB, removable media)
- Security policy management
- Compliance monitoring

**Example:**
```bash
# List application control policies
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/defensecontrol/v2.0/ApplicationControlPolicies"
```

---

## 7. Variables API ✅ (Implemented)

Custom variables for dynamic configurations and automation.

```
OpenAPI Spec: https://bms-win22srv:444/bconnect/variables/openAPI/v2.0/bConnect_Variables.json
Base Path: /variables/v2.0/
Version: 2.0
Endpoints: 9 | Operations: GET=9, POST=1, PATCH=2, DELETE=1
```

**Key Features:**
- Global, group-level, and endpoint-level variables
- Variable templates
- Dynamic variable resolution
- Variable inheritance and overrides

**Example:**
```bash
# List all variables
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/variables/v2.0/Variables"

# Get variables for endpoint
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/variables/v2.0/Endpoints/{endpointId}/Variables"
```

---

## 8. Operating Systems API ✅ (Implemented)

OS deployment, imaging, and migration management.

```
OpenAPI Spec: https://bms-win22srv:444/bconnect/operatingsystems/openAPI/v2.0/bConnect_OperatingSystems.json
Base Path: /operatingsystems/v2.0/
Version: 2.0
Endpoints: 5 | Operations: GET=5, POST=1, PATCH=2, DELETE=1
```

**Key Features:**
- OS inventory and versions
- OS deployment and imaging
- PXE boot configuration
- OS migration planning

**Example:**
```bash
# List supported operating systems
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/operatingsystems/v2.0/OperatingSystems"
```

---

## 9. Software API ✅ (Implemented)

Software inventory and package management.

```
OpenAPI Spec: https://bms-win22srv:444/bconnect/software/openAPI/v2.0/bConnect_Software.json
Base Path: /software/v2.0/
Version: 2.0
Endpoints: 4 | Operations: GET=4 (Read-only)
```

**Key Features:**
- Software inventory
- Installed software tracking
- Software catalog
- License compliance (read-only)

**Example:**
```bash
# Get software inventory
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/software/v2.0/Software"
```

---

## 10. Update Management API ✅ (Implemented)

Windows Update and patch management.

```
OpenAPI Spec: https://bms-win22srv:444/bconnect/updatemanagement/openAPI/v2.0/bConnect_UpdateManagement.json
Base Path: /updatemanagement/v2.0/
Version: 2.0
Endpoints: 2 | Operations: GET=2, PATCH=1
```

**Key Features:**
- Windows Update inventory
- Patch compliance reporting
- Update approval workflows
- Patch baseline management

**Example:**
```bash
# Get update information
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/updatemanagement/v2.0/Updates"
```

---

## SSL Certificate

Development mode bypasses SSL verification:
```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
```

For production, add the baramundi certificate to your trust store.

---

## Quick Test - All Modules

```bash
# Test Endpoints API
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=5"

# Test Jobs API
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/jobs/v2.0/JobDefinitions?PageSize=5"

# Test Assets API
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/assets/v2.0/Assets?PageSize=5"

# Test Active Directory API
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/activedirectory/v2.0/Groups?PageSize=5"
```

---

## Resources

- **API Documentation**: https://bms-win22srv:444/bconnect/docs/
- **baramundi Support**: https://www.baramundi.com/en/support/
- **All OpenAPI Specs**: Available at `/bconnect/{module}/openAPI/v2.0/bConnect_{Module}.json`

---

## Implementation Status

### ✅ ALL V2.0 MODULES IMPLEMENTED

**V2.0 API Modules (10):**
- **Endpoints API** - 10 MCP tools
- **Jobs API** - 5 MCP tools
- **Assets API** - 13 MCP tools
- **Active Directory API** - 16 MCP tools
- **Software API** - 4 MCP tools
- **Update Management API** - 2 MCP tools
- **Defense Control API** - 10 MCP tools
- **Variables API** - 9 MCP tools
- **Operating Systems API** - 5 MCP tools
- **Server Management API** - 13 MCP tools

### 📊 Coverage
- **V2.0 Modules**: 10/10 (100%)
- **Endpoints**: 111/163 V2.0 (68%)
- **MCP Tools**: 94 total
  - V2.0: 48 read + 46 write
- **Test Coverage**: 86.35%
- **Tests**: 510 total (494 passing, 16 skipped)
