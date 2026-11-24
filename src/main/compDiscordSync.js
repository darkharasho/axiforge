"use strict";

const { buildCompEmbeds, compEmbedsSig } = require("./discordWebhook");
const { MAX_POSTS_PER_COMP, sharedEntry, normalizeSharedPosts, mergeSharedPosts } = require("./compDiscordPosts");

// Where a comp was posted lives in two places:
//
//   comp.discordPosts  - [{ hookId, messageId, threadId }], ON the comp, so it
//                        travels through team sync. `hookId` is the Discord
//                        webhook's own id (from its URL), never the token: any
//                        teammate who configured the same webhook can edit the
//                        post, and nobody else can.
//   POSTS_KEY setting  - { [compId]: [{ webhookId, hookId, messageId, threadId, sig, shared }] },
//                        local to this machine: which local webhook reached the
//                        post and the sig of what this machine last sent. The
//                        sig stays local so an edit never rewrites the comp.
//
// `shared: true` marks a local entry already copied into comp.discordPosts, so a
// post a teammate dropped (its message was deleted) is never pushed back.
const POSTS_KEY = "discord.compPosts";

const HOOK_ID_RE = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/(\d+)\//;

/** The Discord webhook id in a webhook URL, or null. */
function discordHookId(url) {
  const m = typeof url === "string" ? HOOK_ID_RE.exec(url) : null;
  return m ? m[1] : null;
}

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

/**
 * Remembers a post shareCompToDiscord made, newest first. Returns the entry to
 * add to comp.discordPosts (null when there is nothing to remember).
 */
function recordCompPost(store, compId, webhook, post, sig) {
  if (!compId || !webhook?.id || !post?.messageId) return Promise.resolve(null);
  const hookId = discordHookId(webhook.url);
  return serialized(async () => {
    const all = await readPosts(store);
    const list = (all[compId] || []).filter((p) => p.messageId !== post.messageId);
    list.unshift({
      webhookId: webhook.id, hookId, messageId: post.messageId, threadId: post.threadId || null,
      sig: sig || null, shared: Boolean(hookId),
    });
    all[compId] = list.slice(0, MAX_POSTS_PER_COMP);
    await store.setSetting(POSTS_KEY, all);
    return hookId ? sharedEntry({ hookId, messageId: post.messageId, threadId: post.threadId }) : null;
  });
}

/** Ids of comps with a post remembered here or shared on the comp. */
async function postedCompIds(store, comps = []) {
  const all = await readPosts(store);
  const ids = new Set(Object.keys(all).filter((id) => Array.isArray(all[id]) && all[id].length));
  for (const c of comps) if (normalizeSharedPosts(c?.discordPosts).length) ids.add(c.id);
  return [...ids];
}

/**
 * Brings every post of `compIds` up to date with the comp: the ones remembered
 * here and the ones shared on the comp by teammates.
 *
 *   webhooks      - this machine's comp webhooks; a post is edited through the
 *                   one it was made with, else any with the same Discord id
 *   loadContext   - async (compId) => { comp, builds, compUrl, buildUrls } | null
 *   editPost      - editCompDiscordPost (injected for tests)
 *   updateShared  - async (compId, next, prev) => void, applies the change from
 *                   prev to next to comp.discordPosts
 *
 * A post is edited only when its embeds changed since this machine last sent
 * them. A deleted message leaves the shared list; a webhook only this machine
 * can't reach (removed here, bad token) is forgotten here alone. Any other
 * failure keeps the old sig, so the next round retries.
 */
function syncCompDiscordPosts(store, compIds, { webhooks, loadContext, editPost, updateShared }) {
  return serialized(async () => {
    const all = await readPosts(store);
    const byId = new Map((webhooks || []).map((w) => [w.id, w]));
    const byHook = new Map();
    for (const w of webhooks || []) {
      const h = discordHookId(w.url);
      if (h && !byHook.has(h)) byHook.set(h, w);
    }
    let changed = false;
    const edited = [];
    for (const compId of new Set(compIds || [])) {
      const ctx = await loadContext(compId);
      // A comp that's gone (trashed) keeps its posts: it may be restored.
      if (!ctx) continue;
      const shared = normalizeSharedPosts(ctx.comp?.discordPosts);
      let nextShared = shared;
      const local = Array.isArray(all[compId]) ? all[compId] : [];
      const localIds = new Set(local.map((p) => String(p.messageId)));
      const candidates = [
        ...local.map((p) => ({ ...p, local: true })),
        ...shared.filter((p) => !localIds.has(p.messageId)).map((p) => ({ ...p, local: false })),
      ];
      const sig = compEmbedsSig(buildCompEmbeds(ctx.comp, ctx.builds, ctx.compUrl, ctx.buildUrls));
      const keep = [];
      for (const cand of candidates) {
        const { local: isLocal, ...post } = cand;
        const webhook = byId.get(post.webhookId) || (post.hookId ? byHook.get(String(post.hookId)) : null);
        if (!webhook) {
          // Nothing here can reach it. A teammate's may: leave it shared.
          if (isLocal) changed = true;
          continue;
        }
        const hookId = post.hookId || discordHookId(webhook.url);
        let entry = { ...post, webhookId: webhook.id, hookId, threadId: post.threadId || null, sig: post.sig || null };
        // Recorded before posts were shared: share it once.
        if (isLocal && !post.shared && hookId) {
          nextShared = mergeSharedPosts(nextShared, entry);
          entry.shared = true;
          changed = true;
        }
        if (!isLocal) entry.shared = true;
        if (entry.sig === sig) { keep.push(entry); continue; }
        let r;
        try {
          r = await editPost(ctx.comp, ctx.builds, ctx.compUrl, ctx.buildUrls, webhook.url, entry);
        } catch (err) {
          r = { success: false, error: err?.message || String(err) };
        }
        if (r?.success) {
          keep.push({ ...entry, sig: r.sig || sig });
          edited.push({ compId, messageId: post.messageId });
          changed = true;
        } else if (r?.gone) {
          if (r.messageGone) nextShared = nextShared.filter((p) => p.messageId !== String(post.messageId));
          if (isLocal) changed = true;
        } else {
          console.warn("[discord-sync] edit failed:", compId, post.messageId, r?.error);
          if (isLocal) keep.push(entry);
        }
      }
      if (keep.length) all[compId] = keep.slice(0, MAX_POSTS_PER_COMP);
      else if (all[compId]) delete all[compId];
      if (updateShared && JSON.stringify(nextShared) !== JSON.stringify(shared)) {
        try {
          await updateShared(compId, nextShared, shared);
        } catch (err) {
          console.warn("[discord-sync] share failed:", compId, err?.message || err);
        }
      }
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
 *   postedIds - ids with remembered or shared posts
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

module.exports = {
  POSTS_KEY, discordHookId, normalizeSharedPosts, mergeSharedPosts,
  recordCompPost, postedCompIds, syncCompDiscordPosts, compsAffectedByRound,
};
