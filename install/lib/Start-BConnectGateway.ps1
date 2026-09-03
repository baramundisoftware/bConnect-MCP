<#
.SYNOPSIS
    Start the bConnect MCP gateway with credentials read from the installer's
    credentials file, plaintext or DPAPI-protected.

.DESCRIPTION
    The gateway (bConnect-MCP-main\bconnect-mcp-gateway) serves all thirteen MCP
    servers over Streamable HTTP on one port, one URL per domain:

        POST http://<bind>:<port>/<domain>/mcp

    It is the bridge for every host that cannot spawn a local process -- n8n, Open
    WebUI, OpenAI's hosted MCP tool, Copilot Studio -- and it is genuinely better
    than the stdio servers on two counts: it performs no startup connectivity probe
    (so finding B1 does not apply), and its rate limiter is held in a closure across
    requests instead of being rebuilt per call (so finding B8 does not apply -- it
    is the reference implementation of that fix).

    THE AUTHENTICATION STORY, STATED BEFORE ANYTHING ELSE
    ----------------------------------------------------
    The gateway authenticates callers with a shared bearer token (SEC-7) when
    MCP_GATEWAY_AUTH_TOKEN is present in the credentials file -- which it is, for
    any installation configured with -Gateway. Every call to /<domain>/mcp must
    carry "Authorization: Bearer <token>" or the gateway answers 401. /health is
    exempt so probes work.

    This script does not need a switch for that: the token is one of the KEY=value
    pairs it already reads out of the credentials file and passes into the child's
    environment block, so it is carried by the same mechanism as the bMS password
    and never touches a command line.

    What the token does NOT do is TLS or identity. It holds ONE bConnect service
    credential and every authenticated caller gets that credential's full reach;
    only bMS RBAC bounds what it can do. Authentication of a PERSON, and encryption
    of the hop, remain the fronting reverse proxy's job (ADR-0003).

    Three consequences worth being blunt about:

      * On loopback (the default) with no token it is reachable by anything running
        as any user on this machine. That is an acceptable posture for a
        single-operator Windows server and it is what this script defaults to.

      * On any other address the gateway fails closed: it refuses to start unless
        it has a token, or MCP_ALLOW_NO_AUTH=true asserts a proxy is in front.
        That assertion is YOURS and nothing checks it, so this script also requires
        -IUnderstandThereIsNoAuth when there is no token -- the claim has to be
        made twice, in two places, by someone who read at least one of them. With a
        token in the credentials file, neither is needed and nothing has to be
        asserted at all. That is the point: the secure path is the short one.

      * A token on plain HTTP crosses the wire in clear text. Off-host means TLS,
        which means a proxy.

    A third control saved this project once already: the Windows firewall had no
    rule for the port, so even with a non-loopback bind and MCP_ALLOW_NO_AUTH=true
    the service stayed unreachable from the network. Two independent controls had
    to fail. Keep it that way -- do not open the port "to test".

.PARAMETER EnvFile
    The credentials file. A .dpapi container is decrypted in memory; a plain .env is
    read as-is. Defaults to <project>\secrets\bconnect.env, preferring the protected
    form if both exist.

.PARAMETER SuiteRoot
    The suite root containing bconnect-mcp-gateway. Defaults to
    <installer parent>\bConnect-MCP-main.

.PARAMETER Bind
    Listen address. Default 127.0.0.1. Anything else needs -IUnderstandThereIsNoAuth.

.PARAMETER Port
    Listen port. Default 3001.

.PARAMETER IUnderstandThereIsNoAuth
    Required for a non-loopback bind WHEN THE CREDENTIALS FILE HAS NO
    MCP_GATEWAY_AUTH_TOKEN. Sets MCP_ALLOW_NO_AUTH=true for the child. With a
    token present this switch is unnecessary and is not passed on: asserting "a
    proxy authenticates for me" while the gateway is itself authenticating would
    misdescribe what is protecting the port.

.PARAMETER Wait
    Run in the foreground and stream the gateway's output. Without it the gateway is
    started detached and this script returns once the health endpoint answers.

.NOTES
    Exit codes: 0 started (or exited cleanly with -Wait); 92 this launcher failed.
    92 is outside the range the gateway uses, so "the launcher failed" is
    distinguishable from "the gateway failed".
