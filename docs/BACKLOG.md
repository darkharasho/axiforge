# Backlog

Running list of one-off reports and feature ideas so nothing gets lost between
sessions. Newest at the bottom of each section. Check items off as they ship;
leave the entry in place with its outcome so we don't re-litigate it.

Status key: `[ ]` open · `[x]` done · `[~]` in progress · `[?]` needs repro steps

---

## Bugs

- [x] **Phantom build row floats over every library view.** Switching between All
  Builds and the Archive left a build row pinned at its old screen coordinates,
  on top of whatever you navigated to, until restart.
  *Cause:* SortableJS drags a clone of the row parented to `<body>`
  (`forceFallback` + `fallbackOnBody`) and only removes it inside `if (evt)` in
  `_onDrop`. `destroy()` calls `_onDrop()` with no event and then nulls the
  reference, so a render landing mid-drag stranded the clone with no handle left
  to remove it. *Fix:* sweep `body > .lib-drag-fallback` wherever we destroy —
  `src/renderer/modules/library/drag-drop.js`. Covered by
  `tests/unit/renderer/library-drag-ghost-strand.test.js`.

- [x] **Breadcrumb claimed you were at the library root while showing the Trash
  or the Archive.** `renderBreadcrumb()` had no branch for those two folder
  types and fell through to the generic tail. *Fix:* `library/toolbar.js`.

- [x] **Opening an imported comp took the whole comps page down.**
  `renderPartyLine` read `buildId.length` off a party slot, and
  `toImportedComp` deliberately mapped unresolvable slots to `null` — one null
  and `renderCompDetail` threw, leaving a blank page with no recovery short of
  restarting. *Fix (source):* `slots` is dense everywhere else in the app, so
  drop unmappable entries rather than nulling them —
  `src/main/axiLinkImport.js`. *Fix (defence):* draw a hole as an empty slot —
  `comps/comp-detail.js`. Covered by `tests/e2e/specs/comp-slot-holes.spec.js`.

- [x] **Toolbar controls were live but inert in the Trash and the Archive.**
  Search, sort, the view toggle and New/Import/Export all rendered in views that
  bypass the list renderers entirely. Typing in the search box set
  `state.buildSearch` with no visible effect, then the library came back
  filtered for no apparent reason. *Fix:* breadcrumb only in those two views —
  `library/toolbar.js`.

- [x] **Error toasts got the same 2 seconds as "Build copied!".** Often the only
  account the user gets of why an action did nothing. *Fix:* errors and warnings
  now get the 6s Undo window — `library/toast.js`.

- [x] **Right-click → Rename did nothing in the Columns view.**
  `startInlineRename` knew four title classes and `.lib-col__name` was not one of
  them, so it resolved `null` and the view just repainted. *Fix:*
  `library/library.js`. Covered by `tests/e2e/specs/library-columns.spec.js`.

- [x] **Right-click → Rename did nothing on the Comps page.** It called
  `window.prompt()`, which Chromium in Electron does not implement — it returns
  `null` and logs "prompt() is and will not be supported". *Fix:* use
  `prompt-modal.js` like the rest of the app — `comps/comps.js`. Guarded by
  `tests/unit/renderer/no-native-dialogs.test.js`.

- [x] **A slight click-and-wobble moved builds and comps.** SortableJS defaults
  `fallbackTolerance` to 0, so with `forceFallback` a one-pixel drift started a
  real drag. *Fix:* 8px threshold in `library/drag-drop.js` and
  `comps/comp-drag-drop.js`.

- [x] **Shift-selecting several builds and dragging them out of a folder moved
  only one, in the Columns view.** Every drop path that goes through a hover
  target honoured the multi-selection; the plain SortableJS branch did not — and
  a `.lib-col` is neither inside a `[data-folder-id]` nor a nav target, so every
  column-to-column drag lands in exactly that branch. *Fix:*
  `library/drag-drop.js`. Covered in
  `tests/unit/renderer/library-drag-drop-refresh.test.js`.

- [x] **Windows: the titlebar cut into the library tab in the left nav.**
  `.app-layout` cleared the fixed titlebar with `margin-top`, and an adjoining
  top margin collapses out through a parent with no top padding or border — so
  the 42px landed on `<body>`, made `<html>` taller than the viewport, and let
  the whole document scroll up under the titlebar. A second copy of the height,
  written as `40px` in four places against a 42px bar, made it 2px worse again.
  *Fix:* `body { padding-top: var(--titlebar-h) }`, one `--titlebar-h` variable,
  no `margin-top` — `styles/base.css`, `styles/layout.css`. Covered by
  `tests/e2e/specs/library-columns.spec.js`.

