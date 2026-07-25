'use strict'

// YouTube auth via Google's OAuth 2.0 for a **Desktop app** client:
// Authorization Code + PKCE through a loopback redirect (browser opens, you
// approve, it returns automatically) — the same UX as Kick. Mirrors the shape
// of kickAuth.js so index.js can drive both the same way.
//
// IMPORTANT: the membership APIs need `youtube.channel-memberships.creator`
// (a "sensitive" scope — usable in Testing mode with the channel owner added as
// a test user; production release needs Google verification). The channel must
// be in the YouTube Partner Program with channel memberships enabled. There is
// no "member count" field — the count is obtained by paginating members.list and
// counting, so callers should poll infrequently.
//
// Desktop-app clients carry a client secret in the token exchange; for an
// installed app Google treats it as non-confidential (it ships in the binary).
// Both are injected at build time.

const { createPkce, randomState, startLoopback } = require('./oauthLoopback')

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'
const MEMBERS_URL = 'https://www.googleapis.com/youtube/v3/members'

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.channel-memberships.creator',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ')

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
// Terminal (non-retryable): the channel can't use the memberships API — it isn't
// a YouTube Partner Program channel with memberships enabled. `fatal` tells the
// poller to stop rather than retry the same 403 every interval.
class MembersUnavailable extends AuthError {
  constructor(m) {
    super(m)
    this.name = 'MembersUnavailable'
    this.fatal = true
  }
}

function form(obj) {
  return new URLSearchParams(obj).toString()
}

// Drives the browser round-trip. `openUrl` is injected by the caller (wired to
// shell.openExternal in the main process) so this module stays Electron-free.
// access_type=offline + prompt=consent make Google return a refresh token.
async function login({ openUrl }) {
  const { verifier, challenge } = createPkce()
  const state = randomState()
  const loop = await startLoopback()
  try {
    const authUrl =
      `${AUTH_URL}?` +
      form({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: loop.redirectUri,
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        state,
      })
    openUrl(authUrl)

    const code = await loop.waitForCode(state)

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: loop.redirectUri,
        code,
        code_verifier: verifier,
      }),
    })
    if (!res.ok) throw new AuthError('YouTube login didn’t go through. Please try connecting again.')
    const data = await res.json()
    return { accessToken: data.access_token, refreshToken: data.refresh_token }
  } finally {
    loop.close()
  }
}

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
  if (!res.ok) throw new AuthError('Couldn’t reach YouTube. Check your internet connection and try again.')

  const data = await res.json()
  if (data.refresh_token && onNewRefreshToken) onNewRefreshToken(data.refresh_token)
  return data.access_token
}

async function getCurrentChannel(accessToken) {
  const url = `${CHANNELS_URL}?part=snippet&mine=true`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (res.status === 401) throw new AuthExpired('Your YouTube login expired. Please log in again.')
  if (!res.ok) throw new AuthError('Couldn’t read your YouTube channel. Please try connecting again.')
  const items = (await res.json()).items || []
  if (!items.length) throw new AuthError('YouTube didn’t return your channel info. Please try again.')
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
    if (res.status === 403)
      throw new MembersUnavailable(
        'YouTube: this channel is not a Partner and does not have the memberships feature, so member count is unavailable.'
      )
    if (!res.ok) throw new AuthError('Couldn’t read your YouTube members right now. Please try again.')
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
  MembersUnavailable,
  login,
  refreshAccessToken,
  getCurrentChannel,
  getMemberCount,
}
