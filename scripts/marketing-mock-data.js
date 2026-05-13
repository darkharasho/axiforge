/**
 * Mock data for marketing screenshots. Pre-seeded into the e2e profile's
 * data directory so the library/comps pages look lived-in.
 */

const now = Date.now();
const isoDaysAgo = (d) => new Date(now - d * 86400_000).toISOString();
const id = (n) => `mock-${n.toString(36).padStart(6, "0")}`;

const FOLDERS = [
  { id: id(1), name: "Raid", parentId: null, shared: false, createdAt: isoDaysAgo(45), updatedAt: isoDaysAgo(2) },
  { id: id(2), name: "Strikes", parentId: null, shared: false, createdAt: isoDaysAgo(30), updatedAt: isoDaysAgo(1) },
  { id: id(3), name: "Open World", parentId: null, shared: false, createdAt: isoDaysAgo(60), updatedAt: isoDaysAgo(5) },
  { id: id(4), name: "WvW", parentId: null, shared: false, createdAt: isoDaysAgo(20), updatedAt: isoDaysAgo(3) },
];

const BUILDS = [
  ["Quickness Firebrand", "Guardian", ["Quickness", "Boon DPS", "Raid"], "pve", id(1), 1],
  ["Power Dragonhunter", "Guardian", ["Power", "DPS", "Raid"], "pve", id(1), 2],
  ["Condi Scourge", "Necromancer", ["Condi", "DPS", "Raid"], "pve", id(1), 3],
  ["Heal Scourge", "Necromancer", ["Heal", "Support", "Strike"], "pve", id(2), 4],
  ["Alacrity Mechanist", "Engineer", ["Alacrity", "Boon DPS"], "pve", id(2), 5],
  ["Heal Tempest", "Elementalist", ["Heal", "Aura"], "pve", id(1), 6],
  ["Power Weaver", "Elementalist", ["Power", "DPS"], "pve", id(3), 7],
  ["Boon Chronomancer", "Mesmer", ["Quickness", "Alacrity"], "pve", id(2), 8],
  ["Power Soulbeast", "Ranger", ["Power", "DPS", "Burst"], "pve", id(3), 9],
  ["Condi Virtuoso", "Mesmer", ["Condi", "DPS"], "pve", id(2), 10],
  ["Spellbreaker", "Warrior", ["Power", "Strip", "Roaming"], "wvw", id(4), 11],
  ["Daredevil Roamer", "Thief", ["Power", "Mobility"], "wvw", id(4), 12],
  ["Vindicator", "Revenant", ["Power", "DPS"], "pve", id(3), 13],
  ["Renegade Alacrity", "Revenant", ["Alacrity", "Boon"], "pve", id(1), 14],
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

const COMPS = [
  { id: id(50), name: "Sabir CM", description: "Spirits, Quick FB, Alac Mech, Power DH x2", createdAt: isoDaysAgo(15), updatedAt: isoDaysAgo(2) },
  { id: id(51), name: "Wing 7 Sloth", description: "Heal Scourge, Quick FB, Alac Ren, Condi DPS x2", createdAt: isoDaysAgo(40), updatedAt: isoDaysAgo(5) },
];

const SETTINGS = {
  lastSeenVersion: "99.99.99",
  "appearance.theme": "molten-core",
};

module.exports = { FOLDERS, BUILDS: buildEntries, COMPS, SETTINGS };
