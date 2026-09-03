<#
.SYNOPSIS
    Tests for the settings window: that it changes nothing itself, that what it does
    change goes through the verb front end, and that it says what has to be restarted.

.DESCRIPTION
    Built the same way as Test-WizardHosts.ps1 next to it: it dot-sources the REAL
    Manage-BConnectMcp.ps1 with -TestHeadless, which builds and wires the actual
    window from the actual embedded XAML and then returns instead of calling
    ShowDialog(). Every assertion below reads that live object graph.

    It runs against a THROWAWAY installation, built here: a scratch secrets
    directory with a dummy API key and a base URL that does not resolve, and a
    scratch client configuration file with two servers in it. Nothing here reads,
    writes or touches the real credentials file, the real client configuration or
    the real installation record, and no call can reach a live bMS.

    What this proves:
      * every page builds, and shows exactly itself
      * NO CHANGE PATH WRITES A FILE. Two ways: the script carries no file-writing
        command at all, and every change any page can produce is a bconnect.ps1 verb
        from a closed list -- asserted as data, without dispatching anything
      * a host-configuration change can only carry the three capability-gate keys
        that lib\host-emitters.mjs allows there, and the audit level and the rate
        limiter are NOT among them: they go to the credentials file. The end-to-end
        case is run for real against the scratch tree and the written file is read
        back
      * the restart notice names the client that is actually configured, in that
        client's own terms, and never a client that is not
      * the three entry states are DETECTED, from the record and the filesystem, and
        the window opens on the right one: Status for a configured installation and
        for a machine with nothing on it, the finish for an installation this Windows
        account has not finished. Each is driven by building a real installation in
        that state and loading the real window against it -- never by setting a flag
      * the finish is a sequence over pages that already exist, it invokes the CLI
        for everything it changes, and it writes nothing itself
      * the tone rules hold across every string the window can show

    What it does NOT prove: that any of this looks right on a screen. Nobody has
    looked at it. Layout, spacing, DPI scaling and overflow are unverified by eye.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Test-ManageGui.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    Write-Host 'This test loads WPF and must run on an STA thread:' -ForegroundColor Yellow
    Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Test-ManageGui.ps1' -ForegroundColor Yellow
    exit 2
}

$ManageScript = Join-Path $PSScriptRoot '..\Manage-BConnectMcp.ps1'
$WizardScript = Join-Path $PSScriptRoot '..\Install-BConnectMcp-UI.ps1'
$EmittersFile = Join-Path $PSScriptRoot 'host-emitters.mjs'
foreach ($f in @($ManageScript, $WizardScript, $EmittersFile)) {
    if (-not (Test-Path -LiteralPath $f)) { throw "Not found: $f" }
}

Import-Module (Join-Path $PSScriptRoot 'Secrets.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'Dpapi.psm1')   -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'State.psm1')   -Force -DisableNameChecking

$script:Pass = 0
$script:Fail = 0
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}
function Group { param([string] $Name)
    Write-Host ''
    Write-Host ("-- $Name " + ('-' * [Math]::Max(0, 56 - $Name.Length))) -ForegroundColor Cyan
}

# Dummy values. None of these is a credential for anything, and the host does not resolve.
$DUMMY_KEY = 'dummy-api-key-0000-not-real'
$BAD_URL   = 'https://bms.invalid.example/bconnect'

$Root = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-manage-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

function New-Fixture {
<#
.SYNOPSIS
    A throwaway installation for one scenario: a credentials file, and a client
    configuration file carrying two of this suite's servers.
.DESCRIPTION
    -Client decides WHICH client file is written, which is the whole point of the
    restart-notice tests: the sentence has to follow the client, not a default.
#>
    param(
        [string] $Name,
        [ValidateSet('claude-desktop', 'vscode', 'n8n')] [string] $Client = 'claude-desktop',
        [switch] $NoJobsWrites,
        # A snippet client has no file any installer can read back, so an
        # installation carrying one can only be known from the record. Written with
        # State.psm1's own builder, because a record shape typed out here would be
        # the sixth parallel copy.
        [switch] $WithRecord,
        # What a baramundi machine-stage deployment leaves on an administrator's
        # workstation: the suite, and a record naming the clients the deployment
        # INTENDED -- and, for this Windows account, no credential and no client
        # configuration. Written with New-InstallationRecord's own -Stage /
        # -IntendedHosts parameters, so this fixture cannot drift from the record
        # shape the engine writes.
        [switch] $MachineStage,
        # The same, except a credential has since been written. The half where the
        # remaining work IS doable from this window: which clients, and write access.
        [switch] $CredentialOnly,
        # Nothing at all. No record, no credentials, no client configuration file.
        [switch] $Bare
    )
    $w = Join-Path $Root $Name
    $s = [ordered]@{
        Root       = $w
        SecretsDir = Join-Path $w 'secrets'
        ProjectDir = Join-Path $w 'project'
        HostOutDir = Join-Path $w 'out'
        StateFile  = Join-Path $w 'state\installation.json'
        ConfigPath = Join-Path $w 'claude\claude_desktop_config.json'
        Client     = $Client
    }
    New-Item -ItemType Directory -Force -Path $s.SecretsDir, $s.ProjectDir, $s.HostOutDir,
                                              (Split-Path -Parent $s.ConfigPath) | Out-Null
    Set-HardenedDirectoryAcl -Path $s.SecretsDir
    if (-not $MachineStage -and -not $Bare) {
        Write-SecretFileAtomic -Path (Join-Path $s.SecretsDir 'bconnect.env') `
            -Content (New-EnvFileContent -BaseUrl $BAD_URL -ApiKey $DUMMY_KEY)
    }

    # Nothing installed. The directories exist and are empty, which is the state a
    # machine that has never had this on it is in as far as any of these paths go.
    if ($Bare) { return [pscustomobject]$s }

    # The machine stage, and the machine stage plus a credential. Neither writes a
    # client configuration file: that is the whole of what distinguishes them from a
    # finished install, and the window has to detect it from the absence of the file
    # rather than from anything declared.
    if ($MachineStage -or $CredentialOnly) {
        $recServers = [ordered]@{
            'bconnect-endpoints' = @{ writeGate = $null; v11 = $false }
            'bconnect-jobs'      = @{ writeGate = $null; v11 = $false }
        }
        $rec = New-InstallationRecord -SuiteRoot (Get-Overrides ([pscustomobject]$s)).SuiteRootOverride `
                    -SecretsDir $s.SecretsDir -ProjectDir $s.ProjectDir -HostOutDir $s.HostOutDir `
                    -InstallerVersion 'test' -Servers $recServers -Hosts @() `
                    -Stage 'machine' -IntendedHosts @('claude-desktop', 'vscode')
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $s.StateFile) | Out-Null
        Write-InstallationRecord -Path $s.StateFile -Record $rec | Out-Null
        return [pscustomobject]$s
    }

    $jobsEnv = @{ ALLOW_WRITE_OPERATIONS = 'true'; ALLOWED_WRITE_TOOLS = 'create_job_instance,start_job_instance' }
    if ($NoJobsWrites) { $jobsEnv = @{ ALLOW_WRITE_OPERATIONS = 'false' } }
    $entries = [ordered]@{
        'bconnect-endpoints' = @{ command = 'node'; args = @('endpoints'); env = @{ ALLOW_WRITE_OPERATIONS = 'false' } }
        'bconnect-jobs'      = @{ command = 'node'; args = @('jobs');      env = $jobsEnv }
    }
    switch ($Client) {
        'claude-desktop' {
            @{ mcpServers = $entries } | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $s.ConfigPath -Encoding UTF8
            $s.HostFile = $s.ConfigPath
        }
        'vscode' {
            $p = Join-Path $s.ProjectDir '.vscode\mcp.json'
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
            @{ servers = $entries } | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $p -Encoding UTF8
            $s.HostFile = $p
        }
        'n8n' {
            # A snippet target, alongside a client that IS configured: the installer
            # cannot write n8n's configuration, so what exists on disk is the emitted
            # settings file in the installer's own out directory. Nothing can read
            # that back as a configuration, which is why this case needs a record --
            # and why the window has to describe such a client differently.
            $p = Join-Path $s.HostOutDir 'n8n.md'
            'Settings to apply in n8n. Not a file n8n reads.' | Set-Content -LiteralPath $p -Encoding UTF8
            @{ mcpServers = $entries } | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $s.ConfigPath -Encoding UTF8
            $s.HostFile = $s.ConfigPath
        }
    }
    if ($WithRecord) {
        $recHosts = @(@{ id = 'claude-desktop'; path = $s.ConfigPath; mode = 'merge-json'; entryHashes = @{} })
        if ($Client -eq 'n8n') {
            $recHosts += @{ id = 'n8n'; path = (Join-Path $s.HostOutDir 'n8n.md'); mode = 'snippet'; entryHashes = @{} }
        }
        $recServers = [ordered]@{
            'bconnect-endpoints' = @{ writeGate = @{ allow = $false; tools = @() }; v11 = $false }
            'bconnect-jobs'      = @{ writeGate = @{ allow = (-not $NoJobsWrites); tools = @('create_job_instance', 'start_job_instance') }; v11 = $false }
        }
        $rec = New-InstallationRecord -SuiteRoot (Get-Overrides ([pscustomobject]$s)).SuiteRootOverride `
                    -SecretsDir $s.SecretsDir -ProjectDir $s.ProjectDir -HostOutDir $s.HostOutDir `
                    -InstallerVersion 'test' -Servers $recServers -Hosts $recHosts
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $s.StateFile) | Out-Null
        Write-InstallationRecord -Path $s.StateFile -Record $rec | Out-Null
    }
    return [pscustomobject]$s
}

