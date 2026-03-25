const {
  GW2_API_ROOT,
  fetchCachedJson,
  fetchGw2ByIds,
  dedupeNumbers,
} = require("./fetch");

const {
  KNOWN_SKILL_DESCRIPTION_OVERRIDES,
  KNOWN_SKILL_FACTS_OVERRIDES,
  KNOWN_SKILL_SPEC_OVERRIDES,
  KNOWN_SKILL_SLOT_OVERRIDES,
  PHOTON_FORGE_SKILL_ID,
  PHOTON_FORGE_BUNDLE,
  RADIANT_FORGE_SKILL_ID,
  RADIANT_FORGE_BUNDLE,
  RADIANT_FORGE_FLIP_SKILLS,
  DEATH_SHROUD_SKILL_ID,
  DEATH_SHROUD_BUNDLE,
  DEATH_SHROUD_FLIP_SKILLS,
  LICH_FORM_SKILL_ID,
  LICH_FORM_BUNDLE,
  LICH_FORM_FLIP_SKILLS,
  SHADOW_SHROUD_SKILL_ID,
  SHADOW_SHROUD_BUNDLE,
  FIREBRAND_TOME_CHAPTERS,
  GUNSABER_SKILL_ID,
  GUNSABER_BUNDLE,
  GUNSABER_BUNDLE_SKILLS,
  DRAGON_TRIGGER_SKILL_ID,
  DRAGON_TRIGGER_BUNDLE,
  DRAGON_TRIGGER_BUNDLE_SKILLS,
  ELIXIR_TOOLBELT_OVERRIDES,
  LEGEND_FLIP_OVERRIDES,
  KNOWN_SKILL_ATTUNEMENT_OVERRIDES,
  EVOKER_F5_EXTRA_VARIANTS,
  UNTAMED_UNLEASHED_AMBUSH,
} = require("./overrides");

const { getSkillSplit, getTraitSplit, getSkillPveFacts, getTraitPveFacts } = require("../../../lib/gw2-balance-splits");

const {
  splitNormalizeType: _splitNormalizeType,
  splitGroupKey: _splitGroupKey,
  SPLIT_VALUE_KEYS: _SPLIT_VALUE_KEYS,
  splitValueChanged: _splitValueChanged,
  buildSplitMatchTables: _buildSplitMatchTables,
} = require("../../../lib/gw2-balance-splits/match");

/**
 * Apply WvW balance split override to a mapped skill or trait object (mutates in place).
 * Called from mapSkill(), traits.map(), and weaponSkills mapping.
 *
 * Merges split facts into the base facts rather than replacing them, so that facts
 * not covered by the split (e.g. Recharge) are still shown. Split facts are matched
 * to base facts in two passes:
 *   1. Exact text + type match (e.g. "Conditions Removed" → "Conditions Removed")
 *   2. Type-group positional match (e.g. 1st AttributeAdjust split → 1st AttributeAdjust base)
 *      using type+target as the grouping key for finer granularity.
 * The base fact's text label is always preserved; only value fields are taken from the split.
 * A fact is marked _splitFact:true only when its value actually changed.
 */

/** Merge a split fact's values into a base fact (mutates a copy). */
function _mergeSplitValues(bf, sf) {
  const merged = { ...bf };
  for (const k of _SPLIT_VALUE_KEYS) {
    if (sf[k] !== undefined) merged[k] = sf[k];
  }
  // Cross-map Distance↔Radius: the GW2 API stores these in "value" (type Distance)
  // while the wiki scraper uses "distance" (type Radius). Promote so the renderer
  // (which reads fact.value first) shows the correct WvW number.
  if (sf.distance !== undefined && bf.value !== undefined && bf.distance === undefined) {
    merged.value = sf.distance;
  }
  return merged;
}

/**
 * Sanitise a WvW-only split fact (no base match) so it renders correctly.
 * The wiki scraper emits type:"Buff" for many facts that are not actual buffs
 * (e.g. "Maximum count", "Allied targets"). Without a matching base fact to
 * inherit type/icon from, these render with a generic Might icon and buff
 * formatting. Strip the misleading Buff type so the renderer uses the generic
 * text-based fallback instead.
 */
function _sanitiseUnmatchedSplitFact(sf) {
  const clean = { ...sf, _splitFact: true };
  const status = (sf.status || "").toLowerCase();
  // If it's a real buff/condition (known boon/condition name or has a recognized
  // icon from the GW2 render CDN), keep it. Otherwise demote to generic.
  const isRenderCdn = sf.icon && sf.icon.includes("render.guildwars2.com");
  if (sf.type === "Buff" && !isRenderCdn) {
    // Check if status looks like a real buff/condition name
    const KNOWN_EFFECTS = [
      "might", "fury", "quickness", "alacrity", "swiftness", "vigor", "regeneration",
      "protection", "resolution", "resistance", "stability", "aegis", "retaliation",
      "bleeding", "burning", "confusion", "poison", "torment", "vulnerability",
      "weakness", "crippled", "chilled", "blinded", "immobile", "slow", "fear",
      "taunt", "daze", "stun", "knockdown", "knockback", "float", "pull", "sink",
      "stealth", "superspeed", "revealed",
    ];
    if (!KNOWN_EFFECTS.includes(status)) {
      clean.type = "Untyped";
    }
  }
  return clean;
}

/**
 * Apply WvW balance split override to a mapped skill or trait object (mutates in place).
 * Called from mapSkill(), traits.map(), and weaponSkills mapping.
 *
 * Two modes controlled by split.complete:
 *
 *   complete:true  — The split represents the FULL WvW fact set (scraped from wiki
 *                    {{skill fact}} templates). WvW facts are used as the primary list;
 *                    base labels are grafted in where possible. Any PvE fact absent from
 *                    the WvW split is DROPPED (e.g. Aegis removed in WvW).
 *
 *   complete:false — The split only lists CHANGED facts (e.g. a Recharge override from
 *   (or undefined)   an infobox param). PvE facts not in the split are kept unchanged.
 */
