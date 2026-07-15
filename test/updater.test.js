// Stub electron for the updater's isPrerelease logic
const Module = require('module')
const orig = Module._load
Module._load = function(req, ...rest){
  if(req === 'electron') return { autoUpdater: { on(){}, }, app: { getVersion:()=>'0.0.0', isPackaged:false } }
  if(req === 'electron-updater') return { autoUpdater: { on(){} } }
  return orig.call(this, req, ...rest)
}
const { isPrerelease } = require('../src/main/services/updater.js')
let pass=0, fail=0
const t=(v,exp)=>{ const g=isPrerelease(v); if(g===exp){pass++;console.log('ok  ',v,'->',g)} else {fail++;console.log('FAIL',v,'expected',exp,'got',g)} }
t('0.1.0', true)      // 0.x = alpha
t('0.9.9', true)
t('1.0.0-alpha.1', true)
t('1.0.0-beta', true)
t('1.0.0', false)     // stable
t('2.3.4', false)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
