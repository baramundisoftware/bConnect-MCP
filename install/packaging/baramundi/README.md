# Deploying bConnect-MCP with baramundi

This directory is the baramundi software package definition for the bConnect-MCP setup
program. It is documentation plus one script, not an export: **a `.bdf` / package export
cannot be produced from a source tree.** A package export is written by the bMS console
against a specific bMS database, and it carries object identifiers from that database.
What is here is everything that goes into the console's fields, spelled out so it can be
transcribed without a decision being left to the person transcribing it.

## Why this exists

An stdio MCP server is a local process that the **client application** starts, on the
machine that application runs on. A customer with twenty administrators therefore needs
this installed on twenty workstations. Walking twenty people through a wizard is the work
baramundi exists to remove, so the install has to be deployable by baramundi itself.

Two properties of the product make a single silent deployment actively wrong, and both are
properties of the Windows context rather than of any parameter:

1. **Host configurations resolve to per-user paths** — `{APPDATA}\Claude\…`,
   `{USERPROFILE}\.codex\config.toml`, `{PROJECT}\.vscode\mcp.json`. A baramundi job runs
   as SYSTEM or a service account, whose `%APPDATA%` is
   `C:\Windows\System32\config\systemprofile\AppData\Roaming`. A silent run writing there
   produces files no client will ever read, **and reports success**.
2. **DPAPI protection is CurrentUser scope, deliberately.** A blob written by a service
   account is decryptable by that account only, so every server launched by a real
   administrator fails to start with a decryption error.

So the deployment is two stages. This package is the **machine stage**. It installs
software and records intent. It writes no per-user path and collects no credential.

| Stage | Context | Does | Deployable silently |
|---|---|---|---|
| Machine | SYSTEM, this package | Node, the suite, the install location, the intended client list | Yes |
| User | the administrator's own login, once | Credentials, DPAPI protection, that administrator's client files, verification | No — see *The user stage* |

**The central/gateway shape is different.** A gateway install holds no per-user state at
all, because HTTP clients connect over the network, so it is a single fully silent run
including the credential. It is a different package; see *The gateway shape* below.

---

## 1. Package identity

Transcribe these into the software object's general page.

| Console field | Value |
|---|---|
| Name | bConnect-MCP |
| Manufacturer | baramundi software GmbH |
| Version | 26.1.8 |
| Category / description | MCP integration for the baramundi Management Suite — machine stage |

The version must equal the suite's `package.json` version and the `SuiteVersion` define in
`..\bconnect-mcp.iss`. `..\Test-InnoScript.ps1` already holds those two together;
`Test-BaramundiPackage.ps1` in this directory holds this document to the same value, so a
release bump that forgets the package definition fails a check rather than shipping the
wrong version number under the right name.

## 2. Source files

Place in the package's source directory:

