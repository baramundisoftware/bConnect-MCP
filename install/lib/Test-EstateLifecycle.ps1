<#
.SYNOPSIS
    Tests for the two things that make an installation point somewhere: WHICH
    bConnect server it serves, and whether the files its client entries name are
    still on this machine.

.DESCRIPTION
    Everything here runs against a throwaway directory tree with dummy credentials
    and base URLs on a domain that does not resolve. It never reads, writes or
    touches the real credentials file, the real Claude Desktop configuration, or the
    real installation record, and it makes no network call that can reach a live bMS.

    PART ONE -- a second install against a different bMS is refused.

    install\state\installation.json is a SINGLE record, and every host-config entry
    is keyed by a bare server name. A second install pointing at a different bMS
    writes those same keys into the same client file and overwrites the first; the
    entry's args carry an absolute --env-file path, so it silently re-points at the
    other estate's credentials with nothing in any client looking different. The
    operator who then asks an assistant to assign a job believing they are on test
    assigns it on production.

    So: detect and refuse. The rule lives once, in Get-EstateChange
    (lib\State.psm1), and is called from one place in the installer -- which is what
    both front ends reach, the wizard driving that same script with -NonInteractive.
    What is checked below is that it fires when it must, that it does NOT fire for a
    URL that merely LOOKS different, that a plain re-run against the same estate is
    untouched by it, and that the sanctioned way to move an installation still
    works.

    PART TWO -- an entry that starts a file which is not there.

    One check answers three questions the record cannot: an upgrade to a different
    directory (UsePreviousAppDir is a default an administrator can override, and the
    record stays behind in the old one), a suite root deleted or renamed, and the
    software removed without the uninstall verb. All three end in the same state --
    every configured client shows a bconnect-* server that cannot start -- and all
    three are found by reading the entries rather than the record, which is why
    Get-StaleLaunchPaths holds for an ADOPTED view as well.

    Reported, not repaired. Rewriting a customer's client configuration unasked is
    the hazard this product is most careful about, and re-emit and remove are
    opposite answers only the operator can choose between.

    WHAT THIS FILE DOES NOT PROVE
      * that an interactive console run refuses without prompting. The refusal sits
        after the credential prompts by design -- it needs the URL those prompts
        collect -- so an interactive run has already prompted before it is reached.
        The -NonInteractive contract, which is what a wizard and a deployment job
        use, is what is checked here.
      * that a real MCP client fails to start a server whose file is missing. That
        is the client's behaviour, not this installer's.
      * anything about a real Inno Setup upgrade. The install-location change is
        modelled by moving the suite root; packaging\Test-InnoScript.ps1 holds
        UsePreviousAppDir and the uninstall delegation in place separately.

.EXAMPLE
    .\Test-EstateLifecycle.ps1
#>
[CmdletBinding()]
param([string] $WorkDir, [string] $Only)

$ErrorActionPreference = 'Stop'

$LibDir       = $PSScriptRoot
$InstallerDir = Split-Path -Parent $LibDir
$Installer    = Join-Path $InstallerDir 'Install-BConnectMcp.ps1'
$Bconnect     = Join-Path $InstallerDir 'bconnect.ps1'
$RealSuite    = Join-Path (Split-Path -Parent $InstallerDir) 'bConnect-MCP-main'

Import-Module (Join-Path $LibDir 'Secrets.psm1') -Force
Import-Module (Join-Path $LibDir 'Dpapi.psm1')   -Force -DisableNameChecking
Import-Module (Join-Path $LibDir 'State.psm1')   -Force -DisableNameChecking

if (-not $WorkDir) {
    $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-estate-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
}

# Dummy values. None of these is a credential for anything, and neither host name
# resolves.
$DUMMY_KEY  = 'dummy-api-key-0000-not-real'
$DUMMY_KEY2 = 'dummy-api-key-1111-rotated'
$TEST_URL   = 'https://bms-test.invalid.example/bconnect'
$PROD_URL   = 'https://bms-prod.invalid.example/bconnect'
# The same server as $TEST_URL, written three ways this installer already accepts.
$SAME_SLASH = 'https://bms-test.invalid.example/bconnect/'
$SAME_CASE  = 'https://BMS-TEST.Invalid.Example/BConnect'
$SAME_BARE  = 'https://bms-test.invalid.example'

$script:Pass = 0
$script:Fail = 0
$script:Failed = @()
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; $script:Failed += $Name; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}
function Group {
    param([string] $Name)
    Write-Host ''
    Write-Host ("  -- $Name " + ('-' * [Math]::Max(0, 58 - $Name.Length))) -ForegroundColor Cyan
}
function Want {
    param([string] $Name)
    if (-not $Only) { return $true }
    return ($Name -like ('*' + $Only + '*'))
}

