// Editor state management: consistency enforcement, serialization, build loading/saving.

import { state, createEmptyEditor } from "./state.js";
import { parseTags, simplifyTrait, simplifySkill } from "./utils.js";
import { getMajorTraitsByTier } from "./specializations.js";
import { ANTIQUARY_PROLIFIC_PLUNDERER_TRAIT_ID, UNDERWATER_BLOCKED_LEGENDS, GW2_WEAPONS_BY_ID } from "./constants.js";

// Normalize sigil array to correct shape for a given slot key.
export function normalizeSigilArray(value, slotKey) {
  const isOffhand = slotKey.startsWith("offhand");
  const expectedLen = isOffhand ? 1 : 2;
  if (!Array.isArray(value)) return Array(expectedLen).fill("");
  const arr = value.slice(0, expectedLen).map((v) => String(v || ""));
  while (arr.length < expectedLen) arr.push("");
  return arr;
}

// Normalize infusion value — arrays for multi-slot items (back, rings), strings otherwise.
export const INFUSION_ARRAY_SLOTS = {
  back: 2, ring1: 3, ring2: 3,
  mainhand1: 2, offhand1: 1, mainhand2: 2, offhand2: 1,
  aquatic1: 2, aquatic2: 2, breather: 1,
};

export function normalizeInfusionValue(value, slotKey) {
  const expectedLen = INFUSION_ARRAY_SLOTS[slotKey];
  if (!expectedLen) return String(value || "");
  if (!Array.isArray(value)) return Array(expectedLen).fill("");
  const arr = value.slice(0, expectedLen).map((v) => String(v || ""));
  while (arr.length < expectedLen) arr.push("");
  return arr;
}

// ---------------------------------------------------------------------------
// Callback injection (avoids circular deps with render-pages.js / skills.js)
// ---------------------------------------------------------------------------

let _renderBuildList = () => {};
let _renderEditorMeta = () => {};
let _renderSpecializations = () => {};
let _renderSkills = () => {};
let _renderEquipmentPanel = () => {};
let _syncRevenantSkillsFromLegend = () => {};
let _getSkillOptionsByType = () => ({});
let _setProfession = async () => {};

export function initEditorCallbacks({
  renderBuildList,
  renderEditorMeta,
  renderSpecializations,
  renderSkills,
  renderEquipmentPanel,
  syncRevenantSkillsFromLegend,
  getSkillOptionsByType,
  setProfession,
}) {
  if (renderBuildList) _renderBuildList = renderBuildList;
  if (renderEditorMeta) _renderEditorMeta = renderEditorMeta;
  if (renderSpecializations) _renderSpecializations = renderSpecializations;
  if (renderSkills) _renderSkills = renderSkills;
  if (renderEquipmentPanel) _renderEquipmentPanel = renderEquipmentPanel;
  if (syncRevenantSkillsFromLegend) _syncRevenantSkillsFromLegend = syncRevenantSkillsFromLegend;
  if (getSkillOptionsByType) _getSkillOptionsByType = getSkillOptionsByType;
  if (setProfession) _setProfession = setProfession;
}

// ---------------------------------------------------------------------------
// Specialization / skill selection helpers
// ---------------------------------------------------------------------------

export function createDefaultSpecializationSelections(_catalog) {
  // Start with three empty spec slots — the user picks each one.
  return [
    { specializationId: 0, majorChoices: { 1: 0, 2: 0, 3: 0 } },
    { specializationId: 0, majorChoices: { 1: 0, 2: 0, 3: 0 } },
    { specializationId: 0, majorChoices: { 1: 0, 2: 0, 3: 0 } },
  ];
}

export function createSpecializationSelection(spec, _catalog) {
  // Assign the spec but leave trait choices blank — the user picks each one.
  return {
    specializationId: Number(spec.id),
    majorChoices: { 1: 0, 2: 0, 3: 0 },
  };
}

export function createDefaultSkillSelections(_catalog, _specializations) {
  // Start with blank skill slots — the user picks each one.
  return {
    healId: 0,
    utilityIds: [0, 0, 0],
    eliteId: 0,
  };
}

// ---------------------------------------------------------------------------
// Editor consistency enforcement
// ---------------------------------------------------------------------------

