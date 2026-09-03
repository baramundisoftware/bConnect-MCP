<#
.SYNOPSIS
    Check packaging\bconnect-mcp.iss against the tree it is supposed to package,
    without compiling it.

.DESCRIPTION
    Inno Setup is not installed on every machine that touches this script, and a
    successful compile would not catch most of what goes wrong here anyway. A
    compiler answers "is this valid Inno?"; the questions that actually decide
    whether a customer's upgrade works are:

      * Does every Source: exist, in the layout the offline bundle produces?
      * Does every [Files] entry say where the file goes?
      * Is AppId a FIXED GUID? A regenerated one gives every upgrade a second
        Add/Remove Programs row over a first installation that can no longer be
        uninstalled, and the compiler is perfectly happy with it.
      * Does the version in the .iss still equal the suite's package.json? Drift
        there ships the wrong thing under the right name.
      * Does any Source: reach outside the bundle?
      * Is the pinned Node version still the one .nvmrc and engines declare?
      * Does the .exe still collect no credentials, and does its uninstaller
        still refuse to delete the customer's credentials without asking?

    None of those needs a compiler, and every one of them is a defect that ships
    silently. This script answers them.

    It is the only part of the packaging work that can be verified on a machine
    with no Inno Setup, and it was falsified before being trusted: every check
    below was run against a deliberately broken copy of the .iss and observed to
    fail. See packaging\README.md.

.PARAMETER IssPath
    The script to check. Defaults to bconnect-mcp.iss beside this file.

.PARAMETER BundleDir
    A real offline bundle (the output of install\lib\New-OfflineBundle.ps1) to
    resolve Source: paths against. This is the accurate check.

    Without it, paths are resolved against the WORKING TREE arranged as the
    published layout -- suite root, with install\ inside it. That answers "does
    this file exist at all", which is the drift that actually happens, but it
    does not prove the bundler put it in the bundle.

.PARAMETER SuiteRoot
    Override the suite root. Defaults to the installer's parent (the published
    layout, where install\ sits inside the suite), falling back to
    <parent>\bConnect-MCP-main (the working layout, where it sits beside it).

.PARAMETER Quiet
    Print failures and the summary only.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\packaging\Test-InnoScript.ps1

.EXAMPLE
    .\packaging\Test-InnoScript.ps1 -BundleDir D:\bconnect-mcp-offline
    The accurate form: check the .iss against the bundle it will be compiled
    from, immediately before running ISCC.
