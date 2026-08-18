'use strict'

const { app, safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')

const DEFAULTS = {
  // Twitch identity (kept under the original key names for back-compat with
  // existing installs).
  broadcasterId: '',
  broadcasterName: '',
  broadcasterAvatar: '',
  // YouTube identity
  youtubeChannelId: '',
  youtubeChannelName: '',
  youtubeAvatar: '',
  // Kick identity
  kickBroadcasterId: '',
  kickChannelName: '',
  kickAvatar: '',
  // Per-platform "include in the combined goal" toggles. A platform only counts
  // when it is both enabled AND connected (has a token + identity on file).
  twitchEnabled: true,
  youtubeEnabled: true,
  kickEnabled: true,
  // How often the polled sources (YouTube, Kick) refresh their totals.
  pollIntervalSec: 60,
  startGoal: 5,
  increment: 5,
  // Optional label prefixed to the OBS/text output, e.g. "DAILY SUB GOAL" ->
  // "DAILY SUB GOAL 0/5". Empty by default (output is just "0/5").
  goalLabel: '',
  // What the counter tracks: 'subs' (Twitch/Kick subs + YouTube members) or
  // 'followers' (Twitch/Kick followers; YouTube is excluded in this mode).
  trackingMode: 'subs',
  writeToFile: false,
  outputFile: '',
  useObsWebsocket: true,
  obsHost: 'localhost',
  obsPort: 4455,
  obsSource: '',
  startMinimized: false,
  autostartTracking: false,
  checkForUpdates: true,
  onboarded: false,
  insecureTokenFallback: false,
}

function userDir() {
  return app.getPath('userData')
}
function settingsPath() {
  return path.join(userDir(), 'settings.json')
}
// Per-platform refresh-token files. Twitch keeps its original filenames so
// existing installs keep their login; new platforms get a prefixed pair.
function tokenPaths(platform = 'twitch') {
  const base = platform === 'twitch' ? 'token' : `${platform}-token`
  return {
    enc: path.join(userDir(), `${base}.enc`),
    plain: path.join(userDir(), `${base}.plain`),
  }
}

function load() {
  const cfg = { ...DEFAULTS }
  if (!cfg.outputFile) cfg.outputFile = path.join(userDir(), 'sub-goal.txt')
  try {
    const stored = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
    for (const k of Object.keys(DEFAULTS)) {
      if (k in stored) cfg[k] = stored[k]
    }
  } catch {}
  return cfg
}

function save(cfg) {
  const safe = {}
  for (const k of Object.keys(DEFAULTS)) safe[k] = cfg[k]
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(safe, null, 2))
  } catch {}
}

// ---- refresh tokens, encrypted at rest (one file per platform) ----

// Returns true if stored encrypted, false if we fell back to plaintext.
function saveToken(platform, token) {
  const { enc, plain } = tokenPaths(platform)
  if (safeStorage.isEncryptionAvailable()) {
    try {
      fs.writeFileSync(enc, safeStorage.encryptString(token))
      try {
        fs.unlinkSync(plain)
      } catch {}
      return true
    } catch {}
  }
  try {
    fs.writeFileSync(plain, token, { mode: 0o600 })
  } catch {}
  return false
}

function loadToken(platform) {
  const { enc, plain } = tokenPaths(platform)
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(fs.readFileSync(enc)) || null
    } catch {}
  }
  try {
    return fs.readFileSync(plain, 'utf8').trim() || null
  } catch {
    return null
  }
}

function clearToken(platform) {
  const { enc, plain } = tokenPaths(platform)
  for (const p of [enc, plain]) {
    try {
      fs.unlinkSync(p)
    } catch {}
  }
}

// ---- OBS WebSocket password, encrypted at rest ----
// Stored in a dedicated file (not settings.json) and encrypted with the OS
// keychain when available, mirroring the refresh-token handling.

function obsPwPath() {
  return path.join(userDir(), 'obs-pw.enc')
}
function legacyObsPwPath() {
  return path.join(userDir(), 'obs-pw.plain')
}

function saveObsPassword(pw) {
  // An empty password means "no password" — clear any stored value.
  if (!pw) {
    clearObsPassword()
    return true
  }
  if (safeStorage.isEncryptionAvailable()) {
    try {
      fs.writeFileSync(obsPwPath(), safeStorage.encryptString(pw))
      try {
        fs.unlinkSync(legacyObsPwPath())
      } catch {}
      return true
    } catch {}
  }
  try {
    fs.writeFileSync(legacyObsPwPath(), pw, { mode: 0o600 })
  } catch {}
  return false
}

function loadObsPassword() {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(fs.readFileSync(obsPwPath())) || ''
    } catch {}
  }
  try {
    return fs.readFileSync(legacyObsPwPath(), 'utf8') || ''
  } catch {
    return ''
  }
}

function clearObsPassword() {
  for (const p of [obsPwPath(), legacyObsPwPath()]) {
    try {
      fs.unlinkSync(p)
    } catch {}
  }
}

module.exports = {
  DEFAULTS,
  load,
  save,
  saveToken,
  loadToken,
  clearToken,
  saveObsPassword,
  loadObsPassword,
  clearObsPassword,
}
