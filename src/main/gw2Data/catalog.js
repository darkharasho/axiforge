const {
  GW2_API_ROOT,
  fetchCachedJson,
  fetchGw2ByIds,
  dedupeNumbers,
} = require("./fetch");
const { WikiClient } = require("../../../packages/gw2-data/src/wiki/client");
const { DiskCache } = require("../../../packages/gw2-data/src/wiki/cache");
const { resolveEntityFacts } = require("../../../packages/gw2-data/src/wiki/resolver");
const path = require("node:path");

// Static snapshots of stable GW2 API data — these change only with expansions.
// To update: re-fetch from the API and overwrite the JSON files.
let PROFESSIONS_STATIC = require("./professions.json");
let SPECIALIZATIONS_STATIC = require("./specializations.json");
let LEGENDS_STATIC = require("./legends.json");

// Allow tests to inject mock data instead of the on-disk snapshots.
function _setStaticData({ professions, specializations, legends } = {}) {
  PROFESSIONS_STATIC = professions || require("./professions.json");
  SPECIALIZATIONS_STATIC = specializations || require("./specializations.json");
  LEGENDS_STATIC = legends || require("./legends.json");
}

let _wikiClient = null;
const _catalogCache = new Map();
const _catalogInflight = new Map();

function initWikiClient(cacheDir) {
  const cache = new DiskCache(path.join(cacheDir, "wiki-facts"));
  _wikiClient = new WikiClient({ cache, cacheTTL: 7 * 24 * 60 * 60 * 1000 });
}

function getWikiClient() {
  if (!_wikiClient) {
    _wikiClient = new WikiClient();
  }
  return _wikiClient;
}

function clearCatalogCache() {
  _catalogCache.clear();
}

/**
 * Transfer icons from API facts to wiki facts that lack them.
 * Wiki-parsed facts have accurate values but no icon URLs; API facts have
 * per-fact icons. Match by type + key field (status for Buffs, text for others).
 */
function _transferIcons(apiFacts, wikiFacts) {
  if (!apiFacts?.length || !wikiFacts?.length) return;
  // Build a lookup from the API facts: type+key → icon
  const iconMap = new Map();
  for (const f of apiFacts) {
    if (!f.icon) continue;
    // For Buff-type facts, key by status; for others, key by text
    const key = f.status
      ? `${f.type || ""}|status:${f.status}`
      : `${f.type || ""}|text:${f.text || ""}`;
    if (!iconMap.has(key)) iconMap.set(key, f.icon);
  }
  for (const wf of wikiFacts) {
    if (wf.icon) continue;
    // Try matching by status first (Buff facts), then by text, then by type only
    const statusKey = wf.status ? `${wf.type || ""}|status:${wf.status}` : null;
    // Strip "(effect)" suffix for matching — wiki uses "Signet of Fury (effect)"
    // but API uses "Signet of Fury"
    const cleanStatus = wf.status?.replace(/\s*\(effect\)\s*$/i, "");
    const cleanStatusKey = cleanStatus ? `${wf.type || ""}|status:${cleanStatus}` : null;
    const textKey = `${wf.type || ""}|text:${wf.text || ""}`;
    const icon = (statusKey && iconMap.get(statusKey))
      || (cleanStatusKey && iconMap.get(cleanStatusKey))
      || iconMap.get(textKey);
    if (icon) wf.icon = icon;
  }
}

function applyWikiFacts(entity, wikiFactsById, overridesMap) {
  // Emergency overrides always win
  if (overridesMap.has(entity.id)) return;

  const wikiFacts = wikiFactsById.get(entity.id);
  if (!wikiFacts) return; // No wiki page — keep API facts

  // Only replace facts if wiki actually has fact templates
  if (wikiFacts.pve.length > 0) {
    _transferIcons(entity.facts, wikiFacts.pve);
    entity.facts = wikiFacts.pve;
  }
  entity.hasSplit = wikiFacts.hasSplit;

  if (wikiFacts.wvw) {
    _transferIcons(entity.wvwFacts || entity.facts, wikiFacts.wvw);
    entity.wvwFacts = wikiFacts.wvw;
  }
  if (wikiFacts.pvp) {
    _transferIcons(entity.pvpFacts || entity.facts, wikiFacts.pvp);
    entity.pvpFacts = wikiFacts.pvp;
  }

  // Infobox timings (recharge, activation) — per-mode
  if (wikiFacts.recharge) entity.recharge = wikiFacts.recharge;
  if (wikiFacts.activation) entity.activation = wikiFacts.activation;
}

