---
name: build-local
description: Build axiforge locally for beta testing. Use when asked to run the repo's local beta packaging flow, including validation tests, beta version stamping, artifact builds, release creation, and Discord notification.
---

# Build Local

This skill imports the existing repo workflow from `.claude/commands/build-local.md`.

Use it when the user wants a local beta build for this repository.

## Workflow

1. Run `npm test`.
If tests fail, stop and report that the build is blocked.

2. Stamp a temporary beta version into `package.json`.
Format: `<base>-beta.YYYYMMDDTHHMM`.
Do not commit this change.

3. Clean build output directories:
- `dist/`
- `dist_out/`

4. Build artifacts in order:
- `npm run build:site`
- `npm run build:renderer`
- `npx electron-builder --linux --win --publish never`

5. If Windows packaging fails because Wine is unavailable, retry with Linux-only packaging and report that limitation.

6. Restore `package.json` after the build so the beta stamp does not remain in the working tree.

7. Create the GitHub release using the built version from artifact filenames.
Generate patch notes from commits since the last tag or initial commit if needed.

8. Read `DISCORD_WEBHOOK_URL` from `.env` and post the release summary to Discord.
If the webhook is missing, warn and continue.

9. End by listing built artifact paths, the release URL, and whether Discord was notified.

