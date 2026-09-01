<#
    State.psm1 -- the installation record, and everything that reads it.

    WHY THIS EXISTS
    ---------------
    The installer was re-runnable but STATELESS. It reconstructed a fraction of the
    last run's intent from two artefacts that exist for other reasons -- which
    bconnect-* servers appear in the Claude Desktop config, and the base URL and auth
    kind in the credentials file -- and everything else was either re-asked from a
    default that was not the current value, or never asked and therefore lost.

    Measured consequences, before this file existed: a plain re-run dropped
    BCONNECT_CA_CERT_PATH, both BCONNECT_V11_* values and MCP_GATEWAY_AUTH_TOKEN;
    silently removed an existing write gate; and, because -Hosts defaults to
    claude-desktop alone, a -ProtectCredentials conversion left every other host
    pointing at an env file that no longer existed. Those hosts do not degrade --
    they stop.

    THREE RULES MAKE THE RECORD SAFE
    --------------------------------
    1. It never holds a secret. It holds the v1.1 USERNAME (an identity, already
       visible in the bMS console) and the FACT of a gateway token, never a value.
       So it does not need the ACL-hardened directory and can be read without
       DPAPI -- which is the point: a reconfigure has to be able to describe an
       install it cannot yet decrypt.
    2. It is intent, not truth. Truth lives in the credentials store and the host
       files. Any disagreement is DRIFT, reported rather than silently resolved.
    3. It is optional. Its absence is the normal state of every installation that
       exists today, and is handled by adoption -- see Get-AdoptedRecord.

    Tests: install\lib\Test-Reconfigure.ps1
#>

Set-StrictMode -Version Latest

$script:SCHEMA = 1

function Get-PropName {
<#
.SYNOPSIS
    The property names of an object, as an array, safely.
.DESCRIPTION
    `$o.PSObject.Properties.Name` is member enumeration over a collection, and under
    Set-StrictMode -Version Latest it THROWS when the collection is empty -- which is
    exactly the shape a record with no servers yet has. Every place this module asks
    "does this object have that property?" goes through here.
#>
    [CmdletBinding()]
    [OutputType([string[]])]
    param([AllowNull()] $Object)
    if ($null -eq $Object) { return @() }
    # A record read back from JSON is a PSCustomObject, whose properties ARE its
    # keys. A record built in memory -- which is what an ADOPTED one is -- carries
    # its servers as an OrderedDictionary, and .PSObject.Properties on one of those
    # is Count/Keys/Values/IsReadOnly/IsFixedSize/IsSynchronized/SyncRoot: the
    # dictionary's own .NET surface, not the names in it. Observed: `bconnect
    # status` on an installation with no record listed seven servers called
    # "IsFixedSize", "SyncRoot" and so on, each marked UNMANAGED. Every caller here
    # means "the names in this thing", so both shapes answer that question.
    if ($Object -is [System.Collections.IDictionary]) { return @($Object.Keys | ForEach-Object { [string]$_ }) }
    return @($Object.PSObject.Properties | ForEach-Object { $_.Name })
}

function Get-DefaultStateFile {
    [CmdletBinding()]
    [OutputType([string])]
    param()
    return (Join-Path (Split-Path -Parent $PSScriptRoot) 'state\installation.json')
}

function Get-HostRegistry {
    [CmdletBinding()]
    param([string] $Path)
    if (-not $Path) { $Path = Join-Path $PSScriptRoot 'hosts.json' }
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
}

# -----------------------------------------------------------------------------
# Canonical JSON, for the per-entry hash
# -----------------------------------------------------------------------------
function Test-RecordContainsValue {
<#
.SYNOPSIS
    Does any string value anywhere in this object graph equal, or contain, the
    needle?

.DESCRIPTION
    Compares VALUES, never serialised text. That is the whole point: JSON
    escaping rewrites a value on its way into the document (\ becomes \\), so a
    text search for the raw secret silently misses any password containing a
    backslash or a quote. Comparing before serialisation cannot be fooled that
    way.

    Ordinal comparison, case-SENSITIVE: a credential differing only in case is a
    different credential, and a case-insensitive match would reject records that
    merely happen to share a word.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowNull()] $Node,
        [Parameter(Mandatory)] [string] $Needle,
        [int] $Depth = 0
    )
    if ($null -eq $Node -or $Depth -gt 12) { return $false }

    if ($Node -is [string]) {
        return $Node.IndexOf($Needle, [StringComparison]::Ordinal) -ge 0
    }
    if ($Node -is [System.Collections.IDictionary]) {
        foreach ($key in $Node.Keys) {
            # Keys as well as values: a record keyed BY a secret leaks it just
            # as effectively as one that stores it.
            if ($key -is [string] -and $key.IndexOf($Needle, [StringComparison]::Ordinal) -ge 0) { return $true }
            if (Test-RecordContainsValue -Node $Node[$key] -Needle $Needle -Depth ($Depth + 1)) { return $true }
        }
        return $false
    }
    if ($Node -is [System.Management.Automation.PSCustomObject]) {
        foreach ($prop in $Node.PSObject.Properties) {
            if ($prop.Name.IndexOf($Needle, [StringComparison]::Ordinal) -ge 0) { return $true }
            if (Test-RecordContainsValue -Node $prop.Value -Needle $Needle -Depth ($Depth + 1)) { return $true }
        }
        return $false
    }
    if ($Node -is [System.Collections.IEnumerable]) {
        foreach ($item in $Node) {
            if (Test-RecordContainsValue -Node $item -Needle $Needle -Depth ($Depth + 1)) { return $true }
        }
        return $false
    }
    return $false
}

