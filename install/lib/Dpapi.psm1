<#
    Dpapi.psm1 -- opt-in DPAPI protection for the bConnect-MCP credentials file.

    WHAT THIS BUYS YOU, precisely
    -----------------------------
    Today the credentials sit in plaintext at secrets\bconnect.env, protected by a
    directory ACL. An ACL is an attribute of the file on THIS volume; it does not
    travel. Copy the file to a share, back it up, drop it in a zip, or `git add` it
    by accident and the API key is readable by anyone who ends up with the copy.

    DPAPI at CurrentUser scope fixes exactly that and nothing more. The ciphertext
    is worthless anywhere except inside this user profile on this machine.

    WHAT IT DOES NOT BUY YOU
    ------------------------
    It does not stop malware running as you. Anything executing in your session can
    call Unprotect itself -- it is the same API, available to every process with your
    token. This is a property of DPAPI, not a shortcoming of this implementation, and
    the installer says so in one line rather than implying more.

    THE ENTROPY IS NOT A SECOND SECRET
    ----------------------------------
    ProtectedData's optionalEntropy scopes a blob to an application: a different
    program calling Unprotect with no entropy (or different entropy) gets a
    CryptographicException rather than your API key. It is an application constant,
    derived below from a fixed string. It lives in this file, in the open. It is not a
    password, it adds nothing against anyone holding this source, and it is not
    presented as if it did.

    WHY A LAUNCHER SHIM EXISTS
    --------------------------
    Claude Desktop starts each server as `node --env-file=<path> ...`. Node cannot
    read a DPAPI blob. So when protection is on, the configuration launches
    lib\Start-BConnectServer.ps1 instead; it decrypts in memory and spawns node with
    the values in the CHILD PROCESS ENVIRONMENT BLOCK -- never as an argument, never
    through a temp file. See that script for the handle-inheritance details.

    Tests: install\lib\Test-CredentialProtection.ps1
#>

Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Security | Out-Null

# Write-SecretFileAtomic lives next door.
#
# Deliberately NOT -Force. Import-Module -Force REMOVES every existing instance of the
# module before re-importing, and a nested import re-imports into THIS module's scope
# -- so a -Force here silently unloads the copy the installer imported at top level a
# few lines earlier, and Set-HardenedDirectoryAcl / ConvertFrom-SecureStringPlain stop
# resolving in the caller halfway through Step 4. (Observed, not theorised.) Without
# -Force an already-loaded Secrets is reused, and a fresh session loads it here.
Import-Module (Join-Path $PSScriptRoot 'Secrets.psm1') -DisableNameChecking

$script:ProtectedFileSuffix = '.dpapi'
$script:EntropyPhrase       = 'bConnect-MCP/credential-protection/v1'

function Get-BConnectEntropy {
<#
.SYNOPSIS
    The application entropy passed to ProtectedData.Protect/Unprotect.

.DESCRIPTION
    A fixed 32-byte application constant, not a secret. See the module header.
    Defined in exactly one place so the installer, the wizard and the launcher shim
    cannot drift apart -- a mismatch here would look like "the credentials file is
    corrupt" and would be miserable to diagnose.
#>
    [CmdletBinding()]
    [OutputType([byte[]])]
    param()
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($script:EntropyPhrase))
    } finally {
        $sha.Dispose()
    }
}

