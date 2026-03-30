# Windows Deployment Guide — bConnect MCP Suite 26.1.0

This guide covers deploying the bConnect MCP Suite as Windows executables for use with Claude Desktop or Claude Code on Windows.

---

## Prerequisites

- Windows 10/11 or Windows Server 2019/2022
- [Claude Desktop](https://claude.ai/download) installed
- Network access to your baramundi Management Server (bMS)

---

## 1. Download

Download the release artifacts from the GitHub Releases page.

For each of the 12 MCP servers, download:
- `bconnect-<name>-mcp.exe` — the standalone Windows executable
- `bconnect-<name>-mcp.exe.sha256` — SHA-256 checksum file

**Available servers (version 26.1.0):**

| Server | Purpose |
|--------|---------|
| `bconnect-activedirectory-mcp.exe` | AD groups, users, org units |
| `bconnect-assets-mcp.exe` | Asset inventory and management |
| `bconnect-compliance-mcp.exe` | Compliance rules (26R1 only) |
| `bconnect-defensecontrol-mcp.exe` | Defense control policies |
| `bconnect-endpoints-mcp.exe` | Endpoint management |
| `bconnect-jobs-mcp.exe` | Job scheduling and execution |
| `bconnect-operatingsystems-mcp.exe` | OS management and patching |
| `bconnect-servermanagement-mcp.exe` | Server role management |
| `bconnect-software-mcp.exe` | Software deployment |
| `bconnect-universaldynamicgroups-mcp.exe` | Dynamic groups (26R1 only) |
| `bconnect-updatemanagement-mcp.exe` | Windows Update management |
| `bconnect-variables-mcp.exe` | Variable management |

---

## 2. Verify Checksums

```powershell
# In PowerShell, verify each download
Get-FileHash bconnect-activedirectory-mcp.exe -Algorithm SHA256
# Compare output hash with contents of bconnect-activedirectory-mcp.exe.sha256
```

---

## 3. Installation

Place the `.exe` files in a permanent directory, e.g.:

```
C:\Program Files\baramundi\bConnect-MCP\
├── bconnect-activedirectory-mcp.exe
├── bconnect-assets-mcp.exe
├── ...
└── bconnect-variables-mcp.exe
```

---

## 4. Configure Environment

Create a `.env` file or set environment variables system-wide.

**Required for all servers:**

| Variable | Description | Example |
|----------|-------------|---------|
| `BCONNECT_BASE_URL` | bConnect V2.0 API base URL | `https://bms.company.com/bconnect` |
| `BCONNECT_USERNAME` | API username | `mcp-user` |
| `BCONNECT_PASSWORD` | API password | `secret` |

**Optional:**

| Variable | Description | Default |
|----------|-------------|---------|
| `BCONNECT_RELEASE` | API release version | `26R1` |
| `BCONNECT_AUDIT_LEVEL` | Audit logging: `none`, `security`, `write`, `all` | `none` |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set to `0` to allow self-signed certs | `1` |
| `BCONNECT_CA_CERT_PATH` | Path to custom CA certificate file | — |

---

## 5. Configure Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bconnect-activedirectory": {
      "command": "C:\\Program Files\\baramundi\\bConnect-MCP\\bconnect-activedirectory-mcp.exe",
      "env": {
        "BCONNECT_BASE_URL": "https://bms.company.com/bconnect",
        "BCONNECT_USERNAME": "mcp-user",
        "BCONNECT_PASSWORD": "your-password"
      }
    },
    "bconnect-assets": {
      "command": "C:\\Program Files\\baramundi\\bConnect-MCP\\bconnect-assets-mcp.exe",
      "env": {
        "BCONNECT_BASE_URL": "https://bms.company.com/bconnect",
        "BCONNECT_USERNAME": "mcp-user",
        "BCONNECT_PASSWORD": "your-password"
      }
    },
    "bconnect-endpoints": {
      "command": "C:\\Program Files\\baramundi\\bConnect-MCP\\bconnect-endpoints-mcp.exe",
      "env": {
        "BCONNECT_BASE_URL": "https://bms.company.com/bconnect",
        "BCONNECT_USERNAME": "mcp-user",
        "BCONNECT_PASSWORD": "your-password"
      }
    }
  }
}
```

Add entries for each server you want to enable. Restart Claude Desktop after editing.

---

## 6. Run as Windows Service (NSSM)

For unattended operation, use [NSSM](https://nssm.cc/) to run servers as Windows services.

```powershell
# Install NSSM (via winget or download manually)
winget install NSSM.NSSM

# Install each server as a service (example for activedirectory)
nssm install bConnectActiveDirectoryMCP "C:\Program Files\baramundi\bConnect-MCP\bconnect-activedirectory-mcp.exe"
nssm set bConnectActiveDirectoryMCP AppEnvironmentExtra "BCONNECT_BASE_URL=https://bms.company.com/bconnect"
nssm set bConnectActiveDirectoryMCP AppEnvironmentExtra+ "BCONNECT_USERNAME=mcp-user"
nssm set bConnectActiveDirectoryMCP AppEnvironmentExtra+ "BCONNECT_PASSWORD=your-password"
nssm set bConnectActiveDirectoryMCP Start SERVICE_AUTO_START
nssm start bConnectActiveDirectoryMCP
```

---

## 7. Self-Signed / Corporate CA Certificates

If your bMS uses a self-signed or internal CA certificate:

**Option A — Trust the certificate (recommended):**
```powershell
# Export your bMS certificate and set the path
$env:BCONNECT_CA_CERT_PATH = "C:\certs\bms-ca.pem"
```

**Option B — Disable verification (development only):**
```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

---

## 8. Troubleshooting

**Server exits immediately:**
- Check that `BCONNECT_USERNAME` and `BCONNECT_PASSWORD` are set
- Verify `BCONNECT_BASE_URL` is reachable from the Windows machine

**SSL/TLS errors:**
- Set `BCONNECT_CA_CERT_PATH` to your CA certificate
- Or set `NODE_TLS_REJECT_UNAUTHORIZED=0` for testing

**Claude Desktop does not see tools:**
- Verify the `.exe` path in `claude_desktop_config.json` is correct
- Restart Claude Desktop after config changes

---

## Version Information

- **Suite version**: 26.1.0
- **Compatible bConnect releases**: baramundi Management Suite 25R2, 26R1
- **Node.js runtime**: Node 20 (embedded in .exe via pkg)
- **26R1-only servers**: `bconnect-compliance-mcp`, `bconnect-universaldynamicgroups-mcp`
