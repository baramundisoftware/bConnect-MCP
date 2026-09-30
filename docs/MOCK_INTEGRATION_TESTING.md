# Mock-Integration Test Tier

A per-server tier of integration tests that exercise the production
`BConnectClient` HTTP path against a running `bConnect-Mock` instance.

These tests catch the class of bug that unit tests can't see: wrong REST
URLs, missing path segments, wrong HTTP methods, mistaken query shapes.
The `list_detected_vulnerabilities_for_endpoint` URL bug fixed in
P29.2 (commit `3f73e24`) is the canonical example.

## Running

The mock must be reachable. Default endpoint is `http://127.0.0.1:13433`.

```bash
docker ps --filter name=bconnect-mock                # confirm mock is up
cd bconnect-<domain>-mcp && npm run test:mock        # run one server's tier
```

Skip behavior: every test calls `checkMockAvailable()` in `beforeAll`.
If the mock is unreachable, every test in the file early-returns. The run
reports passing — never failing — so this tier is safe to invoke in CI.

Override the mock URL with `BCONNECT_MOCK_URL`:

```bash
BCONNECT_MOCK_URL=http://other-host:13433 npm run test:mock
```

## Layout

Each server holds its own copy of the tier. Per-server files:

```
bconnect-<domain>-mcp/
  vitest.mock.config.ts                              # opt-in vitest config
  package.json                                       # adds `test:mock` script
  vitest.config.ts                                   # excludes mock-integration from `npm test`
  src/__tests__/mock-integration/
    helpers.ts                                       # client factory + mock probe
    <domain>.mock.test.ts                            # 2–5 tests
```

The helpers and `vitest.mock.config.ts` are identical across servers. Each server's
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

4. Drop in `src/__tests__/mock-integration/helpers.ts` (copy from any
   existing server — it imports `../../bconnect-client.js` which is
   server-local).

5. Write `src/__tests__/mock-integration/<domain>.mock.test.ts`:

   - `beforeAll` calls `checkMockAvailable()` and constructs `client = createClient()`.
   - 2–5 `it()` blocks. Each starts with `if (!available) return;`.
   - Cover at minimum:
     - one **list** call — assert `data` array, `totalItems` number, `length >= 1`.
     - one **get-by-id** call — pass the id you grabbed from the list, assert
       the response carries the same id and the expected shape fields.
     - one **404** path — call `getX(NONEXISTENT_GUID)`, assert the promise rejects.
   - If the server has writes and you're running against `standard-readwrite`,
     add a create→verify→delete cycle. Use `reset()` between tests for
     isolation.

6. Confirm:
   - `npm run test:mock` passes while the mock is up.
   - `BCONNECT_MOCK_URL=http://127.0.0.1:1 npm run test:mock` skips cleanly.
   - `npm test` still runs only the unit tier and passes.

## Known fixture IDs (for hardcoding when needed)

Pulled from `standard-readwrite` (default profile). Verify with `curl` against
the mock if a test fails because a fixture changed.

| Domain                  | First-list ID example                      |
|-------------------------|--------------------------------------------|
| logical groups          | `d1000001-0001-0001-0001-000000000001`     |
| windows endpoint        | `d0000001-0001-0001-0001-000000000001`     |
| asset                   | `a0000001-0001-0001-0001-000000000001`     |
| ad group                | `a9000001-0001-0001-0001-000000000001`     |
| mobile device rule      | `c0011111-0000-0000-0000-000000000001`     |
| bitlocker endpoint      | `bl000001-0001-0001-0001-000000000001`     |
| job definition          | `bb000001-0001-0001-0001-000000000001`     |
| os folder               | `a1000001-0001-0001-0001-000000000001`     |
| security group          | `d1000001-0001-0001-0001-000000000001`     |
| software bundle         | `b0011111-0000-0000-0000-000000000001`     |
| universal dynamic group | `d0011111-0000-0000-0000-000000000001`     |
| variable definition     | `a0000001-0001-0001-0001-000000000001`     |

`NONEXISTENT_GUID = '00000000-0000-0000-0000-000000000000'` is exported
from `helpers.ts` for 404 tests.

## What this tier deliberately does NOT do

- It doesn't run during `npm test`. It's an opt-in tier; CI calls it
  separately when a mock instance is provisioned.
- It doesn't replace the unit tier. Argument-validation, dispatch wiring,
  and tool-name coverage are all unit concerns.
- It doesn't try to be exhaustive. 2–5 tests per server is enough to catch
  URL/method-shape bugs; deeper assertions belong in mock-suite tests
  (which live in `bConnect-Mock` itself).
