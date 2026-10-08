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

**Comp v2 render.** `renderCompPage` branches on `comp.v === 2`:

1. Render the comp shell immediately: header, notes, party lines with
   placeholder slots, and the pool.
2. Fetch every member in parallel. The base URL comes from the member's `owner`
   (`raw.githubusercontent.com/<owner>/axibuilds/main/site/builds/<fileId>.enc`),
   built by a new `dataBaseForOwner(owner)` helper next to `resolveDataBase`.
   Each slot fills in as its build arrives. A member that fails (404, decrypt
   error or network error) renders as a **"Build unavailable"** slot. A member
   whose `owner` is empty uses `resolveDataBase(location, params)`.
3. Once every member has settled, compute boon coverage in the viewer:
   - Extract a pure `catalogFromPublishedBuild(build)` from
     `populateStateFromBuild` (`render-build.js`), returning the same
     `activeCatalog` shape without touching `state`.
   - Run `computeCompPartyCoverage` with a catalog cache built from those
     catalogs and a `getCatalog` that resolves immediately. Builds with a
     `boonDurationBonus` use it in place of the upgrade-catalog computation;
     add an optional override parameter so the desktop path is unchanged.
   - Render with `buildPartyCoverageHTML` and bind with the existing
     `bindPartyCoverageEvents`.
4. Each member's `spaUrl` is derived in the viewer from `owner`, `fileId` and
   `key`, matching the URL desktop builds today.

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
  file, plus the v2 file of every member owned by the publisher that is
  never-published, stale (`src/shared/publishState.js`), or still v1 (receipt
  lacks `payloadVersion: 2`). Re-uploading v1 members guarantees every member
  the publisher owns carries `boonDurationBonus`. Members owned by other users
  are referenced, not uploaded. If one of those is still v1, the viewer computes
  its coverage with a bonus of 0, so its durations show without the
  concentration or expertise boost until its owner re-publishes it.
- A member owned by nobody yet is published under the comp publisher, which is
  the same as today's auto-publish of unpublished members.
- Stamps receipts for the comp and for each member build it uploaded.

**Publish status:**

- For a v2 comp (receipt carries `payloadVersion: 2`), staleness is the comp's
  own fingerprint only. `publishedMemberHashes` is no longer written for v2.
- v1 receipts keep today's member-hash logic until re-published.
- `publishState.js` and `publish-status.js` stay in CJS/ESM parity, enforced by
  the existing parity test.

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
- **Viewer decode:** `main.js` `decrypt` handles v1 text and v2 bytes (jsdom
  with a `DecompressionStream` polyfill if needed).
- **Coverage parity:** for fixture comps, coverage data computed the desktop way
  (store builds, full catalogs, upgrade catalog) equals coverage computed the
  viewer way (`catalogFromPublishedBuild` on serialized builds,
  `boonDurationBonus`). Compare the data, not the HTML.
- **Comp serialize:** v2 has `members` with `owner`, and has no `builds` or
  `boonCoverageHtml`.
- **Comp publish:** uploads stale and never-published members owned by the
  publisher, skips current ones, never uploads another owner's member, and
  writes everything in one commit.
- **Build publish:** never writes a `site/comps/` path.
- **Publish state:** v2 comp staleness ignores member changes; v1 is unchanged;
  CJS/ESM parity holds.
- **Bundle upload:** `Buffer` entries are uploaded byte-for-byte.
- **Import:** v1 comp, v2 comp, and a v2 comp with an unreachable member.
- **Size guard:** a fixture build serializes to under 150 KB as v2.

## Out of scope

- Brotli, and pruning catalog fields from builds.
- Pasted images in comp notes. They are already base64 inside the JSON and stay
  as they are.
- Publish-on-save, debouncing and SHA-pinned reads (steps 2 and 3).
- Re-encoding existing files in bulk.
