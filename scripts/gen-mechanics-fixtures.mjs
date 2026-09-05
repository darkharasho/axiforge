#!/usr/bin/env node
/**
 * Regenerate the trimmed catalog fixtures used by the profession-mechanics
 * renderer tests.
 *
 * The tests need real GW2 data — the mocked API fixtures carry no elite-spec
 * skills, so they cannot reproduce trait-replaced mechanics at all. But the
 * baked catalogs under src/web/public/catalogs/ are gitignored build artifacts,
 * so a test that requires them passes locally and fails in CI.
 *
 * This trims the baked data down to a committed fixture: profession-mechanic
 * skills, their flip targets, and the traits under test, with only the fields
 * the renderer reads. Run `npm run bake:catalogs` first, then this.
 */
import fs from "node:fs";

const SOURCE = "src/web/public/catalogs";
const DEST = "tests/fixtures/catalogs";

// Keep only what a mechanics test resolves against.
const TARGETS = [
  { profession: "Necromancer", specIds: [60], traitIds: [2123] },  // Scourge / Herald of Sorrow
  { profession: "Elementalist", specIds: [48], traitIds: [2025] }, // Tempest / Singularity
];

function trim({ profession, specIds, traitIds }) {
  const catalog = JSON.parse(fs.readFileSync(`${SOURCE}/${profession}-pve.json`, "utf8"));
  const skills = catalog.skills || [];

  const keep = new Set();
  for (const skill of skills) {
    if (/^Profession_[1-5]$/.test(skill.slot || "")) keep.add(Number(skill.id));
  }
  // Follow flip chains so replacement and chain lookups both resolve.
  for (let pass = 0; pass < 3; pass += 1) {
    for (const skill of skills) {
      if (keep.has(Number(skill.id)) && skill.flipSkill) keep.add(Number(skill.flipSkill));
    }
  }
  for (const trait of (catalog.traits || [])) {
    if (!traitIds.includes(Number(trait.id))) continue;
    for (const id of (trait.traitSkillIds || [])) keep.add(Number(id));
  }

  const out = {
    profession: { id: catalog.profession?.id || profession },
    professionWeapons: {},
    specializations: (catalog.specializations || [])
      .filter((s) => specIds.includes(Number(s.id)))
      .map((s) => ({ id: s.id, name: s.name, elite: s.elite, profession: s.profession })),
    traits: (catalog.traits || [])
      .filter((t) => traitIds.includes(Number(t.id)))
      .map((t) => ({
        id: t.id, name: t.name, slot: t.slot, tier: t.tier,
        specialization: t.specialization, traitSkillIds: t.traitSkillIds || [],
      })),
    skills: skills
      .filter((s) => keep.has(Number(s.id)))
      .map((s) => ({
        id: s.id, name: s.name, slot: s.slot, type: s.type,
        specialization: s.specialization || 0, flipSkill: s.flipSkill || 0,
        inProfessionEndpoint: Boolean(s.inProfessionEndpoint),
        professions: s.professions || [], attunement: s.attunement || "", icon: "",
      })),
    weaponSkills: [],
  };

  const path = `${DEST}/${profession}-mechanics.json`;
  fs.writeFileSync(path, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`${path} — ${out.skills.length} skills, ${out.traits.length} traits`);
}

fs.mkdirSync(DEST, { recursive: true });
for (const target of TARGETS) trim(target);
