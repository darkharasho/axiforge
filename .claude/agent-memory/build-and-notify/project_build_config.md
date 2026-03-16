---
name: axiforge build configuration
description: Build system, commands, output paths, and artifact naming conventions for AxiForge Electron app
type: project
---

Build system is electron-builder (v26) with Vite as the renderer bundler.

**Build commands (per build-local.md):**
- Both platforms in one pass: `npm run build:renderer && npx electron-builder --linux --win --publish never`
- Linux only: `npm run build:app:linux`
- Windows only: `npm run build:app:win`

**Beta version stamping (required before build):** Use the inline node script from build-local.md to write a `0.1.0-beta.YYYYMMDDTHHmm` version into `package.json`, then restore with `git checkout package.json` after the build completes.

**Output directory:** `dist_out/` (configured via `build.directories.output` in package.json)

**Artifact naming pattern:** `AxiForge-${version}.${ext}` — beta example: `AxiForge-0.1.0-beta.20260313T1823.AppImage` and `AxiForge-0.1.0-beta.20260313T1823.exe`

**Renderer output:** `dist/renderer/` (not `dist_out/`)

**Last build marker:** `.last-build-commit` in project root — stores the full commit SHA of HEAD at build time. Updated after every successful build.

**GitHub release:** Created with `gh release create v{version} --repo darkharasho/axiforge --title v{version} --notes "{notes}" --latest dist_out/*.AppImage dist_out/*.exe dist_out/*.blockmap dist_out/latest*.yml`

**Discord posting:** Post text-only via JSON payload (`content` field). Use `python3 -c "import json; ..."` to generate payload to a temp file, then pass with `curl -d @/tmp/discord_payload.json`. Do NOT use Python's `urllib.request.urlopen` — it returns HTTP 403 even with a valid webhook (curl returns 204 for the same URL). Artifacts are too large to attach (see discord limits memory).

**Last build:** v0.1.0-beta.20260315T1844 built 2026-03-15. Last build commit: 9bae08ecbd8293059e6d1aa75158a20324bec6da.

**Why:** Electron-builder targets are linux AppImage and win nsis. Wine on Linux handles Windows cross-compilation.

**How to apply:** Follow build-local.md exactly: validate, stamp, clean, build both platforms, restore, create GitHub release, post Discord text with release URL, update .last-build-commit.
