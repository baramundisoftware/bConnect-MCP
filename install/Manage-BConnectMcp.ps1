<#
.SYNOPSIS
    A settings window for an installed bConnect-MCP suite.

.DESCRIPTION
    The third front end over one engine, and it obeys the same rule the other two do:

        it collects answers and reports results. It never changes anything itself.

    Every control on every page that CHANGES something resolves to one invocation of
    bconnect.ps1 -- the verb front end -- which resolves in turn to one targeted
    Install-BConnectMcp.ps1 run. There is no file writer in this file. There is no
    second idea in this file of what a write gate is, where the credentials live, or
    which clients are configured: the Status page is bconnect.ps1's own `status`
    computation, obtained as JSON and rendered, and every page reads that same model.

    WHY THAT MATTERS HERE MORE THAN ANYWHERE
    ----------------------------------------
    A settings window is exactly where a parallel implementation gets added, because
    every setting looks like one line of code to write directly. This project has had
    to remove five of those. So the shape is deliberate and is asserted by
    lib\Test-ManageGui.ps1:

      * Start-Change dispatches a verb from a closed list and refuses anything else.
      * The change paths build their parameters through Get-PendingChanges, which
        returns data. A test can read what a page WOULD run without running it.
      * Nothing in this file writes to a file, edits a JSON document, or touches the
        credentials store. The guard greps for that as well as driving the controls.

    THREE ENTRY STATES, DECIDED ON WHAT IS FOUND
    --------------------------------------------
    An stdio MCP server is a local process the CLIENT APPLICATION starts, so this has
    to reach every administrator's workstation, which means baramundi has to be able
    to deploy it. The install is therefore in two stages (see the .PARAMETER Stage
    help on Install-BConnectMcp.ps1): a machine stage that runs as SYSTEM and places
    Node, the suite and the INTENDED client list, and a user stage that runs in each
    administrator's own login and collects the credentials and that account's client
    configurations.

    Between those two stages the software is present and this account has nothing.
    Opening on Status there would report an installation that reads as broken. It is
    not broken; it is half-done by design. So this window decides its entry state
    from the record and the filesystem, never from a parameter or a flag:

      not installed   no record, and no bconnect-* entry in any client configuration
                      file. Status says so and names the installer. Nothing here
                      pretends to configure an installation that does not exist.
      finish          installed, but this Windows account has no credential or no
                      client configuration. The window leads with a short guided
                      finish -- credentials, which clients, write access -- which is
                      the second half of the install rather than a settings screen.
      configured      Status first, exactly as before.

    The finish is a SEQUENCE OVER THE PAGES THAT ALREADY EXIST. $FinishSteps names
    them, the banner walks them, and every change it makes is the page's own
    Get-*Change routed through Start-Queue. There is no second wizard here, no second
    set of controls, and no writer.

    WHAT TAKES EFFECT WHEN
    ----------------------
    Two different answers, and both are stated on the page that makes the change:

      * A host-configuration change (the write gate, the v1.1 gate, which clients are
        configured) is read by the MCP CLIENT when it starts. Until that client is
        restarted, nothing has changed for it.
      * A credentials-file change (base URL, credential, audit level, rate limiting)
        is read by a SERVER PROCESS when it starts. The client starts those processes,
        so in practice the same restart applies -- but a gateway running as its own
        process has to be restarted separately.

    The clients are named, from lib\hosts.json, never called "your MCP client".

.PARAMETER StateFile, SuiteRootOverride, SecretsDirOverride, ProjectDirOverride, HostOutDirOverride, ConfigPathOverride
    Passed straight through to bconnect.ps1, which is where they mean something.
    Normally none is needed: the installation record answers all of them. They exist
    so this window can be pointed at a rehearsal copy, exactly as the verbs can.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Manage-BConnectMcp.ps1

.NOTES
    Requires -Sta (WPF will not run on an MTA thread) and Windows PowerShell 5.1.
    Both are asserted at the top of the file rather than left to fail inside WPF.
#>
[CmdletBinding()]
param(
    [string] $StateFile,
    [string] $SuiteRootOverride,
    [string] $SecretsDirOverride,
    [string] $ProjectDirOverride,
    [string] $HostOutDirOverride,
    [string] $ConfigPathOverride,
    # Branding assets. Same slots, same graceful degradation, same overrides as the
    # installer window -- see "Branding assets" in INSTALL.md.
    [string] $LogoPath,
    [string] $IconPath,
    # Internal: build and wire the window but do not call ShowDialog. Lets
    # lib\Test-ManageGui.ps1 drive the real pages and the real code-behind without a
    # visible, blocking window. Not part of the documented interface.
    [switch] $TestHeadless
)

$ErrorActionPreference = 'Stop'

# -----------------------------------------------------------------------------
# Host pre-flight. The same two conditions the installer window cannot run without,
# refused the same way and with the same command line to fix them: WPF throws an
# apartment exception from inside XamlReader on an MTA thread, and PowerShell 7 has
# neither the .NET Framework presentation assemblies this window is built from nor
# the DPAPI ProtectedData type the credentials store needs.
# -----------------------------------------------------------------------------
$UiRelaunch = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -File "{0}"' -f $PSCommandPath
$uiProblems = @()
if ($PSVersionTable.PSEdition -eq 'Core') {
    $uiProblems += ("This is PowerShell $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition)). " +
                    'The settings window needs Windows PowerShell 5.1: PowerShell 7 does not carry the .NET Framework ' +
                    'presentation assemblies this window is built from, and its .NET has no DPAPI ProtectedData ' +
                    'for reading a protected credentials file.')
} elseif ($PSVersionTable.PSVersion -lt [Version]'5.1') {
    $uiProblems += ("This is Windows PowerShell $($PSVersionTable.PSVersion). The settings window needs 5.1 or newer.")
}
$uiApartment = [System.Threading.Thread]::CurrentThread.GetApartmentState()
if ($uiApartment -ne 'STA') {
    $uiProblems += ("This session is $uiApartment. WPF will not run on anything but an STA thread. " +
                    'The Windows PowerShell console host is STA already; PowerShell 7, powershell.exe -MTA, ' +
                    'and any runspace created without an apartment state are not.')
}
if ($uiProblems.Count) {
    $uiText = ($uiProblems -join "`r`n`r`n") + "`r`n`r`nRun this instead:`r`n`r`n  " + $UiRelaunch
    Write-Host ''
    Write-Host '  The settings window cannot start here.' -ForegroundColor Red
    foreach ($p in $uiProblems) { Write-Host ('  - ' + $p) -ForegroundColor Yellow }
    Write-Host ''
    Write-Host '  Run this instead:' -ForegroundColor White
    Write-Host ('    ' + $UiRelaunch) -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Or use the verbs from a console instead: .\bconnect.ps1 status' -ForegroundColor DarkGray
    Write-Host ''
    if (-not $TestHeadless) {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            [void][System.Windows.Forms.MessageBox]::Show($uiText, 'bConnect-MCP settings', 'OK', 'Error')
        } catch { }   # no window subsystem available is not a reason to lose the console text
    }
    exit 2
}

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

# -----------------------------------------------------------------------------
# Paths. In the published layout install\ sits inside the suite, so the suite root
# is this file's parent -- derived exactly as every other shipped script derives it.
# -----------------------------------------------------------------------------
$InstallerDir = $PSScriptRoot
$ProjectRoot  = Split-Path -Parent $InstallerDir
$LibDir       = Join-Path $InstallerDir 'lib'
$AssetsDir    = Join-Path $InstallerDir 'assets'
$Bconnect     = Join-Path $InstallerDir 'bconnect.ps1'
$HostPagePath = Join-Path $LibDir 'HostSelectionPage.ps1'
if (-not $LogoPath) { $LogoPath = Join-Path $AssetsDir 'logo.png' }
if (-not $IconPath) { $IconPath = Join-Path $AssetsDir 'app.ico' }

foreach ($needed in @($Bconnect, $HostPagePath)) {
    if (-not (Test-Path -LiteralPath $needed)) {
        [void][System.Windows.MessageBox]::Show(
            "A file this window cannot run without was not found.`n`nExpected: $needed",
            'bConnect-MCP settings', 'OK', 'Error')
        exit 1
    }
}

# The client catalogue -- labels, the automatic/manual distinction and its badges --
# is dot-sourced from the installer window's own host page rather than restated, so
# both windows describe a client the same way and lib\hosts.json stays the only list
# of clients anywhere.
. $HostPagePath

# The palette both windows paint from. See lib\Theme.ps1.
. (Join-Path $LibDir 'Theme.ps1')

# What a bConnect address is. Shared with Install-BConnectMcp-UI.ps1 so that the
# form the installer WRITES is the form this window READS. See lib\Address.ps1.
. (Join-Path $LibDir 'Address.ps1')

# The installation record, read through lib\State.psm1's own accessors and no other
# way. `bconnect status -Json` is still the source of everything this window shows;
# it simply does not project the two fields the two-stage split added -- which
# clients the installation is INTENDED for, and which account configured the ones it
# has. Those are read here with Get-RecordIntendedHostIds and Get-RecordStage, which
# are the single implementation of each, at the state file the CLI itself resolved.
# Nothing about the record shape is re-derived in this file.
Import-Module (Join-Path $LibDir 'State.psm1') -Force -DisableNameChecking

$CatalogPath = Join-Path $LibDir 'catalog.json'
$Catalog     = Get-Content -LiteralPath $CatalogPath -Raw | ConvertFrom-Json

# The verbs this window may dispatch, and nothing else. A closed list is cheap here
# and it is what stops the next page from quietly acquiring a writer of its own:
# anything not on it cannot be run, and lib\Test-ManageGui.ps1 asserts the list.
$VERBS_ALLOWED = @('status', 'verify', 'set', 'enable', 'disable', 'writes', 'hosts')

# The only env keys any change from this window can put into a host configuration
# file, via the CLI. It is HOST_CONFIG_ENV_ALLOWLIST from lib\host-emitters.mjs,
# restated here as an assertion target: a host config must never carry a secret, so
# the audit level and the rate limiter go to the credentials file and nowhere near
# a client's configuration.
$HOST_CONFIG_KEYS = @('ALLOW_WRITE_OPERATIONS', 'ALLOWED_WRITE_TOOLS', 'BCONNECT_ENABLE_V11')

