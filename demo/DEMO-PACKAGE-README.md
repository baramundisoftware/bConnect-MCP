# Screencast/Video Demo Package - List Endpoints

**Complete package for creating professional demonstrations of the bConnect MCP `list_endpoints` tool**

---

## 📦 Package Contents

| File | Purpose | Size | Format |
|------|---------|------|--------|
| **SCREENCAST-LIST-ENDPOINTS.md** | Complete 8-scene script | 800+ lines | Markdown |
| **DEMO-QUERIES.md** | Copy-paste ready queries | 500+ lines | Markdown |
| **VIDEO-CREATION-GUIDE.md** | Recording tools & workflow | 400+ lines | Markdown |
| **scripts/install-asciinema.sh** | One-click asciinema install | Executable | Bash |
| **scripts/record-demo-asciinema.sh** | Automated recording | Executable | Bash |

---

## 🚀 Quick Start (3 Options)

### Option 1: Terminal Recording (Fastest - 5 minutes)
```bash
cd /workspaces/claudinno/bConnect-MCP

# Install asciinema
./scripts/install-asciinema.sh

# Record demonstration
./scripts/record-demo-asciinema.sh
# Follow on-screen prompts
# Press Ctrl+D when finished

# Result: demo-list-endpoints-YYYYMMDD-HHMMSS.cast
```

**Best for:** Technical documentation, developer demos

---

### Option 2: Professional Video (30 minutes)
1. Install OBS Studio on Windows host (PCDE220010)
2. Follow **VIDEO-CREATION-GUIDE.md** → Method 2
3. Read script from **SCREENCAST-LIST-ENDPOINTS.md**
4. Use queries from **DEMO-QUERIES.md**
5. Record 5-minute video

**Best for:** Innovation presentations, stakeholder demos

---

### Option 3: Quick Capture (2 minutes)
1. On Windows host: Press `Windows + G`
2. Click "Record"
3. Demonstrate in Hyper-V window
4. Press `Windows + Alt + R` to stop
5. Video saved to `C:\Users\...\Videos\Captures\`

**Best for:** Internal sharing, quick prototypes

---

## 📋 Demo Structure (5 minutes)

Follow **SCREENCAST-LIST-ENDPOINTS.md** for complete script:

1. **Introduction** (30s) - Project overview
2. **Simple Query** (45s) - `List all endpoints`
3. **Filtered Search** (45s) - Search by name, filter by OS
4. **Pagination** (45s) - Show first 5, sort by date
5. **Complex Query** (45s) - Multi-criteria search
6. **Behind the Scenes** (30s) - Show MCP tool code
7. **Real-World Use Case** (45s) - Deployment planning
8. **Conclusion** (30s) - Recap & next steps

**Total:** 4:45 minutes

---

## 📝 Sample Queries

From **DEMO-QUERIES.md**, ready to copy-paste:

```
# Basic
List all endpoints managed by baramundi

# Filtered
Show me all Windows endpoints with "WIN" in the name
List all Linux endpoints

# Sorted
Show me the first 5 endpoints sorted by name
List endpoints sorted by last seen date, newest first

# Complex
Find all Windows endpoints that haven't been seen in 7 days
Show me all servers (endpoints with "SERVER" in name)

# Real-world
List all Windows endpoints and tell me how many there are
Which endpoints are currently online?
```

---

## 🛠️ Recording Tools Comparison

| Tool | Setup Time | Quality | File Size | Best For |
|------|-----------|---------|-----------|----------|
| **asciinema** | 2 min | Good | 50 KB | Tech docs |
| **OBS Studio** | 15 min | Excellent | 50 MB | Presentations |
| **SimpleScreenRecorder** | 5 min | Good | 30 MB | Linux native |
| **Windows Game Bar** | 0 min | Good | 40 MB | Quick capture |

See **VIDEO-CREATION-GUIDE.md** for detailed setup instructions.

---

## ✅ Pre-Recording Checklist

Before recording:
- [ ] Test MCP connection: Ask Claude "List available tools"
- [ ] Verify endpoints accessible (expect 8 endpoints)
- [ ] Have **DEMO-QUERIES.md** open for copy-paste
- [ ] Set terminal font size to 16pt+ (readability)
- [ ] Close unnecessary windows/notifications
- [ ] Test microphone (if recording audio)

---

## 🎬 Recording Workflow

### Using asciinema (Recommended for DevContainer)

```bash
# 1. Install (first time only)
./scripts/install-asciinema.sh

# 2. Start recording
./scripts/record-demo-asciinema.sh

# 3. Perform demonstration
#    - Follow SCREENCAST-LIST-ENDPOINTS.md script
#    - Copy queries from DEMO-QUERIES.md
#    - Type slowly and clearly

# 4. Stop recording
#    - Press Ctrl+D

# 5. Playback
asciinema play recordings/demo-list-endpoints-*.cast

