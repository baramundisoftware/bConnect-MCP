# Configuration Reference

Every server in the suite reads the same environment variables. The four you need for a
first run are in the [suite README](../README.md); this page is the complete list.

## Connection

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_BASE_URL` | Yes | — | bConnect API URL (e.g. `https://bms.company.com:443/bconnect`) |
| `BCONNECT_API_KEY` | Yes* | — | API key for authentication |
| `BCONNECT_USERNAME` | Yes* | — | Username for Basic Auth |
| `BCONNECT_PASSWORD` | Yes* | — | Password for Basic Auth |
| `BCONNECT_CA_CERT_PATH` | — | — | Path to CA certificate (PEM) for self-signed certs |
| `BCONNECT_SKIP_CONNECTIVITY_CHECK` | — | `false` | Skip the startup connectivity probe **and the 26R1 version gate with it**. For deployments that cannot reach `GET /v2.0/ManagementServer` |
| `BCONNECT_TIMEOUT_MS` | — | `30000` | HTTP request timeout in milliseconds |
| `BCONNECT_MAX_RETRIES` | — | `0` | Number of automatic retries for failed requests |
| `BCONNECT_RETRY_DELAY_MS` | — | `100` | Delay between retries in milliseconds |

> \* **Authentication**: provide either `BCONNECT_API_KEY` alone, or both `BCONNECT_USERNAME` and `BCONNECT_PASSWORD`. API key takes precedence if both are set.

## Auditing and rate limiting

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCONNECT_AUDIT_LEVEL` | — | `none` | Audit logging: `none`, `security`, `write`, or `all` |
| `BCONNECT_AUDIT_INCLUDE_PARAMS` | — | `false` | Include tool call parameters (redacted) in audit log entries |
| `BCONNECT_RATE_LIMIT_ENABLED` | — | `false` | Enable rate limiting to protect the bConnect API |

## Write and secret gates

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ALLOW_WRITE_OPERATIONS` | — | `false` | Advertise **and** enable the suite's create/update/delete/start tools (9 servers, 80 tool schemas). With the gate shut, write tools are hidden from `tools/list` (a token-cost optimization) but still dispatch — a direct call by name is refused with an actionable message either way |
| `ALLOW_SECRET_READ` | — | `false` | Enable tools that can return BitLocker recovery keys and LAPS passwords (`bconnect-defensecontrol-mcp`). Refused until set to `true` |
| `ALLOWED_WRITE_TOOLS` | — | unset | Narrows `ALLOW_WRITE_OPERATIONS` to an explicit, comma-separated subset of tool names for this process (e.g. `assign_job_to_static_group,start_job_instance`). Implemented in `bconnect-jobs-mcp` only today — setting it for any other server's write tools is a silent no-op. Unset changes nothing: all-or-nothing behaviour under `ALLOW_WRITE_OPERATIONS` |
| `ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT` | — | `false` | Permits assigning a job the bMS itself flags `Destructive` (`bconnect-jobs-mcp`). The check that enforces this needs bConnect v1.1 credentials (see `BCONNECT_ENABLE_V11` below) to read the flag at all — without them the assignment proceeds regardless of this variable |
| `BCONNECT_ENABLE_V11` | — | `false` | Opt-in to the bConnect v1.1 (SOAP-adjacent) surface used for a handful of read tools (`preview_assignment`, `explain_job_failure`) and the Destructive-job check above. Also requires `BCONNECT_V11_USERNAME`/`BCONNECT_V11_PASSWORD` (a domain account, Basic auth, management-LAN only); without all three, v1.1 tools are absent from `tools/list` and the Destructive check silently cannot run |

## Transport and gateway

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MCP_TRANSPORT` | — | `stdio` | Transport: `stdio` (local) or `http` (network) |
| `MCP_PORT` | — | `3000` | HTTP port (when `MCP_TRANSPORT=http`) |
| `MCP_GATEWAY_PORT` | — | `3001` | Gateway listen port (when using `bconnect-mcp-gateway`) |
| `MCP_GATEWAY_BIND` | — | `127.0.0.1` | Gateway bind address (loopback-only unless behind a proxy) |
| `MCP_ALLOW_NO_AUTH` | — | `false` | Allow a non-loopback gateway bind with no `MCP_GATEWAY_AUTH_TOKEN`; asserts an authenticating proxy is in front. Not set by anything shipped in this repo |
| `MCP_GATEWAY_AUTH_TOKEN` | — | — | One or more shared bearer tokens (comma-separated for rotation), required on every `Authorization: Bearer <token>` HTTP request to the gateway once set. 24+ characters, or the gateway refuses to start. See [MIGRATION-tool-surface.md § Gateway authentication](MIGRATION-tool-surface.md#9-gateway-authentication-bconnect-mcp-gateway-sec-7) |
| `MCP_GATEWAY_AUTH_TOKEN_FILE` | — | — | Docker-secret form of `MCP_GATEWAY_AUTH_TOKEN` — path to a file containing the token |

There is no `BCONNECT_RELEASE` setting: the suite is 26R1-only and detects the bMS
version itself at startup.

## How to find your bMS server URL

1. Open the **baramundi Management Center** on your bMS server
2. The server address is the machine name or IP where bMS is installed
3. bConnect listens on **port 443** by default (HTTPS). If your installation uses a different port (e.g. **444** in older/test setups), use that port instead — you can check it in the bConnect settings of the Management Center
4. Your URL will be: `https://<server-name>:443/bconnect`

## How to generate an API key

1. Open the **baramundi Management Center**
2. Go to **Server Management > API Keys**
3. Click **Create New API Key**
4. Give it a descriptive name (e.g. "MCP Server bConnect")
5. Copy the generated key — you won't see it again
6. Use this key as `BCONNECT_API_KEY`

## SSL/TLS certificates

If your bMS server uses a self-signed or internal CA certificate:

**Recommended** — provide the CA certificate:

```env
BCONNECT_CA_CERT_PATH=/path/to/your-ca-cert.pem
```

**Development only** (not for production!):

```env
NODE_TLS_REJECT_UNAUTHORIZED=0
```

Node.js 22.15+ honours the OS/Windows CA trust store automatically, which is usually
enough on a domain-joined machine.
