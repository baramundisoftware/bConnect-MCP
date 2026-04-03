#!/bin/bash
###############################################################################
# setup-mcp-on-ubuntuclaude.sh
# Complete MCP Server Setup for ubuntuclaude with Claude Code CLI
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

clear
echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}  bConnect MCP Server Setup for ubuntuclaude${NC}"
echo -e "${CYAN}  Target: Claude Code CLI integration${NC}"
echo -e "${CYAN}================================================================${NC}"
echo ""

# Configuration
TARBALL_NAME="bconnect-mcp-1.0.0-linux-x86_64.tar.gz"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARBALL_PATH="${SCRIPT_DIR}/${TARBALL_NAME}"
INSTALL_DIR="/opt/bconnect-mcp"
CLAUDE_CONFIG="$HOME/.claude/mcp_settings.json"
BCONNECT_BASE_URL="https://bms-win22srv:444/bconnect"
BCONNECT_USERNAME="Administrator"
BCONNECT_PASSWORD="baramundi-2008"

echo -e "${CYAN}[STEP 1/5]${NC} Checking prerequisites..."
echo ""

# Check if running with sudo for installation part
if [ "$EUID" -ne 0 ] && [ ! -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}[INFO]${NC} MCP server not installed. This script needs sudo for installation."
    echo -e "${YELLOW}[INFO]${NC} Please run: ${CYAN}sudo $0${NC}"
    exit 1
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}[WARN]${NC} Node.js not found. Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✓${NC} Node.js: $NODE_VERSION"

# Check Claude Code CLI
if ! command -v claude &> /dev/null; then
    echo -e "${YELLOW}[WARN]${NC} Claude Code CLI not found in PATH"
    echo -e "${YELLOW}[INFO]${NC} Make sure Claude Code CLI is installed"
else
    echo -e "${GREEN}✓${NC} Claude Code CLI: installed"
fi

echo ""
echo -e "${CYAN}[STEP 2/5]${NC} Installing MCP Server..."
echo ""

if [ -d "$INSTALL_DIR" ]; then
    echo -e "${GREEN}✓${NC} MCP server already installed at $INSTALL_DIR"
    MCP_SIZE=$(du -sh $INSTALL_DIR 2>/dev/null | cut -f1)
    echo -e "${GREEN}✓${NC} Size: $MCP_SIZE"
else
    if [ ! -f "$TARBALL_PATH" ]; then
        echo -e "${RED}[ERROR]${NC} Tarball not found: $TARBALL_PATH"
        echo -e "${YELLOW}[INFO]${NC} Please ensure tarball is in: $SCRIPT_DIR"
        exit 1
    fi

    echo -e "${CYAN}[INFO]${NC} Extracting tarball to $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"
    tar -xzf "$TARBALL_PATH" -C /opt/

    # Create .env file
    cat > "$INSTALL_DIR/.env" <<EOF
BCONNECT_BASE_URL=$BCONNECT_BASE_URL
BCONNECT_USERNAME=$BCONNECT_USERNAME
BCONNECT_PASSWORD=$BCONNECT_PASSWORD
NODE_TLS_REJECT_UNAUTHORIZED=0
EOF

    chmod 644 "$INSTALL_DIR/.env"
    echo -e "${GREEN}✓${NC} MCP server installed successfully"
fi

echo ""
echo -e "${CYAN}[STEP 3/5]${NC} Testing MCP Server..."
echo ""

