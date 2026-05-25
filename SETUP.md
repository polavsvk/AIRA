# NOVA — Setup Guide

> AI Personal Assistant for Mr. V — full Iron Man experience, fully local, $0/month

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

All three are free tier. Groq is the most important. **No other API costs ever.**

### 3. Install the local voice pipeline (Phase 1 — required for "Hey Nova" to work)

```bash
bash electron/setup-voice.sh
```

This one-time script:
- Installs **SDL2** via Homebrew (for mic capture)
- Clones and builds **whisper.cpp** in `~/.nova/whisper.cpp`
- Downloads the `ggml-base.en` model (142MB)
- Verifies macOS `say` works (Samantha voice)

Takes ~3 minutes. Fully local. No API costs, no cloud.

---

## Running NOVA

### Desktop App — the JARVIS experience
```bash
bash start-nova-desktop.sh
```

Opens NOVA as a native Mac app. After this:
- Say **"Hey Nova"** → NOVA chimes + listens
- Speak your command → NOVA executes
- NOVA responds in **Samantha Enhanced** voice (macOS neural, free)
- Goes back to standby. Always listening.

### Browser only (no voice)
```bash
bash start-nova.sh
```
Opens at **http://localhost:5173**. No mic in the browser — voice only works in the desktop app.

---

## Auto-Start on Mac Login

The desktop app handles this automatically once you build the production version:
```bash
cd electron && npm run build
```
After install from the `.dmg`, NOVA auto-starts on every Mac boot and lives silently in the menu bar. Cmd+Shift+Space to show window.

For development (running unpackaged), use the optional LaunchAgent:
```bash
cp nova-launch-agent/com.mrv.nova.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.mrv.nova.plist
```

To remove:
```bash
launchctl unload ~/Library/LaunchAgents/com.mrv.nova.plist
rm ~/Library/LaunchAgents/com.mrv.nova.plist
```

---

## Hotkeys

| Hotkey | Action |
|--------|--------|
| **Cmd+Shift+Space** | Show / hide NOVA window |
| **Cmd+Shift+M** | Toggle **Interview Mode** (instant mute) |
| Wake word | Say **"Hey Nova"** anytime |

---

## Interview Mode (CRITICAL — read this before any video call)

NOVA detects calls automatically. The instant any of these apps becomes frontmost, NOVA goes fully silent:
- Zoom
- Microsoft Teams (classic + new)
- FaceTime
- Webex
- Discord
- Skype
- GoToMeeting
- BlueJeans
- RingCentral
- Slack (huddle possible)

In **Interview Mode**:
- ❌ Wake word listening — OFF
- ❌ Mic stream — CLOSED entirely (NOVA isn't holding the mic)
- ❌ TTS / voice output — OFF
- ❌ Proactive interjections — OFF
- ✅ A red banner appears at the top of the NOVA window
- ✅ The tray icon shows 🔇

**Manual override:** Cmd+Shift+M toggles Interview Mode on/off no matter what. Use this for interview practice when no call app is open.

Once your call ends and the call app is no longer frontmost, NOVA wakes back up automatically.

---

## What NOVA Can Do

| Say this | What happens | Who handles it |
|----------|----------|----------------|
| "Hey Nova, what's the weather?" | Reports current weather | AEGIS |
| "Hey Nova, open my Gmail" | Opens Gmail in Chrome | HERMES |
| "Hey Nova, play Blinding Lights on YouTube" | YouTube Music opens, plays | HERMES |
| "Hey Nova, what is quantum entanglement?" | Researches, summarises | ORACLE |
| "Hey Nova, open Calculator" | Opens Calculator | TITAN |
| "Hey Nova, what's on my screen?" | Reads your screen | TITAN |
| "Hey Nova, read my resume at ~/Documents/resume.docx" | Reads the file | ATLAS |
| "Hey Nova, what's the latest news?" | Top headlines | HERALD |
| "Hey Nova, how many agents are working?" | Lists the fleet | NOVA |
| "Hey Nova, plan my week" | Strategic planning | NOVA |

---

## Voice & Mic Permissions

First time you open NOVA, macOS will ask:
- **Microphone access** → click Allow (NOVA needs this for "Hey Nova")
- **Automation access** (for app detection in Interview Mode) → click Allow

If you missed these prompts:
```
System Settings → Privacy & Security → Microphone → ✓ Electron / NOVA
System Settings → Privacy & Security → Automation → ✓ Electron / NOVA → ✓ System Events
```

---

## Updating NOVA

```bash
git pull
bash electron/setup-voice.sh   # idempotent — only updates if needed
bash start-nova-desktop.sh
```

---

## Troubleshooting

### "VOICE PIPELINE NOT INSTALLED" banner showing
Run `bash electron/setup-voice.sh` and restart NOVA.

### Wake word not detecting
1. Check the bottom-right tray icon — it should say "NOVA · Standby"
2. Make sure Mic permission is granted to Electron
3. Say **"Hey Nova"** clearly, with a slight pause after "Hey"
4. Check the console logs (View → Toggle DevTools) for `[WakeEngine]` messages

### NOVA hears herself / talks in circles
Should not happen — the wake engine auto-pauses while TTS is speaking. If it does, file a bug.

### Backend not starting
```bash
source backend/venv/bin/activate
cd backend && uvicorn main:app --reload
```

### Whisper.cpp won't build
```bash
xcode-select --install   # ensure command-line tools
brew reinstall sdl2
bash electron/setup-voice.sh
```

### Want to disable voice entirely (just type)
Click the "VOICE ON" toggle in the header → becomes VOICE OFF. NOVA still works fully, you just type instead of speaking.

---

## Architecture (Phase 1)

```
┌─────────────────────────────────────────────────────────────────┐
│  Electron Main Process (Node.js)                                │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐    │
│  │ whisper.cpp  │──▶│ Wake Engine  │──▶│ Interview Mode   │    │
│  │  (local!)    │   │ (state mach) │   │ (auto-detect)    │    │
│  └──────────────┘   └──────┬───────┘   └──────────────────┘    │
│                            │                                    │
│                            ▼                                    │
│                     ┌──────────────┐   ┌─────────────────┐     │
│                     │ macOS `say`  │   │  Backend (Py)   │     │
│                     │  (Samantha)  │   │   uvicorn       │     │
│                     └──────────────┘   └─────────────────┘     │
│                                                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ IPC
                             ▼
            ┌────────────────────────────────┐
            │  React Renderer (Chat UI)      │
            │  Agent badges, status panel    │
            └────────────────────────────────┘
```

**Everything except the LLM (Groq) runs locally on your Mac. $0/month operating cost.**