# 6. Share
asciinema upload recordings/demo-list-endpoints-*.cast
# Or convert to GIF:
agg recordings/demo-list-endpoints-*.cast demo.gif
```

### Using OBS Studio (For Polished Videos)

1. **Setup** - Follow VIDEO-CREATION-GUIDE.md → Method 2
2. **Prepare** - Open SCREENCAST-LIST-ENDPOINTS.md on second monitor
3. **Record** - Click "Start Recording" in OBS
4. **Demonstrate** - Follow 8-scene script (5 minutes)
5. **Stop** - Click "Stop Recording"
6. **Edit** (optional) - Trim with DaVinci Resolve or Windows Photos
7. **Export** - MP4, 1080p, H.264

---

## 📊 Expected Results

### Query: "List all endpoints"
**Expected:** 8 endpoints shown (Windows, Linux, Mac, Mobile)

### Query: "Show me the first 5 endpoints sorted by name"
**Expected:** 5 endpoints alphabetically: ANDROID-TABLET-001, bms-win22srv, IOS-IPHONE-001, LINUX-SERVER-001, MAC-LAPTOP-001

### Query: "Find all Windows endpoints that haven't been seen in 7 days"
**Expected:** Filters by LastSeen date, shows stale systems

See **DEMO-QUERIES.md** for complete expected outputs.

---

## 🎯 Demo Success Criteria

Your demo is successful if viewers understand:
- ✅ Natural language eliminates coding
- ✅ Full API access through simple queries
- ✅ Real-time data from production baramundi
- ✅ Practical for daily IT operations
- ✅ Extensible (94 tools total, not just 1)

---

## 🐛 Troubleshooting

### MCP tool not responding
```bash
cd /workspaces/claudinno/bConnect-MCP
npm run build
# Restart Claude Code
```

### Authentication failed
```bash
# Test API directly
curl -k -u "Administrator:baramundi-2008" \
  "https://bms-win22srv:444/bconnect/endpoints/v2.0/Endpoints?PageSize=1"
```

### No endpoints returned
- Verify BMS-WIN22SRV is accessible
- Check .env credentials
- Test network connectivity

### Video file too large
```bash
# Compress with FFmpeg
ffmpeg -i input.mp4 -vcodec h264 -b:v 1500k output.mp4
```

See **VIDEO-CREATION-GUIDE.md** for complete troubleshooting.

---

## 📤 Sharing Your Demo

### Internal (Company)
- Upload to SharePoint/OneDrive
- Share link via Teams
- Embed in innovation presentation

### Public
- Upload to YouTube (unlisted)
- Share asciinema.org link
- Embed GIF in GitHub README

### Documentation
- Add to bConnect-MCP README.md
- Include in innovation demo materials
- Archive source files for future editing

---

## 📁 File Locations

```
bConnect-MCP/
├── SCREENCAST-LIST-ENDPOINTS.md    # Complete 8-scene script
├── DEMO-QUERIES.md                  # Ready-to-use queries
├── VIDEO-CREATION-GUIDE.md          # Tool setup & workflows
├── DEMO-PACKAGE-README.md           # This file
├── scripts/
│   ├── install-asciinema.sh         # Install recording tool
│   └── record-demo-asciinema.sh     # Automated recording
└── recordings/                      # Output directory (created automatically)
    └── demo-list-endpoints-*.cast   # Your recordings
```

---

## 🎓 Learning Path

### For First-Time Recorders
1. Read **SCREENCAST-LIST-ENDPOINTS.md** (Scene 1-2 only)
2. Install asciinema: `./scripts/install-asciinema.sh`
3. Practice queries from **DEMO-QUERIES.md** without recording
4. Do a test recording (1-2 minutes)
5. Watch playback
6. Record full demo when comfortable

### For Experienced Presenters
1. Skim **SCREENCAST-LIST-ENDPOINTS.md**
2. Copy **DEMO-QUERIES.md** to second monitor
3. Start recording immediately
4. Improvise based on script structure
5. Add personal insights and examples

---

## ⏱️ Time Estimates

| Activity | First Time | Subsequent |
|----------|-----------|------------|
| Setup asciinema | 5 min | 0 min |
| Practice queries | 10 min | 2 min |
| Record demo | 10 min | 5 min |
| Review & re-record | 5 min | 2 min |
| Export/share | 5 min | 2 min |
| **Total** | **35 min** | **11 min** |

---

## 📞 Support

If you encounter issues:
1. Check **VIDEO-CREATION-GUIDE.md** → Troubleshooting section
2. Test API connection manually (curl commands provided)
3. Review **DEMO-QUERIES.md** for expected outputs
4. Ask in Teams channel or create GitHub issue

---

## ✨ Enhancement Ideas

After creating basic demo, consider:
- **Add more tools** - Demonstrate `get_endpoint`, `create_windows_endpoint`
- **Show write operations** - Create/update/delete examples
- **Live Q&A** - Prepare for audience questions
- **Comparison demo** - Show curl vs natural language
- **Error handling** - Show what happens when endpoint not found

---

## 🎬 Ready to Record!

**Fastest path to your first recording:**

```bash
cd /workspaces/claudinno/bConnect-MCP
./scripts/install-asciinema.sh
./scripts/record-demo-asciinema.sh
```

Follow the prompts, perform your demonstration, press Ctrl+D when finished!

---

**Package created:** 2025-10-20
**bConnect MCP Server version:** 1.0.0
**MCP Tools demonstrated:** `list_endpoints` (1 of 94)

**Good luck with your demonstration!** 🚀
