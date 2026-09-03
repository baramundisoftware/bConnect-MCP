<#
.SYNOPSIS
    Tests for the Node.js runtime provisioning: lib\NodeProvisioning.psm1, the Step 1
    wiring in Install-BConnectMcp.ps1, and the runtime block lib\New-OfflineBundle.ps1
    writes into offline-bundle.json.

.DESCRIPTION
    WHAT THIS FILE IS ACTUALLY FOR. The installer aborted at Step 1 when Get-Command
    node failed, and the offline bundle's closing message told the operator to

        Install Node.js 22.15+ from an MSI carried in by hand (nodejs.org, x64 MSI).

    On an air-gapped bMS server -- which is the machine this product is installed on
    and the case the whole offline bundle exists for -- "carry it in by hand" is the
    step people get wrong, and the installer there has no way to recover from it. The
    bundle carried the suite, node_modules and the build output, and left behind the
    one prerequisite that could not be obtained on arrival.

    NOTHING HERE INSTALLS A RUNTIME, DOWNLOADS ONE BY DEFAULT, OR TOUCHES THIS
    MACHINE'S PATH. msiexec, the two fetches and the elevation check are all replaced
    with scriptblocks that record what they were asked to do; that is what the
    -ProbeNode / -InvokeMsi / -FetchText / -FetchFile / -Elevated parameters on
    Resolve-NodeRuntime are for. The suite this machine runs on is exactly as it was
    before this script ran, which is checked at the end.

    -Live opts in to two checks against nodejs.org: that SHASUMS256.txt is reachable
    and parses, and that the real published hash for the pinned MSI is the one the
    checksum reader finds. It is off by default because a test suite that needs the
    internet is a test suite that stops being run.

.EXAMPLE
    .\Test-NodeProvisioning.ps1
.EXAMPLE
    .\Test-NodeProvisioning.ps1 -Only refusal
.EXAMPLE
    .\Test-NodeProvisioning.ps1 -Live
#>
[CmdletBinding()]
param([string] $WorkDir, [string] $Only, [switch] $Live)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$LibDir       = $PSScriptRoot
$InstallerDir = Split-Path -Parent $LibDir
$ProjectRoot  = Split-Path -Parent $InstallerDir
$Installer    = Join-Path $InstallerDir 'Install-BConnectMcp.ps1'
$Wizard       = Join-Path $InstallerDir 'Install-BConnectMcp-UI.ps1'
$Bundler      = Join-Path $LibDir 'New-OfflineBundle.ps1'
$Module       = Join-Path $LibDir 'NodeProvisioning.psm1'
$SuiteRoot    = Join-Path $ProjectRoot 'bConnect-MCP-main'
$IssPath      = Join-Path $InstallerDir 'packaging\bconnect-mcp.iss'

Import-Module $Module -Force -DisableNameChecking

if (-not $WorkDir) {
    $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-node-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
}
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

$script:Pass = 0
$script:Fail = 0
# Argument order follows lib\Test-OfflineInstall.ps1 -- condition, then name -- because
# that is the suite this one is a sibling of.
function Check {
    param([bool] $Ok, [string] $Name, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}
function Section {
    param([string] $Name)
    Write-Host ''
    Write-Host ("  -- $Name " + ('-' * [Math]::Max(0, 58 - $Name.Length))) -ForegroundColor Cyan
}
function Want { param([string] $Tag) return (-not $Only) -or ($Only -eq $Tag) }

# -----------------------------------------------------------------------------
# Fixtures. None of them is a real MSI and none of them is ever executed: every
# path that would run one is replaced. A file of the right NAME is all the code
# under test reads, because the version comes from the vendor's filename and the
# integrity comes from the hash.
# -----------------------------------------------------------------------------
function New-FixtureMedia {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [string[]] $Files = @(),
        [string]   $Content = 'not a real MSI -- a stand-in for lib\Test-NodeProvisioning.ps1'
    )
    $dir = Join-Path $WorkDir ('media-' + $Name)
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    foreach ($f in $Files) {
        Set-Content -LiteralPath (Join-Path $dir $f) -Value ($Content + ' :: ' + $f) -Encoding ASCII -NoNewline
    }
    return $dir
}

function New-FixtureSuite {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [string] $Nvmrc,
        [hashtable] $Engines = @{}
    )
    $dir = Join-Path $WorkDir ('suite-' + $Name)
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    if ($Nvmrc) { Set-Content -LiteralPath (Join-Path $dir '.nvmrc') -Value $Nvmrc -Encoding ASCII }
    '{ "name": "fixture", "version": "0.0.0" }' |
        Set-Content -LiteralPath (Join-Path $dir 'package.json') -Encoding UTF8
    foreach ($pkg in $Engines.Keys) {
        $p = Join-Path $dir $pkg
        New-Item -ItemType Directory -Path $p -Force | Out-Null
        ('{ "name": "' + $pkg + '", "engines": { "node": "' + $Engines[$pkg] + '" } }') |
            Set-Content -LiteralPath (Join-Path $p 'package.json') -Encoding UTF8
    }
    return $dir
}

# A probe that reports whatever version the case needs, without asking this machine.
#
# It is STATEFUL, because the thing being modelled is: Resolve-NodeRuntime asks once
# before deciding, and again after msiexec has run, and the second answer is the one
# that decides whether the install actually took. -AfterInstall supplies that second
# answer. A probe that returned "absent" both times would model a machine where the
# MSI silently did nothing, which is a real case and is tested separately -- but as
# the default it made every successful install look like a failure.
function New-Probe {
    param([string] $Version, [string] $AfterInstall)
    $state = [ordered]@{ Calls = 0 }
    $v  = $(if ($Version)      { [Version]$Version }      else { $null })
    $va = $(if ($AfterInstall) { [Version]$AfterInstall } else { $null })
    return {
        $state.Calls++
        $use = $(if ($state.Calls -ge 2 -and $va) { $va } else { $v })
        if (-not $use) {
            return [ordered]@{ Present = $false; Path = $null; Version = $null; Raw = $null; OnPath = $false }
        }
        return [ordered]@{ Present = $true; Path = 'C:\bConnect-MCP\nodejs\node.exe'
                           Version = $use; Raw = $use.ToString(); OnPath = $true }
    }.GetNewClosure()
}

