/**
 * NOVA — Electron Main Process
 * ─────────────────────────────
 * Runs the local voice pipeline (whisper.cpp + macOS say), the backend,
 * Interview Mode safeguards, auto-start, and the tray UI.
 */

const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  shell, globalShortcut, ipcMain, session, dialog,
} = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')

const { WakeEngine, STATE: VOICE_STATE } = require('./voice/wake-engine')
const { TTS } = require('./voice/tts')
const { InterviewMode } = require('./voice/interview-mode')
const { ProactiveEngine } = require('./proactive/proactive-engine')

let mainWindow = null
let tray = null
let backendProcess = null
let isQuitting = false

let wakeEngine = null
let tts = null
let interviewMode = null
let proactiveEngine = null
let voiceEnabled = true

const BACKEND_PORT = 8000
const DEV_FRONTEND_URL = `http://localhost:5173`
const PROD_FRONTEND_URL = `http://localhost:${BACKEND_PORT}`
const isDev = process.env.NODE_ENV === 'development'

// ── Auto-start on Mac login (only when packaged — dev runs are manual) ───────
function configureAutoStart() {
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,   // Start in tray, no window — JARVIS-style
    })
  }
}

// ── Microphone & Permissions ─────────────────────────────────────────────────
function setupPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture', 'speechRecognition', 'notifications']
    callback(allowed.includes(permission))
  })

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowed = ['media', 'microphone', 'audioCapture', 'speechRecognition', 'notifications']
    return allowed.includes(permission)
  })
}

// ── Backend ──────────────────────────────────────────────────────────────────
function startBackend() {
  const backendPath = isDev
    ? path.join(__dirname, '../backend')
    : path.join(process.resourcesPath, 'backend')

  const pythonPath = path.join(backendPath, 'venv', 'bin', 'python3')

  console.log('[NOVA] Starting backend:', backendPath)

  backendProcess = spawn(pythonPath, [
    '-m', 'uvicorn', 'main:app',
    '--host', '127.0.0.1',
    '--port', String(BACKEND_PORT),
  ], {
    cwd: backendPath,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    detached: false,
  })

  backendProcess.stdout?.on('data', d => process.stdout.write('[Backend] ' + d))
  backendProcess.stderr?.on('data', d => process.stderr.write('[Backend] ' + d))
  backendProcess.on('error', err => console.error('[NOVA] Backend error:', err.message))
  backendProcess.on('exit', code => {
    console.log('[NOVA] Backend exited:', code)
    if (!isQuitting) setTimeout(startBackend, 3000)
  })
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM')
    backendProcess = null
  }
}

function waitForBackend(maxMs = 20000) {
  const start = Date.now()
  return new Promise(resolve => {
    const check = () => {
      http.get(`http://127.0.0.1:${BACKEND_PORT}/api/health`, res => {
        if (res.statusCode === 200) { console.log('[NOVA] Backend ready ✓'); resolve(true) }
        else retry()
      }).on('error', retry)
    }
    const retry = () => {
      if (Date.now() - start > maxMs) { console.error('[NOVA] Backend timeout'); resolve(false); return }
      setTimeout(check, 500)
    }
    check()
  })
}

// ── Voice Pipeline ───────────────────────────────────────────────────────────
function initVoicePipeline() {
  wakeEngine = new WakeEngine()
  tts = new TTS()
  interviewMode = new InterviewMode()

  // ── Wake engine events ──────────────────────────────────────────────────────
  wakeEngine.on('state', state => {
    mainWindow?.webContents.send('voice:state', state)
    updateTrayIcon()
  })

  wakeEngine.on('wake', ({ residualCommand }) => {
    console.log('[NOVA] Wake detected. Residual:', residualCommand || '(none)')
    tts.chime('Glass')   // Instant audio confirmation, doesn't block mic
    mainWindow?.webContents.send('voice:wake', { residualCommand })
  })

  wakeEngine.on('command', (text) => {
    console.log('[NOVA] Command:', text)
    mainWindow?.webContents.send('voice:command', text)
  })

  wakeEngine.on('command-empty', () => {
    mainWindow?.webContents.send('voice:command-empty')
  })

  wakeEngine.on('error', err => {
    console.error('[NOVA] Voice engine error:', err)
    mainWindow?.webContents.send('voice:error', err)
  })

  // ── TTS events ──────────────────────────────────────────────────────────────
  tts.on('start', text => {
    // Pause listening while speaking — prevents NOVA from hearing herself
    wakeEngine.pause()
    mainWindow?.webContents.send('voice:speaking', text)
  })

  tts.on('end', () => {
    mainWindow?.webContents.send('voice:speak-end')
    // Resume listening after a small gap to clear audio
    setTimeout(() => {
      if (voiceEnabled && !interviewMode.active) {
        wakeEngine.resume()
      }
    }, 400)
  })

  // ── Interview Mode events ───────────────────────────────────────────────────
  interviewMode.on('change', (active, reason) => {
    console.log(`[NOVA] Interview Mode: ${active ? 'ON' : 'OFF'} (${reason})`)
    mainWindow?.webContents.send('voice:interview-mode', { active, reason })
    updateTrayIcon()

    if (active) {
      // Hard stop: kill mic stream, kill TTS, suppress proactive
      wakeEngine.pause()
      tts.stop()
      proactiveEngine?.setInterviewMode(true)
    } else {
      if (voiceEnabled) wakeEngine.resume()
      proactiveEngine?.setInterviewMode(false)
    }
  })

  // ── Start everything ────────────────────────────────────────────────────────
  interviewMode.start(3000)

  // Slight delay before starting wake engine to let UI mount
  setTimeout(() => {
    if (voiceEnabled && !interviewMode.active) {
      const result = wakeEngine.start()
      if (!result.ok) {
        // Show user a clear message about the install
        mainWindow?.webContents.send('voice:not-installed', result.message)
      }
    }
  }, 2500)
}

