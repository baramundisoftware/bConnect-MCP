<#
.SYNOPSIS
    Build an offline bundle of the bConnect-MCP suite on a CONNECTED machine, for
    installation on one with no internet access.

.DESCRIPTION
    Only one step of this installation needs the public internet: `npm ci`. Node
    comes from an MSI you carry in, bMS is on the LAN, and everything else the
    installer does is local. lib\Test-OfflineInstall.ps1 demonstrates that rather
    than asserting it -- it denies the npm registry and shows npm ci failing and the
    installer succeeding.

    So the offline path is: do the npm work here, carry the result there.

    This script:
      1. runs `npm ci` in the suite root, if node_modules is not already present;
      2. builds @bconnect/mcp-core, then every bconnect-*-mcp server;
      3. builds the GATEWAY -- which the suite's own root build script does not,
         because its glob is bconnect-*-mcp and the gateway directory is
         bconnect-mcp-gateway. Building "everything" upstream skips it, and you
         find out at `npm start`. Offline is a bad moment to find out;
      4. carries the NODE RUNTIME. install\packaging\redist\ is the staging folder
         packaging\bconnect-mcp.iss already reads its MSI from, and the bundle
         carries it as-is. -StageNodeRuntime downloads the MSI here, on the
         connected machine, and verifies it against the SHASUMS256.txt nodejs.org
         publishes beside it, so the operator does not have to do it by hand;
      5. copies the suite (WITH node_modules and build output) and the installer to
         a destination directory, optionally zipping it;
      6. writes a manifest recording the Node version, the package set, the build
         outputs present AND whether a runtime is in the bundle, so the target
         machine can check what it received rather than assume.

    NODE WAS THE GAP. Everything else already travelled; the runtime did not, and
    the closing message told the operator to carry an MSI in by hand. On an
    air-gapped machine that is the step people get wrong, and the installer there
    has no way to recover from it. A bundle that carries no runtime is now stated
    as such -- in the closing message and in the manifest -- rather than left to be
    discovered on the target. -RequireNodeRuntime turns that statement into a
    failure, which is what a release build should pass.

    NO CREDENTIALS ARE COPIED. The secrets directory is excluded explicitly, and
    the manifest records that it was. Credentials are collected on the target
    machine by the installer, into an ACL-hardened directory there.

.PARAMETER Destination
    Where to write the bundle. Required.

.PARAMETER SuiteRoot
    The suite to bundle. Defaults to <project>\bConnect-MCP-main.

.PARAMETER Zip
    Also produce a .zip beside the bundle directory. Slow -- node_modules is a very
    large number of very small files -- but convenient for a single-file transfer.

.PARAMETER SkipBuild
    Bundle what is on disk without running npm ci or a build. Only sensible when
    the tree is known to be current.

.PARAMETER StageNodeRuntime
    Download the Node.js x64 MSI into install\packaging\redist and verify it
    against nodejs.org's published SHASUMS256.txt before it is bundled. This is
    the connected machine, which is the only place that download belongs.

.PARAMETER NodeVersion
    Which runtime -StageNodeRuntime fetches. Defaults to the version
    lib\NodeProvisioning.psm1 records as preferred.

.PARAMETER RequireNodeRuntime
    Exit non-zero when the bundle would carry no Node runtime. A release build
    passes this; a bundle for a target known to have Node does not have to.

.PARAMETER Production
    Reduce the bundled node_modules to the production set, by running
    `npm ci --omit=dev` in the COPY. The bundle ships prebuilt, so build-time
    dependencies are dead weight on the target: measured, 17,107 files / 164.5 MB
    complete against 7,087 / 45.7 MB production-only.

    The copy is then PROVEN by running it -- every server is started from inside
    the pruned bundle and made to answer tools/list, and every declared production
    dependency is resolved from the bundle's own tree. A failure fails the build.
    The bundle that cannot be repaired on the target is the one that must not ship
    unverified.

    Costs a second npm install, so it needs the internet like the build does. The
    target still needs none. Note that a bundle built this way cannot run the
    suite's own tests; it is for installing, which is what a bundle is for.