function ConvertTo-CanonicalJson {
<#
.SYNOPSIS
    Deterministic JSON for hashing: keys sorted, no whitespace, no formatting
    freedom.

.DESCRIPTION
    ConvertTo-Json is not usable for this. It emits keys in insertion order, so the
    same entry written by two code paths hashes differently, and a hash that changes
    when nothing changed is worse than no hash -- it teaches the operator to ignore
    the drift warning.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([AllowNull()] $Value)

    if ($null -eq $Value) { return 'null' }
    if ($Value -is [string])  { return (ConvertTo-Json $Value -Compress) }
    if ($Value -is [bool])    { return $(if ($Value) { 'true' } else { 'false' }) }
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {
        return ([string]$Value)
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $parts = @()
        foreach ($k in (@($Value.Keys) | Sort-Object -CaseSensitive)) {
            $parts += ((ConvertTo-Json ([string]$k) -Compress) + ':' + (ConvertTo-CanonicalJson $Value[$k]))
        }
        return ('{' + ($parts -join ',') + '}')
    }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $parts = @()
        foreach ($p in ($Value.PSObject.Properties | Sort-Object -Property Name -CaseSensitive)) {
            $parts += ((ConvertTo-Json $p.Name -Compress) + ':' + (ConvertTo-CanonicalJson $p.Value))
        }
        return ('{' + ($parts -join ',') + '}')
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $parts = @()
        foreach ($e in $Value) { $parts += (ConvertTo-CanonicalJson $e) }
        return ('[' + ($parts -join ',') + ']')
    }
    return (ConvertTo-Json ([string]$Value) -Compress)
}

function Get-ManagedEntryHash {
<#
.SYNOPSIS
    sha256:<hex> over one host-config entry, canonicalised.
.DESCRIPTION
    A mismatch against the recorded hash is an operator edit BY DEFINITION -- the
    installer wrote what it recorded, so anything else came from a human or another
    tool. That is anti-clobber layer 2 of four.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([Parameter(Mandatory)] [AllowNull()] $Entry)

    $json = ConvertTo-CanonicalJson $Entry
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($json))
        return ('sha256:' + ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant())
    } finally { $sha.Dispose() }
}

# -----------------------------------------------------------------------------
# Which bConnect server this installation is for
# -----------------------------------------------------------------------------
function Get-EstateKey {
<#
.SYNOPSIS
    The identity of one bConnect server, as a comparable string.

.DESCRIPTION
    THE ONE PLACE that decides whether two base URLs mean the same bMS. Nothing
    else compares base URLs for identity; a second implementation of this rule is
    how a refusal starts firing on a trailing slash.

    Equal by design, because each is a way of writing the same server that this
    installer already accepts:

      trailing slash        https://bms.corp.local/bconnect/
      host case             https://BMS.corp.local/bconnect
      the /bconnect suffix  https://bms.corp.local        -- Test-BaseUrlShape only
                            WARNS when it is missing and offers "use it anyway?",
                            so an installation may hold either form.
      path case             /BConnect  -- the bMS is served by IIS, which does not
                            distinguish them.

    NOT equal, deliberately: a different scheme or a different port. https on 443
    and http on 80 are two endpoints, not one spelling of one endpoint, and the
    cost of being wrong in that direction is a job assigned on the wrong bMS.

    A URL that will not parse falls back to a trimmed, lower-cased comparison
    rather than throwing: this function answers a safety question and must have an
    answer for every input.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([AllowNull()] [string] $Url)

    if ([string]::IsNullOrWhiteSpace($Url)) { return '' }
    $u = $Url.Trim()

    $parsed = $null
    if (-not [System.Uri]::TryCreate($u, [System.UriKind]::Absolute, [ref]$parsed)) {
        return $u.TrimEnd('/').ToLowerInvariant()
    }

    $path = $parsed.AbsolutePath.TrimEnd('/')
    if ($path -match '(?i)/bconnect$') { $path = $path.Substring(0, $path.Length - 9) }

    # $parsed.Port is the scheme's default when the URL carries none, so
    # https://h and https://h:443 collapse to one key without a table of defaults
    # here.
    return ('{0}://{1}:{2}{3}' -f $parsed.Scheme.ToLowerInvariant(),
                                  $parsed.Host.ToLowerInvariant(),
                                  $parsed.Port,
                                  $path.ToLowerInvariant())
}

function Get-RecordBaseUrl {
<#
.SYNOPSIS
    The base URL the record says this installation is for, or $null.
#>
    [CmdletBinding()]
    param([AllowNull()] $Record)
    if ($null -eq $Record) { return $null }
    if ((Get-PropName $Record) -notcontains 'credentials' -or -not $Record.credentials) { return $null }
    $c = $Record.credentials
    if ((Get-PropName $c) -notcontains 'baseUrl') { return $null }
    $v = [string]$c.baseUrl
    if ([string]::IsNullOrWhiteSpace($v)) { return $null }
    return $v
}

