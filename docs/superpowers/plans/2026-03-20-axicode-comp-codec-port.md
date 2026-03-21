# Port Comp Codec to @mks.haro/axicode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move comp share code encoding/decoding from the axiforge app into the `@mks.haro/axicode` npm package, using `pako` instead of Node.js `zlib` for browser compatibility.

**Architecture:** A new `src/compCodec.js` module in the axicode package implements the three functions (`encodeCompCode`, `decodeCompCode`, `isValidCompCode`) using `pako` for deflate/inflate and a small `src/base64url.js` helper for cross-platform base64url encoding. The axicode package re-exports these from its main entry point. The axiforge app replaces its local `compCodec.js` with a thin wrapper that re-exports from the package.

**Tech Stack:** `pako` (deflate/inflate), `btoa`/`atob` (base64url, available in Node.js 16+ and all browsers), existing `encodeShareCode`/`decodeShareCode` from same package.

**Spec:** `docs/superpowers/specs/2026-03-20-axicode-comp-codec-port-design.md`

**Axicode package location:** `/var/home/mstephens/Documents/GitHub/axicode`

---

### Task 1: Add pako dependency and base64url helper to axicode package

**Files:**
- Modify: `/var/home/mstephens/Documents/GitHub/axicode/package.json` (add pako dependency)
- Create: `/var/home/mstephens/Documents/GitHub/axicode/src/base64url.js`

- [ ] **Step 1: Install pako**

```bash
cd /var/home/mstephens/Documents/GitHub/axicode && npm install pako
```

- [ ] **Step 2: Create base64url helper**

```js
// src/base64url.js
"use strict";

function base64urlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

module.exports = { base64urlEncode, base64urlDecode };
```

- [ ] **Step 3: Commit**

```bash
cd /var/home/mstephens/Documents/GitHub/axicode
git add package.json package-lock.json src/base64url.js
git commit -m "feat: add pako dependency and base64url helper for comp codec"
```

---

### Task 2: Add comp codec module to axicode package (TDD)

**Files:**
- Create: `/var/home/mstephens/Documents/GitHub/axicode/src/compCodec.js`
- Create: `/var/home/mstephens/Documents/GitHub/axicode/tests/compCodec.test.js`
- Modify: `/var/home/mstephens/Documents/GitHub/axicode/src/index.js:609` (add re-exports)

- [ ] **Step 1: Create test file with all tests**

Port the 19 tests from axiforge. The test file uses `encodeCompCode`/`decodeCompCode`/`isValidCompCode` (renamed with `Code` suffix to match package naming convention alongside `encodeShareCode`/`decodeShareCode`).

