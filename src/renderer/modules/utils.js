// Pure utility functions with no DOM dependencies or global state.

/** Strip GW2 in-game markup (e.g. <c=@abilitytype>text</c>, <br>) from API strings. */
export function stripGw2Markup(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<c=[^>]*>(.*?)<\/c>/gi, "$1")
    .replace(/<[^>]*>/g, "")
    .trim();
}

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

export function formatRelativeTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
  return String(value || "")
    .replaceAll("&#039;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", "\"")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tag pill helpers
// ---------------------------------------------------------------------------

/**
 * Render tag pills inside a .tag-container element.
 * Preserves the <input> at the end for adding new tags.
 */
export function renderTagPills(container, tags) {
  const input = container.querySelector(".tag-container__input");
  // Remove existing pills
  for (const pill of [...container.querySelectorAll(".tag-pill")]) pill.remove();
  // Insert pills before the input
  for (const tag of tags) {
    const pill = document.createElement("span");
    pill.className = "tag-pill";
    pill.textContent = tag;
    const removeBtn = document.createElement("button");
    removeBtn.className = "tag-pill__remove";
    removeBtn.type = "button";
    removeBtn.textContent = "\u00d7";
    removeBtn.setAttribute("aria-label", `Remove tag ${tag}`);
    pill.append(removeBtn);
    container.insertBefore(pill, input);
  }
  input.value = "";
}

/**
 * Wire up a .tag-container for interactive tag editing.
 * Commits a tag on Enter or comma; removes on backspace when input is empty.
 * @param {HTMLElement} container  The .tag-container element
 * @param {() => string[]} getTags  Returns the live tags array from editor state
 * @param {(tags: string[]) => void} setTags  Replaces the tags array in editor state
 * @param {() => void} onChange  Called after any mutation
 */
export function wireTagInput(container, getTags, setTags, onChange) {
  const input = container.querySelector(".tag-container__input");

  function addTag(text) {
    const tag = text.trim().slice(0, 40);
    if (!tag) return;
    const tags = getTags();
    if (tags.length >= 20) return;
    if (tags.includes(tag)) { input.value = ""; return; }
    tags.push(tag);
    setTags(tags);
    renderTagPills(container, tags);
    onChange();
  }

  function removeTag(index) {
    const tags = getTags();
    tags.splice(index, 1);
    setTags(tags);
    renderTagPills(container, tags);
    onChange();
  }

  input.addEventListener("keydown", (e) => {
    const tags = getTags();
    if ((e.key === "Enter" || e.key === ",") && input.value.trim()) {
      e.preventDefault();
      for (const part of input.value.split(",")) addTag(part);
      input.value = "";
    } else if (e.key === "Backspace" && !input.value && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  });

  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text");
    for (const part of text.split(",")) addTag(part);
  });

  container.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".tag-pill__remove");
    if (removeBtn) {
      const pill = removeBtn.parentElement;
      const pills = [...container.querySelectorAll(".tag-pill")];
      const index = pills.indexOf(pill);
      if (index >= 0) removeTag(index);
      return;
    }
    input.focus();
  });
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
    description: stripGw2Markup(trait.description),
    tier: Number(trait.tier) || 0,
  };
}

export function simplifySkill(skill) {
  if (!skill) return null;
  return {
    id: Number(skill.id) || 0,
    name: String(skill.name || ""),
    icon: String(skill.icon || ""),
    description: stripGw2Markup(skill.description),
    slot: String(skill.slot || ""),
    type: String(skill.type || ""),
    specialization: Number(skill.specialization) || 0,
  };
}

/**
 * Coarse "N minutes ago" phrasing for sync timestamps. Unlike
 * formatRelativeTime (compact "5m ago" for badges/lists) this reads as prose
 * inside a sentence, e.g. the conflict modal's "…was changed by X 5 minutes ago".
 */
export function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
