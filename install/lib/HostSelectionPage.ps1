<#
.SYNOPSIS
    The wizard's host-selection page: its data, its XAML, and its parameter mapping.

.DESCRIPTION
    Install-BConnectMcp-UI.ps1 dot-sources this file and shows the page returned by
    Get-HostSelectionXaml as its Clients page. The four functions stay separable so
    the page's data can be exercised without a window -- Get-HostSelectionCatalog
    reads only lib\hosts.json and environment variables, touches no credential, no
    bMS and no config file.

    THE LIST IS FILTERED BY THE DEPLOYMENT SHAPE the wizard asks for on its first
    page. Select-ShapeTargets does that, from each target's declared `transport` and
    nothing else; an unanswered or absent shape returns every target, which is what a
    console caller gets. The shape itself never reaches the engine as a parameter --
    it decides which clients are offered and whether -Gateway is passed, and those
    are the parameters the engine already had.

    Read HOST-WIZARD-PAGE.md next to this file for the page's contract. This file is
    the code half.

    NOTHING HERE RUNS AUTOMATICALLY. Dot-source it and call the three functions:

        . .\lib\HostSelectionPage.ps1
        $xaml     = Get-HostSelectionXaml
        $catalog  = Get-HostSelectionCatalog          # rows to bind
        $params   = ConvertTo-HostInstallerParameters -Selected @('claude-desktop','vscode') `
                                                       -ProjectDir 'C:\proj' -HostOutDir 'C:\out'

    The page is a straight analogue of the existing SERVER selection page: a list
    with checkboxes, a per-row cost/consequence column, and a live summary line. The
    one thing it must do that the server page does not is show HOW EACH TARGET WAS
    VERIFIED, because that is the honest content of this feature and burying it
    would defeat the purpose.

    No target is ticked by default. The suite serves whatever MCP client the customer
    runs, and a pre-ticked vendor is an answer the wizard has no business giving on
    the customer's behalf -- it is also how a file gets written for a client that is
    not on the machine. -Preselect exists for a caller that genuinely knows (an
    installation record naming what was configured last time); absent that, the
    operator chooses and Next stays disabled until they do.
#>

# Strict mode is set per function, not once at file scope: this file is dot-sourced
# into the wizard, and a file-scope Set-StrictMode would follow the dot-source into
# the caller's scope and change the rules under code that was never written for them.

function Select-ShapeTargets {
<#
.SYNOPSIS
    The targets that can work in a given deployment shape.
.DESCRIPTION
    THE RULE, AND WHY IT IS THE TRANSPORT AND NOTHING ELSE.

    An MCP server speaking stdio is a local process, started by the client
    application, on the machine that application runs on. A server reached over HTTP
    is a service somewhere else, fronted here by the gateway. Those are the two
    deployment shapes, and each target in lib\hosts.json already declares which of
    them it can do, in `transport`. So the filter is that field and no list of client
    names lives here or anywhere else.

        workstation  the assistant runs on the machine being installed, and starts
                     its servers there. Targets that can speak stdio: 'stdio', 'both'.
                     A target that can only be reached over HTTP is a hosted service
                     or a server product; it does not describe one person at one
                     computer, and offering it here is how an operator ends up with a
                     listening port on their workstation that nothing local needs.

        central      the servers run on this computer and clients reach them across
                     the network. Targets that can speak HTTP: 'http', 'both'. A
                     stdio-only target is excluded because it can ONLY start a local
                     process, and on this shape the servers are deliberately not on
                     the client's machine -- writing it a configuration would produce
                     exactly the silent failure the shape question exists to remove.

    An empty shape returns everything unchanged, which is what a console caller,
    ConvertTo-HostInstallerParameters and the engine's -ListHosts table all want: the
    shape is a wizard question, not a change to the registry.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowEmptyCollection()] $Targets,
        [ValidateSet('', 'workstation', 'central')] [string] $Shape = ''
    )
    if (-not $Shape) { return @($Targets) }
    $want = if ($Shape -eq 'workstation') { @('stdio', 'both') } else { @('http', 'both') }
    return @($Targets | Where-Object { $want -contains [string]$_.transport })
}

function Get-HostSelectionCatalog {
<#
.SYNOPSIS
    The rows to bind to the list, read from lib\hosts.json.
.DESCRIPTION
    Returns one PSCustomObject per target with everything the page displays:

        Id            'claude-code'
        Label         'Claude Code (CLI)'
        Rank          the row's position in the list. From hosts.json, which is the
                      only place the order lives; rows come back already in it
        Selected      $true only for the ids named in -Preselect; nothing by default
        Setup         'automatic' | 'manual' -- whether an install CONFIGURES this
                      client or only produces settings for the operator to apply.
                      Derived from mode: merge-json and write-file put a file where
                      the client reads it, snippet cannot. See SetupBadge
        SetupBadge    'AUTOMATIC' | 'MANUAL STEPS'
        SetupBrush    a hex colour for that badge
        SetupText     the sentence for that distinction, shown as the badge's tooltip.
                      For an automatic target it also states WHERE the configuration
                      applies -- one repository, or every project this user opens --
                      and, where the target declares quitProcesses, that the client
                      must be closed while the file is written. Both are derived
                      (defaultPath's {PROJECT} token, quitProcesses); there is no
                      `scope` field and deliberately so
        Transport     'stdio' | 'http' | 'both'
        Path          the resolved destination on THIS machine
        Verification  'host-loaded' | 'config-spawn' | 'schema-only'
        VerifiedText  the sentence to show under the row
        Badge         'VERIFIED HERE' | 'SERVERS STARTED' | 'SHAPE ONLY'
        BadgeBrush    a hex colour for that badge
        NeedsGateway  $true if selecting it must also select the gateway
        Impractical   $true for copilot-studio; the page must show the warning
        Detectable    $false where presence cannot be answered from disk at all: a
                      snippet target's file goes into the installer's own out
                      directory and says nothing about what is installed
        PerProject    $true where the destination hangs off a project directory
        HereNow       $false if the directory that would hold the file is not on
                      this machine -- see the note on PresenceText below
        PresenceText  '' when HereNow, otherwise the sentence to show on the row
        PresenceVis   'Visible' | 'Collapsed' for PresenceText. A string rather than
                      a bool because the DataTemplate binds it straight at
                      Visibility and lets the enum's own type converter do the work;
                      a bool would need a converter class, which XAML loaded from a
                      string cannot reference.
        Notes         string[]  -- the target's own notes
        Unverified    string[]  -- what is deliberately NOT claimed. SHOW THIS.
#>
    [CmdletBinding()]
    param(
        [string] $HostsFile,
        [string] $ProjectDir,
        [string] $HostOutDir,
        [string] $ConfigPath,
        [string[]] $Preselect = @(),
        # The deployment shape answered on the wizard's first page. Empty means the
        # question has not been answered and every target comes back, which is what a
        # console caller and the -ListHosts table want. See Select-ShapeTargets.
        [ValidateSet('', 'workstation', 'central')]
        [string] $Shape = ''
    )
    Set-StrictMode -Version 2.0
    if (-not $HostsFile)  { $HostsFile  = Join-Path $PSScriptRoot 'hosts.json' }
    if (-not $ProjectDir) { $ProjectDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
    if (-not $HostOutDir) { $HostOutDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'out' }
    if (-not $ConfigPath) { $ConfigPath = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json' }

    $reg = Get-Content -LiteralPath $HostsFile -Raw | ConvertFrom-Json
    $reg = [pscustomobject]@{ targets = @(Select-ShapeTargets -Targets $reg.targets -Shape $Shape) }
    # The order is data, in hosts.json, and it is applied exactly once -- here. No page
    # carries a list of client ids of its own. A target with no rank sorts last rather
    # than first (which is where a null would land) and in file order; that is a
    # registry fault, and lib\Test-WizardPrep.ps1 fails on it rather than leaving it to
    # be noticed as a client in the wrong place.
    $i = 0
    $ordered = @($reg.targets | ForEach-Object {
        $i++
        $r = if ($_.PSObject.Properties.Name -contains 'rank' -and $_.rank) { [int]$_.rank } else { 1000 + $i }
        [pscustomobject]@{ Order = $r; Target = $_ }
    } | Sort-Object Order)

    foreach ($o in $ordered) {
        $t = $o.Target
        $path = $t.defaultPath.
                    Replace('{APPDATA}', $env:APPDATA).
                    Replace('{USERPROFILE}', $env:USERPROFILE).
                    Replace('{PROJECT}', $ProjectDir).
                    Replace('{OUT}', $HostOutDir)
        if ($t.id -eq 'claude-desktop') { $path = $ConfigPath }

        switch ($t.verification) {
            'host-loaded' {
                $badge = 'VERIFIED HERE'; $brush = '#1B7F4B'
                $text  = 'The host application itself was made to read this file on this machine.'
            }
            'config-spawn' {
                $badge = 'SERVERS STARTED'; $brush = '#2E6DA4'
                $text  = 'The emitted file was parsed back and every server in it started, ' +
                         'handshook and served a real bMS read. That is not proof the host loads it.'
            }
            default {
                $badge = 'SHAPE ONLY'; $brush = '#B8860B'
                $text  = 'Shape-checked against the documented schema. This host is not installed ' +
                         'here, so nothing was executed by it.'
            }
        }

        # Automatic or manual, and it is a property of the MODE, not of the vendor: a
        # merge-json or write-file target has a file the client reads and the installer
        # writes it; a snippet target has no file this installer can own -- a YAML
        # document with comments and anchors, or a value typed into a web form -- so
        # the install produces the settings and the operator applies them. Four of the
        # snippet targets carry serversKey: null as well, and two of those are rank 2
        # and rank 5, so this cannot be something the operator discovers at the end.
        if ($t.mode -eq 'snippet') {
            $setup      = 'manual'
            $setupBadge = 'MANUAL STEPS'
            $setupBrush = '#9A5B00'
            $setupText  = "The installer cannot write this client's configuration. It produces the " +
                          "settings, and you apply them in $($t.label)'s own interface."
        } else {
            $setup      = 'automatic'
            $setupBadge = 'AUTOMATIC'
            $setupBrush = '#014380'
            # WHERE the configuration applies is the choice an operator is actually
            # making on this page, and until now the page never said it: claude-desktop
            # and claude-code read as two names for the same thing and behave nothing
            # alike -- one is per-user and reverts if the app is running, the other is
            # one repository's file and wrote correctly on every attempt including the
            # three the first one lost.
            #
            # BOTH halves are DERIVED from data that already exists -- the {PROJECT}
            # token in defaultPath, and the target's own quitProcesses list. A `scope`
            # field was proposed for this and REJECTED, because it would restate a fact
            # already stated in one place and free it to disagree; see
            # CLAUDE-DESKTOP-WRITE-PLAN.md section 3.
            $quitNames = @(
                if ($t.PSObject.Properties.Name -contains 'quitProcesses') { $t.quitProcesses } else { @() }
            )
            $setupText = if ($t.defaultPath -like '*{PROJECT}*') {
                "The installer writes the configuration file $($t.label) reads INSIDE THE PROJECT " +
                "DIRECTORY named below. It applies in that one repository and nowhere else, and it " +
                "travels with the repository if you commit the file. Restart $($t.label) afterwards."
            } else {
                "The installer writes the configuration file $($t.label) reads FOR THIS WINDOWS " +
                "USER, so it applies to every project $($t.label) opens. " +
                "Restart $($t.label) afterwards."
            }
            if ($quitNames.Count -gt 0) {
                $setupText += " $($t.label) must be fully closed while the file is written -- its " +
                              "tray icon quit, not just its window -- because it rewrites this file " +
                              "from its own memory and will otherwise undo the install."
            }
        }

        # Is the destination actually on this machine? A snippet target writes into
        # the installer's own out directory, which the installer creates, so it is
        # always reachable. A per-project target stands or falls with the project
        # directory itself -- .vscode\ is created for you, the repository is not.
        # Everything else lives in a directory the client owns: no directory, no
        # client, and a file written there is one nothing will ever read.
        $holder = $null
        if ($t.mode -ne 'snippet') {
            $holder = if ($t.defaultPath -like '*{PROJECT}*') { $ProjectDir } else { Split-Path -Parent $path }
        }
        $hereNow = (-not $holder) -or (Test-Path -LiteralPath $holder)
        $presence = ''
        if (-not $hereNow) {
            $presence = if ($t.defaultPath -like '*{PROJECT}*') {
                "That project directory does not exist. Point this at the repository you actually open in $($t.label)."
            } else {
                "Nothing exists at $holder. If $($t.label) is not installed for this user, the file written there is one nothing will read."
            }
        }

        [pscustomobject]@{
            Id           = $t.id
            Label        = $t.label
            Rank         = $o.Order
            Selected     = ($Preselect -contains $t.id)
            Setup        = $setup
            SetupBadge   = $setupBadge
            SetupBrush   = $setupBrush
            SetupText    = $setupText
            Transport    = $t.transport
            Mode         = $t.mode
            Path         = $path
            Verification = $t.verification
            VerifiedText = $text
            Badge        = $badge
            BadgeBrush   = $brush
            NeedsGateway = [bool]($t.PSObject.Properties.Name -contains 'requiresGateway' -and $t.requiresGateway)
            Impractical  = [bool]($t.PSObject.Properties.Name -contains 'impractical' -and $t.impractical)
            HereNow      = $hereNow
            Detectable   = [bool]$holder
            PerProject   = [bool]($t.defaultPath -like '*{PROJECT}*')
            PresenceText = $presence
            PresenceVis  = $(if ($hereNow) { 'Collapsed' } else { 'Visible' })
            DocUrl       = $t.docUrl
            Notes        = @($t.notes)
            Unverified   = @(if ($t.PSObject.Properties.Name -contains 'unverified') { $t.unverified } else { @() })
        }
    }
}

function ConvertTo-HostInstallerParameters {
<#
.SYNOPSIS
    Turn a set of selected host ids into the parameters the engine script takes.
.DESCRIPTION
    The wizard is a front end: it collects answers and hands them to
    Install-BConnectMcp.ps1, which contains the only implementation of the work.
    This function is the whole of the translation, so the window and the console
    cannot disagree about what a host selection means.

    Returns a hashtable suitable for splatting, plus the equivalent console command
    for the review page's "the equivalent console command" box.
#>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string[]] $Selected,
        [string] $ProjectDir,
        [string] $HostOutDir,
        [string] $ConfigPath,
        [hashtable] $HostPath,
        [switch] $Gateway,
        [string] $GatewayBind = '127.0.0.1',
        [int]    $GatewayPort = 3001,
        [switch] $GatewayIUnderstandThereIsNoAuth,
        [switch] $RotateGatewayToken,
        [switch] $StartGateway
    )
    Set-StrictMode -Version 2.0
    $catalog = Get-HostSelectionCatalog -ProjectDir $ProjectDir -HostOutDir $HostOutDir -ConfigPath $ConfigPath
    $needGw  = [bool](@($catalog | Where-Object { $Selected -contains $_.Id -and $_.NeedsGateway }).Count)

    $p = @{ Hosts = ($Selected -join ',') }
    if ($ProjectDir) { $p['ProjectDir'] = $ProjectDir }
    if ($HostOutDir) { $p['HostOutDir'] = $HostOutDir }
    # -ConfigPath is the Claude Desktop path override and nothing else -- the engine
    # applies it to that one target and ignores it everywhere else. Passing it when
    # that target was not chosen is how a wizard ends up describing an install in a
    # vendor's terms that has nothing to do with it.
    if ($ConfigPath -and ($Selected -contains 'claude-desktop')) { $p['ConfigPath'] = $ConfigPath }
    if ($HostPath -and $HostPath.Count) { $p['HostPath'] = $HostPath }
    if ($Gateway -or $needGw) {
        $p['Gateway']     = $true
        $p['GatewayBind'] = $GatewayBind
        $p['GatewayPort'] = $GatewayPort
        # SEC-7 -- no parameter for "generate a token": -Gateway always does, and
        # the wizard offers no way to opt out. An opt-out checkbox is exactly the
        # friction point that turns a secure default into an unused one.
        if ($GatewayIUnderstandThereIsNoAuth) { $p['GatewayIUnderstandThereIsNoAuth'] = $true }
        if ($RotateGatewayToken) { $p['RotateGatewayToken'] = $true }
        # A client the registry says CANNOT spawn a process has no other route to
        # these servers than the gateway, so the gateway is part of its install and
        # not an option beside it. Configured, given a token, started and verified in
        # the same run -- otherwise the operator is handed a URL and a header for an
        # endpoint that is not listening, and the first thing they learn about this
        # product is that its output does not work. -StartGateway is therefore
        # implied here rather than left to a checkbox, and this is the only place
        # that decides it: the review page, the console command and the splat all
        # read it back out of this hashtable.
        if ($StartGateway -or $needGw) { $p['StartGateway'] = $true }
    }

    $cmd = ".\Install-BConnectMcp.ps1 -Hosts $($Selected -join ',')"
    if ($ProjectDir) { $cmd += " -ProjectDir '$ProjectDir'" }
    if ($HostOutDir) { $cmd += " -HostOutDir '$HostOutDir'" }
    if ($p.ContainsKey('ConfigPath')) { $cmd += " -ConfigPath '$ConfigPath'" }
    if ($p.ContainsKey('Gateway')) {
        $cmd += " -Gateway -GatewayBind $GatewayBind -GatewayPort $GatewayPort"
        if ($GatewayIUnderstandThereIsNoAuth) { $cmd += ' -GatewayIUnderstandThereIsNoAuth' }
        if ($RotateGatewayToken) { $cmd += ' -RotateGatewayToken' }
        if ($p.ContainsKey('StartGateway')) { $cmd += ' -StartGateway' }
    }

    return [pscustomobject]@{
        Parameters       = $p
        ConsoleCommand   = $cmd
        # The base a caller pastes into the client, composed once from the same two
        # values that reach the engine. One URL per domain hangs off it:
        # POST <GatewayUrl>/<domain>/mcp, where <domain> is a server name with the
        # bconnect- prefix removed. Empty when no gateway is configured.
        GatewayUrl       = $(if ($p.ContainsKey('Gateway')) { 'http://{0}:{1}' -f $GatewayBind, $GatewayPort } else { '' })
        GatewayRequired  = $needGw
        GatewayRequiredBy = @($catalog | Where-Object { $Selected -contains $_.Id -and $_.NeedsGateway } | Select-Object -ExpandProperty Id)
        Impractical      = @($catalog | Where-Object { $Selected -contains $_.Id -and $_.Impractical } | Select-Object -ExpandProperty Id)
        SchemaOnly       = @($catalog | Where-Object { $Selected -contains $_.Id -and $_.Verification -eq 'schema-only' } | Select-Object -ExpandProperty Id)
        MissingHere      = @($catalog | Where-Object { $Selected -contains $_.Id -and -not $_.HereNow } | Select-Object -ExpandProperty Id)
        # Derived once, here, so the list page, the review page and the completion
        # summary cannot each decide for themselves which clients the install
        # configures and which hand the operator settings to apply.
        Automatic        = @($catalog | Where-Object { $Selected -contains $_.Id -and $_.Setup -eq 'automatic' } | Select-Object -ExpandProperty Id)
        Manual           = @($catalog | Where-Object { $Selected -contains $_.Id -and $_.Setup -eq 'manual' } | Select-Object -ExpandProperty Id)
    }
}

function Get-HostSelectionXaml {
<#
.SYNOPSIS
    The page's XAML, as a string, with no theme colours baked in.
.DESCRIPTION
    Colours come from the window's resources so the concurrent white-theme restyle
    governs this page too. The only literal colours are the two per-row badges --
    SetupBrush (automatic or manual) and BadgeBrush (verification tier) -- which are
    data on each row object rather than styling. The legend above the list repeats
    those two literals so a row's chip and the sentence explaining it cannot drift
    apart in colour; lib\Test-WizardPrep.ps1 asserts the pair.

    Named elements the code-behind needs:
        HostList              ItemsControl bound to Get-HostSelectionCatalog
        ShapeNote             TextBlock -- which deployment shape filtered the list,
                              and which clients that answer leaves out
        MissingHostWarning    Border, collapsed unless a selected target's
                              destination directory is absent from this machine
        MissingHostText       TextBlock inside it, filled by the code-behind
        ProjectPathRow        StackPanel, collapsed unless a per-project target is on
        ProjectDirBox         TextBox -- the repository whose .mcp.json / .vscode\
                              mcp.json / .cursor\mcp.json is being written. Defaults
                              to the installer's own parent, which is almost never
                              right; ProjectDirNote says so when it still holds it
        ProjectDirNote        TextBlock under it
        ConfigPathRow         StackPanel, collapsed unless claude-desktop is on
        ConfigPathBox         TextBox -- that one target's file, nothing else
        ConfigPathNote        TextBlock under it
        GatewaySection        StackPanel holding the whole gateway question. Collapsed
                              unless a selected target requires the gateway or the
                              deployment does -- on a workstation install of a client
                              that spawns a process there is no gateway decision to
                              read past, so there is none on screen
        GatewayAdvanced       Expander, collapsed. Holds the opt-in below
        GatewayOptInCheck     CheckBox -- the gateway for a client the registry does
                              not name. It DRIVES GatewayWantedCheck; it is not a
                              second answer
        GatewayWantedCheck    CheckBox -- the one value the parameter mapping reads.
                              Forced on and disabled while a selected target requires
                              it, because that is not a preference at that point
        GatewayPanel          collapsed unless the gateway is wanted or required
        GatewayBindBox        TextBox, default 127.0.0.1
        GatewayPortBox        TextBox, default 3001
        GatewayNoAuthCheck    CheckBox -- the token-less escape hatch. Required to
                              enable a non-loopback bind when the operator has
                              deliberately turned the token off; MUST stay
                              unchecked by default
        GatewayRotateTokenCheck  CheckBox -- SEC-7, maps to -RotateGatewayToken.
                              MUST stay unchecked by default: a first install has
                              nothing to rotate, and a surprise rotation locks out
                              every client that already has the old value
        StartGatewayCheck     CheckBox
        HostSummaryText       TextBlock, the live summary line
        ImpracticalWarning    Border, collapsed unless an impractical target is on
#>
    [CmdletBinding()]
    [OutputType([string])]
    param()
    return @'
<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
      xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
  <Grid.RowDefinitions>
    <RowDefinition Height="Auto"/>
    <RowDefinition Height="*"/>
    <RowDefinition Height="Auto"/>
    <RowDefinition Height="Auto"/>
    <RowDefinition Height="Auto"/>
    <RowDefinition Height="Auto"/>
  </Grid.RowDefinitions>

  <StackPanel Grid.Row="0" Margin="0,0,0,10">
    <TextBlock Text="Which MCP clients should be configured?" FontSize="19" FontWeight="SemiBold" Foreground="#014380"/>
    <TextBlock TextWrapping="Wrap" Margin="0,5,0,0" FontSize="12.5"
               Text="An MCP client is the application the assistant runs in. The list is ordered by how commonly baramundi customers run them."/>
    <!-- Filled by the code-behind from the deployment shape answered on the Connect
         page. The list above is already filtered by it, and a filtered list with no
         statement of what filtered it reads as a list with clients missing. -->
    <TextBlock x:Name="ShapeNote" TextWrapping="Wrap" Margin="0,5,0,0" FontSize="11.5" Opacity="0.85" Text=""/>
    <!-- The two chips every row carries, named before the first row rather than
         explained after the last one. The left chip is the one an operator has to see
         BEFORE selecting, because six snippet targets cannot be configured by any
         installer and two of them are near the top of the list; the right chip is the
         verification tier this feature has always carried. The sentence behind each
         one is on the row itself, as a tooltip, and in README.md. -->
    <StackPanel Orientation="Horizontal" Margin="0,10,0,0">
      <Border CornerRadius="3" Padding="6,2" Background="#014380" MinWidth="104">
        <TextBlock Text="AUTOMATIC" Foreground="White" FontSize="10" FontWeight="SemiBold" HorizontalAlignment="Center"/>
      </Border>
      <TextBlock Margin="9,0,18,0" VerticalAlignment="Center" FontSize="11.5" Text="the installer writes the file"/>
      <Border CornerRadius="3" Padding="6,2" Background="#9A5B00" MinWidth="104">
        <TextBlock Text="MANUAL STEPS" Foreground="White" FontSize="10" FontWeight="SemiBold" HorizontalAlignment="Center"/>
      </Border>
      <TextBlock Margin="9,0,0,0" VerticalAlignment="Center" FontSize="11.5" Text="the settings are applied in that product's own interface"/>
    </StackPanel>
    <TextBlock TextWrapping="Wrap" Margin="0,7,0,0" Opacity="0.75" FontSize="11.5"
               Text="The badge on the right of each row states how far that target was verified. Hover any badge for what it means."/>
  </StackPanel>

  <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto">
    <ItemsControl x:Name="HostList">
      <ItemsControl.ItemTemplate>
        <DataTemplate>
          <Border BorderThickness="0,0,0,1" BorderBrush="#22000000" Padding="4,8">
            <Grid>
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="Auto"/>
              </Grid.ColumnDefinitions>
              <CheckBox Grid.Column="0" IsChecked="{Binding Selected, Mode=TwoWay}" VerticalAlignment="Top" Margin="0,2,10,0"/>
              <StackPanel Grid.Column="1">
                <TextBlock Text="{Binding Label}" FontWeight="SemiBold"/>
                <TextBlock Text="{Binding Path}" FontFamily="Consolas" FontSize="11" Opacity="0.7" TextTrimming="CharacterEllipsis"/>
                <!-- PresenceText is the ONLY per-row sentence still drawn, and it is
                     drawn only when there is a problem: the destination directory is
                     not on this machine. SetupText and VerifiedText moved to the
                     tooltips on the two badges. Three sentences under every one of
                     twelve rows is the wall of text this release exists to remove,
                     and both are stated in full in README.md. -->
                <TextBlock Text="{Binding PresenceText}" Visibility="{Binding PresenceVis}" TextWrapping="Wrap"
                           FontSize="11" Foreground="#9A5B00" Margin="0,3,0,0"/>
              </StackPanel>
              <!-- Left chip: does an install configure this client, or produce settings
                   to apply. Right chip: how far the target was verified. Two different
                   questions, so two chips; collapsing them would lose one of them. -->
              <Border Grid.Column="2" CornerRadius="3" Padding="6,2" VerticalAlignment="Top" MinWidth="104" Margin="0,0,6,0"
                      Background="{Binding SetupBrush}" ToolTip="{Binding SetupText}">
                <TextBlock Text="{Binding SetupBadge}" Foreground="White" FontSize="10" FontWeight="SemiBold" HorizontalAlignment="Center"/>
              </Border>
              <Border Grid.Column="3" CornerRadius="3" Padding="6,2" VerticalAlignment="Top" MinWidth="104"
                      Background="{Binding BadgeBrush}" ToolTip="{Binding VerifiedText}">
                <TextBlock Text="{Binding Badge}" Foreground="White" FontSize="10" FontWeight="SemiBold" HorizontalAlignment="Center"/>
              </Border>
            </Grid>
          </Border>
        </DataTemplate>
      </ItemsControl.ItemTemplate>
    </ItemsControl>
  </ScrollViewer>

  <StackPanel Grid.Row="2">
    <Border x:Name="ImpracticalWarning" Visibility="Collapsed"
            Background="#22B8860B" BorderBrush="#B8860B" BorderThickness="1" CornerRadius="4"
            Padding="10" Margin="0,10,0,0">
      <TextBlock TextWrapping="Wrap" FontSize="11.5"
                 Text="Copilot Studio reaches this server from Microsoft's cloud, so a gateway on loopback or a private VLAN is unreachable by construction. Publishing it means an internet-facing endpoint guarded by one shared bearer token. Read the emitted file before planning on it."/>
    </Border>
    <Border x:Name="MissingHostWarning" Visibility="Collapsed"
            Background="#22B8860B" BorderBrush="#B8860B" BorderThickness="1" CornerRadius="4"
            Padding="10" Margin="0,10,0,0">
      <TextBlock x:Name="MissingHostText" TextWrapping="Wrap" Text=""/>
    </Border>
  </StackPanel>

  <StackPanel Grid.Row="3">
    <StackPanel x:Name="ProjectPathRow" Visibility="Collapsed" Margin="0,12,0,0">
      <TextBlock Text="PROJECT DIRECTORY" FontSize="11.5" FontWeight="SemiBold" Opacity="0.75" Margin="0,0,0,5"/>
      <TextBox x:Name="ProjectDirBox"/>
      <TextBlock x:Name="ProjectDirNote" TextWrapping="Wrap" FontSize="11" Opacity="0.75" Margin="0,4,0,0"
                 Text="A per-workspace client reads its MCP configuration from the repository. This must be the repository you open in the editor."/>
    </StackPanel>
    <StackPanel x:Name="ConfigPathRow" Visibility="Collapsed" Margin="0,12,0,0">
      <TextBlock Text="CLAUDE DESKTOP CONFIGURATION FILE" FontSize="11.5" FontWeight="SemiBold" Opacity="0.75" Margin="0,0,0,5"/>
      <TextBox x:Name="ConfigPathBox"/>
      <TextBlock x:Name="ConfigPathNote" TextWrapping="Wrap" FontSize="11" Opacity="0.75" Margin="0,4,0,0" Text=""/>
    </StackPanel>
  </StackPanel>

  <!-- THE GATEWAY SECTION APPEARS ONLY WHEN A SELECTED CLIENT REQUIRES IT, or when
       the shared-service deployment does. On a workstation install of Claude Desktop
       it is not a decision anybody has to read past: it is not there.

       The opt-in for a client the registry does not name is under Advanced, and it
       DRIVES GatewayWantedCheck rather than duplicating it. GatewayWantedCheck
       remains the one value ConvertTo-HostInstallerParameters is handed, so there is
       still exactly one answer to "is the gateway part of this install". -->
  <StackPanel Grid.Row="4">
  <StackPanel x:Name="GatewaySection" Visibility="Collapsed" Margin="0,12,0,0">
  <CheckBox x:Name="GatewayWantedCheck"
            Content="Also run the HTTP gateway (for clients that cannot start a local process)"/>
  <!-- First appearance of "stdio" and "gateway" in this window, so both are named
       here rather than assumed. -->
  <TextBlock TextWrapping="Wrap" FontSize="11" Opacity="0.75" Margin="22,2,0,0"
             Text="These servers normally run as local processes the client starts, over stdio. A client that cannot start one reaches them over HTTP instead, through the gateway."/>
  <StackPanel x:Name="GatewayPanel" Visibility="Collapsed" Margin="0,10,0,0">
    <TextBlock Text="HTTP gateway" FontWeight="SemiBold"/>
    <TextBlock TextWrapping="Wrap" FontSize="11" Margin="0,4,0,6"
               Text="One local HTTP endpoint fronting every enabled server. It holds one bConnect service credential, and every caller it admits gets that credential's full reach."/>
    <Border Background="#221B7F4B" BorderBrush="#1B7F4B" BorderThickness="1" CornerRadius="4" Padding="8" Margin="0,0,0,8">
      <StackPanel>
        <TextBlock Text="A bearer token is generated for you" FontWeight="SemiBold" FontSize="12"/>
        <TextBlock TextWrapping="Wrap" FontSize="11" Margin="0,3,0,0"
                   Text="43 random characters, stored in the ACL-hardened credentials file and shown once at the end. Calls without it are answered 401; the health endpoint stays open."/>
        <TextBlock TextWrapping="Wrap" FontSize="11" Opacity="0.75" Margin="0,4,0,0"
                   Text="It is not TLS and not an identity. Off this machine, a TLS-terminating proxy is still the answer."/>
      </StackPanel>
    </Border>
    <StackPanel Orientation="Horizontal">
      <TextBlock Text="Bind" VerticalAlignment="Center" Margin="0,0,6,0"/>
      <TextBox x:Name="GatewayBindBox" Text="127.0.0.1" Width="120"/>
      <TextBlock Text="Port" VerticalAlignment="Center" Margin="14,0,6,0"/>
      <TextBox x:Name="GatewayPortBox" Text="3001" Width="70"/>
      <CheckBox x:Name="StartGatewayCheck" Content="Start and verify it now" VerticalAlignment="Center" Margin="18,0,0,0"/>
    </StackPanel>
    <CheckBox x:Name="GatewayRotateTokenCheck" Margin="0,8,0,0"
              Content="Issue a NEW token (the old one keeps working until the next run without this)"/>
    <TextBlock TextWrapping="Wrap" FontSize="11" Opacity="0.75" Margin="22,2,0,0"
               Text="Leave this off on a first install. On a re-run both values are accepted while clients are moved across."/>
    <CheckBox x:Name="GatewayNoAuthCheck" Margin="0,8,0,0"
              Content="No token — an authenticating, TLS-terminating reverse proxy is in front of this gateway"/>
    <TextBlock TextWrapping="Wrap" FontSize="11" Opacity="0.75" Margin="22,2,0,0"
               Text="Only for a deliberately token-less gateway on a non-loopback bind. Nothing verifies this claim."/>
  </StackPanel>
  </StackPanel>
  <Expander x:Name="GatewayAdvanced" Header="Advanced" IsExpanded="False" Margin="0,14,0,0"
            Foreground="#014380" FontSize="12.5" FontWeight="SemiBold">
    <StackPanel Margin="0,8,0,0">
      <CheckBox x:Name="GatewayOptInCheck" Content="Also run the HTTP gateway for a client that is not in this list"/>
      <TextBlock TextWrapping="Wrap" FontSize="11" Opacity="0.75" Margin="22,2,0,0"
                 Text="Every client in the list above already turns this on where it needs it. Tick this only for a tool of your own that reaches MCP servers over HTTP."/>
    </StackPanel>
  </Expander>
  </StackPanel>

  <TextBlock x:Name="HostSummaryText" Grid.Row="5" HorizontalAlignment="Right" Margin="0,8,0,0"
             Opacity="0.75" FontSize="11"/>
</Grid>
'@
}
