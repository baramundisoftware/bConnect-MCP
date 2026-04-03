# Video Creation Guide - bConnect MCP Demo
**Complete guide for creating professional screencast/video demonstrations**

---

## Quick Start Options

| Method | Difficulty | Quality | Time | Best For |
|--------|-----------|---------|------|----------|
| **asciinema** (Terminal) | Easy | Good | 5 min | Technical demos |
| **OBS Studio** (Full screen) | Medium | Excellent | 30 min | Polished presentations |
| **SimpleScreenRecorder** | Easy | Good | 15 min | Quick Linux recordings |
| **Windows Game Bar** | Very Easy | Good | 10 min | Quick Windows recordings |

---

## Method 1: asciinema (Terminal Recording)

### ✅ Best For
- Technical audiences
- Developer presentations
- Quick demos
- Embedding in documentation

### Installation (DevContainer - running as root)
```bash
cd /workspaces/claudinno/bConnect-MCP

# Install asciinema
./scripts/install-asciinema.sh

# Verify installation
asciinema --version
```

### Recording
```bash
# Automated recording with our script
./scripts/record-demo-asciinema.sh

# Or manual recording
asciinema rec demo-list-endpoints.cast
# Perform your demonstration
# Press Ctrl+D when finished
```

### Playback
```bash
# Play locally
asciinema play demo-list-endpoints.cast

# Upload to asciinema.org (get shareable link)
asciinema upload demo-list-endpoints.cast
```

### Convert to GIF or Video
```bash
# Install asciicast2gif
npm install -g asciicast2gif

# Convert to GIF
asciicast2gif demo-list-endpoints.cast demo.gif

# Or use agg (faster, better quality)
apt-get install -y cargo
cargo install --git https://github.com/asciinema/agg
agg demo-list-endpoints.cast demo.gif
```

### Embed in Documentation
```markdown
[![asciicast](https://asciinema.org/a/RECORDING_ID.svg)](https://asciinema.org/a/RECORDING_ID)
```

**Pros:**
- ✅ Fast and easy
- ✅ Small file size
- ✅ Text is selectable/searchable
- ✅ Perfect for technical documentation

**Cons:**
- ❌ Terminal only (no GUI)
- ❌ No mouse cursor
- ❌ Limited visual appeal

---

## Method 2: OBS Studio (Professional Screen Recording)

### ✅ Best For
- Innovation presentations
- Stakeholder demos
- Marketing materials
- High-quality productions

### Installation (Windows Host - PCDE220010)

1. **Download OBS Studio**
   - Visit: https://obsproject.com/download
   - Download Windows installer
   - Run installer (default settings are fine)

2. **Initial Setup**
   - Launch OBS Studio
   - Run Auto-Configuration Wizard
   - Select "Optimize for recording"
   - Select 1080p, 30 FPS

3. **Configure Scene**
   ```
   Sources:
   1. Window Capture - Hyper-V Manager (UbuntuClaude VM window)
   2. Audio Input Capture - Microphone (for narration)
   ```

4. **Recording Settings**
   ```
   Settings → Output:
   - Recording Format: MP4
   - Encoder: x264
   - Rate Control: CBR
   - Bitrate: 2500 Kbps
   - Preset: veryfast
   ```

### Recording Workflow

1. **Prepare Environment**
   - Launch Hyper-V Manager
   - Connect to UbuntuClaude VM
   - Full screen the VM window
   - Have SCREENCAST-LIST-ENDPOINTS.md open on second monitor

2. **Start Recording**
   - Open OBS Studio
   - Click "Start Recording"
   - Switch to Hyper-V window
   - Begin demonstration following script

3. **During Recording**
   - Speak clearly and slowly
   - Pause 2-3 seconds between actions
   - Keep mouse movements smooth
   - Follow SCREENCAST-LIST-ENDPOINTS.md script

