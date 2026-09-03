<#
.SYNOPSIS
    Tests for the reconfigure surface: state preservation, the installation record,
    the verb front end, and uninstall.

.DESCRIPTION
    Everything here runs against a throwaway directory tree with dummy credentials
    and a base URL that does not resolve. It never reads, writes or touches the real
    credentials file, the real Claude Desktop configuration, or the real installation
    record, and it makes no network call that can reach the live bMS.

    THE POINT OF THIS FILE is the principle in phase4\ease-of-use.md section 2.1:

        an option the operator is not asked about on this run keeps the value it has.

    So most of these tests are shaped the same way: put a value on disk, re-run the
    installer WITHOUT mentioning that value, and assert it is still there. Each of
    them was run against the unfixed installer first and observed to fail -- the
    measured pre-fix results are in the header comment of each group.

.EXAMPLE
    .\Test-Reconfigure.ps1
#>
[CmdletBinding()]
param([string] $WorkDir, [string] $Only)

$ErrorActionPreference = 'Stop'

$LibDir       = $PSScriptRoot
$InstallerDir = Split-Path -Parent $LibDir
$Installer    = Join-Path $InstallerDir 'Install-BConnectMcp.ps1'
$Bconnect     = Join-Path $InstallerDir 'bconnect.ps1'
$SuiteRoot    = Join-Path (Split-Path -Parent $InstallerDir) 'bConnect-MCP-main'

Import-Module (Join-Path $LibDir 'Secrets.psm1') -Force
Import-Module (Join-Path $LibDir 'Dpapi.psm1')   -Force -DisableNameChecking
Import-Module (Join-Path $LibDir 'State.psm1')   -Force

