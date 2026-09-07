# Local Build History v2 — Design

**Date:** 2026-09-06
**Status:** Approved, ready for implementation planning
**Scope:** `src/main/historyStore.js`, `buildHistoryStore.js`, `compHistoryStore.js`,
`src/main/index.js` history IPC, `teamSync.js`, `trash.js`,
`src/renderer/modules/library/history-panel.js`, `packages/forge-render/src/mini-build-card.js`

---

## Problem

Build and comp version history is capped at 50 entries per record and stores a
full object snapshot per entry. Two things are wrong with it.

**Depth.** The cap is not a retention policy, it is a throughput brake.
`HistoryStore.addEntry` calls `#readAll()` — parsing the *entire* history file
for *every* record — and `#writeAll()` rewrites all of it, on every single save
(`historyStore.js:80-101`). Lifting the cap on the current design makes every
save O(total history).

**Fidelity.** `summarizeBuildChange` is a hand-written list of `if` checks
(`buildHistoryStore.js:22-56`). Anything it does not recognise falls through to
the string `"build updated"`, and the entry still costs a full snapshot.

### Measured baseline

From the live profile at `~/.config/axiforge-desktop/data` on 2026-09-06:

| Metric | Value |
|---|---|
| `builds.json` | 63 builds, ~14 KB each |
| `build-history.json` | **2.9 MB / 131 entries** across 39 records (~22 KB per entry) |
| Deepest single record | 17 versions — nothing has reached the 50 cap |
| `comps.json` | 9 comps at **~2.2 MB each** |
| `comp-history.json` | empty in prod (a capped-out comp log would be ~110 MB) |

Entry summaries, by frequency:

```
  63  build updated      ← 48%
  20  Created
   9  notes updated
   6  specializations changed; heal, utility 1, ...
   3  sigils, infusions changed; notes updated
```

**Half of all recorded history is the fallback string.** Those come from saves
whose only change was outside the fields the summarizer checks — folder moves
(`library.js:470`), `compIds` edits (`library.js:798`, `comp-detail.js:1054`),
archive stamps. Each costs 22 KB and tells the user nothing. The effective
depth is therefore ~25 useful entries, not 50.

There is also a latent false-positive: `_describeSkillChanges` compares skills
with `JSON.stringify` (`buildHistoryStore.js:66-72`), and skills embed the full
GW2 API object including `description`. A game patch that rewrites a
description makes an untouched build look edited on the next api-cache refresh.

## Goals

1. Unlimited retention — no cap, and no depth-proportional cost per save.
2. Real structural diffs, surfaced as both readable summary text and a visual
   side-by-side comparison.
3. Eliminate `"build updated"` as a possible output.
4. Migrate existing history without loss, improving it in the process.

## Non-goals

- Syncing history to teammates. History stays local; remote-origin changes are
  still *recorded* locally exactly as they are today (`source: "remote"`).
- Branching, merging, or any version-control UX beyond linear history + restore.
- Per-build diffs nested inside a comp comparison.
- Retention tiering or pruning. Growth is bounded by delta storage, not policy.

## Rejected alternatives

**Real git (`isomorphic-git`).** Packfile delta compression solves storage, and
`git log` is a free debugging tool. Rejected because the feature actually
requested — semantic diffs — is the part git does not provide: it diffs
pretty-printed JSON as text lines, so a rune swap renders as
`-  "id": 24836` / `+  "id": 24615`. The structural differ has to be written
either way, so git buys compression at the cost of a ~1 MB dependency, a second
corruptible on-disk format, and index-lock contention between sync pulls and
local saves.

**SQLite (`better-sqlite3`).** Clean queries over a `versions` table, but it is
a native module requiring per-platform rebuilds in the electron-builder
pipeline — real operational cost (mac signing has already cost a release) for
something a directory of append-only files handles.

**Raising the cap in place.** Rejected outright: at `cap = 500` the current
design parses and rewrites ~30 MB per build save, and gigabytes for comps.

---

## Architecture

### Storage layout

One append-only file per record. No central index.

```
data/history/
  builds/<buildId>.jsonl
  comps/<compId>.jsonl
```

A central `index.jsonl` was considered and dropped: it is a derived cache that
can desync from the record files on a mid-write crash, and it buys nothing.
`folders:get-history` already computes exactly which record ids it wants (it
builds `titleMap` before touching history), so the folder feed reads only those
files.

