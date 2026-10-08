# Publish on Save — Design

**Date:** 2026-10-07
**Status:** Approved in conversation; awaiting written-spec review
**Builds on:** payload v2, viewer guard (042d633d), background format migration (9c39af11)

## Goal

Saving a build or comp publishes it. Shared links always show the most recently saved version within seconds, without the user pressing Publish. The Publish button turns into a "Copy link" button that shows publish status.

## Decisions

| # | Question | Decision |
|---|---|---|
| Q1 | What does saving publish? | **Everything**, including items that have never been published. |
| Q2 | Existing unpublished library | **A one-time prompt** offers to bulk-publish, in batches. If it is declined, items publish on their next save, and unpublished items can still be published manually from their button. |
| Q3 | Publish button | **Becomes "Copy link"** with status (up to date / publishing / waiting). It turns into "Retry" on failure and reads "Set up publishing" when not connected. The comp board header gets the same button. |
| Q4 | Build published by another owner | **A one-time prompt per build** on first save. "Publish my copy" moves the link to the user's account; "Keep theirs" means the build is never auto-published. The answer is remembered. |
| Freshness | How fresh links avoid the about 5-minute raw CDN lag | **The viewer resolves the latest commit SHA** through the GitHub API and reads raw files pinned to that SHA. It falls back to `/main/`. |
| Defaults | | Not signed in: saves stay local and publish once connected. Debounce: 5 s quiet, 30 s maximum. |

## Current state (relevant facts)

- **Builds** save explicitly (`saveCurrentBuild`, renderer.js; IPC `builds:save`). **Comps** save on every board mutation (`saveAndSync`, comp-detail.js; IPC `comps:save`), with notes debounced at 300 ms.
- **Publishing:**
  - `enqueuePublish` (index.js) is a global promise chain that serializes publishes but doesn't coalesce them.
  - `publishBuildImpl` and `publishCompImpl` each produce one commit through `publishSiteBundle` (githubApi.js; Git Data API, PATCH ref with `force:false`, 4x retry on non-fast-forward).
  - `pollUrlLive` polls the `/main/` raw URL. It falsely passes on a republish because the old file already returns 200. The comp path doesn't poll.
- **Viewer:** reads `.enc` from `raw.githubusercontent.com/<owner>/<repo>/main/site/` (`resolveDataBase` in src/site/rawBase.js; comp-members.js). Nothing is pinned to a commit.
- **Deploys:** every push to main triggers `deploy-pages.yml` (`concurrency: pages`, `cancel-in-progress: false`).
- **Errors:** `apiFetch` already tags `GITHUB_RATE_LIMITED` (with `retryAfterMs`) and `GITHUB_UNAUTHORIZED`, but nothing in the publish path reads them.
- **Not affected:** the web Playground doesn't publish.

## Architecture

### 1. Publish queue (main process, new `src/main/publishQueue.js`)

- **Input:**
  - `enqueue({ kind: "build" | "comp", id })` is called from the `builds:save` and `comps:save` handlers after the save succeeds.
  - Saves that don't change the content fingerprint (from `publishState.js`) aren't enqueued.
- **Pending set:**
  - The queue keeps a pending set keyed by `kind:id`, persisted to `userData/publish-queue.json` on every change.
  - On launch the persisted set is loaded and a round is scheduled.
- **Debounce:**
  - A round starts 5 s after the last enqueue, and no later than 30 s after the first enqueue since the previous round.
  - This uses the same pattern as Team Sync's `scheduleFlush`, with `FLUSH_DEBOUNCE_MS` and `FLUSH_MAX_DELAY_MS`.
- **Round:**
  1. Snapshot the pending items and group them by publish owner (`resolvePublishTarget`).
  2. For each owner, take up to 50 items and run one batch publish, which makes one commit.
  3. On success, remove exactly the items that were uploaded.
  4. Items enqueued during the round stay pending and trigger the next round. If more than 50 items are pending, rounds run back to back.
- **Serialization:** rounds run one at a time through the existing `enqueuePublish` chain, so a manual Retry or a local API call can't race a round.
- **Waiting on a publish:**
  - `awaitPublished(kind, id, { timeoutMs })` resolves when a round containing the item finishes. It is used by Discord share and the local API.
  - It rejects with the item's error if the item failed.
- **Events:**
  - The queue emits `publish:status` events to the renderer with `{ kind, id, state, error?, retryAt? }`.
  - States: `queued | publishing | current | waiting | failed | unauthorized | declined | disconnected`.

### 2. Batch publish routine

`publishBundleImpl(owner, items)` replaces the bodies of `publishBuildImpl` and `publishCompImpl`. Those functions remain as thin wrappers that enqueue and await.

