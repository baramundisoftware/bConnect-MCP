#!/bin/bash

# MCP Server Setup Verification Script
# Verifies that the bConnect MCP server is properly configured

echo "🔍 MCP Server Setup Verification"
echo "================================="
echo ""

# Check 1: Configuration file exists
echo "1️⃣  Checking configuration file..."
if [ -f "/root/.config/Claude/claude_desktop_config.json" ]; then
    echo "   ✅ Configuration file exists"
    echo "   📄 Location: /root/.config/Claude/claude_desktop_config.json"
else
    echo "   ❌ Configuration file NOT found"
    echo "   Run: Create configuration at /root/.config/Claude/claude_desktop_config.json"
    exit 1
fi
echo ""

# Check 2: MCP server builds successfully
echo "2️⃣  Checking MCP server build..."
cd /workspaces/claudinno/bConnect-MCP
if npm run build > /dev/null 2>&1; then
    echo "   ✅ MCP server builds successfully"
else
    echo "   ❌ MCP server build FAILED"
    echo "   Run: npm run build"
    exit 1
fi
echo ""

# Check 3: MCP server executable exists
echo "3️⃣  Checking MCP server executable..."
if [ -f "build/index.js" ]; then
    echo "   ✅ MCP server executable found"
    echo "   📄 Location: /workspaces/claudinno/bConnect-MCP/build/index.js"
else
    echo "   ❌ MCP server executable NOT found"
    echo "   Run: npm run build"
    exit 1
fi
echo ""

# Check 4: Documentation content exists
echo "4️⃣  Checking documentation content..."
FORUM_COUNT=$(find /workspaces/claudinno/docs.baramundi.com/forum-content -name "*.md" -type f 2>/dev/null | wc -l)
FEEDBACK_COUNT=$(find /workspaces/claudinno/docs.baramundi.com/feedback/content -name "*.md" -type f 2>/dev/null | wc -l)

if [ "$FORUM_COUNT" -gt 0 ] && [ "$FEEDBACK_COUNT" -gt 0 ]; then
    echo "   ✅ Documentation content found"
    echo "   📁 Forum threads: ~$FORUM_COUNT files"
    echo "   💡 Feedback items: ~$FEEDBACK_COUNT files"
else
    echo "   ⚠️  Limited documentation content"
    echo "   📁 Forum threads: $FORUM_COUNT files"
    echo "   💡 Feedback items: $FEEDBACK_COUNT files"
fi
echo ""

# Check 5: Environment variables in config
echo "5️⃣  Checking environment variables..."
if grep -q "BCONNECT_BASE_URL" /root/.config/Claude/claude_desktop_config.json; then
    echo "   ✅ BCONNECT_BASE_URL configured"
fi
if grep -q "BCONNECT_USERNAME" /root/.config/Claude/claude_desktop_config.json; then
    echo "   ✅ BCONNECT_USERNAME configured"
fi
if grep -q "BCONNECT_PASSWORD" /root/.config/Claude/claude_desktop_config.json; then
    echo "   ✅ BCONNECT_PASSWORD configured"
fi
echo ""

# Check 6: Test MCP server starts
echo "6️⃣  Testing MCP server startup..."
timeout 3s node build/index.js > /tmp/mcp-test.log 2>&1 &
MCP_PID=$!
sleep 1

if grep -q "bConnect MCP Server running" /tmp/mcp-test.log; then
    echo "   ✅ MCP server starts successfully"
    echo "   📊 Connected to: $(grep "Connected to:" /tmp/mcp-test.log | cut -d: -f2-)"
    kill $MCP_PID 2>/dev/null
else
    echo "   ❌ MCP server startup FAILED"
    echo "   Check logs: cat /tmp/mcp-test.log"
    exit 1
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ All checks passed!"
echo ""
echo "📋 Configuration Details:"
jq '.' /root/.config/Claude/claude_desktop_config.json
echo ""
echo "🚀 Next Steps:"
echo "   1. Restart Claude Code"
echo "   2. Try: 'List all documentation sources'"
echo "   3. Try: 'Search for deployment automation'"
echo "   4. Try: 'Show me all Windows endpoints'"
echo ""
echo "📚 Documentation:"
echo "   - Setup guide: MCP-SERVER-SETUP-GUIDE.md"
echo "   - Usage examples: USAGE-EXAMPLES.md"
echo "   - API reference: API-INFO.md"
echo ""
echo "✅ MCP Server is ready to use!"
