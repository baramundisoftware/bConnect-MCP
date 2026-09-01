<#
.SYNOPSIS
    Demonstrate -- not assert -- what an air-gapped install of the bConnect-MCP
    suite actually requires, by denying the npm registry during a real run.

.DESCRIPTION
    "It works offline" is the kind of claim this project has learned to distrust.
    So this script does not reason about the offline path, it runs it:

      Control A   npm reaches the registry normally      (must SUCCEED, or the
                  denial below proves nothing)
      Control B   npm reaches the registry under denial  (must FAIL -- this is the
                  negative control; every result after it is meaningless without it)
      Test 1      npm ci, under denial, in a node_modules-free copy of the real
                  suite with the real lockfile, WARM npm cache. Observed, not
                  asserted -- see below.
      Test 2      the same, with a COLD npm cache            (must FAIL: this is
                  the step that genuinely needs the internet)
      Test 3      the full installer, with the npm registry denied and pre-staged
                  node_modules                               (must PASS, including
                  a live read from bMS)
      Test 4      the proxy trap, in both directions         (found by accident
                  while building this; see below)

    WHY TEST 1 IS AN OBSERVATION AND NOT AN EXPECTATION
    --------------------------------------------------
    On a machine that has installed this suite before, `npm ci` can SUCCEED with
    the registry unreachable, because the local npm cache already holds every
    tarball. That is not a broken test -- it is a second, perfectly good air-gap
    strategy: ship the npm cache instead of node_modules. Test 2 removes the cache
    so that the underlying question ("does this step need the network?") gets a
    real answer either way.

    THE PROXY TRAP (Test 4)
    -----------------------
    A blunt HTTP_PROXY / HTTPS_PROXY -- the obvious thing to set on a machine with
    no direct internet route -- is inherited by every MCP server the host spawns,
    and their bConnect calls go to the proxy too. bMS is on the LAN and the proxy
    is not going to reach it. The symptom is a server that starts, handshakes
    cleanly, lists all its tools, and then fails EVERY tool call with "Cannot
    connect to the bConnect API", which reads exactly like a bad URL or a bad
    credential. This was found here by setting a proxy for npm and watching the
    live read collapse. Test 4 reproduces it and then shows the clean case.

    WHAT "AIR-GAPPED" MEANS HERE, PRECISELY
    ---------------------------------------
    No INTERNET. bMS is not on the internet -- it is on the LAN, and an install
    that could not reach it would be pointless. So the denial applied here is a
    denial of the npm registry, which is the only thing in this install that needs
    the public internet at all. Denying the LAN as well would test a scenario that
    does not exist.

    HOW THE DENIAL IS APPLIED, AND ITS LIMIT
    ---------------------------------------
    npm's own configuration: the registry is pointed at a discard address, proxies
    are pointed at the same, and npm_config_offline is set so npm refuses network
    access itself. That is a real denial for the process under test and it needs no
    administrator rights.

    It is NOT a kernel-level firewall block. A packet-level block for a single
    executable needs elevation, and this script deliberately does not require it --
    an installer test that only runs elevated does not get run. If you want the
    stronger proof, add an outbound block rule for node.exe and run this again;
    every expectation below stays the same.

.PARAMETER SuiteRoot
    The suite to copy for the npm ci tests. Defaults to <project>\bConnect-MCP-main.
    NOTHING IS RUN INSIDE IT -- npm ci deletes node_modules, so every npm test here
    runs against a throwaway copy made without node_modules.

.PARAMETER SkipInstallerRun
    Skip Test 3. Use when bConnect is unreachable and you only want the npm results.

.PARAMETER KeepScratch
    Leave the temporary directory behind for inspection.
