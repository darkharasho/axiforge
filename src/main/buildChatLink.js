/**
 * Parse a legend string like "Legend7" to its numeric code (7).
 * Returns undefined if empty or unparseable.
 */
function parseLegendCode(legendStr) {
  if (!legendStr) return undefined;
  const match = legendStr.match(/^Legend(\d+)$/i);
  return match ? Number(match[1]) : undefined;
}

/**
 * Map an axiforge build object to gw2buildlink's BuildTemplateInput.
 */
function mapBuildToTemplateInput(build) {
  // Specializations — always pad to exactly 3.
  const specs = Array.isArray(build.specializations) ? build.specializations : [];
  const specializations = [];
  for (let i = 0; i < 3; i++) {
    const spec = specs[i];
    if (!spec || spec.id == null) {
      specializations.push({ id: null });
    } else {
      specializations.push({
        id: Number(spec.id),
        traits: [
          spec.majorChoices?.[1] != null ? Number(spec.majorChoices[1]) : undefined,
          spec.majorChoices?.[2] != null ? Number(spec.majorChoices[2]) : undefined,
          spec.majorChoices?.[3] != null ? Number(spec.majorChoices[3]) : undefined,
        ],
      });
    }
  }

  // Skills — extract IDs from skill objects.
  const mapSkillSet = (skillData) => {
    if (!skillData) return { heal: undefined, utilities: [undefined, undefined, undefined], elite: undefined };
    const utilities = Array.isArray(skillData.utility)
      ? skillData.utility.slice(0, 3).map((s) => (s?.id != null ? Number(s.id) : undefined))
      : [undefined, undefined, undefined];
    while (utilities.length < 3) utilities.push(undefined);
    return {
      heal: skillData.heal?.id != null ? Number(skillData.heal.id) : undefined,
      utilities,
      elite: skillData.elite?.id != null ? Number(skillData.elite.id) : undefined,
    };
  };

  const skills = {
    terrestrial: mapSkillSet(build.skills),
    aquatic: mapSkillSet(build.underwaterSkills),
  };

  // Weapons — flatten object to array, filter empties.
  const weaponSlots = ["mainhand1", "offhand1", "mainhand2", "offhand2", "aquatic1", "aquatic2"];
  const KNOWN_WEAPONS = new Set([
    "axe","longbow","dagger","focus","greatsword","hammer","mace","pistol",
    "rifle","scepter","shield","staff","sword","torch","warhorn","shortbow","spear",
  ]);
  const weapons = weaponSlots
    .map((slot) => build.equipment?.weapons?.[slot])
    .filter((w) => w && typeof w === "string" && w.trim() !== "")
    .map((w) => w.toLowerCase())
    .filter((w) => KNOWN_WEAPONS.has(w));

  // Revenant legends — only for Revenant profession.
  const profLower = (build.profession || "").toLowerCase();
  let revenantLegends;
  if (profLower === "revenant") {
    const legends = build.selectedLegends || ["", ""];
    const uwLegends = build.selectedUnderwaterLegends || ["", ""];
    revenantLegends = [
      parseLegendCode(legends[0]),
      parseLegendCode(legends[1]),
      parseLegendCode(uwLegends[0]),
      parseLegendCode(uwLegends[1]),
    ];
  }

  // Ranger pets — only for Ranger profession.
  let rangerPets;
  if (profLower === "ranger") {
    const pets = build.selectedPets || {};
    rangerPets = [
      Number(pets.terrestrial1) || undefined,
      Number(pets.terrestrial2) || undefined,
      Number(pets.aquatic1) || undefined,
      Number(pets.aquatic2) || undefined,
    ];
  }

  return {
    profession: build.profession || "",
    specializations,
    skills,
    weapons: weapons.length > 0 ? weapons : undefined,
    revenantLegends,
    rangerPets,
  };
}

/**
 * Generate a GW2 in-game chat link string for the given axiforge build.
 * Requires internet — calls the GW2 API to resolve palette IDs.
 * @param {Object} build — serialized axiforge build object
 * @returns {Promise<string>} — the [&...] chat link
 */
// Singleton API client — profession/spec/skill data cached across all calls in the session.
let _gw2Api = null;
async function getApi() {
  if (!_gw2Api) {
    const { DefaultGw2ApiClient } = await import("gw2buildlink");
    _gw2Api = new DefaultGw2ApiClient();
  }
  return _gw2Api;
}

// Result cache — keyed by buildId, invalidated when updatedAt changes.
const _cache = new Map(); // Map<buildId, { updatedAt: string, link: string }>

/**
 * Generate a GW2 in-game chat link string for the given axiforge build.
 * Returns instantly from cache if the build hasn't changed since last generation.
 */
