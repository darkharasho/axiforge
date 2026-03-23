You are a release agent for the axiforge Electron desktop app.

Your task: create a new release with version bump type **$ARGUMENTS** (must be one of: `patch`, `minor`, `major`).

If `$ARGUMENTS` is empty or not one of patch/minor/major, ask the user which bump type they want.

## Steps

Follow these steps in order. Do not skip steps.

### Step 1 — Validate

1. Ensure working tree is clean: `git status --porcelain` must be empty. If not, abort: "Working tree is not clean. Commit or stash changes first."
2. Run `npm test`. If tests fail, abort: "Tests failed — fix before releasing."
3. Validate the bump type is one of: patch, minor, major.

### Step 2 — Bump version

1. Read current version from `package.json`.
2. Compute new version by bumping the requested component (patch/minor/major).
3. Edit `package.json` to set the new version string.
4. Run `npm install --package-lock-only` to update package-lock.json.

### Step 3 — Generate release notes

1. Find the most recent git tag: `git describe --tags --abbrev=0 2>/dev/null`
   - If no tag exists, use the initial commit as the range start.
2. Get the commit log since that tag: `git log <tag>..HEAD --oneline`
3. Get the diff stats: `git diff <tag>..HEAD --stat`
4. Analyze the commits and write human-readable release notes. Group changes by category:
   - **New Features** — commits starting with `feat:`
   - **Bug Fixes** — commits starting with `fix:`
   - **Other Changes** — everything else (chore, refactor, docs, etc.)

   Write 1-2 sentences per change explaining what it does from a user perspective. Skip merge commits and trivial chores.
5. Prepend to `RELEASE_NOTES.md` (create if it doesn't exist) with this format:

```
## Version v{version} — {Month Day, Year}

{release notes body}

```

### Step 4 — Clean dist directories

```bash
rm -rf dist/ dist_out/
```

### Step 5 — Build

```bash
npm run build:site && npm run build:renderer && npx electron-builder --linux --win --publish never
```

Note: `build:site` must run before electron-builder so the site bundle is included as an extra resource in the packaged app.

If the build fails, abort: "Build failed — see output above."

Note: Building Windows from Linux requires Wine. If `--win` fails due to Wine, retry with `--linux` only and warn the user.

### Step 6 — Commit, tag, and push

```bash
git add package.json package-lock.json RELEASE_NOTES.md
git commit -m "release: v{version}"
git tag v{version}
git push origin main --follow-tags
```

### Step 7 — Create GitHub release

1. Create the release with artifacts:

```bash
gh release create v{version} \
  --repo darkharasho/axiforge \
  --title "v{version}" \
  --notes-file <(head -n <lines_for_this_version> RELEASE_NOTES.md) \
  --draft \
  dist_out/*.AppImage dist_out/*.exe dist_out/*.blockmap dist_out/latest*.yml
```

2. Publish the draft:

```bash
gh release edit v{version} --repo darkharasho/axiforge --draft=false
```

### Step 8 — Report

End your response with: `Release published: <release-url>`