#>
[CmdletBinding()]
param(
    [string] $SuiteRoot,
    [string] $EnvFile,
    [switch] $SkipInstallerRun,
    [switch] $KeepScratch
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$LibDir       = $PSScriptRoot
$InstallerDir = Split-Path -Parent $LibDir
$ProjectRoot  = Split-Path -Parent $InstallerDir
if (-not $SuiteRoot) { $SuiteRoot = Join-Path $ProjectRoot 'bConnect-MCP-main' }
if (-not $EnvFile)   { $EnvFile   = Join-Path $ProjectRoot 'secrets\bconnect.env' }

$pass = 0; $fail = 0; $skip = 0
$failed = New-Object System.Collections.ArrayList

function Check {
    param([bool] $Ok, [string] $What, [string] $Detail)
    if ($Ok) { $script:pass++; Write-Host ('  PASS  ' + $What) -ForegroundColor Green }
    else     { $script:fail++; [void]$script:failed.Add($What); Write-Host ('  FAIL  ' + $What) -ForegroundColor Red }
    if ($Detail) { Write-Host ('        ' + $Detail) -ForegroundColor DarkGray }
}
# For a question whose answer is informative either way. Counting an observation as
# a failure is how a test suite teaches people to ignore it.
function Observe { param([string]$What,[string]$Detail) Write-Host ('  NOTE  ' + $What) -ForegroundColor Cyan; if ($Detail) { Write-Host ('        ' + $Detail) -ForegroundColor DarkGray } }

# The installer writes its progress with Write-Host, which does NOT flow into a
# PowerShell pipeline -- `$x = & installer | Out-String` captures almost nothing.
# So it is run as a child process and its console output read off the pipes.
function Invoke-Installer {
    param([string[]] $Arguments, [hashtable] $ExtraEnv, [int] $TimeoutSec = 600)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
    $psi.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
                     (Join-Path $InstallerDir 'Install-BConnectMcp.ps1') + '" ' + ($Arguments -join ' ')
    $psi.WorkingDirectory       = $InstallerDir
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    if ($ExtraEnv) { foreach ($k in $ExtraEnv.Keys) { $psi.EnvironmentVariables[[string]$k] = [string]$ExtraEnv[$k] } }
    $p = [System.Diagnostics.Process]::Start($psi)
    $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) { try { $p.Kill() } catch { }; return @{ Code = 124; Output = 'TIMED OUT' } }
    return @{ Code = $p.ExitCode; Output = ($o.Result + $e.Result) }
}
function Skip { param([string]$What,[string]$Why) $script:skip++; Write-Host ('  SKIP  ' + $What) -ForegroundColor Yellow; if ($Why) { Write-Host ('        ' + $Why) -ForegroundColor DarkGray } }
function Section { param([string]$T) Write-Host ''; Write-Host ('  -- ' + $T + ' ' + ('-' * [Math]::Max(0, 60 - $T.Length))) -ForegroundColor DarkCyan }

$Scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-offline-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $Scratch -Force | Out-Null

$NpmExe  = (Get-Command 'npm.cmd' -ErrorAction SilentlyContinue).Source
if (-not $NpmExe) { $NpmExe = Join-Path (Split-Path -Parent (Get-Command node).Source) 'npm.cmd' }
$NodeExe = (Get-Command node).Source

# 9 is the discard port: nothing listens there, and a connection to it fails fast
# rather than hanging, so a "denied" result arrives in seconds instead of minutes.
$BlackHole = 'http://127.0.0.1:9/'

function Invoke-Npm {
    param([string[]] $Arguments, [string] $WorkDir, [hashtable] $ExtraEnv, [int] $TimeoutSec = 300)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = 'cmd.exe'
    $psi.Arguments = '/c ""' + $NpmExe + '" ' + ($Arguments -join ' ') + '"'
    $psi.WorkingDirectory       = $WorkDir
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    if ($ExtraEnv) { foreach ($k in $ExtraEnv.Keys) { $psi.EnvironmentVariables[[string]$k] = [string]$ExtraEnv[$k] } }
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd()
    $err = $p.StandardError.ReadToEnd()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) { try { $p.Kill() } catch { }; return @{ Code = 124; Output = 'TIMED OUT' } }
    return @{ Code = $p.ExitCode; Output = ($out + $err) }
}

