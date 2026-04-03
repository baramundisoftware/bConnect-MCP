# bConnect MCP Server - Troubleshooting Guide

Complete guide for diagnosing and resolving common issues with the bConnect MCP Server.

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Authentication Errors](#authentication-errors)
3. [Network & Connection Errors](#network--connection-errors)
4. [API Errors (4xx)](#api-errors-4xx)
5. [Server Errors (5xx)](#server-errors-5xx)
6. [Configuration Issues](#configuration-issues)
7. [MCP Tool Errors](#mcp-tool-errors)
8. [Performance Issues](#performance-issues)
9. [Documentation Search Issues](#documentation-search-issues)
10. [Debugging Techniques](#debugging-techniques)

---

## Quick Diagnostics

### Check if MCP Server is Running

```bash
cd /workspaces/claudinno/bConnect-MCP
node build/index.js
```

Expected output: `bConnect MCP server running on stdio`

### Verify Configuration

```bash
cat .env
```

Required variables:
```env
BCONNECT_BASE_URL=https://bms-win22srv:444/bconnect
BCONNECT_USERNAME=Administrator
BCONNECT_PASSWORD=baramundi-2008
NODE_TLS_REJECT_UNAUTHORIZED=0
```

### Test API Connection

```bash
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
```

---

## Authentication Errors

### Error: "Authentication failed. Check your username and password."

**Cause:** Invalid credentials (HTTP 401)

**Solutions:**

1. **Verify credentials in `.env`:**
   ```bash
   cat .env | grep -E "USERNAME|PASSWORD"
   ```

2. **Test credentials with curl:**
   ```bash
   curl -k -u "Administrator:baramundi-2008" \
     "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
   ```

3. **Check for special characters:**
   - Passwords with `$`, `` ` ``, `\`, `"` need escaping in `.env`
   - Use single quotes: `BCONNECT_PASSWORD='P@$$w0rd!'`

4. **Verify account status:**
   - Account not locked
   - Account not expired
   - Account has API access permissions

### Error: "Access denied. Insufficient permissions for this operation."

**Cause:** User lacks required permissions (HTTP 403)

**Solutions:**

1. **Check user permissions in baramundi console**
2. **Verify API access is enabled for the user**
3. **Use an administrator account for testing**
4. **Check security group assignments**

### Error: "Token expired" or "Session timeout"

**Cause:** Long-running operations with expired sessions

**Solutions:**

1. **Configure longer timeout in `.env`:**
   ```env
   BCONNECT_TIMEOUT=60000  # 60 seconds
   ```

2. **For very long operations, increase further:**
   ```env
   BCONNECT_TIMEOUT=300000  # 5 minutes
   ```

---

## Network & Connection Errors

### Error: "Cannot connect to bConnect API. Check network connectivity and API availability."

**Cause:** Network error, server unreachable

**Solutions:**

1. **Verify server is reachable:**
   ```bash
   ping bms-win22srv
   ```

2. **Test HTTPS connectivity:**
   ```bash
   curl -k https://bms-win22srv:444/bconnect/
   ```

3. **Check if bConnect service is running:**
   - Log into BMS-WIN22SRV
   - Verify baramundi services are running
   - Check Windows Event Logs

4. **Verify firewall rules:**
   - Port 444 is open
   - No blocking between client and server

5. **Enable retry logic:**
   ```env
   BCONNECT_MAX_RETRIES=3
   BCONNECT_RETRY_DELAY=100
   ```

### Error: "ECONNREFUSED" or "Connection refused"

**Cause:** Server not listening on port 444

**Solutions:**

1. **Verify bConnect service is running on BMS-WIN22SRV**
2. **Check port configuration:**
   ```bash
   netstat -an | grep 444
   ```
3. **Verify BASE_URL in `.env`:**
   ```env
   BCONNECT_BASE_URL=https://bms-win22srv:444/bconnect
   ```

### Error: "ETIMEDOUT" or "Request timeout"

**Cause:** Server not responding, slow network

**Solutions:**

1. **Increase timeout:**
   ```env
   BCONNECT_TIMEOUT=60000  # Increase from default 30 seconds
   ```

2. **Enable retry logic:**
   ```env
   BCONNECT_MAX_RETRIES=3
   BCONNECT_RETRY_DELAY=200
   ```

3. **Check network latency:**
   ```bash
   ping bms-win22srv
   traceroute bms-win22srv
   ```

4. **Verify server load on BMS-WIN22SRV**

### Error: "SSL certificate verify failed" or "CERT_HAS_EXPIRED"

**Cause:** SSL certificate issues

**Solutions:**

1. **For development (bypass SSL verification):**
   ```env
   NODE_TLS_REJECT_UNAUTHORIZED=0
   ```

2. **For production (add certificate to trust store):**
   ```bash
   # Copy baramundi certificate to trust store
   sudo cp baramundi-cert.crt /usr/local/share/ca-certificates/
   sudo update-ca-certificates

   # Enable SSL verification
   NODE_TLS_REJECT_UNAUTHORIZED=1
   ```

3. **Verify certificate:**
   ```bash
   openssl s_client -connect bms-win22srv:444 -showcerts
   ```

---

## API Errors (4xx)

### 400 Bad Request

**Cause:** Malformed request, invalid parameters

**Common Issues:**

1. **Invalid GUID format:**
   ```
   ❌ Wrong: "abc123"
   ✅ Correct: "98cdf559-1733-42b4-ae1f-42eabf7f9281"
   ```

2. **Invalid parameter types:**
   ```
   ❌ Wrong: PageSize: "10" (string)
   ✅ Correct: PageSize: 10 (number)
   ```

3. **Missing required parameters:**
   - Check API documentation for required fields
   - Use USAGE-EXAMPLES.md for correct parameter usage

**Solutions:**

1. **Validate GUID format:**
   - Must be valid UUID format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

2. **Check parameter types:**
   - Numbers should be numbers, not strings
   - Booleans should be true/false, not "true"/"false"

3. **Review API-INFO.md for correct parameter names and types**

### 404 Not Found

**Cause:** Resource doesn't exist

**Common Issues:**

1. **Incorrect endpoint ID:**
   ```
   Error: "Resource not found."
   ```

2. **Typo in GUID:**
   - Double-check the GUID is correct
   - Verify the resource exists with a list operation first

**Solutions:**

1. **List resources first to get correct ID:**
   ```
   "List all endpoints" → Find correct ID → "Show me endpoint <ID>"
   ```

2. **Verify resource exists:**
   ```bash
   curl -k -u "Administrator:baramundi-2008" \
     "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints/{id}"
   ```

3. **Check if resource was deleted**

### 429 Too Many Requests

**Cause:** Rate limit exceeded

**Solutions:**

1. **Automatic retry (already configured):**
   - MCP server automatically retries 429 errors
   - Uses exponential backoff

2. **Increase retry delay:**
   ```env
   BCONNECT_RETRY_DELAY=500  # Wait longer between retries
   ```

3. **Reduce request frequency:**
   - Use pagination with smaller PageSize
   - Add delays between batch operations

4. **Contact baramundi support to increase rate limits**

---

## Server Errors (5xx)

### 500 Internal Server Error

**Cause:** baramundi server-side error

**Solutions:**

1. **Automatic retry (already configured):**
   - MCP server automatically retries 5xx errors
   - Uses exponential backoff

2. **Check BMS-WIN22SRV logs:**
   - Windows Event Viewer
   - baramundi application logs

3. **Verify server health:**
   ```bash
   curl -k -u "Administrator:baramundi-2008" \
     "https://bms-win22srv:444/bconnect/servermanagement/v2.0/ServerInformation"
   ```

4. **Contact baramundi support if persistent**

### 503 Service Unavailable

**Cause:** bConnect service is down or restarting

**Solutions:**

1. **Automatic retry (already configured):**
   ```env
   BCONNECT_MAX_RETRIES=3
   BCONNECT_RETRY_DELAY=100
   ```

2. **Check bConnect service status on BMS-WIN22SRV:**
   ```powershell
   Get-Service | Where-Object {$_.Name -like "*baramundi*"}
   ```

3. **Wait for service to restart:**
   - Service may be updating
   - Check maintenance window

4. **Restart bConnect service if needed:**
   ```powershell
   Restart-Service baramundiManagementServer
   ```

---

## Configuration Issues

### Error: "Cannot find module './build/index.js'"

**Cause:** TypeScript not compiled

**Solution:**

```bash
cd /workspaces/claudinno/bConnect-MCP
npm run build
```

### Error: ".env file not found"

**Cause:** Missing configuration file

**Solution:**

```bash
cd /workspaces/claudinno/bConnect-MCP
cp .env.example .env
# Edit .env with your credentials
nano .env
```

### Error: "Cannot read property 'baseUrl' of undefined"

**Cause:** Missing required environment variables

**Solution:**

Verify all required variables in `.env`:
```env
BCONNECT_BASE_URL=https://bms-win22srv:444/bconnect
BCONNECT_USERNAME=Administrator
BCONNECT_PASSWORD=baramundi-2008
NODE_TLS_REJECT_UNAUTHORIZED=0
```

### MCP Server Not Visible in Claude

**Cause:** MCP configuration not loaded

**Solution:**

1. **Verify MCP configuration:**
   ```bash
   cat ~/.claude/mcp-config.json
   ```

2. **Should contain:**
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
           "NODE_TLS_REJECT_UNAUTHORIZED": "0"
         }
       }
     }
   }
   ```

3. **Restart Claude Code:**
   - Exit Claude Code
   - Restart application
   - MCP server should be listed in status bar

---

## MCP Tool Errors

### Error: "Tool not found: list_endpoints"

**Cause:** MCP server not properly initialized

**Solutions:**

1. **Rebuild MCP server:**
   ```bash
   cd /workspaces/claudinno/bConnect-MCP
   npm run build
   ```

2. **Restart Claude Code**

3. **Check server is running:**
   ```bash
   node build/index.js
   ```

### Error: "Invalid parameters for tool"

**Cause:** Incorrect parameter types or names

**Solutions:**

1. **Review USAGE-EXAMPLES.md for correct parameters**

2. **Check parameter types:**
   - GUIDs must be strings
   - PageSize must be number
   - Booleans must be true/false

3. **Use natural language:**
   - Let Claude handle parameter construction
   - Example: "List 50 endpoints" vs. manually constructing parameters

### Error: "Tool execution timeout"

**Cause:** Operation taking too long

**Solutions:**

1. **Increase timeout:**
   ```env
   BCONNECT_TIMEOUT=120000  # 2 minutes
   ```

2. **Use pagination:**
   - Reduce PageSize
   - Request fewer items per call

3. **Break into smaller operations:**
   - Instead of "List all 10,000 endpoints"
   - Use "List endpoints page by page"

---

## Performance Issues

### Slow API Responses

**Causes & Solutions:**

1. **Large datasets:**
   ```
   ❌ PageSize=1000 (slow)
   ✅ PageSize=50 (faster)
   ```

2. **Network latency:**
   - Check network connection
   - Use local network if possible

3. **Server load:**
   - Check BMS-WIN22SRV resource usage
   - Schedule heavy operations during off-peak hours

### High Memory Usage

**Causes & Solutions:**

1. **Large result sets:**
   - Use pagination
   - Process in batches

2. **Memory leaks:**
   - Restart MCP server periodically
   - Report to development team

### Frequent Timeouts

**Solutions:**

1. **Increase timeout globally:**
   ```env
   BCONNECT_TIMEOUT=60000
   ```

2. **Enable retry logic:**
   ```env
   BCONNECT_MAX_RETRIES=3
   BCONNECT_RETRY_DELAY=200
   ```

3. **Optimize queries:**
   - Use specific filters
   - Reduce result set size
   - Use pagination

---

## Documentation Search Issues

### Error: "No search results found" or Empty Results

**Cause:** Index not built, missing documentation files, or query too specific

**Solutions:**

1. **Check if documentation is indexed:**
   ```
   Ask Claude: "List all documentation sources"
   ```

   Expected: Should show 15,408+ documents indexed

2. **Rebuild the index:**
   ```bash
   # The index is built automatically on first search
   # Force rebuild by restarting MCP server
   ```

3. **Check documentation directory exists:**
   ```bash
   ls -la /workspaces/claudinno/docs.baramundi.com/
   ```

   Should contain:
   - `forum-content/` (13,065 threads)
   - `feedback/content/` (~1,500 items)
   - `release-notes/` (26 versions)
   - `preview_documents/` (4 PDFs)
   - `website/` (~457 pages)
   - `known-issues/` (~356 issues)

4. **Try broader search terms:**
   ```
   Too specific: "BitLocker recovery key extraction procedure v2.1"
   Better: "BitLocker recovery key"
   ```

5. **Check spelling and try alternative terms:**
   ```
   "deployment" vs "install" vs "rollout"
   ```

---

### Error: "Index build timeout" or Slow Index Building

**Cause:** Large dataset (15,408+ documents) taking longer than expected

**Solutions:**

1. **Increase timeout (if configurable):**
   - Default timeout: 60 seconds
   - Expected build time: 30-60 seconds for full dataset

2. **Check system resources:**
   ```bash
   # Monitor memory during index build
   top -b -n 1 | head -20
   ```

   Index requires: ~500MB memory

3. **Verify disk space:**
   ```bash
   df -h /workspaces/claudinno/docs.baramundi.com/
   ```

   Required: ~5GB for full documentation

4. **Check for corrupted files:**
   ```bash
   # Find files with unusual sizes
   find /workspaces/claudinno/docs.baramundi.com/ -type f -size +50M
   ```

---

### Error: "PDF parsing failed" or Preview Documents Not Indexed

**Cause:** Missing pdf-parse dependency or corrupted PDF files

**Solutions:**

1. **Verify pdf-parse is installed:**
   ```bash
   cd /workspaces/claudinno/bConnect-MCP
   npm list pdf-parse
   ```

   Should show: `pdf-parse@1.1.1`

2. **Reinstall pdf-parse if missing:**
   ```bash
   npm install pdf-parse@1.1.1
   npm run build
   ```

3. **Check PDF files exist:**
   ```bash
   ls -lh /workspaces/claudinno/docs.baramundi.com/preview_documents/
   ```

   Expected: 4 PDF files (Preview_bMS_*.pdf)

4. **Test PDF parsing manually:**
   ```bash
   node -e "const pdfParse = require('pdf-parse'); const fs = require('fs'); pdfParse(fs.readFileSync('/path/to/pdf')).then(d => console.log(d.text.slice(0, 100)));"
   ```

---

### Error: "Search returns irrelevant results"

**Cause:** Query matching unrelated terms, insufficient filtering

**Solutions:**

1. **Use more specific queries:**
   ```
   Vague: "error"
   Specific: "BitLocker recovery key error 0x80070057"
   ```

2. **Apply source filters:**
   ```
   "Search known issues for 'deployment timeout'"
   "Search forum for 'bConnect API authentication'"
   "Search release notes for 'new features 2025'"
   ```

3. **Use exact phrases with quotes:**
   ```
   Search for "Windows Update" (exact phrase)
   vs
   Search for Windows Update (separate terms)
   ```

4. **Filter by category:**
   ```
   "Search documentation in job-management category for 'scheduling'"
   ```

5. **Review result scores:**
   - Results are ranked by relevance score
   - Higher scores = better matches
   - First result isn't always the answer (review top 5-10)

---

### Error: "Document ID not found" or "Invalid document ID"

**Cause:** Using wrong document ID format or ID doesn't exist

**Solutions:**

1. **Verify document ID format:**
   ```
   Valid formats:
   - forum-{category}-{number}
   - feedback-kb-{number}
   - release-notes-{version}
   - preview-{version}
   - known-issue-{number}
   ```

2. **Get valid IDs from search results:**
   ```
   1. Search: "Search for BitLocker"
   2. Note the document ID in results
   3. Get document: "Show me document forum-baramundi-connect-12345"
   ```

3. **List available documents:**
   ```
   "List documentation sources"
   ```
   This shows total documents per source

---

### Performance: Slow Search (<100ms target)

**Cause:** Large result sets, complex queries, or memory pressure

**Solutions:**

1. **Reduce result limit:**
   ```
   "Search for 'deployment' limit 10 results"
   (default is 10, max is 100)
   ```

2. **Filter by source to narrow search:**
   ```
   "Search forum only for 'deployment'"
   ```

3. **Monitor memory usage:**
   ```bash
   # Index size in memory: ~500MB for 15,408 docs
   ps aux | grep node
   ```

4. **Restart MCP server if memory grows:**
   ```bash
   # Kill and restart MCP server
   pkill -f "node.*build/index.js"
   node build/index.js
   ```

---

### Error: "Search returns 0 results but documents exist"

**Cause:** Index not including specific source, or path mismatch

**Solutions:**

1. **Check index coverage:**
   ```
   "List documentation sources"
   ```

   Verify all sources show document counts:
   - Forum: 13,065+ threads
   - Feedback: 1,500+ items
   - Release Notes: 26 versions
   - Preview: 4 PDFs
   - Website: 457+ pages
   - Known Issues: 356+ issues

2. **Check if source has 0 documents:**
   - If any source shows 0 documents, there's a path issue
   - Verify directory structure matches expected paths

3. **Check directory permissions:**
   ```bash
   ls -la /workspaces/claudinno/docs.baramundi.com/
   ```

   All directories should be readable

4. **Rebuild index with verbose logging:**
   - Check MCP server logs during index build
   - Look for "Skipping..." or "Failed to load..." messages

---

### Documentation Search Best Practices

**Effective Troubleshooting:**

1. **Always check index first:**
   ```
   "List documentation sources"
   ```
   Confirms index is built and populated

2. **Start broad, then narrow:**
   ```
   1. "Search for deployment"
   2. Review results
   3. "Search forum for deployment automation"
   4. Get specific: "Show me forum-job-management-12345"
   ```

3. **Use known issues before deep troubleshooting:**
   ```
   "Search known issues for <your problem>"
   ```
   Saves time if it's a documented issue

4. **Check multiple sources:**
   ```
   "Search forum for X"
   "Search knowledge base for X"
   "Search known issues for X"
   ```

5. **Verify document content:**
   ```
   "Get full content of <doc-id>"
   ```
   Confirms the document actually contains relevant information

**Common Search Patterns:**

| Problem Type | Best Source | Example Query |
|--------------|-------------|---------------|
| Technical errors | Known Issues | "Search known issues for error 0x80070005" |
| How-to guides | Knowledge Base | "Search kb for 'configure BitLocker policy'" |
| Real-world solutions | Forum | "Search forum for 'deployment automation script'" |
| New features | Release Notes | "Search release notes for 'new in 2025'" |
| Upcoming features | Preview Docs | "Search preview for 'planned features'" |
| Product info | Website | "Search website for 'system requirements'" |

---

## Debugging Techniques

### Enable Verbose Logging

**Method 1: Add to `.env`:**
```env
DEBUG=*
LOG_LEVEL=debug
```

**Method 2: Run with debug flag:**
```bash
NODE_DEBUG=* node build/index.js
```

### Test API Directly

```bash
# Test authentication
curl -v -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"

# Save response to file
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1" \
  -o response.json

# Pretty print JSON
cat response.json | jq .
```

### Inspect MCP Tool Requests

**Add console.log to `src/index.ts`:**
```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.error(`Tool called: ${request.params.name}`);
  console.error(`Parameters:`, JSON.stringify(request.params.arguments, null, 2));
  // ... rest of handler
});
```

Rebuild: `npm run build`

### Test Connection Health

```bash
# Test with curl
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"

# Test with Node.js
node -e "
const https = require('https');
const auth = 'Basic ' + Buffer.from('Administrator:baramundi-2008').toString('base64');
https.get({
  hostname: 'bms-win22srv',
  port: 444,
  path: '/bconnect/endpoints/v2.0/Endpoints?PageSize=1',
  headers: { 'Authorization': auth },
  rejectUnauthorized: false
}, (res) => {
  console.log('Status:', res.statusCode);
  res.on('data', (d) => process.stdout.write(d));
});
"
```

### Monitor Network Traffic

```bash
# Install tcpdump
sudo apt-get install tcpdump

# Monitor traffic to BMS server
sudo tcpdump -i any host bms-win22srv and port 444 -A
```

### Check Server Logs

**On BMS-WIN22SRV:**
```powershell
# Windows Event Viewer
Get-EventLog -LogName Application -Source "baramundi*" -Newest 50

# baramundi logs
Get-Content "C:\ProgramData\baramundi\Logs\bConnect.log" -Tail 100
```

### Run Unit Tests

```bash
cd /workspaces/claudinno/bConnect-MCP

# Run all tests
npm test

# Run specific test
npm test -- src/__tests__/bconnect-client.test.ts

# Run with coverage
npm run test:coverage
```

### Validate OpenAPI Specs

```bash
# Download latest specs
./scripts/download-openapi-specs.sh

# Regenerate types
npx openapi-typescript openapi-specs/bConnect_Endpoints.json \
  -o src/generated/endpoints-types.ts

# Rebuild
npm run build
```

---

## Common Mistake Checklist

- [ ] ✅ `.env` file exists and is configured
- [ ] ✅ Credentials are correct (test with curl)
- [ ] ✅ BASE_URL is correct (includes port :444)
- [ ] ✅ NODE_TLS_REJECT_UNAUTHORIZED=0 is set
- [ ] ✅ MCP server is built (`npm run build`)
- [ ] ✅ Claude Code is configured with MCP server
- [ ] ✅ BMS-WIN22SRV is reachable (ping test)
- [ ] ✅ Port 444 is open (firewall rules)
- [ ] ✅ bConnect service is running
- [ ] ✅ Using valid GUIDs (UUID format)
- [ ] ✅ Parameters have correct types (number vs string)
- [ ] ✅ Retry logic is enabled for transient errors

---

## Getting Help

### Documentation

- **USAGE-EXAMPLES.md** - Usage examples for all 93 tools
- **API-INFO.md** - Complete API reference
- **README.md** - Project overview
- **DevelopmentGuideline.md** - Testing and development

### Logs

**MCP Server logs:**
```bash
# Logs go to stderr
node build/index.js 2> mcp-server.log
```

**Claude Code logs:**
- Check Claude Code console output
- Enable debug mode in Claude settings

### Support

- **baramundi API Documentation**: https://bms-win22srv:444/bconnect/docs/
- **baramundi Support**: https://www.baramundi.com/en/support/
- **GitHub Issues**: Report bugs and feature requests

---

**Last Updated:** 2025-10-16
**Version:** 1.0
**Coverage:** All 93 MCP tools across 10 API modules
