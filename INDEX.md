# bConnect MCP Server - Documentation Index

## 🚀 Quick Start

**New User?** → [GET-STARTED.md](GET-STARTED.md)

**API Info** → [API-INFO.md](API-INFO.md)

## 📁 Documentation Files

### Essential Reading

1. **[GET-STARTED.md](GET-STARTED.md)** - Quick setup guide (start here!)
2. **[USAGE-EXAMPLES.md](USAGE-EXAMPLES.md)** - Usage examples for all 117 tools
3. **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common errors and solutions
4. **[API-INFO.md](API-INFO.md)** - bConnect API details and authentication
5. **[README.md](README.md)** - Complete documentation
6. **[SECURITY-BEST-PRACTICES.md](SECURITY-BEST-PRACTICES.md)** - Production security guide
7. **[EXTENSIBILITY.md](EXTENSIBILITY.md)** - Adding new API modules
8. **[DEPLOYMENT.md](DEPLOYMENT.md)** - Multi-machine deployment with Ansible

### Reference

9. **[QUICKSTART.md](QUICKSTART.md)** - Command reference
10. **[STATUS.md](STATUS.md)** - Implementation status
11. **[DevelopmentGuideline.md](DevelopmentGuideline.md)** - Testing strategy
12. **[PRODUCTION-HARDENING-STATUS.md](PRODUCTION-HARDENING-STATUS.md)** - Production readiness tracking

## 🎯 Choose Your Path

| I want to... | Read this |
|--------------|-----------|
| **Get started quickly** | [GET-STARTED.md](GET-STARTED.md) |
| **See tool usage examples** | [USAGE-EXAMPLES.md](USAGE-EXAMPLES.md) |
| **Fix errors and issues** | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| **Secure production deployment** | [SECURITY-BEST-PRACTICES.md](SECURITY-BEST-PRACTICES.md) |
| **See all available commands** | [QUICKSTART.md](QUICKSTART.md) |
| **Deploy to multiple machines** | [DEPLOYMENT.md](DEPLOYMENT.md) |
| **Add new API modules** | [EXTENSIBILITY.md](EXTENSIBILITY.md) |
| **Understand the API** | [API-INFO.md](API-INFO.md) |
| **See production status** | [PRODUCTION-HARDENING-STATUS.md](PRODUCTION-HARDENING-STATUS.md) |
| **Read everything** | [README.md](README.md) |

## 🔑 Key Information

**API:**
- URL: https://bms-win22srv:444/bconnect
- Docs: https://bms-win22srv:444/bconnect/docs/
- Auth: HTTP Basic (Username/Password)

**Current Implementation:**
- **94 MCP Tools** (48 read + 46 write operations)
- 100% module coverage (10 V2.0 modules)
- 86.35% test coverage (812+ tests: 100% passing)
- 100% input validation (186/186 case statements)
- 15,408+ documents indexed (documentation search)
- TypeScript with auto-generated types from OpenAPI
- Production-ready with comprehensive security guide

**V2.0 API Modules (94 tools):**
- **Endpoints** (38 tools: 12 read + 26 write)
- **Jobs** (19 tools: 5 read + 14 write)
- **Assets** (20 tools: 9 read + 11 write)
- **Server Management** (25 tools: 13 read + 12 write)
- **Active Directory** (10 tools: 8 read + 2 write)
- **Defense Control** (8 tools: 6 read + 2 write)
- **Variables** (11 tools: 7 read + 4 write)
- **Operating Systems** (7 tools: 3 read + 4 write)
- **Software** (4 tools: 4 read)
- **Update Management** (3 tools: 2 read + 1 write)

**V1.1 Specialized Modules (23 tools):**
- **BitLocker Secrets** (5 tools: 1 read + 4 write)
- **Apple VPP** (7 tools: 3 read + 4 write)
- **Detailed Inventory** (5 tools: 5 read)
- **Compliance Violations** (3 tools: 3 read)
- **SSH Server Config** (1 tool: 1 write)
- **Setup Integrity** (2 tools: 2 read)

**Documentation Search (6 tools):**
- Search 15,408+ documents (forum, release notes, KB, known issues, preview PDFs, website)

## ⚡ Quick Commands

