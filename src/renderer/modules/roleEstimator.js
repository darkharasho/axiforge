// Role estimation from equipment stats — pure functions, no global state.
import { computeSlotStats } from './stats.js';

// 700 (not the spec's 1500): tuned down so Celestial gear (~810 max) and partial builds
// still get a role rather than Unknown. Rune bonuses further lift scores for full builds.
const MIN_THRESHOLD = 700;
const HYBRID_RATIO  = 0.10;

// Tank is intentionally excluded — not a meaningful role category in GW2.
const ROLE_SCORERS = [
  { role: 'Power DPS',    fn: s => s.Power * 1.0 + s.Precision * 0.5 + s.Ferocity * 0.5 },
  { role: 'Condi DPS',    fn: s => s.ConditionDamage * 1.0 + s.Expertise * 0.8 },
  { role: 'Boon Support', fn: s => s.Concentration * 1.5 + s.HealingPower * 0.3 },
  { role: 'Heal Support', fn: s => s.HealingPower * 1.5 + s.Concentration * 0.3 },
];

const ROLE_CSS_CLASS = {
  'Power DPS':    'power-dps',
  'Condi DPS':    'condi-dps',
  'Boon Support': 'boon-support',
  'Heal Support': 'heal-support',
  'Hybrid':       'hybrid',
  'Unknown':      'unknown',
};

const RUNE_STAT_RE = /\+(\d+)\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|to All Stats)/;
const RUNE_BOON_RE = /\+(\d+)%\s+Boon Duration/i;
const RUNE_CONDI_RE = /\+(\d+)%\s+Condition Duration/i;

const RUNE_STAT_MAP = {
  'Condition Damage': 'ConditionDamage',
  'Healing Power':    'HealingPower',
  'Healing':          'HealingPower',
  'Power':            'Power',
  'Precision':        'Precision',
  'Toughness':        'Toughness',
  'Vitality':         'Vitality',
  'Ferocity':         'Ferocity',
  'Concentration':    'Concentration',
  'Expertise':        'Expertise',
};

// Returns a stat totals object from the equipped rune set, or null if no runes.
// catalog = state.upgradeCatalog passed in from the caller.
function scoreRuneStats(build, catalog) {
  const runeSlots = build?.equipment?.runes;
  if (!runeSlots || !catalog?.runeById) return null;

  // Count equipped rune IDs (ignore breather slot, only armor slots contribute)
  const counts = {};
  for (const [slot, id] of Object.entries(runeSlots)) {
    if (!id || slot === 'breather') continue;
    const key = Number(id);
    counts[key] = (counts[key] || 0) + 1;
  }

  // Find dominant rune
  let bestId = null, bestCount = 0;
  for (const [id, count] of Object.entries(counts)) {
    if (count > bestCount) { bestId = Number(id); bestCount = count; }
  }
  if (!bestId) return null;

  const runeDef = catalog.runeById.get(bestId);
  if (!runeDef?.bonuses?.length) return null;

  const totals = {
    Power: 0, Precision: 0, Toughness: 0, Vitality: 0,
    Ferocity: 0, ConditionDamage: 0, Expertise: 0, Concentration: 0, HealingPower: 0,
  };
  const activeBonuses = runeDef.bonuses.slice(0, Math.min(bestCount, 6));

  for (const bonus of activeBonuses) {
    const statMatch = RUNE_STAT_RE.exec(bonus);
    if (statMatch) {
      const value = parseInt(statMatch[1], 10);
      const rawName = statMatch[2];
      if (rawName === 'to All Stats') {
        for (const k of Object.keys(totals)) totals[k] += value;
      } else {
        const statKey = RUNE_STAT_MAP[rawName];
        if (statKey) totals[statKey] += value;
      }
      continue;
    }
    const boonMatch = RUNE_BOON_RE.exec(bonus);
    if (boonMatch) { totals.Concentration += parseInt(boonMatch[1], 10) * 15; continue; }
    const condiMatch = RUNE_CONDI_RE.exec(bonus);
    if (condiMatch) { totals.Expertise += parseInt(condiMatch[1], 10) * 15; }
  }

  return totals;
}

// Note: computeSlotStats returns only the equipment contribution for a slot,
// not GW2 base stats (Power/Precision/Toughness/Vitality base = 1000 each).
// Base stats are added separately in computeEquipmentStats() and are NOT
// present here, so no subtraction is needed before scoring.
// The returned totals serve as the base for rune stat scoring when a catalog is provided.
function scoreEquipmentSlots(slots) {
  const totals = {
    Power: 0, Precision: 0, Toughness: 0, Vitality: 0,
    Ferocity: 0, ConditionDamage: 0, Expertise: 0, Concentration: 0, HealingPower: 0,
  };
  for (const [slotKey, label] of Object.entries(slots)) {
    if (!label) continue;
    for (const { stat, value } of computeSlotStats(label, slotKey)) {
      if (stat in totals) totals[stat] += value;
    }
  }
  return totals;
}

/**
 * Returns the estimated role for a build, or null if no slots are equipped.
 * Pure function — reads only from the build object, no global state.
 */
export function estimateRole(build, catalog = null) {
  const slots = build?.equipment?.slots;
  if (!slots || !Object.values(slots).some(Boolean)) return null;

  const equipStats = scoreEquipmentSlots(slots);
  const runeStats  = catalog ? scoreRuneStats(build, catalog) : null;
  const s = runeStats
    ? Object.fromEntries(Object.keys(equipStats).map(k => [k, equipStats[k] + (runeStats[k] || 0)]))
    : equipStats;
  const scored = ROLE_SCORERS.map(({ role, fn }) => ({ role, score: fn(s) }));
  scored.sort((a, b) => b.score - a.score);

  const [first, second] = scored;
  if (first.score < MIN_THRESHOLD) return 'Unknown';
  if (
    second &&
    second.score >= MIN_THRESHOLD &&
    (first.score - second.score) / first.score < HYBRID_RATIO
  ) {
    return 'Hybrid';
  }
  return first.role;
}

/**
 * Returns an HTML string for the role badge, or '' if the build has no equipment.
 */
export function roleBadgeHtml(build, catalog = null) {
  const role = estimateRole(build, catalog);
  if (!role) return '';
  const cls = ROLE_CSS_CLASS[role] ?? 'unknown';
  return `<span class="role-badge role-badge--${cls}">${role}</span>`;
}
