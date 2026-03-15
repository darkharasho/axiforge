import { escapeHtml } from "./main.js";

/**
 * Renders read-only skills matching the desktop DOM structure.
 *
 * @param {HTMLElement} container - The element to render into.
 * @param {object} build - Enriched build object from serializeForPublish.
 *   Expected fields:
 *     build.weaponSkills      — { set1, set2, aquatic1, aquatic2 } arrays of skill objects
 *     build.professionMechanics — array of F-skill objects with { id, name, icon, description, slot }
 *     build.skills            — { heal, utility[], elite } each with { id, name, icon, description }
 *     build.underwaterSkills  — same structure as build.skills (optional)
 *     build.legendDisplay     — array of { id, name, icon } for Revenant legends (optional)
 *     build.petDisplay        — array of { id, name, icon } for Ranger pets (optional)
 */
export function renderSkills(container, build) {
  container.innerHTML = "";

  const weaponSkills = build.weaponSkills || {};
  const professionMechanics = Array.isArray(build.professionMechanics) ? build.professionMechanics : [];
  const skills = build.skills || {};
  const legendDisplay = Array.isArray(build.legendDisplay) ? build.legendDisplay : [];
  const petDisplay = Array.isArray(build.petDisplay) ? build.petDisplay : [];

  // ── Weapon skills ────────────────────────────────────────────────────────
  const set1 = Array.isArray(weaponSkills.set1) ? weaponSkills.set1 : [];
  const set2 = Array.isArray(weaponSkills.set2) ? weaponSkills.set2 : [];

  const hasWeapons = set1.length > 0 || set2.length > 0;
  if (hasWeapons) {
    const weaponCol = document.createElement("div");
    weaponCol.className = "skills-bar__weapon-col";

    for (const set of [set1, set2]) {
      if (set.length === 0) continue;

      const weaponRow = document.createElement("div");
      weaponRow.className = "skills-bar__weapon-row";

      const bar = document.createElement("div");
      bar.className = "skills-bar";

      const group = document.createElement("div");
      group.className = "skill-group";

      for (const skill of set) {
        const slot = document.createElement("div");
        slot.className = "skill-slot";

        const icon = document.createElement("div");
        icon.className = "skill-icon-large skill-icon--weapon";
        icon.dataset.name = escapeHtml(skill.name || "");
        icon.dataset.desc = escapeHtml(skill.description || "");

        if (skill.icon) {
          const img = document.createElement("img");
          img.src = String(skill.icon);
          img.alt = "";
          img.loading = "lazy";
          icon.append(img);
        }

        slot.append(icon);
        group.append(slot);
      }

      bar.append(group);
      weaponRow.append(bar);
      weaponCol.append(weaponRow);
    }

    container.append(weaponCol);
  }

  // ── Profession mechanics bar ─────────────────────────────────────────────
  if (professionMechanics.length > 0) {
    const mechBar = document.createElement("div");
    mechBar.className = "profession-mechanics-bar";

    for (const skill of professionMechanics) {
      // Derive F-label from slot name: "Profession_1" → "F1"
      const slotMatch = /^Profession_(\d+)$/.exec(skill.slot || "");
      const fLabel = slotMatch ? `F${slotMatch[1]}` : "";

      const icon = document.createElement("div");
      icon.className = "skill-icon--profession";
      icon.dataset.name = escapeHtml(skill.name || "");
      icon.dataset.desc = escapeHtml(skill.description || "");

      if (skill.icon) {
        const img = document.createElement("img");
        img.src = String(skill.icon);
        img.alt = "";
        img.loading = "lazy";
        icon.append(img);
      }

      if (fLabel) {
        const label = document.createElement("span");
        label.className = "skill-icon--profession-flabel";
        label.textContent = fLabel;
        icon.append(label);
      }

      mechBar.append(icon);
    }

    container.append(mechBar);
  }

  // ── Heal / utility / elite bar ───────────────────────────────────────────
  const heal = skills.heal || null;
  const utilities = Array.isArray(skills.utility) ? skills.utility : [null, null, null];
  const elite = skills.elite || null;

  const hasSlotSkills = heal || elite || utilities.some(Boolean);
  if (hasSlotSkills) {
    const bar = document.createElement("div");
    bar.className = "skills-bar";

    const group = document.createElement("div");
    group.className = "skill-group skill-group--utilities";

    // Heal skill
    group.append(_makeSkillSlot(heal, "Heal"));

    // Utility skills
    for (let i = 0; i < 3; i++) {
      group.append(_makeSkillSlot(utilities[i] || null, `Utility ${i + 1}`));
    }

    // Elite skill
    group.append(_makeSkillSlot(elite, "Elite"));

    bar.append(group);
    container.append(bar);
  }

  // ── Legend display (Revenant) ────────────────────────────────────────────
  if (legendDisplay.length > 0) {
    const mechDiv = document.createElement("div");
    mechDiv.className = "site-mechanic";

    const label = document.createElement("strong");
    label.textContent = "Legends:";
    mechDiv.append(label);

    const names = legendDisplay.map((l) => escapeHtml(l.name || `Legend ${l.id}`)).join(", ");
    mechDiv.append(document.createTextNode(" " + names));

    container.append(mechDiv);
  }

  // ── Pet display (Ranger) ─────────────────────────────────────────────────
  if (petDisplay.length > 0) {
    const mechDiv = document.createElement("div");
    mechDiv.className = "site-mechanic";

    const label = document.createElement("strong");
    label.textContent = "Pets:";
    mechDiv.append(label);

    for (let i = 0; i < petDisplay.length; i++) {
      const pet = petDisplay[i];
      if (i > 0) mechDiv.append(document.createTextNode(", "));
      const span = document.createElement("span");
      span.textContent = pet.name || `Pet ${pet.id}`;
      mechDiv.append(span);
    }

    container.append(mechDiv);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a skill-slot div with icon and label.
 *
 * @param {object|null} skill - Skill object with { id, name, icon, description }, or null.
 * @param {string} labelText - Slot label (e.g. "Heal", "Elite", "Utility 1").
 * @returns {HTMLElement}
 */
function _makeSkillSlot(skill, labelText) {
  const slot = document.createElement("div");
  slot.className = "skill-slot";

  if (skill) {
    slot.dataset.name = escapeHtml(skill.name || "");
    slot.dataset.desc = escapeHtml(skill.description || "");
  }

  const icon = document.createElement("div");
  icon.className = "skill-icon-large";

  if (skill) {
    icon.dataset.name = escapeHtml(skill.name || "");
    icon.dataset.desc = escapeHtml(skill.description || "");

    if (skill.icon) {
      const img = document.createElement("img");
      img.src = String(skill.icon);
      img.alt = "";
      img.loading = "lazy";
      icon.append(img);
    }
  }

  const slotLabel = document.createElement("div");
  slotLabel.className = "skill-slot-label";
  slotLabel.textContent = labelText;

  slot.append(icon, slotLabel);
  return slot;
}
