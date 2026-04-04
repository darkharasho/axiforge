"use strict";

// custom-select.js uses document.createElement, querySelector, etc.
// testEnvironment is "node", so we use a minimal DOM mock.

function makeElement(tag) {
  let _className = "";
  const el = {
    tagName: tag.toUpperCase(),
    get className() { return _className; },
    set className(v) {
      _className = v;
      el.classList._set = new Set(v.split(/\s+/).filter(Boolean));
    },
    type: "",
    textContent: "",
    disabled: false,
    style: {},
    dataset: {},
    _children: [],
    _listeners: {},
    _parent: null,

    classList: (() => {
      const api = {
        add(...cs) { for (const c of cs) api._set.add(c); _syncClassName(); },
        remove(...cs) { for (const c of cs) api._set.delete(c); _syncClassName(); },
        contains(c) { return api._set.has(c); },
        toggle(c, force) {
          const has = api._set.has(c);
          const add = force !== undefined ? force : !has;
          if (add) api._set.add(c); else api._set.delete(c);
          _syncClassName();
          return add;
        },
        _set: new Set(),
      };
      function _syncClassName() { _className = [...api._set].join(" "); }
      return api;
    })(),

    append(...nodes) {
      for (const n of nodes) {
        if (typeof n === "string") continue;
        n._parent = el;
        el._children.push(n);
      }
    },
    appendChild(child) { child._parent = el; el._children.push(child); return child; },
    insertBefore(newChild, refChild) {
      newChild._parent = el;
      const idx = el._children.indexOf(refChild);
      if (idx === -1) { el._children.push(newChild); } else { el._children.splice(idx, 0, newChild); }
      return newChild;
    },

    addEventListener(event, handler) {
      (el._listeners[event] ||= []).push(handler);
    },
    removeEventListener(event, handler) {
      const list = el._listeners[event];
      if (list) el._listeners[event] = list.filter((h) => h !== handler);
    },
    dispatchEvent(event) {
      const handlers = el._listeners[event.type] || [];
      for (const h of handlers) h(event);
    },
    click() {
      const ev = { type: "click", preventDefault() {}, stopPropagation() {}, target: el };
      el.dispatchEvent(ev);
    },

    get isConnected() { return true; },

    // innerHTML setter clears children
    set innerHTML(v) { el._innerHTML = v; el._children = []; },
    get innerHTML() { return el._innerHTML || ""; },

    // Basic querySelector / querySelectorAll by class
    querySelectorAll(sel) {
      const results = [];
      _walk(el, (node) => { if (_matches(node, sel)) results.push(node); });
      return results;
    },
    querySelector(sel) {
      let found = null;
      _walk(el, (node) => { if (!found && _matches(node, sel)) found = node; });
      return found;
    },
    replaceWith(newNode) {
      if (el._parent) {
        const idx = el._parent._children.indexOf(el);
        if (idx !== -1) {
          el._parent._children[idx] = newNode;
          newNode._parent = el._parent;
        }
      }
    },
    closest(sel) {
      let cur = el;
      while (cur) {
        if (_matches(cur, sel)) return cur;
        cur = cur._parent;
      }
      return null;
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 50, left: 0, right: 200 };
    },
  };
  return el;
}

// Walk all descendants
function _walk(node, fn) {
  for (const child of node._children || []) {
    fn(child);
    _walk(child, fn);
  }
}

// Match a simple selector: ".foo", ".foo.bar", ".foo .bar", "tag", "tag.class"
function _matches(node, selector) {
  // Handle compound selectors with spaces (descendant combinator)
  if (selector.includes(" ")) {
    const parts = selector.trim().split(/\s+/);
    // Only match the last part for the element itself
    return _matchesSingle(node, parts[parts.length - 1]);
  }
  return _matchesSingle(node, selector);
}

function _matchesSingle(node, sel) {
  if (!node || !node.tagName) return false;
  // Parse selector: optional tag + optional classes
  const classMatch = sel.match(/^([a-z]*)((?:\.[a-zA-Z0-9_-]+)*)$/);
  if (!classMatch) return false;
  const [, tagPart, classPart] = classMatch;
  if (tagPart && node.tagName !== tagPart.toUpperCase()) return false;
  if (classPart) {
    const classes = classPart.split(".").filter(Boolean);
    for (const c of classes) {
      if (!node.classList.contains(c)) return false;
    }
  }
  return true;
}

