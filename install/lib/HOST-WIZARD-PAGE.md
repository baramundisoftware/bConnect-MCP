# Host selection — the wizard's client page

**Status: wired in.** `Install-BConnectMcp-UI.ps1` loads this page's XAML into its
Clients slot at runtime and drives it through `Get-HostSelectionCatalog`,
`Update-HostPage` and `ConvertTo-HostInstallerParameters`. The contract below is
what the window relies on; `Test-WizardHosts.ps1` and `Test-WizardPrep.ps1` hold it.

## What changed underneath the wizard

`Install-BConnectMcp.ps1` gained host targets. The wizard's contract is unchanged in
shape — it collects answers, the engine does the work, there is exactly one
implementation of the work — so this is a new page plus a few extra parameters on
the existing splat.

New engine parameters:

| Parameter | |
|---|---|
| `-Hosts` | comma-separated target ids, or `all`. **Unspecified means `claude-desktop`**, which is byte-for-byte today's behaviour |
| `-ProjectDir` | project root for per-project targets (`.mcp.json`, `.vscode\mcp.json`, `.cursor\mcp.json`) |
| `-HostOutDir` | where snippets and companion notes go; default `install\out` |
| `-HostPath` | hashtable of per-target path overrides |
| `-ListHosts` | print the target table and exit — useful for a "what is this?" link |
| `-Gateway` | configure the HTTP gateway |
| `-GatewayBind`, `-GatewayPort` | default `127.0.0.1`, `3001` |
| `-GatewayIUnderstandThereIsNoAuth` | **required** for any non-loopback bind |
| `-StartGateway` | start it and verify it with a real MCP session |

## Where the page goes

**Step 2 of 4** (`$PG_CLIENTS = 1`), between **Connect** and **Permissions**. That
order is deliberate: where to connect comes first because nothing works without it,
which clients is a question about where you work, and what the assistant may change
is the one that needs full attention last.

The wizard was cut from eleven pages to four. What that did to this page:

- the gateway section is **collapsed unless a selected client requires it**, or the
  deployment does. The opt-in for a client the registry does not name moved into an
  **Advanced** expander and drives `GatewayWantedCheck` rather than duplicating it,
  so there is still exactly one answer to "is the gateway part of this install"
- `SetupText` and `VerifiedText` moved from three lines under every row to the
  **tooltip on the badge each belongs to**. Both are still on the row object, still
  harvested by the tone scan, and stated in full in `install\README.md`. The badges
  themselves — the words `AUTOMATIC` and `MANUAL STEPS` — remain visible on every
  row before it is ticked, which is the product decision they exist for
- the project directory is still asked here, and still only when a per-workspace
  client is selected

## The deployment shape filters this list

The wizard's Connect page asks whether the assistant runs on the computer being
installed (**workstation**) or the servers are to be shared over the network behind
the gateway (**shared service**). `Select-ShapeTargets` filters the registry by that
answer, from each target's own `transport` field and nothing else:

| answer | keeps | leaves out |
|---|---|---|
| workstation | `transport` of `stdio` or `both` | the four HTTP-only targets |
| shared service | `transport` of `http` or `both` | the stdio-only targets |
| unanswered | everything | — |

No list of client names lives in the filter, so a new target is covered by declaring
its transport in `hosts.json` and nothing else. `ShapeNote` on this page states which
answer produced the list and names the clients it left out — a shorter list with no
explanation is read as a shorter product.

A shared-service answer also forces the gateway on with no HTTP-only client selected
at all: on that shape the clients are on other computers and have no other route in.

## The order of the list

`hosts.json` carries a `rank` on every target and the array is kept in rank order.
That is the only place the order lives: `Get-HostSelectionCatalog` sorts by it and
no page has a client list of its own. The order is by how likely a baramundi
customer is to run the client — Microsoft estates first, generic fallback last —
not alphabetical and not the order support was added.

## Two badges per row, and they answer different questions

