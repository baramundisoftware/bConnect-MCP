# bConnect MCP Suite

Model Context Protocol (MCP) servers for the [baramundi](https://www.baramundi.com) bConnect REST API. Provides 212 tools across 12 domain-specific servers — covering endpoint management, job automation, compliance, software inventory, server management, and more.

## Servers

| Server | Tools | 25R2 | 26R1 | Domain |
|--------|-------|------|------|--------|
| [bconnect-endpoints-mcp](bconnect-endpoints-mcp/) | 47 | ✅ | ✅ | Windows/Linux/Mac/Android/iOS/Industrial/Network endpoints + logical groups + maintenance windows |
| [bconnect-servermanagement-mcp](bconnect-servermanagement-mcp/) | 30 | ✅ | ✅ | Management server, microservices, security groups, API keys, MSW cleanup |
| [bconnect-software-mcp](bconnect-software-mcp/) | 19 | ✅ | ✅ | Installed software inventory, software bundles |
| [bconnect-assets-mcp](bconnect-assets-mcp/) | 26 | ✅ | ✅ | Asset inventory, asset types, stock folders |
| [bconnect-jobs-mcp](bconnect-jobs-mcp/) | 24 | ✅ | ✅ | Job definitions, instances, folders, group assignments, kiosk releases |
| [bconnect-activedirectory-mcp](bconnect-activedirectory-mcp/) | 16 | ✅ | ✅ | AD groups, users, objects, organizational units |
| [bconnect-variables-mcp](bconnect-variables-mcp/) | 13 | ✅ | ✅ | Variable definitions and instances |
| [bconnect-defensecontrol-mcp](bconnect-defensecontrol-mcp/) | 13 | ✅ | ✅ | BitLocker, local admin accounts, Defender threats |
| [bconnect-operatingsystems-mcp](bconnect-operatingsystems-mcp/) | 9 | ✅ | ✅ | OS deployment folders and profiles |
| [bconnect-compliance-mcp](bconnect-compliance-mcp/) | 8 | ❌ | ✅ | Compliance violations, CVE vulnerabilities, mobile device rules |
| [bconnect-universaldynamicgroups-mcp](bconnect-universaldynamicgroups-mcp/) | 6 | ❌ | ✅ | Universal Dynamic Group definitions and folders |
| [bconnect-updatemanagement-mcp](bconnect-updatemanagement-mcp/) | 3 | ✅ | ✅ | Windows Update management configuration |
| **Total** | **212** | **10 servers** | **12 servers** | |

> `bconnect-compliance-mcp` and `bconnect-universaldynamicgroups-mcp` require **baramundi 26R1** or later.

## Architecture

Each server is an independent Node.js process communicating over stdio using the MCP protocol. Servers share no state — each connects directly to the bConnect REST API using HTTP Basic Auth.

```
Claude / MCP Client
    │
    ├── bconnect-endpoints-mcp              → /api/v2.0/Endpoints/*
    ├── bconnect-jobs-mcp                   → /api/v2.0/Jobs/*
    ├── bconnect-assets-mcp                 → /api/v2.0/Assets/*
    ├── bconnect-activedirectory-mcp        → /api/v2.0/ActiveDirectory/*
    ├── bconnect-servermanagement-mcp       → /api/v2.0/ServerManagement/*
    ├── bconnect-software-mcp               → /api/v2.0/Software/*
    ├── bconnect-variables-mcp              → /api/v2.0/Variables/*
    ├── bconnect-defensecontrol-mcp         → /api/v2.0/DefenseControl/*
    ├── bconnect-operatingsystems-mcp       → /api/v2.0/OperatingSystems/*
    ├── bconnect-compliance-mcp             → /api/v2.0/Compliance/*         (26R1+)
    ├── bconnect-universaldynamicgroups-mcp → /api/v2.0/UniversalDynamicGroups/*  (26R1+)
    └── bconnect-updatemanagement-mcp       → /api/v2.0/UpdateManagement/*
```

## Quick Start

### Prerequisites

- Node.js 20+
- baramundi Management Suite with bConnect enabled
- bConnect credentials (username + password)

### Install and build a server

```bash
cd bconnect-endpoints-mcp
npm install
npm run build
```

### Run

```bash
BCONNECT_BASE_URL=https://your-bms.example.com/bconnect \
BCONNECT_USERNAME=your-username \
BCONNECT_PASSWORD=your-password \
node build/index.js
```

## Configuration

All servers share the same environment variable schema:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | ✅ | — | Base URL of the bConnect API (e.g. `https://bms.example.com/bconnect`) |
| `BCONNECT_USERNAME` | ✅ | — | bConnect username |
| `BCONNECT_PASSWORD` | ✅ | — | bConnect password |
| `BCONNECT_CA_CERT_PATH` | — | — | Path to a PEM CA certificate for TLS verification |
| `BCONNECT_RELEASE` | — | `26R1` | bMS release version: `25R2` or `26R1` |
| `BCONNECT_RATE_LIMIT_ENABLED` | — | `false` | Enable token-bucket rate limiting |
| `BCONNECT_RATE_LIMIT_MAX_REQUESTS` | — | `100` | Max requests per rate limit window |
| `BCONNECT_RATE_LIMIT_WINDOW_MS` | — | `60000` | Rate limit window in milliseconds |
| `BCONNECT_AUDIT_LEVEL` | — | `none` | Audit logging: `none` \| `info` \| `verbose` |

> **TLS**: Use `BCONNECT_CA_CERT_PATH` for self-signed or internal CA certificates. `NODE_TLS_REJECT_UNAUTHORIZED=0` is for development only — never use in production.

### Connecting to baramundi 25R2

Set `BCONNECT_RELEASE=25R2` to restrict to 25R2-compatible tools. The two 26R1-only servers will refuse to start with this setting:

```env
BCONNECT_RELEASE=25R2
```

## Claude Desktop Integration

Add servers to `claude_desktop_config.json`. Example with all 12 servers:

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "command": "node",
      "args": ["/path/to/bconnect-endpoints-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password"
      }
    },
    "bconnect-jobs": {
      "command": "node",
      "args": ["/path/to/bconnect-jobs-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password"
      }
    },
    "bconnect-assets": {
      "command": "node",
      "args": ["/path/to/bconnect-assets-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password"
      }
    },
    "bconnect-activedirectory": {
      "command": "node",
      "args": ["/path/to/bconnect-activedirectory-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password"
      }
    },
    "bconnect-servermanagement": {
      "command": "node",
      "args": ["/path/to/bconnect-servermanagement-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password",
        "BCONNECT_AUDIT_LEVEL": "info"
      }
    },
    "bconnect-software": {
      "command": "node",
      "args": ["/path/to/bconnect-software-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password"
      }
    },
    "bconnect-variables": {
      "command": "node",
      "args": ["/path/to/bconnect-variables-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password"
      }
    },
    "bconnect-defensecontrol": {
      "command": "node",
      "args": ["/path/to/bconnect-defensecontrol-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password",
        "BCONNECT_AUDIT_LEVEL": "info"
      }
    },
    "bconnect-operatingsystems": {
      "command": "node",
      "args": ["/path/to/bconnect-operatingsystems-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password"
      }
    },
    "bconnect-compliance": {
      "command": "node",
      "args": ["/path/to/bconnect-compliance-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password"
      }
    },
    "bconnect-universaldynamicgroups": {
      "command": "node",
      "args": ["/path/to/bconnect-universaldynamicgroups-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password"
      }
    },
    "bconnect-updatemanagement": {
      "command": "node",
      "args": ["/path/to/bconnect-updatemanagement-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://your-bms.example.com/bconnect",
        "BCONNECT_USERNAME": "your-username",
        "BCONNECT_PASSWORD": "your-password"
      }
    }
  }
}
```

## Build All Servers

```bash
for dir in bconnect-*-mcp; do
  echo "Building $dir..."
  (cd "$dir" && npm install && npm run build)
