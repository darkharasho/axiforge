"use strict";

/**
 * Pet environment filtering for the Ranger pet picker (issue #334).
 *
 * Land slots must offer terrestrial + amphibious pets; underwater slots must
 * offer aquatic + amphibious pets. Environments follow the wiki's pet taxonomy
 * (https://wiki.guildwars2.com/wiki/Pet#Taxonomy). The Siege Turtle is
 * terrestrial, but it was listed as aquatic and so disappeared from land slots.
 */

const { isPetAllowedInSlot } = require("../../../src/renderer/modules/constants.js");

const TERRESTRIAL = {
  66: "Siege Turtle",
  4: "Krytan Drakehound",
  3: "Lynx",
  70: "Warclaw",
  71: "Janthiri Bee",
};
const AQUATIC_ONLY = { 21: "Shark", 40: "Armor Fish", 41: "Blue Jellyfish", 42: "Red Jellyfish", 43: "Rainbow Jellyfish" };
const AMPHIBIOUS = {
  7: "Salamander Drake", 12: "Marsh Drake", 18: "Ice Drake", 19: "River Drake", 45: "Reef Drake",
  6: "Carrion Devourer", 26: "Whiptail Devourer", 27: "Lashtail Devourer",
  1: "Jungle Stalker", 9: "Snow Leopard", 11: "Jaguar", 47: "Tiger", 63: "White Tiger",
  5: "Brown Bear", 20: "Murellow", 23: "Black Bear", 24: "Polar Bear", 25: "Arctodus",
  73: "River Otter",
};

describe("isPetAllowedInSlot (#334)", () => {
  test.each(Object.entries(TERRESTRIAL))("terrestrial pet %s (%s) is land-only", (id) => {
    expect(isPetAllowedInSlot(Number(id), false)).toBe(true);
    expect(isPetAllowedInSlot(Number(id), true)).toBe(false);
  });

  test.each(Object.entries(AQUATIC_ONLY))("aquatic pet %s (%s) is underwater-only", (id) => {
    expect(isPetAllowedInSlot(Number(id), false)).toBe(false);
    expect(isPetAllowedInSlot(Number(id), true)).toBe(true);
  });

  test.each(Object.entries(AMPHIBIOUS))("amphibious pet %s (%s) is allowed in both", (id) => {
    expect(isPetAllowedInSlot(Number(id), false)).toBe(true);
    expect(isPetAllowedInSlot(Number(id), true)).toBe(true);
  });
});
