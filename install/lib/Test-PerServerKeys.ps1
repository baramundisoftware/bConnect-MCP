<#
    Test-PerServerKeys.ps1 -- the optional per-server API key.

    The feature's whole value is that the DEFAULT is unchanged: an operator who
    wants one key for everything must not notice this exists. So most of what
    follows asserts absence -- ticked by default, no panel, nothing extra in the
    credentials file -- and only then that the option works when taken.

    Falsified by breaking each thing it guards; the mutation is named per test.
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$ui   = Join-Path $root 'Install-BConnectMcp-UI.ps1'
$eng  = Join-Path $root 'Install-BConnectMcp.ps1'

$pass = 0; $fail = 0
function Check([string]$name, [scriptblock]$test) {
    try {
        if (& $test) { Write-Host "  PASS  $name"; $script:pass++ }
        else         { Write-Host "  FAIL  $name" -ForegroundColor Red; $script:fail++ }
    } catch {
        Write-Host "  FAIL  $name  ($($_.Exception.Message))" -ForegroundColor Red; $script:fail++
    }
}

# PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI, which mangles every em
# dash in these sources and would make a content assertion fail for a reason
# that has nothing to do with the assertion. Explicit encoding on the READ.
$uiText  = [System.IO.File]::ReadAllText($ui,  [System.Text.Encoding]::UTF8)
$engText = [System.IO.File]::ReadAllText($eng, [System.Text.Encoding]::UTF8)

Write-Host ''
Write-Host 'Per-server API keys -- the option, and the default that hides it'
Write-Host ''

# ── The default: one key, exactly as before ─────────────────────────────────
Check 'the checkbox exists and is ticked by default' {
    # Mutation: drop IsChecked="True" -- a fresh install would then open with
    # the per-server panel showing, which is the confusion this must not cause.
    $uiText -match 'x:Name="chkOneKeyForAll"[^>]*IsChecked="True"'
}

Check 'the per-server panel starts collapsed' {
    $uiText -match 'x:Name="pnlPerServerKeys"[^>]*Visibility="Collapsed"'
}

Check 're-ticking clears the boxes rather than only hiding them' {
    # The leak this prevents: a key typed, then the tick restored, must not
    # still travel to disk because the panel remembered it. Mutation: delete
    # the Children.Clear() from the Checked handler.
    $checked = [regex]::Match($uiText, '(?s)chkOneKeyForAll\.Add_Checked\(\{.*?\}\)').Value
    ($checked -match 'Children\.Clear\(\)') -and ($checked -match 'PerServerKeyBoxes = @\{\}')
}

# ── The option, when taken ──────────────────────────────────────────────────
Check 'only filled-in boxes are sent to the engine' {
    # An empty box means "use the shared key". Sending it would write a
    # variable that overrides the shared key with nothing -- a server that
    # silently cannot authenticate.
    #
    # SCOPED to the collection block on purpose. The first version of this
    # assertion searched the whole file for `SecurePassword.Length -gt 0` and
    # passed while the check was mutated away, because an unrelated
    # pre-existing line (the Next-button enabler) contains the same text. A
    # guard that matches somebody else's code is not guarding yours.
    $block = [regex]::Match($uiText, '(?s)\$perServer = @\{\}.*?PerServerApiKeysSecure').Value
    ($block.Length -gt 0) -and ($block -match 'SecurePassword\.Length -gt 0')
}

Check 'the engine accepts the per-server keys as SecureStrings' {
    $engText -match '\[hashtable\]\s*\$PerServerApiKeysSecure'
}

Check 'the engine writes them as BCONNECT_API_KEY__<SCOPE>' {
    # Mutation: change the emitted prefix -- mcp-core would then never find
    # them and every server would quietly keep the shared key.
    $engText -match 'BCONNECT_API_KEY__\$\(\$e\.Key\)'
}

Check 'the machine stage refuses them, like every other credential' {
    $engText -match "'ApiKeySecure',\s*'PerServerApiKeysSecure'"
}