1. `ensurePublishInfra(owner)` (cached).
2. `buildSpaBundle` once per round, and only when the viewer changed.
3. Prepare each item:
   - Builds go through `enrichBuildForPublish`, comps through the comp path.
   - Each item produces its `.enc` file(s) and `site/r/<fileId>/index.html`.
   - A comp's linked members are collected into one map, so a member shared by several comps (or also queued itself) is uploaded once.
   - If an item fails to prepare, it is marked `failed` with its error and the rest continue.
4. `addFormatMigrations` as today.
5. One `publishSiteBundle` call, which makes one commit, with its existing non-fast-forward retry. It already returns `{ commitSha, changed, shellChanged }`. When `changed` is false, `commitSha` is the current head, which already serves the content.
6. Stamp a per-item receipt (`markPublished`) with the content hash of **the snapshot that was uploaded**. An edit made during the upload therefore stays stale and is already queued for the next round.
7. Run the live check (section 4).

### 3. Ownership and choice

- **`publishChoice` field:**
  - A build whose receipt names an owner other than the resolved target owner needs `publishChoice` (`"mine" | "theirs"`), stored on the build.
  - The queue doesn't enqueue such a build until the field is set.
  - The first save without it asks the renderer to show the foreign-owner prompt.
- **`"mine"`:** publishes with `force: true` to the user's own target.
- **`"theirs"`:** the build is never enqueued, and its state is `declined`.
- **Team builds** whose target is the team's `publishOwner` are not foreign.

### 4. Live check pinned to the commit

- **Data files:** after a commit, poll one uploaded `.enc` at `raw.githubusercontent.com/<owner>/axibuilds/<newSha>/site/...` (3 s interval, 90 s timeout).
  - A commit-pinned URL can't return an older file, so this removes the false pass on a republish.
  - This poll applies to both builds and comps.
