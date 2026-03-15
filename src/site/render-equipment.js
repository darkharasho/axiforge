import { escapeHtml } from "./main.js";

/**
 * Renders read-only equipment matching the desktop's equip-layout 3-column grid.
 *
 * @param {HTMLElement} container - The element to render into.
 * @param {object} build - Enriched build object from serializeForPublish.
 *   Expected fields:
 *     build.equipment.statPackage  — overall stat package name
 *     build.equipment.weapons      — { mainhand1, offhand1, mainhand2, offhand2 }
 *     build.equipment.slots        — { head, shoulders, ... } stat names per slot
 *     build.equipment.runes        — { head, shoulders, ... } rune names per armor slot
 *     build.equipment.sigils       — { mainhand1: ["Force", "Impact"], ... }
 *     build.equipment.infusions    — infusion data per slot
 *     build.equipment.relic        — relic name
 *     build.equipment.food         — food name
 *     build.equipment.utility      — utility name
 *     build.equipment.enrichment   — enrichment name
 *     build.professionIcon         — SVG string (optional)
 *     build.notes                  — build notes text (optional)
 */
export function renderEquipment(container, build) {
  container.innerHTML = "";

  const equip = build.equipment || {};
  const slots = equip.slots || {};
  const weapons = equip.weapons || {};
  const runes = equip.runes || {};
  const sigils = equip.sigils || {};
  const infusions = equip.infusions || {};

  // ── Helpers ────────────────────────────────────────────────────────────────

  function makeSection(title) {
    const section = document.createElement("div");
    section.className = "equip-section";
    const head = document.createElement("div");
    head.className = "equip-section__head";
    const titleEl = document.createElement("span");
    titleEl.textContent = title;
    head.append(titleEl);
    section.append(head);
    return section;
  }

  /**
   * Make a read-only upgrade button (rune or sigil).
   *
   * @param {"rune"|"sigil"} type
   * @param {string} value - Name of the upgrade, or empty string.
   * @returns {HTMLElement}
   */
  function makeUpgradeBtn(type, value) {
    const btn = document.createElement("div");
    const modClass = type === "rune" ? "equip-upgrade-btn--rune" : "equip-upgrade-btn--sigil";
    const filledClass = value ? " equip-upgrade-btn--filled" : "";
    btn.className = `equip-upgrade-btn ${modClass}${filledClass}`;
    if (value) {
      btn.dataset.name = value;
      btn.textContent = type === "rune" ? "R" : "S";
      btn.title = value;
    } else {
      btn.textContent = type === "rune" ? "R" : "S";
    }
    return btn;
  }

  /**
   * Make a read-only armor slot (compact).
   *
   * @param {string} key - slot key (e.g. "head")
   * @param {string} label - slot display label (e.g. "Head")
   */
  function makeArmorSlot(key, label) {
    const stat = slots[key] || "";
    const rune = runes[key] || "";

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--compact";

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon" + (stat ? " equip-slot__icon--filled" : "");

    const info = document.createElement("div");
    info.className = "equip-slot__info";

    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    if (stat) {
      valueEl.className = "equip-slot__value";
      valueEl.textContent = stat;
    } else {
      valueEl.className = "equip-slot__value equip-slot__value--empty";
      valueEl.textContent = "—";
    }

    info.append(labelEl, valueEl);
    wrapper.append(iconDiv, info);

    // Upgrade sub-slots
    const upgradeContainer = document.createElement("div");
    upgradeContainer.className = "equip-upgrade-slots";
    upgradeContainer.append(makeUpgradeBtn("rune", rune));
    wrapper.append(upgradeContainer);

    return wrapper;
  }

  /**
   * Make a read-only weapon slot.
   *
   * @param {string} key - slot key (e.g. "mainhand1")
   * @param {string} slotLabel - display label for the slot (e.g. "Main Hand")
   */
  function makeWeaponSlot(key, slotLabel) {
    const weaponName = weapons[key] || "";
    const stat = slots[key] || "";
    const sigilArr = Array.isArray(sigils[key]) ? sigils[key] : (sigils[key] ? [sigils[key]] : []);

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--weapon";

    // Weapon type button (left section with icon + name)
    const weaponBtn = document.createElement("div");
    weaponBtn.className = "equip-weapon-type-btn";

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (weaponName ? " equip-slot__icon--filled" : "");

    const nameSpan = document.createElement("span");
    nameSpan.className = "equip-weapon-name" + (weaponName ? "" : " equip-weapon-name--empty");
    nameSpan.textContent = weaponName || slotLabel;
    weaponBtn.append(iconDiv, nameSpan);

    // Stat section (right)
    const statDiv = document.createElement("div");
    statDiv.className = "equip-stat-pick-btn" + (stat ? "" : " equip-stat-pick-btn--empty");
    if (stat) {
      const comboName = document.createElement("span");
      comboName.className = "equip-slot__combo-name";
      comboName.textContent = stat;
      statDiv.append(comboName);
    } else {
      statDiv.textContent = "—";
    }

    wrapper.append(weaponBtn, statDiv);

    // Sigil upgrade buttons
    if (sigilArr.length > 0) {
      const upgradeContainer = document.createElement("div");
      upgradeContainer.className = "equip-upgrade-slots";
      for (const sigilName of sigilArr) {
        upgradeContainer.append(makeUpgradeBtn("sigil", sigilName || ""));
      }
      wrapper.append(upgradeContainer);
    }

    return wrapper;
  }

  /**
   * Make a read-only consumable slot.
   *
   * @param {string} label - Slot label (e.g. "Food")
   * @param {string} value - Item name, or empty string.
   */
  function makeConsumableSlot(label, value) {
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--consumable";

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--consumable" + (value ? " equip-slot__icon--filled" : "");

    const info = document.createElement("div");
    info.className = "equip-slot__info";

    const nameEl = document.createElement("div");
    if (value) {
      nameEl.className = "equip-slot__consumable-name";
      nameEl.textContent = value;
    } else {
      nameEl.className = "equip-slot__consumable-name equip-slot__value--empty";
      nameEl.textContent = `${label}: None`;
    }

    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = label;

    info.append(labelEl, nameEl);
    wrapper.append(iconDiv, info);
    return wrapper;
  }

  /**
   * Make a compact read-only trinket slot.
   *
   * @param {string} key - slot key (e.g. "back")
   * @param {string} label - display label
   */
  function makeTrinketSlot(key, label) {
    const stat = slots[key] || "";

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--compact";

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon" + (stat ? " equip-slot__icon--filled" : "");

    const info = document.createElement("div");
    info.className = "equip-slot__info";

    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    if (stat) {
      valueEl.className = "equip-slot__value";
      valueEl.textContent = stat;
    } else {
      valueEl.className = "equip-slot__value equip-slot__value--empty";
      valueEl.textContent = "—";
    }

    info.append(labelEl, valueEl);
    wrapper.append(iconDiv, info);
    return wrapper;
  }

  // ── LEFT COLUMN ────────────────────────────────────────────────────────────

  const leftCol = document.createElement("div");
  leftCol.className = "equip-col equip-col--left";

  // Armor section
  const armorSection = makeSection("Armor");
  const armorDefs = [
    { key: "head",      label: "Head" },
    { key: "shoulders", label: "Shoulders" },
    { key: "chest",     label: "Chest" },
    { key: "hands",     label: "Hands" },
    { key: "legs",      label: "Legs" },
    { key: "feet",      label: "Feet" },
  ];
  // Use a grid for the 6 armor slots (2 columns)
  const armorGrid = document.createElement("div");
  armorGrid.className = "equip-trinket-grid";
  armorGrid.style.gridTemplateColumns = "1fr 1fr";
  for (const { key, label } of armorDefs) {
    armorGrid.append(makeArmorSlot(key, label));
  }
  armorSection.append(armorGrid);
  leftCol.append(armorSection);

  // Weapons section
  const weaponSection = makeSection("Weapons");
  const weaponSets = [
    { label: "Set 1", slots: [{ key: "mainhand1", label: "Main Hand" }, { key: "offhand1", label: "Off Hand" }] },
    { label: "Set 2", slots: [{ key: "mainhand2", label: "Main Hand" }, { key: "offhand2", label: "Off Hand" }] },
  ];
  for (const set of weaponSets) {
    const setLabel = document.createElement("div");
    setLabel.className = "equip-set-label";
    setLabel.textContent = set.label;
    weaponSection.append(setLabel);
    for (const { key, label } of set.slots) {
      weaponSection.append(makeWeaponSlot(key, label));
    }
  }
  leftCol.append(weaponSection);

  // Consumables section
  const consumeSection = makeSection("Consumables");
  consumeSection.append(
    makeConsumableSlot("Relic", equip.relic || ""),
    makeConsumableSlot("Food", equip.food || ""),
    makeConsumableSlot("Utility", equip.utility || ""),
    makeConsumableSlot("Enrichment", equip.enrichment || ""),
  );
  leftCol.append(consumeSection);

  // ── CENTER COLUMN ──────────────────────────────────────────────────────────

  const artCol = document.createElement("div");
  artCol.className = "equip-col equip-col--art";

  if (build.professionIcon) {
    const bgIcon = document.createElement("div");
    bgIcon.className = "equip-art-bg-icon";
    bgIcon.innerHTML = build.professionIcon;
    artCol.append(bgIcon);
  }

  // ── RIGHT COLUMN ───────────────────────────────────────────────────────────

  const rightCol = document.createElement("div");
  rightCol.className = "equip-col equip-col--right";

  // Stat Package section
  const statPkgSection = makeSection("Stat Package");
  const statPkgEl = document.createElement("div");
  statPkgEl.className = "equip-slot equip-slot--compact";
  statPkgEl.style.justifyContent = "center";
  const statPkgValueEl = document.createElement("div");
  if (equip.statPackage) {
    statPkgValueEl.className = "equip-slot__value";
    statPkgValueEl.textContent = equip.statPackage;
  } else {
    statPkgValueEl.className = "equip-slot__value equip-slot__value--empty";
    statPkgValueEl.textContent = "—";
  }
  statPkgEl.append(statPkgValueEl);
  statPkgSection.append(statPkgEl);
  rightCol.append(statPkgSection);

  // Trinkets section
  const trinketSection = makeSection("Trinkets");

  // Row 1: Back, Accessory 1, Accessory 2 (3-col grid)
  const trinketRow1 = document.createElement("div");
  trinketRow1.className = "equip-trinket-grid";
  for (const { key, label } of [
    { key: "back",       label: "Back" },
    { key: "accessory1", label: "Accessory 1" },
    { key: "accessory2", label: "Accessory 2" },
  ]) {
    trinketRow1.append(makeTrinketSlot(key, label));
  }

  // Row 2: Amulet, Ring 1, Ring 2
  const trinketRow2 = document.createElement("div");
  trinketRow2.className = "equip-trinket-grid";
  for (const { key, label } of [
    { key: "amulet", label: "Amulet" },
    { key: "ring1",  label: "Ring 1" },
    { key: "ring2",  label: "Ring 2" },
  ]) {
    trinketRow2.append(makeTrinketSlot(key, label));
  }

  trinketSection.append(trinketRow1, trinketRow2);
  rightCol.append(trinketSection);

  // Rune Summary section
  const allRunes = Object.values(runes).filter(Boolean);
  if (allRunes.length > 0) {
    const runeSummarySection = makeSection("Runes");
    const runeCounts = new Map();
    for (const r of allRunes) {
      runeCounts.set(r, (runeCounts.get(r) || 0) + 1);
    }
    for (const [runeName, count] of runeCounts) {
      const runeRow = document.createElement("div");
      runeRow.className = "equip-slot equip-slot--compact";
      const runeUpgradeSlots = document.createElement("div");
      runeUpgradeSlots.className = "equip-upgrade-slots";
      runeUpgradeSlots.append(makeUpgradeBtn("rune", runeName));
      const runeInfo = document.createElement("div");
      runeInfo.className = "equip-slot__info";
      const runeLabel = document.createElement("div");
      runeLabel.className = "equip-slot__label";
      runeLabel.textContent = `${count}×`;
      const runeValue = document.createElement("div");
      runeValue.className = "equip-slot__value";
      runeValue.textContent = runeName;
      runeInfo.append(runeLabel, runeValue);
      runeRow.append(runeUpgradeSlots, runeInfo);
      runeSummarySection.append(runeRow);
    }
    rightCol.append(runeSummarySection);
  }

  // Infusion Summary section
  const allInfusionValues = [];
  for (const v of Object.values(infusions)) {
    if (Array.isArray(v)) {
      for (const item of v) { if (item) allInfusionValues.push(item); }
    } else if (v) {
      allInfusionValues.push(v);
    }
  }
  if (allInfusionValues.length > 0) {
    const infusionSummarySection = makeSection("Infusions");
    const infusionCounts = new Map();
    for (const inf of allInfusionValues) {
      infusionCounts.set(inf, (infusionCounts.get(inf) || 0) + 1);
    }
    for (const [infName, count] of infusionCounts) {
      const infRow = document.createElement("div");
      infRow.className = "equip-slot equip-slot--compact";
      const infInfo = document.createElement("div");
      infInfo.className = "equip-slot__info";
      const infLabel = document.createElement("div");
      infLabel.className = "equip-slot__label";
      infLabel.textContent = `${count}×`;
      const infValue = document.createElement("div");
      infValue.className = "equip-slot__value";
      infValue.textContent = infName;
      infInfo.append(infLabel, infValue);
      infRow.append(infInfo);
      infusionSummarySection.append(infRow);
    }
    rightCol.append(infusionSummarySection);
  }

  // ── Assemble layout ────────────────────────────────────────────────────────

  const layout = document.createElement("div");
  layout.className = "equip-layout";
  layout.append(leftCol, artCol, rightCol);
  container.append(layout);

  // ── Notes ─────────────────────────────────────────────────────────────────

  if (build.notes) {
    const notesEl = document.createElement("div");
    notesEl.className = "site-notes";
    notesEl.textContent = build.notes;
    container.append(notesEl);
  }
}
