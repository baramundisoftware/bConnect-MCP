<#
    NodeProvisioning.psm1 -- finding, staging, verifying and installing the Node.js
    runtime the suite runs on. The ONLY implementation of that work in this tree.

    WHY THIS EXISTS
    ---------------
    A bMS server frequently has no route to the public internet, and the installer
    is expected to complete on it. Everything else already travels: the suite, its
    node_modules and its build output are carried in by lib\New-OfflineBundle.ps1,
    bMS is on the LAN, and every remaining step is local. Node was the one
    prerequisite that did not travel. The bundle's closing message said

        Install Node.js 22.15+ from an MSI carried in by hand (nodejs.org, x64 MSI).

    and "carry it in by hand" is the step people get wrong. The operator arrives at
    an air-gapped machine, runs Install-BConnectMcp.ps1, and it stops at Step 1 on
    a prerequisite there is now no way to obtain. That is the failure this file
    removes.

    TWO ROUTES, AND ONLY ONE OF THEM IS ALLOWED TO BE REQUIRED
    ----------------------------------------------------------
      Route 1 -- STAGED MEDIA. install\packaging\redist\, the directory
        packaging\bconnect-mcp.iss already reads its MSI from. Reused rather than
        reinvented: a second convention for the same file is a second thing to get
        wrong. New-OfflineBundle.ps1 carries the directory into the bundle and
        records in the manifest whether a runtime is in it. This route needs no
        network at any point on the target, which is what makes it the route that
        has to work.

      Route 2 -- DOWNLOAD from nodejs.org. A convenience for a connected machine,
        never a dependency. It is opt-in: Resolve-NodeRuntime does not touch the
        network unless -AllowDownload was passed. An install the operator believes
        is offline does not make a silent outbound call.

    NOTHING IS INSTALLED WHEN SOMETHING ADEQUATE IS PRESENT
    -------------------------------------------------------
    A bMS server is not this product's machine. Other software on it may depend on
    the Node that is already there, so an adequate runtime is detected and left
    exactly as it is -- not upgraded, not repaired, not reordered on PATH. The
    floor is read from the suite itself (.nvmrc and every package's engines.node)
    rather than repeated here, so a suite that raises its floor raises this one.

    WHAT IS VERIFIED, AND WHY IT IS NOT OPTIONAL
    --------------------------------------------
    A downloaded MSI is checked against the SHASUMS256.txt nodejs.org publishes
    beside it, before it is executed, and a mismatch deletes the file and refuses.
    This product carries a domain credential; an installer that runs an unverified
    binary it fetched over the network is a supply-chain hole regardless of how
    unlikely the tamper is. Staged media is hashed too: the hash is recorded in the
    bundle manifest on the connected machine and re-checked on the target, which
    catches the failure that actually happens to a 30 MB file crossing a USB stick.

    THE PATH TRAP
    -------------
    The Node MSI edits the MACHINE PATH. A process that was already running when it
    did so inherited its environment beforehand and cannot see the change, so
    `node` stays unresolvable in the very process that just installed it -- which
    reads as "the installation is broken" one second after it succeeded.
    packaging\Start-BConnectConfig.cmd documents this trap for the processes Setup
    launches; Repair-NodePathInProcess below is the same repair for this process,
    re-reading PATH from the registry rather than guessing at a directory.

    ELEVATION
    ---------
    msiexec requires it. A run that is not elevated states that as a condition,
    with the media it found and the command it would have run, rather than failing
    inside msiexec with exit code 1625.

    Tests: install\lib\Test-NodeProvisioning.ps1
#>

Set-StrictMode -Version Latest

# nodejs.org's published layout. Both files live under the same version directory,
# which is the property that makes the checksum meaningful: the SHASUMS256.txt that
# describes an MSI is served from the same place the MSI is.
$script:NODE_DIST_BASE = 'https://nodejs.org/dist'
$script:SHASUMS_NAME   = 'SHASUMS256.txt'

# The version this installer would DOWNLOAD when asked to, and the threshold below
# which the suite warns. Both are 22.15.0 for the same reason: from 22.15 Node reads
# the Windows certificate store, which is the clean answer to a bMS presenting an
# internal-CA certificate. Below it the operator has to set BCONNECT_CA_CERT_PATH by
# hand. This is NOT the floor -- the floor is read from the suite, see
# Get-NodeVersionFloor -- because no package.json declares it.
$script:NODE_PREFERRED_VERSION = '22.15.0'

# Consulted only when the suite cannot be read at all (a front end asking what the
# rules are before it knows where the suite is). It matches .nvmrc today; if the two
# ever disagree, the suite wins, and Test-NodeProvisioning.ps1 checks that they do
# not disagree.
$script:NODE_FLOOR_FALLBACK = '20.0.0'

# Route 1's directory, relative to install\. packaging\bconnect-mcp.iss defines
# RedistDir as SourcePath + "redist" with SourcePath = packaging\, so this is the
# same folder that script already expects, named the same way.
$script:MEDIA_SUBPATH = 'packaging\redist'

# x64 only. ArchitecturesAllowed in the .iss is x64compatible and the suite is not
# tested on anything else, so an arm64 or x86 MSI staged by mistake is not silently
# accepted as "a Node MSI".
$script:MSI_PATTERN = '^node-v(\d+\.\d+\.\d+)-x64\.msi$'

# Where the MSI puts itself. Used only to recover from the PATH trap, never to
# decide that Node is present -- that question is answered by running node -v.
$script:DEFAULT_NODE_DIR = 'nodejs'


function Get-NodeVersionFloor {
<#
.SYNOPSIS
    The minimum Node version the suite declares, read from the suite.

.DESCRIPTION
    Two sources, both of which are the suite stating its own requirement:

      .nvmrc                          one bare version
      engines.node in every package   ">=20.0.0"

    The floor is the HIGHEST of everything found, because a single package that
    needs 22 makes 22 the requirement whatever the others say. Every contributing
    file is reported in Sources so that a raised floor can be traced to the file
    that raised it.

    -SuiteRoot absent or unreadable falls back to the module constant and says so
    in Sources. A front end that has not resolved the suite yet still gets a number
    it can print.

    Returns @{ Min; Preferred; Sources; FromSuite }.
#>
    [CmdletBinding()]
    param([string] $SuiteRoot)

    $found   = @()
    $sources = @()

    if ($SuiteRoot -and (Test-Path -LiteralPath $SuiteRoot)) {
        $nvmrc = Join-Path $SuiteRoot '.nvmrc'
        if (Test-Path -LiteralPath $nvmrc -PathType Leaf) {
            $raw = ((Get-Content -LiteralPath $nvmrc -Raw) -replace '^\s*v?', '').Trim()
            $v = $null
            if ([Version]::TryParse(($raw -replace '-.*$', ''), [ref] $v)) {
                $found += $v; $sources += ('.nvmrc: ' + $raw)
            }
        }

        # The root package.json, every server package and everything under packages\.
        $pkgs = @()
        foreach ($p in @((Join-Path $SuiteRoot 'package.json'))) {
            if (Test-Path -LiteralPath $p -PathType Leaf) { $pkgs += $p }
        }
        foreach ($d in @(Get-ChildItem -LiteralPath $SuiteRoot -Directory -ErrorAction SilentlyContinue |
                         Where-Object { $_.Name -like 'bconnect-*' -or $_.Name -eq 'packages' })) {
            foreach ($p in @(Get-ChildItem -LiteralPath $d.FullName -Recurse -Depth 1 -Filter 'package.json' -File -ErrorAction SilentlyContinue)) {
                $pkgs += $p.FullName
            }
        }
        foreach ($p in ($pkgs | Select-Object -Unique)) {
            $json = $null
            try { $json = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json } catch { continue }
            if (-not $json) { continue }
            $names = @($json.PSObject.Properties.Name)
            if ($names -notcontains 'engines') { continue }
            $eng = @($json.engines.PSObject.Properties.Name)
            if ($eng -notcontains 'node') { continue }
            $spec = [string]$json.engines.node
            if ($spec -match '(\d+)\.(\d+)\.(\d+)') {
                $v = [Version]("$($Matches[1]).$($Matches[2]).$($Matches[3])")
                $found += $v
                $sources += ((Split-Path -Leaf (Split-Path -Parent $p)) + '\package.json engines.node: ' + $spec)
            }
        }
    }

    $fromSuite = ($found.Count -gt 0)
    $min = if ($fromSuite) { ($found | Sort-Object -Descending | Select-Object -First 1) }
           else            { [Version]$script:NODE_FLOOR_FALLBACK }
    if (-not $fromSuite) {
        $sources += ('the suite could not be read; using the recorded floor ' + $script:NODE_FLOOR_FALLBACK)
    }

    return [ordered]@{
        Min       = $min
        Preferred = [Version]$script:NODE_PREFERRED_VERSION
        Sources   = @($sources)
        FromSuite = $fromSuite
    }
}


function Get-NodeMediaDirectory {
<#
.SYNOPSIS
    Route 1's directory: <install>\packaging\redist.

.DESCRIPTION
    One convention, defined once. packaging\bconnect-mcp.iss reads its MSI from the
    same folder; New-OfflineBundle.ps1 carries it; this module reads it on the
    target. Nothing computes that path independently.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [string] $InstallerDir)
    return (Join-Path $InstallerDir $script:MEDIA_SUBPATH)
}


