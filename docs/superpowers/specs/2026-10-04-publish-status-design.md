# Publish status for builds and comps

Date: 2026-10-04
Status: approved design (revised 2026-10-04: status derived from attached hashes), pending implementation plan

## Goal

Every build and comp — local or in a team folder — shows whether it is
**never published**, **published and current**, or **published but out of
date** (changed since its last publish). The answer must be the same on every
teammate's machine.

"Changed" means anything that appears on the published page. A comp is also
out of date when one of its member builds has changed since the comp was last
published, because the comp page would show the old build.

## Why today's check is wrong

`src/shared/publishState.js` calls a record stale when
`updatedAt !== publishedAt`. That breaks for team items:

- A team pull runs `upsertBuild`/`upsertComp`, which stamps a local
  `updatedAt` (`buildStore.js:226`, `teamSync.js:972`). A teammate-published
  build therefore reads stale on everyone else's machine.
- `upsertComp` never copies `publishedAt` from its input, so a pulled comp
  loses it and reads fresh even when it is not.
- Any non-content write (folder move, archive, history restore) bumps
  `updatedAt` and falsely marks the item stale.

The library shows no publish status for builds or comps. The comps list has a
two-state Published/Draft chip that ignores staleness.

## Design

### 1. Fingerprint

New pure module `src/main/publishFingerprint.js` (main process only, node
`crypto`):

- `buildFingerprint(build)` hashes a **normalized** build (the shape
  `normalizeBuild` produces) with these keys removed: `id`, `version`,
  `createdAt`, `updatedAt`, `buildUrl`, every `published*` field, the local-only
  fields (`folderId`, `compIds`, `pinned`, `sortOrder`), the trash and archive
  stamps, and `activeLegendSlot` (a view toggle; history treats it as
  bookkeeping too). Exclusion rather than an allowlist, so a content field added
  later is covered by default.
- `compFingerprint(comp)` hashes the comp's **own** page fields only:
  `name`, `notes`, `images`, `tags`, `buildIds`, `partyLines` (capacity and
  slots per line; line ids are not shown and are regenerated for legacy
  records), `gameMode`, `buildColors`, `categories`. Absent fields hash as
  their `upsertComp` defaults, so a save that only fills in defaults does not
  change the hash.
- Hashing: stable-key JSON (keys sorted recursively, `undefined` dropped),
  SHA-256, truncated to 16 hex characters. Images are data URLs, so they hash
  the same on every machine.

### 2. Stored receipt, attached hash, derived status

- **Stored** (the publish receipt, next to the other `published*` fields):
  - builds and comps: `publishedHash`, the fingerprint of what was uploaded;
  - comps also: `publishedMemberHashes`, `{ buildId: buildFingerprint }` for
    each member build as it went into the comp page.
  `normalizeBuild` and `upsertComp` carry them; `upsertBuild`/`upsertComp`
  keep the existing values when the input omits them, the same way
  `upsertBuild` keeps `publishedAt`. They sync to teammates because team sync
  strips only local-only fields. History lists them as non-versioned
  bookkeeping, so a publish never writes a history version.
- **Attached, never stored:** main's `builds:list`, `builds:save`,
  `comps:list` and `comps:save` handlers attach `contentHash` (the current
  fingerprint) to each record they return. The stores drop unknown fields on
  write, so a `contentHash` sent back by the renderer is discarded. The
  `builds:save`/`comps:save` handlers also strip `publishedHash` and
  `publishedMemberHashes` from renderer payloads: main owns the receipt, so a
  stale renderer object can never regress it.
- **Derived** by a pure comparison, no hashing, in `src/shared/publishState.js`
  (CJS, main) and an ESM twin `src/renderer/modules/publish-status.js`
  (renderer), locked together by a parity test (the repo's existing pattern):
  - `publishStatus(record)` → `"never" | "current" | "stale"`:
    - `never`: no `publishedFileId`;
    - with `publishedHash`: `contentHash === publishedHash` → `current`, else
      `stale`. A record with no `contentHash` (not yet annotated) reads
      `current` until the next list reload; main always annotates before it
      gates anything;
    - legacy (published before this ships, no `publishedHash`):
      `updatedAt !== publishedAt` → `stale`. The next publish stamps a hash.
  - `compPublishStatus(comp, buildOf)` → `{ status, reason }`, `reason` is
    `"self" | "member" | null`. The comp's own `publishStatus` first; if that
    is `current` and the comp has a `publishedHash`, each
    `publishedMemberHashes` entry is compared to `buildOf(id).contentHash`.
    A mismatch → `stale`/`member`. A member that is not in the library, or
    has no `contentHash`, is skipped (cannot be judged; republishing would
    only drop it).
- Because a comp's member check reads `state.builds`, a comp's status is right
  whenever the builds list is fresh. Nothing has to reload comps after a build
  save.

### 3. Writing the receipt

The receipt is computed from the **exact records serialized and uploaded**,
not re-read afterwards, mirroring the existing `snapshotUpdatedAt` logic. A
save that lands during a publish therefore leaves the item correctly out of
date.

- **Build publish** (`builds:publish-build`):
  - `buildStore.markPublished` accepts and stores `publishedHash`, from the
    `build` snapshot that was serialized.
  - The publish already re-uploads every published comp containing the build.
    Each such comp gets `compStore.markPublished` with
    `publishedHash = compFingerprint(comp)` and `publishedMemberHashes` over
    the member records that went into its payload.
  - If any member build failed to enrich and was skipped from that payload,
    that comp's receipt is **not** refreshed (it stays out of date — the
    upload was incomplete).
  - Re-stamped comps in team folders get a team `put`, as the build does.
