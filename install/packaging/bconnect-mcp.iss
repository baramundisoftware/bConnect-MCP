; ============================================================================
;  bConnect-MCP -- Inno Setup 6 script for the shipped .exe
; ----------------------------------------------------------------------------
;  What this produces: ONE self-contained .exe that a customer runs on their bMS
;  server with no internet access. It lays down a pre-built suite, installs the
;  pinned Node.js runtime from a bundled MSI when the machine has nothing
;  adequate, creates Start-menu entries, and then OFFERS to launch the existing
;  installer.
;
;  What it deliberately does NOT do:
;
;    * It does not collect a single bMS credential. Install-BConnectMcp.ps1
;      already collects them through a masked prompt, writes them into a
;      directory it hardens first, and can DPAPI-protect them. Asking for a key
;      here would be a second implementation of credential handling, and the
;      second one is always the one that leaks.
;    * It does not build anything. Everything in the payload was compiled on a
;      connected machine by install\lib\New-OfflineBundle.ps1, whose manifest
;      travels with it and is verified by the installer on arrival.
;    * It does not delete the customer's credentials or their MCP client
;      configurations on uninstall without asking. Those are theirs, they may be
;      in use by other tooling, and the removal is delegated to bconnect.ps1 so
;      that there is exactly one implementation of it.
;
;  Requires Inno Setup 6.3 or newer (x64compatible, IsX64Compatible).
;  packaging\README.md is the build procedure. packaging\Test-InnoScript.ps1
;  checks this file against the tree it is supposed to package -- run it before
;  every build; it catches the drift that a successful compile does not.
;
;  Note on formatting: no line-continuation backslashes are used in the sections
;  below. Long single lines are harder to read than wrapped ones and are used
;  anyway, because continuation support differs between Inno versions and a
;  packaging script that compiles on the build machine and not on the release
;  machine is the worst failure available here.
; ============================================================================

; ----------------------------------------------------------------------------
;  Preprocessor definitions
; ----------------------------------------------------------------------------
;  Every value a build can legitimately vary is here, and Test-InnoScript.ps1
;  checks each one against the file that owns the truth. Version drift between
;  this script and package.json is the single most likely packaging defect --
;  it produces an .exe that installs the wrong thing under the right name.

; The suite version. MUST equal the "version" field of the suite's package.json.
#define SuiteVersion "26.1.8"

; The Add/Remove Programs identity. THIS GUID IS FIXED FOR THE LIFE OF THE
; PRODUCT. Inno keys the uninstall registry entry, the previous-install
; detection and the upgrade-in-place behaviour on it, so regenerating it per
; build -- which is what the IDE's "generate a new GUID" button invites -- turns
; every upgrade into a second Add/Remove Programs row over a first installation
; that can no longer be uninstalled. The doubled leading brace is Inno's escape
; for a literal '{'.
#define AppId "{{E57A7E00-0000-4000-8000-000000000023}"

#define AppName        "bConnect-MCP"
#define AppPublisher   "baramundi software GmbH"
#define AppUrl         "https://www.baramundi.com/"
#define AppSupportUrl  "https://www.baramundi.com/support/"

; --- the Node.js runtime -----------------------------------------------------
; NodeMinVersion is the floor the suite itself declares: .nvmrc pins it and
; every package's engines.node repeats it as ">=". A machine already at or above
; it gets NOTHING installed -- see NeedsNodeRuntime below. Downgrading, or
; replacing a Node that other software on that server depends on, is not this
; installer's business.
;
; NodePreferredVersion is the threshold Install-BConnectMcp.ps1 warns below:
; from 22.15.0 Node reads the Windows certificate store, which is the clean
; answer to a bMS presenting an internal-CA certificate. Below it the operator
; has to set BCONNECT_CA_CERT_PATH by hand.
;
; NodeVersion is what the bundled MSI actually is, and it must satisfy both
; floors. Bumping it to a newer 22.x LTS is a one-line change here plus a new
; file in redist\; the validator enforces the relationship, not the number.
; 22.23.2 is deliberately not the newest LTS available. It is the line the suite
; is actually tested on -- the test runs that produce the figures in the release
; notes execute under 22.23.x -- and shipping a runtime nobody has run the suite
; against trades a known quantity for a newer number. 24.x was staged first and
; replaced for that reason. The runtime dependency set is pure JavaScript
; (@modelcontextprotocol/sdk, axios, axios-retry, dotenv), so no native module is
; ABI-locked to this major; the three .node binaries in the tree all belong to
; devDependencies and never execute on a customer machine.
#define NodeMinVersion       "20.0.0"
#define NodePreferredVersion "22.15.0"
#define NodeVersion          "22.23.2"
#define NodeMsi              "node-v" + NodeVersion + "-x64.msi"

