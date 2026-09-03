<#
.SYNOPSIS
    Tests for the two-stage split (-Stage Machine|User|Both) and for the refusal
    that makes silent deployment safe: a context with no interactive user profile
    cannot emit a per-user host configuration.

.DESCRIPTION
    Everything here runs against a throwaway directory tree with dummy credentials
    and a base URL that does not resolve. It never reads, writes or touches the real
    credentials file, the real Claude Desktop configuration, or the real installation
    record, and it makes no network call that can reach the live bMS.

    THE POINT OF THIS FILE is that a silent, SYSTEM-context deployment of an install
    whose configuration lives at per-user paths produces files no client will ever
    read AND REPORTS SUCCESS. That is the same failure class as a green verification
    against a config nothing loads, arriving by a different route, and a warning does
    not close it -- only a refusal does.

    HOW A SYSTEM CONTEXT IS SIMULATED, AND WHY THAT IS HONEST
    ---------------------------------------------------------
    This suite cannot become LocalSystem, and a test that needed to would never be
    run. It does not need to. The detection rule in lib\UserContext.psm1 is three
    ORed signals, and one of them -- %APPDATA% resolving under a config\systemprofile
    directory -- is the one that decides the OUTCOME rather than the identity: it is
    exactly the condition that makes a write land somewhere invisible. So the child
    process is given an APPDATA of

        <scratch>\fakewin\System32\config\systemprofile\AppData\Roaming

    which matches the rule, lands inside the scratch tree, and lets the whole engine
    run for real. The SID half of the rule is exercised directly against the module,
    where a SID can simply be presented.

    That split is deliberate and is stated rather than hidden: what is NOT proved
    here is a real LocalSystem process. See the header of Test-Reconfigure.ps1 for
    the same discipline applied to credentials.

.EXAMPLE
    .\Test-StageSplit.ps1
#>
[CmdletBinding()]
param([string] $WorkDir, [string] $Only, [switch] $KeepWork)

$ErrorActionPreference = 'Stop'

$LibDir       = $PSScriptRoot
$InstallerDir = Split-Path -Parent $LibDir
$Installer    = Join-Path $InstallerDir 'Install-BConnectMcp.ps1'
$SuiteRoot    = Join-Path (Split-Path -Parent $InstallerDir) 'bConnect-MCP-main'

Import-Module (Join-Path $LibDir 'Secrets.psm1')     -Force
Import-Module (Join-Path $LibDir 'Dpapi.psm1')       -Force -DisableNameChecking
Import-Module (Join-Path $LibDir 'State.psm1')       -Force -DisableNameChecking
Import-Module (Join-Path $LibDir 'UserContext.psm1') -Force -DisableNameChecking

if (-not $WorkDir) {
    $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-stage-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
}

# Dummy values. None of these is a credential for anything.
$DUMMY_KEY = 'dummy-api-key-0000-not-real'
$BAD_URL   = 'https://bms.invalid.example/bconnect'

# The path fragment the rule is written against. Spelled once here so a test that
# passes because it agreed with a typo cannot exist.
$SYSPROFILE_TAIL = 'fakewin\System32\config\systemprofile\AppData\Roaming'

$script:Pass = 0
$script:Fail = 0
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}
function Group {
    param([string] $Name)
    Write-Host ''
    Write-Host ("  -- $Name " + ('-' * [Math]::Max(0, 58 - $Name.Length))) -ForegroundColor Cyan
}

# -----------------------------------------------------------------------------
# Running the engine
# -----------------------------------------------------------------------------
# In a CHILD process, and through a generated runner script rather than a command
# line, for three reasons: -ApiKeySecure is a [SecureString] and cannot cross a
# process boundary as text (which is the whole point of it), the installer calls
# exit, and -- the reason this file needs it and Test-Reconfigure does not -- the
# child's ENVIRONMENT is what presents the context under test. APPDATA has to be
# set in the process that reads it, before that process starts the engine.
$script:RunSeq = 0
function ConvertTo-Literal {
    param($V)
    if ($null -eq $V) { return '$null' }
    if ($V -is [string] -and $V.StartsWith('#RAW#')) { return $V.Substring(5) }
    if ($V -is [bool] -or $V -is [switch]) { return $(if ([bool]$V) { '$true' } else { '$false' }) }
    if ($V -is [int]) { return [string]$V }
    if ($V -is [hashtable] -or $V -is [System.Collections.IDictionary]) {
        $parts = @()
        foreach ($k in $V.Keys) { $parts += ("'" + ($k -replace "'", "''") + "' = " + (ConvertTo-Literal $V[$k])) }
        return ('@{ ' + ($parts -join '; ') + ' }')
    }
    if ($V -is [array]) {
        $parts = @()
        foreach ($e in $V) { $parts += (ConvertTo-Literal $e) }
        return ('@(' + ($parts -join ', ') + ')')
    }
    return ("'" + ([string]$V -replace "'", "''") + "'")
}

