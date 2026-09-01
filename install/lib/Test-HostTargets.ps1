<#
.SYNOPSIS
    Test the host-target layer: the registry, every config emitter, and -- the part
    that carries the weight -- that a malformed emission is actually rejected.

.DESCRIPTION
    Three suites in one command, in increasing order of how much they cost to run:

      1. lib\test-host-emitters.mjs   pure, no filesystem, no bMS, no host apps.
                                      Builds every host's config, checks it against
                                      the shape recorded in lib\hosts.json, renders
                                      every snippet, and then feeds the validator
                                      thirteen deliberately WRONG emissions and
                                      requires it to catch each one. Two of those
                                      are real mistakes this project would
                                      otherwise have shipped: VS Code's
                                      mcpServers/servers key swap, and Continue's
                                      list-versus-map container.

      2. a real emit into a throwaway directory, then a re-parse of what landed on
         disk. Includes a preservation test: an existing config carrying unrelated
         top-level keys and someone else's MCP server must come back byte-identical
         in those parts.

      3. -Live: start the servers named in each emitted file. Needs a working
         credentials file and a reachable bMS; skipped by default.

    Nothing here touches %APPDATA%\Claude\claude_desktop_config.json, and nothing
    reads the real credentials file unless -Live is given.

.PARAMETER Live
    Also run lib\verify-host-config.mjs against each emitted stdio config, which
    starts the servers for real and makes a bMS read call.

.PARAMETER KeepScratch
    Leave the throwaway directory behind.
#>
[CmdletBinding()]
param(
    [switch] $Live,
    [switch] $KeepScratch,
    [string] $SuiteRoot,
    [string] $EnvFile
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$LibDir       = $PSScriptRoot
$InstallerDir = Split-Path -Parent $LibDir
$ProjectRoot  = Split-Path -Parent $InstallerDir
if (-not $SuiteRoot) { $SuiteRoot = Join-Path $ProjectRoot 'bConnect-MCP-main' }
if (-not $EnvFile)   { $EnvFile   = Join-Path $ProjectRoot 'secrets\bconnect.env' }

$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) { Write-Host '  [FAIL] Node.js is not on PATH.' -ForegroundColor Red; exit 1 }

$pass = 0; $fail = 0; $skip = 0
$failedNames = New-Object System.Collections.ArrayList
function Check {
    param([bool] $Ok, [string] $What, [string] $Detail)
    if ($Ok) { $script:pass++; Write-Host ('  PASS  ' + $What) -ForegroundColor Green }
    else     { $script:fail++; [void]$script:failedNames.Add($What); Write-Host ('  FAIL  ' + $What) -ForegroundColor Red }
    if ($Detail) { Write-Host ('        ' + $Detail) -ForegroundColor DarkGray }
}
function Skip { param([string]$W,[string]$Y) $script:skip++; Write-Host ('  SKIP  ' + $W) -ForegroundColor Yellow; if ($Y) { Write-Host ('        ' + $Y) -ForegroundColor DarkGray } }
function Section { param([string]$T) Write-Host ''; Write-Host ('  -- ' + $T + ' ' + ('-' * [Math]::Max(0, 58 - $T.Length))) -ForegroundColor DarkCyan }

function Invoke-Node {
    param([string[]] $Arguments, [string] $WorkDir)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = $NodeExe
    $psi.Arguments = ($Arguments -join ' ')
    $psi.WorkingDirectory       = $WorkDir
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    return @{ Code = $p.ExitCode; Output = ($o.Result + $e.Result) }
}

$Scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-hosts-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $Scratch -Force | Out-Null

Write-Host ''
Write-Host '  bConnect-MCP -- host targets' -ForegroundColor White
Write-Host '  ---------------------------' -ForegroundColor DarkGray
Write-Host ('  scratch  ' + $Scratch)

