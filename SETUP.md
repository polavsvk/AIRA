# NOVA — Setup Guide

> AI Personal Assistant for Mr. V

---

## First-Time Setup

### 1. Clone & enter the project
```bash
cd ~/Projects/NOVA   # or wherever you cloned it
```

### 2. Add your API keys
```bash
cp .env.example .env
open .env   # fill in your keys
```

Your `.env` needs:
```
GROQ_API_KEY=your_key_from_console.groq.com
OPENWEATHER_API_KEY=your_key_from_openweathermap.org
NEWS_API_KEY=your_key_from_newsapi.org
```

All three are free tier. Groq is the most important.

---

## Running NOVA

### Option A — Browser (simplest)
```bash
bash start-nova.sh
```
Opens at **http://localhost:5173** automatically.

### Option B — Desktop App (menu bar + dock)
```bash
bash start-nova-desktop.sh
```
Launches as a native Mac app. NOVA icon appears in your menu bar.

---

## Auto-Start on Login (Optional)

To have NOVA start automatically when your Mac boots:

```bash
# 1. Edit the plist — replace NOVA_FOLDER_PATH with your actual path
#    e.g. /Users/yourname/Projects/NOVA
nano nova-launch-agent/com.mrv.nova.plist

# 2. Replace YOUR_HOME_PATH with your home directory
#    e.g. /Users/yourname

# 3. Install it
cp nova-launch-agent/com.mrv.nova.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.mrv.nova.plist
```

To remove auto-start:
```bash
launchctl unload ~/Library/LaunchAgents/com.mrv.nova.plist
rm ~/Library/LaunchAgents/com.mrv.nova.plist
```

---

## What NOVA Can Do

| Say this | NOVA does this |
|----------|----------------|
| "Hey Nova" | Wakes up and listens |
| "Open my Gmail" | Opens Gmail in Chrome |
| "Play Blinding Lights on YouTube" | Searches YouTube, plays it |
| "What's on Wikipedia about black holes?" | Opens Wikipedia, reads it, tells you |
| "Read my resume at ~/Documents/resume.docx" | Reads the file |
| "Update my resume with this JD…" | Edits it, shows you the diff, asks confirmation |
| "Search for the latest AI news" | Web search, returns results |
| "Open Finder" / "Open Xcode" | Opens any Mac app |
| "Give me my briefing" | Weather + news + tasks summary |

---

## Browser Automation

NOVA uses your **existing Chrome login sessions** — no API keys, no OAuth.  
Just have Chrome open and logged into Gmail, YouTube, etc.

---

## Updating NOVA

```bash
git pull
bash start-nova.sh
```

---

## Troubleshooting

**Backend not starting?**
```bash
source backend/venv/bin/activate
cd backend && uvicorn main:app --reload
```

**Playwright not working?**
```bash
source backend/venv/bin/activate
playwright install chromium
```

**Voice not working?** → Make sure you're using Chrome and allowed microphone access.

**Wake word not detecting?** → Say "Hey Nova" clearly. Chrome works best. Safari has limited Speech API support.