# -----------------------------------------------------------------------------
# Running the engine
# -----------------------------------------------------------------------------
# In a CHILD process, and through a generated runner script rather than a command
# line, for two reasons: -ApiKeySecure is a [SecureString] and cannot cross a
# process boundary as text (which is the whole point of it), and the installer
# calls exit, which would end this test run if it were dot-sourced.
$script:RunSeq = 0
function ConvertTo-Literal {
    param($V)
    if ($null -eq $V) { return '$null' }
    if ($V -is [string] -and $V.StartsWith('#RAW#')) { return $V.Substring(5) }
    if ($V -is [bool] -or $V -is [switch]) { return $(if ([bool]$V) { '$true' } else { '$false' }) }
    if ($V -is [int]) { return [string]$V }
    if ($V -is [hashtable] -or $V -is [System.Collections.IDictionary]) {
        $parts = @()
        foreach ($k in $V.Keys) { $parts += ("'" + ($k -replace "'", "''") + "' = " + (ConvertTo-Literal $V[$k])) }
        return ('@{ ' + ($parts -join '; ') + ' }')
    }
    if ($V -is [array]) {
        $parts = @()
        foreach ($e in $V) { $parts += (ConvertTo-Literal $e) }
        return ('@(' + ($parts -join ', ') + ')')
    }
    return ("'" + ([string]$V -replace "'", "''") + "'")
}