### Line format

Each line is one version. `v` is monotonic per record.

```json
{"v":1,"ts":"…","author":"local","source":"local","kind":"key","summary":"Created","doc":{…}}
{"v":2,"ts":"…","author":"local","source":"local","ops":[…],"summary":"helm rune: Scholar → Durability"}
```

`kind` is one of:

| `kind` | Meaning | Payload |
|---|---|---|
| `key` | Keyframe — verbatim document | `doc` |
| *(absent)* | Delta | `ops` |
| `meta` | Incidental-only change (folder move, archive stamp) | `ops` |
| `delete` | Record was trashed | `doc` (last known state) |

Every 20th version is a keyframe, and `v1` always is one. Reconstructing
version N reads back to the nearest keyframe and applies ops forward — at most
20 lines, regardless of history depth.

### Write path

`appendVersion({recordId, before, after, author, source})`:

1. `ops = diff(before, after)`. **Zero ops writes nothing and returns `null`.**
2. Ops are classified *substantive* (gear, traits, skills, title, notes) vs
   *incidental* (`folderId`, `compIds`, `archivedAt`). An incidental-only change
   is written as `kind:"meta"` with a real summary — `moved to Raids/Support`,
   not `build updated` — so folder moves stay visible in a shared folder's feed
   without masquerading as build edits.
3. **Coalescing.** If the previous version has the same `author` and `source`
   and its `ts` is within `COALESCE_WINDOW` (5 minutes), merge rather than
   append: re-diff from the version *before* it to `after` and replace the last
   line. The last line's byte offset is cached in memory and the file is
   `ftruncate`d to it before appending. A cold start with no cached offset reads
   the final 64 KB to locate the last newline — bounded, never a full read.
4. Appends stay serialized per record via the existing `#writeQueue`, so a sync
   pull and a local save cannot interleave.

### Crash safety

A torn final line is the only corruption an append-only file can produce. The
reader drops an unparseable tail line and logs it. Worst case the most recent
version is lost; the file never is.

### Version semantics

**This is a behavioural change from v1.** Today `entry.snapshot` holds the state
*before* the logged change, which is why the panel labels even the newest entry
"Restore this version" and means "undo the last change"
(`history-panel.js:312-316`).

In v2 each version is the state *after* its change — this is what makes patches
compose. Restoring "the state before change N" is restoring version N-1. The
panel's entry→button mapping changes accordingly, and migration shifts old
entries by one to preserve their meaning.

### Storage cost

Patches carry full `before`/`after` values (see *Patch size tradeoff*), so a
patch is ~0.5–1 KB depending on whether it touches string-valued gear slots or
object-valued skills and traits. Keyframes are a full ~14 KB document.

| Case | v1 | v2 |
|---|---|---|
| Current 131 versions | 2.9 MB | ~160–220 KB (7 keyframes ≈ 98 KB + 124 patches) |
| One build, daily edits, 2 years (730 versions) | impossible (cap 50) | ~0.9–1.2 MB (37 keyframes + 693 patches) |

Roughly 15× smaller than today at current volume, with the cap removed
entirely. Keyframe interval trades reconstruction speed against size: at 20 it
is ~40% keyframe bytes, and raising it shrinks files at the cost of a longer
forward walk.

Comps benefit more, not less: a 2.2 MB comp is mostly per-slot build data that
does not change between versions, so a slot swap is a small patch rather than a
2.2 MB snapshot.

---

## The diff engine

`src/main/history/diffBuild.js` — exports `diff`, `applyOps`, `invert`.

### Op vocabulary

Domain-shaped rather than JSON-Pointer-shaped, because the compare view needs to
know that a rune is a rune:

```js
{t:"skill",  slot:"utility2", uw:false, before:{…}, after:{…}}
{t:"trait",  line:1, tier:3,            before:{…}, after:{…}}
{t:"gear",   slot:"head", part:"rune",  before:"…", after:"…"}
{t:"stat",   before:"Berserker", after:"Dragon"}
{t:"field",  path:"notes",              before:"…", after:"…"}
{t:"meta",   path:"folderId",           before:"…", after:"…"}
{t:"raw",    path:"images.icon3",       before:…,   after:…}
```

