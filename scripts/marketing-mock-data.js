/**
 * Mock data for marketing screenshots. Pre-seeded into the e2e profile's
 * data directory so the library/comps pages look lived-in.
 *
 * For the GvG 15v15 comp we use six real builds (Firebrand, Druid, Tempest,
 * Reaper, Berserker, Troubadour) extracted from the developer's local app —
 * they carry full traits / skills / weapons / gear and resolve in the comp
 * detail slots. The remaining synthetic builds are minimal — enough to make
 * the library page look populated.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const now = Date.now();
const isoDaysAgo = (d) => new Date(now - d * 86400_000).toISOString();
const id = (n) => `mock-${n.toString(36).padStart(6, "0")}`;
const lineId = () => `mock-line-${crypto.randomUUID().slice(0, 8)}`;

const FIXTURE_BUILDS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "marketing-fixture-builds.json"), "utf-8")
);

// Re-stamp each fixture build's metadata so it slots cleanly into the mock
// dataset (folder placement, updatedAt for ordering, etc.).
function fixtureBuild(key, { folderId, daysAgo = 3 }) {
  const src = FIXTURE_BUILDS[key];
  if (!src) throw new Error(`Missing fixture build: ${key}`);
  return {
    ...src,
    folderId,
    compIds: [],
    pinned: false,
    sortOrder: 0,
    updatedAt: isoDaysAgo(daysAgo),
    createdAt: src.createdAt || isoDaysAgo(daysAgo + 30),
  };
}

const FOLDERS = [
  { id: id(1), name: "Zerg", parentId: null, shared: false, createdAt: isoDaysAgo(45), updatedAt: isoDaysAgo(2) },
  { id: id(2), name: "Havoc", parentId: null, shared: false, createdAt: isoDaysAgo(30), updatedAt: isoDaysAgo(1) },
  { id: id(3), name: "Roaming", parentId: null, shared: false, createdAt: isoDaysAgo(60), updatedAt: isoDaysAgo(5) },
  { id: id(4), name: "GvG", parentId: null, shared: false, createdAt: isoDaysAgo(20), updatedAt: isoDaysAgo(3) },
];

// Real fixture builds (full data) — these are what populate the GvG comp.
// Three live at the library root (folderId: null) so the library's "All
// Builds" view shows real builds inline next to the folders + comps; the
// other three sit inside the GvG folder.
const realBuilds = [
  fixtureBuild("firebrand",  { folderId: null,  daysAgo: 1 }),
  fixtureBuild("druid",      { folderId: null,  daysAgo: 2 }),
  fixtureBuild("troubadour", { folderId: null,  daysAgo: 3 }),
  fixtureBuild("tempest",    { folderId: id(1), daysAgo: 4 }),
  fixtureBuild("reaper",     { folderId: id(4), daysAgo: 5 }),
  fixtureBuild("berserker",  { folderId: id(4), daysAgo: 6 }),
];

// Synthetic library filler so the library page has volume.
const SYNTHETIC = [
  ["Boon Scrapper", "Engineer", ["Quickness", "Cleanse", "Zerg"], "wvw", id(1), 13],
  ["Scourge Bomb", "Necromancer", ["Condi", "Bomb", "Zerg"], "wvw", id(1), 14],
  ["Cele Weaver Roamer", "Elementalist", ["Cele", "Sustain", "Roam"], "wvw", id(3), 15],
  ["Mirage Roamer", "Mesmer", ["Condi", "Mobility", "Roam"], "wvw", id(3), 16],
  ["Spellbreaker", "Warrior", ["Power", "Strip", "GvG"], "wvw", id(4), 17],
  ["Daredevil Roamer", "Thief", ["Power", "+1", "Roam"], "wvw", id(3), 18],
  ["Vindicator (Havoc)", "Revenant", ["Power", "Burst", "Havoc"], "wvw", id(2), 19],
  ["Herald Boon", "Revenant", ["Boon DPS", "Frontline", "GvG"], "wvw", id(4), 20],
];

const syntheticBuilds = SYNTHETIC.map(([title, profession, tags, gameMode, folderId, n]) => ({
  id: id(100 + n),
  version: 2,
  title,
  profession,
  specializations: [],
  skills: { heal: null, utility: [null, null, null], elite: null },
  underwaterSkills: { heal: null, utility: [null, null, null], elite: null },
  equipment: {},
  tags,
  notes: "",
  images: [],
  createdAt: isoDaysAgo(20 + n),
  updatedAt: isoDaysAgo(n),
  buildUrl: "",
  gameMode,
  publishedSlug: "",
  publishedFileId: "",
  publishedKey: "",
  folderId,
  compIds: [],
  pinned: false,
  sortOrder: 0,
}));

const ALL_BUILDS = [...realBuilds, ...syntheticBuilds];

// Build-id shortcuts for the comp slot wiring below.
const B = Object.fromEntries(
  Object.entries(FIXTURE_BUILDS).map(([k, v]) => [k, v.id])
);

// Slots are an array of buildId strings, per the comp-detail renderer
// (src/renderer/modules/comps/comp-detail.js — `const buildId = slots[i]`).
const compLine = (capacity, ...buildIds) => ({
  id: lineId(),
  capacity,
  slots: buildIds,
});

const GVG_LINE_A = [B.firebrand, B.druid, B.tempest,    B.reaper, B.troubadour];
const GVG_LINE_B = [B.firebrand, B.druid, B.berserker,  B.reaper, B.troubadour];

const COMPS = [
  {
    id: id(50),
    name: "Zerg Frontline 25",
    notes: "5x Heal FB · 5x Scourge Bomb · 5x Scrapper · 5x Tempest · 5x Spellbreaker",
    tags: ["Zerg", "Frontline"],
    folderId: null,
    sortOrder: 0,
    buildIds: [B.firebrand, B.tempest, id(113), id(114), id(117)],
    gameMode: "wvw",
    partyLines: [
      compLine(5, B.firebrand, id(114), id(113), B.tempest, id(117)),
      compLine(5, B.firebrand, id(114), id(113), B.tempest, id(117)),
    ],
    createdAt: isoDaysAgo(15),
    updatedAt: isoDaysAgo(2),
  },
  {
    id: id(51),
    name: "GvG 15v15",
    notes: "Firebrand / Druid / Tempest / Reaper / Troubadour — mirrored with a Berserker swap on lines 2 and 4.",
    tags: ["GvG", "Roster"],
    folderId: null,
    sortOrder: 1,
    buildIds: Object.values(B),
    gameMode: "wvw",
    partyLines: [
      compLine(5, ...GVG_LINE_A),
      compLine(5, ...GVG_LINE_B),
      compLine(5, ...GVG_LINE_A),
      compLine(5, ...GVG_LINE_B),
    ],
    createdAt: isoDaysAgo(40),
    updatedAt: isoDaysAgo(5),
  },
  {
    id: id(52),
    name: "Havoc Squad",
    notes: "5-man pick group — Reaper pressure, Berserker burst, Troubadour cover, Druid heal, Firebrand stab.",
    tags: ["Havoc"],
    folderId: null,
    sortOrder: 2,
    buildIds: [B.firebrand, B.druid, B.berserker, B.reaper, B.troubadour],
    gameMode: "wvw",
    partyLines: [
      compLine(5, B.firebrand, B.druid, B.berserker, B.reaper, B.troubadour),
    ],
    createdAt: isoDaysAgo(8),
    updatedAt: isoDaysAgo(1),
  },
];

const APP_VERSION = require("../package.json").version;

const SETTINGS = {
  lastSeenVersion: APP_VERSION,
  "appearance.theme": "molten-core",
};

module.exports = { FOLDERS, BUILDS: ALL_BUILDS, COMPS, SETTINGS };