done
```

## Testing

Each server has its own test suite:

```bash
# Test a single server
cd bconnect-endpoints-mcp && npm test

# Test all servers
for dir in bconnect-*-mcp; do
  (cd "$dir" && npm test)
done
```

## Shared Infrastructure

All servers include the same production-hardened shared utilities:

| File | Description |
|------|-------------|
| `src/bconnect-client.ts` | Axios HTTP client with auth, retry, and error handling |
| `src/utils/parameter-validator.ts` | Input validation framework |
| `src/utils/rate-limiter.ts` | Token bucket rate limiter |
| `src/utils/audit-logger.ts` | Configurable audit logger |
| `src/utils/response-cache.ts` | LRU response cache with TTL |
| `src/utils/batch-operations.ts` | Concurrent batch execution with backoff |

See [CONTRIBUTING.md](CONTRIBUTING.md) for propagation rules when modifying shared files.

## Security

- Credentials are read from environment variables — never hardcode them.
- Use `BCONNECT_CA_CERT_PATH` for internal CA certificates instead of disabling TLS.
- Set `BCONNECT_AUDIT_LEVEL=info` on write-capable servers (`servermanagement`, `defensecontrol`) in production.
- Enable `BCONNECT_RATE_LIMIT_ENABLED=true` in production to protect the bConnect API.
- `get_bitlocker_secrets` is always audit-logged regardless of audit level setting.

## Troubleshooting

**Connection refused / ECONNREFUSED**
Verify `BCONNECT_BASE_URL` includes the `/bconnect` path prefix and the API is reachable from the host.

**TLS certificate errors**
Set `BCONNECT_CA_CERT_PATH` to your CA certificate file. `NODE_TLS_REJECT_UNAUTHORIZED=0` is dev-only.

**401 Unauthorized**
Check `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. Confirm the user has bConnect API access.

**Tool not available / 404 errors**
Verify `BCONNECT_RELEASE` matches your bMS version. 26R1-only tools fail when `BCONNECT_RELEASE=25R2`.

**compliance / universaldynamicgroups servers won't start**
Remove them from your config when running against a 25R2 bMS instance.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See [LICENSE](LICENSE).
