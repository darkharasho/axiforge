// AxiForge — Comp notes tab
//
// Comps get the same markdown editor as builds (toolbar, preview, image paste,
// YouTube/Twitch embeds). The editor is bound to the comp through a doc adapter
// so nothing leaks into state.editor.
//
// @ mentions still resolve profession-agnostic entries — runes, sigils, relics,
// food, utilities, infusions, weapons — because those come from the global
// upgrade catalog. Skills and traits need a profession context a comp doesn't
// have, so they simply don't turn up in the autocomplete.
//
// Comps additionally get Discord-style class emoji: typing ":fire" offers
// Firebrand, and ":Firebrand:" renders as the class icon.

import { createNotesEditor } from "../notes.js";
import { compIcon, pencilIcon } from "../library/heroicons.js";

const TABS = [
  { id: "comp", label: "Comp", icon: compIcon },
  { id: "notes", label: "Notes", icon: pencilIcon },
];

const COMP_NOTES_PLACEHOLDER =
  "Squad callouts, boon assignments, strat notes...\n\nTip: Type : for class icons, @ to reference runes, sigils, relics, and weapons.";

const COMP_NOTES_HINT =
  "Type <strong>:</strong> for class icons and <strong>@</strong> to reference runes, sigils, relics, and weapons. <strong>Paste</strong> images from your clipboard. YouTube &amp; Twitch links auto-embed in preview.";

/**
 * The comp detail's tabs, as .subnav__item buttons.
 *
 * These used to be a strip of their own below the topbar, with their own
 * near-copy of the tab tokens. They are the build editor's subnav tabs now —
 * same class, same icons-then-label shape, same filled-and-blocked current tab
 * — because they do the same job one screen over, and a row that reuses the
 * component inherits its uniform height instead of inventing another one.
 *
 * Returns the buttons bare, with no wrapper: the bar they sit in IS the
 * .subnav, so they have to be its direct children.
 *
 * @param {string} activeTab      "comp" | "notes"
 * @param {object} [opts]         { hasNotes: boolean } — dots the Notes tab
 * @returns {string} HTML
 */
export function renderCompTabs(activeTab, { hasNotes = false } = {}) {
  const active = TABS.some((t) => t.id === activeTab) ? activeTab : "comp";
  return TABS.map((tab) => {
    const isActive = tab.id === active;
    const cls = "subnav__item" + (isActive ? " subnav__item--active" : "");
    const dot = tab.id === "notes" && hasNotes ? '<span class="comp-detail__tab-dot"></span>' : "";
    return `<button type="button" class="${cls}" role="tab" aria-selected="${isActive}" data-comp-tab="${tab.id}"><span class="subnav__icon">${tab.icon}</span>${tab.label}${dot}</button>`;
  }).join("");
}

/**
 * Doc adapter binding the shared notes editor to a comp.
 *
 * @param {object} comp
 * @param {(comp: object) => void} onChange  called after every edit
 */
export function createCompNotesDoc(comp, onChange) {
  return {
    getText: () => comp.notes || "",
    setText: (v) => { comp.notes = v; },
    getImages: () => comp.images,
    setImages: (v) => { comp.images = v; },
    onChange: () => onChange(comp),
  };
}

/**
 * Render the comp notes editor into a mount element.
 *
 * @param {HTMLElement} mountEl
 * @param {object} comp
 * @param {(comp: object) => void} onChange
 * @param {object} [opts]  { readOnly }
 */
export function mountCompNotes(mountEl, comp, onChange, { readOnly = false } = {}) {
  createNotesEditor(mountEl, createCompNotesDoc(comp, onChange), {
    readOnly,
    classEmoji: true,
    placeholder: COMP_NOTES_PLACEHOLDER,
    hint: COMP_NOTES_HINT,
  }).render();
}
