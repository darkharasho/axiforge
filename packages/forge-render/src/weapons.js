// GW2 weapon catalog — ids, display labels, hand slots, and wiki icons.
// Extracted from src/renderer/modules/constants.js so the renderers are
// self-contained.
const _WK = "https://wiki.guildwars2.com/images";

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

export const GW2_WEAPONS_BY_ID = new Map(GW2_WEAPONS.map((w) => [w.id, w]));
