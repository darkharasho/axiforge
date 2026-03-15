import { escapeHtml } from "./main.js";

/**
 * Renders read-only specialization cards matching the desktop DOM structure.
 *
 * @param {HTMLElement} container - The element to render into.
 * @param {Array} specs - Enriched specialization objects from serializeForPublish.
 *   Each spec has: id, name, elite, icon, background, minorTraits[], majorTraitsByTier, majorChoices.
 */
export function renderSpecializations(container, specs) {
  container.innerHTML = "";

  if (!Array.isArray(specs) || specs.length === 0) {
    container.innerHTML = `<p class="empty-line">No specializations selected.</p>`;
    return;
  }

  const host = document.createElement("div");
  host.className = "specializations-host";

  for (const spec of specs) {
    const card = document.createElement("article");
    card.className = "spec-card";

    // Panel with background image
    const panel = document.createElement("div");
    panel.className = spec.elite
      ? "spec-card__panel spec-card__panel--elite"
      : "spec-card__panel";

    const bgUrl = spec.background || "";
    panel.style.backgroundImage = `linear-gradient(0deg, rgba(7, 14, 27, 0.1), rgba(7, 14, 27, 0.1)), url("${bgUrl.replaceAll('"', '\\"')}")`;
    panel.style.backgroundPosition = "center, center";
    panel.style.backgroundSize = "100% 100%, cover";
    panel.style.backgroundRepeat = "no-repeat, no-repeat";

    // Body grid
    const body = document.createElement("div");
    body.className = "spec-card__body";

    // Spec emblem (button, read-only/disabled)
    const emblem = document.createElement("button");
    emblem.type = "button";
    emblem.className = spec.elite ? "spec-emblem spec-emblem--elite" : "spec-emblem";
    emblem.disabled = true;
    emblem.title = escapeHtml(spec.name || "Specialization");
    if (spec.icon) {
      const emblemImg = document.createElement("img");
      emblemImg.src = String(spec.icon);
      emblemImg.alt = escapeHtml(spec.name || "Specialization");
      emblem.append(emblemImg);
    } else {
      emblem.textContent = "?";
    }
    body.append(emblem);

    // Three tiers: minor anchor + major column
    const majorTraitsByTier = spec.majorTraitsByTier || {};
    const majorChoices = spec.majorChoices || {};
    const minorTraits = Array.isArray(spec.minorTraits) ? spec.minorTraits : [];

    for (let tier = 1; tier <= 3; tier++) {
      // Minor trait anchor
      const minorAnchor = document.createElement("div");
      minorAnchor.className = "trait-minor-anchor";

      const minorTrait = minorTraits[tier - 1] || null;
      const minorBtn = document.createElement("button");
      minorBtn.type = "button";
      minorBtn.className = "trait-btn trait-btn--always";
      minorBtn.disabled = true;
      if (minorTrait) {
        minorBtn.dataset.name = escapeHtml(minorTrait.name || "");
        minorBtn.dataset.desc = escapeHtml(minorTrait.description || "");
        if (minorTrait.icon) {
          const img = document.createElement("img");
          img.src = String(minorTrait.icon);
          img.alt = escapeHtml(minorTrait.name || "Minor trait");
          minorBtn.append(img);
        }
      }
      minorAnchor.append(minorBtn);
      body.append(minorAnchor);

      // Major trait column
      const column = document.createElement("div");
      column.className = "trait-column trait-column--major";

      const tierTraits = majorTraitsByTier[tier] || [];
      const selectedId = Number(majorChoices[tier]) || 0;

      for (const trait of tierTraits) {
        const isActive = Number(trait.id) === selectedId;
        const traitBtn = document.createElement("button");
        traitBtn.type = "button";
        traitBtn.className = isActive ? "trait-btn trait-btn--active" : "trait-btn";
        traitBtn.disabled = true;
        if (!isActive) {
          // Unselected major traits get lower opacity via CSS (.trait-btn:disabled),
          // but we also want non-selected ones visually subdued beyond what --active provides.
          traitBtn.style.opacity = "0.45";
        }
        if (trait) {
          traitBtn.dataset.name = escapeHtml(trait.name || "");
          traitBtn.dataset.desc = escapeHtml(trait.description || "");
          if (trait.icon) {
            const img = document.createElement("img");
            img.src = String(trait.icon);
            img.alt = escapeHtml(trait.name || "Major trait");
            traitBtn.append(img);
          }
        }
        column.append(traitBtn);
      }

      body.append(column);
    }

    panel.append(body);
    card.append(panel);
    host.append(card);
  }

  container.append(host);
}