#>
[CmdletBinding()]
param(
    [string] $EnvFile,
    [string] $SuiteRoot,
    [string] $Bind = '127.0.0.1',
    [int]    $Port = 3001,
    [string] $NodeExe,
    [string] $LogDir,
    [switch] $IUnderstandThereIsNoAuth,
    [switch] $Wait,
    [int]    $StartTimeoutSec = 30
)

$ErrorActionPreference = 'Stop'

function Say  { param([string]$m) Write-Host ('  ' + $m) }
function Warn { param([string]$m) Write-Host ('  [warn] ' + $m) -ForegroundColor Yellow }
function Die  { param([string]$m) Write-Host ('  [FAIL] ' + $m) -ForegroundColor Red; exit 92 }

$LibDir      = $PSScriptRoot
$InstallerDir = Split-Path -Parent $LibDir
$ProjectRoot = Split-Path -Parent $InstallerDir
if (-not $SuiteRoot) { $SuiteRoot = Join-Path $ProjectRoot 'bConnect-MCP-main' }

Import-Module (Join-Path $LibDir 'Dpapi.psm1') -Force -DisableNameChecking

if (-not $EnvFile) { $EnvFile = Join-Path $ProjectRoot 'secrets\bconnect.env' }
$store = Get-CredentialStoreState -EnvFile $EnvFile
if ($store.Mode -eq 'none') { Die "no credentials file at $EnvFile (or its .dpapi form). Run the installer first." }

$gatewayDir  = Join-Path $SuiteRoot 'bconnect-mcp-gateway'
$gatewayMain = Join-Path $gatewayDir 'build\gateway.js'
$preload     = Join-Path $gatewayDir 'build\preload.js'
if (-not (Test-Path -LiteralPath $gatewayMain)) {
    Die ("the gateway is not built: $gatewayMain is missing.`n" +
         "         Build it with:  npm run build  (run inside $gatewayDir)`n" +
         "         Note the suite's root build script globs bconnect-*-mcp and therefore`n" +
         "         skips the gateway, whose directory is bconnect-mcp-gateway. Building`n" +
         "         'everything' does not build this.")
}

if (-not $NodeExe) {
    $c = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $c) { Die 'node.exe is not on PATH and -NodeExe was not supplied.' }
    $NodeExe = $c.Source
}

# --- credentials into the child's environment block, never onto a command line
# Read BEFORE the bind decision: whether a bearer token exists is now part of that
# decision, and the token lives in this file alongside the bMS credential.
$vars = $null
try {
    $envText = Read-BConnectEnvText -EnvFile $EnvFile
    $vars = ConvertFrom-EnvText -Text $envText
    $envText = $null
} catch {
    Die ('could not read credentials: ' + $_.Exception.Message)
}
if (-not $vars -or $vars.Count -eq 0) { Die "no KEY=value pairs found in $($store.ActivePath)" }

# --- the bind decision, made loudly ------------------------------------------
$isLoopback = ($Bind -eq '127.0.0.1' -or $Bind -eq '::1' -or $Bind -eq 'localhost')
# SEC-7. Presence and MINIMUM LENGTH, both -- the gateway itself refuses to start
# on a token under 24 characters, and catching that here means the operator gets
# the sentence that explains it instead of a dead child process and a log file.
$rawToken   = [string]$vars['MCP_GATEWAY_AUTH_TOKEN']
$activeTok  = if ($rawToken) { ($rawToken -split ',')[0].Trim() } else { '' }
$hasToken   = ($activeTok.Length -ge 24)
if ($rawToken -and -not $hasToken) {
    Die ("MCP_GATEWAY_AUTH_TOKEN in $($store.ActivePath) is only $($activeTok.Length)`n" +
         "         characters. The gateway requires at least 24 and will refuse to start:`n" +
         "         this token is the only thing between a caller and a bMS service`n" +
         "         credential, and a guessable one is worse than none because it reads as`n" +
         "         protection. Re-run the installer with -Gateway -RotateGatewayToken to`n" +
         "         have a 43-character one generated.")
}

