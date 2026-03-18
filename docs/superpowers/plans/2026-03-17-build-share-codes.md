# Build Share Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode GW2 builds as compact share codes (`<AxiForge:Label:payload>`) that users can copy/paste to share builds.

**Architecture:** Three-layer approach — a BitBuffer utility for bit-level packing, a Z85 codec for binary-to-text encoding, and the main buildShareCode module that orchestrates encoding/decoding using reference tables from constants.js. All logic lives in the main process (CJS), exposed to renderer via IPC.

**Tech Stack:** Node.js (CJS), Jest for tests, Electron IPC

**Spec:** `docs/superpowers/specs/2026-03-17-build-share-codes-design.md`

---

### Task 1: BitBuffer Utility

A reusable class for reading and writing individual bits into a byte buffer. This is the foundation all encoding/decoding builds on.

**Files:**
- Create: `src/main/bitBuffer.js`
- Test: `tests/unit/bitBuffer.test.js`

- [ ] **Step 1: Write failing tests for BitBuffer**

```javascript
"use strict";
const { BitWriter, BitReader } = require("../../src/main/bitBuffer");

describe("BitWriter", () => {
  test("writes and reads back single bits", () => {
    const w = new BitWriter();
    w.write(1, 1); // 1
    w.write(0, 1); // 0
    w.write(1, 1); // 1
    const r = new BitReader(w.toBytes());
    expect(r.read(1)).toBe(1);
    expect(r.read(1)).toBe(0);
    expect(r.read(1)).toBe(1);
  });

  test("writes multi-bit values", () => {
    const w = new BitWriter();
    w.write(5, 4);   // 0101 in 4 bits
    w.write(255, 8);  // 11111111
    w.write(0, 3);    // 000
    const r = new BitReader(w.toBytes());
    expect(r.read(4)).toBe(5);
    expect(r.read(8)).toBe(255);
    expect(r.read(3)).toBe(0);
  });

  test("handles 17-bit skill IDs", () => {
    const w = new BitWriter();
    w.write(80000, 17);
    w.write(12345, 17);
    w.write(0, 17);
    const r = new BitReader(w.toBytes());
    expect(r.read(17)).toBe(80000);
    expect(r.read(17)).toBe(12345);
    expect(r.read(17)).toBe(0);
  });

  test("toBytes pads to byte boundary", () => {
    const w = new BitWriter();
    w.write(7, 3); // 3 bits → should pad to 1 byte
    const bytes = w.toBytes();
    expect(bytes.length).toBe(1);
  });

  test("toPaddedBytes pads to 4-byte boundary", () => {
    const w = new BitWriter();
    w.write(1, 1); // 1 bit → pad to 4 bytes
    const bytes = w.toPaddedBytes(4);
    expect(bytes.length).toBe(4);
  });
});

describe("BitReader", () => {
  test("throws on read past end", () => {
    const r = new BitReader(Buffer.from([0xFF]));
    r.read(8);
    expect(() => r.read(1)).toThrow();
  });

  test("bitsRemaining reports correctly", () => {
    const r = new BitReader(Buffer.from([0xFF, 0xFF]));
    expect(r.bitsRemaining()).toBe(16);
    r.read(5);
    expect(r.bitsRemaining()).toBe(11);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/bitBuffer.test.js --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement BitWriter and BitReader**

```javascript
"use strict";

class BitWriter {
  constructor() {
    this._bytes = [];
    this._currentByte = 0;
    this._bitPos = 7; // MSB first, counts down from 7 to 0
  }

  write(value, numBits) {
    for (let i = numBits - 1; i >= 0; i--) {
      const bit = (value >> i) & 1;
      this._currentByte |= bit << this._bitPos;
      this._bitPos--;
      if (this._bitPos < 0) {
        this._bytes.push(this._currentByte);
        this._currentByte = 0;
        this._bitPos = 7;
      }
    }
  }

  toBytes() {
    const out = [...this._bytes];
    if (this._bitPos < 7) out.push(this._currentByte); // flush partial byte
    return Buffer.from(out);
  }

  toPaddedBytes(alignment) {
    const bytes = this.toBytes();
    const remainder = bytes.length % alignment;
    if (remainder === 0) return bytes;
    const padded = Buffer.alloc(bytes.length + (alignment - remainder));
    bytes.copy(padded);
    return padded;
  }
}

class BitReader {
  constructor(buffer) {
    this._buffer = buffer;
    this._bytePos = 0;
    this._bitPos = 7;
  }

  read(numBits) {
    let value = 0;
    for (let i = 0; i < numBits; i++) {
      if (this._bytePos >= this._buffer.length) {
        throw new Error("Read past end of buffer");
      }
      const bit = (this._buffer[this._bytePos] >> this._bitPos) & 1;
      value = (value << 1) | bit;
      this._bitPos--;
      if (this._bitPos < 0) {
        this._bytePos++;
        this._bitPos = 7;
      }
    }
    return value;
  }

  bitsRemaining() {
    const totalBits = this._buffer.length * 8;
    const consumed = this._bytePos * 8 + (7 - this._bitPos);
    return totalBits - consumed;
  }
}

module.exports = { BitWriter, BitReader };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/bitBuffer.test.js --no-coverage`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/bitBuffer.js tests/unit/bitBuffer.test.js
git commit -m "feat: add BitWriter/BitReader for binary bit packing"
```

---

### Task 2: Z85 Codec

Encode/decode bytes to/from Z85 (base-85) strings per ZeroMQ RFC 32.

**Files:**
- Create: `src/main/z85.js`
- Test: `tests/unit/z85.test.js`

