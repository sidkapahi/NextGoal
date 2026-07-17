'use strict'

const { BrowserWindow, app, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const APP_W = 460
const APP_H = 640

let win = null
let mode = 'app'

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

// Show the window immediately, then load content into it. Showing up front
// (rather than after awaiting the load) guarantees a visible window even if the
// renderer is slow or fails to load — the background is dark, so there's no
// flash. Callers that want it hidden (start-minimized) hide it afterward.
async function present(hashMode) {
  if (!win) return
  win.center()
  win.show()
  win.focus()
  try {
    await loadRenderer(win, hashMode)
  } catch (e) {
    logMain(`loadRenderer(${hashMode}) failed: ${(e && e.message) || e}`)
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
  showOnboarding,
  showApp,
  toggleWindow,
  showWindow,
  getWindow,
  getMode,
  APP_W,
  APP_H,
}
