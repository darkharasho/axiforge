# AxiForge Build Share Codes — Design Spec

## Overview

A custom binary encoding that serializes a GW2 build (specializations, traits, skills, equipment) into a compact, human-friendly share code. The format is designed to be shorter than GW2 chat links while encoding more data (full equipment).

### Format

```
<AxiForge:Label:payload>
```

- **Label** — The name of the equipped elite specialization (e.g. `Berserker`, `Catalyst`). If no elite spec is equipped, the core profession name (e.g. `Warrior`, `Elementalist`). Cosmetic only — not used for decoding.
- **Payload** — Version byte + binary-packed build data, encoded as Z85 (a base-85 encoding using only safe printable ASCII).

### Example

```
<AxiForge:Berserker:k9$Xm!vR2@pLn#qZ3tYw8BfdJ5cH7gKseN4rAu6iWx>
```

Typical payload length: ~43 characters. Full share code with wrapper: ~55–65 characters depending on label length.

### Scope

The share code encodes:
- **Tier A (Core Build):** Profession, game mode, 3 specializations with trait choices, 5 terrestrial skills, profession-specific data
- **Tier B (Equipment):** Stat package(s), weapons, rune(s), sigils, relic, food, utility buff, enrichment, infusion(s)
- **Underwater (optional):** Underwater skills, aquatic weapons, aquatic sigils

The share code does NOT encode:
- Build title, notes, tags, images
- Library metadata (folder, pin status, sort order)
- Timestamps, UUIDs
- Display data derivable from IDs (names, icons, descriptions)

---

## Binary Layout

All multi-bit fields are packed MSB-first (most significant bit first). The bit buffer is padded to the nearest byte boundary with zero bits before Z85 encoding.

### Header

| Field | Bits | Description |
|-------|------|-------------|
| Version | 4 | Encoding version (1 for initial release) |
| Flags | 8 | Bitfield controlling optional sections |

**Flag bits:**

| Bit | Meaning |
|-----|---------|
| 0 | Has underwater section |
| 1 | Has offhand weapon in set 1 |
| 2 | Has offhand weapon in set 2 |
| 3 | Has second weapon set |
| 4 | Has profession-specific data |
| 5 | Per-slot stat mode (0 = uniform, 1 = per-slot) |
| 6 | Per-slot rune mode (0 = uniform, 1 = per-slot) |
| 7 | Per-slot infusion mode (0 = uniform, 1 = per-slot) |

### Core Build Section

| Field | Bits | Description |
|-------|------|-------------|
| Profession | 4 | Index into profession table (0–8) |
| Game mode | 2 | 0 = PvE, 1 = PvP, 2 = WvW |
| Spec 1 ID | 7 | GW2 API specialization ID (0 = empty) |
| Spec 1 trait choices | 6 | 3 tiers × 2 bits: 0=none, 1=top, 2=middle, 3=bottom |
| Spec 2 ID | 7 | |
| Spec 2 trait choices | 6 | |
| Spec 3 ID | 7 | |
| Spec 3 trait choices | 6 | |
| Heal skill ID | 17 | GW2 API skill ID (0 = empty) |
| Utility 1 skill ID | 17 | |
| Utility 2 skill ID | 17 | |
| Utility 3 skill ID | 17 | |
| Elite skill ID | 17 | |

**Core subtotal: 130 bits**

### Equipment Section

#### Weapons

Always present:

| Field | Bits | Description |
|-------|------|-------------|
| Mainhand 1 type | 5 | Index into weapon table (0 = empty) |

Conditional:

| Field | Bits | Condition |
|-------|------|-----------|
| Offhand 1 type | 5 | Flag bit 1 set |
| Mainhand 2 type | 5 | Flag bit 3 set |
| Offhand 2 type | 5 | Flag bit 3 AND bit 2 set |

#### Stats

**Uniform mode** (flag bit 5 = 0):

| Field | Bits | Description |
|-------|------|-------------|
| Stat package | 5 | Index into stat combo table |

