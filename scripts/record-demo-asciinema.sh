#!/bin/bash
#
# Terminal Recording Script for bConnect MCP Demo - List Endpoints
# Uses asciinema to record terminal session
#
# Prerequisites:
# - asciinema installed: apt-get install asciinema (or run ./scripts/install-asciinema.sh)
# - bConnect MCP Server running
# - Claude Code CLI configured
#
# Usage:
#   ./scripts/record-demo-asciinema.sh
#
# Output:
#   demo-list-endpoints-YYYYMMDD-HHMMSS.cast
#

set -e

# Configuration
DEMO_TITLE="bConnect MCP Demo - List Endpoints Tool"
OUTPUT_DIR="/workspaces/claudinno/bConnect-MCP/recordings"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
OUTPUT_FILE="${OUTPUT_DIR}/demo-list-endpoints-${TIMESTAMP}.cast"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper function for colored output
log() {
    echo -e "${GREEN}[DEMO]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    # Check asciinema
    if ! command -v asciinema &> /dev/null; then
        error "asciinema is not installed"
        echo ""
        echo "Install with: ./scripts/install-asciinema.sh"
        echo "Or manually: apt-get update && apt-get install -y asciinema"
        exit 1
    fi

    # Check if we're in the right directory
    if [ ! -f "package.json" ]; then
        error "Must be run from bConnect-MCP directory"
        exit 1
    fi

    # Check if build exists
    if [ ! -d "build" ]; then
        warning "Build directory not found. Running npm run build..."
        npm run build
    fi

    # Create recordings directory
    mkdir -p "$OUTPUT_DIR"

    log "Prerequisites OK"
}

# Display instructions
show_instructions() {
    clear
    cat << EOF

${GREEN}╔════════════════════════════════════════════════════════════════╗
║  bConnect MCP Demo - Terminal Recording with asciinema         ║
╚════════════════════════════════════════════════════════════════╝${NC}

${BLUE}Recording will start in 5 seconds...${NC}

${YELLOW}Demo Script:${NC}
1. Show project status
2. Run test suite
3. Demonstrate list_endpoints queries
4. Show MCP tool definition
5. Conclusion

${YELLOW}Tips:${NC}
- Type slowly and clearly (this will be watched later)
- Pause 2-3 seconds between commands
- Press Ctrl+D when finished to stop recording

${YELLOW}Output:${NC}
- Recording will be saved to: ${OUTPUT_FILE}
- You can upload with: asciinema upload ${OUTPUT_FILE}
- Or convert to GIF: asciicast2gif ${OUTPUT_FILE} demo.gif

EOF

    info "Press Enter to continue or Ctrl+C to cancel..."
    read -r

    for i in {5..1}; do
        echo -ne "${BLUE}Starting in $i...${NC}\r"
        sleep 1
    done
    echo -e "${GREEN}Recording NOW!${NC}                    "
    sleep 1
}

# Start recording
start_recording() {
    log "Starting asciinema recording..."

    asciinema rec \
        --title "$DEMO_TITLE" \
        --idle-time-limit 3 \
        "$OUTPUT_FILE"

    # Recording stopped by user (Ctrl+D)
    log "Recording stopped"
}

# Post-recording actions
post_recording() {
    echo ""
    log "Recording saved to: ${OUTPUT_FILE}"
    echo ""

    # Show file info
    if [ -f "$OUTPUT_FILE" ]; then
        FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
        info "File size: $FILE_SIZE"

        # Offer to play it back
        echo ""
        info "Would you like to play back the recording? [y/N]"
        read -r -n 1 response
        echo ""

        if [[ "$response" =~ ^[Yy]$ ]]; then
            asciinema play "$OUTPUT_FILE"
        fi

        # Offer to upload
        echo ""
        info "Would you like to upload to asciinema.org? [y/N]"
        read -r -n 1 response
        echo ""

        if [[ "$response" =~ ^[Yy]$ ]]; then
            asciinema upload "$OUTPUT_FILE"
        fi

        echo ""
        log "Next steps:"
        echo "  - Play recording: asciinema play ${OUTPUT_FILE}"
        echo "  - Upload: asciinema upload ${OUTPUT_FILE}"
        echo "  - Convert to GIF: asciicast2gif ${OUTPUT_FILE} demo.gif"
        echo "  - Embed in README: See https://asciinema.org/docs/embedding"
    else
        error "Recording file not found!"
    fi
}

# Main execution
main() {
    check_prerequisites
    show_instructions
    start_recording
    post_recording
}

main
