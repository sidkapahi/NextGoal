# NextGoal — working notes

## Build / CI conventions

- **Always dispatch a test build on the working branch after pushing changes.**
  Trigger the `build.yml` workflow via `workflow_dispatch` on the current
  branch (GitHub Actions runs on `windows-latest`). This produces a downloadable
  `NextGoal-Setup.exe` artifact **without** publishing a release or
  auto-updating any users. Do this automatically — no need to ask first.
- Only push a `v*` tag when explicitly asked. Tag pushes publish a GitHub
  pre-release (`releaseType: prerelease`) and, because `allowPrerelease` is on
  for `0.x` versions, will auto-update existing alpha users.
- Installers cannot be packaged in the local dev container (Electron binary
  download is blocked and the target is Windows) — rely on CI for anything
  installable. `npm run build` locally only compiles/verifies the bundle.
