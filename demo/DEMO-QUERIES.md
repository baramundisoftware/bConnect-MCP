# Demo Queries - List Endpoints MCP Tool

**Purpose:** Copy-paste ready queries for live demonstrations
**Tool:** `list_endpoints` (and related endpoint tools)
**Duration:** 3-5 minutes per demo section

---

## Quick Reference

| Query | Expected Result | Duration |
|-------|----------------|----------|
| List all endpoints | All devices shown | 30s |
| Search by name | Filtered results | 20s |
| Filter by OS | Platform-specific list | 20s |
| Paginate results | First N items | 30s |
| Sort by field | Ordered list | 20s |
| Complex query | Multi-criteria filter | 45s |

---

## Section 1: Basic Listing (30 seconds)

### Query 1.1: Simple List
```
List all endpoints managed by baramundi
```

**What Claude Does:**
- Uses `mcp__bconnect__list_endpoints` tool
- No parameters (default: all endpoints)

**Expected Output:**
```
I'll retrieve all endpoints from baramundi Management Suite.

[Using MCP tool: list_endpoints]

Total Endpoints: 8

1. **bms-win22srv**
   - Operating System: Windows Server 2022
   - Type: WindowsEndpoint
   - IP Address: 192.168.1.100
   - Last Seen: 2025-10-20 12:30:15
   - Status: Online

2. **WIN-CLIENT-001**
   - Operating System: Windows 11 Enterprise
   - Type: WindowsEndpoint
   - IP Address: 192.168.1.101
   - Last Seen: 2025-10-20 12:25:03
   - Status: Online

3. **LINUX-SERVER-001**
   - Operating System: Ubuntu 22.04 LTS
   - Type: LinuxEndpoint
   - IP Address: 192.168.1.102
   - Last Seen: 2025-10-20 11:45:22
   - Status: Online

4. **MAC-LAPTOP-001**
   - Operating System: macOS 14.0 Sonoma
   - Type: MacEndpoint
   - IP Address: 192.168.1.103
   - Last Seen: 2025-10-20 10:15:44
   - Status: Online

[... continues for all 8 endpoints ...]
```

**Key Points to Highlight:**
- Total count displayed
- Mix of Windows, Linux, Mac
- Real-time status from baramundi
- No coding required

---

## Section 2: Filtered Searches (45 seconds)

### Query 2.1: Search by Name
```
Show me all Windows endpoints with "WIN" in the name
```

**What Claude Does:**
- Uses `list_endpoints` with SearchQuery parameter
- Claude interprets "with WIN in name" → SearchQuery: "WIN"

**Expected Output:**
```
I'll search for endpoints with "WIN" in the name.

[Using MCP tool: list_endpoints]
[Parameters: SearchQuery="WIN"]

Found 2 matching endpoints:

1. **WIN-CLIENT-001**
   - Operating System: Windows 11 Enterprise
   - Last Seen: 2025-10-20 12:25:03

2. **WIN-CLIENT-002**
   - Operating System: Windows 10 Pro
   - Last Seen: 2025-10-19 16:42:11
```

**Key Points:**
- Natural language → API parameters
- Precise filtering
- Fast search across all fields

---

### Query 2.2: Filter by Operating System Type
```
List all Linux endpoints
```

**What Claude Does:**
- Uses specialized `list_linux_endpoints` tool
- Automatically selects correct tool

**Expected Output:**
```
I'll retrieve all Linux endpoints.

[Using MCP tool: list_linux_endpoints]

Linux Endpoints (2 total):

1. **LINUX-SERVER-001**
   - Operating System: Ubuntu 22.04 LTS
   - IP: 192.168.1.102
   - Last Seen: 2025-10-20 11:45:22

2. **LINUX-WORKSTATION-001**
   - Operating System: Fedora 39
   - IP: 192.168.1.105
   - Last Seen: 2025-10-20 09:30:15
```

