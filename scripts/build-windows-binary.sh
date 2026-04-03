#!/bin/bash
#############################################################################
# Build Windows Binary for bConnect MCP Server
#############################################################################
# Description: Creates standalone Windows executable with pkg
# Author: Claude Code
# Version: 1.0
# Date: October 28, 2025
#############################################################################

set -e  # Exit on error
set -u  # Exit on undefined variable

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
SOURCE_DIR="/workspaces/claudinno/bConnect-MCP"
VERSION=$(node -p "require('${SOURCE_DIR}/package.json').version")
OUTPUT_DIR="dist/windows-binary"
OUTPUT_EXE="bconnect-mcp-${VERSION}.exe"
ZIP_NAME="bconnect-mcp-${VERSION}-windows.zip"

#############################################################################
# Functions
#############################################################################

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_step() {
    echo -e "${BLUE}==>${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

print_header() {
    echo ""
    echo -e "${CYAN}=======================================================${NC}"
    echo -e "${CYAN}  bConnect MCP Server - Windows Binary Builder${NC}"
    echo -e "${CYAN}=======================================================${NC}"
    echo ""
}

check_prerequisites() {
    log_step "Checking prerequisites..."

    # Check if in correct directory
    if [ ! -f "$SOURCE_DIR/package.json" ]; then
        log_error "package.json not found. Please run from bConnect-MCP directory"
    fi

    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found. Please install Node.js 20.x"
    fi
    log_info "✅ Node.js $(node --version) found"

    # Check npm
    if ! command -v npm &> /dev/null; then
        log_error "npm not found"
    fi
    log_info "✅ npm $(npm --version) found"

    # Check pkg
    if ! command -v pkg &> /dev/null; then
        log_warn "pkg not found. Installing globally..."
        npm install -g pkg
    fi
    log_info "✅ pkg $(pkg --version) found"

    # Check zip
    if ! command -v zip &> /dev/null; then
        log_warn "zip not found. Installing..."
        apt-get update -qq && apt-get install -y -qq zip
    fi
    log_info "✅ zip found"
}

clean_output_directory() {
    log_step "Cleaning output directory..."

    cd "$SOURCE_DIR"
    rm -rf "$OUTPUT_DIR"
    rm -rf dist/*.zip
    rm -rf dist/*.sha256
    mkdir -p "$OUTPUT_DIR"

    log_info "✅ Output directory cleaned: $OUTPUT_DIR"
}

build_typescript() {
    log_step "Building TypeScript..."

    cd "$SOURCE_DIR"

    # Remove old build
    rm -rf build/

    # Build
    npm run build

    if [ ! -f "build/index.js" ]; then
        log_error "Build failed: build/index.js not found"
    fi

    log_info "✅ TypeScript compiled ($(du -sh build | cut -f1))"
}

create_windows_executable() {
    log_step "Creating Windows executable with pkg..."

    cd "$SOURCE_DIR"

    # Run pkg (using node18 - pkg 5.8.1 doesn't support node20 yet)
    pkg . \
        --targets node18-win-x64 \
        --output "$OUTPUT_DIR/$OUTPUT_EXE" \
        --compress GZip

    if [ ! -f "$OUTPUT_DIR/$OUTPUT_EXE" ]; then
        log_error "pkg failed: $OUTPUT_EXE not created"
    fi

    local exe_size=$(du -h "$OUTPUT_DIR/$OUTPUT_EXE" | cut -f1)
    log_info "✅ Windows executable created: $OUTPUT_EXE ($exe_size)"
}

copy_data_files() {
    log_step "Copying data files..."

    cd "$SOURCE_DIR"

    # Copy data directory
    if [ -d "data" ]; then
        mkdir -p "$OUTPUT_DIR/data"
        cp -r data/* "$OUTPUT_DIR/data/"
        log_info "✅ Data files copied ($(du -sh $OUTPUT_DIR/data | cut -f1))"
    else
        log_warn "No data directory found"
    fi
}

copy_configuration_files() {
    log_step "Copying configuration files..."

    cd "$SOURCE_DIR"

    # Copy .env.example
    if [ -f ".env.example" ]; then
        cp .env.example "$OUTPUT_DIR/.env.example"
        log_info "✅ Configuration template copied"
    fi
}

create_readme() {
    log_step "Creating README.txt..."

    cat > "$OUTPUT_DIR/README.txt" <<EOF
bConnect MCP Server v${VERSION} - Windows Binary
=================================================

Build Date: $(date +"%Y-%m-%d %H:%M:%S")
Platform: Windows x64
Node.js: 18.x (embedded)

Installation Instructions:
=========================

1. Copy all files to C:\bConnect-MCP\

2. Configure credentials:
   - Copy .env.example to .env
   - Edit .env with your baramundi server details:

     BCONNECT_BASE_URL=https://bms-win22srv:444/bconnect
     BCONNECT_USERNAME=Administrator
     BCONNECT_PASSWORD=your-password
     NODE_TLS_REJECT_UNAUTHORIZED=0

3. Install as Windows service (optional):
   - Run PowerShell as Administrator
   - Execute: .\install-service.ps1

4. Start the service:
   Start-Service bConnect-MCP

Manual Execution:
================

To run without installing as a service:
  .\bconnect-mcp-${VERSION}.exe

The MCP server will start and communicate via stdio.

Service Management:
==================

Status:   Get-Service bConnect-MCP
Start:    Start-Service bConnect-MCP
Stop:     Stop-Service bConnect-MCP
Restart:  Restart-Service bConnect-MCP
Logs:     Get-Content C:\bConnect-MCP\logs\stdout.log -Tail 50 -Wait

Claude Code Integration:
========================

Edit: %APPDATA%\Claude\claude_desktop_config.json

Add:
{
  "mcpServers": {
    "bconnect": {
      "command": "C:\\bConnect-MCP\\bconnect-mcp-${VERSION}.exe",
      "env": {
        "BCONNECT_BASE_URL": "https://bms-win22srv:444/bconnect",
        "BCONNECT_USERNAME": "Administrator",
        "BCONNECT_PASSWORD": "your-password",
        "NODE_TLS_REJECT_UNAUTHORIZED": "0"
      }
    }
  }
}

Troubleshooting:
===============

1. Executable won't run:
   - Check Windows Defender hasn't quarantined it
   - Run as Administrator
   - Check .env file exists and has correct format

2. Cannot connect to baramundi:
   - Test connectivity: ping bms-win22srv
   - Check firewall allows outbound HTTPS (port 444)
   - Verify credentials in .env

3. Service won't start:
   - Check logs: C:\bConnect-MCP\logs\stderr.log
   - Verify .env file exists
   - Run manually first to test

Support:
========

Documentation: See MCP_Deployment/DeployToWindows.md
Version: ${VERSION}
Build: Windows x64 standalone binary
Node.js: Embedded (no separate installation required)

License: MIT
EOF

    log_info "✅ README.txt created"
}

create_installer_script() {
    log_step "Creating PowerShell installer script..."

    cat > "$OUTPUT_DIR/install-service.ps1" <<'POWERSHELL'
#Requires -RunAsAdministrator

# install-service.ps1
# Install bConnect MCP Server as Windows service using NSSM

param(
    [string]$InstallDir = "C:\bConnect-MCP"
)

Write-Host @"
===============================================
  bConnect MCP Service Installation
===============================================
"@ -ForegroundColor Cyan

# Check if NSSM is installed
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Host "NSSM not found. Installing via Chocolatey..." -ForegroundColor Yellow

    if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: Chocolatey not found. Please install NSSM manually:" -ForegroundColor Red
        Write-Host "  1. Download from https://nssm.cc/download" -ForegroundColor Yellow
        Write-Host "  2. Extract to C:\Tools\nssm\" -ForegroundColor Yellow
        Write-Host "  3. Add to PATH" -ForegroundColor Yellow
        exit 1
    }

    choco install nssm -y
}

# Find executable
$exePath = Get-ChildItem -Path $InstallDir -Filter "bconnect-mcp-*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $exePath) {
    Write-Host "ERROR: bconnect-mcp-*.exe not found in $InstallDir" -ForegroundColor Red
    Write-Host "Please extract the ZIP file to $InstallDir first" -ForegroundColor Yellow
    exit 1
}

Write-Host "Found executable: $($exePath.Name)" -ForegroundColor Green

# Check if .env exists
if (-not (Test-Path "$InstallDir\.env")) {
    Write-Host "WARNING: .env file not found" -ForegroundColor Yellow
    Write-Host "Copying .env.example to .env..." -ForegroundColor Cyan

    if (Test-Path "$InstallDir\.env.example") {
        Copy-Item "$InstallDir\.env.example" "$InstallDir\.env"
        Write-Host "Please edit $InstallDir\.env with your credentials" -ForegroundColor Yellow

        $continue = Read-Host "Continue with installation? (yes/no)"
        if ($continue -ne "yes") {
            Write-Host "Installation cancelled" -ForegroundColor Yellow
            exit 0
        }
    } else {
        Write-Host "ERROR: .env.example not found either" -ForegroundColor Red
        exit 1
    }
}

# Remove existing service
$existingService = Get-Service -Name "bConnect-MCP" -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Removing existing service..." -ForegroundColor Yellow
    nssm stop bConnect-MCP
    nssm remove bConnect-MCP confirm
    Start-Sleep -Seconds 2
}

# Create logs directory
New-Item -ItemType Directory -Force -Path "$InstallDir\logs" | Out-Null

# Install service
Write-Host "Installing Windows service..." -ForegroundColor Cyan

nssm install bConnect-MCP "$($exePath.FullName)"
nssm set bConnect-MCP DisplayName "baramundi bConnect MCP Server"
nssm set bConnect-MCP Description "MCP server for baramundi Management Suite API integration (standalone binary)"
nssm set bConnect-MCP Start SERVICE_AUTO_START
nssm set bConnect-MCP AppDirectory $InstallDir
nssm set bConnect-MCP AppExit Default Restart
nssm set bConnect-MCP AppStdout "$InstallDir\logs\stdout.log"
nssm set bConnect-MCP AppStderr "$InstallDir\logs\stderr.log"
nssm set bConnect-MCP AppRotateFiles 1
nssm set bConnect-MCP AppRotateOnline 1
nssm set bConnect-MCP AppRotateSeconds 86400
nssm set bConnect-MCP AppRotateBytes 1048576

# Load environment variables from .env
Write-Host "Loading environment variables from .env..." -ForegroundColor Cyan
$envLoaded = 0

Get-Content "$InstallDir\.env" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        nssm set bConnect-MCP AppEnvironmentExtra "$key=$value"
        Write-Host "  ✓ $key" -ForegroundColor Green
        $envLoaded++
    }
}

if ($envLoaded -eq 0) {
    Write-Host "WARNING: No environment variables loaded from .env" -ForegroundColor Yellow
}

# Start service
Write-Host "Starting service..." -ForegroundColor Cyan
Start-Service bConnect-MCP
Start-Sleep -Seconds 3

# Check status
$service = Get-Service bConnect-MCP
if ($service.Status -eq 'Running') {
    Write-Host @"

===============================================
  ✅ Installation Complete!
===============================================

Service Name:    bConnect-MCP
Status:          $($service.Status)
Startup Type:    $($service.StartType)
Executable:      $($exePath.FullName)

Management Commands:
  Status:   Get-Service bConnect-MCP
  Stop:     Stop-Service bConnect-MCP
  Start:    Start-Service bConnect-MCP
  Restart:  Restart-Service bConnect-MCP

Logs:
  Stdout:   $InstallDir\logs\stdout.log
  Stderr:   $InstallDir\logs\stderr.log
  View:     Get-Content $InstallDir\logs\stdout.log -Tail 50 -Wait

Next Steps:
  1. Configure Claude Code (see README.txt)
  2. Verify MCP server responds
  3. Test with Claude Code application

===============================================
"@ -ForegroundColor Cyan

} else {
    Write-Host @"

===============================================
  ❌ Service Failed to Start
===============================================

Status: $($service.Status)

Troubleshooting:
  1. Check logs: Get-Content $InstallDir\logs\stderr.log
  2. Verify .env file: Get-Content $InstallDir\.env
  3. Test manually: & "$($exePath.FullName)"
  4. Check Windows Event Viewer (Application logs)

===============================================
"@ -ForegroundColor Red

    exit 1
}
POWERSHELL

    log_info "✅ install-service.ps1 created"
}

create_zip_package() {
    log_step "Creating ZIP package..."

    cd "$SOURCE_DIR/$OUTPUT_DIR"

    # Create ZIP
    zip -r -q "../../dist/$ZIP_NAME" .

    if [ ! -f "../../dist/$ZIP_NAME" ]; then
        log_error "ZIP creation failed"
    fi

    cd "$SOURCE_DIR"
    local zip_size=$(du -h "dist/$ZIP_NAME" | cut -f1)
    log_info "✅ ZIP package created: $ZIP_NAME ($zip_size)"
}

generate_checksum() {
    log_step "Generating SHA256 checksum..."

    cd "$SOURCE_DIR/dist"
    sha256sum "$ZIP_NAME" > "${ZIP_NAME}.sha256"

    local checksum=$(cat "${ZIP_NAME}.sha256" | cut -d' ' -f1)
    log_info "✅ Checksum: $checksum"
}

copy_to_network_share() {
    log_step "Copying to network share..."

    if [ -d "/mnt/host-share" ]; then
        cp "dist/$ZIP_NAME" /mnt/host-share/
        cp "dist/${ZIP_NAME}.sha256" /mnt/host-share/
        log_info "✅ Copied to /mnt/host-share/ (\\PCDE220010\Freigabe)"
    else
        log_warn "Network share not mounted at /mnt/host-share"
        log_warn "Manual copy required to Windows host"
    fi
}

print_summary() {
    echo ""
    echo -e "${CYAN}=======================================================${NC}"
    echo -e "${CYAN}  ✅ Build Complete!${NC}"
    echo -e "${CYAN}=======================================================${NC}"
    echo ""
    echo -e "${GREEN}Version:${NC}       $VERSION"
    echo -e "${GREEN}Platform:${NC}      Windows x64"
    echo -e "${GREEN}Package:${NC}       dist/$ZIP_NAME"
    echo -e "${GREEN}Size:${NC}          $(du -h dist/$ZIP_NAME | cut -f1)"
    echo -e "${GREEN}Checksum:${NC}      $(cat dist/${ZIP_NAME}.sha256 | cut -d' ' -f1)"
    echo ""
    echo -e "${BLUE}Package Contents:${NC}"
    echo "  - $OUTPUT_EXE ($(du -h $OUTPUT_DIR/$OUTPUT_EXE | cut -f1))"
    echo "  - data/linked_known_issues.json ($(du -h $OUTPUT_DIR/data/linked_known_issues.json | cut -f1))"
    echo "  - .env.example"
    echo "  - README.txt"
    echo "  - install-service.ps1"
    echo ""
    echo -e "${BLUE}Deployment Instructions:${NC}"
    echo "  1. Copy dist/$ZIP_NAME to Windows"
    echo "  2. Extract to C:\\bConnect-MCP\\"
    echo "  3. Copy .env.example to .env and edit credentials"
    echo "  4. Run: .\\install-service.ps1"
    echo "  5. Start: Start-Service bConnect-MCP"
    echo ""
    echo -e "${BLUE}Network Share:${NC}"
    if [ -f "/mnt/host-share/$ZIP_NAME" ]; then
        echo "  ✅ Available at: \\\\PCDE220010\\Freigabe\\$ZIP_NAME"
    else
        echo "  ⚠️  Not copied to network share \(not mounted\)"
    fi
    echo ""
    echo -e "${CYAN}=======================================================${NC}"
}

#############################################################################
# Main Execution
#############################################################################

main() {
    print_header
    check_prerequisites
    clean_output_directory
    build_typescript
    create_windows_executable
    copy_data_files
    copy_configuration_files
    create_readme
    create_installer_script
    create_zip_package
    generate_checksum
    copy_to_network_share
    print_summary
}

# Run main function
main
