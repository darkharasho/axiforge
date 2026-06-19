# Multiple Discord Webhooks for Comp Sharing — Design

**Date:** 2026-06-18
**Status:** Approved

## Problem

Sharing a comp to Discord currently supports exactly one webhook URL
(`discord.webhookUrl`) with a single thread configuration. Users want to share
the same embedded comp to multiple Discord destinations (e.g. a WvW guild
channel *and* a raid team channel), choosing which destinations at share time.

## Scope

- **Comps only.** Build sharing (`discord.buildWebhookUrl`) is unchanged.
- Users manage a list of named comp webhooks in settings.
- At share time, the user picks one or more of those webhooks (multi-select).

## Data Model & Storage

New setting key `discord.compWebhooks` — an array of webhook entries stored in
the existing `settings.json` (via `BuildStore.getSetting`/`setSetting`):

```js
{
  id: string,        // stable unique id (generated on add)
  name: string,      // user-facing label, e.g. "WvW Guild"
  url: string,       // Discord webhook URL
  threadMode: "none" | "auto" | "custom",
  threadId: string | null   // only when threadMode === "custom"
}
```

### Migration (lazy, main process)

A helper `getCompWebhooks()` returns the array and performs a one-time
migration:

- If `discord.compWebhooks` is present (any array, including an explicitly
  empty `[]` — a user who deleted all webhooks) → return it as-is, no
  re-migration.
- Else if legacy `discord.webhookUrl` is set → build a single entry
  `{ id, name: "Default", url: <webhookUrl>, threadMode: <discord.threadMode || "none">, threadId: <discord.threadId || null> }`,
  persist it to `discord.compWebhooks`, and return it.
- Else → return `[]`.

Legacy keys (`discord.webhookUrl`, `discord.threadMode`, `discord.threadId`)
are left in place but no longer read for comp sharing once the array exists.

## Main Process / IPC

### Helper
- `getCompWebhooks()` in the main process (near the existing discord handlers).
  Handles migration and returns the validated array.

### IPC channels
- **New** `discord:list-comp-webhooks` → returns `[{ id, name }]` for the
  share-time picker (does not leak full URLs to the picker call; the picker only
  needs id + name).
- **Changed** `discord:share-comp` signature: `(compId, webhookIds?)`.
  - If `webhookIds` is a non-empty array → post to those entries (filtered to
    ids that still exist).
  - If `webhookIds` is omitted/empty (e.g. the local-api HTTP path, which has no
    UI) → post to **all** configured comp webhooks.
  - Each selected webhook is validated (URL regex) and posted independently via
    the existing `shareCompToDiscord` core function, applying that entry's
    thread settings.
  - Returns an aggregate result:
    ```js
    { success: boolean, results: [{ id, name, success, error? }] }
    ```
    `success` is true if at least one post succeeded; per-entry results let the
    UI surface partial failures.

### Preload bridge
- `shareCompToDiscord(compId, webhookIds)` updated to pass through the optional
  `webhookIds`.
- `listCompWebhooks()` added.

## Settings UI (`src/renderer/modules/settings-modal.js`)

Replace the single comp webhook input + thread controls with a list editor:

- One row per webhook entry: name input, URL input, thread mode radios
  (none/auto/custom), thread ID input (shown for custom), and a remove button.
- An "Add webhook" button appends a new blank entry.
- Reuses the existing webhook URL regex and thread-ID validation per row.
- Auto-saves the whole array (debounced, like today) to `discord.compWebhooks`.

The build webhook section is unchanged.

## Share-time Picker (`src/renderer/modules/comps/comp-detail.js`)

When the user clicks "Share to Discord" on a comp:

- Fetch comp webhooks via `listCompWebhooks()`.
- **0 webhooks** → toast prompting the user to configure one in settings.
- **1 webhook** → post directly to it (no picker).
- **2+ webhooks** → show a popover with a multi-select checklist (all entries
  checked by default) plus a "Post" button. On Post, call
  `shareCompToDiscord(compId, selectedIds)`.
- Result toast summarizes successes/failures from the aggregate result.

## Local API

`POST /comps/:id/share-discord` continues to delegate to `discord:share-comp`
with no `webhookIds`, so it posts to **all** configured comp webhooks. No new
endpoint required.

## Testing

- Unit test `getCompWebhooks()` migration: empty → legacy seed → idempotent
  return.
- Unit test multi-webhook posting/aggregation: all-success, partial-failure,
  unknown-id filtering, empty-selection-posts-to-all.
- Existing `buildCompEmbed` / `shareCompToDiscord` tests remain green.

## Out of Scope / YAGNI

- Builds remain single-webhook.
- No per-comp remembered webhook selection (picker defaults to all-checked each
  time).
- No reordering UI for the webhook list.
