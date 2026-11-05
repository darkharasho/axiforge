"use strict";

const { buildCompEmbeds, compEmbedsSig } = require("./discordWebhook");

// Where each comp was posted, local to this machine (webhooks are local
// settings, so these never ride along on the synced comp record):
//   { [compId]: [{ webhookId, messageId, threadId, sig }] }
const POSTS_KEY = "discord.compPosts";
const MAX_POSTS_PER_COMP = 10;

// Every read-modify-write of POSTS_KEY goes through here, so a share recording
// its post and a sync editing posts never overwrite each other.
let _chain = Promise.resolve();
function serialized(fn) {
  const next = _chain.then(fn);
  _chain = next.catch(() => {});
  return next;
}

async function readPosts(store) {
  const all = await store.getSetting(POSTS_KEY);
  return all && typeof all === "object" && !Array.isArray(all) ? all : {};
}

/** Remembers a post shareCompToDiscord made, newest first. */
function recordCompPost(store, compId, webhookId, post, sig) {
  if (!compId || !webhookId || !post?.messageId) return Promise.resolve();
  return serialized(async () => {
    const all = await readPosts(store);
    const list = (all[compId] || []).filter((p) => p.messageId !== post.messageId);
    list.unshift({ webhookId, messageId: post.messageId, threadId: post.threadId || null, sig: sig || null });
    all[compId] = list.slice(0, MAX_POSTS_PER_COMP);
    await store.setSetting(POSTS_KEY, all);
  });
}

/** Ids of comps that have at least one remembered post. */
async function postedCompIds(store) {
  const all = await readPosts(store);
  return Object.keys(all).filter((id) => Array.isArray(all[id]) && all[id].length);
}

/**
 * Brings every remembered post of `compIds` up to date with the comp.
 *
 *   webhooks     - current comp webhook list; a post whose webhook was removed is forgotten
 *   loadContext  - async (compId) => { comp, builds, compUrl, buildUrls } | null
 *   editPost     - editCompDiscordPost (injected for tests)
 *
 * A post is edited only when its embeds changed. A post Discord says is gone is
 * forgotten; any other failure keeps the old sig, so the next round retries.
 */
function syncCompDiscordPosts(store, compIds, { webhooks, loadContext, editPost }) {
  return serialized(async () => {
    const all = await readPosts(store);
    const byId = new Map((webhooks || []).map((w) => [w.id, w]));
    let changed = false;
    const edited = [];
    for (const compId of new Set(compIds || [])) {
      const posts = all[compId];
      if (!Array.isArray(posts) || !posts.length) continue;
      const ctx = await loadContext(compId);
      // A comp that's gone (trashed) keeps its posts: it may be restored.
      if (!ctx) continue;
      const sig = compEmbedsSig(buildCompEmbeds(ctx.comp, ctx.builds, ctx.compUrl, ctx.buildUrls));
      const keep = [];
      for (const post of posts) {
        const webhook = byId.get(post.webhookId);
        if (!webhook) { changed = true; continue; }
        if (post.sig === sig) { keep.push(post); continue; }
        let r;
        try {
          r = await editPost(ctx.comp, ctx.builds, ctx.compUrl, ctx.buildUrls, webhook.url, post);
        } catch (err) {
          r = { success: false, error: err?.message || String(err) };
        }
        if (r?.success) {
          keep.push({ ...post, sig: r.sig || sig });
          edited.push({ compId, messageId: post.messageId });
          changed = true;
        } else if (r?.gone) {
          changed = true;
        } else {
          console.warn("[discord-sync] edit failed:", compId, post.messageId, r?.error);
          keep.push(post);
        }
      }
      if (keep.length) all[compId] = keep; else delete all[compId];
    }
    if (changed) await store.setSetting(POSTS_KEY, all);
    return { edited };
  });
}

/**
 * Which posted comps a publish round affects: comps that published themselves,
 * plus comps containing a build that published (a renamed member build).
 *
 *   results   - publish round results [{ kind, id, ok }]
 *   comps     - all comps
 *   postedIds - ids with remembered posts
 *   memberIds - (comp) => build ids in the comp
 */
function compsAffectedByRound(results, comps, postedIds, memberIds) {
  const posted = new Set(postedIds);
  if (!posted.size) return [];
  const compIds = new Set();
  const buildIds = new Set();
  for (const r of results || []) {
    if (!r?.ok) continue;
    if (r.kind === "comp") compIds.add(r.id);
    else if (r.kind === "build") buildIds.add(r.id);
  }
  const out = [];
  for (const comp of comps || []) {
    if (!posted.has(comp.id)) continue;
    if (compIds.has(comp.id) || memberIds(comp).some((id) => buildIds.has(id))) out.push(comp.id);
  }
  return out;
}

module.exports = { POSTS_KEY, recordCompPost, postedCompIds, syncCompDiscordPosts, compsAffectedByRound };
