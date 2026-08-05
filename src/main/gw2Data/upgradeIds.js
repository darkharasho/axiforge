// Upgrade item IDs for GW2 API fetching.
// Runes, sigils, and relics are fully wiki-synced (block rewritten); food and
// utility are additively synced — the curated lower-tier entries are kept and
// only new Exotic/Ascended stat items get appended (marked "auto-added").
// Regenerate with:
//   node scripts/sync-upgrade-ids.mjs [relics|runes|sigils|food|utility]
// Infusions and enrichments remain fully hand-curated because the wiki
// categories don't cleanly map to the picker subset we want.

const RUNE_ITEM_IDS = [
  24687, // Superior Rune of the Afflicted
  24688, // Superior Rune of the Lich
  24691, // Superior Rune of the Traveler
  24696, // Superior Rune of the Flock
  24699, // Superior Rune of the Dolyak
  24702, // Superior Rune of the Pack
  24703, // Superior Rune of Infiltration
  24708, // Superior Rune of Mercy
  24711, // Superior Rune of Vampirism
  24714, // Superior Rune of Strength
  24717, // Superior Rune of Rage
  24720, // Superior Rune of Speed
  24723, // Superior Rune of the Eagle
  24726, // Superior Rune of Rata Sum
  24729, // Superior Rune of Hoelbrak
  24732, // Superior Rune of Divinity
  24735, // Superior Rune of the Grove
  24738, // Superior Rune of Scavenging
  24741, // Superior Rune of the Citadel
  24744, // Superior Rune of the Earth
  24747, // Superior Rune of the Fire
  24750, // Superior Rune of the Air
  24753, // Superior Rune of the Ice
  24756, // Superior Rune of the Ogre
  24757, // Superior Rune of the Undead
  24762, // Superior Rune of the Krait
  24765, // Superior Rune of Balthazar
  24768, // Superior Rune of Dwayna
  24771, // Superior Rune of Melandru
  24776, // Superior Rune of Lyssa
  24779, // Superior Rune of Grenth
  24782, // Superior Rune of the Privateer
  24785, // Superior Rune of the Golemancer
  24788, // Superior Rune of the Centaur
  24791, // Superior Rune of the Wurm
  24794, // Superior Rune of Svanir
  24797, // Superior Rune of the Flame Legion
  24800, // Superior Rune of the Elementalist
  24803, // Superior Rune of the Mesmer
  24806, // Superior Rune of the Necromancer
  24812, // Superior Rune of the Engineer
  24815, // Superior Rune of the Ranger
  24818, // Superior Rune of the Thief
  24821, // Superior Rune of the Warrior
  24824, // Superior Rune of the Guardian
  24827, // Superior Rune of the Trooper
  24830, // Superior Rune of the Adventurer
  24833, // Superior Rune of the Brawler
  24836, // Superior Rune of the Scholar
  24839, // Superior Rune of the Water
  24842, // Superior Rune of the Monk
  24845, // Superior Rune of the Aristocracy
  24848, // Superior Rune of the Nightmare
  24851, // Superior Rune of the Forgeman
  24854, // Superior Rune of the Baelfire
  24857, // Superior Rune of Sanctuary
  24860, // Superior Rune of Orr
  36044, // Superior Rune of the Mad King
  38206, // Superior Rune of Altruism
  44951, // Superior Rune of Exuberance
  44956, // Superior Rune of Tormenting
  44957, // Superior Rune of Perplexity
  47908, // Superior Rune of the Sunless
  48907, // Superior Rune of Antitoxin
  49460, // Superior Rune of Resistance
  67339, // Superior Rune of the Trapper
  67342, // Superior Rune of Radiance
  67344, // Superior Rune of Evasion
  67912, // Superior Rune of the Defender
  68437, // Superior Rune of Snowfall
  69370, // Superior Rune of the Revenant
  70450, // Superior Rune of the Druid
  70600, // Superior Rune of Leadership
  70829, // Superior Rune of the Reaper
  71276, // Superior Rune of the Scrapper
  71425, // Superior Rune of the Berserker
  72852, // Superior Rune of the Daredevil
  72912, // Superior Rune of Thorns
  73399, // Superior Rune of the Chronomancer
  73653, // Superior Rune of Durability
  74978, // Superior Rune of the Dragonhunter
  76100, // Superior Rune of the Herald
  76166, // Superior Rune of the Tempest
  76813, // Superior Rune of Surging
  81091, // Superior Rune of Nature's Bounty
  82633, // Superior Rune of the Holosmith
  82791, // Superior Rune of the Deadeye
  83338, // Superior Rune of the Firebrand
  83367, // Superior Rune of the Cavalier
  83423, // Superior Rune of the Weaver
  83502, // Superior Rune of the Renegade
  83663, // Superior Rune of the Scourge
  83964, // Superior Rune of the Soulbeast
  84127, // Superior Rune of the Mirage
  84171, // Superior Rune of the Rebirth
  84749, // Superior Rune of the Spellbreaker
  85713, // Superior Rune of the Stars
  88118, // Superior Rune of the Zephyrite
  89999, // Superior Rune of Fireworks
];

