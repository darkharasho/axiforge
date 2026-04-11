import { state } from "./state.js";
import {
  STAT_COMBOS, STAT_COMBOS_BY_LABEL, SLOT_WEIGHTS, EQUIP_ARMOR_SLOTS, EQUIP_WEAPON_SETS,
  EQUIP_TRINKET_SLOTS, EQUIP_UNDERWATER_SLOTS, GW2_WEAPONS, GW2_WEAPONS_BY_ID,
  GW2_RELICS, GW2_RELICS_BY_LABEL,
  PROFESSION_WEIGHT, ARMOR_DEFENSE_BY_WEIGHT,
  LEGENDARY_ARMOR_ICONS, _WK,
  PROFESSION_BASE_HP,
  MIGHT_MAX_STACKS, STABILITY_MAX_STACKS, BOON_CONDITION_ICONS,
  getEffectiveStats,
} from "./constants.js";
import { escapeHtml } from "./utils.js";
import { computeSlotStats, computeUpgradeModifiers, computeStatBreakdown } from "./stats.js";
import { computeStats, computeBoons, computeFuryCritModifier, computeFuryStatBonuses, computeMightPerStack, FURY_CRIT_CHANCE, FURY_CRIT_CHANCE_WVW, STACKING_SIGIL_DEFS } from "./engine-bridge.js";
import { bindHoverPreview, selectDetail } from "./detail-panel.js";
import { getProfessionSvg } from "./profession-icons.js";
import { getSlotSvg } from "./slot-icons.js";
import { getWeaponSvg } from "./weapon-icons.js";
import { resolveEquippedWeaponSkills, getAvailableAttunements, resolveWarriorBurst } from "./equipment-weapon-skills.js";
import { getSkillOptionsByType } from "./skills.js";

export { computeSlotStats, computeUpgradeModifiers, computeStatBreakdown } from "./stats.js";
export { computeStats } from "./engine-bridge.js";

let _readOnly = false;
export function setReadOnly(val) { _readOnly = val; }

// Assumed boons — session-only, not persisted to builds.
let _assumedBoons = {
  might: 0, fury: false, alacrity: false,
  quickness: false, protection: false, regeneration: false,
  resolution: false, resistance: false, stability: 0,
  swiftness: false, vigor: false, aegis: false,
};
export function getAssumedBoons() { return _assumedBoons; }
export function resetAssumedBoons() {
  _assumedBoons = {
    might: 0, fury: false, alacrity: false,
    quickness: false, protection: false, regeneration: false,
    resolution: false, resistance: false, stability: 0,
    swiftness: false, vigor: false, aegis: false,
  };
}

let _sigilStacks = {};
export function getSigilStacks() { return _sigilStacks; }
export function resetSigilStacks() { _sigilStacks = {}; }

let _boonsExpanded = false;

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

let _lastBoonResetBuildId = "";

export function closeSlotPicker() {
  if (_slotPickerEl) { _slotPickerEl.remove(); _slotPickerEl = null; }
  if (_slotPickerCleanup) { _slotPickerCleanup(); _slotPickerCleanup = null; }
}

export function openSlotPicker(anchorEl, currentValue, onSelect, { items = null, searchPlaceholder = "Search stats…", className = "", tabs = null, hoverProvider = null } = {}) {
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
    ...STAT_COMBOS.map((c) => ({ value: c.label, label: c.label, subtitle: getEffectiveStats(c, state.editor?.gameMode || "pve").join(" · ") })),
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
      if (hoverProvider && opt.value) {
        bindHoverPreview(btn, ...hoverProvider(opt));
      }
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
  const result = computeStats(state);
  const totalHp = baseHp > 0 ? baseHp + (result.total.Vitality || 0) * 10 : 0;
  orbHp.textContent = totalHp > 0 ? totalHp.toLocaleString() : "—";
}

