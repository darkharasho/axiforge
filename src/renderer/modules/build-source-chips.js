// The quick-glance half of build sources: small chips that say "this came from
// somewhere else" without anyone opening a modal.
//
// The design rule these follow, everywhere: SILENCE IS THE DEFAULT. A chip on
// every card is wallpaper you stop reading by the third row. A chip only on the
// builds that break the expectation -- a build sourced outside its comp's
// folder, a comp reaching across the library -- is a thing you notice. So each
// helper below returns "" for the unremarkable case, and the CSS gives the
// loud variant the accent colour while the merely-informational one stays dim.
//
// Every chip carries data-src-build / data-src-comp so the click handlers in
// the library and the comp detail can open the sources modal without knowing
// anything about how the chip was built.

import { escapeHtml } from "./utils.js";
import { compIcon } from "./library/heroicons.js";
import { buildUsage, compSources, folderPathText } from "./build-sources.js";

const folderGlyph = `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75Z"/><path d="M3.75 9A1.75 1.75 0 0 0 2 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25v-4.5A1.75 1.75 0 0 0 16.25 9H3.75Z"/></svg>`;

const externalGlyph = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>`;

/** "3 comps" / "1 comp". */
function compCountLabel(n) {
  return n === 1 ? "1 comp" : `${n} comps`;
}

function compName(comp) {
  return comp.name || "Untitled Comp";
}

/**
 * The comp side. Drawn on a build inside a comp only when the build lives
 * outside the comp's own folder -- the exception, never the rule.
 *
 * The chip shows the LEAF folder because that is the part that identifies the
 * build ("Support", "Roaming"); the full path goes in the tooltip, where it
 * costs no space. A build at the library root is genuinely from somewhere else
 * but has no leaf name, and an unlabelled chip reads as a rendering bug, so it
 * gets said out loud.
 */
export function foreignFolderChipHtml(build, comp) {
  if (!build?.id || !comp) return "";
  if ((build.folderId || null) === (comp.folderId || null)) return "";

  const path = folderPathText(build.folderId);
  const label = path ? path.split(" / ").pop() : "Library root";
  return `<span class="src-chip src-chip--foreign" role="button" tabindex="0" draggable="false"
    data-src-build="${escapeHtml(build.id)}" data-src-comp="${escapeHtml(comp.id)}"
    title="${escapeHtml(path || "Library root")}">${folderGlyph}${escapeHtml(label)}</span>`;
}

/**
 * The library side. Standing in the build's own folder, the folder is implicit
 * -- what you cannot see is who consumes this build. So the chip counts comps,
 * and turns loud only when at least one of them lives elsewhere, which is the
 * case where "who uses this" has a surprising answer.
 *
 * @param {object} build
 * @param {{compact?: boolean}} [opts] compact drops the word for grid/icon
 *   cards, which have no room for it; the tooltip still carries everything.
 */
export function buildUsageChipHtml(build, { compact = false } = {}) {
  const usage = buildUsage(build);
  if (!usage.count) return "";

  const tooltip = [
    `${build.title || "This build"} — used in ${compCountLabel(usage.count)}`,
    ...usage.entries.map((e) => `${compName(e.comp)} — ${e.folderPath || "Library root"}`),
  ].join("\n");

  const variant = usage.hasExternal ? "src-chip--external" : "src-chip--local";
  // Compact drops the word but NOT the meaning: a bare "1" beside a role badge
  // reads as a stray number, so it keeps the same 2x2 glyph the sidebar and the
  // comp rows use for a comp. Icon plus count still says "in 1 comp".
  const label = compact
    ? `${compIcon}${escapeHtml(String(usage.count))}`
    : escapeHtml(compCountLabel(usage.count));
  const arrow = usage.hasExternal ? externalGlyph : "";

  return `<span class="src-chip ${variant} ${compact ? "src-chip--compact" : ""}" role="button" tabindex="0" draggable="false"
    data-src-build="${escapeHtml(build.id)}"
    title="${escapeHtml(tooltip)}">${label}${arrow}</span>`;
}

/**
 * The comp row in the library. Replaces the bare "6 builds" count with one that
 * admits when the comp is shopping outside its own folder, so you can see it
 * without entering the comp.
 */
export function compSourceBadgeHtml(comp) {
  const { total, externalCount } = compSources(comp);
  const count = total === 1 ? "1 build" : `${total} builds`;
  if (!externalCount) return `<span class="lib-list-row__badge">${count}</span>`;

  return `<span class="lib-list-row__badge lib-list-row__badge--sources" role="button" tabindex="0" draggable="false"
    data-src-comp="${escapeHtml(comp.id)}"
    title="${escapeHtml(`${externalCount} of ${total} builds live outside this comp's folder`)}"
    >${count} · <span class="src-external-count">${externalCount} external</span></span>`;
}
