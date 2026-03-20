# Comp Share Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `<AxiForge:Comp:payload>` share codes for encoding and decoding full party compositions, allowing users to copy/paste comps as compact text strings.

**Architecture:** A new `compCodec.js` module in the main process implements the comp encoding/decoding using JSON + deflate + base64url, with nested Z85 build payloads from the existing `@mks.haro/axicode` package. IPC handlers expose this to the renderer, and the comp detail/list views add copy/paste UI. Note: the spec places these functions in the `@mks.haro/axicode` package — we implement them in the app first for faster iteration, then port to the package later.

**Tech Stack:** Node.js built-in `zlib` (deflate/inflate), `@mks.haro/axicode` (build encoding), existing IPC/preload infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-20-comp-share-codes-design.md`

---

### Task 1: Implement comp codec module

**Files:**
- Create: `src/main/compCodec.js`
- Test: `tests/unit/compCodec.test.js`

This module implements three functions: `encodeComp`, `decodeComp`, and `isValidCompCode`. It uses Node.js `zlib` for deflate/inflate and `@mks.haro/axicode` for individual build encoding.

- [ ] **Step 1: Create test file with first test — `isValidCompCode`**

```js
// tests/unit/compCodec.test.js
const { isValidCompCode } = require("../../src/main/compCodec");

