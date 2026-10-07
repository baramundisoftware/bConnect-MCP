# n8n Integration Guide — bConnect MCP Suite

This guide explains how to use the bConnect MCP gateway from n8n workflows —
connecting the MCP Client Tool node to the gateway and calling bConnect tools.

> **⚠️ The gateway has no built-in authentication.** Run n8n and the gateway on a
> **trusted private network** (e.g. the same Docker network, gateway on loopback),
> and/or front the gateway with an authenticating reverse proxy. Do **not** expose
> the gateway port to untrusted networks. See [DOCKER.md](DOCKER.md) → "TLS and
> authentication".

## Prerequisites

- bConnect MCP gateway running and reachable from n8n on a private network
  (see [INSTALLATION.md — Option C](INSTALLATION.md#option-c--gateway-http-multi-user))
- n8n 1.104.0 or later: the gateway speaks MCP over **HTTP Streamable**, which the MCP Client
  Tool node supports from 1.104.0 on. Choose that transport in the node (not SSE).

---

## How It Works

```
n8n Workflow
    │  POST /<domain>/mcp        (private network — no per-request token)
    ▼
bconnect-mcp-gateway :3001
    │  single BCONNECT_* service credential (bMS RBAC governs it)
    ▼
baramundi bConnect API
    https://bms.company.com:443/bconnect
```

The gateway uses one bConnect **service credential** for all calls; it does not
authenticate callers itself. Authenticate your n8n **users** in n8n (and/or at a
reverse proxy in front of both). Scope the service account to least privilege so
bMS RBAC bounds what workflows can do.

---

## Step 1 — Reach the gateway from n8n

Point the n8n MCP Client Tool node at the gateway URL on your private network — no
`Authorization` header is needed by the gateway itself. For example, with n8n and
the gateway on the same Docker network:

```
http://mcp-gateway:3001/<domain>/mcp
```

The gateway answers only host names it knows: `mcp-gateway` (the Compose default), `localhost`
and the names in `MCP_GATEWAY_ALLOWED_HOSTS`. If n8n reaches it under another name, add that
name there, or the call gets `403`. Setting the variable replaces the Compose default, so keep
`mcp-gateway` in the list.

If you front the gateway with an authenticating proxy, use the proxy URL and add
whatever credential the proxy requires (e.g. an n8n **Header Auth** credential
carrying your proxy/IdP token).

---

## Step 2 — Add an MCP Client Tool to the AI Agent

1. Add an **AI Agent** node to your workflow.
2. Connect an **MCP Client Tool** node to the agent's **Tool** input.
3. Configure it:

| Field | Value |
|-------|-------|
| **Endpoint** | `http://mcp-gateway:3001/endpoints/mcp` (private network) |
| **Server Transport** | **HTTP Streamable** (the default in current n8n versions; the gateway doesn't serve SSE) |
| **Authentication** | **None** on a trusted private network. If a proxy fronts the gateway, use **Bearer Auth** or **Header Auth** with whatever token the proxy requires. |
| **Tools to Include** | **All**, or **Selected** to offer the agent only some tools (fewer tokens, see below) |

The AI Agent now has access to exactly the 25 endpoints read tools (~6,200 tokens) —
nothing from the other 12 domains is loaded. The gateway keeps write tools off and leaves
them out of the tool list.

```
Workflow:
  [Trigger] → [AI Agent] → (answer)
                  │
                  └── [MCP Client Tool]  → /endpoints/mcp (25 tools)
```

**Adding a second domain** — add another MCP Client Tool node with that domain's endpoint:

```
  [AI Agent]
      │
      ├── [MCP Client Tool]  → /endpoints/mcp  (25 tools)
      └── [MCP Client Tool]  → /software/mcp   (11 tools)
                                        total: ~9,800 tokens
```

> **Write tools are off through the gateway.** The gateway ignores `ALLOW_WRITE_OPERATIONS` (see [DOCKER.md → Environment Variables](DOCKER.md#environment-variables)),
> so the agent sees only read tools; a write tool called by name answers "Write operation '…' is disabled".

---

## Available Domains

Each bConnect domain is a separate URL path on the gateway:

| Domain | URL path | What it covers |
|--------|----------|----------------|
| `endpoints` | `/endpoints/mcp` | Windows/Linux/Mac/Android/iOS endpoints |
| `assets` | `/assets/mcp` | Asset inventory |
| `jobs` | `/jobs/mcp` | Job definitions and instances |
| `software` | `/software/mcp` | Installed software inventory |
| `activedirectory` | `/activedirectory/mcp` | AD groups, users, OUs |
| `servermanagement` | `/servermanagement/mcp` | Server config, API keys |
| `groups` | `/groups/mcp` | Logical, static, dynamic groups |
| `variables` | `/variables/mcp` | Variable definitions and instances |
| `defensecontrol` | `/defensecontrol/mcp` | BitLocker, Defender, local admins |
| `operatingsystems` | `/operatingsystems/mcp` | OS deployment profiles |
| `compliance` | `/compliance/mcp` | CVE vulnerabilities (26R1 only) |
| `universaldynamicgroups` | `/universaldynamicgroups/mcp` | Universal Dynamic Groups (26R1 only) |
| `updatemanagement` | `/updatemanagement/mcp` | Windows Update management |

To use multiple domains in one workflow, add one MCP Client Tool node per domain,
each with its domain's endpoint (as in Step 2).

---

## Alternative — Call a Tool with the HTTP Request Node

If the MCP Client Tool node is not available in your n8n version, use an
**HTTP Request** node to call the gateway directly.

**Node configuration:**

| Field | Value |
|-------|-------|
| **Method** | POST |
| **URL** | `http://mcp-gateway:3001/endpoints/mcp` (private network) |
| **Authentication** | None on a private network; Header Auth with your proxy's token if a proxy fronts the gateway |
| **Send Headers** | `Accept: application/json, text/event-stream` (required: without it the gateway answers `406 Not Acceptable`) |
| **Content Type** | JSON |
| **Response Format** | Text (the answer is a server-sent event, not plain JSON; see below) |

**Body** (JSON):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "list_windows_endpoints",
    "arguments": {
      "PageSize": 25
    }
  }
}
```

**List available tools** first with:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

The response contains all tool names and their input schemas.

**Reading the response.** The gateway answers in the MCP Streamable HTTP format,
as a server-sent event:

```text
event: message
data: {"result":{"content":[{"type":"text","text":"…"}]},"jsonrpc":"2.0","id":1}
```

The JSON-RPC answer is the `data:` line. Parse it in a **Code** node after the
HTTP Request node, for example:

```javascript
const line = $json.data.split('\n').find((l) => l.startsWith('data: '));
return [{ json: JSON.parse(line.slice('data: '.length)) }];
```

If the tool call failed (bConnect unreachable, an API error, a refused write),
the result carries `"isError": true` and the reason in `content[0].text`.

---

## Multi-User Notes

The gateway uses a **single bConnect service credential** for all calls — it no
longer maps individual callers to separate bConnect keys. To separate users:

- **Distinguish users in n8n** (n8n user accounts / project permissions), and/or
- **Authenticate at a reverse proxy** in front of n8n and the gateway (OIDC/SSO).

bMS RBAC bounds what the shared service account can do, so scope it to least
privilege. Per-user bConnect credentials keyed by a proxy-asserted identity are a
planned option; today, permissions are governed by that single service account in
the baramundi Management Center.

---

## Context Window & Performance

This is the most important configuration decision for AI Agent workflows.

### How n8n loads MCP tools

When an n8n AI Agent node runs, it calls `tools/list` on **every configured MCP
server** and injects all returned tool definitions — name, description, full JSON
input schema — into the LLM system prompt **on every single invocation**. Tools
are not loaded lazily.

Each tool definition costs roughly 300 tokens on average (from about 200 to
over 400; the group member tools carry the largest schemas). The bConnect MCP
suite has 268 tools across 13 domains on 26R1 (230 on 25R2); through the gateway, where write
tools are off and left out of the list, an agent sees the 173 read tools (148 on 25R2).

### Token cost per configuration

| Domains connected | Tools | Approx. tokens consumed |
|-------------------|-------|------------------------|
| `endpoints` only | 25 | ~6,200 |
| `endpoints` + `software` | 36 | ~9,800 |
| `endpoints` + `jobs` + `assets` | 60 | ~17,700 |
| `endpoints` + `software` + `jobs` + `assets` + `activedirectory` | 87 | ~26,300 |
| All 13 domains | 173 | ~53,900 |

Measured on 26R1 from the gateway's `tools/list` answers, which contain only read tools (about
189,000 characters of tool definitions for all 13 domains, at roughly 3.5 characters per token). The
exact count depends on the model's tokenizer and on how n8n passes the tools on.

At ~54,000 tokens for tool definitions alone, every call of the AI Agent spends a
large part of the context window before any conversation, user data, or system
instructions.

### Rule: connect only what the workflow needs

Each n8n workflow should configure only the domains it actually uses:

| Workflow purpose | Recommended domains |
|-----------------|--------------------|
| Endpoint inventory / reporting | `endpoints` |
| Software audit | `endpoints`, `software` |
| Job automation | `jobs`, `endpoints` |
| Compliance review | `compliance`, `endpoints` |
| AD group management | `activedirectory`, `groups` |
| Full IT ops assistant | pick 3–5 max |

The gateway's domain-per-URL design makes this straightforward — add one MCP
Client Tool node per domain you need and leave the rest out. Within a domain,
**Tools to Include → Selected** narrows it further.

### Never connect all 13 domains to a single AI Agent

Even with a large-context model, loading all 173 tool definitions wastes tokens
on tools the workflow will never call, increases latency, and reduces the model's
effective reasoning budget for actual work.

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `404 Unknown MCP domain` | Wrong domain in the URL | Check the URL path matches one of the domains listed above |
| `405 Method Not Allowed` | GET request sent instead of POST, or the MCP Client Tool node set to **Server Sent Events** | Use POST in the HTTP Request node; choose **HTTP Streamable** in the MCP Client Tool node |
| `406 Not Acceptable` | HTTP Request node without the `Accept` header | Add `Accept: application/json, text/event-stream` |
| `Write operation '…' is disabled` | Writes are off through the gateway | See the note in Step 2 |
| Gateway not reachable | Network or firewall issue | Verify `curl http://mcp-gateway:3001/health` returns `{"status":"ok","servers":[…],"count":13}` |
| Gateway refuses to start | Non-loopback bind without `MCP_ALLOW_NO_AUTH=true` | Bind loopback, or set `MCP_ALLOW_NO_AUTH=true` once a proxy is in front |
| Tool call fails with credential error | bConnect rejects the service credential | Verify the `BCONNECT_API_KEY` (or `BCONNECT_USERNAME`/`BCONNECT_PASSWORD`) in `.env.gateway` is valid in baramundi Management Center → Server Management → API Keys |

---

## Security Notes

- **The gateway has no built-in auth.** Keep it on a trusted private network and/or
  behind an authenticating reverse proxy; never expose its port to untrusted networks.
- **Use HTTPS** in front of the gateway in production (TLS terminated by your proxy).
- **Authenticate n8n users** in n8n and/or at the proxy — not at the gateway.
- **Scope the bConnect service credential** to least privilege; bMS RBAC bounds it.

---

*bConnect MCP Suite — see [INSTALLATION.md](INSTALLATION.md) for full setup instructions.*
