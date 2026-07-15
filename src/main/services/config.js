'use strict'

const { app, safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')

const DEFAULTS = {
  broadcasterId: '',
  broadcasterName: '',
  startGoal: 5,
  increment: 5,
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
function tokenPath() {
  return path.join(userDir(), 'token.enc')
}
function legacyTokenPath() {
  return path.join(userDir(), 'token.plain')
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

// ---- refresh token, encrypted at rest ----

// Returns true if stored encrypted, false if we fell back to plaintext.
function saveToken(token) {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const enc = safeStorage.encryptString(token)
      fs.writeFileSync(tokenPath(), enc)
      try {
        fs.unlinkSync(legacyTokenPath())
      } catch {}
      return true
    } catch {}
  }
  try {
    fs.writeFileSync(legacyTokenPath(), token, { mode: 0o600 })
  } catch {}
  return false
}

function loadToken() {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const buf = fs.readFileSync(tokenPath())
      return safeStorage.decryptString(buf) || null
    } catch {}
  }
  try {
    return fs.readFileSync(legacyTokenPath(), 'utf8').trim() || null
  } catch {
    return null
  }
}

function clearToken() {
  for (const p of [tokenPath(), legacyTokenPath()]) {
    try {
      fs.unlinkSync(p)
    } catch {}
  }
}

module.exports = { DEFAULTS, load, save, saveToken, loadToken, clearToken }