async function generateChatLink(build) {
  const cached = _cache.get(build.id);
  if (cached && cached.updatedAt === build.updatedAt) return cached.link;

  const { encodeBuildTemplate } = await import("gw2buildlink");
  const api = await getApi();
  const link = await encodeBuildTemplate(mapBuildToTemplateInput(build), { api });

  if (build.id) _cache.set(build.id, { updatedAt: build.updatedAt, link });
  return link;
}

/**
 * Pre-generate chat links for a list of builds in the background.
 * Runs sequentially so the shared API client can build up its internal cache
 * across profession lookups without redundant parallel requests.
 */
async function prewarmChatLinks(builds) {
  for (const build of builds) {
    const cached = _cache.get(build.id);
    if (cached && cached.updatedAt === build.updatedAt) continue;
    try {
      await generateChatLink(build);
    } catch {
      // skip — failures don't block the rest
    }
  }
}

async function previewChatLink(link) {
  const { decodeBuildTemplate } = await import("gw2buildlink");
  const api = await getApi();
  const decoded = await decodeBuildTemplate(link, { api });
  let eliteSpec = null;
  const thirdSpec = decoded.specializations?.[2];
  if (thirdSpec?.id) {
    const specData = await api.getSpecializationById(thirdSpec.id);
    if (specData.elite) {
      eliteSpec = thirdSpec.name || specData.name || null;
    }
  }
  return { profession: decoded.profession.id, eliteSpec };
}

async function decodeChatLinkToBuild(link, name, folderId, gameMode) {
  const { decodeBuildTemplate } = await import("gw2buildlink");
  const api = await getApi();
  const decoded = await decodeBuildTemplate(link, { api });

  const specEntries = decoded.specializations
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.id !== 0);
  const specializations = await Promise.all(
    specEntries.map(async ({ s, i }) => {
      let isElite = false;
      if (i === 2) {
        const specData = await api.getSpecializationById(s.id);
        isElite = !!specData.elite;
      }
      return {
        id: s.id,
        name: s.name,
        elite: isElite,
        majorChoices: {
          1: s.traits[0]?.traitId || 0,
          2: s.traits[1]?.traitId || 0,
          3: s.traits[2]?.traitId || 0,
        },
      };
    })
  );

  const mapSkillSet = (set) => ({
    heal: set?.heal?.skillId ? { id: set.heal.skillId, name: set.heal.name } : null,
    utility: (set?.utilities ?? []).map((u) =>
      u?.skillId ? { id: u.skillId, name: u.name } : null
    ),
    elite: set?.elite?.skillId ? { id: set.elite.skillId, name: set.elite.name } : null,
  });

  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const weaponSlotKeys = ["mainhand1", "offhand1", "mainhand2", "offhand2", "aquatic1", "aquatic2"];
  const weapons = {};
  (decoded.weapons ?? []).forEach((w, i) => {
    if (weaponSlotKeys[i] && w?.name) weapons[weaponSlotKeys[i]] = capitalize(w.name);
  });

  let selectedLegends = ["", ""];
  let selectedUnderwaterLegends = ["", ""];
  if (decoded.revenantLegends) {
    selectedLegends = [
      decoded.revenantLegends[0]?.code ? `Legend${decoded.revenantLegends[0].code}` : "",
      decoded.revenantLegends[1]?.code ? `Legend${decoded.revenantLegends[1].code}` : "",
    ];
    selectedUnderwaterLegends = [
      decoded.revenantLegends[2]?.code ? `Legend${decoded.revenantLegends[2].code}` : "",
      decoded.revenantLegends[3]?.code ? `Legend${decoded.revenantLegends[3].code}` : "",
    ];
  }

  let selectedPets = { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 };
  if (decoded.rangerPets) {
    selectedPets = {
      terrestrial1: decoded.rangerPets[0]?.id || 0,
      terrestrial2: decoded.rangerPets[1]?.id || 0,
      aquatic1: decoded.rangerPets[2]?.id || 0,
      aquatic2: decoded.rangerPets[3]?.id || 0,
    };
  }

  return {
    title: name,
    profession: decoded.profession.id,
    specializations,
    skills: mapSkillSet(decoded.skills?.terrestrial),
    underwaterSkills: mapSkillSet(decoded.skills?.aquatic),
    equipment: { weapons },
    selectedLegends,
    selectedUnderwaterLegends,
    selectedPets,
    morphSkillIds: [0, 0, 0],
    ...(folderId ? { folderId } : {}),
    ...(gameMode ? { gameMode } : {}),
  };
}

module.exports = { generateChatLink, prewarmChatLinks, previewChatLink, decodeChatLinkToBuild, mapBuildToTemplateInput };
