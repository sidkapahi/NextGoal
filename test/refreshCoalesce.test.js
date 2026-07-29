// Concurrency guard for single-use refresh tokens. refreshCoalesce.js is
// Electron-free, so this runs as a plain Node script like the other suites.
const { makeCoalescer } = require('../src/main/services/refreshCoalesce.js')

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

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function run() {
  // 1) Concurrent refreshes of the SAME token share one underlying refresh, and
  //    every caller's onNewRefreshToken is notified of the rotated token.
  {
    let calls = 0
    const refresh = makeCoalescer(async (token, notify) => {
      calls++
      await delay(20)
      notify('rotated-' + token) // single-use token rotates
      return 'access-for-' + token
    })

    const gotA = []
    const gotB = []
    const [a, b] = await Promise.all([
      refresh('T1', (t) => gotA.push(t)),
      refresh('T1', (t) => gotB.push(t)),
    ])
    eq('concurrent: underlying refresh called once', calls, 1)
    eq('concurrent: caller A access token', a, 'access-for-T1')
    eq('concurrent: caller B shares same token', b, 'access-for-T1')
    eq('concurrent: caller A notified of rotation', gotA[0], 'rotated-T1')
    eq('concurrent: caller B notified of rotation', gotB[0], 'rotated-T1')
  }

  // 2) After a refresh settles, the in-flight entry is cleared so a later
  //    refresh with a new token runs a fresh request.
  {
    let calls = 0
    const refresh = makeCoalescer(async (token) => {
      calls++
      await delay(5)
      return 'access-' + token
    })
    await refresh('A', () => {})
    await refresh('B', () => {})
    eq('sequential: distinct refreshes each run', calls, 2)
  }

  // 3) A failed refresh rejects all concurrent callers AND clears the entry, so
  //    a subsequent retry with the same token is allowed to try again.
  {
    let calls = 0
    const refresh = makeCoalescer(async () => {
      calls++
      await delay(5)
      throw new Error('boom')
    })
    let rejA = false
    let rejB = false
    await Promise.all([
      refresh('X', () => {}).catch(() => (rejA = true)),
      refresh('X', () => {}).catch(() => (rejB = true)),
    ])
    eq('failure: both concurrent callers reject', rejA && rejB, true)
    eq('failure: shared a single attempt', calls, 1)
    let rejC = false
    await refresh('X', () => {}).catch(() => (rejC = true))
    eq('failure: entry cleared, retry runs again', calls, 2)
    eq('failure: retry also rejected', rejC, true)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

run()