function Get-StagedNodeMedia {
<#
.SYNOPSIS
    Which Node MSIs are staged, and whether each clears the floor.

.DESCRIPTION
    Filenames are the vendor's own -- node-v<major>.<minor>.<patch>-x64.msi -- so
    the version is read from the name rather than by unpacking the MSI. A file that
    does not match that shape is not treated as a Node runtime at all: an arm64 or
    x86 MSI dropped in by mistake is reported as ignored rather than installed onto
    a machine the suite is not tested on.

    -Sha256 computes the hash of each candidate. It is off by default because the
    caller that only wants to know whether media EXISTS should not pay for a 30 MB
    hash; New-OfflineBundle.ps1 and the manifest check both pass it.

    Highest adequate version first, so the caller can take [0].

    Returns an array of @{ Path; File; Version; Adequate; SizeBytes; Sha256 }.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $MediaPath,
        [Version] $MinVersion,
        [switch] $Sha256
    )
    if (-not $MinVersion) { $MinVersion = [Version]$script:NODE_FLOOR_FALLBACK }
    if (-not (Test-Path -LiteralPath $MediaPath -PathType Container)) { return @() }

    $out = @()
    foreach ($f in @(Get-ChildItem -LiteralPath $MediaPath -File -Filter '*.msi' -ErrorAction SilentlyContinue)) {
        if ($f.Name -notmatch $script:MSI_PATTERN) { continue }
        $v = [Version]$Matches[1]
        $hash = $null
        if ($Sha256) { $hash = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
        $out += [ordered]@{
            Path      = $f.FullName
            File      = $f.Name
            Version   = $v
            Adequate  = ($v -ge $MinVersion)
            SizeBytes = [long]$f.Length
            Sha256    = $hash
        }
    }
    return @($out | Sort-Object -Property @{ Expression = { $_.Adequate }; Descending = $true },
                                          @{ Expression = { $_.Version };  Descending = $true })
}


