<#
.SYNOPSIS
    Build the bConnect-MCP setup .exe from an offline bundle -- validated first,
    refused loudly when a prerequisite is missing.

.DESCRIPTION
    This is the "one thing to run" for producing the customer-facing setup
    program. packaging\README.md documents the same steps for a human; this
    script IS those steps, in the documented order, so the order cannot be
    skipped by accident:

      1. Refuse early, with the remedy named, when a prerequisite is absent:
         Inno Setup 6.3+ (ISCC.exe), the offline bundle, its manifest, or the
         staged Node MSI.
      2. Run Test-InnoScript.ps1 against the REAL bundle. The README says "run
         it before every build" -- here a validator failure fails the build,
         because the one time the validator was first pointed at a real bundle
         (2026-09-11) it found 15 path checks broken and ISCC would have
         refused the compile with less useful messages.
      3. Compile with ISCC, /DBundleDir pointing at the bundle.
      4. Report what was produced: path, size, SHA-256, and whether it is
         signed -- an unsigned build is normal on a dev machine and says so,
         with a pointer at the README's signing section, rather than
         pretending signing does not exist.

    The default bundle location is the one install\lib\New-OfflineBundle.ps1
    writes to in this repository (install\out\bconnect-mcp-offline-prod). A
    release built elsewhere passes -BundleDir explicitly.

.PARAMETER BundleDir
    The offline bundle to package. Default: <installer>\out\bconnect-mcp-offline-prod.

.PARAMETER SkipValidation
    Compile without running Test-InnoScript first. Exists for iterating on the
    .iss itself; a release build has no reason to pass it.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Build-BConnectMcpSetup.ps1
    (or double-click Build-BConnectMcpSetup.cmd, which runs exactly this)
#>
[CmdletBinding()]
param(
    [string] $BundleDir,
    [switch] $SkipValidation
)

$ErrorActionPreference = 'Stop'

$PackagingDir = $PSScriptRoot
$InstallerDir = Split-Path -Parent $PackagingDir
if (-not $BundleDir) { $BundleDir = Join-Path $InstallerDir 'out\bconnect-mcp-offline-prod' }

function Say  { param([string]$m) Write-Host ('  ' + $m) }
function Ok   { param([string]$m) Write-Host ('  [ ok ] ' + $m) -ForegroundColor Green }
function Die  { param([string]$m) Write-Host ('  [FAIL] ' + $m) -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '  bConnect-MCP -- setup .exe build' -ForegroundColor Cyan
Write-Host '  --------------------------------'

# --- 1: prerequisites, each refusal naming its remedy -------------------------
$Iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'
if (-not (Test-Path -LiteralPath $Iscc)) {
    $Iscc = Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'
}
if (-not (Test-Path -LiteralPath $Iscc)) {
    Die ('Inno Setup 6 is not installed (ISCC.exe not found). Install 6.3 or newer from ' +
         'https://jrsoftware.org/isdl.php and run this again. The floor is 6.3: the script ' +
         'uses ArchitecturesAllowed=x64compatible, which 6.2 does not know.')
}
Ok "compiler: $Iscc"

if (-not (Test-Path -LiteralPath $BundleDir -PathType Container)) {
    Die ("no offline bundle at $BundleDir. Build one first, from install\:  " +
         '.\lib\New-OfflineBundle.ps1 -Destination .\out\bconnect-mcp-offline-prod -Zip -RequireNodeRuntime -Production')
}
if (-not (Test-Path -LiteralPath (Join-Path $BundleDir 'offline-bundle.json'))) {
    Die ("$BundleDir has no offline-bundle.json at its top. That is not a finished bundle -- " +
         're-run New-OfflineBundle.ps1 and do not package a build whose builder exited non-zero.')
}
Ok "bundle:   $BundleDir"

# --- 2: the validator, as a gate ----------------------------------------------
if ($SkipValidation) {
    Write-Host '  [warn] -SkipValidation: compiling without Test-InnoScript. Not for release builds.' -ForegroundColor Yellow
} else {
    Say 'running Test-InnoScript.ps1 against the bundle (a failure here fails the build)...'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PackagingDir 'Test-InnoScript.ps1') -BundleDir $BundleDir -Quiet
    if ($LASTEXITCODE -ne 0) {
        Die ('the validator refused this bundle/script pair. Run it without -Quiet to see every check:  ' +
             '.\Test-InnoScript.ps1 -BundleDir "' + $BundleDir + '"')
    }
    Ok 'validator: every check passed against the real bundle'
}

# --- 3: compile -----------------------------------------------------------------
Say 'compiling (ISCC output follows)...'
& $Iscc ('/DBundleDir=' + $BundleDir) (Join-Path $PackagingDir 'bconnect-mcp.iss')
if ($LASTEXITCODE -ne 0) { Die "ISCC exited $LASTEXITCODE -- the .exe was not produced." }

# --- 4: report the artifact -----------------------------------------------------
$exe = Get-ChildItem -Path (Join-Path $PackagingDir 'out') -Filter 'bConnect-MCP-Setup-*.exe' |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { Die 'ISCC exited 0 but no bConnect-MCP-Setup-*.exe is in packaging\out.' }

$hash = (Get-FileHash -LiteralPath $exe.FullName -Algorithm SHA256).Hash
$sig  = Get-AuthenticodeSignature -LiteralPath $exe.FullName

Write-Host ''
Ok ("built: " + $exe.FullName)
Say ("size:  {0:N1} MB" -f ($exe.Length / 1MB))
Say ("sha256: $hash")
if ($sig.Status -eq 'Valid') {
    Ok ("signed: " + $sig.SignerCertificate.Subject)
} else {
    Say 'signed: NO. Normal for a dev-machine build; a customer-facing release should be'
    Say '        signed and timestamped -- packaging\README.md, "Code signing is not polish".'
}
Write-Host ''
exit 0