export function enforceEditorConsistency(options = {}) {
  const catalog = state.activeCatalog;
  if (!catalog) return;

  const specs = Array.isArray(catalog.specializations) ? catalog.specializations : [];
  const used = new Set();
  const nextSpecs = [];
  for (let i = 0; i < 3; i += 1) {
    const current = state.editor.specializations[i] || {};
    const currentId = Number(current.specializationId) || 0;

    // Empty slot is valid — preserve it as-is.
    if (!currentId) {
      nextSpecs.push({ specializationId: 0, majorChoices: { 1: 0, 2: 0, 3: 0 } });
      continue;
    }

    let spec = catalog.specializationById.get(currentId) || null;
    if (!spec || used.has(spec.id)) {
      // Invalid or duplicate — clear the slot rather than auto-picking a replacement.
      nextSpecs.push({ specializationId: 0, majorChoices: { 1: 0, 2: 0, 3: 0 } });
      continue;
    }
    used.add(spec.id);
    const majors = getMajorTraitsByTier(spec, catalog);
    // If traitChoices (from axicode import) exist and majorChoices are all 0,
    // resolve the 1-based position indices to actual trait IDs.
    // Check both _traitChoices (normalized imports) and traitChoices (raw axicode saves).
    const tc = Array.isArray(current._traitChoices) ? current._traitChoices
      : Array.isArray(current.traitChoices) ? current.traitChoices : null;
    const resolveForTier = (tier) => {
      const existing = current.majorChoices?.[tier];
      if (existing) return chooseTraitId(existing, majors[tier]);
      if (tc) {
        const posIdx = (Number(tc[tier - 1]) || 1) - 1;
        const resolved = Number(majors[tier]?.[posIdx]?.id) || 0;
        if (resolved) return resolved;
      }
      return chooseTraitId(0, majors[tier]);
    };
    nextSpecs.push({
      specializationId: spec.id,
      majorChoices: {
        1: resolveForTier(1),
        2: resolveForTier(2),
        3: resolveForTier(3),
      },
    });
  }
  const preferredEliteSlot = Number(options.preferredEliteSlot);
  const eliteSlots = nextSpecs
    .map((entry, index) => {
      const spec = catalog.specializationById.get(Number(entry.specializationId));
      return spec?.elite ? index : -1;
    })
    .filter((index) => index >= 0);
  if (eliteSlots.length > 1) {
    const keepSlot = eliteSlots.includes(preferredEliteSlot) ? preferredEliteSlot : eliteSlots[0];
    for (const slot of eliteSlots) {
      if (slot === keepSlot) continue;
      // Clear the conflicting elite slot rather than auto-picking a replacement.
      nextSpecs[slot] = { specializationId: 0, majorChoices: { 1: 0, 2: 0, 3: 0 } };
    }
  }

  state.editor.specializations = nextSpecs;

  // Clear Antiquary artifact draws when Antiquary is no longer the active elite spec.
  if (!nextSpecs.some((e) => Number(e?.specializationId) === 77)) {
    state.editor.antiquaryArtifacts = { f2: 0, f3: 0, f4: 0 };
  } else if (state.editor.antiquaryArtifacts) {
    // Antiquary active: clear f4 if Prolific Plunderer is no longer selected.
    const aqEntry = nextSpecs.find((e) => Number(e?.specializationId) === 77);
    const prolificActive = Object.values(aqEntry?.majorChoices || {})
      .some((id) => Number(id) === ANTIQUARY_PROLIFIC_PLUNDERER_TRAIT_ID);
    if (!prolificActive) state.editor.antiquaryArtifacts.f4 = 0;
  }

  // Revenant: skills are locked to the active legend; skip normal skill-options enforcement.
  // Instead, sync from the selected legend (or set defaults if no legend is selected yet).
  const isRevenant = Array.isArray(catalog.legends) && catalog.legends.length > 0;
  if (isRevenant) {
    if (!state.editor.selectedLegends) state.editor.selectedLegends = ["", ""];
    // Clear legends that require an elite spec the player no longer has
    const selectedSpecIds = new Set(
      (state.editor.specializations || []).map((s) => Number(s?.specializationId) || 0).filter(Boolean)
    );
    const isLegendValid = (legendId) => {
      if (!legendId) return false;
      const legend = catalog.legendById.get(legendId);
      if (!legend) return false;
      const swapSkill = legend.swap ? catalog.skillById.get(legend.swap) : null;
      const reqSpec = Number(swapSkill?.specialization) || 0;
      return !reqSpec || selectedSpecIds.has(reqSpec);
    };
    if (!isLegendValid(state.editor.selectedLegends[0])) state.editor.selectedLegends[0] = "";
    if (!isLegendValid(state.editor.selectedLegends[1])) state.editor.selectedLegends[1] = "";
    // Reset Alliance form if Alliance legend is no longer selected
    const allianceSelected = state.editor.selectedLegends[0] === "Legend7" || state.editor.selectedLegends[1] === "Legend7";
    if (!allianceSelected) state.editor.allianceTacticsForm = 0;
    // Default to first two valid legends if none selected
    const validLegends = (catalog.legends || []).filter((l) => {
      const swapSkill = l.swap ? catalog.skillById.get(l.swap) : null;
      const reqSpec = Number(swapSkill?.specialization) || 0;
      return !reqSpec || selectedSpecIds.has(reqSpec);
    });
    if (!state.editor.selectedLegends[0]) {
      const pick = validLegends.find((l) => l.id !== state.editor.selectedLegends[1]);
      if (pick) state.editor.selectedLegends[0] = pick.id;
    }
    if (!state.editor.selectedLegends[1]) {
      const pick = validLegends.find((l) => l.id !== state.editor.selectedLegends[0]);
      if (pick) state.editor.selectedLegends[1] = pick.id;
    }
    _syncRevenantSkillsFromLegend(catalog);
  } else {
    const skillOptions = _getSkillOptionsByType(catalog, state.editor.specializations);
    const utilityIds = Array.isArray(state.editor.skills.utilityIds)
      ? state.editor.skills.utilityIds.map((value) => Number(value) || 0).slice(0, 3)
      : [];
    while (utilityIds.length < 3) utilityIds.push(0);

    state.editor.skills.healId = chooseSkillId(state.editor.skills.healId, skillOptions.heal);
    state.editor.skills.eliteId = chooseSkillId(state.editor.skills.eliteId, skillOptions.elite);

    const usedUtility = new Set();
    state.editor.skills.utilityIds = utilityIds.map((value) => {
      const selected = chooseSkillId(value, skillOptions.utility, usedUtility);
      if (selected) usedUtility.add(selected);
      return selected;
    });
  }

  if (state.editor.underwaterSkills) {
    const uwHealId = Number(state.editor.underwaterSkills.healId) || 0;
    const uwEliteId = Number(state.editor.underwaterSkills.eliteId) || 0;
    const uwUtilityIds = state.editor.underwaterSkills.utilityIds || [0, 0, 0];

    if (isRevenant) {
      const activeLegend = state.editor.selectedLegends?.[state.editor.activeLegendSlot];
      if (UNDERWATER_BLOCKED_LEGENDS.has(activeLegend)) {
        state.editor.underwaterSkills = { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 };
      }
    } else {
      const skillOptions = _getSkillOptionsByType(catalog, state.editor.specializations, true);
      const isValidUW = (id, list) => !id || list.some((s) => s.id === id);

      if (!isValidUW(uwHealId, skillOptions.heal || [])) state.editor.underwaterSkills.healId = 0;
      if (!isValidUW(uwEliteId, skillOptions.elite || [])) state.editor.underwaterSkills.eliteId = 0;
      for (let i = 0; i < 3; i++) {
        if (!isValidUW(uwUtilityIds[i], skillOptions.utility || [])) state.editor.underwaterSkills.utilityIds[i] = 0;
      }
    }
  }

  // Weaver: primary (mainhand) is always set; secondary (offhand) can be any element including
  // the same as primary, producing a single-attunement skill bar (identical to core Ele slot 3).
  const weaverEliteId = 56;
  const activeEliteSpecId = Number(
    (state.editor.specializations || [])
      .map((e) => Number(e?.specializationId))
      .find((id) => catalog.specializationById.get(id)?.elite)
  ) || 0;
  if (activeEliteSpecId === weaverEliteId) {
    const attunements = ["Fire", "Water", "Air", "Earth"];
    if (!state.editor.activeAttunement || !attunements.includes(state.editor.activeAttunement)) {
      state.editor.activeAttunement = "Fire";
    }
    // Secondary defaults to primary (single-attunement start state); any valid element is accepted.
    if (!state.editor.activeAttunement2 || !attunements.includes(state.editor.activeAttunement2)) {
      state.editor.activeAttunement2 = state.editor.activeAttunement;
    }
  }

  // Clear weapons that the new profession cannot equip.
  // Guard: only clear when we have weapon data to validate against.  Without
  // professionWeapons every lookup returns undefined and all weapons are wiped,
  // which is the root cause of the "save deletes weapons" bug.
  const profWeapons = catalog.professionWeapons || {};
  const hasProfWeapons = Object.keys(profWeapons).length > 0;
  const equip = state.editor.equipment;
  if (hasProfWeapons && equip?.weapons) {
    for (const [key, weaponId] of Object.entries(equip.weapons)) {
      if (!weaponId) continue;
      const wData = profWeapons[weaponId];
      // If the weapon isn't in professionWeapons at all, the profession cannot
      // equip it — clear it.  If it IS present, check flag compatibility.
      const isOffhand = key.startsWith("offhand");
      const isMainhand = key.startsWith("mainhand");
      let valid = false;
      if (wData) {
        if (isOffhand) valid = wData.flags.includes("Offhand");
        else if (isMainhand) valid = wData.flags.includes("Mainhand") || wData.flags.includes("TwoHand");
        else {
          // Aquatic slot: weapon must have the Aquatic flag AND at least one non-NoUnderwater skill
          valid = wData.flags.includes("Aquatic") && wData.skills.some((ref) => {
            const skill = catalog.weaponSkillById?.get(ref.id);
            return skill && !(skill.flags || []).includes("NoUnderwater");
          });
        }
      }
      if (!valid) {
        equip.weapons[key] = "";
        if (equip.slots?.[key] !== undefined) equip.slots[key] = "";
        // Clear associated upgrades
        if (equip.sigils?.[key]) {
          equip.sigils[key] = key.startsWith("offhand") ? [""] : ["", ""];
        }
        if (equip.infusions?.[key] !== undefined) equip.infusions[key] = "";
      }
    }

    // Clear offhand infusions/sigils when the corresponding mainhand has a two-handed
    // weapon equipped (offhand slot is locked — ghost upgrades contribute phantom stats).
    for (const [mainKey, ofKey] of [["mainhand1", "offhand1"], ["mainhand2", "offhand2"]]) {
      const mainWeapon = equip.weapons?.[mainKey] || "";
      if (!mainWeapon) continue;
      const isTwoHand = (profWeapons[mainWeapon]?.flags || []).includes("TwoHand")
        || GW2_WEAPONS_BY_ID.get(mainWeapon)?.hand === "two";
      if (!isTwoHand) continue;
      if (equip.sigils?.[ofKey]?.some(Boolean)) equip.sigils[ofKey] = [""];
      if (equip.infusions?.[ofKey]?.some?.(Boolean)) equip.infusions[ofKey] = [""];
    }
  }
}