**Alternative Queries:**
```
Show me all Windows endpoints
Show me all Mac endpoints
List all Android devices
```

**Key Points:**
- Platform-specific tools available
- Claude chooses optimal tool
- Consistent output format

---

## Section 3: Pagination & Sorting (45 seconds)

### Query 3.1: Paginated Results
```
Show me the first 5 endpoints sorted by name
```

**What Claude Does:**
- Uses `list_endpoints`
- Parameters: PageSize=5, OrderBy="DisplayName asc"

**Expected Output:**
```
I'll retrieve the first 5 endpoints sorted alphabetically by name.

[Using MCP tool: list_endpoints]
[Parameters: PageSize=5, OrderBy="DisplayName asc"]

Showing 1-5 of 8 total endpoints:

1. **ANDROID-TABLET-001** (Android)
2. **bms-win22srv** (Windows Server 2022)
3. **IOS-IPHONE-001** (iOS)
4. **LINUX-SERVER-001** (Ubuntu 22.04)
5. **MAC-LAPTOP-001** (macOS 14.0)

To see more, ask for the next page (endpoints 6-8).
```

**Key Points:**
- Pagination for large environments
- Automatic page calculation
- Clear navigation hints

---

### Query 3.2: Specific Page
```
Show me endpoints 6-10
```

**What Claude Does:**
- Calculates: Page=1 (zero-indexed), PageSize=5

**Expected Output:**
```
I'll show you endpoints 6-10.

[Using MCP tool: list_endpoints]
[Parameters: Page=1, PageSize=5]

Showing 6-8 of 8 total endpoints:

6. **WIN-CLIENT-001** (Windows 11)
7. **WIN-CLIENT-002** (Windows 10)
8. **LINUX-WORKSTATION-001** (Fedora 39)

You've reached the end of the list (8 total endpoints).
```

---

### Query 3.3: Sort by Last Seen
```
List endpoints sorted by last seen date, newest first
```

**What Claude Does:**
- Parameters: OrderBy="LastSeen desc"

**Expected Output:**
```
I'll sort endpoints by most recently seen.

[Using MCP tool: list_endpoints]
[Parameters: OrderBy="LastSeen desc"]

Endpoints by Last Contact (8 total):

1. **bms-win22srv** - Last seen: 2 minutes ago (2025-10-20 12:30:15)
2. **WIN-CLIENT-001** - Last seen: 7 minutes ago (2025-10-20 12:25:03)
3. **LINUX-SERVER-001** - Last seen: 47 minutes ago (2025-10-20 11:45:22)
4. **MAC-LAPTOP-001** - Last seen: 2 hours ago (2025-10-20 10:15:44)
5. **IOS-IPHONE-001** - Last seen: 3 hours ago (2025-10-20 09:12:33)
6. **WIN-CLIENT-002** - Last seen: 20 hours ago (2025-10-19 16:42:11)
7. **ANDROID-TABLET-001** - Last seen: 2 days ago (2025-10-18 14:22:05)
8. **LINUX-WORKSTATION-001** - Last seen: 3 days ago (2025-10-17 09:30:15)
```

**Key Points:**
- Identifies stale/offline systems
- Relative time display
- Useful for monitoring

---

## Section 4: Complex Queries (60 seconds)

### Query 4.1: Multi-Criteria Search
```
Find all Windows endpoints that haven't been seen in the last 24 hours
```

**What Claude Does:**
- Interprets time-based criteria
- Filters post-retrieval or uses SearchQuery
- Calculates time delta

**Expected Output:**
```
I'll find Windows endpoints offline for more than 24 hours.

[Using MCP tool: list_windows_endpoints]

Analyzing last contact times...

Found 1 Windows endpoint not seen in 24+ hours:

1. **WIN-CLIENT-002**
   - Operating System: Windows 10 Pro
   - Last Seen: 20 hours ago (2025-10-19 16:42:11)
   - Status: ⚠️ Potentially offline
   - IP Address: 192.168.1.106

Recommendation: Check if this system is powered off or disconnected.
```

