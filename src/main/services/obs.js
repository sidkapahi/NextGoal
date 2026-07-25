'use strict'

const { OBSWebSocket } = require('obs-websocket-js')

const TEXT_KINDS = new Set([
  'text_gdiplus_v3',
  'text_gdiplus_v2',
  'text_gdiplus',
  'text_ft2_source_v2',
  'text_ft2_source',
])

class OBSError extends Error {}

class OBSClient {
  constructor() {
    this.obs = new OBSWebSocket()
    this.connected = false
    this.obs.on('ConnectionClosed', () => {
      this.connected = false
    })
  }

  async connect({ host = 'localhost', port = 4455, password = '' } = {}) {
    if (this.connected) return
    const url = `ws://${host}:${port}`
    try {
      await this.obs.connect(url, password || undefined)
      this.connected = true
    } catch (e) {
      throw new OBSError(friendly(e))
    }
  }

  async close() {
    try {
      await this.obs.disconnect()
    } catch {}
    this.connected = false
  }

  // Try the default local connection with no password. Used by onboarding
  // auto-detect. Returns true on success, false (no throw) on failure.
  async tryAutoDetect() {
    try {
      await this.connect({ host: 'localhost', port: 4455, password: '' })
      return true
    } catch {
      return false
    }
  }

  async listTextSources() {
    this._assert()
    let resp
    try {
      resp = await this.obs.call('GetInputList')
    } catch (e) {
      this.connected = false
      throw new OBSError(friendly(e))
    }
    return (resp.inputs || [])
      .filter((i) => TEXT_KINDS.has(i.inputKind || i.unversionedInputKind || ''))
      .map((i) => i.inputName)
      .filter(Boolean)
  }

  // Create a text source on the current scene. Used by the "Add it to my scene"
  // onboarding step, so the user never touches OBS.
  async createTextSource(name = 'Sub Goal') {
    this._assert()
    try {
      const scene = await this.obs.call('GetCurrentProgramScene')
      const sceneName = scene.currentProgramSceneName || scene.sceneName
      const kind = await this._pickTextKind()
      await this.obs.call('CreateInput', {
        sceneName,
        inputName: name,
        inputKind: kind,
        inputSettings: { text: '0/5' },
      })
      return name
    } catch (e) {
      throw new OBSError(friendly(e))
    }
  }

  async _pickTextKind() {
    const resp = await this.obs.call('GetInputKindList')
    const kinds = resp.inputKinds || []
    for (const k of ['text_gdiplus_v3', 'text_gdiplus_v2', 'text_ft2_source_v2', 'text_gdiplus']) {
      if (kinds.includes(k)) return k
    }
    // fall back to whatever text kind exists
    const found = kinds.find((k) => TEXT_KINDS.has(k))
    if (!found) throw new OBSError('OBS has no text source type available.')
    return found
  }

  async setText(sourceName, text) {
    if (!sourceName) return
    this._assert()
    try {
      await this.obs.call('SetInputSettings', {
        inputName: sourceName,
        inputSettings: { text },
        overlay: true,
      })
    } catch (e) {
      this.connected = false
      throw new OBSError(friendly(e))
    }
  }

  _assert() {
    if (!this.connected) throw new OBSError('Not connected to OBS.')
  }
}

function friendly(e) {
  const raw = String((e && e.message) || e || '').trim()
  const m = raw.toLowerCase()
  if (m.includes('auth') || m.includes('password'))
    return 'OBS rejected the password. Check Tools > WebSocket Server Settings > Show Connect Info.'
  // Empty/unhelpful messages (a closed OBS often throws a message-less error that
  // stringifies to just "Error") and any connection-ish failure map to the same
  // clear guidance, so the toast never shows a bare "Error".
  if (
    !raw ||
    m === 'error' ||
    m.includes('refus') ||
    m.includes('connect') ||
    m.includes('timeout') ||
    m.includes('econn') ||
    m.includes('closed') ||
    m.includes('websocket')
  )
    return 'Can\u2019t reach OBS. Make sure OBS is open and Tools > WebSocket Server Settings > Enable is on.'
  return `OBS error: ${raw}`
}

module.exports = { OBSClient, OBSError }
