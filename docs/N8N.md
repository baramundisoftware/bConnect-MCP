# n8n Integration Guide — bConnect MCP Suite

This guide explains how to use the bConnect MCP gateway from n8n workflows —
connecting the MCP Client node to the gateway and calling bConnect tools.

> **⚠️ The gateway requires a bearer token (`MCP_GATEWAY_AUTH_TOKEN`) as of the
> 2026-08-02 revision.** Every request — including from n8n — must carry
> `Authorization: Bearer <token>`, or the gateway returns `401` before it calls any
> tool. A shared token is the floor: still run n8n and the gateway on a **trusted
> private network** (e.g. the same Docker network, gateway on loopback), and/or front
> the gateway with an authenticating reverse proxy for per-user identity or SSO. Do
> **not** expose the gateway port to untrusted networks. See
> [DOCKER.md](DOCKER.md) → "TLS and authentication".

## Prerequisites

- bConnect MCP gateway running and reachable from n8n on a private network
  (see [INSTALLATION.md — Option C](INSTALLATION.md#option-c--gateway-http-multi-user))
- n8n 1.22 or later (MCP Client node requires n8n 1.22+)

---

## How It Works

```
n8n Workflow
    │  POST /<domain>/mcp        (Authorization: Bearer <MCP_GATEWAY_AUTH_TOKEN>)
    ▼
bconnect-mcp-gateway :3001
    │  single BCONNECT_* service credential (bMS RBAC governs it)
    ▼
baramundi bConnect API
    https://bms.company.com:443/bconnect
```

The gateway uses one bConnect **service credential** for all calls; the bearer token
authenticates the *caller to the gateway*, not the caller to bConnect. Authenticate
your n8n **users** in n8n (and/or at a reverse proxy in front of both) — the token
alone does not distinguish individual n8n users. Scope the service account to least
privilege so bMS RBAC bounds what workflows can do.

---

## Step 1 — Reach the gateway from n8n

Point the n8n MCP Client node at the gateway URL and supply the bearer token as a
**Header Auth** credential (`Authorization: Bearer <token>`). For example, with n8n
and the gateway on the same Docker network:

```
http://mcp-gateway:3001/<domain>/mcp
```

If you additionally front the gateway with an authenticating proxy, use the proxy
URL instead and have the proxy forward its own `Authorization: Bearer <token>` to
the gateway — the proxy authenticates the human, the token still authenticates the
proxy's calls to the gateway.

---

## Step 2 — Add an MCP Server Credential

The MCP Server credential bundles the URL (and any proxy auth) so you can reuse
it across multiple workflow nodes.

1. In n8n go to **Credentials → Add Credential → MCP Server**
2. Fill in:

| Field | Value |
|-------|-------|
| **Name** | e.g. `bConnect Endpoints` |
| **URL** | `http://mcp-gateway:3001/endpoints/mcp` (private network) |
| **Authentication** | **Header Auth** — header name `Authorization`, value `Bearer <MCP_GATEWAY_AUTH_TOKEN>`. If a proxy also fronts the gateway, use the proxy URL and whatever additional credential/session it requires; the proxy forwards its own bearer token to the gateway. |

3. Save

Repeat for each domain you need — one MCP Server credential per domain URL.

---

## Step 3 — Wire the AI Agent node

1. Add an **AI Agent** node to your workflow
2. Add a **Tool: MCP** sub-node connected to the AI Agent
3. In the MCP tool node, set **Credential** to your `bConnect Endpoints` credential

The AI Agent now has access to exactly the endpoints domain's tools — nothing from
the other 12 domains is loaded. As of the 2026-08-02 tool surface revision, write
tools are additionally hidden from `tools/list` unless the gateway's
`ALLOW_WRITE_OPERATIONS=true` is set: **10 tools (~2,200 tokens)** in the default
(read-only) posture, **31 tools (~5,600 tokens)** with the gate open. Hiding is a
token optimization, not a capability cut — a write tool called by name still works,
or is refused, exactly as it would with the gate open.

```
Workflow:
  [Trigger] → [AI Agent] → (answer)
                  │
                  └── [Tool: MCP]  credential: bConnect Endpoints
                                   → /endpoints/mcp (10 tools default / 31 with writes)
```

**Adding a second domain** — add another MCP tool sub-node with its own credential:

```
  [AI Agent]
      │
      ├── [Tool: MCP]  credential: bConnect Endpoints  → /endpoints/mcp  (10 / 31 tools)
      └── [Tool: MCP]  credential: bConnect Software   → /software/mcp   (11 / 19 tools)
                                               total: ~5,000 tokens default / ~9,500 with writes
```

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
| `compliance` | `/compliance/mcp` | CVE vulnerabilities |
| `universaldynamicgroups` | `/universaldynamicgroups/mcp` | Universal Dynamic Groups |
| `updatemanagement` | `/updatemanagement/mcp` | Windows Update management |
| `insights` | `/insights/mcp` | Cross-module estate risk briefing |

To use multiple domains in one workflow, add one MCP Client node per domain —
each pointing to a different URL path but using the same credential.

---

## Step 3 — Call a Tool via HTTP Request Node (Alternative)

If the MCP Client node is not available in your n8n version, use an
**HTTP Request** node to call the gateway directly.

**Node configuration:**

| Field | Value |
|-------|-------|
| **Method** | POST |
| **URL** | `http://mcp-gateway:3001/endpoints/mcp` (private network) |
| **Authentication** | Header Auth — `Authorization: Bearer <MCP_GATEWAY_AUTH_TOKEN>` |
| **Content Type** | JSON |

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

---

## Multi-User Notes

The gateway uses a **single bConnect service credential** for all calls — it no
longer maps individual callers to separate bConnect keys, and the gateway's bearer
token is a single shared secret too (it authenticates "an allowed caller", not "which
one"). To separate users:

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

The bConnect MCP suite advertises **136 tools across 13 domains** by default (216 with
`ALLOW_WRITE_OPERATIONS=true`).

### Token cost per configuration

The byte figures below are **measured**, not estimated: import each server's built
`createServer`, connect it to an SDK `InMemoryTransport`, and `JSON.stringify` the `tools/list`
result. Reproduce them yourself with `node scripts/tool-inventory.mjs` from the repo root
(add `ALLOW_WRITE_OPERATIONS=true` for the last row). Tokens are those bytes at the usual
≈4 bytes/token rule of thumb, so treat them as an order of magnitude, not a quote. All rows
except the last are the **default posture** — writes hidden.

| Domains connected | Tools | `tools/list` bytes | Approx. tokens |
|-------------------|-------|-------------------:|---------------:|
| `endpoints` only | 10 | 8,983 | ~2,246 |
| `endpoints` + `software` | 21 | 20,049 | ~5,012 |
| `endpoints` + `jobs` + `assets` | 48 | 45,308 | ~11,327 |
| `endpoints` + `software` + `jobs` + `assets` + `activedirectory` | 75 | 73,693 | ~18,423 |
| All 14 domains | 141 | 139,585 | ~34,896 |
| All 14 domains, `ALLOW_WRITE_OPERATIONS=true` | 221 | 193,828 | ~48,457 |

Roughly 34,800 tokens of tool definitions are re-sent on **every** agent invocation before any
conversation, user data, or system instructions. Opening the write gate on a gateway that serves
all 14 domains adds another ~13,500 on top of that, permanently.

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
Client node per domain you need and leave the rest out.

### Never connect all 13 domains to a single AI Agent

Even with a large-context model, loading all 136 tool definitions wastes tokens
on tools the workflow will never call, increases latency, and reduces the model's
effective reasoning budget for actual work.

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `404 Unknown MCP domain` | Wrong domain in the URL | Check the URL path matches one of the domains listed above |
| `405 Method Not Allowed` | GET request sent instead of POST | Ensure the HTTP Request node uses method POST |
| Gateway not reachable | Network or firewall issue | Verify `curl http://mcp-gateway:3001/health` returns `{"status":"ok"}`. That is the whole unauthenticated response — the domain list is served only to a caller sending `Authorization: Bearer <token>`, so a bare `{"status":"ok"}` means the gateway is healthy, not misconfigured |
| `401 Missing bearer token` / `401 Invalid bearer token` | `Authorization: Bearer <token>` header missing or wrong | Set the n8n credential's Header Auth value to `Bearer <MCP_GATEWAY_AUTH_TOKEN>`, matching `.env.gateway` exactly |
| Gateway refuses to start | No `MCP_GATEWAY_AUTH_TOKEN` set (compose requires one), or a non-loopback bind with neither a token nor `MCP_ALLOW_NO_AUTH=true` | Set `MCP_GATEWAY_AUTH_TOKEN` (24+ chars) in `.env.gateway`, or bind loopback, or set `MCP_ALLOW_NO_AUTH=true` once a proxy is in front |
| A write tool doesn't show up in the MCP Client node's tool list | `ALLOW_WRITE_OPERATIONS` unset on the gateway (default posture hides write tools from `tools/list`) | Set `ALLOW_WRITE_OPERATIONS=true` on the gateway if the workflow needs to trigger writes |
| Tool call fails with credential error | bConnect rejects the service credential | Verify the `BCONNECT_API_KEY` (or `BCONNECT_USERNAME`/`BCONNECT_PASSWORD`) in `.env.gateway` is valid in baramundi Management Center → Server Management → API Keys |

---

## Security Notes

- **Set `MCP_GATEWAY_AUTH_TOKEN` and keep it secret.** It is a single shared secret
  for every caller, not per-user auth — keep the gateway on a trusted private network
  and/or behind an authenticating reverse proxy too; never expose its port to
  untrusted networks on the strength of the token alone.
- **Use HTTPS** in front of the gateway in production (TLS terminated by your proxy).
- **Authenticate n8n users** in n8n and/or at the proxy — not at the gateway.
- **Scope the bConnect service credential** to least privilege; bMS RBAC bounds it.

---

*bConnect MCP Suite v26.1.8 — see [INSTALLATION.md](INSTALLATION.md) for full setup instructions.*