# =============================================================================
# XAML
# =============================================================================
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Width="1180" Height="820" WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        WindowStartupLocation="CenterScreen" FontFamily="Segoe UI" Title="bConnect-MCP settings">
  <Window.Resources>
    <Style TargetType="Button" x:Key="Flat">
      <Setter Property="Background" Value="#F5F6F8"/>
      <Setter Property="Foreground" Value="#202024"/>
      <Setter Property="BorderBrush" Value="#DDDDDD"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="18,7"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" CornerRadius="7" Background="{TemplateBinding Background}"
                    BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" Margin="{TemplateBinding Padding}"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="bd" Property="Background" Value="#E7E9EC"/></Trigger>
              <Trigger Property="IsEnabled" Value="False"><Setter Property="Opacity" Value="0.35"/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <!-- Primary overrides Foreground explicitly: Flat's dark-on-light Foreground would be
         near-invisible on this style's navy background if left inherited. -->
    <Style TargetType="Button" x:Key="Primary" BasedOn="{StaticResource Flat}">
      <Setter Property="Background" Value="#014380"/>
      <Setter Property="Foreground" Value="#FFFFFF"/>
      <Setter Property="BorderBrush" Value="#0C6FA6"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
    </Style>
    <Style TargetType="TextBox">
      <Setter Property="Background" Value="#FFFFFF"/>
      <Setter Property="Foreground" Value="#202024"/>
      <Setter Property="BorderBrush" Value="#DDDDDD"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="8,6"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="CaretBrush" Value="#202024"/>
    </Style>
    <Style TargetType="PasswordBox">
      <Setter Property="Background" Value="#FFFFFF"/>
      <Setter Property="Foreground" Value="#202024"/>
      <Setter Property="BorderBrush" Value="#DDDDDD"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="8,6"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="CaretBrush" Value="#202024"/>
    </Style>
    <Style TargetType="CheckBox">
      <Setter Property="Foreground" Value="#202024"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Cursor" Value="Hand"/>
    </Style>
    <Style TargetType="RadioButton">
      <Setter Property="Foreground" Value="#202024"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Cursor" Value="Hand"/>
    </Style>
    <Style TargetType="TextBlock" x:Key="H1">
      <Setter Property="Foreground" Value="#014380"/>
      <Setter Property="FontSize" Value="19"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
    </Style>
    <Style TargetType="TextBlock" x:Key="Sub">
      <Setter Property="Foreground" Value="#5C5C63"/>
      <Setter Property="FontSize" Value="12.5"/>
      <Setter Property="TextWrapping" Value="Wrap"/>
      <Setter Property="Margin" Value="0,4,0,0"/>
    </Style>
    <Style TargetType="TextBlock" x:Key="Label">
      <Setter Property="Foreground" Value="#5C5C63"/>
      <Setter Property="FontSize" Value="11.5"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Margin" Value="0,14,0,5"/>
    </Style>
  </Window.Resources>

  <Border x:Name="outerBorder" CornerRadius="14" Background="#F4F4F6" BorderBrush="#DDDDDD" BorderThickness="1">
    <Grid>
      <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>

      <!-- title bar -->
      <Border x:Name="TitleBar" Grid.Row="0" Background="#014380" CornerRadius="13,13,0,0" Height="46">
        <Grid Margin="18,0,14,0">
          <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
            <TextBlock Text="&#x25C9;" Foreground="White" FontSize="18" VerticalAlignment="Center" Margin="0,0,10,0"/>
            <TextBlock Text="bConnect-MCP  -  settings" Foreground="White" FontSize="15" FontWeight="SemiBold" VerticalAlignment="Center"/>
            <!-- ARGB background (not Border.Opacity), so only the chip tints translucent:
                 the text inside stays fully opaque. Opacity on the Border would have taken
                 the label down to 18% alpha too, which is how badge text quietly goes
                 unreadable. -->
            <Border Background="#33FFFFFF" CornerRadius="4" Padding="6,1,6,2" Margin="12,0,0,0" VerticalAlignment="Center">
              <TextBlock x:Name="modeBadge" Text="runs bconnect.ps1" Foreground="White" FontSize="10" FontWeight="SemiBold"/>
            </Border>
          </StackPanel>
          <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" VerticalAlignment="Center">
            <TextBlock x:Name="closeBtn" Text="&#xE711;" FontFamily="Segoe MDL2 Assets" Foreground="White" FontSize="15" Cursor="Hand"/>
          </StackPanel>
        </Grid>
      </Border>

      <!-- body: page rail + page host -->
      <Grid Grid.Row="1" Margin="0">
        <Grid.ColumnDefinitions><ColumnDefinition Width="248"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>

        <Border Grid.Column="0" Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="0,0,1,0">
          <StackPanel Margin="16,20,12,0">
            <!-- Branding slot. Identical treatment to the installer window: the wordmark
                 when install\assets\logo.png is present, the text fallback when it is not,
                 never a broken-image box and never an empty gap. -->
            <Grid x:Name="logoHost" Margin="0,0,0,22" HorizontalAlignment="Left">
              <Image x:Name="logoImage" Height="30" Stretch="Uniform" HorizontalAlignment="Left" VerticalAlignment="Center" Visibility="Collapsed"/>
              <TextBlock x:Name="logoFallback" Text="bConnect-MCP" Foreground="#014380" FontSize="18" FontWeight="Bold" VerticalAlignment="Center"/>
            </Grid>
            <StackPanel x:Name="rail"/>
          </StackPanel>
        </Border>

        <Grid Grid.Column="1" Margin="30,22,30,10">
          <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>

          <!-- ============ the finish banner ============
               Shown only in the finish entry state, and only on the pages the
               finish walks. It carries no control that changes anything: the
               credential, the clients and the write gate are set with each page's
               own buttons, which is what keeps this a sequence over the existing
               pages rather than a second wizard. -->
          <Border x:Name="finishBar" Grid.Row="0" Background="#FFFFFF" BorderBrush="#014380" BorderThickness="1"
                  CornerRadius="10" Padding="18,14,18,15" Margin="0,0,14,16" Visibility="Collapsed">
            <StackPanel>
              <TextBlock x:Name="lblFinishTitle" Style="{StaticResource H1}" FontSize="17" Text="Finish setting up bConnect-MCP for this Windows account"/>
              <TextBlock x:Name="lblFinishWhy" Style="{StaticResource Sub}" Text=""/>
              <TextBlock x:Name="lblFinishIntended" Style="{StaticResource Sub}" Text=""/>
              <StackPanel x:Name="finishSteps" Orientation="Horizontal" Margin="0,12,0,0"/>
              <StackPanel Orientation="Horizontal" Margin="0,13,0,0">
                <Button x:Name="btnFinishNext" Content="Next step" Style="{StaticResource Primary}" Margin="0,0,10,0"/>
                <Button x:Name="btnFinishStatus" Content="Open Status instead" Style="{StaticResource Flat}"/>
                <TextBlock x:Name="lblFinishNote" Foreground="#5C5C63" FontSize="12" TextWrapping="Wrap" VerticalAlignment="Center" Margin="14,0,0,0" Text=""/>
              </StackPanel>
            </StackPanel>
          </Border>

          <Grid Grid.Row="1">

          <!-- ============ page 0: status ============
               Rendered from bconnect.ps1's own `status` computation, obtained as
               JSON. Nothing on this page is worked out here. -->
          <Grid x:Name="page0">
            <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
            <StackPanel Grid.Row="0">
              <TextBlock Text="Status" Style="{StaticResource H1}"/>
              <TextBlock x:Name="lblStatusSub" Style="{StaticResource Sub}" Text=""/>
            </StackPanel>
            <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto" Margin="0,14,0,0">
              <StackPanel x:Name="statusList" Margin="0,0,14,0"/>
            </ScrollViewer>
          </Grid>

          <!-- ============ page 1: write access ============ -->
          <Grid x:Name="page1" Visibility="Collapsed">
            <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
            <StackPanel Grid.Row="0">
              <TextBlock Text="Write access" Style="{StaticResource H1}"/>
              <TextBlock Style="{StaticResource Sub}" Text="Write access permits a server to create, modify and delete objects in the management suite, acting on the production estate. It is off in every server until it is turned on, and it is set per server."/>
              <TextBlock Style="{StaticResource Sub}" Text="The bMS rights of the API key are a second boundary underneath this one. Do not rely on them to catch a mistake: a key with full rights makes this the only boundary."/>
              <TextBlock x:Name="lblWriteRestart" Style="{StaticResource Sub}" Foreground="#9A5B00" Text=""/>
            </StackPanel>
            <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto" Margin="0,12,0,0">
              <StackPanel x:Name="writeList" Margin="0,0,14,0"/>
            </ScrollViewer>
            <StackPanel Grid.Row="2">
              <Border x:Name="confirmBar" Background="#FBEAE8" BorderBrush="#C4281F" BorderThickness="1" CornerRadius="9" Padding="14,10" Margin="0,12,0,0" Visibility="Collapsed">
                <StackPanel>
                  <TextBlock x:Name="lblConfirmWhat" Foreground="#C4281F" FontSize="12.5" TextWrapping="Wrap" Text=""/>
                  <StackPanel Orientation="Horizontal" Margin="0,9,0,0">
                    <TextBlock Text="type" Foreground="#C4281F" FontSize="12.5" VerticalAlignment="Center" Margin="0,0,8,0"/>
                    <TextBlock Text="ENABLE WRITES" Foreground="#C4281F" FontSize="12.5" FontWeight="SemiBold" VerticalAlignment="Center" Margin="0,0,10,0"/>
                    <TextBox x:Name="txtConfirm" Width="220"/>
                  </StackPanel>
                </StackPanel>
              </Border>
              <StackPanel Orientation="Horizontal" Margin="0,12,0,0">
                <Button x:Name="btnApplyWrites" Content="Apply write access" Style="{StaticResource Primary}" Margin="0,0,10,0"/>
                <Button x:Name="btnWritesOff" Content="Turn write access off everywhere" Style="{StaticResource Flat}"/>
                <TextBlock x:Name="lblWriteSummary" Foreground="#5C5C63" FontSize="12" VerticalAlignment="Center" Margin="14,0,0,0" Text=""/>
              </StackPanel>
            </StackPanel>
          </Grid>

          <!-- ============ page 2: connection ============ -->
          <Grid x:Name="page2" Visibility="Collapsed">
            <ScrollViewer VerticalScrollBarVisibility="Auto">
            <StackPanel Margin="0,0,14,0">
              <TextBlock Text="Connection" Style="{StaticResource H1}"/>
              <TextBlock Style="{StaticResource Sub}" Text="The base URL and the credential every enabled server uses. Both live in the credentials file, which the servers read when their process starts."/>
              <TextBlock x:Name="lblConnNow" Style="{StaticResource Sub}" Text=""/>

              <!-- The server, not the URL. Same question as the installer's Connect
                   page and composed by the same shared code, so the address this
                   window writes and the address that one writes are one form. -->
              <TextBlock Text="BARAMUNDI SERVER" Style="{StaticResource Label}"/>
              <TextBox x:Name="txtServerFqdn"/>
              <TextBlock x:Name="lblComposedUrl" Style="{StaticResource Sub}" Text=""/>
              <CheckBox x:Name="chkCustomUrl" Content="This bConnect is not at the standard address" Margin="0,10,0,0"/>
              <TextBlock Style="{StaticResource Sub}" Margin="24,3,0,0" Text="For a site under a virtual directory other than /bconnect. The server name above is then not used."/>
              <StackPanel x:Name="pnlCustomUrl" Visibility="Collapsed" Margin="0,9,0,0">
                <TextBox x:Name="txtBaseUrl"/>
                <TextBlock Style="{StaticResource Sub}" Text="Ends at /bconnect. A module segment produces doubled paths and a 401 that looks exactly like a bad password."/>
              </StackPanel>
              <TextBlock Style="{StaticResource Sub}" Margin="0,8,0,0" Text="Changing the address changes one line in the credentials file and no client configuration at all."/>
              <StackPanel Orientation="Horizontal" Margin="0,10,0,0">
                <Button x:Name="btnSetUrl" Content="Change base URL" Style="{StaticResource Primary}"/>
                <Button x:Name="btnVerify" Content="Verify the connection" Style="{StaticResource Flat}" Margin="10,0,0,0"/>
                <TextBlock x:Name="lblVerifyNote" Foreground="#5C5C63" FontSize="12" VerticalAlignment="Center" Margin="14,0,0,0"
                           Text="Verify starts each configured server the way the client does and makes a real read call. It changes nothing."/>
              </StackPanel>

              <TextBlock Text="REPLACE THE CREDENTIAL" Style="{StaticResource Label}"/>
              <TextBlock Style="{StaticResource Sub}" Text="Nothing typed here is echoed, logged, or placed on a command line. It is held as a SecureString and handed to bconnect.ps1 in process. The stored value cannot be shown: it is write-only from here."/>
              <StackPanel Orientation="Horizontal" Margin="0,10,0,0">
                <RadioButton x:Name="rbApiKey" Content="API key" GroupName="auth" IsChecked="True" Margin="0,0,24,0"/>
                <RadioButton x:Name="rbBasic" Content="Username and password (Basic)" GroupName="auth"/>
              </StackPanel>
              <StackPanel x:Name="pnlApiKey" Margin="0,10,0,0">
                <PasswordBox x:Name="pwApiKey"/>
                <TextBlock Style="{StaticResource Sub}" Text="bMS console -> Server Management -> API Keys."/>
              </StackPanel>
              <StackPanel x:Name="pnlBasic" Visibility="Collapsed" Margin="0,10,0,0">
                <TextBox x:Name="txtBasicUser"/>
                <PasswordBox x:Name="pwBasic" Margin="0,8,0,0"/>
              </StackPanel>
              <StackPanel Orientation="Horizontal" Margin="0,12,0,0">
                <Button x:Name="btnSetCredential" Content="Replace the credential" Style="{StaticResource Primary}"/>
                <TextBlock x:Name="lblCredRestart" Foreground="#9A5B00" FontSize="12" TextWrapping="Wrap" VerticalAlignment="Center" Margin="14,0,0,0" Text=""/>
              </StackPanel>

              <Border Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="1" CornerRadius="10" Padding="16,13" Margin="0,22,0,0">
                <StackPanel>
                  <TextBlock Text="SHOWN HERE, CHANGED ELSEWHERE" Foreground="#75757B" FontSize="11" FontWeight="SemiBold" Margin="0,0,0,8"/>
                  <StackPanel x:Name="connReadOnly"/>
                </StackPanel>
              </Border>
            </StackPanel>
            </ScrollViewer>
          </Grid>

          <!-- ============ page 3: bConnect v1.1 ============ -->
          <Grid x:Name="page3" Visibility="Collapsed">
            <ScrollViewer VerticalScrollBarVisibility="Auto">
            <StackPanel Margin="0,0,14,0">
              <TextBlock Text="bConnect v1.1" Style="{StaticResource H1}"/>
              <TextBlock Style="{StaticResource Sub}" Text="v1.1 is the older bConnect interface. It exposes job configuration that v2.0 omits entirely, and it does not accept an API key: it needs a Windows or Active Directory account that is a member of a bConnect security group, in UPN form -- user@example.local."/>
              <TextBlock Style="{StaticResource Sub}" Text="That account is a more privileged credential than the API key. It carries that user's own rights and is not limited by the key's."/>
              <TextBlock Style="{StaticResource Sub}" Text="The gate and the credentials are one decision. A gate with no credentials advertises tools that fail on every call, which is worse than not having them, so this page sets both together and removes both together."/>
              <TextBlock x:Name="lblV11State" Style="{StaticResource Sub}" Foreground="#202024" Text=""/>

              <TextBlock Text="V1.1 USERNAME (UPN FORM)" Style="{StaticResource Label}"/>
              <TextBox x:Name="txtV11User"/>
              <TextBlock Text="V1.1 PASSWORD" Style="{StaticResource Label}"/>
              <PasswordBox x:Name="pwV11"/>
              <StackPanel Orientation="Horizontal" Margin="0,14,0,0">
                <Button x:Name="btnV11Set" Content="Set the credentials and enable v1.1" Style="{StaticResource Primary}"/>
                <Button x:Name="btnV11Disable" Content="Disable v1.1 and remove the credentials" Style="{StaticResource Flat}" Margin="10,0,0,0"/>
              </StackPanel>
              <TextBlock x:Name="lblV11Restart" Style="{StaticResource Sub}" Foreground="#9A5B00" Text=""/>
            </StackPanel>
            </ScrollViewer>
          </Grid>

          <!-- ============ page 4: audit and rate limiting ============ -->
          <Grid x:Name="page4" Visibility="Collapsed">
            <ScrollViewer VerticalScrollBarVisibility="Auto">
            <StackPanel Margin="0,0,14,0">
              <TextBlock Text="Audit and rate limiting" Style="{StaticResource H1}"/>
              <TextBlock Style="{StaticResource Sub}" Text="Both settings live in the credentials file, because that is the file every server is launched with. Neither is a secret and neither reaches a client's configuration."/>
              <TextBlock Style="{StaticResource Sub}" Text="Audit records go to the server's standard error, which is where the MCP client keeps its logs, and to BCONNECT_AUDIT_FILE as JSON Lines when that is set."/>
              <TextBlock x:Name="lblAuditNow" Style="{StaticResource Sub}" Foreground="#202024" Text=""/>

              <StackPanel x:Name="auditOptions" Margin="0,14,0,0"/>
              <StackPanel Orientation="Horizontal" Margin="0,14,0,0">
                <Button x:Name="btnSetAudit" Content="Change the audit level" Style="{StaticResource Primary}"/>
                <TextBlock x:Name="lblAuditRestart" Foreground="#9A5B00" FontSize="12" TextWrapping="Wrap" VerticalAlignment="Center" Margin="14,0,0,0" Text=""/>
              </StackPanel>

              <TextBlock Text="RATE LIMITING" Style="{StaticResource Label}"/>
              <TextBlock Style="{StaticResource Sub}" Text="The limit is counted per server process, not per estate: every server started from this credentials file counts its own calls. It protects the bMS from a model in a loop; it is not a quota."/>
              <CheckBox x:Name="chkRate" Content="Limit how many requests each server may make" Margin="0,10,0,0"/>
              <StackPanel Orientation="Horizontal" Margin="22,10,0,0">
                <TextBlock Text="Requests" VerticalAlignment="Center" Margin="0,0,8,0" Foreground="#5C5C63" FontSize="12.5"/>
                <TextBox x:Name="txtRateMax" Width="80"/>
                <TextBlock Text="per window of" VerticalAlignment="Center" Margin="14,0,8,0" Foreground="#5C5C63" FontSize="12.5"/>
                <TextBox x:Name="txtRateWindow" Width="100"/>
                <TextBlock Text="milliseconds" VerticalAlignment="Center" Margin="8,0,0,0" Foreground="#5C5C63" FontSize="12.5"/>
              </StackPanel>
              <StackPanel Orientation="Horizontal" Margin="0,14,0,0">
                <Button x:Name="btnSetRate" Content="Change rate limiting" Style="{StaticResource Primary}"/>
                <TextBlock x:Name="lblRateNote" Foreground="#C4281F" FontSize="12" TextWrapping="Wrap" VerticalAlignment="Center" Margin="14,0,0,0" Text=""/>
              </StackPanel>

              <Border Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="1" CornerRadius="10" Padding="16,13" Margin="0,22,0,0">
                <StackPanel>
                  <TextBlock Text="SETTINGS THIS WINDOW CANNOT CHANGE" Foreground="#75757B" FontSize="11" FontWeight="SemiBold" Margin="0,0,0,8"/>
                  <TextBlock Style="{StaticResource Sub}" Margin="0,0,0,6" Text="Each of these is read by a server from its own process environment. Neither route reaches them: the credentials file is shared by every server, so a value set there applies to all of them at once, and the keys a client configuration may carry are a closed list that must not grow, because that file is merged into a third-party product's configuration."/>
                  <StackPanel x:Name="noRouteList"/>
                </StackPanel>
              </Border>
            </StackPanel>
            </ScrollViewer>
          </Grid>

          <!-- ============ page 5: MCP clients ============ -->
          <Grid x:Name="page5" Visibility="Collapsed">
            <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
            <StackPanel Grid.Row="0">
              <TextBlock Text="MCP clients" Style="{StaticResource H1}"/>
              <TextBlock Style="{StaticResource Sub}" Text="An MCP client is the application you type into. It starts these servers and offers their tools to the model. The list is ordered by how commonly baramundi customers run them."/>
              <!-- The same two chips the installer window shows, explained the same way and
                   in the same colours, because they answer the same question in both places:
                   does this window configure the client, or produce settings to apply. -->
              <Border BorderBrush="#22000000" BorderThickness="1" CornerRadius="4" Padding="10,8" Margin="0,10,0,0">
                <StackPanel>
                  <Grid Margin="0,0,0,5">
                    <Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
                    <Border Grid.Column="0" CornerRadius="3" Padding="6,2" Background="#014380" VerticalAlignment="Top" MinWidth="104">
                      <TextBlock Text="AUTOMATIC" Foreground="White" FontSize="10" FontWeight="SemiBold" HorizontalAlignment="Center"/>
                    </Border>
                    <TextBlock Grid.Column="1" Margin="10,0,0,0" TextWrapping="Wrap" FontSize="11.5"
                               Text="The configuration file this client reads is written for you. Restart the client and the change is there."/>
                  </Grid>
                  <Grid>
                    <Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
                    <Border Grid.Column="0" CornerRadius="3" Padding="6,2" Background="#9A5B00" VerticalAlignment="Top" MinWidth="104">
                      <TextBlock Text="MANUAL STEPS" Foreground="White" FontSize="10" FontWeight="SemiBold" HorizontalAlignment="Center"/>
                    </Border>
                    <TextBlock Grid.Column="1" Margin="10,0,0,0" TextWrapping="Wrap" FontSize="11.5"
                               Text="This client's configuration cannot be written by any installer. A file of settings is produced instead, and you apply them in that product's own interface. Every change on the other pages reaches such a client only when you do."/>
                  </Grid>
                </StackPanel>
              </Border>
            </StackPanel>
            <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto" Margin="0,12,0,0">
              <StackPanel x:Name="clientList" Margin="0,0,14,0"/>
            </ScrollViewer>
            <StackPanel Grid.Row="2" Orientation="Horizontal" Margin="0,12,0,0">
              <Button x:Name="btnResync" Content="Write every configured client again" Style="{StaticResource Flat}"/>
              <TextBlock x:Name="lblClientNote" Foreground="#5C5C63" FontSize="12" TextWrapping="Wrap" VerticalAlignment="Center" Margin="14,0,0,0"
                         Text="Re-writing replaces a managed entry that has been edited by hand with this installer's version. A backup is taken first, and nothing this installer does not own is touched."/>
            </StackPanel>
          </Grid>

          <!-- ============ page 6: activity ============
               Where every change actually happens. The pane on the right is
               bconnect.ps1's own output, verbatim, colours and all: the same
               treatment the installer window gives the engine. -->
          <Grid x:Name="page6" Visibility="Collapsed">
            <Grid.ColumnDefinitions><ColumnDefinition Width="380"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
            <Grid Grid.Column="0" Margin="0,0,18,0">
              <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
              <StackPanel Grid.Row="0">
                <TextBlock x:Name="lblRunTitle" Text="Activity" Style="{StaticResource H1}"/>
                <TextBlock x:Name="lblRunSub" Style="{StaticResource Sub}" Text="Nothing has been changed in this session."/>
              </StackPanel>
              <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto" Margin="0,16,0,0">
                <StackPanel>
                  <StackPanel x:Name="changeSummary" Visibility="Collapsed" Margin="0,0,0,14"/>
                  <StackPanel x:Name="stepList"/>
                </StackPanel>
              </ScrollViewer>
            </Grid>
            <!-- Deliberately dark: this pane renders the verb's own Write-Host colours
                 verbatim, and that mapping only reads against a dark backdrop. -->
            <Border Grid.Column="1" Background="#141417" BorderBrush="#2E2E34" BorderThickness="1" CornerRadius="10">
              <Grid>
                <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
                <Grid Grid.Row="0" Margin="14,10,14,6">
                  <TextBlock Text="OUTPUT" Foreground="#8C8C90" FontSize="11" FontWeight="SemiBold"/>
                  <TextBlock x:Name="lblElapsed" Foreground="#8C8C90" FontSize="11" HorizontalAlignment="Right" Text=""/>
                </Grid>
                <ScrollViewer x:Name="conScroll" Grid.Row="1" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" Margin="0,0,0,8">
                  <TextBlock x:Name="console" FontFamily="Consolas" FontSize="12" Foreground="#C8C8CC" Margin="14,0,14,0" TextWrapping="NoWrap"/>
                </ScrollViewer>
              </Grid>
            </Border>
          </Grid>
          </Grid>
        </Grid>
      </Grid>

      <!-- footer -->
      <Border Grid.Row="2" Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="0,1,0,0" CornerRadius="0,0,13,13" Height="62">
        <Grid Margin="24,0,24,0">
          <TextBlock x:Name="lblFooter" Foreground="#5C5C63" FontSize="12.5" VerticalAlignment="Center" TextWrapping="NoWrap" Text=""/>
          <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" VerticalAlignment="Center">
            <Button x:Name="btnRefresh" Content="Refresh" Style="{StaticResource Flat}" Margin="0,0,10,0"/>
            <Button x:Name="btnClose" Content="Close" Style="{StaticResource Primary}"/>
          </StackPanel>
        </Grid>
      </Border>
    </Grid>
  </Border>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$win    = [Windows.Markup.XamlReader]::Load($reader)

