# Mock-Integration Test Tier

A per-server tier that exercises the production `BConnectClient` HTTP path
against a running bConnect mock, over a real socket.

It catches the class of bug the unit tier cannot see: wrong REST URLs, missing
path segments, wrong HTTP methods, mistaken query shapes. The
`list_detected_vulnerabilities_for_endpoint` URL bug fixed in P29.2 (commit
`3f73e24`) is the canonical example. Since 2026-08-22 it also covers what
happens when the server on the other end **misbehaves** — see *Failure paths*.

## Running

The mock ships with this repository. One command starts it, runs every
workspace's tier against it, and stops it again:

```bash
node scripts/run-mock-tier.mjs
```

```
  activedirectory            4 passed   0 failed   0 skipped   (declares 4)
  …
  TOTAL 62 passed, 0 failed, 0 skipped (the tier declares 62)
```

One workspace only, or leaving the mock up to poke at by hand:

```bash
node scripts/run-mock-tier.mjs --only insights
node scripts/bconnect-mock.mjs            # then, in another shell:
cd bconnect-endpoints-mcp && npm run test:mock
```

Point the tier at a different mock — the vendor's `bConnect-Mock`, or one on
another host — with `BCONNECT_MOCK_URL`:

```bash
BCONNECT_MOCK_URL=http://other-host:13433 npm run test:mock
```

## Skip behaviour, and the trap it used to be

Every test calls `checkMockAvailable()` in `beforeAll` and, when no mock
answers, calls **`ctx.skip()`**.

It must never be a bare `return`. Vitest counts a returning test as a **PASS**,
so a run against an absent mock reports success having asserted nothing. That
was upstream finding QA-57 — and on 2026-08-22 it was measured *still true in
eleven of thirteen servers*, because the fix had been applied to two of them
locally and never propagated:

```
# with the mock unreachable, BEFORE the fix
assets-mcp       Tests  4 passed (4)      <- asserted nothing
endpoints-mcp    Tests  4 skipped (4)     <- the one server that was honest
```

`__tests__/suite-mock-tier-skips-honestly.test.ts` now fails the build if the
pattern comes back.

**A skipped tier and a passing tier still exit 0 alike**, which is fine for a
developer with no mock running and is not fine for CI. So the caller chooses:

| | |
|---|---|
| `BCONNECT_MOCK_REQUIRED` unset | skip quietly when no mock answers (dev default) |
| `BCONNECT_MOCK_REQUIRED=true` | refuse to run at all when no mock answers (CI) |

`scripts/run-mock-tier.mjs` sets it, because it starts the mock itself and so
has no excuse for it being absent. It also counts the tests the tier *declares*
by reading `it(` out of the source and fails when that disagrees with the number
that passed — "0 failed" is satisfied just as well by "nothing ran".

## The mock

`scripts/bconnect-mock.mjs` — zero dependencies, `node:http` only.

It answers the **shape** of bConnect: the paged envelope, id round-trip, 404 on
a nonexistent id, and the `/servermanagement/v2.0/ManagementServer` version
probe the startup gate reads. It is **not** a reimplementation of bConnect and
must not be mistaken for one; it knows nothing of real bMS semantics. Rows carry
every identity alias the tier reads (`id`, `endpointId`, `assetId`) set to the
same value, which is a deliberate simplification: code that picks the *wrong*
identity would pass here and fail against a real bMS.

For deeper fidelity, point `BCONNECT_MOCK_URL` at the vendor's `bConnect-Mock`.

## Failure paths

The least-exercised code in this suite is what happens when bMS is slow, down,
or fails **mid-walk**. `msw` — which the unit tier uses everywhere — intercepts
at the fetch layer and cannot produce a dropped socket, a connection accepted
and never answered, or a body that stops arriving. A real socket can.

```bash
curl -X POST http://127.0.0.1:13433/api/fault \
  -H 'content-type: application/json' \
  -d '{"mode":"status-500","after":2,"count":1}'

curl -X POST http://127.0.0.1:13433/api/reset
```

`after` is what makes a mid-walk failure stageable: *N* requests succeed, then
the fault applies to the next `count` of them.

| mode | what the caller meets |
|---|---|
| `status-401` `status-403` `status-429` `status-500` `status-503` | the ordinary failures |
| `slow` | `delayMs` before responding — the timeout paths |
| `hang` | accepted, never answered |
| `drop` | the socket destroyed mid-request |
| `empty-page` | 200, `data: []`, `totalItems` intact — **observed live** on the real API |
| `string-total` | `totalItems: "27"` — present but unreadable |
| `bad-total-pages` | `totalPages: "many"` — the `paginateAll` poison |
| `not-envelope` | 200 with a body that is not the envelope |

`bconnect-insights-mcp` holds the failure-path suite (11 tests), because its
composites are the walk-heaviest in the repo. Its `helpers.ts` exports
`setFault()` / `reset()`.

## Layout

Each server holds its own copy of the tier, because `helpers.ts` imports
`../../bconnect-client.js`, which is server-local:

```
bconnect-<domain>-mcp/
  vitest.mock.config.ts                    # calls createServerVitestMockConfig()
  package.json                             # adds `test:mock`
  src/__tests__/mock-integration/
    helpers.ts                             # client factory + mock probe
    <domain>.mock.test.ts
```

The shared pieces live at the suite root: `vitest.mock.shared.ts` (the config
factory) and `vitest.mock.globalsetup.ts` (the `BCONNECT_MOCK_REQUIRED` gate).
The unit tier excludes `**/mock-integration/**` globally in `vitest.shared.ts`,
so `npm test` never runs this tier.

**The per-server `helpers.ts` copies are near-identical but have drifted before**
— three distinct versions existed on 2026-08-22, which is how eleven servers
kept a defect the twelfth had fixed. If you change one, change them all, or move
the shared part into `@bconnect/mcp-core`.

## Adding a server's tier

1. `vitest.mock.config.ts`:

   ```ts
   import { createServerVitestMockConfig } from '../vitest.mock.shared';
   export default createServerVitestMockConfig();
   ```

2. Add `"test:mock": "vitest run -c vitest.mock.config.ts"` to its `package.json`.

3. Copy `helpers.ts` from an existing server.

4. Write `src/__tests__/mock-integration/<domain>.mock.test.ts`:

   - `beforeAll` calls `checkMockAvailable()` and builds the client.
   - Every `it()` takes `ctx` and opens with `ctx.skip(!available, MOCK_UNREACHABLE)`
     — **never** `if (!available) return;`.
   - Cover at minimum one **list**, one **get-by-id**, and one **404**.

5. Confirm all three states:

   ```bash
   node scripts/run-mock-tier.mjs --only <domain>              # passes
   BCONNECT_MOCK_URL=http://127.0.0.1:1 npm run test:mock      # skips, exit 0
   BCONNECT_MOCK_REQUIRED=true BCONNECT_MOCK_URL=http://127.0.0.1:1 \
     npm run test:mock                                         # refuses, exit 1
   ```

## What this tier deliberately does NOT do

- It does not run during `npm test`. It is opt-in, and it is the only tier that
  needs a listening socket.
- It does not replace the unit tier. Argument validation, dispatch wiring and
  tool-name coverage are unit concerns.
- It does not assert real bMS semantics. The mock answers shapes, not meaning.
