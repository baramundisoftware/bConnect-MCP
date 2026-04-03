# Demo Directory - Screencast/Video Demonstration Package

This directory contains all materials for creating professional screencast/video demonstrations of the bConnect MCP Server.

---

## 📁 Directory Contents

```
demo/
├── README.md                        # This file
├── DEMO-PACKAGE-README.md           # START HERE - Quick start guide
├── SCREENCAST-LIST-ENDPOINTS.md     # Complete 8-scene demonstration script
├── DEMO-QUERIES.md                  # Copy-paste ready queries with expected outputs
└── VIDEO-CREATION-GUIDE.md          # Recording tools and workflows
```

---

## 🚀 Quick Start

**Read this first:** [DEMO-PACKAGE-README.md](DEMO-PACKAGE-README.md)

### Fastest Way to Record (5 minutes)
```bash
# From project root
cd /workspaces/claudinno/bConnect-MCP

# Install recording tool
./scripts/install-asciinema.sh

# Start automated recording
./scripts/record-demo-asciinema.sh
```

---

## 📖 Documentation Files

### 1. DEMO-PACKAGE-README.md
**Start here!** Overview of the entire demo package with quick-start options.

**Contents:**
- Package overview
- 3 quick-start options (5 min, 30 min, 2 min)
- Pre-recording checklist
- Recording workflow
- Success criteria

**Read this if:** You're new to creating demos

---

### 2. SCREENCAST-LIST-ENDPOINTS.md
Complete demonstration script with 8 scenes for a professional 5-minute screencast.

**Contents:**
- Scene-by-scene script (30s - 45s each)
- Narration and visual cues
- Sample queries for each scene
- Technical setup instructions
- Post-recording checklist

**Read this if:** You want a structured, professional demo script

---

### 3. DEMO-QUERIES.md
Copy-paste ready queries for live demonstrations with expected outputs.

**Contents:**
- 5 demo sections (Basic, Filtered, Pagination, Complex, Real-world)
- Expected outputs for each query
- Real-world scenarios
- Presenter notes and Q&A
- Emergency fallback queries

**Read this if:** You need ready-to-use queries for your demo

---

### 4. VIDEO-CREATION-GUIDE.md
Complete guide for 4 different recording methods with tools and workflows.

**Contents:**
- asciinema (Terminal recording)
- OBS Studio (Professional screen recording)
- SimpleScreenRecorder (Linux)
- Windows Game Bar (Quick capture)
- Installation guides for each tool
- File formats and export options
- Complete troubleshooting

**Read this if:** You need to choose and set up recording software

---

## 🎯 Demo Structure

**Target:** 5-minute demonstration of `list_endpoints` MCP tool

**8 Scenes:**
1. Introduction (30s) - Project overview
2. Simple Query (45s) - Basic listing
3. Filtered Search (45s) - Search and filter
4. Pagination (45s) - Sort and paginate results
5. Complex Query (45s) - Multi-criteria search
6. Behind the Scenes (30s) - Show MCP code
7. Real-World Use Case (45s) - Practical example
8. Conclusion (30s) - Recap and next steps

---

## 🛠️ Recording Scripts

Recording scripts are located in `../scripts/`:

- **../scripts/install-asciinema.sh** - Install asciinema (DevContainer-compatible)
- **../scripts/record-demo-asciinema.sh** - Automated terminal recording

**Note:** Run scripts from the project root (`/workspaces/claudinno/bConnect-MCP`), not from this demo directory.

---

## 🎬 Recording Methods

| Method | Setup Time | Quality | Best For |
|--------|-----------|---------|----------|
| **asciinema** | 5 min | Good | Technical docs |
| **OBS Studio** | 30 min | Excellent | Presentations |
| **SimpleScreenRecorder** | 15 min | Good | Linux native |
| **Windows Game Bar** | 0 min | Good | Quick capture |

See [VIDEO-CREATION-GUIDE.md](VIDEO-CREATION-GUIDE.md) for detailed setup instructions.

---

## 📝 Sample Queries

Quick reference of queries to demonstrate (from DEMO-QUERIES.md):

```
# Basic
List all endpoints managed by baramundi

# Filtered
Show me all Windows endpoints with "WIN" in the name
List all Linux endpoints

# Sorted
Show me the first 5 endpoints sorted by name

# Complex
Find all Windows endpoints that haven't been seen in 7 days

# Real-world
Which endpoints are currently online?
```

---

## ✅ Pre-Recording Checklist

Before recording:
- [ ] Test MCP connection: Ask Claude "List available tools"
- [ ] Verify endpoints accessible (expect 8 endpoints)
- [ ] Have DEMO-QUERIES.md open for copy-paste
- [ ] Set terminal font size to 16pt+
- [ ] Close unnecessary windows/notifications
- [ ] Test microphone (if recording audio)

---

## 📤 After Recording

1. **Review** - Watch your recording for errors
2. **Edit** (optional) - Trim with DaVinci Resolve or Windows Photos
3. **Export** - MP4, 1080p, H.264
4. **Share** - Upload to SharePoint/Teams/YouTube
5. **Document** - Update Tasks.md as completed

---

## 🐛 Troubleshooting

### MCP tool not responding
```bash
cd /workspaces/claudinno/bConnect-MCP
npm run build
# Restart Claude Code
```

### Can't install asciinema
```bash
# Manual installation (DevContainer)
apt-get update
apt-get install -y asciinema
```

### Complete troubleshooting
See [VIDEO-CREATION-GUIDE.md](VIDEO-CREATION-GUIDE.md) → Troubleshooting section

---

## 📊 Success Criteria

Your demo is successful if viewers understand:
- ✅ Natural language eliminates coding
- ✅ Full API access through simple queries
- ✅ Real-time data from production baramundi
- ✅ Practical for daily IT operations
- ✅ Extensible (94 tools total, not just 1)

---

## 📞 Need Help?

1. Read [DEMO-PACKAGE-README.md](DEMO-PACKAGE-README.md) for quick start
2. Check [VIDEO-CREATION-GUIDE.md](VIDEO-CREATION-GUIDE.md) for troubleshooting
3. Review [DEMO-QUERIES.md](DEMO-QUERIES.md) for expected outputs
4. Ask in Teams channel or create GitHub issue

---

**Created:** 2025-10-20
**bConnect MCP Server version:** 1.0.0
**Tools demonstrated:** `list_endpoints` (1 of 94)

**Ready to record!** Start with [DEMO-PACKAGE-README.md](DEMO-PACKAGE-README.md) 🎬
