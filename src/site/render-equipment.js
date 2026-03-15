/**
 * Renders read-only equipment matching the desktop's equip-layout 3-column grid.
 *
 * @param {HTMLElement} container - The element to render into.
 * @param {object} build - Enriched build object from serializeForPublish.
 *   Expected fields:
 *     build.equipment.statPackage  — overall stat package name
 *     build.equipment.weapons      — { mainhand1, offhand1, mainhand2, offhand2 }
 *     build.equipment.slots        — { head, shoulders, ... } stat names per slot
 *     build.equipment.runes        — { head, shoulders, ... } rune IDs per armor slot
 *     build.equipment.sigils       — { mainhand1: ["id1", "id2"], ... }
 *     build.equipment.infusions    — infusion data per slot
 *     build.equipment.relic        — relic ID
 *     build.equipment.food         — food ID
 *     build.equipment.utility      — utility ID
 *     build.equipment.enrichment   — enrichment ID
 *     build.equipmentDisplay       — resolved upgrade objects (runes, sigils, infusions, food, utility, relic, enrichment)
 *     build.professionIcon         — SVG string (optional)
 *     build.notes                  — build notes text (optional)
 */

const STAT_COMBOS = {
  "Berserker's": "Power · Precision · Ferocity",
  "Marauder's": "Power · Precision · Vitality · Ferocity",
  "Assassin's": "Precision · Power · Ferocity",
  "Valkyrie": "Power · Vitality · Ferocity",
  "Dragon's": "Power · Ferocity · Vitality · Precision",
  "Viper's": "Power · Condition Damage · Precision · Expertise",
  "Grieving": "Power · Condition Damage · Ferocity · Precision",
  "Sinister": "Condition Damage · Power · Precision",
  "Dire": "Condition Damage · Toughness · Vitality",
  "Rabid": "Condition Damage · Toughness · Precision",
  "Carrion": "Condition Damage · Power · Vitality",
  "Trailblazer's": "Toughness · Condition Damage · Vitality · Expertise",
  "Knight's": "Toughness · Power · Precision",
  "Soldier's": "Power · Toughness · Vitality",
  "Cleric's": "Healing Power · Toughness · Power",
  "Minstrel's": "Toughness · Healing Power · Vitality · Concentration",
  "Harrier's": "Power · Healing Power · Concentration",
  "Ritualist's": "Vitality · Condition Damage · Expertise · Concentration",
  "Seraph": "Precision · Condition Damage · Healing Power · Concentration",
  "Zealot's": "Power · Precision · Healing Power",
  "Celestial": "Power · Precision · Toughness · Vitality · Condition Damage · Ferocity · Healing Power · Expertise · Concentration",
};

