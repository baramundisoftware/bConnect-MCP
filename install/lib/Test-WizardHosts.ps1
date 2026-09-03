<#
.SYNOPSIS
    Tests for the wizard's host-selection page: which MCP clients an install
    configures, and what the installer is actually handed as a result.

.DESCRIPTION
    Built the same way as Test-WizardTheme.ps1 next to it: it dot-sources the REAL
    Install-BConnectMcp-UI.ps1 with -TestHeadless, which builds and wires the actual
    window -- including the real lib\HostSelectionPage.ps1 loaded into the Clients
    slot -- and returns instead of calling ShowDialog(). Every assertion below reads
    that live object graph and the real lib\hosts.json.

    The page binds its list TwoWay to the row objects, so the rows ARE the selection.
    That is what makes this testable without a window on screen: ticking a client is
    setting .Selected on a row and calling Update-HostPage, which is exactly what the
    checkbox handler does.

    What this proves:
      * every target in lib\hosts.json reaches the page, and no client is ticked for
        the operator -- the wizard cannot advance until one is chosen
      * the parameters handed to Install-BConnectMcp.ps1 carry -Hosts, and carry
        exactly the chosen ids -- the defect that made the GUI Claude-Desktop-only
      * -ConfigPath, which is one target's path override and nothing else, is passed
        only when that target was chosen
      * a chosen client whose destination directory is not on this machine is said so
        on the page rather than written silently
      * an HTTP-only client turns the gateway on, because it cannot spawn a process
      * the finishing instructions name the clients that were configured
      * the window refuses to start on an MTA thread, with the relaunch command,
        instead of failing inside WPF

    What it does NOT prove: that any of this looks right on a screen, or that a real
    client then loads what was written. The three verification badges on the page say
    which targets have been watched doing that and which have not.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Test-WizardHosts.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    Write-Host 'This test loads WPF and must run on an STA thread:' -ForegroundColor Yellow
    Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Test-WizardHosts.ps1' -ForegroundColor Yellow
    exit 2
}

$UiScript   = Join-Path $PSScriptRoot '..\Install-BConnectMcp-UI.ps1'
$HostsFile  = Join-Path $PSScriptRoot 'hosts.json'
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

