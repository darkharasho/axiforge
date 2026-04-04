You are a release agent for the axiforge Electron desktop app.

## Argument Parsing

Parse `$ARGUMENTS` for the following tokens (order doesn't matter, case-insensitive):

- **`beta`** — if present, do a beta release (timestamped version, CI builds artifacts)
- **`e2e`** — if present, run e2e and SPA test suites in addition to unit tests
- **`patch`**, **`minor`**, **`major`** — version bump type (only for non-beta releases)

Examples:
- `/release beta` → beta release, unit tests only
- `/release beta e2e` → beta release, all tests
- `/release patch` → official release, unit tests only
- `/release patch e2e` → official release, all tests
- `/release` → ask the user what they want (beta or bump type)

If no recognized tokens are found, ask the user.

---

## Step 1 — Validate

1. Ensure working tree is clean: `git status --porcelain` must be empty. If not, abort: "Working tree is not clean. Commit or stash changes first."
2. Ensure on main branch: `git branch --show-current` must be `main`. If not, abort: "Must be on the main branch to release."
3. Run tests:
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

This produces a version like `0.1.0-beta.20260313T1530`.

### Step 3B — Generate patch notes

1. Get commits since the last tag (or last build commit):
   ```bash
   git log $(cat .last-build-commit 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --oneline
   ```
2. Analyze commits and write human-readable patch notes grouped by category:
   - **New Features** — commits starting with `feat:`
   - **Bug Fixes** — commits starting with `fix:`
   - **Improvements** — commits starting with `refactor:`, `perf:`, `style:`
   - **Other Changes** — everything else (skip merge commits and trivial chores)

### Step 4B — Commit, tag, and push

Read the stamped version from `package.json`, then:

```bash
VERSION=$(node -p "require('./package.json').version")
git add package.json
git commit -m "release: v${VERSION}"
git tag "v${VERSION}"
git push
git push --tags
```

### Step 5B — Create draft release

Create a draft GitHub release with the patch notes. CI will attach artifacts and publish it.

```bash
gh release create v{VERSION} \
  --repo darkharasho/axiforge \
  --title "v{VERSION}" \
  --draft \
  --notes "{patch_notes}"
```

Use a heredoc for the notes body to preserve formatting.

### Step 6B — Save build commit

```bash
git rev-parse HEAD > .last-build-commit
```

### Step 7B — Restore base version

Restore `package.json` to the base version (without the beta timestamp) so the working tree stays clean for development:

```bash
git checkout HEAD~1 -- package.json
git commit -m "chore: restore base version after beta"
git push
```

### Step 8B — Report

Tell the user:
1. The beta version that was tagged
2. That GitHub Actions is now building artifacts for Linux and Windows
3. The release URL:
   ```bash
   gh release view v{VERSION} --json url --jq '.url'
   ```
4. The Actions run link:
   ```bash
   gh run list --workflow=release.yml --limit=1 --json url --jq '.[0].url'
   ```
5. That the CI workflow will automatically:
   - Build Linux AppImage and Windows NSIS installer
   - Attach them to the draft release
   - Publish the release (mark as non-draft) once all builds succeed
   - Post to Discord (if `DISCORD_WEBHOOK_URL` is configured as a repository variable)

---

## Official Release Path (if `patch`, `minor`, or `major` is present)

### Step 2R — Bump version

1. Read current version from `package.json`.
2. Compute new version by bumping the requested component (strip any existing pre-release suffix first).
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
   - **Other Changes** — everything else (skip internal-only changes like `chore`, `ci`, `docs`, `test`, `build`, `release`)
5. Rewrite each entry in plain, user-facing language. Strip conventional commit prefixes. Describe changes from the user's perspective.
6. Prepend to `RELEASE_NOTES.md` (create if it doesn't exist):

```
## Version v{version} — {Month Day, Year}

{release notes body}

```

### Step 4R — Commit, tag, and push

```bash
git add package.json package-lock.json RELEASE_NOTES.md
git commit -m "release: v{version}"
git tag v{version}
git push
git push --tags
```

### Step 5R — Create draft release

```bash
gh release create v{version} \
  --repo darkharasho/axiforge \
  --title "v{version}" \
  --draft \
  --notes "{release_notes}"
```

Use a heredoc for the notes body to preserve formatting.

### Step 6R — Report

Tell the user:
1. The version that was released
2. That GitHub Actions is now building artifacts for Linux and Windows
3. The release URL:
   ```bash
   gh release view v{version} --json url --jq '.url'
   ```
4. The Actions run link:
   ```bash
   gh run list --workflow=release.yml --limit=1 --json url --jq '.[0].url'
   ```
5. That the CI workflow will automatically:
   - Build Linux AppImage and Windows NSIS installer
   - Attach them to the draft release
   - Publish the release (mark as non-draft) once all builds succeed
   - Post to Discord (if `DISCORD_WEBHOOK_URL` is configured as a repository variable)

---

## Error Recovery

- If `git push` fails, the commit and tag are local only. Tell the user they can retry with `git push && git push --tags`.
- If `gh release create` fails, the tag is already pushed. Tell the user they can create the release manually on GitHub.
- If the CI workflow fails, the draft release exists but has no/partial artifacts. Tell the user to check the Actions tab and re-run failed jobs.