- [ ] **Step 1: Write failing tests for Z85**

```javascript
"use strict";
const { z85Encode, z85Decode } = require("../../src/main/z85");

describe("z85Encode / z85Decode", () => {
  test("round-trip 4 bytes", () => {
    const input = Buffer.from([0x86, 0x4F, 0xD2, 0x6F]);
    const encoded = z85Encode(input);
    expect(encoded.length).toBe(5); // 4 bytes → 5 chars
    expect(z85Decode(encoded)).toEqual(input);
  });

  test("round-trip 8 bytes", () => {
    const input = Buffer.from([0x86, 0x4F, 0xD2, 0x6F, 0xB5, 0x59, 0xF7, 0x5B]);
    const encoded = z85Encode(input);
    expect(encoded.length).toBe(10);
    expect(z85Decode(encoded)).toEqual(input);
  });

  test("encodes RFC 32 test vector", () => {
    // RFC 32: 0x8E 0x0B 0xDD 0x69 → "HelloWorld" is NOT the test vector
    // The RFC example: binary frame 0x86 0x4F 0xD2 0x6F 0xB5 0x59 0xF7 0x5B → "HelloWorld"
    const input = Buffer.from([0x86, 0x4F, 0xD2, 0x6F, 0xB5, 0x59, 0xF7, 0x5B]);
    expect(z85Encode(input)).toBe("HelloWorld");
  });

  test("rejects input not multiple of 4 bytes", () => {
    expect(() => z85Encode(Buffer.from([1, 2, 3]))).toThrow();
  });

  test("rejects encoded string not multiple of 5 chars", () => {
    expect(() => z85Decode("Hell")).toThrow();
  });

  test("round-trip all zeros", () => {
    const input = Buffer.alloc(8, 0);
    expect(z85Decode(z85Encode(input))).toEqual(input);
  });

  test("round-trip all 0xFF", () => {
    const input = Buffer.alloc(8, 0xFF);
    expect(z85Decode(z85Encode(input))).toEqual(input);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/z85.test.js --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Z85 encode/decode**

```javascript
"use strict";

// Z85 alphabet per ZeroMQ RFC 32
const Z85_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
const Z85_DECODE = new Uint8Array(128);
for (let i = 0; i < 85; i++) Z85_DECODE[Z85_CHARS.charCodeAt(i)] = i;

// Divisors for base-85 encoding of a 32-bit value
const DIVISORS = [85 * 85 * 85 * 85, 85 * 85 * 85, 85 * 85, 85, 1];

function z85Encode(buffer) {
  if (buffer.length % 4 !== 0) {
    throw new Error("Z85 input must be a multiple of 4 bytes");
  }
  let out = "";
  for (let i = 0; i < buffer.length; i += 4) {
    let value = ((buffer[i] << 24) | (buffer[i + 1] << 16) | (buffer[i + 2] << 8) | buffer[i + 3]) >>> 0;
    for (let j = 0; j < 5; j++) {
      const idx = Math.floor(value / DIVISORS[j]) % 85;
      out += Z85_CHARS[idx];
    }
  }
  return out;
}

function z85Decode(str) {
  if (str.length % 5 !== 0) {
    throw new Error("Z85 string must be a multiple of 5 characters");
  }
  const out = Buffer.alloc((str.length / 5) * 4);
  for (let i = 0, byteIdx = 0; i < str.length; i += 5, byteIdx += 4) {
    let value = 0;
    for (let j = 0; j < 5; j++) {
      value = value * 85 + Z85_DECODE[str.charCodeAt(i + j)];
    }
    out[byteIdx]     = (value >>> 24) & 0xFF;
    out[byteIdx + 1] = (value >>> 16) & 0xFF;
    out[byteIdx + 2] = (value >>> 8)  & 0xFF;
    out[byteIdx + 3] =  value         & 0xFF;
  }
  return out;
}

module.exports = { z85Encode, z85Decode };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/z85.test.js --no-coverage`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/z85.js tests/unit/z85.test.js
git commit -m "feat: add Z85 (base-85) encode/decode codec"
```

---

### Task 3: Reference Table Lookups

Build the lookup tables that map between build values and compact indices (professions, weapons, stats, relics, food, utility buffs).

