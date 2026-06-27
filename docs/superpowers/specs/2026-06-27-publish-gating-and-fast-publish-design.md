# Publish Gating, Fast Publish, and First-Publish Explainer

Date: 2026-06-27
Status: Approved (design)

## Problem

A user (Revan) built a build, shared a Discord link with a teammate, and the
link 404'd. Three root causes, surfaced in the Discord thread:

1. **No gate.** Sharing to Discord was allowed before the build was published.
   The editor even *silently auto-published* on share, hiding the requirement
   instead of teaching it ("shouldn't have let you try to share before it
   published").
2. **Stale publishes are invisible.** Because `publishedFileId` is preserved
   across saves, a build can be "published" yet have local edits that were saved
   but never re-published — and sharing happily hands out a link to the old
   version.
3. **Publish is slow and not confirmed-live.** Every publish triggers a full
   GitHub Pages Actions workflow rebuild, then returns before Pages has actually
   deployed. The shared link 404s until the workflow finishes. (A sibling app,
   axivale, publishes in a few seconds by reading data from
   `raw.githubusercontent.com` and polling until live.)

This is one user story: **"I published, I shared, it worked."**

## Goals

- Discord share is **hard-disabled** (greyed out, with a hover tooltip) unless
  the build is published **and** has no saved-but-not-published changes.
- Publishing a normal build takes a few seconds, not 30–90s.
- "Published" means **actually reachable** — the share gate is trustworthy by
  construction.
- The first time a user publishes, a short panel explains what publishing does
  and why it's needed.

## Non-Goals

- Switching GitHub Pages from the Actions workflow to deploy-from-branch
  (`legacy`) — the "3b" option. Higher blast radius (migrating every existing
  repo incl. production `gw2eww/axibuilds`, dropping the `workflow` OAuth scope).
  Recorded as a future cleanup, not in scope here.
- Comps: the same gating wording is applied to comp Discord share for
  consistency, but comp publishing internals are otherwise unchanged.

---

## Section 1 — Publish state tracking

The store cannot currently distinguish "published" from "published then edited"
because `upsertBuild` preserves `publishedFileId`/`publishedKey`/`publishedSlug`
across saves (`src/main/buildStore.js:49-51`).

**Add one field** to the build record: `publishedAt` (ISO string, default
`null`).

Changes in `src/main/buildStore.js`:

- `normalizeBuild`: include `publishedAt` (default existing value or `null`).
- `upsertBuild` preserve block: add
  `if (!next.publishedAt && existing.publishedAt) next.publishedAt = existing.publishedAt;`
  so a normal save never wipes it.
- Publish stamping: when the publish flow writes the publish metadata, set
  `publishedAt` **equal to** `updatedAt` (the same `now`), so right after a
  publish they are exactly equal. Implementation: `upsertBuild` accepts an
  explicit internal signal (e.g. `input.__stampPublishedAt === true`) and, when
  set, assigns `next.publishedAt = now` (the same `now` used for `updatedAt`).
  The signal flag is stripped before persisting.

Derived states (single source of truth — a small helper, e.g.
`buildPublishState(build)` usable in both main and renderer):

- `neverPublished` = `!build.publishedFileId`
- `stale` = `build.publishedAt && build.updatedAt !== build.publishedAt`
- `shareable` = `build.publishedFileId && !stale`

**Backward compatibility:** builds published before this ships have
`publishedAt === null` → `stale` is `false` → they remain shareable. We do not
retroactively block already-published builds.

Edge cases:
- The publish handler does an early `upsertBuild` to auto-name untitled builds
  (`src/main/index.js:1031-1035`). That call must **not** stamp `publishedAt`
  (it's a pre-publish save). Only the final metadata write (`:1151-1156`) stamps.
- `publishedAt` is part of the build record pushed to the shared library, so a
  teammate who receives a shared build sees it as published+fresh.

---

## Section 2 — Hard-disable Discord share (option A)

**Remove the silent auto-publish-before-share:**

- `src/renderer/renderer.js` Discord Embed handler (~1341-1371): delete the
  "Auto-save + publish if not yet published" block. The handler now only shares;
  if it's somehow reached while not shareable, it no-ops (the button is disabled
  anyway, and the main process rejects defensively — below).
- `src/renderer/modules/library/library.js` `handleDiscordEmbed`: same — remove
  the auto-publish branch.

**Disable the buttons + tooltip** (using the `buildPublishState` helper):

- **Editor share dropdown** — in `src/renderer/modules/render-pages.js`,
  alongside the existing published-link button logic (~755-766): set
  `[data-action='discord-copy']` and `[data-action='discord-embed']` to
  `disabled` when `!shareable` **or** `state.editorDirty` (unsaved edits disable
  immediately). Tooltip text:
  - never published → `"Publish this build first"`
  - stale or editor-dirty → `"Publish your latest changes first"`
- **Library context menu** (`src/renderer/modules/library/context-menu.js`
  ~158-161): disable the "Copy Link" / "Discord Embed" submenu items with the
  same tooltip when `!shareable`.
- **Comp detail dropdown** (`src/renderer/modules/comps/comp-detail.js` ~459-461):
  same disabled+tooltip treatment, keyed on the comp's publish state.

**Defense in depth — main process** (`src/main/index.js`
`discord:share-build`, ~1528-1530): in addition to the existing
`!publishedFileId || !publishedKey` rejection, reject stale builds:

```js
if (build.publishedAt && build.updatedAt !== build.publishedAt) {
  return { success: false, error: "Build has unpublished changes — publish again before sharing." };
}
```

(Apply the equivalent check to `discord:share-comp`.)

---

## Section 3 — Fast publish + confirmed-live (approach 3a)

Keep `build_type: "workflow"` (no migration of existing repos' Pages config).
The speedup comes from three changes:

### 3.1 Version marker — skip SPA shell re-upload + workflow when unchanged

In `src/main/siteBundle.js`:

- Compute a content hash of the SPA bundle: sorted relative paths + file bytes,
  SHA-256, truncated (e.g. 12 hex chars). (Mirrors axivale's
  `loadViewerBundle`.)
- Store the marker in a repo file (e.g. `site/site-version`).

In the publish flow (`src/main/index.js` `builds:publish-build`):

- Read the remote marker. If it matches the local SPA hash, **do not** include
  the SPA files in the commit and **do not** trigger the Pages workflow.
- Only when the hash differs: push the SPA files + new marker and trigger the
  workflow (this is the rare "the app shipped a new viewer" case).

### 3.2 Serve build data from `raw.githubusercontent.com`

The encrypted build file is committed as it is today, but the SPA reads it from
`raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` instead of a
Pages-served path. raw reflects a commit within seconds, independent of the
workflow — so a build-only publish is live in seconds with no workflow run.

- SPA change: the build-loading fetch (in the published viewer / SPA source)
  resolves the encrypted build/comp file from the raw URL.
- The redirect file + `?b=<fileId>.<key>` short-link contract is unchanged from
  the user's perspective.

> Note: the SPA shell itself is still served by Pages (workflow). Changing where
> the SPA *fetches data* is an SPA-source change that ships in the SPA bundle; it
> takes effect once the shell is published once with the new code (a one-time
> workflow run via the marker path in 3.1).

### 3.3 Wait-until-live before stamping `publishedAt`

Reuse / extend the existing live-poll (`pollPageLive` used by
`showPublishResult` in `render-pages.js`, and the `pages` step "Waiting for
Pages to go live").

- After upload, poll the **raw build-data URL** (cache-busted `?t=<ts>`,
  ~3s interval, ~90s timeout) until it returns 200. On first-ever publish, also
  wait once on the Pages site URL for the shell.
- Only after "live" is confirmed does the handler perform the final
  `upsertBuild` that stamps `publishedAt`. Therefore **`publishedFileId` +
  fresh `publishedAt` together imply the link is reachable** — Section 2's gate
  is correct by construction.
- If the poll times out, surface a clear failure on the `pages` step (via
  `failPublishStep`) and do **not** stamp a fresh `publishedAt` (the build stays
  in its prior state rather than being falsely marked live).

### Performance expectation

- Normal build publish: ~2–5s (push data file → poll raw until live; workflow
  skipped).
- First-ever publish: ~60–90s once (waits on the one-time shell workflow build).
- Publish that changes the SPA shell (app update): ~60s for that one publish.

---

## Section 4 — First-publish explainer

- **Trigger:** first time the user clicks Publish while **no build has ever been
  published** (`!state.builds.some(b => b.publishedFileId)`). No new persisted
  flag is needed — once any build has `publishedFileId`, the panel never shows
  again.
- **Component:** reuse `showConfirmModal` (`src/renderer/modules/confirm-modal.js`).
  - Title: "Publishing puts your build online"
  - Body (HTML): publishing uploads the build to your GitHub Pages site so the
    shareable / Discord link actually works; it uses your one-time GitHub
    sign-in; it takes a few seconds.
  - Buttons: **Publish now** (confirm) / **Cancel**.
- On confirm, the existing publish flow runs (now fast + confirmed-live).
- The disabled-share tooltips from Section 2 use wording that points the user at
  publishing ("Publish this build first").

---

## Testing

- **buildStore** (unit): `publishedAt` defaults to `null`; preserved across a
  normal save; stamped equal to `updatedAt` on a publish-flagged upsert; a save
  after publish makes `updatedAt !== publishedAt` (stale).
- **Publish state helper** (unit): `neverPublished` / `stale` / `shareable` for
  the matrix (never published, fresh, stale, legacy `publishedAt === null`).
- **discord:share-build / share-comp** (unit): reject stale builds; allow fresh;
  allow legacy-null `publishedAt`.
- **Version marker** (unit): identical SPA bundle → same hash → SPA + workflow
  skipped; changed bundle → SPA pushed + workflow triggered.
- **Renderer gating** (existing e2e/Playwright harness if practical): share
  items disabled with correct tooltip for each state; enabled after a confirmed
  publish; first-publish modal appears once then never again.

## Rollout / risk notes

- 3.2 changes where the published SPA fetches data. Existing already-published
  builds were written for the old fetch path; verify the new SPA can still load
  builds published before this change (the encrypted file path is unchanged —
  only the host the SPA fetches from changes, and the file exists in the repo at
  that path, so raw resolves it). Confirm during implementation.
- Keep the workflow file and `triggerPagesWorkflow` in place; they're still used
  on shell changes and first publish.
- 3b (branch-deploy migration) intentionally deferred.
