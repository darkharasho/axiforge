# Skill Dropdown Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the heal/utility/elite skill dropdown to be wider with 40px icons, show skill descriptions, and add a search bar that matches name + description text.

**Architecture:** Extend the existing `renderCustomSelect()` with new opt-in config fields (`searchable` on flat lists, `iconSize`, `searchFields`, `description` rendering). Skill slots pass new config; CSS scoped under `.cselect--skill-slot` handles sizing. No new components.

**Tech Stack:** Vanilla JS (DOM), CSS

---

### Task 1: Enable search on flat option lists in `custom-select.js`

**Files:**
- Modify: `src/renderer/modules/custom-select.js:48-148`
- Test: `tests/unit/renderer/custom-select.test.js`

Currently search only works when `config.groups` is provided. We need it to work on flat `config.options` too.

- [ ] **Step 1: Write the failing test — search renders on flat options**

Add to `tests/unit/renderer/custom-select.test.js`:

```js
describe("renderCustomSelect — flat searchable", () => {
  test("renders search input for flat options when searchable is true", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "alpha",
      searchable: true,
      options: [
        { value: "alpha", label: "Alpha" },
        { value: "bravo", label: "Bravo" },
      ],
      onChange: () => {},
    });

    const search = host.querySelector(".cselect__search");
    expect(search).toBeTruthy();
    expect(search.tagName).toBe("INPUT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/renderer/custom-select.test.js --testNamePattern="renders search input for flat options" --no-coverage`
Expected: FAIL — search input is null because the current code only renders it when `hasGroups` is true.

- [ ] **Step 3: Implement search on flat options**

In `src/renderer/modules/custom-select.js`, replace the search rendering block (lines 118-139) with logic that also handles flat lists. After the `menu.append(list)` line (line 116), replace:

```js
  if (config.searchable && hasGroups) {
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "cselect__search";
    searchInput.placeholder = "Search...";
    searchInput.addEventListener("click", (e) => { e.stopPropagation(); });
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase().trim();
      for (const groupRef of groupRefs) {
        let groupHasVisible = false;
        const matchesGroup = groupRef.groupLabel.toLowerCase().includes(query);
        for (const optRef of groupRef.options) {
          const matchesOption = optRef.label.toLowerCase().includes(query);
          const visible = !query || matchesOption || matchesGroup;
          optRef.el.style.display = visible ? "" : "none";
          if (visible) groupHasVisible = true;
        }
        groupRef.headerEl.style.display = groupHasVisible ? "" : "none";
      }
    });
    menu.insertBefore(searchInput, list);
  }
```

with:

```js
  // Track flat option elements for search filtering (populated in the flat branch above)
  // flatOptionRefs is built alongside the flat options loop.

  if (config.searchable) {
    const searchFields = config.searchFields || ["label"];
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "cselect__search";
    searchInput.placeholder = "Search...";
    searchInput.addEventListener("click", (e) => { e.stopPropagation(); });
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase().trim();
      if (hasGroups) {
        for (const groupRef of groupRefs) {
          let groupHasVisible = false;
          const matchesGroup = groupRef.groupLabel.toLowerCase().includes(query);
          for (const optRef of groupRef.options) {
            const visible = !query || matchesGroup || searchFields.some((f) => (optRef[f] || "").toLowerCase().includes(query));
            optRef.el.style.display = visible ? "" : "none";
            if (visible) groupHasVisible = true;
          }
          groupRef.headerEl.style.display = groupHasVisible ? "" : "none";
        }
      } else {
        let anyVisible = false;
        for (const optRef of flatOptionRefs) {
          const visible = !query || searchFields.some((f) => (optRef[f] || "").toLowerCase().includes(query));
          optRef.el.style.display = visible ? "" : "none";
          if (visible) anyVisible = true;
        }
        // Show/hide empty state
        let emptyEl = list.querySelector(".cselect__empty");
        if (!anyVisible && query) {
          if (!emptyEl) {
            emptyEl = document.createElement("p");
            emptyEl.className = "cselect__empty";
            emptyEl.textContent = "No skills found";
            list.append(emptyEl);
          }
          emptyEl.style.display = "";
        } else if (emptyEl) {
          emptyEl.style.display = "none";
        }
      }
    });
    menu.insertBefore(searchInput, list);
  }
```

Also, we need to build `flatOptionRefs` in the flat options branch. In the `else if (allOptions.length)` block (lines 105-108), change:

```js
  } else if (allOptions.length) {
    for (const option of allOptions) {
      list.append(makeOptionButton(option));
    }
  }
```

