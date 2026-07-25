'use strict'

const { app, ipcMain, shell, Menu } = require('electron')
const path = require('path')
const fs = require('fs')

const windows = require('./windows')
const { createTray, updateTray } = require('./tray')
const config = require('./services/config')
const auth = require('./services/twitchAuth')
const youtubeAuth = require('./services/youtubeAuth')
const kickAuth = require('./services/kickAuth')
const { SubTracker } = require('./services/tracker')
const { Poller } = require('./services/poller')
const { OBSClient } = require('./services/obs')
const { computeGoal } = require('./services/goal')
const {
  PLATFORMS,
  makeSources,
  participates,
  combinedCount,
  contribution,
} = require('./services/sources')
const updater = require('./services/updater')

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ---- live app state ----
let cfg = null
let obsOnline = false
let obs = makeObs()
let count = 0
let goal = 5
let synced = false
let obsPassword = '' // held in memory only, never written to disk

// Per-source runtime state and in-memory refresh tokens. `sources` tracks each
// platform's current/baseline totals; `refreshTokens` holds the (encrypted at
// rest) refresh token loaded for each platform.
const sources = makeSources()
const refreshTokens = { twitch: null, youtube: null, kick: null }

// Active source drivers while tracking.
let twitchTracker = null
const pollers = { youtube: null, kick: null }
let tracking = false

// Device-code login cancel flags, per platform.
const loginCancel = { twitch: false, youtube: false, kick: false }

// Manual counter nudges (the +/- on the count) and test subs fold in here so
// they survive live/poll updates that recompute the combined count.
let manualOffset = 0

// Session goal values: a live, non-persisted copy of the goal settings the main
// screen edits. Seeded from the saved defaults (cfg.startGoal / cfg.increment).
let sessStartGoal = 5
let sessIncrement = 5

// Manual goal override: the right +/- on the counter set the goal directly.
let manualGoal = false

// ---- provider registry: uniform per-platform auth + total access ----
const providers = {
  twitch: {
    auth,
    idKey: 'broadcasterId',
    async getTotal() {
      const at = await auth.refreshAccessToken(refreshTokens.twitch, (t) => persistToken('twitch', t))
      return auth.getSubscriberCount(at, cfg.broadcasterId)
    },
  },
  youtube: {
    auth: youtubeAuth,
    idKey: 'youtubeChannelId',
    async getTotal() {
      const at = await youtubeAuth.refreshAccessToken(refreshTokens.youtube, (t) =>
        persistToken('youtube', t)
      )
      return youtubeAuth.getMemberCount(at)
    },
  },
  kick: {
    auth: kickAuth,
    idKey: 'kickBroadcasterId',
    async getTotal() {
      const at = await kickAuth.refreshAccessToken(refreshTokens.kick, (t) => persistToken('kick', t))
      return kickAuth.getSubscriberCount(at, cfg.kickBroadcasterId)
    },
  },
}

const PLATFORM_LABEL = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' }

const IDENTITY_KEYS = {
  twitch: ['broadcasterId', 'broadcasterName', 'broadcasterAvatar'],
  youtube: ['youtubeChannelId', 'youtubeChannelName', 'youtubeAvatar'],
  kick: ['kickBroadcasterId', 'kickChannelName', 'kickAvatar'],
}

function isConnected(p) {
  return !!refreshTokens[p] && !!cfg[providers[p].idKey]
}
function platformName(p) {
  return cfg[IDENTITY_KEYS[p][1]] || ''
}
function platformAvatar(p) {
  return cfg[IDENTITY_KEYS[p][2]] || ''
}
function verifyUriFallback(p) {
  return p === 'youtube' ? 'https://www.google.com/device' : 'https://www.twitch.tv/activate'
}

