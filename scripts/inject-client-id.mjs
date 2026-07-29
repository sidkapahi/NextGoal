// Replaces the client-id/secret placeholders in the built main bundle with env
// values. Runs after electron-vite build, before electron-builder packages the
// app. Twitch is required (the app is unusable without it); YouTube and Kick are
// optional — if their env vars are absent the placeholder is left in place and
// that platform simply can't be linked in the packaged build.
import fs from 'fs'
import path from 'path'

// Load a .env at the project root into process.env so a local `npm run dist:win`
// picks up the same credentials used for dev. Shell-provided vars win. CI passes
// the vars directly, so the file simply won't exist there — that's fine.
try {
  const envPath = path.resolve(process.cwd(), '.env')
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    const val = m[2].trim().replace(/^["']|["']$/g, '')
    if (process.env[key] === undefined) process.env[key] = val
  }
} catch {
  // no .env file — vars may come from the shell (or CI) instead
}

const file = path.resolve('out/main/index.js')
let src = fs.readFileSync(file, 'utf8')

// [placeholder, env var, required]
const SUBS = [
  ['__TWITCH_CLIENT_ID__', 'TWITCH_CLIENT_ID', true],
  ['__YOUTUBE_CLIENT_ID__', 'YOUTUBE_CLIENT_ID', false],
  ['__YOUTUBE_CLIENT_SECRET__', 'YOUTUBE_CLIENT_SECRET', false],
  ['__KICK_CLIENT_ID__', 'KICK_CLIENT_ID', false],
  ['__KICK_CLIENT_SECRET__', 'KICK_CLIENT_SECRET', false],
]

let injected = 0
for (const [placeholder, envVar, required] of SUBS) {
  const val = process.env[envVar]
  if (!val) {
    if (required) {
      console.error(`${envVar} not set — refusing to build a broken app.`)
      process.exit(1)
    }
    console.warn(`${envVar} not set — leaving ${placeholder} unfilled (platform disabled).`)
    continue
  }
  if (src.includes(placeholder)) {
    src = src.replaceAll(placeholder, val)
    injected++
  } else {
    console.warn(`${placeholder} not found (already injected?) — continuing`)
  }
}

fs.writeFileSync(file, src)
console.log(`Injected ${injected} client value(s).`)