function Get-EstateChange {
<#
.SYNOPSIS
    $null when the requested base URL is the estate this installation already
    serves; otherwise the two URLs, so a caller can refuse and name both.

.DESCRIPTION
    WHY THIS EXISTS

    install\state\installation.json is a SINGLE record, and every host-config entry
    is keyed by a bare server name -- bconnect-endpoints, bconnect-jobs. A second
    install pointing at a different bMS writes those same keys into the same client
    file and overwrites the first. The entry's args carry an absolute --env-file
    path, so the entry silently re-points at the other estate's credentials, and
    nothing in any client looks different.

    The failure that follows is not a lost test configuration. It is an operator
    asking an assistant to assign a job while believing they are pointed at test,
    and having it assigned on production. This suite creates job instances and
    assigns them to groups, and customers evaluate against test before production,
    so this is an early path rather than an edge case.

    THE RULE

    A conflict needs a RECORD that names a base URL. Without one there is nothing
    to have been silently replaced -- an installation that predates the record is
    adopted, not overwritten -- so this stays silent, which is also what keeps a
    first install and a plain re-point of a record-less tree working as before.

    Three ways there is no conflict:
      the requested URL is the recorded one       an ordinary re-run
      the requested URL is the credentials file's the record and the file disagree
                                                  (reported separately as drift);
                                                  the file is what every configured
                                                  entry actually loads, so matching
                                                  it changes no estate. This is what
                                                  keeps `bconnect set credential`,
                                                  which passes the file's own URL
                                                  back in, from being refused.
      -AcceptedFrom names the recorded URL        the caller has read the record and
                                                  is deliberately re-pointing this
                                                  one installation. `bconnect.ps1
                                                  set url` is that caller.

    -AcceptedFrom is deliberately not a bare switch. A switch is a force flag: it
    reintroduces the silent path for anyone who adds it to a deployment job once. A
    caller that has to state the URL it expects to replace cannot do that without
    having read the record, and fails closed when the record has moved on.
#>
    [CmdletBinding()]
    param(
        [AllowNull()] $Record,
        [System.Collections.IDictionary] $EnvMap,
        [AllowNull()] [string] $RequestedUrl,
        [AllowNull()] [string] $AcceptedFrom
    )

    $recorded = Get-RecordBaseUrl $Record
    if (-not $recorded) { return $null }
    if ([string]::IsNullOrWhiteSpace($RequestedUrl)) { return $null }

    $recordedKey  = Get-EstateKey $recorded
    $requestedKey = Get-EstateKey $RequestedUrl
    if (-not $recordedKey -or -not $requestedKey) { return $null }
    if ($requestedKey -eq $recordedKey) { return $null }

    $liveUrl = $null
    if ($EnvMap -and $EnvMap.Contains('BCONNECT_BASE_URL')) { $liveUrl = [string]$EnvMap['BCONNECT_BASE_URL'] }
    if ($liveUrl -and (Get-EstateKey $liveUrl) -eq $requestedKey) { return $null }

    if ($AcceptedFrom -and (Get-EstateKey $AcceptedFrom) -eq $recordedKey) { return $null }

    return [pscustomobject]@{
        RecordedUrl  = $recorded
        RequestedUrl = $RequestedUrl.Trim()
    }
}

# -----------------------------------------------------------------------------
# Reading what is actually deployed
# -----------------------------------------------------------------------------
function Get-HostManagedEntries {
<#
.SYNOPSIS
    The bconnect-* entries currently in one host's configuration file.

.DESCRIPTION
    Returns an ordered dictionary of name -> entry, or $null when the file cannot
    be read as a configuration we own. The distinction matters:

      $null                the file is absent, is not JSON, or belongs to a host
                           whose artefact is a snippet or a YAML block file we
                           deliberately never re-parse (see host-emitters.mjs:
                           "we never re-serialise a file a human wrote").
      empty dictionary     the file is ours and carries no bconnect-* entries.

    Reported as different things, because "I could not look" and "I looked and
    there was nothing" lead to opposite next actions.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] $Target
    )

    if ($Target.mode -ne 'merge-json') { return $null }
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $json = $null
    try { $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
    if ($null -eq $json) { return $null }

    $key = $Target.serversKey
    $coll = $json.PSObject.Properties | Where-Object { $_.Name -eq $key }
    $out = New-Object 'System.Collections.Specialized.OrderedDictionary'
    if (-not $coll) { return $out }
    $v = $coll.Value
    if ($null -eq $v) { return $out }

    if ($Target.collection -eq 'list') {
        $nf = 'name'
        if ($Target.PSObject.Properties.Name -contains 'nameField' -and $Target.nameField) { $nf = $Target.nameField }
        foreach ($e in @($v)) {
            if ($e -and (Get-PropName $e) -contains $nf -and ([string]$e.$nf) -like 'bconnect-*') {
                $out[[string]$e.$nf] = $e
            }
        }
    } else {
        foreach ($p in $v.PSObject.Properties) {
            if ($p.Name -like 'bconnect-*') { $out[$p.Name] = $p.Value }
        }
    }
    return $out
}

