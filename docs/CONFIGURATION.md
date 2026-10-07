# Configuration

Every setting of the bConnect MCP servers and the HTTP gateway, in one place. The servers and the
gateway are configured through environment variables only.

- **A server started by an MCP client** (Claude Desktop, Claude Code, …): set the variables in the
  client configuration's `env` block, or keep them out of it with `node --env-file`
  ([CLIENTS.md](CLIENTS.md)).
- **A server you start yourself:** it also reads a `.env` file from the **current working
  directory** (copy the server's `.env.example`). A variable that is already set is never
  overridden by the file.
- **The HTTP gateway:** with Compose, set the variables in `.env.gateway`
  (`.env.gateway.example` lists them); `docker-compose.gateway.yml` passes them on. See
  [DOCKER.md](DOCKER.md). Started with Node.js, it also reads a `.env` file from its working
  directory, but only after its logger and the gates are set up: `LOG_LEVEL`, `LOG_FORMAT` and the
  write and secret gates have no effect there.

Each server's README lists exactly the variables that server reads (a test checks it) and says
where a setting behaves differently for that server.

**Invalid values.** A server stops at startup, with a message naming the setting, on a missing base
URL or credential, a non-ASCII password, a CA file it can't read, and an invalid
`BCONNECT_RELEASE`, `BCONNECT_TIMEOUT_MS`, `BCONNECT_MAX_RETRIES`, `BCONNECT_AUDIT_LEVEL` or
`BCONNECT_PRETTY_JSON`. The gateway stops at startup on an invalid `BCONNECT_RELEASE` or
`BCONNECT_PRETTY_JSON` or a `*_FILE` it can't read; for the others, every tool call reports the
problem. The switches (`ALLOW_*`, `MCP_ALLOW_NO_AUTH`, `BCONNECT_RATE_LIMIT_ENABLED`,
`BCONNECT_SKIP_CONNECTIVITY_CHECK`, …) take effect only when set to exactly `true`; other numbers
and levels that aren't checked fall back to their default.

**Contents:** [Connection](#connection) · [TLS and CA certificates](#tls-and-ca-certificates) ·
[Write and secret gates](#write-and-secret-gates) ·
[Results, auditing and rate limiting](#results-auditing-and-rate-limiting) ·
[A server's own HTTP mode](#a-servers-own-http-mode) · [Gateway](#gateway) ·
[How to find your bMS server URL](#how-to-find-your-bms-server-url) ·
[How to generate an API key](#how-to-generate-an-api-key)

---

## Connection

### `BCONNECT_BASE_URL`

**Required.** The bConnect base URL, e.g. `https://bms.corp.local:443/bconnect` (see
[How to find your bMS server URL](#how-to-find-your-bms-server-url)). It must be `https://`, except
to this machine (see [`BCONNECT_ALLOW_INSECURE_HTTP`](#bconnect_allow_insecure_http)). Without it a
server doesn't start; in the gateway every tool call fails.

### `BCONNECT_API_KEY`

**One credential is required:** this API key, or [`BCONNECT_USERNAME`](#bconnect_username) and
[`BCONNECT_PASSWORD`](#bconnect_password). The key is used instead of them when both are set. See
[How to generate an API key](#how-to-generate-an-api-key).

### `BCONNECT_USERNAME`

User for Basic authentication, together with `BCONNECT_PASSWORD` (the alternative to an API key).
Latin-1 characters only (e.g. `ö` works, `€` doesn't).

### `BCONNECT_PASSWORD`

Password for `BCONNECT_USERNAME`. **ASCII characters only:** bConnect's API rejects a password with
`§`, an umlaut or `ß` (401) even though Windows accepts it, so such a password is refused at
startup (in the gateway: on every tool call) before anything is sent, and no attempt counts toward
the account lockout. Use an ASCII-only password or an API key.

The credentials are stored in plaintext wherever you put them (`.env`, a client configuration):
restrict the file to the running user, use a least-privilege bMS service account, and never commit
it. See [SECURITY.md → Credentials at rest](../SECURITY.md#credentials-at-rest-env-and-client-config).

### `BCONNECT_API_KEY_FILE`

Gateway only: a file whose content is the API key, instead of `BCONNECT_API_KEY` in the
environment (the Docker / Compose secrets convention), e.g. `/run/secrets/bms_api_key`. The shipped
compose file mounts no secrets; [DOCKER.md](DOCKER.md) shows an override file that does.

### `BCONNECT_USERNAME_FILE`

Gateway only: a file whose content is the user name, instead of `BCONNECT_USERNAME`; as
[`BCONNECT_API_KEY_FILE`](#bconnect_api_key_file).

### `BCONNECT_PASSWORD_FILE`

Gateway only: a file whose content is the password, instead of `BCONNECT_PASSWORD`; as
[`BCONNECT_API_KEY_FILE`](#bconnect_api_key_file).

### `BCONNECT_RELEASE`

**Default:** `26R1`. The fallback for the release of your bMS: `26R1` or `25R2`, spelt exactly so.
Each server (and the gateway, with its service credential) reads the release from the bMS at
startup (`version` of the management server; the account needs read access to server management)
and uses this value only when it can't; a different value is overridden, with a warning. The
release selects the tools and list filters for that release and the API documentation used to
explain an error. On 25R2 the compliance and universaldynamicgroups servers stop at startup: their
APIs need 26R1 (in the gateway they list no tools).

### `BCONNECT_TIMEOUT_MS`

**Default:** `30000`. How long to wait for bConnect's answer, in milliseconds, 1000 to 600000. A
request that runs out says so ("didn't answer within …"). Slow reads on a busy bMS may need
`90000`.

### `BCONNECT_MAX_RETRIES`

**Default:** `0`. Retries for read requests (GET) after a network error, a timeout or HTTP
502/503/504, 0 to 5. Write requests are never retried. A read can then take up to (retries + 1) ×
the timeout, e.g. 90 s with 2 retries and the default timeout; keep that below your MCP client's
own timeout.

### `BCONNECT_SKIP_CONNECTIVITY_CHECK`

**Default:** off. `true` skips a server's startup calls to bConnect (the release detection and the
connectivity check); the settings are still checked, and the release comes from
[`BCONNECT_RELEASE`](#bconnect_release). The gateway makes no connectivity check; with this set it
also skips its release detection.

### `BCONNECT_ALLOW_INSECURE_HTTP`

**Default:** off. `true` allows an `http://` base URL to a host other than this machine, which
sends the bConnect credentials unencrypted; the server warns once at startup. Test setups only.
`http://` to `localhost`, `127.x.x.x` or `[::1]` (the bundled mock) needs no opt-in.

---

## TLS and CA certificates

If your bMS server uses a certificate from an internal CA:

- On **Node.js 22.15 or later** the servers also trust the machine's operating-system certificate
  store, so a CA the machine already trusts needs no setting.
- Otherwise set [`BCONNECT_CA_CERT_PATH`](#bconnect_ca_cert_path), or Node's own
  `NODE_EXTRA_CA_CERTS`, to the CA certificate. How to export it from the bMS:
  [INSTALLATION.md → TLS / SSL Configuration](INSTALLATION.md#tls--ssl-configuration).
- In the gateway container, the operating-system store is the image's own, so an internal CA always
  needs `BCONNECT_CA_CERT_PATH` (or `NODE_EXTRA_CA_CERTS`) ([DOCKER.md → Custom CA Certificates](DOCKER.md#custom-ca-certificates)).

### `BCONNECT_CA_CERT_PATH`

PEM file with the CA certificate that signed the bMS server certificate. When set, only this CA is
trusted; when unset, Node's default and (Node 22.15 or later) the operating system's trusted CAs are
used. The server stops at startup if the file can't be read or is empty.

### `NODE_TLS_REJECT_UNAUTHORIZED`

**Leave it unset**, not even for a test. `0` turns certificate verification off for every TLS
connection of the process, so anyone in the network path can pose as the bMS, receive the
credentials and send the model forged data. Trust the CA instead (above).

---

## Write and secret gates

Both are off by default, and a running server doesn't pick up a change: set the value, then restart
the server. The assistant can't set them.

**The HTTP gateway ignores both:** it has no authentication of its own, so whoever reaches it could
use them. Every write tool and every tool that returns credentials is refused there, write tools are
left out of its tool lists, and the gateway logs a warning at startup if either was set. This stays
so until the gateway has its own authentication.

### `ALLOW_WRITE_OPERATIONS`

**Default:** off. `true` enables the tools that create, change or delete data, or start actions
(create, update, delete, start, assign, …). Off, they are left out of the tool list, which keeps
their descriptions out of the model's context, and refused when called by name.

With it on, the assistant can create, change, start, assign and delete many bMS objects, within
what bConnect exposes and what the service account is allowed to do. It can't author what bConnect
doesn't expose: the steps of a job definition are read-only over bConnect, so it can create and
assign instances of an existing job, not define a new one; it bundles already-imported
applications, not installer packages.

### `ALLOW_SECRET_READ`

**Default:** off. `true` lets the defensecontrol tools return live credentials:
`get_bitlocker_secrets` and `update_bitlocker_pin` (BitLocker recovery keys and startup PIN),
`get_local_admin_accounts` and `patch_local_admin_user_credentials` (cleartext LAPS password). Off,
those secrets can't land in a model's context or transcript by accident. It is independent of
`ALLOW_WRITE_OPERATIONS`: the two write tools need both. Every server reads it (the shared client
checks it), but only defensecontrol has tools that use it. Set it only on a server where retrieving
these secrets is an intended, authorized use.

---

## Results, auditing and rate limiting

### `BCONNECT_PRETTY_JSON`

**Default:** `false`. `true` writes tool results as indented JSON, as earlier versions did, for
debugging. By default they are compact JSON, which keeps 16–22 % of each result out of the model's
context (measured on list results). `true` or `false`, in any case.

### `BCONNECT_AUDIT_LEVEL`

**Default:** `none`. `none`, `security`, `write` or `all`, in any case. Levels are cumulative:
`security` records security-relevant calls (credentials, API keys, rights, security groups and
profiles, enrollments, restarts) and refused requests, `write` adds every write, `all` records
every request. Entries go to stderr. What each level records: [AUDIT.md](AUDIT.md).

### `BCONNECT_RATE_LIMIT_ENABLED`

**Default:** off. `true` limits the requests a server sends to bConnect, across all its tool calls
(in the gateway: per domain); a call over the limit fails at once. This limits **outbound** calls to
the bMS; the gateway's **inbound** limit is [`MCP_GATEWAY_RATE_LIMIT_ENABLED`](#mcp_gateway_rate_limit_enabled).

### `BCONNECT_RATE_LIMIT_MAX_REQUESTS`

**Default:** `100`. Requests allowed per window when the rate limit is on.

### `BCONNECT_RATE_LIMIT_WINDOW_MS`

**Default:** `60000`. Window length in milliseconds.

---

## A server's own HTTP mode

A server normally talks to its MCP client over stdio. These settings run one server over HTTP
instead. To serve several users, use the [gateway](#gateway).

### `MCP_TRANSPORT`

**Default:** `stdio`. `http` serves MCP over HTTP instead of stdio. Not used when the gateway hosts
the servers.

### `MCP_PORT`

**Default:** `3000`. Port in HTTP mode.

### `MCP_BIND`

**Default:** `127.0.0.1`. Address to bind in HTTP mode. HTTP mode has no client authentication: keep
it on loopback, or put an authenticating reverse proxy in front.

### `MCP_ALLOWED_HOSTS`

HTTP mode answers only requests addressed to `localhost`, `127.0.0.1`, `[::1]` or a host name
listed here (comma-separated, ports ignored); others get 403. The gateway has
[`MCP_GATEWAY_ALLOWED_HOSTS`](#mcp_gateway_allowed_hosts).

### `MCP_ALLOW_NO_AUTH`

**Default:** off. `true` allows binding a server's HTTP mode, or the gateway, to an address other
than loopback, without authentication. It asserts that an authenticating proxy is in front; not
recommended otherwise.

---

## Gateway

The gateway serves all 13 servers over HTTP with one bConnect service credential; it reads the
settings above (except `MCP_TRANSPORT`, `MCP_PORT`, `MCP_BIND` and `MCP_ALLOWED_HOSTS`) and these. The image and the compose file set a
few defaults of their own; [DOCKER.md](DOCKER.md) says which.

### `MCP_GATEWAY_PORT`

**Default:** `3001`. Gateway listen port.

### `MCP_GATEWAY_BIND`

**Default:** `127.0.0.1` (the image and the compose file: `0.0.0.0`). Gateway bind address; any
address other than loopback also needs [`MCP_ALLOW_NO_AUTH`](#mcp_allow_no_auth).

### `MCP_GATEWAY_ALLOWED_HOSTS`

Host names the gateway answers to besides `localhost`, `127.0.0.1` and `[::1]`, comma-separated
(ports ignored); requests addressed to other names get 403. List the name your proxy passes on as
`Host`, and the Docker service name for clients on the same network (the compose file sets
`mcp-gateway`; setting it replaces that, so keep `mcp-gateway` in your list).

### `MCP_GATEWAY_RATE_LIMIT_ENABLED`

**Default:** `true`. Per-client-IP rate limiting of the requests the gateway receives; only exactly
`false` turns it off. `/health` is never limited.

### `MCP_GATEWAY_RATE_LIMIT_MAX`

**Default:** `300`. Requests per window, per client IP.

### `MCP_GATEWAY_RATE_LIMIT_WINDOW_MS`

**Default:** `60000`. Rate-limit window in milliseconds.

### `MCP_GATEWAY_MAX_BODY`

**Default:** `1mb`. Largest request body the gateway accepts; a larger one gets HTTP 413 with a
JSON-RPC error.

### `LOG_LEVEL`

**Default:** `info`. Gateway log level: `error`, `warn`, `info` or `debug`.

### `LOG_FORMAT`

**Default:** `text`. Gateway log format: `text` or `json` (for ELK, Loki and the like). The gateway
writes an access log line for every request (method, path, status, duration, client address).

---

## How to find your bMS server URL

1. Open the **baramundi Management Center** on your bMS server.
2. The server address is the machine name or IP where bMS is installed.
3. bConnect listens on **port 443** by default (HTTPS). If your installation uses a different port
   (e.g. **444** in older or test setups), use that port instead; you can check it in the bConnect
   settings of the Management Center.
4. Your URL is `https://<server-name>:443/bconnect`.

## How to generate an API key

1. Open the **baramundi Management Center**.
2. Go to **Server Management > API Keys**.
3. Click **Create New API Key**.
4. Give it a descriptive name (e.g. "MCP Server bConnect").
5. Copy the generated key; you won't see it again.
6. Use it as [`BCONNECT_API_KEY`](#bconnect_api_key).
