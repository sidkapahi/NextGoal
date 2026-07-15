// Stub electron's screen so we can test anchor math headless.
const Module = require('module')
const displays = { list: [], primary: null, nearest: null }
const orig = Module._load
Module._load = function(req, ...rest) {
  if (req === 'electron') {
    return {
      screen: {
        getPrimaryDisplay: () => displays.primary,
        getDisplayNearestPoint: () => displays.nearest || displays.primary,
      }
    }
  }
  return orig.call(this, req, ...rest)
}
const { computeFlyoutPosition, taskbarEdge } = require('../src/main/anchor.js')

const WIN = { width: 460, height: 640 }
let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('ok  ', name) }
  else { fail++; console.log('FAIL', name, extra || '') }
}

// --- 1080p, bottom taskbar (40px), tray icon bottom-right ---
displays.primary = { workArea:{x:0,y:0,width:1920,height:1040}, bounds:{x:0,y:0,width:1920,height:1080} }
displays.nearest = displays.primary
let p = computeFlyoutPosition(WIN, { x:1850, y:1050, width:24, height:24 })
check('bottom: sits above taskbar', p.y === 1040 - 640 - 8, `y=${p.y}`)
check('bottom: clamped to right edge', p.x === 1920 - 460 - 8, `x=${p.x}`)
check('bottom: fully on screen', p.x >= 8 && p.y >= 8)

// --- taskbar on top ---
displays.primary = { workArea:{x:0,y:40,width:1920,height:1040}, bounds:{x:0,y:0,width:1920,height:1080} }
displays.nearest = displays.primary
check('edge detect: top', taskbarEdge(displays.primary.workArea, displays.primary.bounds) === 'top')
p = computeFlyoutPosition(WIN, { x:1850, y:8, width:24, height:24 })
check('top: sits below taskbar', p.y === 40 + 8, `y=${p.y}`)

// --- taskbar on left ---
displays.primary = { workArea:{x:70,y:0,width:1850,height:1080}, bounds:{x:0,y:0,width:1920,height:1080} }
displays.nearest = displays.primary
check('edge detect: left', taskbarEdge(displays.primary.workArea, displays.primary.bounds) === 'left')
p = computeFlyoutPosition(WIN, { x:10, y:500, width:24, height:24 })
check('left: hugs left work edge', p.x === 70 + 8, `x=${p.x}`)

// --- overflow tray: bounds 0,0 -> corner fallback ---
displays.primary = { workArea:{x:0,y:0,width:1920,height:1040}, bounds:{x:0,y:0,width:1920,height:1080} }
displays.nearest = displays.primary
p = computeFlyoutPosition(WIN, { x:0, y:0, width:0, height:0 })
check('overflow: falls back to bottom-right corner', p.x === 1920-460-8 && p.y === 1040-640-8, `x=${p.x} y=${p.y}`)

// --- null tray bounds -> corner fallback, no crash ---
p = computeFlyoutPosition(WIN, null)
check('null tray: no crash, on-screen', p.x >= 8 && p.y >= 8)

// --- tray icon near left on bottom taskbar: dont go off left edge ---
p = computeFlyoutPosition(WIN, { x:20, y:1050, width:24, height:24 })
check('bottom-left tray: clamped to min x', p.x === 8, `x=${p.x}`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