**Per-slot mode** (flag bit 5 = 1):

| Field | Bits | Description |
|-------|------|-------------|
| Head stat | 5 | Index into stat combo table |
| Shoulders stat | 5 | |
| Chest stat | 5 | |
| Hands stat | 5 | |
| Legs stat | 5 | |
| Feet stat | 5 | |
| Mainhand 1 stat | 5 | |
| Offhand 1 stat | 5 | Only if flag bit 1 |
| Mainhand 2 stat | 5 | Only if flag bit 3 |
| Offhand 2 stat | 5 | Only if flag bit 3 AND bit 2 |
| Back stat | 5 | |
| Amulet stat | 5 | |
| Ring 1 stat | 5 | |
| Ring 2 stat | 5 | |
| Accessory 1 stat | 5 | |
| Accessory 2 stat | 5 | |

#### Runes

**Uniform mode** (flag bit 6 = 0):

| Field | Bits | Description |
|-------|------|-------------|
| Rune ID | 17 | GW2 API item ID (0 = none) |

**Per-slot mode** (flag bit 6 = 1):

One 17-bit rune ID per armor slot (head, shoulders, chest, hands, legs, feet) = 6 × 17 = 102 bits.

#### Sigils

Sigils are encoded per-weapon, with count determined by weapon type:
- Two-handed weapon: 2 sigil slots
- One-handed weapon (mainhand or offhand): 1 sigil slot

| Field | Bits | Description |
|-------|------|-------------|
| Sigil ID | 17 | GW2 API item ID per slot (0 = none) |

Slot count depends on weapon flags:
- Mainhand 1 (two-handed, no offhand): 2 sigils
- Mainhand 1 (one-handed, with offhand): 1 sigil
- Offhand 1: 1 sigil (if flag bit 1)
- Mainhand 2 (two-handed, no offhand 2): 2 sigils
- Mainhand 2 (one-handed, with offhand 2): 1 sigil
- Offhand 2: 1 sigil (if flag bit 3 AND bit 2)

The decoder determines whether a mainhand is two-handed by checking the weapon type table (indices 11–16, 18 are two-handed). If the mainhand is two-handed, the corresponding offhand flag must be 0.

#### Relic, Food, Utility, Enrichment

| Field | Bits | Description |
|-------|------|-------------|
| Relic index | 7 | Index into relic table (0 = none) |
| Food index | 4 | Index into food table (0 = none) |
| Utility buff index | 3 | Index into utility buff table (0 = none) |
| Enrichment ID | 17 | GW2 API item ID (0 = none) |

#### Infusions

**Uniform mode** (flag bit 7 = 0):

| Field | Bits | Description |
|-------|------|-------------|
| Infusion ID | 17 | GW2 API item ID (0 = none) |

**Per-slot mode** (flag bit 7 = 1):

One 17-bit infusion ID per infusion slot. Slot count per equipment piece:

| Equipment | Infusion slots |
|-----------|---------------|
| Head, Shoulders, Chest, Hands, Legs, Feet | 1 each |
| Accessory 1, Accessory 2 | 1 each |
| Back | 2 |
| Ring 1, Ring 2 | 3 each |
| Mainhand 1, Mainhand 2, Aquatic 1, Aquatic 2 | 2 each |
| Offhand 1, Offhand 2, Breather | 1 each |

Total: 18 slots × 17 bits = 306 bits (worst case).

Only land-relevant slots are encoded unless the underwater flag is set, in which case aquatic weapon infusion slots and breather are also included.

**Land-only infusion slots** (when underwater flag = 0):

| Slot | Infusion count |
|------|---------------|
| Head | 1 |
| Shoulders | 1 |
| Chest | 1 |
| Hands | 1 |
| Legs | 1 |
| Feet | 1 |
| Back | 2 |
| Ring 1 | 3 |
| Ring 2 | 3 |
| Accessory 1 | 1 |
| Accessory 2 | 1 |
| Mainhand 1 | 2 |
| Offhand 1 | 1 (if flag bit 1) |
| Mainhand 2 | 2 (if flag bit 3) |
| Offhand 2 | 1 (if flag bit 3 AND bit 2) |

