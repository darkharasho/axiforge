"use strict";

// Access check: blocks the app when one of its identities is on the Axi
// denylist. See README "Access".

const { createAccessGate, createConfig, webhookServers } = require("@axiapps/axi-config");
const { blockIfTripped, handleBlocked } = require("@axiapps/axi-config/electron");

function urlsOf(list) {
  return Array.isArray(list) ? list.map((w) => w && w.url).filter(Boolean) : [];
}

// deps: { electron, store, headless?, config?, onBlocked?, lookupWebhooks? }
// Tests inject config, onBlocked and lookupWebhooks; production creates them.
async function startAccess(deps) {
  const { electron, store } = deps;
  const lookupWebhooks = deps.lookupWebhooks || webhookServers;
  const config = deps.config
    || createConfig({ appId: "axiforge", cacheDir: electron.app.getPath("userData") });
  await config.ready();
  if (deps.headless && config.isBlocked()) {
    // No window to show a block screen in: say so and stop before anything starts.
    process.stderr.write("Access unavailable.\n");
    electron.app.exit(1);
    return { blocked: true };
  }
  if (blockIfTripped(electron, config)) return { blocked: true };

  const gate = createAccessGate({
    config,
    onBlocked: deps.onBlocked || ((info) => handleBlocked(electron, config, info)),
  });

  gate.addSource("github-user", async () => {
    const id = (await store.getAuth())?.viewer?.id;
    return id == null ? [] : [{ kind: "github_user", value: String(id) }];
  });

  gate.addSource("webhooks", async () => {
    // Read the lists directly: the getCompWebhooks/getBuildWebhooks helpers
    // write migrated settings, which a check must not do.
    const [comp, build, legacy, legacyBuild] = await Promise.all([
      store.getSetting("discord.compWebhooks"),
      store.getSetting("discord.buildWebhooks"),
      store.getSetting("discord.webhookUrl"),
      store.getSetting("discord.buildWebhookUrl"),
    ]);
    const urls = [...urlsOf(comp), ...urlsOf(build)];
    if (legacy) urls.push(legacy);
    // getBuildWebhooks migrates this single URL only while no list exists yet.
    if (!Array.isArray(build) && legacyBuild) urls.push(legacyBuild);
    return lookupWebhooks(urls);
  });

  config.onChange(() => void gate.recheck());
  return { blocked: false, gate, config };
}

module.exports = { startAccess };
