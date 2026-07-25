'use strict'

const { EventEmitter } = require('events')

// A generic interval poller for sources that have no real-time push (YouTube
// memberships, Kick subs). It calls fetchTotal() on an interval and emits the
// same event vocabulary as the Twitch SubTracker so index.js can wire every
// source the same way:
//   'total'        — a numeric current total
//   'auth-expired' — the login needs redoing (fetchTotal threw an AuthExpired)
//   'fatal'        — a non-retryable failure (error had .fatal); caller stops us
//   'error'        — a transient failure with a ready-to-show message
//   'neterror'     — a raw/network failure (no friendly message); caller phrases it
//
// It fires once immediately on start() so the first total lands without waiting
// a full interval, and it never overlaps requests (a slow fetch is skipped, not
// queued).
class Poller extends EventEmitter {
  constructor({ fetchTotal, intervalMs = 60000 }) {
    super()
    this.fetchTotal = fetchTotal
    // Floor the interval so a misconfigured value can't hammer an API.
    this.intervalMs = Math.max(15000, intervalMs | 0)
    this.timer = null
    this.stopped = false
    this.busy = false
  }

  start() {
    this.stopped = false
    this._tick()
    this.timer = setInterval(() => this._tick(), this.intervalMs)
  }

  stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async _tick() {
    if (this.stopped || this.busy) return
    this.busy = true
    try {
      const total = await this.fetchTotal()
      if (!this.stopped) this.emit('total', Number(total) || 0)
    } catch (e) {
      if (this.stopped) return
      if (e && e.name === 'AuthExpired') this.emit('auth-expired', e.message)
      else if (e && e.fatal) this.emit('fatal', e.message)
      else if (e && e.name === 'AuthError') this.emit('error', e.message) // already plain
      else this.emit('neterror') // raw/network error — caller phrases it per platform
    } finally {
      this.busy = false
    }
  }
}

module.exports = { Poller }
