# Comp SPA — Design Spec

**Date:** 2026-03-19
**Status:** Approved

## Overview

Add a read-only, shareable SPA for comps — mirroring exactly how the build SPA works. The comp SPA imports the same desktop CSS and uses the same comp-detail DOM structure, identical visually save for the readonly parts. Publishing a comp also publishes all of its builds (if not already published), then encrypts and uploads the comp itself.

## Core Principle

The build SPA is 1:1 with the build editor (same components, same CSS, readonly flags). The comp SPA follows the same principle: 1:1 with the comp-detail view (same layout, same CSS, readonly flags). No novel UI is invented.

---

## 1. SPA Routing

**File:** `src/site/main.js`

Add `?c=fileId.key&n=slug` param handling alongside the existing `?b=` build param. Split on the first `.` to get `fileId` and `encKey`. Fetch `comps/{fileId}.enc` (analogous to `builds/{fileId}.enc` for the `?b=` path). Decryption is byte-for-byte identical to builds. On success, route to `renderCompPage(app, comp)`.

URL format: `https://{owner}.github.io/axibuilds/?c={fileId}.{encKey}&n={slug}`

The existing `?b=` build route is unchanged.

---

## 2. Comp SPA Renderer

**New file:** `src/site/render-comp.js`

Renders the comp-detail layout, readonly. Structure mirrors the desktop `comp-detail.js`:

### Topbar
- Comp name (display only, no inline edit)
- Game mode badge, tags (display only)
- Notes section (display only, collapsed by default if present)
- **No** back button, no publish button, no slot counter edit

### Body — Party Panel (left)
- Same `comp-detail__party-panel` layout
- Party lines with `comp-line` + `comp-slot` elements rendered from `partyLines`
- Slots show the profession icon via the embedded `professionIcon` SVG on each build entry
- **No** drag-drop handlers
- **No** resize handle (panel split is fixed at ~40%)
- **No** empty slot add-drop targets

### Body — Pool Panel (right)
- Same `comp-pool` + `comp-pool-list` layout
- Each build in the comp renders a `comp-pool-card` (same DOM structure as desktop)
- The "open build" button (`comp-pool-card__open`) is replaced with an `<a href="{spaUrl}" target="_blank">` link pointing to the build's own SPA URL
- **No** Add button, no Remove button, no search input

---

## 3. Comp Serialization

**New file:** `src/main/compPublish.js`

```
serializeCompForPublish(comp, enrichedBuilds)
```

Returns a single JSON object:

```js
{
  // Comp fields
  id, name, notes, tags, gameMode, partyLines,

  // Map of buildId → enriched build data + SPA URL
  // Contains ALL builds in the comp (pool members),
  // not only those assigned to a party line slot.
  builds: {
    [buildId]: {
      ...serializeForPublish(build, catalog, upgradeCatalog),
      spaUrl: "https://.../?b=fileId.key&n=slug"
    }
  }
}
```

`partyLines` slots reference build IDs. The renderer resolves slot IDs against `builds` to get the profession icon and build name for each slot. The pool panel renders from all keys of the `builds` map (not just from `partyLines` assignments), so builds in the pool but not yet in any line are also shown.

Encrypted and stored as `site/comps/{fileId}.enc` in the GitHub repo — same format as `site/builds/{fileId}.enc`.

---

## 4. Publish IPC Handler

**File:** `src/main/index.js`

New handler: `comps:publish-comp`

Progress steps (same ticker/`publish-progress` IPC as builds):

| Step | Label |
|------|-------|
| `loading` | Loading comp… |
| `repo` | Ensuring repo… |
| `site` | Building site… |
| `builds` | Publishing builds (N of M)… |
| `encrypt` | Encrypting comp… |
| `upload` | Uploading… |
| `deploy` | Deploying… |

**Build publishing sub-step:**
- Iterate builds in the comp
- For each build without a `publishedFileId`: call the existing `builds:publish-build` logic (reuse the publish function, not the IPC handler)
- Report progress to renderer: `"Publishing build N of M: {buildTitle}"`
- After all builds are published, their `spaUrl`s are available for serialization

**Failure modes:**
- If a build publish fails mid-comp-publish (build N of M throws), the handler propagates the error. Builds 1–(N-1) are already published with their `publishedFileId` saved to the build store, so a retry will skip them and resume from build N. This is safe.
- If the comp upload succeeds but the subsequent `upsertComp` to save `published*` fields fails (e.g. disk error), the comp is live on GitHub Pages but the desktop has no record of the URL. This is an acceptable risk mirroring the same race condition in build publish. If it occurs, the user must republish; the orphaned `.enc` file in the repo is harmless.

