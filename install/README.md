# bConnect-MCP — what you will need

bConnect-MCP is a set of MCP servers that give an AI assistant read access, and
optionally write access, to a baramundi Management Suite. MCP — Model Context
Protocol — is the standard those assistants use to call external tools.

This page is everything to have in hand before starting. Read it once, collect what
is missing, then run **START-HERE.cmd** at the root of this package (or
`install\Install-BConnectMcp.ps1` from a console). Nothing is collected or changed
until Install is pressed on the last page of the installer.

The installer itself asks four things: where to connect, which MCP clients to
configure, what the assistant may change, and where to install. Everything below
exists so that none of those four questions has to be answered by guessing.

---

## 1. Where the servers will run

The installer asks this first, and it is not a preference.

An MCP server that speaks stdio is a **local process, started by the client
application, on the machine that application runs on**. An installation placed on
the wrong machine reports success and produces no tools.

| Answer | What it means |
|---|---|
| **This computer** | The servers run here as local processes, started by the assistant application itself. Install once per administrator, on each administrator's own computer. This is the usual answer. |
| **A shared service on this server** | The servers run here behind one HTTP endpoint — the gateway — and clients connect to it across the network. Install once, on the computer that is to host the service. Choose this on a server, or where the assistant is a hosted product that cannot start a program on your computer. |

The answer decides which MCP clients are offered and whether the HTTP gateway is
part of the installation. If the assistant runs somewhere other than the computer
being used now, the shared service is the correct answer.

---

## 2. The bConnect base URL

The form is `https://<bms-server>:<port>/bconnect` — for example
`https://bms.example.local:443/bconnect`.

It ends at `/bconnect`. A module segment after it produces doubled paths and a 401
that is indistinguishable from a wrong password. The installer checks this properly
when it runs, and the **Test** button on the first page performs the same check
against the live server without writing anything.

If bConnect is reached through the baramundi Gateway rather than directly, use the
gateway address here.

---

## 3. A bConnect API key

Create it in the bMS console: **Server Management → API Keys**. One key is enough;
every server this installer enables uses the same one.

- For read-only operation the key needs bMS **read** rights on the areas that are
  enabled: endpoints and groups, jobs, software, compliance and vulnerabilities,
  security and encryption, and Active Directory.
- Write access needs more: the same key must also hold the bMS rights to create,
  change and delete those objects. The key's own rights are a boundary underneath
  the installer's permission setting, and a tool permitted there still fails at the
  API without them.
- Copy the key when it is created. bMS does not show it again.

Nothing typed into the installer is echoed, logged, or placed on a command line.
Passwords are held as a SecureString and handed to the engine in process.

### Optional: bConnect v1.1 credentials

bConnect v1.1 is the older interface. It exposes job configuration that v2.0 omits
entirely, and it does not accept an API key: it needs a Windows or Active Directory
domain account that is a member of a bConnect security group, in UPN form —
`user@example.local`.

**That account is a more privileged credential than the API key.** It is a named
user account carrying that user's own rights, and it is not limited by the API
key's rights. Treat it accordingly.

It is optional. Without it, the tools that use v1.1 report reduced detail rather
than failing, and nothing else changes.

### Optional: a CA certificate

Node 22.15 and newer read the Windows certificate store, so a bMS server behind an
internal CA usually needs nothing here. On an older Node, point the installer at a
PEM copy of the issuing CA. If the certificate check fails during a run, the
installer names the specific cause and the file to supply.

---

## 4. Which MCP clients to configure

An MCP client is the application the assistant runs in: a code editor, a chat
application, or an automation tool.

**This installer configures MCP clients. It does not install them.** VS Code,
Claude Desktop, Cursor, the Codex CLI and the others are separate products under
their own licences and are not redistributed in this bundle.

- **On a connected network** that is a short detour: install the client first, then
  run this.
- **On an isolated or air-gapped network**, stage the client installer beside this
  bundle before starting, having downloaded it on a computer that has internet
  access. An isolated network has no route to a vendor download, and without the
  client there is nowhere for the configuration this installer writes to land.

Some clients this installer configures itself; others it cannot. Every row on the
Clients page is marked **AUTOMATIC** or **MANUAL STEPS** before it is selected:

| Badge | What happens |
|---|---|
| **AUTOMATIC** | The installer writes the configuration file that client reads. Restart the client afterwards. |
| **MANUAL STEPS** | The installer cannot write that client's configuration. It writes a file containing the settings, and they are applied in that product's own interface. |

A second badge on the right of each row states how far that target has been
verified:

| Badge | What was proven |
|---|---|
| **VERIFIED HERE** | The host application itself was made to read the emitted file on a real machine. |
| **SERVERS STARTED** | The emitted file was parsed back and every server in it started, handshook and served a real bMS read. That is not proof the host loads it. |
| **SHAPE ONLY** | The file matches the shape that host documents and no credential went into it — and nothing has ever been seen loading it. A well-founded starting point, not a tested integration. |

### Where the configuration applies

The two badges answer how a client is set up and how far it was verified. A third
distinction is on neither badge and matters as much: **where the configuration
takes effect.** Each row states its own answer in the tooltip on its left badge.

