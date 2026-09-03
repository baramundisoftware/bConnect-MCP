<#
.SYNOPSIS
    A guided window for the bConnect-MCP installer.

.DESCRIPTION
    This is a FRONT END, not a second installer. Every question it asks becomes a
    parameter to Install-BConnectMcp.ps1, which does all of the work exactly as it
    does from a console. Nothing about prerequisites, credentials, hardening, the
    build, the configuration merge or verification is implemented here.

    That is the whole design constraint, and it is worth being blunt about why: two
    implementations of an install drift, and the one you are not looking at is the one
    that is wrong. So:

      * The wizard collects answers and renders output. It never decides anything the
        script decides.
      * The script gained a -NonInteractive mode and a set of answer parameters, all
        additive. Run it from a console with no new switches and it behaves exactly as
        it did before this file existed.
      * The step list on the run page is driven by progress records the script emits
        on its Information stream, not by the wizard's own idea of what happens when.
        If the script grows a step, the wizard shows it without being changed.
      * The console pane is the script's real output, verbatim, colours and all.

    Where the two CAN still drift is listed at the bottom of this comment.

    HOW IT STAYS RESPONSIVE
    -----------------------
    Same pattern as bPerfMon.ps1: the work goes to a [powershell] instance on a
    private runspace, started with BeginInvoke, and a System.Windows.Threading
    DispatcherTimer polls it on the UI thread. Everything the tick handler needs is
    attached to the timer as NoteProperties and read back through $this -- a plain
    scriptblock passed to Add_Tick does not close over the enclosing function's locals,
    because it runs after that function has returned. (bPerfMon documents this at
    length around Start-Rs2Async; it is the same trap.)

    The installer's own output is collected the same way. Write-Host in PowerShell 5.1
    writes an InformationRecord tagged PSHOST, so $ps.Streams.Information carries every
    line the script printed, in order, with its colour -- and the tick handler drains
    it incrementally. No output is redirected, reformatted or reimplemented.

    WHERE WIZARD AND SCRIPT COULD STILL DRIFT
    -----------------------------------------
      1. The wizard reads lib\catalog.json directly to build the server list and the
         write-tool checkboxes. So does the script. Same file, but two readers.
      2. The wizard shows token costs from lib\measure-tools.mjs, which is the same
         program the script runs in Step 7 -- but run twice, so the numbers could
         differ if the build changed in between.
      3. The typed ENABLE WRITES confirmation lives HERE for a wizard run. The script's
         -WriteGate parameter accepts data without a typed confirmation, because a
         hashtable cannot type. A future caller of -WriteGate that is not this wizard
         gets no such prompt.
      4. Only base-URL emptiness is checked here. The real URL rules (module segment,
         trailing /bconnect) live in the script and fire when it runs -- which is why
         the Test button on the first page and Check on the last one exist: both are
         a real -DryRun of the real script, differing only in where the verdict is
         drawn.
      5. Test-InstallLocation answers free space, write permission and MAX_PATH
         headroom for a location the operator typed, BEFORE the engine is called. The
         engine still performs its own checks; this only means the answer arrives
         against the path that was typed rather than several minutes into a run. Its
         numbers are the same measured ones packaging\START-HERE.cmd uses, stated
         once at the top of this file.

    FOUR STEPS AND A RUN PAGE
    -------------------------
      1. Connect      where the servers run, the bMS address, the credential. Advanced
                      holds v1.1, the CA certificate and credential storage.
      2. Clients      which MCP clients to configure.
      3. Permissions  read only, or allow changes. Advanced holds which servers.
      4. Review       the summary, the install location, the dry run, and Install.

    The run page is the fifth grid and has no rail entry: it is what pressing Install
    produces, not somewhere an operator navigates to. What used to be a "Before you
    start" page is install\README.md; what used to be a "This computer" page is a
    banner on step 1 that appears only when something is wrong with this computer.

    THE DEPLOYMENT SHAPE IS NOT A DRIFT POINT, and it is worth saying why, because it
    looks like one. The first control on the first page asks whether the assistant
    runs on this computer or the servers are to be shared over the network. That
    answer is NOT a
    parameter to the engine and never becomes one: it decides which clients are
    offered, which the engine already takes as -Hosts, and whether the gateway is
    part of the install, which the engine already takes as -Gateway. So the equivalent
    console command on the review page reproduces the run exactly, with no shape
    switch in it -- there is nothing for a second implementation to disagree about.

    The reason the question exists at all is that a console operator typing -Gateway
    or not typing it has the assumption in front of them; a person clicking through a
    window does not. stdio MCP servers are local processes started by the client
    application, and an install placed on the wrong machine reports success and
    produces no tools.

.PARAMETER SuiteRoot, SecretsDir, ConfigPath
    Same meaning as in Install-BConnectMcp.ps1. SuiteRoot is the install location the
    Review page shows and SecretsDir the directory beside it; both are editable behind
    Change. ConfigPath pre-fills the Claude Desktop path box on the Clients page --
    that target's file and no other -- and is passed to the installer only if that
    target is one of the ones chosen.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Install-BConnectMcp-UI.ps1

.NOTES
    Requires -Sta (WPF will not run on an MTA thread) and Windows PowerShell 5.1.
    Both are asserted at the top of the file rather than left to fail inside WPF.
#>
[CmdletBinding()]
param(
    [string] $SuiteRoot,
    [string] $SecretsDir,
    [string] $ConfigPath,
    # Branding assets. Default to install\assets\{logo.png,app.ico}; overridable so the
    # graceful-degradation path (asset missing -> text wordmark, default window icon,
    # no crash) can be exercised from a test harness without touching the real files.
    # See "Branding assets" in INSTALL.md for the expected dimensions and .ico sizes.
    [string] $LogoPath,
    [string] $IconPath,
    # Passed straight to the engine. The offline bundle ships every package already
    # built, so packaging\START-HERE.cmd hands this to whichever front end it starts
    # -- and the console front end had it while this one did not, so a bundle that
    # chose the wizard died on "A parameter cannot be found that matches parameter
    # name 'SkipBuild'" before a single question was asked. Nothing detected it
    # because the launcher's guard drove STUB front ends with no param block, and a
    # .ps1 with no param block absorbs any named argument into $args without
    # complaint. The stubs now carry the real front ends' parameter blocks.
    #
    # Skipping is not blind: the engine reads offline-bundle.json, and Step 9 names
    # any server missing build\index.js and says to re-run without this switch.
    [switch] $SkipBuild,
    # Internal: build and wire the window but do not call ShowDialog. Lets
    # lib\Test-WizardTheme.ps1 dot-source this file, load the real XAML and palette,
    # and assert on control properties, colours and contrast without a visible,
    # blocking window. Not part of the documented interface -- a normal launch never
    # sets this, so ordinary behaviour and page flow are unchanged.
    [switch] $TestHeadless
)

$ErrorActionPreference = 'Stop'

# -----------------------------------------------------------------------------
# Host pre-flight. Two things this window cannot run without, both of which fail
# late and unreadably if they are only discovered by use: WPF throws an apartment
# exception from inside XamlReader on an MTA thread, and PowerShell 7 has neither
# the .NET Framework presentation assemblies this window is built from nor the
# DPAPI ProtectedData type the credential-protection option needs -- the second of
# which would surface several pages in, after credentials had been typed. So both
# are asserted here, by name, with the command line that fixes them.
#
# The message goes to the console AND to a message box: a run started from a
# console needs the text where the operator is looking, and a double-click has no
# console to put it in.
# -----------------------------------------------------------------------------
$UiRelaunch = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -File "{0}"' -f $PSCommandPath
$uiProblems = @()
if ($PSVersionTable.PSEdition -eq 'Core') {
    $uiProblems += ("This is PowerShell $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition)). " +
                    'The wizard needs Windows PowerShell 5.1: PowerShell 7 does not carry the .NET Framework ' +
                    'presentation assemblies this window is built from, and its .NET has no DPAPI ProtectedData ' +
                    'for the credential-protection option.')
} elseif ($PSVersionTable.PSVersion -lt [Version]'5.1') {
    $uiProblems += ("This is Windows PowerShell $($PSVersionTable.PSVersion). The wizard needs 5.1 or newer.")
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
    Write-Host '  The installer window cannot start here.' -ForegroundColor Red
    foreach ($p in $uiProblems) { Write-Host ('  - ' + $p) -ForegroundColor Yellow }
    Write-Host ''
    Write-Host '  Run this instead:' -ForegroundColor White
    Write-Host ('    ' + $UiRelaunch) -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Or install from the console instead: .\Install-BConnectMcp.ps1' -ForegroundColor DarkGray
    Write-Host ''
    # -TestHeadless means "no window", and that has to hold here too: a modal box on
    # a machine with nobody in front of it waits for a click that never comes.
    if (-not $TestHeadless) {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            [void][System.Windows.Forms.MessageBox]::Show($uiText, 'bConnect-MCP installer', 'OK', 'Error')
        } catch { }   # no window subsystem available is not a reason to lose the console text
    }
    exit 2
}

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

# -----------------------------------------------------------------------------
# Paths -- the same defaults the script computes, so the pre-filled values match
# what a bare console run would use.
# -----------------------------------------------------------------------------
$InstallerDir  = $PSScriptRoot
$ProjectRoot   = Split-Path -Parent $InstallerDir
$LibDir        = Join-Path $InstallerDir 'lib'
$AssetsDir     = Join-Path $InstallerDir 'assets'
$InstallerPath = Join-Path $InstallerDir 'Install-BConnectMcp.ps1'
$HostPagePath  = Join-Path $LibDir 'HostSelectionPage.ps1'
$HostOutDir    = Join-Path $InstallerDir 'out'
if (-not $SuiteRoot)  { $SuiteRoot  = Join-Path $ProjectRoot 'bConnect-MCP-main' }
if (-not $SecretsDir) { $SecretsDir = Join-Path $ProjectRoot 'secrets' }
# The default VALUE of one target's path box, not a default TARGET. Nothing is
# written for Claude Desktop -- or for any other client -- unless it is ticked on
# the host page, and -ConfigPath reaches the installer only in that case. The
# parameter keeps pre-filling the box so the documented "rehearse against a copy"
# route still works.
$ClaudeDesktopDefault = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
if (-not $ConfigPath) { $ConfigPath = $ClaudeDesktopDefault }
if (-not $LogoPath)   { $LogoPath   = Join-Path $AssetsDir 'logo.png' }
if (-not $IconPath)   { $IconPath   = Join-Path $AssetsDir 'app.ico' }

if (-not (Test-Path -LiteralPath $InstallerPath)) {
    [void][System.Windows.MessageBox]::Show(
        "Install-BConnectMcp.ps1 was not found next to this file.`n`nExpected: $InstallerPath",
        'bConnect-MCP installer', 'OK', 'Error')
    exit 1
}
if (-not (Test-Path -LiteralPath $HostPagePath)) {
    [void][System.Windows.MessageBox]::Show(
        "lib\HostSelectionPage.ps1 was not found.`n`nExpected: $HostPagePath",
        'bConnect-MCP installer', 'OK', 'Error')
    exit 1
}
Import-Module (Join-Path $LibDir 'Dpapi.psm1') -Force -DisableNameChecking
# The Node runtime plan the prerequisites page reports. One implementation, in
# lib\NodeProvisioning.psm1; this window reads it in -PlanOnly and installs nothing.
Import-Module (Join-Path $LibDir 'NodeProvisioning.psm1') -Force -DisableNameChecking
# For Test-ProjectDirIsInstallation. The engine refuses a per-project config written
# into the installation directory; this window has to refuse the same value, on the
# page where it was typed, and it has to be the same rule. See lib\State.psm1.
Import-Module (Join-Path $LibDir 'State.psm1') -Force -DisableNameChecking
# The host page's data, XAML and parameter mapping. Dot-sourced rather than
# reimplemented so the window and a console -Hosts run cannot disagree about what a
# host selection means; lib\hosts.json remains the only list of targets anywhere.
. $HostPagePath

$CatalogPath = Join-Path $LibDir 'catalog.json'
$Catalog     = Get-Content -LiteralPath $CatalogPath -Raw | ConvertFrom-Json
$NodeCmd     = Get-Command node -ErrorAction SilentlyContinue

# -----------------------------------------------------------------------------
# Palette. The values themselves live in lib\Theme.ps1 and are dot-sourced, not
# restated: the settings window (Manage-BConnectMcp.ps1) paints from the same file,
# and two applications from one vendor that keep their own copies of a palette stop
# looking like one product on the first edit. $C, $Con, Br() and Thk() land in this
# script's scope exactly as they did when they were declared here, which is also
# what lib\Test-WizardTheme.ps1 reads them out of.
# -----------------------------------------------------------------------------
. (Join-Path $LibDir 'Theme.ps1')

# What a bConnect address is. Shared with Manage-BConnectMcp.ps1 so that the form
# this window WRITES is the form that window READS. See lib\Address.ps1.
. (Join-Path $LibDir 'Address.ps1')

