import { escapeHtml } from "./main.js";

/**
 * Renders read-only skills matching the desktop 3-column horizontal layout:
 *   [weapon column] | [health orb] | [utility column]
 *
 * Supports the new structured build format with landSkills/waterSkills and
 * attunementSkills (Elementalist). Falls back gracefully to the old flat format.
 *
 * @param {HTMLElement} container - The element to render into.
 * @param {object} build - Enriched build object from serializeForPublish.
 *   New fields:
 *     build.landSkills  — { weaponSkills, professionMechanics, skills, attunementSkills }
 *     build.waterSkills — { weaponSkills, professionMechanics, skills, attunementSkills }
 *     build.activeAttunement — "Fire" | "Water" | "Air" | "Earth" | ""
 *   Legacy fields (fallback):
 *     build.weaponSkills, build.professionMechanics, build.skills
 *   Other fields:
 *     build.healthPool, build.legendDisplay, build.petDisplay
 */
export function renderSkills(container, build) {
  container.innerHTML = "";

  // ── Backward-compatible skill data extraction ─────────────────────────────
  const landSkills = build.landSkills || {
    weaponSkills: build.weaponSkills || {},
    professionMechanics: build.professionMechanics || [],
    skills: build.skills || {},
    attunementSkills: null,
  };

  const waterSkills = build.waterSkills || null;

  // Determine initial active attunement for Elementalist
  const defaultAttunement = build.activeAttunement || "Fire";

  // ── Land/Water toggle ─────────────────────────────────────────────────────
  if (waterSkills) {
    const toggle = document.createElement("div");
    toggle.className = "underwater-toggle";
    toggle.style.marginBottom = "10px";

    const landBtn = document.createElement("button");
    landBtn.type = "button";
    landBtn.className = "underwater-toggle__btn underwater-toggle__btn--active";
    landBtn.dataset.mode = "land";
    landBtn.textContent = "⚓ Land";

    const waterBtn = document.createElement("button");
    waterBtn.type = "button";
    waterBtn.className = "underwater-toggle__btn";
    waterBtn.dataset.mode = "water";
    waterBtn.textContent = "≈ Water";

    toggle.append(landBtn, waterBtn);
    container.append(toggle);

    landBtn.addEventListener("click", () => {
      landBtn.classList.add("underwater-toggle__btn--active");
      waterBtn.classList.remove("underwater-toggle__btn--active");
      _renderSkillsBar(skillsArea, landSkills, build, defaultAttunement);
    });

    waterBtn.addEventListener("click", () => {
      waterBtn.classList.add("underwater-toggle__btn--active");
      landBtn.classList.remove("underwater-toggle__btn--active");
      _renderSkillsBar(skillsArea, waterSkills, build, defaultAttunement);
    });
  }

  // ── Skills bar area (replaced on toggle) ─────────────────────────────────
  const skillsArea = document.createElement("div");
  container.append(skillsArea);

  _renderSkillsBar(skillsArea, landSkills, build, defaultAttunement);
}

/**
 * Renders the full skills bar (attunement toggle if applicable, weapon rows,
 * profession mechanics, health orb, utility skills) into the given area element.
 *
 * @param {HTMLElement} area - Container to render into (will be cleared).
 * @param {object} skillData - { weaponSkills, professionMechanics, skills, attunementSkills }
 * @param {object} build - Full build object (for healthPool, legendDisplay, petDisplay).
 * @param {string} initialAttunement - The attunement to show initially (Elementalist only).
 */
