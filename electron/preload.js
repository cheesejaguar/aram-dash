'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Surface only the small, audited IPC channels the settings page needs.
// contextIsolation + sandbox keep the renderer locked down; everything the
// renderer wants to do to the OS goes through these named invocations.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  applyWindow: (opts) => ipcRenderer.invoke('apply-window', opts),
  relaunch: () => ipcRenderer.invoke('relaunch'),
  quit: () => ipcRenderer.invoke('quit'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  confirmRestart: (keys) => ipcRenderer.invoke('confirm-restart', keys),
  getVersion: () => ipcRenderer.invoke('get-version'),
});
