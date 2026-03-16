import { state } from "./state.js";
import {
  STAT_COMBOS, STAT_COMBOS_BY_LABEL, SLOT_WEIGHTS, EQUIP_ARMOR_SLOTS, EQUIP_WEAPON_SETS,
  EQUIP_TRINKET_SLOTS, EQUIP_UNDERWATER_SLOTS, GW2_WEAPONS, GW2_WEAPONS_BY_ID,
  GW2_RELICS, GW2_RELICS_BY_LABEL,
  PROFESSION_WEIGHT,
  LEGENDARY_ARMOR_ICONS, _WK,
  PROFESSION_BASE_HP,
} from "./constants.js";
import { escapeHtml } from "./utils.js";
import { computeSlotStats, computeEquipmentStats, computeUpgradeModifiers, computeStatBreakdown } from "./stats.js";
import { bindHoverPreview } from "./detail-panel.js";
import { getProfessionSvg } from "./profession-icons.js";

export { computeSlotStats, computeEquipmentStats, computeUpgradeModifiers, computeStatBreakdown } from "./stats.js";

let _readOnly = false;
export function setReadOnly(val) { _readOnly = val; }

// DOM refs
let _el = { equipmentPanel: null };
export function initEquipment(domRefs) { _el = { ..._el, ...domRefs }; }

// Callback injection (to avoid circular deps)
let _markEditorChanged = () => {};
let _render = () => {};
let _renderSkills = () => {};
export function initEquipmentCallbacks({ markEditorChanged, render, renderSkills }) {
  _markEditorChanged = markEditorChanged;
  _render = render;
  _renderSkills = renderSkills;
}

// Module-level slot picker state
let _slotPickerEl = null;
let _slotPickerCleanup = null;

export function closeSlotPicker() {
  if (_slotPickerEl) { _slotPickerEl.remove(); _slotPickerEl = null; }
  if (_slotPickerCleanup) { _slotPickerCleanup(); _slotPickerCleanup = null; }
}

export function openSlotPicker(anchorEl, currentValue, onSelect, { items = null, searchPlaceholder = "Search stats…", className = "", tabs = null } = {}) {
  closeSlotPicker();

  const picker = document.createElement("div");
  picker.className = "slot-picker" + (className ? ` ${className}` : "");

  const search = document.createElement("input");
  search.type = "search";
  search.className = "slot-picker__search";
  search.placeholder = searchPlaceholder;
  search.autocomplete = "off";

  // Tab bar (optional)
  let tabBar = null;
  let activeTab = tabs ? tabs[0].key : null;
  if (tabs) {
    tabBar = document.createElement("div");
    tabBar.className = "slot-picker__tabs";
    for (const tab of tabs) {
      const tabBtn = document.createElement("button");
      tabBtn.type = "button";
      tabBtn.className = "slot-picker__tab" + (tab.key === activeTab ? " slot-picker__tab--active" : "");
      tabBtn.textContent = tab.label;
      tabBtn.dataset.tab = tab.key;
      tabBtn.addEventListener("click", () => {
        activeTab = tab.key;
        tabBar.querySelectorAll(".slot-picker__tab").forEach((t) => t.classList.toggle("slot-picker__tab--active", t.dataset.tab === activeTab));
        renderPickerList(search.value);
      });
      tabBar.append(tabBtn);
    }
  }

  const list = document.createElement("div");
  list.className = "slot-picker__list";

  const allOptions = items ?? [
    { value: "", label: "— Empty —", subtitle: "" },
    ...STAT_COMBOS.map((c) => ({ value: c.label, label: c.label, subtitle: c.stats.join(" · ") })),
  ];

  function renderPickerList(query) {
    list.innerHTML = "";
    const q = query.trim().toLowerCase();
    const filtered = allOptions.filter((o) => {
      if (activeTab && o._tab && o._tab !== activeTab) return false;
      if (q && !o.label.toLowerCase().includes(q) && !(o.subtitle || "").toLowerCase().includes(q)) return false;
      return true;
    });
    for (const opt of filtered) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-picker__option" + (opt.value === currentValue ? " slot-picker__option--selected" : "");
      if (opt.icon) {
        const img = document.createElement("img");
        img.className = "slot-picker__icon";
        img.src = opt.icon;
        img.alt = "";
        img.draggable = false;
        img.addEventListener("error", () => img.remove());
        btn.append(img);
      }
      const text = document.createElement("span");
      text.className = "slot-picker__text";
      if (opt.subtitle) {
        text.innerHTML = `<span class="slot-picker__name">${escapeHtml(opt.label)}</span><span class="slot-picker__stats">${escapeHtml(opt.subtitle).replace(/\n/g, "<br>")}</span>`;
      } else {
        text.innerHTML = `<span class="slot-picker__name">${escapeHtml(opt.label)}</span>`;
      }
      btn.append(text);
      if (opt.disabled) {
        btn.disabled = true;
        btn.style.opacity = "0.4";
        btn.style.pointerEvents = "none";
      }
      btn.addEventListener("click", () => { if (opt.disabled) return; onSelect(opt.value); closeSlotPicker(); });
      list.append(btn);
    }
  }

  renderPickerList("");
  let _searchDebounce = null;
  search.addEventListener("input", () => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => renderPickerList(search.value), 80);
  });
  if (tabBar) picker.append(search, tabBar, list);
  else picker.append(search, list);
  document.body.append(picker);
  _slotPickerEl = picker;

  const rect = anchorEl.getBoundingClientRect();
  const pickerW = Math.max(rect.width, 250);
  const spaceBelow = window.innerHeight - rect.bottom;
  picker.style.position = "fixed";
  picker.style.left = `${Math.min(rect.left, window.innerWidth - pickerW - 8)}px`;
  picker.style.width = `${pickerW}px`;
  if (spaceBelow >= 260 || spaceBelow >= rect.top) {
    picker.style.top = `${rect.bottom + 4}px`;
    picker.style.maxHeight = `${Math.min(300, spaceBelow - 8)}px`;
  } else {
    picker.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    picker.style.maxHeight = `${Math.min(300, rect.top - 8)}px`;
  }

  requestAnimationFrame(() => search.focus());

  const onOutside = (e) => { if (!picker.contains(e.target) && !anchorEl.contains(e.target)) closeSlotPicker(); };
  const onEsc = (e) => { if (e.key === "Escape") closeSlotPicker(); };
  // Prevent the page from scrolling when the wheel is used over the picker.
  // If the event is over the scrollable list, only block when the list is already at its scroll limit.
  picker.addEventListener("wheel", (e) => {
    const inList = list.contains(e.target);
    if (inList) {
      const atTop = list.scrollTop === 0 && e.deltaY < 0;
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1 && e.deltaY > 0;
      if (!atTop && !atBottom) return;
    }
    e.preventDefault();
  }, { passive: false });
  const onOutsideWheel = (e) => { if (!picker.contains(e.target)) closeSlotPicker(); };
  setTimeout(() => {
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEsc);
    document.addEventListener("wheel", onOutsideWheel, { capture: true, passive: true });
  }, 0);
  _slotPickerCleanup = () => {
    document.removeEventListener("pointerdown", onOutside);
    document.removeEventListener("keydown", onEsc);
    document.removeEventListener("wheel", onOutsideWheel, { capture: true });
  };
}