function applyBalanceSplit(mapped, entityType, gameMode) {
  if (gameMode === "pve") return;
  const splitFn = entityType === "trait" ? getTraitSplit : getSkillSplit;
  const split = splitFn(mapped.id, gameMode);
  if (!split?.facts) return;

  mapped.hasSplit = true;
  const baseFacts = Array.isArray(mapped.facts) ? mapped.facts : [];
  const splitFacts = split.facts;

  if (baseFacts.length === 0) {
    mapped.facts = splitFacts.map((f) => ({ ...f, _splitFact: true }));
    return;
  }

  const { baseToSplit, splitToBase } = _buildSplitMatchTables(baseFacts, splitFacts);

  if (split.complete) {
    // ── Complete mode ─────────────────────────────────────────────────────────
    // Iterate over the WvW split facts (authoritative). Enrich each with its
    // matching PvE base label. PvE facts with no WvW counterpart are dropped.
    const wvwFacts = splitFacts.map((sf, si) => {
      const bi = splitToBase.get(si);
      if (bi === undefined) return _sanitiseUnmatchedSplitFact(sf); // WvW-only fact (added in WvW)
      const merged = _mergeSplitValues(baseFacts[bi], sf);
      if (_splitValueChanged(baseFacts[bi], merged)) merged._splitFact = true;
      return merged;
    });
    // The wiki represents Recharge changes via infobox params, never template facts,
    // so Recharge is always absent from complete-mode WvW splits even when unchanged.
    // Preserve the base PvE Recharge facts unless the WvW split already has one.
    if (!wvwFacts.some((f) => f.type === "Recharge")) {
      const pveRecharge = baseFacts.filter((f) => f.type === "Recharge");
      mapped.facts = [...pveRecharge, ...wvwFacts];
    } else {
      mapped.facts = wvwFacts;
    }
  } else {
    // ── Partial mode ──────────────────────────────────────────────────────────
    // Iterate over the PvE base facts. Apply split overrides where matched.
    // Unmatched base facts pass through unchanged. Unmatched split facts appended.
    const result = baseFacts.map((bf, bi) => {
      const si = baseToSplit.get(bi);
      if (si === undefined) return bf;
      const merged = _mergeSplitValues(bf, splitFacts[si]);
      if (_splitValueChanged(bf, merged)) merged._splitFact = true;
      return merged;
    });
    for (let si = 0; si < splitFacts.length; si++) {
      if (!splitToBase.has(si)) result.push(_sanitiseUnmatchedSplitFact(splitFacts[si]));
    }
    mapped.facts = result;
  }
}

/**
 * Apply PvE fact enrichments (healing coefficients) to a mapped skill/trait object.
 * The GW2 API does not expose healing-power coefficients in its facts; we scrape them
 * from the wiki and store them in modes.pve. This function merges just the coefficient
 * field into matching base facts so PvE tooltips can display e.g. "+2344 (×0.75)".
 * Does NOT mark facts as _splitFact — these are PvE values, not WvW overrides.
 */
function applyPveFacts(mapped, entityType) {
  const pveFn = entityType === "trait" ? getTraitPveFacts : getSkillPveFacts;
  const pve = pveFn(mapped.id);
  if (!pve?.facts?.length) return;

  const baseFacts = Array.isArray(mapped.facts) ? mapped.facts : [];
  if (baseFacts.length === 0) return;

  // Match PvE facts to base facts by type+target positional group, then copy coefficient.
  const groupKey = (f) => `${f.type || ""}:${f.target || f.status || ""}`;
  const byGroup = {};
  for (const pf of pve.facts) {
    const key = groupKey(pf);
    (byGroup[key] = byGroup[key] || []).push(pf);
  }
  const counters = {};

  mapped.facts = baseFacts.map((bf) => {
    const key = groupKey(bf);
    const pool = byGroup[key];
    if (!pool) return bf;
    const idx = counters[key] || 0;
    if (idx >= pool.length) return bf;
    counters[key] = idx + 1;
    const pf = pool[idx];
    return pf.coefficient != null ? { ...bf, coefficient: pf.coefficient } : bf;
  });
}