**Enrichment fallback:** If `serializeForPublish` throws for an individual build (e.g. catalog miss), fall back to including the un-enriched build in the `builds` map rather than failing the entire comp publish. Log the error.

**Return value:**
```js
{ pagesUrl, slug, fileId, changed }
```

Same structure as the build publish return. `pagesUrl` uses `?c=` param.

---

## 5. Encryption & Key Storage

Encryption is byte-for-byte identical to builds — `buildEncryption.js` is reused as-is:
- `generateEncryptionKey()` → 32 random bytes as base64url
- `generateFileId()` → 4 random bytes as hex
- `encryptBuild(compData, key)` → AES-256-GCM base64 blob (layout: `[iv 12B][ciphertext][authTag 16B]`)

**SPA-side decryption note:** `render-comp.js` must copy the Web Crypto pattern from `main.js` exactly — pass `combined.slice(12)` as the full ciphertext blob to `crypto.subtle.decrypt`. Do NOT manually strip the authTag before passing to Web Crypto; the AES-GCM implementation handles authTag verification internally by reading the last 16 bytes of the ciphertext argument.

Published comp credentials stored on the comp object in `comps.json` (three fields, mirroring builds):
```js
{
  publishedFileId: string,
  publishedKey: string,
  publishedSlug: string
}
```

The published URL is reconstructed on demand from `fileId` and `encKey`, same as builds. `publishedUrl` is NOT stored.

**Required store change:** `compStore.upsertComp` has an explicit field allowlist that currently excludes `published*` fields (they are silently dropped). Update the allowlist to round-trip `publishedFileId`, `publishedKey`, and `publishedSlug`, mirroring the three fields that `buildStore.normalizeBuild` already handles. Without this fix, publish metadata is lost on the first subsequent comp save.

---

## 6. GitHub Repo File Layout

```
axibuilds/
└── site/
    ├── builds/
    │   └── {fileId}.enc        ← existing
    └── comps/
        └── {fileId}.enc        ← new
```

`publishSiteBundle` in `githubApi.js` must be updated to preserve `site/comps/*.enc` files. The current stale-file sweep only guards `site/builds/*.enc`:

```js
// Current (githubApi.js ~line 356):
const isEncBuild = entry.path.startsWith("site/builds/") && entry.path.endsWith(".enc");

// Required change — add comp guard:
const isEncBuild = (entry.path.startsWith("site/builds/") || entry.path.startsWith("site/comps/")) && entry.path.endsWith(".enc");
```

Without this fix, publishing a build after a comp (or vice versa) triggers the stale-file sweep and deletes all `site/comps/*.enc` files from the repo.

---

## 7. Desktop UI — Publish Button

**File:** `src/renderer/modules/comps/comp-detail.js`

Add a **Publish** button to the comp-detail topbar, same position and styling as the build editor's publish button. On click:
- Opens the same publish progress modal used by builds
- Fires `comps:publish-comp` IPC
- On success: shows the comp SPA URL with a copy button (same success UI as builds)

---

## 8. `src/site/styles.css`

No changes needed — the comp SPA imports the same desktop CSS (`comps.css` is already part of the desktop styles). If `comps.css` is not currently imported by `styles.css`, add it.

---

## Data Flow Summary

```
User clicks Publish on comp
  → IPC: comps:publish-comp
  → Load comp + its builds from stores
  → Ensure GitHub repo + Pages
  → Build SPA bundle (same as builds)
  → For each unpublished build: publish it → get spaUrl
  → serializeCompForPublish → encrypt → upload to site/comps/{fileId}.enc
  → Trigger Pages deploy
  → Store publishedFileId/Key/Slug/Url on comp
  → Return pagesUrl to renderer → show success UI

User opens comp SPA URL
  → main.js detects ?c= param
  → Fetch site/comps/{fileId}.enc
  → Decrypt with key from URL
  → renderCompPage(app, compData)
    → Render topbar (name, tags, game mode, notes)
    → Render party panel (lines + slots from partyLines + builds map)
    → Render pool panel (comp-pool-cards with <a href> to build SPA URLs)
```

---

## Out of Scope

- Boon coverage display in SPA (desktop-only feature, requires live catalog)
- Search/filter in the pool panel (not needed for readonly view)
- Comp list SPA (just single comp pages, like builds)