- [?] **Deleting a comp temporarily removes a build from the main library page
  until refreshed.** Not reproduced from the two obvious paths (delete from the
  library root, delete from the Comps page) — builds stayed put in both.
  A defensive fix went in for the case that would produce exactly this symptom:
  deleting or archiving the comp you are standing *inside* left
  `state.currentFolder` naming a record that no longer resolves, so
  `getVisibleBuilds()` returned an empty list until you navigated away
  (`handleDeleteFolder` has always stepped out for this reason; the comp paths
  never did). **Needs the view mode and exact steps to confirm that was it.**

- [x] **Columns view duplicates columns / gets out of whack.** The column stack
  is a path relative to column 0, and nothing kept the two in step. Drill into
  "Raids", then click Raids in the sidebar: column 0 becomes Raids' contents
  while the stack still says "Raids next", so the same column renders twice. A
  selected id that stopped resolving (deleted, trashed, archived, removed by a
  teammate's sync) left an empty column with nothing to click that would clear
  it. *Fix:* reset the stack when the navigation context changes and prune
  entries that no longer resolve — `library/content.js`. Covered by
  `tests/unit/renderer/columns-view-stale-stack.test.js`.

## Features

- [x] **Comp history.** Builds have carried a full "who changed what" since the
  shared-folder work; comps carried nothing. Shipped: `CompHistoryStore` (the
  storage half now shared with builds via `historyStore.js`, because the two
  were the same logic and would have drifted), `summarizeCompChange` — which
  *names* the builds that moved rather than counting them, since "party lines
  changed" tells a teammate nothing they can act on — entries on `comps:save`,
  on a teammate's edit and on a teammate's delete, `comps:get-history` /
  `comps:revert`, a **View History** item on the comp context menu, and comp
  entries merged into the folder timeline alongside build ones. Covered by
  `tests/unit/compHistoryStore.test.js` (15), `teamSync.pull.test.js` and
  `tests/e2e/specs/comp-history.spec.js`.

- [ ] **Tags on comps, shown on the comp view.** The store and the published SPA
  already carry `comp.tags` (see `tests/spa/specs/comp-tags.spec.js`); what is
  missing is the desktop UI to edit them and show them on the comp detail.

- [ ] **Dedupe on import.** When importing a comp (or anything) that brings
  builds identical to ones already in the library, offer to reuse the existing
  build instead of creating a duplicate.

- [ ] **Per-folder team permissions.** Better admin controls — read / write /
  delete per folder within a teamspace, rather than one role for the whole team.

- [x] **Shared team trash.** Built, tested, **not yet deployed** — the D1
  migration and `wrangler deploy` still need your go-ahead.
  - `0002_team_trash.sql` adds `deleted_at` / `deleted_by` / `delete_batch`.
  - A delete keeps its body instead of `body = NULL`, so the content survives
    for the 30 days `purgeTombstones` already kept the tombstone. `itemWire`
    still sends `body: null` for tombstones, so the changes feed is unchanged
    and clients pay nothing for it.
  - `GET /teams/:id/trash` lists one row per thing somebody actually deleted (a
    batch root is a row whose `delete_batch` is its own id, so a folder delete
    is one row and not twenty), with who removed it, how much rode along, and
    `canRestore` — the client cannot work the rule out itself, and a Put Back
    that answers 403 is worse than one that explains itself.
  - `POST /teams/:id/trash/:itemId/restore` restores the whole batch as ordinary
    writes, so it reaches every client through the normal changes feed. Allowed
    for the owner, the item's creator, or whoever deleted it.
  - `purgeTombstones` now measures from `deleted_at` (COALESCEd with
    `updated_at` for pre-migration rows) — a restore bumps `updated_at`, so the
    old basis would have reset the retention clock.
  - Client: `syncApi.listTrash/restoreItem`, `teamSync.listTeamTrash/
    restoreFromTeamTrash`, `teams:trash` / `teams:trash-restore`, and a
    "Deleted from a shared folder" section in the Trash view. The restore also
    clears the LOCAL trash stamp first — `upsertBuild` carries it over on
    purpose, so without that the pull would write the body onto a record that
    stays invisible.
  Covered by `tests/unit/worker-sync-trash.test.js` (11),
  `tests/unit/renderer/library-trash-view.test.js` and
  `tests/e2e/specs/team-delete-undo.spec.js`.

- [x] **Deploy the shared team trash.** Done 2026-09-05: migration
  `0002_team_trash.sql` applied to remote D1 through the Cloudflare MCP (the
  wrangler token lacks D1 permissions), with its `d1_migrations` ledger row
  inserted by hand so a later `wrangler d1 migrations apply` doesn't re-run it.
  Worker `axiforge-playground` deployed at version `22e80437`. Note this Worker
  is shared with the Playground SPA, so `wrangler deploy` also republishes
  `dist/web` — run `npm run build:web` first or you roll build.axi.link back.

- [ ] **A back button when viewing a build.**

- [ ] **Say what changed in the incoming-sync popup.** Right now it announces
  that a change arrived without saying what it was. `summarizeBuildChange()`
  already produces exactly this text for the history panel.

- [x] **Record deletes in history, and allow undelete from history for shared
  folders.** Deletes were not recorded at all, and a teammate's delete was
  strictly worse than your own: `builds:delete` stages your copy in the Trash
  (30 days, history kept until purge), but a tombstone arriving over sync went
  through `teamSync._applyTombstone`, which called the raw
  `buildStore.deleteBuild` (a hard filter-out of `builds.json`) *and*
  `historyStore.deleteHistory(id)` — so the build and its entire history were
  gone locally with no Trash row and no undo. Shipped:
  - an incoming tombstone now stages in the trash exactly like a local delete,
    with a folder trashing its subtree as one batch instead of clearing
    `folderId` off the builds inside it (which used to dump a teammate's folder
    contents loose into your root) — `teamSync._applyTombstone`;
  - `_applyTombstone` refuses to run without a trash wired rather than falling
    back to the destructive path;
  - it writes a **"Deleted"** history entry attributed to whoever performed it,
    with a snapshot, before the record leaves the library views;
  - `folders:get-history` includes trashed builds (it read `listBuilds()`, so a
    build vanished from its own folder's history the moment it was deleted,
    taking every earlier entry with it) and flags them `buildDeleted`;
  - `builds:revert` takes a build back out of the trash first — `upsertBuild`
    deliberately carries the trash stamp over, so a plain revert wrote a build
    nothing would draw. The history panel reads **"Bring it back"** for those.
  Putting it back re-pushes to the team, so the undelete is shared, not local.
  Covered by `tests/e2e/specs/team-delete-undo.spec.js` and
  `tests/unit/teamSync.pull.test.js`.

- [x] **Follow-up to the above: one deleted thing, one row.** Done 2026-09-05.
  Two separate problems hid behind "the trash shows it twice":
  - **The duplicate row was the renderer's.** Deleting from a shared folder puts
    the item in both lists at once — staged locally *and* tombstoned on the
    server — and `renderTrashView` drew the local list and the team list one
    after the other, so it appeared twice with two Put Back buttons doing the
    same thing. They are now matched by id and the local row wins: it is the
    richer one (a countdown, and the permanent delete of your own copy) and it
    now carries the server's attribution and restore permission, so it still
    says who removed it and still greys out Put Back when the team will not let
    you. Purge your local copy and the team row comes back on the next render,
    which is right — the team's 30 days are still running and it is again the
    only way back.
  - **The "row per item" claim was never true**, and the unit test that seemed to
    prove it fed the tombstones in an order the server does not produce.
    `deleteItem` bumps the folder's seq *before* any descendant's, so the folder
    tombstone always arrives first and `trashFolder` claims the whole subtree
    under one batch; each descendant's own tombstone then finds it already
    staged and no-ops. The test now uses the real order.
  - **What that ordering did break:** `_applyTombstone` looked the build up in
    `listBuilds()` only, so once the folder cascade had staged it there was
    nothing to snapshot and no **"Deleted"** history entry was written — the one
    delete most worth a name against it, a whole shared folder, recorded
    nothing. It falls back to the trashed list now. Same for comps.

## Housekeeping

- [x] **The e2e suite took ~35 minutes and blocked the dev loop.** It ran pinned
  to one worker because nothing was isolated: every spec wiped a single shared
  data dir, and the sync mock's `db` is module-level singleton state that
  `resetSync()` wipes wholesale. Now each worker gets its own data dir, its own
  Electron profile and its own sync-server process (`9878 + N`) — see
  `tests/e2e/helpers/ports.js`. Full pass is ~10 min at the default worker
  count, `E2E_WORKERS` to override. Tiering is written up in `docs/TESTING.md`:
  jest (~12s) is the loop, `test:e2e:smoke` (~2min) is for a UI change worth
  eyes on, and the full suite is release-only.

- [ ] **CI runs none of the three Playwright suites** — `.github/workflows/ci.yml`
  is `npm test` only. That is why nine e2e specs sat red for three releases. The
  SPA and playground suites are seconds each and are the obvious first ones to
  add; the e2e suite wants a nightly rather than a per-push job.

- [ ] **Two different confirm modals.** `confirm-modal.js` renders `#cm-confirm`
  while `showConfirmModal()` builds a fresh `.confirm-modal-overlay`. Callers
  pick one more or less at random, and tests have to know which.
