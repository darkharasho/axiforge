// Shared build display helpers — extracted from comp-detail.js for reuse.

import { getProfessionSvg, getProfessionSvgColored } from "./profession-icons.js";

export function getEliteSpecName(build) {
  if (!build.specializations) return null;
  for (const s of build.specializations) {
    if (s.elite && s.name) return s.name;
  }
  return null;
}

export function getSpecIcon(build) {
  const eliteSpec = getEliteSpecName(build);
  const name = eliteSpec || build.profession;
  if (!name) return "";
  return getProfessionSvg(name) || "";
}

export function getSpecIconColored(build, color) {
  const eliteSpec = getEliteSpecName(build);
  const name = eliteSpec || build.profession;
  if (!name) return "";
  return getProfessionSvgColored(name, color) || "";
}

export function profClass(profession) {
  if (!profession) return "";
  return `lib-prof--${profession.toLowerCase()}`;
}

export function getDisplayName(build) {
  const elite = getEliteSpecName(build);
  return build.title || elite || build.profession || "Untitled";
}

export function resolveStatPackage(build) {
  const pkg = build.equipment?.statPackage || "";
  if (pkg && !/^\d+$/.test(pkg)) return pkg;

  const slots = build.equipment?.slots;
  if (slots && typeof slots === "object") {
    const counts = {};
    for (const v of Object.values(slots)) {
      if (v && typeof v === "string") counts[v] = (counts[v] || 0) + 1;
    }
    let best = "";
    let bestCount = 0;
    for (const [label, count] of Object.entries(counts)) {
      if (count > bestCount) { best = label; bestCount = count; }
    }
    if (best) return best;
  }

  return "";
}

export function getRuneName(build, upgradeCatalog) {
  const runes = build.equipment?.runes;
  if (!runes || typeof runes !== "object") return "";
  const counts = {};
  for (const v of Object.values(runes)) {
    if (v) counts[String(v)] = (counts[String(v)] || 0) + 1;
  }
  let bestId = "";
  let bestCount = 0;
  for (const [id, count] of Object.entries(counts)) {
    if (count > bestCount) { bestId = id; bestCount = count; }
  }
  if (!bestId) return "";

  const runeDef = upgradeCatalog?.runeById?.get(Number(bestId));
  if (runeDef?.name) {
    return runeDef.name.replace(/^(?:Superior|Major|Minor) Rune of (?:the )?/i, "");
  }

  return /^\d+$/.test(bestId) ? "" : bestId;
}
