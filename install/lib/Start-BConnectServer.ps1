<#
.SYNOPSIS
    Launcher shim: decrypt DPAPI-protected bConnect credentials in memory and start an
    MCP server with them in its environment block.

.DESCRIPTION
    Claude Desktop launches an MCP server as a command plus arguments, speaking JSON-RPC
    over the child's stdin/stdout. When credentials are stored in plaintext that command
    is `node --env-file=<file> <server>` and this file is not involved at all.

    When DPAPI protection is on, Node cannot read the credentials -- there is no DPAPI in
    Node -- so the configuration launches this script instead. It:

      1. reads the protected container and decrypts it with ProtectedData at CurrentUser
         scope (same entropy constant as the installer -- see lib\Dpapi.psm1),
      2. builds a child environment block from the decrypted key/value pairs,
      3. starts node with that block, and
      4. waits, then exits with the child's exit code.

    THE THREE RULES THIS FILE EXISTS TO KEEP
    ----------------------------------------
    * The decrypted secret never touches disk. No temp file, no --env-file, no
      Out-File. It exists as a string in this process and as entries in the child's
      environment block, which the kernel copies into the child at CreateProcess time.

    * The decrypted secret never appears on a command line. Not this script's, not
      node's. A command line is readable by any process that can open the target with
      PROCESS_QUERY_LIMITED_INFORMATION -- which on a workstation is most of them --
      and it is captured by Sysmon, EDR and Get-CimInstance Win32_Process alike. The
      child's argv is exactly: <node> <server>\build\index.js
      (Test-CredentialProtection.ps1 asserts this against the live child's real
      command line, with a negative control proving the check can fail.)

    * NOTHING is written to this process's stdout. Ever. stdout is the MCP transport;
      one stray character makes the JSON-RPC stream unparseable and Claude Desktop
      reports only "server disconnected". Every diagnostic here goes to stderr, which
      Desktop shows in its MCP log. -NoProfile in the configured arguments matters for
      the same reason: a profile that prints a banner would corrupt the stream.

    HOW STDIO REACHES NODE
    ----------------------
    UseShellExecute=$false with no redirection means the child INHERITS this process's
    standard handles. The pipe Claude Desktop created is handed straight through to
    node; nothing is copied, buffered or re-encoded by PowerShell, so there is no
    opportunity to corrupt or deadlock the stream. That is why this shim does not
    proxy the streams itself.

.PARAMETER ServerScript
    Absolute path to the server entry point, e.g. ...\bconnect-endpoints-mcp\build\index.js

.PARAMETER EnvFile
    The credentials file. A .dpapi container is decrypted; a plain .env is read as-is,
    so this shim can front either form.

.PARAMETER NodeExe
    Absolute path to node.exe. Defaults to whatever is on PATH.

.NOTES
    Exit codes: the child's, or 91 if this shim itself could not get that far. 91 is
    outside the range the servers use, so "the shim failed" is distinguishable from
    "the server failed" in a Desktop log.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $ServerScript,
    [Parameter(Mandatory)] [string] $EnvFile,
    [string] $NodeExe
)

$ErrorActionPreference = 'Stop'

function Write-ShimError([string] $Message) {
    # stderr only. See the header: stdout belongs to the MCP transport.
    [Console]::Error.WriteLine('[bconnect-shim] ' + $Message)
}

function Die([string] $Message) {
    Write-ShimError $Message
    exit 91
}

