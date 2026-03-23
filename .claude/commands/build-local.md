You are a build agent for the axiforge Electron desktop app.

Your task: build the app locally for beta testing. No git tag.

## Steps

### Step 1 — Validate

Run `npm test`. If tests fail, abort: "Tests failed — fix before building."

### Step 2 — Stamp beta version

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

This produces a version like `0.1.0-beta.20260313T1530`. Do NOT commit this change — it is a local-only build stamp.

### Step 3 — Clean dist directories

```bash
rm -rf dist/ dist_out/
```

### Step 4 — Build

```bash
npm run build:site && npm run build:renderer && npx electron-builder --linux --win --publish never
```

Note: `build:site` must run before electron-builder so the site bundle is included as an extra resource in the packaged app. Building Windows from Linux requires Wine. If `--win` fails due to Wine, retry with `--linux` only and note this in the output.

### Step 5 — Restore version

Reset `package.json` so the stamped version doesn't linger in the working tree:

```bash
git checkout package.json
```

### Step 6 — Create GitHub Release

1. Read the version from the built artifact filenames (the stamped beta version, e.g., `0.1.0-beta.20260313T1530`).
2. Use the version as the tag, prefixed with `v` (e.g., `v0.1.0-beta.20260313T1530`).
3. Generate patch notes from commits since the last tag (or all commits if no prior tag):
   ```bash
   git log $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --oneline
   ```
4. Create a GitHub release with the built artifacts attached:
   ```bash
   gh release create v{version} \
     --repo darkharasho/axiforge \
     --title "v{version}" \
     --notes "{patch_notes}" \
     --latest \
     dist_out/*.AppImage dist_out/*.exe dist_out/*.blockmap dist_out/latest*.yml
   ```
5. If a release with that tag already exists, delete it first with `gh release delete v{version} --repo darkharasho/axiforge --yes` and re-run the `gh release create`, also delete the old tag with `git tag -d v{version}; git push origin :refs/tags/v{version}` before recreating.

### Step 7 — Post to Discord

Read `DISCORD_WEBHOOK_URL` from the `.env` file. Post the GitHub release URL and patch notes to Discord using the webhook:

```bash
curl -H "Content-Type: application/json" \
  -d '{"content": "**AxiForge v{version}** released!\n\n{patch_notes}\n\nDownload: https://github.com/darkharasho/axiforge/releases/tag/v{version}"}' \
  "$DISCORD_WEBHOOK_URL"
```

Use proper JSON escaping for the patch notes content. Keep the message concise — include the version, a brief summary of changes, and the release link.

### Step 8 — Report

End your response with the full paths of each artifact, the GitHub release URL, and confirmation that Discord was notified, e.g.:

```
Build complete:
  Linux: dist_out/AxiForge-0.1.0-beta.20260313T1530.AppImage
  Windows: dist_out/AxiForge-0.1.0-beta.20260313T1530.exe
  Release: https://github.com/darkharasho/axiforge/releases/tag/v0.1.0-beta.20260313T1530
  Discord: notified
```

If only one platform was built, list only that one.
