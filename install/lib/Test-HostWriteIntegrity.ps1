<#
.SYNOPSIS
    Tests the end-of-run re-check: what the installer wrote to a host file is still
    there when the run finishes.

.DESCRIPTION
    Reported from a fresh machine. Three consecutive runs wrote
    claude_desktop_config.json, verified it, reported success, and the client's own
    panel showed "No servers added" every time. The write was not torn and the path
    was not wrong: merge-config.mjs backs the file up immediately before writing and
    re-parses it immediately after, restoring and exiting non-zero on any mismatch,
    so a run that left a .bak and exited 0 held a correct file at that instant.
    Something reverted it afterwards.

    The installer cannot stop a client rewriting a file it owns. It can stop
    reporting success for it. So each host file is hashed as it is written and every
    hash is checked again at the end of the run.

    TWO THINGS ARE ASSERTED, and the second is the one with teeth:

      * the pair of functions behaves -- unchanged reads clean, rewritten reads
        dirty, a dry run records nothing;
      * they are WIRED IN, at both write sites, and the re-check runs AFTER
        verification rather than beside the write. That ordering is the entire
        mechanism. An immediate re-check agrees with the write every time, which is
        exactly what merge-config.mjs's own post-write verification did on all three
        failing runs; by the end of the run, verification has started thirteen
        servers against a live bMS and a reverting client has had time to revert.

    The functions are lifted out of the engine source rather than restated, so a
    change to them is a change to what runs here.

    NOT PROVED: that any particular client actually reverts a file. That is a
    property of that application, was observed once on one machine, and no guard can
    assert it.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-HostWriteIntegrity.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$Engine = Join-Path (Split-Path -Parent $PSScriptRoot) 'Install-BConnectMcp.ps1'
if (-not (Test-Path -LiteralPath $Engine)) { throw "engine not found: $Engine" }

$script:Pass = 0
$script:Fail = 0
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}