# --- Kill-on-close job object -------------------------------------------------
# Without this, killing the shim leaves node running: it holds the same inherited
# pipes and a decrypted API key in memory, and nothing owns it any more. A job object
# with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE makes the kernel terminate everything in the
# job when this process's last handle to it goes away -- including when this process is
# killed outright, which is the case no user-mode cleanup can cover.
#
# THIS PROCESS joins the job, not the child, and it joins BEFORE node is started.
# Assigning the CHILD afterwards leaves a window: node exists but is not yet in the
# job, and a kill landing in that window orphans it. That window is small and it is
# real -- an early test run left exactly one such node.exe behind, which is how it was
# found. A child created by a process already in a job is placed in that job by the
# kernel at creation time, so there is no window at all.
#
# Best-effort by design: if the type will not compile (constrained language mode, no
# csc), the shim says so on stderr and continues rather than refusing to start. A
# possibly-orphaned child is worse than nothing; a server that will not start at all
# is worse than that.
$script:JobHandle = [IntPtr]::Zero
$script:JobSelfAssigned = $false
function Initialize-KillOnCloseJob {
    try {
        if (-not ('BConnectShim.Job' -as [type])) {
            Add-Type -Namespace 'BConnectShim' -Name 'Job' -MemberDefinition @'
[DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpInfo, uint cbInfo);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
'@
        }
        $h = [BConnectShim.Job]::CreateJobObject([IntPtr]::Zero, $null)
        if ($h -eq [IntPtr]::Zero) { return }

        # JOBOBJECT_EXTENDED_LIMIT_INFORMATION. Only LimitFlags is set; the rest stays
        # zero. Size differs between 32- and 64-bit, so it is measured, not hard-coded.
        # sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION): 144 on x64, 112 on x86.
        $size  = if ([IntPtr]::Size -eq 8) { 144 } else { 112 }
        $buf   = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
        try {
            for ($i = 0; $i -lt $size; $i++) { [Runtime.InteropServices.Marshal]::WriteByte($buf, $i, 0) }
            # BasicLimitInformation.LimitFlags sits at offset 16 (after two LARGE_INTEGERs).
            [Runtime.InteropServices.Marshal]::WriteInt32($buf, 16, 0x2000)   # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            # 9 = JobObjectExtendedLimitInformation
            [void][BConnectShim.Job]::SetInformationJobObject($h, 9, $buf, $size)
        } finally {
            [Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
        }
        $script:JobHandle = $h
        # Join the job ourselves. Anything we spawn from here on is born inside it.
        if (-not [BConnectShim.Job]::AssignProcessToJobObject($h, [System.Diagnostics.Process]::GetCurrentProcess().Handle)) {
            # Nested jobs need Windows 8 / Server 2012 or newer. On anything older, or
            # if the caller's job forbids nesting, fall back to assigning the child
            # after it starts -- the small window is better than no protection.
            Write-ShimError 'could not join the kill-on-close job; falling back to assigning the child after start.'
            $script:JobSelfAssigned = $false
        } else {
            $script:JobSelfAssigned = $true
        }
    } catch {
        Write-ShimError ('could not create a kill-on-close job object (' + $_.Exception.Message +
                         '); the server will still start, but may outlive this shim if it is killed.')
    }
}

# --- Resolve node -------------------------------------------------------------
if (-not $NodeExe) {
    $c = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $c) { Die 'node.exe is not on PATH and -NodeExe was not supplied.' }
    $NodeExe = $c.Source
}
if (-not (Test-Path -LiteralPath $NodeExe))      { Die "node.exe not found at $NodeExe" }
if (-not (Test-Path -LiteralPath $ServerScript)) { Die "server entry point not found at $ServerScript -- the package is not built, or the configuration is stale." }
if (-not (Test-Path -LiteralPath $EnvFile))      { Die "credentials file not found at $EnvFile" }

# --- Decrypt ------------------------------------------------------------------
$envText = $null
try {
    if ($EnvFile -match '\.dpapi$') {
        Import-Module (Join-Path $PSScriptRoot 'Dpapi.psm1') -Force -DisableNameChecking
        $envText = Read-ProtectedEnvContent -Path $EnvFile
    } else {
        # Plaintext credentials. The shim is not required in this case -- the
        # configuration normally invokes node directly -- but fronting it works, and
        # the tests use this path to exercise everything except the decrypt step.
        $envText = Get-Content -LiteralPath $EnvFile -Raw
        Import-Module (Join-Path $PSScriptRoot 'Dpapi.psm1') -Force -DisableNameChecking
    }
} catch {
    Die ('could not read credentials: ' + $_.Exception.Message)
}

$vars = ConvertFrom-EnvText -Text $envText
$envText = $null
if ($vars.Count -eq 0) { Die "no KEY=value pairs found in $EnvFile" }

# --- Start node with the values in its environment block ----------------------
$exitCode = 91
try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName        = $NodeExe
    # ArgumentList is not available on .NET Framework's ProcessStartInfo, so the
    # command line is built by hand -- it contains the server path and nothing else.
    $psi.Arguments       = '"' + $ServerScript + '"'
    $psi.WorkingDirectory = (Split-Path -Parent $ServerScript)
    $psi.UseShellExecute = $false      # required for EnvironmentVariables, and gives handle inheritance
    # No RedirectStandardInput/Output/Error. The child inherits ours, which is the
    # whole point: Claude Desktop's pipes reach node untouched.
    $psi.RedirectStandardInput  = $false
    $psi.RedirectStandardOutput = $false
    $psi.RedirectStandardError  = $false

    # EnvironmentVariables starts as a copy of this process's environment (PATH,
    # SystemRoot, plus anything Claude Desktop put in the server's per-entry env
    # block, e.g. ALLOW_WRITE_OPERATIONS). Overlay the credentials on top.
    foreach ($k in $vars.Keys) { $psi.EnvironmentVariables[[string]$k] = [string]$vars[$k] }

    # Before Process.Start, deliberately -- see Initialize-KillOnCloseJob.
    Initialize-KillOnCloseJob

    $p = [System.Diagnostics.Process]::Start($psi)

    # Clear our own copies. The child has its own block now; these are dead weight
    # holding a secret in a process that is only going to sit in WaitForExit.
    foreach ($k in @($vars.Keys)) { $vars[$k] = $null }
    $vars = $null
    $psi.EnvironmentVariables.Clear()
    [GC]::Collect()

    # Only needed on the fallback path; on the normal path the child is already in the
    # job by inheritance and re-assigning it would fail harmlessly anyway.
    if ($script:JobHandle -ne [IntPtr]::Zero -and -not $script:JobSelfAssigned) {
        try { [void][BConnectShim.Job]::AssignProcessToJobObject($script:JobHandle, $p.Handle) } catch { }
    }

    $p.WaitForExit()
    $exitCode = $p.ExitCode
} catch {
    Die ('could not start ' + $NodeExe + ': ' + $_.Exception.Message)
}

exit $exitCode
