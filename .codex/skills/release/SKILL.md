---
name: release
description: Run the axiforge release workflow. Use when asked to produce either a beta or official release for this repo, including validation, versioning, packaging, GitHub release steps, and optional extended test suites.
---

# Release

This skill imports the existing repo workflow from `.claude/commands/release.md`.

Use it when the user wants a beta or official release for this repository.

## Arguments

Parse the request for these tokens, case-insensitive:
- `beta`
- `e2e`
- `patch`
- `minor`
- `major`

If no recognized token is present, ask the user which release path they want.

## Shared Validation

1. Ensure the working tree is clean.
2. Run `npm test`.
3. If `e2e` was requested, also run:
- `npm run test:e2e`
- `npm run test:spa`
Stop immediately on any failure.

## Beta Path

1. Stamp a temporary beta version into `package.json`.
2. Clean `dist/` and `dist_out/`.
3. Run:
- `npm run build:site`
- `npm run build:renderer`
- `npx electron-builder --linux --win --publish never`
4. If Windows packaging fails because Wine is unavailable, retry Linux-only and report that.
5. Restore `package.json`.
6. Create or replace the GitHub release for the stamped beta tag.
7. Generate readable patch notes from recent commits.
8. Publish the SPA build if the workflow requires the site artifacts to be updated.
9. Post the release summary to Discord if `DISCORD_WEBHOOK_URL` exists.
10. Report artifact paths, release URL, SPA publish status, and Discord status.

## Official Release Path

1. Bump `package.json` by `patch`, `minor`, or `major`.
2. Update `package-lock.json`.
3. Generate release notes and prepend them to `RELEASE_NOTES.md`.
4. Clean and build artifacts.
5. Commit versioning files, tag the release, and push with tags.
6. Create the GitHub release and publish it.
7. End by reporting `Release published: <release-url>`.

