# Published Link in Comp Share Dropdown

## Summary

Add a "Published Link" item to the comp share dropdown that copies the published short URL to the clipboard. The item is always visible but disabled when the comp has not been published. A new IPC handler reconstructs the URL server-side using the existing `shortUrl()` helper, consistent with how Discord sharing builds URLs.

## Motivation

After publishing a comp, there is no quick way to grab the published link again without re-publishing. The share dropdown is the natural home for this since it already groups all sharing actions.

## Design

### UI

- **Label:** "Published Link"
- **Icon:** `globeAltIcon` (already exported from `heroicons.js`)
- **Position:** Below the three existing items (AxiCode, Discord Embed, Discord Plaintext), separated by a visual divider (1px `rgba(255,255,255,0.08)` line)
- **Published state:** Normal item styling. Click copies the short URL to clipboard and shows the standard "Copied!" flash (same pattern as AxiCode/Plaintext items)
- **Unpublished state:** Button has `disabled` attribute. Existing `.comp-share-dropdown__item:disabled` CSS applies (opacity 0.5, cursor not-allowed). `title="Publish first"` provides tooltip hint
- **Disabled-to-enabled transition:** After publishing, `renderCompDetail()` is called with the updated comp object (which now has `publishedFileId`), so the button renders as enabled automatically

### URL Format

Uses the short redirect URL format via `shortUrl()` from `src/main/shortUrl.js`, consistent with Discord Embed and Discord Plaintext sharing:

```
https://{owner}.github.io/{repo}/r/{fileId}
```

A comp is considered "published" when `comp.publishedFileId` is truthy.

### New IPC Handler

A new IPC handler `comps:get-published-url` reconstructs and returns the URL on the main process side. This keeps URL construction centralized and avoids exposing `TARGET_REPO` to the renderer.

**Handler signature:** `comps:get-published-url(compId) -> string | null`

**Logic:**
1. Look up the comp by ID from `compStore`
2. If `publishedFileId` is missing, return `null`
3. Read `targetOwner` from the auth record; if missing, throw an error ("GitHub publishing not configured")
4. Read `repoName` from the auth record, falling back to `TARGET_REPO`
5. Return `shortUrl(targetOwner, repoName, comp.publishedFileId)`

**Preload exposure:** `getCompPublishedUrl: (compId) => ipcRenderer.invoke("comps:get-published-url", compId)`

### Click Handler

```
publishedLinkBtn click ->
  if disabled, return (native button disabled handles this)
  try:
    url = await window.desktopApi.getCompPublishedUrl(comp.id)
    if !url, return
    await window.desktopApi.writeClipboardText(url)
    flashItem(publishedLinkBtn, publishedLinkBtnDefault)
  catch:
    show "Failed" with error class, auto-revert after 1500ms
```

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/modules/comps/comp-detail.js` | Add `globeAltIcon` import, render new dropdown item with divider, add click handler |
| `src/renderer/styles/comps.css` | Add `.comp-share-dropdown__divider` style for the separator line |
| `src/main/index.js` | Add `comps:get-published-url` IPC handler using `shortUrl()` |
| `src/preload/index.js` | Expose `getCompPublishedUrl` on `desktopApi` |

## Out of Scope

- Opening the URL in a browser (user chose copy-to-clipboard only)
- Auto-triggering publish from the share dropdown
- Build-level published links (only comp-level for now)
