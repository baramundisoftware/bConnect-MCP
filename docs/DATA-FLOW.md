# Data Flow — what leaves your network, and where it goes

Written for the security review that has to approve this before it is deployed. It
answers one question: **if we connect the baramundi Management Suite to a language
model, what estate data ends up outside our network?**

Short version: **whatever a tool returns becomes part of the conversation your MCP
client sends to whatever model it is configured to use.** The suite itself sends
nothing anywhere except to your bMS. It has no model, no model credential, no
telemetry, and no update check. Which model sees your estate data — and under whose
retention policy — is decided entirely by the client and model you point at it, not by
this software.

Everything below is checkable against the source; where a claim rests on a specific
file or control, it is named.

---

## The chain

```
  your estate                                          outside your network
 ─────────────────────────────────────────────────┬───────────────────────────
                                                  │
  bMS  ──bConnect REST──▶  bconnect-*-mcp  ──▶  MCP client  ──▶  model provider
  (HTTPS, your                (a local          (Claude Desktop,   (whatever the
   service credential)         Node process)     VS Code, n8n,      client is
                                                 LibreChat, …)      configured
                                                  │                 with — may be
                                                  │                 local)
                                                  │
                        ◀── the only outbound connection the suite itself makes
                            is the one on the left: to BCONNECT_BASE_URL
```

Two links, two different owners:

1. **bMS → MCP server.** HTTPS to `BCONNECT_BASE_URL`, authenticated with one bMS
   service credential. This is inside your network (or to your baramundi Gateway if you
   use one). `http://` is refused unless you explicitly set
   `BCONNECT_ALLOW_INSECURE_HTTP`, because the v1.1 path carries a domain account's
   Basic header.
2. **MCP client → model provider.** Not this software. The client takes the tool result
   the server handed it, puts it in the model's context, and sends it wherever it is
   configured to send it. If that model is hosted, the tool result goes to that host and
   is subject to **that provider's** retention, logging and training policy.

**The suite has no idea which model is on the other end, and never talks to it.** There
is no model API key anywhere in this repository and no code path that contacts a model
provider.

---

## What crosses the boundary toward the model

Anything a tool returns. In practice that means bMS records, in the shape bConnect
returns them, with two suite-side reductions applied by default (below):

| Domain | What a tool result can contain |
|--------|-------------------------------|
| `endpoints` | Device display names, host names, OS and version, last-seen timestamps, agent versions, logical-group membership, IP/MAC on network endpoints, Entra device ids |
| `groups`, `universaldynamicgroups` | Group names, hierarchy, membership |
| `jobs` | Job and job-definition names, schedules, targets, instance state, **failure text produced on the endpoint** |
| `software` | Installed-software inventory per endpoint — product names, versions, vendors — and software bundles |
| `assets` | Asset inventory records and their custom fields, whatever your estate stores in them |
| `compliance` | Rule violations and detected CVEs per endpoint — i.e. **which of your machines are unpatched and how** |
| `defensecontrol` | BitLocker and Defender status, threat detections, local administrative accounts |
| `activedirectory` | AD groups, users, organisational units, and the objects linked to endpoints |
| `servermanagement` | Management-server configuration, microservices, security groups, API-key **metadata** |
| `variables` | Variable definitions and their instance values |
| `operatingsystems`, `updatemanagement` | OS deployment profiles and folders; Windows Update state |

Treat that list as "personal and infrastructure data": device names and registered users
are frequently personally identifying, and a compliance answer is an inventory of your
unpatched machines. That is the point of the product, and it is also the thing to put in
front of your data-protection review.

### Two reductions the suite applies by default

Neither is a security control — they reduce volume, which reduces exposure:

- **Compact rows.** The `list_*` tools in `bconnect-endpoints-mcp`, `bconnect-jobs-mcp`
  and `bconnect-software-mcp` return a small projection rather than the raw API record
  unless the caller passes `detail: true`.
- **`countOnly: true`.** Every `list_*` tool suite-wide can answer "how many?" with
  `{ totalItems }` and no rows at all.

### The highest-value reads, and the gate on them

Two tool families return **live credentials** in their response body, and are refused
unless `ALLOW_SECRET_READ=true`:

- `get_bitlocker_secrets` — BitLocker recovery keys and PINs
- `get_local_admin_accounts` / `patch_local_admin_user_credentials` — cleartext LAPS
  passwords
- `list_api_keys` — bMS API-key inventory (`name`, `expirationDate`, `comment`,
  `isActive`, `securityProfiles`). **No key material**: bConnect's `/v2.0/ApiKeys`
  declares `get` only and returns no usable key.

The gate is enforced twice: at the tool name, and at the HTTP layer in
`packages/mcp-core/src/security-routes.ts`, which refuses the request whatever server or
tool name issued it. `ALLOW_SECRET_READ` is **off by default**, precisely so a recovery
key cannot land in a model transcript by accident. If you turn it on, a recovery key can
and will end up in the model context and in whatever transcript your client keeps.

---

## What never leaves the machine the server runs on

