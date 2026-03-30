# Unified Profession + Elite Spec Selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the profession-only dropdown with a single grouped dropdown showing all professions and their elite specs, with search filtering.

**Architecture:** Extend `renderCustomSelect` in `custom-select.js` with `groups` and `searchable` config options. Update `renderEditorForm` in `render-pages.js` to build grouped options from `state.professions` and catalog data, with an `onChange` handler that distinguishes same-profession elite swaps from cross-profession switches.

**Tech Stack:** Vanilla JS (DOM), CSS, Jest (node env with DOM mock)

---

### Task 1: Add grouped options rendering to custom-select.js

**Files:**
- Modify: `src/renderer/modules/custom-select.js`
- Test: `tests/unit/renderer/custom-select.test.js`

- [ ] **Step 1: Write the failing test for grouped rendering**

In `tests/unit/renderer/custom-select.test.js`, add at the end of the file:

```js
describe("renderCustomSelect — grouped options", () => {
  test("renders group headers and grouped options", () => {
    const host = makeElement("div");
    const onChange = jest.fn();

    customSelectModule.renderCustomSelect(host, {
      value: "Necromancer:7",
      groups: [
        {
          label: "Elementalist",
          icon: "ele.png",
          options: [
            { value: "Elementalist:core", label: "Core" },
            { value: "Elementalist:48", label: "Weaver" },
          ],
        },
        {
          label: "Necromancer",
          icon: "necro.png",
          options: [
            { value: "Necromancer:core", label: "Core" },
            { value: "Necromancer:7", label: "Reaper" },
            { value: "Necromancer:60", label: "Scourge" },
          ],
        },
      ],
      onChange,
    });

    // Should have 2 group headers
    const headers = host.querySelectorAll(".cselect__group-header");
    expect(headers.length).toBe(2);
    expect(headers[0].querySelector(".cselect__label").textContent).toBe("Elementalist");
    expect(headers[1].querySelector(".cselect__label").textContent).toBe("Necromancer");

    // Should have 5 options total (2 + 3)
    const options = host.querySelectorAll(".cselect__option");
    expect(options.length).toBe(5);

    // Options should have grouped class
    expect(options[0].classList.contains("cselect__option--grouped")).toBe(true);

    // Reaper should be selected
    const selected = host.querySelectorAll(".cselect__option--selected");
    expect(selected.length).toBe(1);
    expect(selected[0].querySelector(".cselect__label").textContent).toBe("Reaper");
  });

  test("group headers are not clickable", () => {
    const host = makeElement("div");
    const onChange = jest.fn();

    customSelectModule.renderCustomSelect(host, {
      value: "Necromancer:core",
      groups: [
        {
          label: "Necromancer",
          options: [{ value: "Necromancer:core", label: "Core" }],
        },
      ],
      onChange,
    });

    const header = host.querySelector(".cselect__group-header");
    expect(header).toBeTruthy();
    // Headers should be div elements, not buttons
    expect(header.tagName).toBe("DIV");
  });

  test("clicking a grouped option fires onChange and updates trigger", () => {
    const host = makeElement("div");
    const onChange = jest.fn();

    customSelectModule.renderCustomSelect(host, {
      value: "Necromancer:7",
      groups: [
        {
          label: "Necromancer",
          options: [
            { value: "Necromancer:7", label: "Reaper", icon: "reaper.png" },
            { value: "Necromancer:60", label: "Scourge", icon: "scourge.png" },
          ],
        },
      ],
      onChange,
    });

    const trigger = host.querySelector(".cselect__trigger");
    expect(trigger.querySelector(".cselect__label").textContent).toBe("Reaper");

    const options = host.querySelectorAll(".cselect__option");
    options[1].click();

    expect(onChange).toHaveBeenCalledWith("Necromancer:60", expect.objectContaining({ value: "Necromancer:60" }));
    expect(trigger.querySelector(".cselect__label").textContent).toBe("Scourge");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/renderer/custom-select.test.js`
Expected: FAIL — no `.cselect__group-header` elements rendered, grouped options not supported yet.

- [ ] **Step 3: Implement grouped options in renderCustomSelect**

In `src/renderer/modules/custom-select.js`, modify `renderCustomSelect` to handle the `groups` config. Replace the section from line 15 (`const options = ...`) through line 97 (`});`) with:

