# Comp Share Codes Design Spec

> Version 1 — March 2026

## Overview

Extend the `@mks.haro/axicode` npm package to support encoding and decoding full party compositions as shareable text codes. Comp codes follow the existing `<AxiForge:...>` token format and embed all build data inline using the existing build encoder, enabling self-contained sharing with zero external dependencies.

## Token Format

```
<AxiForge:Comp:base64urlPayload>
```

The `Comp` label distinguishes comp codes from build codes (which use the elite spec or profession name as the label). The payload is a base64url-encoded, deflate-compressed JSON object.

### Example

```
<AxiForge:Comp:eJyNkU1qwzAQhe9...longPayload...>
```

## Encoding Pipeline

```
Comp + Builds
    → Assemble JSON schema
        → Deduplicate builds (encode each unique build via axicode.encode, store Z85 payloads)
        → Map party line slots to build indices
    → JSON.stringify
    → Deflate compress (pako/zlib)
    → Base64url encode
    → Wrap in <AxiForge:Comp:...> token
```

Decoding is the reverse:

```
Strip <AxiForge:Comp:...> wrapper
    → Base64url decode
    → Inflate decompress
    → JSON.parse
    → Decode each build Z85 payload via axicode.decode
    → Expand slot indices to build references
    → Return structured comp object
```

## JSON Schema (Pre-Compression)

```json
{
  "v": 1,
  "n": "Wing 4 Comp",
  "g": "pve",
  "b": [
    "Z85buildPayload0",
    "Z85buildPayload1",
    "Z85buildPayload2"
  ],
  "p": [
    { "c": 5, "s": [0, 1, 2, -1, -1] },
    { "c": 5, "s": [1, 2, 0, -1, -1] }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `v` | number | Schema version (starts at 1) |
| `n` | string | Comp name (max 140 chars) |
| `g` | `"pve"` \| `"wvw"` \| `null` | Game mode. The app data model only supports `"pve"` and `"wvw"` for comps (not `"pvp"`). If an unrecognized value is decoded, it defaults to `null`. |
| `b` | string[] | Deduplicated build payloads — each is a Z85 string produced by the existing `axicode.encode()` |
| `p` | object[] | Party lines, in order |
| `p[].c` | number | Party line capacity (number of slots) |
| `p[].s` | number[] | Slot assignments — index into the `b` array, or `-1` for an empty slot. Always padded to length `c` (see below). |

### Slot Padding

In the app data model, party line `slots` is a compact array of build IDs — empty positions are implied by comparing `slots.length` to `capacity`. In the wire format, the `s` array is always **padded to length `c`** with `-1` entries for empty positions. The encoder pads trailing empty slots; the decoder strips trailing `-1` entries when reconstructing the app-model representation.

### Build Deduplication

Builds are deduplicated by Z85 payload string equality. If the same build occupies multiple slots (across any party lines), it is encoded once in `b` and referenced by its index in multiple `s` arrays. This keeps the payload compact for comps that reuse the same build in multiple positions.

### Fields Excluded

The following comp fields are **not** encoded:

- `notes` — Personal/strategic notes, not part of the shareable build composition
- `tags` — Organizational metadata specific to the sender's library
- `id`, `folderId`, `sortOrder` — Internal identifiers
- `publishedSlug`, `publishedFileId`, `publishedKey` — Publishing state
- `createdAt`, `updatedAt` — Timestamps
- `buildIds` — Reconstructed on import from the set of builds referenced by party line slots. Builds that exist in `buildIds` but are not assigned to any slot (i.e., in the comp's build pool but unplaced) are not encoded and will be lost on export.
- Party line `id` fields — New UUIDs are generated on import

## Package API (`@mks.haro/axicode`)

Three new exports alongside the existing build encode/decode:

```js
// Encode a comp into a share code
axicode.encodeComp(comp, builds) → "<AxiForge:Comp:...>"

// Decode a share code back into a comp object
axicode.decodeComp(code) → { name, gameMode, builds, partyLines } | null

