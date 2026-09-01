<#
.SYNOPSIS
    Register (or remove) the per-user follow-up that opens the bConnect-MCP
    configuration GUI once, at each administrator's next logon.

.DESCRIPTION
    Step 3 of the baramundi software package. Runs as SYSTEM, after the machine
    stage.

    WHY A PER-USER FOLLOW-UP IS NEEDED AT ALL
    -----------------------------------------
    The machine stage installs software and records which client applications are
    intended to be configured. It writes no per-user path and collects no
    credential, because a baramundi job runs as SYSTEM, whose %APPDATA% is
    C:\Windows\System32\config\systemprofile\AppData\Roaming, and because DPAPI
    protection is CurrentUser scope. After the machine stage, nobody can use the
    product yet. Something has to bring each administrator to the second half, in
    that administrator's own login, exactly once.

    WHY ACTIVE SETUP
    ----------------
    Windows runs an Active Setup component's StubPath once per user, at that
    user's first logon after the component's Version increased, and records
    completion under that user's own HKCU. That is the shape of the problem:
    machine-installed, one action per person, must not repeat.

    HKLM\...\Run does not solve it -- it fires at every logon of every user,
    forever, and making it fire once per person means adding a per-user marker and
    the logic to check it, which is Active Setup reimplemented by hand and less
    well.

    A baramundi job running in the logged-on user's context is the more native
    answer where the bMS version offers it; see README.md, pattern A. This script
    is the answer that needs nothing but the endpoint.

    WHAT THE STUBPATH DOES, AND WHAT IT DELIBERATELY DOES NOT
    ---------------------------------------------------------
    It starts install\Start-BConnectConfig.cmd in manage mode -- the existing
    launcher shim, which repairs PATH so node resolves and then starts the
    existing configuration GUI. It passes NO flag selecting a first-run state:
    the GUI decides that by reading the installation record, and a flag here would
    make that condition have two implementations, one deciding and one asserting.

    It starts the GUI DETACHED and returns immediately. Active Setup runs
    synchronously during logon; a StubPath that waits holds up the desktop for as
    long as the administrator takes to type an API key.

    KNOWN COSTS
    -----------
      * Active Setup is long-standing but undocumented. It is widely relied on; it
        is not contractual.
      * It fires for every user who logs on, not only administrators. On a
        workstation dedicated to one administrator that is a non-issue; on a
        shared server, prefer pattern A.
      * It runs before the shell has finished starting, so the window can appear
        behind other windows.

.PARAMETER InstallDir
    Where the setup program put the product. Defaults to
    %ProgramFiles%\baramundi\bConnect-MCP, which is DefaultDirName in
    packaging\bconnect-mcp.iss. Pass it if the package overrode the install
    directory.

.PARAMETER Remove
    Remove the component instead of registering it. Windows leaves each user's
    HKCU completion record behind; that is harmless, and removing it would mean
    walking every loaded and unloaded profile.

.PARAMETER Version
    The component version, in Active Setup's comma-separated form. Defaults to the
    suite version read from <InstallDir>\package.json, converted. Raising it makes
    the StubPath run once more for every user, which is what a release that
    changes the configuration GUI needs.

.EXAMPLE
    powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\Register-FinishSetupPrompt.ps1

.EXAMPLE
    .\Register-FinishSetupPrompt.ps1 -Remove
    The uninstall counterpart. Run it before, or as part of, removing the software.

.NOTES
    Exit codes: 0 registered or removed, 1 refused with the reason named.
    Requires administrator rights; HKLM\SOFTWARE is not writable otherwise.
#>
[CmdletBinding()]
param(
    [string] $InstallDir,
    [switch] $Remove,
    [string] $Version
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# The component GUID is AppId from packaging\bconnect-mcp.iss. Reusing it is
# deliberate: the product has one identity, and an operator who finds either key
# can tell what wrote the other.
$ComponentGuid = '{E57A7E00-0000-4000-8000-000000000023}'
$ComponentName = 'bConnect-MCP finish setup'
$ActiveSetupKey = 'HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components\' + $ComponentGuid

function Fail {
    param([string] $Message, [string[]] $Remedy)
    Write-Host ''
    Write-Host ('  [FAIL] ' + $Message) -ForegroundColor Red
    foreach ($r in $Remedy) { Write-Host ('         ' + $r) -ForegroundColor Yellow }
    Write-Host ''
    exit 1
}

function Say {
    param([string] $Message)
    Write-Host ('  ' + $Message)
}

# -----------------------------------------------------------------------------
# Elevation. Checked rather than discovered halfway through, so a failure names
# the cause instead of surfacing as an access-denied on a registry path.
# -----------------------------------------------------------------------------
$identity  = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail 'This script writes under HKLM and requires administrator rights.' @(
        'Run it as SYSTEM from the baramundi job, or from an elevated PowerShell.'
    )
}

