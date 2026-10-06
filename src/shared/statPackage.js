"use strict";

// Every equipment slot a stat combo can sit in. Mirrors the slot map in
// src/renderer/modules/state.js createEmptyEditor().
const STAT_SLOT_KEYS = [
  "head", "shoulders", "chest", "hands", "legs", "feet",
  "mainhand1", "offhand1", "mainhand2", "offhand2",
  "back", "amulet", "ring1", "ring2", "accessory1", "accessory2",
  "breather", "aquatic1", "aquatic2",
];

/**
 * Uniform imports (axicode, gw2skills) store one statPackage and leave every
 * slot empty. The editor has always shown that package in each slot, so a
 * record in that shape must read the same everywhere else -- publish, stats,
 * role estimation -- or the published page shows bare gear.
 *
 * Returns a new slots map: the package in every slot when all slots are empty,
 * otherwise the slots unchanged.
 *
 * @param {object} slots
 * @param {string} statPackage
 * @returns {object}
 */
function expandStatPackage(slots, statPackage) {
  const current = slots && typeof slots === "object" ? slots : {};
  if (!statPackage || Object.values(current).some(Boolean)) return current;
  return Object.fromEntries(STAT_SLOT_KEYS.map((key) => [key, statPackage]));
}

module.exports = { STAT_SLOT_KEYS, expandStatPackage };