function Get-EntryEnvBlock {
<#
.SYNOPSIS
    The env block of one host-config entry, as an ordered dictionary of strings.
#>
    [CmdletBinding()]
    param([AllowNull()] $Entry)

    $out = New-Object 'System.Collections.Specialized.OrderedDictionary'
    if ($null -eq $Entry) { return $out }
    if (-not ((Get-PropName $Entry) -contains 'env')) { return $out }
    $e = $Entry.env
    if ($null -eq $e) { return $out }
    foreach ($p in $e.PSObject.Properties) { $out[$p.Name] = [string]$p.Value }
    return $out
}

function Get-EntryLaunchPaths {
<#
.SYNOPSIS
    The absolute file paths one host-config entry names.

.DESCRIPTION
    Both launch shapes New-ServerLaunchEntry produces carry absolute paths, and
    every one of them has to exist for the entry to start:

      plaintext   node.exe   --env-file=<secrets>\bconnect.env  <suite>\build\index.js
      protected   powershell -File <lib>\Start-BConnectServer.ps1
                             -EnvFile <secrets>\bconnect.env.dpapi
                             -NodeExe <node.exe> -ServerScript <suite>\build\index.js

    Only rooted paths are returned. A bare "node" is resolved through PATH at
    launch time, and reporting it as missing because it is not a file in the
    current directory would be a false alarm.
#>
    [CmdletBinding()]
    [OutputType([string[]])]
    param([AllowNull()] $Entry)

    $out = @()
    if ($null -eq $Entry) { return ,$out }
    $names = Get-PropName $Entry

    $isRooted = {
        param([string] $V)
        if (-not $V) { return $false }
        return ($V -match '^[A-Za-z]:[\\/]' -or $V.StartsWith('\\'))
    }

    if ($names -contains 'command') {
        $c = ([string]$Entry.command).Trim('"')
        if (& $isRooted $c) { $out += $c }
    }
    if ($names -contains 'args' -and $Entry.args) {
        foreach ($a in @($Entry.args)) {
            $v = [string]$a
            if (-not $v) { continue }
            # --env-file=<path> is one argument, and the path inside it is the
            # credentials file every server is started with.
            if ($v -match '^--env-file=(.+)$') { $v = $Matches[1] }
            $v = $v.Trim('"')
            if (& $isRooted $v) { $out += $v }
        }
    }
    return ,@($out | Select-Object -Unique)
}

function Get-StaleLaunchPaths {
<#
.SYNOPSIS
    Every managed host entry that starts a file which is not on this machine.

.DESCRIPTION
    Reads only the disk, so it holds for an ADOPTED view as well: it needs no
    recorded hash, and the three cases it exists for are exactly the ones where the
    record is absent, stale or was never consulted.

      an upgrade to a different directory   UsePreviousAppDir is a default an
                                            administrator can override with /DIR=.
                                            Every entry's args still name the old
                                            location, and the new location has no
                                            record of its own, so nothing else
                                            notices.
      the software removed by hand          the entries survive, and every
                                            configured client shows a server that
                                            cannot start.
      a suite root deleted or renamed       the same, one client at a time.

    Reported, not repaired. Rewriting an operator's client configuration without
    being asked is the hazard this product is most careful about, and the two
    repairs -- re-emit, or remove -- are opposite answers that only the operator
    can choose between. Each finding names both.
#>
    [CmdletBinding()]
    param([Parameter(Mandatory)] [array] $HostFiles)

    $out = @()
    foreach ($h in $HostFiles) {
        $entries = Get-HostManagedEntries -Path $h.path -Target $h.target
        if ($null -eq $entries) { continue }
        foreach ($name in @($entries.Keys)) {
            foreach ($p in (Get-EntryLaunchPaths $entries[$name])) {
                if (Test-Path -LiteralPath $p) { continue }
                $out += @{
                    Severity = 'warn'; Host = $h.id; Server = $name
                    Text     = "'$name' in $($h.id) starts a file that is not on this machine: $p"
                    Action   = 'bconnect hosts resync   (re-emits every entry from this installation''s location), or bconnect uninstall to remove the entries'
                }
            }
        }
    }
    return ,$out
}

function Get-DeployedServerEnv {
<#
.SYNOPSIS
    server name -> its per-server env block, as currently deployed.

.DESCRIPTION
    Reconciled across every host given, in order, first one wins. The record is
    intent; this is what a host will actually start with, and it is what the write
    gate and the v1.1 gate must default to on a re-run.

    Disagreement between hosts is returned in -Conflicts rather than resolved
    quietly: two hosts with different write gates for the same server is a fact the
    operator needs, not a coin toss.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [array] $HostFiles,      # @( @{ id; path; target } )
        [ref] $Conflicts
    )

    $env = New-Object 'System.Collections.Specialized.OrderedDictionary'
    $source = @{}
    $conf = @()
    foreach ($h in $HostFiles) {
        $entries = Get-HostManagedEntries -Path $h.path -Target $h.target
        if ($null -eq $entries) { continue }
        foreach ($name in @($entries.Keys)) {
            $block = Get-EntryEnvBlock $entries[$name]
            if (-not $env.Contains($name)) {
                $env[$name] = $block
                $source[$name] = $h.id
            } else {
                $a = (ConvertTo-CanonicalJson $env[$name])
                $b = (ConvertTo-CanonicalJson $block)
                if ($a -ne $b) {
                    $conf += ("$name differs between $($source[$name]) and $($h.id)")
                }
            }
        }
    }
    if ($Conflicts) { $Conflicts.Value = $conf }
    return $env
}