.EXAMPLE
    .\New-OfflineBundle.ps1 -Destination D:\bconnect-mcp-offline -StageNodeRuntime -RequireNodeRuntime
    Then, on the air-gapped machine:
        (copy the bundle to C:\bConnect-MCP)
        cd C:\bConnect-MCP\install
        .\Install-BConnectMcp.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Destination,
    [string] $SuiteRoot,
    [switch] $Zip,
    [switch] $SkipBuild,
    [switch] $StageNodeRuntime,
    [string] $NodeVersion,
    [switch] $RequireNodeRuntime,
    [switch] $Production
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$LibDir       = $PSScriptRoot
$InstallerDir = Split-Path -Parent $LibDir
$ProjectRoot  = Split-Path -Parent $InstallerDir
if (-not $SuiteRoot) { $SuiteRoot = Join-Path $ProjectRoot 'bConnect-MCP-main' }

# The staging folder, the floor, the download and the checksum all come from the one
# module that owns them. Nothing about the Node runtime is decided in this file.
Import-Module (Join-Path $LibDir 'NodeProvisioning.psm1') -Force -DisableNameChecking

function Say  { param([string]$m) Write-Host ('  ' + $m) }
function Ok   { param([string]$m) Write-Host ('  [ ok ] ' + $m) -ForegroundColor Green }
function Warn { param([string]$m) Write-Host ('  [warn] ' + $m) -ForegroundColor Yellow }
function Die  { param([string]$m) Write-Host ('  [FAIL] ' + $m) -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $SuiteRoot 'package.json'))) { Die "no package.json under $SuiteRoot" }

$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) { Die 'Node.js is not on PATH.' }
$NodeVer = (& $NodeExe -v)
$NpmExe  = (Get-Command 'npm.cmd' -ErrorAction SilentlyContinue).Source
if (-not $NpmExe) { $NpmExe = Join-Path (Split-Path -Parent $NodeExe) 'npm.cmd' }
if (-not (Test-Path $NpmExe)) { Die 'npm.cmd not found next to node.exe.' }

function Invoke-Npm {
    param([string[]] $Arguments, [string] $WorkDir)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = 'cmd.exe'
    $psi.Arguments = '/c ""' + $NpmExe + '" ' + ($Arguments -join ' ') + '"'
    $psi.WorkingDirectory       = $WorkDir
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    return @{ Code = $p.ExitCode; Output = ($o.Result + $e.Result) }
}

# Same shape, for node. NOT `& $NodeExe ... 2>&1`: in PowerShell 5.1 redirecting a
# native command's stderr wraps every line in an ErrorRecord, which reorders it
# against stdout and buried the verifier's own summary line on the first run --
# the failure was legible only because the exit code was checked separately.
function Invoke-Node {
    param([string[]] $Arguments, [string] $WorkDir)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = $NodeExe
    $psi.Arguments = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $psi.WorkingDirectory       = $WorkDir
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    return @{ Code = $p.ExitCode; Out = $o.Result; Err = $e.Result }
}

Write-Host ''
Write-Host '  bConnect-MCP -- offline bundle' -ForegroundColor White
Write-Host '  -----------------------------' -ForegroundColor DarkGray
Say ("suite        $SuiteRoot")
Say ("destination  $Destination")
Say ("node         $NodeVer")

# Anything that did not compile. An air-gapped install is the one case where nobody
# from our side is present and there is no second chance, so a bundle with a missing
# build output is a failed build of the bundle -- it is still written, because the
# evidence is more useful than an empty directory, but this script does not exit 0.
$BuildFailures = @()

