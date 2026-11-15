// Discover newly-published items of a given GW2 API `type` (e.g. "Relic")
// without the wiki. The wiki 403s GitHub Actions IPs, so a wiki-only sync
// silently leaves lists stale in CI (issue #337). The GW2 API is reachable.
//
// Item ids are assigned monotonically, so we only scan ids above the highest
// id we already know (the watermark) — a few dozen requests, not the whole
// ~100k-item catalog. Additive only: never removes anything.

async function discoverNewItemsByType({ allIds, existingIds, type, fetchItems, batchSize = 200 }) {
  const existing = new Set(existingIds.map(Number));
  if (!existing.size) {
    throw new Error("no existing ids to use as a watermark; refusing to scan the full catalog");
  }
  const watermark = Math.max(...existing);
  const candidates = allIds
    .map(Number)
    .filter((id) => id > watermark && !existing.has(id))
    .sort((a, b) => a - b);

  const found = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    const items = await fetchItems(candidates.slice(i, i + batchSize));
    for (const item of items) {
      if (item && item.type === type && !existing.has(item.id)) {
        found.push({ id: item.id, name: item.name });
      }
    }
  }
  return found.sort((a, b) => a.id - b.id);
}

module.exports = { discoverNewItemsByType };
