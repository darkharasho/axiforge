"use strict";

/**
 * @typedef {'pve'|'wvw'|'pvp'} GameMode
 */

/**
 * @typedef {Object} Fact
 * @property {string} type - Fact type (Damage, Buff, AttributeAdjust, Recharge, etc.)
 * @property {string} text - Display label
 * @property {string} [icon] - Icon URL
 * @property {number} [value] - Numeric value (AttributeAdjust, Number)
 * @property {number} [duration] - Duration in seconds (Buff, Time)
 * @property {number} [apply_count] - Stack count (Buff)
 * @property {string} [status] - Buff/condition name (Buff)
 * @property {number} [dmg_multiplier] - Damage coefficient (Damage)
 * @property {number} [hit_count] - Number of hits (Damage)
 * @property {number} [distance] - Distance/radius in units (Distance, Radius)
 * @property {number} [percent] - Percentage value (Percent)
 * @property {number} [coefficient] - Healing/barrier coefficient
 * @property {string} [target] - Target attribute (AttributeAdjust, BuffConversion)
 * @property {string} [source] - Source attribute (BuffConversion)
 * @property {string} [finisher_type] - Combo finisher type (ComboFinisher)
 * @property {string} [field_type] - Combo field type (ComboField)
 * @property {boolean} [_splitFact] - Marked true when fact value comes from a balance split
 * @property {boolean} [_traitedFact] - Marked true when fact is from traited_facts
 * @property {boolean} [_newFact] - Marked true when fact was added by split (not in API)
 */

/**
 * @typedef {Object} ResolvedSkill
 * @property {number} id - Skill ID
 * @property {string} name - Skill name
 * @property {string} description - Skill description
 * @property {string} icon - Icon URL
 * @property {string} [slot] - Slot type (Weapon_1-5, Heal, Utility, Elite, Profession_1-5)
 * @property {number} [specialization] - Required specialization ID
 * @property {string[]} [professions] - Professions that can use this skill
 * @property {Fact[]} facts - Resolved facts for the requested game mode
 * @property {Fact[]} [traited_facts] - Facts that change when specific traits are active
 * @property {boolean} [hasSplit] - True if facts differ from PvE in this game mode
 */

/**
 * @typedef {Object} ResolvedTrait
 * @property {number} id - Trait ID
 * @property {string} name - Trait name
 * @property {string} description - Trait description
 * @property {string} icon - Icon URL
 * @property {number} specialization - Specialization ID
 * @property {number} tier - Trait tier (1=minor adept, 2=major adept, etc.)
 * @property {number} order - Position in tier (0, 1, 2)
 * @property {Fact[]} facts - Resolved facts for the requested game mode
 * @property {Fact[]} [traited_facts] - Conditional facts
 * @property {boolean} [hasSplit] - True if facts differ from PvE
 */

/**
 * @typedef {Object} SplitEntry
 * @property {Fact[]} facts - Facts for this game mode
 * @property {boolean} [complete] - If true, this is the full fact set (not partial)
 */

/**
 * @typedef {Object} WikiRelation
 * @property {string} name - Related entity name
 * @property {string} [icon] - Icon URL
 * @property {string} [context] - Description of the relationship
 */

/**
 * @typedef {Object} CacheAdapter
 * @property {(key: string) => any|null} get
 * @property {(key: string, value: any, ttlMs: number) => void} set
 * @property {(key: string) => void} invalidate
 * @property {() => void} clear
 * @property {(key: string) => boolean} has
 */

module.exports = {};
