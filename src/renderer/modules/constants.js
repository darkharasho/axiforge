// GW2 CDN and wiki image base URLs
export const _RW = "https://render.guildwars2.com/file";
export const _WK = "https://wiki.guildwars2.com/images";

// Conduit (spec unknown) F2 skill variant mapping: legend swap skill ID → Release Potential skill ID.
// Each stance has two known swap skill IDs (active/inactive forms); both map to the same variant.
export const CONDUIT_F2_BY_SWAP = new Map([
  [27659, 78845], [28134, 78845], // Legendary Assassin Stance → Release Potential: Assassin
  [26650, 78895], [28419, 78895], // Legendary Dwarf Stance    → Release Potential: Warrior
  [28376, 78615], [28494, 78615], // Legendary Demon Stance    → Release Potential: Mesmer
  [28141, 78501], [28195, 78501], // Legendary Centaur Stance  → Release Potential: Monk
  [76610, 78661],                 // Legendary Entity Stance   → Release Potential: Dervish
]);

// For 4-stat combos: first 2 stats are major (0.3 multiplier), last 2 are minor (0.165 multiplier)
export const STAT_COMBOS = [
  { label: "Berserker's",   stats: ["Power", "Precision", "Ferocity"] },
  { label: "Marauder's",    stats: ["Power", "Precision", "Vitality", "Ferocity"] },
  { label: "Assassin's",    stats: ["Precision", "Power", "Ferocity"] },
  { label: "Valkyrie",      stats: ["Power", "Vitality", "Ferocity"] },
  { label: "Dragon's",      stats: ["Power", "Ferocity", "Vitality", "Precision"] },
  { label: "Viper's",       stats: ["Power", "ConditionDamage", "Precision", "Expertise"] },
  { label: "Grieving",      stats: ["Power", "ConditionDamage", "Ferocity", "Precision"] },
  { label: "Sinister",      stats: ["ConditionDamage", "Power", "Precision"] },
  { label: "Dire",          stats: ["ConditionDamage", "Toughness", "Vitality"] },
  { label: "Rabid",         stats: ["ConditionDamage", "Toughness", "Precision"] },
  { label: "Carrion",       stats: ["ConditionDamage", "Power", "Vitality"] },
  { label: "Trailblazer's", stats: ["Toughness", "ConditionDamage", "Vitality", "Expertise"] },
  { label: "Knight's",      stats: ["Toughness", "Power", "Precision"] },
  { label: "Soldier's",     stats: ["Power", "Toughness", "Vitality"] },
  { label: "Sentinel's",    stats: ["Vitality", "Power", "Toughness"] },
  { label: "Wanderer's",    stats: ["Power", "Vitality", "Toughness", "Concentration"] },
  { label: "Diviner's",     stats: ["Power", "Concentration", "Ferocity", "Precision"] },
  { label: "Cleric's",      stats: ["HealingPower", "Toughness", "Power"] },
  { label: "Minstrel's",    stats: ["Toughness", "HealingPower", "Vitality", "Concentration"] },
  { label: "Harrier's",     stats: ["Power", "HealingPower", "Concentration"] },
  { label: "Ritualist's",   stats: ["Vitality", "ConditionDamage", "Expertise", "Concentration"] },
  { label: "Seraph",        stats: ["Precision", "ConditionDamage", "HealingPower", "Concentration"] },
  { label: "Zealot's",      stats: ["Power", "Precision", "HealingPower"] },
  { label: "Celestial",     stats: ["Power", "Precision", "Toughness", "Vitality", "ConditionDamage", "Ferocity", "HealingPower", "Expertise", "Concentration"] },
];

export const STAT_COMBOS_BY_LABEL = new Map(STAT_COMBOS.map((c) => [c.label, c]));