function Protect-BConnectText {
<#
.SYNOPSIS
    DPAPI-protect a string at CurrentUser scope, returning base64 ciphertext.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Text)

    $plain = $null
    try {
        $plain  = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $cipher = [System.Security.Cryptography.ProtectedData]::Protect(
                      $plain, (Get-BConnectEntropy),
                      [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        return [Convert]::ToBase64String($cipher)
    } finally {
        # The managed String itself cannot be wiped; the byte copy can be, and is.
        if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
    }
}

function Unprotect-BConnectText {
<#
.SYNOPSIS
    Reverse of Protect-BConnectText.

.DESCRIPTION
    Throws with an explanation rather than a bare CryptographicException, because
    the three realistic causes (different user, different machine, hand-edited file)
    all produce the same opaque error otherwise.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [string] $Base64)

    $cipher = $null
    try   { $cipher = [Convert]::FromBase64String($Base64) }
    catch { throw 'The protected credentials file is not valid base64. It has been edited or truncated.' }

    $plain = $null
    try {
        $plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
                     $cipher, (Get-BConnectEntropy),
                     [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        return [System.Text.Encoding]::UTF8.GetString($plain)
    } catch [System.Security.Cryptography.CryptographicException] {
        throw ("DPAPI could not decrypt the credentials. A CurrentUser blob is readable only by " +
               "the Windows account that created it, on the machine that created it (or one that " +
               "roams the same profile). Current account: " +
               ([Security.Principal.WindowsIdentity]::GetCurrent()).Name + ". " +
               "Re-run the installer as the account Claude Desktop runs as, or convert back to " +
               "plaintext. Underlying error: " + $_.Exception.Message)
    } finally {
        if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
    }
}

function New-ProtectedEnvContent {
<#
.SYNOPSIS
    Wrap ciphertext in the on-disk container format.

.DESCRIPTION
    Deliberately KEY=value shaped. If someone points `node --env-file=` at this file
    by mistake, Node parses it happily and the server then fails with "BCONNECT_BASE_URL
    is required" -- a loud, obvious failure -- instead of choking on binary and
    producing something harder to read.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $EnvText)

    $L = New-Object System.Collections.ArrayList
    [void]$L.Add('# bConnect-MCP credentials, DPAPI-protected at CurrentUser scope.')
    [void]$L.Add('#')
    [void]$L.Add('# Written by install\Install-BConnectMcp.ps1. Do not edit by hand -- re-run the')
    [void]$L.Add('# installer (or the wizard) to change credentials or to convert back to plaintext.')
    [void]$L.Add('#')
    [void]$L.Add('# This ciphertext is decryptable only by the Windows account that created it, on')
    [void]$L.Add('# this machine. That protects the file if it is copied, backed up or committed by')
    [void]$L.Add('# accident. It does NOT protect against code running as that same account, which')
    [void]$L.Add('# can call DPAPI itself.')
    [void]$L.Add('#')
    [void]$L.Add('# Node cannot read this. When protection is on, Claude Desktop launches')
    [void]$L.Add('# install\lib\Start-BConnectServer.ps1, which decrypts in memory and passes the')
    [void]$L.Add('# values to node through the child process environment block only.')
    [void]$L.Add('')
    [void]$L.Add('BCONNECT_PROTECTED_V=1')
    [void]$L.Add('BCONNECT_PROTECTED_SCOPE=CurrentUser')
    [void]$L.Add('BCONNECT_PROTECTED_USER=' + ([Security.Principal.WindowsIdentity]::GetCurrent()).Name)
    [void]$L.Add('BCONNECT_PROTECTED_MACHINE=' + $env:COMPUTERNAME)
    [void]$L.Add('BCONNECT_PROTECTED_WRITTEN=' + (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss'))
    [void]$L.Add('BCONNECT_PROTECTED_DATA=' + (Protect-BConnectText -Text $EnvText))
    return (($L -join "`r`n") + "`r`n")
}

function Read-ProtectedEnvContent {
<#
.SYNOPSIS
    Read a protected container file and return the decrypted env text.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) { throw "No protected credentials file at $Path" }
    $data = $null
    foreach ($line in (Get-Content -LiteralPath $Path)) {
        if ($line -match '^\s*BCONNECT_PROTECTED_DATA\s*=\s*(.+?)\s*$') { $data = $Matches[1] }
    }
    if (-not $data) { throw "$Path has no BCONNECT_PROTECTED_DATA line; it is not a protected credentials file." }
    return (Unprotect-BConnectText -Base64 $data)
}

function ConvertFrom-EnvText {
<#
.SYNOPSIS
    Parse .env text into an ordered dictionary.

.DESCRIPTION
    The same parser the installer uses on the plaintext file and the shim uses on the
    decrypted text, so the two cannot disagree about what a line means. Matches Node's
    --env-file behaviour for the cases that actually occur here: KEY=value, optional
    surrounding double quotes, '#' comments on their own line, trimmed whitespace.
#>
    [CmdletBinding()]
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Text)

    $map = New-Object 'System.Collections.Specialized.OrderedDictionary'
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=') {
            $i = $line.IndexOf('=')
            $k = $line.Substring(0, $i).Trim()
            $v = $line.Substring($i + 1).Trim()
            if ($v.Length -ge 2 -and $v.StartsWith('"') -and $v.EndsWith('"')) {
                $v = $v.Substring(1, $v.Length - 2) -replace '\\"', '"'
            }
            $map[$k] = $v
        }
    }
    return $map
}

