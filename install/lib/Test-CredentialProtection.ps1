<#
.SYNOPSIS
    Tests for the opt-in DPAPI credential protection and the launcher shim.

.DESCRIPTION
    Runs entirely against a throwaway directory with a FABRICATED secret. It never
    reads, writes or touches the real credentials file.

    Three of these tests matter more than the rest:

      * Test 1 is a NEGATIVE CONTROL. The whole suite leans on one detector --
        "does this text contain the secret?" -- and a detector that has never been
        seen to fire proves nothing when it stays silent. So it is pointed at a
        plaintext file containing the secret first, and must find it.

      * Test 9 reads the CHILD PROCESS'S REAL COMMAND LINE out of Win32_Process
        while it is running, and asserts the secret is not in it. Not the command
        line this script built -- the one the kernel recorded. With its own negative
        control (test 10), because the same reasoning applies.

      * Test 12 asserts the shim contributes NOTHING to stdout. stdout is the MCP
        transport; one stray character from a PowerShell banner, a Write-Host or a
        profile makes the JSON-RPC stream unparseable and Claude Desktop reports only
        "server disconnected".

.EXAMPLE
    .\Test-CredentialProtection.ps1
#>
[CmdletBinding()]
param([string] $WorkDir)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Secrets.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'Dpapi.psm1')   -Force -DisableNameChecking

if (-not $WorkDir) {
    $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-dpapi-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
}

$script:Pass = 0
$script:Fail = 0
$script:Skip = 0
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}
function Skip {
    param([string] $Name, [string] $Why)
    $script:Skip++
    Write-Host ("  SKIP  " + $Name) -ForegroundColor Yellow
    Write-Host ("        " + $Why) -ForegroundColor DarkGray
}

# A fabricated credential. Distinctive enough that a substring search for it cannot
# match by accident, and obviously not a real key to anyone reading a log.
$SECRET   = 'FABRICATED-Kx7Qm2vR9-not-a-real-bconnect-key'
$BASEURL  = 'https://bms.test.invalid/bconnect'
$ENV_TEXT = @"
# fabricated test credentials
BCONNECT_BASE_URL=$BASEURL
BCONNECT_API_KEY=$SECRET
BCONNECT_SKIP_CONNECTIVITY_CHECK=true
MCP_TRANSPORT=stdio
"@ -replace "`r?`n", "`r`n"

function Get-Sha16([string] $s) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s))) -replace '-', '').ToLower().Substring(0, 16) }
    finally { $sha.Dispose() }
}
$SECRET_SHA = Get-Sha16 $SECRET

Write-Host ''
Write-Host "Credential protection tests -- scratch directory: $WorkDir" -ForegroundColor Cyan
Write-Host ''

New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
$startTime = Get-Date