# =============================================================================
# XAML
# =============================================================================
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Width="1180" Height="820" WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        WindowStartupLocation="CenterScreen" FontFamily="Segoe UI" Title="bConnect-MCP installer"
        UseLayoutRounding="True" SnapsToDevicePixels="True"
        TextOptions.TextFormattingMode="Display" TextOptions.TextRenderingMode="ClearType">
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
            <TextBlock Text="bConnect-MCP  -  guided installer" Foreground="White" FontSize="15" FontWeight="SemiBold" VerticalAlignment="Center"/>
            <!-- ARGB background (not Border.Opacity), so only the chip tints translucent:
                 the text inside stays fully opaque. Opacity on the Border would have taken
                 the label down to 18% alpha too, which is how badge text quietly goes
                 unreadable. -->
            <Border Background="#33FFFFFF" CornerRadius="4" Padding="6,1,6,2" Margin="12,0,0,0" VerticalAlignment="Center">
              <TextBlock x:Name="modeBadge" Text="wraps Install-BConnectMcp.ps1" Foreground="White" FontSize="10" FontWeight="SemiBold"/>
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
            <!-- Branding slot. logoImage shows install\assets\logo.png when present (a wide
                 538x125 wordmark, scaled to a fixed height with width following, never
                 stretched or forced square). Absent, logoFallback (the same typography used
                 for page headings) fills the same slot so there is no broken-image box, no
                 crash, and no empty gap. -->
            <Grid x:Name="logoHost" Margin="0,0,0,22" HorizontalAlignment="Left">
              <Image x:Name="logoImage" Height="30" Stretch="Uniform" HorizontalAlignment="Left" VerticalAlignment="Center" Visibility="Collapsed"/>
              <TextBlock x:Name="logoFallback" Text="bConnect-MCP" Foreground="#014380" FontSize="18" FontWeight="Bold" VerticalAlignment="Center"/>
            </Grid>
            <StackPanel x:Name="rail"/>
          </StackPanel>
        </Border>

        <Grid Grid.Column="1" Margin="30,22,30,10">
          <!-- ============ page 0: connect ============
               Four pages, and this is the one that carries the connection. Everything
               on it is either a decision the run cannot be made without or is behind
               the Advanced disclosure at the bottom.

               THE DEPLOYMENT SHAPE IS THE FIRST CONTROL, and it is a question rather
               than a preference. An MCP server that speaks stdio is a LOCAL PROCESS
               started by the client application, on the machine that application runs
               on. An administrator who installs on their bMS server for an assistant
               that runs on their workstation gets an install that reports success and
               produces no tools. Neither answer is pre-selected: a default here is a
               silent answer to the one question that decides whether the install works
               at all, so Next stays disabled until one is chosen.

               THE REQUIREMENT CHECKS RUN SILENTLY ON ENTRY and only failures are
               drawn, in reqBanner. A screen of green ticks is a screen nobody reads;
               the remedy for the one thing that is wrong is what an operator needs. -->
          <Grid x:Name="page0">
            <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
            <StackPanel Grid.Row="0">
              <TextBlock Text="Connect to the management suite" Style="{StaticResource H1}"/>
              <TextBlock Style="{StaticResource Sub}" Text="bConnect-MCP gives an AI assistant read access, and optionally write access, to your baramundi Management Suite. MCP -- Model Context Protocol -- is the standard those assistants use to call external tools."/>
              <TextBlock x:Name="lnkNeeded" Text="What you will need" Foreground="#014380" FontSize="12.5" FontWeight="SemiBold" Cursor="Hand" Margin="0,7,0,0"/>
            </StackPanel>
            <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto" Margin="0,12,0,0">
              <StackPanel Margin="0,0,14,0">

                <!-- Failures only. Collapsed entirely when this computer is ready. -->
                <Border x:Name="reqBanner" Visibility="Collapsed" Background="#FBF1E0" BorderBrush="#9A5B00"
                        BorderThickness="1" CornerRadius="9" Padding="14,11" Margin="0,0,0,16">
                  <StackPanel>
                    <Grid>
                      <TextBlock x:Name="lblReqBanner" Foreground="#9A5B00" FontSize="12.5" FontWeight="SemiBold" TextWrapping="Wrap" Text=""/>
                      <TextBlock x:Name="lnkRecheck" Text="Check again" Foreground="#9A5B00" FontSize="12" FontWeight="SemiBold"
                                 Cursor="Hand" HorizontalAlignment="Right" VerticalAlignment="Top"/>
                    </Grid>
                    <StackPanel x:Name="reqBannerList" Margin="0,9,0,0"/>
                  </StackPanel>
                </Border>

                <TextBlock Text="WHERE THE SERVERS WILL RUN" Style="{StaticResource Label}" Margin="0,0,0,7"/>
                <Border x:Name="shapeCardWorkstation" Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="1" CornerRadius="10" Padding="16,12" Margin="0,0,0,8">
                  <StackPanel>
                    <RadioButton x:Name="rbShapeWorkstation" GroupName="shape" FontSize="14" FontWeight="SemiBold" Foreground="#202024"
                                 Content="On this computer, for the person sitting at it"/>
                    <TextBlock Style="{StaticResource Sub}" Margin="24,5,0,0" Text="The assistant on this computer starts the servers here. The usual answer."/>
                    <TextBlock x:Name="shapeWorkstationClients" Style="{StaticResource Sub}" Margin="24,3,0,0" Text=""/>
                  </StackPanel>
                </Border>
                <Border x:Name="shapeCardCentral" Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="1" CornerRadius="10" Padding="16,12" Margin="0,0,0,8">
                  <StackPanel>
                    <RadioButton x:Name="rbShapeCentral" GroupName="shape" FontSize="14" FontWeight="SemiBold" Foreground="#202024"
                                 Content="As a shared service on this server, reached over the network"/>
                    <TextBlock Style="{StaticResource Sub}" Margin="24,5,0,0" Text="The servers run here behind the HTTP gateway, and clients reach them across the network."/>
                    <TextBlock x:Name="shapeCentralClients" Style="{StaticResource Sub}" Margin="24,3,0,0" Text=""/>
                  </StackPanel>
                </Border>
                <TextBlock x:Name="lblShapeChosen" Foreground="#5C5C63" FontSize="12" TextWrapping="Wrap" Margin="0,2,0,0"
                           Text="Nothing is selected. Choose one of the two to continue."/>

                <!-- Why the fields below are greyed, said where the greying is.
                     OUTSIDE credFields on purpose: everything inside drops to 35%
                     opacity when the panel is disabled, and an explanation that
                     dims with the thing it explains is not an explanation. The
                     cause lives on a checkbox inside a COLLAPSED Advanced
                     expander, so without this line the fields are simply inert
                     for no visible reason. Reported from a real run: the
                     per-server key tick could not be cleared and nothing on
                     screen said why. -->
                <Border x:Name="reuseLockNote" Visibility="Collapsed" Background="#FFF8E1" BorderBrush="#E8D9A0"
                        BorderThickness="1" CornerRadius="6" Padding="12,9" Margin="0,4,0,10">
                  <TextBlock Foreground="#5C4B12" FontSize="12.5" TextWrapping="Wrap"
                             Text="These fields are locked because this installation already has credentials and the wizard is keeping them. To change the key, or to give individual servers their own key, open Advanced below and untick 'Keep the credentials already on disk'."/>
                </Border>

                <StackPanel x:Name="credFields">
                  <!-- The server name, not the URL. Everything else about a bConnect
                       address is fixed by the product (https, port 443, the /bconnect
                       virtual directory), so asking for the whole thing asked the
                       operator to retype four constants around the one variable, and
                       made a typo in any of the four look like a bad password. The
                       composed address is shown below as it is typed, so nothing is
                       hidden. A site genuinely not at the standard address is handled
                       under Advanced. -->
                  <TextBlock Text="BARAMUNDI SERVER" Style="{StaticResource Label}"/>
                  <TextBox x:Name="txtServerFqdn"/>
                  <TextBlock x:Name="lblComposedUrl" Style="{StaticResource Sub}" Text=""/>
                  <TextBlock Text="AUTHENTICATION" Style="{StaticResource Label}"/>
                  <StackPanel Orientation="Horizontal">
                    <RadioButton x:Name="rbApiKey" Content="API key" GroupName="auth" IsChecked="True" Margin="0,0,24,0"/>
                    <RadioButton x:Name="rbBasic" Content="Username and password (Basic)" GroupName="auth"/>
                  </StackPanel>
                  <StackPanel x:Name="pnlApiKey" Margin="0,9,0,0">
                    <TextBlock Text="API KEY" Style="{StaticResource Label}" Margin="0,0,0,5"/>
                    <PasswordBox x:Name="pwApiKey"/>
                    <TextBlock Style="{StaticResource Sub}" Text="bMS console -> Server Management -> API Keys. Nothing typed here is echoed, logged or placed on a command line."/>
                    <!-- Ticked by default, so the common installation is exactly what
                         it was: type one key, done. Clearing it is how an operator
                         gives the server that WRITES a narrower bMS key than the
                         servers that only read, without having to know that
                         BCONNECT_API_KEY__JOBS is the variable underneath. Blank
                         means "use the key above", which is the only rule to learn. -->
                    <CheckBox x:Name="chkOneKeyForAll" Content="Use this key for every server" IsChecked="True" Margin="0,12,0,0"/>
                    <TextBlock Style="{StaticResource Sub}"
                               Text="Most installations use one key everywhere. Clear the tick to give individual servers their own key, for example a read-only key for inventory and a separate one for the server that runs jobs."/>
                    <StackPanel x:Name="pnlPerServerKeys" Visibility="Collapsed" Margin="0,10,0,0"/>
                  </StackPanel>
                  <!-- Labelled, unlike the two bare boxes this replaces: a TextBox
                       above a PasswordBox says which is which only to someone who
                       already knows. The note is not decoration. Basic is an IIS
                       setting on the bConnect site, and an installation with only
                       Windows authentication enabled refuses every username and
                       password with a 401 that reads exactly like a wrong one. -->
                  <StackPanel x:Name="pnlBasic" Visibility="Collapsed" Margin="0,9,0,0">
                    <TextBlock Text="USERNAME" Style="{StaticResource Label}" Margin="0,0,0,5"/>
                    <TextBox x:Name="txtBasicUser"/>
                    <TextBlock Text="PASSWORD" Style="{StaticResource Label}"/>
                    <PasswordBox x:Name="pwBasic"/>
                    <TextBlock x:Name="lblBasicNote" Style="{StaticResource Sub}"
                               Text="Basic authentication has to be enabled on the bConnect site in IIS. Where only Windows authentication is enabled -- a common configuration -- a username and password is refused however correct it is. Test names the schemes the server actually offers."/>
                  </StackPanel>
                </StackPanel>

                <!-- The real engine, in -DryRun, reported here rather than on the run
                     page: this is where the URL and the key were typed, so this is
                     where a wrong one has to be answered. -->
                <StackPanel Orientation="Horizontal" Margin="0,14,0,0">
                  <Button x:Name="btnTest" Content="Test" Style="{StaticResource Flat}"/>
                  <TextBlock x:Name="lblTestResult" Foreground="#5C5C63" FontSize="12" VerticalAlignment="Center"
                             TextWrapping="Wrap" Margin="14,0,0,0" Text="Calls bConnect for real and writes nothing."/>
                </StackPanel>

                <Expander x:Name="expConnectAdvanced" Header="Advanced" IsExpanded="False" Margin="0,20,0,0"
                          Foreground="#014380" FontSize="12.5" FontWeight="SemiBold">
                  <StackPanel Margin="0,10,0,0">
                    <CheckBox x:Name="chkReuse" Content="Keep the credentials already on disk"/>
                    <TextBlock x:Name="lblStoreNow" Style="{StaticResource Sub}" Margin="24,3,0,0" Text=""/>

                    <!-- The escape hatch for the composed address. It lives here
                         rather than on the page body because it is the rare case,
                         but it is not hidden: an existing installation whose stored
                         URL is not of the standard form opens this expander and
                         ticks this box on load, so the operator sees the real value
                         instead of the wizard quietly proposing a different one. -->
                    <TextBlock Text="BCONNECT ADDRESS" Style="{StaticResource Label}"/>
                    <CheckBox x:Name="chkCustomUrl" Content="This bConnect is not at the standard address"/>
                    <TextBlock Style="{StaticResource Sub}" Margin="24,3,0,0" Text="For a site on a port other than 443, or under a virtual directory other than /bconnect. The server name on the page above is then not used."/>
                    <StackPanel x:Name="pnlCustomUrl" Visibility="Collapsed" Margin="0,9,0,0">
                      <TextBlock Text="FULL BCONNECT URL" Style="{StaticResource Label}" Margin="0,0,0,5"/>
                      <TextBox x:Name="txtBaseUrl"/>
                      <TextBlock Style="{StaticResource Sub}" Text="Ends at /bconnect. A module segment after it produces a 401 that looks like a bad password."/>
                    </StackPanel>

                    <TextBlock Text="BCONNECT V1.1 (OPTIONAL)" Style="{StaticResource Label}"/>
                    <CheckBox x:Name="chkV11" Content="Configure v1.1 Basic credentials"/>
                    <!-- Set at startup, because what this should say depends on the
                         machine: a workgroup server has no domain to form a UPN from,
                         and demanding one there refuses the only account forms that
                         exist. See lblV11Note below. -->
                    <TextBlock x:Name="lblV11Note" Style="{StaticResource Sub}" Margin="24,3,0,0" Text=""/>
                    <StackPanel x:Name="pnlV11" Visibility="Collapsed" Margin="0,9,0,0">
                      <TextBlock Text="USERNAME (UPN)" Style="{StaticResource Label}" Margin="0,0,0,5"/>
                      <TextBox x:Name="txtV11User"/>
                      <TextBlock Text="PASSWORD" Style="{StaticResource Label}"/>
                      <PasswordBox x:Name="pwV11"/>
                    </StackPanel>

                    <TextBlock Text="CA CERTIFICATE (PEM)" Style="{StaticResource Label}"/>
                    <TextBox x:Name="txtCaCert"/>
                    <TextBlock x:Name="lblCaNote" Style="{StaticResource Sub}" Text=""/>

                    <TextBlock Text="CREDENTIAL STORAGE" Style="{StaticResource Label}"/>
                    <RadioButton x:Name="rbPlain" GroupName="store" IsChecked="True" Content="Plaintext file, protected by the directory ACL"/>
                    <TextBlock Style="{StaticResource Sub}" Margin="24,3,0,0" Text="The default. The ACL stops other local accounts; it does not travel with a copy of the file."/>
                    <RadioButton x:Name="rbProtect" GroupName="store" Content="DPAPI-encrypted for your Windows account" Margin="0,9,0,0"/>
                    <TextBlock Style="{StaticResource Sub}" Margin="24,3,0,0" Text="Protects a file that leaves the machine. It does not protect against malware running as you."/>
                    <Border x:Name="convertNote" Background="#FBF1E0" BorderBrush="#9A5B00" BorderThickness="1" CornerRadius="9" Padding="14,10" Margin="0,14,0,0" Visibility="Collapsed">
                      <TextBlock x:Name="lblConvert" Foreground="#9A5B00" FontSize="12.5" TextWrapping="Wrap" Text=""/>
                    </Border>
                  </StackPanel>
                </Expander>
              </StackPanel>
            </ScrollViewer>
          </Grid>

          <!-- ============ page 1: clients ============
               Content is loaded at runtime from lib\HostSelectionPage.ps1: its XAML,
               its rows and its parameter mapping, so the one list of supported clients
               stays lib\hosts.json and the window cannot drift from a console -Hosts
               run. This placeholder only reserves the slot. -->
          <Grid x:Name="page1" Visibility="Collapsed"/>

          <!-- ============ page 2: permissions ============
               The page the product owner says actually matters. Read only is the
               selected answer; choosing to allow changes is what reveals what that
               permits, per server. Which servers are enabled at all is a different
               question and is behind Advanced. -->
          <Grid x:Name="page2" Visibility="Collapsed">
            <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
            <StackPanel Grid.Row="0">
              <TextBlock Text="What may the assistant change?" Style="{StaticResource H1}"/>
              <TextBlock Style="{StaticResource Sub}" Text="Every server is read-only until write access is turned on here, per server."/>
            </StackPanel>
            <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto" Margin="0,14,0,0">
              <StackPanel Margin="0,0,14,0">
                <Border x:Name="permCardRead" Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="1" CornerRadius="10" Padding="18,14" Margin="0,0,0,10">
                  <StackPanel>
                    <RadioButton x:Name="rbReadOnly" GroupName="perm" IsChecked="True" FontSize="15" FontWeight="SemiBold"
                                 Foreground="#202024" Content="Read only"/>
                    <TextBlock Style="{StaticResource Sub}" Margin="24,6,0,0" Text="The assistant reads from the management suite. Nothing in it can be created, changed or deleted."/>
                  </StackPanel>
                </Border>
                <Border x:Name="permCardWrite" Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="1" CornerRadius="10" Padding="18,14">
                  <StackPanel>
                    <RadioButton x:Name="rbAllowChanges" GroupName="perm" FontSize="15" FontWeight="SemiBold"
                                 Foreground="#202024" Content="Allow changes"/>
                    <TextBlock Style="{StaticResource Sub}" Margin="24,6,0,0" Text="Permits the servers ticked below to create, modify and delete objects in the production estate."/>
                    <TextBlock Style="{StaticResource Sub}" Margin="24,3,0,0" Text="The bMS rights of the API key are a second boundary underneath this one. Do not rely on them to catch a mistake."/>
                    <StackPanel x:Name="writeList" Visibility="Collapsed" Margin="24,12,0,0"/>
                  </StackPanel>
                </Border>
                <Expander x:Name="expServers" Header="Advanced" IsExpanded="False" Margin="0,18,0,0"
                          Foreground="#014380" FontSize="12.5" FontWeight="SemiBold">
                  <StackPanel Margin="0,10,0,0">
                    <TextBlock Style="{StaticResource Sub}" Margin="0,0,0,10" Text="Every enabled server sends its tool schemas to the model on every request. Enable what will be used."/>
                    <StackPanel Orientation="Horizontal" Margin="0,0,0,10">
                      <Button x:Name="btnSelRecommended" Content="Recommended" Style="{StaticResource Flat}" Margin="0,0,8,0"/>
                      <Button x:Name="btnSelMinimal" Content="Minimal" Style="{StaticResource Flat}" Margin="0,0,8,0"/>
                      <Button x:Name="btnSelAll" Content="Everything" Style="{StaticResource Flat}" Margin="0,0,8,0"/>
                      <Button x:Name="btnSelNone" Content="None" Style="{StaticResource Flat}"/>
                      <TextBlock x:Name="lblMeasure" Foreground="#5C5C63" FontSize="12" VerticalAlignment="Center" Margin="16,0,0,0" Text=""/>
                    </StackPanel>
                    <StackPanel x:Name="serverList"/>
                    <TextBlock x:Name="lblCost" Foreground="#202024" FontSize="12.5" TextWrapping="Wrap" Margin="0,8,0,0" Text=""/>
                  </StackPanel>
                </Expander>
              </StackPanel>
            </ScrollViewer>
            <Border x:Name="confirmBar" Grid.Row="2" Background="#FBEAE8" BorderBrush="#C4281F" BorderThickness="1" CornerRadius="9" Padding="14,10" Margin="0,12,0,0" Visibility="Collapsed">
              <StackPanel>
                <TextBlock x:Name="lblConfirmWhat" Foreground="#C4281F" FontSize="12.5" TextWrapping="Wrap" Text=""/>
                <StackPanel Orientation="Horizontal" Margin="0,9,0,0">
                  <TextBlock Text="type" Foreground="#C4281F" FontSize="12.5" VerticalAlignment="Center" Margin="0,0,8,0"/>
                  <TextBlock Text="ENABLE WRITES" Foreground="#C4281F" FontSize="12.5" FontWeight="SemiBold" VerticalAlignment="Center" Margin="0,0,10,0"/>
                  <TextBox x:Name="txtConfirm" Width="220"/>
                </StackPanel>
              </StackPanel>
            </Border>
          </Grid>

          <!-- ============ page 3: review and install ============
               THE INSTALL LOCATION IS A LINE ON THIS PAGE, not a field behind a
               disclosure. It is where a premium installer puts it: one label, the
               path, and Change. The editor behind Change validates before it accepts:
               free space, write permission and MAX_PATH headroom. An unusable
               path is refused against the path that was typed, rather than several
               minutes into a run. The secrets directory follows the location unless
               it is set there, and the consequence of moving it is beside it. -->
          <Grid x:Name="page3" Visibility="Collapsed">
            <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
            <StackPanel Grid.Row="0">
              <TextBlock Text="Review and install" Style="{StaticResource H1}"/>
              <TextBlock Style="{StaticResource Sub}" Text="Nothing has been written yet. Check (dry run) performs the whole run against the live server and writes nothing."/>
            </StackPanel>
            <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto" Margin="0,16,0,0">
              <StackPanel Margin="0,0,14,0">
                <Border Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="1" CornerRadius="10" Padding="18,14">
                  <StackPanel>
                    <Grid>
                      <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="190"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/>
                      </Grid.ColumnDefinitions>
                      <TextBlock Grid.Column="0" Text="Install location" Foreground="#5C5C63" FontSize="12.5" VerticalAlignment="Center"/>
                      <TextBlock Grid.Column="1" x:Name="lblInstallLocation" Foreground="#202024" FontSize="12.5"
                                 VerticalAlignment="Center" TextTrimming="CharacterEllipsis" Margin="0,0,12,0" Text=""/>
                      <Button Grid.Column="2" x:Name="btnChangeLocation" Content="Change" Style="{StaticResource Flat}" Padding="16,5"/>
                    </Grid>
                    <StackPanel x:Name="locationEditor" Visibility="Collapsed" Margin="0,14,0,0">
                      <TextBlock Text="INSTALL LOCATION" Style="{StaticResource Label}" Margin="0,0,0,5"/>
                      <TextBox x:Name="txtSuite"/>
                      <TextBlock Style="{StaticResource Sub}" Text="The suite root: the server packages, their dependencies and the built output."/>
                      <TextBlock Text="SECRETS DIRECTORY" Style="{StaticResource Label}"/>
                      <TextBox x:Name="txtSecrets"/>
                      <TextBlock Style="{StaticResource Sub}" Text="Follows the install location until it is set here."/>
                      <TextBlock Style="{StaticResource Sub}" Text="Inheritance is broken on it and an explicit ACL is applied with icacls, so administrator rights are needed where this account does not own the directory."/>
                      <StackPanel Orientation="Horizontal" Margin="0,14,0,0">
                        <Button x:Name="btnApplyLocation" Content="Use this location" Style="{StaticResource Primary}"/>
                        <Button x:Name="btnCancelLocation" Content="Cancel" Style="{StaticResource Flat}" Margin="10,0,0,0"/>
                      </StackPanel>
                    </StackPanel>
                    <TextBlock x:Name="lblLocationProblem" Visibility="Collapsed" Foreground="#C4281F" FontSize="12.5"
                               TextWrapping="Wrap" Margin="0,12,0,0" Text=""/>
                    <StackPanel x:Name="preflight" Margin="0,12,0,0"/>
                  </StackPanel>
                </Border>
                <Border Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="1" CornerRadius="10" Padding="18,14" Margin="0,12,0,0">
                  <StackPanel x:Name="reviewList"/>
                </Border>
                <!-- The three verification tiers are the honest content of host support;
                     a review page that flattened them into "supported" would undo that. -->
                <Border x:Name="hostHonesty" Background="#FBF1E0" BorderBrush="#9A5B00" BorderThickness="1" CornerRadius="9" Padding="14,10" Margin="0,12,0,0" Visibility="Collapsed">
                  <TextBlock x:Name="lblHostHonesty" Foreground="#9A5B00" FontSize="12.5" TextWrapping="Wrap" Text=""/>
                </Border>
                <Border Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="1" CornerRadius="10" Padding="18,14" Margin="0,12,0,0">
                  <StackPanel>
                    <CheckBox x:Name="chkContinueUnreachable" Content="Install even if bConnect does not answer"/>
                    <TextBlock Style="{StaticResource Sub}" Margin="24,3,0,0" Text="The installer stops when that call fails. Leave this off unless you know why it fails."/>
                  </StackPanel>
                </Border>
                <Expander x:Name="expEquivalent" Header="The equivalent console command" IsExpanded="False" Margin="0,14,0,0"
                          Foreground="#014380" FontSize="12.5" FontWeight="SemiBold">
                  <StackPanel Margin="0,10,0,0">
                    <TextBox x:Name="txtEquivalent" IsReadOnly="True" TextWrapping="Wrap" FontFamily="Consolas" FontSize="12" Background="#F4F4F6" BorderThickness="0"/>
                    <TextBlock Style="{StaticResource Sub}" Text="Secrets are not in it. This is what a headless run of the same install looks like."/>
                  </StackPanel>
                </Expander>
              </StackPanel>
            </ScrollViewer>
          </Grid>

          <!-- ============ page 4: run ============
               Not a step in the rail: it is what pressing Install produces. -->
          <Grid x:Name="page4" Visibility="Collapsed">
            <Grid.ColumnDefinitions><ColumnDefinition Width="360"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
            <Grid Grid.Column="0" Margin="0,0,18,0">
              <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
              <StackPanel Grid.Row="0">
                <TextBlock x:Name="lblRunTitle" Text="Running" Style="{StaticResource H1}"/>
                <TextBlock x:Name="lblRunSub" Style="{StaticResource Sub}" Text=""/>
              </StackPanel>
              <!-- finishSummary sits ABOVE the step list, in the same scroller: once a
                   run has finished, what was configured and what still has to be done
                   is what the operator needs, and the steps are the audit trail behind
                   it. It is built from Get-CompletionSummary, which is also what the
                   completion text on the clipboard and in lib\Test-WizardPrep.ps1 read,
                   so there is one description of what a run did. -->
              <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto" Margin="0,16,0,0">
                <StackPanel>
                  <!-- The certificate verdict, above everything else on this pane. It is
                       the one failure an administrator can act on immediately and the one
                       that otherwise scrolls off the top of the output pane under several
                       hundred lines of build. Built by Build-TlsPanel from the 'tls'
                       progress record the engine emits; every word of it comes from
                       lib\probe-tls.mjs, so the console and this panel cannot drift. -->
                  <StackPanel x:Name="tlsPanel" Visibility="Collapsed" Margin="0,0,0,14"/>
                  <StackPanel x:Name="finishSummary" Visibility="Collapsed" Margin="0,0,0,14"/>
                  <StackPanel x:Name="stepList"/>
                </StackPanel>
              </ScrollViewer>
            </Grid>
            <!-- Deliberately still dark: this pane renders the wrapped script's own Write-Host
                 colours verbatim (see $Con / $script:ConsoleColorMap below), which only reads
                 correctly against a dark backdrop. Everything else on this page is the light
                 chrome; this is the one intentional "terminal well". -->
            <Border Grid.Column="1" Background="#141417" BorderBrush="#2E2E34" BorderThickness="1" CornerRadius="10">
              <Grid>
                <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
                <Grid Grid.Row="0" Margin="14,10,14,6">
                  <TextBlock Text="INSTALLER OUTPUT" Foreground="#8C8C90" FontSize="11" FontWeight="SemiBold"/>
                  <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                    <TextBlock x:Name="lblElapsed" Foreground="#8C8C90" FontSize="11" VerticalAlignment="Center" Text=""/>
                    <Button x:Name="btnCopyLog" Content="Copy" FontSize="11" Margin="12,0,0,0" Padding="10,2"
                            Background="#22222A" Foreground="#C8C8CC" BorderBrush="#3A3A42" BorderThickness="1"
                            ToolTip="Copy the whole run to the clipboard"/>
                  </StackPanel>
                </Grid>
                <!-- A read-only RichTextBox, not a TextBlock.
                     A TextBlock cannot be selected, so an operator watching an install
                     fail could photograph the screen or retype it, at exactly the moment
                     they most need to send the text to somebody. Reported from testing.

                     The inner Paragraph keeps the name 'console' and the RichTextBox
                     takes 'conScroll', so Append-Console's .Inlines.Add and the
                     .ScrollToEnd call both work unchanged. The markup moves and no
                     output code does. PageWidth stands in for the old NoWrap setting:
                     a FlowDocument wraps to its column otherwise, and a wrapped
                     installer log is far harder to read. -->
                <RichTextBox x:Name="conScroll" Grid.Row="1" IsReadOnly="True" IsReadOnlyCaretVisible="True"
                             VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto"
                             Background="Transparent" BorderThickness="0" Foreground="#C8C8CC"
                             FontFamily="Consolas" FontSize="12" Margin="0,0,0,8" Padding="14,0,14,0"
                             SelectionBrush="#3A6EA5">
                  <FlowDocument PageWidth="4000">
                    <Paragraph x:Name="console" Margin="0" TextIndent="0" LineHeight="16"/>
                  </FlowDocument>
                </RichTextBox>
              </Grid>
            </Border>
          </Grid>
        </Grid>
      </Grid>

      <!-- footer -->
      <Border Grid.Row="2" Background="#FFFFFF" BorderBrush="#DDDDDD" BorderThickness="0,1,0,0" CornerRadius="0,0,13,13" Height="62">
        <Grid Margin="24,0,24,0">
          <TextBlock x:Name="lblFooter" Foreground="#5C5C63" FontSize="12.5" VerticalAlignment="Center" TextWrapping="NoWrap" Text=""/>
          <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" VerticalAlignment="Center">
            <Button x:Name="btnVerify" Content="Verify only" Style="{StaticResource Flat}" Margin="0,0,10,0"/>
            <Button x:Name="btnCheck" Content="Check (dry run)" Style="{StaticResource Flat}" Margin="0,0,10,0"/>
            <Button x:Name="btnBack" Content="Back" Style="{StaticResource Flat}" Margin="0,0,10,0"/>
            <Button x:Name="btnNext" Content="Next" Style="{StaticResource Primary}"/>
          </StackPanel>
        </Grid>
      </Border>
    </Grid>
  </Border>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$win    = [Windows.Markup.XamlReader]::Load($reader)

# Fit to the work area, as bPerfMon does: the design size overflows a smaller or
# DPI-scaled screen, and a borderless window that lands off-screen cannot be dragged back.
try {
    $wa = [System.Windows.SystemParameters]::WorkArea
    $win.MaxWidth = $wa.Width; $win.MaxHeight = $wa.Height
    if ($win.Width  -gt $wa.Width)  { $win.Width  = $wa.Width }
    if ($win.Height -gt $wa.Height) { $win.Height = $wa.Height }
} catch { }

$els = @{}
foreach ($n in @('outerBorder','closeBtn','TitleBar','rail','modeBadge','logoHost','logoImage','logoFallback',
                 'page0','page1','page2','page3','page4',
                 'lnkNeeded','reqBanner','lblReqBanner','lnkRecheck','reqBannerList',
                 'rbShapeWorkstation','rbShapeCentral','shapeCardWorkstation','shapeCardCentral',
                 'shapeWorkstationClients','shapeCentralClients','lblShapeChosen',
                 'credFields','reuseLockNote','txtServerFqdn','lblComposedUrl','chkCustomUrl','pnlCustomUrl','txtBaseUrl',
                 'rbApiKey','rbBasic','pnlApiKey','pwApiKey','chkOneKeyForAll','pnlPerServerKeys',
                 'pnlBasic','lblBasicNote',
                 'txtBasicUser','pwBasic','btnTest','lblTestResult','expConnectAdvanced','chkReuse',
                 'chkV11','pnlV11','lblV11Note','txtV11User','pwV11','txtCaCert','lblCaNote',
                 'lblStoreNow','rbPlain','rbProtect','convertNote','lblConvert',
                 'permCardRead','permCardWrite','rbReadOnly','rbAllowChanges',
                 'writeList','confirmBar','lblConfirmWhat','txtConfirm',
                 'expServers','serverList','lblCost','lblMeasure','btnSelRecommended','btnSelMinimal','btnSelAll','btnSelNone',
                 'lblInstallLocation','btnChangeLocation','locationEditor','txtSuite','txtSecrets',
                 'btnApplyLocation','btnCancelLocation','lblLocationProblem','preflight',
                 'reviewList','hostHonesty','lblHostHonesty','expEquivalent','txtEquivalent','chkContinueUnreachable',
                 'lblRunTitle','lblRunSub','tlsPanel','finishSummary','stepList','console','conScroll','btnCopyLog','lblElapsed',
                 'lblFooter','btnBack','btnNext','btnCheck','btnVerify')) {
    $els[$n] = $win.FindName($n)
}

# The host page is a separate XAML document (lib\HostSelectionPage.ps1) loaded into
# the Clients slot. It carries its own name scope, so its named elements are looked up
# on the loaded root rather than on the window, and then joined to the same $els map
# everything else uses.
$hostPageRoot = [Windows.Markup.XamlReader]::Load(
    (New-Object System.Xml.XmlNodeReader ([xml](Get-HostSelectionXaml))))