function Invoke-Engine {
    param(
        [hashtable] $Params = @{},
        [string[]]  $Positional = @(),
        [string]    $Script,
        [string]    $Work,
        # What to type at whatever the script prompts for. Supplying it drops
        # -NonInteractive from the child, because -NonInteractive makes Read-Host
        # throw no matter what is on standard input -- which would make it
        # impossible to test a typed confirmation at all.
        [string]    $StdIn
    )
    if (-not $Script) { $Script = $Installer }
    $script:RunSeq++
    $runner = Join-Path $Work ('run-{0:d2}.ps1' -f $script:RunSeq)
    $log    = Join-Path $Work ('run-{0:d2}.log' -f $script:RunSeq)

    $lines = @('$ErrorActionPreference = ''Continue''', '$p = @{}')
    foreach ($k in $Params.Keys) {
        $lines += ('$p[''' + $k + '''] = ' + (ConvertTo-Literal $Params[$k]))
    }
    $pos = ''
    if ($Positional.Count) { $pos = ' ' + (($Positional | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ' ') }
    $lines += ('$out = & ''' + $Script + '''' + $pos + ' @p *>&1 | Out-String')
    $lines += '$code = $LASTEXITCODE'
    $lines += ('Set-Content -LiteralPath ''' + $log + ''' -Value $out -Encoding UTF8')
    $lines += 'if ($null -eq $code) { $code = 0 }'
    $lines += 'exit $code'
    Set-Content -LiteralPath $runner -Value ($lines -join "`r`n") -Encoding UTF8

    # Started through Process rather than the call operator. Anything the child
    # writes to stderr comes back as a NativeCommandError in THIS session, and
    # $ErrorActionPreference='Stop' would then end the whole test run instead of
    # failing one check -- observed, with the group producing no output at all,
    # which is the one thing a guard must never do. Process also gives standard
    # input, which a typed confirmation needs.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = (Get-Command powershell.exe).Source
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass')
    if (-not $PSBoundParameters.ContainsKey('StdIn')) { $argList += '-NonInteractive' }
    $argList += @('-File', ('"' + $runner + '"'))
    $psi.Arguments              = ($argList -join ' ')
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardInput  = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.WorkingDirectory       = $Work
    $proc = [System.Diagnostics.Process]::Start($psi)
    if ($PSBoundParameters.ContainsKey('StdIn')) { $proc.StandardInput.WriteLine($StdIn) }
    $proc.StandardInput.Close()
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    $code = $proc.ExitCode
    $proc.Dispose()

    $out = ''
    if (Test-Path -LiteralPath $log) { $out = Get-Content -LiteralPath $log -Raw }
    # The runner captures the script's own streams into the log; anything left on
    # the child's own stdout/stderr is the shell talking about the script, and both
    # belong in what a check reads.
    return @{ Code = $code; Output = ($out + "`r`n" + $stdout + "`r`n" + $stderr) }
}

function New-Scenario {
    param([string] $Name, [string] $Suite)
    if (-not $Suite) { $Suite = $RealSuite }
    $w = Join-Path $WorkDir $Name
    $s = [ordered]@{
        Root       = $w
        Suite      = $Suite
        SecretsDir = Join-Path $w 'secrets'
        ProjectDir = Join-Path $w 'project'
        HostOutDir = Join-Path $w 'out'
        StateFile  = Join-Path $w 'state\installation.json'
        ConfigPath = Join-Path $w 'claude\claude_desktop_config.json'
    }
    New-Item -ItemType Directory -Path $w -Force | Out-Null
    New-Item -ItemType Directory -Path $s.ProjectDir -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $s.ConfigPath) -Force | Out-Null
    $s.EnvFile = Join-Path $s.SecretsDir 'bconnect.env'
    # Every bconnect verb is pointed at the scratch tree explicitly. Without the
    # overrides, adoption would enumerate this machine's REAL host configuration
    # files, and a mutating verb would then act on the live installation.
    $s.Verb = @{
        StateFile          = $s.StateFile
        SuiteRootOverride  = $Suite
        SecretsDirOverride = $s.SecretsDir
        ProjectDirOverride = $s.ProjectDir
        HostOutDirOverride = $s.HostOutDir
        ConfigPathOverride = $s.ConfigPath
    }
    $s.Common = @{
        SuiteRoot             = $Suite
        SecretsDir            = $s.SecretsDir
        ConfigPath            = $s.ConfigPath
        ProjectDir            = $s.ProjectDir
        HostOutDir            = $s.HostOutDir
        StateFile             = $s.StateFile
        NonInteractive        = $true
        SkipBuild             = $true
        ContinueOnUnreachable = $true
        Hosts                 = 'claude-desktop'
        Servers               = 'bconnect-endpoints'
    }
    return [pscustomobject]$s
}

function New-FakeSuite {
    <#
        A suite root the installer accepts -- package.json plus one bconnect-*-mcp
        package with a build\index.js -- and which this test may rename or delete.
        The REAL suite root must never be touched to model a moved installation.
    #>
    param([string] $Path)
    New-Item -ItemType Directory -Path (Join-Path $Path 'bconnect-endpoints-mcp\build') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $Path 'package.json') `
                -Value '{ "name": "bconnect-mcp-suite", "private": true }' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Path 'bconnect-endpoints-mcp\build\index.js') `
                -Value 'process.exit(0);' -Encoding UTF8
    return $Path
}

function New-ScratchEnvFile {
    param($Scenario, [string] $BaseUrl)
    New-Item -ItemType Directory -Path $Scenario.SecretsDir -Force | Out-Null
    Set-HardenedDirectoryAcl -Path $Scenario.SecretsDir
    Write-SecretFileAtomic -Path $Scenario.EnvFile -Content (New-EnvFileContent -BaseUrl $BaseUrl -ApiKey $DUMMY_KEY)
}

function New-ScratchClaudeConfig {
    param($Scenario, [hashtable] $McpServers = @{}, [hashtable] $TopLevel = @{})
    $o = [ordered]@{}
    foreach ($k in $TopLevel.Keys) { $o[$k] = $TopLevel[$k] }
    $o['mcpServers'] = $McpServers
    ($o | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $Scenario.ConfigPath -Encoding UTF8
}

function Install-Once {
    <# One install run against the given base URL. #>
    param($Scenario, [string] $BaseUrl, [string] $Key = $DUMMY_KEY, [hashtable] $Extra = @{})
    $p = @{} + $Scenario.Common
    $p['BaseUrl']      = $BaseUrl
    $p['ApiKeySecure'] = "#RAW#(ConvertTo-SecureString '$Key' -AsPlainText -Force)"
    foreach ($k in $Extra.Keys) { $p[$k] = $Extra[$k] }
    return (Invoke-Engine -Params $p -Work $Scenario.Root)
}

function Get-EnvUrl {
    param($Scenario)
    try { return [string](Read-BConnectEnvMap -EnvFile $Scenario.EnvFile)['BCONNECT_BASE_URL'] } catch { return '' }
}

Write-Host ''
Write-Host "Estate and lifecycle tests -- scratch tree: $WorkDir" -ForegroundColor Cyan
Write-Host '  live bMS: never contacted. Both base URLs are domains that do not resolve.' -ForegroundColor DarkGray

$started = Get-Date
try {

# =============================================================================
# 1. The rule itself, in process
# =============================================================================
# Measured against the tree before this feature existed: Get-EstateKey and
# Get-EstateChange did not exist, `Get-Command Get-EstateChange` returned nothing,
# and every one of these was unanswerable.
if (Want 'rule') {
Group 'Get-EstateKey -- what counts as the same bConnect server'

foreach ($u in @($SAME_SLASH, $SAME_CASE, $SAME_BARE, 'https://bms-test.invalid.example:443/bconnect')) {
    Check ("the same server written as $u" ) `
          ((Get-EstateKey $u) -eq (Get-EstateKey $TEST_URL)) `
          ((Get-EstateKey $u) + '   vs   ' + (Get-EstateKey $TEST_URL))
}
foreach ($u in @($PROD_URL, 'https://bms-test.invalid.example:8443/bconnect', 'http://bms-test.invalid.example/bconnect')) {
    Check ("a different endpoint: $u") `
          ((Get-EstateKey $u) -ne (Get-EstateKey $TEST_URL)) `
          ((Get-EstateKey $u) + '   vs   ' + (Get-EstateKey $TEST_URL))
}
Check 'a URL that will not parse still yields an answer rather than throwing' `
      ((Get-EstateKey 'not a url at all/') -eq 'not a url at all')

Group 'Get-EstateChange -- when that difference is a refusal'

$recTest = New-InstallationRecord -SuiteRoot 'C:\x' -SecretsDir 'C:\x\secrets' `
             -Credentials @{ baseUrl = $TEST_URL } -Servers ([ordered]@{})
$envTest = New-Object 'System.Collections.Specialized.OrderedDictionary'
$envTest['BCONNECT_BASE_URL'] = $TEST_URL

Check 'no record means nothing to overwrite, so no conflict' `
      ($null -eq (Get-EstateChange -Record $null -EnvMap $envTest -RequestedUrl $PROD_URL))
Check 'a record with no base URL is not a conflict either' `
      ($null -eq (Get-EstateChange -Record (New-InstallationRecord -SuiteRoot 'C:\x' -SecretsDir 'C:\y' -Servers ([ordered]@{})) `
                                   -EnvMap $envTest -RequestedUrl $PROD_URL))
Check 'the same estate is not a conflict' `
      ($null -eq (Get-EstateChange -Record $recTest -EnvMap $envTest -RequestedUrl $TEST_URL))
foreach ($u in @($SAME_SLASH, $SAME_CASE, $SAME_BARE)) {
    Check ("nor is the same estate written as $u") `
          ($null -eq (Get-EstateChange -Record $recTest -EnvMap $envTest -RequestedUrl $u))
}
$c = Get-EstateChange -Record $recTest -EnvMap $envTest -RequestedUrl $PROD_URL
Check 'a different estate IS a conflict' ($null -ne $c)
Check 'and it carries both URLs, so a refusal can name them' `
      ($null -ne $c -and $c.RecordedUrl -eq $TEST_URL -and $c.RequestedUrl -eq $PROD_URL)

Check '-AcceptedFrom naming the recorded URL is the deliberate re-point, and is allowed' `
      ($null -eq (Get-EstateChange -Record $recTest -EnvMap $envTest -RequestedUrl $PROD_URL -AcceptedFrom $TEST_URL))
Check '-AcceptedFrom naming some OTHER URL does not suppress it' `
      ($null -ne (Get-EstateChange -Record $recTest -EnvMap $envTest -RequestedUrl $PROD_URL -AcceptedFrom 'https://bms-other.invalid.example/bconnect'))

# The false positive this would otherwise have: `bconnect set credential` hands the
# engine the URL out of the CREDENTIALS FILE. If a hand edit has moved that file on
# from the record, the request matches the file and changes no estate -- refusing it
# would make an unreadable credential unfixable.
$envMoved = New-Object 'System.Collections.Specialized.OrderedDictionary'
$envMoved['BCONNECT_BASE_URL'] = $PROD_URL
Check 'a request matching the credentials file is not a conflict, even when the record disagrees' `
      ($null -eq (Get-EstateChange -Record $recTest -EnvMap $envMoved -RequestedUrl $PROD_URL))
}

# =============================================================================
# 2. A second install against a different bMS, end to end
# =============================================================================
# Measured against the unfixed installer, this exact scenario: exit code 0,
# BCONNECT_BASE_URL rewritten to the production URL, and the bconnect-endpoints
# entry in claude_desktop_config.json rewritten in place. Nothing said anything.
if (Want 'refuse') {
Group 'A second install against a different bMS is refused'

$s2 = New-Scenario 'refuse'
New-ScratchClaudeConfig $s2
$first = Install-Once $s2 $TEST_URL
Check 'CONTROL: the first install writes a record' (Test-Path -LiteralPath $s2.StateFile) `
      ("exit $($first.Code)")
Check 'CONTROL: and the credentials file names the test estate' `
      ((Get-EnvUrl $s2) -eq $TEST_URL) ('saw ' + (Get-EnvUrl $s2))

$cfgBefore = ''
if (Test-Path -LiteralPath $s2.ConfigPath) { $cfgBefore = Get-Content -LiteralPath $s2.ConfigPath -Raw }
$baksBefore = @(Get-ChildItem -LiteralPath (Split-Path -Parent $s2.ConfigPath) -Filter '*.bak-*' -ErrorAction SilentlyContinue).Count
$second = Install-Once $s2 $PROD_URL $DUMMY_KEY2

# Exit code alone is not evidence here: this scratch bMS does not resolve, so a run
# that went the whole way would exit non-zero too. The discriminating fact is WHERE
# it stopped -- before Step 4, which is the last step before anything is written.
Check 'the second install exits non-zero' ($second.Code -ne 0) ("exit $($second.Code)")
Check 'and it stopped before the reachability step, which is before the first write' `
      ($second.Output -notmatch '(?i)bConnect reachability')
Check 'it says the installation is configured for a different bConnect server' `
      ($second.Output -match '(?i)different bConnect server')
Check 'it states the RECORDED URL' ($second.Output -match [regex]::Escape($TEST_URL))
Check 'it states the REQUESTED URL' ($second.Output -match [regex]::Escape($PROD_URL))
Check 'it names bconnect.ps1 set url as the way to move this installation' `
      ($second.Output -match '(?i)set url')
Check 'it names bconnect.ps1 uninstall as the way to start again' `
      ($second.Output -match '(?i)uninstall')
Check 'it explains that the entries would be re-pointed rather than duplicated' `
      ($second.Output -match '(?i)re-point')

Check 'the credentials file still names the test estate' ((Get-EnvUrl $s2) -eq $TEST_URL) `
      ('saw ' + (Get-EnvUrl $s2))
Check 'the API key was NOT replaced' `
      ((Read-BConnectEnvMap -EnvFile $s2.EnvFile)['BCONNECT_API_KEY'] -eq $DUMMY_KEY)
Check 'the client configuration is byte-identical' `
      ($cfgBefore -eq (Get-Content -LiteralPath $s2.ConfigPath -Raw))
Check 'and the refused run took no backup of its own, because it wrote nothing' `
      (@(Get-ChildItem -LiteralPath (Split-Path -Parent $s2.ConfigPath) -Filter '*.bak-*' -ErrorAction SilentlyContinue).Count -eq $baksBefore) `
      ("$baksBefore before the refused run")

# -NonInteractive is what a wizard and a deployment job run. The contract is a
# non-zero exit and the reason on standard output; a prompt would hang a job
# nobody is watching. This whole harness runs with stdin at end of file, so a
# Read-Host would have been observed as a hang or an empty answer, not a pass.
Check '-NonInteractive refuses rather than asking: the reason is in the output, not a question' `
      ($second.Code -ne 0 -and $second.Output -match '(?i)different bConnect server' -and
       $second.Output -notmatch '(?i)\[y/n\]|\[Y/n\]|\[y/N\]')
}

# =============================================================================
# 3. The refusal must not fire for a URL that only looks different
# =============================================================================
# A refusal triggered by a trailing slash would be a bug, not safety.
if (Want 'equivalent') {
Group 'An equivalent URL is not a different estate'

foreach ($case in @(
    @{ N = 'a trailing slash';                U = $SAME_SLASH },
    @{ N = 'a different host and path case';  U = $SAME_CASE  },
    @{ N = 'the /bconnect suffix omitted';    U = $SAME_BARE  }
)) {
    $sn = 'equivalent-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
    $se = New-Scenario $sn
    New-ScratchClaudeConfig $se
    $null = Install-Once $se $TEST_URL
    $again = Install-Once $se $case.U $DUMMY_KEY2
    Check ("not refused: " + $case.N) `
          ($again.Output -notmatch '(?i)different bConnect server') `
          ($case.U + '   -> exit ' + $again.Code)
    Check ("and the run went on to write the credentials file: " + $case.N) `
          ((Read-BConnectEnvMap -EnvFile $se.EnvFile)['BCONNECT_API_KEY'] -eq $DUMMY_KEY2)
}
}

# =============================================================================
# 4. Reconfiguring the SAME estate is completely unaffected
# =============================================================================
if (Want 'same') {
Group 'The common case: a re-run against the same estate'

$s4 = New-Scenario 'same-estate'
New-ScratchClaudeConfig $s4
$null   = Install-Once $s4 $TEST_URL
$rerun  = Install-Once $s4 $TEST_URL $DUMMY_KEY2
Check 'a re-run against the same estate is not refused' `
      ($rerun.Output -notmatch '(?i)different bConnect server') ("exit $($rerun.Code)")
Check 'it acquires no new question' ($rerun.Output -notmatch '(?i)estate.*\?')
Check 'and the credential change went through' `
      ((Read-BConnectEnvMap -EnvFile $s4.EnvFile)['BCONNECT_API_KEY'] -eq $DUMMY_KEY2)

# A re-run that mentions no URL at all -- the shape every write-gate and host verb
# takes -- must also be untouched by this.
$p = @{} + $s4.Common
$p['ReuseCredentials'] = $true
$reuse = Invoke-Engine -Params $p -Work $s4.Root
Check 'a re-run that supplies no URL at all is not refused' `
      ($reuse.Output -notmatch '(?i)different bConnect server') ("exit $($reuse.Code)")
}

# =============================================================================
# 5. The supported way to move an installation still works
# =============================================================================
if (Want 'moveurl') {
Group 'bconnect set url -- the path the refusal points at'

$s5 = New-Scenario 'set-url'
New-ScratchClaudeConfig $s5
$null = Install-Once $s5 $TEST_URL
$cfgBefore5 = Get-Content -LiteralPath $s5.ConfigPath -Raw

$mv = Invoke-Engine -Script $Bconnect -Positional @('set', 'url', $PROD_URL) `
        -Params ($s5.Verb + @{ IgnoreUnreachable = $true }) -Work $s5.Root
Check 'set url is not refused, because it states the URL it is replacing' `
      ($mv.Output -notmatch '(?i)already configured for a different') ("exit $($mv.Code)")
Check 'the base URL actually moved' ((Get-EnvUrl $s5) -eq $PROD_URL) ('saw ' + (Get-EnvUrl $s5))
Check 'and it said out loud that the estate behind the entries changed' `
      ($mv.Output -match '(?i)moves the installation to a different bConnect server')
Check 'naming both servers' `
      ($mv.Output -match [regex]::Escape($TEST_URL) -and $mv.Output -match [regex]::Escape($PROD_URL))
Check 'no client configuration changed' `
      ((Get-Content -LiteralPath $s5.ConfigPath -Raw) -eq $cfgBefore5)

# And after the move, an install against the NEW estate is the ordinary case.
$after = Install-Once $s5 $PROD_URL
Check 'an install against the new estate afterwards is not refused' `
      ($after.Output -notmatch '(?i)different bConnect server') ("exit $($after.Code)")
Check 'while one against the old one now is' `
      ((Install-Once $s5 $TEST_URL).Output -match '(?i)different bConnect server')
}

# =============================================================================
# 6. An install-location change leaves nothing pointing at a path that is gone
# =============================================================================
# Measured against the unfixed tree: after moving the suite root, `bconnect status`
# printed "[ ok ] no drift -- every recorded entry is exactly as the installer left
# it" while every entry named a build\index.js that was not there.
if (Want 'moved') {
Group 'A moved installation is reported, not silently broken'

$suiteA = New-FakeSuite (Join-Path $WorkDir 'moved\suite-a')
$s6 = New-Scenario 'moved' -Suite $suiteA
New-ScratchClaudeConfig $s6
$null = Install-Once $s6 $TEST_URL

$entryPath = $null
$cfg6 = Get-Content -LiteralPath $s6.ConfigPath -Raw | ConvertFrom-Json
if ($cfg6.mcpServers -and $cfg6.mcpServers.'bconnect-endpoints') {
    $entryPath = @($cfg6.mcpServers.'bconnect-endpoints'.args | Where-Object { $_ -match 'index\.js$' })[0]
}
Check 'CONTROL: the entry names a build\index.js under the install location' `
      ([bool]$entryPath -and $entryPath -like ($suiteA + '*')) ("saw " + $entryPath)

$st6a = Invoke-Engine -Script $Bconnect -Positional @('status') -Params $s6.Verb -Work $s6.Root
Check 'CONTROL: while that file is there, status reports no missing file' `
      ($st6a.Output -notmatch '(?i)starts a file that is not on this machine')

# The install location moves. UsePreviousAppDir is a default; /DIR= overrides it.
$suiteB = Join-Path $WorkDir 'moved\suite-b'
Move-Item -LiteralPath $suiteA -Destination $suiteB

$st6b = Invoke-Engine -Script $Bconnect -Positional @('status') -Params $s6.Verb -Work $s6.Root
Check 'status reports the entry that starts a file which is not there' `
      ($st6b.Output -match '(?i)starts a file that is not on this machine')
Check 'and names the path it looked for' `
      ($st6b.Output -match [regex]::Escape($entryPath))
Check 'and names the server the entry belongs to' ($st6b.Output -match 'bconnect-endpoints')
Check 'and offers hosts resync as the repair' ($st6b.Output -match '(?i)hosts resync')
Check 'and offers uninstall as the other answer' ($st6b.Output -match '(?i)uninstall')

# The record stayed in the OLD install directory, so the new one adopts. That is the
# real shape of an upgrade to a different directory, and the finding has to survive
# it -- an adopted view has no hashes, and the hash comparisons say nothing.
Remove-Item -LiteralPath $s6.StateFile -Force
$st6c = Invoke-Engine -Script $Bconnect -Positional @('status') -Params $s6.Verb -Work $s6.Root
Check 'CONTROL: with no record, status adopts' ($st6c.Output -match '(?i)adopt')
Check 'an ADOPTED view still reports the missing file' `
      ($st6c.Output -match '(?i)starts a file that is not on this machine') `
      (($st6c.Output -split "`r?`n" | Where-Object { $_ -match '(?i)drift|adopt' } | Select-Object -First 3) -join ' / ')
Check 'and does not claim the entries were checked against hashes it does not have' `
      ($st6c.Output -match '(?i)no recorded hashes')

# The repair the finding names has to work from the new location.
$verbB = @{} + $s6.Verb
$verbB['SuiteRootOverride'] = $suiteB
$rs = Invoke-Engine -Script $Bconnect -Positional @('hosts', 'resync') -Params $verbB -Work $s6.Root
$cfg6b = Get-Content -LiteralPath $s6.ConfigPath -Raw | ConvertFrom-Json
$entryPath2 = $null
if ($cfg6b.mcpServers -and $cfg6b.mcpServers.'bconnect-endpoints') {
    $entryPath2 = @($cfg6b.mcpServers.'bconnect-endpoints'.args | Where-Object { $_ -match 'index\.js$' })[0]
}
Check 'hosts resync re-emits the entry at the new location' `
      ([bool]$entryPath2 -and $entryPath2 -like ($suiteB + '*')) ("saw " + $entryPath2 + " (exit $($rs.Code))")
Check 'and that file is really there, so no entry is left pointing at nothing' `
      ([bool]$entryPath2 -and (Test-Path -LiteralPath $entryPath2))
$st6d = Invoke-Engine -Script $Bconnect -Positional @('status') -Params $verbB -Work $s6.Root
Check 'status is quiet again afterwards' `
      ($st6d.Output -notmatch '(?i)starts a file that is not on this machine')
}

# =============================================================================
# 7. The software removed without the uninstall verb
# =============================================================================
if (Want 'removed') {
Group 'Software removed by hand: every configured client keeps a server that cannot start'

$suiteC = New-FakeSuite (Join-Path $WorkDir 'removed\suite')
$s7 = New-Scenario 'removed' -Suite $suiteC
New-ScratchClaudeConfig $s7 -McpServers @{ 'someone-elses-server' = @{ command = 'node'; args = @('other.js') } }
$null = Install-Once $s7 $TEST_URL

# The suite is deleted. Nothing removed the entries, because nothing was asked to.
Remove-Item -LiteralPath $suiteC -Recurse -Force
$st7 = Invoke-Engine -Script $Bconnect -Positional @('status') -Params $s7.Verb -Work $s7.Root
Check 'status reports it' ($st7.Output -match '(?i)starts a file that is not on this machine')
Check 'the entry is still in the client file -- nothing removed it silently' `
      ((Get-Content -LiteralPath $s7.ConfigPath -Raw) -match '"bconnect-endpoints"')
Check 'and the unrelated MCP server is untouched' `
      ((Get-Content -LiteralPath $s7.ConfigPath -Raw) -match 'someone-elses-server')

# The credentials file going with it is the same class of finding, found the same
# way, because the entry names it by absolute path too.
Remove-Item -LiteralPath $s7.SecretsDir -Recurse -Force
$st7b = Invoke-Engine -Script $Bconnect -Positional @('status') -Params $s7.Verb -Work $s7.Root
Check 'a missing credentials file in the entry args is reported as well' `
      ($st7b.Output -match '(?i)bconnect\.env')

Group 'The uninstaller message says what the leftover entries will do'

# Not the behaviour of the .iss -- packaging\Test-InnoScript.ps1 holds the
# delegation to bconnect.ps1 in place. This is the one thing the operator is told
# when they answer "No", and until now it listed the entries without saying that
# each one now names a file that is not there.
$iss = Get-Content -LiteralPath (Join-Path $InstallerDir 'packaging\bconnect-mcp.iss') -Raw
Check 'the uninstaller states that the leftover entries cannot start' `
      ($iss -match '(?i)cannot start')
# Deliberately NOT a search for "bconnect.ps1 uninstall": that string is already in
# the file, in the Exec that delegates the removal, so it would pass whatever this
# message said. The remedy for an operator whose program files are gone is the one
# that mentions installing again.
Check 'and names how to remove them once the program files are gone' `
      ($iss -match '(?i)install this product again')
}

# =============================================================================
# 8. Uninstall: the confirmation, and the backup
# =============================================================================
# The removal itself, and that foreign content comes out byte-identical, is held in
# place by lib\Test-Reconfigure.ps1 section 6. These two are the parts that were
# documented and not checked anywhere.
if (Want 'uninstall') {
Group 'Uninstall asks, and backs up before it writes'

$s8 = New-Scenario 'uninstall'
New-ScratchClaudeConfig $s8 -McpServers @{ 'someone-elses-server' = @{ command = 'node'; args = @('other.js') } }
$null = Install-Once $s8 $TEST_URL
$cfgBefore8 = Get-Content -LiteralPath $s8.ConfigPath -Raw

# The typed confirmation, actually typed. Answering yes -- the word an operator
# reaches for -- must not be enough, and neither must the word in lower case: the
# comparison is -cne 'UNINSTALL' and a case-insensitive one would make the whole
# gate weaker than it reads.
foreach ($answer in @('y', 'yes', 'uninstall', 'Uninstall')) {
    $no = Invoke-Engine -Script $Bconnect -Positional @('uninstall') -Params $s8.Verb -Work $s8.Root -StdIn $answer
    Check ("typing '$answer' removes nothing") `
          ((Get-Content -LiteralPath $s8.ConfigPath -Raw) -eq $cfgBefore8 -and
           (Test-Path -LiteralPath $s8.EnvFile) -and (Test-Path -LiteralPath $s8.StateFile)) `
          ($no.Output -split "`r?`n" | Where-Object { $_ -match '(?i)nothing changed' } | Select-Object -First 1)
    Check ("and says so after '$answer'") ($no.Output -match '(?i)nothing changed')
}
# Read-Host writes its prompt straight to the console host, so the word UNINSTALL
# itself is not in any captured stream. What IS captured is everything said before
# the question, and that is what an operator decides on.
$asked = (Invoke-Engine -Script $Bconnect -Positional @('uninstall') -Params $s8.Verb -Work $s8.Root -StdIn 'n').Output
Check 'before asking, it says what will be removed' ($asked -match '(?i)bconnect-\* entries')
Check 'and that a backup is taken first'            ($asked -match '(?i)backup is taken first')

$typed = Invoke-Engine -Script $Bconnect -Positional @('uninstall') -Params $s8.Verb -Work $s8.Root -StdIn 'UNINSTALL'
Check 'typing UNINSTALL exactly does remove the entries' `
      ((Get-Content -LiteralPath $s8.ConfigPath -Raw) -notmatch '"bconnect-endpoints"') `
      ("exit $($typed.Code)")

# Put it back, so the -Yes path below starts from a configured installation again.
$null = Install-Once $s8 $TEST_URL
$cfgBefore8 = Get-Content -LiteralPath $s8.ConfigPath -Raw

$backupsBefore = @(Get-ChildItem -LiteralPath (Split-Path -Parent $s8.ConfigPath) -Filter '*.bak-*' -ErrorAction SilentlyContinue).Count
$un = Invoke-Engine -Script $Bconnect -Positional @('uninstall') `
        -Params ($s8.Verb + @{ Yes = $true }) -Work $s8.Root
$backups = @(Get-ChildItem -LiteralPath (Split-Path -Parent $s8.ConfigPath) -Filter '*.bak-*' -ErrorAction SilentlyContinue)
Check 'uninstall with -Yes exits 0' ($un.Code -eq 0) ("exit $($un.Code)")
Check 'it backed the client file up before removing anything' `
      ($backups.Count -gt $backupsBefore) ("$backupsBefore before, $($backups.Count) after")
if ($backups.Count) {
    $newest = @($backups | Sort-Object LastWriteTime -Descending)[0]
    $bak = Get-Content -LiteralPath $newest.FullName -Raw
    Check 'and the backup holds the entries as they were, not as they became' `
          ($bak -match '"bconnect-endpoints"')
}
Check 'the entries are gone from the live file' `
      ((Get-Content -LiteralPath $s8.ConfigPath -Raw) -notmatch '"bconnect-endpoints"')
Check 'and the foreign entry is still there' `
      ((Get-Content -LiteralPath $s8.ConfigPath -Raw) -match 'someone-elses-server')
}

} finally {
    Write-Host ''
    Write-Host ('  elapsed ' + [int]((Get-Date) - $started).TotalSeconds + 's') -ForegroundColor DarkGray
    Write-Host ('  scratch tree left at ' + $WorkDir) -ForegroundColor DarkGray
}

Write-Host ''
Write-Host ('  {0} passed, {1} failed' -f $script:Pass, $script:Fail) `
           -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
if ($script:Fail) {
    Write-Host ''
    foreach ($f in $script:Failed) { Write-Host ('    FAILED:  ' + $f) -ForegroundColor Red }
}
Write-Host ''
exit $(if ($script:Fail) { 1 } else { 0 })
