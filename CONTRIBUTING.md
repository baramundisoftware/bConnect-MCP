# Contributing to bConnect-MCP

## Server Naming Convention

Each MCP server follows the pattern `bconnect-{domain}-mcp`, where `{domain}` matches the
OpenAPI spec file name (without extension, lowercase). Examples:

- `assets.json` → `bconnect-assets-mcp`
- `activedirectory.json` → `bconnect-activedirectory-mcp`
- `universaldynamicgroups.json` → `bconnect-universaldynamicgroups-mcp`

## Version Scheme

Package versions follow **baramundi Management Suite year.release.patch** format:

| bMS Release | Package version |
|---|---|
| baramundi 26R1 | `26.1.x` |
| baramundi 25R2 | `25.2.x` |

Increment the patch segment for bug fixes and minor tool additions. Increment the minor segment
only when a new bMS release changes the API.

## Creating a New Server

1. Copy `bconnect-server-template/` to `bconnect-{domain}-mcp/`
2. Replace all occurrences of `DOMAIN` with the actual domain name
3. Copy the generated types file from `openapi-specs/` generation output into `src/generated/`
4. Implement the module class in `src/modules/{domain}.ts`
5. Register tools in `src/index.ts`
6. Add an isolation test in `src/__tests__/isolation.test.ts`
7. Run `npm install && npm run build` — must succeed with zero errors

## Shared Infrastructure Propagation

The following files are **replicated** across all servers. When a bug is fixed or a feature is
added to any of them, the change must be propagated to all 13 servers:

| File | Description |
|---|---|
| `src/bconnect-client.ts` | Axios HTTP client, auth, retry, rate limiting, caching |
| `src/utils/parameter-validator.ts` | Input validation framework |
| `src/utils/rate-limiter.ts` | Token bucket rate limiter |
| `src/utils/audit-logger.ts` | Configurable audit logger |
| `src/utils/response-cache.ts` | LRU response cache with TTL |
| `src/utils/batch-operations.ts` | Concurrent batch execution with backoff |

**Protocol**: when you change a shared file, open a PR that updates the file in
`bconnect-server-template/` and all affected servers simultaneously. Do not merge partial
propagation.

## 26R1-Only Servers

`bconnect-compliance-mcp` and `bconnect-universaldynamicgroups-mcp` only exist in bMS 26R1.
Their `src/index.ts` must check `BCONNECT_RELEASE` at startup and exit with a clear error
message if `25R2` is set.

## Tool Count Accountability

No tool from the original monolith (`src/modules/`) may be dropped or duplicated. Each
OpenAPI spec file maps to exactly one `bconnect-<domain>-mcp` server (the file-based split);
the server table in the root `README.md` lists every server and its tool count.

## Type Safety

- All request/response types must come from `src/generated/{domain}-types.ts`
- Types are generated from the OpenAPI spec via `openapi-typescript`
- Never write types manually that can be generated
- `any` is not permitted except in `checkServerIdentity` (TLS override, documented)

## Testing

Each server requires:
- An isolation test (`src/__tests__/isolation.test.ts`) verifying the server starts, lists tools,
  and handles an unknown tool gracefully — no live API required
- `npm run build` succeeds with zero TypeScript errors
- `npm test` passes with zero failures
