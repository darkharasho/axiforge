---
name: add-feature
description: Implement a GitHub enhancement issue for the axiforge Electron app. Use when asked to work issue-driven feature requests in this repo, including triage labels, project status updates, branch/PR flow, tests, and manual verification.
---

# Add Feature

This skill imports the existing repo workflow from `.claude/commands/add-feature.md`.

Use it when the user wants Codex to implement GitHub issue `#<n>` as an enhancement in this repository.

## Workflow

1. Fetch the issue with `gh api repos/darkharasho/axiforge/issues/<n>`.
If the issue is missing, stop. If `gh` is unauthenticated, stop and tell the user to run `gh auth login`.

2. Confirm this is an enhancement, not a bug.
If the issue already has a `bug` label, stop and tell the user to use the bug-fix workflow instead.
If `enhancement` is missing, add it with `gh issue edit`.

3. Compute a stable slug from the issue title.
Use the first 4-5 words, lowercase, strip non-alphanumerics except hyphens, minimum 2 words, max 40 chars.

4. Add the issue to the GitHub project and move it to `In progress`.
Project ID: `PVT_kwHOCJlSRs4BRf9t`
Status field ID: `PVTSSF_lAHOCJlSRs4BRf9tzg_T1Jg`
In progress option ID: `5ef0dc97`
Done option ID: `98236657`
Capture the project item ID for later.

5. Post an opening issue comment with the planned approach and branch name `feat/issue-<n>-<slug>`.

6. Explore the code before editing.
Start from:
- `src/main/` for data/API work
- `src/renderer/` for UI work
- `tests/` for coverage placement

7. Present a brief implementation plan before coding:
- files to change
- high-level behavior
- key tradeoffs

8. Create or reuse branch `feat/issue-<n>-<slug>`.

9. Add tests for the requested behavior before implementing the feature.
Run the relevant test command and confirm the new test fails first when practical.

10. Implement the feature with minimal, targeted changes.

11. Run tests, fix regressions, and re-run.
Use at most two fix-and-retest cycles before reporting failure.

12. Stop for manual verification before finalizing.
Tell the user what changed, how to exercise it, and what to verify.
Wait for confirmation before proceeding.

13. Commit and push:
- `git add src/ tests/`
- `git commit -m "feat: <issue title> (closes #<n>)"`
- `git push -u origin feat/issue-<n>-<slug>`

14. Open or reuse the PR for that branch and capture the PR URL.

15. Move the project item to `Done` and post a closing issue comment with the PR URL.

16. End by reporting `PR opened: <url>`.

## Failure Path

If implementation or tests remain blocked:
- leave the project item `In progress`
- push the WIP branch if it exists
- comment on the issue with the blocker and current status

