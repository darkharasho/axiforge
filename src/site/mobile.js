/* AxiForge — SPA mobile enhancements */

import { state } from "@renderer/modules/state.js";
import { buildSkillCard } from "@renderer/modules/detail-panel.js";

const MOBILE_BREAKPOINT = 768;

/** True when viewport is at or below mobile breakpoint */
export function isMobile() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

/**
 * Add `mobile` class to #app based on viewport width.
 * Updates on resize.
 */
export function initMobileDetection() {
  const app = document.getElementById("app");
  if (!app) return;

  function update() {
    app.classList.toggle("mobile", isMobile());
  }

  update();
  window.addEventListener("resize", update);
}

/**
 * Inject the swap pill + HP badge row between weapon and utility skill rows.
 * Re-injects after skill re-renders (e.g. weapon swap) via MutationObserver.
 */
export function initSkillBarMobile() {
  // The .skills-bar element is destroyed and recreated on every renderSkills().
  // We observe the persistent parent (.skills-host) to detect re-renders.
  const skillsHost = document.querySelector(".skills-host");
  if (!skillsHost) return;

  function injectMetaRow() {
    const bar = skillsHost.querySelector(".skills-bar");
    if (!bar) return;

    // Already injected in this render cycle
    if (bar.querySelector(".skills-bar__mobile-meta")) return;

    // Find current swap button (fresh reference)
    const swapBtn = bar.querySelector(".weapon-swap-btn");

    // Read HP value from the health orb
    const hpEl = bar.querySelector(".health-orb__hp");
    const hpValue = hpEl ? hpEl.textContent : "";

    const metaRow = document.createElement("div");
    metaRow.className = "skills-bar__mobile-meta";

    // Swap pill — mirror active state from the real swap button
    const isActive = swapBtn?.classList.contains("weapon-swap-btn--active");
    const swapPill = document.createElement("button");
    swapPill.className = "mobile-swap-pill" + (isActive ? " mobile-swap-pill--active" : "");
    swapPill.innerHTML = `<span class="mobile-swap-pill__icon">⇄</span> Swap`;
    if (swapBtn) {
      swapPill.disabled = swapBtn.disabled;
      swapPill.addEventListener("click", () => {
        // Get fresh reference — renderSkills() replaces the entire bar
        const currentSwap = skillsHost.querySelector(".weapon-swap-btn");
        if (currentSwap) currentSwap.click();
      });
    }

    // HP badge
    const hpBadge = document.createElement("div");
    hpBadge.className = "mobile-hp-badge";
    hpBadge.innerHTML = `
      <span class="mobile-hp-badge__dot"></span>
      <span class="mobile-hp-badge__value">${hpValue}</span>
      <span class="mobile-hp-badge__label">HP</span>
    `;

    metaRow.append(swapPill, hpBadge);

    const orbCol = bar.querySelector(".skills-bar__orb-col");
    if (orbCol) {
      bar.insertBefore(metaRow, orbCol);
    } else {
      bar.appendChild(metaRow);
    }
  }

  // Initial injection
  injectMetaRow();

  // Re-inject when skills re-render (observer on the persistent host, not the bar)
  const observer = new MutationObserver(() => {
    injectMetaRow();
  });
  observer.observe(skillsHost, { childList: true, subtree: true });
}

/**
 * Inject sub-tab bar above equipment layout on mobile.
 * Toggles between "Armor & Runes" (left column) and "Weapons & Trinkets" (right column).
 */
export function initEquipmentSubTabs() {
  const equipLayout = document.querySelector(".equip-layout");
  if (!equipLayout) return;

  const leftCol = equipLayout.querySelector(".equip-col--left");
  const rightCol = equipLayout.querySelector(".equip-col--right");
  if (!leftCol || !rightCol) return;

  // Create sub-tab bar
  const tabBar = document.createElement("div");
  tabBar.className = "equip-mobile-tabs";

  const armorTab = document.createElement("button");
  armorTab.className = "equip-mobile-tab equip-mobile-tab--active";
  armorTab.textContent = "Armor & Runes";

  const weaponsTab = document.createElement("button");
  weaponsTab.className = "equip-mobile-tab";
  weaponsTab.textContent = "Weapons & Trinkets";

  tabBar.append(armorTab, weaponsTab);

  // Insert before the equipment layout
  equipLayout.parentElement.insertBefore(tabBar, equipLayout);

  // Initial state: show left, hide right
  function showArmor() {
    leftCol.style.display = "";
    rightCol.style.display = "none";
    armorTab.classList.add("equip-mobile-tab--active");
    weaponsTab.classList.remove("equip-mobile-tab--active");
  }

  function showWeapons() {
    leftCol.style.display = "none";
    rightCol.style.display = "";
    armorTab.classList.remove("equip-mobile-tab--active");
    weaponsTab.classList.add("equip-mobile-tab--active");
  }

  armorTab.addEventListener("click", showArmor);
  weaponsTab.addEventListener("click", showWeapons);

  // Only apply hide/show on mobile
  if (isMobile()) {
    showArmor();
  }

  // Handle resize — reset visibility when switching between mobile and desktop
  window.addEventListener("resize", () => {
    if (!isMobile()) {
      leftCol.style.display = "";
      rightCol.style.display = "";
    } else if (!weaponsTab.classList.contains("equip-mobile-tab--active")) {
      showArmor();
    }
  });
}

