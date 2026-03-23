# Published Link in Comp Share Dropdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Published Link" item to the comp share dropdown that copies the short URL to clipboard when the comp has been published, or shows as disabled when unpublished.

**Architecture:** New IPC handler `comps:get-published-url` reconstructs the short URL server-side using `shortUrl()`. The renderer adds a fourth dropdown item with the globe icon, wired to copy-to-clipboard with the same flash pattern as existing items. A CSS divider separates it from the existing three items.

**Tech Stack:** Electron IPC, vanilla JS renderer

**Spec:** `docs/superpowers/specs/2026-03-23-published-link-share-design.md`

---

### Task 1: Add IPC handler — `comps:get-published-url`

**Files:**
- Modify: `src/main/index.js:374` (after existing comps handlers)
- Modify: `src/preload/index.js:44` (after `publishComp`)

- [ ] **Step 1: Add the IPC handler in `src/main/index.js`**

Insert after line 374 (`comps:remove-tags` handler):

```js
  ipcMain.handle("comps:get-published-url", async (_e, compId) => {
    const comps = await compStore.listComps();
    const comp = comps.find((c) => c.id === compId);
    if (!comp?.publishedFileId) return null;
    const auth = await getAuthRecord();
    const owner = auth?.onboarding?.targetOwner;
    if (!owner) throw new Error("GitHub publishing not configured.");
    const repo = auth?.onboarding?.repoName || TARGET_REPO;
    const { shortUrl } = require("./shortUrl");
    return shortUrl(owner, repo, comp.publishedFileId);
  });
```

- [ ] **Step 2: Expose in preload `src/preload/index.js`**

Insert after the `publishComp` line (line 44):

```js
  getCompPublishedUrl: (compId) => ipcRenderer.invoke("comps:get-published-url", compId),
```

- [ ] **Step 3: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: add comps:get-published-url IPC handler"
```

---

### Task 2: Add divider CSS

**Files:**
- Modify: `src/renderer/styles/comps.css:809` (after `.comp-share-dropdown__item:disabled`)

- [ ] **Step 1: Add divider style in `src/renderer/styles/comps.css`**

Insert after line 809 (end of `.comp-share-dropdown__item:disabled` block):

```css
.comp-share-dropdown__divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 2px 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/comps.css
git commit -m "feat: add share dropdown divider style"
```

---

### Task 3: Add "Published Link" dropdown item and click handler

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js:15` (import)
- Modify: `src/renderer/modules/comps/comp-detail.js:394-395` (HTML — between Discord Plaintext and closing `</div>`)
- Modify: `src/renderer/modules/comps/comp-detail.js:857-859` (publish success — enable button)
- Modify: `src/renderer/modules/comps/comp-detail.js:958` (after Discord Plaintext handler — add click handler)

- [ ] **Step 1: Add `globeAltIcon` to the import**

In `src/renderer/modules/comps/comp-detail.js` line 15, change:

```js
import { axiforgeIcon, checkIcon, chevronDownIcon, arrowUpTrayIcon, clipboardDocumentIcon } from "../library/heroicons.js";
```

to:

```js
import { axiforgeIcon, checkIcon, chevronDownIcon, arrowUpTrayIcon, clipboardDocumentIcon, globeAltIcon } from "../library/heroicons.js";
```

- [ ] **Step 2: Add the HTML for divider + Published Link button**

In `src/renderer/modules/comps/comp-detail.js`, after the Discord Plaintext button (line 394) and before the closing `</div>` of `comp-share-dropdown__menu` (line 395), insert:

```js
            <div class="comp-share-dropdown__divider"></div>
            <button type="button" class="comp-share-dropdown__item" data-action="copy-published-link"${comp.publishedFileId ? "" : ' disabled title="Publish first"'}>
              ${globeAltIcon} Published Link
            </button>
```

- [ ] **Step 3: Add the click handler after the Discord Plaintext handler**

After the Discord Plaintext handler block (after line 957), add:

```js
    // Published Link
    const pubLinkBtn = shareDropdown.querySelector("[data-action='copy-published-link']");
    const pubLinkBtnDefault = pubLinkBtn?.innerHTML;
    pubLinkBtn?.addEventListener("click", async () => {
      if (pubLinkBtn.disabled || pubLinkBtn.classList.contains("comp-share-dropdown__item--copied")) return;
      try {
        const url = await window.desktopApi.getCompPublishedUrl(comp.id);
        if (!url) return;
        await window.desktopApi.writeClipboardText(url);
        flashItem(pubLinkBtn, pubLinkBtnDefault);
      } catch {
        pubLinkBtn.innerHTML = "Failed";
        pubLinkBtn.classList.add("comp-share-dropdown__item--error");
        setTimeout(() => {
          pubLinkBtn.innerHTML = pubLinkBtnDefault;
          pubLinkBtn.classList.remove("comp-share-dropdown__item--error");
        }, 1500);
      }
    });
```

- [ ] **Step 4: Enable the button after successful publish**

In the publish click handler, after `state.comps = await window.desktopApi.listComps();` (line 859), add:

```js
      if (pubLinkBtn) pubLinkBtn.disabled = false;
```

Note: `pubLinkBtn` is in the same function scope (the `initCompDetail` closure) so it's accessible here.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js
git commit -m "feat: add Published Link item to comp share dropdown"
```

---

### Task 4: Manual smoke test

- [ ] **Step 1: Test unpublished comp**

1. Run: `npm start`
2. Open a comp that has NOT been published
3. Click the Share dropdown
4. Verify "Published Link" appears below a divider, grayed out
5. Verify hovering shows "Publish first" tooltip
6. Verify clicking it does nothing

- [ ] **Step 2: Test published comp**

1. Open a comp that HAS been published (or publish one now)
2. Click the Share dropdown
3. Verify "Published Link" appears enabled
4. Click it — verify "Copied!" flash appears
5. Paste from clipboard — verify URL is `https://{owner}.github.io/axibuilds/r/{fileId}`

- [ ] **Step 3: Test publish-then-enable flow**

1. Open an unpublished comp
2. Verify Published Link is disabled
3. Click Publish and wait for it to complete
4. Open the Share dropdown again
5. Verify Published Link is now enabled and works