# --- 1/2/3: install and build -------------------------------------------------
if ($SkipBuild) {
    Warn 'skipping npm ci and the build (-SkipBuild). Bundling whatever is on disk.'
} else {
    if (-not (Test-Path (Join-Path $SuiteRoot 'node_modules'))) {
        Say 'npm ci -- this needs the internet, which is the entire point of this script'
        $r = Invoke-Npm @('ci') $SuiteRoot
        if ($r.Code -ne 0) { Write-Host $r.Output; Die 'npm ci failed.' }
        Ok 'dependencies installed'
    } else {
        Ok 'node_modules already present -- skipping npm ci'
    }

    Say 'building @bconnect/mcp-core'
    $r = Invoke-Npm @('run', 'build', '-w', '@bconnect/mcp-core') $SuiteRoot
    if ($r.Code -ne 0) { Write-Host $r.Output; Die 'the shared core package did not compile; nothing else can build.' }
    Ok '@bconnect/mcp-core'

    foreach ($d in (Get-ChildItem -Path $SuiteRoot -Directory -Filter 'bconnect-*-mcp' |
                    Where-Object { $_.Name -ne 'bconnect-mcp-gateway' } | Select-Object -ExpandProperty Name)) {
        $r = Invoke-Npm @('run', 'build', '-w', $d) $SuiteRoot
        if ($r.Code -ne 0) { Warn "$d did not compile -- it will be bundled unbuilt"; $BuildFailures += $d } else { Ok $d }
    }

    # The gateway, explicitly. The suite's root build script is a shell loop over
    # bconnect-*-mcp; the gateway lives in bconnect-mcp-gateway and is therefore
    # skipped by it. That is an upstream inconsistency, and offline is the worst
    # possible time to discover it.
    $gwDir = Join-Path $SuiteRoot 'bconnect-mcp-gateway'
    if (Test-Path $gwDir) {
        if (-not (Test-Path (Join-Path $gwDir 'node_modules'))) {
            $r = Invoke-Npm @('install') $gwDir
            if ($r.Code -ne 0) { Warn 'the gateway''s own npm install failed' }
        }
        $r = Invoke-Npm @('run', 'build') $gwDir
        if ($r.Code -ne 0) { Warn 'the gateway did not compile -- HTTP targets will not work offline'; $BuildFailures += 'bconnect-mcp-gateway' }
        else { Ok 'bconnect-mcp-gateway (which the root build script does NOT build)' }
    }
}

# --- 4: the Node runtime ------------------------------------------------------
# The one prerequisite that did not travel. install\packaging\redist is the folder
# packaging\bconnect-mcp.iss already stages its MSI in; it is reused rather than
# duplicated, and it is inside install\, so the copy below carries it with
# everything else.
#
# The download happens HERE, on the connected machine, and is verified here. The
# target is not asked to do either: it has no network by assumption, and an
# installer that fetches and runs a binary is a supply-chain surface this product
# does not need to have.
$MediaDir = Get-NodeMediaDirectory -InstallerDir $InstallerDir
$NodeFloor = Get-NodeVersionFloor -SuiteRoot $SuiteRoot
if (-not $NodeVersion) { $NodeVersion = [string]$NodeFloor.Preferred }

if ($StageNodeRuntime) {
    $wanted = Join-Path $MediaDir (Get-NodeMsiFileName $NodeVersion)
    if (Test-Path -LiteralPath $wanted -PathType Leaf) {
        Ok ("Node runtime already staged: " + (Split-Path -Leaf $wanted))
    } else {
        Say ("downloading the Node $NodeVersion x64 MSI and verifying it against " +
             (Get-NodeShaSumsUrl $NodeVersion))
        $dl = Save-VerifiedNodeMsi -Version $NodeVersion -Destination $wanted
        if (-not $dl.Ok) {
            Die ('the Node runtime was not staged: ' + $dl.Reason +
                 '. No file was left behind and nothing was executed.')
        }
        Ok ('Node runtime staged and verified: ' + (Split-Path -Leaf $dl.Path) + '  sha256 ' + $dl.Expected)
    }
}

$StagedMedia = @(Get-StagedNodeMedia -MediaPath $MediaDir -MinVersion $NodeFloor.Min -Sha256)
$NodeMedia   = @($StagedMedia | Where-Object { $_.Adequate }) | Select-Object -First 1
if ($NodeMedia) {
    Ok ("Node runtime in this bundle: $($NodeMedia.File)  (Node $($NodeMedia.Version), $([math]::Round($NodeMedia.SizeBytes / 1MB, 1)) MB)")
} else {
    Warn ("no Node runtime in $MediaDir -- the bundle carries none")
}

# --- 5: copy -----------------------------------------------------------------
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$dstSuite = Join-Path $Destination 'bConnect-MCP-main'
$dstInst  = Join-Path $Destination 'install'

Say 'copying the suite (this includes node_modules, so it is large and slow)...'
robocopy $SuiteRoot $dstSuite /E /XD .git /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { Die "robocopy failed copying the suite (exit $LASTEXITCODE)" }
Ok 'suite copied'

