# Building the bConnect-MCP setup program

This directory produces **one `.exe`** that a customer runs on their bMS server.
It installs a suite that is already built, a Node.js runtime carried inside it, the
installer, the verb CLI and the configuration GUI — and then offers to launch the
installer. **It needs no internet access on the target machine.** That is the whole
point: a bMS server frequently has none.

| File | |
|---|---|
| `bconnect-mcp.iss` | The Inno Setup 6 script. Every non-obvious directive is commented in place |
| `Start-BConnectConfig.cmd` | Launcher shim for the Start-menu entries and the "configure now" checkbox. It repairs `PATH` and nothing else — see *Why a shim exists* |
| `Test-InnoScript.ps1` | Checks the `.iss` against the tree it packages, without compiling it. **Run it before every build** |
| `baramundi\` | The software package definition for deploying the finished `.exe` with baramundi, and the guard for it. Not coupled to which compiler produced the `.exe` — see that directory's README |
| `redist\` | Where the Node.js MSI is staged. Not in source control |
| `out\` | Where the compiled `.exe` lands. Not in source control |

Two things in this document are commitments the product owner takes on by shipping
this `.exe` at all, rather than build instructions: **[the bundled Node runtime and
its CVEs](#the-bundled-node-runtime-is-a-cve-obligation)** and **[code
signing](#code-signing-is-not-polish)**. Both are at the end.

---

## What you need on the build machine

| | |
|---|---|
| **Inno Setup 6.3 or newer** | https://jrsoftware.org/isdl.php. 6.3 is the floor: the script uses `ArchitecturesAllowed=x64compatible` and `IsX64Compatible`, neither of which exists in 6.2 |
| **An offline bundle** | The output of `install\lib\New-OfflineBundle.ps1`, built on a machine that *does* have internet access |
| **The Node.js x64 MSI** | Downloaded by hand, once, and verified. See below |
| **Windows PowerShell 5.1** | For the validator |

The build machine does **not** need bMS, credentials, or a signing certificate —
unless you are producing a signed release, which is the last section.

---

## 1. Build the offline bundle

On a machine with internet access, from the suite's `install` directory:

```powershell
.\lib\New-OfflineBundle.ps1 -Destination D:\bconnect-mcp-offline
```

That runs `npm ci`, builds `@bconnect/mcp-core`, every `bconnect-*-mcp` server **and
the gateway** (which the suite's own root build script does not, because its glob is
`bconnect-*-mcp` and the gateway directory ends `-gateway`), copies the tree with
`node_modules` and the build output, and writes `offline-bundle.json` — a manifest of
SHA256 hashes, the Node version it was built under, and the build status of every
package.

**Do not package a bundle whose builder exited non-zero.** It writes the bundle
anyway, because the evidence is more useful than an empty directory, but a package
missing a build output cannot be repaired on an air-gapped machine.

The bundle is the suite root: `install\` is inside it and `offline-bundle.json` sits
at its top. That is the layout the `.iss` expects, and it is the layout that lands at
`{app}` on the target — the manifest's paths are relative to itself, so
`Install-BConnectMcp.ps1` can verify the transfer there.

Expect several gigabytes. `node_modules` is a very large number of very small files.

## 2. Stage the Node.js runtime

The `.iss` pins the version in three `#define`s and the validator enforces the
relationship between them:

| Define | Today | Owned by |
|---|---|---|
| `NodeMinVersion` | `20.0.0` | `.nvmrc`, and every package's `engines.node` |
| `NodePreferredVersion` | `22.15.0` | The threshold `Install-BConnectMcp.ps1` warns below — from 22.15 Node reads the Windows certificate store |
| `NodeVersion` | `22.23.2` | The MSI actually bundled. Must satisfy both floors |

`NodeVersion` is deliberately not the newest LTS available. It is the line the suite is
tested on, and shipping a runtime nobody has run the suite against trades a known quantity
for a newer number.

Download the official x64 MSI matching `NodeVersion` and put it in `redist\`:

```powershell
$v = '22.23.2'
New-Item -ItemType Directory -Force .\redist | Out-Null
Invoke-WebRequest "https://nodejs.org/dist/v$v/node-v$v-x64.msi" -OutFile ".\redist\node-v$v-x64.msi"

