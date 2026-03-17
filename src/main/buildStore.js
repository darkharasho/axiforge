const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

class BuildStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.buildsPath = path.join(baseDir, "builds.json");
    this.authPath = path.join(baseDir, "auth.json");
    this.settingsPath = path.join(baseDir, "settings.json");
  }

  async init() {
    await fs.mkdir(this.baseDir, { recursive: true });
    await this.#ensureFile(this.buildsPath, []);
    await this.#ensureFile(this.authPath, {});
    await this.#ensureFile(this.settingsPath, {});
  }

  async listBuilds() {
    const data = await this.#readJson(this.buildsPath, []);
    if (!Array.isArray(data)) return [];
    return data.map((entry) => normalizeBuild(entry, entry?.createdAt));
  }

  async upsertBuild(input) {
    const builds = await this.listBuilds();
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    const next = normalizeBuild({ ...input, id, updatedAt: now }, input.createdAt || now);

    const idx = builds.findIndex((b) => b.id === id);
    if (idx >= 0) {
      next.createdAt = builds[idx].createdAt || next.createdAt;
      builds[idx] = next;
    } else {
      builds.push(next);
    }

    await this.#writeJson(this.buildsPath, builds);
    return next;
  }

  async deleteBuild(id) {
    const builds = await this.listBuilds();
    const filtered = builds.filter((b) => b.id !== id);
    await this.#writeJson(this.buildsPath, filtered);
  }

  async getAuth() {
    return this.#readJson(this.authPath, {});
  }

  async saveAuth(auth) {
    await this.#writeJson(this.authPath, auth || {});
  }

  async clearAuth() {
    await this.#writeJson(this.authPath, {});
  }

  async #ensureFile(filePath, fallback) {
    try {
      await fs.access(filePath);
    } catch {
      await this.#writeJson(filePath, fallback);
    }
  }

  async #readJson(filePath, fallback) {
    try {
      const text = await fs.readFile(filePath, "utf8");
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  async #writeJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  async getSetting(key) {
    const data = await this.#readJson(this.settingsPath, {});
    return data[key] ?? null;
  }

  async setSetting(key, value) {
    const data = await this.#readJson(this.settingsPath, {});
    data[key] = value;
    await this.#writeJson(this.settingsPath, data);
  }
}

function normalizeBuild(input, fallbackCreatedAt) {
  const createdAt = asIso(input.createdAt) || asIso(fallbackCreatedAt) || new Date().toISOString();
  const updatedAt = asIso(input.updatedAt) || new Date().toISOString();
  return {
    id: String(input.id || crypto.randomUUID()),
    version: 2,
    title: asString(input.title, 140) || "Untitled Build",
    profession: asString(input.profession || input.professionName, 80),
    specializations: normalizeSpecializations(input.specializations),
    skills: normalizeSkills(input.skills),
    underwaterSkills: normalizeSkills(input.underwaterSkills),
    equipment: normalizeEquipment(input.equipment),
    tags: normalizeTags(input.tags),
    notes: asString(input.notes, 12000),
    images: normalizeImages(input.images),
    createdAt,
    updatedAt,
    // Keep legacy fields for migration compatibility.
    buildUrl: asString(input.buildUrl, 500),
    gameMode: asString(input.gameMode, 10) || "pve",
    publishedSlug: asString(input.publishedSlug, 200),
    publishedFileId: asString(input.publishedFileId, 20),
    publishedKey: asString(input.publishedKey, 100),
    // Library organization fields
    folderId:
      typeof input.folderId === "string" ? input.folderId : null,
    pinned: Boolean(input.pinned),
    sortOrder:
      typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
        ? input.sortOrder
        : 0,
  };
}