if (-not $isLoopback -and -not $hasToken) {
    if (-not $IUnderstandThereIsNoAuth) {
        Die ("refusing to bind $Bind with no authentication. On a routable address`n" +
             "         this is an unauthenticated door to your estate, holding one bConnect`n" +
             "         service credential that bMS RBAC alone bounds.`n" +
             "         The short way out: re-run the installer with -Gateway, which puts an`n" +
             "         MCP_GATEWAY_AUTH_TOKEN in the credentials file and requires callers to`n" +
             "         present it. Then this switch is not needed at all.`n" +
             "         The other way: if an authenticating, TLS-terminating reverse proxy`n" +
             "         really is in front of it, re-run with -IUnderstandThereIsNoAuth.`n" +
             "         Nothing checks whether that is true, which is why you have to say it.")
    }
    Warn "binding $Bind with MCP_ALLOW_NO_AUTH=true -- the gateway will not authenticate anyone."
    Say  'Everything reaching this port gets the full reach of the service credential.'
    Say  'Publish the PROXY, not this. And leave the firewall rule closed.'
} elseif (-not $isLoopback) {
    Warn "binding $Bind with a bearer token -- callers are authenticated, the hop is NOT encrypted."
    Say  'A token on plain HTTP is readable by anything on the path. Put TLS in front'
    Say  'before this crosses a network you do not control, and leave the firewall closed.'
}

if (-not $LogDir) { $LogDir = Join-Path $env:LOCALAPPDATA 'bconnect-mcp\logs' }
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$OutLog = Join-Path $LogDir 'gateway.out.log'
$ErrLog = Join-Path $LogDir 'gateway.err.log'

$psi = New-Object System.Diagnostics.ProcessStartInfo
# --import takes a URL, not a path. Node's ESM loader rejects "C:\..." outright --
# it reads the drive letter as a scheme ("protocol 'c:'") -- so an absolute Windows
# path has to be converted to a file:// URL. The gateway's own npm start script
# gets away with "./build/preload.js" because it is relative; this launcher is not
# run from the gateway directory and cannot be.
$preloadUrl = ([Uri](New-Object System.Uri($preload))).AbsoluteUri
$nodeCmdLine = '"' + $NodeExe + '" --import "' + $preloadUrl + '" "' + $gatewayMain + '"'
$psi.FileName         = $NodeExe
$psi.Arguments        = '--import "' + $preloadUrl + '" "' + $gatewayMain + '"'
$psi.WorkingDirectory = $gatewayDir
$psi.UseShellExecute  = $false
foreach ($k in $vars.Keys) { $psi.EnvironmentVariables[[string]$k] = [string]$vars[$k] }
$psi.EnvironmentVariables['MCP_GATEWAY_BIND'] = $Bind
$psi.EnvironmentVariables['MCP_GATEWAY_PORT'] = [string]$Port
# MCP_GATEWAY_AUTH_TOKEN is already in $vars if the credentials file carries one,
# so it is copied above with everything else -- no special case, no command line.
# MCP_ALLOW_NO_AUTH is only asserted when there is genuinely nothing to authenticate
# with. Setting it alongside a token would be a lie about what is protecting this.
if (-not $isLoopback -and -not $hasToken) { $psi.EnvironmentVariables['MCP_ALLOW_NO_AUTH'] = 'true' }
# The gateway serves HTTP, so its stdout is NOT a protocol channel -- unlike the
# stdio servers, where one stray byte kills the session. Its own logger writes to
# stderr; mcp-core's audit still writes to stdout (finding B5), which is harmless
# here and is why B5 is only "partly" applicable to the gateway.

Say ("gateway      $gatewayMain")
Say ("credentials  $($store.ActivePath)  [$($store.Mode)]")
Say ("listening    http://${Bind}:${Port}   (one URL per domain: /<domain>/mcp)")
if ($hasToken) {
    Say ("auth         BEARER TOKEN required on every /<domain>/mcp call (/health exempt).")
    Say ("             Header:  Authorization: Bearer <MCP_GATEWAY_AUTH_TOKEN>")
    Say ("             Value:   in $($store.ActivePath) -- not printed here.")
    if ($rawToken -like '*,*') {
        Say ("             ROTATION WINDOW: two tokens are configured and BOTH work. Drop")
        Say ("             the second once every client is on the first.")
    }
} else {
    Say ("auth         NONE -- delegated to a fronting proxy (ADR-0003). " + $(if ($isLoopback) { 'Loopback only.' } else { 'ASSERTED proxy in front.' }))
    Say ("             Re-run the installer with -Gateway to have a token generated.")
}

