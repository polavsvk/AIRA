const { app, BrowserWindow, Tray, Menu, nativeImage, shell, globalShortcut, ipcMain } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')

// Keep global references
let mainWindow = null
let tray = null
let backendProcess = null
let isQuitting = false

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
const BACKEND_PORT = 8000
const FRONTEND_URL = isDev ? 'http://localhost:5173' : `http://localhost:${BACKEND_PORT}`

// ─── Backend Management ───────────────────────────────────────────────────────

function startBackend() {
  const backendPath = isDev
    ? path.join(__dirname, '../backend')
    : path.join(process.resourcesPath, 'backend')

  console.log('Starting NOVA backend at:', backendPath)

  backendProcess = spawn('python3', ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)], {
    cwd: backendPath,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    detached: false
  })

  backendProcess.stdout?.on('data', (data) => console.log('[Backend]', data.toString()))
  backendProcess.stderr?.on('data', (data) => console.error('[Backend]', data.toString()))
  backendProcess.on('error', (err) => console.error('Backend failed to start:', err))
  backendProcess.on('exit', (code) => {
    console.log('Backend exited with code:', code)
    if (!isQuitting) {
      // Restart backend if it crashes
      setTimeout(startBackend, 3000)
    }
  })
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM')
    backendProcess = null
  }
}

async function waitForBackend(maxWait = 15000) {
  const start = Date.now()
  return new Promise((resolve) => {
    const check = () => {
      http.get(`http://127.0.0.1:${BACKEND_PORT}/api/health`, (res) => {
        if (res.statusCode === 200) resolve(true)
        else retry()
      }).on('error', retry)
    }
    const retry = () => {
      if (Date.now() - start > maxWait) { resolve(false); return }
      setTimeout(check, 500)
    }
    check()
  })
}

// ─── Window Management ────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',  // macOS native feel
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#050510',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,  // Show after ready
  })

  // Load the app
  mainWindow.loadURL(FRONTEND_URL)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  // Hide to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
      if (process.platform === 'darwin') app.dock.hide()
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function showWindow() {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (process.platform === 'darwin') app.dock.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function toggleWindow() {
  if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
    if (process.platform === 'darwin') app.dock.hide()
  } else {
    showWindow()
  }
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray() {
  // Create a simple tray icon (we'll use template image for macOS)
  const iconPath = path.join(__dirname, 'assets/tray-icon.png')
  let trayIcon

  try {
    trayIcon = nativeImage.createFromPath(iconPath)
    // Make it a template image for macOS (auto dark/light mode)
    trayIcon.setTemplateImage(true)
  } catch {
    // Fallback: empty image
    trayIcon = nativeImage.createEmpty()
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('NOVA — AI Personal Assistant')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open NOVA',
      click: showWindow,
      accelerator: 'CmdOrCtrl+Shift+N'
    },
    { type: 'separator' },
    {
      label: 'Show in Dock',
      click: () => { app.dock.show(); showWindow() }
    },
    { type: 'separator' },
    {
      label: 'Quit NOVA',
      click: () => {
        isQuitting = true
        stopBackend()
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', toggleWindow)
  tray.on('double-click', showWindow)
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // macOS dock icon
  if (process.platform === 'darwin') {
    const dockIconPath = path.join(__dirname, 'assets/icon.png')
    try {
      app.dock.setIcon(nativeImage.createFromPath(dockIconPath))
    } catch {}
  }

  // Start backend
  startBackend()

  // Create tray first so user sees something immediately
  createTray()

  // Wait for backend, show loading window
  const backendReady = await waitForBackend(15000)

  if (!backendReady) {
    console.error('Backend failed to start within 15 seconds')
  }

  createWindow()

  // Global shortcut - show/hide NOVA
  globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
})

app.on('window-all-closed', (e) => {
  // On macOS, don't quit when all windows close - stay in tray
  if (process.platform !== 'darwin') app.quit()
  else e.preventDefault()
})

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  stopBackend()
})

// ─── Login Item (Auto-start) ──────────────────────────────────────────────────
// Enable auto-start on login
if (app.isPackaged) {
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,  // Start hidden in menu bar, not as full window
  })
}

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('hide-window', () => {
  mainWindow?.hide()
  if (process.platform === 'darwin') app.dock.hide()
})
ipcMain.handle('quit-app', () => {
  isQuitting = true
  stopBackend()
  app.quit()
})
