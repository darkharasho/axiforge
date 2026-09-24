// Pure helpers behind the comp list's boon coverage meter (comps.css's "Boon
// Coverage Indicator" block). Kept out of comp-list.js on purpose: that file
// is 35.5 KB and pulls in state, window.desktopApi and the coverage engine,
// and these are pure string math — a test reaching them should not have to
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

const TICK_CAP = 20;

/**
 * A run of yes/no as marks of one size, differing only in ink.
 * Rule 9 read the other way round: a fact has no magnitude, so drawing it as
 * a short bar would read as "a little bit", which is the same lie as a faded
 * fill. Marks never flex, so a long run is capped and the remainder counted.
 * @param {boolean[]} flags
 * @returns {string}
 */
export function tickRun(flags) {
  const all = Array.isArray(flags) ? flags : [];
  const shown = all.slice(0, TICK_CAP);
  const marks = shown
    .map((on) => `<span class="axi-ticks__tick${on ? " axi-ticks__tick--on" : ""}"></span>`)
    .join("");
  const rest = all.length - shown.length;
  return `<span class="axi-ticks">${marks}</span>${rest > 0 ? `<span class="af-ticks__more">+${rest}</span>` : ""}`;
}