// ---------------------------------------------------------------------------
// Trait / skill choosers
// ---------------------------------------------------------------------------

export function chooseTraitId(currentId, options) {
  const id = Number(currentId) || 0;
  if (!id) return 0; // Blank selection is intentional — don't auto-fill.
  if (Array.isArray(options) && options.some((entry) => Number(entry.id) === id)) {
    return id;
  }
  return 0; // Trait not found in this spec — clear rather than guess.
}

export function chooseSkillId(currentId, options, usedSet = null) {
  const id = Number(currentId) || 0;
  if (!id) return 0; // Blank slot is intentional — don't auto-fill.
  if (
    Array.isArray(options) &&
    options.some((entry) => Number(entry.id) === id) &&
    (!usedSet || !usedSet.has(id))
  ) {
    return id;
  }
  return 0; // Skill not valid for current build — clear rather than guess.
}

// ---------------------------------------------------------------------------
// Dirty-state tracking
// ---------------------------------------------------------------------------

export function confirmDiscardDirty(actionLabel) {
  if (!state.editorDirty) return true;
  return window.confirm(`Unsaved changes will be lost. ${actionLabel}?`);
}

export function markEditorChanged(options = {}) {
  state.editorDirty = computeEditorSignature() !== state.editorBaselineSignature;
  if (options.updateBuildList) {
    _renderBuildList();
  }
  if (options.updateMeta !== false) {
    _renderEditorMeta();
  }
}