# --- 5b: the development directories do not travel ---------------------------
#
# coverage\, __tests__\ and scripts\ are build-time and evaluation artefacts. A
# bundle exists to INSTALL the suite; none of the three is read by the installer,
# by the verifier, or by a server at runtime -- checked, not assumed: no
# package.json names them in main/bin/files/exports, and nothing under install\
# refers to the suite's scripts directory.
#
# They are removed because they carry the estate they were written against.
# Measured on the first build that omitted this step: 86 files carrying a domain
# name, a server name, client machine names or an internal IP address, all of it
# in coverage reports, test fixtures and demo scripts. It also took 25 MB with it.
#
# PRUNED AFTER THE COPY, not excluded during it. robocopy /XD with a bare
# directory name matches at EVERY level, including inside node_modules, where a
# scripts\ directory can hold code a package actually runs. Excluding by name
# would have been shorter and would have quietly broken a dependency.
$pruneNames = @('coverage', '__tests__', 'scripts')
$pruned = 0
foreach ($d in @(Get-ChildItem -LiteralPath $dstSuite -Recurse -Directory -Force -ErrorAction SilentlyContinue |
                 Where-Object { $_.Name -in $pruneNames -and $_.FullName -notmatch '\\node_modules\\' })) {
    if (Test-Path -LiteralPath $d.FullName) {
        Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
        $pruned++
    }
}
Ok "development directories removed from the copy -- $pruned (coverage, __tests__, scripts; node_modules untouched)"

# --- 5c: production-only dependencies ----------------------------------------
#
# The bundle ships PREBUILT, so every build-time dependency in it is dead weight on
# the target: measured, the full set is 17,107 files / 164.5 MB and the production
# set is 7,087 / 45.7 MB.
#
# Done with `npm ci --omit=dev` IN THE COPY rather than by deleting directories out
# of it. Hand-pruning a dependency tree means deciding which of 389 packages are
# reachable at runtime, and being wrong once produces a bundle that installs on an
# air-gapped machine and cannot run -- with no network there to repair it. npm
# already knows the answer from the lockfile; this asks it instead of guessing.
# Verified safe first: no workspace declares prepare/postinstall/preinstall, so
# there is no lifecycle script here that needs the dev tools being removed.
#
# THEN IT IS PROVEN, not assumed. A production install that merely completes says
# nothing -- the failure being guarded against is a require() that resolves today
# only because a dev dependency happened to supply it. So every server is STARTED
# from inside the pruned bundle and made to answer tools/list, and every declared
# production dependency is resolved from the bundle's own tree. A failure here
# fails the build: this is precisely the bundle that must not ship broken.
$productionOnly = $false
if ($Production) {
    Say 'npm ci --omit=dev in the copy -- this needs the internet, like the build above'
    $r = Invoke-Npm @('ci', '--omit=dev') $dstSuite
    if ($r.Code -ne 0) { Write-Host $r.Output; Die 'npm ci --omit=dev failed in the bundle copy.' }
    $productionOnly = $true
    Ok 'dependencies reduced to the production set'

    $verifier = Join-Path $dstSuite '.verify-production.mjs'
    # Written INSIDE the bundle deliberately: Node resolves from the importing
    # file's location, so a verifier living anywhere else would test the build
    # machine's full node_modules and pass while the bundle was broken.
    Set-Content -LiteralPath $verifier -Encoding UTF8 -Value @'
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.VITEST = '1';                 // suppress main(); do not open sockets
process.env.BCONNECT_RELEASE = '26R1';

const root = process.cwd();
const failures = [];

// 1. Every declared production dependency is PRESENT in the bundle's own tree.
//
// Asked of the filesystem rather than of require.resolve(), which was the first
// attempt and was wrong: @modelcontextprotocol/sdk is "type": "module", so a CJS
// resolve of it fails on a tree where it is installed and working. The question
// here is "did the prune keep this package", and the honest way to ask it is to
// walk up the node_modules chain the way Node itself would, without involving
// exports maps, conditions or module systems at all.
function installed(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    if (existsSync(join(dir, 'node_modules', name, 'package.json'))) return true;
    const up = dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}
// Every directory holding a package.json, NOT a name pattern.
//
// The first version filtered on /^bconnect-.*-mcp$/ and therefore skipped
// `bconnect-mcp-gateway`, whose name ends in -gateway -- so its 16 declared
// dependencies, express among them, went unchecked. That is the same glob trap
// this repository has been bitten by before: ci.yml's coverage job carries a
// comment about `bconnect-*-mcp` matching the 13 servers and nothing else, and
// hiding the gateway and mcp-core for the life of the file. Asking the
// filesystem which directories are packages cannot be fooled by a rename.
const workspaces = ['.',
  ...readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(root, e.name, 'package.json')))
      .map((e) => e.name),
  ...(existsSync(join(root, 'packages'))
      ? readdirSync(join(root, 'packages'), { withFileTypes: true })
          .filter((e) => e.isDirectory() && existsSync(join(root, 'packages', e.name, 'package.json')))
          .map((e) => join('packages', e.name))
      : [])];