to:

```js
  } else if (allOptions.length) {
    for (const option of allOptions) {
      const btn = makeOptionButton(option);
      list.append(btn);
      flatOptionRefs.push({ el: btn, label: option.label, description: option.description || "" });
    }
  }
```

And declare `flatOptionRefs` near the top of the function, next to `groupRefs` (after line 86):

```js
  const flatOptionRefs = [];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/renderer/custom-select.test.js --testNamePattern="renders search input for flat options" --no-coverage`
Expected: PASS

- [ ] **Step 5: Write the failing test — flat search filters by label**

Add to the `"flat searchable"` describe block:

```js
  test("typing in search filters flat options by label", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "alpha",
      searchable: true,
      options: [
        { value: "alpha", label: "Alpha" },
        { value: "bravo", label: "Bravo" },
        { value: "charlie", label: "Charlie" },
      ],
      onChange: () => {},
    });

    const search = host.querySelector(".cselect__search");
    search.value = "bra";
    search.dispatchEvent({ type: "input", preventDefault() {}, stopPropagation() {}, target: search });

    const options = host.querySelectorAll(".cselect__option");
    const visible = options.filter((o) => o.style.display !== "none");
    expect(visible.length).toBe(1);
    expect(visible[0].querySelector(".cselect__label").textContent).toBe("Bravo");
  });
```

- [ ] **Step 6: Run test to verify it passes** (should already pass with Step 3 implementation)

Run: `npx jest tests/unit/renderer/custom-select.test.js --testNamePattern="typing in search filters flat options" --no-coverage`
Expected: PASS

- [ ] **Step 7: Write the failing test — search matches description field**

```js
  test("search matches against description when searchFields includes it", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "alpha",
      searchable: true,
      searchFields: ["label", "description"],
      options: [
        { value: "alpha", label: "Alpha Skill", description: "Grants stability" },
        { value: "bravo", label: "Bravo Skill", description: "Heals allies" },
      ],
      onChange: () => {},
    });

    const search = host.querySelector(".cselect__search");
    search.value = "stability";
    search.dispatchEvent({ type: "input", preventDefault() {}, stopPropagation() {}, target: search });

    const options = host.querySelectorAll(".cselect__option");
    const visible = options.filter((o) => o.style.display !== "none");
    expect(visible.length).toBe(1);
    expect(visible[0].querySelector(".cselect__label").textContent).toBe("Alpha Skill");
  });
```

- [ ] **Step 8: Run test to verify it passes** (should already pass)

Run: `npx jest tests/unit/renderer/custom-select.test.js --testNamePattern="search matches against description" --no-coverage`
Expected: PASS

- [ ] **Step 9: Write the failing test — empty search shows all options**

```js
  test("clearing search shows all flat options", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "alpha",
      searchable: true,
      options: [
        { value: "alpha", label: "Alpha" },
        { value: "bravo", label: "Bravo" },
      ],
      onChange: () => {},
    });

    const search = host.querySelector(".cselect__search");
    search.value = "alpha";
    search.dispatchEvent({ type: "input", preventDefault() {}, stopPropagation() {}, target: search });

    // Only Alpha visible
    let visible = host.querySelectorAll(".cselect__option").filter((o) => o.style.display !== "none");
    expect(visible.length).toBe(1);

    // Clear search
    search.value = "";
    search.dispatchEvent({ type: "input", preventDefault() {}, stopPropagation() {}, target: search });

    visible = host.querySelectorAll(".cselect__option").filter((o) => o.style.display !== "none");
    expect(visible.length).toBe(2);
  });
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx jest tests/unit/renderer/custom-select.test.js --testNamePattern="clearing search shows all flat" --no-coverage`
Expected: PASS

- [ ] **Step 11: Write the failing test — no results shows empty state**

```js
  test("shows empty state when no options match search", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "alpha",
      searchable: true,
      options: [
        { value: "alpha", label: "Alpha" },
        { value: "bravo", label: "Bravo" },
      ],
      onChange: () => {},
    });

    const search = host.querySelector(".cselect__search");
    search.value = "zzzzz";
    search.dispatchEvent({ type: "input", preventDefault() {}, stopPropagation() {}, target: search });

    const empty = host.querySelector(".cselect__empty");
    expect(empty).toBeTruthy();
    expect(empty.style.display).not.toBe("none");
    expect(empty.textContent).toBe("No skills found");
  });
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx jest tests/unit/renderer/custom-select.test.js --testNamePattern="shows empty state" --no-coverage`
Expected: PASS