function Get-NodeMsiFileName {
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [string] $Version)
    return ('node-v' + ($Version -replace '^v', '') + '-x64.msi')
}

function Get-NodeMsiUrl {
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [string] $Version)
    $v = ($Version -replace '^v', '')
    return ($script:NODE_DIST_BASE + '/v' + $v + '/' + (Get-NodeMsiFileName $v))
}

function Get-NodeShaSumsUrl {
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [string] $Version)
    return ($script:NODE_DIST_BASE + '/v' + ($Version -replace '^v', '') + '/' + $script:SHASUMS_NAME)
}


function Test-NodeMsiChecksum {
<#
.SYNOPSIS
    Does this file match the checksum nodejs.org published for it.

.DESCRIPTION
    Pure: it is handed the file and the TEXT of a SHASUMS256.txt, and does no I/O
    beyond hashing the file. That is deliberate -- the decision to refuse must be
    testable without a network, and the fetch is somebody else's job.

    SHASUMS256.txt is one record per line, "<sha256>  <filename>". A filename with
    no line is a FAILURE, not an absence: the checksum file that does not mention
    the artefact cannot vouch for it, and treating "not listed" as "nothing to
    check" would defeat the whole exercise.

    Returns @{ Ok; Expected; Actual; Reason }.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [AllowEmptyString()] [string] $ShaSumsText,
        [string] $FileName
    )
    if (-not $FileName) { $FileName = Split-Path -Leaf $Path }

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{ Ok = $false; Expected = $null; Actual = $null
                           Reason = "the file to check does not exist: $Path" }
    }

    $expected = $null
    foreach ($line in ($ShaSumsText -split "`r?`n")) {
        if ($line -match '^\s*([0-9a-fA-F]{64})\s+\*?(\S+)\s*$') {
            if ($Matches[2] -eq $FileName) { $expected = $Matches[1].ToLowerInvariant(); break }
        }
    }
    if (-not $expected) {
        return [ordered]@{ Ok = $false; Expected = $null; Actual = $null
                           Reason = "$($script:SHASUMS_NAME) contains no entry for $FileName" }
    }

    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        return [ordered]@{ Ok = $false; Expected = $expected; Actual = $actual
                           Reason = "checksum mismatch for $FileName" }
    }
    return [ordered]@{ Ok = $true; Expected = $expected; Actual = $actual
                       Reason = "$FileName matches the published checksum" }
}


