<#
    Secrets.psm1 -- the credential-handling half of the bConnect-MCP installer.

    This is a separate module for one reason: it is the part that must be right, and
    it is the part that cannot be exercised through the installer's own prompts
    (Read-Host -AsSecureString reads the console directly and ignores redirected
    stdin, so an end-to-end scripted test can never reach it). Pulling it out means
    the ACL hardening and the atomic write can be tested for real, against a real
    directory, without anyone typing a real secret.

    See install\lib\Test-Secrets.ps1 for those tests.
#>

Set-StrictMode -Version Latest

# Well-known SIDs, used instead of names so this works on non-English Windows.
$script:SID_SYSTEM         = 'S-1-5-18'
$script:SID_ADMINISTRATORS = 'S-1-5-32-544'
$script:SID_USERS          = 'S-1-5-32-545'
$script:SID_EVERYONE       = 'S-1-1-0'
$script:SID_AUTH_USERS     = 'S-1-5-11'

function Invoke-Icacls {
    param([string[]] $Arguments)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName               = 'icacls.exe'
    $psi.Arguments              = ($Arguments -join ' ')
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    return @{ Code = $p.ExitCode; Output = $out }
}

function Set-HardenedDirectoryAcl {
<#
.SYNOPSIS
    Break inheritance on a directory and grant it to SYSTEM, Administrators and one
    user only.

.DESCRIPTION
    Harden the DIRECTORY, not the file.

    A file-level ACL cannot hold here. Editors save by writing a temporary file and
    renaming it over the original, so the file the ACL was attached to stops
    existing and the replacement inherits the parent's ACL -- which on a repository
    directory means BUILTIN\Users:(RX), i.e. any local user can read the API key.
    Re-applying the ACL after every edit is a treadmill, not a fix. Making the
    parent directory restrictive means new files inherit the restriction instead,
    and it survives an atomic save.

    Two details that look like nits and are not:

      * The user grant is (M)odify, not (R,W). (R,W) omits DELETE, which the
        write-temp-then-rename save pattern needs. The editor's save then fails
        SILENTLY -- a credential edit appears to succeed and does not persist.

      * The Administrators ACE does not help a non-elevated session, because
        BUILTIN\Administrators is filtered out of a non-elevated token. That is why
        the current user is granted explicitly rather than relying on it.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        [string] $UserSid
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
    if (-not $UserSid) {
        $UserSid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
    }

    $quoted = '"' + $Path + '"'
    $steps = @(
        @($quoted, '/inheritance:r'),
        @($quoted, '/grant', ('*' + $script:SID_SYSTEM + ':(OI)(CI)(F)')),
        @($quoted, '/grant', ('*' + $script:SID_ADMINISTRATORS + ':(OI)(CI)(F)')),
        @($quoted, '/grant', ('*' + $UserSid + ':(OI)(CI)(M)')),
        @($quoted, '/remove:g', ('*' + $script:SID_USERS))
    )
    foreach ($s in $steps) {
        $r = Invoke-Icacls $s
        if ($r.Code -ne 0) {
            throw ('icacls ' + ($s -join ' ') + ' failed (' + $r.Code + '): ' + $r.Output.Trim())
        }
    }
}

function Get-BroadAccessAce {
<#
.SYNOPSIS
    Return any ACE on a path that grants access to a broad group.

.DESCRIPTION
    An empty result is the pass condition. Used on the directory right after
    hardening it, and on the credentials file right after writing it -- because the
    whole point is that the file INHERITED the restriction, and inheritance is worth
    checking rather than assuming.
#>
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $Path)

    $broad = @($script:SID_USERS, $script:SID_EVERYONE, $script:SID_AUTH_USERS)
    $offenders = @()
    foreach ($ace in (Get-Acl -LiteralPath $Path).Access) {
        $sid = $null
        try   { $sid = $ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }
        catch { $sid = $ace.IdentityReference.Value }
        if ($broad -contains $sid) {
            $offenders += ($ace.IdentityReference.Value + ' -> ' + $ace.FileSystemRights + ' (' + $ace.AccessControlType + ')')
        }
    }
    # Comma operator: without it PowerShell unwraps a single-element array into a
    # bare string, and the caller's $offenders[0] silently becomes a character.
    return ,$offenders
}

