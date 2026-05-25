const {
  app, BrowserWindow, Tray, Menu, nativeImage,
  shell, globalShortcut, ipcMain, session
} = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')

let mainWindow = null
let tray = null
let backendProcess = null
let isQuitting = false

const BACKEND_PORT = 8000
const DEV_FRONTEND_URL = `http://localhost:5173`
const PROD_FRONTEND_URL = `http://localhost:${BACKEND_PORT}`
const isDev = process.env.NODE_ENV === 'development'

// ─── Microphone & Permissions ─────────────────────────────────────────────────
// Grant mic + speech API access — NOVA needs these to function
function setupPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture', 'speechRecognition']
    callback(allowed.includes(permission))
  })

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowed = ['media', 'microphone', 'audioCapture', 'speechRecognition']
    return allowed.includes(permission)
  })
}

// ─── Backend ──────────────────────────────────────────────────────────────────
function startBackend() {
  const backendPath = isDev
    ? path.join(__dirname, '../backend')
    : path.join(process.resourcesPath, 'backend')

  // Use the venv Python — not system Python
  const pythonPath = path.join(backendPath, 'venv', 'bin', 'python3')

  console.log('[NOVA] Starting backend:', backendPath)
  console.log('[NOVA] Python:', pythonPath)

  backendProcess = spawn(pythonPath, [
    '-m', 'uvicorn', 'main:app',
    '--host', '127.0.0.1',
    '--port', String(BACKEND_PORT)
  ], {
    cwd: backendPath,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    detached: false
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

// ─── Window ───────────────────────────────────────────────────────────────────
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
      // Enable Web Speech API
      experimentalFeatures: true,
    },
    show: false,
  })

  const url = isDev ? DEV_FRONTEND_URL : PROD_FRONTEND_URL
  console.log('[NOVA] Loading:', url)
  mainWindow.loadURL(url)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  // Hide to tray on close — don't quit
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

  // Dev tools in dev mode
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

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
  let icon
  try {
    icon = nativeImage.createFromPath(iconPath)
    icon.setTemplateImage(true)
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('NOVA — AI Personal Assistant')

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open NOVA', click: showWindow },
    { type: 'separator' },
    { label: 'Show in Dock', click: () => { app.dock?.show(); showWindow() } },
    { type: 'separator' },
    { label: 'Quit NOVA', click: () => { isQuitting = true; stopBackend(); app.quit() } }
  ]))

  tray.on('click', toggleWindow)
  tray.on('double-click', showWindow)
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Permissions first — before any window loads
  setupPermissions()

  // Start backend
  startBackend()

  // Show tray immediately
  createTray()

  // Wait for backend
  await waitForBackend(20000)

  // Create window
  createWindow()

  // Global shortcut — Cmd+Shift+Space to toggle
  globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
})

app.on('window-all-closed', e => {
  // macOS: stay alive in tray
  if (process.platform !== 'darwin') app.quit()
  else e.preventDefault()
})

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  stopBackend()
})

// Auto-start on login when packaged
if (app.isPackaged) {
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('hide-window', () => { mainWindow?.hide(); app.dock?.hide() })
ipcMain.handle('quit-app', () => { isQuitting = true; stopBackend(); app.quit() })