const SIGIL_ITEM_IDS = [
  24548, // Superior Sigil of Fire
  24551, // Superior Sigil of Water
  24554, // Superior Sigil of Air
  24555, // Superior Sigil of Ice
  24560, // Superior Sigil of Earth
  24561, // Superior Sigil of Rage
  24562, // Superior Sigil of Strength
  24567, // Superior Sigil of Frailty
  24570, // Superior Sigil of Blood
  24571, // Superior Sigil of Purity
  24572, // Superior Sigil of Nullification
  24575, // Superior Sigil of Bloodlust
  24578, // Superior Sigil of Corruption
  24580, // Superior Sigil of Perception
  24582, // Superior Sigil of Life
  24583, // Superior Sigil of Demons
  24584, // Superior Sigil of Benevolence
  24589, // Superior Sigil of Speed
  24591, // Superior Sigil of Luck
  24592, // Superior Sigil of Stamina
  24594, // Superior Sigil of Restoration
  24597, // Superior Sigil of Hydromancy
  24599, // Superior Sigil of Leeching
  24600, // Superior Sigil of Vision
  24601, // Superior Sigil of Battle
  24605, // Superior Sigil of Geomancy
  24607, // Superior Sigil of Energy
  24609, // Superior Sigil of Doom
  24612, // Superior Sigil of Agony
  24615, // Superior Sigil of Force
  24618, // Superior Sigil of Accuracy
  24621, // Superior Sigil of Peril
  24624, // Superior Sigil of Smoldering
  24627, // Superior Sigil of Hobbling
  24630, // Superior Sigil of Chilling
  24632, // Superior Sigil of Venom
  24636, // Superior Sigil of Debility
  24639, // Superior Sigil of Paralyzation
  24642, // Superior Sigil of Undead Slaying
  24645, // Superior Sigil of Centaur Slaying
  24648, // Superior Sigil of Grawl Slaying
  24651, // Superior Sigil of Icebrood Slaying
  24654, // Superior Sigil of Destroyer Slaying
  24655, // Superior Sigil of Ogre Slaying
  24658, // Superior Sigil of Serpent Slaying
  24661, // Superior Sigil of Elemental Slaying
  24664, // Superior Sigil of Demon Slaying
  24667, // Superior Sigil of Wrath
  24672, // Superior Sigil of Mad Scientists
  24675, // Superior Sigil of Smothering
  24678, // Superior Sigil of Justice
  24681, // Superior Sigil of Dreams
  24684, // Superior Sigil of Sorrow
  24809, // Superior Sigil of Ghost Slaying
  24865, // Superior Sigil of Celerity
  24868, // Superior Sigil of Impact
  36053, // Superior Sigil of the Night
  37912, // Superior Sigil of Karka Slaying
  38294, // Superior Sigil of Generosity
  44944, // Superior Sigil of Bursting
  44947, // Superior Sigil of Renewal
  44950, // Superior Sigil of Malice
  48911, // Superior Sigil of Torment
  49457, // Superior Sigil of Momentum
  67340, // Superior Sigil of Cleansing
  67341, // Superior Sigil of Cruelty
  67343, // Superior Sigil of Incapacitation
  67913, // Superior Sigil of Blight
  68436, // Superior Sigil of Mischief
  70825, // Superior Sigil of Draining
  71130, // Superior Sigil of Ruthlessness
  72092, // Superior Sigil of Agility
  72339, // Superior Sigil of Concentration
  72872, // Superior Sigil of Absorption
  73532, // Superior Sigil of Rending
  74326, // Superior Sigil of Transference
  81045, // Superior Sigil of Bounty
  82876, // Superior Sigil of Frenzy
  84505, // Superior Sigil of Severance
  86170, // Superior Sigil of the Stars
  91339, // Superior Sigil of Hologram Slaying
];

