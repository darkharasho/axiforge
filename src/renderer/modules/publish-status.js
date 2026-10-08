// Mirrors src/shared/publishState.js (CJS, used by the main process). The
// renderer cannot import that CJS module — Vite serves first-party CommonJS
// untransformed in dev — so publishStatus, compPublishStatus and the receipt
// list are reimplemented here as ESM. tests/unit/renderer/publish-status.test.js
// locks the two in sync. Records arrive from main with contentHash attached.

export const PUBLISH_RECEIPT_FIELDS = [
  "publishedSlug", "publishedFileId", "publishedKey", "publishedAt", "publishedOwner",
  "publishedHash", "publishedMemberHashes", "publishedFormat",
];

export function publishStatus(record) {
  const r = record || {};
  if (!r.publishedFileId) return "never";
  if (r.publishedHash) {
    if (!r.contentHash) return "current";
    return r.contentHash === r.publishedHash ? "current" : "stale";
  }
  return r.publishedAt && r.updatedAt !== r.publishedAt ? "stale" : "current";
}

export function compPublishStatus(comp, buildOf) {
  const c = comp || {};
  const status = publishStatus(c);
  if (status !== "current") return { status, reason: status === "stale" ? "self" : null };
  if (c.publishedHash && typeof buildOf === "function") {
    for (const [id, hash] of Object.entries(c.publishedMemberHashes || {})) {
      const member = buildOf(id);
      if (member && member.contentHash && member.contentHash !== hash) {
        return { status: "stale", reason: "member" };
      }
    }
  }
  return { status: "current", reason: null };
}

export function withoutPublishReceipt(record) {
  const out = { ...(record || {}) };
  for (const key of PUBLISH_RECEIPT_FIELDS) delete out[key];
  return out;
}

// One id -> build map per builds array. state.builds is REPLACED on every
// reload and sync splice (never mutated in place), so array identity is a
// sound cache key.
const _lookups = new WeakMap();
export function buildLookup(builds) {
  if (!Array.isArray(builds)) return () => undefined;
  let map = _lookups.get(builds);
  if (!map) {
    map = new Map(builds.map((b) => [b.id, b]));
    _lookups.set(builds, map);
  }
  return (id) => map.get(id);
}

export function itemPublishStatus(type, item, builds) {
  return type === "comp"
    ? compPublishStatus(item, buildLookup(builds))
    : { status: publishStatus(item), reason: null };
}

const GLOBE = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/></svg>`;

export function describePublishStatus(status, reason) {
  if (status === "current") return { className: "--current", label: "Published", title: "Published — up to date" };
  if (status === "stale") {
    return {
      className: "--stale",
      label: "Out of date",
      title: reason === "member" ? "A build in this comp changed since publish" : "Changed since last publish",
    };
  }
  if (status === "never") return { className: "--never", label: "Not published", title: "Not published yet" };
  return null;
}

/**
 * Publish mark, styled after the sync indicator. Library rows show nothing for
 * a never-published item; the editor variant labels every state.
 */
export function publishBadgeHtml(status, { reason = null, editor = false } = {}) {
  if (!editor && status === "never") return "";
  const d = describePublishStatus(status, reason);
  if (!d) return "";
  const base = editor ? "publish-badge publish-badge--editor" : "publish-badge";
  const label = editor ? `<span class="publish-badge__label">${d.label}</span>` : "";
  return `<span class="${base} publish-badge${d.className}" title="${d.title}">${GLOBE}${label}</span>`;
}

export function itemPublishBadgeHtml(type, item, builds) {
  const { status, reason } = itemPublishStatus(type, item, builds);
  return publishBadgeHtml(status, { reason });
}

/** Library toolbar filter: `selected` is a list of statuses, empty = all. */
export function matchesPublishFilter(type, item, builds, selected) {
  if (!Array.isArray(selected) || selected.length === 0) return true;
  return selected.includes(itemPublishStatus(type, item, builds).status);
}

// The comps page Status select stores these values.
const COMP_LIST_STATUS = { published: "current", stale: "stale", draft: "never" };

export function compMatchesStatusFilter(comp, value, builds) {
  const want = COMP_LIST_STATUS[value];
  if (!want) return true;
  return compPublishStatus(comp, buildLookup(builds)).status === want;
}

export function compPublishChipHtml(status, { small = false } = {}) {
  const sm = small ? " comp-badge--sm" : "";
  if (status === "current") return `<span class="axi-chip axi-chip--ok comp-badge comp-badge--published${sm}">Published</span>`;
  if (status === "stale") return `<span class="axi-chip axi-chip--warn comp-badge comp-badge--stale${sm}" title="Changed since last publish">Out of date</span>`;
  return `<span class="axi-chip comp-badge comp-badge--draft${sm}">Draft</span>`;
}
