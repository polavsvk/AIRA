const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  quit: () => ipcRenderer.invoke('quit-app'),
  isElectron: true,
})

// ── NOVA Voice API — exposed to the React renderer ──────────────────────────
contextBridge.exposeInMainWorld('nova', {
  isElectron: true,

  voice: {
    // Status & control
    getStatus:        () => ipcRenderer.invoke('voice:status'),
    enable:           () => ipcRenderer.invoke('voice:enable'),
    disable:          () => ipcRenderer.invoke('voice:disable'),
    toggle:           () => ipcRenderer.invoke('voice:toggle'),
    speak:            (text, opts) => ipcRenderer.invoke('voice:speak', text, opts),
    stopSpeaking:     () => ipcRenderer.invoke('voice:stop-speaking'),
    chime:            (name) => ipcRenderer.invoke('voice:chime', name),

    // Interview mode
    toggleInterview:  () => ipcRenderer.invoke('voice:interview-toggle'),
    interviewStatus:  () => ipcRenderer.invoke('voice:interview-status'),

    // Event subscriptions — return an unsubscribe function
    onState:           (cb) => _subscribe('voice:state', cb),
    onWake:            (cb) => _subscribe('voice:wake', cb),
    onCommand:         (cb) => _subscribe('voice:command', cb),
    onCommandEmpty:    (cb) => _subscribe('voice:command-empty', cb),
    onSpeaking:        (cb) => _subscribe('voice:speaking', cb),
    onSpeakEnd:        (cb) => _subscribe('voice:speak-end', cb),
    onInterviewMode:   (cb) => _subscribe('voice:interview-mode', cb),
    onEnabledChanged:  (cb) => _subscribe('voice:enabled', cb),
    onError:           (cb) => _subscribe('voice:error', cb),
    onNotInstalled:    (cb) => _subscribe('voice:not-installed', cb),
  },
})

function _subscribe(channel, callback) {
  const handler = (_e, ...args) => callback(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}
