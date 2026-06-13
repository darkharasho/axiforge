// Weapon type icons from gw2-class-icons package.
// Imported as raw SVG strings via Vite's ?raw suffix.
import Axe        from "gw2-class-icons/weapons/svg/Axe.svg?raw";
import Dagger     from "gw2-class-icons/weapons/svg/Dagger.svg?raw";
import Focus      from "gw2-class-icons/weapons/svg/Focus.svg?raw";
import Greatsword from "gw2-class-icons/weapons/svg/Greatsword.svg?raw";
import Hammer     from "gw2-class-icons/weapons/svg/Hammer.svg?raw";
import HarpoonGun from "gw2-class-icons/weapons/svg/HarpoonGun.svg?raw";
import Longbow    from "gw2-class-icons/weapons/svg/Longbow.svg?raw";
import Mace       from "gw2-class-icons/weapons/svg/Mace.svg?raw";
import Pistol     from "gw2-class-icons/weapons/svg/Pistol.svg?raw";
import Rifle      from "gw2-class-icons/weapons/svg/Rifle.svg?raw";
import Scepter    from "gw2-class-icons/weapons/svg/Scepter.svg?raw";
import Shield     from "gw2-class-icons/weapons/svg/Shield.svg?raw";
import ShortBow   from "gw2-class-icons/weapons/svg/ShortBow.svg?raw";
import Spear      from "gw2-class-icons/weapons/svg/Spear.svg?raw";
import Staff      from "gw2-class-icons/weapons/svg/Staff.svg?raw";
import Sword      from "gw2-class-icons/weapons/svg/Sword.svg?raw";
import Torch      from "gw2-class-icons/weapons/svg/Torch.svg?raw";
import Trident    from "gw2-class-icons/weapons/svg/Trident.svg?raw";
import Warhorn    from "gw2-class-icons/weapons/svg/Warhorn.svg?raw";

// Keyed by GW2_WEAPONS_BY_ID weapon IDs
const WEAPON_SVG_MAP = {
  axe: Axe,
  dagger: Dagger,
  focus: Focus,
  greatsword: Greatsword,
  hammer: Hammer,
  harpoon: HarpoonGun,
  longbow: Longbow,
  mace: Mace,
  pistol: Pistol,
  rifle: Rifle,
  scepter: Scepter,
  shield: Shield,
  shortbow: ShortBow,
  spear: Spear,
  staff: Staff,
  sword: Sword,
  torch: Torch,
  trident: Trident,
  warhorn: Warhorn,
};

/**
 * Returns the raw SVG string for a weapon type ID, or null if unknown.
 * @param {string} weaponId — e.g. "sword", "axe", "staff" (matches GW2_WEAPONS_BY_ID keys)
 */
export function getWeaponSvg(weaponId) {
  return WEAPON_SVG_MAP[weaponId] ?? null;
}
