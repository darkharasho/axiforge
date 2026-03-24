// Relic inner cooldown (ICD) overrides.
// The GW2 /v2/items endpoint does not expose internal cooldowns for relics.
// Values are sourced from the GW2 Wiki relic infobox templates.
// Format: Map<itemId, cooldownSeconds>
const RELIC_ICD_OVERRIDES = new Map([
  [100048,  30],    // Relic of the Ice
  [100063,  30],    // Relic of Surging
  [100074,  30],    // Relic of Cerus
  [100115,   2],    // Relic of Mabon
  [100158,   1],    // Relic of the Mirage
  [100177,   4],    // Relic of Peitha
  [100230,  30],    // Relic of the Krait
  [100238,  60],    // Relic of the Lich
  [100248,  30],    // Relic of the Citadel
  [100311,  60],    // Relic of the Ogre
  [100345,   1],    // Relic of the Daredevil
  [100368,   1],    // Relic of the Scourge
  [100385,  20],    // Relic of the Centaur
  [100400,  30],    // Relic of the Sunless
  [100403,  60],    // Relic of the Golemancer
  [100432,  10],    // Relic of Akeem
  [100435,  30],    // Relic of the Earth
  [100455,  15],    // Relic of Durability
  [100461,  15],    // Relic of Lyhr
  [100479,  60],    // Relic of the Privateer
  [100527,   8],    // Relic of the Brawler
  [100531,  20],    // Relic of the Water
  [100542,   1],    // Relic of the Cavalier
  [100557,  30],    // Relic of the Wizard's Tower
  [100561,  20],    // Relic of the Adventurer
  [100614,   1],    // Relic of Evasion
  [100625,  30],    // Relic of Leadership
  [100633,  10],    // Relic of the Flock
  [100676,  20],    // Relic of Vampirism
  [100693,  10],    // Relic of the Afflicted
  [100694,   5],    // Relic of the Unseen Invasion
  [100752,  30],    // Relic of the Pack
  [100775,  10],    // Relic of Vass
  [100794,  10],    // Relic of Resistance
  [100849,   1],    // Relic of the Aristocracy
  [100893,  30],    // Relic of the Zephyrite
  [100908,  30],    // Relic of the Holosmith
  [100934,   1],    // Relic of the Defender
  [100942,  30],    // Relic of Dagda
  [101116,  10],    // Relic of Febe
  [101139,   1],    // Relic of the Midnight King
  [101166,   1],    // Relic of the Demon Queen
  [101191,   0.25], // Relic of Nourys
  [101767,  10],    // Relic of the Twin Generals
  [101801,   1],    // Relic of Mosyn
  [101863,   1],    // Relic of the Sorcerer
  [102199,   8],    // Relic of the Blightbringer
  [102595,   3],    // Relic of the Stormsinger
  [103424,  30],    // Relic of Sorrow
  [103763,   5],    // Relic of Geysers
  [103872,  30],    // Relic of Mount Balrior
  [103977,  30],    // Relic of the Beehive
  [103984,  20],    // Relic of Reunification
  [104256,  20],    // Relic of Altruism
  [104424,   5],    // Relic of Thorns
  [104501,  20],    // Relic of Fire
  [104928,  30],    // Relic of the Living City
  [104994,   1],    // Relic of Mistburn
  [106916,  10],    // Relic of Shackles
  [107061,  20],    // Relic of the Coral Heart
  [107124,  30],    // Relic of the Forest Dweller
]);

module.exports = { RELIC_ICD_OVERRIDES };