// Validate a comp code format
axicode.isValidCompCode(text) → boolean
```

### `encodeComp(comp, builds)`

**Parameters:**
- `comp` — Comp object with `name`, `gameMode`, `partyLines` (each with `slots` containing build IDs)
- `builds` — Array or map of build objects referenced by the comp

**Returns:** String in `<AxiForge:Comp:payload>` format.

**Process:**
1. Encode each unique build via `axicode.encode(build)` — extract just the Z85 payload (strip the `<AxiForge:Label:` wrapper). If any build fails to encode, the entire `encodeComp` call fails (returns `null`) — the user's own data should always be valid.
2. Deduplicate by Z85 string equality, building an index map
3. Map each party line's slots to indices into the deduplicated build array. Pad each `s` array to length `c` with `-1` for empty positions.
4. Assemble the JSON schema object
5. `JSON.stringify` → deflate → base64url encode → wrap

### `decodeComp(code)`

**Parameters:**
- `code` — String in `<AxiForge:Comp:payload>` format

**Returns:** Decoded comp object, or `null` on failure.

```js
{
  name: "Wing 4 Comp",
  gameMode: "pve",
  builds: [decodedBuild0, decodedBuild1, ...],
  partyLines: [
    { capacity: 5, slots: [decodedBuild0, decodedBuild1, decodedBuild2] },
    { capacity: 5, slots: [decodedBuild1, decodedBuild2, decodedBuild0] }
  ]
}
```

Party line slots are expanded from indices to full decoded build objects. Empty slots (wire format `-1`) are **stripped** — the `slots` array only contains populated entries, matching the app data model where empty positions are implied by `slots.length < capacity`. The `builds` array contains the deduplicated set, used by the IPC handler to iterate and create library builds. When the same build appears in multiple slots, those slots hold **shared references** to the same decoded object — the consumer (IPC handler) is responsible for creating separate library builds and assigning unique IDs.

Note: Decoded builds are **partial** — they contain profession, specializations, skills, and equipment, but lack app-model fields like `id`, `title`, `folderId`, `compId`, `createdAt`, etc. The IPC handler assigns these when creating library entries.

### `isValidCompCode(text)`

Checks `<AxiForge:Comp:` prefix, `>` suffix, and that the payload portion between them is non-empty. Does not validate payload contents. Consistent with `isValidShareCode` behavior for builds.

## Desktop App Integration

### Export (Comp Detail View)

- Add a "Copy Share Code" button/context menu option to the comp detail toolbar (alongside existing publish/Discord buttons)
- On click: gather the comp and its builds, call `encodeComp` via IPC, write result to clipboard
- Show a brief toast/notification confirming the code was copied
- Same UX pattern as the existing build AxiCode copy in the library

### Import (Comp List View)

- Extend the existing paste handler to detect `<AxiForge:Comp:` prefix (currently only handles build AxiCodes and JSON)
- On valid comp code detection:
  1. Call `decodeComp` via IPC
  2. Create new builds in the library for each decoded build (always create fresh — no deduplication against existing builds)
  3. Create a new comp with the decoded name, game mode, and party line structure, wired to the newly created builds
  4. Navigate to the new comp's detail view
- If decoding fails, show an error notification

### IPC Handlers

Two new IPC channels in the main process:

- `comps:encode-share-code` — Takes comp ID, gathers comp + builds from stores, returns the encoded string
- `comps:import-share-code` — Takes code string, decodes via `decodeComp`, creates new builds in the build store, creates a new comp in the comp store wired to those builds, returns the new comp ID. This combines decode + persist in one IPC call for simplicity (the renderer doesn't need the intermediate decoded state)

## Size Estimation

| Scenario | Unique Builds | Pre-Compression | Post-Compression (est.) |
|----------|---------------|-----------------|------------------------|
| Small comp (2 lines, 5 builds) | 5 | ~450 chars | ~300-350 chars |
| Typical comp (2 lines, 10 builds) | 10 | ~800 chars | ~500-600 chars |
| Large comp (5 lines, 20 builds) | 20 | ~1500 chars | ~900-1100 chars |
| Max comp (10 lines, 50 slots, 30 unique) | 30 | ~2500 chars | ~1500-2000 chars |

Typical comps fit comfortably in Discord messages (2000 char limit), forum posts, and chat.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Invalid wrapper format | `decodeComp` returns `null` |
| Base64url decode failure | Returns `null` |
| Inflate/decompress failure | Returns `null` |
| JSON parse failure | Returns `null` |
| Unknown schema version (`v` > 1) | Returns `null`, log warning. Unknown fields are ignored for forward-compatibility. |
| Individual build decode failure | Skip the failed build, mark all its slots as empty. Show a warning to the user ("X of Y builds could not be decoded — they may require a newer version of AxiForge"). |
| `name` missing or empty | Default to `"Untitled Comp"` |
| `name` exceeds 140 chars | Truncate to 140 chars |
| `p` array is empty | Return comp with no party lines (valid — the IPC handler can add a default line if desired) |
| `gameMode` is unrecognized value (including `"pvp"`) | Default to `null` |
| Party line capacity out of range (`c` < 1 or > 50) | Clamp to [1, 50] |
| Slot index >= length of `b` array | Treat as empty slot (`null`), log warning |
| Decoded JSON exceeds 1 MB after inflate | Returns `null` (safety guard against malicious payloads) |

## Versioning

The `v` field in the JSON schema allows future revisions. Rules:

- A new version is required when fields are added/removed or semantics change
- All prior versions must remain decodable — old comp codes never expire
- Unknown fields in a known version are silently ignored (forward-compatible)
- The build payloads inside `b` follow their own versioning (the existing axicode build version field)
