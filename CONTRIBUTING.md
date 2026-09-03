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

**The project targets bMS 26R1 only.** 25R2 support was dropped, along with the
`BCONNECT_RELEASE` environment variable and the release-conditional tool registration that went
with it. Do not add new release branching; if a route only exists from some future release on,
that is a version-bump conversation, not a runtime conditional.

Increment the patch segment for bug fixes and minor tool additions. Increment the minor segment
only when a new bMS release changes the API.

## Creating a New Server

The template (`bconnect-server-template/src/`) ships `index.ts`, `bconnect-client.ts`, and
`utils/mcp-tool-validation-rules.ts` — there is no `src/generated/`, `src/modules/`, or
`src/__tests__/` scaffold to copy from; you create those as part of the steps below.

1. Copy `bconnect-server-template/` to `bconnect-{domain}-mcp/`
2. Replace all occurrences of `DOMAIN` with the actual domain name
3. Add the new server to the `MANIFEST` in `scripts/generate-types.mjs`, then run
   `npm run generate`. Do **not** invoke `npx openapi-typescript` by hand: the MANIFEST is the
   only statement of which spec each generated file comes from, and
   `__tests__/generated-types-are-fresh.test.ts` fails on any `src/generated/*-types.ts` that
   the MANIFEST does not claim or that is not byte-identical to a fresh render.
   `openapi-specs/26R1/` is the only spec directory; the `25R2/` tree was deleted with 25R2
   support. Refresh the specs themselves with `npm run specs:download` against a 26R1 bMS —
   it finishes by running `npm run generate`, so specs and types cannot drift apart
4. Implement tool logic in `src/index.ts`, following an existing small server (e.g.
   `bconnect-operatingsystems-mcp`) as the reference — `src/modules/{domain}.ts` is not the
   primary pattern in production servers; where a server has a `modules/` directory (e.g.
   `bconnect-endpoints-mcp`), it holds only local composite additions layered on top of
   `index.ts`, not the whole tool surface
5. Register tools in `src/index.ts`
6. Add a tool-registration test (see an existing server's `src/__tests__/server.test.ts` for
   the pattern)
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

## The 26R1 Version Gate

Every server reads the bMS `version` from `GET /v2.0/ManagementServer` as part of the startup
connectivity check it already performs, and exits if the bMS is older than 26R1. Rules for anyone
touching that path:

- **Do not add a second round-trip.** The version comes out of the connectivity call that already
  runs.
- **Do not read the Windows registry for this.** The registry describes the machine the MCP
  server runs on, not the bMS it talks to, and the gateway runs in a Linux container where there
  is no registry at all.
- **An unparseable version is a warning, not a refusal.** Log what was received and continue. A
  false refusal is worse than no gate.
- **`BCONNECT_SKIP_CONNECTIVITY_CHECK=true` must skip the gate too** — it is the one escape
  hatch, and adding a second one would be a second thing to get wrong.

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

## Finding IDs, and the documents they point at

Comments and test headers throughout this suite cite identifiers like `SEC-5`,
`OPT-32`, `QA-57`, `P29.2`, `H1`, `D17`, and document names such as
`EVAL-2026-08-02.md`, `TOOL-REVIEW-MATRIX.md` and `HANDOFF.md`.

**Those documents are internal review records and are not part of this
repository.** They are the audit trail from the hardening work — per-tool
review matrices, adversarial review notes, session hand-offs — and they carry
identifiers from the live estate the work was measured against, which is why
they are not published.

The citations are kept anyway, deliberately. Each one marks a change that was
made for a *measured* reason rather than a stylistic one, and the surrounding
comment always states that reason in full. You should never need the internal
document to understand the code:

```ts
// PER-18: the fallback still asks for one row via `PageSize: 1`, the paging
// parameter the API actually reads (`$top` is OData and is ignored).
```

The ID tells you this was a finding with a history; the sentence tells you what
the finding was. If you meet a citation whose comment does *not* explain itself,
that is a documentation bug worth raising — the ID is provenance, never the
explanation.

**When adding a finding ID**, write the reason beside it in the same comment. A
future reader will have the code and not the archive.