async function getProfessionList(lang = "en") {
  // Profession IDs are static (unchanged since 2015); hardcode to avoid an extra round-trip
  // and to avoid the /v2/professions bare endpoint which has inconsistent API support.
  const PROFESSION_IDS = ["Guardian","Warrior","Engineer","Ranger","Thief","Elementalist","Mesmer","Necromancer","Revenant"];
  const data = await fetchCachedJson(
    `professions:${lang}`,
    `${GW2_API_ROOT}/professions?ids=${PROFESSION_IDS.join(",")}&lang=${encodeURIComponent(lang)}`,
    1000 * 60 * 60
  );
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry) => entry?.id)
    .map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      icon: entry.icon || "",
      iconBig: entry.icon_big || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getProfessionCatalog(professionId, lang = "en", gameMode = "pve") {
  if (!professionId) {
    throw new Error("Missing profession id.");
  }

  // Step 1: fetch profession data — everything else depends on this.
  const professionUrl = `${GW2_API_ROOT}/professions?ids=${encodeURIComponent(professionId)}&lang=${encodeURIComponent(lang)}`;
  const professionArr = await fetchCachedJson(`profession:${professionId}:${lang}`, professionUrl, 1000 * 60 * 60);
  const profession = Array.isArray(professionArr) ? professionArr[0] : professionArr;
  if (!profession?.id) {
    throw new Error(`Unknown profession "${professionId}".`);
  }

  // Build a map of skill ID → reference metadata from the profession endpoint.
  // The profession.skills entries carry slot/specialization/type for how the profession
  // uses each skill. Some skills (e.g. Mechanist's Jade Mech F1-F3) have no slot or
  // specialization set in /v2/skills itself — the profession reference is authoritative.
  const profSkillRefs = new Map(
    (profession.skills || [])
      .filter((entry) => entry?.id)
      .map((entry) => [Number(entry.id), {
        slot: entry.slot || "",
        specialization: Number(entry.specialization) || 0,
        type: entry.type || "",
      }])
  );

  // Evoker F5 Water/Air/Earth familiar passives are not in the Elementalist profession endpoint.
  // Inject them into profSkillRefs so they get inProfessionEndpoint=true and pass the
  // profMechanics filter in the renderer (skills that have no professions[] from the API would
  // otherwise be silently excluded).
  if (professionId === "Elementalist") {
    for (const id of EVOKER_F5_EXTRA_VARIANTS) {
      if (!profSkillRefs.has(id)) {
        profSkillRefs.set(id, { slot: "Profession_5", specialization: 80, type: "Profession" });
      }
    }
  }

  const specializationIds = dedupeNumbers(profession.specializations || []);
  const professionSkillIds = dedupeNumbers((profession.skills || []).map((entry) => entry?.id));

  // Also include any Skill unlocks from elite specialization training tracks.
  // These are typically utility/heal/elite skills unlocked via training, NOT F-skills
  // (elite spec F-skills come from trait.skills on minor traits, see traitSkillTagMap below).
  // Training line `id` is a training-line ID, not the specialization ID, so we rely on
  // each skill's own `specialization` field from /v2/skills for correct spec tagging.
  const trainingSkillIds = dedupeNumbers(
    (profession.training || [])
      .filter((line) => line.category === "EliteSpecializations")
      .flatMap((line) =>
        (line.track || [])
          .filter((t) => t.type === "Skill" && t.skill_id)
          .map((t) => Number(t.skill_id))
      )
  );
  const allProfessionSkillIds = dedupeNumbers([...professionSkillIds, ...trainingSkillIds]);

  const weaponSkillIds = dedupeNumbers(
    Object.values(profession.weapons || {}).flatMap((w) => (w.skills || []).map((s) => s?.id))
  );

  // Step 2: fetch specializations, profession skills, and weapon skills in parallel.
  // These are all independent of each other — they only need the profession data from step 1.
  // Also start Ranger pets and Revenant legend IDs here since they're fully independent.
  const petsPromise = professionId === "Ranger"
    ? fetchCachedJson(`pets:${lang}`, `${GW2_API_ROOT}/pets?ids=all&lang=${encodeURIComponent(lang)}`, 1000 * 60 * 60 * 24)
    : Promise.resolve([]);
  const legendsRawPromise = professionId === "Revenant"
    ? fetchCachedJson(`legendIds`, `${GW2_API_ROOT}/legends`, 1000 * 60 * 60 * 24)
        .then((legendIds) =>
          Array.isArray(legendIds) && legendIds.length
            ? fetchCachedJson(
                `legends:${legendIds.join(",")}`,
                `${GW2_API_ROOT}/legends?ids=${encodeURIComponent(legendIds.join(","))}`,
                1000 * 60 * 60 * 24
              )
            : []
        )
    : Promise.resolve([]);

  const [specializations, professionSkillsRawApi, weaponSkillsBase] = await Promise.all([
    fetchGw2ByIds("specializations", specializationIds, lang),
    fetchGw2ByIds("skills", allProfessionSkillIds, lang),
    fetchGw2ByIds("skills", weaponSkillIds, lang),
  ]);

  // Collect depth-1 weapon chain flip IDs upfront so they can be merged into the extraSkillIds
  // batch below — avoiding a separate sequential network request.
  const weaponSkillIdSet = new Set(weaponSkillIds);
  const weaponChainDepth1Ids = dedupeNumbers(
    weaponSkillsBase.map((s) => Number(s.flip_skill)).filter((id) => id && !weaponSkillIdSet.has(id))
  );

  // Step 3: compute extraSkillIds from raw API data and fetch traits + extra skills in parallel.
  // extraSkillIds only uses toolbelt_skill/flip_skill/bundle_skills/transform_skills — fields that
  // come directly from the GW2 API and are unaffected by the profSkillRefs/traitSkillTagMap merge.
  // This lets us start fetching extras without waiting for traits to complete.
  const extraSkillIds = dedupeNumbers([
    ...professionSkillsRawApi.flatMap((s) => [
      s.toolbelt_skill,
      s.flip_skill,
      ...(Array.isArray(s.bundle_skills) ? s.bundle_skills : []),
      ...(Array.isArray(s.transform_skills) ? s.transform_skills : []),
    ]).filter(Boolean),
    // Include Photon Forge weapon skills for Engineer (not discoverable via API bundle_skills).
    ...(professionId === "Engineer" ? PHOTON_FORGE_BUNDLE : []),
    // Include correct Toss Elixir toolbelt skills (API points to Detonate variants instead).
    ...(professionId === "Engineer" ? [...ELIXIR_TOOLBELT_OVERRIDES.values()] : []),
    // Include Mechanist Depth Charges (63210) — underwater replacement for all mech F-slots.
    ...(professionId === "Engineer" ? [63210] : []),
    // Include Radiant Forge weapon skills + their flip skills (Luminary, Guardian).
    ...(professionId === "Guardian" ? [...RADIANT_FORGE_BUNDLE, ...RADIANT_FORGE_FLIP_SKILLS] : []),
    // Include flip_skills of Death Shroud and Lich Form transform children (not auto-fetched).
    ...(professionId === "Necromancer" ? [...DEATH_SHROUD_FLIP_SKILLS, ...LICH_FORM_FLIP_SKILLS] : []),
    // Alliance Tactics (Vindicator F3, 62729) — ensure it's fetched (not in profession endpoint).
    // Conduit Release Potential variants (F2, one per legend) + Cosmic Wisdom (F3) — ensure all are fetched.
    ...(professionId === "Revenant" ? [62729, 78845, 78501, 78615, 78661, 78895, 77371] : []),
    // Evoker (Elementalist spec 80) F5 Water/Air/Earth familiar passives — not in the
    // Elementalist profession endpoint; must be fetched explicitly so they appear in the
    // F5 slot when the matching attunement is active.
    ...(professionId === "Elementalist" ? EVOKER_F5_EXTRA_VARIANTS : []),
    // Thief extras:
    // - Specter Siphon (63067, spec=71) — not in Thief profession endpoint
    // - Shadow Shroud Enter/Exit (63155/63251) + weapon skills (for bundle display)
    ...(professionId === "Thief" ? [63067, 63155, 63251, ...SHADOW_SHROUD_BUNDLE] : []),
    // Untamed Unleashed Ambush skills — trait-granted (Unleashed Power), not in profession endpoint.
    ...(professionId === "Ranger" ? UNTAMED_UNLEASHED_AMBUSH : []),
    // Weapon auto-attack chain continuations (depth 1): merged here to avoid an extra round-trip.
    ...weaponChainDepth1Ids,
  ]);
  const traitIds = dedupeNumbers(
    specializations.flatMap((spec) => [...(spec?.minor_traits || []), ...(spec?.major_traits || [])])
  );
  const [traits, extraSkillsRawInitial] = await Promise.all([
    fetchGw2ByIds("traits", traitIds, lang),
    extraSkillIds.length ? fetchGw2ByIds("skills", extraSkillIds, lang) : Promise.resolve([]),
  ]);

  // Build trait-skill specialization tag map (needs traits + specializations).
  // Skills embedded in elite spec major traits (e.g. Mechanist's Jade Mech F1-F3) should
  // inherit that elite spec's specialization ID, even when the profession or skills API omits it.
  const eliteSpecIdSet = new Set(specializations.filter((s) => s.elite).map((s) => Number(s.id)));
  const traitSkillTagMap = new Map(); // skillId → {slot, specialization, type}
  for (const trait of traits) {
    const specId = Number(trait.specialization) || 0;
    if (!eliteSpecIdSet.has(specId)) continue;
    const tier = Number(trait.tier) || 0;
    if (!tier || !Array.isArray(trait.skills)) continue;
    for (const ts of trait.skills) {
      const skillId = Number(ts?.id);
      if (!skillId) continue;
      // Don't overwrite a more specific existing entry
      if (!traitSkillTagMap.has(skillId)) {
        traitSkillTagMap.set(skillId, {
          // Use the slot from the trait's skills entry if present; do NOT fall back to
          // Profession_${tier} — that would incorrectly assign mechanic slots to passive
          // trait-proc skills (e.g. Harbinger major tier-2 skills get "Profession_2" and
          // show up as a spurious F2 button). DH F2/F3 skills are safe because they have
          // an explicit slot in /v2/skills that takes precedence in the step-4 map.
          slot: ts.slot || "",
          specialization: specId,
          type: "Profession",
        });
      }
    }
  }

  // Merge profession reference metadata into fetched skill objects (needs traitSkillTagMap).
  // Prefer the reference's slot/specialization/type over the skill's own values.
  // Also apply traitSkillTagMap specialization as a fallback for elite spec skills whose
  // specialization the profession API leaves unset (e.g. Mechanist's mech command variants).
  const professionSkillsRaw = professionSkillsRawApi.map((skill) => {
    const ref = profSkillRefs.get(skill.id);
    const traitTag = traitSkillTagMap.get(skill.id);
    return {
      ...skill,
      slot: KNOWN_SKILL_SLOT_OVERRIDES.get(skill.id) || ref?.slot || skill.slot || "",
      specialization: KNOWN_SKILL_SPEC_OVERRIDES.get(skill.id) || ref?.specialization || traitTag?.specialization || skill.specialization || 0,
      type: ref?.type || skill.type || "",
    };
  });

  // Follow flip_skill chains for extra skills beyond one level.
  // Needed for chains like Spear of Archemorus -> Urn of Saint Viktor -> Drop Urn of Saint Viktor.
  let extraSkillsRaw = [...extraSkillsRawInitial];
  const seenExtraSkillIds = new Set([
    ...professionSkillsRaw.map((s) => s.id),
    ...extraSkillsRaw.map((s) => s.id),
  ]);
  let extraFlipFrontier = dedupeNumbers(
    extraSkillsRaw.map((s) => Number(s.flip_skill)).filter((id) => id && !seenExtraSkillIds.has(id))
  );
  while (extraFlipFrontier.length > 0) {
    const extraFlipRaw = await fetchGw2ByIds("skills", extraFlipFrontier, lang);
    if (!extraFlipRaw.length) break;
    extraSkillsRaw = [...extraSkillsRaw, ...extraFlipRaw];
    for (const s of extraFlipRaw) seenExtraSkillIds.add(s.id);
    extraFlipFrontier = dedupeNumbers(
      extraFlipRaw.map((s) => Number(s.flip_skill)).filter((id) => id && !seenExtraSkillIds.has(id))
    );
  }

  // Depth-2 weapon chain IDs (discoverable now that depth-1 extraSkillsRaw is available).
  const extraSkillIdSet = new Set(extraSkillIds);
  const weaponChainDepth2Ids = dedupeNumbers(
    extraSkillsRaw
      .filter((s) => weaponChainDepth1Ids.includes(s.id))
      .map((s) => Number(s.flip_skill))
      .filter((id) => id && !weaponSkillIdSet.has(id) && !extraSkillIdSet.has(id))
  );

  // Build a transform-bundle map: skillId → weapon-slot skill IDs.
  // For skills that have transform_skills but no bundle_skills (like Death Shroud), we group the
  // fetched transform children by specialization to find which weapon skills belong to each
  // elite-spec shroud variant. We then map the bundle to the SPECIFIC shroud-opener skill ID
  // (e.g. Reaper's Shroud 30792, Harbinger's Shroud 62567) rather than to a generic specId.
  // This prevents other F-mechanic skills sharing the same specId from incorrectly appearing
  // as shroud toggles in the UI.
  // NOTE: Reaper's/Harbinger's Shroud weapon bar skills use "Downed_N" slots in the GW2 API
  // (not "Weapon_N"), so we must accept both slot patterns.
  const transformBundleBySpecId = new Map(); // intermediate: specId → skillId[]
  const transformParentSlots = new Map();    // parentSkillId → slot (e.g. "Profession_1")
  for (const parent of professionSkillsRaw) {
    if ((parent.bundle_skills || []).length > 0) continue;
    if (!(parent.transform_skills || []).length) continue;
    const parentSpec = Number(parent.specialization) || 0;
    transformParentSlots.set(parent.id, parent.slot || "");
    for (const childId of parent.transform_skills) {
      const childSkill = extraSkillsRaw.find((s) => s.id === Number(childId));
      if (!childSkill) continue;
      // Include weapon-bar skills using either Weapon_N or Downed_N slots.
      // Reaper's Shroud skills 1-4 use Downed_N; Executioner's Scythe (slot 5) uses Weapon_5.
      if (!/^(?:Weapon|Downed)_\d/.test(childSkill.slot || "")) continue;
      // Use child's spec if set; fall back to parent's spec for untagged children.
      const childSpec = KNOWN_SKILL_SPEC_OVERRIDES.get(childSkill.id) || Number(childSkill.specialization) || parentSpec;
      if (!childSpec) continue; // skip spec-0 children of spec-0 parents (e.g. Elixir X's transforms)
      if (!transformBundleBySpecId.has(childSpec)) transformBundleBySpecId.set(childSpec, []);
      transformBundleBySpecId.get(childSpec).push(Number(childId));
    }
  }
  // Build the set of "opener slots" — Profession_N slots that have a parent transform skill
  // (e.g. "Profession_1" for Death Shroud, "Profession_5" for Celestial Avatar).
  // In mapSkill, only skills whose slot is in this set receive the transform bundle.
  // This replaces the old skill-ID lookup (which missed traitSkillsRaw skills like the
  // Ritualist's Shroud, discovered via a minor trait rather than profession.skills):
  //   ✓ Ritualist's Shroud at Profession_1 → slot matches parent → gets bundle
  //   ✗ Ritualist F2/F3/F4 at Profession_2/3/4 → slot doesn't match → no bundle
  // We restrict to Profession_N slots to avoid assigning shroud weapon skills to
  // Elite/Heal/Utility skills that share a specId via a parent's Elite-slot transform.
  const transformOpenerSlots = new Set(
    [...transformParentSlots.values()].filter((slot) => /^Profession_\d/.test(slot))
  );

  // Build morph pool promise (runs concurrently in step 4).
  // Morph pool fetches skills for specs with "Locked" profession slots (e.g. Amalgam F2–F4).
  // The GW2 profession endpoint only lists "Locked" placeholder skills for these slots; the actual
  // selectable morph skills are not listed there. We find them by fetching all skill IDs from the
  // API, filtering to the ID range of the known Locked skills, and keeping those with matching
  // specialization + type="Profession" that are not "Locked"/"Evolve" placeholders.
  const lockedSkills = professionSkillsRaw.filter(
    (s) => s.name === "Locked" && s.type === "Profession" && s.specialization
  );
  let morphPoolPromise = Promise.resolve([]);
  if (lockedSkills.length > 0) {
    const lockedSpecId = lockedSkills[0].specialization;
    const lockedIds = lockedSkills.map((s) => s.id);
    const idMin = Math.min(...lockedIds) - 1000;
    const idMax = Math.max(...lockedIds) + 1000;
    const alreadyFetchedForMorph = new Set([...professionSkillsRaw, ...extraSkillsRaw].map((s) => s.id));
    morphPoolPromise = fetchCachedJson(
      `allSkillIds:${lang}`,
      `${GW2_API_ROOT}/skills?lang=${encodeURIComponent(lang)}`,
      1000 * 60 * 60 * 24
    ).then(async (allSkillIds) => {
      const candidateIds = (Array.isArray(allSkillIds) ? allSkillIds : []).filter(
        (id) => id >= idMin && id <= idMax && !alreadyFetchedForMorph.has(id)
      );
      if (!candidateIds.length) return [];
      const candidateSkills = await fetchGw2ByIds("skills", candidateIds, lang);
      // Morph pool skills have no type/slot/specialization set in the GW2 API — they are
      // identified solely by their description starting with "Morph." Tag them with the
      // locked spec's ID and type="Profession" so the renderer can find them.
      return candidateSkills
        .filter((s) => (s.description || "").startsWith("Morph."))
        .map((s) => ({ ...s, specialization: lockedSpecId, type: "Profession" }));
    });
  }

  // Step 4: fetch depth-2 chains, trait skills, and morph pool skills in parallel.
  const alreadyFetchedForTraits = new Set([
    ...professionSkillsRaw.map((s) => s.id),
    ...extraSkillsRaw.map((s) => s.id),
  ]);
  const traitSkillIdsToFetch = [...traitSkillTagMap.keys()].filter((id) => !alreadyFetchedForTraits.has(id));

  const [weaponChainDepth2Raw, traitSkillsRaw, morphPoolSkillsRaw] = await Promise.all([
    weaponChainDepth2Ids.length ? fetchGw2ByIds("skills", weaponChainDepth2Ids, lang) : Promise.resolve([]),
    traitSkillIdsToFetch.length
      ? fetchGw2ByIds("skills", traitSkillIdsToFetch, lang).then((raw) =>
          raw.map((skill) => {
            const tag = traitSkillTagMap.get(skill.id);
            // Prefer the skill's own slot from /v2/skills over the trait-tier-inferred fallback.
            // Trait skills all share the same tier (e.g. DH minor trait 1848 is tier 1), so
            // the `Profession_${tier}` fallback would incorrectly map F2 and F3 to Profession_1.
            return tag ? { ...skill, slot: skill.slot || tag.slot, specialization: tag.specialization, type: tag.type } : skill;
          })
        )
      : Promise.resolve([]),
    morphPoolPromise,
  ]);

  // Build weaponSkillsRaw: base slot skills + all chain continuations.
  const weaponSkillsRaw = [
    ...weaponSkillsBase,
    ...extraSkillsRaw.filter((s) => weaponChainDepth1Ids.includes(s.id)),
    ...weaponChainDepth2Raw,
  ];

  function mapSkill(skill) {
    const specOverride = KNOWN_SKILL_SPEC_OVERRIDES.get(skill.id);
    const specId = specOverride !== undefined ? specOverride : (Number(skill.specialization) || 0);
    const rawBundleSkills = Array.isArray(skill.bundle_skills)
      ? skill.bundle_skills.map(Number).filter(Boolean)
      : [];
    // For skills with no bundle_skills of their own (e.g. Reaper's/Harbinger's Shroud), look up
    // by exact skill ID in the transform-bundle map. This ensures only the specific shroud-opener
    // skill gets the bundle, not every F-mechanic skill sharing the same specId.
    // Photon Forge (42938) gets its bundle injected from the hardcoded PHOTON_FORGE_BUNDLE list.
    const bundleSkills = rawBundleSkills.length > 0
      ? rawBundleSkills
      : skill.id === PHOTON_FORGE_SKILL_ID
        ? PHOTON_FORGE_BUNDLE
        : skill.id === RADIANT_FORGE_SKILL_ID
          ? RADIANT_FORGE_BUNDLE
          : skill.id === LICH_FORM_SKILL_ID
          ? LICH_FORM_BUNDLE
          : skill.id === DEATH_SHROUD_SKILL_ID
          ? DEATH_SHROUD_BUNDLE
          : skill.id === SHADOW_SHROUD_SKILL_ID
          ? SHADOW_SHROUD_BUNDLE
          : skill.id === GUNSABER_SKILL_ID
          ? GUNSABER_BUNDLE
          : skill.id === DRAGON_TRIGGER_SKILL_ID
          ? DRAGON_TRIGGER_BUNDLE
          : FIREBRAND_TOME_CHAPTERS.has(skill.id)
          ? FIREBRAND_TOME_CHAPTERS.get(skill.id).map((c) => c.id)
          : (transformOpenerSlots.has(skill.slot || "") ? (transformBundleBySpecId.get(specId) || []) : []);
    // GW2 API returns "None" for weapon-agnostic skills; normalize to "" so falsy checks work.
    const weaponType = skill.weapon_type === "None" ? "" : (skill.weapon_type || "");
    const attunement = KNOWN_SKILL_ATTUNEMENT_OVERRIDES.get(skill.id)
      || (skill.attunement === "None" ? "" : (skill.attunement || ""));
    // dual_attunement is the Elementalist/Weaver dual attack secondary attunement field.
    // (dual_wield is a Thief-specific field for offhand weapon requirement — unrelated)
    const dualWield = skill.dual_attunement === "None" ? "" : (skill.dual_attunement || "");
    const mapped = {
      id: skill.id,
      name: skill.name || "",
      icon: skill.icon || "",
      description: KNOWN_SKILL_DESCRIPTION_OVERRIDES.get(skill.id) || skill.description || "",
      slot: KNOWN_SKILL_SLOT_OVERRIDES.get(skill.id) || skill.slot || "",
      type: skill.type || "",
      specialization: specId,
      professions: Array.isArray(skill.professions) ? skill.professions : [],
      weaponType,
      attunement,
      dualWield,
      categories: Array.isArray(skill.categories) ? skill.categories : [],
      flags: Array.isArray(skill.flags) ? skill.flags : [],
      // Filter out conditional facts (requires_trait) from the base array — same as traits.
      facts: KNOWN_SKILL_FACTS_OVERRIDES.get(skill.id) || (Array.isArray(skill.facts) ? skill.facts.filter((f) => !f.requires_trait) : []),
      traitedFacts: Array.isArray(skill.traited_facts) ? skill.traited_facts : [],
      toolbeltSkill: ELIXIR_TOOLBELT_OVERRIDES.get(skill.id) || Number(skill.toolbelt_skill) || 0,
      flipSkill: LEGEND_FLIP_OVERRIDES.get(skill.id) || Number(skill.flip_skill) || 0,
      bundleSkills,
      transformSkills: Array.isArray(skill.transform_skills) ? skill.transform_skills.map(Number).filter(Boolean) : [],
      // True for skills explicitly listed in the profession endpoint (profession.skills).
      // Used by the renderer to distinguish legitimate F-slot mechanics that happen to be
      // flip_skill targets (e.g. Deadeye's Mark 43390, the flip of Steal 13014) from
      // transient flip states (e.g. "Steal Time", the flip of Deadeye's Mark) that should
      // not appear as permanent F-slot selections.
      inProfessionEndpoint: profSkillRefs.has(skill.id),
    };
    applyBalanceSplit(mapped, "skill", gameMode);
    if (gameMode === "pve") applyPveFacts(mapped, "skill");
    return mapped;
  }

  let legendSkillsRaw = [];

  // Fifth pass: Revenant legend data.
  // Each legend defines the fixed swap/heal/utility/elite skills Revenant uses when that legend is active.
  // legendsRawPromise was started in step 2, so this await is typically instant (already in flight).
  let legends = [];
  if (professionId === "Revenant") {
    const legendsRaw = await legendsRawPromise;
    if (Array.isArray(legendsRaw) && legendsRaw.length > 0) {
      const alreadyInSkills = new Set([
        ...professionSkillsRaw, ...extraSkillsRaw, ...morphPoolSkillsRaw, ...traitSkillsRaw,
      ].map((s) => s.id));
      const legendSkillIds = dedupeNumbers(
        legendsRaw.flatMap((l) => [l.swap, l.heal, ...(l.utilities || []), l.elite].filter(Boolean))
      ).filter((id) => !alreadyInSkills.has(id));
      legendSkillsRaw = legendSkillIds.length
        ? await fetchGw2ByIds("skills", legendSkillIds, lang)
        : [];
      // Also fetch flip_skill descendants of legend skills + hardcoded overrides (e.g. Elemental Blast).
      // Some legend skills chain more than one flip level (e.g. Urn of Saint Viktor -> Drop Urn).
      const seenLegendSkillIds = new Set([...alreadyInSkills, ...legendSkillsRaw.map((s) => s.id)]);
      let frontierFlipIds = dedupeNumbers([
        ...legendSkillsRaw.map((s) => Number(s.flip_skill)).filter(Boolean),
        ...[...LEGEND_FLIP_OVERRIDES.values()],
      ]).filter((id) => !seenLegendSkillIds.has(id));
      while (frontierFlipIds.length > 0) {
        const legendFlipRaw = await fetchGw2ByIds("skills", frontierFlipIds, lang);
        if (!legendFlipRaw.length) break;
        legendSkillsRaw = [...legendSkillsRaw, ...legendFlipRaw];
        for (const s of legendFlipRaw) seenLegendSkillIds.add(s.id);
        frontierFlipIds = dedupeNumbers(
          legendFlipRaw.map((s) => Number(s.flip_skill)).filter((id) => id && !seenLegendSkillIds.has(id))
        );
      }
      const legendSkillMap = new Map([
        ...[...professionSkillsRaw, ...extraSkillsRaw, ...morphPoolSkillsRaw, ...traitSkillsRaw, ...legendSkillsRaw].map((s) => [s.id, s]),
      ]);
      legends = legendsRaw.map((l) => ({
        id: l.id,
        swap: l.swap || 0,
        heal: l.heal || 0,
        utilities: Array.isArray(l.utilities) ? l.utilities : [],
        elite: l.elite || 0,
        skills: [l.swap, l.heal, ...(l.utilities || []), l.elite].filter(Boolean).map((id) => {
          const s = legendSkillMap.get(id);
          return s
            ? { id: s.id, name: s.name || "", icon: s.icon || "", slot: s.slot || "", description: s.description || "" }
            : { id, name: "", icon: "", slot: "", description: "" };
        }),
      }));
    }
  }

  const skills = [...professionSkillsRaw, ...extraSkillsRaw, ...morphPoolSkillsRaw, ...traitSkillsRaw, ...legendSkillsRaw];

  // Firebrand tome chapters are not in the GW2 API — inject synthetic raw skill objects so mapSkill
  // can include them in the catalog for weapon-bar display when a tome is toggled.
  if (professionId === "Guardian") {
    for (const chapters of new Set(FIREBRAND_TOME_CHAPTERS.values())) {
      for (const ch of chapters) {
        skills.push({
          id: ch.id, name: ch.name, icon: ch.icon, slot: ch.slot,
          type: "Weapon", specialization: 62, professions: ["Guardian"],
          weapon_type: "None", attunement: "None", dual_attunement: "None",
          categories: [], facts: ch.facts || [], bundle_skills: [], transform_skills: [],
          toolbelt_skill: 0, flip_skill: 0, description: ch.description || "",
        });
      }
    }
  }

  // Bladesworn Gunsaber and Dragon Trigger bundle skills are not in the GW2 API — inject synthetic
  // raw skill objects so mapSkill can include them in the catalog for weapon-bar display.
  if (professionId === "Warrior") {
    for (const s of [...GUNSABER_BUNDLE_SKILLS, ...DRAGON_TRIGGER_BUNDLE_SKILLS]) {
      skills.push({
        id: s.id, name: s.name, icon: s.icon, slot: s.slot,
        type: "Weapon", specialization: 68, professions: ["Warrior"],
        weapon_type: "None", attunement: "None", dual_attunement: "None",
        categories: [], facts: [], bundle_skills: [], transform_skills: [],
        toolbelt_skill: 0, flip_skill: 0, description: "",
      });
    }
  }

  // Sixth pass: Ranger pet data.
  // petsPromise was started in step 2, so this await is typically instant (already in flight).
  // The /v2/pets skills array returns only {id} — names/icons must be fetched from /v2/skills.
  let pets = [];
  if (professionId === "Ranger") {
    const petsRaw = await petsPromise;
    if (Array.isArray(petsRaw)) {
      // Collect all pet skill IDs and fetch their full data from /v2/skills.
      const petSkillIds = dedupeNumbers(
        petsRaw.flatMap((p) => (Array.isArray(p.skills) ? p.skills.map((s) => Number(s.id)) : []))
          .filter(Boolean)
      );
      const petSkillsRaw = petSkillIds.length
        ? await fetchGw2ByIds("skills", petSkillIds, lang)
        : [];
      const petSkillById = new Map(petSkillsRaw.map((s) => [s.id, s]));

      pets = petsRaw.map((p) => ({
        id: p.id,
        name: p.name || "",
        description: p.description || "",
        icon: p.icon || "",
        type: p.type || "",
        skills: Array.isArray(p.skills)
          ? p.skills.map((s) => {
              const full = petSkillById.get(Number(s.id)) || {};
              return {
                id: Number(s.id) || 0,
                name: full.name || "",
                description: full.description || "",
                icon: full.icon || "",
              };
            })
          : [],
      }));
    }
  }

  // Normalize GW2 API weapon type keys (e.g. "ShortBow") to our lowercase IDs (e.g. "shortbow")
  // Special cases: "HarpoonGun" and "Speargun" both refer to the same aquatic weapon → "harpoon"
  function normalizeWeaponKey(apiKey) {
    if (apiKey === "HarpoonGun" || apiKey === "Speargun") return "harpoon";
    return apiKey.toLowerCase();
  }

  return {
    profession: {
      id: profession.id,
      name: profession.name || profession.id,
      icon: profession.icon || "",
      iconBig: profession.icon_big || "",
    },
    specializations: specializations.map((spec) => ({
      id: spec.id,
      name: spec.name || "",
      profession: spec.profession || "",
      elite: Boolean(spec.elite),
      icon: spec.icon || "",
      background: spec.background || "",
      minorTraits: Array.isArray(spec.minor_traits) ? spec.minor_traits : [],
      majorTraits: Array.isArray(spec.major_traits) ? spec.major_traits : [],
    })),
    traits: traits.map((trait) => {
      const mapped = {
        id: trait.id,
        name: trait.name || "",
        // Use the render CDN icon directly — wiki FilePath lookups by trait name are unreliable
        // because multiple traits across different professions can share the same name (e.g.
        // "Deadly Aim", "No Quarter"), causing the wrong profession's icon to be served.
        icon: trait.icon || "",
        iconFallback: "",
        description: trait.description || "",
        tier: Number(trait.tier) || 0,
        order: Number(trait.order) || 0,
        slot: trait.slot || "",
        specialization: Number(trait.specialization) || 0,
        facts: Array.isArray(trait.facts) ? trait.facts.filter((f) => !f.requires_trait) : [],
        traitedFacts: Array.isArray(trait.traited_facts) ? trait.traited_facts : [],
        traitSkillIds: Array.isArray(trait.skills)
          ? trait.skills.map((s) => Number(s?.id)).filter(Boolean)
          : [],
        traitSkillIcons: Array.isArray(trait.skills)
          ? Object.fromEntries(
              trait.skills
                .filter((s) => s?.id && s?.icon)
                .map((s) => [Number(s.id), String(s.icon)])
            )
          : {},
      };
      applyBalanceSplit(mapped, "trait", gameMode);
      if (gameMode === "pve") applyPveFacts(mapped, "trait");
      return mapped;
    }),
    skills: skills.map(mapSkill),
    professionWeapons: Object.fromEntries(
      Object.entries(profession.weapons || {}).map(([apiKey, wData]) => [
        normalizeWeaponKey(apiKey),
        {
          flags: Array.isArray(wData.flags) ? wData.flags : [],
          specialization: Number(wData.specialization) || 0,
          skills: (wData.skills || []).map((s) => ({
            id: Number(s.id) || 0,
            slot: s.slot || "",
            offhand: s.offhand || "",
            attunement: s.attunement || "",
          })),
        },
      ])
    ),
    weaponSkills: weaponSkillsRaw.map((skill) => {
      const mapped = {
        id: skill.id,
        name: skill.name || "",
        icon: skill.icon || "",
        description: skill.description || "",
        slot: skill.slot || "",
        attunement: skill.attunement === "None" ? "" : (skill.attunement || ""),
        dualWield: skill.dual_attunement === "None" ? "" : (skill.dual_attunement || ""),
        weaponType: skill.weapon_type === "None" ? "" : (skill.weapon_type || ""),
        flags: Array.isArray(skill.flags) ? skill.flags : [],
        facts: Array.isArray(skill.facts) ? skill.facts : [],
        flipSkill: Number(skill.flip_skill) || 0,
      };
      applyBalanceSplit(mapped, "skill", gameMode);
      if (gameMode === "pve") applyPveFacts(mapped, "skill");
      return mapped;
    }),
    legends,
    pets,
    gameMode: gameMode || "pve",
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Upgrade items (runes, sigils, infusions) — fetched by curated ID lists
// ---------------------------------------------------------------------------

let _upgradeCatalogCache = null;
let _upgradeCatalogPromise = null;

async function getUpgradeCatalog(lang = "en") {
  if (_upgradeCatalogCache) return _upgradeCatalogCache;
  if (_upgradeCatalogPromise) return _upgradeCatalogPromise;

  _upgradeCatalogPromise = (async () => {
    const { RUNE_ITEM_IDS, SIGIL_ITEM_IDS, INFUSION_ITEM_IDS, WVW_INFUSION_IDS, ENRICHMENT_ITEM_IDS, FOOD_ITEM_IDS, UTILITY_ITEM_IDS, RELIC_ITEM_IDS } = require("./upgradeIds");
    const { FOOD_BUFF_OVERRIDES } = require("./foodOverrides");
    const _relicFactsPath = require("path").join(__dirname, "../../../tests/wiki-audit/data/relicFacts.json");
    const _relicFactsData = JSON.parse(require("fs").readFileSync(_relicFactsPath, "utf8"));
    const _relicFactsIndex = _relicFactsData.relics || {};

    const [runeItems, sigilItems, infusionItems, enrichmentItems, foodItems, utilityItems, relicItems] = await Promise.all([
      fetchGw2ByIds("items", RUNE_ITEM_IDS, lang),
      fetchGw2ByIds("items", SIGIL_ITEM_IDS, lang),
      fetchGw2ByIds("items", INFUSION_ITEM_IDS, lang),
      fetchGw2ByIds("items", ENRICHMENT_ITEM_IDS, lang),
      fetchGw2ByIds("items", FOOD_ITEM_IDS, lang),
      fetchGw2ByIds("items", UTILITY_ITEM_IDS, lang),
      fetchGw2ByIds("items", RELIC_ITEM_IDS, lang),
    ]);

    const stripGw2Markup = (text) =>
      (text || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

    const mapItem = (item) => ({
      id: item.id,
      name: item.name || "",
      icon: item.icon || "",
      description: stripGw2Markup(item.description),
      bonuses: item.details?.bonuses || [],
      buffDescription: stripGw2Markup(item.details?.infix_upgrade?.buff?.description),
      infixUpgrade: item.details?.infix_upgrade || null,
    });

    const mapFood = (item) => {
      const apiDesc = item.details?.description || "";
      const overrideDesc = FOOD_BUFF_OVERRIDES.get(item.id);
      const rawBuff = overrideDesc || apiDesc;
      return {
        id: item.id,
        name: item.name || "",
        icon: item.icon || "",
        rarity: item.rarity || "",
        level: item.level || 0,
        buff: stripGw2Markup(rawBuff.replace(/\n/g, " | ")),
        duration: item.details?.duration_ms ? Math.round(item.details.duration_ms / 60000) : 0,
      };
    };

    const mapUtility = (item) => ({
      id: item.id,
      name: item.name || "",
      icon: item.icon || "",
      rarity: item.rarity || "",
      level: item.level || 0,
      buff: stripGw2Markup((item.details?.description || "").replace(/\n/g, " | ")),
      duration: item.details?.duration_ms ? Math.round(item.details.duration_ms / 60000) : 0,
    });

    const catalog = {
      runes: runeItems.map(mapItem).sort((a, b) => a.name.localeCompare(b.name)),
      sigils: sigilItems.map(mapItem).sort((a, b) => a.name.localeCompare(b.name)),
      infusions: infusionItems.map((item) => ({ ...mapItem(item), category: WVW_INFUSION_IDS.has(item.id) ? "wvw" : "pve" })).sort((a, b) => a.name.localeCompare(b.name)),
      enrichments: enrichmentItems.map(mapItem).sort((a, b) => a.name.localeCompare(b.name)),
      relics: relicItems.map((item) => {
        const mapped = mapItem(item);
        const relicData = _relicFactsIndex[String(item.id)];
        if (relicData?.facts?.length) mapped.facts = relicData.facts;
        return mapped;
      }).sort((a, b) => a.name.localeCompare(b.name)),
      foods: foodItems.filter((item) => item.details?.type === "Food").map(mapFood).sort((a, b) => a.name.localeCompare(b.name)),
      utilities: utilityItems.filter((item) => item.details?.type === "Utility").map(mapUtility).sort((a, b) => a.name.localeCompare(b.name)),
    };

    catalog.runeById = new Map(catalog.runes.map((r) => [r.id, r]));
    catalog.sigilById = new Map(catalog.sigils.map((s) => [s.id, s]));
    catalog.infusionById = new Map(catalog.infusions.map((i) => [i.id, i]));
    catalog.enrichmentById = new Map(catalog.enrichments.map((e) => [e.id, e]));
    catalog.relicByName = new Map(catalog.relics.map((r) => [r.name, r]));
    catalog.foodById = new Map(catalog.foods.map((f) => [f.id, f]));
    catalog.utilityById = new Map(catalog.utilities.map((u) => [u.id, u]));

    _upgradeCatalogCache = catalog;
    return catalog;
  })();

  try {
    return await _upgradeCatalogPromise;
  } finally {
    _upgradeCatalogPromise = null;
  }
}

module.exports = {
  getProfessionList,
  getProfessionCatalog,
  getUpgradeCatalog,
  applyBalanceSplit,
};
