<div align="center">

<img src="build/icon.png" alt="NextGoal" width="120" />

# NextGoal

**One sub/member goal for OBS — Twitch subs, YouTube members, and Kick subs,
combined into a single auto-incrementing counter.**

Currently in Alpha · Built with [Electron](https://www.electronjs.org/) and [Vue 3](https://vuejs.org/)

![Release](https://img.shields.io/github/v/release/sidkapahi/NextGoal?include_prereleases&label=release&color=6441a5)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6)
![Built with](https://img.shields.io/badge/built%20with-Electron%20%2B%20Vue-42b883)
![License](https://img.shields.io/badge/license-MIT-blue)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

[Install](#installation) · [For devs](#for-devs) · [Architecture](#architecture) · [Security](#security) · [Contributing](#contributing)

</div>

## Overview

NextGoal is a desktop goal tracker for live streamers. It combines **Twitch
subs, YouTube members, and Kick subs into one counter** and shows it on stream
through OBS. It starts at 0 each stream (or syncs to your current totals), and
every time you hit the goal it raises itself by your chosen increment — so
there's always a next goal.

It runs as a free-form desktop window with a tray icon for quick show/hide, and
feeds OBS over [obs-websocket](https://github.com/obsproject/obs-websocket) with
no plugin required (plus a text-file fallback). Twitch counts in **real time**
(EventSub); YouTube and Kick are polled for their current totals on an interval
(default 60s), since neither offers a practical real-time feed for a desktop
app.

**What makes NextGoal different:**

- **One counter, three platforms.** Twitch, YouTube, and Kick sub/member counts
  roll into a single number. Link whichever platforms you stream on; the ones
  you skip simply don't appear.
- **No OBS plugin.** It talks to OBS over obs-websocket and can also write a
  plain text file, so it works with any OBS setup without installing anything.
- **No client secret to leak.** Twitch uses Device Code Flow with a *Public*
  client — nothing sensitive is baked into the binary, and the access token is
  encrypted at rest.
- **Lives in the tray.** A free-form, always-available window with a one-click
  tray toggle and idle/live status icon — built to sit quietly next to OBS.

## Installation

<div align="center">

[![Download for Windows](https://img.shields.io/badge/Download%20for%20Windows-6441a5?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/sidkapahi/NextGoal/releases/latest)

**[See all releases →](https://github.com/sidkapahi/NextGoal/releases)**

</div>

1. Download the latest **`NextGoal-Setup-<version>.exe`** from the
   [latest release](https://github.com/sidkapahi/NextGoal/releases/latest).
2. Run it — it's a **one-click, per-user installer**, so no admin rights are
   needed and it installs just for you.
3. On first launch, Windows SmartScreen may warn that the app is unsigned. Click
   **More info → Run anyway** (see [Security](#security) for why that happens).
4. Open NextGoal, link your Twitch account (YouTube and Kick are optional), set
   your goal and increment, and point it at OBS.
5. After that it **updates itself** — new releases download in the background and
   install on quit.

> **Windows only** for now. Prefer to build it yourself, or on another platform?
> See [Run it](#run-it) and [Build an installer](#build-an-installer).

## For devs

### Run it

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
  an OAuth client of type **Desktop app** (Authorization Code + PKCE via a
  loopback redirect — Google auto-allows `http://localhost`, no redirect to
  register). Add the `youtube.readonly` and `youtube.channel-memberships.creator`
  scopes; the memberships one is **sensitive**, so keep the app in *Testing* mode
  and add your channel's Google account as a **test user** to use it without full
  verification. The channel must be in the Partner Program with memberships on.
  Desktop-app clients carry a client secret; for an installed app Google treats
  it as non-confidential (it ships in the binary). To drop the "unverified app"
  warning for the **public** (rather than just test users), submit the consent
  screen for [Google verification](https://support.google.com/cloud/answer/13463073)
  and publish it to *Production* — the scopes are *sensitive*, not *restricted*,
  so it's brand review only (verified domain, privacy policy, homepage, logo,
  demo video), with no paid security assessment.
- **Kick** — a Kick Developer App (OAuth 2.1 + PKCE, a **confidential** client:
  client ID **and secret**). Register `http://localhost` as an allowed redirect
  and request the `user:read`, `channel:read`, and `events:subscribe` scopes.
  Kick has no "read subscriber count" scope — sub data comes through the events
  subscription, so confirm the counting approach against the
  [Kick dev docs](https://github.com/KickEngineering/KickDevDocs).

Client IDs are public info (they ship in the built app). The YouTube and Kick
secrets are the installed-app kind treated as non-confidential.

### Build an installer

```powershell
$env:TWITCH_CLIENT_ID="your_id"
npm run dist:win
```

Produces a one-click per-user installer in `release/`. The build injects your
client ID into the bundle (`scripts/inject-client-id.mjs`) and refuses to build
without it, so you can't ship a broken app.

## Architecture

**Main process** (`src/main`)

- `index.js` — wires everything, owns app state, all IPC
- `windows.js` — one BrowserWindow: framed onboarding + free-form app window.
  Closing hides to the tray; quit from the tray menu.
- `tray.js` — left-click shows/hides the window, right-click menu, idle/live icon
- `services/`
  - `twitchAuth.js` — Device Code Flow, no client secret, single-use refresh handling
  - `tracker.js` — EventSub WebSocket, gift-bomb double-count fix
  - `obs.js` — obs-websocket: connect, list/create/set text sources
  - `config.js` — settings JSON + refresh token in Electron `safeStorage` (encrypted)
  - `goal.js` — the increment math
  - `updater.js` — electron-updater wrapper, prerelease-aware

**Preload** (`src/preload/index.js`) — the only bridge. Renderer sees
`window.ng` and nothing else. `contextIsolation` on, `nodeIntegration` off.

**Renderer** (`src/renderer`) — Vue 3 + hash router. `/onboarding` and `/app`.
The main process picks which loads. Never sees the token, never opens a socket.

### Project structure

| Directory        | Purpose                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `src/main/`      | Electron main process: app state, IPC, tray, and platform services  |
| `src/preload/`   | The single context-isolated bridge exposed to the renderer          |
| `src/renderer/`  | Vue 3 UI — onboarding, main app window, and settings                |
| `scripts/`       | Build helpers (client-ID injection) and platform auth probes        |
| `test/`          | Headless tests — anchor positioning, sources, and updater logic     |
| `build/`         | Installer icons and packaging assets                                |

## Security

- **No client secret.** Device Code Flow + Public client. Nothing extractable
  from the binary.
- **Token encrypted at rest** via `safeStorage` (Windows Credential Manager).
  Falls back to a file with a visible warning only if encryption is unavailable.
- **Minimal scope**: `channel:read:subscriptions`. Can't post, moderate, or
  change anything.
- **OBS password held in memory only**, never written to disk.
- Unsigned build → SmartScreen warns on first run. Code signing (~$100–300/yr)
  is the fix if you want it gone.

## Test

```bash
npm test    # anchor positioning + updater prerelease logic
```

Both suites run headless (electron stubbed), no display needed.

## Contributing

Contributions are welcome. To get started:

```bash
npm install
npm run dev     # hot-reload dev build (needs TWITCH_CLIENT_ID — see "Run it")
npm test        # run the headless test suites before opening a PR
```

Open an issue for bugs or ideas, and keep pull requests focused. If a change
touches platform auth, OBS output, or the updater, please note how you tested it
against the real service.

## License

[MIT](LICENSE) © Sid Kapahi
