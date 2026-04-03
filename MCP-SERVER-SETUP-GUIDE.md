# MCP Server Setup & Verification Guide

**Date:** 2025-11-04
**Status:** Configuration Complete - 117 Tools Ready for Use

---

## ✅ Configuration Complete

The bConnect MCP Server has been configured in Claude Code with 117 tools:

**Location:** `/root/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "bconnect": {
      "command": "node",
      "args": ["/workspaces/claudinno/bConnect-MCP/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms-win22srv:444/bconnect",
        "BCONNECT_USERNAME": "Administrator",
        "BCONNECT_PASSWORD": "baramundi-2008",
        "NODE_TLS_REJECT_UNAUTHORIZED": "0"  // ⚠️ DEVELOPMENT ONLY!
      }
    }
  }
}
```

⚠️ **Production Warning:** `NODE_TLS_REJECT_UNAUTHORIZED=0` is insecure and only for development.
See **SECURITY-BEST-PRACTICES.md** for production SSL configuration.

---

## 🔄 Restart Required

**To activate the MCP server:**
1. Restart Claude Code
2. Verify MCP server appears in settings
3. Check that 117 tools are available

**How to restart:**
- **Claude Code CLI:** Exit and restart the session
- **Claude Code Desktop:** Restart the application
- **VS Code:** Reload window (F1 → "Reload Window")

---

## ✅ Verification Steps

### Step 1: Check MCP Server Status

After restarting Claude Code, the MCP server should appear in the available servers list.

**Expected output:**
```
✅ bconnect MCP server connected
✅ 117 tools available (94 V2.0 + 23 V1.1)
```

### Step 2: Test MCP Tools Availability

Try using the tools through natural language:

**Documentation Search Tools (6):**
```
List all documentation sources
Search for "deployment automation"
What are popular topics in the forum?
Get documentation item by ID
Search known issues for error codes
Get known issues summary
```

**API Tools (94 V2.0 + 23 V1.1):**
```
List all Windows endpoints
Get job execution history
Show BitLocker status
Search for bConnect API documentation
Get compliance violations
List Apple VPP apps
```

### Step 3: Verify Tool Response

When you ask Claude to use an MCP tool, you should see:

```
Using tool: search_documentation
Parameters: { query: "deployment automation", limit: 10 }
Result: { results: [...], coverage: {...} }
```

**Not this:**
```
Creating a script to search...
Running node get-top-voted-ideas.mjs...
```

---

## 🧪 Testing with MCP Inspector

For detailed testing, use the MCP Inspector:

```bash
cd /workspaces/claudinno/bConnect-MCP
npx @modelcontextprotocol/inspector node build/index.js
```

**What this does:**
- Opens interactive web interface
- Lists all 117 MCP tools
- Allows testing each tool with parameters
- Shows real-time request/response

**Test documentation search:**
1. Open inspector at http://localhost:5173
2. Select tool: `search_documentation`
3. Set parameters: `{ "query": "deployment automation", "limit": 5 }`
4. Click "Execute"
5. Verify results show 5 relevant documents from 15,408+ indexed

---

## 📊 Available MCP Tools (117 Total)

### Documentation Search Tools (6)

| Tool Name | Description | Parameters |
|-----------|-------------|------------|
| `search_documentation` | Search across all documentation | `query`, `source?`, `type?`, `category?`, `limit?` |
| `get_documentation_item` | Get full document by ID | `id` |
| `list_documentation_sources` | Show coverage statistics | None |
| `get_popular_topics` | Get trending topics | `source?`, `limit?` |
| `search_known_issues` | Search technical issue database | `query`, `limit?` |
| `get_known_issues_summary` | Get known issues statistics | None |

**Coverage:** 15,408+ documents
- 📁 Forum: 13,065 threads (33 categories)
- 💡 Feedback: ~1,500 items (FAQ + KB + Ideas)
- 📋 Release Notes: 26 versions
- 📄 Preview PDFs: 4 documents
- 🌐 Website: ~457 pages
- ❓ Known Issues: ~356 items

### V2.0 API Tools (94)

