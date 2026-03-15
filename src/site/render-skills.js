import { escapeHtml } from "./main.js";

/**
 * Renders read-only skills matching the desktop 3-column horizontal layout:
 *   [weapon column] | [health orb] | [utility column]
 *
 * @param {HTMLElement} container - The element to render into.
 * @param {object} build - Enriched build object from serializeForPublish.
 *   Expected fields:
 *     build.weaponSkills      — { set1, set2, aquatic1, aquatic2 } arrays of skill objects
 *     build.professionMechanics — array of F-skill objects with { id, name, icon, description, slot }
 *     build.skills            — { heal, utility[], elite } each with { id, name, icon, description }
 *     build.healthPool        — numeric HP value (optional)
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

  const set1 = Array.isArray(weaponSkills.set1) ? weaponSkills.set1 : [];
  const set2 = Array.isArray(weaponSkills.set2) ? weaponSkills.set2 : [];

  // ── Outer skills-bar wrapper (3-column flex) ──────────────────────────────
  const bar = document.createElement("div");
  bar.className = "skills-bar";

  // ── LEFT: weapon column ───────────────────────────────────────────────────
  const weaponCol = document.createElement("div");
  weaponCol.className = "skills-bar__weapon-col";

  const hasWeapons = set1.length > 0 || set2.length > 0;
  if (hasWeapons) {
    const WEAPON_KEYBINDS = ["1", "2", "3", "4", "5"];

    for (const weaponSet of [set1, set2]) {
      if (weaponSet.length === 0) continue;

      const weaponRow = document.createElement("div");
      weaponRow.className = "skills-bar__weapon-row";

      // Weapon swap button (read-only)
      const swapBtn = document.createElement("button");
      swapBtn.className = "weapon-swap-btn";
      swapBtn.disabled = true;
      swapBtn.innerHTML = `<svg width="16" height="13" viewBox="0 0 16 13" fill="currentColor"><path d="M4 0L0 3.5L4 7V4.5H10V2.5H4V0ZM12 6V8.5H6V10.5H12V13L16 9.5L12 6Z"/></svg>`;
      weaponRow.append(swapBtn);

      const innerBar = document.createElement("div");
      innerBar.className = "skills-bar";

      const group = document.createElement("div");
      group.className = "skill-group skill-group--weapons";

      weaponSet.forEach((skill, idx) => {
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

        const keyLabel = document.createElement("span");
        keyLabel.className = "skill-icon-large__keylabel";
        keyLabel.textContent = WEAPON_KEYBINDS[idx] || String(idx + 1);
        icon.append(keyLabel);

        slot.append(icon);
        group.append(slot);
      });

      innerBar.append(group);
      weaponRow.append(innerBar);
      weaponCol.append(weaponRow);
    }
  }

  // ── Profession mechanics bar (F1–F5 / legends / pets) ────────────────────
  if (professionMechanics.length > 0 || legendDisplay.length > 0 || petDisplay.length > 0) {
    const mechBar = document.createElement("div");
    mechBar.className = "profession-mechanics-bar";

    // Legend stack (Revenant) — shown as icon buttons before F-skills
    if (legendDisplay.length > 0) {
      const legendStack = document.createElement("div");
      legendStack.className = "legend-stack";

      for (const legend of legendDisplay) {
        const btn = document.createElement("button");
        btn.className = "legend-slot-btn";
        btn.disabled = true;
        btn.dataset.name = escapeHtml(legend.name || "");

        if (legend.icon) {
          const img = document.createElement("img");
          img.src = String(legend.icon);
          img.alt = "";
          img.loading = "lazy";
          btn.append(img);
        }

        legendStack.append(btn);
      }

      mechBar.append(legendStack);
    }

    // F-skill icons
    for (const skill of professionMechanics) {
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

    // Pet display (Ranger) — shown as icon slots
    if (petDisplay.length > 0) {
      for (const pet of petDisplay) {
        const wrapper = document.createElement("div");
        wrapper.className = "pet-slot-wrapper";

        const btn = document.createElement("button");
        btn.className = "pet-slot-btn pet-slot-btn--filled";
        btn.disabled = true;
        btn.dataset.name = escapeHtml(pet.name || "");

        if (pet.icon) {
          const img = document.createElement("img");
          img.src = String(pet.icon);
          img.alt = "";
          img.loading = "lazy";
          btn.append(img);
        }

        const nameLabel = document.createElement("span");
        nameLabel.className = "pet-slot-btn__label";
        nameLabel.textContent = pet.name || "";

        wrapper.append(btn, nameLabel);
        mechBar.append(wrapper);
      }
    }

    weaponCol.append(mechBar);
  }

  bar.append(weaponCol);

  // ── CENTER: health orb column ─────────────────────────────────────────────
  const orbCol = document.createElement("div");
  orbCol.className = "skills-bar__orb-col";

  const orb = document.createElement("div");
  orb.className = "health-orb";

  const orbFill = document.createElement("div");
  orbFill.className = "health-orb__fill";

  const orbText = document.createElement("div");
  orbText.className = "health-orb__text";

  const hpSpan = document.createElement("span");
  hpSpan.className = "health-orb__hp";
  hpSpan.textContent = build.healthPool != null
    ? Number(build.healthPool).toLocaleString()
    : "—";

  const hpLabel = document.createElement("span");
  hpLabel.className = "health-orb__label";
  hpLabel.textContent = "HP";

  orbText.append(hpSpan, hpLabel);
  orb.append(orbFill, orbText);
  orbCol.append(orb);

  bar.append(orbCol);

  // ── RIGHT: utility column ─────────────────────────────────────────────────
  const heal = skills.heal || null;
  const utilities = Array.isArray(skills.utility) ? skills.utility : [null, null, null];
  const elite = skills.elite || null;

  const hasSlotSkills = heal || elite || utilities.some(Boolean);
  if (hasSlotSkills) {
    const utilCol = document.createElement("div");
    utilCol.className = "skills-bar__util-col";

    const group = document.createElement("div");
    group.className = "skill-group skill-group--utilities";

    // Heal (keybind 6)
    group.append(_makeSkillSlot(heal, "Heal", "6"));

    // Utility 1–3 (keybinds 7, 8, 9)
    for (let i = 0; i < 3; i++) {
      group.append(_makeSkillSlot(utilities[i] || null, `Utility ${i + 1}`, String(7 + i)));
    }

    // Elite (keybind 0)
    group.append(_makeSkillSlot(elite, "Elite", "0"));

    utilCol.append(group);
    bar.append(utilCol);
  }

  container.append(bar);
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a skill-slot div with icon, keybind label, and slot label.
 *
 * @param {object|null} skill - Skill object with { id, name, icon, description }, or null.
 * @param {string} labelText - Slot label (e.g. "Heal", "Elite", "Utility 1").
 * @param {string} keybind - Keybind label to display on the icon (e.g. "6", "7", "0").
 * @returns {HTMLElement}
 */
function _makeSkillSlot(skill, labelText, keybind) {
  const slot = document.createElement("div");
  slot.className = "skill-slot";

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

  if (keybind) {
    const keyLabel = document.createElement("span");
    keyLabel.className = "skill-icon-large__keylabel";
    keyLabel.textContent = keybind;
    icon.append(keyLabel);
  }

  const slotLabel = document.createElement("div");
  slotLabel.className = "skill-slot-label";
  slotLabel.textContent = labelText;

  slot.append(icon, slotLabel);
  return slot;
}
