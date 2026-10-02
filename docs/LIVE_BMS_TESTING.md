# Live bMS testing

`npm run test:live` runs every server against a real baramundi Management Server,
read-only. It is opt-in: `npm test` and CI never run it. A misconfigured run fails;
it never passes by skipping.

| Tier | Target | Command |
| --- | --- | --- |
| Unit, guards, live-tier self-tests | MSW fakes, a local HTTP server | `npm test` |
| Mock integration | bConnect-Mock in Docker | `npm run test:mock` (per server) |
| Live | a real bMS | `npm run test:live` |

## Safety first: a read-only bMS account

Run the tier with a **dedicated bMS account that has a read-only role**. That is the
first safety net. The locks in the tier (below) come second.

With TLS verification off (`NODE_TLS_REJECT_UNAUTHORIZED=0`), the credentials go to
a server whose certificate nobody checked. Use it only on a network you control, and
only until the CA file is in place. An `http://` base URL has no TLS at all: the
servers refuse it unless `BCONNECT_ALLOW_INSECURE_HTTP=true`, and the report then says
"TLS: none".

## Setup on Windows

1. **Node.js** 22.15 or 24, the versions CI tests. Check with `node -v`.
2. **Git Bash as npm's script shell**, because the build scripts are bash. Once:

   ```bash
   npm config get script-shell        # expect ...\Git\bin\bash.exe
   npm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"
   ```

3. **Build** from the repo root, in Git Bash:

   ```bash
   npm ci
   npm run build -w @bconnect/mcp-core && npm run build
   ```