| File | From |
|---|---|
| `bConnect-MCP-Setup-26.1.8.exe` | `..\out\`, produced by the build in `..\README.md` |
| `Register-FinishSetupPrompt.ps1` | this directory |

The `.exe` is several gigabytes. It carries `node_modules`, every build output and the
Node.js runtime, because a bMS server frequently has no internet access. Size the package
share and the endpoint cache accordingly; this is not a package that streams over a slow
site link comfortably.

## 3. Requirements and constraints

The setup program refuses on a machine that fails any of these, **before writing
anything**, naming the condition and the remedy. Setting the same conditions as package
requirements moves that refusal earlier, into a job that never starts.

| Requirement | Value | Where it comes from |
|---|---|---|
| Operating system | Windows 10 build 17763 / Windows Server 2019 or newer | `MinVersion` in the `.iss` |
| Architecture | x64 | `ArchitecturesAllowed=x64compatible`; the bundled Node MSI is the x64 one |
| Free disk space | 4096 MB on the system drive | `RequiredFreeMB` in the `.iss` |
| Execution context | SYSTEM, or any account that is a local administrator | `PrivilegesRequired=admin` |
| Interactive session | not required, and not used | both steps below are non-interactive |

**This package installs software only.** After it succeeds, the machine has Node, the
suite, the installer, the verb CLI, the configuration GUI, and a record naming the clients
that are intended to be configured. It has no credentials and no client configuration.
Nobody can use the product yet. That is the correct outcome of this stage, and step 3
exists so that it does not stay the outcome.

## 4. Step 1 — install the setup program

Execution context **SYSTEM**. No user interface.

<!-- guard:setup-exe -->
```
bConnect-MCP-Setup-26.1.8.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCANCEL /LOG="C:\ProgramData\bConnect-MCP\setup.log"
```

What each switch is for:

- `/VERYSILENT` — no wizard and no progress window. The setup program's last page offers to
  launch the configuration GUI; that offer carries `skipifsilent`, so a silent deployment
  does not start a window in a session nobody is watching. `Test-BaramundiPackage.ps1`
  checks that flag is still on the entry, because losing it would hang this job.
- `/SUPPRESSMSGBOXES` — a message box in a SYSTEM job is a job that runs until it times out.
- `/NORESTART` — the package decides about restarts, not the setup program. Nothing this
  installs requires one; the Node MSI is invoked with `/norestart` as well.
- `/NOCANCEL` — there is no operator to cancel, and a half-cancelled install is worse than a
  failed one.
- `/LOG` — the setup program logs to the temp directory by default, which under SYSTEM is
  `C:\Windows\Temp` and is the first thing a cleanup tool removes. Naming the path puts the
  evidence where the support case can find it.

**Exit codes.** Treat **0 only** as success. Inno Setup returns 1 for a setup that failed
to initialise, 2 and 5 for a cancellation, 6 for a termination and 8 for a required
restart; `/NORESTART` and `/NOCANCEL` make all of those genuine failures here. Do not add
3010 to the success list — nothing in this package asks for a restart, so a 3010 would mean
something unexpected happened.

## 5. Step 2 — the machine stage

Execution context **SYSTEM**. Runs after step 1 succeeds.

The setup program lays the suite down. This step configures the machine half of the
installation: it verifies the transfer against `offline-bundle.json`, resolves Node, builds
what is not built, and writes the installation record carrying the **intended client
list** — which is how each administrator's later user stage knows what to configure without
being told again.

<!-- guard:machine-stage -->
```
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass ^
  -File "C:\Program Files\baramundi\bConnect-MCP\install\Install-BConnectMcp.ps1" ^
  -Stage Machine -NonInteractive ^
  -SuiteRoot "C:\Program Files\baramundi\bConnect-MCP" ^
  -SecretsDir "C:\ProgramData\bConnect-MCP\secrets" ^
  -StateFile "C:\ProgramData\bConnect-MCP\installation.json" ^
  -Servers bconnect-endpoints,bconnect-jobs,bconnect-compliance ^
  -Hosts claude-desktop,vscode
```

The console's command-line field takes **one line**. The carets and line breaks above are
for reading; remove them when transcribing.

Decisions this command line encodes, and what to change:

| Part | Meaning | Change it when |
|---|---|---|
| `-Stage Machine` | Do the machine half only. The user half is refused from a context with no interactive user profile, which is the point of it. | Never, in this package |
| `-NonInteractive` | Ask nothing. Anything unanswerable is a hard error naming the missing parameter, never a hang on a prompt no-one can see. | Never, in this package |
| `-SuiteRoot` | Where the setup program put the suite. Matches `DefaultDirName` in the `.iss`. | The package overrides the install directory |
| `-SecretsDir` | Where the **user stage** will later write credentials. Created here with a restrictive ACL before anything can be written into it. Nothing is written into it by this stage. | A customer standard puts application data elsewhere |
| `-StateFile` | The installation record. Outside the install directory on purpose, so an upgrade of the software does not sit on top of it. **The detection rule in section 7 keys on this exact path.** | Only together with the detection rule |
| `-Servers` | Which MCP servers to enable. Each one costs context in the client, so this is a product decision, not a default to accept. | Per customer |
| `-Hosts` | Which client applications each administrator's user stage will configure. **Records intent only** — no client file is written by this stage. `-ProjectDir` is deliberately not passed, because the workspace belongs to whoever opens it. | Per customer |

**No credential parameter appears here, and none may be added.** There is deliberately no
`-ApiKey` in the installer: a secret on a command line lands in the process list, in any
transcript, and in the baramundi job definition and its logs, which is worse than the
problem it would solve. The SecureString parameters that do exist cannot be typed on a
command line at all. `Test-BaramundiPackage.ps1` fails if a credential parameter appears in
this block.

Exit code 0 is success. Non-zero is a failure with the reason on standard output, which
baramundi captures.

**`-SkipBuild`** is available and is tempting here, because the offline bundle already
carries every build output. It is not in the line above on purpose: the build step is what
turns a truncated or partially restored transfer into a failed job instead of into servers
that do not start. Add it only where the build time is measured and the transfer is
verified by other means.

## 5b. One package per access level

The command line in section 5 is one access level. Copy the package, change three parts, and
the copy is another. Nothing else differs, and there is no tiering feature to configure —
the parameters already carry it.

A read-only level, for administrators who ask questions but do not change anything:

```
  -Stage Machine -NonInteractive ^
  -Servers bconnect-endpoints,bconnect-compliance,bconnect-software ^
  -AuditLevel write ^
  -Hosts vscode
