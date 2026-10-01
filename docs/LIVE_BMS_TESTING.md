# Live bMS testing

`npm run test:live` runs every server against a real baramundi Management Server,
read-only. It is opt-in and not part of `npm test`; without a configured bMS every
test is skipped.

| Tier | Target | Command |
| --- | --- | --- |
| Unit and guards | MSW fakes | `npm test` |
| Mock integration | bConnect-Mock in Docker | `npm run test:mock` (per server) |
| Live | a real bMS | `npm run test:live` |

## Setup

1. Build: `npm run build -w @bconnect/mcp-core && npm run build`.
2. Export the CA that signed the bMS certificate to a PEM file (see
   [INSTALLATION.md](INSTALLATION.md#exporting-the-baramundi-ca-certificate)). A bMS
   usually sends only its own certificate, so the CA has to come from the server's
   certificate store.
3. Create `.env.local` in the repo root (git-ignored):

   ```
   BCONNECT_BASE_URL=https://bms-host:443/bconnect
   BCONNECT_API_KEY=...            # or BCONNECT_USERNAME + BCONNECT_PASSWORD
   BCONNECT_CA_CERT_PATH=C:/path/to/bms-ca.pem
   BCONNECT_RELEASE=26R1           # the bMS release: 26R1 or 25R2
   ```

   The host name must match the certificate. To use another file, set
   `BCONNECT_LIVE_ENV=/path/to/file`.

   Without the CA, `NODE_TLS_REJECT_UNAUTHORIZED=0` in the file turns certificate
   checks off. The summary and the report then say that TLS was not verified.

## What it checks

1. **Startup.** Each built server starts over stdio with the startup probe on
   (TLS and authentication against the bMS), answers `initialize` and
   `tools/list`, and writes nothing but JSON-RPC to stdout.
2. **Read tools.** Each tool whose declared operations
   (`<server>/src/operations.ts`) are all GETs that return no credentials is called
   in-process. List tools run first with `PageSize=5`. The IDs they return feed the
   tools that need one: a tool on `/v2.0/Endpoints/{id}/Software` gets an ID from
   `/v2.0/Endpoints`. A call fails the test when the tool returns an error, unless
   the bMS answered only 403, 409, 501 or 503: the module, service or data is not
   available on this bMS, which the report lists as `unavailable`. A throttled call
   (429) is retried.
3. **Spec drift.** Every 2xx response is validated against its operation's response
   schema in `openapi-specs/<release>/`. Differences are reported, not failed.

## Safety

The tier cannot change the bMS:

- An MSW network guard passes only GET requests to the bMS host through. Any other
  request fails before it leaves the process, and the test fails.
- `ALLOW_WRITE_OPERATIONS` and `ALLOW_SECRET_READ` are set empty, so a local `.env`
  cannot open them.
- Write tools and tools that return credentials are skipped, not called.
- Credentials from the env file are masked in test output.

## Report

The console shows a summary of unavailable tools and schema drift. The full result,
with each tool's arguments, requests, status codes and schema differences, is in
`reports/live-bms.json` (git-ignored).

Skipped tools are listed with a reason: `write tool`, `returns credentials`,
`no ID from <route> on this bMS` (the parent list was empty), or
`needs <args>` (non-ID required arguments).