# Throwaway paths. Two of them deliberately do not exist: "the client is not on this
# machine" is a state the page has to render, so it has to be producible on demand.
$Scratch     = Join-Path $env:TEMP ('bconnect-wizard-hosts-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$RealDir     = Join-Path $Scratch 'exists'
$GhostDir    = Join-Path $Scratch 'not-there'
# A workspace that is NOT the suite root. This file dot-sources the wizard with
# -SuiteRoot $RealDir, so using $RealDir as the project directory too made the
# workspace and the installation the same folder -- which the engine refuses, and
# which the wizard now refuses on the page. That was the harness describing a state
# no operator should be able to reach, not a property of the page.
$WorkspaceDir = Join-Path $Scratch 'workspace'
New-Item -ItemType Directory -Path $RealDir -Force | Out-Null
New-Item -ItemType Directory -Path $WorkspaceDir -Force | Out-Null
$PresentCfg  = Join-Path $RealDir  'claude_desktop_config.json'
$AbsentCfg   = Join-Path $GhostDir 'claude_desktop_config.json'

function Select-Hosts {
    # Tick exactly these ids and let the page react, the way the list's own handler
    # does. Reset-HostCatalog is called first so a previous test's paths do not leak.
    param([string[]] $Ids, [string] $ProjectDir = $WorkspaceDir, [string] $ConfigPath = $PresentCfg)
    $els.ProjectDirBox.Text = $ProjectDir
    $els.ConfigPathBox.Text = $ConfigPath
    Reset-HostCatalog $Ids
    Update-HostPage
}

Write-Host ''
Write-Host 'Wizard host-selection tests' -ForegroundColor Cyan
Write-Host ''

# ==============================================================================
# Part 1: the page is wired in at all, and is driven by the registry.
# ==============================================================================
Write-Host '-- the page exists and comes from lib\hosts.json --' -ForegroundColor Cyan
. $UiScript -TestHeadless -SuiteRoot $RealDir -SecretsDir $RealDir -ConfigPath $PresentCfg

$registry = (Get-Content -LiteralPath $HostsFile -Raw | ConvertFrom-Json).targets
Check 'the host page loaded into the wizard (HostList is a real control)' `
    ($null -ne $els.HostList) "$($els.HostList)"
# FOUR STEPS AND A RESULT. The rail draws four entries; the run page is the fifth
# grid and deliberately has none, because it is not somewhere the operator
# navigates to. Both numbers are asserted, because "five grids" without "four rail
# entries" would let the old eleven-step rail come back one page at a time.
Check 'the wizard has four steps in the rail, and one further page for the run itself' `
    ($script:StepCount -eq 4 -and $script:PageCount -eq 5 -and
     $PageTitles.Count -eq 5 -and $PageBlurbs.Count -eq 5 -and
     $els.rail.Children.Count -eq 4) `
    "StepCount=$($script:StepCount), PageCount=$($script:PageCount), rail=$($els.rail.Children.Count), titles=$($PageTitles.Count)"
Check 'the run page is not one of the four steps' `
    ($PG_RUN -eq $script:StepCount -and $PG_REVIEW -eq ($script:StepCount - 1)) `
    "PG_REVIEW=$PG_REVIEW PG_RUN=$PG_RUN"
Check 'every target in the registry is offered as a row' `
    (@($script:HostRows).Count -eq @($registry).Count) `
    ("registry $(@($registry).Count) -> rows $(@($script:HostRows).Count): " + (($script:HostRows | ForEach-Object { $_.Id }) -join ', '))
$missingRows = @($registry | Where-Object { ($script:HostRows | ForEach-Object { $_.Id }) -notcontains $_.id })
Check 'no target is dropped on the way from the registry to the page' `
    ($missingRows.Count -eq 0) $(if ($missingRows.Count) { 'missing: ' + (($missingRows | ForEach-Object { $_.id }) -join ', ') } else { '' })
Check 'the list is bound to those rows, so a tick lands on the row object' `
    ($null -ne $els.HostList.ItemsSource)

# Removing pages moved every later ordinal. Walk all five through the real
# Show-Page: each one must build without throwing and be the only page visible.
$script:Measured['pre-measured'] = @{ Tools = 0; Bytes = 0 }   # keeps Start-Measure from spawning node
$walkOk = $true
$walkDetail = ''
$footers = @()
$nextLabels = @()
for ($i = 0; $i -lt $script:PageCount; $i++) {
    $script:Page = $i
    try { Show-Page } catch { $walkOk = $false; $walkDetail = "page $i threw: $($_.Exception.Message)"; break }
    $visible = @(0..($script:PageCount - 1) | Where-Object { $els["page$_"].Visibility -eq 'Visible' })
    if ($visible.Count -ne 1 -or $visible[0] -ne $i) {
        $walkOk = $false; $walkDetail = "on page $i the visible pages were: $($visible -join ',')"; break
    }
    $footers += [string]$els.lblFooter.Text
    $nextLabels += [string]$els.btnNext.Content
}
Check 'every page builds and shows exactly itself, after the wizard was cut to four steps' $walkOk $walkDetail
# Every per-page ordinal in Update-Nav has to have moved with the pages. The footer
# line is the cheapest witness: five pages, five different sentences, and the last
# button reading Install then Close.
Check 'each page gets its own footer line, so no ordinal was left on its old neighbour' `
    ($footers.Count -eq $script:PageCount -and
     @($footers | Where-Object { $_ }).Count -eq $script:PageCount -and
     (@($footers | Select-Object -Unique).Count -eq $script:PageCount)) `
    (($footers | ForEach-Object { if ($_) { $_.Substring(0, [Math]::Min(28, $_.Length)) } else { '<empty>' } }) -join ' | ')
Check 'the last two pages still offer Install then Close' `
    ($nextLabels[$PG_REVIEW] -eq 'Install' -and $nextLabels[$PG_RUN] -eq 'Close' -and $nextLabels[$PG_CLIENTS] -eq 'Next') `
    ($nextLabels -join ' | ')
Check 'the host page slot holds the loaded host XAML, not an empty placeholder' `
    ($els["page$PG_CLIENTS"].Children.Count -eq 1) "children=$($els["page$PG_CLIENTS"].Children.Count)"

# ==============================================================================
# Part 2: nothing is chosen for the operator, and nothing proceeds until they do.
# ==============================================================================
Write-Host ''
Write-Host '-- no client is pre-chosen --' -ForegroundColor Cyan
Reset-HostCatalog
Update-HostPage
$preTicked = @($script:HostRows | Where-Object { $_.Selected })
Check 'no client is ticked on a fresh page' ($preTicked.Count -eq 0) `
    $(if ($preTicked.Count) { 'ticked: ' + (($preTicked | ForEach-Object { $_.Id }) -join ', ') } else { 'none' })
$script:Page = $PG_CLIENTS
Check 'the wizard will not advance past the host page with nothing chosen' (-not (Test-CanAdvance))
# Asserted BEFORE Select-Hosts, which supplies a workspace of its own: the claim is
# about the state a fresh window is in, and a helper that fills the box first would
# have made it vacuous. The first draft of this block asserted it afterwards and
# reported the helper's value as the wizard's default.
Check 'the workspace box starts empty rather than pre-filled with a refused value' `
    (-not $els.ProjectDirBox.Text.Trim()) "box='$($els.ProjectDirBox.Text)'"
Reset-HostCatalog @('vscode')
Update-HostPage
Check 'and a per-project client with no workspace does not release Next' `
    (-not (Test-CanAdvance))
Check 'and the page asks for it rather than leaving an inert button' `
    ($els.ProjectDirNote.Text -match '(?i)repository you open in the editor') $els.ProjectDirNote.Text

Select-Hosts @('vscode')
Check 'choosing one client releases Next' (Test-CanAdvance)

# ------------------------------------------------------------------------------
# The workspace a per-project client needs, and the one value it must not be.
#
# Reported from a real install: the operator answered every question, pressed
# Install, and the engine stopped with "refusing to write a per-project host config
# into the installation directory". The window had pre-filled that box with the
# installation root -- the single value guaranteed to be refused -- and only warned
# about it, in amber, beside an enabled Next.
#
# A config written there is worse than one that fails: it VERIFIES GREEN and is
# never loaded, because these clients read the folder open in the editor.
# ------------------------------------------------------------------------------
foreach ($bad in @((Get-SuiteRoot), $ProjectRoot, $InstallerDir)) {
    $els.ProjectDirBox.Text = $bad
    Update-HostPage
    Check "a workspace that IS the installation is refused: $(Split-Path -Leaf $bad)" `
        (-not (Test-CanAdvance)) "still advanced with ProjectDir=$bad"
}
$els.ProjectDirBox.Text = (Get-SuiteRoot) + '\'
Update-HostPage
Check 'and a trailing separator does not get past the same rule' (-not (Test-CanAdvance))

$els.ProjectDirBox.Text = $WorkspaceDir
Update-HostPage
Check 'a real workspace releases Next' (Test-CanAdvance) "ProjectDir=$WorkspaceDir"
Check 'and the page stops objecting once it is one' `
    ($els.ProjectDirNote.Text -notmatch '(?i)part of the installation') $els.ProjectDirNote.Text

# The window and the engine must answer this the same way, or the window lets
# through what the run refuses -- which is exactly what was reported.
Check 'the window uses the engine''s rule rather than its own copy' `
    ((Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'Install-BConnectMcp-UI.ps1') -Raw) `
        -match 'Test-ProjectDirIsInstallation')
Check 'and the engine calls the same function rather than testing inline' `
    ((Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'Install-BConnectMcp.ps1') -Raw) `
        -match 'Test-ProjectDirIsInstallation')