4. **Stop Recording**
   - Complete your demo
   - Switch to OBS
   - Click "Stop Recording"
   - Video saved to: `C:\Users\<YourName>\Videos\`

### Post-Production (Optional)

**Basic Editing with DaVinci Resolve (Free):**
1. Download: https://www.blackmagicdesign.com/products/davinciresolve
2. Import your OBS recording
3. Trim intro/outro
4. Add title slide (optional)
5. Export as MP4 (H.264, 1080p, 30fps)

**Quick Edits with Windows Photos:**
1. Right-click video → "Open with" → "Photos"
2. Click "Edit & Create" → "Trim"
3. Set start/end points
4. Save trimmed video

**Pros:**
- ✅ Professional quality
- ✅ Full screen capture with mouse
- ✅ Audio narration
- ✅ Free and powerful

**Cons:**
- ❌ Requires Windows host setup
- ❌ Larger file sizes
- ❌ More time to produce

---

## Method 3: SimpleScreenRecorder (Linux)

### ✅ Best For
- Quick recordings within Ubuntu guest
- No Windows host access needed
- Simple demos

### Installation (Ubuntu Guest)

**Note:** This requires GUI access to Ubuntu guest (GNOME desktop)

```bash
# In Ubuntu VM (not DevContainer)
sudo apt-get update
sudo apt-get install simplescreenrecorder
```

### Recording
1. Launch SimpleScreenRecorder
   ```bash
   simplescreenrecorder
   ```

2. Configuration:
   - **Continue** → Record the entire screen
   - **Continue** → Use OpenGL
   - **Video settings**: 1920x1080, 30 FPS, H.264
   - **Audio**: PulseAudio
   - **Save location**: /home/vscode/Videos/

3. Start Recording:
   - Click "Record"
   - Perform demonstration
   - Click "Stop" when finished

### Pros:
- ✅ Native Linux recording
- ✅ Good quality
- ✅ Built-in encoding

### Cons:
- ❌ Requires Ubuntu GUI
- ❌ Not available in DevContainer
- ❌ May have performance issues in VM

---

## Method 4: Windows Game Bar (Quickest Option)

### ✅ Best For
- Rapid prototypes
- Internal demos
- Quick captures

### Recording (Windows Host Only)

1. **Enable Game Bar** (if not enabled)
   - Windows Settings → Gaming → Xbox Game Bar → "On"

2. **Start Recording**
   - Focus on Hyper-V Manager window
   - Press `Windows + G`
   - Click "Capture" widget
   - Click "Record" button (or press `Windows + Alt + R`)

3. **During Recording**
   - Green recording indicator appears
   - Perform your demonstration

4. **Stop Recording**
   - Press `Windows + Alt + R` again
   - Or click "Stop" in Game Bar overlay

5. **Find Recording**
   - Saved to: `C:\Users\<YourName>\Videos\Captures\`
   - File name: `<WindowName> YYYY-MM-DD HH-MM-SS.mp4`

### Pros:
- ✅ Fastest method
- ✅ Built into Windows
- ✅ No installation required

### Cons:
- ❌ Limited editing options
- ❌ Windows host only
- ❌ Basic functionality

---

## Recommended Workflow for bConnect MCP Demo

### **For Innovation Demo (Stakeholders/Management):**

**Tool:** OBS Studio
**Duration:** 30 minutes preparation + 5 minute recording
**Output:** Professional MP4 video

**Steps:**
1. Install OBS Studio on Windows host
2. Configure window capture for Hyper-V Manager
3. Connect microphone for narration
4. Record following SCREENCAST-LIST-ENDPOINTS.md script
5. (Optional) Edit in DaVinci Resolve
6. Upload to company video platform

---

### **For Technical Documentation:**

**Tool:** asciinema
**Duration:** 5 minutes setup + 3 minute recording
**Output:** Terminal recording + GIF

**Steps:**
1. Install asciinema in DevContainer
2. Run `./scripts/record-demo-asciinema.sh`
3. Follow terminal prompts
4. Convert to GIF with agg
5. Embed in README.md and documentation

---

### **For Quick Internal Share:**

**Tool:** Windows Game Bar
**Duration:** 2 minutes
**Output:** MP4 video

**Steps:**
1. Press Windows + G
2. Click Record
3. Demonstrate list_endpoints
4. Press Windows + Alt + R to stop
5. Share video file via email/Teams

---

## Complete Recording Checklist

### Before Recording
- [ ] Test bConnect MCP Server connection
- [ ] Verify endpoints are accessible (8 expected)
- [ ] Have demo queries ready (DEMO-QUERIES.md)
- [ ] Close unnecessary windows/notifications
- [ ] Test microphone (if recording audio)
- [ ] Full screen the terminal/window
- [ ] Set terminal font size to 16pt+ (readability)

### During Recording
- [ ] Speak clearly and at moderate pace
- [ ] Pause 2-3 seconds between commands
- [ ] Avoid sudden mouse movements
- [ ] Follow script from SCREENCAST-LIST-ENDPOINTS.md
- [ ] Highlight key points verbally

### After Recording
- [ ] Watch playback for errors
- [ ] Re-record if needed (it's OK!)
- [ ] Trim intro/outro if necessary
- [ ] Add title/conclusion slides (optional)
- [ ] Export in appropriate format
- [ ] Test playback on different devices

---

## File Format Specifications

### For Web/Email Sharing
```
Format: MP4 (H.264)
Resolution: 1920x1080 (1080p)
Frame Rate: 30 FPS
Bitrate: 2500 Kbps (video) + 128 Kbps (audio)
Max File Size: 100 MB
```

### For Presentations (PowerPoint/PDF)
```
Format: MP4 (H.264)
Resolution: 1280x720 (720p) - smaller file size
Frame Rate: 30 FPS
Bitrate: 1500 Kbps
Embedded in slide deck
```

### For Documentation (GIF)
```
Format: GIF (animated)
Resolution: 1280x720 or 1024x768
Frame Rate: 10 FPS (sufficient for terminal)
Max File Size: 10 MB
Colors: 256 (optimized palette)
```

---

## Export Commands

### OBS Studio Export
Already exported during recording to Videos folder

### DaVinci Resolve Export
```
File → Deliver:
- Format: MP4
- Codec: H.264
- Resolution: 1920x1080
- Frame Rate: 30
- Quality: High
```

### FFmpeg (Command Line Conversion)
```bash
# Compress video
ffmpeg -i input.mp4 -vcodec h264 -b:v 2500k -acodec aac -b:a 128k output.mp4

