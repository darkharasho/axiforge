// Equipment slot SVG icons from gw2-class-icons package.
// Provides inline SVG strings for armor, weapon, and trinket slots.

// ─── Armor SVGs (by weight class) ────────────────────────────────────────────
import LightHelm      from "gw2-class-icons/armor/svg/light-helm.svg?raw";
import LightPauldrons from "gw2-class-icons/armor/svg/light-pauldrons.svg?raw";
import LightChest     from "gw2-class-icons/armor/svg/light-chest.svg?raw";
import LightGloves    from "gw2-class-icons/armor/svg/light-gloves.svg?raw";
import LightLeggings  from "gw2-class-icons/armor/svg/light-leggings.svg?raw";
import LightBoots     from "gw2-class-icons/armor/svg/light-boots.svg?raw";

import MediumHead     from "gw2-class-icons/armor/svg/medium-headgear.svg?raw";
import MediumShoulders from "gw2-class-icons/armor/svg/medium-shoulders.svg?raw";
import MediumChest    from "gw2-class-icons/armor/svg/medium-chest.svg?raw";
import MediumGloves   from "gw2-class-icons/armor/svg/medium-gloves.svg?raw";
import MediumLeggings from "gw2-class-icons/armor/svg/medium-leggings.svg?raw";
import MediumBoots    from "gw2-class-icons/armor/svg/medium-boots.svg?raw";

import HeavyHead      from "gw2-class-icons/armor/svg/heavy-headgear.svg?raw";
import HeavyShoulders from "gw2-class-icons/armor/svg/heavy-shoulders.svg?raw";
import HeavyChest     from "gw2-class-icons/armor/svg/heavy-chest.svg?raw";
import HeavyGloves    from "gw2-class-icons/armor/svg/heavy-gloves.svg?raw";
import HeavyLeggings  from "gw2-class-icons/armor/svg/heavy-leggings.svg?raw";
import HeavyBoots     from "gw2-class-icons/armor/svg/heavy-boots.svg?raw";

// ─── Trinket SVGs ────────────────────────────────────────────────────────────
import Backpack from "gw2-class-icons/trinkets/svg/backpack.svg?raw";
import Amulet   from "gw2-class-icons/trinkets/svg/amulet.svg?raw";
import Ring     from "gw2-class-icons/trinkets/svg/ring.svg?raw";
import Earring  from "gw2-class-icons/trinkets/svg/earring.svg?raw";

const ARMOR_SVGS = {
  light:  { head: LightHelm, shoulders: LightPauldrons, chest: LightChest, hands: LightGloves, legs: LightLeggings, feet: LightBoots, breather: LightHelm },
  medium: { head: MediumHead, shoulders: MediumShoulders, chest: MediumChest, hands: MediumGloves, legs: MediumLeggings, feet: MediumBoots, breather: MediumHead },
  heavy:  { head: HeavyHead, shoulders: HeavyShoulders, chest: HeavyChest, hands: HeavyGloves, legs: HeavyLeggings, feet: HeavyBoots, breather: HeavyHead },
};

const TRINKET_SVGS = {
  back: Backpack,
  amulet: Amulet,
  ring1: Ring,
  ring2: Ring,
  accessory1: Earring,
  accessory2: Earring,
};

/**
 * Returns the raw SVG string for an equipment slot, or null if unknown.
 * @param {string} slotKey — e.g. "head", "mainhand1", "ring1"
 * @param {string} armorWeight — "light", "medium", or "heavy"
 */
export function getSlotSvg(slotKey, armorWeight) {
  // Armor slots
  const armorSvg = ARMOR_SVGS[armorWeight]?.[slotKey];
  if (armorSvg) return armorSvg;

  // Trinket slots
  const trinketSvg = TRINKET_SVGS[slotKey];
  if (trinketSvg) return trinketSvg;

  return null;
}