function Get-Overrides {
    param($Fixture)
    return @{
        StateFile          = $Fixture.StateFile
        SuiteRootOverride  = (Join-Path (Split-Path -Parent $PSScriptRoot) '..\bConnect-MCP-main')
        SecretsDirOverride = $Fixture.SecretsDir
        ProjectDirOverride = $Fixture.ProjectDir
        HostOutDirOverride = $Fixture.HostOutDir
        ConfigPathOverride = $Fixture.ConfigPath
    }
}

# Build the real window against one fixture, headless. A SCRIPTBLOCK invoked with the
# dot operator, not a function: dot-sourcing inside a function would put the window's
# functions and variables in that function's scope and they would be gone by the time
# anything here could assert on them. `. $LoadWindow $fixture` runs it right here.
$LoadWindow = {
    param($Fixture)
    $o = Get-Overrides $Fixture
    . $ManageScript -TestHeadless -StateFile $o.StateFile -SuiteRootOverride $o.SuiteRootOverride `
        -SecretsDirOverride $o.SecretsDirOverride -ProjectDirOverride $o.ProjectDirOverride `
        -HostOutDirOverride $o.HostOutDirOverride -ConfigPathOverride $o.ConfigPathOverride
}

function Invoke-DoEvents {
    # The window's change runner is a DispatcherTimer, and a dispatcher that nobody
    # pumps never ticks. Pushing a frame that ends itself at Background priority runs
    # everything already queued, which is what a real message loop does continuously.
    $frame = New-Object System.Windows.Threading.DispatcherFrame
    [void][System.Windows.Threading.Dispatcher]::CurrentDispatcher.BeginInvoke(
        [System.Windows.Threading.DispatcherPriority]::Background,
        [System.Windows.Threading.DispatcherOperationCallback] { param($f) $f.Continue = $false; return $null },
        $frame)
    [System.Windows.Threading.Dispatcher]::PushFrame($frame)
}

function Wait-Change {
    param([int] $TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Invoke-DoEvents
        if (-not $script:Running -and -not @($script:Queue).Count) { return $true }
        Start-Sleep -Milliseconds 80
    }
    return $false
}

Write-Host ''
Write-Host "Settings-window tests -- scratch tree: $Root" -ForegroundColor Cyan
Write-Host '  live bMS: never contacted. Base URL is a domain that does not resolve.' -ForegroundColor DarkGray