describe("isValidCompCode", () => {
  test("returns true for valid comp code format", () => {
    expect(isValidCompCode("<AxiForge:Comp:somePayload>")).toBe(true);
  });

  test("returns false for empty payload", () => {
    expect(isValidCompCode("<AxiForge:Comp:>")).toBe(false);
  });

  test("returns false for build share code", () => {
    expect(isValidCompCode("<AxiForge:Berserker:abc123>")).toBe(false);
  });

  test("returns false for random text", () => {
    expect(isValidCompCode("hello world")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isValidCompCode("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/compCodec.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `isValidCompCode`**

```js
// src/main/compCodec.js
"use strict";

const COMP_PREFIX = "<AxiForge:Comp:";
const COMP_SUFFIX = ">";

function isValidCompCode(text) {
  if (typeof text !== "string") return false;
  if (!text.startsWith(COMP_PREFIX) || !text.endsWith(COMP_SUFFIX)) return false;
  const payload = text.slice(COMP_PREFIX.length, -COMP_SUFFIX.length);
  return payload.length > 0;
}

module.exports = { isValidCompCode };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/compCodec.test.js --verbose`
Expected: All PASS

- [ ] **Step 5: Add `encodeComp` tests**

Append to the test file:

```js
const { encodeComp, decodeComp } = require("../../src/main/compCodec");

// Build fixture matching the axicode.encodeShareCode contract (same shape as buildShareCode.test.js)
const mockBuild = {
  profession: "Warrior",
  gameMode: "pve",
  specializations: [
    { id: 4, name: "Strength", elite: false, majorChoices: { 1: 1444, 2: 1449, 3: 1437 },
      majorTraitsByTier: { 1: [{ id: 1444 }, { id: 1447 }, { id: 2000 }], 2: [{ id: 1449 }, { id: 1448 }, { id: 1453 }], 3: [{ id: 1437 }, { id: 1440 }, { id: 1454 }] } },
    { id: 36, name: "Discipline", elite: false, majorChoices: { 1: 1413, 2: 1489, 3: 1369 },
      majorTraitsByTier: { 1: [{ id: 1413 }, { id: 1381 }, { id: 1415 }], 2: [{ id: 1489 }, { id: 1484 }, { id: 1709 }], 3: [{ id: 1369 }, { id: 1317 }, { id: 1657 }] } },
    { id: 18, name: "Berserker", elite: true, majorChoices: { 1: 2049, 2: 2039, 3: 2043 },
      majorTraitsByTier: { 1: [{ id: 2049 }, { id: 2042 }, { id: 1928 }], 2: [{ id: 2039 }, { id: 2011 }, { id: 1977 }], 3: [{ id: 2043 }, { id: 2038 }, { id: 2060 }] } },
  ],
  skills: {
    heal: { id: 14402 }, utility: [{ id: 14404 }, { id: 14410 }, { id: 14405 }], elite: { id: 14355 },
  },
  underwaterSkills: { heal: null, utility: [null, null, null], elite: null },
  equipment: {
    statPackage: "Berserker's",
    relic: "Relic of the Thief",
    food: "Bowl of Sweet and Spicy Butternut Squash Soup",
    utility: "Superior Sharpening Stone",
    enrichment: "",
    weapons: { mainhand1: "greatsword", offhand1: "", mainhand2: "axe", offhand2: "", aquatic1: "", aquatic2: "" },
    runes: { head: "24836", shoulders: "24836", chest: "24836", hands: "24836", legs: "24836", feet: "24836" },
    sigils: { mainhand1: ["24615", "24868"], offhand1: [], mainhand2: ["24615", ""], offhand2: [], aquatic1: [], aquatic2: [] },
    infusions: { head: "49432", shoulders: "49432", chest: "49432", hands: "49432", legs: "49432", feet: "49432",
      back: ["49432", "49432"], ring1: ["49432", "49432", "49432"], ring2: ["49432", "49432", "49432"],
      accessory1: "49432", accessory2: "49432",
      mainhand1: ["49432", "49432"], offhand1: [], mainhand2: ["49432", "49432"], offhand2: [] },
  },
  selectedLegends: ["", ""],
  selectedUnderwaterLegends: ["", ""],
  selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
  activeAttunement: "",
  activeAttunement2: "",
  activeKit: 0,
  activeWeaponSet: 1,
  allianceTacticsForm: 0,
  antiquaryArtifacts: { f2: 0, f3: 0, f4: 0 },
};

describe("encodeComp", () => {
  test("produces a valid comp code string", () => {
    const comp = {
      name: "Test Comp",
      gameMode: "pve",
      partyLines: [{ id: "line1", capacity: 5, slots: ["b1"] }],
      buildIds: ["b1"],
    };
    const builds = { b1: mockBuild };

    const code = encodeComp(comp, builds);
    expect(code.startsWith("<AxiForge:Comp:")).toBe(true);
    expect(code.endsWith(">")).toBe(true);
    expect(isValidCompCode(code)).toBe(true);
  });

  test("returns null when a build is missing from the map", () => {
    const comp = {
      name: "Test Comp",
      gameMode: "pve",
      partyLines: [{ id: "line1", capacity: 5, slots: ["missing-id"] }],
      buildIds: ["missing-id"],
    };
    const result = encodeComp(comp, {});
    expect(result).toBeNull();
  });

  test("handles empty comp with no party lines", () => {
    const comp = { name: "Empty", gameMode: null, partyLines: [], buildIds: [] };
    const code = encodeComp(comp, {});
    expect(isValidCompCode(code)).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify encodeComp tests fail**

Run: `npx jest tests/unit/compCodec.test.js --verbose`
Expected: FAIL — `encodeComp` not defined

- [ ] **Step 7: Implement `encodeComp`**

Add to `src/main/compCodec.js`:

```js
const zlib = require("node:zlib");
const { encodeShareCode } = require("@mks.haro/axicode");

function extractPayload(shareCode) {
  // "<AxiForge:Label:payload>" → "payload"
  const firstColon = shareCode.indexOf(":");
  const secondColon = shareCode.indexOf(":", firstColon + 1);
  return shareCode.slice(secondColon + 1, -1);
}

function encodeComp(comp, builds) {
  // Encode each unique build, deduplicate by Z85 payload equality
  const payloadToIndex = new Map();
  const buildPayloads = [];
  const buildIdToIndex = new Map();

  // Collect all build IDs referenced in party line slots
  const referencedIds = new Set();
  for (const line of (comp.partyLines || [])) {
    for (const buildId of (line.slots || [])) {
      referencedIds.add(buildId);
    }
  }

  for (const buildId of referencedIds) {
    const build = builds[buildId] || (Array.isArray(builds) ? builds.find((b) => b.id === buildId) : null);
    if (!build) return null; // Build not found — fail the entire encode

    let code;
    try {
      code = encodeShareCode(build);
    } catch {
      return null; // Build failed to encode — fail the entire encode
    }

    const payload = extractPayload(code);
    if (!payloadToIndex.has(payload)) {
      payloadToIndex.set(payload, buildPayloads.length);
      buildPayloads.push(payload);
    }
    buildIdToIndex.set(buildId, payloadToIndex.get(payload));
  }

  // Build the JSON schema
  const schema = {
    v: 1,
    n: String(comp.name || "Untitled Comp").slice(0, 140),
    g: comp.gameMode === "pve" || comp.gameMode === "wvw" ? comp.gameMode : null,
    b: buildPayloads,
    p: (comp.partyLines || []).map((line) => {
      const capacity = typeof line.capacity === "number" ? line.capacity : 5;
      const slots = (line.slots || []).map((id) =>
        buildIdToIndex.has(id) ? buildIdToIndex.get(id) : -1
      );
      // Pad to capacity with -1
      while (slots.length < capacity) slots.push(-1);
      return { c: capacity, s: slots };
    }),
  };

  // JSON → deflate → base64url
  const json = JSON.stringify(schema);
  const compressed = zlib.deflateSync(Buffer.from(json, "utf-8"));
  const base64url = compressed.toString("base64url");

  return `${COMP_PREFIX}${base64url}${COMP_SUFFIX}`;
}
```

Update `module.exports` to include `encodeComp`.

- [ ] **Step 8: Run test to verify encodeComp tests pass**

Run: `npx jest tests/unit/compCodec.test.js --verbose`
Expected: All PASS

- [ ] **Step 9: Add `decodeComp` tests**

Append to test file:

```js
describe("decodeComp", () => {
  test("round-trips a comp with one build", () => {
    const comp = {
      name: "Round Trip",
      gameMode: "pve",
      partyLines: [{ id: "line1", capacity: 5, slots: ["b1"] }],
      buildIds: ["b1"],
    };
    const builds = { b1: mockBuild };

    const code = encodeComp(comp, builds);
    const decoded = decodeComp(code);

    expect(decoded).not.toBeNull();
    expect(decoded.name).toBe("Round Trip");
    expect(decoded.gameMode).toBe("pve");
    expect(decoded.builds).toHaveLength(1);
    expect(decoded.builds[0].profession).toBe("Warrior");
    expect(decoded.partyLines).toHaveLength(1);
    expect(decoded.partyLines[0].capacity).toBe(5);
    expect(decoded.partyLines[0].slots).toHaveLength(1); // trailing empties stripped
    expect(decoded.partyLines[0].slots[0].profession).toBe("Warrior");
  });

  test("deduplicates builds — same build in multiple slots shares reference", () => {
    const comp = {
      name: "Dedup Test",
      gameMode: "wvw",
      partyLines: [{ id: "line1", capacity: 3, slots: ["b1", "b1", "b1"] }],
      buildIds: ["b1"],
    };
    const builds = { b1: mockBuild };

    const code = encodeComp(comp, builds);
    const decoded = decodeComp(code);

    expect(decoded.builds).toHaveLength(1);
    expect(decoded.partyLines[0].slots).toHaveLength(3);
    // All slots reference the same decoded build object
    expect(decoded.partyLines[0].slots[0]).toBe(decoded.partyLines[0].slots[1]);
    expect(decoded.partyLines[0].slots[1]).toBe(decoded.partyLines[0].slots[2]);
  });

  test("handles multiple party lines", () => {
    const comp = {
      name: "Multi Line",
      gameMode: "pve",
      partyLines: [
        { id: "p1", capacity: 5, slots: ["b1"] },
        { id: "p2", capacity: 5, slots: ["b1"] },
      ],
      buildIds: ["b1"],
    };
    const builds = { b1: mockBuild };

    const code = encodeComp(comp, builds);
    const decoded = decodeComp(code);

    expect(decoded.partyLines).toHaveLength(2);
    expect(decoded.partyLines[0].slots).toHaveLength(1);
    expect(decoded.partyLines[1].slots).toHaveLength(1);
  });

  test("returns null for invalid code", () => {
    expect(decodeComp("garbage")).toBeNull();
    expect(decodeComp("<AxiForge:Berserker:abc>")).toBeNull();
    expect(decodeComp("<AxiForge:Comp:>")).toBeNull();
  });

  test("returns null for corrupt payload", () => {
    expect(decodeComp("<AxiForge:Comp:not-valid-base64url!!!>")).toBeNull();
  });

  test("handles empty comp", () => {
    const comp = { name: "Empty", gameMode: null, partyLines: [], buildIds: [] };
    const code = encodeComp(comp, {});
    const decoded = decodeComp(code);

    expect(decoded.name).toBe("Empty");
    expect(decoded.gameMode).toBeNull();
    expect(decoded.builds).toHaveLength(0);
    expect(decoded.partyLines).toHaveLength(0);
  });

  test("defaults missing name to Untitled Comp", () => {
    const comp = { name: "", gameMode: null, partyLines: [], buildIds: [] };
    const code = encodeComp(comp, {});
    const decoded = decodeComp(code);
    expect(decoded.name).toBe("Untitled Comp");
  });

  test("clamps capacity to [1, 50]", () => {
    const comp = {
      name: "Clamp Test",
      gameMode: null,
      partyLines: [{ id: "l1", capacity: 100, slots: [] }],
      buildIds: [],
    };
    const code = encodeComp(comp, {});
    const decoded = decodeComp(code);
    expect(decoded.partyLines[0].capacity).toBe(50);
  });
});
```

- [ ] **Step 10: Run test to verify decodeComp tests fail**

Run: `npx jest tests/unit/compCodec.test.js --verbose`
Expected: FAIL — `decodeComp` not defined

- [ ] **Step 11: Implement `decodeComp`**

Add to `src/main/compCodec.js`:

```js
const { decodeShareCode } = require("@mks.haro/axicode");

const MAX_DECODED_SIZE = 1024 * 1024; // 1 MB safety limit

function decodeComp(code) {
  if (!isValidCompCode(code)) return null;

  try {
    const base64url = code.slice(COMP_PREFIX.length, -COMP_SUFFIX.length);
    const compressed = Buffer.from(base64url, "base64url");
    const inflated = zlib.inflateSync(compressed);

    if (inflated.length > MAX_DECODED_SIZE) return null;

    const schema = JSON.parse(inflated.toString("utf-8"));
    if (schema.v !== 1) return null;

    // Decode each build payload
    const decodedBuilds = [];
    const failedIndices = new Set();
    for (let i = 0; i < (schema.b || []).length; i++) {
      const payload = schema.b[i];
      try {
        // Wrap payload back into share code format for decoding (label is cosmetic)
        const fullCode = `<AxiForge:Build:${payload}>`;
        const build = decodeShareCode(fullCode);
        decodedBuilds.push(build);
      } catch {
        decodedBuilds.push(null);
        failedIndices.add(i);
      }
    }

    // Expand party lines
    const partyLines = (schema.p || []).map((line) => {
      const capacity = Math.max(1, Math.min(50, typeof line.c === "number" ? line.c : 5));
      // Map indices to build references, strip trailing empties
      const expandedSlots = [];
      for (const idx of (line.s || [])) {
        if (idx === -1 || idx < 0 || idx >= decodedBuilds.length || decodedBuilds[idx] === null) {
          // Empty or invalid slot — skip (stripped per spec)
          continue;
        }
        expandedSlots.push(decodedBuilds[idx]);
      }
      return { capacity, slots: expandedSlots };
    });

    const name = String(schema.n || "Untitled Comp").slice(0, 140) || "Untitled Comp";
    const gameMode = schema.g === "pve" || schema.g === "wvw" ? schema.g : null;

    const failedBuildCount = failedIndices.size;

    return {
      name,
      gameMode,
      builds: decodedBuilds.filter((b) => b !== null),
      partyLines,
      failedBuildCount,
    };
  } catch {
    return null;
  }
}
```

Update `module.exports` to include `decodeComp`.

- [ ] **Step 12: Run test to verify all tests pass**

Run: `npx jest tests/unit/compCodec.test.js --verbose`
Expected: All PASS

- [ ] **Step 13: Commit**

```bash
git add src/main/compCodec.js tests/unit/compCodec.test.js
git commit -m "feat: add comp share code encoder/decoder module"
```

---

### Task 2: Add IPC handlers and preload API

**Files:**
- Modify: `src/main/index.js:386-397` (add new IPC handlers after existing axicode handlers)
- Modify: `src/preload/index.js:55-57` (add new preload API methods)

- [ ] **Step 1: Add IPC handlers in main process**

In `src/main/index.js`, after the existing `builds:is-share-code` handler (line 397), add:

```js
ipcMain.handle("comps:encode-share-code", async (_e, compId) => {
  const { encodeComp } = require("./compCodec.js");
  const comps = await compStore.listComps();
  const comp = comps.find((c) => c.id === compId);
  if (!comp) throw new Error("Comp not found");
  const allBuilds = await store.listBuilds();
  const buildsMap = {};
  for (const b of allBuilds) buildsMap[b.id] = b;
  const code = encodeComp(comp, buildsMap);
  if (!code) throw new Error("Failed to encode comp share code");
  return code;
});

ipcMain.handle("comps:import-share-code", async (_e, code) => {
  const { decodeComp, isValidCompCode } = require("./compCodec.js");
  if (!isValidCompCode(code)) throw new Error("Invalid comp share code format");
  const decoded = decodeComp(code);
  if (!decoded) throw new Error("Failed to decode comp share code");

  // Create the comp first (without builds) so we have an ID for compId wiring
  const comp = await compStore.upsertComp({
    name: decoded.name,
    gameMode: decoded.gameMode,
    buildIds: [],
    partyLines: [],
  });

  // Create new builds for each unique decoded build, wiring compId immediately
  const newBuildIds = [];
  const buildRefToId = new Map(); // decoded build ref → new build ID
  for (const build of decoded.builds) {
    const saved = await store.upsertBuild({
      ...build,
      title: build.title || "Imported Build",
      compId: comp.id,
    });
    newBuildIds.push(saved.id);
    buildRefToId.set(build, saved.id);
  }

  // Map party line slots from decoded build refs to new build IDs
  const partyLines = decoded.partyLines.map((line) => ({
    capacity: line.capacity,
    slots: line.slots.map((buildRef) => buildRefToId.get(buildRef)).filter(Boolean),
  }));

  // Update the comp with buildIds and partyLines
  const updated = await compStore.upsertComp({
    ...comp,
    buildIds: newBuildIds,
    partyLines,
  });

  // Return comp ID + warning count for UI feedback
  const result = { compId: updated.id };
  if (decoded.failedBuildCount > 0) {
    result.warning = `${decoded.failedBuildCount} of ${decoded.failedBuildCount + decoded.builds.length} builds could not be decoded — they may require a newer version of AxiForge.`;
  }
  return result;
});
```

- [ ] **Step 2: Add preload API methods**

In `src/preload/index.js`, after the existing `isShareCode` line (line 57), add:

```js
encodeCompShareCode: (compId) => ipcRenderer.invoke("comps:encode-share-code", compId),
importCompShareCode: (code) => ipcRenderer.invoke("comps:import-share-code", code),
```

- [ ] **Step 3: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: add IPC handlers and preload API for comp share codes"
```

---

### Task 3: Add "Copy Share Code" button to comp detail toolbar

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js:380-383` (add button to toolbar)
- Modify: `src/renderer/modules/comps/comp-detail.js:847-874` (add click handler)

- [ ] **Step 1: Add button to toolbar HTML**

In `src/renderer/modules/comps/comp-detail.js`, in the topbar section after the "Share to Discord" button (line 381), add the "Copy AxiCode" button:

```js
<button type="button" class="btn btn-secondary" data-action="copy-share-code">Copy AxiCode</button>
```

Place it after the Discord button and before the Discord status span. The full toolbar sequence becomes: Publish → Share to Discord (conditional) → Copy AxiCode → Discord status → Notes.

- [ ] **Step 2: Add click handler**

In `src/renderer/modules/comps/comp-detail.js`, after the Discord share handler block (around line 874), add:

```js
// ── Copy Share Code ──────────────────────────────────────────────────────────
container.querySelector("[data-action='copy-share-code']")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const code = await window.desktopApi.encodeCompShareCode(comp.id);
    await window.desktopApi.writeClipboardText(code);
    showSaveStatus("AxiCode copied to clipboard.");
  } catch (err) {
    showSaveStatus(err.message || "Failed to generate AxiCode", true);
  } finally {
    btn.disabled = false;
  }
});
```

- [ ] **Step 3: Manually test — open a comp, click "Copy AxiCode", verify clipboard contains `<AxiForge:Comp:...>`**

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js
git commit -m "feat: add Copy AxiCode button to comp detail toolbar"
```

---

### Task 4: Add comp share code paste/import to comp list

**Files:**
- Modify: `src/renderer/modules/comps/comp-list.js:314-333` (add context menu item)
- Modify: `src/renderer/modules/comps/comp-list.js:341-360` (extend paste handler)

- [ ] **Step 1: Extend `handlePasteComp` to detect comp share codes**

In `src/renderer/modules/comps/comp-list.js`, replace the existing `handlePasteComp` function (lines 341-360) with:

```js
async function handlePasteComp() {
  try {
    const text = await window.desktopApi.readClipboardText();
    if (!text) return;
    const trimmed = text.trim();

    // Check if it's a comp share code
    if (trimmed.startsWith("<AxiForge:Comp:") && trimmed.endsWith(">")) {
      try {
        const result = await window.desktopApi.importCompShareCode(trimmed);
        state.comps = await window.desktopApi.listComps();
        state.builds = await window.desktopApi.listBuilds();
        if (result.warning) {
          window.desktopApi.showError?.("Partial Import", result.warning);
        }
        const newComp = state.comps.find((c) => c.id === result.compId);
        if (newComp) {
          _callbacks.onOpenComp?.(newComp);
        } else {
          renderCompList();
        }
      } catch (err) {
        window.desktopApi.showError?.("Import Failed", err.message || "Failed to decode comp AxiCode.");
      }
      return;
    }

    // Fall back to JSON paste
    const parsed = JSON.parse(trimmed);
    const comps = Array.isArray(parsed) ? parsed : [parsed];
    for (const comp of comps) {
      if (!comp.name) continue;
      const { id, createdAt, updatedAt, ...rest } = comp;
      await window.desktopApi.saveComp(rest);
    }
    state.comps = await window.desktopApi.listComps();
    renderCompList();
  } catch {
    // Not valid JSON or comp code — ignore silently
  }
}
```

- [ ] **Step 2: Add "Copy AxiCode" to comp context menu**

In `src/renderer/modules/comps/comp-list.js`, in the `showCompCtxMenu` function (line 314), add a "Copy AxiCode" item after "Copy JSON":

```js
function showCompCtxMenu(x, y, comp) {
  const items = [
    ctxItem("Open", () => _callbacks.onOpenComp?.(comp)),
    ctxItem("Rename", () => _callbacks.onRenameComp?.(comp.id, comp.name)),
    ctxItem("Duplicate", () => _callbacks.onDuplicateComp?.(comp.id)),
    ctxSep(),
    ctxItem("Copy JSON", () => handleCopyCompJson(comp)),
    ctxItem("Copy AxiCode", () => handleCopyCompShareCode(comp.id)),
    ctxSep(),
    ctxItem("Delete", () => _callbacks.onDeleteComp?.(comp.id), true),
  ];
  showCtxMenu(x, y, items);
}
```

- [ ] **Step 3: Add `handleCopyCompShareCode` function**

Add after `handleCopyCompJson`:

```js
async function handleCopyCompShareCode(compId) {
  try {
    const code = await window.desktopApi.encodeCompShareCode(compId);
    await window.desktopApi.writeClipboardText(code);
  } catch {
    window.desktopApi.showError?.("Copy Failed", "Failed to generate comp AxiCode.");
  }
}
```

- [ ] **Step 4: Manually test — right-click a comp → "Copy AxiCode" → right-click empty area → "Paste" → verify new comp is created with all builds**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/comps/comp-list.js
git commit -m "feat: add comp share code copy/paste to comp list"
```

---

### Task 5: End-to-end round-trip test

**Files:**
- Modify: `tests/unit/compCodec.test.js` (add integration-style round-trip tests)

- [ ] **Step 1: Add round-trip test with multiple builds and party lines**

Append to the test file:

```js
describe("round-trip integration", () => {
  // buildA is the standard Warrior/Berserker fixture
  const buildA = { ...mockBuild };
  // buildB differs by using different trait choices so it produces a different Z85 payload
  const buildB = {
    ...mockBuild,
    specializations: [
      { ...mockBuild.specializations[0], majorChoices: { 1: 1447, 2: 1448, 3: 1440 } },
      { ...mockBuild.specializations[1], majorChoices: { 1: 1381, 2: 1484, 3: 1317 } },
      { ...mockBuild.specializations[2], majorChoices: { 1: 2042, 2: 2011, 3: 2038 } },
    ],
  };

  test("preserves comp structure with multiple builds across party lines", () => {
    const comp = {
      name: "Full Raid Comp",
      gameMode: "pve",
      partyLines: [
        { id: "p1", capacity: 5, slots: ["a", "b", "a"] },
        { id: "p2", capacity: 5, slots: ["b", "a"] },
      ],
      buildIds: ["a", "b"],
    };
    const builds = { a: buildA, b: buildB };

    const code = encodeComp(comp, builds);
    const decoded = decodeComp(code);

    expect(decoded.name).toBe("Full Raid Comp");
    expect(decoded.gameMode).toBe("pve");
    expect(decoded.builds).toHaveLength(2);
    expect(decoded.partyLines).toHaveLength(2);

    // P1: 3 filled slots
    expect(decoded.partyLines[0].slots).toHaveLength(3);
    expect(decoded.partyLines[0].capacity).toBe(5);

    // P2: 2 filled slots
    expect(decoded.partyLines[1].slots).toHaveLength(2);
    expect(decoded.partyLines[1].capacity).toBe(5);

    // Verify deduplication — same build in P1 slot 0 and P1 slot 2
    expect(decoded.partyLines[0].slots[0]).toBe(decoded.partyLines[0].slots[2]);
  });

  test("null gameMode round-trips correctly", () => {
    const comp = { name: "No Mode", gameMode: null, partyLines: [], buildIds: [] };
    const code = encodeComp(comp, {});
    const decoded = decodeComp(code);
    expect(decoded.gameMode).toBeNull();
  });

  test("wvw gameMode round-trips correctly", () => {
    const comp = {
      name: "WvW Comp",
      gameMode: "wvw",
      partyLines: [{ id: "p1", capacity: 5, slots: ["a"] }],
      buildIds: ["a"],
    };
    const builds = { a: buildA };
    const code = encodeComp(comp, builds);
    const decoded = decodeComp(code);
    expect(decoded.gameMode).toBe("wvw");
  });
});
```

- [ ] **Step 2: Run full test suite**

Run: `npx jest tests/unit/compCodec.test.js --verbose`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/compCodec.test.js
git commit -m "test: add round-trip integration tests for comp share codes"
```