Select-Hosts @('vscode')

# ==============================================================================
# Part 3: what the installer is actually handed. This is INST-01/CN-01: the
# wizard used to build its parameter set with no Hosts key at all, so every GUI
# install wrote one file for one vendor.
# ==============================================================================
Write-Host ''
Write-Host '-- the parameters the installer is given --' -ForegroundColor Cyan
Select-Hosts @('vscode', 'n8n')
$p = New-InstallerParameters 'install'
Check 'the parameter set carries a Hosts key' ($p.ContainsKey('Hosts')) ("keys: " + (($p.Keys | Sort-Object) -join ', '))
Check 'Hosts names exactly the clients that were ticked' `
    ($p['Hosts'] -eq 'vscode,n8n') "Hosts=$($p['Hosts'])"
Check 'a per-project client sends its project directory through' `
    ($p['ProjectDir'] -eq $WorkspaceDir) "ProjectDir=$($p['ProjectDir'])"

Select-Hosts @('vscode')
$p = New-InstallerParameters 'install'
Check 'ConfigPath is NOT passed when Claude Desktop was not chosen' (-not $p.ContainsKey('ConfigPath')) `
    $(if ($p.ContainsKey('ConfigPath')) { "ConfigPath=$($p['ConfigPath'])" } else { 'absent' })
Check 'no Claude Desktop id leaks into Hosts when it was not chosen' `
    ($p['Hosts'] -notmatch 'claude-desktop') "Hosts=$($p['Hosts'])"

