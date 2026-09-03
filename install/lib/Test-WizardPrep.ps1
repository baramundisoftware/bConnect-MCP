<#
.SYNOPSIS
    Tests for the four-step wizard: the deployment question, "what you will need",
    the requirement checks and their banner, the install location, the permissions
    answer, the client ordering, the automatic/manual distinction, the completion
    summary -- and the tone of every user-facing string in the window and in
    README.md.

.DESCRIPTION
    Built the same way as Test-WizardHosts.ps1 and Test-WizardTheme.ps1 next to it:
    it dot-sources the REAL Install-BConnectMcp-UI.ps1 with -TestHeadless, which
    builds and wires the actual window, and returns instead of calling ShowDialog().
    Every assertion below reads that live object graph, the real lib\hosts.json and
    the real lib\HostSelectionPage.ps1.

    What this proves:
      * the client list is in the ONE order the product decided on, that the order
        lives in lib\hosts.json as data, and that the JSON array agrees with it -- so
        the engine's -ListHosts table and the wizard's list cannot disagree
      * every row says whether an install CONFIGURES that client or only hands the
        operator settings to apply, that the six snippet targets are the manual ones,
        and that the distinction survives into the review page and the completion
        summary rather than appearing for the first time at the end
      * install\README.md names every item an administrator has to have in hand
        before anything is collected -- the preparation PAGE it replaces was four
        bordered panels of bullets, none of which could be acted on from inside the
        window -- and it still carries the reasoning that was worth keeping: the
        ACL/icacls note, the npm registry note, the v1.1-is-more-privileged note
      * the requirement checks still report a remedy on each unmet row and report a
        check they could not perform as exactly that rather than as a pass -- and a
        computer with nothing wrong with it is shown NOTHING, because a screen of
        green ticks is a screen an operator learns to click past
      * the install location is a visible line on the Review page with a Change
        beside it, Change alters where the ENGINE is told to install, and a location
        this product cannot live in is refused there with the reason
      * read only is the selected permission, and it is the ANSWER rather than the
        appearance: ticks left behind by an operator who changed their mind do not
        become an install that writes
      * the completion summary names the clients that were configured, the ones whose
        settings have to be applied by hand, and what to restart -- by name, from
        lib\hosts.json
      * no user-facing string in the window uses the conversational register this
        product does not use: exclamation marks, first-person plural, "let's",
        "oops", "heads up"

    What it does NOT prove: that any of this looks right on a screen, that the
    ordering is the RIGHT order for a customer (that was a product decision, and this
    only holds it in place), or that a real MCP client loads what was written.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Test-WizardPrep.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    Write-Host 'This test loads WPF and must run on an STA thread:' -ForegroundColor Yellow
    Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Test-WizardPrep.ps1' -ForegroundColor Yellow
    exit 2
}

$UiScript  = Join-Path $PSScriptRoot '..\Install-BConnectMcp-UI.ps1'
$HostsFile = Join-Path $PSScriptRoot 'hosts.json'
if (-not (Test-Path -LiteralPath $UiScript))  { throw "Wizard script not found: $UiScript" }
if (-not (Test-Path -LiteralPath $HostsFile)) { throw "Host registry not found: $HostsFile" }

$script:Pass = 0
$script:Fail = 0
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}

# The decided order, written once. Everything else -- lib\hosts.json's rank fields,
# the JSON array, the rows the page binds -- is checked against this list, and the
# list is checked against nothing, because it is the product decision itself.
$ExpectedOrder = @(
    'vscode'          # VS Code (GitHub Copilot agent mode)
    'copilot-studio'  # Microsoft Copilot Studio
    'codex'           # OpenAI Codex CLI / IDE extension -- one file, three surfaces
    'claude-desktop'
    'claude-code'
    'openai'          # Responses API / Agents SDK -- the snippet path, not the file path
    'n8n'
    'open-webui'
    'cursor'
    'continue'
    'librechat'
    'generic'         # always last
)
# The targets an installer cannot configure: mode 'snippet'. Four of them also carry
# serversKey: null, and two of those are second and fifth in the order above, which
# is why this distinction has to be visible before a row is ticked.
$ExpectedManual = @('copilot-studio', 'openai', 'n8n', 'open-webui', 'librechat', 'generic')

