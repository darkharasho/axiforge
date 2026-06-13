// Comp card — party lines + mini build cards for a squad composition.
// comp: AxiForge comp record ({ title, partyLines, buildColors, tags }).
// buildsById: plain object of build records keyed by id.
// catalog: upgradeCatalog with runeById/relicByName Maps, or null.
import { escapeHtml } from "./escape.js";
import { profClass, getDisplayName, getSpecIcon, getSpecIconColored } from "./build-helpers.js";
import { renderMiniBuildCard, renderMissingMiniBuildCard } from "./mini-build-card.js";

// A slot id may be a build id (UUID) or a category reference encoded as "tag:<id>".
const TAG_PREFIX = "tag:";
const isTagSlot = (id) => typeof id === "string" && id.startsWith(TAG_PREFIX);

// Lucide-style numbered square badge for party-line labels (matches the app + SPA).
function partyNumberIcon(n) {
  const label = String(n);
  const fontSize = label.length > 1 ? 9 : 12;
  return `<svg class="comp-line__num" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><text x="12" y="12" text-anchor="middle" dominant-baseline="central" stroke="none" fill="currentColor" font-size="${fontSize}" font-weight="700" font-family="inherit">${label}</text></svg>`;
}

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

// A tag slot is a single placeholder showing the category icon. The native tooltip
// lists the member builds so hovering reveals the options, like in the app.
function renderTagSlot(category, buildsById) {
  if (!category) return `<div class="comp-slot comp-slot--empty"></div>`;
  const name = category.name || "Tag";
  const members = (category.buildIds || [])
    .map((id) => buildsById[id])
    .filter(Boolean)
    .map((b) => getDisplayName(b));
  const title = members.length ? `${name}: ${members.join(", ")}` : name;
  const inner = category.icon
    ? `<img class="comp-slot__tag-img" src="${escapeHtml(category.icon)}" alt="${escapeHtml(name)}" />`
    : `<span class="comp-slot__tag-text">${escapeHtml(name.slice(0, 3))}</span>`;
  return `
    <div class="comp-slot comp-slot--filled comp-slot--tag" title="${escapeHtml(title)}">
      <span class="comp-slot__icon">${inner}</span>
    </div>`;
}

function renderPartyLines(comp, buildsById) {
  const colors = comp.buildColors || {};
  const categoryById = new Map((comp.categories || []).map((c) => [c.id, c]));
  return (comp.partyLines || []).map((line, idx) => {
    const slots = line.slots || [];
    const capacity = line.capacity || 5;
    const boxes = slots.map((id) =>
      isTagSlot(id)
        ? renderTagSlot(categoryById.get(id.slice(TAG_PREFIX.length)), buildsById)
        : renderSlot(buildsById[id], colors[id] || "normal")
    );
    for (let i = slots.length; i < capacity; i++) {
      boxes.push(`<div class="comp-slot comp-slot--empty"></div>`);
    }
    return `
      <div class="comp-line">
        <span class="comp-line__label">${partyNumberIcon(idx + 1)}</span>
        <div class="comp-line__slots">${boxes.join("")}</div>
        <span class="comp-line__count">${slots.length} / ${capacity}</span>
      </div>`;
  }).join("");
}

export function renderCompCard(comp, buildsById = {}, catalog = null) {
  const colors = comp.buildColors || {};
  const referenced = [...new Set((comp.partyLines || []).flatMap((l) => l.slots || []))]
    .filter((id) => !isTagSlot(id));
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