# -----------------------------------------------------------------------------
# The record itself
# -----------------------------------------------------------------------------
function Read-InstallationRecord {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) }
    catch {
        # A corrupt record must never stop a run. It is intent, and intent can be
        # rebuilt from the host files by adoption; the credentials and the configs
        # are the things that cannot.
        Write-Warning ("installation record at $Path is not valid JSON and will be ignored: " + $_.Exception.Message)
        return $null
    }
}

function Write-InstallationRecord {
<#
.SYNOPSIS
    Write the record, last, after a run that got far enough to have changed
    something.

.DESCRIPTION
    Deliberately NOT in the hardened secrets directory: it holds no secret, and a
    reconfigure has to be able to read it before it can decrypt anything.

    A guard, not a comment: every value is checked against the secrets it must
    never contain before the file is written. The check is cheap and the failure
    mode it prevents -- a world-readable file with a bearer token in it -- is the
    kind this project keeps finding.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] $Record,
        [string[]] $MustNotContain = @()
    )

    $json = $Record | ConvertTo-Json -Depth 12

    # Two checks, because the obvious one has a hole an independent audit found.
    #
    # Searching the SERIALISED text for the raw secret misses any secret that
    # JSON escaping rewrites: ConvertTo-Json turns \ into \\, " into \", tab
    # into \t. A password containing a backslash -- an ordinary Windows
    # password -- is written to the record and the guard says nothing. Verified:
    # `pw\with\backslash` and `pw"with"quote` both wrote with no throw.
    #
    # 1. Walk the VALUES. Escaping is a property of the text, not the value, so
    #    comparing values is immune to it. This is the real check.
    # 2. Then also search the text for the secret's own JSON-ESCAPED form, which
    #    catches a secret embedded INSIDE a longer string -- a connection string
    #    carrying the password, say -- where no single value equals it.
    foreach ($s in $MustNotContain) {
        if (-not $s) { continue }

        if (Test-RecordContainsValue -Node $Record -Needle $s) {
            throw ('refusing to write the installation record: a stored value IS a secret. ' +
                   'The record is world-readable by design and must hold identities and facts only.')
        }

        # ConvertTo-Json on a bare string yields "…" with the escaping applied;
        # trimming the quotes leaves exactly what the secret looks like inside
        # the document.
        $escaped = ($s | ConvertTo-Json)
        if ($escaped.Length -ge 2) { $escaped = $escaped.Substring(1, $escaped.Length - 2) }
        if ($escaped -and $json.IndexOf($escaped, [StringComparison]::Ordinal) -ge 0) {
            throw ('refusing to write the installation record: a secret appears inside one of its ' +
                   'values. The record is world-readable by design and must hold identities and ' +
                   'facts only.')
        }
    }
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
    return $Path
}

function New-InstallationRecord {
<#
.SYNOPSIS
    Build the record for a run that has just finished.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $SuiteRoot,
        [Parameter(Mandatory)] [string] $SecretsDir,
        [string] $ProjectDir,
        [string] $HostOutDir,
        [string] $NodeVersion,
        [string] $InstallerVersion,
        [hashtable] $Credentials = @{},
        [System.Collections.IDictionary] $Servers,      # name -> @{ writeGate; v11 }
        [array] $Hosts = @(),                           # @( @{ id; path; mode; entryHashes; } )
        [hashtable] $Gateway = @{},
        [hashtable] $Measured = @{},
        [bool] $Verified = $false,
        [bool] $Adopted = $false,
        # The two-stage split. See the .PARAMETER Stage help on the installer.
        #
        # $Hosts is CONFIGURED: a file on disk, with the entry hashes drift is
        # measured against. $IntendedHosts is INTENT: which clients this
        # installation is for. They are separate fields because after the split
        # they are separate facts -- a machine-stage run records intent and
        # configures nothing, and a record that conflated the two would read as a
        # finished install on a machine where no administrator has run anything.
        [ValidateSet('machine', 'user', 'both')] [string] $Stage = 'both',
        [string[]] $IntendedHosts = @(),
        [string] $ConfiguredBy
    )

    # NOT $servers. PowerShell variable names are case-insensitive, so $servers and
    # the $Servers parameter are the SAME variable -- the assignment below would
    # empty the parameter before the loop reads it, and the record would come out
    # with "servers": {} while every other field was right. (Observed: the record
    # was written with no servers at all and the drift check then had nothing to
    # compare. Secrets.psm1 carries the same warning about $L and $l.)
    $serverMap = [ordered]@{}
    if ($Servers) { foreach ($k in @($Servers.Keys)) { $serverMap[$k] = $Servers[$k] } }

    return [ordered]@{
        schema           = $script:SCHEMA
        installerVersion = $InstallerVersion
        lastRun          = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        lastRunVerified  = $Verified
        adopted          = $Adopted
        suiteRoot        = $SuiteRoot
        secretsDir       = $SecretsDir
        projectDir       = $ProjectDir
        hostOutDir       = $HostOutDir
        nodeVersion      = $NodeVersion
        credentials      = $Credentials
        servers          = $serverMap
        hosts            = @($Hosts)
        stage            = $Stage
        intendedHosts    = @($IntendedHosts)
        configuredBy     = $ConfiguredBy
        gateway          = $Gateway
        measured         = $Measured
    }
}

