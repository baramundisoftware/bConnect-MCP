<#
.SYNOPSIS
    Tests that a 401 from bConnect is diagnosed from what the SERVER said, rather
    than guessed at.

.DESCRIPTION
    A 401 is the most ambiguous response this installer can receive, and until now
    it was explained with two possible causes: a wrong credential, or a wrong base
    URL. There is a third, and on a real estate it was the actual one.

    A bConnect site with only Windows Authentication enabled in IIS answers

        WWW-Authenticate: Negotiate

    and nothing else. A Basic username and password sent to that site is refused
    HOWEVER CORRECT IT IS, with a 401 indistinguishable from a wrong password. The
    operator then retypes the credential, which is the one action that cannot help.
    Measured against the live estate: a well-formed Basic header got 401 with only
    Negotiate offered, while the same request with Windows integrated credentials
    got 200. The server had been stating the cause the whole time.

    So Step 4 now reads WWW-Authenticate on a 401 and says which schemes the server
    accepts, and says plainly when Basic is not among them and this run sent it.

    HOW THIS IS DRIVEN
    ------------------
    A plain HTTP listener on loopback that answers 401 with a chosen
    WWW-Authenticate header. HTTP, not HTTPS, deliberately: the engine performs no
    scheme validation, and a fixture certificate would fail the handshake before
    the 401 could ever be reached -- so the test would prove nothing about the
    message it exists to check. Nothing here contacts a real bMS.

    NOT proved here: that bConnect itself answers Negotiate (that is a property of
    an IIS site, observed on a live estate, not something a guard can assert), nor
    anything about Kerberos or NTLM, which this suite does not implement.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-AuthDiagnosis.ps1
#>
[CmdletBinding()]
param([switch] $KeepWork)

$ErrorActionPreference = 'Stop'

$LibDir    = $PSScriptRoot
$Installer = Join-Path (Split-Path -Parent $LibDir) 'Install-BConnectMcp.ps1'
$SuiteRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $LibDir)) 'bConnect-MCP-main'
if (-not (Test-Path -LiteralPath $Installer)) { throw "installer not found: $Installer" }

$script:Pass = 0
$script:Fail = 0
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}

