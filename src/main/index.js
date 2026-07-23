'use strict'

const { app, ipcMain, shell, Menu } = require('electron')
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
let synced = false
let loginCancel = false

// Session goal values: a live, non-persisted copy of the goal settings the main
// screen edits. Seeded from the saved defaults (cfg.startGoal / cfg.increment)
// at launch; editing them on the main screen never rewrites those defaults.
let sessStartGoal = 5
let sessIncrement = 5

// Manual goal override: the right +/- on the counter set the goal directly. A
// manual goal sticks through incoming subs until the count reaches it (then it
// rolls to the next milestone) or Reset clears it.
let manualGoal = false

app.on('window-all-closed', () => {
  // tray app: closing the window hides it to the tray, so this normally
  // won't fire; if it does, keep running so the tray icon stays alive.
})
app.on('second-instance', () => windows.showWindow())
app.on('before-quit', () => {
  app.isQuitting = true
  if (tracker) tracker.stop()
  obs.close()
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null) // remove default File/Edit/View/Window menu bar

  cfg = config.load()
  refreshToken = config.loadToken()
  obsPassword = config.loadObsPassword() || ''
  sessStartGoal = cfg.startGoal
  sessIncrement = cfg.increment
  goal = computeGoal(0, sessStartGoal, sessIncrement)

  windows.createWindow({ preloadPath: path.join(__dirname, '../preload/index.js') })

  // Put a loading screen on top immediately; present() dismisses it once the
  // real window has painted. Guarded so a splash failure never aborts startup.
  try {
    windows.createSplash()
  } catch {}

  // Show the UI first, before tray/updater, so nothing downstream can ever
  // leave the app running with no visible window.
  if (cfg.onboarded) {
    await windows.showApp()
    if (cfg.startMinimized) windows.getWindow()?.hide()
  } else {
    await windows.showOnboarding()
  }

  // Guard tray creation: a failure here must never abort startup and leave the
  // app running without its (already-shown) window.
  try {
    createTray({
      getStatus: () => ({ tracking: !!tracker, count, goal }),
      onToggleTracking: () => (tracker ? stopTracking() : startTracking()),
      onReset: () => resetCount(),
    })
  } catch {}

  try {
    updater.init({
      onAvailable: (v) => send('update-available', v),
      onDownloaded: (v) => send('update-downloaded', v),
      onError: () => {},
    })
    if (cfg.checkForUpdates) updater.check()
  } catch {}

  if (cfg.onboarded && cfg.autostartTracking && refreshToken) startTracking()
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
  // A manual goal (set via the right +/-) is kept as-is until the count catches
  // up to it; once count >= goal we roll to the next milestone and drop the
  // override. Otherwise the goal is derived from the session goal values — and
  // when synced, the base is interval-aligned (nearest increment strictly above
  // the count) instead of the session starting goal.
  if (manualGoal && count < goal) {
    // keep the manually set goal
  } else {
    manualGoal = false
    goal = synced
      ? computeGoal(count, sessIncrement, sessIncrement)
      : computeGoal(count, sessStartGoal, sessIncrement)
  }
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
  // Preserve the seeded value when synced; otherwise start each session at 0.
  if (!synced) count = 0
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
  // Benign tracker info (gift announcements, "Reconnecting…") no longer has a UI
  // surface in the redesign — the counter updates on its own — so it is dropped
  // rather than shown. Only genuine errors reach the toast.
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
  manualGoal = false
  pushOutput()
}

// Right +/- on the counter: set the goal directly. Never let it fall to or
// below the current count. Flagged as manual so pushOutput keeps it.
function adjustGoal(n) {
  goal = Math.max(count + 1, goal + n)
  manualGoal = true
  pushOutput()
}

// ===================== IPC =====================

ipcMain.handle('get-state', () => ({
  cfg,
  connected: !!refreshToken && !!cfg.broadcasterId,
  broadcasterName: cfg.broadcasterName,
  broadcasterAvatar: cfg.broadcasterAvatar,
  tracking: !!tracker,
  synced,
  count,
  goal,
  // Live session goal values (the main screen edits these, not the defaults).
  startGoal: sessStartGoal,
  increment: sessIncrement,
  obsPassword,
}))