# -----------------------------------------------------------------------------
# Remove
# -----------------------------------------------------------------------------
if ($Remove) {
    if (Test-Path -LiteralPath $ActiveSetupKey) {
        Remove-Item -LiteralPath $ActiveSetupKey -Recurse -Force
        Say ('removed: ' + $ActiveSetupKey)
    } else {
        Say ('not present, nothing to remove: ' + $ActiveSetupKey)
    }
    Write-Host ''
    Write-Host '  Each user who already ran the follow-up keeps a completion record under'
    Write-Host '  their own HKCU. It is inert, and removing it would mean walking every'
    Write-Host '  profile on this machine, loaded or not.'
    Write-Host ''
    exit 0
}

# -----------------------------------------------------------------------------
# Locate the shim. The StubPath must point at something that exists now, because
# a StubPath that fails at logon fails silently for every user on the machine.
# -----------------------------------------------------------------------------
if (-not $InstallDir) {
    $InstallDir = Join-Path ${env:ProgramFiles} 'baramundi\bConnect-MCP'
}
$InstallDir = $InstallDir.TrimEnd('\')

$Shim = Join-Path $InstallDir 'install\Start-BConnectConfig.cmd'
if (-not (Test-Path -LiteralPath $Shim)) {
    Fail ('The launcher shim was not found: ' + $Shim) @(
        'This step runs after the setup program and after the machine stage.',
        'Check that step 1 succeeded, or pass -InstallDir if the package overrode',
        'the installation directory.'
    )
}

# -----------------------------------------------------------------------------
# Version. Active Setup compares the HKLM value with the user's HKCU value and
# runs the StubPath when HKLM is higher or HKCU is absent. The form is
# comma-separated numbers; a dotted version is not compared correctly.
# -----------------------------------------------------------------------------
if (-not $Version) {
    $pkgJson = Join-Path $InstallDir 'package.json'
    if (-not (Test-Path -LiteralPath $pkgJson)) {
        Fail ('No -Version was given and the suite manifest was not found: ' + $pkgJson) @(
            'Pass -Version in Active Setup form, for example: -Version 26,1,8'
        )
    }
    $suiteVersion = (Get-Content -LiteralPath $pkgJson -Raw | ConvertFrom-Json).version
    if (-not $suiteVersion) {
        Fail ('The suite manifest declares no version: ' + $pkgJson) @(
            'Pass -Version in Active Setup form, for example: -Version 26,1,8'
        )
    }
    # 26.1.8 -> 26,1,8. A pre-release suffix (1.2.3-rc.1) is truncated at the
    # first non-digit of the segment that carries it, because Active Setup
    # compares numbers and has nowhere to put the rest.
    $Version = (($suiteVersion.Split('.') | ForEach-Object { $_ -replace '\D.*$', '' }) |
                Where-Object { $_ -ne '' }) -join ','
}

if ($Version -notmatch '^\d+(,\d+)*$') {
    Fail ('Not an Active Setup version: ' + $Version) @(
        'The form is comma-separated numbers, for example 26,1,8. A dotted version',
        'is stored but never compared correctly, so the follow-up would run at every',
        'logon or at none.'
    )
}

# -----------------------------------------------------------------------------
# The StubPath.
#
#   cmd /c start "" /min ...   returns as soon as the process is started. Active
#                              Setup runs synchronously during logon, so a
#                              StubPath that waits holds up the desktop.
#   ""                         is start's title argument. Omitting it makes start
#                              treat the quoted path as the title and open a
#                              console instead of the program.
#   /min                       keeps the console the shim runs in out of the way.
#                              The GUI window itself is not minimised.
# -----------------------------------------------------------------------------
$StubPath = 'cmd.exe /c start "" /min "' + $Shim + '" manage'

if (-not (Test-Path -LiteralPath $ActiveSetupKey)) {
    New-Item -Path $ActiveSetupKey -Force | Out-Null
}
New-ItemProperty -LiteralPath $ActiveSetupKey -Name '(Default)'  -Value $ComponentName -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath $ActiveSetupKey -Name 'StubPath'   -Value $StubPath      -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath $ActiveSetupKey -Name 'Version'    -Value $Version       -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath $ActiveSetupKey -Name 'IsInstalled' -Value 1             -PropertyType DWord  -Force | Out-Null
New-ItemProperty -LiteralPath $ActiveSetupKey -Name 'Locale'     -Value '*'            -PropertyType String -Force | Out-Null

Write-Host ''
Say ('registered: ' + $ActiveSetupKey)
Say ('  version   ' + $Version)
Say ('  stubpath  ' + $StubPath)
Write-Host ''
Write-Host '  At the next logon of a user who has not run it, Windows starts the bConnect-MCP'
Write-Host '  configuration window once. That window collects the credentials and configures'
Write-Host '  that account''s client applications -- the half of the install a SYSTEM job'
Write-Host '  cannot do. Until it has run for an administrator, that administrator has no'
Write-Host '  working installation.'
Write-Host ''
Write-Host '  It fires for every user who logs on, not only administrators. On a shared'
Write-Host '  server, use a baramundi job in the logged-on user context instead and run'
Write-Host '  this script with -Remove. See README.md, section 8.'
Write-Host ''
exit 0