`raw` is the fallback for any path without a domain op. It exists so the differ
**cannot silently drop a change** — which is exactly what the v1 summarizer does
when it falls through all its `if`s.

### Identity vs deep-equality

Skills, traits and items compare on `id`, falling back to `name` — never on the
whole object. A description rewrite from a game patch produces no op, fixing the
false-positive class described in Problem.

### Ignored fields

`updatedAt` and `version` change on every save and are excluded from ops
entirely; otherwise every save would log an entry and defeat the zero-ops rule.
Keyframes still carry them, since a keyframe is a verbatim document.

### The invariant

```
applyOps(before, diff(before, after)) ≡ after      (ignoring updatedAt/version)
```

If the differ ever fails to describe something, the round-trip test fails —
rather than a user silently losing data on restore. `invert(ops)` yields the
reverse patch, used by "undo this change".

### Patch size tradeoff

Ops carry **full** `before`/`after` values, including description strings,
because reconstruction must be faithful for restore to be trustworthy. A skill
swap is therefore a ~1.2 KB patch, not ~200 bytes — still 18× better than a
22 KB snapshot.

The rejected alternative was storing only `{id, name}` and rehydrating
descriptions from `api-cache.json` at read time. That makes patches tiny, but a
restore performed when the cache is cold, or after an item is removed from the
game, produces a build with holes in it. Not worth a few hundred KB.

### Summary text

`renderSummary(ops)` derives the summary from the ops, so it cannot drift from
what actually changed. Above ~4 ops it groups: `3 gear slots, 2 sigils, notes`.
`"build updated"` stops being a possible output, because zero ops means no
entry is written at all.

`src/main/history/diffComp.js` applies the same vocabulary one level up — ops on
squad slots referencing build ids.

---

## The compare view

### Entry list

The existing 380px slide-in panel keeps its role as a scannable log. It gains
better text via `renderSummary(ops)`. No layout change, no new entry point.

### Compare modal

Clicking an entry opens a modal in the style of `detail-modal.js` /
`form-modal.js`. 380px cannot hold two builds side by side.

**Header:** two pickers, `Compare [v12 ▾] with [v11 ▾]`. The default is the
selected version against its immediate predecessor — that answers "what did this
entry change", which is the question the click expressed. The right picker's
second option is **Current**, one click away, for "how far has this drifted".

**Two deliberately redundant layers:**

1. **Side-by-side cards** — two `renderMiniBuildCard(build, catalog, opts)`
   outputs with changed pieces outlined. Requires additive `data-slot` /
   `data-trait` / `data-skill` attributes in
   `packages/forge-render/src/mini-build-card.js` as highlight anchors. That
   package is also consumed by the SPA (`src/site/render-comp.js`) — adding
   attributes cannot break existing consumers, but the shared package's tests
   are in scope.
2. **A change table underneath** — one row per op: what changed, before → after,
   with icons. Driven straight off the ops array with no DOM mapping, so a
   missed highlight still shows the change. Given v1's habit of swallowing
   changes, the fallback is the authoritative view.

**Actions:** `Restore this version` on the left column, reusing the existing
confirm flow. Per the version-semantics change, restoring vN restores the state
*after* change N, and the button copy must say so.

**Comps** compare at slot level in the same modal — each column is the squad
grid, changed slots outlined, the change table listing slot swaps. It does not
recurse into per-build diffs; that is what the build's own history is for.

New file: `src/renderer/modules/library/history-compare.js`.

---

## Migration

Runs once at init, when `build-history.json` exists and `data/history/` does not.

v1 entries are newest-first and each `snapshot` is the state *before* its
change. For a record with entries `e₁…eₙ` (newest→oldest): `eₙ.snapshot` is the
oldest state, the change `eₖ` produced `eₖ₋₁.snapshot`, and `e₁`'s change
produced the doc currently live in `builds.json`. Migration walks that
backwards:

- `v1` = keyframe of `eₙ.snapshot`
- for `k = n…1` — a version carrying `eₖ`'s `ts`/`author`/`source`, with
  `ops = diff(prev, next)` where `next` is `eₖ₋₁.snapshot`, or the live doc when
  `k = 1`
- records whose build has been purged stop at `e₁.snapshot`

**Summaries are recomputed, not copied.** Old entries pass through the new
differ, so the 63 `"build updated"` lines retroactively become descriptive. The
existing history improves rather than remaining a dead zone beneath a good new
one.