function Save-VerifiedNodeMsi {
<#
.SYNOPSIS
    Route 2: fetch a Node MSI and leave it on disk ONLY if it verifies.

.DESCRIPTION
    Order matters and is not an accident:

      1. fetch SHASUMS256.txt, from the same version directory as the MSI;
      2. fetch the MSI to a .part file, which is not a name anything executes;
      3. verify;
      4. rename into place, or DELETE.

    On any failure the .part file is removed and no file exists at -Destination.
    That is the property the caller depends on and the one the test asserts: a
    refusal must not leave an executable artefact behind for a later run, or for a
    hand-run by an operator who assumes a file in redist\ was checked.

    -FetchText and -FetchFile exist so that the refusal path can be tested without
    a network and without a real 30 MB download. They replace the transport and
    nothing else; the verification and the deletion are the same code either way.

    Returns @{ Ok; Path; Reason; Expected; Actual; Url }.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Version,
        [Parameter(Mandatory)] [string] $Destination,
        [scriptblock] $FetchText,
        [scriptblock] $FetchFile
    )

    $file    = Get-NodeMsiFileName $Version
    $msiUrl  = Get-NodeMsiUrl      $Version
    $sumsUrl = Get-NodeShaSumsUrl  $Version
    $part    = $Destination + '.part'

    if (-not $FetchText) {
        $FetchText = { param($Url) (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 120).Content }
    }
    if (-not $FetchFile) {
        $FetchFile = { param($Url, $OutFile) Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 600 -OutFile $OutFile }
    }

    $dir = Split-Path -Parent $Destination
    if ($dir -and -not (Test-Path -LiteralPath $dir -PathType Container)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue }

    $sums = $null
    try { $sums = [string](& $FetchText $sumsUrl) } catch {
        return [ordered]@{ Ok = $false; Path = $null; Expected = $null; Actual = $null; Url = $sumsUrl
                           Reason = ('the published checksum file could not be fetched: ' + $_.Exception.Message) }
    }
    if (-not $sums) {
        return [ordered]@{ Ok = $false; Path = $null; Expected = $null; Actual = $null; Url = $sumsUrl
                           Reason = 'the published checksum file was empty' }
    }

    try { & $FetchFile $msiUrl $part } catch {
        if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue }
        return [ordered]@{ Ok = $false; Path = $null; Expected = $null; Actual = $null; Url = $msiUrl
                           Reason = ('the runtime could not be downloaded: ' + $_.Exception.Message) }
    }
    if (-not (Test-Path -LiteralPath $part -PathType Leaf)) {
        return [ordered]@{ Ok = $false; Path = $null; Expected = $null; Actual = $null; Url = $msiUrl
                           Reason = 'the download produced no file' }
    }

    $check = Test-NodeMsiChecksum -Path $part -ShaSumsText $sums -FileName $file
    if (-not $check.Ok) {
        Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
        return [ordered]@{ Ok = $false; Path = $null; Expected = $check.Expected; Actual = $check.Actual
                           Url = $msiUrl; Reason = $check.Reason }
    }

    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue }
    Move-Item -LiteralPath $part -Destination $Destination -Force
    return [ordered]@{ Ok = $true; Path = $Destination; Expected = $check.Expected; Actual = $check.Actual
                       Url = $msiUrl; Reason = $check.Reason }
}


function Test-ProcessIsElevated {
<#
.SYNOPSIS
    Whether this process can run msiexec against the machine.
#>
    [CmdletBinding()]
    [OutputType([bool])]
    param()
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        return ([Security.Principal.WindowsPrincipal]$id).IsInRole(
                 [Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        # An identity that cannot be read is not evidence of elevation.
        return $false
    }
}


function Get-NodeMsiArguments {
<#
.SYNOPSIS
    The msiexec command line, as one array, so that it can be asserted on.

.DESCRIPTION
    /qn silent, /norestart because a bMS server reboots when its owner says so, and
    a verbose log because the support case this saves is "it failed on a server I
    cannot reach".

    ADDLOCAL IS DELIBERATELY ABSENT. The Node MSI's NativeTools feature downloads a
    C++ build toolchain from the internet during installation; ADDLOCAL=ALL selects
    it, and on the air-gapped machine this whole module exists for that turns a
    silent install into a long hang followed by a failure. Nothing here needs it:
    the suite ships built, and node_modules was resolved on the connected machine.
#>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)] [string] $MsiPath,
        [Parameter(Mandatory)] [string] $LogPath
    )
    return @('/i', ('"' + $MsiPath + '"'), '/qn', '/norestart', '/l*v', ('"' + $LogPath + '"'))
}


function Repair-NodePathInProcess {
<#
.SYNOPSIS
    Make node resolvable in THIS process after the MSI has edited the machine PATH.

.DESCRIPTION
    The trap packaging\Start-BConnectConfig.cmd documents, in the one place that
    creates it: the MSI writes the machine PATH, this process inherited its
    environment before that happened, and so Get-Command node still fails one line
    after a successful install.

    PATH is re-read from the registry -- machine then user, the order Windows
    composes them in -- rather than having a directory appended to it. Re-reading
    picks up wherever the MSI actually put itself, including a non-default
    INSTALLDIR, and does not invent an entry for a directory that may not exist.
    The well-known location is appended only as a fallback, and only when it exists
    and the re-read did not already produce a working node.

    Returns the resolved node.exe path, or $null.
#>
    [CmdletBinding()]
    param([string[]] $ExtraDirectories = @())

    $parts = @()
    foreach ($scope in @('Machine', 'User')) {
        $p = $null
        try { $p = [Environment]::GetEnvironmentVariable('PATH', $scope) } catch { }
        if ($p) { $parts += ($p -split ';' | Where-Object { $_ }) }
    }
    foreach ($d in @($ExtraDirectories)) { if ($d) { $parts += $d } }

    $pf = $env:ProgramFiles
    if ($pf) {
        $wellKnown = Join-Path $pf $script:DEFAULT_NODE_DIR
        if (Test-Path -LiteralPath $wellKnown -PathType Container) { $parts += $wellKnown }
    }

    if ($parts.Count) {
        $env:PATH = (($parts | Select-Object -Unique) -join ';')
    }

    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return [string]$cmd.Source }
    return $null
}


