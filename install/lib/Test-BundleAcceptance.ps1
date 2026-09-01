<#
    Acceptance checks for a freshly built offline bundle.

    Run against the OUTPUT, not the source. Everything here is a property of the
    artifact a customer receives, and each check exists because something in this
    list has actually been wrong at least once:

      * the launcher missing from the root, so there is nothing to double-click
      * a stale wizard shipped beside a current engine
      * lib\Address.ps1 absent, which stops the wizard from starting at all
      * an estate name or a credential travelling to whoever receives the bundle
      * the Node MSI missing, which makes an offline install impossible
      * the manifest not matching the files it ships with, which the installer
        itself refuses to run against
#>
[CmdletBinding()]
param([Parameter(Mandatory)] [string] $Bundle)

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check { param([string]$n, [bool]$ok, [string]$d = '')
    if ($ok) { $script:pass++; Write-Host "  PASS  $n" -ForegroundColor Green }
    else     { $script:fail++; Write-Host "  FAIL  $n" -ForegroundColor Red }
    if ($d)  { Write-Host "        $d" -ForegroundColor DarkGray }
}

Write-Host ''
Write-Host "Bundle acceptance -- $Bundle" -ForegroundColor Cyan
Write-Host ''

# --- what an administrator double-clicks -------------------------------------
Write-Host '-- the root --' -ForegroundColor Cyan
foreach ($f in 'START-HERE.cmd', 'README.md', 'offline-bundle.json') {
    Check "$f is at the bundle root" (Test-Path -LiteralPath (Join-Path $Bundle $f))
}
foreach ($d in 'install', 'bConnect-MCP-main') {
    Check "$d\ is at the bundle root" (Test-Path -LiteralPath (Join-Path $Bundle $d))
}

# --- the files today's defects were in ---------------------------------------
Write-Host '-- the current revision, not a stale one --' -ForegroundColor Cyan
$ui  = Join-Path $Bundle 'install\Install-BConnectMcp-UI.ps1'
$eng = Join-Path $Bundle 'install\Install-BConnectMcp.ps1'
$mg  = Join-Path $Bundle 'install\Manage-BConnectMcp.ps1'
Check 'lib\Address.ps1 ships -- without it the wizard does not start' `
    (Test-Path -LiteralPath (Join-Path $Bundle 'install\lib\Address.ps1'))
Check 'the wizard declares -SkipBuild, which START-HERE.cmd hands it' `
    ((Get-Content $ui -Raw) -match '(?m)^\s*\[switch\]\s*\$SkipBuild,')
Check 'the wizard asks for the server, not a whole URL' `
    ((Get-Content $ui -Raw) -match 'txtServerFqdn')
Check 'the wizard reports the run''s own reason (Get-TestVerdict)' `
    ((Get-Content $ui -Raw) -match 'function Get-TestVerdict')
Check 'the engine defers Node on a dry run instead of aborting' `
    ((Get-Content $eng -Raw) -match 'Dry run stopped early')
Check 'and no longer carries the abort that made Test useless' `
    (-not ((Get-Content $eng -Raw) -match 'dry run cannot continue without a Node runtime'))
Check 'the engine names the schemes a 401 offers' `
    ((Get-Content $eng -Raw) -match 'The server offers:')
Check 'the configuration window asks for the server too' `
    ((Get-Content $mg -Raw) -match 'txtServerFqdn')
Check 'both windows load the shared address file rather than composing their own' `
    (((Get-Content $ui -Raw) -match "Address\.ps1") -and ((Get-Content $mg -Raw) -match "Address\.ps1"))

# --- nothing of this estate travels ------------------------------------------
Write-Host '-- nothing of this estate travels --' -ForegroundColor Cyan
$estate = 'bms-srv1|labcorp|WIN1[01]CLIENT|172\.16\.|bMD Certificate'
$hits = @(Get-ChildItem -LiteralPath $Bundle -Recurse -File -Include *.ps1,*.psm1,*.mjs,*.js,*.json,*.md,*.cmd,*.txt `
            -ErrorAction SilentlyContinue |
          Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
          Select-String -Pattern $estate -List -ErrorAction SilentlyContinue)