**Total land (worst case, all weapon slots present): 22 slots × 17 = 374 bits. Base (no offhand/set 2): 18 slots × 17 = 306 bits.**

**Additional underwater slots** (if underwater flag set):
| Slot | Infusion count |
|------|---------------|
| Breather | 1 |
| Aquatic 1 | 2 |
| Aquatic 2 | 2 |

### Underwater Section (Flag bit 0)

Only present when flag bit 0 is set.

| Field | Bits | Description |
|-------|------|-------------|
| Underwater heal skill ID | 17 | |
| Underwater utility 1 ID | 17 | |
| Underwater utility 2 ID | 17 | |
| Underwater utility 3 ID | 17 | |
| Underwater elite skill ID | 17 | |
| Aquatic weapon 1 type | 5 | Index into weapon table |
| Aquatic weapon 2 type | 5 | Index into weapon table (0 = empty) |
| Aquatic 1 sigil 1 | 17 | |
| Aquatic 1 sigil 2 | 17 | |
| Aquatic 2 sigil 1 | 17 | If aquatic weapon 2 is present |
| Aquatic 2 sigil 2 | 17 | If aquatic weapon 2 is present |

**Underwater subtotal: 129–163 bits**

### Profession-Specific Section (Flag bit 4)

Only present when flag bit 4 is set. The profession ID (from core section) determines which fields are read.

#### Revenant

| Field | Bits | Description |
|-------|------|-------------|
| Legend 1 | 3 | Legend index (see legend table below) |
| Legend 2 | 3 | Legend index |
| Active legend slot | 1 | 0 or 1 |
| Alliance tactics form | 1 | 0=Archemorus, 1=Saint Viktor (Vindicator only; 0 otherwise) |
| Underwater legend 1 | 3 | If underwater flag set |
| Underwater legend 2 | 3 | If underwater flag set |

**Revenant Legend Table (3 bits):**

| Index | Legend | API String |
|-------|--------|-----------|
| 0 | (empty) | — |
| 1 | Glint (Herald) | Legend1 |
| 2 | Shiro (Assassin) | Legend2 |
| 3 | Jalis (Dwarf) | Legend3 |
| 4 | Mallyx (Demon) | Legend4 |
| 5 | Ventari (Centaur) | Legend5 |
| 6 | Kalla (Renegade) | Legend6 |
| 7 | Alliance (Vindicator) | Legend7 |

#### Ranger

| Field | Bits | Description |
|-------|------|-------------|
| Terrestrial pet 1 | 7 | Pet ID (0–127) |
| Terrestrial pet 2 | 7 | Pet ID |
| Aquatic pet 1 | 7 | If underwater flag set |
| Aquatic pet 2 | 7 | If underwater flag set |

#### Elementalist

| Field | Bits | Description |
|-------|------|-------------|
| Active attunement | 2 | 0=Fire, 1=Water, 2=Air, 3=Earth |
| Secondary attunement | 2 | Weaver only (same encoding) |

#### Engineer

| Field | Bits | Description |
|-------|------|-------------|
| Active kit | 17 | GW2 API skill ID (0 = none) |

#### Warrior

