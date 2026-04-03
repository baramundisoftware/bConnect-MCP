#!/bin/bash
#
# Setup script for bConnect MCP Server
# This script sets up the development environment
#

set -e

echo "========================================"
echo "bConnect MCP Server - Setup"
echo "========================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed!"
    echo "Please install Node.js 20.x first:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -"
    echo "  sudo apt-get install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✓ Node.js found: $NODE_VERSION"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "ERROR: npm is not installed!"
    exit 1
fi

NPM_VERSION=$(npm --version)
echo "✓ npm found: $NPM_VERSION"
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install dependencies"
    exit 1
fi
echo "✓ Dependencies installed"
echo ""

# Check for .env file
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    echo "✓ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file with your bConnect API credentials:"
    echo "   nano .env"
    echo ""
else
    echo "✓ .env file already exists"
    echo ""
fi

# Build the project
echo "Building TypeScript project..."
npm run build

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to build project"
    exit 1
fi
echo "✓ Project built successfully"
echo ""

# Check if .env has been configured
if grep -q "your_api_key_here" .env 2>/dev/null; then
    echo "⚠️  WARNING: .env file still contains placeholder values"
    echo "   Please edit .env with your actual API credentials"
    echo ""
fi

echo "========================================"
echo "Setup Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your bConnect API credentials:"
echo "   nano .env"
echo ""
echo "2. Test the MCP server:"
echo "   npm run inspector"
echo ""
echo "3. Configure Claude Code:"
echo "   See README.md for configuration instructions"
echo ""
echo "4. Deploy to multiple machines (optional):"
echo "   See DEPLOYMENT.md for Ansible deployment"
echo ""