const INFUSION_ITEM_IDS = [
  // Pure stat infusions (no AR)
  39335, 39336, 39337, 39338, 39339, 39340,
  // Agony Infusions (+1 through +24 AR)
  49424, 49425, 49426, 49427, 49428, 49429, 49430, 49431, 49432,
  49433, 49434, 49435, 49436, 49437, 49438, 49439, 49440, 49441,
  49442, 49443, 49444, 49445, 49446, 49447,
  // Stat + AR combo infusions (+5 AR tier)
  39616, 39617, 39618, 39619, 39620, 39621, 85971,
  // Stat + AR combo infusions (+7 AR tier)
  37123, 37127, 37128, 37129, 37133, 37134, 85881, 86150,
  // Stat + AR combo infusions (+9 AR tier)
  37125, 37130, 37131, 37132, 37135, 37136, 86113, 86180,
  // Simple infusions
  37137, 37138,
  // WvW stat infusions (also listed in WVW_INFUSION_IDS below)
  43250, 43251, 43252, 43253, 43254, 43255, 86986, 87218,
];

const WVW_INFUSION_IDS = new Set([43250, 43251, 43252, 43253, 43254, 43255, 86986, 87218]);

const ENRICHMENT_ITEM_IDS = [
  39330, 39331, 39332, 39333,  // Core enrichments (XP, Gold, Karma, MF)
  79926,                        // Koda's Warmth Enrichment
  87398, 87417,                 // WvW enrichments
  93798, 93953,                 // Otter's Blessing, Birthday
  101126, 101187, 101193, 101250, 101272, 101302, // Wurm's enrichments
];

