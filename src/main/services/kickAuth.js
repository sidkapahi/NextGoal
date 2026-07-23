'use strict'

// Kick auth via OAuth 2.1 Authorization Code + PKCE (a public client — no
// secret). Kick has no device-code flow, so instead of showing a code we open
// the system browser and catch the redirect on a loopback server
// (see oauthLoopback.js). The exposed surface still mirrors twitchAuth.js /
// youtubeAuth.js as far as it can.
//
// Endpoints per the Kick developer docs (https://github.com/KickEngineering/
// KickDevDocs): OAuth server at id.kick.com, REST API at api.kick.com.
//
// NOTE: Kick's public API is young and still changing. The exact read scope and
// the subscriber-count shape below should be confirmed against the live docs
// before shipping — they're implemented to the documented shape and isolated
// here so only this file needs updating if Kick changes them.

const { base64url, createPkce, randomState, startLoopback } = require('./oauthLoopback')

const AUTHORIZE_URL = 'https://id.kick.com/oauth/authorize'
const TOKEN_URL = 'https://id.kick.com/oauth/token'
const API_BASE = 'https://api.kick.com/public/v1'

// Read-only scopes: identify the user + channel and subscribe to sub events.
// (Kick has no "read subscriber count" scope — sub data comes via events.)
const SCOPES = 'user:read channel:read events:subscribe'

// Kick requires the redirect URI to be registered exactly, so we use a fixed
// loopback port. Register http://localhost:8577/callback on your Kick app.
const REDIRECT_PORT = 8577

// Injected at build time; env fallback in dev. Kick issues a confidential
// client, so the token exchange also carries a client secret alongside PKCE.
const CLIENT_ID = process.env.KICK_CLIENT_ID || '__KICK_CLIENT_ID__'
const CLIENT_SECRET = process.env.KICK_CLIENT_SECRET || '__KICK_CLIENT_SECRET__'

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

// Drives the whole browser round-trip. `openUrl` is injected by the caller
// (wired to shell.openExternal in the main process) so this module stays
// Electron-free. Resolves with { accessToken, refreshToken }.
async function login({ openUrl }) {
  const { verifier, challenge } = createPkce()
  const state = randomState()
  const loop = await startLoopback(REDIRECT_PORT)
  try {
    const authUrl =
      `${AUTHORIZE_URL}?` +
      form({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: loop.redirectUri,
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
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
    if (!res.ok) throw new AuthError(`Kick login failed (${res.status}).`)
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
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  })
  if (res.status === 400 || res.status === 401)
    throw new AuthExpired('Your Kick login expired. Please log in again.')
  if (!res.ok) throw new AuthError(`Kick token refresh failed (${res.status}).`)
  const data = await res.json()
  if (data.refresh_token && onNewRefreshToken) onNewRefreshToken(data.refresh_token)
  return data.access_token
}

async function getCurrentChannel(accessToken) {
  // With no query params, /channels returns the authorized user's own channel.
  const res = await fetch(`${API_BASE}/channels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 401) throw new AuthExpired('Your Kick login expired. Please log in again.')
  if (!res.ok) throw new AuthError(`Couldn't read your Kick channel (${res.status}).`)
  const rows = (await res.json()).data || []
  if (!rows.length) throw new AuthError('Kick returned no channel info.')
  const c = rows[0]
  return {
    id: String(c.broadcaster_user_id || c.id || ''),
    name: c.slug || c.channel_slug || 'Kick',
    avatar: c.banner_picture || c.profile_picture || '',
  }
}

// Current subscriber total. Confirmed against the live API (see
// scripts/kick-probe.mjs): GET /channels returns active_subscribers_count on the
// authorized user's own channel — there is no separate subscriptions endpoint
// (both /channels/subscriptions and /subscriptions 404). Only channel:read is
// required. broadcasterId is unused (the endpoint is scoped to the token).
async function getSubscriberCount(accessToken) {
  const res = await fetch(`${API_BASE}/channels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 401) throw new AuthExpired('Your Kick login expired. Please log in again.')
  if (!res.ok) throw new AuthError(`Couldn't read your Kick subs (${res.status}).`)
  const rows = (await res.json()).data || []
  return Number(rows[0] && rows[0].active_subscribers_count) || 0
}

module.exports = {
  CLIENT_ID,
  SCOPES,
  AuthError,
  AuthExpired,
  login,
  refreshAccessToken,
  getCurrentChannel,
  getSubscriberCount,
}