# Fit to the work area: the design size overflows a smaller or DPI-scaled screen, and
# a borderless window that lands off-screen cannot be dragged back.
try {
    $wa = [System.Windows.SystemParameters]::WorkArea
    $win.MaxWidth = $wa.Width; $win.MaxHeight = $wa.Height
    if ($win.Width  -gt $wa.Width)  { $win.Width  = $wa.Width }
    if ($win.Height -gt $wa.Height) { $win.Height = $wa.Height }
} catch { }

$els = @{}
foreach ($n in @('closeBtn','TitleBar','rail','modeBadge','logoHost','logoImage','logoFallback',
                 'page0','page1','page2','page3','page4','page5','page6',
                 'finishBar','lblFinishTitle','lblFinishWhy','lblFinishIntended','finishSteps',
                 'btnFinishNext','btnFinishStatus','lblFinishNote',
                 'lblStatusSub','statusList',
                 'writeList','confirmBar','lblConfirmWhat','txtConfirm','btnApplyWrites','btnWritesOff',
                 'lblWriteSummary','lblWriteRestart',
                 'lblConnNow','txtServerFqdn','lblComposedUrl','chkCustomUrl','pnlCustomUrl','txtBaseUrl',
                 'btnSetUrl','btnVerify','lblVerifyNote','rbApiKey','rbBasic',
                 'pnlApiKey','pwApiKey','pnlBasic','txtBasicUser','pwBasic','btnSetCredential','lblCredRestart',
                 'connReadOnly',
                 'lblV11State','txtV11User','pwV11','btnV11Set','btnV11Disable','lblV11Restart',
                 'lblAuditNow','auditOptions','btnSetAudit','lblAuditRestart','chkRate','txtRateMax',
                 'txtRateWindow','btnSetRate','lblRateNote','noRouteList',
                 'clientList','btnResync','lblClientNote',
                 'lblRunTitle','lblRunSub','changeSummary','stepList','console','conScroll','lblElapsed',
                 'lblFooter','btnRefresh','btnClose')) {
    $els[$n] = $win.FindName($n)
}

$els.closeBtn.Add_MouseLeftButtonDown({ $win.Close() })
$els.TitleBar.Add_MouseLeftButtonDown({ if ($_.OriginalSource -isnot [System.Windows.Controls.TextBlock]) { $win.DragMove() } })

# A borderless white window can lose its edge against an equally light desktop
# background. A soft shadow gives it a visible boundary without a hard outline.
try {
    $shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
    $shadow.BlurRadius = 18; $shadow.ShadowDepth = 0; $shadow.Opacity = 0.22
    $shadow.Color = [System.Windows.Media.Colors]::Black
    $win.Content.Effect = $shadow
} catch { }

# Branding assets -- loaded if present, degraded cleanly if not. No logo or icon is
# invented here: an absent file leaves the text wordmark and WPF's default window
# icon, never a broken-image box and never a crash.
if (Test-Path -LiteralPath $IconPath) {
    try {
        $iconBmp = New-Object System.Windows.Media.Imaging.BitmapImage
        $iconBmp.BeginInit()
        $iconBmp.UriSource = New-Object System.Uri((Resolve-Path -LiteralPath $IconPath).Path, [System.UriKind]::Absolute)
        $iconBmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $iconBmp.EndInit()
        $win.Icon = $iconBmp
    } catch { }   # a corrupt or unreadable .ico must not stop the window from opening
}
if (Test-Path -LiteralPath $LogoPath) {
    try {
        $logoBmp = New-Object System.Windows.Media.Imaging.BitmapImage
        $logoBmp.BeginInit()
        $logoBmp.UriSource = New-Object System.Uri((Resolve-Path -LiteralPath $LogoPath).Path, [System.UriKind]::Absolute)
        $logoBmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $logoBmp.EndInit()
        $els.logoImage.Source = $logoBmp
        $els.logoImage.Visibility = 'Visible'
        $els.logoFallback.Visibility = 'Collapsed'
    } catch { }   # a corrupt or unreadable logo leaves the text wordmark showing
}

# =============================================================================
# State
# =============================================================================
$PG_STATUS  = 0
$PG_WRITES  = 1
$PG_CONN    = 2
$PG_V11     = 3
$PG_AUDIT   = 4
$PG_CLIENTS = 5
$PG_RUN     = 6

$script:Page       = $PG_STATUS
$script:PageCount  = 7
$script:Running    = $false
$script:Status     = $null     # the model from `bconnect status -Json`
$script:StatusError = $null
$script:Clients    = @()       # Get-HostSelectionCatalog rows, joined to the model
$script:WriteRows  = @()       # one per configured server: @{ Name; Check; ToolChecks; Current }
$script:AuditRows  = @()       # one per audit level: @{ Level; Radio }
$script:NoRouteBuilt = $false  # the read-only list is static; built once per window
$script:Queue      = @()       # changes still to dispatch, in order
$script:Done       = @()       # what this session has changed, for the summary
$script:Refused    = $null     # a verb the dispatcher would not run; see Start-Queue
$script:StepBlocks = @{}
$script:Ps         = $null
$script:Handle     = $null
$script:Runspace   = $null
$script:InfoCursor = 0
$script:ExitCode   = $null

# -- the entry state ----------------------------------------------------------
# Three states, and the window opens on whichever one the installation is actually
# in. Not a parameter: a flag would be one more thing that can disagree with the
# disk, and the case this exists for -- a machine-stage deployment followed by an
# administrator opening this window -- is precisely a case where nobody is there to
# pass one.
$ES_NONE   = 'not-installed'
$ES_FINISH = 'finish'
$ES_READY  = 'configured'

$script:Entry       = $ES_READY
$script:Record      = $null    # the record itself, for the two fields status -Json does not project
$script:Intended    = @()      # Get-RecordIntendedHostIds: which clients this installation is FOR
$script:RecordStage = 'both'   # Get-RecordStage
$script:ConfiguredBy = $null   # which Windows account configured the clients the record names
$script:FinishAt    = 0        # index into $FinishSteps

# The finish, as data: the pages it walks, in order, and what each one answers. The
# order is the order the engine needs them in -- a client cannot be configured before
# there is a credential to configure it with, and the write gate is written into the
# client configurations, so it comes after there are some.
#
# Every entry is a page THAT ALREADY EXISTS. Adding a step means naming another
# existing page here; it must never mean building another one.
$FinishSteps = @(
    [pscustomobject]@{ Page = $PG_CONN;    Title = 'Credentials'
                       Blurb = 'the bConnect account every server on this machine uses'
                       Does  = 'Set the base URL and the credential' }
    [pscustomobject]@{ Page = $PG_CLIENTS; Title = 'MCP clients'
                       Blurb = 'which applications this account runs these servers from'
                       Does  = 'Configure the clients this account uses' }
    [pscustomobject]@{ Page = $PG_WRITES;  Title = 'Write access'
                       Blurb = 'read-only, or permitted to change the estate'
                       Does  = 'Decide which servers may change the estate' }
)

$PageTitles = @(
    'Status',
    'Write access',
    'Connection',
    'bConnect v1.1',
    'Audit and limits',
    'MCP clients',
    'Activity'
)
$PageBlurbs = @(
    'what is installed, and where',
    'per server, and which tools',
    'base URL and credential',
    'the gate and its credentials',
    'what is recorded, and how often',
    'configured, or settings to apply',
    'what has been changed here'
)

# The audit levels, as data: the option list, the sentence under each one, and the
# value the verb takes. Written once so the page and the summary agree.
$AuditLevels = @(
    [pscustomobject]@{ Level = 'all';      Title = 'Every tool call';
                       Text  = 'Reads as well as writes. The most complete record, and the largest one.' }
    [pscustomobject]@{ Level = 'write';    Title = 'Calls that change something';
                       Text  = 'The shipped default. Every write is attributable; reads are not recorded.' }
    [pscustomobject]@{ Level = 'security'; Title = 'The security-relevant subset';
                       Text  = 'Credential-returning and gate-related calls only.' }
    [pscustomobject]@{ Level = 'none';     Title = 'Nothing is recorded';
                       Text  = 'No audit record is produced. A write cannot be attributed afterwards.' }
)

# The settings this window reports and cannot change. Each states the reason, because
# "not available" without one reads as an omission rather than a decision.
$NoRouteSettings = @(
    [pscustomobject]@{
        Key   = 'ALLOW_SECRET_READ'
        What  = 'Permits the tools that return live BitLocker recovery keys, LAPS passwords and the bMS API-key inventory.'
        Why   = 'A security gate, read per server process. It is not in the credentials file key set, and adding it there would open those tools in every configured server at once. It is not in the closed list of keys a client configuration may carry either.'
        How   = 'Set ALLOW_SECRET_READ=true in the environment of the one server that needs it -- the client''s env block for that server, or the container environment -- and restart it.'
    }
    [pscustomobject]@{
        Key   = 'ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT'
        What  = 'Permits assigning a job the bMS itself flags Destructive -- a wipe or an OS deployment -- to a group.'
        Why   = 'A second gate inside the write gate: accepting writes is not accepting unattended wipes. Same two closed routes as above, and the same reason neither is widened.'
        How   = 'Set ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT=true in the jobs server''s own environment and restart it. Group membership for a dynamic group is computed by the bMS, so the machines affected cannot be enumerated before the call.'
    }
    [pscustomobject]@{
        Key   = 'BMC_CONSOLE_LINKS'
        What  = 'Adds deep links into the baramundi Management Center to endpoint results. Off unless set.'
        How   = 'Set BMC_CONSOLE_LINKS=true in the endpoints server''s own environment and restart it.'
        Why   = 'Not a credential and not a capability gate, so it belongs to neither key set. It is a per-server display option.'
    }
    [pscustomobject]@{
        Key   = 'BCONNECT_COMPOSITE_BUDGET_MS'
        What  = 'The time budget a composite call spends paging before it returns what it has. 25000 ms when unset; values below 1000 ms are clamped.'
        Why   = 'A per-server tuning value in neither key set.'
        How   = 'Set BCONNECT_COMPOSITE_BUDGET_MS in that server''s own environment and restart it.'
    }
)

