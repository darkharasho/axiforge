// SPA read-only notes renderer
// Parses markdown, resolves @[category:id:Name] mentions into hoverable chips.

import { marked } from "marked";
import { bindHoverPreview } from "@renderer/modules/detail-panel.js";

export function renderNotes(build) {
  const container = document.createElement("div");
  container.className = "notes-preview";

  if (!build.notes) {
    container.innerHTML = '<p style="color:var(--muted);font-style:italic">No notes.</p>';
    return container;
  }

  // Configure marked to escape HTML (XSS prevention for published content)
  const renderer = new marked.Renderer();
  const origHtml = renderer.html.bind(renderer);
  renderer.html = (body) => {
    const d = document.createElement("div");
    d.textContent = typeof body === "string" ? body : body?.text || "";
    return `<p>${d.innerHTML}</p>`;
  };

  let html = marked.parse(build.notes, { breaks: true, renderer });

  // Build lookup maps from enriched catalog data
  const skillById = new Map([
    ...(build.catalogSkills || []).map((s) => [s.id, s]),
    ...(build.catalogWeaponSkills || []).map((s) => [s.id, s]),
  ]);
  const traitById = new Map((build.catalogTraits || []).map((t) => [t.id, t]));
  const runeById = new Map(Object.values(build.equipmentDisplay?.runes || {}).filter(Boolean).map((r) => [r.id, r]));
  const sigilById = new Map(Object.values(build.equipmentDisplay?.sigils || {}).flat().filter(Boolean).map((s) => [s.id, s]));
  const foodById = build.equipmentDisplay?.food ? new Map([[build.equipmentDisplay.food.id, build.equipmentDisplay.food]]) : new Map();
  const utilityById = build.equipmentDisplay?.utility ? new Map([[build.equipmentDisplay.utility.id, build.equipmentDisplay.utility]]) : new Map();

  // Resolve @[category:id:Name] patterns
  html = html.replace(/@\[(\w+):(\d+):([^\]]+)\]/g, (match, category, id, name) => {
    const numId = Number(id);
    let resolved = null;
    switch (category) {
      case "skill": resolved = skillById.get(numId); break;
      case "trait": resolved = traitById.get(numId); break;
      case "rune": resolved = runeById.get(numId); break;
      case "sigil": resolved = sigilById.get(numId); break;
      case "food": resolved = foodById.get(numId); break;
      case "utility": resolved = utilityById.get(numId); break;
      default: break;
    }

    const icon = resolved?.icon || "";
    const iconHtml = icon ? `<img class="notes-mention__icon" src="${icon}" alt="">` : "";
    const escapedName = escapeHtml(name);

    if (resolved) {
      return `<span class="notes-mention" data-type="${category}" data-id="${numId}">${iconHtml}${escapedName} <span class="notes-mention__label">${category}</span></span>`;
    }
    return `@${escapedName}`;
  });

  container.innerHTML = html;

  // Resolve ~img:X tokens to actual data URLs
  resolveImageTokens(container, build.images);

  // Embed YouTube videos
  embedYouTubeVideos(container);

  // Bind hover tooltips
  container.querySelectorAll(".notes-mention").forEach((chip) => {
    const type = chip.dataset.type;
    const id = Number(chip.dataset.id);
    const kind = type === "trait" ? "trait" : type === "skill" ? "skill" : `equip-${type}`;

    bindHoverPreview(chip, kind, () => {
      switch (type) {
        case "skill": return skillById.get(id) || null;
        case "trait": return traitById.get(id) || null;
        case "rune": return runeById.get(id) || null;
        case "sigil": return sigilById.get(id) || null;
        case "food": return foodById.get(id) || null;
        case "utility": return utilityById.get(id) || null;
        default: return null;
      }
    });
  });

  return container;
}

// ── Image token resolution ────────────────────────────────────────────

function resolveImageTokens(container, images) {
  if (!images) return;
  container.querySelectorAll("img").forEach((img) => {
    const m = img.getAttribute("src")?.match(/^~img:(\w+)$/);
    if (!m) return;
    const dataUrl = images[m[1]];
    if (dataUrl) img.src = dataUrl;
    else img.style.display = "none";
  });
}

// ── YouTube embed ─────────────────────────────────────────────────────

function extractYouTubeId(text) {
  const m = text.match(/^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?(?:[^&\s]*&)*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function embedYouTubeVideos(container) {
  container.querySelectorAll("p").forEach((p) => {
    const text = p.textContent.trim();
    const videoId = extractYouTubeId(text);
    if (!videoId) return;

    const nodes = [...p.childNodes].filter((n) =>
      !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim())
    );
    const isBareUrl = nodes.length === 1 && nodes[0].nodeType === Node.TEXT_NODE;
    const isSingleLink = nodes.length === 1 && nodes[0].nodeName === "A";
    if (!isBareUrl && !isSingleLink) return;

    const embed = document.createElement("div");
    embed.className = "notes-embed";

    const meta = document.createElement("div");
    meta.className = "notes-embed__meta";
    meta.style.display = "none";

    const videoWrap = document.createElement("div");
    videoWrap.className = "notes-embed__video";

    const thumb = document.createElement("img");
    thumb.className = "notes-embed__thumb";
    thumb.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    thumb.alt = "Video thumbnail";

    const playBtn = document.createElement("div");
    playBtn.className = "notes-embed__play";
    playBtn.innerHTML = '<svg viewBox="0 0 68 48"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.64 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42 6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="red"/><path d="M45 24L27 14v20" fill="#fff"/></svg>';

    videoWrap.append(thumb, playBtn);

    videoWrap.addEventListener("click", () => {
      videoWrap.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
      iframe.setAttribute("frameborder", "0");
      iframe.setAttribute("allowfullscreen", "");
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      videoWrap.append(iframe);
    });

    embed.append(meta, videoWrap);
    p.replaceWith(embed);

    // Fetch video metadata for title bar
    fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        if (data.author_name) {
          const author = document.createElement("div");
          author.className = "notes-embed__author";
          author.textContent = data.author_name;
          meta.append(author);
        }
        if (data.title) {
          const title = document.createElement("a");
          title.className = "notes-embed__title";
          title.textContent = data.title;
          title.href = `https://www.youtube.com/watch?v=${videoId}`;
          title.target = "_blank";
          title.rel = "noopener";
          meta.append(title);
        }
        if (data.author_name || data.title) meta.style.display = "";
      })
      .catch(() => {});
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