function _renderSkillsBar(area, skillData, build, initialAttunement) {
  area.innerHTML = "";

  const legendDisplay = Array.isArray(build.legendDisplay) ? build.legendDisplay : [];
  const petDisplay = Array.isArray(build.petDisplay) ? build.petDisplay : [];

  const attunementSkills = skillData.attunementSkills || null;
  const hasAttunements = attunementSkills && Object.keys(attunementSkills).length > 0;

  // Active state for Elementalist: track current attunement
  let activeAttunement = initialAttunement;

  // Resolve the current weapon/fskill data based on active attunement
  function resolveWeaponData() {
    if (hasAttunements && attunementSkills[activeAttunement]) {
      const att = attunementSkills[activeAttunement];
      return {
        set1: Array.isArray(att.set1) ? att.set1 : [],
        set2: Array.isArray(att.set2) ? att.set2 : [],
        professionMechanics: Array.isArray(att.professionMechanics) ? att.professionMechanics : [],
      };
    }
    const ws = skillData.weaponSkills || {};
    return {
      set1: Array.isArray(ws.set1) ? ws.set1 : (Array.isArray(ws.aquatic1) ? ws.aquatic1 : []),
      set2: Array.isArray(ws.set2) ? ws.set2 : (Array.isArray(ws.aquatic2) ? ws.aquatic2 : []),
      professionMechanics: (Array.isArray(skillData.professionMechanics) && skillData.professionMechanics.length > 0)
        ? skillData.professionMechanics
        : (Array.isArray(build.professionMechanics) ? build.professionMechanics : []),
    };
  }

  // ── Outer wrapper ─────────────────────────────────────────────────────────
  const wrapper = document.createElement("div");
  area.append(wrapper);

  // ── Attunement toggle (Elementalist) ──────────────────────────────────────
  const ATTUNEMENT_EMOJIS = { Fire: "🔥", Water: "💧", Air: "⚡", Earth: "🌍" };
  const ATTUNEMENT_ORDER = ["Fire", "Water", "Air", "Earth"];

  let attunementBtns = {};
  let weaponRowsEl = null;
  let mechBarEl = null;

  if (hasAttunements) {
    const attRow = document.createElement("div");
    attRow.className = "profession-mechanics-bar";
    attRow.style.marginBottom = "8px";

    for (const attName of ATTUNEMENT_ORDER) {
      if (!attunementSkills[attName]) continue;

      const btn = document.createElement("div");
      btn.className = activeAttunement === attName
        ? "skill-icon--profession skill-icon--profession-active"
        : "skill-icon--profession";
      btn.dataset.att = attName;
      btn.dataset.name = `${attName} Attunement`;
      btn.style.cursor = "pointer";

      // Use attunement icon from enriched data if available, else emoji label
      const attData = attunementSkills[attName];
      if (attData.icon) {
        const img = document.createElement("img");
        img.src = String(attData.icon);
        img.alt = attName;
        img.loading = "lazy";
        btn.append(img);
      }

      const label = document.createElement("span");
      label.className = "skill-icon--profession-flabel";
      label.textContent = attData.icon ? attName.slice(0, 1) : (ATTUNEMENT_EMOJIS[attName] || attName);
      btn.append(label);

      attunementBtns[attName] = btn;
      attRow.append(btn);
    }

    wrapper.append(attRow);

    // Wire up attunement button clicks
    for (const [attName, btn] of Object.entries(attunementBtns)) {
      btn.addEventListener("click", () => {
        activeAttunement = attName;
        // Swap active class
        for (const [n, b] of Object.entries(attunementBtns)) {
          if (n === attName) {
            b.classList.add("skill-icon--profession-active");
          } else {
            b.classList.remove("skill-icon--profession-active");
          }
        }
        // Update weapon rows and mech bar in-place
        const resolved = resolveWeaponData();
        _updateWeaponRows(weaponRowsEl, resolved.set1, resolved.set2);
        _updateMechBar(mechBarEl, resolved.professionMechanics, legendDisplay, petDisplay, hasAttunements);
        _triggerFlipAnim(weaponRowsEl);
        _triggerFlipAnim(mechBarEl);
      });
    }
  }

  // ── Main skills bar (3-column flex) ───────────────────────────────────────
  const bar = document.createElement("div");
  bar.className = "skills-bar";

  // ── LEFT: weapon column ───────────────────────────────────────────────────
  const weaponCol = document.createElement("div");
  weaponCol.className = "skills-bar__weapon-col";

  // Container for weapon rows so we can update them in-place
  weaponRowsEl = document.createElement("div");
  weaponCol.append(weaponRowsEl);

  // Container for profession mechanics bar so we can update it in-place
  mechBarEl = document.createElement("div");
  weaponCol.append(mechBarEl);

  // Initial render
  const initialResolved = resolveWeaponData();
  _updateWeaponRows(weaponRowsEl, initialResolved.set1, initialResolved.set2);
  _updateMechBar(mechBarEl, initialResolved.professionMechanics, legendDisplay, petDisplay, hasAttunements);

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
  const hpValue = build.computedStats?.Health;
  hpSpan.textContent = hpValue != null ? Number(hpValue).toLocaleString() : "—";

  const hpLabel = document.createElement("span");
  hpLabel.className = "health-orb__label";
  hpLabel.textContent = "HP";

  orbText.append(hpSpan, hpLabel);
  orb.append(orbFill, orbText);
  orbCol.append(orb);
  bar.append(orbCol);

  // ── RIGHT: utility column ─────────────────────────────────────────────────
  const skills = skillData.skills || build.skills || {};
  const heal = skills.heal || null;
  const utilities = Array.isArray(skills.utility) ? skills.utility : [null, null, null];
  const elite = skills.elite || null;

  // Always render utility column — show empty slots if no skills are set (e.g. underwater)
  const utilCol = document.createElement("div");
  utilCol.className = "skills-bar__util-col";

  const group = document.createElement("div");
  group.className = "skill-group skill-group--utilities";

  group.append(_makeSkillSlot(heal, "Heal", "6"));

  for (let i = 0; i < 3; i++) {
    group.append(_makeSkillSlot(utilities[i] || null, `Utility ${i + 1}`, String(7 + i)));
  }

  group.append(_makeSkillSlot(elite, "Elite", "0"));

  utilCol.append(group);
  bar.append(utilCol);

  wrapper.append(bar);
}