4. **Export the CA** that signed the bMS certificate to a PEM file. A bMS usually
   sends only its own certificate, so the CA comes from the server's certificate
   store. On the bMS, in PowerShell (the baramundi CA is usually
   `CN=bMD Certificate Authority`):

   ```powershell
   $c = Get-ChildItem Cert:\LocalMachine\Root, Cert:\LocalMachine\CA |
     Where-Object Subject -eq 'CN=bMD Certificate Authority' | Select-Object -First 1
   "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($c.RawData, 'InsertLineBreaks') +
     "`n-----END CERTIFICATE-----" | Set-Content -Encoding ascii bms-ca.pem
   ```

   Copy `bms-ca.pem` to the test machine. `*.pem` files are git-ignored. See also
   [INSTALLATION.md](INSTALLATION.md#exporting-the-baramundi-ca-certificate).

5. **Create the env file** `.env.local` in the repo root (git-ignored), or any file
   named by `BCONNECT_LIVE_ENV`:

   ```
   BCONNECT_BASE_URL=https://bms-host:443/bconnect
   BCONNECT_USERNAME=DOMAIN\readonly-user      # or BCONNECT_API_KEY=...
   BCONNECT_PASSWORD=...
   BCONNECT_CA_CERT_PATH=C:/Users/me/bms-ca.pem # forward slashes work on Windows
   BCONNECT_RELEASE=26R1                        # the bMS release: 26R1 or 25R2

   # What this bMS has; the API can't tell. yes | no (undeclared counts as no)
   BCONNECT_LIVE_MDM=no
   BCONNECT_LIVE_ENTRA_ID=no
   ```

   The host name must match the certificate. The file must not set
   `ALLOW_WRITE_OPERATIONS`, `ALLOW_SECRET_READ`, `BCONNECT_SKIP_CONNECTIVITY_CHECK` or
   `MCP_TRANSPORT`; the run refuses it.

   Unset these in the shell: `NODE_EXTRA_CA_CERTS`, `NODE_OPTIONS`, `SSL_CERT_FILE`,
   `SSL_CERT_DIR` and `NODE_USE_ENV_PROXY`. They can change Node's trust store or
   proxy, and Node reads them at startup, so the test process can't drop them; the
   run refuses to start while one is set. A debug terminal (e.g. in VS Code) often
   sets `NODE_OPTIONS`: run the tier from a plain Git Bash.

6. **Run** in Git Bash: `npm run test:live`.

## What the run is built from

Every variable a server or the shared core reads (connection, credentials, TLS,
audit, rate limit, transport, gates), plus the proxy variables, is set from the env
file or set empty. The list comes from the source, read with the same parser as the
README and client-config guards (`__tests__/lib/env-reads.ts`), not from a hand-kept
list. Nothing comes in from the repo `.env` or the shell.

The run fails before any test when:
- the env file doesn't exist;
- it sets no `BCONNECT_BASE_URL`, or not an http(s) URL;
- `BCONNECT_CA_CERT_PATH` names a missing file;
- the bMS can't be reached (one GET of `/info` with the run's TLS settings).

It also fails after the tests when no server started or no read tool was called.

## What it checks

1. **Startup.** Each built server starts over stdio with the startup check on (TLS
   and authentication). It answers `initialize` and `tools/list`, and writes only
   JSON-RPC to stdout.
2. **Read tools.** Each tool whose operations (`<server>/src/operations.ts` and the
   spec) are GETs that return no credentials is called in-process. List tools run
   first with `PageSize=5`. The IDs they return feed the tools that need one: a
   tool on `/v2.0/Endpoints/{id}/Software` gets an ID from `/v2.0/Endpoints`. A
   throttled call (429) is retried. Every skipped tool is listed with its reason.
3. **Expected non-success answers** are listed per tool in
   `__tests__/live/lib/expected.ts`, with the status, the bMS problem detail and the
   reason. One example is 409 "no maintenance window". Any other failure fails the
   run.
4. **Response schemas.** 2xx answers are checked against the spec's response
   schemas with the shared spec validator (`__tests__/lib/spec-validator.ts`), the
   one the spec-conformance guard uses. Differences are reported, not failed. Each
   one is a spec defect, a validator artefact (fixed in the shared validator, with a
   fixture test) or an MCP defect, and goes into an issue.

## Read-only locks

- **In-process request guard** (`__tests__/live/lib/guard.mjs`). Of the requests
  sent through Node's `http`/`https` modules (including named ESM imports), axios
  and `fetch`, only GET requests to the configured bMS origin leave the process.
  It refuses, before sending:
  - every other method;
  - every other origin;
  - every credential-returning route (`isSecretRoute` from `@bconnect/mcp-core`);
  - every redirect (`fetch` runs with `redirect: 'manual'` while the guard is on).
  Any refusal fails the run.

  It does not cover raw sockets (`net`, `tls`), worker threads, or a `fetch`
  reference taken before the guard started. The servers use none of these today;
  all their requests go through axios. The read-only bMS account is the safety net
  for anything the guard can't see.
- **Spawned servers.** The servers started over stdio run as separate processes,
  outside the in-process guard. They run with `node --import child-guard.mjs`,
  which installs the same guard and logs every request. The test asserts that
  startup sent exactly one request: the server's startup check, a GET list request
  of its own API with `PageSize=1`.
- **Gates.** `ALLOW_WRITE_OPERATIONS` and `ALLOW_SECRET_READ` are set empty, so
  they stay closed.
- **Tool selection.** Write tools and tools that return credentials are not
  called. This comes from `src/operations.ts` and the spec, not a hand-written list.

## What it can't verify

The report records the environment:
- the bMS version;
- the endpoint types with their totals, and whether any listed endpoint is
  enrolled (a `managementState` of `Enrollable` is a record with no device);
- MDM and Entra ID, as declared in the env file.

A tool whose data class is missing on the bMS is reported as **not verified live**,
never as passed:
- Android, iOS and Mac endpoints without an enrolled one;
- MDM enrollment and mobile device rules;
- Entra ID.

A failure stays a failure. A supported release with no test installation, e.g.
25R2, is reported as not verified live.

## Output

| Output | Content | Share? |
| --- | --- | --- |
| `reports/live-bms-summary.md` | counts, tool names, statuses, finding classes, environment | **yes**: the only output for PRs, issues and release notes |
| console | the summary, plus failure details and the last lines each server wrote to stderr (stack traces with local paths, the bMS port, redirect targets). Credentials, the bMS host name and object IDs are replaced, nothing else | no: read it locally |
| `reports/live-bms.json` | everything, including the host, arguments, requests and tool errors | no: stays on the machine (git-ignored) |

Publish only `reports/live-bms-summary.md`. Don't paste console output.

## Self-tests

`npm test` runs the tier's self-tests (`__tests__/live/*.selftest.test.ts`), which
need no bMS. They show:
- the guard refusing a non-GET, another origin, a redirect and a credential route,
  in-process and in a spawned process;
- the startup-only rule, including a redirect answer at startup;
- which tools are called and which are skipped (write tools, credential routes);
- every misconfiguration case failing;
- environment isolation;
- the per-tool expected answers;
- the sanitising;
- the "not verified live" classification.