function Write-SecretFileAtomic {
<#
.SYNOPSIS
    Write text to a file inside a hardened directory, via the same write-temp-then-
    replace pattern an editor uses.

.DESCRIPTION
    Deliberately atomic. The replace is the exact operation that defeats a
    file-level ACL, so performing it here means the directory-level protection is
    demonstrated rather than claimed: whatever ACL the final file ends up with is
    the one a real editor save would have produced.

    UTF-8 without a BOM. Node's --env-file parser treats a leading BOM as part of
    the first key name, so a BOM would silently break BCONNECT_BASE_URL.

    The temporary file is created inside the target directory (so it inherits the
    same hardened ACL and never sits in %TEMP% in clear text) and is removed in a
    finally block.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [AllowEmptyString()] [string] $Content
    )

    $dir = Split-Path -Parent $Path
    $tmp = Join-Path $dir ('.' + [System.IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($tmp, $Content, $utf8NoBom)
        [System.IO.File]::Copy($tmp, $Path, $true)
    } finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
}

function ConvertFrom-SecureStringPlain {
<#
.SYNOPSIS
    Unprotect a SecureString for the moment it has to be written or sent.

.DESCRIPTION
    The BSTR is zeroed in a finally block. The resulting String is still a managed,
    immutable object that cannot be wiped on demand -- that is a limitation of the
    platform, not of this function. Callers should null their reference as soon as
    they are done and keep the window as short as possible.
#>
    [CmdletBinding()]
    param([System.Security.SecureString] $Secure)

    if ($null -eq $Secure) { return $null }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try   { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# -----------------------------------------------------------------------------
# SEC-7 -- the gateway's bearer token
#
# The gateway used to have no authentication at all, and the shipped compose file
# asserted MCP_ALLOW_NO_AUTH=true on the operator's behalf, so the artifact
# disarmed its own fail-closed guard. It now authenticates callers with a shared
# bearer token -- and the reason these three functions exist is that a secure
# default nobody can configure gets turned off by the first operator who hits
# friction. So the installer generates the token, writes it into the credentials
# file that is ALREADY hardened and already read by the gateway launcher, and
# prints it once. Nothing to invent, nothing to remember, no second file.
# -----------------------------------------------------------------------------

$script:GATEWAY_TOKEN_KEY = 'MCP_GATEWAY_AUTH_TOKEN'

function New-GatewayAuthToken {
<#
.SYNOPSIS
    Generate a gateway bearer token: 32 cryptographically random bytes, base64url.

.DESCRIPTION
    RNGCryptoServiceProvider, not Get-Random. Get-Random is a seeded
    System.Random -- fine for shuffling a list, not for a credential that is the
    only thing between a caller and a bMS service credential.

    base64url (no '+', '/' or '=') so the value survives an HTTP header, a URL,
    a YAML scalar, a .env line and a shell command line without quoting. 32 bytes
    is 43 characters, comfortably over the gateway's 24-character minimum.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([int] $Bytes = 32)

    $buf = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buf) } finally { $rng.Dispose() }
    return ([Convert]::ToBase64String($buf) -replace '\+', '-' -replace '/', '_' -replace '=', '')
}

