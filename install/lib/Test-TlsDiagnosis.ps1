<#
.SYNOPSIS
    Tests for the TLS / internal-CA diagnosis: lib\probe-tls.mjs, the Step 4 wiring in
    Install-BConnectMcp.ps1, and the stderr diagnosis in lib\verify-install.mjs.

.DESCRIPTION
    Everything here runs against TLS listeners on 127.0.0.1 that present certificates
    generated in memory for this run. No certificate store is read or written, no
    certificate is installed anywhere, nothing leaves this machine and the live bMS is
    never contacted. The fixtures are torn down in the finally block.

    WHAT THIS FILE IS ACTUALLY FOR. Before it existed, every one of these ended at the
    same sentence -- an untrusted internal CA, an expired certificate, a certificate
    issued for a different name, a closed port and a DNS typo all produced

        GET /endpoints/v2.0/WindowsEndpoints -> The underlying connection was closed.

    plus, when the exception text happened to contain one of four words, a paragraph
    that named the CA, the Windows store and NODE_TLS_REJECT_UNAUTHORIZED in one
    breath. Five problems, five different fixes, one message. Each check below was run
    against that version first; the observed pre-fix behaviour is recorded per group.

.EXAMPLE
    .\Test-TlsDiagnosis.ps1
.EXAMPLE
    .\Test-TlsDiagnosis.ps1 -Only classify
#>
[CmdletBinding()]
param([string] $WorkDir, [string] $Only)

$ErrorActionPreference = 'Stop'

$LibDir       = $PSScriptRoot
$InstallerDir = Split-Path -Parent $LibDir
$Installer    = Join-Path $InstallerDir 'Install-BConnectMcp.ps1'
$Probe        = Join-Path $LibDir 'probe-tls.mjs'
$SuiteRoot    = Join-Path (Split-Path -Parent $InstallerDir) 'bConnect-MCP-main'

Import-Module (Join-Path $LibDir 'Secrets.psm1') -Force
Import-Module (Join-Path $LibDir 'Dpapi.psm1')   -Force -DisableNameChecking

if (-not $WorkDir) {
    $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-tls-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
}
$FixtureDir = Join-Path $WorkDir 'fixtures'

# Not a credential for anything. The listeners below answer every request identically
# and never look at the Authorization header.
$DUMMY_KEY = 'dummy-api-key-0000-not-real'

$script:Pass = 0
$script:Fail = 0
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}
function Group {
    param([string] $Name)
    Write-Host ''
    Write-Host ("  -- $Name " + ('-' * [Math]::Max(0, 58 - $Name.Length))) -ForegroundColor Cyan
}
function Want { param([string] $Tag) return (-not $Only) -or ($Only -eq $Tag) }

# -----------------------------------------------------------------------------
# Fixtures
# -----------------------------------------------------------------------------
# A self-signed certificate stands in for "signed by a CA this runtime does not
# know", which is the same verification failure from OpenSSL's point of view and is
# the only shape that can be produced offline without issuing a CA of our own.
#
# CertificateRequest builds the key and the certificate in memory. Nothing is added
# to CurrentUser\My, to LocalMachine\Root, or to any other store: an installer test
# that changes this machine's trust decisions would be a worse bug than the one it
# is testing for.
function New-FixtureCert {
    param(
        [string] $Name,
        [string] $Subject      = 'CN=bms.example.local',
        [string[]] $DnsNames   = @('bms.example.local'),
        [string[]] $IpAddresses = @('127.0.0.1'),
        [int] $NotBeforeDays   = -1,
        [int] $NotAfterDays    = 365
    )
    New-Item -ItemType Directory -Path $FixtureDir -Force | Out-Null

    $rsa = [System.Security.Cryptography.RSA]::Create(2048)
    $req = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
            $Subject, $rsa,
            [System.Security.Cryptography.HashAlgorithmName]::SHA256,
            [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)

    $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    foreach ($d in $DnsNames)    { $san.AddDnsName($d) }
    foreach ($i in $IpAddresses) { $san.AddIpAddress([System.Net.IPAddress]::Parse($i)) }
    $req.CertificateExtensions.Add($san.Build())
    $req.CertificateExtensions.Add(
        [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $eku = [System.Security.Cryptography.OidCollection]::new()
    [void]$eku.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))   # Server Authentication
    $req.CertificateExtensions.Add(
        [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($eku, $false))

    $cert = $req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays($NotBeforeDays),
                                  [DateTimeOffset]::UtcNow.AddDays($NotAfterDays))

    # PFX for the listener (Node reads it directly), PEM for the client side, which is
    # the form BCONNECT_CA_CERT_PATH takes.
    $pfx = Join-Path $FixtureDir "$Name.pfx"
    $pem = Join-Path $FixtureDir "$Name.pem"
    [IO.File]::WriteAllBytes($pfx, $cert.Export('Pkcs12', 'fixture'))
    [IO.File]::WriteAllText($pem,
        "-----BEGIN CERTIFICATE-----`n" +
        [Convert]::ToBase64String($cert.Export('Cert'), 'InsertLineBreaks') +
        "`n-----END CERTIFICATE-----`n")
    return @{ Pfx = $pfx; Pem = $pem }
}