Select-Hosts @('claude-desktop')
$p = New-InstallerParameters 'install'
Check 'ConfigPath IS passed when Claude Desktop was chosen' `
    ($p.ContainsKey('ConfigPath') -and $p['ConfigPath'] -eq $PresentCfg) "ConfigPath=$($p['ConfigPath'])"

Select-Hosts @('claude-code', 'cursor')
$p = New-InstallerParameters 'verify'
Check 'a verify-only run is scoped to the chosen clients too' `
    ($p.ContainsKey('VerifyOnly') -and $p['Hosts'] -eq 'claude-code,cursor') "Hosts=$($p['Hosts'])"

Reset-HostCatalog
Update-HostPage
$p = New-InstallerParameters 'verify'
Check 'with nothing chosen no Hosts key is invented; the installer keeps its own default' `
    (-not $p.ContainsKey('Hosts'))

# ==============================================================================
# Part 4: the equivalent console command is the same mapping, not a second one.
# ==============================================================================
Write-Host ''
Write-Host '-- the equivalent console command --' -ForegroundColor Cyan
Select-Hosts @('vscode', 'open-webui')
$script:Page = $PG_REVIEW
Build-Review
$cmd = $els.txtEquivalent.Text
Check 'the console command shows -Hosts with the chosen ids' `
    ($cmd -match '-Hosts vscode,open-webui') $cmd
Check 'the console command shows the gateway an HTTP-only client forces on' `
    ($cmd -match '-Gateway ') ''
Check 'the review page shows the schema-only honesty statement' `
    ($els.hostHonesty.Visibility -eq 'Visible' -and $els.lblHostHonesty.Text -match 'SHAPE ONLY') `
    $els.lblHostHonesty.Text

# ==============================================================================
# Part 5: a client that is not on this machine.
# ==============================================================================
Write-Host ''
Write-Host '-- a chosen client that is not installed here --' -ForegroundColor Cyan
Select-Hosts @('claude-desktop') -ConfigPath $AbsentCfg
$row = @($script:HostRows | Where-Object { $_.Id -eq 'claude-desktop' })[0]
Check 'the row knows the destination directory is not on this machine' (-not $row.HereNow) "path=$($row.Path)"
Check 'the row says so in words, not just a colour' `
    ($row.PresenceText -match 'Nothing exists at' -and $row.PresenceVis -eq 'Visible') $row.PresenceText
