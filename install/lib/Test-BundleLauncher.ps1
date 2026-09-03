<#
.SYNOPSIS
    Tests for packaging\START-HERE.cmd -- the file an administrator double-clicks
    after extracting the offline bundle.

.DESCRIPTION
    It RUNS the launcher. Nothing here inspects its text and concludes it works,
    because that is exactly how the defect this suite exists to prevent reached a
    customer's screen: every probe inside the launcher was verified individually
    in PowerShell and each one was correct, but the .cmd assembling them had never
    been executed. Two separate cmd parsing faults shipped:

      * Caret line-continuation inside a `for /f ... in (backticks)` block does not
        survive. cmd truncated the command at the first fragment, the loop variable
        was never assigned, and the empty result then failed the "not none" test --
        so the launcher announced a Group Policy restriction on every machine,
        including ones with no policy at all.

      * A QUOTED executable path inside a for/f backtick block splits at the first
        quote. `"%PS%"` was reported as an unrecognised command. Both probes are
        now plain redirections into a temporary file; the cleverness is gone.

    So each assertion below drives the real file with a stub front end and reads
    what came out. A stub, not the installer: this proves the launcher REACHES the
    right front end, which is its whole job. What the installer then does is
    covered by Test-Reconfigure.ps1 and Test-StageSplit.ps1.

    NOT proved here: behaviour on Server Core (no GUI is simulated by argument,
    not by absence), behaviour under a real Group Policy, and behaviour on a path
    that genuinely exceeds MAX_PATH -- the length check is driven by relocating the
    launcher, which exercises the arithmetic and the message but not the
    filesystem's own limit.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-BundleLauncher.ps1
#>
[CmdletBinding()]
param([switch] $KeepWork)

$ErrorActionPreference = 'Stop'

$LibDir     = $PSScriptRoot
$Installer  = Split-Path -Parent $LibDir
$Launcher   = Join-Path $Installer 'packaging\START-HERE.cmd'
if (-not (Test-Path -LiteralPath $Launcher)) { throw "launcher not found: $Launcher" }

$script:Pass = 0
$script:Fail = 0
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}

