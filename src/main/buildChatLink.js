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
  const weapons = weaponSlots
    .map((slot) => build.equipment?.weapons?.[slot])
    .filter((w) => w && typeof w === "string" && w.trim() !== "");

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
      Number(pets.terrestrial1) || 0,
      Number(pets.terrestrial2) || 0,
      Number(pets.aquatic1) || 0,
      Number(pets.aquatic2) || 0,
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
async function generateChatLink(build) {
  const { encodeBuildTemplate, DefaultGw2ApiClient } = await import("gw2buildlink");
  const input = mapBuildToTemplateInput(build);
  const api = new DefaultGw2ApiClient();
  return encodeBuildTemplate(input, { api });
}

module.exports = { generateChatLink, mapBuildToTemplateInput };