; Free disk space demanded before anything is written, in MB. The payload is a
; built tree WITH node_modules, so it is measured in gigabytes; the headroom
; covers the Node MSI unpacking and the installer's own working files.
#define RequiredFreeMB "4096"

; Oldest Windows accepted: Windows 10 build 17763 / Windows Server 2019.
#define MinWindowsVersion "10.0.17763"

; --- where the inputs come from ----------------------------------------------
; BundleDir is the output of install\lib\New-OfflineBundle.ps1: the suite root
; WITH node_modules and build output, with install\ inside it and
; offline-bundle.json at its top. Pass it on the ISCC command line:
;     ISCC.exe /DBundleDir="D:\bconnect-mcp-offline" bconnect-mcp.iss
; The default below is a sibling of the checkout, so a build that forgets the
; switch fails on a missing directory instead of silently packaging a source
; tree that was never built.
#ifndef BundleDir
  #define BundleDir AddBackslash(SourcePath) + "..\..\..\bconnect-mcp-offline"
#endif

; The Node MSI is downloaded once, by hand, on a connected machine and dropped
; here. It is not in source control -- see packaging\README.md.
#ifndef RedistDir
  #define RedistDir AddBackslash(SourcePath) + "redist"
#endif

#ifndef OutputDir
  #define OutputDir AddBackslash(SourcePath) + "out"