const {
  KNOWN_SKILL_DESCRIPTION_OVERRIDES,
  KNOWN_SKILL_FACTS_OVERRIDES,
  KNOWN_TRAIT_FACTS_OVERRIDES,
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

// Pet ID → wiki family name for disambiguation of pet skills.
// The GW2 API does not expose pet family; this is derived from the wiki's naming convention.
// Unique pets (e.g. Bristleback, Smokescale) are omitted — their skills rarely collide.
const PET_ID_TO_FAMILY = new Map([
  // Avian
  [44, "avian"], [10, "avian"], [32, "avian"], [30, "avian"], [31, "avian"], [72, "avian"],
  // Bear
  [23, "bear"], [20, "bear"], [24, "bear"], [25, "bear"], [5, "bear"],
  // Canine
  [8, "canine"], [29, "canine"], [4, "canine"], [28, "canine"], [22, "canine"],
  // Devourer
  [6, "devourer"], [26, "devourer"], [27, "devourer"],
  // Drake
  [18, "drake"], [7, "drake"], [45, "drake"], [19, "drake"], [12, "drake"],
  // Feline
  [9, "feline"], [3, "feline"], [11, "feline"], [54, "feline"], [47, "feline"],
  [55, "feline"], [1, "feline"], [63, "feline"], [70, "feline"],
  // Jellyfish
  [41, "jellyfish"], [43, "jellyfish"], [42, "jellyfish"],
  // Moa
  [13, "moa"], [15, "moa"], [16, "moa"], [17, "moa"], [14, "moa"],
  // Porcine
  [38, "porcine"], [37, "porcine"], [2, "porcine"], [39, "porcine"], [64, "porcine"],
  // Spider
  [33, "spider"], [34, "spider"], [36, "spider"], [35, "spider"],
  // Wyvern
  [48, "wyvern"], [51, "wyvern"],
]);

async function getProfessionList(lang = "en") {
  return PROFESSIONS_STATIC
    .filter((entry) => entry?.id)
    .map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      icon: entry.icon || "",
      iconBig: entry.icon_big || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function _buildProfessionCatalog(professionId, lang = "en", gameMode = "pve") {
  // Step 1: look up profession from static snapshot — this data rarely changes.
  const profession = PROFESSIONS_STATIC.find((p) => p.id === professionId);
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
    ? fetchCachedJson(`pets:${lang}`, `${GW2_API_ROOT}/pets?ids=all&lang=${encodeURIComponent(lang)}`, 1000 * 60 * 60 * 24 * 7)
    : Promise.resolve([]);
  const legendsRawPromise = professionId === "Revenant"
    ? Promise.resolve(LEGENDS_STATIC)
    : Promise.resolve([]);

  const specIdSet = new Set(specializationIds);
  const specializations = SPECIALIZATIONS_STATIC.filter((s) => specIdSet.has(s.id));
  const [professionSkillsRawApi, weaponSkillsBase] = await Promise.all([
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

  // Collect ALL trait skill IDs (including non-elite spec traits) so that
  // trait-associated skills (e.g. Lesser Signet of the Locust from Malicious Swarm)
  // are available in skillById for hover preview display.
  const allTraitSkillIds = new Set();
  for (const trait of traits) {
    if (!Array.isArray(trait.skills)) continue;
    for (const ts of trait.skills) {
      const skillId = Number(ts?.id);
      if (skillId) allTraitSkillIds.add(skillId);
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
      1000 * 60 * 60 * 24 * 7
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
  const traitSkillIdsToFetch = [...new Set([...traitSkillTagMap.keys(), ...allTraitSkillIds])].filter((id) => !alreadyFetchedForTraits.has(id));

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

  // Weapon Swap is a game mechanic, not a GW2 API skill — inject a synthetic entry
  // so it appears in the Notes @ mention autocomplete for professions that support it.
  const hasWeaponSwap = !(profession.flags || []).includes("NoWeaponSwap");
  if (hasWeaponSwap) {
    skills.push({
      id: 999999, name: "Weapon Swap", icon: "https://wiki.guildwars2.com/images/c/ce/Weapon_Swap_Button.png",
      slot: "", type: "Profession", specialization: 0, professions: [professionId],
      weapon_type: "None", attunement: "None", dual_attunement: "None",
      categories: [], facts: [], bundle_skills: [], transform_skills: [],
      toolbelt_skill: 0, flip_skill: 0,
      description: "Swap between your two equipped weapon sets.",
    });
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

  // Hoist entity mapping
  const mappedSpecializations = specializations.map((spec) => ({
    id: spec.id,
    name: spec.name || "",
    profession: spec.profession || "",
    elite: Boolean(spec.elite),
    icon: spec.icon || "",
    background: spec.background || "",
    minorTraits: Array.isArray(spec.minor_traits) ? spec.minor_traits : [],
    majorTraits: Array.isArray(spec.major_traits) ? spec.major_traits : [],
  }));

  const mappedTraits = traits.map((trait) => {
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
      facts: KNOWN_TRAIT_FACTS_OVERRIDES.get(trait.id) || (Array.isArray(trait.facts) ? trait.facts.filter((f) => !f.requires_trait) : []),
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
    return mapped;
  });

  const mappedSkills = skills.map(mapSkill);

  const mappedWeaponSkills = weaponSkillsRaw.map((skill) => {
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
      facts: Array.isArray(skill.facts) ? skill.facts.filter((f) => !f.requires_trait) : [],
      traitedFacts: Array.isArray(skill.traited_facts) ? skill.traited_facts : [],
      flipSkill: Number(skill.flip_skill) || 0,
    };
    return mapped;
  });

  // ── Wiki fact resolution ─────────────────────────────────────────────────
  // Build per-entity id → wiki title map. Each entity gets a wiki title to look up;
  // the resolver deduplicates fetches by title and uses infobox ID matching to
  // route the right facts to the right entity when names collide.
  //
  // Most entities use their bare display name. Pet family skills get pre-disambiguated
  // with family names (e.g. "Maul (porcine)") because the wiki consistently uses this
  // convention — this avoids extra round-trips for the resolver's prefix search fallback.
  //
  // NOTE: Pet skill IDs also appear in mappedSkills (Ranger's profession.skills lists
  // them as Profession_1 slots), so we must build the pet family map BEFORE iterating
  // entities to ensure disambiguation applies regardless of which array contributes the ID.

  // Build skill ID → pet family name lookup from pets data
  const petFamilyBySkillId = new Map();
  for (const pet of pets) {
    const family = PET_ID_TO_FAMILY.get(pet.id) || "";
    if (!family) continue;
    for (const skill of pet.skills) {
      if (skill.id && !petFamilyBySkillId.has(skill.id)) {
        petFamilyBySkillId.set(skill.id, family);
      }
    }
  }

  // First pass: add all entities with bare names (deduplicated by ID)
  const idToTitle = new Map();
  const seenIds = new Set();

  for (const entity of [...mappedSkills, ...mappedTraits, ...mappedWeaponSkills]) {
    if (!entity.name || seenIds.has(entity.id)) continue;
    // Skip synthetic/placeholder entries that have no wiki pages
    if (entity.id === 999999 || entity.name === "Locked") continue;
    seenIds.add(entity.id);
    idToTitle.set(entity.id, entity.name);
  }

  // Add pet skills not already covered by mappedSkills
  for (const pet of pets) {
    for (const skill of pet.skills) {
      if (!skill.name || seenIds.has(skill.id)) continue;
      seenIds.add(skill.id);
      idToTitle.set(skill.id, skill.name);
    }
  }

  // Second pass: disambiguate pet family skills whose bare name collides with
  // another entity. Only add "(family)" suffixes when the name is shared — unique
  // pet skill names resolve to their bare wiki page just fine.
  const nameToIds = new Map();
  for (const [id, title] of idToTitle) {
    if (!nameToIds.has(title)) nameToIds.set(title, []);
    nameToIds.get(title).push(id);
  }
  for (const [id, title] of idToTitle) {
    const family = petFamilyBySkillId.get(id);
    if (family && nameToIds.get(title).length > 1) {
      idToTitle.set(id, `${title} (${family})`);
    }
  }

  let wikiFactsById = new Map();
  try {
    const client = getWikiClient();
    wikiFactsById = await resolveEntityFacts(client, idToTitle, { profession: profession.name || professionId });
  } catch (err) {
    try { console.warn("[catalog] Wiki fact resolution failed, using API facts:", err.message); } catch (_) {}
  }

  for (const s of mappedSkills) {
    applyWikiFacts(s, wikiFactsById, KNOWN_SKILL_FACTS_OVERRIDES);
  }
  for (const t of mappedTraits) {
    applyWikiFacts(t, wikiFactsById, KNOWN_TRAIT_FACTS_OVERRIDES);
  }
  for (const ws of mappedWeaponSkills) {
    applyWikiFacts(ws, wikiFactsById, KNOWN_SKILL_FACTS_OVERRIDES);
  }
  // Apply wiki facts to pet skills (nested inside pets[].skills[])
  for (const pet of pets) {
    for (const skill of pet.skills) {
      const wikiFacts = wikiFactsById.get(skill.id);
      if (!wikiFacts) continue;
      if (wikiFacts.pve.length > 0) skill.facts = wikiFacts.pve;
      skill.hasSplit = wikiFacts.hasSplit;
      if (wikiFacts.wvw) skill.wvwFacts = wikiFacts.wvw;
      if (wikiFacts.pvp) skill.pvpFacts = wikiFacts.pvp;
      if (wikiFacts.recharge) skill.recharge = wikiFacts.recharge;
      if (wikiFacts.activation) skill.activation = wikiFacts.activation;
    }
  }

  // Log missing pages for monitoring
  const resolved = new Set([...wikiFactsById.keys()]).size;
  const total = idToTitle.size;
  if (resolved < total) {
    const missingIds = [...idToTitle.keys()].filter((id) => !wikiFactsById.has(id));
    const missingNames = [...new Set(missingIds.map((id) => idToTitle.get(id)))];
    const preview = missingNames.slice(0, 10).join(", ");
    const extra = missingNames.length > 10 ? ` (+${missingNames.length - 10} more)` : "";
    try { console.warn(`[catalog] Wiki facts: ${resolved}/${total} resolved. Missing: ${preview}${extra}`); } catch (_) {}
  }

  const catalog = {
    profession: { id: profession.id, name: profession.name || profession.id, icon: profession.icon || "", iconBig: profession.icon_big || "" },
    specializations: mappedSpecializations,
    traits: mappedTraits,
    skills: mappedSkills,
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
    weaponSkills: mappedWeaponSkills,
    legends,
    pets,
    gameMode: gameMode || "pve",
    updatedAt: new Date().toISOString(),
  };

  return catalog;
}

async function getProfessionCatalog(professionId, lang = "en", gameMode = "pve") {
  if (!professionId) {
    throw new Error("Missing profession id.");
  }

  const cacheKey = `${professionId}:${lang}:${gameMode}`;
  if (_catalogCache.has(cacheKey)) return _catalogCache.get(cacheKey);
  if (_catalogInflight.has(cacheKey)) return _catalogInflight.get(cacheKey);

  const promise = _buildProfessionCatalog(professionId, lang, gameMode);
  _catalogInflight.set(cacheKey, promise);

  try {
    const catalog = await promise;
    _catalogCache.set(cacheKey, catalog);
    return catalog;
  } finally {
    _catalogInflight.delete(cacheKey);
  }
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
    const _relicFactsPath = require("path").join(__dirname, "relicFacts.json");
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
  _setStaticData,
  initWikiClient,
  getWikiClient,
  clearCatalogCache,
  _transferIcons,
};
