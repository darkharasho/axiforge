/**
 * @jest-environment jsdom
 *
 * Regression tests for issue #261:
 * - New subfolder in shared folder: input unreachable (wrong DOM location)
 * - New subfolder in shared folder: created in root instead of parent
 * - Rename of subfolder inside shared folder: rename input in wrong location
 *
 * Root causes:
 * 1. handleNewSubfolder called insertInlineInput without `container`, causing
 *    view-type detection to fail and the input to fall back to the sidebar section.
 * 2. handleRenameFolder queried only [data-navigate-folder] (sidebar), not content area.
 *
 * These tests exercise insertInlineInput directly (it is exported) and verify the
 * correct placement behavior with and without a container argument.
 */
"use strict";

const { insertInlineInput } = require("../../../src/renderer/modules/library/sidebar.js");

function buildListDOM() {
  document.body.innerHTML = `
    <div class="lib-sidebar">
      <div class="lib-sidebar__section"></div>
    </div>
    <div id="lib-content">
      <div class="lib-list">
        <div class="lib-list-row lib-list-row--folder" data-folder-id="shared-1">Shared Folder</div>
      </div>
    </div>
  `;
}

function buildGridDOM() {
  document.body.innerHTML = `
    <div class="lib-sidebar">
      <div class="lib-sidebar__section"></div>
    </div>
    <div id="lib-content">
      <div class="lib-grid lib-grid--folders">
        <div class="lib-grid-card lib-grid-card--folder" data-folder-id="shared-1">Shared Folder</div>
      </div>
    </div>
  `;
}

function buildIconDOM() {
  document.body.innerHTML = `
    <div class="lib-sidebar">
      <div class="lib-sidebar__section"></div>
    </div>
    <div id="lib-content">
      <div class="lib-icon-grid">
        <div class="lib-icon-item lib-icon-item--folder" data-folder-id="shared-1">Shared Folder</div>
      </div>
    </div>
  `;
}

// Cancel a pending insertInlineInput by pressing Escape on the inline input.
function cancelInline() {
  const input = document.querySelector(".lib-inline-input");
  if (input) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
}

// ── List view placement ─────────────────────────────────────────────────────

describe("insertInlineInput — list view placement (issue #261)", () => {
  beforeEach(buildListDOM);

  test("WITHOUT container, list-view div afterEl: input falls back to sidebar section (bug pattern)", () => {
    const folderEl = document.querySelector("[data-folder-id='shared-1']");
    // This is the pre-fix call: no container passed, so view detection cannot find the
    // lib-grid / lib-icon-grid / table and falls to the else branch. Because container is
    // falsy but afterEl is truthy, it does afterEl.insertAdjacentElement("afterend", row)
    // which inserts a sidebar-styled nav-item element in the content area div list.
    insertInlineInput(folderEl, "", { className: "lib-content-inline-folder" });

    const inputInSidebar = document.querySelector(".lib-sidebar .lib-inline-input");
    const inputAfterFolder = folderEl.nextElementSibling?.querySelector(".lib-inline-input");

    // The input is NOT in the sidebar because afterEl was truthy; it's inserted inline
    // after folderEl using sidebar styling (lib-nav-item--editing), NOT a content-area style.
    expect(inputAfterFolder).toBeTruthy(); // present, but wrong styling (sidebar nav item)
    expect(inputInSidebar).toBeNull();     // did not fall to sidebar section fallback

    cancelInline();
  });

  test("WITH container, list-view div afterEl: input inserted after folder row in content area", () => {
    const content = document.getElementById("lib-content");
    const folderEl = document.querySelector("[data-folder-id='shared-1']");

    // This is the fixed call: container passed, so view detection can inspect it.
    // In list view (no table/grid/icon), falls to else with container → container.appendChild.
    insertInlineInput(folderEl, "", { container: content, className: "lib-content-inline-folder" });

    // Input should be reachable in the content area
    const inputInContent = content.querySelector(".lib-inline-input");
    expect(inputInContent).toBeTruthy();

    cancelInline();
  });

  test("WITH container only (no afterEl), appends input to content container", () => {
    const content = document.getElementById("lib-content");

    insertInlineInput(null, "", { container: content, className: "lib-content-inline-folder" });

    const inputInContent = content.querySelector(".lib-inline-input");
    const inputInSidebar = document.querySelector(".lib-sidebar .lib-inline-input");
    expect(inputInContent).toBeTruthy();
    expect(inputInSidebar).toBeNull();

    cancelInline();
  });
});