function Get-InstallerVersion {
<#
.SYNOPSIS
    A short content hash of the installer, so the record says which installer wrote
    it.
.DESCRIPTION
    The design document said "installerCommit". A commit id is wrong here: the
    installer ships as files, is edited in place during a deployment, and an
    air-gapped copy has no git at all. A content hash answers the same question --
    "is the installer that wrote this record the one I am running now?" -- and it
    answers it correctly for a copy that was never committed.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param([string] $Path)
    if (-not $Path) { $Path = Join-Path (Split-Path -Parent $PSScriptRoot) 'Install-BConnectMcp.ps1' }
    if (-not (Test-Path -LiteralPath $Path)) { return 'unknown' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.IO.File]::ReadAllBytes($Path))
        return (([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant().Substring(0, 12))
    } finally { $sha.Dispose() }
}

# -----------------------------------------------------------------------------
# Adoption -- the upgrade path for every installation that exists today
# -----------------------------------------------------------------------------
function Get-AdoptedRecord {
<#
.SYNOPSIS
    Reconstruct a record from what is on disk, for an installation that predates
    the record.

.DESCRIPTION
    This is the normal state of every installation in the field, so it is a first-
    class path and not an error branch. It recovers, honestly:

      servers      from the bconnect-* entries in the host files it can read
      write gate   from those entries' env blocks
      v1.1 gate    likewise
      hosts        every registry target whose default path exists AND carries
                   bconnect-* entries. A host is not "configured" because its file
                   exists -- VS Code's mcp.json may be someone else's.
      credentials  base URL, auth kind, CA cert, v1.1 username, gateway-token
                   presence, from the credentials store

    What it cannot recover is marked as such rather than guessed: entry hashes are
    NOT synthesised from the current file, because that would silently bless a hand
    edit as the installer's own work. An adopted record has no hashes, and the
    first real run establishes them.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $SuiteRoot,
        [Parameter(Mandatory)] [string] $SecretsDir,
        [Parameter(Mandatory)] [array]  $HostFiles,     # @( @{ id; path; target } )
        [System.Collections.IDictionary] $EnvMap,
        [string] $CredentialMode = 'none',
        [string] $ProjectDir,
        [string] $HostOutDir,
        [string] $NodeVersion
    )

    $servers = [ordered]@{}
    $hosts   = @()
    foreach ($h in $HostFiles) {
        $entries = Get-HostManagedEntries -Path $h.path -Target $h.target
        if ($null -eq $entries -or $entries.Count -eq 0) { continue }
        $hosts += [ordered]@{
            id          = $h.id
            path        = $h.path
            mode        = $h.target.mode
            entryHashes = [ordered]@{}      # deliberately empty: see the description
            writtenAt   = $null
            adopted     = $true
        }
        foreach ($name in @($entries.Keys)) {
            if ($servers.Contains($name)) { continue }
            $block = Get-EntryEnvBlock $entries[$name]
            $gate = $null
            if ($block.Contains('ALLOW_WRITE_OPERATIONS') -and $block['ALLOW_WRITE_OPERATIONS'] -eq 'true') {
                $tools = @()
                if ($block.Contains('ALLOWED_WRITE_TOOLS') -and $block['ALLOWED_WRITE_TOOLS']) {
                    $tools = @($block['ALLOWED_WRITE_TOOLS'] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
                }
                $gate = [ordered]@{ allow = $true; tools = $tools }
            }
            $servers[$name] = [ordered]@{
                writeGate = $gate
                v11       = ($block.Contains('BCONNECT_ENABLE_V11') -and $block['BCONNECT_ENABLE_V11'] -eq 'true')
            }
        }
    }

    $creds = Get-CredentialFacts -EnvMap $EnvMap -Mode $CredentialMode

    $rec = New-InstallationRecord -SuiteRoot $SuiteRoot -SecretsDir $SecretsDir `
             -ProjectDir $ProjectDir -HostOutDir $HostOutDir -NodeVersion $NodeVersion `
             -InstallerVersion (Get-InstallerVersion) -Credentials $creds `
             -Servers $servers -Hosts $hosts -Adopted $true
    return $rec
}

function Get-CredentialFacts {
<#
.SYNOPSIS
    The non-secret facts about a credentials store: what kind, whose identity, what
    is present. Never a value.
#>
    [CmdletBinding()]
    param(
        [System.Collections.IDictionary] $EnvMap,
        [string] $Mode = 'none'
    )

    $get = {
        param($k)
        if ($EnvMap -and $EnvMap.Contains($k)) { return [string]$EnvMap[$k] }
        return $null
    }
    $authKind = 'none'
    if     (& $get 'BCONNECT_API_KEY')  { $authKind = 'apikey' }
    elseif (& $get 'BCONNECT_USERNAME') { $authKind = 'basic' }

    $v11User = & $get 'BCONNECT_V11_USERNAME'
    return @{
        mode                = $Mode
        baseUrl             = (& $get 'BCONNECT_BASE_URL')
        authKind            = $authKind
        basicUser           = (& $get 'BCONNECT_USERNAME')
        caCertPath          = (& $get 'BCONNECT_CA_CERT_PATH')
        v11                 = @{
            configured = [bool]($v11User -and (& $get 'BCONNECT_V11_PASSWORD'))
            username   = $v11User
        }
        gatewayTokenPresent = [bool](& $get 'MCP_GATEWAY_AUTH_TOKEN')
    }
}

# -----------------------------------------------------------------------------
# Drift
# -----------------------------------------------------------------------------
function Get-InstallationDrift {
<#
.SYNOPSIS
    Every way the record and the disk disagree.

.DESCRIPTION
    The record is intent. The host files and the credentials store are truth.
    Disagreement is reported, never silently resolved -- so this returns a list of
    findings rather than "fixing" anything.

    Each finding is @{ Severity; Host; Server; Text; Action }, where Action is the
    command that resolves it. A finding with no next action is a complaint.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowNull()] $Record,
        [Parameter(Mandatory)] [array] $HostFiles,
        [System.Collections.IDictionary] $EnvMap,
        [string] $NodeVersion
    )

    # First, and before the record is consulted at all: an entry that starts a file
    # which is not there. That finding is true of the disk alone, so it survives a
    # missing record -- which is precisely the state an install-location change
    # leaves behind, the record having stayed with the old directory.
    $out = @()
    $out += @(Get-StaleLaunchPaths -HostFiles $HostFiles)
    if ($null -eq $Record) { return ,$out }

    foreach ($h in $HostFiles) {
        $recHost = $null
        foreach ($rh in @($Record.hosts)) { if ($rh.id -eq $h.id) { $recHost = $rh } }
        if ($null -eq $recHost) { continue }

        if (-not (Test-Path -LiteralPath $h.path)) {
            $out += @{ Severity = 'warn'; Host = $h.id; Server = $null
                       Text = "recorded host file is missing: $($h.path)"
                       Action = "bconnect hosts resync   (re-emits it from the record)" }
            continue
        }
        $entries = Get-HostManagedEntries -Path $h.path -Target $h.target
        if ($null -eq $entries) {
            $out += @{ Severity = 'warn'; Host = $h.id; Server = $null
                       Text = "cannot read $($h.path) as a configuration this installer owns"
                       Action = "fix or move the file, then: bconnect hosts resync" }
            continue
        }
        $hashes = @{}
        if ((Get-PropName $recHost) -contains 'entryHashes' -and $recHost.entryHashes) {
            foreach ($n in (Get-PropName $recHost.entryHashes)) { $hashes[$n] = [string]$recHost.entryHashes.$n }
        }
        foreach ($name in @($hashes.Keys)) {
            if (-not $entries.Contains($name)) {
                $out += @{ Severity = 'warn'; Host = $h.id; Server = $name
                           Text = "recorded entry '$name' is no longer in $($h.id)"
                           Action = "bconnect hosts resync" }
                continue
            }
            $now = Get-ManagedEntryHash $entries[$name]
            if ($now -ne $hashes[$name]) {
                $out += @{ Severity = 'edit'; Host = $h.id; Server = $name
                           Text = "'$name' in $($h.id) has been edited by hand since the last run"
                           Action = "bconnect hosts resync   (takes the installer's version; back it up first)" }
            }
        }
        foreach ($name in @($entries.Keys)) {
            if (-not $hashes.ContainsKey($name) -and -not (Get-RecordHasServer $Record $name)) {
                $out += @{ Severity = 'info'; Host = $h.id; Server = $name
                           Text = "'$name' is configured in $($h.id) but is not in the record"
                           Action = "bconnect servers add $name   (to manage it), or leave it -- it is not touched" }
            }
        }
    }

    if ((Get-PropName $Record) -contains 'nodeVersion' -and $Record.nodeVersion -and $NodeVersion -and
        $Record.nodeVersion -ne $NodeVersion) {
        $out += @{ Severity = 'warn'; Host = $null; Server = $null
                   Text = "Node has changed since the last run: recorded $($Record.nodeVersion), running $NodeVersion"
                   Action = "re-run WITHOUT -SkipBuild; native modules and the build output are ABI-bound" }
    }

    if ($EnvMap -and (Get-PropName $Record) -contains 'credentials' -and $Record.credentials) {
        $c = $Record.credentials
        $liveUrl = $(if ($EnvMap.Contains('BCONNECT_BASE_URL')) { [string]$EnvMap['BCONNECT_BASE_URL'] } else { $null })
        if ((Get-PropName $c) -contains 'baseUrl' -and $c.baseUrl -and $liveUrl -and $c.baseUrl -ne $liveUrl) {
            $out += @{ Severity = 'info'; Host = $null; Server = $null
                       Text = "the credentials file's base URL differs from the record ($liveUrl vs $($c.baseUrl))"
                       Action = "the file wins; run 'bconnect status' after any hand edit to refresh the record" }
        }
    }
    return ,$out
}

function Get-RecordHasServer {
    [CmdletBinding()]
    param($Record, [string] $Name)
    if ($null -eq $Record -or -not $Record.servers) { return $false }
    return [bool]((Get-PropName $Record.servers) -contains $Name)
}

function Get-RecordServerNames {
    [CmdletBinding()]
    param($Record)
    if ($null -eq $Record -or -not $Record.servers) { return @() }
    return @(Get-PropName $Record.servers)
}

function Get-RecordHostIds {
    [CmdletBinding()]
    param($Record)
    if ($null -eq $Record -or -not $Record.hosts) { return @() }
    return @(@($Record.hosts) | ForEach-Object { $_.id })
}

function Get-RecordIntendedHostIds {
<#
.SYNOPSIS
    The clients this installation is FOR, as opposed to the ones a file on disk
    currently names.

.DESCRIPTION
    The handoff between the two stages. A machine-stage run configures nothing, so
    Get-RecordHostIds returns an empty list for it; without this the user stage
    would fall through to detection and quietly configure something other than what
    the deployment asked for.

    Absent from every record written before the split, and therefore empty rather
    than an error -- the same rule the whole record follows.
#>
    [CmdletBinding()]
    param($Record)
    if ($null -eq $Record) { return @() }
    if ((Get-PropName $Record) -notcontains 'intendedHosts' -or -not $Record.intendedHosts) { return @() }
    return @(@($Record.intendedHosts) | Where-Object { $_ })
}

function Get-RecordStage {
<#
.SYNOPSIS
    Which stage last wrote this record: 'machine', 'user' or 'both'. A record from
    before the split says 'both', because that is what it did.
#>
    [CmdletBinding()]
    [OutputType([string])]
    param($Record)
    if ($null -eq $Record) { return 'both' }
    if ((Get-PropName $Record) -notcontains 'stage' -or -not $Record.stage) { return 'both' }
    return [string]$Record.stage
}

function Get-RecordWriteGate {
<#
.SYNOPSIS
    The recorded write gate for one server, as @{ Allow; Tools }, or $null.
#>
    [CmdletBinding()]
    param($Record, [string] $Name)
    if (-not (Get-RecordHasServer $Record $Name)) { return $null }
    $s = $Record.servers.$Name
    if ($null -eq $s -or -not ((Get-PropName $s) -contains 'writeGate') -or $null -eq $s.writeGate) { return $null }
    $tools = @()
    if ((Get-PropName $s.writeGate) -contains 'tools' -and $s.writeGate.tools) { $tools = @($s.writeGate.tools) }
    return @{ Allow = [bool]$s.writeGate.allow; Tools = $tools }
}

function Test-ProjectDirIsInstallation {
<#
.SYNOPSIS
    Is this project directory part of the installation rather than a workspace?
.DESCRIPTION
    Per-project clients (Claude Code, VS Code, Cursor, Continue) read their MCP
    configuration from the folder open in the editor. A config written into the
    directory the suite was unpacked into VERIFIES GREEN AND IS NEVER LOADED BY
    ANYTHING, which is the worst shape a failure can take: it reports success.

    The installer has always refused that. The wizard only warned about it, in
    amber, while pre-filling the box with exactly the value that would be refused
    -- so an operator could answer every question, press Install, and be stopped
    at the end by a rule the window knew at the beginning. Reported from a real
    install run.

    Lives here so both callers ask the same question. The rule is equality after
    trimming a trailing separator, case-insensitively: NTFS is case-insensitive,
    and 'C:\x' and 'C:\x\' are the same directory. A prefix test would be wrong --
    a repository legitimately kept beneath a shared parent is not the
    installation.
#>
    [CmdletBinding()]
    [OutputType([bool])]
    param([AllowNull()] [string] $ProjectDir, [string[]] $InstallationRoots)

    if ([string]::IsNullOrWhiteSpace($ProjectDir)) { return $false }
    $resolved = $ProjectDir
    try { $resolved = (Resolve-Path -LiteralPath $ProjectDir -ErrorAction Stop).Path } catch { }
    $needle = ([string]$resolved).TrimEnd('\')
    foreach ($r in @($InstallationRoots | Where-Object { $_ })) {
        $root = $r
        try { $root = (Resolve-Path -LiteralPath $r -ErrorAction Stop).Path } catch { }
        if ($needle -ieq ([string]$root).TrimEnd('\')) { return $true }
    }
    return $false
}

Export-ModuleMember -Function Test-ProjectDirIsInstallation
Export-ModuleMember -Function Get-PropName, Get-DefaultStateFile, Get-HostRegistry, ConvertTo-CanonicalJson,
                              Get-EstateKey, Get-RecordBaseUrl, Get-EstateChange,
                              Get-EntryLaunchPaths, Get-StaleLaunchPaths,
                              Get-ManagedEntryHash, Get-HostManagedEntries, Get-EntryEnvBlock,
                              Get-DeployedServerEnv, Read-InstallationRecord, Write-InstallationRecord,
                              New-InstallationRecord, Get-InstallerVersion, Get-AdoptedRecord,
                              Get-CredentialFacts, Get-InstallationDrift, Get-RecordHasServer,
                              Get-RecordServerNames, Get-RecordHostIds, Get-RecordWriteGate,
                              Get-RecordIntendedHostIds, Get-RecordStage
