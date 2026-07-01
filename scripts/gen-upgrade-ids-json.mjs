#!/usr/bin/env node
// gen-upgrade-ids-json.mjs — derive src/main/gw2Data/upgradeIds.json from
// upgradeIds.js. The .js file stays the hand-curated source of truth (and the
// app's baked fallback); the .json is the pure-data artifact the app fetches at
// runtime from `main`. Regenerate whenever upgradeIds.js changes (the data-drift
// workflow does this automatically after sync-upgrade-ids).
//
// Usage: node scripts/gen-upgrade-ids-json.mjs

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(__dirname, "../src/main/gw2Data/upgradeIds.json");

const ids = require("../src/main/gw2Data/upgradeIds.js");
// Serialize Sets (e.g. WVW_INFUSION_IDS) as arrays; the runtime loader rehydrates.
const out = {};
for (const [key, val] of Object.entries(ids)) {
  out[key] = val instanceof Set ? [...val] : val;
}

await writeFile(TARGET, JSON.stringify(out, null, 2) + "\n");
const summary = Object.entries(out)
  .map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : "?"}`)
  .join(", ");
console.log(`✓ wrote ${path.relative(process.cwd(), TARGET)} (${summary})`);
