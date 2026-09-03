<#
.SYNOPSIS
    Everyday reconfiguration of an installed bConnect-MCP suite, as verbs.

.DESCRIPTION
    A front end, not a second installer. Every verb that CHANGES anything resolves to
    one targeted `Install-BConnectMcp.ps1 -NonInteractive ...` invocation, because the
    rule that has kept the wizard and the console installer from drifting applies here
    too: the front end collects the answers, the installer does the work, and there is
    exactly one implementation of the work.

    The verbs that change nothing -- status, servers list, hosts list, writes show --
    are implemented here, because reporting is not "the work" and routing a read
    through the installer would mean starting servers to answer "what is installed?".

    Everything comes out of install\state\installation.json, so a verb does not have
    to restate the suite root, the secrets directory, the host list or the server
    list. If there is no record -- the normal state of every installation that
    predates it -- one is ADOPTED from the host configuration files and the
    credentials store, and that is said out loud rather than assumed.

.PARAMETER Verb
    status | verify | set | enable | disable | servers | writes | hosts | gateway |
    protect | unprotect | uninstall

.PARAMETER Json
    status only. Writes the same facts the printed report is built from, as JSON, so
    a second front end does not have to compute them again. install\Manage-BConnectMcp.ps1
    is that front end.

.PARAMETER ApiKeySecure
    What `set credential` would otherwise prompt for. A [SecureString], so it can be
    passed in process by a window and never reaches a command line. Same for
    -BasicPassSecure and -V11PassSecure.

.EXAMPLE
    .\bconnect.ps1 status
    What is installed, where, and every way the record and the disk disagree.

.EXAMPLE
    .\bconnect.ps1 set url https://bms.example.com/bconnect
    One line in the credentials file. No host file changes at all -- the launch shape
    is identical, because a host config carries only a PATH to the credentials.

.EXAMPLE
    .\bconnect.ps1 writes enable bconnect-jobs create_job_instance start_job_instance
    The env block of that one entry, in every recorded host.

.EXAMPLE
    .\bconnect.ps1 writes disable bconnect-jobs
    And back again. A write gate that cannot be turned off in one command does not
    get turned on.

.EXAMPLE
    .\bconnect.ps1 uninstall
    Remove the entries, the credentials and the record -- and print what could not be
    removed from here, starting with the bMS API key itself.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)] [string] $Verb,
    [Parameter(Position = 1)] [string] $Object,
    [Parameter(Position = 2, ValueFromRemainingArguments = $true)] [string[]] $Rest,

    [string] $StateFile,

    # Path overrides. Normally every one of these comes out of the record, which is
    # the point of having one; they exist for a rehearsal against a copy and for
    # lib\Test-Reconfigure.ps1, which must never touch the real installation.
    [string] $SuiteRootOverride,
    [string] $SecretsDirOverride,
    [string] $ProjectDirOverride,
    [string] $HostOutDirOverride,
    [string] $ConfigPathOverride,

    [switch] $Yes,
    [switch] $KeepCredentials,
    [switch] $Force,
    [switch] $DryRun,
    [switch] $IgnoreUnreachable,

    # status, as data rather than as a report. Same computation, second rendering.
    [switch] $Json,

    # The answers the two credential verbs prompt for, supplied instead of typed.
    # A window cannot answer a Read-Host, and a secret must not travel on a command
    # line -- so these are parameters, and a caller in the same process hands over
    # the SecureString object itself. Nothing here changes what a console run does:
    # absent these, both verbs prompt exactly as they did.
    [System.Security.SecureString] $ApiKeySecure,
    [string] $BasicUser,
    [System.Security.SecureString] $BasicPassSecure,
    [string] $V11User,
    [System.Security.SecureString] $V11PassSecure
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$InstallerDir = $PSScriptRoot
$LibDir       = Join-Path $InstallerDir 'lib'
$Engine       = Join-Path $InstallerDir 'Install-BConnectMcp.ps1'
$ProjectRoot  = Split-Path -Parent $InstallerDir

Import-Module (Join-Path $LibDir 'Secrets.psm1') -Force
Import-Module (Join-Path $LibDir 'Dpapi.psm1')   -Force -DisableNameChecking
Import-Module (Join-Path $LibDir 'State.psm1')   -Force -DisableNameChecking

function Say     { param([string]$m) Write-Host ('  ' + $m) }
function SayDim  { param([string]$m) Write-Host ('  ' + $m) -ForegroundColor DarkGray }
function SayOk   { param([string]$m) Write-Host ('  [ ok ] ' + $m) -ForegroundColor Green }
function SayWarn { param([string]$m) Write-Host ('  [warn] ' + $m) -ForegroundColor Yellow }
function SayFail { param([string]$m) Write-Host ('  [FAIL] ' + $m) -ForegroundColor Red }

function Show-Usage {
    Write-Host ''
    Write-Host '  bconnect -- reconfigure an installed bConnect-MCP suite' -ForegroundColor White
    Write-Host '  ------------------------------------------------------' -ForegroundColor DarkGray
    Write-Host '    status [-Json]                      what is installed, where, and any drift'
    Write-Host '    verify [-Server x]                  verification only, changes nothing'
    Write-Host ''
    Write-Host '    set url <url>                       one line in the credentials file'
    Write-Host '    set credential                      masked re-prompt, v2.0'
    Write-Host '    set v11-credential                  masked re-prompt, UPN-validated, v1.1 probed'
    Write-Host '    set audit all|write|security|none   what the servers write to the audit log'
    Write-Host '    set rate-limit on|off [max] [ms]    the per-server request limiter'
    Write-Host '    enable v11 | disable v11            the per-server v1.1 gate'
    Write-Host ''
    Write-Host '    servers list | add <a,b> | remove <a,b> | set <a,b>'
    Write-Host '    writes show | enable <server> [tools...] | disable <server> | disable-all'
    Write-Host '    hosts list | add <id> | remove <id> | resync'
    Write-Host '    gateway enable | disable | rotate-token'
    Write-Host '    protect | unprotect                 the DPAPI form, in both directions'
    Write-Host ''
    Write-Host '    uninstall [-KeepCredentials]        and it prints what it could NOT remove'
    Write-Host ''
    Write-Host '  Options: -StateFile <path>  -DryRun  -Force  -Yes  -IgnoreUnreachable'
    Write-Host ''
    Write-Host '  The same changes in a window: .\Manage-BConnectMcp.ps1' -ForegroundColor DarkGray
    Write-Host ''
}