```js
export function renderCustomSelect(host, config = {}) {
  if (!host) return;

  // Flatten groups into options if groups are provided
  const hasGroups = Array.isArray(config.groups) && config.groups.length > 0;
  const allOptions = hasGroups
    ? config.groups.flatMap((g) => g.options || [])
    : (Array.isArray(config.options) ? config.options : []);
  const currentValue = String(config.value ?? "");
  const selectedOption =
    allOptions.find((option) => String(option.value) === currentValue) ||
    allOptions.find((option) => !option.disabled) ||
    allOptions[0] ||
    null;

  host.innerHTML = "";
  host.classList.add("cselect-host");

  const root = document.createElement("div");
  root.className = `cselect ${String(config.className || "").trim()}`.trim();

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cselect__trigger";
  trigger.disabled = Boolean(config.disabled) || !allOptions.length;
  trigger.append(makeCustomSelectValueNode(selectedOption, config.placeholder || "Select"));

  const chevron = document.createElement("span");
  chevron.className = "cselect__chevron";
  chevron.textContent = "▾";
  trigger.append(chevron);

  const menu = document.createElement("div");
  menu.className = "cselect__menu";
  const list = document.createElement("div");
  list.className = "cselect__list";

  function makeOptionButton(option) {
    const button = document.createElement("button");
    button.type = "button";
    const isSelected = String(option.value) === String(selectedOption?.value ?? "");
    button.className = `cselect__option${hasGroups ? " cselect__option--grouped" : ""}${isSelected ? " cselect__option--selected" : ""}`;
    button.disabled = Boolean(option.disabled);
    button.append(makeCustomSelectValueNode(option, config.placeholder || "Select"));

    if (option.kind && option.entity && _bindHoverPreview) {
      _bindHoverPreview(button, option.kind, () => option.entity);
    }

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      closeCustomSelect();

      const valueNode = trigger.querySelector(".cselect__value");
      if (valueNode) {
        const newValue = makeCustomSelectValueNode(option, config.placeholder || "Select");
        valueNode.replaceWith(newValue);
      }

      for (const opt of list.querySelectorAll(".cselect__option")) {
        opt.classList.toggle("cselect__option--selected", opt === button);
      }

      if (typeof config.onChange === "function") {
        Promise.resolve(config.onChange(option.value, option)).catch((err) => _onError(err));
      }
    });
    return button;
  }

  if (!allOptions.length) {
    const empty = document.createElement("p");
    empty.className = "cselect__empty";
    empty.textContent = "No options";
    list.append(empty);
  } else if (hasGroups) {
    for (const group of config.groups) {
      const header = document.createElement("div");
      header.className = "cselect__group-header";
      header.append(makeCustomSelectValueNode({ label: group.label, icon: group.icon }, ""));
      list.append(header);
      for (const option of group.options || []) {
        list.append(makeOptionButton(option));
      }
    }
  } else {
    for (const option of allOptions) {
      list.append(makeOptionButton(option));
    }
  }

  menu.append(list);
  root.append(trigger, menu);
  host.append(root);

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleCustomSelect(root);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/renderer/custom-select.test.js`
Expected: ALL PASS (both existing tests and new grouped tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/custom-select.js tests/unit/renderer/custom-select.test.js
git commit -m "feat: add grouped options support to renderCustomSelect"
```

---

### Task 2: Add search filtering to custom-select.js

**Files:**
- Modify: `src/renderer/modules/custom-select.js`
- Test: `tests/unit/renderer/custom-select.test.js`

- [ ] **Step 1: Write the failing tests for search**

Append to `tests/unit/renderer/custom-select.test.js`:

```js
describe("renderCustomSelect — searchable", () => {
  test("renders a search input when searchable is true", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "Necromancer:7",
      searchable: true,
      groups: [
        {
          label: "Necromancer",
          options: [
            { value: "Necromancer:core", label: "Core" },
            { value: "Necromancer:7", label: "Reaper" },
          ],
        },
      ],
      onChange: () => {},
    });

    const search = host.querySelector(".cselect__search");
    expect(search).toBeTruthy();
    expect(search.tagName).toBe("INPUT");
  });

  test("does not render search input when searchable is false", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "alpha",
      options: [{ value: "alpha", label: "Alpha" }],
      onChange: () => {},
    });

    const search = host.querySelector(".cselect__search");
    expect(search).toBeNull();
  });

  test("typing in search filters options by label match", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "Necromancer:7",
      searchable: true,
      groups: [
        {
          label: "Elementalist",
          options: [
            { value: "Elementalist:core", label: "Core" },
            { value: "Elementalist:48", label: "Weaver" },
          ],
        },
        {
          label: "Necromancer",
          options: [
            { value: "Necromancer:core", label: "Core" },
            { value: "Necromancer:7", label: "Reaper" },
          ],
        },
      ],
      onChange: () => {},
    });

    const search = host.querySelector(".cselect__search");
    search.value = "rea";
    search.dispatchEvent({ type: "input", preventDefault() {}, stopPropagation() {}, target: search });

    // Only Necromancer group should be visible (has "Reaper" matching "rea")
    const headers = host.querySelectorAll(".cselect__group-header");
    const visibleHeaders = headers.filter((h) => h.style.display !== "none");
    expect(visibleHeaders.length).toBe(1);
    expect(visibleHeaders[0].querySelector(".cselect__label").textContent).toBe("Necromancer");

    // Only Reaper option should be visible
    const options = host.querySelectorAll(".cselect__option");
    const visibleOptions = options.filter((o) => o.style.display !== "none");
    expect(visibleOptions.length).toBe(1);
    expect(visibleOptions[0].querySelector(".cselect__label").textContent).toBe("Reaper");
  });

  test("search matches group label (profession name)", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "Necromancer:7",
      searchable: true,
      groups: [
        {
          label: "Elementalist",
          options: [{ value: "Elementalist:48", label: "Weaver" }],
        },
        {
          label: "Necromancer",
          options: [{ value: "Necromancer:7", label: "Reaper" }],
        },
      ],
      onChange: () => {},
    });

    const search = host.querySelector(".cselect__search");
    search.value = "nec";
    search.dispatchEvent({ type: "input", preventDefault() {}, stopPropagation() {}, target: search });

    // Necromancer group and all its children should be visible
    const options = host.querySelectorAll(".cselect__option");
    const visibleOptions = options.filter((o) => o.style.display !== "none");
    expect(visibleOptions.length).toBe(1);
    expect(visibleOptions[0].querySelector(".cselect__label").textContent).toBe("Reaper");
  });

  test("empty search shows all options", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "Necromancer:7",
      searchable: true,
      groups: [
        {
          label: "Necromancer",
          options: [
            { value: "Necromancer:core", label: "Core" },
            { value: "Necromancer:7", label: "Reaper" },
          ],
        },
      ],
      onChange: () => {},
    });

    const search = host.querySelector(".cselect__search");
    search.value = "";
    search.dispatchEvent({ type: "input", preventDefault() {}, stopPropagation() {}, target: search });

    const options = host.querySelectorAll(".cselect__option");
    const visibleOptions = options.filter((o) => o.style.display !== "none");
    expect(visibleOptions.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/renderer/custom-select.test.js`
Expected: FAIL — no `.cselect__search` element rendered.

- [ ] **Step 3: Implement search in renderCustomSelect**

In `src/renderer/modules/custom-select.js`, modify the `renderCustomSelect` function. After the line `menu.append(list);` and before `root.append(trigger, menu);`, insert search logic:

```js
  // Search input (only for grouped+searchable)
  if (config.searchable && hasGroups) {
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "cselect__search";
    searchInput.placeholder = "Search...";
    searchInput.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase().trim();
      for (const group of config.groups) {
        const headerEl = list.querySelector(`.cselect__group-header[data-group="${group.label}"]`);
        let groupHasVisible = false;
        for (const option of group.options || []) {
          const optEl = list.querySelector(`.cselect__option[data-value="${option.value}"]`);
          if (!optEl) continue;
          const matchesOption = option.label.toLowerCase().includes(query);
          const matchesGroup = group.label.toLowerCase().includes(query);
          const visible = !query || matchesOption || matchesGroup;
          optEl.style.display = visible ? "" : "none";
          if (visible) groupHasVisible = true;
        }
        if (headerEl) headerEl.style.display = groupHasVisible ? "" : "none";
      }
    });
    menu.insertBefore(searchInput, list);
  }
