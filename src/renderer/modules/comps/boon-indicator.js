// Pure helper behind the comp list's boon coverage meter (comps.css's "Boon
// Coverage Indicator" block). Kept out of comp-list.js on purpose: that file
// is 35.5 KB and pulls in state, window.desktopApi and the coverage engine,
// and this is pure string math — a test reaching it should not have to
// stand up a DOM or any of that import graph. No DOM, no state, no import
// from comp-list.js here; comp-list.js imports this, never the other way.

/**
 * A percentage, clamped and formatted for --axi-meter-v.
 * Rule 9: a proportion is a length, so the number has to be a length the
 * layout can survive. An unclamped value overflows the track and paints over
 * its own outline; NaN renders as a full bar in some engines.
 * @param {unknown} n
 * @returns {string} e.g. "63%"
 */
export function meterValue(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0%";
  return `${Math.round(Math.min(100, Math.max(0, v)))}%`;
}
