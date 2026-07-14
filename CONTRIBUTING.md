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
6. Add a tool-registration test in `src/__tests__/server.test.ts`
7. Run `npm ci && npm run build` from the repo root — must succeed with zero errors

## Shared Infrastructure (`@bconnect/mcp-core`)

Shared logic is **not** copy-pasted across servers. It lives once in the workspace package
[`packages/mcp-core`](packages/mcp-core) (`@bconnect/mcp-core`), and every server imports it:

| Concern | Location |
|---|---|
| `BConnectClientBase` — axios HTTP client, auth, retry, rate limiting, caching | `@bconnect/mcp-core` |
| Input validation (`parameter-validator`), rate limiter, audit logger, response cache, batch operations | `@bconnect/mcp-core` |
| Per-server tool validation rules (`src/utils/mcp-tool-validation-rules.ts`) | each server (domain-specific) |

**Protocol:** fix shared logic **once** in `packages/mcp-core`; every server picks it up through
the npm workspace. A CI **jscpd duplication guard** fails the build if client/util code is
copy-pasted back into a server, so partial/divergent copies cannot land.

> `bconnect-mcp-gateway` is a standalone project (not a workspace member); it depends on the
> servers and `@bconnect/mcp-core` via `file:` references.

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
- A tool-registration test (`src/__tests__/server.test.ts`) verifying `listTools()` returns
  exactly that server's tools and excludes other domains — no live API required
- `npm run build` succeeds with zero TypeScript errors
- `npm test` passes with zero failures
