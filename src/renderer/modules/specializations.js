import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { renderCustomSelect } from "./custom-select.js";
import { bindHoverPreview, selectDetail } from "./detail-panel.js";

let _readOnly = false;
export function setReadOnly(val) { _readOnly = val; }

// DOM refs injected by the entry point — keeps module importable in Node.js test environments.
let _el = { specializationsHost: null };
// RAF handle for connector redraw (module-scoped to this module only)
let _connectorRafId = 0;

export function initSpecializations(domRefs) {
  _el = { ..._el, ...domRefs };
}

// Callbacks injected by entry point to avoid circular deps with render-pages.js
let _enforceEditorConsistency = () => {};
let _markEditorChanged = () => {};
let _renderEditor = () => {};
let _renderSkills = () => {};
let _renderEquipmentPanel = () => {};

export function initSpecializationsCallbacks({ enforceEditorConsistency, markEditorChanged, renderEditor, renderSkills, renderEquipmentPanel }) {
  _enforceEditorConsistency = enforceEditorConsistency;
  _markEditorChanged = markEditorChanged;
  _renderEditor = renderEditor;
  _renderSkills = renderSkills;
  _renderEquipmentPanel = renderEquipmentPanel || (() => {});
}

export function getMajorTraitsByTier(spec, catalog) {
  const result = { 1: [], 2: [], 3: [] };
  for (const traitId of spec.majorTraits || []) {
    const trait = catalog.traitById.get(Number(traitId));
    if (!trait) continue;
    const tier = Number(trait.tier) || 0;
    if (!result[tier]) continue;
    result[tier].push(trait);
  }
  return result;
}

export function makeTraitButton(trait, active, onClick, options = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  const classNames = ["trait-btn"];
  if (active) classNames.push("trait-btn--active");
  if (options.alwaysSelected) classNames.push("trait-btn--always");
  btn.className = classNames.join(" ");
  btn.title = trait?.name || "Unknown trait";
  if (trait?.icon) {
    const img = document.createElement("img");
    img.src = String(trait.icon);
    img.alt = trait.name || "Trait";
    const fallback = String(trait.iconFallback || "");
    if (fallback) {
      img.addEventListener("error", () => {
        if (img.dataset.fallbackApplied === "1") return;
        img.dataset.fallbackApplied = "1";
        img.src = fallback;
      });
    }
    btn.append(img);
  } else {
    btn.textContent = "?";
  }
  btn.disabled = !trait;
  if (trait && typeof onClick === "function") {
    btn.addEventListener("click", onClick);
  }
  if (trait) {
    bindHoverPreview(btn, "trait", () => trait);
  }
  return btn;
}

export function drawSpecConnector(body) {
  if (!body) return;
  const bodyRect = body.getBoundingClientRect();
  // Skip if the panel is hidden — getBoundingClientRect returns zeros.
  // Important: do NOT remove the existing connector first, so it survives
  // re-renders that happen while the build tab is not visible.
  if (bodyRect.width === 0 || bodyRect.height === 0) return;
  body.querySelector(".spec-connector")?.remove();
  const roles = ["minor-1", "major-1", "minor-2", "major-2", "minor-3", "major-3"];

  const points = [];
  for (const role of roles) {
    const node = body.querySelector(`[data-connector-role="${role}"]`);
    if (!(node instanceof HTMLElement)) continue;
    const r = node.getBoundingClientRect();
    points.push({ x: r.left + r.width / 2 - bodyRect.left, y: r.top + r.height / 2 - bodyRect.top });
  }
  if (points.length < 2) return;

  const pathData = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");

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

// Bodies we've already wired an observer to (keyed weakly so re-rendered cards
// don't accumulate observers, and detached bodies get GC'd with their observer).
const _observedBodies = typeof WeakSet !== "undefined" ? new WeakSet() : null;

// Redraw a body's connector whenever its box changes size — window resize,
// browser/OS ZOOM (which does NOT fire a window 'resize' event), --spec-scale,
// or image/font reflow. The SVG viewBox + path are baked in pixel coords at draw
// time and preserveAspectRatio="none" skews them if the panel later scales, so
// the connector must be recomputed from fresh geometry on every size change.
// RAF-debounced, idempotent per body, and guarded for the jsdom test env.
export function observeSpecConnector(body) {
  if (!body || !_observedBodies) return;
  if (typeof ResizeObserver !== "function") return;
  if (_observedBodies.has(body)) return;
  _observedBodies.add(body);
  let raf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => drawSpecConnector(body));
  });
  ro.observe(body);
}