try {
    # ── 1. NEGATIVE CONTROL: the leak detector fires on real plaintext ──────────
    $plainProbe = Join-Path $WorkDir 'plain-probe.env'
    [System.IO.File]::WriteAllText($plainProbe, $ENV_TEXT)
    Check 'NEGATIVE CONTROL: the leak detector FINDS the secret in a plaintext file' `
          (Test-TextContainsSecret -Text (Get-Content -LiteralPath $plainProbe -Raw) -Secret $SECRET) `
          'if this fails, every "no leak" result below is meaningless'

    Check 'NEGATIVE CONTROL: the detector also catches a base64-encoded copy' `
          (Test-TextContainsSecret -Text ('junk ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($SECRET)) + ' junk') -Secret $SECRET)

    Check 'the detector stays quiet on text that does not contain it' `
          (-not (Test-TextContainsSecret -Text 'BCONNECT_BASE_URL=https://x/bconnect' -Secret $SECRET))

    # ── 2. The protected container does not contain the secret ─────────────────
    $container = New-ProtectedEnvContent -EnvText $ENV_TEXT
    Check 'the DPAPI container does NOT contain the secret in any obvious encoding' `
          (-not (Test-TextContainsSecret -Text $container -Secret $SECRET))
    Check 'the container does not leak the base URL either' `
          (-not (Test-TextContainsSecret -Text $container -Secret $BASEURL))

    # ── 3. Round trip is byte-exact ────────────────────────────────────────────
    $protFile = Join-Path $WorkDir 'roundtrip.env.dpapi'
    [System.IO.File]::WriteAllText($protFile, $container, (New-Object Text.UTF8Encoding($false)))
    $back = Read-ProtectedEnvContent -Path $protFile
    Check 'protect -> unprotect returns the original text byte for byte' ($back -ceq $ENV_TEXT) `
          ("in $($ENV_TEXT.Length) chars, out $($back.Length) chars")

    # ── 4. Entropy is actually applied ─────────────────────────────────────────
    # If entropy were ignored, the blob would decrypt with a different one -- and the
    # claim "another application calling DPAPI generically cannot read this" would be
    # false. So: same user, same machine, WRONG entropy must fail.
    $b64 = ($container -split "`r?`n" | Where-Object { $_ -like 'BCONNECT_PROTECTED_DATA=*' }) -replace '^BCONNECT_PROTECTED_DATA=', ''
    $cipher = [Convert]::FromBase64String($b64)
    $wrongEntropyFailed = $false
    try {
        [void][System.Security.Cryptography.ProtectedData]::Unprotect(
            $cipher, [byte[]](1..32), [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    } catch [System.Security.Cryptography.CryptographicException] { $wrongEntropyFailed = $true }
    Check 'the same user with the WRONG entropy cannot decrypt it (entropy is in force)' $wrongEntropyFailed

    $noEntropyFailed = $false
    try {
        [void][System.Security.Cryptography.ProtectedData]::Unprotect(
            $cipher, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    } catch [System.Security.Cryptography.CryptographicException] { $noEntropyFailed = $true }
    Check 'a generic DPAPI call with NO entropy cannot decrypt it' $noEntropyFailed

    # ── 5. Tampering is detected, and the error explains itself ────────────────
    # Flip a character in the MIDDLE of the ciphertext. Flipping the first one is not a
    # test: a DPAPI blob starts with a version field of 0x01, so its base64 already
    # begins 'AQAAA...' and "replace the first character with A" is a no-op that
    # decrypts perfectly and looks like a pass. (Found by this test failing.)
    $mid = [int]($b64.Length / 2)
    $flip = $(if ($b64[$mid] -eq 'A') { 'B' } else { 'A' })
    $tampered = $container -replace [regex]::Escape($b64), ($b64.Remove($mid, 1).Insert($mid, $flip))
    $tamperFile = Join-Path $WorkDir 'tampered.env.dpapi'
    [System.IO.File]::WriteAllText($tamperFile, $tampered)
    $tamperMsg = ''
    try { [void](Read-ProtectedEnvContent -Path $tamperFile) } catch { $tamperMsg = $_.Exception.Message }
    Check 'a tampered container fails loudly rather than returning garbage' ($tamperMsg -ne '')
    Check 'the failure names the account and the way out, not just "bad data"' `
          ($tamperMsg -match 'CurrentUser|account|plaintext') $tamperMsg.Substring(0, [Math]::Min(140, $tamperMsg.Length))

    # ── 6. The container is KEY=value shaped, so a misdirected --env-file is loud ─
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        # Single quotes inside the JS, not double. PowerShell strips double quotes when
        # it builds a native command line, and the expression then fails to parse --
        # the same trap Test-Secrets.ps1 documents for the '|' character.
        $js = "process.stdout.write([process.env.BCONNECT_API_KEY===undefined?'absent':'PRESENT',process.env.BCONNECT_PROTECTED_V||'none'].join(String.fromCharCode(124)))"
        $out = & $node.Source "--env-file=$protFile" '-e' $js
        Check 'pointing node --env-file at the container yields NO credentials (fails loud, not silent)' `
              ($out -eq 'absent|1') "node saw: $out"
    } else {
        Skip 'node --env-file behaviour on the container' 'node is not on PATH'
    }

    # ── 7. The store keeps exactly one form on disk, in both directions ────────
    $store = Join-Path $WorkDir 'store'
    Set-HardenedDirectoryAcl -Path $store
    $envPath = Join-Path $store 'bconnect.env'

    [void](Write-BConnectEnvStore -EnvFile $envPath -Content $ENV_TEXT)               # plaintext
    $s1 = Get-CredentialStoreState -EnvFile $envPath
    Check 'writing plaintext leaves exactly the plaintext file' `
          ($s1.Mode -eq 'plaintext' -and $s1.HasPlaintext -and -not $s1.HasProtected)

    [void](Write-BConnectEnvStore -EnvFile $envPath -Content (Read-BConnectEnvText -EnvFile $envPath) -Protected)
    $s2 = Get-CredentialStoreState -EnvFile $envPath
    Check 'converting to protected removes the plaintext file' `
          ($s2.Mode -eq 'protected' -and $s2.HasProtected -and -not $s2.HasPlaintext)
    Check 'no file left in the secrets directory contains the secret' `
          (-not (@(Get-ChildItem -LiteralPath $store -Force -File | Where-Object {
                     Test-TextContainsSecret -Text ([System.IO.File]::ReadAllText($_.FullName)) -Secret $SECRET }).Count))

    [void](Write-BConnectEnvStore -EnvFile $envPath -Content (Read-BConnectEnvText -EnvFile $envPath))
    $s3 = Get-CredentialStoreState -EnvFile $envPath
    Check 'converting back to plaintext removes the protected file (the way back works)' `
          ($s3.Mode -eq 'plaintext' -and $s3.HasPlaintext -and -not $s3.HasProtected)
    Check 'the credentials survived both conversions unchanged' `
          ((Read-BConnectEnvMap -EnvFile $envPath)['BCONNECT_API_KEY'] -ceq $SECRET)

    # ── 8. The protected file inherits the hardened directory ACL ──────────────
    [void](Write-BConnectEnvStore -EnvFile $envPath -Content $ENV_TEXT -Protected)
    $aceOffenders = Get-BroadAccessAce -Path (Get-ProtectedEnvPath -PlainEnvPath $envPath)
    Check 'the protected file has no Users/Everyone ACE either' ($aceOffenders.Count -eq 0) ($aceOffenders -join '; ')

    # ── 9-13. The launcher shim ────────────────────────────────────────────────
    if (-not $node) {
        Skip 'launcher shim tests' 'node is not on PATH'
    } else {
        # A stand-in server. It reports HASHES of what reached its environment, never
        # the values, so this test can be run with its output on screen.
        $childPath = Join-Path $WorkDir 'probe-server.js'
        @'
const crypto = require('crypto');
const h = (v) => v === undefined ? 'MISSING' : crypto.createHash('sha256').update(v).digest('hex').slice(0,16);
process.stdout.write(JSON.stringify({
  base: process.env.BCONNECT_BASE_URL || 'MISSING',
  keyHash: h(process.env.BCONNECT_API_KEY),
  skip: process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK || 'MISSING',
  passthrough: process.env.ALLOW_WRITE_OPERATIONS || 'unset',
  argv: process.argv.slice(1)
}));
'@ | Set-Content -LiteralPath $childPath -Encoding ASCII

        $sleeperPath = Join-Path $WorkDir 'probe-sleeper.js'
        'process.stdin.resume(); setInterval(()=>{},1000);' | Set-Content -LiteralPath $sleeperPath -Encoding ASCII

        $shim = Get-ShimPath
        $pwsh = Get-PowerShellExePath

        function Invoke-Shim {
            param([string] $EnvPath, [string] $Child, [hashtable] $ExtraEnv)
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName  = $pwsh
            $psi.Arguments = ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -EnvFile "{1}" -NodeExe "{2}" -ServerScript "{3}"' -f
                              $shim, $EnvPath, $node.Source, $Child)
            $psi.UseShellExecute        = $false
            $psi.RedirectStandardOutput = $true
            $psi.RedirectStandardError  = $true
            if ($ExtraEnv) { foreach ($k in $ExtraEnv.Keys) { $psi.EnvironmentVariables[$k] = $ExtraEnv[$k] } }
            $p = [System.Diagnostics.Process]::Start($psi)
            $o = $p.StandardOutput.ReadToEnd()
            $e = $p.StandardError.ReadToEnd()
            $p.WaitForExit()
            return @{ Out = $o; Err = $e; Code = $p.ExitCode }
        }

        $protStore = Get-ProtectedEnvPath -PlainEnvPath $envPath
        $r = Invoke-Shim -EnvPath $protStore -Child $childPath -ExtraEnv @{ ALLOW_WRITE_OPERATIONS = 'true' }
        $j = $null
        try { $j = $r.Out | ConvertFrom-Json } catch { }

        Check 'the shim decrypts a protected file and starts the child (exit 0)' ($r.Code -eq 0) `
              ("exit $($r.Code); stderr: " + $r.Err.Trim())
        Check 'the child received the decrypted API key, byte-exact (SHA-256 match)' `
              ($j -and $j.keyHash -eq $SECRET_SHA) ("expected $SECRET_SHA, child reported " + $(if ($j) { $j.keyHash } else { '(no JSON)' }))
        Check 'the child received the decrypted base URL' ($j -and $j.base -eq $BASEURL)
        Check 'the per-server env block from Claude Desktop reaches the child too' `
              ($j -and $j.passthrough -eq 'true') 'ALLOW_WRITE_OPERATIONS must survive the extra process hop'
        Check "the child's argv is the server path and nothing else" `
              ($j -and @($j.argv).Count -eq 1) ("argv: " + $(if ($j) { (@($j.argv) -join ' ') } else { '?' }))

        # 12. stdout hygiene: the shim must add nothing of its own. The child emits one
        # JSON object and no newline, so anything before '{' or after '}' came from
        # PowerShell -- a banner, a profile, a stray Write-Host -- and would corrupt
        # the JSON-RPC stream in the real thing.
        Check 'the shim writes NOTHING to stdout -- the child owns the MCP stream' `
              ($r.Out.StartsWith('{') -and $r.Out.EndsWith('}')) `
              ('stdout was ' + $r.Out.Length + ' bytes, all of it the child''s')
        Check 'no secret in the shim stdout or stderr' `
              (-not (Test-TextContainsSecret -Text ($r.Out + $r.Err) -Secret $SECRET))

        # 9/10. The child's REAL command line, read from the OS, plus its control.
        $psi2 = New-Object System.Diagnostics.ProcessStartInfo
        $psi2.FileName  = $pwsh
        $psi2.Arguments = ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -EnvFile "{1}" -NodeExe "{2}" -ServerScript "{3}"' -f
                           $shim, $protStore, $node.Source, $sleeperPath)
        $psi2.UseShellExecute        = $false
        $psi2.RedirectStandardInput  = $true
        $psi2.RedirectStandardOutput = $true
        $psi2.RedirectStandardError  = $true
        $shimProc = [System.Diagnostics.Process]::Start($psi2)
        try {
            # Filter on node.exe. The shim's Add-Type call briefly spawns csc.exe as a
            # child too, and taking "the first child" grabbed the COMPILER -- whose
            # command line of course contains no secret and which has already exited by
            # the time the kill test runs. Both checks then passed for entirely the
            # wrong reason. (Found by reading the printed command line, not by the
            # assertion, which is the point of printing it.)
            $deadline = (Get-Date).AddSeconds(30)
            $child = $null
            while (-not $child -and (Get-Date) -lt $deadline) {
                $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($shimProc.Id) AND Name='node.exe'" -ErrorAction SilentlyContinue |
                         Select-Object -First 1
                if (-not $child) { Start-Sleep -Milliseconds 200 }
            }
            if (-not $child) {
                Check "the shim's node.exe child appeared so its command line can be read" $false 'no node.exe child within 30s'
            } else {
                Check "the OS-recorded command line of the CHILD carries no secret" `
                      (-not (Test-TextContainsSecret -Text $child.CommandLine -Secret $SECRET)) $child.CommandLine
                $shimCl = (Get-CimInstance Win32_Process -Filter "ProcessId=$($shimProc.Id)").CommandLine
                Check "the OS-recorded command line of the SHIM carries no secret" `
                      (-not (Test-TextContainsSecret -Text $shimCl -Secret $SECRET))
                Check 'NEGATIVE CONTROL: the command-line check DOES fire when a secret is present' `
                      (Test-TextContainsSecret -Text ($child.CommandLine + ' --api-key=' + $SECRET) -Secret $SECRET) `
                      'proves the two checks above are not passing because the check is broken'

                # 11. Kill the shim outright: the job object must take the child with it.
                $childPid = $child.ProcessId
                $shimProc.Kill(); $shimProc.WaitForExit()
                Start-Sleep -Milliseconds 1200
                $still = Get-Process -Id $childPid -ErrorAction SilentlyContinue
                Check 'killing the shim kills the server too (no orphan holding a decrypted key)' `
                      (-not $still) 'JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE'
                if ($still) { $still | Stop-Process -Force -ErrorAction SilentlyContinue }
            }
        } finally {
            if (-not $shimProc.HasExited) { try { $shimProc.Kill() } catch { } }
        }

        # 11b. The RACE. Kill the shim without waiting for the child, so the kill lands
        # somewhere unpredictable -- possibly in the window between node existing and
        # node being protected. An early version assigned the CHILD to the job after
        # starting it, and that window really did strand a node.exe. The shim now joins
        # the job itself before starting anything, so the child is born inside it.
        $orphans = 0
        for ($i = 0; $i -lt 6; $i++) {
            $psi3 = New-Object System.Diagnostics.ProcessStartInfo
            $psi3.FileName  = $pwsh
            $psi3.Arguments = ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -EnvFile "{1}" -NodeExe "{2}" -ServerScript "{3}"' -f
                               $shim, $protStore, $node.Source, $sleeperPath)
            $psi3.UseShellExecute = $false
            $psi3.RedirectStandardInput = $true; $psi3.RedirectStandardOutput = $true; $psi3.RedirectStandardError = $true
            $sp3 = [System.Diagnostics.Process]::Start($psi3)
            # Vary the moment of the kill across the interesting range.
            Start-Sleep -Milliseconds (500 + $i * 250)
            try { $sp3.Kill() } catch { }
            $sp3.WaitForExit()
            Start-Sleep -Milliseconds 900
            $orphans += @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
                          Where-Object { $_.CommandLine -and $_.CommandLine.Contains($sleeperPath) }).Count
        }
        Check 'killing the shim at any moment after launch leaves no orphaned server' ($orphans -eq 0) `
              ("$orphans orphan(s) across 6 kills timed 500-1750 ms after start")
        if ($orphans) {
            Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -and $_.CommandLine.Contains($sleeperPath) } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        }

        # 13. Nothing decrypted was written to disk anywhere we can see.
        $suspects = @()
        foreach ($dir in @($WorkDir, $store, ([System.IO.Path]::GetTempPath()))) {
            if (-not (Test-Path -LiteralPath $dir)) { continue }
            foreach ($f in (Get-ChildItem -LiteralPath $dir -Force -File -ErrorAction SilentlyContinue |
                            Where-Object { $_.LastWriteTime -ge $startTime -and $_.Length -lt 2MB })) {
                if ($f.FullName -eq $plainProbe -or $f.FullName -eq (Join-Path $store 'bconnect.env')) { continue }
                try {
                    if (Test-TextContainsSecret -Text ([System.IO.File]::ReadAllText($f.FullName)) -Secret $SECRET) { $suspects += $f.FullName }
                } catch { }
            }
        }
        Check 'the shim left no file on disk containing the decrypted secret' ($suspects.Count -eq 0) ($suspects -join '; ')

        # The plaintext branch: the shim can front an unprotected file too, which is
        # how the live-bMS half of this feature is exercised without protecting the
        # real credentials file.
        [void](Write-BConnectEnvStore -EnvFile $envPath -Content $ENV_TEXT)
        $r2 = Invoke-Shim -EnvPath $envPath -Child $childPath
        $j2 = $null
        try { $j2 = $r2.Out | ConvertFrom-Json } catch { }
        Check 'the shim also fronts a PLAINTEXT env file (same env, no decrypt step)' `
              ($r2.Code -eq 0 -and $j2 -and $j2.keyHash -eq $SECRET_SHA) ("exit $($r2.Code)")
    }

    # ── 14. The launch entry the installer writes ──────────────────────────────
    $plainEntry = New-ServerLaunchEntry -NodeExe 'C:\node\node.exe' -ServerScript 'C:\s\build\index.js' -EnvFile 'C:\sec\bconnect.env'
    Check 'the plaintext launch entry is unchanged: node --env-file <server>' `
          ($plainEntry.command -eq 'C:\node\node.exe' -and $plainEntry.args[0] -eq '--env-file=C:\sec\bconnect.env' -and $plainEntry.args[1] -eq 'C:\s\build\index.js')

    $protEntry = New-ServerLaunchEntry -NodeExe 'C:\node\node.exe' -ServerScript 'C:\s\build\index.js' -EnvFile 'C:\sec\bconnect.env' -Protected `
                                       -Env ([ordered]@{ ALLOW_WRITE_OPERATIONS = 'true' })
    Check 'the protected launch entry runs the shim, with -NoProfile' `
          ($protEntry.command -like '*powershell.exe' -and ($protEntry.args -contains '-NoProfile') -and ($protEntry.args -contains '-NonInteractive'))
    Check 'the protected entry points at the .dpapi file, not the plaintext one' `
          (($protEntry.args -join ' ') -like '*bconnect.env.dpapi*')
    Check 'the protected entry still carries the build\index.js argument (verify-install.mjs needs it)' `
          (@($protEntry.args | Where-Object { $_ -match 'build[\\/]index\.js$' }).Count -eq 1) `
          'that argument is how the verifier locates the suite root'
    Check 'the per-server env block survives into the protected entry' `
          ($protEntry.env.ALLOW_WRITE_OPERATIONS -eq 'true')
    Check 'no credential appears anywhere in either launch entry' `
          (-not (Test-TextContainsSecret -Text (($plainEntry | ConvertTo-Json -Depth 5) + ($protEntry | ConvertTo-Json -Depth 5)) -Secret $SECRET))

    # ── 15. The shared env parser ──────────────────────────────────────────────
    # Backtick, not backslash: PowerShell's escape character inside a double-quoted
    # string is `, and \" simply ends the string early.
    $m = ConvertFrom-EnvText -Text "A=1`r`n# comment`r`nB=`"has # hash`"`r`n`r`nC=  spaced  `r`nnot a line`r`n"
    Check 'the shared parser handles quotes, comments and blank lines' `
          ($m['A'] -eq '1' -and $m['B'] -eq 'has # hash' -and $m['C'] -eq 'spaced' -and $m.Count -eq 3) `
          ("parsed " + $m.Count + " keys: " + (@($m.Keys) -join ', '))

} finally {
    if (Test-Path -LiteralPath $WorkDir) {
        Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("  $script:Pass passed, $script:Fail failed, $script:Skip skipped") -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
Write-Host '  What these tests do NOT cover' -ForegroundColor White
Write-Host '    - a real Claude Desktop launch. Everything here spawns the shim the same way' -ForegroundColor DarkGray
Write-Host '      Desktop does, but Desktop itself is not in the loop.' -ForegroundColor DarkGray
Write-Host '    - decrypting a REAL credential against a REAL bMS. The secret here is' -ForegroundColor DarkGray
Write-Host '      fabricated on purpose. What is proven is that the value which comes out of' -ForegroundColor DarkGray
Write-Host '      DPAPI is byte-identical to the one that went in, and that it reaches the' -ForegroundColor DarkGray
Write-Host '      child process environment intact.' -ForegroundColor DarkGray
Write-Host ''
if ($script:Fail) { exit 1 }
exit 0
