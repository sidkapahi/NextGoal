'use strict'

const { Tray, Menu, nativeImage, app } = require('electron')
const path = require('path')
const windows = require('./windows')

let tray = null

function iconFor(live) {
  const file = live ? 'tray-live.png' : 'tray-idle.png'
  // packaged: resources are unpacked next to the app; dev: project resources dir
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(__dirname, '../../resources')
  return nativeImage.createFromPath(path.join(base, file))
}

function createTray({ getStatus, onToggleTracking, onReset }) {
  tray = new Tray(iconFor(false))
  tray.setToolTip('NextGoal')
  windows.setTray(tray)

  tray.on('click', () => windows.toggleWindow())

  tray.on('right-click', () => {
    const s = getStatus()
    const menu = Menu.buildFromTemplate([
      {
        label: s.tracking ? `Tracking \u2014 ${s.count}/${s.goal}` : 'Not tracking',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: s.tracking ? 'Stop tracking' : 'Start tracking',
        click: () => onToggleTracking(),
      },
      { label: 'Reset count to 0', click: () => onReset() },
      { type: 'separator' },
      { label: 'Show window', click: () => windows.showWindow() },
      { type: 'separator' },
      { label: 'Quit NextGoal', click: () => app.quit() },
    ])
    tray.popUpContextMenu(menu)
  })

  return tray
}

function updateTray({ tracking, count, goal }) {
  if (!tray) return
  tray.setImage(iconFor(tracking))
  tray.setToolTip(tracking ? `NextGoal \u2014 ${count}/${goal}` : 'NextGoal \u2014 idle')
}

module.exports = { createTray, updateTray }
