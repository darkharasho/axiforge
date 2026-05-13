/**
 * Mock data for marketing screenshots. Pre-seeded into the e2e profile's
 * data directory so the library/comps pages look lived-in.
 */

const now = Date.now();
const isoDaysAgo = (d) => new Date(now - d * 86400_000).toISOString();
const id = (n) => `mock-${n.toString(36).padStart(6, "0")}`;

const FOLDERS = [
  { id: id(1), name: "Zerg", parentId: null, shared: false, createdAt: isoDaysAgo(45), updatedAt: isoDaysAgo(2) },
  { id: id(2), name: "Havoc", parentId: null, shared: false, createdAt: isoDaysAgo(30), updatedAt: isoDaysAgo(1) },
  { id: id(3), name: "Roaming", parentId: null, shared: false, createdAt: isoDaysAgo(60), updatedAt: isoDaysAgo(5) },
  { id: id(4), name: "GvG", parentId: null, shared: false, createdAt: isoDaysAgo(20), updatedAt: isoDaysAgo(3) },
];

const BUILDS = [
  ["Heal Firebrand (Zerg)", "Guardian", ["Heal", "Stab", "Zerg"], "wvw", id(1), 1],
  ["Power Dragonhunter (GvG)", "Guardian", ["Power", "Burst", "GvG"], "wvw", id(4), 2],
  ["Boon Scrapper", "Engineer", ["Quickness", "Cleanse", "Zerg"], "wvw", id(1), 3],
  ["Condi Reaper", "Necromancer", ["Condi", "Pressure", "Havoc"], "wvw", id(2), 4],
  ["Scourge Bomb", "Necromancer", ["Condi", "Bomb", "Zerg"], "wvw", id(1), 5],
  ["Heal Tempest", "Elementalist", ["Heal", "Auras", "Zerg"], "wvw", id(1), 6],
  ["Cele Weaver Roamer", "Elementalist", ["Cele", "Sustain", "Roam"], "wvw", id(3), 7],
  ["Boon Chronomancer", "Mesmer", ["Quickness", "Pulls", "GvG"], "wvw", id(4), 8],
  ["Power Soulbeast", "Ranger", ["Power", "Pick", "Roam"], "wvw", id(3), 9],
  ["Mirage Roamer", "Mesmer", ["Condi", "Mobility", "Roam"], "wvw", id(3), 10],
  ["Spellbreaker", "Warrior", ["Power", "Strip", "GvG"], "wvw", id(4), 11],
  ["Daredevil Roamer", "Thief", ["Power", "+1", "Roam"], "wvw", id(3), 12],
  ["Vindicator (Havoc)", "Revenant", ["Power", "Burst", "Havoc"], "wvw", id(2), 13],
  ["Herald Boon", "Revenant", ["Boon DPS", "Frontline", "GvG"], "wvw", id(4), 14],
];

const buildEntries = BUILDS.map(([title, profession, tags, gameMode, folderId, n]) => ({
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
  pinned: n <= 2,
}));

const compSlot = (buildId, role) => ({ buildId, role });
const compLine = (capacity, ...slots) => ({
  id: id(900 + Math.floor(Math.random() * 99)),
  capacity,
  slots: slots.map((s) => (typeof s === "string" ? compSlot(s, "") : s)),
});

const COMPS = [
  {
    id: id(50),
    name: "Zerg Frontline 25",
    notes: "5x Heal FB · 5x Scourge Bomb · 5x Scrapper · 5x Tempest · 5x Spellbreaker",
    tags: ["Zerg", "Frontline"],
    folderId: null,
    sortOrder: 0,
    buildIds: [id(101), id(105), id(103), id(106), id(111)],
    gameMode: "wvw",
    partyLines: [
      compLine(5,
        { buildId: id(101), role: "Heal FB" },
        { buildId: id(105), role: "Scourge Bomb" },
        { buildId: id(103), role: "Boon Scrapper" },
        { buildId: id(106), role: "Heal Tempest" },
        { buildId: id(111), role: "Spellbreaker" }
      ),
      compLine(5,
        { buildId: id(101), role: "Heal FB" },
        { buildId: id(105), role: "Scourge Bomb" },
        { buildId: id(103), role: "Boon Scrapper" },
        { buildId: id(106), role: "Heal Tempest" },
        { buildId: id(111), role: "Spellbreaker" }
      ),
    ],
    createdAt: isoDaysAgo(15),
    updatedAt: isoDaysAgo(2),
  },
  {
    id: id(51),
    name: "GvG 15v15",
    notes: "Power Dragonhunter spike + Chrono pulls + Herald boons + Spellbreaker rip",
    tags: ["GvG", "Roster"],
    folderId: null,
    sortOrder: 1,
    buildIds: [id(102), id(108), id(114), id(111), id(101)],
    gameMode: "wvw",
    partyLines: [
      compLine(5,
        { buildId: id(101), role: "Heal FB" },
        { buildId: id(102), role: "Power DH" },
        { buildId: id(108), role: "Chrono Pulls" },
        { buildId: id(114), role: "Herald Boon" },
        { buildId: id(111), role: "Spellbreaker" }
      ),
      compLine(5,
        { buildId: id(101), role: "Heal FB" },
        { buildId: id(102), role: "Power DH" },
        { buildId: id(108), role: "Chrono Pulls" },
        { buildId: id(114), role: "Herald Boon" },
        { buildId: id(111), role: "Spellbreaker" }
      ),
      compLine(5,
        { buildId: id(101), role: "Heal FB" },
        { buildId: id(102), role: "Power DH" },
        { buildId: id(108), role: "Chrono Pulls" },
        { buildId: id(114), role: "Herald Boon" },
        { buildId: id(111), role: "Spellbreaker" }
      ),
    ],
    createdAt: isoDaysAgo(40),
    updatedAt: isoDaysAgo(5),
  },
  {
    id: id(52),
    name: "Havoc Squad",
    notes: "5-man pick group — Vindi spike, Condi Reaper pressure, Daredevil +1",
    tags: ["Havoc"],
    folderId: null,
    sortOrder: 2,
    buildIds: [id(113), id(104), id(112), id(101), id(108)],
    gameMode: "wvw",
    partyLines: [
      compLine(5,
        { buildId: id(101), role: "Heal FB" },
        { buildId: id(113), role: "Vindicator" },
        { buildId: id(104), role: "Condi Reaper" },
        { buildId: id(112), role: "Daredevil" },
        { buildId: id(108), role: "Boon Chrono" }
      ),
    ],
    createdAt: isoDaysAgo(8),
    updatedAt: isoDaysAgo(1),
  },
];

// Read the *actual* current version from package.json so lastSeenVersion
// always matches — the What's New modal compares strict equality and opens
// whenever they differ. Match exactly to suppress it.
const APP_VERSION = require("../package.json").version;

const SETTINGS = {
  lastSeenVersion: APP_VERSION,
  "appearance.theme": "molten-core",
};

module.exports = { FOLDERS, BUILDS: buildEntries, COMPS, SETTINGS };