# -----------------------------------------------------------------------------
# Context: the record, or an adoption of what is on disk
# -----------------------------------------------------------------------------
if (-not $StateFile) { $StateFile = Get-DefaultStateFile }
$Registry = Get-HostRegistry
$AllHosts = $Registry.targets
$Record   = Read-InstallationRecord -Path $StateFile
$Adopted  = $false

# Defaults for an installation with no record. Identical to the installer's own.
$SuiteRoot  = Join-Path $ProjectRoot 'bConnect-MCP-main'
$SecretsDir = Join-Path $ProjectRoot 'secrets'
$ProjectDir = $ProjectRoot
$HostOutDir = Join-Path $InstallerDir 'out'
$ConfigPath = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
$HostIds    = @('claude-desktop')

if ($Record) {
    if ($Record.suiteRoot)  { $SuiteRoot  = $Record.suiteRoot }
    if ($Record.secretsDir) { $SecretsDir = $Record.secretsDir }
    if ($Record.PSObject.Properties.Name -contains 'projectDir' -and $Record.projectDir) { $ProjectDir = $Record.projectDir }
    if ($Record.PSObject.Properties.Name -contains 'hostOutDir' -and $Record.hostOutDir) { $HostOutDir = $Record.hostOutDir }
    $ids = @(Get-RecordHostIds $Record)
    if ($ids.Count) { $HostIds = $ids }
    foreach ($h in @($Record.hosts)) { if ($h.id -eq 'claude-desktop' -and $h.path) { $ConfigPath = $h.path } }
}
if ($SuiteRootOverride)  { $SuiteRoot  = $SuiteRootOverride }
if ($SecretsDirOverride) { $SecretsDir = $SecretsDirOverride }
if ($ProjectDirOverride) { $ProjectDir = $ProjectDirOverride }
if ($HostOutDirOverride) { $HostOutDir = $HostOutDirOverride }
if ($ConfigPathOverride) { $ConfigPath = $ConfigPathOverride }
$EnvFile = Join-Path $SecretsDir 'bconnect.env'

function Resolve-HostPath {
    param($Target)
    if ($Record) {
        foreach ($h in @($Record.hosts)) { if ($h.id -eq $Target.id -and $h.path) { return [string]$h.path } }
    }
    if ($Target.id -eq 'claude-desktop') { return $ConfigPath }
    $p = $Target.defaultPath
    $p = $p.Replace('{APPDATA}',     $env:APPDATA)
    $p = $p.Replace('{USERPROFILE}', $env:USERPROFILE)
    $p = $p.Replace('{PROJECT}',     $ProjectDir)
    $p = $p.Replace('{OUT}',         $HostOutDir)
    return $p
}
function Get-HostFiles {
    param([string[]] $Ids)
    $list = @()
    foreach ($t in @($AllHosts | Where-Object { $Ids -contains $_.id })) {
        $list += @{ id = $t.id; path = (Resolve-HostPath $t); target = $t }
    }
    return ,$list
}

$EnvMap = New-Object 'System.Collections.Specialized.OrderedDictionary'
$EnvReadError = $null
$Store = Get-CredentialStoreState -EnvFile $EnvFile
if ($Store.Mode -ne 'none') {
    try { $EnvMap = Read-BConnectEnvMap -EnvFile $EnvFile } catch { $EnvReadError = $_.Exception.Message }
}

