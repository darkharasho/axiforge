You are a release agent for the axiforge Electron desktop app.

## Argument Parsing

Parse `$ARGUMENTS` for the following tokens (order doesn't matter, case-insensitive):

- **`beta`** — if present, do a beta build (timestamped version, no git tag commit, Discord + SPA publish)
- **`e2e`** — if present, run e2e and SPA test suites in addition to unit tests
- **`patch`**, **`minor`**, **`major`** — version bump type (only for non-beta releases)

Examples:
- `/release beta` → beta build, unit tests only
- `/release beta e2e` → beta build, all tests
- `/release patch` → official release, unit tests only
- `/release patch e2e` → official release, all tests
- `/release` → ask the user what they want (beta or bump type)

If no recognized tokens are found, ask the user.

---

## Step 1 — Validate

1. Ensure working tree is clean: `git status --porcelain` must be empty. If not, abort: "Working tree is not clean. Commit or stash changes first."
2. Run tests:
   - **Always:** `npm test` (unit/integration tests — fast, catches obvious breaks)
   - **Only if `e2e` flag is present:**
     - `npm run test:e2e` (Electron end-to-end tests)
     - `npm run test:spa` (SPA Playwright tests)
   - Run them in this order. If any suite fails, stop immediately and report which tests failed. Do not proceed.

---

## Beta Path (if `beta` flag is present)

### Step 2B — Stamp beta version

Generate a timestamped beta version and write it to `package.json`:

```bash
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const base = pkg.version.replace(/-.*$/, '');
const now = new Date();
const ts = now.getFullYear().toString()
  + String(now.getMonth()+1).padStart(2,'0')
  + String(now.getDate()).padStart(2,'0')
  + 'T'
  + String(now.getHours()).padStart(2,'0')
  + String(now.getMinutes()).padStart(2,'0');
pkg.version = base + '-beta.' + ts;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('Version stamped: ' + pkg.version);
"
```

This produces a version like `0.1.0-beta.20260313T1530`. Do NOT commit this change.

### Step 3B — Clean and Build

```bash
rm -rf dist/ dist_out/
npm run build:site && npm run build:renderer && npx electron-builder --linux --win --publish never
```

Note: `build:site` must run before electron-builder so the site bundle is included as an extra resource. Building Windows from Linux requires Wine. If `--win` fails due to Wine, retry with `--linux` only and note this in the output.

### Step 4B — Restore version

```bash
git checkout package.json
```

### Step 5B — Create GitHub Release

1. Read the version from the built artifact filenames (the stamped beta version).
2. Use the version as the tag, prefixed with `v` (e.g., `v0.1.0-beta.20260313T1530`).
3. Generate patch notes from commits since the last tag (or last build commit in `.last-build-commit`):
   ```bash
   git log $(cat .last-build-commit 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --oneline
   ```
4. Analyze commits and write human-readable patch notes grouped by category:
   - **New Features** — commits starting with `feat:`
   - **Bug Fixes** — commits starting with `fix:`
   - **Improvements** — commits starting with `refactor:`, `perf:`, `style:`
   - **Other Changes** — everything else (skip merge commits and trivial chores)
5. Create the GitHub release:
   ```bash
   gh release create v{version} \
     --repo darkharasho/axiforge \
     --title "v{version}" \
     --notes "{patch_notes}" \
     --latest \
     dist_out/*.AppImage dist_out/*.exe dist_out/*.blockmap dist_out/latest*.yml
   ```
   If a release with that tag already exists, delete it first with `gh release delete v{version} --repo darkharasho/axiforge --yes` and also delete the old tag with `git tag -d v{version}; git push origin :refs/tags/v{version}` before recreating.
6. Save current HEAD to `.last-build-commit`:
   ```bash
   git rev-parse HEAD > .last-build-commit
   ```

### Step 6B — Publish SPA to GitHub Pages

The Electron build already runs `npm run build:site` which outputs the SPA to `dist/site/`.

1. Compare deployed assets vs newly built assets:
   ```bash
   gh api repos/gw2eww/axibuilds/contents/site/assets --jq '.[].name'
   ls dist/site/assets/
   ```
2. If filenames differ, push the updated SPA to the `axibuilds` repo:
   - Get current HEAD SHA: `gh api repos/gw2eww/axibuilds/git/ref/heads/main --jq '.object.sha'`
   - Get current tree SHA: `gh api repos/gw2eww/axibuilds/git/commits/<HEAD_SHA> --jq '.tree.sha'`
   - For each changed file in `dist/site/` (index.html, 404.html, assets/*), create blobs and build tree entries.
   - **Important:** Use Python to write blob JSON files (base64 content) to temp files, then create blobs via `curl -d @/tmp/blob_X.json`. Do NOT use shell variable expansion for base64 content — it hits "Argument list too long" for large JS files.
   - Create a new tree (with base_tree, using null sha entries to delete old files), commit, and PATCH the ref.
3. If asset filenames haven't changed, skip this step.

### Step 7B — Post to Discord

1. Read `DISCORD_WEBHOOK_URL` from `.env`. If missing, warn the user and skip Discord.
2. Post text-only (artifacts are too large to attach — AppImage ~177 MB, EXE ~155 MB):
   ```bash
   python3 -c "import json; ..." > /tmp/discord_payload.json
   curl -H "Content-Type: application/json" -d @/tmp/discord_payload.json "$DISCORD_WEBHOOK_URL"
   ```
   - Use Python to generate the JSON payload to a temp file, then curl it. Do NOT use Python's `urllib.request.urlopen` — it returns HTTP 403.
   - If patch notes exceed 2000 characters (Discord limit), split into two sequential posts.
   - Include the version, patch notes summary, and GitHub release download link.
3. Verify HTTP 204 response.

### Step 8B — Report

```
Build complete:
  Linux: dist_out/AxiForge-{version}.AppImage
  Windows: dist_out/AxiForge-{version}.exe
  Release: https://github.com/darkharasho/axiforge/releases/tag/v{version}
  SPA: published / unchanged
  Discord: notified / skipped
```

---

## Official Release Path (if `patch`, `minor`, or `major` is present)

### Step 2R — Bump version

1. Read current version from `package.json`.
2. Compute new version by bumping the requested component.
3. Edit `package.json` to set the new version string.
4. Run `npm install --package-lock-only` to update package-lock.json.

### Step 3R — Generate release notes

1. Find the most recent git tag: `git describe --tags --abbrev=0 2>/dev/null`
   - If no tag exists, use the initial commit as the range start.
2. Get the commit log since that tag: `git log <tag>..HEAD --oneline`
3. Get the diff stats: `git diff <tag>..HEAD --stat`
4. Analyze commits and write human-readable release notes grouped by:
   - **New Features** — `feat:`
   - **Bug Fixes** — `fix:`
   - **Other Changes** — everything else
5. Prepend to `RELEASE_NOTES.md` (create if it doesn't exist):

```
## Version v{version} — {Month Day, Year}

{release notes body}

```

### Step 4R — Clean and Build

```bash
rm -rf dist/ dist_out/
npm run build:site && npm run build:renderer && npx electron-builder --linux --win --publish never
```

If `--win` fails due to Wine, retry with `--linux` only and warn the user.

### Step 5R — Commit, tag, and push

```bash
git add package.json package-lock.json RELEASE_NOTES.md
git commit -m "release: v{version}"
git tag v{version}
git push origin main --follow-tags
```

### Step 6R — Create GitHub release

```bash
gh release create v{version} \
  --repo darkharasho/axiforge \
  --title "v{version}" \
  --notes-file <(head -n <lines_for_this_version> RELEASE_NOTES.md) \
  --draft \
  dist_out/*.AppImage dist_out/*.exe dist_out/*.blockmap dist_out/latest*.yml
```

Publish the draft:
```bash
gh release edit v{version} --repo darkharasho/axiforge --draft=false
```

### Step 7R — Report

End your response with: `Release published: <release-url>`