**Key Points:**
- Time-based filtering
- Smart interpretation
- Actionable recommendations

---

### Query 4.2: Server Identification
```
Show me all servers (endpoints with "SERVER" in the name)
```

**What Claude Does:**
- SearchQuery: "SERVER"
- Filters by naming convention

**Expected Output:**
```
I'll search for endpoints with "SERVER" in the name.

[Using MCP tool: list_endpoints]
[Parameters: SearchQuery="SERVER"]

Found 2 server endpoints:

1. **bms-win22srv**
   - Type: Windows Server 2022
   - Role: Baramundi Management Server
   - IP: 192.168.1.100
   - Status: Online (last seen 2 minutes ago)

2. **LINUX-SERVER-001**
   - Type: Ubuntu 22.04 LTS Server
   - Role: Application Server
   - IP: 192.168.1.102
   - Status: Online (last seen 47 minutes ago)
```

---

### Query 4.3: Network Segment Filter
```
List all endpoints with IP addresses starting with "192.168.1"
```

**What Claude Does:**
- Uses SearchQuery or filters results
- IP-based filtering

**Expected Output:**
```
I'll find all endpoints on the 192.168.1.x network.

[Using MCP tool: list_endpoints]

Analyzing network configuration...

Found 8 endpoints on 192.168.1.x:

1. bms-win22srv - 192.168.1.100
2. WIN-CLIENT-001 - 192.168.1.101
3. LINUX-SERVER-001 - 192.168.1.102
4. MAC-LAPTOP-001 - 192.168.1.103
5. IOS-IPHONE-001 - 192.168.1.104
6. LINUX-WORKSTATION-001 - 192.168.1.105
7. WIN-CLIENT-002 - 192.168.1.106
8. ANDROID-TABLET-001 - 192.168.1.107

All endpoints are on the same subnet (192.168.1.0/24).
```

---

## Section 5: Real-World Scenarios (60 seconds)

### Scenario 5.1: Deployment Planning
```
List all Windows endpoints and tell me how many there are
```

**Expected Output:**
```
I'll retrieve all Windows endpoints and provide a count.

[Using MCP tool: list_windows_endpoints]

Windows Endpoint Summary:

Total Windows Endpoints: 3

Breakdown by Operating System:
- Windows Server 2022: 1 (bms-win22srv)
- Windows 11 Enterprise: 1 (WIN-CLIENT-001)
- Windows 10 Pro: 1 (WIN-CLIENT-002)

All endpoints are ready for software deployment or patch management.
```

**Use Case:** Planning software rollout

---

### Scenario 5.2: Asset Inventory Audit
```
Show me all endpoints grouped by operating system
```

**Expected Output:**
```
I'll organize all endpoints by operating system.

[Using MCP tool: list_endpoints]

Endpoints by Operating System (8 total):

**Windows (3 endpoints):**
- bms-win22srv (Windows Server 2022)
- WIN-CLIENT-001 (Windows 11 Enterprise)
- WIN-CLIENT-002 (Windows 10 Pro)

**Linux (2 endpoints):**
- LINUX-SERVER-001 (Ubuntu 22.04 LTS)
- LINUX-WORKSTATION-001 (Fedora 39)

**macOS (1 endpoint):**
- MAC-LAPTOP-001 (macOS 14.0 Sonoma)

**Mobile (2 endpoints):**
- ANDROID-TABLET-001 (Android)
- IOS-IPHONE-001 (iOS)

Platform Distribution:
- Windows: 37.5%
- Linux: 25%
- macOS: 12.5%
- Mobile: 25%
```

**Use Case:** License compliance, budget planning

---

### Scenario 5.3: Health Check
```
Which endpoints are currently online?
```

