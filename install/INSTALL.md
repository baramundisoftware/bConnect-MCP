# Installing bConnect-MCP on Windows

Run one script. Answer seven or eight questions. It tells you whether it worked.

```powershell
cd <the folder you extracted the suite into>\install
.\Install-BConnectMcp.ps1
```

That is the whole procedure. The rest of this page explains what it asks you, what
it checks, and — the part most install guides leave out — what it *cannot* check.

If PowerShell refuses to run the script, it is the execution policy, not the script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-BConnectMcp.ps1
```

## Or use the window

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Install-BConnectMcp-UI.ps1
```

Same installer, asked differently. The wizard is a **front end** — it collects the
answers, hands them to `Install-BConnectMcp.ps1`, and renders that script's real
output as it runs. It does not contain a second copy of the install logic, so the
window and the console cannot disagree about what an install does. The `-Sta` matters:
WPF will not start on an MTA thread.

**Four steps, and a run page.**

| | | |
|---|---|---|
| 1 | **Connect** | where the servers will run, the bMS address, and the credential to reach it. **Advanced** holds v1.1, the CA certificate and how the credentials are stored |
| 2 | **Clients** | which MCP clients to configure. The gateway section appears only where a selected client requires it; the project directory is asked only where a per-workspace client is selected |
| 3 | **Permissions** | read only, or allow changes. **Advanced** holds which of the servers are enabled |
| 4 | **Review and install** | the summary, the install location with a **Change** beside it, the dry run, and Install |

The run page is not one of the four: it is what pressing Install produces. It shows
the installer's own step list on the left (driven by progress records the script
emits, not by the wizard's idea of what happens when) and its verbatim output on the
right. The window stays responsive throughout — the script runs on its own runspace
and the UI polls it — which matters because a first build of thirteen packages takes
minutes.

Two things are deliberately absent. There is no *preparation* page: what to have in
hand is [`install\README.md`](README.md), which the offline bundle also places at its
own root, and the Connect page links to it. And there is no *requirements* page: the
checks still run, silently, when the window opens, and only failures are drawn — as a
banner on the Connect page naming the remedy for that specific failure. A computer
with nothing wrong with it is shown nothing.

### The first question is the one that matters most

**MCP servers that speak stdio are local processes, started by the client
application, on the machine that application runs on.** Not on the bMS server. Get
that wrong and the install reports success and produces no tools, which is the worst
outcome a product can have — so the wizard asks first, in those terms, and refuses to
continue until it is answered. Nothing is pre-selected.

| | Where the servers run | One install serves |
|---|---|---|
| **Workstation** | on the computer you are installing on, started by the assistant application there | the person at that computer |
| **Shared service** | on the computer you are installing on, behind the HTTP gateway | everyone who can reach that computer over the network |

The answer is not cosmetic. It filters the client list by each target's declared
transport — a workstation deployment offers only clients that can start a local
process, a shared-service one only clients that can reach an HTTP endpoint — it makes
the gateway part of the install rather than a checkbox beside it, it changes which
requirement checks are run (a shared-service install checks the gateway's TCP port;
it does not report on MCP clients installed here, because they are not here), and it
changes what the completion summary says. To change it, go back to the Connect page;
client selections the new answer cannot serve do not survive the change, and the
Clients page names the ones it left out.

### The install location is a line, not a page

`Install location   <path>   [Change]`, on the Review page and always visible.
**Change** opens an editor that validates before it accepts: free space, write
permission, and whether the path leaves enough of the 260-character Windows limit for
the deepest file in this product. A location that cannot hold it is refused there,
with the reason, rather than several minutes into a run. The **secrets directory**
follows the install location until it is set in that editor, and the consequence of
moving it — inheritance broken, an explicit ACL applied with `icacls`, administrator
rights needed where the account does not own it — is stated beside the box.

### Selecting an HTTP-only client installs the gateway

Copilot Studio, the OpenAI Responses API, n8n and Open WebUI cannot start a local
process. Selecting any of them makes the gateway part of the run: it is configured, a
bearer token is generated, it is **started and verified**, and the completion page
gives you the exact URL and the exact `Authorization` header to paste. The manual step
for those clients is two values, not a deployment.

Two things on the review page are worth knowing about:

- **Check (dry run)** runs the real script with `-DryRun`. Prerequisites, credentials
  and a genuine call to bConnect; nothing written. It is the fastest way to find out
  that a URL or a key is wrong.
- **The equivalent console command**, printed in full, so a wizard run can be repeated
  or scripted. Secrets are not in it: the wizard passes them in process as a
  `SecureString`.

The wizard requires you to type `ENABLE WRITES` before it will build a write-enabled
configuration, exactly as the console run does.