const FOOD_ITEM_IDS = [
  8496, 8497, 8499, 8500, 8503, 8504, 8505, 8507, 8510, 8517,
  8518, 8519, 8520, 8521, 8525, 8527, 8530, 8531, 8535, 8537,
  8540, 8543, 8544, 8545, 8548, 8554, 8557, 8558, 8559, 8560,
  8561, 8562, 8563, 8564, 8565, 8566, 8570, 8572, 8573, 8575,
  8577, 8580, 8581, 8582, 8584, 8585, 8587, 8595, 8601, 8605,
  8607, 8608, 8611, 8612, 8613, 8614, 8615, 8616, 8617, 8618,
  8622, 8623, 8626, 8628, 8629, 8632, 8633, 8634, 8638, 12129,
  12130, 12131, 12132, 12133, 12139, 12140, 12145, 12146, 12148, 12149,
  12150, 12154, 12160, 12182, 12184, 12185, 12186, 12187, 12188, 12190,
  12191, 12192, 12194, 12195, 12196, 12198, 12199, 12200, 12201, 12202,
  12203, 12204, 12205, 12206, 12207, 12208, 12209, 12210, 12211, 12212,
  12213, 12214, 12215, 12216, 12217, 12218, 12221, 12222, 12223, 12224,
  12225, 12227, 12230, 12233, 12264, 12273, 12279, 12280, 12281, 12282,
  12283, 12284, 12285, 12286, 12287, 12288, 12289, 12290, 12291, 12292,
  12293, 12294, 12295, 12296, 12297, 12298, 12299, 12300, 12301, 12302,
  12303, 12304, 12305, 12306, 12307, 12308, 12309, 12311, 12313, 12314,
  12315, 12316, 12317, 12318, 12319, 12320, 12322, 12323, 12343, 12344,
  12345, 12346, 12347, 12348, 12349, 12352, 12353, 12354, 12355, 12356,
  12357, 12358, 12359, 12360, 12361, 12362, 12363, 12364, 12365, 12366,
  12367, 12368, 12369, 12370, 12371, 12372, 12373, 12374, 12375, 12376,
  12377, 12378, 12379, 12380, 12381, 12382, 12383, 12384, 12385, 12386,
  12387, 12388, 12389, 12390, 12391, 12392, 12393, 12394, 12395, 12396,
  12397, 12398, 12399, 12400, 12401, 12402, 12403, 12404, 12405, 12406,
  12407, 12408, 12409, 12410, 12411, 12412, 12413, 12414, 12415, 12416,
  12417, 12418, 12419, 12420, 12421, 12422, 12423, 12424, 12425, 12426,
  12427, 12428, 12429, 12430, 12431, 12432, 12433, 12434, 12435, 12436,
  12437, 12438, 12439, 12440, 12441, 12442, 12443, 12444, 12445, 12446,
  12447, 12448, 12449, 12450, 12451, 12452, 12453, 12454, 12455, 12456,
  12457, 12458, 12459, 12460, 12461, 12462, 12463, 12464, 12465, 12466,
  12467, 12468, 12469, 12470, 12471, 12472, 12473, 12474, 12475, 12476,
  12477, 12478, 12479, 12480, 12481, 12482, 12483, 12484, 12485, 12486,
  12487, 12488, 12489, 12490, 12491, 12522, 12548, 12549, 12729, 12730,
  12731, 12732, 12733, 12734, 12735, 12736, 12737, 12738, 12739, 36073,
  36074, 36075, 36076, 36077, 36078, 36079, 36080, 36081, 36082, 36083,
  36084, 36724, 36740, 36753, 36767, 36777, 36782, 36793, 36803, 36817,
  36821, 36828, 36835, 36841, 38210, 38211, 38212, 38213, 38214, 38215,
  38308, 41561, 41562, 41563, 41564, 41565, 41566, 41567, 41568, 41569,
  43358, 43359, 43360, 43361, 43362, 43363, 43550, 48921, 66221, 66523,
  66526, 66527, 66528, 66529, 66530, 66531, 66536, 66538, 66539, 68632,
  68633, 68634, 68635, 68636, 70496, 71299, 71797, 71826, 71940, 72480,
  72575, 72664, 72742, 72761, 73221, 73351, 73409, 73570, 73752, 73788,
  74239, 74385, 74568, 74621, 74777, 74969, 75010, 75053, 75126, 75154,
  75567, 76103, 76135, 76302, 76359, 76388, 76415, 76603, 76840, 76944,
  77579, 77630, 77643, 78129, 78137, 78167, 78170, 78197, 78214, 78215,
  78236, 78247, 78283, 78320, 78327, 78339, 78365, 78385, 78424, 78450,
  78456, 78457, 78462, 78480, 78483, 78495, 78498, 78506, 78509, 78514,
  78528, 78568, 78588, 78609, 78612, 78630, 78655, 78662, 78663, 78700,
  79488, 79541, 79748, 79776, 79786, 79793, 81615, 81621, 81660, 81786,
  81799, 81867, 82030, 82541, 82642, 83345, 83622, 83955, 84550, 86997,
  87029, 87076, 87367, 89002, 89181, 91689, 91690, 91698, 91703, 91704,
  91705, 91709, 91711, 91713, 91718, 91723, 91727, 91729, 91732, 91734,
  91735, 91736, 91737, 91742, 91743, 91746, 91748, 91753, 91754, 91756,
  91758, 91761, 91766, 91769, 91770, 91771, 91775, 91780, 91784, 91790,
  91794, 91797, 91798, 91801, 91804, 91805, 91806, 91809, 91822, 91823,
  91834, 91835, 91837, 91839, 91841, 91842, 91847, 91848, 91851, 91855,
  91858, 91862, 91864, 91865, 91867, 91876, 91878, 91917, 91950, 91954,
  92078, 95277, 95421, 95520, 95556, 95847, 95942, 96285, 96578, 96707,
  96793, 96898, 96916, 97200, 97282, 97422, 97472, 97592, 97767, 97771,
  97826, 98924, 99785, 99794, 99804, 105402,
  107101, // New Year Rice Cake (auto-added)
  109776, // Elder Draco-Pop (auto-added)
];

// Utility consumables (sharpening stones, maintenance oils, tuning crystals, writs, etc.)
// Sourced from wiki.guildwars2.com/wiki/Utility_item/list — personal consumables only.
const UTILITY_ITEM_IDS = [
  9431, 9433, 9436, 9438, 9440, 9443, 9452, 9453, 9456, 9458,
  9460, 9461, 9464, 9467, 9469, 9472, 9473, 9476, 42428, 43449,
  43450, 43451, 48915, 48916, 48917, 50083, 67183, 67184, 67185, 67367,
  67368, 67371, 67522, 67524, 67528, 67529, 67530, 67531, 70883, 71514,
  71691, 71928, 72048, 72291, 72510, 72563, 72572, 72807, 72813, 72821,
  73191, 73286, 73595, 74920, 75051, 75610, 76478, 76833, 77128, 77567,
  77569, 77632, 78116, 78219, 78695, 81034, 81079, 81157, 86016, 86287,
  86378, 87329, 87336, 87358, 89157, 89203, 93241, 97977, 98893, 99842,
  99845, 101651, 101666, 102135, 106880, 108839,
];

