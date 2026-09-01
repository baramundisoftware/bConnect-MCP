<#
.SYNOPSIS
    Guided installer for the bConnect-MCP suite on Windows.

.DESCRIPTION
    Takes a Windows machine from "the suite is on disk" to "a verified, working
    Claude Desktop configuration", asking questions instead of assuming answers.

    It checks prerequisites, collects credentials without ever echoing or logging
    them, hardens the secrets DIRECTORY before writing into it, builds the suite,
    lets you choose which servers to enable (showing what each one costs you in
    context), handles the write gate explicitly, merges rather than overwrites your
    Claude Desktop configuration, and then verifies the configuration it just wrote
    by starting each server exactly the way Claude Desktop will.

    Re-runnable, and stateful about it. The governing rule is:

        AN OPTION THE OPERATOR IS NOT ASKED ABOUT ON THIS RUN KEEPS THE VALUE IT HAS.

    That is enforced by construction rather than by remembering: the credentials file
    is edited key-by-key (Merge-EnvText) instead of rebuilt, and the per-server env
    block of every host entry is read before it is written. What was true stays true
    unless something on this command line says otherwise.

    Each run leaves an installation record at install\state\installation.json -- non-
    secret, world-readable, and the thing that lets a later run know which hosts to
    re-emit to and which write gates to preserve. See lib\State.psm1.

    For everyday changes there is a verb front end over this same script:
    install\bconnect.ps1 (status, set url, writes enable/disable, servers add/remove,
    hosts add/remove/resync, gateway rotate-token, protect, verify, uninstall).

.PARAMETER SuiteRoot
    The bConnect-MCP suite root (the directory containing bconnect-*-mcp and
    package.json). Defaults to <installer parent>\bConnect-MCP-main.

.PARAMETER SecretsDir
    Directory for the credentials file. Defaults to <installer parent>\secrets.
    It is created with a restrictive, inheritable ACL BEFORE anything is written
    into it -- see Step 5, and Set-HardenedDirectoryAcl in lib\Secrets.psm1.

.PARAMETER ConfigPath
    Claude Desktop configuration to merge into.
    Defaults to %APPDATA%\Claude\claude_desktop_config.json.

.PARAMETER Servers
    Comma-separated server names to enable, skipping the interactive selection.
    Example: -Servers bconnect-endpoints,bconnect-jobs

.PARAMETER RemoveUnselected
    With -Servers, also remove bconnect-* entries that are configured but not in
    the list. Without it a scripted run leaves them alone.

.PARAMETER ReuseCredentials
    Keep the existing credentials file as-is and do not prompt for secrets.

.PARAMETER ReadOnly
    Force a read-only posture and skip the write-gate questions.

.PARAMETER SkipBuild
    Do not build. Only sensible when the build output is known to be current.

.PARAMETER VerifyOnly
    Run only the verification pass against the existing configuration.

.PARAMETER DryRun
    Do everything except write: no credentials file, no configuration change, no
    build. Reports exactly what would change.

.PARAMETER ProbeAllowlistPositive
    During verification, also call one ALLOWED write tool with an all-zeros GUID to
    prove the allowlist permits as well as blocks. The call reaches bConnect and is
    rejected there as a bad identifier; nothing is created. Off by default.

.PARAMETER ProtectCredentials
    Store the credentials DPAPI-encrypted (CurrentUser scope, with entropy) instead of
    in plaintext, and configure Claude Desktop to launch each server through
    lib\Start-BConnectServer.ps1, which decrypts in memory and hands the values to node
    through the child's environment block. Opt-in; plaintext remains the default.

.PARAMETER PlaintextCredentials
    The opposite, and the way back: convert a protected installation to plaintext and
    rewrite the Desktop configuration to launch node directly again.

.PARAMETER NonInteractive
    Ask nothing. Every answer must come from a parameter; anything unanswerable is a
    hard error with the missing parameter named, never a hang on a prompt no-one can
    see. This is the mode the WPF wizard (Install-BConnectMcp-UI.ps1) drives the
    script in -- the wizard collects the answers, this script does the work, and there
    is exactly one implementation of the work.

.PARAMETER BaseUrl
    The bConnect base URL, for -NonInteractive.

.PARAMETER ReplacingBaseUrl
    The base URL the caller expects this installation to be pointed at right now.

    One installation serves one bConnect server. A run whose -BaseUrl names a
    DIFFERENT server than the record does is refused, because the host-config
    entries are keyed by bare server name and would be overwritten in place --
    re-pointing every configured client at the other estate with nothing visible
    changing. See Get-EstateChange in lib\State.psm1 for what that costs.

    Passing the recorded URL here says "I have read the record and I am re-pointing
    this one installation", which is the supported way to move an installation
    between estates. install\bconnect.ps1 `set url` is the caller that passes it;
    it reads the value out of the record rather than being told it.

    Deliberately a URL and not a switch: a switch is a force flag, and a force flag
    added to a deployment job once restores the silent overwrite for good.

.PARAMETER ApiKeySecure
    The API key as a SecureString, for -NonInteractive.

    There is still no -ApiKey. A [SecureString] cannot be typed as plaintext on a
    command line, does not render in a transcript or in PSReadLine history, and is
    not visible in the process list -- so this parameter cannot be used the way a
    plaintext -ApiKey would have been. It exists to be passed programmatically, in
    process, by the wizard.

.PARAMETER BasicPassSecure
    The Basic password as a SecureString, for -NonInteractive. Pair with -BasicUser.

.PARAMETER V11PassSecure
    The bConnect v1.1 Basic password as a SecureString. Pair with -V11User.

.PARAMETER ContinueOnUnreachable
    In -NonInteractive, continue even if the Step 4 reachability check fails. Without
    it an unreachable bConnect stops the run, which is the safer default.

.PARAMETER WriteGate
    The write gate, expressed as data instead of typed confirmations, for
    -NonInteractive. A hashtable of server name -> allowed write tools:

        @{ 'bconnect-jobs' = @('create_job_instance','start_job_instance') }
        @{ 'bconnect-endpoints' = @('*') }     # every write tool in that server
        @{ 'bconnect-jobs' = @() }             # REMOVE the gate from this server

    A server ABSENT from the hashtable keeps whatever gate it already has. That is
    the reconfigure rule, and it is a deliberate change: this parameter used to mean
    "everything not named here is read-only", so a re-run that said nothing about
    writes silently removed an existing gate and never printed the word "removed".
    Measured, that is exactly what happened. To turn a gate off, name the server
    with an empty list; to turn every gate off, pass -ReadOnly.

    '*' is the equivalent of typing ENABLE WRITES with no allowlist; the wizard still
    requires the typed confirmation in its own UI before it will build such an entry,
    but a script calling this parameter directly is trusted to have meant it.

.PARAMETER Stage
    Which half of the install to do: Machine, User, or Both. Defaults to Both,
    which is exactly what this script did before the stages existed -- an
    unspecified -Stage changes nothing about any existing run or wizard.

    The split exists because an stdio MCP server is a local process that the CLIENT
    APPLICATION starts, on the machine that application runs on. Every administrator
    therefore needs this on their own workstation, which means it has to be
    deployable by baramundi -- and two things make a single silent run wrong:

      * Host configurations resolve to per-user paths. A baramundi job runs as
        SYSTEM or a service account, whose %APPDATA% is
        C:\Windows\System32\config\systemprofile\AppData\Roaming. A silent run
        writing there produces files no client ever reads, and reports success.
      * DPAPI protection is CurrentUser scope, deliberately. A blob written by a
        service account is decryptable by that account only.

    So:

      Machine   Node, the suite, the install location, and the installation record
                carrying the INTENDED client list. Writes nothing to a per-user
                path and collects no credential. Runs as SYSTEM, silently.
      User      Credentials, DPAPI protection, this administrator's own client
                configurations, and verification. Runs in that administrator's
                login, once.
      Both      As now.

    A context with no interactive user profile is REFUSED the user half. -Stage
    Machine is permitted from it, which is the point of it.

    THE THREE SILENT CASES, AS COMMAND LINES

    1. Machine stage, for a workstation rollout. This is what a baramundi package
       carries; it runs as SYSTEM and exits 0.

        powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass ^
          -File "C:\Program Files\bConnect-MCP\install\Install-BConnectMcp.ps1" ^
          -Stage Machine -NonInteractive ^
          -SuiteRoot "C:\Program Files\bConnect-MCP\bConnect-MCP-main" ^
          -SecretsDir "C:\ProgramData\bConnect-MCP\secrets" ^
          -StateFile  "C:\ProgramData\bConnect-MCP\installation.json" ^
          -Servers bconnect-endpoints,bconnect-jobs,bconnect-compliance ^
          -Hosts claude-desktop,vscode

       -Hosts here records INTENT. No client file is written and -ProjectDir is not
       required, because the workspace belongs to whoever opens it.

    2. User stage, once per administrator, in that administrator's own login. It
       reads the intended client list out of the record, so it needs only the
       answers that are personal. A masked prompt is the only way to enter a
       credential interactively; the form below is the silent one, and it must
       build the SecureString in process because there is deliberately no -ApiKey.

        powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
          "& { $k = Read-Host 'bConnect API key' -AsSecureString; ^
               & 'C:\Program Files\bConnect-MCP\install\Install-BConnectMcp.ps1' ^
                 -Stage User -NonInteractive ^
                 -StateFile 'C:\ProgramData\bConnect-MCP\installation.json' ^
                 -BaseUrl 'https://bms.corp.example/bconnect' -ApiKeySecure $k ^
                 -ProjectDir 'C:\Repos\infra' }"

       -ProjectDir is required only when the intended clients include a
       per-workspace target (vscode, claude-code, cursor).

    3. A central/gateway install, fully silent, credential included. This shape
       holds no per-user state at all -- HTTP clients connect over the network, the
       emitted snippets go to install\out, which the machine owns -- so it is a
       single -Stage Both run and it is permitted from a service context. Do not
       add -ProtectCredentials to it: DPAPI would bind the credential to the
       service account.

        powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
          "& { $k = ConvertTo-SecureString $env:BCONNECT_API_KEY -AsPlainText -Force; ^
               & 'C:\Program Files\bConnect-MCP\install\Install-BConnectMcp.ps1' ^
                 -NonInteractive -Hosts n8n,open-webui,generic ^
                 -Gateway -GatewayBind 0.0.0.0 -GatewayPort 3001 -StartGateway ^
                 -SuiteRoot 'C:\Program Files\bConnect-MCP\bConnect-MCP-main' ^
                 -SecretsDir 'C:\ProgramData\bConnect-MCP\secrets' ^
                 -StateFile  'C:\ProgramData\bConnect-MCP\installation.json' ^
                 -BaseUrl 'https://bms.corp.example/bconnect' -ApiKeySecure $k ^
                 -Servers bconnect-endpoints,bconnect-jobs }"

       The service credential reaches the process through the environment of the
       job, never through a command line. A non-loopback -GatewayBind is accepted
       because -Gateway generates a bearer token; put a TLS-terminating,
       authenticating reverse proxy in front of it (ADR-0003).

    The deployment SHAPE is not a parameter and deliberately never becomes one. It
    is the pair -Hosts and -Gateway, which already exist. A shape switch would put
    a second decision-maker in the engine, and this project's most repeated defect
    is a second implementation that drifts.

.PARAMETER StateFile
    The installation record. Defaults to install\state\installation.json. It holds no
    secret -- the v1.1 username is an identity, and the gateway token is recorded as
    a fact, never a value -- so it is readable without DPAPI, which is what lets a
    reconfigure describe an installation it cannot yet decrypt.

.PARAMETER Uninstall
    Remove this installation: the bconnect-* entries from every recorded host file
    (leaving everything else byte-identical), the launcher-shim references, the
    credentials file, the record, and the emitted snippets in install\out.

    It prints what it did NOT remove -- above all that the bMS API key itself can only
    be revoked in the bMS console. An uninstall that leaves a live credential and does
    not say so is worse than no uninstall.

.PARAMETER KeepCredentials
    With -Uninstall, leave the credentials file where it is.

.PARAMETER HostEntriesOnly
    With -Uninstall, strip the managed entries from the named hosts and stop there:
    the credentials, the record and the emitted snippets are left alone. This is what
    `bconnect hosts remove <id>` is, and it is why removing one host is not a
    half-uninstall of everything else.

.PARAMETER BuildSelectedOnly
    Build @bconnect/mcp-core and the selected servers only, rather than every package
    on disk. Adding one server should not recompile thirteen others.

.PARAMETER Force
    Permit two things that are otherwise refused because they destroy something
    recoverable: overwriting a credentials file that cannot be decrypted (usually the
    wrong Windows account, not a corrupt file), and overwriting a managed host entry
    that has been edited by hand since the last run.

.PARAMETER CaCert
    Path to a PEM CA certificate, for -NonInteractive. (Named -CaCert rather than
    -CaCertPath only because the script already uses $CaCertPath internally.)

.PARAMETER EmitProgress
    Emit machine-readable step records on the Information stream, tagged
    'bconnect.progress', alongside the normal human output. Silent in a console
    (Write-Information honours $InformationPreference, which is SilentlyContinue by
    default), so a headless run looks exactly as it did before. The wizard reads these
    records to drive its step list.

.PARAMETER Hosts
    Which host applications to configure, comma-separated. Defaults to
    'claude-desktop', which is exactly what this script did before host targets
    existed -- an unspecified -Hosts changes nothing about an existing run.

        -Hosts claude-desktop,claude-code,vscode
        -Hosts all            every target the registry knows
        -Hosts generic        just print the command line and a portable JSON block

    The registry is lib\hosts.json: it carries each host's file location, container
    key, per-entry shape, the documentation URL that shape was read from, and --
    the part that matters -- the claims deliberately NOT made about it. Run
    -ListHosts to see the table.

    The servers themselves are unchanged by this. They are ordinary stdio MCP
    servers plus one HTTP gateway; nothing in them is specific to any vendor. The
    only vendor-specific thing in an install is which file gets written.

.PARAMETER ProjectDir
    The workspace directory for targets whose config is per-project (Claude Code's
    .mcp.json, VS Code's .vscode\mcp.json, Cursor's .cursor\mcp.json) -- the folder
    you will open in the editor. There is no default: those files are only read from
    the workspace that is open, so the installer asks, or refuses when
    -NonInteractive. A previous run's answer is reused from the installation record.

.PARAMETER BundleManifest
    The offline-bundle manifest to verify before installing. Defaults to
    offline-bundle.json beside the installer's parent directory, which is where
    lib\New-OfflineBundle.ps1 writes it; the paths inside it are relative to the
    manifest, so a bundle is checkable wherever it was copied to. When there is no
    manifest, nothing is checked and nothing is said.

.PARAMETER HostOutDir
    Where snippets and companion notes are written for targets whose configuration
    cannot be a file we own (LibreChat's YAML, and the four hosts configured in a
    web UI). Defaults to install\out.

.PARAMETER HostPath
    Per-target path overrides: @{ 'vscode' = 'C:\some\other\mcp.json' }.

.PARAMETER ListHosts
    Print the host-target table -- id, transport, where it writes, and how each one
    was verified -- and exit. Changes nothing.