# =============================================================================
# Small builders -- the same ones the installer window uses, same signatures.
# =============================================================================
function New-Line($text, $color, $size = 12.5, $bold = $false) {
    $t = New-Object System.Windows.Controls.TextBlock
    $t.Text = $text; $t.Foreground = (Br $color); $t.FontSize = $size
    $t.TextWrapping = 'Wrap'
    if ($bold) { $t.FontWeight = 'SemiBold' }
    return $t
}

function New-Card {
    param([string] $Heading, [string[]] $Lines, [string] $LineColor, [string] $Border)
    if (-not $LineColor) { $LineColor = $C.Muted }
    if (-not $Border) { $Border = $C.Border }
    $card = New-Object System.Windows.Controls.Border
    $card.Background = (Br $C.Card); $card.BorderBrush = (Br $Border); $card.BorderThickness = (Thk 1 1 1 1)
    $card.CornerRadius = (New-Object System.Windows.CornerRadius(9))
    $card.Padding = (Thk 14 11 14 12); $card.Margin = (Thk 0 0 0 8)
    $sp = New-Object System.Windows.Controls.StackPanel
    if ($Heading) { [void]$sp.Children.Add((New-Line $Heading $C.Txt 13.5 $true)) }
    foreach ($l in $Lines) {
        $t = New-Line ('-  ' + $l) $LineColor 12.5
        $t.Margin = (Thk 0 5 0 0)
        [void]$sp.Children.Add($t)
    }
    $card.Child = $sp
    return $card
}

function New-Badge {
    param([string] $Text, [string] $Background)
    $b = New-Object System.Windows.Controls.Border
    $b.CornerRadius = (New-Object System.Windows.CornerRadius(3))
    $b.Padding = (Thk 6 2 6 2); $b.MinWidth = 104; $b.VerticalAlignment = 'Top'
    $b.Background = (Br $Background)
    $t = New-Line $Text '#FFFFFF' 10 $true
    $t.HorizontalAlignment = 'Center'
    $b.Child = $t
    return $b
}

# =============================================================================
# Running a verb.
#
# One dispatcher, one place that knows how to call bconnect.ps1, and a closed list
# of verbs it will dispatch. A change is a hashtable of parameters plus the words
# that describe it; Get-PendingChanges on each page returns those without running
# anything, which is what makes the pages testable and what keeps the description
# and the command from being written in two different places.
# =============================================================================
function Get-PathOverrides {
    # Whatever this window was pointed at, every verb is pointed at the same place.
    # Absent all of them, bconnect.ps1 uses the installation record, which is the
    # normal case and the reason none of these has a default here.
    $p = @{}
    if ($StateFile)          { $p['StateFile']          = $StateFile }
    if ($SuiteRootOverride)  { $p['SuiteRootOverride']  = $SuiteRootOverride }
    if ($SecretsDirOverride) { $p['SecretsDirOverride'] = $SecretsDirOverride }
    if ($ProjectDirOverride) { $p['ProjectDirOverride'] = $ProjectDirOverride }
    if ($HostOutDirOverride) { $p['HostOutDirOverride'] = $HostOutDirOverride }
    if ($ConfigPathOverride) { $p['ConfigPathOverride'] = $ConfigPathOverride }
    return $p
}

function New-Change {
<#
.SYNOPSIS
    One pending change: the verb parameters, and the sentences that describe it.
.DESCRIPTION
    Scope is 'host', 'credentials' or 'none', and it decides which restart notice
    the summary carries. It is a property of the change, stated where the change is
    built, so a new change cannot arrive without an answer to "when does this take
    effect?".
#>
    param(
        [Parameter(Mandatory)] [hashtable] $Params,
        [Parameter(Mandatory)] [string] $What,
        [ValidateSet('host', 'credentials', 'none')] [string] $Scope = 'none'
    )
    return [pscustomobject]@{ Params = $Params; What = $What; Scope = $Scope }
}