| Kind | Where it applies | What that costs |
|---|---|---|
| **Per-workspace** — VS Code, Claude Code, Cursor | One repository directory, and it travels with the repository if the file is committed. | It is available in that repository and nowhere else. |
| **Per-user** — Claude Desktop, Codex, Continue | Every project that client opens, for this Windows account. | Some of these rewrite their configuration from memory when they exit, so they must be closed while the installer writes. |
| **Manual steps** — the rows badged MANUAL STEPS | Wherever the emitted settings are pasted. | The run itself configures nothing. |

For a per-workspace client, have the path to the repository the team actually
opens. The installer asks for it only when one of those clients is selected.

**Claude Desktop and Claude Code are the pair worth reading twice**, because the
names suggest two editions of one product and the behaviour is not the same.
Claude Desktop is per-user, and it must be quit from its tray icon — not merely
closed to the taskbar — while the file is written, because it rewrites that file
from its own memory on exit and will otherwise undo the install. Claude Code is
configured per repository, and in field testing it wrote correctly on every
attempt, including three on which Claude Desktop did not.

---

## 5. Administrator rights, PowerShell and Node.js

**Administrator rights on this computer** are needed if the secrets directory has
to have its ACL rewritten. The installer breaks inheritance on that directory and
applies an explicit ACL with `icacls`, so that the credentials file is readable by
SYSTEM, Administrators and the installing account and by nobody else. Without a
token that may do so, the run stops on an `icacls` error several minutes in.
Re-open the installer as administrator, or choose a secrets directory you own.

**Windows PowerShell 5.1, started with `-Sta`.** A console run of
`Install-BConnectMcp.ps1` needs the same. PowerShell 7 is not supported for either:
it carries neither the .NET Framework presentation assemblies the installer window
is built from, nor the DPAPI type the credential-protection option needs.

**Node.js 22.15 or newer on PATH** runs the servers themselves; 20.x is the minimum
the packages declare. If this computer has no adequate runtime, the installer uses
one staged in `install\packaging\redist`, and installs nothing on a computer that
already has one. `-AllowNodeDownload` adds a third route that fetches the MSI and
verifies it against the published `SHASUMS256.txt`; it is opt-in, so that an
installation believed to be offline never makes a silent outbound call.

The installer checks all of this when the window opens and reports **only what
fails**, on the first page, with the remedy for that specific failure.

---

## 6. Time, disk and network access for the build

A first installation downloads dependencies and builds the server packages. That
takes several minutes and roughly 1.5 GB of free space on the drive holding the
installation.

It needs outbound access to the **npm registry**, unless the offline bundle
produced by `install\lib\New-OfflineBundle.ps1` is used instead. That bundle
carries the dependencies and the built output, so the only step that needed
internet access is already done inside it.

---

## 7. Where the files go

The installation location is a single line on the last page of the installer, with
a **Change** button beside it. Changing it revalidates the new path before the run
starts: free space, write permission, and whether the path is short enough for the
files in this package to fit inside the Windows 260-character limit. A path that
cannot be used is refused there, with the reason, rather than several minutes into
a run.

The **secrets directory** follows the installation location by default and is not
asked as a second question. It is the ACL-hardened directory described above. If it
is relocated, the same hardening is applied to the new directory, and administrator
rights are needed where the account does not already own it.

### How the credentials are stored

| Option | What it gives |
|---|---|
| **Plaintext, protected by the directory ACL** (default) | `node --env-file` reads the file directly. The ACL stops other local accounts; it does not travel with a copy of the file. |
| **DPAPI-encrypted for your Windows account** | Protects a file that leaves the machine — a copy, a backup, an accidental commit. It does not protect against malware running as you, which can call DPAPI itself. Node cannot read DPAPI, so servers are launched through `lib\Start-BConnectServer.ps1`, which decrypts in memory and passes the values in the child process environment block. Nothing decrypted is written to disk or placed on a command line. No vault and no enrolment are required. |

Both are on the Connect page, under **Advanced**. Declining the second gives
exactly the default behaviour.

---

## 8. What the assistant may change

The installer's third page is the one that matters most after the connection
itself.

- **Read only** is selected by default. Every enabled server can read from the
  management suite and can create, change or delete nothing.
- **Allow changes** reveals, per server, which write tools may be used. Write
  access permits a server to create, modify and delete objects in the management
  suite, acting on the production estate. The bMS rights of the API key are a
  second boundary underneath this one; do not rely on them to catch a mistake.

Some servers support a per-tool allowlist and some do not. Where a server has no
allowlist, permitting writes in it unlocks every write tool it has at once,
including its delete tools; the installer states which server that applies to
rather than leaving it to be discovered.

Which of the servers are enabled at all is under **Advanced** on the same page.
Every enabled server's tool schemas are sent to the model on every request, before
anything has been typed, so enabling only what is used has a running cost as well
as a security benefit.

---

## Nothing is written until Install is pressed

The last page carries a **Check (dry run)** button. It performs the whole run —
prerequisites, credentials, and a real call to bConnect — and writes nothing. It is
the fastest way to find out that a URL or a key is wrong.

`INSTALL.md` in the `install` directory is the full reference: every parameter,
every step, the uninstall path and the verb front end (`bconnect.ps1`) for
everyday changes.