**Files:**
- Create: `src/main/shareCodeTables.js`
- Test: `tests/unit/shareCodeTables.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
"use strict";
const {
  PROFESSIONS, professionToIndex, indexToProfession,
  WEAPONS, weaponToIndex, indexToWeapon, isWeaponTwoHanded,
  STAT_COMBOS_ORDERED, statToIndex, indexToStat,
  relicToIndex, indexToRelic,
  foodToIndex, indexToFood,
  utilityToIndex, indexToUtility,
  legendStringToIndex, indexToLegendString,
} = require("../../src/main/shareCodeTables");

describe("professions", () => {
  test("Guardian is 0, Revenant is 8", () => {
    expect(professionToIndex("Guardian")).toBe(0);
    expect(professionToIndex("Revenant")).toBe(8);
  });
  test("round-trip all professions", () => {
    for (let i = 0; i < PROFESSIONS.length; i++) {
      expect(professionToIndex(PROFESSIONS[i])).toBe(i);
      expect(indexToProfession(i)).toBe(PROFESSIONS[i]);
    }
  });
});

describe("weapons", () => {
  test("index 0 is empty", () => { expect(indexToWeapon(0)).toBe(""); });
  test("Greatsword is two-handed", () => { expect(isWeaponTwoHanded(weaponToIndex("greatsword"))).toBe(true); });
  test("Sword is not two-handed", () => { expect(isWeaponTwoHanded(weaponToIndex("sword"))).toBe(false); });
  test("all 19 weapons have indices 1-19", () => {
    expect(WEAPONS.length).toBe(20); // 0=empty + 19 weapons
  });
});

describe("stats", () => {
  test("index 0 is empty", () => { expect(indexToStat(0)).toBe(""); });
  test("Berserker's is 1", () => { expect(statToIndex("Berserker's")).toBe(1); });
  test("21 stat combos + empty = 22 entries", () => {
    expect(STAT_COMBOS_ORDERED.length).toBe(22);
  });
});

describe("relics", () => {
  test("alphabetically sorted — Relic of Agony before Relic of Akeem", () => {
    const agonyIdx = relicToIndex("Relic of Agony");
    const akeemIdx = relicToIndex("Relic of Akeem");
    expect(agonyIdx).toBeLessThan(akeemIdx);
    expect(agonyIdx).toBeGreaterThan(0);
  });
  test("index 0 returns empty string", () => { expect(indexToRelic(0)).toBe(""); });
  test("round-trip", () => {
    const idx = relicToIndex("Relic of the Warrior");
    expect(indexToRelic(idx)).toBe("Relic of the Warrior");
  });
});

describe("food", () => {
  test("index 0 is empty", () => { expect(indexToFood(0)).toEqual({ label: "", id: 0 }); });
  test("round-trip first food item", () => {
    const idx = foodToIndex("Peppercorn-Crusted Sous-Vide Steak");
    expect(idx).toBe(1);
    expect(indexToFood(1).label).toBe("Peppercorn-Crusted Sous-Vide Steak");
  });
});

describe("utility buffs", () => {
  test("round-trip", () => {
    const idx = utilityToIndex("Superior Sharpening Stone");
    expect(idx).toBe(1);
    expect(indexToUtility(1).label).toBe("Superior Sharpening Stone");
  });
});

describe("revenant legends", () => {
  test("Legend1 (Glint) is index 1", () => { expect(legendStringToIndex("Legend1")).toBe(1); });
  test("round-trip all legends", () => {
    for (let i = 1; i <= 7; i++) {
      const str = indexToLegendString(i);
      expect(legendStringToIndex(str)).toBe(i);
    }
  });
  test("empty string returns 0", () => { expect(legendStringToIndex("")).toBe(0); });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/shareCodeTables.test.js --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement reference tables**

Create `src/main/shareCodeTables.js`. This module imports the constant arrays from the renderer's `constants.js` (which can be required since the values are just data) and builds indexed lookup maps.

Note: Since `constants.js` uses ESM exports, the tables module must duplicate the canonical lists as plain arrays. Keep them in sync via comments referencing the source.

```javascript
"use strict";

// Canonical profession order — matches spec profession table.
// Source: design spec docs/axiforge-build-code.md
const PROFESSIONS = [
  "Guardian", "Warrior", "Engineer", "Ranger", "Thief",
  "Elementalist", "Mesmer", "Necromancer", "Revenant",
];
const _profIdx = new Map(PROFESSIONS.map((p, i) => [p, i]));
function professionToIndex(name) { return _profIdx.get(name) ?? -1; }
function indexToProfession(idx) { return PROFESSIONS[idx] || ""; }

// Weapon type table — index 0 = empty, 1-19 = weapons.
// Source: src/renderer/modules/constants.js GW2_WEAPONS array order.
const WEAPONS = [
  "",          // 0: empty
  "axe",       "dagger",    "mace",      "pistol",    "sword",     "scepter",
  "focus",     "shield",    "torch",     "warhorn",
  "greatsword","hammer",    "longbow",   "rifle",     "shortbow",  "staff",
  "harpoon",   "spear",     "trident",
];
const _weapIdx = new Map(WEAPONS.map((w, i) => [w, i]));
function weaponToIndex(id) { return _weapIdx.get(id) ?? 0; }
function indexToWeapon(idx) { return WEAPONS[idx] || ""; }
// Two-handed weapons: greatsword(11), hammer(12), longbow(13), rifle(14), shortbow(15), staff(16), spear(18)
const TWO_HANDED = new Set([11, 12, 13, 14, 15, 16, 18]);
function isWeaponTwoHanded(idx) { return TWO_HANDED.has(idx); }

// Stat combo table — index 0 = empty, 1-21 = stats.
// Source: src/renderer/modules/constants.js STAT_COMBOS array order.
const STAT_COMBOS_ORDERED = [
  "",             // 0: empty
  "Berserker's", "Marauder's", "Assassin's", "Valkyrie", "Dragon's",
  "Viper's", "Grieving", "Sinister", "Dire", "Rabid", "Carrion",
  "Trailblazer's", "Knight's", "Soldier's", "Cleric's", "Minstrel's",
  "Harrier's", "Ritualist's", "Seraph", "Zealot's", "Celestial",
];
const _statIdx = new Map(STAT_COMBOS_ORDERED.map((s, i) => [s, i]));
function statToIndex(label) { return _statIdx.get(label) ?? 0; }
function indexToStat(idx) { return STAT_COMBOS_ORDERED[idx] || ""; }