`build-history.json` is **renamed** to `build-history.json.pre-v2`, not deleted.
It is ~3 MB and it is the only copy; rollback is a file rename.

**Failure handling:** a record that fails to migrate is logged, starts fresh at
a `v1` keyframe of its current doc, and the app starts normally. History is a
convenience feature and must never block launch. The `.pre-v2` file remains for
manual recovery.

---

## Integration points

| Site | Change |
|---|---|
| `index.js:622,641` `builds:save` | `addEntry(before-snapshot)` → `appendVersion(id, existing, build)`. Note the inversion: v1 logs the *old* doc before saving; v2 logs the *new* state after. |
| `index.js:721,827` `builds:revert` | Keyed by `(id, v)` instead of entry id. Still writes its own `source:"revert"` version, so a revert stays undoable. |
| `index.js:729` `folders:get-history` | `getAllHistory()` → `listTails(recordIds, limit)`. This is the O(corpus) read that disappears. |
| `teamSync.js:830-850` | Remote pulls become `appendVersion(before=local, after=incoming, source:"remote")`. The `isOwnWrite` guard is unchanged. |
| `teamSync.js:630-646` | Deletions become a `kind:"delete"` version carrying a keyframe of the last known doc, so the panel's "Bring it back" still has something to restore. |
| `trash.js:181-184` | `deleteHistory(id)` unlinks the record file instead of rewriting the corpus. |
| `comps:revert` (`index.js:801-823`) | Same treatment as `builds:revert`. |

### Store API

The `HistoryStore` base + `BuildHistoryStore` / `CompHistoryStore` subclass split
survives — it is the right seam, and only the storage half changes.

```
appendVersion({recordId, before, after, author, source})  → version | null
listVersions(recordId, {limit, cursor})                   → newest-first, paginated
getVersion(recordId, v)                                   → reconstructed doc
listTails(recordIds, limit)                               → folder feed
deleteHistory(recordId)                                   → unlink
```

`getAllHistory()` is **deleted**. With per-record files it cannot be implemented
cheaply, and the folder feed was its only caller.

---

## Testing

The round-trip invariant carries the safety load, tested three ways:

1. **Generated mutations** — fixture builds with randomized edits (swap a rune,
   drop a trait line, empty the utility bar, add an unknown top-level key),
   asserting round-trip. The unknown-key case proves the `raw` fallback works,
   which is why silent data loss cannot recur.
2. **Against the real corpus** — a script that migrates a *copy* of the live
   2.9 MB `build-history.json` and asserts every reconstructed version
   deep-equals the snapshot it came from. This must be green before the feature
   touches a live profile.
3. **Edge shapes** — `null`/absent equipment, the 0-length
   `underwaterSkills.utility` array present in real data, builds mid-import with
   partial fields.

**Store suite** (extends `tests/unit/buildHistoryStore.test.js`, 337 lines):
append; zero-ops writes nothing; coalescing inside and outside the 5-minute
window; author/source change breaks coalescing; keyframe every 20th version;
reconstruction from a cold start with no cached byte offset; hand-truncated
final line recovers to the previous version; `deleteHistory` unlinks.

**Migration suite** — old-format fixtures: normal record; record whose build is
purged; legacy entries with no `snapshot`; corrupt record (asserts
fresh-start-and-log rather than throw); summary recomputation.

**Integration** — `teamSync` suites gain remote-pull and delete-tombstone
version assertions; `trash.test.js` gains file unlink; `folders:get-history`
gains a `listTails` ordering/pagination test.

**E2E** — `tests/e2e/specs/comp-history.spec.js` extended and a new build-history
compare spec written, but **not run during development**. Those belong to the
release gate. The dev loop is jest at `--maxWorkers=2`.

---

## Risks

| Risk | Mitigation |
|---|---|
| Differ drops a field, restore loses data | Round-trip invariant + `raw` fallback op; corpus test over all 131 real versions |
| Migration corrupts the only copy of history | Source file renamed to `.pre-v2`, never deleted; per-record failure isolation |
| Version-semantics change confuses restore | Migration shifts entries by one; panel button copy updated; covered by store + E2E specs |
| `forge-render` change breaks the SPA | Attributes are additive only; package tests in scope |
| Coalescing merges edits that should be distinct | Window is a single constant, and coalescing never crosses author or source |