# The guards that CHECK FOR those strings must contain them; nothing else may.
# Both of these assert that no estate name reached a shipped file, so the pattern
# is their subject matter. Verified by reading them, not assumed from the name.
$allowed = @('Test-WizardPrep.ps1', 'Test-NodeProvisioning.ps1')
$bad = @($hits | Where-Object { $allowed -notcontains (Split-Path -Leaf $_.Path) })
Check 'no estate name appears outside the guards that look for one' ($bad.Count -eq 0) `
    (($bad | ForEach-Object { $_.Path.Replace($Bundle,'') + ':' + $_.LineNumber }) -join '; ')

$creds = @(Get-ChildItem -LiteralPath $Bundle -Recurse -File -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -in 'bconnect.env','bconnect.env.dpapi','installation.json' })
Check 'no credentials file and no installation record travel' ($creds.Count -eq 0) `
    (($creds | ForEach-Object { $_.FullName.Replace($Bundle,'') }) -join '; ')
Check 'the secrets directory is not in the bundle' `
    (-not (Test-Path -LiteralPath (Join-Path $Bundle 'secrets')))
Check 'install\state is not in the bundle' `
    (-not (Test-Path -LiteralPath (Join-Path $Bundle 'install\state')))

# --- offline installability ---------------------------------------------------
Write-Host '-- it can install with no network --' -ForegroundColor Cyan
$m = Get-Content -LiteralPath (Join-Path $Bundle 'offline-bundle.json') -Raw | ConvertFrom-Json
Check 'the manifest says a Node runtime is included' ([bool]$m.nodeRuntime.included) `
    ("version " + $m.nodeRuntime.version)
$msi = Join-Path $Bundle ('install\packaging\redist\' + $m.nodeRuntime.file)
Check 'and the MSI it names is actually there' (Test-Path -LiteralPath $msi)
if (Test-Path -LiteralPath $msi) {
    Check 'and its SHA-256 matches the manifest' `
        ((Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash -eq $m.nodeRuntime.sha256)
}
Check 'node_modules ships, so npm ci is never needed on the target' ([bool]$m.nodeModules.present) `
    ("$($m.nodeModules.fileCount) files")
Check 'every package built on the build machine' (@($m.buildFailures).Count -eq 0) `
    (@($m.buildFailures) -join ', ')
Check 'and each package is marked built' `
    (@($m.packages | Where-Object { -not $_.built }).Count -eq 0)

# --- the integrity check the installer itself runs -----------------------------
Write-Host '-- the manifest matches the files beside it --' -ForegroundColor Cyan
$changed = @(); $missing = @()
foreach ($rel in @($m.files.PSObject.Properties.Name)) {
    $p = Join-Path $Bundle $rel
    if (-not (Test-Path -LiteralPath $p)) { $missing += $rel; continue }
    if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -ne $m.files.$rel) { $changed += $rel }
}
Check 'no file the manifest lists is missing' ($missing.Count -eq 0) ($missing -join '; ')
Check 'no file the manifest lists has changed' ($changed.Count -eq 0) ($changed -join '; ')

# --- MAX_PATH, which the launcher measures at 147 -----------------------------
Write-Host '-- path length --' -ForegroundColor Cyan
$deepest = (Get-ChildItem -LiteralPath $Bundle -Recurse -File -ErrorAction SilentlyContinue |
            ForEach-Object { $_.FullName.Length - $Bundle.Length - 1 } | Measure-Object -Maximum).Maximum
Check 'the deepest relative path is within what START-HERE.cmd assumes (147)' `
    ($deepest -le 147) "deepest = $deepest characters"

Write-Host ''
Write-Host "  $pass passed, $fail failed" -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
Write-Host ''
exit $(if ($fail) { 1 } else { 0 })
