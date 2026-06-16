# n8n Integration Guide — bConnect MCP Suite

This guide explains how to use the bConnect MCP gateway from n8n workflows.
It covers credential setup, connecting the MCP Client node, and a multi-user
scenario with separate bConnect API keys per user.

## Prerequisites

- bConnect MCP gateway running and accessible (see [INSTALLATION.md — Option D](INSTALLATION.md#option-d--gateway-http-multi-user-authenticated))
- n8n 1.22 or later (MCP Client node requires n8n 1.22+)
- A valid Bearer token for each n8n user/workflow (from the gateway token map)

---

## How It Works

```
n8n Workflow
    │
    │  POST /<domain>/mcp
    │  Authorization: Bearer <your-token>
    ▼
bconnect-mcp-gateway :3001
    │  resolves token → bConnect credentials
    ▼
baramundi bConnect API
    https://bms.company.com:444/bconnect
```

The gateway authenticates the n8n request using the Bearer token, looks up the
corresponding bConnect API key, and forwards the MCP tool call to bConnect on
behalf of that user. n8n never sees the bConnect credentials — it only knows
the Bearer token.

---

## Step 1 — Store the Token as an n8n Credential

Never paste the Bearer token directly into a workflow node. Store it as a
reusable credential instead.

1. In n8n, go to **Credentials → Add Credential**
2. Choose **Header Auth**
3. Fill in:
   - **Name**: e.g. `bConnect MCP – Alice`
   - **Header Name**: `Authorization`
   - **Header Value**: `Bearer tok_alice_a3f8c2d1e4b7f09a2c5e8...` *(your full token)*
4. Save

Repeat for each user that needs their own bConnect API key.

---

## Step 2 — Add an MCP Client Node

The **MCP Client** node (available since n8n 1.22) connects directly to an
MCP-compatible HTTP endpoint.

1. Add a new node → search for **MCP Client**
2. Configure the node:

| Field | Value |
|-------|-------|
| **MCP Server URL** | `http://mcp-gateway.company.com:3001/endpoints/mcp` |
| **Authentication** | Header Auth |
| **Credential** | Select the credential created in Step 1 |
| **Operation** | Call Tool |
| **Tool Name** | e.g. `list_windows_endpoints` |
| **Tool Arguments** | e.g. `{ "PageSize": 25 }` |

> Replace `endpoints` in the URL with the domain you need — see the full list below.

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

## Multi-User Example: Two Users, Two API Keys

This example shows a realistic setup with two n8n users sharing one gateway
but using separate bConnect API keys.

### Token map (`/etc/mcp/tokens.json`)

```json
{
  "tok_alice_a3f8c2d1e4b7f09a2c5e8d3b6f1a4c7e2d5b8f3a6c9e2d5b8f1a4c7e0d3b6f9": {
    "baseUrl": "https://bms.company.com:444/bconnect",
    "apiKey":  "bconnect-api-key-for-alice"
  },
  "tok_bob_1c4e7a0d3f6b9e2c5a8d1f4b7e0c3a6d9f2b5e8c1d4a7f0b3e6c9d2a5f8b1e4c7": {
    "baseUrl": "https://bms.company.com:444/bconnect",
    "apiKey":  "bconnect-api-key-for-bob"
  }
}
```

### n8n credentials

| Credential name | Header Name | Header Value |
|----------------|-------------|--------------|
| `bConnect MCP – Alice` | `Authorization` | `Bearer tok_alice_a3f8c2d1…` |
| `bConnect MCP – Bob` | `Authorization` | `Bearer tok_bob_1c4e7a0d3…` |

### Workflow assignment

- Alice's workflows → use credential `bConnect MCP – Alice` → gateway resolves to Alice's bConnect API key
- Bob's workflows → use credential `bConnect MCP – Bob` → gateway resolves to Bob's bConnect API key

Each user sees only what their bConnect API key permits. Permissions are managed
entirely in the baramundi Management Center — not in n8n or the gateway.

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` | Missing or wrong Bearer token | Check the credential's Header Value matches the token in `tokens.json` exactly |
| `401 Authorization header required` | No `Authorization` header sent | Ensure the credential is selected in the node and Header Auth is chosen |
| `404 Unknown MCP domain` | Wrong domain in the URL | Check the URL path matches one of the domains listed above |
| `405 Method Not Allowed` | GET request sent instead of POST | Ensure the HTTP Request node uses method POST |
| Gateway not reachable | Network or firewall issue | Verify `curl http://mcp-gateway.company.com:3001/health` returns `{"status":"ok"}` |
| `authEnabled: false` in `/health` | `MCP_AUTH_CONFIG` not set or path wrong | Check the gateway was started with a valid `MCP_AUTH_CONFIG` path |
| Tool call fails with credential error | Token resolved but bConnect rejects the API key | Verify the API key in `tokens.json` is valid in baramundi Management Center → Server Management → API Keys |

---

## Security Notes

- **Use HTTPS** between n8n and the gateway in production — Bearer tokens travel in HTTP headers. Place nginx or Caddy in front of the gateway to terminate TLS.
- **One credential per user** in n8n — do not share credentials between users who should have different bConnect permissions.
- **Rotate tokens** by updating `tokens.json` and restarting the gateway. Old tokens stop working immediately.
- **Token map file** should be `chmod 600` and owned by the gateway process user — it contains bConnect API keys.

---

*bConnect MCP Suite v26.1.5 — see [INSTALLATION.md](INSTALLATION.md) for full setup instructions.*
