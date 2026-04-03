# Quick Start

Get the bConnect MCP Server running in 5 minutes.

## Prerequisites

- Node.js 20.x (already in DevContainer)
- Access to BMS-WIN22SRV

## 1. Setup

```bash
cd /workspaces/claudinno/bConnect-MCP
npm install && npm run build
```

## 2. Test

```bash
npm test  # 390 tests (374 passing, 16 skipped)
npm run inspector  # Interactive testing
```

## 3. Use with Claude

Already configured. Ask Claude:

```
# Read Operations
List all Windows endpoints
Show job definitions
Get asset inventory
List AD groups

# Write Operations
Create a Windows endpoint named "WIN-SERVER-001"
Start a job instance
Create a variable definition for "Floor"
```

## Available Tools

**94 MCP tools across 10 API modules (48 read + 46 write):**

- **Endpoints** (38 tools: 10 read + 28 write)
- **Jobs** (19 tools: 5 read + 14 write)
- **Assets** (20 tools: 9 read + 11 write)
- **Server Management** (18 tools: 6 read + 12 write)
- **Active Directory** (10 tools: read-only)
- **Defense Control** (8 tools: 6 read + 2 write)
- **Variables** (11 tools: 7 read + 4 write)
- **Operating Systems** (7 tools: 3 read + 4 write)
- **Software** (4 tools: read-only)
- **Update Management** (3 tools: 2 read + 1 write)

## Configuration

Already set in `.env`:

```env
BCONNECT_BASE_URL=https://bms-win22srv:444/bconnect
BCONNECT_USERNAME=Administrator
BCONNECT_PASSWORD=baramundi-2008
NODE_TLS_REJECT_UNAUTHORIZED=0
```

## Troubleshooting

### Connection Error

```bash
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
```

### Build Error

```bash
rm -rf build/ node_modules/
npm install && npm run build
```

## Next Steps

- **USAGE-EXAMPLES.md** - Usage examples for all 94 tools
- **TROUBLESHOOTING.md** - Fix common errors
- **README.md** - Complete documentation
- **DEPLOYMENT.md** - Multi-machine setup
- **API-INFO.md** - API reference
- **TEST-EXECUTION-SUMMARY.md** - Latest test results

## Quick Commands

```bash
npm test              # Run all 390 tests (374 passing, 16 skipped)
npm run test:coverage # View coverage (86.35%)
npm run test:watch    # Watch mode for development
npm run inspector     # Interactive testing
npm run build         # Build TypeScript
```

---

**Time Required:** 5 minutes to build and test
**Status:** All 3 implementation phases complete (79 write operations)