export function captureEditorBaseline() {
  state.editorBaselineSignature = computeEditorSignature();
  state.editorDirty = false;
  _renderEditorMeta();
}

export function computeUnsavedChangeSummary() {
  if (!state.editorBaselineSignature) return [];
  let baseline;
  try { baseline = JSON.parse(state.editorBaselineSignature); }
  catch { return []; }
  let current;
  try { current = JSON.parse(computeEditorSignature()); }
  catch { return []; }

  const changes = [];
  if (baseline.title !== current.title) changes.push("Title changed");
  if (JSON.stringify(baseline.specializations) !== JSON.stringify(current.specializations)) changes.push("Specializations modified");
  if (JSON.stringify(baseline.skills) !== JSON.stringify(current.skills)
    || JSON.stringify(baseline.underwaterSkills) !== JSON.stringify(current.underwaterSkills)) changes.push("Skills modified");
  if (JSON.stringify(baseline.equipment) !== JSON.stringify(current.equipment)) changes.push("Equipment modified");
  if (baseline.notes !== current.notes) changes.push("Notes modified");
  if (JSON.stringify(baseline.tags) !== JSON.stringify(current.tags)) changes.push("Tags modified");
  if (baseline.gameMode !== current.gameMode) changes.push("Game mode changed");
  if (JSON.stringify(baseline.selectedUnderwaterLegends) !== JSON.stringify(current.selectedUnderwaterLegends)) changes.push("Legends modified");
  return changes;
}