| Field | Bits | Description |
|-------|------|-------------|
| Active weapon set | 1 | 0 = set 1, 1 = set 2 (relevant for Bladesworn's gunsaber stance) |

#### Thief (Antiquary)

| Field | Bits | Description |
|-------|------|-------------|
| F2 artifact draw | 17 | Skill ID |
| F3 artifact draw | 17 | Skill ID |
| F4 artifact draw | 17 | Skill ID (0 if no Prolific Plunderer) |

#### Guardian, Mesmer, Necromancer

No additional fields.

---

## Reference Tables

### Profession Table (4 bits)

| Index | Profession |
|-------|-----------|
| 0 | Guardian |
| 1 | Warrior |
| 2 | Engineer |
| 3 | Ranger |
| 4 | Thief |
| 5 | Elementalist |
| 6 | Mesmer |
| 7 | Necromancer |
| 8 | Revenant |

### Weapon Type Table (5 bits)

| Index | Weapon | Hand |
|-------|--------|------|
| 0 | (empty) | — |
| 1 | Axe | Main |
| 2 | Dagger | Either |
| 3 | Mace | Either |
| 4 | Pistol | Either |
| 5 | Sword | Main |
| 6 | Scepter | Main |
| 7 | Focus | Off |
| 8 | Shield | Off |
| 9 | Torch | Off |
| 10 | Warhorn | Off |
| 11 | Greatsword | Two |
| 12 | Hammer | Two |
| 13 | Longbow | Two |
| 14 | Rifle | Two |
| 15 | Short Bow | Two |
| 16 | Staff | Two |
| 17 | Harpoon Gun | Aquatic |
| 18 | Spear | Two |
| 19 | Trident | Aquatic |

### Stat Combo Table (5 bits)

| Index | Stat Package |
|-------|-------------|
| 0 | (empty) |
| 1 | Berserker's |
| 2 | Marauder's |
| 3 | Assassin's |
| 4 | Valkyrie |
| 5 | Dragon's |
| 6 | Viper's |
| 7 | Grieving |
| 8 | Sinister |
| 9 | Dire |
| 10 | Rabid |
| 11 | Carrion |
| 12 | Trailblazer's |
| 13 | Knight's |
| 14 | Soldier's |
| 15 | Cleric's |
| 16 | Minstrel's |
| 17 | Harrier's |
| 18 | Ritualist's |
| 19 | Seraph |
| 20 | Zealot's |
| 21 | Celestial |

### Relic Table (7 bits)

Index 0 = none. Indices 1–N correspond to the relics sorted alphabetically by label at runtime. The canonical source is the app's `GW2_RELICS` constant array, but note that this array is NOT pre-sorted — encoders/decoders must sort it alphabetically by label before indexing to ensure stable, interoperable indices across implementations.

### Food Table (4 bits)

Index 0 = none. Indices 1–N correspond to the food items in the app's `GW2_FOOD` constant array, ordered by array position.

### Utility Buff Table (3 bits)

Index 0 = none. Indices 1–N correspond to the utility items in the app's `GW2_UTILITY` constant array, ordered by array position.

---

## Z85 Encoding

Z85 is a base-85 encoding defined in [ZeroMQ RFC 32](https://rfc.zeromq.org/spec/32/). It uses the following 85-character alphabet:

```
0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#
```

Z85 encodes 4 bytes into 5 characters (~25% overhead). The bit buffer is padded to a multiple of 4 bytes before encoding; the decoder strips padding based on the known structure from the version byte and flags.

### Why Z85?

- More compact than base64 (~25% vs ~33% overhead)
- Uses only printable ASCII characters
- Well-specified with existing implementations in many languages
- Avoids common escape-prone characters in most contexts

---

## Size Estimates

### Typical Build (uniform stats/runes/infusions, 2H weapon, no underwater)

| Section | Bits |
|---------|------|
| Header (version + flags) | 12 |
| Core build | 130 |
| Mainhand 1 | 5 |
| Stat (uniform) | 5 |
| Rune (uniform) | 17 |
| Sigils (2 for 2H) | 34 |
| Relic | 7 |
| Food | 4 |
| Utility buff | 3 |
| Enrichment | 17 |
| Infusion (uniform) | 17 |
| **Total** | **251 bits → 32 bytes → 40 Z85 chars** |

**Full share code:** `<AxiForge:Berserker:...40 chars...>` = ~58 characters total.

### Maximal Build (per-slot everything, dual wield × 2, underwater, profession-specific)

| Section | Bits |
|---------|------|
| Header | 12 |
| Core build | 130 |
| Weapons (4 slots) | 20 |
| Stats (16 per-slot) | 80 |
| Runes (6 per-slot) | 102 |
| Sigils (6 slots) | 102 |
| Relic + food + utility + enrichment | 31 |
| Infusions (22 per-slot land) | 374 |
| Underwater skills | 85 |
| Underwater weapons + sigils | 78 |
| Underwater infusion slots (5) | 85 |
| Profession-specific (Ranger worst case) | 28 |
| **Total** | **~1127 bits → 141 bytes → padded to 144 → 180 Z85 chars** |

This is an extreme worst case that real builds will never hit.

---

## Versioning Strategy

The 4-bit version field supports up to 15 future versions. Version changes are needed when:

- New fields are added to the binary layout
- Existing field sizes change
- New professions or profession-specific sections are added
- Reference table ordering changes

Decoders should reject unknown versions with a message like: "This build code requires a newer version of AxiForge."

Backward compatibility: newer versions of AxiForge must be able to decode all prior versions. Old codes never expire.

---

## Encoding Pipeline

1. Extract relevant fields from the build JSON
2. Determine flags (which optional sections are present, uniform vs per-slot)
3. Write version (4 bits) and flags (8 bits) to bit buffer
4. Write core build section
5. Write equipment section (weapons, stats, runes, sigils, relic, food, utility, enrichment, infusions)
6. Write underwater section (if flag bit 0)
7. Write profession-specific section (if flag bit 4)
8. Pad bit buffer to 4-byte boundary
9. Z85 encode the byte buffer
10. Determine label: if spec 3 is an elite spec, use its name; else use profession name
11. Wrap: `<AxiForge:Label:z85payload>`

## Decoding Pipeline

1. Validate wrapper format: must match `<AxiForge:...:...>`
2. Extract label and Z85 payload
3. Z85 decode payload to byte buffer
4. Read version (4 bits) — select decoder for that version
5. Read flags (8 bits)
6. Read core build section → resolve profession, specs, traits, skills via GW2 API catalog
7. Read equipment section based on flags → resolve IDs via catalog
8. Read underwater section if flag bit 0
9. Read profession-specific section if flag bit 4 (format determined by profession ID)
10. Populate build object with resolved data

## Error Handling

| Error | Behavior |
|-------|----------|
| Invalid wrapper format | Return error: "Invalid build code format" |
| Z85 decode failure | Return error: "Corrupted build code" |
| Unknown version | Return error: "This build code requires a newer version of AxiForge" |
| Unknown ID in catalog | Partial decode with warning: populate what's possible, mark unknown fields as empty |
| Truncated payload | Return error: "Incomplete build code" |

---

## Integration Guide

Third-party integrators who want to encode/decode AxiForge build codes need:

1. **This spec** — defines the binary layout and reference tables
2. **GW2 API access** — to resolve skill/specialization/item IDs to display data
3. **Z85 library** — widely available in most languages
4. **Reference table sync** — the relic, food, and utility buff tables must match AxiForge's canonical lists. These are published in the app's `constants.js` and in this document.

### Minimal Decode Example (pseudocode)

```
input = "<AxiForge:Berserker:k9$Xm!vR2@pLn#qZ3tYw>"
label, payload = parseWrapper(input)
bytes = z85Decode(payload)
bits = BitReader(bytes)

version = bits.read(4)
flags = bits.read(8)

profession = PROFESSIONS[bits.read(4)]
gameMode = GAME_MODES[bits.read(2)]

specs = []
for i in 0..2:
    specId = bits.read(7)
    traits = [bits.read(2) for _ in 0..2]
    specs.append({ id: specId, traits: traits })

skills = { heal: bits.read(17), utilities: [bits.read(17) for _ in 0..2], elite: bits.read(17) }

// ... continue reading equipment based on flags ...
```