```

No `-WriteGate`, so every write tool stays hidden and refused. Three servers rather than
thirteen, because each one an assistant loads costs context whether or not it is used.

A level that may run jobs, and only the two job operations it needs:

```
  -Stage Machine -NonInteractive ^
  -Servers bconnect-endpoints,bconnect-compliance,bconnect-software,bconnect-jobs ^
  -WriteGate @{ 'bconnect-jobs' = @('create_job_instance','start_job_instance') } ^
  -AuditLevel write ^
  -Hosts vscode
```

Which levels exist, and what each may do, is a customer decision. Name them after the bMS
security profiles that already exist rather than inventing a second vocabulary — the
profile is where the authority actually lives, as the next paragraph explains.

### The gates are not the boundary

**`-WriteGate` decides what the assistant is offered. The bMS API key's own rights decide
what succeeds.** The two are separate, and only one of them is enforced somewhere the
administrator cannot reach:

- The gate is configuration, in a file under that administrator's own profile. They can
  edit it. Even if they could not, the API key works from any HTTP client, and `curl` does
  not read `ALLOW_WRITE_OPERATIONS`.
- The key's rights are enforced by the bMS server.

So give each access level **a key whose bMS rights match its gates**. The gate then keeps
the assistant from attempting what would be refused — which is worth having, because a
model that cannot see a tool does not propose it, and an operation that 403s halfway
through is worse than one never started. But the containment is the key, not the gate.

A level whose gates are narrower than its key is merely tidy. A level whose gates are wider
than its key produces confusing failures. A level that relies on the gate alone for
containment has none.

## 6. Step 3 — register the user-context follow-up

Execution context **SYSTEM**. Runs after step 2 succeeds.

```
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SOURCEDIR%\Register-FinishSetupPrompt.ps1"
```

Substitute the package source variable this bMS version uses for the package's own source
directory. The script's `-InstallDir` defaults to
`%ProgramFiles%\baramundi\bConnect-MCP`; pass it if the package overrode the install
directory.

What it does and why it is a separate step is in *The user stage*, below.

## 7. Detection rules

Three rules, answering three different questions. Use the first for "is the software
installed", the third for "has the machine stage run".

### 7.1 Is this version of the software installed

<!-- guard:detection -->
```
Type      Registry value
Hive      HKEY_LOCAL_MACHINE
View      64-bit
Key       SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{E57A7E00-0000-4000-8000-000000000023}_is1
Value     DisplayVersion
Operator  is at least
Data      26.1.8
```

**What it keys on.** The GUID is `AppId` in `..\bconnect-mcp.iss`, and `AppId` is a fixed
literal that never changes across versions — that is what makes an upgrade land on top of
the previous installation instead of beside it, and it is checked by
`..\Test-InnoScript.ps1`. `DisplayVersion` is written from `AppVersion`, which is
`SuiteVersion`, which equals the suite's `package.json` version.

**The `_is1` suffix is Inno Setup's convention, and it is the one format-coupled thing in
this package.** See *If the installer format changes*.

The 64-bit view matters: `ArchitecturesInstallIn64BitMode=x64compatible` puts the
uninstall key in the native view, not under `Wow6432Node`. A rule that reads the 32-bit
view finds nothing and redeploys on every run.

### 7.2 Is the payload present (format-independent)

<!-- guard:detection-file -->
```
Type      File exists
Path      %ProgramFiles%\baramundi\bConnect-MCP\install\Install-BConnectMcp.ps1
```

**What it keys on.** The one file that has to be there for any of this to work: the
installer engine itself, laid down by the `[Files]` entry that carries the whole bundle to
`{app}`. It carries no version, so it cannot answer "is this the current version" — it
answers "did the payload arrive", which is the question that survives a change of installer
format unchanged. Use it as a secondary condition, not as the only one.

### 7.3 Has the machine stage run

<!-- guard:detection-record -->
```
Type      File exists
Path      C:\ProgramData\bConnect-MCP\installation.json
```

**What it keys on.** The installation record written by step 2, at the path step 2's
`-StateFile` names. `Test-BaramundiPackage.ps1` checks these two are the same string, so
moving one without the other fails a check rather than producing a package that redeploys
itself forever.

The record holds no secret. The bConnect v1.1 username is an identity, and the gateway
token is recorded as a fact rather than as a value, which is why it is readable without
DPAPI and why a rule may key on it.

## 8. The user stage

**This cannot be silent, and no amount of packaging makes it silent.** It needs a
credential typed by the administrator whose Windows account will hold it, in that
administrator's own login, because DPAPI is CurrentUser scope. Until it has run for an
administrator, that administrator has no working installation.

Three ways to reach it. Choose one.

### Pattern A — a second baramundi job, in the logged-on user's context (recommended)

The most baramundi-native answer and the one with the least machinery: a second job whose
step runs in the context of the logged-on user, in the interactive session, launching

```
"C:\Program Files\baramundi\bConnect-MCP\install\Start-BConnectConfig.cmd" manage
```

`Start-BConnectConfig.cmd` is a launcher, not a second installer. It repairs `PATH` so that
`node` resolves in a process started before the Node MSI's `PATH` change was visible, and
then starts the configuration GUI unmodified.

The execution-context and interactive-session options differ in name between bMS versions,
and **this has not been tested against any bMS console.** Confirm the exact option names
against the version in use.

### Pattern B — Active Setup, registered by step 3

`Register-FinishSetupPrompt.ps1` writes an Active Setup component. Windows runs its
`StubPath` **once per user**, at that user's first logon after the component version
changed, and records completion under that user's own `HKCU`. That is exactly the shape of
the problem: machine-installed, needs one action per person, must not repeat.

The `StubPath` starts the configuration GUI detached and returns immediately, because
Active Setup runs synchronously during logon and a `StubPath` that waits holds up the
desktop.

Known costs, stated rather than discovered:

- Active Setup is a long-standing but undocumented Windows mechanism. It is widely relied
  on; it is not contractual.
- It fires for **every** user who logs on, not only administrators. A non-administrator
  gets a window offering a configuration they cannot complete. On a workstation dedicated
  to one administrator that is a non-issue; on a shared server it is a reason to prefer
  pattern A.
- It runs before the shell has finished starting, so the window can appear behind other
  windows.

### Pattern C — a per-machine Run key

Rejected, and recorded so it is not proposed again. `HKLM\…\Run` fires at **every** logon of
**every** user, forever. Making it fire once per person requires a per-user marker and the
logic to check it — which is Active Setup, reimplemented by hand and less well.

### What the administrator does

Whichever pattern delivers it, the GUI decides its own first-run state by reading the
installation record: a record written by the machine stage, with no credentials file beside
it, is an installation whose user stage has not run. **No flag is passed to select that
state**, because the condition would then have two implementations — the one that decides
and the one that asserts. The GUI owns it.

The equivalent by hand, for an administrator who would rather use a command line, is in the
installer's own help under `-Stage`:

<!-- guard:user-stage -->
```
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "& { $k = Read-Host 'bConnect API key' -AsSecureString; ^
       & 'C:\Program Files\baramundi\bConnect-MCP\install\Install-BConnectMcp.ps1' ^
         -Stage User -NonInteractive ^
         -StateFile 'C:\ProgramData\bConnect-MCP\installation.json' ^
         -BaseUrl 'https://bms.corp.example/bconnect' -ApiKeySecure $k ^
         -ProjectDir 'C:\Repos\infra' }"
