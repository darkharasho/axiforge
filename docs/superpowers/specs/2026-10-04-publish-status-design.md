# Publish status for builds and comps

Date: 2026-10-04
Status: approved design, pending implementation plan

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

New pure module `src/main/publishFingerprint.js` (main process only):

- `buildFingerprint(build)` — hash of a canonical projection of the
  published-page fields: `title`, `profession`, `specializations`, `skills`,
  `underwaterSkills`, `equipment`, `tags`, `notes`, `images`, `gameMode`,
  `activeAttunement`.
  Excluded: `id`, all timestamps, all `published*` fields, and local-only
  fields (`folderId`, `pinned`, `sortOrder`, `compIds`, trash and archive
  stamps).
- `compFingerprint(comp, buildsById)` — hash of the comp's page fields
  (`name`, `notes`, `images`, `tags`, `partyLines`, `gameMode`, `buildColors`,
  `categories`) plus the ordered list of `[buildId, buildFingerprint(member)]`
  for its publish members (`getCompPublishBuildIds`). A missing member hashes
  as `[buildId, null]`.
- Hashing: stable-key JSON (keys sorted recursively, `undefined` dropped),
  then SHA-256 from node `crypto`, truncated to 16 hex characters.
- Both functions take **normalized** records (the shape the stores and team
  sync hold), so key order and absent optional fields cannot change the hash.
  Images are data URLs, so they hash the same on every machine.

### 2. Stored field and derived status

- New stored field `publishedHash` on builds and comps, next to the other
  `published*` fields. `normalizeBuild` and `upsertComp` carry it.
  `upsertBuild` keeps an existing value when the input omits it, the same way
  it keeps `publishedAt`. It syncs to teammates because team sync strips only
  local-only fields.
- `publishStatus(record, ...)` returns `"never" | "current" | "stale"`:
  - `never`: no `publishedFileId`.
  - `current` / `stale`: `publishedHash` present, and the current fingerprint
    matches / does not match it.
  - Legacy (published before this ships, no `publishedHash`): fall back to
    `updatedAt !== publishedAt`. The next publish stamps a hash.
- Status is computed **only in main**. The builds and comps list/get IPC
  handlers attach a derived `publishStatus` field to each record. Comps need
  the build store to resolve members; main holds both stores.
- `publishStatus` is derived, never persisted: stores and the team-sync body
  strip it on write.
- `src/shared/publishState.js` and `src/main/shareGate.js` switch to it. The
  renderer reads `publishStatus` only, which removes the hand-maintained ESM
  duplicate of the predicate in `src/renderer/modules/share-gate.js` rather
  than adding a second one (CJS/ESM parity hazard).

### 3. Writing the hash

The hash is computed from the **exact records serialized and uploaded**, not
re-read afterwards, mirroring the existing `snapshotUpdatedAt` logic. A save
that lands during a publish therefore leaves the item correctly out of date.

- **Build publish** (`src/main/index.js`, `builds:publish-build`):
  - `buildStore.markPublished` accepts and stores `publishedHash`.
  - The publish already re-uploads every published comp containing the build,
    each with its current fields and current member builds. Each such comp
    gets `compStore.markPublished` with a `compFingerprint` over the records
    that went into its payload.
  - If any member build failed to enrich and was skipped from that payload,
    that comp's hash is **not** refreshed (it stays out of date — the upload
    was incomplete).
  - Re-stamped comps in team folders get a team `put`, as the build already
    does.
- **Comp publish** (`comps:publish-comp`): `compStore.markPublished` stores
  `compFingerprint` over the comp and its member builds as uploaded. Members
  linked to a teammate's published copy rather than re-uploaded are
  fingerprinted from the local record (the synced copy of that version).

### 4. Team pull

- `publishedHash` arrives in the synced body. `upsertBuild`/`upsertComp`
  accept it when present and keep the existing value when absent.
- Status is content-derived, so the local `updatedAt` a pull writes no longer
  matters.
- `upsertComp` also starts carrying `publishedAt` from its input, so the
  legacy fallback is right for pulled comps published before this ships.

### 5. UI

- New renderer helper `publishBadgeHtml(status, opts)`, styled after the sync
  indicator (`src/renderer/modules/sync-status.js`):
  - `current`: small "Published" mark.
  - `stale`: amber "Out of date" mark. Tooltip "Changed since last publish";
    for a comp whose own fields match but a member changed, "A build in this
    comp changed since publish". This needs main to expose which part moved:
    `publishStatus` for comps is accompanied by `publishStaleReason:
    "self" | "member"`.
  - `never`: nothing in library rows; editors show "Not published".
- Placement:
  - All five library views in `src/renderer/modules/library/content.js`
    (list, table, grid, icon, columns), for builds and comps, beside
    `itemSyncIndicatorHtml`.
  - Build and comp editors, beside the Publish button.
  - The comps list chip (`src/renderer/modules/comps/comp-list.js`) becomes
    Published / Out of date / Draft.

### 6. Filter

- A "Publish status" multi-select in the library toolbar
  (`src/renderer/modules/library/toolbar.js`) with Published / Out of date /
  Never published, stored in `libraryPrefs.activeFilters.publishStatus` and
  applied in `src/renderer/modules/library/folder-store.js` to builds and
  comps.
- The comps-list publish filter gains "Out of date" and reads
  `publishStatus` instead of `publishedFileId`.
- Not included in "save filters as smart folder" (`filtersToRule`):
  smart-folder rules evaluate persisted fields and this one is derived.

### 7. Freshness

- Saves and team pulls already refresh the library from main, which
  re-annotates.
- A comp's status depends on its members, so a build save or pull must also
  refresh the comps the renderer holds. The exact existing refresh path is to
  be confirmed during planning.
- Discord-share gating (`share-gate.js`, `shareGate.js`) switches to
  `publishStatus !== "current"`. This also fixes share being wrongly blocked on
  teammates' machines.

## Testing

Jest only (Playwright is release-only).

- Fingerprint: stable across key order; ignores local-only, timestamp and
  `published*` fields; changes on a title or skill edit; comp hash changes when
  a member build changes; missing member handled.
- `publishStatus`: all three states plus the legacy fallback; comp
  `publishStaleReason`.
- Stores: `markPublished` stores `publishedHash`; `upsertBuild`/`upsertComp`
  keep or accept `publishedHash` and `publishedAt`; `publishStatus` is never
  persisted.
- Team sync: a pulled, teammate-published build with a different local
  `updatedAt` reads `current`; a pulled comp keeps `publishedAt` and
  `publishedHash`.
- Build publish: re-stamps affected comps; does not re-stamp a comp whose
  member failed to enrich. (Extract the stamping decision into a testable
  helper if `index.js` is not directly testable.)
- Renderer: badge states, library filter, comps-list chip and filter.

## Out of scope

- `boonCoverageHtml` is computed in the renderer at comp publish; a
  build-triggered comp re-upload reuses the old coverage. Not in the
  fingerprint (it is derived from fingerprinted data). Pre-existing.
- Unpublishing / deleting published files.
- Publish status in smart-folder rules.
