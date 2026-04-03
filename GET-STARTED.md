# Getting Started

## What You Have

A working MCP server connecting Claude to baramundi bConnect API:
- **API**: https://bms-win22srv:444/bconnect
- **Docs**: https://bms-win22srv:444/bconnect/docs/

## Quick Start (5 Minutes)

### 1. Configuration

The MCP server is already configured in your DevContainer. Check `.env`:

```bash
cd /workspaces/claudinno/bConnect-MCP
cat .env
```

Should contain:
```
BCONNECT_BASE_URL=https://bms-win22srv:444/bconnect
BCONNECT_USERNAME=Administrator
BCONNECT_PASSWORD=baramundi-2008
NODE_TLS_REJECT_UNAUTHORIZED=0
```

### 2. Build

```bash
npm install
npm run build
```

### 3. Test

```bash
# Test with MCP Inspector
npm run inspector

# In the inspector, try:
# - list_endpoints
# - list_logical_groups
```

### 4. Use with Claude

The MCP server is already configured in Claude Code. Just ask:

```
List all endpoints in baramundi
Show me Windows endpoints
Get details for endpoint <id>
```

## Troubleshooting

### Cannot Connect to API

```bash
# Test connectivity
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"

# Check:
ping bms-win22srv
```

### Authentication Failed

```bash
# Verify credentials
cat .env | grep BCONNECT

# Test manually
curl -k -u "Administrator:baramundi-2008" \
  https://bms-win22srv:444/bconnect/docs/
```

### Build Errors

```bash
# Check Node.js version (need 20.x)
node --version

# Clean and rebuild
rm -rf node_modules build
npm install
npm run build
```

## Available Tools

**94 MCP tools across 10 API modules** (see `npm run inspector`):

- **Endpoints API** (10 tools) - List/search/manage endpoints
- **Jobs API** (5 tools) - Job definitions and execution history
- **Assets API** (13 tools) - Asset management and inventory
- **Active Directory API** (16 tools) - AD groups, users, OUs
- **Software API** (4 tools) - Software inventory
- **Update Management API** (2 tools) - Windows updates and profiles
- **Defense Control API** (10 tools) - BitLocker, threats, local admins
- **Variables API** (9 tools) - Variable definitions and instances
- **Operating Systems API** (5 tools) - OS folders and deployment
- **Server Management API** (13 tools) - Server info, microservices, security

## Next Steps

### Extend Functionality

All 10 API modules are implemented. See Tasks.md backlog for:
- Write operations (CREATE/UPDATE/DELETE)
- Mobile endpoints (Android/iOS)
- Dynamic groups and maintenance windows

### Deploy to Other Machines

See DEPLOYMENT.md for Ansible deployment.

### Explore the API

Visit https://bms-win22srv:444/bconnect/docs/ to see all available endpoints.

## Documentation

- **GET-STARTED.md** (this file) - Quick setup
- **README.md** - Complete documentation
- **API-INFO.md** - bConnect API details
- **EXTENSIBILITY.md** - Adding new modules
- **DEPLOYMENT.md** - Multi-machine deployment

## Success Checklist

- [ ] `.env` file configured
- [ ] Project built successfully (`npm run build`)
- [ ] Server tested with inspector (`npm run inspector`)
- [ ] Successfully queried endpoints via Claude

## Time Required

- **Setup**: 5 minutes (already done in DevContainer)
- **Build & Test**: 5 minutes
- **Total**: ~10 minutes