if (-not $Record) {
    # Adoption. Not an error branch: it is the upgrade path for every installation
    # that exists today, so it is a first-class one.
    $adopt = Get-AdoptedRecord -SuiteRoot $SuiteRoot -SecretsDir $SecretsDir `
                -HostFiles (Get-HostFiles @($AllHosts | Select-Object -ExpandProperty id)) `
                -EnvMap $EnvMap -CredentialMode $Store.Mode `
                -ProjectDir $ProjectDir -HostOutDir $HostOutDir
    if (@($adopt.hosts).Count) {
        $Record  = $adopt
        $Adopted = $true
        $ids = @(Get-RecordHostIds $Record)
        if ($ids.Count) { $HostIds = $ids }
    }
}

$Servers = @()
if ($Record) { $Servers = @(Get-RecordServerNames $Record) }

# -----------------------------------------------------------------------------
# Running the engine
# -----------------------------------------------------------------------------
# In-process, with the call operator, for a reason that is not incidental: the
# credential parameters are [SecureString], and a SecureString cannot cross a
# process boundary as text. That is the whole point of them. The engine's `exit`
# ends the engine script and returns here with $LASTEXITCODE set.
function Invoke-Engine {
    param(
        [hashtable] $Extra = @{},
        [switch]    $NeedsReachability
    )
    $p = @{
        NonInteractive = $true
        SuiteRoot      = $SuiteRoot
        SecretsDir     = $SecretsDir
        ConfigPath     = $ConfigPath
        ProjectDir     = $ProjectDir
        HostOutDir     = $HostOutDir
        StateFile      = $StateFile
        SkipBuild      = $true
        Hosts          = ($HostIds -join ',')
    }
    # Reachability is the point of a credential change, and beside the point of a
    # write-gate change. An operator must not be unable to turn writes OFF because
    # the bMS is down.
    if (-not $NeedsReachability -or $IgnoreUnreachable) { $p['ContinueOnUnreachable'] = $true }
    if ($DryRun) { $p['DryRun'] = $true }
    if ($Force)  { $p['Force']  = $true }
    foreach ($k in $Extra.Keys) { $p[$k] = $Extra[$k] }
    if ($p.ContainsKey('SkipBuildOff')) { $p.Remove('SkipBuildOff'); $p.Remove('SkipBuild') }

    & $Engine @p
    return $LASTEXITCODE
}

function Require-Record {
    param([string] $What)
    if (-not $Record) {
        SayFail "no installation to $What."
        Say "There is no record at $StateFile and no bconnect-* entries in any known host file."
        Say 'Run .\Install-BConnectMcp.ps1 first.'
        exit 2
    }
}

# -----------------------------------------------------------------------------
# status
# -----------------------------------------------------------------------------
# Split in two on purpose. Get-StatusModel COMPUTES; Show-Status PRINTS what it
# returns. The reason is install\Manage-BConnectMcp.ps1: a settings window has to
# show the same facts, and a window that worked them out for itself would be the
# next parallel copy to drift -- the defect this project has had to remove five
# times. So the window runs `status -Json` and renders the model. One reader of the
# record and the disk; two renderings of it.
function Get-StatusModel {
    $hostFiles = Get-HostFiles $HostIds
    $model = [ordered]@{
        installed   = [bool]$Record
        adopted     = $Adopted
        stateFile   = $StateFile
        suiteRoot   = $SuiteRoot
        secretsDir  = $SecretsDir
        projectDir  = $ProjectDir
        hostOutDir  = $HostOutDir
        envFile     = $EnvFile
        record      = $null
        credentials = $null
        servers     = @()
        hosts       = @()
        drift       = @()
        backups     = @()
        nodeVersion = $null
    }
    if (-not $Record) { return [pscustomobject]$model }

    $model.record = [ordered]@{
        schema           = [string]$Record.schema
        lastRun          = [string]$Record.lastRun
        installerVersion = [string]$Record.installerVersion
        lastRunVerified  = [bool]($Record.PSObject.Properties.Name -notcontains 'lastRunVerified' -or $Record.lastRunVerified)
    }

    # -- credentials ----------------------------------------------------------
    $cred = [ordered]@{
        mode       = $Store.Mode
        activePath = $Store.ActivePath
        readError  = $EnvReadError
    }
    if (-not $EnvReadError) {
        $c = Get-CredentialFacts -EnvMap $EnvMap -Mode $Store.Mode
        $val = { param($k) if ($EnvMap.Contains($k)) { [string]$EnvMap[$k] } else { $null } }
        $cred['baseUrl']             = $c.baseUrl
        $cred['authKind']            = $c.authKind
        $cred['basicUser']           = $c.basicUser
        $cred['v11Configured']       = [bool]$c.v11.configured
        $cred['v11Username']         = $c.v11.username
        $cred['caCertPath']          = $c.caCertPath
        $cred['gatewayTokenPresent'] = [bool]$c.gatewayTokenPresent
        # Settings, not secrets, but they live in this file because it is the file
        # every server is launched with. Absent means the server's own default.
        $cred['auditLevel']           = (& $val 'BCONNECT_AUDIT_LEVEL')
        $cred['rateLimitEnabled']     = (& $val 'BCONNECT_RATE_LIMIT_ENABLED')
        $cred['rateLimitMaxRequests'] = (& $val 'BCONNECT_RATE_LIMIT_MAX_REQUESTS')
        $cred['rateLimitWindowMs']    = (& $val 'BCONNECT_RATE_LIMIT_WINDOW_MS')
        $cred['extraKeys'] = @($EnvMap.Keys | Where-Object {
            @('BCONNECT_BASE_URL','BCONNECT_API_KEY','BCONNECT_USERNAME','BCONNECT_PASSWORD',
              'BCONNECT_V11_USERNAME','BCONNECT_V11_PASSWORD','BCONNECT_CA_CERT_PATH',
              'MCP_GATEWAY_AUTH_TOKEN','BCONNECT_RELEASE','BCONNECT_SKIP_CONNECTIVITY_CHECK',
              'BCONNECT_AUDIT_LEVEL','BCONNECT_RATE_LIMIT_ENABLED','BCONNECT_RATE_LIMIT_MAX_REQUESTS',
              'BCONNECT_RATE_LIMIT_WINDOW_MS','MCP_TRANSPORT') -notcontains $_ })
    }
    $model.credentials = $cred

    # -- servers --------------------------------------------------------------
    $deployed = Get-DeployedServerEnv -HostFiles $hostFiles
    $catalog  = Get-Content (Join-Path $LibDir 'catalog.json') -Raw | ConvertFrom-Json
    $catNames = @($catalog.servers | Select-Object -ExpandProperty name)
    $names    = @($Servers + @($deployed.Keys) | Select-Object -Unique | Sort-Object)
    $rows = @()
    foreach ($n in $names) {
        $row = [ordered]@{
            name = $n; managed = ($catNames -contains $n); deployed = $deployed.Contains($n)
            writes = 'none'; writeTools = @(); writeToolCount = 0; v11 = $false
        }
        if ($row.managed) {
            $cat = $catalog.servers | Where-Object { $_.name -eq $n }
            $row.writeToolCount = @($cat.writeTools).Count
            $blk = $null
            if ($deployed.Contains($n)) { $blk = $deployed[$n] }
            if ($blk -and $blk.Contains('ALLOW_WRITE_OPERATIONS') -and $blk['ALLOW_WRITE_OPERATIONS'] -eq 'true') {
                if ($blk.Contains('ALLOWED_WRITE_TOOLS') -and $blk['ALLOWED_WRITE_TOOLS']) {
                    $row.writes = 'limited'
                    $row.writeTools = @($blk['ALLOWED_WRITE_TOOLS'] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
                } else {
                    $row.writes = 'all'
                }
            }
            if ($blk -and $blk.Contains('BCONNECT_ENABLE_V11') -and $blk['BCONNECT_ENABLE_V11'] -eq 'true') { $row.v11 = $true }
        }
        $rows += [pscustomobject]$row
    }
    $model.servers = @($rows)

    # -- hosts ----------------------------------------------------------------
    $hrows = @()
    foreach ($hf in $hostFiles) {
        $entries = $null
        $state   = 'ok'
        if (-not (Test-Path -LiteralPath $hf.path)) {
            $state = 'MISSING FILE'
        } else {
            $e = Get-HostManagedEntries -Path $hf.path -Target $hf.target
            if ($null -eq $e) { $state = 'emitted whole (' + $hf.target.mode + ') -- not re-read' }
            else { $entries = $e.Count; $state = "$($e.Count) managed entr" + $(if ($e.Count -eq 1) { 'y' } else { 'ies' }) }
        }
        $hrows += [pscustomobject][ordered]@{
            id = $hf.id; label = [string]$hf.target.label; mode = [string]$hf.target.mode
            path = $hf.path; exists = (Test-Path -LiteralPath $hf.path)
            managedEntries = $entries; state = $state
        }
    }
    $model.hosts = @($hrows)

    # -- drift ----------------------------------------------------------------
    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if ($node) { $model.nodeVersion = ((& $node.Source -v) -replace '^v', '') }
    $findings = @()
    if ($Adopted) {
        # An adopted view has no recorded hashes, so the hash comparisons in
        # Get-InstallationDrift have nothing to say. The launch-path check has:
        # it reads the entries themselves. That matters because an adopted view is
        # exactly what an install-location change produces -- the record stayed in
        # the old directory -- and it is the one finding a moved installation needs.
        $findings = @(Get-StaleLaunchPaths -HostFiles $hostFiles)
    } else {
        $findings = @(Get-InstallationDrift -Record $Record -HostFiles $hostFiles -EnvMap $EnvMap -NodeVersion $model.nodeVersion)
    }
    $model.drift = @($findings | ForEach-Object {
        [pscustomobject][ordered]@{ severity = $_.Severity; text = $_.Text; action = $_.Action } })

    # -- backups --------------------------------------------------------------
    $backups = @()
    foreach ($hf in $hostFiles) {
        $dir = Split-Path -Parent $hf.path
        if ($dir -and (Test-Path -LiteralPath $dir)) {
            $backups += @(Get-ChildItem -LiteralPath $dir -Filter ((Split-Path -Leaf $hf.path) + '.bak-*') -ErrorAction SilentlyContinue)
        }
    }
    $model.backups = @(@($backups | Sort-Object LastWriteTime -Descending) | ForEach-Object { $_.FullName })

    return [pscustomobject]$model
}

function Show-Status {
    param($m)
    Write-Host ''
    Write-Host '  bConnect-MCP -- installation status' -ForegroundColor White
    Write-Host '  -----------------------------------' -ForegroundColor DarkGray

    if (-not $m.installed) {
        SayWarn 'nothing is installed as far as this machine can tell.'
        Say "no record at $StateFile, and no bconnect-* entries in any known host file"
        Say 'Run .\Install-BConnectMcp.ps1 to install.'
        Write-Host ''
        return 0
    }
    if ($Adopted) {
        SayWarn 'ADOPTED -- there is no installation record; this view was reconstructed'
        Say '  from the host configuration files and the credentials store. That is the'
        Say '  normal state of an installation made before the record existed. The next'
        Say '  run of the installer (or any bconnect verb that changes something) writes'
        Say '  a real one.'
    } else {
        Say ("record        $($m.stateFile)")
        Say ('              schema ' + $m.record.schema + ', last run ' + $m.record.lastRun +
             ', installer ' + $m.record.installerVersion)
        if (-not $m.record.lastRunVerified) {
            SayWarn 'the last run did NOT pass verification'
        }
    }
    Say ("suite root    $($m.suiteRoot)")

    # -- credentials ----------------------------------------------------------
    $c = $m.credentials
    Write-Host ''
    Say ('credentials   ' + $(if ($c.activePath) { $c.activePath } else { '(none)' }) + '  [' + $c.mode + ']')
    if ($c.readError) {
        SayFail ('  cannot be read: ' + $c.readError)
        Say '  A DPAPI blob is readable only by the Windows account that created it, on'
        Say '  the machine that created it. Nothing here will overwrite it.'
    } else {
        Say ('  base URL    ' + $(if ($c.baseUrl) { $c.baseUrl } else { '(not set)' }))
        Say ('  auth        ' + $(switch ($c.authKind) { 'apikey' { 'API key (value not shown)' }
                                                          'basic'  { 'Basic as ' + $c.basicUser }
                                                          default  { '(none)' } }))
        Say ('  v1.1        ' + $(if ($c.v11Configured) { 'configured as ' + $c.v11Username } else { 'not configured' }))
        Say ('  CA cert     ' + $(if ($c.caCertPath) { $c.caCertPath } else { '(none -- the Windows store is used)' }))
        Say ('  gateway     ' + $(if ($c.gatewayTokenPresent) { 'bearer token present (value not shown)' } else { 'no token' }))
        Say ('  audit       ' + $(if ($c.auditLevel) { $c.auditLevel } else { '(not set -- the servers audit writes)' }))
        Say ('  rate limit  ' + $(if ($c.rateLimitEnabled -eq 'true') {
                                      "on, $($c.rateLimitMaxRequests) requests per $($c.rateLimitWindowMs) ms" }
                                  elseif ($c.rateLimitEnabled) { 'off' } else { '(not set)' }))
        if (@($c.extraKeys).Count) {
            Say ('  also set    ' + (@($c.extraKeys) -join ', '))
            SayDim '              (added by hand or by a later installer -- kept on every re-run)'
        }
    }

    # -- servers --------------------------------------------------------------
    Write-Host ''
    Say 'servers'
    if (-not @($m.servers).Count) { Say '  (none)' }
    foreach ($s in @($m.servers)) {
        if (-not $s.managed) {
            Say ('  ' + $s.name.PadRight(30) + 'UNMANAGED -- not in lib\catalog.json, never touched')
            continue
        }
        $bits = @()
        switch ($s.writes) {
            'limited' { $bits += ("writes: $(@($s.writeTools).Count) of $($s.writeToolCount)") }
            'all'     { $bits += ("writes: ALL $($s.writeToolCount)") }
            default   { $bits += 'read-only' }
        }
        if ($s.v11) { $bits += 'v1.1 ON' }
        if (-not $s.deployed) { $bits += 'IN THE RECORD ONLY -- not deployed' }
        Say ('  ' + $s.name.PadRight(30) + ($bits -join '   '))
        if ($s.writes -eq 'limited') {
            SayDim ('  ' + ''.PadRight(30) + (@($s.writeTools) -join ','))
        }
    }

    # -- hosts ----------------------------------------------------------------
    Write-Host ''
    Say 'hosts'
    foreach ($h in @($m.hosts)) {
        Say ('  ' + $h.id.PadRight(16) + $h.state)
        SayDim ('  ' + ''.PadRight(16) + $h.path)
    }

    # -- drift ----------------------------------------------------------------
    Write-Host ''
    if (@($m.drift).Count) {
        Say 'drift'
        foreach ($d in @($m.drift)) {
            if ($d.severity -eq 'edit' -or $d.severity -eq 'warn') { SayWarn ('  ' + $d.text) } else { Say ('  ! ' + $d.text) }
            SayDim ('    -> ' + $d.action)
        }
    } elseif ($m.adopted) {
        # Not "not checked". The launch paths WERE checked, and every entry starts a
        # file that is there; only the hand-edit comparison is unavailable. Saying
        # "not checked" for both is what let a moved installation read as unexamined.
        Say 'drift         every entry starts a file that is on this machine'
    } else {
        SayOk 'no drift -- every recorded entry is exactly as the installer left it'
    }
    # Printed whether or not there were findings: an adopted view cannot answer the
    # hand-edit question at all, and an operator reading a list of findings would
    # otherwise take that list for the whole answer.
    if ($m.adopted) {
        SayDim '              hand edits not checked -- an adopted view has no recorded hashes'
    }

    # -- backups --------------------------------------------------------------
    Write-Host ''
    if (@($m.backups).Count) {
        Say ('backups       ' + @($m.backups).Count + ' -- most recent first')
        foreach ($b in (@($m.backups) | Select-Object -First 3)) {
            SayDim ('  ' + $b)
        }
    } else {
        Say 'backups       (none)'
    }
    Write-Host ''
    return 0
}

# -----------------------------------------------------------------------------
# Verb dispatch
# -----------------------------------------------------------------------------
# NOT $rest. PowerShell variable names are case-insensitive, so $rest IS $Rest, and
# `$rest = @()` empties the parameter before the next line can read it -- every verb
# then reports "usage:" for a command line that was perfectly correct. Same trap as
# $L/$l in Secrets.psm1 and $servers/$Servers in State.psm1; it costs nothing to
# avoid and is invisible when hit.
$restArgs = @()
if ($Rest) { $restArgs = @($Rest | Where-Object { $_ }) }
$code = 0

switch (($Verb + '').ToLower()) {

    '' { Show-Usage; exit 2 }

    'status' {
        # The JSON goes to the OUTPUT stream and is deliberately NOT captured into
        # $code: everything this script prints otherwise is Write-Host, so a caller
        # reading the object stream gets the model and nothing else. Depth 8 covers
        # hosts/servers/drift, which are one level deep.
        if ($Json) {
            Get-StatusModel | ConvertTo-Json -Depth 8
            $code = 0
        } else {
            $code = Show-Status (Get-StatusModel)
        }
    }

    'verify' {
        Require-Record 'verify'
        $extra = @{ VerifyOnly = $true }
        $code = Invoke-Engine -Extra $extra -NeedsReachability
    }

    'set' {
        Require-Record 'reconfigure'
        switch (($Object + '').ToLower()) {
            'url' {
                $url = $restArgs[0]
                if (-not $url) { SayFail 'usage: bconnect set url <https://host/bconnect>'; exit 2 }
                Say 'Changing the base URL changes ONE line in the credentials file. No host'
                Say 'configuration changes at all: a host config carries only a path to that'
                Say 'file, so the launch shape is identical before and after.'
                Say 'The credential is not touched. To change that too: bconnect set credential'
                # A URL change that lands on a DIFFERENT bConnect server is the one
                # thing the installer refuses to do by accident. This verb is the
                # supported way to do it on purpose, so it says so, and hands the
                # engine the URL it read out of the record -- which is what tells the
                # engine this is a deliberate re-point rather than a second install.
                #
                # Same comparison the engine makes, from lib\State.psm1. Not a second
                # rule: one implementation, two callers.
                $move = Get-EstateChange -Record $Record -EnvMap $EnvMap -RequestedUrl $url
                if ($move) {
                    Write-Host ''
                    SayWarn 'this moves the installation to a different bConnect server.'
                    Say ('  from   ' + $move.RecordedUrl)
                    Say ('  to     ' + $move.RequestedUrl)
                    Say 'The entry names, the write gates and the credentials file stay as they are;'
                    Say 'the estate behind them changes. Restart every configured client afterwards,'
                    Say 'and check the write gates before the first job is assigned: bconnect writes show'
                    Write-Host ''
                }
                $recordedUrl = Get-RecordBaseUrl $Record
                # Nothing is prompted for here, and that is deliberate. The engine reads
                # "no credential supplied" as "keep everything", which would make it
                # ignore -BaseUrl as well -- so the stored credential is handed back to
                # it in process, and the URL is the one thing that moves.
                $extra = @{ BaseUrl = $url }
                if ($recordedUrl) { $extra['ReplacingBaseUrl'] = $recordedUrl }
                if ($EnvMap.Contains('BCONNECT_API_KEY') -and $EnvMap['BCONNECT_API_KEY']) {
                    $extra['ApiKeySecure'] = (ConvertTo-SecureString ([string]$EnvMap['BCONNECT_API_KEY']) -AsPlainText -Force)
                } elseif ($EnvMap.Contains('BCONNECT_USERNAME')) {
                    $extra['BasicUser']       = [string]$EnvMap['BCONNECT_USERNAME']
                    $extra['BasicPassSecure'] = (ConvertTo-SecureString ([string]$EnvMap['BCONNECT_PASSWORD']) -AsPlainText -Force)
                } else {
                    SayFail 'there is no stored credential, so there is nothing to re-point.'
                    Say 'Run .\Install-BConnectMcp.ps1 to install, or: bconnect set credential'
                    exit 2
                }
                $code = Invoke-Engine -Extra $extra -NeedsReachability
            }
            'credential' {
                # Prompted here, or handed over by a caller that cannot answer a
                # prompt. Either way the value is a SecureString from the moment it
                # exists and the engine is called in process, so it never becomes
                # text and never reaches a command line.
                $url = [string]$EnvMap['BCONNECT_BASE_URL']
                if ($BasicUser -and $BasicPassSecure) {
                    if ($BasicPassSecure.Length -eq 0) { SayFail 'the supplied password is empty; nothing changed.'; exit 2 }
                    $code = Invoke-Engine -Extra @{ BaseUrl = $url; BasicUser = $BasicUser; BasicPassSecure = $BasicPassSecure } -NeedsReachability
                } else {
                    $sec = $ApiKeySecure
                    if (-not $sec) { $sec = Read-Host -Prompt '  bConnect API key (hidden)' -AsSecureString }
                    if ($sec.Length -eq 0) { SayFail 'nothing entered; nothing changed.'; exit 2 }
                    $code = Invoke-Engine -Extra @{ BaseUrl = $url; ApiKeySecure = $sec } -NeedsReachability
                }
            }
            'v11-credential' {
                $u = $V11User
                if (-not $u) { $u = (Read-Host '  v1.1 username in UPN form (e.g. svc-bconnect@corp.local)') }
                $u = ($u + '').Trim()
                if (-not $u) { SayFail 'nothing entered; nothing changed.'; exit 2 }
                $sec = $V11PassSecure
                if (-not $sec) { $sec = Read-Host -Prompt '  v1.1 password (hidden)' -AsSecureString }
                if ($sec.Length -eq 0) { SayFail 'nothing entered; nothing changed.'; exit 2 }
                $extra = @{ BaseUrl = [string]$EnvMap['BCONNECT_BASE_URL']; V11User = $u; V11PassSecure = $sec }
                if ($EnvMap.Contains('BCONNECT_API_KEY') -and $EnvMap['BCONNECT_API_KEY']) {
                    $extra['ApiKeySecure'] = (ConvertTo-SecureString ([string]$EnvMap['BCONNECT_API_KEY']) -AsPlainText -Force)
                }
                $code = Invoke-Engine -Extra $extra -NeedsReachability
            }
            'audit' {
                # Neither a credential nor a capability gate, but it lives in the
                # credentials file because that is the file every server is launched
                # with. So it goes the same way everything else does: one targeted
                # engine call, which edits that one line and leaves the rest of the
                # file byte-identical.
                $lvl = ($restArgs[0] + '').ToLower()
                if (@('all','write','security','none') -notcontains $lvl) {
                    SayFail 'usage: bconnect set audit all|write|security|none'
                    Say 'all      every tool call.   write     calls that change something (the default).'
                    Say 'security the security-relevant subset.   none      nothing is recorded.'
                    exit 2
                }
                Say 'Audit records go to the server''s standard error, which is wherever your MCP'
                Say 'client keeps its logs, and to BCONNECT_AUDIT_FILE if that is set.'
                Say 'A running server keeps the level it started with until its process restarts.'
                $code = Invoke-Engine -Extra @{ AuditLevel = $lvl }
            }
            'rate-limit' {
                $onoff = ($restArgs[0] + '').ToLower()
                if (@('on','off') -notcontains $onoff) {
                    SayFail 'usage: bconnect set rate-limit on [max] [window-ms] | rate-limit off'
                    exit 2
                }
                $extra = @{ RateLimit = $onoff }
                if ($onoff -eq 'on') {
                    if ($restArgs.Count -ge 2) {
                        $mx = 0
                        if (-not [int]::TryParse($restArgs[1], [ref]$mx) -or $mx -lt 1) {
                            SayFail 'the request count must be a whole number of 1 or more.'; exit 2
                        }
                        $extra['RateLimitMaxRequests'] = $mx
                    }
                    if ($restArgs.Count -ge 3) {
                        $wn = 0
                        if (-not [int]::TryParse($restArgs[2], [ref]$wn) -or $wn -lt 1000) {
                            SayFail 'the window must be a whole number of milliseconds, 1000 or more.'; exit 2
                        }
                        $extra['RateLimitWindowMs'] = $wn
                    }
                }
                Say 'The limit is per server process, not per estate: every server started from'
                Say 'this credentials file counts its own calls. A running server keeps the'
                Say 'setting it started with until its process restarts.'
                $code = Invoke-Engine -Extra $extra
            }
            default {
                SayFail ('usage: bconnect set url <url> | set credential | set v11-credential | ' +
                         'set audit <level> | set rate-limit on|off [max] [ms]')
                exit 2
            }
        }
    }

    'enable' {
        Require-Record 'reconfigure'
        if (($Object + '').ToLower() -ne 'v11') { SayFail 'usage: bconnect enable v11'; exit 2 }
        if (-not ($EnvMap.Contains('BCONNECT_V11_USERNAME') -and $EnvMap['BCONNECT_V11_USERNAME'])) {
            SayFail 'there are no v1.1 credentials stored, so there is nothing to enable.'
            Say 'Run:  .\bconnect.ps1 set v11-credential'
            Say 'v1.1 needs a Windows/AD domain account in a bConnect security group -- a more'
            Say 'privileged credential than the API key, and it must be in UPN form.'
            exit 2
        }
        $code = Invoke-Engine -Extra @{}   # the engine sets the gate from the stored credentials
    }

    'disable' {
        Require-Record 'reconfigure'
        if (($Object + '').ToLower() -ne 'v11') { SayFail 'usage: bconnect disable v11'; exit 2 }
        SayWarn 'v1.1 is disabled by removing the credentials it needs.'
        Say 'The gate and the credentials are one decision: a gate with no credentials'
        Say 'advertises tools that fail on every call, which is worse than not having them.'
        if (-not $Yes) {
            $a = Read-Host '  remove the stored v1.1 credentials and the gate? [y/N]'
            if ($a -notmatch '^(y|yes)$') { Say 'nothing changed.'; exit 0 }
        }
        $text = Read-BConnectEnvText -EnvFile $EnvFile
        $text = Merge-EnvText -Text $text -Remove @('BCONNECT_V11_USERNAME', 'BCONNECT_V11_PASSWORD')
        [void](Write-BConnectEnvStore -EnvFile $EnvFile -Content $text -Protected:($Store.Mode -eq 'protected'))
        $text = $null
        SayOk 'v1.1 credentials removed from the credentials file'
        $code = Invoke-Engine -Extra @{}
    }

    'servers' {
        $current = @($Servers)
        switch (($Object + '').ToLower()) {
            'list' {
                Require-Record 'list'
                foreach ($n in $current) { Say ('  ' + $n) }
                if (-not $current.Count) { Say '  (none)' }
                $code = 0
            }
            'add' {
                Require-Record 'reconfigure'
                $add = @(($restArgs -join ',') -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
                if (-not $add.Count) { SayFail 'usage: bconnect servers add <server>[,<server>...]'; exit 2 }
                $want = @($current + $add | Select-Object -Unique)
                # Build the added packages only. The whole point of a verb is that it
                # does not rebuild 14 packages to add one.
                $code = Invoke-Engine -Extra @{ Servers = ($want -join ','); SkipBuildOff = $true; BuildSelectedOnly = $true }
            }
            'remove' {
                Require-Record 'reconfigure'
                $rm = @(($restArgs -join ',') -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
                if (-not $rm.Count) { SayFail 'usage: bconnect servers remove <server>[,<server>...]'; exit 2 }
                $want = @($current | Where-Object { $rm -notcontains $_ })
                if (-not $want.Count) {
                    SayFail 'that would leave no servers configured. Use "bconnect uninstall" instead.'
                    exit 2
                }
                $code = Invoke-Engine -Extra @{ Servers = ($want -join ','); RemoveUnselected = $true }
            }
            'set' {
                Require-Record 'reconfigure'
                $want = @(($restArgs -join ',') -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
                if (-not $want.Count) { SayFail 'usage: bconnect servers set <server>[,<server>...]'; exit 2 }
                $code = Invoke-Engine -Extra @{ Servers = ($want -join ','); RemoveUnselected = $true }
            }
            default { SayFail 'usage: bconnect servers list | add <a,b> | remove <a,b> | set <a,b>'; exit 2 }
        }
    }

    'writes' {
        Require-Record 'reconfigure'
        switch (($Object + '').ToLower()) {
            'show' {
                $deployed = Get-DeployedServerEnv -HostFiles (Get-HostFiles $HostIds)
                foreach ($n in @($deployed.Keys)) {
                    $b = $deployed[$n]
                    if ($b.Contains('ALLOW_WRITE_OPERATIONS') -and $b['ALLOW_WRITE_OPERATIONS'] -eq 'true') {
                        $t = '(all write tools)'
                        if ($b.Contains('ALLOWED_WRITE_TOOLS') -and $b['ALLOWED_WRITE_TOOLS']) { $t = $b['ALLOWED_WRITE_TOOLS'] }
                        Say ('  ' + $n.PadRight(30) + 'writes ENABLED  ' + $t)
                    } else {
                        Say ('  ' + $n.PadRight(30) + 'read-only')
                    }
                }
                $code = 0
            }
            'enable' {
                $srv = $restArgs[0]
                if (-not $srv) { SayFail 'usage: bconnect writes enable <server> [tool ...]   ("*" for all)'; exit 2 }
                $tools = @($restArgs | Select-Object -Skip 1)
                if (-not $tools.Count) { $tools = @('*') }
                $code = Invoke-Engine -Extra @{ WriteGate = @{ $srv = $tools } }
            }
            'disable' {
                $srv = $restArgs[0]
                if (-not $srv) { SayFail 'usage: bconnect writes disable <server>'; exit 2 }
                # An EMPTY list is how "remove the gate from this server" is said. A
                # server simply absent from -WriteGate keeps what it has, which is what
                # makes every other verb non-destructive.
                $code = Invoke-Engine -Extra @{ WriteGate = @{ $srv = @() } }
            }
            'disable-all' {
                $code = Invoke-Engine -Extra @{ ReadOnly = $true }
            }
            default { SayFail 'usage: bconnect writes show | enable <server> [tools...] | disable <server> | disable-all'; exit 2 }
        }
    }

    'hosts' {
        switch (($Object + '').ToLower()) {
            'list' {
                Require-Record 'list'
                foreach ($hf in (Get-HostFiles $HostIds)) {
                    Say ('  ' + $hf.id.PadRight(16) + $hf.path +
                         $(if (Test-Path -LiteralPath $hf.path) { '' } else { '   MISSING' }))
                }
                $code = 0
            }
            'add' {
                Require-Record 'reconfigure'
                $add = @(($restArgs -join ',') -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
                if (-not $add.Count) { SayFail 'usage: bconnect hosts add <id>   (see .\Install-BConnectMcp.ps1 -ListHosts)'; exit 2 }
                $bad = @($add | Where-Object { ($AllHosts | Select-Object -ExpandProperty id) -notcontains $_ })
                if ($bad.Count) { SayFail ('unknown host target(s): ' + ($bad -join ', ')); exit 2 }
                $HostIds = @($HostIds + $add | Select-Object -Unique)
                $code = Invoke-Engine -Extra @{ Hosts = ($HostIds -join ',') }
            }
            'remove' {
                Require-Record 'reconfigure'
                $rm = @(($restArgs -join ',') -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
                if (-not $rm.Count) { SayFail 'usage: bconnect hosts remove <id>'; exit 2 }
                # Strip the managed entries from the hosts being dropped, then re-emit
                # to the ones that remain. Two engine calls, no third implementation.
                $code = Invoke-Engine -Extra @{ Hosts = ($rm -join ','); Uninstall = $true; HostEntriesOnly = $true }
                if ($code -eq 0) {
                    $keep = @($HostIds | Where-Object { $rm -notcontains $_ })
                    if ($keep.Count) {
                        $HostIds = $keep
                        $code = Invoke-Engine -Extra @{ Hosts = ($keep -join ',') }
                    } else {
                        SayWarn 'that was the last configured host; nothing is configured now.'
                    }
                }
            }
            'resync' {
                Require-Record 'reconfigure'
                Say 'Re-emitting every recorded host from the record. Hand-edited managed'
                Say 'entries are replaced with the installer''s version; a backup is taken first.'
                $code = Invoke-Engine -Extra @{ Force = $true }
            }
            default { SayFail 'usage: bconnect hosts list | add <id> | remove <id> | resync'; exit 2 }
        }
    }

    'gateway' {
        Require-Record 'reconfigure'
        switch (($Object + '').ToLower()) {
            'enable'       { $code = Invoke-Engine -Extra @{ Gateway = $true } }
            'disable'      {
                SayWarn 'the gateway is configuration, not an installed service: disabling it here'
                Say 'removes nothing that is running. Stop the gateway process, then remove the'
                Say 'hosts that consume it with "bconnect hosts remove <id>".'
                $code = 0
            }
            'rotate-token' { $code = Invoke-Engine -Extra @{ Gateway = $true; RotateGatewayToken = $true } }
            default        { SayFail 'usage: bconnect gateway enable | disable | rotate-token'; exit 2 }
        }
    }

    'protect'   { Require-Record 'reconfigure'; $code = Invoke-Engine -Extra @{ ProtectCredentials = $true;   ReuseCredentials = $true } }
    'unprotect' { Require-Record 'reconfigure'; $code = Invoke-Engine -Extra @{ PlaintextCredentials = $true; ReuseCredentials = $true } }

    'uninstall' {
        if (-not $Record) {
            SayWarn 'no installation record and no bconnect-* entries found.'
            Say 'Running the uninstall anyway: it will search every known host file.'
        }
        if (-not $Yes -and -not $DryRun) {
            Write-Host ''
            Say 'This removes the bconnect-* entries from every configured host, the'
            Say ('credentials file' + $(if ($KeepCredentials) { ' (KEPT -- -KeepCredentials given)' } else { '' }) + ', and the installation record.')
            Say 'Everything a host file contains that this installer does not own is left'
            Say 'byte-identical, and a backup is taken first.'
            $a = Read-Host '  type UNINSTALL to confirm'
            if ($a -cne 'UNINSTALL') { Say 'nothing changed.'; exit 0 }
        }
        $extra = @{ Uninstall = $true }
        if ($KeepCredentials) { $extra['KeepCredentials'] = $true }
        $code = Invoke-Engine -Extra $extra
    }

    default {
        SayFail ("unknown verb: $Verb")
        Show-Usage
        exit 2
    }
}

if ($null -eq $code) { $code = 0 }
exit $code