Check 'the page raises the missing-client warning' `
    ($els.MissingHostWarning.Visibility -eq 'Visible' -and $els.MissingHostText.Text -match 'Not found on this machine') `
    $els.MissingHostText.Text
$p = New-InstallerParameters 'install'
Check 'it is still passed through, not silently dropped -- the operator was told, and decides' `
    ($p['Hosts'] -eq 'claude-desktop')

Select-Hosts @('claude-desktop') -ConfigPath $PresentCfg
Check 'the warning clears when the destination is there' `
    ($els.MissingHostWarning.Visibility -eq 'Collapsed' -and (@($script:HostRows | Where-Object { $_.Id -eq 'claude-desktop' })[0]).HereNow)

Select-Hosts @('vscode') -ProjectDir $GhostDir
Check 'a per-project client with no such project directory is flagged as well' `
    ($els.MissingHostWarning.Visibility -eq 'Visible')

# ==============================================================================
# Part 6: the gateway, and the per-target path fields.
# ==============================================================================
Write-Host ''
Write-Host '-- gateway and path fields follow the selection --' -ForegroundColor Cyan
Select-Hosts @('claude-desktop')
Check 'the gateway panel is hidden for a client that spawns a process' `
    ($els.GatewayPanel.Visibility -eq 'Collapsed')
# Not merely the panel: the WHOLE gateway question is off the page unless something
# in the selection requires it. A workstation install of a client that starts a
# local process is the commonest run there is, and it has no gateway decision in it.
Check 'and so is the whole gateway section, not just its detail panel' `
    ($els.GatewaySection.Visibility -eq 'Collapsed') `
    "section=$($els.GatewaySection.Visibility)"
Check 'the opt-in for a client the registry does not name is reachable, under Advanced' `
    ($els.GatewayAdvanced.Visibility -eq 'Visible' -and -not $els.GatewayAdvanced.IsExpanded -and
     $null -ne $els.GatewayOptInCheck -and -not $els.GatewayOptInCheck.IsChecked) `
    "advanced=$($els.GatewayAdvanced.Visibility) expanded=$($els.GatewayAdvanced.IsExpanded)"
# The opt-in DRIVES the one value the parameter mapping reads. If it ever became a
# second answer instead, this would keep passing while the install disagreed.
$els.GatewayOptInCheck.IsChecked = $true
Check 'ticking it turns the gateway on and brings the section back' `
    ([bool]$els.GatewayWantedCheck.IsChecked -and $els.GatewaySection.Visibility -eq 'Visible' -and
     (New-InstallerParameters 'install').ContainsKey('Gateway')) `
    "wanted=$($els.GatewayWantedCheck.IsChecked) section=$($els.GatewaySection.Visibility)"
$els.GatewayOptInCheck.IsChecked = $false
Check 'and unticking it takes the gateway back off' `
    ((-not $els.GatewayWantedCheck.IsChecked) -and $els.GatewaySection.Visibility -eq 'Collapsed' -and
     -not (New-InstallerParameters 'install').ContainsKey('Gateway'))
Check 'the Claude Desktop path box appears only when that client is chosen' `
    ($els.ConfigPathRow.Visibility -eq 'Visible')
Check 'the project directory box stays hidden for a client that does not use one' `
    ($els.ProjectPathRow.Visibility -eq 'Collapsed')

Select-Hosts @('n8n')
Check 'an HTTP-only client turns the gateway on: it cannot spawn a process' `
    ($els.GatewayPanel.Visibility -eq 'Visible' -and [bool]$els.GatewayWantedCheck.IsChecked -and
     $els.GatewaySection.Visibility -eq 'Visible')
Check 'and the Advanced opt-in disappears, because there is nothing left to opt into' `
    ($els.GatewayAdvanced.Visibility -eq 'Collapsed')
Check 'and the operator cannot untick a gateway that is required' `
    (-not $els.GatewayWantedCheck.IsEnabled)