```

Also update the group header and option rendering to add `data-` attributes for search targeting. In the grouped rendering section, change:

The header line:
```js
      header.dataset.group = group.label;
```
Add after `header.className = "cselect__group-header";`.

In the `makeOptionButton` function, add after the className line:
```js
    button.dataset.value = option.value;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/renderer/custom-select.test.js`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/custom-select.js tests/unit/renderer/custom-select.test.js
git commit -m "feat: add search filtering to grouped custom select"
```

---

### Task 3: Add CSS styles for grouped select and search

**Files:**
- Modify: `src/renderer/styles/custom-select.css`

- [ ] **Step 1: Add styles for group headers, grouped options, and search input**

Append to `src/renderer/styles/custom-select.css`:

```css

/* ── Grouped select ──────────────────────────────────────────────────────── */

.cselect__group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 2px;
  color: #6a7a9e;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: default;
  pointer-events: none;
}

.cselect__group-header .cselect__icon {
  width: 16px;
  height: 16px;
  opacity: 0.65;
}

.cselect__option--grouped {
  padding-left: 32px;
}

.cselect__search {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  margin-bottom: 4px;
  border: 1px solid #2c3d5e;
  border-radius: 8px;
  background: rgba(6, 11, 21, 0.92);
  color: var(--text);
  font: inherit;
  font-size: 0.85rem;
  outline: none;
}

.cselect__search:focus {
  border-color: var(--accent-2);
  box-shadow: 0 0 0 2px rgba(72, 168, 255, 0.2);
}

.cselect__search::placeholder {
  color: #5a6a8e;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/custom-select.css
git commit -m "feat: add styles for grouped select headers, indent, and search"
```