// Relic table — sorted alphabetically at runtime per spec.
// Source: src/renderer/modules/constants.js GW2_RELICS.
// IMPORTANT: This array MUST be kept in sync with GW2_RELICS. Sorted alphabetically.
const RELICS_SORTED = [
  // This will be populated from the GW2_RELICS labels, sorted alphabetically.
  // Placeholder — fill from constants.js GW2_RELICS.map(r => r.label).sort()
].sort();
// We'll build this dynamically from the imported data, but for the CJS module
// we duplicate the labels here. See buildShareCode.js for the actual population.
let _relicsSorted = null;
let _relicIdx = null;
function _ensureRelics() {
  if (_relicsSorted) return;
  // Lazy-load to avoid circular deps. The labels are stable constants.
  const labels = require("./shareCodeRelicList");
  _relicsSorted = ["", ...labels];
  _relicIdx = new Map(_relicsSorted.map((r, i) => [r, i]));
}
function relicToIndex(label) { _ensureRelics(); return _relicIdx.get(label) ?? 0; }
function indexToRelic(idx) { _ensureRelics(); return _relicsSorted[idx] || ""; }

// Food table — ordered by array position in constants.js GW2_FOOD.
// Index 0 = none.
const FOOD_ORDERED = [
  { label: "", id: 0 },
  { label: "Peppercorn-Crusted Sous-Vide Steak", id: 91734 },
  { label: "Cilantro Lime Sous-Vide Steak", id: 91805 },
  { label: "Bowl of Sweet and Spicy Butternut Squash Soup", id: 41569 },
  { label: "Plate of Truffle Steak Dinner", id: 12469 },
  { label: "Bowl of Fancy Potato and Leek Soup", id: 12485 },
  { label: "Plate of Beef Rendang", id: 86997 },
  { label: "Plate of Kimchi Pancakes", id: 96578 },
  { label: "Mint-Pear Cured Meat Flatbread", id: 91703 },
  { label: "Clove-Spiced Pear and Cured Meat Flatbread", id: 91784 },
  { label: "Mint and Veggie Flatbread", id: 91727 },
  { label: "Delicious Rice Ball", id: 68634 },
  { label: "Eggs Benedict with Mint-Parsley Sauce", id: 91758 },
  { label: "Bowl of Fruit Salad with Mint Garnish", id: 91690 },
  { label: "Bowl of Seaweed Salad", id: 12471 },
];
const _foodIdx = new Map(FOOD_ORDERED.map((f, i) => [f.label, i]));
function foodToIndex(label) { return _foodIdx.get(label) ?? 0; }
function indexToFood(idx) { return FOOD_ORDERED[idx] || FOOD_ORDERED[0]; }

// Utility buff table
const UTILITY_ORDERED = [
  { label: "", id: 0 },
  { label: "Superior Sharpening Stone", id: 78305 },
  { label: "Furious Sharpening Stone", id: 67530 },
  { label: "Bountiful Sharpening Stone", id: 67531 },
  { label: "Bountiful Maintenance Oil", id: 67528 },
  { label: "Furious Maintenance Oil", id: 67529 },
];
const _utilIdx = new Map(UTILITY_ORDERED.map((u, i) => [u.label, i]));
function utilityToIndex(label) { return _utilIdx.get(label) ?? 0; }
function indexToUtility(idx) { return UTILITY_ORDERED[idx] || UTILITY_ORDERED[0]; }

// Revenant legend string → index mapping.
// Source: design spec legend table.
const LEGEND_STRINGS = ["", "Legend1", "Legend2", "Legend3", "Legend4", "Legend5", "Legend6", "Legend7"];
const _legIdx = new Map(LEGEND_STRINGS.map((l, i) => [l, i]));
function legendStringToIndex(str) { return _legIdx.get(str) ?? 0; }
function indexToLegendString(idx) { return LEGEND_STRINGS[idx] || ""; }

module.exports = {
  PROFESSIONS, professionToIndex, indexToProfession,
  WEAPONS, weaponToIndex, indexToWeapon, isWeaponTwoHanded,
  STAT_COMBOS_ORDERED, statToIndex, indexToStat,
  relicToIndex, indexToRelic,
  FOOD_ORDERED, foodToIndex, indexToFood,
  UTILITY_ORDERED, utilityToIndex, indexToUtility,
  LEGEND_STRINGS, legendStringToIndex, indexToLegendString,
};
```

Also create `src/main/shareCodeRelicList.js` — a flat array of ALL relic labels sorted alphabetically. Generate this by extracting every `label` value from `GW2_RELICS` in `src/renderer/modules/constants.js` and sorting alphabetically. The file must contain the **complete** list (currently 80+ relics), not abbreviated. Example generation approach:

```javascript
// Run this in Node to generate the list, then paste the output:
// const { GW2_RELICS } = require("./src/renderer/modules/constants.js");
// console.log(JSON.stringify(GW2_RELICS.map(r => r.label).sort(), null, 2));

