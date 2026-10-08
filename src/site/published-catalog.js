/**
 * Collect skill objects from a build store skill selection { heal, utility, elite }.
 */
function collectSkillsFromSelection(sel) {
  if (!sel) return [];
  const skills = [];
  if (sel.heal && typeof sel.heal === "object") skills.push(sel.heal);
  if (Array.isArray(sel.utility)) skills.push(...sel.utility.filter(Boolean));
  if (sel.elite && typeof sel.elite === "object") skills.push(sel.elite);
  return skills;
}

/**
 * Collects every skill object from a serialized build so we can build
 * the activeCatalog skill maps.
 */
function collectAllSkills(build) {
  const skills = [];
  for (const source of [build.landSkills, build.waterSkills]) {
    if (!source) continue;
    const ws = source.weaponSkills || {};
    for (const set of [ws.set1, ws.set2, ws.aquatic1, ws.aquatic2]) {
      if (Array.isArray(set)) skills.push(...set);
    }
    if (Array.isArray(source.professionMechanics)) skills.push(...source.professionMechanics);
    if (Array.isArray(source.resolvedSkills)) skills.push(...source.resolvedSkills);
    if (source.attunementSkills) {
      for (const att of Object.values(source.attunementSkills)) {
        if (Array.isArray(att.set1)) skills.push(...att.set1);
        if (Array.isArray(att.set2)) skills.push(...att.set2);
        if (Array.isArray(att.professionMechanics)) skills.push(...att.professionMechanics);
      }
    }
  }
  // Collect heal/utility/elite skill objects from build store format
  skills.push(...collectSkillsFromSelection(build.skills));
  skills.push(...collectSkillsFromSelection(build.underwaterSkills));
  // Legend swap skills (Revenant)
  for (const legend of (build.legendDisplay || [])) {
    if (legend.swap) skills.push(legend.swap);
  }
  // Full profession catalog — includes bundle skills, flip chains, toolbelt skills, etc.
  if (Array.isArray(build.catalogSkills)) skills.push(...build.catalogSkills);
  return skills.filter(s => s && s.id);
}

/**
 * The activeCatalog a published build carries: the shape the shared renderer
 * modules and the coverage engine read. Pure, so the comp page can build one
 * per member without touching the global state.
 */
export function catalogFromPublishedBuild(build) {
  const allSkills = collectAllSkills(build);
  // Use full catalog traits if available (includes facts/traitedFacts), fall back to spec-embedded traits
  const allTraits = Array.isArray(build.catalogTraits) && build.catalogTraits.length
    ? build.catalogTraits
    : (build.specializations || []).flatMap(s => {
        const minors = Array.isArray(s.minorTraits) ? s.minorTraits : [];
        const majors = s.majorTraitsByTier
          ? Object.values(s.majorTraitsByTier).flat()
          : [];
        return [...minors, ...majors];
      }).filter(t => t && t.id);

  return {
    profession:         { id: build.profession },
    skills:             allSkills,
    skillById:          new Map(allSkills.map(s => [s.id, s])),
    // Weapon skills are a separate catalog from profession skills
    weaponSkills:       build.catalogWeaponSkills || [],
    weaponSkillById:    new Map((build.catalogWeaponSkills || []).map(s => [s.id, s])),
    // Enrich spec objects with majorTraits (flat ID array) derived from majorTraitsByTier.
    // The renderer's getMajorTraitsByTier reads spec.majorTraits and looks up each via traitById.
    specializations:    (build.specializations || []).map(s => ({
      ...s,
      majorTraits: s.majorTraits || (s.majorTraitsByTier
        ? Object.values(s.majorTraitsByTier).flat().map(t => typeof t === "object" ? t.id : t)
        : []),
    })),
    specializationById: new Map((build.specializations || []).map(s => [s.id, {
      ...s,
      // Normalize minorTraits to IDs so the engine's collectActiveTraitIds can use them.
      // Published builds store minorTraits as enriched objects; the engine expects numbers.
      minorTraits: (s.minorTraits || []).map(t => typeof t === "object" ? t.id : t),
      majorTraits: s.majorTraits || (s.majorTraitsByTier
        ? Object.values(s.majorTraitsByTier).flat().map(t => typeof t === "object" ? t.id : t)
        : []),
    }])),
    traits:             allTraits,
    traitById:          new Map(allTraits.map(t => [t.id, t])),
    legends:            (build.legendDisplay || []).map(l => ({
      id: l.id, name: l.name, icon: l.icon, swap: l.swap?.id || null,
      heal: l.heal || 0, utilities: Array.isArray(l.utilities) ? l.utilities : [], elite: l.elite || 0,
    })),
    // heal/utilities/elite drive the Revenant skill-bar options in the shared
    // renderer (skills.js reads activeLegend.heal/utilities/elite). Without them
    // the published build renders an empty skill bar (#283).
    legendById:         new Map((build.legendDisplay || []).map(l => [l.id, {
      id: l.id, name: l.name, icon: l.icon, swap: l.swap?.id || null,
      heal: l.heal || 0, utilities: Array.isArray(l.utilities) ? l.utilities : [], elite: l.elite || 0,
    }])),
    pets:               (build.petDisplay || []).map(p => ({ id: p.id, name: p.name, icon: p.icon, skills: p.skills || [] })),
    petById:            new Map((build.petDisplay || []).map(p => [p.id, p])),
    professionWeapons:  build.professionWeapons || {},
  };
}

/** Upgrade items the published build carries, plus items its notes mention. */
export function upgradeCatalogFromPublishedBuild(build) {
  const eqd = build.equipmentDisplay || {};
  const runeEntries = Object.values(eqd.runes || {}).filter(Boolean);
  const sigilEntries = Object.values(eqd.sigils || {}).flat().filter(Boolean);
  const infusionEntries = Object.values(eqd.infusions || {}).flat().filter(Boolean);
  const uc = {
    runeById:       new Map(runeEntries.map(r => [r.id, r])),
    sigilById:      new Map(sigilEntries.map(s => [s.id, s])),
    infusionById:   new Map(infusionEntries.map(i => [i.id, i])),
    enrichmentById: new Map(eqd.enrichment ? [[eqd.enrichment.id, eqd.enrichment]] : []),
    foodById:       new Map(eqd.food ? [[eqd.food.id, eqd.food]] : []),
    utilityById:    new Map(eqd.utility ? [[eqd.utility.id, eqd.utility]] : []),
    relicByName:    new Map(eqd.relic ? [[eqd.relic.name, eqd.relic]] : []),
    relicById:      new Map(eqd.relic ? [[eqd.relic.id, eqd.relic]] : []),
  };
  // Merge in upgrade items referenced in notes but not equipped
  for (const item of (build.catalogNotesMentions || [])) {
    const map = { rune: uc.runeById, sigil: uc.sigilById, food: uc.foodById, utility: uc.utilityById,
      infusion: uc.infusionById, enrichment: uc.enrichmentById, relic: uc.relicById }[item.category];
    if (map && !map.has(item.id)) map.set(item.id, item);
  }
  return uc;
}
