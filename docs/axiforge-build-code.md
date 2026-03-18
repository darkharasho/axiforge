# AxiForge Build Code Specification

> Version 1 — March 2026

AxiForge Build Codes are a compact binary encoding for Guild Wars 2 builds. They encode profession, specializations, trait choices, skills, and full equipment into a short string that can be shared in chat, URLs, or any text medium.

## Format

```
<AxiForge:Label:payload>
```

| Part | Description |
|------|-------------|
| `Label` | Elite specialization name (e.g. `Berserker`), or profession name if no elite is equipped (e.g. `Warrior`). Cosmetic only — not used for decoding. |
| `payload` | Z85-encoded binary data containing the full build. |

### Example

```
<AxiForge:Berserker:k9$Xm!vR2@pLn#qZ3tYw8BfdJ5cH7gKseN4rAu6iWx>
```

Typical length: **55–65 characters** total (shorter than a GW2 chat link, with more data).

---

## Z85 Encoding

The payload uses [Z85](https://rfc.zeromq.org/spec/32/) (ZeroMQ base-85) encoding. Alphabet:

```
0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#
```

Z85 encodes 4 bytes into 5 printable ASCII characters. The binary data is padded to a 4-byte boundary before encoding.

---

## Binary Layout

All fields are bit-packed MSB-first (most significant bit first).

### Header (12 bits)

| Field | Bits | Values |
|-------|------|--------|
| Version | 4 | `1` for this spec |
| Flags | 8 | See below |

### Flags

| Bit | Name | Meaning |
|-----|------|---------|
| 0 | `HAS_UNDERWATER` | Underwater section is present |
| 1 | `HAS_OFFHAND_1` | Offhand weapon in set 1 |
| 2 | `HAS_OFFHAND_2` | Offhand weapon in set 2 |
| 3 | `HAS_WEAPON_SET_2` | Second weapon set is present |
| 4 | `HAS_PROFESSION_DATA` | Profession-specific section is present |
| 5 | `PER_SLOT_STATS` | 0 = one stat for all gear, 1 = per-slot |
| 6 | `PER_SLOT_RUNES` | 0 = one rune for all armor, 1 = per-slot |
| 7 | `PER_SLOT_INFUSIONS` | 0 = one infusion for all, 1 = per-slot |

---

### Core Build (130 bits)

| Field | Bits | Description |
|-------|------|-------------|
| Profession | 4 | Profession index (see table below) |
| Game mode | 2 | 0=PvE, 1=PvP, 2=WvW |
| Spec 1 ID | 7 | GW2 API specialization ID (0 = empty) |
| Spec 1 traits | 6 | 3 tiers × 2 bits each (0=none, 1=top, 2=mid, 3=bottom) |
| Spec 2 ID | 7 | |
| Spec 2 traits | 6 | |
| Spec 3 ID | 7 | |
| Spec 3 traits | 6 | |
| Heal skill | 17 | GW2 API skill ID (0 = empty) |
| Utility 1 | 17 | |
| Utility 2 | 17 | |
| Utility 3 | 17 | |
| Elite skill | 17 | |

---

### Equipment

#### Weapons

| Field | Bits | Condition |
|-------|------|-----------|
| Mainhand 1 | 5 | Always |
| Offhand 1 | 5 | Flag `HAS_OFFHAND_1` |
| Mainhand 2 | 5 | Flag `HAS_WEAPON_SET_2` |
| Offhand 2 | 5 | Flag `HAS_WEAPON_SET_2` AND `HAS_OFFHAND_2` |

#### Stats

**Uniform** (flag bit 5 = 0): 1 × 5-bit stat index.

**Per-slot** (flag bit 5 = 1): One 5-bit stat index per equipment slot, in order: head, shoulders, chest, hands, legs, feet, mainhand1, [offhand1], [mainhand2], [offhand2], back, amulet, ring1, ring2, accessory1, accessory2. Weapon slots are conditional on weapon flags.

#### Runes

**Uniform** (flag bit 6 = 0): 1 × 17-bit GW2 API item ID.

**Per-slot** (flag bit 6 = 1): 6 × 17-bit item IDs, one per armor slot (head, shoulders, chest, hands, legs, feet).

#### Sigils

Per weapon slot, number depends on weapon type:
- Two-handed weapon (indices 11–16, 18): **2** sigils (17 bits each)
- One-handed weapon (mainhand or offhand): **1** sigil (17 bits)

If a mainhand weapon is two-handed, the corresponding offhand flag must be 0. The decoder uses the weapon type index to determine sigil count.

#### Relic, Food, Utility Buff, Enrichment

| Field | Bits | Description |
|-------|------|-------------|
| Relic | 7 | Index into relic table (0 = none) |
| Food | 4 | Index into food table (0 = none) |
| Utility buff | 3 | Index into utility table (0 = none) |
| Enrichment | 17 | GW2 API item ID (0 = none) |

#### Infusions

**Uniform** (flag bit 7 = 0): 1 × 17-bit GW2 API item ID, applied to all slots.

**Per-slot** (flag bit 7 = 1): One 17-bit item ID per infusion slot. Slot order and counts:

| Slot | Count | Condition |
|------|-------|-----------|
| Head | 1 | Always |
| Shoulders | 1 | Always |
| Chest | 1 | Always |
| Hands | 1 | Always |
| Legs | 1 | Always |
| Feet | 1 | Always |
| Back | 2 | Always |
| Ring 1 | 3 | Always |
| Ring 2 | 3 | Always |
| Accessory 1 | 1 | Always |
| Accessory 2 | 1 | Always |
| Mainhand 1 | 2 | Always |
| Offhand 1 | 1 | `HAS_OFFHAND_1` |
| Mainhand 2 | 2 | `HAS_WEAPON_SET_2` |
| Offhand 2 | 1 | `HAS_WEAPON_SET_2` AND `HAS_OFFHAND_2` |
| Breather | 1 | `HAS_UNDERWATER` |
| Aquatic 1 | 2 | `HAS_UNDERWATER` |
| Aquatic 2 | 2 | `HAS_UNDERWATER` |

---

### Underwater Section (Flag bit 0)

| Field | Bits | Description |
|-------|------|-------------|
| Underwater heal | 17 | GW2 API skill ID |
| Underwater utility 1 | 17 | |
| Underwater utility 2 | 17 | |
| Underwater utility 3 | 17 | |
| Underwater elite | 17 | |
| Aquatic weapon 1 type | 5 | Weapon table index |
| Aquatic weapon 2 type | 5 | (0 = empty) |
| Aquatic 1 sigil 1 | 17 | |
| Aquatic 1 sigil 2 | 17 | |
| Aquatic 2 sigil 1 | 17 | If aquatic weapon 2 present |
| Aquatic 2 sigil 2 | 17 | If aquatic weapon 2 present |

---

### Profession-Specific Section (Flag bit 4)

The profession ID determines which fields follow.

#### Revenant (profession 8)

| Field | Bits | Description |
|-------|------|-------------|
| Legend 1 | 3 | Legend index (see table below) |
| Legend 2 | 3 | |
| Active legend slot | 1 | 0 or 1 |
| Alliance tactics form | 1 | 0=Archemorus, 1=Saint Viktor (Vindicator only; 0 otherwise) |
| Underwater legend 1 | 3 | If `HAS_UNDERWATER` |
| Underwater legend 2 | 3 | If `HAS_UNDERWATER` |

**Legend Table:**

| Index | Legend | API String |
|-------|--------|-----------|
| 0 | *(empty)* | — |
| 1 | Glint (Herald) | Legend1 |
| 2 | Shiro (Assassin) | Legend2 |
| 3 | Jalis (Dwarf) | Legend3 |
| 4 | Mallyx (Demon) | Legend4 |
| 5 | Ventari (Centaur) | Legend5 |
| 6 | Kalla (Renegade) | Legend6 |
| 7 | Alliance (Vindicator) | Legend7 |

#### Ranger (profession 3)

| Field | Bits | Description |
|-------|------|-------------|
| Terrestrial pet 1 | 7 | GW2 API pet ID |
| Terrestrial pet 2 | 7 | |
| Aquatic pet 1 | 7 | If `HAS_UNDERWATER` |
| Aquatic pet 2 | 7 | If `HAS_UNDERWATER` |

#### Elementalist (profession 5)

| Field | Bits | Description |
|-------|------|-------------|
| Active attunement | 2 | 0=Fire, 1=Water, 2=Air, 3=Earth |
| Secondary attunement | 2 | Weaver only (same encoding; 0 if not Weaver) |

#### Engineer (profession 2)

| Field | Bits | Description |
|-------|------|-------------|
| Active kit | 17 | GW2 API skill ID (0 = none) |

#### Thief/Antiquary (profession 4)

| Field | Bits | Description |
|-------|------|-------------|
| F2 artifact | 17 | Skill ID (0 = none) |
| F3 artifact | 17 | |
| F4 artifact | 17 | (0 if no Prolific Plunderer trait) |

#### Warrior (profession 1)

| Field | Bits | Description |
|-------|------|-------------|
| Active weapon set | 1 | 0=set 1, 1=set 2 (relevant for Bladesworn's gunsaber stance) |

#### Guardian (0), Mesmer (6), Necromancer (7)

No additional fields.

---

## Reference Tables

### Professions

| Index | Name |
|-------|------|
| 0 | Guardian |
| 1 | Warrior |
| 2 | Engineer |
| 3 | Ranger |
| 4 | Thief |
| 5 | Elementalist |
| 6 | Mesmer |
| 7 | Necromancer |
| 8 | Revenant |

### Weapons

| Index | Name | Index | Name |
|-------|------|-------|------|
| 0 | *(empty)* | 10 | Warhorn |
| 1 | Axe | 11 | Greatsword |
| 2 | Dagger | 12 | Hammer |
| 3 | Mace | 13 | Longbow |
| 4 | Pistol | 14 | Rifle |
| 5 | Sword | 15 | Short Bow |
| 6 | Scepter | 16 | Staff |
| 7 | Focus | 17 | Harpoon Gun |
| 8 | Shield | 18 | Spear |
| 9 | Torch | 19 | Trident |

### Stat Combos

| Index | Name | Index | Name |
|-------|------|-------|------|
| 0 | *(empty)* | 11 | Carrion |
| 1 | Berserker's | 12 | Trailblazer's |
| 2 | Marauder's | 13 | Knight's |
| 3 | Assassin's | 14 | Soldier's |
| 4 | Valkyrie | 15 | Cleric's |
| 5 | Dragon's | 16 | Minstrel's |
| 6 | Viper's | 17 | Harrier's |
| 7 | Grieving | 18 | Ritualist's |
| 8 | Sinister | 19 | Seraph |
| 9 | Dire | 20 | Zealot's |
| 10 | Rabid | 21 | Celestial |

### Relics

Index 0 = none. Indices 1–N = relics sorted alphabetically by label at runtime. The canonical source is AxiForge's `constants.js` → `GW2_RELICS`, but this array is NOT pre-sorted. Implementations must sort alphabetically by label before indexing.

### Food & Utility Buffs

Indexed by position in AxiForge's source arrays (`GW2_FOOD`, `GW2_UTILITY`). Index 0 = none.

---

## Error Handling

| Condition | Recommended behavior |
|-----------|---------------------|
| Invalid wrapper format | Reject: "Invalid build code format" |
| Z85 decode failure | Reject: "Corrupted build code" |
| Unknown version | Reject: "Requires a newer version of AxiForge" |
| Unknown GW2 API ID | Partial decode: fill what's possible, mark unknowns as empty |
| Truncated data | Reject: "Incomplete build code" |

---

## Versioning

The 4-bit version field supports up to 15 revisions. A new version is required when:
- Fields are added or removed
- Field sizes change
- Reference table ordering changes
- New professions are added

All prior versions must remain decodable. Old codes never expire.
