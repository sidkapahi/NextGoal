// Replaces the client-id placeholder in the built main bundle with the env value.
// Runs after electron-vite build, before electron-builder packages the app.
import fs from 'fs'
import path from 'path'

const id = process.env.TWITCH_CLIENT_ID
if (!id) {
  console.error('TWITCH_CLIENT_ID not set — refusing to build a broken app.')
  process.exit(1)
}
const file = path.resolve('out/main/index.js')
let src = fs.readFileSync(file, 'utf8')
if (!src.includes('__TWITCH_CLIENT_ID__')) {
  console.warn('placeholder not found (already injected?) — continuing')
} else {
  src = src.replaceAll('__TWITCH_CLIENT_ID__', id)
  fs.writeFileSync(file, src)
  console.log('Client ID injected.')
}