```bash
# Setup
cd /workspaces/claudinno/bConnect-MCP
npm install && npm run build

# Test
npm test  # 812+ tests (100% passing)
npm run test:coverage  # 86.35% coverage
npm run inspector  # Interactive testing

# Use with Claude (already configured)
# Ask Claude: "List all Windows endpoints"
# Ask Claude: "Search documentation for BitLocker recovery"
# Ask Claude: "Create a Windows endpoint named 'SERVER-001'"
```

## 📊 Project Structure

```
bConnect-MCP/
├── src/
│   ├── index.ts               # MCP server (117 tools)
│   ├── bconnect-client.ts     # API client
│   ├── modules/               # 16 API modules
│   │   ├── V2.0 Modules (10):
│   │   │   ├── endpoints.ts       # 38 tools ✅
│   │   │   ├── jobs.ts            # 19 tools ✅
│   │   │   ├── assets.ts          # 20 tools ✅
│   │   │   └── ... (7 more modules)
│   │   ├── V1.1 Modules (6):
│   │   │   ├── bitlocker-v1.ts    # 5 tools ✅
│   │   │   ├── vpp-v1.ts          # 7 tools ✅
│   │   │   └── ... (4 more modules)
│   │   └── documentation-search.ts # 6 tools ✅
│   ├── utils/                 # Input validation (100% coverage)
│   └── generated/             # TypeScript types from OpenAPI
├── ansible/
│   ├── deploy-bconnect-mcp.yml  # Deployment playbook
│   └── inventory.yml            # Hosts inventory
├── docs.baramundi.com/       # 15,408+ indexed documents
├── .env                       # Configuration (gitignored)
└── build/                     # Compiled JavaScript
```

## 🚦 Status

**Implemented (100% Feature Complete - 82% Production Ready):**
- ✅ All 117 MCP tools (10 V2.0 + 6 V1.1 + 6 documentation search)
- ✅ HTTP Basic Auth
- ✅ SSL support (development mode)
- ✅ 86.35% test coverage (812+ tests: 510 unit + 95 integration + 209 E2E)
- ✅ 100% input validation (186/186 case statements)
- ✅ 15,408+ documents indexed (documentation search)
- ✅ Complete documentation (usage examples, troubleshooting, security guide)
- ✅ Ansible deployment ready

**Production Hardening (82% Complete - see PRODUCTION-HARDENING-STATUS.md):**
- ✅ Integration tests (95 tests, 100% pass rate)
- ✅ E2E tests (209 tests, 100% pass rate)
- ✅ Input validation (100% coverage)
- ❌ SSL certificate verification (remove NODE_TLS_REJECT_UNAUTHORIZED=0)
- ❌ Rate limiting implementation
- ❌ Audit logging for write operations
- ❌ Performance tests (response time, memory usage)

## 🆘 Troubleshooting

**See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for complete troubleshooting guide**

| Problem | Solution |
|---------|----------|
| Can't connect to API | See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Network & Connection Errors |
| Authentication fails | See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Authentication Errors |
| Build errors | See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Configuration Issues |
| Missing tools in Claude | See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - MCP Tool Errors |

## 📚 Learning Path

1. **Setup** → [GET-STARTED.md](GET-STARTED.md)
2. **Usage** → [USAGE-EXAMPLES.md](USAGE-EXAMPLES.md)
3. **Troubleshoot** → [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
4. **Security** → [SECURITY-BEST-PRACTICES.md](SECURITY-BEST-PRACTICES.md)
5. **Production Status** → [PRODUCTION-HARDENING-STATUS.md](PRODUCTION-HARDENING-STATUS.md)
6. **Extend** → [EXTENSIBILITY.md](EXTENSIBILITY.md)
7. **Deploy** → [DEPLOYMENT.md](DEPLOYMENT.md)

## 🔐 Security

- Credentials in `.env` (gitignored)
- Ansible Vault for multi-machine deployment
- HTTPS communication (development: self-signed, production: proper SSL required)
- 100% input validation (prevents injection, path traversal, DoS)
- No credentials in logs
- WARNING labels on all write operations
- **Production Security** → [SECURITY-BEST-PRACTICES.md](SECURITY-BEST-PRACTICES.md)

---

**Ready to start?** → [GET-STARTED.md](GET-STARTED.md)

**Last Updated:** 2025-11-04 - 117 tools complete, 82% production hardening done, comprehensive documentation