export function computeEditorSignature() {
  const editor = state.editor || createEmptyEditor();
  const specializations = (editor.specializations || []).slice(0, 3).map((entry) => ({
    specializationId: Number(entry?.specializationId) || 0,
    majorChoices: {
      1: Number(entry?.majorChoices?.[1]) || 0,
      2: Number(entry?.majorChoices?.[2]) || 0,
      3: Number(entry?.majorChoices?.[3]) || 0,
    },
  }));
  const utilityIds = Array.isArray(editor.skills?.utilityIds)
    ? editor.skills.utilityIds.slice(0, 3).map((value) => Number(value) || 0)
    : [0, 0, 0];
  while (utilityIds.length < 3) utilityIds.push(0);
  const payload = {
    title: String(editor.title || ""),
    profession: String(editor.profession || ""),
    tags: [...(editor.tags || [])],
    notes: String(editor.notes || ""),
    equipment: {
      statPackage: String(editor.equipment?.statPackage || ""),
      relic: String(editor.equipment?.relic || ""),
      food: String(editor.equipment?.food || ""),
      utility: String(editor.equipment?.utility || ""),
      slots: editor.equipment?.slots || {},
      weapons: editor.equipment?.weapons || {},
      runes: editor.equipment?.runes || {},
      sigils: editor.equipment?.sigils || {},
      infusions: editor.equipment?.infusions || {},
      enrichment: String(editor.equipment?.enrichment || ""),
    },
    specializations,
    skills: {
      healId: Number(editor.skills?.healId) || 0,
      utilityIds,
      eliteId: Number(editor.skills?.eliteId) || 0,
    },
    underwaterSkills: {
      healId: Number(editor.underwaterSkills?.healId) || 0,
      utilityIds: Array.isArray(editor.underwaterSkills?.utilityIds)
        ? editor.underwaterSkills.utilityIds.slice(0, 3).map((v) => Number(v) || 0)
        : [0, 0, 0],
      eliteId: Number(editor.underwaterSkills?.eliteId) || 0,
    },
    selectedUnderwaterLegends: Array.isArray(editor.selectedUnderwaterLegends)
      ? editor.selectedUnderwaterLegends.slice(0, 2).map(String)
      : ["", ""],
    gameMode: String(editor.gameMode || "pve"),
  };
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// Build import parsing
// ---------------------------------------------------------------------------

export function parseBuildImportPayload(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Clipboard does not contain valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Imported JSON must be an object.");
  }
  const source = parsed.build && typeof parsed.build === "object" ? parsed.build : parsed;
  const profession = resolveImportedProfession(source);
  const skills = normalizeImportedSkills(source);
  const underwaterSkills = normalizeImportedSkills({ skills: source.underwaterSkills || {} });
  const specializations = normalizeImportedSpecializations(source.specializations);
  const notes = String(source.notes || source.description || "");
  const tags = Array.isArray(source.tags)
    ? source.tags
    : typeof source.tagsText === "string"
      ? parseTags(source.tagsText)
      : [];
  return {
    id: "",
    title: String(source.title || source.name || "Imported Build"),
    profession,
    tags,
    notes,
    equipment: {
      statPackage: String(source.equipment?.statPackage || source.stats || ""),
      relic: String(source.equipment?.relic || ""),
      food: String(source.equipment?.food || ""),
      utility: String(source.equipment?.utility || ""),
      slots: {
        head: String(source.equipment?.slots?.head || ""),
        shoulders: String(source.equipment?.slots?.shoulders || ""),
        chest: String(source.equipment?.slots?.chest || ""),
        hands: String(source.equipment?.slots?.hands || ""),
        legs: String(source.equipment?.slots?.legs || ""),
        feet: String(source.equipment?.slots?.feet || ""),
        mainhand1: String(source.equipment?.slots?.mainhand1 || ""),
        offhand1: String(source.equipment?.slots?.offhand1 || ""),
        mainhand2: String(source.equipment?.slots?.mainhand2 || ""),
        offhand2: String(source.equipment?.slots?.offhand2 || ""),
        back: String(source.equipment?.slots?.back || ""),
        amulet: String(source.equipment?.slots?.amulet || ""),
        ring1: String(source.equipment?.slots?.ring1 || ""),
        ring2: String(source.equipment?.slots?.ring2 || ""),
        accessory1: String(source.equipment?.slots?.accessory1 || ""),
        accessory2: String(source.equipment?.slots?.accessory2 || ""),
        breather: String(source.equipment?.slots?.breather || ""),
        aquatic1: String(source.equipment?.slots?.aquatic1 || ""),
        aquatic2: String(source.equipment?.slots?.aquatic2 || ""),
      },
      weapons: {
        mainhand1: String(source.equipment?.weapons?.mainhand1 || ""),
        offhand1:  String(source.equipment?.weapons?.offhand1  || ""),
        mainhand2: String(source.equipment?.weapons?.mainhand2 || ""),
        offhand2:  String(source.equipment?.weapons?.offhand2  || ""),
        aquatic1:  String(source.equipment?.weapons?.aquatic1  || ""),
        aquatic2:  String(source.equipment?.weapons?.aquatic2  || ""),
      },
      runes: {
        head: String(source.equipment?.runes?.head || ""),
        shoulders: String(source.equipment?.runes?.shoulders || ""),
        chest: String(source.equipment?.runes?.chest || ""),
        hands: String(source.equipment?.runes?.hands || ""),
        legs: String(source.equipment?.runes?.legs || ""),
        feet: String(source.equipment?.runes?.feet || ""),
        breather: String(source.equipment?.runes?.breather || ""),
      },
      sigils: {
        mainhand1: normalizeSigilArray(source.equipment?.sigils?.mainhand1, "mainhand1"),
        offhand1: normalizeSigilArray(source.equipment?.sigils?.offhand1, "offhand1"),
        mainhand2: normalizeSigilArray(source.equipment?.sigils?.mainhand2, "mainhand2"),
        offhand2: normalizeSigilArray(source.equipment?.sigils?.offhand2, "offhand2"),
        aquatic1: normalizeSigilArray(source.equipment?.sigils?.aquatic1, "aquatic1"),
        aquatic2: normalizeSigilArray(source.equipment?.sigils?.aquatic2, "aquatic2"),
      },
      infusions: Object.fromEntries(
        Object.keys(createEmptyEditor().equipment.infusions).map((key) => [
          key,
          normalizeInfusionValue(source.equipment?.infusions?.[key], key),
        ])
      ),
      enrichment: String(source.equipment?.enrichment || ""),
    },
    specializations,
    skills,
    underwaterSkills,
    gameMode: String(source.gameMode || "pve"),
  };
}

export function resolveImportedProfession(source) {
  const raw = String(source?.profession || source?.professionId || source?.professionName || "").trim();
  if (!raw) return state.editor.profession || state.professions[0]?.id || "";
  if (state.professions.some((entry) => entry.id === raw)) return raw;
  const lower = raw.toLowerCase();
  const byName = state.professions.find((entry) => entry.name.toLowerCase() === lower);
  return byName?.id || raw;
}

export function normalizeImportedSpecializations(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((entry) => ({
    id: Number(entry?.id || entry?.specializationId) || 0,
    specializationId: Number(entry?.specializationId || entry?.id) || 0,
    majorChoices: {
      1: Number(entry?.majorChoices?.[1] || entry?.majorChoices?.adept) || 0,
      2: Number(entry?.majorChoices?.[2] || entry?.majorChoices?.master) || 0,
      3: Number(entry?.majorChoices?.[3] || entry?.majorChoices?.grandmaster) || 0,
    },
  }));
}