#endif

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#SuiteVersion}
AppVerName={#AppName} {#SuiteVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppSupportUrl}
AppUpdatesURL={#AppUrl}
VersionInfoVersion={#SuiteVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} {#SuiteVersion} Setup
VersionInfoProductName={#AppName}

; Add/Remove Programs. UninstallDisplayName carries the version so that an
; operator surveying a fleet can tell two machines apart without opening
; anything.
UninstallDisplayName={#AppName} {#SuiteVersion}
UninstallDisplayIcon={app}\install\assets\app.ico

; Per-machine, under Program Files. UsePreviousAppDir is Inno's default and is
; what makes an upgrade land on top of the previous installation rather than
; beside it; it works because AppId above never changes.
DefaultDirName={autopf}\baramundi\{#AppName}
DefaultGroupName=baramundi\{#AppName}
UsePreviousAppDir=yes
UsePreviousGroup=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=

; 64-bit only. The bundled Node runtime is the x64 MSI and the suite is not
; tested on anything else.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion={#MinWindowsVersion}

; The Node MSI puts the Node.js directory on the machine PATH. Broadcasting the
; change means a session started afterwards sees it without a sign-out; it does
; NOT reach this Setup process's own environment, which is why
; Start-BConnectConfig.cmd repairs PATH for the processes Setup launches.
ChangesEnvironment=yes

LicenseFile={#BundleDir}\LICENSE
OutputDir={#OutputDir}
OutputBaseFilename=bConnect-MCP-Setup-{#SuiteVersion}
SetupIconFile={#BundleDir}\install\assets\app.ico
WizardStyle=modern
Compression=lzma2/max
; node_modules is a very large number of very small files, which is exactly the
; case solid compression is for. The deliverable is explicitly one file, so
; disk spanning is off.
SolidCompression=yes
DiskSpanning=no

; A log beside the .exe, always. The support case this saves is "it failed on a
; server I cannot reach", where the alternative is a photograph of a message box.
SetupLogging=yes

; Setup does not close or restart anything. A bMS server runs services that have
; nothing to do with this product, and an installer that terminates processes it
; did not start is a worse problem than a file in use.
CloseApplications=no
RestartApplications=no
RestartIfNeededByRun=no

; ----------------------------------------------------------------------------
;  Code signing -- COMMENTED OUT ON PURPOSE
; ----------------------------------------------------------------------------
;  Uncomment BOTH directives at the end of this block to produce a signed .exe.
;  No certificate is invented here and none is named: the signing tool is
;  declared to ISCC on the command line, so the certificate never has to be
;  described in a file that is committed.
;
;    ISCC.exe ^
;      /Sbaramundi="signtool.exe sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /sha1 <THUMBPRINT> $f" ^
;      /DBundleDir="D:\bconnect-mcp-offline" ^
;      bconnect-mcp.iss
;
;  $f is Inno's placeholder for the file being signed, and is passed through by
;  the compiler; it is not a shell variable.
;
;  WHAT TO SET BEFORE SHIPPING
;    * <THUMBPRINT>: the SHA1 thumbprint of baramundi's code-signing
;      certificate, in the build machine's certificate store. Prefer a
;      thumbprint over "/f <file.pfx> /p <password>" -- a password on a command
;      line lands in the build log.
;    * The timestamp URL: any RFC 3161 server the signing CA supports. Without
;      a timestamp the signature stops validating the day the certificate
;      expires, including on .exe files already deployed.
;    * Sign on a machine that holds the certificate. Do not carry a .pfx to a
;      developer workstation to make a one-off build.
;
;  SignedUninstaller signs the uninstaller Setup writes into {app}. It is a
;  separate executable and is otherwise unsigned, which customers enforcing
;  WDAC or AppLocker will notice.
;
;SignTool=baramundi
;SignedUninstaller=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Dirs]
; Created empty, and NEVER removed by the uninstaller: install\state holds the
; installation record and install\out holds emitted host snippets. Both describe
; the customer's estate and neither was put there by Setup.
Name: "{app}\install\out"; Flags: uninsneveruninstall
Name: "{app}\install\state"; Flags: uninsneveruninstall

[Files]
; --- the pre-built suite, the installer, the verb CLI and the GUI ------------
; ONE recursive entry. The offline bundle is already exactly the tree that has
; to land on the target -- suite root, node_modules, build output, and install\
; inside it -- so enumerating parts of it here would only create a second,
; drifting description of the same thing.
;
; The excludes are the paths that must not travel even if BundleDir is pointed
; at a live working tree by mistake. New-OfflineBundle.ps1 already omits
; install\state and install\out and asserts afterwards that no credentials file
; is present; this repeats the assertion at packaging time, because "the bundler
; was supposed to" is not a control.
;
; offline-bundle.json is inside this entry and MUST land at {app}: the paths it
; hashes are relative to itself, and Install-BConnectMcp.ps1 verifies them on
; the target. That is also why install\packaging ships -- the manifest hashes
; every .ps1 under install\, Test-InnoScript.ps1 included, and a file the
; manifest names but the .exe did not install reads as a corrupt transfer.
Source: "{#BundleDir}\*"; DestDir: "{app}"; Excludes: "\.git\*,\secrets\*,\install\state\*,\install\out\*,\install\packaging\redist\*,\install\packaging\out\*,*.bak-*"; Flags: ignoreversion recursesubdirs createallsubdirs

; --- launcher shim -----------------------------------------------------------
; Also present under {app}\install\packaging, because it is part of the bundle;
; installed a second time at {app}\install so that a Start-menu shortcut points
; somewhere a customer can make sense of. Both copies come from this one source
; file at build time, so they cannot disagree.
Source: "{#SourcePath}Start-BConnectConfig.cmd"; DestDir: "{app}\install"; Flags: ignoreversion

; --- the Node.js runtime -----------------------------------------------------
; Extracted to {tmp} and removed afterwards, and only when this machine has
; nothing adequate. On a machine that already has Node 20 or newer the MSI is
; not unpacked at all.
Source: "{#RedistDir}\{#NodeMsi}"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsNodeRuntime

[Icons]
; The configuration GUI is the entry point for everyday work: it is what an
; administrator opens to change a URL, add a server or turn a write gate on.
; runminimized keeps the PowerShell console that hosts the WPF window out of the
; way; the window itself is not minimised.
Name: "{group}\{#AppName} Configuration"; Filename: "{app}\install\Start-BConnectConfig.cmd"; Parameters: "manage"; WorkingDir: "{app}\install"; IconFilename: "{app}\install\assets\app.ico"; Comment: "Change the bConnect-MCP configuration"; Flags: runminimized

; The guided installer, for the first run and for a later reconfiguration. It is
; the same script the Finished page offers to launch.
Name: "{group}\{#AppName} Setup"; Filename: "{app}\install\Start-BConnectConfig.cmd"; Parameters: "setup"; WorkingDir: "{app}\install"; IconFilename: "{app}\install\assets\app.ico"; Comment: "Run the guided bConnect-MCP installer"; Flags: runminimized

; The verb CLI, in a console that stays open and prints its own usage. That is
; the whole of the discoverability story for an administrator who has not seen
; it before.
Name: "{group}\{#AppName} Command Line"; Filename: "{app}\install\Start-BConnectConfig.cmd"; Parameters: "cli"; WorkingDir: "{app}\install"; IconFilename: "{app}\install\assets\app.ico"; Comment: "bconnect status, verify, servers, hosts, writes, uninstall"

Name: "{group}\Installation Guide"; Filename: "{app}\install\INSTALL.md"; Comment: "The full installation and configuration documentation"

Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
; The runtime first, because everything after it needs node on PATH. /qn is a
; silent install; ADDLOCAL is deliberately NOT set to ALL, because one of the
; Node MSI's optional features fetches a native-build toolchain from the
; internet, which is the one thing this .exe exists to avoid.
Filename: "{sys}\msiexec.exe"; Parameters: "/i ""{tmp}\{#NodeMsi}"" /qn /norestart /l*v ""{app}\install\out\node-msi.log"""; StatusMsg: "Installing the Node.js {#NodeVersion} runtime..."; Check: NeedsNodeRuntime; Flags: waituntilterminated

; And then the offer. Ticked by default: a customer who has just run a vendor
; installer on their bMS server expects to be asked for the connection details,
; and the alternative is a hunt through the Start menu. skipifsilent keeps an
; unattended deployment unattended.
Filename: "{app}\install\Start-BConnectConfig.cmd"; Parameters: "setup"; WorkingDir: "{app}\install"; Description: "Configure the connection to the baramundi Management Suite now"; Flags: postinstall nowait skipifsilent

[Code]
var
  NodeNeeded:       Boolean;
  NodeFoundVersion: String;   { '' when node is not on PATH }

{ ---------------------------------------------------------------------------
  Version comparison. StrToVersion packs "22.15.0" into an Int64 that
  ComparePackedVersion orders correctly; doing it with string comparison gets
  "20.0.0" against "9.9.9" wrong in the one direction that matters.
  --------------------------------------------------------------------------- }
function VersionAtLeast(const Have, Want: String): Boolean;
var
  H, W: Int64;
begin
  Result := False;
  if not StrToVersion(Have, H) then Exit;
  if not StrToVersion(Want, W) then Exit;
  Result := ComparePackedVersion(H, W) >= 0;
end;

{ ---------------------------------------------------------------------------
  What Node, if any, this machine already has.

  Read by running `node -v` rather than by looking in the registry, because the
  question the suite actually asks is "is node on PATH": Install-BConnectMcp.ps1
  resolves it with Get-Command and aborts when that fails. A registry key can be
  present for a runtime PATH does not reach, and that combination installs
  cleanly here and then fails at the first configuration step.
  --------------------------------------------------------------------------- }
function DetectNodeVersion(): String;
var
  TempFile: String;
  Raw: AnsiString;
  Code: Integer;
begin
  Result := '';
  TempFile := ExpandConstant('{tmp}\node-version.txt');
  if not Exec(ExpandConstant('{cmd}'), '/c node -v > "' + TempFile + '" 2>&1', '', SW_HIDE, ewWaitUntilTerminated, Code) then Exit;
  if Code <> 0 then Exit;
  if not LoadStringFromFile(TempFile, Raw) then Exit;
  Result := Trim(String(Raw));
  { node prints "v22.15.0". Anything not of that shape -- an error message, a
    shim that printed a banner -- is treated as "no usable node". }
  if (Length(Result) < 2) or (Result[1] <> 'v') then
  begin
    Result := '';
    Exit;
  end;
  Delete(Result, 1, 1);
end;

function NeedsNodeRuntime(): Boolean;
begin
  Result := NodeNeeded;
end;

{ ---------------------------------------------------------------------------
  Prerequisites. Every one is checked BEFORE a single file is written, and every
  failure names the condition and the remedy. Inno enforces the Windows version,
  the architecture and administrator rights on its own, in its own words; the
  checks below are the ones it cannot express, plus a restatement of the
  architecture and privilege tests so that the message an administrator reads is
  the product's rather than the toolkit's.
  --------------------------------------------------------------------------- }
function InitializeSetup(): Boolean;
var
  PSVersion: String;
  FreeBytes, TotalBytes, RequiredBytes: Int64;
begin
  Result := False;

  if not IsX64Compatible then
  begin
    MsgBox('This computer does not run 64-bit Windows.' + #13#10#13#10 +
           'bConnect-MCP includes a 64-bit Node.js runtime and is supported on ' +
           '64-bit Windows only. Install it on the bMS server or on a 64-bit ' +
           'management workstation.', mbCriticalError, MB_OK);
    Exit;
  end;

  if not IsWindowsVersionOrNewer(10, 0, 17763) then
  begin
    MsgBox('Windows ' + GetWindowsVersionString + ' is older than the minimum ' +
           'supported version.' + #13#10#13#10 +
           'bConnect-MCP requires Windows 10 build 17763, Windows Server 2019, ' +
           'or newer. Install it on a supported operating system.',
           mbCriticalError, MB_OK);
    Exit;
  end;

  if not IsAdminInstallMode then
  begin
    MsgBox('Setup is not running with administrator rights.' + #13#10#13#10 +
           'Installation writes to Program Files and installs the Node.js ' +
           'runtime. Both require elevation. Right-click the setup program and ' +
           'choose "Run as administrator".', mbCriticalError, MB_OK);
    Exit;
  end;

  { Windows PowerShell 5.1 or newer. The installer, the verb CLI and the
    configuration GUI are Windows PowerShell scripts, and the GUI additionally
    needs WPF on an STA thread. 5.1 ships with every supported Windows, so a
    failure here means it was removed or the registry is damaged, and the remedy
    is a Windows feature rather than a download. }
  PSVersion := '';
  RegQueryStringValue(HKEY_LOCAL_MACHINE, 'SOFTWARE\Microsoft\PowerShell\3\PowerShellEngine', 'PowerShellVersion', PSVersion);
  if (PSVersion = '') or (not VersionAtLeast(PSVersion, '5.1')) then
  begin
    if PSVersion = '' then
      MsgBox('Windows PowerShell 5.1 was not found on this computer.' + #13#10#13#10 +
             'bConnect-MCP is installed and configured by Windows PowerShell ' +
             'scripts. Enable the "Windows PowerShell 5.1" feature in Server ' +
             'Manager, under Add Roles and Features, and run Setup again.',
             mbCriticalError, MB_OK)
    else
      MsgBox('Windows PowerShell ' + PSVersion + ' is older than the minimum ' +
             'supported version.' + #13#10#13#10 +
             'bConnect-MCP requires Windows PowerShell 5.1 or newer. Install ' +
             'Windows Management Framework 5.1 and run Setup again.',
             mbCriticalError, MB_OK);
    Exit;
  end;

  { Disk space. Inno checks that the compressed payload fits; this adds the
    headroom the configuration step needs afterwards, and states the figure.
    {autopf} is used rather than {app}, which is not resolved yet. }
  RequiredBytes := {#RequiredFreeMB};
  RequiredBytes := RequiredBytes * 1048576;
  if GetSpaceOnDisk64(ExpandConstant('{autopf}'), FreeBytes, TotalBytes) then
  begin
    if FreeBytes < RequiredBytes then
    begin
      MsgBox('There is not enough free disk space on the installation volume.' + #13#10#13#10 +
             'bConnect-MCP requires ' + IntToStr({#RequiredFreeMB} div 1024) +
             ' GB free; ' + IntToStr(FreeBytes div 1073741824) + ' GB is available. ' +
             'The installed suite includes its Node.js dependencies and its build ' +
             'output, so that nothing has to be compiled on this computer.' + #13#10#13#10 +
             'Free disk space and run Setup again, or choose an installation ' +
             'folder on another volume.', mbCriticalError, MB_OK);
      Exit;
    end;
  end;

  { The Node.js runtime. Detected, not assumed, and NOT replaced when what is
    present is adequate: other software on a bMS server may depend on the Node
    that is already installed, and this product's floor is the one its own
    package metadata declares. }
  NodeFoundVersion := DetectNodeVersion;
  NodeNeeded := (NodeFoundVersion = '') or (not VersionAtLeast(NodeFoundVersion, '{#NodeMinVersion}'));
  if NodeNeeded then
  begin
    if NodeFoundVersion = '' then
      Log('Node.js was not found on PATH. The bundled {#NodeVersion} runtime will be installed.')
    else
      Log('Node.js ' + NodeFoundVersion + ' is older than the required {#NodeMinVersion}. The bundled {#NodeVersion} runtime will be installed.');
  end
  else
    Log('Node.js ' + NodeFoundVersion + ' is already installed and meets the requirement. The bundled runtime will not be installed.');

  Result := True;
end;

{ ---------------------------------------------------------------------------
  One fact stated after the files are down, because it changes what the
  administrator has to do next and it is not a failure.
  --------------------------------------------------------------------------- }
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep <> ssPostInstall then Exit;

  { An existing Node between the declared floor and the preferred version works,
    but does not read the Windows certificate store. Against a bMS with an
    internal-CA certificate that is the difference between an install that
    connects and one that reports a TLS error with no obvious cause. }
  if (not NodeNeeded) and (NodeFoundVersion <> '') and (not VersionAtLeast(NodeFoundVersion, '{#NodePreferredVersion}')) then
    SuppressibleMsgBox('Node.js ' + NodeFoundVersion + ' is installed on this computer and was kept.' + #13#10#13#10 +
      'It meets the minimum requirement. Node.js {#NodePreferredVersion} and newer ' +
      'additionally read the Windows certificate store. If the baramundi ' +
      'Management Suite presents a certificate issued by an internal certificate ' +
      'authority, this version requires BCONNECT_CA_CERT_PATH to be set to a PEM ' +
      'copy of that authority. The configuration step asks for it.' + #13#10#13#10 +
      'A Node.js {#NodeVersion} runtime is included with this installation and was ' +
      'not applied, because replacing a runtime that other software on this ' +
      'computer may depend on is not done without instruction.',
      mbInformation, MB_OK, IDOK);
end;

{ ---------------------------------------------------------------------------
  Uninstall.

  Setup removes what Setup installed. It does NOT remove, without asking:

    * the credentials file (secrets\bconnect.env, or bconnect.env.dpapi),
    * the installation record (install\state\installation.json),
    * the bconnect-* entries this product wrote into MCP client configuration
      files that live outside {app} entirely -- %APPDATA%\Claude, a workspace's
      .mcp.json, ~\.continue, and so on.

  All three belong to the customer and may be in use by tooling this installer
  knows nothing about.

  When the answer is yes, the removal is delegated to bconnect.ps1, which is a
  front end over Install-BConnectMcp.ps1 -Uninstall. There is deliberately no
  file deletion or JSON editing here: an uninstaller that hand-removed host
  entries would be a second implementation of the operation this product is most
  careful about -- rewriting a customer's configuration so that everything it
  does not own comes out byte-identical.
  --------------------------------------------------------------------------- }
function HasCustomerState(): Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\install\state\installation.json')) or
            FileExists(ExpandConstant('{app}\secrets\bconnect.env')) or
            FileExists(ExpandConstant('{app}\secrets\bconnect.env.dpapi'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Script: String;
  Code: Integer;
  Removed: Boolean;
begin
  if CurUninstallStep <> usUninstall then Exit;
  if not HasCustomerState then Exit;

  Removed := False;
  Script := ExpandConstant('{app}\install\bconnect.ps1');

  { Nested rather than joined with `and`: the question must not be asked when
    there is no verb CLI to answer it with, and Pascal Script's boolean
    evaluation order is not something to depend on for a side effect this
    visible. }
  if FileExists(Script) then
  begin
    { Default IDNO: an unattended uninstall keeps the credentials and the client
      configurations. Losing them silently is unrecoverable; leaving them is not. }
    if SuppressibleMsgBox(
         'This computer holds a bConnect-MCP configuration.' + #13#10#13#10 +
         'Remove it as well?' + #13#10#13#10 +
         'Yes: the bConnect credentials file, the installation record and the ' +
         'bconnect-* entries in every configured MCP client are removed. Every ' +
         'other setting in those client files is left unchanged, and each file is ' +
         'backed up first.' + #13#10#13#10 +
         'No: they are left in place. Other tooling may still be using them.' + #13#10#13#10 +
         'Neither answer revokes the bMS API key. Revoke it in the baramundi ' +
         'Management Suite console, under Server Management, API Keys.',
         mbConfirmation, MB_YESNO, IDNO) = IDYES then
    begin
      { -Yes stands in for the typed UNINSTALL confirmation the verb asks for at
        a console. The question above has already been answered. }
      if Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
              '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + Script + '" uninstall -Yes',
              ExpandConstant('{app}\install'), SW_SHOW, ewWaitUntilTerminated, Code) then
      begin
        if Code = 0 then
          Removed := True
        else
          SuppressibleMsgBox('The bConnect-MCP configuration could not be removed completely ' +
            '(exit code ' + IntToStr(Code) + ').' + #13#10#13#10 +
            'The program files are still removed. The credentials file and the MCP ' +
            'client entries were left as they are. Node.js must be present on PATH ' +
            'for this step; if it was uninstalled first, reinstall it and run ' +
            'bconnect.ps1 uninstall by hand.', mbError, MB_OK, IDOK);
      end;
    end;
  end;

  if not Removed then
    SuppressibleMsgBox('The following were NOT removed and remain on this computer:' + #13#10#13#10 +
      '- the bConnect credentials, in the secrets folder of the installation directory;' + #13#10 +
      '- the installation record, in install\state;' + #13#10 +
      '- the bconnect-* entries in the configuration files of the MCP clients that were configured.' + #13#10#13#10 +
      'Those entries name files inside the installation directory that is being ' +
      'removed. Every configured MCP client will therefore show a bconnect-* server ' +
      'that cannot start, until the entries are removed. To remove them later, ' +
      'install this product again and run install\bconnect.ps1 uninstall, or delete ' +
      'the bconnect-* entries from each client configuration by hand.' + #13#10#13#10 +
      'The Node.js runtime is never removed by this uninstaller, because other ' +
      'software on this computer may depend on it.' + #13#10#13#10 +
      'The bMS API key remains valid until it is revoked in the baramundi ' +
      'Management Suite console, under Server Management, API Keys.',
      mbInformation, MB_OK, IDOK);
end;