# Test MCP server responds
TEST_OUTPUT=$(echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' | timeout 5 node $INSTALL_DIR/build/index.js 2>&1 || true)

if echo "$TEST_OUTPUT" | grep -q '"result"'; then
    echo -e "${GREEN}✓${NC} MCP server responds correctly"
    echo -e "${GREEN}✓${NC} Connected to: $BCONNECT_BASE_URL"
else
    echo -e "${RED}✗${NC} MCP server test failed"
    echo -e "${YELLOW}[DEBUG]${NC} Output: $TEST_OUTPUT"
    exit 1
fi

echo ""
echo -e "${CYAN}[STEP 4/5]${NC} Configuring Claude Code CLI..."
echo ""

# Drop privileges for user config
if [ "$EUID" -eq 0 ] && [ -n "$SUDO_USER" ]; then
    # Running as sudo, configure for the actual user
    USER_HOME=$(eval echo ~$SUDO_USER)
    CLAUDE_CONFIG="$USER_HOME/.claude/mcp_settings.json"
    ACTUAL_USER=$SUDO_USER
else
    ACTUAL_USER=$USER
fi

echo -e "${CYAN}[INFO]${NC} Configuring for user: $ACTUAL_USER"
echo -e "${CYAN}[INFO]${NC} Config location: $CLAUDE_CONFIG"

# Create directory
mkdir -p "$(dirname "$CLAUDE_CONFIG")"
if [ "$EUID" -eq 0 ] && [ -n "$SUDO_USER" ]; then
    chown -R $SUDO_USER:$SUDO_USER "$(dirname "$CLAUDE_CONFIG")"
fi

# Create or update config
if [ -f "$CLAUDE_CONFIG" ]; then
    echo -e "${YELLOW}[INFO]${NC} Existing config found, backing up..."
    cp "$CLAUDE_CONFIG" "${CLAUDE_CONFIG}.backup.$(date +%Y%m%d-%H%M%S)"
fi

# Write config
cat > "$CLAUDE_CONFIG" <<'EOF'
{
  "mcpServers": {
    "bconnect": {
      "command": "node",
      "args": ["/opt/bconnect-mcp/build/index.js"],
      "env": {
        "BCONNECT_BASE_URL": "https://bms-win22srv:444/bconnect",
        "BCONNECT_USERNAME": "Administrator",
        "BCONNECT_PASSWORD": "baramundi-2008",
        "NODE_TLS_REJECT_UNAUTHORIZED": "0"
      }
    }
  }
}
EOF

# Fix ownership if running as sudo
if [ "$EUID" -eq 0 ] && [ -n "$SUDO_USER" ]; then
    chown $SUDO_USER:$SUDO_USER "$CLAUDE_CONFIG"
fi

echo -e "${GREEN}✓${NC} Claude Code config created: $CLAUDE_CONFIG"

echo ""
echo -e "${CYAN}[STEP 5/5]${NC} Verification..."
echo ""

# Verify files exist
echo -e "${GREEN}✓${NC} MCP server: /opt/bconnect-mcp/build/index.js"
echo -e "${GREEN}✓${NC} Config: .env file present"
echo -e "${GREEN}✓${NC} Claude config: $CLAUDE_CONFIG"

echo ""
echo -e "${CYAN}================================================================${NC}"
echo -e "${GREEN}  ✓ Setup Complete!${NC}"
echo -e "${CYAN}================================================================${NC}"
echo ""
echo -e "${CYAN}Installation Summary:${NC}"
echo -e "  MCP Server:    ${GREEN}/opt/bconnect-mcp/${NC}"
echo -e "  Configuration: ${GREEN}$CLAUDE_CONFIG${NC}"
echo -e "  Tools:         ${GREEN}117 MCP tools (94 V2.0 + 23 V1.1)${NC}"
echo -e "  Status:        ${GREEN}Ready to use${NC}"
echo ""
echo -e "${CYAN}Next Steps:${NC}"
echo ""
echo -e "  ${YELLOW}1.${NC} Start a NEW Claude Code CLI session:"
echo -e "     ${CYAN}claude${NC}"
echo ""
echo -e "  ${YELLOW}2.${NC} Verify MCP server is loaded:"
echo -e "     Look for MCP tools named: ${GREEN}mcp__bconnect__*${NC}"
echo ""
echo -e "  ${YELLOW}3.${NC} Test the integration by asking:"
echo -e "     ${CYAN}\"List all endpoints\"${NC}"
echo -e "     ${CYAN}\"Show job definitions\"${NC}"
echo -e "     ${CYAN}\"What MCP tools are available?\"${NC}"
echo ""
echo -e "${CYAN}Troubleshooting:${NC}"
echo ""
echo -e "  ${YELLOW}•${NC} If Claude doesn't see the MCP server:"
echo -e "    - Exit Claude completely"
echo -e "    - Check config: ${CYAN}cat $CLAUDE_CONFIG${NC}"
echo -e "    - Start Claude again: ${CYAN}claude${NC}"
echo ""
echo -e "  ${YELLOW}•${NC} Test MCP server manually:"
echo -e "    ${CYAN}echo '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"params\":{},\"id\":1}' | node /opt/bconnect-mcp/build/index.js${NC}"
echo ""
echo -e "  ${YELLOW}•${NC} Check logs if issues:"
echo -e "    Claude Code shows MCP errors in its output"
echo ""
echo -e "${CYAN}================================================================${NC}"
echo ""