app.on('window-all-closed', () => {
  // tray app: closing the window hides it to the tray, so this normally
  // won't fire; if it does, keep running so the tray icon stays alive.
})
app.on('second-instance', () => windows.showWindow())
app.on('before-quit', () => {
  app.isQuitting = true
  stopAllDrivers()
  obs.close()
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null) // remove default File/Edit/View/Window menu bar

  cfg = config.load()
  for (const p of PLATFORMS) refreshTokens[p] = config.loadToken(p)
  obsPassword = config.loadObsPassword() || ''
  seedSources()
  sessStartGoal = cfg.startGoal
  sessIncrement = cfg.increment
  goal = computeGoal(0, sessStartGoal, sessIncrement)

  windows.createWindow({ preloadPath: path.join(__dirname, '../preload/index.js') })

  try {
    windows.createSplash()
  } catch {}

  if (cfg.onboarded) {
    await windows.showApp()
    if (cfg.startMinimized) windows.getWindow()?.hide()
  } else {
    await windows.showOnboarding()
  }

  try {
    createTray({
      getStatus: () => ({ tracking, count, goal }),
      onToggleTracking: () => (tracking ? stopTracking() : startTracking()),
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

  // Populate the Total Subs card once at startup (best-effort, on demand).
  if (cfg.onboarded) refreshTotals()

  if (cfg.onboarded && cfg.autostartTracking && PLATFORMS.some((p) => participates(sources[p]))) {
    startTracking()
  }
})

function send(channel, payload) {
  const w = windows.getWindow()
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
}

// Every OBS client goes through here so its connection status reaches the
// renderer. Handlers re-instantiate the client with fresh creds, so wiring the
// listener at construction keeps the obsOnline signal live with no heartbeat —
// it just reflects the connections the app already makes.
function makeObs() {
  const c = new OBSClient()
  c.on('status', setObsOnline)
  return c
}
function setObsOnline(on) {
  if (on === obsOnline) return
  obsOnline = on
  send('obs-status', { online: obsOnline })
  // OBS just came back — push the current count so the source catches up to
  // whatever the counter moved to while OBS was offline.
  if (on && cfg.useObsWebsocket && cfg.obsSource) pushOutput()
}

// Persistent, non-retryable per-platform warnings (e.g. a YouTube channel that
// isn't a Partner, so member count is unavailable). Surfaced in Settings rather
// than as a transient red toast on the main screen. Cleared on logout / disable
// or once the platform reports a total successfully again.
const platformWarnings = { twitch: null, youtube: null, kick: null }
function setPlatformWarning(p, message) {
  if (platformWarnings[p] === message) return
  platformWarnings[p] = message || null
  send('platform-warnings', { ...platformWarnings })
}
function clearPlatformWarning(p) {
  setPlatformWarning(p, null)
}

// All-time subscriber/member totals per platform, fetched ON DEMAND only (no
// background timer). Kept separate from the session-count bookkeeping in
// `sources` so the Total Subs card always shows the real platform total,
// independent of tracking/synced state.
const allTimeTotals = { twitch: null, youtube: null, kick: null }
let totalsBusy = false

function totalsSnapshot() {
  const per = {}
  let sum = 0
  let hasAny = false
  for (const p of PLATFORMS) {
    const included = sources[p].enabled && isConnected(p)
    const v = included && typeof allTimeTotals[p] === 'number' ? allTimeTotals[p] : null
    per[p] = v
    if (v != null) {
      sum += v
      hasAny = true
    }
  }
  return { per, sum, hasAny }
}

// Best-effort refresh for enabled+connected platforms, then notify the renderer.
// A single failure keeps the last-known value rather than blanking the card.
async function refreshTotals() {
  if (totalsBusy) return
  totalsBusy = true
  try {
    for (const p of PLATFORMS) {
      if (sources[p].enabled && isConnected(p)) {
        try {
          allTimeTotals[p] = Math.max(0, Number(await providers[p].getTotal()) || 0)
          clearPlatformWarning(p)
        } catch (e) {
          // best-effort — never throw out of here. A non-retryable failure
          // (e.g. YouTube memberships unavailable) is surfaced as a persistent
          // Settings warning rather than blanking the card.
          if (e && e.fatal) setPlatformWarning(p, e.message)
        }
      } else {
        allTimeTotals[p] = null
      }
    }
    send('totals-changed', totalsSnapshot())
  } finally {
    totalsBusy = false
  }
}

// Seed the runtime source map from persisted config: which platforms the user
// wants included, and which currently have a linked account.
function seedSources() {
  sources.twitch.enabled = !!cfg.twitchEnabled
  sources.youtube.enabled = !!cfg.youtubeEnabled
  sources.kick.enabled = !!cfg.kickEnabled
  for (const p of PLATFORMS) sources[p].connected = isConnected(p)
}

function persistToken(platform, token) {
  refreshTokens[platform] = token
  const secure = config.saveToken(platform, token)
  sources[platform].connected = isConnected(platform)
  if (!secure && !cfg.insecureTokenFallback) {
    cfg.insecureTokenFallback = true
    config.save(cfg)
    send('warning', 'Heads up: this PC can’t encrypt your login, so it’s saved as plain text on your computer.')
  }
}

function recomputeCount() {
  count = combinedCount(sources, synced, manualOffset)
}

// Subs gained this session, independent of the active mode — so the "Current
// Session" card shows its own figure even when "Total Subs" is the active source.
function sessionCount() {
  return combinedCount(sources, false, manualOffset)
}

function platformsSnapshot() {
  return PLATFORMS.map((p) => ({
    id: p,
    enabled: sources[p].enabled,
    connected: isConnected(p),
    name: platformName(p),
    avatar: platformAvatar(p),
    total: sources[p].total,
    contribution: contribution(sources[p], synced),
    live: sources[p].live,
  }))
}

// ---- output: file + obs ----
async function pushOutput() {
  if (manualGoal && count < goal) {
    // keep the manually set goal
  } else {
    manualGoal = false
    goal = synced
      ? computeGoal(count, sessIncrement, sessIncrement)
      : computeGoal(count, sessStartGoal, sessIncrement)
  }
  const text = `${count}/${goal}`
  send('count-changed', { count, goal, synced, session: sessionCount(), platforms: platformsSnapshot() })
  updateTray({ tracking, count, goal })

  if (cfg.writeToFile && cfg.outputFile) {
    try {
      fs.writeFileSync(cfg.outputFile, text, 'utf8')
    } catch (e) {
      send('status', 'Couldn’t write the goal to your text file. Check the file path in Settings.')
    }
  }
  if (cfg.useObsWebsocket && cfg.obsSource) {
    try {
      if (!obs.connected)
        await obs.connect({ host: cfg.obsHost, port: cfg.obsPort, password: obsPassword })
      await obs.setText(cfg.obsSource, text)
    } catch {
      // OBS being offline is not an error the user needs a toast for — the
      // status pill already shows "OBS Offline". We push the current value again
      // automatically when OBS reconnects (see setObsOnline), so it catches up.
    }
  }
}

// ---- tracking ----
function startTracking() {
  const active = PLATFORMS.filter((p) => participates(sources[p]))
  if (!active.length) {
    send('need-login')
    return
  }
  tracking = true
  manualOffset = 0

  for (const p of active) {
    if (sources[p].live) {
      // Twitch: session mode counts new subs from 0; synced mode fetches the
      // real total below and lets live subs add on top.
      sources[p].total = 0
      sources[p].sessionBase = 0
    } else {
      // Polled: the poller's first tick establishes the session baseline.
      sources[p].sessionBase = null
    }
  }

  recomputeCount()
  pushOutput()

  if (participates(sources.twitch)) {
    startTwitchTracker()
    if (synced) fetchTwitchTotal()
  }
  for (const p of ['youtube', 'kick']) {
    if (participates(sources[p])) startPoller(p)
  }

  updateTray({ tracking, count, goal })
  send('tracking-changed', true)
}

function startTwitchTracker() {
  twitchTracker = new SubTracker({
    broadcasterId: cfg.broadcasterId,
    refreshToken: refreshTokens.twitch,
    onNewRefreshToken: (t) => persistToken('twitch', t),
  })
  twitchTracker.on('subs', (n) => {
    sources.twitch.total = Math.max(0, (sources.twitch.total || 0) + n)
    recomputeCount()
    pushOutput()
  })
  twitchTracker.on('error', (m) => send('status', m))
  twitchTracker.on('auth-expired', (m) => handleAuthExpired('twitch', m))
  twitchTracker.on('stopped', () => {})
  twitchTracker.start()
}

// One-shot Twitch total fetch (synced mode) — live subs accumulate on top.
async function fetchTwitchTotal() {
  try {
    const total = await providers.twitch.getTotal()
    sources.twitch.total = Math.max(0, Number(total) || 0)
    recomputeCount()
    pushOutput()
  } catch (e) {
    if (e && e.name === 'AuthExpired') handleAuthExpired('twitch', e.message)
  }
}

function startPoller(p) {
  const poller = new Poller({
    fetchTotal: () => providers[p].getTotal(),
    intervalMs: (Number(cfg.pollIntervalSec) || 60) * 1000,
  })
  poller.on('total', (t) => {
    const total = Math.max(0, Number(t) || 0)
    const s = sources[p]
    if (!synced && s.sessionBase == null) s.sessionBase = total // first tick baselines
    s.total = total
    recomputeCount()
    pushOutput()
  })
  poller.on('error', (m) => send('status', m))
  poller.on('neterror', () =>
    send('status', `Couldn’t reach ${PLATFORM_LABEL[p]}. Check your internet connection and try again.`)
  )
  // A non-retryable failure (e.g. the channel can't use the memberships API):
  // stop this source and surface the reason once, rather than retrying forever.
  poller.on('fatal', (m) => {
    stopSourceDriver(p)
    setPlatformWarning(p, m)
  })
  poller.on('auth-expired', (m) => handleAuthExpired(p, m))
  poller.start()
  pollers[p] = poller
}

function stopSourceDriver(p) {
  if (p === 'twitch' && twitchTracker) {
    twitchTracker.stop()
    twitchTracker = null
  }
  if (pollers[p]) {
    pollers[p].stop()
    pollers[p] = null
  }
}

function stopAllDrivers() {
  for (const p of PLATFORMS) stopSourceDriver(p)
}

function anyDriverActive() {
  return !!twitchTracker || !!pollers.youtube || !!pollers.kick
}

function stopTracking() {
  tracking = false
  stopAllDrivers()
  updateTray({ tracking: false, count, goal })
  send('tracking-changed', false)
}

// One platform's auth failing stops only that source; the others keep tracking.
function handleAuthExpired(platform, msg) {
  stopSourceDriver(platform)
  sources[platform].connected = false
  recomputeCount()
  pushOutput()
  send('auth-expired', { platform, message: msg })
  if (tracking && !anyDriverActive()) {
    tracking = false
    updateTray({ tracking: false, count, goal })
    send('tracking-changed', false)
  }
}

function resetCount() {
  manualOffset = 0
  for (const p of PLATFORMS) {
    if (sources[p].live) sources[p].sessionBase = sources[p].total
    else sources[p].sessionBase = null // re-baseline on the next poll
  }
  manualGoal = false
  recomputeCount()
  pushOutput()
}

// Right +/- on the counter: set the goal directly, never at/below the count.
function adjustGoal(n) {
  goal = Math.max(count + 1, goal + n)
  manualGoal = true
  pushOutput()
}

// ===================== IPC =====================

ipcMain.handle('get-state', () => ({
  cfg,
  // Legacy Twitch-centric fields, still read by existing Settings/Main code.
  connected: isConnected('twitch'),
  broadcasterName: cfg.broadcasterName,
  broadcasterAvatar: cfg.broadcasterAvatar,
  tracking,
  synced,
  count,
  session: sessionCount(),
  goal,
  startGoal: sessStartGoal,
  increment: sessIncrement,
  obsPassword,
  obsOnline,
  // Multi-source snapshot.
  platforms: platformsSnapshot(),
  // All-time subscriber totals (Total Subs card) — refreshed on demand.
  totals: totalsSnapshot(),
  // Persistent per-platform warnings (shown in Settings, not as a toast).
  warnings: { ...platformWarnings },
}))

ipcMain.handle('save-settings', (_e, patch) => {
  Object.assign(cfg, patch)
  config.save(cfg)
  return cfg
})

ipcMain.handle('set-session-goal', (_e, { startGoal, increment } = {}) => {
  if (startGoal != null) sessStartGoal = Math.max(1, Number(startGoal) || 1)
  if (increment != null) sessIncrement = Math.max(1, Number(increment) || 1)
  manualGoal = false
  pushOutput()
  return { startGoal: sessStartGoal, increment: sessIncrement, count, goal }
})

ipcMain.handle('reset-defaults', () => {
  cfg.startGoal = config.DEFAULTS.startGoal
  cfg.increment = config.DEFAULTS.increment
  config.save(cfg)
  return cfg
})

// On-demand all-time totals refresh (Total Subs card). Called by the renderer on
// mount and on window focus — no background polling.
ipcMain.handle('refresh-totals', () => refreshTotals())

ipcMain.handle('set-obs-password', (_e, pw) => {
  obsPassword = pw || ''
  obs = makeObs() // force fresh connect with new creds
  return true
})

// --- platform enable/disable (include in the combined goal) ---
ipcMain.handle('set-platform-enabled', (_e, { platform, on } = {}) => {
  if (!PLATFORMS.includes(platform)) return { error: 'Unknown platform' }
  sources[platform].enabled = !!on
  cfg[`${platform}Enabled`] = !!on
  config.save(cfg)
  if (tracking) {
    if (on && participates(sources[platform])) {
      if (platform === 'twitch') {
        if (!twitchTracker) startTwitchTracker()
      } else if (!pollers[platform]) {
        sources[platform].sessionBase = null
        startPoller(platform)
      }
    } else if (!on) {
      stopSourceDriver(platform)
    }
  }
  if (!on) clearPlatformWarning(platform)
  recomputeCount()
  pushOutput()
  // "Add in total" gates which platforms count toward the Total Subs card;
  // refresh so a newly-included platform fetches its total on demand.
  refreshTotals()
  return { platform, enabled: sources[platform].enabled }
})

// --- login (device code for twitch; browser loopback for youtube + kick) ---
ipcMain.handle('login-start', async (_e, platform) => {
  if (!PLATFORMS.includes(platform)) return { error: 'Unknown platform' }
  return platform === 'twitch' ? startDeviceLogin('twitch') : startLoopbackLogin(platform)
})

ipcMain.handle('login-cancel', (_e, platform) => {
  if (PLATFORMS.includes(platform)) loginCancel[platform] = true
})

ipcMain.handle('logout', (_e, platform) => {
  if (!PLATFORMS.includes(platform)) return false
  return logoutPlatform(platform)
})

async function saveIdentity(platform, accessToken) {
  let ident
  if (platform === 'twitch') ident = await auth.getCurrentUser(accessToken)
  else if (platform === 'youtube') ident = await youtubeAuth.getCurrentChannel(accessToken)
  else ident = await kickAuth.getCurrentChannel(accessToken)
  const [idK, nameK, avaK] = IDENTITY_KEYS[platform]
  cfg[idK] = ident.id
  cfg[nameK] = ident.name
  cfg[avaK] = ident.avatar || ''
  config.save(cfg)
  sources[platform].connected = isConnected(platform)
}

async function startDeviceLogin(platform) {
  const prov = providers[platform].auth
  loginCancel[platform] = false
  try {
    const dc = await prov.startDeviceFlow()
    ;(async () => {
      try {
        const { accessToken, refreshToken: rt } = await prov.pollForToken(
          dc.device_code,
          dc.interval,
          dc.expires_in,
          () => loginCancel[platform]
        )
        persistToken(platform, rt)
        await saveIdentity(platform, accessToken)
        send('login-ok', { platform, name: platformName(platform), avatar: platformAvatar(platform) })
        refreshTotals()
      } catch (e) {
        send('login-failed', { platform, message: e.message })
      }
    })()
    return {
      platform,
      userCode: dc.user_code,
      verificationUri: dc.verification_uri || dc.verification_url || verifyUriFallback(platform),
    }
  } catch (e) {
    return { platform, error: e.message }
  }
}

// YouTube + Kick: OAuth via a loopback redirect. The provider opens the system
// browser itself and resolves once the redirect lands, so there's no code to
// show in-app.
function startLoopbackLogin(platform) {
  loginCancel[platform] = false
  ;(async () => {
    try {
      const { accessToken, refreshToken: rt } = await providers[platform].auth.login({
        openUrl: (u) => shell.openExternal(u),
      })
      persistToken(platform, rt)
      await saveIdentity(platform, accessToken)
      send('login-ok', { platform, name: platformName(platform), avatar: platformAvatar(platform) })
      refreshTotals()
    } catch (e) {
      send('login-failed', { platform, message: e.message })
    }
  })()
  return { platform, browser: true }
}

function logoutPlatform(platform) {
  stopSourceDriver(platform)
  config.clearToken(platform)
  refreshTokens[platform] = null
  for (const k of IDENTITY_KEYS[platform]) cfg[k] = ''
  config.save(cfg)
  sources[platform].connected = false
  allTimeTotals[platform] = null
  clearPlatformWarning(platform)
  recomputeCount()
  pushOutput()
  send('totals-changed', totalsSnapshot())
  if (tracking && !anyDriverActive()) {
    tracking = false
    updateTray({ tracking: false, count, goal })
    send('tracking-changed', false)
  }
  return true
}

// --- OBS ---
ipcMain.handle('obs-auto-detect', async () => {
  obs = makeObs()
  const ok = await obs.tryAutoDetect()
  return ok
})

ipcMain.handle('obs-connect', async (_e, { host, port, password }) => {
  obs = makeObs()
  obsPassword = password || ''
  try {
    await obs.connect({ host, port, password })
    cfg.obsHost = host
    cfg.obsPort = port
    config.save(cfg)
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

ipcMain.handle('obs-select-source', (_e, name) => {
  cfg.obsSource = name || ''
  config.save(cfg)
  return { ok: true, name: cfg.obsSource }
})

ipcMain.handle('obs-test-source', async (_e, name) => {
  try {
    await obs.setText(name || cfg.obsSource, `${count}/${goal}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Lightweight status probe for the Home health pill. Reuses the live client
// (connect() no-ops if already connected), persists nothing, and lets the client
// emit obs-status. Called by the renderer on window open/focus — not on a timer.
ipcMain.handle('obs-ping', async () => {
  if (!cfg.useObsWebsocket || !cfg.obsSource) return { online: false }
  try {
    await obs.connect({ host: cfg.obsHost, port: cfg.obsPort, password: obsPassword })
    return { online: true }
  } catch {
    return { online: false }
  }
})

// --- tracking controls ---
ipcMain.handle('start-tracking', () => startTracking())
ipcMain.handle('stop-tracking', () => stopTracking())
ipcMain.handle('reset-count', () => resetCount())
ipcMain.handle('adjust-count', (_e, n) => {
  manualOffset += n
  const srcSum = combinedCount(sources, synced, 0)
  if (srcSum + manualOffset < 0) manualOffset = -srcSum // never drive below 0
  recomputeCount()
  pushOutput()
})
ipcMain.handle('adjust-goal', (_e, n) => adjustGoal(n))

// --- sync counter to current totals across all connected platforms ---
ipcMain.handle('sync-sub-count', async (_e, on) => {
  if (!on) {
    synced = false
    manualOffset = 0
    for (const p of PLATFORMS) {
      if (sources[p].live) {
        sources[p].sessionBase = tracking ? sources[p].total : 0
        if (!tracking) sources[p].total = 0
      } else {
        sources[p].sessionBase = null
      }
    }
    recomputeCount()
    pushOutput()
    return { ok: true, synced: false, count, goal }
  }
  const active = PLATFORMS.filter((p) => participates(sources[p]))
  if (!active.length) return { ok: false, error: 'Connect a platform first.' }
  // Fetch each platform independently: one platform failing (e.g. a YouTube
  // channel with memberships unavailable) must not abort the whole sync. A
  // non-retryable failure becomes a persistent Settings warning; that platform
  // simply contributes 0 to the synced total.
  manualOffset = 0
  for (const p of active) {
    try {
      const total = await providers[p].getTotal()
      sources[p].total = Math.max(0, Number(total) || 0)
      clearPlatformWarning(p)
    } catch (e) {
      sources[p].total = 0
      if (e && e.fatal) setPlatformWarning(p, e.message)
    }
  }
  synced = true
  recomputeCount()
  pushOutput()
  return { ok: true, synced: true, count, goal }
})

// --- test sub (onboarding + testing) ---
ipcMain.handle('fire-test-sub', () => {
  manualOffset += 1
  recomputeCount()
  pushOutput()
})

ipcMain.handle('reset-all-data', () => {
  stopTracking()
  try {
    obs.close()
  } catch {}
  for (const p of PLATFORMS) config.clearToken(p)
  config.clearObsPassword()
  cfg = { ...config.DEFAULTS }
  config.save(cfg)
  for (const p of PLATFORMS) refreshTokens[p] = null
  for (const p of PLATFORMS) allTimeTotals[p] = null
  obsPassword = ''
  obs = makeObs()
  count = 0
  synced = false
  manualGoal = false
  manualOffset = 0
  Object.assign(sources, makeSources())
  seedSources()
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
