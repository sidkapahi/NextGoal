'use strict'

const { app, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const windows = require('./windows')
const { createTray, updateTray } = require('./tray')
const config = require('./services/config')
const auth = require('./services/twitchAuth')
const { SubTracker } = require('./services/tracker')
const { OBSClient, OBSError } = require('./services/obs')
const { computeGoal } = require('./services/goal')
const updater = require('./services/updater')

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// live app state
let cfg = null
let refreshToken = null
let tracker = null
let obs = new OBSClient()
let count = 0
let goal = 5
let loginCancel = false

app.on('window-all-closed', () => {
  // tray app: do not quit when the flyout hides
})
app.on('second-instance', () => windows.toggleFlyout())
app.on('before-quit', () => {
  if (tracker) tracker.stop()
  obs.close()
})

app.whenReady().then(async () => {
  cfg = config.load()
  refreshToken = config.loadToken()
  goal = computeGoal(0, cfg.startGoal, cfg.increment)

  windows.createWindow({ preloadPath: path.join(__dirname, '../preload/index.js') })

  createTray({
    getStatus: () => ({ tracking: !!tracker, count, goal }),
    onToggleTracking: () => (tracker ? stopTracking() : startTracking()),
    onReset: () => resetCount(),
  })

  updater.init({
    onAvailable: (v) => send('update-available', v),
    onDownloaded: (v) => send('update-downloaded', v),
    onError: () => {},
  })
  if (cfg.checkForUpdates) updater.check()

  if (cfg.onboarded) {
    await windows.enterFlyoutMode()
    if (!cfg.startMinimized) windows.toggleFlyout()
    if (cfg.autostartTracking && refreshToken) startTracking()
  } else {
    await windows.showOnboarding()
  }
})

function send(channel, payload) {
  const w = windows.getWindow()
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
}

function persistToken(token) {
  refreshToken = token
  const secure = config.saveToken(token)
  if (!secure && !cfg.insecureTokenFallback) {
    cfg.insecureTokenFallback = true
    config.save(cfg)
    send('warning', 'Your login is stored unencrypted (secure storage unavailable).')
  }
}

// ---- output: file + obs ----
async function pushOutput() {
  goal = computeGoal(count, cfg.startGoal, cfg.increment)
  const text = `${count}/${goal}`
  send('count-changed', { count, goal })
  updateTray({ tracking: !!tracker, count, goal })

  if (cfg.writeToFile && cfg.outputFile) {
    try {
      fs.writeFileSync(cfg.outputFile, text, 'utf8')
    } catch (e) {
      send('status', `File write failed: ${e.message}`)
    }
  }
  if (cfg.useObsWebsocket && cfg.obsSource) {
    try {
      if (!obs.connected)
        await obs.connect({ host: cfg.obsHost, port: cfg.obsPort, password: obsPassword })
      await obs.setText(cfg.obsSource, text)
    } catch (e) {
      send('status', e.message)
    }
  }
}

let obsPassword = '' // held in memory only, never written to disk

// ---- tracking ----
function startTracking() {
  if (!refreshToken || !cfg.broadcasterId) {
    send('need-login')
    return
  }
  count = 0
  pushOutput()

  tracker = new SubTracker({
    broadcasterId: cfg.broadcasterId,
    refreshToken,
    onNewRefreshToken: persistToken,
  })
  tracker.on('subs', (n) => {
    count = Math.max(0, count + n)
    pushOutput()
  })
  tracker.on('connected', () => send('status', 'Live \u2014 listening for subs'))
  tracker.on('status', (m) => send('status', m))
  tracker.on('error', (m) => send('status', m))
  tracker.on('auth-expired', (m) => {
    stopTracking()
    send('auth-expired', m)
  })
  tracker.on('stopped', () => {
    updateTray({ tracking: false, count, goal })
    send('tracking-changed', false)
  })
  tracker.start()
  updateTray({ tracking: true, count, goal })
  send('tracking-changed', true)
}

function stopTracking() {
  if (tracker) {
    tracker.stop()
    tracker = null
  }
  updateTray({ tracking: false, count, goal })
  send('tracking-changed', false)
}

function resetCount() {
  count = 0
  pushOutput()
}

// ===================== IPC =====================

ipcMain.handle('get-state', () => ({
  cfg,
  connected: !!refreshToken && !!cfg.broadcasterId,
  broadcasterName: cfg.broadcasterName,
  tracking: !!tracker,
  count,
  goal,
}))

ipcMain.handle('save-settings', (_e, patch) => {
  Object.assign(cfg, patch)
  config.save(cfg)
  goal = computeGoal(count, cfg.startGoal, cfg.increment)
  send('count-changed', { count, goal })
  return cfg
})

ipcMain.handle('set-obs-password', (_e, pw) => {
  obsPassword = pw || ''
  obs = new OBSClient() // force fresh connect with new creds
  return true
})

// --- Twitch login (device code) ---
ipcMain.handle('twitch-login-start', async () => {
  loginCancel = false
  try {
    const dc = await auth.startDeviceFlow()
    // kick off polling in the background; result comes via events
    ;(async () => {
      try {
        const { accessToken, refreshToken: rt } = await auth.pollForToken(
          dc.device_code,
          dc.interval,
          dc.expires_in,
          () => loginCancel
        )
        persistToken(rt)
        const user = await auth.getCurrentUser(accessToken)
        cfg.broadcasterId = user.id
        cfg.broadcasterName = user.name
        config.save(cfg)
        send('twitch-login-ok', { name: user.name })
      } catch (e) {
        send('twitch-login-failed', e.message)
      }
    })()
    return {
      userCode: dc.user_code,
      verificationUri: dc.verification_uri || 'https://www.twitch.tv/activate',
    }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle('twitch-login-cancel', () => {
  loginCancel = true
})

ipcMain.handle('twitch-logout', () => {
  if (tracker) stopTracking()
  config.clearToken()
  refreshToken = null
  cfg.broadcasterId = ''
  cfg.broadcasterName = ''
  config.save(cfg)
  return true
})

// --- OBS ---
ipcMain.handle('obs-auto-detect', async () => {
  obs = new OBSClient()
  const ok = await obs.tryAutoDetect()
  return ok
})

ipcMain.handle('obs-connect', async (_e, { host, port, password }) => {
  obs = new OBSClient()
  obsPassword = password || ''
  try {
    await obs.connect({ host, port, password })
    cfg.obsHost = host
    cfg.obsPort = port
    config.save(cfg)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('obs-list-sources', async () => {
  try {
    return { sources: await obs.listTextSources() }
  } catch (e) {
    return { error: e.message }
  }
})

ipcMain.handle('obs-create-source', async (_e, name) => {
  try {
    const created = await obs.createTextSource(name)
    cfg.obsSource = created
    config.save(cfg)
    return { ok: true, name: created }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// --- tracking controls ---
ipcMain.handle('start-tracking', () => startTracking())
ipcMain.handle('stop-tracking', () => stopTracking())
ipcMain.handle('reset-count', () => resetCount())
ipcMain.handle('adjust-count', (_e, n) => {
  count = Math.max(0, count + n)
  pushOutput()
})

// --- test sub (onboarding + testing) ---
ipcMain.handle('fire-test-sub', () => {
  count = Math.max(0, count + 1)
  pushOutput()
})

// --- windowing ---
ipcMain.handle('onboarding-complete', async () => {
  cfg.onboarded = true
  config.save(cfg)
  await windows.enterFlyoutMode()
  windows.positionFlyout()
  const w = windows.getWindow()
  if (w) w.show()
  return true
})
ipcMain.handle('flyout-hide', () => {
  const w = windows.getWindow()
  if (w && windows.getMode() === 'flyout') w.hide()
})
ipcMain.handle('flyout-pin', (_e, v) => {
  windows.setPinned(v)
  return windows.isPinned()
})
ipcMain.handle('open-full-window', () => windows.showWindowed())
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url))
ipcMain.handle('install-update', () => updater.quitAndInstall())