# Recorders. Each returns a hashtable the case reads afterwards; the point of every
# one is the assertion "this was NOT called".
function New-MsiRecorder {
    $rec = [ordered]@{ Calls = @(); ExitCode = 0 }
    $sb = { param($Arguments) $rec.Calls += ,@($Arguments); return $rec.ExitCode }.GetNewClosure()
    return @{ Record = $rec; Block = $sb }
}
function New-FetchRecorder {
    param([string] $ShaSumsText = '', [string] $Payload = 'downloaded bytes')
    $rec = [ordered]@{ TextUrls = @(); FileUrls = @() }
    $text = { param($Url) $rec.TextUrls += $Url; return $ShaSumsText }.GetNewClosure()
    $file = { param($Url, $OutFile) $rec.FileUrls += $Url
              Set-Content -LiteralPath $OutFile -Value $Payload -Encoding ASCII -NoNewline }.GetNewClosure()
    return @{ Record = $rec; Text = $text; File = $file }
}

function Get-Sha256OfString {
    param([string] $Text)
    $p = Join-Path $WorkDir ('sha-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.tmp')
    Set-Content -LiteralPath $p -Value $Text -Encoding ASCII -NoNewline
    $h = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
    Remove-Item -LiteralPath $p -Force
    return $h
}

# The state this machine's own runtime is in before anything runs, so that the last
# group can assert it is unchanged.
$BeforeNode = Get-InstalledNodeRuntime
$BeforePath = $env:PATH

Write-Host ''
Write-Host '  bConnect-MCP -- Node.js runtime provisioning' -ForegroundColor White
Write-Host '  -------------------------------------------' -ForegroundColor DarkGray
Write-Host ("  work dir  $WorkDir") -ForegroundColor DarkGray
Write-Host ("  this machine has Node " + $(if ($BeforeNode.Present) { $BeforeNode.Raw } else { '(none)' })) -ForegroundColor DarkGray
Write-Host '  Nothing below installs a runtime, and nothing below downloads one unless -Live.' -ForegroundColor DarkGray