$started = Get-Date
try {

# =============================================================================
# 1. The window builds, and every page shows exactly itself.
# =============================================================================
Group 'the window builds'
$fx = New-Fixture -Name 'claude' -Client 'claude-desktop'
. $LoadWindow $fx

Check 'the real settings script built a Window without throwing' ($null -ne $win)
Check 'it read the installation through bconnect.ps1, not by itself' `
    ($null -eq $script:StatusError -and $null -ne $script:Status -and [bool]$script:Status.installed) `
    ("status error: " + $script:StatusError)
Check 'the status model carries the servers the client file declares' `
    ((@($script:Status.servers | ForEach-Object { $_.name }) -join ',') -eq 'bconnect-endpoints,bconnect-jobs') `
    ((@($script:Status.servers | ForEach-Object { $_.name + '=' + $_.writes }) -join ', '))

$walkOk = $true; $walkDetail = ''
for ($i = 0; $i -lt $script:PageCount; $i++) {
    $script:Page = $i
    try { Show-Page } catch { $walkOk = $false; $walkDetail = "page $i threw: $($_.Exception.Message)"; break }
    $visible = @(0..($script:PageCount - 1) | Where-Object { $els["page$_"].Visibility -eq 'Visible' })
    if ($visible.Count -ne 1 -or $visible[0] -ne $i) {
        $walkOk = $false; $walkDetail = "on page $i the visible pages were: $($visible -join ',')"; break
    }
}
Check 'every page builds and shows exactly itself' $walkOk $walkDetail
Check 'the rail has an entry per page, and a blurb for each' `
    ($PageTitles.Count -eq $script:PageCount -and $PageBlurbs.Count -eq $script:PageCount -and
     $els.rail.Children.Count -eq $script:PageCount) `
    ("pages $($script:PageCount), rail $($els.rail.Children.Count)")
Check 'the status page is rendered from the model, not from an empty panel' `
    ($els.statusList.Children.Count -ge 4) "cards: $($els.statusList.Children.Count)"

# =============================================================================
# 2. Nothing in this window writes anything. Two independent ways of asking.
# =============================================================================
Group 'no change path writes a file'

# (a) The script carries no file-writing command at all. Tokenised rather than
#     grepped, so a command named in a COMMENT cannot fail this and a command
#     hidden behind odd spacing cannot pass it.
$tokens = $null; $perr = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path -LiteralPath $ManageScript).Path, [ref]$tokens, [ref]$perr)
Check 'the settings script parses' (@($perr).Count -eq 0) (($perr | Select-Object -First 1 | ForEach-Object { $_.Message }))
$commandTokens = @($tokens | Where-Object { $_.TokenFlags -band [System.Management.Automation.Language.TokenFlags]::CommandName } |
                   ForEach-Object { [string]$_.Text })
$writers = @('Set-Content', 'Add-Content', 'Out-File', 'New-Item', 'Remove-Item', 'Move-Item', 'Copy-Item',
             'Rename-Item', 'Export-Csv', 'Export-Clixml', 'Write-SecretFileAtomic', 'Write-BConnectEnvStore',
             'Write-InstallationRecord', 'Merge-EnvText', 'Merge-EnvMap', 'New-EnvFileContent', 'Set-HardenedDirectoryAcl')
$found = @($commandTokens | Where-Object { $writers -contains $_ } | Select-Object -Unique)
Check 'the settings script invokes no file-writing command of any kind' ($found.Count -eq 0) `
    $(if ($found.Count) { 'found: ' + ($found -join ', ') } else { 'checked: ' + ($writers -join ', ') })
$text = Get-Content -LiteralPath $ManageScript -Raw
Check 'and no .NET file writer either' `
    (-not ($text -match '(?i)\[(System\.)?IO\.File\]::(Write|Append|Create|Move|Copy|Delete)')) ''
Check 'the only file it reads for itself is the server catalogue' `
    ((@([regex]::Matches($text, '(?i)Get-Content')).Count) -eq 1) `
    ("Get-Content occurrences: " + (@([regex]::Matches($text, '(?i)Get-Content')).Count))

# (b) Every change every page can build is a verb from the closed list. Read as
#     data: nothing is dispatched by any of this.
$script:Page = $PG_WRITES; Show-Page
$row = @($script:WriteRows | Where-Object { $_.Name -eq 'bconnect-jobs' })[0]
$row.Check.IsChecked = $false
$writeChanges = @(Get-WriteChanges)
$row.Check.IsChecked = $true
$els.txtServerFqdn.Text = 'bms2.invalid.example'
$script:Page = $PG_AUDIT; Show-Page
@($script:AuditRows | Where-Object { $_.Level -eq 'security' })[0].Radio.IsChecked = $true
$els.chkRate.IsChecked = $true; $els.txtRateMax.Text = '50'; $els.txtRateWindow.Text = '30000'
# EVERY builder, not a sample: if a page grows a change it has to grow a builder, and
# the wiring check below is what stops one being written inline in a click handler
# where nothing could read it.
$script:Page = $PG_CONN; Show-Page
$els.txtServerFqdn.Text = 'bms2.invalid.example'
$els.pwApiKey.Password = 'dummy-replacement-not-real'

# ---------------------------------------------------------------------------
# The address is composed here too, from the same shared code as the installer.
#
# This window READS what the installer WRITES, so if the two disagreed by a
# character -- /bConnect against /bconnect, a kept trailing slash -- opening this
# window on a healthy installation would show a "non-standard" address, or worse
# propose a different one and re-point a working estate at a bMS nobody chose.
# The assertion below is therefore about the FILE, not about matching behaviour:
# identical behaviour today is not a guarantee of identical behaviour tomorrow.
# ---------------------------------------------------------------------------
Group 'the bConnect address'

$sharedAddress = Join-Path $PSScriptRoot 'Address.ps1'
Check 'there is one implementation of what a bConnect address is' (Test-Path -LiteralPath $sharedAddress)
foreach ($w in @('Manage-BConnectMcp.ps1', 'Install-BConnectMcp-UI.ps1')) {
    $wt = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) $w) -Raw
    Check "$w loads it rather than carrying its own copy" `
        ($wt -match "(?i)Join-Path\s+\`$LibDir\s+'Address\.ps1'") ''
    Check "and does not restate the /bconnect suffix in its own code" `
        (-not ($wt -match "(?i)'https://'\s*\+")) 'a second composer is how the two forms drift apart'
}

$els.chkCustomUrl.IsChecked = $false
$els.txtServerFqdn.Text = 'bms2.invalid.example'
Check 'a server name composes the standard address' `
    ((Get-BaseUrl) -eq 'https://bms2.invalid.example/bconnect') "got '$(Get-BaseUrl)'"
Check 'and the line under the box states it' `
    ($els.lblComposedUrl.Text -match [regex]::Escape('https://bms2.invalid.example/bconnect')) $els.lblComposedUrl.Text
Check 'and it is what "Change base URL" would write' `
    ((Get-UrlChange).Params['Rest'][0] -eq 'https://bms2.invalid.example/bconnect')

$els.txtServerFqdn.Text = 'https://bms2.invalid.example/bconnect'
Check 'a pasted URL is reduced to its host here too' `
    ((Get-BaseUrl) -eq 'https://bms2.invalid.example/bconnect') "got '$(Get-BaseUrl)'"

$els.txtServerFqdn.Text = 'bms2.invalid.example'
$els.chkCustomUrl.IsChecked = $true
$els.txtBaseUrl.Text = 'https://bms2.invalid.example/other/bconnect'
Check 'the full-address box wins when it is in use, and is not merged' `
    ((Get-BaseUrl) -eq 'https://bms2.invalid.example/other/bconnect') "got '$(Get-BaseUrl)'"
Check 'and the panel holding it is visible' ($els.pnlCustomUrl.Visibility -eq 'Visible')
Check 'and that is what would be written' `
    ((Get-UrlChange).Params['Rest'][0] -eq 'https://bms2.invalid.example/other/bconnect')
$els.chkCustomUrl.IsChecked = $false
Check 'clearing it collapses the panel and restores the composed address' `
    ($els.pnlCustomUrl.Visibility -eq 'Collapsed' -and (Get-BaseUrl) -eq 'https://bms2.invalid.example/bconnect')

# An address only counts as standard if it recomposes EXACTLY. Same decision, same
# function, as the installer makes on load.
Check 'a stored standard address recomposes exactly, so it shows as a server name' `
    ((Get-ComposedBaseUrl 'https://bms2.invalid.example/bconnect') -eq 'https://bms2.invalid.example/bconnect')
Check 'a stored address under another virtual directory does not, so it stays whole' `
    ((Get-ComposedBaseUrl 'https://bms2.invalid.example/other/bconnect') -ne 'https://bms2.invalid.example/other/bconnect')

$script:Page = $PG_V11; Show-Page
$els.txtV11User.Text = 'svc-bconnect@example.local'
$els.pwV11.Password = 'dummy-v11-not-real'
$script:Page = $PG_AUDIT; Show-Page
@($script:AuditRows | Where-Object { $_.Level -eq 'security' })[0].Radio.IsChecked = $true
$els.chkRate.IsChecked = $true; $els.txtRateMax.Text = '50'; $els.txtRateWindow.Text = '30000'

$everyChange = @($writeChanges) + @(
    Get-WritesOffChange
    Get-UrlChange
    Get-CredentialChange
    Get-VerifyChange
    Get-V11Change
    Get-V11RemoveChange
    Get-AuditChange
    Get-RateChange
    Get-ResyncChange
    Get-ClientChange 'claude-desktop'
)
$everyChange = @($everyChange | Where-Object { $_ })
Check 'every page''s change builder produced something to assert on' `
    ($everyChange.Count -ge 11) ("changes built: " + $everyChange.Count)

Check 'every change a page produces names a verb' `
    (@($everyChange | Where-Object { -not $_.Params['Verb'] }).Count -eq 0)
$verbs = @($everyChange | ForEach-Object { [string]$_.Params['Verb'] } | Select-Object -Unique)
Check 'and every one of those verbs is on the closed list' `
    (@($verbs | Where-Object { $VERBS_ALLOWED -notcontains $_ }).Count -eq 0) ("verbs: " + ($verbs -join ', '))
Check 'every change also states when it takes effect (its scope)' `
    (@($everyChange | Where-Object { @('host','credentials','none') -notcontains $_.Scope }).Count -eq 0) `
    ((@($everyChange | ForEach-Object { $_.Scope }) -join ', '))
Check 'and every change carries the sentence that describes it' `
    (@($everyChange | Where-Object { -not $_.What }).Count -eq 0)
# A secret travels as a SecureString parameter object or not at all. Nothing that
# could be a plaintext credential may sit in a parameter set at all.
$credChange = @($everyChange | Where-Object { $_.Params['Object'] -eq 'credential' })[0]
Check 'a credential change carries a SecureString, never a string' `
    ($credChange.Params['ApiKeySecure'] -is [System.Security.SecureString]) `
    ($credChange.Params['ApiKeySecure'].GetType().Name)
Check 'and its description does not contain the value' `
    ($credChange.What -notmatch 'dummy-replacement') $credChange.What
$v11Change = @($everyChange | Where-Object { $_.Params['Object'] -eq 'v11-credential' })[0]
Check 'so does a v1.1 credential change' `
    ($v11Change.Params['V11PassSecure'] -is [System.Security.SecureString] -and
     $v11Change.Params['V11User'] -eq 'svc-bconnect@example.local')

# The wiring section builds no change of its own. That is what makes "every change is
# a verb from the closed list" a statement about the whole window rather than about
# the builders somebody remembered to write.
$wiring = ($text -split '(?m)^# Wiring\s*$')[-1]
Check 'the wiring section dispatches changes and constructs none' `
    (-not ($wiring -match 'New-Change')) `
    ("New-Change in wiring: " + (@([regex]::Matches($wiring, 'New-Change')).Count))
Check 'and the wiring section is really the tail of the file' `
    ($wiring.Length -gt 400 -and $wiring -match 'ShowDialog') ("wiring chars: " + $wiring.Length)

# (c) The dispatcher itself refuses anything else, rather than trusting the pages.
$script:Refused = $null
Start-Queue @((New-Change -Params @{ Verb = 'uninstall' } -What 'A verb this window does not offer.' -Scope 'none'))
Check 'the dispatcher refuses a verb that is not on the list' ($script:Refused -eq 'uninstall') `
    ("refused: " + $script:Refused)
Check 'and refusing dispatched nothing' (-not $script:Running -and @($script:Done).Count -eq 0)

# =============================================================================
# 3. A host configuration may carry capability gates and nothing else.
# =============================================================================
Group 'a host config carries only the three gate keys'
$emitters = Get-Content -LiteralPath $EmittersFile -Raw
$m = [regex]::Match($emitters, 'HOST_CONFIG_ENV_ALLOWLIST\s*=\s*new\s+Set\(\[(?<body>[^\]]*)\]')
$allowlist = @()
if ($m.Success) {
    $allowlist = @([regex]::Matches($m.Groups['body'].Value, "'([A-Z0-9_]+)'") | ForEach-Object { $_.Groups[1].Value })
}
Check 'the allowlist was read out of lib\host-emitters.mjs' ($allowlist.Count -gt 0) ($allowlist -join ', ')
Check 'the window''s copy of it is the same list, in the same order' `
    ((($HOST_CONFIG_KEYS) -join ',') -eq (($allowlist) -join ',')) `
    ("window: " + ($HOST_CONFIG_KEYS -join ',') + "   emitters: " + ($allowlist -join ','))
Check 'the audit level is NOT one of them, so it cannot reach a client configuration' `
    ($HOST_CONFIG_KEYS -notcontains 'BCONNECT_AUDIT_LEVEL')
$auditChange = Get-AuditChange
$rateChange  = Get-RateChange
Check 'the audit change is a credentials-file change, routed through `set`' `
    ($auditChange.Params['Verb'] -eq 'set' -and $auditChange.Params['Object'] -eq 'audit' -and $auditChange.Scope -eq 'credentials') `
    ("$($auditChange.Params['Verb']) $($auditChange.Params['Object']) -> $($auditChange.Scope)")
Check 'the rate-limit change is too' `
    ($rateChange.Params['Verb'] -eq 'set' -and $rateChange.Params['Object'] -eq 'rate-limit' -and $rateChange.Scope -eq 'credentials')
# -cmatch, not -match: PowerShell's regex operator is case-insensitive by default, so
# 'Rest' matches ^[A-Z0-9_]+$ and this check would pass against anything at all.
Check 'no change carries a raw environment key of any kind' `
    (@($everyChange | Where-Object { @($_.Params.Keys) -cmatch '^[A-Z][A-Z0-9_]*$' }).Count -eq 0) `
    ((@($everyChange | ForEach-Object { @($_.Params.Keys) -join '+' }) -join ' / '))

# The end-to-end case, and it is a GRANT rather than a removal: removing the gate
# empties the env block, so a check that the block carries only allowlisted keys
# would pass against nothing at all. Granting puts two keys in it, which is the
# state worth asserting. It is run against bconnect-jobs because that is the one
# server in lib\catalog.json whose gate can be narrowed to named tools.
$script:Page = $PG_WRITES; Show-Page
$row = @($script:WriteRows | Where-Object { $_.Name -eq 'bconnect-jobs' })[0]
Check 'the narrowable server offers its write tools as choices' `
    ($row.CanNarrow -and @($row.ToolChecks).Count -gt 1) ("tool boxes: " + @($row.ToolChecks).Count)
foreach ($tc in $row.ToolChecks) { $tc.Check.IsChecked = $false }
$oneTool = $row.ToolChecks[0].Tool
$row.ToolChecks[0].Check.IsChecked = $true
$row.Check.IsChecked = $true
$els.txtConfirm.Text = 'ENABLE WRITES'
Update-WritePage
$pending = @(Get-WriteChanges)
Check 'the pending grant is one verb naming that one tool' `
    ($pending.Count -eq 1 -and (@($pending[0].Params['Rest']) -join ' ') -eq "bconnect-jobs $oneTool") `
    ("pending: " + (@($pending | ForEach-Object { (@($_.Params['Rest']) -join ' ') }) -join ' ;; '))
Start-Queue $pending
$finished = Wait-Change
Check 'a real write-gate change ran to completion through bconnect.ps1' `
    ($finished -and @($script:Done).Count -eq 1) `
    ("done: " + (@($script:Done | ForEach-Object { $_.Change.What + ' failed=' + $_.Failed }) -join '; '))
# The verb's own status, reported as it came back. In this scratch tree the engine
# exits non-zero because Step 9 verification cannot start servers that were never
# built -- which is correct, and is exactly why the window must report what the verb
# returned rather than assume a run that reached the end succeeded.
$doneOne = @($script:Done)[0]
Check 'the window reports the verb''s own exit status, not an assumption' `
    ($null -ne $doneOne.Code -and ([bool]$doneOne.Failed -eq ([int]$doneOne.Code -ne 0))) `
    ("exit $($doneOne.Code), reported failed=$($doneOne.Failed)")
$paneText = (($els.console.Inlines | ForEach-Object { $_.Text }) -join '')
Check 'the verb''s real output is in the pane, not a summary of it' `
    ($paneText -match 'bconnect\.ps1 writes enable bconnect-jobs' -and
     (@($paneText -split "`n").Count -gt 20)) `
    ("pane lines: " + (@($paneText -split "`n").Count))
$cfg = Get-Content -LiteralPath $fx.HostFile -Raw | ConvertFrom-Json
$jobsEnv = $cfg.mcpServers.'bconnect-jobs'.env
$envKeys = @()
if ($jobsEnv) { $envKeys = @($jobsEnv.PSObject.Properties | ForEach-Object { $_.Name }) }
Check 'the entry it wrote carries env keys at all, so the next check is not vacuous' `
    ($envKeys.Count -ge 2) ("env keys: " + ($envKeys -join ', '))
Check 'and every one of them is on the allowlist' `
    (@($envKeys | Where-Object { $HOST_CONFIG_KEYS -notcontains $_ }).Count -eq 0) `
    ("env keys: " + ($envKeys -join ', '))
Check 'the gate is on, narrowed to the one tool that was ticked' `
    ($jobsEnv.ALLOW_WRITE_OPERATIONS -eq 'true' -and $jobsEnv.ALLOWED_WRITE_TOOLS -eq $oneTool) `
    ("ALLOW_WRITE_OPERATIONS=$($jobsEnv.ALLOW_WRITE_OPERATIONS) ALLOWED_WRITE_TOOLS=$($jobsEnv.ALLOWED_WRITE_TOOLS)")
Check 'no credential reached the client configuration file' `
    (-not ((Get-Content -LiteralPath $fx.HostFile -Raw) -match [regex]::Escape($DUMMY_KEY)))
Check 'nor did the audit level or any other credentials-file key' `
    (-not ((Get-Content -LiteralPath $fx.HostFile -Raw) -match 'BCONNECT_AUDIT_LEVEL|BCONNECT_BASE_URL|BCONNECT_RATE_LIMIT'))
Check 'the page rebuilt itself from a fresh reading afterwards' `
    ((@($script:Status.servers | Where-Object { $_.name -eq 'bconnect-jobs' })[0]).writes -eq 'limited' -and
     (@($script:Status.servers | Where-Object { $_.name -eq 'bconnect-jobs' })[0]).writeTools.Count -eq 1) `
    ((@($script:Status.servers | ForEach-Object { $_.name + '=' + $_.writes }) -join ', '))

# =============================================================================
# 4. Granting write access is not one click.
# =============================================================================
Group 'granting write access takes a typed confirmation'
$script:Page = $PG_WRITES; Show-Page
$els.txtConfirm.Text = ''
Check 'the page just rebuilt from the installation produces no invocation at all' `
    (@(Get-WriteChanges).Count -eq 0) `
    ((@(Get-WriteChanges) | ForEach-Object { $_.What }) -join ' / ')
# Driven against bconnect-endpoints, which is read-only in the fixture AND cannot be
# narrowed: lib\catalog.json marks allowlist false, so this server reads
# ALLOW_WRITE_OPERATIONS and nothing else. Offering tick boxes for it would promise
# a narrowing the server does not implement, and the installer would then enable all
# 21 tools while the window said one. Observed, before this check existed.
$row = @($script:WriteRows | Where-Object { $_.Name -eq 'bconnect-endpoints' })[0]
Check 'a server with no per-tool allowlist offers no tool boxes' `
    ((-not $row.CanNarrow) -and @($row.ToolChecks).Count -eq 0) `
    ("CanNarrow=$($row.CanNarrow) boxes=$(@($row.ToolChecks).Count)")
$noNarrowText = (@($els.writeList.Children | ForEach-Object { $_.Child } | ForEach-Object {
                    @($_.Children | ForEach-Object { $_.Children } | ForEach-Object { $_.Child } |
                      Where-Object { $_ } | ForEach-Object { @($_.Children | ForEach-Object { [string]$_.Text }) }) }) -join ' ')
Check 'and says so, naming what write access would unlock instead' `
    ($noNarrowText -match 'no per-tool allowlist' -and $noNarrowText -match 'all 21 of its write tools') `
    ($noNarrowText.Substring(0, [Math]::Min(160, $noNarrowText.Length)))
$row.Check.IsChecked = $true
Update-WritePage
Check 'a grant raises the confirmation bar' ($els.confirmBar.Visibility -eq 'Visible')
Check 'and the bar states what write access permits, in those words' `
    ($els.lblConfirmWhat.Text -match 'create, modify and delete objects in the management suite') $els.lblConfirmWhat.Text
Check 'Apply is refused until the words are typed' (-not $els.btnApplyWrites.IsEnabled)
$els.txtConfirm.Text = 'enable writes'
Update-WritePage
Check 'and the check is case-sensitive' (-not $els.btnApplyWrites.IsEnabled)
$els.txtConfirm.Text = 'ENABLE WRITES'
Update-WritePage
Check 'typed exactly, Apply is released' ($els.btnApplyWrites.IsEnabled)
$grant = @(Get-WriteChanges)[0]
Check 'a server that cannot narrow asks for every write tool, explicitly' `
    ((@($grant.Params['Rest']) -contains '*')) ((@($grant.Params['Rest']) -join ' '))
Check 'and says so in words rather than leaving it to be inferred' `
    ($grant.What -match 'all \d+ write tools') $grant.What
# The narrowable server, from the same page: ticking one tool has to reach the verb.
$jobsRow = @($script:WriteRows | Where-Object { $_.Name -eq 'bconnect-jobs' })[0]
foreach ($tc in $jobsRow.ToolChecks) { $tc.Check.IsChecked = $false }
$jobsRow.ToolChecks[1].Check.IsChecked = $true
$jobsGrant = @(Get-WriteChanges | Where-Object { @($_.Params['Rest'])[0] -eq 'bconnect-jobs' })[0]
Check 'ticking one tool on a narrowable server narrows the request to that tool' `
    ((@($jobsGrant.Params['Rest']) -notcontains '*') -and
     (@($jobsGrant.Params['Rest']) -contains $jobsRow.ToolChecks[1].Tool)) `
    ((@($jobsGrant.Params['Rest']) -join ' '))
Show-Page
Check 'and putting the page back as the installation has it clears the request' `
    (@(Get-WriteChanges).Count -eq 0) `
    ((@(Get-WriteChanges) | ForEach-Object { $_.What }) -join ' / ')

# =============================================================================
# 5. The restart notice names the client that is actually configured.
# =============================================================================
Group 'the restart notice names the right client'
$hostNotice = (@(Get-RestartNotice 'host') -join ' ')
$credNotice = (@(Get-RestartNotice 'credentials') -join ' ')
Check 'with Claude Desktop configured, it is named' ($hostNotice -match 'Claude Desktop') $hostNotice
Check 'and gets its tray-icon quit, which no other client gets' ($hostNotice -match 'tray icon')
Check 'a client that is not configured is not named' ($hostNotice -notmatch 'VS Code' -and $hostNotice -notmatch 'Cursor')
Check 'the host notice says the client reads the change when it starts' `
    ($hostNotice -match 'reads when it starts|when it starts') $hostNotice
Check 'the credentials notice is a different statement: the SERVER process restarts' `
    ($credNotice -match 'server process that is already running keeps the value it started with') $credNotice
Check 'the write page carries the notice before anything is applied' `
    ($els.lblWriteRestart.Text -match 'Claude Desktop') $els.lblWriteRestart.Text

$fx2 = New-Fixture -Name 'vscode' -Client 'vscode'
. $LoadWindow $fx2
$hostNotice2 = (@(Get-RestartNotice 'host') -join ' ')
Check 'with VS Code configured instead, VS Code is named' ($hostNotice2 -match 'VS Code') $hostNotice2
Check 'and it is NOT told to quit a tray icon it does not have' ($hostNotice2 -notmatch 'tray icon')
Check 'Claude Desktop is not mentioned to an operator who does not run it' ($hostNotice2 -notmatch 'Claude Desktop')

$fx3 = New-Fixture -Name 'n8n' -Client 'n8n' -WithRecord
. $LoadWindow $fx3
$hostNotice3 = (@(Get-RestartNotice 'host') -join ' ')
Check 'a client this installer cannot configure is described as such, not as restartable' `
    ($hostNotice3 -match 'cannot write its configuration' -and $hostNotice3 -match 'own interface') $hostNotice3
Check 'and the settings file it has to be applied from is named' ($hostNotice3 -match 'n8n\.md') $hostNotice3
$credNotice3 = (@(Get-RestartNotice 'credentials') -join ' ')
Check 'a credentials change tells that same client something different: nothing to re-apply' `
    ($credNotice3 -match 'are unchanged by this' -and $credNotice3 -match 'gateway process') $credNotice3
Check 'and the automatic client alongside it is still told to restart' `
    ($credNotice3 -match 'Claude Desktop') $credNotice3
$n8nRow = @($script:Clients | Where-Object { $_.Id -eq 'n8n' })[0]
Check 'the clients page marks it MANUAL STEPS before anything is selected' `
    ($n8nRow.Configured -and $n8nRow.SetupBadge -eq 'MANUAL STEPS') "$($n8nRow.SetupBadge)"
Check 'the automatic/manual distinction comes from the host page, not from a second copy' `
    ((Get-Command Get-HostSelectionCatalog -ErrorAction SilentlyContinue) -ne $null)

# =============================================================================
# 6. Settings with no route are reported, with the reason, and not invented.
# =============================================================================
Group 'settings with no route'
. $LoadWindow $fx
$script:Page = $PG_AUDIT; Show-Page
$noRouteText = (@($els.noRouteList.Children | ForEach-Object {
                    @($_.Children | ForEach-Object { [string]$_.Text }) -join ' ' }) -join ' | ')
foreach ($k in @('ALLOW_SECRET_READ', 'ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT', 'BMC_CONSOLE_LINKS', 'BCONNECT_COMPOSITE_BUDGET_MS')) {
    Check "$k is shown, read-only" ($noRouteText -match [regex]::Escape($k))
}
Check 'each one states why it cannot be changed here' `
    ((@([regex]::Matches($noRouteText, 'Not changeable here:')).Count) -eq 4) `
    ("reasons found: " + (@([regex]::Matches($noRouteText, 'Not changeable here:')).Count))
Check 'and none of them is offered as a control' `
    (@($els.noRouteList.Children | ForEach-Object { $_.Children } |
       Where-Object { $_ -is [System.Windows.Controls.Primitives.ButtonBase] -or
                      $_ -is [System.Windows.Controls.TextBox] }).Count -eq 0)
Check 'the audit level, which DOES have a route, is offered as one' `
    (@($script:AuditRows).Count -eq 4 -and $els.btnSetAudit.IsEnabled)
Check 'an audit level equal to the stored one produces no invocation' `
    ($null -eq (Get-AuditChange)) `
    ("stored: " + $script:Status.credentials.auditLevel)

# =============================================================================
# 7. Tone. Every string this window can show, against the house rules.
# =============================================================================
Group 'tone'
# The strings a user can see, not the code. Three sources:
#   * every string literal in the script EXCEPT the XAML blob, which is one literal
#     and is handled separately -- its XML comments are code comments, and "<!--"
#     would otherwise fail the exclamation-mark rule on every run
#   * the XAML's Text= and Content= attribute values, which are what it displays
#   * the sentences the page builders hold as data rather than as XAML
$xamlNoComments = [regex]::Replace($xaml.OuterXml, '(?s)<!--.*?-->', ' ')
$strings = @($tokens |
    Where-Object { $_ -is [System.Management.Automation.Language.StringToken] } |
    ForEach-Object { [string]$_.Value } |
    Where-Object { $_ -notmatch '(?s)<Window\s' })
$strings += @([regex]::Matches($xamlNoComments, '(?:Text|Content)="([^"]*)"') |
              ForEach-Object { [System.Net.WebUtility]::HtmlDecode($_.Groups[1].Value) })
$strings += @($NoRouteSettings | ForEach-Object { $_.What; $_.Why; $_.How })
$strings += @($AuditLevels | ForEach-Object { $_.Title; $_.Text })
$strings += @(Get-RestartNotice 'host') + @(Get-RestartNotice 'credentials')
$strings = @($strings | Where-Object { $_ -and $_.Length -gt 12 })

$bangs = @($strings | Where-Object { $_ -match '!' })
Check 'no exclamation mark anywhere in the window' ($bangs.Count -eq 0) `
    (($bangs | Select-Object -First 2) -join ' / ')
$firstPersonPlural = @($strings | Where-Object { $_ -match '(?i)(^|[^a-z])(we|we''re|we''ll|our|ours|us)([^a-z]|$)' })
Check 'no first-person plural' ($firstPersonPlural.Count -eq 0) `
    (($firstPersonPlural | Select-Object -First 2) -join ' / ')
$contractions = 'don''t|doesn''t|didn''t|can''t|cannot''t|won''t|isn''t|aren''t|wasn''t|weren''t|hasn''t|haven''t|hadn''t|shouldn''t|couldn''t|wouldn''t|it''s|that''s|there''s|here''s|let''s|you''re|you''ll|you''ve|they''re|we''re|I''m'
$contracted = @($strings | Where-Object { $_ -match ('(?i)(^|[^a-z])(' + $contractions + ')([^a-z]|$)') })
Check 'no contractions' ($contracted.Count -eq 0) (($contracted | Select-Object -First 2) -join ' / ')
# The positive half of the rule: the write warning states condition, consequence and
# action rather than a mood.
Check 'the write-access warning states the consequence in full' `
    ($text -match 'create, modify and delete objects in the management suite, acting on the production estate')
Check 'and names the boundary underneath it rather than implying safety' `
    ($text -match 'bMS rights of the API key are a second boundary')

# =============================================================================
# 8. It looks like the same product as the installer window.
# =============================================================================
Group 'one product, two windows'
$wizardText = Get-Content -LiteralPath $WizardScript -Raw
Check 'both windows dot-source lib\Theme.ps1 rather than each keeping a palette' `
    (($text -match "Join-Path \`$LibDir 'Theme\.ps1'") -and ($wizardText -match "Join-Path \`$LibDir 'Theme\.ps1'"))
Check 'the settings window declares no palette of its own' `
    (-not ($text -match '\$C\s*=\s*@\{')) ''
$xamlText = $xaml.OuterXml
foreach ($pair in @(@{ n = 'window background'; v = $C.Win }, @{ n = 'card'; v = $C.Card },
                    @{ n = 'accent navy'; v = $C.Accent }, @{ n = 'border'; v = $C.Border },
                    @{ n = 'primary text'; v = $C.Txt }, @{ n = 'muted text'; v = $C.Muted },
                    @{ n = 'console well'; v = $Con.Bg })) {
    Check ("the XAML literal for the $($pair.n) is the palette value") ($xamlText -match [regex]::Escape($pair.v)) $pair.v
}
Check 'the title-bar badge uses the same ARGB chip as the installer window' `
    ($xamlText -match 'Background="#33FFFFFF"[^/]*CornerRadius="4"[^/]*Padding="6,1,6,2"')
Check 'the Primary button sets an explicit white foreground on the navy' `
    ($win.Resources.Contains('Primary') -and
     (($win.Resources['Primary'].Setters | Where-Object { $_.Property.Name -eq 'Foreground' }).Value.ToString() -match 'FFFFFF$'))
Check 'the client badges are the host page''s colours, not new ones' `
    ($xamlText -match 'Background="#014380"[^>]*>\s*<TextBlock Text="AUTOMATIC"' -and
     $xamlText -match 'Background="#9A5B00"[^>]*>\s*<TextBlock Text="MANUAL STEPS"')

# =============================================================================
# 9. The three entry states, each detected rather than declared.
#
# Every case below is a REAL installation in that state, built on disk, with the
# real window loaded against it. Nothing here passes a mode, a flag or a stage to
# the window: the whole point of the state machine is that after a silent
# machine-stage deployment there is nobody present to pass one.
# =============================================================================
Group 'entry state 2: installed, not configured for this account'

$fxMachine = New-Fixture -Name 'machine' -MachineStage
Check 'the machine-stage fixture wrote no credentials file' `
    (-not (Test-Path -LiteralPath (Join-Path $fxMachine.SecretsDir 'bconnect.env'))) $fxMachine.SecretsDir
Check 'and no client configuration file' (-not (Test-Path -LiteralPath $fxMachine.ConfigPath)) $fxMachine.ConfigPath

. $LoadWindow $fxMachine
Check 'the CLI still reports the suite as installed -- it is half-done, not broken' `
    ([bool]$script:Status.installed) ("statusError: " + $script:StatusError)
Check 'and reports no credentials store for this Windows account' `
    ($script:Status.credentials.mode -eq 'none') ("mode: " + $script:Status.credentials.mode)
Check 'no client counts as configured, because no client file is on disk' `
    (@(Get-ConfiguredClients).Count -eq 0) `
    ((@($script:Clients | Where-Object { $_.Configured } | ForEach-Object { $_.Id }) -join ', '))
Check 'the window detected the finish state' ($script:Entry -eq $ES_FINISH) ("entry: " + $script:Entry)
Check 'and it LEADS with the finish rather than with Status' `
    ($script:Page -ne $PG_STATUS -and $script:Page -eq [int]$FinishSteps[0].Page) `
    ("opened on page $($script:Page); Status is $PG_STATUS")
Check 'the finish banner is showing on that page' ($els.finishBar.Visibility -eq 'Visible')
Check 'the finish is a sequence over pages that already exist, not new ones' `
    (@($FinishSteps | Where-Object { [int]$_.Page -lt 0 -or [int]$_.Page -ge $script:PageCount -or [int]$_.Page -eq $PG_RUN }).Count -eq 0) `
    ((@($FinishSteps | ForEach-Object { $_.Title + '=page' + $_.Page }) -join ', '))
Check 'and it walks credentials, then clients, then write access, in that order' `
    ((@($FinishSteps | ForEach-Object { [int]$_.Page }) -join ',') -eq "$PG_CONN,$PG_CLIENTS,$PG_WRITES") `
    ((@($FinishSteps | ForEach-Object { $_.Title }) -join ' -> '))
Check 'a chip is built for each step' ($els.finishSteps.Children.Count -eq $FinishSteps.Count) `
    ("chips: " + $els.finishSteps.Children.Count)
Check 'and each step says what it does, rather than a title bent into a sentence' `
    (@($FinishSteps | Where-Object { -not $_.Does -or -not $_.Blurb }).Count -eq 0) `
    ((@($FinishSteps | ForEach-Object { $_.Does }) -join ' / '))
Check 'the banner states why the finish is offered, as findings' `
    ($els.lblFinishWhy.Text -match 'No bConnect credential is stored' -and
     $els.lblFinishWhy.Text -match 'No MCP client is configured') $els.lblFinishWhy.Text
Check 'and says the machine stage collected neither by design, rather than implying a fault' `
    ($els.lblFinishWhy.Text -match 'machine stage placed the suite here') $els.lblFinishWhy.Text

# The handoff. The intended list is the ONLY thing that carries the deployment's
# decision across the two stages, and it is read through State.psm1's accessor.
Check 'the intended client list came out of the record' `
    ((@($script:Intended) -join ',') -eq 'claude-desktop,vscode') ("intended: " + (@($script:Intended) -join ','))
Check 'and the record stage says machine' ($script:RecordStage -eq 'machine') ("stage: " + $script:RecordStage)
Check 'the banner names those clients by their labels, from lib\hosts.json' `
    ($els.lblFinishIntended.Text -match 'Claude Desktop' -and $els.lblFinishIntended.Text -match 'VS Code') `
    $els.lblFinishIntended.Text
$script:Page = $PG_CLIENTS; Show-Page
$clientText = (@($els.clientList.Children | ForEach-Object { $_.Child } | ForEach-Object {
                   @($_.Children | ForEach-Object { @($_.Children | ForEach-Object { [string]$_.Text }) }) }) -join ' | ')
Check 'and an intended client is marked as such on its own row' `
    ((@([regex]::Matches($clientText, 'Recorded by the deployment as a client this installation is for')).Count) -eq 2) `
    ("rows so marked: " + (@([regex]::Matches($clientText, 'Recorded by the deployment')).Count))

# The one step this window cannot complete, said where it applies rather than left
# to be found by pressing a button that then stops on a missing -BaseUrl.
$script:Page = $PG_CONN; Show-Page
Check 'with no credentials file, the connection page offers no change' `
    ((-not $els.btnSetUrl.IsEnabled) -and (-not $els.btnSetCredential.IsEnabled) -and (-not $els.btnVerify.IsEnabled)) `
    ("url=$($els.btnSetUrl.IsEnabled) cred=$($els.btnSetCredential.IsEnabled) verify=$($els.btnVerify.IsEnabled)")
Check 'and names the user stage, which is what writes the first credential' `
    ($els.lblConnNow.Text -match 'Install-BConnectMcp\.ps1 -Stage User') $els.lblConnNow.Text
Check 'the finish note says the same thing on the step it applies to' `
    ($els.lblFinishNote.Text -match 'Install-BConnectMcp\.ps1 -Stage User') $els.lblFinishNote.Text
Check 'the audit page will not edit a credentials file that does not exist' `
    (-not (Test-CredentialStorePresent))

# The banner navigates and nothing else. Pressing every control it has must leave
# the disk exactly as it was.
$doneBefore = @($script:Done).Count
$els.btnFinishNext.RaiseEvent((New-Object System.Windows.RoutedEventArgs([System.Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
Check 'Next step moves to the next existing page' ($script:Page -eq [int]$FinishSteps[1].Page) `
    ("now on page $($script:Page)")
$els.btnFinishStatus.RaiseEvent((New-Object System.Windows.RoutedEventArgs([System.Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
Check 'Open Status instead reaches Status, so nobody is trapped in the finish' ($script:Page -eq $PG_STATUS)
Check 'and the banner is not shown on a page the finish does not walk' `
    ($els.finishBar.Visibility -eq 'Collapsed')
Check 'none of that dispatched anything' `
    (@($script:Done).Count -eq $doneBefore -and -not $script:Running) ("done: " + @($script:Done).Count)
Check 'and none of it created a credentials file' `
    (-not (Test-Path -LiteralPath (Join-Path $fxMachine.SecretsDir 'bconnect.env')))
Check 'nor a client configuration file' (-not (Test-Path -LiteralPath $fxMachine.ConfigPath))

# The state is read off the disk, so changing the disk changes the state. This is
# what makes it detection rather than a flag: the same fixture, one file added.
Write-SecretFileAtomic -Path (Join-Path $fxMachine.SecretsDir 'bconnect.env') `
    -Content (New-EnvFileContent -BaseUrl $BAD_URL -ApiKey $DUMMY_KEY)
. $LoadWindow $fxMachine
Check 'adding a credentials file leaves one finding, not two' `
    ($script:Entry -eq $ES_FINISH -and $els.lblFinishWhy.Text -notmatch 'No bConnect credential is stored' -and
     $els.lblFinishWhy.Text -match 'No MCP client is configured') $els.lblFinishWhy.Text
Check 'and the connection page becomes editable, because now there is a file to edit' `
    ($els.btnSetCredential.IsEnabled -and $els.btnSetUrl.IsEnabled)

# The finish's remaining work IS this window's work, and it goes out through the CLI.
$script:Page = $PG_CLIENTS; Show-Page
$clientChange = Get-ClientChange 'claude-desktop'
Check 'the clients step produces a verb from the closed list' `
    ($clientChange.Params['Verb'] -eq 'hosts' -and $VERBS_ALLOWED -contains [string]$clientChange.Params['Verb']) `
    ("$($clientChange.Params['Verb']) $($clientChange.Params['Object'])")
# Pressed, not called. The button on the row is what an administrator finishing a
# machine-stage deployment actually uses, and the assertion is worth nothing if it
# reaches the CLI only when a test invokes the builder by name.
$configureBtn = @($els.clientList.Children | ForEach-Object { $_.Child } |
                  ForEach-Object { @($_.Children) } |
                  Where-Object { $_ -is [System.Windows.Controls.Button] -and [string]$_.Tag -eq 'claude-desktop' })
Check 'the row for that client carries a button, labelled for a client that is not configured yet' `
    ($configureBtn.Count -eq 1 -and [string]$configureBtn[0].Content -eq 'Configure it') `
    ("buttons: " + $configureBtn.Count + " content: " + $(if ($configureBtn.Count) { $configureBtn[0].Content } else { '(none)' }))
$configureBtn[0].RaiseEvent((New-Object System.Windows.RoutedEventArgs([System.Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
$finishedRun = Wait-Change
Check 'and it ran to completion through bconnect.ps1' `
    ($finishedRun -and @($script:Done).Count -eq 1) `
    ((@($script:Done | ForEach-Object { $_.Change.What + ' failed=' + $_.Failed }) -join '; '))
$finishPane = (($els.console.Inlines | ForEach-Object { $_.Text }) -join '')
Check 'the CLI invocation is echoed, so what wrote the file is on the screen' `
    ($finishPane -match 'bconnect\.ps1 hosts add claude-desktop') `
    ((@($finishPane -split "`n") | Select-Object -First 1))
Check 'the client configuration now exists -- written by the engine, not by this window' `
    (Test-Path -LiteralPath $fxMachine.ConfigPath) $fxMachine.ConfigPath
Check 'and the window left the finish state on its own re-reading' `
    ($script:Entry -eq $ES_READY) ("entry: " + $script:Entry)

# =============================================================================
# 10. Entry state 3, and entry state 1.
# =============================================================================
Group 'entry state 3: a fully configured install still opens on Status'
. $LoadWindow $fx
Check 'a configured installation is not in the finish state' ($script:Entry -eq $ES_READY) ("entry: " + $script:Entry)
Check 'the window opens on Status' ($script:Page -eq $PG_STATUS) ("opened on page " + $script:Page)
Check 'and shows no finish banner' ($els.finishBar.Visibility -eq 'Collapsed')
Check 'Get-EntryPage agrees, so opening and re-checking cannot disagree' `
    ((Get-EntryPage) -eq $PG_STATUS)

Group 'entry state 1: nothing installed'
$fxBare = New-Fixture -Name 'bare' -Bare
. $LoadWindow $fxBare
Check 'the CLI finds no installation' (-not [bool]$script:Status.installed) `
    ("installed: " + $script:Status.installed)
Check 'the window is in the not-installed state' ($script:Entry -eq $ES_NONE) ("entry: " + $script:Entry)
Check 'it opens on Status rather than offering to finish nothing' `
    ($script:Page -eq $PG_STATUS -and $els.finishBar.Visibility -eq 'Collapsed') ("page " + $script:Page)
$bareText = (@($els.statusList.Children | ForEach-Object { $_.Child } | ForEach-Object {
                 @($_.Children | ForEach-Object { [string]$_.Text }) }) -join ' ')
Check 'and says so plainly, naming the installer' `
    ($bareText -match 'No installation was found' -and $bareText -match 'Install-BConnectMcp-UI\.ps1') `
    ($bareText.Substring(0, [Math]::Min(200, $bareText.Length)))
Check 'the footer says it too, on whatever page is reached' `
    ($els.lblFooter.Text -match 'Nothing is installed here') $els.lblFooter.Text
$script:Page = $PG_CONN; Show-Page
Check 'and the change controls are refused rather than shown as working' `
    ((-not $els.btnSetCredential.IsEnabled) -and (-not $els.btnSetUrl.IsEnabled))

Group 'the state cannot be forced from outside'
$manageParams = @((Get-Command (Resolve-Path -LiteralPath $ManageScript).Path).Parameters.Keys)
Check 'the window takes no parameter that could declare an entry state' `
    (@($manageParams | Where-Object { $_ -match '(?i)finish|firstrun|first-run|entry|unconfigured|stage' }).Count -eq 0) `
    ($manageParams -join ', ')
Check 'and the finish adds no verb to the closed list' `
    ((($VERBS_ALLOWED) -join ',') -eq 'status,verify,set,enable,disable,writes,hosts') `
    ($VERBS_ALLOWED -join ',')

# =============================================================================
# 11. The window refuses to start where WPF cannot run, as the installer does.
# =============================================================================
Group 'host pre-flight'
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$mta = & powershell.exe -NoProfile -ExecutionPolicy Bypass -MTA -File (Resolve-Path -LiteralPath $ManageScript).Path -TestHeadless 2>&1
$mtaExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
$mtaText = ($mta | Out-String)
Check 'launching it on an MTA thread refuses, rather than failing inside WPF' ($mtaExit -eq 2) "exit $mtaExit"
Check 'and the refusal carries the exact command that works' `
    ($mtaText -match '(?i)-Sta' -and $mtaText -match '(?i)MTA') `
    (($mtaText.Trim() -split "`r?`n" | Where-Object { $_ -match '-Sta' } | Select-Object -First 1))

} finally {
    Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("  $script:Pass passed, $script:Fail failed   ({0:N1}s)" -f ((Get-Date) - $started).TotalSeconds) `
    -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
Write-Host '  Not proven by this script: what any of this looks like on a screen, or that a' -ForegroundColor DarkGray
Write-Host '  client then reads what was written. Only its own restart shows that.' -ForegroundColor DarkGray
Write-Host ''
if ($script:Fail) { exit 1 }
exit 0
