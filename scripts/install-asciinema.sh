#!/bin/bash
#
# Install asciinema in DevContainer (running as root)
# No sudo required
#

set -e

echo "Installing asciinema..."

# Update package list
apt-get update

# Install asciinema
apt-get install -y asciinema

# Verify installation
if command -v asciinema &> /dev/null; then
    echo "✅ asciinema installed successfully"
    asciinema --version
else
    echo "❌ asciinema installation failed"
    exit 1
fi

echo ""
echo "Ready to record! Use:"
echo "  ./scripts/record-demo-asciinema.sh"
