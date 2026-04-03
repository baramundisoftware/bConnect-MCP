# How to Search baramundi Documentation

**Quick Guide: Using bConnect MCP Server Documentation Search Tools**

---

## Available Search Tools

The bConnect MCP server provides **6 powerful documentation tools** for searching **6,031+ baramundi documents**:

| Tool | Coverage | Best For |
|------|----------|----------|
| `search_documentation` | 6,031 docs (forum, feedback, release notes, preview, website) | General searches, finding solutions, browsing all content |
| `get_documentation_item` | Full content access | Getting complete document/thread content by ID |
| `list_documentation_sources` | All sources + stats | Discovering available content and coverage |
| `get_popular_topics` | Trending topics | Finding most discussed topics and common issues |
| `search_known_issues` | 1,664 known issues + 9,856 forum solutions | Finding official known issues with community solutions |
| `get_known_issues_summary` | Known issues stats | Getting overview of known issues database |

---

## Typical Workflows Using Multiple Tools

### Workflow 1: First-Time User Discovery
```
1. "List all baramundi documentation sources"
   → See what's available

2. "Get popular topics in baramundi documentation"
   → Understand common issues

3. "Search baramundi documentation for [your topic]"
   → Find specific information

4. "Get full content of [document ID]"
   → Read complete article
```

### Workflow 2: Troubleshooting an Issue
```
1. "Search known issues for [error/problem]"
   → Check if it's a documented issue

2. Review forum solutions linked to the known issue
   → See community fixes

3. "Get full content of [forum thread ID]"
   → Read complete solution thread

4. If no known issue: "Search baramundi forum for [error/problem]"
   → Find community discussions
```

### Workflow 3: Planning an Upgrade
```
1. "Show me the known issues summary"
   → Understand issue landscape

2. "Search known issues in [version] for upgrade"
   → Find version-specific issues

3. "Search baramundi release notes for [version] new features"
   → Learn what's new

4. "Get popular topics in release notes"
   → See what others focus on
```

---

## Tool 1: General Documentation Search

### What it searches:
- **Forum threads**: 4,036 threads (baramundi Connect, Job Management)
- **Feedback portal**: 1,527 items (FAQ: 11, KB: 283, Ideas: 1,233)
- **Release notes**: 10 documents (2024R1-2025R2)
- **Preview documents**: 4 docs (bMS 2024/2025 R1/R2)
- **Website**: 456 pages (blog, products, solutions, resources)

### Example Prompts:

**General search across all sources:**
```
Search baramundi documentation for "BitLocker recovery"
```

**Search specific source:**
```
Search baramundi forum for patch management issues
```

```
Search baramundi release notes for Windows 11 compatibility
```

```
Search baramundi feedback portal for Active Directory sync ideas
```

```
Search baramundi website for pricing information
```

**Search with category filter (forum only):**
```
Search baramundi forum category "Job Management" for script execution errors
```

**Limit results:**
```
Search baramundi documentation for "inventory" and show top 5 results
```

### Prompt Patterns That Work:

✅ **Good prompts:**
- "Search baramundi [source] for [topic]"
- "Find baramundi documentation about [feature]"
- "Look up [topic] in baramundi [forum/feedback/release notes]"
- "Search baramundi docs for [keyword]"

