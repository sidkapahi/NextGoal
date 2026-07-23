# NextGoal

An auto-incrementing sub/member goal for OBS that **combines Twitch subs,
YouTube members, and Kick subs into one counter**. Starts at 0 each stream (or
syncs to your current totals); every time you hit the goal it raises itself by
your chosen increment. Built with Electron + Vue, runs as a free-form desktop
window with a tray icon for quick show/hide, feeds OBS over obs-websocket (no
plugin) with a text-file fallback.

Twitch counts in real time (EventSub); YouTube and Kick are polled for their
current totals on an interval (default 60s), since neither offers a practical
real-time feed for a desktop app.

## Run it

```bash
npm install
npm run dev          # launches Electron with hot reload
```

For local dev, each platform login needs its own client credentials, passed as
env vars. Twitch is required; YouTube and Kick are optional (leave them out and
that platform just can't be linked):

```bash
# bash
TWITCH_CLIENT_ID=... \
YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... \
KICK_CLIENT_ID=... KICK_CLIENT_SECRET=... \
npm run dev
```

- **Twitch** — register a **Public** client at
  [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps), redirect
  `http://localhost`, category Broadcasting Suite. Scope: `channel:read:subscriptions`.
- **YouTube** — a Google Cloud project with **YouTube Data API v3** enabled and
  an OAuth client (TV & Limited-Input Devices). The `members.list` API needs the
  **restricted `youtube.channel-memberships.creator` scope**, which Google gates
  behind an allowlist — request access from your YouTube representative. The
  channel must be in the Partner Program with memberships on. Google's device
  flow needs a client secret; for an installed app it is treated as
  non-confidential and ships in the binary.
- **Kick** — a Kick Developer App (OAuth 2.1 + PKCE, a **confidential** client:
  client ID **and secret**). Register `http://localhost` as an allowed redirect
  and request the `user:read`, `channel:read`, and `events:subscribe` scopes.
  Kick has no "read subscriber count" scope — sub data comes through the events
  subscription, so confirm the counting approach against the
  [Kick dev docs](https://github.com/KickEngineering/KickDevDocs).

Client IDs are public info (they ship in the built app). The YouTube and Kick
secrets are the installed-app kind treated as non-confidential.

## Build an installer

```bash
$env:TWITCH_CLIENT_ID="your_id"
npm run dist:win
```

Produces a one-click per-user installer in `release/`. The build injects your client ID into the bundle (`scripts/inject-client-id.mjs`) and refuses to build without it, so you can't ship a broken app.

## Release (auto-update)

Add the client credentials as **repository secrets** (`TWITCH_CLIENT_ID` is
required; `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `KICK_CLIENT_ID` are
optional — the build injects whichever are present), then:

```bash
# bump version in package.json first
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions builds on Windows and publishes to Releases. `electron-updater` downloads new versions in the background and installs on quit. Alpha builds (0.x or `-alpha` tags) receive prereleases; stable builds only get stable.

## Architecture

**Main process** (`src/main`)
- `index.js` — wires everything, owns app state, all IPC
- `windows.js` — one BrowserWindow: framed onboarding + free-form app window. Closing hides to the tray; quit from the tray menu.
- `tray.js` — left-click shows/hides the window, right-click menu, idle/live icon
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