// Track active weapon set across updates
let _activeWeaponSet = 1;

/**
 * Re-renders weapon rows (set1 + set2) inside the given container.
 * Only shows one weapon set at a time with a swap button to toggle.
 *
 * @param {HTMLElement} el - Container to render into (will be cleared).
 * @param {Array} set1 - First weapon set skill objects.
 * @param {Array} set2 - Second weapon set skill objects.
 */
function _updateWeaponRows(el, set1, set2) {
  el.innerHTML = "";

  const hasWeapons = set1.length > 0 || set2.length > 0;
  if (!hasWeapons) return;

  // If active set has no skills, fall back to the other
  if (_activeWeaponSet === 2 && set2.length === 0) _activeWeaponSet = 1;
  if (_activeWeaponSet === 1 && set1.length === 0) _activeWeaponSet = 2;

  const activeSet = _activeWeaponSet === 2 ? set2 : set1;
  const hasBothSets = set1.length > 0 && set2.length > 0;

  const WEAPON_KEYBINDS = ["1", "2", "3", "4", "5"];

  const weaponRow = document.createElement("div");
  weaponRow.className = "skills-bar__weapon-row";

  // Weapon swap button — functional toggle between sets
  const swapBtn = document.createElement("button");
  swapBtn.className = "weapon-swap-btn";
  swapBtn.disabled = !hasBothSets;
  swapBtn.innerHTML = `<svg width="16" height="13" viewBox="0 0 16 13" fill="currentColor"><path d="M4 0L0 3.5L4 7V4.5H10V2.5H4V0ZM12 6V8.5H6V10.5H12V13L16 9.5L12 6Z"/></svg>`;
  if (hasBothSets) {
    swapBtn.addEventListener("click", () => {
      _activeWeaponSet = _activeWeaponSet === 1 ? 2 : 1;
      _updateWeaponRows(el, set1, set2);
      _triggerFlipAnim(el);
    });
  }
  weaponRow.append(swapBtn);

  const innerBar = document.createElement("div");
  innerBar.className = "skills-bar";

  const group = document.createElement("div");
  group.className = "skill-group skill-group--weapons";

  activeSet.forEach((skill, idx) => {
    const slot = document.createElement("div");
    slot.className = "skill-slot";

    const icon = document.createElement("div");
    icon.className = "skill-icon-large skill-icon--weapon";
    icon.dataset.name = escapeHtml(skill.name || "");
    icon.dataset.desc = escapeHtml(skill.description || "");
    icon.dataset.icon = skill.icon || "";

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
  el.append(weaponRow);
}

/**
 * Re-renders the profession mechanics bar inside the given container.
 * When hasAttunements is true, legend/pet display is skipped (Elementalist has neither).
 *
 * @param {HTMLElement} el - Container to render into (will be cleared).
 * @param {Array} professionMechanics - F-skill objects.
 * @param {Array} legendDisplay - Legend display objects (Revenant).
 * @param {Array} petDisplay - Pet display objects (Ranger).
 * @param {boolean} hasAttunements - Whether this is an Elementalist build.
 */
function _updateMechBar(el, professionMechanics, legendDisplay, petDisplay, hasAttunements) {
  el.innerHTML = "";

  const hasMechanics = professionMechanics.length > 0;
  const hasLegends = !hasAttunements && legendDisplay.length > 0;
  const hasPets = !hasAttunements && petDisplay.length > 0;

  if (!hasMechanics && !hasLegends && !hasPets) return;

  const mechBar = document.createElement("div");
  mechBar.className = "profession-mechanics-bar";

  // Legend stack (Revenant) — shown before F-skills
  if (hasLegends) {
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
    icon.dataset.icon = skill.icon || "";

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

  // Pet display (Ranger)
  if (hasPets) {
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

  el.append(mechBar);
}

// ── Animation helper ──────────────────────────────────────────────────────

/**
 * Triggers the skillFlipSwap animation on all skill icons inside the given container.
 * The class is removed automatically when the animation ends.
 *
 * @param {HTMLElement} el - Container element whose descendant icons should animate.
 */
function _triggerFlipAnim(el) {
  requestAnimationFrame(() => {
    for (const icon of el.querySelectorAll(".skill-icon-large, .skill-icon--profession")) {
      icon.classList.add("skill-icon--flip-anim");
      icon.addEventListener("animationend", () => icon.classList.remove("skill-icon--flip-anim"), { once: true });
    }
  });
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
    icon.dataset.icon = skill.icon || "";

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
