'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function on(channel, cb) {
  const h = (_e, v) => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

contextBridge.exposeInMainWorld('ng', {
  // state
  getState: () => ipcRenderer.invoke('get-state'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),

  // twitch
  loginStart: () => ipcRenderer.invoke('twitch-login-start'),
  loginCancel: () => ipcRenderer.invoke('twitch-login-cancel'),
  logout: () => ipcRenderer.invoke('twitch-logout'),

  // obs
  obsAutoDetect: () => ipcRenderer.invoke('obs-auto-detect'),
  obsConnect: (opts) => ipcRenderer.invoke('obs-connect', opts),
  obsListSources: () => ipcRenderer.invoke('obs-list-sources'),
  obsCreateSource: (name) => ipcRenderer.invoke('obs-create-source', name),
  setObsPassword: (pw) => ipcRenderer.invoke('set-obs-password', pw),

  // tracking
  startTracking: () => ipcRenderer.invoke('start-tracking'),
  stopTracking: () => ipcRenderer.invoke('stop-tracking'),
  resetCount: () => ipcRenderer.invoke('reset-count'),
  adjustCount: (n) => ipcRenderer.invoke('adjust-count', n),
  fireTestSub: () => ipcRenderer.invoke('fire-test-sub'),

  // windowing
  completeOnboarding: () => ipcRenderer.invoke('onboarding-complete'),
  hideFlyout: () => ipcRenderer.invoke('flyout-hide'),
  setPinned: (v) => ipcRenderer.invoke('flyout-pin', v),
  openFullWindow: () => ipcRenderer.invoke('open-full-window'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // events from main
  onCountChanged: (cb) => on('count-changed', cb),
  onTrackingChanged: (cb) => on('tracking-changed', cb),
  onStatus: (cb) => on('status', cb),
  onWarning: (cb) => on('warning', cb),
  onNeedLogin: (cb) => on('need-login', cb),
  onAuthExpired: (cb) => on('auth-expired', cb),
  onTwitchLoginOk: (cb) => on('twitch-login-ok', cb),
  onTwitchLoginFailed: (cb) => on('twitch-login-failed', cb),
  onUpdateAvailable: (cb) => on('update-available', cb),
  onUpdateDownloaded: (cb) => on('update-downloaded', cb),
})