function normalizeSpecializations(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((spec) => ({
    id: Number(spec?.id) || 0,
    name: asString(spec?.name, 100),
    elite: Boolean(spec?.elite),
    icon: asString(spec?.icon, 500),
    background: asString(spec?.background, 500),
    minorTraits: normalizeTraitRefs(spec?.minorTraits, 3),
    majorChoices: {
      1: Number(spec?.majorChoices?.[1]) || 0,
      2: Number(spec?.majorChoices?.[2]) || 0,
      3: Number(spec?.majorChoices?.[3]) || 0,
    },
    majorTraitsByTier: {
      1: normalizeTraitRefs(spec?.majorTraitsByTier?.[1], 3),
      2: normalizeTraitRefs(spec?.majorTraitsByTier?.[2], 3),
      3: normalizeTraitRefs(spec?.majorTraitsByTier?.[3], 3),
    },
  }));
}

function normalizeTraitRefs(value, max = 9) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((trait) => ({
    id: Number(trait?.id) || 0,
    name: asString(trait?.name, 120),
    icon: asString(trait?.icon, 500),
    description: asString(trait?.description, 500),
    tier: Number(trait?.tier) || 0,
  }));
}

function normalizeSkills(value) {
  const skills = value && typeof value === "object" ? value : {};
  return {
    heal: normalizeSkillRef(skills.heal),
    utility: Array.isArray(skills.utility)
      ? skills.utility.slice(0, 3).map((item) => normalizeSkillRef(item))
      : [null, null, null],
    elite: normalizeSkillRef(skills.elite),
  };
}

function normalizeSkillRef(value) {
  if (!value || typeof value !== "object") return null;
  const id = Number(value.id) || 0;
  if (!id) return null;
  return {
    id,
    name: asString(value.name, 120),
    icon: asString(value.icon, 500),
    description: asString(value.description, 500),
    slot: asString(value.slot, 40),
    type: asString(value.type, 40),
    specialization: Number(value.specialization) || 0,
  };
}

function normalizeEquipment(value) {
  const equipment = value && typeof value === "object" ? value : {};
  const normalizeStringMap = (obj) => {
    if (!obj || typeof obj !== "object") return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = asString(v, 120);
    return out;
  };
  const normalizeSigils = (obj) => {
    if (!obj || typeof obj !== "object") return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = Array.isArray(v) ? v.map((s) => asString(s, 40)) : [];
    }
    return out;
  };
  const normalizeInfusions = (obj) => {
    if (!obj || typeof obj !== "object") return {};
    // Slots that hold multiple infusions: back (2), rings (3), two-handed/aquatic weapons (2)
    const arraySlots = {
      back: 2, ring1: 3, ring2: 3,
      mainhand1: 2, mainhand2: 2, aquatic1: 2, aquatic2: 2,
      offhand1: 1, offhand2: 1,
      breather: 1,
    };
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (arraySlots[k]) {
        const arr = Array.isArray(v) ? v : (v ? [v] : []);
        out[k] = Array.from({ length: arraySlots[k] }, (_, i) => asString(arr[i], 40));
      } else {
        out[k] = asString(v, 120);
      }
    }
    return out;
  };
  return {
    statPackage: asString(equipment.statPackage, 80),
    relic: asString(equipment.relic, 120),
    food: asString(equipment.food, 120),
    utility: asString(equipment.utility, 120),
    slots: normalizeStringMap(equipment.slots),
    weapons: normalizeStringMap(equipment.weapons),
    runes: normalizeStringMap(equipment.runes),
    sigils: normalizeSigils(equipment.sigils),
    infusions: normalizeInfusions(equipment.infusions),
    enrichment: asString(equipment.enrichment, 40),
  };
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asString(entry, 40))
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeImages(value) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  for (const [key, val] of Object.entries(value).slice(0, 20)) {
    if (typeof val === "string" && val.startsWith("data:image/")) {
      result[String(key)] = val;
    }
  }
  return result;
}

function asString(value, maxLen) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  return maxLen ? text.slice(0, maxLen) : text;
}

function asIso(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

module.exports = { BuildStore };
