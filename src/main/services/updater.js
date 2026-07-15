'use strict'

// Real auto-update via electron-updater against GitHub Releases.
// We notify + let electron-updater download; install on quit.

const { autoUpdater } = require('electron-updater')
const { app } = require('electron')

// Alpha builds (0.x or -alpha tags) should receive prereleases.
function isPrerelease(v) {
  return /-/.test(v) || v.startsWith('0.')
}

function init({ onAvailable, onDownloaded, onError }) {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = isPrerelease(app.getVersion())

  autoUpdater.on('update-available', (info) => onAvailable && onAvailable(info.version))
  autoUpdater.on('update-downloaded', (info) => onDownloaded && onDownloaded(info.version))
  autoUpdater.on('error', (err) => onError && onError(String(err)))
}

function check() {
  // no-op in dev (no update server); guard so it doesn't throw
  if (!app.isPackaged) return
  autoUpdater.checkForUpdates().catch(() => {})
}

function quitAndInstall() {
  autoUpdater.quitAndInstall()
}

module.exports = { init, check, quitAndInstall, isPrerelease }
