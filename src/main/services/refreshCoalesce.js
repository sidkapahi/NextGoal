'use strict'

// Coalesce concurrent refreshes of the SAME refresh token.
//
// Access tokens are refreshed independently by several components (the on-demand
// Total Subs refresh, the live SubTracker, the pollers, one-shot syncs). Twitch
// and Kick refresh tokens are single-use: the moment one refresh succeeds it
// rotates the token, so a second refresh that was fired concurrently with the
// same token gets a 400 and surfaces a spurious "Your login expired" toast —
// even though the account is perfectly fine (the winning refresh already fetched
// the total).
//
// This wraps a platform's real refreshAccessToken so that, while a refresh for a
// given token is in flight, additional callers with that same token share the
// one request instead of racing a second. Every caller's onNewRefreshToken is
// still notified of the rotated token, so each component updates its own copy.
function makeCoalescer(doRefresh) {
  const inflight = new Map() // refreshToken -> { promise, callbacks: [] }

  return function refreshAccessToken(refreshToken, onNewRefreshToken) {
    const existing = inflight.get(refreshToken)
    if (existing) {
      if (onNewRefreshToken) existing.callbacks.push(onNewRefreshToken)
      return existing.promise
    }

    const entry = { callbacks: onNewRefreshToken ? [onNewRefreshToken] : [] }
    // Fan the rotated token out to every caller that joined this refresh.
    const notify = (t) => {
      for (const cb of entry.callbacks) {
        try { cb(t) } catch {}
      }
    }
    entry.promise = Promise.resolve(doRefresh(refreshToken, notify)).finally(() => {
      inflight.delete(refreshToken)
    })
    inflight.set(refreshToken, entry)
    return entry.promise
  }
}

module.exports = { makeCoalescer }
