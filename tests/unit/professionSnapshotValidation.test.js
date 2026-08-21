"use strict";

/**
 * professions.json is loaded remote-first so balance-patch weapon changes (new
 * weapon-skill IDs, reworked bursts) reach shipped desktop builds without a
 * release. These guard the validators that gate that swap: a collapsed payload
 * must never replace the baked copy, and the baked copy must itself be valid.
 */

const {
  _validateProfessions: validateProfessions,
  _validateSpecializations: validateSpecializations,
} = require("../../src/main/gw2Data/catalog");
const bakedProfessions = require("../../src/main/gw2Data/professions.json");
const bakedSpecializations = require("../../src/main/gw2Data/specializations.json");

test("the baked snapshots pass validation", () => {
  expect(validateProfessions(bakedProfessions)).toBe(true);
  expect(validateSpecializations(bakedSpecializations)).toBe(true);
});

test("rejects a truncated or malformed professions payload", () => {
  expect(validateProfessions(null)).toBe(false);
  expect(validateProfessions([])).toBe(false);
  expect(validateProfessions(bakedProfessions.slice(0, 3))).toBe(false);
  // A profession that lost its weapons map would blank the whole weapon bar.
  const noWeapons = bakedProfessions.map((p) => ({ ...p, weapons: {} }));
  expect(validateProfessions(noWeapons)).toBe(false);
  // ...or its skills list, which drives every F-slot and utility picker.
  const noSkills = bakedProfessions.map((p) => ({ ...p, skills: [] }));
  expect(validateProfessions(noSkills)).toBe(false);
});

test("rejects a truncated or malformed specializations payload", () => {
  expect(validateSpecializations(null)).toBe(false);
  expect(validateSpecializations(bakedSpecializations.slice(0, 10))).toBe(false);
  expect(validateSpecializations(bakedSpecializations.map((s) => ({ ...s, id: 0 })))).toBe(false);
});

test("every weapon lists real skill IDs for slots 1-5", () => {
  // Regression guard for the 2026 sword rework: a stale snapshot pointed
  // Warrior/Thief Weapon_3 at deleted skill IDs, leaving the slot blank.
  for (const prof of bakedProfessions) {
    for (const [weapon, data] of Object.entries(prof.weapons || {})) {
      const where = `${prof.id}/${weapon}`;
      expect([where, Array.isArray(data.skills)]).toEqual([where, true]);
      for (const entry of data.skills) {
        expect([where, entry.slot]).toEqual([where, expect.stringMatching(/^Weapon_[1-5]$/)]);
        expect([where, Number.isInteger(entry.id) && entry.id > 0]).toEqual([where, true]);
      }
    }
  }
});
