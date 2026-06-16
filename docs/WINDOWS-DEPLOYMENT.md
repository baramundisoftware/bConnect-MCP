# Windows Deployment Guide — bConnect MCP Suite

Deploy the bConnect MCP Suite on Windows for use with Claude Desktop or other MCP clients.

---

## Prerequisites

- Windows 10/11 or Windows Server 2019/2022
- [Node.js 20+](https://nodejs.org/) installed
- Network access to your baramundi Management Server (bMS) on port 444

---

## 1. Download

Download the release archive from the [GitHub Releases](https://github.com/baramundisoftware/bConnect-MCP/releases) page.

Extract to a permanent directory, e.g.:

```
C:\bConnect-MCP\
├── bconnect-endpoints-mcp\
├── bconnect-jobs-mcp\
├── bconnect-assets-mcp\
├── ... (one directory per server)
├── .env.example
└── README.md
```

---

## 2. Install Dependencies

Open PowerShell and run for each server you need:

```powershell
cd C:\bConnect-MCP\bconnect-endpoints-mcp
npm ci --production

cd C:\bConnect-MCP\bconnect-assets-mcp
npm ci --production

# Repeat for each server you want to use
```

---

## 3. Configure

Copy `.env.example` to `.env` in each server directory and edit:

```env
# Your bMS server address (include /bconnect at the end)
BCONNECT_BASE_URL=https://bms.company.com:444/bconnect

# Option 1: API Key (recommended)
BCONNECT_API_KEY=your-api-key-here

# Option 2: Username + Password
# BCONNECT_USERNAME=your-username
# BCONNECT_PASSWORD=your-password

# Your bMS version
BCONNECT_RELEASE=26R1
```

---

## 4. Test

```powershell
cd C:\bConnect-MCP\bconnect-endpoints-mcp
node build/index.js
```

You should see: `bconnect-endpoints-mcp running on stdio`

Press Ctrl+C to stop.

---

## 5. Configure Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bconnect-endpoints": {
      "command": "node",
      "args": ["C:\\bConnect-MCP\\bconnect-endpoints-mcp\\build\\index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms.company.com:444/bconnect",
        "BCONNECT_API_KEY": "your-api-key"
      }
    },
    "bconnect-assets": {
      "command": "node",
      "args": ["C:\\bConnect-MCP\\bconnect-assets-mcp\\build\\index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms.company.com:444/bconnect",
        "BCONNECT_API_KEY": "your-api-key"
      }
    }
  }
}
```

Add an entry for each server you want. Restart Claude Desktop after editing.

---

## 6. Run as Windows Service (Optional)

Use [NSSM](https://nssm.cc/) to run servers as Windows services for unattended operation:

```powershell
# Install NSSM
winget install NSSM.NSSM

# Install a server as a service
nssm install bConnectEndpointsMCP "C:\Program Files\nodejs\node.exe" "C:\bConnect-MCP\bconnect-endpoints-mcp\build\index.js"
nssm set bConnectEndpointsMCP DisplayName "bConnect Endpoints MCP"
nssm set bConnectEndpointsMCP AppDirectory "C:\bConnect-MCP\bconnect-endpoints-mcp"
nssm set bConnectEndpointsMCP AppEnvironmentExtra "BCONNECT_BASE_URL=https://bms.company.com:444/bconnect" "BCONNECT_API_KEY=your-api-key" "BCONNECT_RELEASE=26R1"
nssm set bConnectEndpointsMCP Start SERVICE_AUTO_START

# Start
nssm start bConnectEndpointsMCP
```

---

## 7. SSL/TLS Certificates

If your bMS uses a self-signed or internal CA certificate:

**Recommended:** Provide the CA certificate:
```powershell
$env:BCONNECT_CA_CERT_PATH = "C:\certs\bms-ca.pem"
```

**Development only:**
```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `node` not found | Install Node.js 20+ and restart PowerShell |
| Connection refused | Check bMS URL and port 444 firewall rule |
| SSL errors | Set `BCONNECT_CA_CERT_PATH` or `NODE_TLS_REJECT_UNAUTHORIZED=0` |
| Claude doesn't see tools | Check config JSON path and restart Claude Desktop |
| Service won't start | Run `node build/index.js` manually first to see errors |

---

## Version Information

- **Suite version**: 26.1.5
- **Compatible bMS releases**: 25R2, 26R1
- **Node.js required**: 20+