try {

# =============================================================================
if (Want 'floor') {
    Section 'the version floor is READ from the suite, not written here'
    # Before: the floor was the literal 20 in `if ($nv.Major -lt 20)`, and 22.15 in
    # two more places, in three files. A suite that raised .nvmrc raised nothing.

    $real = Get-NodeVersionFloor -SuiteRoot $SuiteRoot
    Check ($real.FromSuite) 'the real suite answers the floor question itself' `
          ("Min=$($real.Min) from $($real.Sources.Count) source(s)")
    $nvmrcPath = Join-Path $SuiteRoot '.nvmrc'
    $nvmrcRaw  = $(if (Test-Path -LiteralPath $nvmrcPath) { (Get-Content -LiteralPath $nvmrcPath -Raw).Trim() } else { '' })
    Check ($nvmrcRaw -and ([Version]$nvmrcRaw) -le $real.Min) `
          'the floor is at or above what .nvmrc pins' "(.nvmrc $nvmrcRaw, floor $($real.Min))"
    Check (@($real.Sources | Where-Object { $_ -match '\.nvmrc' }).Count -eq 1) `
          '.nvmrc is named as a source'
    Check (@($real.Sources | Where-Object { $_ -match 'engines\.node' }).Count -gt 1) `
          'engines.node is read from more than one package' `
          ("$(@($real.Sources | Where-Object { $_ -match 'engines' }).Count) package(s)")

    # The falsifier for "it reads the file": a suite that says something else.
    $hi = New-FixtureSuite -Name 'high-nvmrc' -Nvmrc '24.5.1'
    $f  = Get-NodeVersionFloor -SuiteRoot $hi
    Check ($f.Min -eq [Version]'24.5.1') 'a suite pinning 24.5.1 in .nvmrc produces a floor of 24.5.1' "got $($f.Min)"

    # The highest declaration wins, because one package needing 23 makes 23 the
    # requirement whatever the other thirteen say.
    $mixed = New-FixtureSuite -Name 'mixed' -Nvmrc '20.0.0' -Engines @{
        'bconnect-a-mcp' = '>=20.0.0'; 'bconnect-b-mcp' = '>=23.0.0'; 'bconnect-c-mcp' = '>=18.0.0' }
    $f = Get-NodeVersionFloor -SuiteRoot $mixed
    Check ($f.Min -eq [Version]'23.0.0') 'the HIGHEST declaration wins over .nvmrc and the others' "got $($f.Min)"

    $none = Get-NodeVersionFloor -SuiteRoot (Join-Path $WorkDir 'no-such-suite')
    Check (-not $none.FromSuite) 'an unreadable suite falls back and says so'
    Check ($none.Min -eq [Version]$nvmrcRaw) `
          'and the fallback still equals what the real .nvmrc pins, so the two cannot drift' `
          "(fallback $($none.Min), .nvmrc $nvmrcRaw)"

    # The .iss carries its own copy of the same numbers, for a compiler that cannot
    # read a package.json. Drift between them is silent, so it is checked.
    if (Test-Path -LiteralPath $IssPath) {
        $iss = Get-Content -LiteralPath $IssPath -Raw
        $issMin  = $(if ($iss -match '#define\s+NodeMinVersion\s+"([\d.]+)"')       { [Version]$Matches[1] })
        $issPref = $(if ($iss -match '#define\s+NodePreferredVersion\s+"([\d.]+)"') { [Version]$Matches[1] })
        Check ($issMin -eq $real.Min) 'packaging\bconnect-mcp.iss NodeMinVersion matches the suite floor' `
              "iss=$issMin suite=$($real.Min)"
        Check ($issPref -eq $real.Preferred) 'and NodePreferredVersion matches the module' `
              "iss=$issPref module=$($real.Preferred)"
    }
}

# =============================================================================
if (Want 'present') {
    Section 'an adequate existing Node is detected and NOTHING is installed'
    # A bMS server is not this product's machine. Replacing a runtime other software
    # there depends on is a worse outcome than leaving a slightly old one alone.

    $media = New-FixtureMedia -Name 'present' -Files @('node-v22.15.0-x64.msi')
    $msi   = New-MsiRecorder
    $fetch = New-FetchRecorder

    $r = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                             -AllowDownload -Elevated $true `
                             -ProbeNode (New-Probe '22.18.0') -InvokeMsi $msi.Block `
                             -FetchText $fetch.Text -FetchFile $fetch.File

    Check ($r.Outcome -eq 'Present') 'an adequate runtime resolves as Present' "Outcome=$($r.Outcome)"
    Check ($r.Route -eq 'existing')  'and the route is the existing runtime' "Route=$($r.Route)"
    Check ($msi.Record.Calls.Count -eq 0) 'msiexec was NOT invoked, with adequate media sitting right there' `
          "$($msi.Record.Calls.Count) call(s)"
    Check ($fetch.Record.TextUrls.Count -eq 0 -and $fetch.Record.FileUrls.Count -eq 0) `
          'and no network call was made, with -AllowDownload passed'
    Check ($null -eq $r.Refusal) 'nothing is refused'

    # Exactly at the floor is adequate. Off-by-one here means reinstalling a runtime
    # on every machine that is exactly compliant.
    $r = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                             -Elevated $true -ProbeNode (New-Probe ([string](Get-NodeVersionFloor -SuiteRoot $SuiteRoot).Min)) `
                             -InvokeMsi $msi.Block
    Check ($r.Outcome -eq 'Present') 'a runtime exactly AT the floor is adequate' "Outcome=$($r.Outcome)"

    # And below it is not.
    $r = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                             -Elevated $true -ProbeNode (New-Probe '18.20.0' -AfterInstall '22.15.0') -InvokeMsi $msi.Block
    Check ($r.Outcome -ne 'Present') 'a runtime BELOW the floor is not accepted as adequate' "Outcome=$($r.Outcome)"
    Check ($r.Route -eq 'media') 'and the staged media is used instead' "Route=$($r.Route)"

    # Adequate but below the preferred version still installs nothing; it states the
    # certificate-store consequence instead.
    $r = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                             -Elevated $true -ProbeNode (New-Probe '20.11.0') -InvokeMsi $msi.Block
    Check ($r.Outcome -eq 'Present' -and $msi.Record.Calls.Count -eq 1) `
          'adequate-but-not-preferred installs nothing' "Outcome=$($r.Outcome)"
    Check (@($r.Detail | Where-Object { $_ -match 'certificate store' }).Count -eq 1) `
          'and states the Windows certificate store consequence' (($r.Detail | Select-Object -Last 1))
}

# =============================================================================
if (Want 'media') {
    Section 'staged media is found, and PREFERRED over the network'

    $media = New-FixtureMedia -Name 'good' -Files @('node-v22.15.0-x64.msi')
    $msi   = New-MsiRecorder
    $fetch = New-FetchRecorder

    $r = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                             -AllowDownload -Elevated $true -ProbeNode (New-Probe -AfterInstall '22.15.0') `
                             -InvokeMsi $msi.Block -FetchText $fetch.Text -FetchFile $fetch.File

    Check ($r.Outcome -eq 'Installed') 'a missing runtime plus staged media installs' "Outcome=$($r.Outcome)"
    Check ($r.Route -eq 'media') 'by the media route' "Route=$($r.Route)"
    Check ($fetch.Record.TextUrls.Count -eq 0 -and $fetch.Record.FileUrls.Count -eq 0) `
          'and NO network call was made, even though -AllowDownload was passed' `
          "text=$($fetch.Record.TextUrls.Count) file=$($fetch.Record.FileUrls.Count)"
    Check ($msi.Record.Calls.Count -eq 1) 'msiexec was invoked exactly once' "$($msi.Record.Calls.Count)"

    $cmdline = @($msi.Record.Calls[0]) -join ' '
    Check ($cmdline -match '/qn')        'silently (/qn)'        $cmdline
    Check ($cmdline -match '/norestart') 'without a restart'
    Check ($cmdline -match '/l\*v')      'with a verbose log'
    Check ($cmdline -notmatch '(?i)ADDLOCAL') `
          'and WITHOUT ADDLOCAL -- one Node MSI feature fetches a toolchain from the internet' $cmdline
    Check ($cmdline -match [regex]::Escape((Join-Path $media 'node-v22.15.0-x64.msi'))) `
          'against the staged file, not a downloaded one'

    # The default lookup, when no -MediaPath is given, is the folder the Inno script
    # already stages into. Two conventions for one file is two things to get wrong.
    $defaultDir = Get-NodeMediaDirectory -InstallerDir 'C:\bConnect-MCP\install'
    Check ($defaultDir -eq 'C:\bConnect-MCP\install\packaging\redist') `
          'the default media folder is install\packaging\redist' $defaultDir
    if (Test-Path -LiteralPath $IssPath) {
        $iss = Get-Content -LiteralPath $IssPath -Raw
        Check ($iss -match '#define\s+RedistDir\s+AddBackslash\(SourcePath\)\s*\+\s*"redist"') `
              'and packaging\bconnect-mcp.iss stages into that same folder'
    }

    # Arch and version filtering. An arm64 MSI dropped in by mistake is not a Node
    # runtime for this product, and a 2019-era MSI is not adequate.
    $mixed = New-FixtureMedia -Name 'mixed' -Files @(
        'node-v22.15.0-arm64.msi', 'node-v18.20.0-x64.msi', 'node-v22.15.0-x64.msi', 'notes.txt')
    $found = @(Get-StagedNodeMedia -MediaPath $mixed -MinVersion ([Version]'20.0.0'))
    Check (@($found | Where-Object { $_.File -match 'arm64' }).Count -eq 0) `
          'an arm64 MSI is not treated as a runtime for this product'
    Check ($found.Count -eq 2) 'both x64 MSIs are seen' (($found.File) -join ', ')
    Check ($found[0].File -eq 'node-v22.15.0-x64.msi') 'the adequate one sorts first' $found[0].File
    Check (@($found | Where-Object { $_.File -match '18\.20' } | Select-Object -First 1).Adequate -eq $false) `
          'and the one below the floor is marked inadequate'

    $onlyOld = New-FixtureMedia -Name 'old' -Files @('node-v18.20.0-x64.msi')
    $msi2 = New-MsiRecorder
    $r = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $onlyOld `
                             -Elevated $true -ProbeNode (New-Probe -AfterInstall '22.15.0') -InvokeMsi $msi2.Block
    Check ($r.Outcome -eq 'Refused' -and $msi2.Record.Calls.Count -eq 0) `
          'media below the floor is refused rather than installed' "Outcome=$($r.Outcome)"
    Check ((@($r.Refusal.Detail) -join ' ') -match 'below the floor') `
          'and the refusal says which file and why' ((@($r.Refusal.Detail) | Where-Object { $_ -match 'below the floor' }) -join ' / ')
}

# =============================================================================
if (Want 'manifest-hash') {
    Section 'staged media is checked against the hash the bundle recorded'
    # 30 MB of vendor binary crossing removable media is the thing that arrives
    # truncated. The manifest is the only reference the target has.

    $media   = New-FixtureMedia -Name 'hashed' -Files @('node-v22.15.0-x64.msi')
    $real    = @(Get-StagedNodeMedia -MediaPath $media -MinVersion ([Version]'20.0.0') -Sha256)[0].Sha256
    $msiGood = New-MsiRecorder
    $r = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                             -Elevated $true -ManifestSha256 $real -ProbeNode (New-Probe -AfterInstall '22.15.0') `
                             -InvokeMsi $msiGood.Block
    Check ($r.Outcome -eq 'Installed' -and $msiGood.Record.Calls.Count -eq 1) `
          'media matching the manifest hash is used' "Outcome=$($r.Outcome)"
    Check ((@($r.Detail) -join ' ') -match 'matches the hash recorded in the bundle manifest') `
          'and the match is stated'

    $msiBad = New-MsiRecorder
    $r = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                             -Elevated $true -ManifestSha256 ('0' * 64) -ProbeNode (New-Probe $null) `
                             -InvokeMsi $msiBad.Block
    Check ($r.Outcome -eq 'Refused') 'media that does NOT match the manifest hash is refused' "Outcome=$($r.Outcome)"
    Check ($msiBad.Record.Calls.Count -eq 0) 'and msiexec is never invoked against it' `
          "$($msiBad.Record.Calls.Count) call(s)"
    Check ((@($r.Detail) -join ' ') -match 'does not match the hash recorded') 'and the mismatch is stated'
}

# =============================================================================
if (Want 'checksum') {
    Section 'a downloaded runtime is verified, and a mismatch is not executed'

    $payload  = 'pretend node msi bytes'
    $realHash = Get-Sha256OfString $payload
    $file     = 'node-v22.15.0-x64.msi'

    # The reader, on its own, first.
    $good = Test-NodeMsiChecksum -Path (Join-Path (New-FixtureMedia -Name 'ck' -Files @($file) -Content $payload) $file) `
                                 -ShaSumsText ("$(Get-Sha256OfString ($payload + ' :: ' + $file))  $file") -FileName $file
    Check ($good.Ok) 'a file matching its published line verifies' $good.Reason

    $bad = Test-NodeMsiChecksum -Path (Join-Path (New-FixtureMedia -Name 'ck2' -Files @($file) -Content $payload) $file) `
                                -ShaSumsText (('a' * 64) + "  $file") -FileName $file
    Check (-not $bad.Ok) 'a file NOT matching its published line fails' $bad.Reason
    Check ($bad.Expected -eq ('a' * 64) -and $bad.Actual -and $bad.Actual -ne $bad.Expected) `
          'and both hashes are reported so the operator can see which is which'

    # "Not listed" is a failure, not an absence. A checksum file that does not
    # mention the artefact cannot vouch for it.
    $absent = Test-NodeMsiChecksum -Path (Join-Path (New-FixtureMedia -Name 'ck3' -Files @($file) -Content $payload) $file) `
                                   -ShaSumsText ((('b' * 64) + '  node-v22.15.0-arm64.msi')) -FileName $file
    Check (-not $absent.Ok) 'a checksum file with no line for this MSI fails rather than passing quietly' $absent.Reason

    # Now the fetch-and-verify path. The tampered case is the one that matters.
    $dest = Join-Path $WorkDir 'dl-tampered\node-v22.15.0-x64.msi'
    $f = New-FetchRecorder -ShaSumsText (('c' * 64) + "  $file") -Payload $payload
    $res = Save-VerifiedNodeMsi -Version '22.15.0' -Destination $dest -FetchText $f.Text -FetchFile $f.File
    Check (-not $res.Ok) 'a download whose hash does not match is refused' $res.Reason
    Check (-not (Test-Path -LiteralPath $dest)) `
          'and NO file is left at the destination -- there is nothing for a later run to execute' $dest
    Check (-not (Test-Path -LiteralPath ($dest + '.part'))) 'and no .part file is left behind either'
    Check ($f.Record.TextUrls.Count -eq 1 -and $f.Record.TextUrls[0] -match 'SHASUMS256\.txt$') `
          'the checksum file is fetched from nodejs.org' ($f.Record.TextUrls -join ', ')
    Check ($f.Record.TextUrls[0] -match '/dist/v22\.15\.0/') `
          'from the SAME version directory as the MSI, which is what makes it mean anything'

    # And the honest case, so that "it refuses everything" is not the explanation.
    $dest2 = Join-Path $WorkDir 'dl-good\node-v22.15.0-x64.msi'
    $f2 = New-FetchRecorder -ShaSumsText ($realHash + "  $file") -Payload $payload
    $res2 = Save-VerifiedNodeMsi -Version '22.15.0' -Destination $dest2 -FetchText $f2.Text -FetchFile $f2.File
    Check ($res2.Ok) 'CONTROL: a download whose hash DOES match is kept' $res2.Reason
    Check (Test-Path -LiteralPath $dest2) 'and the file is at the destination' $dest2

    # Through the orchestrator: a tampered download must not reach msiexec.
    $emptyMedia = New-FixtureMedia -Name 'empty-dl'
    $msi = New-MsiRecorder
    $f3  = New-FetchRecorder -ShaSumsText (('d' * 64) + "  $file") -Payload $payload
    $r = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $emptyMedia `
                             -AllowDownload -Elevated $true -ProbeNode (New-Probe $null) `
                             -InvokeMsi $msi.Block -FetchText $f3.Text -FetchFile $f3.File
    Check ($r.Outcome -eq 'Refused') 'a tampered download refuses the whole run' "Outcome=$($r.Outcome)"
    Check ($msi.Record.Calls.Count -eq 0) 'and msiexec is NEVER invoked' "$($msi.Record.Calls.Count) call(s)"
    Check (@(Get-ChildItem -LiteralPath $emptyMedia -File -Filter '*.msi' -ErrorAction SilentlyContinue).Count -eq 0) `
          'and nothing is left in the media folder for a later run to pick up'
    Check ((@($r.Detail) -join ' ') -match 'Nothing was executed') 'and the run says so'

    # A refused download still names both routes, because the operator now has to
    # choose one and the failing one is not a choice.
    $act = (@($r.Refusal.Action) -join ' ')
    Check ($act -match 'Route 1' -and $act -match 'Route 2' -and $act -match 'nodejs\.org') `
          'the refusal after a failed download still names both routes'
}

# =============================================================================
if (Want 'refusal') {
    Section 'no runtime, no media, no network: a factual refusal naming BOTH routes'
    # This is the air-gapped bMS server. The old message was "Install Node.js 22.15
    # or newer (x64 MSI) from https://nodejs.org and reopen this shell", which is
    # not an instruction that machine can follow.

    $empty = New-FixtureMedia -Name 'nothing-at-all'
    Remove-Item -LiteralPath $empty -Recurse -Force
    $msi   = New-MsiRecorder
    $fetch = New-FetchRecorder

    $r = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $empty `
                             -Elevated $true -ProbeNode (New-Probe $null) -InvokeMsi $msi.Block `
                             -FetchText $fetch.Text -FetchFile $fetch.File

    Check ($r.Outcome -eq 'Refused') 'the run is refused' "Outcome=$($r.Outcome)"
    Check ($null -ne $r.Refusal) 'and a refusal object is produced'
    Check ($fetch.Record.TextUrls.Count -eq 0 -and $fetch.Record.FileUrls.Count -eq 0) `
          'NO network call was made -- downloading is opt-in, and this run did not opt in'
    Check ($msi.Record.Calls.Count -eq 0) 'and nothing was installed'

    $detail = (@($r.Refusal.Detail) -join ' ')
    $action = (@($r.Refusal.Action) -join ' ')
    Check ($detail -match [regex]::Escape($empty)) 'the refusal names the folder it looked in' $empty
    Check ($detail -match 'does not exist') 'and says that folder does not exist'
    Check ($detail -match 'not permitted for this run, so no network call was made') `
          'and states that the network was not used'
    Check ($detail -match 'floor source') 'and cites where the version floor came from'

    Check ($action -match 'Route 1') 'route 1 is named'
    Check ($action -match 'Route 2') 'route 2 is named'
    Check ($action -match [regex]::Escape($empty)) `
          'route 1 names the exact folder to copy the MSI into -- the one that was searched' $empty
    Check ($action -match 'no internet access') 'and states that route 1 needs none'
    Check ($action -match 'node-v[\d.]+-x64\.msi') 'route 1 gives the exact file to fetch'
    Check ($action -match 'SHASUMS256\.txt') 'and the checksum file beside it'
    Check ($action -match '-AllowNodeDownload') 'route 2 names the switch that enables it'
    Check ($action -match 'New-OfflineBundle') 'and the bundle is named as the intended order'

    # With no -MediaPath override -- which is how the installer calls it -- that
    # folder is the convention packaging\bconnect-mcp.iss already stages into.
    $rDefault = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir 'C:\bConnect-MCP\install' `
                                    -LogPath (Join-Path $WorkDir 'unused.log') -Elevated $true `
                                    -ProbeNode (New-Probe) -InvokeMsi $msi.Block
    Check ($rDefault.Outcome -eq 'Refused') 'CONTROL: the default-path run also refuses here'
    Check ((@($rDefault.Refusal.Action) -join ' ') -match [regex]::Escape('install\packaging\redist')) `
          'and by default route 1 names install\packaging\redist' `
          (@($rDefault.Refusal.Action | Where-Object { $_ -match 'redist' }) -join ' / ')

    # -AllowNodeDownload has to be a real parameter on the script the refusal tells
    # the operator to re-run, or the instruction is a dead end.
    $installerSrc = Get-Content -LiteralPath $Installer -Raw
    Check ($installerSrc -match '\[switch\]\s*\$AllowNodeDownload') `
          'and Install-BConnectMcp.ps1 actually has that parameter'

    # Tone. State the condition, the consequence, the action.
    $allText = @($r.Refusal.Reason) + @($r.Refusal.Detail) + @($r.Refusal.Action)
    Check (@($allText | Where-Object { $_ -match '!' }).Count -eq 0) 'no exclamation mark'
    Check (@($allText | Where-Object { $_ -match "(?i)\b(we|our|ours|let's)\b" }).Count -eq 0) `
          'no first-person plural'
    Check (@($allText | Where-Object { $_ -match "(?i)\b(don't|doesn't|can't|won't|it's|you'll|you're|there's|isn't)\b" }).Count -eq 0) `
          'no contraction'
    Check (@($allText | Where-Object { $_ -match '(?i)C:\\mcpworkspace|\blabcorp\b|WIN11CLIENT' }).Count -eq 0) `
          'no development path and no estate value'

    # A runtime that is present but too old, with nothing to replace it with, is the
    # same dead end and gets the same two routes.
    $r2 = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $empty `
                              -Elevated $true -ProbeNode (New-Probe '16.20.0') -InvokeMsi $msi.Block
    Check ($r2.Outcome -eq 'Refused') 'a too-old runtime with no media is refused too'
    Check ((@($r2.Refusal.Detail) -join ' ') -match 'is below the floor') `
          'and the refusal names the version it found' ((@($r2.Refusal.Detail) | Select-Object -First 1))
    Check ((@($r2.Refusal.Action) -join ' ') -match 'Route 1' -and (@($r2.Refusal.Action) -join ' ') -match 'Route 2') `
          'with both routes again'
}

# =============================================================================
if (Want 'elevation') {
    Section 'elevation is stated as a condition, not discovered inside msiexec'
    # msiexec returns 1625 for "system policy forbids this installation" and 1603
    # for everything else. Neither is a sentence an administrator can act on.

    $media = New-FixtureMedia -Name 'elev' -Files @('node-v22.15.0-x64.msi')
    $msi   = New-MsiRecorder
    $r = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                             -Elevated $false -ProbeNode (New-Probe $null) -InvokeMsi $msi.Block

    Check ($r.Outcome -eq 'Refused') 'a non-elevated run with usable media is refused up front' "Outcome=$($r.Outcome)"
    Check ($msi.Record.Calls.Count -eq 0) 'and msiexec is not started at all' "$($msi.Record.Calls.Count) call(s)"
    Check ($r.Refusal.Reason -match 'not elevated') 'the reason names elevation' $r.Refusal.Reason
    Check ((@($r.Refusal.Detail) -join ' ') -match 'Nothing has been changed on this computer') `
          'and states that nothing was changed'
    Check ((@($r.Refusal.Action) -join ' ') -match '(?i)Run as administrator') 'the action is the fix'
    Check ((@($r.Refusal.Detail) -join ' ') -match [regex]::Escape('node-v22.15.0-x64.msi')) `
          'and the runtime it would have installed is named, so the operator knows it is staged'

    # CONTROL: the same case elevated does install.
    $msi2 = New-MsiRecorder
    $r2 = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                              -Elevated $true -ProbeNode (New-Probe -AfterInstall '22.15.0') -InvokeMsi $msi2.Block
    Check ($r2.Outcome -eq 'Installed' -and $msi2.Record.Calls.Count -eq 1) `
          'CONTROL: the identical run WITH elevation installs' "Outcome=$($r2.Outcome)"

    # msiexec failing is not "installed". 1625 and 1603 are the two an administrator
    # actually sees, and neither is a sentence.
    $msi3 = New-MsiRecorder
    $msi3.Record.ExitCode = 1625
    $r3 = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                              -Elevated $true -ProbeNode (New-Probe -AfterInstall '22.15.0') -InvokeMsi $msi3.Block
    Check ($r3.Outcome -eq 'Refused') 'msiexec exit 1625 is a refusal, not a success' "Outcome=$($r3.Outcome)"
    Check ((@($r3.Refusal.Detail) -join ' ') -match 'system policy') `
          'and 1625 is translated into what it means' ((@($r3.Refusal.Detail) | Where-Object { $_ -match '1625' }) -join '')
    Check ((@($r3.Refusal.Action) -join ' ') -match 'msiexec /i') `
          'with a command that shows the error in a window'

    # 3010 is "installed, restart pending". The runtime is usable now, and treating
    # it as a failure would abort a run that actually succeeded.
    $msi4 = New-MsiRecorder
    $msi4.Record.ExitCode = 3010
    $r4 = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                              -Elevated $true -ProbeNode (New-Probe -AfterInstall '22.15.0') -InvokeMsi $msi4.Block
    Check ($r4.Outcome -eq 'Installed') 'msiexec exit 3010 (restart pending) is a success' "Outcome=$($r4.Outcome)"

    # And the case the PATH repair exists for, when even the repair cannot find it:
    # msiexec succeeded and node is still not resolvable. That has one honest answer.
    $msi5 = New-MsiRecorder
    $r5 = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir -MediaPath $media `
                              -Elevated $true -ProbeNode (New-Probe) -InvokeMsi $msi5.Block
    Check ($r5.Outcome -eq 'Refused') `
          'a runtime that installs and is still not resolvable is not reported as success' "Outcome=$($r5.Outcome)"
    Check ((@($r5.Refusal.Action) -join ' ') -match '(?i)open a new one') `
          'and the action is the one that works: a new process' (@($r5.Refusal.Action) -join ' ')
}

# =============================================================================
if (Want 'path') {
    Section 'the PATH trap the MSI creates'
    # The MSI edits the machine PATH; this process inherited its environment before
    # that happened. packaging\Start-BConnectConfig.cmd documents the same trap for
    # the processes Setup launches.

    $cmdSrc = Get-Content -LiteralPath (Join-Path $InstallerDir 'packaging\Start-BConnectConfig.cmd') -Raw
    Check ($cmdSrc -match '(?i)MACHINE PATH') `
          'CONTROL: Start-BConnectConfig.cmd is where this trap is written down'

    # Repair-NodePathInProcess runs in a CHILD process with PATH emptied, because a
    # test that repaired this process's PATH would be testing itself.
    $probe = Join-Path $WorkDir 'path-probe.ps1'
    @'
$ErrorActionPreference = 'Stop'
Import-Module $args[0] -Force -DisableNameChecking
$env:PATH = 'C:\this-path-has-no-node'
$before = [bool](Get-Command node -ErrorAction SilentlyContinue)
$after  = Repair-NodePathInProcess
[pscustomobject]@{ Before = $before; After = [string]$after } | ConvertTo-Json -Compress
'@ | Set-Content -LiteralPath $probe -Encoding UTF8

    $out = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $probe $Module 2>&1 | Out-String
    $j = $null
    try { $j = ($out -split "`r?`n" | Where-Object { $_ -match '^\{' } | Select-Object -First 1) | ConvertFrom-Json } catch { }
    if ($j) {
        Check (-not $j.Before) 'CONTROL: with PATH emptied, node is not resolvable in that process' "$($j.Before)"
        if ($BeforeNode.Present) {
            Check ([bool]$j.After) 'Repair-NodePathInProcess makes it resolvable again, from the registry' $j.After
        } else {
            Check ($true) 'this machine has no Node, so the repair has nothing to find (not a failure here)'
        }
    } else {
        Check $false 'the PATH probe returned parseable output' ($out.Trim() -split "`r?`n" | Select-Object -First 2) -join ' / '
    }

    # And the installer wires the repair in rather than repeating it.
    $installerSrc = Get-Content -LiteralPath $Installer -Raw
    Check ($installerSrc -notmatch 'ProgramFiles.{0,20}nodejs') `
          'Install-BConnectMcp.ps1 does not hard-code the Node directory itself'
    Check ((Get-Content -LiteralPath $Module -Raw) -match 'Repair-NodePathInProcess') `
          'the repair lives in the module'
}

# =============================================================================
if (Want 'one-implementation') {
    Section 'one implementation, reached by all three front ends'
    # "A front end, not a second installer... there is exactly one implementation of
    # the work."

    foreach ($f in @(@{ N = 'Install-BConnectMcp.ps1'; P = $Installer },
                     @{ N = 'Install-BConnectMcp-UI.ps1 (the wizard)'; P = $Wizard },
                     @{ N = 'New-OfflineBundle.ps1'; P = $Bundler })) {
        $src = Get-Content -LiteralPath $f.P -Raw
        Check ($src -match "NodeProvisioning\.psm1") ("$($f.N) reaches the module")
    }

    # And no OTHER file implements any part of it. Stated as a count over the whole
    # of install\ rather than as four separate "this file does not" checks: the
    # question is not whether one front end behaves, it is whether a second
    # implementation exists anywhere. A new front end added next year is covered by
    # this without anyone remembering to add it to a list.
    #
    # The patterns are the three things the module actually DOES -- start msiexec,
    # build a nodejs.org distribution URL, and hash a downloaded MSI against a
    # published sum. Prose that mentions msiexec or SHASUMS256.txt is documentation
    # and is not an implementation; the earlier version of this check could not tell
    # the two apart and failed on a parameter comment.
    $scanned = @(Get-ChildItem -LiteralPath $InstallerDir -Recurse -File -ErrorAction SilentlyContinue |
                 Where-Object { $_.Extension -in @('.ps1', '.psm1') -and $_.Name -ne 'Test-NodeProvisioning.ps1' })
    Check ($scanned.Count -gt 10) 'CONTROL: there are scripts under install\ to scan' "$($scanned.Count) file(s)"

    # Each pattern must hit EXACTLY ONE file, and that file must be the module. Not
    # "at most one": a rule that matches nothing passes vacuously and would keep
    # passing after the code it describes was deleted.
    foreach ($rule in @(
        @{ What = 'starts msiexec';                   Pattern = "(?i)msiexec\.exe" },
        @{ What = 'builds a nodejs.org download URL'; Pattern = "(?i)nodejs\.org/dist" },
        @{ What = 'reads a published checksum file';  Pattern = "(?i)SHASUMS_NAME\s*=" })) {
        $hits = @($scanned | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match $rule.Pattern })
        Check ($hits.Count -eq 1 -and $hits[0].Name -eq 'NodeProvisioning.psm1') `
              ("exactly one file in install\ " + $rule.What + ", and it is the module") `
              (($hits.Name) -join ', ')
    }

    # The wizard reports the plan; it must not install from a window.
    $ui = Get-Content -LiteralPath $Wizard -Raw
    Check ($ui -match 'Resolve-NodeRuntime[^\r\n]*-PlanOnly') `
          'the wizard asks for the PLAN and installs nothing'
    Check ($ui -notmatch 'from https://nodejs\.org, close this window') `
          'and no longer tells an air-gapped server to visit nodejs.org and restart the window'
}

# =============================================================================
if (Want 'bundle') {
    Section 'the bundle states whether a runtime is included'
    # A bundle that silently lacks one is the original failure wearing a new coat.

    $fakeSuite = Join-Path $WorkDir 'bundle-suite'
    New-Item -ItemType Directory -Path $fakeSuite -Force | Out-Null
    '{ "name": "fake-suite", "version": "0.0.0-test" }' |
        Set-Content -LiteralPath (Join-Path $fakeSuite 'package.json') -Encoding UTF8
    '{ "lockfileVersion": 3 }' |
        Set-Content -LiteralPath (Join-Path $fakeSuite 'package-lock.json') -Encoding UTF8

    $realMedia = Get-NodeMediaDirectory -InstallerDir $InstallerDir
    $preExisting = @(Get-ChildItem -LiteralPath $realMedia -File -Filter '*.msi' -ErrorAction SilentlyContinue)

    function Invoke-Bundler {
        param([string] $Dest, [switch] $Require)
        $a = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $Bundler,
               '-Destination', $Dest, '-SuiteRoot', $fakeSuite, '-SkipBuild')
        if ($Require) { $a += '-RequireNodeRuntime' }
        $o = & powershell.exe @a 2>&1 | Out-String
        return @{ Out = $o; Code = $LASTEXITCODE }
    }

    # --- (a) no runtime staged --------------------------------------------------
    if ($preExisting.Count -eq 0) {
        $dest = Join-Path $WorkDir 'bundle-none'
        $b = Invoke-Bundler -Dest $dest
        Check ($b.Code -eq 0) 'a bundle with no runtime still builds' `
              (($b.Out -split "`r?`n" | Where-Object { $_ -match 'FAIL' } | Select-Object -First 1))
        $bm = Get-Content -LiteralPath (Join-Path $dest 'offline-bundle.json') -Raw | ConvertFrom-Json
        Check (@($bm.PSObject.Properties.Name) -contains 'nodeRuntime') 'the manifest has a nodeRuntime block'
        Check ($bm.nodeRuntime.included -eq $false) 'which states included = false' "$($bm.nodeRuntime.included)"
        Check ($bm.nodeRuntime.note -match 'NO RUNTIME IN THIS BUNDLE') 'and says so in words' $bm.nodeRuntime.note
        Check ((@($bm.targetProcedure) -join ' ') -match 'CARRIES NO NODE RUNTIME') `
              'the target procedure leads with the absence'
        Check ((@($bm.targetProcedure) -join ' ') -notmatch 'carried in by hand') `
              'and no longer says "carried in by hand", which was the whole defect'
        Check ($b.Out -match 'NOT INCLUDED') 'and the closing message on screen says NOT INCLUDED'
        Check ($b.Out -match '-StageNodeRuntime') 'and names the switch that fixes it'
        Check ($bm.manifestVersion -ge 3) 'the manifest version is raised' "$($bm.manifestVersion)"

        $bReq = Invoke-Bundler -Dest (Join-Path $WorkDir 'bundle-none-req') -Require
        Check ($bReq.Code -ne 0) '-RequireNodeRuntime makes a runtime-less bundle a FAILURE' "exit $($bReq.Code)"
        Check ($bReq.Out -match 'RequireNodeRuntime was passed') 'and says why'
    } else {
        Check $true "SKIPPED: $($realMedia) already holds an MSI, so the empty case is not staged here" `
              (($preExisting.Name) -join ', ')
    }

    # --- (b) a runtime staged ---------------------------------------------------
    # A stand-in file, not a real MSI. The bundler hashes it, copies it and records
    # it; it never runs it. Planted and removed, in the idiom Test-OfflineInstall.ps1
    # uses for the installation record.
    New-Item -ItemType Directory -Path $realMedia -Force | Out-Null
    # When a real runtime is already staged -- which is the state of a release
    # build -- assert against THAT rather than planting a second MSI beside it.
    # Two candidates in one folder is a state the bundler is not asked to resolve,
    # and hard-coding a version here would break on the next runtime bump, which
    # bconnect-mcp.iss describes as a one-line change plus a new file in redist\.
    if ($preExisting.Count -gt 0) {
        $planted  = $preExisting[0].FullName
        $wasThere = $true
    } else {
        $planted  = Join-Path $realMedia 'node-v22.15.0-x64.msi'
        $wasThere = $false
        Set-Content -LiteralPath $planted -Encoding ASCII -NoNewline `
                    -Value 'stand-in for the Node MSI -- lib\Test-NodeProvisioning.ps1, never executed'
    }
    $expectFile = Split-Path -Leaf $planted
    $expectVer  = if ($expectFile -match 'node-v([0-9]+\.[0-9]+\.[0-9]+)-x64\.msi') { $Matches[1] } else { '' }
    try {
        $expect = (Get-FileHash -LiteralPath $planted -Algorithm SHA256).Hash.ToLowerInvariant()
        $dest2  = Join-Path $WorkDir 'bundle-with'
        $b2 = Invoke-Bundler -Dest $dest2 -Require
        Check ($b2.Code -eq 0) '-RequireNodeRuntime passes when a runtime IS staged' "exit $($b2.Code)"

        $bm2 = Get-Content -LiteralPath (Join-Path $dest2 'offline-bundle.json') -Raw | ConvertFrom-Json
        Check ($bm2.nodeRuntime.included -eq $true) 'the manifest states included = true'
        Check ($bm2.nodeRuntime.file -eq $expectFile) 'and names the file' `
              "$($bm2.nodeRuntime.file) (expected $expectFile)"
        Check ($bm2.nodeRuntime.version -eq $expectVer) 'and its version' `
              "$($bm2.nodeRuntime.version) (expected $expectVer)"
        Check ($bm2.nodeRuntime.sha256 -eq $expect) 'and its SHA256' $bm2.nodeRuntime.sha256
        Check ($bm2.nodeRuntime.stagedIn -eq 'install\packaging\redist') 'and where it sits in the bundle'
        Check ((@($bm2.targetProcedure) -join ' ') -match 'is IN this bundle') `
              'the target procedure leads with the presence'
        Check ($b2.Out -match 'INCLUDED: install\\packaging\\redist') 'and the closing message says so'

        $arrived = Join-Path $dest2 (Join-Path 'install\packaging\redist' $expectFile)
        Check (Test-Path -LiteralPath $arrived) 'the MSI actually travels into the bundle' $arrived
        Check ((Get-FileHash -LiteralPath $arrived -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expect) `
              'byte-identical to what was staged'

        # And the target can act on it: the installer reads nodeRuntime.sha256 and
        # refuses an MSI that no longer matches.
        $installerSrc = Get-Content -LiteralPath $Installer -Raw
        Check ($installerSrc -match 'nodeRuntime' -and $installerSrc -match 'ManifestSha256') `
              'Install-BConnectMcp.ps1 reads that hash back and passes it to the check'

        # The bundle is usable end to end: resolve against the bundle's OWN install
        # directory, with its own manifest hash, exactly as the target would.
        $msi = New-MsiRecorder
        $r = Resolve-NodeRuntime -SuiteRoot $fakeSuite -InstallerDir (Join-Path $dest2 'install') `
                                 -Elevated $true -ManifestSha256 $bm2.nodeRuntime.sha256 `
                                 -ProbeNode (New-Probe -AfterInstall '22.15.0') -InvokeMsi $msi.Block
        Check ($r.Outcome -eq 'Installed' -and $r.Route -eq 'media') `
              'a target resolving against the delivered bundle finds and uses the runtime' `
              "Outcome=$($r.Outcome) Route=$($r.Route)"
        Check ($msi.Record.Calls.Count -eq 1 -and (@($msi.Record.Calls[0]) -join ' ') -match [regex]::Escape($arrived)) `
              'against the copy inside the bundle'
    } finally {
        if (-not $wasThere) { Remove-Item -LiteralPath $planted -Force -ErrorAction SilentlyContinue }
    }
    Check ((Test-Path -LiteralPath $planted) -eq $wasThere) `
          'the planted stand-in is cleaned up and the real redist folder is as it was'
}

# =============================================================================
if ((Want 'live') -and $Live) {
    Section 'LIVE: the real checksum file published by nodejs.org'
    $ver = [string](Get-NodeVersionFloor -SuiteRoot $SuiteRoot).Preferred
    $txt = $null
    try { $txt = (Invoke-WebRequest -Uri (Get-NodeShaSumsUrl $ver) -UseBasicParsing -TimeoutSec 60).Content } catch { }
    if (-not $txt) {
        Check $false "nodejs.org was reachable (-Live was passed)" (Get-NodeShaSumsUrl $ver)
    } else {
        $file = Get-NodeMsiFileName $ver
        $line = @($txt -split "`r?`n" | Where-Object { $_ -match ([regex]::Escape($file) + '\s*$') })
        Check ($line.Count -eq 1) "the published $($file) line is found" ($line -join ' ')
        # The reader finds the same hash grep would, and rejects a neighbouring one.
        $probe = Join-Path $WorkDir 'live-probe.bin'
        Set-Content -LiteralPath $probe -Value 'x' -Encoding ASCII -NoNewline
        $res = Test-NodeMsiChecksum -Path $probe -ShaSumsText $txt -FileName $file
        Check (-not $res.Ok -and $res.Expected -eq ($line[0] -split '\s+')[0]) `
              'the reader extracts exactly that hash and refuses a file that is not it' $res.Expected
    }
}

