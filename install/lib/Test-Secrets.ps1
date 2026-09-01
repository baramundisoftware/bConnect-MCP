<#
.SYNOPSIS
    Tests for the credential-handling half of the installer.

.DESCRIPTION
    Runs entirely against a throwaway directory with a dummy secret. It never reads,
    writes or touches the real credentials file.

    The test that matters is Test 3: harden the directory, write the file the way an
    editor saves (temp file, then replace over the original), and THEN check the
    ACL. That sequence is the one that used to fail. A file-level ACL does not
    survive it, because the file the ACL was attached to no longer exists. Anything
    that only checks the ACL of a file it created directly is testing the wrong
    thing.

.EXAMPLE
    .\Test-Secrets.ps1
#>
[CmdletBinding()]
param([string] $WorkDir)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Secrets.psm1') -Force

if (-not $WorkDir) {
    $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-secrets-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
}

$script:Pass = 0
$script:Fail = 0
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}

Write-Host ''
Write-Host "Secrets module tests -- scratch directory: $WorkDir" -ForegroundColor Cyan
Write-Host ''

try {
    # -- Test 1: the check can actually fail ----------------------------------
    # A detector that never fires proves nothing about what it is detecting, so
    # grant BUILTIN\Users deliberately and confirm it is caught. (%TEMP% itself
    # cannot be used as the negative case -- on a hardened server it is already
    # tight, and the test would pass for the wrong reason.)
    $loose = Join-Path $WorkDir 'loose'
    New-Item -ItemType Directory -Path $loose -Force | Out-Null
    & icacls.exe $loose /grant '*S-1-5-32-545:(OI)(CI)(RX)' | Out-Null
    $before = Get-BroadAccessAce -Path $loose
    Check 'negative control: a Users:(RX) grant IS detected as broad access' ($before.Count -gt 0) `
          ($(if ($before.Count) { $before[0] } else { 'the detector missed an explicit BUILTIN\Users grant' }))

    # -- Test 2: hardening removes it -----------------------------------------
    $secure = Join-Path $WorkDir 'secure'
    Set-HardenedDirectoryAcl -Path $secure
    $after = Get-BroadAccessAce -Path $secure
    Check 'hardening a directory removes every broad-group ACE' ($after.Count -eq 0) `
          ($after -join '; ')

    # -- Test 3: the ACL survives an atomic save ------------------------------
    # THE test. Write, then write again over the top the way an editor does, then
    # look at the ACL of the file that now exists.
    $envFile = Join-Path $secure 'bconnect.env'
    Write-SecretFileAtomic -Path $envFile -Content "BCONNECT_API_KEY=dummy-value-not-a-real-key`r`n"
    $f1 = Get-BroadAccessAce -Path $envFile
    Check 'a file created in the hardened directory inherits the restriction' ($f1.Count -eq 0) ($f1 -join '; ')

    Write-SecretFileAtomic -Path $envFile -Content "BCONNECT_API_KEY=dummy-value-edited`r`n"
    $f2 = Get-BroadAccessAce -Path $envFile
    Check 'the restriction SURVIVES a write-temp-then-replace save (finding F10)' ($f2.Count -eq 0) ($f2 -join '; ')
    Check 'the replaced file has the new content' `
          ((Get-Content -LiteralPath $envFile -Raw) -match 'dummy-value-edited')

    # -- Test 4: no leftover temp files carrying the secret -------------------
    $leftovers = @(Get-ChildItem -LiteralPath $secure -Force -File | Where-Object { $_.Name -ne 'bconnect.env' })
    Check 'no temporary copy of the secret is left behind' ($leftovers.Count -eq 0) `
          (($leftovers | Select-Object -ExpandProperty Name) -join ', ')

    # -- Test 5: encoding -----------------------------------------------------
    # Node's --env-file parser treats a UTF-8 BOM as part of the first key name, so
    # a BOM here would silently break BCONNECT_BASE_URL and nothing else.
    $bytes = [System.IO.File]::ReadAllBytes($envFile)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    Check 'the file is written WITHOUT a UTF-8 BOM' (-not $hasBom)

    # -- Test 6: env file content ---------------------------------------------
    # Note the \r? before $ -- the file uses CRLF, and .NET's $ anchors before the
    # \n, i.e. after the \r. Without it every one of these checks fails silently.
    $content = New-EnvFileContent -BaseUrl 'https://bms.example.com/bconnect' -ApiKey 'dummy#key with spaces'
    # Neither key may be written any more. The skip flag was a workaround for a probe
    # path that is corrected upstream, and it also suppresses the startup check that
    # the connected bMS is a release this suite supports -- so writing it turns an
    # install against an unsupported bMS from a refusal into wrong answers.
    # BCONNECT_RELEASE is read by nothing at all.
    Check 'BCONNECT_SKIP_CONNECTIVITY_CHECK is NOT written (it disables the bMS release gate)' `
          (-not ($content -match '(?m)^BCONNECT_SKIP_CONNECTIVITY_CHECK='))
    Check 'BCONNECT_RELEASE is NOT written (nothing reads it)' `
          (-not ($content -match '(?m)^BCONNECT_RELEASE='))
    Check 'ALLOW_WRITE_OPERATIONS is NOT set in the shared env file' `
          (-not ($content -match '(?m)^ALLOW_WRITE_OPERATIONS='))
    Check 'a value containing # is quoted so the .env parser does not truncate it' `
          ($content -match '(?m)^BCONNECT_API_KEY="dummy#key with spaces"\r?$')
    Check 'basic auth is written when no API key is supplied' `
          ((New-EnvFileContent -BaseUrl 'https://x/bconnect' -BasicUser 'u' -BasicPass 'p') -match '(?m)^BCONNECT_USERNAME=u\r?$')
    Check 'v1.1 credentials are written only when supplied' `
          (-not ($content -match 'BCONNECT_V11_USERNAME'))

    # -- Test 7: Node can actually parse what we generate ---------------------
    $parseFile = Join-Path $secure 'parse-check.env'
    Write-SecretFileAtomic -Path $parseFile -Content $content
    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if ($node) {
        # String.fromCharCode(124) rather than a literal "|": PowerShell strips the
        # double quotes when it builds the native command line, and the expression
        # then fails to parse.
        $js = 'process.stdout.write([process.env.BCONNECT_BASE_URL,process.env.BCONNECT_API_KEY,process.env.MCP_TRANSPORT].join(String.fromCharCode(124)))'
        $out = & $node.Source "--env-file=$parseFile" '-e' $js
        Check 'Node --env-file parses the generated file correctly' `
              ($out -eq 'https://bms.example.com/bconnect|dummy#key with spaces|stdio') "node saw: $out"
    } else {
        Write-Host '  SKIP  Node --env-file parse check (node not on PATH)' -ForegroundColor Yellow
    }

    # -- Test 8: SEC-7, the gateway bearer token ------------------------------
    # The gateway now refuses callers without this token, so the installer has to
    # produce one that is actually strong, put it where the gateway launcher
    # already looks, and be able to add one to an EXISTING installation without
    # the operator re-typing a bMS password.
    $t1 = New-GatewayAuthToken
    $t2 = New-GatewayAuthToken
    Check 'New-GatewayAuthToken returns 43 base64url chars (32 random bytes)' `
          ($t1.Length -eq 43) "length $($t1.Length): $t1"
    Check 'the token is URL/header/.env safe -- no +, / or = to quote or escape' `
          ($t1 -match '^[A-Za-z0-9_-]+$')
    Check 'it clears the gateway''s 24-character minimum with room to spare' ($t1.Length -ge 24)
    Check 'two calls do not return the same token' ($t1 -ne $t2)

    $gwContent = New-EnvFileContent -BaseUrl 'https://x/bconnect' -ApiKey 'k' -GatewayAuthToken $t1
    Check 'New-EnvFileContent writes MCP_GATEWAY_AUTH_TOKEN when one is supplied' `
          ($gwContent -match ('(?m)^MCP_GATEWAY_AUTH_TOKEN=' + [regex]::Escape($t1) + '\r?$'))
    Check 'and omits it entirely when none is supplied' `
          (-not ((New-EnvFileContent -BaseUrl 'https://x/bconnect' -ApiKey 'k') -match 'MCP_GATEWAY_AUTH_TOKEN'))
    Check 'the stanza explains rotation where the operator will actually read it' `
          ($gwContent -match 'ROTATING IT')

    # The upgrade path: a credentials file written before this feature existed.
    $legacy = New-EnvFileContent -BaseUrl 'https://x/bconnect' -ApiKey 'k'
    Check 'a pre-existing env file is correctly reported as having no token' `
          ($null -eq (Get-GatewayAuthTokenFromEnvText -Text $legacy))
    $added = Set-GatewayAuthTokenInEnvText -Text $legacy
    Check 'a token is appended to an existing file without touching what was there' `
          ($added.Changed -and $added.Text.StartsWith($legacy))
    Check 'the appended token reads back' `
          ((Get-GatewayAuthTokenFromEnvText -Text $added.Text) -eq $added.Token)
    Check 'the rest of the file survived the append (API key still parses)' `
          ($added.Text -match '(?m)^BCONNECT_API_KEY=k\r?$')

    $again = Set-GatewayAuthTokenInEnvText -Text $added.Text
    Check 're-running does NOT churn the token (idempotent)' `
          ((-not $again.Changed) -and $again.Token -eq $added.Token)

    $rotated = Set-GatewayAuthTokenInEnvText -Text $added.Text -Rotate
    Check 'rotation issues a NEW active token' ($rotated.Token -ne $added.Token)
    Check 'rotation keeps the old one alongside it, so no client is locked out' `
          ($rotated.Text -match ('(?m)^MCP_GATEWAY_AUTH_TOKEN=' + [regex]::Escape($rotated.Token) + ',' + [regex]::Escape($added.Token) + '\r?$'))
    Check 'rotation replaces the line in place -- exactly one token line remains' `
          (@([regex]::Matches($rotated.Text, '(?m)^MCP_GATEWAY_AUTH_TOKEN=')).Count -eq 1)
    $rotatedTwice = Set-GatewayAuthTokenInEnvText -Text $rotated.Text -Rotate
    Check 'a second rotation keeps a window of TWO, not a growing list' `
          ((($rotatedTwice.Text -split "`r?`n" | Where-Object { $_ -like 'MCP_GATEWAY_AUTH_TOKEN=*' }) -split '=', 2)[1].Split(',').Count -eq 2)

    # -- Test 9: SecureString round trip --------------------------------------
    $ss = ConvertTo-SecureString 'dummy-secret-abc' -AsPlainText -Force
    Check 'ConvertFrom-SecureStringPlain round-trips a SecureString' `
          ((ConvertFrom-SecureStringPlain $ss) -eq 'dummy-secret-abc')
    Check 'ConvertFrom-SecureStringPlain returns null for null' `
          ($null -eq (ConvertFrom-SecureStringPlain $null))

    # -- Test 10: SEC-6, the Docker *_FILE convention gap is documented -------
    # SECRET_ENV_KEYS in mcp-core's build/secrets.js does not know about
    # BCONNECT_V11_USERNAME/PASSWORD, so a *_FILE-mounted v1.1 credential is
    # silently ignored -- no error, no log line, just a gateway with no v1.1
    # tools. That is an mcp-core fix this workspace does not own; what this
    # workspace owns is INSTALL.md not asserting the *_FILE convention covers
    # v1.1 when it does not. This is a documentation guard, not a behavioural
    # one -- it fails if the callout is deleted or the wording drifts away from
    # naming both env vars and the word "NOT".
    $installMd = Join-Path (Split-Path -Parent $PSScriptRoot) 'INSTALL.md'
    if (Test-Path -LiteralPath $installMd) {
        $installText = Get-Content -LiteralPath $installMd -Raw
        Check 'INSTALL.md names BCONNECT_V11_USERNAME_FILE explicitly' `
              ($installText -match 'BCONNECT_V11_USERNAME_FILE')
        Check 'INSTALL.md names BCONNECT_V11_PASSWORD_FILE explicitly' `
              ($installText -match 'BCONNECT_V11_PASSWORD_FILE')
        Check 'INSTALL.md states the v1.1 *_FILE gap in the negative, not just lists the var' `
              ($installText -match '(?s)BCONNECT_V11_(USERNAME|PASSWORD)_FILE.{0,200}\bNOT\b')
    } else {
        Check 'INSTALL.md exists to check' $false "expected at $installMd"
    }
} finally {
    if (Test-Path -LiteralPath $WorkDir) {
        Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("  $script:Pass passed, $script:Fail failed") -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
if ($script:Fail) { exit 1 }
exit 0
