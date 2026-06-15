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
// Wrap global fetch with 429 retry handling for gw2buildlink's DefaultGw2ApiClient,
// which makes direct fetch() calls without rate-limit awareness.
const _origFetch = globalThis.fetch;
let _fetchPatched = false;
function patchFetchFor429() {
  if (_fetchPatched) return;
  _fetchPatched = true;
  globalThis.fetch = async function rateLimitedFetch(url, opts) {
    const isGw2 = typeof url === "string" && url.includes("api.guildwars2.com");
    if (!isGw2) return _origFetch(url, opts);
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await _origFetch(url, opts);
      if (res.status !== 429) return res;
      const wait = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
      await new Promise((r) => setTimeout(r, wait));
    }
    return _origFetch(url, opts); // final attempt — let it throw if still 429
  };
}

// Resolve name + icon for a set of trait/skill ids via the GW2 API (icons are the
// official render.guildwars2.com URLs — same source AxiForge uses everywhere).
// gw2buildlink's own helpers drop the icon, so we fetch directly here.
async function fetchNameIcons(kind, ids) {
  const map = new Map();
  const unique = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
  if (unique.length === 0) return map;
  try {
    for (let i = 0; i < unique.length; i += 150) {
      const chunk = unique.slice(i, i + 150);
      const res = await globalThis.fetch(
        `https://api.guildwars2.com/v2/${kind}?ids=${chunk.join(",")}&lang=en&v=latest`
      );
      if (!res.ok) continue;
      const arr = await res.json();
      for (const e of arr) map.set(e.id, { id: e.id, name: e.name, icon: e.icon || null });
    }
  } catch {
    /* network/parse failure → callers fall back to id-only data */
  }
  return map;
}

// The 5 weapon skills (slots 1-5) for an equipped weapon set, with name + icon.
// weaponTypes is the set's [mainhand, offhand] (offhand may be undefined / a 2H).
async function resolveWeaponSkills(professionId, weaponTypes) {
  const types = weaponTypes.filter(Boolean);
  if (types.length === 0) return [];
  const slotNum = { Weapon_1: 1, Weapon_2: 2, Weapon_3: 3, Weapon_4: 4, Weapon_5: 5 };
  try {
    const res = await globalThis.fetch(
      `https://api.guildwars2.com/v2/professions/${encodeURIComponent(professionId)}?v=latest`
    );
    if (!res.ok) return [];
    const prof = await res.json();
    const bySlot = {};
    for (const wt of types) {
      const w = prof.weapons?.[wt];
      for (const sk of w?.skills ?? []) {
        const n = slotNum[sk.slot];
        if (n && !bySlot[n]) bySlot[n] = sk.id; // mainhand fills 1-3, offhand 4-5
      }
    }
    const ids = [1, 2, 3, 4, 5].map((n) => bySlot[n]).filter(Boolean);
    const info = await fetchNameIcons("skills", ids);
    return ids.map((id) => info.get(id)).filter(Boolean);
  } catch {
    return [];
  }
}

// Singleton API client — profession/spec/skill data cached across all calls in the session.
let _gw2Api = null;
async function getApi() {
  if (!_gw2Api) {
    try {
      patchFetchFor429();
      const { DefaultGw2ApiClient } = await import("gw2buildlink");
      _gw2Api = new DefaultGw2ApiClient();
    } catch (err) {
      // Surface a silent import/fetch failure instead of hanging the decode.
      console.error("[buildChatLink] gw2buildlink client init failed:", err?.message || err);
      throw err;
    }
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

  const skills = mapSkillSet(decoded.skills?.terrestrial);
  const underwaterSkills = mapSkillSet(decoded.skills?.aquatic);

  // Enrich with name+icon so the build card can render selected traits and skills
  // with their official GW2 icons (resolved here in AxiForge, not the client).
  const traitIds = specializations.flatMap((s) => Object.values(s.majorChoices));
  const skillIds = [skills, underwaterSkills].flatMap((set) =>
    [set.heal, ...(set.utility ?? []), set.elite].filter(Boolean).map((s) => s.id)
  );
  const [traitInfo, skillInfo] = await Promise.all([
    fetchNameIcons("traits", traitIds),
    fetchNameIcons("skills", skillIds),
  ]);
  for (const spec of specializations) {
    spec.selectedTraits = [1, 2, 3]
      .map((tier) => spec.majorChoices[tier])
      .filter((id) => id > 0)
      .map((id) => traitInfo.get(id) || { id, name: null, icon: null });
  }
  const addSkillIcons = (set) => {
    const enrich = (s) => (s ? { ...s, icon: skillInfo.get(s.id)?.icon || null } : s);
    return { heal: enrich(set.heal), utility: (set.utility ?? []).map(enrich), elite: enrich(set.elite) };
  };

  // First terrestrial weapon set's skills (slots 1-5), for the card's top row.
  const weaponSkills = await resolveWeaponSkills(decoded.profession.id, [weapons.mainhand1, weapons.offhand1]);

  return {
    title: name,
    profession: decoded.profession.id,
    specializations,
    skills: addSkillIcons(skills),
    underwaterSkills: addSkillIcons(underwaterSkills),
    weaponSkills,
    equipment: { weapons },
    selectedLegends,
    selectedUnderwaterLegends,
    selectedPets,
    morphSkillIds: [0, 0, 0],
    chatCode: link,
    ...(folderId ? { folderId } : {}),
    ...(gameMode ? { gameMode } : {}),
  };
}

module.exports = { generateChatLink, prewarmChatLinks, previewChatLink, decodeChatLinkToBuild, mapBuildToTemplateInput };