`SetupBadge` (left) says whether an install CONFIGURES that client or only produces
settings to apply; `Badge` (right) is the verification tier below. Both are data on
the row object.

| SetupBadge | Means | From |
|---|---|---|
| `AUTOMATIC` | the installer writes the file this client reads | `mode` is `merge-json` or `write-file` |
| `MANUAL STEPS` | the installer cannot write it; it writes the settings and you apply them in that product's own interface | `mode` is `snippet` |

Six targets are `MANUAL STEPS`, and four of those (`copilot-studio`, `openai`,
`n8n`, `open-webui`) also carry `serversKey: null`. Two of them are second and
fifth in the order, so this cannot be something the operator discovers at the end:
it is on the row, in the legend above the list, on the review page and in the
completion summary. Do NOT re-derive it from the verification tier — `generic` is
`config-spawn` and a snippet, and text keyed off the tier told the operator to
restart it.

## What to call

```powershell
. .\lib\HostSelectionPage.ps1

$rows = Get-HostSelectionCatalog -ProjectDir $projectDir -HostOutDir $outDir -ConfigPath $configPath
$xaml = Get-HostSelectionXaml          # colours come from window resources, not from here

# on Next:
$r = ConvertTo-HostInstallerParameters -Selected $checkedIds `
        -ProjectDir $projectDir -HostOutDir $outDir `
        -Gateway:$gatewayWanted -GatewayBind $bind -GatewayPort $port `
        -GatewayIUnderstandThereIsNoAuth:$noAuthAcknowledged -StartGateway:$startIt