function Invoke-BConnectSync {
<#
.SYNOPSIS
    Run a read-only verb and wait. Used for `status -Json` only.
.DESCRIPTION
    On a private runspace, not in this one, because bconnect.ps1 ends with `exit`
    and that would take the window with it. `&` from inside the runspace's script
    returns with $LASTEXITCODE set, which is emitted as the last object so the
    caller learns the outcome as well as the output.
#>
    param([hashtable] $Params)
    $rs = [runspacefactory]::CreateRunspace()
    $rs.ApartmentState = 'STA'
    $rs.Open()
    $ps = [powershell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript({
        param($Script, $P)
        & $Script @P
        if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    }).AddArgument($Bconnect).AddArgument($Params)
    $out = @()
    $err = $null
    try { $out = @($ps.Invoke()) } catch { $err = $_.Exception.Message }
    foreach ($e in $ps.Streams.Error) { if (-not $err) { $err = $e.ToString() } }
    try { $ps.Dispose() } catch { }
    try { $rs.Close(); $rs.Dispose() } catch { }
    $code = $null
    if ($out.Count) { $code = $out[-1] }
    return @{ Output = @($out | Select-Object -SkipLast 1); Code = $code; Error = $err }
}

function Update-Status {
<#
.SYNOPSIS
    Re-read the installation, from the CLI, as data.
#>
    $script:StatusError = $null
    $r = Invoke-BConnectSync -Params ((Get-PathOverrides) + @{ Verb = 'status'; Json = $true })
    if ($r.Error -or -not @($r.Output).Count) {
        $script:Status = $null
        $script:StatusError = $(if ($r.Error) { $r.Error } else { 'bconnect.ps1 status produced no output.' })
    } else {
        try {
            $script:Status = ((@($r.Output) -join "`n") | ConvertFrom-Json)
        } catch {
            $script:Status = $null
            $script:StatusError = 'The status output could not be read as JSON: ' + $_.Exception.Message
        }
    }
    # The intended client list and the stage, before the catalogue join below reads
    # them. Both come out of the record through State.psm1; neither is invented here.
    Read-RecordFacts

    # The client catalogue, resolved against the same paths the record uses, and
    # joined to what the record says is configured. Labels, the automatic/manual
    # distinction and its badge colours all come from there -- this window does not
    # decide any of them.
    $projectDir = $ProjectRoot
    $hostOutDir = Join-Path $InstallerDir 'out'
    $configPath = $null
    if ($script:Status) {
        if ($script:Status.projectDir) { $projectDir = $script:Status.projectDir }
        if ($script:Status.hostOutDir) { $hostOutDir = $script:Status.hostOutDir }
        foreach ($h in @($script:Status.hosts)) { if ($h.id -eq 'claude-desktop') { $configPath = $h.path } }
    }
    $rows = @(Get-HostSelectionCatalog -ProjectDir $projectDir -HostOutDir $hostOutDir -ConfigPath $configPath)
    foreach ($row in $rows) {
        $rec = $null
        if ($script:Status) { foreach ($h in @($script:Status.hosts)) { if ($h.id -eq $row.Id) { $rec = $h } } }
        # Named in the model AND its file is on disk. The second half matters after a
        # machine-stage deployment: the record carries no configured client, so the
        # CLI falls back to its default target and reports that row as MISSING FILE.
        # Treating a row with no file as configured would make the window claim this
        # account has a client it does not have, which is the exact failure the
        # two-stage split exists to close.
        Add-Member -InputObject $row -NotePropertyName Configured -NotePropertyValue ([bool]($rec -and $rec.exists)) -Force
        Add-Member -InputObject $row -NotePropertyName ConfiguredPath -NotePropertyValue $(if ($rec) { [string]$rec.path } else { '' }) -Force
        Add-Member -InputObject $row -NotePropertyName ConfiguredState -NotePropertyValue $(if ($rec) { [string]$rec.state } else { '' }) -Force
        Add-Member -InputObject $row -NotePropertyName Intended -NotePropertyValue ([bool]($script:Intended -contains $row.Id)) -Force
    }
    $script:Clients = $rows
    $script:Entry = Get-EntryState
    if ($script:Entry -ne $ES_FINISH) { $script:FinishAt = 0 }
}

function Read-RecordFacts {
<#
.SYNOPSIS
    The two facts the status model does not project: the intended client list, and
    which stage and which account last wrote the record.
.DESCRIPTION
    Through lib\State.psm1's accessors, at the state file the CLI resolved and
    reported. This window does not decide where the record lives and does not parse
    it: a record shape read a second way here is exactly the parallel copy this
    project has had to remove five times.
#>
    $script:Record = $null
    $script:Intended = @()
    $script:RecordStage = 'both'
    $script:ConfiguredBy = $null
    if (-not $script:Status -or -not $script:Status.stateFile) { return }
    $script:Record = Read-InstallationRecord -Path ([string]$script:Status.stateFile)
    if (-not $script:Record) { return }
    $script:Intended    = @(Get-RecordIntendedHostIds $script:Record)
    $script:RecordStage = [string](Get-RecordStage $script:Record)
    if ((Get-PropName $script:Record) -contains 'configuredBy' -and $script:Record.configuredBy) {
        $script:ConfiguredBy = [string]$script:Record.configuredBy
    }
}

function Get-EntryState {
<#
.SYNOPSIS
    Which of the three states this installation is in, from the record and the disk.
.DESCRIPTION
    Read in this order, because each answer makes the next question meaningful:

      1. Is anything installed at all. `installed` is the CLI's own answer, and it is
         true for a record OR for bconnect-* entries adoption found in a client
         configuration file.
      2. Can the credentials file be read. An unreadable one is a DPAPI blob written
         by a DIFFERENT Windows account -- a real state on a workstation two
         administrators share -- and it is NOT the finish case: nothing this window
         offers would repair it, and the Status page already states it exactly. So it
         opens on Status rather than on a finish that cannot finish.
      3. Does THIS account have a credential, and a client configuration. Either one
         missing is the half-done state a machine-stage deployment leaves behind.
#>
    if ($script:StatusError -or -not $script:Status -or -not $script:Status.installed) { return $ES_NONE }
    $cr = $script:Status.credentials
    if (-not $cr) { return $ES_FINISH }
    if ($cr.readError) { return $ES_READY }
    if ($cr.mode -eq 'none' -or -not $cr.authKind -or $cr.authKind -eq 'none') { return $ES_FINISH }
    if (-not @(Get-ConfiguredClients).Count) { return $ES_FINISH }
    return $ES_READY
}

function Get-FinishReasons {
<#
.SYNOPSIS
    Why the finish is being offered, as specific findings rather than a mood.
#>
    $out = @()
    if ($script:Entry -ne $ES_FINISH) { return $out }
    $cr = $null
    if ($script:Status) { $cr = $script:Status.credentials }
    if (-not $cr -or $cr.mode -eq 'none' -or -not $cr.authKind -or $cr.authKind -eq 'none') {
        $out += 'No bConnect credential is stored for this Windows account.'
    }
    if (-not @(Get-ConfiguredClients).Count) {
        $out += 'No MCP client is configured for this Windows account.'
    }
    if ($script:RecordStage -eq 'machine') {
        $out += 'The machine stage placed the suite here and collected neither, by design: a credential is protected for one Windows account, and a client configuration belongs to one person.'
    } elseif ($script:ConfiguredBy) {
        $out += "The client configurations this record names were written by $($script:ConfiguredBy). Each Windows account is configured separately."
    }
    return $out
}

function Get-ConfiguredClients { return @($script:Clients | Where-Object { $_.Configured }) }

function Test-CredentialStorePresent {
<#
.SYNOPSIS
    Whether a credentials file exists for this Windows account at all.
.DESCRIPTION
    Mode 'none' means neither form is on disk. Distinct from readError, which means
    one IS there and belongs to another account. Every page that edits a line in that
    file asks this, so no page offers a change to a file that does not exist.
#>
    if (-not $script:Status -or -not $script:Status.credentials) { return $false }
    return ([string]$script:Status.credentials.mode -ne 'none')
}

function Get-RestartNotice {
<#
.SYNOPSIS
    What has to be restarted before a change of this kind takes effect, naming the
    clients from lib\hosts.json rather than saying "your MCP client".
.DESCRIPTION
    This is the knowledge that was nowhere: a host-configuration change is read by
    the client when it starts, and a credentials change is read by a server process
    when IT starts -- which in practice is when the client starts it. A client this
    installer cannot configure gets a third sentence, because for that one the change
    does not arrive at all until the emitted settings are applied by hand.
#>
    param([ValidateSet('host', 'credentials')] [string] $Scope)
    $auto = @(Get-ConfiguredClients | Where-Object { $_.Setup -eq 'automatic' })
    $man  = @(Get-ConfiguredClients | Where-Object { $_.Setup -eq 'manual' })
    $out = @()
    if (-not @(Get-ConfiguredClients).Count) {
        return @('No MCP client is configured, so there is nothing to restart. Run the installer to configure one.')
    }
    $names = @($auto | ForEach-Object { $_.Label })
    if ($Scope -eq 'host') {
        foreach ($r in $auto) {
            if ($r.Id -eq 'claude-desktop') {
                $out += "$($r.Label): quit it from the tray icon (Quit), not by closing the window, then start it again."
            } else {
                $out += "$($r.Label): close it and start it again."
            }
        }
        if ($names.Count) {
            $out += 'This change is written into a configuration file each of those clients reads when it starts. Until it is restarted, nothing has changed for it.'
        }
    } else {
        foreach ($r in $auto) {
            if ($r.Id -eq 'claude-desktop') {
                $out += "$($r.Label): quit it from the tray icon (Quit) and start it again, so the servers it runs are started again."
            } else {
                $out += "$($r.Label): close it and start it again, so the servers it runs are started again."
            }
        }
        if ($names.Count) {
            $out += 'This change is written into the credentials file. A server process that is already running keeps the value it started with; the client starts those processes.'
        }
        if ($script:Status -and $script:Status.credentials -and $script:Status.credentials.gatewayTokenPresent) {
            $out += 'The HTTP gateway runs as its own process and is not restarted by any client. Stop it and start it again.'
        }
    }
    # A client this installer cannot configure, and the two scopes differ for it. A
    # host-configuration change re-writes the settings file it was given, so those
    # settings have to be applied again. A credentials change does not touch that
    # file at all -- it is read by the server process, which for an HTTP client is
    # the gateway rather than anything the operator applied by hand.
    foreach ($r in $man) {
        if ($Scope -eq 'host') {
            $out += "$($r.Label): this installer cannot write its configuration. The settings for it were written again to $($r.ConfiguredPath). Apply them in $($r.Label)'s own interface; until that is done, this change has not reached it."
        } else {
            $out += "$($r.Label): this installer cannot write its configuration, and the settings at $($r.ConfiguredPath) are unchanged by this. The servers behind it read the credentials file when their process starts, which for an HTTP client is the gateway process."
        }
    }
    return $out
}

function Start-Queue {
<#
.SYNOPSIS
    Dispatch the pending changes, one after another, on a private runspace.
.DESCRIPTION
    Sequential rather than parallel, and deliberately: two verbs writing the same
    credentials file at once is a corrupted file, and the second one would be
    reading state the first has not finished changing.
#>
    param([array] $Changes)
    if ($script:Running -or -not @($Changes).Count) { return }
    $script:Refused = $null
    foreach ($ch in @($Changes)) {
        $v = [string]$ch.Params['Verb']
        if ($VERBS_ALLOWED -notcontains $v) {
            # Not a message for an operator: it is a stop for a change that reached a
            # page without going through the verb front end. Recorded as well as
            # shown, so lib\Test-ManageGui.ps1 can assert the refusal rather than
            # waiting on a modal box for a click nobody is there to give.
            $script:Refused = $v
            if (-not $TestHeadless) {
                [void][System.Windows.MessageBox]::Show(
                    "This window will not run '$v'. Every change it makes goes through bconnect.ps1.",
                    'bConnect-MCP settings', 'OK', 'Error')
            }
            return
        }
    }
    $script:Queue = @($Changes)
    $script:Done  = @()
    $els.stepList.Children.Clear()
    $script:StepBlocks = @{}
    $els.console.Inlines.Clear()
    $els.changeSummary.Children.Clear()
    $els.changeSummary.Visibility = 'Collapsed'
    $script:Page = $PG_RUN
    Show-Page
    Start-NextChange
}

function Start-NextChange {
    if (-not @($script:Queue).Count) { Complete-Queue; return }
    $change = $script:Queue[0]
    $script:Queue = @($script:Queue | Select-Object -Skip 1)
    $script:Running   = $true
    $script:InfoCursor = 0
    $script:ExitCode  = $null

    $n = @($script:Done).Count + 1
    Set-StepState $n $change.What 'running'
    $els.lblRunTitle.Text = 'Changing'
    $els.lblRunTitle.Foreground = (Br $C.Accent)
    $els.lblRunSub.Text = $change.What

    $params = (Get-PathOverrides)
    foreach ($k in $change.Params.Keys) { $params[$k] = $change.Params[$k] }

    # A SecureString goes in as a parameter object, on a runspace in this process.
    # It never becomes text, never reaches a command line, and never leaves here.
    $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
    $script:Runspace = [runspacefactory]::CreateRunspace($iss)
    $script:Runspace.ApartmentState = 'STA'
    $script:Runspace.ThreadOptions  = 'ReuseThread'
    $script:Runspace.Open()
    $script:Ps = [powershell]::Create()
    $script:Ps.Runspace = $script:Runspace
    [void]$script:Ps.AddScript({
        param($Script, $P)
        & $Script @P
        if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    }).AddArgument($Bconnect).AddArgument($params)
    $script:Handle = $script:Ps.BeginInvoke()

    Append-Console ('> bconnect.ps1 ' + (Get-CommandEcho $params)) $Con.Faint
    Append-Console '' $null

    # The tick handler cannot see these locals once this function returns, so what it
    # needs travels on the timer itself and is read back through $this.
    $timer = New-Object System.Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(120)
    $timer | Add-Member -NotePropertyName Started -NotePropertyValue (Get-Date)
    $timer | Add-Member -NotePropertyName Change  -NotePropertyValue $change
    $timer | Add-Member -NotePropertyName StepNo  -NotePropertyValue $n
    $timer.Add_Tick({
        $els.lblElapsed.Text = ('{0:mm\:ss}' -f ((Get-Date) - $this.Started))
        # Write-Host in 5.1 is an InformationRecord tagged PSHOST, so this is the
        # verb's real output, in order, with its colours.
        $info = $script:Ps.Streams.Information
        while ($script:InfoCursor -lt $info.Count) {
            $rec = $info[$script:InfoCursor]
            $script:InfoCursor++
            $md = $rec.MessageData
            $text = ''
            $col  = $null
            if ($md -is [System.Management.Automation.HostInformationMessage]) {
                $text = [string]$md.Message
                if ($md.ForegroundColor -and $script:ConsoleColorMap.ContainsKey([string]$md.ForegroundColor)) {
                    $col = $script:ConsoleColorMap[[string]$md.ForegroundColor]
                }
            } else {
                $text = [string]$md
            }
            Append-Console $text $col
        }
        if (-not ($script:Handle -and $script:Handle.IsCompleted)) { return }
        $this.Stop()

        $ex = $null
        $out = @()
        try { $out = @($script:Ps.EndInvoke($script:Handle)) } catch { $ex = $_.Exception.Message }
        foreach ($e in $script:Ps.Streams.Error) { Append-Console ('ERROR: ' + $e.ToString()) $Con.Crit }
        try { $script:Ps.Dispose() } catch { }
        try { $script:Runspace.Close(); $script:Runspace.Dispose() } catch { }
        $script:Ps = $null; $script:Handle = $null; $script:Runspace = $null
        $script:Running = $false

        # No exit code at all means the verb died before it could report one. That is
        # a failure, not an unknown.
        $code = $null
        if (@($out).Count) { $code = $out[-1] }
        if ($ex) { Append-Console ('ERROR: ' + $ex) $Con.Crit; $code = $null }
        $failed = ($null -eq $code -or [int]$code -ne 0)
        Set-StepState $this.StepNo $null $(if ($failed) { 'fail' } else { 'done' })
        $script:Done += [pscustomobject]@{ Change = $this.Change; Failed = $failed; Code = $code }

        # A failure stops the queue. Running the rest against a state the first
        # change did not reach is how a half-applied set of settings happens.
        if ($failed) { $script:Queue = @() }
        Start-NextChange
    })
    $script:RunTimer = $timer
    $timer.Start()
    Update-Nav
}

function Get-CommandEcho {
<#
.SYNOPSIS
    The command that is running, for the output pane. Secrets are named, never shown.
#>
    param([hashtable] $Params)
    $parts = @()
    foreach ($k in @('Verb', 'Object')) { if ($Params.ContainsKey($k)) { $parts += [string]$Params[$k] } }
    if ($Params.ContainsKey('Rest')) { $parts += @($Params['Rest']) }
    foreach ($k in ($Params.Keys | Sort-Object)) {
        if (@('Verb', 'Object', 'Rest') -contains $k) { continue }
        $v = $Params[$k]
        if ($v -is [System.Security.SecureString]) { $parts += "-$k <SecureString>" }
        elseif ($v -is [bool] -or $v -is [switch]) { $parts += "-$k" }
        else { $parts += "-$k $v" }
    }
    return ($parts -join ' ')
}

function Complete-Queue {
    $failed = @($script:Done | Where-Object { $_.Failed })
    if ($failed.Count) {
        $els.lblRunTitle.Text = 'Finished with problems'
        $els.lblRunTitle.Foreground = (Br $C.Crit)
        $els.lblRunSub.Text = 'The output on the right says which step and why. Nothing here is hidden from you.'
    } else {
        $els.lblRunTitle.Text = 'Changed'
        $els.lblRunTitle.Foreground = (Br $C.Ok)
        $els.lblRunSub.Text = 'The summary below is the whole of what remains to be done.'
    }
    Build-ChangeSummary
    # The pages are rebuilt from a fresh reading of the installation rather than from
    # what this window believes it just did. If a verb changed less than it was asked
    # to, the next screen says so.
    Update-Status
    Update-Pages
    Update-Nav
}

function Get-ChangeSummary {
<#
.SYNOPSIS
    What this session changed, and what has to happen before it takes effect.
#>
    $sections = @()
    $ok  = @($script:Done | Where-Object { -not $_.Failed })
    $bad = @($script:Done | Where-Object { $_.Failed })
    if ($ok.Count) {
        $sections += [pscustomobject]@{ Key = 'changed'; Heading = 'Changed'
                                        Lines = @($ok | ForEach-Object { $_.Change.What }) }
    }
    if ($bad.Count) {
        $sections += [pscustomobject]@{ Key = 'failed'; Heading = 'Not changed'
                                        Lines = @($bad | ForEach-Object { $_.Change.What + ' -- the verb exited ' + $(if ($null -eq $_.Code) { 'without a status' } else { $_.Code }) + '.' }) }
    }
    foreach ($scope in @('host', 'credentials')) {
        if (-not @($ok | Where-Object { $_.Change.Scope -eq $scope }).Count) { continue }
        $heading = $(if ($scope -eq 'host') { 'Restart before the change takes effect' }
                     else { 'Restart before the new value is used' })
        $sections += [pscustomobject]@{ Key = 'restart-' + $scope; Heading = $heading
                                        Lines = @(Get-RestartNotice $scope) }
    }
    if (-not @($script:Done).Count) {
        $sections += [pscustomobject]@{ Key = 'none'; Heading = 'Nothing was changed'
                                        Lines = @('No change has been made in this session.') }
    }
    return $sections
}

function Build-ChangeSummary {
    $els.changeSummary.Children.Clear()
    foreach ($s in (Get-ChangeSummary)) {
        $col = $(if ($s.Key -eq 'failed') { $C.Crit } elseif ($s.Key -like 'restart-*') { $C.Warn } else { $C.Muted })
        [void]$els.changeSummary.Children.Add((New-Card -Heading $s.Heading -Lines $s.Lines -LineColor $col))
    }
    $els.changeSummary.Visibility = 'Visible'
}

# =============================================================================
# The output pane
# =============================================================================
function Append-Console($text, $color) {
    $r = New-Object System.Windows.Documents.Run
    $r.Text = $text + "`n"
    if ($color) { $r.Foreground = (Br $color) }
    [void]$els.console.Inlines.Add($r)
    $els.conScroll.ScrollToEnd()
}

# Mapped from $Con (the pane's own dark palette), not $C -- the light chrome colours
# would not have the contrast this dark backdrop needs.
$script:ConsoleColorMap = @{
    'Green' = $Con.Ok; 'Yellow' = $Con.Warn; 'Red' = $Con.Crit; 'Cyan' = $Con.Accent
    'DarkCyan' = $Con.DarkCyan; 'Gray' = $Con.Gray; 'DarkGray' = $Con.DarkGray; 'White' = $Con.White
    'DarkYellow' = $Con.DarkYellow
}

function Set-StepState($n, $title, $state) {
    if (-not $script:StepBlocks.ContainsKey($n)) {
        $bd = New-Object System.Windows.Controls.Border
        $bd.Padding = (Thk 10 7 10 7); $bd.Margin = (Thk 0 0 0 3)
        $bd.CornerRadius = (New-Object System.Windows.CornerRadius(7))
        $sp = New-Object System.Windows.Controls.StackPanel
        $sp.Orientation = 'Horizontal'
        $dot = New-Object System.Windows.Shapes.Ellipse
        $dot.Width = 9; $dot.Height = 9; $dot.VerticalAlignment = 'Top'; $dot.Margin = (Thk 0 5 11 0)
        $tb = New-Line '' $C.Txt 13
        $tb.MaxWidth = 300
        [void]$sp.Children.Add($dot); [void]$sp.Children.Add($tb)
        $bd.Child = $sp
        [void]$els.stepList.Children.Add($bd)
        $script:StepBlocks[$n] = @{ Border = $bd; Dot = $dot; Text = $tb; Title = $title }
    }
    $b = $script:StepBlocks[$n]
    if ($title) { $b.Title = $title }
    $b.Text.Text = ('{0}.  {1}' -f $n, $b.Title)
    switch ($state) {
        'running' { $b.Dot.Fill = (Br $C.Accent); $b.Border.Background = (Br $C.Card2); $b.Text.Foreground = (Br $C.Txt); $b.Text.FontWeight = 'SemiBold' }
        'done'    { $b.Dot.Fill = (Br $C.Ok);     $b.Border.Background = (Br 'Transparent'); $b.Text.Foreground = (Br $C.Muted); $b.Text.FontWeight = 'Normal' }
        'fail'    { $b.Dot.Fill = (Br $C.Crit);   $b.Border.Background = (Br $C.CritBg); $b.Text.Foreground = (Br $C.Crit); $b.Text.FontWeight = 'SemiBold' }
    }
}

# =============================================================================
# Page 0 -- status. Rendered from the model; nothing here is computed.
# =============================================================================
function Build-StatusPage {
    $els.statusList.Children.Clear()
    if ($script:StatusError) {
        $els.lblStatusSub.Text = 'The installation could not be read.'
        [void]$els.statusList.Children.Add((New-Card -Heading 'bconnect.ps1 status did not answer' `
            -Lines @($script:StatusError,
                     'Every page in this window reads that command. Run .\bconnect.ps1 status from a console to see the same failure with its full output.') `
            -LineColor $C.Crit -Border $C.Crit))
        return
    }
    $m = $script:Status
    if (-not $m -or -not $m.installed) {
        $els.lblStatusSub.Text = 'Nothing is installed as far as this machine can tell.'
        [void]$els.statusList.Children.Add((New-Card -Heading 'No installation was found' `
            -Lines @("There is no record at $(if ($m) { $m.stateFile } else { '(unknown)' }), and no bconnect-* entries in any known client configuration file.",
                     'Run Install-BConnectMcp-UI.ps1 to install. This window changes an installation; it does not create one.') `
            -LineColor $C.Warn -Border $C.Warn))
        return
    }

    $els.lblStatusSub.Text = 'Everything below is what .\bconnect.ps1 status reports, rendered. This page computes nothing of its own.'

    if ($m.adopted) {
        [void]$els.statusList.Children.Add((New-Card -Heading 'Reconstructed, not recorded' `
            -Lines @('There is no installation record. This view was reconstructed from the client configuration files and the credentials store.',
                     'That is the normal state of an installation made before the record existed. The next change made here writes a real one.') `
            -LineColor $C.Warn -Border $C.Warn))
    } else {
        [void]$els.statusList.Children.Add((New-Card -Heading 'Installation' -Lines @(
            "Record: $($m.stateFile)",
            "Schema $($m.record.schema), last run $($m.record.lastRun), installer $($m.record.installerVersion)",
            "Suite root: $($m.suiteRoot)",
            $(if ($m.nodeVersion) { "Node $($m.nodeVersion)" } else { 'Node.js is not on PATH in this session.' })
        )))
        if (-not $m.record.lastRunVerified) {
            [void]$els.statusList.Children.Add((New-Card -Heading 'The last run did not pass verification' `
                -Lines @('Use Verify the connection on the Connection page to run it again. Verification starts each configured server the way the client does and makes a real read call.') `
                -LineColor $C.Warn -Border $C.Warn))
        }
    }

    $cr = $m.credentials
    if ($cr.readError) {
        [void]$els.statusList.Children.Add((New-Card -Heading 'The credentials file cannot be read' -Lines @(
            [string]$cr.readError,
            'A DPAPI blob is readable only by the Windows account that created it, on the machine that created it. Nothing in this window will overwrite it.'
        ) -LineColor $C.Crit -Border $C.Crit))
    } else {
        [void]$els.statusList.Children.Add((New-Card -Heading 'Credentials' -Lines @(
            "$($cr.activePath) [$($cr.mode)]",
            'Base URL: ' + $(if ($cr.baseUrl) { $cr.baseUrl } else { '(not set)' }),
            'Authentication: ' + $(switch ($cr.authKind) { 'apikey' { 'API key. The value is not shown.' }
                                                           'basic'  { 'Basic, as ' + $cr.basicUser }
                                                           default  { '(none)' } }),
            'bConnect v1.1: ' + $(if ($cr.v11Configured) { 'configured as ' + $cr.v11Username } else { 'not configured' }),
            'CA certificate: ' + $(if ($cr.caCertPath) { $cr.caCertPath } else { '(none -- the Windows certificate store is used)' }),
            'HTTP gateway: ' + $(if ($cr.gatewayTokenPresent) { 'a bearer token is present. The value is not shown.' } else { 'no token' }),
            'Audit level: ' + $(if ($cr.auditLevel) { $cr.auditLevel } else { '(not set -- the servers audit writes)' }),
            'Rate limiting: ' + $(if ($cr.rateLimitEnabled -eq 'true') { "$($cr.rateLimitMaxRequests) requests per $($cr.rateLimitWindowMs) ms" } elseif ($cr.rateLimitEnabled) { 'off' } else { '(not set)' })
        )))
    }

    $srv = @($m.servers)
    $lines = @()
    if (-not $srv.Count) { $lines += 'No server is configured.' }
    foreach ($s in $srv) {
        if (-not $s.managed) { $lines += "$($s.name): not in lib\catalog.json. It is never touched by this installer."; continue }
        $bits = @()
        switch ($s.writes) {
            'all'     { $bits += "write access to all $($s.writeToolCount) write tools" }
            'limited' { $bits += "write access to $(@($s.writeTools).Count) of $($s.writeToolCount) write tools" }
            default   { $bits += 'read-only' }
        }
        if ($s.v11) { $bits += 'v1.1 on' }
        if (-not $s.deployed) { $bits += 'in the record only -- not written to any client' }
        $lines += "$($s.name): " + ($bits -join ', ') + '.'
    }
    [void]$els.statusList.Children.Add((New-Card -Heading 'Servers' -Lines $lines))

    $clines = @()
    foreach ($r in (Get-ConfiguredClients)) {
        $clines += "$($r.Label) [$($r.SetupBadge)]: $($r.ConfiguredState) in $($r.ConfiguredPath)"
    }
    if (-not $clines.Count) { $clines += 'No MCP client is configured.' }
    [void]$els.statusList.Children.Add((New-Card -Heading 'Configured MCP clients' -Lines $clines))

    if (@($m.drift).Count) {
        $dl = @()
        foreach ($d in @($m.drift)) { $dl += $d.text + '  ->  ' + $d.action }
        [void]$els.statusList.Children.Add((New-Card -Heading 'The record and the disk disagree' -Lines $dl -LineColor $C.Warn -Border $C.Warn))
    } elseif ($m.adopted) {
        [void]$els.statusList.Children.Add((New-Card -Heading 'Drift' -Lines @('Not checked. A reconstructed view has no recorded hashes to compare against.')))
    } else {
        [void]$els.statusList.Children.Add((New-Card -Heading 'Drift' -Lines @('None. Every recorded entry is exactly as the installer left it.') -LineColor $C.Ok))
    }

    if (@($m.backups).Count) {
        [void]$els.statusList.Children.Add((New-Card -Heading "Backups ($(@($m.backups).Count))" -Lines @(@($m.backups) | Select-Object -First 3)))
    }
}

# =============================================================================
# Page 1 -- write access, per server.
#
# The server list and the write-tool list come from lib\catalog.json, which the
# installer script also reads. Same file, two readers: the same known seam the
# installer window documents, and the reason a tool list is never typed out here.
# =============================================================================
function Build-WritePage {
    $els.writeList.Children.Clear()
    $script:WriteRows = @()
    $els.txtConfirm.Text = ''
    $els.lblWriteRestart.Text = ''
    if (-not $script:Status -or -not $script:Status.installed) {
        [void]$els.writeList.Children.Add((New-Card -Heading 'No installation was found' `
            -Lines @('Write access is set per server, on an installed suite. There is nothing to set it on.') -LineColor $C.Warn -Border $C.Warn))
        $els.btnApplyWrites.IsEnabled = $false
        $els.btnWritesOff.IsEnabled = $false
        return
    }
    $els.btnApplyWrites.IsEnabled = $true
    $els.btnWritesOff.IsEnabled = $true
    $els.lblWriteRestart.Text = 'A change here is written into each configured client''s configuration file. ' +
                                (@(Get-RestartNotice 'host') -join ' ')

    foreach ($s in @($script:Status.servers | Where-Object { $_.managed })) {
        $spec = $Catalog.servers | Where-Object { $_.name -eq $s.name }
        $card = New-Object System.Windows.Controls.Border
        $card.Background = (Br $C.Card); $card.BorderBrush = (Br $(if ($s.writes -eq 'none') { $C.Border } else { $C.Warn }))
        $card.BorderThickness = (Thk 1 1 1 1)
        $card.CornerRadius = (New-Object System.Windows.CornerRadius(9))
        $card.Padding = (Thk 14 11 14 12); $card.Margin = (Thk 0 0 0 8)
        $sp = New-Object System.Windows.Controls.StackPanel

        $head = New-Object System.Windows.Controls.StackPanel
        $head.Orientation = 'Horizontal'
        $chk = New-Object System.Windows.Controls.CheckBox
        $chk.Content = $s.name
        $chk.FontWeight = 'SemiBold'
        $chk.IsChecked = ($s.writes -ne 'none')
        $chk.VerticalAlignment = 'Center'
        [void]$head.Children.Add($chk)
        $state = New-Line $(switch ($s.writes) {
                                'all'     { "WRITES ON, ALL $($s.writeToolCount) TOOLS" }
                                'limited' { "WRITES ON, $(@($s.writeTools).Count) OF $($s.writeToolCount) TOOLS" }
                                default   { 'READ-ONLY' } }) `
                          $(if ($s.writes -eq 'none') { $C.Ok } else { $C.Warn }) 11 $true
        $state.Margin = (Thk 12 2 0 0)
        [void]$head.Children.Add($state)
        [void]$sp.Children.Add($head)
        if ($spec -and $spec.summary) {
            $d = New-Line ([string]$spec.summary) $C.Muted 12
            $d.Margin = (Thk 22 4 0 0)
            [void]$sp.Children.Add($d)
        }

        $toolPanel = New-Object System.Windows.Controls.StackPanel
        $toolPanel.Margin = (Thk 22 8 0 0)
        $toolChecks = @()
        $writeTools = @()
        if ($spec) { $writeTools = @($spec.writeTools) }
        # Not every server can be narrowed. Where lib\catalog.json says allowlist is
        # false the server reads ALLOW_WRITE_OPERATIONS and nothing else, so a list of
        # tick boxes would be a promise the server does not keep -- the installer says
        # so out loud and enables all of them. Offering the boxes anyway is exactly the
        # kind of quiet lie a settings window is prone to.
        $canNarrow = [bool]($spec -and $spec.allowlist)
        if (-not $writeTools.Count) {
            [void]$toolPanel.Children.Add((New-Line 'This server has no write tools. Write access changes nothing for it.' $C.Faint 12))
            $chk.IsEnabled = $false
        } elseif (-not $canNarrow) {
            $warn = New-Object System.Windows.Controls.Border
            $warn.Background = (Br $C.WarnBg); $warn.BorderBrush = (Br $C.Warn); $warn.BorderThickness = (Thk 1 1 1 1)
            $warn.CornerRadius = (New-Object System.Windows.CornerRadius(7)); $warn.Padding = (Thk 12 9 12 10)
            $ws = New-Object System.Windows.Controls.StackPanel
            [void]$ws.Children.Add((New-Line ("This server has no per-tool allowlist. Write access unlocks all $($writeTools.Count) of its write tools at once, including:") $C.Warn 12))
            $dels = @($writeTools | Where-Object { $_ -like 'delete_*' } | Select-Object -First 4)
            if ($dels.Count) { [void]$ws.Children.Add((New-Line ('  ' + ($dels -join ', ')) $C.Warn 12)) }
            [void]$ws.Children.Add((New-Line 'There is no way to permit some and not others.' $C.Warn 12))
            $warn.Child = $ws
            [void]$toolPanel.Children.Add($warn)
        } else {
            [void]$toolPanel.Children.Add((New-Line 'Tools permitted when write access is on. Clear them all to permit every write tool this server has.' $C.Faint 11.5))
            foreach ($t in $writeTools) {
                $tc = New-Object System.Windows.Controls.CheckBox
                $tc.Content = [string]$t
                $tc.FontSize = 12
                $tc.Margin = (Thk 0 5 0 0)
                $tc.IsChecked = ($s.writes -eq 'limited' -and @($s.writeTools) -contains [string]$t)
                [void]$toolPanel.Children.Add($tc)
                $toolChecks += [pscustomobject]@{ Tool = [string]$t; Check = $tc }
            }
        }
        [void]$sp.Children.Add($toolPanel)
        $card.Child = $sp
        [void]$els.writeList.Children.Add($card)

        $row = [pscustomobject]@{
            Name = [string]$s.name; Check = $chk; ToolChecks = $toolChecks; CanNarrow = $canNarrow
            Was = [string]$s.writes; WasTools = @($s.writeTools); ToolCount = [int]$s.writeToolCount
        }
        $script:WriteRows += $row
        $chk.Add_Checked({ Update-WritePage })
        $chk.Add_Unchecked({ Update-WritePage })
        foreach ($tc in $toolChecks) {
            $tc.Check.Add_Checked({ Update-WritePage })
            $tc.Check.Add_Unchecked({ Update-WritePage })
        }
    }
    Update-WritePage
}

function Get-WriteChanges {
<#
.SYNOPSIS
    The verb invocations the write page would run, as data. Nothing is dispatched.
.DESCRIPTION
    One per server whose state on the page differs from what the installation says
    now. A server nobody touched produces no invocation at all, which is what stops
    a visit to this page from re-writing every client configuration.
#>
    $out = @()
    foreach ($r in @($script:WriteRows)) {
        $want  = [bool]$r.Check.IsChecked
        # A server that cannot narrow has no tick boxes, and asks for all of them.
        $tools = @()
        if ($r.CanNarrow) {
            $tools = @($r.ToolChecks | Where-Object { $_.Check.IsChecked } | ForEach-Object { $_.Tool })
        }
        if (-not $want) {
            if ($r.Was -eq 'none') { continue }
            $out += (New-Change -Params @{ Verb = 'writes'; Object = 'disable'; Rest = @($r.Name) } `
                                -Scope 'host' `
                                -What "Write access removed from $($r.Name).")
            continue
        }
        # On, and either all tools or a named subset. An empty selection means every
        # write tool the server has -- said in those words on the page, because "none
        # ticked" reading as "all permitted" is not something to leave implied.
        $wasTools = @($r.WasTools)
        $same = ($r.Was -ne 'none') -and
                (($tools.Count -eq 0 -and $r.Was -eq 'all') -or
                 ($tools.Count -gt 0 -and $r.Was -eq 'limited' -and
                  (($tools | Sort-Object) -join ',') -eq (($wasTools | Sort-Object) -join ',')))
        if ($same) { continue }
        $rest = @($r.Name)
        if ($tools.Count) { $rest += $tools } else { $rest += '*' }
        $what = $(if ($tools.Count) {
                      "Write access granted to $($r.Name), limited to " + ($tools -join ', ') + '.'
                  } else {
                      "Write access granted to $($r.Name), all $($r.ToolCount) write tools."
                  })
        $out += (New-Change -Params @{ Verb = 'writes'; Object = 'enable'; Rest = $rest } -Scope 'host' -What $what)
    }
    return @($out)
}

function Test-GrantsWrites {
    return [bool](@(Get-WriteChanges | Where-Object { $_.Params['Object'] -eq 'enable' }).Count)
}

function Get-WritesOffChange {
    return (New-Change -Params @{ Verb = 'writes'; Object = 'disable-all' } -Scope 'host' `
                       -What 'Write access removed from every configured server.')
}

function Update-WritePage {
    $changes = @(Get-WriteChanges)
    $grants  = @($changes | Where-Object { $_.Params['Object'] -eq 'enable' })
    if ($grants.Count) {
        $els.confirmBar.Visibility = 'Visible'
        $els.lblConfirmWhat.Text = 'Write access permits these servers to create, modify and delete objects in the management suite: ' +
                                   (($grants | ForEach-Object { $_.Params['Rest'][0] }) -join ', ') +
                                   '. This acts on the production estate.'
    } else {
        $els.confirmBar.Visibility = 'Collapsed'
    }
    $els.lblWriteSummary.Text = $(if (-not $changes.Count) { 'No change on this page.' }
                                  else { "$($changes.Count) change(s) ready to apply." })
    $els.btnApplyWrites.IsEnabled = ($changes.Count -gt 0 -and (-not $grants.Count -or $els.txtConfirm.Text -ceq 'ENABLE WRITES'))
}

# =============================================================================
# Page 2 -- connection
# =============================================================================
function Build-ConnPage {
    $els.connReadOnly.Children.Clear()
    $cr = $null
    if ($script:Status) { $cr = $script:Status.credentials }
    if (-not $cr) {
        $els.lblConnNow.Text = 'No installation was found, so there is no credentials file to change.'
        foreach ($b in @($els.btnSetUrl, $els.btnSetCredential, $els.btnVerify)) { $b.IsEnabled = $false }
        return
    }
    foreach ($b in @($els.btnSetUrl, $els.btnSetCredential, $els.btnVerify)) { $b.IsEnabled = $true }
    if ($cr.readError) {
        $els.lblConnNow.Text = 'The credentials file cannot be read: ' + $cr.readError
        foreach ($b in @($els.btnSetUrl, $els.btnSetCredential)) { $b.IsEnabled = $false }
        return
    }
    # No credentials file at all -- the state a machine-stage deployment leaves. Both
    # verbs on this page edit an existing file: `set url` refuses when there is no
    # stored credential to re-point, and `set credential` takes the base URL out of
    # the file that is not there. The first credential and the base URL are therefore
    # one answer, and the user stage of the installer is what asks for it. Offering
    # the buttons here would put the operator one click from a run that stops on a
    # missing -BaseUrl, which reads as a broken product rather than as a missing step.
    if (-not (Test-CredentialStorePresent)) {
        $els.lblConnNow.Text = 'There is no credentials file for this Windows account. The base URL and the first ' +
                               'credential are written together, by the user stage of the installer, which is what ' +
                               'this page edits afterwards. Run, in this login:  .\Install-BConnectMcp.ps1 -Stage User'
        foreach ($b in @($els.btnSetUrl, $els.btnSetCredential, $els.btnVerify)) { $b.IsEnabled = $false }
        return
    }
    $els.lblConnNow.Text = "Stored in $($cr.activePath), as $(if ($cr.mode -eq 'protected') { 'a DPAPI blob readable only by this Windows account on this machine' } else { 'plaintext protected by the directory ACL' })."
    # Decompose the stored address rather than assume its form. It recomposes
    # EXACTLY or it goes to the full-address box with the override ticked -- the
    # alternative is a window that shows one address and writes another, which on
    # this page means re-pointing a working installation at a bMS nobody chose.
    if (-not $els.txtServerFqdn.Text -and -not $els.txtBaseUrl.Text) {
        $stored = ([string]$cr.baseUrl).Trim()
        if ($stored) {
            $els.txtBaseUrl.Text = $stored
            if ((Get-ComposedBaseUrl $stored) -eq $stored) {
                $els.txtServerFqdn.Text = ConvertTo-ServerHost $stored
            } else {
                $els.chkCustomUrl.IsChecked = $true
            }
        }
        Sync-CustomUrlPanel
    }
    if ($cr.authKind -eq 'basic') {
        $els.rbBasic.IsChecked = $true
        if (-not $els.txtBasicUser.Text) { $els.txtBasicUser.Text = [string]$cr.basicUser }
    }
    $els.lblCredRestart.Text = (@(Get-RestartNotice 'credentials') -join ' ')

    # Read-only, and each with the reason. The CA certificate path and the storage
    # form both have routes -- they are simply not this page's -- so the route is
    # named rather than the setting being called unavailable.
    [void]$els.connReadOnly.Children.Add((New-Line ('CA certificate: ' +
        $(if ($cr.caCertPath) { $cr.caCertPath } else { '(none -- the Windows certificate store is used)' })) $C.Txt 12.5))
    [void]$els.connReadOnly.Children.Add((New-Line 'It is written with the credential it belongs to. Run Install-BConnectMcp-UI.ps1 to change it: the Credentials page carries the field, and the installer verifies the certificate against the bMS before writing anything.' $C.Muted 12))
    $store = New-Line ('Storage: ' + $(if ($cr.mode -eq 'protected') { 'DPAPI-encrypted for this Windows account.' } else { 'plaintext, protected by the directory ACL.' })) $C.Txt 12.5
    $store.Margin = (Thk 0 10 0 0)
    [void]$els.connReadOnly.Children.Add($store)
    [void]$els.connReadOnly.Children.Add((New-Line 'Change it with .\bconnect.ps1 protect or .\bconnect.ps1 unprotect. It is not on this page because converting the store re-encodes the credential, and a window is not the place to be one click from that.' $C.Muted 12))
}

# The reader of THIS window's two address boxes. The composition itself is in
# lib\Address.ps1 and shared with the installer; which box wins is local, because
# it is a property of this page rather than of the address.
function Get-BaseUrl {
    if ($els.chkCustomUrl.IsChecked) { return $els.txtBaseUrl.Text.Trim() }
    return (Get-ComposedBaseUrl $els.txtServerFqdn.Text)
}

# Called from the load path as well as from the checkbox handler. The stored
# address is decomposed before the handlers are attached, so a window that relied
# on the Checked event alone would tick the box and leave the panel holding the
# real address collapsed.
function Sync-CustomUrlPanel {
    $els.pnlCustomUrl.Visibility = $(if ($els.chkCustomUrl.IsChecked) { 'Visible' } else { 'Collapsed' })
    Update-ComposedUrl
}

function Update-ComposedUrl {
    if ($els.chkCustomUrl.IsChecked) {
        $u = $els.txtBaseUrl.Text.Trim()
        $els.lblComposedUrl.Text = if ($u) { "The address below will be used, and this name is not." }
                                   else    { 'No address has been entered below yet.' }
        return
    }
    $u = Get-ComposedBaseUrl $els.txtServerFqdn.Text
    $els.lblComposedUrl.Text = if ($u) { "bConnect will be reached at  $u" }
                               else    { 'The bMS server: its fully qualified name, its hostname or its IP address. Prefer the name on its certificate, because an IP address is usually not on one.' }
}

function Get-UrlChange {
    $u = Get-BaseUrl
    if (-not $u) { return $null }
    $now = ''
    if ($script:Status -and $script:Status.credentials) { $now = [string]$script:Status.credentials.baseUrl }
    if ($u -eq $now) { return $null }
    return (New-Change -Params @{ Verb = 'set'; Object = 'url'; Rest = @($u) } -Scope 'credentials' `
                       -What "Base URL set to $u. No client configuration changes: a client configuration carries only the path to the credentials file.")
}

function Get-CredentialChange {
    # The SecureString goes into the parameter set as an object and is handed to
    # bconnect.ps1 in process. It is never rendered, logged or put on a command line.
    if ($els.rbBasic.IsChecked) {
        $u = $els.txtBasicUser.Text.Trim()
        if (-not $u -or $els.pwBasic.SecurePassword.Length -eq 0) { return $null }
        return (New-Change -Params @{ Verb = 'set'; Object = 'credential'; BasicUser = $u; BasicPassSecure = $els.pwBasic.SecurePassword } `
                           -Scope 'credentials' -What "Credential replaced with a Basic credential for $u.")
    }
    if ($els.pwApiKey.SecurePassword.Length -eq 0) { return $null }
    return (New-Change -Params @{ Verb = 'set'; Object = 'credential'; ApiKeySecure = $els.pwApiKey.SecurePassword } `
                       -Scope 'credentials' -What 'Credential replaced with a new API key.')
}

function Get-VerifyChange {
    return (New-Change -Params @{ Verb = 'verify' } -Scope 'none' `
                       -What 'Verification run. Every configured server was started the way the client starts it and made a real read call.')
}

# =============================================================================
# Page 3 -- bConnect v1.1
# =============================================================================
function Build-V11Page {
    $cr = $null
    if ($script:Status) { $cr = $script:Status.credentials }
    if (-not $cr -or $cr.readError -or -not (Test-CredentialStorePresent)) {
        $els.lblV11State.Text = 'No readable credentials file was found, so v1.1 cannot be configured from here.'
        $els.btnV11Set.IsEnabled = $false
        $els.btnV11Disable.IsEnabled = $false
        return
    }
    $els.btnV11Set.IsEnabled = $true
    $on = @($script:Status.servers | Where-Object { $_.v11 })
    if ($cr.v11Configured) {
        $els.btnV11Disable.IsEnabled = $true
        if (-not $els.txtV11User.Text) { $els.txtV11User.Text = [string]$cr.v11Username }
        $els.lblV11State.Text = "Configured as $($cr.v11Username). " +
            $(if ($on.Count) { 'The v1.1 gate is on in: ' + (($on | ForEach-Object { $_.name }) -join ', ') + '.' }
              else { 'No server has the v1.1 gate on, so no v1.1 tool is offered.' })
    } else {
        $els.btnV11Disable.IsEnabled = $false
        $els.lblV11State.Text = 'Not configured. The tools that use v1.1 report reduced detail rather than failing.'
    }
    $els.lblV11Restart.Text = 'Setting the credentials writes the credentials file and the v1.1 gate in every configured client. ' +
                              (@(Get-RestartNotice 'host') -join ' ')
}

function Get-V11Change {
    $u = $els.txtV11User.Text.Trim()
    if (-not $u -or $els.pwV11.SecurePassword.Length -eq 0) { return $null }
    return (New-Change -Params @{ Verb = 'set'; Object = 'v11-credential'; V11User = $u; V11PassSecure = $els.pwV11.SecurePassword } `
                       -Scope 'host' `
                       -What "bConnect v1.1 credentials set for $u, and the v1.1 gate turned on.")
}

function Get-V11RemoveChange {
    return (New-Change -Params @{ Verb = 'disable'; Object = 'v11'; Yes = $true } -Scope 'host' `
                       -What 'bConnect v1.1 credentials removed and the v1.1 gate turned off.')
}

# =============================================================================
# Page 4 -- audit and rate limiting
# =============================================================================
function Build-AuditPage {
    if (-not $script:AuditRows.Count) {
        foreach ($lvl in $AuditLevels) {
            $card = New-Object System.Windows.Controls.Border
            $card.Background = (Br $C.Card); $card.BorderBrush = (Br $C.Border); $card.BorderThickness = (Thk 1 1 1 1)
            $card.CornerRadius = (New-Object System.Windows.CornerRadius(9))
            $card.Padding = (Thk 16 12 16 13); $card.Margin = (Thk 0 0 0 7)
            $rb = New-Object System.Windows.Controls.RadioButton
            $rb.GroupName = 'audit'
            $sp = New-Object System.Windows.Controls.StackPanel
            [void]$sp.Children.Add((New-Line $lvl.Title $C.Txt 13.5 $true))
            [void]$sp.Children.Add((New-Line $lvl.Text $C.Muted 12.5))
            $rb.Content = $sp
            $card.Child = $rb
            [void]$els.auditOptions.Children.Add($card)
            $script:AuditRows += [pscustomobject]@{ Level = $lvl.Level; Radio = $rb }
        }
    }
    if (-not $script:NoRouteBuilt) {
        foreach ($s in $NoRouteSettings) {
            $sp = New-Object System.Windows.Controls.StackPanel
            $sp.Margin = (Thk 0 0 0 12)
            [void]$sp.Children.Add((New-Line $s.Key $C.Txt 12.5 $true))
            [void]$sp.Children.Add((New-Line $s.What $C.Muted 12))
            [void]$sp.Children.Add((New-Line ('Not changeable here: ' + $s.Why) $C.Warn 12))
            [void]$sp.Children.Add((New-Line $s.How $C.Muted 12))
            [void]$els.noRouteList.Children.Add($sp)
        }
        $script:NoRouteBuilt = $true
    }

    $cr = $null
    if ($script:Status) { $cr = $script:Status.credentials }
    if (-not $cr -or $cr.readError -or -not (Test-CredentialStorePresent)) {
        $els.lblAuditNow.Text = 'No readable credentials file was found, so neither setting can be changed from here.'
        $els.btnSetAudit.IsEnabled = $false
        $els.btnSetRate.IsEnabled = $false
        return
    }
    $els.btnSetAudit.IsEnabled = $true
    $els.btnSetRate.IsEnabled = $true
    $now = [string]$cr.auditLevel
    $els.lblAuditNow.Text = 'Now: ' + $(if ($now) { "audit level $now" } else { 'no audit level is set, so the servers audit writes' }) +
                            '; rate limiting ' +
                            $(if ($cr.rateLimitEnabled -eq 'true') { "on, $($cr.rateLimitMaxRequests) requests per $($cr.rateLimitWindowMs) ms" }
                              elseif ($cr.rateLimitEnabled) { 'off' } else { 'not set' }) + '.'
    foreach ($r in $script:AuditRows) { $r.Radio.IsChecked = ($r.Level -eq $(if ($now) { $now } else { 'write' })) }
    $els.chkRate.IsChecked = ($cr.rateLimitEnabled -eq 'true')
    if (-not $els.txtRateMax.Text)    { $els.txtRateMax.Text    = $(if ($cr.rateLimitMaxRequests) { $cr.rateLimitMaxRequests } else { '100' }) }
    if (-not $els.txtRateWindow.Text) { $els.txtRateWindow.Text = $(if ($cr.rateLimitWindowMs) { $cr.rateLimitWindowMs } else { '60000' }) }
    $els.lblAuditRestart.Text = (@(Get-RestartNotice 'credentials') -join ' ')
}

function Get-AuditChange {
    $sel = @($script:AuditRows | Where-Object { $_.Radio.IsChecked })
    if (-not $sel.Count) { return $null }
    $lvl = $sel[0].Level
    $now = ''
    if ($script:Status -and $script:Status.credentials) { $now = [string]$script:Status.credentials.auditLevel }
    if ($lvl -eq $now) { return $null }
    $what = "Audit level set to $lvl."
    if ($lvl -eq 'none') { $what += ' No tool call is recorded, so a write cannot be attributed afterwards.' }
    return (New-Change -Params @{ Verb = 'set'; Object = 'audit'; Rest = @($lvl) } -Scope 'credentials' -What $what)
}

function Get-RateChange {
    $on = [bool]$els.chkRate.IsChecked
    if (-not $on) {
        return (New-Change -Params @{ Verb = 'set'; Object = 'rate-limit'; Rest = @('off') } -Scope 'credentials' `
                           -What 'Rate limiting turned off. A server will make as many requests as it is asked to.')
    }
    $max = 0; $win = 0
    if (-not [int]::TryParse($els.txtRateMax.Text.Trim(), [ref]$max) -or $max -lt 1) { return $null }
    if (-not [int]::TryParse($els.txtRateWindow.Text.Trim(), [ref]$win) -or $win -lt 1000) { return $null }
    return (New-Change -Params @{ Verb = 'set'; Object = 'rate-limit'; Rest = @('on', [string]$max, [string]$win) } `
                       -Scope 'credentials' `
                       -What "Rate limiting set to $max requests per $win ms, per server process.")
}

function Update-RatePage {
    $on = [bool]$els.chkRate.IsChecked
    $els.txtRateMax.IsEnabled = $on
    $els.txtRateWindow.IsEnabled = $on
    $note = ''
    if ($on) {
        $max = 0; $win = 0
        if (-not [int]::TryParse($els.txtRateMax.Text.Trim(), [ref]$max) -or $max -lt 1) {
            $note = 'The request count must be a whole number of 1 or more.'
        } elseif (-not [int]::TryParse($els.txtRateWindow.Text.Trim(), [ref]$win) -or $win -lt 1000) {
            $note = 'The window must be a whole number of milliseconds, 1000 or more.'
        }
    }
    $els.lblRateNote.Text = $note
    $els.btnSetRate.IsEnabled = (-not $note -and (Test-CredentialStorePresent) -and -not $script:Status.credentials.readError)
}

# =============================================================================
# Page 5 -- MCP clients
# =============================================================================
function Get-ClientChange {
<#
.SYNOPSIS
    Configure one client, or write its configuration again.
.DESCRIPTION
    `hosts add` is the one route, and on a client that is already recorded it
    re-emits every recorded client rather than that one alone. The description says
    so: a summary naming one client for a run that touched four would be wrong in
    the way that reads as right.
#>
    param([string] $Id)
    $row = @($script:Clients | Where-Object { $_.Id -eq $Id })
    if (-not $row.Count) { return $null }
    $row = $row[0]
    $what = $(if ($row.Configured) { "$($row.Label) written again." } else { "$($row.Label) configured." }) +
            ' Every other configured client is written again with it.'
    return (New-Change -Params @{ Verb = 'hosts'; Object = 'add'; Rest = @($Id) } -Scope 'host' -What $what)
}

function Get-ResyncChange {
    return (New-Change -Params @{ Verb = 'hosts'; Object = 'resync' } -Scope 'host' `
                       -What 'Every configured client written again from the record. A managed entry edited by hand is replaced with this installer''s version, after a backup.')
}

function Build-ClientPage {
    $els.clientList.Children.Clear()
    foreach ($r in @($script:Clients)) {
        $card = New-Object System.Windows.Controls.Border
        $card.Background = (Br $C.Card); $card.BorderBrush = (Br $C.Border); $card.BorderThickness = (Thk 1 1 1 1)
        $card.CornerRadius = (New-Object System.Windows.CornerRadius(9))
        $card.Padding = (Thk 14 11 14 12); $card.Margin = (Thk 0 0 0 8)
        $grid = New-Object System.Windows.Controls.Grid
        foreach ($unit in @([System.Windows.GridUnitType]::Star,
                            [System.Windows.GridUnitType]::Auto,
                            [System.Windows.GridUnitType]::Auto)) {
            $cd = New-Object System.Windows.Controls.ColumnDefinition
            $cd.Width = (New-Object System.Windows.GridLength(1, $unit))
            [void]$grid.ColumnDefinitions.Add($cd)
        }
        $sp = New-Object System.Windows.Controls.StackPanel
        [void]$sp.Children.Add((New-Line $r.Label $C.Txt 13.5 $true))
        $state = $(if ($r.Configured) { "Configured: $($r.ConfiguredState) in $($r.ConfiguredPath)" }
                   else { "Not configured. Its file would be $($r.Path)" })
        [void]$sp.Children.Add((New-Line $state $(if ($r.Configured) { $C.Muted } else { $C.Faint }) 12))
        [void]$sp.Children.Add((New-Line $r.SetupText $C.Muted 11.5))
        # Which clients the DEPLOYMENT asked for, on the rows it asked for. After a
        # machine-stage rollout this is the whole of the handoff: without it an
        # administrator picks from twelve clients with nothing to say which ones this
        # estate decided on.
        if ($r.Intended -and -not $r.Configured) {
            [void]$sp.Children.Add((New-Line 'Recorded by the deployment as a client this installation is for.' $C.Accent 11.5))
        }
        if (-not $r.HereNow) {
            [void]$sp.Children.Add((New-Line $r.PresenceText $C.Warn 11.5))
        }
        [void]$grid.Children.Add($sp)
        [System.Windows.Controls.Grid]::SetColumn($sp, 0)

        $badge = New-Badge $r.SetupBadge $r.SetupBrush
        $badge.Margin = (Thk 10 0 6 0)
        [void]$grid.Children.Add($badge)
        [System.Windows.Controls.Grid]::SetColumn($badge, 1)

        $btn = New-Object System.Windows.Controls.Button
        $btn.Style = $win.Resources['Flat']
        $btn.VerticalAlignment = 'Top'
        $btn.Content = $(if ($r.Configured) { 'Write it again' } else { 'Configure it' })
        $btn.Tag = $r.Id
        [void]$grid.Children.Add($btn)
        [System.Windows.Controls.Grid]::SetColumn($btn, 2)
        $btn.Add_Click({
            param($src, $ev)
            $ch = Get-ClientChange ([string]$src.Tag)
            if ($ch) { Start-Queue @($ch) }
        })

        $card.Child = $grid
        [void]$els.clientList.Children.Add($card)
    }
}

# =============================================================================
# The finish banner
#
# It navigates and it explains. It does not change anything: the credential, the
# clients and the write gate are set with each page's own controls, through each
# page's own Get-*Change. That is what makes this a sequence over the pages that
# already exist rather than a second implementation of them.
# =============================================================================
function Get-EntryPage {
<#
.SYNOPSIS
    The page this window opens on, for the state it found.
#>
    if ($script:Entry -eq $ES_FINISH) { return [int]$FinishSteps[$script:FinishAt].Page }
    return $PG_STATUS
}

function Test-FinishPage {
    param([int] $Page)
    return [bool](($script:Entry -eq $ES_FINISH) -and (@($FinishSteps | ForEach-Object { [int]$_.Page }) -contains $Page))
}

function Build-FinishBar {
    $els.finishSteps.Children.Clear()
    if (-not (Test-FinishPage $script:Page)) {
        $els.finishBar.Visibility = 'Collapsed'
        return
    }
    $els.finishBar.Visibility = 'Visible'

    # Which step the operator is on is the page they are on, not a counter this
    # window keeps. Navigating with the rail therefore moves the banner too, and the
    # two cannot disagree.
    for ($i = 0; $i -lt $FinishSteps.Count; $i++) {
        if ([int]$FinishSteps[$i].Page -eq $script:Page) { $script:FinishAt = $i }
    }
    $step = $FinishSteps[$script:FinishAt]

    $els.lblFinishWhy.Text = (@(Get-FinishReasons) -join ' ')
    $els.lblFinishIntended.Text = ''
    if ($script:Intended.Count) {
        $names = @()
        foreach ($id in $script:Intended) {
            $row = @($script:Clients | Where-Object { $_.Id -eq $id })
            $names += $(if ($row.Count) { [string]$row[0].Label } else { [string]$id })
        }
        $els.lblFinishIntended.Text = 'The deployment recorded these clients as the ones this installation is for: ' +
                                      ($names -join ', ') + '.'
    }

    for ($i = 0; $i -lt $FinishSteps.Count; $i++) {
        $s = $FinishSteps[$i]
        $bd = New-Object System.Windows.Controls.Border
        $bd.CornerRadius = (New-Object System.Windows.CornerRadius(7))
        $bd.Padding = (Thk 11 6 12 7); $bd.Margin = (Thk 0 0 8 0)
        $bd.BorderThickness = (Thk 1 1 1 1)
        $current = ($i -eq $script:FinishAt)
        $bd.Background  = (Br $(if ($current) { $C.Card2 } else { $C.Card }))
        $bd.BorderBrush = (Br $(if ($current) { $C.Accent } else { $C.Border }))
        $bd.Cursor = 'Hand'
        $bd.Tag = [int]$s.Page
        $sp = New-Object System.Windows.Controls.StackPanel
        [void]$sp.Children.Add((New-Line ('' + ($i + 1) + '.  ' + $s.Title) $(if ($current) { $C.Txt } else { $C.Muted }) 12.5 $current))
        [void]$sp.Children.Add((New-Line $s.Blurb $C.Faint 11))
        $bd.Child = $sp
        $bd.Add_MouseLeftButtonUp({
            param($src, $ev)
            if ($script:Running) { return }
            $script:Page = [int]$src.Tag
            Show-Page
        })
        [void]$els.finishSteps.Children.Add($bd)
    }

    $last = ($script:FinishAt -ge ($FinishSteps.Count - 1))
    $els.btnFinishNext.Content = $(if ($last) { 'Check what is left' } else { 'Next step' })
    $note = $(if ($last) {
            'Check what is left reads the installation again. Anything still missing keeps this banner.'
        } else {
            $step.Does + ' with the controls below, then move on. Each control runs bconnect.ps1 and reports what it did.'
        })
    # The one step this window cannot complete, said on the step it applies to rather
    # than left to be discovered by pressing a button that then stops. See the
    # matching branch in Build-ConnPage for why the first credential is different from
    # every later one.
    if ([int]$step.Page -eq $PG_CONN -and -not (Test-CredentialStorePresent)) {
        $note = 'The first credential and the base URL are one answer and are written together, which this page cannot do. ' +
                'Run, in this login:  .\Install-BConnectMcp.ps1 -Stage User    Then reopen this window, or press Refresh.'
    }
    $els.lblFinishNote.Text = $note
}

# =============================================================================
# Navigation
# =============================================================================
function Build-Rail {
    $els.rail.Children.Clear()
    for ($i = 0; $i -lt $script:PageCount; $i++) {
        $bd = New-Object System.Windows.Controls.Border
        $bd.CornerRadius = (New-Object System.Windows.CornerRadius(8))
        $bd.Padding = (Thk 12 9 12 9); $bd.Margin = (Thk 0 0 0 4)
        $bd.Background = (Br $(if ($i -eq $script:Page) { $C.Card2 } else { 'Transparent' }))
        $bd.Cursor = 'Hand'
        $bd.Tag = $i
        if ($i -eq $script:Page) { $bd.BorderBrush = (Br $C.Accent); $bd.BorderThickness = (Thk 3 0 0 0) }
        $sp = New-Object System.Windows.Controls.StackPanel
        [void]$sp.Children.Add((New-Line $PageTitles[$i] $(if ($i -eq $script:Page) { $C.Txt } else { $C.Muted }) 13.5 ($i -eq $script:Page)))
        [void]$sp.Children.Add((New-Line $PageBlurbs[$i] $C.Faint 11))
        $bd.Child = $sp
        # A settings window's rail is navigation, not a sequence of steps: any page
        # can be reached from any other, except while a change is running.
        $bd.Add_MouseLeftButtonUp({
            param($src, $ev)
            if ($script:Running) { return }
            $script:Page = [int]$src.Tag
            Show-Page
        })
        [void]$els.rail.Children.Add($bd)
    }
}

function Update-Pages {
    Build-StatusPage
    Build-WritePage
    Build-ConnPage
    Build-V11Page
    Build-AuditPage
    Build-ClientPage
}

function Show-Page {
    for ($i = 0; $i -lt $script:PageCount; $i++) {
        $els["page$i"].Visibility = $(if ($i -eq $script:Page) { 'Visible' } else { 'Collapsed' })
    }
    Build-Rail
    switch ($script:Page) {
        $PG_STATUS  { Build-StatusPage }
        $PG_WRITES  { Build-WritePage }
        $PG_CONN    { Build-ConnPage }
        $PG_V11     { Build-V11Page }
        $PG_AUDIT   { Build-AuditPage; Update-RatePage }
        $PG_CLIENTS { Build-ClientPage }
    }
    Build-FinishBar
    Update-Nav
}

function Update-Nav {
    $els.btnRefresh.IsEnabled = -not $script:Running
    $els.btnClose.IsEnabled   = -not $script:Running
    $els.lblFooter.Text = switch ($script:Page) {
        $PG_STATUS  { 'This page is .\bconnect.ps1 status, rendered. Refresh reads it again.' }
        $PG_WRITES  { $(if ((Test-GrantsWrites) -and $els.txtConfirm.Text -cne 'ENABLE WRITES') { 'Type ENABLE WRITES to confirm.' }
                        else { 'Read-only until you say otherwise, per server.' }) }
        $PG_CONN    { 'Every change on this page is one .\bconnect.ps1 command, shown in the output when it runs.' }
        $PG_V11     { 'The gate and the credentials are set together, and removed together.' }
        $PG_AUDIT   { 'Both settings are written to the credentials file. Neither reaches a client configuration.' }
        $PG_CLIENTS { 'The order is how commonly baramundi customers run these clients.' }
        $PG_RUN     { $(if ($script:Running) { 'Working. This window stays responsive; the verb runs on its own runspace.' } else { '' }) }
    }
    # The entry state has the last word on the footer, because on a machine where
    # nothing is installed, or where this account is half-way through, the per-page
    # sentence describes a thing that is not there yet.
    if ($script:Entry -eq $ES_NONE) {
        $els.lblFooter.Text = 'Nothing is installed here. Install-BConnectMcp-UI.ps1 installs; this window changes an installation.'
    } elseif (Test-FinishPage $script:Page) {
        $els.lblFooter.Text = 'Step ' + ($script:FinishAt + 1) + ' of ' + $FinishSteps.Count +
                              ' of the finish. Every step is one .\bconnect.ps1 command, shown in the output when it runs.'
    }
}

# =============================================================================
# Wiring
#
# Handlers only. Every change is built by a Get-*Change function above and handed
# to Start-Queue -- nothing below constructs one, so what a control will run can be
# read, and asserted, without pressing it. lib\Test-ManageGui.ps1 checks that this
# section contains no change construction at all.
# =============================================================================
$els.btnRefresh.Add_Click({ Update-Status; Update-Pages; Show-Page })
$els.btnClose.Add_Click({ $win.Close() })

$els.txtConfirm.Add_TextChanged({ Update-WritePage; Update-Nav })
$els.btnApplyWrites.Add_Click({
    $changes = @(Get-WriteChanges)
    if (-not $changes.Count) { return }
    if ((Test-GrantsWrites) -and $els.txtConfirm.Text -cne 'ENABLE WRITES') { return }
    Start-Queue $changes
})
$els.btnWritesOff.Add_Click({ Start-Queue @(Get-WritesOffChange) })

$els.rbApiKey.Add_Checked({ $els.pnlApiKey.Visibility = 'Visible'; $els.pnlBasic.Visibility = 'Collapsed' })
$els.rbBasic.Add_Checked({ $els.pnlApiKey.Visibility = 'Collapsed'; $els.pnlBasic.Visibility = 'Visible' })

# The composed line redraws on either box, so what it states is never a keystroke
# behind what "Change base URL" would write.
foreach ($tb in @($els.txtServerFqdn, $els.txtBaseUrl)) { $tb.Add_TextChanged({ Update-ComposedUrl }) }
$els.chkCustomUrl.Add_Checked({ Sync-CustomUrlPanel })
$els.chkCustomUrl.Add_Unchecked({ Sync-CustomUrlPanel })
Sync-CustomUrlPanel

$els.btnSetUrl.Add_Click({
    $ch = Get-UrlChange
    if ($ch) { Start-Queue @($ch) }
})
$els.btnSetCredential.Add_Click({
    $ch = Get-CredentialChange
    if ($ch) { Start-Queue @($ch) }
})
$els.btnVerify.Add_Click({ Start-Queue @(Get-VerifyChange) })

$els.btnV11Set.Add_Click({
    $ch = Get-V11Change
    if ($ch) { Start-Queue @($ch) }
})
$els.btnV11Disable.Add_Click({
    $r = [System.Windows.MessageBox]::Show(
        "This removes the stored v1.1 credentials and turns the v1.1 gate off in every configured server.`n`nThe gate and the credentials are one decision: a gate with no credentials advertises tools that fail on every call.`n`nContinue?",
        'bConnect-MCP settings', 'YesNo', 'Warning')
    if ($r -ne 'Yes') { return }
    Start-Queue @(Get-V11RemoveChange)
})

$els.btnSetAudit.Add_Click({
    $ch = Get-AuditChange
    if ($ch) { Start-Queue @($ch) }
})
$els.chkRate.Add_Checked({ Update-RatePage })
$els.chkRate.Add_Unchecked({ Update-RatePage })
$els.txtRateMax.Add_TextChanged({ Update-RatePage })
$els.txtRateWindow.Add_TextChanged({ Update-RatePage })
$els.btnSetRate.Add_Click({
    $ch = Get-RateChange
    if ($ch) { Start-Queue @($ch) }
})

$els.btnResync.Add_Click({ Start-Queue @(Get-ResyncChange) })

# The finish banner navigates. On the last step it re-reads the installation, which
# is the only honest way to answer "is it finished": if the state is no longer the
# finish state, the window becomes the Status-first window it is for a configured
# installation, and if something is still missing the banner stays and says so.
$els.btnFinishNext.Add_Click({
    if ($script:FinishAt -lt ($FinishSteps.Count - 1)) {
        $script:FinishAt++
        $script:Page = [int]$FinishSteps[$script:FinishAt].Page
        Show-Page
        return
    }
    Update-Status
    Update-Pages
    $script:Page = Get-EntryPage
    Show-Page
})
$els.btnFinishStatus.Add_Click({ $script:Page = $PG_STATUS; Show-Page })

$win.Add_Closing({
    if ($script:Running) {
        $r = [System.Windows.MessageBox]::Show(
            "A change is still running. Closing now leaves it half-done.`n`nClose anyway?",
            'bConnect-MCP settings', 'YesNo', 'Warning')
        if ($r -ne 'Yes') { $_.Cancel = $true; return }
        try { $script:Ps.Stop() } catch { }
    }
})

Update-Status
Update-Pages
# The entry page, from what Update-Status found on disk. Status for a configured
# installation and for a machine with nothing on it; the first step of the finish for
# an installation this Windows account has not finished.
$script:Page = Get-EntryPage
Show-Page

if ($TestHeadless) {
    # Built and wired, deliberately not shown -- see the -TestHeadless comment in the
    # param block. lib\Test-ManageGui.ps1 dot-sources this file with the switch set
    # and then drives $els, the page builders and the change builders directly.
    return
}
[void]$win.ShowDialog()
