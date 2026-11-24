"use strict";

// The shape of comp.discordPosts, the post list that travels with a comp
// through team sync. Kept apart from compDiscordSync.js so compStore can use it
// without loading the Discord webhook code.
const MAX_POSTS_PER_COMP = 10;

function sharedEntry(p) {
  return { hookId: String(p.hookId), messageId: String(p.messageId), threadId: p.threadId ? String(p.threadId) : null };
}

/** A comp's shared post list, cleaned. */
function normalizeSharedPosts(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p || !p.hookId || !p.messageId || seen.has(String(p.messageId))) continue;
    seen.add(String(p.messageId));
    out.push(sharedEntry(p));
    if (out.length >= MAX_POSTS_PER_COMP) break;
  }
  return out;
}

/** `list` with `post` added newest first, deduped by message id and capped. */
function mergeSharedPosts(list, post) {
  return normalizeSharedPosts([post, ...(list || []).filter((p) => String(p?.messageId) !== String(post.messageId))]);
}

/**
 * Applies the change from `prev` to `next` onto `current`: posts added since
 * prev are merged in, posts removed since prev are dropped, and everything else
 * in current (a post shared meanwhile) stays.
 */
function applySharedPostDelta(current, next, prev) {
  const prevIds = new Set(normalizeSharedPosts(prev).map((p) => p.messageId));
  const nextList = normalizeSharedPosts(next);
  const nextIds = new Set(nextList.map((p) => p.messageId));
  let out = normalizeSharedPosts(current).filter((p) => !prevIds.has(p.messageId) || nextIds.has(p.messageId));
  for (const p of [...nextList].reverse()) {
    if (!prevIds.has(p.messageId)) out = mergeSharedPosts(out, p);
  }
  return out;
}

module.exports = { MAX_POSTS_PER_COMP, sharedEntry, normalizeSharedPosts, mergeSharedPosts, applySharedPostDelta };