$script:Listeners = @()
function Start-FixtureListener {
    <# A TLS listener presenting $Pfx, answering every path with a bConnect-shaped 200. #>
    param([string] $Pfx)
    $script = Join-Path $FixtureDir ('listen-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.mjs')
    $portFile = $script + '.port'
    @"
import { readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
const srv = https.createServer(
  { pfx: readFileSync(process.argv[2]), passphrase: 'fixture' },
  (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"version":"26.1.180.0","totalItems":0}');
  });
srv.listen(0, '127.0.0.1', () => writeFileSync(process.argv[3], String(srv.address().port)));
"@ | Set-Content -LiteralPath $script -Encoding UTF8

    $p = Start-Process -FilePath 'node' -ArgumentList @("`"$script`"", "`"$Pfx`"", "`"$portFile`"") `
                       -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $portFile)) { Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath $portFile)) { throw "fixture listener did not start for $Pfx" }
    $port = [int](Get-Content -LiteralPath $portFile -Raw).Trim()
    $script:Listeners += $p
    return $port
}

function Get-FreePort {
    <# A port nothing is listening on, for the connection-refused case. #>
    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $l.Start(); $port = $l.LocalEndpoint.Port; $l.Stop()
    return $port
}

function Invoke-Probe {
    <# lib\probe-tls.mjs as the installer runs it: JSON via --out, never via stdout. #>
    param([string] $Url, [string] $CaPath, [int] $TimeoutMs = 8000)
    $out = Join-Path $WorkDir ('probe-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.json')
    $a = @("`"$Probe`"", '--url', "`"$Url`"", '--timeout', "$TimeoutMs", '--out', "`"$out`"")
    if ($CaPath) { $a += @('--ca', "`"$CaPath`"") }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'node'; $psi.Arguments = ($a -join ' ')
    $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $null = $p.StandardOutput.ReadToEndAsync(); $null = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    if (-not (Test-Path -LiteralPath $out)) { return $null }
    return (Get-Content -LiteralPath $out -Raw | ConvertFrom-Json)
}

