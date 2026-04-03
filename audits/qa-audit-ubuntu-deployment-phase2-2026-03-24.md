# QA Audit: Ubuntu Deployment — Phase 2
**Date:** 2026-03-24
**Scope:** MCP_Deployment scripts and tests (ARM64 host)
**Auditor:** QualityAssuranceEngineer role

---

## 1. Executive Summary

**Score: 100% — PASS**

All Phase 2 quality verification checks pass. Both test scripts return `RESULT: ALL ASSERTIONS PASSED`. All static checks on both deployment scripts are clean. The ARM64 limitation is documented in the new `INSTALL-ON-UBUNTU.md` file.

---

## 2. Per-Category Results

| Check | Item | Result |
|---|---|---|
| Test suite | `tests/verify-claude-code-config.sh` | PASS |
| Test suite | `tests/verify-claude-desktop-install.sh` | PASS |
| Dependency | `jq` available at `/usr/bin/jq` (v1.7) | PASS |
| Static: configure script | `set -e` present (line 24) | PASS |
| Static: configure script | No hardcoded credentials | PASS |
| Static: configure script | `--docker` flag present and handled | PASS |
| Static: install script | Architecture detection `uname -m` (line 27) | PASS |
| Static: install script | ARM64 warning/fallback block (`aarch64` conditional, line 118) | PASS |
| Static: install script | Official Anthropic `.deb` URL referenced (line 82) | PASS |
| Documentation | `INSTALL-ON-UBUNTU.md` created with ARM64 limitation section | PASS |

---

## 3. Test Results Detail

### `bash tests/verify-claude-code-config.sh`

```
PASS: configure-claude-code-ubuntu.sh exists
PASS: configure-claude-code-ubuntu.sh exits 0 on first run
PASS: ~/.claude.json exists after first run
PASS: mcpServers entry with key containing 'bconnect' found in ~/.claude.json
PASS: mcpServers entry points to <FAKE_MCP_DIR>/build/index.js
PASS: configure-claude-code-ubuntu.sh exits 0 on second run
PASS: mcpServers 'bconnect' entry appears exactly once after two runs (count=1)
RESULT: ALL ASSERTIONS PASSED
```

### `bash tests/verify-claude-desktop-install.sh`

```
PASS: install-claude-desktop-ubuntu.sh exists
PASS: nativefier does not appear outside an ARM64 conditional block
PASS: script contains .deb package installation logic (dpkg -i or apt install)
PASS: script contains ARM64 fallback logic (arm64/aarch64 in a conditional)
RESULT: ALL ASSERTIONS PASSED
```

---

## 4. Static Analysis Detail

### `configure-claude-code-ubuntu.sh`

| Check | Finding |
|---|---|
| `set -e` | Present at line 24 |
| Hardcoded credentials | None — default values use placeholder strings (`your-username`, `your-password`); real credentials are loaded from `.env` at runtime |
| `--docker` flag | Declared in usage comment (line 8), handled in argument parser (line 48), applied in server-entry builder (lines 172–192) |

### `install-claude-desktop-ubuntu.sh`

| Check | Finding |
|---|---|
| Architecture detection | `ARCH=$(uname -m)` at line 27 |
| ARM64 warning message | Line 119: `[WARN] ARM64: official .deb not available, using nativefier fallback` |
| Official `.deb` URL | Line 82: `https://storage.googleapis.com/osprey-downloads-c02f6a0d-347c-492b-a752-3e0651722e97/nspawn-root/claude-desktop_latest_amd64.deb` |

---

## 5. Compliance Score

| Category | Passed | Total | % |
|---|---|---|---|
| Test suites | 2 | 2 | 100% |
| Static checks (configure script) | 3 | 3 | 100% |
| Static checks (install script) | 3 | 3 | 100% |
| Documentation | 1 | 1 | 100% |
| **Total** | **9** | **9** | **100%** |

---

## 6. ARM64 Limitation — Documented

File: `/home/ansible/MCP/MCP_Deployment/INSTALL-ON-UBUNTU.md`

Key points documented:

- **amd64**: `install-claude-desktop-ubuntu.sh` downloads and installs the official
  Anthropic `.deb` package; Claude Desktop reads `claude_desktop_config.json` for MCP servers.
- **arm64**: No official `.deb` exists; the script falls back to a nativefier wrapper of
  `https://claude.ai`. The nativefier wrapper does **not** support the local MCP stdio
  transport, so `claude_desktop_config.json` has no effect.
- **`configure-claude-code-ubuntu.sh`**: Works on both architectures. Writes to
  `~/.claude.json` for Claude Code CLI; unaffected by the Desktop limitation.
- Full amd64 round-trip testing (actual `.deb` install + Desktop verification) cannot be
  run on this ARM64 host and must be performed on an amd64 Ubuntu system.

---

## 7. Action Required

None. All checks pass. ARM64 limitation is documented.

---

## 8. Optional Improvements

- The legacy file `INSTALL-ON-UBUNTUCLAUDE.md` contains hardcoded example credentials
  (`baramundi-2008`, `Administrator`) in its troubleshooting section. Consider redacting
  or replacing with placeholder values in a future housekeeping pass.
- A future CI job on an amd64 runner could execute the full `.deb` download + install
  round-trip to complement the static tests that run on ARM64.