export function renderSpecializations() {
  const catalog = state.activeCatalog;
  if (!_el.specializationsHost) return;
  _el.specializationsHost.innerHTML = "";
  if (!catalog) {
    _el.specializationsHost.innerHTML = `
      <div class="spec-empty-state">
        <div class="spec-empty-state__icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <path d="M24 4L44 24L24 44L4 24Z" stroke="rgba(79,216,151,0.4)" stroke-width="1.5" fill="rgba(79,216,151,0.06)"/>
            <path d="M24 12L36 24L24 36L12 24Z" stroke="rgba(79,216,151,0.25)" stroke-width="1" fill="none"/>
            <line x1="24" y1="18" x2="24" y2="30" stroke="rgba(79,216,151,0.5)" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="18" y1="24" x2="30" y2="24" stroke="rgba(79,216,151,0.5)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <p class="spec-empty-state__text">Select a profession to begin building</p>
      </div>`;
    return;
  }

  const allSpecs = Array.isArray(catalog.specializations) ? catalog.specializations : [];
  const lastSlotSpec = catalog.specializationById.get(
    Number(state.editor.specializations[2]?.specializationId) || 0
  );
  for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
    const selection = state.editor.specializations[slotIndex];
    const currentId = Number(selection?.specializationId) || 0;
    const spec = catalog.specializationById.get(currentId) || null;

    // Empty slot — render a placeholder card with a picker.
    if (!spec) {
      const card = document.createElement("article");
      card.className = "spec-card spec-card--empty";
      const panel = document.createElement("div");
      panel.className = "spec-card__panel spec-card__panel--empty";

      const body = document.createElement("div");
      body.className = "spec-card__empty-body";

      const diamond = document.createElement("div");
      diamond.className = "spec-empty-diamond";
      diamond.innerHTML = `
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
          <path d="M26 4L48 26L26 48L4 26Z" stroke="rgba(166,187,222,0.3)" stroke-width="1.5" fill="rgba(166,187,222,0.04)"/>
          <line x1="26" y1="18" x2="26" y2="34" stroke="rgba(166,187,222,0.4)" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="18" y1="26" x2="34" y2="26" stroke="rgba(166,187,222,0.4)" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;

      const label = document.createElement("span");
      label.className = "spec-empty-label";
      label.textContent = slotIndex === 2 ? "Choose specialization or elite" : "Choose specialization";

      body.append(diamond, label);
      panel.append(body);

      // Wire up the select overlay for empty slots too.
      if (!_readOnly) {
        const selectHost = document.createElement("div");
        renderCustomSelect(selectHost, {
          value: "",
          className: "cselect--spec",
          options: (() => {
            const usedIds = new Set(
              state.editor.specializations
                .map((e) => Number(e?.specializationId) || 0)
                .filter(Boolean)
            );
            return allSpecs
              .filter((optionSpec) => slotIndex === 2 || !optionSpec.elite)
              .map((optionSpec) => ({
                value: String(optionSpec.id),
                label: optionSpec.name,
                icon: optionSpec.icon || (optionSpec.name ? `https://wiki.guildwars2.com/wiki/Special:FilePath/${encodeURIComponent(optionSpec.name)}.png` : ""),
                disabled: usedIds.has(optionSpec.id),
              }));
          })(),
          placeholder: "Select specialization",
          onChange: (nextValue) => {
            const nextId = Number(nextValue) || 0;
            state.editor.specializations[slotIndex] = {
              specializationId: nextId,
              majorChoices: { 1: 0, 2: 0, 3: 0 },
            };
            _enforceEditorConsistency({ preferredEliteSlot: slotIndex });
            _markEditorChanged({ updateBuildList: true });
            _renderEditor();
          },
        });
        selectHost.classList.add("spec-select-overlay", "spec-select-overlay--empty");

        // Make the whole empty card clickable to open the spec picker.
        panel.style.cursor = "pointer";
        panel.addEventListener("click", () => {
          const trigger = selectHost.querySelector(".cselect__trigger");
          if (trigger instanceof HTMLElement) trigger.click();
        });

        card.append(panel, selectHost);
      } else {
        card.append(panel);
      }

      _el.specializationsHost.append(card);
      continue;
    }

    const card = document.createElement("article");
    card.className = "spec-card";
    const panel = document.createElement("div");
    panel.className = spec.elite ? "spec-card__panel spec-card__panel--elite" : "spec-card__panel";
    const wikiBackground = `https://wiki.guildwars2.com/wiki/Special:FilePath/${encodeURIComponent(`${spec.name || ""} specialization.png`)}`;
    panel.style.backgroundImage = `linear-gradient(0deg, rgba(7, 14, 27, 0.1), rgba(7, 14, 27, 0.1)), url("${wikiBackground.replaceAll('"', '\\"')}")`;
    panel.style.backgroundPosition = "center, center";
    panel.style.backgroundSize = "100% 100%, cover";
    panel.style.backgroundRepeat = "no-repeat, no-repeat";

    const selectHost = document.createElement("div");
    if (!_readOnly) {
    renderCustomSelect(selectHost, {
      value: String(spec.id),
      className: "cselect--spec",
      options: (() => {
        // Slot 2 with elite: disable specs already used in slots 0/1 (no swap allowed).
        // Slots 0/1: never disable anything — always freely swappable.
        const slot2IsElite = slotIndex === 2 && !!lastSlotSpec?.elite;
        const usedInOtherSlots = slot2IsElite
          ? new Set(state.editor.specializations
              .filter((_, i) => i !== slotIndex)
              .map(e => Number(e?.specializationId) || 0)
              .filter(Boolean))
          : new Set();
        return allSpecs
          .filter((optionSpec) => slotIndex === 2 || !optionSpec.elite)
          .map((optionSpec) => ({
            value: String(optionSpec.id),
            label: optionSpec.name,
            icon: optionSpec.icon || (optionSpec.name ? `https://wiki.guildwars2.com/wiki/Special:FilePath/${encodeURIComponent(optionSpec.name)}.png` : ""),
            disabled: usedInOtherSlots.has(optionSpec.id),
          }));
      })(),
      placeholder: "Select specialization",
      onChange: (nextValue) => {
        const nextId = Number(nextValue) || 0;
        const currentSpec = catalog.specializationById.get(Number(spec.id) || 0);
        const otherIdx = state.editor.specializations.findIndex(
          (entry, i) => i !== slotIndex && (Number(entry?.specializationId) || 0) === nextId
        );
        // Slots 0/1 always swap freely. Slot 2 swaps only if its current spec is not elite.
        const canSwap = otherIdx !== -1 && (slotIndex !== 2 || !currentSpec?.elite);

        let swapRects = null;
        if (canSwap) {
          // Capture card positions BEFORE re-render for FLIP animation.
          const cards = _el.specializationsHost?.querySelectorAll('.spec-card');
          const fromCard = cards?.[slotIndex];
          const toCard = cards?.[otherIdx];
          if (fromCard && toCard) {
            swapRects = {
              fromIdx: slotIndex, toIdx: otherIdx,
              fromRect: fromCard.getBoundingClientRect(),
              toRect: toCard.getBoundingClientRect(),
            };
          }
          // Swap: preserve each slot's majorChoices.
          const tmp = state.editor.specializations[slotIndex];
          state.editor.specializations[slotIndex] = state.editor.specializations[otherIdx];
          state.editor.specializations[otherIdx] = tmp;
        } else {
          state.editor.specializations[slotIndex] = {
            specializationId: nextId,
            majorChoices: { 1: 0, 2: 0, 3: 0 },
          };
        }

        _enforceEditorConsistency({ preferredEliteSlot: slotIndex });
        _markEditorChanged({ updateBuildList: true });
        _renderEditor();

        if (swapRects) {
          const newCards = _el.specializationsHost?.querySelectorAll('.spec-card');
          const newFromCard = newCards?.[swapRects.fromIdx];
          const newToCard = newCards?.[swapRects.toIdx];
          if (newFromCard && newToCard) {
            const dx1 = swapRects.toRect.left - swapRects.fromRect.left;
            const dy1 = swapRects.toRect.top  - swapRects.fromRect.top;
            const dx2 = swapRects.fromRect.left - swapRects.toRect.left;
            const dy2 = swapRects.fromRect.top  - swapRects.toRect.top;
            newFromCard.style.transition = 'none';
            newFromCard.style.transform = `translate(${dx1}px,${dy1}px)`;
            newToCard.style.transition = 'none';
            newToCard.style.transform = `translate(${dx2}px,${dy2}px)`;
            requestAnimationFrame(() => requestAnimationFrame(() => {
              const spring = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
              newFromCard.style.transition = spring;
              newFromCard.style.transform = '';
              newToCard.style.transition = spring;
              newToCard.style.transform = '';
              newFromCard.addEventListener('transitionend', () => { newFromCard.style.transition = ''; }, { once: true });
              newToCard.addEventListener('transitionend', () => { newToCard.style.transition = ''; }, { once: true });
            }));
          }
        }
      },
    });
    }
    selectHost.classList.add("spec-select-overlay");

    const body = document.createElement("div");
    body.className = "spec-card__body";
    const emblem = document.createElement("button");
    emblem.type = "button";
    emblem.className = spec.elite ? "spec-emblem spec-emblem--elite" : "spec-emblem";
    emblem.title = spec.name || `Spec ${slotIndex + 1}`;
    const wikiIcon = spec.name
      ? `https://wiki.guildwars2.com/wiki/Special:FilePath/${encodeURIComponent(spec.name)}.png`
      : "";
    if (spec.icon || wikiIcon) {
      const img = document.createElement("img");
      img.alt = spec.name || "Specialization";
      img.src = spec.icon || wikiIcon;
      if (spec.icon && wikiIcon) {
        img.onerror = () => { img.onerror = null; img.src = wikiIcon; };
      }
      emblem.append(img);
    } else {
      emblem.textContent = "?";
    }
    emblem.disabled = _readOnly;
    if (!_readOnly) {
      emblem.addEventListener("click", () => {
        const trigger = selectHost.querySelector(".cselect__trigger");
        if (trigger instanceof HTMLElement) trigger.click();
      });
    }
    if (spec.name) {
      bindHoverPreview(emblem, "spec", () => spec);
    }
    body.append(emblem);

    const majors = getMajorTraitsByTier(spec, catalog);
    const minorTraits = (spec.minorTraits || [])
      .slice(0, 3)
      .map((traitRef) => {
        const id = typeof traitRef === "object" ? traitRef?.id : Number(traitRef);
        return catalog.traitById.get(id) || (typeof traitRef === "object" ? traitRef : null);
      });
    const lanes = [1, 2, 3];
    for (const tier of lanes) {
      const minorColumn = document.createElement("div");
      minorColumn.className = "trait-minor-anchor";
      const minorTrait = minorTraits[tier - 1];
      const minorOnClick = _readOnly ? null : () => selectDetail("trait", minorTrait);
      const minorButton = makeTraitButton(minorTrait, false, minorOnClick, {
        alwaysSelected: true,
      });
      minorButton.dataset.connectorRole = `minor-${tier}`;
      minorColumn.append(minorButton);
      body.append(minorColumn);

      const column = document.createElement("div");
      column.className = "trait-column trait-column--major";
      const selectedId = Number(selection?.majorChoices?.[tier]) || 0;
      for (const trait of majors[tier] || []) {
        const isSelected = Number(trait.id) === selectedId;
        const majorOnClick = _readOnly ? null : () => {
          state.editor.specializations[slotIndex].majorChoices[tier] = Number(trait.id);
          _markEditorChanged({ updateBuildList: true });
          // Surgical update: toggle active class and connector role without full re-render
          for (const sibling of column.querySelectorAll(".trait-btn")) {
            sibling.classList.remove("trait-btn--active");
            delete sibling.dataset.connectorRole;
          }
          majorButton.classList.add("trait-btn--active");
          majorButton.dataset.connectorRole = `major-${tier}`;
          cancelAnimationFrame(_connectorRafId);
          _connectorRafId = requestAnimationFrame(() => drawSpecConnector(body));
          _renderSkills();
          _renderEquipmentPanel();
          selectDetail("trait", trait);
        };
        const majorButton = makeTraitButton(trait, isSelected, majorOnClick);
        if (isSelected) {
          majorButton.dataset.connectorRole = `major-${tier}`;
        }
        column.append(majorButton);
      }
      body.append(column);
    }

    panel.append(body);
    card.append(panel, selectHost);
    _el.specializationsHost.append(card);
  }

  // Draw connectors synchronously — getBoundingClientRect forces layout reflow,
  // so dimensions are correct even before the next paint frame.
  if (_el.specializationsHost) {
    for (const body of _el.specializationsHost.querySelectorAll(".spec-card__body")) {
      drawSpecConnector(body);
      observeSpecConnector(body);
    }
  }
  // Also schedule a single-rAF refinement pass in case layout shifts after images load.
  cancelAnimationFrame(_connectorRafId);
  _connectorRafId = requestAnimationFrame(() => {
    if (!_el.specializationsHost) return;
    for (const body of _el.specializationsHost.querySelectorAll(".spec-card__body")) {
      drawSpecConnector(body);
    }
  });
}