```js
// tests/compCodec.test.js
const {
  isValidCompCode,
  encodeCompCode,
  decodeCompCode,
  encodeShareCode,
} = require("../src/index");

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

// Build fixture matching the encodeShareCode contract
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

describe("encodeCompCode", () => {
  test("produces a valid comp code string", () => {
    const comp = {
      name: "Test Comp",
      gameMode: "pve",
      partyLines: [{ id: "line1", capacity: 5, slots: ["b1"] }],
      buildIds: ["b1"],
    };
    const builds = { b1: mockBuild };

    const code = encodeCompCode(comp, builds);
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
    const result = encodeCompCode(comp, {});
    expect(result).toBeNull();
  });

  test("handles empty comp with no party lines", () => {
    const comp = { name: "Empty", gameMode: null, partyLines: [], buildIds: [] };
    const code = encodeCompCode(comp, {});
    expect(isValidCompCode(code)).toBe(true);
  });
});

describe("decodeCompCode", () => {
  test("round-trips a comp with one build", () => {
    const comp = {
      name: "Round Trip",
      gameMode: "pve",
      partyLines: [{ id: "line1", capacity: 5, slots: ["b1"] }],
      buildIds: ["b1"],
    };
    const builds = { b1: mockBuild };

    const code = encodeCompCode(comp, builds);
    const decoded = decodeCompCode(code);

    expect(decoded).not.toBeNull();
    expect(decoded.name).toBe("Round Trip");
    expect(decoded.gameMode).toBe("pve");
    expect(decoded.builds).toHaveLength(1);
    expect(decoded.builds[0].profession).toBe("Warrior");
    expect(decoded.partyLines).toHaveLength(1);
    expect(decoded.partyLines[0].capacity).toBe(5);
    expect(decoded.partyLines[0].slots).toHaveLength(1);
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

    const code = encodeCompCode(comp, builds);
    const decoded = decodeCompCode(code);

    expect(decoded.builds).toHaveLength(1);
    expect(decoded.partyLines[0].slots).toHaveLength(3);
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

    const code = encodeCompCode(comp, builds);
    const decoded = decodeCompCode(code);

    expect(decoded.partyLines).toHaveLength(2);
    expect(decoded.partyLines[0].slots).toHaveLength(1);
    expect(decoded.partyLines[1].slots).toHaveLength(1);
  });

  test("returns null for invalid code", () => {
    expect(decodeCompCode("garbage")).toBeNull();
    expect(decodeCompCode("<AxiForge:Berserker:abc>")).toBeNull();
    expect(decodeCompCode("<AxiForge:Comp:>")).toBeNull();
  });

  test("returns null for corrupt payload", () => {
    expect(decodeCompCode("<AxiForge:Comp:not-valid-base64url!!!>")).toBeNull();
  });

  test("handles empty comp", () => {
    const comp = { name: "Empty", gameMode: null, partyLines: [], buildIds: [] };
    const code = encodeCompCode(comp, {});
    const decoded = decodeCompCode(code);

    expect(decoded.name).toBe("Empty");
    expect(decoded.gameMode).toBeNull();
    expect(decoded.builds).toHaveLength(0);
    expect(decoded.partyLines).toHaveLength(0);
  });

  test("defaults missing name to Untitled Comp", () => {
    const comp = { name: "", gameMode: null, partyLines: [], buildIds: [] };
    const code = encodeCompCode(comp, {});
    const decoded = decodeCompCode(code);
    expect(decoded.name).toBe("Untitled Comp");
  });

  test("clamps capacity to [1, 50]", () => {
    const comp = {
      name: "Clamp Test",
      gameMode: null,
      partyLines: [{ id: "l1", capacity: 100, slots: [] }],
      buildIds: [],
    };
    const code = encodeCompCode(comp, {});
    const decoded = decodeCompCode(code);
    expect(decoded.partyLines[0].capacity).toBe(50);
  });
});

describe("round-trip integration", () => {
  const buildA = { ...mockBuild };
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

    const code = encodeCompCode(comp, builds);
    const decoded = decodeCompCode(code);

    expect(decoded.name).toBe("Full Raid Comp");
    expect(decoded.gameMode).toBe("pve");
    expect(decoded.builds).toHaveLength(2);
    expect(decoded.partyLines).toHaveLength(2);
    expect(decoded.partyLines[0].slots).toHaveLength(3);
    expect(decoded.partyLines[0].capacity).toBe(5);
    expect(decoded.partyLines[1].slots).toHaveLength(2);
    expect(decoded.partyLines[1].capacity).toBe(5);
    expect(decoded.partyLines[0].slots[0]).toBe(decoded.partyLines[0].slots[2]);
  });

  test("null gameMode round-trips correctly", () => {
    const comp = { name: "No Mode", gameMode: null, partyLines: [], buildIds: [] };
    const code = encodeCompCode(comp, {});
    const decoded = decodeCompCode(code);
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
    const code = encodeCompCode(comp, builds);
    const decoded = decodeCompCode(code);
    expect(decoded.gameMode).toBe("wvw");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /var/home/mstephens/Documents/GitHub/axicode && npx jest tests/compCodec.test.js --verbose`
Expected: FAIL — `encodeCompCode` is not a function

- [ ] **Step 3: Implement `src/compCodec.js`**

```js
// src/compCodec.js
"use strict";

const pako = require("pako");
const { base64urlEncode, base64urlDecode } = require("./base64url");
const { encodeShareCode, decodeShareCode } = require("./index");

const COMP_PREFIX = "<AxiForge:Comp:";
const COMP_SUFFIX = ">";

function isValidCompCode(text) {
  if (typeof text !== "string") return false;
  if (!text.startsWith(COMP_PREFIX) || !text.endsWith(COMP_SUFFIX)) return false;
  const payload = text.slice(COMP_PREFIX.length, -COMP_SUFFIX.length);
  return payload.length > 0;
}

function extractPayload(shareCode) {
  const firstColon = shareCode.indexOf(":");
  const secondColon = shareCode.indexOf(":", firstColon + 1);
  return shareCode.slice(secondColon + 1, -1);
}

function encodeCompCode(comp, builds) {
  const payloadToIndex = new Map();
  const buildPayloads = [];
  const buildIdToIndex = new Map();

  const referencedIds = new Set();
  for (const line of (comp.partyLines || [])) {
    for (const buildId of (line.slots || [])) {
      referencedIds.add(buildId);
    }
  }

  for (const buildId of referencedIds) {
    const build = builds[buildId] || (Array.isArray(builds) ? builds.find((b) => b.id === buildId) : null);
    if (!build) return null;

    let code;
    try {
      code = encodeShareCode(build);
    } catch {
      return null;
    }

    const payload = extractPayload(code);
    if (!payloadToIndex.has(payload)) {
      payloadToIndex.set(payload, buildPayloads.length);
      buildPayloads.push(payload);
    }
    buildIdToIndex.set(buildId, payloadToIndex.get(payload));
  }

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
      while (slots.length < capacity) slots.push(-1);
      return { c: capacity, s: slots };
    }),
  };

  const json = JSON.stringify(schema);
  const compressed = pako.deflate(json);
  const b64 = base64urlEncode(compressed);

  return `${COMP_PREFIX}${b64}${COMP_SUFFIX}`;
}

const MAX_DECODED_SIZE = 1024 * 1024;

function decodeCompCode(code) {
  if (!isValidCompCode(code)) return null;

  try {
    const b64 = code.slice(COMP_PREFIX.length, -COMP_SUFFIX.length);
    const compressed = base64urlDecode(b64);
    const inflated = pako.inflate(compressed);

    if (inflated.length > MAX_DECODED_SIZE) return null;

    // Decode Uint8Array to UTF-8 string
    const jsonStr = new TextDecoder().decode(inflated);
    const schema = JSON.parse(jsonStr);
    if (schema.v !== 1) return null;

    const decodedBuilds = [];
    const failedIndices = new Set();
    for (let i = 0; i < (schema.b || []).length; i++) {
      const payload = schema.b[i];
      try {
        const fullCode = `<AxiForge:Build:${payload}>`;
        const build = decodeShareCode(fullCode);
        decodedBuilds.push(build);
      } catch {
        decodedBuilds.push(null);
        failedIndices.add(i);
      }
    }

    const partyLines = (schema.p || []).map((line) => {
      const capacity = Math.max(1, Math.min(50, typeof line.c === "number" ? line.c : 5));
      const expandedSlots = [];
      for (const idx of (line.s || [])) {
        if (idx === -1 || idx < 0 || idx >= decodedBuilds.length || decodedBuilds[idx] === null) {
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

module.exports = { isValidCompCode, encodeCompCode, decodeCompCode };
```

