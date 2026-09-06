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

- [x] **Tags on comps, shown on the comp view.** Done 2026-09-05. The store and
  the published SPA already carried `comp.tags`; the desktop had a tag *filter*
  and a bulk popover, but nowhere to tag one comp, and the detail's tag row
  returned `""` when a comp had none — so the only way to add a comp's first tag
  was to leave the comp, select it in the list, and use the bulk bar.
  - The popover was lifted out of `comp-list.js` into `comps/comp-tags.js`, which
    now owns the whole comp tag UI — the pill row and the editor together. It
    still edits a *set*, because "tag these three" and "tag this one" are one
    operation with a different list length; a box is checked only when every comp
    in the set carries the tag.
  - The detail row is always drawn now. Each pill gets a remove that appears on
    hover, and a dashed **+ Add tags** / **+ Tag** button opens the popover.
    **Edit Tags** is on the single-comp context menu too, anchored at the cursor.
  - `loadComps()` now re-points `state.activeComp` at the freshly loaded record.
    Every callback reloads the list and the detail renders from `activeComp`, so
    without it a tag added from the detail vanished on the very next render.
    That was latent for every non-detail edit path, not just tags.
  - Covered by `tests/unit/renderer/comp-tags.test.js` (16).

- [x] **Dedupe on import.** Done 2026-09-05. Importing three comps from the same
  squad left three copies of the same Firebrand — a published comp carries every
  build it references, and nothing ever asked whether you already had them.
  - **Identity is the share code.** `src/main/buildDedupe.js` fingerprints a
    build with `encodeShareCode`, which is already the app's definition of what
    a build *is* (profession, mode, traits, skills, gear, runes, sigils,
    infusions, relic) and deliberately carries none of what two people
    reasonably differ on — title, notes, tags, folder. Hand-rolling a field list
    would only have given the codec something to drift away from.
  - One question, not one per build: "use the ones I have" or "import copies
    anyway", naming both titles so you can see what you are choosing between. A
    checklist of five identical Firebrands is a worse way to ask.
  - Wired into both paths that bring builds along with a comp: published links
    (`builds:preview-axi-link` → `builds:commit-axi-import`, with the assembled
    records held under a token because the local ids are minted during the fetch
    and a second fetch would mint different ones) and comp share codes
    (`comps:preview-share-code`, no token — a code decodes locally and
    deterministically, so the commit just decodes it again). A *build* link that
    matches writes nothing at all and opens the copy you already have.
  - Two guards worth knowing about. Trashed and archived builds are never
    reused, or you get a comp full of builds you cannot see. And importing into
    a **team** folder only reuses builds already inside that same team — pointing
    the comp at a build outside it would leave every teammate with a comp
    referencing a build they do not have.
  - `hideToast()` is now exported: a "loading" toast has no dismiss timer, so
    backing out of the duplicate question would have left "Importing…" on screen
    forever.
  - Covered by `tests/unit/buildDedupe.test.js` (19) and
    `tests/unit/renderer/import-dedupe.test.js` (16).
  - **Still open:** the `.axicode` file import matches on *id* only, so a file
    from someone else's library re-imports content you already have as fresh
    copies. Same module applies; it needs the renderer to fingerprint in batch
    over IPC, and its conflict modal is per-item rather than one question.

