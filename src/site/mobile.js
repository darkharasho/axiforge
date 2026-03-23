/* AxiForge — SPA mobile enhancements */

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
 * Only runs on mobile. The element is hidden on desktop via CSS.
 */
export function initSkillBarMobile() {
  const skillsBar = document.querySelector(".skills-bar");
  if (!skillsBar) return;

  // Find existing swap button to clone its click behavior
  const existingSwap = skillsBar.querySelector(".weapon-swap-btn");

  // Read HP value from the health orb
  const hpEl = skillsBar.querySelector(".health-orb__hp");
  const hpValue = hpEl ? hpEl.textContent : "";

  // Create the mobile meta row
  const metaRow = document.createElement("div");
  metaRow.className = "skills-bar__mobile-meta";

  // Swap pill
  const swapPill = document.createElement("button");
  swapPill.className = "mobile-swap-pill";
  swapPill.innerHTML = `<span class="mobile-swap-pill__icon">⇄</span> Swap`;
  if (existingSwap) {
    swapPill.disabled = existingSwap.disabled;
    swapPill.addEventListener("click", () => existingSwap.click());
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

  // Insert after the weapon column (first child of skills-bar),
  // before the orb column
  const orbCol = skillsBar.querySelector(".skills-bar__orb-col");
  if (orbCol) {
    skillsBar.insertBefore(metaRow, orbCol);
  } else {
    // Fallback: just append
    skillsBar.appendChild(metaRow);
  }
}