[void]$els.page1.Children.Add($hostPageRoot)
foreach ($n in @('HostList','ImpracticalWarning','MissingHostWarning','MissingHostText',
                 'ProjectPathRow','ProjectDirBox','ProjectDirNote',
                 'ConfigPathRow','ConfigPathBox','ConfigPathNote',
                 'GatewaySection','GatewayAdvanced','GatewayOptInCheck',
                 'GatewayWantedCheck','GatewayPanel','GatewayBindBox','GatewayPortBox',
                 'GatewayNoAuthCheck','GatewayRotateTokenCheck','StartGatewayCheck','HostSummaryText','ShapeNote')) {
    $els[$n] = $hostPageRoot.FindName($n)
}

$els.closeBtn.Add_MouseLeftButtonDown({ $win.Close() })
$els.TitleBar.Add_MouseLeftButtonDown({ if ($_.OriginalSource -isnot [System.Windows.Controls.TextBlock]) { $win.DragMove() } })

# A borderless white window can lose its edge against an equally light desktop
# background (File Explorer, a blank document...). This used to be a
# DropShadowEffect on $win.Content.
#
# WHY IT IS NOT ANY MORE. The effect was set on the ROOT content, so the entire
# visual tree was pushed through a blur on every render. With
# AllowsTransparency="True" the window is a layered, fully SOFTWARE-rendered
# surface -- there is no GPU path to absorb that -- and on a VM or over RDP the
# cost lands directly on every repaint, scroll and keystroke. Reported as
# sluggish on a Server 2019 VM, which is the deployment this installer is
# actually run on.
#
# The stated purpose survives without the blur: outerBorder already draws a 1px
# #DDDDDD edge, darkened a shade here so the boundary reads against a light
# desktop. A hairline is what the shadow was standing in for.
try {
    $els.outerBorder.BorderBrush = New-Object System.Windows.Media.SolidColorBrush(
        [System.Windows.Media.Color]::FromRgb(0xB8, 0xB8, 0xC0))
} catch { }

# -----------------------------------------------------------------------------
# Branding assets -- loaded if present, degrade cleanly if not. No logo or icon is
# invented here: an absent file leaves the text wordmark (logoFallback, already in
# the XAML) and WPF's default window icon, never a broken-image box or a crash.
# See "Branding assets" in INSTALL.md for the expected files, dimensions and sizes.
# -----------------------------------------------------------------------------
if (Test-Path -LiteralPath $IconPath) {
    try {
        $iconBmp = New-Object System.Windows.Media.Imaging.BitmapImage
        $iconBmp.BeginInit()
        $iconBmp.UriSource = New-Object System.Uri((Resolve-Path -LiteralPath $IconPath).Path, [System.UriKind]::Absolute)
        $iconBmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $iconBmp.EndInit()
        $win.Icon = $iconBmp
    } catch { }   # a corrupt or unreadable .ico must not stop the wizard from opening
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
# Page indices, named. Bare ordinals spread across Show-Page, Test-CanAdvance,
# Update-Nav and three button handlers is exactly how a page gets inserted and one of
# them keeps pointing at the old neighbour.
#
# FOUR STEPS AND A RESULT. The rail draws $StepCount entries; the run page is the
# fifth grid and has no rail entry, because it is not somewhere an operator
# navigates to -- it is what pressing Install produces.
$PG_CONNECT = 0
$PG_CLIENTS = 1
$PG_PERMS   = 2
$PG_REVIEW  = 3
$PG_RUN     = 4

$script:Page        = $PG_CONNECT
$script:PageCount   = 5
$script:StepCount   = 4
$script:Running     = $false
$script:RunKind     = 'install'
$script:ServerRows  = @()      # one per catalog entry: @{ Spec; Check; TokenText }
$script:WriteRows   = @()      # one per write-capable selected server
$script:Measured    = @{}
$script:StepBlocks  = @{}
$script:LastResult  = $null
# SEC-7 -- the 'gateway-token' progress record from the engine script, if this run
# generated or rotated one. Rendered by Finish-Run, never persisted by the wizard:
# it already lives in the ACL-hardened credentials file the engine wrote.
$script:GatewayTokenResult = $null
$script:Ps          = $null
$script:Handle      = $null
$script:Runspace    = $null
$script:InfoCursor  = 0
# The host page's rows, from lib\hosts.json. These objects ARE the selection: the
# list binds to them TwoWay, so a tick updates the object and every reader here goes
# to the object rather than hunting through a realised visual tree -- which also
# means the page's logic is exercisable with no window on screen.
$script:HostRows    = @()
$script:GatewayForced = $false
# The 'tls' progress record from the engine, if this run produced one. Held rather
# than printed as it arrives: the certificate verdict comes out of Step 4 and the
# build that follows is several hundred lines, so a panel written at the end is the
# only place an operator will still see it.
$script:TlsResult   = $null

# The deployment shape, answered by the first control on the Connect page and
# deliberately empty until it is. Every reader goes through Get-DeploymentShape so
# there is one place that knows the answer is not yet given.
$script:Shape       = ''

# The secrets directory FOLLOWS the install location rather than being a second
# question -- until the operator types one, at which point it stops following and
# keeps what they typed. One flag, set in exactly one place (the secrets box's own
# handler), because "did the operator mean this" cannot be recovered from the value.
$script:SecretsPinned = $false
# Guards the follow-the-suite-root assignment against the TextChanged event it
# raises, which would otherwise clear the flag it just honoured.
$script:SettingSecrets = $false
# The last requirement checks drawn in the banner on the Connect page. Held so the
# banner and the count in the footer are the same result rather than two runs.
$script:ReqChecks   = @()

$PageTitles = @(
    'Connect',
    'Clients',
    'Permissions',
    'Review and install',
    'Installing'
)
$PageBlurbs = @(
    'where the servers run, and the bMS address',
    'which MCP clients to configure',
    'read only, or allow changes',
    'the location, then Install',
    'the installer, live'
)

# The install location, and the two numbers that decide whether a location can hold
# this product. Both are stated once here and read by every caller, so the
# requirements page, the location editor and the offline bundle's own launcher cannot
# disagree about what "enough room" means.
#
#   $MinFreeGb          a clean install downloads dependencies and builds every
#                       server package; measured at roughly 1.5 GB, floored at 2.
#   $DeepestBundlePath  the deepest file in the bundle, relative to its own root,
#                       measured -- the same 147 that packaging\START-HERE.cmd uses.
#   $PathMargin         room for the temporary files the build writes.
#
# Windows MAX_PATH is 260 and LongPathsEnabled is 0 by default. A path that leaves no
# headroom produces a partial extraction or a server that will not start, and both
# read to an operator as a corrupt download.
$script:MinFreeGb         = 2
$script:DeepestBundlePath = 147
$script:PathMargin        = 10
$script:MaxPath           = 260

# =============================================================================
# Small builders
# =============================================================================
function New-Line($text, $color, $size = 12.5, $bold = $false) {
    $t = New-Object System.Windows.Controls.TextBlock
    $t.Text = $text; $t.Foreground = (Br $color); $t.FontSize = $size
    $t.TextWrapping = 'Wrap'
    if ($bold) { $t.FontWeight = 'SemiBold' }
    return $t
}

# =============================================================================
# Deployment shape -- page 0, and the answer every later page reads.
#
# One accessor, so no page decides for itself what an unanswered question means.
# '' is a real state and is never quietly read as 'workstation': the whole point of
# the page is that an install placed on the wrong machine reports success, and a
# default would put that failure back exactly where it was.
# =============================================================================
function Get-DeploymentShape {
    if ($els.rbShapeWorkstation.IsChecked) { return 'workstation' }
    if ($els.rbShapeCentral.IsChecked)     { return 'central' }
    return ''
}

# The sentence each later page uses to say which shape is being installed. Written
# once because it appears on the preparation page, in the footer, on the review page
# and in the completion summary, and four hand-written versions of it drift.
function Get-ShapeDescription {
    param([string] $Shape = (Get-DeploymentShape))
    switch ($Shape) {
        'workstation' {
            return 'Workstation: the servers run on this computer, started by the assistant application on this computer.'
        }
        'central' {
            return 'Shared service: the servers run on this computer behind the HTTP gateway, and clients reach them across the network.'
        }
        default {
            return 'The deployment has not been chosen yet.'
        }
    }
}

# Which clients each answer offers, named from lib\hosts.json rather than listed
# here, so the two cards on page 0 describe the list the operator will actually get.
function Get-ShapeClientLabels {
    param([Parameter(Mandatory)][string] $Shape)
    return @(Get-HostSelectionCatalog -ProjectDir $els.ProjectDirBox.Text -HostOutDir $HostOutDir `
                 -ConfigPath $els.ConfigPathBox.Text -Shape $Shape | ForEach-Object { $_.Label })
}

function Update-ShapePage {
    foreach ($pair in @(
            @{ Shape = 'workstation'; Block = $els.shapeWorkstationClients; Card = $els.shapeCardWorkstation; Radio = $els.rbShapeWorkstation }
            @{ Shape = 'central';     Block = $els.shapeCentralClients;     Card = $els.shapeCardCentral;     Radio = $els.rbShapeCentral })) {
        # Named from lib\hosts.json rather than listed here, and capped: the point is
        # that the two answers offer different lists, which four names and a count
        # make as well as twelve names wrapped over three lines.
        $labels = Get-ShapeClientLabels -Shape $pair.Shape
        $pair.Block.Text = "Offers $($labels.Count) clients: " +
            ((@($labels | Select-Object -First 4) -join ', ')) +
            $(if ($labels.Count -gt 4) { ", and $($labels.Count - 4) more." } else { '.' })
        $on = [bool]$pair.Radio.IsChecked
        $pair.Card.BorderBrush     = (Br $(if ($on) { $C.Accent } else { $C.Border }))
        $pair.Card.BorderThickness = (Thk $(if ($on) { 2 } else { 1 }) $(if ($on) { 2 } else { 1 }) $(if ($on) { 2 } else { 1 }) $(if ($on) { 2 } else { 1 }))
    }
    $shape = Get-DeploymentShape
    $els.lblShapeChosen.Text = $(if ($shape) { Get-ShapeDescription $shape }
                                 else { 'Nothing is selected. Choose one of the two to continue.' })
    $els.lblShapeChosen.Foreground = (Br $(if ($shape) { $C.Ok } else { $C.Muted }))
    Update-Nav
}

# =============================================================================
# "What you will need" -- a document, not a page.
#
# The preparation page this replaces was four bordered panels of bullets, several
# of them three lines long, shown before anything had been collected. A page that
# has to be STUDIED is the opposite of a page that gets COMPLETED, and none of it
# could be acted on from inside the window anyway: creating an API key means
# opening the bMS console, and staging a client installer means leaving the
# machine. So the whole of it is install\README.md -- which the offline bundle also
# copies to its own root, so it is the first thing beside START-HERE.cmd -- and the
# Connect page carries one link to it.
#
# ONE FILE, resolved by one path. The offline bundle's root copy and this one are
# the same document copied at build time (lib\New-OfflineBundle.ps1), never two.
# =============================================================================
function Get-ReadmePath { return (Join-Path $InstallerDir 'README.md') }

function Show-Readme {
    # Opened with the shell so it lands in whatever the operator reads Markdown in,
    # and reported in place when there is nothing to open -- a link that silently
    # does nothing is worse than no link.
    $p = Get-ReadmePath
    if (-not (Test-Path -LiteralPath $p)) {
        $els.lblTestResult.Text = "README.md was not found beside the installer. Expected: $p"
        $els.lblTestResult.Foreground = (Br $C.Warn)
        return $false
    }
    try { Start-Process -FilePath $p | Out-Null; return $true }
    catch {
        $els.lblTestResult.Text = "That file could not be opened. It is at $p"
        $els.lblTestResult.Foreground = (Br $C.Warn)
        return $false
    }
}

# =============================================================================
# Requirements -- run silently, and only failures are drawn.
#
# There is no requirements PAGE any more. A screen of green ticks is a screen an
# operator learns to click past, and it was the single largest contributor to this
# window looking like eleven steps of work. The checks are the same checks; what
# changed is that a computer which is ready says nothing at all, and a computer
# which is not gets a banner on the first page naming the specific remedy.
#
# Every check still returns a state and, when it is not met, that remedy. The third
# state matters as much as the other two: a check that could not run says so,
# because drawing it as met is how an installer acquires a reputation for lying
# about prerequisites.
# =============================================================================
function Get-RequirementChecks {
    # -Shape is the deployment answer from the Connect page. It changes which checks
    # are asked, not how the
    # answers are drawn: a workstation deployment needs the MCP client on THIS
    # computer, a shared-service one needs a free TCP port for the gateway and has
    # its clients somewhere else entirely. Asking both sets of questions of both
    # shapes is how a requirements page comes to report a failure that does not
    # matter, which is the same as reporting nothing.
    param([string] $ProbePath, [string] $Shape = (Get-DeploymentShape))
    if (-not $ProbePath) { $ProbePath = (Get-SuiteRoot) }
    $checks = @()

    # Windows itself. CIM first because it names the edition; the environment's own
    # OSVersion is the fallback, and if both are unavailable this is not guessed.
    $osName = $null; $osVer = $null
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        $osName = $os.Caption; $osVer = [Version]$os.Version
    } catch {
        try { $osVer = [Environment]::OSVersion.Version; $osName = 'Windows' } catch { }
    }
    if ($null -eq $osVer) {
        $checks += @{ Name = 'Windows version'; State = 'not-checked'; Required = $true
                      Detail = 'The operating system version could not be read from this session.'
                      Remedy = 'Supported: Windows 10, Windows 11, and Windows Server 2016 or newer. Confirm the build with winver.' }
    } else {
        $okOs = ($osVer.Major -ge 10)
        $checks += @{ Name = 'Windows version'; State = $(if ($okOs) { 'met' } else { 'not-met' }); Required = $true
                      Detail = ("$osName $osVer").Trim()
                      Remedy = 'Supported: Windows 10, Windows 11, and Windows Server 2016 or newer. Install the suite on a supported build.' }
    }

    $okPs = ($PSVersionTable.PSEdition -ne 'Core' -and $PSVersionTable.PSVersion -ge [Version]'5.1')
    $checks += @{ Name = 'Windows PowerShell 5.1'; State = $(if ($okPs) { 'met' } else { 'not-met' }); Required = $true
                  Detail = "Windows PowerShell $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition))"
                  Remedy = 'Start the installer with powershell.exe, not pwsh.exe. PowerShell 7 carries neither the presentation assemblies this window is built from nor the DPAPI type the credential-protection option needs.' }

    $ap = [System.Threading.Thread]::CurrentThread.GetApartmentState()
    $checks += @{ Name = 'Single-threaded apartment (STA)'; State = $(if ($ap -eq 'STA') { 'met' } else { 'not-met' }); Required = $true
                  Detail = "This session is $ap."
                  Remedy = 'Start it as: powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -File .\Install-BConnectMcp-UI.ps1' }

    $elevated = $null
    try {
        $elevated = (New-Object Security.Principal.WindowsPrincipal(
                        [Security.Principal.WindowsIdentity]::GetCurrent())
                    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { }
    if ($null -eq $elevated) {
        $checks += @{ Name = 'Administrator rights'; State = 'not-checked'; Required = $false
                      Detail = 'The Windows token for this session could not be read, so elevation was not checked.'
                      Remedy = 'Re-open this window as administrator if the secrets directory is one you do not own.' }
    } else {
        $checks += @{ Name = 'Administrator rights'; State = $(if ($elevated) { 'met' } else { 'not-met' }); Required = $false
                      Detail = $(if ($elevated) { 'This session is elevated. The secrets directory ACL can be rewritten.' }
                                 else { 'This session is not elevated.' })
                      Remedy = 'The installer breaks inheritance on the secrets directory and applies an explicit ACL with icacls. Without rights over that directory the run stops on an icacls error. Re-open this window as administrator, or choose a secrets directory you own.' }
    }

    # The runtime. What is present, what the floor is, and -- when nothing adequate is
    # present -- which of the two routes this computer can actually take, all from
    # lib\NodeProvisioning.psm1 in -PlanOnly. This page installs nothing and decides
    # nothing: the console installer performs the same plan at its Step 1, so a page
    # that computed its own answer here would be a second implementation that could
    # disagree with the run it is describing.
    #
    # The remedy this replaced said "install it from https://nodejs.org and start this
    # window again", which is not an instruction an air-gapped bMS server can follow.
    $nodePlan  = Resolve-NodeRuntime -SuiteRoot (Get-SuiteRoot) -InstallerDir $InstallerDir -PlanOnly
    $nodeFloor = $nodePlan.Floor
    if ($nodePlan.Outcome -eq 'Present') {
        $noStore = ($nodePlan.NodeVersion -lt $nodeFloor.Preferred)
        $checks += @{ Name = 'Node.js'; State = 'met'; Required = $true
                      Detail = "Node $($nodePlan.NodeVersion) at $($nodePlan.NodePath)" +
                               $(if ($noStore) { '. This build does not read the Windows certificate store, so a bMS certificate from an internal CA needs a PEM copy named in CA CERTIFICATE (PEM), under Advanced on the Connect page.' } else { '' })
                      Remedy = "The packages declare Node $($nodeFloor.Min) or newer, and $($nodeFloor.Preferred) or newer is preferred on Windows." }
    } elseif ($nodePlan.Media) {
        $checks += @{ Name = 'Node.js'; State = 'not-met'; Required = $true
                      Detail = "Node.js is not on PATH in this session. A runtime is staged at $($nodePlan.Media.Path) (Node $($nodePlan.Media.Version))."
                      Remedy = "The installer installs that runtime at Step 1 and repairs PATH for its own process. Administrator rights are required, because it is installed with msiexec. Nothing is installed on a computer that already has Node $($nodeFloor.Min) or newer." }
    } else {
        $checks += @{ Name = 'Node.js'; State = 'not-met'; Required = $true
                      Detail = "Node.js is not on PATH in this session, and no runtime is staged in $($nodePlan.MediaPath)."
                      Remedy = "Two routes. Staged media, which needs no internet access on this computer: place the x64 MSI from $(Get-NodeMsiUrl ([string]$nodeFloor.Preferred)) into $($nodePlan.MediaPath) and start this window again. Or download: run Install-BConnectMcp.ps1 -AllowNodeDownload, which fetches the MSI, checks it against the published SHASUMS256.txt, and refuses on any mismatch." }
    }

    # Free space on the drive that will hold the build. Not answerable for a UNC
    # path or an unmapped drive, and that is reported rather than assumed.
    $free = $null; $qual = $null
    try {
        $qual = (Split-Path -Qualifier $ProbePath) -replace ':', ''
        if ($qual) { $free = [math]::Round((Get-PSDrive -Name $qual -ErrorAction Stop).Free / 1GB, 1) }
    } catch { $free = $null }
    if ($null -eq $free) {
        $checks += @{ Name = 'Disk space'; State = 'not-checked'; Required = $false
                      Detail = "Free space was not checked: no local drive letter could be resolved for $ProbePath."
                      Remedy = 'A clean install needs roughly 1.5 GB for dependencies and build output. Confirm the space by hand, or press Change beside the install location on the Review page and point it at a local drive.' }
    } else {
        $checks += @{ Name = 'Disk space'; State = $(if ($free -ge $script:MinFreeGb) { 'met' } else { 'not-met' }); Required = $false
                      Detail = "$free GB free on ${qual}:"
                      Remedy = 'A clean install downloads dependencies and builds every server package, which needs roughly 1.5 GB. Free space on that drive, or press Change beside the install location on the Review page.' }
    }

    # A shared-service deployment answers a question a workstation one does not: is
    # the port the gateway will listen on free. It is the only new prerequisite the
    # central shape introduces on this machine, and finding it occupied at Step 10 --
    # after the build -- is several minutes too late.
    if ($Shape -eq 'central') {
        $port = 3001
        [void][int]::TryParse($els.GatewayPortBox.Text, [ref]$port)
        $taken = $null
        try {
            $taken = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().
                        GetActiveTcpListeners() | Where-Object { $_.Port -eq $port }).Count -gt 0
        } catch { $taken = $null }
        if ($null -eq $taken) {
            $checks += @{ Name = "HTTP gateway port $port"; State = 'not-checked'; Required = $false
                          Detail = 'The list of TCP listeners could not be read in this session, so the port was not checked.'
                          Remedy = "Confirm by hand that nothing is listening on $port, or set another port on the Clients page. A port already in use stops the gateway after the build." }
        } else {
            $checks += @{ Name = "HTTP gateway port $port"; State = $(if ($taken) { 'not-met' } else { 'met' }); Required = $false
                          Detail = $(if ($taken) { "Something is already listening on TCP $port on this computer." }
                                     else { "Nothing is listening on TCP $port on this computer." })
                          Remedy = "Stop whatever holds TCP $port, or set a different port on the Clients page. The gateway cannot bind a port that is in use." }
        }
    }

    # Which of the registry's clients are on this computer. Only the ones with a
    # per-user directory can be answered: a snippet target's file goes into the
    # installer's own out directory and says nothing about what is installed, and a
    # per-workspace target stands or falls with a project directory that is not
    # named until the Clients page. Counting either would be counting something else.
    #
    # THE DISTINCTION THIS ROW EXISTS TO MAKE. "Absent from this computer" and "not
    # chosen" are different facts and this page reports only the first: nothing has
    # been selected yet -- the Clients page is the next one. An operator who
    # reads a bare "3 of 5 found" concludes the other two were declined. So both
    # lists are named, and the row says in words that selection has not happened.
    if ($Shape -eq 'central') {
        $checks += @{ Name = 'MCP clients on this computer'; State = 'not-checked'; Required = $false
                      Clients = @()
                      Detail = 'Not applicable to a shared-service deployment. The clients run on other computers and reach this one over HTTP, so what is installed here says nothing about them.'
                      Remedy = 'Install each client on the computer of the person who uses it. This run configures the HTTP endpoint and produces the settings to paste into that client.' }
    } elseif (-not $env:APPDATA) {
        $checks += @{ Name = 'MCP clients on this computer'; State = 'not-checked'; Required = $false
                      Clients = @()
                      Detail = 'APPDATA is not set for this session, so no per-user client directory could be looked for. That is not the same as a client being absent, and it is not the same as a client not being selected.'
                      Remedy = 'Run the wizard as the Windows account that will use the MCP client. Detection is a convenience: a configuration can still be written for a client that is not here yet.' }
    } else {
        $catalog   = @(Get-HostSelectionCatalog -ProjectDir $ProjectRoot -HostOutDir $HostOutDir `
                           -ConfigPath $ConfigPath -Shape $Shape)
        $probe     = @($catalog | Where-Object { $_.Detectable -and -not $_.PerProject })
        $here      = @($probe | Where-Object { $_.HereNow })
        $absent    = @($probe | Where-Object { -not $_.HereNow })
        $workspace = @($catalog | Where-Object { $_.PerProject } | ForEach-Object { $_.Label })
        $detail = @("Installed on this computer: " + $(if ($here.Count) { (($here | ForEach-Object { $_.Label }) -join ', ') } else { 'none of the clients that can be detected here' }) + '.')
        $detail += "Not installed on this computer: " + $(if ($absent.Count) { (($absent | ForEach-Object { $_.Label }) -join ', ') } else { 'none' }) + '.'
        $detail += 'Not installed is not the same as not selected. No client has been selected yet; that is asked on the Clients page.'
        if ($workspace.Count) {
            $detail += 'Per-workspace clients (' + ($workspace -join ', ') + ') are configured against a project directory named on the Clients page, so presence cannot be answered here at all.'
        }
        $checks += @{ Name = 'MCP clients on this computer'; State = $(if ($here.Count) { 'met' } else { 'not-met' }); Required = $false
                      # The per-client states, so a caller can render or assert them
                      # without parsing the sentence back out of Detail.
                      Clients = @($probe | ForEach-Object { @{ Id = $_.Id; Label = $_.Label; Present = [bool]$_.HereNow } })
                      Detail = ($detail -join ' ')
                      Remedy = 'A client that is not installed here has to be installed before its configuration is read. This installer configures MCP clients; it does not install them, and they are not redistributed in this bundle. On an isolated network, stage the client installer beside this bundle first. The Clients page states again which of the ones you select are not present.' }
    }

    return $checks
}

