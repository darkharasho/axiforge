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

// The wiki often renders condition/buff names with display text that differs
// from the canonical name (e.g. "Cripple" instead of "Crippled"). This map
// normalizes display text → canonical name for recognition and output.
const DISPLAY_NAME_ALIASES = {
  "cripple": "Crippled",
  "immobilize": "Immobile",
  "immobilized": "Immobile",
  "blind": "Blinded",
  "blindness": "Blinded",
  "chill": "Chilled",
  "poison": "Poisoned",
  "poisoned": "Poisoned",
};

function isBuffOrCondition(name) {
  const lower = name.toLowerCase();
  return KNOWN_BUFFS.has(lower) || KNOWN_CONDITIONS.has(lower) || lower in DISPLAY_NAME_ALIASES;
}

/**
 * Normalize a buff/condition display name to its canonical form.
 * E.g. "Cripple" → "Crippled", "Immobilize" → "Immobile".
 * Returns the original name (capitalized) if no alias exists.
 */
function normalizeBuffName(name) {
  const alias = DISPLAY_NAME_ALIASES[name.toLowerCase()];
  return alias || name;
}

/**
 * @param {string} name      — the fact label (e.g. "Damage", "Fury", "Radius")
 * @param {string} value     — the text after the label (e.g. "269 (0.666)", "4 s")
 * @param {string} [titleAttr] — optional title attribute from the wiki link (canonical name)
 * @returns {object|null} structured fact object or null if unparseable
 */
function parseFactText(name, value, titleAttr) {
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

  // ── Stun Break ──
  if (nameLower === "breaks stun" || nameLower === "stun break") {
    return { type: "StunBreak", text: "Stun Break", value: true };
  }

  // ── Recharge ──
  if (nameLower === "recharge" || nameLower === "recharge time") {
    const num = parseFloat(val);
    return !isNaN(num) ? { type: "Recharge", text: name, value: num } : null;
  }

  // ── Activation time (cast time) ──
  if (nameLower === "activation" || nameLower === "activation time") {
    const num = parseFloat(val);
    return !isNaN(num) ? { type: "Time", text: "Activation", duration: num } : null;
  }

  // ── Radius ──
  if (nameLower === "radius" || nameLower === "blast radius" || nameLower === "healing radius") {
    const num = parseInt(val, 10);
    return !isNaN(num) ? { type: "Radius", text: name, distance: num } : null;
  }

  // ── Range ──
  if (nameLower === "range") {
    const num = parseInt(val, 10);
    // Reject Range <= 1: no GW2 skill has range that low; value 1 is a
    // boolean flag artifact from older wiki templates.
    return !isNaN(num) && num > 1 ? { type: "Range", text: name, value: num } : null;
  }

  // ── Buffs and conditions ──
  // Check display name first, then fall back to title attribute for recognition
  if (isBuffOrCondition(name)) {
    const canonical = normalizeBuffName(name);
    return parseBuffFact(canonical, val);
  }
  // Title attribute fallback: the wiki <a title="Crippled"> uses the canonical
  // condition name even when the display text differs (e.g. "Cripple")
  if (titleAttr && isBuffOrCondition(titleAttr)) {
    const canonical = normalizeBuffName(titleAttr);
    return parseBuffFact(canonical, val);
  }

  // ── Combo finisher / field ──
  if (nameLower === "combo finisher") {
    return parseComboFinisher(val);
  }
  if (nameLower === "combo field") {
    return parseComboField(val);
  }

  // ── Number of targets, conditions removed, etc. ──
  if (nameLower === "number of targets" || nameLower === "conditions removed") {
    const num = parseInt(val, 10);
    return !isNaN(num) ? { type: "Number", text: name, value: num } : null;
  }

  // ── Duration / Time ──
  // "15 seconds", "20 seconds", etc. — wiki renders time facts with a "seconds" suffix
  if (nameLower === "duration" || nameLower === "duration increase") {
    const timeMatch = val.match(/^([\d.]+)\s*s/);
    if (timeMatch) {
      return { type: "Time", text: name, duration: parseFloat(timeMatch[1]) };
    }
  }

  // ── Self-named buff effect ──
  // Wiki renders relic/skill self-buffs as e.g. "Relic of the Claw (8s): Strike damage increased."
  // The name is the relic/buff name itself and the value contains a "(Xs)" duration.
  const selfBuffDurMatch = val.match(/^\(?([\d.]+)\s*s(?:\)|(?:\s|$|[^a-z]))/);
  if (selfBuffDurMatch) {
    return { type: "Time", text: "Duration", duration: parseFloat(selfBuffDurMatch[1]) };
  }

  // ── Custom buff effect description ──
  // Trait-granted custom effects on the wiki appear as percentage-based descriptions
  // e.g. "Chant of Action: +10% Damage, +10% Condition Damage"
  // where the name is the custom buff and the value describes the effect.
  // Detect values with a percentage followed by descriptive game effect text.
  if (/^[+-]?\d+%\s+[A-Z]/.test(val)) {
    return { type: "Buff", text: val, status: name, apply_count: 1 };
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

function parseComboFinisher(val) {
  // "Blast" or "Whirl (100%)" etc.
  const type = val.replace(/\s*\([\d%]+\)\s*$/, "").trim();
  if (!type) return null;
  const pctMatch = val.match(/\((\d+)%\)/);
  return {
    type: "ComboFinisher",
    text: "Combo Finisher",
    finisher_type: type,
    percent: pctMatch ? parseInt(pctMatch[1], 10) : 100,
  };
}

function parseComboField(val) {
  const type = val.trim();
  if (!type) return null;
  return { type: "ComboField", text: "Combo Field", field_type: type };
}

module.exports = { parseFactText, isBuffOrCondition, normalizeBuffName, KNOWN_BUFFS, KNOWN_CONDITIONS, DISPLAY_NAME_ALIASES };
