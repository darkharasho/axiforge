// A chat code leaves out any id the GW2 API no longer recognizes (a removed skill, a
// hand-edited build) rather than failing outright. The copy still succeeds, so this
// is what tells the user the code they just pasted is missing those slots.
export function chatLinkDroppedNotice(dropped) {
  if (!Array.isArray(dropped) || dropped.length === 0) return null;
  const n = dropped.length;
  return `Chat code copied without ${n} ${n === 1 ? "entry" : "entries"} the GW2 API doesn't recognize: ${dropped.join(", ")}`;
}