# The installer runs in a CHILD process and through a generated runner: it calls exit,
# and -ApiKeySecure is a [SecureString] that cannot cross a process boundary as text.
# Same shape as lib\Test-Reconfigure.ps1, for the same two reasons.
$script:RunSeq = 0
function ConvertTo-Literal {
    param($v)
    if ($v -is [bool])     { return $(if ($v) { '$true' } else { '$false' }) }
    if ($v -is [int])      { return [string]$v }
    if ($v -is [string[]]) { return '@(' + (($v | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ',') + ')' }
    return "'" + ([string]$v -replace "'", "''") + "'"
}
function Invoke-Installer {
    param([hashtable] $Params, [string] $Work)
    $script:RunSeq++
    $runner = Join-Path $Work ("run-$($script:RunSeq).ps1")
    $lines = @('$ErrorActionPreference = ''Continue''')
    $call  = @("& '$Installer'")
    foreach ($k in $Params.Keys) {
        $v = $Params[$k]
        if ($v -is [switch] -or $v -is [bool]) { if ($v) { $call += "-$k" } }
        elseif ($k -like '*Secure') {
            $lines += "`$$k = ConvertTo-SecureString " + (ConvertTo-Literal $Params[$k]) + " -AsPlainText -Force"
            $call  += "-$k `$$k"
        } else { $call += "-$k " + (ConvertTo-Literal $v) }
    }
    $lines += ($call -join ' ')
    $lines | Set-Content -LiteralPath $runner -Encoding UTF8
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner 2>&1 | Out-String
    return $out
}

Write-Host ''
Write-Host "TLS diagnosis tests -- scratch tree: $WorkDir" -ForegroundColor Cyan
Write-Host '  live bMS: never contacted. Certificates are generated in memory and never' -ForegroundColor DarkGray
Write-Host '  added to any certificate store.' -ForegroundColor DarkGray

$started = Get-Date
try {
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

$certGood     = New-FixtureCert -Name 'good'
$certExpired  = New-FixtureCert -Name 'expired'  -NotBeforeDays -400 -NotAfterDays -10
$certFuture   = New-FixtureCert -Name 'future'   -NotBeforeDays 30   -NotAfterDays 400
$certOther    = New-FixtureCert -Name 'othername' -Subject 'CN=other.example.local' `
                                -DnsNames @('other.example.local') -IpAddresses @()

$portGood    = Start-FixtureListener -Pfx $certGood.Pfx
$portExpired = Start-FixtureListener -Pfx $certExpired.Pfx
$portFuture  = Start-FixtureListener -Pfx $certFuture.Pfx
$portOther   = Start-FixtureListener -Pfx $certOther.Pfx
$portClosed  = Get-FreePort

$urlGood    = "https://127.0.0.1:$portGood/bconnect"
$urlExpired = "https://127.0.0.1:$portExpired/bconnect"
$urlFuture  = "https://127.0.0.1:$portFuture/bconnect"
$urlOther   = "https://127.0.0.1:$portOther/bconnect"
$urlClosed  = "https://127.0.0.1:$portClosed/bconnect"
$urlNoDns   = 'https://bms.invalid.example/bconnect'

# =============================================================================
# 1. The classifier tells the five failures apart
# =============================================================================
# Measured against the unfixed tree: lib\probe-tls.mjs did not exist, and the only
# classification anywhere was mcp-core's tlsUntrustedCertHint, a five-code set that
# decides whether to append a paragraph. It returns nothing for CERT_HAS_EXPIRED,
# nothing for ERR_TLS_CERT_ALTNAME_INVALID, and does not look at transport codes at
# all -- so four of the six rows below had no distinct outcome to assert on.
if (Want 'classify') {
    Group 'probe-tls.mjs -- one cause per failure'

    foreach ($row in @(
        @{ What = 'an issuer this runtime does not trust'; Url = $urlGood;    Ca = $null;           Cause = 'untrusted-issuer'  }
        @{ What = 'an expired certificate';                Url = $urlExpired; Ca = $certExpired.Pem; Cause = 'expired'          }
        @{ What = 'a certificate that is not valid yet';   Url = $urlFuture;  Ca = $certFuture.Pem;  Cause = 'not-yet-valid'    }
        @{ What = 'a certificate for a different name';    Url = $urlOther;   Ca = $certOther.Pem;   Cause = 'hostname-mismatch' }
        @{ What = 'a closed port';                         Url = $urlClosed;  Ca = $null;            Cause = 'refused'          }
        @{ What = 'a name that does not resolve';          Url = $urlNoDns;   Ca = $null;            Cause = 'dns'              })) {
        $r = Invoke-Probe -Url $row.Url -CaPath $row.Ca
        Check ("$($row.What) is classified as '$($row.Cause)'") `
              ($null -ne $r -and $r.cause -eq $row.Cause) `
              ("cause=" + $(if ($r) { "$($r.cause)  code=$($r.code)" } else { '(no result)' }))
    }

    # The distinction that carries the whole feature: only ONE of them offers a file.
    $untrusted = Invoke-Probe -Url $urlGood
    $expired   = Invoke-Probe -Url $urlExpired -CaPath $certExpired.Pem
    $mismatch  = Invoke-Probe -Url $urlOther   -CaPath $certOther.Pem
    Check 'an untrusted issuer is marked as fixable by a CA certificate' ([bool]$untrusted.caFixable)
    Check 'an expired certificate is NOT'   (-not $expired.caFixable)
    Check 'a hostname mismatch is NOT'      (-not $mismatch.caFixable)
    Check 'the expired remedy says a CA certificate does not help' `
          (($expired.remedy -join ' ') -match 'does not make an expired certificate valid')
    Check 'the mismatch remedy says a CA certificate does not help' `
          (($mismatch.remedy -join ' ') -match 'A CA certificate file does not fix this')
    Check 'the mismatch report names the certificate''s own names' `
          (($mismatch.detail -join ' ') -match 'other\.example\.local')

    Group 'probe-tls.mjs -- the CA certificate is the remedy, and it is checked'
    $fixed = Invoke-Probe -Url $urlGood -CaPath $certGood.Pem
    Check 'the right CA certificate makes the chain verify' ($fixed.cause -eq 'trusted') "cause=$($fixed.cause)"
    $wrong = Invoke-Probe -Url $urlGood -CaPath $certOther.Pem
    Check 'the wrong CA certificate does not' ($wrong.cause -eq 'untrusted-issuer') "cause=$($wrong.cause)"
    Check 'and the operator is told it was the file that failed, not the check' `
          (($wrong.detail -join ' ') -match 'supplied file was used as the whole trust list')
    $absent = Invoke-Probe -Url $urlGood -CaPath (Join-Path $FixtureDir 'no-such-file.pem')
    Check 'a CA path that does not exist is its own cause' ($absent.cause -eq 'ca-file-unreadable') "cause=$($absent.cause)"

    Group 'probe-tls.mjs -- disabling verification is not offered'
    foreach ($r in @($untrusted, $expired, $mismatch, $fixed)) {
        Check ("'$($r.cause)' does not put NODE_TLS_REJECT_UNAUTHORIZED in the remedy list") `
              (($r.remedy -join ' ') -notmatch 'NODE_TLS_REJECT_UNAUTHORIZED')
    }
    Check 'it is named once, as a warning, and described as a development flag' `
          ($untrusted.warning -match 'NODE_TLS_REJECT_UNAUTHORIZED=0' -and
           $untrusted.warning -match 'development flag' -and
           $untrusted.warning -match 'does not offer it')
}

# =============================================================================
# 2. Step 4 of the installer routes the operator to the fix
# =============================================================================
# Measured against the unfixed tree: an unattended run against the untrusted listener
# printed "GET /endpoints/v2.0/WindowsEndpoints -> The underlying connection was
# closed: An unexpected error occurred on a send." and nothing else. The words
# "certificate", "BCONNECT_CA_CERT_PATH" and "expired" appeared nowhere in the run.
if (Want 'installer') {
    Group 'Install-BConnectMcp.ps1 Step 4 -- the cause reaches the console'

    function New-InstallerScratch {
        $w = Join-Path $WorkDir ('inst-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
        New-Item -ItemType Directory -Path $w -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $w 'proj') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $w 'hostout') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $w 'cfg') -Force | Out-Null
        return @{
            Root       = $w
            SecretsDir = (Join-Path $w 'secrets')
            EnvFile    = (Join-Path $w 'secrets\bconnect.env')
            Common     = @{
                SuiteRoot             = $SuiteRoot
                SecretsDir            = (Join-Path $w 'secrets')
                ConfigPath            = (Join-Path $w 'cfg\claude_desktop_config.json')
                ProjectDir            = (Join-Path $w 'proj')
                HostOutDir            = (Join-Path $w 'hostout')
                StateFile             = (Join-Path $w 'state.json')
                NonInteractive        = $true
                SkipBuild             = $true
                ContinueOnUnreachable = $true
                Hosts                 = 'claude-desktop'
                Servers               = 'bconnect-endpoints'
            }
        }
    }

    # Anchored on the "[FAIL] " prefix, which only Write-Fail in Step 4 emits. Without
    # the anchor these pass on the Step 11 verifier's diagnosis of the same failure --
    # which is the right message in the wrong place: by Step 11 the credentials file
    # and every host configuration have already been written.
    $s = New-InstallerScratch
    $out = Invoke-Installer -Params ($s.Common + @{ BaseUrl = $urlGood; ApiKeySecure = $DUMMY_KEY }) -Work $s.Root
    Check 'Step 4 names an untrusted issuer as a certificate problem' `
          ($out -match '\[FAIL\]\s+The bMS certificate at .+ issuer is not trusted') `
          ($(if ($out -match '(?m)^.*issuer is not trusted.*$') { $Matches[0].Trim() } else { 'not in output' }))
    Check 'and the run points at BCONNECT_CA_CERT_PATH' ($out -match 'BCONNECT_CA_CERT_PATH')
    Check 'and at -CaCert, which is how an unattended run supplies it' ($out -match '-CaCert')
    Check 'and the OpenSSL code is on the page for a support call' ($out -match 'DEPTH_ZERO_SELF_SIGNED_CERT')
    Check 'and disabling verification is not among the numbered remedies' `
          ($out -notmatch '(?m)^\s+\d+\.\s.*NODE_TLS_REJECT_UNAUTHORIZED')

    $s2 = New-InstallerScratch
    $out2 = Invoke-Installer -Params ($s2.Common + @{ BaseUrl = $urlExpired; ApiKeySecure = $DUMMY_KEY }) -Work $s2.Root
    Check 'Step 4 names an expired certificate as expired, not as untrusted' `
          ($out2 -match '\[FAIL\]\s+The bMS certificate at .+ has expired' -and $out2 -notmatch 'issuer is not trusted')
    Check 'and the expired run does not ask for a CA certificate' `
          ($out2 -notmatch 'path to the PEM file' -and $out2 -notmatch 'Pass -CaCert')

    # With the certificate's own PEM as the CA: the issuer is then trusted, so the
    # name is the only thing left wrong. That is the case the operator hits after
    # supplying a working CA and still addressing the bMS by IP address.
    $s3 = New-InstallerScratch
    $out3 = Invoke-Installer -Params ($s3.Common + @{
                BaseUrl = $urlOther; ApiKeySecure = $DUMMY_KEY; CaCert = $certOther.Pem }) -Work $s3.Root
    Check 'Step 4 names a certificate for another name as a name problem' `
          ($out3 -match '\[FAIL\]\s+The bMS certificate at .+ was not issued for')
    Check 'and that run does not ask for a CA certificate either' `
          ($out3 -notmatch 'Pass -CaCert')

    $s4 = New-InstallerScratch
    $out4 = Invoke-Installer -Params ($s4.Common + @{ BaseUrl = $urlClosed; ApiKeySecure = $DUMMY_KEY }) -Work $s4.Root
    Check 'Step 4 names a closed port as a closed port, not as a certificate problem' `
          ($out4 -match '\[FAIL\]\s+\S+ refused the connection' -and $out4 -notmatch 'certificate at')

    $s5 = New-InstallerScratch
    $out5 = Invoke-Installer -Params ($s5.Common + @{ BaseUrl = $urlNoDns; ApiKeySecure = $DUMMY_KEY }) -Work $s5.Root
    Check 'Step 4 names a name that does not resolve as DNS' `
          ($out5 -match "\[FAIL\]\s+The name '\S+' did not resolve")

    Group 'Install-BConnectMcp.ps1 Step 4 -- a supplied CA is used, checked and recorded'

    $s6 = New-InstallerScratch
    $out6 = Invoke-Installer -Params ($s6.Common + @{
                BaseUrl = $urlGood; ApiKeySecure = $DUMMY_KEY; CaCert = $certGood.Pem }) -Work $s6.Root
    Check '-CaCert with the right PEM turns the Step 4 verdict green' `
          ($out6 -match '\[ ok \]\s+The certificate presented by .+ is trusted by this Node runtime') `
          ($(if ($out6 -match '(?m)^.*trusted by this Node runtime.*$') { $Matches[0].Trim() } else { 'not in output' }))
    $envMap6 = ConvertFrom-EnvText -Text (Get-Content -LiteralPath $s6.EnvFile -Raw)
    Check 'and the path is written to the credentials file' `
          ($envMap6['BCONNECT_CA_CERT_PATH'] -eq $certGood.Pem) `
          ("BCONNECT_CA_CERT_PATH=" + $envMap6['BCONNECT_CA_CERT_PATH'])

    $s7 = New-InstallerScratch
    $out7 = Invoke-Installer -Params ($s7.Common + @{
                BaseUrl = $urlGood; ApiKeySecure = $DUMMY_KEY; CaCert = $certOther.Pem }) -Work $s7.Root
    Check '-CaCert with the wrong PEM is rejected rather than accepted on sight' `
          ($out7 -match 'issuer is not trusted')
    Check 'and the operator is told the file was tried and did not verify the chain' `
          ($out7 -match 'supplied file was used as the whole trust list')

    Group 'Install-BConnectMcp.ps1 Step 4 -- a CA found on a reuse run is not lost'
    # The reuse path does not rewrite the credentials file. Without the settings-merge
    # this run would show a green certificate verdict and record nothing, and every
    # server would then fail exactly as it did before.
    $s8 = New-InstallerScratch
    New-Item -ItemType Directory -Path $s8.SecretsDir -Force | Out-Null
    Set-HardenedDirectoryAcl -Path $s8.SecretsDir
    Write-SecretFileAtomic -Path $s8.EnvFile -Content (New-EnvFileContent -BaseUrl $urlGood -ApiKey $DUMMY_KEY)
    $out8 = Invoke-Installer -Params ($s8.Common + @{ ReuseCredentials = $true; CaCert = $certGood.Pem }) -Work $s8.Root
    $envMap8 = ConvertFrom-EnvText -Text (Get-Content -LiteralPath $s8.EnvFile -Raw)
    Check 'a reuse run records the CA path it was given' `
          ($envMap8['BCONNECT_CA_CERT_PATH'] -eq $certGood.Pem) `
          ("BCONNECT_CA_CERT_PATH=" + $(if ($envMap8['BCONNECT_CA_CERT_PATH']) { $envMap8['BCONNECT_CA_CERT_PATH'] } else { '(absent)' }))
    Check 'and the API key it was not given is still there' `
          ($envMap8['BCONNECT_API_KEY'] -eq $DUMMY_KEY)
}

# =============================================================================
# 3. verify-install.mjs names the same cause from a server's stderr
# =============================================================================
# Measured against the unfixed tree: verify-install.mjs printed the generic startup
# diagnosis for a certificate failure, which ends "check the URL before the
# credential" -- the wrong place to look when the chain is what was refused.
if (Want 'verify') {
    Group 'verify-install.mjs -- the same classifier, one implementation'

    $probeUrl = ($Probe -replace '\\', '/')
    $js = @"
import { classifyTlsFailure, describeTlsResult, knownTlsCodes } from 'file:///$probeUrl';
const out = {
  untrusted: classifyTlsFailure('UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
  expired:   classifyTlsFailure('CERT_HAS_EXPIRED'),
  altname:   classifyTlsFailure('ERR_TLS_CERT_ALTNAME_INVALID'),
  codes:     knownTlsCodes(),
  described: describeTlsResult({ cause: classifyTlsFailure('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: '' }),
};
process.stdout.write(JSON.stringify(out));
"@
    $jsFile = Join-Path $WorkDir 'classify.mjs'
    $js | Set-Content -LiteralPath $jsFile -Encoding UTF8
    $shared = (& node $jsFile) | ConvertFrom-Json

    Check 'the classifier is importable, so verify-install does not need a copy' `
          ($shared.untrusted -eq 'untrusted-issuer' -and $shared.expired -eq 'expired' -and
           $shared.altname -eq 'hostname-mismatch')
    Check 'it names a cause with no socket behind it, which is all stderr gives' `
          ($shared.described.headline -match 'issuer is not trusted' -and
           ($shared.described.remedy -join ' ') -match 'BCONNECT_CA_CERT_PATH')
    Check 'and it says nothing about a certificate it never saw' `
          (($shared.described.detail -join ' ') -notmatch 'Certificate subject')

    # The import has to be the real one. A guard that only proves the module works
    # would pass while verify-install.mjs kept its own copy of the code list.
    $vi = Get-Content -LiteralPath (Join-Path $LibDir 'verify-install.mjs') -Raw
    Check 'verify-install.mjs imports the classifier rather than restating it' `
          ($vi -match "from '\./probe-tls\.mjs'")
    Check 'and finds the code with the shared list, not a list of its own' `
          ($vi -match 'knownTlsCodes\(\)' -and $vi -notmatch "'UNABLE_TO_VERIFY_LEAF_SIGNATURE'")
    Check 'and stands the generic "check the URL" diagnosis down when a code was found' `
          ($vi -match '!tlsCode &&')

    # The stderr text a server really produces, run through the same finder.
    $stderrJs = @"
import { classifyTlsFailure, knownTlsCodes } from 'file:///$probeUrl';
const stderr = 'Connection test failed: unable to verify the first certificate (UNABLE_TO_VERIFY_LEAF_SIGNATURE)\nTLS certificate verification failed';
const found = knownTlsCodes().find((c) => new RegExp('\\b' + c + '\\b').test(stderr)) || '';
process.stdout.write(JSON.stringify({ found, cause: classifyTlsFailure(found) }));
"@
    $stderrFile = Join-Path $WorkDir 'stderr.mjs'
    $stderrJs | Set-Content -LiteralPath $stderrFile -Encoding UTF8
    $found = (& node $stderrFile) | ConvertFrom-Json
    Check 'the code mcp-core prints in its own failure line is recognised' `
          ($found.found -eq 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' -and $found.cause -eq 'untrusted-issuer') `
          ("found=$($found.found) cause=$($found.cause)")
}

# =============================================================================
# 4. Tone
# =============================================================================
# The same register lib\Test-WizardPrep.ps1 enforces on the wizard, applied to the
# strings this feature adds. They are user-facing text and will otherwise drift.
if (Want 'tone') {
    Group 'tone -- the strings an administrator reads'

    $all = @()
    foreach ($r in @(
            (Invoke-Probe -Url $urlGood),
            (Invoke-Probe -Url $urlGood -CaPath $certGood.Pem),
            (Invoke-Probe -Url $urlGood -CaPath $certOther.Pem),
            (Invoke-Probe -Url $urlExpired -CaPath $certExpired.Pem),
            (Invoke-Probe -Url $urlFuture  -CaPath $certFuture.Pem),
            (Invoke-Probe -Url $urlOther   -CaPath $certOther.Pem),
            (Invoke-Probe -Url $urlClosed),
            (Invoke-Probe -Url $urlNoDns))) {
        if (-not $r) { continue }
        $all += $r.headline
        $all += @($r.detail)
        $all += @($r.remedy)
        if ($r.warning) { $all += $r.warning }
    }
    $all = @($all | Where-Object { $_ })
    Check 'there is a body of text to check at all' ($all.Count -gt 40) "$($all.Count) strings"

    foreach ($b in @(
            @{ Name = 'an exclamation mark';        Pattern = '!' }
            @{ Name = 'first-person plural ("we")'; Pattern = "(?i)\bwe\b|\bwe'(re|ll|ve|d)\b|\bour\b|\bours\b" }
            @{ Name = '"let''s"';                   Pattern = "(?i)\blet's\b|\blet us\b" }
            @{ Name = '"oops"';                     Pattern = '(?i)\boops\b' }
            @{ Name = '"heads up"';                 Pattern = '(?i)heads[- ]up' }
            @{ Name = 'a contraction';              Pattern = "(?i)\b(don't|doesn't|didn't|can't|won't|wouldn't|shouldn't|couldn't|isn't|aren't|wasn't|weren't|it's|that's|there's|here's|you're|you'll|you've|they're)\b" })) {
        $hits = @($all | Where-Object { $_ -match $b.Pattern })
        Check ("no string uses " + $b.Name) ($hits.Count -eq 0) `
              $(if ($hits.Count) { ($hits | Select-Object -First 3) -join ' // ' } else { "$($all.Count) strings clean" })
    }
}

} finally {
    foreach ($p in $script:Listeners) {
        try { if (-not $p.HasExited) { $p.Kill() } } catch { }
    }
    if ($WorkDir -and (Test-Path -LiteralPath $WorkDir)) {
        Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$elapsed = [int]((Get-Date) - $started).TotalSeconds
Write-Host ''
Write-Host ('  ' + ('=' * 60)) -ForegroundColor DarkCyan
Write-Host ("  $script:Pass passed, $script:Fail failed   (${elapsed}s)") `
           -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
exit $(if ($script:Fail) { 1 } else { 0 })
