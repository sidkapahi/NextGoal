// Combine math for the multi-source counter. sources.js is Electron-free, so
// this runs as a plain Node script like the other suites.
const { makeSources, combinedCount, contribution } = require('../src/main/services/sources.js')

let pass = 0
let fail = 0
function eq(label, got, exp) {
  if (got === exp) {
    pass++
    console.log('ok  ', label, '->', got)
  } else {
    fail++
    console.log('FAIL', label, 'expected', exp, 'got', got)
  }
}

// Helper: build a fully participating source with given totals.
function src({ enabled = true, connected = true, total = 0, sessionBase = 0, live = false }) {
  return { enabled, connected, total, sessionBase, live }
}

// --- only Twitch, session mode (mirrors the original single-source behaviour) ---
{
  const s = makeSources()
  s.twitch = src({ total: 5, sessionBase: 0, live: true })
  s.youtube.connected = false
  s.kick.connected = false
  eq('twitch-only session', combinedCount(s, false), 5)
}

// --- three sources, session mode: sum of (total - base) ---
{
  const s = {
    twitch: src({ total: 12, sessionBase: 0, live: true }),
    youtube: src({ total: 30, sessionBase: 25 }),
    kick: src({ total: 8, sessionBase: 5 }),
  }
  eq('multi session', combinedCount(s, false), 12 + 5 + 3)
  eq('contribution youtube', contribution(s.youtube, false), 5)
}

// --- synced mode: sum of current totals, baselines ignored ---
{
  const s = {
    twitch: src({ total: 12, sessionBase: 0 }),
    youtube: src({ total: 30, sessionBase: 25 }),
    kick: src({ total: 8, sessionBase: 5 }),
  }
  eq('multi synced', combinedCount(s, true), 50)
  eq('contribution synced', contribution(s.youtube, true), 30)
}

// --- disabled / disconnected sources are excluded ---
{
  const s = {
    twitch: src({ total: 12, sessionBase: 0 }),
    youtube: src({ enabled: false, total: 30, sessionBase: 0 }),
    kick: src({ connected: false, total: 8, sessionBase: 0 }),
  }
  eq('excludes disabled+disconnected', combinedCount(s, false), 12)
}

// --- a null baseline (not yet polled this session) contributes 0 ---
{
  const s = {
    twitch: src({ total: 4, sessionBase: 0, live: true }),
    youtube: src({ total: 100, sessionBase: null }),
    kick: src({ connected: false }),
  }
  eq('null baseline contributes 0', combinedCount(s, false), 4)
  eq('contribution null baseline', contribution(s.youtube, false), 0)
}

// --- manual offset folds in and never drives the total below 0 ---
{
  const s = { twitch: src({ total: 3, sessionBase: 0, live: true }), youtube: src({ connected: false }), kick: src({ connected: false }) }
  eq('manual offset adds', combinedCount(s, false, 2), 5)
  eq('manual offset clamps at 0', combinedCount(s, false, -10), 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