function Get-InstalledNodeRuntime {
<#
.SYNOPSIS
    What Node, if any, this machine already has, and what version it reports.

.DESCRIPTION
    Answered by RUNNING node -v, not by reading a registry key, for the same reason
    packaging\bconnect-mcp.iss gives: the question the suite actually asks is
    whether node is on PATH, because every launcher resolves it that way. A
    registry entry for a runtime PATH does not reach installs cleanly and then
    fails at the first server start.

    PATH is consulted first. The well-known directory is consulted only when PATH
    does not answer, which is the post-MSI state and nothing else -- an existing
    Node the administrator put somewhere of their own choosing keeps precedence,
    exactly as in packaging\Start-BConnectConfig.cmd.

    Returns @{ Present; Path; Version; Raw; OnPath } -- Present is $false with the
    rest null when there is nothing.
#>
    [CmdletBinding()]
    param()

    $path   = $null
    $onPath = $false
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $path = [string]$cmd.Source; $onPath = $true }
    if (-not $path -and $env:ProgramFiles) {
        $candidate = Join-Path (Join-Path $env:ProgramFiles $script:DEFAULT_NODE_DIR) 'node.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $path = $candidate }
    }
    if (-not $path) {
        return [ordered]@{ Present = $false; Path = $null; Version = $null; Raw = $null; OnPath = $false }
    }

    $raw = $null
    try { $raw = (& $path -v 2>$null | Select-Object -First 1) } catch { }
    $ver = $null
    if ($raw) {
        $trimmed = ([string]$raw).Trim() -replace '^v', '' -replace '-.*$', ''
        $parsed = $null
        if ([Version]::TryParse($trimmed, [ref] $parsed)) { $ver = $parsed }
    }
    return [ordered]@{
        Present = [bool]$ver
        Path    = $path
        Version = $ver
        Raw     = $(if ($raw) { ([string]$raw).Trim() } else { $null })
        OnPath  = $onPath
    }
}


function Get-NodeRuntimeRefusal {
<#
.SYNOPSIS
    The refusal, in the shape every front end already prints.

.DESCRIPTION
    Same three keys as lib\UserContext.psm1's Get-PerUserWriteRefusal -- Reason,
    Detail, Action -- so a caller prints it the same way and no front end writes
    its own wording for this.

    It names BOTH routes, always. An operator who reads only the first line of a
    refusal has to be able to act on it, and the two routes have different
    preconditions: one needs a file carried in, the other needs a network this
    machine may not have. Stating only the one that is unavailable is how a
    refusal becomes a dead end.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Floor,
        [Parameter(Mandatory)] [string] $MediaPath,
        [array]  $MediaFound = @(),
        [bool]   $DownloadAllowed = $false,
        [bool]   $Elevated = $true,
        [string] $DownloadFailure,
        $Installed
    )

    $ver = $script:NODE_PREFERRED_VERSION
    $msi = Get-NodeMsiFileName $ver

    $detail = @()
    if ($Installed -and $Installed.Present) {
        $detail += ("Node $($Installed.Raw) at $($Installed.Path) is below the floor.")
    } else {
        $detail += 'node is not on PATH, and no Node.js runtime is present at the default location.'
    }
    $detail += ("The suite requires Node $($Floor.Min) or newer; $($Floor.Preferred) or newer is preferred on Windows.")
    foreach ($s in @($Floor.Sources)) { $detail += ('  floor source: ' + $s) }

    if (Test-Path -LiteralPath $MediaPath -PathType Container) {
        if (@($MediaFound).Count) {
            $detail += ('staged media: ' + $MediaPath)
            foreach ($m in @($MediaFound)) {
                $detail += ('  ' + $m.File + '  version ' + $m.Version +
                            $(if ($m.Adequate) { '' } else { '  -- below the floor, not used' }))
            }
        } else {
            $detail += ('staged media: ' + $MediaPath + ' exists and contains no node-v*-x64.msi.')
        }
    } else {
        $detail += ('staged media: ' + $MediaPath + ' does not exist.')
    }

    if ($DownloadFailure) {
        $detail += ('download: attempted and refused -- ' + $DownloadFailure)
    } elseif ($DownloadAllowed) {
        $detail += 'download: permitted for this run, and it did not produce a usable runtime.'
    } else {
        $detail += 'download: not permitted for this run, so no network call was made.'
    }

    if (-not $Elevated) {
        $detail += 'elevation: this process is not elevated, and msiexec requires it.'
    }

    $action = @(
        'Route 1 -- staged media. This is the route that works with no internet access.',
        '    On a computer that has internet access, download the x64 MSI and the checksum',
        '    file published beside it:',
        ('        ' + (Get-NodeMsiUrl $ver)),
        ('        ' + (Get-NodeShaSumsUrl $ver)),
        ('    Confirm the SHA256 of the MSI against the ' + $msi + ' line in ' + $script:SHASUMS_NAME + '.'),
        ('    Copy the MSI into ' + $MediaPath),
        '    on this computer, then run this installer again. Staging it before running',
        '    lib\New-OfflineBundle.ps1 carries it into the bundle instead, which is the',
        '    intended order for an air-gapped target.',
        '',
        'Route 2 -- download. This requires internet access from this computer.',
        '    Run this installer again with -AllowNodeDownload. The MSI is fetched from',
        ('    ' + $script:NODE_DIST_BASE + ', checked against the published ' + $script:SHASUMS_NAME + ','),
        '    and deleted without being executed on any mismatch.'
    )
    if (-not $Elevated) {
        $action += @(
            '',
            'Both routes install the runtime with msiexec, which requires elevation.',
            'Start PowerShell with Run as administrator and repeat the command.'
        )
    }

    return [ordered]@{
        Reason = 'Node.js is not available on this computer and no runtime was available to install'
        Detail = @($detail)
        Action = @($action)
    }
}