# Verify it against nodejs.org's own checksum file before it goes into a
# vendor-signed installer. A runtime you did not check is a runtime your
# customer did not check either.
Invoke-WebRequest "https://nodejs.org/dist/v$v/SHASUMS256.txt" -OutFile "$env:TEMP\SHASUMS256.txt"
$want = (Select-String -Path "$env:TEMP\SHASUMS256.txt" -Pattern "node-v$v-x64\.msi").Line.Split(' ')[0]
$have = (Get-FileHash ".\redist\node-v$v-x64.msi" -Algorithm SHA256).Hash.ToLower()
if ($want -ne $have) { throw "checksum mismatch: expected $want, got $have" }
'checksum verified'
```

**To move to a newer 22.x LTS**, change `NodeVersion` in the `.iss`, download the new
MSI, and re-run the validator. It checks that `NodeMsi` still names the file
`NodeVersion` implies, and that `NodeVersion` is still at or above both floors.

**Do not lower `NodeMinVersion` to match a bundled runtime.** It is read from
`.nvmrc` and `engines.node`; if those move, the `.iss` follows them, not the other
way round.

## 3. Check the script before compiling

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-InnoScript.ps1 -BundleDir D:\bconnect-mcp-offline
```

From `install\`, without a bundle to hand:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packaging\Test-InnoScript.ps1
```

Without `-BundleDir`, `Source:` paths are resolved against the working tree arranged
as the published layout. That answers "does this file exist at all", which is the
drift that actually happens; it does not prove the bundler put the file in the
bundle. **Run it with `-BundleDir` immediately before ISCC.**

What it checks, and why a compiler does not:

- **`AppId` is a fixed literal GUID.** A regenerated one gives every upgrade a second
  Add/Remove Programs row over a first installation that can no longer be
  uninstalled. ISCC compiles it happily.
- **The version equals the suite's `package.json`.** Drift there ships the wrong
  thing under the right name.
- **Every `[Files]` entry has a `DestDir`**, every `Source:` resolves to at least one
  real file, and no `Source:` reaches outside the bundle.
- **The pinned Node version still matches** `.nvmrc`, `engines.node`, and the two
  thresholds hard-coded in `Install-BConnectMcp.ps1` — read out of the comparisons
  themselves, not out of a message, because a doc string can be updated while the
  code that decides is not.
- **The payload that matters is carried by an entry**, and the payload that must not
  travel is not: `secrets\`, `install\state\`, `install\out\`.
- **The `.exe` still collects no credentials** — no masked input control, no
  `BCONNECT_*` variable, no `SecureString` handed to the engine.
- **The uninstaller still asks**, still defaults to *no* when nobody is watching, and
  still delegates removal to `bconnect.ps1` instead of hand-editing a customer's JSON.

Exit code 0 means every check passed. **`TODO` lines are not defects** — they are
inputs that are staged before a build (the Node MSI; `offline-bundle.json`, which
only exists in a real bundle). ISCC will refuse to compile until each is in place.

The validator was falsified before it was trusted: 25 deliberate mutations of the
`.iss` — a generated `AppId`, a bumped version, a removed `DestDir`, a `..` in a
`Source`, a widened `Excludes`, an added `[UninstallDelete]`, a masked credential
field, an uninstall confirmation defaulting to *yes*, `recursesubdirs` dropped — were
each observed to fail the check written for it. A guard that has not been made to
fail is not evidence.

## 4. Compile

```powershell
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /DBundleDir="D:\bconnect-mcp-offline" .\bconnect-mcp.iss
```

`BundleDir` has no useful default and the one it has points at a directory that will
not exist, so a build that forgets the switch fails rather than silently packaging a
source tree that was never built.

Output: `out\bConnect-MCP-Setup-<version>.exe`.

`Compression=lzma2/max` with `SolidCompression=yes` is the right trade for a payload
that is mostly `node_modules` — a very large number of very small files — but it is
memory-hungry and slow. Expect a long compile and give the build machine several GB of
free RAM. If it fails for memory, `lzma2/normal` is the first thing to try.

### What to check in the output

| | |
|---|---|
| **ISCC exits 0** and prints no `Warning:` lines | A warning here is usually a `Source:` that matched nothing |
| **The `.exe` is several GB** | If it is tens of megabytes, `node_modules` did not travel — check `Excludes` and the `recursesubdirs` flag |
| **Right-click → Properties → Details** | Version, company `baramundi software GmbH`, product name |
| **The compiler's file count** | Compare with the bundle's own: `(Get-ChildItem D:\bconnect-mcp-offline -Recurse -File).Count` |

Then install it on a clean VM and check, in this order:

1. Setup refuses on a machine that fails a prerequisite, **before writing anything**,
   naming the condition and the remedy.
2. Add/Remove Programs shows one entry, with the version and the publisher.
3. Re-running the same `.exe` upgrades in place. **One** entry, not two.
4. The Start-menu entries open the configuration GUI, the guided installer and the
   verb CLI.
5. `node -v` in a **new** shell reports the bundled version (or the pre-existing one,
   if the machine already had an adequate runtime — the log says which).
6. Uninstall asks about the credentials and the client configurations, and leaves
   them when the answer is no.

## 5. Signing (optional, and required for a release)

The `SignTool` directives in `[Setup]` are **commented out on purpose**: an active
one fails every build on a machine without the certificate, which is most of them.

To produce a signed `.exe`, uncomment `SignTool=baramundi` and
`SignedUninstaller=yes`, then:

```
ISCC.exe ^
  /Sbaramundi="signtool.exe sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /sha1 <THUMBPRINT> $f" ^
  /DBundleDir="D:\bconnect-mcp-offline" ^
  bconnect-mcp.iss
