// SPA read-only notes renderer
// Parses markdown, resolves @[category:id:Name] mentions into hoverable chips.

import { marked } from "marked";
import { bindHoverPreview } from "@renderer/modules/detail-panel.js";
import { decodeHtmlEntities } from "@renderer/modules/utils.js";
import { GW2_WEAPONS_BY_ID } from "@renderer/modules/constants.js";

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
  const infusionById = new Map(Object.values(build.equipmentDisplay?.infusions || {}).flat().filter(Boolean).map((i) => [i.id, i]));
  const enrichmentById = build.equipmentDisplay?.enrichment ? new Map([[build.equipmentDisplay.enrichment.id, build.equipmentDisplay.enrichment]]) : new Map();
  const foodById = build.equipmentDisplay?.food ? new Map([[build.equipmentDisplay.food.id, build.equipmentDisplay.food]]) : new Map();
  const utilityById = build.equipmentDisplay?.utility ? new Map([[build.equipmentDisplay.utility.id, build.equipmentDisplay.utility]]) : new Map();
  const relicById = build.equipmentDisplay?.relic ? new Map([[build.equipmentDisplay.relic.id, build.equipmentDisplay.relic]]) : new Map();

  // Merge in any extra upgrade items referenced in notes but not equipped
  for (const item of (build.catalogNotesMentions || [])) {
    const map = { rune: runeById, sigil: sigilById, food: foodById, utility: utilityById,
      infusion: infusionById, enrichment: enrichmentById, relic: relicById }[item.category];
    if (map && !map.has(item.id)) map.set(item.id, item);
  }

  // Resolve @[category:id:Name] patterns
  html = html.replace(/@\[(\w+):([\w]+):([^\]]+)\]/g, (match, category, id, name) => {
    const numId = /^\d+$/.test(id) ? Number(id) : id;
    let resolved = null;
    let resolvedCategory = category;
    switch (category) {
      case "skill": resolved = skillById.get(numId); break;
      case "trait": resolved = traitById.get(numId); break;
      case "rune": resolved = runeById.get(numId); break;
      case "sigil": resolved = sigilById.get(numId); break;
      case "food": resolved = foodById.get(numId); break;
      case "utility": resolved = utilityById.get(numId); break;
      case "infusion": resolved = infusionById.get(numId); break;
      case "enrichment": resolved = enrichmentById.get(numId); break;
      case "relic": resolved = relicById.get(numId); break;
      case "weapon": {
        const w = GW2_WEAPONS_BY_ID.get(id);
        resolved = w ? { id: w.id, name: w.label, icon: w.icon } : null;
        break;
      }
      case "item": {
        const itemMaps = [["rune", runeById], ["sigil", sigilById], ["food", foodById], ["utility", utilityById], ["infusion", infusionById], ["enrichment", enrichmentById], ["relic", relicById]];
        for (const [cat, map] of itemMaps) {
          resolved = map.get(numId);
          if (resolved) { resolvedCategory = cat; break; }
        }
        break;
      }
      default: break;
    }

    const icon = resolved?.icon || "";
    const iconHtml = icon ? `<img class="notes-mention__icon" src="${icon}" alt="">` : "";
    const escapedName = escapeHtml(decodeHtmlEntities(name));

    // Always render as a styled chip (matching Electron behavior) — even if
    // the item couldn't be resolved, the name is still meaningful to the reader.
    return `<span class="notes-mention" data-type="${resolvedCategory}" data-id="${numId}">${iconHtml}${escapedName} <span class="notes-mention__label">${resolvedCategory}</span></span>`;
  });

  container.innerHTML = html;

  // Resolve ~img:X tokens to actual data URLs
  resolveImageTokens(container, build.images);

  // Embed YouTube / Twitch videos
  embedYouTubeVideos(container);
  embedTwitchVideos(container);

  // Bind hover tooltips
  container.querySelectorAll(".notes-mention").forEach((chip) => {
    const type = chip.dataset.type;
    const rawId = chip.dataset.id;
    const id = /^\d+$/.test(rawId) ? Number(rawId) : rawId;
    const kind = type === "trait" ? "trait" : type === "skill" ? "skill" : `equip-${type}`;

    bindHoverPreview(chip, kind, () => {
      switch (type) {
        case "skill": return skillById.get(id) || null;
        case "trait": return traitById.get(id) || null;
        case "rune": return runeById.get(id) || null;
        case "sigil": return sigilById.get(id) || null;
        case "food": return foodById.get(id) || null;
        case "utility": return utilityById.get(id) || null;
        case "infusion": return infusionById.get(id) || null;
        case "enrichment": return enrichmentById.get(id) || null;
        case "relic": return relicById.get(id) || null;
        case "weapon": { const w = GW2_WEAPONS_BY_ID.get(id); return w ? { id: w.id, name: w.label, icon: w.icon } : null; }
        case "item": return runeById.get(id) || sigilById.get(id) || foodById.get(id) || utilityById.get(id) || infusionById.get(id) || enrichmentById.get(id) || relicById.get(id) || null;
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

// ── Twitch embed ──────────────────────────────────────────────────────

function extractTwitchInfo(text) {
  let m = text.match(/^https?:\/\/(?:www\.)?twitch\.tv\/videos\/(\d+)/);
  if (m) return { type: "video", id: m[1], url: m[0] };
  m = text.match(/^https?:\/\/(?:www\.)?twitch\.tv\/\w+\/clip\/([a-zA-Z0-9_-]+)/);
  if (m) return { type: "clip", id: m[1], url: m[0] };
  m = text.match(/^https?:\/\/clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/);
  if (m) return { type: "clip", id: m[1], url: m[0] };
  return null;
}

function embedTwitchVideos(container) {
  const parent = window.location.hostname || "localhost";

  container.querySelectorAll("p").forEach((p) => {
    const text = p.textContent.trim();
    const info = extractTwitchInfo(text);
    if (!info) return;

    const nodes = [...p.childNodes].filter((n) =>
      !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim())
    );
    const isBareUrl = nodes.length === 1 && nodes[0].nodeType === Node.TEXT_NODE;
    const isSingleLink = nodes.length === 1 && nodes[0].nodeName === "A";
    if (!isBareUrl && !isSingleLink) return;

    const embed = document.createElement("div");
    embed.className = "notes-embed notes-embed--twitch";

    const meta = document.createElement("div");
    meta.className = "notes-embed__meta";

    const channelMatch = info.url.match(/twitch\.tv\/(\w+)\/clip\//);
    const fallbackChannel = channelMatch ? channelMatch[1] : "Twitch";

    const authorEl = document.createElement("div");
    authorEl.className = "notes-embed__author";
    authorEl.textContent = fallbackChannel;
    meta.append(authorEl);

    const titleEl = document.createElement("a");
    titleEl.className = "notes-embed__title";
    titleEl.textContent = info.type === "video" ? `VOD ${info.id}` : info.id;
    titleEl.href = info.url;
    titleEl.target = "_blank";
    titleEl.rel = "noopener";
    meta.append(titleEl);

    const videoWrap = document.createElement("div");
    videoWrap.className = "notes-embed__video";

    const placeholder = document.createElement("div");
    placeholder.className = "notes-embed__twitch-placeholder";
    placeholder.innerHTML = '<svg viewBox="0 0 256 268" width="48" height="50"><path d="M17.458 0L0 46.556v185.262h63.208v34.934h36.834l34.715-34.934h53.354L256 163.955V0H17.458zm23.259 23.263h192.02v128.029l-45.41 45.415h-63.208L89.57 231.222v-34.515H40.717V23.263zm64.551 84.544h23.263V58.56h-23.263v49.247zm63.208 0h23.263V58.56h-23.263v49.247z" fill="#9146FF"/></svg>';

    const playBtn = document.createElement("div");
    playBtn.className = "notes-embed__play";
    playBtn.innerHTML = '<svg viewBox="0 0 68 48"><rect width="68" height="48" rx="8" fill="#9146FF"/><path d="M45 24L27 14v20" fill="#fff"/></svg>';

    videoWrap.append(placeholder, playBtn);

    videoWrap.addEventListener("click", () => {
      videoWrap.innerHTML = "";
      const iframe = document.createElement("iframe");
      if (info.type === "video") {
        iframe.src = `https://player.twitch.tv/?video=${info.id}&parent=${parent}&autoplay=true`;
      } else {
        iframe.src = `https://clips.twitch.tv/embed?clip=${info.id}&parent=${parent}&autoplay=true`;
      }
      iframe.setAttribute("frameborder", "0");
      iframe.setAttribute("allowfullscreen", "");
      iframe.allow = "autoplay; encrypted-media";
      videoWrap.append(iframe);
    });

    embed.append(meta, videoWrap);
    p.replaceWith(embed);

    // Fetch metadata via Iframely open API
    fetch(`https://open.iframe.ly/api/oembed?url=${encodeURIComponent(info.url)}&origin=darkharasho`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        if (data.author_name) authorEl.textContent = data.author_name;
        if (data.title) titleEl.textContent = data.title;
      })
      .catch(() => {});
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
