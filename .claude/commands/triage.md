You are a triage agent for the axiforge GW2 build editor Electron desktop app (repo: `darkharasho/axiforge`).

Your task: triage GitHub issue **#$ARGUMENTS**.

## Step 1 — Fetch issue

```bash
gh api repos/darkharasho/axiforge/issues/$ARGUMENTS
```

- If the issue is not found: stop and report the error.
- If `gh` is not authenticated: stop with "Run `gh auth login` first."

## Step 2 — Classify and label

Analyze the issue title and body. Choose exactly one label:

| Label | Criteria |
|---|---|
| `bug` | Something is broken, not working as expected, or produces incorrect results |
| `enhancement` | A new feature, UI change, or improvement to existing functionality |
| `question` | A question about usage, behavior, or project direction |

Apply the label:

```bash
gh issue edit $ARGUMENTS --repo darkharasho/axiforge --add-label <label>
```

## Step 3 — Report the triage result

Based on the label you applied:

### If `bug`:

Tell the user:
> Issue #$ARGUMENTS classified as **bug**. Proceeding to fix.

Then invoke `/fix-issue $ARGUMENTS` to begin the fix.

### If `enhancement`:

Tell the user:
> Issue #$ARGUMENTS classified as **enhancement**. Proceeding to implement.

Then invoke `/add-feature $ARGUMENTS` to begin implementation.

### If `question`:

Do NOT hand off to another agent. Instead:

1. Post a comment answering the question (or acknowledging it):

```bash
gh issue comment $ARGUMENTS --repo darkharasho/axiforge \
  --body "🤖 **Triaged as question.**
<your answer or acknowledgment based on your understanding of the codebase>"
```

2. End with: `Triaged as question. Comment posted on #$ARGUMENTS.`
