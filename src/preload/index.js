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
  setSessionGoal: (patch) => ipcRenderer.invoke('set-session-goal', patch),

  // platform auth (twitch | youtube | kick). Defaults to twitch so existing
  // call sites keep working.
  loginStart: (platform = 'twitch') => ipcRenderer.invoke('login-start', platform),
  loginCancel: (platform = 'twitch') => ipcRenderer.invoke('login-cancel', platform),
  logout: (platform = 'twitch') => ipcRenderer.invoke('logout', platform),
  setPlatformEnabled: (platform, on) =>
    ipcRenderer.invoke('set-platform-enabled', { platform, on }),

  // obs
  obsConnect: (opts) => ipcRenderer.invoke('obs-connect', opts),
  obsListSources: () => ipcRenderer.invoke('obs-list-sources'),
  obsCreateSource: (name) => ipcRenderer.invoke('obs-create-source', name),
  obsSelectSource: (name) => ipcRenderer.invoke('obs-select-source', name),
  obsTestSource: (name) => ipcRenderer.invoke('obs-test-source', name),
  obsPing: () => ipcRenderer.invoke('obs-ping'),
  setObsPassword: (pw) => ipcRenderer.invoke('set-obs-password', pw),

  // all-time subscriber totals (fetched on demand — no background polling)
  refreshTotals: () => ipcRenderer.invoke('refresh-totals'),

  // tracking
  startTracking: () => ipcRenderer.invoke('start-tracking'),
  stopTracking: () => ipcRenderer.invoke('stop-tracking'),
  resetCount: () => ipcRenderer.invoke('reset-count'),
  adjustCount: (n) => ipcRenderer.invoke('adjust-count', n),
  adjustGoal: (n) => ipcRenderer.invoke('adjust-goal', n),
  syncSubCount: (on) => ipcRenderer.invoke('sync-sub-count', on),

  // windowing
  completeOnboarding: () => ipcRenderer.invoke('onboarding-complete'),
  resetAllData: () => ipcRenderer.invoke('reset-all-data'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // events from main
  onCountChanged: (cb) => on('count-changed', cb),
  onTrackingChanged: (cb) => on('tracking-changed', cb),
  onObsStatus: (cb) => on('obs-status', cb),
  onTotalsChanged: (cb) => on('totals-changed', cb),
  onPlatformWarnings: (cb) => on('platform-warnings', cb),
  onStatus: (cb) => on('status', cb),
  onWarning: (cb) => on('warning', cb),
  onAuthExpired: (cb) => on('auth-expired', cb),
  // Platform login result events carry { platform, name, avatar } / { platform, message }.
  onLoginOk: (cb) => on('login-ok', cb),
  onLoginFailed: (cb) => on('login-failed', cb),
  onUpdateDownloaded: (cb) => on('update-downloaded', cb),
})
