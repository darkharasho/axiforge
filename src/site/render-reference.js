/**
 * Reference Panel sidebar for the BUILD tab.
 * Displays skill/trait details using the same buildSkillCard renderer as the app.
 */

import { buildSkillCard } from "@renderer/modules/detail-panel.js";

const PLACEHOLDER_HTML = `<p style="color:var(--muted); font-size:0.82rem;">Hover over a skill or trait to see details.</p>`;

let _card = null;

/**
 * Creates the reference panel DOM inside the given container.
 *
 * @param {HTMLElement} container - The .detail-panel element to render into.
 */
export function initReferencePanel(container) {
  const host = document.createElement("div");
  host.className = "detail-host";

  _card = document.createElement("div");
  _card.className = "detail-card";
  _card.innerHTML = PLACEHOLDER_HTML;

  host.append(_card);
  container.append(host);
}

/**
 * Updates the reference panel with the hovered entity.
 * Uses buildSkillCard from the shared detail-panel renderer for consistent formatting.
 *
 * @param {string} kind - Entity kind ("skill", "trait", "spec", etc.)
 * @param {object} entity - The full entity object with name, icon, description, facts, etc.
 */
export function updateReferencePanel(kind, entity) {
  if (!_card || !entity) return;
  _card.innerHTML = buildSkillCard(entity, kind || "skill");
}
