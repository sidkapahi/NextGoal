'use strict'

const { BrowserWindow, app, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const APP_W = 460
const APP_H = 640

let win = null
let splash = null
let mode = 'app'

// Self-contained loading screen shown the instant the app process is ready,
// while the (heavier) renderer window loads behind it. Kept as an inline data
// URL so it paints immediately and needs no build-path resolution.
function splashHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:transparent;overflow:hidden;cursor:default;
      font-family:-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-user-select:none;user-select:none;}
    .card{height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
      background:#0B0C0F;border:1px solid #1D2028;border-radius:16px;box-sizing:border-box;}
    .logo{position:relative;width:84px;height:84px;display:flex;align-items:center;justify-content:center;}
    .ring{position:absolute;inset:0;border-radius:50%;border:3px solid #1D2028;border-top-color:#7C6BE8;
      animation:spin .9s linear infinite;}
    @keyframes spin{to{transform:rotate(360deg)}}
    .txt{display:flex;flex-direction:column;align-items:center;gap:4px;}
    .name{font-size:16px;font-weight:600;letter-spacing:.2px;color:#D7DBE2;}
    .sub{font-size:12px;color:#8B93A3;}
  </style></head><body>
    <div class="card">
      <div class="logo">
        <div class="ring"></div>
        <svg width="38" height="44" viewBox="0 0 120 150" fill="none" aria-hidden="true">
          <path d="M18 92 L60 54 L102 92" stroke="#FF6B35" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M18 124 L60 86 L102 124" stroke="#7C6BE8" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="txt"><div class="name">NextGoal</div><div class="sub">Loading…</div></div>
    </div>
  </body></html>`
}

function createSplash() {
  splash = new BrowserWindow({
    width: 280,
    height: 280,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  // Sit above normal windows (and most system UI) until the app takes over.
  splash.setAlwaysOnTop(true, 'screen-saver')
  splash.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) {
      splash.center()
      splash.show()
    }
  })
  splash.on('closed', () => {
    splash = null
  })
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml()))
  return splash
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) {
    try {
      splash.close()
    } catch {}
  }
  splash = null
}

// Lightweight main-process log so packaged startup failures are diagnosable.
// Written to <userData>/ng-main.log.
function logMain(msg) {
  try {
    const line = `${new Date().toISOString()} ${msg}\n`
    fs.appendFileSync(path.join(app.getPath('userData'), 'ng-main.log'), line)
  } catch {}
}

function loadRenderer(w, hashMode) {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/${hashMode}`)
  }
  return w.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: `/${hashMode}` })
}

function createWindow({ preloadPath }) {
  win = new BrowserWindow({
    width: APP_W,
    height: APP_H,
    show: false,
    frame: true,
    autoHideMenuBar: true, // no File/Edit/View menu bar
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#0B0C0F',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses require; keep false
    },
  })

  // Closing hides the window to the tray; the app keeps running. A real quit
  // (tray menu / app.quit) sets app.isQuitting so the window closes for good.
  win.on('close', (e) => {
    if (app.isQuitting) return
    e.preventDefault()
    win.hide()
  })

  // open external links (twitch.tv/activate) in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Diagnostics: surface renderer load/crash failures instead of a silent
  // no-window state.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logMain(`did-fail-load code=${code} desc=${desc} url=${url}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    logMain(`render-process-gone reason=${details && details.reason}`)
  })

  win.on('closed', () => {
    win = null
  })
  return win
}

// Load content into the window while the splash covers the blank load, then
// reveal the window (on first paint) and dismiss the splash. A hard timeout and
// a did-fail-load handler both fall back to revealing, so a slow or failed load
// can never leave the splash stuck on screen with no window behind it.
async function present(hashMode) {
  if (!win) return
  win.center()

  let revealed = false
  const reveal = () => {
    if (revealed) return
    revealed = true
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
    closeSplash()
  }

  win.once('ready-to-show', reveal)
  win.webContents.once('did-fail-load', reveal)
  const timer = setTimeout(reveal, 10000)

  try {
    await loadRenderer(win, hashMode)
  } catch (e) {
    logMain(`loadRenderer(${hashMode}) failed: ${(e && e.message) || e}`)
  } finally {
    clearTimeout(timer)
    reveal()
  }
}

async function showOnboarding() {
  mode = 'onboarding'
  await present('onboarding')
}

async function showApp() {
  mode = 'app'
  await present('app')
}

function toggleWindow() {
  if (!win) return
  if (win.isVisible()) {
    win.hide()
    return
  }
  win.show()
  win.focus()
}

function showWindow() {
  if (!win) return
  win.show()
  win.focus()
}

function getWindow() {
  return win
}
function getMode() {
  return mode
}

module.exports = {
  createWindow,
  createSplash,
  closeSplash,
  showOnboarding,
  showApp,
  toggleWindow,
  showWindow,
  getWindow,
  getMode,
  APP_W,
  APP_H,
}