function Get-ProtectedEnvPath {
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [string] $PlainEnvPath)
    return ($PlainEnvPath + $script:ProtectedFileSuffix)
}

function Get-CredentialStoreState {
<#
.SYNOPSIS
    Which form of the credentials file exists, and which one is in force.

.DESCRIPTION
    Returns Mode = 'protected' | 'plaintext' | 'none'.

    'protected' wins when both exist, because that is the only reading that fails
    safe: a leftover plaintext file next to a protected one is a bug to be reported,
    not a reason to silently prefer the plaintext.
#>
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $EnvFile)

    $prot = Get-ProtectedEnvPath -PlainEnvPath $EnvFile
    $hasPlain = Test-Path -LiteralPath $EnvFile
    $hasProt  = Test-Path -LiteralPath $prot
    $mode = 'none'
    if     ($hasProt)  { $mode = 'protected' }
    elseif ($hasPlain) { $mode = 'plaintext' }

    return [pscustomobject]@{
        Mode          = $mode
        PlainPath     = $EnvFile
        ProtectedPath = $prot
        HasPlaintext  = $hasPlain
        HasProtected  = $hasProt
        ActivePath    = $(if ($mode -eq 'protected') { $prot } elseif ($mode -eq 'plaintext') { $EnvFile } else { $null })
        BothPresent   = ($hasPlain -and $hasProt)
    }
}

function Read-BConnectEnvText {
<#
.SYNOPSIS
    Return the credentials as text, from whichever form is in force.

.DESCRIPTION
    Callers treat this as sensitive: it is the plaintext. Nothing in the installer
    prints it; the shape (key names) is reported instead.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [string] $EnvFile)

    $state = Get-CredentialStoreState -EnvFile $EnvFile
    switch ($state.Mode) {
        'protected' { return (Read-ProtectedEnvContent -Path $state.ProtectedPath) }
        'plaintext' { return (Get-Content -LiteralPath $state.PlainPath -Raw) }
        default     { return '' }
    }
}

function Read-BConnectEnvMap {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $EnvFile)
    return (ConvertFrom-EnvText -Text (Read-BConnectEnvText -EnvFile $EnvFile))
}

function Remove-FileBestEffort {
<#
.SYNOPSIS
    Overwrite a file's bytes with zeros, then delete it.

.DESCRIPTION
    Called when converting plaintext -> protected, so that the plaintext copy does not
    simply linger.

    Honest about its limits: on NTFS this overwrites the CURRENT extent, and on an SSD
    the flash translation layer may have already relocated the original blocks. Journal
    entries, shadow copies and previous versions are untouched. This reduces the
    trivial "undelete it" case; it is not a secure erase and is not described as one.
#>
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) { return }
    try {
        $len = (Get-Item -LiteralPath $Path).Length
        if ($len -gt 0) {
            $zeros = New-Object byte[] $len
            [System.IO.File]::WriteAllBytes($Path, $zeros)
        }
    } catch { }
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}

function Write-BConnectEnvStore {
<#
.SYNOPSIS
    Write the credentials in the requested form and remove the other form.

.DESCRIPTION
    One function owns the invariant "exactly one of the two files exists", so
    switching direction is a single call in either direction and no caller has to
    remember to clean up after itself. That is what makes "provide a way back" true
    rather than aspirational.

    When -Protected is set the plaintext NEVER touches disk: the text is protected in
    memory and only the ciphertext is written.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $EnvFile,
        [Parameter(Mandatory)] [AllowEmptyString()] [string] $Content,
        [switch] $Protected
    )

    $protPath = Get-ProtectedEnvPath -PlainEnvPath $EnvFile
    if ($Protected) {
        Write-SecretFileAtomic -Path $protPath -Content (New-ProtectedEnvContent -EnvText $Content)
        Remove-FileBestEffort -Path $EnvFile
        return $protPath
    } else {
        Write-SecretFileAtomic -Path $EnvFile -Content $Content
        Remove-FileBestEffort -Path $protPath
        return $EnvFile
    }
}