Check 'the Claude Desktop path box is hidden when that client is not chosen' `
    ($els.ConfigPathRow.Visibility -eq 'Collapsed')
$p = New-InstallerParameters 'install'
Check 'the gateway reaches the installer as parameters, bind and port included' `
    ($p.ContainsKey('Gateway') -and $p['GatewayBind'] -eq '127.0.0.1' -and $p['GatewayPort'] -eq 3001) `
    "bind=$($p['GatewayBind']) port=$($p['GatewayPort'])"
Check 'SEC-7: neither token checkbox ships ticked' `
    ((-not $els.GatewayNoAuthCheck.IsChecked) -and (-not $els.GatewayRotateTokenCheck.IsChecked))

Select-Hosts @('vscode') -ProjectDir $RealDir
Check 'the project directory box appears for a per-project client' `
    ($els.ProjectPathRow.Visibility -eq 'Visible')
Select-Hosts @('vscode') -ProjectDir $ProjectRoot
Check 'and says so when it still points at the installer''s own parent' `
    ($els.ProjectDirNote.Text -match 'not a workspace') $els.ProjectDirNote.Text

# ==============================================================================
# Part 6b: a gateway-requiring client implies the WHOLE gateway.
#
# The defect: these four targets could be selected and the wizard completed with the
# gateway configured but never started, so the operator was handed a URL and a bearer
# token for an endpoint that was not listening. The manual step has to shrink to
# "paste two values", which means the run itself configures the service, generates
# the token, starts it and verifies it responds. The rule lives in exactly one place
# -- ConvertTo-HostInstallerParameters -- and these assertions read it back out of
# what the installer is actually handed.
# ==============================================================================
Write-Host ''
Write-Host '-- an HTTP-only client implies the gateway, started and verified --' -ForegroundColor Cyan