$WorkDir = Join-Path $env:TEMP ('bconnect-auth-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$script:Jobs = @()

function Start-Fixture401 {
    <#
        A loopback listener that answers every request with 401 and the given
        WWW-Authenticate value. Runs in a background runspace rather than a second
        process so there is nothing to leave behind if this script is interrupted.
    #>
    param([string[]] $Schemes)
    $listener = [System.Net.HttpListener]::new()
    $port = 0
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $probe.Start(); $port = $probe.LocalEndpoint.Port; $probe.Stop()
    $listener.Prefixes.Add("http://127.0.0.1:$port/")
    $listener.Start()

    $ps = [powershell]::Create()
    [void]$ps.AddScript({
        param($l, $sch)
        while ($l.IsListening) {
            try {
                $ctx = $l.GetContext()
                foreach ($s in $sch) { $ctx.Response.AddHeader('WWW-Authenticate', $s) }
                $ctx.Response.StatusCode = 401
                $ctx.Response.Close()
            } catch { break }
        }
    }).AddArgument($listener).AddArgument($Schemes)
    $handle = $ps.BeginInvoke()
    $script:Jobs += @{ Ps = $ps; Handle = $handle; Listener = $listener }
    return $port
}

function New-Scratch {
    $w = Join-Path $WorkDir ('run-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
    foreach ($d in @('proj', 'hostout', 'cfg')) { New-Item -ItemType Directory -Path (Join-Path $w $d) -Force | Out-Null }
    return @{
        Root   = $w
        Common = @{
            SuiteRoot             = $SuiteRoot
            SecretsDir            = (Join-Path $w 'secrets')
            ConfigPath            = (Join-Path $w 'cfg\claude_desktop_config.json')
            ProjectDir            = (Join-Path $w 'proj')
            HostOutDir            = (Join-Path $w 'hostout')
            StateFile             = (Join-Path $w 'state.json')
            NonInteractive        = $true
            SkipBuild             = $true
            DryRun                = $true
            ContinueOnUnreachable = $true
            Hosts                 = 'claude-desktop'
            Servers               = 'bconnect-endpoints'
        }
    }
}

$script:RunSeq = 0
function Invoke-Installer {
    param([hashtable] $Params, [string] $Work)
    $script:RunSeq++
    $runner = Join-Path $Work "run-$($script:RunSeq).ps1"
    $lines = @('$ErrorActionPreference = ''Continue''')
    $call  = @("& '$Installer'")
    foreach ($k in $Params.Keys) {
        $v = $Params[$k]
        if ($v -is [switch] -or $v -is [bool]) { if ($v) { $call += "-$k" } }
        elseif ($k -like '*Secure') {
            $lines += "`$$k = ConvertTo-SecureString '" + ($v -replace "'", "''") + "' -AsPlainText -Force"
            $call  += "-$k `$$k"
        } else { $call += "-$k '" + ($v -replace "'", "''") + "'" }
    }
    $lines += ($call -join ' ')
    $lines | Set-Content -LiteralPath $runner -Encoding UTF8
    return (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner 2>&1 | Out-String)
}

Write-Host ''
Write-Host 'Authentication-scheme diagnosis' -ForegroundColor Cyan
Write-Host '  A loopback listener, never a real bMS. No certificate is generated or trusted.' -ForegroundColor DarkGray
Write-Host ''

try {
    New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

    # =========================================================================
    # 1. Windows-only site: Basic is sent, Negotiate is all that is offered.
    #    This is the live case, reproduced.
    # =========================================================================
    Write-Host '-- a site that offers only Negotiate, sent a username and password --' -ForegroundColor Cyan
    $portNeg = Start-Fixture401 -Schemes @('Negotiate')
    $s1 = New-Scratch
    $out1 = Invoke-Installer -Work $s1.Root -Params ($s1.Common + @{
        BaseUrl = "http://127.0.0.1:$portNeg/bconnect"
        BasicUser = 'example\\operator'; BasicPassSecure = 'example-password'
    })

    Check 'the 401 is reported' ($out1 -match '401') `
        ($(if ($out1 -match '(?m)^.*-> HTTP 401.*$') { $Matches[0].Trim() } else { 'no 401 line' }))
    Check 'and the schemes the server offers are named, not guessed at' `
        ($out1 -match '(?i)The server offers:.*Negotiate') `
        ($(if ($out1 -match '(?m)^.*The server offers:.*$') { $Matches[0].Trim() } else { 'not in output' }))
    Check 'and it states that Basic is not among them' `
        ($out1 -match '(?i)Basic authentication is NOT among them')
    Check 'and says the credential cannot succeed, so it is not retyped' `
        ($out1 -match '(?i)cannot succeed here whatever it is')
    Check 'and names both ways forward: enable Basic in IIS, or use an API key' `
        ($out1 -match '(?i)enable Basic Authentication' -and $out1 -match '(?i)API [Kk]eys')
    Check 'and the wrong-URL explanation is still offered, because it is still possible' `
        ($out1 -match '(?i)EITHER the credential is wrong')

    # =========================================================================
    # 2. A site that DOES offer Basic. The accusation must not fire here, or it
    #    is not evidence -- it is a message that is always printed.
    # =========================================================================
    Write-Host '-- a site that does offer Basic --' -ForegroundColor Cyan
    $portBasic = Start-Fixture401 -Schemes @('Basic realm="bConnect"')
    $s2 = New-Scratch
    $out2 = Invoke-Installer -Work $s2.Root -Params ($s2.Common + @{
        BaseUrl = "http://127.0.0.1:$portBasic/bconnect"
        BasicUser = 'example\\operator'; BasicPassSecure = 'example-password'
    })
    Check 'the offered scheme is named' ($out2 -match '(?i)The server offers:.*Basic')
    Check 'and Basic is NOT accused, because the server accepts it' `
        ($out2 -notmatch '(?i)Basic authentication is NOT among them') `
        'here a 401 really does mean the credential or the URL is wrong'
    Check 'and the realm is not mistaken for a second scheme' `
        ($out2 -notmatch '(?i)The server offers:.*realm')

    # =========================================================================
    # 3. An API-key run against the same Negotiate-only site. No Authorization
    #    header is sent, so the Basic accusation must stay silent -- the header
    #    is what the accusation is about, not the site.
    # =========================================================================
    Write-Host '-- an API key against that same site --' -ForegroundColor Cyan
    $s3 = New-Scratch
    $out3 = Invoke-Installer -Work $s3.Root -Params ($s3.Common + @{
        BaseUrl = "http://127.0.0.1:$portNeg/bconnect"; ApiKeySecure = 'example-api-key'
    })
    Check 'the schemes are still named, because they are still useful' `
        ($out3 -match '(?i)The server offers:.*Negotiate')
    Check 'but Basic is not accused on a run that never sent it' `
        ($out3 -notmatch '(?i)Basic authentication is NOT among them')

    # =========================================================================
    # 4. Multiple schemes, comma-separated in one header, as IIS sends them.
    # =========================================================================
    Write-Host '-- several schemes in one header --' -ForegroundColor Cyan
    $portMulti = Start-Fixture401 -Schemes @('Negotiate, NTLM')
    $s4 = New-Scratch
    $out4 = Invoke-Installer -Work $s4.Root -Params ($s4.Common + @{
        BaseUrl = "http://127.0.0.1:$portMulti/bconnect"
        BasicUser = 'example\\operator'; BasicPassSecure = 'example-password'
    })
    Check 'both schemes are listed' `
        ($out4 -match '(?i)The server offers:.*Negotiate' -and $out4 -match '(?i)The server offers:.*NTLM') `
        ($(if ($out4 -match '(?m)^.*The server offers:.*$') { $Matches[0].Trim() } else { 'not in output' }))
    Check 'and Basic is still correctly reported as absent' `
        ($out4 -match '(?i)Basic authentication is NOT among them')

    # =========================================================================
    # 5. A dry run on a machine that has no Node yet.
    #
    # This is the reported defect, and it is the worst kind: the check ran before
    # the thing it needed existed. A dry run used to Abort in Step 1 with "a dry
    # run cannot continue without a Node runtime" -- and the wizard's Test button
    # IS a dry run, so the one control an operator presses to check the address
    # and the credential before installing could never work before installing.
    # Every first install on a clean machine hit it.
    #
    # The connectivity check needs no Node. So the run now answers what it can and
    # stops with a statement of what it could not.
    # =========================================================================
    Write-Host '-- a dry run before Node.js is installed --' -ForegroundColor Cyan
    $s5 = New-Scratch
    $runner5 = Join-Path $s5.Root 'nonode.ps1'
    New-Item -ItemType Directory -Path $s5.Root -Force | Out-Null
    @"
`$ErrorActionPreference = 'Continue'
# A machine that has never had Node: every directory holding node.exe leaves PATH.
`$keep = @()
foreach (`$p in (`$env:PATH -split ';')) { if (`$p -and -not (Test-Path (Join-Path `$p 'node.exe'))) { `$keep += `$p } }
`$env:PATH = (`$keep -join ';')
if (Get-Command node -ErrorAction SilentlyContinue) { Write-Host 'PATH SURGERY FAILED'; exit 9 }
`$k = ConvertTo-SecureString 'example-api-key' -AsPlainText -Force
& '$Installer' -NonInteractive -DryRun -SkipBuild -ContinueOnUnreachable ``
  -BaseUrl 'http://127.0.0.1:$portNeg/bconnect' -ApiKeySecure `$k ``
  -SuiteRoot '$SuiteRoot' -SecretsDir '$($s5.Root)\secrets' -ConfigPath '$($s5.Root)\cfg\c.json' ``
  -ProjectDir '$($s5.Root)\proj' -HostOutDir '$($s5.Root)\hostout' -StateFile '$($s5.Root)\state.json' ``
  -Hosts 'claude-desktop' -Servers 'bconnect-endpoints'
"@ | Set-Content -LiteralPath $runner5 -Encoding UTF8
    $out5 = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner5 2>&1 | Out-String

    Check 'the PATH surgery worked, so this proves something' ($out5 -notmatch 'PATH SURGERY FAILED')
    Check 'it does NOT abort in Step 1 for want of a runtime' `
        ($out5 -notmatch '(?i)dry run cannot continue without a Node runtime') `
        'that abort made Test useless on every machine that had not installed yet'
    Check 'it reaches the reachability step and contacts bConnect' `
        ($out5 -match '(?i)Step 4' -and $out5 -match 'WindowsEndpoints ->') `
        ($(if ($out5 -match '(?m)^.*WindowsEndpoints ->.*$') { $Matches[0].Trim() } else { 'never reached' }))
    Check 'and the scheme diagnosis still works without Node, being pure PowerShell' `
        ($out5 -match '(?i)The server offers:.*Negotiate')
    Check 'it says the certificate was NOT checked the way the servers will' `
        ($out5 -match '(?i)Node is not installed yet') `
        'silence here would read as a certificate that passed'
    Check 'and does not claim the certificate is good' `
        ($out5 -notmatch '(?i)certificate is valid and trusted')
    Check 'it stops before the steps it cannot preview, rather than guessing at them' `
        ($out5 -match '(?i)Dry run stopped early')
    Check 'and names what it did check and what it did not' `
        ($out5 -match '(?i)needing no Node' -and $out5 -match '(?i)Not checked')
    Check 'and nothing was written' ($out5 -match '(?i)Nothing was written')
}
finally {
    foreach ($j in $script:Jobs) {
        try { $j.Listener.Stop(); $j.Listener.Close() } catch { }
        try { $j.Ps.Dispose() } catch { }
    }
    if (-not $KeepWork -and (Test-Path -LiteralPath $WorkDir)) {
        Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("  $($script:Pass) passed, $($script:Fail) failed") -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
exit $(if ($script:Fail) { 1 } else { 0 })
