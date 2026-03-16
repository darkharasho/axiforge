You are a feature implementation agent for the axiforge GW2 build editor Electron desktop app (repo: `darkharasho/axiforge`).

Your task: implement the feature requested in GitHub issue **#$ARGUMENTS**.

## Codebase Map

- `src/main/` — Electron main process; `src/main/gw2Data.js` fetches GW2 API data
- `src/renderer/renderer.js` — all UI logic (equipment, skills, traits, dropdowns)
- `src/renderer/styles.css` — all styles
- `tests/` — Jest test suite
- Run tests: `npm test`

## GitHub Project Board IDs

| Field | Value |
|---|---|
| Project ID | `PVT_kwHOCJlSRs4BRf9t` |
| Status field ID | `PVTSSF_lAHOCJlSRs4BRf9tzg_T1Jg` |
| "In progress" option ID | `5ef0dc97` |
| "Done" option ID | `98236657` |

## Steps

Follow these steps in order. Do not skip steps.

### Step 1 — Fetch issue + compute slug

```bash
gh api repos/darkharasho/axiforge/issues/$ARGUMENTS
```

- If the issue is not found: stop and report the error.
- If `gh` is not authenticated: stop with "Run `gh auth login` first."
- Verify the issue is an enhancement (not a bug). If it has a `bug` label, stop with "Issue is a bug — use `/fix-issue $ARGUMENTS` instead."
- Compute a **slug** from the issue title: take the first 4–5 words, lowercase, strip non-alphanumeric characters (except hyphens), hyphenate, max 40 characters.
  Example: "Add dark mode support for editor" → `add-dark-mode-support`
  Minimum 2 words. Reuse this slug unchanged throughout.

### Step 2 — Auto-label (if not already labeled)

If the issue does not already have the `enhancement` label:

```bash
gh issue edit $ARGUMENTS --repo darkharasho/axiforge --add-label enhancement
```

### Step 3 — Add to Project board + move to "In progress"

**3a. Add issue to project (idempotent — safe to run if already added):**

```bash
gh project item-add 1 --owner darkharasho \
  --url https://github.com/darkharasho/axiforge/issues/$ARGUMENTS \
  --format json
```

Capture the `id` field from the JSON response. This is the **item ID** used in 3b and Step 12.

> **Remember this item ID — you will need it again in Step 12.**

**3b. Move to "In progress":**

```bash
gh project item-edit \
  --project-id PVT_kwHOCJlSRs4BRf9t \
  --id <item-id-from-3a> \
  --field-id PVTSSF_lAHOCJlSRs4BRf9tzg_T1Jg \
  --single-select-option-id 5ef0dc97
```

### Step 4 — Post opening comment

```bash
gh issue comment $ARGUMENTS --repo darkharasho/axiforge --body "🤖 **Feature agent working on this.**
Approach: <one-line summary of planned implementation>.
Branch: \`feat/issue-$ARGUMENTS-<slug>\`. Will post results when complete."
```

### Step 5 — Explore codebase + plan approach

Use `Glob`, `Grep`, and `Read` to understand the existing code relevant to this feature.

- For UI features: start with `src/renderer/renderer.js` and `src/renderer/styles.css`
- For data/API features: start with `src/main/gw2Data.js`
- For cross-cutting features: examine both main and renderer

**Before writing any code**, present a brief implementation plan to the user:
1. What files will be modified
2. What the changes will do at a high level
3. Any design decisions or trade-offs

Ask: "Does this approach look good, or would you like me to adjust anything?"

**Wait for user confirmation before continuing to Step 6.**

### Step 6 — Create or reuse branch

Check whether the feature branch already exists remotely:

```bash
git fetch origin 2>/dev/null || true
git ls-remote --heads origin feat/issue-$ARGUMENTS-<slug>
```

- If it exists: `git checkout feat/issue-$ARGUMENTS-<slug>`
- If not: `git checkout -b feat/issue-$ARGUMENTS-<slug>`

### Step 7 — Write test coverage

Add test(s) that cover the new feature behavior. Place tests in the appropriate file under `tests/`. If no suitable file exists, create one following existing naming conventions (e.g. `tests/<module>.test.js`).

Run `npm test` to confirm the new tests fail (since the feature isn't implemented yet). If they pass already, the test isn't covering the new behavior — revise it.

### Step 8 — Implement the feature

Use `Edit` or `Write` to implement the feature. Guidelines:
- Make targeted, minimal changes
- Follow existing code patterns and conventions
- Do not refactor unrelated code
- Keep UI changes consistent with existing styles

### Step 9 — Run tests (max 2 attempts)

```bash
npm test
```

All tests (including the new ones from Step 7) must pass.
If tests fail: revise the implementation and run once more.
If they still fail after 2 attempts: go to the **Failure Path** below.

### Step 10 — Manual test checkpoint

**Stop and ask the user to manually test the feature before proceeding.**

Tell the user:
1. What was added and where
2. How to exercise the new feature
3. What they should verify is working

Then ask: "Please test this and let me know if the feature looks good, or if anything needs adjusting."

**Wait for user confirmation before continuing.** If the user reports issues, revise the implementation (go back to Step 8) and re-run tests.

### Step 11 — Commit + push

```bash
git add src/ tests/
git commit -m "feat: <issue title> (closes #$ARGUMENTS)"
git push -u origin feat/issue-$ARGUMENTS-<slug>
```

(Use the actual issue title fetched in Step 1, not the literal text `<issue title>`.)

### Step 12 — Open PR (or find existing)

Check for an existing PR on this branch:

```bash
gh pr list --repo darkharasho/axiforge \
  --head feat/issue-$ARGUMENTS-<slug> \
  --state open \
  --json url
```

- If a PR exists: capture its URL, skip `gh pr create`.
- If no PR exists:

```bash
gh pr create \
  --repo darkharasho/axiforge \
  --title "feat: <issue title> (closes #$ARGUMENTS)" \
  --body "## Summary
<one paragraph describing the feature and implementation>

Closes #$ARGUMENTS" \
  --base main \
  --head feat/issue-$ARGUMENTS-<slug>
```

Capture the PR URL.

### Step 13 — Move to "Done" + close out

Use the item ID you captured in Step 3a.

**Move to Done:**

```bash
gh project item-edit \
  --project-id PVT_kwHOCJlSRs4BRf9t \
  --id <item-id-from-step-3a> \
  --field-id PVTSSF_lAHOCJlSRs4BRf9tzg_T1Jg \
  --single-select-option-id 98236657
```

**Post closing comment:**

```bash
gh issue comment $ARGUMENTS --repo darkharasho/axiforge \
  --body "✅ **Feature implemented.** PR: <pr-url>"
```

End your response with: `PR opened: <pr-url>`

---

## Failure Path

If tests still fail after 2 attempts, or you cannot determine a viable implementation:

1. Do **not** move the issue status (leave it "In progress").
2. Push the WIP branch so it is inspectable:

```bash
git push -u origin feat/issue-$ARGUMENTS-<slug> 2>/dev/null || true
```

3. Post a comment:

```bash
gh issue comment $ARGUMENTS --repo darkharasho/axiforge \
  --body "🤖 **Could not implement automatically.**
What I tried: <summary of approaches>
Why it failed: <specific reason>"
```

4. End your response with: `Could not implement: <one-line reason>`