foreach ($id in @('copilot-studio', 'openai', 'n8n', 'open-webui')) {
    Select-Hosts @($id)
    $gp = New-InstallerParameters 'install'
    Check "selecting $id configures the gateway and starts it in the same run" `
        ($gp.ContainsKey('Gateway') -and $gp.ContainsKey('StartGateway')) `
        (($gp.Keys | Sort-Object) -join ', ')
    # Aimed at the RULE and not at the checkbox that displays it. The mapping
    # function is handed exactly what a caller who ticked nothing would hand it --
    # no -Gateway, no -StartGateway -- and must still reach both conclusions from
    # the registry alone. Without this, the wizard's own forcing of the checkbox
    # keeps the assertion above green while the single implementation of the rule
    # has been removed, which is the parallel-copy defect this project keeps
    # finding.
    $direct = ConvertTo-HostInstallerParameters -Selected @($id) `
                  -ProjectDir $RealDir -HostOutDir $HostOutDir -ConfigPath $PresentCfg
    Check "the mapping function reaches that on its own for $id, with nothing ticked" `
        ($direct.Parameters.ContainsKey('Gateway') -and $direct.Parameters.ContainsKey('StartGateway') -and
         $direct.GatewayRequired) `
        (($direct.Parameters.Keys | Sort-Object) -join ', ')
}
# And the negative for the same function: a client that spawns a process gets
# neither, so the rule is the registry field and not "always on".
$directLocal = ConvertTo-HostInstallerParameters -Selected @('claude-desktop') `
                   -ProjectDir $RealDir -HostOutDir $HostOutDir -ConfigPath $PresentCfg
Check 'and reaches the opposite conclusion for a client that spawns a local process' `
    (-not $directLocal.Parameters.ContainsKey('Gateway') -and
     -not $directLocal.Parameters.ContainsKey('StartGateway') -and -not $directLocal.GatewayRequired) `
    (($directLocal.Parameters.Keys | Sort-Object) -join ', ')
Select-Hosts @('n8n')
Check 'the start-and-verify box agrees with that, and cannot be unticked' `
    ([bool]$els.StartGatewayCheck.IsChecked -and -not $els.StartGatewayCheck.IsEnabled) `
    "checked=$($els.StartGatewayCheck.IsChecked) enabled=$($els.StartGatewayCheck.IsEnabled)"
$hp = (Get-Answers).HostParams
Check 'the equivalent console command carries -StartGateway too, so the two runs match' `
    ($hp.ConsoleCommand -match '-StartGateway') $hp.ConsoleCommand
Check 'the exact URL to paste is composed once, from the same bind and port' `
    ($hp.GatewayUrl -eq ('http://{0}:{1}' -f $els.GatewayBindBox.Text, $els.GatewayPortBox.Text)) $hp.GatewayUrl

# What the operator is left with: two values, and a statement that the thing they
# address is already running.
$script:RunKind = 'install'
$script:LastResult = $null
$script:GatewayTokenResult = [pscustomobject]@{
    token = 'EXAMPLE-TOKEN-VALUE'; header = 'Authorization: Bearer EXAMPLE-TOKEN-VALUE'
    storedIn = (Join-Path $RealDir 'bconnect.env'); state = 'GENERATED'; rotated = $false
}
$gwSummary = Get-CompletionSummaryText
Check 'the completion summary presents the URL to paste, per enabled server' `
    ($gwSummary -match [regex]::Escape($hp.GatewayUrl + '/')) `
    (($gwSummary -split "`r?`n" | Where-Object { $_ -match 'URL to paste' }) -join '')
Check 'and the Authorization header to paste beside it' `
    ($gwSummary -match 'Header to paste on every call: Authorization: Bearer ') `
    (($gwSummary -split "`r?`n" | Where-Object { $_ -match 'Header to paste' }) -join '')
Check 'and states that the service those two values address is already running' `
    ($gwSummary -match '(?i)started and verified in this run')
Check 'so the manual step for that client is a paste, not a deployment' `
    ($gwSummary -match '(?i)that is two values' -and $gwSummary -match '(?i)already running') `
    (($gwSummary -split "`r?`n" | Where-Object { $_ -match 'two values' }) -join '')
$script:GatewayTokenResult = $null

# And the negative: a client that starts a local process pulls none of this in.
Select-Hosts @('claude-desktop')
$np = New-InstallerParameters 'install'
Check 'a client that spawns a local process still gets no gateway and no listening port' `
    (-not $np.ContainsKey('Gateway') -and -not $np.ContainsKey('StartGateway')) `
    (($np.Keys | Sort-Object) -join ', ')
Check 'and the start-and-verify box is released again rather than left ticked and greyed' `
    ((-not $els.StartGatewayCheck.IsChecked) -and $els.StartGatewayCheck.IsEnabled) `
    "checked=$($els.StartGatewayCheck.IsChecked) enabled=$($els.StartGatewayCheck.IsEnabled)"

# ==============================================================================
# Part 7: what the operator is told at the end. The old text was one vendor's
# tray icon, printed after every install regardless of what was configured.
# ==============================================================================
Write-Host ''
Write-Host '-- the finishing instructions --' -ForegroundColor Cyan
# Through Finish-Run, not by calling the text builder directly: the defect this
# replaces was a hard-coded string at that call site, and a guard aimed at the
# builder alone would not have seen it.
function Show-Finish {
    $script:RunKind = 'install'
    $script:LastResult = $null
    $script:GatewayTokenResult = $null
    Finish-Run $false
    return $els.lblRunSub.Text
}
Select-Hosts @('vscode', 'n8n')
$done = Show-Finish
Check 'the finishing text names the clients that were configured' `
    ($done -match 'VS Code' -and $done -match 'n8n') $done
Check 'it does not tell an operator with no Claude Desktop to quit Claude Desktop' `
    ($done -notmatch 'Claude Desktop')
$summary = Get-CompletionSummaryText
Check 'the completion summary tells the operator to restart the client that was configured' `
    ($summary -match 'VS Code[^\r\n]*close it and start it again') `
    (($summary -split "`r?`n" | Where-Object { $_ -match 'VS Code' }) -join ' / ')
Select-Hosts @('claude-desktop')
$done = Show-Finish
Check 'Claude Desktop gets its tray-icon quit, and only when it was chosen' `
    ((Get-CompletionSummaryText) -match '(?s)Claude Desktop: quit it from the tray icon') `
    ((Get-CompletionSummaryText) -split "`r?`n" | Where-Object { $_ -match 'tray icon' })

# ==============================================================================
# Part 8: no single-vendor field left in the always-visible chrome.
# ==============================================================================
Write-Host ''
Write-Host '-- the chrome is client-neutral --' -ForegroundColor Cyan
Check 'the window XAML no longer carries a hard-coded Claude Desktop field' `
    ($xaml.OuterXml -notmatch '(?i)CLAUDE DESKTOP CONFIGURATION') ''
Check 'the paths page has no client configuration box at all' `
    ($null -eq $win.FindName('txtConfig'))

# ==============================================================================
# Part 9: INST-09. The preflight the operator sees, and the two host conditions
# the window cannot run without.
# ==============================================================================
Write-Host ''
Write-Host '-- pre-flight --' -ForegroundColor Cyan
# The machine-level rows never belonged beside the install location: they are
# properties of the computer, not of the path. They are answered once, by
# Get-RequirementChecks, and surfaced only when they fail -- asserted there by
# Test-WizardPrep.ps1. What is checked here is that they went to exactly one of the
# two places, which is the same assertion as before the requirements page was
# removed; only the second place changed.
$script:Page = $PG_REVIEW
Set-Preflight
$pf = @($els.preflight.Children | ForEach-Object { $_.Children[1].Text })
$reqs = @(Get-RequirementChecks)
Check 'elevation is reported once, by the requirement checks, not beside the install location' `
    (@($reqs | Where-Object { $_.Name -eq 'Administrator rights' }).Count -eq 1 -and
     @($pf | Where-Object { $_ -match 'elevated' }).Count -eq 0) `
    (($pf -join ' / '))
Check 'how many supported clients are on this machine is reported once, and with a remedy' `
    (@($reqs | Where-Object { $_.Name -match 'MCP clients' -and $_.Remedy }).Count -eq 1 -and
     @($pf | Where-Object { $_ -match 'MCP clients detected' }).Count -eq 0) `
    (($reqs | Where-Object { $_.Name -match 'MCP clients' } | ForEach-Object { $_.Detail }) -join ' / ')
Check 'the review preflight still answers what is on disk at the install location' `
    (@($pf | Where-Object { $_ -match 'suite root' }).Count -gt 0) (($pf | Select-Object -First 1))

# The window itself, launched the wrong way. The console host defaults to STA, so
# -MTA is what it takes to reproduce what PowerShell 7 -- and any caller that starts
# a runspace of its own -- hands the wizard by default. -TestHeadless suppresses the
# message box so this cannot block on a machine with nobody in front of it; the
# console text and the exit code are what an operator gets either way.
# A child that does NOT refuse writes its WPF exception to stderr, which under this
# script's Stop preference would end the run instead of failing the check. The whole
# point is to observe that case, so the preference steps aside for the call.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$mta = & powershell.exe -NoProfile -ExecutionPolicy Bypass -MTA -File $UiScript -TestHeadless 2>&1
$mtaExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
$mtaText = ($mta | Out-String)
Check 'launching the wizard on an MTA thread refuses, rather than failing inside WPF' `
    ($mtaExit -eq 2) "exit $mtaExit"
Check 'and the refusal carries the exact command that works' `
    ($mtaText -match '(?i)-Sta' -and $mtaText -match '(?i)MTA') ($mtaText.Trim() -split "`r?`n" | Where-Object { $_ -match '-Sta' } | Select-Object -First 1)

Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host ("  $script:Pass passed, $script:Fail failed") -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
Write-Host '  Not proven by this script: that a real MCP client then loads what was written.' -ForegroundColor DarkGray
Write-Host '  The badge on each row is where that claim is made, or deliberately not made.' -ForegroundColor DarkGray
Write-Host ''
if ($script:Fail) { exit 1 }
exit 0