for (const w of workspaces) {
  const pkg = join(root, w, 'package.json');
  if (!existsSync(pkg)) continue;
  const deps = Object.keys(JSON.parse(readFileSync(pkg, 'utf8')).dependencies ?? {});
  for (const d of deps) {
    if (!installed(join(root, w), d)) {
      failures.push(`${w}: production dependency '${d}' is not in the bundle`);
    }
  }
}

// 2. Every server actually STARTS and answers tools/list from this tree.
let started = 0;
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
for (const dir of readdirSync(root).filter((d) => /^bconnect-.*-mcp$/.test(d) && d !== 'bconnect-mcp-gateway')) {
  const entry = join(root, dir, 'build', 'index.js');
  if (!existsSync(entry)) { failures.push(`${dir}: no build/index.js`); continue; }
  try {
    const mod = await import(pathToFileURL(entry).href);
    const { server } = mod.createServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'production-verify', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([server.connect(st), client.connect(ct)]);
    const { tools } = await client.listTools();
    if (!tools.length) { failures.push(`${dir}: started but advertised no tools`); }
    await client.close();
    started++;
  } catch (err) {
    failures.push(`${dir}: ${String(err && err.message || err).slice(0, 200)}`);
  }
}

if (started === 0) { failures.push('no server started at all -- the verification proved nothing'); }

// 3. The GATEWAY, which the loop above deliberately skips because it is not an
//    MCP server and starting it would open a socket. It still has to load: it is
//    the only route for n8n, Copilot Studio and Open WebUI, and the whole
//    "shared service" deployment shape. Its entry point is build/gateway.js, NOT
//    build/index.js -- checking for the wrong filename is how this was first
//    reported missing when it was present.
const gwDir = join(root, 'bconnect-mcp-gateway');
if (existsSync(gwDir)) {
  if (!existsSync(join(gwDir, 'build', 'gateway.js'))) {
    failures.push('gateway: build/gateway.js is missing');
  }
  // app.js holds the composition and pulls in express plus every server, so it
  // is the module that fails if the prune took something the gateway needs.
  for (const m of ['app.js', 'server-pool.js']) {
    const f = join(gwDir, 'build', m);
    if (!existsSync(f)) { failures.push(`gateway: build/${m} is missing`); continue; }
    try { await import(pathToFileURL(f).href); }
    catch (err) { failures.push(`gateway ${m}: ${String(err && err.message || err).slice(0, 200)}`); }
  }
}

console.log(`servers started from the pruned bundle: ${started}; gateway modules loaded`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
'@
    $vr = Invoke-Node @($verifier) $dstSuite
    Remove-Item -LiteralPath $verifier -Force -ErrorAction SilentlyContinue
    if ($vr.Code -ne 0) {
        if ($vr.Out) { Write-Host $vr.Out }
        Write-Host $vr.Err -ForegroundColor Red
        Die 'the production-only bundle could not run its own servers. It has NOT been shipped.'
    }
    Ok ("production set verified by running it -- " + ($vr.Out.Trim() -split "`n" | Select-Object -Last 1))
}

# 'state' is excluded for the same reason as the secrets directory. install\state\
# installation.json is not a credential file, but it holds this machine's bConnect
# base URL, the v1.1 service-account UPN, absolute paths and a host list -- an
# organisation's estate details travelling to whoever receives the bundle. It is
# also actively wrong on the target: Install-BConnectMcp.ps1 defaults -Hosts and
# -ProjectDir from the record and bconnect.ps1 reads its paths, so a fresh offline
# install would adopt and report a configuration belonging to a machine it has never
# met, and check drift against hashes that mean nothing there.
robocopy $InstallerDir $dstInst /E /XD out state .git /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { Die "robocopy failed copying the installer (exit $LASTEXITCODE)" }
Ok 'installer copied (without install\state -- see the manifest)'

