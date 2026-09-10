/** @jest-environment jsdom */
"use strict";

// DOM-level behaviour of the condition coverage panel (issue #302). Lives in its
// own file because the rest of the comp-boon-coverage tests run under the node env.
const {
  computeCompPartyCoverage,
  buildPartyCoverageHTML,
  bindPartyCoverageEvents,
} = require("../../../src/renderer/modules/comps/comp-boon-coverage");

function makeCatalog(skillsById) {
  return {
    skillById: skillsById, traitById: new Map(), weaponSkillById: new Map(),
    specializationById: new Map(), skills: [], professionWeapons: {},
    legendById: new Map(), petById: new Map(),
  };
}

// Signet of Spite poisons the foe; Corrupt Boon poisons *you*. Both get listed,
// but the headline count must reflect only what actually lands on enemies.
const SELF_POISON = {
  id: 301, name: "Corrupt Boon", type: "Utility",
  description: "Corruption. Poison yourself. Transform boons on your foe into negative conditions.",
  facts: [{ type: "Buff", status: "Poisoned", duration: 6, apply_count: 1 }],
};
const FOE_POISON = {
  id: 302, name: "Signet of Spite", type: "Utility",
  description: "Inflict poison on your foe.",
  facts: [{ type: "Buff", status: "Poisoned", duration: 10, apply_count: 2 }],
};

async function renderLine() {
  const catalog = makeCatalog(new Map([[301, SELF_POISON], [302, FOE_POISON]]));
  const cache = new Map();
  const build = {
    id: "b1", title: "Condi Reaper", profession: "Necromancer", gameMode: "pve",
    specializations: [], equipment: { weapons: {} },
    underwaterMode: false, activeWeaponSet: 1,
    skills: { healId: 0, utilityIds: [301, 302, 0], eliteId: 0 },
  };
  const comp = { id: "c1", partyLines: [{ id: "l1", slots: ["b1"], capacity: 5 }] };
  const data = await computeCompPartyCoverage(comp, [build], cache,
    async (p, g) => { cache.set(`${p}_${g}`, catalog); return catalog; });

  const el = document.createElement("div");
  el.innerHTML = buildPartyCoverageHTML(data);
  document.body.appendChild(el);
  bindPartyCoverageEvents(el);
  return el;
}

describe("condition expand panel", () => {
  test("counts only foe-facing sources, but still lists the self source", async () => {
    const el = await renderLine();
    el.querySelector('[data-condition-name="Poisoned"]').click();
    const expand = el.querySelector('[data-expand-for="conditions"]');

    expect(expand.querySelectorAll(".party-cov__src-row")).toHaveLength(2);
    expect(expand.querySelector(".party-cov__expand-title").textContent).toContain("1 source");
    expect(expand.querySelector(".party-cov__src-target--selfcondi").textContent).toBe("SELF");
  });

  test("the boon self-toggle does not hide or recount condition rows", async () => {
    const el = await renderLine();
    el.querySelector('[data-condition-name="Poisoned"]').click();
    const toggle = el.querySelector('[data-action="toggle-self-boons"]');
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));

    const expand = el.querySelector('[data-expand-for="conditions"]');
    expand.querySelectorAll(".party-cov__src-row").forEach((r) => {
      expect(r.style.display).not.toBe("none");
    });
    expect(expand.querySelector(".party-cov__expand-title").textContent).toContain("1 source");
  });
});
