# Screencast Demonstration: List Endpoints MCP Tool

**MCP Tool:** `list_endpoints`
**Duration:** ~3-5 minutes
**Target Audience:** Innovation demo, stakeholders, technical teams

---

## Overview

This screencast demonstrates the `list_endpoints` MCP tool which lists all endpoints (devices) managed by baramundi. It showcases natural language interaction with Claude to query the baramundi Management Suite via the bConnect MCP Server.

---

## Pre-Recording Checklist

### Prerequisites
- [ ] DevContainer running with bConnect MCP Server configured
- [ ] Claude Code CLI connected to bConnect MCP Server
- [ ] BMS-WIN22SRV accessible (https://bms-win22srv:444/bconnect)
- [ ] Screen recording software installed (see Tools section below)

### Test Before Recording
```bash
cd /workspaces/claudinno/bConnect-MCP
npm test  # Verify 390 tests passing
npm run build  # Verify clean build
```

### Verify MCP Connection
Ask Claude:
```
Can you list all available MCP tools?
```
Expected: Should see `list_endpoints` in the list

---

## Recording Script

### Scene 1: Introduction (30 seconds)

**Visual:** Terminal showing the bConnect-MCP directory

**Narration:**
> "Welcome! Today I'll demonstrate how the bConnect MCP Server enables natural language interaction with baramundi Management Suite using Claude Code."
>
> "We've implemented 94 MCP tools covering 10 baramundi API modules. Let's focus on one powerful tool: list_endpoints."

**Actions:**
1. Show directory structure
   ```bash
   ls -la /workspaces/claudinno/bConnect-MCP
   ```

2. Show project status
   ```bash
   cat STATUS.md | head -20
   ```

---

### Scene 2: Simple List Query (45 seconds)

**Visual:** Claude Code interface

**Narration:**
> "Instead of writing API code or using curl commands, I can simply ask Claude in natural language."

**Query 1 - Basic List:**
```
List all endpoints managed by baramundi
```

**Expected Response:**
- Claude uses the `list_endpoints` MCP tool
- Returns JSON with endpoint information
- Shows endpoints with DisplayName, HostName, OperatingSystem, LastSeen

**Highlight:**
- Total endpoint count
- Endpoint names (e.g., "bms-win22srv", "WIN-CLIENT-001")
- Operating systems (Windows, Linux, Mac)

**Narration:**
> "Claude automatically used the list_endpoints MCP tool and returned all managed devices. No code required!"

---

### Scene 3: Filtered Search (45 seconds)

**Visual:** Claude Code interface

**Narration:**
> "Let's get more specific. I can filter by name, operating system, or any field."

**Query 2 - Search by Name:**
```
Show me all Windows endpoints with "WIN" in the name
```

**Expected Response:**
- Claude uses `list_endpoints` with SearchQuery parameter
- Returns only Windows endpoints matching "WIN"

**Query 3 - Operating System Filter:**
```
List all Linux endpoints
```

**Expected Response:**
- Claude uses `list_linux_endpoints` tool
- Returns Linux systems only

**Narration:**
> "Claude intelligently chooses the right tool and parameters based on my natural language request."

---

### Scene 4: Pagination and Sorting (45 seconds)

**Visual:** Claude Code interface

**Narration:**
> "For large environments with hundreds or thousands of devices, pagination and sorting are essential."

**Query 4 - Paginated Results:**
```
Show me the first 5 endpoints sorted by name
```

**Expected Response:**
- Claude uses `list_endpoints` with PageSize: 5, OrderBy: "DisplayName asc"
- Returns 5 endpoints sorted alphabetically

**Query 5 - Specific Page:**
```
Show me endpoints 11-20 sorted by last seen date
```

**Expected Response:**
- Claude uses Page: 1 (zero-indexed), PageSize: 10, OrderBy: "LastSeen desc"
- Returns next page of results

**Narration:**
> "The MCP tool supports all baramundi API capabilities: pagination, sorting, filtering - all through natural language."

---

### Scene 5: Complex Query (45 seconds)

**Visual:** Claude Code interface

**Narration:**
> "Let's combine multiple criteria for a real-world scenario."

**Query 6 - Complex Search:**
```
Find all Windows endpoints that haven't been seen in the last 7 days, sorted by last seen date
```

**Expected Response:**
- Claude interprets the time-based query
- Uses `list_endpoints` with appropriate filters
- Returns stale endpoints (potential offline systems)

**Narration:**
> "This query would require complex API code. With Claude and MCP, it's just a natural language question. Perfect for identifying systems that need attention."

---

### Scene 6: Demonstrating the API Call (30 seconds)

**Visual:** Terminal showing the actual MCP tool execution

**Narration:**
> "Behind the scenes, Claude is calling the bConnect API through our MCP server."

**Actions:**
Show the MCP tool definition:
```bash
grep -A 20 '"list_endpoints"' src/index.ts | head -25
```

**Narration:**
> "The MCP server translates natural language into API calls: /endpoints/v2.0/Endpoints with proper authentication and parameters."

---

### Scene 7: Real-World Use Case (45 seconds)

**Visual:** Claude Code interface

**Narration:**
> "Let's see a practical example: preparing for a software deployment."

**Query 7 - Deployment Planning:**
```
List all Windows endpoints, show me the total count, and group them by operating system version
```

**Expected Response:**
- Claude lists all Windows endpoints
- Calculates totals
- Groups by OS version
- Perfect for deployment planning

**Query 8 - Asset Inventory:**
```
Show me all endpoints with "SERVER" in the name
```

**Expected Response:**
- Filters server systems
- Useful for infrastructure audits

**Narration:**
> "These queries support real IT operations: patch management, asset inventory, compliance reporting - all through natural conversation."

---

### Scene 8: Conclusion (30 seconds)

**Visual:** Summary slide or terminal

**Narration:**
> "Let's recap what we've seen:"

**Show on screen:**
```
✅ 94 MCP tools across 10 baramundi API modules
✅ Natural language queries (no code required)
✅ Full API capability (filter, sort, paginate)
✅ Real-time data from baramundi Management Suite
✅ Production-ready (390 tests, 86% coverage)
```

**Narration:**
> "The bConnect MCP Server bridges the gap between natural language and enterprise IT management. From simple queries to complex operations, Claude can now interact with your entire baramundi environment."
>
> "This is just ONE tool. We have 93 more covering endpoints, jobs, assets, Active Directory, security, and more."
>
> "Thank you for watching!"

---

## Sample Queries Cheat Sheet

**Copy-paste ready queries for live demonstration:**

```
# Basic
List all endpoints

# Filtered
Show me all Windows endpoints
List all Linux endpoints
Find endpoints with "WIN" in the name

# Sorted
Show me endpoints sorted by name
List endpoints sorted by last seen date (newest first)

# Paginated
Show me the first 10 endpoints
Show me endpoints 11-20

# Complex
Find all Windows endpoints that haven't been seen in 7 days
Show me all servers (endpoints with "SERVER" in name) sorted by OS version
List all endpoints with IP addresses starting with "192.168"
```

---

## Expected Outputs Reference

### Query: "List all endpoints"

**Claude's Response:**
```
I'll use the list_endpoints MCP tool to get all managed endpoints.

[MCP Tool Call: list_endpoints]

Here are all managed endpoints:

Total: 8 endpoints

1. bms-win22srv
   - Type: Windows Server 2022
   - Status: Online
   - Last Seen: 2025-10-20 12:30:15
   - IP: 192.168.1.100

2. WIN-CLIENT-001
   - Type: Windows 11 Enterprise
   - Status: Online
   - Last Seen: 2025-10-20 12:25:03
   - IP: 192.168.1.101

[... continues for all endpoints ...]
```

### Query: "Show me the first 5 endpoints sorted by name"

**Claude's Response:**
```
I'll retrieve the first 5 endpoints sorted alphabetically by display name.

[MCP Tool Call: list_endpoints
  PageSize: 5
  OrderBy: "DisplayName asc"
]

Here are the first 5 endpoints sorted by name:

1. ANDROID-TABLET-001
2. bms-win22srv
3. IOS-IPHONE-001
4. LINUX-SERVER-001
5. WIN-CLIENT-001

Total endpoints in system: 8
Showing: 1-5
```

---

## Technical Setup

### Directory Structure
```
/workspaces/claudinno/bConnect-MCP/
├── src/
│   ├── index.ts              # MCP server with list_endpoints tool
│   ├── modules/
│   │   └── endpoints.ts      # Endpoints module implementation
│   └── generated/
│       └── endpoints-types.ts
├── .env                      # bConnect credentials
└── build/                    # Compiled JavaScript
```

### Environment Variables (already configured)
```env
BCONNECT_BASE_URL=https://bms-win22srv:444/bconnect
BCONNECT_USERNAME=Administrator
BCONNECT_PASSWORD=baramundi-2008
NODE_TLS_REJECT_UNAUTHORIZED=0
```

---

## Recording Tools Options

### Option 1: asciinema (Terminal Recording)
**Recommended for technical demos**

Install:
```bash
sudo apt-get update
sudo apt-get install -y asciinema
```

Record:
```bash
cd /workspaces/claudinno/bConnect-MCP
asciinema rec --title "bConnect MCP Demo - List Endpoints" demo-list-endpoints.cast
# Perform demonstration
# Press Ctrl+D when done
```

Share:
```bash
asciinema upload demo-list-endpoints.cast
# Or convert to GIF/video
```

Convert to GIF:
```bash
# Install asciicast2gif
npm install -g asciicast2gif

# Convert
asciicast2gif demo-list-endpoints.cast demo-list-endpoints.gif
```

### Option 2: OBS Studio (Full Screen Recording)
**Recommended for polished demos**

Install OBS Studio on Windows host (PCDE220010):
- Download from https://obsproject.com/
- Configure screen capture of Hyper-V window
- Add audio commentary track
- Record in 1080p at 30fps

### Option 3: SimpleScreenRecorder (Linux)
**Alternative for Ubuntu guest**

Install:
```bash
sudo apt-get install simplescreenrecorder
```

Record:
- Launch via GUI: `simplescreenrecorder`
- Select "Record the entire screen"
- Configure output: MP4, H.264, 1080p
- Record demonstration

### Option 4: Windows Game Bar (Quick Option)
**Easiest for Windows host**

Record Hyper-V window:
- Press Windows + G
- Click "Capture"
- Record entire demonstration
- Save to Videos/Captures

---

## Post-Production Checklist

After recording:

- [ ] Trim intro/outro if needed
- [ ] Add title slide (optional)
- [ ] Add captions/subtitles (accessibility)
- [ ] Export to MP4 (H.264, 1080p, 30fps)
- [ ] File size < 100MB (for easy sharing)
- [ ] Upload to company video platform
- [ ] Add to innovation demo presentation

---

## Troubleshooting

### Problem: MCP tool not responding
**Solution:**
```bash
# Restart MCP server
cd /workspaces/claudinno/bConnect-MCP
npm run build
# Restart Claude Code
```

### Problem: Authentication failed
**Solution:**
```bash
# Verify credentials
cat .env | grep -E "USERNAME|PASSWORD"

# Test API connection
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
```

### Problem: No endpoints returned
**Solution:**
- Verify BMS-WIN22SRV is accessible
- Check network connectivity
- Verify baramundi Management Suite has endpoints registered

---

## Additional Demo Ideas

### Extended Demo (10 minutes)
Add these tools to the demonstration:

1. **get_endpoint** - Show detailed endpoint information
   ```
   Get detailed information about endpoint "bms-win22srv"
   ```

2. **list_windows_endpoints** - Platform-specific listing
   ```
   Show me all Windows endpoints with their OS versions
   ```

3. **list_logical_groups** - Group management
   ```
   List all logical groups in baramundi
   ```

4. **create_windows_endpoint** (Write operation)
   ```
   Create a new Windows endpoint named "WIN-DEMO-PC-001"
   ```

### Live Q&A Demo
Prepare for common questions:
- "How many endpoints do we have?" → Use list_endpoints with count
- "Which systems are offline?" → Filter by LastSeen
- "Show me all servers" → SearchQuery for "SERVER"
- "Can I update endpoints?" → Demonstrate write operations

---

## Success Metrics

**Demo is successful if viewers understand:**
- ✅ Natural language queries eliminate coding
- ✅ MCP tools provide full API access
- ✅ Real-time data from production baramundi environment
- ✅ Practical for IT operations (not just a demo)
- ✅ Extensible to all baramundi modules (94 tools total)

---

## Files Generated

This screencast package includes:
- This script (SCREENCAST-LIST-ENDPOINTS.md)
- Terminal recording script (see next section)
- Automated demo script (see next section)
- Sample queries reference

---

**Ready to record!** Follow this script for a professional, repeatable demonstration of the list_endpoints MCP tool.