- **The bConnect credential.** `BCONNECT_API_KEY`, or `BCONNECT_USERNAME` /
  `BCONNECT_PASSWORD`, and the v1.1 domain account if you enable it. These are read from
  the environment (typically the file `--env-file` points at), sent only in the request
  header to `BCONNECT_BASE_URL`, and are **never part of a tool result**. Three specific
  escape routes were closed and are regression-tested in
  `__tests__/suite-credential-containment.test.ts`: redirects are refused outright
  (`maxRedirects: 0`, because `X-Api-Key` is not on the header-stripping list that
  protects `Authorization`), error objects are never handed to `console.error` (a stdio
  host captures stderr verbatim to disk), and a plaintext `http://` base URL is refused.
- **The `--env-file` file itself.** Nothing reads it back into a response.
- **The audit log.** `BCONNECT_AUDIT_LEVEL` writes to **stderr**, or to
  `BCONNECT_AUDIT_FILE` if you set one. It stays on that host. Parameters are redacted
  before they are logged, and only if you opt in with
  `BCONNECT_AUDIT_INCLUDE_PARAMS=true`.
- **The response cache.** In-memory, per process, discarded on exit. No disk, no
  network.
- **The gateway access log.** Method, path, status, duration, client IP — written by the
  gateway process where it runs.

---

## Where the suite itself connects

Exactly one destination: `BCONNECT_BASE_URL`, plus the bConnect v1.1 root derived from
it on the same host (only if you set `BCONNECT_ENABLE_V11=true`).

There is **no** telemetry, usage reporting, crash reporting, licence check, update check
or analytics of any kind. Nothing in the suite contacts the vendor, this project, a
package registry, or a model provider at runtime. If your network policy is "this box
may reach the bMS and nothing else", that is a working configuration.

---

## The one case where a provider's cloud reaches into your network

Most clients run on your side of the boundary: the client calls the MCP server or the
gateway locally, gets a result, and only then sends that result onward to a model. Two
supported targets invert that:

- **OpenAI Responses API, hosted MCP tool** — OpenAI's servers make the HTTP call to
  your gateway URL. The gateway must therefore be reachable from OpenAI's infrastructure
  (public name or tunnel). The Agents SDK's `MCPServerStdio` does **not** do this: it
  spawns the server in your own process, needs no gateway and no inbound path.
- **Microsoft Copilot Studio** — reaches your gateway through a Power Platform
  connector, so the call originates in Microsoft's cloud.

For those two, the gateway is an inbound path from a third party into your estate, not
just an outbound disclosure. The gateway's own bearer token is a single shared secret
that does not expire, does not identify a caller and cannot be revoked for one consumer
— it is not sufficient on its own for an internet-reachable endpoint. Put a
TLS-terminating proxy that authenticates a **person** in front of it. See
[DOCKER.md → TLS and authentication](DOCKER.md#tls-and-authentication-operator-responsibility).

---

## What you control

In descending order of effect:

1. **Which model your client is pointed at.** A self-hosted model (Continue or LibreChat
   against a local runtime) means estate data never leaves your network at all. This is
   the only control that changes the answer categorically.
2. **Which servers you deploy.** Each one you leave out is a category of estate data
   that cannot be read. Deploy `bconnect-endpoints-mcp` alone and no compliance,
   software or BitLocker data can reach anything.
3. **bMS RBAC on the service account.** The suite reads exactly what that account can
   read. Scope it to the union of the modules of the servers you deployed, and nothing
   more. A credential that cannot read BitLocker cannot leak BitLocker, however a
   request reaches that route.
4. **The gates.** `ALLOW_SECRET_READ`, `ALLOW_WRITE_OPERATIONS`,
   `ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT` are off by default. `ALLOWED_WRITE_TOOLS` narrows
   the write gate to a named list (`bconnect-jobs-mcp` today).
5. **Per-domain connections on the gateway.** Each domain is its own URL path, so a
   workflow or agent can be given one domain and structurally cannot see the rest.
6. **`countOnly` and the default compact projections**, which keep volume down for
   questions that only need a number.

---

## Direction of trust, the other way

Estate data is **untrusted input to the model**, not just output from bMS. Endpoint
names, job names, group names, registered-user names and job-failure text are all
operator-controllable inside your estate; anyone who can rename an endpoint can put text
into your model's context. `packages/mcp-core/src/untrusted-text.ts` strips characters
that are never legitimate in a bMS object name (zero-width, bidirectional overrides,
Unicode TAG characters, C0/C1 controls) and bounds length — it is **not** an
instruction sanitiser, and it is not claimed to be one. The real control is not running
`ALLOW_WRITE_OPERATIONS` on an unattended agent loop. See
[SECURITY.md](../SECURITY.md).

---

## What this document does not claim

- It does not describe your MCP client's behaviour: what it retains, what it logs, or
  what it sends to a model on a turn where no tool was called. Ask your client vendor.
- It does not describe any model provider's retention or training policy.
- It says nothing about a bMS that has been compromised, a host running the MCP server
  that has been compromised, or a model host that is itself hostile. Those are out of
  scope in [SECURITY.md](../SECURITY.md) and remain out of scope here.