.PARAMETER Gateway
    Configure the HTTP gateway as well. Required by every host that cannot spawn a
    local process (n8n, Open WebUI, OpenAI's hosted MCP tool, Copilot Studio) and
    selected automatically when one of those is in -Hosts.

    THE GATEWAY AUTHENTICATES CALLERS WITH A BEARER TOKEN, AND THIS INSTALLER
    GENERATES IT FOR YOU (SEC-7). Selecting -Gateway writes a 43-character random
    MCP_GATEWAY_AUTH_TOKEN into the same ACL-hardened credentials file the launcher
    already reads, and prints it once so you can paste it into n8n / Open WebUI.
    Every call to POST /<domain>/mcp must then carry

        Authorization: Bearer <that token>

    or the gateway answers 401. /health stays open so container probes work.

    What the token is NOT: an identity system. It says "this caller may talk to the
    gateway", not "this caller is Alice". TLS and per-user identity remain the
    fronting reverse proxy's job (ADR-0003). Downstream, one bConnect service
    credential still does all the work and bMS RBAC still bounds it.

    Why this exists at all: the shipped docker-compose used to set
    MCP_ALLOW_NO_AUTH=true and the image bound 0.0.0.0, so the gateway's own
    fail-closed guard was satisfied before an operator ever saw it. A secure
    default that is painful to configure gets turned off, so the installer does
    the configuring.

.PARAMETER GatewayBind
    Gateway listen address, default 127.0.0.1. Anything else needs a token (which
    -Gateway now supplies) or -GatewayIUnderstandThereIsNoAuth.

.PARAMETER GatewayPort
    Gateway listen port, default 3001.

.PARAMETER RotateGatewayToken
    Issue a NEW gateway bearer token and keep the previous one alongside it for one
    generation: the file ends up with "<new>,<old>" and the gateway accepts both.
    Move every client to the new value, then re-run without this switch to drop the
    old one. A rotation that requires downtime does not get done, so this one does
    not require any.

.PARAMETER GatewayIUnderstandThereIsNoAuth
    Permit a non-loopback gateway bind WITHOUT a gateway token, asserting that an
    authenticating, TLS-terminating reverse proxy is in front of it. Nothing
    verifies that assertion, which is precisely why it has to be made by hand.
    With -Gateway you get a token anyway, and then you do not need this.

.PARAMETER StartGateway
    Start the gateway at the end of the run and verify it with a real MCP session
    over Streamable HTTP. Without it the gateway is configured and documented but
    not launched.

.EXAMPLE
    .\Install-BConnectMcp.ps1
    Full guided installation.

.EXAMPLE
    .\Install-BConnectMcp.ps1 -ListHosts
    Print the host-target table and exit.

.EXAMPLE
    .\Install-BConnectMcp.ps1 -Hosts claude-desktop,claude-code,vscode,generic
    Configure three hosts plus the portable fallback block.

.EXAMPLE
    .\Install-BConnectMcp.ps1 -Hosts librechat,continue -Servers bconnect-endpoints
    A self-hosted, no-internet stack: two clients that speak MCP and drive a local
    model. Nothing leaves the network.

.EXAMPLE
    .\Install-BConnectMcp.ps1 -Hosts n8n,open-webui -Gateway -StartGateway
    Configure and verify the HTTP gateway for two hosts that cannot spawn a local
    process, then prove it serves real data over Streamable HTTP.

.EXAMPLE
    .\Install-BConnectMcp.ps1 -VerifyOnly
    Re-verify the live configuration after a change.

.EXAMPLE
    .\Install-BConnectMcp.ps1 -DryRun -ConfigPath C:\temp\config-copy.json
    Rehearse against a copy of the configuration, changing nothing.

.EXAMPLE
    .\Install-BConnectMcp.ps1 -ProtectCredentials
    Guided installation that stores the credentials DPAPI-encrypted.

.EXAMPLE
    .\Install-BConnectMcp.ps1 -PlaintextCredentials -ReuseCredentials -Servers bconnect-endpoints
    Convert an existing protected installation back to plaintext without re-typing
    anything.

.NOTES
    There is deliberately NO -ApiKey parameter. A secret passed on a command line
    lands in the PowerShell history file, the process list and any transcript.
    Secrets are only ever accepted through a masked prompt, or as a [SecureString]
    passed in-process by a caller such as the WPF wizard.
#>
[CmdletBinding()]
param(
    [string] $SuiteRoot,
    [string] $SecretsDir,
    [string] $ConfigPath,
    [string] $Servers,
    [switch] $RemoveUnselected,
    [switch] $ReuseCredentials,
    [switch] $ReadOnly,
    [switch] $SkipBuild,
    [switch] $VerifyOnly,
    [switch] $DryRun,
    [switch] $ProbeAllowlistPositive,

    # --- which half of the install to do (default: both, i.e. exactly as before) -
    [ValidateSet('Machine', 'User', 'Both')] [string] $Stage = 'Both',

    # --- the installation record, and the way back out --------------------------
    [string] $StateFile,
    [string] $BundleManifest,
    [switch] $Uninstall,
    [switch] $KeepCredentials,
    [switch] $HostEntriesOnly,
    [switch] $BuildSelectedOnly,
    [switch] $Force,

    # --- the Node.js runtime ------------------------------------------------------
    # Absent, the runtime is taken from this computer if it is adequate, else from
    # media staged in install\packaging\redist. -AllowNodeDownload adds the third
    # option -- fetch it from nodejs.org and verify it against the published
    # SHASUMS256.txt -- and is opt-in for one reason: an install the operator
    # believes is offline must never make a silent outbound call. The whole
    # decision is in lib\NodeProvisioning.psm1.
    [switch] $AllowNodeDownload,
    [string] $NodeMediaPath,

    # --- credential protection (opt-in; plaintext stays the default) -------------
    [switch] $ProtectCredentials,
    [switch] $PlaintextCredentials,

    # --- non-interactive operation (what the WPF wizard drives) ------------------
    [switch] $NonInteractive,
    [string] $BaseUrl,
    [string] $ReplacingBaseUrl,
    [System.Security.SecureString] $ApiKeySecure,
    # Optional. Scope (JOBS, COMPLIANCE) -> SecureString. Each becomes
    # BCONNECT_API_KEY__<SCOPE> in the credentials file, which mcp-core prefers
    # over the shared BCONNECT_API_KEY for that one server. Absent or empty
    # means every server uses the shared key, which is the default and the
    # behaviour this installer had before the option existed.
    [hashtable] $PerServerApiKeysSecure,
    [string] $BasicUser,
    [System.Security.SecureString] $BasicPassSecure,
    [string] $V11User,
    [System.Security.SecureString] $V11PassSecure,
    [string] $CaCert,
    [hashtable] $WriteGate,
    [switch] $ContinueOnUnreachable,
    [switch] $EmitProgress,

    # --- settings that live in the credentials file but are not credentials ------
    # The audit level and the rate limiter are written into that file because it is
    # the file every server is launched with; they are not secret and they are not
    # capability gates, so they belong in neither the host config nor a second file.
    # Absent, each keeps whatever the file already says -- the reconfigure rule, and
    # the reason these are separate from the credential parameters: changing the
    # audit level must not mean re-typing an API key.
    [ValidateSet('all', 'write', 'security', 'none')] [string] $AuditLevel,
    [ValidateSet('on', 'off')] [string] $RateLimit,
    [int] $RateLimitMaxRequests,
    [int] $RateLimitWindowMs,

    # --- host targets (default: the record, else whatever is detected, else generic) -
    [string] $Hosts,
    [string] $ProjectDir,
    [string] $HostOutDir,
    [hashtable] $HostPath,
    [switch] $ListHosts,

    # --- the HTTP gateway (the bridge for hosts that cannot spawn a process) ------
    [switch] $Gateway,
    [string] $GatewayBind = '127.0.0.1',
    [int]    $GatewayPort = 3001,
    [switch] $GatewayIUnderstandThereIsNoAuth,
    [switch] $RotateGatewayToken,
    [switch] $StartGateway
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# -----------------------------------------------------------------------------
# Console helpers
# -----------------------------------------------------------------------------
$script:StepNo = 0
$script:Warnings = New-Object System.Collections.ArrayList

# Machine-readable progress, for a caller that is rendering this run rather than
# reading it. Write-Information obeys $InformationPreference, which is
# SilentlyContinue by default, so nothing about a console run changes: the records
# exist in the Information STREAM, where a host that wants them (the WPF wizard) can
# collect them, and are invisible everywhere else.
function Send-Progress {
    param([string] $Kind, [hashtable] $Data)
    if (-not $EmitProgress) { return }
    $o = [ordered]@{ kind = $Kind; step = $script:StepNo }
    if ($Data) { foreach ($k in $Data.Keys) { $o[$k] = $Data[$k] } }
    Write-Information -MessageData ([pscustomobject]$o) -Tags 'bconnect.progress'
}

function Write-Step {
    param([string] $Title)
    $script:StepNo++
    Write-Host ''
    Write-Host ('=' * 74) -ForegroundColor DarkCyan
    Write-Host (' Step {0} -- {1}' -f $script:StepNo, $Title) -ForegroundColor Cyan
    Write-Host ('=' * 74) -ForegroundColor DarkCyan
    Send-Progress 'step' @{ title = $Title }
}
function Write-Ok   { param([string]$m) Write-Host ('  [ ok ] ' + $m) -ForegroundColor Green }
function Write-Info { param([string]$m) Write-Host ('         ' + $m) -ForegroundColor Gray }
function Write-Warn {
    param([string]$m)
    Write-Host ('  [warn] ' + $m) -ForegroundColor Yellow
    [void]$script:Warnings.Add($m)
    Send-Progress 'warn' @{ text = $m }
}
function Write-Fail { param([string]$m) Write-Host ('  [FAIL] ' + $m) -ForegroundColor Red; Send-Progress 'fail' @{ text = $m } }
function Abort {
    param([string]$m, [string[]]$Hints = @())
    Write-Host ''
    Write-Fail $m
    foreach ($h in $Hints) { Write-Host ('         ' + $h) -ForegroundColor Yellow }
    Write-Host ''
    Send-Progress 'done' @{ failed = $true; reason = $m; hints = $Hints }
    exit 1
}

function Ask-YesNo {
    # $AutoAnswer is consulted ONLY in -NonInteractive. Every call site that would be
    # wrong to answer with its interactive default passes one explicitly, so a
    # non-interactive run can never silently take a different decision from the
    # guided run it is standing in for.
    param([string] $Question, [bool] $DefaultYes = $true, $AutoAnswer = $null)
    if ($NonInteractive) {
        $a = $DefaultYes
        if ($null -ne $AutoAnswer) { $a = [bool]$AutoAnswer }
        Write-Host ('  ' + $Question + '  -> ' + $(if ($a) { 'yes' } else { 'no' }) + '   (non-interactive)') -ForegroundColor DarkGray
        return $a
    }
    $suffix = '[Y/n]'
    if (-not $DefaultYes) { $suffix = '[y/N]' }
    while ($true) {
        $a = Read-Host ('  ' + $Question + ' ' + $suffix)
        if ([string]::IsNullOrWhiteSpace($a)) { return $DefaultYes }
        if ($a -match '^(y|yes)$') { return $true }
        if ($a -match '^(n|no)$')  { return $false }
    }
}

# In -NonInteractive there is no console to prompt at. Anything that would have been
# asked has to be answered by a parameter, and a missing one is a named error rather
# than a Read-Host that blocks forever behind a UI nobody can type into.
function Require-Answer {
    param([bool] $Have, [string] $ParameterName, [string] $Why)
    if ($Have) { return }
    Abort ("-NonInteractive was given but -$ParameterName was not.") @($Why)
}

function Read-Secret {
    param([string] $Prompt, [bool] $AllowEmpty = $false)
    while ($true) {
        $s = Read-Host -Prompt ('  ' + $Prompt) -AsSecureString
        if ($s.Length -gt 0) { return $s }
        if ($AllowEmpty) { return $null }
        Write-Host '         (required)' -ForegroundColor Yellow
    }
}

function Invoke-Native {
    # Runs a native command, captures combined output, returns @{ Code; Output }.
    #
    # npm on Windows is npm.cmd, and CreateProcess cannot execute a batch file
    # directly -- Process.Start with UseShellExecute=$false throws "not a valid
    # application for this OS platform". Batch entry points are therefore routed
    # through cmd.exe /c, with the outer pair of quotes cmd requires when the
    # command path itself is quoted.
    param([string] $Exe, [string[]] $Arguments, [string] $WorkingDirectory)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    if ($Exe -match '\.(cmd|bat)$') {
        $psi.FileName  = 'cmd.exe'
        $psi.Arguments = '/c ""' + $Exe + '" ' + ($Arguments -join ' ') + '"'
    } else {
        $psi.FileName  = $Exe
        $psi.Arguments = ($Arguments -join ' ')
    }
    $psi.WorkingDirectory       = $WorkingDirectory
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    # Read BOTH pipes concurrently. Reading stdout to the end and only then reading
    # stderr deadlocks the moment a child writes more to stderr than the pipe buffer
    # holds while the parent is still blocked on stdout: the child blocks writing,
    # the parent blocks reading, neither moves. That is not theoretical -- it was hit
    # here by a verifier whose YAML library dumped an entire source file into an
    # exception message. ReadToEndAsync started before WaitForExit drains both.
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    $out = $outTask.Result
    $err = $errTask.Result
    return @{ Code = $p.ExitCode; Output = ($out + $err) }
}

function Quote-Arg {
    # One command-line argument, quoted for Invoke-Native, which passes a single
    # string to CreateProcess rather than an argument vector. A path with a space in
    # it is otherwise two arguments.
    param([string] $Value)
    return '"' + $Value + '"'
}

function Invoke-TlsProbe {
<#
.SYNOPSIS
    What the Node runtime the servers use makes of the bMS certificate.
.DESCRIPTION
    A thin wrapper over lib\probe-tls.mjs. The classification, the wording and the
    remedy all live in that file, for two reasons.

    The first is that NODE is the arbiter here and PowerShell is not. Invoke-WebRequest
    validates against the Windows certificate store on every Node version; the servers
    validate against Node's own list, which includes the Windows store only from Node
    22.15. An internal CA that IS installed in Windows and IS NOT visible to Node
    therefore passes the HTTP check in this step and then fails in all thirteen servers
    at startup. Nothing written in PowerShell can see that gap.

    The second is the rule this project keeps breaking: one implementation. The same
    file is imported by lib\verify-install.mjs, so the cause named in Step 4 and the
    cause named in Step 9 cannot drift apart.

    Returns the parsed result object, or $null when the probe could not be run at all
    (which is reported by the caller as unknown, never as success).
#>
    param([string] $Url, [string] $CaPath, [int] $TimeoutSec = 20)

    $probe = Join-Path $LibDir 'probe-tls.mjs'
    if (-not (Test-Path -LiteralPath $probe)) { return $null }
    # No runtime, no probe. A dry run on a machine that has not had Node installed
    # yet reaches here, and the caller reports "could not be checked" -- which is the
    # truth, and is not the same as a certificate that passed.
    if (-not $NodeExe) { return $null }

    # Through a file rather than stdout: Invoke-Native merges the two pipes, and Node
    # writes deprecation notices to stderr, which would land in the middle of the JSON.
    $outFile = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-tls-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
    try {
        # Every concatenation is parenthesised on purpose. Invoke-Native joins the
        # arguments with a space, so each element has to arrive whole -- and inside an
        # array literal PowerShell's comma binds TIGHTER than '+', so an unbracketed
        # ('"' + $CaPath + '"') is read as an array of three elements and the join
        # then puts a space on each side of the path. Measured: the probe was handed
        # ' C:\...\ca.pem ' and reported the CA file as unreadable.
        $a = @((Quote-Arg $probe), '--url', (Quote-Arg $Url),
               '--timeout', ([string]([int]($TimeoutSec * 1000))), '--out', (Quote-Arg $outFile))
        if ($CaPath) { $a += @('--ca', (Quote-Arg $CaPath)) }
        [void](Invoke-Native $NodeExe $a $InstallerDir)
        if (-not (Test-Path -LiteralPath $outFile)) { return $null }
        return (Get-Content -LiteralPath $outFile -Raw | ConvertFrom-Json)
    } catch {
        return $null
    } finally {
        Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue
    }
}

function Show-TlsDiagnosis {
<#
.SYNOPSIS
    Print one TLS verdict, and hand the same object to the wizard.
.DESCRIPTION
    Nothing is composed here. The headline, the detail lines and the ordered remedy
    are produced by probe-tls.mjs; this chooses a severity and a colour. `warning`
    is deliberately printed apart from `remedy` and is never numbered: it names
    NODE_TLS_REJECT_UNAUTHORIZED for what it is, and a numbered list is how an
    operator reads "one of the things to try".
#>
    param($Tls)
    if (-not $Tls) { return }

    if ($Tls.cause -eq 'trusted') { Write-Ok $Tls.headline }
    else                          { Write-Fail $Tls.headline }

    foreach ($d in @($Tls.detail)) { Write-Info $d }

    $n = 0
    foreach ($rline in @($Tls.remedy)) {
        $n++
        Write-Host ('         ' + $n + '. ' + $rline) -ForegroundColor Yellow
    }
    if ($Tls.warning) { Write-Host ('         ' + $Tls.warning) -ForegroundColor DarkGray }

    Send-Progress 'tls' @{
        cause     = [string]$Tls.cause
        code      = [string]$Tls.code
        headline  = [string]$Tls.headline
        detail    = @($Tls.detail)
        remedy    = @($Tls.remedy)
        warning   = [string]$Tls.warning
        caFixable = [bool]$Tls.caFixable
        caPath    = [string]$Tls.caPath
    }
}

# -----------------------------------------------------------------------------
# Path defaults
# -----------------------------------------------------------------------------
$InstallerDir = $PSScriptRoot
$ProjectRoot  = Split-Path -Parent $InstallerDir
if (-not $SuiteRoot)  { $SuiteRoot  = Join-Path $ProjectRoot 'bConnect-MCP-main' }
if (-not $SecretsDir) { $SecretsDir = Join-Path $ProjectRoot 'secrets' }
if (-not $ConfigPath) { $ConfigPath = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json' }

$LibDir      = Join-Path $InstallerDir 'lib'
$CatalogFile = Join-Path $LibDir 'catalog.json'
$EnvFile     = Join-Path $SecretsDir 'bconnect.env'

# The credential-handling primitives live in a module so they can be tested for
# real without anyone typing a real secret -- see lib\Test-Secrets.ps1 and
# lib\Test-CredentialProtection.ps1.
Import-Module (Join-Path $LibDir 'Secrets.psm1')     -Force
Import-Module (Join-Path $LibDir 'Dpapi.psm1')       -Force -DisableNameChecking
Import-Module (Join-Path $LibDir 'State.psm1')       -Force -DisableNameChecking
# The Windows-context rule, and the refusal built on it. One implementation, in
# lib\UserContext.psm1; nothing here re-derives it.
Import-Module (Join-Path $LibDir 'UserContext.psm1') -Force -DisableNameChecking
# Finding, staging, verifying and installing the Node runtime. One implementation, in
# lib\NodeProvisioning.psm1, reached by this script, by the wizard's prerequisites
# page and by lib\New-OfflineBundle.ps1.
Import-Module (Join-Path $LibDir 'NodeProvisioning.psm1') -Force -DisableNameChecking

if (-not $StateFile) { $StateFile = Join-Path $InstallerDir 'state\installation.json' }
$Record = Read-InstallationRecord -Path $StateFile

if ($ProtectCredentials -and $PlaintextCredentials) {
    Write-Host ''
    Write-Host '  [FAIL] -ProtectCredentials and -PlaintextCredentials are opposites; pass one.' -ForegroundColor Red
    Write-Host ''
    exit 1
}

# Which half of the install this run does. Both is the default and both flags are
# then true, so every gate below is a no-op on a run that did not ask for a stage --
# which is the whole of the compatibility guarantee for a large installed surface.
$StageDoesMachine = ($Stage -ne 'User')
$StageDoesUser    = ($Stage -ne 'Machine')

# Which form of the credentials file is on disk right now. 'protected' wins when both
# exist -- see Get-CredentialStoreState.
$CredStore = Get-CredentialStoreState -EnvFile $EnvFile

# The credential storage form, decided ONCE, here, because two things read it and
# they must not disagree: Step 3 (which may still offer the choice interactively)
# and the per-user refusal below, which runs before anything has been collected and
# has to know whether this run would write a CurrentUser-bound blob.
$Protect = ($CredStore.Mode -eq 'protected')      # default: whatever is already true
if     ($ProtectCredentials)   { $Protect = $true }
elseif ($PlaintextCredentials) { $Protect = $false }

# The machine stage collects nothing personal, so a credential handed to it is a
# mistake in a deployment job rather than an option. Naming it is the difference
# between a package that is fixed and a package that appears to work.
if (-not $StageDoesUser) {
    $credParams = @()
    foreach ($p in @('ApiKeySecure', 'PerServerApiKeysSecure', 'BasicPassSecure', 'V11PassSecure', 'BasicUser', 'V11User', 'ProtectCredentials')) {
        if ($PSBoundParameters.ContainsKey($p)) { $credParams += ('-' + $p) }
    }
    if ($credParams.Count) {
        Write-Host ''
        Write-Host ('  [FAIL] -Stage Machine collects no credential, so ' + ($credParams -join ', ') +
                    ' would be ignored.') -ForegroundColor Red
        Write-Host '         Credentials belong to the user stage, which runs in the administrator''s' -ForegroundColor Yellow
        Write-Host '         own login: Install-BConnectMcp.ps1 -Stage User.' -ForegroundColor Yellow
        Write-Host '         Get-Help .\Install-BConnectMcp.ps1 -Parameter Stage' -ForegroundColor Yellow
        Write-Host ''
        exit 1
    }
}

Write-Host ''
Write-Host '  bConnect-MCP -- guided installer' -ForegroundColor White
Write-Host '  --------------------------------' -ForegroundColor DarkGray
Write-Host ('  suite root      ' + $SuiteRoot)
Write-Host ('  credentials     ' + $(if ($CredStore.ActivePath) { $CredStore.ActivePath } else { $EnvFile }) +
            '  [' + $CredStore.Mode + ']')
if ($DryRun)         { Write-Host '  DRY RUN -- nothing will be written' -ForegroundColor Yellow }
if ($NonInteractive) { Write-Host '  NON-INTERACTIVE -- every answer comes from a parameter' -ForegroundColor DarkGray }
Send-Progress 'start' @{ suiteRoot = $SuiteRoot; envFile = $EnvFile; configPath = $ConfigPath
                         credentialMode = $CredStore.Mode; dryRun = [bool]$DryRun; verifyOnly = [bool]$VerifyOnly }

if (-not (Test-Path $CatalogFile)) {
    Abort "Installer catalog missing: $CatalogFile" @('The install\lib directory must sit next to this script.')
}
$Catalog     = Get-Content $CatalogFile -Raw | ConvertFrom-Json
$AllServers  = $Catalog.servers

# -----------------------------------------------------------------------------
# Host targets
# -----------------------------------------------------------------------------
# The suite's servers are ordinary stdio MCP servers plus one Streamable-HTTP
# gateway; nothing in them is specific to any vendor. The only vendor-specific
# thing in an install is WHICH FILE gets written and IN WHAT SHAPE. lib\hosts.json
# holds that knowledge as data -- location, container key, entry shape, the doc URL
# it was read from, and the claims deliberately not made -- so adding a host is a
# JSON entry rather than a code change, and so no emitter can disagree with a
# document.
$HostsFile = Join-Path $LibDir 'hosts.json'
if (-not (Test-Path $HostsFile)) {
    Abort "Host-target registry missing: $HostsFile" @('The install\lib directory must sit next to this script.')
}
$HostRegistry = Get-Content $HostsFile -Raw | ConvertFrom-Json
$AllHosts     = $HostRegistry.targets

# $ProjectDir is deliberately NOT defaulted here. A {PROJECT} target is read by the
# editor from the workspace the customer has open, and the directory this installer
# happens to sit in is never that workspace -- defaulting to it produced a green run
# that wrote into a folder nobody would ever open, and verification could not catch
# it because spawning the servers named in a file proves nothing about its location.
# Resolve-ProjectDir below asks, or refuses. A previous run's answer is authoritative
# -- that is what makes uninstall and reconfigure find the files they wrote.
# -- but only if it is still there. A record can outlive the workspace it names, and
# a path that no longer exists is not an answer, it is a stale one that would be
# rendered as fact by -ListHosts and written into by a re-run.
if (-not $ProjectDir -and $Record -and $Record.projectDir -and (Test-Path -LiteralPath ([string]$Record.projectDir))) {
    $ProjectDir = [string]$Record.projectDir
}
if (-not $HostOutDir) { $HostOutDir = Join-Path $InstallerDir 'out' }

function Resolve-HostPath {
    param($Target)
    if ($HostPath -and $HostPath.ContainsKey($Target.id)) { return [string]$HostPath[$Target.id] }
    $p = $Target.defaultPath
    $p = $p.Replace('{APPDATA}',     $env:APPDATA)
    $p = $p.Replace('{USERPROFILE}', $env:USERPROFILE)
    # Unresolved until Resolve-ProjectDir has run (or been told). Rendering a
    # placeholder rather than an empty string keeps -ListHosts honest about the
    # fact that this path depends on an answer nobody has given yet.
    $p = $p.Replace('{PROJECT}',     $(if ($ProjectDir) { $ProjectDir } else { '<your workspace>' }))
    $p = $p.Replace('{OUT}',         $HostOutDir)
    # -ConfigPath still wins for Claude Desktop: existing scripts and the tests
    # rehearse against a copy that way, and that must not stop working.
    if ($Target.id -eq 'claude-desktop') { return $ConfigPath }
    return $p
}

if ($ListHosts) {
    Write-Host ''
    Write-Host '  Host targets' -ForegroundColor White
    Write-Host '  ------------' -ForegroundColor DarkGray
    Write-Host ('  {0} {1} {2} {3}' -f 'id'.PadRight(16), 'transport'.PadRight(10), 'how'.PadRight(11), 'verified') -ForegroundColor DarkGray
    foreach ($t in $AllHosts) {
        $col = if ($t.impractical) { 'Yellow' } elseif ($t.verification -eq 'host-loaded') { 'Green' } else { 'Gray' }
        Write-Host ('  {0} {1} {2} {3}' -f $t.id.PadRight(16), $t.transport.PadRight(10), $t.mode.PadRight(11), $t.verification) -ForegroundColor $col
        Write-Host ('      ' + $t.label + '  ->  ' + (Resolve-HostPath $t)) -ForegroundColor DarkGray
        if ($t.impractical) { Write-Host '      NOTE: needs an internet-reachable endpoint; read the emitted file first' -ForegroundColor Yellow }
    }
    Write-Host ''
    Write-Host '  host-loaded   the host application itself was made to read it on this machine'
    Write-Host '  config-spawn  the emitted file was parsed back and every server in it started,'
    Write-Host '                handshook and served a real bMS read. Not proof the host loads it.'
    Write-Host '  schema-only   shape-checked against the documented schema. Nothing was executed.'
    Write-Host ''
    Write-Host '  Each target''s notes and its unverified claims are in lib\hosts.json.'
    Write-Host ''
    exit 0
}

# Which host targets can be said to be PRESENT on this machine without executing
# anything or reading a registry key.
#
# Only a user-scope target can be answered at all: its configuration lives at a
# fixed per-user path, so the existence of that directory is evidence the client
# has been run here. A per-project target ({PROJECT}) says nothing -- the path is
# whatever -ProjectDir points at -- and a snippet target ({OUT}) is a document this
# installer writes, so it is always "present" and the question is meaningless. The
# rule is therefore read off the registry's own path template rather than from a
# list of ids, so a user-scope target added to hosts.json is detected for free.
function Get-DetectedHostIds {
    $found = @()
    foreach ($t in $AllHosts) {
        if (-not (Test-HostTargetIsUserScoped -Target $t)) { continue }
        $dir = Split-Path -Parent (Resolve-HostPath $t)
        if ($dir -and (Test-Path -LiteralPath $dir)) { $found += $t.id }
    }
    # NOT ",$found": every caller wraps the result in @(), and the comma operator
    # would hand them a one-element array holding the array -- which counts as
    # "something was detected" even when nothing was.
    return $found
}

# Where -Hosts comes from when it is not given, in order:
#
#   1. the installation record, if there is one. This is the fix for the worst
#      compound failure in the audit: an operator configures claude-desktop, vscode,
#      cursor and continue, later runs -ProtectCredentials, and only claude-desktop
#      is rewritten -- the other three keep naming a plaintext env file that has just
#      been deleted, and they do not degrade, they stop.
#   2. whichever user-scope clients are actually present here.
#   3. 'generic', which writes a portable command line into install\out and touches
#      no vendor's directory at all.
#
# This used to default to one named client unconditionally. On a bMS server -- the
# machine this is most often run on, and one that has never had a desktop MCP client
# installed -- that meant a full credential walk, probe and build ending in a write
# into a directory that does not exist. Defaulting to a vendor is also the wrong
# shape for a product whose whole claim is that it is client-neutral: nothing here
# knows which client the customer drives it from, so the honest no-argument answer
# is "the ones I can see, else the portable one".
$HostsFromRecord   = $false
$HostsFromDetected = $false
$SelectedHosts     = @('generic')
if (-not $Hosts -and $Record) {
    # Configured hosts AND intended ones. After a machine-stage run there are no
    # configured hosts yet -- that is what the machine stage means -- and the whole
    # handoff to the user stage is the intended list it recorded. Reading only the
    # configured half would make `-Stage User` fall through to detection and quietly
    # configure something other than what the deployment asked for.
    $recHosts = @(@(Get-RecordHostIds $Record) + @(Get-RecordIntendedHostIds $Record) |
                  Where-Object { $_ } | Select-Object -Unique |
                  Where-Object { ($AllHosts | Select-Object -ExpandProperty id) -contains $_ })
    if ($recHosts.Count) {
        $SelectedHosts = $recHosts
        $HostsFromRecord = $true
    }
}
if (-not $Hosts -and -not $HostsFromRecord) {
    $detected = @(Get-DetectedHostIds)
    if ($detected.Count) {
        $SelectedHosts     = $detected
        $HostsFromDetected = $true
    }
}
if ($Hosts) {
    if ($Hosts.Trim().ToLower() -eq 'all') {
        $SelectedHosts = @($AllHosts | Select-Object -ExpandProperty id)
    } else {
        $SelectedHosts = @($Hosts -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
        $badHosts = @($SelectedHosts | Where-Object { ($AllHosts | Select-Object -ExpandProperty id) -notcontains $_ })
        if ($badHosts.Count) {
            Abort ('unknown host target(s): ' + ($badHosts -join ', ')) @(
                'Known targets: ' + (($AllHosts | Select-Object -ExpandProperty id) -join ', '),
                'Run with -ListHosts for the table.'
            )
        }
    }
}
$SelectedHostObjs = @($AllHosts | Where-Object { $SelectedHosts -contains $_.id })
if ($HostsFromRecord) {
    Write-Host ''
    Write-Host ('  hosts from the installation record: ' + ($SelectedHosts -join ', ')) -ForegroundColor DarkGray
    Write-Host ('  (' + $StateFile + ' -- pass -Hosts to override)') -ForegroundColor DarkGray
} elseif ($HostsFromDetected) {
    Write-Host ''
    Write-Host ('  hosts detected on this machine: ' + ($SelectedHosts -join ', ')) -ForegroundColor DarkGray
    Write-Host '  (detected = its per-user configuration directory exists. Pass -Hosts to override,' -ForegroundColor DarkGray
    Write-Host '   -ListHosts for the full table.)' -ForegroundColor DarkGray
} elseif (-not $Hosts) {
    Write-Host ''
    Write-Host '  no MCP client detected on this machine -- configuring the portable target' -ForegroundColor Yellow
    Write-Host '  ''generic'', which writes the exact command line for any client into install\out' -ForegroundColor DarkGray
    Write-Host '  and touches no client''s own configuration. Pass -Hosts <id> (see -ListHosts)' -ForegroundColor DarkGray
    Write-Host '  to configure a specific client, or -Gateway for the clients that need HTTP.' -ForegroundColor DarkGray
}

# An explicitly named user-scope client whose configuration directory is not there.
# The file is still written -- an explicit -Hosts is an instruction, and a scripted
# install that pre-stages a config is legitimate -- but nothing on this machine can
# corroborate that the client exists, and that has to be said now rather than left
# to look like a successful integration at the end.
foreach ($t in $SelectedHostObjs) {
    if (-not (Test-HostTargetIsUserScoped -Target $t)) { continue }
    $hdir = Split-Path -Parent (Resolve-HostPath $t)
    if ($hdir -and -not (Test-Path -LiteralPath $hdir)) {
        Write-Warn ("$($t.id): $hdir does not exist, so $($t.label) has probably never run here")
        Write-Info 'The configuration will still be written and the directory created. If that is'
        Write-Info 'not what you meant, re-run with -Hosts generic for a portable command line.'
    }
}

# A {PROJECT} target is workspace-scoped: the editor looks for it beside the folder
# the developer has actually opened. There is no defensible default for that, so it
# is asked for, and a non-interactive caller must pass it. The installer's own tree
# is rejected by name: it is the one answer that is certainly wrong and was
# previously the one that was used.
$ProjectTargets = @($SelectedHostObjs | Where-Object { $_.defaultPath -match '\{PROJECT\}' -and -not ($HostPath -and $HostPath.ContainsKey($_.id)) })
# Not on the way out. Uninstall is deliberately able to run against an installation
# too broken to install, and asking for a workspace before removing entries from one
# would make it fail on exactly the cases it exists for.
#
# And not on the machine stage, which writes no host file at all. The workspace
# belongs to whoever opens it, and demanding one from a SYSTEM job that will never
# use it would make -Hosts vscode unrecordable as intent -- which is the one thing
# the machine stage is for.
if ($Uninstall -or -not $StageDoesUser) { $ProjectTargets = @() }
if ($ProjectTargets.Count) {
    $badRoots = @($ProjectRoot, $InstallerDir, $SuiteRoot) | Where-Object { $_ }
    while ($true) {
        if ($ProjectDir) {
            $resolvedPd = $null
            try { $resolvedPd = (Resolve-Path -LiteralPath $ProjectDir -ErrorAction Stop).Path } catch { $resolvedPd = $ProjectDir }
            # The rule is in lib\State.psm1 so the wizard can refuse the same value on
            # the page where it was typed, instead of letting the operator reach the
            # end of the run and be stopped by a rule the window already knew.
            $isBad = Test-ProjectDirIsInstallation -ProjectDir $resolvedPd -InstallationRoots $badRoots
            if ($isBad) {
                Write-Warn ("-ProjectDir is $resolvedPd, which is part of this installation, not a workspace")
                Write-Info ('These targets are read from the folder open in the editor: ' +
                            (($ProjectTargets | Select-Object -ExpandProperty id) -join ', '))
                Write-Info 'A config written here would verify green and never be loaded by anything.'
                if ($NonInteractive) {
                    Abort 'refusing to write a per-project host config into the installation directory' @(
                        'Pass -ProjectDir <the repository you will open in the editor>,',
                        'or drop the per-project targets from -Hosts.'
                    )
                }
                if (-not (Ask-YesNo 'Use it anyway?' $false)) { $ProjectDir = $null; continue }
            }
            $ProjectDir = $resolvedPd
            break
        }
        if ($NonInteractive) {
            Abort ('-ProjectDir is required for: ' + (($ProjectTargets | Select-Object -ExpandProperty id) -join ', ')) @(
                'These targets are per-workspace -- the editor reads them from the folder it',
                'has open, so there is no machine-wide location to fall back to.',
                'Pass -ProjectDir <path>, or drop those targets from -Hosts.'
            )
        }
        Write-Host ''
        Write-Info ('These targets are read per workspace: ' +
                    (($ProjectTargets | Select-Object -ExpandProperty id) -join ', '))
        Write-Info 'Give the folder you will open in the editor -- your repository, not this one.'
        $answer = (Read-Host '  project/workspace directory').Trim().Trim('"')
        if (-not $answer) { continue }
        if (-not (Test-Path -LiteralPath $answer)) {
            Write-Host '         that path does not exist' -ForegroundColor Yellow
            continue
        }
        $ProjectDir = $answer
    }
    Write-Ok ("per-project configs will be written under $ProjectDir")
}

# What the operator has to do in the CLIENT once this script has written its file.
#
# Every target needs a different action and some need none, so the closing guidance
# has to be per target or it is wrong for everybody but one. The registry is the
# right home for this string -- it already carries every other per-host fact -- so
# an `activation` entry there wins if one is present; the table below is the
# fallback until hosts.json carries it, and the mode-derived default means a target
# added to the registry gets a truthful line rather than none.
#
# Nothing here claims the client will load the file. For a snippet target it says
# the opposite: the emitted file is a document, and following it is manual work.
function Get-HostActivation {
    param($Target, [string] $Path)
    if ($Target.PSObject.Properties['activation'] -and $Target.activation) {
        return @($Target.activation) | ForEach-Object { $_.Replace('{PATH}', $Path) }
    }
    switch ($Target.id) {
        'claude-desktop' { return @(
            'Fully quit and relaunch it. Right-click the system-tray icon and choose Quit --',
            'closing the window is not enough, the app keeps running with the configuration it',
            'read at launch.') }
        'claude-code' { return @(
            ('Start it from ' + (Split-Path -Parent $Path) + '. Project servers are read from'),
            'the directory it is launched in, and it asks once before trusting them.') }
        'vscode' { return @(
            ('Open ' + (Split-Path -Parent (Split-Path -Parent $Path)) + ' as the workspace, then'),
            'reload the window (Developer: Reload Window) and start the servers from the MCP view.') }
        'cursor' { return @(
            ('Open ' + (Split-Path -Parent (Split-Path -Parent $Path)) + ' as the workspace, then'),
            'enable the servers under Settings -> MCP.') }
    }
    switch ($Target.mode) {
        'merge-json' { return @(('Restart ' + $Target.label + ' so it re-reads the file.')) }
        'write-file' { return @(('Restart ' + $Target.label + ' (or your IDE) so it re-reads the file.')) }
        default      { return @(
            'Nothing loads this automatically. It is a document, not a file the client',
            'reads -- open it and follow it. It records what was verified and what was not.') }
    }
}

# The host files this run knows about, resolved once: id, path, and the registry
# entry that says how to read them. Everything that reconciles intent against disk
# takes this list.
function Get-HostFileList {
    param([string[]] $Ids)
    $list = @()
    foreach ($t in @($AllHosts | Where-Object { $Ids -contains $_.id })) {
        $list += @{ id = $t.id; path = (Resolve-HostPath $t); target = $t }
    }
    return ,$list
}

# -----------------------------------------------------------------------------
# Uninstall -- the way back out
# -----------------------------------------------------------------------------
# Placed here, before any of the install steps, because it must work on an
# installation that is too broken to install: no Node build, an undecryptable
# credentials file, a half-written config. All it needs is the record (or, failing
# that, the default host paths) and a way to rewrite JSON.
if ($Uninstall) {
    Write-Host ''
    Write-Host '  Uninstall' -ForegroundColor White
    Write-Host '  ---------' -ForegroundColor DarkGray

    $unNode = (Get-Command node -ErrorAction SilentlyContinue)
    if (-not $unNode) {
        Abort 'Node.js is not on PATH, and the host configurations are rewritten with it.' @(
            'The uninstall will not hand-edit JSON with PowerShell: the whole guarantee is',
            'that everything this installer does not own comes out byte-identical, and',
            'PowerShell 5.1''s JSON round trip cannot promise that. Put node on PATH and re-run.'
        )
    }
    $unNodeExe = $unNode.Source

    # Which hosts. The record is authoritative; without one, fall back to every
    # registry target whose file exists and actually carries bconnect-* entries --
    # so an uninstall works on an installation that predates the record.
    $unHostIds = @()
    if ($Record) { $unHostIds = @(Get-RecordHostIds $Record) }
    if ($Hosts) { $unHostIds = $SelectedHosts }
    if (-not $unHostIds.Count) {
        Write-Info 'no installation record -- looking for bconnect-* entries in every known host file'
        foreach ($hf in (Get-HostFileList @($AllHosts | Select-Object -ExpandProperty id))) {
            $e = Get-HostManagedEntries -Path $hf.path -Target $hf.target
            if ($e -and $e.Count) { $unHostIds += $hf.id }
        }
    }
    $unHostIds = @($unHostIds | Where-Object { ($AllHosts | Select-Object -ExpandProperty id) -contains $_ } | Select-Object -Unique)

    $unRemoved   = @()
    $unUntouched = @()
    foreach ($hf in (Get-HostFileList $unHostIds)) {
        $entries = Get-HostManagedEntries -Path $hf.path -Target $hf.target
        if ($hf.target.mode -ne 'merge-json') {
            # A snippet or a YAML block file. We wrote it whole, so removing it means
            # deleting the file we emitted -- never editing a file a human wrote.
            if (Test-Path -LiteralPath $hf.path) {
                if ($DryRun) { Write-Info "would delete $($hf.path)  ($($hf.id), emitted whole)" }
                else {
                    Remove-Item -LiteralPath $hf.path -Force -ErrorAction SilentlyContinue
                    Write-Ok "$($hf.id): deleted $($hf.path)"
                }
                $unRemoved += $hf.id
            } else {
                Write-Info "$($hf.id): nothing at $($hf.path)"
            }
            continue
        }
        if ($null -eq $entries) {
            Write-Warn "$($hf.id): cannot read $($hf.path) -- left completely alone"
            $unUntouched += $hf.id
            continue
        }
        if ($entries.Count -eq 0) {
            Write-Info "$($hf.id): no bconnect-* entries in $($hf.path)"
            continue
        }
        $plan = [ordered]@{ manage = @{}; remove = @(@($entries.Keys)) }
        $planFile = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-uninstall-' + [guid]::NewGuid().ToString('N') + '.json')
        ($plan | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $planFile -Encoding UTF8
        try {
            if ($hf.id -eq 'claude-desktop') {
                $a = @("`"$(Join-Path $LibDir 'merge-config.mjs')`"", '--target', "`"$($hf.path)`"", '--plan', "`"$planFile`"")
                if ($DryRun) { $a += '--dry-run' }
                $r = Invoke-Native $unNodeExe $a $LibDir
            } else {
                $hostPlan = [ordered]@{
                    outDir  = $HostOutDir
                    servers = @{}
                    remove  = @(@($entries.Keys))
                    gateway = $null
                    targets = @(@{ id = $hf.id; path = $hf.path })
                    removeOnly = $true
                }
                ($hostPlan | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $planFile -Encoding UTF8
                $a = @("`"$(Join-Path $LibDir 'emit-host-config.mjs')`"", '--plan', "`"$planFile`"")
                if ($DryRun) { $a += '--dry-run' }
                $r = Invoke-Native $unNodeExe $a $LibDir
            }
            Write-Host $r.Output.TrimEnd()
            if ($r.Code -ne 0) {
                Write-Fail "$($hf.id): removal failed; that file was left as it was"
                $unUntouched += $hf.id
            } else {
                Write-Ok ("$($hf.id): removed " + (@($entries.Keys) -join ', '))
                $unRemoved += $hf.id
            }
        } finally {
            Remove-Item -LiteralPath $planFile -Force -ErrorAction SilentlyContinue
        }
    }

    if ($HostEntriesOnly) {
        Write-Host ''
        Write-Ok ('managed entries removed from: ' + $(if ($unRemoved.Count) { ($unRemoved | Select-Object -Unique) -join ', ' } else { '(nothing)' }))
        Write-Info 'The credentials, the installation record and the other hosts are untouched.'
        Write-Info 'Restart those host applications to drop the servers they still have running.'
        Write-Host ''
        Send-Progress 'done' @{ failed = $false; uninstalled = $false; hosts = @($unRemoved) }
        exit 0
    }

    # Credentials.
    $unStore = Get-CredentialStoreState -EnvFile $EnvFile
    if ($KeepCredentials) {
        if ($unStore.ActivePath) {
            Write-Ok "credentials KEPT at $($unStore.ActivePath)  (-KeepCredentials)"
            Write-Info 'They are still live. Revoke the key in the bMS console if you are done with it.'
        } else {
            Write-Info 'no credentials file to keep'
        }
    } elseif ($DryRun) {
        if ($unStore.ActivePath) { Write-Info "would overwrite with zeros and delete $($unStore.ActivePath)" }
    } else {
        foreach ($p in @($unStore.PlainPath, $unStore.ProtectedPath)) {
            if (Test-Path -LiteralPath $p) {
                Remove-FileBestEffort -Path $p
                Write-Ok "credentials removed: $p"
            }
        }
        Write-Info 'The plaintext form was overwritten with zeros first. That defeats an undelete;'
        Write-Info 'it is not a secure erase -- shadow copies and the SSD''s remapped blocks remain.'
    }

    # The record and the emitted snippets.
    if (Test-Path -LiteralPath $StateFile) {
        if ($DryRun) { Write-Info "would remove $StateFile" }
        else { Remove-Item -LiteralPath $StateFile -Force; Write-Ok "installation record removed: $StateFile" }
    }
    if (Test-Path -LiteralPath $HostOutDir) {
        $emitted = @(Get-ChildItem -LiteralPath $HostOutDir -File -ErrorAction SilentlyContinue)
        if ($emitted.Count) {
            if ($DryRun) { Write-Info "would remove $($emitted.Count) emitted file(s) from $HostOutDir" }
            else {
                foreach ($f in $emitted) { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue }
                Write-Ok "$($emitted.Count) emitted snippet(s) removed from $HostOutDir"
            }
        }
    }

    # What is NOT removed. This is the part that matters.
    Write-Host ''
    Write-Host '  What this did NOT remove' -ForegroundColor White
    Write-Host '  ------------------------' -ForegroundColor DarkGray
    Write-Host '  * THE bMS API KEY ITSELF. Deleting the credentials file removes this' -ForegroundColor Yellow
    Write-Host '    machine''s copy of the key. The key is still valid on the bMS and still' -ForegroundColor Yellow
    Write-Host '    grants everything it granted before. Revoke it in the bMS console:' -ForegroundColor Yellow
    Write-Host '    Server Management -> API Keys. Nothing here can do that for you.' -ForegroundColor Yellow
    if (-not $KeepCredentials) {
        Write-Host '  * The v1.1 domain account, if one was configured. Its password is out of' -ForegroundColor Yellow
        Write-Host '    this file, but the account still exists and is still in a bConnect' -ForegroundColor Yellow
        Write-Host '    security group. Remove it from that group if this install was its only use.' -ForegroundColor Yellow
    }
    Write-Host ('  * ' + (Join-Path $SuiteRoot 'node_modules') + '  (delete it by hand if you want the space)')
    Write-Host '  * every bconnect-*-mcp\build directory -- the compiled suite'
    Write-Host '  * every .bak-* backup this installer took of a host configuration'
    Write-Host '  * Node.js itself, and anything else that was already on this machine'
    if ($unUntouched.Count) {
        Write-Host ''
        Write-Warn ('these hosts could not be cleaned and still carry entries: ' + ($unUntouched -join ', '))
    }
    Write-Host ''
    Write-Host ('  Removed from: ' + $(if ($unRemoved.Count) { ($unRemoved | Select-Object -Unique) -join ', ' } else { '(nothing was configured)' }))
    Write-Host '  Restart the host applications to drop the servers they still have running.'
    Write-Host ''
    Send-Progress 'done' @{ failed = $false; uninstalled = $true; hosts = @($unRemoved) }
    exit 0
}

# -----------------------------------------------------------------------------
# The refusal: per-user writes from a context that has no user
# -----------------------------------------------------------------------------
# Here, because every host path is now resolved and nothing has yet been written --
# and after the uninstall block, which is deliberately able to run against an
# installation too broken to install and removes rather than writes.
#
# The RULE is in lib\UserContext.psm1 and is not restated here. This call site
# supplies the two facts a decision needs -- what this run would write, and whether
# it would DPAPI-protect the credentials -- and prints whatever comes back.
#
# It stops. A warning that proceeds produces a green run whose files sit in
# C:\Windows\System32\config\systemprofile, which no client reads and no operator
# looks in. -Stage Machine passes through untouched, which is its entire purpose.
$UserContext = Get-ProcessUserContext
if ($StageDoesUser) {
    $refusal = Get-PerUserWriteRefusal -Targets (Get-HostFileList $SelectedHosts) `
                                       -ProtectCredentials $Protect -Context $UserContext
    if ($refusal) {
        Write-Host ''
        Write-Host '  Per-user configuration cannot be written from this context' -ForegroundColor White
        Write-Host '  ----------------------------------------------------------' -ForegroundColor DarkGray
        foreach ($line in $refusal.Detail) { Write-Host ('  ' + $line) -ForegroundColor Gray }
        Abort $refusal.Reason $refusal.Action
    }
}
Write-Host ''
Write-Host ('  stage           ' + $Stage.ToLower() + $(if ($Stage -eq 'Both') { '   (machine and user, as before)' }
                                                        elseif ($Stage -eq 'Machine') { '   (no credential, no per-user path)' }
                                                        else { '   (credentials and this account''s clients)' }))
Write-Host ('  running as      ' + $UserContext.Account)

# A host that cannot spawn a local process needs the gateway; selecting one selects
# the gateway rather than failing later with a confusing message.
$NeedGateway = [bool]($SelectedHostObjs | Where-Object { $_.requiresGateway })
if ($NeedGateway -and -not $Gateway) {
    $Gateway = $true
    Write-Host ''
    Write-Host ('  These targets consume MCP over HTTP only, so the gateway is required: ' +
                (($SelectedHostObjs | Where-Object { $_.requiresGateway } | Select-Object -ExpandProperty id) -join ', ')) -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------------
# Step 1 -- prerequisites
# -----------------------------------------------------------------------------
Write-Step 'Prerequisites'

# The Node runtime. Every decision here -- the floor, the two routes, the checksum,
# the elevation condition, the PATH repair -- is in lib\NodeProvisioning.psm1 and is
# NOT restated. This call site supplies the three facts a decision needs (where the
# suite is, whether the network may be used, what the bundle recorded) and prints
# whatever comes back. The wizard's prerequisites page and lib\New-OfflineBundle.ps1
# reach the same module; there is one implementation of this work.
#
# A bundle records the SHA256 of the runtime it carried. Reading that one field here
# rather than at the full manifest check below is deliberate: the manifest check runs
# after the suite is validated, and the runtime is needed before any of that. The
# later block re-reads the file and verifies everything; this reads one field.
if (-not $BundleManifest) { $BundleManifest = Join-Path $ProjectRoot 'offline-bundle.json' }
$stagedNodeSha = $null
if (Test-Path -LiteralPath $BundleManifest -PathType Leaf) {
    try {
        $earlyBm = Get-Content -LiteralPath $BundleManifest -Raw | ConvertFrom-Json
        if (@($earlyBm.PSObject.Properties.Name) -contains 'nodeRuntime' -and $earlyBm.nodeRuntime -and
            @($earlyBm.nodeRuntime.PSObject.Properties.Name) -contains 'sha256') {
            $stagedNodeSha = [string]$earlyBm.nodeRuntime.sha256
        }
    } catch { }
}

$nodeResolve = Resolve-NodeRuntime -SuiteRoot $SuiteRoot -InstallerDir $InstallerDir `
                                   -MediaPath $NodeMediaPath -AllowDownload:$AllowNodeDownload `
                                   -PlanOnly:$DryRun -ManifestSha256 $stagedNodeSha

foreach ($line in @($nodeResolve.Detail)) { Write-Info $line }
if ($nodeResolve.Refusal) {
    Write-Host ''
    Write-Host '  The Node.js runtime' -ForegroundColor White
    Write-Host '  -------------------' -ForegroundColor DarkGray
    foreach ($line in @($nodeResolve.Refusal.Detail)) { Write-Host ('  ' + $line) -ForegroundColor Gray }
    Abort $nodeResolve.Refusal.Reason $nodeResolve.Refusal.Action
}
if ($nodeResolve.Outcome -eq 'Installed') {
    Write-Ok ("Node $($nodeResolve.NodeVersion) installed from $($nodeResolve.Media.File)")
    foreach ($line in @($nodeResolve.Log)) { Write-Info $line }
}

# -DryRun stops before writing anything, and installing a runtime is a write.
#
# This used to Abort here, and that was wrong in the case that matters most. On a
# machine that has never had Node -- every first install -- EVERY dry run stopped
# in Step 1. The wizard's Test button is a dry run, so the one control an operator
# presses to check the address and the credential BEFORE installing could never
# work before installing. Reported from a test VM as "the test connection does not
# work", with the address and the credential both correct.
#
# The connectivity check and the URL rules need no Node at all. So a dry run now
# defers the runtime instead of refusing: it answers what it can answer, and stops
# with a plain statement of what it could not, rather than answering nothing.
$NodeDeferred = $false
if ($nodeResolve.Outcome -eq 'Plan') {
    Write-Warn 'the Node.js runtime is not installed yet; setup installs it.'
    Write-Info ('route: ' + $nodeResolve.Route)
    Write-Info 'A dry run writes nothing, so nothing is installed here. The address and the'
    Write-Info 'credential are checked below, because that check does not need Node.'
    $NodeDeferred = $true
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd -and $DryRun) {
    # Deferred whether or not the resolver planned an install: a dry run on a machine
    # with no Node has the same two answers to give either way.
    $NodeDeferred = $true
}
if (-not $nodeCmd -and -not $NodeDeferred) {
    Abort 'Node.js is not on PATH.' @(
        'Install Node.js 22.15 or newer (x64 MSI) from https://nodejs.org and reopen',
        'this shell. 20.x is the minimum the packages declare, but 22.15+ is strongly',
        'preferred on Windows: it honours the Windows certificate store, which is the',
        'clean answer to an internal-CA bMS certificate.'
    )
}
$NodeExe = $null
$NpmExe  = $null
$nodeVerRaw = '(not installed yet)'
if (-not $nodeCmd) {
    # Deferred. Everything below that needs the runtime is skipped by name at the
    # point it would have run, and the dry run stops after the certificate section
    # rather than previewing steps it cannot see.
    Write-Info 'Node is not on PATH in this process; the checks that need it are named as they are skipped.'
} else {

$NodeExe = $nodeCmd.Source
$nodeVerRaw = (& $NodeExe -v) -replace '^v', ''
$nv = [Version]($nodeVerRaw -replace '-.*$', '')
Write-Ok ("Node $nodeVerRaw at $NodeExe")
if ($nv -lt $nodeResolve.Floor.Min) {
    Abort "Node $nodeVerRaw is too old; the suite declares >=$($nodeResolve.Floor.Min)." @(
        "Install Node $($nodeResolve.Floor.Preferred) or newer and re-run."
    )
}
if ($nv -lt $nodeResolve.Floor.Preferred) {
    Write-Warn "Node $nodeVerRaw does not read the Windows certificate store."
    Write-Info 'If your bMS uses an internal CA you will need BCONNECT_CA_CERT_PATH.'
    Write-Info "Node $($nodeResolve.Floor.Preferred)+ removes that step entirely. Consider upgrading first."
}

# Resolve npm.cmd specifically. "Get-Command npm" prefers npm.ps1 when PATHEXT
# puts .ps1 first, and neither a PowerShell script nor an extensionless shell
# script can be launched through Process.Start.
$npmCandidates = @()
$c = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if ($c) { $npmCandidates += $c.Source }
$npmCandidates += (Join-Path (Split-Path -Parent $NodeExe) 'npm.cmd')
foreach ($cand in $npmCandidates) {
    if ($cand -and (Test-Path -LiteralPath $cand)) { $NpmExe = $cand; break }
}
if (-not $NpmExe) {
    Abort 'Could not find npm.cmd.' @(
        'npm ships with Node.js. Check that C:\Program Files\nodejs (or your Node',
        'installation directory) is on PATH and contains npm.cmd.'
    )
}
$npmVerResult = Invoke-Native $NpmExe @('-v') $PWD.Path
if ($npmVerResult.Code -ne 0) { Abort ('npm -v failed: ' + $npmVerResult.Output.Trim()) }
Write-Ok ("npm " + $npmVerResult.Output.Trim() + " at $NpmExe")

}   # end of the "Node is present" block

Write-Ok ("PowerShell $($PSVersionTable.PSVersion) on $([Environment]::OSVersion.VersionString)")

if (-not (Test-Path (Join-Path $SuiteRoot 'package.json'))) {
    Abort "No package.json under $SuiteRoot -- that does not look like the suite root." @(
        'Pass -SuiteRoot <path> pointing at the directory that contains',
        'package.json and the bconnect-*-mcp folders.'
    )
}
$presentDirs = @(Get-ChildItem -Path $SuiteRoot -Directory -Filter 'bconnect-*-mcp' |
                 Where-Object { $_.Name -ne 'bconnect-mcp-gateway' } | Select-Object -ExpandProperty Name)
Write-Ok ("suite root looks right -- $($presentDirs.Count) server package(s) present")
$missingCatalog = @($AllServers | Where-Object { $presentDirs -notcontains $_.dir } | Select-Object -ExpandProperty name)
if ($missingCatalog.Count) { Write-Warn ("not on disk, will not be offered: " + ($missingCatalog -join ', ')) }

# An offline bundle carries a manifest of what left the build machine. Reading it is
# the only integrity check available here: the target has no network, no npm and no
# second copy to compare against, and a bundle that arrived truncated, was built
# under a different Node major, or whose gateway silently did not compile otherwise
# reaches -SkipBuild undetected and presents as "the servers do not start" on a
# machine with no way to fix it.
if (-not $BundleManifest) { $BundleManifest = Join-Path $ProjectRoot 'offline-bundle.json' }
if (Test-Path -LiteralPath $BundleManifest) {
    # Paths in the manifest are relative to the manifest itself, so a bundle stays
    # checkable wherever it was copied to.
    $BundleRoot = Split-Path -Parent $BundleManifest
    Write-Ok "offline bundle manifest found -- $BundleManifest"
    $bm = $null
    try { $bm = Get-Content -LiteralPath $BundleManifest -Raw | ConvertFrom-Json } catch {
        Write-Warn ('the manifest is not valid JSON (' + $_.Exception.Message + '); skipping the bundle checks')
    }
    if ($bm) {
        $bmProps = @($bm.PSObject.Properties.Name)
        if ($bmProps -notcontains 'files') {
            Write-Warn 'this manifest predates file hashing -- integrity cannot be checked'
            Write-Info 'Rebuild the bundle with lib\New-OfflineBundle.ps1 to get a checkable one.'
        } else {
            $bad = @(); $gone = @(); $checked = 0
            foreach ($p in $bm.files.PSObject.Properties) {
                $full = Join-Path $BundleRoot $p.Name
                if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { $gone += $p.Name; continue }
                $checked++
                if ((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash -ne $p.Value) { $bad += $p.Name }
            }
            if ($gone.Count -or $bad.Count) {
                Write-Fail ("bundle integrity: $($gone.Count) file(s) missing, $($bad.Count) changed, $checked verified")
                foreach ($f in ($gone | Select-Object -First 5)) { Write-Info ("  missing  $f") }
                foreach ($f in ($bad  | Select-Object -First 5)) { Write-Info ("  changed  $f") }
                if (-not (Ask-YesNo 'Continue with a bundle that does not match its manifest?' $false $(if ($Force) { $true } else { $null }))) {
                    Abort 'the offline bundle does not match the manifest it shipped with' @(
                        'Copy the bundle again -- a truncated or interrupted transfer is the usual',
                        'cause -- or rebuild it with lib\New-OfflineBundle.ps1 on the connected machine.'
                    )
                }
            } else {
                Write-Ok "bundle integrity: $checked file(s) match the manifest"
            }
        }
        # Node major/minor. node_modules was resolved and, for native modules, built
        # against the recorded runtime; a different major is a real risk here.
        if ($bm.nodeVersion) {
            $bundleNv = $null
            try { $bundleNv = [Version](([string]$bm.nodeVersion) -replace '^v', '' -replace '-.*$', '') } catch { }
            if ($bundleNv -and $bundleNv.Major -ne $nv.Major) {
                Write-Warn ("this bundle was built under Node $($bm.nodeVersion); this machine runs $nodeVerRaw")
                Write-Info 'A different Node major can break any dependency with a native component.'
                Write-Info 'Install the recorded major here, or rebuild the bundle under this one.'
            } elseif ($bundleNv) {
                Write-Ok ("bundle Node $($bm.nodeVersion) matches this machine's major ($nodeVerRaw)")
            }
        }
        if ($bmProps -contains 'gatewayBuilt' -and -not $bm.gatewayBuilt -and ($Gateway -or $NeedGateway)) {
            Abort 'the gateway did not compile on the machine that built this bundle.' @(
                'Every HTTP host target needs it, and it cannot be built here -- that is what',
                'offline means. Rebuild the bundle on the connected machine (New-OfflineBundle.ps1',
                'now exits non-zero when this happens), or drop the HTTP targets from -Hosts.'
            )
        }
        if ($bmProps -contains 'buildFailures' -and @($bm.buildFailures).Count) {
            Write-Warn ('these packages were bundled unbuilt: ' + (@($bm.buildFailures) -join ', '))
            Write-Info 'They cannot be built here. Expect them to fail verification in Step 9.'
        }
    }
}

$qualifier = (Split-Path -Qualifier (Resolve-Path $SuiteRoot)) -replace ':', ''
$freeGb = [math]::Round((Get-PSDrive $qualifier).Free / 1GB, 1)
if ($freeGb -lt 2) {
    Write-Warn "only $freeGb GB free on ${qualifier}: -- a clean npm ci needs roughly 1.5 GB"
} else {
    Write-Ok "$freeGb GB free on ${qualifier}:"
}

# DPAPI protection needs the launcher shim on disk and a resolvable powershell.exe,
# because the Desktop configuration will name both. Checking here means the run stops
# before it writes a configuration that cannot start, rather than after.
if ($Protect) {
    $shim = Get-ShimPath
    if (-not (Test-Path -LiteralPath $shim)) {
        Abort "Credential protection needs $shim, which is missing." @(
            'lib\Start-BConnectServer.ps1 is the launcher that decrypts in memory and',
            'hands the values to node. Without it a protected installation cannot start.',
            'Re-run with -PlaintextCredentials to use the unprotected path instead.'
        )
    }
    Write-Ok ('launcher shim present -- ' + $shim)
    Write-Ok ('Windows PowerShell    -- ' + (Get-PowerShellExePath))
}

# -----------------------------------------------------------------------------
# Step 2 -- detect an existing installation
# -----------------------------------------------------------------------------
Write-Step 'Existing installation'

$existingConfig  = $null
$existingManaged = @()
# Only when that target is actually selected. Every other host is inspected a few
# lines below, through Get-HostFileList, which covers all of them including this
# one; this block exists solely for the extra reporting -ConfigPath supports, and
# printing a path for a client nobody asked for is how a run that touched no Claude
# file still read as a Claude installation.
if (($SelectedHosts -contains 'claude-desktop') -and (Test-Path $ConfigPath)) {
    try {
        $existingConfig = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    } catch {
        Abort "$ConfigPath is not valid JSON." @(
            'The installer will not overwrite a file it cannot parse.',
            'Fix the JSON, or move the file aside, and re-run.',
            '',
            'If there is an installation record, the managed entries can be rebuilt from it',
            'rather than retyped -- move the broken file aside, then run:',
            '    .\bconnect.ps1 hosts resync',
            'A .bak-<timestamp> copy from the last successful run is next to it.'
        )
    }
    if ($existingConfig.mcpServers) {
        $existingManaged = @($existingConfig.mcpServers.PSObject.Properties.Name |
                             Where-Object { $_ -like 'bconnect-*' })
    }
    $otherKeys = @($existingConfig.PSObject.Properties.Name | Where-Object { $_ -ne 'mcpServers' })
    Write-Ok "found $ConfigPath"
    Write-Info ("unrelated top-level keys that will be preserved: " + $(if ($otherKeys.Count) { $otherKeys -join ', ' } else { '(none)' }))
    if ($existingManaged.Count) {
        Write-Ok ("already configured: " + ($existingManaged -join ', '))
    } else {
        Write-Info 'no bconnect-* servers configured yet'
    }
} elseif ($SelectedHosts -contains 'claude-desktop') {
    Write-Info "no configuration at $ConfigPath yet -- one will be created"
}

$envExists = ($CredStore.Mode -ne 'none')
if ($envExists) {
    Write-Ok ("credentials file present: " + $CredStore.ActivePath)
    if ($CredStore.Mode -eq 'protected') {
        Write-Info 'stored DPAPI-protected (CurrentUser). Servers are launched through'
        Write-Info 'lib\Start-BConnectServer.ps1, which decrypts in memory.'
    }
    if ($CredStore.BothPresent) {
        Write-Warn 'BOTH a protected and a plaintext credentials file exist in the secrets directory.'
        Write-Info 'The protected one is treated as authoritative. The plaintext one is a leftover'
        Write-Info 'and is the weaker of the two, so it is what an attacker would take. Re-running'
        Write-Info 'and choosing a form removes whichever one is not in use.'
    }
} else {
    Write-Info "no credentials file at $EnvFile yet"
}

# -----------------------------------------------------------------------------
# What is deployed RIGHT NOW, across every host this run will touch
# -----------------------------------------------------------------------------
# The installer used to reconstruct its idea of the previous run from Claude
# Desktop's file alone. Everything downstream -- the server selection default, the
# write gate, the v1.1 gate, the anti-clobber checks -- now reads this instead, so
# a second host is not a second class of citizen.
$HostFiles     = Get-HostFileList $SelectedHosts
$hostConflicts = @()
$DeployedEnv   = Get-DeployedServerEnv -HostFiles $HostFiles -Conflicts ([ref]$hostConflicts)
$DeployedNames = @($DeployedEnv.Keys)
foreach ($c in $hostConflicts) {
    Write-Warn ("the hosts disagree about a server's env block -- $c")
    Write-Info 'This run will make them agree. Check the diff below before restarting the hosts.'
}
$CatalogNames   = @($AllServers | Select-Object -ExpandProperty name)
$UnmanagedNames = @($DeployedNames | Where-Object { $CatalogNames -notcontains $_ })
if ($UnmanagedNames.Count) {
    Write-Info ('unmanaged -- a bconnect-* entry that is not in lib\catalog.json, so this')
    Write-Info ('installer neither writes nor removes it: ' + ($UnmanagedNames -join ', '))
}
$ManagedDeployed = @($DeployedNames | Where-Object { $CatalogNames -contains $_ })
if ($ManagedDeployed.Count) {
    Write-Ok ('configured across ' + $HostFiles.Count + ' host(s): ' + ($ManagedDeployed -join ', '))
}

if ($VerifyOnly) {
    Write-Info 'running with -VerifyOnly -- skipping to verification'
} elseif ($existingManaged.Count -and -not $DryRun) {
    Write-Host ''
    Write-Info 'This looks like an existing installation. Reconfiguring will replace the'
    Write-Info 'bconnect-* entries and leave everything else in the file untouched.'
    if (-not (Ask-YesNo 'Continue and reconfigure?' $true)) {
        Write-Host ''
        Write-Info 'Nothing changed. Use -VerifyOnly to just re-check the current setup.'
        exit 0
    }
}

# -----------------------------------------------------------------------------
# Existing env file parsing (shape only -- values are never printed)
# -----------------------------------------------------------------------------
# Reads whichever form is in force, decrypting a protected file if that is what is
# there. The parser itself lives in lib\Dpapi.psm1 so that this script and the
# launcher shim cannot disagree about what a line in the file means.
function Read-EnvFile {
    param([string] $Path)
    return (Read-BConnectEnvMap -EnvFile $Path)
}

$existingEnv     = New-Object 'System.Collections.Specialized.OrderedDictionary'
$existingEnvText = ''
if ($envExists) {
    try {
        # The TEXT, not just the map: a reconfigure edits lines in place so that
        # comments, ordering and every key it was not asked about survive. See
        # Merge-EnvText in lib\Secrets.psm1.
        $existingEnvText = Read-BConnectEnvText -EnvFile $EnvFile
        $existingEnv     = ConvertFrom-EnvText -Text $existingEnvText
    } catch {
        # This used to say "Continuing as if none were present -- you will be asked
        # for them again", and then the next write OVERWROTE the file. For a DPAPI
        # blob the cause is almost always the wrong Windows account or the wrong
        # machine, which is recoverable; overwriting it is not.
        Write-Fail ('could not read the existing credentials: ' + $_.Exception.Message)
        if (-not $VerifyOnly) {
            if (-not $Force) {
                Abort 'Refusing to overwrite a credentials file that cannot be read.' @(
                    'A DPAPI-protected file is decryptable only by the Windows ACCOUNT that',
                    'created it, on the machine that created it. The usual cause is running as a',
                    'different account -- a scheduled task, an elevated shell, or a second admin',
                    'account -- not a corrupt file. Current account: ' +
                        ([Security.Principal.WindowsIdentity]::GetCurrent()).Name + '.',
                    '',
                    'Re-run as the account that created it, or move the file aside, or pass -Force',
                    'to overwrite it and enter the credentials again. -Force destroys whatever is',
                    'in it, including a v1.1 domain password that may not exist anywhere else.'
                )
            }
            Write-Warn '-Force given: the unreadable credentials file will be overwritten.'
        }
        $envExists = $false
        $existingEnvText = ''
    }
}

# -----------------------------------------------------------------------------
# The installation record, and every way it disagrees with the disk
# -----------------------------------------------------------------------------
# The record is INTENT. The host files and the credentials store are TRUTH.
# Disagreement is reported here and resolved by the operator, never silently.
if ($Record) {
    Write-Info ("installation record: $StateFile")
    Write-Info ('  last run ' + $Record.lastRun + ', written by installer ' + $Record.installerVersion +
                $(if ($Record.PSObject.Properties.Name -contains 'lastRunVerified' -and -not $Record.lastRunVerified) { ' -- that run was NOT verified' } else { '' }))
    $Drift = @(Get-InstallationDrift -Record $Record -HostFiles $HostFiles -EnvMap $existingEnv -NodeVersion $nodeVerRaw)
    foreach ($d in $Drift) {
        if ($d.Severity -eq 'edit') {
            Write-Warn $d.Text
            Write-Info ('  -> ' + $d.Action)
            Write-Info '  The installer wrote what it recorded, so a mismatch is an edit by a human or'
            Write-Info '  another tool. Continuing overwrites that entry; a backup is taken first and'
            Write-Info '  its path is printed with the merge report below.'
        } elseif ($d.Severity -eq 'warn') {
            Write-Warn $d.Text
            Write-Info ('  -> ' + $d.Action)
        } else {
            Write-Info ($d.Text + '   -> ' + $d.Action)
        }
    }
    if (-not $Drift.Count) { Write-Ok 'no drift -- every recorded entry is exactly as this installer left it' }
} else {
    $Drift = @()
    Write-Info "no installation record at $StateFile"
    if ($ManagedDeployed.Count) {
        Write-Info 'This installation predates the record, which is the normal state of every'
        Write-Info 'installation in the field. It will be ADOPTED: the record written at the end'
        Write-Info 'of this run describes what is on disk, reconstructed from the host files and'
        Write-Info 'the credentials store.'
    }
}

if (-not $VerifyOnly) {

# Steps 3 to 5 are the USER half: the credential, what it can reach, and the file
# it is stored in. All three are per-user by construction -- a DPAPI blob is
# CurrentUser scope and a prompt needs somebody at a console -- so the machine
# stage does none of them and says so rather than appearing to have done them.
if ($StageDoesUser) {

# -----------------------------------------------------------------------------
# Step 3 -- credentials
# -----------------------------------------------------------------------------
Write-Step 'Credentials'

# The base-URL shape rule, in one place. Every module class appends its own segment
# ('/software/v2.0', ...), so a module segment here produces doubled paths -- and
# because bConnect answers 401 rather than 404 for an unknown route, the result is
# indistinguishable from a rejected credential. The interactive path offers to fix
# it; the non-interactive path refuses and names the fix. Same rule, one regex.
# Whether THIS computer is joined to a domain. Read once; a failure to read it is
# treated as "domain", which keeps the stricter rule as the default -- guessing
# "standalone" would switch the check off on a machine that needs it.
$script:DomainJoined = $true
try { $script:DomainJoined = [bool](Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop).PartOfDomain } catch { }

function Test-V11UpnProblem {
    <#
        .SYNOPSIS
        The reason a v1.1 username will not work, or $null if it looks fine.

        .DESCRIPTION
        bConnect v1.1 returns HTTP 401 for a bare account name -- verified live,
        and stated in the product code at packages/mcp-core/src/v11-client.ts.
        A 401 is indistinguishable from a wrong password, so an operator who
        types "jsmith" will spend their time re-checking the password. The
        installer previously accepted anything and echoed it back as success.

        Deliberately a shape check and not an existence check: only the bMS can
        say whether the account is in a bConnect security group, which is what
        the Step 4 v1.1 probe is for.
    #>
    param([string] $User, [bool] $DomainJoined = $true)
    if ([string]::IsNullOrWhiteSpace($User)) { return 'a username is required' }
    # A STANDALONE MACHINE HAS NO UPN, AND HAS ITS OWN FORM.
    #
    # The UPN rule below was verified against a DOMAIN-JOINED bMS, which is the only
    # place it holds. On a workgroup server there is no domain to put after an @, so
    # demanding UPN form refuses the only forms that exist -- reported from a
    # standalone test server, where the run stopped on the one account available.
    #
    # MEASURED SINCE, against bConnect on a standalone server with a local account:
    # HOSTNAME\Username authenticates. That is now stated positively rather than the
    # check merely being switched off, because "we do not know" leaves the operator
    # to discover the form from a 401 -- which is the ambiguity this whole function
    # exists to remove.
    if (-not $DomainJoined) {
        if ($User -match '^[^\\@\s]+\\[^\\@\s]+$') { return $null }
        # The account part sits on OPPOSITE sides of the separator in the two forms:
        # after the backslash in DOMAIN\user, before the at-sign in user@domain. One
        # greedy strip handled neither -- it turned svc@corp.local into 'corp.local'
        # and suggested the domain as the account name.
        $account = $(if ($User -match '\\') { ($User -split '\\')[-1] }
                     elseif ($User -match '@') { ($User -split '@')[0] }
                     else { $User })
        $suggest = $env:COMPUTERNAME + '\' + $account
        if ($User -match '@') {
            return ("this computer is not domain-joined, so there is no domain for a UPN. " +
                    "v1.1 needs HOSTNAME\account here -- try $suggest.")
        }
        return ("this computer is not domain-joined. v1.1 returns 401 for a bare account name; " +
                "it needs HOSTNAME\account -- try $suggest.")
    }
    if ($User -match '^[^\\]+\\[^\\]+$') {
        return ("that is DOMAIN\user form. v1.1 needs UPN form -- try " +
                ($User -replace '^([^\\]+)\\(.+)$', '$2@$1') +
                ' with your full DNS domain, e.g. user@corp.local.')
    }
    if ($User -notmatch '^[^@\s]+@[^@\s]+$') {
        return 'v1.1 returns 401 for a bare account name. Use UPN form: user@domain, e.g. svc-bconnect@corp.local.'
    }
    if ($User -notmatch '@[^@\s]*\.[^@\s]+$') {
        return ("'" + $User + "' has no dot in the domain part. UPN form normally uses the full DNS domain, e.g. user@corp.local.")
    }
    return $null
}

function Test-BaseUrlShape {
    param([string] $Url)
    $r = [ordered]@{ Ok = $true; Problem = $null; Suggestion = $null }
    if ($Url -notmatch '^https?://') {
        $r.Ok = $false; $r.Problem = 'must start with https:// (or http:// on a lab system)'
        return [pscustomobject]$r
    }
    $u = $Url.TrimEnd('/')
    if ($u -match '(?i)(/bconnect)/(endpoints|software|jobs|compliance|assets|groups|variables|defensecontrol|activedirectory|operatingsystems|servermanagement|universaldynamicgroups|updatemanagement)(/.*)?$') {
        $r.Ok = $false
        $r.Problem = 'that URL carries a module segment; it must stop at /bconnect'
        $r.Suggestion = ($u -replace '(?i)(/bconnect)/.*$', '$1')
        return [pscustomobject]$r
    }
    if ($u -notmatch '(?i)/bconnect$') {
        $r.Ok = $false
        $r.Problem = 'that URL does not end in /bconnect, which is where bConnect normally lives'
        return [pscustomobject]$r
    }
    return [pscustomobject]$r
}

$reuse = $false
if ($envExists -and $existingEnv['BCONNECT_BASE_URL']) {
    if ($ReuseCredentials) {
        $reuse = $true
    } elseif ($NonInteractive) {
        # The caller says what it means by what it passes: credentials supplied means
        # replace them, nothing supplied means keep what is already there.
        $reuse = (-not $BaseUrl -and -not $ApiKeySecure -and -not $BasicPassSecure)
        Write-Info ('existing credentials will be ' + $(if ($reuse) { 'kept' } else { 'replaced' }) + '   (non-interactive)')
    } else {
        Write-Info ('current base URL: ' + $existingEnv['BCONNECT_BASE_URL'])
        $authKind = 'none'
        if ($existingEnv['BCONNECT_API_KEY']) { $authKind = 'API key (value not shown)' }
        elseif ($existingEnv['BCONNECT_USERNAME']) { $authKind = 'Basic as ' + $existingEnv['BCONNECT_USERNAME'] }
        Write-Info ('current auth:     ' + $authKind)
        $reuse = Ask-YesNo 'Keep these credentials?' $true
    }
}

# $BaseUrl / $ApiKeySecure / $BasicUser / $BasicPassSecure / $V11User / $V11PassSecure
# are PARAMETERS now: in -NonInteractive they arrive already filled, and the
# interactive branch below assigns to the same variables from its prompts. They are
# deliberately NOT reset here -- doing so would silently discard everything a
# non-interactive caller passed.
$CaCertPath = $CaCert

if ($reuse) {
    Write-Ok 'keeping the existing credentials'
    $BaseUrl = $existingEnv['BCONNECT_BASE_URL']
    if (-not $CaCertPath) { $CaCertPath = $existingEnv['BCONNECT_CA_CERT_PATH'] }
} elseif ($NonInteractive) {
    Require-Answer ([bool]$BaseUrl) 'BaseUrl' 'The bConnect base URL, ending at /bconnect.'
    Require-Answer ([bool]($ApiKeySecure -or ($BasicUser -and $BasicPassSecure))) 'ApiKeySecure' `
        'Either -ApiKeySecure, or -BasicUser together with -BasicPassSecure.'
    $BaseUrl = $BaseUrl.Trim().TrimEnd('/')
    $shape = Test-BaseUrlShape $BaseUrl
    if (-not $shape.Ok) {
        if ($shape.Suggestion) {
            Abort ("-BaseUrl is not usable: " + $shape.Problem) @(
                "Each server appends its own module path, so this would produce doubled URLs.",
                "Use '$($shape.Suggestion)' instead."
            )
        }
        # Not ending in /bconnect is a warning interactively ("use it anyway?"), so it
        # stays a warning here rather than becoming a hard stop only scripts can hit.
        Write-Warn $shape.Problem
    }
    if ($BaseUrl -match '^http://') { Write-Warn 'http:// sends the API key in clear text over the network' }
    Write-Ok "base URL: $BaseUrl"
    if ($ApiKeySecure) { Write-Ok 'API key supplied as a SecureString (not displayed)' }
    else               { Write-Ok "Basic credentials supplied for $BasicUser (password not displayed)" }
    if ($V11User -and $V11PassSecure) {
        # Same check the guided run makes. A script that passes a bare account
        # name would otherwise be told "supplied" and get 401s from every v1.1
        # call, which read as a wrong password rather than a wrong username.
        $upnProblem = Test-V11UpnProblem -User $V11User -DomainJoined $script:DomainJoined
        if ($upnProblem) { Abort ("-V11User '$V11User' will not authenticate: $upnProblem") }
        Write-Ok "v1.1 Basic credentials supplied for $V11User"
    } elseif ($V11User -xor [bool]$V11PassSecure) {
        Abort '-V11User and -V11PassSecure must be given together.'
    }
    if ($CaCertPath) {
        if (Test-Path -LiteralPath $CaCertPath) { Write-Ok "CA certificate: $CaCertPath" }
        else { Write-Warn "no file at $CaCertPath -- skipping"; $CaCertPath = $null }
    }
} else {
    Write-Info 'Nothing you type here is echoed, written to a log, or placed on a command line.'
    Write-Host ''

    # -- base URL -------------------------------------------------------------
    # The base URL must stop at /bconnect. Every module class appends its own
    # segment ('/software/v2.0', ...), so a module segment here produces doubled
    # paths -- and because bConnect answers 401 rather than 404 for an unknown
    # route, the result is indistinguishable from a rejected credential.
    while ($true) {
        $suggest = $existingEnv['BCONNECT_BASE_URL']
        $prompt  = '  bConnect base URL (e.g. https://bms.example.com/bconnect)'
        if ($suggest) { $prompt = $prompt + " [$suggest]" }
        $BaseUrl = (Read-Host $prompt).Trim()
        if (-not $BaseUrl -and $suggest) { $BaseUrl = $suggest }
        if (-not $BaseUrl) { continue }

        if ($BaseUrl -notmatch '^https?://') {
            Write-Host '         must start with https:// (or http:// on a lab system)' -ForegroundColor Yellow
            continue
        }
        if ($BaseUrl -match '^http://') { Write-Warn 'http:// sends the API key in clear text over the network' }

        $BaseUrl = $BaseUrl.TrimEnd('/')
        $shape = Test-BaseUrlShape $BaseUrl        # same rule the -NonInteractive path applies
        if (-not $shape.Ok -and $shape.Suggestion) {
            Write-Warn $shape.Problem
            Write-Info "each server appends its own module path, so this would produce doubled URLs"
            if (Ask-YesNo ("Use '$($shape.Suggestion)' instead?") $true) { $BaseUrl = $shape.Suggestion } else { continue }
        } elseif (-not $shape.Ok) {
            Write-Warn $shape.Problem
            if (-not (Ask-YesNo 'Use it anyway?' $false)) { continue }
        }
        break
    }
    Write-Ok "base URL: $BaseUrl"

    # -- authentication -------------------------------------------------------
    Write-Host ''
    Write-Info 'Authentication for the v2.0 API:'
    Write-Info '  1) API key   (recommended -- bMS console, Server Management -> API Keys)'
    Write-Info '  2) Username + password (Basic)'
    $choice = Read-Host '  choose 1 or 2 [1]'
    if ([string]::IsNullOrWhiteSpace($choice)) { $choice = '1' }
    if ($choice -eq '2') {
        $BasicUser = (Read-Host '  bConnect username').Trim()
        $BasicPassSecure = Read-Secret 'bConnect password (hidden)'
    } else {
        $ApiKeySecure = Read-Secret 'bConnect API key (hidden)'
    }
    Write-Ok 'credentials captured (not displayed)'

    # -- optional v1.1 Basic credentials --------------------------------------
    #
    # This prompt used to describe v1.1 only as "job configuration v2.0 omits",
    # and asked for a bare "v1.1 username". Both undersold it. What is being
    # asked for here is a Windows/AD DOMAIN ACCOUNT -- materially more
    # privileged than the API key just supplied, going into the same file --
    # and it must be in UPN form or every v1.1 call returns 401 with no hint.
    Write-Host ''
    Write-Info 'bConnect v1.1 is a second API version, reached with different credentials.'
    Write-Host ''
    Write-Host '  What it asks for: a Windows/Active Directory account that is a member of a' -ForegroundColor Yellow
    Write-Host '  bConnect security group on the bMS. That is a domain account, not an API' -ForegroundColor Yellow
    Write-Host '  key -- a more privileged credential than the one you just entered, stored' -ForegroundColor Yellow
    Write-Host '  in the same file. Supply it only if you want the v1.1 capabilities.' -ForegroundColor Yellow
    Write-Host ''
    Write-Info 'What it buys you:'
    Write-Info '  - custom inventory scans (registry / WMI / file) per endpoint'
    Write-Info '  - Microsoft Update profiles and per-endpoint update inventory'
    Write-Info '  - richer job diagnosis (Steps, JobExecutionTimeout, AbortOnError,'
    Write-Info '    Destructive) -- these degrade gracefully without it'
    Write-Info 'v1.1 is LAN-only: it is not served through the bConnect gateway, so a'
    Write-Info 'gateway or WAN deployment cannot reach it.'
    if (Ask-YesNo 'Configure v1.1 Basic credentials as well?' $false) {
        while ($true) {
            $prompt = $(if ($script:DomainJoined) { '  v1.1 username in UPN form (e.g. svc-bconnect@corp.local)' }
                        else { "  v1.1 username as HOSTNAME\account (e.g. $env:COMPUTERNAME\Administrator)" })
            $V11User = (Read-Host $prompt).Trim()
            if (-not $V11User) { Write-Info 'skipped'; break }
            $bad = Test-V11UpnProblem -User $V11User -DomainJoined $script:DomainJoined
            if (-not $bad) { break }
            Write-Warn $bad
        }
        if ($V11User) {
            $V11PassSecure = Read-Secret 'v1.1 password (hidden)'
            Write-Ok "v1.1 credentials captured for $V11User (password not displayed)"
        }
    } else {
        Write-Info 'skipped -- tools that need v1.1 will report configuration.available:false'
    }

    # -- optional CA certificate ----------------------------------------------
    if ($nv.Major -lt 22 -or ($nv.Major -eq 22 -and $nv.Minor -lt 15)) {
        Write-Host ''
        $ca = (Read-Host '  path to a PEM CA certificate, if your bMS uses an internal CA (blank to skip)').Trim()
        if ($ca) {
            if (Test-Path $ca) { $CaCertPath = $ca; Write-Ok "CA certificate: $ca" }
            else { Write-Warn "no file at $ca -- skipping" }
        }
    }
}

# -- how the credentials are stored ------------------------------------------
# Opt-in, and the default is exactly today's behaviour. $Protect was decided near
# the top of the script, where the per-user refusal needed it; the only thing left
# to do here is offer the choice to an operator who is present to make it.
if (-not $ProtectCredentials -and -not $PlaintextCredentials -and -not $NonInteractive) {
    Write-Host ''
    Write-Info 'The credentials file can be stored DPAPI-encrypted for your Windows account.'
    Write-Info 'It protects a file that walks off this machine -- a copy, a backup, an'
    Write-Info 'accidental commit. It does NOT protect against malware running as you, which'
    Write-Info 'can call DPAPI itself. Servers are then launched through a small shim that'
    Write-Info 'decrypts in memory; nothing decrypted is written to disk or put on a command line.'
    $Protect = Ask-YesNo 'Store the credentials DPAPI-protected?' $Protect
}
if ($Protect) {
    Write-Ok 'credentials will be stored DPAPI-protected (CurrentUser scope, with entropy)'
    if ($CredStore.Mode -eq 'plaintext') { Write-Info 'the existing plaintext file will be overwritten with zeros and removed' }
} else {
    Write-Ok 'credentials will be stored in plaintext, protected by the directory ACL only'
    if ($CredStore.Mode -eq 'protected') { Write-Info 'the existing protected file will be converted back and removed' }
}
Send-Progress 'credentialMode' @{ protect = [bool]$Protect }

# -- one installation, one bConnect server ------------------------------------
#
# THE LAST POINT BEFORE ANYTHING IS WRITTEN. Step 4 only reads; Step 5 writes the
# credentials file. So this is where a run that would silently replace one estate
# with another has to stop, and it is one place that BOTH front ends reach: the
# console run falls through here after its prompts, and the wizard drives this
# same script with -NonInteractive. There is no second copy of the rule in the
# window, and the comparison itself is in lib\State.psm1 so that `bconnect set url`
# decides sameness the same way.
#
# Interactive and non-interactive behave identically on purpose. This is not a
# question -- there is no answer an operator could give that makes two estates fit
# in one record and one set of entry names -- so it is a refusal in both, and
# -NonInteractive gets the reason on standard output and a non-zero exit rather
# than a prompt nobody can see.
$EstateChange = Get-EstateChange -Record $Record -EnvMap $existingEnv `
                                 -RequestedUrl $BaseUrl -AcceptedFrom $ReplacingBaseUrl
if ($EstateChange) {
    Abort 'this installation is already configured for a different bConnect server.' @(
        ('recorded   ' + $EstateChange.RecordedUrl),
        ('requested  ' + $EstateChange.RequestedUrl),
        '',
        'The entries this installer writes into a client configuration are keyed by',
        'bare server name -- bconnect-endpoints, bconnect-jobs -- and each one names a',
        'single credentials file by absolute path. Installing a second estate over the',
        'top would replace those entries and re-point every configured client at the',
        'other bConnect server, with nothing in any client looking different. The next',
        'job assigned from an assistant would be assigned there.',
        '',
        'Two supported ways forward, both of which leave one installation pointed at',
        'one server:',
        '',
        ('  move this installation:   .\bconnect.ps1 set url ' + $EstateChange.RequestedUrl),
        '                            one line in the credentials file; no client',
        '                            configuration changes at all.',
        '',
        '  or remove it first:       .\bconnect.ps1 uninstall',
        '                            then install again against the new server.',
        '',
        'Running two estates side by side from one Windows account is not supported.',
        'Use a second Windows account, or a second machine, for the second estate.'
    )
}

# -----------------------------------------------------------------------------
# Step 4 -- reachability, using the credentials just collected
# -----------------------------------------------------------------------------
Write-Step 'bConnect reachability'

# Deliberately NOT the health path mcp-core probes by default. Its default is
# "/v2.0/WindowsEndpoints", which omits the module segment; the real route is
# "/endpoints/v2.0/WindowsEndpoints". That single missing segment makes all 13
# servers fail their startup probe and process.exit(1) against a perfectly good
# bMS (finding B1/F7). The env file this installer writes therefore sets
# BCONNECT_SKIP_CONNECTIVITY_CHECK=true, and this step does the connectivity
# check properly instead.
$healthPath = '/endpoints/v2.0/WindowsEndpoints?$top=1'
$healthUrl  = $BaseUrl + $healthPath

$plainKey  = $null
$plainPass = $null
$reachOk   = $false
# Set when an HTTP response of any status came back, which is the proof that DNS,
# the port and the TLS handshake all worked from THIS process's point of view.
$reachHttpStatus = $null
try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
} catch { }

try {
    $headers = @{ 'Accept-Encoding' = 'gzip, deflate' }   # bConnect answers 406 to brotli
    if ($reuse) {
        if ($existingEnv['BCONNECT_API_KEY'])      { $headers['X-Api-Key'] = $existingEnv['BCONNECT_API_KEY'] }
        elseif ($existingEnv['BCONNECT_USERNAME']) {
            $pair = $existingEnv['BCONNECT_USERNAME'] + ':' + $existingEnv['BCONNECT_PASSWORD']
            $headers['Authorization'] = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
        }
    } elseif ($ApiKeySecure) {
        $plainKey = ConvertFrom-SecureStringPlain $ApiKeySecure
        $headers['X-Api-Key'] = $plainKey
    } else {
        $plainPass = ConvertFrom-SecureStringPlain $BasicPassSecure
        $pair = $BasicUser + ':' + $plainPass
        $headers['Authorization'] = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
    }

    $resp = Invoke-WebRequest -Uri $healthUrl -Headers $headers -UseBasicParsing -TimeoutSec 25 -Method Get
    Write-Ok ("GET /endpoints/v2.0/WindowsEndpoints -> HTTP " + [int]$resp.StatusCode)
    $reachOk = $true
} catch {
    $status = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { $status = [int]$_.Exception.Response.StatusCode }
    $reachHttpStatus = $status
    if ($status) {
        Write-Fail ("GET /endpoints/v2.0/WindowsEndpoints -> HTTP $status")
        if ($status -eq 401) {
            # A 401 carries WWW-Authenticate, and it is not a hint -- it is the
            # server stating which authentication schemes it will accept. Reading
            # it turns the most ambiguous response in this installer into a
            # specific one, and it costs a header lookup.
            #
            # The case that made this necessary: a bConnect site with only Windows
            # authentication enabled in IIS answers Negotiate and nothing else. A
            # Basic username and password is then refused HOWEVER CORRECT IT IS,
            # with a 401 indistinguishable from a wrong password -- so the operator
            # retypes the credential, which is the one thing that cannot help.
            # Captured, not read as $_ inside the block below: ForEach-Object rebinds
            # $_ to each pipeline item, and reading the error record through it after
            # that point is a trap this codebase should not step into twice.
            $errRecord = $_
            $schemes = @()
            try {
                $wwwAuth = $errRecord.Exception.Response.Headers['WWW-Authenticate']
                if ($wwwAuth) {
                    # Trim BEFORE splitting on whitespace. IIS sends the list as
                    # "Negotiate, NTLM" -- one header, comma-separated, with a space
                    # after the comma -- so splitting the untrimmed " NTLM" yields an
                    # empty first element and the scheme is silently dropped. Caught
                    # by lib\Test-AuthDiagnosis.ps1, which sends exactly that header.
                    $schemes = @(($wwwAuth -split ',') |
                                 ForEach-Object { ($_.Trim() -split '\s+')[0] } |
                                 Where-Object { $_ } | Select-Object -Unique)
                }
            } catch { }

            $sentBasic = [bool]($headers['Authorization'])
            if ($schemes.Count) {
                Write-Info ('The server offers: ' + ($schemes -join ', '))
                if ($sentBasic -and -not ($schemes -match '(?i)^basic$')) {
                    Write-Fail 'Basic authentication is NOT among them, and this run sent a username and password.'
                    Write-Info 'The credential cannot succeed here whatever it is. Two ways forward:'
                    Write-Info '  * enable Basic Authentication on the bConnect site in IIS Manager, or'
                    Write-Info '  * use a bConnect API key instead -- bMS console, Server Management, API Keys.'
                    Write-Info 'An API key is carried in a header rather than a scheme, so it works'
                    Write-Info 'against a site configured this way.'
                }
            }
            Write-Info 'Otherwise a 401 here is ambiguous by design: bConnect answers 401, not 404,'
            Write-Info 'for routes it does not recognise. So it means EITHER the credential is wrong'
            Write-Info 'OR the base URL is wrong. Check the URL first -- it is the more common'
            Write-Info 'mistake, and the more expensive one to misdiagnose.'
            Write-Info 'The certificate check below is separate and has already ruled TLS in or out.'
        } elseif ($status -eq 403) {
            Write-Info 'Authenticated but not authorised to read Windows endpoints. Widen the'
            Write-Info 'API key scope in the bMS console, or expect empty results everywhere.'
        } elseif ($status -eq 404) {
            Write-Info 'A 404 from bConnect is unusual: it answers 401 for routes it does not'
            Write-Info 'recognise. Something in front of the bMS -- a proxy or a rewrite rule --'
            Write-Info 'is more likely to have produced this than bConnect itself.'
        }
    } else {
        # Deliberately no diagnosis here any more. This branch used to guess at the
        # cause from the exception text, matching 'trust|SSL|certificate|secure
        # channel', which conflated an untrusted issuer with an expired certificate
        # with a hostname mismatch -- three problems with three different fixes -- and
        # said nothing at all about DNS, a closed port or a timeout. The certificate
        # section below names the cause from the runtime that will carry the traffic.
        Write-Fail ('GET /endpoints/v2.0/WindowsEndpoints -> ' + $_.Exception.Message)
    }
}

# -- the certificate, judged by the runtime that will carry the traffic --------
#
# This is expected to be the most common first-run failure of this product, because
# a bMS in an offline enterprise almost always presents a certificate from an
# internal CA. Two things make it worth a step of its own rather than a line in the
# catch block above.
#
# The first is that the probe above is the WRONG ARBITER. Invoke-WebRequest validates
# against the Windows certificate store; the thirteen servers validate against Node's
# list, which includes the Windows store only from Node 22.15. An internal CA that is
# installed in Windows and invisible to Node therefore passes the check above and
# fails in every server at startup -- an installation that reads green and does not
# work. Only a probe run through Node can see that.
#
# The second is that "TLS failed" is not an answer. An untrusted issuer is fixed by
# supplying the CA; an expired certificate is fixed on the bMS and by nothing here; a
# hostname mismatch is fixed by changing the base URL. Offering the CA prompt for the
# second or third would be a confident wrong answer, so only the first one asks.
$Tls           = $null
$TlsUnresolved = $false
$Tls = Invoke-TlsProbe -Url $BaseUrl -CaPath $CaCertPath
if (-not $Tls) {
    if (-not $NodeExe) {
        Write-Warn 'the certificate was not checked the way the servers will: Node is not installed yet.'
        Write-Info 'That check runs through Node, because Node is what carries the traffic and it'
        Write-Info 'judges certificates by its own list rather than by the Windows store. Setup'
        Write-Info 'installs Node, and the same check then runs during the install itself.'
    } else {
        Write-Warn 'the certificate could not be checked -- lib\probe-tls.mjs returned no result'
    }
    Write-Info 'What is reported above is the Windows view only. A certificate signed by an'
    Write-Info 'internal CA can still be rejected by every server at startup.'
} else {
    Show-TlsDiagnosis $Tls

    # The remedy, inline. `caFixable` is true for exactly one cause -- an issuer this
    # runtime does not trust -- so this prompt cannot appear after an expired
    # certificate or a name mismatch, where a CA file would change nothing.
    while ($Tls.caFixable -and -not $NonInteractive) {
        Write-Host ''
        $ans = (Read-Host '  path to the PEM file holding that CA (blank to continue without it)').Trim().Trim('"')
        if (-not $ans) {
            Write-Warn 'no CA certificate supplied -- every server will be refused by the same check'
            break
        }
        if (-not (Test-Path -LiteralPath $ans)) { Write-Warn "no file at $ans"; continue }
        $retry = Invoke-TlsProbe -Url $BaseUrl -CaPath $ans
        if (-not $retry) { Write-Warn 'the certificate could not be re-checked'; break }
        Write-Host ''
        Show-TlsDiagnosis $retry
        $Tls = $retry
        if ($Tls.cause -eq 'trusted') {
            $CaCertPath = (Resolve-Path -LiteralPath $ans).Path
            Write-Ok "BCONNECT_CA_CERT_PATH will be set to $CaCertPath"
            break
        }
    }

    if ($Tls.cause -ne 'trusted' -and $Tls.cause -ne 'not-tls') {
        $TlsUnresolved = $true
        if ($NonInteractive -and $Tls.caFixable) {
            Write-Info 'Pass -CaCert with the path to that PEM file to settle this in an unattended run.'
        }
    }
}

# -- the two verdicts, reconciled ---------------------------------------------
$continueDefault = $false
if ($reachOk -and $TlsUnresolved) {
    # The silent one. Green above, thirteen failed servers afterwards.
    Write-Host ''
    Write-Warn 'this computer accepts that certificate and the runtime the servers use does not'
    Write-Info 'The request above succeeded because Invoke-WebRequest validates against the'
    Write-Info 'Windows certificate store. Every server validates the way the check above it did,'
    Write-Info 'so all thirteen will be refused at startup while this step reads as green.'
    $reachOk = $false
} elseif (-not $reachOk -and -not $TlsUnresolved -and -not $reachHttpStatus -and $Tls -and $Tls.cause -eq 'trusted') {
    # The mirror image: the servers will trust it, this process did not. Common the
    # moment a CA file is supplied above, because the file settles Node and leaves the
    # Windows store exactly as it was.
    Write-Host ''
    Write-Info 'The certificate is trusted by the runtime the servers use. The request above failed'
    Write-Info 'before the credential was ever presented, because this installer validates against'
    Write-Info 'the Windows certificate store and that store does not hold the same CA. Installing'
    Write-Info 'the CA there as well makes this check work; Step 9 proves the credential either way'
    Write-Info 'by starting the real servers.'
    $continueDefault = $true
}

if (-not $reachOk) {
    Write-Host ''
    if (-not (Ask-YesNo 'bConnect is not reachable with these settings. Continue anyway?' $continueDefault $ContinueOnUnreachable)) {
        if ($plainKey)  { $plainKey  = $null }
        if ($plainPass) { $plainPass = $null }
        Abort 'Stopped at your request.' @('Re-run once the URL, credentials or TLS trust are corrected.')
    }
    Write-Warn 'continuing with unverified connectivity -- verification in Step 9 will fail'
}

# -- bMS release, from the same credentials and the same route the servers use --
#
# This suite is 26R1-only: several tools call routes that do not exist before it.
# bConnect answers 401 -- not 404 -- for a route it does not recognise, and every
# diagnostic in this installer and its documentation trains an operator to read a
# 401 as a wrong URL or a wrong credential. So an install against an older bMS was
# clean, verified green, and then failed per call in a way whose documented remedy
# was to go and change credentials that were never wrong.
#
# GET /servermanagement/v2.0/ManagementServer is the route mcp-core's own startup
# gate reads, and its `version` field is the bMS actually being talked to -- not a
# registry key on this machine, which says nothing about a remote bMS. Probing the
# same route here means the installer's verdict and the servers' verdict cannot
# disagree. A credential scoped away from servermanagement cannot answer, and that
# is reported as unknown rather than as a failure: it is exactly what mcp-core does.
$BmsVersionRaw = $null
$BmsRelease    = $null

function ConvertTo-BmsRelease {
<#
.SYNOPSIS
    Parse a bMS version string to @{ Major; Release }, or $null.
.DESCRIPTION
    Both spellings the API and this codebase use: the release form ("26R1",
    "bMS 2026 R1") and the dotted build form ("26.1.180.0"), whose first two
    components are the same pair. A year-form major is normalised (2026 -> 26).
#>
    param([string] $Version)
    if ([string]::IsNullOrWhiteSpace($Version)) { return $null }
    $major = $null; $rel = $null
    if ($Version -match '(?i)(\d{2,4})\s*R\s*(\d+)') { $major = [int]$Matches[1]; $rel = [int]$Matches[2] }
    elseif ($Version -match '(\d{2,4})\.(\d+)')      { $major = [int]$Matches[1]; $rel = [int]$Matches[2] }
    else { return $null }
    if ($major -ge 2000) { $major -= 2000 }
    return @{ Major = $major; Release = $rel }
}

if ($reachOk) {
    $mgmtUrl = $BaseUrl + '/servermanagement/v2.0/ManagementServer'
    try {
        $mgmtResp = Invoke-WebRequest -Uri $mgmtUrl -Headers $headers -UseBasicParsing -TimeoutSec 25 -Method Get
        $mgmtBody = $null
        try { $mgmtBody = $mgmtResp.Content | ConvertFrom-Json } catch { }
        if ($mgmtBody -and $mgmtBody.version) { $BmsVersionRaw = [string]$mgmtBody.version }
        if ($BmsVersionRaw) {
            $BmsRelease = ConvertTo-BmsRelease $BmsVersionRaw
            if (-not $BmsRelease) {
                Write-Warn ("the bMS reports version '$BmsVersionRaw', which does not parse as a release")
                Write-Info 'Continuing. Confirm yourself that this bMS is 26R1 or newer -- against an'
                Write-Info 'older one several tools return missing or inaccurate data.'
            } elseif ($BmsRelease.Major -lt 26 -or ($BmsRelease.Major -eq 26 -and $BmsRelease.Release -lt 1)) {
                Write-Fail ("this bMS reports version '$BmsVersionRaw' -- $($BmsRelease.Major)R$($BmsRelease.Release)")
                Write-Info 'This suite requires baramundi Management Suite 26R1 or later. Several tools'
                Write-Info 'call bConnect routes added in 26R1; on an older bMS those routes answer 401,'
                Write-Info 'which looks exactly like a wrong URL or a wrong credential. The servers'
                Write-Info 'enforce the same minimum at startup and will refuse to run here.'
                Write-Host ''
                if (-not (Ask-YesNo 'Install anyway, knowing the servers will refuse to start?' $false $(if ($Force) { $true } else { $null }))) {
                    if ($plainKey)  { $plainKey  = $null }
                    if ($plainPass) { $plainPass = $null }
                    Abort "bMS $BmsVersionRaw is older than the 26R1 this suite requires." @(
                        'Upgrade the bMS, or install this suite against a 26R1 or newer server.',
                        'Nothing has been written to the credentials file or to any host configuration.'
                    )
                }
                Write-Warn "continuing against bMS $BmsVersionRaw, which is below the supported 26R1"
            } else {
                Write-Ok ("bMS release $BmsVersionRaw  ($($BmsRelease.Major)R$($BmsRelease.Release), meets the 26R1 minimum)")
            }
        } else {
            Write-Warn 'GET /servermanagement/v2.0/ManagementServer answered without a version field'
            Write-Info 'Confirm yourself that this bMS is 26R1 or newer.'
        }
    } catch {
        $mgmtStatus = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { $mgmtStatus = [int]$_.Exception.Response.StatusCode }
        Write-Warn ('could not read the bMS release: GET /servermanagement/v2.0/ManagementServer -> ' +
                    $(if ($mgmtStatus) { "HTTP $mgmtStatus" } else { $_.Exception.Message }))
        Write-Info 'These credentials are not scoped for the servermanagement module, or the route'
        Write-Info 'is absent. Reads elsewhere are unaffected and the install continues, but the'
        Write-Info '26R1 minimum could not be checked -- confirm the bMS release yourself.'
    }
}

# -- v1.1 reachability, reported separately from v2.0 -------------------------
#
# v1.1 is a different API version, on a different path, with a different
# credential and a different auth scheme. The v2.0 probe above says nothing
# about it. Without this, a wrong v1.1 credential stayed invisible until a tool
# call -- and there was no tool call, because the gate was never written.
#
# The 401 diagnosis here is NOT the ambiguous one above. v1.1 rejects a bare
# account name with 401, so a username shape problem and a group-membership
# problem produce the same status, and both are named.
$v11ProbeUser = $V11User
$v11ProbePass = $null
if ($V11PassSecure) { $v11ProbePass = ConvertFrom-SecureStringPlain $V11PassSecure }
elseif ($reuse) {
    $v11ProbeUser = $existingEnv['BCONNECT_V11_USERNAME']
    $v11ProbePass = $existingEnv['BCONNECT_V11_PASSWORD']
}

if ($v11ProbeUser -and $v11ProbePass) {
    # v1.1 lives BESIDE the v2.0 base, not under it: https://host/bConnect/v1.1
    #
    # The derivation assumes the v2.0 base ends in /bconnect. Test-BaseUrlShape warns
    # when it does not and then offers "Use it anyway?", so a deployment behind a
    # reverse proxy or under a renamed virtual directory reaches here with a base the
    # rule does not fit -- and the 401 that follows was diagnosed as a credential
    # problem on a privileged domain account.
    #
    # It is deliberately the SAME expression the runtime uses (mcp-core's
    # v11-client.ts resolves the v1.1 root from BCONNECT_BASE_URL the same way), and
    # there is deliberately no installer flag to point it somewhere else: an override
    # here would make this probe pass while all thirteen servers still addressed the
    # derived URL. What the installer can do is show the address and say it was
    # derived, so a wrong one is visible before it is misread as a bad credential.
    $v11Root = ($BaseUrl.TrimEnd('/') -replace '(?i)/bconnect$', '') + '/bConnect'
    Write-Info ('v1.1 root: ' + $v11Root + '   (derived from the v2.0 base URL, as the servers do)')
    try {
        # Â§4.1: credentials are ISO-8859-1 encoded before base64, verified live.
        $v11Pair = $v11ProbeUser + ':' + $v11ProbePass
        $v11Auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::GetEncoding('ISO-8859-1').GetBytes($v11Pair))
        # Version is served from the bConnect ROOT, not under /v1.1/ (finding F17).
        $v11Resp = Invoke-WebRequest -Uri ($v11Root + '/Version') `
            -Headers @{ Authorization = $v11Auth; 'Accept-Encoding' = 'gzip, deflate' } `
            -UseBasicParsing -TimeoutSec 25 -Method Get
        # The body is the point, not just the status: it names the API versions this
        # bConnect actually serves, which is the only direct evidence that the
        # derived root is the right one.
        $v11Supported = $null
        try {
            $v11Body = $v11Resp.Content | ConvertFrom-Json
            if ($v11Body.SupportedVersions) { $v11Supported = (@($v11Body.SupportedVersions) -join ', ') }
        } catch { }
        Write-Ok ('v1.1 GET /bConnect/Version -> HTTP ' + [int]$v11Resp.StatusCode + ' as ' + $v11ProbeUser +
                  $(if ($v11Supported) { '   supported: ' + $v11Supported } else { '' }))
        if ($v11Supported -and $v11Supported -notmatch '1\.1') {
            Write-Warn 'this bConnect does not list 1.1 among its supported versions'
            Write-Info 'The v1.1 tools will not work here even though the credential was accepted.'
        }
    } catch {
        $v11Status = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $v11Status = [int]$_.Exception.Response.StatusCode
        }
        Write-Warn ('v1.1 GET /bConnect/Version -> ' +
                    $(if ($v11Status) { "HTTP $v11Status" } else { $_.Exception.Message }))
        if ($v11Status -eq 401) {
            Write-Info 'Three causes produce a v1.1 401, and all are worth checking:'
            Write-Info ("  1. '$v11ProbeUser' is not a member of a bConnect security group on the bMS.")
            Write-Info '  2. The username is not in UPN form. v1.1 returns 401 for a bare account'
            Write-Info '     name, which is indistinguishable from a wrong password.'
            Write-Info ("  3. The URL. '$v11Root' was DERIVED by stripping /bconnect from your v2.0")
            Write-Info '     base URL. If your deployment does not follow that convention the address'
            Write-Info '     is simply wrong, and bConnect answers 401 for a route it does not'
            Write-Info '     recognise. Check this FIRST: it costs nothing, and the other two send you'
            Write-Info '     to change group membership on a privileged domain account. The servers'
            Write-Info '     derive the same address, so v1.1 cannot work from a base URL that does'
            Write-Info '     not end in /bconnect -- leave the v1.1 tools off in that case.'
        } else {
            Write-Info 'v1.1 is LAN-only and is not served through the bConnect gateway. If this'
            Write-Info 'machine reaches the bMS only via the gateway or a WAN link, v1.1 will not'
            Write-Info 'work from here and the v1.1 tools should be left off.'
        }
        Write-Info 'v2.0 is unaffected. Installation continues; v1.1 tools may not work.'
    } finally {
        $v11Pair = $null
        $v11ProbePass = $null
    }
}

# -----------------------------------------------------------------------------
# A dry run with the runtime deferred stops here, and says so.
#
# Everything above this line -- the address rules, whether bConnect answers, what
# it answered, and the Windows view of the certificate -- needs no Node, and is
# what the wizard's Test button was pressed to find out. Everything BELOW it does:
# the build, the token measurement, the host-configuration emitters and the
# verifier are all Node programs. Previewing them without the runtime would mean
# guessing at their output, and a dry run that guesses is worse than one that
# stops, because its whole purpose is to be believed.
#
# So it stops, having answered the question, rather than refusing to start as it
# did before. failed is false: this run did what it could do and said what it
# could not. Whether bConnect answered is on the console above either way.
# -----------------------------------------------------------------------------
if ($DryRun -and $NodeDeferred) {
    Write-Host ''
    Write-Step 'Dry run stopped early'
    Write-Info 'Checked here, and needing no Node.js:'
    Write-Info '  * the base URL, against the rules bConnect requires'
    Write-Info '  * whether bConnect answers at that address, and what it answered'
    Write-Info '  * the certificate, as WINDOWS sees it'
    Write-Info 'Not checked, because each is a Node program and Node is not installed yet:'
    Write-Info '  * the certificate as the SERVERS will see it (Node has its own trust list)'
    Write-Info '  * the build, the tool-cost measurement, and the client configurations'
    Write-Host ''
    Write-Info 'Nothing was written. Setup installs Node and then runs all of it.'
    Write-Ok 'dry run complete, as far as it could go'
    Send-Progress 'done' @{ failed = $false; dryRun = $true; nodeDeferred = $true
                            reachable = [bool]$reachOk; httpStatus = $reachHttpStatus
                            warnings = @($script:Warnings) }
    exit 0
}

# -----------------------------------------------------------------------------
# Step 5 -- credentials file, with the DIRECTORY hardened first
# -----------------------------------------------------------------------------
Write-Step 'Credentials file'

# Where the credentials will end up, given the choice made in Step 3.
$TargetEnvPath = $(if ($Protect) { Get-ProtectedEnvPath -PlainEnvPath $EnvFile } else { $EnvFile })
# A reuse that also changes the storage form is not a no-op: the same values have to
# be re-written in the other form and the old file removed. That is the "way back",
# and it is the same code in both directions.
$convert = ($reuse -and $CredStore.Mode -ne 'none' -and
            (($Protect -and $CredStore.Mode -ne 'protected') -or (-not $Protect -and $CredStore.Mode -ne 'plaintext')))

if ($reuse -and -not $convert) {
    Write-Ok "reusing $($CredStore.ActivePath)"
    # A reuse run does not rewrite the file, so a key an older installer wrote stays.
    # Say which ones and what they cost, rather than leaving a silently disabled
    # release check behind an otherwise green run.
    $stale = @($existingEnv.Keys | Where-Object { $_ -in @('BCONNECT_RELEASE', 'BCONNECT_SKIP_CONNECTIVITY_CHECK') })
    if ($stale.Count) {
        Write-Warn ('the credentials file still carries: ' + ($stale -join ', '))
        Write-Info 'Neither is written any more. BCONNECT_RELEASE is not read by anything;'
        Write-Info 'BCONNECT_SKIP_CONNECTIVITY_CHECK turns off the startup probe AND the check'
        Write-Info 'that this bMS is a release the suite supports. Delete both lines by hand, or'
        Write-Info 're-run without -ReuseCredentials and this installer will drop them.'
    }
    # Even when reusing, re-assert the directory ACL: it is cheap, and a file that
    # was edited by hand since the last run may have been recreated by the editor.
} elseif ($convert) {
    Write-Ok ("converting the existing credentials from " + $CredStore.Mode + ' to ' + $(if ($Protect) { 'protected' } else { 'plaintext' }))
}

# SEC-7 -- the gateway's bearer token. It lives in THIS file, not a second one:
# the credentials file is already ACL-hardened, already optionally DPAPI-protected,
# and already read into the gateway's environment by lib\Start-BConnectGateway.ps1.
# Adding a parallel token file would mean a second thing to protect and a second
# thing to forget. The stdio servers ignore the variable.
$script:GatewayToken        = $null
$script:GatewayTokenIsNew   = $false
$script:GatewayTokenRotated = $false

# The non-credential settings this run was actually given. Built here, applied
# after the credentials file exists, and empty on every run that did not mention
# them -- so a re-run cannot reset an audit level nobody asked about.
$SettingChanges = [ordered]@{}
if ($AuditLevel) { $SettingChanges['BCONNECT_AUDIT_LEVEL'] = $AuditLevel }
if ($RateLimit)  { $SettingChanges['BCONNECT_RATE_LIMIT_ENABLED'] = $(if ($RateLimit -eq 'on') { 'true' } else { 'false' }) }
if ($RateLimitMaxRequests -gt 0) { $SettingChanges['BCONNECT_RATE_LIMIT_MAX_REQUESTS'] = [string]$RateLimitMaxRequests }
if ($RateLimitWindowMs -gt 0)    { $SettingChanges['BCONNECT_RATE_LIMIT_WINDOW_MS']    = [string]$RateLimitWindowMs }
# A CA certificate accepted in Step 4 has to survive a run that keeps its credentials.
# The reuse path does not rewrite the file at all, so without this the operator would
# supply the PEM, watch the re-probe go green, and find nothing had been recorded --
# the servers would then fail exactly as they did before. Only on a reuse run: every
# other path writes BCONNECT_CA_CERT_PATH with the rest of the credentials.
if ($reuse -and $CaCertPath -and $CaCertPath -ne $existingEnv['BCONNECT_CA_CERT_PATH']) {
    $SettingChanges['BCONNECT_CA_CERT_PATH'] = $CaCertPath
}

if ($DryRun) {
    Write-Info "would create/harden $SecretsDir (inheritance off; SYSTEM, Administrators, $env:USERNAME only)"
    Write-Info ("would write $TargetEnvPath with " + $(if ($convert) { 'the existing values, re-encoded' } elseif ($reuse) { 'no changes' } else { 'the values collected above' }))
    if ($Gateway) {
        Write-Info ('would ' + $(if ($RotateGatewayToken) { 'ROTATE' } else { 'ensure' }) +
                    ' MCP_GATEWAY_AUTH_TOKEN in that file (43 random base64url chars) and print it once')
    }
    if ($SettingChanges.Count) {
        Write-Info ('would set ' + (@($SettingChanges.Keys | ForEach-Object { $_ + '=' + $SettingChanges[$_] }) -join ', ') +
                    ' in that file, leaving every other line byte-identical')
    }
    if ($Protect) { Write-Info "would remove the plaintext $EnvFile" }
    elseif ($CredStore.HasProtected) { Write-Info ("would remove " + $CredStore.ProtectedPath) }
} else {
    if (-not (Test-Path $SecretsDir)) {
        New-Item -ItemType Directory -Path $SecretsDir -Force | Out-Null
        Write-Ok "created $SecretsDir"
    }
    # Harden the DIRECTORY before anything is written into it, so the credentials
    # file inherits the restriction rather than having one applied afterwards.
    Set-HardenedDirectoryAcl -Path $SecretsDir
    Write-Ok 'directory ACL hardened (inheritance off; Users removed; SYSTEM, Administrators, you)'
    $offenders = Get-BroadAccessAce -Path $SecretsDir
    if ($offenders.Count) {
        Abort 'The secrets directory is still readable by a broad group after hardening.' ($offenders)
    }

    if (-not $reuse -or $convert) {
        $plainKey  = $null
        $plainPass = $null
        $plainV11  = $null
        $text      = $null
        try {
            if ($convert) {
                # Re-encode what is already there. Read it through the store so the
                # source form does not matter, and never let it reach disk in the
                # form we are converting away from.
                $text = Read-BConnectEnvText -EnvFile $EnvFile
            } else {
                if ($ApiKeySecure)    { $plainKey  = ConvertFrom-SecureStringPlain $ApiKeySecure }
                if ($BasicPassSecure) { $plainPass = ConvertFrom-SecureStringPlain $BasicPassSecure }
                if ($V11PassSecure)   { $plainV11  = ConvertFrom-SecureStringPlain $V11PassSecure }

                if ($existingEnvText) {
                    # THE RECONFIGURE RULE, in the one place it matters most.
                    #
                    # Rebuilding the file from the values collected on this run is what
                    # made a re-run destructive: measured, a run that changed the base
                    # URL and the key took a 14-key file to 9 -- dropping the CA cert
                    # path, both v1.1 values, the gateway bearer token and a hand-added
                    # BCONNECT_TIMEOUT_MS -- and said nothing. Only the keys this run
                    # was actually given may move.
                    $changes = [ordered]@{}
                    $drops   = @()
                    $changes['BCONNECT_BASE_URL'] = $BaseUrl
                    if ($plainKey) {
                        $changes['BCONNECT_API_KEY'] = $plainKey
                        # The two auth kinds are exclusive: leaving the other one behind
                        # would mean the file says one thing and the server does another.
                        $drops += @('BCONNECT_USERNAME', 'BCONNECT_PASSWORD')
                    } elseif ($plainPass) {
                        $changes['BCONNECT_USERNAME'] = $BasicUser
                        $changes['BCONNECT_PASSWORD'] = $plainPass
                        $drops += 'BCONNECT_API_KEY'
                    }
                    if ($V11User -and $plainV11) {
                        $changes['BCONNECT_V11_USERNAME'] = $V11User
                        $changes['BCONNECT_V11_PASSWORD'] = $plainV11
                    }
                    if ($CaCertPath) { $changes['BCONNECT_CA_CERT_PATH'] = $CaCertPath }
                    # Two keys earlier versions wrote that must not survive a re-run.
                    # BCONNECT_RELEASE no longer exists at all. The skip flag was a
                    # workaround for a probe path that is corrected upstream, and it
                    # also suppresses the check that this bMS is a release the suite
                    # supports -- keeping it would leave that check off forever on
                    # every installation that has ever been upgraded.
                    $drops += @($existingEnv.Keys | Where-Object {
                        $_ -in @('BCONNECT_RELEASE', 'BCONNECT_SKIP_CONNECTIVITY_CHECK') })

                    $text = Merge-EnvText -Text $existingEnvText -Changes $changes -Remove $drops
                    $keptKeys = @($existingEnv.Keys | Where-Object { -not $changes.Contains($_) -and $drops -notcontains $_ })
                    Write-Ok ('changed ' + $changes.Count + ' key(s) in the existing credentials file')
                    Write-Info ('changed:  ' + (@($changes.Keys) -join ', '))
                    if ($drops.Count)     { Write-Info ('removed:  ' + ($drops -join ', ') + '   (the other auth kind, and keys this suite no longer reads)') }
                    if ($keptKeys.Count)  { Write-Info ('kept:     ' + ($keptKeys -join ', ')) }
                } else {
                    $text = New-EnvFileContent -BaseUrl $BaseUrl -ApiKey $plainKey -BasicUser $BasicUser `
                                               -BasicPass $plainPass -V11User $V11User -V11Pass $plainV11 `
                                               -CaCertPath $CaCertPath
                }

                # Optional per-server keys, applied to whichever form was just
                # built. Merge-EnvText owns both paths so a fresh file and a
                # re-run agree; the reconfigure rule holds, because a scope the
                # operator did not fill in this time is simply not in $changes
                # and is therefore left exactly as it was.
                if ($PerServerApiKeysSecure -and $PerServerApiKeysSecure.Count) {
                    $scoped = [ordered]@{}
                    foreach ($e in $PerServerApiKeysSecure.GetEnumerator()) {
                        $scoped["BCONNECT_API_KEY__$($e.Key)"] = ConvertFrom-SecureStringPlain $e.Value
                    }
                    $text = Merge-EnvText -Text $text -Changes $scoped -Remove @()
                    Write-Ok ("per-server key(s) written for: " + (@($PerServerApiKeysSecure.Keys | Sort-Object) -join ', '))
                    Write-Info 'Every other server uses the shared BCONNECT_API_KEY.'
                    $scoped = $null
                }
            }
            if ($Gateway) {
                # -Rotate on a file that has just been created is a no-op by
                # construction (there is no previous token to keep), so the same
                # call covers the fresh and the re-encoded case.
                $gwt = Set-GatewayAuthTokenInEnvText -Text $text -Rotate:$RotateGatewayToken
                $text = $gwt.Text
                $script:GatewayToken        = $gwt.Token
                $script:GatewayTokenIsNew   = [bool]$gwt.Changed
                $script:GatewayTokenRotated = [bool]($gwt.Changed -and $gwt.Previous)
            }
            # One call owns "write this form, remove the other". When -Protect is set
            # the plaintext never touches disk: it is encrypted in memory and only the
            # ciphertext is written.
            $written = Write-BConnectEnvStore -EnvFile $EnvFile -Content $text -Protected:$Protect
            Write-Ok ("wrote $written (UTF-8, no BOM, via a write-temp-then-replace)")
            if ($Protect) {
                Write-Ok 'DPAPI-protected at CurrentUser scope with application entropy'
                Write-Info 'Readable only by this Windows account on this machine. A copy of this file'
                Write-Info 'is useless elsewhere. It is NOT protection against code running as you.'
            }
        } finally {
            $plainKey = $null; $plainPass = $null; $plainV11 = $null; $text = $null
            [GC]::Collect()
        }
    }

    # SEC-7, the upgrade path. A -ReuseCredentials run does not rewrite the file at
    # all, and an installation that predates this feature has no token in it. That
    # must not mean "your gateway stays unauthenticated because you reused" -- so
    # the token is added in place here, through the store, without the operator
    # re-typing a bMS password and without the credentials ever reaching disk in a
    # form the -Protect choice did not ask for.
    if ($Gateway -and -not $script:GatewayToken) {
        $gwText = $null
        try {
            $gwText = Read-BConnectEnvText -EnvFile $EnvFile
            $gwt    = Set-GatewayAuthTokenInEnvText -Text $gwText -Rotate:$RotateGatewayToken
            $script:GatewayToken        = $gwt.Token
            $script:GatewayTokenIsNew   = [bool]$gwt.Changed
            $script:GatewayTokenRotated = [bool]($gwt.Changed -and $gwt.Previous)
            if ($gwt.Changed) {
                $written = Write-BConnectEnvStore -EnvFile $EnvFile -Content $gwt.Text -Protected:$Protect
                Write-Ok ("gateway bearer token " + $(if ($script:GatewayTokenRotated) { 'ROTATED' } else { 'generated' }) +
                          " and written to $written")
            } else {
                Write-Ok 'gateway bearer token already present -- left untouched'
            }
        } finally {
            $gwText = $null; $gwt = $null
            [GC]::Collect()
        }
    }

    # The audit level and the rate limiter, when this run was given either. Same
    # shape as the gateway-token block above and for the same reason: a run that
    # changes one of these does not supply a credential, so it took the reuse path
    # and did not rewrite the file at all. Read it back through the store, move the
    # named keys only, and write it in whichever form the -Protect choice asked for.
    # Nothing here reaches a log: the values are settings, but the text they are
    # merged into is the credentials file.
    if ($SettingChanges.Count) {
        $setText = $null
        try {
            $setText = Read-BConnectEnvText -EnvFile $EnvFile
            $merged  = Merge-EnvText -Text $setText -Changes $SettingChanges
            if ($merged -ne $setText) {
                $written = Write-BConnectEnvStore -EnvFile $EnvFile -Content $merged -Protected:$Protect
                Write-Ok ('set ' + (@($SettingChanges.Keys) -join ', ') + " in $written")
                Write-Info ('now: ' + (@($SettingChanges.Keys | ForEach-Object { $_ + '=' + $SettingChanges[$_] }) -join ', '))
                Write-Info 'A server already running keeps what it started with. It picks this up when'
                Write-Info 'its process is next started -- which the MCP client does when IT restarts.'
            } else {
                Write-Ok ((@($SettingChanges.Keys) -join ', ') + ' already had those values -- file untouched')
            }
        } finally {
            $setText = $null; $merged = $null
            [GC]::Collect()
        }
    }

    # The file was written the same way an editor saves -- temp file, then replace.
    # That is precisely the operation that strips a file-level ACL, so checking the
    # result proves the directory-level protection actually held. Checked on whichever
    # file is now in force: a protected blob still deserves the ACL, because the ACL is
    # what stops another local account taking a copy in the first place.
    if (-not (Test-Path -LiteralPath $TargetEnvPath)) {
        Abort "Expected $TargetEnvPath to exist after Step 5, and it does not."
    }
    $fileOffenders = Get-BroadAccessAce -Path $TargetEnvPath
    if ($fileOffenders.Count) {
        Abort 'The credentials file is readable by a broad group.' (@('Inherited ACEs found:') + $fileOffenders)
    }
    Write-Ok 'credentials file ACL verified after an atomic replace -- no Users/Everyone ACE'
    Write-Info ((icacls $TargetEnvPath | Select-Object -First 4) -join "`n         ")

    if ($Protect -and (Test-Path -LiteralPath $EnvFile)) {
        Write-Warn "the plaintext $EnvFile is still present after protecting the credentials"
        Write-Info 'Protection is pointless while a plaintext copy sits next to it. Delete it.'
    }

    # A guard against the trap where the shared env file itself carries the write flag.
    $reread = Read-BConnectEnvMap -EnvFile $EnvFile
    if ($reread['ALLOW_WRITE_OPERATIONS'] -eq 'true') {
        Write-Warn 'ALLOW_WRITE_OPERATIONS=true is set in the SHARED credentials file.'
        Write-Info 'That unlocks writes in every configured server at once, regardless of'
        Write-Info 'what you choose in the next step. Remove it from the env file and put'
        Write-Info 'the write gate in the per-server env block instead.'
    }
}

} else {

# -----------------------------------------------------------------------------
# Steps 3 to 5 -- not on the machine stage
# -----------------------------------------------------------------------------
Write-Step 'Credentials'
Write-Info 'skipped -- the machine stage collects no credential.'
Write-Info 'A credential entered here would be stored for the account this job runs as, and'
Write-Info 'DPAPI protection is CurrentUser scope, so no administrator could decrypt it.'
Write-Info 'The user stage collects it:  Install-BConnectMcp.ps1 -Stage User'
$BaseUrl       = [string]$existingEnv['BCONNECT_BASE_URL']
$CaCertPath    = [string]$existingEnv['BCONNECT_CA_CERT_PATH']
$BmsVersionRaw = $null
$reuse         = $true

}

# -----------------------------------------------------------------------------
# Step 6 -- build
# -----------------------------------------------------------------------------
Write-Step 'Build'

if (-not $StageDoesMachine) {
    Write-Info 'skipped -- the suite is built by the machine stage, which runs once per machine.'
    Write-Info 'Any server without a build\index.js is named in Step 9.'
} elseif ($SkipBuild) {
    Write-Info 'skipped (-SkipBuild)'
} elseif ($DryRun) {
    Write-Info 'would run: npm ci (if needed), then npm run build for mcp-core and each server'
} else {
    if (-not (Test-Path (Join-Path $SuiteRoot 'node_modules'))) {
        Write-Info 'installing dependencies -- npm ci (this takes a few minutes)'
        $r = Invoke-Native $NpmExe @('ci') $SuiteRoot
        if ($r.Code -ne 0) {
            Write-Host $r.Output
            Abort 'npm ci failed.' @('The output above is npm''s. Fix it and re-run; nothing else has changed yet.')
        }
        Write-Ok 'dependencies installed'
    } else {
        Write-Ok 'node_modules present -- skipping npm ci'
    }

    # Build package by package from PowerShell rather than `npm run build` at the
    # root. The root script is a bash `for` loop, and npm executes package scripts
    # through cmd.exe regardless of the shell you launched it from, so that script
    # dies with "d was unexpected at this time" even from Git Bash (finding F2).
    Write-Info 'building @bconnect/mcp-core (the servers import it; it must be first)'
    $r = Invoke-Native $NpmExe @('run', 'build', '-w', '@bconnect/mcp-core') $SuiteRoot
    if ($r.Code -ne 0) {
        Write-Host ''
        Write-Host $r.Output
        Abort 'The shared core package @bconnect/mcp-core did not compile.' @(
            'Nothing else can build until this does. The compiler output is above.',
            'A single server directory cannot be built on its own -- the core comes first.'
        )
    }
    Write-Ok '@bconnect/mcp-core built'

    # -BuildSelectedOnly narrows this to what -Servers named. A reconfigure that adds
    # one server has no reason to recompile the other thirteen, and the operator
    # waiting on it has no way to know that is what is happening.
    $buildDirs = @($AllServers | Where-Object { $presentDirs -contains $_.dir })
    if ($BuildSelectedOnly -and $Servers) {
        $wanted = @($Servers -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        $buildDirs = @($buildDirs | Where-Object { $wanted -contains $_.name })
        Write-Info ('building the selected server(s) only: ' + (($buildDirs | Select-Object -ExpandProperty name) -join ', '))
    }
    $buildFailures = @()
    foreach ($dir in ($buildDirs | Select-Object -ExpandProperty dir)) {
        $r = Invoke-Native $NpmExe @('run', 'build', '-w', $dir) $SuiteRoot
        if ($r.Code -ne 0) {
            $buildFailures += $dir
            Write-Fail "$dir did not compile"
            $tail = ($r.Output -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 15) -join "`n           "
            Write-Host ('           ' + $tail) -ForegroundColor DarkYellow
        } elseif (-not (Test-Path (Join-Path $SuiteRoot (Join-Path $dir 'build\index.js')))) {
            $buildFailures += $dir
            Write-Fail "$dir reported success but produced no build\index.js"
        } else {
            Write-Ok "$dir"
        }
    }
    if ($buildFailures.Count) {
        Abort ("$($buildFailures.Count) package(s) failed to build: " + ($buildFailures -join ', ')) @(
            'The compiler output for each failure is above. A server that does not build',
            'cannot be enabled -- fix the package or deselect it and re-run.'
        )
    }
}

# -----------------------------------------------------------------------------
# Step 7 -- choose servers
# -----------------------------------------------------------------------------
Write-Step 'Which servers to enable'

$available = @($AllServers | Where-Object { $presentDirs -contains $_.dir })
$measured  = @{}
Write-Info 'measuring the tool surface of each server (no bMS needed)...'
$mOut = Invoke-Native $NodeExe @("`"$(Join-Path $LibDir 'measure-tools.mjs')`"", '--root', "`"$SuiteRoot`"") $SuiteRoot
foreach ($ln in ($mOut.Output -split "`r?`n")) {
    $parts = $ln -split "`t"
    if ($parts.Count -eq 3) { $measured[$parts[0]] = @{ Tools = $parts[1]; Bytes = [int]$parts[2] } }
}
if ($measured.Count -eq 0) { Write-Warn 'could not measure tool surfaces; context costs will show as unknown' }

function Show-ServerTable {
    param($List, $SelectedNames)
    Write-Host ''
    Write-Host ('   #  {0} {1} {2} {3}' -f 'on '.PadRight(4), 'server'.PadRight(30), 'tools'.PadLeft(6), '~tokens'.PadLeft(9)) -ForegroundColor DarkGray
    Write-Host ('   ' + ('-' * 68)) -ForegroundColor DarkGray
    $i = 0
    foreach ($s in $List) {
        $i++
        $m = $measured[$s.dir]
        $tools = '?'; $tok = '?'
        if ($m) { $tools = $m.Tools; if ($m.Tools -ne 'ERROR') { $tok = '~' + ([math]::Round($m.Bytes / 4)).ToString('N0') } }
        $on = '   '
        $col = 'DarkGray'
        if ($SelectedNames -contains $s.name) { $on = '[x]'; $col = 'White' }
        Write-Host ('  {0,2}  {1}  {2} {3} {4}' -f $i, $on, $s.name.PadRight(30), $tools.PadLeft(5), $tok.PadLeft(9)) -ForegroundColor $col
        Write-Host ('        ' + $s.summary) -ForegroundColor DarkGray
    }
}

function Get-SelectionCost {
    param($SelectedNames)
    $b = 0; $t = 0; $unknown = $false
    foreach ($n in $SelectedNames) {
        $s = $available | Where-Object { $_.name -eq $n }
        $m = $measured[$s.dir]
        if ($m -and $m.Tools -ne 'ERROR') { $b += $m.Bytes; $t += [int]$m.Tools } else { $unknown = $true }
    }
    return @{ Bytes = $b; Tools = $t; Unknown = $unknown }
}

# The selection this installation already has, reconciled across every host and
# then across the record. -Servers still wins; this is what "not asked about" means.
$currentSelection = @($ManagedDeployed | Where-Object { ($available | Select-Object -ExpandProperty name) -contains $_ })
if (-not $currentSelection.Count -and $Record) {
    $currentSelection = @(Get-RecordServerNames $Record | Where-Object { ($available | Select-Object -ExpandProperty name) -contains $_ })
}

$selected = @()
if ($Servers) {
    $selected = @($Servers -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $bad = @($selected | Where-Object { ($available | Select-Object -ExpandProperty name) -notcontains $_ })
    if ($bad.Count) { Abort ('unknown or unavailable server(s): ' + ($bad -join ', ')) }
} elseif ($NonInteractive) {
    # -NonInteractive used to require -Servers unconditionally, which meant every
    # scripted reconfigure had to restate the full server list -- and restating it
    # from memory is how a server quietly disappears. The current selection is a
    # better answer than a hard error whenever there IS one.
    if ($currentSelection.Count) {
        $selected = $currentSelection
        Write-Ok ('keeping the current selection: ' + ($selected -join ', ') + '   (no -Servers given)')
    } else {
        Require-Answer $false 'Servers' 'A comma-separated list of the servers to enable, e.g. -Servers bconnect-endpoints,bconnect-jobs'
    }
} else {
    $default = @($available | Where-Object { $_.default } | Select-Object -ExpandProperty name)
    if ($currentSelection.Count) { $default = $currentSelection }
    Show-ServerTable $available $default

    $allCost = Get-SelectionCost (@($available | Select-Object -ExpandProperty name))
    $defCost = Get-SelectionCost $default
    Write-Host ''
    Write-Info 'Every enabled server''s tool schemas are sent to the model on every request,'
    Write-Info 'before you have typed anything. This is not free -- enabling all of them'
    Write-Info ('costs about ' + ([math]::Round($allCost.Bytes / 4)).ToString('N0') + ' tokens of context per session. Enable what you will use.')
    Write-Host ''
    Write-Info ('  [D] recommended   ' + $default.Count + ' servers, ~' + ([math]::Round($defCost.Bytes / 4)).ToString('N0') + ' tokens')
    Write-Info '  [M] minimal       bconnect-endpoints only'
    Write-Info ('  [A] everything    ' + $available.Count + ' servers, ~' + ([math]::Round($allCost.Bytes / 4)).ToString('N0') + ' tokens')
    Write-Info '  [C] custom        type the numbers, e.g. 1,3,5'

    while ($true) {
        $sel = (Read-Host '  choose D / M / A / C [D]').Trim()
        if ([string]::IsNullOrWhiteSpace($sel)) { $sel = 'D' }
        switch ($sel.ToUpper()) {
            'D' { $selected = $default; break }
            'M' { $selected = @('bconnect-endpoints'); break }
            'A' { $selected = @($available | Select-Object -ExpandProperty name); break }
            'C' {
                $nums = (Read-Host '  numbers, comma separated').Trim()
                $picked = @()
                foreach ($n in ($nums -split ',')) {
                    $n = $n.Trim()
                    if ($n -match '^\d+$') {
                        $idx = [int]$n
                        if ($idx -ge 1 -and $idx -le $available.Count) { $picked += $available[$idx - 1].name }
                    }
                }
                $selected = @($picked | Select-Object -Unique)
                break
            }
            default { }
        }
        if ($selected.Count) { break }
        Write-Host '         nothing selected -- pick at least one server' -ForegroundColor Yellow
    }
}

$cost = Get-SelectionCost $selected
Write-Host ''
Write-Ok ("$($selected.Count) server(s) selected: " + ($selected -join ', '))
Write-Ok ("$($cost.Tools) tools, ~" + ([math]::Round($cost.Bytes / 4)).ToString('N0') + ' tokens of tool schema per session')
if ($cost.Bytes / 4 -gt 25000) {
    Write-Warn 'that is a large fixed context cost; consider trimming the selection'
}

# Only ever entries this installer owns: a bconnect-* entry that is not in the
# catalogue belongs to someone else and is never a removal candidate.
$toRemove = @($ManagedDeployed | Where-Object { $selected -notcontains $_ })
if ($toRemove.Count) {
    Write-Host ''
    Write-Info ('these bconnect-* servers are configured but not selected: ' + ($toRemove -join ', '))
    if ($Servers) {
        # -Servers signals a scripted run, so do not stop for a question. Leaving them
        # in place is the conservative default; -RemoveUnselected opts into removal.
        if (-not $RemoveUnselected) {
            Write-Info 'leaving them configured (-Servers given; pass -RemoveUnselected to drop them)'
            $toRemove = @()
        }
    } elseif (-not (Ask-YesNo 'Remove them from the Claude Desktop configuration?' $true $RemoveUnselected)) {
        $toRemove = @()
    }
}

# -----------------------------------------------------------------------------
# Step 8 -- the write gate
# -----------------------------------------------------------------------------
Write-Step 'Write gate'

$writeEnv = @{}    # server name -> hashtable of env vars

# --- what the gate is RIGHT NOW ----------------------------------------------
# Read before anything is decided. Step 8 used to start from an empty hashtable on
# every run, so a re-run that said nothing about writes printed "read-only" and
# removed an existing gate without ever using the word "removed". The direction was
# safe; the silence was not, because it taught the operator that a re-run is free --
# and the same silence in the credentials file was not safe at all.
function Get-CurrentGate {
    param([string] $Name)
    if ($DeployedEnv.Contains($Name)) {
        $blk = $DeployedEnv[$Name]
        if ($blk.Contains('ALLOW_WRITE_OPERATIONS') -and $blk['ALLOW_WRITE_OPERATIONS'] -eq 'true') {
            $tools = @()
            if ($blk.Contains('ALLOWED_WRITE_TOOLS') -and $blk['ALLOWED_WRITE_TOOLS']) {
                $tools = @($blk['ALLOWED_WRITE_TOOLS'] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
            }
            return @{ Allow = $true; Tools = $tools; Source = 'the host configuration' }
        }
        return $null      # the entry is deployed and has no gate: that is the truth
    }
    # No deployed entry to read -- a host file that is missing or unreadable. The
    # record is intent, and intent is better than assuming read-only.
    $rg = Get-RecordWriteGate $Record $Name
    if ($rg -and $rg.Allow) { return @{ Allow = $true; Tools = @($rg.Tools); Source = 'the installation record' } }
    return $null
}
function Show-Gate {
    param([string] $Name, $Gate, $Server)
    if (-not $Gate) { Write-Info ('  ' + $Name.PadRight(28) + 'currently: read-only'); return }
    $n = @($Gate.Tools).Count
    if ($n -eq 0) {
        Write-Info ('  ' + $Name.PadRight(28) + "currently: writes ENABLED, all $($Server.writeTools.Count) write tools")
    } else {
        Write-Info ('  ' + $Name.PadRight(28) + "currently: writes ENABLED, $n of $($Server.writeTools.Count) tools")
        Write-Info ('  ' + ''.PadRight(28) + (@($Gate.Tools) -join ', '))
    }
}
function Set-GateEnv {
    param([string] $Name, [string[]] $Tools, [int] $Total, [bool] $Allowlist)
    if (-not $writeEnv.ContainsKey($Name)) { $writeEnv[$Name] = [ordered]@{} }
    $writeEnv[$Name]['ALLOW_WRITE_OPERATIONS'] = 'true'
    if ($Tools.Count -and $Allowlist) { $writeEnv[$Name]['ALLOWED_WRITE_TOOLS'] = ($Tools -join ',') }
}

# The guided per-server gate dialogue, in one function so that "enable writes on a
# server that has none" and "edit the allowlist of a server that already has one"
# cannot drift apart. Every path still ends in a case-sensitive typed ENABLE WRITES.
function Invoke-GatePrompt {
    param($s)
    if (-not $s.allowlist) {
        # Honest about the shape of the fix: ALLOWED_WRITE_TOOLS is a local patch
        # and it exists in bconnect-jobs-mcp only. Everywhere else the vendor's
        # gate is genuinely all-or-nothing.
        Write-Warn ("$($s.name) has no per-tool allowlist. ALLOW_WRITE_OPERATIONS=true")
        Write-Info ("unlocks all $($s.writeTools.Count) of its write tools at once, including:")
        Write-Info ('  ' + (($s.writeTools | Where-Object { $_ -like 'delete_*' } | Select-Object -First 4) -join ', '))
        Write-Info 'There is no way to permit some and not others in this server.'
        $typed = Read-Host ("  type ENABLE WRITES to unlock all $($s.writeTools.Count) write tools in $($s.name)")
        if ($typed -cne 'ENABLE WRITES') { Write-Ok "$($s.name): left read-only"; return }
        Set-GateEnv $s.name @() $s.writeTools.Count $false
        Write-Warn "$($s.name): ALL $($s.writeTools.Count) write tools enabled"
        return
    }

    Write-Info ("$($s.name) supports a per-tool allowlist (ALLOWED_WRITE_TOOLS).")
    Write-Info 'Use it. The blunt flag alone unlocks every write tool in the server;'
    Write-Info 'the allowlist narrows that to the ones this session actually needs.'
    Write-Host ''
    $cur = Get-CurrentGate $s.name
    $i = 0
    foreach ($t in $s.writeTools) {
        $i++
        # The mark is the CURRENT allowlist where there is one, and the catalogue's
        # recommendation only on a server that has no gate yet. An "edit" that shows
        # the recommendation instead of what is deployed is not an edit.
        $mark = ' '
        if ($cur -and @($cur.Tools).Count) { if (@($cur.Tools) -contains $t) { $mark = 'x' } }
        elseif ($s.allowlistDefault -contains $t) { $mark = 'x' }
        Write-Host ('   {0,2}  [{1}] {2}' -f $i, $mark, $t)
    }
    Write-Host ''
    if ($cur -and @($cur.Tools).Count) {
        Write-Info ('  [R] keep the ' + @($cur.Tools).Count + ' currently permitted, marked above')
    } else {
        Write-Info ('  [R] recommended -- the ' + $s.allowlistDefault.Count + ' marked above')
    }
    Write-Info '  [C] custom      -- type the numbers'
    Write-Info '  [N] no allowlist -- all write tools (not recommended)'
    $wsel = (Read-Host '  choose R / C / N [R]').Trim()
    if ([string]::IsNullOrWhiteSpace($wsel)) { $wsel = 'R' }
    $allow = @()
    if ($wsel.ToUpper() -eq 'R') {
        if ($cur -and @($cur.Tools).Count) { $allow = @($cur.Tools) } else { $allow = @($s.allowlistDefault) }
    } elseif ($wsel.ToUpper() -eq 'C') {
        $nums = (Read-Host '  numbers, comma separated').Trim()
        foreach ($n in ($nums -split ',')) {
            $n = $n.Trim()
            if ($n -match '^\d+$') {
                $idx = [int]$n
                if ($idx -ge 1 -and $idx -le $s.writeTools.Count) { $allow += $s.writeTools[$idx - 1] }
            }
        }
        $allow = @($allow | Select-Object -Unique)
    } else {
        Write-Warn 'no allowlist -- every write tool in this server will be reachable'
        $typed = Read-Host ("  type ENABLE WRITES to unlock all $($s.writeTools.Count) write tools")
        if ($typed -cne 'ENABLE WRITES') { Write-Ok "$($s.name): left read-only"; return }
        Set-GateEnv $s.name @() $s.writeTools.Count $false
        Write-Warn "$($s.name): ALL $($s.writeTools.Count) write tools enabled, unnarrowed"
        return
    }
    if ($allow.Count -eq 0) { Write-Ok "$($s.name): nothing selected, left read-only"; return }
    Write-Host ''
    Write-Info ('about to permit: ' + ($allow -join ', '))
    $typed = Read-Host ("  type ENABLE WRITES to confirm these $($allow.Count) tool(s)")
    if ($typed -cne 'ENABLE WRITES') { Write-Ok "$($s.name): left read-only"; return }
    Set-GateEnv $s.name $allow $s.writeTools.Count $true
    Write-Ok ("$($s.name): $($allow.Count) of $($s.writeTools.Count) write tools permitted")
}

$gateRemoved = @()
$gateKept    = @()

$writeCapable = @($available | Where-Object { $selected -contains $_.name -and $_.writeTools.Count -gt 0 })
if ($writeCapable.Count -eq 0) {
    Write-Ok 'none of the selected servers has write tools -- read-only by construction'
} elseif ($ReadOnly) {
    foreach ($s in $writeCapable) { if (Get-CurrentGate $s.name) { $gateRemoved += $s.name } }
    if ($gateRemoved.Count) {
        Write-Warn ('WRITE GATE REMOVED for: ' + ($gateRemoved -join ', ') + '   (-ReadOnly)')
    }
    Write-Ok 'read-only (-ReadOnly): ALLOW_WRITE_OPERATIONS will not be set anywhere'
} elseif ($NonInteractive) {
    # -WriteGate expresses as data what the guided run expresses as typed
    # confirmations. The rule for a server ABSENT from the hashtable changed, and
    # this is the change that makes a re-run non-destructive: absent now means KEEP
    # WHAT IS THERE, not "read-only". "Read-only unless you said otherwise" is still
    # true of a first install, because there is nothing to keep. Turning a gate off
    # is now something a caller has to SAY -- an empty list for that server, or
    # -ReadOnly for all of them -- and it is reported as a removal.
    foreach ($s in $writeCapable) {
        $cur = Get-CurrentGate $s.name
        if (-not $WriteGate -or -not $WriteGate.ContainsKey($s.name)) {
            if ($cur) {
                Set-GateEnv $s.name @($cur.Tools) $s.writeTools.Count ([bool]$s.allowlist)
                $gateKept += $s.name
                $what = if (@($cur.Tools).Count) { "$(@($cur.Tools).Count) of $($s.writeTools.Count) tools" }
                        else { "all $($s.writeTools.Count) write tools" }
                Write-Ok ("$($s.name): write gate KEPT as it was -- $what")
                Write-Info ('  read from ' + $cur.Source + '. To remove it: -WriteGate @{ ''' + $s.name + ''' = @() }')
            } else {
                Write-Ok "$($s.name): read-only"
            }
            continue
        }
        $want = @($WriteGate[$s.name] | Where-Object { $_ })
        if ($want.Count -eq 0) {
            if ($cur) {
                $gateRemoved += $s.name
                Write-Warn "$($s.name): WRITE GATE REMOVED -- an empty -WriteGate list asked for it"
            } else {
                Write-Ok "$($s.name): read-only (empty list)"
            }
            continue
        }

        if ($want -contains '*' -or -not $s.allowlist) {
            if ($want -notcontains '*' -and -not $s.allowlist) {
                Write-Warn ("$($s.name) has no ALLOWED_WRITE_TOOLS support; the listed tools cannot be narrowed to.")
                Write-Info ("ALLOW_WRITE_OPERATIONS=true unlocks all $($s.writeTools.Count) of its write tools.")
            }
            Set-GateEnv $s.name @() $s.writeTools.Count $false
            Write-Warn "$($s.name): ALL $($s.writeTools.Count) write tools enabled"
        } else {
            $unknown = @($want | Where-Object { $s.writeTools -notcontains $_ })
            if ($unknown.Count) { Abort ("-WriteGate lists tools that are not write tools of $($s.name): " + ($unknown -join ', ')) }
            Set-GateEnv $s.name $want $s.writeTools.Count $true
            Write-Ok ("$($s.name): $($want.Count) of $($s.writeTools.Count) write tools permitted -- " + ($want -join ', '))
        }
    }
    if ($WriteGate) {
        $bogus = @($WriteGate.Keys | Where-Object { ($writeCapable | Select-Object -ExpandProperty name) -notcontains $_ })
        if ($bogus.Count) { Write-Warn ('-WriteGate names servers that are not selected or have no write tools: ' + ($bogus -join ', ')) }
    }
} else {
    Write-Info 'The default is read-only. Nothing in this suite can change your estate unless'
    Write-Info 'ALLOW_WRITE_OPERATIONS=true is set for a specific server.'
    Write-Host ''
    foreach ($s in $writeCapable) { Show-Gate $s.name (Get-CurrentGate $s.name) $s }
    Write-Host ''

    # Servers that already have a gate are asked about ONE AT A TIME, with the
    # current value as the default and printed as such. That single change -- state
    # as the default, and say what the state is -- is most of the reconfigure
    # requirement. A blanket "enable writes for any server? [y/N]" over an existing
    # install means the safe-looking answer silently removes what is there.
    $withGate = @($writeCapable | Where-Object { Get-CurrentGate $_.name })
    $noGate   = @($writeCapable | Where-Object { -not (Get-CurrentGate $_.name) })

    foreach ($s in $withGate) {
        $cur = Get-CurrentGate $s.name
        Write-Host ''
        Write-Host ('  --- ' + $s.name + ' ---') -ForegroundColor White
        Show-Gate $s.name $cur $s
        $ans = (Read-Host '  [K] keep   [E] edit the allowlist   [D] disable writes   [K]').Trim()
        if ([string]::IsNullOrWhiteSpace($ans)) { $ans = 'K' }
        switch ($ans.ToUpper()) {
            'D' {
                $gateRemoved += $s.name
                Write-Warn "$($s.name): WRITE GATE REMOVED"
            }
            'E' { Invoke-GatePrompt $s }
            default {
                Set-GateEnv $s.name @($cur.Tools) $s.writeTools.Count ([bool]$s.allowlist)
                $gateKept += $s.name
                Write-Ok "$($s.name): write gate kept exactly as it was"
            }
        }
    }

    if ($noGate.Count) {
        Write-Host ''
        $q = 'Enable write operations for any of: ' + (($noGate | Select-Object -ExpandProperty name) -join ', ') + '?'
        if (-not (Ask-YesNo $q $false)) {
            Write-Ok 'those servers stay read-only -- ALLOW_WRITE_OPERATIONS is not set for them'
        } else {
            Write-Host ''
            Write-Host '  Writes act on your production estate. bMS''s own API-key ACL is a second' -ForegroundColor Yellow
            Write-Host '  boundary underneath this one, but do not rely on it to catch a mistake.' -ForegroundColor Yellow
            foreach ($s in $noGate) {
                Write-Host ''
                Write-Host ('  --- ' + $s.name + ' ---') -ForegroundColor White
                if (-not (Ask-YesNo ("Enable writes in $($s.name)?") $false)) {
                    Write-Ok "$($s.name): read-only"
                    continue
                }
                Invoke-GatePrompt $s
            }
        }
    }
}

# -----------------------------------------------------------------------------
# Step 8b -- the bConnect v1.1 gate
# -----------------------------------------------------------------------------
#
# The blocker this step exists to fix: the installer collected v1.1 credentials
# and never wrote BCONNECT_ENABLE_V11 anywhere, so an operator supplied a domain
# account, saw "v1.1 credentials captured", restarted their host, and got zero
# v1.1 tools with no error. `grep -rn BCONNECT_ENABLE_V11 install\` returned
# nothing at all.
#
# It goes in the PER-SERVER env block, not in the shared credentials file, for
# the reason Secrets.psm1 states about ALLOW_WRITE_OPERATIONS: secrets are
# shared, capability gates are scoped to the server they apply to.
#
# Two different relationships to v1.1 exist and they are reported differently,
# because conflating them is what made the original defect invisible:
#   v11Tools    the server ADVERTISES v1.1 tools, gated on BCONNECT_ENABLE_V11.
#   v11Enriched the server USES v1.1 to enrich existing output and never reads
#               the gate -- credentials alone are enough (bconnect-jobs).
Write-Step 'bConnect v1.1'

# Read the credentials file rather than trusting the in-memory variables. On a
# re-run with -ReuseCredentials the operator supplies no v1.1 values, so
# $V11User is empty while the stored file has had them all along -- and gating
# on the variable would silently skip the gate on exactly the path an existing
# installation takes. Read-BConnectEnvMap goes through the store, so this works
# for the DPAPI-protected form as well as the plaintext one.
$storedEnv = @{}
try { $storedEnv = Read-BConnectEnvMap -EnvFile $EnvFile } catch { $storedEnv = @{} }
$haveV11Creds = ([bool]$V11User -and [bool]$V11PassSecure) -or
                ([bool]$storedEnv['BCONNECT_V11_USERNAME'] -and [bool]$storedEnv['BCONNECT_V11_PASSWORD'])
$v11Gated    = @($available | Where-Object { $selected -contains $_.name -and $_.v11Tools -and $_.v11Tools.Count -gt 0 })
$v11Enriched = @($available | Where-Object { $selected -contains $_.name -and $_.v11Enriched })

if (-not $haveV11Creds) {
    if ($v11Gated.Count -gt 0) {
        $n = ($v11Gated | ForEach-Object { $_.v11Tools.Count } | Measure-Object -Sum).Sum
        Write-Ok "no v1.1 credentials -- $n v1.1 tool(s) stay hidden across $($v11Gated.Count) selected server(s)"
        Write-Info 'That is the correct default. Re-run with v1.1 credentials to enable them.'
    } else {
        Write-Ok 'no v1.1 credentials -- nothing selected uses v1.1'
    }
} elseif ($v11Gated.Count -eq 0 -and $v11Enriched.Count -eq 0) {
    # Do not let a domain account be collected for nothing and say nothing.
    $users = ($available | Where-Object { ($_.v11Tools -and $_.v11Tools.Count -gt 0) -or $_.v11Enriched } |
              ForEach-Object { $_.name }) -join ', '
    Write-Warn 'v1.1 credentials were supplied, but no selected server can use them.'
    Write-Info ("Servers that would: $users")
    Write-Info 'The credentials are still stored. Nothing will read them until one is selected.'
} else {
    foreach ($s in $v11Gated) {
        if (-not $writeEnv.ContainsKey($s.name)) { $writeEnv[$s.name] = [ordered]@{} }
        $writeEnv[$s.name]['BCONNECT_ENABLE_V11'] = 'true'
        Write-Ok ("$($s.name): v1.1 enabled -- " + $s.v11Tools.Count + ' tool(s): ' + ($s.v11Tools -join ', '))
    }
    foreach ($s in $v11Enriched) {
        Write-Ok ("$($s.name): v1.1 credentials will enrich its existing tools (no gate needed)")
    }
    Write-Info 'v1.1 is LAN-only. If you deploy behind the gateway or over WAN, these calls'
    Write-Info 'will fail with a connection error that names this as the cause.'
}

# A gate that WAS on and is not being set again is a removal, and removals get said
# out loud. The write gate taught this lesson: the direction was safe, the silence
# was not.
$v11Removed = @()
foreach ($name in $selected) {
    $wasOn = ($DeployedEnv.Contains($name) -and $DeployedEnv[$name].Contains('BCONNECT_ENABLE_V11') -and
              $DeployedEnv[$name]['BCONNECT_ENABLE_V11'] -eq 'true')
    $nowOn = ($writeEnv.ContainsKey($name) -and $writeEnv[$name].Contains('BCONNECT_ENABLE_V11'))
    if ($wasOn -and -not $nowOn) { $v11Removed += $name }
}
if ($v11Removed.Count) {
    Write-Warn ('v1.1 GATE REMOVED for: ' + ($v11Removed -join ', '))
    if (-not $haveV11Creds) {
        Write-Info 'The gate was set but there are no v1.1 credentials in the credentials store,'
        Write-Info 'so those tools would have been advertised and then failed on every call.'
        Write-Info 'Supply v1.1 credentials to turn them back on.'
    }
}

# -----------------------------------------------------------------------------
# Step 9 -- write the host configurations
# -----------------------------------------------------------------------------
# -----------------------------------------------------------------------------
# WHAT WAS WRITTEN IS RE-READ AT THE END OF THE RUN.
#
# Reported from a fresh machine: three consecutive runs wrote claude_desktop_
# config.json, verified it, reported success, and the app's own panel showed "No
# servers added" every time. The write was not torn and the path was not wrong --
# merge-config.mjs takes its backup immediately before writing and re-parses
# immediately after, restoring and exiting non-zero on any mismatch, so a run that
# left a .bak and exited 0 had a correct file at that instant. Something reverted
# it in the seconds or minutes afterwards, almost certainly the client's own
# startup rewriting the file from its in-memory state.
#
# The installer cannot stop a client doing that. What it can stop is REPORTING
# SUCCESS FOR IT. So each host file is hashed the moment it is written, and every
# hash is checked again after verification has run -- which is minutes later on a
# real install, and costs no waiting, because those minutes were being spent
# anyway.
#
# Every host, not just this one. The failure mode belongs to any client that reads
# its configuration at launch and writes it back from its own state; VS Code,
# Cursor and Continue have simply not been observed doing it. A check that only
# covered the client where it was first seen would find it nowhere else.
# -----------------------------------------------------------------------------
$script:HostWrites = @()

function Get-BlockingHostProcesses {
    <#
        Clients that must not be running while their configuration is written,
        and are.

        THE LIST IS DATA, in lib\hosts.json's quitProcesses. Not a branch in this
        script: every future client would otherwise inherit a restriction that was
        measured on one of them. A target with NO quitProcesses entry means NOT
        TESTED, not known-safe -- hosts.json says so in as many words, so that
        silence is never read later as a guarantee.
    #>
    param($Targets)
    $blocking = @()
    foreach ($t in @($Targets)) {
        $names = @()
        if ($t.PSObject.Properties.Name -contains 'quitProcesses') { $names = @($t.quitProcesses) }
        foreach ($n in $names) {
            if (-not $n) { continue }
            $procs = @(Get-Process -Name $n -ErrorAction SilentlyContinue)
            if ($procs.Count) {
                $blocking += [pscustomobject]@{ Host = $t.id; Label = $t.label; Process = $n; Count = $procs.Count }
            }
        }
    }
    return $blocking
}

function Register-HostWrite {
    <# Hash a host file the moment the installer finishes writing it. #>
    param([string] $HostId, [string] $Path)
    if ($DryRun) { return }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    try {
        $script:HostWrites += [pscustomobject]@{
            Host = $HostId
            Path = $Path
            Sha  = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
            At   = Get-Date
        }
    } catch { }
}

function Test-HostWritesIntact {
    <#
        Re-read every host file written by this run and compare it with what was
        written. Returns the list that changed underneath us.
    #>
    $changed = @()
    foreach ($w in $script:HostWrites) {
        if (-not (Test-Path -LiteralPath $w.Path -PathType Leaf)) {
            $changed += [pscustomobject]@{ Host = $w.Host; Path = $w.Path; Why = 'the file is gone'; Age = ((Get-Date) - $w.At) }
            continue
        }
        $now = $null
        try { $now = (Get-FileHash -LiteralPath $w.Path -Algorithm SHA256).Hash } catch { }
        if ($now -and $now -ne $w.Sha) {
            $changed += [pscustomobject]@{ Host = $w.Host; Path = $w.Path; Why = 'the contents changed'; Age = ((Get-Date) - $w.At) }
        }
    }
    return $changed
}

Write-Step 'Host configuration'

# ONE launch shape, built once, handed to every target. New-ServerLaunchEntry
# (lib\Dpapi.psm1) is still the only place that decides between
# "node --env-file=..." and "powershell -File Start-BConnectServer.ps1 ...", so the
# plaintext and protected forms cannot drift -- and now they cannot drift BETWEEN
# HOSTS either. If the command line is right for Claude Desktop, which is verified
# live, it is right for Cursor, which is not.
# Re-validated on EVERY run, including one that skipped the build. The build step
# checks this for what it just built; a reconfigure that did not build checked
# nothing, and would happily write an entry naming a build\index.js that is not
# there. The host then reports only "server disconnected".
$missingBuilds = @()
foreach ($name in $selected) {
    $s = $available | Where-Object { $_.name -eq $name }
    if (-not (Test-Path -LiteralPath (Join-Path $SuiteRoot (Join-Path $s.dir 'build\index.js')))) {
        $missingBuilds += $name
    }
}
if ($missingBuilds.Count) {
    Write-Warn ('no build\index.js for: ' + ($missingBuilds -join ', '))
    Write-Info 'The entries below will name a file that does not exist, and those servers will'
    Write-Info 'not start. Re-run WITHOUT -SkipBuild, or build just these:'
    Write-Info ('  .\bconnect.ps1 servers add ' + ($missingBuilds -join ','))
}

$manage = New-Object 'System.Collections.Specialized.OrderedDictionary'
$droppedEnvKeys = @()
foreach ($name in $selected) {
    $s = $available | Where-Object { $_.name -eq $name }
    $envBlock = $null
    if ($writeEnv.ContainsKey($name)) { $envBlock = $writeEnv[$name] }

    # Anything in a deployed entry's env block that this installer does not own.
    #
    # The design called for carrying such keys forward verbatim, so that an operator
    # could raise BCONNECT_TIMEOUT_MS on one slow server and keep it. That turned out
    # to be unimplementable as written: lib\host-emitters.mjs enforces a CLOSED
    # allowlist on host-config env keys -- ALLOW_WRITE_OPERATIONS, ALLOWED_WRITE_TOOLS,
    # BCONNECT_ENABLE_V11 and nothing else -- because a blocklist of secret names had
    # already let BCONNECT_V11_PASSWORD and MCP_GATEWAY_AUTH_TOKEN through. Carrying an
    # arbitrary key forward would make every non-Claude-Desktop emit fail validation,
    # and carrying it forward for Claude Desktop alone would make the hosts disagree.
    #
    # So the key is dropped -- and NAMED, which is the part that matters. Per-server
    # tuning belongs in the shared credentials file, where it survives by construction
    # now that the file is edited rather than rebuilt.
    if ($DeployedEnv.Contains($name)) {
        foreach ($k in @($DeployedEnv[$name].Keys)) {
            if (@('ALLOW_WRITE_OPERATIONS', 'ALLOWED_WRITE_TOOLS', 'BCONNECT_ENABLE_V11') -notcontains $k) {
                $droppedEnvKeys += ($name + '.' + $k)
            }
        }
    }

    $manage[$name] = New-ServerLaunchEntry -NodeExe $NodeExe `
        -ServerScript (Join-Path $SuiteRoot (Join-Path $s.dir 'build\index.js')) `
        -EnvFile $EnvFile -Protected:$Protect -Env $envBlock
}
if ($droppedEnvKeys.Count) {
    Write-Warn ('env keys in the existing entries that a host config may not carry: ' + ($droppedEnvKeys -join ', '))
    Write-Info 'They are NOT written back. Only capability gates belong in a host config'
    Write-Info '(ALLOW_WRITE_OPERATIONS, ALLOWED_WRITE_TOOLS, BCONNECT_ENABLE_V11); everything'
    Write-Info 'else -- tuning as well as credentials -- belongs in the credentials file, which'
    Write-Info 'this installer now edits in place rather than rebuilding.'
}

# Anti-clobber layer 2: a managed entry whose hash does not match the record was
# edited after the installer wrote it. Say so before overwriting it, and in a
# guided run offer the way out.
if ($Drift) {
    $edits = @($Drift | Where-Object { $_.Severity -eq 'edit' })
    if ($edits.Count) {
        Write-Host ''
        Write-Warn ("$($edits.Count) managed entr(y/ies) have been hand-edited since the last run:")
        foreach ($e in $edits) { Write-Info ('  ' + $e.Host + ': ' + $e.Server) }
        Write-Info 'This run will replace them with the installer''s version. The previous content'
        Write-Info 'is in the .bak-* file named in the merge report below.'
        if ($StageDoesUser -and -not $NonInteractive -and -not $Force -and -not $DryRun) {
            if (-not (Ask-YesNo 'Overwrite the hand-edited entries?' $false)) {
                Abort 'Stopped so the hand edits are not lost.' @(
                    'Copy what you want to keep out of those entries, then re-run -- or re-run',
                    'with -Force to take the installer''s version.',
                    'No host configuration was touched. The credentials file was already updated',
                    'earlier in this run, key-by-key, and that change stands.'
                )
            }
        }
    }
}

Write-Info ('targets: ' + ($SelectedHosts -join ', '))

# --- clients that must not be running while their file is written ------------
#
# Checked BEFORE any host is written, not per target: a refusal partway through
# leaves some clients configured and some not, which is a worse state than either.
#
# -Force proceeds anyway, because an operator on a managed or locked-down machine
# may be unable to quit the application and still needs a path. A forced run is
# exactly the run most likely to be reverted, so the end-of-run re-check below is
# what makes it honest rather than reckless.
if ($StageDoesUser -and -not $DryRun) {
    # Only where the file being written is the one the client actually reads.
    #
    # A client can only revert a file it opens, and it opens its default path. An
    # operator rehearsing against a copy, or a test harness writing to a scratch
    # directory, is in no danger from a running client -- and blocking them would be
    # a refusal with no cause behind it. Caught by Test-EstateLifecycle, which drives
    # real installs against scratch paths and went red on a machine that merely had
    # the client open.
    $atDefault = @($SelectedHostObjs | Where-Object {
        if (-not ($_.PSObject.Properties.Name -contains 'quitProcesses')) { return $false }
        if ($_.id -ne 'claude-desktop') { return $true }
        $dflt = [Environment]::ExpandEnvironmentVariables(($_.defaultPath -replace '\{APPDATA\}', '%APPDATA%'))
        return ([string]$ConfigPath).TrimEnd('\') -ieq ([string]$dflt).TrimEnd('\')
    })
    $blocking = @(Get-BlockingHostProcesses $atDefault)
    if ($blocking.Count) {
        Write-Host ''
        foreach ($b in $blocking) {
            Write-Warn ("$($b.Label) is running -- $($b.Count) $($b.Process).exe process(es).")
        }
        Write-Info 'These clients rewrite their configuration file from their own state when they'
        Write-Info 'start, discarding what is written while they run. The write below would appear'
        Write-Info 'to succeed and then be undone, and the client would show no servers.'
        Write-Info ''
        Write-Info '  1. Quit it properly: tray icon -> Quit. Closing the window leaves it running.'
        Write-Info '  2. Check no process remains. These clients run many at once.'
        Write-Info '  3. Re-run this, and start the client only afterwards.'
        if (-not $Force) {
            Abort 'a client that must be closed is running.' @(
                'Quit it and re-run. Nothing has been written to any host configuration;',
                'the credentials file was updated earlier in this run and that stands.',
                'To write anyway -- on a machine where it cannot be quit -- re-run with -Force.',
                'The end-of-run check will then report whether the write survived.'
            )
        }
        Write-Warn '-Force given: writing anyway. The end-of-run check will report if it is undone.'
    }
}

# The machine stage stops here. It has established Node, the suite and the install
# location, and the record it writes at the end carries this list as INTENT; it
# writes no client file, because every client file belongs to a person and this
# process is not one. The two emitters below are the only writers of host config
# in this script, so gating them is the whole of it.
if (-not $StageDoesUser) {
    Write-Info 'no host configuration is written by the machine stage. The target list above is'
    Write-Info 'recorded as the INTENDED client list, which the user stage reads back.'
    Write-Info 'Each administrator then runs, in their own login:'
    Write-Info '  .\Install-BConnectMcp.ps1 -Stage User'
}

# --- Claude Desktop, unchanged ----------------------------------------------
# Deliberately NOT routed through the new emitter. This path is verified, it is
# what this estate runs on today, and the whole point of adding host targets was
# to do it without disturbing the one that works. merge-config.mjs still owns it:
# backup, deep-compare of every unmanaged key, restore on mismatch.
if ($StageDoesUser -and ($SelectedHosts -contains 'claude-desktop')) {
    $plan = [ordered]@{ manage = $manage; remove = $toRemove }
    $planFile = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-plan-' + [guid]::NewGuid().ToString('N') + '.json')
    # The plan carries no secrets: credentials live in the env file that --env-file
    # points at, and never in claude_desktop_config.json.
    ($plan | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $planFile -Encoding UTF8

    try {
        Write-Host ''
        Write-Host '  --- Claude Desktop ---' -ForegroundColor White
        $mergeArgs = @("`"$(Join-Path $LibDir 'merge-config.mjs')`"", '--target', "`"$ConfigPath`"", '--plan', "`"$planFile`"")
        if ($DryRun) { $mergeArgs += '--dry-run' }
        $r = Invoke-Native $NodeExe $mergeArgs $LibDir
        Write-Host $r.Output.TrimEnd()
        if ($r.Code -ne 0) { Abort 'The configuration merge failed; your file was left as it was.' }
        if ($DryRun) { Write-Info 'dry run -- configuration not written' } else {
            Write-Ok 'configuration merged, backup taken, unrelated content verified unchanged'
            Register-HostWrite -HostId 'claude-desktop' -Path $ConfigPath
        }
    } finally {
        Remove-Item -LiteralPath $planFile -Force -ErrorAction SilentlyContinue
    }
}

# --- every other target ------------------------------------------------------
$otherHosts = @($SelectedHostObjs | Where-Object { $_.id -ne 'claude-desktop' })
$EmittedHostFiles = @{}
if ($StageDoesUser -and $otherHosts.Count) {
    Write-Host ''
    Write-Host '  --- other hosts ---' -ForegroundColor White

    $hostTargets = @()
    foreach ($t in $otherHosts) {
        $p = Resolve-HostPath $t
        $EmittedHostFiles[$t.id] = $p
        $hostTargets += [ordered]@{ id = $t.id; path = $p }
    }

    $gatewayBlock = $null
    if ($Gateway) {
        $gatewayBlock = [ordered]@{
            url  = ('http://{0}:{1}' -f $GatewayBind, $GatewayPort)
            bind = $GatewayBind
            port = $GatewayPort
            # SEC-7 -- the FACT that a bearer token is required, never the token.
            # The emitted snippets go to install\out, which is not ACL-hardened;
            # they name the header and the file that holds the value.
            authRequired = [bool]$script:GatewayToken
        }
    }

    $hostPlan = [ordered]@{
        outDir  = $HostOutDir
        servers = $manage
        remove  = $toRemove
        gateway = $gatewayBlock
        targets = $hostTargets
    }
    $hostPlanFile = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-hostplan-' + [guid]::NewGuid().ToString('N') + '.json')
    ($hostPlan | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $hostPlanFile -Encoding UTF8
    try {
        $emitArgs = @("`"$(Join-Path $LibDir 'emit-host-config.mjs')`"", '--plan', "`"$hostPlanFile`"")
        if ($DryRun) { $emitArgs += '--dry-run' }
        $r = Invoke-Native $NodeExe $emitArgs $LibDir
        Write-Host $r.Output.TrimEnd()
        if ($r.Code -ne 0) {
            Abort 'One or more host configurations could not be written.' @(
                'Every emitted config is shape-checked against lib\hosts.json before it is',
                'written, so a failure here means the shape was wrong, not that a file was',
                'half-written. Nothing partial was left behind.'
            )
        }
        if (-not $DryRun) {
            Write-Ok "$($otherHosts.Count) further host target(s) written"
            # Every emitted target, by the same rule as Claude Desktop. Snippet-mode
            # targets have no file of their own and simply do not appear in the map.
            foreach ($k in $EmittedHostFiles.Keys) { Register-HostWrite -HostId $k -Path $EmittedHostFiles[$k] }
        }
    } finally {
        Remove-Item -LiteralPath $hostPlanFile -Force -ErrorAction SilentlyContinue
    }
}

}  # end -not $VerifyOnly

# -----------------------------------------------------------------------------
# Step 10 -- verify the live configuration
# -----------------------------------------------------------------------------
Write-Step 'Verification'

$verifyFailed = $false

# Verification starts each server exactly the way the client will: with the
# credentials file, against the live bMS. The machine stage has neither, so there is
# nothing here it could prove and nothing it would find. Saying that is the point --
# a machine stage that printed a verification section would be claiming more than it
# did, which is the failure class this whole split exists to close.
if (-not $StageDoesUser) {
    Write-Info 'skipped -- verification starts each server with the credentials and calls the'
    Write-Info 'bMS, and the machine stage has no credentials. The user stage verifies.'
    Write-Info 'What the machine stage did establish is in Steps 1 and 6: Node, the suite,'
    Write-Info 'and a build\index.js for every selected server.'
}
if ($StageDoesUser) {

# -VerifyOnly used to skip Step 4 entirely, so the command the installer itself
# recommends twice as the "did my change work?" action could not detect a wrong base
# URL or a revoked API key. It reads the credential out of the STORE rather than from
# a prompt, which is the only credential a host will ever use anyway.
if ($VerifyOnly -and -not $DryRun) {
    $vBase = [string]$existingEnv['BCONNECT_BASE_URL']
    if (-not $vBase) {
        Write-Warn 'no BCONNECT_BASE_URL in the credentials store -- cannot probe bConnect'
        Write-Info 'Run:  .\bconnect.ps1 status   to see what the credentials store holds.'
    } else {
        $vHeaders = @{ 'Accept-Encoding' = 'gzip, deflate' }
        if ($existingEnv['BCONNECT_API_KEY']) { $vHeaders['X-Api-Key'] = [string]$existingEnv['BCONNECT_API_KEY'] }
        elseif ($existingEnv['BCONNECT_USERNAME']) {
            $vPair = [string]$existingEnv['BCONNECT_USERNAME'] + ':' + [string]$existingEnv['BCONNECT_PASSWORD']
            $vHeaders['Authorization'] = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($vPair))
            $vPair = $null
        }
        try {
            $vr = Invoke-WebRequest -Uri ($vBase + '/endpoints/v2.0/WindowsEndpoints?$top=1') `
                    -Headers $vHeaders -UseBasicParsing -TimeoutSec 25 -Method Get
            Write-Ok ('stored credential works: GET /endpoints/v2.0/WindowsEndpoints -> HTTP ' + [int]$vr.StatusCode)
        } catch {
            $vs = $null
            if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { $vs = [int]$_.Exception.Response.StatusCode }
            Write-Fail ('the STORED credential does not work: ' + $(if ($vs) { "HTTP $vs" } else { $_.Exception.Message }))
            if ($vs -eq 401) {
                Write-Info 'bConnect answers 401 for an unknown route as well as a bad credential, so'
                Write-Info 'this means EITHER the key was revoked OR the base URL is wrong. Check the'
                Write-Info 'URL first -- it is the more common mistake and the more expensive one.'
            }
            Write-Info 'Fix with:  .\bconnect.ps1 set url <url>   or   .\bconnect.ps1 set credential'
            $verifyFailed = $true
        } finally { $vHeaders = $null }
    }
}

if ($DryRun) {
    Write-Info 'skipped -- there is nothing written to verify in a dry run'
    Write-Host ''
    Write-Ok 'dry run complete'
    # reachable/httpStatus travel with the verdict rather than being inferred from the
    # console. A dry run that reached a 401 is NOT a dry run that succeeded, and the
    # wizard's Test button had no way to tell the two apart: -ContinueOnUnreachable
    # (which Test always sets, so a bad address still reports the rest) makes both end
    # with failed = false. So it read a refused credential as "bConnect answered".
    Send-Progress 'done' @{ failed = $false; dryRun = $true
                            reachable = [bool]$reachOk; httpStatus = $reachHttpStatus
                            warnings = @($script:Warnings) }
    exit 0
}

Write-Info 'Starting each configured server exactly as its host will -- same command,'
Write-Info 'same arguments, same env block, read out of that host''s own configuration'
Write-Info 'file. Nothing below is supplied by the installer.'

# --- Claude Desktop ----------------------------------------------------------
if ($SelectedHosts -contains 'claude-desktop') {
    Write-Host ''
    Write-Host '  --- Claude Desktop ---' -ForegroundColor White
    $vArgs = @("`"$(Join-Path $LibDir 'verify-install.mjs')`"", '--config', "`"$ConfigPath`"")
    if ($ProbeAllowlistPositive) { $vArgs += '--probe-allowlist-positive' }
    $v = Invoke-Native $NodeExe $vArgs $LibDir
    Write-Host $v.Output.TrimEnd()
    if ($v.Code -ne 0) { $verifyFailed = $true }
}

# --- every other stdio host --------------------------------------------------
# The same discipline, one level out: the file the HOST reads is parsed in that
# host's documented container shape and every server named in it is started from
# the command/args/env found there. That proves the process side for a host that
# is not installed on this machine, which is the honest half of the claim. What it
# does not prove -- that the host application reads the file -- is printed by the
# verifier itself rather than glossed over here.
foreach ($t in @($SelectedHostObjs | Where-Object {
            $_.id -ne 'claude-desktop' -and ($_.mode -eq 'merge-json' -or $_.mode -eq 'write-file') })) {
    # Only targets whose emitted artefact IS a config file. A snippet is
    # documentation -- a markdown page with a fenced block in it -- and feeding one
    # to a JSON or YAML parser would produce a failure that says nothing about
    # whether the configuration is right.
    $hp = Resolve-HostPath $t
    Write-Host ''
    Write-Host ('  --- ' + $t.label + ' ---') -ForegroundColor White
    if (-not (Test-Path -LiteralPath $hp)) {
        Write-Warn "$($t.id): nothing at $hp to verify"
        continue
    }
    $hv = Invoke-Native $NodeExe @(
        "`"$(Join-Path $LibDir 'verify-host-config.mjs')`"",
        '--target', $t.id, '--path', "`"$hp`"", '--suite-root', "`"$SuiteRoot`""
    ) $LibDir
    Write-Host $hv.Output.TrimEnd()
    if ($hv.Code -eq 3) {
        Write-Warn "$($t.id): SKIPPED -- see the message above. Not counted as a pass."
    } elseif ($hv.Code -ne 0) {
        $verifyFailed = $true
    }
}

# --- snippet-only hosts ------------------------------------------------------
foreach ($t in @($SelectedHostObjs | Where-Object { $_.mode -eq 'snippet' })) {
    Write-Host ''
    Write-Host ('  --- ' + $t.label + ' ---') -ForegroundColor White
    Write-Info ('instructions written to ' + (Resolve-HostPath $t))
    Write-Info 'What was emitted here is documentation with a config block in it, not a file'
    Write-Info 'this installer owns, so there is nothing at this path to start. The block was'
    Write-Info 'shape-checked before it was written.'
    if ($t.verification -eq 'schema-only') {
        Write-Info 'SHAPE ONLY -- this host is not installed here and has executed nothing.'
    } else {
        Write-Info 'The command line inside it is byte-for-byte the one started and read from'
        Write-Info 'live above, so the process side of it is verified even though the host is not.'
    }
    if ($t.impractical) {
        Write-Warn ("$($t.id) needs an internet-reachable HTTPS endpoint; read the emitted file before planning on it.")
    }
}

# --- the gateway -------------------------------------------------------------
if ($Gateway) {
    Write-Host ''
    Write-Host '  --- bConnect MCP gateway ---' -ForegroundColor White
    $gwMain = Join-Path $SuiteRoot 'bconnect-mcp-gateway\build\gateway.js'
    if (-not (Test-Path -LiteralPath $gwMain)) {
        Write-Warn 'the gateway is not built -- build\gateway.js is missing.'
        Write-Info 'The suite root build script globs bconnect-*-mcp, and the gateway directory'
        Write-Info 'is bconnect-mcp-gateway, so building "everything" does not build it. Run'
        Write-Info ('  npm run build   inside ' + (Join-Path $SuiteRoot 'bconnect-mcp-gateway'))
        $verifyFailed = $true
    } else {
        Write-Ok ('built: ' + $gwMain)
        Write-Host ''
        # A -VerifyOnly run never reaches Step 5, so it has generated nothing --
        # but the credentials file may well already hold a token, and reporting
        # "no authentication" over a gateway that has some is the wrong answer in
        # the more dangerous direction. Read it, do not write it.
        if (-not $script:GatewayToken) {
            try {
                $existingTok = Get-GatewayAuthTokenFromEnvText -Text (Read-BConnectEnvText -EnvFile $EnvFile)
                if ($existingTok) { $script:GatewayToken = ($existingTok -split ',')[0].Trim() }
            } catch { }
        }
        # SEC-7 -- show the operator exactly what was done, and what it is worth.
        if ($script:GatewayToken) {
            $what = if ($script:GatewayTokenRotated) { 'ROTATED' } elseif ($script:GatewayTokenIsNew) { 'GENERATED' } else { 'ALREADY CONFIGURED' }
            Write-Host '  Gateway authentication' -ForegroundColor White
            Write-Host '  ----------------------' -ForegroundColor DarkGray
            Write-Host ('  Bearer token: ' + $what) -ForegroundColor Green
            Write-Host ''
            Write-Host ('    Authorization: Bearer ' + $script:GatewayToken) -ForegroundColor Cyan
            Write-Host ''
            $tokenStorePath = (Get-CredentialStoreState -EnvFile $EnvFile).ActivePath
            if (-not $tokenStorePath) { $tokenStorePath = $EnvFile }
            Write-Host ('  Stored in   ' + $tokenStorePath)
            Write-Host  '              (the same ACL-hardened file as the bConnect credential; the'
            Write-Host  '              stdio servers ignore this variable, the gateway requires it)'
            Write-Host  '  Copy it into the client now -- n8n Header Auth, Open WebUI Bearer field,'
            Write-Host  '  or a plain Authorization header. Every POST /<domain>/mcp without it'
            Write-Host  '  gets 401. /health stays open so container probes keep working.'
            if ($script:GatewayTokenRotated) {
                Write-Host ''
                Write-Host '  The PREVIOUS token still works: the file now holds "<new>,<old>" and the' -ForegroundColor Yellow
                Write-Host '  gateway accepts both, so nothing breaks while you move clients across.' -ForegroundColor Yellow
                Write-Host '  Re-run WITHOUT -RotateGatewayToken once they are moved to drop the old' -ForegroundColor Yellow
                Write-Host '  one -- until you do, a leaked token is still a valid token.' -ForegroundColor Yellow
            }
            Write-Host ''
            Write-Host '  What this is not: TLS, and not an identity. The token says a caller may' -ForegroundColor DarkGray
            Write-Host '  talk to the gateway, not who they are, and it crosses the wire in clear' -ForegroundColor DarkGray
            Write-Host '  text on plain HTTP. Downstream, one bConnect service credential still' -ForegroundColor DarkGray
            Write-Host '  does the work and bMS RBAC still bounds it.' -ForegroundColor DarkGray
            # A caller rendering this run (the WPF wizard) gets the same facts as a
            # structured record, so it can offer a Copy button instead of asking
            # the operator to select 43 characters out of a console pane.
            Send-Progress 'gateway-token' @{
                token    = $script:GatewayToken
                header   = ('Authorization: Bearer ' + $script:GatewayToken)
                storedIn = $tokenStorePath
                state    = $what
                rotated  = $script:GatewayTokenRotated
            }
        } else {
            Write-Host '  This gateway has NO authentication token configured. It holds one' -ForegroundColor Yellow
            Write-Host '  bConnect service credential and every caller gets that credential''s full' -ForegroundColor Yellow
            Write-Host '  reach, bounded only by bMS RBAC. On loopback that is a defensible posture.' -ForegroundColor Yellow
            Write-Host '  Anywhere else, an authenticating TLS-terminating reverse proxy is not' -ForegroundColor Yellow
            Write-Host '  optional -- and nothing in this installer can tell whether you have one.' -ForegroundColor Yellow
            Write-Host '  Re-run with -Gateway to have a token generated for you.' -ForegroundColor Yellow
        }

        $gwUrl = 'http://{0}:{1}' -f $GatewayBind, $GatewayPort
        if ($StartGateway) {
            $sg = @(
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', "`"$(Join-Path $LibDir 'Start-BConnectGateway.ps1')`"",
                '-EnvFile', "`"$EnvFile`"", '-SuiteRoot', "`"$SuiteRoot`"",
                '-Bind', $GatewayBind, '-Port', $GatewayPort, '-NodeExe', "`"$NodeExe`""
            )
            if ($GatewayIUnderstandThereIsNoAuth) { $sg += '-IUnderstandThereIsNoAuth' }
            $sr = Invoke-Native (Get-PowerShellExePath) $sg $LibDir
            Write-Host $sr.Output.TrimEnd()
            if ($sr.Code -ne 0) {
                $verifyFailed = $true
            } else {
                # The token goes to the verifier in its ENVIRONMENT, never on the
                # command line: an argument lands in the process list, in any
                # transcript, and in this console's history.
                $gvArgs = @(
                    "`"$(Join-Path $LibDir 'verify-gateway.mjs')`"", '--url', $gwUrl,
                    '--suite-root', "`"$SuiteRoot`"",
                    '--domains', (($selected | ForEach-Object { $_ -replace '^bconnect-', '' }) -join ',')
                )
                if ($script:GatewayToken) {
                    $gvArgs += '--expect-auth'
                    $env:MCP_GATEWAY_AUTH_TOKEN = $script:GatewayToken
                }
                try {
                    $gv = Invoke-Native $NodeExe $gvArgs $LibDir
                } finally {
                    Remove-Item Env:\MCP_GATEWAY_AUTH_TOKEN -ErrorAction SilentlyContinue
                }
                Write-Host $gv.Output.TrimEnd()
                if ($gv.Code -ne 0) { $verifyFailed = $true }
            }
        } else {
            Write-Info 'not started (-StartGateway was not given). Start and verify it with:'
            Write-Info ('  .\lib\Start-BConnectGateway.ps1 -Bind ' + $GatewayBind + ' -Port ' + $GatewayPort)
            Write-Info ('  node .\lib\verify-gateway.mjs --url ' + $gwUrl + '   (reads MCP_GATEWAY_AUTH_TOKEN from the environment)')
        }
    }
}

}  # end $StageDoesUser -- Step 10

# -----------------------------------------------------------------------------
# The installation record -- written LAST, from what is actually on disk
# -----------------------------------------------------------------------------
# Not from the variables this run decided: from the files it wrote. A record built
# from intent would record an entry hash for a merge that failed, and the next run
# would then report drift against something it never wrote.
if (-not $VerifyOnly -and -not $DryRun) {
    try {
        $finalEnvMap = New-Object 'System.Collections.Specialized.OrderedDictionary'
        try { $finalEnvMap = Read-BConnectEnvMap -EnvFile $EnvFile } catch { }

        $recServers = [ordered]@{}
        foreach ($name in $selected) {
            $blk = $null
            if ($writeEnv.ContainsKey($name)) { $blk = $writeEnv[$name] }
            $gate = $null
            if ($blk -and $blk.Contains('ALLOW_WRITE_OPERATIONS') -and $blk['ALLOW_WRITE_OPERATIONS'] -eq 'true') {
                $tools = @()
                if ($blk.Contains('ALLOWED_WRITE_TOOLS') -and $blk['ALLOWED_WRITE_TOOLS']) {
                    $tools = @($blk['ALLOWED_WRITE_TOOLS'] -split ',')
                }
                $gate = [ordered]@{ allow = $true; tools = $tools }
            }
            $recServers[$name] = [ordered]@{
                writeGate = $gate
                v11       = [bool]($blk -and $blk.Contains('BCONNECT_ENABLE_V11'))
            }
        }

        # INTENDED clients and CONFIGURED clients are separate fields, because after
        # the split they are separate facts and conflating them is how a machine
        # stage would read as a finished install.
        #
        #   intendedHosts   what the installation is FOR. The machine stage owns it;
        #                   a user-stage run preserves it rather than narrowing it to
        #                   whatever that one administrator configured.
        #   hosts[]         what is actually in a file on disk, with the entry hashes
        #                   drift is measured against. The user stage owns it; a
        #                   machine stage preserves it rather than emptying it, or a
        #                   pushed upgrade would erase the drift baseline of every
        #                   administrator who had already run the user stage.
        $prevHosts = @()
        if ($Record -and $Record.PSObject.Properties.Name -contains 'hosts' -and $Record.hosts) { $prevHosts = @($Record.hosts) }

        $recHosts = @()
        if ($StageDoesUser) {
            foreach ($hf in (Get-HostFileList $SelectedHosts)) {
                $hashes = [ordered]@{}
                $onDisk = Get-HostManagedEntries -Path $hf.path -Target $hf.target
                if ($null -ne $onDisk) {
                    foreach ($n in @($onDisk.Keys)) {
                        if ($selected -contains $n) { $hashes[$n] = Get-ManagedEntryHash $onDisk[$n] }
                    }
                }
                $recHosts += [ordered]@{
                    id          = $hf.id
                    path        = $hf.path
                    mode        = $hf.target.mode
                    entryHashes = $hashes
                    writtenAt   = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
                }
            }
        } else {
            $recHosts = $prevHosts
        }

        # The intended list survives a user-stage run that was told to configure only
        # part of it. A machine stage, or a run with an explicit -Hosts, sets it.
        $intended = @($SelectedHosts)
        if ($StageDoesUser -and -not $StageDoesMachine -and -not $Hosts) {
            $prevIntended = @(Get-RecordIntendedHostIds $Record)
            if ($prevIntended.Count) { $intended = $prevIntended }
        }

        # Which Windows account wrote the configured half. An identity, not a secret,
        # and the same class of fact as the recorded v1.1 username. On a workstation
        # with two administrators it is the only thing in the record that says whose
        # client configurations hosts[] describes.
        $configuredBy = $null
        if ($StageDoesUser) { $configuredBy = [string]$UserContext.Account }
        elseif ($Record -and $Record.PSObject.Properties.Name -contains 'configuredBy') { $configuredBy = [string]$Record.configuredBy }

        $newRecord = New-InstallationRecord `
            -SuiteRoot $SuiteRoot -SecretsDir $SecretsDir -ProjectDir $ProjectDir -HostOutDir $HostOutDir `
            -NodeVersion $nodeVerRaw -InstallerVersion (Get-InstallerVersion -Path $PSCommandPath) `
            -Credentials (Get-CredentialFacts -EnvMap $finalEnvMap -Mode (Get-CredentialStoreState -EnvFile $EnvFile).Mode) `
            -Servers $recServers -Hosts $recHosts `
            -Stage $Stage.ToLower() -IntendedHosts $intended -ConfiguredBy $configuredBy `
            -Gateway @{ enabled = [bool]$Gateway; bind = $GatewayBind; port = $GatewayPort
                        tokenPresent = [bool]$finalEnvMap['MCP_GATEWAY_AUTH_TOKEN'] } `
            -Measured @{ tools = $cost.Tools; schemaTokens = [int][math]::Round($cost.Bytes / 4)
                         bmsVersion = $(if ($BmsVersionRaw) { $BmsVersionRaw } else { 'unknown' }) } `
            -Verified ($StageDoesUser -and -not $verifyFailed)

        # The record is world-readable by design, so the values it must never hold
        # are checked rather than assumed. A guard, not a comment.
        $mustNot = @()
        foreach ($k in @('BCONNECT_API_KEY', 'BCONNECT_PASSWORD', 'BCONNECT_V11_PASSWORD', 'MCP_GATEWAY_AUTH_TOKEN')) {
            if ($finalEnvMap.Contains($k) -and $finalEnvMap[$k]) { $mustNot += [string]$finalEnvMap[$k] }
        }
        $written = Write-InstallationRecord -Path $StateFile -Record $newRecord -MustNotContain $mustNot
        Write-Host ''
        Write-Ok ("installation record written: $written")
        Write-Info 'It holds no secret -- the v1.1 username is an identity and the gateway token is'
        Write-Info 'recorded as a fact, not a value. It is what lets the next run know which hosts'
        Write-Info 'to re-emit to and which write gates to keep.'
        Write-Info 'Everyday changes:  .\bconnect.ps1 status | set url <u> | writes disable <server>'
    } catch {
        # A record that could not be written must not fail an installation that
        # worked. The next run adopts from disk instead, which is the same path
        # every pre-record installation takes.
        Write-Warn ('could not write the installation record: ' + $_.Exception.Message)
        Write-Info 'The installation itself is unaffected; the next run will adopt from disk.'
    }
}

# -----------------------------------------------------------------------------
# Did what we wrote stay written?
#
# Deliberately here, at the end, and not immediately after each write. The client
# that reverts the file does it during its own startup, seconds to minutes after
# the write -- so a check that ran straight away would have agreed with the write
# every time, which is exactly what the existing post-write verification inside
# merge-config.mjs did on three consecutive failing runs. By this point
# verification has started thirteen servers against a live bMS, which takes long
# enough for a reverting client to have reverted.
#
# This does not prevent the revert and does not pretend to. It stops the run
# claiming success for a file that no longer says what the installer put in it.
# -----------------------------------------------------------------------------
$hostDrift = @()
if ($StageDoesUser -and -not $DryRun -and $script:HostWrites.Count) {
    $hostDrift = @(Test-HostWritesIntact)
    if ($hostDrift.Count) {
        $verifyFailed = $true
        Write-Host ''
        Write-Fail 'a host configuration this run wrote has been changed since it was written.'
        foreach ($d in $hostDrift) {
            Write-Info ('  {0}: {1} -- {2}, {3:N0}s after this run wrote it' -f `
                        $d.Host, $d.Path, $d.Why, $d.Age.TotalSeconds)
        }
        Write-Info ''
        Write-Info 'The installer wrote that file and re-read it successfully at the time, so this'
        Write-Info 'is not a failed write. Something else rewrote it afterwards. The usual cause is'
        Write-Info 'the client application itself: several of them read this file at startup and'
        Write-Info 'write it back from their own state, discarding what was there.'
        Write-Info ''
        Write-Info 'What to do:'
        Write-Info '  1. Quit the client COMPLETELY -- tray icon, Quit; closing the window is not enough.'
        Write-Info '  2. Confirm no process of it remains. An Electron client runs many at once.'
        Write-Info '  3. Re-run, and start the client only after the run has finished.'
        Write-Info ''
        Write-Info 'Without that, the client will show no servers however many times this is run,'
        Write-Info 'and every run will look like it worked.'
    } else {
        Write-Ok ("host configuration re-checked: $($script:HostWrites.Count) file(s) still as written")
    }
}

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
Write-Host ''
Write-Host ('=' * 74) -ForegroundColor DarkCyan
if ($verifyFailed) {
    Write-Host ' Finished with problems' -ForegroundColor Yellow
} else {
    Write-Host ' Finished' -ForegroundColor Green
}
Write-Host ('=' * 74) -ForegroundColor DarkCyan

if ($script:Warnings.Count) {
    Write-Host ''
    Write-Host '  Warnings raised during this run:' -ForegroundColor Yellow
    foreach ($w in $script:Warnings) { Write-Host ('    - ' + $w) -ForegroundColor Yellow }
}

if (-not $StageDoesUser) {
    Write-Host ''
    Write-Host '  Machine stage complete' -ForegroundColor White
    Write-Host '  ----------------------' -ForegroundColor DarkGray
    Write-Host ('    Node            ' + $nodeVerRaw + '  at ' + $NodeExe)
    Write-Host ('    suite           ' + $SuiteRoot)
    Write-Host ('    credentials     ' + $SecretsDir + '   [none yet -- the user stage writes them]')
    Write-Host ('    record          ' + $StateFile)
    Write-Host ('    intended clients ' + ($SelectedHosts -join ', '))
    Write-Host ''
    Write-Host '  No client configuration was written and no credential was collected. Each'
    Write-Host '  administrator now runs this once, in their own login:'
    Write-Host ''
    Write-Host '    .\Install-BConnectMcp.ps1 -Stage User' -ForegroundColor White
    Write-Host ''
    Write-Host '  That reads the intended client list out of the record above, asks for the'
    Write-Host '  bConnect credentials, and configures that account''s clients. Until it has'
    Write-Host '  run for an administrator, that administrator has no working installation.'
    Write-Host ''
    Send-Progress 'done' @{ failed = $false; stage = 'machine'; intendedHosts = @($SelectedHosts) }
    exit 0
}

if ($SelectedHostObjs.Count) {
    Write-Host ''
    Write-Host '  Host targets configured' -ForegroundColor White
    Write-Host '  -----------------------' -ForegroundColor DarkGray
    foreach ($t in $SelectedHostObjs) {
        $how = switch ($t.verification) {
            'host-loaded'  { 'host loaded it here' }
            'config-spawn' { 'servers started from the emitted file' }
            default        { 'SHAPE ONLY -- nothing executed by this host' }
        }
        Write-Host ('    {0} {1}' -f $t.id.PadRight(16), (Resolve-HostPath $t))
        Write-Host ('    {0} {1}' -f ''.PadRight(16), $how) -ForegroundColor DarkGray
    }
    Write-Host ''
    Write-Host '  The distinction above is the point. "SHAPE ONLY" means the file matches the'
    Write-Host '  shape that host documents and every credential stayed out of it -- and that'
    Write-Host '  nothing on this machine has ever seen that host read it. Treat it as a'
    Write-Host '  well-founded starting point, not as a tested integration.'
}

Write-Host ''
Write-Host '  What you still have to do yourself' -ForegroundColor White
Write-Host '  ----------------------------------' -ForegroundColor DarkGray
$stepNo = 0
foreach ($t in $SelectedHostObjs) {
    $stepNo++
    $tPath = Resolve-HostPath $t
    Write-Host ('  {0}. {1}' -f $stepNo, $t.label) -ForegroundColor White
    Write-Host ('     ' + $tPath) -ForegroundColor DarkGray
    foreach ($line in (Get-HostActivation $t $tPath)) { Write-Host ('     ' + $line) }
}
if ($Gateway) {
    $stepNo++
    Write-Host ('  {0}. The HTTP gateway' -f $stepNo) -ForegroundColor White
    Write-Host ('     http://{0}:{1}' -f $GatewayBind, $GatewayPort) -ForegroundColor DarkGray
    if ($StartGateway) {
        Write-Host '     Started by this run. It does NOT survive a reboot or this console closing --'
        Write-Host '     install it as a service, or restart it with .\lib\Start-BConnectGateway.ps1.'
    } else {
        Write-Host ('     Not started. Start it with .\lib\Start-BConnectGateway.ps1 -Bind ' +
                    $GatewayBind + ' -Port ' + $GatewayPort)
    }
    Write-Host '     Every HTTP client above needs it running and needs the bearer token.'
}
$stepNo++
Write-Host ('  {0}. Ask your client something read-only, e.g. "List all Windows endpoints", and' -f $stepNo) -ForegroundColor White
Write-Host '     spot-check the answer against the bMS console once. bConnect returns HTTP 200'
Write-Host '     with an empty page for collections your credential may not read, so "none" can'
Write-Host '     mean "not permitted" rather than "not present".'
Write-Host ''
Write-Host '  Nothing above proves a client has LOADED what was written. Only that client,'
Write-Host '  restarted and asked a question, proves that.'
Write-Host ''
Write-Host '  Changing something later' -ForegroundColor White
Write-Host '  ------------------------' -ForegroundColor DarkGray
Write-Host '    .\Manage-BConnectMcp.ps1                  the settings window: the same'
Write-Host '                                             changes, without a command line'
Write-Host '    .\bconnect.ps1 status                     what is installed, and any drift'
Write-Host '    .\bconnect.ps1 set url <url>              one line in the credentials file'
Write-Host '    .\bconnect.ps1 writes enable <server> [tools...]   / writes disable <server>'
Write-Host '    .\bconnect.ps1 servers add|remove <name>  / hosts add|remove|resync <id>'
Write-Host '    .\bconnect.ps1 uninstall                  and it says what it could NOT remove'
Write-Host ''
Write-Host '    .\Install-BConnectMcp.ps1 -VerifyOnly     re-check without changing anything'
Write-Host '    .\Install-BConnectMcp.ps1                 the guided walk, with every prompt'
Write-Host '                                             defaulted to the CURRENT value'
Write-Host ''
Write-Host '  Anything you are not asked about on a later run keeps the value it has now.'
Write-Host '  That is enforced, not intended: the credentials file is edited key-by-key and'
Write-Host '  every per-server env block is read before it is written.'
Write-Host ''
$finalStore = Get-CredentialStoreState -EnvFile $EnvFile
Write-Host ('  credentials  ' + $(if ($finalStore.ActivePath) { $finalStore.ActivePath } else { $EnvFile }) + '  [' + $finalStore.Mode + ']')
if ($finalStore.Mode -eq 'protected') {
Write-Host '               DPAPI, CurrentUser. Decryptable only by this Windows account on'
Write-Host '               this machine, so a copy of the file is useless elsewhere. It is'
Write-Host '               not protection against code running as you.'
}
foreach ($t in $SelectedHostObjs) {
    Write-Host ('  config       ' + (Resolve-HostPath $t) + '   [' + $t.id + ']')
}
if ($BmsVersionRaw) { Write-Host ('  bMS          ' + $BmsVersionRaw) }
Write-Host ''

Send-Progress 'done' @{ failed = [bool]$verifyFailed; warnings = @($script:Warnings)
                        credentialMode = $finalStore.Mode; credentialPath = $finalStore.ActivePath }

if ($verifyFailed) { exit 1 }
exit 0