**IMPORTANT:** This file has a circular require issue — it requires `./index` which requires it back. To avoid this, `compCodec.js` should require `encodeShareCode`/`decodeShareCode` directly from `./index` BUT `index.js` should require `compCodec.js` AFTER defining its own exports. The fix is in Step 4.

- [ ] **Step 4: Update `src/index.js` to re-export comp codec functions**

At the end of `/var/home/mstephens/Documents/GitHub/axicode/src/index.js`, change the `module.exports` line from:

```js
module.exports = { encodeShareCode, decodeShareCode, isValidShareCode };
```

to:

```js
module.exports = { encodeShareCode, decodeShareCode, isValidShareCode };

// Comp codec — loaded after build codec exports are set (avoids circular require)
const { isValidCompCode, encodeCompCode, decodeCompCode } = require("./compCodec");
module.exports.isValidCompCode = isValidCompCode;
module.exports.encodeCompCode = encodeCompCode;
module.exports.decodeCompCode = decodeCompCode;
```

And update `src/compCodec.js` to require directly from `./index` (this works because by the time `compCodec` functions are called at runtime, `index.js` has finished setting its initial exports):

The `require("./index")` in `compCodec.js` is safe because:
1. `index.js` sets `module.exports = { encodeShareCode, ... }` first
2. Then requires `compCodec.js`
3. `compCodec.js` does `require("./index")` which returns the already-set exports object
4. `compCodec.js` uses `encodeShareCode`/`decodeShareCode` only at call time, not at require time

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /var/home/mstephens/Documents/GitHub/axicode && npx jest tests/compCodec.test.js --verbose`
Expected: All 19 PASS

- [ ] **Step 6: Run existing tests to verify no regressions**

Run: `cd /var/home/mstephens/Documents/GitHub/axicode && npx jest --verbose`
Expected: All tests PASS (existing + new)

- [ ] **Step 7: Bump package version to 1.1.0**

In `/var/home/mstephens/Documents/GitHub/axicode/package.json`, change `"version": "1.0.1"` to `"version": "1.1.0"`.

- [ ] **Step 8: Commit**

```bash
cd /var/home/mstephens/Documents/GitHub/axicode
git add src/compCodec.js src/index.js tests/compCodec.test.js package.json
git commit -m "feat: add comp share code encoder/decoder (encodeCompCode, decodeCompCode, isValidCompCode)"
```

---

### Task 3: Update axiforge to use package comp codec

**Files:**
- Modify: `/var/home/mstephens/Documents/GitHub/axiforge/package.json` (update axicode version)
- Modify: `/var/home/mstephens/Documents/GitHub/axiforge/src/main/compCodec.js` (replace with re-export wrapper)

- [ ] **Step 1: Install updated axicode from local path**

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge && npm install ../axicode
```

This installs the local package (with the new comp codec) into axiforge's node_modules.

- [ ] **Step 2: Replace `src/main/compCodec.js` with thin re-export wrapper**

Replace the entire file with:

```js
// src/main/compCodec.js
"use strict";

// Re-export comp codec from @mks.haro/axicode package.
// The app uses encodeComp/decodeComp names; the package uses encodeCompCode/decodeCompCode.
const { encodeCompCode, decodeCompCode, isValidCompCode } = require("@mks.haro/axicode");

module.exports = {
  isValidCompCode,
  encodeComp: encodeCompCode,
  decodeComp: decodeCompCode,
};
```

This preserves the `encodeComp`/`decodeComp` names used by existing IPC handlers and tests.

- [ ] **Step 3: Run axiforge comp codec tests**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest tests/unit/compCodec.test.js --verbose`
Expected: All 19 PASS

- [ ] **Step 4: Run full axiforge test suite**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest --verbose`
Expected: Same results as before (only pre-existing comp-drag-drop failure)

- [ ] **Step 5: Commit**

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
git add src/main/compCodec.js package.json package-lock.json
git commit -m "refactor: use @mks.haro/axicode comp codec instead of local implementation"
```