❌ **Prompts that may not trigger the tool:**
- "Search documentation for..." (too generic, doesn't mention baramundi)
- "Find information about..." (ambiguous)
- "Look up..." (no clear intent)

### Pro Tips:

1. **Always mention "baramundi"** explicitly to help Claude understand you want to use the MCP search tools
2. **Be specific** about the source if you know where to look (forum, feedback, release notes)
3. **Use natural language** - the search uses fuzzy matching and handles partial words
4. **Ask for specific results** - "show top 5 results", "limit to 3 answers"

---

## Tool 2: Get Full Documentation Item

### What it does:
Retrieves the **complete content** of a specific document/thread by its ID. Returns full markdown content with all metadata.

### Example Prompts:

**Get full thread content:**
```
Get the full content of documentation item "forum-job-management-14037"
```

**After a search, get details:**
```
Show me the complete content of document ID "feedback-kb-283"
```

### Prompt Patterns That Work:

✅ **Good prompts:**
- "Get full content of [document ID]"
- "Show complete document [ID]"
- "Retrieve documentation item [ID]"

### Pro Tips:

1. **Use after search** - First search, then get full content of interesting results
2. **Document IDs** are returned in search results (e.g., `forum-connect-12345`)
3. **Full content includes** - Complete text, all metadata, timestamps, categories

---

## Tool 3: List Documentation Sources

### What it does:
Lists **all available documentation sources** with detailed coverage statistics. Shows what content is indexed and how much of each type.

### Example Prompts:

**See all available sources:**
```
List all baramundi documentation sources
```

```
Show me what documentation is available
```

```
What documentation sources can I search?
```

### What You'll See:

- **Forum categories**: baramundi Connect, Job Management, etc.
- **Feedback portal**: FAQ count, Knowledge Base count, Ideas count
- **Release notes**: Available versions (2024R1-2025R2)
- **Preview documents**: bMS 2024/2025 R1/R2 preview docs
- **Website content**: Blog, products, solutions, resources, company, case studies
- **Coverage stats**: Document counts for each source

### Prompt Patterns That Work:

✅ **Good prompts:**
- "List baramundi documentation sources"
- "Show available documentation"
- "What documentation can I search?"

### Pro Tips:

1. **Use this first** when exploring what's available
2. **Helps narrow searches** by knowing which sources exist
3. **Shows coverage** so you know where to find specific content types

---

## Tool 4: Get Popular Topics

### What it does:
Discovers the **most frequently discussed topics** across all documentation. Analyzes titles to extract common keywords and trending themes.

### Example Prompts:

**Get trending topics:**
```
What are the most popular topics in baramundi documentation?
```

```
Show me trending topics in the baramundi forum
```

```
What are common issues in baramundi feedback portal?
```

**Filter by source:**
```
Get popular topics in release notes
```

```
Show me trending topics in the forum only
```

### Prompt Patterns That Work:

✅ **Good prompts:**
- "What are popular topics in [source]?"
- "Show trending topics in baramundi [forum/feedback/all]"
- "What are common issues discussed?"
- "Find top topics in baramundi documentation"

### Pro Tips:

1. **Use for discovery** - Find out what others are asking about
2. **Filter by source** - Forum, feedback, release-notes, preview, or all
3. **Set limit** - "Show top 5 popular topics" or "list 20 trending topics"
4. **Good for newcomers** - Quickly understand common issues and popular features

---

## Tool 5: Known Issues Search

### What it searches:
- **1,664 known issues** from official release notes (2024R1-2025R2)
- **Cross-referenced with 9,856 forum threads** for solutions
- **100% coverage**: Every known issue has links to relevant forum solutions

### Example Prompts:

**Basic search:**
```
Search known issues for BitLocker encryption problems
```

**Filter by version:**
```
Find known issues in baramundi 2024R2 about Windows updates
```

```
Search known issues for patch deployment in version 2025R1
```

**Filter by language:**
```
Search German known issues for installation errors
```

```
Find English known issues about license activation
```

**Specific version and language:**
```
Search known issues in 2024R2S1 (English) for network timeout problems
```

### Prompt Patterns That Work:

✅ **Good prompts:**
- "Search known issues for [problem]"
- "Find known issues in [version] about [topic]"
- "Look up known issues for [error message]"
- "Search baramundi known issues related to [feature]"

❌ **Prompts that may not trigger the tool:**
- "Are there any issues with..." (too vague)
- "What problems exist..." (no search intent)

### Pro Tips:

1. **Use this tool when troubleshooting** - it combines official known issues with community solutions
2. **Specify version** if you know it (2024R1, 2024R2, 2024R2S1, 2025R1, 2025R2)
3. **Each result includes**:
   - Issue title and description
   - Affected version
   - Top 5 relevant forum threads with solutions
   - Direct links to forum discussions

---

## Tool 6: Get Known Issues Summary

### What it does:
Provides **summary statistics** about the known issues database. Shows total issues, issues with forum solutions, and coverage percentage.

### Example Prompts:

**Get overview:**
```
Show me the known issues summary
```

```
What is the known issues database coverage?
```

```
How many known issues are documented?
```

### What You'll See:

- **Total known issues**: Number of documented issues (1,664)
- **Issues with solutions**: Issues that have forum thread links
- **Coverage percentage**: 100% (all issues have forum solutions)
- **Version breakdown**: Issues per release version
- **Language breakdown**: Issues per language (DE/EN)

### Prompt Patterns That Work:

✅ **Good prompts:**
- "Show known issues summary"
- "Get known issues statistics"
- "How many known issues exist?"
- "What is the known issues coverage?"

### Pro Tips:

1. **Use before searching** - Understand the scope of available data
2. **Check coverage** - Confirms all issues have community solutions
3. **Quick stats** - Get overview without detailed search results

---

## Common Use Cases

### 1. **Troubleshooting an Error**

**Step-by-step workflow:**

```
1. Search known issues for error code 0x80070005
2. If found: Get full content of the known issue document
3. If not found: Search baramundi forum for "error 0x80070005" solutions
4. Get full content of the most relevant forum thread
```

### 2. **Learning About a Feature**

Search across all documentation:

```
Search baramundi documentation for "Kiosk self-service portal"
```

Or check specific sources:
```
Search baramundi website for Kiosk feature overview
```

```
Search baramundi forum for Kiosk configuration examples
```

### 3. **Finding Feature Requests**

Search feedback portal:

```
Search baramundi feedback portal for Linux support ideas
```

```
Find baramundi feature requests about API improvements
```

### 4. **Checking What's New**

Search release notes:

```
Search baramundi release notes for new features in 2025R1
```

```
Find 2024R2 release notes about performance improvements
```

### 5. **Getting Community Help**

Search forum by category:

```
Search baramundi forum category "baramundi Connect" for PowerShell examples
```

```
Find Job Management forum posts about scheduled task failures
```

### 6. **Exploring Documentation (New to baramundi)**

**Complete discovery workflow:**

```
1. List all baramundi documentation sources
   (See what's available and coverage stats)

2. Get popular topics in baramundi documentation
   (Discover trending issues and common questions)

3. Get known issues summary
   (Understand scope of documented problems)

4. Search baramundi documentation for topics you're interested in
   (Find specific information)

5. Get full content of interesting documents
   (Read complete threads and articles)
```

---

## Understanding Search Results

### Documentation Search Results Include:
- **Title**: Document/thread title
- **Excerpt**: Relevant snippet with your search terms highlighted
- **Source**: Where it came from (forum, feedback, release notes, etc.)
- **URL**: Direct link to full content
- **Score**: Relevance ranking (higher = more relevant)
- **Category**: Forum category (if applicable)
- **Language**: Content language (en/de)

### Known Issues Results Include:
- **Issue Title**: Official issue name
- **Description**: What the issue is about
- **Version**: Affected bMS version
- **Language**: Documentation language
- **Related Forum Threads**: Top 5 most relevant forum discussions with:
  - Thread title
  - Relevance score
  - Direct URL to forum thread

---

## Quick Reference: Search Keywords

### By Topic:

| Topic | Good Keywords |
|-------|---------------|
| **Installation** | install, setup, deployment, configuration |
| **Updates** | patch, update, Windows Update, WSUS |
| **Jobs** | job, script, execution, automation, task |
| **Inventory** | inventory, hardware, software, scan, detection |
| **Security** | BitLocker, encryption, firewall, antivirus, Defender |
| **Network** | network, connection, proxy, firewall, port |
| **Active Directory** | AD, domain, LDAP, sync, authentication |
| **Errors** | error, failed, exception, timeout, crash |

### By Source:

| Source | What to search for |
|--------|-------------------|
| **Forum** | Solutions, workarounds, community discussions |
| **Feedback** | Feature requests, ideas, known issues reports |
| **Release Notes** | New features, bug fixes, known issues |
| **Preview** | Upcoming features, roadmap |
| **Website** | Product info, pricing, case studies |

---

## Advanced Search Techniques

### 1. Combine Multiple Searches

```
Search known issues for "patch deployment timeout" in 2024R2
```

Then drill down:
```
Search baramundi forum for patch deployment timeout solutions
```

### 2. Use Specific Error Messages

```
Search baramundi documentation for "The remote procedure call failed"
```

### 3. Search by Component

```
Search baramundi forum for "bNomad offline mode"
```

```
Find documentation about "bConnect API authentication"
```

### 4. Filter by Category

```
Search baramundi forum category "Job Management" for "PowerShell parameters"
```

### 5. Version-Specific Searches

```
Find known issues in 2025R1 about SQL Server
```

```
Search 2024R2 release notes for deprecation warnings
```

---

## Troubleshooting Search Issues

### Claude doesn't use the search tool:

**Problem**: Prompt too generic
```
❌ "Search for BitLocker"
```

**Solution**: Mention baramundi explicitly
```
✅ "Search baramundi documentation for BitLocker"
```

### No results found:

**Problem**: Keywords too specific
```
❌ "Search for BMSConfigurator.exe timeout error 0x80070057"
```

**Solution**: Simplify keywords
```
✅ "Search baramundi for BMSConfigurator timeout"
```

### Wrong source searched:

**Problem**: Intent unclear
```
❌ "Search for new features"
```

**Solution**: Specify source
```
✅ "Search baramundi release notes for new features"
```

---

## Examples: Real-World Scenarios

### Scenario 1: Client Won't Install Updates

```
1. Search known issues for "Windows Update installation failed"
2. If found: Review forum solutions linked to the known issue
3. If not found: Search baramundi forum for "update installation error"
```

### Scenario 2: Need PowerShell Script Examples

```
Search baramundi forum category "Job Management" for PowerShell script examples
```

### Scenario 3: Planning Upgrade

```
1. Search baramundi release notes for "2025R1 new features"
2. Search known issues in 2025R1 for "upgrade"
3. Search baramundi forum for "2025R1 upgrade experience"
```

### Scenario 4: Feature Not Working

```
1. Search baramundi documentation for "[feature name] configuration"
2. Search known issues for "[feature name] not working"
3. Search baramundi feedback portal for "[feature name]" bug reports
```

---

## Best Practices

1. ✅ **Start broad, then narrow down**
   - First: Search all documentation
   - Then: Search specific sources if needed

2. ✅ **Use natural language**
   - Write like you'd ask a colleague
   - Example: "How do I configure BitLocker recovery key backup?"

3. ✅ **Check known issues first when troubleshooting**
   - Saves time by finding official issues with community solutions

4. ✅ **Combine with API tools**
   - Search docs to learn → Use API tools to execute
   - Example: Search for "create job" → Use `create_job_instance` tool

5. ✅ **Leverage forum categories**
   - baramundi Connect
   - Job Management
   - (More categories available)

---

## Need Help?

If you're not getting the results you expect, try:

1. **Simplify your search terms** - Use 1-3 keywords
2. **Be explicit about baramundi** - Always mention "baramundi" in your prompt
3. **Try different phrasings** - "Search for", "Find", "Look up"
4. **Specify the source** - forum, feedback, release notes, etc.
5. **Check spelling** - Fuzzy search helps but correct spelling is better

---

## Quick Reference: All 6 Tools

| # | Tool Name | When to Use | Example Prompt |
|---|-----------|-------------|----------------|
| 1 | `search_documentation` | Finding information, solutions, discussions | "Search baramundi forum for BitLocker recovery" |
| 2 | `get_documentation_item` | Reading full thread/article after search | "Get full content of forum-connect-12345" |
| 3 | `list_documentation_sources` | Discovering what's available to search | "List all baramundi documentation sources" |
| 4 | `get_popular_topics` | Finding trending topics and common issues | "What are popular topics in the forum?" |
| 5 | `search_known_issues` | Finding official issues with solutions | "Search known issues for Windows 11 problems" |
| 6 | `get_known_issues_summary` | Getting overview of issues database | "Show me the known issues summary" |

---

**Documentation Search Stats:**
- 🛠️ **6 powerful search tools** available
- 📚 **6,031 total documents** indexed
- 💬 **4,036 forum threads** (baramundi Connect, Job Management)
- 💡 **1,527 feedback items** (FAQ: 11, KB: 283, Ideas: 1,233)
- 📋 **10 release notes** (2024R1-2025R2)
- 🔮 **4 preview documents** (bMS 2024/2025 R1/R2)
- 🌐 **456 website pages** (blog, products, solutions, resources)
- 🔍 **1,664 known issues** cross-referenced with **9,856 forum solutions**
- ✅ **100% coverage** - All known issues have forum solutions

**Last Updated**: April 2026 (bConnect MCP Suite v26.1.0)