function Get-GatewayAuthTokenBlock {
<#
.SYNOPSIS
    The commented MCP_GATEWAY_AUTH_TOKEN stanza, as an array of lines.
.DESCRIPTION
    Separate so the same text is produced whether the token is written with a
    fresh env file or appended to an existing one -- an operator who opens this
    file six months from now gets the same explanation either way.
#>
    [CmdletBinding()]
    [OutputType([string[]])]
    param([Parameter(Mandatory)] [string] $Token)

    return @(
        '# SEC-7 -- the HTTP gateway''s bearer token. Every call to',
        '#   POST http://<bind>:<port>/<domain>/mcp',
        '# must carry:  Authorization: Bearer <this value>',
        '# Without it the gateway answers 401. /health is exempt so probes work.',
        '#',
        '# The stdio servers ignore this variable, so it is harmless here and it',
        '# means the gateway launcher gets it from the file it already reads.',
        '#',
        '# ROTATING IT: put two values here, comma-separated, "<new>,<old>".',
        '# Both are accepted, so clients can move across without downtime; drop',
        '# the old one and restart once they have. Or re-run the installer with',
        '# -RotateGatewayToken, which does exactly this for you.',
        ($script:GATEWAY_TOKEN_KEY + '=' + $Token)
    )
}

function Get-GatewayAuthTokenFromEnvText {
<#
.SYNOPSIS
    The token currently in an env file's text, or $null.
.DESCRIPTION
    Text in, value out -- no file access -- so this works identically against a
    plaintext file and against the decrypted-in-memory contents of a .dpapi one.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Text)

    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -match ('^\s*' + [regex]::Escape($script:GATEWAY_TOKEN_KEY) + '\s*=\s*(.*)$')) {
            $v = $matches[1].Trim().Trim('"')
            if ($v) { return $v }
        }
    }
    return $null
}

function Set-GatewayAuthTokenInEnvText {
<#
.SYNOPSIS
    Ensure env-file text carries a gateway token; return the new text and the token.

.DESCRIPTION
    Three cases, and the reuse path is the one that matters: an existing
    installation predates this feature, so its credentials file has no token. The
    installer must be able to add one WITHOUT rewriting the file it was told to
    reuse and without the operator re-typing a bMS password.

      -Rotate absent, no token present   append a freshly generated one
      -Rotate absent, token present      leave it exactly as it is
      -Rotate present                    generate a new one and keep the old one
                                         alongside it as "<new>,<old>", which is
                                         the gateway's rotation window: every
                                         client keeps working until it is moved.

    Returns a hashtable: Text, Token (the ACTIVE one, i.e. what clients should be
    given), Changed, and Previous.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string] $Text,
        [switch] $Rotate,
        [string] $Token
    )

    $existing = Get-GatewayAuthTokenFromEnvText -Text $Text
    # A rotation window already in the file ("<new>,<old>") -- only the first
    # value is the active one; a second rotation must not accumulate a third.
    $existingActive = if ($existing) { ($existing -split ',')[0].Trim() } else { $null }

    if ($existingActive -and -not $Rotate) {
        return @{ Text = $Text; Token = $existingActive; Changed = $false; Previous = $null }
    }

    if (-not $Token) { $Token = New-GatewayAuthToken }
    $value = if ($Rotate -and $existingActive) { $Token + ',' + $existingActive } else { $Token }

    if ($existing) {
        # Replace in place: keep the surrounding comments the operator may have
        # edited, and keep the file's line order stable in a diff.
        $pattern = '(?m)^\s*' + [regex]::Escape($script:GATEWAY_TOKEN_KEY) + '\s*=.*$'
        $newText = [regex]::Replace($Text, $pattern, ($script:GATEWAY_TOKEN_KEY + '=' + $value), 1)
    } else {
        $eol = if ($Text -match "`r`n") { "`r`n" } else { "`n" }
        $body = if ($Text -and -not $Text.EndsWith("`n")) { $Text + $eol } else { $Text }
        $newText = $body + $eol + ((Get-GatewayAuthTokenBlock -Token $value) -join $eol) + $eol
    }

    return @{ Text = $newText; Token = $Token; Changed = $true; Previous = $existingActive }
}

