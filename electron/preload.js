const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  quit: () => ipcRenderer.invoke('quit-app'),
  isElectron: true,
})
