// Comp card — party lines + mini build cards for a squad composition.
// comp: AxiForge comp record ({ title, partyLines, buildColors, tags }).
// buildsById: plain object of build records keyed by id.
// catalog: upgradeCatalog with runeById/relicByName Maps, or null.
import { escapeHtml } from "./escape.js";
import { profClass, getDisplayName, getSpecIcon, getSpecIconColored } from "./build-helpers.js";
import { renderMiniBuildCard, renderMissingMiniBuildCard } from "./mini-build-card.js";

function renderSlot(build, color) {
  if (!build) return `<div class="comp-slot comp-slot--empty"></div>`;
  const icon = color && color !== "normal" ? getSpecIconColored(build, color) : getSpecIcon(build);
  const colorAttr = color && color !== "normal" ? ` data-slot-color="${color}"` : "";
  return `
    <div class="comp-slot comp-slot--filled ${profClass(build.profession)}"${colorAttr}
         title="${escapeHtml(getDisplayName(build))}">
      <span class="comp-slot__icon">${icon || escapeHtml((build.profession || "?")[0])}</span>
    </div>`;
}

function renderPartyLines(comp, buildsById) {
  const colors = comp.buildColors || {};
  return (comp.partyLines || []).map((line, idx) => {
    const slots = line.slots || [];
    const capacity = line.capacity || 5;
    const boxes = slots.map((id) => renderSlot(buildsById[id], colors[id] || "normal"));
    for (let i = slots.length; i < capacity; i++) {
      boxes.push(`<div class="comp-slot comp-slot--empty"></div>`);
    }
    return `
      <div class="comp-line">
        <span class="comp-line__label">P${idx + 1}</span>
        <div class="comp-line__slots">${boxes.join("")}</div>
        <span class="comp-line__count">${slots.length} / ${capacity}</span>
      </div>`;
  }).join("");
}

export function renderCompCard(comp, buildsById = {}, catalog = null) {
  const colors = comp.buildColors || {};
  const referenced = [...new Set((comp.partyLines || []).flatMap((l) => l.slots || []))];
  const pool = referenced
    .map((id) =>
      buildsById[id]
        ? renderMiniBuildCard(buildsById[id], catalog, {
            showActions: false,
            slotColor: colors[id] || null,
          })
        : renderMissingMiniBuildCard(id)
    )
    .join("");
  const tags = (comp.tags || [])
    .map((t) => `<span class="comp-card__tag">${escapeHtml(t)}</span>`)
    .join("");
  return `
    <div class="comp-card">
      <div class="comp-card__head">
        <span class="comp-card__name">${escapeHtml(comp.title || "Untitled comp")}</span>
        ${tags}
      </div>
      <div class="comp-card__lines">${renderPartyLines(comp, buildsById)}</div>
      <div class="comp-card__pool">${pool}</div>
    </div>`;
}