#>
[CmdletBinding()]
param(
    [string] $IssPath,
    [string] $BundleDir,
    [string] $SuiteRoot,
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# -----------------------------------------------------------------------------
# Paths. Derived the way every shipped script here derives them: this file's
# directory, its parent (install\), and that parent's parent -- which IS the
# suite root in the published layout.
# -----------------------------------------------------------------------------
$PackagingDir = $PSScriptRoot
$InstallerDir = Split-Path -Parent $PackagingDir
$ProjectRoot  = Split-Path -Parent $InstallerDir

if (-not $IssPath) { $IssPath = Join-Path $PackagingDir 'bconnect-mcp.iss' }

if (-not $SuiteRoot) {
    if (Test-Path -LiteralPath (Join-Path $ProjectRoot 'package.json')) {
        $SuiteRoot = $ProjectRoot                                        # published layout
    } else {
        $SuiteRoot = Join-Path $ProjectRoot 'bConnect-MCP-main'          # working layout
    }
}

# The three roots a Source: may start from, and where each one resolves to.
#
#   {#BundleDir}   the offline bundle: suite root, install\ inside it
#   {#RedistDir}   operator-supplied redistributables (the Node MSI)
#   {#SourcePath}  ISPP's built-in: the directory holding the .iss
#
# Without a real bundle, {#BundleDir} is mapped onto the working tree: the suite
# root for everything, except install\... which comes from the installer
# directory. In the published layout those are the same place and the mapping is
# the identity; in the working layout install\ sits beside the suite and this is
# what makes the check runnable there.
$UsingRealBundle = [bool]$BundleDir
if ($UsingRealBundle) { $BundleDir = (Resolve-Path -LiteralPath $BundleDir).Path }

function Resolve-BundlePath {
    param([string] $Relative)
    $rel = $Relative.TrimStart('\')
    if ($UsingRealBundle) { return (Join-Path $BundleDir $rel) }
    if ($rel -ieq 'install' -or $rel -imatch '^install\\') {
        return (Join-Path $InstallerDir ($rel -replace '^install\\?', ''))
    }
    return (Join-Path $SuiteRoot $rel)
}

$RedistDir = Join-Path $PackagingDir 'redist'

# -----------------------------------------------------------------------------
# Result accounting
# -----------------------------------------------------------------------------
$script:Pass = 0
$script:Fail = 0
$script:Warn = 0
$script:Failed = New-Object System.Collections.ArrayList
$script:Warned = New-Object System.Collections.ArrayList

function Check {
    param([bool] $Ok, [string] $What, [string] $Detail)
    if ($Ok) {
        $script:Pass++
        if (-not $Quiet) { Write-Host ('  PASS  ' + $What) -ForegroundColor Green }
        if ($Detail -and -not $Quiet) { Write-Host ('        ' + $Detail) -ForegroundColor DarkGray }
    } else {
        $script:Fail++
        [void]$script:Failed.Add($What)
        Write-Host ('  FAIL  ' + $What) -ForegroundColor Red
        if ($Detail) { Write-Host ('        ' + $Detail) -ForegroundColor Yellow }
    }
}

# For an input that is legitimately absent from a source tree and has to be
# staged before ISCC runs. Counting it as a failure would train people to ignore
# a red run; counting it as a pass would let an .exe ship without its runtime.
function Pending {
    param([string] $What, [string] $Remedy)
    $script:Warn++
    [void]$script:Warned.Add($What)
    Write-Host ('  TODO  ' + $What) -ForegroundColor Yellow
    if ($Remedy) { Write-Host ('        ' + $Remedy) -ForegroundColor DarkGray }
}

function Section {
    param([string] $T)
    if ($Quiet) { return }
    Write-Host ''
    Write-Host ('  -- ' + $T + ' ' + ('-' * [Math]::Max(0, 62 - $T.Length))) -ForegroundColor DarkCyan
}

# -----------------------------------------------------------------------------
# Parse the .iss
# -----------------------------------------------------------------------------
# Not a general Inno parser and not trying to be one. It handles the constructs
# this script uses -- #define with string concatenation, sections, KEY=value in
# [Setup], and "Param: value;" entries elsewhere -- and anything it does not
# understand it reports rather than skips.
if (-not (Test-Path -LiteralPath $IssPath)) {
    Write-Host ''
    Write-Host ('  FAIL  the script to check does not exist: ' + $IssPath) -ForegroundColor Red
    Write-Host ''
    exit 1
}
$IssLines = Get-Content -LiteralPath $IssPath
$IssText  = ($IssLines -join "`n")

$Defines  = [ordered]@{}
$Setup    = [ordered]@{}
$Entries  = @()          # every non-[Setup] section entry, as a hashtable of params
$Sections = New-Object System.Collections.ArrayList

# ISPP values are either a quoted literal or literals and macro names joined
# with '+'. Anything else is reported rather than guessed at.
function Resolve-DefineExpression {
    param([string] $Expr)
    $out = ''
    foreach ($term in ($Expr -split '\s\+\s')) {
        $t = $term.Trim()
        if ($t -match '^"(.*)"$') { $out += $Matches[1]; continue }
        if ($t -match '^AddBackslash\(\s*SourcePath\s*\)$') { $out += ($PackagingDir.TrimEnd('\') + '\'); continue }
        if ($t -eq 'SourcePath') { $out += ($PackagingDir.TrimEnd('\') + '\'); continue }
        if ($Defines.Contains($t)) { $out += [string]$Defines[$t]; continue }
        return $null
    }
    return $out
}

$section = ''
$inCode  = $false
foreach ($raw in $IssLines) {
    $line = $raw

    # A ';' only starts a comment OUTSIDE [Code]; inside it, ';' is Pascal's
    # statement separator and stripping it would mangle every line.
    if (-not $inCode -and $line -match '^\s*;') { continue }

    if ($line -match '^\s*\[(\w+)\]\s*$') {
        $section = $Matches[1]
        $inCode  = ($section -ieq 'Code')
        [void]$Sections.Add($section)
        continue
    }

    if ($line -match '^\s*#\s*define\s+(\w+)\s+(.+?)\s*$') {
        $name = $Matches[1]; $expr = $Matches[2]
        $val  = Resolve-DefineExpression $expr
        if ($null -eq $val) { $Defines[$name] = '<unresolved:' + $expr + '>' }
        else                { $Defines[$name] = $val }
        continue
    }

    if ($inCode) { continue }
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -match '^\s*#') { continue }   # other preprocessor directives

    if ($section -ieq 'Setup') {
        if ($line -match '^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') { $Setup[$Matches[1]] = $Matches[2] }
        continue
    }

    if ($section) {
        $e = [ordered]@{ Section = $section; Line = $line.Trim() }
        foreach ($m in [regex]::Matches($line, '(?<k>[A-Za-z][A-Za-z0-9_]*)\s*:\s*(?<v>"[^"]*(?:""[^"]*)*"|[^;]*)')) {
            $k = $m.Groups['k'].Value
            $v = $m.Groups['v'].Value.Trim()
            if ($v.StartsWith('"') -and $v.EndsWith('"') -and $v.Length -ge 2) {
                $v = $v.Substring(1, $v.Length - 2).Replace('""', '"')
            }
            $e[$k] = $v
        }
        $Entries += $e
    }
}

# {#Name} substitution. The three root macros are mapped onto real directories;
# everything else takes its define value.
function Expand-IssMacros {
    param([string] $Value)
    $out = $Value
    foreach ($m in [regex]::Matches($Value, '\{#(\w+)\}')) {
        $n = $m.Groups[1].Value
        $r = $null
        switch ($n) {
            'BundleDir'  { $r = '<BUNDLE>' }
            'RedistDir'  { $r = '<REDIST>' }
            'SourcePath' { $r = '<PACKAGING>' }
            default      { if ($Defines.Contains($n)) { $r = [string]$Defines[$n] } }
        }
        if ($null -ne $r) { $out = $out.Replace($m.Value, $r) }
    }
    # {#SourcePath} already ends in a backslash, so "{#SourcePath}x" expands to
    # "<PACKAGING>x". Normalise it to a separator this script can split on.
    return ($out -replace '^<PACKAGING>\\?', '<PACKAGING>\')
}

Write-Host ''
Write-Host '  bConnect-MCP -- Inno Setup script check' -ForegroundColor White
Write-Host '  --------------------------------------' -ForegroundColor DarkGray
Write-Host ('  script      ' + $IssPath)
if ($UsingRealBundle) {
    Write-Host ('  bundle      ' + $BundleDir)
} else {
    Write-Host ('  bundle      (none given) -- Source: paths are resolved against the working tree')
    Write-Host ('              suite  ' + $SuiteRoot) -ForegroundColor DarkGray
    Write-Host ('              install ' + $InstallerDir) -ForegroundColor DarkGray
    Write-Host  '              Pass -BundleDir to check a real bundle before compiling.' -ForegroundColor DarkGray
}
Write-Host ('  redist      ' + $RedistDir)

# -----------------------------------------------------------------------------
Section 'structure'

foreach ($s in @('Setup', 'Files', 'Icons', 'Run', 'Code', 'Languages')) {
    Check ($Sections -contains $s) ("the [$s] section is present")
}
Check ($Defines.Count -gt 0) ('preprocessor definitions parsed') (($Defines.Keys | Select-Object -First 12) -join ', ')

$unresolved = @($Defines.GetEnumerator() | Where-Object { ([string]$_.Value).StartsWith('<unresolved:') })
Check ($unresolved.Count -eq 0) 'every #define resolves to a value this check understands' `
      (($unresolved | ForEach-Object { $_.Key }) -join ', ')

# -----------------------------------------------------------------------------
Section 'identity -- AppId, version, publisher'

# AppId. The failure this guards against is not a typo: it is someone opening
# the file in the Inno IDE, being offered a fresh GUID, and accepting it.
$appId = ''
if ($Setup.Contains('AppId')) { $appId = Expand-IssMacros ([string]$Setup['AppId']) }
Check ([bool]$appId) 'AppId is set'
Check ($appId -match '^\{\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$') `
      'AppId is a fixed literal GUID' ("AppId = '$appId' -- expected {{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}")
Check ($appId -notmatch '(?i)\{code:|GetDateTimeString|CreateGuid|\{#\w') `
      'AppId is not computed at build or install time' `
      'A generated AppId gives every upgrade a second Add/Remove Programs row over an installation that can no longer be uninstalled.'

# Version, against the file that owns it.
$pkgPath = Resolve-BundlePath 'package.json'
$pkgVersion = $null
if (Test-Path -LiteralPath $pkgPath) {
    try { $pkgVersion = (Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json).version } catch { }
}
Check ([bool]$pkgVersion) "the suite's package.json was read" ("$pkgPath -> $pkgVersion")

foreach ($k in @('AppVersion', 'VersionInfoVersion')) {
    $v = ''
    if ($Setup.Contains($k)) { $v = Expand-IssMacros ([string]$Setup[$k]) }
    Check ($pkgVersion -and $v -eq $pkgVersion) "$k matches the suite's package.json" "$k = '$v', package.json = '$pkgVersion'"
}
$udn = ''
if ($Setup.Contains('UninstallDisplayName')) { $udn = Expand-IssMacros ([string]$Setup['UninstallDisplayName']) }
Check ($pkgVersion -and $udn -match ([regex]::Escape($pkgVersion))) `
      'UninstallDisplayName carries the version' "UninstallDisplayName = '$udn'"

$pub = ''
if ($Setup.Contains('AppPublisher')) { $pub = Expand-IssMacros ([string]$Setup['AppPublisher']) }
Check ($pub -eq 'baramundi software GmbH') 'AppPublisher is the vendor' "AppPublisher = '$pub'"

foreach ($k in @('AppName', 'AppSupportURL', 'UninstallDisplayIcon', 'DefaultDirName', 'DefaultGroupName')) {
    Check ($Setup.Contains($k)) "$k is set" $(if ($Setup.Contains($k)) { Expand-IssMacros ([string]$Setup[$k]) })
}

# -----------------------------------------------------------------------------
Section 'Windows installer behaviour'

Check (($Setup['PrivilegesRequired'] -as [string]) -ieq 'admin') 'PrivilegesRequired=admin'
Check (($Setup['UsePreviousAppDir'] -as [string]) -ieq 'yes') `
      'UsePreviousAppDir=yes -- an upgrade lands on the previous installation'
Check ($Setup.Contains('ArchitecturesAllowed')) 'ArchitecturesAllowed is set' ([string]$Setup['ArchitecturesAllowed'])
Check ($Setup.Contains('MinVersion')) 'MinVersion is set -- the Windows floor is enforced by Setup itself' `
      $(if ($Setup.Contains('MinVersion')) { Expand-IssMacros ([string]$Setup['MinVersion']) })
Check (($Setup['SetupLogging'] -as [string]) -ieq 'yes') 'SetupLogging=yes'
Check (($Setup['CloseApplications'] -as [string]) -ieq 'no') `
      'CloseApplications=no -- Setup does not terminate processes on a bMS server'
Check ($Setup.Contains('LicenseFile')) 'LicenseFile is set'

# The two [Setup] directives that name a FILE rather than a value. They are
# build inputs exactly like a Source:, and ISCC fails on them just as loudly --
# but only after it has spent several minutes compressing node_modules.
foreach ($k in @('LicenseFile', 'SetupIconFile')) {
    if (-not $Setup.Contains($k)) { continue }
    $exp = Expand-IssMacros ([string]$Setup[$k])
    if ($exp.StartsWith('<BUNDLE>')) {
        $p = Resolve-BundlePath ($exp.Substring('<BUNDLE>'.Length))
        Check (Test-Path -LiteralPath $p) "$k resolves to a real file" $p
    } else {
        Check $false "$k resolves inside the bundle" "$k = '$exp' -- expected a path under {#BundleDir}"
    }
}

# MinVersion and the code that restates it in the product's own words. Two
# numbers, one fact; the message an administrator reads must not describe a
# different floor from the one Setup enforces.
$minWin = ''
if ($Setup.Contains('MinVersion')) { $minWin = Expand-IssMacros ([string]$Setup['MinVersion']) }
$mWin = [regex]::Match($IssText, 'IsWindowsVersionOrNewer\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)')
Check ($mWin.Success -and ($minWin -eq ($mWin.Groups[1].Value + '.' + $mWin.Groups[2].Value + '.' + $mWin.Groups[3].Value))) `
      'the coded Windows floor equals MinVersion' `
      ("MinVersion = '$minWin'; IsWindowsVersionOrNewer = " +
       $(if ($mWin.Success) { $mWin.Groups[1].Value + '.' + $mWin.Groups[2].Value + '.' + $mWin.Groups[3].Value } else { '(not found)' }))

# Code signing: present, and commented, so a build without the certificate still
# succeeds. A SignTool directive left active is a build that fails on the
# release machine and nowhere else.
$signToolLines   = @($IssLines | Where-Object { $_ -match '^\s*;?\s*SignTool\s*=' })
$signToolActive  = @($signToolLines | Where-Object { $_ -notmatch '^\s*;' })
Check ($signToolLines.Count -gt 0) 'a SignTool directive is present' 'commented, with a note on what to set'
Check ($signToolActive.Count -eq 0) 'the SignTool directive is commented out' `
      'An active SignTool needs a certificate that most build machines do not have.'
Check ($IssText -match '(?i)SignedUninstaller') 'SignedUninstaller is documented alongside it'
Check ($IssText -match '(?i)timestamp') 'the signing note mentions timestamping'

# -----------------------------------------------------------------------------
Section 'the Node.js runtime -- pinned, and matching what the suite declares'

$nvmrcPath = Resolve-BundlePath '.nvmrc'
$nvmrc = $null
if (Test-Path -LiteralPath $nvmrcPath) { $nvmrc = (Get-Content -LiteralPath $nvmrcPath -Raw).Trim() }
Check ([bool]$nvmrc) '.nvmrc was read' "$nvmrcPath -> $nvmrc"

$dMin  = [string]$Defines['NodeMinVersion']
$dPref = [string]$Defines['NodePreferredVersion']
$dVer  = [string]$Defines['NodeVersion']
$dMsi  = [string]$Defines['NodeMsi']

Check ($nvmrc -and $dMin -eq $nvmrc) 'NodeMinVersion equals .nvmrc' "NodeMinVersion = '$dMin', .nvmrc = '$nvmrc'"

# Every package repeats the floor in engines.node. A package raised above the
# rest is exactly the drift that leaves the .exe installing a runtime the suite
# will refuse.
$engineFloors = @()
foreach ($p in @(Get-ChildItem -Path (Resolve-BundlePath '.') -Directory -ErrorAction SilentlyContinue |
                 Where-Object { $_.Name -like 'bconnect-*' -or $_.Name -eq 'packages' })) {
    $pkgs = @()
    if ($p.Name -eq 'packages') { $pkgs = @(Get-ChildItem -Path $p.FullName -Directory | ForEach-Object { Join-Path $_.FullName 'package.json' }) }
    else                        { $pkgs = @(Join-Path $p.FullName 'package.json') }
    foreach ($pj in $pkgs) {
        if (-not (Test-Path -LiteralPath $pj)) { continue }
        try { $j = Get-Content -LiteralPath $pj -Raw | ConvertFrom-Json } catch { continue }
        if ($j.engines -and $j.engines.node) { $engineFloors += ([string]$j.engines.node) }
    }
}
$distinctFloors = @($engineFloors | Select-Object -Unique)
Check ($distinctFloors.Count -eq 1) 'every package declares the same engines.node floor' ($distinctFloors -join ' / ')
if ($distinctFloors.Count -ge 1) {
    $floor = ($distinctFloors[0] -replace '^[><=~^\s]+', '')
    Check ($floor -eq $dMin) 'NodeMinVersion equals the engines.node floor' "engines.node = '$($distinctFloors[0])', NodeMinVersion = '$dMin'"
}

function Test-VersionAtLeast {
    param([string] $Have, [string] $Want)
    try { return ([Version]$Have -ge [Version]$Want) } catch { return $false }
}
Check (Test-VersionAtLeast $dPref $dMin) 'NodePreferredVersion is at or above NodeMinVersion' "$dPref >= $dMin"
Check (Test-VersionAtLeast $dVer $dPref) 'the bundled NodeVersion is at or above NodePreferredVersion' "$dVer >= $dPref"
Check ($dMsi -eq ("node-v$dVer-x64.msi")) 'NodeMsi is the official x64 MSI filename for NodeVersion' "NodeMsi = '$dMsi'"

# The installer engine has the same two thresholds hard-coded, as comparisons
# rather than as prose. They are read out of the comparison itself, not out of a
# message: a doc string can be updated while the code that decides is not, and
# the two must not drift -- an .exe that installs a runtime its own engine then
# warns about is a support call on the first run.
$enginePath = Resolve-BundlePath 'install\Install-BConnectMcp.ps1'
if (Test-Path -LiteralPath $enginePath) {
    $engineText = Get-Content -LiteralPath $enginePath -Raw

    # The floor used to be a literal in the engine, and this check grepped for it.
    # It is now DERIVED from the suite -- .nvmrc and every package's engines.node,
    # highest wins -- by Get-NodeVersionFloor in lib\NodeProvisioning.psm1, so
    # there is no literal left to grep and a raised floor raises the engine's too.
    # Comparing against the derivation is the stronger check anyway: it asks
    # whether the .iss pin agrees with what the suite actually declares, rather
    # than whether it agrees with a second copy of the same number.
    $npModule = Resolve-BundlePath 'install\lib\NodeProvisioning.psm1'
    if (Test-Path -LiteralPath $npModule) {
        Import-Module $npModule -Force -DisableNameChecking
        $floor = Get-NodeVersionFloor -SuiteRoot $SuiteRoot
        Check ([Version]$floor.Min -eq [Version]$dMin) `
              'NodeMinVersion matches the floor the engine derives from the suite' `
              ("suite floor $($floor.Min) (fromSuite=$($floor.FromSuite)); NodeMinVersion = $dMin")
    } else {
        Check $false 'NodeMinVersion matches the floor the engine derives from the suite' `
              "lib\NodeProvisioning.psm1 not found at $npModule"
    }

    # if ($nv.Major -lt 22 -or ($nv.Major -eq 22 -and $nv.Minor -lt 15)) { Write-Warn ... }
    $mWarn = [regex]::Match($engineText, '\$nv\.Major\s+-lt\s+(\d+)\s+-or\s+\(\s*\$nv\.Major\s+-eq\s+(\d+)\s+-and\s+\$nv\.Minor\s+-lt\s+(\d+)\s*\)')
    $prefV = [Version]$dPref
    Check ($mWarn.Success -and
           ([int]$mWarn.Groups[1].Value -eq $prefV.Major) -and
           ([int]$mWarn.Groups[2].Value -eq $prefV.Major) -and
           ([int]$mWarn.Groups[3].Value -eq $prefV.Minor)) `
          'NodePreferredVersion matches the threshold the engine warns below' `
          ("engine warns below " +
           $(if ($mWarn.Success) { $mWarn.Groups[1].Value + '.' + $mWarn.Groups[3].Value } else { '(not found)' }) +
           "; NodePreferredVersion = $dPref")
}

# -----------------------------------------------------------------------------
Section '[Files] -- destinations, existence, and staying inside the bundle'

$fileEntries = @($Entries | Where-Object { $_.Section -ieq 'Files' })
Check ($fileEntries.Count -gt 0) 'there is at least one [Files] entry' ("$($fileEntries.Count) entries")

foreach ($e in $fileEntries) {
    $src = if ($e.Contains('Source')) { [string]$e['Source'] } else { '' }
    $label = if ($src) { $src } else { $e.Line }

    Check ($e.Contains('DestDir') -and [string]$e['DestDir']) ("DestDir is set: $label") $e.Line
}

foreach ($e in $fileEntries) {
    if (-not $e.Contains('Source')) { continue }
    $src  = [string]$e['Source']
    $exp  = Expand-IssMacros $src

    # Which root, and what is left of the path after it.
    $root = $null; $tail = $null
    if     ($exp.StartsWith('<BUNDLE>'))    { $root = 'bundle';    $tail = $exp.Substring('<BUNDLE>'.Length) }
    elseif ($exp.StartsWith('<REDIST>'))    { $root = 'redist';    $tail = $exp.Substring('<REDIST>'.Length) }
    elseif ($exp.StartsWith('<PACKAGING>')) { $root = 'packaging'; $tail = $exp.Substring('<PACKAGING>'.Length) }

    Check ([bool]$root) ("Source begins at a declared root: $src") `
          'Every Source: must start with {#BundleDir}, {#RedistDir} or {#SourcePath}. An absolute path in the script packages whatever happens to be on the build machine.'
    if (-not $root) { continue }

    $tail = $tail.TrimStart('\')

    # Escape check, on the text rather than on the resolved path, so a '..' is
    # caught even when the directory it would reach does not exist.
    $escapes = @($tail -split '\\' | Where-Object { $_ -eq '..' }).Count -gt 0
    Check (-not $escapes) ("Source stays inside its root: $src") `
          'A .. segment in a Source path packages files from outside the bundle.'

    $full = switch ($root) {
        'bundle'    { Resolve-BundlePath $tail }
        'redist'    { Join-Path $RedistDir $tail }
        'packaging' { Join-Path $PackagingDir $tail }
    }

    # And again on the resolved path, which catches a root that is itself wrong.
    $rootFull = switch ($root) {
        'bundle'    { if ($UsingRealBundle) { $BundleDir } else { $null } }
        'redist'    { $RedistDir }
        'packaging' { $PackagingDir }
    }
    if ($rootFull) {
        $normFull = [System.IO.Path]::GetFullPath(($full -replace '\*', 'x'))
        $normRoot = [System.IO.Path]::GetFullPath($rootFull).TrimEnd('\') + '\'
        Check ($normFull.StartsWith($normRoot, [StringComparison]::OrdinalIgnoreCase)) `
              ("Source resolves inside its root: $src") "$normFull is not under $normRoot"
    }

    # NOT $matches: that is PowerShell's automatic variable, written by every
    # -match in scope, and a failed -match leaves the PREVIOUS hashtable in it.
    # A missing file would then be reported as present, which is the one result
    # this loop must never produce.
    $srcMatches = @()
    if ($full -match '[\*\?]') {
        $dir = Split-Path -Parent $full
        $pat = Split-Path -Leaf   $full
        if (Test-Path -LiteralPath $dir) { $srcMatches = @(Get-ChildItem -Path $dir -Filter $pat -Force -ErrorAction SilentlyContinue) }
    } elseif (Test-Path -LiteralPath $full) {
        $srcMatches = @(Get-Item -LiteralPath $full)
    }

    if ($srcMatches.Count -gt 0) {
        Check $true ("Source exists: $src") ("$($srcMatches.Count) match(es) at " + (Split-Path -Parent $full))
    } elseif ($root -eq 'redist') {
        Pending ("Source not staged yet: $src") `
                ("Download the official Node.js x64 MSI and place it at $full -- see packaging\README.md. ISCC will not compile without it.")
    } elseif (-not $UsingRealBundle -and $tail -ieq 'offline-bundle.json') {
        Pending ("Source not present in a working tree: $src") `
                'offline-bundle.json is written by install\lib\New-OfflineBundle.ps1. Re-run this check with -BundleDir against a real bundle.'
    } else {
        Check $false ("Source exists: $src") ("nothing matches $full")
    }
}

# -----------------------------------------------------------------------------
Section 'the payload -- what must reach the target, and be covered by an entry'

# Exclusion matching, as Inno does it: a pattern beginning with a backslash is
# matched against the path relative to the Source directory; anything else is
# matched against the file name.
function Test-Excluded {
    param([string] $Relative, [string[]] $Patterns)
    foreach ($p in $Patterns) {
        $pat = $p.Trim()
        if (-not $pat) { continue }
        if ($pat.StartsWith('\')) {
            if (('\' + $Relative) -like $pat) { return $true }
        } else {
            if ((Split-Path -Leaf $Relative) -like $pat) { return $true }
        }
    }
    return $false
}

# Is this bundle-relative path carried by some [Files] entry?
function Test-CoveredByFiles {
    param([string] $Relative)
    foreach ($e in $fileEntries) {
        if (-not $e.Contains('Source')) { continue }
        $exp = Expand-IssMacros ([string]$e['Source'])
        if (-not $exp.StartsWith('<BUNDLE>')) { continue }
        $pat = $exp.Substring('<BUNDLE>'.Length).TrimStart('\')
        $flags = ''
        if ($e.Contains('Flags')) { $flags = [string]$e['Flags'] }
        $recurse = ($flags -match '(?i)recursesubdirs')

        $covered = $false
        if ($pat -eq '*') {
            # Without recursesubdirs a bare '*' carries the root level only. That
            # is not a hypothetical: dropping the flag from the bundle entry
            # still installs package.json and still looks like a working .exe,
            # while node_modules, every build output and the whole of install\
            # quietly do not travel.
            $covered = $recurse -or (($Relative -split '\\').Count -eq 1)
        }
        elseif ($pat.EndsWith('\*')) {
            $prefix = $pat.Substring(0, $pat.Length - 2)
            $covered = $Relative -ilike ($prefix + '\*')
            if ($covered -and -not $recurse) {
                # Without recursesubdirs the entry only carries that one level.
                $covered = (($Relative.Substring($prefix.Length + 1) -split '\\').Count -eq 1)
            }
        }
        elseif ($Relative -ieq $pat) { $covered = $true }

        if (-not $covered -and $recurse -and $pat -eq '*') { $covered = $true }
        if (-not $covered) { continue }

        $ex = @()
        if ($e.Contains('Excludes')) { $ex = ([string]$e['Excludes']) -split ',' }
        if (Test-Excluded $Relative $ex) { continue }
        return $true
    }
    return $false
}

# The files without which the .exe is not the product. Each is checked twice:
# that it exists in the layout being packaged, and that a [Files] entry actually
# carries it -- an exclude pattern that grew one segment too wide would satisfy
# the first and fail the second.
$RequiredPayload = @(
    @{ P = 'package.json';                            W = 'the suite manifest' }
    @{ P = 'package-lock.json';                       W = 'what npm ci resolved on the connected machine' }
    @{ P = 'LICENSE';                                 W = 'shown as the licence page' }
    @{ P = 'packages\mcp-core\build\index.js';        W = 'the shared core, built -- nothing compiles on the target' }
    @{ P = 'bconnect-endpoints-mcp\build\index.js';   W = 'a server, built' }
    @{ P = 'bconnect-mcp-gateway\build\gateway.js';   W = 'the gateway, which the root build script does not build' }
    @{ P = 'install\Install-BConnectMcp.ps1';         W = 'the engine that does all the work' }
    @{ P = 'install\Install-BConnectMcp-UI.ps1';      W = 'the guided installer the .exe offers to launch' }
    @{ P = 'install\bconnect.ps1';                    W = 'the verb CLI, and what the uninstaller delegates removal to' }
    @{ P = 'install\INSTALL.md';                      W = 'the documentation the Start menu points at' }
    @{ P = 'install\lib\catalog.json';                W = 'the server catalogue' }
    @{ P = 'install\lib\hosts.json';                  W = 'the host-target registry' }
    @{ P = 'install\lib\Secrets.psm1';                W = 'credential handling -- the .exe has none of its own' }
    @{ P = 'install\lib\State.psm1';                  W = 'the installation record' }
    @{ P = 'install\lib\merge-config.mjs';            W = 'the JSON merge that keeps unrelated settings byte-identical' }
    @{ P = 'install\lib\emit-host-config.mjs';        W = 'the host config emitters' }
    @{ P = 'install\assets\app.ico';                  W = 'SetupIconFile and UninstallDisplayIcon' }
    @{ P = 'install\packaging\Test-InnoScript.ps1';   W = 'hashed by the bundle manifest, so it must be installed too' }
    @{ P = 'install\Manage-BConnectMcp.ps1';          W = 'the configuration GUI the Start menu points at'
       Pending = 'Written in parallel and not yet in this tree. Until it lands the Configuration shortcut reports its absence rather than failing silently.' }
    @{ P = 'offline-bundle.json';                     W = 'the manifest Install-BConnectMcp.ps1 verifies on the target'
       Pending = 'Written by install\lib\New-OfflineBundle.ps1. Re-run with -BundleDir against a real bundle to check it.' }
)

foreach ($r in $RequiredPayload) {
    $full = Resolve-BundlePath $r.P
    $there = Test-Path -LiteralPath $full
    if (-not $there -and $r.Contains('Pending')) {
        Pending ("payload not present yet: $($r.P)") $r.Pending
    } else {
        Check $there ("payload present: $($r.P)") ("$($r.W); looked at $full")
    }
    Check (Test-CoveredByFiles $r.P) ("payload carried by a [Files] entry: $($r.P)") `
          'No [Files] entry covers it, or an Excludes pattern removes it.'
}

# node_modules, without which the target has to reach npm.
$nmDir = Resolve-BundlePath 'node_modules'
Check (Test-Path -LiteralPath $nmDir) 'node_modules is present in the layout being packaged' $nmDir
Check (Test-CoveredByFiles 'node_modules\.package-lock.json') `
      'node_modules is carried by a [Files] entry' `
      'Without it the target has to reach the npm registry, which is what this .exe exists to avoid.'

# -----------------------------------------------------------------------------
Section 'what must NOT reach the target'

# The bundler excludes these and asserts afterwards that no credentials file is
# present. This is the same assertion at packaging time, because a BundleDir
# pointed at a live working tree by mistake is a real way to ship somebody's
# credentials inside a signed .exe.
$bulk = @($fileEntries | Where-Object { $_.Contains('Source') -and (Expand-IssMacros ([string]$_['Source'])) -eq '<BUNDLE>\*' })
Check ($bulk.Count -eq 1) 'there is exactly one recursive bundle entry' ("found $($bulk.Count)")
if ($bulk.Count -eq 1) {
    $ex = @()
    if ($bulk[0].Contains('Excludes')) { $ex = (([string]$bulk[0]['Excludes']) -split ',') | ForEach-Object { $_.Trim() } }
    foreach ($must in @('\secrets\*', '\install\state\*', '\install\out\*', '\install\packaging\redist\*')) {
        Check ($ex -contains $must) ("the bundle entry excludes $must")
    }
    foreach ($probe in @('secrets\bconnect.env', 'secrets\bconnect.env.dpapi', 'install\state\installation.json', 'install\out\claude-desktop.md')) {
        Check (-not (Test-CoveredByFiles $probe)) ("$probe would NOT be installed")
    }
}

# The .exe collects no credentials. This is checked as an absence, which is weak
# on its own -- so it names the specific constructs that would appear if someone
# implemented a credential page here, rather than searching for the word.
$forbidden = @(
    @{ Token = 'TPasswordEdit';       Why = 'a masked input control on a wizard page' }
    @{ Token = 'PasswordChar';        Why = 'a masked input control on a wizard page' }
    @{ Token = 'CreateInputQueryPage'; Why = 'a wizard page collecting typed values' }
    @{ Token = 'BCONNECT_API_KEY';    Why = 'writing the credentials file directly' }
    @{ Token = 'BCONNECT_PASSWORD';   Why = 'writing the credentials file directly' }
    @{ Token = 'ApiKeySecure';        Why = 'passing a credential to the engine' }
    @{ Token = 'BasicPassSecure';     Why = 'passing a credential to the engine' }
)
foreach ($f in $forbidden) {
    Check ($IssText -notmatch [regex]::Escape($f.Token)) `
          ("the .exe does not collect credentials: no $($f.Token)") `
          ("$($f.Why). Credential collection belongs to Install-BConnectMcp.ps1, which masks input, hardens the directory first and can DPAPI-protect the result.")
}

# -----------------------------------------------------------------------------
Section 'uninstall -- what it is allowed to delete'

Check ($Sections -notcontains 'UninstallDelete') `
      'there is no [UninstallDelete] section' `
      'An [UninstallDelete] entry removes files unconditionally, with no question asked. The credentials and the installation record are the customer''s.'

$dirEntries = @($Entries | Where-Object { $_.Section -ieq 'Dirs' })
foreach ($guard in @('{app}\install\state', '{app}\install\out')) {
    $d = @($dirEntries | Where-Object { ([string]$_['Name']) -eq $guard })
    Check ($d.Count -eq 1 -and ([string]$d[0]['Flags']) -match '(?i)uninsneveruninstall') `
          ("$guard is created and never uninstalled")
}

Check ($IssText -match '(?i)CurUninstallStepChanged') 'the uninstaller runs code of its own'

# Matched against the CODE, not against the prose around it. Every one of these
# reads a construct that only appears if the behaviour is really there: a
# comment saying "delegated to bconnect.ps1" satisfies a word search and nothing
# else, and that is exactly how a guard stops guarding.
Check ($IssText -match "ExpandConstant\('\{app\}\\install\\bconnect\.ps1'\)") `
      'removal is delegated to bconnect.ps1 rather than reimplemented' `
      'The uninstaller must not hand-edit a customer''s MCP client JSON; that logic exists once, in the engine.'
Check ($IssText -match '''"\s+uninstall\s+-Yes') `
      'it invokes the uninstall verb non-interactively' `
      'Expected the verb CLI to be called as: bconnect.ps1 uninstall -Yes'
Check ($IssText -match 'MB_YESNO') 'the uninstaller asks before removing the configuration'
Check (($IssText -match 'MB_YESNO\s*,\s*IDNO\s*\)') -and ($IssText -notmatch 'MB_YESNO\s*,\s*IDYES\s*\)')) `
      'the unattended answer is the safe one' `
      'SuppressibleMsgBox must default to IDNO so that a silent uninstall keeps the credentials rather than destroying them with nobody watching.'
Check ($IssText -match '(?i)API Key') `
      'the uninstaller states that the bMS API key is not revoked'

# -----------------------------------------------------------------------------
Section 'the shim the Start-menu entries point at'

$shim = Join-Path $PackagingDir 'Start-BConnectConfig.cmd'
Check (Test-Path -LiteralPath $shim) 'Start-BConnectConfig.cmd exists' $shim
if (Test-Path -LiteralPath $shim) {
    $shimText = Get-Content -LiteralPath $shim -Raw
    foreach ($mode in @('setup', 'manage', 'cli')) {
        Check ($shimText -match ('(?i)"%MODE%"=="' + $mode + '"')) "the shim handles the $mode mode"
    }
    Check ($shimText -match '(?i)Install-BConnectMcp-UI\.ps1') 'setup mode launches the guided installer'
    Check ($shimText -match '(?i)Manage-BConnectMcp\.ps1')     'manage mode launches the configuration GUI'
    Check ($shimText -match '(?i)bconnect\.ps1')               'cli mode launches the verb CLI'
    Check ($shimText -match '(?i)-Sta')                        'the WPF front ends are launched on an STA thread'
    Check ($shimText -match '(?i)nodejs')                      'the shim repairs PATH for the Node.js directory'
}

$iconEntries = @($Entries | Where-Object { $_.Section -ieq 'Icons' })
foreach ($mode in @('manage', 'setup', 'cli')) {
    Check ([bool]@($iconEntries | Where-Object { ([string]$_['Parameters']) -eq $mode }).Count) `
          "a Start-menu entry exists for the $mode mode"
}
foreach ($e in $iconEntries) {
    $fn = Expand-IssMacros ([string]$e['Filename'])
    Check ($fn -match '^\{(app|uninstallexe|group|sys)' -or $fn -eq '{uninstallexe}') `
          ("Start-menu entry points inside the installation: " + ([string]$e['Name'])) $fn
}

# -----------------------------------------------------------------------------
Write-Host ''
Write-Host ('  {0} passed, {1} failed, {2} pending' -f $script:Pass, $script:Fail, $script:Warn) `
           -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
if ($script:Fail) {
    Write-Host ''
    foreach ($f in $script:Failed) { Write-Host ('    FAILED:  ' + $f) -ForegroundColor Red }
}
if ($script:Warn) {
    Write-Host ''
    Write-Host '  Pending items are inputs that are staged before a build, not defects.' -ForegroundColor Yellow
    Write-Host '  ISCC will refuse to compile until each one is in place:' -ForegroundColor Yellow
    foreach ($w in $script:Warned) { Write-Host ('    PENDING: ' + $w) -ForegroundColor Yellow }
}
Write-Host ''
exit $(if ($script:Fail) { 1 } else { 0 })
