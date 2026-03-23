# Published Link in Comp Share Dropdown

## Summary

Add a "Published Link" item to the comp share dropdown that copies the SPA deployment URL to the clipboard. The item is always visible but disabled when the comp has not been published. No new IPC handler is needed — the URL is reconstructed client-side from already-persisted comp fields and the onboarding status.

## Motivation

After publishing a comp, there is no quick way to grab the SPA link again without re-publishing. The share dropdown is the natural home for this since it already groups all sharing actions.

## Design

### UI

- **Label:** "Published Link"
- **Icon:** `globeAltIcon` (already exported from `heroicons.js`)
- **Position:** Below the three existing items (AxiCode, Discord Embed, Discord Plaintext), separated by a visual divider (1px `rgba(255,255,255,0.08)` line)
- **Published state:** Normal item styling. Click copies the SPA URL to clipboard and shows the standard "Copied!" flash (same pattern as AxiCode/Plaintext items)
- **Unpublished state:** Button has `disabled` attribute. Existing `.comp-share-dropdown__item:disabled` CSS applies (opacity 0.5, cursor not-allowed). `title="Publish first"` provides tooltip hint

### URL Reconstruction

The SPA URL follows the pattern:
```
https://{owner}.github.io/{repoName}/?n={slug}&c={fileId}.{encKey}
```

All components are already available client-side:
- `comp.publishedFileId`, `comp.publishedKey`, `comp.publishedSlug` — persisted on the comp object in `comps.json`, available via `state.activeComp`
- `targetOwner`, `repoName` — available from `window.desktopApi.getOnboardingStatus()`

A comp is considered "published" when `comp.publishedFileId` is truthy.

### New IPC Handler

A new IPC handler `comps:get-published-url` will reconstruct and return the URL on the main process side. This keeps the URL construction logic in one place (the main process already builds these URLs during publish) and avoids exposing `TARGET_REPO` to the renderer.

**Handler signature:** `comps:get-published-url(compId) -> string | null`

**Logic:**
1. Look up the comp by ID from `compStore`
2. If `publishedFileId` is missing, return `null`
3. Read `targetOwner` and `repoName` from the auth record (same pattern as the publish handler)
4. Return the reconstructed URL string

**Preload exposure:** `getCompPublishedUrl: (compId) => ipcRenderer.invoke("comps:get-published-url", compId)`

### Click Handler

```
publishedLinkBtn click ->
  if disabled, return (native button disabled handles this)
  url = await window.desktopApi.getCompPublishedUrl(comp.id)
  if !url, return
  await window.desktopApi.writeClipboardText(url)
  flashItem(publishedLinkBtn, publishedLinkBtnDefault)
```

Error handling follows the same pattern as the AxiCode button — show "Failed" with error class, auto-revert after 1500ms.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/modules/comps/comp-detail.js` | Add `globeAltIcon` import, render new dropdown item with divider, add click handler |
| `src/renderer/styles/comps.css` | Add `.comp-share-dropdown__divider` style for the separator line |
| `src/main/index.js` | Add `comps:get-published-url` IPC handler |
| `src/preload/index.js` | Expose `getCompPublishedUrl` on `desktopApi` |

## Out of Scope

- Opening the URL in a browser (user chose copy-to-clipboard only)
- Auto-triggering publish from the share dropdown
- Build-level published links (only comp-level for now)
