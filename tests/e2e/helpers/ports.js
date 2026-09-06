// Per-worker port and data-dir allocation.
//
// The suite runs several Electron apps at once, and each one needs a sync
// server and a profile directory that no other worker touches. Playwright sets
// TEST_PARALLEL_INDEX to the worker's slot (0-based, bounded by `workers`),
// which is exactly the key both need.
// Kept well apart: the sync range is `SYNC_PORT_BASE + workerIndex`, so any
// other fixed port a spec picks has to clear the whole worker span.
const SYNC_PORT_BASE = 9878;
const PUBLISH_PORT_BASE = 9920;

/** This worker's slot. 0 outside Playwright (e.g. a one-off node script). */
function workerIndex() {
  const raw = process.env.TEST_PARALLEL_INDEX;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

const syncPort = () => SYNC_PORT_BASE + workerIndex();

/** The stand-in "published site" that the AxiForge-link import spec serves from. */
const publishPort = () => PUBLISH_PORT_BASE + workerIndex();

module.exports = { SYNC_PORT_BASE, PUBLISH_PORT_BASE, workerIndex, syncPort, publishPort };