function Invoke-Engine {
    param(
        [hashtable] $Params = @{},
        [hashtable] $Env    = @{},
        [string]    $Work
    )
    $script:RunSeq++
    $runner = Join-Path $Work ('run-{0:d2}.ps1' -f $script:RunSeq)
    $log    = Join-Path $Work ('run-{0:d2}.log' -f $script:RunSeq)

    $lines = @('$ErrorActionPreference = ''Continue''')
    foreach ($k in $Env.Keys) {
        $lines += ('$env:' + $k + ' = ' + (ConvertTo-Literal $Env[$k]))
    }
    $lines += '$p = @{}'
    foreach ($k in $Params.Keys) {
        $lines += ('$p[''' + $k + '''] = ' + (ConvertTo-Literal $Params[$k]))
    }
    $lines += ('$out = & ''' + $Installer + ''' @p *>&1 | Out-String')
    $lines += '$code = $LASTEXITCODE'
    $lines += ('Set-Content -LiteralPath ''' + $log + ''' -Value $out -Encoding UTF8')
    $lines += 'if ($null -eq $code) { $code = 0 }'
    $lines += 'exit $code'
    Set-Content -LiteralPath $runner -Value ($lines -join "`r`n") -Encoding UTF8

    # 2>&1 is load-bearing: without it, anything the child writes to stderr becomes a
    # NativeCommandError in THIS session, and $ErrorActionPreference='Stop' then ends
    # the whole test run instead of failing one check.
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $runner 2>&1 | Out-Null
    $code = $LASTEXITCODE
    $out = ''
    if (Test-Path -LiteralPath $log) { $out = Get-Content -LiteralPath $log -Raw }
    return @{ Code = $code; Output = $out }
}

function New-Scenario {
    param([string] $Name)
    $w = Join-Path $WorkDir $Name
    $s = [ordered]@{
        Root       = $w
        SecretsDir = Join-Path $w 'secrets'
        ProjectDir = Join-Path $w 'project'
        HostOutDir = Join-Path $w 'out'
        StateFile  = Join-Path $w 'state\installation.json'
        ConfigPath = Join-Path $w 'claude\claude_desktop_config.json'
        # The two profiles the child can be given. Both are inside the scratch tree,
        # so nothing this suite does can reach a real user's AppData.
        SysProfile = Join-Path $w $SYSPROFILE_TAIL
        UsrProfile = Join-Path $w 'fakeuser\AppData\Roaming'
    }
    New-Item -ItemType Directory -Path $w -Force | Out-Null
    New-Item -ItemType Directory -Path $s.ProjectDir -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $s.ConfigPath) -Force | Out-Null
    $s.EnvFile = Join-Path $s.SecretsDir 'bconnect.env'
    $s.Common  = @{
        SuiteRoot             = $SuiteRoot
        SecretsDir            = $s.SecretsDir
        ConfigPath            = $s.ConfigPath
        ProjectDir            = $s.ProjectDir
        HostOutDir            = $s.HostOutDir
        StateFile             = $s.StateFile
        NonInteractive        = $true
        SkipBuild             = $true
        ContinueOnUnreachable = $true
    }
    # The credential parameters a user-stage or Both run needs.
    $s.Creds = @{
        BaseUrl      = $BAD_URL
        ApiKeySecure = "#RAW#(ConvertTo-SecureString '$DUMMY_KEY' -AsPlainText -Force)"
    }
    return [pscustomobject]$s
}

function Get-Record {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
}

function Get-ConfigServerNames {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    $j = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if (-not $j.mcpServers) { return @() }
    return @($j.mcpServers.PSObject.Properties.Name)
}

# Everything under a root, relative and sorted, so two runs can be compared as sets
# rather than as trees. Runner scripts and logs are this harness's own droppings.
function Get-TreeManifest {
    param([string] $Root)
    if (-not (Test-Path -LiteralPath $Root)) { return @() }
    $full = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\') + '\'
    return @(Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue |
             ForEach-Object { $_.FullName.Substring($full.Length) } |
             Where-Object { $_ -notmatch '^run-\d+\.(ps1|log)$' } |
             Sort-Object)
}

Write-Host ''
Write-Host "Stage-split tests -- scratch tree: $WorkDir" -ForegroundColor Cyan
Write-Host '  live bMS: never contacted. Base URL is a domain that does not resolve.' -ForegroundColor DarkGray
Write-Host '  live AppData: never touched. Every APPDATA the child sees is inside the tree.' -ForegroundColor DarkGray

$started = Get-Date
try {

# =============================================================================
# 1. The context rule itself
# =============================================================================
# Unit level, against lib\UserContext.psm1, because this is where the SID half of
# the rule can be presented directly and where "fails safe" can be shown rather
# than asserted.
Group 'Get-ProcessUserContext -- the three signals'

$ctxReal = Get-ProcessUserContext
Check 'CONTROL: this interactive session IS a per-user context' $ctxReal.IsPerUser `
      ($ctxReal.Account + '  ' + $ctxReal.AppData)

$ctxSys = Get-ProcessUserContext -AppData 'C:\Windows\System32\config\systemprofile\AppData\Roaming' `
                                 -UserProfile 'C:\Windows\System32\config\systemprofile'
Check 'APPDATA under System32\config\systemprofile is not a per-user context' (-not $ctxSys.IsPerUser) `
      (($ctxSys.Reasons) -join ' | ')

# A 32-bit PowerShell under SYSTEM resolves the redirected profile. The rule must
# not be written against the System32 prefix.
$ctxWow = Get-ProcessUserContext -AppData 'C:\Windows\SysWOW64\config\systemprofile\AppData\Roaming' -UserProfile 'C:\Users\x'
Check 'the SysWOW64 system profile is caught too (a 32-bit process under SYSTEM)' (-not $ctxWow.IsPerUser)

# A non-C: system drive.
$ctxD = Get-ProcessUserContext -AppData 'D:\Windows\System32\config\systemprofile\AppData\Roaming' -UserProfile 'D:\Users\x'
Check 'a system profile on a non-C: system drive is caught' (-not $ctxD.IsPerUser)

$ctxNone = Get-ProcessUserContext -AppData '' -UserProfile ''
Check 'no APPDATA at all is not a per-user context (no profile loaded)' (-not $ctxNone.IsPerUser) `
      (($ctxNone.Reasons) -join ' | ')

Check 'a normal profile path is a per-user context' `
      ((Get-ProcessUserContext -AppData 'C:\Users\alice\AppData\Roaming' -UserProfile 'C:\Users\alice').IsPerUser)

# The rule is written against SIDs, not names, because the names are localised and
# a German-language Windows reports NT-AUTORITAET\SYSTEM.
$mod = Get-Content -LiteralPath (Join-Path $LibDir 'UserContext.psm1') -Raw
foreach ($sid in @('S-1-5-18', 'S-1-5-19', 'S-1-5-20')) {
    Check ("the well-known service SID $sid is in the rule") ($mod -match [regex]::Escape($sid))
}
# Asserted on BEHAVIOUR rather than on the text, because the header EXPLAINS that a
# name-based rule would not fire on a non-English Windows and a text search would
# read the explanation as the rule. Every key of the lookup table has to be a SID.
$sidTable = & (Get-Module UserContext) { $script:SERVICE_SIDS }
Check 'the service-account lookup is keyed on SIDs, never on the localised names' `
      (@($sidTable.Keys).Count -eq 3 -and -not @($sidTable.Keys | Where-Object { $_ -notmatch '^S-1-5-\d+$' }).Count) `
      (@($sidTable.Keys) -join ', ')

# =============================================================================
# 2. The refusal, as a decision
# =============================================================================
Group 'Get-PerUserWriteRefusal -- what is refused and what is not'

$registry  = (Get-Content -LiteralPath (Join-Path $LibDir 'hosts.json') -Raw | ConvertFrom-Json).targets
$tClaude   = $registry | Where-Object { $_.id -eq 'claude-desktop' }
$tCodex    = $registry | Where-Object { $_.id -eq 'codex' }
$tVscode   = $registry | Where-Object { $_.id -eq 'vscode' }
$tGeneric  = $registry | Where-Object { $_.id -eq 'generic' }
$tN8n      = $registry | Where-Object { $_.id -eq 'n8n' }

Check 'claude-desktop is a per-user target'  (Test-HostTargetIsPerUser -Target $tClaude)
Check 'codex is a per-user target'           (Test-HostTargetIsPerUser -Target $tCodex)
Check 'vscode ({PROJECT}) is a per-user target -- a workspace belongs to a person' `
      (Test-HostTargetIsPerUser -Target $tVscode)
Check 'generic ({OUT}) is NOT a per-user target -- the machine owns install\out' `
      (-not (Test-HostTargetIsPerUser -Target $tGeneric))
Check 'the detection predicate stays narrower: vscode is not user-SCOPED' `
      (-not (Test-HostTargetIsUserScoped -Target $tVscode)) 'a {PROJECT} path is not evidence a client ran here'

$svcCtx = Get-ProcessUserContext -AppData 'C:\Windows\System32\config\systemprofile\AppData\Roaming' -UserProfile 'C:\Windows'
$usrCtx = Get-ProcessUserContext -AppData 'C:\Users\alice\AppData\Roaming' -UserProfile 'C:\Users\alice'

$perUserTargets = @(@{ id = 'claude-desktop'; path = 'C:\Users\alice\AppData\Roaming\Claude\claude_desktop_config.json'; target = $tClaude })
$snippetTargets = @(@{ id = 'n8n';     path = 'C:\Program Files\bConnect-MCP\install\out\n8n.md';     target = $tN8n },
                    @{ id = 'generic'; path = 'C:\Program Files\bConnect-MCP\install\out\generic.md'; target = $tGeneric })

Check 'CONTROL: a per-user context writing a per-user config is PERMITTED' `
      ($null -eq (Get-PerUserWriteRefusal -Targets $perUserTargets -Context $usrCtx))
Check 'a service context writing a per-user config is REFUSED' `
      ($null -ne (Get-PerUserWriteRefusal -Targets $perUserTargets -Context $svcCtx))
Check 'a service context writing only {OUT} snippets is PERMITTED (the central shape)' `
      ($null -eq (Get-PerUserWriteRefusal -Targets $snippetTargets -Context $svcCtx)) `
      'the gateway shape holds no per-user state, so it stays fully silent-capable'
Check 'a service context writing NOTHING is PERMITTED (this is -Stage Machine)' `
      ($null -eq (Get-PerUserWriteRefusal -Targets @() -Context $svcCtx))
Check 'a service context with -ProtectCredentials is REFUSED even with no host targets' `
      ($null -ne (Get-PerUserWriteRefusal -Targets @() -ProtectCredentials $true -Context $svcCtx)) `
      'DPAPI is CurrentUser scope, so the blob would be decryptable by the service account only'
Check 'CONTROL: a per-user context with -ProtectCredentials is PERMITTED' `
      ($null -eq (Get-PerUserWriteRefusal -Targets @() -ProtectCredentials $true -Context $usrCtx))

# A path already under the system profile is refused whoever this process is. The
# identity check being inconclusive does not make that destination acceptable.
$sysPathTargets = @(@{ id = 'claude-desktop'
                       path = 'C:\Windows\System32\config\systemprofile\AppData\Roaming\Claude\claude_desktop_config.json'
                       target = $tClaude })
$sysPathRefusal = Get-PerUserWriteRefusal -Targets $sysPathTargets -Context $usrCtx
Check 'a systemprofile DESTINATION is refused even from a per-user context' ($null -ne $sysPathRefusal)
Check 'and the refusal names the path it refused' `
      ($sysPathRefusal -and (($sysPathRefusal.Detail -join ' ') -match 'systemprofile'))

$r = Get-PerUserWriteRefusal -Targets $perUserTargets -Context $svcCtx
Check 'the refusal names the two-stage pattern as the action' `
      (($r.Action -join ' ') -match '-Stage Machine' -and ($r.Action -join ' ') -match '-Stage User')
Check 'the refusal states the account it is refusing for' `
      (($r.Detail -join ' ') -match [regex]::Escape($svcCtx.Account))

# =============================================================================
# 3. -Stage Machine: no credential, no per-user path
# =============================================================================
Group '-Stage Machine writes nothing per-user and collects no credential'

$sM = New-Scenario 'machine'
$pM = @{} + $sM.Common
$pM['Stage']   = 'Machine'
$pM['Servers'] = 'bconnect-endpoints'
$pM['Hosts']   = 'claude-desktop,vscode'
$rM = Invoke-Engine -Params $pM -Work $sM.Root

Check '-Stage Machine exits 0' ($rM.Code -eq 0) ("exit $($rM.Code)")
Check 'no credentials file was written' (-not (Test-Path -LiteralPath $sM.EnvFile))
Check 'no Claude Desktop configuration was written' (-not (Test-Path -LiteralPath $sM.ConfigPath))
Check 'no per-project mcp.json was written' `
      (-not (Test-Path -LiteralPath (Join-Path $sM.ProjectDir '.vscode\mcp.json')))
Check 'it says the credentials step was skipped, and why' `
      ($rM.Output -match 'the machine stage collects no credential')
Check 'it says no host configuration was written' `
      ($rM.Output -match 'no host configuration is written by the machine stage')
Check 'it names the user stage as the next action' ($rM.Output -match '-Stage User')

# -ProjectDir is not demanded, because the workspace belongs to whoever opens it and
# a SYSTEM job has no answer for it. Recording vscode as INTENT must still work.
$sM2 = New-Scenario 'machine-noprojectdir'
$pM2 = @{} + $sM2.Common
$pM2.Remove('ProjectDir')
$pM2['Stage']   = 'Machine'
$pM2['Servers'] = 'bconnect-endpoints'
$pM2['Hosts']   = 'vscode'
$rM2 = Invoke-Engine -Params $pM2 -Work $sM2.Root
Check '-Stage Machine does not demand -ProjectDir for a {PROJECT} target' ($rM2.Code -eq 0) `
      ("exit $($rM2.Code)")
Check 'and vscode is still recorded as intended' `
      (@((Get-Record $sM2.StateFile).intendedHosts) -contains 'vscode')

# A credential handed to the machine stage is a mistake in a deployment job, not an
# option, so it is named rather than ignored.
$sM3 = New-Scenario 'machine-with-credential'
$pM3 = @{} + $sM3.Common + $sM3.Creds
$pM3['Stage'] = 'Machine'
$rM3 = Invoke-Engine -Params $pM3 -Work $sM3.Root
Check '-Stage Machine with -ApiKeySecure is refused rather than silently ignored' ($rM3.Code -eq 1) `
      ("exit $($rM3.Code)")
Check 'and the refusal names the parameter and the user stage' `
      ($rM3.Output -match 'ApiKeySecure' -and $rM3.Output -match '-Stage User')

# =============================================================================
# 4. -Stage User: the other half, and only the other half
# =============================================================================
Group '-Stage User configures this account from the recorded intent'

$sU = New-Scenario 'user'
# Machine stage first, exactly as a baramundi job would run it.
$pU1 = @{} + $sU.Common
$pU1['Stage']   = 'Machine'
$pU1['Servers'] = 'bconnect-endpoints'
$pU1['Hosts']   = 'claude-desktop'
$rU1 = Invoke-Engine -Params $pU1 -Work $sU.Root
Check 'the machine stage ran' ($rU1.Code -eq 0) ("exit $($rU1.Code)")

# Then the user stage, told NOTHING about which clients or servers. The whole
# handoff is the record.
$pU2 = @{} + $sU.Common + $sU.Creds
$pU2['Stage'] = 'User'
$pU2.Remove('SkipBuild')
$rU2 = Invoke-Engine -Params $pU2 -Work $sU.Root

# Not "exit 0". Every full run in this harness ends non-zero, because verification
# starts each server for real and the base URL is a domain that deliberately does
# not resolve -- which is what makes the run safe to make at all. What is asserted
# is that it ran the whole way rather than stopping at a stage gate.
Check '-Stage User runs to the end' ($rU2.Output -match '(?m)^ Finished') `
      ("exit $($rU2.Code)")
Check 'and it was not refused' ($rU2.Output -notmatch 'cannot be written from this context')
Check 'the credentials file now exists' (Test-Path -LiteralPath $sU.EnvFile)
$mU = @{}
try { $mU = Read-BConnectEnvMap -EnvFile $sU.EnvFile } catch { }
Check 'and it carries the base URL that was passed' ($mU['BCONNECT_BASE_URL'] -eq $BAD_URL)
Check 'the host configuration now exists' (Test-Path -LiteralPath $sU.ConfigPath)
Check 'and it carries the server the MACHINE stage recorded, with no -Servers given' `
      ((Get-ConfigServerNames $sU.ConfigPath) -contains 'bconnect-endpoints') `
      ('found: ' + ((Get-ConfigServerNames $sU.ConfigPath) -join ', '))
Check 'the user stage does not build -- the machine stage owns that' `
      ($rU2.Output -match 'the suite is built by the machine stage')
Check 'the user stage does verify' ($rU2.Output -match '-- Verification')

# =============================================================================
# 5. A simulated service context cannot emit a per-user config
# =============================================================================
# The engine runs for real; only APPDATA differs, and it is inside the scratch tree.
# -ConfigPath is deliberately NOT passed here: the point is the path the installer
# RESOLVES for itself, which is what a silent deployment would have got.
Group 'A context with no user profile is refused -- and the control that proves it'

$sS = New-Scenario 'sysctx'
$pS = @{} + $sS.Common + $sS.Creds
$pS.Remove('ConfigPath')
$pS['Servers'] = 'bconnect-endpoints'
$pS['Hosts']   = 'claude-desktop'

$rSys = Invoke-Engine -Params $pS -Env @{ APPDATA = $sS.SysProfile } -Work $sS.Root
Check 'a simulated service context is REFUSED' ($rSys.Code -eq 1) ("exit $($rSys.Code)")
Check 'and it says so' `
      ($rSys.Output -match 'Per-user configuration cannot be written from this context')
# Asserted on the run ENDING, not on the banner. A mutation that printed the same
# banner and then carried on scored a pass on the banner alone -- and went on to
# write into the system profile, which is the entire failure being guarded.
Check 'and it STOPS rather than warning and proceeding' `
      ($rSys.Output -notmatch '(?m)^ Finished' -and $rSys.Output -notmatch '-- Host configuration') `
      'the run must not reach the host-configuration step'
Check 'and it states the condition' ($rSys.Output -match 'system profile')
Check 'and it names the two-stage pattern as the action' `
      ($rSys.Output -match '-Stage Machine' -and $rSys.Output -match '-Stage User')
$sysCfg = Join-Path $sS.SysProfile 'Claude\claude_desktop_config.json'
Check 'and NOTHING was written under the system profile' (-not (Test-Path -LiteralPath $sysCfg)) $sysCfg
Check 'and no credentials file was written either' (-not (Test-Path -LiteralPath $sS.EnvFile))

# The control. Without it a mutant that refused every run would score six passes
# above and look like a working guard.
$sC = New-Scenario 'usrctx'
$pC = @{} + $sC.Common + $sC.Creds
$pC.Remove('ConfigPath')
$pC['Servers'] = 'bconnect-endpoints'
$pC['Hosts']   = 'claude-desktop'
$rUsr = Invoke-Engine -Params $pC -Env @{ APPDATA = $sC.UsrProfile } -Work $sC.Root
Check 'CONTROL: the same run with an ordinary APPDATA is PERMITTED' `
      ($rUsr.Output -notmatch 'cannot be written from this context') ("exit $($rUsr.Code)")
Check 'CONTROL: and it did write the configuration' `
      (Test-Path -LiteralPath (Join-Path $sC.UsrProfile 'Claude\claude_desktop_config.json'))

# -Stage Machine from that same context is permitted. That is its entire purpose.
$sSM = New-Scenario 'sysctx-machine'
$pSM = @{} + $sSM.Common
$pSM.Remove('ConfigPath')
$pSM['Stage']   = 'Machine'
$pSM['Servers'] = 'bconnect-endpoints'
$pSM['Hosts']   = 'claude-desktop'
$rSM = Invoke-Engine -Params $pSM -Env @{ APPDATA = $sSM.SysProfile } -Work $sSM.Root
Check '-Stage Machine IS permitted from the same service context' ($rSM.Code -eq 0) ("exit $($rSM.Code)")
Check 'and it wrote nothing under the system profile' `
      (-not (Test-Path -LiteralPath (Join-Path $sSM.SysProfile 'Claude')))
Check 'and it recorded claude-desktop as intended' `
      (@((Get-Record $sSM.StateFile).intendedHosts) -contains 'claude-desktop')

# The emitter's own destination check, which covers the route the installer cannot:
# a plan handed to lib\emit-host-config.mjs by anything else.
$planFile = Join-Path $sS.Root 'sysplan.json'
$emitPath = Join-Path $sS.SysProfile '.codex\config.toml'
([ordered]@{
    outDir  = $sS.HostOutDir
    servers = [ordered]@{ 'bconnect-endpoints' = [ordered]@{ command = 'node'; args = @('x.js'); env = [ordered]@{} } }
    remove  = @()
    gateway = $null
    targets = @(@{ id = 'codex'; path = $emitPath })
} | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $planFile -Encoding UTF8
$emit = & node (Join-Path $LibDir 'emit-host-config.mjs') --plan $planFile 2>&1 | Out-String
$emitCode = $LASTEXITCODE
Check 'emit-host-config.mjs refuses a systemprofile destination on its own' ($emitCode -ne 0) `
      ("exit $emitCode")
Check 'and says why, naming the stage split' `
      ($emit -match 'system profile' -and $emit -match '-Stage Machine')
Check 'and wrote nothing' (-not (Test-Path -LiteralPath $emitPath))

# =============================================================================
# 6. The record distinguishes intended from configured
# =============================================================================
Group 'The record: intended clients versus configured clients'

$sR = New-Scenario 'record'
$pR1 = @{} + $sR.Common
$pR1['Stage']   = 'Machine'
$pR1['Servers'] = 'bconnect-endpoints'
$pR1['Hosts']   = 'claude-desktop,generic'
$null = Invoke-Engine -Params $pR1 -Work $sR.Root
$recM = Get-Record $sR.StateFile

Check 'the machine record exists' ($null -ne $recM)
Check 'it says which stage wrote it' ((Get-RecordStage $recM) -eq 'machine') ("stage: $($recM.stage)")
Check 'intendedHosts holds BOTH clients' `
      (((@(Get-RecordIntendedHostIds $recM) | Sort-Object) -join ',') -eq 'claude-desktop,generic') `
      (@(Get-RecordIntendedHostIds $recM) -join ',')
Check 'hosts[] -- the CONFIGURED list -- is empty, because nothing was configured' `
      (@(Get-RecordHostIds $recM).Count -eq 0) (@(Get-RecordHostIds $recM) -join ',')
Check 'lastRunVerified is false: a machine stage verified nothing' ($recM.lastRunVerified -eq $false)
Check 'configuredBy is empty: no account has configured this installation yet' `
      (-not $recM.configuredBy) ("saw: '" + [string]$recM.configuredBy + "'")

# Now the user stage, told only about ONE of the two intended clients.
$pR2 = @{} + $sR.Common + $sR.Creds
$pR2['Stage'] = 'User'
$pR2['Hosts'] = 'claude-desktop'
$null = Invoke-Engine -Params $pR2 -Work $sR.Root
$recU = Get-Record $sR.StateFile

Check 'after the user stage, hosts[] names the client it configured' `
      (@(Get-RecordHostIds $recU) -contains 'claude-desktop')
Check 'and hosts[] carries the entry hash drift is measured against' `
      ([bool]$recU.hosts[0].entryHashes.'bconnect-endpoints')
Check 'and configuredBy names the Windows account that wrote it' `
      ($recU.configuredBy -eq $ctxReal.Account) ("saw: " + [string]$recU.configuredBy)
Check 'the stage is now user' ((Get-RecordStage $recU) -eq 'user')

# A machine-stage re-run -- a pushed upgrade -- must not erase the drift baseline
# an administrator's user stage established.
$pR3 = @{} + $sR.Common
$pR3['Stage']   = 'Machine'
$pR3['Servers'] = 'bconnect-endpoints'
$pR3['Hosts']   = 'claude-desktop,generic'
$null = Invoke-Engine -Params $pR3 -Work $sR.Root
$recM2 = Get-Record $sR.StateFile
Check 'a machine-stage re-run PRESERVES the configured half' `
      (@(Get-RecordHostIds $recM2) -contains 'claude-desktop') (@(Get-RecordHostIds $recM2) -join ',')
Check 'including its entry hashes' ([bool]$recM2.hosts[0].entryHashes.'bconnect-endpoints')
Check 'and preserves configuredBy' ($recM2.configuredBy -eq $ctxReal.Account)
Check 'and the credentials file is untouched by it' (Test-Path -LiteralPath $sR.EnvFile)

# =============================================================================
# 7. Both is unchanged -- the compatibility guarantee
# =============================================================================
# This is a large installed surface, so the default has to be provably the old
# behaviour. Two runs against two identical scratch trees: one with no -Stage at
# all (what every existing caller and the wizard sends), one with -Stage Both.
# Everything they write is compared byte for byte, and the record is compared field
# by field with only the timestamps normalised.
Group 'Both is exactly the previous behaviour, and is the default'

function Invoke-FullRun {
    param([string] $Name, [hashtable] $Extra = @{})
    $s = New-Scenario $Name
    $p = @{} + $s.Common + $s.Creds + $Extra
    $p['Servers'] = 'bconnect-endpoints'
    $p['Hosts']   = 'claude-desktop,generic'
    $r = Invoke-Engine -Params $p -Work $s.Root
    return @{ S = $s; R = $r }
}

$runDefault = Invoke-FullRun 'both-default'
$runBoth    = Invoke-FullRun 'both-explicit' @{ Stage = 'Both' }

# Not "exit 0": both runs verify for real against a base URL that deliberately does
# not resolve, so both end non-zero. What matters is that they end the SAME way.
Check 'a run with no -Stage runs to the end' ($runDefault.R.Output -match '(?m)^ Finished') `
      ("exit $($runDefault.R.Code)")
Check 'a run with -Stage Both ends exactly as the default does' `
      ($runBoth.R.Code -eq $runDefault.R.Code) `
      ("default $($runDefault.R.Code), explicit $($runBoth.R.Code)")

$mA = Get-TreeManifest $runDefault.S.Root
$mB = Get-TreeManifest $runBoth.S.Root
Check 'both runs produce exactly the same set of files' (($mA -join '|') -eq ($mB -join '|')) `
      ("default: " + ($mA -join ', '))
Check 'and that set is not empty' ($mA.Count -gt 0)

# Every artefact carries its own scenario root -- --env-file=<root>\secrets\... in
# the launch entry, the paths printed into the generic snippet -- so the roots are
# normalised out and everything else is compared exactly. Removing the two roots is
# the ONLY licence taken; a stage gate that changed a launch entry, an env line or a
# snippet would still show up.
function Get-NormalisedText {
    param([string] $Path, [string] $Root)
    $t = Get-Content -LiteralPath $Path -Raw
    foreach ($form in @($Root, $Root.Replace('\', '\\'), $Root.Replace('\', '/'))) {
        $t = $t.Replace($form, '<ROOT>')
    }
    return $t
}
$byteDiffs = @()
foreach ($rel in $mA) {
    # The record carries timestamps and is normalised separately.
    if ($rel -like '*installation.json') { continue }
    $a = Join-Path $runDefault.S.Root $rel
    $b = Join-Path $runBoth.S.Root    $rel
    if (-not (Test-Path -LiteralPath $b)) { $byteDiffs += ($rel + ' (missing)'); continue }
    if ((Get-NormalisedText $a $runDefault.S.Root) -ne (Get-NormalisedText $b $runBoth.S.Root)) {
        $byteDiffs += $rel
    }
}
Check 'every file the two runs wrote is identical once the scratch root is normalised' `
      ($byteDiffs.Count -eq 0) `
      $(if ($byteDiffs.Count) { 'differ: ' + ($byteDiffs -join ', ') } else { "$($mA.Count - 1) file(s) compared" })

# The record, with the fields that MUST differ between two runs normalised away.
function Get-NormalisedRecord {
    param([string] $Path, [string] $Root)
    $t = Get-NormalisedText $Path $Root
    $j = $t | ConvertFrom-Json
    $j.lastRun = 'NORMALISED'
    foreach ($h in @($j.hosts)) {
        $h.writtenAt = 'NORMALISED'
        # The entry hash is taken over the entry itself, which carries an absolute
        # --env-file path, so two scratch trees hash differently for the right
        # reason. The NAMES are the fact worth comparing here; the entries
        # themselves were already compared byte for byte above.
        foreach ($n in @((Get-PropName $h.entryHashes))) { $h.entryHashes.$n = 'HASH-OF-A-ROOTED-ENTRY' }
    }
    return ($j | ConvertTo-Json -Depth 12)
}
$jA = Get-NormalisedRecord $runDefault.S.StateFile $runDefault.S.Root
$jB = Get-NormalisedRecord $runBoth.S.StateFile    $runBoth.S.Root
Check 'the installation record is identical apart from the root and the timestamps' ($jA -eq $jB)

$recBoth = Get-Record $runBoth.S.StateFile
Check 'a Both run records stage=both' ((Get-RecordStage $recBoth) -eq 'both')
Check 'a Both run CONFIGURES what it intends -- the two lists agree' `
      (((@(Get-RecordIntendedHostIds $recBoth) | Sort-Object) -join ',') -eq
       ((@(Get-RecordHostIds $recBoth) | Sort-Object) -join ',')) `
      ('intended: ' + (@(Get-RecordIntendedHostIds $recBoth) -join ',') +
       '  configured: ' + (@(Get-RecordHostIds $recBoth) -join ','))

# Every step a Both run must still perform. A stage gate that leaked into the
# default would show up here as a missing step rather than as a wrong file.
foreach ($step in @(
        @{ N = 'collects credentials';   T = '-- Credentials' }
        @{ N = 'probes bConnect';        T = '-- bConnect reachability' }
        @{ N = 'writes the credentials'; T = '-- Credentials file' }
        @{ N = 'builds';                 T = '-- Build' }
        @{ N = 'writes host config';     T = '-- Host configuration' }
        @{ N = 'verifies';               T = '-- Verification' })) {
    Check ("a default run still $($step.N)") ($runDefault.R.Output -match [regex]::Escape($step.T)) $step.T
}
# Every step header still PRINTS in a stage that skipped the step's work, so the
# headers above are necessary and not sufficient. These are the skip notices: not
# one of them may appear on a default run. Measured -- a mutation that made Both
# stop building survived on the headers alone, because the harness passes
# -SkipBuild and both skips print under the same header.
foreach ($notice in @(
        @{ N = 'the credentials skip'; T = 'the machine stage collects no credential' }
        @{ N = 'the build skip';       T = 'the suite is built by the machine stage' }
        @{ N = 'the host-config skip'; T = 'no host configuration is written by the machine stage' }
        @{ N = 'the verification skip'; T = 'the machine stage has no credentials' })) {
    Check ("a default run does NOT print $($notice.N)") `
        ($runDefault.R.Output -notmatch [regex]::Escape($notice.T)) $notice.T
}
Check 'and it does not print the machine-stage closing summary' `
      ($runDefault.R.Output -notmatch 'Machine stage complete')
Check 'a default run wrote the Claude Desktop configuration' `
      ((Get-ConfigServerNames $runDefault.S.ConfigPath) -contains 'bconnect-endpoints')

# =============================================================================
# 8. The documented command lines
# =============================================================================
# The three silent cases are documented rather than named by a parameter, because
# the deployment shape maps onto -Hosts and -Gateway, which already exist. What is
# checkable here is that the help says all three and that every parameter it tells
# an operator to type actually exists on this script.
Group 'The parameter help carries the three silent command lines'

$help = Get-Help $Installer -Parameter Stage -ErrorAction SilentlyContinue | Out-String
Check 'there is help for -Stage at all' ([bool]$help -and $help.Length -gt 400) ("$($help.Length) chars")
foreach ($w in @(
        @{ N = 'the machine-stage command line'; T = '-Stage Machine -NonInteractive' }
        @{ N = 'the user-stage command line';    T = '-Stage User -NonInteractive' }
        @{ N = 'the gateway command line';       T = '-Gateway -GatewayBind' }
        @{ N = 'why the split exists';           T = 'systemprofile' }
        @{ N = 'that Both is the default';       T = 'Defaults to Both' })) {
    Check ("the help states $($w.N)") ($help -match [regex]::Escape($w.T)) $w.T
}

# Every -Parameter the help tells an operator to type must exist. A documented
# command line that does not run is worse than none: it is carried into a baramundi
# package and fails on twenty machines at once.
$declared = @((Get-Command $Installer).Parameters.Keys)
$cited = @([regex]::Matches($help, '(?m)^\s*-([A-Za-z][A-Za-z0-9]*)') | ForEach-Object { $_.Groups[1].Value }) +
         @([regex]::Matches($help, '\s-([A-Za-z][A-Za-z0-9]*)\s') | ForEach-Object { $_.Groups[1].Value })
$cited = @($cited | Select-Object -Unique | Where-Object { $_ -notin @('File', 'Command', 'NoProfile', 'ExecutionPolicy', 'AsPlainText', 'Force', 'Parameter', 'Help') })
$unknown = @($cited | Where-Object { $declared -notcontains $_ })
Check 'every parameter the help tells an operator to type exists on this script' `
      ($unknown.Count -eq 0) $(if ($unknown.Count) { 'unknown: ' + ($unknown -join ', ') } else { ($cited -join ', ') })

} finally {
    if ($KeepWork) {
        Write-Host ''
        Write-Host ("  -KeepWork: the scratch tree and every run-NN.log are at $WorkDir") -ForegroundColor Yellow
    } elseif (Test-Path -LiteralPath $WorkDir) {
        Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
Write-Host ''
Write-Host ("  $script:Pass passed, $script:Fail failed   (${elapsed}s)") -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
if ($script:Fail) { exit 1 }
exit 0
