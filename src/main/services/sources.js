'use strict'

// Multi-source combine logic, kept free of Electron/Node-only APIs so it can be
// unit-tested headlessly (see test/sources.test.js).
//
// A "source" is one platform we count from. Each has:
//   enabled     — the user wants this platform included in the goal
//   connected   — an account is linked (token + identity on file)
//   total       — the platform's current sub/member total (live for Twitch,
//                 polled for YouTube/Kick)
//   sessionBase — the total captured at session start; session progress is
//                 (total - sessionBase). `null` means "not yet baselined this
//                 session", which contributes 0 until the first observation.
// A source only contributes to the combined count when it is BOTH enabled and
// connected.

const PLATFORMS = ['twitch', 'youtube', 'kick']

// Twitch is the only source with a real-time push (EventSub); YouTube and Kick
// are polled.
const LIVE_PLATFORMS = ['twitch']

function makeSources() {
  const s = {}
  for (const p of PLATFORMS) {
    s[p] = {
      enabled: p === 'twitch', // reseeded from config at load; Twitch on by default
      connected: false,
      total: 0,
      sessionBase: 0,
      live: LIVE_PLATFORMS.includes(p),
    }
  }
  return s
}

function participates(src) {
  return !!(src && src.enabled && src.connected)
}

// The combined counter across participating sources.
//   synced = true  -> sum of current totals (the "Sync total sub count" mode)
//   synced = false -> sum of subs gained since each source's session baseline
// `manualOffset` folds in the user's +/- nudges and test subs. The result is
// never negative. A session source whose baseline is still null contributes 0.
function combinedCount(sources, synced, manualOffset = 0) {
  let n = Number(manualOffset) || 0
  for (const p of PLATFORMS) {
    const s = sources[p]
    if (!participates(s)) continue
    const total = Number(s.total) || 0
    if (synced) {
      n += total
    } else {
      if (s.sessionBase == null) continue
      n += Math.max(0, total - (Number(s.sessionBase) || 0))
    }
  }
  return Math.max(0, n)
}

// A single source's contribution to the combined count — used for the per-
// platform breakdown shown on the main screen.
function contribution(src, synced) {
  if (!participates(src)) return 0
  const total = Number(src.total) || 0
  if (synced) return total
  if (src.sessionBase == null) return 0
  return Math.max(0, total - (Number(src.sessionBase) || 0))
}

module.exports = { PLATFORMS, LIVE_PLATFORMS, makeSources, participates, combinedCount, contribution }