- [x] **Per-folder team permissions.** Done 2026-09-05. Built and tested,
  **not yet deployed** — migration `0003_folder_grants.sql` and a
  `wrangler deploy` still need your go-ahead.
  - A teamspace had exactly two settings for a person — `owner` (do anything) or
    `member` (write anything, delete only your own) — which is one decision for
    the whole library. A squad wanting an officers-only folder or a read-only
    reference section had no lever but making somebody an owner of everything.
  - **A grant covers a folder and everything inside it, and the nearest one
    walking up from an item wins.** Levels are `none` / `read` / `write` /
    `delete`. A grant on the team's *own id* is that person's team-wide default,
    which is how "read-only across the whole team" is written down — the root
    folder is not a synced item, so there is nowhere else to hang it.
  - `none` is enforced by **filtering the changes feed**, not just by refusing
    writes: hiding a folder is the thing people actually ask for. Losing read
    access produces no item event at all, so a grant edit stamps the team's seq
    onto that member (`memberships.grants_seq`) and their next incremental pull
    is told to resync — the same mechanism `purged_seq` already used. The
    re-pull's existing `_pruneUnseen` then stages the now-invisible items in the
    local trash.
  - **A team with no grants runs exactly the queries it ran before.** Owners and
    ungranted members take an `unrestricted` fast path that skips the per-item
    checks and never loads the folder tree.
  - Owners are deliberately not grantable: an owner can take any grant back in
    the same breath, so a level set against one would be a lie. The API says so
    rather than storing it.
  - Two rules kept from before, now layered: the creator clause (a member may
    clean up after themselves) survives, but requires `write` — a folder you
    have been made read-only on should not still let you destroy your own
    contributions to it. And a folder delete is all-or-nothing on the cascade;
    half-deleting somebody's subtree is worse than refusing.
  - An item you cannot see answers **404, not 403**. A 403 would confirm it
    exists, which is the one thing hiding it was for.
  - Client mirrors the rule (`src/main/folderAccess.js`) so an edit is refused
    *before* it is written locally and queued — otherwise the user is told
    "saved" and then "forbidden" some seconds later. The mirror is refreshed on
    resync, which is exactly and only when a grant changed.
  - UI is the **Access** section of the Share dialog: open Share… on a team
    folder and each member gets a level, scoped to that folder (or the whole
    team at the root).
  - Covered by `tests/unit/worker-sync-grants.test.js` (35),
    `tests/unit/folderAccess.test.js` (15),
    `tests/unit/teamSync.grants.test.js` (15),
    `tests/unit/renderer/folder-access.test.js` (14), plus the extended
    `teamGuards` tests.
  - **Now done (2026-09-06):** the library greys out what a read-only member
    cannot do, instead of letting them find out by being refused.
    `src/renderer/modules/library/access.js` is the one place the UI asks — it
    is a lookup over the `teams:access` map, not a second copy of the rule, so
    it cannot drift from `src/main/folderAccess.js`. `loadTeamState()` fetches
    the map after the folders (it is keyed by folder id). Applied to the
    context menu (build, comp, multi-select, folder and empty-area), to the
    toolbar's New and Import, and to the drag hover highlight, which now marks
    a read-only drop target `is-invalid` rather than letting the item snap back
    after a toast.
    - `delete` vs `write` is deliberately *not* modelled: the extra thing a
      delete grant buys you is removing a **teammate's** work, and the renderer
      cannot tell whose is whose. That is the server's creator rule, which still
      answers it — so a write-level member keeps a live Delete for their own
      builds.
    - Gated on what main actually enforces, nothing more: `pinned`, `sortOrder`
      and the archive stamps are `BUILD_LOCAL_FIELDS` — they never leave the
      machine, so Pin and Archive stay live in a read-only folder. Export and
      View History stay live too; they only read.
    - Found on the way: `.lib-ctx-item--disabled` shared a rule with
      `--header`, so every disabled menu item inherited `pointer-events: none`
      — which suppresses the `title`. The greyed share-gate items could not say
      *why*. The two rules are split now, and the icon no longer stays danger-red
      on a refused Delete.
    - Covered by `tests/unit/renderer/library-read-only-access.test.js` (18) and
      `tests/unit/renderer/library-toolbar-read-only.test.js` (3).
  - **Also worth knowing:** an item you lose read access to lands in your local
    trash (via the resync prune), attributed as a teammate's delete. Its "Put
    Back" will be refused by the server. Honest, but the wording is wrong for
    what actually happened.

