# Smaller published payloads

Date: 2026-10-07
Status: approved design, pending implementation plan

## Goal

Shrink the encrypted files that publishing writes to the user's `axibuilds`
repo, so a publish is a small, fast commit. This is step 1 of publish-on-save
(saving publishes automatically, with no separate Publish step). Steps 2 and 3,
SHA-pinned reads and debounced batched commits, get their own specs.

Targets, measured as uploaded bytes:

| | Today | Target |
|---|---|---|
| Build | ~1.3 MB (min 866 KB) | ~90 KB |
| Comp | ~17 MB (max 27.7 MB) | a few KB plus pasted images |

Every link that already exists must keep working, and the viewer must look the
same as it does today.

## What is in a payload today

Measured on 2026-10-07 by decrypting live files from `gw2eww/axibuilds`.

**Build** (988 KB of JSON, 1.3 MB as uploaded):

- About 70% is three profession-wide catalogs from `serializeForPublish`:
  `catalogSkills` (324–395 KB), `catalogWeaponSkills` (~200 KB) and
  `catalogTraits` (~150 KB). They came in with `c82fe1b9` so the viewer can
  resolve bundle skills, flip chains, toolbelt skills and skills named in notes.
- `encryptBuild` encrypts raw JSON and base64-encodes the result, which adds
  another 33%. Ciphertext does not compress, so the CDN cannot help.
- gzip of the JSON gives ~90 KB; brotli gives ~49 KB.

**Comp** (one example, 22.6 MB as uploaded):

- `boonCoverageHtml` is 9.7 MB. Every boon cell carries its providers as JSON
  in a `data-providers` or `data-sources` attribute, and every provider entry
  inlines the full Inkscape SVG for its profession icon. That repeats across
  130 cells.
- `builds` is 7.2 MB, a complete serialized copy of every member build.
- Notes are not the problem. The longest local notes field is about 7 KB.

## Design

### 1. Envelope v2

A v2 `.enc` file is **binary**:

```
00 41 58 02 | 12-byte IV | AES-256-GCM( gzip( JSON ) ) | 16-byte tag
```

- The 4-byte header `00 'A' 'X' 02` is outside the encryption, so a reader
  knows the format before it decrypts. A v1 file is base64 text and its first
  byte can never be `00`, so the two formats cannot be confused.
- Paths, file IDs, keys and link shapes do not change. The same `.enc` path
  holds either format.
- Why gzip: browsers decompress it natively (`DecompressionStream("gzip")`)
  and Node has `zlib`. Brotli would roughly halve sizes again, but the viewer
  would need a decoder library. The version byte leaves room to add brotli
  later as `03`.
- Expected build size: ~90 KB, from gzip's ~11× plus dropping base64. The
  catalog fields stay as they are, and pruning them is out of scope.

`src/main/buildEncryption.js` gains `encryptPayload(data, key) → Buffer`, which
writes v2, and `decryptPayload(bytes, key)`, which reads v1 or v2. v1 is
recognised when the input is a string or does not start with the header.
`encryptBuild` and `decryptBuild` stay for v1, used by tests and the fallback
path.

### 2. Comp payload v2: link builds, don't embed them

`serializeCompForPublish` emits:

```js
{
  v: 2,
  id, name, notes, tags, gameMode, partyLines, buildColors,
  categories, images, notesClassIcons,
  members: { [buildId]: { fileId, key, owner } },
}
```

