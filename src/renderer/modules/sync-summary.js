// Phrasing for a teammate's change arriving over sync.
//
// Lives here rather than inline in renderer.js so the wording rules can be
// unit-tested without booting Electron (same reasoning as main/teamGuards.js).

/**
 * Say what a teammate just changed, in one line.
 *
 * `summarizeBuildChange()` lists EVERY changed field, joined with "; ", because
 * the history panel has a whole row to spend on it. A toast does not: a build
 * that arrives with new gear, new notes and a new title reads as a paragraph
 * and gets clipped mid-word. Keep the first few clauses and count the rest, so
 * the line stays readable and still admits there was more.
 *
 * @param {string|null|undefined} author the login of whoever made the change
 * @param {string|null|undefined} summary a summarizeBuildChange() result
 * @param {{max?: number}} [opts] how many clauses to name before counting
 * @returns {string} a complete sentence, always — an event with no summary
 *   still has to announce that something arrived.
 */
export function describeIncomingChange(author, summary, { max = 2 } = {}) {
  // "teammate" is main's placeholder for an item whose author it couldn't
  // resolve; repeating it verbatim would read as someone's name.
  const who = author && author !== "teammate" ? author : "A teammate";
  const text = String(summary || "").trim();
  if (!text || /^(created|build created)$/i.test(text)) {
    return `${who} changed this build.`;
  }
  const parts = text.split(";").map((s) => s.trim()).filter(Boolean);
  const rest = parts.length - max;
  const shown = parts.slice(0, max).join("; ");
  return `${who} changed this build — ${shown}${rest > 0 ? ` (+${rest} more)` : ""}.`;
}