---

### Task 4: Wire up the unified profession/elite spec dropdown

**Files:**
- Modify: `src/renderer/modules/render-pages.js`
- Modify: `src/renderer/index.html`

- [ ] **Step 1: Update the label in index.html**

In `src/renderer/index.html`, change line 148 from:

```html
                  Profession
```

to:

```html
                  Profession / Elite Spec
```

- [ ] **Step 2: Replace the renderEditorForm profession dropdown with grouped select**

In `src/renderer/modules/render-pages.js`, replace the `renderCustomSelect(_el.professionSelect, { ... });` call (lines 334–375) with:

```js
  // Build grouped options: each profession is a group, children are Core + elite specs
  const profSpecGroups = state.professions.map((profession) => {
    const catalog = state.catalogCache?.[profession.id];
    const eliteSpecs = catalog
      ? (Array.isArray(catalog.specializations) ? catalog.specializations : []).filter((s) => s.elite)
      : [];
    return {
      label: profession.name,
      icon: profession.icon || "",
      options: [
        { value: `${profession.id}:core`, label: "Core", icon: profession.icon || "" },
        ...eliteSpecs.map((spec) => ({
          value: `${profession.id}:${spec.id}`,
          label: spec.name,
          icon: spec.icon || "",
        })),
      ],
    };
  });

  // Determine current value: "ProfessionId:eliteSpecId" or "ProfessionId:core"
  const currentEliteSpecId = (() => {
    const catalog = state.activeCatalog;
    if (!catalog) return "core";
    const slot2 = state.editor.specializations[2];
    const specId = Number(slot2?.specializationId) || 0;
    const spec = catalog.specializationById.get(specId);
    return spec?.elite ? String(specId) : "core";
  })();
  const profSpecValue = `${state.editor.profession}:${currentEliteSpecId}`;

  renderCustomSelect(_el.professionSelect, {
    value: profSpecValue,
    className: "cselect--toolbar",
    searchable: true,
    groups: profSpecGroups,
    placeholder: "Select profession / elite spec",
    onChange: async (nextValue) => {
      const [professionId, specPart] = nextValue.split(":");
      if (!professionId) return;
      const eliteSpecId = specPart === "core" ? 0 : Number(specPart) || 0;
      const isSameProfession = professionId === state.editor.profession;

      if (isSameProfession) {
        // Same profession — swap elite spec in slot 3, preserve slots 1-2
        const catalog = state.activeCatalog;
        if (!catalog) return;
        if (eliteSpecId) {
          // Set elite spec in slot 3
          const currentSlot2 = state.editor.specializations[2] || {};
          const currentSlot2Spec = catalog.specializationById.get(Number(currentSlot2.specializationId) || 0);
          if (Number(currentSlot2.specializationId) === eliteSpecId) return; // already set
          state.editor.specializations[2] = {
            specializationId: eliteSpecId,
            majorChoices: { 1: 0, 2: 0, 3: 0 },
          };
        } else {
          // Core — clear elite from slot 3 by setting a non-elite default
          const allSpecs = Array.isArray(catalog.specializations) ? catalog.specializations : [];
          const usedIds = new Set(
            state.editor.specializations.slice(0, 2).map((s) => Number(s?.specializationId) || 0).filter(Boolean)
          );
          const replacement = allSpecs.find((s) => !s.elite && !usedIds.has(s.id));
          state.editor.specializations[2] = replacement
            ? { specializationId: replacement.id, majorChoices: { 1: 0, 2: 0, 3: 0 } }
            : { specializationId: 0, majorChoices: { 1: 0, 2: 0, 3: 0 } };
        }
        _callbacks.enforceEditorConsistency({ preferredEliteSlot: 2 });
        _callbacks.markEditorChanged({ updateBuildList: true });
        renderEditor();
      } else {
        // Different profession — full switch
        if (state.editor.id) {
          if (state.editorDirty) {
            const changes = computeUnsavedChangeSummary();
            const body = changes.length
              ? `<ul>${changes.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
              : "<p>You have unsaved changes that will be lost.</p>";
            const confirmed = await showConfirmModal({
              title: "Discard unsaved changes?",
              body,
              confirmLabel: "Discard & Switch",
              cancelLabel: "Cancel",
            });
            if (!confirmed) {
              renderEditorForm();
              return;
            }
          }
          await _callbacks.startNewBuild(professionId, { skipDirtyCheck: true });
        } else {
          state.editor.profession = professionId;
          await _callbacks.setProfession(professionId, { preserveSelections: false });
          state.detail = null;
          _callbacks.captureEditorBaseline();
          renderEditor();
        }
        // After profession loads, set elite spec if requested
        if (eliteSpecId) {
          const catalog = state.activeCatalog;
          if (catalog) {
            state.editor.specializations[2] = {
              specializationId: eliteSpecId,
              majorChoices: { 1: 0, 2: 0, 3: 0 },
            };
            _callbacks.enforceEditorConsistency({ preferredEliteSlot: 2 });
            _callbacks.markEditorChanged({ updateBuildList: true });
            renderEditor();
          }
        }
      }
    },
  });
