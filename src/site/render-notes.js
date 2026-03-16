// SPA read-only notes renderer
// Parses markdown, resolves @[category:id:Name] mentions into hoverable chips.

import { marked } from "marked";
import { bindHoverPreview } from "@renderer/modules/detail-panel.js";

export function renderNotes(build) {
  const container = document.createElement("div");
  container.className = "notes-preview";

  if (!build.notes) {
    container.innerHTML = '<p style="color:var(--muted);font-style:italic">No notes.</p>';
    return container;
  }

  // Configure marked to escape HTML (XSS prevention for published content)
  const renderer = new marked.Renderer();
  const origHtml = renderer.html.bind(renderer);
  renderer.html = (body) => {
    const d = document.createElement("div");
    d.textContent = typeof body === "string" ? body : body?.text || "";
    return `<p>${d.innerHTML}</p>`;
  };

  let html = marked.parse(build.notes, { breaks: true, renderer });

  // Build lookup maps from enriched catalog data
  const skillById = new Map((build.catalogSkills || []).map((s) => [s.id, s]));
  const traitById = new Map((build.catalogTraits || []).map((t) => [t.id, t]));
  const runeById = new Map(Object.values(build.equipmentDisplay?.runes || {}).filter(Boolean).map((r) => [r.id, r]));
  const sigilById = new Map(Object.values(build.equipmentDisplay?.sigils || {}).flat().filter(Boolean).map((s) => [s.id, s]));
  const foodById = build.equipmentDisplay?.food ? new Map([[build.equipmentDisplay.food.id, build.equipmentDisplay.food]]) : new Map();
  const utilityById = build.equipmentDisplay?.utility ? new Map([[build.equipmentDisplay.utility.id, build.equipmentDisplay.utility]]) : new Map();

  // Resolve @[category:id:Name] patterns
  html = html.replace(/@\[(\w+):(\d+):([^\]]+)\]/g, (match, category, id, name) => {
    const numId = Number(id);
    let resolved = null;
    switch (category) {
      case "skill": resolved = skillById.get(numId); break;
      case "trait": resolved = traitById.get(numId); break;
      case "rune": resolved = runeById.get(numId); break;
      case "sigil": resolved = sigilById.get(numId); break;
      case "food": resolved = foodById.get(numId); break;
      case "utility": resolved = utilityById.get(numId); break;
      default: break;
    }

    const icon = resolved?.icon || "";
    const iconHtml = icon ? `<img class="notes-mention__icon" src="${icon}" alt="">` : "";
    const escapedName = escapeHtml(name);

    if (resolved) {
      return `<span class="notes-mention" data-type="${category}" data-id="${numId}">${iconHtml}${escapedName} <span class="notes-mention__label">${category}</span></span>`;
    }
    return `@${escapedName}`;
  });

  container.innerHTML = html;

  // Bind hover tooltips
  container.querySelectorAll(".notes-mention").forEach((chip) => {
    const type = chip.dataset.type;
    const id = Number(chip.dataset.id);
    const kind = type === "trait" ? "trait" : type === "skill" ? "skill" : `equip-${type}`;

    bindHoverPreview(chip, kind, () => {
      switch (type) {
        case "skill": return skillById.get(id) || null;
        case "trait": return traitById.get(id) || null;
        case "rune": return runeById.get(id) || null;
        case "sigil": return sigilById.get(id) || null;
        case "food": return foodById.get(id) || null;
        case "utility": return utilityById.get(id) || null;
        default: return null;
      }
    });
  });

  return container;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