```

The SecureString is built in the process that uses it. There is no `-ApiKey`, and the
masked prompt is the only interactive way in. `-ProjectDir` is required only when the
intended client list includes a per-workspace target — `vscode`, `claude-code`, `cursor`.

## 9. The gateway shape

A central install serving HTTP clients has no per-user state, so it is one fully silent run
including the credential, and it is permitted from a service context. It is a **different
package** with a different command line, documented in the installer's help under `-Stage`,
case 3. Two points that belong here:

- The service credential reaches the process through the **environment of the job**, never
  through a command line.
- Do not add `-ProtectCredentials` to it. DPAPI would bind the credential to the service
  account, and every later run under any other account would fail to decrypt it.

`Test-BaramundiPackage.ps1` checks that no gateway example in this directory carries
`-ProtectCredentials`.

## 10. Uninstall

Uninstall command, execution context SYSTEM:

```
"C:\Program Files\baramundi\bConnect-MCP\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

`unins000.exe` is Inno Setup's name for the uninstaller it writes into the install
directory; the exact filename is format-coupled in the same way section 7.1 is. Read it
from the `UninstallString` value under the key in section 7.1 rather than hard-coding it.

**A silent uninstall keeps the credentials and the client configurations.** The uninstaller
asks whether to remove them and takes *no* when nobody is watching, because losing
credentials silently is unrecoverable and leaving them is not. To remove them as well, run
the verb CLI first:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\baramundi\bConnect-MCP\install\bconnect.ps1" uninstall -Yes
```

— and note that it must run **in each administrator's own login**, because the credentials
and the client files it removes are that administrator's. A SYSTEM job cannot remove them,
for exactly the reason it cannot create them.

Neither path revokes the bMS API key. Only the bMS console can do that.

To undo step 3: `Register-FinishSetupPrompt.ps1 -Remove`.

## 11. If the installer format changes

The Inno Setup script exists, but Inno now requires a paid commercial licence for
for-profit use and that licence is under review. NSIS is the likely free alternative.
**This package definition is deliberately not coupled to which compiler produced the
`.exe`**: it invokes an executable with a silent command line and evaluates a detection
rule, and both of those are properties of the package, not of the compiler.

What would change, exactly:

| | Changes? | What to do |
|---|---|---|
| Sections 1, 2, 3 | No | — |
| Step 1's **switches** (§4) | Yes | NSIS uses `/S` and `/D=`, not `/VERYSILENT` and `/DIR=`. Rewrite the switch list; the shape of the step is unchanged |
| Step 1's exit-code contract | Yes | NSIS returns 0 or 1 by default. Re-establish which codes mean success and record them |
| Step 2 (§5) | No | It invokes `Install-BConnectMcp.ps1`, which is payload, not packaging |
| Step 3 (§6) | No | Same reason |
| Detection 7.1 | **Yes — the key name** | The `_is1` suffix is Inno's. Under NSIS the uninstall key name is chosen by the script, so **choose the same one**: write `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{E57A7E00-0000-4000-8000-000000000023}_is1` with `DisplayVersion` and `UninstallString` deliberately. Treat this document's rule as the contract the installer script must satisfy, not as a description of what Inno happens to do |
| Detection 7.2 | No | It keys on a payload file |
| Detection 7.3 | No | It keys on a file the engine writes |
| Uninstall filename (§10) | Yes | Read `UninstallString`, do not hard-code |
| The user stage (§8) | No | Nothing in it is installer-format aware |

The `SuiteVersion` / `AppId` / `DisplayVersion` relationship in section 7.1 is checked
against `..\bconnect-mcp.iss` today. If the `.iss` is replaced, point
`Test-BaramundiPackage.ps1` at whatever declares those three values instead. The check must
follow the declaration; it must not become a second copy of it.

## 12. Checking this package definition

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-BaramundiPackage.ps1
```

