"use strict";

const crypto = require("node:crypto");

const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//;

function makeId() {
  return crypto.randomUUID();
}

// Returns the comp webhook list, migrating the legacy single-webhook settings
// into a one-entry list the first time (then persisting so it's idempotent).
async function getCompWebhooks(store) {
  const existing = await store.getSetting("discord.compWebhooks");
  if (Array.isArray(existing)) return existing;

  const url = await store.getSetting("discord.webhookUrl");
  if (url && WEBHOOK_RE.test(url)) {
    const [threadMode, threadId] = await Promise.all([
      store.getSetting("discord.threadMode"),
      store.getSetting("discord.threadId"),
    ]);
    const mode = threadMode || "none";
    const migrated = [{
      id: makeId(),
      name: "Default",
      url,
      threadMode: mode,
      threadId: mode === "custom" && threadId ? threadId : null,
    }];
    await store.setSetting("discord.compWebhooks", migrated);
    return migrated;
  }
  return [];
}

// Posts a comp to multiple webhooks and aggregates the results.
//   webhooks   - full list from getCompWebhooks()
//   webhookIds - ids to target; null/empty means "all"
//   shareOne   - async (webhook) => { success, error? }
async function shareCompToWebhooks(webhooks, webhookIds, shareOne) {
  let targets = webhooks;
  if (Array.isArray(webhookIds) && webhookIds.length) {
    const idSet = new Set(webhookIds);
    targets = webhooks.filter((w) => idSet.has(w.id));
  }
  if (!targets.length) {
    return { success: false, error: "No Discord webhook configured", results: [] };
  }

  const results = [];
  for (const w of targets) {
    if (!WEBHOOK_RE.test(w.url || "")) {
      results.push({ id: w.id, name: w.name, success: false, error: "Invalid webhook URL" });
      continue;
    }
    try {
      const r = await shareOne(w);
      const entry = { id: w.id, name: w.name, success: !!r.success };
      if (!r.success) entry.error = r.error;
      results.push(entry);
    } catch (err) {
      results.push({ id: w.id, name: w.name, success: false, error: err.message });
    }
  }
  return { success: results.some((r) => r.success), results };
}

module.exports = { WEBHOOK_RE, getCompWebhooks, shareCompToWebhooks };