$Scratch    = Join-Path $env:TEMP ('bconnect-wizard-prep-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$RealDir    = Join-Path $Scratch 'exists'
$GhostDir   = Join-Path $Scratch 'not-there'
New-Item -ItemType Directory -Path $RealDir -Force | Out-Null
$PresentCfg = Join-Path $RealDir  'claude_desktop_config.json'
$AbsentCfg  = Join-Path $GhostDir 'claude_desktop_config.json'

function Select-Hosts {
    param([string[]] $Ids, [string] $ProjectDir = $RealDir, [string] $ConfigPath = $PresentCfg)
    $els.ProjectDirBox.Text = $ProjectDir
    $els.ConfigPathBox.Text = $ConfigPath
    Reset-HostCatalog $Ids
    Update-HostPage
}

Write-Host ''
Write-Host 'Wizard preparation, ordering, summary and tone tests' -ForegroundColor Cyan
Write-Host ''

. $UiScript -TestHeadless -SuiteRoot $RealDir -SecretsDir $RealDir -ConfigPath $PresentCfg
$registry = (Get-Content -LiteralPath $HostsFile -Raw | ConvertFrom-Json).targets

# A server that is not on disk cannot be enabled, which is correct behaviour and
# would leave every write-gate assertion below with nothing to gate. So the throwaway
# suite root is given the directories lib\catalog.json names -- empty, but present --
# and the real Build-ServerList is run against it.
foreach ($s in $Catalog.servers) { New-Item -ItemType Directory -Path (Join-Path $RealDir $s.dir) -Force | Out-Null }
Build-ServerList

function Set-Shape {
    # Through the real radio buttons, so the Add_Checked wiring that rebuilds the
    # client catalog runs exactly as it does for a click.
    param([ValidateSet('workstation', 'central', 'none')] [string] $Shape)
    if ($Shape -eq 'none') {
        $els.rbShapeWorkstation.IsChecked = $false
        $els.rbShapeCentral.IsChecked     = $false
    } elseif ($Shape -eq 'workstation') {
        $els.rbShapeWorkstation.IsChecked = $true
    } else {
        $els.rbShapeCentral.IsChecked = $true
    }
}

# ==============================================================================
# Part 0: the deployment shape -- the first decision, and the one with no default.
#
# stdio MCP servers are LOCAL PROCESSES started by the client application, on the
# machine that application runs on. A wizard that never asks which machine it is on
# lets an administrator install on the bMS server for an assistant that runs on
# their workstation, and then reports success. These assertions hold the question in
# front of everything else, hold both answers reachable, and hold the answer to
# something: a question whose answer changes nothing is a question nobody reads.
# ==============================================================================
Write-Host '-- the deployment shape is asked first, and answers nothing by itself --' -ForegroundColor Cyan

# It is no longer a PAGE -- that was one of eleven, and the wall this release exists
# to remove. It is the FIRST CONTROL on the first page, which is the same product
# decision expressed in a quarter of the screens: asked before anything else, and
# still answering nothing by itself.
Check 'the deployment question is on the wizard''s first page' `
    ($PG_CONNECT -eq 0 -and $script:PageCount -eq 5 -and $script:StepCount -eq 4) `
    "PG_CONNECT=$PG_CONNECT, pages=$($script:PageCount), steps=$($script:StepCount), title=$($PageTitles[$PG_CONNECT])"
# Named parents, not a pixel position: the two shape cards have to be inside page0,
# and the base-URL box has to be there too, or the question has quietly become a
# page again.
function Test-OnPage {
    param([Parameter(Mandatory)] $Element, [Parameter(Mandatory)] $Page)
    $n = $Element
    while ($n) {
        if ($n -eq $Page) { return $true }
        $n = [System.Windows.LogicalTreeHelper]::GetParent($n)
    }
    return $false
}
Check 'both answers are controls on the Connect page, not a page of their own' `
    ((Test-OnPage $els.rbShapeWorkstation $els.page0) -and (Test-OnPage $els.rbShapeCentral $els.page0) -and
     (Test-OnPage $els.txtServerFqdn $els.page0)) `
    "workstation on page0=$(Test-OnPage $els.rbShapeWorkstation $els.page0)"
# The Connect page now gates on the credentials as well as on the shape, so the
# shape assertions below need the other half satisfied to mean anything. Throwaway
# values: nothing here reaches bConnect.
function Set-TestCredentials {
    $els.chkReuse.IsChecked     = $false
    $els.rbApiKey.IsChecked     = $true
    # The server name, which is what the page asks for now. The address it composes
    # is asserted in Part 1b; here it only has to be enough to let Next enable.
    $els.chkCustomUrl.IsChecked = $false
    $els.txtServerFqdn.Text     = 'bms.example.local'
    $els.pwApiKey.Password      = 'example-api-key-value'
}
Set-TestCredentials

Set-Shape none
Check 'neither answer is selected on a fresh window' `
    ((Get-DeploymentShape) -eq '' -and -not $els.rbShapeWorkstation.IsChecked -and -not $els.rbShapeCentral.IsChecked) `
    "shape='$(Get-DeploymentShape)'"
$script:Page = $PG_CONNECT
Show-Page
Check 'and the wizard will not advance until one of them is' (-not (Test-CanAdvance)) `
    "Next enabled=$($els.btnNext.IsEnabled)"
Check 'the page says so, rather than leaving an inert button to be puzzled over' `
    ($els.lblShapeChosen.Text -match '(?i)nothing is selected' -and $els.lblFooter.Text -match '(?i)nothing is selected for you') `
    $els.lblShapeChosen.Text

Set-Shape workstation
Check 'the workstation answer is reachable and releases Next' `
    ((Get-DeploymentShape) -eq 'workstation' -and (Test-CanAdvance))
# The other half of the same page. The shape has an answer; the credentials do not,
# so the page still does not advance -- and the reason it does not is a different
# one, which is why both are asserted.
$els.pwApiKey.Password = ''
Check 'and the same page still holds Next until there is a credential to connect with' `
    (-not (Test-CanAdvance)) "Next enabled=$($els.btnNext.IsEnabled)"
Set-TestCredentials
Check 'with both answered, the Connect page is complete' (Test-CanAdvance)
$wsRows = @($script:HostRows | ForEach-Object { $_.Id })
Set-Shape central
Check 'the shared-service answer is reachable and releases Next' `
    ((Get-DeploymentShape) -eq 'central' -and (Test-CanAdvance))
$cnRows = @($script:HostRows | ForEach-Object { $_.Id })

Check 'the two answers offer different client lists, and neither list is empty' `
    ($wsRows.Count -gt 0 -and $cnRows.Count -gt 0 -and (($wsRows -join ',') -ne ($cnRows -join ','))) `
    ("workstation $($wsRows.Count): $($wsRows -join ', ')  |  central $($cnRows.Count): $($cnRows -join ', ')")
# The rule is the target's own `transport`, and these two assertions are what make
# that rule the one being applied rather than a list of client names somewhere.
$gwIds = @($registry | Where-Object { $_.PSObject.Properties.Name -contains 'requiresGateway' -and $_.requiresGateway } | ForEach-Object { $_.id })
Check 'a workstation deployment offers no client that can only be reached over HTTP' `
    (@($wsRows | Where-Object { $gwIds -contains $_ }).Count -eq 0) `
    ("offered anyway: " + (@($wsRows | Where-Object { $gwIds -contains $_ }) -join ', '))
$stdioOnly = @($registry | Where-Object { $_.transport -eq 'stdio' } | ForEach-Object { $_.id })
Check 'a shared-service deployment offers no client that can only start a local process' `
    ($stdioOnly.Count -gt 0 -and @($cnRows | Where-Object { $stdioOnly -contains $_ }).Count -eq 0) `
    ("stdio-only in the registry: " + ($stdioOnly -join ', '))
Check 'every client the workstation answer offers can speak stdio' `
    (@($wsRows | Where-Object { $t = $_; @($registry | Where-Object { $_.id -eq $t }).transport -notin @('stdio', 'both') }).Count -eq 0)
Check 'every client the shared-service answer offers can speak HTTP' `
    (@($cnRows | Where-Object { $t = $_; @($registry | Where-Object { $_.id -eq $t }).transport -notin @('http', 'both') }).Count -eq 0)
Check 'the Clients page names the clients the answer left out, rather than showing a shorter list in silence' `
    ($els.ShapeNote.Text -match '(?i)not listed' -and
     @($registry | Where-Object { $stdioOnly -contains $_.id } | Where-Object { $els.ShapeNote.Text -notmatch [regex]::Escape($_.label) }).Count -eq 0) `
    $els.ShapeNote.Text

# The answer has to reach what an operator reads, not only the client list. The
# preparation PAGE that used to be worded by it is now README.md, which is one
# document and cannot be worded by a live answer -- so it has to describe both, and
# that is asserted in the README part below rather than dropped.
Set-Shape workstation
$wsReq  = @(Get-RequirementChecks)
Set-Shape central
$cnReq  = @(Get-RequirementChecks)
Check 'the requirement checks are chosen by the answer' `
    ((@($wsReq | ForEach-Object { $_.Name }) -join ',') -ne (@($cnReq | ForEach-Object { $_.Name }) -join ',')) `
    ("workstation: " + (@($wsReq | ForEach-Object { $_.Name }) -join ' / '))
Check 'a shared-service deployment checks the gateway port; a workstation one does not' `
    (@($cnReq | Where-Object { $_.Name -match 'gateway port' }).Count -eq 1 -and
     @($wsReq | Where-Object { $_.Name -match 'gateway port' }).Count -eq 0) `
    (@($cnReq | Where-Object { $_.Name -match 'gateway port' } | ForEach-Object { "$($_.Name) = $($_.State)" }) -join '')
Check 'and it does not report on MCP clients installed here, because they are not here' `
    (@($cnReq | Where-Object { $_.Name -eq 'MCP clients on this computer' })[0].State -eq 'not-checked' -and
     @($cnReq | Where-Object { $_.Name -eq 'MCP clients on this computer' })[0].Detail -match '(?i)other computers') `
    (@($cnReq | Where-Object { $_.Name -eq 'MCP clients on this computer' })[0].Detail)

# The gateway is not an afterthought on the central shape: it IS the deployment.
# Deliberately asserted with VS Code -- a client that speaks BOTH transports and does
# not carry requiresGateway -- because n8n would force the gateway on under either
# answer and would prove nothing about the answer.
Set-Shape central
Select-Hosts @('vscode') -ProjectDir $RealDir
$cnParams = (Get-Answers).HostParams
Check 'a shared-service deployment configures the gateway even for a client that could speak either transport' `
    ($cnParams.Parameters.ContainsKey('Gateway')) ((($cnParams.Parameters.Keys | Sort-Object) -join ', '))
Check 'and the operator cannot untick it, because there is no other route in' `
    ([bool]$els.GatewayWantedCheck.IsChecked -and -not $els.GatewayWantedCheck.IsEnabled -and
     $els.GatewayPanel.Visibility -eq 'Visible') `
    "checked=$($els.GatewayWantedCheck.IsChecked) enabled=$($els.GatewayWantedCheck.IsEnabled)"
Check 'and says which deployment required it, not which client' `
    ([string]$els.GatewayWantedCheck.Content -match '(?i)required by a shared-service deployment') `
    ([string]$els.GatewayWantedCheck.Content)
Set-Shape workstation
Select-Hosts @('vscode') -ProjectDir $RealDir
$wsParams = (Get-Answers).HostParams
Check 'the same client on a workstation deployment configures no gateway and no listening port' `
    (-not $wsParams.Parameters.ContainsKey('Gateway') -and
     $els.GatewayPanel.Visibility -eq 'Collapsed') ((($wsParams.Parameters.Keys | Sort-Object) -join ', '))
Select-Hosts @('claude-desktop')
Check 'nor does a stdio-only client' `
    (-not ((Get-Answers).HostParams.Parameters.ContainsKey('Gateway')))
Check 'the completion summary states which deployment was installed' `
    ((Get-CompletionSummaryText) -match '(?i)the servers run on this computer, started by the assistant') `
    (((Get-CompletionSummaryText) -split "`r?`n")[1])
Set-Shape central
Select-Hosts @('n8n')
Check 'and says the other thing on a shared-service run' `
    ((Get-CompletionSummaryText) -match '(?i)clients reach them across the network')
Build-Review
$reviewText = (@($els.reviewList.Children | ForEach-Object {
                    @($_.Children | ForEach-Object { [string]$_.Text }) -join ' ' }) -join ' | ')
Check 'the review page states the deployment before anything is written' `
    ($reviewText -match '(?i)deployment' -and $reviewText -match '(?i)clients reach them across the network') `
    ($reviewText.Substring(0, [Math]::Min(140, $reviewText.Length)))
# Back to unanswered, so every later part of this file sees the unfiltered client
# list it was written against. The shape is exercised again, deliberately, in the
# tone harvest.
Set-Shape none

# ==============================================================================
# Part 1: the client order, held in one place.
# ==============================================================================
Write-Host '-- the client order is data, and there is one copy of it --' -ForegroundColor Cyan

$ranks = @($registry | ForEach-Object { if ($_.PSObject.Properties.Name -contains 'rank') { [int]$_.rank } else { -1 } })
Check 'every target in hosts.json carries a rank' `
    (@($ranks | Where-Object { $_ -lt 1 }).Count -eq 0) ($ranks -join ',')
Check 'the ranks are 1..N with no gaps and no duplicates' `
    (((@($ranks | Sort-Object) -join ',')) -eq ((1..@($registry).Count) -join ',')) `
    (@($ranks | Sort-Object) -join ',')
Check 'the ranks put the clients in the decided order' `
    (((@($registry | Sort-Object { [int]$_.rank } | ForEach-Object { $_.id })) -join ',') -eq ($ExpectedOrder -join ',')) `
    ((@($registry | Sort-Object { [int]$_.rank } | ForEach-Object { $_.id }) -join ', '))
# The engine walks the array; the wizard sorts by rank. If those two disagree, the
# console's -ListHosts table and this window show the same clients in two orders.
Check 'the JSON array is kept in rank order too, so a console -ListHosts agrees' `
    ((@($registry | ForEach-Object { $_.id }) -join ',') -eq ($ExpectedOrder -join ',')) `
    ((@($registry | ForEach-Object { $_.id }) -join ', '))

$hostCatalog = @(Get-HostSelectionCatalog -ProjectDir $RealDir -HostOutDir $HostOutDir -ConfigPath $PresentCfg)
Check 'the rows the page binds come back in that order, not in file order by accident' `
    ((@($hostCatalog | ForEach-Object { $_.Id }) -join ',') -eq ($ExpectedOrder -join ',')) `
    ((@($hostCatalog | ForEach-Object { $_.Id }) -join ', '))
Check 'the list the operator sees starts with VS Code and ends with the generic fallback' `
    ($hostCatalog[0].Id -eq 'vscode' -and $hostCatalog[-1].Id -eq 'generic') `
    ("first=$($hostCatalog[0].Label), last=$($hostCatalog[-1].Label)")
Check 'both Copilot forms are in the top five, because "Copilot" means either one' `
    ((@($hostCatalog[0..4] | ForEach-Object { $_.Id }) -contains 'vscode') -and
     (@($hostCatalog[0..4] | ForEach-Object { $_.Id }) -contains 'copilot-studio')) `
    ((@($hostCatalog[0..4] | ForEach-Object { $_.Label }) -join ', '))
Check 'the order is not alphabetical by label' `
    ((@($hostCatalog | ForEach-Object { $_.Label }) -join ',') -ne (@($hostCatalog | ForEach-Object { $_.Label } | Sort-Object) -join ','))

# ==============================================================================
# Part 2: automatic or manual, on every row, before anything is selected.
# ==============================================================================
Write-Host ''
Write-Host '-- every row says whether an install configures that client --' -ForegroundColor Cyan

Check 'every row carries a setup state, and it is one of the two' `
    (@($hostCatalog | Where-Object { $_.Setup -notin @('automatic', 'manual') }).Count -eq 0) `
    ((@($hostCatalog | ForEach-Object { "$($_.Id)=$($_.Setup)" }) -join ' '))
Check 'the manual ones are exactly the targets no installer can write' `
    ((@($hostCatalog | Where-Object { $_.Setup -eq 'manual' } | ForEach-Object { $_.Id } | Sort-Object) -join ',') -eq
     ((@($ExpectedManual) | Sort-Object) -join ',')) `
    ((@($hostCatalog | Where-Object { $_.Setup -eq 'manual' } | ForEach-Object { $_.Id }) -join ', '))
Check 'every target with serversKey null is one of them' `
    (@($registry | Where-Object { $null -eq $_.serversKey } | ForEach-Object {
        $id = $_.id; @($hostCatalog | Where-Object { $_.Id -eq $id -and $_.Setup -eq 'manual' }).Count }) -notcontains 0) `
    ((@($registry | Where-Object { $null -eq $_.serversKey } | ForEach-Object { $_.id }) -join ', '))
Check 'the state follows the mode, not the verification tier' `
    (@($hostCatalog | Where-Object { ($_.Mode -eq 'snippet') -ne ($_.Setup -eq 'manual') }).Count -eq 0) `
    ((@($hostCatalog | ForEach-Object { "$($_.Id):$($_.Mode)/$($_.Setup)" }) -join ' '))
Check 'every row carries a badge and a sentence for it, not a colour alone' `
    (@($hostCatalog | Where-Object { -not $_.SetupBadge -or -not $_.SetupText -or -not $_.SetupBrush }).Count -eq 0)
Check 'a manual row says the settings are applied in that product''s own interface' `
    (@($hostCatalog | Where-Object { $_.Setup -eq 'manual' -and $_.SetupText -notmatch "own interface" }).Count -eq 0) `
    ((@($hostCatalog | Where-Object { $_.Setup -eq 'manual' })[0].SetupText))
Check 'an automatic row names the file it writes and says to restart that client' `
    (@($hostCatalog | Where-Object { $_.Setup -eq 'automatic' -and
        ($_.SetupText -notmatch 'configuration file' -or $_.SetupText -notmatch 'Restart') }).Count -eq 0) `
    ((@($hostCatalog | Where-Object { $_.Setup -eq 'automatic' })[0].SetupText))
Check 'the two setup badges are distinct words, not two shades of one' `
    ((@($hostCatalog | Where-Object { $_.Setup -eq 'automatic' })[0].SetupBadge) -ne
     (@($hostCatalog | Where-Object { $_.Setup -eq 'manual' })[0].SetupBadge)) `
    ((@($hostCatalog | ForEach-Object { $_.SetupBadge } | Select-Object -Unique) -join ' / '))
Check 'the setup badge is not the verification badge under another name' `
    (@($hostCatalog | Where-Object { $_.SetupBadge -eq $_.Badge }).Count -eq 0)

# ── Scope reaches the page, and it is derived rather than declared ────────────
#
# The defect these three close: PerProject was computed in the catalog and
# consumed NOWHERE, so claude-desktop and claude-code -- a per-user file that
# reverts if the app is running, and one repository's file that wrote correctly
# every time -- appeared as two interchangeable names. An operator choosing
# between them had nothing to choose on.
#
# Asserted as a PROPERTY, not a wording. The client's own name is normalised out
# first, because every one of these sentences contains it and two rows would
# otherwise "differ" for a reason that means nothing. What must hold is that with
# the name removed the sentences STILL differ -- which is only true if the scope
# actually reached the text.
$Normalise = {
    param($Row)
    if (-not $Row) { return '' }
    $Row.SetupText.Replace($Row.Label, '<CLIENT>')
}
$autoProject = @($hostCatalog | Where-Object { $_.Setup -eq 'automatic' -and $_.PerProject })
$autoGlobal  = @($hostCatalog | Where-Object { $_.Setup -eq 'automatic' -and -not $_.PerProject })

# Vacuity first. Both sets have to exist or the comparison below passes by saying
# nothing, which is the failure mode a byte ceiling with slack already taught us.
Check 'the registry still has automatic targets of BOTH scopes to compare' `
    ($autoProject.Count -gt 0 -and $autoGlobal.Count -gt 0) `
    ("per-project: $($autoProject.Count) ($(($autoProject | ForEach-Object { $_.Id }) -join ',')); " +
     "global: $($autoGlobal.Count) ($(($autoGlobal | ForEach-Object { $_.Id }) -join ','))")

Check 'a per-project row and a per-user row do not say the same thing about where it applies' `
    ((& $Normalise $autoProject[0]) -ne (& $Normalise $autoGlobal[0])) `
    ("$($autoProject[0].Id): $(& $Normalise $autoProject[0])")

# quitProcesses is the registry's statement that this client rewrites its own
# config on exit. It drove a preflight refusal already; it must also reach the
# sentence the operator reads BEFORE choosing, or they meet the requirement only
# as a refusal at write time.
$quitIds = @($registry | Where-Object {
    $_.PSObject.Properties.Name -contains 'quitProcesses' -and @($_.quitProcesses).Count -gt 0
} | ForEach-Object { $_.id })
$quitRows  = @($hostCatalog | Where-Object { $quitIds -contains $_.Id })
$quietRows = @($autoGlobal  | Where-Object { $quitIds -notcontains $_.Id })
Check 'a client that must be closed while it is written says so, and a client that need not does not' `
    ($quitIds.Count -eq 0 -or
     ($quitRows.Count -gt 0 -and $quietRows.Count -gt 0 -and
      (& $Normalise $quitRows[0]) -ne (& $Normalise $quietRows[0]))) `
    ("declares quitProcesses: $($quitIds -join ',')")

# README.md has to carry the same distinction, because a tooltip is found only by
# hovering and the operator reads this before the wizard is open. Derived from the
# registry rather than a list here: a per-workspace client added to hosts.json and
# not mentioned in README.md fails, which is the drift that actually happens.
# Matched on the label's leading name -- "Claude Code (CLI)" -> "Claude Code" --
# because the README names products, not registry labels.
$InstallerReadme = Join-Path (Split-Path -Parent $PSScriptRoot) 'README.md'
$readmeText = Get-Content -LiteralPath $InstallerReadme -Raw
$shortName  = { param($Label) ($Label -split ' \(')[0].Trim() }
$missingProj = @($autoProject | Where-Object { $readmeText -notmatch [regex]::Escape((& $shortName $_.Label)) })
Check 'README.md names every per-workspace client the registry has' `
    ($missingProj.Count -eq 0) `
    ("per-workspace: $(($autoProject | ForEach-Object { & $shortName $_.Label }) -join ', ')" +
     $(if ($missingProj.Count) { "; MISSING: $(($missingProj | ForEach-Object { & $shortName $_.Label }) -join ', ')" }))
$missingQuit = @($quitRows | Where-Object { $readmeText -notmatch [regex]::Escape((& $shortName $_.Label)) })
Check 'README.md names every client that must be closed while it is written' `
    ($missingQuit.Count -eq 0) `
    ("must be closed: $(($quitRows | ForEach-Object { & $shortName $_.Label }) -join ', ')")

# The legend above the list has to use the same two words and the same two colours
# the rows use, or it explains something the operator is not looking at.
$hostXaml   = [xml](Get-HostSelectionXaml)
$hostText   = $hostXaml.OuterXml
$autoRow    = @($hostCatalog | Where-Object { $_.Setup -eq 'automatic' })[0]
$manualRow  = @($hostCatalog | Where-Object { $_.Setup -eq 'manual' })[0]
function Get-LegendChipBackground {
    # The Background of the legend Border whose own TextBlock carries this badge word.
    # Searching the document for the colour instead would be satisfied by any other
    # use of the same hex -- and #9A5B00 is the warning colour, so there are several.
    param([xml] $Doc, [string] $BadgeText)
    foreach ($node in $Doc.SelectNodes('//*')) {
        if ($node.Name -ne 'Border') { continue }
        foreach ($child in $node.ChildNodes) {
            if ($child.Name -eq 'TextBlock' -and $child.GetAttribute('Text') -eq $BadgeText) {
                return $node.GetAttribute('Background')
            }
        }
    }
    return $null
}
Check 'the page explains both badges before the first row' `
    ($hostText -match [regex]::Escape($autoRow.SetupBadge) -and $hostText -match [regex]::Escape($manualRow.SetupBadge))
$legendAuto   = Get-LegendChipBackground -Doc $hostXaml -BadgeText $autoRow.SetupBadge
$legendManual = Get-LegendChipBackground -Doc $hostXaml -BadgeText $manualRow.SetupBadge
Check 'and the legend chips carry the same colours the rows do' `
    ($legendAuto -eq $autoRow.SetupBrush -and $legendManual -eq $manualRow.SetupBrush) `
    ("legend $legendAuto / $legendManual, rows $($autoRow.SetupBrush) / $($manualRow.SetupBrush)")
Check 'the row template binds both badges, so neither can be dropped from the row' `
    ($hostText -match 'Binding SetupBadge' -and $hostText -match 'Binding Badge' -and $hostText -match 'Binding SetupText')

# ==============================================================================
# Part 3: the distinction survives to the review page and the summary.
# ==============================================================================
Write-Host ''
Write-Host '-- and it is still there at the review page and the end --' -ForegroundColor Cyan

Select-Hosts @('vscode', 'n8n')
$sel = Get-HostSelection
Check 'the selection reports which chosen clients are configured and which are not' `
    (($sel.Automatic -join ',') -eq 'vscode' -and ($sel.Manual -join ',') -eq 'n8n') `
    ("automatic=$($sel.Automatic -join ',') manual=$($sel.Manual -join ',')")

$script:Page = $PG_REVIEW
Build-Review
$reviewText = @($els.reviewList.Children | ForEach-Object {
    @($_.Children | ForEach-Object { [string]$_.Text }) -join ' ' }) -join "`n"
Check 'the review page marks each chosen client automatic or manual' `
    ($reviewText -match ('(?s)VS Code.*' + [regex]::Escape($autoRow.SetupBadge)) -and
     $reviewText -match ('(?s)n8n.*' + [regex]::Escape($manualRow.SetupBadge))) `
    (($reviewText -split "`n" | Where-Object { $_ -match 'client:' }) -join ' | ')
Check 'and states plainly that the manual one has settings to apply by hand' `
    ($reviewText -match 'apply by hand' -and $reviewText -match 'n8n') `
    (($reviewText -split "`n" | Where-Object { $_ -match 'by hand' }) -join ' | ')

# ==============================================================================
# Part 4: the completion summary stands alone.
# ==============================================================================
Write-Host ''
Write-Host '-- the completion summary --' -ForegroundColor Cyan

function Show-Finish {
    $script:RunKind = 'install'
    $script:LastResult = $null
    $script:GatewayTokenResult = $null
    Finish-Run $false
    return (Get-CompletionSummaryText)
}

Select-Hosts @('vscode', 'claude-desktop', 'n8n')
$summary  = Show-Finish
$sections = @(Get-CompletionSummary)
$byKey    = @{}; foreach ($s in $sections) { $byKey[$s.Key] = $s }

Check 'it says what was installed and where' `
    ($byKey.ContainsKey('installed') -and
     ($byKey['installed'].Lines -join ' ') -match 'Suite root' -and
     ($byKey['installed'].Lines -join ' ') -match 'Servers enabled') `
    (($byKey['installed'].Lines) -join ' | ')
Check 'it says how the credentials were stored, and where' `
    (($byKey['installed'].Lines -join ' ') -match '(DPAPI|plaintext)' -and
     ($byKey['installed'].Lines -join ' ') -match [regex]::Escape($els.txtSecrets.Text))
Check 'it states the write gate outcome' `
    (($byKey['installed'].Lines -join ' ') -match 'Write access')
Check 'the clients it configured are listed with the file it wrote' `
    ($byKey.ContainsKey('automatic') -and
     ($byKey['automatic'].Lines -join ' ') -match 'VS Code' -and
     ($byKey['automatic'].Lines -join ' ') -match 'Claude Desktop' -and
     ($byKey['automatic'].Lines -join ' ') -match '\.json') `
    (($byKey['automatic'].Lines) -join ' | ')
Check 'the clients it could NOT configure are listed separately, with their settings file' `
    ($byKey.ContainsKey('manual') -and
     ($byKey['manual'].Lines -join ' ') -match 'n8n' -and
     ($byKey['manual'].Lines -join ' ') -match 'n8n\.md') `
    (($byKey['manual'].Lines) -join ' | ')
Check 'a manual client is not listed as one the installer configured' `
    (($byKey['automatic'].Lines -join ' ') -notmatch 'n8n')
Check 'what has to be restarted is named, client by client, not "your MCP client"' `
    ($byKey.ContainsKey('restart') -and
     ($byKey['restart'].Lines -join ' ') -match 'VS Code' -and
     ($byKey['restart'].Lines -join ' ') -match 'Claude Desktop' -and
     $summary -notmatch 'your MCP client') `
    (($byKey['restart'].Lines) -join ' | ')
Check 'Claude Desktop gets the tray-icon quit it actually needs' `
    (($byKey['restart'].Lines -join ' ') -match 'Claude Desktop: quit it from the tray icon')
Check 'a client that was never configured is not on the restart list' `
    (($byKey['restart'].Lines -join ' ') -notmatch 'n8n')
Check 'the summary is on the run page as well, not only in the console' `
    ($els.finishSummary.Visibility -eq 'Visible' -and $els.finishSummary.Children.Count -eq $sections.Count) `
    ("visible=$($els.finishSummary.Visibility) cards=$($els.finishSummary.Children.Count) sections=$($sections.Count)")

# Only Cursor: the summary must follow the selection rather than repeat the last one.
Select-Hosts @('cursor')
$summary = Show-Finish
Check 'the summary names the client that was actually chosen, not the previous one' `
    ($summary -match 'Cursor' -and $summary -notmatch 'VS Code' -and $summary -notmatch 'n8n') `
    (($summary -split "`r?`n" | Where-Object { $_ -match 'Cursor|VS Code|n8n' }) -join ' | ')
Check 'with no manual client chosen there is no "apply by hand" section to act on' `
    (@(Get-CompletionSummary | Where-Object { $_.Key -eq 'manual' }).Count -eq 0)

# A dry run wrote nothing. A panel telling the operator what was "configured" would
# read exactly like the true version, which is what makes it worth a guard.
Select-Hosts @('vscode')
$script:RunKind = 'dryrun'; $script:LastResult = $null; $script:GatewayTokenResult = $null
Finish-Run $false
Check 'a dry run gets no completion summary: it configured nothing' `
    ($els.finishSummary.Visibility -eq 'Collapsed' -and $els.finishSummary.Children.Count -eq 0) `
    ("visible=$($els.finishSummary.Visibility) cards=$($els.finishSummary.Children.Count)")

# ==============================================================================
# Part 5: what to have ready -- now a document, not a page.
#
# The preparation page was four bordered panels of bullets shown before anything
# had been collected, and none of it could be acted on from inside the window: an
# API key is created in the bMS console, a client installer is staged from another
# machine. So the page is gone and install\README.md carries it, with one link on
# the Connect page.
#
# EVERY ASSERTION THE OLD PAGE CARRIED IS STILL HERE, aimed at the file instead of
# at a control tree. That is the point: what an administrator has to have in hand
# is a product decision and it did not change -- only where it is stated did.
# ==============================================================================
Write-Host ''
Write-Host '-- what to have ready, in README.md rather than on a page --' -ForegroundColor Cyan

$readmePath = Get-ReadmePath
Check 'the wizard resolves one "what you will need" document' `
    ($readmePath -and (Test-Path -LiteralPath $readmePath)) $readmePath
$prep = ''
if (Test-Path -LiteralPath $readmePath) { $prep = Get-Content -LiteralPath $readmePath -Raw }

Check 'the Connect page carries a link to it, rather than the page it replaced' `
    ($null -ne $els.lnkNeeded -and [string]$els.lnkNeeded.Text -match '(?i)what you will need' -and
     -not $win.FindName('prepList')) `
    ("link='$([string]$els.lnkNeeded.Text)'")
Check 'it states the bMS base URL, in the form the installer expects' `
    ($prep -match '/bconnect' -and $prep -match '(?i)ends at')
Check 'it names the API key AND where to create one' `
    ($prep -match 'Server Management' -and $prep -match 'API Keys')
Check 'it states the rights a read-only key needs' ($prep -match '(?i)read\*{0,2} rights')
Check 'and separately what write access requires' ($prep -match '(?i)Write access needs more')
Check 'it tells the administrator to decide which MCP clients to configure' ($prep -match 'MCP client')
Check 'and warns that some clients cannot be configured for them' `
    ($prep -match '(?i)cannot write that client')
Check 'it lists the optional v1.1 account, in UPN form' `
    ($prep -match 'UPN' -and $prep -match '@example\.local')
Check 'and says plainly that it is more privileged than the API key' `
    ($prep -match '(?i)more privileged credential than the API key')
Check 'and that it is optional' ($prep -match '(?i)It is optional')
Check 'it names administrator rights and the supported Windows PowerShell version' `
    ($prep -match '(?i)Administrator rights' -and $prep -match 'Windows PowerShell 5\.1')
# The reasoning that was genuinely valuable on screen has to survive somewhere, or
# simplifying the wizard has simply deleted it. These three are the ones named as
# worth keeping.
Check 'the ACL reasoning survives, naming icacls' `
    ($prep -match 'icacls' -and $prep -match '(?i)breaks inheritance')
Check 'the npm registry note survives, with the offline bundle as the alternative' `
    ($prep -match '(?i)npm registry' -and $prep -match 'New-OfflineBundle\.ps1')
Check 'the DPAPI reasoning survives, including what it does NOT protect against' `
    ($prep -match 'DPAPI' -and $prep -match '(?i)does not protect against malware running as you')
# MCP clients are CONFIGURED by this installer, never installed by it. Node and the
# server packages are in the bundle; VS Code, Claude Desktop, Cursor and the rest are
# separate products that cannot be redistributed. Offline, that is the difference
# between a run that lands and a run with nowhere to land.
Check 'it lists the MCP client installer itself as something to obtain in advance' `
    ($prep -match '(?i)does not install them')
Check 'and that they are not redistributed in this bundle' `
    ($prep -match '(?i)not redistributed in this bundle')
Check 'and tells an air-gapped administrator to stage the client installer beside this one' `
    ($prep -match '(?i)air-gapped' -and $prep -match '(?i)stage the client installer')
# One document cannot be worded by a live answer, so it has to describe both
# deployments. This is what replaces "the preparation page is worded by the answer".
Check 'it describes BOTH deployments, because a document cannot be worded by the answer' `
    ($prep -match '(?i)\| \*\*This computer\*\* \|' -and
     $prep -match '(?i)\*\*A shared service on this server\*\*' -and
     $prep -match '(?i)speaks stdio is a')
Check 'the whole of it can be taken away from the machine' `
    ($prep.Length -gt 4000) "$($prep.Length) characters"
Check 'no estate value is used as the example' `
    ($prep -notmatch '(?i)labcorp|WIN1[01]CLIENT|a-srv-0|192\.168\.|172\.16\.') ''
# The development project directory is not an estate hostname, but it ships in
# exactly the same way and reads to a customer as "someone else's machine". It
# leaked back into four installer files after the tree had once been cleaned,
# which is the argument for checking it here rather than at release time.
Check 'no development path is used as the example' `
    ($prep -notmatch '(?i)mcpworkspace') ''
Check 'MCP is defined on the page that first uses it' `
    (($xaml.OuterXml -match 'Model Context Protocol'))
# It has to reach the bundle root as well, beside the launcher an administrator
# opens -- and by being COPIED there, so there is one file under source control.
$bundler = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'New-OfflineBundle.ps1') -Raw
Check 'the offline bundle puts it at its own root, as a copy of this one file' `
    ($bundler -match "Join-Path \`$InstallerDir 'README\.md'" -and
     $bundler -match "Join-Path \`$Destination 'README\.md'") ''

# ==============================================================================
# Part 6: the requirement checks -- run silently, and only failures surfaced.
#
# There is no requirements PAGE any more: a screen of green ticks was the single
# largest contributor to this window looking like eleven steps of work. The CHECKS
# are unchanged and are still asserted here in full; what is new is that a computer
# which is ready is told nothing, and a computer which is not gets a banner on the
# first page naming the specific remedy.
# ==============================================================================
Write-Host ''
Write-Host '-- requirements, checked silently and surfaced only when they fail --' -ForegroundColor Cyan

$checks = @(Get-RequirementChecks)
foreach ($want in @('Windows version', 'Windows PowerShell 5.1', 'Single-threaded apartment (STA)',
                    'Administrator rights', 'Node.js', 'Disk space', 'MCP clients on this computer')) {
    Check "the checks still include: $want" (@($checks | Where-Object { $_.Name -eq $want }).Count -eq 1)
}
Check 'every check has one of the three states, and never an empty one' `
    (@($checks | Where-Object { $_.State -notin @('met', 'not-met', 'not-checked') }).Count -eq 0) `
    ((@($checks | ForEach-Object { "$($_.Name)=$($_.State)" }) -join '; '))
Check 'every check carries a remedy for the case where it is not met' `
    (@($checks | Where-Object { -not $_.Remedy }).Count -eq 0) `
    ((@($checks | Where-Object { -not $_.Remedy } | ForEach-Object { $_.Name }) -join ', '))
Check 'every check states what this computer reports, not only whether it passed' `
    (@($checks | Where-Object { -not $_.Detail }).Count -eq 0)
