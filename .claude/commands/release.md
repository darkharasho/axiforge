You are a release agent for the axiforge Electron desktop app.

## Argument Parsing

Parse `$ARGUMENTS` for the following tokens (order doesn't matter, case-insensitive):

- **`e2e`** — if present, run e2e and SPA test suites in addition to unit tests
- **`patch`**, **`minor`**, **`major`** — version bump type

Examples:
- `/release patch` → patch release, unit tests only
- `/release minor e2e` → minor release, all tests
- `/release` → ask the user what bump type they want

If no recognized bump type is found, ask the user.

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

## Step 2 — Bump version

1. Read current version from `package.json`.
2. Compute new version by bumping the requested component.
3. Edit `package.json` to set the new version string.
4. Run `npm install --package-lock-only` to update package-lock.json.

## Step 3 — Generate release notes

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

## Step 4 — Commit, tag, and push

```bash
git add package.json package-lock.json RELEASE_NOTES.md
git commit -m "release: v{version}"
git tag v{version}
git push
git push --tags
```

## Step 5 — Create draft release

```bash
gh release create v{version} \
  --repo darkharasho/axiforge \
  --title "v{version}" \
  --draft \
  --notes "{release_notes}"
```

Use a heredoc for the notes body to preserve formatting.

## Step 6 — Report

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