- [x] **Deploy per-folder team permissions.** Live on 2026-09-05.
  `0003_folder_grants.sql` applied to remote D1 through the Cloudflare MCP (the
  wrangler token still lacks D1 permissions — `migrations apply --remote` fails
  with code 7403), with the `d1_migrations` ledger row inserted by hand so a
  future `migrations apply` does not re-run it. `npm run build:web` then
  `wrangler deploy` — version `c36840ad`. Verified: `memberships` carries
  `grants_seq`, `folder_grants` exists, and `GET /api/sync/teams/:id/grants`
  answers 401 where an unknown sibling route answers 404.

- [x] **Shared team trash.** Deployed — `0002_team_trash.sql` is applied to
  remote D1.
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

- [x] **A back button when viewing a build.** Done 2026-09-05. The editor
  subnav grows a back button that names where the build was opened from — the
  folder ("Raids"), the comp ("Zerg Frontline"), or plain "Library"/"Comps" —
  and returns there. The origin is captured in `navigateToPage()` rather than at
  each call site, so every route into the editor (a library card, a comp slot,
  an import, the left nav) gets it without opting in; the label is a snapshot,
  because the folder or comp it names can be renamed or deleted by a teammate's
  sync while you edit. Rules live in `modules/editor-return.js` so they can be
  tested without booting Electron (`tests/unit/renderer/editor-return.test.js`).
  Hidden on the web playground — the editor is the whole app there.

- [x] **Say what changed in the incoming-sync popup.** Done 2026-09-05. The
  toast shown when a teammate's change lands on a build you have unsaved work in
  now names who changed it and what they changed — "vette changed this build —
  notes updated." The description is computed in `teamSync._applyItem` and
  carried on the `sync-status` event, because that is the only place it can be:
  the pre-change record is gone the moment the upsert lands. It reuses the
  `summarizeBuildChange()` the history entry already builds there, so the toast
  and the history row cannot drift. Wording lives in
  `renderer/modules/sync-summary.js` (tested without Electron): the history
  panel's full "; "-joined list is cut to the first two clauses with a
  "(+N more)" count, since a toast cannot carry a paragraph. Toasts also gained
  a max-width and wrapping — they were `white-space: nowrap` with no bound, so
  any sentence-length toast ran off both window edges.

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

- [x] **CI runs none of the three Playwright suites.** Done 2026-09-05. `ci.yml`
  gained a second job running the SPA (~25s) and playground (~18s) suites on
  every push and PR, in parallel with jest. It bakes `src/web/public/catalogs`
  first: that directory is git-ignored and generated, and on a bare checkout the
  playground specs fail without it (verified by moving it aside locally). The
  e2e suite is nightly instead — `.github/workflows/nightly-e2e.yml`, 08:00 UTC
  plus `workflow_dispatch` — since it is minutes and memory-bound; it runs under
  `xvfb-run` with `ELECTRON_DISABLE_SANDBOX`, and 2 workers. Neither config sets
  an HTML reporter, so failures upload `test-results/` (traces, from
  `trace: on-first-retry`) rather than a report that is never written.
  `docs/TESTING.md` describes the new tiering. The nightly job's runner
  specifics are unverified until it first fires.

- [x] **Two different confirm modals.** Done 2026-09-05. The premise was half
  wrong: `showConfirmModal()` *is* the `#cm-confirm` singleton — they are one
  function in one file. The real duplication was next door. Six dialogs — the
  four import dialogs, the AxiCode build picker and `showPrompt` — each carried
  their own copy of the overlay scaffolding (create, append, Escape, backdrop
  click, remove the listener), and the copies had drifted: **Import Build Link
  was the only one you could not dismiss by clicking outside it**, and the
  picker was the only one that ignored Enter. That scaffolding is now
  `src/renderer/modules/form-modal.js`, and all six use it, so a dialog's
  confirm button is `[data-action="confirm"]` everywhere and Enter submits
  exactly when that button would (validity is the button's `disabled` state and
  nothing else — no more separate `linkValid` flags to fall out of step).
  `tests/unit/renderer/form-modal.test.js` pins the shared behaviour. `showPrompt`
  keeps its contract but its OK button is now accent rather than danger red —
  renaming a folder was never destructive.