- **Pages deploy:** the item stays `publishing` until the deploy finishes, which takes 60–180 s. The existing Pages check (`/r/<fileId>` on github.io) is used only when:
  - the commit contains a new `/r/<fileId>` page (the item's first publish), or
  - the commit changes the viewer bundle (`shellChanged`).
- **Republishes** of existing items don't wait for Pages.

### 5. Viewer: SHA-pinned reads

New `resolvePinnedBase(location, searchParams, fetchImpl)` in `src/site/rawBase.js`, mirrored in CJS/ESM per the existing parity convention:

1. If `remoteBase` is set, return it unchanged.
2. Otherwise compute owner and repo as `resolveDataBase` does.
3. Call `GET https://api.github.com/repos/<owner>/<repo>/commits/main` with `Accept: application/vnd.github.sha`, `cache: "no-store"`, and a 3 s timeout (`AbortController`).
4. If the body matches `/^[0-9a-f]{40}$/`, return `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/site/`.
5. On any failure (403 or 429 rate limit, which is 60 requests per hour per visitor IP; a timeout; network error; or a malformed body), return the `/main/` base.

Comps call `resolvePinnedBase` once per distinct member owner, in parallel. Results are memoized for the page load only.

Already-deployed older viewers keep reading `/main/`. They still work, with up to about 5 minutes of lag. The new viewer reaches existing repos through the background format migration (9c39af11).

## Failure handling

The principle: **a failed upload never loses a save.** Items stay pending until a commit containing them succeeds.

| Condition | Queue behavior | Item state |
|---|---|---|
| Network error or offline | Retry with backoff: 30 s, 1 min, 2 min, then every 5 min. Retry immediately on the `online` event or window focus. | `waiting` (reason: offline, `retryAt`) |
| `GITHUB_RATE_LIMITED` | Retry after `retryAfterMs`. | `waiting` (reason: rate limit, `retryAt`) |
| `GITHUB_UNAUTHORIZED` | Pause the queue with no retries. Resume on a successful sign-in. | `unauthorized` |
| Not connected / no token | Items stay pending. Resume after setup completes. | `disconnected` |
| Repo or Pages missing (404 from infra) | Clear the infra cache, re-run `ensurePublishInfra` once, then retry the round. If it fails again, the items fail. | `failed` |
| Non-fast-forward | The existing 4x retry inside `publishSiteBundle`. | (transparent) |
| One item fails to prepare | Drop that item from the batch and mark it failed. The others publish. | `failed` (that item only) |
| Quit with items pending | Start a round immediately and wait up to 10 s, then quit. Anything unfinished stays in `publish-queue.json` and resumes on next launch. Re-uploads are idempotent (same fileId and key; unchanged blobs are skipped). | — |

- **Retry from the UI:** removes the item's `failed` state, re-enqueues it, and starts a round now, without the debounce.
- **Discord share:**
  - If the item is `queued` or `publishing`, share calls `awaitPublished` (15 s timeout, with a spinner) and then shares.
  - If the item is `failed`, sharing stays blocked through the existing share-gate tooltip.
- **Pages deploys** queue under the `pages` concurrency group (at most one running and one waiting). Batching keeps their number low.

## UI

### Copy-link button

The button replaces `#publishSiteBtn` (build editor) and the comp board's `[data-action='publish']` button, in the same spot. One pure function, `publishButtonState(status, connection, publishChoice)`, maps to:

| State | Label | Click |
|---|---|---|
| disconnected | **Set up publishing** | Opens the existing first-publish setup and explainer. |
| queued / publishing | **Publishing…** (spinner) | Copies the link. The link already exists, and the new version shows once the upload lands. |
| current | **Copy link** ✓ | Copies the link and shows "Copied" briefly. |
| waiting | **Copy link** plus a clock icon. The tooltip gives the reason and the retry time. | Copies the link; the old version stays live. |
| failed | **Retry** (warning color). The tooltip shows the error. | Retry (see above). |
| unauthorized | **Sign in to publish** | Opens sign-in. |
| declined | **Publish my copy** | Shows the foreign-owner prompt again. |
| never published, not queued (bulk prompt declined) | **Copy link** | Enqueues the item, then copies the link. |

The existing status dot (`publish-status.js`, never/current/stale) is kept.

Context-menu "Publish" entries and other "Publish" wording become "Copy link".

### Bulk-publish prompt (once)

- **When:** on the first launch after the update, if the user is connected and has items that have never been published. If the user isn't connected, it appears after their first successful setup instead.
- **Text:**
  > **Publish your library?** Builds and comps now publish automatically when you save. You have N that have never been published. Publish them all now? *(It runs in the background, 50 at a time.)*
  > [Publish all] [Not now]
- **Effect:** "Publish all" enqueues every never-published item, which publishes over successive 50-item rounds.
- **Persistence:** the answer is stored in settings (`bulkPublishPrompted: true`), so the prompt never appears again.

### Foreign-owner prompt (once per build)

> **This build was published by @owner.** Publish your own copy? Your link will point at your account; their link keeps working but stops updating.
> [Publish my copy] [Keep theirs]

The answer sets `publishChoice` on the build.

### Removed

The separate Publish action. The first-publish explainer is reachable only through "Set up publishing".

## Unchanged

- Receipt and status fingerprint logic (`publishState.js`).
- Discord share gating rules (share-gate.js / shareGate.js), apart from the await described above.
- Link format and `/r/<fileId>` short links.
- Local API routes `POST /builds/:id/publish` and `/comps/:id/publish`: they now enqueue, start a round, and await, keeping the same response shape.
- Team Sync.

## Out of scope

- Unpublishing or deleting published items.
- The `render-pages.js` URL inconsistency (`folder.shared` vs `publishedOwner`). It goes in BACKLOG if it isn't already there.
- An app-level write-permission check for team publish owners.

## Testing

Jest only. Playwright/E2E runs at release.

- **`publishQueue`** (fake timers, mocked publish routine):
  - 5 s debounce and 30 s maximum delay;
  - an enqueue during a round lands in the next round;
  - the pending set survives a restart;
  - the backoff schedule;
  - a rate limit waits `retryAfterMs`;
  - unauthorized pauses the queue and sign-in resumes it;
  - an item that fails to prepare doesn't block the others;
  - the 50-item cap and back-to-back rounds;
  - the 10 s flush on quit;
  - unchanged-fingerprint saves aren't enqueued;
  - `awaitPublished` resolves and rejects correctly.
- **`publishBundleImpl`** (mocked githubApi):
  - one `publishSiteBundle` call per owner per round;
  - shared comp members uploaded once;
  - migrations included;
  - receipts stamped with the uploaded snapshot's hash, so an edit during the upload stays stale;
  - the live check polls the SHA-pinned URL;
  - the Pages wait happens only for a new `/r/` page or a viewer change.
- **`publishChoice`:** a foreign build isn't enqueued until a choice is made; `"mine"` publishes with force; `"theirs"` gives `declined`.
- **`resolvePinnedBase`:** SHA returned, 403, 429, timeout, malformed body, `remoteBase` override, memoization per owner. The CJS/ESM parity test covers the new export.
- **`publishButtonState`:** every row of the state table.
- **Prompts:** the bulk prompt is shown once and its answer is persisted; the foreign-owner answer is persisted on the build.
- **Local API:** the publish routes enqueue, await, and return the existing response shape.
