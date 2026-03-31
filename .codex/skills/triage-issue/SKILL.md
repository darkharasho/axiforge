---
name: triage-issue
description: Triage a GitHub issue in the axiforge repo. Use when asked to classify an issue as bug, enhancement, or question before deeper work.
---

# Triage Issue

This skill imports the existing repo workflow from `.claude/commands/triage.md`.

Use it when the user wants Codex to classify GitHub issue `#<n>`.

## Workflow

1. Fetch the issue with `gh api repos/darkharasho/axiforge/issues/<n>`.
If the issue is missing, stop. If `gh` is unauthenticated, stop and tell the user to run `gh auth login`.

2. Classify the issue as exactly one of:
- `bug`
- `enhancement`
- `question`

3. Apply that label with `gh issue edit`.

4. Report the result based on the chosen label:
- `bug`: tell the user it was classified as `bug` and recommend `fix-issue` as the next step if they want implementation work
- `enhancement`: tell the user it was classified as `enhancement` and recommend `add-feature` as the next step if they want implementation work
- `question`: answer or acknowledge the question in a GitHub comment and stop

5. Stop after triage unless the user explicitly asks for follow-up work. Do not automatically invoke `fix-issue`, `add-feature`, or `release`.