- [x] **Team management was split across two dialogs and could not answer "who
  can do what, where".** Done 2026-09-06. The reported symptom was that role
  assignment and inviting felt janky "between the right click menu and the
  settings menu"; reading both surfaces showed why.
  - **The invite code, the member list and remove-member were implemented
    twice** — `settings-modal.js` `_renderTeamsList` / `_onTeamsListClick` and
    `share-modal.js` `_renderInviteSection` / `_loadMembers` — in different
    markup (`.sm-team__member` vs `.shm__member`) with different wording. Which
    one you got depended on how you arrived.
  - **Folder access was reachable one folder at a time**, by right-clicking that
    folder. Answering "why is this person read-only in Roaming" meant opening
    every folder above it in turn, and an owner could never see the whole
    picture at all.
  - *Fix:* one **Manage team** dialog, `src/renderer/modules/team-modal.js`,
    with People / Folder access / Team tabs. Both entry points lead to it:
    Settings → Teams is now the *list* of teams plus a Manage button, and
    right-click → Share… is genuinely folder-scoped — the invite code, what YOU
    may do here, Pull now, Stop sharing — with "Manage access ›" deep-linking
    into the grid on that folder's row.
  - The **folder × member grid** is the new surface. Rows are the team's folders
    nested by depth (the root keyed by the *team* id, since the root folder is
    not a synced item); cells are one level each, with inherited and defaulted
    ones dimmed and italic so the grants actually *set* somewhere are what the
    eye lands on. Setting a level re-reads the grants rather than patching the
    one cell — a grant changes what every folder below it inherits, and those
    cells are on screen too.
  - `folder-access.js` gained the tree it was missing. `levelFor` could only say
    "inherited from *somewhere*" because it had no chain to walk;
    `effectiveLevel` takes the chain and names the folder. `summarizeAccess`
    puts one person's whole-team access in a sentence ("Can edit, except Roaming
    (read only)") so the People tab answers the common question without making
    anyone read the grid.
  - **No new IPC and no server change** — this is entirely a re-arrangement of
    `teams:members`, `teams:grants` and `teams:set-grant`, which already return
    every grant in the team.
  - **Deliberately not built** (both need server work first): *assigning* roles
    — there is no set-role API, so owner/member is still fixed at creation or
    join — and per-invite links with their own role, expiry and revoke, which
    would replace the single rotating code. The dialog is shaped to take both.
  - Covered by `tests/unit/renderer/team-modal.test.js` (24) and a rewritten
    `folder-access.test.js` (22); the share-modal and settings-modal suites now
    pin the hand-off instead of the duplication. 194 suites / 2807 tests green.

- [x] **A folder's access should be set for everyone, not person by person** —
  2026-09-06. Follow-up to the entry above, from two observations: the per-person
  grid "can get cluttered with a lot of people", and there was no way to "blanket
  set" read/write for the whole team.
  - *Root cause:* a grant could only ever name a person. That is not a fact about
    the folder — it is a pile of facts about whoever happened to be in the team
    the day somebody clicked. A twenty-person squad had to say "read only" twenty
    times, and the twenty-first person to join silently got the role default
    instead. The grid was the honest rendering of a model that was wrong.
  - *Fix:* a grant may now name **everyone** — `user_id = '*'` in `folder_grants`
    (migration `0004_everyone_grants.sql`). One rule still resolves everything
    (`workers/sync/src/access.js`, mirrored in `src/main/folderAccess.js`): at one
    folder a person's own grant beats the blanket, and between folders the nearer
    one wins, blanket or not.
  - The **Folder access** tab is now one card per folder: the blanket level on the
    folder's own line, and beneath it only the people who differ. A folder nobody
    is excepted on is a single line, so the list is the length of the folder tree
    and does not grow with the team. Naming somebody is two steps — pick the
    person, then the level — because a grant stored at the blanket's own level
    would be an exception that excepts nothing.
  - The migration drops the `user_id` foreign key rather than inserting a phantom
    `users` row for `'*'`; a phantom person would have to be excluded from every
    query that counts or lists people, forever. `setGrant` already refuses a
    user_id that is not a member, so the key was never load-bearing.
  - A blanket change stamps `grants_seq` on **every** member, not one: it moves
    everyone's floor, and losing read access is invisible to the changes feed.
  - Found while testing: `TeamSync.setGrant`'s own `access` parameter shadowed the
    `folderAccess` module, so `access.EVERYONE` there was `undefined`. Hoisted.
  - **Needs a Worker deploy** (schema + resolution). 194 suites / 2836 tests green.