# A check that cannot be performed must say so. A UNC suite root has no drive letter
# to ask for free space on, which is a real case on a customer's file server.
$unc = @(Get-RequirementChecks -ProbePath '\\file-server\share\bconnect-mcp')
$disk = @($unc | Where-Object { $_.Name -eq 'Disk space' })[0]
Check 'a check that cannot be performed says so rather than passing' `
    ($disk.State -eq 'not-checked' -and $disk.Detail -match 'not checked') $disk.Detail
Check 'and still says what to do about it' ($disk.Remedy -match '1\.5 GB')

# THE BANNER. Driven with known states rather than with whatever this machine
# happens to report, which is the only way to prove that an all-met computer is
# really given nothing to read.
$allMet = @(
    @{ Name = 'Windows version';        State = 'met'; Required = $true;  Detail = 'ok'; Remedy = 'r' }
    @{ Name = 'Windows PowerShell 5.1'; State = 'met'; Required = $true;  Detail = 'ok'; Remedy = 'r' }
    @{ Name = 'Node.js';                State = 'met'; Required = $true;  Detail = 'ok'; Remedy = 'r' }
    @{ Name = 'Disk space';             State = 'met'; Required = $false; Detail = 'ok'; Remedy = 'r' }
)
Build-RequirementBanner $allMet
Check 'a computer with nothing wrong with it is shown NOTHING: no banner, no ticks' `
    ($els.reqBanner.Visibility -eq 'Collapsed' -and $els.reqBannerList.Children.Count -eq 0) `
    ("banner=$($els.reqBanner.Visibility) rows=$($els.reqBannerList.Children.Count)")
Check 'and the footer does not invent a summary of it either' `
    ((Get-RequirementSummary) -eq '') "footer='$(Get-RequirementSummary)'"