- [ ] **Step 13: Run full test suite to check for regressions**

Run: `npx jest tests/unit/renderer/custom-select.test.js --no-coverage`
Expected: All tests PASS (existing grouped search tests should still work since we preserved the grouped branch)

- [ ] **Step 14: Commit**

```bash
git add src/renderer/modules/custom-select.js tests/unit/renderer/custom-select.test.js
git commit -m "feat: enable searchable flat options in custom select with multi-field search"
```

---

### Task 2: Add description rendering to option rows

**Files:**
- Modify: `src/renderer/modules/custom-select.js:151-170` (the `makeCustomSelectValueNode` function)
- Test: `tests/unit/renderer/custom-select.test.js`

Options with a `description` field should render a second line of text below the label.

- [ ] **Step 1: Write the failing test — description element renders**

Add a new describe block to `tests/unit/renderer/custom-select.test.js`:

```js
describe("renderCustomSelect — option descriptions", () => {
  test("renders description text below option label when provided", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "alpha",
      options: [
        { value: "alpha", label: "Alpha Skill", description: "Grants stability to allies" },
        { value: "bravo", label: "Bravo Skill" },
      ],
      onChange: () => {},
    });

    const options = host.querySelectorAll(".cselect__option");

    // First option should have a description element
    const desc = options[0].querySelector(".cselect__option-description");
    expect(desc).toBeTruthy();
    expect(desc.textContent).toBe("Grants stability to allies");

    // Second option should NOT have a description element (no description provided)
    const noDesc = options[1].querySelector(".cselect__option-description");
    expect(noDesc).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/renderer/custom-select.test.js --testNamePattern="renders description text below" --no-coverage`
Expected: FAIL — `.cselect__option-description` element doesn't exist yet.

- [ ] **Step 3: Implement description rendering**

In `src/renderer/modules/custom-select.js`, modify `makeCustomSelectValueNode` (around line 151). The `option` object is passed in — add description rendering after the meta span, inside the `text` span:

Replace the current function:

```js
export function makeCustomSelectValueNode(option, placeholder) {
  const value = document.createElement("span");
  value.className = "cselect__value";
  value.append(makeCustomSelectIconNode(option));

  const text = document.createElement("span");
  text.className = "cselect__text";
  const label = document.createElement("span");
  label.className = "cselect__label";
  label.textContent = String(option?.label || placeholder || "Select");
  text.append(label);
  if (option?.meta) {
    const meta = document.createElement("span");
    meta.className = "cselect__meta";
    meta.textContent = String(option.meta);
    text.append(meta);
  }
  value.append(text);
  return value;
}
```

with:

```js
export function makeCustomSelectValueNode(option, placeholder) {
  const value = document.createElement("span");
  value.className = "cselect__value";
  value.append(makeCustomSelectIconNode(option));

  const text = document.createElement("span");
  text.className = "cselect__text";
  const label = document.createElement("span");
  label.className = "cselect__label";
  label.textContent = String(option?.label || placeholder || "Select");
  text.append(label);
  if (option?.meta) {
    const meta = document.createElement("span");
    meta.className = "cselect__meta";
    meta.textContent = String(option.meta);
    text.append(meta);
  }
  if (option?.description) {
    const desc = document.createElement("span");
    desc.className = "cselect__option-description";
    desc.textContent = String(option.description);
    text.append(desc);
  }
  value.append(text);
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/renderer/custom-select.test.js --testNamePattern="renders description text below" --no-coverage`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx jest tests/unit/renderer/custom-select.test.js --no-coverage`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/custom-select.js tests/unit/renderer/custom-select.test.js
git commit -m "feat: render option description text in custom select dropdown"
```

---

### Task 3: Add CSS for wider menu, larger icons, description text, and search styling

**Files:**
- Modify: `src/renderer/styles/custom-select.css`
- Modify: `src/renderer/styles/skills.css:579-582`

- [ ] **Step 1: Add skill-slot scoped overrides to `custom-select.css`**

Append to the end of `src/renderer/styles/custom-select.css`:

```css
/* ── Skill slot dropdown overrides ──────────────────────────────────────── */

.skill-select-overlay .cselect__menu {
  min-width: 340px;
}

.skill-select-overlay .cselect__list {
  max-height: 400px;
}

.skill-select-overlay .cselect__icon {
  width: 40px;
  height: 40px;
  border-radius: 4px;
}

.skill-select-overlay .cselect__option {
  align-items: flex-start;
}

/* ── Option description ─────────────────────────────────────────────────── */

.cselect__option-description {
  display: block;
  font-size: 0.69rem;
  color: #6a7a9e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}
```

