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
 *     build.equipmentIcons         — { head: "URL", shoulders: "URL", ... } icon URLs per slot
 *     build.equipmentDisplay       — resolved upgrade objects (runes, sigils, infusions, food, utility, relic, enrichment)
 *     build.computedStats          — { Power: 2786, Precision: 2063, ..., CritChance: "60.6%", ... }
 *     build.statModifiers          — array of modifier strings (optional)
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

const TWO_HAND_WEAPONS = new Set([
  "greatsword", "hammer", "longbow", "rifle", "shortbow", "staff", "spear", "trident", "harpoon",
]);

export function renderEquipment(container, build) {
  container.innerHTML = "";

  const equip = build.equipment || {};
  const slots = equip.slots || {};
  const weapons = equip.weapons || {};
  const display = build.equipmentDisplay || {};
  const displayRunes = display.runes || {};
  const displaySigils = display.sigils || {};
  const displayInfusions = display.infusions || {};
  const icons = build.equipmentIcons || {};
  const computedStats = build.computedStats || {};
  const statModifiers = build.statModifiers || [];

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
   * @param {string} [iconUrl] - Icon URL for the upgrade, if available.
   * @returns {HTMLElement}
   */
  function makeUpgradeBtn(type, value, iconUrl) {
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
    if (iconUrl) {
      const img = document.createElement("img");
      img.src = iconUrl;
      img.alt = letter;
      img.loading = "lazy";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      btn.append(img);
    } else {
      btn.textContent = letter;
    }
    if (value) {
      btn.dataset.name = value;
      btn.dataset.icon = iconUrl || "";
      btn.dataset.desc = "";
      btn.title = value;
    }
    return btn;
  }

  /**
   * Make a read-only armor slot (compact, vertical list style) with icon image.
   *
   * @param {string} key - slot key (e.g. "head")
   * @param {string} label - slot display label (e.g. "HEAD")
   */
  function makeArmorSlot(key, label) {
    const stat = slots[key] || "";
    const iconUrl = icons[key] || "";
    const runeObj = displayRunes[key] || null;
    const runeName = runeObj?.name || "";
    const infusionValue = displayInfusions[key];
    const infusionName = infusionValue
      ? (Array.isArray(infusionValue) ? (infusionValue[0]?.name || "") : (infusionValue?.name || ""))
      : "";

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot";
    wrapper.dataset.name = stat || label;
    wrapper.dataset.icon = iconUrl;
    wrapper.dataset.desc = STAT_COMBOS[stat] || "";

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon" + (iconUrl || stat ? " equip-slot__icon--filled" : "");
    if (iconUrl) {
      const img = document.createElement("img");
      img.src = iconUrl;
      img.alt = "";
      img.loading = "lazy";
      iconDiv.append(img);
    }

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
      upgradeContainer.append(makeUpgradeBtn("rune", runeName, runeObj?.icon || ""));
    }
    if (infusionName) {
      const infIcon = Array.isArray(infusionValue) ? (infusionValue[0]?.icon || "") : (infusionValue?.icon || "");
      upgradeContainer.append(makeUpgradeBtn("infusion", infusionName, infIcon));
    }
    if (upgradeContainer.childElementCount > 0) {
      wrapper.append(upgradeContainer);
    }

    return wrapper;
  }

  /**
   * Make a read-only weapon slot with icon image.
   *
   * @param {string} key - slot key (e.g. "mainhand1")
   * @param {string} slotLabel - display label for the slot (e.g. "Main Hand")
   */
  function makeWeaponSlot(key, slotLabel) {
    const weaponName = weapons[key] || "";
    const stat = slots[key] || "";
    const iconUrl = icons[key] || "";
    // Determine max sigil count: 2H weapons get 2 sigils, 1H weapons get 1
    const weaponType = (weaponName || "").toLowerCase();
    const isTwoHandWeapon = TWO_HAND_WEAPONS.has(weaponType);
    const maxSigils = isTwoHandWeapon ? 2 : 1;
    const rawSigils = Array.isArray(displaySigils[key])
      ? displaySigils[key]
      : displaySigils[key]
        ? [displaySigils[key]]
        : [];
    const sigilDisplayArr = rawSigils.slice(0, maxSigils);

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--weapon";
    wrapper.dataset.name = weaponName || slotLabel;
    wrapper.dataset.icon = iconUrl;
    wrapper.dataset.desc = stat ? (STAT_COMBOS[stat] || stat) : "";

    // Weapon type button (left section with icon + name)
    const weaponBtn = document.createElement("div");
    weaponBtn.className = "equip-weapon-type-btn";

    const iconDiv = document.createElement("div");
    iconDiv.className =
      "equip-slot__icon equip-slot__icon--weapon" + ((iconUrl || weaponName) ? " equip-slot__icon--filled" : "");
    if (iconUrl) {
      const img = document.createElement("img");
      img.src = iconUrl;
      img.alt = "";
      img.loading = "lazy";
      iconDiv.append(img);
    }

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

    // Sigil and infusion upgrade buttons
    const upgradeContainer = document.createElement("div");
    upgradeContainer.className = "equip-upgrade-slots";

    for (const sigilObj of sigilDisplayArr) {
      const sigilName = sigilObj?.name || "";
      const sigilIcon = sigilObj?.icon || "";
      upgradeContainer.append(makeUpgradeBtn("sigil", sigilName, sigilIcon));
    }

    // Weapon infusion badges
    const weaponInfusion = displayInfusions[key];
    if (weaponInfusion) {
      const infArr = Array.isArray(weaponInfusion) ? weaponInfusion : [weaponInfusion];
      for (const inf of infArr) {
        if (inf && inf.name) {
          upgradeContainer.append(makeUpgradeBtn("infusion", inf.name, inf.icon || ""));
        }
      }
    }

    if (upgradeContainer.childElementCount > 0) {
      wrapper.append(upgradeContainer);
    }

    return wrapper;
  }

  /**
   * Make a read-only consumable slot with icon image.
   *
   * @param {string} label - Slot label (e.g. "Food")
   * @param {object|null} displayObj - Resolved display object with .name and .icon, or null.
   */
  function makeConsumableSlot(label, displayObj) {
    const value = displayObj?.name || "";
    const iconUrl = displayObj?.icon || "";

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--consumable";
    if (displayObj) {
      wrapper.dataset.name = displayObj.name || label;
      wrapper.dataset.icon = displayObj.icon || "";
      wrapper.dataset.desc = displayObj.description || "";
    }

    const iconDiv = document.createElement("div");
    iconDiv.className =
      "equip-slot__icon equip-slot__icon--consumable" + ((iconUrl || value) ? " equip-slot__icon--filled" : "");
    if (iconUrl) {
      const img = document.createElement("img");
      img.src = iconUrl;
      img.alt = "";
      img.loading = "lazy";
      iconDiv.append(img);
    }

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
   * Make a compact read-only trinket slot with icon image.
   *
   * @param {string} key - slot key (e.g. "back")
   * @param {string} label - display label
   */
  function makeTrinketSlot(key, label) {
    const stat = slots[key] || "";
    const iconUrl = icons[key] || "";

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--compact";

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon" + ((iconUrl || stat) ? " equip-slot__icon--filled" : "");
    if (iconUrl) {
      const img = document.createElement("img");
      img.src = iconUrl;
      img.alt = "";
      img.loading = "lazy";
      iconDiv.append(img);
    }

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

    // Infusion badges for trinket slots
    const trinketInfusion = displayInfusions[key];
    if (trinketInfusion) {
      const upgradeContainer = document.createElement("div");
      upgradeContainer.className = "equip-upgrade-slots";
      const infArr = Array.isArray(trinketInfusion) ? trinketInfusion : [trinketInfusion];
      for (const inf of infArr) {
        if (inf && inf.name) {
          upgradeContainer.append(makeUpgradeBtn("infusion", inf.name, inf.icon || ""));
        }
      }
      if (upgradeContainer.childElementCount > 0) {
        wrapper.append(upgradeContainer);
      }
    }

    return wrapper;
  }

  /**
   * Make a single stat cell (label + value pair in a flex row).
   *
   * @param {string} label - Stat name
   * @param {number|string} value - Stat value
   * @param {boolean} derived - Whether to use derived styling
   */
  function makeStatCell(label, value, derived = false) {
    const cell = document.createElement("div");
    cell.className = "equip-stat-cell" + (derived ? " equip-stat-cell--derived" : "");

    const labelEl = document.createElement("span");
    labelEl.className = "equip-stat-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("span");
    valueEl.className = "equip-stat-value" + (derived ? " equip-stat-value--derived" : "");
    // Format numeric values with commas; leave strings (e.g. "60.6%") as-is
    if (typeof value === "number") {
      valueEl.textContent = value.toLocaleString();
    } else {
      valueEl.textContent = value ?? "—";
    }

    cell.append(labelEl, valueEl);
    return cell;
  }

  /**
   * Make an attributes row with one or two stat cells.
   *
   * @param {string} primaryLabel
   * @param {number|string} primaryValue
   * @param {string} [derivedLabel]
   * @param {number|string} [derivedValue]
   */
  function makeStatRow(primaryLabel, primaryValue, derivedLabel, derivedValue) {
    const row = document.createElement("div");
    row.className = "equip-stat-row";

    // Only render if primary value exists
    if (primaryValue === undefined || primaryValue === null) return row;

    row.append(makeStatCell(primaryLabel, primaryValue, false));

    if (derivedLabel !== undefined && (derivedValue !== undefined && derivedValue !== null)) {
      row.append(makeStatCell(derivedLabel, derivedValue, true));
    }

    return row;
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
    const mainhandKey = set.slots[0].key;
    const mainhandWeapon = (weapons[mainhandKey] || "").toLowerCase();
    const isTwoHand = TWO_HAND_WEAPONS.has(mainhandWeapon);
    for (const { key, label } of set.slots) {
      // Skip offhand slot when mainhand is a two-handed weapon
      if (isTwoHand && key.startsWith("offhand")) continue;
      weaponSection.append(makeWeaponSlot(key, label));
    }
  }
  leftCol.append(weaponSection);

  // Consumables section — use resolved names from equipmentDisplay
  const consumeSection = makeSection("Consumables");
  consumeSection.append(
    makeConsumableSlot("Food", display.food || null),
    makeConsumableSlot("Utility", display.utility || null),
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

  // Attributes section (Task 8) — above trinkets
  if (Object.keys(computedStats).length > 0) {
    const attrSection = makeSection("Attributes");
    const statsContainer = document.createElement("div");
    statsContainer.className = "equip-stats";

    // Stat rows layout:
    //   Power (standalone)
    //   Precision | Crit Chance
    //   Toughness (standalone)
    //   Vitality | Health
    //   Ferocity | Crit Damage
    //   Condition Damage (standalone)
    //   Expertise | Condition Duration
    //   Concentration | Boon Duration
    //   Healing Power (standalone)

    const statRowDefs = [
      { primary: "Power" },
      { primary: "Precision",         derived: "Crit Chance",       derivedKey: "CritChance" },
      { primary: "Toughness" },
      { primary: "Vitality",          derived: "Health",            derivedKey: "Health" },
      { primary: "Ferocity",          derived: "Crit Damage",       derivedKey: "CritDamage" },
      { primary: "Condition Damage",  derivedKey: null },
      { primary: "Expertise",         derived: "Condition Duration", derivedKey: "ConditionDuration" },
      { primary: "Concentration",     derived: "Boon Duration",      derivedKey: "BoonDuration" },
      { primary: "Healing Power" },
    ];

    for (const def of statRowDefs) {
      const primaryVal = computedStats[def.primary];
      if (primaryVal === undefined || primaryVal === null) continue;

      let derivedVal;
      if (def.derivedKey) {
        derivedVal = computedStats[def.derivedKey];
      }

      const row = makeStatRow(
        def.primary,
        primaryVal,
        def.derived,
        derivedVal,
      );
      if (row.childElementCount > 0) {
        statsContainer.append(row);
      }
    }

    attrSection.append(statsContainer);

    // Stat modifiers (colored text lines)
    if (statModifiers.length > 0) {
      const modifiersDiv = document.createElement("div");
      modifiersDiv.className = "equip-modifiers";
      for (const mod of statModifiers) {
        const modRow = document.createElement("div");
        modRow.className = "equip-modifier-row";
        modRow.textContent = mod;
        modifiersDiv.append(modRow);
      }
      attrSection.append(modifiersDiv);
    }

    rightCol.append(attrSection);
  }

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

  // Relic slot — shown after the trinket grids
  if (display.relic) {
    const relicSlot = makeConsumableSlot("Relic", display.relic);
    trinketSection.append(relicSlot);
  }
  rightCol.append(trinketSection);

  // ── Assemble layout ────────────────────────────────────────────────────────

  const layout = document.createElement("div");
  layout.className = "equip-layout";
  layout.append(leftCol, artCol, rightCol);
  container.append(layout);
}