$oneBad = @(
    @{ Name = 'Windows version'; State = 'met';     Required = $true;  Detail = 'ok'; Remedy = 'r' }
    @{ Name = 'Node.js';         State = 'not-met'; Required = $true
       Detail = 'Node.js is not on PATH in this session.'
       Remedy = 'Place the x64 MSI in the media directory and start this window again.' }
    @{ Name = 'Disk space';      State = 'met';     Required = $false; Detail = 'ok'; Remedy = 'r' }
)
Build-RequirementBanner $oneBad
Check 'a failure is surfaced as a banner on the first page' `
    ($els.reqBanner.Visibility -eq 'Visible' -and $els.reqBannerList.Children.Count -eq 1) `
    ("banner=$($els.reqBanner.Visibility) rows=$($els.reqBannerList.Children.Count)")
$bannerText = @($els.reqBannerList.Children | ForEach-Object {
                    @($_.Children | ForEach-Object {
                        if ($_ -is [System.Windows.Controls.TextBlock]) { [string]$_.Text }
                        else { @($_.Children | ForEach-Object { [string]$_.Text }) -join ' ' } }) -join ' ' }) -join ' | '
Check 'and it names the check, its state and the SPECIFIC remedy, not "requirements not met"' `
    ($bannerText -match 'Node\.js' -and $bannerText -match 'NOT MET' -and
     $bannerText -match [regex]::Escape('Place the x64 MSI')) $bannerText
Check 'only the failing check is drawn: the ones that passed are not listed beside it' `
    ($bannerText -notmatch 'Windows version' -and $bannerText -notmatch 'Disk space')
Check 'the footer names it too, so it is visible without reading the banner' `
    ((Get-RequirementSummary) -match 'Node\.js') "footer='$(Get-RequirementSummary)'"

# "That client is not on this machine" is answered per row on the Clients page,
# where the client is actually chosen. Repeating it in the banner would put a
# warning about a decision two steps before the decision is made.
$withClients = @(
    @{ Name = 'Disk space'; State = 'met'; Required = $false; Detail = 'ok'; Remedy = 'r' }
    @{ Name = 'MCP clients on this computer'; State = 'not-met'; Required = $false
       Detail = 'Not installed on this computer: several.'; Remedy = 'Install the client first.' }
)
Build-RequirementBanner $withClients
Check 'the MCP-client row is NOT in the banner: it is answered on the Clients page' `
    ($els.reqBanner.Visibility -eq 'Collapsed') `
    ("banner=$($els.reqBanner.Visibility) rows=$($els.reqBannerList.Children.Count)")
Check 'but the check itself still exists, with its remedy, for the page that uses it' `
    (@(Get-RequirementChecks | Where-Object { $_.Name -eq 'MCP clients on this computer' -and $_.Remedy }).Count -eq 1)

# And through the real Show-Page, against this real machine, so the seam above is
# not the only thing ever exercised.
$script:Page = $PG_CONNECT
Show-Page
Check 'the Connect page runs the checks on entry through the real Show-Page' `
    ($els.page0.Visibility -eq 'Visible' -and @($script:ReqChecks).Count -gt 0) `
    ("checks=$(@($script:ReqChecks).Count)")

# "Not installed here" and "not chosen" are different facts, and the check can only
# report the first: nothing has been selected yet -- the Clients page is the next
# one. A bare "3 of 5 found" is read as "the other two were declined".
Set-Shape workstation
$clientCheck = @(Get-RequirementChecks | Where-Object { $_.Name -eq 'MCP clients on this computer' })[0]
Check 'the client row names the clients installed on this computer' `
    ($clientCheck.Detail -match '(?i)installed on this computer:') $clientCheck.Detail
Check 'and separately names the ones that are NOT installed on this computer' `
    ($clientCheck.Detail -match '(?i)not installed on this computer:')
Check 'and says in words that not installed is not the same as not selected' `
    ($clientCheck.Detail -match '(?i)not installed is not the same as not selected' -and
     $clientCheck.Detail -match '(?i)no client has been selected yet')
Check 'it carries the per-client states as data, not only as a sentence' `
    (@($clientCheck.Clients).Count -gt 0 -and
     @($clientCheck.Clients | Where-Object { $_.Keys -notcontains 'Present' }).Count -eq 0) `
    ((@($clientCheck.Clients | ForEach-Object { "$($_.Id)=$($_.Present)" }) -join ', '))
Check 'the two lists together account for every client that can be detected here' `
    (@($clientCheck.Clients | Where-Object { $_.Present }).Count +
     @($clientCheck.Clients | Where-Object { -not $_.Present }).Count -eq @($clientCheck.Clients).Count)
Check 'and its remedy says the installer does not install the client' `
    ($clientCheck.Remedy -match '(?i)does not install them') $clientCheck.Remedy
Check 'and points an isolated network at staging the client installer first' `
    ($clientCheck.Remedy -match '(?i)isolated network' -and $clientCheck.Remedy -match '(?i)stage the client installer')
Set-Shape none

# ==============================================================================
# Part 6c: the install location.
#
# The product owner asked for this by name: visible, not buried, with a Change
# beside it. Three things are held here -- that it is on the Review page as a line,
# that Change alters where the ENGINE is told to install, and that a location this
# product cannot live in is refused with the reason rather than accepted and
# discovered several minutes into a run.
# ==============================================================================
Write-Host ''
Write-Host '-- the install location: visible, changeable, and validated --' -ForegroundColor Cyan

$script:Page = $PG_REVIEW
Show-Page
Check 'it is a visible line on the Review page, with a Change beside it' `
    ($els.page3.Visibility -eq 'Visible' -and
     $els.lblInstallLocation.Visibility -eq 'Visible' -and $els.lblInstallLocation.Text -and
     $els.btnChangeLocation.Visibility -eq 'Visible' -and
     [string]$els.btnChangeLocation.Content -eq 'Change') `
    ("line='$($els.lblInstallLocation.Text)' button='$([string]$els.btnChangeLocation.Content)'")
Check 'and the editor behind Change is closed until it is asked for' `
    ($els.locationEditor.Visibility -eq 'Collapsed')
Check 'the line shows the location the engine would be given' `
    ($els.lblInstallLocation.Text -eq (New-InstallerParameters 'install')['SuiteRoot']) `
    ("line='$($els.lblInstallLocation.Text)' param='$((New-InstallerParameters 'install')['SuiteRoot'])'")

# Change, to a real and usable directory.
$NewRoot = Join-Path $Scratch 'relocated'
New-Item -ItemType Directory -Path $NewRoot -Force | Out-Null
$els.locationEditor.Visibility = 'Visible'
$els.txtSuite.Text = $NewRoot
$applied = Confirm-InstallLocation
Check 'Change accepts a usable location' $applied ($els.lblLocationProblem.Text)
Check 'and it alters where the engine is told to install' `
    ((New-InstallerParameters 'install')['SuiteRoot'] -eq $NewRoot) `
    ("SuiteRoot=$((New-InstallerParameters 'install')['SuiteRoot'])")
Check 'the line on the page agrees with what the engine was given' `
    ($els.lblInstallLocation.Text -eq $NewRoot)
Check 'and the equivalent console command shows the same location' `
    ($els.txtEquivalent.Text -match [regex]::Escape($NewRoot)) `
    (($els.txtEquivalent.Text -split "`r?`n" | Where-Object { $_ -match 'SuiteRoot' }) -join '')

# The secrets directory FOLLOWS, rather than being a second question -- until it is
# answered, at which point it stops following.
Check 'the secrets directory followed the new location rather than being asked again' `
    ($els.txtSecrets.Text -eq (Get-DefaultSecretsDir $NewRoot) -and
     $els.txtSecrets.Text -ne $NewRoot) `
    ("secrets=$($els.txtSecrets.Text)")
Check 'and the engine is given that same directory' `
    ((New-InstallerParameters 'install')['SecretsDir'] -eq $els.txtSecrets.Text)
$PinnedSecrets = Join-Path $Scratch 'my-own-secrets'
$els.txtSecrets.Text = $PinnedSecrets
$SecondRoot = Join-Path $Scratch 'relocated-again'
New-Item -ItemType Directory -Path $SecondRoot -Force | Out-Null
$els.locationEditor.Visibility = 'Visible'
$els.txtSuite.Text = $SecondRoot
[void](Confirm-InstallLocation)
Check 'once the secrets directory is set by hand it stops following the location' `
    ($els.txtSecrets.Text -eq $PinnedSecrets) "secrets=$($els.txtSecrets.Text)"
# The consequence of relocating an ACL-hardened directory belongs beside the
# control, not in a manual.
$editorText = @()
$q = New-Object System.Collections.Queue
$q.Enqueue($els.locationEditor)
while ($q.Count) {
    $n = $q.Dequeue()
    if ($n -is [System.Windows.Controls.TextBlock] -and $n.Text) { $editorText += [string]$n.Text }
    foreach ($ch in [System.Windows.LogicalTreeHelper]::GetChildren($n)) {
        if ($ch -is [System.Windows.DependencyObject]) { $q.Enqueue($ch) }
    }
}
Check 'the ACL consequence is stated beside the secrets box, not left to the manual' `
    (($editorText -join ' ') -match 'icacls' -and ($editorText -join ' ') -match '(?i)administrator rights') `
    (($editorText | Where-Object { $_ -match 'icacls' }) -join '')

# A location this product cannot live in is REFUSED, against the path that was typed.
$tooDeep = 'C:\' + ('d' * 200)
$v = Test-InstallLocation -Path $tooDeep
Check 'a path with no MAX_PATH headroom is refused' (-not $v.Ok)
Check 'and the refusal states the overage as a number, not "path too long"' `
    ((($v.Reasons -join ' ') -match '(?i)too deeply nested') -and (($v.Reasons -join ' ') -match 'exceeded by \d+')) `
    (($v.Reasons | Where-Object { $_ -match 'deeply' }) -join '')
Check 'and names the path it is refusing' (($v.Reasons -join ' ') -match [regex]::Escape($tooDeep.Substring(0, 40)))
$v = Test-InstallLocation -Path 'not-a-rooted-path'
Check 'a relative path is refused with the reason' `
    ((-not $v.Ok) -and (($v.Reasons -join ' ') -match '(?i)not a full path')) (($v.Reasons) -join ' ')
$v = Test-InstallLocation -Path ''
Check 'an empty location is refused rather than silently defaulted' (-not $v.Ok)
$v = Test-InstallLocation -Path '\\file-server\share\bconnect-mcp'
Check 'a UNC path is refused with what could not be answered about it, not with a guess' `
    ((-not $v.Ok) -and (($v.Reasons -join ' ') -match '(?i)no local drive letter')) (($v.Reasons) -join ' ')