const RELIC_ITEM_IDS = [
  99965, // Relic of the Flock
  99997, // Relic of Isgarren
  100031, // Relic of the Monk
  100048, // Relic of the Ice
  100063, // Relic of Surging
  100074, // Relic of Cerus
  100090, // Relic of the Dragonhunter
  100115, // Relic of Mabon
  100144, // Relic of the Warrior
  100148, // Relic of Speed
  100153, // Relic of the Fractal
  100158, // Relic of the Mirage
  100177, // Relic of Peitha
  100194, // Relic of the Weaver
  100219, // Relic of the Herald
  100230, // Relic of the Krait
  100238, // Relic of the Lich
  100311, // Relic of the Ogre
  100345, // Relic of the Daredevil
  100368, // Relic of the Scourge
  100385, // Relic of the Centaur
  100388, // Relic of the Astral Ward
  100390, // Relic of Antitoxin
  100400, // Relic of the Sunless
  100403, // Relic of the Golemancer
  100411, // Relic of the Trooper
  100429, // Relic of Mercy
  100432, // Relic of Akeem
  100435, // Relic of the Earth
  100442, // Relic of Dwayna (relic)
  100448, // Relic of the Citadel
  100450, // Relic of the Chronomancer
  100453, // Relic of the Firebrand
  100455, // Relic of Durability
  100461, // Relic of Lyhr
  100479, // Relic of the Privateer
  100527, // Relic of the Brawler
  100542, // Relic of the Cavalier
  100557, // Relic of the Wizard's Tower
  100561, // Relic of the Adventurer
  100579, // Relic of the Nightmare
  100580, // Relic of the Necromancer
  100614, // Relic of Evasion
  100625, // Relic of Leadership
  100659, // Relic of the Water
  100676, // Relic of Vampirism
  100693, // Relic of the Afflicted
  100694, // Relic of the Unseen Invasion
  100739, // Relic of the Reaper
  100752, // Relic of the Pack
  100775, // Relic of Vass
  100794, // Relic of Resistance
  100849, // Relic of the Aristocracy
  100893, // Relic of the Zephyrite
  100908, // Relic of the Holosmith
  100916, // Relic of the Thief
  100924, // Relic of the Deadeye
  100934, // Relic of the Defender
  100942, // Relic of Dagda
  100947, // Relic of Fireworks
  101116, // Relic of Febe
  101139, // Relic of the Midnight King
  101166, // Relic of the Demon Queen
  101191, // Relic of Nourys
  101198, // Relic of Nayos
  101268, // Relic of Karakosa
  101737, // Relic of the Founding
  101767, // Relic of the Twin Generals
  101801, // Relic of Mosyn
  101863, // Relic of the Sorcerer
  101943, // Relic of the Wayfinder
  101955, // Relic of Zakiros
  102199, // Relic of the Blightbringer
  102245, // Relic of Atrocity
  102595, // Relic of the Stormsinger
  103015, // Relic of Rivers
  103424, // Relic of Sorrow
  103574, // Relic of the Claw
  103763, // Relic of Geysers
  103872, // Relic of Mount Balrior
  103901, // Relic of the Mists Tide
  103977, // Relic of the Beehive
  103984, // Relic of Reunification
  104022, // Relic of the Steamshrieker
  104241, // Relic of the Eagle
  104256, // Relic of Altruism
  104424, // Relic of Thorns
  104501, // Relic of Fire
  104733, // Relic of the Phenom
  104800, // Relic of Bloodstone
  104848, // Relic of Bava Nisos
  104849, // Relic of Agony
  104938, // Relic of the Living City
  104994, // Relic of Mistburn
  105585, // Relic of the First Revenant
  105652, // Relic of Castora
  106206, // Relic of the Mist Stranger
  106221, // Relic of the Pirate Queen
  106355, // Relic of the Scoundrel
  106364, // Relic of the Biomancer
  106916, // Relic of Shackles
  106920, // Relic of the Nautical Beast
  107030, // Relic of Fog
  107061, // Relic of the Coral Heart
  107124, // Relic of the Forest Dweller
  107192, // Relic of the Alliance
  109264, // Relic of Galdra
  109267, // Relic of the Sacred Grounds
  109351, // Relic of the Director
  109522, // Relic of the Doyen
  109664, // Relic of the Cruel Overseer
  109709, // Relic of Watch
];

module.exports = { RUNE_ITEM_IDS, SIGIL_ITEM_IDS, INFUSION_ITEM_IDS, WVW_INFUSION_IDS, ENRICHMENT_ITEM_IDS, FOOD_ITEM_IDS, UTILITY_ITEM_IDS, RELIC_ITEM_IDS };