export function renderEquipment(container, build) {
  container.innerHTML = "";

  const equip = build.equipment || {};
  const slots = equip.slots || {};
  const weapons = equip.weapons || {};
  const display = build.equipmentDisplay || {};
  const displayRunes = display.runes || {};
  const displaySigils = display.sigils || {};
  const displayInfusions = display.infusions || {};

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
   * Make a read-only upgrade button (rune, sigil, or infusion).
   *
   * @param {"rune"|"sigil"|"infusion"} type
   * @param {string} value - Display name of the upgrade, or empty string.
   * @returns {HTMLElement}
   */
  function makeUpgradeBtn(type, value) {
    const btn = document.createElement("div");
    let modClass;
    let letter;
    if (type === "rune") {
      modClass = "equip-upgrade-btn--rune";
      letter = "R";
    } else if (type === "sigil") {
      modClass = "equip-upgrade-btn--sigil";
      letter = "S";
    } else {
      modClass = "equip-upgrade-btn--infusion";
      letter = "I";
    }
    const filledClass = value ? " equip-upgrade-btn--filled" : "";
    btn.className = `equip-upgrade-btn ${modClass}${filledClass}`;
    btn.textContent = letter;
    if (value) {
      btn.dataset.name = value;
      btn.title = value;
    }
    return btn;
  }

  /**
   * Make a read-only armor slot (compact, vertical list style).
   *
   * @param {string} key - slot key (e.g. "head")
   * @param {string} label - slot display label (e.g. "HEAD")
   */
  function makeArmorSlot(key, label) {
    const stat = slots[key] || "";
    const runeObj = displayRunes[key] || null;
    const runeName = runeObj?.name || "";
    const infusionValue = displayInfusions[key];
    const infusionName = infusionValue
      ? (Array.isArray(infusionValue) ? (infusionValue[0]?.name || "") : (infusionValue?.name || ""))
      : "";

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

    // Stat combo breakdown
    const comboStats = STAT_COMBOS[stat];
    if (comboStats) {
      const comboEl = document.createElement("div");
      comboEl.className = "equip-slot__combo-stats";
      comboEl.textContent = comboStats;
      info.append(comboEl);
    }

    wrapper.append(iconDiv, info);

    // Upgrade sub-slots (rune + infusion)
    const upgradeContainer = document.createElement("div");
    upgradeContainer.className = "equip-upgrade-slots";
    if (runeName) {
      upgradeContainer.append(makeUpgradeBtn("rune", runeName));
    }
    if (infusionName) {
      upgradeContainer.append(makeUpgradeBtn("infusion", infusionName));
    }
    if (upgradeContainer.childElementCount > 0) {
      wrapper.append(upgradeContainer);
    }

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
    const sigilDisplayArr = Array.isArray(displaySigils[key])
      ? displaySigils[key]
      : displaySigils[key]
        ? [displaySigils[key]]
        : [];

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--weapon";

    // Weapon type button (left section with icon + name)
    const weaponBtn = document.createElement("div");
    weaponBtn.className = "equip-weapon-type-btn";

    const iconDiv = document.createElement("div");
    iconDiv.className =
      "equip-slot__icon equip-slot__icon--weapon" + (weaponName ? " equip-slot__icon--filled" : "");

    const nameSpan = document.createElement("span");
    nameSpan.className = "equip-weapon-name" + (weaponName ? "" : " equip-weapon-name--empty");
    nameSpan.textContent = weaponName || slotLabel;
    weaponBtn.append(iconDiv, nameSpan);

    // Stat section
    const statDiv = document.createElement("div");
    statDiv.className = "equip-stat-pick-btn" + (stat ? "" : " equip-stat-pick-btn--empty");
    if (stat) {
      const comboName = document.createElement("span");
      comboName.className = "equip-slot__combo-name";
      comboName.textContent = stat;
      statDiv.append(comboName);

      const comboStats = STAT_COMBOS[stat];
      if (comboStats) {
        const comboStatsEl = document.createElement("span");
        comboStatsEl.className = "equip-slot__combo-stats";
        comboStatsEl.textContent = comboStats;
        statDiv.append(comboStatsEl);
      }
    } else {
      statDiv.textContent = "—";
    }

    wrapper.append(weaponBtn, statDiv);

    // Sigil upgrade buttons (resolved names)
    if (sigilDisplayArr.length > 0) {
      const upgradeContainer = document.createElement("div");
      upgradeContainer.className = "equip-upgrade-slots";
      for (const sigilObj of sigilDisplayArr) {
        const sigilName = sigilObj?.name || "";
        upgradeContainer.append(makeUpgradeBtn("sigil", sigilName));
      }
      wrapper.append(upgradeContainer);
    }

    return wrapper;
  }

  /**
   * Make a read-only consumable slot.
   *
   * @param {string} label - Slot label (e.g. "Food")
   * @param {object|null} displayObj - Resolved display object with .name, or null.
   */
  function makeConsumableSlot(label, displayObj) {
    const value = displayObj?.name || "";

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--consumable";

    const iconDiv = document.createElement("div");
    iconDiv.className =
      "equip-slot__icon equip-slot__icon--consumable" + (value ? " equip-slot__icon--filled" : "");

    const info = document.createElement("div");
    info.className = "equip-slot__info";

    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = label;

    const nameEl = document.createElement("div");
    if (value) {
      nameEl.className = "equip-slot__consumable-name";
      nameEl.textContent = value;
    } else {
      nameEl.className = "equip-slot__consumable-name equip-slot__value--empty";
      nameEl.textContent = "None";
    }

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

    // Stat combo breakdown for trinkets
    const comboStats = STAT_COMBOS[stat];
    if (comboStats) {
      const comboEl = document.createElement("div");
      comboEl.className = "equip-slot__combo-stats";
      comboEl.textContent = comboStats;
      info.append(comboEl);
    }

    wrapper.append(iconDiv, info);
    return wrapper;
  }

  // ── LEFT COLUMN ────────────────────────────────────────────────────────────

  const leftCol = document.createElement("div");
  leftCol.className = "equip-col equip-col--left";

  // Armor section — vertical list (not 2-col grid)
  const armorSection = makeSection("Armor");
  const armorDefs = [
    { key: "head",      label: "HEAD" },
    { key: "shoulders", label: "SHOULDERS" },
    { key: "chest",     label: "CHEST" },
    { key: "hands",     label: "HANDS" },
    { key: "legs",      label: "LEGS" },
    { key: "feet",      label: "FEET" },
  ];
  for (const { key, label } of armorDefs) {
    armorSection.append(makeArmorSlot(key, label));
  }
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

  // Consumables section — use resolved names from equipmentDisplay
  const consumeSection = makeSection("Consumables");
  consumeSection.append(
    makeConsumableSlot("Relic", display.relic || null),
    makeConsumableSlot("Food", display.food || null),
    makeConsumableSlot("Utility", display.utility || null),
    makeConsumableSlot("Enrichment", display.enrichment || null),
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

  // Trinkets section
  const trinketSection = makeSection("Trinkets");

  // Row 1: Back, Accessory 1, Accessory 2
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

  // Rune Summary section — resolved names from equipmentDisplay
  const allResolvedRunes = Object.values(displayRunes).filter(Boolean);
  if (allResolvedRunes.length > 0) {
    const runeSummarySection = makeSection("Runes");
    const runeCounts = new Map();
    for (const runeObj of allResolvedRunes) {
      const name = runeObj.name || "";
      if (!name) continue;
      runeCounts.set(name, (runeCounts.get(name) || 0) + 1);
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

  // Infusion Summary section — resolved names from equipmentDisplay
  const allResolvedInfusions = [];
  for (const v of Object.values(displayInfusions)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item?.name) allResolvedInfusions.push(item.name);
      }
    } else if (v?.name) {
      allResolvedInfusions.push(v.name);
    }
  }
  if (allResolvedInfusions.length > 0) {
    const infusionSummarySection = makeSection("Infusions");
    const infusionCounts = new Map();
    for (const infName of allResolvedInfusions) {
      infusionCounts.set(infName, (infusionCounts.get(infName) || 0) + 1);
    }
    for (const [infName, count] of infusionCounts) {
      const infRow = document.createElement("div");
      infRow.className = "equip-slot equip-slot--compact";
      const infUpgradeSlots = document.createElement("div");
      infUpgradeSlots.className = "equip-upgrade-slots";
      infUpgradeSlots.append(makeUpgradeBtn("infusion", infName));
      const infInfo = document.createElement("div");
      infInfo.className = "equip-slot__info";
      const infLabel = document.createElement("div");
      infLabel.className = "equip-slot__label";
      infLabel.textContent = `${count}×`;
      const infValue = document.createElement("div");
      infValue.className = "equip-slot__value";
      infValue.textContent = infName;
      infInfo.append(infLabel, infValue);
      infRow.append(infUpgradeSlots, infInfo);
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