// Ascended/Legendary stat weights per slot.
// p/s = 3-stat major/minor; p4/s4 = 4-stat major/minor; c = Celestial per-stat.
// Derived from GW2 API attribute_adjustment × stat multipliers (0.35/0.25/0.3/0.165).
export const SLOT_WEIGHTS = {
  head:       { p: 63,  s: 45,  p4: 54,  s4: 30, c: 30 },
  shoulders:  { p: 47,  s: 34,  p4: 40,  s4: 22, c: 22 },
  chest:      { p: 141, s: 101, p4: 121, s4: 66, c: 66 },
  hands:      { p: 47,  s: 34,  p4: 40,  s4: 22, c: 22 },
  legs:       { p: 94,  s: 67,  p4: 81,  s4: 44, c: 44 },
  feet:       { p: 47,  s: 34,  p4: 40,  s4: 22, c: 22 },
  mainhand1:  { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  offhand1:   { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  mainhand2:  { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  offhand2:   { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  back:       { p: 63,  s: 40,  p4: 51,  s4: 27, c: 28 },
  amulet:     { p: 157, s: 108, p4: 132, s4: 71, c: 72 },
  ring1:      { p: 126, s: 85,  p4: 105, s4: 56, c: 57 },
  ring2:      { p: 126, s: 85,  p4: 105, s4: 56, c: 57 },
  accessory1: { p: 110, s: 74,  p4: 92,  s4: 49, c: 50 },
  accessory2: { p: 110, s: 74,  p4: 92,  s4: 49, c: 50 },
  breather:   { p: 63,  s: 45,  p4: 54,  s4: 30, c: 30 },
  aquatic1:   { p: 251, s: 179, p4: 215, s4: 118, c: 118 },
  aquatic2:   { p: 251, s: 179, p4: 215, s4: 118, c: 118 },
};

export const EQUIP_ARMOR_SLOTS = [
  { key: "head",      label: "Head",      icon: "Head_slot.png" },
  { key: "shoulders", label: "Shoulders", icon: "Shoulder_slot.png" },
  { key: "chest",     label: "Chest",     icon: "Chest_slot.png" },
  { key: "hands",     label: "Hands",     icon: "Hand_slot.png" },
  { key: "legs",      label: "Legs",      icon: "Leg_slot.png" },
  { key: "feet",      label: "Feet",      icon: "Feet_slot.png" },
];

export const EQUIP_WEAPON_SETS = [
  [{ key: "mainhand1", label: "Main Hand", hand: "main" }, { key: "offhand1", label: "Off Hand", hand: "off" }],
  [{ key: "mainhand2", label: "Main Hand", hand: "main" }, { key: "offhand2", label: "Off Hand", hand: "off" }],
];

export const GW2_WEAPONS = [
  { id: "axe",        label: "Axe",        hand: "main",    icon: `${_WK}/b/b5/Bandit_Cleaver.png` },
  { id: "dagger",     label: "Dagger",      hand: "either",  icon: `${_WK}/a/ac/Bandit_Shiv.png` },
  { id: "mace",       label: "Mace",        hand: "either",  icon: `${_WK}/b/b3/Bandit_Mallet.png` },
  { id: "pistol",     label: "Pistol",      hand: "either",  icon: `${_WK}/f/f3/Bandit_Revolver.png` },
  { id: "sword",      label: "Sword",       hand: "main",    icon: `${_WK}/e/e1/Bandit_Slicer.png` },
  { id: "scepter",    label: "Scepter",     hand: "main",    icon: `${_WK}/9/95/Bandit_Baton.png` },
  { id: "focus",      label: "Focus",       hand: "off",     icon: `${_WK}/d/da/Bandit_Focus.png` },
  { id: "shield",     label: "Shield",      hand: "off",     icon: `${_WK}/7/7c/Bandit_Ward.png` },
  { id: "torch",      label: "Torch",       hand: "off",     icon: `${_WK}/7/7e/Bandit_Torch.png` },
  { id: "warhorn",    label: "Warhorn",     hand: "off",     icon: `${_WK}/3/31/Bandit_Bugle.png` },
  { id: "greatsword", label: "Greatsword",  hand: "two",     icon: `${_WK}/0/0b/Bandit_Sunderer.png` },
  { id: "hammer",     label: "Hammer",      hand: "two",     icon: `${_WK}/f/fb/Bandit_Demolisher.png` },
  { id: "longbow",    label: "Longbow",     hand: "two",     icon: `${_WK}/2/2d/Bandit_Longbow.png` },
  { id: "rifle",      label: "Rifle",       hand: "two",     icon: `${_WK}/3/37/Bandit_Musket.png` },
  { id: "shortbow",   label: "Short Bow",   hand: "two",     icon: `${_WK}/2/2f/Bandit_Short_Bow.png` },
  { id: "staff",      label: "Staff",       hand: "two",     icon: `${_WK}/9/98/Bandit_Spire.png` },
  { id: "harpoon",    label: "Harpoon Gun", hand: "aquatic", icon: `${_WK}/2/20/Bandit_Harpoon_Gun.png` },
  { id: "spear",      label: "Spear",       hand: "two",     icon: `${_WK}/c/c9/Bandit_Spear.png` },
  { id: "trident",    label: "Trident",     hand: "aquatic", icon: `${_WK}/6/66/Bandit_Trident.png` },
];

// Exotic level 80 weapon strength midpoints (avg of min/max per wiki.guildwars2.com/wiki/Weapon_strength).
export const WEAPON_STRENGTH_MIDPOINT = {
  axe: 952.5, dagger: 952.5, mace: 952.5, pistol: 952.5, sword: 952.5, scepter: 952.5,
  focus: 857.5, shield: 857.5, torch: 857.5, warhorn: 857,
  greatsword: 1047.5, hammer: 1048, longbow: 1000, rifle: 1095.5, shortbow: 952.5, staff: 1048,
  spear: 952.5, trident: 952.5, harpoon: 952.5,
};

export const EQUIP_TRINKET_SLOTS = [
  { key: "back",       label: "Back",        icon: "Back_slot.png",    filledIcon: "https://render.guildwars2.com/file/5EBEA1A467236237FCBACDC09969647956C4A371/1701118.png" },
  { key: "amulet",     label: "Amulet",      icon: "Amulet_slot.png",  filledIcon: "https://render.guildwars2.com/file/4944FD054FD80D805B0BFFB2DA60363A7DD31FDB/1614376.png" },
  { key: "ring1",      label: "Ring 1",      icon: "Trinket_slot.png", filledIcon: "https://render.guildwars2.com/file/EAA61AAF9BEF031104FD063C0A301A520EF5F5E6/1614682.png" },
  { key: "ring2",      label: "Ring 2",      icon: "Trinket_slot.png", filledIcon: "https://render.guildwars2.com/file/EAA61AAF9BEF031104FD063C0A301A520EF5F5E6/1614682.png" },
  { key: "accessory1", label: "Accessory 1", icon: "Trinket_slot.png", filledIcon: "https://render.guildwars2.com/file/741D3F520D1DFD7BB9A35AD50FC75152D2B3CA6B/1614709.png" },
  { key: "accessory2", label: "Accessory 2", icon: "Trinket_slot.png", filledIcon: "https://render.guildwars2.com/file/741D3F520D1DFD7BB9A35AD50FC75152D2B3CA6B/1614709.png" },
];

export const EQUIP_UNDERWATER_SLOTS = [
  { key: "breather", label: "Breather",  icon: `${_WK}/8/88/Breathing_apparatus_slot.png`, filledIcon: `${_WK}/0/08/Selachimorpha.png` },
  { key: "aquatic1", label: "Weapon 1",  hand: "aquatic" },
  { key: "aquatic2", label: "Weapon 2",  hand: "aquatic" },
];

// Underwater mode constants
export const MECHANIST_DEPTH_CHARGES_ID = 63210;
export const MECHANIST_SPEC_ID = 70;

// Revenant legends blocked underwater (legend string IDs from GW2 API)
// Legend1 = Glint (Herald elite spec, spec ID 52), Legend5 = Kalla (Renegade elite spec, spec ID 63)
export const UNDERWATER_BLOCKED_LEGENDS = new Set(["Legend1", "Legend5"]);

// Ranger pets usable underwater (GW2 API has no type field — this is hardcoded).
// Aquatic-only: Shark, Armor Fish, Jellyfish variants
// Amphibious (land + water): all Drakes, Siege Turtle
export const AQUATIC_PET_IDS = new Set([
  7, 12, 18, 19, 45,          // Drakes: Salamander, Marsh, Ice, River, Reef
  21,                           // Shark
  40,                           // Armor Fish
  41, 42, 43,                   // Jellyfish: Blue, Red, Rainbow
  66,                           // Siege Turtle
]);

// Slot sets for stat computation mode switching
export const LAND_ONLY_SLOTS = new Set(["head", "mainhand1", "offhand1", "mainhand2", "offhand2"]);
export const AQUATIC_SLOTS = new Set(["breather", "aquatic1", "aquatic2"]);

export const PROFESSION_WEIGHT = {
  Elementalist: "light", Mesmer: "light", Necromancer: "light",
  Engineer: "medium", Ranger: "medium", Thief: "medium",
  Guardian: "heavy", Warrior: "heavy", Revenant: "heavy",
};

const _R = "https://render.guildwars2.com/file";
export const LEGENDARY_ARMOR_ICONS = {
  light: {
    head:      `${_R}/06146C9BD029041178F50B5D9ACD0A76E7051408/1634576.png`,
    shoulders: `${_R}/A77403E5F0EB03E46E686B12297A04707AF50278/1634579.png`,
    chest:     `${_R}/C8FB494379CC98171EFB0F13923CACFD047743B3/1634574.png`,
    hands:     `${_R}/9703DBC0926F6BB4072032E6B55BE593F6B750CD/1634575.png`,
    legs:      `${_R}/65A4D3A41592D10EEABD0BC0D611F13A383B0261/1634577.png`,
    feet:      `${_R}/FD60D4E3986FA46F4FEBB8131B65159195260B19/1634578.png`,
  },
  medium: {
    head:      `${_R}/49092A1358E528DEC67EFA1C090546ED034642E2/1634588.png`,
    shoulders: `${_R}/CF7609512FC6527D805F2B74F26AF4549FF4E808/1634591.png`,
    chest:     `${_R}/57360F35D1210D12010F6AE772382450A07D08F6/1634586.png`,
    hands:     `${_R}/C57E5E5FA69261A2503CBB50080A6C023A155C49/1634587.png`,
    legs:      `${_R}/EBD907C061747927AE062D1B41BC13D0EAF14AD5/1634589.png`,
    feet:      `${_R}/BF4C6A48BA02BD6D6AC32F1E9C3F32A50399E336/1634590.png`,
  },
  heavy: {
    head:      `${_R}/2695A8E44B7F07EF15A20857790EFCA91513F5F0/1634565.png`,
    shoulders: `${_R}/0F0F4BE73C9316BAA4956A3AA622CB0AE84D9CEA/1634567.png`,
    chest:     `${_R}/DACF9B1ACBE8687B6B31ABC0CF295301120D7A67/1634563.png`,
    hands:     `${_R}/A5DD0D661970F02CC26D04B510C7C94259B99520/1634564.png`,
    legs:      `${_R}/EA9294557C175A43567906721E43962EC4B12D34/1634566.png`,
    feet:      `${_R}/E895D40AE0D1A500FFFDB955C27A98FF687AA4C1/1634562.png`,
  },
};

export const GW2_RELICS = [
  { label: "Relic of Akeem",               icon: "https://render.guildwars2.com/file/594C437E9606A167F4F372BCEB0C2B7C7828037B/3122330.png" },
  { label: "Relic of Antitoxin",           icon: "https://render.guildwars2.com/file/61C74AAFED48CF9AD4BBCAD89F902654EA02B2AE/3122331.png" },
  { label: "Relic of Cerus",               icon: "https://render.guildwars2.com/file/656FCA9408A0FFDB35A3CE20311E0F66423F026B/3122337.png" },
  { label: "Relic of Dagda",               icon: "https://render.guildwars2.com/file/CA28F7BFEA1B695DD19204E455BA270D334EE307/3122340.png" },
  { label: "Relic of Durability",          icon: "https://render.guildwars2.com/file/A8F61493030863CAB537780398D64D80554D959D/3122345.png" },
  { label: "Relic of Dwayna",              icon: "https://render.guildwars2.com/file/CBBD4FAFCC3568ACA04F9901162FE7C0747C1E9B/3122346.png" },
  { label: "Relic of Evasion",             icon: "https://render.guildwars2.com/file/19296379D120EF9FF10EE0B0CDD7711DA5E7A9AF/3122347.png" },
  { label: "Relic of Febe",                icon: "https://render.guildwars2.com/file/3B063D0B0BA20A0530086595F367F0149D9679F2/3187628.png" },
  { label: "Relic of Fireworks",           icon: "https://render.guildwars2.com/file/2999CCF7C94267B2EE3DDA7459050864622927C9/3122349.png" },
  { label: "Relic of Isgarren",            icon: "https://render.guildwars2.com/file/5FB808F04E427650A84031E46B632DC292A3583F/3122354.png" },
  { label: "Relic of Karakosa",            icon: "https://render.guildwars2.com/file/DD034A0B53355503350F07CCFFE5CC06A90F41D9/3187629.png" },
  { label: "Relic of Leadership",          icon: "https://render.guildwars2.com/file/077C30D957D30B0D282BB21199A193A2D74971DF/3122356.png" },
  { label: "Relic of Lyhr",               icon: "https://render.guildwars2.com/file/FE580A90C9E4513D062A148045F933C7F3C557E3/3122357.png" },
  { label: "Relic of Mabon",              icon: "https://render.guildwars2.com/file/49481C31650D384B68A1BFB53DC1A39F2AE4AD56/3122358.png" },
  { label: "Relic of Mercy",              icon: "https://render.guildwars2.com/file/1AA33B5654D3E7F91B9065BA6D0F1EB6AA755AFF/3122359.png" },
  { label: "Relic of Nayos",              icon: "https://render.guildwars2.com/file/EA382BAFD541080F71D5530893CC7E069165EA0C/3187631.png" },
  { label: "Relic of Nourys",             icon: "https://render.guildwars2.com/file/9B47CEBB551B7C5E7A961AB45361E292074E0823/3187632.png" },
  { label: "Relic of Peitha",             icon: "https://render.guildwars2.com/file/949A6A4179F514FCDEF3AC3D9C292B38D5E0047D/3122365.png" },
  { label: "Relic of Resistance",         icon: "https://render.guildwars2.com/file/C3A39C916063067E190EE5D42D6CAC2018385F44/3122367.png" },
  { label: "Relic of Speed",              icon: "https://render.guildwars2.com/file/15B07C1813B63DFD27A6A8A5E36CF1BC50DB0562/3122369.png" },
  { label: "Relic of Surging",            icon: "https://render.guildwars2.com/file/755D9F3BA1C2C42CDAEBF59BBF4564B77ADC105D/3592840.png" },
  { label: "Relic of Vampirism",          icon: "https://render.guildwars2.com/file/349D3B9098A1EB445E00C45E70B892E8CFE3762C/3592842.png" },
  { label: "Relic of Vass",               icon: "https://render.guildwars2.com/file/21D7FDF1DD4EAD33DBC01F11D80E48AD3370FDE6/3122374.png" },
  { label: "Relic of the Adventurer",     icon: "https://render.guildwars2.com/file/9A76D8C27FCAB8F66D0DC531906808B134D80EAD/3122328.png" },
  { label: "Relic of the Afflicted",      icon: "https://render.guildwars2.com/file/3B1DA625E3DF0591087E62F12E5301C1D8D6EDC0/3122329.png" },
  { label: "Relic of the Aristocracy",    icon: "https://render.guildwars2.com/file/BCC01F0B6616FE26ED4BE159532A6A6FBD0EA2D8/3122332.png" },
  { label: "Relic of the Astral Ward",    icon: "https://render.guildwars2.com/file/57A961A8ADFE279BC4F124A40CC4B5646BC8035F/3161446.png" },
  { label: "Relic of the Brawler",        icon: "https://render.guildwars2.com/file/2B5297A932F55DA3BDDD0A39C9CB0D9CF70244A1/3122334.png" },
  { label: "Relic of the Cavalier",       icon: "https://render.guildwars2.com/file/C3AFC50F654E2749ADD9033CE007033F6F9B0D7A/3122335.png" },
  { label: "Relic of the Centaur",        icon: "https://render.guildwars2.com/file/59551CFA6F4AB3D678370651ABF20D5F69B949D5/3122336.png" },
  { label: "Relic of the Chronomancer",   icon: "https://render.guildwars2.com/file/C209ABF01D7429EC09354E2E0BBF9DB14EBDD613/3122338.png" },
  { label: "Relic of the Citadel",        icon: "https://render.guildwars2.com/file/B21C5A6DFCDB0A729358A22CA76547150E7C541E/3122339.png" },
  { label: "Relic of the Daredevil",      icon: "https://render.guildwars2.com/file/29FE690460A037C7FAC3C71903BA1EBECB204012/3122341.png" },
  { label: "Relic of the Deadeye",        icon: "https://render.guildwars2.com/file/060151B961CE56CB9546E7B6AF33B0A318426372/3122342.png" },
  { label: "Relic of the Defender",       icon: "https://render.guildwars2.com/file/E854AFDE03F40ED335C0A30DE90BD9973612BD75/3122343.png" },
  { label: "Relic of the Demon Queen",    icon: "https://render.guildwars2.com/file/D0C6F322473F2A0F6C65FBD3B21733777BB14015/3187627.png" },
  { label: "Relic of the Dragonhunter",   icon: "https://render.guildwars2.com/file/F61EEC535059F1FA027049AB4DEFCD5465405DB7/3122344.png" },
  { label: "Relic of the Earth",          icon: "https://render.guildwars2.com/file/EBB3060FF2E9A10CECC3F1B2CAC0213AE9D93337/3592833.png" },
  { label: "Relic of the Firebrand",      icon: "https://render.guildwars2.com/file/4E4F4AA81DB63D9D9BB4BF3757D0750E935701F7/3122348.png" },
  { label: "Relic of the Flock",          icon: "https://render.guildwars2.com/file/2F7AE267BA29B35DEC7F2C0FCE5C30D806E31E0D/3122350.png" },
  { label: "Relic of the Fractal",        icon: "https://render.guildwars2.com/file/B2D409644147BF18935A95A52505ABCB9EECE142/3122351.png" },
  { label: "Relic of the Golemancer",     icon: "https://render.guildwars2.com/file/13412697BB6AD89F2E6ED97A750873C0BB35AA9A/3592835.png" },
  { label: "Relic of the Herald",         icon: "https://render.guildwars2.com/file/DE62250A48F802DD09A1FAFF0D2BA804EA29A3B9/3122352.png" },
  { label: "Relic of the Holosmith",      icon: "https://render.guildwars2.com/file/0976F60805023D2F14DA6CC72F55F3D64407C7AF/3592836.png" },
  { label: "Relic of the Ice",            icon: "https://render.guildwars2.com/file/5E0E012F921D3D5D364BFEFC04D7BEF1DC5B52F7/3122353.png" },
  { label: "Relic of the Krait",          icon: "https://render.guildwars2.com/file/645EFCBFFBB7B1C6630CBB7C0FB268CA27B703AC/3122355.png" },
  { label: "Relic of the Lich",           icon: "https://render.guildwars2.com/file/045D16259918EFA90A76B4D1B1400AA8D9CC0D4B/3592837.png" },
  { label: "Relic of the Midnight King",  icon: "https://render.guildwars2.com/file/C0602C3D27B10AC815D4B9F0DF0E4C3D23D12E9F/3187630.png" },
  { label: "Relic of the Mirage",         icon: "https://render.guildwars2.com/file/5FCA620E77D3D5022ADC70C1191F0B154AB13827/3122360.png" },
  { label: "Relic of the Monk",           icon: "https://render.guildwars2.com/file/6C340014C525FEF8089AC6DAD03662637A5B07CA/3122361.png" },
  { label: "Relic of the Necromancer",    icon: "https://render.guildwars2.com/file/B20C589B0915915F5AB55BDA6EC52670B29706F2/3122362.png" },
  { label: "Relic of the Nightmare",      icon: "https://render.guildwars2.com/file/74940C36779745CBA9DDD56CDF6CBAC1CEA8179F/3122363.png" },
  { label: "Relic of the Ogre",           icon: "https://render.guildwars2.com/file/633231B05DC3D1D44003DAA891400C4624180D17/3592838.png" },
  { label: "Relic of the Pack",           icon: "https://render.guildwars2.com/file/26503D1FF7BA354058789E371992A7500B3AA89B/3122364.png" },
  { label: "Relic of the Privateer",      icon: "https://render.guildwars2.com/file/9CE01CF33B943BCC3FABD8491073DE0AD63F340C/3592839.png" },
  { label: "Relic of the Reaper",         icon: "https://render.guildwars2.com/file/AFDAA23D3C61F202225DDFA7C17F420C5368BBB8/3122366.png" },
  { label: "Relic of the Scourge",        icon: "https://render.guildwars2.com/file/0802B36898A6EB0C77D20FD4F3DFD0A2270A3ECD/3122368.png" },
  { label: "Relic of the Sunless",        icon: "https://render.guildwars2.com/file/CEF1E6DA2DBF143661DF26E668034A621812B61A/3122370.png" },
  { label: "Relic of the Thief",          icon: "https://render.guildwars2.com/file/3523AC08EB04347CF371E9A91F4B985D12FB4ED3/3122371.png" },
  { label: "Relic of the Trooper",        icon: "https://render.guildwars2.com/file/500CB9B12FED6948EB74FAF299726007002BDFBA/3122372.png" },
  { label: "Relic of the Unseen Invasion",icon: "https://render.guildwars2.com/file/0CAF5ACE9D4ABEFF3EF2DE0DB47D57A8AB3CABB3/3122373.png" },
  { label: "Relic of the Warrior",        icon: "https://render.guildwars2.com/file/1D3CF82C05450A605921F6EB9D0AC23421C9CFA5/3122375.png" },
  { label: "Relic of the Water",          icon: "https://render.guildwars2.com/file/A202CF0CF4314C049B16A89A595CCC9534B0A90E/3122376.png" },
  { label: "Relic of the Weaver",         icon: "https://render.guildwars2.com/file/12997110B0509463DD9F1364A92493B2C4309BE1/3122377.png" },
  { label: "Relic of the Wizard's Tower", icon: "https://render.guildwars2.com/file/0C0EE407B9DAA44438ED6C2DCDA4EEB30953DF1B/3122378.png" },
  { label: "Relic of the Zephyrite",      icon: "https://render.guildwars2.com/file/070E32046C250E32DA76F2CBDFC504D6C0AB0344/3122379.png" },
  { label: "Relic of Atrocity",          icon: "https://render.guildwars2.com/file/F1F3033EA7780C093A651253ACB92E415C0525F6/3375218.png" },
  { label: "Relic of Mosyn",             icon: "https://render.guildwars2.com/file/CAB064E2F11609D2309E356062BA93107F9F605E/3302017.png" },
  { label: "Relic of Rivers",            icon: "https://render.guildwars2.com/file/08DED07BF6DF37E69A08D1C49D9C45D81BD8A5CA/3255567.png" },
  { label: "Relic of Zakiros",           icon: "https://render.guildwars2.com/file/5A5B5D3A4D9DD01F0A115030270A0A6EA353CC65/3302021.png" },
  { label: "Relic of the Blightbringer", icon: "https://render.guildwars2.com/file/286C60AC6FA239B0070293039091A44476A35E90/3375219.png" },
  { label: "Relic of the Founding",      icon: "https://render.guildwars2.com/file/FD9FE6B8CBBD44132D6DBCA7C2E92CF4C69D6EDC/3302016.png" },
  { label: "Relic of the Sorcerer",      icon: "https://render.guildwars2.com/file/AC943ADC1ABD046294600DDBEFE8636FF90C4EEF/3302018.png" },
  { label: "Relic of the Stormsinger",   icon: "https://render.guildwars2.com/file/53B8A123D07CC679364EF4CF4BD7537624320919/3375223.png" },
  { label: "Relic of the Twin Generals", icon: "https://render.guildwars2.com/file/CCEC5A2802D7B7D6C891EA730B5733ADD912B902/3302019.png" },
  { label: "Relic of the Wayfinder",     icon: "https://render.guildwars2.com/file/7D28503433AD96CEA902BBCD0411C9BE1D2505F4/3302020.png" },
  { label: "Relic of Agony",            icon: "https://render.guildwars2.com/file/7060CF69EFEB7A99150F2F1A7E0E1F1D2D9ED0D2/3629395.png" },
  { label: "Relic of Altruism",         icon: "https://render.guildwars2.com/file/DA14C9FCAB15E43203F1FEEBE432C3B3FBAB00DD/3592831.png" },
  { label: "Relic of Bava Nisos",       icon: "https://render.guildwars2.com/file/213C437140552326BD633D1AFF150B48DF2EB544/3629396.png" },
  { label: "Relic of Bloodstone",       icon: "https://render.guildwars2.com/file/A7327A7EDB4705EA05261110526D72AFEAF7DAB4/3629397.png" },
  { label: "Relic of Castora",          icon: "https://render.guildwars2.com/file/349EA123E7D870C4199AB268250973FAEC0ADC94/3709379.png" },
  { label: "Relic of Fire",             icon: "https://render.guildwars2.com/file/00E5051DCC0EDD58395DF9CEA3456466EA4FD347/3592834.png" },
  { label: "Relic of Fog",              icon: "https://render.guildwars2.com/file/F31809ABA515534B10E7D8B90DDC513DD311A5D6/3745066.png" },
  { label: "Relic of Geysers",          icon: "https://render.guildwars2.com/file/CEDCA7097F41AD0715322E440ABDCE1E6FF49178/3441971.png" },
  { label: "Relic of Mistburn",         icon: "https://render.guildwars2.com/file/FFCB62CF19806066D21C0EA1BA43986C0DA2B6F3/3629399.png" },
  { label: "Relic of Mount Balrior",    icon: "https://render.guildwars2.com/file/49A8520BDB6C5A7BA90832DB9406677473A6932F/3441973.png" },
  { label: "Relic of Reunification",    icon: "https://render.guildwars2.com/file/DDC5C072A8E0566CFFF1200404E529DADCD27CF3/3441974.png" },
  { label: "Relic of Shackles",         icon: "https://render.guildwars2.com/file/7946A50DBDC2E45E004AAA801904015C50CC22B3/3745069.png" },
  { label: "Relic of Sorrow",           icon: "https://render.guildwars2.com/file/F943C04CD27C463AB167FDF49F9CCC3E27F0AD18/3375222.png" },
  { label: "Relic of Thorns",           icon: "https://render.guildwars2.com/file/B6166933459C27FE500FCC23B572A7AE2A0F4DDA/3592841.png" },
  { label: "Relic of the Alliance",     icon: "https://render.guildwars2.com/file/406F52FEEF9CC64AF45CA27C4A240A6E0E5443A2/3745064.png" },
  { label: "Relic of the Beehive",      icon: "https://render.guildwars2.com/file/0D45B8A4A1D8D7FF4BAE196091C76A961D3F9621/3441970.png" },
  { label: "Relic of the Biomancer",    icon: "https://render.guildwars2.com/file/5CF5F504B24F210BE209053D2134B89072FC4F29/3709378.png" },
  { label: "Relic of the Claw",         icon: "https://render.guildwars2.com/file/19B5DB56E495C70754A8BE3621CADC0FD7402845/3375220.png" },
  { label: "Relic of the Coral Heart",  icon: "https://render.guildwars2.com/file/5DD9D2052B2C3EF921EBE6E243580CE3A1011B2F/3745065.png" },
  { label: "Relic of the Eagle",        icon: "https://render.guildwars2.com/file/DFF4EB43AD0803F60D105658052321A0BE1AF02C/3592832.png" },
  { label: "Relic of the First Revenant", icon: "https://render.guildwars2.com/file/7DA30BCFB0E0A04A5D3DFE3D25DAF142D90E1596/3709380.png" },
  { label: "Relic of the Forest Dweller", icon: "https://render.guildwars2.com/file/DC19DA3EC27F49593B93F9042264F5DD36FED4ED/3745067.png" },
  { label: "Relic of the Living City",  icon: "https://render.guildwars2.com/file/6CAF0358FBD9DDD84AB3302E2D67329A3AA83DEC/3629398.png" },
  { label: "Relic of the Mist Stranger", icon: "https://render.guildwars2.com/file/2DA75566B948AADFAB0CCF2198F205AF9AE82031/3709381.png" },
  { label: "Relic of the Mists Tide",   icon: "https://render.guildwars2.com/file/2ADA1A4509057D7B3854EEE9149A0F45CCD0EAA2/3441972.png" },
  { label: "Relic of the Nautical Beast", icon: "https://render.guildwars2.com/file/0EE97FA7FB5DC098447AAF6401DF5A09C47B33AD/3745068.png" },
  { label: "Relic of the Phenom",       icon: "https://render.guildwars2.com/file/AD0AE5035A197220507642E1169ED55E0C58A29D/3629400.png" },
  { label: "Relic of the Pirate Queen", icon: "https://render.guildwars2.com/file/6C7D53936BFC0DFD52BACDD9A2C7F0909E424F0D/3709382.png" },
  { label: "Relic of the Scoundrel",    icon: "https://render.guildwars2.com/file/0B58A2B6F00D9657EE141001A8AA240DDBDE300D/3709383.png" },
  { label: "Relic of the Steamshrieker", icon: "https://render.guildwars2.com/file/23B0F0A5BF05E05C9F527BF7EB4962C9F49C6F42/3441975.png" },
];

export const GW2_FOOD = [
  { id: 91734, label: "Peppercorn-Crusted Sous-Vide Steak",            icon: `${_RW}/EBFB0A55087C48E905D4ED9E6BE549DA6D9560F4/2191071.png`, buff: "-10% Incoming Damage | +100 Power | +70 Ferocity" },
  { id: 91805, label: "Cilantro Lime Sous-Vide Steak",                 icon: `${_RW}/D2C00407A3FFE06251BDE9DC13525FE167ABA3E6/2191069.png`, buff: "66% Chance to Life Steal on Crit | +100 Power | +70 Precision" },
  { id: 41569, label: "Bowl of Sweet and Spicy Butternut Squash Soup", icon: `${_RW}/FD0A2497B8C711A73AE9A6020118A895091E68E5/561719.png`,   buff: "+100 Power | +70 Ferocity" },
  { id: 12469, label: "Plate of Truffle Steak Dinner",                 icon: `${_RW}/67CFD9FD4B17A44CC4EC99C2DF276CF0A46C7B0D/433658.png`,   buff: "+200 Power for 30s on Kill | +70 Ferocity" },
  { id: 12485, label: "Bowl of Fancy Potato and Leek Soup",            icon: `${_RW}/AD7A1D7FAEE6E6F3AA9061CFDC90A418633DDD5C/433672.png`,   buff: "+100 Precision | +70 Condition Damage" },
  { id: 86997, label: "Plate of Beef Rendang",                         icon: `${_RW}/ED54F2CA2B6AEAE258C90A20BB213E60956CDD13/1947191.png`,  buff: "+100 Condition Damage | +70 Expertise" },
  { id: 96578, label: "Plate of Kimchi Pancakes",                      icon: `${_RW}/D64959DDB9D89E6A4FE321EC2965B6C72B557575/2594835.png`,  buff: "+15% Increased Bleeding Duration | +70 Condition Damage" },
  { id: 91703, label: "Mint-Pear Cured Meat Flatbread",                icon: `${_RW}/F56EAF0DD0CFF41CE402282E37F20F4D22501358/2191048.png`,  buff: "+10% Outgoing Healing | +100 Condition Damage | +70 Expertise" },
  { id: 91784, label: "Clove-Spiced Pear and Cured Meat Flatbread",    icon: `${_RW}/CE437DB26797C84F9127C9D190720311EB614512/2191047.png`,  buff: "-20% Incoming Condition Duration | +100 Condition Damage | +70 Expertise" },
  { id: 91727, label: "Mint and Veggie Flatbread",                     icon: `${_RW}/FCB44856734BE45744C8B10509CF710BBBE13C7B/2191027.png`,  buff: "+10% Outgoing Healing | +100 Expertise | +70 Condition Damage" },
  { id: 68634, label: "Delicious Rice Ball",                           icon: `${_RW}/3FF95B9A7DA10501B9BA5AB7FEB24BFF65357B24/1341426.png`,  buff: "+100 Healing Power | +10% Outgoing Healing" },
  { id: 91758, label: "Eggs Benedict with Mint-Parsley Sauce",         icon: `${_RW}/247DFE7FA45A2DF9B24E5515C3BDB96D28ED213B/2191053.png`,  buff: "+10% Outgoing Healing | +100 Concentration | +70 Expertise" },
  { id: 91690, label: "Bowl of Fruit Salad with Mint Garnish",         icon: `${_RW}/1D44545301F3BB1C046898EA08D5906EB369DD0A/2191059.png`,  buff: "+10% Outgoing Healing | +100 Healing Power | +70 Concentration" },
  { id: 12471, label: "Bowl of Seaweed Salad",                         icon: `${_RW}/0D442C30D4E29832725800E22990BA111D05E0BE/219455.png`,    buff: "60% to Gain Swiftness on Kill | +5% Damage While Moving" },
];

export const GW2_UTILITY = [
  { id: 78305, label: "Superior Sharpening Stone",  icon: `${_RW}/91AC9F70D30C5E3E22635DF4F30CAFA1F6F803A0/219361.png`, buff: "Gain Power Equal to 3% of Your Precision | Gain Power Equal to 6% of Your Ferocity" },
  { id: 67530, label: "Furious Sharpening Stone",   icon: `${_RW}/91AC9F70D30C5E3E22635DF4F30CAFA1F6F803A0/219361.png`, buff: "Gain Power Equal to 3% of Your Precision | Gain Ferocity Equal to 3% of Your Precision" },
  { id: 67531, label: "Bountiful Sharpening Stone", icon: `${_RW}/91AC9F70D30C5E3E22635DF4F30CAFA1F6F803A0/219361.png`, buff: "Gain Power Equal to 6% of Your Healing Power | Gain Power Equal to 8% of Your Concentration" },
  { id: 67528, label: "Bountiful Maintenance Oil",  icon: `${_RW}/BA57FF7A052FFE37669F97A815BD28089FCFF0AD/219367.png`, buff: "Gain 0.6% Healing to Allies per 100 Healing Power | Gain 0.8% per 100 Concentration" },
  { id: 67529, label: "Furious Maintenance Oil",    icon: `${_RW}/BA57FF7A052FFE37669F97A815BD28089FCFF0AD/219367.png`, buff: "Gain Concentration Equal to 3% of Your Precision | Gain Healing Power Equal to 3% of Your Precision" },
];

export const GW2_WEAPONS_BY_ID    = new Map(GW2_WEAPONS.map((w) => [w.id, w]));
export const GW2_RELICS_BY_LABEL  = new Map(GW2_RELICS.map((r) => [r.label, r]));
export const GW2_FOOD_BY_LABEL    = new Map(GW2_FOOD.map((f) => [f.label, f]));
export const GW2_UTILITY_BY_LABEL = new Map(GW2_UTILITY.map((u) => [u.label, u]));

export const PROFESSION_CONCEPT_ART = {
  Elementalist: `${_WK}/5/5e/Elementalist_04_concept_art.png`,
  Mesmer:       `${_WK}/4/4a/Mesmer_04_concept_art.png`,
  Necromancer:  `${_WK}/4/43/Necromancer_04_concept_art.png`,
  Guardian:     `${_WK}/8/88/Guardian_04_concept_art.png`,
  Warrior:      `${_WK}/5/56/Warrior_04_concept_art.png`,
  Ranger:       `${_WK}/f/f5/Ranger_04_concept_art.png`,
  Thief:        `${_WK}/3/35/Thief_04_concept_art.png`,
  Engineer:     `${_WK}/e/e5/Engineer_04_concept_art.png`,
  Revenant:     `${_WK}/1/18/Revenant_02_concept_art.jpg`,
};

// Base HP at level 80 EXCLUDING base vitality contribution.
// Formula: totalHP = baseHP + (Vitality * 10), where base Vitality = 1000.
// High (9212): Warrior, Necromancer → 9212 + 10000 = 19212
// Medium (5922): Revenant, Engineer, Ranger, Mesmer → 5922 + 10000 = 15922
// Low (1645): Guardian, Thief, Elementalist → 1645 + 10000 = 11645
export const PROFESSION_BASE_HP = {
  Warrior: 9212, Berserker: 9212, Spellbreaker: 9212, Bladesworn: 9212, Paragon: 9212,
  Necromancer: 9212, Reaper: 9212, Scourge: 9212, Harbinger: 9212,
  Revenant: 5922, Herald: 5922, Renegade: 5922, Vindicator: 5922,
  Engineer: 5922, Scrapper: 5922, Holosmith: 5922, Mechanist: 5922,
  Ranger: 5922, Druid: 5922, Soulbeast: 5922, Untamed: 5922,
  Mesmer: 5922, Chronomancer: 5922, Mirage: 5922, Virtuoso: 5922,
  Guardian: 1645, Dragonhunter: 1645, Firebrand: 1645, Willbender: 1645,
  Thief: 1645, Daredevil: 1645, Deadeye: 1645, Specter: 1645, Antiquary: 1645,
  Elementalist: 1645, Tempest: 1645, Weaver: 1645, Catalyst: 1645,
};

export const ANTIQUARY_OFFENSIVE_ARTIFACTS = [
  76582,  // Metal Legion Guitar
  76550,  // Forged Surfer Dash
  77288,  // Mistburn Mortar
  77192,  // Summon Kryptis Turret
];
export const ANTIQUARY_DEFENSIVE_ARTIFACTS = [
  76702,  // Exalted Hammer
  76816,  // Chak Shield
  76800,  // Holo-Dancer Decoy
  76733,  // Zephyrite Sun Crystal (non-F2 slots use variant 78309 instead)
];
// Prolific Plunderer (trait 2346, tier 1): grants an additional artifact slot (F4) on each draw.
export const ANTIQUARY_PROLIFIC_PLUNDERER_TRAIT_ID = 2346;

// Ranger F1–F3 skills are pet-family-dependent. The GW2 API does not expose pet families,
// and all Ranger Profession_1–3 skills are tagged spec=55 in the API even though they apply
// to Core Ranger, Druid, and Untamed as well. This map provides the authoritative lookup.
// Keys are pet IDs; values are {p1, p2, p3} skill IDs for Profession_1/2/3 (F1/F2/F3).
// p3 is archetype-based (Ferocious/Stout/Deadly/Versatile/Supportive) — same within a family.
// p4 (Eternal Bond 59554) is Soulbeast-only and handled separately via eliteSpecId check.
// F3 (Beast skill) is determined by each pet's individual archetype, not family.
// Archetype → F3 skill: Stout=45797, Deadly=40588, Versatile=43375, Ferocious=40729, Supportive=44626
// F1/F2 are shared per family (from Ranger profession API), except newer pets with unique IDs.
export const RANGER_PET_FAMILY_SKILLS = new Map([
  // === Avian (p1: Swoop 44991, p2: 42042) ===
  [44, { p1: 44991, p2: 42042, p3: 40588 }],  // Hawk — Deadly
  [10, { p1: 44991, p2: 42042, p3: 43375 }],  // Raven — Versatile
  [32, { p1: 44991, p2: 42042, p3: 43375 }],  // White Raven — Versatile
  [30, { p1: 44991, p2: 42042, p3: 44626 }],  // Owl — Supportive
  [31, { p1: 44991, p2: 42042, p3: 40729 }],  // Eagle — Ferocious
  [72, { p1: 79203, p2: 78091, p3: 43375 }],  // Raptor Swiftwing (newer) — Versatile
  // === Ursine/Bear (p1: Bite 43136, p2: 43060) ===
  [23, { p1: 43136, p2: 43060, p3: 45797 }],  // Black Bear — Stout
  [20, { p1: 43136, p2: 43060, p3: 40588 }],  // Murellow — Deadly
  [24, { p1: 43136, p2: 43060, p3: 43375 }],  // Polar Bear — Versatile
  [25, { p1: 43136, p2: 43060, p3: 40729 }],  // Arctodus — Ferocious
  [5,  { p1: 43136, p2: 43060, p3: 44626 }],  // Brown Bear — Supportive
  // === Canine (p1: Crippling Leap 43726, p2: 42894) ===
  [8,  { p1: 43726, p2: 42894, p3: 45797 }],  // Alpine Wolf — Stout
  [29, { p1: 43726, p2: 42894, p3: 40588 }],  // Wolf — Deadly
  [4,  { p1: 43726, p2: 42894, p3: 43375 }],  // Krytan Drakehound — Versatile
  [28, { p1: 43726, p2: 42894, p3: 40729 }],  // Hyena — Ferocious
  [22, { p1: 43726, p2: 42894, p3: 44626 }],  // Fern Hound — Supportive
  // === Devourer (p1: Tail Lash 43068, p2: 41461) ===
  [6,  { p1: 43068, p2: 41461, p3: 40588 }],  // Carrion Devourer — Deadly
  [26, { p1: 43068, p2: 41461, p3: 43375 }],  // Whiptail Devourer — Versatile
  [27, { p1: 43068, p2: 41461, p3: 40729 }],  // Lashtail Devourer — Ferocious
  // === Drake (p1: Chomp 41537, p2: 41575) ===
  [18, { p1: 41537, p2: 41575, p3: 45797 }],  // Ice Drake — Stout
  [7,  { p1: 41537, p2: 41575, p3: 40588 }],  // Salamander Drake — Deadly
  [45, { p1: 41537, p2: 41575, p3: 43375 }],  // Reef Drake — Versatile
  [19, { p1: 41537, p2: 41575, p3: 40729 }],  // River Drake — Ferocious
  [12, { p1: 41537, p2: 41575, p3: 44626 }],  // Marsh Drake — Supportive
  // === Feline (p1: Bite 40625, p2: 44514) ===
  [9,  { p1: 40625, p2: 44514, p3: 45797 }],  // Snow Leopard — Stout
  [3,  { p1: 40625, p2: 44514, p3: 40588 }],  // Lynx — Deadly
  [11, { p1: 40625, p2: 44514, p3: 43375 }],  // Jaguar — Versatile
  [54, { p1: 40625, p2: 44514, p3: 43375 }],  // Cheetah — Versatile
  [47, { p1: 40625, p2: 44514, p3: 40729 }],  // Tiger — Ferocious
  [55, { p1: 40625, p2: 44514, p3: 40729 }],  // Sand Lion — Ferocious
  [1,  { p1: 40625, p2: 44514, p3: 44626 }],  // Jungle Stalker — Supportive
  [63, { p1: 40625, p2: 67382, p3: 45797 }],  // White Tiger — Stout, unique F2: Phase Pounce
  [70, { p1: 73733, p2: 73938, p3: 40729 }],  // Warclaw (newer) — Ferocious, unique F1/F2
  // === Jellyfish/aquatic (p1: Healing Cloud 43186, p2: 41837) ===
  [41, { p1: 43186, p2: 41837, p3: 40588 }],  // Blue Jellyfish — Deadly
  [43, { p1: 43186, p2: 41837, p3: 40588 }],  // Rainbow Jellyfish — Deadly
  [42, { p1: 43186, p2: 41837, p3: 43375 }],  // Red Jellyfish — Versatile
  // === Moa (p1: Harmonic Cry 44617, p2: 43548) ===
  [13, { p1: 44617, p2: 43548, p3: 45797 }],  // Blue Moa — Stout
  [15, { p1: 44617, p2: 43548, p3: 43375 }],  // Pink Moa — Versatile
  [16, { p1: 44617, p2: 43548, p3: 43375 }],  // Black Moa — Versatile
  [17, { p1: 44617, p2: 43548, p3: 40729 }],  // Red Moa — Ferocious
  [14, { p1: 44617, p2: 43548, p3: 44626 }],  // White Moa — Supportive
  // === Porcine (p1: Maul 41406, p2: 46432) ===
  [38, { p1: 41406, p2: 46432, p3: 45797 }],  // Siamoth — Stout
  [37, { p1: 41406, p2: 46432, p3: 40588 }],  // Warthog — Deadly
  [2,  { p1: 41406, p2: 46432, p3: 43375 }],  // Boar — Versatile
  [39, { p1: 41406, p2: 46432, p3: 40729 }],  // Pig — Ferocious
  [64, { p1: 0,     p2: 64882, p3: 44626 }],  // Wallow (newer) — Supportive; F1 "Vampiric Bite" missing from API
  // === Spider (p1: Entangling Web 44097, p2: 43671) ===
  [33, { p1: 44097, p2: 43671, p3: 40588 }],  // Forest Spider — Deadly
  [34, { p1: 44097, p2: 43671, p3: 43375 }],  // Jungle Spider — Versatile
  [36, { p1: 44097, p2: 43671, p3: 43375 }],  // Black Widow Spider — Versatile
  [35, { p1: 44097, p2: 43671, p3: 40729 }],  // Cave Spider — Ferocious
  // === Wyvern (p1: Tail Lash 46386, p2: Wing Buffet 41908) ===
  [48, { p1: 46386, p2: 41908, p3: 43375 }],  // Electric Wyvern — Versatile
  [51, { p1: 46386, p2: 41908, p3: 40588 }],  // Fire Wyvern — Deadly
  // === Unique pets ===
  [40, { p1: 42717, p2: 44885, p3: 45797 }],  // Armor Fish — Stout
  [21, { p1: 42797, p2: 44360, p3: 40588 }],  // Shark — Deadly
  [52, { p1: 41206, p2: 45479, p3: 40588 }],  // Bristleback — Deadly
  [61, { p1: 44384, p2: 40111, p3: 40588 }],  // Fanged Iboga — Deadly
  [69, { p1: 72851, p2: 72636, p3: 40588 }],  // Spinegazer (newer) — Deadly
  [71, { p1: 75771, p2: 75814, p3: 40588 }],  // Janthiri Bee (newer) — Deadly
  [67, { p1: 71282, p2: 70889, p3: 43375 }],  // Aether Hunter (newer) — Versatile
  [46, { p1: 42907, p2: 40255, p3: 40729 }],  // Smokescale — Ferocious
  [59, { p1: 41524, p2: 45743, p3: 40729 }],  // Rock Gazelle — Ferocious
  [68, { p1: 71499, p2: 71546, p3: 40729 }],  // Sky-Chak Striker (newer) — Ferocious
  [65, { p1: 64038, p2: 41908, p3: 40729 }],  // Phoenix (newer) — Ferocious
  [57, { p1: 43788, p2: 43701, p3: 44626 }],  // Jacaranda — Supportive
  [66, { p1: 64699, p2: 66258, p3: 44626 }],  // Siege Turtle (newer) — Supportive
]);

// Render CDN icon URLs for boons and conditions, used as fallback when fact.icon is absent.
export const BOON_CONDITION_ICONS = {
  // Boons
  Aegis:          `${_RW}/DFB4D1B50AE4D6A275B349E15B179261EE3EB0AF/102854.png`,
  Alacrity:       `${_RW}/4FDAC2113B500104121753EF7E026E45C141E94D/1938787.png`,
  Fury:           `${_RW}/96D90DF84CAFE008233DD1C2606A12C1A0E68048/102842.png`,
  Might:          `${_RW}/2FA9DF9D6BC17839BBEA14723F1C53D645DDB5E1/102852.png`,
  Protection:     `${_RW}/CD77D1FAB7B270223538A8F8ECDA1CFB044D65F4/102834.png`,
  Quickness:      `${_RW}/D4AB6401A6D6917C3D4F230764452BCCE1035B0D/1012835.png`,
  Regeneration:   `${_RW}/F69996772B9E18FD18AD0AABAB25D7E3FC42F261/102835.png`,
  Resistance:     `${_RW}/50BAC1B8E10CFAB9E749A5D910D4A9DCF29EBB7C/961398.png`,
  Resolution:     `${_RW}/D104A6B9344A2E2096424A3C300E46BC2926E4D7/2440718.png`,
  Stability:      `${_RW}/3D3A1C2D6D791C05179AB871902D28782C65C244/415959.png`,
  Swiftness:      `${_RW}/20CFC14967E67F7A3FD4A4B8722B4CF5B8565E11/102836.png`,
  Vigor:          `${_RW}/58E92EBAF0DB4DA7C4AC04D9B22BCA5ECF0100DE/102843.png`,
  // Conditions
  Bleeding:       `${_RW}/79FF0046A5F9ADA3B4C4EC19ADB4CB124D5F0021/102848.png`,
  Blinded:        `${_RW}/09770136BB76FD0DBE1CC4267DEED54774CB20F6/102837.png`,
  Burning:        `${_RW}/B47BF5803FED2718D7474EAF9617629AD068EE10/102849.png`,
  Chilled:        `${_RW}/28C4EC547A3516AF0242E826772DA43A5EAC3DF3/102839.png`,
  Confusion:      `${_RW}/289AA0A4644F0E044DED3D3F39CED958E1DDFF53/102880.png`,
  Crippled:       `${_RW}/070325E519C178D502A8160523766070D30C0C19/102838.png`,
  Fear:           `${_RW}/30307A6E766D74B6EB09EDA12A4A2DE50E4D76F4/102869.png`,
  Immobile:       `${_RW}/397A613651BFCA2832B6469CE34735580A2C120E/102844.png`,
  Poisoned:       `${_RW}/559B0AF9FB5E1243D2649FAAE660CCB338AACC19/102840.png`,
  Slow:           `${_RW}/F60D1EF5271D7B9319610855676D320CD25F01C6/961397.png`,
  Taunt:          `${_RW}/02EED459AD65FAF7DF32A260E479C625070841B9/1228472.png`,
  Torment:        `${_RW}/10BABF2708CA3575730AC662A2E72EC292565B08/598887.png`,
  Vulnerability:  `${_RW}/3A394C1A0A3257EB27A44842DDEEF0DF000E1241/102850.png`,
  Weakness:       `${_RW}/6CB0E64AF9AA292E332A38C1770CE577E2CDE0E8/102853.png`,
  // Wiki spelling variants of standard conditions
  Blind:          `${_RW}/09770136BB76FD0DBE1CC4267DEED54774CB20F6/102837.png`,
  Cripple:        `${_RW}/070325E519C178D502A8160523766070D30C0C19/102838.png`,
  Chill:          `${_RW}/28C4EC547A3516AF0242E826772DA43A5EAC3DF3/102839.png`,
  Immobilize:     `${_RW}/397A613651BFCA2832B6469CE34735580A2C120E/102844.png`,
  Immobilized:    `${_RW}/397A613651BFCA2832B6469CE34735580A2C120E/102844.png`,
  Poison:         `${_RW}/559B0AF9FB5E1243D2649FAAE660CCB338AACC19/102840.png`,
};

// Fact types where the icon represents the boon/condition being applied.
export const BUFF_FACT_TYPES = new Set(["Buff", "ApplyBuffCondition", "PrefixedBuff"]);

// Assumed boon stat effects (per GW2 wiki, level 80)
export const MIGHT_POWER_PER_STACK = 30;
export const MIGHT_CONDI_PER_STACK = 30;
export const MIGHT_MAX_STACKS = 25;
export const FURY_CRIT_CHANCE = 25; // percentage points
export const STABILITY_MAX_STACKS = 25;

// Attribute-stacking sigils (only one can be active at a time in-game)
export const STACKING_SIGIL_DEFS = [
  { id: 24575, key: "sigilBloodlust", label: "Bloodlust", stat: "Power", perStack: 10, maxStacks: 25 },
  { id: 24578, key: "sigilCorruption", label: "Corruption", stat: "ConditionDamage", perStack: 10, maxStacks: 25 },
  { id: 24582, key: "sigilLife", label: "Life", stat: "HealingPower", perStack: 10, maxStacks: 25 },
  { id: 24580, key: "sigilPerception", label: "Perception", stat: "Precision", perStack: 10, maxStacks: 25 },
];
export const STACKING_SIGIL_IDS = new Set(STACKING_SIGIL_DEFS.map((d) => d.id));

export const BOON_NAMES = new Set([
  "Aegis", "Alacrity", "Fury", "Might", "Protection", "Quickness",
  "Regeneration", "Resistance", "Resolution", "Stability", "Swiftness", "Vigor",
]);

export const CONDITION_NAMES = new Set([
  "Bleeding", "Blind", "Blinded", "Burning", "Chill", "Chilled",
  "Confusion", "Cripple", "Crippled", "Fear", "Immobile", "Immobilize", "Immobilized",
  "Poison", "Poisoned", "Slow", "Taunt", "Torment",
  "Vulnerability", "Weakness",
]);

export const CONDITION_NAME_NORMALIZE = {
  Blind: "Blinded", Chill: "Chilled", Cripple: "Crippled",
  Immobilize: "Immobile", Immobilized: "Immobile", Poison: "Poisoned",
};

export const BOON_DISPLAY_ORDER = [
  "Aegis", "Alacrity", "Fury", "Might", "Protection", "Quickness",
  "Regeneration", "Resistance", "Resolution", "Stability", "Swiftness", "Vigor",
];

// Fallback icons keyed by GW2 API fact type, for facts missing fact.icon.
// Icons sourced from render.guildwars2.com via /v2/skills API responses.
export const FACT_TYPE_ICONS = {
  Damage:              `${_RW}/61AA4919C4A7990903241B680A69530121E994C7/156657.png`,
  Range:               `${_RW}/0AAB34BEB1C9F4A25EC612DDBEACF3E20B2810FA/156666.png`,
  Number:              `${_RW}/BBE8191A494B0352259C10EADFDACCE177E6DA5B/1770208.png`,
  Duration:            `${_RW}/7B2193ACCF77E56C13E608191B082D68AA0FAA71/156659.png`,
  Time:                `${_RW}/7B2193ACCF77E56C13E608191B082D68AA0FAA71/156659.png`,
  Recharge:            `${_RW}/D767B963D120F077C3B163A05DC05A7317D7DB70/156651.png`,
  Radius:              `${_RW}/B0CD8077991E4FB1622D2930337ED7F9B54211D5/156665.png`,
  Distance:            `${_RW}/B0CD8077991E4FB1622D2930337ED7F9B54211D5/156665.png`,
  StunBreak:           `${_RW}/DCF0719729165FD8910E034CA4E0780F90582D15/156654.png`,
  Unblockable:         `${_RW}/9352ED3244417304995F26CB01AE76BB7E547052/156661.png`,
  AttributeAdjust:     `${_RW}/D4347C52157B040943051D7E09DEAD7AF63D4378/156662.png`,
  AttributeConversion: `${_RW}/D4347C52157B040943051D7E09DEAD7AF63D4378/156662.png`,
  ComboFinisher:       `${_RW}/A513F3653D33FBA4220D2D307799F8A327A36A3B/156656.png`,
  ComboField:          `${_RW}/59E0DB6A699810641C959926ADFEF73E08CC255B/156655.png`,
  Percent:             `${_RW}/0AAB34BEB1C9F4A25EC612DDBEACF3E20B2810FA/156666.png`,
  // Generic fallback for Buff/condition types with unknown status names
  Buff:                `${_RW}/2FA9DF9D6BC17839BBEA14723F1C53D645DDB5E1/102852.png`,
  ApplyBuffCondition:  `${_RW}/2FA9DF9D6BC17839BBEA14723F1C53D645DDB5E1/102852.png`,
  PrefixedBuff:        `${_RW}/2FA9DF9D6BC17839BBEA14723F1C53D645DDB5E1/102852.png`,
};