function stopVoicePipeline() {
  wakeEngine?.stop()
  tts?.stop()
  interviewMode?.stop()
  proactiveEngine?.stop()
}

// ── Proactive API call — streams /api/chat/stream from Node.js ───────────────
function proactiveApiCall(message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      message,
      history: [],
      session_id: 'proactive_engine',
    })

    const req = http.request({
      hostname: '127.0.0.1',
      port:     BACKEND_PORT,
      path:     '/api/chat/stream',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let buf = ''
      let fullContent = ''

      res.on('data', chunk => {
        buf += chunk.toString()
        const lines = buf.split('\n')
        buf = lines.pop()  // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'token') fullContent += ev.content
            else if (ev.type === 'done') { if (fullContent) resolve(fullContent) }
            else if (ev.type === 'rate_limit') reject(new Error('rate_limited'))
          } catch {}
        }
      })

      res.on('end', () => {
        if (fullContent) resolve(fullContent)
        else reject(new Error('empty proactive response'))
      })
      res.on('error', reject)
    })

    req.on('error', reject)
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('proactive timeout')) })
    req.write(body)
    req.end()
  })
}

// ── Handle proactive trigger ──────────────────────────────────────────────────
async function handleProactiveTrigger(trigger) {
  try {
    // Hard guards — these should already be filtered by the engine, but double-check
    if (interviewMode?.active) return
    if (isQuitting) return

    let text = ''

    if (trigger.mode === 'instant') {
      text = trigger.text
    } else if (trigger.mode === 'api') {
      console.log(`[Proactive] API call for "${trigger.type}": ${trigger.message.slice(0, 60)}…`)
      try {
        text = await proactiveApiCall(trigger.message)
      } catch (err) {
        if (err.message === 'rate_limited') {
          console.warn('[Proactive] Rate limited — skipping trigger')
          return
        }
        console.error('[Proactive] API call failed:', err.message)
        return
      }
    }

    if (!text) return

    console.log(`[Proactive] Firing "${trigger.type}": ${text.slice(0, 80)}…`)

    // Speak it (pause wake engine while speaking — same as regular TTS)
    if (voiceEnabled && !interviewMode?.active) {
      await tts?.speak(text)
    }

    // Push to renderer — appears in the chat as a NOVA-initiated message
    mainWindow?.webContents.send('proactive:message', {
      text,
      triggerType: trigger.type,
      priority:    trigger.priority || 'medium',
      timestamp:   Date.now(),
    })

    // Update tray briefly
    updateTrayIcon()

  } catch (err) {
    console.error('[Proactive] handleProactiveTrigger error:', err.message)
  }
}

// ── Init proactive engine ─────────────────────────────────────────────────────
function initProactiveEngine() {
  proactiveEngine = new ProactiveEngine({ enabled: true })

  proactiveEngine.on('trigger', handleProactiveTrigger)

  proactiveEngine.on('error', err => {
    console.error('[Proactive] Engine error:', err)
  })

  proactiveEngine.start()
  console.log('[NOVA] Proactive engine initialised')
}

// ── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#050510',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  })

  const url = isDev ? DEV_FRONTEND_URL : PROD_FRONTEND_URL
  console.log('[NOVA] Loading:', url)
  mainWindow.loadURL(url)

  mainWindow.once('ready-to-show', () => {
    if (!app.getLoginItemSettings().wasOpenedAsHidden) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  mainWindow.on('close', e => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
      app.dock?.hide()
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    mainWindow.webContents.on('before-input-event', (_, input) => {
      if (input.key === 'F12') mainWindow.webContents.openDevTools()
    })
  }
}

function showWindow() {
  if (!mainWindow) { createWindow(); return }
  app.dock?.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function toggleWindow() {
  if (mainWindow?.isVisible() && mainWindow?.isFocused()) {
    mainWindow.hide()
    app.dock?.hide()
  } else {
    showWindow()
  }
}

// ── Tray ─────────────────────────────────────────────────────────────────────
function updateTrayIcon() {
  if (!tray) return
  const inInterview = interviewMode?.active
  const voiceState = wakeEngine?.state
  const speaking = tts?.isSpeaking()

  let label = 'NOVA'
  if (inInterview) label = 'NOVA · 🔇 Interview Mode'
  else if (speaking) label = 'NOVA · Speaking'
  else if (voiceState === VOICE_STATE.LISTENING_COMMAND) label = 'NOVA · Listening'
  else if (voiceState === VOICE_STATE.LISTENING_WAKE) label = 'NOVA · Standby'
  else if (voiceState === VOICE_STATE.PAUSED) label = 'NOVA · Paused'
  else if (voiceState === VOICE_STATE.ERROR) label = 'NOVA · Voice unavailable'

  tray.setToolTip(label)
  rebuildTrayMenu()
}

function rebuildTrayMenu() {
  if (!tray) return
  const inInterview = interviewMode?.active
  const voiceOn = voiceEnabled

  const proactiveOn = proactiveEngine?.getStatus().enabled !== false

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open NOVA', click: showWindow },
    { type: 'separator' },
    {
      label: inInterview ? '🔇 Interview Mode: ON (Cmd+Shift+M)' : '🎙  Interview Mode: OFF (Cmd+Shift+M)',
      click: () => interviewMode?.toggleManual(),
    },
    {
      label: voiceOn ? '🎤 Voice: ON' : '🚫 Voice: OFF',
      click: () => toggleVoice(),
    },
    {
      label: proactiveOn ? '💡 Proactive: ON' : '💡 Proactive: OFF',
      click: () => {
        proactiveEngine?.setEnabled(!proactiveEngine.getStatus().enabled)
        rebuildTrayMenu()
      },
    },
    { type: 'separator' },
    { label: 'Show in Dock', click: () => { app.dock?.show(); showWindow() } },
    { type: 'separator' },
    { label: 'Quit NOVA', click: () => { isQuitting = true; stopVoicePipeline(); stopBackend(); app.quit() } },
  ]))
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
  let icon
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) icon = nativeImage.createEmpty()
    else icon.setTemplateImage(true)
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('NOVA — AI Personal Assistant')

  tray.on('click', toggleWindow)
  tray.on('double-click', showWindow)

  rebuildTrayMenu()
}

// ── Voice control helpers ────────────────────────────────────────────────────
function toggleVoice() {
  voiceEnabled = !voiceEnabled
  if (voiceEnabled) {
    if (!interviewMode.active) wakeEngine.start()
  } else {
    wakeEngine.stop()
    tts.stop()
  }
  mainWindow?.webContents.send('voice:enabled', voiceEnabled)
  updateTrayIcon()
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  setupPermissions()
  configureAutoStart()

  startBackend()
  createTray()

  await waitForBackend(20000)
  createWindow()

  // Voice pipeline starts after window is ready
  initVoicePipeline()

  // Proactive engine — NOVA speaks first
  initProactiveEngine()

  // Global shortcuts
  globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow)
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    interviewMode?.toggleManual()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
})

app.on('window-all-closed', e => {
  if (process.platform !== 'darwin') app.quit()
  else e.preventDefault()
})

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  stopVoicePipeline()
  stopBackend()
})

// ── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('hide-window', () => { mainWindow?.hide(); app.dock?.hide() })
ipcMain.handle('quit-app', () => { isQuitting = true; stopVoicePipeline(); stopBackend(); app.quit() })

// Voice control IPC
ipcMain.handle('voice:status', () => ({
  enabled: voiceEnabled,
  state: wakeEngine?.state || 'idle',
  installed: wakeEngine?.isInstalled() || false,
  installStatus: wakeEngine?.getInstallStatus(),
  speaking: tts?.isSpeaking() || false,
  interviewMode: interviewMode?.getStatus(),
}))

ipcMain.handle('voice:enable', () => { if (!voiceEnabled) toggleVoice(); return voiceEnabled })
ipcMain.handle('voice:disable', () => { if (voiceEnabled) toggleVoice(); return voiceEnabled })
ipcMain.handle('voice:toggle', () => { toggleVoice(); return voiceEnabled })

ipcMain.handle('voice:speak', async (e, text, opts) => {
  if (!text || interviewMode.active) return { ok: false, reason: 'interview mode' }
  await tts.speak(text, opts || {})
  return { ok: true }
})

ipcMain.handle('voice:stop-speaking', () => { tts?.stop() })

ipcMain.handle('voice:chime', (e, name) => { tts?.chime(name || 'Glass') })

ipcMain.handle('voice:interview-toggle', () => {
  interviewMode.toggleManual()
  return interviewMode.getStatus()
})

ipcMain.handle('voice:interview-status', () => interviewMode?.getStatus())

// ── Proactive IPC ─────────────────────────────────────────────────────────────
ipcMain.handle('proactive:status', () => proactiveEngine?.getStatus() || { enabled: false })
ipcMain.handle('proactive:toggle', () => {
  if (!proactiveEngine) return false
  const next = !proactiveEngine.getStatus().enabled
  proactiveEngine.setEnabled(next)
  rebuildTrayMenu()
  return next
})
ipcMain.handle('proactive:suppress', (e, ms) => {
  proactiveEngine?.suppress(ms || 5 * 60_000)
})
// One-way: renderer tells main "user is active" → suppress proactive chatter
ipcMain.on('proactive:activity', () => {
  proactiveEngine?.recordActivity()
})