// Build picker items list from upgrade catalog data
function getUpgradePickerItems(type) {
  const catalog = state.upgradeCatalog;
  if (!catalog) return [{ value: "", label: "— Loading… —", subtitle: "Upgrade data not yet loaded" }];
  const items = catalog[type] || [];
  return [
    { value: "", label: "— None —" },
    ...items.map((item) => ({
      value: String(item.id),
      label: type === "runes"
        ? item.name.replace(/^Superior Rune of (the )?/, "")
        : type === "sigils"
          ? item.name.replace(/^Superior Sigil of (the )?/, "")
          : type === "enrichments"
            ? item.name.replace(/ Enrichment$/, "")
            : item.name,
      subtitle: type === "runes"
        ? (item.bonuses?.length ? item.bonuses[item.bonuses.length - 1] : "")
        : (type === "sigils" || type === "infusions" || type === "enrichments")
          ? (item.buffDescription || item.description || "").slice(0, 100)
          : (item.description || "").slice(0, 100),
      icon: item.icon,
      _fullName: item.name,
      ...(item.category ? { _tab: item.category } : {}),
    })),
  ];
}

// Create upgrade sub-slot button for a given equipment slot
function makeUpgradeBtn(type, slotKey, currentValue, onSelect) {
  // PvP mode has no rune/sigil/infusion customization
  if (state.editor.gameMode === "pvp") return null;
  const catalog = state.upgradeCatalog;
  const btn = document.createElement("button");
  btn.type = "button";
  const typeClass = type === "runes" ? "rune" : type === "sigils" ? "sigil" : type === "enrichments" ? "enrichment" : "infusion";
  const letter = type === "runes" ? "R" : type === "sigils" ? "S" : type === "enrichments" ? "E" : "I";
  btn.className = `equip-upgrade-btn equip-upgrade-btn--${typeClass}` + (currentValue ? " equip-upgrade-btn--filled" : "");

  if (currentValue && catalog) {
    const lookupMap = type === "runes" ? catalog.runeById
      : type === "sigils" ? catalog.sigilById
      : type === "enrichments" ? catalog.enrichmentById
      : catalog.infusionById;
    const itemDef = lookupMap?.get(Number(currentValue));
    if (itemDef?.icon) {
      const img = document.createElement("img");
      img.src = itemDef.icon;
      img.alt = itemDef.name;
      img.draggable = false;
      img.addEventListener("error", () => { img.remove(); btn.textContent = letter; });
      btn.append(img);
    } else {
      btn.textContent = letter;
    }
  } else {
    btn.textContent = letter;
  }

  const pickerType = type;
  const INFUSION_TABS = [
    { key: "wvw", label: "WvW" },
    { key: "pve", label: "PvE" },
  ];
  if (!_readOnly) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openSlotPicker(btn, currentValue, onSelect, {
        items: getUpgradePickerItems(pickerType),
        searchPlaceholder: `Search ${pickerType}…`,
        ...(type === "infusions" ? { tabs: INFUSION_TABS } : {}),
      });
    });
  }

  // Hover preview
  bindHoverPreview(btn, `equip-${typeClass}`, () => {
    if (!currentValue || !catalog) return null;
    const lookupMap = type === "runes" ? catalog.runeById
      : type === "sigils" ? catalog.sigilById
      : type === "enrichments" ? catalog.enrichmentById
      : catalog.infusionById;
    const itemDef = lookupMap?.get(Number(currentValue));
    if (!itemDef) return null;
    if (type === "runes" && itemDef.bonuses?.length) {
      // Count how many armor slots have this same rune equipped
      const runes = state.editor.equipment?.runes || {};
      const activeCount = Object.values(runes).filter((v) => String(v) === String(currentValue)).length;
      return { name: itemDef.name, icon: itemDef.icon, description: "", bonuses: itemDef.bonuses, activeBonusCount: activeCount };
    }
    const desc = (type === "sigils" || type === "infusions" || type === "enrichments") && itemDef.buffDescription
      ? itemDef.buffDescription
      : itemDef.description || "";
    return { name: itemDef.name, icon: itemDef.icon, description: desc };
  });

  return btn;
}

export function updateHealthOrb() {
  const orbHp = document.querySelector(".health-orb__hp");
  if (!orbHp) return;
  const profession = state.editor.profession || "";
  const baseHp = PROFESSION_BASE_HP[profession] ?? 0;
  const computed = computeEquipmentStats();
  const totalHp = baseHp > 0 ? baseHp + (computed.Vitality || 0) * 10 : 0;
  orbHp.textContent = totalHp > 0 ? totalHp.toLocaleString() : "—";
}