```

- [ ] **Step 3: Verify that enforceEditorConsistency and markEditorChanged are available via _callbacks**

Check that `_callbacks` exposes `enforceEditorConsistency` and `markEditorChanged`. If not, they need to be added to the callbacks object passed during initialization. Search `render-pages.js` for the callbacks setup and add them if missing.

Run: `grep -n "enforceEditorConsistency\|markEditorChanged" src/renderer/modules/render-pages.js` to check availability.

These functions are exported from `editor.js` as `enforceEditorConsistency` and the editor's `_markEditorChanged`. Check the callback registration in `renderer.js` to confirm they're wired up, and add them if not.

- [ ] **Step 4: Verify catalogCache is accessible**

The groups builder references `state.catalogCache?.[profession.id]` to get elite specs for professions other than the current one. Check if `state.catalogCache` exists. If catalogs are only loaded for the active profession, the elite spec options for non-active professions won't appear until selected.

If `catalogCache` doesn't exist, simplify: only show elite specs for the current profession's group, and show just "Core" for other professions. After a profession switch loads the catalog, `renderEditorForm()` is called again and will populate the elite specs.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/render-pages.js src/renderer/index.html
git commit -m "feat: wire up unified profession/elite spec dropdown"
```

---

### Task 5: Auto-focus search on dropdown open

**Files:**
- Modify: `src/renderer/modules/custom-select.js`

- [ ] **Step 1: Add focus call in toggleCustomSelect**

In `src/renderer/modules/custom-select.js`, in the `toggleCustomSelect` function, after the line `state.openCustomSelect = shouldOpen ? root : null;` (line 178), add:

```js
  if (shouldOpen) {
    const searchInput = root.querySelector(".cselect__search");
    if (searchInput) searchInput.focus();
  }
```

- [ ] **Step 2: Clear search on close**

In the `closeCustomSelect` function, before `state.openCustomSelect = null;` (line 197), add:

```js
  const searchInput = open.querySelector?.(".cselect__search");
  if (searchInput) {
    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input"));
  }
```

Note: In the test environment, `Event` may not exist. Wrap the dispatchEvent in a try/catch or check for `typeof Event !== "undefined"`. Alternatively, since the dropdown is re-rendered from state each time it opens, the search clearing may not be needed if `renderEditorForm` is called on each open. Verify behavior and skip if unnecessary.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/custom-select.js
git commit -m "feat: auto-focus search input on dropdown open, clear on close"
```

---

### Task 6: Manual test and final commit

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 2: Manual smoke test**

Launch the app and verify:
1. The dropdown shows "Profession / Elite Spec" label
2. Opening it shows all professions as group headers with elite specs indented below
3. Search filters by typing (e.g. "rea" shows Reaper and Firebrand)
4. Selecting an elite spec within the same profession preserves slots 1-2 trait choices
5. Selecting a different profession triggers a full profession switch
6. Selecting "Core" clears the elite spec from slot 3
7. The trigger shows the current elite spec name (or "Core {Profession}")

- [ ] **Step 3: Push the branch**

```bash
git push
```