# The runtime travels because it is inside install\ and nothing excludes it -- /XD
# names out, state and .git only. That is a property of a command line one edit
# could change silently, so it is asserted rather than assumed: a bundle that
# reports a runtime in its manifest and does not contain one is the failure this
# whole section exists to remove.
$dstMedia = Get-NodeMediaDirectory -InstallerDir $dstInst
if ($NodeMedia) {
    $arrived = Join-Path $dstMedia $NodeMedia.File
    if (-not (Test-Path -LiteralPath $arrived -PathType Leaf)) {
        Die ("the Node runtime $($NodeMedia.File) did not reach $dstMedia. " +
             'Check the robocopy exclusions above.')
    }
    $arrivedHash = (Get-FileHash -LiteralPath $arrived -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($arrivedHash -ne $NodeMedia.Sha256) {
        Die ("the Node runtime changed in transit: staged $($NodeMedia.Sha256), copied $arrivedHash.")
    }
    Ok ('Node runtime copied into the bundle and re-hashed identical')
}

# Belt and braces: neither the secrets directory nor install\state is a copy source
# above, and this asserts it after the fact rather than trusting the exclusions.
$leaked = @(Get-ChildItem -Path $Destination -Recurse -File -Include 'bconnect.env', 'bconnect.env.dpapi', 'installation.json' -ErrorAction SilentlyContinue)
if ($leaked.Count) {
    foreach ($f in $leaked) { Remove-Item -LiteralPath $f.FullName -Force }
    Warn "removed $($leaked.Count) file(s) carrying this machine's credentials or installation record -- investigate why they were there"
} else {
    Ok 'no credentials file and no installation record anywhere in the bundle (checked, not assumed)'
}

# --- 6: manifest --------------------------------------------------------------
# The manifest is only worth writing if the target can act on it, so it records the
# three things a target can check without a network: what each artefact HASHES to,
# what Node this tree was installed under, and whether the gateway actually built.
# Install-BConnectMcp.ps1 reads this file when it finds one beside itself.
#
# Hashes cover the entry points and the installer, not node_modules -- hashing a
# hundred thousand small files would take longer than the copy. node_modules is
# characterised by file count and total size instead, which is enough to catch the
# failure that actually happens: a copy that stopped halfway.
$servers = @(Get-ChildItem -Path $dstSuite -Directory -Filter 'bconnect-*-mcp' | ForEach-Object {
    [ordered]@{
        name  = $_.Name
        built = (Test-Path (Join-Path $_.FullName 'build\index.js')) -or (Test-Path (Join-Path $_.FullName 'build\gateway.js'))
    }
})

function Get-BundleHashes {
    param([string] $Root)
    $map = [ordered]@{}
    $paths = @()
    foreach ($rel in @('bConnect-MCP-main\package.json', 'bConnect-MCP-main\package-lock.json',
                       'bConnect-MCP-main\packages\mcp-core\build\index.js')) {
        $paths += $rel
    }
    foreach ($d in (Get-ChildItem -Path (Join-Path $Root 'bConnect-MCP-main') -Directory -Filter 'bconnect-*-mcp' -ErrorAction SilentlyContinue)) {
        foreach ($leaf in @('build\index.js', 'build\gateway.js')) {
            $paths += ('bConnect-MCP-main\' + $d.Name + '\' + $leaf)
        }
    }
    foreach ($f in (Get-ChildItem -Path (Join-Path $Root 'install') -Recurse -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.Extension -in @('.ps1', '.psm1', '.mjs', '.json') })) {
        $paths += $f.FullName.Substring($Root.TrimEnd('\').Length + 1)
    }
    foreach ($rel in ($paths | Select-Object -Unique)) {
        $full = Join-Path $Root $rel
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
        $map[$rel] = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
    }
    return $map
}

Say 'hashing the bundle (entry points and installer; node_modules is measured, not hashed)...'
$hashes = Get-BundleHashes -Root $Destination
$nmDir  = Join-Path $dstSuite 'node_modules'
$nmStat = [ordered]@{ present = (Test-Path $nmDir); fileCount = 0; bytes = 0 }
if ($nmStat.present) {
    $nm = Get-ChildItem -Path $nmDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
    $nmStat.fileCount = [int]$nm.Count
    $nmStat.bytes     = [long]$nm.Sum
}
Ok ("hashed $($hashes.Count) file(s); node_modules $($nmStat.fileCount) file(s)")

# Whether a runtime is in this bundle, stated rather than implied. The target reads
# `included` to know which of the two routes is open to it before it starts, and
# reads `sha256` to check that 30 MB of vendor binary survived the transfer -- which
# is the failure that actually happens to a file crossing removable media.
# Install-BConnectMcp.ps1 refuses to run an MSI that no longer matches this hash.
$nodeRuntime = [ordered]@{
    included   = [bool]$NodeMedia
    stagedIn   = 'install\packaging\redist'
    minVersion = [string]$NodeFloor.Min
    file       = $(if ($NodeMedia) { $NodeMedia.File }    else { $null })
    version    = $(if ($NodeMedia) { [string]$NodeMedia.Version } else { $null })
    sha256     = $(if ($NodeMedia) { $NodeMedia.Sha256 }  else { $null })
    bytes      = $(if ($NodeMedia) { $NodeMedia.SizeBytes } else { 0 })
    note       = $(if ($NodeMedia) {
                       'The installer uses this file when the target has no adequate Node. Nothing is installed when it has one.'
                   } else {
                       'NO RUNTIME IN THIS BUNDLE. The target must already have Node, or the install stops at Step 1 with no way to proceed offline.'
                   })
}

$manifest = [ordered]@{
    manifestVersion  = 3
    created          = (Get-Date).ToString('o')
    nodeVersion      = $NodeVer
    nodeRuntime      = $nodeRuntime
    suiteVersion     = (Get-Content (Join-Path $dstSuite 'package.json') -Raw | ConvertFrom-Json).version
    # Which dependency set this bundle carries. The target cannot tell by looking:
    # both trees install and both start the servers, and the difference only shows
    # if something tries to BUILD or TEST there, which is exactly when a person is
    # on an air-gapped machine wondering why. So it is stated.
    dependencies     = $(if ($productionOnly) {
                             [ordered]@{
                                 set  = 'production-only'
                                 note = 'npm ci --omit=dev, verified by starting every server from this tree. ' +
                                        'Build and test tooling is NOT present: this bundle installs and runs, ' +
                                        'it does not compile. Rebuild from source for a development tree.'
                             }
                         } else {
                             [ordered]@{
                                 set  = 'complete'
                                 note = 'Every dependency, including build and test tooling.'
                             }
                         })
    nodeModules      = $nmStat
    gatewayBuilt     = (Test-Path (Join-Path $dstSuite 'bconnect-mcp-gateway\build\gateway.js'))
    buildFailures    = @($BuildFailures)
    packages         = $servers
    hashAlgorithm    = 'SHA256'
    files            = $hashes
    credentials      = 'NOT INCLUDED -- collected on the target machine by the installer'
    installationRecord = 'NOT INCLUDED -- install\state belongs to the machine that built this'
    targetProcedure  = @(
        $(if ($NodeMedia) {
            "The Node $($NodeMedia.Version) runtime is IN this bundle at install\packaging\redist\$($NodeMedia.File). The installer uses it when the target has no adequate Node, and installs nothing when it has one."
          } else {
            'THIS BUNDLE CARRIES NO NODE RUNTIME. The target must already have Node ' +
            [string]$NodeFloor.Min + ' or newer, or the install stops at Step 1. To fix that, ' +
            'rebuild with -StageNodeRuntime, or place the x64 MSI in install\packaging\redist\ inside this bundle.'
          }),
        'Copy this bundle to the target, keeping bConnect-MCP-main and install side by side.',
        'cd <target>\install',
        '.\Install-BConnectMcp.ps1 -SkipBuild',
        'The installer verifies this manifest first -- hashes, Node version, gateway build --',
        'then collects credentials, hardens the secrets directory, writes the host',
        'configurations you choose and verifies them against the live bMS.',
        'It needs NO internet: the only step that did is already done in this bundle.'
    )
}
$manifestPath = Join-Path $Destination 'offline-bundle.json'
($manifest | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Ok "manifest written: $manifestPath"

# The launcher goes at the ROOT, because the root is what an administrator opens
# after extracting. It clears three conditions that stop the installer before it
# can report anything -- MAX_PATH headroom, the Mark of the Web a downloaded
# package carries onto every file it extracts, and the absence of a graphical
# shell on Server Core. It is a copy rather than a generated file so that what
# ships is the file under source control, reviewed and testable in place.
$launcherSrc = Join-Path $InstallerDir 'packaging\START-HERE.cmd'
if (Test-Path -LiteralPath $launcherSrc) {
    Copy-Item -LiteralPath $launcherSrc -Destination (Join-Path $Destination 'START-HERE.cmd') -Force
    Ok 'START-HERE.cmd placed at the bundle root'
} else {
    Warn "packaging\START-HERE.cmd not found -- the bundle has no launcher, so the operator must run install\Install-BConnectMcp.ps1 by hand"
}

# "What you will need", beside the launcher, because the root is what an
# administrator opens. There is ONE copy of this document -- install\README.md,
# under source control -- and it is copied here rather than written here: the
# installer's own "What you will need" link opens the same file from install\, so
# the page an operator reads before running and the page the window links to
# cannot say different things.
$readmeSrc = Join-Path $InstallerDir 'README.md'
if (Test-Path -LiteralPath $readmeSrc) {
    Copy-Item -LiteralPath $readmeSrc -Destination (Join-Path $Destination 'README.md') -Force
    Ok 'README.md placed at the bundle root'
} else {
    Warn 'install\README.md not found -- the bundle root has no "what you will need" page'
}

$sizeGb = [math]::Round((Get-ChildItem -Path $Destination -Recurse -File -ErrorAction SilentlyContinue |
                         Measure-Object -Property Length -Sum).Sum / 1GB, 2)
Ok "bundle size: $sizeGb GB"

if ($Zip) {
    $zipPath = $Destination.TrimEnd('\') + '.zip'
    Say "compressing to $zipPath (slow -- node_modules is many small files)..."
    if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($Destination, $zipPath)
    Ok "zip written: $zipPath"
}

Write-Host ''
Write-Host '  On the air-gapped machine' -ForegroundColor White
Write-Host '  -------------------------' -ForegroundColor DarkGray
foreach ($l in $manifest.targetProcedure) { Write-Host ('    ' + $l) }
Write-Host ''
Write-Host '  The Node.js runtime' -ForegroundColor White
Write-Host '  -------------------' -ForegroundColor DarkGray
if ($NodeMedia) {
    Write-Host ("    INCLUDED: install\packaging\redist\$($NodeMedia.File)  (Node $($NodeMedia.Version))") -ForegroundColor Green
    Write-Host ("    sha256    $($NodeMedia.Sha256)")
    Write-Host  '    The installer on the target uses it only when that machine has no adequate'
    Write-Host  '    Node. A machine that already has one keeps it untouched.'
} else {
    Write-Host  '    NOT INCLUDED. This bundle carries no Node runtime.' -ForegroundColor Yellow
    Write-Host ("    The target must already have Node $($NodeFloor.Min) or newer, or the install stops")
    Write-Host  '    at Step 1 and there is no way to obtain a runtime on an air-gapped machine.'
    Write-Host  '    Rebuild with -StageNodeRuntime on this connected machine, or place the x64'
    Write-Host ("    MSI in $MediaDir and rebuild.")
}
Write-Host ''
Write-Host '  Verify the offline path there with:' -ForegroundColor White
Write-Host '    .\lib\Test-OfflineInstall.ps1'
Write-Host '  It denies the npm registry and shows you which step would have needed it.'
Write-Host ''
if ($RequireNodeRuntime -and -not $NodeMedia) {
    Write-Host  '  [FAIL] -RequireNodeRuntime was passed and this bundle carries no Node runtime.' -ForegroundColor Red
    Write-Host  '         The bundle and its manifest have been written and record the absence, so'
    Write-Host  '         nothing about it is hidden, but it is not a release build.'
    Write-Host ('         Rebuild with -StageNodeRuntime, or stage the MSI in ' + $MediaDir + '.')
    Write-Host ''
    exit 1
}
if ($BuildFailures.Count) {
    Write-Host ('  [FAIL] these did not compile and are in the bundle unbuilt: ' +
                ($BuildFailures -join ', ')) -ForegroundColor Red
    Write-Host '         The bundle and its manifest have been written so you can see what is in'
    Write-Host '         them, but do not carry this to an air-gapped machine: the installer there'
    Write-Host '         will refuse it, and there is no way to build it on arrival.'
    Write-Host ''
    exit 1
}
exit 0