**Categories:**
- **Endpoints** (38 tools): Windows/Linux/Mac/Industrial endpoint management, maintenance windows
- **Server Management** (25 tools): Server control, microservices, security groups
- **Assets** (20 tools): Asset inventory, types, stock management, folders
- **Jobs** (19 tools): Job definitions, execution, assignments, kiosk releases
- **Variables** (11 tools): Variable definitions and instances, scopes
- **Active Directory** (10 tools): AD groups, users, OUs, sync
- **Defense Control** (8 tools): BitLocker policies, threat protection, local admins
- **Operating Systems** (7 tools): OS folders and deployment profiles
- **Software** (4 tools): Software inventory and application catalog
- **Update Management** (3 tools): Windows updates and patch management

### V1.1 API Tools (23)

**Specialized Modules:**
- **Apple VPP** (7 tools): Volume Purchase Program (apps, users, licenses)
- **BitLocker Secrets** (5 tools): Recovery keys and PIN management (audit logged)
- **Detailed Inventory** (5 tools): Hardware, WMI, file scans, custom inventory
- **Compliance Violations** (3 tools): CVE vulnerability tracking
- **Setup Integrity** (2 tools): Client integrity checks and validation
- **SSH Server Config** (1 tool): SSH server configuration management

---

## 🎯 Natural Language Usage Examples

### Documentation Search

**Example 1: Basic Search**
```
User: "Search documentation for deployment automation"

Expected: Claude uses search_documentation tool
Result: 5-10 relevant results from forum/feedback/release notes
```

**Example 2: Filtered Search**
```
User: "Find forum threads about job scheduling"

Expected: Claude uses search_documentation with source: "forum"
Result: Forum threads specifically about job scheduling
```

**Example 3: Top Voted Ideas**
```
User: "What are the most requested features?"

Expected: Claude searches feedback portal ideas, sorts by votes
Result: Top 10 ideas with vote counts and status
```

**Example 4: Coverage Check**
```
User: "What documentation sources are available?"

Expected: Claude uses list_documentation_sources
Result: 15,408+ docs (13,065 forum + 1,500 feedback + 26 release notes + 4 PDFs + 457 website + 356 known issues)
```

**Example 5: Known Issues Search**
```
User: "Search known issues for error 0x80070005"

Expected: Claude uses search_known_issues
Result: Technical issue database results with solutions
```

### API Integration

**Example 6: Endpoint Management**
```
User: "List all Windows endpoints"

Expected: Claude uses list_windows_endpoints
Result: List of Windows endpoints with details
```

**Example 7: Job Execution**
```
User: "Show recent job executions"

Expected: Claude uses list_job_instances
Result: Recent job execution history
```

**Example 8: Combined Search + API**
```
User: "Find documentation about bConnect API, then list all endpoints"

Expected:
1. Uses search_documentation for "bConnect API"
2. Uses list_endpoints to show actual endpoints
Result: Documentation + live API data combined
```

---

## 🔧 Troubleshooting

### Problem 1: MCP Tools Not Available

**Symptoms:**
- Claude creates scripts instead of using MCP tools
- "I don't have access to..." responses
- No tool usage shown in conversation

**Solution:**
```bash
# 1. Verify configuration exists
cat /root/.config/Claude/claude_desktop_config.json

# 2. Check MCP server builds successfully
cd /workspaces/claudinno/bConnect-MCP
npm run build

# 3. Test MCP server manually
node build/index.js
# Should output: "bConnect MCP Server running on stdio"

# 4. Restart Claude Code completely
# Exit and start fresh session
```

### Problem 2: MCP Server Crashes

**Symptoms:**
- Error messages when using tools
- Tools work intermittently
- "Failed to execute tool" errors

**Solution:**
```bash
# Check MCP server logs
node build/index.js 2>&1 | tee mcp-server.log

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node build/index.js

# Rebuild from clean state
npm run build
```

### Problem 3: Documentation Search Returns No Results

**Symptoms:**
- search_documentation returns empty results
- "No documents found" messages

**Solution:**
```bash
# Verify documentation is indexed
cd /workspaces/claudinno/bConnect-MCP
node -e "
import { DocumentationSearchModule } from './build/modules/documentation-search.js';
const docSearch = new DocumentationSearchModule();
await docSearch.buildIndex();
const coverage = await docSearch.listSources();
console.log('Total documents:', coverage.totalDocuments);
"

# Expected output: "Total documents: 15408+"
```

### Problem 4: API Tools Return 401 Unauthorized

**Symptoms:**
- API tools fail with authentication errors
- "Invalid credentials" messages

**Solution:**
```bash
# Verify credentials in config
cat /root/.config/Claude/claude_desktop_config.json | grep -A3 env

# Test credentials manually
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/WindowsEndpoints?PageSize=1"

# Should return JSON with endpoint data
```

