'use strict'

const { screen } = require('electron')

const GAP = 8 // breathing room between the flyout and the screen edge

/**
 * Work out where a tray-anchored flyout should sit.
 *
 * Handles the things that actually break in the wild:
 *   - taskbar on bottom / top / left / right (people move it)
 *   - the tray icon living in the overflow area, where getBounds() lies
 *   - multi-monitor: anchor on whichever display the tray icon is on
 *   - clamping so the window never hangs off-screen
 *
 * @param {Electron.Rectangle} winBounds  the flyout's own width/height
 * @param {Electron.Rectangle|null} trayBounds  tray.getBounds(), may be empty
 * @returns {{x:number, y:number}} top-left position in screen coords
 */
function computeFlyoutPosition(winBounds, trayBounds) {
  const hasTray =
    trayBounds &&
    trayBounds.width > 0 &&
    trayBounds.height > 0 &&
    // Windows sometimes reports 0,0 for overflow-tray icons
    !(trayBounds.x === 0 && trayBounds.y === 0)

  // Pick the display the tray icon sits on; fall back to primary.
  const display = hasTray
    ? screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
    : screen.getPrimaryDisplay()

  const area = display.workArea // excludes the taskbar
  const full = display.bounds // includes it

  const edge = taskbarEdge(area, full)

  let x
  let y

  if (!hasTray) {
    // Overflow tray or unknown: pin to the corner nearest the clock,
    // which is the bottom-right on a standard bottom taskbar.
    return cornerFallback(winBounds, area, edge)
  }

  const trayCenterX = trayBounds.x + trayBounds.width / 2
  const trayCenterY = trayBounds.y + trayBounds.height / 2

  if (edge === 'bottom') {
    x = Math.round(trayCenterX - winBounds.width / 2)
    y = area.y + area.height - winBounds.height - GAP
  } else if (edge === 'top') {
    x = Math.round(trayCenterX - winBounds.width / 2)
    y = area.y + GAP
  } else if (edge === 'left') {
    x = area.x + GAP
    y = Math.round(trayCenterY - winBounds.height / 2)
  } else {
    // right
    x = area.x + area.width - winBounds.width - GAP
    y = Math.round(trayCenterY - winBounds.height / 2)
  }

  return clamp({ x, y }, winBounds, area)
}

/** Which edge is the taskbar on, inferred from workArea vs full bounds. */
function taskbarEdge(area, full) {
  if (area.height < full.height) {
    // horizontal taskbar
    return area.y > full.y ? 'top' : 'bottom'
  }
  if (area.width < full.width) {
    // vertical taskbar
    return area.x > full.x ? 'left' : 'right'
  }
  // auto-hidden or no reserved space: assume bottom
  return 'bottom'
}

function cornerFallback(winBounds, area, edge) {
  let x = area.x + area.width - winBounds.width - GAP
  let y = area.y + area.height - winBounds.height - GAP
  if (edge === 'top') y = area.y + GAP
  if (edge === 'left') x = area.x + GAP
  return clamp({ x, y }, winBounds, area)
}

/** Keep the whole window inside the work area. */
function clamp(pos, winBounds, area) {
  const maxX = area.x + area.width - winBounds.width - GAP
  const maxY = area.y + area.height - winBounds.height - GAP
  return {
    x: Math.min(Math.max(pos.x, area.x + GAP), maxX),
    y: Math.min(Math.max(pos.y, area.y + GAP), maxY),
  }
}

module.exports = { computeFlyoutPosition, taskbarEdge }
