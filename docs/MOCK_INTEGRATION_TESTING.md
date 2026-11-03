# Mock-Integration Test Tier

A per-server tier of integration tests that exercise the production
`BConnectClient` HTTP path against a running `bConnect-Mock` instance.

These tests catch the class of bug that unit tests can't see: a wrong domain
segment (`/endpoints/…`, `/compliance/…`), wrong resource paths and HTTP methods
below it, mistaken query shapes. Since bConnect-Mock 0.4.0 the mock answers each
route only under the domain whose specification declares it, as a real bMS does:
a missing or wrong domain segment, or a route the specification doesn't declare,
gets 404, and an undeclared method gets 405. Older mock images, or a mock started
with `BCONNECT_MODULE_ROUTING=lenient`, ignore the domain segment and serve a few
routes that aren't in the specification. The tier covers only a few calls per
server; `npm test` checks every route against the specification (the
spec-conformance guard).
The canonical example is `list_detected_vulnerabilities_for_endpoint`,
which once called the wrong path (see the comment in
`bconnect-compliance-mcp/src/__tests__/mock-integration/compliance.mock.test.ts`).

## Running

The tests expect the mock at `http://127.0.0.1:13433`, version **0.8.1 or later**
(0.8.0 answers list items with exactly the specification's fields, such as an
asset's `assetId` and an endpoint's `type`, which the tests read; 0.8.1 runs on
Node.js 22.23.4, the fix for CVE-2026-111497). Start it with
its rate limit off: under the limit, `/health` can answer 429 and the tests act
as if the mock weren't there. Start it for the bMS release to test, `26r1` or
`25r2` (`BCONNECT_BMS_VERSION`; the mock's default is 25R2). On 25R2,
compliance and universaldynamicgroups have no API at all and aren't run, and the
software tests skip Bundles, which exist from 26R1 on. The mock listens on 3433
inside the container, so map it to 13433:

```bash
docker run -d --name bconnect-mock -p 127.0.0.1:13433:3433 \
  -e BCONNECT_BMS_VERSION=26r1 -e RATE_LIMIT_ENABLED=false \
  ghcr.io/baramundisoftware/bconnect-mock:0.10.0

npm run build                                        # once: the tier uses the built core
node scripts/mock-tier.mjs 26r1                      # every server, as CI runs it
cd bconnect-<domain>-mcp && npm run test:mock        # or one server's tier
```

`scripts/mock-tier.mjs <26r1|25r2>` checks that the mock answers `/health` for
that release and runs each applicable server's tier with `MOCK_REQUIRED=true`. It
fails when a server's tests fail, and when fewer tests passed than the server
declares for the release: vitest's summary line must show every test passed,
except the software Bundles tests on 25R2, which skip because that API doesn't
exist there.

## In CI

The `mock` job in `.github/workflows/ci.yml` runs `scripts/mock-tier.mjs` on
every pull request and on `main`, once per release (26r1: 13 servers, 25r2: 11),
against the mock image pinned in the job's `env` (to move to a newer mock, change
that one line). The job log names the image digest.
It isn't a required check.

The tests never read `BCONNECT_BASE_URL` or the credential variables: they send
fixed test credentials to the mock URL only, with certificate checks on.

Without the mock: every test file calls `mockAvailable('<domain>')` in `beforeAll`.
If the mock doesn't answer `/health`, the file's tests are **skipped**
(`ctx.skip()`), vitest reports them as skipped, and a warning
(`bConnect-Mock not reachable at … — <domain> mock tests skipped`) names the
server. With `MOCK_REQUIRED=true` a missing mock fails the run instead; the
runner sets it, so CI never passes without the mock:

```bash
MOCK_REQUIRED=true npm run test:mock    # fails when the mock isn't there
```

Override the mock URL with `BCONNECT_MOCK_URL`:

```bash
BCONNECT_MOCK_URL=http://other-host:13433 npm run test:mock
```

Running a server itself against the mock (not this tier): set the server's `BCONNECT_RELEASE`
to the release the mock was started for (`BCONNECT_BMS_VERSION`, default 25R2). The software server's startup check probes `/software/v2.0/Bundles` for `26R1` (the
default), which a 25R2 mock answers with 404, so the server would stop at startup.

