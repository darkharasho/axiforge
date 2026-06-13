---
name: discord-feature-request
description: Read a Discord message and file it as a GitHub feature-request issue
---

# Discord Feature Request Intake

Read a single Discord message (and its images) and turn it into a structured
**enhancement** issue on `darkharasho/axiforge`, ready for `/add-feature` to pick up.

**Argument:** $ARGUMENTS

`$ARGUMENTS` is either:
- a Discord **message link** — `https://discord.com/channels/<guild>/<channel>/<message>`
  (right-click any message → *Copy Message Link*), or
- a **channel ID and message ID** separated by a space — `<channel_id> <message_id>`.

A bare message ID on its own is **not** enough — the Discord API can only fetch a
message as `/channels/{channel}/messages/{message}`, so the channel ID is required.

## Instructions

Follow these steps in order. Do not skip or reorder them.

### Step 1: Parse the input

From `$ARGUMENTS`, extract a **channel ID** and a **message ID**:

- If it contains `discord.com/channels/`, take the last two path segments: the
  second-to-last is the channel ID, the last is the message ID.
  (The first segment after `channels/` is the guild ID — ignore it.)
- Otherwise, split on whitespace: the first token is the channel ID, the second is
  the message ID.

If you cannot recover **both** a channel ID and a message ID, stop and output:

> **Error:** Usage: `/discord-feature-request <message-link>` or `/discord-feature-request <channel_id> <message_id>`. A bare message ID alone won't work — Discord needs the channel ID too.

### Step 2: Read the Discord bot token

Use the Bash tool to read the token from `.env`:

```bash
grep '^DISCORD_BOT_TOKEN=' .env | sed 's/^DISCORD_BOT_TOKEN=//' | tr -d '"' | tr -d "'"
```

If the output is empty or the file doesn't exist, stop and output:

> **Error:** No Discord bot token found. Add `DISCORD_BOT_TOKEN=<your_token>` to `.env` at the repository root.

Store the token value for the API calls below. Never print it.

### Step 3: Fetch the message

```bash
curl -s -w "\n%{http_code}" -H "Authorization: Bot <token>" \
  "https://discord.com/api/v10/channels/<channel_id>/messages/<message_id>"
```

The `-w "\n%{http_code}"` appends the HTTP status on its own line so you can check it.

Handle errors:
- **401 / 403:** Stop. Output: "Bot token is invalid or the bot lacks permission to read this channel."
- **404:** Stop. Output: "Message not found. Check the channel ID and message ID, and that the bot can see that channel."
- **429:** Read `retry_after` from the JSON body, run `sleep <retry_after>` via Bash, then retry once. If still 429, stop and report the rate limit.

From the response, capture: `content`, `author` (prefer `author.global_name`, fall
back to `author.username`), `timestamp`, `attachments`, and `embeds`.

If `content` is empty **and** there are no attachments/embeds, stop and output:

> **Warning:** That message has no text or images. Nothing to file.

### Step 4: Download and view any images

For each entry in `attachments` whose `content_type` starts with `image/`:

```bash
curl -s -o /tmp/discord_fr_<message_id>_<index>.png "<attachment_url>"
```

Then use the Read tool to view that file so you can see what it depicts. Do the same
for any `embeds[].image` or `embeds[].thumbnail` URLs. Note what each image shows —
mockups and screenshots are often the heart of a feature request.

### Step 5: Draft the feature request

Distill the message + images into an enhancement issue. Use this exact structure:

```
## Feature request (from Discord)

**Requested by:** <author display name>
**Source:** <the message link, or `channel <id> / message <id>`>

### What they want
<Clear, specific description of the requested feature. Resolve vague phrasing into
concrete behavior. If the ask is ambiguous, state the most likely interpretation and
note the ambiguity.>

### Visual references
<For each image: one line on what it shows and how it informs the feature. If none,
write "None.">

### Acceptance criteria
<2–4 bullet points describing what "done" looks like, inferred from the message.>

### Original message
> <verbatim message content>
```

Present this draft to the user and ask:

> "Here's the feature request I'd file. Want me to adjust anything, or create the issue?"

**Wait for the user to confirm before Step 6.** Apply any edits they ask for.

### Step 6: Create the GitHub issue

Preconditions — if `gh` is not authenticated, stop with "Run `gh auth login` first."

Create the issue with the `enhancement` label. Pass the body via a heredoc so
markdown and quotes survive intact:

```bash
gh issue create --repo darkharasho/axiforge \
  --title "<concise feature title>" \
  --label enhancement \
  --body "$(cat <<'EOF'
<the full drafted body from Step 5>
EOF
)"
```

Capture the issue URL from the output, and the issue **number** from the end of that URL.

### Step 7: Add to the project board

This is idempotent — safe even if somehow already added:

```bash
gh project item-add 1 --owner darkharasho \
  --url <issue-url> \
  --format json
```

If this fails (e.g. project permissions), don't abort — report that the issue was
created but couldn't be added to the board, and continue.

### Step 7.5: Link the issue back in the Discord channel

Post the issue link as a reply in the same channel the message came from, so people
watching the thread know it was captured. Reuse the bot token from Step 2 and the
channel ID from Step 1. Pipe the JSON through Python to avoid shell-escaping issues:

```bash
python3 -c "
import json, sys
sys.stdout.write(json.dumps({'content': '📝 Filed as a feature request: <issue-url>'}))
" | curl -s -w '\n%{http_code}' -X POST \
  -H 'Authorization: Bot <token>' \
  -H 'Content-Type: application/json' \
  -d @- 'https://discord.com/api/v10/channels/<channel_id>/messages'
```

If this returns 403, the bot lacks permission to post there — report it and continue;
don't abort.

### Step 8: Report and offer handoff

Output:

> ✅ Filed **#<number>** — <title>
> <issue-url>

Then ask:

> "Want me to start implementing it now with `/add-feature <number>`?"

If the user says yes, invoke `/add-feature <number>`. Otherwise stop here.