# The denial, as npm's OWN configuration. Every variable here is read by npm and
# by nothing else; none needs elevation and none touches machine state.
#
# HTTP_PROXY / HTTPS_PROXY are deliberately NOT in this set. They are read by every
# HTTP client in every child process, including the MCP servers' bConnect calls,
# and putting them here would deny the LAN as well as the internet -- testing a
# scenario that does not exist and producing a failure that looks like a bad
# credential. That is not a hypothetical; it is what the first version of this
# script did, and Test 4 exists because of it.
$DenyEnv = @{
    npm_config_registry      = $BlackHole
    npm_config_proxy         = $BlackHole
    'npm_config_https-proxy' = $BlackHole
    npm_config_offline       = 'true'
    npm_config_fetch_retries = '0'
    npm_config_audit         = 'false'
    npm_config_fund          = 'false'
}

Write-Host ''
Write-Host '  Air-gapped install -- demonstrated, not asserted' -ForegroundColor White
Write-Host '  ------------------------------------------------' -ForegroundColor DarkGray
Write-Host ('  suite    ' + $SuiteRoot)
Write-Host ('  scratch  ' + $Scratch)
Write-Host  '  denial   npm registry + proxies pointed at 127.0.0.1:9, npm_config_offline=true'

try {

    # ── The bundle itself, before anything that needs npm ────────────────────
    # Two things the bundle is the last chance to get right, and both were wrong.
    #
    # It copied install\ with only `out` and `.git` excluded, so install\state\
    # installation.json travelled -- another organisation's bConnect base URL, a
    # domain service-account UPN, absolute paths and a host list, going to whoever
    # receives the bundle. The bundle's own leak assertion looked for the two env
    # filenames and nothing else. On the target it was worse than a disclosure: the
    # installer defaults -Hosts and -ProjectDir from the record, so a fresh offline
    # install adopted a configuration belonging to a machine it had never met.
    #
    # And the manifest it wrote was read by nothing anywhere -- no hashes, no
    # lockfile digest, no Node comparison. Air-gapped is precisely the case where
    # nobody from our side is present and there is no second chance.
    #
    # This runs against a MINIATURE suite root, not the real one: the subject is the
    # copy rules and the manifest, and copying several GB of node_modules to
    # establish them would mean nobody ever runs this.
    Section 'the offline bundle -- what leaves, and what the target can check'

    $bundleSrc = Join-Path $Scratch 'fake-suite'
    New-Item -ItemType Directory -Path $bundleSrc -Force | Out-Null
    '{ "name": "fake-suite", "version": "0.0.0-test" }' |
        Set-Content -LiteralPath (Join-Path $bundleSrc 'package.json') -Encoding UTF8
    '{ "lockfileVersion": 3 }' |
        Set-Content -LiteralPath (Join-Path $bundleSrc 'package-lock.json') -Encoding UTF8
    $bundleDst = Join-Path $Scratch 'bundle-out'

    # The record has to exist in install\state for its absence downstream to mean
    # anything. Use the real one when there is one, otherwise plant a stand-in.
    $realState    = Join-Path $InstallerDir 'state\installation.json'
    $plantedState = $false
    if (-not (Test-Path -LiteralPath $realState)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $realState) -Force | Out-Null
        '{ "schema": 1, "credentials": { "baseUrl": "https://planted.invalid/bconnect" } }' |
            Set-Content -LiteralPath $realState -Encoding UTF8
        $plantedState = $true
    }
    Check (Test-Path -LiteralPath $realState) 'CONTROL: there IS an installation record to leak' $realState

    try {
        $bres = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
                  -File (Join-Path $LibDir 'New-OfflineBundle.ps1') `
                  -Destination $bundleDst -SuiteRoot $bundleSrc -SkipBuild 2>&1 | Out-String
        $bcode = $LASTEXITCODE
    } finally {
        if ($plantedState) { Remove-Item -LiteralPath $realState -Force -ErrorAction SilentlyContinue }
    }
    Check ($bcode -eq 0) 'the bundle builds' (($bres -split "`r?`n" | Where-Object { $_ -match 'FAIL' } | Select-Object -First 2) -join ' / ')

    $leakedRecords = @(Get-ChildItem -Path $bundleDst -Recurse -File -Filter 'installation.json' -ErrorAction SilentlyContinue)
    Check ($leakedRecords.Count -eq 0) `
          "INST-4: the build machine's installation record does NOT travel in the bundle" `
          ($leakedRecords.FullName -join ', ')
    Check (Test-Path (Join-Path $bundleDst 'install\Install-BConnectMcp.ps1')) `
          'CONTROL: the installer itself DID travel (what is excluded is state, not install)'

    $bmPath = Join-Path $bundleDst 'offline-bundle.json'
    Check (Test-Path -LiteralPath $bmPath) 'a manifest is written' $bmPath
    if (Test-Path -LiteralPath $bmPath) {
        $bm = Get-Content -LiteralPath $bmPath -Raw | ConvertFrom-Json
        $bmFiles = @()
        if ($bm.PSObject.Properties.Name -contains 'files') { $bmFiles = @($bm.files.PSObject.Properties) }
        Check ($bmFiles.Count -gt 0) 'INST-5: the manifest records a hash per artefact' ("$($bmFiles.Count) entries")
        Check ($bm.hashAlgorithm -eq 'SHA256') 'and names the algorithm'
        Check ([bool]($bmFiles | Where-Object { $_.Name -match 'package-lock\.json$' })) `
              'INST-5: the lockfile is among them'
        Check ([bool]($bmFiles | Where-Object { $_.Name -match 'Install-BConnectMcp\.ps1$' })) `
              'INST-5: so is the installer that will read this manifest'
        Check (($bm.PSObject.Properties.Name -contains 'nodeModules') -and
               ($bm.nodeModules.PSObject.Properties.Name -contains 'fileCount')) `
              'INST-5: node_modules is measured rather than hashed file by file'

        # Every recorded hash must match what was actually copied. Without this the
        # manifest could record anything at all and still "have hashes".
        $wrong = @()
        foreach ($f in $bmFiles) {
            $full = Join-Path $bundleDst $f.Name
            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { $wrong += ($f.Name + ' (missing)'); continue }
            if ((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash -ne $f.Value) { $wrong += $f.Name }
        }
        Check ($wrong.Count -eq 0) 'every recorded hash matches the file that was copied' `
              (($wrong | Select-Object -First 4) -join ', ')

        # And the installer reads it. Same manifest, tampered payload.
        $victim = Join-Path $bundleDst 'install\lib\catalog.json'
        if (Test-Path -LiteralPath $victim) {
            Add-Content -LiteralPath $victim -Value ' '
            # -SecretsDir points at an empty scratch directory on purpose. The
            # manifest check runs in Step 1, so a correct installer stops there --
            # and if it ever stops checking, the credential-less non-interactive
            # path stops the run at Step 3 rather than letting a test reach the
            # live bMS.
            $ires = Invoke-Installer @(
                '-BundleManifest', ('"' + $bmPath + '"'),
                '-SecretsDir',     ('"' + (Join-Path $Scratch 'no-credentials') + '"'),
                '-NonInteractive', '-DryRun', '-SkipBuild'
            ) -TimeoutSec 240
            Check ($ires.Output -match '(?i)does not match the manifest') `
                  'INST-5: the installer VERIFIES the manifest on the target, rather than only writing it' `
                  (($ires.Output -split "`r?`n" | Where-Object { $_ -match '(?i)bundle|manifest' } | Select-Object -First 3) -join ' / ')
            Check ($ires.Output -match 'catalog\.json') 'and names the file that changed'
        } else {
            Skip 'the installer verifies the manifest' 'catalog.json did not travel; nothing to tamper with'
        }
    }

    # ── Controls ─────────────────────────────────────────────────────────────
    Section 'controls -- is the denial real?'

    $ctlA = Invoke-Npm @('ping') $Scratch @{ npm_config_fetch_retries = '1' } 40
    $haveInternet = ($ctlA.Code -eq 0)
    if ($haveInternet) {
        Check $true 'Control A: npm reaches the registry WITHOUT the denial' 'so a failure under denial means the denial, not a broken machine'
    } else {
        Skip 'Control A: npm reaches the registry WITHOUT the denial' `
             ('this machine cannot reach the npm registry even undenied (' +
              (($ctlA.Output -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)) +
              '). Control B below therefore proves nothing, and neither do Tests 1-2.')
    }

    $ctlB = Invoke-Npm @('ping') $Scratch $DenyEnv 40
    Check ($ctlB.Code -ne 0) 'Control B: npm CANNOT reach the registry under the denial' `
          (($ctlB.Output -split "`r?`n" | Where-Object { $_ -match 'ERR|offline|ECONN|proxy' } | Select-Object -First 1))

    # ── Test 1 / 2: npm ci, the thing that actually breaks ───────────────────
    Section 'npm ci -- the one step that needs the internet'

    $copy = Join-Path $Scratch 'suite-copy'
    Write-Host '  copying the suite without node_modules (npm ci DELETES node_modules --' -ForegroundColor DarkGray
    Write-Host '  it is never run against the real tree)...' -ForegroundColor DarkGray
    $rc = robocopy $SuiteRoot $copy /E /XD node_modules .git /NFL /NDL /NJH /NJS /NP /R:1 /W:1 2>&1 | Out-Null
    $haveCopy = (Test-Path (Join-Path $copy 'package-lock.json'))
    Check $haveCopy 'a node_modules-free copy of the real suite was made, with its real lockfile' $copy

    if (-not $haveCopy) {
        Skip 'Test 1 / Test 2' 'no usable copy of the suite'
    } else {
        $t1 = Invoke-Npm @('ci', '--ignore-scripts') $copy $DenyEnv 240
        if ($t1.Code -eq 0) {
            Observe 'Test 1: npm ci SUCCEEDED under the denial, on a WARM npm cache' `
                    ('every tarball was already in ' + (npm config get cache) + ' -- so shipping the npm CACHE is a second viable air-gap strategy, not a bug')
        } else {
            Observe 'Test 1: npm ci failed under the denial even with a warm cache' `
                    (($t1.Output -split "`r?`n" | Where-Object { $_ -match 'ERR' } | Select-Object -First 1))
        }

        $coldCache = Join-Path $Scratch 'cold-npm-cache'
        New-Item -ItemType Directory -Path $coldCache -Force | Out-Null
        $copy2 = Join-Path $Scratch 'suite-copy-2'
        robocopy $SuiteRoot $copy2 /E /XD node_modules .git /NFL /NDL /NJH /NJS /NP /R:1 /W:1 2>&1 | Out-Null
        $denyCold = @{} + $DenyEnv
        $denyCold['npm_config_cache'] = $coldCache
        $t2 = Invoke-Npm @('ci', '--ignore-scripts') $copy2 $denyCold 240
        Check ($t2.Code -ne 0) 'Test 2: npm ci FAILS under the denial with a COLD cache' `
              (($t2.Output -split "`r?`n" | Where-Object { $_ -match 'ERR!' } | Select-Object -First 2) -join ' / ')
    }

    # ── Test 3: the installer itself, offline ────────────────────────────────
    Section 'the installer, under the same denial, with dependencies pre-staged'

    if ($SkipInstallerRun) {
        Skip 'Test 3: full installer run under denial' '-SkipInstallerRun was given'
    } elseif (-not (Test-Path (Join-Path $SuiteRoot 'node_modules'))) {
        Skip 'Test 3: full installer run under denial' `
             'the suite has no node_modules to pre-stage -- run New-OfflineBundle.ps1 on a connected machine first'
    } elseif (-not (Test-Path -LiteralPath $EnvFile) -and -not (Test-Path -LiteralPath ($EnvFile + '.dpapi'))) {
        Skip 'Test 3: full installer run under denial' "no credentials file at $EnvFile"
    } else {
        $sandbox = Join-Path $Scratch 'install'
        New-Item -ItemType Directory -Path $sandbox, (Join-Path $sandbox 'proj'), (Join-Path $sandbox 'out') -Force | Out-Null
        $cfg = Join-Path $sandbox 'desktop.json'
        '{ "unrelatedPreference": { "theme": "dark" } }' | Set-Content -LiteralPath $cfg -Encoding UTF8

        $installArgs = @(
            '-NonInteractive', '-ReuseCredentials', '-SkipBuild',
            '-Servers', 'bconnect-endpoints',
            '-Hosts', 'claude-desktop,claude-code,generic',
            '-ProjectDir', ('"' + (Join-Path $sandbox 'proj') + '"'),
            '-HostOutDir', ('"' + (Join-Path $sandbox 'out') + '"'),
            '-ConfigPath', ('"' + $cfg + '"')
        )
        # The npm registry denied, with a cold npm cache for good measure, and no
        # HTTP proxy: exactly the shape of a machine with no internet route but a
        # working LAN.
        $denyCold3 = @{} + $DenyEnv
        $denyCold3['npm_config_cache'] = (Join-Path $Scratch 'cold-cache-3')
        $t3 = Invoke-Installer $installArgs $denyCold3

        Check ($t3.Code -eq 0) 'Test 3: the installer completes with the npm registry denied' `
              ('exit ' + $t3.Code + '; ' + (($t3.Output -split "`r?`n" | Where-Object { $_ -match '\[FAIL\]' } | Select-Object -First 1)))
        Check ((Test-Path $cfg) -and ((Get-Content $cfg -Raw) -match 'bconnect-endpoints')) `
              'Test 3: a Claude Desktop configuration was written offline'
        Check (Test-Path (Join-Path $sandbox 'proj\.mcp.json')) 'Test 3: a Claude Code .mcp.json was written offline'
        Check ($t3.Output -match 'PASS\s+live read') 'Test 3: a live bMS read succeeded -- the LAN is not the internet'
        if ($t3.Code -ne 0) {
            Write-Host '        installer output tail:' -ForegroundColor DarkGray
            foreach ($l in ($t3.Output -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 14)) {
                Write-Host ('          ' + $l) -ForegroundColor DarkGray
            }
        }

        # ── Test 4: the proxy trap, both directions ──────────────────────────
        Section 'the proxy trap -- the mistake this scenario invites'

        $sandbox4 = Join-Path $Scratch 'install-proxy'
        New-Item -ItemType Directory -Path $sandbox4, (Join-Path $sandbox4 'proj') -Force | Out-Null
        $cfg4 = Join-Path $sandbox4 'desktop.json'
        '{}' | Set-Content -LiteralPath $cfg4 -Encoding UTF8
        $args4 = @(
            '-NonInteractive', '-ReuseCredentials', '-SkipBuild', '-ContinueOnUnreachable',
            '-Servers', 'bconnect-endpoints', '-Hosts', 'claude-desktop',
            '-ProjectDir', ('"' + (Join-Path $sandbox4 'proj') + '"'),
            '-ConfigPath', ('"' + $cfg4 + '"')
        )
        $withProxy = @{} + $denyCold3
        $withProxy['HTTP_PROXY']  = $BlackHole
        $withProxy['HTTPS_PROXY'] = $BlackHole
        $t4 = Invoke-Installer $args4 $withProxy

        $sawProxyFailure = ($t4.Output -match 'Cannot connect to the bConnect API') -or ($t4.Output -match 'ECONNREFUSED 127\.0\.0\.1:9')
        Check $sawProxyFailure 'Test 4a: a blunt HTTP_PROXY breaks every tool call, reproduced' `
              'the server starts, handshakes and lists all 68 tools -- and then every call fails'
        if ($sawProxyFailure) {
            Write-Host '        The failure text is "Cannot connect to the bConnect API. Check network' -ForegroundColor Yellow
            Write-Host '        connectivity and BCONNECT_BASE_URL configuration." -- which reads exactly' -ForegroundColor Yellow
            Write-Host '        like a wrong URL or a wrong key, and is neither. On a machine with no' -ForegroundColor Yellow
            Write-Host '        direct internet route, setting HTTP_PROXY is the obvious thing to do,' -ForegroundColor Yellow
            Write-Host '        and every MCP server the host spawns inherits it. bMS is on the LAN;' -ForegroundColor Yellow
            Write-Host '        the proxy will not reach it.' -ForegroundColor Yellow
            Write-Host '        FIX: put the bMS host in NO_PROXY, or do not set a proxy in the' -ForegroundColor Yellow
            Write-Host '        environment the MCP host is launched from.' -ForegroundColor Yellow
        }
        # And the control: the same run without the proxy must succeed, or 4a proved
        # nothing about the proxy and only that something was broken.
        Check ($t3.Output -match 'PASS\s+live read') `
              'Test 4b: control -- the same configuration with NO proxy reads live bMS data' `
              'so 4a is the proxy, not a broken install'
    }

    # ── What this adds up to ─────────────────────────────────────────────────
    Section 'what an air-gapped install therefore requires'
    Write-Host '  1. Node.js 22.15+ installed from an MSI carried in by hand. The installer'
    Write-Host '     does not download it and never has.'
    Write-Host '  2. node_modules PRE-STAGED. This is the whole of the problem: npm ci is the'
    Write-Host '     only step that needs the public internet. lib\New-OfflineBundle.ps1 packs'
    Write-Host '     an installed, built tree on a connected machine; unpack it and run the'
    Write-Host '     installer with -SkipBuild.'
    Write-Host '  3. bMS reachable on the LAN. Air-gapped means no internet, not no network --'
    Write-Host '     an install that could not reach bConnect would have nothing to configure.'
    Write-Host '  4. NO blunt HTTP_PROXY in the environment the MCP host is launched from,'
    Write-Host '     or bMS excluded from it via NO_PROXY. See Test 4 -- this is the trap the'
    Write-Host '     scenario invites, and its symptom is indistinguishable from a bad key.'
    Write-Host '  5. A local model, if the point is that nothing leaves the network at all:'
    Write-Host '     LibreChat or Continue in front of Ollama, configured with -Hosts.'
    Write-Host ''
    Write-Host '  Two ways to pre-stage, both demonstrated above:' -ForegroundColor White
    Write-Host '    a) ship node_modules  -- lib\New-OfflineBundle.ps1, then -SkipBuild'
    Write-Host '    b) ship the npm CACHE -- Test 1 shows npm ci succeeding from a warm cache'
    Write-Host '       with the registry unreachable. Smaller to carry, but it only works if'
    Write-Host '       the cache really holds every tarball; Test 2 shows what a cold one does.'

} finally {
    if ($KeepScratch) { Write-Host ''; Write-Host ('  scratch kept at ' + $Scratch) -ForegroundColor DarkGray }
    else { Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ('  {0} passed, {1} failed, {2} skipped' -f $pass, $fail, $skip) -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
if ($fail) { foreach ($f in $failed) { Write-Host ('    FAILED: ' + $f) -ForegroundColor Red } }
Write-Host ''
exit $(if ($fail) { 1 } else { 0 })