- **Comp publish** (`comps:publish-comp`): `compStore.markPublished` stores the
  comp's `publishedHash` and `publishedMemberHashes` over its members as
  uploaded. Members linked to a teammate's published copy rather than
  re-uploaded are fingerprinted from the local record (the synced copy of
  that version). Every member it re-uploaded under our owner also gets its
  `publishedHash` stamped (today only members that need a new record are
  stamped); a team `put` goes out only when the build's receipt changed.
- **History revert** (`builds:revert`, `comps:revert`): the history document
  carries the receipt from that point in time. The revert strips the receipt
  fields before upserting so the current receipt is kept; otherwise a revert
  to the last-published version would read "Published" while the page shows
  a later publish.
- **Library duplicate** (`handleDuplicate`, `handleDuplicateComp`): the copy
  drops every `published*` field. Today it copies `publishedFileId` and
  `publishedKey`, so a duplicate claims the original's published page.

### 4. Team pull

- The receipt arrives in the synced body. `upsertBuild`/`upsertComp` accept it
  when present and keep the existing value when absent.
- Status is content-derived, so the local `updatedAt` a pull writes no longer
  matters.
- `upsertComp` does **not** carry `publishedAt` from its input. (Revised during
  implementation: a pull writes a local `updatedAt`, so carrying `publishedAt`
  would make every legacy team comp read out of date on teammates' machines.
  Legacy comps behave as before until their next hash-stamped publish.)
- Known limit: a teammate on an older version publishes without a hash, so
  the receipt this machine holds stays at the last hash-stamped publish.

### 5. UI

- The ESM module also exports `publishBadgeHtml(status, { reason, editor })`,
  styled after the sync indicator (`src/renderer/modules/sync-status.js`):
  - `current`: small "Published" mark.
  - `stale`: amber "Out of date" mark. Tooltip "Changed since last publish";
    with reason `member`, "A build in this comp changed since publish".
  - `never`: nothing in library rows; editors show "Not published".
- Placement:
  - All five library views in `src/renderer/modules/library/content.js`
    (list, table, grid, icon, columns), for builds and comps, beside
    `itemSyncIndicatorHtml`.
  - Build and comp editors, beside the Publish button (hidden on the web
    playground, where publishing is not available).
  - The comps list chip (`src/renderer/modules/comps/comp-list.js`) becomes
    Published / Out of date / Draft.

### 6. Filter

- A "Publish" multi-select in the library toolbar
  (`src/renderer/modules/library/toolbar.js`) with Published / Out of date /
  Never published (`current` / `stale` / `never`), stored in
  `libraryPrefs.activeFilters.publishStatus` and applied in
  `src/renderer/modules/library/folder-store.js` to builds and comps.
- The comps-list Status filter gains "Out of date" and reads the derived
  status instead of `publishedFileId`: values `published` (current), `stale`,
  `draft` (never).
- Not included in "save filters as smart folder" (`filtersToRule`):
  smart-folder rules evaluate persisted fields and this one is derived.

### 7. Freshness

- Saves and team pulls already refresh `state.builds`/`state.comps` from main,
  which re-annotates.
- Comp member staleness reads `state.builds`, so it follows build saves and
  pulls with no extra refresh.
- After a build publish the renderer also reloads `state.comps` (main
  re-stamped comps); after a comp publish it also reloads `state.builds` (main
  stamped members) and refreshes the editor badge.
- Discord-share gating switches to the derived status
  (`shareGate.js` in main, `share-gate.js` in the renderer); comps include the
  member check. This also fixes share being wrongly blocked on teammates'
  machines.

## Testing

Jest only (Playwright is release-only).

- Fingerprint: stable across key order; ignores local-only, timestamp and
  `published*` fields; changes on a title or skill edit; comp defaults and
  party-line ids do not change it.
- `publishStatus` / `compPublishStatus`: all three states, the legacy
  fallback, un-annotated records, member mismatch, missing member; CJS/ESM
  parity over a fixture matrix.
- Stores: `markPublished` stores the receipt; `upsertBuild`/`upsertComp` keep
  or accept it and `publishedAt`; `contentHash` is never persisted.
- History: a receipt change writes no version.
- Team sync: a pulled, teammate-published build with a different local
  `updatedAt` reads `current`; a pulled comp keeps `publishedAt` and its
  receipt.
- Publish: receipt helpers, including "no receipt when a member was skipped".
- Revert and duplicate strip the receipt.
- Renderer: badge states, library filter, comps-list chip and filter, share
  tooltips.

## Out of scope

- `boonCoverageHtml` is computed in the renderer at comp publish; a
  build-triggered comp re-upload reuses the old coverage. Not in the
  fingerprint (it is derived from fingerprinted data). Pre-existing.
- Unpublishing / deleting published files.
- Publish status in smart-folder rules.