export function renderEquipmentPanel() {
  const panel = _el.equipmentPanel;
  if (!panel) return;
  closeSlotPicker();
  panel.innerHTML = "";

  // Reset assumed boons when switching builds
  const currentBuildId = state.editor.id || "";
  if (currentBuildId !== _lastBoonResetBuildId) {
    resetAssumedBoons();
    resetSigilStacks();
    _lastBoonResetBuildId = currentBuildId;
  }

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
      valueEl.innerHTML = `<span class="equip-slot__combo-name">${escapeHtml(currentCombo)}</span>${combo ? `<span class="equip-slot__combo-stats">${getEffectiveStats(combo, state.editor?.gameMode || "pve").join(" · ")}</span>` : ""}`;
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
      statBtn.innerHTML = `<span class="equip-slot__combo-name">${escapeHtml(currentCombo)}</span>${combo ? `<span class="equip-slot__combo-stats">${getEffectiveStats(combo, state.editor?.gameMode || "pve").join(" · ")}</span>` : ""}`;
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

  // Weapon Skills + Boon/Condition Coverage (left column, under Weapons)
  const catalog = state.activeCatalog;
  if (catalog) {
    const weaponSkills = resolveEquippedWeaponSkills(catalog, state.editor);
    const hasAnyWeaponSkill = weaponSkills.some((s) => s != null);

    if (hasAnyWeaponSkill) {
      const wskillSection = makeSection("Weapon Skills");

      // Weapon swap button in the section header
      const equippedWeapons = state.editor.equipment?.weapons || {};
      const activeWeaponSet = Number(state.editor.activeWeaponSet) || 1;
      const isUnderwater = Boolean(state.editor.underwaterMode);
      const hasWeaponSet2 = isUnderwater
        ? !!equippedWeapons.aquatic2
        : !!(equippedWeapons.mainhand2 || equippedWeapons.offhand2);
      const availableAttunements = getAvailableAttunements(catalog, state.editor);
      const activeAttunement = state.editor.activeAttunement || "";

      // Attunement buttons above skill row
      if (availableAttunements.length > 0) {
        const attBar = document.createElement("div");
        attBar.className = "equip-attunement-bar";
        for (const att of availableAttunements) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "equip-attunement-btn"
            + ` equip-attunement-btn--${att.toLowerCase()}`
            + (att === activeAttunement ? " equip-attunement-btn--active" : "");
          btn.title = `${att} Attunement`;
          btn.textContent = att.charAt(0);
          btn.addEventListener("click", () => {
            state.editor.activeAttunement = att;
            _renderSkills();
            renderEquipmentPanel();
            if (!_readOnly) _markEditorChanged();
          });
          attBar.append(btn);
        }
        wskillSection.append(attBar);
      }

      // Warrior: F1 burst + Berserker toggle above skill row (like attunements)
      const profId = catalog.profession?.id || state.editor.profession || "";
      const eliteSpecId = (state.editor.specializations || [])
        .map((s) => Number(s?.specializationId) || 0)
        .filter((id) => id > 0)
        .map((id) => catalog.specializationById?.get(id))
        .find((s) => s?.elite)?.id || 0;
      const isBerserker = profId === "Warrior" && eliteSpecId === 18;

      if (profId === "Warrior") {
        const options = getSkillOptionsByType(catalog, state.editor.specializations, isUnderwater);
        const burstSkill = resolveWarriorBurst(catalog, state.editor, options.profession);

        if (burstSkill || isBerserker) {
          const mechBar = document.createElement("div");
          mechBar.className = "equip-attunement-bar";

          if (burstSkill) {
            const burstBtn = document.createElement("button");
            burstBtn.type = "button";
            burstBtn.className = "equip-weapon-skill-icon equip-weapon-skill-icon--burst equip-weapon-skill-icon--small";
            burstBtn.innerHTML = `<img src="${escapeHtml(burstSkill.icon)}" alt="${escapeHtml(burstSkill.name || "")}" />`;
            burstBtn.title = burstSkill.name || "";
            bindHoverPreview(burstBtn, "skill", () => burstSkill);
            if (!_readOnly) burstBtn.addEventListener("click", () => selectDetail("skill", burstSkill));
            mechBar.append(burstBtn);
          }

          if (isBerserker) {
            const berserkSkillId = (() => {
              const f2 = (options.profession || []).find((s) => s.slot === "Profession_2" && Number(s.specialization) === 18);
              return f2?.id || 0;
            })();
            const berserkActive = berserkSkillId > 0 && (Number(state.editor.activeKit) || 0) === berserkSkillId;
            const bBtn = document.createElement("button");
            bBtn.type = "button";
            bBtn.className = "equip-attunement-btn equip-attunement-btn--berserk"
              + (berserkActive ? " equip-attunement-btn--active" : "");
            bBtn.title = berserkActive ? "Leave Berserk" : "Enter Berserk";
            bBtn.textContent = "B";
            bBtn.addEventListener("click", () => {
              state.editor.activeKit = berserkActive ? 0 : berserkSkillId;
              _renderSkills();
              renderEquipmentPanel();
              if (!_readOnly) _markEditorChanged();
            });
            mechBar.append(bBtn);
          }

          wskillSection.append(mechBar);
        }
      }

      const skillRow = document.createElement("div");
      skillRow.className = "equip-weapon-skills";

      // Weapon swap button, left of skill icons
      if (hasWeaponSet2) {
        const swapBtn = document.createElement("button");
        swapBtn.type = "button";
        swapBtn.className = "weapon-swap-btn equip-weapon-swap" + (activeWeaponSet === 2 ? " weapon-swap-btn--active" : "");
        swapBtn.title = `Switch to ${isUnderwater ? "aquatic" : "weapon set"} ${activeWeaponSet === 1 ? 2 : 1}`;
        swapBtn.innerHTML = `<svg viewBox="0 0 18 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="2,3.5 13,3.5"/><polyline points="10,1 13,3.5 10,6"/>
          <polyline points="16,10.5 5,10.5"/><polyline points="8,8 5,10.5 8,13"/>
        </svg>`;
        swapBtn.addEventListener("click", () => {
          state.editor.activeWeaponSet = activeWeaponSet === 1 ? 2 : 1;
          _renderSkills();
          renderEquipmentPanel();
          if (!_readOnly) _markEditorChanged();
        });
        skillRow.append(swapBtn);
      }

      for (let i = 0; i < 5; i++) {
        const wSkill = weaponSkills[i];
        const iconBtn = document.createElement("button");
        iconBtn.type = "button";
        iconBtn.className = "equip-weapon-skill-icon" + (wSkill ? "" : " equip-weapon-skill-icon--empty");
        iconBtn.disabled = !wSkill;
        if (wSkill?.icon) {
          iconBtn.innerHTML = `<img src="${escapeHtml(wSkill.icon)}" alt="${escapeHtml(wSkill.name || "")}" />`;
          iconBtn.title = wSkill.name || "";
          bindHoverPreview(iconBtn, "skill", () => wSkill);
          if (!_readOnly) iconBtn.addEventListener("click", () => selectDetail("skill", wSkill));
        }
        skillRow.append(iconBtn);
      }

      wskillSection.append(skillRow);

      // Boon/condition coverage
      const coverage = computeBoons(state, weaponSkills);
      const hasBoons = coverage.boons.length > 0;
      const hasConditions = coverage.conditions.length > 0;
      if (hasBoons || hasConditions) {
        const coverageContainer = document.createElement("div");
        coverageContainer.className = "equip-boon-coverage";

        function makeCoverageRow(items, className) {
          if (items.length === 0) return null;
          const row = document.createElement("div");
          row.className = className;
          for (const item of items) {
            const icon = document.createElement("div");
            icon.className = "equip-boon-coverage__icon";
            const img = document.createElement("img");
            img.src = item.icon;
            img.alt = item.name;
            img.width = 20;
            img.height = 20;
            icon.append(img);
            if (item.hasAllySource) {
              const badge = document.createElement("div");
              badge.className = "equip-boon-coverage__ally-badge";
              badge.textContent = "\u21E7";
              icon.append(badge);
            }

            icon.addEventListener("mouseenter", () => {
              const tooltip = document.createElement("div");
              tooltip.className = "boon-coverage__tooltip";

              const title = document.createElement("div");
              title.className = "boon-coverage__tooltip-title";
              title.textContent = item.name;
              tooltip.append(title);

              for (const src of item.sources) {
                const sourceRow = document.createElement("div");
                sourceRow.className = "boon-coverage__tooltip-row";

                const tag = document.createElement("span");
                tag.className = `boon-coverage__tooltip-tag boon-coverage__tooltip-tag--${src.type}`;
                tag.textContent = src.type === "skill" ? "Skill" : "Trait";
                sourceRow.append(tag);

                const srcName = document.createElement("span");
                srcName.className = "boon-coverage__tooltip-name";
                srcName.textContent = src.name;
                sourceRow.append(srcName);

                const detail = document.createElement("span");
                detail.className = "boon-coverage__tooltip-detail";
                if (src.duration > 0) {
                  const parts = [];
                  if (src.stacks > 0) parts.push(`${src.stacks}\u00d7`);
                  parts.push(`${src.duration}s`);
                  detail.textContent = parts.join(" ");
                } else {
                  detail.textContent = "passive";
                }
                sourceRow.append(detail);

                tooltip.append(sourceRow);
              }

              icon.append(tooltip);
            });

            icon.addEventListener("mouseleave", () => {
              const tooltip = icon.querySelector(".boon-coverage__tooltip");
              if (tooltip) tooltip.remove();
            });

            row.append(icon);
          }
          return row;
        }

        const boonRow = makeCoverageRow(coverage.boons, "equip-boon-coverage__boons");
        const condRow = makeCoverageRow(coverage.conditions, "equip-boon-coverage__conditions");
        if (boonRow) coverageContainer.append(boonRow);
        if (condRow) coverageContainer.append(condRow);
        wskillSection.append(coverageContainer);
      }

      leftCol.append(wskillSection);
    }
  }

  // === RIGHT COLUMN ===
  const rightCol = document.createElement("div");
  rightCol.className = "equip-col equip-col--right";

  let equippedStackingSigils = [];

  // Assumed Boons
  const boonsSection = document.createElement("div");
  boonsSection.className = "equip-boons";

  const boonsHeader = document.createElement("div");
  boonsHeader.className = "equip-section__head";

  const boonsTitle = document.createElement("span");
  boonsTitle.textContent = "Assumed Boons";
  boonsHeader.append(boonsTitle);

  // Help icon with tooltip
  const helpIcon = document.createElement("span");
  helpIcon.className = "equip-boons__help";
  helpIcon.textContent = "?";
  const helpTooltip = document.createElement("div");
  helpTooltip.className = "equip-boons__help-tooltip";
  helpTooltip.innerHTML =
    '<div class="equip-boons__help-section">Add stacks</div>' +
    '<div class="equip-boons__help-row"><kbd>Click</kbd> <span class="equip-boons__help-up">+1</span></div>' +
    '<div class="equip-boons__help-row"><kbd>Shift+Click</kbd> <span class="equip-boons__help-up">+5</span></div>' +
    '<div class="equip-boons__help-row"><kbd>Ctrl+Click</kbd> <span class="equip-boons__help-up">+25</span></div>' +
    '<div class="equip-boons__help-section">Remove stacks</div>' +
    '<div class="equip-boons__help-row"><kbd>Right Click</kbd> <span class="equip-boons__help-down">\u22121</span></div>' +
    '<div class="equip-boons__help-row"><kbd>Shift+Right</kbd> <span class="equip-boons__help-down">\u22125</span></div>' +
    '<div class="equip-boons__help-row"><kbd>Ctrl+Right</kbd> <span class="equip-boons__help-down">\u221225</span></div>';
  helpIcon.append(helpTooltip);
  boonsHeader.append(helpIcon);

  const expandBtn = document.createElement("button");
  expandBtn.className = "equip-boons__expand-btn";
  expandBtn.textContent = _boonsExpanded ? "Less ▲" : "More ▼";
  expandBtn.title = _boonsExpanded ? "Show core boons only" : "Show all boons";
  expandBtn.addEventListener("click", () => {
    _boonsExpanded = !_boonsExpanded;
    _render();
  });
  boonsHeader.append(expandBtn);

  boonsSection.append(boonsHeader);

  const boonsBar = document.createElement("div");
  boonsBar.className = "equip-boons__bar";

  const boonsExpand = document.createElement("div");
  boonsExpand.className = "equip-boons__expand" + (_boonsExpanded ? " equip-boons__expand--open" : "");

  const BOON_DEFS = [
    // Always-visible boons (core 3)
    { key: "might", label: "Might", icon: BOON_CONDITION_ICONS.Might, stackable: true, maxStacks: MIGHT_MAX_STACKS, core: true },
    { key: "fury", label: "Fury", icon: BOON_CONDITION_ICONS.Fury, stackable: false, core: true },
    { key: "alacrity", label: "Alacrity", icon: BOON_CONDITION_ICONS.Alacrity, stackable: false, core: true },
    // Expandable boons
    { key: "quickness", label: "Quickness", icon: BOON_CONDITION_ICONS.Quickness, stackable: false },
    { key: "protection", label: "Protection", icon: BOON_CONDITION_ICONS.Protection, stackable: false },
    { key: "regeneration", label: "Regen", icon: BOON_CONDITION_ICONS.Regeneration, stackable: false },
    { key: "resolution", label: "Resolution", icon: BOON_CONDITION_ICONS.Resolution, stackable: false },
    { key: "resistance", label: "Resistance", icon: BOON_CONDITION_ICONS.Resistance, stackable: false },
    { key: "stability", label: "Stability", icon: BOON_CONDITION_ICONS.Stability, stackable: true, maxStacks: STABILITY_MAX_STACKS },
    { key: "swiftness", label: "Swiftness", icon: BOON_CONDITION_ICONS.Swiftness, stackable: false },
    { key: "vigor", label: "Vigor", icon: BOON_CONDITION_ICONS.Vigor, stackable: false },
    { key: "aegis", label: "Aegis", icon: BOON_CONDITION_ICONS.Aegis, stackable: false },
  ];

  function getDelta(event) {
    if (event.ctrlKey || event.metaKey) return 25;
    if (event.shiftKey) return 5;
    return 1;
  }

  function buildBoonTooltipHTML(def) {
    const val = _assumedBoons[def.key];
    if (def.key === "might") {
      const mightValues = computeMightPerStack(state);
      if (val > 0) {
        const power = val * mightValues.power;
        const condi = val * mightValues.condi;
        return `<div class="equip-boons__tip-title">Might ×${val}</div>` +
          `<div class="equip-boons__tip-effect">+${power} Power</div>` +
          `<div class="equip-boons__tip-effect">+${condi} Condition Damage</div>` +
          `<div class="equip-boons__tip-note">+${mightValues.power} Power and +${mightValues.condi} Condition Damage per stack (max ${MIGHT_MAX_STACKS})</div>`;
      }
      return `<div class="equip-boons__tip-title">Might</div>` +
        `<div class="equip-boons__tip-note">Click to add stacks. +${mightValues.power} Power and +${mightValues.condi} Condition Damage per stack (max ${MIGHT_MAX_STACKS}).</div>`;
    }
    if (def.key === "fury") {
      const gm = state.editor.gameMode || "pve";
      const furyPct = (gm === "wvw" ? FURY_CRIT_CHANCE_WVW : FURY_CRIT_CHANCE) + computeFuryCritModifier(state);
      const furyStats = computeFuryStatBonuses(state);
      const STAT_LABELS = { Ferocity: "Ferocity", Precision: "Precision", Expertise: "Expertise", Concentration: "Concentration", HealingPower: "Healing Power" };
      const statLines = Object.entries(furyStats)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `+${v} ${STAT_LABELS[k] || k}`);
      if (val) {
        let html = `<div class="equip-boons__tip-title">Fury</div><div class="equip-boons__tip-effect">+${furyPct}% Critical Chance</div>`;
        for (const line of statLines) html += `<div class="equip-boons__tip-effect">${line}</div>`;
        html += `<div class="equip-boons__tip-note">Added to derived stats</div>`;
        return html;
      }
      let hint = `Grants +${furyPct}% Critical Chance`;
      if (statLines.length) hint += `, ${statLines.join(", ")}`;
      return `<div class="equip-boons__tip-title">Fury</div><div class="equip-boons__tip-note">Click to enable. ${hint}.</div>`;
    }
    if (def.key === "alacrity") {
      return val
        ? '<div class="equip-boons__tip-title">Alacrity</div><div class="equip-boons__tip-effect">\u221225% Skill Cooldown</div><div class="equip-boons__tip-note">Cooldown reduction shown in skill tooltips</div>'
        : '<div class="equip-boons__tip-title">Alacrity</div><div class="equip-boons__tip-note">Click to enable. Reduces skill cooldowns by 25%.</div>';
    }
    if (def.key === "stability") {
      if (val > 0) {
        return `<div class="equip-boons__tip-title">Stability ×${val}</div>` +
          `<div class="equip-boons__tip-effect">Cannot be knocked down, pushed back, pulled, launched, stunned, dazed, floated, sunk, feared, or taunted</div>` +
          `<div class="equip-boons__tip-note">1 stack removed per incoming CC (max ${STABILITY_MAX_STACKS})</div>`;
      }
      return `<div class="equip-boons__tip-title">Stability</div>` +
        `<div class="equip-boons__tip-note">Click to add stacks. Prevents crowd control effects. 1 stack consumed per incoming CC (max ${STABILITY_MAX_STACKS}).</div>`;
    }
    // Simple toggle boons — generic tooltip
    const BOON_DESCRIPTIONS = {
      quickness: { effect: "+50% Animation Speed", note: "Actions and casts are faster" },
      protection: { effect: "\u221233% Incoming Strike Damage", note: "Reduces strike damage taken" },
      regeneration: { effect: "Heal Over Time", note: "Regenerates health every second" },
      resolution: { effect: "\u221233% Incoming Condition Damage", note: "Reduces condition damage taken" },
      resistance: { effect: "Negate Conditions", note: "Conditions have no effect while active" },
      swiftness: { effect: "+33% Movement Speed", note: "Increases movement speed" },
      vigor: { effect: "+50% Endurance Regeneration", note: "Dodge bar refills faster" },
      aegis: { effect: "Block Next Attack", note: "Blocks the next incoming strike" },
    };
    const info = BOON_DESCRIPTIONS[def.key];
    if (!info) return `<div class="equip-boons__tip-title">${def.label}</div>`;
    return val
      ? `<div class="equip-boons__tip-title">${def.label}</div><div class="equip-boons__tip-effect">${info.effect}</div><div class="equip-boons__tip-note">${info.note}</div>`
      : `<div class="equip-boons__tip-title">${def.label}</div><div class="equip-boons__tip-note">Click to enable. ${info.note}.</div>`;
  }

  for (const def of BOON_DEFS) {
    const item = document.createElement("div");
    item.className = "equip-boons__item";

    const iconWrap = document.createElement("div");
    const isActive = def.stackable ? _assumedBoons[def.key] > 0 : _assumedBoons[def.key];
    iconWrap.className = "equip-boons__icon" + (isActive ? " equip-boons__icon--on" : "");

    const img = document.createElement("img");
    img.src = def.icon;
    img.alt = def.label;
    img.width = 28;
    img.height = 28;
    iconWrap.append(img);

    // Stack badge (stackable boons)
    if (def.stackable) {
      const badge = document.createElement("div");
      badge.className = "equip-boons__badge";
      badge.textContent = _assumedBoons[def.key] || "";
      if (!_assumedBoons[def.key]) badge.style.display = "none";
      iconWrap.append(badge);
    }

    // Tooltip
    const tooltip = document.createElement("div");
    tooltip.className = "equip-boons__tooltip";
    tooltip.innerHTML = buildBoonTooltipHTML(def);
    item.append(tooltip);

    // Reposition tooltip if it overflows the viewport
    item.addEventListener("pointerenter", () => {
      tooltip.style.left = "";
      tooltip.style.transform = "";
      requestAnimationFrame(() => {
        const rect = tooltip.getBoundingClientRect();
        if (rect.left < 12) {
          tooltip.style.left = "0";
          tooltip.style.transform = `translateX(${12 - rect.left}px)`;
        } else if (rect.right > window.innerWidth - 12) {
          tooltip.style.left = "0";
          tooltip.style.transform = `translateX(${window.innerWidth - 12 - rect.right}px)`;
        }
      });
    });
    item.addEventListener("pointerleave", () => {
      tooltip.style.left = "";
      tooltip.style.transform = "";
    });

    // Click handler
    if (def.stackable) {
      const max = def.maxStacks || MIGHT_MAX_STACKS;
      iconWrap.addEventListener("click", (e) => {
        _assumedBoons[def.key] = Math.min(max, Math.max(0, _assumedBoons[def.key] + getDelta(e)));
        _render();
      });
      iconWrap.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        _assumedBoons[def.key] = Math.min(max, Math.max(0, _assumedBoons[def.key] - getDelta(e)));
        _render();
      });
    } else {
      iconWrap.addEventListener("click", () => {
        _assumedBoons[def.key] = !_assumedBoons[def.key];
        _render();
      });
      iconWrap.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        _assumedBoons[def.key] = !_assumedBoons[def.key];
        _render();
      });
    }

    // Long press to reset (mobile)
    let longPressTimer = null;
    iconWrap.addEventListener("touchstart", () => {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        _assumedBoons[def.key] = def.stackable ? 0 : false;
        _render();
        iconWrap.style.opacity = "0.4";
        setTimeout(() => { iconWrap.style.opacity = ""; }, 150);
      }, 500);
    }, { passive: true });
    iconWrap.addEventListener("touchend", () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });
    iconWrap.addEventListener("touchmove", () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }, { passive: true });

    item.append(iconWrap);

    const label = document.createElement("div");
    label.className = "equip-boons__label" + (isActive ? " equip-boons__label--on" : "");
    label.textContent = def.label;
    item.append(label);

    // Core boons go in main bar, others in expandable section
    if (def.core) {
      boonsBar.append(item);
    } else {
      boonsExpand.append(item);
    }
  }

  boonsSection.append(boonsBar);
  boonsSection.append(boonsExpand);

  // Detect equipped stacking sigils from ALL weapon sets (not just active —
  // stacking sigils persist across weapon swaps in GW2)
  const equippedSigils = state.editor.equipment?.sigils || {};
  const allSigilIds = Object.values(equippedSigils)
    .flatMap((arr) => (Array.isArray(arr) ? arr : []))
    .filter(Boolean);

  equippedStackingSigils = STACKING_SIGIL_DEFS.filter((def) =>
    allSigilIds.some((id) => Number(id) === def.id)
  );

  // Clean up sigil stacks for unequipped sigils
  for (const key of Object.keys(_sigilStacks)) {
    if (!equippedStackingSigils.some((d) => d.key === key)) {
      delete _sigilStacks[key];
    }
  }

  if (equippedStackingSigils.length > 0) {
    const sigilLabel = document.createElement("div");
    sigilLabel.className = "equip-boons__sigil-label";
    sigilLabel.textContent = "Sigil Stacks";
    boonsSection.append(sigilLabel);

    const sigilBar = document.createElement("div");
    sigilBar.className = "equip-boons__bar equip-boons__bar--sigils";

    for (const def of equippedStackingSigils) {
      const stacks = _sigilStacks[def.key] || 0;
      const sigilDef = state.upgradeCatalog?.sigilById?.get(def.id);
      const icon = sigilDef?.icon || "";

      const item = document.createElement("div");
      item.className = "equip-boons__item";

      const iconWrap = document.createElement("div");
      iconWrap.className = "equip-boons__icon equip-boons__icon--sigil" + (stacks > 0 ? " equip-boons__icon--on" : "");

      if (icon) {
        const img = document.createElement("img");
        img.src = icon;
        img.alt = def.label;
        img.width = 28;
        img.height = 28;
        iconWrap.append(img);
      }

      // Stack badge
      const badge = document.createElement("div");
      badge.className = "equip-boons__badge";
      badge.textContent = stacks || "";
      if (!stacks) badge.style.display = "none";
      iconWrap.append(badge);

      // Tooltip
      const tooltip = document.createElement("div");
      tooltip.className = "equip-boons__tooltip";
      const statLabel = def.allStats ? "All Stats" : def.modifier ? def.modifier : def.stat.replace(/([A-Z])/g, " $1").trim();
      const perStackLabel = def.modifier ? `+${def.perStack}% ${statLabel}` : `+${def.perStack} ${statLabel}`;
      if (stacks > 0) {
        const totalLabel = def.modifier ? `+${(stacks * def.perStack).toFixed(1)}% ${statLabel}` : `+${stacks * def.perStack} ${statLabel}`;
        tooltip.innerHTML =
          `<div class="equip-boons__tip-title">${def.label} ×${stacks}</div>` +
          `<div class="equip-boons__tip-effect">${totalLabel}</div>` +
          `<div class="equip-boons__tip-note">${perStackLabel} per stack (max ${def.maxStacks})</div>`;
      } else {
        tooltip.innerHTML =
          `<div class="equip-boons__tip-title">Sigil of ${def.label}</div>` +
          `<div class="equip-boons__tip-note">Click to add stacks. ${perStackLabel} per stack (max ${def.maxStacks}).</div>`;
      }
      item.append(tooltip);

      // Click handlers (same as Might)
      iconWrap.addEventListener("click", (e) => {
        _sigilStacks[def.key] = Math.min(def.maxStacks, Math.max(0, (_sigilStacks[def.key] || 0) + getDelta(e)));
        _render();
      });
      iconWrap.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        _sigilStacks[def.key] = Math.min(def.maxStacks, Math.max(0, (_sigilStacks[def.key] || 0) - getDelta(e)));
        _render();
      });

      item.append(iconWrap);

      const label = document.createElement("div");
      label.className = "equip-boons__label" + (stacks > 0 ? " equip-boons__label--on" : "");
      label.textContent = def.label;
      item.append(label);

      sigilBar.append(item);
    }

    boonsSection.append(sigilBar);
  }

  // Attributes
  const statsSection = makeSection("Attributes");
  const statsResult = computeStats(state, _assumedBoons, _sigilStacks);
  const computed = statsResult.total;
  const traitBonuses = statsResult.conversions;
  const professionName = state.editor.profession;
  const baseHP = PROFESSION_BASE_HP[professionName] || 9212;
  const health = baseHP + (computed.Vitality || 0) * 10;
  // Collect upgrade modifiers and apply ones that map to derived stats
  const modifiers = computeUpgradeModifiers();
  const popMod = (key) => { const v = modifiers.get(key) || 0; modifiers.delete(key); return v; };
  const gm = state.editor.gameMode || "pve";
  const furyCritPct = (gm === "wvw" ? FURY_CRIT_CHANCE_WVW : FURY_CRIT_CHANCE) + computeFuryCritModifier(state);
  const furyCrit = _assumedBoons.fury ? furyCritPct : 0;
  const critChance = Math.min(100, ((computed.Precision || 1000) - 895) / 21.0 + popMod("Critical Chance") + furyCrit);
  const critDamage = 150 + (computed.Ferocity || 0) / 15.0 + popMod("Critical Damage");
  const condDuration = (computed.Expertise || 0) / 15.0 + popMod("Condition Duration");
  const boonDuration = (computed.Concentration || 0) / 15.0 + popMod("Boon Duration");
  const weightClass = PROFESSION_WEIGHT[professionName] || "heavy";
  const armor = (computed.Toughness || 1000) + (ARMOR_DEFENSE_BY_WEIGHT[weightClass] || 0);

  const statRows = [
    { stat: "Power",           key: "Power",          value: computed.Power },
    { stat: "Precision",       key: "Precision",      value: computed.Precision,       derived: "Crit Chance",      derivedVal: `${critChance.toFixed(1)}%` },
    { stat: "Toughness",       key: "Toughness",      value: computed.Toughness,       derived: "Armor",            derivedVal: armor.toLocaleString() },
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
    const sigilBoosted = equippedStackingSigils.some((d) => {
      if ((_sigilStacks[d.key] || 0) <= 0) return false;
      return d.allStats ? d.allStats.includes(row.key) : d.stat === row.key;
    });
    const isBoosted = (_assumedBoons.might > 0 && (row.key === "Power" || row.key === "ConditionDamage"))
      || (traitBonuses[row.key] > 0)
      || sigilBoosted;
    leftEl.innerHTML = `<span class="equip-stat-label">${row.stat}</span><span class="equip-stat-value${isBoosted ? " equip-stat-value--boosted" : ""}">${(row.value || 0).toLocaleString()}</span>`;

    bindHoverPreview(leftEl, "equip-stat", () => {
      const breakdown = computeStatBreakdown(row.key, _assumedBoons, _sigilStacks);
      if (!breakdown.length) return null;
      // Consolidate duplicate sources (e.g. 18x identical infusions → one line)
      const grouped = new Map();
      for (const e of breakdown) {
        const existing = grouped.get(e.source);
        if (existing) { existing.value += e.value; existing.count++; }
        else grouped.set(e.source, { ...e, count: 1 });
      }
      // Attach SVG icons for equipment slot entries
      const weight = PROFESSION_WEIGHT[state.editor.profession] || "heavy";
      const weapons = state.editor.equipment?.weapons || {};
      for (const entry of grouped.values()) {
        if (entry.slotKey && !entry.svgIcon) {
          // Weapon slots: use the weapon type SVG
          const weaponId = weapons[entry.slotKey];
          if (weaponId) {
            entry.svgIcon = getWeaponSvg(weaponId);
          }
          // Armor/trinket slots: use the slot SVG
          if (!entry.svgIcon) {
            entry.svgIcon = getSlotSvg(entry.slotKey, weight);
          }
        }
      }
      const total = breakdown.reduce((s, e) => s + e.value, 0);
      return {
        name: row.stat,
        breakdown: [...grouped.values()],
        breakdownTotal: total,
      };
    });

    rowEl.append(leftEl);

    if (row.derived) {
      const rightEl = document.createElement("div");
      rightEl.className = "equip-stat-cell equip-stat-cell--derived";
      const isDerivedBoosted = (_assumedBoons.fury && row.derived === "Crit Chance");
      rightEl.innerHTML = `<span class="equip-stat-label">${row.derived}</span><span class="equip-stat-value equip-stat-value--derived${isDerivedBoosted ? " equip-stat-value--boosted" : ""}">${row.derivedVal}</span>`;
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
  rightCol.append(boonsSection);

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
    if (currentRelic) wrapper.title = currentRelic;

    if (_readOnly) {
      wrapper.removeAttribute("role");
      wrapper.style.cursor = "default";
      wrapper.tabIndex = -1;
    }

    const doOpen = () => openSlotPicker(wrapper, currentRelic, (newVal) => {
      equip.relic = newVal || "";
      _markEditorChanged();
      renderEquipmentPanel();
    }, {
      items: relicItems, searchPlaceholder: "Search relics…",
      hoverProvider: (opt) => {
        const rDef = GW2_RELICS_BY_LABEL.get(opt.value);
        return ["equip-relic", () => {
          if (!rDef) return null;
          const catalogRelic = state.upgradeCatalog?.relicByName?.get(rDef.label);
          return { name: rDef.label, icon: rDef.icon, description: catalogRelic?.description || "", facts: catalogRelic?.facts || [] };
        }];
      },
    });
    if (!_readOnly) {
      wrapper.addEventListener("click", doOpen);
      wrapper.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doOpen(); } });
    }

    bindHoverPreview(wrapper, "equip-relic", () => {
      const rDef = GW2_RELICS_BY_LABEL.get(equip.relic || "");
      if (!rDef) return null;
      const catalogRelic = state.upgradeCatalog?.relicByName?.get(rDef.label);
      return { name: rDef.label, icon: rDef.icon, description: catalogRelic?.description || "", facts: catalogRelic?.facts || [] };
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
  rightCol.append(consumeSection);

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
