'use strict'

// Twitch auth via Device Code Flow (public client, no secret).
// Ported from the Python version. Node 18+ has global fetch.

const { makeCoalescer } = require('./refreshCoalesce')

const DEVICE_URL = 'https://id.twitch.tv/oauth2/device'
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const HELIX_USERS = 'https://api.twitch.tv/helix/users'
const HELIX_SUBS = 'https://api.twitch.tv/helix/subscriptions'
const SCOPES = 'channel:read:subscriptions'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

// Public info, safe to ship. Injected at build time; falls back to env in dev.
const CLIENT_ID = process.env.TWITCH_CLIENT_ID || '__TWITCH_CLIENT_ID__'

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

async function startDeviceFlow() {
  const res = await fetch(DEVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: CLIENT_ID, scopes: SCOPES }),
  })
  if (!res.ok) throw new AuthError('Couldn’t start the Twitch login. Please try again in a moment.')
  return res.json() // { device_code, user_code, verification_uri, interval, expires_in }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
        device_code: deviceCode,
        grant_type: DEVICE_GRANT,
        scopes: SCOPES,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      return { accessToken: data.access_token, refreshToken: data.refresh_token }
    }

    let msg = ''
    try {
      msg = ((await res.json()).message || '').toLowerCase()
    } catch {
      msg = ''
    }

    if (msg.includes('pending')) continue
    if (msg.includes('slow_down')) {
      wait += 2
      continue
    }
    if (msg.includes('expired')) throw new AuthError('Your Twitch login code expired. Please try again.')
    if (msg.includes('denied') || msg.includes('declined'))
      throw new AuthError('Twitch login was cancelled or denied. Please try again.')
    throw new AuthError('Twitch login didn’t go through. Please try again.')
  }
  throw new AuthError('Twitch login timed out. Please try again.')
}

// Public clients pass NO secret. Refresh tokens are single-use, so persist the
// replacement immediately via onNewRefreshToken. Wrapped by makeCoalescer below
// so concurrent refreshers of the same token share one rotation (avoids a
// spurious "login expired" when e.g. the tracker and the totals refresh race).
async function doRefreshAccessToken(refreshToken, onNewRefreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (res.status === 400 || res.status === 401)
    throw new AuthExpired('Your Twitch login expired. Please log in again.')
  if (!res.ok) throw new AuthError('Couldn’t reach Twitch. Check your internet connection and try again.')

  const data = await res.json()
  if (data.refresh_token && onNewRefreshToken) onNewRefreshToken(data.refresh_token)
  return data.access_token
}
const refreshAccessToken = makeCoalescer(doRefreshAccessToken)

async function getCurrentUser(accessToken) {
  const res = await fetch(HELIX_USERS, {
    headers: { 'Client-Id': CLIENT_ID, Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new AuthError('Couldn’t read your Twitch account. Please try connecting again.')
  const data = (await res.json()).data || []
  if (!data.length) throw new AuthError('Twitch didn’t return your account info. Please try again.')
  return { id: data[0].id, name: data[0].display_name, avatar: data[0].profile_image_url || '' }
}

// Current total subscriber count for the broadcaster. Uses the same
// channel:read:subscriptions scope the tracker already relies on.
async function getSubscriberCount(accessToken, broadcasterId) {
  const url = `${HELIX_SUBS}?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=1`
  const res = await fetch(url, {
    headers: { 'Client-Id': CLIENT_ID, Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 401) throw new AuthExpired('Your Twitch login expired. Please log in again.')
  if (!res.ok) throw new AuthError('Couldn’t read your Twitch sub count right now. Please try again.')
  const data = await res.json()
  return Number(data.total) || 0
}

module.exports = {
  CLIENT_ID,
  SCOPES,
  AuthError,
  AuthExpired,
  startDeviceFlow,
  pollForToken,
  refreshAccessToken,
  getCurrentUser,
  getSubscriberCount,
}