# =============================================================================
Section 'this machine was not modified'
$AfterNode = Get-InstalledNodeRuntime
Check ($AfterNode.Present -eq $BeforeNode.Present -and
       [string]$AfterNode.Version -eq [string]$BeforeNode.Version -and
       $AfterNode.Path -eq $BeforeNode.Path) `
      'the Node runtime on this machine is exactly as it was' `
      ("before " + $(if ($BeforeNode.Present) { $BeforeNode.Raw } else { 'none' }) +
       ", after " + $(if ($AfterNode.Present) { $AfterNode.Raw } else { 'none' }))
# PATH is a different question. Resolve-NodeRuntime repairs it on purpose, in this
# process, after an install -- that is the whole point of Repair-NodePathInProcess --
# so a run of this suite legitimately rebuilds it from the registry. What must not
# change is where node resolves TO.
$resolvedNow = (Get-Command node -ErrorAction SilentlyContinue)
Check (([string]$resolvedNow.Source) -eq ([string]$BeforeNode.Path)) `
      'node still resolves to the same executable it did before' `
      ("before $($BeforeNode.Path), now $($resolvedNow.Source)")
$env:PATH = $BeforePath

} finally {
    Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("  $script:Pass passed, $script:Fail failed") -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
Write-Host '  Not proven by this script:' -ForegroundColor DarkGray
Write-Host '    * that a real Node MSI installs. No MSI is executed anywhere here, on purpose:' -ForegroundColor DarkGray
Write-Host '      this machine has a Node the whole suite depends on, and an installer test that' -ForegroundColor DarkGray
Write-Host '      replaced it would be a worse bug than the one it is testing for. msiexec is' -ForegroundColor DarkGray
Write-Host '      replaced by a recorder, so the ARGUMENTS are proven and the OUTCOME is not.' -ForegroundColor DarkGray
Write-Host '    * that the machine PATH the MSI writes is the one this repair reads. The repair' -ForegroundColor DarkGray
Write-Host '      is proven against the PATH the registry holds now.' -ForegroundColor DarkGray
Write-Host '    * that 22.15.0 is still the right runtime to pin. That is a release decision and' -ForegroundColor DarkGray
Write-Host '      a CVE obligation; see packaging\README.md.' -ForegroundColor DarkGray
Write-Host ''
if ($script:Fail) { exit 1 }
exit 0
