<#
    UserContext.psm1 -- which Windows context this process is in, and which of an
    installation's writes belong to a person rather than to the machine.

    WHY THIS EXISTS
    ---------------
    An MCP stdio server is a local process that the CLIENT APPLICATION starts, on
    the machine that application runs on. A customer with twenty administrators
    therefore needs this installed on twenty workstations, and hand-walking twenty
    people through a wizard is the work baramundi exists to remove. So the install
    has to be deployable by baramundi itself.

    Two things make a naive silent deployment actively wrong, and both are
    properties of the WINDOWS CONTEXT rather than of any parameter:

      1. Host configurations resolve to per-user paths -- {APPDATA}\Claude\...,
         {USERPROFILE}\.codex\config.toml, {PROJECT}\.vscode\mcp.json. A baramundi
         job runs as SYSTEM or a service account, whose %APPDATA% is
         C:\Windows\System32\config\systemprofile\AppData\Roaming. A silent run
         writing there produces files no client will ever read, AND REPORTS
         SUCCESS.

      2. DPAPI protection is CurrentUser scope, deliberately (see lib\Dpapi.psm1).
         A blob written by a service account is decryptable by that service
         account only, so every server launched by a real administrator fails to
         start with a decryption error.

    The answer is a two-stage install -- machine stage from the deployment tool,
    user stage in each administrator's own login -- and the thing that makes that
    answer safe is a REFUSAL rather than a warning. Get-PerUserWriteRefusal is
    that refusal, and it is the only implementation of it. Nothing else in this
    tree decides whether a context may write per-user state.

    HOW THE CONTEXT IS DETECTED, AND WHY IT IS DETECTED THAT WAY
    ------------------------------------------------------------
    Three signals, ORed, because each catches cases the others miss:

      * The well-known service SIDs S-1-5-18/19/20. Compared as SIDs, never as
         names: the names are localised, and a German-language Windows -- half of
         this product's market -- reports NT-AUTORITAET\SYSTEM, which no rule
         written against 'NT AUTHORITY\SYSTEM' will ever match.

      * %APPDATA% or %USERPROFILE% resolving under a config\systemprofile
         directory. This catches strictly more than the SID check: a process that
         has impersonated, a 32-bit process under SYSTEM (whose system profile is
         under SysWOW64, not System32), and any account whose profile was never
         loaded and which therefore inherited the system profile. It is also the
         signal that decides the OUTCOME rather than the identity -- the failure
         this refusal exists to prevent is defined by where the file lands.

      * %APPDATA% not set at all. A service account with no loaded profile has no
         per-user location to write to, whoever it is.

    And it FAILS SAFE. If the account cannot be determined, that is itself a
    reason: an unknown context is treated as not-per-user, so the refusal fires.
    The cost of a false refusal is one command line with -Stage; the cost of a
    false permit is a silent, green, useless install.

    WHAT IS NOT REFUSED
    -------------------
    The machine stage, which is the whole point of it. And the central/gateway
    shape, which stays fully silent-capable including its credential: HTTP clients
    hold no per-user state, the snippet targets write to install\out, which the
    machine owns, and plaintext-in-a-hardened-directory is not CurrentUser bound.
    The refusal is scoped to what a run would actually write, not to a mode.

    Tests: install\lib\Test-StageSplit.ps1
#>

Set-StrictMode -Version Latest

# The three well-known service SIDs a deployment tool actually runs jobs as.
# Values are the English names, used only for reporting; the KEYS are the rule.
$script:SERVICE_SIDS = [ordered]@{
    'S-1-5-18' = 'LocalSystem'
    'S-1-5-19' = 'LocalService'
    'S-1-5-20' = 'NetworkService'
}

# Both System32 and SysWOW64 carry a config\systemprofile, and which one a process
# sees depends on its bitness rather than on anything the operator chose. Matching
# the tail of the path rather than either prefix covers both, covers a non-C: system
# drive, and covers the redirected form a 32-bit PowerShell reports.
$script:SYSTEMPROFILE_PATTERN = '[\\/]config[\\/]systemprofile([\\/]|$)'

