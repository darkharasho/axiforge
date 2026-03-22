/**
 * Parse rendered wiki fact text into structured fact objects.
 *
 * The GW2 wiki renders facts in the blockquote as rows like:
 *   "Damage: 269 (0.666)"
 *   "Burning (1s): 131 Damage"
 *   "Number of Targets: 3"
 *
 * This module takes the fact name (from the <a> link text) and the
 * remaining text (value portion) and returns a structured fact object
 * compatible with splits.json format for comparison.
 */

const KNOWN_BUFFS = new Set([
  "might", "fury", "quickness", "alacrity", "swiftness", "vigor", "regeneration",
  "protection", "resolution", "resistance", "stability", "aegis", "retaliation",
  "stealth", "superspeed", "revealed",
]);

const KNOWN_CONDITIONS = new Set([
  "bleeding", "burning", "confusion", "poison", "torment", "vulnerability",
  "weakness", "crippled", "chilled", "blinded", "immobile", "slow", "fear",
  "taunt", "daze", "stun", "knockdown", "knockback", "float", "pull", "sink",
]);

function isBuffOrCondition(name) {
  return KNOWN_BUFFS.has(name.toLowerCase()) || KNOWN_CONDITIONS.has(name.toLowerCase());
}

/**
 * @param {string} name  — the fact label (e.g. "Damage", "Fury", "Radius")
 * @param {string} value — the text after the label (e.g. "269 (0.666)", "4 s")
 * @returns {object|null} structured fact object or null if unparseable
 */
function parseFactText(name, value) {
  const nameLower = name.toLowerCase().trim();
  const val = (value || "").trim();

  // ── Damage ──
  if (nameLower === "damage") {
    return parseDamageFact(name, val);
  }

  // ── Healing ──
  if (nameLower === "healing") {
    return parseHealingFact(name, val);
  }

  // ── Recharge ──
  if (nameLower === "recharge" || nameLower === "recharge time") {
    const num = parseFloat(val);
    return !isNaN(num) ? { type: "Recharge", text: name, value: num } : null;
  }

  // ── Radius ──
  if (nameLower === "radius" || nameLower === "blast radius" || nameLower === "healing radius") {
    const num = parseInt(val, 10);
    return !isNaN(num) ? { type: "Radius", text: name, distance: num } : null;
  }

  // ── Range ──
  if (nameLower === "range") {
    const num = parseInt(val, 10);
    return !isNaN(num) ? { type: "Range", text: name, value: num } : null;
  }

  // ── Buffs and conditions ──
  if (isBuffOrCondition(name)) {
    return parseBuffFact(name, val);
  }

  // ── Number of targets, conditions removed, etc. ──
  if (nameLower === "number of targets" || nameLower === "conditions removed") {
    const num = parseInt(val, 10);
    return !isNaN(num) ? { type: "Number", text: name, value: num } : null;
  }

  // ── Percent ──
  const pctMatch = val.match(/^([\d.]+)\s*%/);
  if (pctMatch) {
    return { type: "Percent", text: name, percent: parseFloat(pctMatch[1]) };
  }

  // ── Generic number ──
  const num = parseFloat(val);
  if (!isNaN(num)) {
    return { type: "Number", text: name, value: num };
  }

  return null;
}

function parseDamageFact(name, val) {
  // "269 (3×0.5)" or "269 (0.666)"
  const hitMatch = val.match(/\((\d+)\s*[×x]\s*([\d.]+)\)/);
  if (hitMatch) {
    return {
      type: "Damage", text: name,
      dmg_multiplier: parseFloat(hitMatch[2]),
      hit_count: parseInt(hitMatch[1], 10),
    };
  }
  const coeffMatch = val.match(/\(([\d.]+)\)/);
  if (coeffMatch) {
    return {
      type: "Damage", text: name,
      dmg_multiplier: parseFloat(coeffMatch[1]),
      hit_count: 1,
    };
  }
  return { type: "Damage", text: name, dmg_multiplier: 0, hit_count: 1 };
}

function parseHealingFact(name, val) {
  // "1930 (0.5)" — base value with optional coefficient
  const parts = val.match(/^([\d,]+)\s*(?:\(([\d.]+)\))?/);
  const base = parts ? parseInt(parts[1].replace(/,/g, ""), 10) : 0;
  const coeff = parts?.[2] ? parseFloat(parts[2]) : 0;
  return {
    type: "AttributeAdjust", text: name, target: "Healing",
    value: base, coefficient: coeff, hit_count: 1,
  };
}

function parseBuffFact(name, val) {
  // "3 stacks; 10 s" or "4 s" or "10s"
  let duration = 0;
  let stacks = 1;

  const stackMatch = val.match(/(\d+)\s*stacks?/i);
  if (stackMatch) stacks = parseInt(stackMatch[1], 10);

  const durMatch = val.match(/([\d.]+)\s*s(?!t)/);  // match "s" but not "stacks"
  if (durMatch) duration = parseFloat(durMatch[1]);

  return {
    type: "Buff", text: name, status: name,
    duration, apply_count: stacks,
  };
}

module.exports = { parseFactText, isBuffOrCondition, KNOWN_BUFFS, KNOWN_CONDITIONS };