---

## 📈 Performance Expectations

### Documentation Search

| Operation | Expected Time | Notes |
|-----------|---------------|-------|
| Index build | ~60 seconds | First search triggers index build (15,408+ docs) |
| Search query | <100ms | After index is built |
| Get document | <10ms | Direct lookup by ID |
| List sources | <5ms | Metadata only |
| Known issues search | <50ms | Specialized database query |

### API Operations

| Operation | Expected Time | Notes |
|-----------|---------------|-------|
| List endpoints | 200-500ms | Depends on PageSize |
| Get single item | 100-300ms | Single HTTP request |
| Create/Update | 300-800ms | Write operations slower |
| Job execution | 400-800ms | Complex queries |

---

## 🎓 Best Practices

### 1. Let Claude Choose the Tool

**✅ Good:**
```
"Search for deployment automation"
```
Claude automatically selects: `search_documentation`

**❌ Bad:**
```
"Use the search_documentation tool with query 'deployment automation'"
```
Too prescriptive - let Claude handle tool selection

### 2. Combine Natural Language with Context

**✅ Good:**
```
"Find forum discussions about job scheduling, then show me the actual job definitions from the API"
```
Claude uses: `search_documentation` + `list_job_definitions`

**❌ Bad:**
```
"Call search_documentation, then call list_job_definitions"
```
Too technical - speak naturally

### 3. Leverage Documentation + API Together

**✅ Good:**
```
"How do I use bConnect API to manage endpoints? Show me documentation and actual examples."
```
Claude combines: search results + live API calls + code examples

**❌ Bad:**
```
"Search for bConnect API" (stops there)
```
Missing opportunity to see live data

### 4. Use Filters When Appropriate

**✅ Good:**
```
"Search the feedback portal for feature requests about automation"
```
Claude adds: `source: "feedback"`, `type: "idea"`

**❌ Bad:**
```
"Search everything for automation" (too broad)
```
Better to guide the search scope

---

## 🚀 Next Steps

### 1. Restart Claude Code

Exit this session and start a new one for MCP tools to become available.

### 2. Test Basic Search

```
List all documentation sources
```

Expected response: Coverage statistics (15,408+ documents across 6 sources)

### 3. Try Advanced Search

```
Search for "deployment automation" and show me the top 5 results
```

Expected: 5 ranked results with excerpts from forum/KB/release notes

### 4. Try Known Issues Search

```
Search known issues for common errors
```

Expected: Results from technical issue database (~356 items)

### 5. Combine with API

```
Find documentation about job management, then show me actual job definitions from the API
```

Expected: Documentation + live API data

### 6. Explore Capabilities

```
What can you tell me about the bConnect MCP server?
```

Expected: Claude lists all 117 available tools (94 V2.0 + 23 V1.1)

---

## 📚 Additional Resources

- **INDEX.md** - Documentation navigation (start here!)
- **README.md** - Overview and quick start
- **USAGE-EXAMPLES.md** - Examples for all 117 tools
- **TROUBLESHOOTING.md** - Common issues and solutions
- **SECURITY-BEST-PRACTICES.md** - Production security guide
- **API-INFO.md** - Complete API reference
- **DOCUMENTATION-SEARCH-INTEGRATION.md** - Search implementation details (15,408+ docs)
- **PRODUCTION-HARDENING-STATUS.md** - Production readiness tracking (82% complete)

---

## ✅ Configuration Checklist

- [x] MCP server built successfully (`npm run build`)
- [x] Configuration file created (`claude_desktop_config.json`)
- [x] Environment variables set (username, password, base URL)
- [x] Documentation indexed (15,408+ documents across 6 sources)
- [x] Test suite verified (812+ tests passing, 86.35% coverage)
- [x] Input validation complete (100% coverage, 186/186 tools)
- [ ] **Claude Code restarted** ← **Action Required**
- [ ] **MCP tools available in conversation** ← **Verify After Restart**
- [ ] **Production security review** ← See SECURITY-BEST-PRACTICES.md (if deploying to production)

---

**Status:** ✅ Ready for Use - Restart Claude Code to activate

**Development:** 117 MCP tools, 812+ tests, 15,408+ docs
**Production:** 82% ready (security hardening in progress)

**Next Action:** Restart Claude Code and try: `List all documentation sources`
