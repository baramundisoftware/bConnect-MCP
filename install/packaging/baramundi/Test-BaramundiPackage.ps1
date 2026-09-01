<#
.SYNOPSIS
    Check packaging\baramundi\README.md -- the baramundi software package
    definition -- against the things it claims about, without a bMS console.

.DESCRIPTION
    A package definition is documentation that a machine executes. Every command
    line in it is transcribed into a console field by a person who cannot check
    it, and runs as SYSTEM on a customer's workstation with no operator watching.
    Two defects in it are silent until that moment:

      * A DOCUMENTED FLAG THAT DOES NOT EXIST. PowerShell rejects an unknown
        parameter, so the job fails at "100% deployed" with a message nobody sees
        for a week. This is the defect most likely here, because the command lines
        and the parameter block are in different files and only one of them is
        ever executed during development.

      * A DETECTION RULE THAT KEYS ON NOTHING. A rule reading a registry value
        that is never written, or the wrong registry view, or a version that no
        longer matches, is not an error at any point. It reports "not installed"
        forever and the package redeploys on every run, or it reports "installed"
        forever and the package never updates.

    So this script parses the README's command lines, parses the ACTUAL parameter
    block of Install-BConnectMcp.ps1 with the PowerShell parser rather than with a
    regular expression, and asserts one against the other. It parses the detection
    rules and asserts each one keys on something the installer or the engine
    really creates: AppId out of the .iss, the version out of package.json, the
    record path out of the machine-stage command line that writes it.

    It also holds the two organisational commitments in packaging\README.md in
    place -- the pinned Node version the .exe bundles, and code signing -- because
    a commitment that can be deleted without a check failing is a note, not a
    commitment.

    It is a sibling of packaging\Test-InnoScript.ps1 rather than an extension of
    it. That script answers "is this .iss right"; this one answers "is this
    package definition right", and section 11 of the README is the case where the
    .iss is replaced and this script has to outlive it.

    WHAT IT DOES NOT PROVE
      * That any bMS console accepts these field values, or names its fields this
        way. No console has seen them.
      * That the registry key in the detection rule is ever written. That needs a
        compiled .exe installed on a machine.
      * That Active Setup runs the StubPath at logon.

.PARAMETER ReadmePath
    The package definition to check. Defaults to README.md beside this file.

.PARAMETER Quiet
    Print failures and the summary only.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\packaging\baramundi\Test-BaramundiPackage.ps1