function Get-ProcessUserContext {
<#
.SYNOPSIS
    Whether this process has an interactive user profile to write into, and why
    not when it does not.

.DESCRIPTION
    Returns an ordered hashtable:

        Account      the Windows account name, for reporting only
        Sid          its SID, which is what the rule is written against
        WellKnown    'LocalSystem' | 'LocalService' | 'NetworkService' | $null
        AppData      the %APPDATA% this process resolved
        UserProfile  the %USERPROFILE% this process resolved
        IsPerUser    $true only when NO reason was found
        Reasons      every reason found, in the order found

    -AppData and -UserProfile exist so a test can present a context this machine
    is not in without needing to become SYSTEM. Passing them replaces the
    environment lookup and nothing else; the identity half is still read live.
#>
    [CmdletBinding()]
    param(
        [AllowEmptyString()] [AllowNull()] [string] $AppData,
        [AllowEmptyString()] [AllowNull()] [string] $UserProfile
    )

    if (-not $PSBoundParameters.ContainsKey('AppData'))     { $AppData     = $env:APPDATA }
    if (-not $PSBoundParameters.ContainsKey('UserProfile')) { $UserProfile = $env:USERPROFILE }

    $account      = $null
    $sid          = $null
    $lookupFailed = $false
    try {
        $id      = [Security.Principal.WindowsIdentity]::GetCurrent()
        $account = [string]$id.Name
        $sid     = [string]$id.User.Value
    } catch {
        $lookupFailed = $true
    }

    $wellKnown = $null
    if ($sid -and $script:SERVICE_SIDS.Contains($sid)) { $wellKnown = [string]$script:SERVICE_SIDS[$sid] }

    $reasons = @()
    if ($wellKnown) {
        $reasons += ("this process is running as $wellKnown ($sid), which has no interactive user profile")
    }
    if ($AppData -and $AppData -match $script:SYSTEMPROFILE_PATTERN) {
        $reasons += ("APPDATA resolves under the system profile: $AppData")
    }
    if ($UserProfile -and $UserProfile -match $script:SYSTEMPROFILE_PATTERN) {
        $reasons += ("USERPROFILE resolves under the system profile: $UserProfile")
    }
    if (-not $AppData) {
        $reasons += 'APPDATA is not set, so this process has no user profile loaded'
    }
    # Last, so the specific reasons are reported first when both apply. An identity
    # that cannot be read is a reason in its own right: the safe reading of "cannot
    # tell" is "not a user".
    if ($lookupFailed) {
        $reasons += 'the Windows account of this process could not be determined'
    }

    return [ordered]@{
        Account     = $(if ($account) { $account } else { '(unknown)' })
        Sid         = $(if ($sid) { $sid } else { '(unknown)' })
        WellKnown   = $wellKnown
        AppData     = $AppData
        UserProfile = $UserProfile
        IsPerUser   = ($reasons.Count -eq 0)
        Reasons     = @($reasons)
    }
}

function Test-HostTargetIsUserScoped {
<#
.SYNOPSIS
    A registry target whose configuration lives at a FIXED per-user location.

.DESCRIPTION
    The question host DETECTION asks. Because the path is fixed, the existence of
    its directory is evidence the client has been run by this user -- which is not
    true of a per-workspace target, whose path is whatever -ProjectDir says, and
    is meaningless for a snippet target, whose file this installer writes.
#>
    [CmdletBinding()]
    [OutputType([bool])]
    param([Parameter(Mandatory)] $Target)
    return [bool]([string]$Target.defaultPath -match '\{APPDATA\}|\{USERPROFILE\}')
}

function Test-HostTargetIsPerUser {
<#
.SYNOPSIS
    A registry target whose configuration belongs to a PERSON rather than to the
    machine.

.DESCRIPTION
    The user-scoped targets plus the per-workspace ones. A workspace is a folder a
    named developer opens; {OUT} is the only template that resolves to something
    the machine owns, and a snippet written there is a document, not a client's
    state.

    Deliberately a different question from Test-HostTargetIsUserScoped, and named
    differently for that reason. Detection wants "fixed per-user path"; the
    refusal wants "belongs to a person".
#>
    [CmdletBinding()]
    [OutputType([bool])]
    param([Parameter(Mandatory)] $Target)
    if (Test-HostTargetIsUserScoped -Target $Target) { return $true }
    return [bool]([string]$Target.defaultPath -match '\{PROJECT\}')
}

