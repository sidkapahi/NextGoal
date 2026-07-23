// Diagnostic: run the YouTube (Google) device-code OAuth flow once and print
// what the channel + members endpoints return, so we can confirm members.list
// actually yields a count before wiring it into the app. Standalone, no
// Electron. Requires Node 18+ (global fetch).
//
//   YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... node scripts/youtube-probe.mjs
//
// It prints a URL + short code; open the URL, enter the code, approve, and the
// script polls for the token and probes the APIs.
const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in your environment.')
  process.exit(1)
}

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.channel-memberships.creator',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('\n1) Requesting a device code…')
const dcRes = await fetch('https://oauth2.googleapis.com/device/code', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES }),
})
const dc = await dcRes.json()
if (!dc.device_code) {
  console.log('   device code request failed:', dcRes.status, JSON.stringify(dc, null, 2))
  process.exit(1)
}
console.log(`\n2) Open ${dc.verification_url}  and enter code:  ${dc.user_code}\n`)
console.log('   (waiting for you to approve…)')

let at = ''
const deadline = Date.now() + (dc.expires_in || 1800) * 1000
let wait = Math.max(5, dc.interval || 5)
while (Date.now() < deadline) {
  await sleep(wait * 1000)
  const tRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      device_code: dc.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  const t = await tRes.json()
  if (t.access_token) {
    at = t.access_token
    break
  }
  if (t.error === 'authorization_pending') continue
  if (t.error === 'slow_down') {
    wait += 2
    continue
  }
  console.log('   token error:', JSON.stringify(t, null, 2))
  process.exit(1)
}
if (!at) {
  console.log('   timed out waiting for approval.')
  process.exit(1)
}
console.log('   got an access token.')

async function probe(label, url) {
  let status, body
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } })
    status = r.status
    body = await r.text()
  } catch (e) {
    status = 'ERR'
    body = String(e)
  }
  console.log(`\n=== ${label} ===`)
  console.log(`${status}  ${url}`)
  console.log(body.slice(0, 2000))
  return body
}

// Identity — the channel this token belongs to.
await probe('channels (identity)', 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true')

// The one that might hit the allowlist. A single page tells us if it works;
// if it 403s with "not enabled", that's the access-request gate.
await probe('members (page 1)', 'https://www.googleapis.com/youtube/v3/members?part=snippet&maxResults=1000')

console.log('\nDone. Paste the status codes + bodies above back to Claude.')
process.exit(0)
