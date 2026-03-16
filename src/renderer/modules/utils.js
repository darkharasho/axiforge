// Pure utility functions with no DOM dependencies or global state.

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDate(value) {
  if (!value) return "unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString();
}

export function formatShortDate(value) {
  if (!value) return "unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function tierLabel(tier) {
  if (tier === 1) return "Adept";
  if (tier === 2) return "Master";
  return "Grandmaster";
}

export function formatPagesStatus(status) {
  if (!status) return "unknown";
  if (status === "queued") return "Queued";
  if (status === "building") return "Building";
  if (status === "built") return "Built";
  if (status === "errored" || status === "error") return "Error";
  return status;
}

export function matchesBuildQuery(build, query) {
  if (!query) return true;
  const haystack = [
    build.title || "",
    build.profession || "",
    build.notes || "",
    ...(build.tags || []),
    ...((build.specializations || []).map((entry) => entry.name || "")),
    build.gameMode || "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function parseWeaponSlotNum(slotStr) {
  const m = String(slotStr || "").match(/(\d+)$/);
  return m ? Number(m[1]) : 1;
}

export function parseTags(input) {
  return String(input || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeText(input) {
  const raw = String(input || "");
  const noTags = raw.replace(/<[^>]*>/g, " ");
  const entityDecoded = decodeHtmlEntities(noTags);
  return entityDecoded.replace(/[^\S\n]+/g, " ").replace(/\n /g, "\n").trim();
}

export function decodeHtmlEntities(value) {
  const node = document.createElement("textarea");
  node.innerHTML = String(value || "");
  return node.value;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeButton(label, variant, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.className = `btn btn-${variant}`;
  btn.addEventListener("click", onClick);
  return btn;
}

export function simplifyTrait(trait) {
  if (!trait) return null;
  return {
    id: Number(trait.id) || 0,
    name: String(trait.name || ""),
    icon: String(trait.icon || ""),
    description: String(trait.description || ""),
    tier: Number(trait.tier) || 0,
  };
}

export function simplifySkill(skill) {
  if (!skill) return null;
  return {
    id: Number(skill.id) || 0,
    name: String(skill.name || ""),
    icon: String(skill.icon || ""),
    description: String(skill.description || ""),
    slot: String(skill.slot || ""),
    type: String(skill.type || ""),
    specialization: Number(skill.specialization) || 0,
  };
}