Check 'the wizard derives the scope the way mcp-core does' {
    # bconnect-jobs-mcp -> JOBS. If these two ever disagree the operator sets
    # a variable nothing reads, and the failure is silent.
    $uiText -match "replace '\^bconnect-'" -and $uiText -match "ToUpperInvariant\(\)"
}

# ── Defence in depth: the secret detector knows the new name shape ──────────
Check 'a per-server key name is recognised as a credential' {
    # Measured missing before this fix: the secret words had to END the name,
    # so BCONNECT_API_KEY was caught and BCONNECT_API_KEY__JOBS was not.
    # Mutation: remove the (?:__[A-Z0-9]+)? tail and this goes red.
    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if (-not $node) { throw 'node not on PATH' }
    # Via a temp FILE, not `node -e`: PowerShell strips the quotes out of an
    # inline script on the way to a native exe, and the probe then fails to
    # parse -- which looks exactly like the guard failing.
    $emitters = (Join-Path (Split-Path -Parent $PSCommandPath) 'host-emitters.mjs') -replace '\\', '/'
    $probe = Join-Path ([System.IO.Path]::GetTempPath()) 'bconnect-secret-probe.mjs'
    @"
import { containsSecretShapedValue as f } from 'file:///$emitters';
const scoped = f(JSON.stringify({ BCONNECT_API_KEY__JOBS: 'abc' }));
const shared = f(JSON.stringify({ BCONNECT_API_KEY: 'abc' }));
const benign = f(JSON.stringify({ ALLOW_WRITE_OPERATIONS: 'true' }));
console.log(scoped === true && shared === true && benign === false ? 'OK' : 'BAD');
"@ | Set-Content -Path $probe -Encoding utf8
    try { (& node $probe) -match 'OK' } finally { Remove-Item $probe -ErrorAction SilentlyContinue }
}

# ── Reachability: the option must be explained when it is locked ────────────
Check 'a locked credentials panel says why, outside the panel it describes' {
    # Reported from a real run: an existing installation ticks "keep the
    # credentials already on disk" at load, which disables credFields and with
    # it the per-server tick -- and the cause sits on a checkbox inside a
    # COLLAPSED Advanced expander, so nothing on screen explained it.
    #
    # The note must live OUTSIDE credFields: anything inside drops to 35%
    # opacity when the panel is disabled, and an explanation that dims with the
    # thing it explains is not an explanation. Mutation: move the Border inside
    # credFields, or delete it.
    $before = $uiText.Substring(0, $uiText.IndexOf('<StackPanel x:Name="credFields">'))
    ($before -match 'x:Name="reuseLockNote"') -and ($uiText -match "untick 'Keep the credentials already on disk'")
}

Check 'the note follows the startup tick, not only a click' {
    # The reported case is the STARTUP one: an existing install ticks reuse
    # before the handlers are registered, so a fix that only lives in
    # Add_Checked would leave the note hidden on exactly the machines that see
    # the lock. Mutation: delete the trailing if-block.
    #
    # ANCHORED to the block that disables credFields. The first version matched
    # `if ($els.chkReuse.IsChecked) {` and took the FIRST hit in the file --
    # a one-line `{ return $true }` elsewhere -- so it failed against correct
    # code. Twice now in this file a loose pattern has matched somebody else's
    # line; the lesson is to anchor on the statement that makes the block the
    # one you mean.
    $tail = [regex]::Match(
        $uiText,
        '(?s)if \(\$els\.chkReuse\.IsChecked\) \{\s*\r?\n\s*\$els\.credFields\.IsEnabled = \$false.*?\r?\n\}'
    ).Value
    ($tail.Length -gt 0) -and ($tail -match 'reuseLockNote\.Visibility = .Visible.')
}

Write-Host ''
Write-Host ("  $pass passed, $fail failed")
Write-Host ''
if ($fail) { exit 1 }