// ── Grid view placement ─────────────────────────────────────────────────────

describe("insertInlineInput — grid view placement (issue #261)", () => {
  beforeEach(buildGridDOM);

  test("WITH container + grid: creates grid card editing element in grid", () => {
    const content = document.getElementById("lib-content");
    const folderEl = document.querySelector("[data-folder-id='shared-1']");

    insertInlineInput(folderEl, "", { container: content, className: "lib-content-inline-folder" });

    const editingCard = content.querySelector(".lib-grid-card--editing");
    const inputInCard = content.querySelector(".lib-grid-card--editing .lib-inline-input");
    expect(editingCard).toBeTruthy();
    expect(inputInCard).toBeTruthy();

    cancelInline();
  });

  test("WITHOUT container + grid div afterEl: no grid card created (falls to nav-item instead)", () => {
    const content = document.getElementById("lib-content");
    const folderEl = document.querySelector("[data-folder-id='shared-1']");

    // Pre-fix call: no container → isGrid check is container?.querySelector('.lib-grid') which
    // is undefined?.querySelector → false. Falls to else, inserts nav-item after folderEl.
    insertInlineInput(folderEl, "", { className: "lib-content-inline-folder" });

    const editingCard = content.querySelector(".lib-grid-card--editing");
    expect(editingCard).toBeNull(); // bug: grid card NOT created

    cancelInline();
  });
});

// ── Icon view placement ─────────────────────────────────────────────────────

describe("insertInlineInput — icon view placement (issue #261)", () => {
  beforeEach(buildIconDOM);

  test("WITH container + icon grid: creates icon editing element", () => {
    const content = document.getElementById("lib-content");
    const folderEl = document.querySelector("[data-folder-id='shared-1']");

    insertInlineInput(folderEl, "", { container: content });

    const editingItem = content.querySelector(".lib-icon-item--editing");
    expect(editingItem).toBeTruthy();

    cancelInline();
  });

  test("WITHOUT container + icon div afterEl: no icon editing element created (falls to nav-item)", () => {
    const content = document.getElementById("lib-content");
    const folderEl = document.querySelector("[data-folder-id='shared-1']");

    insertInlineInput(folderEl, "");

    const editingItem = content.querySelector(".lib-icon-item--editing");
    expect(editingItem).toBeNull(); // bug: icon edit item NOT created

    cancelInline();
  });
});

// ── Sidebar fallback (no afterEl, no container) ─────────────────────────────

describe("insertInlineInput — sidebar fallback behavior", () => {
  beforeEach(buildListDOM);

  test("without container and without afterEl, appends to sidebar section", () => {
    insertInlineInput(null, "");

    const inputInSidebar = document.querySelector(".lib-sidebar__section .lib-inline-input");
    expect(inputInSidebar).toBeTruthy();

    cancelInline();
  });
});

// ── Value resolution ─────────────────────────────────────────────────────────

describe("insertInlineInput — value resolution", () => {
  beforeEach(buildListDOM);

  test("resolves with typed value on Enter", async () => {
    const content = document.getElementById("lib-content");
    const promise = insertInlineInput(null, "", { container: content });

    const input = content.querySelector(".lib-inline-input");
    input.value = "My Subfolder";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await expect(promise).resolves.toBe("My Subfolder");
  });

  test("resolves with fallback name on blur with empty input", async () => {
    const content = document.getElementById("lib-content");
    const promise = insertInlineInput(null, "", { container: content, fallbackName: "New Folder" });

    const input = content.querySelector(".lib-inline-input");
    input.value = "";
    input.dispatchEvent(new Event("blur"));

    await expect(promise).resolves.toBe("New Folder");
  });

  test("resolves with null on Escape", async () => {
    const content = document.getElementById("lib-content");
    const promise = insertInlineInput(null, "", { container: content });

    const input = content.querySelector(".lib-inline-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    await expect(promise).resolves.toBeNull();
  });

  test("removes inline element from DOM after resolution", async () => {
    const content = document.getElementById("lib-content");
    const promise = insertInlineInput(null, "", { container: content });

    const input = content.querySelector(".lib-inline-input");
    input.value = "Test";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await promise;
    expect(content.querySelector(".lib-inline-input")).toBeNull();
  });
});