## Layout

Each server holds its own tests; the helpers are one shared module,
`__tests__/lib/mock-integration.ts` (`mockAvailable`, `mockClientConfig`,
`getMockHealth`, `rawGet`, `reset`). `__tests__/mock-integration.guard.test.ts`
refuses a helper module in a server, a test that reads a real `BCONNECT_*`
setting or turns certificate checks off, and a test that returns early instead
of skipping. Per-server files:

```
bconnect-<domain>-mcp/
  vitest.mock.config.ts                              # opt-in vitest config
  package.json                                       # adds `test:mock` script
  vitest.config.ts                                   # excludes mock-integration from `npm test`
  src/__tests__/mock-integration/
    <domain>.mock.test.ts                            # 2–5 tests
```

`vitest.mock.config.ts` is identical across servers. Each server's
`BConnectClient` (`src/bconnect-client.ts`) is a thin wrapper over the shared
`BConnectClientBase` in `@bconnect/mcp-core`, so this tier exercises the real
production client path per server against the mock.

## Recipe (per server)

1. Create `vitest.mock.config.ts`:

   ```ts
   import { defineConfig } from 'vitest/config';
   export default defineConfig({
     test: {
       include: ['src/__tests__/mock-integration/**/*.test.ts'],
       env: { NODE_ENV: 'test', VITEST: 'true' },
       testTimeout: 15000,
     },
   });
   ```

2. Add an `exclude` to the existing `vitest.config.ts` so `npm test`
   (the unit tier) ignores mock-integration files:

   ```ts
   test: {
     exclude: ['**/node_modules/**', '**/build/**', '**/mock-integration/**'],
     // …existing config…
   }
   ```

3. Add the `test:mock` npm script:

   ```json
   "test:mock": "vitest run -c vitest.mock.config.ts"
   ```

4. Write `src/__tests__/mock-integration/<domain>.mock.test.ts`, importing the
   helpers from `'../../../../__tests__/lib/mock-integration.js'` (no copy):

   - `beforeAll` sets `available = await mockAvailable('<domain>')`, returns when
     it is false, and constructs `client = new BConnectClient(mockClientConfig())`.
   - 2–5 `it()` blocks, each `async (ctx) => {` starting with
     `if (!available) {ctx.skip();}`.
   - Cover at minimum:
     - one **list** call — assert `data` array, `totalItems` number, `length >= 1`.
     - one **get-by-id** call — pass the id you grabbed from the list, assert
       the response carries the same id and the expected shape fields.
     - one **404** path — call `getX(NONEXISTENT_GUID)`, assert the promise rejects.
   - If the server has writes and you're running against `standard-readwrite`,
     add a create→verify→delete cycle. Use `reset()` between tests for
     isolation.

5. Confirm:
   - `npm run test:mock` passes while the mock is up.
   - `BCONNECT_MOCK_URL=http://127.0.0.1:1 npm run test:mock` reports every test skipped, and fails with `MOCK_REQUIRED=true`.
   - `npm test` still runs only the unit tier and passes.

## Fixture IDs

The tests don't hardcode IDs; they take them from a list call. If you need one,
do the same, or look it up in the mock's fixtures: `fixtures/<profile>/` in the
bConnect-Mock repository (default profile `standard-readonly`). With
`BCONNECT_BMS_VERSION=26r1`, 26R1-only data such as compliance rules, bundles and
universal dynamic groups comes from `fixtures/standard-26r1/`.

## What this tier deliberately does NOT do

- It doesn't run during `npm test`: it needs a running mock. CI runs it in its own
  job (see "In CI"), and `npm run ci` starts the pinned mock in Docker and runs it
  for both releases.
- It doesn't replace the unit tier. Argument-validation, dispatch wiring,
  and tool-name coverage are all unit concerns.
- It doesn't try to be exhaustive. 2–5 tests per server is enough to catch
  URL/method-shape bugs; deeper assertions belong in mock-suite tests
  (which live in `bConnect-Mock` itself).
