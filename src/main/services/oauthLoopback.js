'use strict'

const http = require('http')
const crypto = require('crypto')

// Helpers for the OAuth 2.1 Authorization-Code + PKCE flow used by providers
// that don't offer a device-code flow (Kick). We open the system browser to the
// provider's authorize page and catch the redirect on a short-lived loopback
// HTTP server, exactly the pattern Google recommends for installed apps.

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function createPkce() {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function randomState() {
  return base64url(crypto.randomBytes(16))
}

// Starts a loopback server on 127.0.0.1. Pass a fixed `port` for providers that
// require the redirect URI to be registered exactly (Twitch, Kick); omit it (0)
// for providers that allow any loopback port (Google Desktop apps). Resolves:
//   redirectUri            — register this on the app when a fixed port is used
//   waitForCode(state, ms) — resolves with the ?code once the browser returns
//   close()                — tear the server down (always call in a finally)
function startLoopback(port = 0) {
  return new Promise((resolve, reject) => {
    let onResult = null
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui,sans-serif;background:#0f0f12;color:#eee;text-align:center;padding-top:80px"><h2>You can close this tab and return to NextGoal.</h2></body>'
      )
      if (onResult) {
        onResult({
          code: url.searchParams.get('code'),
          state: url.searchParams.get('state'),
          error: url.searchParams.get('error'),
        })
      }
    })
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const boundPort = server.address().port
      resolve({
        redirectUri: `http://localhost:${boundPort}/callback`,
        waitForCode(expectedState, timeoutMs = 300000) {
          return new Promise((res2, rej2) => {
            const timer = setTimeout(() => {
              onResult = null
              rej2(new Error('The login window timed out. Please try connecting again.'))
            }, timeoutMs)
            onResult = ({ code, state, error }) => {
              clearTimeout(timer)
              if (error) return rej2(new Error('The login was cancelled or denied. Please try again.'))
              if (expectedState && state !== expectedState)
                return rej2(new Error('Something went wrong during login. Please try connecting again.'))
              if (!code) return rej2(new Error('The login didn’t complete. Please try connecting again.'))
              res2(code)
            }
          })
        },
        close() {
          try {
            server.close()
          } catch {}
        },
      })
    })
  })
}

module.exports = { base64url, createPkce, randomState, startLoopback }
