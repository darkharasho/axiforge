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
    // One click from the rendered default lands ON (self boons shown).
    toggle.click();
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    const expand = el.querySelector('[data-expand-for="conditions"]');
    expand.querySelectorAll(".party-cov__src-row").forEach((r) => {
      expect(r.style.display).not.toBe("none");
    });
    expect(expand.querySelector(".party-cov__expand-title").textContent).toContain("1 source");
  });
});

// "Gain Might" with no ally wording is a self-only boon source, which is exactly
// what the "Show self boons" toggle governs.
const SELF_MIGHT = {
  id: 303, name: "Signet of Fury", type: "Utility",
  description: "Gain Might.",
  facts: [{ type: "Buff", status: "Might", duration: 8, apply_count: 3 }],
};

async function renderBoonLine() {
  const catalog = makeCatalog(new Map([[303, SELF_MIGHT]]));
  const cache = new Map();
  const build = {
    id: "b1", title: "Self Might", profession: "Warrior", gameMode: "pve",
    specializations: [], equipment: { weapons: {} },
    underwaterMode: false, activeWeaponSet: 1,
    skills: { healId: 0, utilityIds: [303, 0, 0], eliteId: 0 },
  };
  const comp = { id: "c1", partyLines: [{ id: "l1", slots: ["b1"], capacity: 5 }] };
  const data = await computeCompPartyCoverage(comp, [build], cache,
    async () => { cache.set("Warrior_pve", catalog); return catalog; });

  const el = document.createElement("div");
  el.innerHTML = buildPartyCoverageHTML(data);
  document.body.appendChild(el);
  bindPartyCoverageEvents(el);
  return el;
}

describe("self-boon toggle default", () => {
  test("binding primes the toggle OFF rather than flipping it ON", async () => {
    const el = await renderLine();
    const toggle = el.querySelector('[data-action="toggle-self-boons"]');
    // Regression: priming used to dispatch a synthetic click through the
    // flip-the-attribute handler, so every panel opened with self boons shown
    // and counted self-only sources as coverage.
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  test("a self-only boon rests greyed out, and one click reveals its SELF row", async () => {
    const el = await renderBoonLine();
    const toggle = el.querySelector('[data-action="toggle-self-boons"]');
    // Scoped to the pill: the collapsed header's mini icons carry
    // data-boon-name too, and they come first in the DOM.
    const pill = el.querySelector('.party-cov__pill[data-boon-name="Might"]');
    expect(pill).toBeTruthy();

    // Default OFF: every source for Might is self-only, so the pill is inert.
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(pill.classList.contains("party-cov__pill--self-only")).toBe(true);
    expect(pill.getAttribute("aria-disabled")).toBe("true");

    // One click turns it on, un-greys the pill, and the pill then expands to
    // show the SELF source row.
    toggle.click();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(pill.classList.contains("party-cov__pill--self-only")).toBe(false);

    pill.click();
    const expand = el.querySelector('.party-cov__expand');
    const selfRows = expand.querySelectorAll(".party-cov__src-target--self");
    expect(selfRows.length).toBeGreaterThan(0);
    selfRows.forEach((b) => {
      expect(b.closest(".party-cov__src-row").style.display).not.toBe("none");
    });

    // And clicking again returns to the primed default.
    toggle.click();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    selfRows.forEach((b) => {
      expect(b.closest(".party-cov__src-row").style.display).toBe("none");
    });
  });
});
