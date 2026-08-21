"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ENTRY = path.join(__dirname, "../../workers/share-shortener/src/index.js");
const WRANGLER = path.join(__dirname, "../../wrangler.jsonc");

test("Worker entry dispatches /api/sync/* to handleSync before asset fallback and exposes scheduled()", () => {
  const src = fs.readFileSync(ENTRY, "utf8");
  expect(src).toMatch(/startsWith\("\/api\/sync\/"\)/);
  expect(src).toMatch(/import\("\.\.\/\.\.\/sync\/src\/router\.js"\)/);
  expect(src).toMatch(/async scheduled\(/);
  expect(src).toMatch(/purgeTombstones/);
  expect(src.indexOf("/api/sync/")).toBeLessThan(src.indexOf("env.ASSETS.fetch(request)"));
});

test("wrangler.jsonc binds SYNC_DB, SYNC_RL, routes /api/sync/* to the Worker, and schedules the purge", () => {
  const raw = fs.readFileSync(WRANGLER, "utf8");
  expect(raw).toMatch(/"binding":\s*"SYNC_DB"/);
  expect(raw).toMatch(/"migrations_dir":\s*"workers\/sync\/migrations"/);
  expect(raw).toMatch(/"binding":\s*"SYNC_RL"/);
  expect(raw).toMatch(/"\/api\/sync\/\*"/);
  expect(raw).toMatch(/"crons":\s*\[\s*"0 4 \* \* \*"\s*\]/);
});