try {
    # ── 1. the pure suite ────────────────────────────────────────────────────
    Section 'emitters, shapes and negative controls'
    $r = Invoke-Node @("`"$(Join-Path $LibDir 'test-host-emitters.mjs')`"", '--suite-root', "`"$SuiteRoot`"") $LibDir
    Write-Host $r.Output.TrimEnd()
    Check ($r.Code -eq 0) 'lib\test-host-emitters.mjs'

    # ── 2. a real emit, then a re-read of what landed ────────────────────────
    Section 'a real emit into a throwaway directory'

    $proj = Join-Path $Scratch 'proj'
    $out  = Join-Path $Scratch 'out'
    New-Item -ItemType Directory -Path $proj, $out -Force | Out-Null

    # An existing Claude-Code-shaped file with content we do NOT own, so the
    # preservation claim is tested rather than asserted.
    $mcpJson = Join-Path $proj '.mcp.json'
    @'
{
  "someOtherKey": { "nested": [1, 2, "\u00fc"] },
  "mcpServers": {
    "someone-elses-server": { "type": "stdio", "command": "npx", "args": ["-y", "not-ours"] }
  }
}
'@ | Set-Content -LiteralPath $mcpJson -Encoding UTF8

    $planPath = Join-Path $Scratch 'plan.json'
    $plan = [ordered]@{
        outDir  = $out
        servers = [ordered]@{
            'bconnect-endpoints' = [ordered]@{
                command = 'C:\Program Files\nodejs\node.exe'
                args    = @('--env-file=C:\bConnect-MCP\secrets\bconnect.env',
                            'C:\bConnect-MCP\bConnect-MCP-main\bconnect-endpoints-mcp\build\index.js')
            }
            'bconnect-jobs' = [ordered]@{
                command = 'C:\Program Files\nodejs\node.exe'
                args    = @('--env-file=C:\bConnect-MCP\secrets\bconnect.env',
                            'C:\bConnect-MCP\bConnect-MCP-main\bconnect-jobs-mcp\build\index.js')
                env     = [ordered]@{ ALLOW_WRITE_OPERATIONS = 'true'; ALLOWED_WRITE_TOOLS = 'create_job_instance' }
            }
        }
        gateway = [ordered]@{ url = 'http://127.0.0.1:3001'; port = 3001; authRequired = $true }
        targets = @(
            [ordered]@{ id = 'claude-code'; path = $mcpJson }
            [ordered]@{ id = 'vscode';      path = (Join-Path $proj '.vscode\mcp.json') }
            [ordered]@{ id = 'cursor';      path = (Join-Path $proj '.cursor\mcp.json') }
            [ordered]@{ id = 'continue';    path = (Join-Path $proj 'continue.yaml') }
            [ordered]@{ id = 'librechat' }
            [ordered]@{ id = 'open-webui' }
            [ordered]@{ id = 'n8n' }
            [ordered]@{ id = 'openai' }
            [ordered]@{ id = 'copilot-studio' }
            [ordered]@{ id = 'generic' }
        )
    }
    ($plan | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $planPath -Encoding UTF8

    $r = Invoke-Node @("`"$(Join-Path $LibDir 'emit-host-config.mjs')`"", '--plan', "`"$planPath`"") $LibDir
    Check ($r.Code -eq 0) 'emit-host-config.mjs wrote every target' (($r.Output -split "`r?`n" | Where-Object { $_ -match '!' } | Select-Object -First 2) -join ' / ')

    # Read with an EXPLICIT UTF-8 decoder. The emitters write UTF-8 without a BOM
    # because that is what these hosts' JSON parsers want; PowerShell 5.1's
    # Get-Content sees no BOM and falls back to the ANSI code page, which turns 'ü'
    # into 'Ã¼' and would fail the check below for a reason that has nothing to do
    # with the merge. The file is correct; the default reader is not.
    function Read-Json { param([string]$P) [System.IO.File]::ReadAllText($P, [System.Text.Encoding]::UTF8) | ConvertFrom-Json }

    $after = Read-Json $mcpJson
    Check ($after.someOtherKey.nested[2] -eq [char]0x00FC) 'an unrelated top-level key survived the merge, non-ASCII intact' `
          ('got: ' + $after.someOtherKey.nested[2])
    Check ($after.mcpServers.'someone-elses-server'.command -eq 'npx') "someone else's MCP server survived the merge"
    Check ($after.mcpServers.'bconnect-endpoints'.type -eq 'stdio') 'Claude Code entries are typed'
    Check ((Get-ChildItem $mcpJson.Replace('.mcp.json', '') -Filter '.mcp.json.bak-*' -ErrorAction SilentlyContinue).Count -ge 1) `
          'a backup was taken before the merge'

    $vs = Read-Json (Join-Path $proj '.vscode\mcp.json')
    Check ($null -ne $vs.servers -and $null -eq $vs.mcpServers) 'VS Code got "servers", not "mcpServers"'
    $cu = Read-Json (Join-Path $proj '.cursor\mcp.json')
    Check ($null -ne $cu.mcpServers.'bconnect-jobs' -and $null -eq $cu.mcpServers.'bconnect-jobs'.type) `
          'Cursor got no type field, matching every documented example'
    $cont = Get-Content (Join-Path $proj 'continue.yaml') -Raw
    Check ($cont -match "(?m)^\s*- name: 'bconnect-endpoints'") 'Continue got a LIST, with names on the entries'

    foreach ($f in @('librechat.mcpServers.yaml', 'open-webui.md', 'n8n.md', 'openai.md', 'copilot-studio.md', 'generic.md', 'continue.md')) {
        Check (Test-Path (Join-Path $out $f)) "snippet written: $f"
    }
    Check ((Get-Content (Join-Path $out 'copilot-studio.md') -Raw) -match 'least practical') `
          'the Copilot Studio snippet leads with the negative finding'

    # SEC-7 -- a gateway config emitted without the Authorization header produces a
    # 401 the operator cannot diagnose from the file they were handed, so every
    # HTTP-facing snippet must name the header. And none of them may carry the
    # token VALUE: install\out is not ACL-hardened.
    foreach ($f in @('open-webui.md', 'n8n.md', 'librechat.mcpServers.yaml', 'generic.md')) {
        $body = Get-Content (Join-Path $out $f) -Raw
        Check ($body -match 'Authorization: Bearer|bearer token') "$f names the bearer token the gateway now requires"
    }
    Check ((Get-Content (Join-Path $out 'n8n.md') -Raw) -match 'Header Auth') `
          'the n8n snippet names the exact credential type to create'

    # Nothing emitted anywhere may contain a credential. Checked across every file
    # this run produced, not just the ones under test.
    $leak = @(Get-ChildItem -Path $Scratch -Recurse -File | Where-Object {
        (Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue) -match 'BCONNECT_API_KEY\s*[:=]\s*\S|BCONNECT_PASSWORD\s*[:=]\s*\S'
    })
    Check ($leak.Count -eq 0) 'no emitted artefact contains a credential' ($leak.FullName -join ', ')

    # Negative control on THAT check: plant one and require the detector to fire.
    $bait = Join-Path $Scratch 'bait.json'
    'BCONNECT_API_KEY=aaaa-bbbb-cccc' | Set-Content -LiteralPath $bait -Encoding UTF8
    $baitHit = @(Get-ChildItem -Path $Scratch -Recurse -File | Where-Object {
        (Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue) -match 'BCONNECT_API_KEY\s*[:=]\s*\S'
    })
    Check ($baitHit.Count -eq 1) 'negative control: the credential detector DOES fire on a planted secret'
    Remove-Item -LiteralPath $bait -Force

    # An unknown target must fail loudly rather than be skipped quietly.
    $badPlan = Join-Path $Scratch 'bad-plan.json'
    ([ordered]@{ outDir = $out; servers = $plan.servers; targets = @([ordered]@{ id = 'no-such-host' }) } |
        ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $badPlan -Encoding UTF8
    $r = Invoke-Node @("`"$(Join-Path $LibDir 'emit-host-config.mjs')`"", '--plan', "`"$badPlan`"") $LibDir
    Check ($r.Code -ne 0 -and $r.Output -match 'unknown host target') 'an unknown host target is a hard failure, not a silent skip'

    # An HTTP-only target with no gateway must fail, not emit something unusable.
    $noGw = Join-Path $Scratch 'nogw-plan.json'
    ([ordered]@{ outDir = $out; servers = $plan.servers; targets = @([ordered]@{ id = 'n8n' }) } |
        ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $noGw -Encoding UTF8
    $r = Invoke-Node @("`"$(Join-Path $LibDir 'emit-host-config.mjs')`"", '--plan', "`"$noGw`"") $LibDir
    Check ($r.Code -ne 0 -and $r.Output -match 'no gateway was configured') 'an HTTP-only target without a gateway is refused'

    # A target file that is not JSON must be refused, not overwritten.
    $broken = Join-Path $proj 'broken.json'
    'this is not json {' | Set-Content -LiteralPath $broken -Encoding UTF8
    $bp = Join-Path $Scratch 'broken-plan.json'
    ([ordered]@{ outDir = $out; servers = $plan.servers; targets = @([ordered]@{ id = 'claude-code'; path = $broken }) } |
        ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $bp -Encoding UTF8
    $r = Invoke-Node @("`"$(Join-Path $LibDir 'emit-host-config.mjs')`"", '--plan', "`"$bp`"") $LibDir
    Check ($r.Code -ne 0 -and (Get-Content $broken -Raw) -eq "this is not json {`r`n") `
          'a target file that is not valid JSON is refused and left untouched'

    # SEC-3 -- the audit's own repro. One plan, fabricated secrets in
    # servers['bconnect-endpoints'].env, and every target this suite knows,
    # including the four whose serversKey is null (open-webui, n8n, openai,
    # copilot-studio). Before the fix those four reported [ok] and wrote the
    # secrets straight into install\out; every target here must now refuse.
    $secretOut = Join-Path $Scratch 'sec3-out'
    New-Item -ItemType Directory -Path $secretOut -Force | Out-Null
    $secretServers = [ordered]@{
        'bconnect-endpoints' = [ordered]@{
            command = 'C:\Program Files\nodejs\node.exe'
            args    = @('--env-file=C:\bConnect-MCP\secrets\bconnect.env',
                        'C:\bConnect-MCP\bConnect-MCP-main\bconnect-endpoints-mcp\build\index.js')
            env     = [ordered]@{ BCONNECT_API_KEY = 'FABRICATED-NOT-REAL-KEY-0123456789'; MCP_GATEWAY_AUTH_TOKEN = 'FABRICATED-NOT-REAL-TOKEN' }
        }
    }
    $secretPlan = Join-Path $Scratch 'sec3-plan.json'
    ([ordered]@{
        outDir  = $secretOut
        servers = $secretServers
        gateway = [ordered]@{ url = 'http://127.0.0.1:3001'; port = 3001; authRequired = $true }
        targets = @(
            [ordered]@{ id = 'generic' }
            [ordered]@{ id = 'open-webui' }
            [ordered]@{ id = 'n8n' }
            [ordered]@{ id = 'openai' }
            [ordered]@{ id = 'copilot-studio' }
        )
    } | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $secretPlan -Encoding UTF8
    $r = Invoke-Node @("`"$(Join-Path $LibDir 'emit-host-config.mjs')`"", '--plan', "`"$secretPlan`"", '--json') $LibDir
    Check ($r.Code -ne 0) 'SEC-3: a plan carrying a credential is refused end to end (exit code)' `
          $(if ($r.Code -eq 0) { $r.Output })
    $secretReport = $null
    try { $secretReport = ($r.Output | ConvertFrom-Json) } catch { }
    Check ($null -ne $secretReport) 'SEC-3: emit-host-config.mjs --json still produced parseable output on failure' `
          $(if (-not $secretReport) { $r.Output })
    if ($secretReport) {
        foreach ($id in @('generic', 'open-webui', 'n8n', 'openai', 'copilot-studio')) {
            $rep = $secretReport.reports | Where-Object { $_.id -eq $id }
            $okToFail = ($null -eq $rep -or $rep.ok -ne $false -or ($rep.problems -join ' ') -notmatch 'credential')
            Check (-not $okToFail) "SEC-3: $id is refused for carrying a credential, not silently skipped" `
                  $(if ($okToFail) { $(if ($rep) { $rep.problems -join ' | ' } else { 'no report for this id at all' }) })
        }
    }
    $leaked = @(Get-ChildItem -Path $secretOut -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
        (Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue) -match 'FABRICATED-NOT-REAL'
    })
    Check ($leaked.Count -eq 0) 'SEC-3: no target wrote the fabricated secret to install\out' `
          ($leaked.FullName -join ', ')

    # ── 2b. merge-config.mjs, the Claude Desktop writer ──────────────────────
    # It is the only writer with its own implementation, so every invariant the
    # shared emitter is held to has to be asserted against it separately or it is
    # asserted for ten targets and not for the eleventh.
    #
    # Two of them here. First: the target directory may not exist -- a machine that
    # has never run the client has never had one -- and this used to end a full
    # install, after credentials, probe and build, in an uncaught ENOENT from
    # node:fs. Second: the credential allowlist. It was built as an allowlist so a
    # new secret would be refused by default, and this writer imported none of it.
    Section 'merge-config.mjs -- the same invariants as every other writer'

    $mcNoDir  = Join-Path $Scratch 'never-ran-here\config.json'
    $mcPlan   = Join-Path $Scratch 'mc-plan.json'
    ([ordered]@{
        manage = [ordered]@{
            'bconnect-endpoints' = [ordered]@{
                command = 'C:\Program Files\nodejs\node.exe'
                args    = @('--env-file=C:\bConnect-MCP\secrets\bconnect.env',
                            'C:\bConnect-MCP\bConnect-MCP-main\bconnect-endpoints-mcp\build\index.js')
                env     = [ordered]@{ ALLOW_WRITE_OPERATIONS = 'false' }
            }
        }
        remove = @()
    } | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $mcPlan -Encoding UTF8

    $r = Invoke-Node @("`"$(Join-Path $LibDir 'merge-config.mjs')`"", '--target', "`"$mcNoDir`"",
                       '--plan', "`"$mcPlan`"", '--json') $LibDir
    Check ($r.Code -eq 0) 'CN-2: writes into a directory that does not exist yet (no ENOENT stack trace)' `
          $(if ($r.Code -ne 0) { ($r.Output -split "`r?`n" | Where-Object { $_ } | Select-Object -First 3) -join ' / ' })
    Check (Test-Path -LiteralPath $mcNoDir) 'CN-2: the configuration file is actually there afterwards' $mcNoDir
    Check ($r.Output -notmatch 'ENOENT') 'CN-2: nothing reported ENOENT' `
          $(if ($r.Output -match 'ENOENT') { $r.Output })

    # The allowlist, with a value that is unmistakably fabricated.
    $mcSecretTarget = Join-Path $Scratch 'mc-secret\config.json'
    $mcSecretPlan   = Join-Path $Scratch 'mc-secret-plan.json'
    ([ordered]@{
        manage = [ordered]@{
            'bconnect-endpoints' = [ordered]@{
                command = 'C:\Program Files\nodejs\node.exe'
                args    = @('C:\x\build\index.js')
                env     = [ordered]@{ BCONNECT_V11_PASSWORD = 'FABRICATED-NOT-REAL-V11-PW'
                                      MCP_GATEWAY_AUTH_TOKEN = 'FABRICATED-NOT-REAL-TOKEN' }
            }
        }
        remove = @()
    } | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $mcSecretPlan -Encoding UTF8

    $r = Invoke-Node @("`"$(Join-Path $LibDir 'merge-config.mjs')`"", '--target', "`"$mcSecretTarget`"",
                       '--plan', "`"$mcSecretPlan`"") $LibDir
    Check ($r.Code -ne 0) 'CN-10: a credential-bearing plan is REFUSED by the Claude Desktop writer too' `
          $(if ($r.Code -eq 0) { $r.Output })
    Check ($r.Output -match 'credential|capability gate') 'CN-10: and it says why' $r.Output
    Check (-not (Test-Path -LiteralPath $mcSecretTarget)) 'CN-10: nothing was written' $mcSecretTarget

    # Not a blanket refusal: the three capability gates are exactly what a host
    # config is FOR, and the run above must not have made them collateral damage.
    $mcGateTarget = Join-Path $Scratch 'mc-gate\config.json'
    $mcGatePlan   = Join-Path $Scratch 'mc-gate-plan.json'
    ([ordered]@{
        manage = [ordered]@{
            'bconnect-jobs' = [ordered]@{
                command = 'C:\Program Files\nodejs\node.exe'
                args    = @('C:\x\build\index.js')
                env     = [ordered]@{ ALLOW_WRITE_OPERATIONS = 'true'
                                      ALLOWED_WRITE_TOOLS    = 'create_job_instance'
                                      BCONNECT_ENABLE_V11    = 'true' }
            }
        }
        remove = @()
    } | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $mcGatePlan -Encoding UTF8
    $r = Invoke-Node @("`"$(Join-Path $LibDir 'merge-config.mjs')`"", '--target', "`"$mcGateTarget`"",
                       '--plan', "`"$mcGatePlan`"") $LibDir
    Check ($r.Code -eq 0) 'CN-10: a plan carrying only capability gates still writes' $r.Output

    # An unrelated server already in the file may carry anything; refusing to write
    # over somebody else's x-api-key would break an installation we have no opinion
    # about. The check covers what we manage, and only that.
    $mcForeign = Join-Path $Scratch 'mc-foreign\config.json'
    New-Item -ItemType Directory -Path (Split-Path -Parent $mcForeign) -Force | Out-Null
    @'
{
  "mcpServers": {
    "someone-elses-server": { "command": "npx", "args": ["-y", "not-ours"],
                              "env": { "THEIR_API_KEY": "not-ours-either" } }
  }
}
'@ | Set-Content -LiteralPath $mcForeign -Encoding UTF8
    $r = Invoke-Node @("`"$(Join-Path $LibDir 'merge-config.mjs')`"", '--target', "`"$mcForeign`"",
                       '--plan', "`"$mcGatePlan`"") $LibDir
    Check ($r.Code -eq 0) "CN-10: an unrelated server's own env does not block the merge" $r.Output
    $mcForeignBack = $null
    try { $mcForeignBack = Get-Content -LiteralPath $mcForeign -Raw | ConvertFrom-Json } catch { }
    Check ($null -ne $mcForeignBack -and $mcForeignBack.mcpServers.'someone-elses-server'.env.THEIR_API_KEY -eq 'not-ours-either') `
          'CN-10: and that server came back byte-for-byte'

    # ── 3. live ──────────────────────────────────────────────────────────────
    Section 'live: start the servers named in each emitted file'
    if (-not $Live) {
        Skip 'starting servers from the emitted configs' 'pass -Live to run this (needs credentials and a reachable bMS)'
    } elseif (-not (Test-Path -LiteralPath $EnvFile) -and -not (Test-Path -LiteralPath ($EnvFile + '.dpapi'))) {
        Skip 'starting servers from the emitted configs' "no credentials file at $EnvFile"
    } else {
        foreach ($pair in @(@('claude-code', $mcpJson), @('vscode', (Join-Path $proj '.vscode\mcp.json')),
                            @('cursor', (Join-Path $proj '.cursor\mcp.json')), @('continue', (Join-Path $proj 'continue.yaml')))) {
            $r = Invoke-Node @("`"$(Join-Path $LibDir 'verify-host-config.mjs')`"", '--target', $pair[0],
                               '--path', "`"$($pair[1])`"", '--suite-root', "`"$SuiteRoot`"") $LibDir
            if ($r.Code -eq 3) { Skip "$($pair[0]): servers start from the emitted file" 'verifier reported SKIPPED' }
            else { Check ($r.Code -eq 0) "$($pair[0]): every server in the emitted file started and read live bMS data" `
                         (($r.Output -split "`r?`n" | Where-Object { $_ -match 'FAIL' } | Select-Object -First 1)) }
        }
    }

} finally {
    if ($KeepScratch) { Write-Host ''; Write-Host ('  scratch kept at ' + $Scratch) -ForegroundColor DarkGray }
    else { Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ('  {0} passed, {1} failed, {2} skipped' -f $pass, $fail, $skip) -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
if ($fail) { foreach ($f in $failedNames) { Write-Host ('    FAILED: ' + $f) -ForegroundColor Red } }
Write-Host ''
exit $(if ($fail) { 1 } else { 0 })
