# Tutorial: the gateway behind Pomerium, signed in with Entra ID

This tutorial is for the IT administrator who runs the bConnect MCP gateway over HTTP for a
team. At the end:

- MCP clients (Claude Code, VS Code, Cursor) reach the 13 servers at
  `https://mcp.company.com/<domain>/mcp`;
- every user signs in with their **Microsoft Entra ID** account in the browser;
- only members of an Entra group get in, and chosen tools are reserved for an admin group;
- the log records **who called which tool**.

[Pomerium](https://www.pomerium.com/docs/capabilities/mcp) does the sign-in; the gateway
itself still has no authentication of its own
(ADR-0003). Pomerium Core is free and open source
(Apache-2.0).

> **Status.** Tested on 2026-11-03 with Pomerium v0.33.6, the gateway from `main` and
> bConnect-Mock 0.10.0, with a test identity provider in place of Entra ID: sign-in, all 13
> routes, the group and tool rules, the body limit, restarts and the client address. The
> Entra ID steps follow [Pomerium's Entra ID guide](https://www.pomerium.com/docs/integrations/user-identity/azure)
> and have not yet been run against a real tenant. Try it in a test tenant first.

---

## How it fits together

```
 Claude Code / VS Code / Cursor
        │  HTTPS, OAuth sign-in
        ▼
 ┌──────────────────────────┐  sign-in   ┌────────────────────┐
 │ Pomerium                 │ ─────────► │ Entra ID (tenant)  │
 │ mcp.company.com          │ ◄───────── │                    │
 │ authenticate.company.com │ user,      └────────────────────┘
 └────────────┬─────────────┘ groups
              │  HTTP, Docker network only
              ▼
 ┌──────────────────────────┐  one service credential  ┌─────┐
 │ mcp-gateway (13 servers) │ ───────────────────────► │ bMS │
 └──────────────────────────┘                          └─────┘
```

- **Pomerium** is the only thing on the network. It answers MCP clients with the standard MCP
  sign-in (a 401 that points to a discovery document), sends the user to Entra ID, and issues
  its own token to the client. Clients never deal with Entra ID directly, so Entra ID's
  limits for MCP clients (no self-registration, strict `resource` matching) don't apply.
- **The gateway** is reachable only from Pomerium, over the Docker network. It calls bMS
  with its one service credential; write tools and secret reads stay off.
- **bMS** sees only the service account. The record of who did what is Pomerium's log
  ([Step 7](#step-7--see-who-did-what)).

## Before you start

| You need | Example |
|---|---|
| A Linux host with Docker and Docker Compose | the host that runs the gateway today |
| The gateway set up as in [DOCKER.md](DOCKER.md), version **26.1.12 or later** | `.env.gateway` with `BCONNECT_BASE_URL` and the service credential |
| Two DNS names pointing to that host | `mcp.company.com`, `authenticate.company.com` |
| A TLS certificate for both names, trusted by the users' machines | from your company CA, as `cert.pem` + `key.pem` |
| Rights in Entra ID to register an application | Application Administrator |
| Two Entra security groups | `bConnect MCP users`, `bConnect MCP admins` |

Keep the two groups **separate**: an admin is in the admin group only. The tool rule in
[Step 3](#step-3--write-the-pomerium-configuration) depends on that.

With gateway 26.1.11 everything works except `MCP_GATEWAY_TRUST_PROXY` (added in 26.1.12):
leave that setting out and the gateway's access log shows Pomerium's address instead of the
user's.

---

## Step 1 — Register Pomerium in Entra ID

In the [Microsoft Entra admin center](https://entra.microsoft.com):

1. **App registrations → New registration**
   - Name: `Pomerium – bConnect MCP`
   - Supported account types: **this organizational directory only**
   - Redirect URI: platform **Web**, `https://authenticate.company.com/oauth2/callback`
2. On the app's **Overview** page, note the **Application (client) ID** and the
   **Directory (tenant) ID**.
3. **Certificates & secrets → New client secret.** Copy the secret's **Value** right away
   (not its ID); it is shown only once. Note its expiry date: Pomerium stops signing anyone in
   when it runs out.
4. **Token configuration → Add groups claim** → **Security groups**; for the ID token choose
   **Group ID**. Pomerium's group rules then compare against the groups' **object IDs**.
5. **API permissions:** keep the default delegated `User.Read`. Pomerium's guide also lists
   Microsoft Graph *application* permissions (`Directory.Read.All` and others); they serve
   directory sync in Pomerium Enterprise. Add them only if sign-in fails without them.
6. **Enterprise applications → Pomerium – bConnect MCP → Properties:** set **Assignment
   required** to **Yes**, then under **Users and groups** assign both groups. People outside
   them can't even sign in.
7. Note the **object IDs** of both groups (**Groups → the group → Overview**).

> A user in more than 200 groups gets no `groups` claim in the token (Entra's "group
> overage"), and Pomerium's group rule can't see their groups. With step 6 in place you can
> limit the claim to **groups assigned to the application** (Token configuration → edit the
> groups claim), which avoids that.

Every user also needs an **email address** in Entra ID: Pomerium identifies users by it.

## Step 2 — Prepare the files

Next to `docker-compose.gateway.yml`, create:

```
pomerium/
├── config.yaml        # Step 3
└── tls/
    ├── cert.pem       # certificate for mcp.company.com and authenticate.company.com
    └── key.pem        # its private key
```

Generate the three secrets Pomerium needs, and keep them out of version control:

```bash
head -c32 /dev/urandom | base64     # → shared_secret
head -c32 /dev/urandom | base64     # → cookie_secret
openssl ecparam -genkey -name prime256v1 -noout | base64 -w0    # → signing_key
```

`signing_key` signs the identity Pomerium passes to the gateway; the other two protect
Pomerium's internal traffic and its cookies.

## Step 3 — Write the Pomerium configuration

`pomerium/config.yaml` — replace every `<…>`:

```yaml
# ── Addresses and TLS ─────────────────────────────────────────────────────────
authenticate_service_url: https://authenticate.company.com
certificate_file: /pomerium/tls/cert.pem
certificate_key_file: /pomerium/tls/key.pem

# ── Secrets (Step 2) ──────────────────────────────────────────────────────────
shared_secret: <SHARED_SECRET>
cookie_secret: <COOKIE_SECRET>
signing_key: <SIGNING_KEY>

# ── Entra ID (Step 1) ─────────────────────────────────────────────────────────
idp_provider: azure
idp_provider_url: https://login.microsoftonline.com/<TENANT_ID>/v2.0
idp_client_id: <CLIENT_ID>
idp_client_secret: <CLIENT_SECRET>

# ── Sessions survive a restart ────────────────────────────────────────────────
databroker_storage_type: file
databroker_storage_connection_string: file:///data/pomerium

# ── MCP clients ───────────────────────────────────────────────────────────────
# Clients that register themselves (Claude Code, VS Code, Cursor).
runtime_flags:
  mcp_dynamic_client_registration: true
# Clients that identify with a URL (Client ID Metadata Document): their domains.
mcp_allowed_client_id_domains:
  - claude.ai

# ── Log who called which tool ─────────────────────────────────────────────────
authorize_log_fields:
  - request-id
  - user
  - email
  - mcp-method
  - mcp-tool

# ── One route per bConnect server ─────────────────────────────────────────────
routes:
  - &bconnect
    from: https://mcp.company.com
    prefix: /activedirectory/
    to: http://mcp-gateway:3001
    pass_identity_headers: true
    mcp:
      server:
        max_request_bytes: 1048576   # the gateway's MCP_GATEWAY_MAX_BODY (1mb)
    policy:
      allow:
        or:
          - claim/groups: <USERS_GROUP_ID>
          - claim/groups: <ADMINS_GROUP_ID>
      deny:
        and:
          - mcp_tool:
              in: [list_api_keys, get_access_rights]
          - claim/groups: <USERS_GROUP_ID>
  - { <<: *bconnect, prefix: /assets/ }
  - { <<: *bconnect, prefix: /compliance/ }
  - { <<: *bconnect, prefix: /defensecontrol/ }
  - { <<: *bconnect, prefix: /endpoints/ }
  - { <<: *bconnect, prefix: /groups/ }
  - { <<: *bconnect, prefix: /jobs/ }
  - { <<: *bconnect, prefix: /operatingsystems/ }
  - { <<: *bconnect, prefix: /servermanagement/ }
  - { <<: *bconnect, prefix: /software/ }
  - { <<: *bconnect, prefix: /universaldynamicgroups/ }
  - { <<: *bconnect, prefix: /updatemanagement/ }
  - { <<: *bconnect, prefix: /variables/ }
```

What the parts do:

- **`routes`:** one route per server path. The first one is written out and named
  `&bconnect`; the other twelve copy it (`<<: *bconnect`) and change only the path.
  Pomerium serves a separate discovery document for each path, as MCP clients expect.
- **`to: http://mcp-gateway:3001`:** the gateway's name on the Docker network. Pomerium
  sends this name as `Host`, which the gateway accepts by default
  (`MCP_GATEWAY_ALLOWED_HOSTS=mcp-gateway`); no change there.
- **`max_request_bytes`:** Pomerium's limit for MCP requests is **4 KiB** unless set;
  larger tool calls would fail with `413 Request Entity Too Large`.
- **`policy.allow`:** members of either group get in; everyone else gets `access denied`
  for every call, even after a successful sign-in.
- **`policy.deny`:** a call to one of the listed tools is refused for the **users** group, so
  only admins can use them. Pomerium's rule language can't say "everyone except admins"
  within one deny rule, which is why the two groups must be separate. To block a tool for
  everyone, use `deny: { or: [ { mcp_tool: { in: [...] } } ] }`. Write tools and secret
  reads need no rule: the gateway has them off anyway.
- **`databroker_storage_type: file`:** without it, sessions live in memory and every
  restart signs everyone out.
- **`mcp_dynamic_client_registration`:** lets Claude Code, VS Code and Cursor register with
  Pomerium on their own. Registering gives no access: the user still has to sign in and
  pass the policy.

Optional: if a client brings a URL as its client ID and Pomerium shows an error page naming
that ID, add its domain under `mcp_allowed_client_id_domains`.

## Step 4 — Add Pomerium to the compose stack

Save as `docker-compose.pomerium.yml` next to `docker-compose.gateway.yml`:

```yaml
# Pomerium in front of the bConnect MCP gateway (docs/GATEWAY_POMERIUM_ENTRA_ID.md).
services:

  pomerium:
    image: pomerium/pomerium:v0.33.6
    container_name: pomerium
    ports:
      - "443:443"
    volumes:
      - ./pomerium/config.yaml:/pomerium/config.yaml:ro
      - ./pomerium/tls:/pomerium/tls:ro
      - pomerium-data:/data
    depends_on:
      - mcp-gateway
    restart: unless-stopped

volumes:
  pomerium-data:
```

Pin the Pomerium version, as above, and update it on purpose (see
[Operations](#operations)).

In `.env.gateway`, tell the gateway that one proxy is in front, so its rate limit and access
log use the user's address:

```bash
MCP_GATEWAY_TRUST_PROXY=1
```

Leave `MCP_GATEWAY_HOST_BIND` at its default `127.0.0.1`: the gateway's own port stays on
the host's loopback interface, and the network reaches only Pomerium.

Start both:

```bash
docker compose -f docker-compose.gateway.yml -f docker-compose.pomerium.yml \
  --env-file .env.gateway up -d
docker logs pomerium 2>&1 | grep -E '"level":"(error|fatal)"'    # should print nothing
```

## Step 5 — Check it from the command line

Without a token, Pomerium must answer with the MCP sign-in hint:

```bash
curl -si -X POST https://mcp.company.com/endpoints/mcp \
  -H 'content-type: application/json' -d '{}' | grep -iE '^HTTP|www-authenticate'
# HTTP/2 401
# www-authenticate: Bearer resource_metadata="https://mcp.company.com/.well-known/oauth-protected-resource/endpoints/mcp"

curl -s https://mcp.company.com/.well-known/oauth-protected-resource/endpoints/mcp
# {"resource":"https://mcp.company.com/endpoints/mcp","authorization_servers":["https://mcp.company.com"],…}
```

`resource` must be exactly the URL the clients use. If you get a certificate error here,
the machine doesn't trust your certificate yet; fix that before going on.

## Step 6 — Connect the clients

Every client uses `https://mcp.company.com/<domain>/mcp`, one entry per server it needs.
On first use the browser opens the Entra ID sign-in. Don't also configure an
`Authorization` header: Claude Code doesn't fall back to the sign-in when a fixed header is
rejected.

**Claude Code**

```bash
claude mcp add --transport http bconnect-endpoints https://mcp.company.com/endpoints/mcp
```

Then run `/mcp` in Claude Code, pick the server and choose **Authenticate**. Claude Code runs
on Node.js: if your certificate comes from a company CA, point `NODE_EXTRA_CA_CERTS` at that
CA's PEM file before starting it.

**VS Code** (`.vscode/mcp.json`)

```json
{
  "servers": {
    "bconnect-endpoints": {
      "type": "http",
      "url": "https://mcp.company.com/endpoints/mcp"
    }
  }
}
```

VS Code asks you to sign in when it first starts the server.

More clients and their config formats: [CLIENTS.md](CLIENTS.md#through-the-http-gateway).

**n8n in the same compose stack** keeps calling the gateway directly at
`http://mcp-gateway:3001/<domain>/mcp`, without Pomerium and without signing in. It counts
as one machine identity; only containers on that Docker network can do this. See
[N8N.md](N8N.md).

**claude.ai and Claude Desktop connectors** connect from Anthropic's cloud, not from the
user's PC. They work only if you publish Pomerium to the internet (and Entra ID sign-in is
reachable, as it normally is). That is a decision for your security team; this tutorial
assumes an internal network.

## Step 7 — See who did what

bMS records every call under the service account. Pomerium records the person: each
request produces an `authorize check` line with the fields from `authorize_log_fields`.

```bash
docker logs pomerium 2>&1 | grep '"authorize check"' | grep mcp-tool
# {"user":"…","email":"anna@company.com","mcp-method":"tools/call","mcp-tool":"list_endpoints","allow":true,"deny":false,…}
```

A refused call reaches the client as `access denied, please see the authorization log for
the request <id> for details`; search the log for that request ID to see which rule refused
it (`deny-why-true`, `allow-why-false`). Ship this log to your log platform and keep it as
long as your audit rules require.

Pomerium also passes the signed-in user to the gateway as a signed JWT in the
`X-Pomerium-Jwt-Assertion` header (email, name, groups). The gateway doesn't read it yet.

---

## Operations

| Task | How |
|---|---|
| Update Pomerium | Read the [release notes](https://github.com/pomerium/pomerium/releases), change the tag in `docker-compose.pomerium.yml`, `up -d` again. Releases include Envoy security fixes several times a year. |
| Renew the Entra client secret | New secret in the app registration → `idp_client_secret` → restart Pomerium, before the old one expires |
| Renew the TLS certificate | Replace the files in `pomerium/tls/` → restart Pomerium |
| Let someone in / out | Add to or remove from the Entra group. A running session keeps its old groups until Pomerium refreshes it. |
| Block a tool | Add it to the `mcp_tool` list → restart Pomerium |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `413 Request Entity Too Large` on larger calls | `max_request_bytes` missing on that route (Pomerium's default is 4 KiB) |
| Everyone has to sign in again after a restart | Sessions are in memory: set `databroker_storage_type: file` and keep the `pomerium-data` volume |
| `403` from the gateway | A route's `to` isn't `http://mcp-gateway:3001`, or `MCP_GATEWAY_ALLOWED_HOSTS` no longer contains `mcp-gateway` |
| Signed in, but every call says `access denied` | The user is in neither group, or the token has no `groups` claim (Step 1, item 4; group overage) |
| An admin can't use an admin-only tool | The admin is also in the users group (Step 3, `policy.deny`) |
| Pomerium error page naming a client ID | The client uses a URL as its ID: add the domain to `mcp_allowed_client_id_domains` |
| Claude Code keeps failing with 401 | A fixed `Authorization` header is configured for that server: remove it |
| Sign-in fails for some users | The user has no email address in Entra ID |
| The gateway's access log shows Pomerium's address | `MCP_GATEWAY_TRUST_PROXY=1` not set, or gateway older than 26.1.12 |

Further: [TROUBLESHOOTING.md](TROUBLESHOOTING.md), Pomerium's
[MCP reference](https://www.pomerium.com/docs/capabilities/mcp/reference).