function ConvertTo-EnvValueLiteral {
<#
.SYNOPSIS
    Render a value for the right-hand side of a KEY=value line.

.DESCRIPTION
    Node's .env parser treats an unquoted '#' as the start of a comment and trims
    surrounding whitespace, so anything that would be mangled has to be quoted.

    Exported and shared rather than duplicated: New-EnvFileContent writes a whole
    file, Merge-EnvText edits one line of an existing one, and a value that came
    back out of one must go back into the other unchanged. Two copies of this rule
    would eventually disagree, and the symptom would be a truncated API key.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([AllowEmptyString()] [AllowNull()] [string] $Value)

    if ($null -eq $Value) { return '' }
    if ($Value -match '[#"\r\n]' -or $Value -ne $Value.Trim()) {
        return '"' + ($Value -replace '"', '\"') + '"'
    }
    return $Value
}

function Merge-EnvText {
<#
.SYNOPSIS
    Read-modify-write on credentials-file TEXT: change the named keys, leave
    everything else byte-identical.

.DESCRIPTION
    This is the whole of the reconfigure principle, in one function:

        an option the operator is not asked about on this run keeps the value it has.

    The installer used to collect answers into fresh variables and then call
    New-EnvFileContent, which builds the file from scratch and therefore emits only
    the keys it was handed. Measured, a re-run that changed the base URL dropped
    BCONNECT_CA_CERT_PATH, BCONNECT_V11_USERNAME, BCONNECT_V11_PASSWORD,
    MCP_GATEWAY_AUTH_TOKEN and every key the operator had added by hand -- 14 keys
    in, 9 keys out, silently. Editing lines in place removes that failure by
    construction rather than by remembering to pass one more parameter.

    Set-GatewayAuthTokenInEnvText is the existing proof that this shape works and
    is idempotent (Test-Secrets.ps1: "re-running does NOT churn the token"). This
    is the same move, generalised to any key.

    Rules:
      * A key already present is replaced IN PLACE, so comments, blank lines and
        ordering survive and a diff stays small.
      * Duplicate lines for the same key are collapsed onto the first one. Node's
        parser is last-wins, so leaving a later duplicate behind would mean the
        value written is not the value read.
      * A key not present is appended at the end, under a stable comment header --
        stable, and with no timestamp in it, so applying the same change twice
        produces byte-identical text.
      * -Remove deletes every line for a key. A $null value in -Changes does the
        same thing, which is what lets a caller express "unset this" in the same
        hashtable as "set that".
      * Nothing is printed. The values passing through here are credentials.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string] $Text,
        [System.Collections.IDictionary] $Changes,
        [string[]] $Remove = @()
    )

    $sets    = New-Object 'System.Collections.Specialized.OrderedDictionary'
    $deletes = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($k in $Remove) { if ($k) { [void]$deletes.Add($k) } }
    if ($Changes) {
        foreach ($k in @($Changes.Keys)) {
            if ($null -eq $Changes[$k]) { [void]$deletes.Add([string]$k) }
            else { $sets[[string]$k] = [string]$Changes[$k] }
        }
    }
    if ($sets.Count -eq 0 -and $deletes.Count -eq 0) { return $Text }

    $eol   = if ($Text -match "`r`n") { "`r`n" } else { "`n" }
    $lines = @($Text -split "`r?`n")
    # -split on the last line of a text ending in a newline yields a trailing empty
    # element. Remember that so the result ends the same way it started.
    $trailingNewline = ($lines.Count -gt 0 -and $lines[-1] -eq '')
    if ($trailingNewline) { $lines = @($lines[0..($lines.Count - 2)]) }

    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    $outLines = New-Object System.Collections.ArrayList
    foreach ($line in $lines) {
        $key = $null
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') { $key = $Matches[1] }
        if ($key -and $deletes.Contains($key)) { continue }
        if ($key -and $sets.Contains($key)) {
            if ($seen.Contains($key)) { continue }   # collapse a duplicate onto the first
            [void]$seen.Add($key)
            [void]$outLines.Add($key + '=' + (ConvertTo-EnvValueLiteral $sets[$key]))
            continue
        }
        [void]$outLines.Add($line)
    }

    $missing = @($sets.Keys | Where-Object { -not $seen.Contains($_) })
    if ($missing.Count) {
        if ($outLines.Count -and $outLines[-1] -ne '') { [void]$outLines.Add('') }
        if (-not ($Text -match '(?m)^# Added by a later installer run\.')) {
            [void]$outLines.Add('# Added by a later installer run.')
        }
        foreach ($k in $missing) { [void]$outLines.Add($k + '=' + (ConvertTo-EnvValueLiteral $sets[$k])) }
    }

    $result = ($outLines -join $eol)
    if ($trailingNewline) { $result = $result + $eol }
    return $result
}

