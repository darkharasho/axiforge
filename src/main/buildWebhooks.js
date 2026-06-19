"use strict";

const crypto = require("node:crypto");
const { shareCompToWebhooks, WEBHOOK_RE } = require("./compWebhooks");

// Build-side equivalent of getCompWebhooks: returns the build webhook list,
// migrating the legacy single build webhook (discord.buildWebhookUrl + thread
// settings) into discord.buildWebhooks the first time (then persisting; idempotent).
async function getBuildWebhooks(store) {
  const existing = await store.getSetting("discord.buildWebhooks");
  if (Array.isArray(existing)) return existing;

  const url = await store.getSetting("discord.buildWebhookUrl");
  if (url && WEBHOOK_RE.test(url)) {
    const [threadMode, threadId] = await Promise.all([
      store.getSetting("discord.buildThreadMode"),
      store.getSetting("discord.buildThreadId"),
    ]);
    const mode = threadMode || "none";
    const migrated = [{
      id: crypto.randomUUID(),
      name: "Default",
      url,
      threadMode: mode,
      threadId: mode === "custom" && threadId ? threadId : null,
    }];
    await store.setSetting("discord.buildWebhooks", migrated);
    return migrated;
  }
  return [];
}

// The multi-post aggregator is kind-agnostic — reuse the comp implementation
// rather than duplicate it.
module.exports = { getBuildWebhooks, shareBuildToWebhooks: shareCompToWebhooks };
