// Diagnostic: run the Kick OAuth flow once and print exactly what the channel
// and subscription endpoints return, so we can pin down how to count Kick subs.
// Standalone — no Electron. Requires Node 18+ (global fetch).
//
//   KICK_CLIENT_ID=... KICK_CLIENT_SECRET=... node scripts/kick-probe.mjs
//
// It prints an authorize URL; open it, approve, and the script does the rest.
// If Kick rejects the redirect_uri, register this exact URL on your Kick app
// (or override the port with KICK_REDIRECT_PORT):  http://localhost:8577/callback
import http from 'node:http'
import crypto from 'node:crypto'

const CLIENT_ID = process.env.KICK_CLIENT_ID
const CLIENT_SECRET = process.env.KICK_CLIENT_SECRET
const PORT = Number(process.env.KICK_REDIRECT_PORT || 8577)
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set KICK_CLIENT_ID and KICK_CLIENT_SECRET in your environment.')
  process.exit(1)
}

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const verifier = b64url(crypto.randomBytes(32))
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
const state = b64url(crypto.randomBytes(16))
const redirectUri = `http://localhost:${PORT}/callback`
const SCOPES = 'user:read channel:read events:subscribe'

const authUrl =
  'https://id.kick.com/oauth/authorize?' +
  new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })

console.log('\n1) Open this URL in your browser and authorize NextGoal:\n')
console.log(authUrl + '\n')

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost')
    if (u.pathname !== '/callback') {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<h2>Done — return to your terminal.</h2>')
    server.close()
    const err = u.searchParams.get('error')
    if (err) return reject(new Error('authorize error: ' + err))
    if (u.searchParams.get('state') !== state) return reject(new Error('state mismatch'))
    resolve(u.searchParams.get('code'))
  })
  server.listen(PORT, () => console.log(`(listening for the redirect on ${redirectUri})`))
})

console.log('\n2) Exchanging the code for an access token…')
const tokRes = await fetch('https://id.kick.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
  }),
})
const tok = await tokRes.json()
console.log('   token endpoint status:', tokRes.status)
if (!tok.access_token) {
  console.log('   token response:', JSON.stringify(tok, null, 2))
  process.exit(1)
}
const at = tok.access_token
console.log('   got an access token. scopes granted:', tok.scope || '(not reported)')

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

const BASE = 'https://api.kick.com/public/v1'

// 1) Identity — grab the broadcaster id to use for the subscription probes.
const channelsBody = await probe('channels (identity)', `${BASE}/channels`)
let bid = ''
try {
  const rows = JSON.parse(channelsBody).data || []
  bid = String(rows[0]?.broadcaster_user_id || rows[0]?.id || '')
} catch {}
console.log('\n(using broadcaster id:', bid || '<none found>', ')')

// 2) Candidate subscription endpoints — we'll see which (if any) return a count.
await probe('channels/subscriptions', `${BASE}/channels/subscriptions?broadcaster_user_id=${bid}&limit=100`)
await probe('subscriptions', `${BASE}/subscriptions?broadcaster_user_id=${bid}&limit=100`)

console.log('\nDone. Paste the status codes + bodies above back to Claude.')
process.exit(0)