- `builds` and `boonCoverageHtml` are removed.
- `owner` is the GitHub login whose `axibuilds` repo holds the member's
  published file (the build's `publishedOwner`). A member a teammate published
  is read from the teammate's repo, so the comp always shows the current version
  of that build. If the teammate deletes the build, the slot shows as
  unavailable.
- Members come from `getCompPublishBuildIds(comp)`, as they do today.

### 3. Build payload additions

`serializeForPublish` adds:

- `boonDurationBonus: { concentration, expertise }`, the values
  `computeBuildConcentration` and `computeBuildExpertise`
  (`src/renderer/modules/stats.js:37,44`) produce from the upgrade catalog. The
  viewer has no upgrade catalog, so coverage needs them precomputed.

No other build fields change.

### 4. Viewer (`src/site`)

**Decode.** `decrypt` in `main.js` fetches as an `ArrayBuffer`, checks for the
header, and either:

- decrypts and pipes the result through `DecompressionStream("gzip")`, or
- falls back to the v1 path: base64 text, decrypt, then `JSON.parse`.

**Comp v2 render.** `loadComp` in `main.js` branches on `comp.v === 2`:

1. Fetch every member in parallel (`src/site/comp-members.js`). The base URL
   comes from the member's `owner`
   (`raw.githubusercontent.com/<owner>/axibuilds/main/site/builds/<fileId>.enc`).
   A member whose `owner` is empty uses `resolveDataBase(location, params)`.
   A member that fails (404, decrypt error or network error) becomes
   `{id, unavailable: true}` and renders as a **"Build unavailable"** slot. The
   pool and tag popovers leave it out.
2. Once every member has settled, compute boon coverage in the viewer
   (`src/site/comp-coverage.js`):
   - Extract pure `catalogFromPublishedBuild(build)` and
     `upgradeCatalogFromPublishedBuild(build)` from `populateStateFromBuild`
     into `src/site/published-catalog.js`. They return the same shapes without
     touching `state`. Coverage needs a separate upgrade catalog per member,
     because relics, runes and sigils grant boons.
   - Run `computeCompPartyCoverage` with a new optional `overrides` argument:
     `{catalogFor, upgradeCatalogFor, durationBonusFor}`. The desktop path is
     unchanged.
3. Hand `{...comp, builds, boonCoverageHtml}` to the existing `renderCompPage`,
   which renders and binds it exactly like a v1 comp. The page renders once
   every member has settled, not slot by slot. Member payloads are ~90 KB, so
   progressive slots aren't worth the extra render path.
4. Each member's `spaUrl` is derived in the viewer from `owner`, `fileId` and
   `key`, matching the URL desktop builds today.

`escapeHtml` moves from `main.js` to `src/site/escape.js`. `render-comp.js`
imported it from `main.js`, whose top-level `init()` made `render-comp.js`
impossible to load in a test.

**v1 comps** render exactly as they do now, from embedded `builds` and
`boonCoverageHtml`.

### 5. Desktop publish (`src/main/index.js`)

**Build publish:**

- Writes v2 through `encryptPayload`.
- **Deletes the comp fan-out** (`index.js:~1700–1765`), which re-serializes and
  re-uploads every published comp that contains the build. A v2 comp reads the
  build live, so there is nothing to refresh.
- v1 comps that contain the build stop picking up its changes until they are
  re-published, which upgrades them to v2. The existing staleness check already
  flags them, because their member hashes no longer match.

**Comp publish** (`publishCompImpl`):

- Stops computing and sending `boonCoverageHtml`. The renderer's publish
  handler in `comp-detail.js:~1418` no longer calls
  `computeCompPartyCoverage`, and the IPC, preload and local-API signature
  drops the argument.
- Builds the v2 comp payload and puts these in the **same commit**: the comp
  file, plus the v2 file of **every** member the publisher owns. This matches
  today, where comp publish re-encrypts all of its own members. It guarantees
  every owned member carries `boonDurationBonus` without tracking each file's
  format in a new receipt field. Members owned by other users are referenced,
  not uploaded. If one of those is still v1, the viewer computes its coverage
  with a bonus of 0, so its durations show without the concentration or
  expertise boost until its owner re-publishes it.
- The member decision is a pure `planCompMembers` in `compPublish.js`, built on
  the existing `decideCompBuildPublish`.
- A member owned by nobody yet is published under the comp publisher, which is
  the same as today's auto-publish of unpublished members.
- Stamps receipts for the comp and for each member build it uploaded, and
  clears the comp's local `boonCoverageHtml`.
- Publish fetches each build's catalog for **its own game mode**. Today both
  publish paths fetch the default (PvE) catalog, so a WvW build's page showed
  PvE facts. The viewer's coverage would then disagree with the desktop's.

**Publish status:** no code change.

- A v2 comp is stamped with `compReceipt(comp, [])`, i.e. an empty
  `publishedMemberHashes`. `compPublishStatus` then reports only the comp's own
  staleness, which is right because the page reads members live.
- A v1 comp keeps its member hashes, so it still reads stale when a member
  changes, until it is re-published as v2.
- `compReceiptAfterRepublish` becomes dead with the fan-out gone and is
  removed.

**Bundle upload** (`githubApi.js:~414`):

- `publishSiteBundleOnce` accepts `Buffer` values in the bundle and uploads
  them unchanged. Today the binary-or-text decision uses file extension only,
  and `.enc` would be UTF-8 encoded.
- The stale-site-file sweep already skips `site/builds/*.enc` and
  `site/comps/*.enc`, so referenced members are never removed. No change is
  needed.

### 6. Link import (`src/main/axiLinkImport.js`)

- Fetch as bytes and decode through `decryptPayload`.
- For a v2 comp, fetch each member from its owner's repo with
  `{ fileId, key }`, then hand the same `builds` map to the existing import
  path. Unreachable members are dropped, which is how unmappable slots are
  handled today.

### 7. Rollout

- The new viewer shell and the first v2 files go up in the same commit. The
  data is on raw within seconds; the Pages deploy and the browser's cached
  `index.html` (`max-age=600`) can lag by up to about 10 minutes. During that
  window an old shell fails to decode a v2 link. This happens once per repo, on
  the first publish after updating. We accept it rather than build two-phase
  publishing.
- The new viewer shows "This link was published by a newer AxiForge — refresh
  the page" for an unknown envelope version, so future format bumps fail
  readably.
- No migration of existing files. A v1 file becomes v2 the next time its build
  or comp is published.

## Testing (Jest)

- **Envelope:** v2 round-trip; v1 still decodes through `decryptPayload`; header
  detection; unknown version throws a typed error.
- **Viewer decode:** `src/site/payload.js` decodes v1 text and v2 bytes written
  by the desktop (Node's web streams and WebCrypto).
- **Duration parity:** `computeDurationStats` (main) equals the renderer's
  `computeBuildConcentration`/`computeBuildExpertise` across gear and rune
  fixtures.
- **Coverage parity:** for fixture comps, coverage data computed the desktop way
  (store builds, full catalogs, upgrade catalog) equals coverage computed the
  viewer way (`catalogFromPublishedBuild` on serialized builds,
  `boonDurationBonus`). Compare the data, not the HTML.
- **Comp serialize:** v2 has `members` with `owner`, and has no `builds` or
  `boonCoverageHtml`.
- **Comp publish:** `planCompMembers` uploads every member the publisher owns,
  reusing existing file IDs and keys. It links a teammate's member from their
  repo and never uploads it, unless `force` is set.
- **Build publish:** no build→comp fan-out, no coverage-HTML argument, and
  catalogs fetched per game mode. `index.js` can't load under Jest, so these
  are pinned by a source-level test.
- **Publish state:** covered by the existing `compPublishStatus` tests, since a
  v2 comp's receipt simply has an empty member-hash map.
- **Bundle upload:** `Buffer` entries are uploaded byte-for-byte.
- **Import:** v1 comp, v2 comp, and a v2 comp with an unreachable member.
- **Size guard:** v2 of a catalog-heavy fixture is under a fifth of its v1 size.
  A one-off measurement on a real local build confirms the ~90 KB target.

## Out of scope

- Brotli, and pruning catalog fields from builds.
- Pasted images in comp notes. They are already base64 inside the JSON and stay
  as they are.
- Publish-on-save, debouncing and SHA-pinned reads (steps 2 and 3).
- Re-encoding existing files in bulk.