// --- Setup global DOM mock ---

let customSelectModule, stateModule;

beforeEach(() => {
  jest.resetModules();

  global.document = {
    createElement: (tag) => makeElement(tag),
    body: makeElement("body"),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  global.window = { innerHeight: 800, innerWidth: 1200 };
  global.requestAnimationFrame = (cb) => cb();

  customSelectModule = require("../../../src/renderer/modules/custom-select.js");
  stateModule = require("../../../src/renderer/modules/state.js");
  stateModule.state.openCustomSelect = null;
});

afterEach(() => {
  delete global.document;
  delete global.window;
  delete global.requestAnimationFrame;
});

describe("renderCustomSelect — trigger update on selection", () => {
  test("trigger displays newly selected option after clicking an item", () => {
    const host = makeElement("div");
    const onChange = jest.fn();

    customSelectModule.renderCustomSelect(host, {
      value: "alpha",
      options: [
        { value: "alpha", label: "Alpha", meta: "USER" },
        { value: "bravo", label: "Bravo", meta: "ORG" },
      ],
      onChange,
    });

    // Verify initial trigger text
    const trigger = host.querySelector(".cselect__trigger");
    expect(trigger).toBeTruthy();
    expect(trigger.querySelector(".cselect__label").textContent).toBe("Alpha");

    // Click the second option
    const options = host.querySelectorAll(".cselect__option");
    expect(options.length).toBe(2);
    options[1].click();

    // onChange should have been called
    expect(onChange).toHaveBeenCalledWith("bravo", expect.objectContaining({ value: "bravo" }));

    // Trigger should now show "Bravo"
    expect(trigger.querySelector(".cselect__label").textContent).toBe("Bravo");
  });

  test("trigger meta text updates after selection", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "alpha",
      options: [
        { value: "alpha", label: "Alpha", meta: "USER" },
        { value: "bravo", label: "Bravo", meta: "ORG" },
      ],
      onChange: () => {},
    });

    const trigger = host.querySelector(".cselect__trigger");
    expect(trigger.querySelector(".cselect__meta").textContent).toBe("USER");

    host.querySelectorAll(".cselect__option")[1].click();

    expect(trigger.querySelector(".cselect__meta").textContent).toBe("ORG");
  });

  test("selected option class toggles after selection", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "alpha",
      options: [
        { value: "alpha", label: "Alpha" },
        { value: "bravo", label: "Bravo" },
      ],
      onChange: () => {},
    });

    const options = host.querySelectorAll(".cselect__option");
    expect(options[0].classList.contains("cselect__option--selected")).toBe(true);
    expect(options[1].classList.contains("cselect__option--selected")).toBe(false);

    options[1].click();

    expect(options[0].classList.contains("cselect__option--selected")).toBe(false);
    expect(options[1].classList.contains("cselect__option--selected")).toBe(true);
  });
});

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

  test("group with empty options array renders header but no options", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "",
      groups: [
        {
          label: "EmptyGroup",
          options: [],
        },
      ],
      onChange: () => {},
    });

    const headers = host.querySelectorAll(".cselect__group-header");
    expect(headers.length).toBe(1);
    expect(headers[0].querySelector(".cselect__label").textContent).toBe("EmptyGroup");

    const options = host.querySelectorAll(".cselect__option");
    expect(options.length).toBe(0);
  });

  test("empty groups array shows 'No options' empty state", () => {
    const host = makeElement("div");

    customSelectModule.renderCustomSelect(host, {
      value: "",
      groups: [],
      onChange: () => {},
    });

    const empty = host.querySelector(".cselect__empty");
    expect(empty).toBeTruthy();
    expect(empty.textContent).toBe("No options");

    const headers = host.querySelectorAll(".cselect__group-header");
    expect(headers.length).toBe(0);
  });
});

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
    expect(empty.textContent).toBe("No results found");
  });

  test("empty state hides when search is cleared after no results", () => {
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

    // Search with no results
    search.value = "zzzzz";
    search.dispatchEvent({ type: "input", preventDefault() {}, stopPropagation() {}, target: search });

    const empty = host.querySelector(".cselect__empty");
    expect(empty).toBeTruthy();
    expect(empty.style.display).not.toBe("none");

    // Clear search
    search.value = "";
    search.dispatchEvent({ type: "input", preventDefault() {}, stopPropagation() {}, target: search });

    expect(empty.style.display).toBe("none");
  });
});

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
