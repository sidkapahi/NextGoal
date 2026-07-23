'use strict'

// YouTube auth via Google's OAuth 2.0 for TV & Limited-Input Devices (the same
// device-code UX as Twitch: show a code, poll for the token). Mirrors the shape
// of twitchAuth.js so index.js can treat the providers uniformly.
//
// IMPORTANT: the membership APIs need the RESTRICTED scope
// `youtube.channel-memberships.creator`, which Google gates behind an allowlist
// (contact your YouTube representative) and OAuth-consent verification for a
// shipped app. The channel must be in the YouTube Partner Program with channel
// memberships enabled. There is no "member count" field — the count is obtained
// by paginating members.list and counting, so callers should poll infrequently.
//
// Unlike Twitch's public device flow, Google's device flow requires a client
// secret. For an installed/desktop app Google explicitly treats this secret as
// non-confidential (it ships in the binary); it is injected at build time next
// to the client ID.

const DEVICE_URL = 'https://oauth2.googleapis.com/device/code'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'
const MEMBERS_URL = 'https://www.googleapis.com/youtube/v3/members'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.channel-memberships.creator',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ')

// Public info for an installed app, injected at build time; env fallback in dev.
const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || '__YOUTUBE_CLIENT_ID__'
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || '__YOUTUBE_CLIENT_SECRET__'

class AuthError extends Error {
  constructor(m) {
    super(m)
    this.name = 'AuthError'
  }
}
class AuthExpired extends AuthError {
  constructor(m) {
    super(m)
    this.name = 'AuthExpired'
  }
}

function form(obj) {
  return new URLSearchParams(obj).toString()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function startDeviceFlow() {
  const res = await fetch(DEVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: CLIENT_ID, scope: SCOPES }),
  })
  if (!res.ok) throw new AuthError(`Couldn't start YouTube login (${res.status}).`)
  // { device_code, user_code, verification_url, interval, expires_in }
  return res.json()
}

async function pollForToken(deviceCode, interval, expiresIn, shouldCancel) {
  let wait = Math.max(1, Number(interval) || 5)
  const deadline = Date.now() + (Number(expiresIn) || 1800) * 1000

  while (Date.now() < deadline) {
    if (shouldCancel && shouldCancel()) throw new AuthError('Login cancelled.')
    await sleep(wait * 1000)

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        device_code: deviceCode,
        grant_type: DEVICE_GRANT,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      return { accessToken: data.access_token, refreshToken: data.refresh_token }
    }

    let err = ''
    try {
      err = ((await res.json()).error || '').toLowerCase()
    } catch {
      err = ''
    }

    if (err === 'authorization_pending') continue
    if (err === 'slow_down') {
      wait += 2
      continue
    }
    if (err === 'expired_token') throw new AuthError('That code expired. Try again.')
    if (err === 'access_denied') throw new AuthError('Authorization was denied.')
    throw new AuthError(`Login failed: ${err || res.status}`)
  }
  throw new AuthError('Login timed out. Try again.')
}

// Google refresh tokens are long-lived and reusable (unlike Twitch's single-use
// ones), but we keep the onNewRefreshToken hook for a consistent interface.
async function refreshAccessToken(refreshToken, onNewRefreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (res.status === 400 || res.status === 401)
    throw new AuthExpired('Your YouTube login expired. Please log in again.')
  if (!res.ok) throw new AuthError(`YouTube token refresh failed (${res.status}).`)

  const data = await res.json()
  if (data.refresh_token && onNewRefreshToken) onNewRefreshToken(data.refresh_token)
  return data.access_token
}

async function getCurrentChannel(accessToken) {
  const url = `${CHANNELS_URL}?part=snippet&mine=true`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (res.status === 401) throw new AuthExpired('Your YouTube login expired. Please log in again.')
  if (!res.ok) throw new AuthError(`Couldn't read your YouTube channel (${res.status}).`)
  const items = (await res.json()).items || []
  if (!items.length) throw new AuthError('YouTube returned no channel info.')
  const c = items[0]
  const thumbs = (c.snippet && c.snippet.thumbnails) || {}
  return {
    id: c.id,
    name: (c.snippet && c.snippet.title) || 'YouTube',
    avatar: (thumbs.default && thumbs.default.url) || '',
  }
}

// members.list has no total field, so we page through and count. maxResults maxes
// at 1000; a large channel means several pages, hence the "poll infrequently"
// guidance above. hasAccessToLevel is omitted so every membership level counts.
async function getMemberCount(accessToken) {
  let total = 0
  let pageToken = ''
  // Hard page cap so a pathological response can't loop forever.
  for (let page = 0; page < 200; page++) {
    const qs = new URLSearchParams({ part: 'snippet', maxResults: '1000' })
    if (pageToken) qs.set('pageToken', pageToken)
    const res = await fetch(`${MEMBERS_URL}?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (res.status === 401)
      throw new AuthExpired('Your YouTube login expired. Please log in again.')
    if (!res.ok) throw new AuthError(`Couldn't read your members (${res.status}).`)
    const data = await res.json()
    total += (data.items || []).length
    pageToken = data.nextPageToken || ''
    if (!pageToken) break
  }
  return total
}

module.exports = {
  CLIENT_ID,
  SCOPES,
  AuthError,
  AuthExpired,
  startDeviceFlow,
  pollForToken,
  refreshAccessToken,
  getCurrentChannel,
  getMemberCount,
}