$Work = Join-Path $env:TEMP ('bconnect-hostwrite-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $Work -Force | Out-Null

Write-Host ''
Write-Host 'Host write integrity' -ForegroundColor Cyan
Write-Host ''

try {
    $src = Get-Content -LiteralPath $Engine -Raw

    # =========================================================================
    # 1. The functions themselves.
    # =========================================================================
    Write-Host '-- the pair, lifted out of the engine and run --' -ForegroundColor Cyan

    $fnReg = [regex]::Match($src, '(?s)function Register-HostWrite \{.*?\r?\n\}').Value
    $fnChk = [regex]::Match($src, '(?s)function Test-HostWritesIntact \{.*?\r?\n\}').Value
    Check 'both functions are in the engine, so this is not testing a copy' `
        ([bool]$fnReg -and [bool]$fnChk)
    if (-not ($fnReg -and $fnChk)) { throw 'cannot continue without them' }
    Invoke-Expression $fnReg
    Invoke-Expression $fnChk

    $DryRun = $false
    $script:HostWrites = @()
    $f = Join-Path $Work 'claude_desktop_config.json'
    '{"mcpServers":{"bconnect-endpoints":{"command":"node"}}}' | Set-Content -LiteralPath $f -Encoding UTF8
    Register-HostWrite -HostId 'claude-desktop' -Path $f
    Check 'a written file is recorded' ($script:HostWrites.Count -eq 1)
    Check 'and with a hash, not just a path' `
        ($script:HostWrites[0].Sha -and $script:HostWrites[0].Sha.Length -eq 64)
    Check 'a file that has not changed reads clean' (@(Test-HostWritesIntact).Count -eq 0)

    # The reported failure, reproduced: the file is rewritten by something else.
    '{"mcpServers":{}}' | Set-Content -LiteralPath $f -Encoding UTF8
    $d = @(Test-HostWritesIntact)
    Check 'a file rewritten underneath the run is caught' ($d.Count -eq 1) `
        $(if ($d.Count) { "$($d[0].Host): $($d[0].Why)" } else { 'not caught' })
    Check 'and it names the host, so the operator knows which client to quit' `
        ($d.Count -and $d[0].Host -eq 'claude-desktop')
    Check 'and says what happened, rather than only that something did' `
        ($d.Count -and $d[0].Why -match 'contents changed')
    Check 'and carries how long after the write, which is what implicates a startup' `
        ($d.Count -and $null -ne $d[0].Age)

    # A file removed entirely is a different cause and reads differently.
    Remove-Item -LiteralPath $f -Force
    $d2 = @(Test-HostWritesIntact)
    Check 'a file deleted after the write is reported as gone, not as changed' `
        ($d2.Count -eq 1 -and $d2[0].Why -match 'gone') `
        $(if ($d2.Count) { $d2[0].Why } else { 'not caught' })

    # A dry run writes nothing, so it must record nothing -- otherwise every dry run
    # ends by re-checking files it never touched.
    $script:HostWrites = @()
    $DryRun = $true
    $f2 = Join-Path $Work 'dryrun.json'
    '{}' | Set-Content -LiteralPath $f2 -Encoding UTF8
    Register-HostWrite -HostId 'claude-desktop' -Path $f2
    Check 'a dry run records nothing' ($script:HostWrites.Count -eq 0)
    $DryRun = $false

    # A host with no file of its own -- the snippet-mode targets -- must not be
    # recorded as a write that then fails its own re-check.
    $script:HostWrites = @()
    Register-HostWrite -HostId 'openai' -Path (Join-Path $Work 'does-not-exist.json')
    Check 'a target with no file on disk is not recorded as written' ($script:HostWrites.Count -eq 0)

    # =========================================================================
    # 2. The wiring. This is the half that matters.
    # =========================================================================
    Write-Host '-- and they are wired in, in the right order --' -ForegroundColor Cyan

    Check 'Claude Desktop registers its write' `
        ($src -match "Register-HostWrite -HostId 'claude-desktop'")
    Check 'and so does every other emitted target, not only that one' `
        ($src -match 'foreach \(\$k in \$EmittedHostFiles\.Keys\) \{ Register-HostWrite') `
        'the failure mode belongs to any client that rewrites its config at launch'

    $iVerify   = $src.IndexOf("Write-Step 'Verification'")
    $iRecheck  = $src.IndexOf('Test-HostWritesIntact)')
    $iDone     = $src.IndexOf('# Done')
    Check 'the re-check is called at all' ($iRecheck -gt 0)
    Check 'AFTER verification, not beside the write' ($iRecheck -gt $iVerify) `
        "verification at $iVerify, re-check at $iRecheck"
    Check 'and before the run reports its result' ($iRecheck -lt $iDone) `
        "re-check at $iRecheck, done at $iDone"

    Check 'a drift finding fails the run rather than being a note' `
        ($src -match '(?s)\$hostDrift = @\(Test-HostWritesIntact\).*?\$verifyFailed = \$true')
    Check 'and it is skipped on a dry run, which wrote nothing to re-check' `
        ($src -match '\$StageDoesUser -and -not \$DryRun -and \$script:HostWrites\.Count')

    # The message has to carry the procedure. A run that says "the file changed" and
    # stops there leaves the operator to guess, and the guess that fails is the one
    # the report made three times: quit, relaunch, then run.
    $msg = [regex]::Match($src, '(?s)a host configuration this run wrote has been changed.*?Write-Ok').Value
    Check 'the failure text says to quit the client completely' ($msg -match '(?i)tray icon')
    Check 'and warns that one client is many processes' ($msg -match '(?i)many at once|several of them|processes')
    Check 'and says to start the client only after the run' ($msg -match '(?i)only after the run')
    Check 'and says every run will otherwise look like it worked' `
        ($msg -match '(?i)look like it worked')

    # =========================================================================
    # 3. The preflight gate, and where its list lives.
    # =========================================================================
    Write-Host '-- the preflight gate --' -ForegroundColor Cyan

    $hosts = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'hosts.json') -Raw | ConvertFrom-Json
    $cd = @($hosts.targets | Where-Object { $_.id -eq 'claude-desktop' })[0]
    Check 'the process list is DATA in hosts.json, not a branch in the engine' `
        (@($cd.quitProcesses) -contains 'claude') `
        'a client-specific rule in the engine is inherited by every client added later'
    Check 'and the evidence for it travels with it' `
        ([bool]$cd.quitEvidence) $cd.quitEvidence
    $untested = @($hosts.targets | Where-Object { -not ($_.PSObject.Properties.Name -contains 'quitProcesses') })
    Check 'targets with no entry are the majority, so this is not applied blindly' `
        ($untested.Count -ge 10) "no entry: $($untested.Count) of $(@($hosts.targets).Count)"
    Check 'and hosts.json states that no entry means NOT TESTED rather than safe' `
        ((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'hosts.json') -Raw) -match '(?i)not tested|NOT TESTED' -or
         $src -match '(?i)NOT\s+TESTED, not known-safe') `
        'silence read as a guarantee is how the next client inherits this failure quietly'

    $fnBlock = [regex]::Match($src, '(?s)function Get-BlockingHostProcesses \{.*?\r?\n\}').Value
    Check 'the gate function is in the engine' ([bool]$fnBlock)
    if ($fnBlock) {
        Invoke-Expression $fnBlock
        $noneRunning = @(Get-BlockingHostProcesses @([pscustomobject]@{ id = 'x'; label = 'X'; quitProcesses = @('a-process-that-does-not-exist') }))
        Check 'a client that is not running does not block' ($noneRunning.Count -eq 0)
        $noField = @(Get-BlockingHostProcesses @([pscustomobject]@{ id = 'y'; label = 'Y' }))
        Check 'a target with no quitProcesses never blocks' ($noField.Count -eq 0)
        # Something that is definitely running, to prove the positive case fires.
        $self = @(Get-BlockingHostProcesses @([pscustomobject]@{ id = 'z'; label = 'Z'; quitProcesses = @('powershell') }))
        Check 'a client that IS running blocks, and reports how many processes' `
            ($self.Count -eq 1 -and $self[0].Count -ge 1) `
            $(if ($self.Count) { "$($self[0].Process): $($self[0].Count)" } else { 'did not fire' })
    }

    $iTargets = $src.IndexOf("Write-Info ('targets: '")
    # The CALL SITE, whatever it is handed. The first draft matched the argument by
    # name and went red the moment the gate was narrowed to default paths only --
    # a guard failing on a change that improved the thing it guards.
    $iGate    = $src.IndexOf('$blocking = @(Get-BlockingHostProcesses')
    $iCD      = $src.IndexOf('--- Claude Desktop ---')
    Check 'the gate runs BEFORE any host is written' `
        ($iGate -gt 0 -and $iGate -lt $iCD) `
        'a refusal partway through leaves some clients configured and some not'
    Check 'it aborts rather than warning, unless -Force' `
        ($src -match '(?s)if \(-not \$Force\) \{\s*Abort ''a client that must be closed is running')
    Check '-Force is offered, for a machine where the client cannot be quit' `
        ($src -match '(?i)re-run with -Force')
    Check 'and a forced run says the end-of-run check will report the outcome' `
        ($src -match '(?i)-Force given: writing anyway')
    $iDryGuard = $src.IndexOf('if ($StageDoesUser -and -not $DryRun) {')
    Check 'the gate is skipped on a dry run, which writes nothing' `
        ($iDryGuard -gt 0 -and $iDryGuard -lt $iGate -and ($iGate - $iDryGuard) -lt 1500) `
        "dry-run guard at $iDryGuard, gate at $iGate"

    Check 'and it only fires for a file the client actually reads' `
        ($src -match '(?i)can only revert a file it opens') `
        'a rehearsal against a copy is in no danger from a running client'

    # Parenthesised around the WHOLE comparison. -not binds tighter than -match, so
    # `-not ($x -join ' ') -match '...'` negates the string first, and the assertion
    # is then always false -- it failed against a note that was already correct.
    Check 'the hosts.json note no longer tells the operator to relaunch first' `
        (-not (($cd.notes -join ' ') -match '(?i)Quit\) and relaunch')) `
        'that wording described the exact sequence that reproduced the failure twice'
    Check 'and it says the client must not be running while the file is written' `
        (($cd.notes -join ' ') -match '(?i)MUST NOT BE RUNNING')
}
finally {
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("  $($script:Pass) passed, $($script:Fail) failed") -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
exit $(if ($script:Fail) { 1 } else { 0 })
