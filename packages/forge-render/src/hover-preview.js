// Standalone hover preview: a fixed-position card that follows the cursor.
// Framework-free; the host owns the container element and what HTML to show.
import { escapeHtml } from "./escape.js";

export function positionHoverPreview(node, x, y) {
  if (!node || node.classList.contains("hidden")) return;
  const pad = 8;
  const offset = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = node.getBoundingClientRect();
  let left = Number(x) + offset;
  let top = Number(y) + offset;
  if (left + rect.width > vw - pad) left = Number(x) - rect.width - offset;
  if (top + rect.height > vh - pad) top = Number(y) - rect.height - offset;
  left = Math.max(pad, Math.min(left, vw - rect.width - pad));
  top = Math.max(pad, Math.min(top, vh - rect.height - pad));
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

/** Minimal entity card for catalog records ({ name, icon, description, facts? }). */
export function renderEntityHoverHtml(entity, meta = "") {
  if (!entity) return "";
  const icon = entity.icon
    ? `<img class="hover-preview__icon" src="${escapeHtml(entity.icon)}" alt="" loading="lazy">`
    : "";
  const facts = (entity.facts || [])
    .filter((f) => f && f.text)
    .slice(0, 8)
    .map((f) => `<li>${escapeHtml(f.text)}${f.value !== undefined ? `: ${escapeHtml(String(f.value))}` : ""}</li>`)
    .join("");
  return `
    <div class="hover-preview__head">
      ${icon}
      <div>
        <p class="hover-preview__title">${escapeHtml(entity.name || "")}</p>
        ${meta ? `<p class="hover-preview__meta">${escapeHtml(meta)}</p>` : ""}
      </div>
    </div>
    ${entity.description ? `<p class="hover-preview__desc">${escapeHtml(entity.description)}</p>` : ""}
    ${facts ? `<ul class="hover-preview__bonuses">${facts}</ul>` : ""}`;
}

/**
 * Creates a hover-preview controller bound to a host element. The card node
 * is appended to `host` (give the host class="forge-render" so the scoped
 * CSS applies). Returns { bind, hide, destroy }.
 */
export function createHoverPreview(host) {
  const node = document.createElement("div");
  node.className = "hover-preview hidden";
  host.appendChild(node);
  const unbinders = [];

  const show = (html, x, y) => {
    node.innerHTML = html;
    node.classList.remove("hidden");
    positionHoverPreview(node, x, y);
  };
  const hide = () => node.classList.add("hidden");

  const bind = (target, htmlProvider) => {
    const read = () => (typeof htmlProvider === "function" ? htmlProvider() : htmlProvider || "");
    const onEnter = (event) => {
      const html = read();
      if (html) show(html, event.clientX, event.clientY);
    };
    const onMove = (event) => positionHoverPreview(node, event.clientX, event.clientY);
    const onLeave = () => hide();
    target.addEventListener("mouseenter", onEnter);
    target.addEventListener("mousemove", onMove);
    target.addEventListener("mouseleave", onLeave);
    unbinders.push(() => {
      target.removeEventListener("mouseenter", onEnter);
      target.removeEventListener("mousemove", onMove);
      target.removeEventListener("mouseleave", onLeave);
    });
  };

  const destroy = () => {
    for (const un of unbinders) un();
    node.remove();
  };

  return { bind, hide, destroy };
}
