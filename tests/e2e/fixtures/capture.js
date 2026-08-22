#!/usr/bin/env node
const fs = require("fs/promises");
const path = require("path");

const API = "https://api.guildwars2.com/v2";
const OUT = __dirname;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "axiforge-e2e-fixture-capture" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchByIds(endpoint, ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const data = await fetchJson(`${API}/${endpoint}?ids=${chunk.join(",")}`);
    results.push(...data);
  }
  return results;
}

async function captureProfessionCatalog(professions, profName, outFile) {
  const prof = professions.find((p) => p.id === profName);
  if (!prof) throw new Error(`${profName} not found`);

  console.log(`  Capturing ${profName} catalog...`);
  const specIds = prof.specializations;
  const specs = await fetchByIds("specializations", specIds);

  const traitIds = specs.flatMap((s) => [...s.minor_traits, ...s.major_traits]);
  const traits = await fetchByIds("traits", traitIds);

  const skillIds = [
    ...prof.skills.map((s) => s.id),
    ...Object.values(prof.weapons).flatMap((w) => (w.skills || []).map((s) => s.id)),
  ];
  const skills = await fetchByIds("skills", [...new Set(skillIds)]);

  // Toolbelt skills are referenced by id from the skill that grants them and are
  // never listed on the profession itself. Without them the Engineer mechanics bar
  // resolves every F-slot to null and never renders. Same shape as the legend-skill
  // pass below: follow the references and pull in whatever is still missing.
  const captured = new Set(skills.map((s) => s.id));
  const toolbeltIds = [...new Set(
    skills.map((s) => s.toolbelt_skill).filter((id) => id && !captured.has(id))
  )];
  if (toolbeltIds.length) {
    skills.push(...(await fetchByIds("skills", toolbeltIds)));
  }

  const catalog = { profession: prof, specializations: specs, traits, skills };
  await fs.writeFile(path.join(OUT, outFile), JSON.stringify(catalog, null, 2));
  console.log(`  Saved ${profName}: ${specs.length} specs, ${traits.length} traits, ${skills.length} skills`);
}

async function main() {
  console.log("Fetching profession list...");
  const profIds = await fetchJson(`${API}/professions`);
  const profs = await fetchByIds("professions", profIds);
  await fs.writeFile(path.join(OUT, "professions.json"), JSON.stringify(profs, null, 2));
  console.log(`  Saved ${profs.length} professions`);

  await captureProfessionCatalog(profs, "Necromancer", "necromancer-catalog.json");
  await captureProfessionCatalog(profs, "Elementalist", "elementalist-catalog.json");
  await captureProfessionCatalog(profs, "Revenant", "revenant-catalog.json");

  console.log("  Capturing legends...");
  const legendIds = await fetchJson(`${API}/legends`);
  const legends = await fetchByIds("legends", legendIds);
  await fs.writeFile(path.join(OUT, "legends.json"), JSON.stringify(legends, null, 2));
  console.log(`  Saved ${legends.length} legends`);

  const legendSkillIds = legends.flatMap((l) => [l.heal, ...l.utilities, l.elite].filter(Boolean));
  const legendSkills = await fetchByIds("skills", [...new Set(legendSkillIds)]);
  const revCatalogPath = path.join(OUT, "revenant-catalog.json");
  const revCatalog = JSON.parse(await fs.readFile(revCatalogPath, "utf-8"));
  const existingSkillIds = new Set(revCatalog.skills.map((s) => s.id));
  for (const s of legendSkills) {
    if (!existingSkillIds.has(s.id)) revCatalog.skills.push(s);
  }
  await fs.writeFile(revCatalogPath, JSON.stringify(revCatalog, null, 2));

  console.log("  Capturing pets...");
  const pets = await fetchJson(`${API}/pets?ids=all`);
  await fs.writeFile(path.join(OUT, "pets.json"), JSON.stringify(pets, null, 2));
  console.log(`  Saved ${pets.length} pets`);

  console.log("  Capturing upgrades...");
  const runeIds = await fetchJson(`${API}/items?ids=24836,24837,24838,24839,24840,24842`);
  await fs.writeFile(path.join(OUT, "upgrades.json"), JSON.stringify(runeIds, null, 2));

  console.log("Done!");
}

main().catch(console.error);