$installerParams += $r.Parameters      # splat onto Install-BConnectMcp.ps1
$reviewPageCommandText += ' ' + $r.ConsoleCommand
```

`ConvertTo-HostInstallerParameters` also returns `GatewayRequired`,
`GatewayRequiredBy`, `Impractical`, `SchemaOnly`, `MissingHere`, `Automatic` and
`Manual` so the review page and the completion summary can say what the selection
implies without re-deriving it.

## Named elements the code-behind needs

| x:Name | |
|---|---|
| `HostList` | `ItemsControl`, bind to `Get-HostSelectionCatalog` |
| `GatewayPanel` | collapsed unless a selected target has `NeedsGateway` |
| `GatewayBindBox`, `GatewayPortBox` | text boxes |
| `GatewayNoAuthCheck` | see the rule below |
| `GatewayRotateTokenCheck` | SEC-7, maps to `-RotateGatewayToken`. Ship it unticked |
| `StartGatewayCheck` | ticked and disabled while the gateway is required; see rule 1 |
| `HostSummaryText` | live summary line |
| `ImpracticalWarning` | collapsed unless a selected target has `Impractical` |
| `ShapeNote` | which deployment answer filtered the list, and what it left out |

## Five rules this page must keep

**1. Selecting an HTTP-only host selects the *whole* gateway.** `open-webui`, `n8n`,
`openai` and `copilot-studio` cannot spawn a local process. Show `GatewayPanel` the
moment one of them is ticked. The engine does this too, so the UI is agreeing with
it, not deciding it.

"Whole" is the load-bearing word. Configuring the gateway and leaving it stopped
hands the operator a URL and a bearer token for an endpoint that is not listening,
which is a worse outcome than not offering the client. So the same selection also
implies `-StartGateway`: configured, token generated, **started, and verified**, in
the one run. That rule lives in `ConvertTo-HostInstallerParameters` and nowhere else
— `StartGatewayCheck` is ticked and disabled to *display* it, and a guard in
`Test-WizardHosts.ps1` calls the mapping function directly, with nothing ticked, so
the checkbox cannot keep the assertion green after the rule is removed.

What the operator is then left with is two values, both on the completion page: the
URL (`<GatewayUrl>/<domain>/mcp`, one per enabled server, where `<domain>` is the
server name with the `bconnect-` prefix removed) and the `Authorization: Bearer …`
header. Paste, not deploy.

**2. The gateway is authenticated by default, and the page must not offer a way
out of that (SEC-7).** Selecting the gateway always generates a bearer token —
there is no checkbox to disable it, on purpose. The gateway holds one bConnect
service credential and everything it admits gets that credential's full reach,
bounded only by bMS RBAC, so "no auth" is not a preference to expose next to a
bind box. `GatewayNoAuthCheck` remains only as the assertion that a fronting
proxy authenticates instead; disable **Next** while the bind is anything other
than `127.0.0.1` / `::1` / `localhost` **and** the operator has turned the token
off **and** that box is unticked. **Ship both boxes unticked, always.**

**2a. Show the token when the run finishes.** The engine emits it as a progress
record on its Information stream:

```
kind = 'gateway-token'; token; header; storedIn; state; rotated
```

Render it on the completion page with a **Copy** button — the operator has to
paste 43 characters into n8n or Open WebUI, and asking them to select it out of a
scrolling console pane is exactly the friction that ends with someone disabling
authentication. Show it once, do not persist it anywhere the wizard controls: it
already lives in the ACL-hardened credentials file, and the `storedIn` field says
where. If `rotated` is true, say that the previous token still works until the
installer is re-run without `-RotateGatewayToken`.

**3. The verification badge is not decoration.** Every row carries one of three,
and the wording matters more than the colour:

| Badge | Means |
|---|---|
| `VERIFIED HERE` | the host application itself was made to read the emitted file on this machine |
| `SERVERS STARTED` | the emitted file was parsed back and every server in it started, handshook and served a real bMS read. **Not** proof the host loads it |
| `SHAPE ONLY` | shape-checked against the documented schema; this host is not installed here and executed nothing |

This project has spent real time on claims that turned out to be untrue. The badge
is the mechanism that stops this feature becoming another one. Do not collapse the
three into "supported".

**4. Copilot Studio shows `ImpracticalWarning`.** It reaches your server from
Microsoft's cloud through Power Platform connectors, so a loopback or private-VLAN
gateway is unreachable by construction, and no private-network path for MCP is
documented. The row should still be selectable — the emitted file is genuinely
useful, it contains the connector Swagger — but the warning must appear.

**5. Automatic or manual is stated before selection, not after it.** Every row
carries `SetupBadge`, `SetupText` and `SetupBrush`, the legend above the list
explains both chips, and the same distinction is repeated on the review page and
in the completion summary. An operator who selects Copilot Studio at rank 2 and
discovers on the last page that nothing was configured for it has been misled by
the layout, whatever the emitted file says.

## Review page

Add the host list with each target's setup badge and verification badge, a line
naming the clients whose settings have to be applied by hand, and if any
`schema-only` target is selected, the one-line honesty statement the console run
prints:

> "SHAPE ONLY" means the file matches the shape that host documents and every
> credential stayed out of it — and that nothing on this machine has ever seen that
> host read it. Treat it as a well-founded starting point, not a tested integration.

## Run page

Nothing to change. The engine emits its usual progress records; the host work is
inside Step 9 (renamed from "Claude Desktop configuration" to "Host configuration")
and Step 10.

## Completion page

`Get-CompletionSummary` in the wizard builds it, from the row objects and nothing
else: what was installed and where, the clients this run configured with the file
written for each, the clients whose settings have to be applied by hand with the
file holding them, and what to restart — named, from `hosts.json`. Only an
`install` run gets one; a dry run configured nothing and must not appear to have.

## Testing the page without the engine

`Get-HostSelectionCatalog` reads only `lib\hosts.json` and environment variables.
It touches no credential, no bMS and no config file, so it is safe to call from a
design-time harness.

`Test-WizardHosts.ps1` (50 assertions) covers the selection, the parameters handed
to the engine and the gateway rules. `Test-WizardPrep.ps1` (75) covers the order,
the automatic/manual distinction, the preparation and requirements pages, the
completion summary, and a tone scan over every user-facing string in the window.