let _bottomSheet = null;
let _backdrop = null;
let _sheetContent = null;
let _touchStartY = 0;
let _sheetStartTranslate = 0;

/**
 * Create and inject the bottom sheet DOM elements.
 */
function createBottomSheet() {
  // Backdrop
  _backdrop = document.createElement("div");
  _backdrop.className = "bottom-sheet-backdrop";
  _backdrop.addEventListener("click", closeBottomSheet);

  // Sheet
  _bottomSheet = document.createElement("div");
  _bottomSheet.className = "bottom-sheet";

  // Handle
  const handle = document.createElement("div");
  handle.className = "bottom-sheet__handle";
  handle.innerHTML = '<div class="bottom-sheet__handle-bar"></div>';

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.className = "bottom-sheet__close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", closeBottomSheet);

  // Content
  _sheetContent = document.createElement("div");
  _sheetContent.className = "bottom-sheet__content";

  _bottomSheet.append(handle, closeBtn, _sheetContent);
  document.body.append(_backdrop, _bottomSheet);

  // Swipe to dismiss
  handle.addEventListener("touchstart", onTouchStart, { passive: true });
  _bottomSheet.addEventListener("touchmove", onTouchMove, { passive: false });
  _bottomSheet.addEventListener("touchend", onTouchEnd, { passive: true });
}

let _isDragging = false;

function onTouchStart(e) {
  _isDragging = true;
  _touchStartY = e.touches[0].clientY;
  _sheetStartTranslate = 0;
  _bottomSheet.style.transition = "none";
}

function onTouchMove(e) {
  if (!_isDragging) return;
  const deltaY = e.touches[0].clientY - _touchStartY;
  if (deltaY > 0) {
    _sheetStartTranslate = deltaY;
    _bottomSheet.style.transform = `translateY(${deltaY}px)`;
    e.preventDefault();
  }
}

function onTouchEnd() {
  if (!_isDragging) return;
  _isDragging = false;
  _bottomSheet.style.transition = "";
  if (_sheetStartTranslate > 100) {
    closeBottomSheet();
  } else {
    _bottomSheet.style.transform = "";
  }
}

export function openBottomSheet(kind, entity) {
  if (!_bottomSheet) createBottomSheet();
  _sheetContent.innerHTML = buildSkillCard(entity, kind || "skill");
  _backdrop.classList.add("bottom-sheet-backdrop--active");
  _bottomSheet.classList.add("bottom-sheet--active");
  _bottomSheet.style.transform = "";
  document.body.style.overflow = "hidden";
}

export function closeBottomSheet() {
  if (!_bottomSheet) return;
  _backdrop.classList.remove("bottom-sheet-backdrop--active");
  _bottomSheet.classList.remove("bottom-sheet--active");
  _bottomSheet.style.transform = "";
  document.body.style.overflow = "";
}

/**
 * Convert spec cards to collapsible accordions on mobile.
 * Injects a collapsed header into each .spec-card with the spec emblem,
 * name, selected trait thumbnails, and a chevron.
 * Tap to expand/collapse. Only one expanded at a time.
 */
export function initSpecAccordion() {
  const specCards = document.querySelectorAll(".spec-card");
  if (!specCards.length) return;

  specCards.forEach((card, index) => {
    const panel = card.querySelector(".spec-card__panel");
    if (!panel) return;

    // Get spec data from state
    const specData = state.editor.specializations?.[index];
    const specId = specData?.id;
    const spec = specId ? state.activeCatalog.specializationById?.get(specId) : null;

    // Build header
    const header = document.createElement("div");
    header.className = "spec-card__mobile-header";

    // Emblem — clone the existing one
    const existingEmblem = card.querySelector(".spec-emblem img");
    const emblemWrap = document.createElement("div");
    emblemWrap.className = "spec-card__mobile-emblem";
    if (existingEmblem) {
      emblemWrap.appendChild(existingEmblem.cloneNode(true));
    }

    // Spec name
    const nameEl = document.createElement("div");
    nameEl.className = "spec-card__mobile-name";
    nameEl.textContent = spec?.name || `Specialization ${index + 1}`;

    // Selected major trait thumbnails
    const traitsWrap = document.createElement("div");
    traitsWrap.className = "spec-card__mobile-traits";
    const activeTraits = card.querySelectorAll(".trait-column--major .trait-btn--active img");
    activeTraits.forEach(img => {
      const thumb = img.cloneNode(true);
      traitsWrap.appendChild(thumb);
    });

    // Chevron
    const chevron = document.createElement("span");
    chevron.className = "spec-card__mobile-chevron";
    chevron.textContent = "▾";

    header.append(emblemWrap, nameEl, traitsWrap, chevron);

    // Mark elite specs
    if (panel.classList.contains("spec-card__panel--elite")) {
      card.classList.add("spec-card--elite");
    }

    // Insert header before the panel
    card.insertBefore(header, panel);

    // Click handler
    header.addEventListener("click", () => {
      const wasExpanded = card.classList.contains("expanded");

      // Collapse all
      specCards.forEach(c => c.classList.remove("expanded"));

      // Toggle clicked
      if (!wasExpanded) {
        card.classList.add("expanded");
      }
    });
  });
}
