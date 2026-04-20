---
name: fix-issue
description: Fix a GitHub bug issue for the axiforge Electron app. Use when asked to resolve issue-driven bugs in this repo with labels, project tracking, repro tests, branch/PR flow, and manual verification.
---

# Fix Issue

This skill imports the existing repo workflow from `.claude/commands/fix-issue.md`.

Use it when the user wants Codex to fix GitHub issue `#<n>` in this repository.

## Workflow

1. Fetch the issue with `gh api repos/darkharasho/axiforge/issues/<n>`.
If the issue is missing, stop. If `gh` is unauthenticated, stop and tell the user to run `gh auth login`.

2. Classify the issue and apply exactly one label: `bug`, `enhancement`, or `question`.
If the chosen label is not `bug`, stop after labeling and tell the user the issue is not a bug.

3. Compute a stable slug from the title.
Use the first 4-5 words, lowercase, strip non-alphanumerics except hyphens, minimum 2 words, max 40 chars.

4. Add the issue to the GitHub project and move it to `In progress`.
Project ID: `PVT_kwHOCJlSRs4BRf9t`
Status field ID: `PVTSSF_lAHOCJlSRs4BRf9tzg_T1Jg`
In progress option ID: `5ef0dc97`
Done option ID: `98236657`
Capture the project item ID for later.

5. Post an opening issue comment with the current hypothesis and branch name `fix/issue-<n>-<slug>`.

6. Explore the code to identify root cause before editing.
Start from:
- `src/renderer/` for UI bugs
- `src/main/` for data/API bugs
- `tests/` for repro coverage

7. Create or reuse branch `fix/issue-<n>-<slug>`.

8. Add a repro test before implementing the fix.
The test should fail before the fix and pass afterward.

**For math/balance/number bugs:** use fixture-based tests backed by real GW2 API data
rather than hand-crafted mocks. The fixture system is at
`packages/gw2-data/tests/fixtures/` — add the relevant skill/trait IDs to `capture.js`
and run it to capture live data. Assert expected values using wiki-verified constants
(add named variables like `const SMASH_BRAWLER_CRIT_WVW = 5; // wiki-verified`).
This makes the test self-documenting and removes the need for manual verification.

9. Implement the minimal fix without unrelated refactors.

10. Run tests, revise if needed, and re-run.
Use at most two fix-and-retest cycles before reporting failure.

11. Commit and push:
- `git add src/ tests/ packages/`
- `git commit -m "fix: <issue title> (closes #<n>)"`
- `git push -u origin fix/issue-<n>-<slug>`

12. Open or reuse the PR for that branch and capture the PR URL.

13. Manual verification checkpoint.

**For math/balance bugs with fixture-backed tests:** skip manual testing.
The fixture data comes from the live GW2 API and wiki-verified constants prove
the expected values are correct. Proceed directly to step 14.

**For UI/interaction bugs:** stop and ask the user to manually test.
Tell the user what changed, how to reproduce the original bug, what to verify now, and include the PR URL.
Wait for confirmation before proceeding.

14. After confirmation (or immediately for fixture-backed math bugs), merge the PR,
switch back to `main`, update the project item to `Done`, and post the closing issue comment.

15. End by reporting `Merged: <url> - on main.`

## Failure Path

If root cause is still unclear or tests remain blocked:
- leave the project item `In progress`
- push the WIP branch if it exists
- comment on the issue with the blocker and current status

