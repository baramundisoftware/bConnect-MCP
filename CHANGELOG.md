# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Known issues
- **Some reads are slow on a large or busy bMS.** On a test bMS 26R1 (26.1.161),
  `list_detected_vulnerabilities` and `list_vulnerabilities` took about 30 s and
  `list_installed_windows_software` about 50 s, so they can run into the default 30 s timeout. Set
  `BCONNECT_TIMEOUT_MS=90000` for the servers you use them with (see `docs/TROUBLESHOOTING.md`).

### Added
- **The gateway image is published automatically again** (#130). A version tag `vX.Y.Z` builds
  `ghcr.io/baramundisoftware/bconnect-mcp-gateway` for linux/amd64 and linux/arm64 and tags it
  `X.Y.Z`, `X.Y` and `latest`, with a build provenance attestation
  (`gh attestation verify oci://ghcr.io/baramundisoftware/bconnect-mcp-gateway:<version> --repo baramundisoftware/bConnect-MCP`).
  Pull requests that change the image build it without publishing. `scripts/publish-image.sh`
  stays as the fallback for publishing by hand.
- **Every list tool offers the filters bConnect supports** (#179). Active Directory, assets,
  compliance, Defender/BitLocker, operating systems, server management, software, universal dynamic
  groups, update management and variables list tools now take the filters their API route declares,
  among them `includeIndirect` and `includeSubOrgUnit(s)` (AD), `Category`, `Scope`, `StateValue` and
  `LastExecution` (download jobs, which ignored all filters before), plus `Name`, `OrderBy` and
  `includeSubfolders` where they were missing.
- **Endpoint and group list tools offer every filter bConnect supports** (#179). The endpoint lists,
  `list_logical_groups`, `search_endpoints` and the group member tools now take the filters their API
  route declares, among them `HostName`, `Domain`, `DisplayName`, `EntraIdDeviceId` (26R1 only), `Name`
  and `Dip`, plus `OrderBy` and `Page` where they were missing. `search_endpoints` keeps `query` and
  `pageSize`.
- **Job tools offer every filter bConnect supports** (#179). `list_job_instances`, the job-instance
  tools per group, endpoint and job definition, `list_job_definitions`, `list_job_folders` and
  `list_job_subfolders` now take the filters their API route declares, among them `LastAction` (an
  ISO 8601 date with an optional `lt`/`gt` prefix, e.g. `gt 2026-09-30T00:00:00Z`), `EndpointType`,
  `JobDefinitionId`, `Name` and `includeSubfolders`. Their `SearchQuery` and `OrderBy` descriptions
  now name the searchable fields and sort keys. The filters come from tables generated from the
  API specification (`scripts/generate-query-parameters.mjs`), per bMS release.

### Security
- **Unused runtime dependencies removed.** `limiter`, `node-cache`, `winston`, `openapi-fetch` and
  `@types/node-cache` were declared (in the root and the servers) but imported nowhere, so they
  were installed and shipped for nothing; `axios-retry` is now declared only where it is used. The
  shared core now declares what it imports (`axios`, `axios-retry`, the MCP SDK) instead of relying
  on another package's copy, and every package requires `axios` 1.20 or later. A test keeps each
  package's runtime dependencies equal to its imports (replaces Dependabot #182).
- **MCP SDK 1.31.0 in every package** (was 1.29.0). Its HTTP transport, used by the gateway, now
  reads request bodies with a size limit, caps the length of JSON-RPC batches and checks the
  Content-Type properly; SSE keep-alive is fixed. All 16 manifests and both lockfiles move
  together (replaces Dependabot #181, which updated only two of them and didn't install).
- **Audit level `security` records every security-relevant call** (#168). At that level only
  BitLocker and LAPS credential routes were recorded. Now it also records: listing API keys,
  reading or changing object rights, every security-group and security-profile operation, LAPS
  `TriggerUpdateOnClient`, enrollment starts, creating endpoints with passwords, restarting the
  management server or a microservice, and changing variables (a variable can hold a password).
  The list comes from the API specifications (a test checks it against 25R2 and 26R1, and every
  other API area is classified with a reason) and is documented with the levels in `docs/AUDIT.md`.
- **Hidden characters in bMS data no longer reach the model** (#167). Names, descriptions and
  messages from bMS can contain characters a person doesn't see but a model reads: zero-width
  characters, direction controls, variation selectors that hide bytes after an emoji, and Unicode
  tag characters that can spell out hidden instructions. The shared client now removes every
  format character and default-ignorable code point from every value and key of every response,
  for all 13 servers, and shows `[hidden characters removed]` where they were. ZWJ, ZWNJ and the
  emoji presentation selectors (needed by several scripts and emoji), tab and line feed are kept;
  CRLF becomes LF. Responses without such characters are unchanged.
- **Refused credential reads are audited.** A request the client refuses before sending it
  (a BitLocker or LAPS credential route while `ALLOW_SECRET_READ` is off, or a path that isn't
  in canonical form) is now recorded as a security audit entry at every
  `BCONNECT_AUDIT_LEVEL` except `none`. Before, it left no audit entry at any level. Audit
  lines escape control characters, so one entry can't forge another.
- **The credential-route gate and the path check refuse more unusual path forms.** Paths with
  malformed percent escapes are refused, and the gate recognises a credential route in more
  encodings.
- **Credentials are only sent over HTTPS.** A `BCONNECT_BASE_URL` with `http://` is refused
  unless the host is this machine (`localhost`, `127.x.x.x`, `[::1]`, e.g. the bundled mock) or
  `BCONNECT_ALLOW_INSECURE_HTTP=true` is set, which logs a warning. Before, credentials went in
  cleartext over any `http://` address. **Breaking for `http://` setups:** switch to `https://`
  (recommended) or set the opt-in. Configuration errors (missing credentials, an unreadable CA
  file, an insecure base URL) now all stop the server with a clear message.
- **Credentials are only sent to the configured bConnect host.** The client no longer follows
  HTTP redirects. Before, a redirect could carry an API key (`X-Api-Key`) to another host. A
  redirect now stops the call: the operator's log names the target address, the model is only
  told that `BCONNECT_BASE_URL` needs the final address. **Behaviour change:** a bMS behind a front end that redirects (for
  example from `http://` to `https://`) needs its final address in `BCONNECT_BASE_URL`.
- **Local secret files are ignored by git.** `.gitignore` now covers every `.env` and `.env.*`
  copy in any directory (for example the `.env.gateway` the gateway setup asks for) and a
  `secrets/` directory. The `*.example` templates stay tracked.
- **Every write tool is refused while write operations are disabled.** A few write tools were
  missing from their server's write gate; they now return the same refusal as every other
  write tool (#190).
- **Updated dependencies with known advisories.** All updates stay within their major
  version: axios 1.20.0, hono 4.13.12, @hono/node-server 1.19.17, js-yaml 4.3.2,
  fast-uri 3.1.8, ip-address 10.7.2, qs 6.16.0, body-parser, and express 4.22.3 in the
  gateway. `npm audit --omit=dev` now reports no vulnerabilities for the servers or the
  gateway. `openapi-typescript`, a code generator, is now a development dependency, so a
  production install (`npm ci --omit=dev`) no longer pulls it in. dotenv stays on 16:
  from 17 on it writes to stdout, which breaks stdio MCP clients.
- **Tool arguments are validated in every server.** All 13 servers check each tool's
  arguments before sending a request; ID arguments must be GUIDs. Invalid input is refused
  with an `Invalid parameters` error and nothing is sent.
- **The shared client only sends request paths in canonical form**, whichever tool built
  them. Query parameters are always passed separately.
- **Every tool that returns credentials requires `ALLOW_SECRET_READ`**, write tools included
  (those also need `ALLOW_WRITE_OPERATIONS`). The refusal says an operator must set the
  variable and restart the server.
- **Second lock in the shared client.** `@bconnect/mcp-core` refuses the BitLocker-secrets and
  LAPS operations before sending unless `ALLOW_SECRET_READ=true`, whichever tool issues the
  request, matching on the canonical request path.
- **Guard test.** Derives the credential-returning operations from the 25R2/26R1 OpenAPI
  response schemas, exercises every tool of every server, and fails if one reaches such an
  operation without the gate, or calls a path the spec doesn't declare.

### Changed
- **19 write tools verified on a live bMS no longer say "Not yet verified against a live bMS."**
  Checked on a test bMS 26R1 (26.1.161): the Windows, Mac and logical-group create, update and delete
  tools, the logical-group maintenance-window tools, the job-folder tools, `create_kiosk_release`,
  `withdraw_kiosk_release`, `assign_job_to_logical_group` and `delete_job_instance`. All other write
  tools keep the note until they are checked.
- **A write whose outcome is unknown says so** (#254). A write tool whose request timed out, whose
  connection closed or whose answer was unreadable or cut off after the request was sent, or that
  got 502 or 504 from a gateway, used to get the same message as a read ("raise the timeout",
  "Cannot connect", or only the status). On a real
  bMS such writes were completed in the background, so repeating the call repeats the write. The
  result now says it's unknown whether bMS made the change, that it may still carry it out, and to
  check the current state before repeating the call. Reads, and writes answered 503, 4xx or 500,
  keep their messages, and so do failures before anything was sent (refused, DNS, a reset while
  connecting or during the TLS handshake); the client still never retries a write.
- **`trigger_update_on_client` is now `refresh_local_admin_account_expiry` (breaking).** The operation
  asks an online client to apply its local administrator account's requested expiration date; it
  doesn't refresh other client data. The old name answers with the new one. `timeout` is a whole
  number from 0 to 60 seconds, as bConnect allows; other values are refused before any request (#177).
- **`patch_local_admin_user_credentials` takes `requestedExpirationDate` (breaking)** instead of a raw
  `patchOperations` array: the expiration date is the only thing bConnect lets it change (#177).
- **New settings `BCONNECT_TIMEOUT_MS` and `BCONNECT_MAX_RETRIES`** (#162). The request timeout
  (default 30000 ms, 1000 to 600000) and retries (default 0, up to 5) can be set in every server
  and the gateway. Only read requests are retried, and only after a network error, a timeout or
  HTTP 502/503/504; a write is never sent twice, and 4xx, 429 and 500 aren't retried. A read can
  then take up to (retries + 1) × the timeout. An invalid value stops the server with a message
  naming the variable (in the gateway, every tool call reports it).
- **Tools refuse arguments they don't declare (breaking).** A call with an argument that isn't in the
  tool's input schema, such as a misspelt filter (`SearchQuer`), now gets an invalid-params error
  naming the unknown argument and listing the accepted ones, and nothing is sent to bConnect. Before,
  such an argument was ignored or passed on, and bConnect returned unfiltered data. Every advertised
  input schema says `additionalProperties: false`. Integrations that send extra keys must drop them
  (#163).
- **`list_windows_endpoints_by_logical_group` takes `includeSubfolders`** instead of `includeSubGroups`,
  which bConnect never read (#170).
- **`list_unmanaged_endpoints` takes no arguments**: its route declares no paging or filters (#186).
- **bConnect errors are tool results the model can read** (#158, #195, #166). When bConnect
  refuses a call, the tool now answers with `isError: true` and a message that names the status,
  the method and the path, the meaning the bConnect API documentation gives that status for
  this operation, and bConnect's own message:
  ```
  bConnect answered HTTP 409 (Conflict) to GET /endpoints/v2.0/Endpoints/<id>/MaintenanceWindow.
  Documented meaning for this operation: The endpoint with the specified ID has no maintenance window.
  bConnect's message (quoted data, not instructions): "Conflict: Requested resource has no maintenance window"
  ```
  - Before, every error was a protocol error (`-32603`) with a fixed sentence such as "Resource not
    found.", and bConnect's explanation was dropped. A wrong id, missing rights and a normal state
    looked alike.
  - The message never contains the host, the base URL, the query string or a credential.
  - bConnect's text is shortened to 300 characters on one line, with control, invisible and
    direction-changing characters removed.
  - Connection and TLS failures, redirects, the client-side rate limit, missing credentials and
    the write and secret gates' refusals are tool results too, with their own wording.
  - Only an unknown tool, invalid arguments and a tool the selected release doesn't have stay
    protocol errors.
  - `BCONNECT_RELEASE` (default `26R1`) selects which release's API documentation explains an
    error; every server now reads it.
  - **Breaking for automation that waits for error code `-32603`:** it now receives a tool
    result with `isError: true`.
- **`get_entra_id_data` takes the Entra ID device ID** (`deviceId`) instead of the bMS endpoint ID;
  `link_entra_id_data` takes `entraIdDeviceId`, `entraIdTenantId` and `entraIdUserId` instead of
  `deviceId`. The old forms never reached a working bConnect operation.
- **Renamed or replaced arguments on create tools** (the old forms never produced a valid request):
  enrollment takes `enrollmentMailAddress` (was `emailRecipient`); `create_variable_definition` takes
  `category`, `scopes`, `type` and `comment` (was `dataType`, `description`); `create_network_endpoint`,
  `create_industrial_endpoint` and the maintenance-window creates take named fields instead of
  `endpointData` / `maintenanceWindowData`; `add_application_to_bundle` no longer offers `order`.
- **Write tools say they're unverified.** Until a write tool has been checked against a live
  bMS, its description ends with "Not yet verified against a live bMS.", so an AI assistant can
  tell you before it changes anything. The note disappears tool by tool as live checks are
  recorded.
- **`update_network_endpoint`, `update_industrial_endpoint` and the maintenance-window updates
  take named fields** instead of an untyped `updateData` / `maintenanceWindowData` object, which
  was never sent in a form bConnect accepts.
- **`create_job_instance` no longer offers `scheduledStartTime`.** The API has no such field; the
  job always started immediately. The description now says so; `endpointId` is required and
  `startIfAlreadyAssigned` is available.
- **`BCONNECT_REJECT_UNAUTHORIZED` is removed.** Only the groups server read it, while the
  READMEs listed it for every server. To turn certificate checks off for development, set
  `NODE_TLS_REJECT_UNAUTHORIZED=0`, which every server honors. In production, keep
  verification on and point `BCONNECT_CA_CERT_PATH` at your internal CA instead (#197).
- **One shared function builds every server's bConnect client config.** `@bconnect/mcp-core`
  now reads the connection settings (base URL, credentials, API key, CA certificate, TLS,
  audit level, rate limit) for the tool client and the startup check of all 13 servers, so
  the servers can't drift apart again (#197). Effects:
  - The groups server no longer refuses to start without `BCONNECT_BASE_URL`. Like the other
    servers, it falls back to the placeholder URL `https://bms.example.com:443/bconnect`;
    run alone, its startup check then fails against it. In the gateway, where no startup
    check runs, groups tool calls now go to the placeholder URL instead of being refused,
    as the other servers' calls already did.
  - Ten servers used `https://bms-server/bconnect` as the tool calls' fallback base URL and
    a different one for the startup check; all now use the same placeholder.
  - An empty `BCONNECT_BASE_URL`, or an empty base URL passed per request, now counts as
    unset (it used to be passed on as an empty URL).
  - Missing credentials give the same error in every server: tool calls fail with an
    internal error (groups returned an invalid-request error with a different text), and
    the server exits at startup with one line naming both ways to authenticate (endpoints
    and jobs printed a stack trace).
  - An empty `BCONNECT_CA_CERT_PATH` file is an error. It used to replace the trusted CAs
    with Node's built-in list without saying so.
- **`BCONNECT_RELEASE` now defaults to `26R1`** (was `25R2`), matching the documented
  default and the advertised tool counts (e.g. 66 endpoints tools, 276 total). Following
  the README with no `BCONNECT_RELEASE` set previously registered the smaller 25R2 subset
  (60 endpoints tools) silently. Set `BCONNECT_RELEASE=25R2` explicitly on older servers;
  the 26R1-only tools 404 there. Added `BCONNECT_RELEASE` to the endpoints/jobs
  `.env.example` files. This applies to every server that reads the variable, including
  servermanagement, which now also refuses a 26R1-only tool on 25R2 with the same message
  as the others.

### Removed
- **Per-server container files** (aligning with ADR-0003 — only the gateway is
  distributed as a container; the 13 servers run over stdio via Node/Claude Desktop).
  Removed `docker-compose.yml`, the 13 per-server `Dockerfile`s, and
  `build-tests/docker-smoke.test.sh`. These built each server from its own directory,
  which stopped working after the workspace refactor (no per-server lockfile;
  `@bconnect/mcp-core` is a private `file:` dependency). The gateway image
  (`docker-compose.gateway.yml` + `bconnect-mcp-gateway/Dockerfile`) is unaffected.

### Fixed
- **The guides under `docs/` match the code again.** Commands that didn't work are fixed: the
  `docker run` examples (missing `MCP_ALLOW_NO_AUTH=true`), the gateway build steps, `claude mcp add`,
  the n8n HTTP Request example (missing `Accept` header) and the mock-tier setup (needs a 26R1 mock).
  TROUBLESHOOTING.md quotes the messages the servers print, with new sections on why a server exits
  at startup and on refused calls. The guides no longer offer `NODE_TLS_REJECT_UNAUTHORIZED=0` or
  `curl -k` as options. They also say that only the shipped compose file keeps write tools and secret reads out of
  the gateway, so any other start must leave both unset, and give the n8n version and token figures as measured. `bconnect-groups-mcp` ships a
  `.env.example` like the other servers. A new docs guard checks that the guides name only settings
  the code reads and quote only messages it prints.
- **Job assign tools say how to check their reach** (#178). `assign_job_to_logical_group` points to
  `list_endpoints_by_logical_group` with `includeSubfolders: true` and `PageSize: 1`, whose `totalItems`
  is the number of endpoints the assignment reaches at all sub-group levels (a plain member list shows
  only direct members); the other assign tools name their group's member tool. All four say the answer
  lists the assignments that failed.
- **Maintenance windows can be changed to Anytime or Never** (#237). The update tools now also
  remove the old intervals, which bMS requires for these types (before, bMS answered 400). The create
  and update tools refuse, before sending, a window that breaks the rule: Anytime and Never take no
  intervals, Everyday, WorkdayWeekend and IndividualWeekday need at least one.
- **Basic credentials are sent as bConnect reads them, and a password bConnect can't accept is
  refused before signing in** (#228, #265). The credentials were sent as UTF-8, but bConnect reads
  Basic credentials as Latin-1. They are now sent as Latin-1; ASCII credentials are unchanged (a
  username with an umlaut hasn't been verified live). A **password** with any non-ASCII
  character (`§`, an umlaut, `ß`, ...) still can't work: bConnect's API rejects it with 401 although
  Windows accepts it. Such a password is now refused at startup (in the gateway: on every tool call)
  with a message that names the variable and points to an ASCII-only password or an API key, so no
  attempt counts toward the account lockout. A username with a character Latin-1 doesn't have (such
  as `€`) is refused the same way.
- **LAPS and job-folder tools describe what they do.** `patch_local_admin_user_credentials` no longer
  claims to change the password or user name: it sets the requested expiration date, and a past date
  makes the client generate new credentials. `list_job_folders` returns folders at every level, not
  only the top level (#177).
- **The software server starts on bMS 26R1 even when installed-software data is slow** (#202). Its
  startup check asked for `InstalledWindowsSoftware`, which a real bMS answered only after 30 s, so
  the check timed out and the server exited. With `BCONNECT_RELEASE=26R1` (the default) it now checks the light
  `Bundles` list; with any other value it keeps `InstalledWindowsSoftware`, the only list route 25R2
  has.
- **A timeout is reported as a timeout** (#203). A request bConnect didn't answer in time was
  reported as "Cannot connect to the bConnect API". It now says "The bConnect API didn't answer
  within 30 s (BCONNECT_TIMEOUT_MS) …", in tool results and in the startup log. Refused
  connections, DNS failures and certificate problems keep their own messages.
- **List tools send only the query parameters bConnect declares.** Active Directory, assets, jobs and
  logical-group tools no longer repeat the path ID (e.g. `adGroupId`) or pass other arguments as query
  parameters; each sends exactly what its route declares (#186).
- **Logical-group tools can include sub-groups and page.** Tools that list a logical group's members
  (endpoints, groups, jobs, Defender threats, installed software) offer `includeSubfolders`, so a parent
  group whose members sit in sub-groups no longer looks empty. `list_logical_groups` offers paging and
  the `Name`, `Dip`, `Domain`, `SearchQuery` and `OrderBy` filters instead of returning only the first
  page (#170).
- **`simulate_msw_cleanup` and `msw_cleanup` are refused on 25R2.** They were hidden from the tool
  list on 25R2 but still ran when called by name, against an operation 25R2 doesn't have. They now
  answer like the other 26R1-only tools.
- **Paging arguments say where pages start.** Every `Page` argument says pages are zero-based (two
  endpoints tools said "1-based"), and every `PageSize` states the 1000 limit and the default. All
  tools share one definition from the core, and both are declared as integers, as in the spec (#169).
- **Entra ID tools work.** `get_entra_id_data` reads by Entra ID device ID from the route bConnect
  provides, and `link_entra_id_data` sends the device, tenant and user IDs bConnect expects. The
  descriptions say bConnect marks these operations as temporary and meant for mobile devices.
- **Create and enrollment tools send what bConnect accepts.** Windows, Linux, network and industrial
  endpoint creates, maintenance-window creates, Windows/Mac enrollment, `create_asset`,
  `create_variable_definition`, `create_software_bundle` and `add_application_to_bundle` declare the
  fields bConnect requires (e.g. `hostName`, `category` and `scopes`) and send only those.
  `trigger_update_on_client` no longer sends a body.
- **Endpoint and logical-group updates work.** The Windows, Linux, Mac, network and industrial
  endpoint updates, `update_logical_group` and both maintenance-window updates now offer the
  fields bConnect lets you change (display name, logical group, comment, host name, IP and MAC,
  registered user, …) as named arguments, and send them as a JSON Patch. Before, they sent their
  arguments as a plain object, which bConnect doesn't accept. A call that changes nothing is
  refused.
- **Update requests use the content type bConnect declares.** Every PATCH is now sent as
  `application/json-patch+json`, as all PATCH operations in the 25R2 and 26R1 specs require. 22
  update tools (endpoints, assets, OS, server management, variables, job folders, LAPS expiry)
  sent `application/json` before.
- **`restart_management_server` can schedule the restart** with `utcScheduleRestartTime`
  (ISO 8601, UTC). Without it the restart is immediate, as before; the description now says so.
- **Write tools report what bMS returned.** Windows and Mac enrollment return the install
  command, token, URL and QR text; `trigger_intune_installation` reports "not triggered" when bMS
  answers false; endpoint and maintenance-window updates, the MSW cleanup (and its simulation) and
  security group, profile and permission updates return bMS's result instead of a fixed text.
  Malformed object or JSON Patch arguments are refused before any request.
- **Job write tools send what the API accepts and report what happened.** `create_kiosk_release`
  sends `assignmentTargetId`, `update_job_folder` sends a JSON Patch (and refuses a call that
  changes nothing), and the four `assign_job_to_*_group` tools send only the assignment fields.
  A group assignment that bMS answers with 207 is reported as "fully or partially succeeded"
  with bMS's details on failed targets, instead of "Created undefined job instances". The assign
  tools' descriptions now say that a job instance is created and started for every member,
  including all sub-groups of a logical group.
- **Gateway settings in `.env.gateway` now take effect** (#98, reported by @AndreasHanikel).
  `docker-compose.gateway.yml` passes `LOG_LEVEL`, `LOG_FORMAT`, the inbound rate limit
  (`MCP_GATEWAY_RATE_LIMIT_*`), `MCP_GATEWAY_MAX_BODY`, `BCONNECT_RELEASE` and the outbound rate
  limit (`BCONNECT_RATE_LIMIT_*`), plus `BCONNECT_ALLOW_INSECURE_HTTP`, to the container;
  before, they were silently ignored.
  `.env.gateway.example` documents `BCONNECT_AUDIT_LEVEL` and the other forwarded settings.
- **The mobile device rule tools return rules.** `list_mobile_device_rules` and
  `get_mobile_device_rule` called `/MobileDeviceRules`, a route the API doesn't have, so they
  always failed with 404 and never returned data. They now call `/v2.0/Rules` and
  `/v2.0/Rules/{id}`, as the API declares (#176).
- **groups tools now work against a bConnect server with an internal CA (#197).** The groups
  server's tool calls ignored `BCONNECT_CA_CERT_PATH` and `NODE_TLS_REJECT_UNAUTHORIZED`:
  the server started, and then every groups tool failed with a TLS error. Its tool calls now
  use the CA, TLS and `BCONNECT_AUDIT_LEVEL` settings like every other server, and the
  startup check uses the same settings as tool calls.
- **Audit logging works in stdio mode (#168).** Audit entries went to stdout, which carries
  the MCP protocol in stdio mode, so enabling auditing broke the connection to Claude Desktop
  or Claude Code. Every audit entry now goes to stderr.
- **Audit levels include each other (#168).** `write` now also records what `security`
  records, and `security` now also records reading or changing a LAPS password, not only
  BitLocker secrets. Before, a LAPS password read was recorded at no level except `all`.
- **A mistyped `BCONNECT_AUDIT_LEVEL` no longer switches auditing off (#161).** Case and
  surrounding spaces no longer matter (`WRITE` and ` write ` mean `write`). **Behaviour
  change:** any value other than `none`, `security`, `write` or `all` now stops the server
  with a message naming the value and the valid levels. Before, it silently meant `none`.
  Unset or empty still means `none`.
- **The `BCONNECT_RATE_LIMIT_*` settings now reach every server's client.** Nine servers
  (compliance, defensecontrol, groups, operatingsystems, servermanagement, software,
  universaldynamicgroups, updatemanagement, variables) never passed them on. Each tool call
  still creates a new client, so the limit applies only within one tool call, not across
  calls, until #160 is done.
- **Servers no longer exit at startup with "Resource not found" (#111).** The connectivity
  check requested `/v2.0/WindowsEndpoints` without a domain prefix, a route bConnect doesn't
  have, so every server stopped unless `BCONNECT_SKIP_CONNECTIVITY_CHECK=true` was set. Each
  server now probes a list route of its own domain (e.g. `/endpoints/v2.0/Endpoints`) with
  `PageSize=1`. `BCONNECT_SKIP_CONNECTIVITY_CHECK` is no longer needed for this, and
  `healthCheckPath` in the client config still overrides the route.
- **Gateway robustness.** An error while handling one MCP request could terminate the whole
  gateway process for every client. The request now fails on its own (HTTP 500 with a JSON-RPC
  error, details only in the server log), and the domain in `POST /<domain>/mcp` is matched
  against the registered domains only; anything else is `404 Unknown MCP domain`.
- **`update_bitlocker_pin` called a route the API doesn't have** (`PATCH …/{id}/Pin`); it now
  uses the spec operation `PATCH …/BitLocker/WindowsEndpoints/{id}/Secrets`.
- **Startup connectivity check.** `BConnectClientBase.testConnection()` probed a
  non-existent `/info` route (always 404) — latent because every deployment either set
  `BCONNECT_SKIP_CONNECTIVITY_CHECK=true` or ran the gateway (which never probes). A
  standalone server started from a plain `.env` (no skip flag) failed at startup. It now
  probes a real lightweight list endpoint (`/v2.0/WindowsEndpoints?$top=1`), overridable
  via `healthCheckPath` for credentials scoped away from endpoints.
- **esbuild** dev dependency bumped `0.27.7` → `0.28.1` (Dependabot alerts; dev-only).
- **TLS: honor the OS/client CA trust store on Node ≥ 22.15** (issue #59) — an
  already-trusted enterprise CA now works without a manual export; clearer TLS errors.
- **Docs** actualized: build-from-root (workspaces) instructions, Node 22 baseline,
  gateway-only Docker guide, credentials-at-rest hardening, and a Repository layout section.

## [26.1.7] - 2026-07-14

> Version bumped `26.1.5` → `26.1.7` across the suite (26.1.6 was documented but
> never tagged/released).

### Removed (breaking)
- **Gateway token-map authentication (`MCP_AUTH_CONFIG`).** The gateway no longer
  authenticates callers or maps Bearer tokens to bConnect credentials. Per ADR-0003,
  **authentication is the operator's responsibility** — front the gateway with an
  authenticating, TLS-terminating reverse proxy / IdP — and the gateway uses a single
  `BCONNECT_*` **service credential** (bMS RBAC governs it). Removed `MCP_AUTH_CONFIG`,
  the token map, hashed-token mode, and the `hash-token` helper.

### Changed
- Gateway fail-closed default: a non-loopback bind now requires `MCP_ALLOW_NO_AUTH=true`
  (asserting an authenticating proxy is in front). Loopback bind is otherwise unchanged.
- Inbound rate limiting is now keyed **per client IP** (was per Bearer token).
- `docker-compose.gateway.yml` publishes the host port on **loopback only** by default.
- README / `docs/DOCKER.md` / `docs/INSTALLATION.md` / `docs/N8N.md` updated to the
  proxy-fronted, service-credential model, with a prominent operator-security notice.
- **Node.js baseline raised to 22 (LTS).** Docker images now build on `node:22-alpine`
  and `engines.node` is `>=20.0.0` (18 is EOL). The automatic OS-trust-store behavior
  below requires Node ≥ 22.15.

### Fixed
- **TLS: honor the OS/client CA trust store (issue #59).** Node validates TLS against
  its bundled CA list only and never reads the OS certificate store, so an internally
  signed bMS certificate that Windows already trusts still failed until the admin
  manually exported it and set `BCONNECT_CA_CERT_PATH`. On **Node.js ≥ 22.15** the
  shared client now merges the OS trust store (`tls.getCACertificates("system")`) with
  Node's bundle, so an already-trusted CA works with **zero export**. `BCONNECT_CA_CERT_PATH`
  remains an explicit override; behavior is unchanged on older Node (feature-detected).
- **Clearer TLS errors.** A certificate-not-trusted failure now returns an actionable
  message (upgrade Node, set `BCONNECT_CA_CERT_PATH`, or `NODE_EXTRA_CA_CERTS`) instead
  of a generic "cannot connect".

## [26.1.6] - 2026-06-17

### Added
- **`docker-compose.gateway.yml`** — new dedicated Docker Compose file for the
  HTTP gateway (multi-user / n8n) use case. Separates the gateway deployment from
  the stdio server deployment (`docker-compose.yml`). Includes healthcheck and
  token map volume mount.
- **`.env.gateway.example`** — new env template for the gateway, containing only
  the variables it needs: `BCONNECT_BASE_URL`, TLS settings, `MCP_AUTH_CONFIG_PATH`,
  `MCP_GATEWAY_HOST_PORT`, and commented single-credential fallback vars. Used with
  `--env-file .env.gateway`.

### Changed
- **`docker-compose.yml`** — gateway service (`mcp-gateway`) removed; stdio-only now.
- **`.env.example`** — simplified to stdio use case; gateway variables removed.
- **Token map examples** across README, `docs/INSTALLATION.md`, `docs/DOCKER.md`,
  and `docs/N8N.md` — removed `baseUrl` from per-user entries. `BCONNECT_BASE_URL`
  is set once in `.env.gateway` and shared by all tokens; `baseUrl` in a token entry
  is now documented as an advanced/multi-server override only.
- **`docs/N8N.md`** — added AI Agent + MCP tool node setup guide (Step 2: MCP Server
  credential, Step 3: wire Tool: MCP sub-node); added **Context Window & Performance**
  section with token cost table per domain combination and per-use-case domain
  recommendations.
- All gateway startup commands updated to use
  `docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d`.
- All `.env` references in gateway context corrected to `.env.gateway` across
  `docker-compose.gateway.yml`, README, `docs/INSTALLATION.md`, `docs/DOCKER.md`,
  and `docs/N8N.md`.

## [26.1.5] - 2026-06-16

### Added
- **`docs/N8N.md`** — new integration guide for using the bConnect MCP gateway
  from n8n workflows. Covers: storing Bearer tokens as n8n Header Auth credentials,
  MCP Client node configuration, HTTP Request node alternative, domain reference
  table, multi-user example (2 users / 2 bConnect API keys), troubleshooting table,
  and security notes.

### Changed
- **`docs/INSTALLATION.md` Option D** rewritten for clarity: broken into 4 explicit
  steps (build, generate tokens, create token map, start gateway); token requirements
  documented (min 32 random bytes, unique per user, descriptive prefix); placeholder
  table explains every value to replace; apiKey vs username/password options clarified;
  health check verification and `chmod 600` guidance added.
- README and `docs/INSTALLATION.md` updated with pointer to the new N8N.md.
- Version bumped to `26.1.5` across all `package.json` files, `src/index.ts` server
  version strings, and documentation footers (`DOCKER.md`, `INSTALLATION.md`,
  `TROUBLESHOOTING.md`, `WINDOWS-DEPLOYMENT.md`, `N8N.md`).
- **SBOM regenerated** (`releases/sbom.json`) using `@cyclonedx/cyclonedx-npm` 5.0.0
  (previously 4.2.1); updated timestamp, version reference, and dependency tree.
- `docker-compose.yml` gateway image tag corrected from stale `26.1.1` to `26.1.5`.

## [26.1.4] - 2026-06-16

### Added
- **Auth middleware unit tests** (`bconnect-mcp-gateway/src/__tests__/auth.test.ts`, 23 tests):
  `loadTokenMap` and `createAuthMiddleware` are now fully covered — missing file,
  invalid JSON, non-object root (all call `process.exit(1)`); auth disabled pass-through;
  401 on missing/wrong/unknown Bearer token; correct credential resolution per token;
  no credential leakage between requests; n:m sharing verified.
- **Credential injection tests** (`bconnect-compliance-mcp/src/__tests__/credentials.test.ts`,
  6 tests): verifies that `createServer(credentials)` passes injected apiKey and
  username/password to `BConnectClient`, takes priority over env vars, falls back to env
  vars when omitted, and is stateless across tool calls. `BConnectClient` is mocked so
  no real bConnect connection is made.
- **Gateway refactored** into three modules for testability: `auth.ts` (token map +
  middleware, no server imports), `app.ts` (`createApp` factory), `gateway.ts` (startup
  only). The public gateway behaviour is unchanged.
- **`bconnect-mcp-gateway`** now has `test`, `test:watch`, and `test:coverage` npm
  scripts with a `vitest.config.ts`.

## [26.1.3] - 2026-06-16

### Added
- **Gateway authentication via token map** (`MCP_AUTH_CONFIG`): `bconnect-mcp-gateway`
  now supports per-user Bearer token authentication. Set `MCP_AUTH_CONFIG` to a JSON
  file mapping tokens to bConnect credentials (baseUrl, apiKey or username/password).
  Multiple MCP tokens can share one bConnect API key (n:m mapping). When unset, the
  gateway falls back to `BCONNECT_*` env vars — fully backwards compatible.
- `BConnectCredentials` interface exported from all 13 servers; `createServer()` now
  accepts an optional `credentials` parameter so the gateway can inject per-request
  bConnect credentials without touching environment variables.
- Gateway environment variables: `MCP_GATEWAY_PORT` (default `3001`),
  `MCP_GATEWAY_BIND` (default `127.0.0.1`), `MCP_AUTH_CONFIG`.
- `/health` endpoint now reports `authEnabled` status.
- Documentation updated: README, `docs/INSTALLATION.md`, `docs/DOCKER.md` — covers
  gateway setup, token map format, and client configuration examples.

## [26.1.2] - 2026-06-09

### Fixed
- Updated copyright from "baramundi software AG" to "baramundi software GmbH"
- Resolved all runtime dependency vulnerabilities (hono, fast-uri, ip-address)
- Set author field in package.json

### Added
- Dependabot configuration for automated dependency updates
- `.editorconfig`, `.nvmrc`, and `.prettierrc.json` for contributor consistency

## [26.1.1] - 2026-06-09

Initial release. 12 domain-specific MCP servers for the baramundi bConnect REST API,
providing 212 tools across endpoints, jobs, assets, software, compliance, and more.

- 12 servers: endpoints, jobs, assets, software, activedirectory, servermanagement,
  defensecontrol, variables, operatingsystems, compliance (26R1), universaldynamicgroups (26R1),
  updatemanagement
- Compatible with baramundi Management Suite 25R2 and 26R1
- Authentication via Basic Auth or API Key
- Transport modes: stdio (local) and HTTP (network/Docker)
- Unit tests and mock-integration tests across all servers
