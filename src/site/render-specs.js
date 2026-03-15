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

    // Prefer wiki FilePath URL for browser compatibility over GW2 render CDN
    let bgUrl = spec.background || "";
    if (spec.name) {
      bgUrl = `https://wiki.guildwars2.com/wiki/Special:FilePath/${encodeURIComponent(spec.name + " specialization.png")}`;
    }
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
      minorBtn.dataset.connectorRole = `minor-${tier}`;
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
        if (isActive) {
          traitBtn.dataset.connectorRole = `major-${tier}`;
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

  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const body of host.querySelectorAll(".spec-card__body")) {
      drawConnector(body);
    }
  }));
}

function drawConnector(body) {
  const bodyRect = body.getBoundingClientRect();
  if (bodyRect.width === 0 || bodyRect.height === 0) return;

  const roles = ["minor-1", "major-1", "minor-2", "major-2", "minor-3", "major-3"];
  const points = [];
  for (const role of roles) {
    const node = body.querySelector(`[data-connector-role="${role}"]`);
    if (!node) continue;
    const r = node.getBoundingClientRect();
    points.push({
      x: r.left + r.width / 2 - bodyRect.left,
      y: r.top + r.height / 2 - bodyRect.top,
    });
  }
  if (points.length < 2) return;

  const pathData = `M ${points[0].x} ${points[0].y} ` +
    points.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "spec-connector");
  svg.setAttribute("viewBox", `0 0 ${Math.max(1, bodyRect.width)} ${Math.max(1, bodyRect.height)}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("overflow", "hidden");

  const corePath = document.createElementNS(svgNS, "path");
  corePath.setAttribute("d", pathData);
  corePath.setAttribute("fill", "none");
  corePath.setAttribute("stroke", "rgba(180, 235, 255, 0.5)");
  corePath.setAttribute("stroke-width", "1.5");
  corePath.setAttribute("stroke-linecap", "round");
  svg.append(corePath);

  const flowPath = document.createElementNS(svgNS, "path");
  flowPath.setAttribute("class", "connector-flow");
  flowPath.setAttribute("d", pathData);
  flowPath.setAttribute("fill", "none");
  flowPath.setAttribute("stroke", "rgba(220, 250, 255, 1)");
  flowPath.setAttribute("stroke-width", "2.5");
  flowPath.setAttribute("stroke-linecap", "round");
  flowPath.setAttribute("stroke-dasharray", "10 22");
  svg.append(flowPath);

  const flowPath2 = document.createElementNS(svgNS, "path");
  flowPath2.setAttribute("class", "connector-flow2");
  flowPath2.setAttribute("d", pathData);
  flowPath2.setAttribute("fill", "none");
  flowPath2.setAttribute("stroke", "rgba(160, 230, 255, 0.7)");
  flowPath2.setAttribute("stroke-width", "2.5");
  flowPath2.setAttribute("stroke-linecap", "round");
  flowPath2.setAttribute("stroke-dasharray", "10 22");
  svg.append(flowPath2);

  body.prepend(svg);
}
