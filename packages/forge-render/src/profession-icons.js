// Profession and elite-spec class icons from gw2-class-icons package.
// Imported as raw SVG strings via Vite's ?raw suffix.
// The package's index.js is Node-only (uses fs.readdirSync) — we bypass it entirely.
import Amalgam      from "gw2-class-icons/wiki/svg/Amalgam.svg?raw";
import Antiquary    from "gw2-class-icons/wiki/svg/Antiquary.svg?raw";
import Berserker    from "gw2-class-icons/wiki/svg/Berserker.svg?raw";
import Bladesworn   from "gw2-class-icons/wiki/svg/Bladesworn.svg?raw";
import Catalyst     from "gw2-class-icons/wiki/svg/Catalyst.svg?raw";
import Chronomancer from "gw2-class-icons/wiki/svg/Chronomancer.svg?raw";
import Conduit      from "gw2-class-icons/wiki/svg/Conduit.svg?raw";
import Daredevil    from "gw2-class-icons/wiki/svg/Daredevil.svg?raw";
import Deadeye      from "gw2-class-icons/wiki/svg/Deadeye.svg?raw";
import Dragonhunter from "gw2-class-icons/wiki/svg/Dragonhunter.svg?raw";
import Druid        from "gw2-class-icons/wiki/svg/Druid.svg?raw";
import Elementalist from "gw2-class-icons/wiki/svg/Elementalist.svg?raw";
import Engineer     from "gw2-class-icons/wiki/svg/Engineer.svg?raw";
import Evoker       from "gw2-class-icons/wiki/svg/Evoker.svg?raw";
import Firebrand    from "gw2-class-icons/wiki/svg/Firebrand.svg?raw";
import Galeshot     from "gw2-class-icons/wiki/svg/Galeshot.svg?raw";
import Guardian     from "gw2-class-icons/wiki/svg/Guardian.svg?raw";
import Harbinger    from "gw2-class-icons/wiki/svg/Harbinger.svg?raw";
import Herald       from "gw2-class-icons/wiki/svg/Herald.svg?raw";
import Holosmith    from "gw2-class-icons/wiki/svg/Holosmith.svg?raw";
import Luminary     from "gw2-class-icons/wiki/svg/Luminary.svg?raw";
import Mechanist    from "gw2-class-icons/wiki/svg/Mechanist.svg?raw";
import Mesmer       from "gw2-class-icons/wiki/svg/Mesmer.svg?raw";
import Mirage       from "gw2-class-icons/wiki/svg/Mirage.svg?raw";
import Necromancer  from "gw2-class-icons/wiki/svg/Necromancer.svg?raw";
import Paragon      from "gw2-class-icons/wiki/svg/Paragon.svg?raw";
import Ranger       from "gw2-class-icons/wiki/svg/Ranger.svg?raw";
import Reaper       from "gw2-class-icons/wiki/svg/Reaper.svg?raw";
import Renegade     from "gw2-class-icons/wiki/svg/Renegade.svg?raw";
import Revenant     from "gw2-class-icons/wiki/svg/Revenant.svg?raw";
import Ritualist    from "gw2-class-icons/wiki/svg/Ritualist.svg?raw";
import Scourge      from "gw2-class-icons/wiki/svg/Scourge.svg?raw";
import Scrapper     from "gw2-class-icons/wiki/svg/Scrapper.svg?raw";
import Soulbeast    from "gw2-class-icons/wiki/svg/Soulbeast.svg?raw";
import Specter      from "gw2-class-icons/wiki/svg/Specter.svg?raw";
import Spellbreaker from "gw2-class-icons/wiki/svg/Spellbreaker.svg?raw";
import Tempest      from "gw2-class-icons/wiki/svg/Tempest.svg?raw";
import Thief        from "gw2-class-icons/wiki/svg/Thief.svg?raw";
import Troubadour   from "gw2-class-icons/wiki/svg/Troubadour.svg?raw";
import Untamed      from "gw2-class-icons/wiki/svg/Untamed.svg?raw";
import Vindicator   from "gw2-class-icons/wiki/svg/Vindicator.svg?raw";
import Virtuoso     from "gw2-class-icons/wiki/svg/Virtuoso.svg?raw";
import Warrior      from "gw2-class-icons/wiki/svg/Warrior.svg?raw";
import Weaver       from "gw2-class-icons/wiki/svg/Weaver.svg?raw";
import Willbender   from "gw2-class-icons/wiki/svg/Willbender.svg?raw";

const SVG_MAP = {
  Amalgam, Antiquary, Berserker, Bladesworn, Catalyst, Chronomancer, Conduit,
  Daredevil, Deadeye, Dragonhunter, Druid, Elementalist, Engineer, Evoker,
  Firebrand, Galeshot, Guardian, Harbinger, Herald, Holosmith, Luminary,
  Mechanist, Mesmer, Mirage, Necromancer, Paragon, Ranger, Reaper, Renegade,
  Revenant, Ritualist, Scourge, Scrapper, Soulbeast, Specter, Spellbreaker,
  Tempest, Thief, Troubadour, Untamed, Vindicator, Virtuoso, Warrior, Weaver,
  Willbender,
};

/**
 * Every profession and elite-spec name getProfessionSvg can resolve, sorted.
 * Used by the notes editor to offer class icons as @ mentions.
 */
export const PROFESSION_ICON_NAMES = Object.keys(SVG_MAP).sort();

/**
 * Returns the raw SVG string for a profession or elite spec name, or null if unknown.
 * @param {string} name — e.g. "Guardian", "Dragonhunter", "Elementalist"
 */
export function getProfessionSvg(name) {
  return SVG_MAP[name] ?? null;
}

const LINE_COLORS = {
  red:  "#d63a3a",
  blue: "#3a8fd6",
};

const _colorCache = new Map();

/**
 * Returns the raw SVG with non-black fills replaced by the given line color.
 * "normal" (or falsy) returns the original SVG unchanged.
 */
export function getProfessionSvgColored(name, color) {
  const svg = SVG_MAP[name] ?? null;
  if (!svg || !color || color === "normal") return svg;
  const hex = LINE_COLORS[color];
  if (!hex) return svg;
  const key = `${name}_${color}`;
  let cached = _colorCache.get(key);
  if (!cached) {
    cached = svg.replace(/fill:#(?!000000)[0-9a-fA-F]{6}/gi, `fill:${hex}`);
    _colorCache.set(key, cached);
  }
  return cached;
}