export function renderEquipmentPanel() {
  const panel = _el.equipmentPanel;
  if (!panel) return;
  closeSlotPicker();
  panel.innerHTML = "";

  const equip = state.editor.equipment;
  const slots = equip.slots || {};
  const weapons = equip.weapons || {};

  function makeSlot(slotDef, { compact = false } = {}) {
    const currentCombo = slots[slotDef.key] || "";
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot" + (compact ? " equip-slot--compact" : "");
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const icon = document.createElement("div");
    icon.className = "equip-slot__icon" + (currentCombo ? " equip-slot__icon--filled" : "");
    const legendaryUrl = (() => {
      if (!currentCombo) return null;
      const prof = state.editor.profession;
      const weight = PROFESSION_WEIGHT[prof];
      return weight ? (LEGENDARY_ARMOR_ICONS[weight]?.[slotDef.key] ?? null) : null;
    })();
    const slotIcon = (currentCombo && slotDef.filledIcon) ? slotDef.filledIcon : slotDef.icon;
    const imgSrc = legendaryUrl
      ? legendaryUrl
      : slotIcon
        ? (slotIcon.startsWith("https://") ? slotIcon : `https://wiki.guildwars2.com/wiki/Special:FilePath/${slotIcon}`)
        : null;
    if (imgSrc) {
      const img = document.createElement("img");
      img.src = imgSrc;
      img.alt = slotDef.label;
      img.draggable = false;
      img.addEventListener("error", () => { img.remove(); });
      icon.append(img);
    }

    const info = document.createElement("div");
    info.className = "equip-slot__info";

    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = slotDef.label;

    const valueEl = document.createElement("div");
    valueEl.className = "equip-slot__value" + (currentCombo ? "" : " equip-slot__value--empty");
    if (currentCombo) {
      const combo = STAT_COMBOS_BY_LABEL.get(currentCombo);
      valueEl.innerHTML = `<span class="equip-slot__combo-name">${escapeHtml(currentCombo)}</span>${combo ? `<span class="equip-slot__combo-stats">${combo.stats.join(" · ")}</span>` : ""}`;
    } else {
      valueEl.textContent = _readOnly ? "—" : "Select stats…";
    }

    info.append(labelEl, valueEl);
    wrapper.append(icon, info);

    if (_readOnly) {
      wrapper.removeAttribute("role");
      wrapper.style.cursor = "default";
      wrapper.tabIndex = -1;
    }

    const doOpen = () => openSlotPicker(wrapper, currentCombo, (newVal) => {
      state.editor.equipment.slots[slotDef.key] = newVal || "";
      _markEditorChanged();
      renderEquipmentPanel();
    });
    if (!_readOnly) {
      wrapper.addEventListener("click", doOpen);
      wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });
    }

    bindHoverPreview(wrapper, "equip-stat", () => {
      if (!currentCombo) return null;
      const combo = STAT_COMBOS_BY_LABEL.get(currentCombo);
      if (!combo) return null;
      const facts = computeSlotStats(currentCombo, slotDef.key)
        .map(({ stat, value }) => ({ text: stat, value: `+${value}` }));
      return { name: combo.label, icon: imgSrc, description: "", facts, slot: slotDef.label };
    });

    // Upgrade sub-slots
    const upgradeContainer = document.createElement("div");
    upgradeContainer.className = "equip-upgrade-slots";

    // Rune (armor + breather only)
    const isArmorSlot = ["head", "shoulders", "chest", "hands", "legs", "feet", "breather"].includes(slotDef.key);
    if (isArmorSlot) {
      const runeVal = equip.runes?.[slotDef.key] || "";
      const runeBtn = makeUpgradeBtn("runes", slotDef.key, runeVal, (newVal) => {
        if (!equip.runes) equip.runes = {};
        equip.runes[slotDef.key] = newVal || "";
        _markEditorChanged();
        renderEquipmentPanel();
      });
      if (runeBtn) upgradeContainer.append(runeBtn);
    }

    // Infusion (all slots that have infusion entries)
    if (equip.infusions && slotDef.key in equip.infusions) {
      const infValue = equip.infusions[slotDef.key];
      if (Array.isArray(infValue)) {
        // Multi-slot infusions (back=2, rings=3)
        for (let i = 0; i < infValue.length; i++) {
          const infBtn = makeUpgradeBtn("infusions", slotDef.key, String(infValue[i] || ""), (newVal) => {
            equip.infusions[slotDef.key][i] = newVal || "";
            _markEditorChanged();
            renderEquipmentPanel();
          });
          if (infBtn) upgradeContainer.append(infBtn);
        }
      } else {
        const infBtn = makeUpgradeBtn("infusions", slotDef.key, String(infValue || ""), (newVal) => {
          equip.infusions[slotDef.key] = newVal || "";
          _markEditorChanged();
          renderEquipmentPanel();
        });
        if (infBtn) upgradeContainer.append(infBtn);
      }
    }

    // Enrichment (amulet only)
    if (slotDef.key === "amulet") {
      const enrichVal = equip.enrichment || "";
      const enrichBtn = makeUpgradeBtn("enrichments", "amulet", enrichVal, (newVal) => {
        equip.enrichment = newVal || "";
        _markEditorChanged();
        renderEquipmentPanel();
      });
      if (enrichBtn) upgradeContainer.append(enrichBtn);
    }

    if (upgradeContainer.children.length > 0) {
      wrapper.append(upgradeContainer);
    }

    return wrapper;
  }

  function makeWeaponSlot(slotDef, { isAquatic = false } = {}) {
    const isOffhand = slotDef.hand === "off";
    const mainhandKey = slotDef.key.replace("offhand", "mainhand");
    const mainhandWeaponId = !isAquatic ? (weapons[mainhandKey] || "") : "";
    const mainhandProfFlags = !isAquatic ? (state.activeCatalog?.professionWeapons?.[mainhandWeaponId]?.flags || []) : [];
    const lockedByTwoHanded = !isAquatic && isOffhand && (
      mainhandProfFlags.includes("TwoHand") ||
      GW2_WEAPONS_BY_ID.get(mainhandWeaponId)?.hand === "two"
    );

    const currentWeapon = weapons[slotDef.key] || "";
    const currentCombo = slots[slotDef.key] || "";
    const weaponDef = GW2_WEAPONS_BY_ID.get(currentWeapon);
    const emptyIcon = isAquatic
      ? `${_WK}/3/3f/Aquatic_weapon_slot.png`
      : "https://wiki.guildwars2.com/images/d/de/Sword_slot.png";

    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--weapon" + (lockedByTwoHanded ? " equip-slot--disabled" : "");

    const weaponBtn = document.createElement("button");
    weaponBtn.type = "button";
    weaponBtn.className = "equip-weapon-type-btn";
    weaponBtn.disabled = lockedByTwoHanded;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentWeapon ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = weaponDef ? weaponDef.icon : emptyIcon;
    img.alt = weaponDef ? weaponDef.label : slotDef.label;
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);

    const weaponNameSpan = document.createElement("span");
    weaponNameSpan.className = "equip-weapon-name" + (currentWeapon ? "" : " equip-weapon-name--empty");
    weaponNameSpan.textContent = lockedByTwoHanded ? "— Two-Handed —" : (weaponDef?.label || slotDef.label);
    weaponBtn.append(iconDiv, weaponNameSpan);

    const noWeapon = !currentWeapon;
    const statBtn = document.createElement("button");
    statBtn.type = "button";
    statBtn.className = "equip-stat-pick-btn" + (currentCombo ? "" : " equip-stat-pick-btn--empty") + (noWeapon ? " equip-slot--no-weapon" : "");
    statBtn.disabled = lockedByTwoHanded || noWeapon;
    if (lockedByTwoHanded || (_readOnly && !currentCombo)) {
      statBtn.style.display = "none";
    } else if (currentCombo) {
      const combo = STAT_COMBOS_BY_LABEL.get(currentCombo);
      statBtn.innerHTML = `<span class="equip-slot__combo-name">${escapeHtml(currentCombo)}</span>${combo ? `<span class="equip-slot__combo-stats">${combo.stats.join(" · ")}</span>` : ""}`;
    } else {
      statBtn.textContent = _readOnly ? "—" : "Select stats…";
    }

    if (_readOnly) {
      weaponBtn.style.cursor = "default";
      weaponBtn.disabled = true;
    }

    wrapper.append(weaponBtn, statBtn);

    bindHoverPreview(weaponBtn, "equip-weapon", () => {
      const wDef = GW2_WEAPONS_BY_ID.get(equip.weapons?.[slotDef.key] || "");
      if (!wDef) return null;
      return { name: wDef.label, icon: wDef.icon, description: "", hand: wDef.hand };
    });

    bindHoverPreview(statBtn, "equip-stat", () => {
      const curCombo = equip.slots?.[slotDef.key] || "";
      const combo = curCombo ? STAT_COMBOS_BY_LABEL.get(curCombo) : null;
      if (!combo) return null;
      const facts = computeSlotStats(curCombo, slotDef.key).map(({ stat, value }) => ({ text: stat, value: `+${value}` }));
      return { name: combo.label, icon: "", description: "", facts, slot: slotDef.label };
    });

    if (!lockedByTwoHanded) {
      if (isAquatic) {
        // Show weapons the profession can use underwater. A weapon qualifies if:
        // 1. It has the Aquatic flag in professionWeapons, AND
        // 2. It has at least one skill without the NoUnderwater flag
        // This correctly excludes spear for professions where all spear skills are land-only.
        const profWeaponsData = state.activeCatalog?.professionWeapons || {};
        const weaponSkillById = state.activeCatalog?.weaponSkillById || new Map();
        const hasUnderwaterSkills = (wData) => {
          if (!wData?.skills?.length) return false;
          return wData.skills.some((ref) => {
            const skill = weaponSkillById.get(ref.id);
            return skill && !(skill.flags || []).includes("NoUnderwater");
          });
        };
        const aquaticItems = [
          { value: "", label: "— Empty —" },
          ...GW2_WEAPONS.filter((w) => {
            const wData = profWeaponsData[w.id];
            if (!wData) return false;
            if (w.hand === "aquatic") return true;
            return wData.flags?.includes("Aquatic") && hasUnderwaterSkills(wData);
          }).map((w) => ({
            value: w.id, label: w.label, icon: w.icon,
          })),
        ];
        if (!_readOnly) {
          weaponBtn.addEventListener("click", () => {
            openSlotPicker(weaponBtn, currentWeapon, (newVal) => {
              if (!equip.weapons) equip.weapons = {};
              equip.weapons[slotDef.key] = newVal || "";
              _markEditorChanged();
              renderEquipmentPanel();
            }, { items: aquaticItems, searchPlaceholder: "Search aquatic weapons…" });
          });
        }
      } else {
        const profWeapons = state.activeCatalog?.professionWeapons || {};
        const weaponItems = [
          { value: "", label: "— Empty —", subtitle: "" },
          ...GW2_WEAPONS.filter((w) => {
            if (w.hand === "aquatic") return false;
            const wData = profWeapons[w.id];
            if (!wData) return false;
            if (isOffhand) return wData.flags.includes("Offhand");
            return wData.flags.includes("Mainhand") || wData.flags.includes("TwoHand");
          }).map((w) => {
            const flags = profWeapons[w.id]?.flags || [];
            const subtitle = flags.includes("TwoHand") ? "Two-handed"
              : flags.includes("Mainhand") && flags.includes("Offhand") ? "Main / Off Hand"
              : "";
            return { value: w.id, label: w.label, subtitle, icon: w.icon };
          }),
        ];
        if (!_readOnly) {
          weaponBtn.addEventListener("click", () => {
            openSlotPicker(weaponBtn, currentWeapon, (newVal) => {
              if (!equip.weapons) equip.weapons = {};
              equip.weapons[slotDef.key] = newVal || "";
              const newFlags = profWeapons[newVal]?.flags || [];
              if (newFlags.includes("TwoHand")) {
                const ofKey = slotDef.key.replace("mainhand", "offhand");
                equip.weapons[ofKey] = "";
                equip.slots[ofKey] = "";
              }
              // Clear second sigil on the mainhand when swapping to one-handed
              if (!newFlags.includes("TwoHand") && equip.sigils?.[slotDef.key]) {
                equip.sigils[slotDef.key][1] = "";
              }
              _markEditorChanged();
              renderEquipmentPanel();
              _renderSkills();
            }, { items: weaponItems, searchPlaceholder: "Search weapons…" });
          });
        }
      }

      if (!_readOnly) {
        statBtn.addEventListener("click", () => {
          openSlotPicker(statBtn, currentCombo, (newVal) => {
            equip.slots[slotDef.key] = newVal || "";
            _markEditorChanged();
            renderEquipmentPanel();
          });
        });
      }
    }

    // Upgrade sub-slots for weapons
    if (!lockedByTwoHanded) {
      const upgradeContainer = document.createElement("div");
      upgradeContainer.className = "equip-upgrade-slots" + (noWeapon ? " equip-slot--no-weapon" : "");

      // Determine sigil count: two-handed = 2, one-handed/empty = 1
      const weaponId = weapons[slotDef.key] || "";
      const wDef = GW2_WEAPONS_BY_ID.get(weaponId);
      const isTwoHanded = wDef?.hand === "two" || (
        !slotDef.key.startsWith("offhand") &&
        (state.activeCatalog?.professionWeapons?.[weaponId]?.flags || []).includes("TwoHand")
      );
      // Aquatic weapons are always two-handed; offhand always 1
      const isAquaticSlot = slotDef.key.startsWith("aquatic");
      const sigilCount = slotDef.key.startsWith("offhand") ? 1 : (isAquaticSlot || isTwoHanded ? 2 : 1);
      const sigilArr = equip.sigils?.[slotDef.key] || [];

      // Two-handed: stack SS / II in a 2×2 grid
      if (isTwoHanded) upgradeContainer.classList.add("equip-upgrade-slots--stacked");

      for (let i = 0; i < sigilCount; i++) {
        const sigilVal = String(sigilArr[i] || "");
        const sigilBtn = makeUpgradeBtn("sigils", slotDef.key, sigilVal, (newVal) => {
          if (!equip.sigils) equip.sigils = {};
          if (!Array.isArray(equip.sigils[slotDef.key])) {
            equip.sigils[slotDef.key] = slotDef.key.startsWith("offhand") ? [""] : ["", ""];
          }
          equip.sigils[slotDef.key][i] = newVal || "";
          _markEditorChanged();
          renderEquipmentPanel();
        });
        if (sigilBtn) upgradeContainer.append(sigilBtn);
      }

      // Infusion — two-handed / aquatic = 2 slots; offhand = 1
      const infusionCount = slotDef.key.startsWith("offhand") ? 1 : (isAquaticSlot || isTwoHanded ? 2 : 1);
      const infArr = equip.infusions?.[slotDef.key] || [];
      const infArrNorm = Array.isArray(infArr) ? infArr : [infArr];

      for (let i = 0; i < infusionCount; i++) {
        const infVal = String(infArrNorm[i] || "");
        const weapInfBtn = makeUpgradeBtn("infusions", slotDef.key, infVal, (newVal) => {
          if (!equip.infusions) equip.infusions = {};
          if (!Array.isArray(equip.infusions[slotDef.key])) {
            equip.infusions[slotDef.key] = slotDef.key.startsWith("offhand") ? [""] : ["", ""];
          }
          equip.infusions[slotDef.key][i] = newVal || "";
          _markEditorChanged();
          renderEquipmentPanel();
        });
        if (weapInfBtn) upgradeContainer.append(weapInfBtn);
      }

      if (upgradeContainer.children.length > 0) {
        wrapper.append(upgradeContainer);
      }
    }

    return wrapper;
  }

  function _applyUpgradeFill(fill, newVal) {
    const pickerType = fill.type;
    for (const key of fill.keys) {
      // Skip weapon slots with no weapon equipped
      if (weapons[key] !== undefined && !weapons[key]) continue;
      if (pickerType === "sigils") {
        if (!equip.sigils) equip.sigils = {};
        if (!Array.isArray(equip.sigils[key])) {
          equip.sigils[key] = key.startsWith("offhand") ? [""] : ["", ""];
        }
        equip.sigils[key][0] = newVal;
        if (equip.sigils[key].length > 1) equip.sigils[key][1] = newVal;
      } else if (pickerType === "runes") {
        if (!equip.runes) equip.runes = {};
        equip.runes[key] = newVal;
      } else {
        if (!equip.infusions) equip.infusions = {};
        if (Array.isArray(equip.infusions[key])) {
          equip.infusions[key] = equip.infusions[key].map(() => newVal);
        } else {
          equip.infusions[key] = newVal;
        }
      }
    }
  }

  function makeSection(title, { fillSlotKeys, onClear, upgradeFills } = {}) {
    const section = document.createElement("div");
    section.className = "equip-section panel";
    const head = document.createElement("div");
    head.className = "equip-section__head";
    const titleEl = document.createElement("span");
    titleEl.textContent = title;
    head.append(titleEl);
    const btnGroup = document.createElement("div");
    btnGroup.className = "equip-section__btns";

    // Build fill menu entries
    const fillEntries = [];
    if (fillSlotKeys && fillSlotKeys.length) {
      fillEntries.push({ label: "Stats", action: (anchor) => {
        openSlotPicker(anchor, "", (newVal) => {
          if (newVal === "") return;
          for (const key of fillSlotKeys) {
            // Skip weapon slots with no weapon equipped
            if (weapons[key] !== undefined && !weapons[key]) continue;
            state.editor.equipment.slots[key] = newVal;
          }
          _markEditorChanged();
          renderEquipmentPanel();
        });
      }});
    }
    if (upgradeFills && upgradeFills.length && state.editor.gameMode !== "pvp") {
      for (const fill of upgradeFills) {
        fillEntries.push({ label: fill.label.replace(/^Fill\s+/, ""), action: (anchor) => {
          const pickerType = fill.type;
          openSlotPicker(anchor, "", (newVal) => {
            if (newVal === "") return;
            _applyUpgradeFill(fill, newVal);
            _markEditorChanged();
            renderEquipmentPanel();
          }, {
            items: getUpgradePickerItems(pickerType),
            searchPlaceholder: `Search ${pickerType}…`,
            ...(pickerType === "infusions" ? { tabs: [{ key: "wvw", label: "WvW" }, { key: "pve", label: "PvE" }] } : {}),
          });
        }});
      }
    }

    if (fillEntries.length && !_readOnly) {
      const fillBtn = document.createElement("button");
      fillBtn.type = "button";
      fillBtn.className = "equip-fill-btn" + (fillEntries.length > 1 ? " equip-fill-btn--dropdown" : "");
      fillBtn.textContent = fillEntries.length > 1 ? "Fill \u25BE" : "Fill";
      if (!_readOnly) {
        fillBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          // If only one entry, trigger it directly
          if (fillEntries.length === 1) {
            fillEntries[0].action(fillBtn);
            return;
          }
          // Show fill menu dropdown
          const existing = document.querySelector(".equip-fill-menu");
          if (existing) existing.remove();
          const menu = document.createElement("div");
          menu.className = "equip-fill-menu";
          for (const entry of fillEntries) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "equip-fill-menu__item";
            item.textContent = entry.label;
            item.addEventListener("click", (ev) => {
              ev.stopPropagation();
              menu.remove();
              entry.action(fillBtn);
            });
            menu.append(item);
          }
          document.body.append(menu);
          const rect = fillBtn.getBoundingClientRect();
          menu.style.position = "fixed";
          menu.style.left = `${rect.left}px`;
          menu.style.top = `${rect.bottom + 2}px`;
          const closeMenu = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("pointerdown", closeMenu); } };
          setTimeout(() => document.addEventListener("pointerdown", closeMenu), 0);
        });
      }
      btnGroup.append(fillBtn);
    }

    if (onClear && !_readOnly) {
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "equip-fill-btn equip-clear-btn";
      clearBtn.textContent = "Clear";
      if (!_readOnly) {
        clearBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          onClear();
          _markEditorChanged();
          renderEquipmentPanel();
        });
      }
      btnGroup.append(clearBtn);
    }
    head.append(btnGroup);
    section.append(head);
    return section;
  }

  // === LEFT COLUMN ===
  const leftCol = document.createElement("div");
  leftCol.className = "equip-col equip-col--left";

  // Clear All button
  const clearAllBtn = document.createElement("button");
  clearAllBtn.type = "button";
  clearAllBtn.className = "equip-fill-btn equip-clear-btn equip-clear-all-btn";
  clearAllBtn.textContent = "Clear All Equipment";
  if (_readOnly) {
    clearAllBtn.style.display = "none";
  }
  if (!_readOnly) {
    clearAllBtn.addEventListener("click", () => {
      for (const key of Object.keys(equip.slots)) equip.slots[key] = "";
      for (const key of Object.keys(equip.weapons)) equip.weapons[key] = "";
      if (equip.runes) for (const key of Object.keys(equip.runes)) equip.runes[key] = "";
      if (equip.sigils) {
        for (const key of Object.keys(equip.sigils)) {
          equip.sigils[key] = key.startsWith("offhand") ? [""] : ["", ""];
        }
      }
      if (equip.infusions) {
        for (const key of Object.keys(equip.infusions)) {
          if (Array.isArray(equip.infusions[key])) {
            equip.infusions[key] = equip.infusions[key].map(() => "");
          } else {
            equip.infusions[key] = "";
          }
        }
      }
      equip.enrichment = "";
      equip.relic = "";
      equip.food = "";
      equip.utility = "";
      _markEditorChanged();
      renderEquipmentPanel();
    });
  }

  // Armor
  const armorKeys = EQUIP_ARMOR_SLOTS.map((s) => s.key);
  const armorSection = makeSection("Armor", {
    fillSlotKeys: armorKeys,
    onClear: () => {
      for (const key of armorKeys) {
        equip.slots[key] = "";
        if (equip.runes) equip.runes[key] = "";
        if (equip.infusions) equip.infusions[key] = "";
      }
    },
    upgradeFills: [
      { label: "Fill Runes", type: "runes", keys: armorKeys },
      { label: "Fill Infusions", type: "infusions", keys: armorKeys },
    ],
  });
  for (const slotDef of EQUIP_ARMOR_SLOTS) armorSection.append(makeSlot(slotDef));
  leftCol.append(armorSection);

  // Weapons
  const weaponKeys = EQUIP_WEAPON_SETS.flat().map((s) => s.key);
  const weaponSection = makeSection("Weapons", {
    fillSlotKeys: weaponKeys,
    onClear: () => {
      for (const key of weaponKeys) {
        equip.slots[key] = "";
        equip.weapons[key] = "";
        if (equip.sigils?.[key]) equip.sigils[key] = key.startsWith("offhand") ? [""] : ["", ""];
        if (equip.infusions) equip.infusions[key] = "";
      }
    },
    upgradeFills: [
      { label: "Fill Sigils", type: "sigils", keys: weaponKeys },
      { label: "Fill Infusions", type: "infusions", keys: weaponKeys },
    ],
  });
  EQUIP_WEAPON_SETS.forEach((setSlots, i) => {
    const setLabel = document.createElement("div");
    setLabel.className = "equip-set-label";
    setLabel.textContent = `Set ${i + 1}`;
    weaponSection.append(setLabel);
    for (const slotDef of setSlots) weaponSection.append(makeWeaponSlot(slotDef));
  });
  leftCol.append(weaponSection);

  // Consumables
  const consumeSection = makeSection("Consumables", {
    onClear: () => { equip.food = ""; equip.utility = ""; },
  });

  const foodCatalog = state.upgradeCatalog?.foods || [];
  const foodItems = [
    { value: "", label: "— None —" },
    ...foodCatalog.map((f) => ({ value: String(f.id), label: f.name, icon: f.icon, subtitle: f.buff.replace(/ \| /g, "\n"), _tab: f.rarity === "Ascended" ? "ascended" : "other" })),
  ];
  const FOOD_TABS = [
    { key: "ascended", label: "Ascended" },
    { key: "other", label: "Other" },
  ];
  const utilityCatalog = state.upgradeCatalog?.utilities || [];
  const utilityItems = [
    { value: "", label: "— None —" },
    ...utilityCatalog.map((u) => ({ value: String(u.id), label: u.name, icon: u.icon, subtitle: u.buff.replace(/ \| /g, "\n") })),
  ];

  function makeConsumableSlot({ field, label, items, searchPlaceholder, hoverKind, defaultIcon, getDef, tabs: slotTabs }) {
    const current = equip[field] || "";
    const def = getDef(current);
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--consumable";
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--consumable" + (current ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = def ? def.icon : defaultIcon;
    img.alt = def ? def.label : label;
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);

    const info = document.createElement("div");
    info.className = "equip-slot__info";
    const nameEl = document.createElement("div");
    nameEl.className = "equip-slot__consumable-name" + (current ? "" : " equip-slot__value--empty");
    nameEl.textContent = (def ? def.label : current) || `${label}: None`;
    const buffEl = document.createElement("div");
    buffEl.className = "equip-slot__consumable-buff";
    buffEl.innerHTML = def ? escapeHtml(def.buff).replace(/ \| /g, "<br>") : "";
    info.append(nameEl, buffEl);
    wrapper.append(iconDiv, info);

    if (_readOnly) {
      wrapper.removeAttribute("role");
      wrapper.style.cursor = "default";
      wrapper.tabIndex = -1;
    }

    const doOpen = () => openSlotPicker(wrapper, current, (newVal) => {
      equip[field] = newVal || "";
      _markEditorChanged();
      renderEquipmentPanel();
    }, { items, searchPlaceholder, ...(slotTabs ? { tabs: slotTabs } : {}) });
    if (!_readOnly) {
      wrapper.addEventListener("click", doOpen);
      wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });
    }

    bindHoverPreview(wrapper, hoverKind, () => {
      const d = getDef(equip[field] || "");
      if (!d) return null;
      return { name: d.label, icon: d.icon, description: (d.buff || "").split(" | ").join("\n") };
    });

    return wrapper;
  }

  consumeSection.append(
    makeConsumableSlot({
      field: "food", label: "Food", items: foodItems, searchPlaceholder: "Search food…",
      hoverKind: "equip-food", defaultIcon: `${_WK}/6/6b/Nourishment.png`,
      getDef: (v) => { const f = state.upgradeCatalog?.foodById?.get(Number(v)); return f ? { label: f.name, icon: f.icon, buff: f.buff } : null; },
      tabs: FOOD_TABS,
    }),
    makeConsumableSlot({
      field: "utility", label: "Utility", items: utilityItems, searchPlaceholder: "Search utility…",
      hoverKind: "equip-utility", defaultIcon: `${_WK}/d/d6/Enhancement.png`,
      getDef: (v) => { const u = state.upgradeCatalog?.utilityById?.get(Number(v)); return u ? { label: u.name, icon: u.icon, buff: u.buff } : null; },
    }),
  );
  leftCol.append(consumeSection);

  // Notes
  const notesSection = makeSection("Notes");
  const notesTA = document.createElement("textarea");
  notesTA.id = "notesInput";
  notesTA.className = "equip-notes";
  notesTA.rows = 4;
  notesTA.value = state.editor.notes || "";
  notesTA.placeholder = "Combo priorities, matchup notes, rotation...";
  if (_readOnly) {
    notesTA.readOnly = true;
  } else {
    notesTA.addEventListener("input", () => {
      state.editor.notes = notesTA.value;
      _markEditorChanged({ updateBuildList: true });
    });
  }
  notesSection.append(notesTA);
  leftCol.append(notesSection);

  // === RIGHT COLUMN ===
  const rightCol = document.createElement("div");
  rightCol.className = "equip-col equip-col--right";

  // Attributes
  const statsSection = makeSection("Attributes");
  const computed = computeEquipmentStats();
  const professionName = state.editor.profession;
  const baseHP = PROFESSION_BASE_HP[professionName] || 9212;
  const health = baseHP + (computed.Vitality || 0) * 10;
  // Collect upgrade modifiers and apply ones that map to derived stats
  const modifiers = computeUpgradeModifiers();
  const popMod = (key) => { const v = modifiers.get(key) || 0; modifiers.delete(key); return v; };
  const critChance = Math.min(100, 5 + ((computed.Precision || 1000) - 895) / 21.0 + popMod("Critical Chance"));
  const critDamage = 150 + (computed.Ferocity || 0) / 15.0 + popMod("Critical Damage");
  const condDuration = (computed.Expertise || 0) / 15.0 + popMod("Condition Duration");
  const boonDuration = (computed.Concentration || 0) / 15.0 + popMod("Boon Duration");

  const statRows = [
    { stat: "Power",           key: "Power",          value: computed.Power },
    { stat: "Precision",       key: "Precision",      value: computed.Precision,       derived: "Crit Chance",      derivedVal: `${critChance.toFixed(1)}%` },
    { stat: "Toughness",       key: "Toughness",      value: computed.Toughness },
    { stat: "Vitality",        key: "Vitality",       value: computed.Vitality,        derived: "Health",            derivedVal: health.toLocaleString() },
    { stat: "Ferocity",        key: "Ferocity",       value: computed.Ferocity,        derived: "Crit Damage",       derivedVal: `${critDamage.toFixed(0)}%` },
    { stat: "Condition Dmg",   key: "ConditionDamage", value: computed.ConditionDamage },
    { stat: "Expertise",       key: "Expertise",      value: computed.Expertise,       derived: "Cond. Duration",    derivedVal: `${condDuration.toFixed(1)}%` },
    { stat: "Concentration",   key: "Concentration",  value: computed.Concentration,   derived: "Boon Duration",     derivedVal: `${boonDuration.toFixed(1)}%` },
    { stat: "Healing Power",   key: "HealingPower",   value: computed.HealingPower },
  ];

  const statsGrid = document.createElement("div");
  statsGrid.className = "equip-stats";
  for (const row of statRows) {
    const rowEl = document.createElement("div");
    rowEl.className = "equip-stat-row";

    const leftEl = document.createElement("div");
    leftEl.className = "equip-stat-cell";
    leftEl.innerHTML = `<span class="equip-stat-label">${row.stat}</span><span class="equip-stat-value">${(row.value || 0).toLocaleString()}</span>`;

    bindHoverPreview(leftEl, "equip-stat", () => {
      const breakdown = computeStatBreakdown(row.key);
      if (!breakdown.length) return null;
      const lines = breakdown.map((e) => `+${e.value}  ${e.source}`);
      const total = breakdown.reduce((s, e) => s + e.value, 0);
      lines.push(`——\n${total}  Total ${row.stat}`);
      return { name: row.stat, description: lines.join("\n") };
    });

    rowEl.append(leftEl);

    if (row.derived) {
      const rightEl = document.createElement("div");
      rightEl.className = "equip-stat-cell equip-stat-cell--derived";
      rightEl.innerHTML = `<span class="equip-stat-label">${row.derived}</span><span class="equip-stat-value equip-stat-value--derived">${row.derivedVal}</span>`;
      rowEl.append(rightEl);
    }

    statsGrid.append(rowEl);
  }
  statsSection.append(statsGrid);

  // Remaining upgrade modifiers (non-attribute bonuses not folded into derived stats)
  if (modifiers.size > 0) {
    const modList = document.createElement("div");
    modList.className = "equip-modifiers";
    for (const [label, value] of modifiers) {
      const row = document.createElement("div");
      row.className = "equip-modifier-row";
      row.textContent = `+${value}% ${label}`;
      modList.append(row);
    }
    statsSection.append(modList);
  }

  rightCol.append(statsSection);

  // Trinkets — row1 (4 cols): Back, Accessory 1, Accessory 2, Relic
  //            row2 (3 cols): Amulet, Ring 1, Ring 2
  const relicItems = [
    { value: "", label: "— None —" },
    ...GW2_RELICS.map((r) => ({ value: r.label, label: r.label, icon: r.icon })),
  ];

  function makeRelicSlot() {
    const currentRelic = equip.relic || "";
    const relicDef = GW2_RELICS_BY_LABEL.get(currentRelic);
    const wrapper = document.createElement("div");
    wrapper.className = "equip-slot equip-slot--compact";
    wrapper.setAttribute("role", "button");
    wrapper.tabIndex = 0;

    const iconDiv = document.createElement("div");
    iconDiv.className = "equip-slot__icon equip-slot__icon--weapon" + (currentRelic ? " equip-slot__icon--filled" : "");
    const img = document.createElement("img");
    img.src = relicDef
      ? relicDef.icon
      : "https://wiki.guildwars2.com/wiki/Special:FilePath/Relic_slot.png";
    img.alt = relicDef ? relicDef.label : "Relic";
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    iconDiv.append(img);

    const info = document.createElement("div");
    info.className = "equip-slot__info";
    const labelEl = document.createElement("div");
    labelEl.className = "equip-slot__label";
    labelEl.textContent = "Relic";
    const valueEl = document.createElement("div");
    valueEl.className = "equip-slot__combo-name" + (currentRelic ? "" : " equip-slot__value--empty");
    valueEl.style.fontSize = "10px";
    valueEl.textContent = currentRelic
      ? currentRelic.replace("Relic of ", "").replace("Relic of the ", "the ")
      : (_readOnly ? "—" : "Select…");
    info.append(labelEl, valueEl);
    wrapper.append(iconDiv, info);

    if (_readOnly) {
      wrapper.removeAttribute("role");
      wrapper.style.cursor = "default";
      wrapper.tabIndex = -1;
    }

    const doOpen = () => openSlotPicker(wrapper, currentRelic, (newVal) => {
      equip.relic = newVal || "";
      _markEditorChanged();
      renderEquipmentPanel();
    }, { items: relicItems, searchPlaceholder: "Search relics…" });
    if (!_readOnly) {
      wrapper.addEventListener("click", doOpen);
      wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });
    }

    bindHoverPreview(wrapper, "equip-relic", () => {
      const rDef = GW2_RELICS_BY_LABEL.get(equip.relic || "");
      if (!rDef) return null;
      return { name: rDef.label, icon: rDef.icon, description: "" };
    });

    return wrapper;
  }

  const allTrinketKeys = ["back", "accessory1", "accessory2", "amulet", "ring1", "ring2"];
  const trinketInfusionKeys = ["back", "accessory1", "accessory2", "ring1", "ring2"]; // amulet uses enrichment
  const trinketSection = makeSection("Trinkets", {
    fillSlotKeys: allTrinketKeys,
    onClear: () => {
      for (const key of allTrinketKeys) {
        equip.slots[key] = "";
      }
      if (equip.infusions) {
        for (const key of trinketInfusionKeys) {
          if (Array.isArray(equip.infusions[key])) {
            equip.infusions[key] = equip.infusions[key].map(() => "");
          } else {
            equip.infusions[key] = "";
          }
        }
      }
      equip.enrichment = "";
      equip.relic = "";
    },
    upgradeFills: [
      { label: "Fill Infusions", type: "infusions", keys: trinketInfusionKeys },
    ],
  });

  const trinketRow1 = document.createElement("div");
  trinketRow1.className = "equip-trinket-grid equip-trinket-grid--4";
  for (const key of ["back", "accessory1", "accessory2"]) {
    const slotDef = EQUIP_TRINKET_SLOTS.find((s) => s.key === key);
    if (slotDef) trinketRow1.append(makeSlot(slotDef, { compact: true }));
  }
  trinketRow1.append(makeRelicSlot());

  const trinketRow2 = document.createElement("div");
  trinketRow2.className = "equip-trinket-grid";
  for (const key of ["amulet", "ring1", "ring2"]) {
    const slotDef = EQUIP_TRINKET_SLOTS.find((s) => s.key === key);
    if (slotDef) trinketRow2.append(makeSlot(slotDef, { compact: true }));
  }

  trinketSection.append(trinketRow1, trinketRow2);
  rightCol.append(trinketSection);

  // Underwater
  const underwaterKeys = EQUIP_UNDERWATER_SLOTS.map((s) => s.key);
  const underwaterSection = makeSection("Underwater", {
    fillSlotKeys: underwaterKeys,
    onClear: () => {
      for (const key of underwaterKeys) {
        equip.slots[key] = "";
        if (equip.weapons[key] !== undefined) equip.weapons[key] = "";
        if (equip.runes?.[key] !== undefined) equip.runes[key] = "";
        if (equip.sigils?.[key]) equip.sigils[key] = ["", ""];
        if (equip.infusions?.[key] !== undefined) {
          if (Array.isArray(equip.infusions[key])) {
            equip.infusions[key] = equip.infusions[key].map(() => "");
          } else {
            equip.infusions[key] = "";
          }
        }
      }
    },
    upgradeFills: [
      { label: "Fill Runes", type: "runes", keys: ["breather"] },
      { label: "Fill Infusions", type: "infusions", keys: underwaterKeys },
    ],
  });
  for (const slotDef of EQUIP_UNDERWATER_SLOTS) {
    underwaterSection.append(slotDef.hand === "aquatic" ? makeWeaponSlot(slotDef, { isAquatic: true }) : makeSlot(slotDef));
  }
  rightCol.append(underwaterSection);

  // Center: profession / elite spec class icon
  const artCol = document.createElement("div");
  artCol.className = "equip-col equip-col--art";
  if (state.editor.profession) {
    // Determine active elite spec name, fall back to core profession
    const catalog = state.activeCatalog;
    const activeEliteSpec = (state.editor.specializations || [])
      .map((e) => Number(e?.specializationId) || 0)
      .filter((id) => id > 0)
      .map((id) => catalog?.specializationById?.get(id))
      .find((s) => s?.elite);
    const iconName = activeEliteSpec ? activeEliteSpec.name : state.editor.profession;
    const svg = getProfessionSvg(iconName);
    if (svg) {
      const bgIcon = document.createElement("div");
      bgIcon.className = "equip-art-bg-icon";
      bgIcon.innerHTML = svg;
      artCol.append(bgIcon);
    }
  }

  // Layout
  const layout = document.createElement("div");
  layout.className = "equip-layout";
  layout.append(leftCol, artCol, rightCol);
  panel.append(clearAllBtn, layout);
  updateHealthOrb();
}
