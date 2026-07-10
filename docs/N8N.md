# n8n Integration Guide — bConnect MCP Suite

This guide explains how to use the bConnect MCP gateway from n8n workflows —
connecting the MCP Client node to the gateway and calling bConnect tools.

> **⚠️ The gateway has no built-in authentication.** Run n8n and the gateway on a
> **trusted private network** (e.g. the same Docker network, gateway on loopback),
> and/or front the gateway with an authenticating reverse proxy. Do **not** expose
> the gateway port to untrusted networks. See [DOCKER.md](DOCKER.md) → "TLS and
> authentication".

## Prerequisites

- bConnect MCP gateway running and reachable from n8n on a private network
  (see [INSTALLATION.md — Option C](INSTALLATION.md#option-c--gateway-http-multi-user))
- n8n 1.22 or later (MCP Client node requires n8n 1.22+)

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

Point the n8n MCP Client node at the gateway URL on your private network — no
`Authorization` header is needed by the gateway itself. For example, with n8n and
the gateway on the same Docker network:

```
http://mcp-gateway:3001/<domain>/mcp
```

If you front the gateway with an authenticating proxy, use the proxy URL and add
whatever credential the proxy requires (e.g. an n8n **Header Auth** credential
carrying your proxy/IdP token).

---

## Step 2 — Add an MCP Server Credential

The MCP Server credential bundles the URL and auth together so you can reuse
it across multiple workflow nodes.

1. In n8n go to **Credentials → Add Credential → MCP Server**
2. Fill in:

| Field | Value |
|-------|-------|
| **Name** | e.g. `bConnect Endpoints` |
| **URL** | `http://mcp-gateway.company.com:3001/endpoints/mcp` |
| **Authentication** | Header Auth |
| **Header Auth Credential** | Select the credential created in Step 1 |

3. Save

Repeat for each domain you need — one MCP Server credential per domain URL.

---

## Step 3 — Wire the AI Agent node

1. Add an **AI Agent** node to your workflow
2. Add a **Tool: MCP** sub-node connected to the AI Agent
3. In the MCP tool node, set **Credential** to your `bConnect Endpoints` credential

The AI Agent now has access to exactly the 47 endpoints tools (~29,000 tokens) —
nothing from the other 12 domains is loaded.

```
Workflow:
  [Trigger] → [AI Agent] → (answer)
                  │
                  └── [Tool: MCP]  credential: bConnect Endpoints
                                   → /endpoints/mcp (47 tools)
```

**Adding a second domain** — add another MCP tool sub-node with its own credential:

```
  [AI Agent]
      │
      ├── [Tool: MCP]  credential: bConnect Endpoints  → /endpoints/mcp  (47 tools)
      └── [Tool: MCP]  credential: bConnect Software   → /software/mcp   (19 tools)
                                                                     total: ~41,000 tokens
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
| `compliance` | `/compliance/mcp` | CVE vulnerabilities (26R1 only) |
| `universaldynamicgroups` | `/universaldynamicgroups/mcp` | Universal Dynamic Groups (26R1 only) |
| `updatemanagement` | `/updatemanagement/mcp` | Windows Update management |

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
| **URL** | `http://mcp-gateway.company.com:3001/endpoints/mcp` |
| **Authentication** | Header Auth (select your credential) |
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

Each tool definition costs roughly 600–700 tokens. The bConnect MCP suite has
212 tools across 13 domains.

### Token cost per configuration

| Domains connected | Tools | Approx. tokens consumed |
|-------------------|-------|------------------------|
| `endpoints` only | 47 | ~29,000 |
| `endpoints` + `software` | 66 | ~41,000 |
| `endpoints` + `jobs` + `assets` | 97 | ~60,000 |
| `endpoints` + `software` + `jobs` + `assets` + `activedirectory` | 130 | ~81,000 |
| All 13 domains | 212 | ~130,000+ |

At 130,000 tokens for tool definitions alone, you have consumed the entire context
window of many models — before any conversation, user data, or system instructions.

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

Even with a large-context model, loading all 212 tool definitions wastes tokens
on tools the workflow will never call, increases latency, and reduces the model's
effective reasoning budget for actual work.

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `404 Unknown MCP domain` | Wrong domain in the URL | Check the URL path matches one of the domains listed above |
| `405 Method Not Allowed` | GET request sent instead of POST | Ensure the HTTP Request node uses method POST |
| Gateway not reachable | Network or firewall issue | Verify `curl http://mcp-gateway:3001/health` returns `{"status":"ok"}` |
| Gateway refuses to start | Non-loopback bind without `MCP_ALLOW_NO_AUTH=true` | Bind loopback, or set `MCP_ALLOW_NO_AUTH=true` once a proxy is in front |
| Tool call fails with credential error | bConnect rejects the service credential | Verify the `BCONNECT_API_KEY` in `.env.gateway` is valid in baramundi Management Center → Server Management → API Keys |

---

## Security Notes

- **The gateway has no built-in auth.** Keep it on a trusted private network and/or
  behind an authenticating reverse proxy; never expose its port to untrusted networks.
- **Use HTTPS** in front of the gateway in production (TLS terminated by your proxy).
- **Authenticate n8n users** in n8n and/or at the proxy — not at the gateway.
- **Scope the bConnect service credential** to least privilege; bMS RBAC bounds it.

---

*bConnect MCP Suite v26.1.5 — see [INSTALLATION.md](INSTALLATION.md) for full setup instructions.*