function Merge-EnvMap {
<#
.SYNOPSIS
    The same read-modify-write, on a parsed map instead of on text.

.DESCRIPTION
    For callers that hold a map (from Read-BConnectEnvMap) and want to reason about
    the RESULT of a change before writing it -- the installation record's view of
    "what will be true after this run", and the drift report's "what is true now".

    Merge-EnvText is what actually writes, because only the text carries the
    comments. This exists so a caller never has to rebuild a map by hand and get
    the "absent means keep" rule subtly wrong.
#>
    [CmdletBinding()]
    param(
        [System.Collections.IDictionary] $Existing,
        [System.Collections.IDictionary] $Changes,
        [string[]] $Remove = @()
    )

    $out = New-Object 'System.Collections.Specialized.OrderedDictionary'
    if ($Existing) { foreach ($k in @($Existing.Keys)) { $out[$k] = $Existing[$k] } }
    if ($Changes) {
        foreach ($k in @($Changes.Keys)) {
            if ($null -eq $Changes[$k]) { if ($out.Contains($k)) { $out.Remove($k) } }
            else { $out[[string]$k] = [string]$Changes[$k] }
        }
    }
    foreach ($k in $Remove) { if ($k -and $out.Contains($k)) { $out.Remove($k) } }
    return $out
}