```

`$f` is Inno's placeholder for the file being signed and is substituted by the
compiler; it is not a shell variable.

- `<THUMBPRINT>` is the SHA1 thumbprint of baramundi's code-signing certificate in
  the build machine's certificate store. Prefer a thumbprint to `/f <file.pfx> /p
  <password>` — a password on a command line lands in the build log.
- The timestamp URL may be any RFC 3161 server the signing CA supports. **Without a
  timestamp the signature stops validating the day the certificate expires**,
  including on `.exe` files already deployed.
- `SignedUninstaller` signs the uninstaller Setup writes into the installation
  directory. It is a separate executable and is otherwise unsigned, which customers
  enforcing WDAC or AppLocker will notice.
- Sign on a machine that holds the certificate. Do not carry a `.pfx` to a developer
  workstation to make a one-off build.

**No certificate is named anywhere in this directory, and none is invented.**

---

## What the `.exe` does on the target

1. **Checks prerequisites before writing anything**: 64-bit Windows, Windows 10 build
   17763 / Server 2019 or newer, administrator rights, Windows PowerShell 5.1, and
   4 GB free. Each failure states the condition and the remedy.
2. **Detects Node.js by running `node -v`**, not by reading a registry key — the
   question the suite actually asks is whether `node` is on `PATH`, because
   `Install-BConnectMcp.ps1` resolves it with `Get-Command` and aborts when that
   fails.
   - At or above `NodeMinVersion`: **nothing is installed.** Other software on a bMS
     server may depend on the Node that is there.
   - Below it, or absent: the bundled MSI is installed silently. `ADDLOCAL=ALL` is
     deliberately not used — one of the Node MSI's optional features fetches a
     native-build toolchain from the internet.
   - Adequate but below `NodePreferredVersion`: it is kept, and Setup states that
     this version does not read the Windows certificate store, so an internal-CA bMS
     will need `BCONNECT_CA_CERT_PATH`.
3. **Lays down the pre-built suite** under `{app}`: `node_modules`, every `build\`
   output, `install\` with the installer, the verb CLI and the configuration GUI, and
   `offline-bundle.json` — which `Install-BConnectMcp.ps1` verifies on first run, so a
   truncated transfer is caught rather than presenting as "the servers do not start".
4. **Creates Start-menu entries** and offers to launch the guided installer.

**It collects no credentials.** `Install-BConnectMcp.ps1` already collects them
through a masked prompt, hardens the secrets *directory* before writing into it, and
can DPAPI-protect the result. A second implementation here would be the one that
leaks.

### Uninstall

Setup removes what Setup installed. Before it does, if the machine holds a
configuration it asks once whether to remove that too:

- **Yes** runs `bconnect.ps1 uninstall -Yes`, which removes the credentials file, the
  installation record and the `bconnect-*` entries from every configured MCP client —
  leaving everything else in those files byte-identical, with a backup taken first.
- **No** leaves all three in place. Other tooling may be using them.
- **Unattended** (`/SILENT`) takes *no*. Losing credentials silently is
  unrecoverable; leaving them is not.

Neither answer revokes the bMS API key — only the bMS console can do that, and the
uninstaller says so. The Node.js runtime is never removed.

### Why a shim exists

`Start-BConnectConfig.cmd` is a launcher, not a second installer. It exists for one
reason: the Node MSI adds its directory to the **machine** `PATH`, but a process
Setup launches inherits the environment Setup captured before the MSI ran, so `node`
is not resolvable in it — and `Install-BConnectMcp.ps1` aborts when `Get-Command node`
fails. That reads as "the installation is broken" one second after a successful
install. The shim repairs `PATH` for the process it starts and does nothing else.
Each of its three modes resolves to one of the three existing front ends, unmodified.

---

## What this build procedure does not prove

- **Nothing here has been compiled.** Inno Setup is not installed on the machine this
  was written on. `Test-InnoScript.ps1` checks the things a compiler would not catch;
  it is not a substitute for one. The first ISCC run may still report a syntax error.
- **No `.exe` has been installed, upgraded or uninstalled on any machine.** The
  upgrade-in-place behaviour, the Add/Remove Programs entry, the prerequisite refusals
  and the uninstall prompt are all reasoned from Inno Setup's documented behaviour and
  are **untested**. Step 4's checklist is the test.
- **The configuration GUI was written in parallel.** `Manage-BConnectMcp.ps1` is
  referenced by name by the Start-menu entry and by the shim; it has not been run from
  either. Until it lands in the tree the validator reports it as pending and the shim
  states its absence rather than failing silently.

---

# Standing obligations

Everything above is a procedure that ends when the `.exe` is built. The two sections
below do not end. They are the cost of the two decisions this packaging made — to
carry a runtime inside the installer, and to ship an executable to locked-down
machines — and they belong to the product owner, not to a build script.

<!-- guard:node-cve -->

## The bundled Node runtime is a CVE obligation

**Bundling the Node MSI means owning its CVEs.** The `.exe` carries a Node.js runtime
so that a bMS server with no internet access can be installed at all. That is the
right trade for the customer and it transfers a maintenance duty to baramundi: from
the moment the `.exe` is signed, it contains a specific Node binary, and it keeps
containing that binary until somebody rebuilds it.

### What is pinned, and where

| | |
|---|---|
| **The pinned version** | `22.23.2` |
| **Where it is pinned** | `#define NodeVersion` in `packaging\bconnect-mcp.iss`. That is the only place. `NodeMsi` is derived from it, the `[Files]` entry that stages the MSI is derived from `NodeMsi`, and `Test-InnoScript.ps1` fails if the file on disk is not the one `NodeVersion` implies |
| **The floors it must satisfy** | `NodeMinVersion` (`20.0.0`, owned by `.nvmrc` and every package's `engines.node`) and `NodePreferredVersion` (`22.15.0`, the threshold `Install-BConnectMcp.ps1` warns below). `Test-InnoScript.ps1` enforces `NodeVersion >= NodePreferredVersion >= NodeMinVersion` |
| **Where the version reaches the customer** | Only on machines that had no adequate Node. See below |

### Who is exposed, and who is not

The setup program detects Node by running `node -v`, and **a machine already carrying
Node at or above `NodeMinVersion` keeps it. The bundled MSI is not unpacked at all**
(`Check: NeedsNodeRuntime` on both the `[Files]` entry and the `[Run]` entry). This is
deliberate for a different reason — other software on a bMS server may depend on the
Node that is there — but it also bounds the exposure: an estate that patches Node
through its own channel is unaffected by a stale pin here, and a machine that had
nothing is not.

That bound is worth stating precisely, because it is the difference between a CVE that
requires a release and one that requires a release **and** a remediation campaign:

- Machines where this `.exe` installed Node are running the version this `.exe` pinned,
  and will keep running it until something upgrades it. Nothing in this product
  upgrades it, and the uninstaller never removes it.
- Rebuilding the `.exe` fixes new installations. **It does not fix installed machines.**
  Those need the Node MSI deployed on its own, which for a baramundi customer is an
  ordinary software package and is the right tool for it.

### A Node CVE is a release trigger

Treat a Node.js security release affecting the pinned line as a **release trigger for
this product**, on the same footing as a defect in the suite:

1. Bump `#define NodeVersion` in `bconnect-mcp.iss`. Do **not** lower `NodeMinVersion`
   to match a runtime — that value is read from `.nvmrc` and `engines.node`, and the
   `.iss` follows them, never the reverse.
2. Download the new x64 MSI and verify it against `nodejs.org`'s `SHASUMS256.txt`
   before it goes into a vendor-signed installer. The procedure is in section 2.
3. Update this section's pinned version. `packaging\baramundi\Test-BaramundiPackage.ps1`
   fails if the `.iss` pin and this text disagree, so a bump that does not reach the
   commitment is caught rather than leaving a promise about a runtime that no longer
   ships.
4. Re-run `Test-InnoScript.ps1`, rebuild, re-sign, and re-import the baramundi package
   with the new version and detection rule.
5. Decide, and record, whether installed machines need the Node MSI deployed separately.

The suite's own npm dependencies are a **separate** obligation with a separate cadence.
They ride inside the offline bundle, so the same "rebuild to fix new installations"
property applies to them, and the same "installed machines do not change on their own"
property applies too.

<!-- guard:node-cve-end -->

<!-- guard:code-signing -->

## Code signing is not polish

**On the machines this product is deployed to, an unsigned installer is frequently
blocked outright rather than warned about.** The customer profile is not a developer
laptop: it is a managed Windows estate with application control, run by an organisation
that bought a management suite precisely because it wants that control.

| Control | What it does to an unsigned `.exe` |
|---|---|
| **AppLocker** publisher rules | There is no publisher, so a publisher rule cannot match. The file falls through to a path or hash rule, and in a default-deny configuration it does not run. No prompt, no override |
| **WDAC** | Same, and stricter: policies are commonly signer-based, and an unsigned binary has no signer. The block is enforced by the kernel and is not something a local administrator dismisses |
| **SmartScreen / Mark of the Web** | A downloaded unsigned `.exe` gets the "Windows protected your PC" screen. It is dismissible, which makes it worse rather than better: it trains the customer's administrators to click through the exact warning that exists to stop them |
| **Antivirus and EDR reputation** | An unsigned, several-gigabyte, self-extracting installer with no reputation is a heuristic detection waiting to happen |

The `SignTool` directives in the `.iss` are commented out on purpose, because an active
one fails every build on a machine without the certificate. **That is a build-machine
convenience, not a decision that signing is optional.** Section 5 has the mechanics.

### The part that is an owner action

Certificate provisioning cannot be done by anyone working in this repository, and it
gates whether the product installs at all:

- **Obtaining and renewing an OV or EV code-signing certificate** in baramundi's name is
  a purchase and an organisational-identity validation. It has a lead time measured in
  days to weeks, and it expires.
- **The private key cannot live in a file on a build server.** Since June 2023 the
  CA/Browser Forum baseline requires code-signing private keys to be held in certified
  hardware — a token, an HSM, or a CA-hosted signing service. That is why section 5
  says to sign on a machine that holds the certificate rather than to carry a `.pfx`
  around, and it means the release process needs a signing step with access to that
  hardware. Deciding where that step runs is an owner decision.
- **Timestamping is not optional.** Without an RFC 3161 timestamp the signature stops
  validating the day the certificate expires, on `.exe` files already deployed to
  customers.
- **`SignedUninstaller=yes` has to be on.** The uninstaller Inno writes into the
  installation directory is a separate executable and is otherwise unsigned. A customer
  enforcing WDAC or AppLocker discovers this at uninstall time, which is the worst
  moment to discover it.

**No certificate is named anywhere in this directory, and none is invented.** Until one
exists, the honest statement to a customer is that the installer is unsigned and will
need an explicit allow rule — not that signing is planned.

<!-- guard:code-signing-end -->

---

## Deploying the finished `.exe` with baramundi

A customer with several administrators needs this on every administrator's workstation,
because an stdio MCP server is a local process started by the client application on the
machine that application runs on. `packaging\baramundi\README.md` is the software
package definition for that: the silent command lines, the detection rules, the
prerequisites, and the per-user follow-up that a SYSTEM job cannot do itself.

It is written so that it does **not** depend on which compiler produced the `.exe`. If
Inno Setup is replaced with NSIS, section 11 of that document lists exactly what
changes: the silent switches, the exit-code contract, and the uninstaller filename. The
detection rule is stated as a contract the installer script must satisfy rather than as
a description of what Inno happens to do.