# The banner on the Connect page. Failures only, each with its own remedy, and the
# whole thing collapsed when this computer is ready.
#
# -Checks is a seam, not an option: it lets a guard drive the banner with a known
# set of states instead of whatever the machine running the test happens to report,
# which is the only way to prove that an all-met computer really is given nothing to
# read.
#
# THE MCP-CLIENT ROW IS DELIBERATELY NOT IN THE BANNER. "That client is not on this
# machine" is answered per row on the Clients page, where the client is actually
# chosen, and repeating it here would put a warning about a decision on a page two
# steps before the decision is made. It is still in Get-RequirementChecks, still
# carries its remedy, and is still the thing the Clients page reads.
function Get-BannerChecks {
    param($Checks)
    if ($null -eq $Checks) { $Checks = @(Get-RequirementChecks) }
    return @($Checks | Where-Object { $_.State -ne 'met' -and $_.Name -ne 'MCP clients on this computer' })
}

function Build-RequirementBanner {
    param($Checks)
    if ($null -eq $Checks) { $Checks = @(Get-RequirementChecks) }
    $script:ReqChecks = @($Checks)
    $problems = @(Get-BannerChecks $Checks)
    $els.reqBannerList.Children.Clear()
    if (-not $problems.Count) {
        $els.reqBanner.Visibility = 'Collapsed'
        Update-Nav
        return
    }

    # A required item that is not met is red; anything else in the banner is amber.
    # The banner as a whole takes the more severe of the two, because an operator
    # scanning a colour has to be told the worse thing first.
    $blocking = @($problems | Where-Object { $_.Required -and $_.State -eq 'not-met' })
    $col   = $(if ($blocking.Count) { $C.Crit } else { $C.Warn })
    $bg    = $(if ($blocking.Count) { $C.CritBg } else { $C.WarnBg })
    $els.reqBanner.Background  = (Br $bg)
    $els.reqBanner.BorderBrush = (Br $col)
    $els.lblReqBanner.Foreground = (Br $col)
    $els.lnkRecheck.Foreground   = (Br $col)
    $els.lblReqBanner.Text = $(if ($blocking.Count -eq 1) { 'This computer is not ready: one requirement is not met.' }
                               elseif ($blocking.Count)   { "This computer is not ready: $($blocking.Count) requirements are not met." }
                               elseif ($problems.Count -eq 1) { 'One item to be aware of on this computer.' }
                               else { "$($problems.Count) items to be aware of on this computer." })

    # NOT $c: PowerShell variable names are case-insensitive, so a loop variable named
    # $c shadows the $C palette for the whole body and every colour comes back empty.
    foreach ($chk in $problems) {
        $rowCol = $(if ($chk.State -eq 'not-checked') { $C.Muted }
                    elseif ($chk.Required) { $C.Crit } else { $C.Warn })
        $word   = $(if ($chk.State -eq 'not-checked') { 'NOT CHECKED' } else { 'NOT MET' })
        $sp = New-Object System.Windows.Controls.StackPanel
        $sp.Margin = (Thk 0 0 0 9)
        $head = New-Object System.Windows.Controls.StackPanel
        $head.Orientation = 'Horizontal'
        [void]$head.Children.Add((New-Line $chk.Name $C.Txt 12.5 $true))
        $state = New-Line $word $rowCol 10.5 $true
        $state.Margin = (Thk 10 2 0 0)
        [void]$head.Children.Add($state)
        [void]$sp.Children.Add($head)
        $d = New-Line $chk.Detail $C.Muted 12
        $d.Margin = (Thk 0 3 0 0)
        [void]$sp.Children.Add($d)
        # The remedy is the whole point of showing the row at all.
        $r = New-Line $chk.Remedy $rowCol 12
        $r.Margin = (Thk 0 3 0 0)
        [void]$sp.Children.Add($r)
        [void]$els.reqBannerList.Children.Add($sp)
    }
    $els.reqBanner.Visibility = 'Visible'
    Update-Nav
}

# The one line the footer carries about this computer. Same result as the banner,
# not a second run of the checks.
function Get-RequirementSummary {
    $problems = @(Get-BannerChecks $script:ReqChecks)
    if (-not $problems.Count) { return '' }
    $blocking = @($problems | Where-Object { $_.Required -and $_.State -eq 'not-met' })
    if ($blocking.Count) {
        return ('Not met on this computer: ' + (($blocking | ForEach-Object { $_.Name }) -join ', ') + '.')
    }
    return ('To be aware of: ' + (($problems | ForEach-Object { $_.Name }) -join ', ') + '.')
}

function Set-Preflight {
    $els.preflight.Children.Clear()
    $suite = (Get-SuiteRoot)
    $rows = @()
    $rows += @{ ok = (Test-Path (Join-Path $suite 'package.json')); text = "suite root: $suite" }
    $built = 0
    if (Test-Path $suite) {
        foreach ($s in $Catalog.servers) {
            if (Test-Path (Join-Path $suite (Join-Path $s.dir 'build\index.js'))) { $built++ }
        }
    }
    $rows += @{ ok = ($built -gt 0); text = "$built of $($Catalog.servers.Count) server packages already built" +
                                            $(if ($built -eq 0) { ' -- the install will run npm ci and build, which takes minutes' } else { '' }) }
    $store = Get-CredentialStoreState -EnvFile (Join-Path (Get-SecretsDir) 'bconnect.env')
    $rows += @{ ok = ($store.Mode -ne 'none'); text = "credentials: $($store.Mode)" +
                                                      $(if ($store.ActivePath) { " -- $($store.ActivePath)" } else { ' -- none yet' }) }

    # Node, elevation, the operating system and which clients are on this computer are
    # NOT repeated here. They are properties of the machine, not of the location on
    # this page, and they are reported by the requirement checks -- as a banner on the
    # Connect page when one of them fails, and silently when none does. Two panels
    # answering the same question is how the two of them come to disagree.

    foreach ($r in $rows) {
        $sp = New-Object System.Windows.Controls.StackPanel
        $sp.Orientation = 'Horizontal'; $sp.Margin = (Thk 0 3 0 3)
        $dot = New-Object System.Windows.Shapes.Ellipse
        $dot.Width = 8; $dot.Height = 8; $dot.VerticalAlignment = 'Center'; $dot.Margin = (Thk 0 0 10 0)
        $dot.Fill = (Br $(if ($r.ok) { $C.Ok } else { $C.Warn }))
        [void]$sp.Children.Add($dot)
        [void]$sp.Children.Add((New-Line $r.text $C.Txt 12.5))
        [void]$els.preflight.Children.Add($sp)
    }
}

# =============================================================================
# The install location.
#
# One labelled line on the Review page with a Change beside it, which is where a
# premium installer puts it -- not a field on a page of its own, and not buried in
# an Advanced expander where a customer who has a policy about where software lives
# would never find it.
#
# CHANGING IT REVALIDATES, and the failure is reported against the path that was
# typed rather than several minutes into a run. Three things can make a location
# unusable and all three are cheap to answer here:
#
#   * MAX_PATH. The deepest file in this product sits $DeepestBundlePath characters
#     below its own root. A location with no headroom under the 260-character limit
#     produces a partial extraction or a server that will not start.
#   * free space. A clean install builds every server package.
#   * write permission. Probed by creating and removing a file in the nearest
#     existing ancestor, because the location itself may not exist yet.
#
# This is not a second implementation of the install: it writes nothing and decides
# nothing about the run. The engine performs its own checks when it runs, and this
# only means an operator finds out now instead of then.
# =============================================================================
# THE APPLIED LOCATION, not the box. txtSuite and txtSecrets are the editor's
# scratch values while Change is open, and a path that was typed and refused must
# never reach the engine, the review summary or the equivalent console command. So
# every reader goes through these two, and the boxes only become the answer when
# Confirm-InstallLocation accepts them.
# The three directories a per-project workspace must not be, matching the engine's
# own list ($ProjectRoot, $InstallerDir, $SuiteRoot). The suite root is read through
# Get-SuiteRoot so that changing the install location on the Review page changes
# what counts, rather than leaving this answer behind at its first value.
function Get-InstallationRoots { return @($ProjectRoot, $InstallerDir, (Get-SuiteRoot)) }

function Get-SuiteRoot  { if ($script:LocationApplied) { return $script:LocationApplied } return $els.txtSuite.Text }
function Get-SecretsDir { if ($script:SecretsApplied)  { return $script:SecretsApplied }  return $els.txtSecrets.Text }

# =============================================================================
# The bConnect address.
#
# ConvertTo-ServerHost and Get-ComposedBaseUrl come from lib\Address.ps1, which
# Manage-BConnectMcp.ps1 loads as well: what "the standard address" means has to
# be one answer, or this window writes BCONNECT_BASE_URL in a form the
# configuration window reads back as non-standard. What stays here is the reader
# of THIS window's two boxes, because which box wins is a property of the window.
#
# Advanced is not defeated by the composition: when it is in use it wins
# outright, and the composed value is not merged with it.
# =============================================================================

function Get-TestVerdict {
<#
.SYNOPSIS
    The one line the Test button draws, decided from the run's own verdict.
.DESCRIPTION
    Separate from Finish-Run so it can be driven with known results, because two
    of the three things it must not do are invisible from the window:

    1. IT MUST NOT NAME A CAUSE IT DOES NOT KNOW. It used to say "bConnect did not
       answer" for every failure without a certificate verdict -- including a run
       that stopped in Step 1 on a missing prerequisite and never sent a byte to
       bConnect. Reported from a test VM as a connection failure, with the address
       and the credential both correct. Abort puts its reason on the done record;
       that reason is now what is shown.

    2. IT MUST NOT READ "did not abort" AS "worked". Test always passes
       -ContinueOnUnreachable so the certificate and the URL rules are still
       reported when the address is wrong -- so a refused credential and a healthy
       bMS both end with failed = false. Reachability travels on the verdict.

    3. A 401 IS AMBIGUOUS and has to stay ambiguous here. bConnect answers 401 for
       a route it does not recognise, so it means the credential OR the address.
       Saying either one alone would send an operator to fix the wrong thing.
#>
    param([bool] $Failed, $Tls, $Result)

    function HasProp($o, [string] $n) {
        return ($o -and ($o.PSObject.Properties.Name -contains $n))
    }
    $reached    = $(if (HasProp $Result 'reachable') { [bool]$Result.reachable } else { $true })
    $httpStatus = $(if (HasProp $Result 'httpStatus') { $Result.httpStatus } else { $null })
    $reason     = $(if (HasProp $Result 'reason') { [string]$Result.reason } else { '' })

    if (-not $Failed -and $reached) {
        return @{ Ok = $true; Text = 'bConnect answered. Nothing was written.' }
    }
    $text =
        if (-not $Failed -and $httpStatus -eq 401) {
            'bConnect answered HTTP 401. That means the credential is wrong OR the address is: bConnect answers 401 for a route it does not recognise. Check (dry run) on the Review page names the schemes the server accepts.'
        } elseif (-not $Failed -and $httpStatus) {
            "bConnect answered HTTP $httpStatus. Check (dry run) on the Review page carries the detail."
        } elseif (-not $Failed) {
            'bConnect did not answer at that address. Check (dry run) on the Review page carries the reason.'
        } elseif ($Tls -and -not $Tls.Ok) {
            $Tls.Headline + ' Check (dry run) on the Review page carries the rest.'
        } elseif ($reason) {
            $reason
        } else {
            'The run did not finish. Check (dry run) on the Review page carries the full output.'
        }
    return @{ Ok = $false; Text = $text }
}

function Get-BaseUrl {
    <#
        THE base URL, and the only reader of either box. Get-Answers, the
        navigation gate, the review summary and the equivalent console command
        all come through here, so the address shown, the address checked and the
        address installed cannot be three different things.
    #>
    if ($els.chkCustomUrl.IsChecked) { return $els.txtBaseUrl.Text.Trim() }
    return (Get-ComposedBaseUrl $els.txtServerFqdn.Text)
}

function Update-ComposedUrl {
    <# The line under the server box. It states the composed address rather than
       describing it: an operator who can see the URL does not have to be told
       the rule that produced it. #>
    if ($els.chkCustomUrl.IsChecked) {
        $u = $els.txtBaseUrl.Text.Trim()
        $els.lblComposedUrl.Text = if ($u) { "Advanced is set: $u will be used, and this name is not." }
                                   else    { 'Advanced is set but no address has been entered there yet.' }
        return
    }
    $u = Get-ComposedBaseUrl $els.txtServerFqdn.Text
    $els.lblComposedUrl.Text = if ($u) { "bConnect will be reached at  $u" }
                               else    { 'The bMS server: its fully qualified name, its hostname or its IP address. Prefer the name on its certificate, because an IP address is usually not on one. Example: bms.example.local' }
}

function Test-InstallLocation {
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyString()][string] $Path)
    $reasons = @()
    $p = $Path.Trim()
    if (-not $p) {
        return [pscustomobject]@{ Ok = $false; Path = $p; Reasons = @('No location is given.') }
    }
    $rooted = $false
    try { $rooted = [System.IO.Path]::IsPathRooted($p) } catch { $rooted = $false }
    if (-not $rooted) {
        $reasons += "$p is not a full path. Give a location that starts with a drive letter or a server name."
    }
    if ($p.IndexOfAny([System.IO.Path]::GetInvalidPathChars()) -ge 0) {
        $reasons += "$p contains a character Windows does not allow in a path."
    }
    if ($reasons.Count) {
        return [pscustomobject]@{ Ok = $false; Path = $p; Reasons = $reasons }
    }

    # MAX_PATH headroom, on the same arithmetic packaging\START-HERE.cmd uses.
    $needed = $p.TrimEnd('\').Length + $script:DeepestBundlePath + $script:PathMargin
    if ($needed -gt $script:MaxPath) {
        $reasons += ("$p is too deeply nested. It is $($p.TrimEnd('\').Length) characters, the deepest file in this " +
                     "product is $($script:DeepestBundlePath) characters below it, and Windows stops at " +
                     "$($script:MaxPath) -- exceeded by $($needed - $script:MaxPath). Choose a location nearer the " +
                     'root of a drive.')
    }

    # Free space. A UNC path or an unmapped drive has no answer, and that is said
    # rather than assumed either way.
    $qual = $null
    try { $qual = (Split-Path -Qualifier $p) -replace ':', '' } catch { $qual = $null }
    if (-not $qual) {
        $reasons += ("Free space at $p could not be checked: no local drive letter could be resolved for it. " +
                     "A clean install needs roughly 1.5 GB. Confirm it by hand, or choose a local drive.")
    } else {
        try {
            $free = [math]::Round((Get-PSDrive -Name $qual -ErrorAction Stop).Free / 1GB, 1)
            if ($free -lt $script:MinFreeGb) {
                $reasons += ("${qual}: has $free GB free and a clean install needs roughly 1.5 GB. " +
                             'Free space on that drive, or choose another one.')
            }
        } catch {
            $reasons += ("Free space on ${qual}: could not be read. A clean install needs roughly 1.5 GB.")
        }
    }

    # Write permission, probed against the nearest ancestor that exists, because the
    # location itself is usually about to be created.
    $anc = $p
    while ($anc -and -not (Test-Path -LiteralPath $anc)) {
        $parent = Split-Path -Parent $anc
        if ($parent -eq $anc) { break }
        $anc = $parent
    }
    if (-not $anc -or -not (Test-Path -LiteralPath $anc)) {
        $reasons += "Nothing on the way to $p exists, so it cannot be created from here."
    } else {
        $probe = Join-Path $anc ('.bconnect-write-probe-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        try {
            [System.IO.File]::WriteAllText($probe, '')
            Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
        } catch {
            $reasons += ("This account cannot write into $anc. Re-open the installer as administrator, " +
                         'or choose a location this account owns.')
        }
    }

    return [pscustomobject]@{ Ok = ($reasons.Count -eq 0); Path = $p; Reasons = $reasons }
}