export function normalizeImportedSkills(source) {
  const skills = source?.skills && typeof source.skills === "object" ? source.skills : {};
  const healId = extractSkillId(skills.healId ?? skills.heal ?? source?.healId);
  const eliteId = extractSkillId(skills.eliteId ?? skills.elite ?? source?.eliteId);
  const utilityRaw = Array.isArray(skills.utilityIds)
    ? skills.utilityIds
    : Array.isArray(skills.utility)
      ? skills.utility
      : Array.isArray(source?.utilityIds)
        ? source.utilityIds
        : [];
  const utilityIds = utilityRaw
    .slice(0, 3)
    .map((entry) => extractSkillId(entry))
    .filter((value) => value > 0);
  return {
    heal: healId ? { id: healId } : null,
    utility: utilityIds.map((id) => ({ id })),
    elite: eliteId ? { id: eliteId } : null,
  };
}

export function extractSkillId(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" || typeof value === "string") return Number(value) || 0;
  if (typeof value === "object") {
    return Number(value.id || value.skillId || value.value) || 0;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Build loading / saving
// ---------------------------------------------------------------------------

export async function loadBuildIntoEditor(build, options = {}) {
  const profession = resolveLoadedBuildProfession(build);
  state.editor = {
    id: build.id || "",
    title: String(build.title || ""),
    profession,
    tags: Array.isArray(build.tags) ? [...build.tags] : [],
    notes: String(build.notes || ""),
    images: build.images && typeof build.images === "object" ? { ...build.images } : {},
    equipment: {
      statPackage: String(build.equipment?.statPackage || ""),
      relic: String(build.equipment?.relic || ""),
      food: String(build.equipment?.food || ""),
      utility: String(build.equipment?.utility || ""),
      slots: {
        head: String(build.equipment?.slots?.head || ""),
        shoulders: String(build.equipment?.slots?.shoulders || ""),
        chest: String(build.equipment?.slots?.chest || ""),
        hands: String(build.equipment?.slots?.hands || ""),
        legs: String(build.equipment?.slots?.legs || ""),
        feet: String(build.equipment?.slots?.feet || ""),
        mainhand1: String(build.equipment?.slots?.mainhand1 || ""),
        offhand1: String(build.equipment?.slots?.offhand1 || ""),
        mainhand2: String(build.equipment?.slots?.mainhand2 || ""),
        offhand2: String(build.equipment?.slots?.offhand2 || ""),
        back: String(build.equipment?.slots?.back || ""),
        amulet: String(build.equipment?.slots?.amulet || ""),
        ring1: String(build.equipment?.slots?.ring1 || ""),
        ring2: String(build.equipment?.slots?.ring2 || ""),
        accessory1: String(build.equipment?.slots?.accessory1 || ""),
        accessory2: String(build.equipment?.slots?.accessory2 || ""),
        breather: String(build.equipment?.slots?.breather || ""),
        aquatic1: String(build.equipment?.slots?.aquatic1 || ""),
        aquatic2: String(build.equipment?.slots?.aquatic2 || ""),
      },
      weapons: {
        mainhand1: String(build.equipment?.weapons?.mainhand1 || ""),
        offhand1:  String(build.equipment?.weapons?.offhand1  || ""),
        mainhand2: String(build.equipment?.weapons?.mainhand2 || ""),
        offhand2:  String(build.equipment?.weapons?.offhand2  || ""),
        aquatic1:  String(build.equipment?.weapons?.aquatic1  || ""),
        aquatic2:  String(build.equipment?.weapons?.aquatic2  || ""),
      },
      runes: {
        head: String(build.equipment?.runes?.head || ""),
        shoulders: String(build.equipment?.runes?.shoulders || ""),
        chest: String(build.equipment?.runes?.chest || ""),
        hands: String(build.equipment?.runes?.hands || ""),
        legs: String(build.equipment?.runes?.legs || ""),
        feet: String(build.equipment?.runes?.feet || ""),
        breather: String(build.equipment?.runes?.breather || ""),
      },
      sigils: {
        mainhand1: normalizeSigilArray(build.equipment?.sigils?.mainhand1, "mainhand1"),
        offhand1: normalizeSigilArray(build.equipment?.sigils?.offhand1, "offhand1"),
        mainhand2: normalizeSigilArray(build.equipment?.sigils?.mainhand2, "mainhand2"),
        offhand2: normalizeSigilArray(build.equipment?.sigils?.offhand2, "offhand2"),
        aquatic1: normalizeSigilArray(build.equipment?.sigils?.aquatic1, "aquatic1"),
        aquatic2: normalizeSigilArray(build.equipment?.sigils?.aquatic2, "aquatic2"),
      },
      infusions: Object.fromEntries(
        Object.keys(createEmptyEditor().equipment.infusions).map((key) => [
          key,
          normalizeInfusionValue(build.equipment?.infusions?.[key], key),
        ])
      ),
      enrichment: String(build.equipment?.enrichment || ""),
    },
    specializations: Array.isArray(build.specializations)
      ? build.specializations.slice(0, 3).map((entry) => ({
          specializationId: Number(entry?.id) || Number(entry?.specializationId) || 0,
          majorChoices: {
            1: Number(entry?.majorChoices?.[1]) || 0,
            2: Number(entry?.majorChoices?.[2]) || 0,
            3: Number(entry?.majorChoices?.[3]) || 0,
          },
          ...(() => {
            const tc = Array.isArray(entry?._traitChoices) ? entry._traitChoices
              : Array.isArray(entry?.traitChoices) ? entry.traitChoices : null;
            return tc ? { _traitChoices: tc } : {};
          })(),
        }))
      : [],
    skills: {
      healId: Number(build.skills?.heal?.id) || 0,
      utilityIds: Array.isArray(build.skills?.utility)
        ? build.skills.utility.slice(0, 3).map((entry) => Number(entry?.id) || 0)
        : [0, 0, 0],
      eliteId: Number(build.skills?.elite?.id) || 0,
    },
    underwaterSkills: (() => {
      const uwSkills = build.underwaterSkills || {};
      return {
        healId: Number(uwSkills.heal?.id) || 0,
        utilityIds: Array.isArray(uwSkills.utility)
          ? uwSkills.utility.slice(0, 3).map((s) => Number(s?.id) || 0)
          : [0, 0, 0],
        eliteId: Number(uwSkills.elite?.id) || 0,
      };
    })(),
    underwaterMode: false,
    activeAttunement: "",
    activeAttunement2: "",
    activeKit: 0,
    activeWeaponSet: 1,
    antiquaryArtifacts: { f2: 0, f3: 0, f4: 0 },
    morphSkillIds: Array.isArray(build.morphSkillIds)
      ? build.morphSkillIds.slice(0, 3).map(Number)
      : [0, 0, 0],
    selectedLegends: Array.isArray(build.selectedLegends)
      ? build.selectedLegends.slice(0, 2).map(String)
      : ["", ""],
    selectedUnderwaterLegends: Array.isArray(build.selectedUnderwaterLegends)
      ? build.selectedUnderwaterLegends.slice(0, 2).map(String)
      : ["", ""],
    activeLegendSlot: Number(build.activeLegendSlot) || 0,
    selectedPets: {
      terrestrial1: Number(build.selectedPets?.terrestrial1) || 0,
      terrestrial2: Number(build.selectedPets?.terrestrial2) || 0,
      aquatic1: Number(build.selectedPets?.aquatic1) || 0,
      aquatic2: Number(build.selectedPets?.aquatic2) || 0,
    },
    activePetSlot: build.activePetSlot === "terrestrial2" ? "terrestrial2" : "terrestrial1",
    gameMode: String(build.gameMode || "pve"),
    folderId: build.folderId || "",
    compIds: Array.isArray(build.compIds) ? [...build.compIds] : [],
    activeCompId: "",
  };

  // Expand statPackage into empty slots (e.g. uniform axicode imports)
  const pkg = state.editor.equipment.statPackage;
  if (pkg) {
    const sl = state.editor.equipment.slots;
    const allEmpty = Object.values(sl).every(v => !v);
    if (allEmpty) {
      for (const key of Object.keys(sl)) sl[key] = pkg;
    }
  }

  if (profession) {
    await _setProfession(profession, { preserveSelections: true });
  }
  enforceEditorConsistency();
  if (options.captureBaseline !== false) {
    captureEditorBaseline();
  } else {
    markEditorChanged();
  }
}

export function resolveLoadedBuildProfession(build) {
  const raw = String(build?.profession || "").trim();
  if (raw && state.professions.some((entry) => entry.id === raw)) return raw;
  if (raw) {
    const byName = state.professions.find((entry) => entry.name.toLowerCase() === raw.toLowerCase());
    if (byName) return byName.id;
  }
  return state.professions[0]?.id || "";
}

export function serializeEditorToBuild() {
  const catalog = state.activeCatalog;
  const specById = catalog?.specializationById || new Map();
  const traitById = catalog?.traitById || new Map();
  const skillById = catalog?.skillById || new Map();

  const specializations = (state.editor.specializations || []).map((entry) => {
    const spec = specById.get(Number(entry.specializationId));
    const majorTraitsByTier = spec ? getMajorTraitsByTier(spec, catalog) : { 1: [], 2: [], 3: [] };
    return {
      id: Number(spec?.id || entry.specializationId || 0),
      name: spec?.name || "",
      elite: Boolean(spec?.elite),
      icon: spec?.icon || "",
      background: spec?.background || "",
      minorTraits: (spec?.minorTraits || []).map((traitId) => simplifyTrait(traitById.get(Number(traitId)))),
      majorChoices: {
        1: Number(entry.majorChoices?.[1]) || 0,
        2: Number(entry.majorChoices?.[2]) || 0,
        3: Number(entry.majorChoices?.[3]) || 0,
      },
      majorTraitsByTier: {
        1: (majorTraitsByTier[1] || []).map((trait) => simplifyTrait(trait)),
        2: (majorTraitsByTier[2] || []).map((trait) => simplifyTrait(trait)),
        3: (majorTraitsByTier[3] || []).map((trait) => simplifyTrait(trait)),
      },
    };
  });

  const heal = simplifySkill(skillById.get(Number(state.editor.skills.healId)));
  const elite = simplifySkill(skillById.get(Number(state.editor.skills.eliteId)));
  const utility = (state.editor.skills.utilityIds || [])
    .slice(0, 3)
    .map((skillId) => simplifySkill(skillById.get(Number(skillId))))
    .filter(Boolean);

  return {
    id: state.editor.id || undefined,
    title: String(state.editor.title || "Untitled Build"),
    profession: String(state.editor.profession || ""),
    specializations,
    skills: {
      heal,
      utility,
      elite,
    },
    underwaterSkills: {
      heal: simplifySkill(skillById.get(Number(state.editor.underwaterSkills?.healId))),
      utility: (state.editor.underwaterSkills?.utilityIds || [])
        .slice(0, 3)
        .map((skillId) => simplifySkill(skillById.get(Number(skillId))))
        .filter(Boolean),
      elite: simplifySkill(skillById.get(Number(state.editor.underwaterSkills?.eliteId))),
    },
    equipment: {
      statPackage: String(state.editor.equipment.statPackage || ""),
      relic: String(state.editor.equipment.relic || ""),
      food: String(state.editor.equipment.food || ""),
      utility: String(state.editor.equipment.utility || ""),
      slots: {
        head: String(state.editor.equipment.slots?.head || ""),
        shoulders: String(state.editor.equipment.slots?.shoulders || ""),
        chest: String(state.editor.equipment.slots?.chest || ""),
        hands: String(state.editor.equipment.slots?.hands || ""),
        legs: String(state.editor.equipment.slots?.legs || ""),
        feet: String(state.editor.equipment.slots?.feet || ""),
        mainhand1: String(state.editor.equipment.slots?.mainhand1 || ""),
        offhand1: String(state.editor.equipment.slots?.offhand1 || ""),
        mainhand2: String(state.editor.equipment.slots?.mainhand2 || ""),
        offhand2: String(state.editor.equipment.slots?.offhand2 || ""),
        back: String(state.editor.equipment.slots?.back || ""),
        amulet: String(state.editor.equipment.slots?.amulet || ""),
        ring1: String(state.editor.equipment.slots?.ring1 || ""),
        ring2: String(state.editor.equipment.slots?.ring2 || ""),
        accessory1: String(state.editor.equipment.slots?.accessory1 || ""),
        accessory2: String(state.editor.equipment.slots?.accessory2 || ""),
        breather: String(state.editor.equipment.slots?.breather || ""),
        aquatic1: String(state.editor.equipment.slots?.aquatic1 || ""),
        aquatic2: String(state.editor.equipment.slots?.aquatic2 || ""),
      },
      weapons: {
        mainhand1: String(state.editor.equipment.weapons?.mainhand1 || ""),
        offhand1:  String(state.editor.equipment.weapons?.offhand1  || ""),
        mainhand2: String(state.editor.equipment.weapons?.mainhand2 || ""),
        offhand2:  String(state.editor.equipment.weapons?.offhand2  || ""),
        aquatic1:  String(state.editor.equipment.weapons?.aquatic1  || ""),
        aquatic2:  String(state.editor.equipment.weapons?.aquatic2  || ""),
      },
      runes: { ...state.editor.equipment.runes },
      sigils: {
        mainhand1: [...(state.editor.equipment.sigils?.mainhand1 || ["", ""])],
        offhand1: [...(state.editor.equipment.sigils?.offhand1 || [""])],
        mainhand2: [...(state.editor.equipment.sigils?.mainhand2 || ["", ""])],
        offhand2: [...(state.editor.equipment.sigils?.offhand2 || [""])],
        aquatic1: [...(state.editor.equipment.sigils?.aquatic1 || ["", ""])],
        aquatic2: [...(state.editor.equipment.sigils?.aquatic2 || ["", ""])],
      },
      infusions: Object.fromEntries(
        Object.entries(state.editor.equipment.infusions || {}).map(([key, val]) =>
          [key, Array.isArray(val) ? [...val] : String(val || "")]
        )
      ),
      enrichment: String(state.editor.equipment.enrichment || ""),
    },
    tags: [...(state.editor.tags || [])],
    notes: String(state.editor.notes || ""),
    images: state.editor.images && typeof state.editor.images === "object" ? { ...state.editor.images } : {},
    morphSkillIds: Array.isArray(state.editor.morphSkillIds)
      ? state.editor.morphSkillIds.map(Number)
      : [0, 0, 0],
    selectedLegends: Array.isArray(state.editor.selectedLegends)
      ? state.editor.selectedLegends.slice(0, 2).map(String)
      : ["", ""],
    selectedUnderwaterLegends: Array.isArray(state.editor.selectedUnderwaterLegends)
      ? state.editor.selectedUnderwaterLegends.slice(0, 2).map(String)
      : ["", ""],
    activeLegendSlot: Number(state.editor.activeLegendSlot) || 0,
    selectedPets: {
      terrestrial1: Number(state.editor.selectedPets?.terrestrial1) || 0,
      terrestrial2: Number(state.editor.selectedPets?.terrestrial2) || 0,
      aquatic1: Number(state.editor.selectedPets?.aquatic1) || 0,
      aquatic2: Number(state.editor.selectedPets?.aquatic2) || 0,
    },
    activePetSlot: state.editor.activePetSlot === "terrestrial2" ? "terrestrial2" : "terrestrial1",
    gameMode: String(state.editor.gameMode || "pve"),
    folderId: state.editor.folderId || undefined,
    compIds: (() => {
      const ids = [...(state.editor.compIds || [])];
      if (state.editor.activeCompId && !ids.includes(state.editor.activeCompId)) {
        ids.push(state.editor.activeCompId);
      }
      return ids.length ? ids : undefined;
    })(),
  };
}
