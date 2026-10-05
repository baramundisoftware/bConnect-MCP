# Contributing to bConnect-MCP

Thank you for helping. This page says how changes get in, and what a change to a server has
to include.

## How a change gets in

1. **Start with an issue.** Describe the bug (bug report template) or the change (change
   proposal template). A maintainer accepts it or explains why not. Typo and small doc fixes
   don't need an issue.
2. **One topic per pull request, roughly 400 changed lines or fewer** (generated files
   excluded). Larger work is split into several PRs, as agreed in the issue.
3. **CI must be green.** `main` requires the four `build + test` checks (Linux and Windows,
   Node.js 22.15 and 24) on the PR's latest commit, the branch up to date with `main`, one
   approving review after the last push, and all review threads resolved. Repository admins
   can merge a pull request without the review; nobody can push to `main` directly.
4. **Security issues are never reported in a public issue or PR.** Use GitHub's private
   vulnerability reporting (see [SECURITY.md](SECURITY.md)).

Contributions are licensed under the repository's [MIT License](LICENSE).

## Build and test

Node.js 22.15 or 24 (the versions CI tests). On Windows, make Git Bash npm's script shell
first, see [README.md](README.md#getting-started-step-by-step).

```bash
npm ci
npm run build                         # the shared core, then the 13 servers and the template
npm test                              # unit tests and the suite-wide guards
npm run lint
```

After a change in `packages/mcp-core`, run `npm run build` again: the server tests run against
the servers' last build, and the live tier refuses an outdated one.

## Server Naming Convention

Each MCP server follows the pattern `bconnect-{domain}-mcp`, where `{domain}` matches the
OpenAPI spec file name (without extension, lowercase). Examples:

- `assets.json` → `bconnect-assets-mcp`
- `activedirectory.json` → `bconnect-activedirectory-mcp`
- `universaldynamicgroups.json` → `bconnect-universaldynamicgroups-mcp`

## Version Scheme

Versions are `26.1.x`: `26.1` for the API generation (baramundi Management Suite 2026 R1), `x`
for each release of this project. One release line supports both bMS 2026 R1 and 2025 R2;
`BCONNECT_RELEASE` selects which. There is no separate 25.2.x line.

## Creating a New Server

1. Copy `bconnect-server-template/` to `bconnect-{domain}-mcp/` and replace `DOMAIN`.
2. Add the server to the `workspaces` list in the root `package.json` (each server is listed
   by name).
3. Generate the request/response types from the OpenAPI spec into `src/generated/`.
4. Implement the module class in `src/modules/{domain}.ts` and register the tools in
   `src/index.ts` (steps at the top of the template's `src/index.ts`).
5. Bind each tool to its API operation in `src/operations.ts`; the spec-conformance guard
   checks every route, parameter and body against the spec.
6. Generate `src/query-params.ts` with `node scripts/generate-query-parameters.mjs`.
7. Register the server in `bconnect-mcp-gateway/src/app.ts` and add it as a `file:` dependency
   in `bconnect-mcp-gateway/package.json`.
8. Add tests (`src/__tests__/server.test.ts`, a `vitest.config.ts`), the README with its
   environment table and tool table (both checked by tests), and a `.env.example`.
9. Build and test from the repo root as above.

## Shared Infrastructure (`@bconnect/mcp-core`)

Shared logic is **not** copy-pasted across servers. It lives once in the workspace package
[`packages/mcp-core`](packages/mcp-core) (`@bconnect/mcp-core`), and every server imports it:

| Concern | Location |
|---|---|
| `BConnectClientBase`: HTTP client, auth, retries, timeouts, audit, path and secret-route checks | `@bconnect/mcp-core` |
| Configuration (`clientConfigFromEnv`), argument validation, error results, response cleaning | `@bconnect/mcp-core` |
| Per-server tool validation rules (`src/utils/mcp-tool-validation-rules.ts`) | each server (domain-specific) |

Fix shared logic **once** in `packages/mcp-core`; every server picks it up through the npm
workspace. `scripts/ci-local.sh` also runs a jscpd duplication check (not part of GitHub CI).

> `bconnect-mcp-gateway` is a standalone project (not a workspace member); it depends on the
> servers and `@bconnect/mcp-core` via `file:` references.

## 26R1-Only Servers

`bconnect-compliance-mcp` and `bconnect-universaldynamicgroups-mcp` cover APIs that only exist
in bMS 2026 R1. On a 25R2 bMS their startup check fails, and with `BCONNECT_RELEASE=25R2`
universaldynamicgroups offers no tools. Tools that exist only in 26R1 in other servers are
hidden when `BCONNECT_RELEASE=25R2` and marked **(26R1)** in the server's README.

## Tool Count Accountability

The server table in the root `README.md` lists every server and its tool counts, and each
server's README lists every tool; tests compare both with the servers' real tool lists.

## Type Safety

- All request/response types must come from `src/generated/{domain}-types.ts`
- Types are generated from the OpenAPI spec via `openapi-typescript`
- Never write types manually that can be generated
- Avoid `any`. The few existing uses carry an `eslint-disable` comment with the reason.
- No `as never` or `as unknown as T` casts in server or core source: they switch off the
  generated types, so a wrong request body compiles. `npm run lint` fails on a new one.
  Older casts are listed in `eslint-suppressions.json`; when you remove one, run
  `npm run lint:prune-casts` and commit the updated file

## Testing

Each server requires:
- A tool-registration test (`src/__tests__/server.test.ts`) verifying `listTools()` returns
  exactly that server's tools and excludes other domains — no live API required
- `npm run build` succeeds with zero TypeScript errors
- `npm run lint` passes with zero errors and zero warnings
- `npm test` passes with zero failures

Optional tiers run by hand: the mock tier against bConnect-Mock
([docs/MOCK_INTEGRATION_TESTING.md](docs/MOCK_INTEGRATION_TESTING.md)) and the read-only live
tier against a real bMS ([docs/LIVE_BMS_TESTING.md](docs/LIVE_BMS_TESTING.md)).