if (-not $WorkDir) {
    $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ('bconnect-reconf-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
}

# Dummy values. None of these is a credential for anything.
$DUMMY_KEY   = 'dummy-api-key-0000-not-real'
$DUMMY_KEY2  = 'dummy-api-key-1111-rotated'
$DUMMY_V11P  = 'dummy-v11-password-not-real'
$DUMMY_TOKEN = 'dummyGatewayToken0000000000000000000000000A'
$BAD_URL     = 'https://bms.invalid.example/bconnect'
$BAD_URL2    = 'https://bms2.invalid.example/bconnect'

$script:Pass = 0
$script:Fail = 0
$script:Group = ''
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}
function Group {
    param([string] $Name)
    $script:Group = $Name
    Write-Host ''
    Write-Host ("  -- $Name " + ('-' * [Math]::Max(0, 58 - $Name.Length))) -ForegroundColor Cyan
}
function Skip {
    param([string] $Name, [string] $Why)
    Write-Host ("  SKIP  " + $Name) -ForegroundColor Yellow
    Write-Host ("        " + $Why) -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------------
# Running the engine
# -----------------------------------------------------------------------------
# In a CHILD process, and through a generated runner script rather than a command
# line, for two reasons: -ApiKeySecure is a [SecureString] and cannot cross a
# process boundary as text (which is the whole point of it), and the installer
# calls exit, which would end this test run if it were dot-sourced.
$script:RunSeq = 0
function ConvertTo-Literal {
    param($V)
    if ($null -eq $V) { return '$null' }
    if ($V -is [string] -and $V.StartsWith('#RAW#')) { return $V.Substring(5) }
    if ($V -is [bool] -or $V -is [switch]) { return $(if ([bool]$V) { '$true' } else { '$false' }) }
    if ($V -is [int]) { return [string]$V }
    if ($V -is [hashtable] -or $V -is [System.Collections.IDictionary]) {
        $parts = @()
        foreach ($k in $V.Keys) { $parts += ("'" + ($k -replace "'", "''") + "' = " + (ConvertTo-Literal $V[$k])) }
        return ('@{ ' + ($parts -join '; ') + ' }')
    }
    if ($V -is [array]) {
        $parts = @()
        foreach ($e in $V) { $parts += (ConvertTo-Literal $e) }
        return ('@(' + ($parts -join ', ') + ')')
    }
    return ("'" + ([string]$V -replace "'", "''") + "'")
}

function Invoke-Engine {
    <#
        Runs Install-BConnectMcp.ps1 (or bconnect.ps1, with -Script) in a child
        process against the scratch tree, and returns @{ Code; Output }.
    #>
    param(
        [hashtable] $Params = @{},
        [string[]]  $Positional = @(),
        [string]    $Script,
        [string]    $Work
    )
    if (-not $Script) { $Script = $Installer }
    $script:RunSeq++
    $runner = Join-Path $Work ('run-{0:d2}.ps1' -f $script:RunSeq)
    $log    = Join-Path $Work ('run-{0:d2}.log' -f $script:RunSeq)

    $lines = @('$ErrorActionPreference = ''Continue''', '$p = @{}')
    foreach ($k in $Params.Keys) {
        $lines += ('$p[''' + $k + '''] = ' + (ConvertTo-Literal $Params[$k]))
    }
    $pos = ''
    if ($Positional.Count) { $pos = ' ' + (($Positional | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ' ') }
    $lines += ('$out = & ''' + $Script + '''' + $pos + ' @p *>&1 | Out-String')
    $lines += '$code = $LASTEXITCODE'
    $lines += ('Set-Content -LiteralPath ''' + $log + ''' -Value $out -Encoding UTF8')
    $lines += 'if ($null -eq $code) { $code = 0 }'
    $lines += 'exit $code'
    Set-Content -LiteralPath $runner -Value ($lines -join "`r`n") -Encoding UTF8

    # 2>&1 is load-bearing: without it, anything the child writes to stderr becomes a
    # NativeCommandError in THIS session, and $ErrorActionPreference='Stop' then ends
    # the whole test run instead of failing one check. Found by a mutation that made
    # the installer throw -- the suite aborted mid-way and reported nothing, which is
    # the one thing a guard must never do.
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $runner 2>&1 | Out-Null
    $code = $LASTEXITCODE
    $out = ''
    if (Test-Path -LiteralPath $log) { $out = Get-Content -LiteralPath $log -Raw }
    return @{ Code = $code; Output = $out }
}

function New-Scenario {
    param([string] $Name)
    $w = Join-Path $WorkDir $Name
    $s = [ordered]@{
        Root       = $w
        SecretsDir = Join-Path $w 'secrets'
        ProjectDir = Join-Path $w 'project'
        HostOutDir = Join-Path $w 'out'
        StateFile  = Join-Path $w 'state\installation.json'
        ConfigPath = Join-Path $w 'claude\claude_desktop_config.json'
    }
    New-Item -ItemType Directory -Path $w -Force | Out-Null
    New-Item -ItemType Directory -Path $s.ProjectDir -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $s.ConfigPath) -Force | Out-Null
    $s.EnvFile = Join-Path $s.SecretsDir 'bconnect.env'
    # Every bconnect verb is pointed at the scratch tree explicitly. Without the
    # overrides, adoption would enumerate this machine's REAL host configuration
    # files, and a mutating verb would then act on the live installation.
    $s.Verb = @{
        StateFile          = $s.StateFile
        SuiteRootOverride  = $SuiteRoot
        SecretsDirOverride = $s.SecretsDir
        ProjectDirOverride = $s.ProjectDir
        HostOutDirOverride = $s.HostOutDir
        ConfigPathOverride = $s.ConfigPath
    }
    $s.Common  = @{
        SuiteRoot            = $SuiteRoot
        SecretsDir           = $s.SecretsDir
        ConfigPath           = $s.ConfigPath
        ProjectDir           = $s.ProjectDir
        HostOutDir           = $s.HostOutDir
        StateFile            = $s.StateFile
        NonInteractive       = $true
        SkipBuild            = $true
        ContinueOnUnreachable = $true
    }
    return [pscustomobject]$s
}

function New-ScratchEnvFile {
    <# A credentials file with every optional value set, plus one an operator added by hand. #>
    param($Scenario, [string] $BaseUrl = $BAD_URL)
    New-Item -ItemType Directory -Path $Scenario.SecretsDir -Force | Out-Null
    Set-HardenedDirectoryAcl -Path $Scenario.SecretsDir
    $text = New-EnvFileContent -BaseUrl $BaseUrl -ApiKey $DUMMY_KEY `
                               -V11User 'svc-bconnect@corp.local' -V11Pass $DUMMY_V11P `
                               -CaCertPath (Join-Path $Scenario.Root 'ca.pem') `
                               -GatewayAuthToken $DUMMY_TOKEN
    New-Item -ItemType File -Path (Join-Path $Scenario.Root 'ca.pem') -Force | Out-Null
    # The hand-added key. section 2.1 names this case specifically: it is the fix for the
    # slow-probe problem, and a re-run must not eat it.
    $text = $text + "`r`n# raised by hand after a slow bMS`r`nBCONNECT_TIMEOUT_MS=90000`r`n"
    Write-SecretFileAtomic -Path $Scenario.EnvFile -Content $text
}

function New-ScratchClaudeConfig {
    param($Scenario, [hashtable] $McpServers = @{}, [hashtable] $TopLevel = @{})
    $o = [ordered]@{}
    foreach ($k in $TopLevel.Keys) { $o[$k] = $TopLevel[$k] }
    $o['mcpServers'] = $McpServers
    ($o | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $Scenario.ConfigPath -Encoding UTF8
}

function Get-ConfigServers {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $j = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if (-not $j.mcpServers) { return $null }
    return $j.mcpServers
}

function Get-EnvBlock {
    param($Servers, [string] $Name, [string] $Key)
    if (-not $Servers) { return $null }
    $e = $Servers.PSObject.Properties | Where-Object { $_.Name -eq $Name }
    if (-not $e) { return $null }
    if (-not $e.Value.env) { return $null }
    $p = $e.Value.env.PSObject.Properties | Where-Object { $_.Name -eq $Key }
    if (-not $p) { return $null }
    return [string]$p.Value
}

Write-Host ''
Write-Host "Reconfigure tests -- scratch tree: $WorkDir" -ForegroundColor Cyan
Write-Host '  live bMS: never contacted. Base URL is a domain that does not resolve.' -ForegroundColor DarkGray

$started = Get-Date
try {

# =============================================================================
# 1. The preservation primitive
# =============================================================================
# Measured against the unfixed tree: Merge-EnvText and Merge-EnvMap did not exist.
# `Get-Command Merge-EnvText` -> nothing; the installer's only way to change one
# key was New-EnvFileContent, which rebuilds the file from scratch and therefore
# emits only the keys it was passed.
Group 'Merge-EnvText -- read-modify-write on the credentials text'

if (-not (Get-Command Merge-EnvText -ErrorAction SilentlyContinue)) {
    Check 'Merge-EnvText exists (the read-modify-write primitive of section 2.4)' $false 'not exported by Secrets.psm1'
    Check 'Merge-EnvMap exists' $false 'not exported by Secrets.psm1'
} else {
    $orig = New-EnvFileContent -BaseUrl $BAD_URL -ApiKey $DUMMY_KEY `
                               -V11User 'svc@corp.local' -V11Pass $DUMMY_V11P `
                               -CaCertPath 'C:\ca.pem' -GatewayAuthToken $DUMMY_TOKEN
    $orig = $orig + "BCONNECT_TIMEOUT_MS=90000`r`n"
    $one  = Merge-EnvText -Text $orig -Changes @{ 'BCONNECT_BASE_URL' = $BAD_URL2 }

    $om = ConvertFrom-EnvText -Text $orig
    $nm = ConvertFrom-EnvText -Text $one
    $movedKeys = @($om.Keys | Where-Object { $om[$_] -ne $nm[$_] })
    Check 'changing one key moves exactly one key' ($movedKeys.Count -eq 1 -and $movedKeys[0] -eq 'BCONNECT_BASE_URL') `
          ('moved: ' + ($movedKeys -join ', '))
    Check 'and the new value is in place' ($nm['BCONNECT_BASE_URL'] -eq $BAD_URL2)
    Check 'no key is lost' ($nm.Count -eq $om.Count) ("before $($om.Count), after $($nm.Count)")

    $origComments = @(($orig -split "`r?`n") | Where-Object { $_ -match '^\s*#' })
    $newComments  = @(($one  -split "`r?`n") | Where-Object { $_ -match '^\s*#' })
    Check 'every comment line survives' ($origComments.Count -eq $newComments.Count -and
                                         (($origComments -join '|') -eq ($newComments -join '|'))) `
          ("before $($origComments.Count), after $($newComments.Count)")
    Check 'key order is unchanged' ((@($om.Keys) -join ',') -eq (@($nm.Keys) -join ','))

    $added = Merge-EnvText -Text $orig -Changes @{ 'BCONNECT_NEW_THING' = 'x' }
    Check 'a key that was not there is appended' `
          ((ConvertFrom-EnvText -Text $added)['BCONNECT_NEW_THING'] -eq 'x')
    Check 'appending does not disturb the existing keys' `
          ((ConvertFrom-EnvText -Text $added)['BCONNECT_API_KEY'] -eq $DUMMY_KEY)

    $removed = Merge-EnvText -Text $orig -Remove @('BCONNECT_CA_CERT_PATH')
    Check 'a key can be removed explicitly' `
          (-not (ConvertFrom-EnvText -Text $removed).Contains('BCONNECT_CA_CERT_PATH'))

    $twice = Merge-EnvText -Text $one -Changes @{ 'BCONNECT_BASE_URL' = $BAD_URL2 }
    Check 're-applying the same change is byte-identical (idempotent)' ($twice -eq $one)

    $quoted = Merge-EnvText -Text $orig -Changes @{ 'BCONNECT_API_KEY' = 'has#hash and spaces ' }
    Check 'a value needing quotes is quoted the same way New-EnvFileContent quotes it' `
          ($quoted -match '(?m)^BCONNECT_API_KEY="has#hash and spaces "\r?$')
    Check 'and Node reads back exactly what went in' `
          ((ConvertFrom-EnvText -Text $quoted)['BCONNECT_API_KEY'] -eq 'has#hash and spaces ')

    $map = Merge-EnvMap -Existing (ConvertFrom-EnvText -Text $orig) -Changes @{ 'BCONNECT_BASE_URL' = $BAD_URL2 }
    Check 'Merge-EnvMap moves only the keys in -Changes' `
          ($map['BCONNECT_BASE_URL'] -eq $BAD_URL2 -and $map['BCONNECT_API_KEY'] -eq $DUMMY_KEY -and $map.Count -eq $om.Count)
}

# =============================================================================
# 2. A re-run keeps every optional credential value  (audit F4)
# =============================================================================
# Measured against the unfixed tree, this exact scenario:
#   BCONNECT_CA_CERT_PATH   dropped
#   BCONNECT_V11_USERNAME   dropped
#   BCONNECT_V11_PASSWORD   dropped
#   MCP_GATEWAY_AUTH_TOKEN  dropped
#   BCONNECT_TIMEOUT_MS     dropped
# i.e. every one of the five below failed.
Group 'A re-run that changes the base URL keeps everything else (F4)'

$s2 = New-Scenario 'f4-credentials'
New-ScratchEnvFile $s2
New-ScratchClaudeConfig $s2
$p = @{} + $s2.Common
$p['Servers']      = 'bconnect-endpoints'
$p['Hosts']        = 'claude-desktop'
$p['BaseUrl']      = $BAD_URL2
$p['ApiKeySecure'] = "#RAW#(ConvertTo-SecureString '$DUMMY_KEY2' -AsPlainText -Force)"
$r2 = Invoke-Engine -Params $p -Work $s2.Root

$m2 = @{}
try { $m2 = Read-BConnectEnvMap -EnvFile $s2.EnvFile } catch { }
Check 'the base URL actually changed'      ($m2['BCONNECT_BASE_URL'] -eq $BAD_URL2) ("saw: " + $m2['BCONNECT_BASE_URL'])
Check 'the API key actually changed'       ($m2['BCONNECT_API_KEY'] -eq $DUMMY_KEY2)
Check 'BCONNECT_CA_CERT_PATH survives'     ([bool]$m2['BCONNECT_CA_CERT_PATH'])
Check 'BCONNECT_V11_USERNAME survives'     ($m2['BCONNECT_V11_USERNAME'] -eq 'svc-bconnect@corp.local')
Check 'BCONNECT_V11_PASSWORD survives'     ($m2['BCONNECT_V11_PASSWORD'] -eq $DUMMY_V11P)
Check 'MCP_GATEWAY_AUTH_TOKEN survives'    ($m2['MCP_GATEWAY_AUTH_TOKEN'] -eq $DUMMY_TOKEN)
Check 'a hand-added BCONNECT_TIMEOUT_MS survives' ($m2['BCONNECT_TIMEOUT_MS'] -eq '90000')

# =============================================================================
# 3. A re-run keeps the write gate  (audit F5)
# =============================================================================
# Measured against the unfixed tree: Step 8 printed
#   [ ok ] read-only -- no -WriteGate given, so ALLOW_WRITE_OPERATIONS is not set anywhere
# and Step 9 printed "updated bconnect-jobs". Both gate keys were gone from the
# written config and the word "removed" appeared nowhere.
Group 'A re-run without -WriteGate keeps the write gate (F5)'

$s3 = New-Scenario 'f5-writegate'
New-ScratchEnvFile $s3
New-ScratchClaudeConfig $s3 -TopLevel @{ 'coworkUserFilesPath' = 'C:\somewhere' } -McpServers @{
    'bconnect-jobs' = @{
        command = 'node'
        args    = @('--env-file=' + $s3.EnvFile, (Join-Path $SuiteRoot 'bconnect-jobs-mcp\build\index.js'))
        env     = @{ 'ALLOW_WRITE_OPERATIONS' = 'true'
                     'ALLOWED_WRITE_TOOLS'    = 'create_job_instance,start_job_instance' }
    }
    'someone-elses-server' = @{ command = 'node'; args = @('other.js') }
}
$p = @{} + $s3.Common
$p['Servers'] = 'bconnect-endpoints,bconnect-jobs'
$p['Hosts']   = 'claude-desktop'
$r3 = Invoke-Engine -Params $p -Work $s3.Root

$cfg3 = Get-ConfigServers $s3.ConfigPath
Check 'ALLOW_WRITE_OPERATIONS survives a re-run that never mentioned it' `
      ((Get-EnvBlock $cfg3 'bconnect-jobs' 'ALLOW_WRITE_OPERATIONS') -eq 'true')
Check 'ALLOWED_WRITE_TOOLS survives, exactly' `
      ((Get-EnvBlock $cfg3 'bconnect-jobs' 'ALLOWED_WRITE_TOOLS') -eq 'create_job_instance,start_job_instance')
Check 'the run SAYS the gate was kept rather than staying silent' `
      ($r3.Output -match '(?i)kept|preserved|unchanged')
Check 'an unrelated MCP server is untouched' `
      ([bool]($cfg3.PSObject.Properties.Name -contains 'someone-elses-server'))

# Explicit disable, which must be possible and must be loud.
$p = @{} + $s3.Common
$p['Servers']   = 'bconnect-endpoints,bconnect-jobs'
$p['Hosts']     = 'claude-desktop'
$p['WriteGate'] = @{ 'bconnect-jobs' = @() }
$r3b = Invoke-Engine -Params $p -Work $s3.Root
$cfg3b = Get-ConfigServers $s3.ConfigPath
Check 'an explicit empty allowlist REMOVES the gate' `
      ($null -eq (Get-EnvBlock $cfg3b 'bconnect-jobs' 'ALLOW_WRITE_OPERATIONS'))
Check 'and the run says "removed" out loud' ($r3b.Output -match '(?i)write gate removed|removed the write gate|writes removed')

# =============================================================================
# 4. The installation record
# =============================================================================
# Measured against the unfixed tree: install\state\ does not exist and nothing in
# install\ writes it -- `grep -rn installation.json install\` returned nothing.
Group 'The installation record'

$s4 = New-Scenario 'record'
New-ScratchEnvFile $s4
New-ScratchClaudeConfig $s4
$p = @{} + $s4.Common
$p['Servers'] = 'bconnect-endpoints,bconnect-jobs'
$p['Hosts']   = 'claude-desktop,vscode'
$r4 = Invoke-Engine -Params $p -Work $s4.Root

$rec = $null
if (Test-Path -LiteralPath $s4.StateFile) {
    $recText = Get-Content -LiteralPath $s4.StateFile -Raw
    $rec = $recText | ConvertFrom-Json
}
Check 'a record is written after a successful run' ($null -ne $rec) $s4.StateFile
if ($rec) {
    Check 'it is schema 1' ($rec.schema -eq 1)
    Check 'it records both configured hosts' `
          ((@($rec.hosts | Select-Object -ExpandProperty id) -join ',') -match 'claude-desktop' -and
           (@($rec.hosts | Select-Object -ExpandProperty id) -join ',') -match 'vscode')
    Check 'it records the selected servers' `
          ([bool]$rec.servers.'bconnect-endpoints' -and [bool]$rec.servers.'bconnect-jobs')
    Check 'it records the v1.1 username (an identity, not a secret)' `
          ($rec.credentials.v11.username -eq 'svc-bconnect@corp.local')
    Check 'it records that a gateway token exists WITHOUT the token' `
          (-not (Test-TextContainsSecret -Text $recText -Secret $DUMMY_TOKEN))
    Check 'no API key value anywhere in the record'  (-not (Test-TextContainsSecret -Text $recText -Secret $DUMMY_KEY))
    Check 'no v1.1 password anywhere in the record'  (-not (Test-TextContainsSecret -Text $recText -Secret $DUMMY_V11P))
    Check 'it carries a per-entry hash for anti-clobber' `
          ([bool]($rec.hosts | Where-Object { $_.id -eq 'claude-desktop' }).entryHashes.'bconnect-jobs')
}

# The point of recording hosts: a later run that says nothing about -Hosts must
# still reach every host that was configured. Measured unfixed: $SelectedHosts
# defaults to claude-desktop alone, so the vscode file was left stale.
$vscodePath = Join-Path $s4.ProjectDir '.vscode\mcp.json'
$beforeVs = ''
if (Test-Path -LiteralPath $vscodePath) { $beforeVs = Get-Content -LiteralPath $vscodePath -Raw }
$p = @{} + $s4.Common
$p['WriteGate'] = @{ 'bconnect-jobs' = @('create_job_instance') }
$r4b = Invoke-Engine -Params $p -Work $s4.Root
$afterVs = ''
if (Test-Path -LiteralPath $vscodePath) { $afterVs = Get-Content -LiteralPath $vscodePath -Raw }
Check 'a re-run with no -Hosts still reaches the recorded vscode target (F6)' `
      ($afterVs -match 'ALLOWED_WRITE_TOOLS') ('vscode file changed: ' + [bool]($afterVs -ne $beforeVs))
Check 'a re-run with no -Servers keeps the recorded selection (F15)' `
      ($null -ne (Get-ConfigServers $s4.ConfigPath).'bconnect-jobs')

# =============================================================================
# 5. Adoption and drift  (section 2.5, rows 1 and 3)
# =============================================================================
Group 'Adoption, drift and status'

if (-not (Test-Path -LiteralPath $Bconnect)) {
    Check 'install\bconnect.ps1 exists (the verb front end of section 2.3)' $false 'not present'
} else {
    $st = Invoke-Engine -Script $Bconnect -Positional @('status') -Params $s4.Verb -Work $s4.Root
    Check 'bconnect status exits 0'            ($st.Code -eq 0) ("exit $($st.Code)")
    Check 'bconnect status names the servers'  ($st.Output -match 'bconnect-jobs')
    Check 'bconnect status names the hosts'    ($st.Output -match 'vscode')
    Check 'bconnect status reports the write gate it found' ($st.Output -match '(?i)writes')

    # Adoption: an install that predates the record. This is the upgrade path for
    # every installation that exists today.
    Remove-Item -LiteralPath $s4.StateFile -Force
    $ad = Invoke-Engine -Script $Bconnect -Positional @('status') -Params $s4.Verb -Work $s4.Root
    Check 'with no record, status ADOPTS one from the host config + env file' `
          ($ad.Output -match '(?i)adopt')
    Check 'and the adopted view still names the configured servers' ($ad.Output -match 'bconnect-jobs')

    # Drift: a hand edit to a managed entry.
    $p = @{} + $s4.Common
    $r4c = Invoke-Engine -Params $p -Work $s4.Root       # rebuild the record
    $raw = Get-Content -LiteralPath $s4.ConfigPath -Raw | ConvertFrom-Json
    $raw.mcpServers.'bconnect-jobs'.args = @('--hand-edited', 'by-the-operator')
    ($raw | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $s4.ConfigPath -Encoding UTF8
    $dr = Invoke-Engine -Script $Bconnect -Positional @('status') -Params $s4.Verb -Work $s4.Root
    Check 'status detects a hand-edited managed entry (entry hash mismatch)' `
          ($dr.Output -match '(?i)hand|edited|drift')
}

# =============================================================================
# 6. Uninstall  (section 2.9)
# =============================================================================
# Measured against the unfixed tree: `grep -rn Uninstall install\` returned
# nothing at all, so all of these failed.
Group 'Uninstall'

$s6 = New-Scenario 'uninstall'
New-ScratchEnvFile $s6
New-ScratchClaudeConfig $s6 -TopLevel @{ 'coworkUserFilesPath' = 'C:\somewhere' } -McpServers @{
    'someone-elses-server' = @{ command = 'node'; args = @('other.js') }
}
$p = @{} + $s6.Common
$p['Servers'] = 'bconnect-endpoints,bconnect-jobs'
$p['Hosts']   = 'claude-desktop,vscode'
$null = Invoke-Engine -Params $p -Work $s6.Root
$beforeTop = (Get-Content -LiteralPath $s6.ConfigPath -Raw | ConvertFrom-Json).coworkUserFilesPath

$un = Invoke-Engine -Script $Bconnect -Positional @('uninstall') -Params ($s6.Verb + @{ Yes = $true }) -Work $s6.Root
$cfg6 = Get-ConfigServers $s6.ConfigPath
$vs6  = Join-Path $s6.ProjectDir '.vscode\mcp.json'
Check 'uninstall exits 0' ($un.Code -eq 0) ("exit $($un.Code)")
Check 'every bconnect-* entry is gone from Claude Desktop' `
      ($null -eq $cfg6 -or -not (@($cfg6.PSObject.Properties.Name) -like 'bconnect-*'))
Check 'and from the second recorded host' `
      (-not (Test-Path -LiteralPath $vs6) -or -not ((Get-Content -LiteralPath $vs6 -Raw) -match '"bconnect-'))
Check 'the unrelated MCP server is left in place' `
      ([bool]($cfg6 -and $cfg6.PSObject.Properties.Name -contains 'someone-elses-server'))
Check 'the unrelated top-level key is byte-identical' `
      ((Get-Content -LiteralPath $s6.ConfigPath -Raw | ConvertFrom-Json).coworkUserFilesPath -eq $beforeTop)
Check 'the credentials file is gone' (-not (Test-Path -LiteralPath $s6.EnvFile))
Check 'the record is gone'           (-not (Test-Path -LiteralPath $s6.StateFile))
Check 'it says the bMS API key can only be revoked in the console' `
      ($un.Output -match '(?i)revoke')
Check 'it lists what it did NOT remove' ($un.Output -match '(?i)not removed|did not remove')
Check 'it names node_modules and the build output as left behind' `
      ($un.Output -match 'node_modules' -and $un.Output -match '(?i)build')

# -KeepCredentials
$s6b = New-Scenario 'uninstall-keep'
New-ScratchEnvFile $s6b
New-ScratchClaudeConfig $s6b
$p = @{} + $s6b.Common
$p['Servers'] = 'bconnect-endpoints'
$p['Hosts']   = 'claude-desktop'
$null = Invoke-Engine -Params $p -Work $s6b.Root
$un2 = Invoke-Engine -Script $Bconnect -Positional @('uninstall') `
        -Params ($s6b.Verb + @{ Yes = $true; KeepCredentials = $true }) -Work $s6b.Root
Check '-KeepCredentials leaves the credentials file in place' (Test-Path -LiteralPath $s6b.EnvFile)
Check 'and says so, with the path' ($un2.Output -match '(?i)kept|left in place')

# =============================================================================
# 7. The verbs  (section 2.7)
# =============================================================================
Group 'The verb surface'

$s7 = New-Scenario 'verbs'
New-ScratchEnvFile $s7
New-ScratchClaudeConfig $s7
$p = @{} + $s7.Common
$p['Servers'] = 'bconnect-endpoints,bconnect-jobs'
$p['Hosts']   = 'claude-desktop'
$null = Invoke-Engine -Params $p -Work $s7.Root

if (Test-Path -LiteralPath $Bconnect) {
    $cfgBefore = Get-Content -LiteralPath $s7.ConfigPath -Raw
    # -IgnoreUnreachable because the scratch URL deliberately does not resolve. A
    # credential-facing verb STOPS on an unreachable bConnect by default -- that is
    # the point of it -- while writes/hosts/servers verbs do not, because an
    # operator must not be unable to turn writes OFF while the bMS is down.
    $su = Invoke-Engine -Script $Bconnect -Positional @('set', 'url', $BAD_URL2) `
            -Params ($s7.Verb + @{ IgnoreUnreachable = $true }) -Work $s7.Root
    $m7 = Read-BConnectEnvMap -EnvFile $s7.EnvFile
    Check 'bconnect set url changes the base URL'    ($m7['BCONNECT_BASE_URL'] -eq $BAD_URL2) ("saw " + $m7['BCONNECT_BASE_URL'])
    Check 'and keeps the v1.1 credential'            ($m7['BCONNECT_V11_PASSWORD'] -eq $DUMMY_V11P)
    Check 'and changes NO host file (section 2.7 row 1)'    ((Get-Content -LiteralPath $s7.ConfigPath -Raw) -eq $cfgBefore)

    $we = Invoke-Engine -Script $Bconnect -Positional @('writes', 'enable', 'bconnect-jobs', 'create_job_instance') `
            -Params $s7.Verb -Work $s7.Root
    $cfg7 = Get-ConfigServers $s7.ConfigPath
    Check 'bconnect writes enable sets the gate on that one server' `
          ((Get-EnvBlock $cfg7 'bconnect-jobs' 'ALLOWED_WRITE_TOOLS') -eq 'create_job_instance')
    Check 'and leaves the other server read-only' `
          ($null -eq (Get-EnvBlock $cfg7 'bconnect-endpoints' 'ALLOW_WRITE_OPERATIONS'))

    $wd = Invoke-Engine -Script $Bconnect -Positional @('writes', 'disable', 'bconnect-jobs') `
            -Params $s7.Verb -Work $s7.Root
    $cfg7b = Get-ConfigServers $s7.ConfigPath
    Check 'bconnect writes disable removes it again' `
          ($null -eq (Get-EnvBlock $cfg7b 'bconnect-jobs' 'ALLOW_WRITE_OPERATIONS'))

    $sa = Invoke-Engine -Script $Bconnect -Positional @('servers', 'add', 'bconnect-compliance') `
            -Params $s7.Verb -Work $s7.Root
    $cfg7c = Get-ConfigServers $s7.ConfigPath
    Check 'bconnect servers add adds one without disturbing the others' `
          ($null -ne $cfg7c.'bconnect-compliance' -and $null -ne $cfg7c.'bconnect-jobs' -and $null -ne $cfg7c.'bconnect-endpoints')

    $sr = Invoke-Engine -Script $Bconnect -Positional @('servers', 'remove', 'bconnect-compliance') `
            -Params $s7.Verb -Work $s7.Root
    $cfg7d = Get-ConfigServers $s7.ConfigPath
    Check 'bconnect servers remove removes exactly that one' `
          ($null -eq $cfg7d.'bconnect-compliance' -and $null -ne $cfg7d.'bconnect-jobs')

    $ha = Invoke-Engine -Script $Bconnect -Positional @('hosts', 'add', 'cursor') `
            -Params $s7.Verb -Work $s7.Root
    Check 'bconnect hosts add emits the new host' `
          (Test-Path -LiteralPath (Join-Path $s7.ProjectDir '.cursor\mcp.json'))
    Check 'and records it, so the next run reaches it too' `
          ((Get-Content -LiteralPath $s7.StateFile -Raw) -match 'cursor')

    $bad = Invoke-Engine -Script $Bconnect -Positional @('frobnicate') -Params $s7.Verb -Work $s7.Root
    Check 'an unknown verb exits non-zero and lists the verbs' `
          ($bad.Code -ne 0 -and $bad.Output -match 'uninstall')
}

# =============================================================================
# 8. Partially broken installs  (section 2.5)
# =============================================================================
Group 'Starting from a partially broken install'

# Record present, host file missing.
$s8 = New-Scenario 'broken-missing-host'
New-ScratchEnvFile $s8
New-ScratchClaudeConfig $s8
$p = @{} + $s8.Common
$p['Servers'] = 'bconnect-endpoints'
$p['Hosts']   = 'claude-desktop'
$null = Invoke-Engine -Params $p -Work $s8.Root
Remove-Item -LiteralPath $s8.ConfigPath -Force
if (Test-Path -LiteralPath $Bconnect) {
    $mh = Invoke-Engine -Script $Bconnect -Positional @('status') -Params $s8.Verb -Work $s8.Root
    Check 'a recorded host file that has vanished is reported, not an error' `
          ($mh.Code -eq 0 -and $mh.Output -match '(?i)missing')
    $rs = Invoke-Engine -Script $Bconnect -Positional @('hosts', 'resync') -Params $s8.Verb -Work $s8.Root
    Check 'hosts resync re-emits it from the record' (Test-Path -LiteralPath $s8.ConfigPath)
}

# Credentials file present but unreadable: must NOT be silently overwritten.
$s8b = New-Scenario 'broken-unreadable-creds'
New-Item -ItemType Directory -Path $s8b.SecretsDir -Force | Out-Null
Set-HardenedDirectoryAcl -Path $s8b.SecretsDir
Set-Content -LiteralPath (Join-Path $s8b.SecretsDir 'bconnect.env.dpapi') `
            -Value "BCONNECT_PROTECTED_V=1`r`nBCONNECT_PROTECTED_DATA=bm90LWEtcmVhbC1ibG9i`r`n" -Encoding UTF8
New-ScratchClaudeConfig $s8b
$p = @{} + $s8b.Common
$p['Servers']      = 'bconnect-endpoints'
$p['Hosts']        = 'claude-desktop'
$p['BaseUrl']      = $BAD_URL
$p['ApiKeySecure'] = "#RAW#(ConvertTo-SecureString '$DUMMY_KEY' -AsPlainText -Force)"
$r8b = Invoke-Engine -Params $p -Work $s8b.Root
Check 'an undecryptable credentials file is NOT overwritten without -Force' `
      ((Test-Path -LiteralPath (Join-Path $s8b.SecretsDir 'bconnect.env.dpapi')) -and $r8b.Code -ne 0) `
      ("exit $($r8b.Code)")
Check 'and the message names the likely cause (wrong account / wrong machine)' `
      ($r8b.Output -match '(?i)account' -and $r8b.Output -match '(?i)-Force')

# Servers configured that are not in the catalogue: leave alone, list as unmanaged.
$s8c = New-Scenario 'broken-unknown-server'
New-ScratchEnvFile $s8c
New-ScratchClaudeConfig $s8c -McpServers @{
    'bconnect-fictional' = @{ command = 'node'; args = @('nope.js') }
}
$p = @{} + $s8c.Common
$p['Servers'] = 'bconnect-endpoints'
$p['Hosts']   = 'claude-desktop'
$r8c = Invoke-Engine -Params $p -Work $s8c.Root
$cfg8c = Get-ConfigServers $s8c.ConfigPath
Check 'a bconnect-* entry that is not in the catalogue is left alone' `
      ([bool]($cfg8c.PSObject.Properties.Name -contains 'bconnect-fictional'))
Check 'and is named as unmanaged rather than silently ignored' `
      ($r8c.Output -match '(?i)unmanaged')

# =============================================================================
# 9. Client neutrality: what a no-argument run does, and what it says at the end
# =============================================================================
# Measured against the unfixed tree: $SelectedHosts defaulted to @('claude-desktop')
# whatever the machine looked like, merge-config.mjs had no mkdirSync, and a run
# on a machine that had never had that client ended in an uncaught ENOENT after
# credentials, probe and build. The closing block was outside every conditional,
# so a -Hosts vscode run finished by telling the operator to quit a tray icon
# they do not have and printed a Claude Desktop path as the run's headline
# artefact.
#
# Both scenarios below point EVERY user-scope target at the scratch tree, because
# detection reads $env:USERPROFILE for Continue and this test must not depend on,
# or write into, whatever the machine running it happens to have installed.
Group 'No -Hosts: detect, else the portable target (CN-2)'

$s9 = New-Scenario 'cn2-nothing-detected'
New-ScratchEnvFile $s9
$absent = Join-Path $s9.Root 'no-such-client'
$p = @{} + $s9.Common
$p['ConfigPath'] = Join-Path $absent 'claude_desktop_config.json'
$p['HostPath']   = @{ 'continue' = (Join-Path $absent 'continue\bconnect-mcp.yaml') }
$p['Servers']    = 'bconnect-endpoints'
$r9 = Invoke-Engine -Params $p -Work $s9.Root

Check 'a run with no client on the machine still finishes' ($r9.Code -eq 0) `
      (($r9.Output -split "`r?`n" | Where-Object { $_ -match 'FAIL|ENOENT' } | Select-Object -First 3) -join ' / ')
Check 'and never emits a raw Node stack trace' ($r9.Output -notmatch 'ENOENT|node:fs:') `
      (($r9.Output -split "`r?`n" | Where-Object { $_ -match 'ENOENT|node:fs:' } | Select-Object -First 2) -join ' / ')
Check 'it says no client was detected, and names what it configured instead' `
      ($r9.Output -match '(?i)no MCP client detected' -and $r9.Output -match '(?m)^\s*targets: generic\s*$') `
      (($r9.Output -split "`r?`n" | Where-Object { $_ -match '(?i)targets:' } | Select-Object -First 1))
Check 'and falls back to the portable target, not to a named vendor' `
      (Test-Path -LiteralPath (Join-Path $s9.HostOutDir 'generic.md'))
Check 'no vendor configuration directory was invented' `
      (-not (Test-Path -LiteralPath $absent)) $absent

$s9b = New-Scenario 'cn2-detected'
New-ScratchEnvFile $s9b
$p = @{} + $s9b.Common
$p['HostPath'] = @{ 'continue' = (Join-Path $s9b.Root 'no-such-client\continue.yaml') }
$p['Servers']  = 'bconnect-endpoints'
$r9b = Invoke-Engine -Params $p -Work $s9b.Root
Check 'a client whose configuration directory exists IS detected' `
      ($r9b.Output -match '(?i)hosts detected on this machine' -and $r9b.Output -match 'claude-desktop')
Check 'and it is configured' (Test-Path -LiteralPath $s9b.ConfigPath)

Group 'The closing guidance follows what was configured (INST-3 / CN-9)'

$s10 = New-Scenario 'inst3-closing'
New-ScratchEnvFile $s10
$p = @{} + $s10.Common
$p['Hosts']   = 'vscode'
$p['Servers'] = 'bconnect-endpoints'
$r10 = Invoke-Engine -Params $p -Work $s10.Root
$vscodePath = Join-Path $s10.ProjectDir '.vscode\mcp.json'

Check 'a vscode-only run is not told to quit a tray icon it does not have' `
      ($r10.Output -notmatch '(?i)system-tray') `
      (($r10.Output -split "`r?`n" | Where-Object { $_ -match '(?i)system-tray' } | Select-Object -First 1))
Check 'and Claude Desktop is not named anywhere in the closing guidance' `
      ($r10.Output -notmatch '(?i)quit Claude Desktop')
Check 'the configured client IS named' ($r10.Output -match '(?i)VS Code')
Check 'and the path printed is the one that was written' `
      ($r10.Output -match [regex]::Escape($vscodePath)) $vscodePath
Check 'the Claude Desktop path is NOT printed as the run summary' `
      ($r10.Output -notmatch [regex]::Escape($s10.ConfigPath)) $s10.ConfigPath

# The control: with claude-desktop actually selected, the tray instruction is
# exactly right and must still be there. Without this, deleting the paragraph
# outright would score four passes above.
$s10b = New-Scenario 'inst3-closing-control'
New-ScratchEnvFile $s10b
$p = @{} + $s10b.Common
$p['Hosts']   = 'claude-desktop'
$p['Servers'] = 'bconnect-endpoints'
$r10b = Invoke-Engine -Params $p -Work $s10b.Root
Check 'CONTROL: a claude-desktop run still gets the tray-icon instruction' `
      ($r10b.Output -match '(?i)system-tray')

Group 'A per-project target is not written into the installation directory (CN-4 / INST-6)'

# $ProjectRoot is the installer's parent. Passing it explicitly is the exact value
# the old default produced, and it must now be refused rather than quietly used.
$s11 = New-Scenario 'cn4-projectdir'
New-ScratchEnvFile $s11
$p = @{} + $s11.Common
$p['Hosts']      = 'vscode'
$p['Servers']    = 'bconnect-endpoints'
$p['ProjectDir'] = Split-Path -Parent $InstallerDir
$r11 = Invoke-Engine -Params $p -Work $s11.Root
# Not on the exit code alone: verification starts the servers against a base URL
# that does not resolve, so a run that wrote the file in the wrong place also ends
# non-zero. The refusal has to be the reason.
Check 'the installation directory is refused as a workspace' `
      ($r11.Code -ne 0 -and $r11.Output -match '(?i)refusing to write a per-project host config') `
      (($r11.Output -split "`r?`n" | Select-Object -Last 6) -join ' / ')
Check 'and the refusal says what to pass instead' ($r11.Output -match '(?i)-ProjectDir')
Check 'nothing was written there' `
      (-not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $InstallerDir) '.vscode\mcp.json')))

# Non-interactive with no answer at all is the wizard's path, and must be a named
# error rather than a silent default.
$s11b = New-Scenario 'cn4-projectdir-missing'
New-ScratchEnvFile $s11b
$p = @{} + $s11b.Common
$p.Remove('ProjectDir')
$p['Hosts']   = 'vscode'
$p['Servers'] = 'bconnect-endpoints'
$r11b = Invoke-Engine -Params $p -Work $s11b.Root
Check 'a per-project target with no -ProjectDir is a named error, not a default' `
      ($r11b.Code -ne 0 -and $r11b.Output -match '(?i)ProjectDir is required')
# The control. Without it, a blanket refusal of every per-project target would
# score three passes above. Exit code is NOT the assertion here: verification
# starts the servers, and the base URL in this tree does not resolve, so a
# correct run still ends non-zero. What is asserted is that the workspace was
# accepted and the file landed in it.
$r11c = Invoke-Engine -Params (@{} + $s11.Common + @{ Hosts = 'vscode'; Servers = 'bconnect-endpoints' }) -Work $s11.Root
Check 'CONTROL: a real workspace is accepted' `
      ($r11c.Output -notmatch '(?i)refusing to write a per-project host config' -and
       $r11c.Output -match '(?i)per-project configs will be written under') `
      (($r11c.Output -split "`r?`n" | Where-Object { $_ -match '(?i)ProjectDir|per-project' } | Select-Object -First 2) -join ' / ')
Check 'CONTROL: and the config landed in that workspace' `
      (Test-Path -LiteralPath (Join-Path $s11.ProjectDir '.vscode\mcp.json'))

Group 'Keys the suite no longer reads are removed on a re-run (INST-2 / INST-12)'

# BCONNECT_SKIP_CONNECTIVITY_CHECK disables the startup probe AND, with it, the
# check that the connected bMS is a release this suite supports; BCONNECT_RELEASE
# is read by nothing. Merge-EnvText preserves unknown keys by design -- which is
# right for a hand-added BCONNECT_TIMEOUT_MS and wrong for these two -- so a
# re-run has to drop them by name.
$s12 = New-Scenario 'inst12-stale-keys'
New-ScratchEnvFile $s12
$staleText = (Get-Content -LiteralPath $s12.EnvFile -Raw) +
             "BCONNECT_SKIP_CONNECTIVITY_CHECK=true`r`nBCONNECT_RELEASE=26R1`r`n"
Write-SecretFileAtomic -Path $s12.EnvFile -Content $staleText
$before = Read-BConnectEnvMap -EnvFile $s12.EnvFile
Check 'CONTROL: the stale keys really are on disk to begin with' `
      ($before['BCONNECT_SKIP_CONNECTIVITY_CHECK'] -eq 'true' -and $before['BCONNECT_RELEASE'] -eq '26R1')

$p = @{} + $s12.Common
$p['Hosts']        = 'claude-desktop'
$p['Servers']      = 'bconnect-endpoints'
$p['BaseUrl']      = $BAD_URL2
$p['ApiKeySecure'] = "#RAW#(ConvertTo-SecureString '$DUMMY_KEY2' -AsPlainText -Force)"
$r12 = Invoke-Engine -Params $p -Work $s12.Root
$after = @{}
try { $after = Read-BConnectEnvMap -EnvFile $s12.EnvFile } catch { }
Check 'BCONNECT_SKIP_CONNECTIVITY_CHECK is dropped' `
      (-not $after.Contains('BCONNECT_SKIP_CONNECTIVITY_CHECK')) `
      ('still: ' + $after['BCONNECT_SKIP_CONNECTIVITY_CHECK'])
Check 'BCONNECT_RELEASE is dropped' (-not $after.Contains('BCONNECT_RELEASE')) `
      ('still: ' + $after['BCONNECT_RELEASE'])
Check 'a hand-added key is still NOT dropped -- this is by name, not a purge' `
      ($after['BCONNECT_TIMEOUT_MS'] -eq '90000')
Check 'and the v1.1 credentials are untouched' ($after['BCONNECT_V11_PASSWORD'] -eq $DUMMY_V11P)

Group 'The derived v1.1 root is shown before it is blamed on a credential (INST-10)'

# v1.1 lives beside the v2.0 base and its address is derived by stripping
# /bconnect -- but Test-BaseUrlShape only WARNS when a base URL does not end that
# way, and offers "use it anyway?". A customer behind a reverse proxy or a renamed
# virtual directory accepted that, got a 401 from v1.1, and was handed a diagnosis
# naming only group membership and UPN form: two reasons to go and change a
# privileged domain account over what is actually a URL.
$s14 = New-Scenario 'inst10-v11root'
New-ScratchEnvFile $s14
$p = @{} + $s14.Common
$p['Hosts']   = 'claude-desktop'
$p['Servers'] = 'bconnect-endpoints'
$r14 = Invoke-Engine -Params $p -Work $s14.Root
Check 'the derived v1.1 root is printed, not just used' `
      ($r14.Output -match '(?i)v1\.1 root:\s*https://bms\.invalid\.example/bConnect\b') `
      (($r14.Output -split "`r?`n" | Where-Object { $_ -match '(?i)v1\.1 root' } | Select-Object -First 1))
Check 'and it says the address was derived rather than configured' `
      ($r14.Output -match '(?i)v1\.1 root:.*derived')

# The case the derivation does not fit. The base URL is accepted with a warning,
# so the wrong address has to be visible on screen -- it is the only warning the
# operator gets before the 401 diagnosis sends them elsewhere.
$s14b = New-Scenario 'inst10-v11root-odd'
New-ScratchEnvFile $s14b
$oddUrl = 'https://proxy.invalid.example/mcp-api'
$p = @{} + $s14b.Common
$p['Hosts']          = 'claude-desktop'
$p['Servers']        = 'bconnect-endpoints'
$p['BaseUrl']        = $oddUrl
$p['ApiKeySecure']   = "#RAW#(ConvertTo-SecureString '$DUMMY_KEY2' -AsPlainText -Force)"
$p['V11User']        = 'svc-bconnect@corp.local'
$p['V11PassSecure']  = "#RAW#(ConvertTo-SecureString '$DUMMY_V11P' -AsPlainText -Force)"
$r14b = Invoke-Engine -Params $p -Work $s14b.Root
Check 'a base URL the derivation does not fit still shows what v1.1 will be addressed as' `
      ($r14b.Output -match '(?i)v1\.1 root:\s*' + [regex]::Escape($oddUrl) + '/bConnect') `
      (($r14b.Output -split "`r?`n" | Where-Object { $_ -match '(?i)v1\.1 root' } | Select-Object -First 1))
Check 'and the shape warning that let it through is still raised' `
      ($r14b.Output -match '(?i)does not end in /bconnect')

Group 'The offline bundle manifest is READ, not just written (INST-5)'

# It recorded nodeVersion, per-package built flags and a target procedure, and
# nothing anywhere consumed it -- the string 'offline-bundle' appeared once in the
# whole tree, on the line that wrote it. An air-gapped install is the one case
# where nobody from our side is present, so a truncated copy, a bundle built under
# a different Node major, or a gateway that silently did not compile has to be
# caught here or not at all.
$s13 = New-Scenario 'inst5-bundle'
New-ScratchEnvFile $s13
$bundleRoot = Join-Path $s13.Root 'bundle'
New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null
$artefact = Join-Path $bundleRoot 'payload.js'
'console.log("bundled");' | Set-Content -LiteralPath $artefact -Encoding UTF8
$goodHash = (Get-FileHash -LiteralPath $artefact -Algorithm SHA256).Hash
$manifestPath = Join-Path $bundleRoot 'offline-bundle.json'

function Write-TestManifest {
    param([hashtable] $Files, [string] $NodeVersion, [bool] $GatewayBuilt = $true)
    ([ordered]@{
        manifestVersion = 2
        created         = (Get-Date).ToString('o')
        nodeVersion     = $NodeVersion
        suiteVersion    = '0.0.0-test'
        gatewayBuilt    = $GatewayBuilt
        buildFailures   = @()
        hashAlgorithm   = 'SHA256'
        files           = $Files
    } | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $manifestPath -Encoding UTF8
}
$thisNode = (& node -v)

Write-TestManifest -Files @{ 'payload.js' = $goodHash } -NodeVersion $thisNode
$p = @{} + $s13.Common
$p['Hosts']          = 'claude-desktop'
$p['Servers']        = 'bconnect-endpoints'
$p['BundleManifest'] = $manifestPath
$r13 = Invoke-Engine -Params $p -Work $s13.Root
Check 'CONTROL: a manifest that matches is verified and says so' `
      ($r13.Output -match '(?i)bundle integrity: 1 file\(s\) match') `
      (($r13.Output -split "`r?`n" | Where-Object { $_ -match '(?i)bundle' } | Select-Object -First 3) -join ' / ')

# A file that changed after the bundle was built -- what a truncated or resumed
# copy looks like from here.
'console.log("tampered");' | Set-Content -LiteralPath $artefact -Encoding UTF8
$r13b = Invoke-Engine -Params $p -Work $s13.Root
# The exit code alone means nothing here -- verification fails against this tree's
# unresolvable base URL regardless -- so the integrity verdict is what is asserted.
Check 'a changed file stops the install' `
      ($r13b.Code -ne 0 -and $r13b.Output -match '(?i)does not match the manifest') `
      (($r13b.Output -split "`r?`n" | Where-Object { $_ -match '(?i)bundle|manifest' } | Select-Object -First 3) -join ' / ')
Check 'and names the file rather than just failing' ($r13b.Output -match 'payload\.js')

# Missing entirely.
Remove-Item -LiteralPath $artefact -Force
$r13c = Invoke-Engine -Params $p -Work $s13.Root
Check 'a missing file stops the install' `
      ($r13c.Code -ne 0 -and $r13c.Output -match '(?i)does not match the manifest' -and $r13c.Output -match '(?i)missing')

# Node major mismatch is a warning, not a refusal: it is a real risk for a native
# dependency and not a certainty, and refusing would strand an operator with no
# way to build anything on the target.
'console.log("bundled");' | Set-Content -LiteralPath $artefact -Encoding UTF8
Write-TestManifest -Files @{ 'payload.js' = $goodHash } -NodeVersion 'v18.20.0'
$r13d = Invoke-Engine -Params $p -Work $s13.Root
Check 'a different Node major is warned about, not silently accepted' `
      ($r13d.Output -match '(?i)built under Node v18')
Check 'and it is a warning, not a refusal' ($r13d.Output -notmatch '(?i)\[FAIL\].*Node v18')

# A gateway that did not compile cannot be compiled here, so selecting a target
# that needs it must stop rather than fail at first use.
Write-TestManifest -Files @{ 'payload.js' = $goodHash } -NodeVersion $thisNode -GatewayBuilt $false
$p2 = @{} + $p
$p2['Hosts']   = 'n8n'
$p2['Gateway'] = $true
$r13e = Invoke-Engine -Params $p2 -Work $s13.Root
Check 'a bundle whose gateway did not compile is refused for an HTTP target' `
      ($r13e.Code -ne 0 -and $r13e.Output -match '(?i)gateway did not compile')

Group 'The bMS release parser (INST-2)'

# Parsed out of the shipped script rather than copied here, so the test cannot
# drift away from the code it is about.
$instAst = [System.Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$null, [ref]$null)
$relFn = $instAst.Find({
    param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'ConvertTo-BmsRelease'
}, $true)
if (-not $relFn) {
    Check 'ConvertTo-BmsRelease is defined in the installer' $false
} else {
    Invoke-Expression $relFn.Extent.Text
    foreach ($case in @(
        @{ v = '26R1';         m = 26; r = 1 },
        @{ v = '26 r2';        m = 26; r = 2 },
        @{ v = 'bMS 2026 R1';  m = 26; r = 1 },
        @{ v = '26.1.180.0';   m = 26; r = 1 },
        @{ v = '25.2';         m = 25; r = 2 },
        @{ v = '27R1';         m = 27; r = 1 }
    )) {
        $got = ConvertTo-BmsRelease $case.v
        Check ("parses '$($case.v)' as $($case.m)R$($case.r)") `
              ($null -ne $got -and $got.Major -eq $case.m -and $got.Release -eq $case.r) `
              $(if ($got) { "$($got.Major)R$($got.Release)" } else { 'null' })
    }
    foreach ($bad in @('', 'unknown', 'baramundi')) {
        Check ("refuses to guess at '$bad'") ($null -eq (ConvertTo-BmsRelease $bad))
    }
    # The comparison the installer makes, asserted on the parsed pairs so a
    # boundary slip (25R2 accepted, 26R1 refused) cannot pass unnoticed.
    $meets = { param($x) $x.Major -gt 26 -or ($x.Major -eq 26 -and $x.Release -ge 1) }
    Check '25R2 does NOT meet the 26R1 minimum' (-not (& $meets (ConvertTo-BmsRelease '25R2')))
    Check '26R1 does'                            (& $meets (ConvertTo-BmsRelease '26R1'))
    Check '26R2 does'                            (& $meets (ConvertTo-BmsRelease '26R2'))
    Check '27R1 does'                            (& $meets (ConvertTo-BmsRelease '27R1'))
}

} finally {
    if (Test-Path -LiteralPath $WorkDir) {
        Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# -----------------------------------------------------------------------------
# The record secret guard, against JSON escaping (audit finding F5)
# -----------------------------------------------------------------------------
#
# The guard searched the SERIALISED text for the raw secret. ConvertTo-Json
# rewrites  as  and " as ", so a password containing either was written
# to a world-readable record and the guard said nothing. Both were confirmed
# leaking before the fix; the control below is what makes these meaningful --
# without it, a guard that refused EVERYTHING would score five passes.
Group "Record secret guard survives JSON escaping"
$g = Join-Path $env:TEMP ("bcguard-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $g | Out-Null
try {
    $controlPath = Join-Path $g "control.json"
    Write-InstallationRecord -Path $controlPath -Record ([ordered]@{ a = "nothing-secret-here" }) -MustNotContain @("absent-value") | Out-Null
    Check "CONTROL: a record with no secret still writes" (Test-Path $controlPath)

    foreach ($case in @(
        @{ n = "plain";               v = "simplepassword" },
        @{ n = "containing a backslash"; v = 'pw\with\backslash' },
        @{ n = "containing a quote";  v = 'pw"with"quote' },
        @{ n = "containing a tab";    v = "pw`twith`ttab" }
    )) {
        $p2 = Join-Path $g (($case.n -replace "[^a-zA-Z]","") + ".json")
        $threw = $false
        try { Write-InstallationRecord -Path $p2 -Record ([ordered]@{ note = $case.v }) -MustNotContain @($case.v) | Out-Null }
        catch { $threw = $true }
        Check ("refuses a secret " + $case.n) ($threw -and -not (Test-Path $p2))
    }

    # A secret buried inside a longer value, where no single value equals it.
    $p3 = Join-Path $g "nested.json"
    $threw = $false
    try { Write-InstallationRecord -Path $p3 -Record ([ordered]@{ conn = "user:innersecret@host" }) -MustNotContain @("innersecret") | Out-Null }
    catch { $threw = $true }
    Check "refuses a secret embedded inside a longer value" ($threw -and -not (Test-Path $p3))
} finally { Remove-Item $g -Recurse -Force -ErrorAction SilentlyContinue }

$elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
Write-Host ''
Write-Host ("  $script:Pass passed, $script:Fail failed   (${elapsed}s)") -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
if ($script:Fail) { exit 1 }
exit 0