function New-EnvFileContent {
<#
.SYNOPSIS
    Build the text of the shared bconnect.env file.

.DESCRIPTION
    Separate from writing it so the layout can be asserted in a test with dummy
    values -- including the three things that are easy to get wrong and invisible
    when wrong:

      * BCONNECT_SKIP_CONNECTIVITY_CHECK must NOT be present. It was written
        unconditionally to work around a default probe path that omitted the API
        module segment; mcp-core's default is now /endpoints/v2.0/Endpoints and
        the workaround is obsolete. Leaving it in place is not neutral: the same
        flag suppresses the startup release gate, so an installation against a
        bMS older than the suite supports would start clean and fail per call.

      * ALLOW_WRITE_OPERATIONS must NOT be present. This file is shared by every
        configured server, so setting it here would unlock writes everywhere at
        once. The write gate belongs in the per-server env block of the host's
        own MCP configuration, where it can be scoped to one server.

      * A value containing '#' or leading/trailing whitespace has to be quoted, or
        Node's --env-file parser will truncate it at the comment marker.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $BaseUrl,
        [string] $ApiKey,
        [string] $BasicUser,
        [string] $BasicPass,
        [string] $V11User,
        [string] $V11Pass,
        [string] $CaCertPath,
        [string] $GatewayAuthToken
    )

    # One quoting rule, shared with Merge-EnvText, so a value read back out of a
    # file goes back into it unchanged. See ConvertTo-EnvValueLiteral.
    function Format-EnvValue([string] $v) { return (ConvertTo-EnvValueLiteral $v) }

    $L = New-Object System.Collections.ArrayList
    $add = {
        param([string] $s)
        [void]$L.Add($s)
    }

    & $add '# bConnect-MCP credentials. Written by install\Install-BConnectMcp.ps1.'
    & $add '#'
    & $add '# This file lives outside the repository working tree on purpose, in a'
    & $add '# directory whose ACL is hardened so that files created here inherit the'
    & $add '# restriction and survive an editor''s write-temp-then-rename save.'
    & $add '#'
    & $add '# It is loaded by "node --env-file=<this path>", an argument your MCP host''s'
    & $add '# configuration passes on the server command line. Do NOT rely on a .env next'
    & $add '# to a server: dotenv.config() resolves .env from process.cwd(), and an MCP'
    & $add '# host spawns servers with its own working directory, so such a file is'
    & $add '# silently ignored.'
    & $add ''
    & $add ('BCONNECT_BASE_URL=' + (Format-EnvValue $BaseUrl))
    if ($GatewayAuthToken) {
        & $add ''
        # NOT $l: PowerShell variable names are case-insensitive, so $l would
        # rebind the $L accumulator this function appends to, and the next & $add
        # would fail with "[String] does not contain a method named 'Add'".
        foreach ($tokenLine in (Get-GatewayAuthTokenBlock -Token $GatewayAuthToken)) { & $add $tokenLine }
        & $add ''
    }
    if ($ApiKey) {
        & $add ('BCONNECT_API_KEY=' + (Format-EnvValue $ApiKey))
    } else {
        & $add ('BCONNECT_USERNAME=' + (Format-EnvValue $BasicUser))
        & $add ('BCONNECT_PASSWORD=' + (Format-EnvValue $BasicPass))
    }
    if ($V11User) {
        & $add ''
        & $add '# bConnect v1.1 (Basic only -- v1.1 does not accept an API key).'
        & $add ('BCONNECT_V11_USERNAME=' + (Format-EnvValue $V11User))
        & $add ('BCONNECT_V11_PASSWORD=' + (Format-EnvValue $V11Pass))
    }
    if ($CaCertPath) {
        & $add ''
        & $add ('BCONNECT_CA_CERT_PATH=' + (Format-EnvValue $CaCertPath))
    }
    & $add ''
    & $add '# BCONNECT_SKIP_CONNECTIVITY_CHECK is deliberately absent, and so is'
    & $add '# BCONNECT_RELEASE. The first disabled the startup probe to work around a'
    & $add '# default health path that omitted the API module segment; that default is'
    & $add '# corrected upstream, and the same flag also suppresses the check that the'
    & $add '# connected bMS is a release this suite supports. The second no longer'
    & $add '# exists: the release is verified at startup, not configured.'
    & $add ''
    & $add '# Audit + rate limiting.'
    & $add 'BCONNECT_AUDIT_LEVEL=all'
    & $add 'BCONNECT_RATE_LIMIT_ENABLED=true'
    & $add 'BCONNECT_RATE_LIMIT_MAX_REQUESTS=100'
    & $add 'BCONNECT_RATE_LIMIT_WINDOW_MS=60000'
    & $add ''
    & $add 'MCP_TRANSPORT=stdio'
    & $add ''
    & $add '# ALLOW_WRITE_OPERATIONS is deliberately absent. This file is shared by'
    & $add '# every configured server, so setting it here would unlock writes in all'
    & $add '# of them at once. The write gate belongs in the per-server env block of'
    & $add '# your MCP host''s own configuration file, where it can be scoped to one'
    & $add '# server. The installer prints the path it wrote for each host it configured.'

    return (($L -join "`r`n") + "`r`n")
}

Export-ModuleMember -Function Set-HardenedDirectoryAcl, Get-BroadAccessAce, Write-SecretFileAtomic,
                              ConvertFrom-SecureStringPlain, New-EnvFileContent,
                              ConvertTo-EnvValueLiteral, Merge-EnvText, Merge-EnvMap,
                              New-GatewayAuthToken, Get-GatewayAuthTokenBlock,
                              Get-GatewayAuthTokenFromEnvText, Set-GatewayAuthTokenInEnvText