Once it is installed, `Manage-BConnectMcp.ps1` is the window for changing it — write
access, connection, v1.1, audit and rate limiting, and which clients are configured.
It is the same shape one level down: a front end over `bconnect.ps1`. See
[The settings window](#the-settings-window).

---

## Using your own branding

The wizard shows `install\assets\logo.png` in its navigation rail and uses
`install\assets\app.ico` for its window, taskbar and Alt-Tab icon. Both are optional: an
absent logo leaves a text wordmark in the same slot and an absent icon leaves WPF's
default — no broken-image box, no crash, no gap. `-LogoPath` / `-IconPath` point the
wizard at files elsewhere.

To substitute your own, drop a wide wordmark PNG in as `logo.png` (it is scaled to a
fixed height with the width following, never stretched into a square). For the icon, if
all you have is a square PNG, convert it rather than shipping a single-size `.ico`:

```powershell
.\lib\New-AppIcon.ps1 -SourcePng C:\art\your-mark.png -OutputIco .\assets\app.ico
```

It renders 16, 32, 48 and 256 px independently with high-quality scaling — the title
bar and Alt-Tab, the shell's large-icon views, and a crisp taskbar thumbnail at high DPI
— and letterboxes a non-square source onto a transparent square canvas rather than
stretching it. `-Sizes` overrides the default four.

---

## Before you start

| You need | Notes |
|---|---|
| **Node.js 22.15 or newer** | 20 is the declared minimum, but 22.15+ honours the Windows certificate store, which is the clean answer to an internal-CA bMS certificate. The installer warns if you are below it. |
| **The suite on disk** | This installer configures a suite that is already extracted or cloned; it does not download one. |
| **Your bConnect base URL** | Ends at `/bconnect` — e.g. `https://bms.example.com/bconnect`. Not a module segment. |
| **An API key** | bMS console → Server Management → API Keys. Username + password also works. |
| **A host that speaks MCP** | Claude Desktop by default, and it must have been run once so `%APPDATA%\Claude\` exists. Eleven targets are supported — see *Which hosts* below. |

Optionally, **bConnect v1.1 Basic credentials**. v1.1 exposes job configuration that
v2.0 omits entirely (steps, execution timeout, abort-on-error, the destructive flag)
and it does **not** accept an API key. Skip it and the tools that use it degrade to a
v2.0-only answer rather than failing.

---

## What it asks you

1. **Base URL.** Validated as you type: if you paste a URL with a module segment
   (`.../bconnect/endpoints`) it offers to trim it, because that mistake produces
   doubled paths and a 401 that looks exactly like a bad password.
2. **API key, or username and password.** Entered masked. Never echoed, never
   logged, never placed on a command line. There is deliberately no `-ApiKey`
   parameter — a secret on a command line ends up in your PowerShell history.
3. **v1.1 credentials** — optional, as above.
4. **How the credentials are stored** — plaintext (the default, and what you had
   before this question existed) or DPAPI-encrypted. See *Credential storage* below.
5. **Which servers to enable**, with the context cost of each shown in tokens.
   Recommended is five servers (~21,000 tokens); all thirteen is about 36,000.
   That cost is paid on every request before you have typed anything, so enable
   what you will use.
6. **The write gate.** Read-only by default. If you want writes you have to say so
   per server and then type `ENABLE WRITES` in full.
7. **Whether to drop** any previously configured servers you did not select.

Everything else it works out or verifies for itself.

**Which hosts is not one of the console's questions.** It is `-Hosts`, and leaving it
off means Claude Desktop alone — which is byte-for-byte what this installer did before
host targets existed. Run `-ListHosts` to see the choices, or read *Which hosts*
below. The wizard asks it on its Clients page instead, and ticks nothing for you; see
`lib\HOST-WIZARD-PAGE.md` for that page's contract.

**Neither is the deployment shape.** A console run does what its parameters say: no
`-Gateway` means stdio on this machine. The wizard asks because a person clicking
through a window has no parameter list in front of them to reveal the assumption.

---

## What it does

| Step | |
|---|---|
| 1 | Node, npm, disk, and that the suite root really is one |
| 2 | Detects an existing installation and offers to reconfigure it |
| 3 | Collects credentials (masked), and asks how they should be stored |
| 4 | Calls bConnect for real with those credentials and diagnoses the failure if it does not answer |
| 5 | Hardens the secrets **directory**, then writes the credentials into it in the chosen form |
| 6 | Builds `@bconnect/mcp-core`, then each server, naming any package that fails |
| 7 | Server selection, with measured context cost |
| 8 | The write gate |
| 9 | Writes the configuration for **every selected host** — backup first, unrelated content verified unchanged |
| 10 | Starts every configured server exactly as its host will, from that host's own file, and makes a real read call |

---

## Which hosts

By default the installer configures Claude Desktop and nothing else, exactly as it
always did. `-Hosts` widens that.

```powershell
.\Install-BConnectMcp.ps1 -ListHosts                              # the table below, resolved for this machine
.\Install-BConnectMcp.ps1 -Hosts claude-desktop,claude-code,vscode
.\Install-BConnectMcp.ps1 -Hosts all
```

**The servers themselves did not change, and that is the point.** They are ordinary
stdio JSON-RPC MCP servers plus one Streamable-HTTP gateway; there is nothing
Anthropic-specific anywhere in them. The only vendor-specific thing in an install is
which file gets written and in what shape. That knowledge lives in `lib\hosts.json`
as data — location, container key, entry shape, the documentation URL it was read
from, and the claims deliberately *not* made — so adding a host is a JSON entry, and
no emitter can quietly disagree with a document.

### The table

| Target | Transport | Writes | Verified how |
|---|---|---|---|
| `claude-desktop` | stdio | merges `%APPDATA%\Claude\claude_desktop_config.json` | **Host loaded it.** Unchanged path, still written by `merge-config.mjs`; verified on the development estate |
| `claude-code` | stdio (or HTTP) | merges `<project>\.mcp.json` | **Host loaded it.** `claude mcp list` in a directory carrying an emitted `.mcp.json` enumerated both servers and printed their exact command lines back |
| `vscode` | stdio (or HTTP) | merges `<project>\.vscode\mcp.json` | **Servers started.** File re-parsed under the key VS Code documents (`servers`) and every server in it started, handshook and read live bMS data |
| `cursor` | stdio (or HTTP) | merges `<project>\.cursor\mcp.json` | **Servers started**, same method |
| `continue` | stdio (or HTTP) | writes `~\.continue\mcpServers\bconnect-mcp.yaml` | **Servers started.** YAML parsed by a real YAML parser, list container confirmed, servers started from it |
| `librechat` | stdio or HTTP | snippet for `librechat.yaml` | **Shape only.** LibreChat is not installed here |
| `open-webui` | HTTP (gateway) | snippet + steps | **Shape only.** The gateway URLs it points at *were* exercised |
| `n8n` | HTTP (gateway) | snippet + steps | **Shape only.** Same |
| `openai` | stdio (Agents SDK) or HTTP | snippet | **Shape only.** The stdio params are the verified command line |
| `copilot-studio` | HTTP (gateway) | connector Swagger + steps | **Shape only** — and read the negative finding below before planning on it |
| `generic` | stdio or HTTP | the exact command line + portable JSON | **Servers started** — it *is* the verified command line, printed |

Three verification levels, and the difference between them is the honest content of
this feature:

- **Host loaded it** — the host application itself was made to read the emitted file
  on the development machine.
- **Servers started** — the emitted file was parsed back in that host's own
  documented container shape, and every server named in it was started from the
  `command`, `args` and `env` found *in that file*, completed the MCP handshake and
  served a real bMS read. This is **not** proof the host application loads the file.
- **Shape only** — checked against the documented schema and confirmed to carry no
  credential. Nothing was executed. That host is not installed here.

The installer prints which level applies to each target at the end of every run, and
`lib\hosts.json` records, per target, the claims that were deliberately not made.

### Two negative findings, stated early

**Copilot Studio is impractical for a firewalled Windows server, and the reason is
structural.** It has no stdio path at all, supports Streamable HTTP only (SSE support
ended August 2025), and reaches your server *through Power Platform connectors* —
meaning the call originates in Microsoft's cloud. A gateway on loopback or on a
private management VLAN is unreachable by construction, not by policy. Neither
Microsoft MCP documentation page mentions the on-premises data gateway, VNet
integration or any other private-network route; the absence of a documented path is
not proof none exists, but it is not something to commit a production integration to.
What remains is publishing the gateway on a public HTTPS name, or tunnelling to it —
in both cases an internet-reachable path to a component with no built-in
authentication. The target is still emitted (the connector Swagger is genuinely
useful) with that warning at the top of the file.

**n8n cannot spawn a local process either.** The MCP Client Tool node takes an
endpoint URL and a transport and has no `command`/`args` properties of any kind. For
n8n the gateway is not an optimisation, it is the only route. There are also open
reports of its transport dropdown being ignored and SSE used regardless, which fails
against a streamable-only server — check your version before relying on it.

### Two shapes that are easy to get wrong, and are checked

- **VS Code's top-level key is `servers`, not `mcpServers`.** A config hand-copied
  from a Claude file fails silently there. The emitter writes `servers`; a negative
  control in the test suite proves the validator rejects `mcpServers` for that target.
- **Continue's `mcpServers` is a YAML *list* of objects, each carrying its own
  `name:`** — not a map keyed by server name like every other host here. A config
  translated field-for-field from anywhere else will not load. Also checked by a
  negative control.

Cursor is a third case worth knowing about: its documentation marks `type` as
required in a field table and then omits it from every example, stdio and remote
alike. The emitter follows the **examples**, because those are what the vendor ships
against, and `lib\hosts.json` records the contradiction rather than resolving it
silently.

### Local models, and nothing leaving the network

For a self-hosted model the realistic stack is Ollama (or similar) behind a client
that speaks MCP. Two targets do that: **LibreChat** and **Continue**. Both run the
stdio servers locally, so the model is local, the MCP servers are local, bMS is on
the LAN, and no traffic leaves the network at all.

```powershell
.\Install-BConnectMcp.ps1 -Hosts librechat,continue -Servers bconnect-endpoints,bconnect-compliance
```

One caveat for LibreChat specifically: stdio servers run on the *LibreChat host*. If
LibreChat is in Docker, either the suite and the credentials file are inside that
container (or bind-mounted at the same paths), or use the HTTP form through the
gateway.

---

## The HTTP gateway

`bconnect-mcp-gateway` serves all fourteen servers over Streamable HTTP on one port,
one URL per domain:

```
POST http://<bind>:<port>/<domain>/mcp
```

It is the bridge for every host that cannot spawn a local process, and it is the
better component on two counts recorded in `UPSTREAM-FEEDBACK.md` §3.1: it performs
no startup connectivity probe, so finding **B1** does not apply to it, and its rate
limiter lives in a closure across requests instead of being rebuilt per call, so
finding **B8** does not apply either — it is the reference implementation of that fix.

```powershell
.\Install-BConnectMcp.ps1 -Hosts n8n,open-webui -Gateway -StartGateway
.\lib\Start-BConnectGateway.ps1 -Bind 127.0.0.1 -Port 3001
node .\lib\verify-gateway.mjs --url http://127.0.0.1:3001
```

Selecting any HTTP-only host turns `-Gateway` on for you, rather than failing later
with a confusing message.

### Its authentication story, before any advice about exposing it

**The gateway authenticates callers with a shared bearer token, and the installer
generates one for you.** Run it with `-Gateway` and a 43-character random
`MCP_GATEWAY_AUTH_TOKEN` is written into the same ACL-hardened credentials file as
your bConnect key, then printed once. Every call must carry it:

```
Authorization: Bearer <MCP_GATEWAY_AUTH_TOKEN>
```

Without the header the gateway answers **401**. `GET /health` is exempt, so container
and orchestrator probes keep working; it returns the domain list and nothing else.

**What the token is not.** It is not TLS and it is not an identity. It answers "may
this caller talk to the gateway at all", which is the question the shipped artifact
could not previously answer. Who the caller *is*, and encrypting the hop, remain the
fronting reverse proxy's job — that half of ADR-0003 is unchanged. Downstream the
gateway still holds **one** bConnect service credential, and every caller it admits
gets that credential's full reach, bounded only by bMS RBAC.

So:

- **On loopback** with a token, only a caller holding the token can reach the estate,
  even from this machine. That is the default an installer run produces.
- **On loopback with no token**, it is reachable by anything running as any user on
  this machine. Defensible for a single-operator Windows server; it is what you get
  if you start the gateway by hand without setting the variable.
- **Anywhere else**, the gateway fails closed: it refuses to start on a non-loopback
  bind unless it has a token, **or** `MCP_ALLOW_NO_AUTH=true` asserts that a proxy is
  in front. `Start-BConnectGateway.ps1` additionally requires
  `-IUnderstandThereIsNoAuth` for the token-less case, so that assertion has to be
  made twice, in two places, and **nothing checks whether it is true**. With a token
  neither assertion is needed. That is the point: the secure path is the short one.
- **A token on plain HTTP crosses the wire in clear text.** Off this host means TLS,
  which means a proxy.

> **What changed and why (SEC-7).** `docker-compose.gateway.yml` used to set
> `MCP_ALLOW_NO_AUTH=true` and the image bound `0.0.0.0`, so the fail-closed guard
> above was satisfied before an operator ever saw it — the shipped artifact disarmed
> its own authentication, and one documented variable (`MCP_GATEWAY_HOST_BIND`) stood
> between that and an open MCP endpoint fronting all 14 servers. Both lines are gone.
> The image defaults to loopback, the compose file widens it explicitly next to a
> mandatory token, and `MCP_ALLOW_NO_AUTH` survives only as a documented, commented-out
> escape hatch for a real reverse-proxy deployment.

A third control has already earned its keep here: during an earlier evaluation the
gateway was bound to a routable address with `MCP_ALLOW_NO_AUTH=true` and remained
unreachable from the network anyway, because the Windows firewall had no rule for the
port. Two independent controls had to fail before anything was exposed. Keep it that
way — do not open the port "just to test".

What the fronting proxy must do: terminate TLS, authenticate the caller against your
IdP, and reach the gateway over loopback or a private network. Publish the proxy, not
the gateway.

### Running the gateway without the installer — first run

Everything below is the whole of it. Nothing here needs PowerShell, Windows, or the
installer; it is the same three variables in Docker, in a shell, or in a service unit.

**1. Generate a token.** 24 characters minimum — the gateway refuses to start below
that, because a guessable token is worse than none: it reads as protection.

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='          # POSIX
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

```powershell
[Convert]::ToBase64String((1..32|%{Get-Random -Max 256})) -replace '\+','-' -replace '/','_' -replace '='
```

**2. Put it in the environment file, with file permissions that mean something.**
This is a credential; it deserves the same treatment as the bMS password.

```bash
cd bConnect-MCP-main
cp .env.gateway.example .env.gateway
chmod 600 .env.gateway                       # POSIX: owner only
printf 'MCP_GATEWAY_AUTH_TOKEN=%s\n' "$TOKEN" >> .env.gateway
# also set BCONNECT_BASE_URL and the BCONNECT_* service credential in that file
```

```powershell
# Windows: break inheritance and grant only SYSTEM, Administrators and you.
icacls .env.gateway /inheritance:r /grant:r "*S-1-5-18:(F)" "*S-1-5-32-544:(F)" "${env:USERNAME}:(F)"
```

Prefer a mounted secret? `MCP_GATEWAY_AUTH_TOKEN_FILE=/run/secrets/mcp_token` is read
at startup exactly like `BCONNECT_PASSWORD_FILE`, `BCONNECT_USERNAME_FILE` and
`BCONNECT_API_KEY_FILE` — those four are the whole list. **The v1.1 domain
credential is NOT on it.** `BCONNECT_V11_USERNAME_FILE` / `BCONNECT_V11_PASSWORD_FILE`
are silently ignored — no error, no log line, just a gateway with v1.1 tools
never advertised — and `docker-compose.gateway.yml` does not forward
`BCONNECT_V11_*` or `BCONNECT_ENABLE_V11` to the container at all today, so a
plain (non-`_FILE`) environment variable does not reach it either. Until both of
those are fixed upstream, v1.1 is a Windows-launcher-only capability
(`Start-BConnectGateway.ps1` passes the whole credentials file through
verbatim); do not plan a Docker deployment around v1.1 tools being present.

**3. Start it.**

```bash
docker compose -f docker-compose.gateway.yml --env-file .env.gateway up -d
```

Compose refuses to start if `MCP_GATEWAY_AUTH_TOKEN` is unset, with a message telling
you to set it — it will not quietly bring up an open gateway. Outside Docker:

```bash
MCP_GATEWAY_AUTH_TOKEN=$TOKEN MCP_GATEWAY_BIND=127.0.0.1 node --import ./build/preload.js build/gateway.js
```

`--import ./build/preload.js` is not optional. Without it the gateway still starts
and still serves traffic — and also starts fourteen stdio servers inside its own
process, all attaching to stdin (measured: fourteen `started on stdio` lines and
`MaxListenersExceededWarning: 11 data listeners`). It fails by succeeding, so it is
easy to miss. The container image and `npm start` already pass it for you.

**4. Prove both directions before you trust it.** "Configured" and "enforced" are
different claims:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3001/endpoints/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# → 401

curl -s -X POST http://localhost:3001/endpoints/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 200
# → the tool catalogue

curl -s http://localhost:3001/health     # → {"status":"ok",...} with no token, by design
```

`node lib\verify-gateway.mjs --url http://127.0.0.1:3001` does all three for you, plus
a wrong-token probe, reading the token from `MCP_GATEWAY_AUTH_TOKEN` in your shell.

**5. Give the token to the client.** In n8n: a **Header Auth** credential, name
`Authorization`, value `Bearer <token>`. In Open WebUI: the server entry's **Bearer**
field (the token alone). In LibreChat: the server's `headers:` map. Anywhere else: a
plain `Authorization` header. The installer writes these instructions, per host, into
`install\out\<host>.md` — without the token value, because that directory is not
protected.

### Rotating the token

Two values, comma-separated, are both accepted. That is the whole mechanism, and it
exists so that rotating does not require downtime — a rotation that locks clients out
is a rotation that does not happen.

```powershell
.\Install-BConnectMcp.ps1 -Hosts n8n -Gateway -RotateGatewayToken -ReuseCredentials
```

That writes `MCP_GATEWAY_AUTH_TOKEN=<new>,<old>` and prints the new value. Or by hand:

```
MCP_GATEWAY_AUTH_TOKEN=<new>,<old>
```

Then:

1. Restart the gateway. Both tokens now work.
2. Move every client to `<new>`, one at a time, verifying each.
3. Remove `<old>` from the file and restart again — re-running the installer *without*
   `-RotateGatewayToken` does not do this for you, it leaves what it finds. Until you
   remove it, a leaked old token is still a valid token.

Rotate on the usual triggers: a token pasted into a ticket or a chat, an operator
leaving, a client host being decommissioned, or a schedule you already keep for
service credentials.

### What the gateway verification proves

`lib\verify-gateway.mjs` opens a real Streamable HTTP MCP session per domain, lists
the tools and makes a real bMS read call — the same thing a remote client will do. It
also checks that `GET /<domain>/mcp` answers 405 and an unknown domain answers 404
(so you know you are talking to the gateway and not a proxy's error page), and that
the rate-limit headers are present.

On authentication it now measures rather than disclaims. Against the running process
it sends the same call three times — with no token, with the token from
`MCP_GATEWAY_AUTH_TOKEN`, and with a wrong token of the same length — and requires
401, 200, 401. The wrong-token probe is not padding: without it, "the header is being
checked" and "the header is being ignored" produce identical output. Passing
`--expect-auth` (which the installer does whenever it has written a token) turns an
unauthenticated gateway from a note into a failure.

What it still cannot see is *who* the caller is. One shared token is not an identity,
and on plain HTTP it is not confidential either; it says so rather than letting a row
of PASSes imply otherwise.

---

## Installing with no internet access

Only one step of this installation needs the public internet: `npm ci`. Node comes
from an MSI you carry in, bMS is on the LAN, and everything else is local.

That is demonstrated rather than asserted:

```powershell
.\lib\Test-OfflineInstall.ps1
```

It points npm's registry and proxies at a discard address and sets
`npm_config_offline`, then runs a control both ways (npm must reach the registry
normally, and must fail under the denial — a negative control, without which every
result after it means nothing), then runs `npm ci` for real against a
node_modules-free copy of the suite with its real lockfile, then runs the **whole
installer** under the same denial.

These are the results it produced on the development estate. They are evidence that the
offline path works, not a prediction about your machine — run the script on yours and
compare, because the two cache rows below are the ones that decide which bundling
strategy you need:

| | |
|---|---|
| npm reaches the registry undenied | yes — so a failure under denial means the denial |
| npm reaches the registry under denial | **no** (`ECONNREFUSED`) |
| `npm ci`, denied, **warm** npm cache | **succeeded** — the local cache already held every tarball |
| `npm ci`, denied, **cold** cache | **failed** — this is the step that genuinely needs the internet |
| Full installer, registry denied, node_modules pre-staged | **passed**, including a live bMS read and three host configurations written |

The warm-cache result is not a broken test, it is a second viable strategy: **ship
the npm cache** instead of `node_modules`. It only works if the cache really holds
everything, which is what the cold-cache row settles.

### Building the bundle

On a connected machine:

```powershell
.\lib\New-OfflineBundle.ps1 -Destination D:\bconnect-mcp-offline
```

It runs `npm ci`, builds `@bconnect/mcp-core` and every server, and — explicitly —
**builds the gateway**, which the suite's own root build script does not: that script
globs `bconnect-*-mcp` and the gateway directory is `bconnect-mcp-gateway`, so
building "everything" upstream skips it and you find out at `npm start`. Offline is a
bad moment to find that out. It then copies the suite (with `node_modules` and build
output) and the installer, writes a manifest, and **checks that no credentials file
ended up in the bundle** rather than trusting the exclusion.

### Staging an offline install — the whole list, in order

The bundle carries Node's dependencies and the built server packages. It does **not**
carry the MCP client, and it cannot: VS Code, Claude Desktop, Cursor, the Codex CLI
and the rest are separate products under their own licences. This installer
*configures* MCP clients; it does not install them. On a connected network that is a
five-minute detour. On an isolated one it is the step that decides whether the run
has anywhere to land — a configuration written for a client that is not on the
machine is a file nothing will ever read.

On a machine with internet access:

1. Build the offline bundle — `.\lib\New-OfflineBundle.ps1 -Destination D:\bconnect-mcp-offline`.
2. Download the **Node.js x64 MSI**, 22.15 or newer, and put it beside the bundle.
   The servers run on it; nothing in the bundle installs it.
3. **Download the installer for each MCP client you intend to configure, and put it
   beside the bundle.** VS Code, Claude Desktop, Cursor, Continue, the Codex CLI —
   whichever the administrators on that network actually use. Take the offline or
   system-wide installer where the vendor offers one; several of these ship a small
   web-download stub by default, which is useless on an isolated network.
4. If the bMS certificate comes from an internal CA, export that CA in PEM form
   (Base-64 encoded X.509) and put the file beside the bundle. Node before 22.15 does
   not read the Windows certificate store at all, and the installer asks for this
   file by path. See *TLS and internal certificate authorities* below.
5. Copy the whole staging folder to the air-gapped machine.

On the air-gapped machine, in this order:

6. Install Node.js from the MSI, then **close and re-open** the console or the wizard
   so the new `PATH` is picked up.
7. Install the MCP client or clients from step 3. Do this **before** the installer
   runs: the wizard's Clients page marks each row it cannot find on this computer, and
   distinguishes *not installed on this computer* from *not selected* — but only the
   first of those is something you can still fix at that point.
8. Run the installer:

```powershell
cd <bundle>\install
.\Install-BConnectMcp.ps1 -SkipBuild
```

  or `.\Install-BConnectMcp-UI.ps1` for the guided window. Its first page asks
  whether the assistant runs on this computer or the servers are to be shared over
  the network, and that answer governs which clients are offered — so know it before
  you start.

9. Restart each configured client. Nothing in the run proves a client has loaded the
   file; only its own restart does.

### The trap this scenario invites

**Do not set a blunt `HTTP_PROXY` / `HTTPS_PROXY` in the environment your MCP host is
launched from.** It is the obvious thing to do on a machine with no direct internet
route, and it is inherited by every MCP server the host spawns — so their bConnect
calls go to the proxy too, and the proxy is not going to reach a bMS on the LAN.

The symptom is nasty: the server starts, completes the handshake, lists all 68 tools,
and then fails **every** tool call with

> Cannot connect to the bConnect API. Check network connectivity and
> `BCONNECT_BASE_URL` configuration.

which reads exactly like a wrong URL or a wrong key, and is neither. This was found
here by accident, while setting a proxy to deny npm; `Test-OfflineInstall.ps1` now
reproduces it deliberately and shows the clean control beside it. The fix is to put
the bMS host in `NO_PROXY`, or not to set a proxy in that environment at all.

---

## The five traps this replaces

These are the things that actually went wrong when this suite was first set up here.
The installer handles each one by construction, so you do not have to know about them
— but they are worth knowing anyway.

**1. Every server exits immediately at launch.**
`mcp-core` probes `/v2.0/WindowsEndpoints` at startup. The real route is
`/endpoints/v2.0/WindowsEndpoints` — the module segment is missing. No server
overrides the default and there is no setting for it, so against a *correctly
configured* bMS the probe gets a 401, `testConnection()` returns false, and `main()`
calls `process.exit(1)`. In all fourteen servers. Claude Desktop reports only
"server disconnected", which tells you nothing.
→ The generated env file sets `BCONNECT_SKIP_CONNECTIVITY_CHECK=true`, with a
comment saying why. Tool calls are unaffected; each module builds its own correct
path. Step 4 does the connectivity check properly instead. If a server still fails to
start, verification prints the server's own stderr and names this as the likely cause.

**2. A `.env` next to a server is silently ignored.**
`dotenv.config()` resolves `.env` from `process.cwd()`, and Claude Desktop's cwd is
its own directory.
→ The configuration uses `node --env-file=<absolute path>`, which loads
deterministically *and* keeps the API key out of the plaintext Desktop config.

**3. A file-level ACL on the credentials file cannot hold.**
Editors save by writing a temp file and renaming over the original, so the file your
ACL was attached to stops existing and the replacement re-inherits
`BUILTIN\Users:(RX)`. Re-applying it after each edit is a treadmill, not a fix. Two
smaller traps live inside this one: granting `(R,W)` instead of `(M)` omits DELETE, so
the editor's save fails *silently*; and the `BUILTIN\Administrators` ACE does not help
a non-elevated session, because that group is filtered out of a non-elevated token.
→ The installer hardens the **directory** before writing anything into it, grants
`(M)` to you by SID, writes the file the same way an editor does — temp file, then
replace — and then re-checks the ACL. If a broad-group ACE is present afterwards it
stops rather than continuing.

**4. The write gate is two layers and easy to half-apply.**
`ALLOW_WRITE_OPERATIONS=true` unlocks *all* write tools in a server. A second
variable, `ALLOWED_WRITE_TOOLS`, narrows that to a named list — but it exists in
`bconnect-jobs-mcp` only; every other server's gate is genuinely all-or-nothing. The
installer says so rather than implying uniform protection.
→ Read-only unless you opt in, per server, by typing `ENABLE WRITES`. Where the
allowlist exists you are offered it first. The flag is written into the **per-server**
`env` block, never into the shared credentials file — putting it there would unlock
writes in every configured server at once.

**5. Config changes need a full quit and relaunch.**
Closing the window is not enough. Claude Desktop reads the configuration at launch
and keeps running in the tray.
→ The installer cannot do this for you. It ends by telling you to, and says plainly
that nothing it checked proves Desktop has loaded the new file.

---

## Credential storage: plaintext or DPAPI

The installer asks once. **Plaintext is the default**, and declining gives you exactly
today's behaviour — nothing about your installation changes.

### What each one is

| | Plaintext (default) | DPAPI-protected |
|---|---|---|
| On disk | `secrets\bconnect.env`, readable text | `secrets\bconnect.env.dpapi`, ciphertext |
| Protected by | the directory ACL | the ACL **and** DPAPI at CurrentUser scope, with entropy |
| Launched as | `node --env-file=<file> <server>` | `powershell -File lib\Start-BConnectServer.ps1 ...` |
| Setup required | none | none — no vault, no enrolment, no passphrase |

Exactly one of the two files exists at a time. Choosing the other one converts it and
removes the old file; you never hand-edit anything and never re-type a credential.

### The trade-off, in one line

**It protects a file that walks off the machine — a copy, a backup, an accidental
commit. It does not protect against malware running as you, which can call DPAPI
itself.**

That is the whole of it. An ACL is an attribute of a file on this volume; it does not
travel. DPAPI ciphertext is worthless anywhere except inside this Windows profile on
this machine, which closes the "someone ended up with the file" case and only that
case. Anything already executing with your token can call `Unprotect` the same way the
launcher does. The entropy is an application constant living in the open in
`lib\Dpapi.psm1` — it scopes the blob to this tool so a generic DPAPI call cannot read
it; it is not a second secret and does nothing against anyone holding the source.

### Why a launcher exists

Claude Desktop starts each server as a command plus arguments. Node has no DPAPI, so
when protection is on the configuration launches `lib\Start-BConnectServer.ps1`, which

- decrypts in memory,
- starts `node` with the values in the **child's environment block** — never as an
  argument, never through a temp file,
- passes its own standard handles straight through, so Desktop's pipes reach node
  untouched and nothing buffers or re-encodes the MCP stream,
- writes nothing at all to stdout (stdout *is* the MCP transport; one stray character
  and Desktop reports only "server disconnected"), and
- holds the child in a kill-on-close job object, so killing the launcher does not
  leave an orphaned node process holding a decrypted key.

It costs roughly 0.5–1 s of extra start-up per server.

### Going back

Re-run and choose the other option. From the wizard it is a radio button under
**Advanced** on the Connect page; from a console:

```powershell
.\Install-BConnectMcp.ps1 -PlaintextCredentials -ReuseCredentials -Servers <your servers>
.\Install-BConnectMcp.ps1 -ProtectCredentials  -ReuseCredentials -Servers <your servers>
```

`-ReuseCredentials` means it re-encodes what is already there rather than asking for
the key again. The Desktop configuration is rewritten to match in both directions.

### If it stops working

A CurrentUser blob is readable only by the account that created it, on the machine
that created it. Run the installer as a different Windows account and the launcher
fails with a message that says so and names the account it is running as. If you are
locked out, `-PlaintextCredentials` will not help — you need the original account, or a
fresh API key.

---

## What verification proves, and what it does not

Step 10 starts each server using the `command`, `args` and `env` block read out of
**each host's own configuration file** — `claude_desktop_config.json`, `.mcp.json`,
`.vscode\mcp.json`, `.cursor\mcp.json`, the Continue block file — parsed in that
host's documented container shape. Nothing is supplied by the verifier. That
distinction is the point: a probe that spawns its own servers with its own
environment passes whether or not the deployed configuration is correct — which is
exactly how a write-tool allowlist here was recorded as applied for a week while the
live configuration had none.

**Proven, against the live configuration**

- each configured server starts and completes the MCP handshake instead of exiting
- the credentials it points at authenticate and return real data
- the write posture reported is the one in force in that server process — the
  refusals came from the configured server, not from a test harness

**Not proven**

- **That Claude Desktop has loaded it.** Only a full quit and relaunch does that.
- **That any other host loads its file.** Two were checked here: Claude Desktop, and
  Claude Code (`claude mcp list` enumerated the servers out of an emitted `.mcp.json`
  and printed their command lines back — then reported them as pending the one-time
  project-trust approval, which is a security control, not a configuration fault).
  VS Code, Cursor, Continue, LibreChat, Open WebUI, n8n, OpenAI and Copilot Studio are
  **not installed on the development machine**, so for those the claim is exactly as strong as
  *Which hosts* says it is and no stronger.
- **That an empty result means an empty estate.** bConnect answers HTTP 200 with
  `totalItems: 0` for collections your API key may not read. There is no 403 and no
  warning; authorisation scoping is indistinguishable from an empty estate. Spot-check
  one answer against the bMC console.
- **That unrestricted write tools are safe.** Where a server is write-enabled with no
  allowlist, the gate is reported, not tested — testing it would mean performing a
  write, which this installer will not do. (`-ProbeAllowlistPositive` opts into one
  narrow exception: an allowlisted write tool called with an all-zeros GUID, which
  passes the gate and is rejected by bConnect as a bad identifier. Nothing is created.)
- **Anything about bMS-side authorisation.** The API key's own ACL is a second,
  independent boundary underneath this one and can refuse calls that pass every check
  here.

---

## Re-running

**The rule: an option you are not asked about on a run keeps the value it has.**

That is enforced rather than intended. The credentials file is edited key-by-key
(`Merge-EnvText`) instead of being rebuilt from the answers of the current run, and
every per-server `env` block is read out of the host configuration before it is
written back. So a re-run to correct a base-URL typo does not take your internal-CA
path, your v1.1 domain credential, your gateway bearer token or your hand-raised
`BCONNECT_TIMEOUT_MS` with it — which is what it used to do, silently, measured at
14 keys in and 9 keys out.

Each run leaves an **installation record** at `install\state\installation.json`. It is
non-secret and world-readable on purpose: it holds the v1.1 *username* (an identity,
already visible in the bMS console) and the *fact* of a gateway token, never a value,
so a reconfigure can describe an installation it cannot yet decrypt. It is what lets a
later run know which hosts to re-emit to, which servers were selected, and which write
gates to keep. It is also optional: an installation made before it existed is
**adopted** — reconstructed from the host files and the credentials store, and said so
out loud.

### One installation serves one bConnect server

A run whose base URL names a **different** bMS from the one in the record is refused,
and both URLs are named:

```
  [FAIL] this installation is already configured for a different bConnect server.
         recorded   https://bms-test.corp.local/bconnect
         requested  https://bms-prod.corp.local/bconnect
```

This is not tidiness. The entries written into a client configuration are keyed by
bare server name — `bconnect-endpoints`, `bconnect-jobs` — and each one names a single
credentials file by absolute path. A second install against another bMS replaces those
entries in place, so every configured client silently starts pointing at the other
estate with nothing on screen looking different. The next job an assistant is asked to
assign is assigned there. Customers evaluate against test before production, which
makes this an early path rather than an edge case.

Two supported ways forward, both leaving one installation pointed at one server:

```powershell
.\bconnect.ps1 set url https://bms-prod.corp.local/bconnect   # move this installation
.\bconnect.ps1 uninstall                                      # or start again
```

`set url` says out loud that it is moving the estate, names both servers, and changes
one line in the credentials file — no client configuration changes at all. Restart the
clients afterwards, and check the write gates before the first job is assigned:
`.\bconnect.ps1 writes show`.

Running two estates side by side from one Windows account is not supported. Use a
second Windows account, or a second machine.

A URL that merely *looks* different is not a different server: a trailing slash, the
case of the host name, an explicit `:443`, and the `/bconnect` suffix this installer
lets you omit are all the same estate, and none of them triggers the refusal. A
different scheme or a different port is treated as a different endpoint, because it is
one.

The refusal happens before anything is written — before the reachability probe, and
long before the credentials file — so a refused run leaves the credentials, the client
configurations and the record exactly as they were. In `-NonInteractive` it exits
non-zero with the reason on standard output; it never asks a question a deployment job
cannot answer.

### The settings window

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Manage-BConnectMcp.ps1
```

Everything below, without a command line. It is a front end over `bconnect.ps1` in
exactly the way `bconnect.ps1` is a front end over the installer: it collects answers
and renders results, and every control that changes something resolves to one verb.
Its Status page is `bconnect.ps1 status -Json`, rendered — not a second computation of
the same facts.

Two things it states that were previously undocumented knowledge, per change and
naming the client from `lib\hosts.json`:

* a **host-configuration** change (the write gate, the v1.1 gate, which clients are
  configured) is read by the MCP client when it starts; until that client is
  restarted, nothing has changed for it;
* a **credentials-file** change (base URL, credential, audit level, rate limiting) is
  read by a server process when it starts — and the client is what starts those, so a
  gateway running as its own process has to be restarted separately.

Four settings are shown read-only, each with the reason: `ALLOW_SECRET_READ`,
`ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT`, `BMC_CONSOLE_LINKS` and
`BCONNECT_COMPOSITE_BUDGET_MS`. They are in neither the credentials-file key set nor
`HOST_CONFIG_ENV_ALLOWLIST`, so no route reaches them — see *Settings with no route*
below.

### The verbs

```powershell
.\bconnect.ps1 status                     # what is installed, where, and any drift
.\bconnect.ps1 status -Json               # the same facts as data, for a front end
.\bconnect.ps1 verify                     # verification only
.\bconnect.ps1 set url https://bms.example.com/bconnect
.\bconnect.ps1 set credential             # masked re-prompt
.\bconnect.ps1 set v11-credential         # UPN-validated, v1.1 probed
.\bconnect.ps1 set audit all|write|security|none
.\bconnect.ps1 set rate-limit on [max] [window-ms] | rate-limit off
.\bconnect.ps1 enable v11 | disable v11
.\bconnect.ps1 servers list | add <a,b> | remove <a,b> | set <a,b>
.\bconnect.ps1 writes show | enable <server> [tools...] | disable <server> | disable-all
.\bconnect.ps1 hosts list | add <id> | remove <id> | resync
.\bconnect.ps1 gateway enable | rotate-token
.\bconnect.ps1 protect | unprotect
.\bconnect.ps1 uninstall [-KeepCredentials]
```

Each of these is a thin front end over one `Install-BConnectMcp.ps1 -NonInteractive`
invocation. There is no second implementation of the install logic — the same rule
that has kept the wizard and the console installer from drifting.

What each one actually changes:

| Verb | What moves |
|---|---|
| `set url`, `set credential` | one line in the credentials file. **No host file changes at all** — a host config carries only a path to that file, so the launch shape is identical |
| `writes enable` / `writes disable` | the `env` block of that one entry, in every recorded host |
| `enable v11` | `BCONNECT_ENABLE_V11=true` in the `env` block of every selected server that has v1.1 tools |
| `servers add` | builds the added package only, then adds the entry to every recorded host |
| `hosts add` / `hosts remove` | emits the new one; strips only the managed entries from the old one |
| `hosts resync` | re-emits every recorded host from the record — the fix for a host file that was deleted or hand-edited |
| `set audit`, `set rate-limit` | one line each in the credentials file. Neither is a secret and neither is a capability gate, but both live there because that is the file every server is launched with. No host file changes at all |

`writes disable <server>` matters as much as `writes enable`: a gate that cannot be
turned off in one command does not get turned on. A server that is simply *absent*
from a run keeps the gate it has; turning one off is something you have to say.

### Settings with no route

Four environment variables the servers read have no verb, no installer parameter and
no control in either window. They are named here rather than left to be discovered:

| Setting | What it does | Why nothing here sets it |
|---|---|---|
| `ALLOW_SECRET_READ` | permits the tools that return live BitLocker recovery keys, LAPS passwords and the bMS API-key inventory | a security gate, read per server process. The credentials file is shared by every server, so setting it there would open those tools in **all** of them at once; and the keys a client configuration may carry are a closed list (`HOST_CONFIG_ENV_ALLOWLIST` in `lib\host-emitters.mjs`) that must not grow, because that file is merged into a third-party product's configuration |
| `ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT` | permits assigning a job the bMS flags *Destructive* — a wipe or an OS deployment — to a group | a second gate inside the write gate: accepting writes is not accepting unattended wipes. Same two closed routes, same reason neither is widened |
| `BMC_CONSOLE_LINKS` | adds deep links into the baramundi Management Center to endpoint results | neither a credential nor a capability gate, so it belongs to neither key set |
| `BCONNECT_COMPOSITE_BUDGET_MS` | the time budget a composite call spends paging before returning what it has (25000 ms unset, clamped at 1000 ms) | a per-server tuning value in neither key set |

Set any of them in the environment of the **one server** that needs it — the client's
`env` block for that server, or the container environment — and restart that server.
Nothing picks the change up in a running process.

### Uninstall

```powershell
.\bconnect.ps1 uninstall              # type UNINSTALL to confirm
.\bconnect.ps1 uninstall -KeepCredentials
```

It removes the `bconnect-*` entries from every recorded host (leaving everything else
in those files byte-identical, with a backup taken first), the credentials file, the
installation record and the emitted snippets — and then prints **what it did not
remove**, starting with the one that matters:

> THE bMS API KEY ITSELF. Deleting the credentials file removes this machine's copy of
> the key. The key is still valid on the bMS. Revoke it in the bMS console:
> Server Management → API Keys. Nothing here can do that for you.

The same is said about the v1.1 domain account, `node_modules`, the build output and
the backups. An uninstall that leaves a live credential and does not say so is worse
than no uninstall.

### If the software is moved or removed without the verb

`bconnect.ps1 uninstall` is what removes the client entries. Nothing else does, and
nothing rewrites a client configuration without being asked — re-emitting and removing
are opposite answers, and only you can choose between them.

So three situations leave entries naming files that are no longer there:

* **an upgrade to a different directory.** `UsePreviousAppDir=yes` keeps an upgrade on
  the previous location, which is what keeps the absolute paths in every entry valid.
  It is a default, and `/DIR=` overrides it. If the location moves, the record stays
  behind in the old directory and every entry still names the old one.
* **the installation directory deleted by hand**, or the suite root renamed.
* **the program files removed by an uninstaller you told not to remove the
  configuration.** The uninstaller says so at the time.

`bconnect.ps1 status` finds all three the same way — by reading the entries rather than
the record, so it works even when there is no record to read:

```
  drift
  [warn]   'bconnect-endpoints' in claude-desktop starts a file that is not on this
           machine: C:\Program Files\baramundi\bConnect-MCP\...\build\index.js
    -> bconnect hosts resync   (re-emits every entry from this installation's
       location), or bconnect uninstall to remove the entries
```

Run `hosts resync` from the installation you want the entries to point at, and they are
re-emitted with that location's paths.

### The guided walk

```powershell
.\Install-BConnectMcp.ps1 -VerifyOnly    # re-check, change nothing
.\Install-BConnectMcp.ps1                # reconfigure, every prompt defaulted to the CURRENT value
.\Install-BConnectMcp.ps1 -DryRun        # report what would change
```

On a re-run the write-gate step no longer asks "enable writes for any server? [y/N]"
over an install that already has one — it prints what each server's gate *is* and
offers `[K] keep  [E] edit the allowlist  [D] disable writes`, defaulting to keep.

Useful switches:

| Switch | |
|---|---|
| `-VerifyOnly` | Verification pass only |
| `-DryRun` | Writes nothing — no credentials file, no config change, no build |
| `-SkipBuild` | Skip the build (only when you know it is current) |
| `-ReuseCredentials` | Keep the existing credentials file, do not prompt for secrets |
| `-ReadOnly` | Force read-only, skip the write-gate questions |
| `-Servers a,b` | Non-interactive server selection |
| `-RemoveUnselected` | With `-Servers`, also drop configured servers not in the list |
| `-ProtectCredentials` / `-PlaintextCredentials` | Choose the credential storage form without being asked |
| `-SuiteRoot`, `-SecretsDir`, `-ConfigPath` | Point at other locations — use these to rehearse against a copy |
| `-ListHosts` | Print the host-target table and exit. Changes nothing |
| `-Hosts a,b` or `-Hosts all` | Which hosts to configure. Unspecified means `claude-desktop` |
| `-ProjectDir` | Project root for per-project targets (`.mcp.json`, `.vscode\mcp.json`, `.cursor\mcp.json`) |
| `-HostOutDir` | Where snippets and companion notes go. Default `install\out` |
| `-HostPath @{ id = 'path' }` | Per-target path overrides |
| `-Gateway` | Configure the HTTP gateway. Turned on automatically by any HTTP-only host |
| `-GatewayBind`, `-GatewayPort` | Default `127.0.0.1` and `3001` |
| `-GatewayIUnderstandThereIsNoAuth` | Required for a non-loopback bind. Asserts a proxy is in front; nothing checks it |
| `-StartGateway` | Start the gateway and verify it with a real MCP session over HTTP |

### Running it with no questions at all

`-NonInteractive` answers nothing from a prompt and everything from a parameter. This
is the mode the wizard drives, and it is available to any script:

```powershell
.\Install-BConnectMcp.ps1 -NonInteractive `
    -BaseUrl 'https://bms.example.com/bconnect' `
    -ApiKeySecure (Read-Host 'key' -AsSecureString) `
    -Servers bconnect-endpoints,bconnect-jobs `
    -PlaintextCredentials `
    -WriteGate @{ 'bconnect-jobs' = @('create_job_instance','start_job_instance') }
```

| Parameter | |
|---|---|
| `-BaseUrl` | The base URL. A module segment is a hard error here rather than an offer to fix it |
| `-ApiKeySecure`, `-BasicUser` + `-BasicPassSecure` | Credentials, as a `SecureString`. There is still no plaintext `-ApiKey`; a `SecureString` cannot be typed on a command line, so this cannot be misused the way that would have been |
| `-V11User` + `-V11PassSecure`, `-CaCert` | Optional, as in the guided run |
| `-WriteGate` | The write gate as data: server name → allowed tools, or `@('*')` for every write tool in that server. A server **absent** from the hashtable keeps the gate it already has; an **empty list** for a server removes its gate; `-ReadOnly` removes all of them. (This changed: absent used to mean read-only, so a re-run that said nothing about writes silently removed an existing gate) |
| `-StateFile` | The installation record. Default `install\state\installation.json` |
| `-Uninstall`, `-KeepCredentials`, `-HostEntriesOnly` | Removal, and the partial removal `bconnect hosts remove` uses |
| `-BuildSelectedOnly` | Build `@bconnect/mcp-core` and the selected servers only, not all fourteen |
| `-Force` | Overwrite a credentials file that cannot be decrypted, or a managed entry that was hand-edited. Both are refused without it, because both destroy something recoverable |
| `-ContinueOnUnreachable` | Proceed even if the Step 4 call to bConnect fails. Without it, an unreachable bConnect stops the run |
| `-EmitProgress` | Emit step records on the Information stream. Invisible in a console; the wizard reads them |

Anything missing is named: `-NonInteractive was given but -BaseUrl was not.`

Two honest notes about this mode. `-WriteGate` takes data, so there is no typed
`ENABLE WRITES` confirmation — the wizard asks for it in its own UI before it will
build such a hashtable, but a script calling this parameter directly is trusted to
have meant it. And a non-interactive run silently accepts a base URL that does not end
in `/bconnect` (it warns), because the guided run only warns about that too.

To rehearse safely against a copy of your real configuration:

```powershell
Copy-Item "$env:APPDATA\Claude\claude_desktop_config.json" C:\temp\config-copy.json
.\Install-BConnectMcp.ps1 -DryRun -ConfigPath C:\temp\config-copy.json
```

---

## Where things end up

| | |
|---|---|
| Credentials | `<project>\secrets\bconnect.env`, or `bconnect.env.dpapi` if protected — outside the repository working tree, in a directory with a restrictive inheritable ACL |
| Installation record | `install\state\installation.json` — non-secret and world-readable by design; holds identities and facts, never a credential value |
| Claude Desktop config | `%APPDATA%\Claude\claude_desktop_config.json`, backed up to `.bak-<timestamp>` before every change |
| Build output | `<suite>\bconnect-*-mcp\build\index.js` |
| The wizard | `install\Install-BConnectMcp-UI.ps1` |
| Launcher shim | `install\lib\Start-BConnectServer.ps1` (used only when credentials are protected) |
| Credential protection | `install\lib\Dpapi.psm1` |
| Branding assets | `install\assets\logo.png`, `install\assets\app.ico` — see *Branding assets* above |
| Icon converter | `install\lib\New-AppIcon.ps1` — only needed if `app.ico` is ever replaced |
| Wizard theme/asset tests | `install\lib\Test-WizardTheme.ps1` |
| Host-target registry | `install\lib\hosts.json` — shapes, doc URLs, and the claims deliberately not made |
| Host config emitters | `install\lib\host-emitters.mjs` (pure) + `install\lib\emit-host-config.mjs` (CLI and writers) |
| Other hosts' configs | `<project>\.mcp.json`, `<project>\.vscode\mcp.json`, `<project>\.cursor\mcp.json`, `~\.continue\mcpServers\bconnect-mcp.yaml` — each backed up before every change |
| Snippets and notes | `install\out\*.md`, `install\out\librechat.mcpServers.yaml` |
| Gateway launcher | `install\lib\Start-BConnectGateway.ps1` |
| Gateway logs | `%LOCALAPPDATA%\bconnect-mcp\logs\gateway.{out,err}.log` |
| Offline bundle builder | `install\lib\New-OfflineBundle.ps1` |
| Wizard host page (not yet wired) | `install\lib\HostSelectionPage.ps1` + `install\lib\HOST-WIZARD-PAGE.md` |

No credential ever appears in **any** host configuration file. Every one carries only
the path to the credentials file, and every emitted config is scanned for a credential
before it is written — with a negative control in the test suite proving that scanner
fires on a planted secret.

---

## If something fails

**A server does not start.** Verification prints that server's stderr — the thing
Claude Desktop hides behind "server disconnected" — and, for the two common causes,
names them. Read it; it is almost always specific.

**bConnect returns 401.** Check the base URL before the credential. bConnect answers
401, not 404, for routes it does not recognise, so a wrong URL and a wrong password
look identical. This misdiagnosis has cost this project real time.

**A TLS error.** You should not have to read this section to fix one. The connectivity
probe (`lib\probe-tls.mjs`) classifies the failure and names the cause — untrusted
issuer, hostname mismatch, expired certificate, not-yet-valid certificate, revoked,
unusable for server authentication, a signature that did not verify, a CA file that
could not be read, a port that answered without TLS, DNS, refused, unreachable,
timeout, reset — and prints the certificate it saw and an ordered remedy. The console
prints it in Step 4; the wizard renders the same object as a panel at the top of the
run page, so it survives the several hundred lines of build output that follow. Where
the cause is an issuer this machine does not trust, the wizard's remedy ends with the
name of the field that takes the fix: **CA CERTIFICATE (PEM)** on the Credentials
page.

The distinction that matters most is *untrusted issuer* versus *hostname mismatch*: a
CA certificate fixes the first and does nothing for the second, where the certificate
is already trusted and the name in the base URL is what does not match. An IP address
in the base URL is the usual cause of the second.

The short form, if you already know which one you have: install the bMS certificate
chain into the Windows store and use Node 22.15 or newer, or set
`BCONNECT_CA_CERT_PATH` to a PEM copy of your internal CA — the whole chain above the
bMS certificate, because that variable *replaces* the trust list rather than adding
to it.

**Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`.** It disables certificate verification
for every TLS connection the process makes, including the ones carrying your bMS
credential — not just the one you are debugging. It is a development flag. This
installer does not set it, does not offer it, and neither the console nor the wizard
lists it among the things to try.

**A package fails to build.** The compiler output is printed and the package is
named. `@bconnect/mcp-core` must build first — the servers import it, and a single
server directory cannot be built on its own.

**Everything passes but Claude Desktop shows nothing.** You have not fully quit it.
Tray icon → Quit, then relaunch.

---

## Testing the installer itself

The credential handling — directory ACL, atomic write, env file generation — lives in
`lib\Secrets.psm1` so it can be tested for real without anyone typing a real secret:

```powershell
.\lib\Test-Secrets.ps1
```

Thirty-one checks against a throwaway directory with a dummy value, including a
negative control (a deliberate `Users:(RX)` grant, to prove the detector fires), the
write-temp-then-replace survival test, and a real `node --env-file` parse of the
generated file. It never touches the real credentials file.

Sixteen of those cover the gateway bearer token (SEC-7): that the generator produces
43 base64url characters from a CSPRNG rather than `Get-Random`, that the token is
appended to a **pre-existing** credentials file without disturbing what is already
there (the upgrade path — an installation that predates the feature must be able to
gain a token without the operator re-typing a bMS password), that re-running is
idempotent rather than churning the token, and that a rotation leaves exactly one
`MCP_GATEWAY_AUTH_TOKEN=` line holding a window of **two** values rather than a
growing list.

The reconfigure surface — state preservation, the installation record, the verbs and
uninstall — has its own suite:

```powershell
.\lib\Test-Reconfigure.ps1
```

Seventy-two checks, about three minutes, entirely against a throwaway directory tree
with dummy credentials and a base URL that does not resolve. It never reads or writes
the real credentials file, the real Claude Desktop configuration or the real record,
and it makes no call that can reach a live bMS.

Most of it is one shape repeated: put a value on disk, re-run the installer **without
mentioning that value**, and assert it is still there. Every check was run against the
unfixed installer first and observed to fail — a re-run that changed the base URL took
a 14-key credentials file to 9, and a re-run that said nothing about writes printed
`read-only` and removed an existing gate. Three later mutations of the *fixed* code
were each caught by exactly the checks written for them: reverting the credentials
write to a rebuild (7 failures), blinding the gate reader to what is deployed (3), and
forgetting the recorded host list (2).

The host targets have their own suite:

```powershell
.\lib\Test-HostTargets.ps1          # emitters, shapes, and a real emit into a temp dir
.\lib\Test-HostTargets.ps1 -Live    # also starts the servers named in each emitted file
```

159 checks in total. The part that carries the weight is the **negative controls**:
thirteen deliberately wrong emissions are fed to the validator and it is required to
catch every one — including a VS Code config written under `mcpServers` instead of
`servers`, a Continue config emitted as a map instead of a list, a Claude Code `url`
entry with no `type` (which that vendor documents as an error), an `env` value that is
a number, a selected server silently missing from the output, and a bConnect
credential smuggled into a host config. There is also a control **on** the controls: a
known-good document must be accepted, because "everything is rejected" and "the
validator works" look identical otherwise.

The suite also proves that an unknown host target is a hard failure rather than a
silent skip, that an HTTP-only target without a gateway is refused rather than
emitting something unusable, and that a target file which is not valid JSON is left
untouched.

On the gateway token it asserts both halves of the same claim: every HTTP-facing
snippet **names** the `Authorization: Bearer` header the gateway now requires — a
config handed to n8n without it produces a 401 the operator cannot diagnose from the
file they were given — and no emitted file **contains** the token value, because
`install\out` is an ordinary directory that gets pasted into tickets while the
credentials file is ACL-hardened.

The offline path is demonstrated rather than asserted:

```powershell
.\lib\Test-OfflineInstall.ps1
```

See *Installing with no internet access* above for what it does and what it found.

The DPAPI protection and the launcher shim have their own suite:

```powershell
.\lib\Test-CredentialProtection.ps1
```

Thirty-eight checks against a throwaway directory with a *fabricated* secret. Three of
them carry the weight:

- a **negative control** that points the leak detector at a plaintext file containing
  the secret and requires it to fire — every "no leak found" result below it is
  meaningless otherwise;
- the child process's **real command line, read out of `Win32_Process`** while it runs,
  asserted not to contain the secret, with its own negative control;
- the launcher asserted to contribute **nothing** to stdout, because stdout is the MCP
  transport.

Also covered: byte-exact protect/unprotect round trip; that the wrong entropy and no
entropy both fail to decrypt (so the entropy is demonstrably in force); that a tampered
container fails loudly; that exactly one of the two credential files exists after a
conversion in either direction; and that no file anywhere ends up holding the decrypted
value.

One of them is there because it caught something. The launcher used to start node and
*then* put it in the kill-on-close job, and a kill landing in that gap left a server
running with a decrypted key in memory and nothing owning it — an orphan turned up on
this machine during testing. The launcher now joins the job itself before starting
anything, so the child is born inside it; the test kills the launcher six times at
staggered moments and requires zero survivors.

What neither suite covers, stated plainly: **a real Claude Desktop launch**. Everything
is spawned the way Desktop spawns it, from a configuration file, but Desktop itself is
not in the loop — only a full quit and relaunch proves that half.

### The wizard's own theme and asset handling

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\lib\Test-WizardTheme.ps1
```

Dot-sources the real `Install-BConnectMcp-UI.ps1` with an internal `-TestHeadless`
switch that builds the actual window from the actual XAML and stops before
`ShowDialog()` — no visible window, nothing to click through. It asserts the WCAG
contrast ratio (computed, not eyeballed) for every text/background pair in the light
palette and, separately, for the run page's dark output pane; that the title-bar badge
fix is really in place; and that the logo/icon load when `install\assets\` has the real
files and degrade cleanly (no exception, no broken image, no empty gap) when pointed at
paths that do not exist.

What it does not and cannot prove: what any of this looks like on a screen. There is no
screen access on the machine this was built on — the numbers are real, checked against
the standard relative-luminance formula, but nobody has looked at the window.

### The settings window

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\lib\Test-ManageGui.ps1
```

Eighty-five checks, about eight seconds, against a throwaway installation built by the
test: a scratch secrets directory with a dummy key, a base URL that does not resolve,
and a scratch client configuration carrying two servers. It builds the real window
headlessly and drives the real code-behind.

The load-bearing ones are the architectural claims, asserted two ways. The script is
tokenised and checked for **any** file-writing command — `Set-Content`, `Out-File`,
`New-Item`, `[IO.File]::Write*`, the credential-store writers — and separately, every
change any page can produce is read as data and checked to be a `bconnect.ps1` verb
from a closed list, with the dispatcher itself refusing anything else. One write-gate
change is then run for real against the scratch tree and the written file is read back:
its `env` block must carry only the three keys `HOST_CONFIG_ENV_ALLOWLIST` permits,
parsed out of `lib\host-emitters.mjs` rather than restated here.

Falsified before being trusted. Seven mutations of the fixed code were each caught by
the checks written for them, and the suite returned to 85/0 on revert: a change path
that wrote the credentials file directly, a restart notice that said "your MCP client"
instead of naming it, a fourth key added to the host-config list, an exclamation mark
and a contraction in a label, the verb list widened to admit `uninstall`, the audit
level routed at a host config instead of the credentials file, and per-tool tick boxes
offered for a server whose `allowlist` is false. That last one was a real defect found
by writing the test: `bconnect-endpoints` cannot narrow its gate, the installer says so
and enables all 21 write tools, and the window would have shown one.

## Reaching bMS from off-network — the baramundi Gateway

**baramundi ships a Gateway utility, deployed on a separate gateway server, which
facilitates bConnect API calls from off-network and cloud locations.** It is a vendor
product, not part of this suite; consult baramundi's own documentation for whether your
licence includes it and how it is deployed. It matters for every HTTP target in the
table above.

**The MCP servers do not have to run on the bMS LAN.** Point `BCONNECT_BASE_URL` at the
baramundi Gateway — with `BCONNECT_CA_CERT_PATH` if it presents its own certificate — and
the servers, plus the MCP gateway in front of them, can live in a DMZ, a cloud VM or a
container. The chain becomes:

```
cloud-hosted model  ->  bconnect-mcp-gateway  ->  MCP servers  ->  baramundi Gateway  ->  bMS
```

That dissolves the "unreachable by construction" objection recorded against
**copilot-studio**, which assumed the only way to reach bMS was from inside its own
network.

### Do not read this as a security fix

There are **two** gateways in this chain and they solve opposite ends of it:

| | Solves | Does not solve |
|---|---|---|
| **baramundi Gateway** (vendor product) | reaching **bMS** from off-network | anything about MCP |
| **`bconnect-mcp-gateway`** (this suite) | serving **MCP** over HTTP, and admitting only callers with the shared bearer token | TLS, and **who** the caller is — one token is not an identity (ADR-0003) |

So placing the MCP gateway somewhere a cloud model can reach it means placing an
internet-reachable MCP endpoint, guarded by **one shared secret**, where that cloud can
reach it. The token stops a scan; it does not expire, does not name a caller, and cannot
be revoked for one consumer without breaking every other. Behind it, the gateway speaks
to the whole estate through one service credential, with bMS RBAC as the only remaining
bound.

**A TLS-terminating, authenticating proxy in front of the MCP gateway is still the
blocker** for cloud-model deployments, and it is a real one — the bearer token is a
second layer behind it, not a replacement for it. On plain HTTP the token is also
readable in transit. Terminate TLS and authenticate at a reverse proxy, or use an
authenticated tunnel. Reachability and authorisation are different problems; the
baramundi Gateway answers the first.

### If your Gateway exposes v2.0 only — check, then plan around it

**Which bConnect API versions a baramundi Gateway exposes varies by deployment and Gateway
version. Verify yours before designing around it** — point a browser or `curl` at the Gateway's
bConnect base URL and confirm whether the **v1.1** surface answers. A v2.0-only Gateway was
observed on the development estate in August 2026; that is one configuration, not a product rule,
and the vendor's own documentation is the authority.

If v1.1 is not reachable through your Gateway, five fields become unavailable — `Destructive`,
`AbortOnError`, `JobExecutionTimeout`, `RepeatedExecution` and `Steps` — because they live only in
v1.1. A deployment that reaches bMS through such a Gateway cannot read them.

That is the safety metadata specifically. Three tools notice:

| Tool | Off-network behaviour |
|---|---|
| `preview_assignment` | `destructive` becomes `null` and a **blocker** is raised — *"safety metadata unavailable"*. It does **not** default to "not destructive" |
| `diagnose_job` | returns its full v2.0 answer with `configuration.available: false`, an explicit `unavailableReason`, and `meta.missingSignals` naming what could not run |
| `explain_job_failure` | loses the per-job timeout and abort-on-error context in its clusters |

**These degrade honestly rather than silently, which is the important part** — nothing claims a job
is safe when it could not check. But it does mean that over a v2.0-only path, the
propose-before-act guardrail answers *"I cannot tell you"* for every job rather than *"this one is
destructive."*

Plan for it one of three ways: keep a v1.1 route available to the host running the MCP servers
(they need not be co-located with the model); accept the degraded answer and treat every
assignment as requiring human review; or wait for the Gateway to expose v1.1. What you should not
do is read an absent `destructive` flag as a negative — the tools are careful not to, and neither
should an operator.