"use strict";
// Alphabetically sorted relic labels.
// Source: src/renderer/modules/constants.js GW2_RELICS
// MUST be kept in sync when relics are added/removed.
module.exports = [
  "Relic of Agony",
  "Relic of Akeem",
  "Relic of Altruism",
  "Relic of Antitoxin",
  "Relic of Atrocity",
  "Relic of Bava Nisos",
  "Relic of Bloodstone",
  // ... FULL LIST — extract ALL labels from GW2_RELICS and sort ...
  "Relic of the Zephyrite",
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/shareCodeTables.test.js --no-coverage`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/shareCodeTables.js src/main/shareCodeRelicList.js tests/unit/shareCodeTables.test.js
git commit -m "feat: add share code reference tables for professions, weapons, stats, relics"
```

---

### Task 4: Share Code Encoder

The main encoder that takes a build object and produces a share code string.

**Files:**
- Create: `src/main/buildShareCode.js`
- Test: `tests/unit/buildShareCode.test.js`

**References:**
- Spec: `docs/superpowers/specs/2026-03-17-build-share-codes-design.md`
- Build structure: `src/renderer/modules/state.js` (createEmptyEditor)
- Build normalization: `src/main/buildStore.js` (normalizeBuild)
- Chat link pattern: `src/main/buildChatLink.js`

- [ ] **Step 1: Write failing tests for the encoder**

Create `tests/unit/buildShareCode.test.js` with tests for `encodeShareCode`:

```javascript
"use strict";
const { encodeShareCode, decodeShareCode, isValidShareCode } = require("../../src/main/buildShareCode");

// Minimal Warrior/Berserker build fixture
const BERSERKER_BUILD = {
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
  selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
  activeAttunement: "",
  activeAttunement2: "",
  activeKit: 0,
  activeWeaponSet: 1,
  allianceTacticsForm: 0,
  antiquaryArtifacts: { f2: 0, f3: 0, f4: 0 },
  selectedUnderwaterLegends: ["", ""],
};

describe("encodeShareCode", () => {
  test("produces valid wrapper format", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    expect(code).toMatch(/^<AxiForge:[A-Za-z ]+:[0-9a-zA-Z.\-:+=^!/*?&<>()\[\]{}@%$#]+>$/);
  });

  test("label is elite spec name", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    expect(code.startsWith("<AxiForge:Berserker:")).toBe(true);
  });

  test("label is profession name for core build", () => {
    const coreBuild = { ...BERSERKER_BUILD, specializations: BERSERKER_BUILD.specializations.map(s => ({ ...s, elite: false })) };
    const code = encodeShareCode(coreBuild);
    expect(code.startsWith("<AxiForge:Warrior:")).toBe(true);
  });
});

describe("isValidShareCode", () => {
  test("returns true for valid code", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    expect(isValidShareCode(code)).toBe(true);
  });

  test("returns false for random text", () => {
    expect(isValidShareCode("not a share code")).toBe(false);
  });

  test("returns false for GW2 chat link", () => {
    expect(isValidShareCode("[&DQYlPSkvMBc=]")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/buildShareCode.test.js --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement the encoder**

Create `src/main/buildShareCode.js`:

The encoder should:
1. Read profession → `professionToIndex`
2. Read game mode → 0/1/2
3. For each of 3 specs: read `spec.id` (7 bits), compute trait positions by finding the index of `majorChoices[tier]` within `majorTraitsByTier[tier]` (2 bits per tier: 0=none, 1=top, 2=mid, 3=bottom)
4. Read skill IDs: `skills.heal?.id || 0`, etc. (17 bits each)
5. Determine flags from equipment state
6. Write equipment based on flags (weapons, stats, runes, sigils, relic, food, utility, enrichment, infusions)
7. Write underwater section if applicable
8. Write profession-specific section if applicable
9. Pad to 4-byte boundary, Z85 encode
10. Determine label (elite spec name or profession), wrap

The full implementation should follow the spec exactly. Key helper: a function `traitPosition(spec, tier)` that returns 0-3 by finding `majorChoices[tier]` in `majorTraitsByTier[tier]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/buildShareCode.test.js --no-coverage`
Expected: All encoder tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/buildShareCode.js tests/unit/buildShareCode.test.js
git commit -m "feat: implement share code encoder (build → <AxiForge:...>)"
```

---

### Task 5: Share Code Decoder

Decode a share code back into a build object.

**Files:**
- Modify: `src/main/buildShareCode.js`
- Modify: `tests/unit/buildShareCode.test.js`

- [ ] **Step 1: Add failing tests for the decoder**

Add to `tests/unit/buildShareCode.test.js`:

```javascript
describe("decodeShareCode", () => {
  test("round-trip: encode then decode preserves profession", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.profession).toBe("Warrior");
  });

  test("round-trip: preserves game mode", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.gameMode).toBe("pve");
  });

  test("round-trip: preserves specialization IDs", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.specializations[0].id).toBe(4);
    expect(decoded.specializations[1].id).toBe(36);
    expect(decoded.specializations[2].id).toBe(18);
  });

  test("round-trip: preserves trait choices", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    // Trait choices are stored as position indices (1=top, 2=mid, 3=bottom)
    expect(decoded.specializations[0].traitChoices).toEqual([1, 1, 1]);
    expect(decoded.specializations[2].traitChoices).toEqual([1, 1, 1]);
  });

  test("round-trip: preserves skill IDs", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.skills.healId).toBe(14402);
    expect(decoded.skills.utilityIds).toEqual([14404, 14410, 14405]);
    expect(decoded.skills.eliteId).toBe(14355);
  });

  test("round-trip: preserves stat package", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.statPackage).toBe("Berserker's");
  });

  test("round-trip: preserves weapon types", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.weapons.mainhand1).toBe("greatsword");
    expect(decoded.equipment.weapons.mainhand2).toBe("axe");
  });

  test("round-trip: preserves relic", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.relic).toBe("Relic of the Thief");
  });

  test("round-trip: preserves food", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.food).toBe("Bowl of Sweet and Spicy Butternut Squash Soup");
  });

  test("throws on invalid format", () => {
    expect(() => decodeShareCode("not valid")).toThrow("Invalid build code format");
  });

  test("throws on unknown version", () => {
    // Craft a code with version 15
    expect(() => decodeShareCode("<AxiForge:Test:00000>")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx jest tests/unit/buildShareCode.test.js --no-coverage`
Expected: Encoder tests pass, decoder tests fail

- [ ] **Step 3: Implement the decoder**

Add `decodeShareCode(code)` to `src/main/buildShareCode.js`:

1. Parse wrapper with regex: `/^<AxiForge:([^:]+):([^>]+)>$/`
2. Z85 decode the payload
3. Read version (4 bits) — reject if not 1
4. Read flags (8 bits)
5. Read core section (profession, game mode, 3 specs with trait positions, 5 skills)
6. Read equipment based on flags
7. Read underwater if flag bit 0
8. Read profession-specific if flag bit 4
9. Return a decoded build object with all resolved values

The decoded object should match the structure expected by `parseBuildImportPayload` in `src/renderer/modules/editor.js` so it can be loaded directly into the editor.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/buildShareCode.test.js --no-coverage`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/buildShareCode.js tests/unit/buildShareCode.test.js
git commit -m "feat: implement share code decoder (<AxiForge:...> → build)"
```

---

### Task 6: Profession-Specific Encoding Tests

Add round-trip tests for each profession's unique data (Revenant legends, Ranger pets, Elementalist attunements, etc.).

**Files:**
- Modify: `tests/unit/buildShareCode.test.js`
- Modify: `src/main/buildShareCode.js` (if any bugs found)

- [ ] **Step 1: Add Revenant round-trip test**

```javascript
test("round-trip: Revenant legends and alliance tactics", () => {
  const revBuild = {
    ...BERSERKER_BUILD,
    profession: "Revenant",
    specializations: [
      { id: 3, name: "Invocation", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 15, name: "Devastation", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 62, name: "Vindicator", elite: true, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
    ],
    selectedLegends: ["Legend2", "Legend7"],
    selectedUnderwaterLegends: ["Legend3", "Legend4"],
    allianceTacticsForm: 1,
  };
  const code = encodeShareCode(revBuild);
  expect(code.startsWith("<AxiForge:Vindicator:")).toBe(true);
  const decoded = decodeShareCode(code);
  expect(decoded.selectedLegends).toEqual(["Legend2", "Legend7"]);
  expect(decoded.allianceTacticsForm).toBe(1);
});
```

- [ ] **Step 2: Add Ranger pets round-trip test**

```javascript
test("round-trip: Ranger pets", () => {
  const rangerBuild = {
    ...BERSERKER_BUILD,
    profession: "Ranger",
    specializations: [
      { id: 30, name: "Skirmishing", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 25, name: "Nature Magic", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 5, name: "Druid", elite: true, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
    ],
    selectedPets: { terrestrial1: 46, terrestrial2: 59, aquatic1: 21, aquatic2: 40 },
  };
  const code = encodeShareCode(rangerBuild);
  const decoded = decodeShareCode(code);
  expect(decoded.selectedPets.terrestrial1).toBe(46);
  expect(decoded.selectedPets.terrestrial2).toBe(59);
});
```

- [ ] **Step 3: Add Elementalist attunement round-trip test**

```javascript
test("round-trip: Elementalist attunements (Weaver)", () => {
  const eleBuild = {
    ...BERSERKER_BUILD,
    profession: "Elementalist",
    specializations: [
      { id: 31, name: "Fire", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 41, name: "Arcane", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 56, name: "Weaver", elite: true, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
    ],
    activeAttunement: "Fire",
    activeAttunement2: "Water",
  };
  const code = encodeShareCode(eleBuild);
  expect(code.startsWith("<AxiForge:Weaver:")).toBe(true);
  const decoded = decodeShareCode(code);
  expect(decoded.activeAttunement).toBe("Fire");
  expect(decoded.activeAttunement2).toBe("Water");
});

test("round-trip: Elementalist attunement (non-Weaver, no secondary)", () => {
  const tempestBuild = {
    ...BERSERKER_BUILD,
    profession: "Elementalist",
    specializations: [
      { id: 31, name: "Fire", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 41, name: "Arcane", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 48, name: "Tempest", elite: true, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
    ],
    activeAttunement: "Air",
    activeAttunement2: "",
  };
  const code = encodeShareCode(tempestBuild);
  const decoded = decodeShareCode(code);
  expect(decoded.activeAttunement).toBe("Air");
  expect(decoded.activeAttunement2).toBe("");
});
```

- [ ] **Step 4: Add Thief/Antiquary artifacts round-trip test**

```javascript
test("round-trip: Thief/Antiquary artifacts", () => {
  const thiefBuild = {
    ...BERSERKER_BUILD,
    profession: "Thief",
    specializations: [
      { id: 28, name: "Deadly Arts", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 35, name: "Trickery", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 77, name: "Antiquary", elite: true, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
    ],
    antiquaryArtifacts: { f2: 76582, f3: 76702, f4: 77288 },
  };
  const code = encodeShareCode(thiefBuild);
  expect(code.startsWith("<AxiForge:Antiquary:")).toBe(true);
  const decoded = decodeShareCode(code);
  expect(decoded.antiquaryArtifacts).toEqual({ f2: 76582, f3: 76702, f4: 77288 });
});
```

- [ ] **Step 5: Add Engineer active kit round-trip test**

```javascript
test("round-trip: Engineer active kit", () => {
  const engBuild = {
    ...BERSERKER_BUILD,
    profession: "Engineer",
    specializations: [
      { id: 6, name: "Explosives", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 38, name: "Firearms", elite: false, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 43, name: "Scrapper", elite: true, majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
    ],
    activeKit: 5812,
  };
  const code = encodeShareCode(engBuild);
  const decoded = decodeShareCode(code);
  expect(decoded.activeKit).toBe(5812);
});
```

- [ ] **Step 6: Add Warrior active weapon set round-trip test**

```javascript
test("round-trip: Warrior active weapon set", () => {
  const warriorBuild = {
    ...BERSERKER_BUILD,
    activeWeaponSet: 2,
  };
  const code = encodeShareCode(warriorBuild);
  const decoded = decodeShareCode(code);
  expect(decoded.activeWeaponSet).toBe(2);
});
```

- [ ] **Step 7: Run all tests**

Run: `npx jest tests/unit/buildShareCode.test.js --no-coverage`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add tests/unit/buildShareCode.test.js src/main/buildShareCode.js
git commit -m "test: add profession-specific round-trip tests for share codes"
```

---

### Task 7: Per-Slot Mode Tests (Stats, Runes, Infusions)

Test the uniform vs per-slot encoding paths.

**Files:**
- Modify: `tests/unit/buildShareCode.test.js`

- [ ] **Step 1: Add per-slot stats test**

Note: Per-slot stats requires the build to have per-slot stat data. The current build schema uses a single `statPackage` string. The encoder should detect when the build has per-slot stats (future feature) vs uniform. For v1, test uniform mode thoroughly and add a placeholder test for per-slot mode that validates the flag is set to 0.

```javascript
test("round-trip: uniform stats sets flag bit 5 to 0", () => {
  const code = encodeShareCode(BERSERKER_BUILD);
  const decoded = decodeShareCode(code);
  expect(decoded.equipment.statPackage).toBe("Berserker's");
});
```

- [ ] **Step 2: Add per-slot runes test**

```javascript
test("round-trip: uniform runes (all same)", () => {
  const code = encodeShareCode(BERSERKER_BUILD);
  const decoded = decodeShareCode(code);
  // All rune slots should have the same value
  expect(decoded.equipment.runes.head).toBe("24836");
  expect(decoded.equipment.runes.feet).toBe("24836");
});

test("round-trip: per-slot runes (mixed)", () => {
  const mixedRuneBuild = {
    ...BERSERKER_BUILD,
    equipment: {
      ...BERSERKER_BUILD.equipment,
      runes: { head: "24836", shoulders: "24836", chest: "24836", hands: "24836", legs: "24836", feet: "24691" },
    },
  };
  const code = encodeShareCode(mixedRuneBuild);
  const decoded = decodeShareCode(code);
  expect(decoded.equipment.runes.head).toBe("24836");
  expect(decoded.equipment.runes.feet).toBe("24691");
});
```

- [ ] **Step 3: Add per-slot infusions test**

```javascript
test("round-trip: uniform infusions (all same)", () => {
  const code = encodeShareCode(BERSERKER_BUILD);
  const decoded = decodeShareCode(code);
  expect(decoded.equipment.infusions.head).toBe("49432");
  expect(decoded.equipment.infusions.accessory2).toBe("49432");
});

test("round-trip: per-slot infusions (mixed)", () => {
  const mixedInfBuild = {
    ...BERSERKER_BUILD,
    equipment: {
      ...BERSERKER_BUILD.equipment,
      infusions: {
        ...BERSERKER_BUILD.equipment.infusions,
        head: "49432", shoulders: "37131", // different infusion
      },
    },
  };
  const code = encodeShareCode(mixedInfBuild);
  const decoded = decodeShareCode(code);
  expect(decoded.equipment.infusions.head).toBe("49432");
  expect(decoded.equipment.infusions.shoulders).toBe("37131");
});
```

- [ ] **Step 4: Add underwater section test**

```javascript
test("round-trip: underwater skills, weapons, and sigils", () => {
  const uwBuild = {
    ...BERSERKER_BUILD,
    underwaterSkills: {
      heal: { id: 14402 },
      utility: [{ id: 14404 }, { id: 14410 }, { id: 14405 }],
      elite: { id: 14355 },
    },
    equipment: {
      ...BERSERKER_BUILD.equipment,
      weapons: { ...BERSERKER_BUILD.equipment.weapons, aquatic1: "spear", aquatic2: "" },
      sigils: { ...BERSERKER_BUILD.equipment.sigils, aquatic1: ["24615", "24868"], aquatic2: [] },
    },
  };
  const code = encodeShareCode(uwBuild);
  const decoded = decodeShareCode(code);
  expect(decoded.underwaterSkills.healId).toBe(14402);
  expect(decoded.underwaterSkills.utilityIds).toEqual([14404, 14410, 14405]);
  expect(decoded.underwaterSkills.eliteId).toBe(14355);
  expect(decoded.equipment.weapons.aquatic1).toBe("spear");
});

test("round-trip: sigils for 1H mainhand vs 2H weapon", () => {
  // mainhand1 is greatsword (2H) → 2 sigils
  // mainhand2 is axe (1H, no offhand) → 1 sigil
  const code = encodeShareCode(BERSERKER_BUILD);
  const decoded = decodeShareCode(code);
  expect(decoded.equipment.sigils.mainhand1).toEqual(["24615", "24868"]);
  expect(decoded.equipment.sigils.mainhand2).toEqual(["24615"]);
});
```

- [ ] **Step 5: Add error handling tests**

```javascript
test("throws on truncated payload", () => {
  const code = encodeShareCode(BERSERKER_BUILD);
  // Truncate the payload
  const truncated = code.slice(0, -10) + ">";
  expect(() => decodeShareCode(truncated)).toThrow();
});

test("throws on invalid Z85 characters", () => {
  expect(() => decodeShareCode("<AxiForge:Test:~~~~~ >")).toThrow();
});
```

- [ ] **Step 5: Run all tests**

Run: `npx jest tests/unit/buildShareCode.test.js --no-coverage`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add tests/unit/buildShareCode.test.js
git commit -m "test: add per-slot and underwater round-trip tests for share codes"
```

---

### Task 8: IPC Handlers + Preload Bridge

Wire the encoder/decoder into the Electron IPC system so the renderer can call it.

**Files:**
- Modify: `src/main/index.js:350` — add IPC handlers after existing chat link handlers
- Modify: `src/preload/index.js:47` — add preload API methods

- [ ] **Step 1: Add IPC handlers to main/index.js**

Add after the `builds:import-gw2skills` handler (around line 355):

```javascript
  ipcMain.handle("builds:encode-share-code", async (_e, build) => {
    const { encodeShareCode } = require("./buildShareCode.js");
    return encodeShareCode(build);
  });
  ipcMain.handle("builds:decode-share-code", async (_e, code) => {
    const { decodeShareCode } = require("./buildShareCode.js");
    return decodeShareCode(code);
  });
  ipcMain.handle("builds:is-share-code", async (_e, text) => {
    const { isValidShareCode } = require("./buildShareCode.js");
    return isValidShareCode(text);
  });
```

- [ ] **Step 2: Add preload API methods to preload/index.js**

Add after the `importGw2Skills` line (around line 47):

```javascript
  encodeShareCode: (build) => ipcRenderer.invoke("builds:encode-share-code", build),
  decodeShareCode: (code) => ipcRenderer.invoke("builds:decode-share-code", code),
  isShareCode: (text) => ipcRenderer.invoke("builds:is-share-code", text),
```

- [ ] **Step 3: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: wire share code encoder/decoder to IPC + preload bridge"
```

---

### Task 9: UI Integration — Copy Share Code

Add a "Copy Share Code" option to the editor and library context menu.

**Files:**
- Modify: `src/renderer/renderer.js` — add `copyShareCodeToClipboard` function
- Modify: `src/renderer/modules/library/context-menu.js` — add menu item

**References:**
- Existing copy pattern: `src/renderer/renderer.js:377` (`copyBuildJsonToClipboard`)
- Context menu: `src/renderer/modules/library/context-menu.js:112`

- [ ] **Step 1: Add `copyShareCodeToClipboard` to renderer.js**

Add near the existing `copyBuildJsonToClipboard` function (around line 386):

```javascript
async function copyShareCodeToClipboard() {
  try {
    const payload = serializeEditorToBuild();
    const code = await window.desktopApi.encodeShareCode(payload);
    await window.desktopApi.writeClipboardText(code);
    setPublishStatus("Share code copied to clipboard.");
  } catch (err) {
    showError(err);
  }
}
```

- [ ] **Step 2: Add context menu item**

In `context-menu.js`, add a "Copy Share Code" menu item near the existing "Copy" item. Use the `linkIcon` import.

- [ ] **Step 3: Wire up keyboard shortcut or toolbar button**

Add to the existing keyboard handler in `renderer.js` or to the library toolbar.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/renderer.js src/renderer/modules/library/context-menu.js
git commit -m "feat: add 'Copy Share Code' to editor and library context menu"
```

---

### Task 10: UI Integration — Import Share Code

Extend the paste/import flow to detect and handle share codes from clipboard.

**Files:**
- Modify: `src/renderer/renderer.js` — update `importBuildJsonFromClipboard`
- Modify: `src/renderer/modules/editor.js` — update `parseBuildImportPayload`

**References:**
- Import flow: `src/renderer/renderer.js:388` (`importBuildJsonFromClipboard`)
- Parse: `src/renderer/modules/editor.js:446` (`parseBuildImportPayload`)

- [ ] **Step 1: Update importBuildJsonFromClipboard to detect share codes**

Modify the function to check clipboard text for share code format before trying JSON parse:

```javascript
async function importBuildJsonFromClipboard() {
  try {
    if (!confirmDiscardDirty("Import another build")) return;
    const text = await window.desktopApi.readClipboardText();
    if (!text || !String(text).trim()) {
      throw new Error("Clipboard is empty.");
    }
    const trimmed = String(text).trim();
    let parsed;
    if (trimmed.startsWith("<AxiForge:") && trimmed.endsWith(">")) {
      parsed = await window.desktopApi.decodeShareCode(trimmed);
    } else {
      parsed = parseBuildImportPayload(trimmed);
    }
    await loadBuildIntoEditor(parsed, { captureBaseline: false });
    state.editor.id = "";
    markEditorChanged({ updateBuildList: true });
    state.editorDirty = true;
    renderEditorMeta();
    render();
    syncGameModeToggleUI(state.editor.gameMode || "pve");
    const source = trimmed.startsWith("<AxiForge:") ? "share code" : "JSON";
    setPublishStatus(`Imported build from ${source}. Save to keep it locally.`);
  } catch (err) {
    showError(err);
  }
}
```

- [ ] **Step 2: Verify the decoded build object shape matches what loadBuildIntoEditor expects**

The decoder output must have the same shape as `parseBuildImportPayload` output. Check that fields like `equipment.weapons`, `equipment.runes`, `equipment.sigils`, `equipment.infusions`, `specializations[].majorChoices`, etc. are structured correctly.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat: detect and import share codes from clipboard on paste"
```

---

### Task 11: Run Full Test Suite + Manual Verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass, no regressions

- [ ] **Step 2: Run the app and test the flow manually**

1. Open AxiForge
2. Load/create a build
3. Copy share code (new menu item or shortcut)
4. Verify the clipboard contains `<AxiForge:...>` format
5. Start a new build
6. Paste (Ctrl+V) — should import the build from the share code
7. Verify profession, specs, traits, skills, and equipment match

- [ ] **Step 3: Test edge cases**

1. Core build (no elite spec) — label should be profession name
2. Revenant build with legends
3. Ranger build with pets
4. Build with per-slot runes (if different runes per armor piece)
5. Empty build (no specs, no skills) — should still encode/decode

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