#>
[CmdletBinding()]
param(
    [string] $ReadmePath,
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# -----------------------------------------------------------------------------
# Paths, derived the way every shipped script here derives them.
# -----------------------------------------------------------------------------
$BaramundiDir = $PSScriptRoot
$PackagingDir = Split-Path -Parent $BaramundiDir
$InstallerDir = Split-Path -Parent $PackagingDir
$ProjectRoot  = Split-Path -Parent $InstallerDir

if (-not $ReadmePath) { $ReadmePath = Join-Path $BaramundiDir 'README.md' }

$EnginePath        = Join-Path $InstallerDir 'Install-BConnectMcp.ps1'
$ShimPath          = Join-Path $PackagingDir 'Start-BConnectConfig.cmd'
$IssPath           = Join-Path $PackagingDir 'bconnect-mcp.iss'
$PackagingReadme   = Join-Path $PackagingDir 'README.md'
$FollowUpScript    = Join-Path $BaramundiDir 'Register-FinishSetupPrompt.ps1'

# The suite root is this directory's great-grandparent in the published layout,
# and <that>\bConnect-MCP-main in the working layout where install\ sits beside
# the suite instead of inside it.
if (Test-Path -LiteralPath (Join-Path $ProjectRoot 'package.json')) {
    $SuiteRoot = $ProjectRoot
} else {
    $SuiteRoot = Join-Path $ProjectRoot 'bConnect-MCP-main'
}

# -----------------------------------------------------------------------------
# Result accounting. Same shape as Test-InnoScript.ps1 so that a person reading
# both outputs is reading the same thing twice.
# -----------------------------------------------------------------------------
$script:Pass = 0
$script:Fail = 0
$script:Failed = New-Object System.Collections.ArrayList

# $Detail is the VALUE that was examined and is printed either way, because a
# passing check is more useful when it says what it looked at. $Why is the
# consequence of the check failing and is printed only when it does -- printing a
# consequence under a PASS line reads as an assertion that the consequence
# happened, which is how a green run stops being read at all.
function Check {
    param([bool] $Ok, [string] $What, [string] $Detail, [string] $Why)
    if ($Ok) {
        $script:Pass++
        if (-not $Quiet) { Write-Host ('  PASS  ' + $What) -ForegroundColor Green }
        if ($Detail -and -not $Quiet) { Write-Host ('        ' + $Detail) -ForegroundColor DarkGray }
    } else {
        $script:Fail++
        [void]$script:Failed.Add($What)
        Write-Host ('  FAIL  ' + $What) -ForegroundColor Red
        if ($Detail) { Write-Host ('        ' + $Detail) -ForegroundColor Yellow }
        if ($Why)    { Write-Host ('        ' + $Why)    -ForegroundColor Yellow }
    }
}

function Section {
    param([string] $T)
    if ($Quiet) { return }
    Write-Host ''
    Write-Host ('  -- ' + $T + ' ' + ('-' * [Math]::Max(0, 62 - $T.Length))) -ForegroundColor DarkCyan
}

# -----------------------------------------------------------------------------
# Inputs
# -----------------------------------------------------------------------------
foreach ($required in @(
    @{ P = $ReadmePath;      W = 'the package definition' }
    @{ P = $EnginePath;      W = 'the installer engine' }
    @{ P = $IssPath;         W = 'the setup script' }
    @{ P = $PackagingReadme; W = 'the build documentation' }
)) {
    if (-not (Test-Path -LiteralPath $required.P)) {
        Write-Host ''
        Write-Host ('  FAIL  ' + $required.W + ' was not found: ' + $required.P) -ForegroundColor Red
        Write-Host ''
        exit 2
    }
}

$Readme          = Get-Content -LiteralPath $ReadmePath -Raw
$IssText         = Get-Content -LiteralPath $IssPath -Raw
$PackagingText   = Get-Content -LiteralPath $PackagingReadme -Raw

# -----------------------------------------------------------------------------
# Extracting a block from the README.
#
# Each transcribable block is preceded by an HTML comment naming it. The marker
# is invisible in a rendered document and is not part of what gets pasted into a
# console field, so tagging a block does not change what an administrator copies.
# -----------------------------------------------------------------------------
function Get-MarkedBlock {
    param([string] $Marker)
    $rx = '<!--\s*guard:' + [regex]::Escape($Marker) + '\s*-->\s*\r?\n```[^\r\n]*\r?\n(?<body>.*?)\r?\n```'
    $m = [regex]::Match($Readme, $rx, [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if (-not $m.Success) { return $null }
    return $m.Groups['body'].Value
}

# Detection rules are written as aligned name/value lines so that they read as a
# console form. Two or more spaces separate the name from the value.
function ConvertFrom-RuleBlock {
    param([string] $Body)
    $h = @{}
    if (-not $Body) { return $h }
    foreach ($line in ($Body -split "`r?`n")) {
        $m = [regex]::Match($line, '^\s*(?<k>\S+)\s{2,}(?<v>.+?)\s*$')
        if ($m.Success) { $h[$m.Groups['k'].Value] = $m.Groups['v'].Value }
    }
    return $h
}

# Everything after the engine script's name in a command block is an argument to
# the engine. Taking the substring rather than the whole block is what keeps
# PowerShell host switches (-NoProfile, -ExecutionPolicy, -File) and the
# in-process SecureString construction (-AsSecureString, -AsPlainText) out of the
# comparison: they all appear before the script is named.
function Get-EngineParameterNames {
    param([string] $Body)
    if (-not $Body) { return @() }
    $i = $Body.IndexOf('Install-BConnectMcp.ps1')
    if ($i -lt 0) { return @() }
    $after = $Body.Substring($i)
    $names = New-Object System.Collections.ArrayList
    foreach ($m in [regex]::Matches($after, '(?<![\w.\\/-])-(?<n>[A-Za-z][A-Za-z0-9]*)')) {
        $n = $m.Groups['n'].Value
        if ($names -notcontains $n) { [void]$names.Add($n) }
    }
    return @($names)
}

function Get-IssDefine {
    param([string] $Name)
    $m = [regex]::Match($IssText, '(?m)^\s*#define\s+' + [regex]::Escape($Name) + '\s+"(?<v>[^"]*)"')
    if ($m.Success) { return $m.Groups['v'].Value }
    return $null
}

# -----------------------------------------------------------------------------
Section 'the installer parameter block, as the parser sees it'
# -----------------------------------------------------------------------------
# Parsed, not matched. A regular expression over the param block would also match
# the .PARAMETER sections of the comment-based help, which is exactly the failure
# this check exists to catch: help that documents a parameter the code no longer
# declares.
$tokens = $null; $errors = $null
$engineAst = [System.Management.Automation.Language.Parser]::ParseFile($EnginePath, [ref]$tokens, [ref]$errors)
Check (-not $errors -or $errors.Count -eq 0) 'Install-BConnectMcp.ps1 parses' `
      $(if ($errors -and $errors.Count) { $errors[0].Message })

$paramBlock = $engineAst.ParamBlock
Check ($null -ne $paramBlock) 'Install-BConnectMcp.ps1 declares a param block'

$EngineParams = @()
if ($paramBlock) {
    $EngineParams = @($paramBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
}
Check ($EngineParams.Count -gt 0) 'the parameter block declares parameters' ($EngineParams.Count.ToString() + ' declared')

# CmdletBinding supplies these; they are legitimate on any of these command lines
# even though the param block does not name them.
$CommonParams = @(
    'Verbose','Debug','ErrorAction','WarningAction','InformationAction','ErrorVariable',
    'WarningVariable','InformationVariable','OutVariable','OutBuffer','PipelineVariable',
    'ProgressAction','WhatIf','Confirm'
)
$KnownParams = @($EngineParams + $CommonParams)

# The parameters that carry, or turn on the storage of, a credential. None of
# them may appear on a command line this package runs as SYSTEM.
$CredentialParams = @('ApiKeySecure','BasicPassSecure','V11PassSecure','ProtectCredentials','BasicUser','V11User')

$stageValues = @()
if ($paramBlock) {
    $stageParam = $paramBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Stage' }
    if ($stageParam) {
        foreach ($a in $stageParam.Attributes) {
            if ($a.TypeName.FullName -match 'ValidateSet') {
                $stageValues = @($a.PositionalArguments | ForEach-Object { [string]$_.Value })
            }
        }
    }
}
Check ($stageValues -contains 'Machine' -and $stageValues -contains 'User') `
      '-Stage still accepts Machine and User' ($stageValues -join ', ')

# -----------------------------------------------------------------------------
Section 'every parameter the package definition documents actually exists'
# -----------------------------------------------------------------------------
$CommandBlocks = @(
    @{ Marker = 'machine-stage'; What = 'the machine stage (step 2)' }
    @{ Marker = 'user-stage';    What = 'the user stage (section 8)' }
)

foreach ($b in $CommandBlocks) {
    $body = Get-MarkedBlock $b.Marker
    Check ($null -ne $body) ('the README carries a ' + $b.Marker + ' command block') `
          '' 'Expected an HTML comment <!-- guard:<marker> --> immediately before a fenced block.'
    if (-not $body) { continue }

    $used = Get-EngineParameterNames $body
    Check ($used.Count -gt 0) ($b.What + ': parameters were found to check') ($used -join ' ')
    foreach ($p in $used) {
        Check ($KnownParams -contains $p) `
              ($b.What + ": -$p exists in Install-BConnectMcp.ps1") `
              '' "Install-BConnectMcp.ps1 declares no -$p. PowerShell rejects an unknown parameter, so this command line fails on the endpoint with nobody watching."
    }
}

# -----------------------------------------------------------------------------
Section 'the machine stage does the machine half, and carries no credential'
# -----------------------------------------------------------------------------
$machine = Get-MarkedBlock 'machine-stage'
if ($machine) {
    # Everything here is asked of the ENGINE'S arguments, not of the block. The
    # block also carries powershell.exe's own switches, and -NonInteractive is
    # spelled the same on both -- so a block that lost the engine's -NonInteractive
    # would still satisfy a check written against the whole text, while the job it
    # describes sits on a prompt nobody can see. Measured: that check passed a
    # mutation that removed the parameter.
    $used        = Get-EngineParameterNames $machine
    $machineArgs = ''
    $mi = $machine.IndexOf('Install-BConnectMcp.ps1')
    if ($mi -ge 0) { $machineArgs = $machine.Substring($mi) }

    Check ($machineArgs -match '(?m)-Stage\s+Machine\b') 'the machine stage passes -Stage Machine' `
          '' 'Without it the run defaults to Both, which under SYSTEM writes host configurations into C:\Windows\System32\config\systemprofile and reports success.'
    Check ($used -contains 'NonInteractive') 'the machine stage passes -NonInteractive to the engine' `
          '' 'Without it an unanswerable question becomes a prompt in a session nobody can see, and the job runs until it times out. powershell.exe has a switch of the same name, so this is asked of the engine''s arguments only.'

    foreach ($c in $CredentialParams) {
        Check ($used -notcontains $c) "the machine stage does not pass -$c" `
              '' 'A credential collected by a SYSTEM job is stored for the service account. DPAPI is CurrentUser scope, so no administrator could decrypt it.'
    }
    Check ($used -notcontains 'ApiKey') 'the machine stage names no plaintext key parameter' `
          '' 'There is deliberately no -ApiKey. A secret on a command line lands in the process list, the transcript and the baramundi job definition.'
    Check ($used -notcontains 'ProjectDir') 'the machine stage passes no -ProjectDir' `
          '' 'A per-workspace client file belongs to whoever opens the workspace. The machine stage records intent instead.'
}

$user = Get-MarkedBlock 'user-stage'
if ($user) {
    $ui = $user.IndexOf('Install-BConnectMcp.ps1')
    $userArgs = $(if ($ui -ge 0) { $user.Substring($ui) } else { '' })
    Check ($userArgs -match '(?m)-Stage\s+User\b') 'the user-stage example passes -Stage User'
    Check ($user -match '(?i)-AsSecureString') 'the user-stage example builds the SecureString in process' `
          '' 'The masked prompt is the only interactive way a credential enters this product.'
}

# A silent shape -- machine stage or gateway -- must never turn on DPAPI
# protection, which is CurrentUser scope and would bind the credential to the
# account the job ran as. Checked against the command blocks rather than the whole
# document, because the prose has to be free to name the parameter in order to
# forbid it.
$SilentBlocks = @(@('machine-stage', 'setup-exe') | ForEach-Object { Get-MarkedBlock $_ }) -join "`n"
Check ($SilentBlocks -notmatch '(?i)-ProtectCredentials') `
      'no silently deployed command line carries -ProtectCredentials' `
      '' 'DPAPI is CurrentUser scope; a credential protected under the account a job ran as cannot be read by anything else.'

# -----------------------------------------------------------------------------
Section 'the detection rules key on things that are really created'
# -----------------------------------------------------------------------------
$AppId       = Get-IssDefine 'AppId'
$AppName     = Get-IssDefine 'AppName'
$IssVersion  = Get-IssDefine 'SuiteVersion'
Check ([bool]$AppId)      'the .iss declares AppId'      $AppId
Check ([bool]$IssVersion) 'the .iss declares SuiteVersion' $IssVersion

# ISPP escapes the leading brace of a GUID AppId by doubling it. The value that
# reaches the registry is the single-braced one.
$AppIdGuid = $AppId
if ($AppIdGuid) { $AppIdGuid = $AppIdGuid -replace '^\{\{', '{' }

$PkgJson = Join-Path $SuiteRoot 'package.json'
$SuiteVersion = $null
if (Test-Path -LiteralPath $PkgJson) {
    $SuiteVersion = (Get-Content -LiteralPath $PkgJson -Raw | ConvertFrom-Json).version
}
Check ([bool]$SuiteVersion) 'the suite package.json declares a version' "$PkgJson -> $SuiteVersion"
Check ($IssVersion -eq $SuiteVersion) 'the .iss version equals the suite version' "$IssVersion / $SuiteVersion"

# --- 7.1 the registry rule ---------------------------------------------------
$detect = ConvertFrom-RuleBlock (Get-MarkedBlock 'detection')
Check ($detect.Count -gt 0) 'the README carries the registry detection rule'
if ($detect.Count) {
    Check ($detect['Hive'] -eq 'HKEY_LOCAL_MACHINE') 'the rule reads HKEY_LOCAL_MACHINE' $detect['Hive']
    Check ($detect['View'] -match '64') 'the rule reads the 64-bit registry view' `
          '' 'ArchitecturesInstallIn64BitMode puts the uninstall key in the native view. A rule reading the 32-bit view finds nothing and redeploys on every run.'
    Check ($detect['Key'] -like '*Uninstall*') 'the rule reads the uninstall key' $detect['Key']
    Check ($AppIdGuid -and $detect['Key'] -and $detect['Key'].Contains($AppIdGuid)) `
          'the detection key carries the .iss AppId GUID' `
          ('rule: ' + $detect['Key'] + '   AppId: ' + $AppIdGuid)
    Check ($detect['Value'] -eq 'DisplayVersion') 'the rule reads DisplayVersion' $detect['Value']
    Check ($detect['Data'] -eq $SuiteVersion) 'the detection version equals the shipped version' `
          ('rule: ' + $detect['Data'] + '   package.json: ' + $SuiteVersion)
}

# --- 7.2 the file rule -------------------------------------------------------
# DefaultDirName is where the payload lands. {autopf} under PrivilegesRequired=admin
# is the common Program Files directory, and in 64-bit install mode that is
# %ProgramFiles%.
$defaultDir = $null
$m = [regex]::Match($IssText, '(?m)^\s*DefaultDirName=(?<v>.+?)\s*$')
if ($m.Success) { $defaultDir = $m.Groups['v'].Value }
Check ([bool]$defaultDir) 'the .iss declares DefaultDirName' $defaultDir

$expectedRoot = $null
if ($defaultDir) {
    $expectedRoot = $defaultDir -replace '\{autopf\}', '%ProgramFiles%'
    if ($AppName) { $expectedRoot = $expectedRoot -replace '\{#AppName\}', $AppName }
}

$detectFile = ConvertFrom-RuleBlock (Get-MarkedBlock 'detection-file')
Check ($detectFile.Count -gt 0) 'the README carries the file detection rule'
if ($detectFile.Count -and $expectedRoot) {
    $p = $detectFile['Path']
    Check ($p -and $p.StartsWith($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) `
          'the file rule points inside the .iss installation directory' `
          ('rule: ' + $p + '   DefaultDirName: ' + $expectedRoot)
    if ($p -and $p.StartsWith($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $rel = $p.Substring($expectedRoot.Length).TrimStart('\')
        # {app} is the bundle root, and the bundle root IS the suite root with
        # install\ inside it. In the working layout install\ sits beside the
        # suite, so an install\... path resolves against the installer directory.
        if ($rel -imatch '^install\\') {
            $onDisk = Join-Path $InstallerDir ($rel -replace '^install\\', '')
        } else {
            $onDisk = Join-Path $SuiteRoot $rel
        }
        Check (Test-Path -LiteralPath $onDisk) `
              'the file the rule keys on exists in the tree being packaged' `
              $onDisk
        # And it has to be carried to {app} by a [Files] entry, or it will not be
        # on the target however real it is here.
        Check ($IssText -match '(?m)^\s*Source:\s*"\{#BundleDir\}\\\*"[^\r\n]*DestDir:\s*"\{app\}"[^\r\n]*recursesubdirs') `
              'a recursive [Files] entry carries the bundle to {app}' `
              '' 'The file rule is only meaningful if the payload entry that delivers that file is still in the .iss.'
    }
}

# --- 7.3 the record rule -----------------------------------------------------
$detectRecord = ConvertFrom-RuleBlock (Get-MarkedBlock 'detection-record')
Check ($detectRecord.Count -gt 0) 'the README carries the machine-stage detection rule'
if ($detectRecord.Count -and $machine) {
    $sm = [regex]::Match($machine, '-StateFile\s+(?:"(?<q>[^"]+)"|''(?<q>[^'']+)''|(?<q>[^\s^]+))')
    Check ($sm.Success) 'the machine-stage command line names a -StateFile'
    if ($sm.Success) {
        $stateFile = $sm.Groups['q'].Value
        Check ($detectRecord['Path'] -and
               $detectRecord['Path'].TrimEnd('\').Equals($stateFile.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) `
              'the record rule keys on the path the machine stage writes' `
              ('rule: ' + $detectRecord['Path'] + '   -StateFile: ' + $stateFile)
    }
    # And the engine really writes it: Write-InstallationRecord takes -Path and
    # creates the parent directory.
    $statePsm = Join-Path $InstallerDir 'lib\State.psm1'
    if (Test-Path -LiteralPath $statePsm) {
        $stateText = Get-Content -LiteralPath $statePsm -Raw
        Check ($stateText -match 'function\s+Write-InstallationRecord') `
              'the engine has a function that writes the installation record'
    }
    Check ($engineAst.Extent.Text -match 'Write-InstallationRecord\s+-Path\s+\$StateFile') `
          'the engine writes the record at the -StateFile path' `
          '' 'The rule keys on a file nothing creates if this call stops using $StateFile.'
}

# -----------------------------------------------------------------------------
Section 'the silent install does not stop for a window nobody can see'
# -----------------------------------------------------------------------------
$setupExe = Get-MarkedBlock 'setup-exe'
Check ($null -ne $setupExe) 'the README carries the setup command line'
if ($setupExe) {
    $expectedExe = 'bConnect-MCP-Setup-' + $SuiteVersion + '.exe'
    Check ($setupExe -match [regex]::Escape($expectedExe)) `
          'the setup command line names the .exe this version produces' `
          ('expected ' + $expectedExe)
    Check ($setupExe -match '(?i)/VERYSILENT|/SILENT') 'the setup runs silently'
    Check ($setupExe -match '(?i)/SUPPRESSMSGBOXES') 'message boxes are suppressed' `
          '' 'A message box in a SYSTEM job is a job that runs until it times out.'
    Check ($setupExe -match '(?i)/NORESTART') 'the setup does not restart the machine'
}

# The .exe filename carries the version, and it is named in more than one place
# in this document: the source-file table an administrator populates the package
# directory from, and the command line the package runs. A release bump that
# reaches one of them and not the other produces a package whose install step
# names a file that is not in its own source directory, which fails at deploy
# time with "file not found" and nothing else.
$exeMentions = @([regex]::Matches($Readme, '(?i)bConnect-MCP-Setup-(?<v>[0-9][^\s"'']*?)\.exe') |
                 ForEach-Object { $_.Groups['v'].Value } | Select-Object -Unique)
Check ($exeMentions.Count -gt 0) 'the README names the setup executable' ($exeMentions -join ', ')
foreach ($v in $exeMentions) {
    Check ($v -eq $SuiteVersion) `
          ("every mention of the setup executable names version $SuiteVersion") `
          ("found bConnect-MCP-Setup-$v.exe") `
          'The source-file table and the install command line must name the same file, and it must be the file this version builds.'
}

# The version an administrator types into the software object's own version field.
$identity = [regex]::Match($Readme, '(?m)^\|\s*Version\s*\|\s*(?<v>[^\s|]+)\s*\|')
Check ($identity.Success) 'the package identity table declares a version'
if ($identity.Success) {
    Check ($identity.Groups['v'].Value -eq $SuiteVersion) `
          'the package version equals the shipped version' `
          ('table: ' + $identity.Groups['v'].Value + '   package.json: ' + $SuiteVersion) `
          'baramundi compares the package version with the detection rule. A package that declares one version and detects another either never installs or never stops installing.'
}

# The postinstall offer must stay skippable, or a silent deployment starts a GUI
# in session 0 and waits for it.
$postRun = [regex]::Match($IssText, '(?m)^\s*Filename:\s*"\{app\}\\install\\Start-BConnectConfig\.cmd"[^\r\n]*postinstall[^\r\n]*$')
Check ($postRun.Success) 'the .iss still offers the configuration front end after install'
if ($postRun.Success) {
    Check ($postRun.Value -match 'skipifsilent') `
          'that offer carries skipifsilent' `
          '' 'Without it, /VERYSILENT still launches the configuration window, in a session with no operator, and the baramundi job waits for it.'
}

# -----------------------------------------------------------------------------
Section 'the user-context follow-up'
# -----------------------------------------------------------------------------
Check (Test-Path -LiteralPath $FollowUpScript) 'Register-FinishSetupPrompt.ps1 exists' $FollowUpScript
if ((Test-Path -LiteralPath $FollowUpScript) -and (Test-Path -LiteralPath $ShimPath)) {
    $followText = Get-Content -LiteralPath $FollowUpScript -Raw
    $shimText   = Get-Content -LiteralPath $ShimPath -Raw

    Check ($followText -match 'Start-BConnectConfig\.cmd') `
          'the follow-up launches the existing shim rather than a second front end' `
          '' 'The shim repairs PATH and resolves to one of the three existing front ends, unmodified.'

    # The command Windows runs at logon, and the shim mode at the end of it. Read
    # from the StubPath assignment rather than from anywhere the string happens to
    # appear, because the StubPath is the only one of them that executes.
    $stubMatch = [regex]::Match($followText, '(?m)^\s*\$StubPath\s*=\s*(?<expr>.+)$')
    Check ($stubMatch.Success) 'the follow-up builds a StubPath for Active Setup'
    # ANY trailing word, not one of the three the shim knows. Constraining the
    # pattern to setup|manage|cli would make the next check unreachable: a
    # StubPath asking for a mode the shim does not handle would fail to match at
    # all, and the check that exists to catch exactly that would never run.
    $modeMatch = [regex]::Match('', 'x')
    if ($stubMatch.Success) {
        $modeMatch = [regex]::Match($stubMatch.Groups['expr'].Value, "(?<mode>[A-Za-z][A-Za-z0-9-]*)\s*'\s*$")
    }
    Check ($modeMatch.Success) 'the follow-up names a shim mode' `
          $(if ($modeMatch.Success) { $modeMatch.Groups['mode'].Value })
    if ($modeMatch.Success) {
        $mode = $modeMatch.Groups['mode'].Value
        Check ($shimText -match ('(?i)"%MODE%"=="' + $mode + '"')) `
              ("the shim handles the $mode mode the follow-up asks for") `
              '' 'A mode the shim does not handle exits 2 and prints usage, at logon, where nobody reads it.'
        Check ($mode -eq 'manage') 'the follow-up opens the configuration GUI, not the guided installer' `
              '' 'The GUI decides its own first-run state from the installation record. Selecting that state with a flag would give the condition two implementations.'
    }

    # No flag is invented for the first-run state. If one is added here it has to
    # exist on the GUI, so check it the same way the command lines are checked.
    $manageScript = Join-Path $InstallerDir 'Manage-BConnectMcp.ps1'
    if (Test-Path -LiteralPath $manageScript) {
        $mTokens = $null; $mErrors = $null
        $mAst = [System.Management.Automation.Language.Parser]::ParseFile($manageScript, [ref]$mTokens, [ref]$mErrors)
        $manageParams = @()
        if ($mAst.ParamBlock) { $manageParams = @($mAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) }
        $guiFlags = @()
        if ($stubMatch.Success) {
            foreach ($f in [regex]::Matches($stubMatch.Groups['expr'].Value, '(?<![\w.\\/-])-(?<n>[A-Za-z][A-Za-z0-9]*)')) {
                $guiFlags += $f.Groups['n'].Value
            }
        }
        foreach ($f in ($guiFlags | Select-Object -Unique)) {
            Check (($manageParams + $CommonParams) -contains $f) `
                  ("the configuration GUI accepts -$f") `
                  '' "Manage-BConnectMcp.ps1 declares no -$f. A flag invented in the StubPath fails at logon, where nobody reads the error."
        }
    }
}

# -----------------------------------------------------------------------------
Section 'the organisational commitments in packaging\README.md'
# -----------------------------------------------------------------------------
# Bundling a runtime means owning its CVEs, and an unsigned installer is blocked
# rather than warned about on the servers this product is deployed to. Both are
# owner obligations, and both are the kind of thing that quietly disappears from
# a document. Keyed on markers plus a value that has to agree with the .iss, so
# the check fails on a silent bump as well as on a deletion.
$NodeVersion = Get-IssDefine 'NodeVersion'
Check ([bool]$NodeVersion) 'the .iss pins a bundled Node version' $NodeVersion

$cveSection = [regex]::Match($PackagingText,
    '<!--\s*guard:node-cve\s*-->(?<body>.*?)<!--\s*guard:node-cve-end\s*-->',
    [System.Text.RegularExpressions.RegexOptions]::Singleline)
Check ($cveSection.Success) 'packaging\README.md records the bundled-runtime CVE commitment' `
      '' 'Expected the section between <!-- guard:node-cve --> and <!-- guard:node-cve-end -->.'
if ($cveSection.Success -and $NodeVersion) {
    $body = $cveSection.Groups['body'].Value
    Check ($body -match [regex]::Escape($NodeVersion)) `
          'the CVE commitment names the version actually bundled' `
          ('.iss NodeVersion is ' + $NodeVersion + '. A bump that does not reach this section leaves a commitment about a runtime that no longer ships.')
    Check ($body -match '(?i)NodeVersion') 'it names where the version is pinned'
    Check ($body -match '(?i)release trigger') 'it states that a Node CVE is a release trigger'
    Check ($body -match '(?i)NodeMinVersion|adequate') `
          'it states that an adequate newer runtime on the target is left alone'
}

$signSection = [regex]::Match($PackagingText,
    '<!--\s*guard:code-signing\s*-->(?<body>.*?)<!--\s*guard:code-signing-end\s*-->',
    [System.Text.RegularExpressions.RegexOptions]::Singleline)
Check ($signSection.Success) 'packaging\README.md records the code-signing requirement' `
      '' 'Expected the section between <!-- guard:code-signing --> and <!-- guard:code-signing-end -->.'
if ($signSection.Success) {
    $body = $signSection.Groups['body'].Value
    foreach ($control in @('AppLocker', 'WDAC', 'SmartScreen')) {
        Check ($body -match ('(?i)' + $control)) ("it names $control")
    }
    Check ($body -match '(?i)owner') 'it names certificate provisioning as an owner action'
}

# The build documentation has to point at this directory, or the person building
# the .exe never learns that a package definition exists.
Check ($PackagingText -match '(?i)baramundi\\') 'packaging\README.md points at the baramundi package definition'

# -----------------------------------------------------------------------------
Write-Host ''
Write-Host ('  {0} passed, {1} failed' -f $script:Pass, $script:Fail) `
           -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
if ($script:Fail) {
    Write-Host ''
    foreach ($f in $script:Failed) { Write-Host ('    FAILED:  ' + $f) -ForegroundColor Red }
}
Write-Host ''
exit $(if ($script:Fail) { 1 } else { 0 })