// Persist a settings patch (Settings screen: default goal values, OBS host/port).
// This does not touch the live session goal or recompute the current goal.
ipcMain.handle('save-settings', (_e, patch) => {
  Object.assign(cfg, patch)
  config.save(cfg)
  return cfg
})

// Main screen goal inputs: update the live session values (not persisted) and
// recompute the current goal from them.
ipcMain.handle('set-session-goal', (_e, { startGoal, increment } = {}) => {
  if (startGoal != null) sessStartGoal = Math.max(1, Number(startGoal) || 1)
  if (increment != null) sessIncrement = Math.max(1, Number(increment) || 1)
  manualGoal = false
  pushOutput()
  return { startGoal: sessStartGoal, increment: sessIncrement, count, goal }
})

// Danger Zone > Reset to Defaults: restore the saved default goal settings to
// the factory values. Leaves the live session, count and Twitch/OBS untouched.
ipcMain.handle('reset-defaults', () => {
  cfg.startGoal = config.DEFAULTS.startGoal
  cfg.increment = config.DEFAULTS.increment
  config.save(cfg)
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
        cfg.broadcasterAvatar = user.avatar || ''
        config.save(cfg)
        send('twitch-login-ok', { name: user.name, avatar: user.avatar || '' })
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
  cfg.broadcasterAvatar = ''
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
    // Remember the password (encrypted) so re-editing prefills it and the app
    // can reconnect after a restart. An empty password clears any stored one.
    config.saveObsPassword(obsPassword)
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

// Bind to an existing text source without creating anything.
ipcMain.handle('obs-select-source', (_e, name) => {
  cfg.obsSource = name || ''
  config.save(cfg)
  return { ok: true, name: cfg.obsSource }
})

// Write sample text to a source so the user can confirm it shows in OBS.
ipcMain.handle('obs-test-source', async (_e, name) => {
  try {
    await obs.setText(name || cfg.obsSource, `${count}/${goal}`)
    return { ok: true }
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
ipcMain.handle('adjust-goal', (_e, n) => adjustGoal(n))

// --- sync counter to current Twitch sub total ---
ipcMain.handle('sync-sub-count', async (_e, on) => {
  if (!on) {
    synced = false
    count = 0
    pushOutput()
    return { ok: true, synced: false, count, goal }
  }
  if (!refreshToken || !cfg.broadcasterId) {
    return { ok: false, error: 'Connect your Twitch account first.' }
  }
  try {
    const accessToken = await auth.refreshAccessToken(refreshToken, persistToken)
    const total = await auth.getSubscriberCount(accessToken, cfg.broadcasterId)
    synced = true
    count = Math.max(0, total | 0)
    pushOutput() // recomputes goal as the nearest increment strictly above count
    return { ok: true, synced: true, count, goal }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// --- test sub (onboarding + testing) ---
ipcMain.handle('fire-test-sub', () => {
  count = Math.max(0, count + 1)
  pushOutput()
})

// Wipe everything back to a first-run state: settings, Twitch login and the
// saved OBS password. The renderer navigates to onboarding afterward; on next
// launch the cleared onboarded flag sends the user through setup again.
ipcMain.handle('reset-all-data', () => {
  if (tracker) stopTracking()
  try {
    obs.close()
  } catch {}
  config.clearToken()
  config.clearObsPassword()
  cfg = { ...config.DEFAULTS }
  config.save(cfg)
  refreshToken = null
  obsPassword = ''
  obs = new OBSClient()
  count = 0
  synced = false
  manualGoal = false
  sessStartGoal = cfg.startGoal
  sessIncrement = cfg.increment
  goal = computeGoal(0, sessStartGoal, sessIncrement)
  updateTray({ tracking: false, count, goal })
  return true
})

// --- windowing ---
ipcMain.handle('onboarding-complete', async () => {
  cfg.onboarded = true
  config.save(cfg)
  await windows.showApp()
  return true
})
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url))
ipcMain.handle('install-update', () => updater.quitAndInstall())