function Resolve-NodeRuntime {
<#
.SYNOPSIS
    Ensure an adequate Node runtime, or refuse and say how to obtain one. The ONE
    implementation: the console installer, the wizard and the offline bundle all
    reach this function and none of them repeats any part of it.

.DESCRIPTION
    The order is the product decision, and it is:

      1. An adequate Node is already here            -> nothing is installed.
      2. Staged media in install\packaging\redist\   -> installed from the file.
      3. -AllowDownload                              -> fetched, verified, installed.
      4. Otherwise                                   -> a refusal naming both routes.

    Step 1 is first because a bMS server is not this product's machine: other
    software on it may depend on the Node that is there, and replacing a runtime
    nobody asked to have replaced is a worse outcome than a slightly old one.
    Step 2 is before step 3 because the file is already local, already verifiable
    against the manifest, and does not depend on a network the operator may believe
    is absent.

    -PlanOnly answers "what would happen" without installing anything. It is what a
    prerequisites page calls, and it is why the wizard has no runtime logic of its
    own.

    -ManifestSha256 is the hash lib\New-OfflineBundle.ps1 recorded for the staged
    MSI on the connected machine. When it is supplied and the file on this machine
    disagrees, the media is refused: 30 MB crossing removable media is exactly the
    thing that arrives truncated, and an MSI that no longer matches what left the
    build machine is not run.

    -ProbeNode, -InvokeMsi, -FetchText, -FetchFile and -Elevated replace the five
    things this function reads from or does to the machine, and exist so the
    decision table above can be tested on a machine that must not have its runtime
    touched -- the same reason Get-ProcessUserContext takes -AppData. Every one of
    them defaults to the real implementation, and none of them changes a decision;
    they change only where the answer comes from.

    Returns @{ Outcome; Route; NodePath; NodeVersion; Floor; Media; MediaPath;
               MediaFound; Refusal; Detail; Log }
    with Outcome one of Present | Installed | Plan | Refused.
#>
    [CmdletBinding()]
    param(
        [string] $SuiteRoot,
        [Parameter(Mandatory)] [string] $InstallerDir,
        [string] $MediaPath,
        [switch] $AllowDownload,
        [switch] $PlanOnly,
        [string] $DownloadVersion,
        [string] $ManifestSha256,
        [string] $LogPath,
        [bool]   $Elevated,
        [scriptblock] $ProbeNode,
        [scriptblock] $InvokeMsi,
        [scriptblock] $FetchText,
        [scriptblock] $FetchFile
    )

    if (-not $PSBoundParameters.ContainsKey('Elevated')) { $Elevated = (Test-ProcessIsElevated) }

    if (-not $MediaPath)       { $MediaPath       = Get-NodeMediaDirectory -InstallerDir $InstallerDir }
    if (-not $DownloadVersion) { $DownloadVersion = $script:NODE_PREFERRED_VERSION }
    if (-not $ProbeNode)       { $ProbeNode       = { Get-InstalledNodeRuntime } }
    if (-not $LogPath) {
        $outDir = Join-Path $InstallerDir 'out'
        if (-not (Test-Path -LiteralPath $outDir -PathType Container)) {
            New-Item -ItemType Directory -Path $outDir -Force | Out-Null
        }
        $LogPath = Join-Path $outDir 'node-msi.log'
    }

    $floor  = Get-NodeVersionFloor -SuiteRoot $SuiteRoot
    $detail = @()
    $log    = @()

    $installed = & $ProbeNode

    $result = [ordered]@{
        Outcome     = 'Refused'
        Route       = 'none'
        NodePath    = $null
        NodeVersion = $null
        Floor       = $floor
        Media       = $null
        MediaPath   = $MediaPath
        MediaFound  = @()
        Refusal     = $null
        Detail      = @()
        Log         = @()
        Elevated    = $Elevated
    }

    # --- 1: something adequate is already here ------------------------------------
    if ($installed.Present -and $installed.Version -ge $floor.Min) {
        $result.Outcome     = 'Present'
        $result.Route       = 'existing'
        $result.NodePath    = $installed.Path
        $result.NodeVersion = $installed.Version
        $detail += ("Node $($installed.Raw) at $($installed.Path) is at or above the floor $($floor.Min); nothing is installed.")
        if (-not $installed.OnPath) {
            $detail += 'It was not resolvable on PATH in this process; PATH was repaired for this process only.'
            if (-not $PlanOnly) { [void](Repair-NodePathInProcess) }
        }
        if ($installed.Version -lt $floor.Preferred) {
            $detail += ("It is below the preferred $($floor.Preferred), which reads the Windows certificate store. " +
                        'An internal-CA bMS requires BCONNECT_CA_CERT_PATH on this version.')
        }
        $result.Detail = @($detail)
        return $result
    }

    if ($installed.Present) {
        $detail += ("Node $($installed.Raw) at $($installed.Path) is below the floor $($floor.Min).")
    } else {
        $detail += 'No Node.js runtime is present on this computer.'
    }

    # --- 2: staged media ----------------------------------------------------------
    $media  = @(Get-StagedNodeMedia -MediaPath $MediaPath -MinVersion $floor.Min -Sha256:([bool]$ManifestSha256))
    $result.MediaFound = $media
    $chosen = @($media | Where-Object { $_.Adequate }) | Select-Object -First 1

    if ($chosen -and $ManifestSha256) {
        if ($chosen.Sha256 -ne $ManifestSha256.ToLowerInvariant()) {
            $detail += ('The staged runtime does not match the hash recorded in the bundle manifest. ' +
                        'Expected ' + $ManifestSha256.ToLowerInvariant() + ', found ' + $chosen.Sha256 + '. ' +
                        'It is not run.')
            $chosen = $null
        } else {
            $detail += 'The staged runtime matches the hash recorded in the bundle manifest.'
        }
    }

    $downloadFailure = $null
    $source          = $null
    $route           = 'none'

    if ($chosen) {
        $source = $chosen
        $route  = 'media'
        $detail += ("Staged media will be used: $($chosen.Path) (Node $($chosen.Version)).")
    } elseif ($AllowDownload) {
        # --- 3: download, announced, verified ------------------------------------
        $route  = 'download'
        $detail += ("No adequate staged media. -AllowNodeDownload was passed, so the runtime is fetched from " +
                    (Get-NodeMsiUrl $DownloadVersion) + ' and checked against the published ' + $script:SHASUMS_NAME + '.')
        if ($PlanOnly) {
            $result.Outcome = 'Plan'
            $result.Route   = 'download'
            $result.Detail  = @($detail)
            return $result
        }
        $dest = Join-Path $MediaPath (Get-NodeMsiFileName $DownloadVersion)
        $dl = Save-VerifiedNodeMsi -Version $DownloadVersion -Destination $dest -FetchText $FetchText -FetchFile $FetchFile
        $log += ('download: ' + $dl.Reason)
        if (-not $dl.Ok) {
            $downloadFailure = $dl.Reason
            $detail += ('The download was refused: ' + $dl.Reason + '. Nothing was executed.')
            if ($dl.Expected -and $dl.Actual) {
                $detail += ('  expected ' + $dl.Expected)
                $detail += ('  found    ' + $dl.Actual)
            }
            $route  = 'none'
            $source = $null
        } else {
            $detail += ('The download matched the published checksum: ' + $dl.Expected + '.')
            $source = [ordered]@{
                Path = $dl.Path; File = (Split-Path -Leaf $dl.Path)
                Version = [Version]($DownloadVersion -replace '^v', '')
                Adequate = $true; SizeBytes = (Get-Item -LiteralPath $dl.Path).Length; Sha256 = $dl.Actual
            }
        }
    } else {
        $detail += 'No adequate staged media, and downloading was not permitted for this run.'
    }

    # --- 4: refuse ----------------------------------------------------------------
    if (-not $source) {
        $result.Refusal = Get-NodeRuntimeRefusal -Floor $floor -MediaPath $MediaPath -MediaFound $media `
                            -DownloadAllowed ([bool]$AllowDownload) -Elevated $result.Elevated `
                            -DownloadFailure $downloadFailure -Installed $installed
        $result.Detail = @($detail)
        $result.Log    = @($log)
        return $result
    }

    $result.Media = $source
    $result.Route = $route

    # Elevation is a CONDITION, stated before msiexec is reached rather than after it
    # returns 1625 with no explanation of what 1625 means.
    if (-not $result.Elevated) {
        $refusal = Get-NodeRuntimeRefusal -Floor $floor -MediaPath $MediaPath -MediaFound $media `
                     -DownloadAllowed ([bool]$AllowDownload) -Elevated $false -Installed $installed
        $refusal.Reason = 'the Node.js runtime is available to install, and this process is not elevated'
        $refusal.Detail = @(
            ('runtime to install: ' + $source.Path + '  (Node ' + $source.Version + ')'),
            'msiexec requires administrator rights to install a runtime for the machine.',
            'Nothing has been changed on this computer.'
        )
        $refusal.Action = @(
            'Start PowerShell with Run as administrator and repeat the same command.',
            'The staged runtime stays where it is and is used on the next run.'
        )
        $result.Refusal = $refusal
        $result.Detail  = @($detail)
        $result.Log     = @($log)
        return $result
    }

    if ($PlanOnly) {
        $result.Outcome = 'Plan'
        $result.Detail  = @($detail)
        $result.Log     = @($log)
        return $result
    }

    # --- install ------------------------------------------------------------------
    # Not $args: that is an automatic variable, and shadowing it inside a function
    # that also takes a scriptblock is how a call site silently gets the wrong list.
    $msiArgs = Get-NodeMsiArguments -MsiPath $source.Path -LogPath $LogPath
    $log += ('msiexec ' + ($msiArgs -join ' '))
    if (-not $InvokeMsi) {
        $InvokeMsi = {
            param($Arguments)
            $exe = Join-Path ([Environment]::GetFolderPath('System')) 'msiexec.exe'
            $p = Start-Process -FilePath $exe -ArgumentList $Arguments -Wait -PassThru -WindowStyle Hidden
            return $p.ExitCode
        }
    }
    $code = -1
    try { $code = [int](& $InvokeMsi $msiArgs) } catch {
        $log += ('msiexec could not be started: ' + $_.Exception.Message)
    }
    $log += ('msiexec exit code ' + $code)

    # 3010 is "installed, a restart is pending". The runtime is usable now.
    if ($code -ne 0 -and $code -ne 3010) {
        $result.Refusal = [ordered]@{
            Reason = ("the Node.js runtime installation failed (msiexec exit code $code)")
            Detail = @(
                ('runtime: ' + $source.Path),
                ('log:     ' + $LogPath),
                $(if ($code -eq 1625) { 'Exit code 1625 is a system policy that forbids this installation.' }
                  elseif ($code -eq 1603) { 'Exit code 1603 is a generic MSI failure; the verbose log names the action that failed.' }
                  else { 'The verbose log names the action that failed.' })
            )
            Action = @(
                'Read the log named above, or install the MSI by hand to see the error in a window:',
                ('    msiexec /i "' + $source.Path + '"'),
                'Then run this installer again. An adequate runtime is detected and nothing is reinstalled.'
            )
        }
        $result.Detail = @($detail)
        $result.Log    = @($log)
        return $result
    }

    # The PATH trap. Not optional: without this, the very next Get-Command node in
    # the caller fails on a machine where the install just succeeded.
    $resolved = Repair-NodePathInProcess
    $after    = & $ProbeNode
    if (-not $after.Present) {
        $result.Refusal = [ordered]@{
            Reason = 'the Node.js runtime installed, and node is still not resolvable in this process'
            Detail = @(
                ('msiexec reported success (exit code ' + $code + ') and the log is at ' + $LogPath + '.'),
                'PATH was re-read from the registry and node.exe was still not found.'
            )
            Action = @(
                'Close this window, open a new one, and run the installer again. A new process',
                'reads the machine PATH the MSI wrote.'
            )
        }
        $result.Detail = @($detail)
        $result.Log    = @($log)
        return $result
    }

    $result.Outcome     = 'Installed'
    $result.NodePath    = $(if ($resolved) { $resolved } else { $after.Path })
    $result.NodeVersion = $after.Version
    $detail += ("Node $($after.Raw) installed from $($source.File) and resolvable in this process.")
    $result.Detail = @($detail)
    $result.Log    = @($log)
    return $result
}


Export-ModuleMember -Function Get-NodeVersionFloor, Get-NodeMediaDirectory, Get-StagedNodeMedia,
                              Get-NodeMsiFileName, Get-NodeMsiUrl, Get-NodeShaSumsUrl,
                              Test-NodeMsiChecksum, Save-VerifiedNodeMsi, Test-ProcessIsElevated,
                              Get-NodeMsiArguments, Repair-NodePathInProcess, Get-InstalledNodeRuntime,
                              Get-NodeRuntimeRefusal, Resolve-NodeRuntime
