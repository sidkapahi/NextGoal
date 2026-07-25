// Diagnostic: run the YouTube (Google) Desktop-app OAuth flow once — Authorization
// Code + PKCE via a loopback redirect (same as the app) — and print what the
// channel + members endpoints return, so we can confirm members.list actually
// yields a count before relying on it. Standalone, no Electron. Node 18+.
//
//   YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... node scripts/youtube-probe.mjs
//
// It prints an authorize URL; open it, approve, and the script does the rest.
// Google always allows loopback redirects for Desktop-app clients, so no
// redirect registration is needed. Override the port with YT_REDIRECT_PORT.
import http from 'node:http'
import crypto from 'node:crypto'

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET
const PORT = Number(process.env.YT_REDIRECT_PORT || 8578)
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in your environment.')
  process.exit(1)
}

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const verifier = b64url(crypto.randomBytes(32))
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
const state = b64url(crypto.randomBytes(16))
const redirectUri = `http://localhost:${PORT}/callback`
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.channel-memberships.creator',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ')

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

console.log('\n1) Open this URL in your browser and approve NextGoal:\n')
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
const tokRes = await fetch('https://oauth2.googleapis.com/token', {
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
console.log('   got an access token.', tok.refresh_token ? '(refresh token received)' : '(NO refresh token!)')

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
}

await probe('channels (identity)', 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true')
// The one that might hit Google's access gate — a 403 "not enabled" here means
// the account needs membership-API access (or memberships aren't enabled).
await probe('members (page 1)', 'https://www.googleapis.com/youtube/v3/members?part=snippet&maxResults=1000')

console.log('\nDone. Paste the status codes + bodies above back to Claude.')
process.exit(0)