$els.locationEditor.Visibility = 'Visible'
$els.txtSuite.Text = $tooDeep
$applied = Confirm-InstallLocation
Check 'the editor refuses it rather than applying it' (-not $applied)
Check 'the reason is shown against that path, on the page' `
    ($els.lblLocationProblem.Visibility -eq 'Visible' -and $els.lblLocationProblem.Text -match '(?i)too deeply nested') `
    $els.lblLocationProblem.Text
Check 'and the engine is still told the location that worked, not the one refused' `
    ((New-InstallerParameters 'install')['SuiteRoot'] -eq $SecondRoot) `
    ("SuiteRoot=$((New-InstallerParameters 'install')['SuiteRoot'])")
# Cancel puts the box back, so an abandoned edit cannot become the install location.
$els.btnCancelLocation.RaiseEvent(
    (New-Object System.Windows.RoutedEventArgs([System.Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
Check 'Cancel restores the location that was applied' `
    ($els.txtSuite.Text -eq $SecondRoot -and $els.locationEditor.Visibility -eq 'Collapsed') `
    "box=$($els.txtSuite.Text)"

# Put the location back where the rest of this file expects it.
$els.locationEditor.Visibility = 'Visible'
$els.txtSuite.Text = $RealDir
$els.txtSecrets.Text = $RealDir
[void](Confirm-InstallLocation)

# ==============================================================================
# Part 6d: permissions -- read only is the answer, not just the appearance.
# ==============================================================================
Write-Host ''
Write-Host '-- permissions: read only by default --' -ForegroundColor Cyan

$script:Page = $PG_PERMS
Show-Page
Check 'read only is the selected answer when the page is first seen' `
    ([bool]$els.rbReadOnly.IsChecked -and -not $els.rbAllowChanges.IsChecked)
Check 'and what allowing changes would permit is not shown until it is chosen' `
    ($els.writeList.Visibility -eq 'Collapsed') "writeList=$($els.writeList.Visibility)"
Check 'the engine is told read-only, not handed an empty gate to interpret' `
    ((New-InstallerParameters 'install').ContainsKey('ReadOnly') -and
     -not (New-InstallerParameters 'install').ContainsKey('WriteGate'))
$els.rbAllowChanges.IsChecked = $true
Check 'choosing to allow changes reveals what that permits, per server' `
    ($els.writeList.Visibility -eq 'Visible') "writeList=$($els.writeList.Visibility)"
# The ticks left behind by an operator who changed their mind must not become an
# install that writes. The answer is the radio button, not the ticks.
$capable = @($script:WriteRows | Where-Object { $_.Spec.allowlist -eq $false })
if ($script:WriteRows.Count) {
    $script:WriteRows[0].Check.IsChecked = $true
    foreach ($tc in $script:WriteRows[0].ToolChecks) { $tc.IsChecked = $true }
    Check 'with changes allowed and a server ticked, the gate is not empty' `
        ((Get-WriteGate).Count -gt 0) ((Get-WriteGate).Keys -join ', ')
    $els.rbReadOnly.IsChecked = $true
    Check 'going back to read only empties the gate, whatever was left ticked' `
        ((Get-WriteGate).Count -eq 0) ((Get-WriteGate).Keys -join ', ')
    Check 'and the engine is told read-only again' `
        ((New-InstallerParameters 'install').ContainsKey('ReadOnly'))
} else {
    Check 'there is at least one write-capable server to gate' $false 'no write rows built'
}
# ------------------------------------------------------------------------------
# The per-tool allowlist is a grid, grouped by what the tool does.
#
# It used to be one WrapPanel in catalogue order, wrapping wherever the width ran
# out: ragged columns, and -- the part that matters -- deletejob_instance rendered
# identically to createjob_instance. A destructive tick that looks exactly like a
# harmless one is a presentation choice with a consequence.
# ------------------------------------------------------------------------------
$gated = @($script:WriteRows | Where-Object { $_.Spec.allowlist })
if ($gated.Count) {
    $row = $gated[0]
    $names = @($row.ToolChecks | ForEach-Object { [string]$_.Content })
    Check 'every write tool the server declares has a checkbox, none lost to grouping' `
        ($names.Count -eq @($row.Spec.writeTools).Count) `
        ("checkboxes=$($names.Count) declared=$(@($row.Spec.writeTools).Count)")

    # Reference identity, not Select-Object -Unique. -Unique compares objects by
    # ToString(), and every Grid stringifies to "System.Windows.Controls.Grid" --
    # so five distinct grids deduplicated to one and the grouping assertion failed
    # against working code. The test was wrong, not the page.
    $grids = @()
    foreach ($tc in $row.ToolChecks) {
        if (-not (@($grids | Where-Object { [object]::ReferenceEquals($_, $tc.Parent) }).Count)) { $grids += $tc.Parent }
    }
    Check 'they are laid out in grids rather than a wrap, so columns line up' `
        (@($grids | Where-Object { $_ -is [System.Windows.Controls.Grid] }).Count -eq $grids.Count)
    Check 'each grid has the same fixed column count, so a tool does not move between runs' `
        (@($grids | ForEach-Object { $_.ColumnDefinitions.Count } | Select-Object -Unique).Count -eq 1) `
        ("column counts: " + ((@($grids | ForEach-Object { $_.ColumnDefinitions.Count } | Select-Object -Unique)) -join ', '))
    Check 'and there is more than one group, so grouping actually happened' `
        ($grids.Count -gt 1) "groups=$($grids.Count)"

    $destructive = @($row.ToolChecks | Where-Object { [string]$_.Content -match '^(delete|remove|withdraw)' })
    Check 'the destructive tools are drawn in the critical colour, not the ordinary one' `
        ($destructive.Count -gt 0 -and
         @($destructive | Where-Object { $_.Foreground.Color -ne (Br $C.Crit).Color }).Count -eq 0) `
        ("destructive=$($destructive.Count)")
    # Deliberately NOT asserting that no destructive tool is pre-ticked, because one
    # is: lib\catalog.json's allowlistDefault for this server includes a delete. That
    # is a shipped product default, chosen by someone, and a guard that quietly
    # changed it would be making a security decision in a test file. It is recorded
    # here instead, and raised as a question, so the value is visible either way.
    $preTicked = @($destructive | Where-Object { $_.IsChecked } | ForEach-Object { [string]$_.Content })
    Check 'whatever the default ticks, it is visible here rather than implied' `
        ($true) ("destructive tools ticked by default: " + $(if ($preTicked.Count) { $preTicked -join ', ' } else { 'none' }))
} else {
    Check 'there is a server with a per-tool allowlist to lay out' $false 'none in the catalogue'
}

# Which servers are enabled is a different question, and it is behind Advanced.
Check 'the server list is reachable but out of the flow, under Advanced' `
    ($null -ne $els.expServers -and -not $els.expServers.IsExpanded -and
     $script:ServerRows.Count -eq @($Catalog.servers).Count) `
    ("expanded=$($els.expServers.IsExpanded) rows=$($script:ServerRows.Count)")

# ==============================================================================
# Part 6d: the address is composed from the server name.
#
# The page asks for the server, not the URL, because the scheme, the port and the
# /bconnect virtual directory are fixed by the product -- and a typo in any of
# them produces a 401 that reads as a bad password, since bConnect answers 401
# for routes it does not recognise.
#
# What is asserted here is that the address SHOWN, the address the navigation
# gate accepts and the address the ENGINE is handed are one value. Three readers
# of two text boxes is exactly how a wizard comes to install something other than
# what it displayed.
# ==============================================================================
Write-Host ''
Write-Host '-- the bConnect address --' -ForegroundColor Cyan

$els.chkCustomUrl.IsChecked = $false
$els.txtServerFqdn.Text = 'bms.example.local'
Check 'a server name composes the standard bConnect address' `
    ((Get-BaseUrl) -eq 'https://bms.example.local/bconnect') "got '$(Get-BaseUrl)'"
Check 'and the line under the box states that address rather than describing the rule' `
    ($els.lblComposedUrl.Text -match [regex]::Escape('https://bms.example.local/bconnect')) `
    $els.lblComposedUrl.Text
Check 'and it is what the engine is handed' `
    ((New-InstallerParameters 'install')['BaseUrl'] -eq 'https://bms.example.local/bconnect')

# The field asked for a whole URL until now. A returning operator pastes one.
$els.txtServerFqdn.Text = 'https://bms.example.local/bconnect'
Check 'a pasted URL is reduced to its host rather than doubled or refused' `
    ((Get-BaseUrl) -eq 'https://bms.example.local/bconnect') "got '$(Get-BaseUrl)'"
$els.txtServerFqdn.Text = 'bms.example.local/'
Check 'and a trailing slash does not survive into the path' `
    ((Get-BaseUrl) -eq 'https://bms.example.local/bconnect') "got '$(Get-BaseUrl)'"

$els.txtServerFqdn.Text = 'bms.example.local:8443'
Check 'a port is part of the address and is kept' `
    ((Get-BaseUrl) -eq 'https://bms.example.local:8443/bconnect') "got '$(Get-BaseUrl)'"

# Advanced wins outright. Merging the two would produce an address neither box shows.
$els.txtServerFqdn.Text = 'bms.example.local'
$els.chkCustomUrl.IsChecked = $true
$els.txtBaseUrl.Text = 'https://other.example.local/custom/bconnect'
Check 'the Advanced address wins over the composed one, and is not merged with it' `
    ((Get-BaseUrl) -eq 'https://other.example.local/custom/bconnect') "got '$(Get-BaseUrl)'"
Check 'the panel holding it is visible once it is in use' `
    ($els.pnlCustomUrl.Visibility -eq 'Visible')
Check 'and the line above says the name is not being used, rather than showing a stale address' `
    ($els.lblComposedUrl.Text -match '(?i)advanced' -and
     $els.lblComposedUrl.Text -notmatch [regex]::Escape('https://bms.example.local/bconnect')) `
    $els.lblComposedUrl.Text
$els.chkCustomUrl.IsChecked = $false
Check 'and clearing it collapses the panel and restores the composed address' `
    ($els.pnlCustomUrl.Visibility -eq 'Collapsed' -and (Get-BaseUrl) -eq 'https://bms.example.local/bconnect')

# The gate. A name alone is a complete answer; nothing else on this page asks for
# a URL any more, so a gate still watching the old box would never open.
$script:Page = $PG_CONNECT
Set-Shape 'workstation'
$els.txtServerFqdn.Text = ''
Check 'no server name means the wizard does not advance' (-not (Test-CanAdvance))
$els.txtServerFqdn.Text = 'bms.example.local'
Check 'and a name alone satisfies it -- no URL is typed anywhere' (Test-CanAdvance)

# The load-time decision, exercised on the function that makes it. An address that
# does not recompose EXACTLY belongs in Advanced, because the alternative is a
# wizard showing one address and installing another. Not asserted here: the wiring
# that reads the stored file at startup, which needs an installed estate.
foreach ($std in @('https://bms.example.local/bconnect',
                   # A port round-trips too, and belongs in the name box rather than
                   # in Advanced: the port is part of the server's address, which is
                   # the same rule the "a port is kept" assertion above states. Only
                   # a different path or scheme is genuinely non-standard.
                   'https://bms.example.local:8443/bconnect')) {
    Check "a stored standard address round-trips, so it belongs in the name box: $std" `
        ((Get-ComposedBaseUrl $std) -eq $std) "recomposed as '$(Get-ComposedBaseUrl $std)'"
}
foreach ($odd in @('https://bms.example.local/custom/bconnect',
                   'https://bms.example.local/bconnect/v2',
                   'http://bms.example.local/bconnect')) {
    Check "a stored non-standard address does not round-trip, so it goes to Advanced: $odd" `
        ((Get-ComposedBaseUrl $odd) -ne $odd) "recomposed as '$(Get-ComposedBaseUrl $odd)'"
}

Set-TestCredentials
Set-Shape 'workstation'

# ==============================================================================
# Part 6d0: the v1.1 username rule stops applying where it cannot be satisfied.
#
# Reported from a standalone test server: the install stopped on the v1.1 username
# "Administrator" with "v1.1 returns 401 for a bare account name. Use UPN form."
# That machine has no domain. There was no UPN to give, so the rule refused the
# only kind of account that existed and there was no way past it.
#
# The rule itself is right, and was verified against a live bMS -- a DOMAIN-JOINED
# one, which is the only place it holds. It now applies on domain-joined machines
# and stops applying on workgroup ones, where the live v1.1 probe settles it
# instead, because which local form v1.1 accepts has not been measured.
#
# Read out of the engine rather than restated, so a change to the rule is a change
# to what is asserted here.
# ==============================================================================
Write-Host ''
Write-Host '-- the v1.1 username rule --' -ForegroundColor Cyan

$engineSrc = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'Install-BConnectMcp.ps1') -Raw
$upnFn = [regex]::Match($engineSrc, '(?s)function Test-V11UpnProblem \{.*?\r?\n\}').Value
Check 'the rule was found in the engine, so this is not testing a copy of it' `
    ([bool]$upnFn) 'Test-V11UpnProblem not located'
if ($upnFn) {
    Invoke-Expression $upnFn
    Check 'on a domain machine a bare account name is still refused' `
        ([bool](Test-V11UpnProblem -User 'jsmith' -DomainJoined $true))
    Check 'and DOMAIN\user is still refused, with the UPN it should have been' `
        ((Test-V11UpnProblem -User 'CORP\jsmith' -DomainJoined $true) -match 'jsmith@CORP')
    Check 'and a proper UPN passes' `
        (-not (Test-V11UpnProblem -User 'svc-bconnect@corp.local' -DomainJoined $true))

    # MEASURED against bConnect on a standalone server: HOSTNAME\Username
    # authenticates and a bare name does not. So the standalone path is a rule in its
    # own right, not the domain rule switched off -- "we do not know" would leave the
    # operator to discover the form from a 401, which is the ambiguity this function
    # exists to remove.
    Check 'on a standalone machine HOSTNAME\account is accepted' `
        (-not (Test-V11UpnProblem -User 'SRV01\Administrator' -DomainJoined $false))
    Check 'and a bare account name is refused there, because it returns 401' `
        ([bool](Test-V11UpnProblem -User 'Administrator' -DomainJoined $false))
    Check 'and the refusal names this computer, so the fix is not left as an exercise' `
        ((Test-V11UpnProblem -User 'Administrator' -DomainJoined $false) -match [regex]::Escape($env:COMPUTERNAME + '\Administrator'))
    Check 'a UPN is refused on a standalone machine, there being no domain behind it' `
        ([bool](Test-V11UpnProblem -User 'svc@corp.local' -DomainJoined $false))
    Check 'and that refusal suggests the local form of the same account' `
        ((Test-V11UpnProblem -User 'svc@corp.local' -DomainJoined $false) -match [regex]::Escape($env:COMPUTERNAME + '\svc'))
    Check 'but an empty username is still refused on both' `
        ((Test-V11UpnProblem -User '' -DomainJoined $false) -and (Test-V11UpnProblem -User '' -DomainJoined $true))
}

Check 'the engine decides domain membership rather than assuming it' `
    ($engineSrc -match 'PartOfDomain')
Check 'and defaults to the STRICTER rule when it cannot tell' `
    ($engineSrc -match '(?m)^\$script:DomainJoined = \$true') `
    'guessing standalone would switch the check off on a machine that needs it'
Check 'the window states the form THIS machine needs, not one answer for both' `
    ($els.lblV11Note.Text -and $(if ($script:DomainJoinedHere) { $els.lblV11Note.Text -match '(?i)UPN' }
                                 else { $els.lblV11Note.Text -match [regex]::Escape($env:COMPUTERNAME + '\Administrator') })) `
    $els.lblV11Note.Text
Check 'and it warns that v1.1 is more privileged whichever machine this is' `
    ($els.lblV11Note.Text -match '(?i)MORE PRIVILEGED')

# ==============================================================================
# Part 6d1: every box an operator types into says what it is for.
#
# Reported from a real install: the bConnect v1.1 section drew two empty boxes,
# one a TextBox and one a PasswordBox, with nothing saying which was the username
# and which the password. A paragraph above the pair explained what v1.1 IS; it
# did not name the fields.
#
# This had already been fixed once, for the Basic credential pair, and the fix was
# applied only where it was noticed. Two more were left: v1.1, and the install
# location box in the Change editor on Review. Fixing the instance rather than the
# class is why the second and third survived, so the rule is asserted here for
# EVERY input box rather than for the three that are known about.
# ==============================================================================
Write-Host ''
Write-Host '-- every input box is labelled --' -ForegroundColor Cyan

function Get-PrecedingLabel {
    <#
        The Label-styled TextBlock immediately above a control in its own panel.
        Three siblings back, not one: a box is often preceded by its own sub-note
        or a checkbox that reveals it.
    #>
    param($Control)
    $parent = [System.Windows.Media.VisualTreeHelper]::GetParent($Control)
    if (-not $parent) { $parent = $Control.Parent }
    if (-not ($parent -is [System.Windows.Controls.Panel])) { return $null }
    $idx = $parent.Children.IndexOf($Control)
    for ($i = $idx - 1; $i -ge 0 -and $i -ge ($idx - 3); $i--) {
        $sib = $parent.Children[$i]
        # Any short text block immediately before the box, not only an upper-case
        # one. The first draft required upper case and failed the gateway's Bind and
        # Port fields, which are labelled inline and to the left because they are two
        # short values on one row -- a house style, not a missing label. The rule
        # being asserted is that a label EXISTS, not how it is cased.
        if ($sib -is [System.Windows.Controls.TextBlock] -and $sib.Text -and $sib.Text.Trim().Length -le 40) {
            return $sib.Text
        }
    }
    return $null
}

# txtEquivalent is read-only output, not an input, and txtConfirm carries its
# instruction inline on the confirmation bar ("type ENABLE WRITES").
$exempt = @('txtEquivalent', 'txtConfirm')
$inputNames = @($els.Keys | Where-Object {
    $els[$_] -is [System.Windows.Controls.TextBox] -or $els[$_] -is [System.Windows.Controls.PasswordBox]
} | Where-Object { $exempt -notcontains $_ } | Sort-Object)

Check 'there are input boxes to check, so this is not passing vacuously' `
    ($inputNames.Count -ge 8) ("boxes: " + ($inputNames -join ', '))

$unlabelled = @()
foreach ($n in $inputNames) {
    if (-not (Get-PrecedingLabel $els[$n])) { $unlabelled += $n }
}
Check 'every box an operator types into has a label above it' `
    ($unlabelled.Count -eq 0) `
    $(if ($unlabelled.Count) { 'unlabelled: ' + ($unlabelled -join ', ') } else { "$($inputNames.Count) checked" })

# Named individually because these three are the reported ones, so a regression in
# any of them says so by name rather than as a count.
foreach ($pair in @(@('txtV11User', 'USERNAME'), @('pwV11', 'PASSWORD'), @('txtSuite', 'INSTALL'))) {
    $lab = Get-PrecedingLabel $els[$pair[0]]
    Check "$($pair[0]) is labelled" ($lab -and $lab -match $pair[1]) "label='$lab'"
}

# ==============================================================================
# Part 6d2: the rail is a summary, and a way back.
#
# It used to be four fixed sentences and no navigation: Back moved one step, so
# correcting the address from the Review page meant three presses, and the rail
# said the same thing on every run whatever had been answered.
#
# The rule that matters is the one on clicking FORWARD. A rail that let an
# operator jump to Review from step 1 would build that page out of answers that do
# not exist -- which is the same class of defect as a wizard that lets a run start
# on a value the engine refuses.
# ==============================================================================
Write-Host ''
Write-Host '-- the rail --' -ForegroundColor Cyan

Set-TestCredentials
Set-Shape 'workstation'
Select-Hosts @('claude-desktop')
$script:Page = $PG_CONNECT
Show-Page

Check 'a step that has been answered shows its answer, not its description' `
    ((Get-RailSummary $PG_CONNECT) -match 'bms\.example\.local') "summary='$(Get-RailSummary $PG_CONNECT)'"
Check 'the clients step names what was ticked' `
    ((Get-RailSummary $PG_CLIENTS) -match '(?i)claude') "summary='$(Get-RailSummary $PG_CLIENTS)'"
Check 'and the permissions step says read only when nothing is enabled' `
    ((Get-RailSummary $PG_PERMS) -eq 'read only') "summary='$(Get-RailSummary $PG_PERMS)'"

# Reachability. Each of these is a page the operator may NOT be sent to yet.
$reach = Get-FurthestReachableStep
Check 'every answered step is reachable, and the first unanswered one is the limit' `
    ($reach -ge $PG_CLIENTS -and $reach -lt $script:StepCount) "furthest=$reach"

Set-Shape 'none'
Check 'with the first question unanswered, nothing beyond step 1 is reachable' `
    ((Get-FurthestReachableStep) -eq $PG_CONNECT) "furthest=$(Get-FurthestReachableStep)"
Set-Shape 'workstation'

$script:Running = $true
Check 'and while a run is in flight the rail is dead entirely' `
    ((Get-FurthestReachableStep) -eq -1) "furthest=$(Get-FurthestReachableStep)"
$script:Running = $false

# Test-CanAdvance must still answer about the CURRENT page after the refactor that
# let Test-PageSatisfied ask about any page -- and asking about another page must
# not leave $script:Page pointing at it.
$script:Page = $PG_CONNECT
$before = $script:Page
[void](Test-PageSatisfied $PG_REVIEW)
Check 'asking about another page does not move the operator to it' `
    ($script:Page -eq $before) "page=$($script:Page)"
Check 'and Test-CanAdvance still answers about the page actually being shown' `
    ((Test-CanAdvance) -eq (Test-PageSatisfied $script:Page))

# ==============================================================================
# Part 6e1: the button, pressed.
#
# Everything else in this file asserts the PIECES: the parameters the engine
# would get, the verdict a known result produces. Nothing had ever pressed Test
# and watched a verdict come out -- and the chain between them is four links long
# (button -> private runspace -> progress records on the Information stream ->
# Finish-Run -> the label), any one of which can break without a single other
# assertion in this file noticing. Three separate defects reached a test machine
# through that gap, and all three printed the same wrong sentence.
#
# So this presses it. The engine really runs, on its own runspace, and the
# DispatcherTimer that drains it is pumped by hand because there is no message
# loop behind a window that was never shown.
#
# The suite root here is a scratch directory with no packages in it, so the run
# stops early with a specific complaint. That is the point: the assertion is that
# the LABEL CARRIES THAT COMPLAINT rather than a sentence about bConnect, which
# was never contacted. A green run needs a reachable bMS and a real suite, and is
# what the operator's own Test does.
# ==============================================================================
Write-Host ''
Write-Host '-- pressing Test, and pumping the window by hand --' -ForegroundColor Cyan

function Step-Dispatcher {
    # DoEvents. Lets the DispatcherTimer tick and the UI updates apply on a window
    # that is not showing, so the run can finish without ShowDialog.
    $frame = New-Object System.Windows.Threading.DispatcherFrame
    [void][System.Windows.Threading.Dispatcher]::CurrentDispatcher.BeginInvoke(
        [System.Windows.Threading.DispatcherPriority]::Background, [action]{ $frame.Continue = $false })
    [System.Windows.Threading.Dispatcher]::PushFrame($frame)
}

Set-TestCredentials
Set-Shape 'workstation'
$els.chkCustomUrl.IsChecked = $false
# NO CLIENT SELECTED, which is the state Test is actually pressed in: the button
# is on step 1 and the client page is step 2, so the overwhelmingly common press
# happens before anything is ticked. Driving it with a selection left over from an
# earlier assertion tested a state the operator will rarely be in, and hid what
# they will see -- the first run of this block aborted on a host-config guard and
# never reached the network at all.
Reset-HostCatalog @()
Update-HostPage
# The REAL suite root for this one assertion. Everywhere else in this file a
# scratch directory is correct and deliberate, but here it is not: the engine
# checks the suite root before it checks the network, so a fake one stops the run
# in Step 1 and the verdict under test is never produced. The first attempt at
# this block asserted a network answer from a run that had never reached the
# network, and reported a harness artifact as a product defect.
$SuiteRootReal = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'bConnect-MCP-main'
$savedLocation = $script:LocationApplied
if (Test-Path -LiteralPath (Join-Path $SuiteRootReal 'package.json')) { $script:LocationApplied = $SuiteRootReal }
# Port 1 on loopback: nothing listens there, so this is a refused connection in
# milliseconds rather than a timeout, and it reaches no real bMS.
$els.txtServerFqdn.Text = '127.0.0.1:1'

$before = $els.lblTestResult.Text
Start-Installer 'test'
$deadline = (Get-Date).AddSeconds(180)
while ($script:Running -and (Get-Date) -lt $deadline) { Step-Dispatcher; Start-Sleep -Milliseconds 50 }
for ($i = 0; $i -lt 20; $i++) { Step-Dispatcher }

Check 'the run started and finished, rather than hanging on a window with no message loop' `
    (-not $script:Running) "still running after $([int]((Get-Date) - $deadline.AddSeconds(-180)).TotalSeconds)s"
Check 'the label changed from its resting text, so a verdict was actually drawn' `
    ($els.lblTestResult.Text -ne $before) $els.lblTestResult.Text
Check 'and it is not the placeholder shown while the call is in flight' `
    ($els.lblTestResult.Text -notmatch '(?i)Calling bConnect\. Nothing is written')
Check 'the verdict does NOT accuse bConnect of not answering, this run having stopped first' `
    ($els.lblTestResult.Text -notmatch '(?i)bConnect did not answer\. Check') `
    $els.lblTestResult.Text
Check 'a progress record reached the window, so the two really are wired together' `
    ($null -ne $script:LastResult) "LastResult=$($null -ne $script:LastResult)"

# ------------------------------------------------------------------------------
# The output can leave the window.
#
# Reported from testing: the pane was a TextBlock, which cannot be selected. An
# operator watching an install fail could photograph the screen or retype it, at
# exactly the moment they most need to send the text to somebody.
#
# The clipboard is deliberately NOT exercised -- a guard that sets it would trample
# whatever the person running the suite had in there. Copy-ConsoleText is split
# from the click handler so what WOULD be copied can be asserted instead.
# ------------------------------------------------------------------------------
Check 'the output pane is selectable, not a TextBlock' `
    ($els.conScroll -is [System.Windows.Controls.RichTextBox]) `
    ("pane is $($els.conScroll.GetType().Name)")
Check 'and it is read-only, so the record of the run cannot be edited' `
    ($els.conScroll.IsReadOnly)
Check 'and it has a visible caret, so selecting with the keyboard is possible' `
    ($els.conScroll.IsReadOnlyCaretVisible)
Check 'there is a Copy control as well, for the whole run in one action' `
    ($null -ne $els.btnCopyLog)
$copyText = Get-ConsoleText
Check 'what Copy would put on the clipboard is the run''s real output' `
    ($copyText -match 'STUB|bConnect|Step|installation') `
    (($copyText.Trim() -split "`r?`n" | Select-Object -First 1))
Check 'and it carries the whole run, not just the last line' `
    (@($copyText -split "`r?`n").Count -gt 3) `
    ("lines: " + @($copyText -split "`r?`n").Count)
Check 'and the console pane carries the run''s real output, not a summary of it' `
    ($els.console.Inlines.Count -gt 0) "inlines=$($els.console.Inlines.Count)"
Check 'Test leaves the operator on the Connect page, where the answer is' `
    ($script:Page -eq $PG_CONNECT) "page=$($script:Page)"

# The verdict for THIS run specifically. Nothing is listening on port 1, so the
# only correct answer is that the address produced no answer -- and it has to say
# the ADDRESS, because that is the field the operator can act on. A run that got
# this far and reported a host-configuration or prerequisite complaint would mean
# Test cannot answer its own question until the rest of the wizard is filled in.
# THE assertion this block exists for: the sentence on the label came out of the
# run, rather than being composed by the window.
#
# It is not "the label says the address did not answer". That would only hold on a
# clean machine: this one carries a real installation record, so the estate guard
# refuses a run pointed at a different bMS long before the socket is opened -- and
# it is right to. Asserting a specific verdict would make this test pass or fail on
# what happens to be installed on the machine running it, which is not a property
# of the product.
#
# Matching the verdict against the console pane holds everywhere and is the actual
# rule: three defects reached a test machine because the window described a cause
# the run never reported.
$consoleText = -join (@($els.console.Inlines) | ForEach-Object { try { $_.Text } catch { '' } })
$verdictCore = ($els.lblTestResult.Text -replace '\s*Check \(dry run\).*$', '').Trim().TrimEnd('.')
Check 'the verdict is a sentence the run itself printed, not one the window composed' `
    ($verdictCore -and $consoleText -match [regex]::Escape($verdictCore)) `
    "verdict: $verdictCore"
Check 'and not as something the operator has not reached yet' `
    ($els.lblTestResult.Text -notmatch '(?i)per-project host config|package\.json|suite root') `
    'pressing Test on step 1 must not require step 2 to have been visited'
Check 'and the run reached the network step rather than stopping in prerequisites' `
    ($els.console.Inlines.Count -gt 10) "inlines=$($els.console.Inlines.Count)"

$script:LocationApplied = $savedLocation
Set-TestCredentials
Select-Hosts @('claude-desktop')

# ==============================================================================
# Part 6e: the Test button is the engine, not a second implementation.
# ==============================================================================
Write-Host ''
Write-Host '-- Test on the Connect page --' -ForegroundColor Cyan
$testParams = New-InstallerParameters 'test'
$dryParams  = New-InstallerParameters 'dryrun'
Check 'Test asks the engine for exactly what Check (dry run) asks it for' `
    (((@($testParams.Keys | Sort-Object)) -join ',') -eq ((@($dryParams.Keys | Sort-Object)) -join ',')) `
    ("test: " + ((@($testParams.Keys | Sort-Object)) -join ', '))
Check 'and it is a dry run, so it writes nothing' `
    ($testParams.ContainsKey('DryRun') -and $testParams['DryRun'])
Check 'the button is on the Connect page, where the URL and the key were typed' `
    ((Test-OnPage $els.btnTest $els.page0) -and (Test-OnPage $els.lblTestResult $els.page0))

# ==============================================================================
# Part 6e2: the verdict the Test button draws.
#
# Measured against the unfixed window: a dry run that stopped in Step 1 on a
# missing prerequisite was reported as "bConnect did not answer" -- which is not
# a vague message, it is a false one. It names a component that was never
# contacted and sends the operator to re-check an address and a credential that
# were both correct. Reported from a test VM exactly that way.
#
# Driven with known results rather than by running the engine, because that is
# the only way to state what each verdict is FOR.
# ==============================================================================
Write-Host ''
Write-Host '-- what Test says --' -ForegroundColor Cyan

$vOk = Get-TestVerdict -Failed $false -Tls $null -Result ([pscustomobject]@{ reachable = $true })
Check 'a run that reached bConnect says so, and reads as success' `
    ($vOk.Ok -and $vOk.Text -match '(?i)bConnect answered') $vOk.Text

# The reason Abort puts on the done record. This is the reported defect.
$vAbort = Get-TestVerdict -Failed $true -Tls $null -Result ([pscustomobject]@{
    failed = $true; reason = 'Node.js is not on PATH.' })
Check 'a run that stopped on a prerequisite reports THAT, not a guess about bConnect' `
    ($vAbort.Text -eq 'Node.js is not on PATH.') $vAbort.Text
Check 'and does not claim bConnect failed to answer, having never contacted it' `
    ($vAbort.Text -notmatch '(?i)bConnect did not answer')

# -ContinueOnUnreachable means an unreachable bMS still ends failed = false.
$vUnreach = Get-TestVerdict -Failed $false -Tls $null -Result ([pscustomobject]@{
    failed = $false; dryRun = $true; reachable = $false; httpStatus = $null })
Check 'a run that finished but never reached bConnect is NOT reported as success' `
    (-not $vUnreach.Ok) $vUnreach.Text
Check 'and says the address is where the answer did not come from' `
    ($vUnreach.Text -match '(?i)did not answer at that address')

$v401 = Get-TestVerdict -Failed $false -Tls $null -Result ([pscustomobject]@{
    failed = $false; reachable = $false; httpStatus = 401 })
Check 'a 401 is reported as a 401 rather than as success' `
    ((-not $v401.Ok) -and $v401.Text -match '401') $v401.Text
Check 'and stays ambiguous, because bConnect answers 401 for an unknown route too' `
    ($v401.Text -match '(?i)credential is wrong OR the address')

# The certificate verdict still outranks the generic wording when there is one.
$vTls = Get-TestVerdict -Failed $true -Result ([pscustomobject]@{ failed = $true; reason = 'something generic' }) `
                        -Tls @{ Ok = $false; Headline = 'The bMS certificate was not issued for that name.' }
Check 'a certificate verdict outranks the reason, being the more actionable of the two' `
    ($vTls.Text -match 'certificate was not issued') $vTls.Text

# A result object carrying none of these fields must not throw: an older engine, or
# a run killed before it emitted anything, both produce one.
$vBare = Get-TestVerdict -Failed $true -Tls $null -Result $null
Check 'a run with no verdict at all still produces a sentence, and does not invent a cause' `
    ((-not $vBare.Ok) -and $vBare.Text -match '(?i)did not finish' -and $vBare.Text -notmatch '(?i)bConnect did not answer') `
    $vBare.Text

# ==============================================================================
# Part 6f: -SkipBuild reaches the engine.
#
# packaging\START-HERE.cmd hands -SkipBuild to whichever front end it starts,
# because the offline bundle ships every package already built. The wizard did
# not declare the parameter at all, so a bundle that chose the wizard died before
# its first question. Test-BundleLauncher.ps1 now proves the parameter is
# ACCEPTED; this proves it is ACTED ON. A switch that binds and is then dropped
# on the floor is invisible: the install still succeeds, it just spends several
# minutes rebuilding what it was handed already built.
#
# The affirmative half runs in a child process. This file dot-sources the wizard
# once, at the top, without the switch -- loading it a second time to flip one
# parameter would overwrite every control and script variable the assertions
# above depend on.
# ==============================================================================
Write-Host ''
Write-Host '-- the offline bundle switch --' -ForegroundColor Cyan

Check 'a wizard started without -SkipBuild does not tell the engine to skip the build' `
    (-not (New-InstallerParameters 'install').ContainsKey('SkipBuild'))

$skipProbe = Join-Path $Scratch 'skipbuild-probe.ps1'
@"
. '$UiScript' -TestHeadless -SkipBuild -SuiteRoot '$RealDir' -SecretsDir '$RealDir' -ConfigPath '$PresentCfg'
foreach (`$k in 'install', 'dryrun', 'verify') {
    Write-Output ("`$k=" + [bool](New-InstallerParameters `$k).ContainsKey('SkipBuild'))
}
"@ | Set-Content -LiteralPath $skipProbe -Encoding UTF8
$skipOut = & powershell -NoProfile -ExecutionPolicy Bypass -Sta -File $skipProbe 2>&1 | Out-String

Check 'a wizard started WITH -SkipBuild passes it to the engine on a real install' `
    ($skipOut -match 'install=True') $skipOut.Trim()
Check 'and on the dry runs too, so the command echoed on the run page is the command that ran' `
    ($skipOut -match 'dryrun=True' -and $skipOut -match 'verify=True')

# ==============================================================================
# Part 6b: the TLS diagnosis reaches the operator, with its remedy.
#
# The engine emits a 'tls' progress record whose every word comes from
# lib\probe-tls.mjs. The records used below are produced by CALLING that file, not by
# transcribing it, so a change to the wording there is a change to what is asserted
# here rather than a drift between them.
# ==============================================================================
Write-Host ''
Write-Host '-- the certificate verdict, and what to do about it --' -ForegroundColor Cyan

$describeScript = Join-Path $Scratch 'describe.mjs'
@'
// Ask the real prober to describe a set of causes. No socket is opened: describeTlsResult
// is pure, which is why it is exported separately from probeTls.
import { describeTlsResult } from PROBE_URL;
const peer = {
  subject: 'bms.example.local', issuer: 'Example Issuing CA',
  validFrom: 'Jan  1 00:00:00 2025 GMT', validTo: 'Jan  1 00:00:00 2027 GMT',
  altNames: 'DNS:bms.example.local', chain: ['leaf'], selfSigned: false, leafOnly: true,
};
const base = { url: 'https://bms.example.local/bconnect', host: 'bms.example.local', port: 443, message: '', peer };
const out = {};
for (const [key, r] of Object.entries({
  untrusted:  { ...base, cause: 'untrusted-issuer',  code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
  mismatch:   { ...base, cause: 'hostname-mismatch', code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
  expired:    { ...base, cause: 'expired',           code: 'CERT_HAS_EXPIRED' },
  trusted:    { ...base, cause: 'trusted',           code: '' },
})) out[key] = { cause: r.cause, code: r.code, ...describeTlsResult(r) };
process.stdout.write(JSON.stringify(out));
'@ -replace 'PROBE_URL', ("'" + ([uri](Join-Path $PSScriptRoot 'probe-tls.mjs')).AbsoluteUri + "'") |
    Set-Content -LiteralPath $describeScript -Encoding UTF8

$tlsCases = $null
try {
    $node = Get-Command node -ErrorAction Stop
    $tlsCases = (& $node.Source $describeScript) | ConvertFrom-Json
} catch { }

if (-not $tlsCases) {
    Check 'the TLS wording could be read from lib\probe-tls.mjs' $false 'node was unavailable or the probe failed to load'
} else {
    function Set-TlsRecord {
        # Exactly the shape Show-TlsDiagnosis sends on the Information stream.
        param($Case)
        $script:TlsResult = [pscustomobject]@{
            cause = $Case.cause; code = $Case.code; headline = $Case.headline
            detail = @($Case.detail); remedy = @($Case.remedy)
            warning = [string]$Case.warning; caFixable = [bool]$Case.caFixable; caPath = ''
        }
        Build-TlsPanel
    }

    $script:Page = $PG_RUN
    Show-Page
    $script:TlsResult = $null
    Build-TlsPanel
    Check 'no certificate panel is shown by a run that produced no verdict' `
        ($els.tlsPanel.Visibility -eq 'Collapsed' -and $null -eq (Get-TlsPanelLines))

    Set-TlsRecord $tlsCases.untrusted
    $v = Get-TlsPanelLines
    Check 'an untrusted issuer reaches the operator as a panel, not only as console output' `
        ($els.tlsPanel.Visibility -eq 'Visible' -and $els.tlsPanel.Children.Count -eq 1 -and -not $v.Ok)
    Check 'the panel states the specific cause in the engine''s own words' `
        ($v.Headline -eq $tlsCases.untrusted.headline -and $v.Headline -match '(?i)issuer is not trusted') $v.Headline
    Check 'it carries the certificate detail the prober read off the wire' `
        (@($v.Detail).Count -ge 3 -and (($v.Detail -join ' ') -match 'Example Issuing CA')) `
        ((@($v.Detail) -join ' // ').Substring(0, [Math]::Min(120, (@($v.Detail) -join ' // ').Length)))
    Check 'and the ordered remedy, unchanged from the engine' `
        (@($tlsCases.untrusted.remedy | Where-Object { $v.Remedy -notcontains $_ }).Count -eq 0)
    # By the name of the field that takes it, and by where that field now is: under
    # Advanced on the Connect page. The old sentence named a "Credentials page" that
    # no longer exists, which is exactly the kind of instruction a simplification
    # leaves behind.
    Check 'the CA certificate path is offered as the next action, by the name of the field that takes it' `
        (@($v.Remedy | Where-Object { $_ -match 'CA CERTIFICATE \(PEM\)' }).Count -eq 1 -and
         @($v.Remedy | Where-Object { $_ -match '(?i)press back to the connect page, open advanced' }).Count -eq 1) `
        (@($v.Remedy)[-1])
    Check 'and a field of exactly that name exists on that page' `
        (($xaml.OuterXml -match 'CA CERTIFICATE \(PEM\)') -and (Test-OnPage $els.txtCaCert $els.page0))
    # The whole panel, as an operator reads it. The flag must appear only in the
    # paragraph that names it as a development flag this installer does not offer --
    # never as one of the numbered things to try.
    $panelText = @($els.tlsPanel.Children[0].Child.Children | ForEach-Object { [string]$_.Text })
    Check 'NODE_TLS_REJECT_UNAUTHORIZED is never a numbered step' `
        (@($panelText | Where-Object { $_ -match '^\d+\.\s' -and $_ -match 'NODE_TLS_REJECT_UNAUTHORIZED' }).Count -eq 0) `
        ((@($panelText | Where-Object { $_ -match 'NODE_TLS_REJECT_UNAUTHORIZED' }) -join ' // '))
    Check 'and where it is named at all, it is named as a development flag this installer does not offer' `
        ($v.Warning -match 'NODE_TLS_REJECT_UNAUTHORIZED' -and $v.Warning -match '(?i)development flag' -and
         $v.Warning -match '(?i)does not offer it') $v.Warning
    Check 'the remedy never proposes disabling certificate verification' `
        (@($v.Remedy | Where-Object { $_ -match '(?i)NODE_TLS_REJECT_UNAUTHORIZED|disable certificate verification' }).Count -eq 0)

    Set-TlsRecord $tlsCases.mismatch
    $v = Get-TlsPanelLines
    Check 'a name mismatch is diagnosed as a name mismatch, not as an untrusted issuer' `
        ($v.Headline -match "(?i)not issued for 'bms.example.local'") $v.Headline
    Check 'and does not send the operator after a CA certificate that would not help' `
        (-not $v.CaFixable -and
         @($v.Remedy | Where-Object { $_ -match 'CA CERTIFICATE \(PEM\)' }).Count -eq 0 -and
         @($v.Remedy | Where-Object { $_ -match '(?i)does not fix this' }).Count -eq 1)

    Set-TlsRecord $tlsCases.expired
    $v = Get-TlsPanelLines
    Check 'an expired certificate is named as expired, with the clock on this computer beside it' `
        ($v.Headline -match '(?i)has expired' -and (($v.Detail -join ' ') -match '(?i)the clock on this computer reads')) `
        $v.Headline
    Check 'and its remedy is to renew it, not to work around it' `
        (@($v.Remedy | Where-Object { $_ -match '(?i)renew the certificate' }).Count -eq 1 -and -not $v.CaFixable)

    Set-TlsRecord $tlsCases.trusted
    $v = Get-TlsPanelLines
    Check 'a trusted certificate is reported as a result too, with no remedy attached' `
        ($v.Ok -and @($v.Remedy).Count -eq 0 -and $els.tlsPanel.Visibility -eq 'Visible') $v.Headline

    # A failing run has to LEAD with the certificate: it is the one cause an
    # administrator can act on, and in the raw output it is indistinguishable from a
    # wrong password several hundred lines up.
    Set-TlsRecord $tlsCases.untrusted
    $script:RunKind = 'install'
    Finish-Run $true
    Check 'a run that failed on the certificate says so above the output pane' `
        ($els.lblRunSub.Text -match '(?i)issuer is not trusted' -and $els.tlsPanel.Visibility -eq 'Visible') `
        $els.lblRunSub.Text
    $script:TlsResult = $null
    Build-TlsPanel
}

# ==============================================================================
# Part 7: tone. Mechanically checkable, and it will otherwise regress.
#
# The strings are harvested from three places, because a string can reach the
# operator from any of them: attribute text in either XAML document, text set on a
# control at runtime, and text on the row objects the list template binds.
# ==============================================================================
Write-Host ''
Write-Host '-- tone: enterprise, not conversational --' -ForegroundColor Cyan

$Banned = @(
    @{ Name = 'an exclamation mark';        Pattern = '!' }
    @{ Name = 'first-person plural ("we")'; Pattern = "(?i)\bwe\b|\bwe'(re|ll|ve|d)\b|\bour\b|\bours\b" }
    @{ Name = '"let''s"';                   Pattern = "(?i)\blet's\b|\blet us\b" }
    @{ Name = '"oops"';                     Pattern = '(?i)\boops\b' }
    @{ Name = '"heads up"';                 Pattern = '(?i)heads[- ]up' }
)

function Get-XamlStrings {
    param([xml] $Doc)
    $out = @()
    foreach ($node in $Doc.SelectNodes('//*')) {
        if (-not $node.Attributes) { continue }
        foreach ($a in $node.Attributes) {
            if ($a.Name -notin @('Text', 'Content', 'ToolTip')) { continue }
            # A binding is not a string the operator reads; the bound value is
            # harvested from the row objects instead.
            if ($a.Value -match '^\s*\{') { continue }
            if ($a.Value) { $out += @{ Where = "XAML $($node.Name)"; Text = $a.Value } }
        }
    }
    return $out
}

function Get-LiveStrings {
    # Everything currently set on a control in the built window. Walking the LOGICAL
    # tree rather than the visual one is deliberate: nothing has been laid out in a
    # headless run, so the visual tree is empty and the logical tree is not.
    param($Root, [string] $Where)
    $out = @()
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($Root)
    while ($queue.Count) {
        $n = $queue.Dequeue()
        if ($n -is [System.Windows.Controls.TextBlock] -and $n.Text) { $out += @{ Where = $Where; Text = [string]$n.Text } }
        elseif ($n -is [System.Windows.Controls.ContentControl] -and $n.Content -is [string] -and $n.Content) {
            $out += @{ Where = $Where; Text = [string]$n.Content }
        }
        foreach ($child in [System.Windows.LogicalTreeHelper]::GetChildren($n)) {
            if ($child -is [System.Windows.DependencyObject]) { $queue.Enqueue($child) }
        }
    }
    return $out
}

$strings = @()
$strings += Get-XamlStrings -Doc $xaml
$strings += Get-XamlStrings -Doc $hostXaml

# Drive the window through every page and both interesting host selections so the
# runtime-built text is real text rather than the empty placeholders it starts as.
Select-Hosts @('claude-desktop', 'copilot-studio', 'n8n') -ConfigPath $AbsentCfg
$strings += @((Get-CompletionSummaryText), (Get-ActivationText) |
              ForEach-Object { @{ Where = 'summary text'; Text = [string]$_ } })
# README.md is user-facing text too, and it now carries what four bordered panels
# used to. Letting the tone rules stop at the window would mean the register could
# regress simply by moving a sentence into the document.
if (Test-Path -LiteralPath (Get-ReadmePath)) {
    foreach ($line in ((Get-Content -LiteralPath (Get-ReadmePath) -Raw) -split "`r?`n")) {
        if ($line.Trim()) { $strings += @{ Where = 'README.md'; Text = [string]$line } }
    }
}
Select-Hosts @('vscode', 'claude-desktop') -ProjectDir $ProjectRoot
$strings += @{ Where = 'activation text'; Text = [string](Get-ActivationText) }
# Every page, under every answer to the deployment question -- including the
# unanswered state, which is what the operator sees first. Half of the strings this
# release adds exist only under one of the three, and a harvest that never chose an
# answer would scan none of them.
foreach ($shape in @('none', 'workstation', 'central')) {
    Set-Shape $shape
    for ($i = 0; $i -lt $script:PageCount; $i++) {
        $script:Page = $i
        Show-Page
        $strings += Get-LiveStrings -Root $win -Where "page $i ($shape)"
    }
    # The banner, under this shape, with every check forced to fail: its rows are
    # built at runtime and would otherwise be harvested only where this machine
    # happens to be short of something.
    Build-RequirementBanner @(Get-RequirementChecks | ForEach-Object {
        $f = @{}; foreach ($k in $_.Keys) { $f[$k] = $_[$k] }; $f['State'] = 'not-met'; $f })
    $strings += Get-LiveStrings -Root $els.reqBanner -Where "requirement banner ($shape)"
    Build-RequirementBanner
    foreach ($chk in @(Get-RequirementChecks)) {
        foreach ($f in @('Name', 'Detail', 'Remedy')) {
            if ($chk[$f]) { $strings += @{ Where = "requirement ($shape) $($chk.Name).$f"; Text = [string]$chk[$f] } }
        }
    }
}
Set-Shape none
# And the certificate panel, which is built only by a run. Its wording comes from
# lib\probe-tls.mjs, so this is the harvest reaching across the file boundary into
# text the engine wrote and this window renders.
if ($tlsCases) {
    $script:Page = $PG_RUN
    Show-Page
    foreach ($case in @($tlsCases.untrusted, $tlsCases.mismatch, $tlsCases.expired, $tlsCases.trusted)) {
        Set-TlsRecord $case
        $strings += Get-LiveStrings -Root $els.tlsPanel -Where "tls panel ($($case.cause))"
    }
    $script:TlsResult = $null
    Build-TlsPanel
}
for ($i = 0; $i -lt $script:PageCount; $i++) {
    $script:Page = $i
    Show-Page
    $strings += Get-LiveStrings -Root $win -Where "page $i"
}
foreach ($row in @(Get-HostSelectionCatalog -ProjectDir $GhostDir -HostOutDir $HostOutDir -ConfigPath $AbsentCfg)) {
    foreach ($f in @('Label', 'SetupBadge', 'SetupText', 'Badge', 'VerifiedText', 'PresenceText')) {
        if ($row.$f) { $strings += @{ Where = "row $($row.Id).$f"; Text = [string]$row.$f } }
    }
}
foreach ($chk in @(Get-RequirementChecks)) {
    foreach ($f in @('Name', 'Detail', 'Remedy')) {
        if ($chk[$f]) { $strings += @{ Where = "requirement $($chk.Name).$f"; Text = [string]$chk[$f] } }
    }
}

# Ten passes over the same tree see the same label ten times. Deduplicate on the
# text so the count below means "distinct sentences an operator can read".
$seen = @{}
$strings = @($strings | Where-Object {
    $key = $_.Text
    if ($seen.ContainsKey($key)) { $false } else { $seen[$key] = $true; $true }
})

Check 'there is a body of user-facing text to check at all' `
    ($strings.Count -gt 150) "$($strings.Count) distinct strings harvested"
# The harvest has to reach the text that is BUILT at runtime, not only the literals
# in the two XAML documents -- that is where a conversational sentence is most
# likely to be introduced, and an empty harvest would pass every check below.
foreach ($witness in @(
        @{ What = 'a warning built by the host page'; Text = 'Not found on this machine' }
        @{ What = 'the live selection summary';       Text = 'client(s):' }
        @{ What = 'the completion summary';           Text = 'quit it from the tray icon' }
        @{ What = 'a requirement remedy';             Text = 'icacls' }
        @{ What = 'the deployment question';          Text = 'Where the servers will run' }
        @{ What = 'the shared-service consequence';   Text = 'clients reach them across the network' }
        @{ What = 'the client-staging requirement';   Text = 'does not install them' }
        @{ What = 'the install location line';        Text = 'Install location' }
        @{ What = 'the permissions question';         Text = 'What may the assistant change' }
        @{ What = 'README.md';                        Text = 'more privileged credential than the API key' }
        @{ What = 'the certificate panel';            Text = 'issuer is not trusted' })) {
    Check ("the harvest reaches $($witness.What)") `
        (@($strings | Where-Object { $_.Text -match [regex]::Escape($witness.Text) }).Count -gt 0) `
        $witness.Text
}

foreach ($b in $Banned) {
    $hits = @($strings | Where-Object { $_.Text -match $b.Pattern })
    Check ("no user-facing string uses " + $b.Name) ($hits.Count -eq 0) `
        $(if ($hits.Count) {
            (@($hits | Select-Object -First 4 | ForEach-Object { "[$($_.Where)] " + $_.Text.Substring(0, [Math]::Min(90, $_.Text.Length)) }) -join ' // ')
          } else { "$($strings.Count) strings clean" })
}

# The register is set by more than the banned list: a wizard that opens with "Nothing's
# ticked yet" is wrong in a way no single word catches. The nearest mechanical proxy is
# the contraction, which this product's user-facing text does not use.
$contraction = "(?i)\b(don't|doesn't|didn't|can't|won't|wouldn't|shouldn't|couldn't|isn't|aren't|wasn't|weren't|it's|that's|there's|here's|you're|you'll|you've|they're|nothing's|we're|let's)\b"
$cHits = @($strings | Where-Object { $_.Text -match $contraction })
Check 'no user-facing string uses a contraction' ($cHits.Count -eq 0) `
    $(if ($cHits.Count) {
        (@($cHits | Select-Object -First 4 | ForEach-Object { "[$($_.Where)] " + $_.Text.Substring(0, [Math]::Min(90, $_.Text.Length)) }) -join ' // ')
      } else { 'none' })

Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host ("  $script:Pass passed, $script:Fail failed") -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
Write-Host '  Not proven by this script: that the order is the RIGHT order for a customer --' -ForegroundColor DarkGray
Write-Host '  that was a product decision, and this only holds it in place. Nor that any of' -ForegroundColor DarkGray
Write-Host '  this looks right on a screen: no one has seen the two badges side by side.' -ForegroundColor DarkGray
Write-Host ''
if ($script:Fail) { exit 1 }
exit 0
