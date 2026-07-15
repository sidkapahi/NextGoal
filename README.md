# NextGoal

An auto-incrementing Twitch sub goal for OBS. Starts at 0 each stream; every time you hit the goal it raises itself by your chosen increment. Built with Electron + Vue, runs as a tray flyout, feeds OBS over obs-websocket (no plugin) with a text-file fallback.

## Run it

```bash
npm install
npm run dev          # launches Electron with hot reload
```

For local dev, Twitch login needs a client ID:

```bash
# PowerShell
$env:TWITCH_CLIENT_ID="your_id"; npm run dev
# bash
TWITCH_CLIENT_ID=your_id npm run dev
```

The client ID is public info (it ships in the built app). Register a **Public** client app at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) with redirect `http://localhost` and category Broadcasting Suite.

## Build an installer

```bash
$env:TWITCH_CLIENT_ID="your_id"
npm run dist:win
```

Produces a one-click per-user installer in `release/`. The build injects your client ID into the bundle (`scripts/inject-client-id.mjs`) and refuses to build without it, so you can't ship a broken app.

## Release (auto-update)

Add `TWITCH_CLIENT_ID` as a **repository secret**, then:

```bash
# bump version in package.json first
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions builds on Windows and publishes to Releases. `electron-updater` downloads new versions in the background and installs on quit. Alpha builds (0.x or `-alpha` tags) receive prereleases; stable builds only get stable.

## Architecture

**Main process** (`src/main`)
- `index.js` — wires everything, owns app state, all IPC
- `windows.js` — one BrowserWindow, two modes: framed onboarding vs tray flyout
- `anchor.js` — flyout positioning math (taskbar edge, overflow tray, DPI, clamping). Unit-tested.
- `tray.js` — left-click flyout toggle, right-click menu, idle/live icon
- `services/`
  - `twitchAuth.js` — Device Code Flow, no client secret, single-use refresh handling
  - `tracker.js` — EventSub WebSocket, gift-bomb double-count fix
  - `obs.js` — obs-websocket: connect, list/create/set text sources
  - `config.js` — settings JSON + refresh token in Electron `safeStorage` (encrypted)
  - `goal.js` — the increment math
  - `updater.js` — electron-updater wrapper, prerelease-aware

**Preload** (`src/preload/index.js`) — the only bridge. Renderer sees `window.ng` and nothing else. `contextIsolation` on, `nodeIntegration` off.

**Renderer** (`src/renderer`) — Vue 3 + hash router. `/onboarding` and `/app`. The main process picks which loads. Never sees the token, never opens a socket.

## Security

- **No client secret.** Device Code Flow + Public client. Nothing extractable from the binary.
- **Token encrypted at rest** via `safeStorage` (Windows Credential Manager). Falls back to a file with a visible warning only if encryption is unavailable.
- **Minimal scope**: `channel:read:subscriptions`. Can't post, moderate, or change anything.
- **OBS password held in memory only**, never written to disk.
- Unsigned build → SmartScreen warns on first run. Code signing (~$100–300/yr) is the fix if you want it gone.

## Test

```bash
npm test    # anchor positioning + updater prerelease logic
```

Both suites run headless (electron stubbed), no display needed.

## Before first public release

1. Register the Twitch app as **Public** type, get the client ID
2. Add `TWITCH_CLIENT_ID` repo secret
3. Replace the placeholder tray icons in `resources/` and add `build/icon.ico`
4. Confirm `appId` and the NSIS `guid` in `electron-builder.yml` — changing them later breaks in-place updates