if ($Wait) {
    $p = [System.Diagnostics.Process]::Start($psi)
    foreach ($k in @($vars.Keys)) { $vars[$k] = $null }
    $vars = $null; $psi.EnvironmentVariables.Clear(); [GC]::Collect()
    $p.WaitForExit()
    exit $p.ExitCode
}

# --- detached: the gateway's output MUST go to files, not to our pipes ---------
# This cost a debugging session, so it is written down. The obvious detached shape
# -- RedirectStandardOutput/Error = $true, start, return -- kills the gateway. The
# launcher exits, the read ends of those pipes close, and the first thing the
# gateway writes afterwards (the access log line for the very first request) hits a
# broken pipe and takes node down with it. Symptom: /health answers, then the first
# POST fails with a bare "fetch failed" and the process is gone. Nothing is logged,
# because the thing that died was the logging.
#
# So cmd.exe does the redirection instead, into real files. The credentials still
# travel in the ENVIRONMENT BLOCK -- cmd inherits it and passes it to node -- and
# never on a command line; the command line is node plus two paths.
$psi.FileName  = 'cmd.exe'
# The outer pair of quotes is cmd's own rule, not decoration: when the command
# after /c begins with a quote, cmd strips the first and last quote of the whole
# line. Without the extra pair, "C:\Program Files\nodejs\node.exe" is split at the
# space and cmd reports 'C:\Program' is not recognized.
$psi.Arguments = '/c "' + $nodeCmdLine + ' >"' + $OutLog + '" 2>"' + $ErrLog + '""'
$p = [System.Diagnostics.Process]::Start($psi)
foreach ($k in @($vars.Keys)) { $vars[$k] = $null }
$vars = $null; $psi.EnvironmentVariables.Clear(); [GC]::Collect()

# Wait for the health endpoint rather than for a log line: the health endpoint is
# what a client will actually use, and a log line only proves the logger works.
$healthUrl = "http://${Bind}:${Port}/health"
$deadline  = (Get-Date).AddSeconds($StartTimeoutSec)
$ok = $false
while ((Get-Date) -lt $deadline) {
    if ($p.HasExited) { break }
    try {
        $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
        if ([int]$r.StatusCode -eq 200) { $ok = $true; break }
    } catch { Start-Sleep -Milliseconds 400 }
}

if (-not $ok) {
    if (-not $p.HasExited) { try { $p.Kill() } catch { } }
    Write-Host ''
    Write-Host '  [FAIL] the gateway did not answer /health' -ForegroundColor Red
    foreach ($f in @($ErrLog, $OutLog)) {
        if (Test-Path -LiteralPath $f) {
            $txt = @(Get-Content -LiteralPath $f -ErrorAction SilentlyContinue | Where-Object { $_.Trim() } | Select-Object -Last 12)
            if ($txt.Count) {
                Write-Host ('         ' + $f + ':') -ForegroundColor Yellow
                foreach ($l in $txt) { Write-Host ('           ' + $l) -ForegroundColor DarkYellow }
            }
        }
    }
    Write-Host '         Common causes: the credentials file does not authenticate; the port is' -ForegroundColor Yellow
    Write-Host '         already in use; the gateway was never built (its directory is' -ForegroundColor Yellow
    Write-Host '         bconnect-mcp-gateway, which the suite root build script does not match).' -ForegroundColor Yellow
    exit 92
}

# The process this launcher started is cmd.exe, which owns the redirection; node is
# its child. Report node's pid, because that is the one an operator will want to
# stop, and stopping cmd would leave node listening.
$nodePid = $p.Id
try {
    $kid = Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $p.Id) -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -eq 'node.exe' } | Select-Object -First 1
    if ($kid) { $nodePid = $kid.ProcessId }
} catch { }

Say ("started, node pid $nodePid -- $healthUrl answered 200")
Say ("logs         $OutLog")
Say ("             $ErrLog")
Say ('verify it with:  node "' + (Join-Path $LibDir 'verify-gateway.mjs') + '" --url http://' + $Bind + ':' + $Port +
     $(if ($hasToken) { '   (set MCP_GATEWAY_AUTH_TOKEN in your shell first)' } else { '' }))
Say ("stop it with:    Stop-Process -Id $nodePid")
exit 0
