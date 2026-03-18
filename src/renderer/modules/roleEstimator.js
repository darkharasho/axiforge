// Role estimation from equipment stats — pure functions, no global state.
import { computeSlotStats } from './stats.js';

const MIN_THRESHOLD = 700;
const HYBRID_RATIO  = 0.20;

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

// Note: computeSlotStats returns only the equipment contribution for a slot,
// not GW2 base stats (Power/Precision/Toughness/Vitality base = 1000 each).
// Base stats are added separately in computeEquipmentStats() and are NOT
// present here, so no subtraction is needed before scoring.
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
export function estimateRole(build) {
  const slots = build?.equipment?.slots;
  if (!slots || !Object.values(slots).some(Boolean)) return null;

  const s = scoreEquipmentSlots(slots);
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
export function roleBadgeHtml(build) {
  const role = estimateRole(build);
  if (!role) return '';
  const cls = ROLE_CSS_CLASS[role] ?? 'unknown';
  return `<span class="role-badge role-badge--${cls}">${role}</span>`;
}
