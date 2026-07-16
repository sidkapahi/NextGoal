'use strict'

const { BrowserWindow, app, shell } = require('electron')
const path = require('path')

const APP_W = 460
const APP_H = 640

let win = null
let mode = 'app'

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

  win.on('closed', () => {
    win = null
  })
  return win
}

async function showOnboarding() {
  if (!win) return
  mode = 'onboarding'
  win.center()
  await loadRenderer(win, 'onboarding')
  win.show()
  win.focus()
}

async function showApp() {
  if (!win) return
  mode = 'app'
  await loadRenderer(win, 'app')
  win.center()
  win.show()
  win.focus()
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