function Get-ShimPath {
    [CmdletBinding()]
    [OutputType([string])]
    param()
    return (Join-Path $PSScriptRoot 'Start-BConnectServer.ps1')
}

function Get-PowerShellExePath {
<#
.SYNOPSIS
    The absolute path to Windows PowerShell, for the Desktop configuration.

.DESCRIPTION
    An absolute path rather than "powershell.exe" on purpose: the configuration is
    consumed by Claude Desktop, whose PATH is whatever Explorer handed it, and a
    server that starts here but not there is the worst kind of bug to chase.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param()
    $p = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (Test-Path -LiteralPath $p) { return $p }
    $c = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    throw 'Could not locate powershell.exe; DPAPI protection needs it for the launcher shim.'
}

function New-ServerLaunchEntry {
<#
.SYNOPSIS
    Build the claude_desktop_config.json entry for one server.

.DESCRIPTION
    The ONE place that decides how a server is launched, so the plaintext and
    protected forms cannot drift apart, and so verify-install.mjs -- which reads
    command/args straight out of the written configuration -- exercises whichever
    form was actually chosen.

    Plaintext (default, unchanged from before this feature existed):
        node --env-file=<env> <server>\build\index.js

    Protected:
        powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass
                       -File <lib\Start-BConnectServer.ps1>
                       -EnvFile <env>.dpapi -NodeExe <node> -ServerScript <...\index.js>

    Note the build\index.js path is still present as an argument in the protected
    form. verify-install.mjs locates the suite root by finding that argument, so
    keeping it there keeps verification working for both shapes.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $NodeExe,
        [Parameter(Mandatory)] [string] $ServerScript,
        [Parameter(Mandatory)] [string] $EnvFile,
        [switch] $Protected,
        [System.Collections.IDictionary] $Env
    )

    if ($Protected) {
        $entry = [ordered]@{
            command = (Get-PowerShellExePath)
            args    = @(
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', (Get-ShimPath),
                '-EnvFile', (Get-ProtectedEnvPath -PlainEnvPath $EnvFile),
                '-NodeExe', $NodeExe,
                '-ServerScript', $ServerScript
            )
        }
    } else {
        $entry = [ordered]@{
            command = $NodeExe
            args    = @(('--env-file=' + $EnvFile), $ServerScript)
        }
    }
    if ($Env -and $Env.Count) {
        $ordered = [ordered]@{}
        foreach ($k in $Env.Keys) { $ordered[$k] = $Env[$k] }
        $entry['env'] = $ordered
    }
    return $entry
}

function Test-TextContainsSecret {
<#
.SYNOPSIS
    Does this text contain the given secret? Used as a leak detector in the tests.

.DESCRIPTION
    Exported so the test script can prove the detector FIRES on a known-plaintext
    case before trusting it to stay silent on the protected one. A detector that has
    never been seen to fire proves nothing.
#>
    [CmdletBinding()]
    [OutputType([bool])]
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [AllowNull()] [string] $Text,
        [Parameter(Mandatory)] [string] $Secret
    )
    if ([string]::IsNullOrEmpty($Text)) { return $false }
    if ($Text.IndexOf($Secret, [StringComparison]::Ordinal) -ge 0) { return $true }
    # A secret can also leak base64- or URL-encoded (a command line, a log, a URL).
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Secret))
    if ($Text.IndexOf($b64, [StringComparison]::Ordinal) -ge 0) { return $true }
    $esc = [Uri]::EscapeDataString($Secret)
    if ($esc -ne $Secret -and $Text.IndexOf($esc, [StringComparison]::Ordinal) -ge 0) { return $true }
    return $false
}

Export-ModuleMember -Function Get-BConnectEntropy, Protect-BConnectText, Unprotect-BConnectText,
                              New-ProtectedEnvContent, Read-ProtectedEnvContent, ConvertFrom-EnvText,
                              Get-ProtectedEnvPath, Get-CredentialStoreState, Read-BConnectEnvText,
                              Read-BConnectEnvMap, Write-BConnectEnvStore, Remove-FileBestEffort,
                              Get-ShimPath, Get-PowerShellExePath, New-ServerLaunchEntry,
                              Test-TextContainsSecret
