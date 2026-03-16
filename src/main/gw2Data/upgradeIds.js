// Curated upgrade item IDs for GW2 API fetching.
// All Exotic-rarity Superior Runes/Sigils (unique icons), plus Infusions and Enrichments.

const RUNE_ITEM_IDS = [
  // Classic Superior Runes (Exotic)
  24687, 24688, 24691, 24696, 24699, 24702, 24703, 24708, 24711, 24714,
  24717, 24720, 24723, 24726, 24729, 24732, 24735, 24738, 24741, 24744,
  24747, 24750, 24753, 24756, 24757, 24762, 24765, 24768, 24771, 24776,
  24779, 24782, 24785, 24788, 24791, 24794, 24797, 24800, 24803, 24806,
  24812, 24815, 24818, 24821, 24824, 24827, 24830, 24833, 24836, 24839,
  24842, 24845, 24848, 24851, 24854, 24857, 24860, // Monk, Aristocracy, Nightmare, Forgeman, Baelfire, Sanctuary, Orr
  // Festival / LW1 era
  36044, 38206, 47908, 49460, // Mad King, Altruism, Sunless, Resistance
  // HoT / PoF / LW era
  44951, 44956, 44957, 67339, 67342, 67344, 67912, // +Defender
  68437, 69370, 70450, 70600, 70829, 71276, 71425, // +Revenant, Druid, Reaper, Scrapper
  72852, 72912, 73399, 73653, 74978, 76100, 76166, 76813, // +Thorns, Durability, Herald, Surging
  // PoF elite spec runes
  81091, 82633, 82791, 83338, 83367, 83423, 83502, 83663, 83964, // Nature's Bounty, Holosmith, Deadeye, Firebrand, Cavalier, Weaver, Renegade, Scourge, Soulbeast
  84127, 84171, 84749, 85713, // Mirage, Rebirth, Spellbreaker, Stars
  // IBS / Festival
  88118, 89999, // Zephyrite, Fireworks
];

const SIGIL_ITEM_IDS = [
  // Classic Superior Sigils (Exotic)
  24548, 24551, 24554, 24555, 24560, 24561, 24562, 24567, 24570, 24571,
  24572, 24575, 24578, 24580, 24582, 24583, 24584, 24589, 24591, 24592,
  24594, 24597, 24599, 24600, 24601, 24605, 24607, 24609, 24612, 24615,
  24618, 24621, 24624, 24627, 24630, 24632, 24636, 24639, 24642, 24645,
  24648, 24651, 24654, 24655, 24658, 24661, 24664, 24667, 24672, 24675,
  24678, 24681, 24684, 24809, 24865, 24868, // +Celerity, Impact
  // Festival / LW1 era
  36053, 37912, 38294, // Night, Karka Slaying, Generosity
  // HoT / PoF / LW era
  44944, 44947, 44950, 48911, 49457, // Bursting, Renewal, Malice, Torment, Momentum
  67340, 67341, 67343, 67913, 68436, // Cleansing, Cruelty, Incapacitation, Blight, Mischief
  70825, 71130, 72092, 72339, 72872, 73532, 74326, // Draining, Ruthlessness, Agility, Concentration, Absorption, Rending, Transference
  81045, 82876, 84505, 86170, // Bounty, Frenzy, Severance, Stars
  91339, // Hologram Slaying (Exotic)
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
  86378, 87329, 87336, 87358, 89157, 89203, 93241, 97977, 99842, 99845,
  101651, 101666, 102135,
];

const RELIC_ITEM_IDS = [
  // SotO launch relics
  99997,  // Relic of Isgarren
  100031, // Relic of the Monk
  100048, // Relic of the Ice
  100063, // Relic of Surging
  100074, // Relic of Cerus
  100090, // Relic of the Dragonhunter
  100115, // Relic of Mabon
  100144, // Relic of the Warrior
  100148, // Relic of Speed
  100158, // Relic of the Mirage
  100165, // Relic of the Necromancer
  100177, // Relic of Peitha
  100194, // Relic of the Weaver
  100219, // Relic of the Herald
  100230, // Relic of the Krait
  100238, // Relic of the Lich
  100248, // Relic of the Citadel
  100262, // Relic of Fireworks
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
  100442, // Relic of Dwayna
  100450, // Relic of the Chronomancer
  100453, // Relic of the Firebrand
  100455, // Relic of Durability
  100461, // Relic of Lyhr
  100479, // Relic of the Privateer
  100527, // Relic of the Brawler
  100531, // Relic of the Water
  100542, // Relic of the Cavalier
  100557, // Relic of the Wizard's Tower
  100561, // Relic of the Adventurer
  100614, // Relic of Evasion
  100625, // Relic of Leadership
  100633, // Relic of the Flock
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
  // SotO updates
  101116, // Relic of Febe
  101139, // Relic of the Midnight King
  101166, // Relic of the Demon Queen
  101191, // Relic of Nourys
  101198, // Relic of Nayos
  101268, // Relic of Karakosa
  // Janthir Wilds
  101737, // Relic of the Founding
  101767, // Relic of the Twin Generals
  101801, // Relic of Mosyn
  101863, // Relic of the Sorcerer
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
  104928, // Relic of the Living City
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
];

module.exports = { RUNE_ITEM_IDS, SIGIL_ITEM_IDS, INFUSION_ITEM_IDS, WVW_INFUSION_IDS, ENRICHMENT_ITEM_IDS, FOOD_ITEM_IDS, UTILITY_ITEM_IDS, RELIC_ITEM_IDS };