**Expected Output:**
```
I'll check the status of all endpoints based on last contact time.

[Using MCP tool: list_endpoints]
[Parameters: OrderBy="LastSeen desc"]

Endpoint Health Status:

✅ **Online (6 endpoints)** - Seen in last hour:
1. bms-win22srv (2 minutes ago)
2. WIN-CLIENT-001 (7 minutes ago)
3. LINUX-SERVER-001 (47 minutes ago)

⚠️ **Recently Active (2 endpoints)** - Seen 1-24 hours ago:
4. MAC-LAPTOP-001 (2 hours ago)
5. IOS-IPHONE-001 (3 hours ago)
6. WIN-CLIENT-002 (20 hours ago)

❌ **Offline (2 endpoints)** - Not seen > 24 hours:
7. ANDROID-TABLET-001 (2 days ago)
8. LINUX-WORKSTATION-001 (3 days ago)

Health Score: 75% (6/8 online)

Recommendation: Investigate offline endpoints.
```

**Use Case:** Daily monitoring, system health checks

---

## Emergency / Troubleshooting Queries

### Find Specific Endpoint
```
Get detailed information about endpoint "bms-win22srv"
```

**Note:** This uses `get_endpoint` tool (different from list_endpoints)

### Find Offline Systems
```
Which endpoints haven't been seen in 7 days?
```

### Check Network Connectivity
```
Show me all endpoints with their IP addresses
```

### Verify Inventory
```
How many total endpoints do we have in baramundi?
```

---

## Demo Flow Recommendations

### 5-Minute Quick Demo
1. Basic list (30s)
2. Search by name (20s)
3. Filter by OS type (20s)
4. Pagination example (30s)
5. Complex query (45s)
6. Real-world scenario (45s)
7. Wrap-up (30s)

### 3-Minute Lightning Demo
1. Basic list (20s)
2. Search by name (20s)
3. Filter by OS (20s)
4. Complex query with health check (60s)
5. Wrap-up showing all 94 tools (20s)

### 10-Minute Comprehensive Demo
- Include all sections above
- Add write operations demo (create_windows_endpoint)
- Show related tools (list_logical_groups, get_endpoint)
- Live Q&A with audience questions

---

## Presenter Notes

### Before Starting
- ✅ Verify bConnect API is accessible
- ✅ Test MCP connection: ask Claude "List available tools"
- ✅ Have backup queries ready
- ✅ Know approximate endpoint counts

### During Demo
- **Pause 2-3 seconds** between queries (let results display)
- **Highlight natural language** - no code required
- **Show Claude's reasoning** - how it chooses tools
- **Emphasize real-time data** - actual production baramundi data

### Common Questions & Answers

**Q: Is this real data or a demo?**
A: Real data from our baramundi Management Suite (BMS-WIN22SRV)

**Q: Can it do more than list endpoints?**
A: Yes! 94 MCP tools covering Jobs, Assets, AD, Security, and more

**Q: Does it work with large environments?**
A: Yes, full pagination support (we tested with PageSize up to 1000)

**Q: Can I automate this?**
A: Yes, through MCP protocol - can be integrated into scripts/workflows

**Q: What about security?**
A: HTTP Basic Auth over HTTPS, same as standard bConnect API

---

## Fallback Queries (If Live Demo Fails)

If MCP connection fails, have these ready:

```bash
# Direct API test
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=5"

# Show test results
cd /workspaces/claudinno/bConnect-MCP
npm test

# Show tool count
grep -c 'name: "' src/index.ts
```

---

## Success Metrics

Demo is successful if audience understands:
- ✅ **No coding required** - Natural language queries
- ✅ **Full API access** - All baramundi capabilities available
- ✅ **Real-time data** - Actual production system
- ✅ **Extensible** - 94 tools across 10 modules
- ✅ **Production-ready** - 390 tests, 86% coverage

---

**Ready to demo!** Copy queries from this file and paste into Claude during your presentation.