# Convert to GIF
ffmpeg -i input.mp4 -vf "fps=10,scale=1280:-1:flags=lanczos" output.gif

# Trim video (30 seconds to 2 minutes)
ffmpeg -i input.mp4 -ss 00:00:30 -to 00:02:00 -c copy output.mp4
```

---

## Cloud Hosting Options

### For Company Internal
- **SharePoint/OneDrive** - Direct upload, no conversion needed
- **Microsoft Teams** - Upload to Files, share link
- **Intranet** - Upload to company video portal

### For Public Sharing
- **YouTube** (unlisted) - Best for long-term hosting
- **Vimeo** - Professional appearance
- **asciinema.org** - For terminal recordings

### For Documentation
- **GitHub** - Host GIFs in repo (max 10MB)
- **README.md embedding** - Direct GIF links
- **Wiki pages** - Embed videos with iframe

---

## Troubleshooting

### Problem: Video file too large
**Solution:**
```bash
# Compress with FFmpeg
ffmpeg -i input.mp4 -vcodec h264 -b:v 1500k output.mp4
```

### Problem: Audio not recording
**Solution:**
- OBS: Settings → Audio → Desktop Audio Device → Select microphone
- Game Bar: Windows Settings → Gaming → Audio → Microphone volume

### Problem: Choppy/laggy recording
**Solution:**
- Close other applications
- Lower recording resolution (720p instead of 1080p)
- Use "veryfast" encoder preset in OBS
- Record in shorter segments (< 5 minutes each)

### Problem: Can't see terminal text clearly
**Solution:**
```bash
# Increase terminal font size
# In VS Code terminal: Ctrl+= (increase)
# Or edit settings: "terminal.integrated.fontSize": 16
```

### Problem: Hyper-V window too small
**Solution:**
- Hyper-V Manager → UbuntuClaude → Settings
- Display → Resolution: 1920x1080
- Restart VM

---

## Example Filenames

```
# asciinema
demo-list-endpoints-20251020-120000.cast
demo-list-endpoints.gif

# OBS/Video
bConnect-MCP-Demo-List-Endpoints.mp4
bConnect-Innovation-Demo-2025-10-20.mp4

# Edited versions
bConnect-MCP-Demo-Final.mp4
bConnect-MCP-Demo-Short-Version.mp4
```

---

## Next Steps After Recording

1. **Watch your recording** - Check for errors, clarity, pacing

2. **Get feedback** - Show to colleague before wide distribution

3. **Upload** - Put on company video platform

4. **Document** - Add to Tasks.md as completed

5. **Share** - Link in innovation presentation deck

6. **Archive** - Keep source files for future editing

---

## Quick Start Command

To start recording immediately with asciinema:

```bash
cd /workspaces/claudinno/bConnect-MCP
./scripts/install-asciinema.sh  # First time only
./scripts/record-demo-asciinema.sh
```

Then follow the on-screen prompts!

---

**Ready to create your video demonstration!** Choose your method and follow the guide above.
