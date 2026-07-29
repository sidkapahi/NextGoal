'use strict'

const WebSocket = require('ws')
const { EventEmitter } = require('events')
const auth = require('./twitchAuth')

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws'
const EVENTSUB_SUBS = 'https://api.twitch.tv/helix/eventsub/subscriptions'

// channel.subscribe fires per recipient (incl. each gift recipient).
// channel.subscription.gift fires once for the gifter WITH a total.
// Counting both double-counts, so we count subscribe + message(resub) only,
// and treat gift as a display event.
const EVENT_TYPES = [
  ['channel.subscribe', '1'],
  ['channel.subscription.gift', '1'],
  ['channel.subscription.message', '1'],
]

class SubTracker extends EventEmitter {
  constructor({ broadcasterId, getRefreshToken, onNewRefreshToken, countResubs = true }) {
    super()
    this.broadcasterId = broadcasterId
    // Read the refresh token lazily from the shared source of truth rather than
    // snapshotting it: another component (e.g. the on-demand totals refresh) can
    // rotate the single-use token between our refreshes, and a stale snapshot
    // would then 400 and look like a spurious "login expired".
    this.getRefreshToken = getRefreshToken
    this.onNewRefreshToken = onNewRefreshToken
    this.countResubs = countResubs
    this.accessToken = null
    this.ws = null
    this.stopped = false
    this.reconnectTimer = null
    this.reconnectAttempts = 0
  }

  async start() {
    try {
      await this._refresh()
    } catch (e) {
      if (e instanceof auth.AuthExpired) this.emit('auth-expired', e.message)
      else this.emit('error', e.message)
      this.emit('stopped')
      return
    }
    this._connect(EVENTSUB_URL)
  }

  stop() {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
    }
  }

  async _refresh() {
    this.accessToken = await auth.refreshAccessToken(this.getRefreshToken(), (t) => {
      if (this.onNewRefreshToken) this.onNewRefreshToken(t)
    })
  }

  async _subscribe(type, version, sessionId) {
    const doPost = () =>
      fetch(EVENTSUB_SUBS, {
        method: 'POST',
        headers: {
          'Client-Id': auth.CLIENT_ID,
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          version,
          condition: { broadcaster_user_id: this.broadcasterId },
          transport: { method: 'websocket', session_id: sessionId },
        }),
      })

    let res = await doPost()
    if (res.status === 401) {
      await this._refresh()
      res = await doPost()
    }
    if (!res.ok) {
      throw new Error('Couldn’t start counting Twitch subs. Please try reconnecting Twitch.')
    }
  }

  _connect(url) {
    this.ws = new WebSocket(url)

    this.ws.on('message', async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      const type = msg.metadata && msg.metadata.message_type

      if (type === 'session_welcome') {
        const sessionId = msg.payload.session.id
        try {
          for (const [etype, version] of EVENT_TYPES) {
            if (etype === 'channel.subscription.message' && !this.countResubs) continue
            await this._subscribe(etype, version, sessionId)
          }
          this.reconnectAttempts = 0 // healthy again — reset the backoff
          this.emit('connected')
        } catch (e) {
          this.emit('error', e.message)
        }
      } else if (type === 'session_reconnect') {
        const newUrl = msg.payload.session.reconnect_url
        const old = this.ws
        this._connect(newUrl)
        try {
          old.close()
        } catch {}
      } else if (type === 'revocation') {
        this.emit('auth-expired', 'Twitch revoked access. Please log in again.')
        this.stop()
      } else if (type === 'notification') {
        this._handleNotification(msg)
      }
    })

    this.ws.on('close', () => {
      if (this.stopped) return
      // Exponential backoff (5s → 60s cap) so a sustained Twitch/network outage
      // isn't hammered every 5s. A transient blip reconnects on the first try
      // and resets the backoff via 'connected', so live counting stays prompt.
      const delay = Math.min(5000 * 2 ** this.reconnectAttempts, 60000)
      this.reconnectAttempts++
      this.emit('status', `Reconnecting in ${Math.round(delay / 1000)}s...`)
      this.reconnectTimer = setTimeout(() => this._connect(EVENTSUB_URL), delay)
    })

    this.ws.on('error', () =>
      this.emit('error', 'Lost the connection to Twitch. It will reconnect automatically.')
    )
  }

  _handleNotification(msg) {
    const subType = msg.payload.subscription.type
    const event = msg.payload.event

    if (subType === 'channel.subscribe') {
      this.emit('subs', 1)
    } else if (subType === 'channel.subscription.message') {
      if (this.countResubs) this.emit('subs', 1)
    } else if (subType === 'channel.subscription.gift') {
      const total = event.total || 1
      const gifter = event.is_anonymous ? 'Anonymous' : event.user_name || 'Someone'
      this.emit('status', `${gifter} gifted ${total} sub(s)`)
    }
  }
}

module.exports = { SubTracker }