function Get-PerUserWriteRefusal {
<#
.SYNOPSIS
    The refusal, or $null. The only implementation of the rule.

.DESCRIPTION
    -Targets is what the run would write, as @( @{ id; path; target } ), where
    `target` is the lib\hosts.json entry. -ProtectCredentials is whether this run
    would store the credentials DPAPI-protected.

    Two clauses:

      1. A resolved path under a config\systemprofile directory is refused
         WHOEVER this process is. No MCP client reads
         C:\Windows\System32\config\systemprofile, so a run that writes there and
         reports success has produced the exact outcome this file exists to
         prevent -- and it does not become acceptable because the identity check
         happened to be inconclusive.

      2. Otherwise: a context with no interactive user profile may not write a
         per-user host configuration and may not write a CurrentUser DPAPI blob.

    A context with no interactive user profile that would do NEITHER is permitted.
    That is what keeps -Stage Machine usable from SYSTEM, which is its entire
    purpose, and what keeps the central/gateway shape fully silent-capable.

    Returns $null, or @{ Reason; Detail; Action; Context; Paths }.
#>
    [CmdletBinding()]
    param(
        [array] $Targets = @(),
        [bool]  $ProtectCredentials = $false,
        $Context = $null
    )

    if (-not $Context) { $Context = Get-ProcessUserContext }

    $systemProfile = @()
    $perUser       = @()
    foreach ($t in @($Targets)) {
        if (-not $t) { continue }
        $id   = [string]$t.id
        $path = ''
        if ($t.path) { $path = [string]$t.path }
        if ($path -and $path -match $script:SYSTEMPROFILE_PATTERN) {
            $systemProfile += ($id.PadRight(16) + $path)
            continue
        }
        if ($t.target -and (Test-HostTargetIsPerUser -Target $t.target)) {
            $perUser += ($id.PadRight(16) + $(if ($path) { $path } else { [string]$t.target.defaultPath }))
        }
    }

    $action = @(
        'Split the deployment into its two stages.',
        '    Install-BConnectMcp.ps1 -Stage Machine    from the deployment tool, once per machine',
        '    Install-BConnectMcp.ps1 -Stage User       in each administrator''s own login, once',
        'The machine stage places Node, the suite and the intended client list, and is',
        'permitted from this context. The user stage collects the credentials and writes',
        'that administrator''s client configurations.',
        'The exact command lines are in:  Get-Help .\Install-BConnectMcp.ps1 -Parameter Stage'
    )

    if ($systemProfile.Count) {
        return [ordered]@{
            Reason  = 'a host configuration would be written under the system profile, where no MCP client reads'
            Context = $Context
            Paths   = @($systemProfile)
            Detail  = @(
                ('account: ' + $Context.Account + '  (' + $Context.Sid + ')'),
                ('APPDATA: ' + $(if ($Context.AppData) { $Context.AppData } else { '(not set)' })),
                'these target(s) resolve under the system profile:'
            ) + @($systemProfile | ForEach-Object { '  ' + $_ }) + @(
                'A file there is not read by any client, and a run that wrote it would report',
                'success. That is the failure this refusal exists to prevent.'
            )
            Action  = $action
        }
    }

    if ($Context.IsPerUser) { return $null }
    if (-not $perUser.Count -and -not $ProtectCredentials) { return $null }

    $detail = @(
        ('account: ' + $Context.Account + '  (' + $Context.Sid + ')'),
        ('APPDATA: ' + $(if ($Context.AppData) { $Context.AppData } else { '(not set)' }))
    )
    $detail += @($Context.Reasons | ForEach-Object { '  ' + $_ })
    if ($perUser.Count) {
        $detail += 'per-user host configuration(s) this run would write:'
        $detail += @($perUser | ForEach-Object { '  ' + $_ })
    }
    if ($ProtectCredentials) {
        $detail += 'DPAPI credential protection is CurrentUser scope: a blob written from this'
        $detail += 'context is decryptable only by this account, so every server an administrator'
        $detail += 'launches would fail to start.'
    }

    return [ordered]@{
        Reason  = 'this process has no interactive user profile, and the run would write per-user state'
        Context = $Context
        Paths   = @($perUser)
        Detail  = $detail
        Action  = $action
    }
}

Export-ModuleMember -Function Get-ProcessUserContext, Test-HostTargetIsUserScoped,
                              Test-HostTargetIsPerUser, Get-PerUserWriteRefusal