- [ ] **Step 2: Update the old min-width rule in `skills.css`**

In `src/renderer/styles/skills.css`, the existing rule at line 579-582:

```css
.skill-select-overlay .cselect__menu {
  min-width: 220px;
  pointer-events: auto;
}
```

Remove the `min-width: 220px;` line (it's now in `custom-select.css` at 340px). Keep `pointer-events: auto;`:

```css
.skill-select-overlay .cselect__menu {
  pointer-events: auto;
}
```

- [ ] **Step 3: Verify visually**

Run: `npm start`
Open the app, select a profession, click a heal/utility/elite skill slot. Verify:
- Dropdown is ~340px wide
- Icons are 40px
- Description text shows below skill names in muted gray, truncated with ellipsis
- Search input appears at top of menu
- Typing filters skills by name and description
- "No skills found" shows when search has no matches
- Existing spec/profession selects are unchanged

- [ ] **Step 4: Commit**

```bash
git add src/renderer/styles/custom-select.css src/renderer/styles/skills.css
git commit -m "style: wider skill dropdown with 40px icons and description text"
```

---

### Task 4: Wire up skill slots to use new config

**Files:**
- Modify: `src/renderer/modules/skills.js:811-828,939-944`

- [ ] **Step 1: Add description to skill option objects**

In `src/renderer/modules/skills.js`, in `makeSkillSlot()`, change the `skillOptions` mapping (lines 821-828) from:

```js
  const skillOptions = filteredList.map((skill) => ({
    value: String(skill.id),
    label: skill.name,
    icon: skill.icon || "",
    meta: skill.type ? String(skill.type).toUpperCase() : "",
    kind: "skill",
    entity: skill,
  }));
```

to:

```js
  const skillOptions = filteredList.map((skill) => ({
    value: String(skill.id),
    label: skill.name,
    icon: skill.icon || "",
    description: skill.description || "",
    meta: skill.type ? String(skill.type).toUpperCase() : "",
    kind: "skill",
    entity: skill,
  }));
```

- [ ] **Step 2: Pass searchable config to renderCustomSelect**

In the same function, change the `renderCustomSelect` call (lines 939-944) from:

```js
    renderCustomSelect(selectHost, {
      value: String(selectedId || ""),
      className: "cselect--skill-slot",
      options: skillOptions,
      placeholder: filteredList.length ? "Select skill" : "No skills available",
      disabled: !filteredList.length,
      onChange: (nextValue) => {
```

to:

```js
    renderCustomSelect(selectHost, {
      value: String(selectedId || ""),
      className: "cselect--skill-slot",
      options: skillOptions,
      placeholder: filteredList.length ? "Select skill" : "No skills available",
      disabled: !filteredList.length,
      searchable: true,
      searchFields: ["label", "description"],
      onChange: (nextValue) => {
```

- [ ] **Step 3: Remove the pre-filtering** 

The `query` variable and `filterSkillList` call are no longer needed since the custom select handles search internally. Change lines 813 and 819 from:

```js
  const query = "";
  const selectedId =
    slot.index === undefined
      ? Number(target[slot.key]) || 0
      : Number(target[slot.key]?.[slot.index]) || 0;
  const selectedSkill = slot.list.find((skill) => Number(skill.id) === selectedId) || null;
  const filteredList = filterSkillList(slot.list, query, selectedId);
```

to:

```js
  const selectedId =
    slot.index === undefined
      ? Number(target[slot.key]) || 0
      : Number(target[slot.key]?.[slot.index]) || 0;
  const selectedSkill = slot.list.find((skill) => Number(skill.id) === selectedId) || null;
  const filteredList = slot.list;
```

Note: Keep `filterSkillList` exported — it may be used elsewhere. The variable `filteredList` is still referenced in the placeholder check and option mapping, so we just assign `slot.list` directly.

- [ ] **Step 4: Verify visually**

Run: `npm start`
Open the app, select a profession, and verify:
- Skill dropdowns show description text under each skill name
- Searching "stability" surfaces skills whose descriptions mention stability
- Searching by name still works
- Selecting a skill still works (onChange fires, icon updates)
- Kit toggle, drag-to-swap, keybinds all still function
- Specialization-locked skills still show lock indicator

- [ ] **Step 5: Run all unit tests**

Run: `npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/skills.js
git commit -m "feat: wire skill slots to searchable dropdown with description search"
```