# The secrets directory FOLLOWS the install location. It is a sibling rather than a
# child so that it survives a rebuild of the suite root, which is what the existing
# default already does; making it a second question would be the wrong kind of
# choice to put in front of somebody who only wanted to move the product.
function Get-DefaultSecretsDir {
    param([Parameter(Mandatory)][string] $SuiteRootPath)
    $parent = Split-Path -Parent $SuiteRootPath.TrimEnd('\')
    if (-not $parent) { return (Join-Path $SuiteRootPath 'secrets') }
    return (Join-Path $parent 'secrets')
}

function Set-SecretsToFollow {
    # Assigned through the flag so the TextChanged handler this raises does not read
    # it as the operator pinning the value.
    param([Parameter(Mandatory)][string] $SuiteRootPath)
    if ($script:SecretsPinned) { return }
    $script:SettingSecrets = $true
    try { $els.txtSecrets.Text = (Get-DefaultSecretsDir $SuiteRootPath) }
    finally { $script:SettingSecrets = $false }
}

function Update-InstallLocation {
    # A location that was typed but never applied does not survive leaving the editor.
    if ($els.locationEditor.Visibility -ne 'Visible') {
        if ($script:LocationApplied -and $els.txtSuite.Text -ne $script:LocationApplied) {
            $els.txtSuite.Text = $script:LocationApplied
        }
        if ($script:SecretsApplied -and $els.txtSecrets.Text -ne $script:SecretsApplied) {
            $script:SettingSecrets = $true
            try { $els.txtSecrets.Text = $script:SecretsApplied } finally { $script:SettingSecrets = $false }
        }
        $els.lblLocationProblem.Visibility = 'Collapsed'
    }
    $els.lblInstallLocation.Text = (Get-SuiteRoot)
}

function Confirm-InstallLocation {
    # What Change -> Use this location does. A location that fails is not applied:
    # the line keeps the value that worked, and the reason is stated against the one
    # that did not.
    $v = Test-InstallLocation -Path $els.txtSuite.Text
    if (-not $v.Ok) {
        $els.lblLocationProblem.Text = ($v.Reasons -join ' ')
        $els.lblLocationProblem.Visibility = 'Visible'
        return $false
    }
    $els.lblLocationProblem.Visibility = 'Collapsed'
    $els.locationEditor.Visibility = 'Collapsed'
    $script:LocationApplied = $els.txtSuite.Text
    $script:SecretsApplied  = $els.txtSecrets.Text
    Update-InstallLocation
    # Everything downstream of the location is re-answered against the new one: which
    # server packages are already built, what is on disk there, and the free-space
    # check in the banner.
    Build-ServerList
    Set-Preflight
    Build-RequirementBanner
    Build-Review
    return $true
}

# Four entries, not five. The run page is what pressing Install produces, not a
# step an operator navigates to, so it has no rail entry and the last step stays
# current while it runs.
# What a step has been ANSWERED as, for the line under its title. Empty until the
# step holds an answer, and the static blurb is used until then -- a rail that
# claims an answer the operator has not given would be worse than one that only
# describes the step.
function Get-RailSummary {
    param([int] $Step)
    switch ($Step) {
        $PG_CONNECT {
            $u = Get-BaseUrl
            if ($els.chkReuse.IsChecked) { return 'the credentials already on disk' }
            if ($u) { return ((ConvertTo-ServerHost $els.txtServerFqdn.Text) -replace '^$', $u) }
            return ''
        }
        $PG_CLIENTS {
            $sel = @(Get-SelectedHosts)
            if ($sel.Count -eq 0) { return '' }
            $names = @($script:HostRows | Where-Object { $_.Selected } | ForEach-Object { $_.Label })
            if ($names.Count -le 2) { return ($names -join ', ') }
            return ('{0} and {1} more' -f $names[0], ($names.Count - 1))
        }
        $PG_PERMS {
            $g = Get-WriteGate
            if ($g.Count -eq 0) { return 'read only' }
            return ('writes on {0} server(s)' -f $g.Count)
        }
        $PG_REVIEW { return (Split-Path -Leaf (Get-SuiteRoot)) }
    }
    return ''
}

# One group of write tools, as a fixed three-column grid rather than a wrap.
#
# Three columns, not "as many as fit": a checkbox that moves between runs, or
# between one server and the next, is one an operator has to re-find every time.
# The grid is built with explicit rows so every column starts at the same x.
function New-Toolgrid {
    param([string[]] $Tools, $Spec, [string] $Colour, [ref] $Sink)
    $cols = 3
    $g = New-Object System.Windows.Controls.Grid
    $g.Margin = (Thk 0 4 0 8)
    for ($c = 0; $c -lt $cols; $c++) {
        $cd = New-Object System.Windows.Controls.ColumnDefinition
        $cd.Width = [System.Windows.GridLength]::new(1, 'Star')
        $g.ColumnDefinitions.Add($cd)
    }
    $rows = [Math]::Ceiling($Tools.Count / [double]$cols)
    for ($r = 0; $r -lt $rows; $r++) {
        $rd = New-Object System.Windows.Controls.RowDefinition
        $rd.Height = [System.Windows.GridLength]::Auto
        $g.RowDefinitions.Add($rd)
    }
    for ($i = 0; $i -lt $Tools.Count; $i++) {
        $t  = $Tools[$i]
        $tc = New-Object System.Windows.Controls.CheckBox
        $tc.Content = $t
        $tc.FontSize = 12
        $tc.Margin = (Thk 0 3 14 3)
        $tc.Foreground = (Br $Colour)
        $tc.ToolTip = $t
        # The catalogue's own default. A destructive tool is not pre-ticked by it,
        # and this does not add one.
        $tc.IsChecked = ($Spec.allowlistDefault -contains $t)
        [System.Windows.Controls.Grid]::SetRow($tc, [int][Math]::Floor($i / $cols))
        [System.Windows.Controls.Grid]::SetColumn($tc, $i % $cols)
        [void]$g.Children.Add($tc)
        $Sink.Value += $tc
        $tc.Add_Checked({ Update-ConfirmBar }); $tc.Add_Unchecked({ Update-ConfirmBar })
    }
    return $g
}

function Build-Rail {
    $els.rail.Children.Clear()
    $here = [Math]::Min($script:Page, $script:StepCount - 1)
    # Everything before this is answered, so it is somewhere the operator may go
    # back to. Beyond it there is nothing to show yet, and jumping there would skip
    # a question the next page depends on.
    $reach = Get-FurthestReachableStep
    for ($i = 0; $i -lt $script:StepCount; $i++) {
        $bd = New-Object System.Windows.Controls.Border
        $bd.CornerRadius = (New-Object System.Windows.CornerRadius(8))
        $bd.Padding = (Thk 12 9 12 9); $bd.Margin = (Thk 0 0 0 4)
        $bd.Background = (Br $(if ($i -eq $here) { $C.Card2 } else { 'Transparent' }))
        if ($i -eq $here) { $bd.BorderBrush = (Br $C.Accent); $bd.BorderThickness = (Thk 3 0 0 0) }
        $sp = New-Object System.Windows.Controls.StackPanel
        $num = New-Line (('{0}.  ' -f ($i + 1)) + $PageTitles[$i]) $(if ($i -eq $here) { $C.Txt } elseif ($i -lt $here) { $C.Ok } else { $C.Faint }) 13.5 ($i -eq $here)
        [void]$sp.Children.Add($num)
        # The answer where there is one, the description of the step where there is
        # not. This turns the rail into a summary that is always on screen, instead
        # of four fixed sentences that say the same thing on every run.
        $summary = Get-RailSummary $i
        if ($summary) { [void]$sp.Children.Add((New-Line $summary $(if ($i -eq $here) { $C.Muted } else { $C.Ok }) 11)) }
        else          { [void]$sp.Children.Add((New-Line $PageBlurbs[$i] $C.Faint 11)) }
        $bd.Child = $sp

        # Clickable, but only backwards into answered ground. A rail that let an
        # operator jump to Review from step 1 would be offering a page built from
        # answers that do not exist yet; one that is live during a run would be
        # offering to change an answer the installer is already acting on.
        if ($i -ne $here -and $i -le $reach -and -not $script:Running) {
            $bd.Cursor = [System.Windows.Input.Cursors]::Hand
            $bd.Tag = $i
            $bd.ToolTip = 'Go back to this step'
            $bd.Add_MouseLeftButtonUp({
                param($src, $e)
                # $src.Tag, not a captured $i: the loop variable is long gone by the
                # time this runs, and every handler would carry the last value.
                $target = [int]$src.Tag
                if ($script:Running) { return }
                if ($target -gt (Get-FurthestReachableStep)) { return }
                $script:Page = $target
                Show-Page
            })
            # Only non-current rows get these, so there is no state to check: a
            # current row is never clickable and never reaches this branch.
            $bd.Add_MouseEnter({ param($src, $e) $src.Background = (Br $C.Card2) })
            $bd.Add_MouseLeave({ param($src, $e) $src.Background = (Br 'Transparent') })
        }
        [void]$els.rail.Children.Add($bd)
    }
}

# =============================================================================
# Server page
# =============================================================================
function Build-ServerList {
    $els.serverList.Children.Clear()
    $script:ServerRows = @()
    $suite = (Get-SuiteRoot)
    foreach ($s in $Catalog.servers) {
        $present = Test-Path (Join-Path $suite $s.dir)
        $card = New-Object System.Windows.Controls.Border
        $card.Background = (Br $C.Card); $card.BorderBrush = (Br $C.Border); $card.BorderThickness = (Thk 1 1 1 1)
        $card.CornerRadius = (New-Object System.Windows.CornerRadius(9))
        $card.Padding = (Thk 14 10 14 11); $card.Margin = (Thk 0 0 0 7)

        $g = New-Object System.Windows.Controls.Grid
        $c0 = New-Object System.Windows.Controls.ColumnDefinition; $c0.Width = [System.Windows.GridLength]::new(1, 'Star')
        $c1 = New-Object System.Windows.Controls.ColumnDefinition; $c1.Width = [System.Windows.GridLength]::new(150)
        $g.ColumnDefinitions.Add($c0); $g.ColumnDefinitions.Add($c1)

        $left = New-Object System.Windows.Controls.StackPanel
        $chk = New-Object System.Windows.Controls.CheckBox
        $chk.Content = $s.name; $chk.FontSize = 13.5; $chk.FontWeight = 'SemiBold'
        $chk.Foreground = (Br $C.Txt); $chk.IsChecked = [bool]$s.default; $chk.IsEnabled = $present
        $chk.Cursor = 'Hand'
        [void]$left.Children.Add($chk)
        $sum = New-Line $s.summary $C.Muted 12
        $sum.Margin = (Thk 22 3 0 0)
        [void]$left.Children.Add($sum)
        if (-not $present) {
            $miss = New-Line 'not on disk -- cannot be enabled' $C.Warn 11.5
            $miss.Margin = (Thk 22 3 0 0)
            [void]$left.Children.Add($miss)
            $chk.IsChecked = $false
        }
        if ($s.writeTools.Count -gt 0) {
            $w = New-Line ("$($s.writeTools.Count) write tool(s)" + $(if ($s.allowlist) { ', per-tool allowlist supported' } else { ', no per-tool allowlist' })) $C.Faint 11.5
            $w.Margin = (Thk 22 3 0 0)
            [void]$left.Children.Add($w)
        }

        $right = New-Object System.Windows.Controls.StackPanel
        $right.HorizontalAlignment = 'Right'
        $tok = New-Line '-' $C.Accent 15
        $tok.HorizontalAlignment = 'Right'
        $tokSub = New-Line 'tokens of schema' $C.Faint 10.5
        $tokSub.HorizontalAlignment = 'Right'
        [void]$right.Children.Add($tok); [void]$right.Children.Add($tokSub)
        [System.Windows.Controls.Grid]::SetColumn($right, 1)

        [void]$g.Children.Add($left); [void]$g.Children.Add($right)
        $card.Child = $g
        [void]$els.serverList.Children.Add($card)

        $chk.Add_Checked({ Update-Cost }); $chk.Add_Unchecked({ Update-Cost })
        $script:ServerRows += @{ Spec = $s; Check = $chk; Token = $tok; Present = $present }
    }
    Update-Cost
}

function Get-SelectedServers { return @($script:ServerRows | Where-Object { $_.Check.IsChecked } | ForEach-Object { $_.Spec.name }) }

function Update-Cost {
    $tools = 0; $bytes = 0; $unknown = $false; $n = 0
    foreach ($r in $script:ServerRows) {
        if (-not $r.Check.IsChecked) { continue }
        $n++
        $m = $script:Measured[$r.Spec.dir]
        if ($m) { $tools += [int]$m.Tools; $bytes += [int]$m.Bytes } else { $unknown = $true }
    }
    $txt = "$n server(s) selected"
    if ($n -gt 0) {
        if ($unknown -and $bytes -eq 0) { $txt += '  --  measuring tool schemas...' }
        else {
            $txt += ("  --  $tools tools, ~" + ([math]::Round($bytes / 4)).ToString('N0') + ' tokens of tool schema on every request, before you have typed anything')
            if ($unknown) { $txt += '  (some servers not measured)' }
        }
    }
    $els.lblCost.Text = $txt
    $els.lblCost.Foreground = (Br $(if ($bytes / 4 -gt 25000) { $C.Warn } else { $C.Txt }))
    # Selection is also a precondition for Next -- deselecting everything must
    # disable it. Without this the "None" button left Next live with nothing chosen
    # and the script would have been handed an empty -Servers.
    Update-Nav
}

# =============================================================================
# Host page -- which MCP clients get a configuration file.
#
# The rows come from lib\hosts.json through Get-HostSelectionCatalog and the
# parameters go back out through ConvertTo-HostInstallerParameters, both in
# lib\HostSelectionPage.ps1. Nothing here knows the name of a single client: adding
# one is a registry entry, and the window picks it up without being touched.
# =============================================================================
function Get-SelectedHosts {
    return @($script:HostRows | Where-Object { $_.Selected } | ForEach-Object { $_.Id })
}

function Reset-HostCatalog {
    # Rebuilt whenever a path that feeds a resolved destination changes, because the
    # row shows that destination and a stale one is a wrong answer on screen. The
    # ticks survive: they are re-applied through -Preselect.
    param([string[]] $Keep = @())
    # The deployment shape filters the list, in Select-ShapeTargets, from each
    # target's own `transport`. A selection carried over from the other answer simply
    # does not survive the rebuild -- the row is not there to re-tick -- which is the
    # behaviour that matters: an operator who changes the shape must not keep a
    # client the new shape cannot serve.
    $script:HostRows = @(Get-HostSelectionCatalog `
        -ProjectDir $els.ProjectDirBox.Text -HostOutDir $HostOutDir `
        -ConfigPath $els.ConfigPathBox.Text -Preselect $Keep -Shape (Get-DeploymentShape))
    $els.HostList.ItemsSource = $script:HostRows
}

function Update-HostPage {
    $sel  = Get-SelectedHosts
    $rows = @($script:HostRows | Where-Object { $sel -contains $_.Id })

    # What the shape answer did to this list, and which clients it left out, by name.
    # A shorter list with no explanation is read as a shorter product.
    $shapeNow = Get-DeploymentShape
    $shown    = @($script:HostRows | ForEach-Object { $_.Id })
    $left     = @(Get-HostSelectionCatalog -ProjectDir $els.ProjectDirBox.Text -HostOutDir $HostOutDir `
                      -ConfigPath $els.ConfigPathBox.Text |
                  Where-Object { $shown -notcontains $_.Id } | ForEach-Object { $_.Label })
    $els.ShapeNote.Text = (Get-ShapeDescription $shapeNow) + $(if ($left.Count) {
        ' Not listed, because that deployment cannot serve ' +
        $(if ($left.Count -eq 1) { 'it' } else { 'them' }) + ': ' + ($left -join ', ') +
        '. Change the deployment on the Connect page.'
    } else { '' })

    # Rule 1 of the page contract: an HTTP-only client cannot spawn a process, so
    # selecting one selects the gateway. The engine reaches the same conclusion from
    # the same registry field -- this is the UI agreeing with it, not deciding it.
    #
    # A shared-service deployment forces it for a second reason that does not depend
    # on any client at all: on that shape the gateway IS the product. Clients are on
    # other computers and have no other route in, so there is no selection that makes
    # a central install without one coherent.
    $shape  = Get-DeploymentShape
    $needGw = @($rows | Where-Object { $_.NeedsGateway })
    if ($needGw.Count -or $shape -eq 'central') {
        $els.GatewayWantedCheck.IsChecked = $true
        $els.GatewayWantedCheck.IsEnabled = $false
        $els.GatewayWantedCheck.Content = $(if ($needGw.Count) {
            'HTTP gateway -- required by ' + (($needGw | ForEach-Object { $_.Label }) -join ', ')
        } else {
            'HTTP gateway -- required by a shared-service deployment'
        })
        # Started and verified in this run, not left as a checkbox. The rule itself
        # lives in ConvertTo-HostInstallerParameters, which is what the installer is
        # actually handed; this only makes the box agree with it on screen.
        $els.StartGatewayCheck.IsChecked = $true
        $els.StartGatewayCheck.IsEnabled = $false
        $els.StartGatewayCheck.Content = 'Start and verify it now (required)'
    } else {
        # A tick this page forced on has to come off again when the client that
        # forced it does, or unticking n8n leaves a listening port behind that
        # nobody asked for. A tick the operator made themselves is left alone.
        if ($script:GatewayForced) {
            $els.GatewayWantedCheck.IsChecked = $false
            $els.StartGatewayCheck.IsChecked  = $false
        }
        $els.GatewayWantedCheck.IsEnabled = $true
        $els.GatewayWantedCheck.Content = 'Also run the HTTP gateway (for clients that cannot start a local process)'
        $els.StartGatewayCheck.IsEnabled = $true
        $els.StartGatewayCheck.Content = 'Start and verify it now'
    }
    $script:GatewayForced = [bool]($needGw.Count -or $shape -eq 'central')
    $els.GatewayPanel.Visibility = $(if ($els.GatewayWantedCheck.IsChecked) { 'Visible' } else { 'Collapsed' })
    # The whole section is on screen only where the gateway is actually a part of
    # this install: required by a client, required by the deployment, or asked for
    # under Advanced. A workstation install of a client that spawns a process has no
    # gateway decision in it, so it shows none.
    $els.GatewaySection.Visibility = $(if ($els.GatewayWantedCheck.IsChecked) { 'Visible' } else { 'Collapsed' })
    # The Advanced opt-in is an affordance for GatewayWantedCheck, not a second
    # answer, so it is kept agreeing with it -- and it is pointless once something
    # else has already forced the gateway on.
    $els.GatewayAdvanced.Visibility = $(if ($script:GatewayForced) { 'Collapsed' } else { 'Visible' })
    if ($script:GatewayForced -and $els.GatewayOptInCheck.IsChecked) { $els.GatewayOptInCheck.IsChecked = $false }

    $els.ImpracticalWarning.Visibility = $(if (@($rows | Where-Object { $_.Impractical }).Count) { 'Visible' } else { 'Collapsed' })

    # Chosen, but the directory that would hold the file is not on this machine. Not
    # blocked -- staging a client that is about to be installed is legitimate -- but
    # it is said plainly here rather than discovered as a file nothing ever reads.
    $missing = @($rows | Where-Object { -not $_.HereNow })
    if ($missing.Count) {
        $els.MissingHostText.Text = 'Not found on this machine: ' +
            (($missing | ForEach-Object { $_.Label }) -join ', ') +
            '. A configuration will still be written for ' +
            $(if ($missing.Count -eq 1) { 'it' } else { 'them' }) +
            ', and nothing will read it until that client is installed here. Untick ' +
            $(if ($missing.Count -eq 1) { 'it' } else { 'them' }) + ' unless you are staging ahead of an install.'
        $els.MissingHostWarning.Visibility = 'Visible'
    } else {
        $els.MissingHostWarning.Visibility = 'Collapsed'
    }

    # Per-project clients read their MCP configuration per workspace, so the default
    # -- the directory the suite was unpacked into -- is almost never the right answer.
    $perProject = @($rows | Where-Object { $_.PerProject })
    if ($perProject.Count) {
        $els.ProjectPathRow.Visibility = 'Visible'
        if (Test-ProjectDirIsInstallation -ProjectDir $els.ProjectDirBox.Text -InstallationRoots (Get-InstallationRoots)) {
            # Crit, not Warn, and Next is disabled while it is true. The engine
            # refuses this value outright, so amber text beside an enabled button
            # was the window promising something the run would not honour.
            $els.ProjectDirNote.Text = 'This is part of the installation, not a workspace anyone opens in an editor. ' +
                                       (($perProject | ForEach-Object { $_.Label }) -join ', ') +
                                       ' read their configuration from the folder open in the editor, so one written here would ' +
                                       'never be loaded. Enter the repository you actually work in, or untick ' +
                                       $(if ($perProject.Count -eq 1) { 'that client' } else { 'those clients' }) + '.'
            $els.ProjectDirNote.Foreground = (Br $C.Crit)
        } elseif (-not $els.ProjectDirBox.Text.Trim()) {
            $els.ProjectDirNote.Text = (($perProject | ForEach-Object { $_.Label }) -join ', ') +
                                       ' read their MCP configuration per workspace. Enter the repository you open in the editor.'
            $els.ProjectDirNote.Foreground = (Br $C.Muted)
        } else {
            $els.ProjectDirNote.Text = (($perProject | ForEach-Object { $_.Label }) -join ', ') +
                                       ' read their MCP configuration per workspace. This must be the repository you open in the editor.'
            $els.ProjectDirNote.Foreground = (Br $C.Muted)
        }
    } else {
        $els.ProjectPathRow.Visibility = 'Collapsed'
    }

    if ($sel -contains 'claude-desktop') {
        $els.ConfigPathRow.Visibility = 'Visible'
        $els.ConfigPathNote.Text = $(if ($els.ConfigPathBox.Text -eq $ClaudeDesktopDefault) {
            'This is the live Claude Desktop configuration. It is merged, never overwritten, and backed up first -- but to rehearse, point it at a copy.'
        } else { 'A copy, not the live file. Nothing Claude Desktop reads will change.' })
        $els.ConfigPathNote.Foreground = (Br $(if ($els.ConfigPathBox.Text -eq $ClaudeDesktopDefault) { $C.Warn } else { $C.Muted }))
    } else {
        $els.ConfigPathRow.Visibility = 'Collapsed'
    }

    if ($sel.Count -eq 0) {
        $els.HostSummaryText.Text = 'Nothing selected -- choose at least one client'
    } else {
        $tiers = @()
        foreach ($b in @('VERIFIED HERE', 'SERVERS STARTED', 'SHAPE ONLY')) {
            $n = @($rows | Where-Object { $_.Badge -eq $b }).Count
            if ($n) { $tiers += ("$n $($b.ToLower())") }
        }
        $els.HostSummaryText.Text = "$($sel.Count) client(s): " + ($tiers -join ', ')
    }
    Update-Nav
}

# =============================================================================
# Permissions -- the page the product owner says actually matters.
#
# Read only is the selected answer and needs no explanation on screen; choosing to
# allow changes is what reveals the per-server list of what that permits. Nothing
# about the write gate itself changed: it is still off in every server until it is
# turned on here, per server, and still needs the typed confirmation.
# =============================================================================
function Build-WriteList {
    $els.writeList.Children.Clear()
    $script:WriteRows = @()
    $selected = Get-SelectedServers
    $capable = @($Catalog.servers | Where-Object { $selected -contains $_.name -and $_.writeTools.Count -gt 0 })
    if ($capable.Count -eq 0) {
        [void]$els.writeList.Children.Add((New-Line 'None of the enabled servers has write tools, so this configuration is read-only by construction.' $C.Ok 12.5))
        Update-ConfirmBar
        return
    }
    foreach ($s in $capable) {
        $card = New-Object System.Windows.Controls.Border
        $card.Background = (Br $C.Card); $card.BorderBrush = (Br $C.Border); $card.BorderThickness = (Thk 1 1 1 1)
        $card.CornerRadius = (New-Object System.Windows.CornerRadius(9))
        $card.Padding = (Thk 16 12 16 13); $card.Margin = (Thk 0 0 0 9)
        $sp = New-Object System.Windows.Controls.StackPanel

        $chk = New-Object System.Windows.Controls.CheckBox
        $chk.Content = ("Enable writes in $($s.name)")
        $chk.FontSize = 13.5; $chk.FontWeight = 'SemiBold'; $chk.Foreground = (Br $C.Txt); $chk.Cursor = 'Hand'
        [void]$sp.Children.Add($chk)

        $toolChecks = @()
        $body = New-Object System.Windows.Controls.StackPanel
        $body.Margin = (Thk 22 8 0 0); $body.Visibility = 'Collapsed'

        if ($s.allowlist) {
            [void]$body.Children.Add((New-Line 'This server takes a per-tool allowlist. Tick only the tools that are wanted.' $C.Muted 12))

            # GROUPED BY WHAT THE TOOL DOES, IN A FIXED GRID.
            #
            # These were one WrapPanel: the tools arrived in catalogue order and wrapped
            # wherever the width ran out, so the columns were ragged and, worse,
            # deletejob_instance sat looking exactly like createjob_instance. A
            # destructive tick that is visually identical to a harmless one is a
            # presentation choice with a consequence.
            #
            # Verb first, then name, so the same tool lands in the same place every
            # run; three fixed columns so the grid is a grid; and the destructive
            # group last, in red, with nothing pre-ticked in it.
            $groups = [ordered]@{
                'Create'          = @{ Match = '^create';                       Colour = $C.Txt  }
                'Start and stop'  = @{ Match = '^(start|stop|resume)';          Colour = $C.Txt  }
                'Assign'          = @{ Match = '^assign';                       Colour = $C.Txt  }
                'Change'          = @{ Match = '^(update|set|modify|rename)';   Colour = $C.Txt  }
                'Delete'          = @{ Match = '^(delete|remove|withdraw)';     Colour = $C.Crit }
            }
            $placed = @()
            foreach ($gname in @($groups.Keys)) {
                $spec  = $groups[$gname]
                $tools = @($s.writeTools | Where-Object { $_ -match $spec.Match } | Sort-Object)
                if (-not $tools.Count) { continue }
                $placed += $tools
                [void]$body.Children.Add((New-Line $gname $spec.Colour 11.5 $true))
                [void]$body.Children.Add((New-Toolgrid -Tools $tools -Spec $s -Colour $spec.Colour -Sink ([ref]$toolChecks)))
            }
            # Anything the verbs above did not claim. Without this a tool named in a
            # way nobody anticipated would vanish from the page while still being in
            # the allowlist -- a control that silently stops existing.
            $rest = @($s.writeTools | Where-Object { $placed -notcontains $_ } | Sort-Object)
            if ($rest.Count) {
                [void]$body.Children.Add((New-Line 'Other' $C.Txt 11.5 $true))
                [void]$body.Children.Add((New-Toolgrid -Tools $rest -Spec $s -Colour $C.Txt -Sink ([ref]$toolChecks)))
            }
        } else {
            $warn = New-Object System.Windows.Controls.Border
            $warn.Background = (Br $C.WarnBg); $warn.BorderBrush = (Br $C.Warn); $warn.BorderThickness = (Thk 1 1 1 1)
            $warn.CornerRadius = (New-Object System.Windows.CornerRadius(7)); $warn.Padding = (Thk 12 9 12 10)
            $ws = New-Object System.Windows.Controls.StackPanel
            [void]$ws.Children.Add((New-Line "This server has no per-tool allowlist: all $($s.writeTools.Count) of its write tools are unlocked together." $C.Warn 12))
            $dels = @($s.writeTools | Where-Object { $_ -like 'delete_*' } | Select-Object -First 4)
            if ($dels.Count) { [void]$ws.Children.Add((New-Line ('Including: ' + ($dels -join ', ')) $C.Warn 12)) }
            $warn.Child = $ws
            [void]$body.Children.Add($warn)
        }
        [void]$sp.Children.Add($body)
        $card.Child = $sp
        [void]$els.writeList.Children.Add($card)

        $row = @{ Spec = $s; Check = $chk; Body = $body; ToolChecks = $toolChecks }
        $chk | Add-Member -NotePropertyName Body -NotePropertyValue $body
        $chk.Add_Checked({ $this.Body.Visibility = 'Visible'; Update-ConfirmBar })
        $chk.Add_Unchecked({ $this.Body.Visibility = 'Collapsed'; Update-ConfirmBar })
        $script:WriteRows += $row
    }
    Update-ConfirmBar
}

function Get-WriteGate {
    # name -> string[] of allowed tools, or @('*') for "all write tools in this server".
    #
    # "Read only" is not a display state: it is the answer, and it returns an empty
    # gate whatever is ticked underneath. An operator who explores the per-server
    # list, changes their mind and goes back to read only must get a read-only
    # install, not the ticks they left behind.
    $gate = @{}
    if (-not $els.rbAllowChanges.IsChecked) { return $gate }
    foreach ($r in $script:WriteRows) {
        if (-not $r.Check.IsChecked) { continue }
        if ($r.Spec.allowlist) {
            $picked = @($r.ToolChecks | Where-Object { $_.IsChecked } | ForEach-Object { [string]$_.Content })
            if ($picked.Count) { $gate[$r.Spec.name] = $picked }
        } else {
            $gate[$r.Spec.name] = @('*')
        }
    }
    return $gate
}

function Update-ConfirmBar {
    # The list of what may be changed belongs to the "allow changes" answer and is
    # revealed by it, so a page that has not been asked the question does not show
    # the consequences of an answer nobody gave.
    $els.writeList.Visibility = $(if ($els.rbAllowChanges.IsChecked) { 'Visible' } else { 'Collapsed' })
    $gate = Get-WriteGate
    if ($gate.Count -eq 0) {
        $els.confirmBar.Visibility = 'Collapsed'
    } else {
        $parts = @()
        foreach ($k in ($gate.Keys | Sort-Object)) {
            $v = $gate[$k]
            if ($v -contains '*') {
                $spec = $Catalog.servers | Where-Object { $_.name -eq $k }
                $parts += ("$k -- ALL $($spec.writeTools.Count) write tools")
            } else {
                $parts += ("$k -- " + ($v -join ', '))
            }
        }
        $els.lblConfirmWhat.Text = 'About to permit writes: ' + ($parts -join ' | ')
        $els.confirmBar.Visibility = 'Visible'
    }
    Update-Nav
}

function Test-WriteConfirmed {
    $gate = Get-WriteGate
    if ($gate.Count -eq 0) { return $true }
    return ($els.txtConfirm.Text -ceq 'ENABLE WRITES')
}

# =============================================================================
# Review page
# =============================================================================
function Get-HostSelection {
    # The whole translation from "these boxes are ticked" to "these parameters",
    # done once, in lib\HostSelectionPage.ps1, so the window and a console -Hosts run
    # cannot mean different things by the same selection. $null while nothing is
    # chosen: the installer's own defaults then apply, which is what -VerifyOnly from
    # the first page wants.
    $sel = Get-SelectedHosts
    if (-not $sel.Count) { return $null }
    $port = 3001
    [void][int]::TryParse($els.GatewayPortBox.Text, [ref]$port)
    return (ConvertTo-HostInstallerParameters -Selected $sel `
                -ProjectDir $els.ProjectDirBox.Text -HostOutDir $HostOutDir `
                -ConfigPath $els.ConfigPathBox.Text `
                -Gateway:([bool]$els.GatewayWantedCheck.IsChecked) `
                -GatewayBind $els.GatewayBindBox.Text -GatewayPort $port `
                -GatewayIUnderstandThereIsNoAuth:([bool]$els.GatewayNoAuthCheck.IsChecked) `
                -RotateGatewayToken:([bool]$els.GatewayRotateTokenCheck.IsChecked) `
                -StartGateway:([bool]$els.StartGatewayCheck.IsChecked))
}

function Get-Answers {
    $store = Get-CredentialStoreState -EnvFile (Join-Path (Get-SecretsDir) 'bconnect.env')
    return [pscustomobject]@{
        Shape       = (Get-DeploymentShape)
        SuiteRoot   = (Get-SuiteRoot)
        SecretsDir  = (Get-SecretsDir)
        Hosts       = (Get-SelectedHosts)
        HostParams  = (Get-HostSelection)
        Reuse       = [bool]$els.chkReuse.IsChecked
        BaseUrl     = (Get-BaseUrl)
        UseApiKey   = [bool]$els.rbApiKey.IsChecked
        BasicUser   = $els.txtBasicUser.Text.Trim()
        V11         = [bool]$els.chkV11.IsChecked
        V11User     = $els.txtV11User.Text.Trim()
        CaCert      = $els.txtCaCert.Text.Trim()
        ContinueUnreachable = [bool]$els.chkContinueUnreachable.IsChecked
        Protect     = [bool]$els.rbProtect.IsChecked
        Servers     = (Get-SelectedServers)
        WriteGate   = (Get-WriteGate)
        StoreNow    = $store.Mode
    }
}

function Build-Review {
    $a = Get-Answers
    $els.reviewList.Children.Clear()
    function AddKv($k, $v, $color = $null) {
        $g = New-Object System.Windows.Controls.Grid
        $g.Margin = (Thk 0 4 0 4)
        $c0 = New-Object System.Windows.Controls.ColumnDefinition; $c0.Width = [System.Windows.GridLength]::new(190)
        $c1 = New-Object System.Windows.Controls.ColumnDefinition; $c1.Width = [System.Windows.GridLength]::new(1, 'Star')
        $g.ColumnDefinitions.Add($c0); $g.ColumnDefinitions.Add($c1)
        $lt = New-Line $k $C.Muted 12.5
        $vt = New-Line $v $(if ($color) { $color } else { $C.Txt }) 12.5
        [System.Windows.Controls.Grid]::SetColumn($vt, 1)
        [void]$g.Children.Add($lt); [void]$g.Children.Add($vt)
        [void]$els.reviewList.Children.Add($g)
    }
    # NOT the suite root: that is the install-location line above this card, with its
    # own Change. Restating it here would be two places on one page saying where the
    # product goes, and eventually saying it differently.
    AddKv 'deployment'   (Get-ShapeDescription $a.Shape)
    # Both chips from the Clients page, in the same order, so the review says the same
    # thing the list said: whether this run configures the client, and how far that
    # target was verified.
    foreach ($h in @($script:HostRows | Where-Object { $a.Hosts -contains $_.Id })) {
        AddKv ('client: ' + $h.Label) ($h.SetupBadge + '   ' + $h.Badge + '   ' + $h.Path) `
              $(if (-not $h.HereNow) { $C.Warn } elseif ($h.Verification -eq 'schema-only') { $C.Warn } else { $C.Txt })
    }
    if ($a.HostParams -and $a.HostParams.Manual.Count) {
        $manLabels = @($script:HostRows | Where-Object { $a.HostParams.Manual -contains $_.Id } | ForEach-Object { $_.Label })
        AddKv 'to apply by hand' (($manLabels -join ', ') +
              ' -- the installer writes the settings to a file; they are applied in each product''s own interface.') $C.Warn
    }
    if ($a.HostParams -and $a.HostParams.Parameters.ContainsKey('Gateway')) {
        AddKv 'HTTP gateway' ($a.HostParams.GatewayUrl +
                              ', bearer token generated' +
                              $(if ($a.HostParams.Parameters.ContainsKey('StartGateway')) { ', started and verified in this run' } else { ', not started' }) +
                              $(if ($a.HostParams.Parameters.ContainsKey('RotateGatewayToken')) { ' (token rotated)' } else { '' }))
    }
    AddKv 'credentials'  $(if ($a.Reuse) { "kept as they are (currently $($a.StoreNow))" } elseif ($a.UseApiKey) { 'new API key' } else { "new Basic credentials for $($a.BasicUser)" })
    AddKv 'stored as'    $(if ($a.Protect) { 'DPAPI-protected, launched through the shim' } else { 'plaintext, directory ACL only' }) $(if ($a.Protect) { $C.Ok } else { $C.Txt })
    AddKv 'secrets in'   $a.SecretsDir
    AddKv 'base URL'     $(if ($a.Reuse) { '(unchanged)' } else { $a.BaseUrl })
    AddKv 'servers'      ($a.Servers -join ', ')
    if ($a.ContinueUnreachable) { AddKv 'if bConnect is silent' 'install anyway' $C.Warn }
    if ($a.WriteGate.Count -eq 0) {
        AddKv 'write gate' 'read-only everywhere' $C.Ok
    } else {
        foreach ($k in ($a.WriteGate.Keys | Sort-Object)) {
            $v = $a.WriteGate[$k]
            if ($v -contains '*') {
                $spec = $Catalog.servers | Where-Object { $_.name -eq $k }
                AddKv "writes: $k" ("ALL $($spec.writeTools.Count) write tools") $C.Crit
            } else {
                AddKv "writes: $k" (($v -join ', ')) $C.Warn
            }
        }
    }

    # The one-line honesty statement the console run prints. A selection that
    # includes a schema-only target has been shape-checked and nothing more, and the
    # review page is the last place that can still say so.
    $notes = @()
    if ($a.HostParams) {
        if ($a.HostParams.SchemaOnly.Count) {
            $notes += ('"SHAPE ONLY" (' + ($a.HostParams.SchemaOnly -join ', ') + ') means the file matches the shape that host documents and every credential stayed out of it -- and that nothing on this machine has ever seen that host read it. Treat it as a well-founded starting point, not a tested integration.')
        }
        if ($a.HostParams.MissingHere.Count) {
            $notes += ('Not installed on this machine: ' + ($a.HostParams.MissingHere -join ', ') + '. The file is still written; nothing will read it until that client is here.')
        }
    }
    if ($notes.Count) {
        $els.lblHostHonesty.Text = ($notes -join "`n`n")
        $els.hostHonesty.Visibility = 'Visible'
    } else {
        $els.hostHonesty.Visibility = 'Collapsed'
    }
    $els.txtEquivalent.Text = (Get-EquivalentCommand $a)
}

function Get-EquivalentCommand($a) {
    $p = New-Object System.Collections.ArrayList
    [void]$p.Add('.\Install-BConnectMcp.ps1')
    [void]$p.Add('-NonInteractive')
    [void]$p.Add("-SuiteRoot `"$($a.SuiteRoot)`"")
    [void]$p.Add("-SecretsDir `"$($a.SecretsDir)`"")
    [void]$p.Add("-Servers $($a.Servers -join ',')")
    if ($SkipBuild) { [void]$p.Add('-SkipBuild') }
    # The host half of the line comes from the same function that builds the host
    # half of the splat, so the command shown and the run performed cannot diverge.
    if ($a.HostParams) { [void]$p.Add(($a.HostParams.ConsoleCommand -replace '^\.\\Install-BConnectMcp\.ps1 ', '')) }
    if ($a.ContinueUnreachable) { [void]$p.Add('-ContinueOnUnreachable') }
    if ($a.Reuse) { [void]$p.Add('-ReuseCredentials') } else { [void]$p.Add("-BaseUrl `"$($a.BaseUrl)`" -ApiKeySecure <SecureString, passed in process>") }
    [void]$p.Add($(if ($a.Protect) { '-ProtectCredentials' } else { '-PlaintextCredentials' }))
    if ($a.WriteGate.Count -eq 0) {
        [void]$p.Add('-ReadOnly')
    } else {
        $bits = @()
        foreach ($k in ($a.WriteGate.Keys | Sort-Object)) { $bits += ("'{0}'=@('{1}')" -f $k, (($a.WriteGate[$k]) -join "','")) }
        [void]$p.Add('-WriteGate @{' + ($bits -join '; ') + '}')
    }
    # Backtick + newline is PowerShell's line continuation. Built from a char code so
    # the backtick is not itself interpreted as an escape while building this string.
    $sep = '  ' + [char]0x60 + "`r`n    "
    return ($p -join $sep)
}

# =============================================================================
# Running the installer -- a private runspace polled by a DispatcherTimer.
# =============================================================================
# The whole run as plain text. Separate from the click handler so a guard can
# assert what WOULD be copied without touching the clipboard -- a test that sets
# the clipboard would trample whatever the person running it had in there.
function Get-ConsoleText {
    $doc = $els.conScroll.Document
    $range = New-Object System.Windows.Documents.TextRange($doc.ContentStart, $doc.ContentEnd)
    return $range.Text
}

function Copy-ConsoleText {
    $t = Get-ConsoleText
    if (-not $t.Trim()) { return $false }
    # Set-Clipboard is not on PowerShell 5.1's default surface in every host, and the
    # WPF clipboard is already loaded here. -Text overload only: the pane holds no
    # formatting worth carrying into a ticket or an e-mail.
    try { [System.Windows.Clipboard]::SetText($t) } catch { return $false }
    return $true
}

function Append-Console($text, $color) {
    $r = New-Object System.Windows.Documents.Run
    $r.Text = $text + "`n"
    if ($color) { $r.Foreground = (Br $color) }
    [void]$els.console.Inlines.Add($r)
    # Keep the pane pinned to the tail; a run is minutes long and the interesting
    # line is always the last one.
    $els.conScroll.ScrollToEnd()
}

# Mapped from $Con (the console pane's own dark palette), not $C -- the light chrome
# colours would not have the contrast this dark backdrop needs. See $Con above.
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
        $dot.Width = 9; $dot.Height = 9; $dot.VerticalAlignment = 'Center'; $dot.Margin = (Thk 0 0 11 0)
        $tb = New-Line '' $C.Txt 13
        [void]$sp.Children.Add($dot); [void]$sp.Children.Add($tb)
        $bd.Child = $sp
        [void]$els.stepList.Children.Add($bd)
        $script:StepBlocks[$n] = @{ Border = $bd; Dot = $dot; Text = $tb; Title = $title }
    }
    $b = $script:StepBlocks[$n]
    # The title is kept beside the control rather than parsed back out of it. Reading
    # a label to find out what it said is how a display bug becomes a logic bug.
    if ($title) { $b.Title = $title }
    $b.Text.Text = ('{0}.  {1}' -f $n, $b.Title)
    switch ($state) {
        'running' { $b.Dot.Fill = (Br $C.Accent); $b.Border.Background = (Br $C.Card2); $b.Text.Foreground = (Br $C.Txt); $b.Text.FontWeight = 'SemiBold' }
        'done'    { $b.Dot.Fill = (Br $C.Ok);     $b.Border.Background = (Br 'Transparent'); $b.Text.Foreground = (Br $C.Muted); $b.Text.FontWeight = 'Normal' }
        'warn'    { $b.Dot.Fill = (Br $C.Warn);   $b.Text.Foreground = (Br $C.Warn) }
        'fail'    { $b.Dot.Fill = (Br $C.Crit);   $b.Border.Background = (Br $C.CritBg); $b.Text.Foreground = (Br $C.Crit); $b.Text.FontWeight = 'SemiBold' }
    }
}

# The exact parameter set a run of $kind would be given, built without dispatching
# anything. Separate from Start-Installer so the mapping from wizard answers to
# installer parameters can be asserted directly -- an installer that is handed the
# wrong parameters fails in ways no amount of looking at the window would reveal.
function New-InstallerParameters($kind) {
    $a = Get-Answers
    $params = @{
        NonInteractive = $true
        EmitProgress   = $true
        SuiteRoot      = $a.SuiteRoot
        SecretsDir     = $a.SecretsDir
    }
    # Set for every kind, including verify and the dry runs, so the command echoed
    # on the run page is the command that ran. The engine tests -SkipBuild before
    # -DryRun in its build step, so a dry run reports "skipped (-SkipBuild)" rather
    # than "would run: npm ci" -- which is the truth on a bundle that ships built.
    if ($SkipBuild) { $params['SkipBuild'] = $true }
    # Hosts, ProjectDir, HostOutDir, the gateway switches, and -ConfigPath if and
    # only if Claude Desktop is one of the chosen clients. Absent a selection this
    # adds nothing and the installer applies its own defaults, which is what a
    # verify-only run from the first page needs.
    if ($a.HostParams) {
        foreach ($k in $a.HostParams.Parameters.Keys) { $params[$k] = $a.HostParams.Parameters[$k] }
    }
    if ($kind -eq 'verify') {
        $params['VerifyOnly'] = $true
        return $params
    }
    # A dry run always continues past an unreachable bConnect -- it writes nothing,
    # and stopping there would hide the rest of what the check has to say.
    #
    # 'test' is the Connect page's button and is the SAME RUN: -DryRun against the
    # real engine. Only where the verdict is drawn differs, so there is one
    # implementation of "check this without writing anything" and the two cannot
    # come to mean different things.
    if ($kind -eq 'dryrun' -or $kind -eq 'test') { $params['DryRun'] = $true; $params['ContinueOnUnreachable'] = $true }
    elseif ($a.ContinueUnreachable) { $params['ContinueOnUnreachable'] = $true }
    $params['Servers'] = ($a.Servers -join ',')
    $params[$(if ($a.Protect) { 'ProtectCredentials' } else { 'PlaintextCredentials' })] = $true
    if ($a.Reuse) {
        $params['ReuseCredentials'] = $true
    } else {
        $params['BaseUrl'] = $a.BaseUrl
        if ($a.UseApiKey) {
            $params['ApiKeySecure'] = $els.pwApiKey.SecurePassword
            # Only the boxes actually filled in travel. An empty box means "use
            # the key above", so sending it as an empty value would write a
            # variable that overrides the shared key with nothing.
            $perServer = @{}
            foreach ($entry in $script:PerServerKeyBoxes.GetEnumerator()) {
                if ($entry.Value.SecurePassword.Length -gt 0) {
                    $perServer[$entry.Key] = $entry.Value.SecurePassword
                }
            }
            if ($perServer.Count) { $params['PerServerApiKeysSecure'] = $perServer }
        } else {
            $params['BasicUser'] = $a.BasicUser
            $params['BasicPassSecure'] = $els.pwBasic.SecurePassword
        }
        if ($a.V11 -and $a.V11User) {
            $params['V11User'] = $a.V11User
            $params['V11PassSecure'] = $els.pwV11.SecurePassword
        }
        if ($a.CaCert) { $params['CaCert'] = $a.CaCert }
    }
    if ($a.WriteGate.Count) { $params['WriteGate'] = $a.WriteGate } else { $params['ReadOnly'] = $true }
    return $params
}

function Start-Installer($kind) {
    if ($script:Running) { return }
    $script:RunKind = $kind
    $script:Running = $true
    $script:LastResult = $null
    $script:GatewayTokenResult = $null
    $script:TlsResult  = $null
    $els.tlsPanel.Children.Clear()
    $els.tlsPanel.Visibility = 'Collapsed'
    $script:InfoCursor = 0
    $script:StepBlocks = @{}
    $els.stepList.Children.Clear()
    $els.console.Inlines.Clear()
    # A test stays where the URL and the key were typed. Everything else takes the
    # operator to the run page, because everything else IS the run.
    if ($kind -eq 'test') {
        $els.lblTestResult.Text = 'Calling bConnect. Nothing is written.'
        $els.lblTestResult.Foreground = (Br $C.Muted)
    } else {
        $script:Page = $PG_RUN
        Show-Page
    }
    $els.lblRunTitle.Text = switch ($kind) { 'dryrun' { 'Checking' } 'test' { 'Checking' } 'verify' { 'Verifying' } default { 'Installing' } }
    $els.lblRunSub.Text = switch ($kind) {
        'dryrun' { 'Install-BConnectMcp.ps1 -DryRun. Nothing is written: no credentials file, no configuration change, no build.' }
        'test'   { 'Install-BConnectMcp.ps1 -DryRun. Nothing is written: no credentials file, no configuration change, no build.' }
        'verify' { 'Install-BConnectMcp.ps1 -VerifyOnly. Starts every configured server the way your MCP client will and makes a real read call.' }
        default  {
            if ($SkipBuild) { 'Install-BConnectMcp.ps1 is doing the work. This package ships already built, so nothing is compiled here.' }
            else { "Install-BConnectMcp.ps1 is doing the work. Building the $($Catalog.servers.Count) server packages takes a few minutes on a first run." }
        }
    }

    $params = New-InstallerParameters $kind

    # --- dispatch on a private runspace ------------------------------------
    # A SecureString goes in as a parameter object. It never becomes text, never
    # reaches a command line, and never leaves this process.
    $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
    $script:Runspace = [runspacefactory]::CreateRunspace($iss)
    $script:Runspace.ApartmentState = 'STA'
    $script:Runspace.ThreadOptions  = 'ReuseThread'
    $script:Runspace.Open()
    $script:Ps = [powershell]::Create()
    $script:Ps.Runspace = $script:Runspace
    [void]$script:Ps.AddCommand($InstallerPath)
    foreach ($k in $params.Keys) { [void]$script:Ps.AddParameter($k, $params[$k]) }
    $script:Handle = $script:Ps.BeginInvoke()

    Append-Console ('> ' + (Split-Path -Leaf $InstallerPath) + ' ' + (($params.Keys | Sort-Object | ForEach-Object {
        if ($params[$_] -is [System.Security.SecureString]) { "-$_ <SecureString>" }
        elseif ($params[$_] -is [bool] -or $params[$_] -is [switch]) { "-$_" }
        elseif ($params[$_] -is [hashtable]) { "-$_ {...}" }
        else { "-$_ $($params[$_])" } }) -join ' ')) $Con.Faint
    Append-Console '' $null

    # The tick handler cannot see these locals once this function returns, so they
    # travel on the timer itself and are read back through $this. (bPerfMon,
    # Start-Rs2Async: a plain scriptblock passed to Add_Tick does not close over them,
    # and the failure is silent -- the work runs and is never harvested.)
    $timer = New-Object System.Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(120)
    $timer | Add-Member -NotePropertyName Started -NotePropertyValue (Get-Date)
    $timer.Add_Tick({
        $els.lblElapsed.Text = ('{0:mm\:ss}' -f ((Get-Date) - $this.Started))

        # Drain whatever the script has printed since the last tick. Write-Host in 5.1
        # is an InformationRecord tagged PSHOST, so this is the script's real output,
        # in order, with its colours -- not a reimplementation of it.
        $info = $script:Ps.Streams.Information
        while ($script:InfoCursor -lt $info.Count) {
            $rec = $info[$script:InfoCursor]
            $script:InfoCursor++
            if ($rec.Tags -contains 'bconnect.progress') {
                $d = $rec.MessageData
                switch ($d.kind) {
                    'step' {
                        # Whatever step was running is finished the moment a new one
                        # starts. The number and title both come from the script, so a
                        # step added there appears here without changing this file.
                        foreach ($k in @($script:StepBlocks.Keys)) {
                            if ($k -lt $d.step) { Set-StepState $k $null 'done' }
                        }
                        Set-StepState $d.step $d.title 'running'
                    }
                    'warn' { if ($script:StepBlocks.ContainsKey($d.step)) { $script:StepBlocks[$d.step].Dot.Fill = (Br $C.Warn) } }
                    'fail' { if ($script:StepBlocks.ContainsKey($d.step)) { $script:StepBlocks[$d.step].Dot.Fill = (Br $C.Crit) } }
                    # SEC-7 -- the gateway's bearer token. Held, not printed here:
                    # Finish-Run puts it at the BOTTOM of the console, which is
                    # where the operator is looking when the run ends. Printed
                    # mid-run it scrolls away under the verification output and
                    # the operator goes looking for a way to turn auth off.
                    'gateway-token' { $script:GatewayTokenResult = $d }
                    # The certificate verdict, rendered the moment it arrives rather
                    # than at the end. It comes out of Step 4; a first install then
                    # prints several hundred lines of npm output over it, and the
                    # operator who scrolls back for it has already been told the run
                    # failed for a reason they could not see.
                    'tls' { $script:TlsResult = $d; Build-TlsPanel }
                    'done' { $script:LastResult = $d }
                }
                continue
            }
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
        try { [void]$script:Ps.EndInvoke($script:Handle) } catch { $ex = $_.Exception.Message }
        foreach ($e in $script:Ps.Streams.Error) { Append-Console ('ERROR: ' + $e.ToString()) $Con.Crit }
        try { $script:Ps.Dispose() } catch { }
        try { $script:Runspace.Close(); $script:Runspace.Dispose() } catch { }
        $script:Ps = $null; $script:Handle = $null; $script:Runspace = $null
        $script:Running = $false

        # Mark the last started step by whatever the run actually reported.
        $lastStep = ($script:StepBlocks.Keys | Sort-Object | Select-Object -Last 1)
        # No 'done' record at all means the script died before it could report -- an
        # unhandled exception, or a kill. That is a failure, not an unknown.
        $failed = $true
        if ($script:LastResult) { $failed = [bool]$script:LastResult.failed }
        if ($ex) { $failed = $true; Append-Console ('ERROR: ' + $ex) $Con.Crit }
        if ($lastStep) { Set-StepState $lastStep $null $(if ($failed) { 'fail' } else { 'done' }) }
        Finish-Run $failed
    })
    $script:RunTimer = $timer
    $timer.Start()
    Update-Nav
}

# =============================================================================
# The completion summary.
#
# It has to stand on its own: what was installed and where, which clients this run
# configured, which ones were handed settings instead and where those settings are,
# and exactly what has to be restarted -- named from lib\hosts.json, never "your MCP
# client". Built as sections so the rendered panel, the console tail and
# lib\Test-WizardPrep.ps1 all read the same description of what the run did.
#
# Automatic and manual come off the row objects, which get it from the target's
# mode. Verification tier is a different question and is deliberately not reused as
# a stand-in for it: generic is config-spawn AND a snippet, and the old text that
# keyed off schema-only told the operator to restart it.
# =============================================================================
function Get-CompletionSummary {
    $a    = Get-Answers
    $sel  = Get-SelectedHosts
    $rows = @($script:HostRows | Where-Object { $sel -contains $_.Id })
    $auto = @($rows | Where-Object { $_.Setup -eq 'automatic' })
    $man  = @($rows | Where-Object { $_.Setup -eq 'manual' })
    $sections = @()

    $installed = @(
        (Get-ShapeDescription $a.Shape)
        'Servers enabled: ' + $(if ($a.Servers.Count) { $a.Servers -join ', ' } else { 'none' }) + '.'
        'Suite root: ' + $a.SuiteRoot
        'Credentials: ' + $(if ($a.Protect) { 'DPAPI-encrypted for this Windows account' } else { 'plaintext, protected by the directory ACL' }) +
            ', in ' + $a.SecretsDir
    )
    if ($a.WriteGate.Count -eq 0) {
        $installed += 'Write access: none. Every enabled server is read-only.'
    } else {
        foreach ($k in ($a.WriteGate.Keys | Sort-Object)) {
            $v = $a.WriteGate[$k]
            if ($v -contains '*') {
                $spec = $Catalog.servers | Where-Object { $_.name -eq $k }
                $installed += "Write access: $k, all $($spec.writeTools.Count) write tools."
            } else {
                $installed += "Write access: $k, limited to " + ($v -join ', ') + '.'
            }
        }
        $installed += 'Write access permits those servers to create, modify and delete objects in the management suite. The bMS rights of the API key are the boundary underneath it.'
    }
    $sections += [pscustomobject]@{ Key = 'installed'; Heading = 'What was installed'; Lines = $installed }

    if ($auto.Count) {
        $sections += [pscustomobject]@{
            Key = 'automatic'; Heading = 'Configured by the installer'
            Lines = @($auto | ForEach-Object { "$($_.Label): $($_.Path)" })
        }
    }
    if ($man.Count) {
        $lines = @($man | ForEach-Object { "$($_.Label): settings written to $($_.Path)" })
        $lines += 'The installer cannot write these clients'' configuration. Open each file and apply the settings in that product''s own interface. Until that is done, nothing has changed for those clients.'
        # For the HTTP clients the manual step is now two fields, because the run
        # that produced this summary already configured, started and verified the
        # service they point at. Say so here rather than leaving the operator to
        # infer it from a gateway section further down.
        if (@($man | Where-Object { $_.NeedsGateway }).Count) {
            $lines += 'For ' + (($man | Where-Object { $_.NeedsGateway } | ForEach-Object { $_.Label }) -join ', ') +
                      ' that is two values: the URL and the Authorization header, both under "HTTP gateway" below. The service they address is already running.'
        }
        $sections += [pscustomobject]@{ Key = 'manual'; Heading = 'Settings to apply by hand'; Lines = $lines }
    }
    if ($auto.Count) {
        $lines = @()
        foreach ($r in $auto) {
            if ($r.Id -eq 'claude-desktop') {
                $lines += "$($r.Label): quit it from the tray icon (Quit), not by closing the window, then start it again. It keeps running in the tray."
            } else {
                $lines += "$($r.Label): close it and start it again."
            }
        }
        $lines += 'Each of these reads its MCP configuration when it starts. Nothing in this run proves a client has loaded the file; only its own restart does.'
        $sections += [pscustomobject]@{ Key = 'restart'; Heading = 'Restart before the tools appear'; Lines = $lines }
    }
    # The gateway, stated as the two values a person types into another product. The
    # manual step for an HTTP client was "deploy a service, then configure a product";
    # everything but the paste is done by the run that produced this summary, so what
    # is left has to be presented as a paste and not as a deployment guide.
    if ($a.HostParams -and $a.HostParams.Parameters.ContainsKey('Gateway')) {
        $p = $a.HostParams.Parameters
        $lines = @()
        $lines += $(if ($p.ContainsKey('StartGateway')) {
            'Started and verified in this run. Listening on ' + $a.HostParams.GatewayUrl + '.'
        } else {
            'Configured on ' + $a.HostParams.GatewayUrl + '. It was not started by this run.'
        })
        # One URL per enabled server, and the domain is the server name with the
        # bconnect- prefix removed. Named for real rather than left as <domain>: an
        # operator pasting a placeholder into n8n gets a 404 and no way to tell why.
        $domains = @($a.Servers | ForEach-Object { $_ -replace '^bconnect-', '' })
        $lines += 'URL to paste, one per enabled server: ' +
                  $(if ($domains.Count) {
                      (@($domains | Select-Object -First 3 | ForEach-Object { $a.HostParams.GatewayUrl + '/' + $_ + '/mcp' }) -join '   ') +
                      $(if ($domains.Count -gt 3) { "   and $($domains.Count - 3) more, one for each enabled server." } else { '' })
                  } else {
                      $a.HostParams.GatewayUrl + '/<server name without the bconnect- prefix>/mcp'
                  })
        if ($script:GatewayTokenResult) {
            $lines += 'Header to paste on every call: ' + $script:GatewayTokenResult.header
            $lines += 'The token is stored in ' + $script:GatewayTokenResult.storedIn + ' and is on the clipboard. Calls without the header are answered 401. The health endpoint stays open for container probes.'
            if ($script:GatewayTokenResult.rotated) {
                $lines += 'This run rotated the token. The previous value keeps working until the installer is re-run without the rotate option, so clients can be moved across one at a time.'
            }
        }
        $sections += [pscustomobject]@{ Key = 'gateway'; Heading = 'HTTP gateway -- the URL and the header to paste'; Lines = $lines }
    }
    if (-not $rows.Count) {
        $sections += [pscustomobject]@{
            Key = 'no-clients'; Heading = 'No client was configured'
            Lines = @('No MCP client was selected, so the installer applied its own default target. Re-run the wizard and select the clients on the Clients page to have their configuration written.')
        }
    }
    return $sections
}

function Get-CompletionSummaryText {
    $out = @()
    foreach ($s in (Get-CompletionSummary)) {
        $out += $s.Heading
        foreach ($l in $s.Lines) { $out += '  - ' + $l }
        $out += ''
    }
    return ($out -join "`r`n").TrimEnd()
}

function Build-FinishSummary {
    $els.finishSummary.Children.Clear()
    foreach ($s in (Get-CompletionSummary)) {
        $card = New-Object System.Windows.Controls.Border
        $card.Background = (Br $C.Card); $card.BorderBrush = (Br $C.Border); $card.BorderThickness = (Thk 1 1 1 1)
        $card.CornerRadius = (New-Object System.Windows.CornerRadius(9))
        $card.Padding = (Thk 13 10 13 11); $card.Margin = (Thk 0 0 0 7)
        $sp = New-Object System.Windows.Controls.StackPanel
        [void]$sp.Children.Add((New-Line $s.Heading $C.Txt 13 $true))
        foreach ($l in $s.Lines) {
            $t = New-Line ('-  ' + $l) $(if ($s.Key -eq 'manual' -or $s.Key -eq 'no-clients') { $C.Warn } else { $C.Muted }) 12
            $t.Margin = (Thk 0 5 0 0)
            [void]$sp.Children.Add($t)
        }
        $card.Child = $sp
        [void]$els.finishSummary.Children.Add($card)
    }
    $els.finishSummary.Visibility = 'Visible'
}

# =============================================================================
# The TLS verdict.
#
# NOTHING IS COMPOSED HERE. The headline, the detail lines, the ordered remedy and
# the warning all arrive on the 'tls' progress record, produced by lib\probe-tls.mjs
# and printed verbatim by the console run. This chooses a colour and lays them out,
# and adds one thing the console cannot: the name of the field on the Credentials
# page that takes the CA certificate, because in the wizard that IS the next action.
#
# The remedy is numbered. The warning is not, and is drawn in muted text apart from
# the list, because it is the paragraph naming NODE_TLS_REJECT_UNAUTHORIZED as a
# development flag this installer does not set and does not offer. Rendered as step
# n of a numbered list it would read as one of the things to try, which is precisely
# the outcome the wording exists to prevent -- and this product carries a domain
# credential over the connection in question.
# =============================================================================
function Get-TlsPanelLines {
    # The panel as data, so what is rendered and what a guard reads are the same
    # thing. Returns $null when this run produced no certificate verdict at all.
    if (-not $script:TlsResult) { return $null }
    $t = $script:TlsResult
    $ok = ([string]$t.cause -eq 'trusted')
    $remedy = @($t.remedy)
    # The wizard's own next action, and it is a different sentence from the console's:
    # a console operator re-runs with -CaCert, a wizard operator goes back one page.
    if ([bool]$t.caFixable -and -not $ok) {
        $remedy += 'In this window: press Back to the Connect page, open Advanced, and put that file''s full path in CA CERTIFICATE (PEM), then run again.'
    }
    return [pscustomobject]@{
        Ok       = $ok
        Cause    = [string]$t.cause
        Headline = [string]$t.headline
        Detail   = @($t.detail)
        Remedy   = $remedy
        Warning  = [string]$t.warning
        CaFixable = [bool]$t.caFixable
    }
}

function Build-TlsPanel {
    $els.tlsPanel.Children.Clear()
    $v = Get-TlsPanelLines
    if (-not $v) { $els.tlsPanel.Visibility = 'Collapsed'; return }
    $col   = $(if ($v.Ok) { $C.Ok } else { $C.Crit })
    $card  = New-Object System.Windows.Controls.Border
    $card.Background = (Br $(if ($v.Ok) { $C.Card } else { $C.CritBg }))
    $card.BorderBrush = (Br $col); $card.BorderThickness = (Thk 1 1 1 1)
    $card.CornerRadius = (New-Object System.Windows.CornerRadius(9))
    $card.Padding = (Thk 13 10 13 11)
    $sp = New-Object System.Windows.Controls.StackPanel
    [void]$sp.Children.Add((New-Line $(if ($v.Ok) { 'CERTIFICATE' } else { 'CERTIFICATE PROBLEM' }) $col 11 $true))
    $h = New-Line $v.Headline $C.Txt 13 $true
    $h.Margin = (Thk 0 5 0 0)
    [void]$sp.Children.Add($h)
    foreach ($d in $v.Detail) {
        $t = New-Line $d $C.Muted 12
        $t.Margin = (Thk 0 4 0 0)
        [void]$sp.Children.Add($t)
    }
    $n = 0
    foreach ($r in $v.Remedy) {
        $n++
        $t = New-Line ("$n.  " + $r) $col 12
        $t.Margin = (Thk 0 5 0 0)
        [void]$sp.Children.Add($t)
    }
    if ($v.Warning) {
        $t = New-Line $v.Warning $C.Faint 11.5
        $t.Margin = (Thk 0 8 0 0)
        [void]$sp.Children.Add($t)
    }
    $card.Child = $sp
    [void]$els.tlsPanel.Children.Add($card)
    $els.tlsPanel.Visibility = 'Visible'
}

# The one line above the summary. It states the outcome; the sections under it
# carry the detail, so this stays short enough to be read at a glance.
function Get-ActivationText {
    $sel  = Get-SelectedHosts
    $rows = @($script:HostRows | Where-Object { $sel -contains $_.Id })
    if (-not $rows.Count) {
        return 'The installer finished. No MCP client was selected, so its own default target was used.'
    }
    $auto = @($rows | Where-Object { $_.Setup -eq 'automatic' })
    $man  = @($rows | Where-Object { $_.Setup -eq 'manual' })
    $parts = @()
    if ($auto.Count) { $parts += 'Configured: ' + (($auto | ForEach-Object { $_.Label }) -join ', ') + '. Restart each one.' }
    if ($man.Count)  { $parts += 'Settings to apply by hand: ' + (($man | ForEach-Object { $_.Label }) -join ', ') + '.' }
    $parts += 'The summary below is the whole of what remains to be done.'
    return ($parts -join ' ')
}

function Finish-Run($failed) {
    # The summary describes an install that wrote things. A dry run wrote nothing and
    # a verify-only run configured nothing, so neither gets one -- a panel listing
    # clients "configured" by a run that touched no file would be the worst kind of
    # wrong, because it reads exactly like the true version.
    $els.finishSummary.Children.Clear()
    $els.finishSummary.Visibility = 'Collapsed'
    $warns = @()
    if ($script:LastResult -and $script:LastResult.PSObject.Properties.Name -contains 'warnings') { $warns = @($script:LastResult.warnings) }
    Append-Console '' $null
    # Re-rendered rather than assumed: the record can arrive on the same tick that
    # completes the run, and a verdict that reached $script:TlsResult but never
    # reached the screen is the failure this panel exists to prevent.
    Build-TlsPanel
    $tls = Get-TlsPanelLines

    # The Connect page's Test. Same run, same records, reported where the operator is
    # standing -- one line, and the certificate verdict in preference to a generic
    # failure because it is the one an administrator can act on immediately.
    if ($script:RunKind -eq 'test') {
        $v = Get-TestVerdict -Failed $failed -Tls $tls -Result $script:LastResult
        $els.lblTestResult.Foreground = (Br $(if ($v.Ok) { $C.Ok } else { $C.Crit }))
        $els.lblTestResult.Text = $v.Text
        Update-Nav
        return
    }

    if ($failed) {
        $els.lblRunTitle.Text = 'Finished with problems'
        $els.lblRunTitle.Foreground = (Br $C.Crit)
        $els.lblRunSub.Text = $(if ($tls -and -not $tls.Ok) {
            # Named at the top rather than left in the output: a certificate failure
            # is the one an administrator can act on without reading anything else,
            # and it is indistinguishable from a wrong password in the raw log.
            $tls.Headline + ' The panel below states what to do. The installer output on the right carries the rest.'
        } else {
            'The installer output on the right says which step and why. Nothing here is hidden from you.'
        })
    } else {
        $els.lblRunTitle.Text = $(switch ($script:RunKind) { 'dryrun' { 'Check passed' } 'verify' { 'Verified' } default { 'Installed' } })
        $els.lblRunTitle.Foreground = (Br $C.Ok)
        if ($script:RunKind -eq 'install') {
            $els.lblRunSub.Text = (Get-ActivationText)
            Build-FinishSummary
            # And into the console tail as well, so the operator who selects the
            # output pane and copies it takes the summary with them.
            Append-Console '' $null
            foreach ($ln in ((Get-CompletionSummaryText) -split "`r?`n")) { Append-Console $ln $null }
        } elseif ($script:RunKind -eq 'dryrun') {
            $els.lblRunSub.Text = 'Nothing was written. Go back and press Install when you are ready.'
        } else {
            $els.lblRunSub.Text = 'Each configured server started from the live configuration and answered a real read call.'
        }
    }
    if ($warns.Count) {
        Append-Console ('Warnings raised during this run:') $Con.Warn
        foreach ($w in $warns) { Append-Console ('  - ' + $w) $Con.Warn }
    }

    # SEC-7 -- the one thing the operator has to carry out of this window by hand.
    # The gateway now refuses callers without this token, so a wizard that buries
    # it has simply moved the friction: the operator cannot make n8n work, and the
    # next thing they search for is how to switch the authentication off. So it is
    # last, highlighted, and on the clipboard, and the window says it did that.
    if ($script:GatewayTokenResult) {
        $t = $script:GatewayTokenResult
        Append-Console '' $null
        Append-Console '=== Gateway bearer token ===================================' $Con.Ok
        Append-Console ('  ' + $t.header) $Con.Ok
        Append-Console '' $null
        Append-Console ('  stored in  ' + $t.storedIn) $null
        Append-Console  '  Paste it into the HTTP client (n8n Header Auth, Open WebUI Bearer' $null
        Append-Console  '  field, or a plain Authorization header). Every POST /<domain>/mcp' $null
        Append-Console  '  without it gets 401; /health stays open for container probes.' $null
        if ($t.rotated) {
            Append-Console  '  ROTATED: the previous token still works until you re-run WITHOUT' $Con.Warn
            Append-Console  '  the rotate option. Move your clients across first.' $Con.Warn
        }
        $copied = $false
        try { [System.Windows.Clipboard]::SetText([string]$t.token); $copied = $true } catch { }
        Append-Console ('  ' + $(if ($copied) { 'Copied to your clipboard.' } else { 'Select and copy it above (clipboard was unavailable).' })) $Con.Ok
        Append-Console '============================================================' $Con.Ok
        if (-not $failed) {
            $els.lblRunSub.Text = 'The gateway bearer token is at the bottom of the output on the right' +
                                  $(if ($copied) { ' and on your clipboard' } else { '' }) +
                                  '. HTTP clients need it on every call, as "Authorization: Bearer <token>". ' +
                                  $els.lblRunSub.Text
        }
    }
    Update-Nav
}

# =============================================================================
# Tool measurement -- the same lib\measure-tools.mjs the script runs in Step 7,
# on a runspace so the window keeps painting.
# =============================================================================
function Start-Measure {
    if ($script:Measured.Count -gt 0 -or -not $NodeCmd) { return }
    $els.lblMeasure.Text = 'measuring tool schemas...'
    $rs = [runspacefactory]::CreateRunspace(); $rs.Open()
    $ps = [powershell]::Create(); $ps.Runspace = $rs
    [void]$ps.AddScript({
        param($node, $script, $root)
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $node
        $psi.Arguments = ('"{0}" --root "{1}"' -f $script, $root)
        $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
        $p = [System.Diagnostics.Process]::Start($psi)
        $o = $p.StandardOutput.ReadToEnd(); [void]$p.StandardError.ReadToEnd(); $p.WaitForExit()
        return $o
    }).AddArgument($NodeCmd.Source).AddArgument((Join-Path $LibDir 'measure-tools.mjs')).AddArgument((Get-SuiteRoot))
    $h = $ps.BeginInvoke()

    $t = New-Object System.Windows.Threading.DispatcherTimer
    $t.Interval = [TimeSpan]::FromMilliseconds(200)
    $t | Add-Member -NotePropertyName Ps -NotePropertyValue $ps
    $t | Add-Member -NotePropertyName H  -NotePropertyValue $h
    $t | Add-Member -NotePropertyName Rs -NotePropertyValue $rs
    $t.Add_Tick({
        if (-not $this.H.IsCompleted) { return }
        $this.Stop()
        $out = $null
        try { $out = $this.Ps.EndInvoke($this.H) } catch { }
        try { $this.Ps.Dispose(); $this.Rs.Close(); $this.Rs.Dispose() } catch { }
        foreach ($ln in (([string]$out) -split "`r?`n")) {
            $parts = $ln -split "`t"
            if ($parts.Count -eq 3 -and $parts[1] -ne 'ERROR') {
                $script:Measured[$parts[0]] = @{ Tools = $parts[1]; Bytes = [int]$parts[2] }
            }
        }
        foreach ($r in $script:ServerRows) {
            $m = $script:Measured[$r.Spec.dir]
            if ($m) { $r.Token.Text = ([math]::Round([int]$m.Bytes / 4)).ToString('N0') }
            else    { $r.Token.Text = '?' }
        }
        $els.lblMeasure.Text = $(if ($script:Measured.Count) { '' } else { 'could not measure tool schemas' })
        Update-Cost
    })
    $t.Start()
}

# =============================================================================
# Navigation
# =============================================================================
function Show-Page {
    for ($i = 0; $i -lt $script:PageCount; $i++) {
        $els["page$i"].Visibility = $(if ($i -eq $script:Page) { 'Visible' } else { 'Collapsed' })
    }
    Build-Rail
    switch ($script:Page) {
        # The requirement checks run on ENTRY to the Connect page, not on a page of
        # their own, and draw nothing at all when this computer is ready.
        $PG_CONNECT { Update-ShapePage; Update-StorePage; Build-RequirementBanner }
        $PG_CLIENTS { Reset-HostCatalog (Get-SelectedHosts); Update-HostPage }
        $PG_PERMS   { Build-WriteList; Start-Measure }
        $PG_REVIEW  { Update-InstallLocation; Set-Preflight; Build-Review }
    }
    Update-Nav
}

function Update-StorePage {
    $store = Get-CredentialStoreState -EnvFile (Join-Path (Get-SecretsDir) 'bconnect.env')
    $els.lblStoreNow.Text = switch ($store.Mode) {
        'protected' { "Right now: DPAPI-protected at $($store.ProtectedPath)." }
        'plaintext' { "Right now: plaintext at $($store.PlainPath), protected by the directory ACL only." }
        default     { 'Nothing stored yet.' }
    }
    if ($store.Mode -eq 'protected' -and -not $els.rbProtect.IsChecked -and -not $script:StoreTouched) {
        $els.rbProtect.IsChecked = $true
    }
    $want = $(if ($els.rbProtect.IsChecked) { 'protected' } else { 'plaintext' })
    if ($store.Mode -ne 'none' -and $store.Mode -ne $want) {
        $els.lblConvert.Text = "Re-running will convert the credentials from $($store.Mode) to $want and remove the old file. Nothing has to be re-typed: tick 'Keep the credentials already on disk' above and the installer re-encodes what is there."
        $els.convertNote.Visibility = 'Visible'
    } else {
        $els.convertNote.Visibility = 'Collapsed'
    }
}

# Whether a GIVEN page is answered, rather than only the current one.
#
# Test-CanAdvance used to switch on $script:Page directly, which answered exactly
# one question: may Next be pressed now. The rail needs a second: may step 3 be
# CLICKED, which is only true when steps 1 and 2 are both satisfied. Asking the
# same function about a page other than the current one is the whole mechanism, so
# the page number is a parameter and Test-CanAdvance is the special case.
function Test-PageSatisfied {
    param([int] $Page)
    $saved = $script:Page
    try { $script:Page = $Page; return (Test-CanAdvanceCore) }
    finally { $script:Page = $saved }
}

# The furthest step the operator may jump to: every step before it is answered.
# Returns -1 while a run is in flight, which disables the rail entirely -- clicking
# back into the questions while the installer is writing would be answering a
# question that has already been asked.
function Get-FurthestReachableStep {
    if ($script:Running) { return -1 }
    for ($i = 0; $i -lt $script:StepCount; $i++) {
        if (-not (Test-PageSatisfied $i)) { return $i }
    }
    return ($script:StepCount - 1)
}

function Test-CanAdvance { return (Test-CanAdvanceCore) }

function Test-CanAdvanceCore {
    switch ($script:Page) {
        $PG_CONNECT {
            # The deployment shape is the one question with no default. Every other
            # control on this page can fall back on a sensible value; this one
            # cannot, because the wrong value produces an install that reports
            # success and does not work, and a pre-selected radio button is an answer
            # given on the operator's behalf to exactly that.
            if (-not (Get-DeploymentShape)) { return $false }
            if ($els.chkReuse.IsChecked) { return $true }
            if (-not (Get-BaseUrl)) { return $false }
            if ($els.rbApiKey.IsChecked) { return ($els.pwApiKey.SecurePassword.Length -gt 0) }
            return ($els.txtBasicUser.Text.Trim() -and $els.pwBasic.SecurePassword.Length -gt 0)
        }
        # No client is ticked for you. An install that configures a client the
        # operator did not name is the defect this page exists to remove, so the
        # only alternative to choosing one is not going forward.
        $PG_CLIENTS {
            if ((Get-SelectedHosts).Count -eq 0) { return $false }
            # A per-project client needs a workspace, and it must not be this
            # installation. Both halves gate here rather than only the first: the
            # engine refuses the second, and letting the operator past it meant
            # answering every remaining question before being told.
            if (@($script:HostRows | Where-Object { $_.Selected -and $_.PerProject }).Count) {
                if (-not $els.ProjectDirBox.Text.Trim()) { return $false }
                if (Test-ProjectDirIsInstallation -ProjectDir $els.ProjectDirBox.Text `
                                                  -InstallationRoots (Get-InstallationRoots)) { return $false }
            }
            if ((Get-SelectedHosts) -contains 'claude-desktop' -and -not $els.ConfigPathBox.Text.Trim()) { return $false }
            return $true
        }
        $PG_PERMS {
            if ((Get-SelectedServers).Count -eq 0) { return $false }
            return (Test-WriteConfirmed)
        }
        default { return $true }
    }
}

function Update-Nav {
    $p = $script:Page
    $els.btnBack.IsEnabled  = ($p -gt 0 -and -not $script:Running)
    $els.btnCheck.Visibility  = $(if ($p -eq $PG_REVIEW) { 'Visible' } else { 'Collapsed' })
    $els.btnVerify.Visibility = $(if ($p -eq $PG_REVIEW) { 'Visible' } else { 'Collapsed' })
    $els.btnCheck.IsEnabled  = -not $script:Running
    $els.btnVerify.IsEnabled = -not $script:Running
    $els.btnTest.IsEnabled   = -not $script:Running

    if ($p -eq $PG_RUN) {
        $els.btnNext.Content = $(if ($script:Running) { 'Running...' } else { 'Close' })
        $els.btnNext.IsEnabled = -not $script:Running
        $els.btnBack.IsEnabled = -not $script:Running
    } elseif ($p -eq $PG_REVIEW) {
        $els.btnNext.Content = 'Install'
        $els.btnNext.IsEnabled = -not $script:Running
    } else {
        $els.btnNext.Content = 'Next'
        $els.btnNext.IsEnabled = ((Test-CanAdvance) -and -not $script:Running)
    }

    # One line per page, and the Connect page yields it to the requirement checks'
    # own summary when this computer has something wrong with it: a footer repeating
    # generalities over a banner naming a specific remedy is noise on top of signal.
    $els.lblFooter.Text = switch ($p) {
        $PG_CONNECT {
            # What is BLOCKING comes first. The unanswered deployment is the one thing
            # on this page that stops Next; the requirement summary is advisory, and
            # advisory text over a disabled button is how a button becomes a puzzle.
            $req = Get-RequirementSummary
            $(if (-not (Get-DeploymentShape)) { 'Choose where the servers are to run. Nothing is selected for you, and nothing continues until one is.' }
              elseif ($req) { $req }
              else { 'Credentials are held as a SecureString and passed in process, never to a log or a command line.' })
        }
        $PG_CLIENTS { $(if ((Get-SelectedHosts).Count) { 'Only the clients ticked here get a file. Nothing is written for the others.' } else { 'Pick the MCP clients in use here. Nothing is chosen for you.' }) }
        $PG_PERMS   { $(if ((Get-WriteGate).Count -and -not (Test-WriteConfirmed)) { 'Type ENABLE WRITES to confirm.' }
                        elseif ((Get-SelectedServers).Count -eq 0) { 'No server is enabled. Open Advanced and enable at least one.' }
                        else { 'Read-only unless you say otherwise.' }) }
        $PG_REVIEW  { 'Nothing is written until Install. Check (dry run) runs the real script and writes nothing.' }
        $PG_RUN     { $(if ($script:Running) { 'Working. This window stays responsive; the installer runs on its own runspace.' } else { 'The run has finished. The output on the right is the installer''s own.' }) }
    }
}

# =============================================================================
# Wiring
# =============================================================================
$els.txtSuite.Text   = $SuiteRoot
$els.txtSecrets.Text = $SecretsDir
# The applied location: what the line shows, what the engine is given, and what a
# refused edit falls back to. Set before any handler can run.
$script:LocationApplied = $SuiteRoot
$script:SecretsApplied  = $SecretsDir
Update-InstallLocation

# --- host page -------------------------------------------------------------
# Deliberately EMPTY, where it used to be pre-filled with $ProjectRoot -- the one
# value the engine refuses. There is no sensible default for this: it is whichever
# repository the operator opens in their editor, which nothing on this machine can
# guess. An empty box that says what it wants is better than a filled one that is
# wrong, and Update-Nav holds Next until it is answered.
$els.ProjectDirBox.Text = ''
$els.ConfigPathBox.Text = $ConfigPath
Reset-HostCatalog
# The list binds TwoWay to the row objects, so a tick has already reached the object
# by the time this bubbles up from the item's CheckBox; the explicit push is there
# because a row that disagrees with its checkbox would silently configure the wrong
# client, which is the one failure this page cannot be allowed to have.
$onHostToggle = [System.Windows.RoutedEventHandler]{
    param($src, $ev)
    $cb = $ev.OriginalSource
    if ($cb -is [System.Windows.Controls.CheckBox] -and $cb.DataContext) {
        $cb.DataContext.Selected = [bool]$cb.IsChecked
    }
    Update-HostPage
}
$els.HostList.AddHandler([System.Windows.Controls.Primitives.ToggleButton]::CheckedEvent,   $onHostToggle)
$els.HostList.AddHandler([System.Windows.Controls.Primitives.ToggleButton]::UncheckedEvent, $onHostToggle)
# A changed project directory or config path changes the destination each row shows,
# so the rows are rebuilt rather than left displaying where the file used to go.
$els.ProjectDirBox.Add_TextChanged({ Reset-HostCatalog (Get-SelectedHosts); Update-HostPage })
$els.ConfigPathBox.Add_TextChanged({ Reset-HostCatalog (Get-SelectedHosts); Update-HostPage })
$els.GatewayWantedCheck.Add_Checked({ Update-HostPage })
$els.GatewayWantedCheck.Add_Unchecked({ Update-HostPage })
# The gateway section is hidden until a selected client (or the shared-service
# deployment) requires it. The opt-in for a client the registry does not name lives
# under Advanced on the Clients page and DRIVES GatewayWantedCheck rather than
# duplicating it: GatewayWantedCheck stays the one value Get-HostSelection reads,
# so there is still exactly one answer to "is the gateway part of this install".
$els.GatewayOptInCheck.Add_Checked({ $els.GatewayWantedCheck.IsChecked = $true;  Update-HostPage })
$els.GatewayOptInCheck.Add_Unchecked({
    if (-not $script:GatewayForced) { $els.GatewayWantedCheck.IsChecked = $false }
    Update-HostPage
})

# --- deployment shape ------------------------------------------------------
# The answer filters the client list, so the rows are rebuilt the moment it changes
# rather than at the next visit to the Clients page. Selections carried over from the
# other answer are re-applied only where the row still exists -- Reset-HostCatalog
# passes them as -Preselect, and a target the new shape cannot serve is simply not
# in the catalog to be re-ticked.
$onShapeChosen = {
    Reset-HostCatalog (Get-SelectedHosts)
    Update-HostPage
    Update-ShapePage
}
$els.rbShapeWorkstation.Add_Checked($onShapeChosen)
$els.rbShapeCentral.Add_Checked($onShapeChosen)

$existingStore = Get-CredentialStoreState -EnvFile (Join-Path $SecretsDir 'bconnect.env')
if ($existingStore.Mode -ne 'none') {
    $els.chkReuse.IsChecked = $true
    if ($existingStore.Mode -eq 'protected') { $els.rbProtect.IsChecked = $true }
    try {
        $m = Read-BConnectEnvMap -EnvFile (Join-Path $SecretsDir 'bconnect.env')
        # Decompose what is stored, rather than assume it is of the standard form.
        # A stored address that does not recompose EXACTLY -- a port, a different
        # virtual directory, a name that round-trips differently -- goes to the
        # Advanced box with the expander open, because the alternative is a wizard
        # that shows one address and installs another. Equality is the test, not a
        # pattern: a pattern decides what looks standard, equality proves it.
        if ($m['BCONNECT_BASE_URL']) {
            $stored = ([string]$m['BCONNECT_BASE_URL']).Trim()
            $els.txtBaseUrl.Text = $stored
            if ((Get-ComposedBaseUrl $stored) -eq $stored) {
                $els.txtServerFqdn.Text = ConvertTo-ServerHost $stored
            } else {
                $els.chkCustomUrl.IsChecked = $true
                $els.expConnectAdvanced.IsExpanded = $true
            }
        }
        if ($m['BCONNECT_CA_CERT_PATH']) { $els.txtCaCert.Text = $m['BCONNECT_CA_CERT_PATH'] }
    } catch { }
}
# The v1.1 note, decided by the machine rather than assumed. On a workgroup server
# there is no domain to build a UPN from, so "it needs a domain account in UPN form"
# was an instruction the operator could not follow -- reported from a standalone test
# server, where the run stopped on a local account name that was the only kind
# available. The privilege warning is on both paths, because it is true on both.
$script:DomainJoinedHere = $true
try { $script:DomainJoinedHere = [bool](Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop).PartOfDomain } catch { }
$els.lblV11Note.Text = $(if ($script:DomainJoinedHere) {
    "v1.1 exposes job configuration that v2.0 omits. It needs a domain account in UPN form -- user@example.local -- and is MORE PRIVILEGED than the API key: it carries that user's own rights."
} else {
    ("v1.1 exposes job configuration that v2.0 omits. This computer is not domain-joined, so it needs a local account as HOSTNAME\account -- ${env:COMPUTERNAME}\Administrator. A bare name returns 401. It is MORE PRIVILEGED than the API key: it carries that user's own rights.")
})

if ($NodeCmd) {
    $nv = [Version](((& $NodeCmd.Source -v) -replace '^v', '') -replace '-.*$', '')
    if ($nv.Major -gt 22 -or ($nv.Major -eq 22 -and $nv.Minor -ge 15)) {
        $els.lblCaNote.Text = "Node $nv reads the Windows certificate store, so an internal-CA bMS usually needs nothing here."
    } else {
        $els.lblCaNote.Text = "Node $nv does not read the Windows certificate store. If your bMS uses an internal CA, point this at a PEM copy of it."
    }
}

$script:StoreTouched = $false
$els.rbProtect.Add_Checked({ $script:StoreTouched = $true; Update-StorePage })
$els.rbPlain.Add_Checked({ $script:StoreTouched = $true; Update-StorePage })

$els.chkReuse.Add_Checked({
    $els.credFields.IsEnabled = $false
    $els.reuseLockNote.Visibility = 'Visible'
    Update-Nav
})
$els.chkReuse.Add_Unchecked({
    $els.credFields.IsEnabled = $true
    $els.reuseLockNote.Visibility = 'Collapsed'
    Update-Nav
})
# The startup case, which is the one that was reported: an existing
# installation ticks reuse at load (see Get-CredentialStoreState below), and
# the note has to follow it then too, not only when a human clicks the box.
if ($els.chkReuse.IsChecked) {
    $els.credFields.IsEnabled = $false
    $els.reuseLockNote.Visibility = 'Visible'
}

$els.rbApiKey.Add_Checked({ $els.pnlApiKey.Visibility = 'Visible'; $els.pnlBasic.Visibility = 'Collapsed'; Update-Nav })
$els.rbBasic.Add_Checked({ $els.pnlApiKey.Visibility = 'Collapsed'; $els.pnlBasic.Visibility = 'Visible'; Update-Nav })
$els.chkV11.Add_Checked({ $els.pnlV11.Visibility = 'Visible' })
$els.chkV11.Add_Unchecked({ $els.pnlV11.Visibility = 'Collapsed' })

# ── Per-server keys (optional) ───────────────────────────────────────────────
#
# Built when the tick is cleared, not at startup, and rebuilt each time: the
# rows must follow the servers actually chosen on the previous page, and that
# choice can change after this panel has been opened once. Rebuilding is
# cheaper to reason about than reconciling.
#
# The boxes are held in a script-scope map keyed by SCOPE (JOBS, COMPLIANCE),
# because that is what the variable name is built from downstream. Keying by
# the row's label would put the display string in the contract.
$script:PerServerKeyBoxes = @{}

function Build-PerServerKeyRows {
    $els.pnlPerServerKeys.Children.Clear()
    $script:PerServerKeyBoxes = @{}

    $chosen = @(Get-SelectedServers)
    if (-not $chosen.Count) {
        $empty = New-Object System.Windows.Controls.TextBlock
        $empty.Text = 'Choose servers first; each one you install can then be given its own key.'
        $empty.Style = $win.FindResource('Sub')
        [void]$els.pnlPerServerKeys.Children.Add($empty)
        return
    }

    $note = New-Object System.Windows.Controls.TextBlock
    $note.Text = 'Leave a box blank to use the key above. Only the servers you fill in get their own key.'
    $note.Style = $win.FindResource('Sub')
    [void]$els.pnlPerServerKeys.Children.Add($note)

    foreach ($name in $chosen) {
        # bconnect-jobs-mcp -> JOBS. Mirrors serverScope() in
        # packages/mcp-core/src/server-scoped-credentials.ts, which is what
        # reads BCONNECT_API_KEY__JOBS at run time.
        $scope = ($name -replace '^bconnect-', '' -replace '-mcp$', '' -replace '[^A-Za-z0-9]', '').ToUpperInvariant()

        $label = New-Object System.Windows.Controls.TextBlock
        $label.Text = $name
        $label.Style = $win.FindResource('Label')
        $label.Margin = '0,8,0,3'
        [void]$els.pnlPerServerKeys.Children.Add($label)

        $box = New-Object System.Windows.Controls.PasswordBox
        [void]$els.pnlPerServerKeys.Children.Add($box)
        $script:PerServerKeyBoxes[$scope] = $box
    }
}

$els.chkOneKeyForAll.Add_Checked({
    $els.pnlPerServerKeys.Visibility = 'Collapsed'
    # Cleared, not merely hidden. A key typed and then re-ticked away must not
    # travel to disk because the panel happened to remember it.
    $els.pnlPerServerKeys.Children.Clear()
    $script:PerServerKeyBoxes = @{}
})
$els.chkOneKeyForAll.Add_Unchecked({
    Build-PerServerKeyRows
    $els.pnlPerServerKeys.Visibility = 'Visible'
})

foreach ($tb in @($els.txtBasicUser, $els.ProjectDirBox, $els.ConfigPathBox)) { $tb.Add_TextChanged({ Update-Nav }) }
# The two address boxes also redraw the composed line, so what it states is never
# one keystroke behind what would be installed.
foreach ($tb in @($els.txtServerFqdn, $els.txtBaseUrl)) { $tb.Add_TextChanged({ Update-ComposedUrl; Update-Nav }) }
$onCustomUrl = {
    $els.pnlCustomUrl.Visibility = $(if ($els.chkCustomUrl.IsChecked) { 'Visible' } else { 'Collapsed' })
    Update-ComposedUrl
    Update-Nav
}
$els.chkCustomUrl.Add_Checked($onCustomUrl)
$els.chkCustomUrl.Add_Unchecked($onCustomUrl)
# Run it once now. The stored-address decomposition further up ticks this box for a
# non-standard installation, and it runs BEFORE these handlers exist -- so relying on
# the Checked event would leave the box ticked and the panel holding the real address
# collapsed, which is the one outcome this whole arrangement exists to prevent. It
# also draws the composed line for a first run, where it is the field's only hint.
& $onCustomUrl
foreach ($pb in @($els.pwApiKey, $els.pwBasic)) { $pb.Add_PasswordChanged({ Update-Nav }) }
$els.txtConfirm.Add_TextChanged({ Update-Nav })

# --- permissions -----------------------------------------------------------
# Choosing to allow changes is what reveals what that permits; going back to read
# only hides it AND empties the gate, which Get-WriteGate enforces rather than
# leaving to the visibility of a panel.
$els.rbAllowChanges.Add_Checked({ Update-ConfirmBar })
$els.rbReadOnly.Add_Checked({ Update-ConfirmBar })

# --- what you will need ----------------------------------------------------
$els.lnkNeeded.Add_MouseLeftButtonDown({ [void](Show-Readme) })
$els.lnkRecheck.Add_MouseLeftButtonDown({ Build-RequirementBanner })

# --- the install location --------------------------------------------------
# Change reveals the editor; Use this location validates and only then applies.
$els.btnChangeLocation.Add_Click({
    $els.locationEditor.Visibility = $(if ($els.locationEditor.Visibility -eq 'Visible') { 'Collapsed' } else { 'Visible' })
    if ($els.locationEditor.Visibility -eq 'Collapsed') { $els.lblLocationProblem.Visibility = 'Collapsed' }
})
$els.btnApplyLocation.Add_Click({ [void](Confirm-InstallLocation) })
$els.btnCancelLocation.Add_Click({
    # Update-InstallLocation restores both boxes from the applied values once the
    # editor is closed, so there is one place that knows how to abandon an edit.
    $els.locationEditor.Visibility = 'Collapsed'
    $els.lblLocationProblem.Visibility = 'Collapsed'
    Update-InstallLocation
})
# The secrets directory follows the location until it is typed into, and then keeps
# what was typed. The flag is set here and nowhere else.
$els.txtSuite.Add_TextChanged({ Set-SecretsToFollow $els.txtSuite.Text; Update-Nav })
$els.txtSecrets.Add_TextChanged({
    if (-not $script:SettingSecrets) { $script:SecretsPinned = $true }
    Update-Nav
})

$els.btnSelRecommended.Add_Click({ foreach ($r in $script:ServerRows) { $r.Check.IsChecked = ($r.Present -and [bool]$r.Spec.default) } })
$els.btnSelMinimal.Add_Click({ foreach ($r in $script:ServerRows) { $r.Check.IsChecked = ($r.Present -and $r.Spec.name -eq 'bconnect-endpoints') } })
$els.btnSelAll.Add_Click({ foreach ($r in $script:ServerRows) { $r.Check.IsChecked = $r.Present } })
$els.btnSelNone.Add_Click({ foreach ($r in $script:ServerRows) { $r.Check.IsChecked = $false } })

$els.btnBack.Add_Click({
    if ($script:Page -gt 0) { $script:Page--; Show-Page }
})
$els.btnNext.Add_Click({
    if ($script:Page -eq $PG_RUN)    { $win.Close(); return }
    if ($script:Page -eq $PG_REVIEW) {
        # The last chance to refuse a location that cannot hold this product, and it
        # is refused HERE rather than by the engine several minutes in.
        $v = Test-InstallLocation -Path $els.txtSuite.Text
        if (-not $v.Ok) {
            $els.lblLocationProblem.Text = ($v.Reasons -join ' ')
            $els.lblLocationProblem.Visibility = 'Visible'
            $els.locationEditor.Visibility = 'Visible'
            return
        }
        Start-Installer 'install'
        return
    }
    if (-not (Test-CanAdvance)) { return }
    $script:Page++
    Show-Page
})
$els.btnCopyLog.Add_Click({
    # Says what happened. A button that looks identical before and after leaves the
    # operator pasting to find out whether it worked.
    $ok = Copy-ConsoleText
    $els.btnCopyLog.Content = $(if ($ok) { 'Copied' } else { 'Nothing yet' })
    $t = New-Object System.Windows.Threading.DispatcherTimer
    $t.Interval = [TimeSpan]::FromSeconds(2)
    $t.Add_Tick({ $this.Stop(); $els.btnCopyLog.Content = 'Copy' })
    $t.Start()
})
$els.btnCheck.Add_Click({ Start-Installer 'dryrun' })
$els.btnVerify.Add_Click({ Start-Installer 'verify' })
$els.btnTest.Add_Click({ Start-Installer 'test' })

# The server list is built ONCE, here, rather than on a page visit: the Test button
# on the first page hands the engine a -Servers list, and a list that only exists
# after somebody opened an expander two pages later would have been empty. It is
# rebuilt when the install location changes, because which packages are on disk is a
# property of that location.
Build-ServerList

$win.Add_Closing({
    # A half-finished install is worse than a finished one; say so rather than
    # silently killing a runspace mid-write.
    if ($script:Running) {
        $r = [System.Windows.MessageBox]::Show(
            "The installer is still running. Closing now leaves it half-done.`n`nClose anyway?",
            'bConnect-MCP installer', 'YesNo', 'Warning')
        if ($r -ne 'Yes') { $_.Cancel = $true; return }
        try { $script:Ps.Stop() } catch { }
    }
})

Show-Page
if ($TestHeadless) {
    # Built and wired, deliberately not shown -- see the -TestHeadless comment in the
    # param block. lib\Test-WizardTheme.ps1 dot-sources this file with the switch set
    # and then inspects $win, $els, $C, $Con and $xaml directly.
    return
}
[void]$win.ShowDialog()