It parses the parameter block of `Install-BConnectMcp.ps1` and asserts that every parameter
named in the command lines above actually exists — **a documented flag that does not exist
is the defect most likely here**, and it presents on a customer's machine as a job that
fails at 100% deployed. It also asserts that the detection rules key on things the
installer really creates, that the record path in section 7.3 is the `-StateFile` in section
5, that no credential parameter appears in a machine-stage or gateway command line, and
that the version in section 1 is the version the `.iss` and `package.json` agree on.

Exit code 0 means every check passed.

## 13. What none of this proves

- **No bMS console has seen any of it.** No software object was created, no job was
  defined, no package was imported, no endpoint was deployed to. Every console field name
  here is from the product's documented vocabulary and may differ in the version in use.
- **No `.exe` has been built**, so nothing has been deployed and no detection rule has ever
  been evaluated by baramundi. The registry key in section 7.1 is derived from Inno Setup's
  documented behaviour and from `AppId`; it has not been observed on a machine.
- **Active Setup has not been tested.** `Register-FinishSetupPrompt.ps1` writes and removes
  the registry values, and that much is testable; that Windows then runs the `StubPath` at
  the next logon of a user who has not run it is reasoned from how Active Setup works, not
  observed.
- **The user-stage patterns have not been run end to end.** Pattern A depends on
  execution-context options whose names were not confirmed against a console.