- [x] **The Folder access tab was still tough to manage** — 2026-09-06. Follow-up
  to the entry above. The card-per-folder list fixed the *width* problem (it no
  longer grew with the team) but not the *reading* problem: its length tracked
  the folder tree, so every folder was on screen whether or not it had anything
  to say, and answering "who can touch this folder?" still meant resolving
  inheritance in your head. Mocked three directions and workshopped them before
  writing any of it; the picked one was "pick a folder, see everyone on it".
  - *Fix:* the tab is a two-panel browser. Left is a filterable folder tree —
    a gold dot means the folder sets access of its own, a red one means somebody
    is shut out there — so the tree carries where the rules *are* without
    listing them. Right is one folder's whole picture: the blanket control, the
    people set on that folder, and a folded "Everyone else" line.
  - **Every row names where its level came from.** A person can be read-only here
    via this folder's blanket, a blanket several folders up, their own grant
    several folders up, or the team default, and those four are indistinguishable
    if you only print the level. `_sourceNote` says which.
  - A folder that **sets nothing** says so before you touch a control — dashed
    border, and the value reads `Inherited · Can edit` rather than `Can edit`.
    There is nothing to clear on such a folder, and the pane should not pretend
    otherwise.
  - "Everyone else" is **folded to a face stack and one sentence** by default.
    That list is the one thing in this design that grows with the team, and the
    blanket's whole point is covering people without naming them — so unfolding
    it is a choice, one click away.
  - The tree opens flat below 25 folders and at depth 1 above that, always
    auto-expands to the selection, and remembers nothing past close. The filter
    re-renders **only** `#tm-fa-tree`, because re-rendering the tab would rebuild
    the `<input>` being typed into and take the caret with it.
  - Share-dialog deep links now *select* the folder rather than highlighting a
    card in a list.
  - Found while writing the tests: the resolution rule is not what the mock said.
    Own-grant beats blanket only *at the same folder*; between folders the nearer
    grant wins regardless of which kind it is. The tests encode the real rule.
  - `.tm` widened 760→820px and the level controls to 190px, both after driving
    the running app over CDP showed the blanket card collapsing and
    `Team default · Can delete` clipping.

- [x] **The Discord release post announced the features and none of the fixes**
  — 2026-09-06. v0.18.0's notes ran to 6.4k characters; the workflow put the
  whole blob in one embed description and cut it at a hard 3800, so the post
  ended mid-sentence partway through the import section. Everything after that
  — comp tagging, the editor back button, and all six bug fixes — was never
  announced. The truncation was silent, and it always eats the *end* of the
  notes, which is exactly where Bug Fixes lives, so this got worse the more
  there was to say.
  - *Fix:* `.github/scripts/discord-release-post.py` splits the notes on their
    `###` headings, packs sections into embeds under Discord's 4096-per-
    description limit, and packs embeds into messages under the 6000-per-message
    one. The workflow posts each message in turn and warns on a non-2xx.
  - A section too large for one embed is broken on paragraph then line
    boundaries, so a split never lands mid-sentence.
  - Title, link and thumbnail ride the first embed only and the footer the last,
    so a multi-part post reads as one announcement rather than several.
  - Verified lossless against the v0.18.0 notes (every character survives the
    round trip) and unchanged for v0.14.0/v0.16.0/v0.17.0, which still go out as
    a single message.