$Work = Join-Path $env:TEMP ('bconnect-launcher-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

function Get-StubBody {
    <#
        A stub that accepts exactly what the real front end accepts, and nothing more.

        The stubs used to be one Write-Host line with no param block, and that is
        precisely how a broken launcher passed this suite and then failed on a
        customer's machine: the launcher passes -SkipBuild to whichever front end it
        selects, the console script declared it and the WPF wizard did not, and a
        .ps1 with NO param block swallows any named argument into $args without a
        word. So the stub accepted what the real thing rejected -- the guard was
        testing a strictly more permissive target than the one that ships.

        Lifting the real parameter block verbatim closes that. [CmdletBinding()] is
        what makes it strict: a SIMPLE script treats an unknown -Foo as a positional
        argument and binds it to $args, so without the attribute this stub would be
        just as forgiving as the old one and would prove nothing.
    #>
    param([string] $RealScript, [string] $Marker)
    $tokens = $null; $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($RealScript, [ref]$tokens, [ref]$errs)
    if ($errs -and $errs.Count) { throw "$RealScript does not parse: $($errs[0].Message)" }
    if (-not $ast.ParamBlock) { throw "$RealScript has no param block to copy" }
    $block = $ast.ParamBlock.Extent.Text
    # The attribute is normally inside the ParamBlock's extent. Prepended only if it
    # is not, because a stub without it does not reject anything.
    if ($block -notmatch '(?i)\[CmdletBinding') { $block = "[CmdletBinding()]`r`n" + $block }
    return ($block + "`r`nWrite-Host `"$Marker reached`"`r`nexit 0`r`n")
}

function New-Bundle {
    <# A bundle root with stub front ends, at a caller-chosen depth. #>
    param([string] $Root, [switch] $NoPayload)
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
    if ($NoPayload) { return $Root }
    $inst = Join-Path $Root 'install'
    New-Item -ItemType Directory -Path $inst -Force | Out-Null
    # UTF8, not ASCII: the real parameter blocks carry their own comments, and a
    # non-ASCII character in one would otherwise be mangled into a parse error that
    # looks like a launcher fault.
    Set-Content -LiteralPath (Join-Path $inst 'Install-BConnectMcp.ps1') -Encoding UTF8 `
        -Value (Get-StubBody (Join-Path $Installer 'Install-BConnectMcp.ps1') 'STUB-CONSOLE')
    Set-Content -LiteralPath (Join-Path $inst 'Install-BConnectMcp-UI.ps1') -Encoding UTF8 `
        -Value (Get-StubBody (Join-Path $Installer 'Install-BConnectMcp-UI.ps1') 'STUB-WIZARD')
    Copy-Item -LiteralPath $Launcher -Destination (Join-Path $Root 'START-HERE.cmd') -Force
    return $Root
}

function Get-LauncherFrontEndSwitches {
    <#
        The named parameters START-HERE.cmd puts on the front-end command line.
        Read out of the launcher rather than restated here: a list maintained in two
        places is a list that disagrees with itself.
    #>
    $line = (Get-Content -LiteralPath $Launcher) |
            Where-Object { $_ -match '-File\s+"%INSTALLDIR%\\%FRONTEND%"' } |
            Select-Object -First 1
    if (-not $line) { throw 'no front-end invocation found in START-HERE.cmd' }
    $tail = $line -replace '^.*-File\s+"%INSTALLDIR%\\%FRONTEND%"', ''
    return @([regex]::Matches($tail, '(?<![\w-])-([A-Za-z][A-Za-z0-9]*)') | ForEach-Object { $_.Groups[1].Value })
}

function Get-DeclaredParameters {
    param([string] $Script)
    $tokens = $null; $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$tokens, [ref]$errs)
    return @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
}

function Invoke-Launcher {
    # `echo.` answers the trailing `pause` so the run terminates.
    #
    # ErrorActionPreference is dropped to Continue for the call. A cmd parse fault
    # writes to stderr, which PowerShell wraps as a NativeCommandError, which under
    # Stop terminates this script -- so the guard would die with a stack trace at
    # the exact moment it had something to report. The defect it exists to catch is
    # a parse fault, so it has to survive one and assert on it.
    param([string] $Root)
    $cmd = Join-Path $Root 'START-HERE.cmd'
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try   { $out = & cmd /c "echo. | `"$cmd`"" 2>&1 | Out-String }
    catch { $out = "LAUNCHER THREW: $($_.Exception.Message)" }
    finally { $ErrorActionPreference = $prev }
    return @{ Out = $out; Code = $LASTEXITCODE }
}

Write-Host ''
Write-Host 'Offline bundle launcher' -ForegroundColor Cyan
Write-Host ''

try {
    # =========================================================================
    # Part 1: it runs at all, and cmd parses every line of it.
    #
    # The first assertion is the one that would have caught the shipped defect.
    # A cmd parse fault prints to the console and carries on, so a launcher can
    # look like it worked while every probe inside it returned nothing.
    # =========================================================================
    Write-Host '-- the launcher runs, and cmd parses it --' -ForegroundColor Cyan
    $b1 = New-Bundle (Join-Path $Work 'ok')
    $r1 = Invoke-Launcher $b1

    # \s+ rather than a literal space: PowerShell wraps a long native-command
    # error, and the wrap landed mid-phrase -- so the literal pattern missed the
    # very defect this assertion exists for while the next one caught it.
    Check 'no line is rejected by cmd as an unrecognised command' `
        ($r1.Out -notmatch 'is\s+not\s+recognized\s+as\s+an\s+internal') `
        (($r1.Out -split "`n" | Where-Object { $_ -match 'not recognized' } | Select-Object -First 1))
    Check 'and nothing reports a missing operable program' `
        ($r1.Out -notmatch 'operable program or batch file')
    Check 'it reaches a front end rather than stopping early' `
        ($r1.Out -match 'STUB-(WIZARD|CONSOLE) reached') $r1.Out.Trim()
    Check 'and exits 0 when that front end does' ($r1.Code -eq 0) "exit $($r1.Code)"

    # =========================================================================
    # Part 1b: the arguments the launcher passes are arguments the front ends
    # accept. This is the one that was missing.
    #
    # The launcher chooses between two front ends and gives BOTH the same
    # arguments, so an argument only one of them declares is a coin toss decided
    # by whether the target machine has a GUI. -SkipBuild was exactly that: the
    # console script had it, the wizard did not, and every bundle installed
    # through the wizard stopped before its first question.
    # =========================================================================
    Write-Host '-- the arguments it passes are arguments the front ends accept --' -ForegroundColor Cyan

    $passed = Get-LauncherFrontEndSwitches
    Check 'the front-end command line is read from the launcher and is not empty' `
        ($passed.Count -gt 0) ('passes: ' + ($passed -join ', '))

    foreach ($fe in @('Install-BConnectMcp.ps1', 'Install-BConnectMcp-UI.ps1')) {
        $declared = Get-DeclaredParameters (Join-Path $Installer $fe)
        $unknown  = @($passed | Where-Object { $declared -notcontains $_ })
        Check "$fe declares every parameter the launcher passes it" `
            ($unknown.Count -eq 0) `
            $(if ($unknown.Count) { 'not declared: ' + ($unknown -join ', ') } else { '' })
    }

    # And the dynamic proof, which only means anything now that the stubs carry the
    # real parameter blocks.
    #
    # Matched on the error ID, not on the sentence. When a native command writes to
    # stderr, PowerShell wraps each line in a NativeCommandError -- and it splices
    # its own CategoryInfo and FullyQualifiedErrorId block INTO THE MIDDLE of the
    # message. The real text arrives as:
    #
    #     ...Install-BConnectMcp-UI.ps1 : A
    #     parameter
    #     At line:9 char:10
    #     ...four lines of PowerShell's own error metadata...
    #     cannot be found that matches parameter name 'SkipBuild'.
    #
    # So no pattern over that phrase can match, whitespace class or not: the words
    # are not merely wrapped, they are separated by unrelated text. Both earlier
    # attempts in this file failed this way. NamedParameterNotFound is one token,
    # cannot be split, and is emitted by exactly this condition.
    Check 'no argument is rejected by the front end it was handed to' `
        ($r1.Out -notmatch 'NamedParameterNotFound') `
        (($r1.Out -split "`n" | Where-Object { $_ -match 'NamedParameterNotFound' } | Select-Object -First 1))

    # =========================================================================
    # Part 2: the probes answer, rather than failing open or failing shut.
    # =========================================================================
    Write-Host '-- the probes answer --' -ForegroundColor Cyan

    Check 'no Group Policy restriction is reported on a machine that has none' `
        ($r1.Out -notmatch 'restricted by Group Policy') `
        'the shipped defect announced one on every machine'
    Check 'the GUI probe picks the wizard on a machine that has a GUI' `
        ($r1.Out -match 'STUB-WIZARD reached' -and $r1.Out -match 'Starting the installation wizard')
    Check 'and does not claim the graphical shell is absent' `
        ($r1.Out -notmatch 'No graphical shell is available')
    Check 'the Mark-of-the-Web step runs and says so' ($r1.Out -match 'Preparing files')
    Check 'no probe leaves its temporary file behind' `
        (@(Get-ChildItem $env:TEMP -Filter 'bconnect-g*.txt' -File -ErrorAction SilentlyContinue).Count -eq 0)

    # =========================================================================
    # Part 3: the payload check.
    # =========================================================================
    Write-Host '-- a bundle with no payload --' -ForegroundColor Cyan
    $b2 = New-Bundle (Join-Path $Work 'empty') -NoPayload
    Copy-Item -LiteralPath $Launcher -Destination (Join-Path $b2 'START-HERE.cmd') -Force
    $r2 = Invoke-Launcher $b2
    Check 'a missing install directory is reported, not ignored' `
        ($r2.Out -match 'installer was not found') $r2.Out.Trim()
    Check 'and it names the three items that must stay together' `
        ($r2.Out -match 'bConnect-MCP-main' -and $r2.Out -match 'offline-bundle.json')
    Check 'and exits non-zero' ($r2.Code -ne 0) "exit $($r2.Code)"

    # =========================================================================
    # Part 4: MAX_PATH. Driven by relocating the launcher, which exercises the
    # arithmetic and the message. The filesystem's own limit is not reached here.
    # =========================================================================
    Write-Host '-- the path-length check --' -ForegroundColor Cyan
    $deepName = 'd' * 120
    $deep = Join-Path $Work $deepName
    $b3 = New-Bundle $deep
    $r3 = Invoke-Launcher $b3
    Check 'a directory with no headroom is refused before anything is prepared' `
        ($r3.Out -match 'too deeply nested') $r3.Out.Trim()
    Check 'and it reports the overage as a number rather than "path too long"' `
        ($r3.Out -match 'exceeded by\s+\d+')
    Check 'and names a shorter location to use' ($r3.Out -match 'closer to the root')
    Check 'and stops: no front end is reached' ($r3.Out -notmatch 'STUB-(WIZARD|CONSOLE) reached')
    Check 'and exits non-zero' ($r3.Code -ne 0) "exit $($r3.Code)"

    Check 'a normal directory is NOT refused, so the check is not simply always on' `
        ($r1.Out -notmatch 'too deeply nested')
}
finally {
    if (-not $KeepWork -and (Test-Path -LiteralPath $Work)) {
        Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("  $($script:Pass) passed, $($script:Fail) failed") -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
exit $(if ($script:Fail) { 1 } else { 0 })
