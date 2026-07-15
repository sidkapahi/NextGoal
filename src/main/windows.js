'use strict'

const { BrowserWindow, app, shell } = require('electron')
const path = require('path')
const { computeFlyoutPosition } = require('./anchor')

const APP_W = 460
const APP_H = 640

let win = null
let mode = 'flyout'
let pinned = false
let trayRef = null

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

  win.on('blur', () => {
    if (mode !== 'flyout' || pinned) return
    if (win && win.webContents.isDevToolsOpened()) return
    if (win) win.hide()
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
  win.setSkipTaskbar(false)
  win.setAlwaysOnTop(false)
  win.center()
  await loadRenderer(win, 'onboarding')
  win.show()
  win.focus()
}

async function enterFlyoutMode() {
  if (!win) return
  mode = 'flyout'
  win.setSkipTaskbar(true)
  win.setAlwaysOnTop(true, 'floating')
  await loadRenderer(win, 'app')
}

function setTray(t) {
  trayRef = t
}

function positionFlyout() {
  if (!win || !trayRef) return
  let tb = null
  try {
    tb = trayRef.getBounds()
  } catch {}
  const { x, y } = computeFlyoutPosition(win.getBounds(), tb)
  win.setPosition(x, y, false)
}

function toggleFlyout() {
  if (!win) return
  if (win.isVisible()) {
    win.hide()
    return
  }
  positionFlyout()
  win.show()
  win.focus()
}

function showWindowed() {
  if (!win) return
  win.setSkipTaskbar(false)
  win.center()
  win.show()
  win.focus()
}

function setPinned(v) {
  pinned = !!v
}
function isPinned() {
  return pinned
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
  enterFlyoutMode,
  toggleFlyout,
  positionFlyout,
  showWindowed,
  setTray,
  setPinned,
  isPinned,
  getWindow,
  getMode,
  APP_W,
  APP_H,
}
