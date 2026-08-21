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
  // A failed purge must not become an unhandled rejection inside ctx.waitUntil.
  expect(src).toMatch(/purgeTombstones\(env\)\s*\.then\([\s\S]*?\)\s*\.catch\(/);
  expect(src.indexOf("/api/sync/")).toBeLessThan(src.indexOf("env.ASSETS.fetch(request)"));
});

test("wrangler.jsonc binds SYNC_DB, SYNC_RL, routes /api/sync/* to the Worker, and schedules the purge", () => {
  const raw = fs.readFileSync(WRANGLER, "utf8");
  expect(raw).toMatch(/"binding":\s*"SYNC_DB"/);
  expect(raw).toMatch(/"migrations_dir":\s*"workers\/sync\/migrations"/);
  expect(raw).toMatch(/"binding":\s*"SYNC_RL"/);
  // /api/sync/* is a subset of /api/*, already routed to the Worker — no separate entry needed.
  expect(raw).toMatch(/"run_worker_first":\s*\[\s*"\/api\/\*",\s*"\/b\/\*"\s*\]/);
  expect(raw).toMatch(/"crons":\s*\[\s*"0 4 \* \* \*"\s*\]/);
});
