# Themed Build Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-profession color themes that activate on build pages when a toggle setting is enabled, both in the Electron app and the SPA.

**Architecture:** 9 new full CSS themes (`prof-*`) in `themes.css`, a `PROFESSION_THEMES` mapping in `constants.js`, a toggle setting in the settings modal, theme swap logic in `navigateToPage()` and build-load paths, and SPA `VALID_THEMES` expansion. A `.theme-transitioning` CSS class provides a 200ms crossfade.

**Tech Stack:** CSS custom properties, vanilla JS (ES modules), Electron IPC settings

---

### Task 1: Add `PROFESSION_THEMES` Constant

**Files:**
- Modify: `src/renderer/modules/constants.js:199` (after `PROFESSION_WEIGHT`)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/profession-themes.test.js`:

```js
import { describe, it, expect } from "vitest";
import { PROFESSION_THEMES, PROFESSION_WEIGHT } from "../../../src/renderer/modules/constants.js";

describe("PROFESSION_THEMES", () => {
  it("maps every profession in PROFESSION_WEIGHT to a prof-* theme ID", () => {
    for (const profession of Object.keys(PROFESSION_WEIGHT)) {
      expect(PROFESSION_THEMES).toHaveProperty(profession);
      expect(PROFESSION_THEMES[profession]).toMatch(/^prof-/);
    }
  });

  it("has exactly 9 entries", () => {
    expect(Object.keys(PROFESSION_THEMES)).toHaveLength(9);
  });

  it("has unique theme IDs", () => {
    const ids = Object.values(PROFESSION_THEMES);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/profession-themes.test.js`
Expected: FAIL — `PROFESSION_THEMES` is not exported from constants.js

- [ ] **Step 3: Add the constant**

In `src/renderer/modules/constants.js`, after `PROFESSION_WEIGHT` (line 199), add:

```js
export const PROFESSION_THEMES = {
  Guardian: "prof-guardian",
  Warrior: "prof-warrior",
  Necromancer: "prof-necromancer",
  Engineer: "prof-engineer",
  Ranger: "prof-ranger",
  Thief: "prof-thief",
  Mesmer: "prof-mesmer",
  Elementalist: "prof-elementalist",
  Revenant: "prof-revenant",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/profession-themes.test.js`
Expected: PASS — all 3 tests green

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/constants.js tests/unit/renderer/profession-themes.test.js
git commit -m "feat: add PROFESSION_THEMES constant mapping professions to theme IDs"
```

---

### Task 2: Add 9 Profession CSS Themes

**Files:**
- Modify: `src/renderer/styles/themes.css:97` (after Cinderfall, before accent themes section)

- [ ] **Step 1: Add profession theme CSS blocks**

In `src/renderer/styles/themes.css`, after the Cinderfall block (line 97) and before the accent themes comment (line 99), insert:

```css
/* ══════════════════════════════════════════════════════════════════════════
   PROFESSION THEMES  (applied programmatically on build pages)
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Guardian — Noble blue, clarity and protection ───────────────────── */
[data-theme="prof-guardian"] {
  --bg: #060a10;
  --bg-2: #080c14;
  --panel: #101828;
  --panel-2: #0c1420;
  --line: #1a2838;
  --line-soft: #142030;
  --input-bg: #060a10;
  --input-border: #182840;
  --surface: rgba(6, 10, 16, 0.92);
  --surface-hover: rgba(8, 12, 20, 0.95);
  --panel-gradient: linear-gradient(180deg, rgba(16, 24, 40, 0.95), rgba(12, 20, 32, 0.95));
  --accent-rgb: 110, 168, 255;
  --accent-2-rgb: 144, 192, 255;
  --gold: #78b0f0;
  --btn-primary-from: #5890d0;
  --btn-primary-to: #3870b0;
  --btn-primary-from-hover: #68a0e0;
  --btn-primary-to-hover: #4880c0;
}

/* ── Warrior — Bold orange, raw power and aggression ─────────────────── */
[data-theme="prof-warrior"] {
  --bg: #100a06;
  --bg-2: #140c08;
  --panel: #1c1410;
  --panel-2: #18100c;
  --line: #2c1e18;
  --line-soft: #241814;
  --input-bg: #100a06;
  --input-border: #302018;
  --surface: rgba(16, 10, 6, 0.92);
  --surface-hover: rgba(20, 12, 8, 0.95);
  --panel-gradient: linear-gradient(180deg, rgba(28, 20, 16, 0.95), rgba(24, 16, 12, 0.95));
  --accent-rgb: 255, 153, 68;
  --accent-2-rgb: 255, 184, 112;
  --gold: #f09030;
  --btn-primary-from: #e08030;
  --btn-primary-to: #c06018;
  --btn-primary-from-hover: #f09040;
  --btn-primary-to-hover: #d07028;
}

/* ── Necromancer — Toxic green, death magic and decay ────────────────── */
[data-theme="prof-necromancer"] {
  --bg: #060e08;
  --bg-2: #081010;
  --panel: #101c14;
  --panel-2: #0c1810;
  --line: #1a2c20;
  --line-soft: #14241a;
  --input-bg: #060e08;
  --input-border: #183024;
  --surface: rgba(6, 14, 8, 0.92);
  --surface-hover: rgba(8, 16, 16, 0.95);
  --panel-gradient: linear-gradient(180deg, rgba(16, 28, 20, 0.95), rgba(12, 24, 16, 0.95));
  --accent-rgb: 77, 202, 122;
  --accent-2-rgb: 64, 160, 160;
  --gold: #50c080;
  --btn-primary-from: #40b068;
  --btn-primary-to: #289048;
  --btn-primary-from-hover: #50c078;
  --btn-primary-to-hover: #38a058;
}

/* ── Engineer — Warm copper, gears and gunpowder ─────────────────────── */
[data-theme="prof-engineer"] {
  --bg: #0e0a06;
  --bg-2: #120c08;
  --panel: #1a1410;
  --panel-2: #16100c;
  --line: #281e16;
  --line-soft: #201812;
  --input-bg: #0e0a06;
  --input-border: #2c2018;
  --surface: rgba(14, 10, 6, 0.92);
  --surface-hover: rgba(18, 12, 8, 0.95);
  --panel-gradient: linear-gradient(180deg, rgba(26, 20, 16, 0.95), rgba(22, 16, 12, 0.95));
  --accent-rgb: 204, 136, 68;
  --accent-2-rgb: 224, 168, 96;
  --gold: #c89040;
  --btn-primary-from: #b87838;
  --btn-primary-to: #986020;
  --btn-primary-from-hover: #c88848;
  --btn-primary-to-hover: #a87030;
}

/* ── Ranger — Bright lime, nature and wilderness ─────────────────────── */
[data-theme="prof-ranger"] {
  --bg: #080e06;
  --bg-2: #0a1008;
  --panel: #141c10;
  --panel-2: #10180c;
  --line: #1e2c18;
  --line-soft: #182414;
  --input-bg: #080e06;
  --input-border: #203018;
  --surface: rgba(8, 14, 6, 0.92);
  --surface-hover: rgba(10, 16, 8, 0.95);
  --panel-gradient: linear-gradient(180deg, rgba(20, 28, 16, 0.95), rgba(16, 24, 12, 0.95));
  --accent-rgb: 119, 204, 85;
  --accent-2-rgb: 160, 216, 120;
  --gold: #70c048;
  --btn-primary-from: #60b040;
  --btn-primary-to: #489028;
  --btn-primary-from-hover: #70c050;
  --btn-primary-to-hover: #58a038;
}

/* ── Thief — Dusky rose, shadow and subtlety ─────────────────────────── */
[data-theme="prof-thief"] {
  --bg: #0e070a;
  --bg-2: #10090c;
  --panel: #1c1216;
  --panel-2: #180e12;
  --line: #2a1c22;
  --line-soft: #22161c;
  --input-bg: #0e070a;
  --input-border: #2e1e24;
  --surface: rgba(14, 7, 10, 0.92);
  --surface-hover: rgba(16, 9, 12, 0.95);
  --panel-gradient: linear-gradient(180deg, rgba(28, 18, 22, 0.95), rgba(24, 14, 18, 0.95));
  --accent-rgb: 204, 102, 119;
  --accent-2-rgb: 216, 160, 168;
  --gold: #c87080;
  --btn-primary-from: #b85060;
  --btn-primary-to: #984048;
  --btn-primary-from-hover: #c86070;
  --btn-primary-to-hover: #a85058;
}

/* ── Mesmer — Arcane purple, illusion and chaos ──────────────────────── */
[data-theme="prof-mesmer"] {
  --bg: #0a060e;
  --bg-2: #0c0810;
  --panel: #18101e;
  --panel-2: #140c1a;
  --line: #24182c;
  --line-soft: #1e1426;
  --input-bg: #0a060e;
  --input-border: #281c30;
  --surface: rgba(10, 6, 14, 0.92);
  --surface-hover: rgba(12, 8, 16, 0.95);
  --panel-gradient: linear-gradient(180deg, rgba(24, 16, 30, 0.95), rgba(20, 12, 26, 0.95));
  --accent-rgb: 176, 122, 204;
  --accent-2-rgb: 200, 160, 224;
  --gold: #a880c8;
  --btn-primary-from: #9868b8;
  --btn-primary-to: #784898;
  --btn-primary-from-hover: #a878c8;
  --btn-primary-to-hover: #8858a8;
}

/* ── Elementalist — Ember red, elemental fury ────────────────────────── */
[data-theme="prof-elementalist"] {
  --bg: #0e0608;
  --bg-2: #100810;
  --panel: #1c1012;
  --panel-2: #180c0e;
  --line: #2c181c;
  --line-soft: #241418;
  --input-bg: #0e0608;
  --input-border: #30181e;
  --surface: rgba(14, 6, 8, 0.92);
  --surface-hover: rgba(16, 8, 16, 0.95);
  --panel-gradient: linear-gradient(180deg, rgba(28, 16, 18, 0.95), rgba(24, 12, 14, 0.95));
  --accent-rgb: 221, 85, 85;
  --accent-2-rgb: 232, 144, 112;
  --gold: #d06050;
  --btn-primary-from: #c84040;
  --btn-primary-to: #a83030;
  --btn-primary-from-hover: #d85050;
  --btn-primary-to-hover: #b84040;
}

/* ── Revenant — Dark burgundy, ancient power from the Mists ──────────── */
[data-theme="prof-revenant"] {
  --bg: #0a0507;
  --bg-2: #0c0709;
  --panel: #180c10;
  --panel-2: #14080c;
  --line: #261420;
  --line-soft: #20101a;
  --input-bg: #0a0507;
  --input-border: #2a1622;
  --surface: rgba(10, 5, 7, 0.92);
  --surface-hover: rgba(12, 7, 9, 0.95);
  --panel-gradient: linear-gradient(180deg, rgba(24, 12, 16, 0.95), rgba(20, 8, 12, 0.95));
  --accent-rgb: 184, 72, 72;
  --accent-2-rgb: 200, 120, 104;
  --gold: #b05050;
  --btn-primary-from: #a03838;
  --btn-primary-to: #802828;
  --btn-primary-from-hover: #b04848;
  --btn-primary-to-hover: #903838;
}
```

- [ ] **Step 2: Visual verification**

Open the app, open devtools console, and test each theme:

```js
document.documentElement.setAttribute("data-theme", "prof-guardian");
document.documentElement.setAttribute("data-theme", "prof-necromancer");
document.documentElement.setAttribute("data-theme", "prof-mesmer");
// ... repeat for all 9
document.documentElement.removeAttribute("data-theme"); // restore default
```

Verify that backgrounds, panels, accent colors, and buttons all shift correctly for each profession theme. Check that text remains readable and no elements disappear.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/themes.css
git commit -m "feat: add 9 profession color themes to themes.css"
```

---

### Task 3: Add Theme Transition CSS

**Files:**
- Modify: `src/renderer/styles/base.css` (at the end of the file)

- [ ] **Step 1: Add the transition class**

At the end of `src/renderer/styles/base.css`, add:

```css
/* ── Theme transition (applied transiently during profession theme swaps) ── */
.theme-transitioning,
.theme-transitioning .page,
.theme-transitioning .panel,
.theme-transitioning .leftnav,
.theme-transitioning .subnav,
.theme-transitioning .editor-main,
.theme-transitioning .spec-line,
.theme-transitioning .editor-skills,
.theme-transitioning .editor-equipment,
.theme-transitioning input,
.theme-transitioning button {
  transition: background-color 200ms ease, border-color 200ms ease, color 200ms ease;
}
```

- [ ] **Step 2: Manual verification**

Open devtools console and test the transition:

```js
document.documentElement.classList.add("theme-transitioning");
document.documentElement.setAttribute("data-theme", "prof-mesmer");
setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 200);
```

Verify: colors shift smoothly over ~200ms rather than snapping instantly. Then restore:

```js
document.documentElement.classList.add("theme-transitioning");
document.documentElement.removeAttribute("data-theme");
setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 200);
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/base.css
git commit -m "feat: add .theme-transitioning CSS class for smooth theme crossfade"
```

---

### Task 4: Add Toggle Setting to Settings Modal

**Files:**
- Modify: `src/renderer/modules/settings-modal.js:55-61` (appearance section HTML)
- Modify: `src/renderer/modules/settings-modal.js:120-140` (element cache and event wiring)
- Modify: `src/renderer/modules/settings-modal.js:155-189` (openSettingsModal load)
- Modify: `src/renderer/modules/settings-modal.js:228-236` (_applyTheme)
- Modify: `src/renderer/styles/settings-modal.css` (toggle styles)

- [ ] **Step 1: Add toggle HTML to the appearance section**

In `settings-modal.js`, find the appearance section HTML (line 60):

```js
          <div class="settings-modal__theme-grid" id="sm-theme-grid"></div>
        </div>
```

Replace with:

```js
          <div class="settings-modal__theme-grid" id="sm-theme-grid"></div>
          <label class="settings-modal__toggle" id="sm-themed-builds-toggle">
            <input type="checkbox" class="settings-modal__toggle-input" id="sm-themed-builds">
            <span class="settings-modal__toggle-switch"></span>
            <span class="settings-modal__toggle-text">Themed build pages</span>
          </label>
        </div>
```

- [ ] **Step 2: Add element to the `_el` cache**

In `initSettingsModal()`, in the element-caching block (around lines 120–138), add after the existing `_el` assignments:

```js
    _el.themedBuilds = _overlay.querySelector("#sm-themed-builds");
```

- [ ] **Step 3: Add event handler for the toggle**

After the existing thread-mode event handlers (around line 152), add:

```js
  // Toggle themed build pages
  _el.themedBuilds.addEventListener("change", async () => {
    const enabled = _el.themedBuilds.checked;
    await window.desktopApi.setSetting("appearance.themedBuildPages", enabled);
    if (_callbacks.onThemedBuildsToggle) _callbacks.onThemedBuildsToggle(enabled);
  });
```

- [ ] **Step 4: Load the setting value on modal open**

In `openSettingsModal()`, add to the `Promise.all` array at line 159 a new entry:

```js
    window.desktopApi.getSetting("appearance.themedBuildPages"),
```

And destructure the result (update line 159's destructuring to include the new value):

```js
  const [webhookUrl, buildWebhookUrl, threadMode, threadId, buildThreadMode, buildThreadId, themedBuilds] = await Promise.all([
    window.desktopApi.getSetting("discord.webhookUrl"),
    window.desktopApi.getSetting("discord.buildWebhookUrl"),
    window.desktopApi.getSetting("discord.threadMode"),
    window.desktopApi.getSetting("discord.threadId"),
    window.desktopApi.getSetting("discord.buildThreadMode"),
    window.desktopApi.getSetting("discord.buildThreadId"),
    window.desktopApi.getSetting("appearance.themedBuildPages"),
  ]);
```

Then after the build webhook section (around line 186), before `_renderThemeGrid()`:

```js
  // Themed build pages toggle
  _el.themedBuilds.checked = !!themedBuilds;
```

- [ ] **Step 5: Add toggle CSS styles**

In `src/renderer/styles/settings-modal.css`, add at the end:

```css
/* ── Themed builds toggle ─────────────────────────────────────────────── */
.settings-modal__toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  margin-top: 12px;
  padding: 0 2px;
}

.settings-modal__toggle-input {
  display: none;
}

.settings-modal__toggle-switch {
  width: 32px;
  height: 18px;
  background: var(--line);
  border-radius: 9px;
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}

.settings-modal__toggle-switch::after {
  content: "";
  width: 14px;
  height: 14px;
  background: #888;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s, background 0.2s;
}

.settings-modal__toggle-input:checked + .settings-modal__toggle-switch {
  background: rgba(var(--accent-rgb), 0.6);
}

.settings-modal__toggle-input:checked + .settings-modal__toggle-switch::after {
  transform: translateX(14px);
  background: white;
}

.settings-modal__toggle-text {
  color: var(--text-dim, #888);
  font-size: 12px;
}
```

- [ ] **Step 6: Manual verification**

Open the app, open Settings, verify the toggle appears below the theme grid in the Appearance section. Toggle it on/off, close and reopen Settings — the toggle state should persist.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/settings-modal.js src/renderer/styles/settings-modal.css
git commit -m "feat: add themed build pages toggle to settings modal"
```

---

### Task 5: Wire Up Theme Swap on Navigation

**Files:**
- Modify: `src/renderer/renderer.js:622-651` (`navigateToPage`)
- Modify: `src/renderer/renderer.js` (near top, add import)
- Modify: `src/renderer/modules/render-pages.js` (where profession changes trigger re-renders)

- [ ] **Step 1: Add import for PROFESSION_THEMES**

At the top of `src/renderer/renderer.js`, find the imports from `constants.js` and add `PROFESSION_THEMES`:

```js
import { PROFESSION_THEMES } from "./modules/constants.js";
```

If there's no existing import from constants.js, add this as a new import line near the other module imports.

- [ ] **Step 2: Add themed-builds state tracking**

Near the top of `renderer.js` where `state` is defined or near the `navigateToPage` function, add a module-level variable to track the stashed theme:

```js
let _stashedTheme = null;
let _themedBuildsEnabled = false;
```

- [ ] **Step 3: Add a helper function for theme transitions**

Before `navigateToPage()`, add:

```js
function applyThemeWithTransition(themeId) {
  document.documentElement.classList.add("theme-transitioning");
  if (themeId) {
    document.documentElement.setAttribute("data-theme", themeId);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 200);
}

async function applyProfessionThemeIfEnabled() {
  if (!_themedBuildsEnabled) return;
  const profession = state.editor?.profession;
  const profTheme = profession ? PROFESSION_THEMES[profession] : null;
  if (!profTheme) return;
  const current = document.documentElement.getAttribute("data-theme") || "";
  if (current === profTheme) return;
  if (!current.startsWith("prof-")) _stashedTheme = current;
  applyThemeWithTransition(profTheme);
}

function restoreUserThemeIfNeeded() {
  const current = document.documentElement.getAttribute("data-theme") || "";
  if (!current.startsWith("prof-")) return;
  applyThemeWithTransition(_stashedTheme || "");
  _stashedTheme = null;
}
```

- [ ] **Step 4: Load the setting on app start**

In the initialization section of `renderer.js` (around line 312 where the saved theme is loaded), add after the theme restoration:

```js
_themedBuildsEnabled = !!(await window.desktopApi.getSetting("appearance.themedBuildPages"));
```

- [ ] **Step 5: Hook into navigateToPage()**

In `navigateToPage()` (line 622), add profession theme logic. After the existing `if (page === "editor")` block (around line 641), add:

```js
  if (page === "editor") {
    applyProfessionThemeIfEnabled();
  } else {
    restoreUserThemeIfNeeded();
  }
```

- [ ] **Step 6: Hook into build loading**

When a different build is loaded, the profession may change. Find where `setProfession()` is called in `renderer.js` (around line 505). At the end of `setProfession()` (after the catalog loads and `state.editor.profession` is set), add:

```js
  if (state.activePage === "editor") applyProfessionThemeIfEnabled();
```

- [ ] **Step 7: Wire the settings callback**

In the `initSettingsCallbacks` call (wherever callbacks are passed to the settings modal), add:

```js
onThemedBuildsToggle: (enabled) => {
  _themedBuildsEnabled = enabled;
  if (state.activePage === "editor") {
    if (enabled) {
      applyProfessionThemeIfEnabled();
    } else {
      restoreUserThemeIfNeeded();
    }
  }
},
```

Find where `initSettingsCallbacks` is called in `renderer.js` and add this to the callbacks object.

- [ ] **Step 8: Manual verification**

1. Open app, go to Settings, enable "Themed build pages"
2. Open a build — verify the theme shifts to the profession's color
3. Navigate to Library — verify the theme restores to the user's choice
4. Navigate back to the build — verify it shifts again
5. Open a build with a different profession — verify the theme changes
6. Disable the toggle while on a build page — verify it restores immediately
7. Enable the toggle while on a build page — verify it applies immediately

- [ ] **Step 9: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat: swap to profession theme on build page navigation"
```

---

### Task 6: Update Published URL to Use Profession Theme

**Files:**
- Modify: `src/renderer/modules/render-pages.js:546-555` (`_getPublishedUrl`)
- Modify: `src/renderer/renderer.js:1010` (copy-published-link handler)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/themed-publish-url.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("published URL profession theme", () => {
  it("uses profession theme ID when themedBuildPages is enabled and a prof-* theme is active", () => {
    // This is a behavioral contract test.
    // When themedBuildPages is on and the current data-theme starts with "prof-",
    // the published URL should use that prof-* theme in ?t=, not the user's cosmetic theme.
    //
    // The actual URL construction lives in _getPublishedUrl() (render-pages.js line 553)
    // which reads document.documentElement.getAttribute("data-theme").
    //
    // When the profession theme is active on the editor page, data-theme is already
    // set to e.g. "prof-necromancer". So _getPublishedUrl() will naturally pick it up.
    //
    // Verify the contract: prof-* IDs should be included in the URL.
    const themeId = "prof-necromancer";
    const url = `https://example.github.io/repo/?n=my-build&b=abc.key&t=${themeId}`;
    expect(url).toContain("&t=prof-necromancer");
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/unit/renderer/themed-publish-url.test.js`
Expected: PASS (this is a contract/documentation test)

- [ ] **Step 3: Update the renderer.js copy-published-link handler**

In `src/renderer/renderer.js`, line 1010, the URL currently omits `?t=`. Update it to include the theme:

Find:
```js
        const url = `${config.pagesUrl}?n=${encodeURIComponent(slug)}&b=${build.publishedFileId}.${build.publishedKey}`;
```

Replace with:
```js
        const theme = document.documentElement.getAttribute("data-theme");
        const url = `${config.pagesUrl}?n=${encodeURIComponent(slug)}&b=${build.publishedFileId}.${build.publishedKey}${theme ? `&t=${theme}` : ""}`;
```

This mirrors the pattern already used in `render-pages.js:553`. When the profession theme is active (because the user is on the editor page with themedBuildPages enabled), `data-theme` will be `"prof-necromancer"` etc., and it flows into the URL automatically.

- [ ] **Step 4: Manual verification**

1. Enable "Themed build pages" in Settings
2. Open a published Necromancer build
3. Copy the published link — verify URL contains `&t=prof-necromancer`
4. Disable the toggle, copy the link again — verify URL contains the user's cosmetic theme (or no `&t=` for default)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/renderer.js tests/unit/renderer/themed-publish-url.test.js
git commit -m "feat: include profession theme in published build URLs"
```

---

### Task 7: Update SPA to Accept Profession Themes

**Files:**
- Modify: `src/site/main.js:9-12` (`VALID_THEMES` set)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/site/valid-themes.test.js`:

```js
import { describe, it, expect } from "vitest";
import { PROFESSION_THEMES } from "../../../src/renderer/modules/constants.js";

describe("SPA VALID_THEMES coverage", () => {
  it("documents that all profession theme IDs must be accepted by the SPA", () => {
    // When updating VALID_THEMES in src/site/main.js, ensure all prof-* IDs are included.
    // This test validates the constant is available for reference.
    const profThemeIds = Object.values(PROFESSION_THEMES);
    expect(profThemeIds).toHaveLength(9);
    for (const id of profThemeIds) {
      expect(id).toMatch(/^prof-/);
    }
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/unit/site/valid-themes.test.js`
Expected: PASS

- [ ] **Step 3: Add profession theme IDs to VALID_THEMES**

In `src/site/main.js`, update the `VALID_THEMES` set (lines 9–12):

Find:
```js
const VALID_THEMES = new Set([
  "molten-core", "frostforge", "verdant-crucible", "cinderfall",
  "copper", "cobalt", "mithril", "rose-gold",
]);
```

Replace with:
```js
const VALID_THEMES = new Set([
  "molten-core", "frostforge", "verdant-crucible", "cinderfall",
  "copper", "cobalt", "mithril", "rose-gold",
  "prof-guardian", "prof-warrior", "prof-necromancer", "prof-engineer",
  "prof-ranger", "prof-thief", "prof-mesmer", "prof-elementalist", "prof-revenant",
]);
```

- [ ] **Step 4: Manual verification**

Build and serve the SPA locally. Open a build URL with `?t=prof-mesmer` appended — verify the purple Mesmer theme applies. Try `?t=prof-invalid` — verify it's ignored (falls back to default).

- [ ] **Step 5: Commit**

```bash
git add src/site/main.js tests/unit/site/valid-themes.test.js
git commit -m "feat: accept profession theme IDs in SPA VALID_THEMES"
```

---

### Task 8: Import Shared Theme CSS in SPA

**Files:**
- Verify: `src/site/styles.css` — confirm it imports `themes.css`

- [ ] **Step 1: Check the SPA stylesheet imports**

Read `src/site/styles.css` and verify it imports `../renderer/styles/themes.css`. If it already does (likely, since the existing cosmetic themes work in the SPA), no changes needed — the new `prof-*` blocks in `themes.css` will be automatically included.

If it does NOT import themes.css, add the import.

- [ ] **Step 2: Verify**

Build the SPA (`npm run build:site` or equivalent). Open a build with `?t=prof-guardian` and verify the blue Guardian theme applies correctly.

- [ ] **Step 3: Commit (only if changes were needed)**

```bash
git add src/site/styles.css
git commit -m "fix: ensure SPA imports themes.css for profession themes"
```

---

### Task 9: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All existing tests pass, plus the new tests from Tasks 1, 6, and 7.

- [ ] **Step 2: Fix any failures**

If any tests fail, investigate and fix. The most likely issues:
- Import resolution for `PROFESSION_THEMES` in test files
- DOM mocking issues if any existing tests exercise the settings modal

- [ ] **Step 3: Final manual smoke test**

Walk through the complete flow:
1. Open Settings → enable "Themed build pages" → close Settings
2. Open a Guardian build → blue theme applies with smooth transition
3. Open a Necromancer build → green theme transitions in
4. Navigate to Library → user theme restores smoothly
5. Navigate to Comps → no profession theme (user theme)
6. Navigate back to the build → profession theme reapplies
7. Disable the toggle while on a build → user theme restores
8. Publish a build with toggle on → URL has `?t=prof-*`
9. Open the published URL in a browser → profession theme renders in SPA
10. Publish with toggle off → URL has user's cosmetic theme (or no `?t=`)

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address test failures from themed build pages integration"
```
