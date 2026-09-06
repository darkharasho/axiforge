// Asking about builds an import would duplicate.
//
// A published comp carries every build it uses, so importing three comps from
// the same squad used to leave three copies of the same Firebrand sitting in
// three folders. Main now recognises them (see buildDedupe.js); this is the
// half that asks, because reusing is a judgement call — the copy you have may
// have your own notes on it, or you may want the imported one left alone.
//
// It is one question, not one per build: the interesting decision is "reuse
// what I have" versus "give me my own copies", and a checklist of five
// identical Firebrands is a worse way to ask it.

import { escapeHtml } from "../utils.js";

/**
 * @param {{kind: string, name: string, buildCount: number, duplicates: object[]}} preview
 * @returns {string} HTML for the modal body
 */
export function describeDuplicates(preview) {
  const dupes = preview?.duplicates || [];
  const rows = dupes
    .map(
      (d) =>
        `<li><strong>${escapeHtml(d.incomingTitle)}</strong> — you have this as “${escapeHtml(d.existingTitle)}”</li>`
    )
    .join("");

  if (preview?.kind !== "comp") {
    return `<p>You already have this build:</p><ul class="import-dedupe__list">${rows}</ul>`;
  }

  const n = dupes.length;
  const total = preview.buildCount;
  const lead =
    n === total
      ? `Every build in <strong>${escapeHtml(preview.name)}</strong> is already in your library:`
      : `${n} of the ${total} builds in <strong>${escapeHtml(preview.name)}</strong> are already in your library:`;
  return `<p>${lead}</p><ul class="import-dedupe__list">${rows}</ul>`;
}

/**
 * @param {object} preview from previewAxiLink
 * @param {(opts: object) => Promise<string|null>} showChoice injected so this is
 *   testable without the modal's DOM
 * @returns {Promise<"reuse"|"copy"|null>} null means the user backed out
 */
export async function askAboutDuplicates(preview, showChoice) {
  // Nothing to ask about: importing its own copies IS the no-duplicates case.
  if (!preview?.duplicates?.length) return "copy";

  const isComp = preview.kind === "comp";
  const choice = await showChoice({
    title: isComp ? "Some of these builds look familiar" : "You already have this build",
    body: describeDuplicates(preview),
    choices: [
      {
        id: "reuse",
        label: isComp ? "Use the ones I have" : "Open the one I have",
      },
      { id: "copy", label: isComp ? "Import copies anyway" : "Import a copy anyway" },
    ],
  });
  return choice === "reuse" || choice === "copy" ? choice : null;
}

/**
 * What to tell the user once the import lands. Kept next to the question so the
 * two stay in the same language — "used" here, "use" in the prompt.
 */
export function summarizeImport(saved, decision) {
  if (saved?.kind === "comp") {
    const added = saved.builds?.length || 0;
    const reused = saved.reused?.length || 0;
    const name = saved.comp?.name || "Comp";
    if (reused === 0) return `“${name}” imported with ${added} build${added === 1 ? "" : "s"}`;
    if (added === 0) return `“${name}” imported using ${reused} build${reused === 1 ? "" : "s"} you already had`;
    return `“${name}” imported — ${added} new build${added === 1 ? "" : "s"}, ${reused} you already had`;
  }
  const title = saved?.title || "Build";
  return decision === "reuse" && saved?.reusedExisting
    ? `You already had “${title}” — opened that one`
    : `“${title}” imported`;
}
